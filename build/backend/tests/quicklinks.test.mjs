// The Quicklinks store (`quicklinks.*` handlers) and its import/export/argument contracts.
// Runs against a real SQLite file in a temp directory; host calls are recorded, never executed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createQuicklinks } = require("../src/quicklinks.js");

let cleanupQueue = [];

function makeQuicklinks(directory, dispatched = [], pushed = []) {
  const quicklinks = createQuicklinks({
    dataRoot: directory,
    dispatch: (method, data) => {
      dispatched.push([method, data]);
      return Promise.resolve({ ok: true });
    },
    pushToFrontend: (method, data) => {
      pushed.push([method, data]);
      return Promise.resolve(undefined);
    },
  });
  cleanupQueue.push(() => quicklinks.close());
  return quicklinks;
}

function withRoot(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quicklinks-"));
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

test("save validates name and link with the confirmed error strings and lists with derived args", () => {
  withRoot((root) => {
    const { handlers } = makeQuicklinks(root);
    assert.throws(() => handlers.save({ name: "", link: "https://x.test" }), /Please enter a name/);
    assert.throws(() => handlers.save({ name: "X", link: "  " }), /Please enter a link/);
    assert.throws(
      () => handlers.save({ name: "X", link: '{argument name="A"}{argument name="B"}{argument name="C"}{argument name="D"}' }),
      /Only 3 different Arguments are allowed/,
    );

    const created = handlers.save({ name: "Search Google", link: 'https://google.com/search?q={argument name="Query"}', tags: ["search"] });
    assert.ok(created.id);

    const { quicklinks } = handlers.list();
    assert.equal(quicklinks.length, 1);
    assert.equal(quicklinks[0].name, "Search Google");
    assert.equal(quicklinks[0].pinned, null);
    assert.equal(quicklinks[0].openCount, 0);
    assert.equal(quicklinks[0].args.length, 1);
    assert.equal(quicklinks[0].args[0].required, true);
    assert.deepEqual(handlers.getTags().tags, ["search"]);
  });
});

test("update mutates only what it is given and bumps updatedAt", () => {
  withRoot((root) => {
    const { handlers } = makeQuicklinks(root);
    const { id } = handlers.save({ name: "Before", link: "https://before.test", icon: null });
    const before = handlers.getOne({ id }).quicklink;
    handlers.update({ id, name: "After", tags: ["renamed"] });

    const after = handlers.getOne({ id }).quicklink;
    assert.equal(after.name, "After");
    assert.equal(after.link, "https://before.test", "link is untouched when omitted");
    assert.deepEqual(after.tags, ["renamed"]);
    assert.ok(after.updatedAt >= before.updatedAt);
    assert.throws(() => handlers.update({ id: "nope", name: "X" }), /Quicklink not found/);
  });
});

test("pin ordering: pin appends, unpin clears, move up/down swaps neighbours", () => {
  withRoot((root) => {
    const { handlers } = makeQuicklinks(root);
    const a = handlers.save({ name: "A", link: "https://a.test" }).id;
    const b = handlers.save({ name: "B", link: "https://b.test" }).id;
    const c = handlers.save({ name: "C", link: "https://c.test" }).id;

    handlers.pin({ id: b });
    handlers.pin({ id: c });
    let order = handlers.list().quicklinks.map((entry) => entry.name);
    assert.deepEqual(order, ["C", "B", "A"], "pinned entries lead, newest pin first");

    handlers.movePinnedUp({ id: b });
    order = handlers.list().quicklinks.map((entry) => entry.name);
    assert.deepEqual(order, ["B", "C", "A"]);

    handlers.movePinnedDown({ id: b });
    order = handlers.list().quicklinks.map((entry) => entry.name);
    assert.deepEqual(order, ["C", "B", "A"]);

    handlers.movePinnedDown({ id: c });
    order = handlers.list().quicklinks.map((entry) => entry.name);
    assert.deepEqual(order, ["B", "C", "A"]);

    handlers.movePinnedDown({ id: c });
    order = handlers.list().quicklinks.map((entry) => entry.name);
    assert.deepEqual(order, ["B", "C", "A"], "moving the last pin down past the end is a no-op");

    handlers.unpin({ id: c });
    order = handlers.list().quicklinks.map((entry) => entry.name);
    assert.deepEqual(order, ["B", "A", "C"]);
  });
});

test("open resolves placeholders, opens through the host and counts opens", () => {
  withRoot((root) => {
    const dispatched = [];
    const { handlers } = makeQuicklinks(root, dispatched);
    const { id } = handlers.save({ name: "Search Google", link: 'https://google.com/search?q={argument name="Query"}' });

    handlers.open({ id, arguments: ["hello world"] });
    assert.deepEqual(dispatched[0], ["shell.openUrl", { url: "https://google.com/search?q=hello%20world" }]);
    assert.equal(handlers.getOne({ id }).quicklink.openCount, 1);

    handlers.open({ id, arguments: ["x/y"] });
    assert.equal(dispatched[1][1].url, "https://google.com/search?q=x%2Fy");
    assert.equal(handlers.getOne({ id }).quicklink.openCount, 2);

    const withApp = handlers.save({ name: "In app", link: "https://app.test", openWith: "C:/apps/app.exe" }).id;
    handlers.open({ id: withApp, arguments: [] });
    assert.deepEqual(dispatched[2], ["shell.openWith", { path: "https://app.test", app: "C:/apps/app.exe" }]);

    const alwaysEmpty = handlers.save({ name: "Empty", link: '{argument name="Never"}' }).id;
    assert.throws(() => handlers.open({ id: alwaysEmpty, arguments: [] }), /Invalid URL/);
    assert.throws(() => handlers.open({ id: "missing" }), /Quicklink not found/);
  });
});

test("resolve returns the percent-encoded link without opening anything", () => {
  withRoot((root) => {
    const dispatched = [];
    const { handlers } = makeQuicklinks(root, dispatched);
    const resolved = handlers.resolve({ link: 'https://g.test/?q={argument name="Q"}', arguments: ["a b"] });
    assert.equal(resolved.link, "https://g.test/?q=a%20b");
    assert.equal(dispatched.length, 0);
  });
});

test("import dedupes by identical link and accepts the confirmed field fallbacks", () => {
  withRoot((root) => {
    const pushed = [];
    const { handlers } = makeQuicklinks(root, [], pushed);
    handlers.save({ name: "Existing", link: "https://exists.test" });

    const result = handlers.importEntries({
      entries: [
        { name: "Existing", link: "https://exists.test" },
        { name: "From url field", url: "https://url-field.test" },
        { name: "With app", link: "https://app.test", applicationID: "C:/apps/x.exe" },
        { name: "", link: "https://dropped.test" },
        { name: "No link", link: "" },
      ],
    });
    assert.deepEqual(result, { added: 2, skipped: 1 });

    const names = Object.fromEntries(handlers.list().quicklinks.map((entry) => [entry.name, entry]));
    assert.equal(names["From url field"].link, "https://url-field.test");
    assert.equal(names["With app"].openWith, "C:/apps/x.exe");
    assert.equal(names["Dropped"], undefined);
    assert.ok(pushed.length >= 1, "mutations push quicklinks.updated");
    assert.deepEqual(pushed[0], ["quicklinks.updated", {}]);
  });
});

test("export emits the confirmed shape with icon and tags only when present", () => {
  withRoot((root) => {
    const { handlers } = makeQuicklinks(root);
    handlers.save({ name: "Plain", link: "https://plain.test" });
    handlers.save({ name: "Full", link: "https://full.test", icon: "github", tags: ["dev", "code"] });

    const exported = handlers.exportAll().quicklinks;
    assert.deepEqual(exported[0], { name: "Plain", link: "https://plain.test" });
    assert.deepEqual(exported[1], { name: "Full", link: "https://full.test", icon: "github", tags: ["dev", "code"] });
  });
});

test("delete and deleteAll remove rows and notify the renderer", () => {
  withRoot((root) => {
    const pushed = [];
    const { handlers } = makeQuicklinks(root, [], pushed);
    const a = handlers.save({ name: "A", link: "https://a.test" }).id;
    handlers.save({ name: "B", link: "https://b.test" }).id;
    handlers.delete({ id: a });
    assert.equal(handlers.list().quicklinks.length, 1);
    handlers.deleteAll();
    assert.equal(handlers.list().quicklinks.length, 0);
    assert.ok(pushed.length >= 2);
  });
});

test("preferences persist, default to the spec values and reject unknown keys", () => {
  withRoot((root) => {
    const { handlers } = makeQuicklinks(root);
    const defaults = handlers.getPreferences();
    assert.equal(defaults.passSelectedTextAsArgument, false);

    assert.equal(handlers.setPreference({ key: "passSelectedTextAsArgument", value: true }).value, true);
    assert.equal(handlers.setPreference({ key: "passSelectedTextAsArgument", value: "yes" }).value, false, "non-boolean values fall back to the default");
    handlers.setPreference({ key: "passSelectedTextAsArgument", value: true });
    assert.throws(() => handlers.setPreference({ key: "notAThing", value: 1 }), /Unknown quicklinks preference/);

    const reopened = makeQuicklinks(root).handlers.getPreferences();
    assert.equal(reopened.passSelectedTextAsArgument, true, "preferences survive a restart");
  });
});
