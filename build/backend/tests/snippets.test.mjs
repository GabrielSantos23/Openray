// The Snippets store (`snippets.*` handlers): confirmed limits and error strings, keyword
// uniqueness, pin ordering, import/export contracts, placeholder resolution, and the host
// registration/config pushes. Host calls are recorded, never executed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSnippets } = require("../src/snippets.js");

let cleanupQueue = [];

function makeSnippets(directory, { dispatched = [], pushed = [], clipboard = [] } = {}) {
  const snippets = createSnippets({
    dataRoot: directory,
    dispatch: (method, data) => {
      dispatched.push([method, data]);
      return Promise.resolve({ ok: true });
    },
    pushToFrontend: (method, data) => {
      pushed.push([method, data]);
      return Promise.resolve(undefined);
    },
    clipboardTextAt: (offset) => clipboard[offset] ?? null,
  });
  cleanupQueue.push(() => snippets.close());
  return snippets;
}

function withRoot(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snippets-"));
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

test("create enforces the confirmed limits and error strings", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    assert.throws(() => handlers.create({ title: "", text: "x" }), /Name cannot be empty/);
    assert.throws(() => handlers.create({ title: "X", text: "   " }), /Snippet cannot be empty/);
    assert.throws(
      () => handlers.create({ title: "X", text: "a".repeat(70000) }),
      /Snippet length limit exceeded\. The current limit is 65,536 characters/,
    );
    assert.throws(
      () => handlers.create({ title: "X", text: "ok", keyword: "a".repeat(31) }),
      /Keyword is too long\. The maximum length is 30 characters/,
    );
  });
});

test("create, list and update keep the confirmed field set and timestamps", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    const created = handlers.create({ title: "Email", text: "john@example.com", keyword: ";em", tags: ["mail"] });
    assert.ok(created.id);
    const listed = handlers.list().snippets;
    assert.equal(listed.length, 1);
    assert.deepEqual(
      { ...listed[0], id: "...", accessedAt: 0, createdAt: 0, updatedAt: 0 },
      {
        id: "...",
        title: "Email",
        keyword: ";em",
        text: "john@example.com",
        tags: ["mail"],
        pinned: null,
        copyCount: 0,
        accessedAt: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    );

    const before = handlers.getOne({ id: created.id }).snippet.updatedAt;
    handlers.update({ id: created.id, text: "john.doe@example.com" });
    const updated = handlers.getOne({ id: created.id }).snippet;
    assert.equal(updated.text, "john.doe@example.com");
    assert.equal(updated.title, "Email");
    assert.ok(updated.updatedAt >= before);

    assert.throws(() => handlers.update({ id: "missing", text: "x" }), /Snippet not found/);
  });
});

test("keywords are unique case-insensitively; a snippet may keep its own keyword", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    const first = handlers.create({ title: "Email", text: "a@b.c", keyword: ";em" });
    assert.throws(() => handlers.create({ title: "Other", text: "x", keyword: ";EM" }), /This keyword is already in use/);
    assert.equal(handlers.isKeywordAvailable({ keyword: ";em" }).available, false);
    assert.equal(handlers.isKeywordAvailable({ keyword: ";em", excludeId: first.id }).available, true);
    handlers.update({ id: first.id, keyword: ";em", text: "changed" });
    handlers.update({ id: first.id, keyword: ";mail" });
    assert.equal(handlers.isKeywordAvailable({ keyword: ";em" }).available, true);
  });
});

test("every mutation re-registers the keyword set with the host; deletes also remove", () => {
  withRoot((root) => {
    const dispatched = [];
    const { handlers } = makeSnippets(root, { dispatched });
    const first = handlers.create({ title: "Email", text: "a@b.c", keyword: ";em" });
    handlers.create({ title: "Plain", text: "no keyword" });
    let register = dispatched.filter(([method]) => method === "snippets.register").pop();
    assert.deepEqual(register[1].snippetIds, [first.id]);
    assert.deepEqual(register[1].keywords, [";em"]);

    handlers.delete({ id: first.id });
    register = dispatched.filter(([method]) => method === "snippets.register").pop();
    assert.deepEqual(register[1].keywords, []);
    const removed = dispatched.filter(([method]) => method === "snippets.remove").pop();
    assert.deepEqual(removed[1].snippetIds, [first.id]);

    handlers.deleteAll();
    const after = handlers.list().snippets;
    assert.equal(after.length, 0);
  });
});

test("registration suppresses duplicate and empty keywords (possible through import)", () => {
  withRoot((root) => {
    const dispatched = [];
    const { handlers } = makeSnippets(root, { dispatched });
    handlers.importEntries({
      entries: [
        { name: "One", text: "one", keyword: ";em" },
        { name: "Two", text: "two", keyword: ";em" },
        { name: "Three", text: "three", keyword: "  " },
      ],
    });
    const register = dispatched.filter(([method]) => method === "snippets.register").pop();
    assert.equal(register[1].snippetIds.length, 1);
    assert.deepEqual(register[1].keywords, [";em"]);
  });
});

test("pin puts the newest pin first; unpin and movePinned reorder", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    const a = handlers.create({ title: "A", text: "a" });
    const b = handlers.create({ title: "B", text: "b" });
    const c = handlers.create({ title: "C", text: "c" });
    handlers.pin({ id: b.id });
    handlers.pin({ id: a.id });
    let titles = handlers.list().snippets.map((snippet) => snippet.title);
    assert.deepEqual(titles, ["A", "B", "C"]);
    handlers.movePinnedDown({ id: a.id });
    titles = handlers.list().snippets.map((snippet) => snippet.title);
    assert.deepEqual(titles, ["B", "A", "C"]);
    handlers.movePinnedUp({ id: a.id });
    handlers.unpin({ id: b.id });
    titles = handlers.list().snippets.map((snippet) => snippet.title);
    assert.deepEqual(titles, ["A", "C", "B"]);
    assert.equal(handlers.list().snippets[2].pinned, null);
    assert.ok(c.id && a.id);
  });
});

test("accessedAt and copyCount track use", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    const created = handlers.create({ title: "A", text: "a" });
    const before = handlers.getOne({ id: created.id }).snippet;
    handlers.updateAccessedAt({ id: created.id });
    const accessed = handlers.getOne({ id: created.id }).snippet;
    assert.ok(accessed.accessedAt > before.accessedAt);
    assert.equal(accessed.copyCount, 0);

    handlers.updateCopyCount({ id: created.id });
    handlers.updateCopyCount({ id: created.id });
    const copied = handlers.getOne({ id: created.id }).snippet;
    assert.equal(copied.copyCount, 2);
    assert.ok(copied.accessedAt >= accessed.accessedAt);
  });
});

test("resolve runs the shared engine: clipboard offset, nested snippets and the cursor", () => {
  withRoot((root) => {
    const clipboard = ["latest", "older"];
    const { handlers } = makeSnippets(root, { clipboard });
    const nested = handlers.create({ title: "Sig", text: "-- John" });
    const created = handlers.create({
      title: "Reply",
      text: "From {clipboard}: {snippet id=\"" + nested.id + "\"}\nToday is {date format=\"yyyy-MM-dd\"}{cursor}!",
    });
    const resolved = handlers.resolve({ snippetId: created.id });
    assert.ok(resolved.text.startsWith("From latest: -- John"));
    assert.match(resolved.text, /Today is \d{4}-\d{2}-\d{2}!/);
    assert.equal(resolved.cursor, resolved.text.length - 1);
    assert.throws(() => handlers.resolve({ snippetId: "missing" }), /Snippet not found/);

    const offset = handlers.resolve({ text: "{clipboard offset=1}|{clipboard}" });
    assert.equal(offset.text, "older|latest");
  });
});

test("import accepts the confirmed shapes, maps alias and dedupes on title + keyword + text", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    const first = handlers.importEntries({
      entries: [
        { name: "Email", text: "a@b.c", keyword: ";em" },
        { name: "Sig", text: "-- John", alias: "sig" },
      ],
    });
    assert.deepEqual(first, { added: 2, skipped: 0 });
    const tags = handlers.getTags().tags;
    assert.deepEqual(tags, []);
    const listed = handlers.list().snippets;
    assert.equal(listed.find((snippet) => snippet.title === "Sig").keyword, "sig");

    const duplicate = handlers.importEntries({
      entries: [
        { name: "Email", text: "a@b.c", keyword: ";em" },
        { name: "Changed", text: "a@b.c", keyword: ";em" },
      ],
    });
    assert.deepEqual(duplicate, { added: 1, skipped: 1 });

    const empty = handlers.importEntries({ entries: [{ name: "", text: "x" }] });
    assert.deepEqual(empty, { added: 0, skipped: 0 });
    assert.equal(handlers.list().snippets.length, 3);
  });
});

test("exportAll emits the confirmed bare-array shape", () => {
  withRoot((root) => {
    const { handlers } = makeSnippets(root);
    handlers.create({ title: "Email", text: "a@b.c", keyword: ";em", tags: ["mail"] });
    handlers.create({ title: "Plain", text: "no keyword" });
    const exported = handlers.exportAll();
    assert.ok(Array.isArray(exported));
    // Unpinned rows list newest-accessed first, so "Plain" (created last) leads.
    assert.deepEqual(exported, [
      { name: "Plain", text: "no keyword" },
      { name: "Email", text: "a@b.c", keyword: ";em", tags: ["mail"] },
    ]);
  });
});

test("preferences validate keys and values and push the expansion config to the host", () => {
  withRoot((root) => {
    const dispatched = [];
    const { handlers } = makeSnippets(root, { dispatched });
    assert.deepEqual(handlers.getPreferences(), {
      autoExpansionEnabled: true,
      expansionMode: "immediately",
      expandWithinWords: false,
      injectionDelay: "none",
      responseTime: "default",
      completionSound: "none",
      disabledApplications: [],
    });
    assert.throws(() => handlers.setPreference({ key: "unknown", value: true }), /Unknown snippet preference/);
    assert.throws(() => handlers.setPreference({ key: "expansionMode", value: "sometimes" }), /Invalid expansion mode/);
    assert.throws(() => handlers.setPreference({ key: "completionSound", value: "dolphin" }), /Invalid completion sound/);

    handlers.setPreference({ key: "expansionMode", value: "after-delimiter-keeping" });
    handlers.setPreference({ key: "autoExpansionEnabled", value: "yes" });
    handlers.setPreference({ key: "disabledApplications", value: ["notepad.exe", "notepad.exe", ""] });
    const config = dispatched.filter(([method]) => method === "snippets.setConfig").pop();
    assert.equal(config[1].expansionMode, "after-delimiter-keeping");
    assert.equal(config[1].autoExpansionEnabled, false);
    assert.deepEqual(config[1].disabledApplications, ["notepad.exe"]);

    handlers.setPreference({ key: "autoExpansionEnabled", value: true });
    const restarted = makeSnippets(root, { dispatched: [] });
    assert.equal(restarted.handlers.getPreferences().autoExpansionEnabled, true);
    assert.equal(restarted.handlers.getPreferences().expansionMode, "after-delimiter-keeping");
  });
});
