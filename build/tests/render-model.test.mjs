// Render model tests — `api/src/runtime/model.ts` converts shadow trees into the wire model.
// Verified shapes follow the RE spec (docs/command-ux-spec.md §2/§5/§6/§7): form field kinds,
// detail metadata kinds, grid section overrides, list accessories/keywords/detail, dropdown menus,
// empty views, search-bar dropdown, pagination and the navigation stack envelope.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "api", "src", "runtime", "model.ts");

const { build } = await import(
  pathToFileURL(path.join(root, "api", "node_modules", "esbuild", "lib", "main.js")).href
);
const result = await build({
  entryPoints: [source],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["./reconciler"],
  logLevel: "silent",
});
const module = { exports: {} };
const factory = new Function("module", "exports", "require", result.outputFiles[0].text);
factory(module, module.exports, () => ({}));
const { toModel } = module.exports;

// Shadow-node helpers (the same `{name, props, childElements}` the reconciler produces).
function node(name, props = {}, children = []) {
  return { name, props, childElements: children };
}
function rootModel(children, navigationInfo = { id: "n1", action: "new" }) {
  return { name: "__root__", props: {}, childElements: children, navigationInfo };
}

// 1. List with sections, accessories, keywords and an item detail.
const listItem = node("ray-list-item", {
  id: "row-1",
  title: "Row",
  subtitle: "Sub",
  keywords: ["kw"],
  accessories: [{ text: "left", tag: "live", color: "#59d499" }],
  actions: undefined,
}, [
  node("ray-action-panel", {}, [node("ray-action-default", { title: "Do", callbackId: "cb_1" })]),
  node("ray-list-item-detail", { markdown: "# Detail" }, [
    node("ray-metadata", {}, [
      node("ray-metadata-label", { title: "Row", text: "1" }),
      node("ray-metadata-link", { title: "Open", target: "https://x" }),
    ]),
  ]),
]);
const listSection = node("ray-list-section", { title: "Group" }, [listItem]);
const listModel = toModel(
  rootModel([
    node("ray-navigation-stack", { onPopCallbackId: "cb_pop" }, [
      node("ray-list", { navigationTitle: "L", isShowingDetail: true }, [listSection]),
    ]),
  ]),
);
const listBody = listModel.navigationStack.body;
assert.equal(listBody.kind, "List");
assert.equal(listModel.navigationStack.onPop, "cb_pop", "onPop callback id rides on the stack");
assert.equal(listBody.isShowingDetail, true);
assert.equal(listBody.sections[0].title, "Group");
const row = listBody.sections[0].items[0];
assert.equal(row.id, "row-1");
assert.deepEqual(row.keywords, ["kw"]);
assert.deepEqual(row.accessories, [{ text: "left", tag: "live", color: "#59d499" }]);
assert.equal(row.actions[0].id, "cb_1", "item action carries the callback id");
assert.equal(row.detail.markdown, "# Detail");
assert.deepEqual(row.detail.metadata, [
  { kind: "Label", id: undefined, title: "Row", text: "1", icon: undefined },
  { kind: "Link", id: undefined, title: "Open", text: undefined, target: "https://x" },
]);

// 2. Grid with per-section overrides and an empty view.
const gridModel = toModel(
  rootModel([
    node("ray-navigation-stack", {}, [
      node(
        "ray-grid",
        { columns: 6, inset: "zero", aspectRatio: "1" },
        [
          node("ray-grid-section", { title: "Colors", columns: 4, aspectRatio: "16/9", fit: "fill", inset: "sm" }, [
            node("ray-grid-item", { id: "g1", title: "Tile" }, [
              node("ray-action-panel", {}, [node("ray-action-copy-to-clipboard", { title: "Copy", callbackId: "cb_2" })]),
            ]),
          ]),
          node("ray-empty-view", { title: "None", description: "Try again" }),
        ],
      ),
    ]),
  ]),
);
const gridBody = gridModel.navigationStack.body;
assert.equal(gridBody.kind, "Grid");
assert.equal(gridBody.columns, 6);
assert.equal(gridBody.sections[0].columns, 4, "section override wins");
assert.equal(gridBody.sections[0].aspectRatio, "16/9");
assert.equal(gridBody.sections[0].fit, "fill");
assert.equal(gridBody.sections[0].inset, "sm");
assert.deepEqual(gridBody.emptyView, { title: "None", description: "Try again", icon: undefined, actions: [] });

// 3. Form fields convert to the renderer's kind switch.
const formModel = toModel(
  rootModel([
    node("ray-navigation-stack", {}, [
      node("ray-form", { enableDrafts: true }, [
        node("ray-form-textfield", { id: "name", title: "Name", error: "Required", onChange: "cb_on" }),
        node("ray-form-passwordfield", { id: "pw", title: "Password", defaultValue: "s3cret" }),
        node("ray-form-textarea", { id: "notes", enableMarkdown: true }),
        node("ray-form-checkbox", { id: "agree", label: "I agree" }),
        node("ray-form-dropdown", { id: "tier" }, [
          node("ray-menu-section", { title: "Plans" }, [
            node("ray-menu-item", { id: "pro", title: "Pro" }),
          ]),
        ]),
        node("ray-form-tagpicker", { id: "tags" }, [
          node("ray-form-tagpicker-item", { title: "Rust", value: "rust" }),
        ]),
        node("ray-form-datepicker", { id: "when", type: "datetime", min: new Date("2026-01-01T00:00:00Z") }),
        node("ray-form-filepicker", { id: "file", canChooseFiles: true, allowMultipleSelection: true }),
        node("ray-form-separator", {}),
        node("ray-form-description", { text: "Everything above" }),
      ]),
    ]),
  ]),
);
const formBody = formModel.navigationStack.body;
assert.equal(formBody.kind, "Form");
assert.equal(formBody.enableDrafts, true);
const kinds = formBody.fields.map((field) => `${field.kind}:${field.id}`);
assert.deepEqual(kinds, [
  "TextField:name",
  "TextField:pw",
  "TextArea:notes",
  "Checkbox:agree",
  "Dropdown:tier",
  "TagPicker:tags",
  "DatePicker:when",
  "FilePicker:file",
  "Separator:",
  "Description:",
]);
assert.equal(formBody.fields[0].error, "Required");
assert.equal(formBody.fields[0].onChange, "cb_on");
assert.equal(formBody.fields[1].isSecure, true, "password field serialises as TextField+isSecure");
assert.equal(formBody.fields[2].enableMarkdown, true);
assert.equal(formBody.fields[3].checkboxTitle, "I agree");
assert.deepEqual(formBody.fields[4].menu.sections[0].items, [{ id: "pro", title: "Pro", icon: undefined }]);
assert.deepEqual(formBody.fields[5].suggestionValues, [{ title: "Rust", value: "rust", icon: undefined }]);
assert.equal(formBody.fields[6].type, "datetime");
assert.equal(formBody.fields[6].min, "2026-01-01T00:00:00.000Z", "date bounds ISO-encode");
assert.equal(formBody.fields[7].allowMultipleSelection, true);
assert.equal(formBody.fields[9].text, "Everything above");

// 4. Detail with markdown + metadata.
const detailModel = toModel(
  rootModel([
    node("ray-navigation-stack", {}, [
      node("ray-detail", { markdown: "# Hi" }, [
        node("ray-metadata", {}, [
          node("ray-metadata-taglist", { title: "Tags" }, [
            node("ray-metadata-taglist-item", { text: "alpha", color: "#ff6363", onAction: "cb_tag" }),
          ]),
          node("ray-metadata-separator", {}),
        ]),
      ]),
    ]),
  ]),
);
const detailBody = detailModel.navigationStack.body;
assert.equal(detailBody.kind, "Detail");
assert.equal(detailBody.markdown, "# Hi");
assert.deepEqual(detailBody.metadata[0], {
  kind: "TagList",
  id: undefined,
  title: "Tags",
  items: [{ text: "alpha", icon: undefined, color: "#ff6363", onAction: "cb_tag" }],
});
assert.deepEqual(detailBody.metadata[1], { kind: "Separator", id: undefined });

// 5. Search-bar dropdown + pagination on a List.
const pagedList = toModel(
  rootModel([
    node("ray-navigation-stack", {}, [
      node("ray-list", { throttle: true }, [
        node("ray-search-bar-dropdown", { tooltip: "Kinds", defaultValue: "all", onChange: "cb_dd" }, [
          node("ray-menu-section", { title: "Kinds" }, [node("ray-menu-item", { id: "all", title: "All" })]),
        ]),
        node("ray-list-item", { id: "x1", title: "X" }),
      ]),
    ]),
  ]),
);
const pagedBody = pagedList.navigationStack.body;
assert.deepEqual(pagedBody.searchBarAccessory.sections[0].items, [{ id: "all", title: "All", icon: undefined }]);
assert.equal(pagedBody.searchBarAccessory.onChange, "cb_dd");
assert.equal(pagedBody.throttle, true);

console.log("render-model.test.mjs: 5 groups passed");
