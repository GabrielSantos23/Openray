// Navigation stack tests — `commandPages.ts` mirrors Raycast's renderer-side page stack
// (`z.mainRouter.context.nodeExtensionStack` + the `NQ` render switch). Verified behaviors:
// push/new append, pop drops and updates the new top, localPop/idle update in place, filter text
// and selection are restored from the page record, popToRoot keeps only the root.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "frontend", "src", "commandPages.ts");

const { build } = await import(
  pathToFileURL(path.join(root, "api", "node_modules", "esbuild", "lib", "main.js")).href
);
const result = await build({
  entryPoints: [source],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["./useExtensionCommand"],
  logLevel: "silent",
});
const module = { exports: {} };
const factory = new Function("module", "exports", "require", result.outputFiles[0].text);
factory(module, module.exports, () => ({}));

const {
  emptyPages,
  applyRender,
  popPage,
  popToRootPages,
  topPage,
  updateTop,
} = module.exports;

function render(action, id, title, extra = {}) {
  return {
    kind: "commandView",
    navigationStack: {
      kind: "navigationStack",
      id: "navigationStack",
      navigationInfo: { action, id },
      body: { kind: "List", navigationTitle: title, ...extra },
      actions: [{ id: "a1", title: "Root action" }],
    },
  };
}

// 1. `new` creates the root page.
let pages = applyRender(emptyPages(), render("new", "n1", "Root"));
assert.equal(pages.pages.length, 1, "new creates one page");
assert.equal(topPage(pages).body.navigationTitle, "Root");
assert.equal(topPage(pages).searchText, "");

// 2. `push` appends and keeps the root.
pages = applyRender(pages, render("push", "n2", "Detail"));
assert.equal(pages.pages.length, 2);
assert.equal(topPage(pages).body.navigationTitle, "Detail");
assert.equal(pages.pages[0].body.navigationTitle, "Root", "root page retained");

// 3. Per-page search text and selection survive a pop (restoration contract): typing happens on
// the root page, a detail page is pushed and popped, and the root's state comes back.
let restorable = applyRender(emptyPages(), render("new", "n1", "Root"));
restorable = updateTop(restorable, { searchText: "query", selectedItemId: "item-7" });
restorable = applyRender(restorable, render("push", "n2b", "Detail"));
assert.equal(topPage(restorable).searchText, "", "the pushed page starts with its own empty state");
const pop = popPage(restorable, "pop1");
assert.equal(pop.popped, true, "popPage pops when more than one page");
restorable = applyRender(pop.state, render("pop", "n3", "Root"));
assert.equal(restorable.pages.length, 1);
assert.equal(topPage(restorable).body.navigationTitle, "Root", "extension re-rendered the root");
assert.equal(topPage(restorable).searchText, "query", "search text restored on pop");
assert.equal(topPage(restorable).selectedItemId, "item-7", "selection restored on pop");
pages = restorable;

// 4. `localPop` (the round trip after Escape) updates the top page in place without growing the stack.
pages = applyRender(pages, render("localPop", "pop1", "Root after escape"));
assert.equal(pages.pages.length, 1, "localPop never grows the stack");
assert.equal(topPage(pages).body.navigationTitle, "Root after escape");

// 5. `idle` updates in place.
pages = applyRender(pages, render("idle", "n4", "Root v2"));
assert.equal(pages.pages.length, 1);
assert.equal(topPage(pages).body.navigationTitle, "Root v2");
assert.equal(topPage(pages).searchText, "query", "idle keeps per-page state");

// 6. popPage at root is a no-op (nothing to pop).
const atRoot = popPage(pages, "pop2");
assert.equal(atRoot.popped, false, "cannot pop the last page");

// 7. popToRootPages keeps only the root page.
pages = applyRender(pages, render("push", "n5", "Deep"));
pages = applyRender(pages, render("push", "n6", "Deeper"));
assert.equal(pages.pages.length, 3);
const rooted = popToRootPages(pages);
assert.equal(rooted.pages.length, 1);
assert.equal(topPage(rooted).body.navigationTitle, "Root v2");

// 8. Actions ride along with each page.
const withActions = applyRender(emptyPages(), {
  kind: "commandView",
  navigationStack: {
    kind: "navigationStack",
    id: "navigationStack",
    navigationInfo: { action: "new", id: "n1" },
    body: { kind: "List" },
    actions: [{ id: "cb_1", title: "Do Thing", type: "default" }],
  },
});
assert.deepEqual(topPage(withActions).actions, [{ id: "cb_1", title: "Do Thing", type: "default" }]);

// 9. Renders without a navigation stack leave the state untouched.
const ignored = applyRender(pages, { kind: "commandView", suspended: true });
assert.equal(ignored.pages.length, pages.pages.length, "suspended render does not touch the stack");

console.log("command-pages.test.mjs: 9 checks passed");
