// The Notes store (`notes.*` handlers): the confirmed handler surface, title derivation, the
// conflict-checked update, pin ordering, the trash (recover/permanent delete/empty/purge) and the
// one-time onboarding note. Markdown conversions have their own block below.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createNotes } = require("../src/notes.js");
const { markdownToHtml, toPlainText, deriveTitle, htmlToMarkdown } = require("../src/notes-markdown.js");

let cleanupQueue = [];

function makeNotes(directory, { pushed = [], clock = null } = {}) {
  let tick = 1_000_000;
  const notes = createNotes({
    dataRoot: directory,
    pushToFrontend: (method, data) => {
      pushed.push([method, data]);
      return Promise.resolve(undefined);
    },
    now: clock ?? (() => (tick += 1000)),
  });
  cleanupQueue.push(() => notes.close());
  return notes;
}

function withRoot(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
  cleanupQueue = [];
  try {
    return run(directory);
  } finally {
    for (const close of cleanupQueue) {
      try {
        close();
      } catch {
        /* already closed */
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("create derives the title from the first non-empty line and stores recency fields", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const { note } = handlers.create({ text: "\n  \nShopping list\nmilk" });
    assert.equal(note.title, "Shopping list");
    assert.equal(note.text, "\n  \nShopping list\nmilk");
    assert.equal(note.pinned, null);
    assert.ok(note.createdAt > 0 && note.updatedAt === note.createdAt);
    assert.equal(handlers.count().count, 1);
  });
});

test("an empty note is legal (New Note) and titles as Untitled", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const { note } = handlers.create({ text: "" });
    assert.equal(note.title, "Untitled");
    assert.equal(handlers.count().count, 1);
  });
});

test("create accepts an explicit title (the Duplicate suffix) and pins stay null", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const copy = handlers.create({ text: "original body", title: "original (Copy)" }).note;
    assert.equal(copy.title, "original (Copy)");
    assert.equal(copy.pinned, null);
  });
});

test("update writes text, re-derives the title and honours expectedUpdatedAt conflicts", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const { note } = handlers.create({ text: "first" });
    const updated = handlers.update({ id: note.id, text: "second draft" });
    assert.equal(updated.result, "ok");
    assert.equal(updated.note.title, "second draft");
    assert.ok(updated.note.updatedAt > note.updatedAt);

    const conflict = handlers.update({ id: note.id, text: "loser", expectedUpdatedAt: note.updatedAt });
    assert.equal(conflict.result, "conflict");
    assert.equal(conflict.note.text, "second draft", "the store keeps the winning content");

    const winning = handlers.update({
      id: note.id,
      text: "third draft",
      expectedUpdatedAt: updated.note.updatedAt,
    });
    assert.equal(winning.result, "ok");
    assert.equal(winning.note.text, "third draft");
  });
});

test("update on a missing note throws", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    assert.throws(() => handlers.update({ id: "nope", text: "x" }), /Note not found/);
  });
});

test("list orders pinned first, then by updatedAt; browse exposes charCount", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "alpha" }).note;
    const b = handlers.create({ text: "beta" }).note;
    const c = handlers.create({ text: "gamma text" }).note;
    handlers.pin({ id: b.id });
    handlers.pin({ id: a.id });

    const listed = handlers.list().notes.map((note) => note.id);
    // a was pinned last so it lands first (same integer-swap scheme as Snippets).
    assert.deepEqual(listed, [a.id, b.id, c.id]);

    handlers.update({ id: c.id, text: "gamma with more text" });
    const browse = handlers.browse().notes.find((note) => note.id === c.id);
    assert.equal(browse.charCount, "gamma with more text".length);
  });
});

test("movePinnedUp/Down swap neighbours only", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "a" }).note;
    const b = handlers.create({ text: "b" }).note;
    const c = handlers.create({ text: "c" }).note;
    for (const note of [a, b, c]) handlers.pin({ id: note.id });
    // pinned order now: c(0) b(1) a(2)
    assert.deepEqual(handlers.list().notes.map((note) => note.id), [c.id, b.id, a.id]);

    handlers.movePinnedDown({ id: c.id });
    assert.deepEqual(handlers.list().notes.map((note) => note.id), [b.id, c.id, a.id]);

    handlers.movePinnedUp({ id: c.id });
    assert.deepEqual(handlers.list().notes.map((note) => note.id), [c.id, b.id, a.id]);

    // The first pinned note cannot move further up; the last cannot move down.
    handlers.movePinnedUp({ id: c.id });
    handlers.movePinnedDown({ id: a.id });
    assert.deepEqual(handlers.list().notes.map((note) => note.id), [c.id, b.id, a.id]);
  });
});

test("unpin removes the note from the pinned section", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "a" }).note;
    handlers.pin({ id: a.id });
    assert.notEqual(handlers.getOne({ id: a.id }).note.pinned, null);
    handlers.unpin({ id: a.id });
    assert.equal(handlers.getOne({ id: a.id }).note.pinned, null);
  });
});

test("delete moves the note to Recently Deleted; recover brings it back", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "doomed" }).note;
    handlers.delete({ id: a.id });
    assert.equal(handlers.count().count, 0);
    const deleted = handlers.listDeleted().notes;
    assert.equal(deleted.length, 1);
    assert.ok(deleted[0].deletedAt > 0);

    handlers.recoverNote({ id: a.id });
    assert.equal(handlers.count().count, 1);
    assert.equal(handlers.listDeleted().notes.length, 0);
  });
});

test("deleteAll only touches active notes; the trash keeps them", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    handlers.create({ text: "one" });
    handlers.create({ text: "two" });
    handlers.deleteAll();
    assert.equal(handlers.count().count, 0);
    assert.equal(handlers.listDeleted().notes.length, 2);
  });
});

test("permanentlyDelete removes the row; emptyTrash clears the bin", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "one" }).note;
    const b = handlers.create({ text: "two" }).note;
    handlers.delete({ id: a.id });
    handlers.delete({ id: b.id });
    handlers.permanentlyDelete({ id: a.id });
    assert.deepEqual(handlers.listDeleted().notes.map((note) => note.id), [b.id]);
    handlers.emptyTrash();
    assert.equal(handlers.listDeleted().notes.length, 0);
    assert.equal(handlers.getOne({ id: a.id }).note, null);
  });
});

test("purgeOldDeletedNotes drops only notes older than 60 days", () => {
  withRoot((root) => {
    let clock = 1_000_000;
    const { handlers } = makeNotes(root, { clock: () => clock });
    const old = handlers.create({ text: "old" }).note;
    const fresh = handlers.create({ text: "fresh" }).note;
    handlers.delete({ id: old.id });
    clock += 61 * 24 * 60 * 60 * 1000;
    handlers.delete({ id: fresh.id });

    const { purged } = handlers.purgeOldDeletedNotes();
    assert.equal(purged, 1);
    assert.deepEqual(handlers.listDeleted().notes.map((note) => note.id), [fresh.id]);
  });
});

test("getWindowData returns the recency neighbours and the pinned id list; setCurrentNote sticks", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "a" }).note;
    const b = handlers.create({ text: "b" }).note;
    handlers.pin({ id: a.id });

    let window = handlers.getWindowData({});
    assert.equal(window.currentNote.id, b.id, "the most recent note is current");
    assert.equal(window.previousNoteId, null);
    assert.equal(window.nextNoteId, a.id);
    assert.deepEqual(window.pinnedShortcutNoteIds, [a.id]);

    handlers.setCurrentNote({ id: a.id });
    window = handlers.getWindowData({});
    assert.equal(window.currentNote.id, a.id);
    assert.equal(window.previousNoteId, b.id, "older notes are 'previous' in recency order");
    assert.equal(window.nextNoteId, null);

    window = handlers.getWindowData({ noteId: b.id });
    assert.equal(window.currentNote.id, b.id);
    assert.equal(handlers.getPreferences().currentNoteId, b.id, "the pointer follows an explicit noteId");
  });
});

test("touchAccessed bumps accessed_at without touching updated_at", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    const a = handlers.create({ text: "a" }).note;
    handlers.touchAccessed({ id: a.id });
    const reread = handlers.getOne({ id: a.id }).note;
    assert.ok(reread.accessedAt > a.accessedAt);
    assert.equal(reread.updatedAt, a.updatedAt);
  });
});

test("bootstrap creates the onboarding note exactly once; purge runs at startup", () => {
  withRoot((root) => {
    const first = makeNotes(root);
    first.bootstrap();
    assert.equal(first.handlers.count().count, 1);
    assert.equal(first.handlers.list().notes[0].title, "Welcome to Raycast Notes");
    first.close();

    const second = makeNotes(root);
    second.bootstrap();
    assert.equal(second.handlers.count().count, 1, "the flag survives restarts");
    second.close();

    const settings = JSON.parse(fs.readFileSync(path.join(root, "notes-settings.json"), "utf-8"));
    assert.equal(settings.onboarded, true);
  });
});

test("preferences validate zoom range and escape behavior", () => {
  withRoot((root) => {
    const { handlers } = makeNotes(root);
    assert.throws(() => handlers.setPreference({ key: "zoom", value: 3 }), /between 0.75 and 2/);
    assert.throws(() => handlers.setPreference({ key: "escapeKeyBehavior", value: "explode" }), /Invalid escape key behavior/);
    assert.throws(() => handlers.setPreference({ key: "nope", value: 1 }), /Unknown note preference/);

    handlers.setPreference({ key: "zoom", value: 1.25 });
    handlers.setPreference({ key: "escapeKeyBehavior", value: "losesFocus" });
    handlers.setPreference({ key: "windowAutoSizing", value: false });
    const prefs = handlers.getPreferences();
    assert.equal(prefs.zoom, 1.25);
    assert.equal(prefs.escapeKeyBehavior, "losesFocus");
    assert.equal(prefs.windowAutoSizing, false);
    assert.equal(prefs.showMenuBarToggle, false, "the confirmed macOS-only row stays off in the clone");
  });
});

test("every mutation pushes notes.updated to the frontend", () => {
  withRoot((root) => {
    const pushed = [];
    const { handlers } = makeNotes(root, { pushed });
    const a = handlers.create({ text: "a" }).note;
    handlers.update({ id: a.id, text: "b" });
    handlers.pin({ id: a.id });
    handlers.delete({ id: a.id });
    handlers.recoverNote({ id: a.id });
    handlers.emptyTrash();
    const methods = pushed.map(([method]) => method);
    for (const method of ["notes.updated", "notes.updated", "notes.updated", "notes.updated"]) {
      assert.ok(methods.includes(method));
    }
    assert.equal(methods.length, 6, "create, update, pin, delete, recover and emptyTrash all notify");
  });
});

// ---- markdown conversions -------------------------------------------------------------------

test("markdownToHtml covers the confirmed node set", () => {
  const html = markdownToHtml(
    [
      "# Heading 1",
      "###### Heading 6",
      "",
      "Plain paragraph with **bold**, *italic*, ~~strike~~, <u>underline</u>, `code`,",
      "a [link](https://example.com) and a hard break.",
      "",
      "> quoted line",
      "",
      "```ts",
      "const x = 1 < 2 && 3 > 2;",
      "```",
      "",
      "---",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] open task",
      "- [x] done task",
    ].join("\n"),
  );
  assert.ok(html.includes("<h1>Heading 1</h1>"), html);
  assert.ok(html.includes("<h6>Heading 6</h6>"), html);
  assert.ok(html.includes("<strong>bold</strong>"), html);
  assert.ok(html.includes("<em>italic</em>"), html);
  assert.ok(html.includes("<s>strike</s>"), html);
  assert.ok(html.includes("<u>underline</u>"), html);
  assert.ok(html.includes("<code>code</code>"), html);
  assert.ok(html.includes('<a href="https://example.com">link</a>'), html);
  assert.ok(html.includes("<br>"), html);
  assert.ok(html.includes("<blockquote><p>quoted line</p></blockquote>"), html);
  assert.ok(html.includes('<pre><code class="language-ts">const x = 1 &lt; 2 &amp;&amp; 3 &gt; 2;</code></pre>'), html);
  assert.ok(html.includes("<hr>"), html);
  assert.ok(html.includes("<ul><li><p>bullet one</p></li><li><p>bullet two</p></li></ul>"), html);
  assert.ok(html.includes('<ol start="1"><li><p>first</p></li><li><p>second</p></li></ol>'), html);
  assert.ok(html.includes('<ul data-type="taskList"><li data-checked="false"><p>open task</p></li><li data-checked="true"><p>done task</p></li></ul>'), html);
});

test("markdownToHtml escapes HTML so notes cannot inject markup", () => {
  const html = markdownToHtml("<script>alert(1)</script> & <b>bold</b>");
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
  assert.ok(html.includes("&amp;"), html);
});

test("toPlainText strips markup but keeps list structure", () => {
  const plain = toPlainText(
    ["# Title", "", "- **bold item**", "1. [link](https://example.com)", "- [x] done", "", "```", "keep me", "```"].join("\n"),
  );
  assert.ok(plain.includes("Title"), plain);
  assert.ok(plain.includes("- bold item"), plain);
  assert.ok(plain.includes("1. link"), plain);
  assert.ok(plain.includes("- [x] done"), plain);
  assert.ok(plain.includes("keep me"), plain);
  assert.ok(!plain.includes("**"), plain);
  assert.ok(!plain.includes("https://"), plain);
});

test("deriveTitle: first non-empty line, heading marker stripped, empty falls back", () => {
  assert.equal(deriveTitle("first\nsecond"), "first");
  assert.equal(deriveTitle("\n \n# Real Title\nbody"), "Real Title");
  assert.equal(deriveTitle(""), "Untitled");
  assert.equal(deriveTitle(null), "Untitled");
});

test("htmlToMarkdown inverts markdownToHtml for the confirmed node set", () => {
  const markdown = [
    "# Heading",
    "",
    "Paragraph with **bold**, *italic*, ~~strike~~, <u>underline</u>, `code` and a [link](https://example.com).",
    "",
    "> quoted",
    "",
    "- bullet",
    "",
    "1. first",
    "",
    "- [x] done",
    "- [ ] open",
    "",
    "---",
    "",
    "```ts",
    "const x = 1;",
    "```",
  ].join("\n");
  const html = markdownToHtml(markdown);
  const roundTripped = htmlToMarkdown(html);
  assert.equal(roundTripped, markdown, `got:\n${roundTripped}`);
});

test("htmlToMarkdown parses the browser's contentEditable output (b/i, nested inline)", () => {
  const text = htmlToMarkdown(
    "<h1>Title</h1><p>mixing <strong>bold and <em>italic</em></strong> plus <b>bold</b> <i>italic</i></p>",
  );
  assert.equal(text, "# Title\n\nmixing **bold and *italic*** plus **bold** *italic*");
});

test("htmlToMarkdown keeps task states and list starts", () => {
  const text = htmlToMarkdown(
    '<ul data-type="taskList"><li data-checked="true"><p>done</p></li><li data-checked="false"><p>todo</p></li></ul>',
  );
  assert.equal(text, "- [x] done\n- [ ] todo");
  assert.equal(htmlToMarkdown('<ol start="3"><li>third</li></ol>'), "3. third");
});
