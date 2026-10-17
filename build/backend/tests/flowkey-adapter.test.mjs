// A2 (docs/flowkey-migration-plan.md M1): the UiTree -> ray-* adapter is pinned for EVERY tree
// kind the FlowKey library can emit — list (sections, accessories, keywords, item pane, filter
// dropdown, pagination, empty view), detail (markdown + metadata field variants), grid (sections,
// flat items, columns, filter) and form (every field kind + the synthesized submit action) — plus
// the render-model envelope (navigationStack, navigationInfo new/idle) and the documented gaps
// where the ray renderer cannot express a FlowKey feature.
//
// The first block renders REAL FlowKey components through the REAL ReactRoot (vendored library,
// React 19 reconciler) and adapts the committed tree; the later blocks feed hand-built trees that
// match native-sdk types.ts exactly for shapes the JSX surface does not reach. The library is
// bundled with esbuild first (same aliases the worker build uses) so module instances match the
// runtime the worker ships.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const FLOWKEY = path.resolve(here, "..", "..", "flowkey");
const vendorRequire = createRequire(path.join(FLOWKEY, "vendor", "package.json"));

// Bundle { ReactRoot + components + adapter } once per run into a temp file; `lib` exposes the
// module instances the tests drive.
const tmpBundle = fs.mkdtempSync(path.join(os.tmpdir(), "flowkey-adapter-"));
await vendorRequire("esbuild").build({
  entryPoints: [path.join(here, "fixtures", "flowkey", "adapter-test-entry.mjs")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: path.join(tmpBundle, "adapter-test-bundle.cjs"),
  nodePaths: [path.join(FLOWKEY, "vendor", "node_modules")],
  alias: {
    "@flowkey-mini/react-ui": path.join(FLOWKEY, "react-ui", "src", "index.ts"),
    "@flowkey-mini/native-sdk": path.join(FLOWKEY, "native-sdk", "src", "index.ts"),
  },
  logLevel: "silent",
});
const lib = require(path.join(tmpBundle, "adapter-test-bundle.cjs"));
const { h, uiTreeToRenderModel } = lib;

// Render a component through the real reconciler; returns the last committed generation.
function renderComponent(element) {
  const generations = [];
  const root = new lib.ReactRoot(() => element, {
    onCommit: (tree, json, registry) => generations.push({ tree, registry }),
    onError: (error) => {
      throw error;
    },
  });
  root.update({});
  root.flushEffects();
  assert.ok(generations.length > 0, "component committed at least once");
  const { tree, registry } = generations[generations.length - 1];
  return { tree, registry, model: uiTreeToRenderModel(tree, { firstRender: true }), root };
}

test("list tree: sections, keywords, accessories (semantic colors), actions round trip through the real library", () => {
  const { tree, model, registry } = renderComponent(
    h(
      lib.List,
      { searchBarPlaceholder: "Search…" },
      h(
        lib.List.Section,
        { title: "First" },
        h(lib.List.Item, {
          id: "a1",
          title: "Alpha",
          subtitle: "the alpha",
          keywords: ["first", "one"],
          accessories: [{ text: "ok", color: "success", tooltip: "all good" }, { text: "pending", color: "secondary" }],
          actions: h(
            lib.ActionPanel,
            null,
            h(lib.Action, { title: "Do it", onAction: () => {}, shortcut: { modifiers: ["ctrl"], key: "d" } }, null),
          ),
        }),
      ),
      h(
        lib.List.Section,
        { title: "Second" },
        h(lib.List.Item, { id: "a2", title: "Beta" }),
      ),
      h(lib.List.EmptyView, { title: "Nothing here", description: "try again" }),
    ),
  );
  assert.equal(tree.type, "list");

  assert.equal(model.kind, "commandView");
  assert.equal(model.navigationStack.kind, "navigationStack");
  assert.equal(model.navigationStack.navigationInfo.action, "new");
  const body = model.navigationStack.body;
  assert.equal(body.kind, "List");
  assert.equal(body.searchBarPlaceholder, "Search…");
  assert.equal(body.sections.length, 2);
  assert.equal(body.sections[0].title, "First");

  const alpha = body.sections[0].items[0];
  assert.deepEqual(
    { id: alpha.id, title: alpha.title, subtitle: alpha.subtitle, keywords: alpha.keywords },
    { id: "a1", title: "Alpha", subtitle: "the alpha", keywords: ["first", "one"] },
  );
  assert.deepEqual(alpha.accessories, [
    { text: "ok", color: "#59d499", tooltip: "all good" },
    { text: "pending", color: "rgba(255, 255, 255, 0.4)", tooltip: undefined },
  ]);
  assert.equal(alpha.actions.length, 1);
  assert.equal(alpha.actions[0].title, "Do it");
  assert.equal(alpha.actions[0].shortcut, "ctrl+d");

  // The registry issued the real `fka<n>` id the renderer will call back with.
  assert.match(alpha.actions[0].id, /^fka\d+$/);
  assert.ok(registry.resolve(alpha.actions[0].id), "registry resolves the rendered action id");

  assert.deepEqual(body.emptyView, { title: "Nothing here", description: "try again" });
});

test("list item side pane becomes detail markdown + metadata (pane fields are label/value pairs)", () => {
  const { tree, model } = renderComponent(
    h(
      lib.List,
      null,
      h(
        lib.List.Item,
        { id: "p1", title: "With pane" },
        h(
          lib.List.Item.Detail,
          { preview: "# Hello\nworld" },
          h(
            lib.List.Item.Detail.Metadata,
            null,
            h(lib.List.Item.Detail.Metadata.Field, { label: "Kind", value: "plain" }),
            h(lib.List.Item.Detail.Metadata.Field, { label: "Repo", value: "flowkey-launcher" }),
          ),
        ),
      ),
    ),
  );
  assert.equal(tree.type, "list");
  const item = model.navigationStack.body.sections[0].items[0];
  assert.equal(item.detail.markdown, "# Hello\nworld");
  assert.deepEqual(item.detail.metadata[0], { kind: "Label", title: "Kind", text: "plain" });
  assert.deepEqual(item.detail.metadata[1], { kind: "Label", title: "Repo", text: "flowkey-launcher" });
});

test("list filter dropdown maps to searchBarAccessory dropdown sections; pagination maps to pageSize/hasMore/onLoadMore", () => {
  const loadMore = () => {};
  const { tree, model } = renderComponent(
    h(
      lib.List,
      {
        filter: [{ label: "All", value: "all" }, { label: "Done", value: "done" }],
        pagination: { hasNextPage: true, onLoadMore: loadMore, pageSize: 25 },
      },
      h(lib.List.Item, { id: "i1", title: "One" }),
    ),
  );
  assert.equal(tree.type, "list");
  const body = model.navigationStack.body;
  assert.deepEqual(body.searchBarAccessory, {
    sections: [{ items: [{ id: "all", title: "All" }, { id: "done", title: "Done" }] }],
  });
  assert.equal(body.pagination.pageSize, 25);
  assert.equal(body.pagination.hasMore, true);
  // onLoadMore is the registry id of the load-more callback — the renderer invokes it exactly
  // like any action (CommandSession: `createCallback(body.pagination.onLoadMore)({})`).
  assert.match(body.pagination.onLoadMore, /^fka\d+$/);
});

test("second render of the same root flips navigationInfo to idle (top page updates in place)", () => {
  const generations = [];
  const root = new lib.ReactRoot(() => h(lib.List, null, h(lib.List.Item, { id: "x", title: "X" })), {
    onCommit: (tree) => generations.push(tree),
    onError: (error) => {
      throw error;
    },
  });
  root.update({});
  root.update({});
  assert.equal(generations.length, 2);
  const first = uiTreeToRenderModel(generations[0], { firstRender: true });
  const second = uiTreeToRenderModel(generations[1], { firstRender: false });
  assert.equal(first.navigationStack.navigationInfo.action, "new");
  assert.equal(second.navigationStack.navigationInfo.action, "idle");
  assert.equal(second.navigationStack.navigationInfo.id, null);
  root.unmount();
});

test("detail tree: markdown, metadata variants (label/link/tags/separator), actions and navigationTitle", () => {
  const { tree, model } = renderComponent(
    h(
      lib.Detail,
      {
        title: "Detail Title",
        markdown: "body **text**",
        actions: h(lib.ActionPanel, null, h(lib.Action, { title: "Copy", onAction: () => {}, style: "destructive" }, null)),
      },
      h(
        lib.Detail.Metadata,
        null,
        h(lib.Detail.Metadata.Field, { label: "Owner", value: "gabriel" }),
        h(lib.Detail.Metadata.Field, { label: "Link", value: "example", href: "https://example.com" }),
        h(lib.Detail.Metadata.Field, { label: "Chips", kind: "tags", tags: ["a"] }),
        h(lib.Detail.Metadata.Field, { label: "", kind: "separator" }),
      ),
    ),
  );
  assert.equal(tree.type, "detail");
  const body = model.navigationStack.body;
  assert.equal(body.kind, "Detail");
  assert.equal(body.navigationTitle, "Detail Title");
  assert.equal(body.markdown, "body **text**");
  assert.deepEqual(body.metadata.map((entry) => entry.kind), ["Label", "Link", "TagList", "Separator"]);
  assert.deepEqual(body.metadata[1], { kind: "Link", title: "Link", text: "example", target: "https://example.com" });
  assert.deepEqual(body.metadata[2], { kind: "TagList", title: "Chips", items: [{ text: "a" }] });
  assert.equal(body.actions[0].title, "Copy");
  assert.equal(body.actions[0].style, "destructive");
});

test("grid tree: sections, flat items, columns, filter accessory", () => {
  const { tree: fromSections, model: sectionModel } = renderComponent(
    h(
      lib.Grid,
      { columns: 4, filter: [{ label: "Everything", value: "all" }] },
      h(
        lib.Grid.Section,
        { title: "Row one" },
        h(lib.Grid.Item, { id: "g1", title: "Gamma", subtitle: "grid item" }),
        h(lib.Grid.Item, { id: "g2", title: "Delta" }),
      ),
    ),
  );
  assert.equal(fromSections.type, "grid");
  const gridBody = sectionModel.navigationStack.body;
  assert.equal(gridBody.kind, "Grid");
  assert.equal(gridBody.columns, 4);
  assert.equal(gridBody.sections[0].title, "Row one");
  assert.equal(gridBody.sections[0].items.length, 2);
  assert.deepEqual(gridBody.searchBarAccessory, {
    sections: [{ items: [{ id: "all", title: "Everything" }] }],
  });

  const { tree: fromItems, model: itemModel } = renderComponent(
    h(lib.Grid, { columns: 5 }, h(lib.Grid.Item, { id: "solo", title: "Solo" })),
  );
  assert.equal(fromItems.type, "grid");
  const flatBody = itemModel.navigationStack.body;
  assert.equal(flatBody.sections.length, 1);
  assert.equal(flatBody.sections[0].title, undefined);
  assert.equal(flatBody.sections[0].items[0].id, "solo");
});

test("svgl-era additions: ActionPanel.Section groups ride on actions; uriDark pairs map to light/dark icon sources", () => {
  const { model } = renderComponent(
    h(
      lib.Grid,
      { columns: 6 },
      h(
        lib.Grid.Item,
        {
          id: "logo",
          title: "Logo",
          icon: { uri: "https://svgl.app/library/x.svg", uriDark: "https://svgl.app/library/x_dark.svg" },
          actions: h(
            lib.ActionPanel,
            null,
            h(
              lib.ActionPanel.Section,
              { title: "Copy SVG" },
              h(lib.Action, { title: "Copy SVG Text", onAction: () => undefined }),
            ),
            h(lib.Action, { title: "Ungrouped", onAction: () => undefined }),
          ),
        },
      ),
    ),
  );
  const item = model.navigationStack.body.sections[0].items[0];
  assert.deepEqual(item.icon.source, {
    light: "https://svgl.app/library/x.svg",
    dark: "https://svgl.app/library/x_dark.svg",
  });
  const groups = item.actions.map((action) => action.group);
  assert.deepEqual(groups, ["Copy SVG", undefined]);
});

test("form tree: every field kind maps to the ray form vocabulary; onSubmit synthesizes the submit-form action", () => {
  const { tree, model } = renderComponent(
    h(
      lib.Form,
      {
        title: "Form Title",
        onSubmit: () => {},
        actions: h(lib.ActionPanel, null),
      },
      h(lib.Form.TextField, { id: "name", label: "Name", placeholder: "type", default: "Ada" }),
      h(lib.Form.PasswordField, { id: "secret", label: "Secret" }),
      h(lib.Form.TextArea, { id: "notes", label: "Notes" }),
      h(lib.Form.Checkbox, { id: "enable", label: "Enable", default: true }),
      h(lib.Form.Dropdown, { id: "flavor", label: "Flavor", default: "v", options: [{ value: "v", title: "Vanilla" }] }),
      h(lib.Form.DatePicker, { id: "when", label: "When" }),
      h(lib.Form.TagPicker, { id: "tags", label: "Tags", defaults: ["x"], options: [{ value: "x", title: "X" }] }),
      h(lib.Form.FilePicker, { id: "file", label: "File", allowMultipleSelection: true, canChooseDirectories: true }),
      h(lib.Form.Description, { label: "Hint text" }),
      h(lib.Form.Separator, null),
    ),
  );
  assert.equal(tree.type, "form");
  const body = model.navigationStack.body;
  assert.equal(body.kind, "Form");
  assert.equal(body.navigationTitle, "Form Title");
  const byId = Object.fromEntries(body.fields.map((field) => [field.id, field]));
  assert.equal(byId.name.kind, "TextField");
  assert.equal(byId.name.defaultValue.value, "Ada");
  assert.equal(byId.name.placeholder, "type");
  assert.equal(byId.secret.kind, "TextField");
  assert.equal(byId.secret.isSecure, true);
  assert.equal(byId.notes.kind, "TextArea");
  assert.equal(byId.enable.kind, "Checkbox");
  assert.equal(byId.enable.defaultValue.value, true);
  assert.equal(byId.enable.checkboxTitle, "Enable");
  assert.equal(byId.flavor.kind, "Dropdown");
  assert.deepEqual(byId.flavor.menu.sections[0].items, [{ id: "v", title: "Vanilla" }]);
  assert.equal(byId.when.kind, "DatePicker");
  assert.equal(byId.tags.kind, "TagPicker");
  assert.deepEqual(byId.tags.suggestionValues, [{ title: "X", value: "x" }]);
  assert.deepEqual(byId.tags.defaultValue.value, ["x"]);
  assert.equal(byId.file.kind, "FilePicker");
  assert.equal(byId.file.canChooseDirectories, true);
  assert.equal(byId.file.allowMultipleSelection, true);
  // Description and Separator both serialize with an empty id — assert by kind.
  const description = body.fields.find((field) => field.kind === "Description");
  const separator = body.fields.find((field) => field.kind === "Separator");
  assert.equal(description.text, "Hint text");
  assert.ok(separator);

  // onSubmit registers a `fka<n>` action the adapter turns into the renderer's submit-form.
  const submit = body.actions.find((action) => action.type === "submit-form");
  assert.ok(submit, "submit action synthesized");
  assert.match(submit.id, /^fka\d+$/);
  assert.equal(submit.primary, "primary");
  assert.equal(submit.title, "Submit");
});

test("documented adapter gaps: unexpressible FlowKey features survive adaptation without dropping the render", () => {
  // Hand-built tree matching native-sdk types.ts — these shapes have no ray counterpart and are
  // reported here so the gap list stays honest (adjustment 10: report, never silently drop).
  const tree = {
    type: "list",
    sections: [
      {
        items: [
          {
            id: "i",
            title: "T",
            iconSvg: '<svg viewBox="0 0 1 1"><circle cx="0.5" cy="0.5" r="0.5"/></svg>',
            iconColor: "#EF4444",
            icon: "🚀",
            pane: { preview: "md", previewImageUri: "https://example.com/x.png" },
          },
        ],
      },
    ],
  };
  const model = uiTreeToRenderModel(tree, { firstRender: true });
  const item = model.navigationStack.body.sections[0].items[0];
  // iconSvg maps to a data URI (the frontend <img>s data URIs).
  assert.match(item.icon.source.light, /^data:image\/svg\+xml;base64,/);
  // iconColor + pane previewImageUri are dropped, everything else still renders.
  assert.equal(item.title, "T");
  assert.equal(item.detail.markdown, "md");

  // A lucide icon name maps to the frontend's `icon://Name.png` convention.
  const named = uiTreeToRenderModel({ type: "list", sections: [{ items: [{ id: "n", title: "N", iconName: "star", iconColor: "#EF4444" }] }] }, { firstRender: true });
  assert.equal(named.navigationStack.body.sections[0].items[0].icon.source.light, "icon://star.png");

  // A URI icon passes through for the frontend's <img> branch.
  const urled = uiTreeToRenderModel({ type: "list", sections: [{ items: [{ id: "u", title: "U", iconUri: "https://example.com/a.png" }] }] }, { firstRender: true });
  assert.equal(urled.navigationStack.body.sections[0].items[0].icon.source.light, "https://example.com/a.png");

  // An emoji icon maps to an emoji:// URL the renderer draws as text.
  const emoji = uiTreeToRenderModel({ type: "list", sections: [{ items: [{ id: "e", title: "E", icon: "🚀" }] }] }, { firstRender: true });
  assert.equal(emoji.navigationStack.body.sections[0].items[0].icon.source.light, `emoji://${encodeURIComponent("🚀")}`);

  // Actions carry their extension-declared icons through the same mapping.
  const acted = uiTreeToRenderModel(
    { type: "list", sections: [], actions: [{ id: "a", title: "A", iconUri: "https://example.com/a.png" }] },
    { firstRender: true },
  );
  assert.equal(acted.navigationStack.body.actions[0].icon.source.light, "https://example.com/a.png");

  // Detail media fields are dropped; the artwork imageUri maps to body.image.
  const detail = uiTreeToRenderModel({ type: "detail", title: "D", fields: [], mediaKeys: true, subtitle: "sub", imageUri: "data:image/png;base64,AAA" }, { firstRender: true });
  assert.equal(detail.navigationStack.body.kind, "Detail");
  assert.equal("mediaKeys" in detail.navigationStack.body, false);
  assert.equal(detail.navigationStack.body.image, "data:image/png;base64,AAA");

  // Command pages filter server-side: the renderer must not filter the rows again.
  assert.equal(model.navigationStack.body.filtering, false);

  // Shapes the JSX surface cannot set but the tree type allows (native-sdk types.ts).
  const handBuilt = uiTreeToRenderModel(
    { type: "list", isLoading: true, sections: [{ title: "S", subtitle: "sub", items: [] }] },
    { firstRender: true },
  );
  assert.equal(handBuilt.navigationStack.body.sections[0].subtitle, "sub");
  assert.equal(handBuilt.navigationStack.body.isLoading, true);
});

test("adapter navigation: push/localPop/new nav actions carry ids, every render advertises onPop", () => {
  const tree = { type: "list", sections: [{ items: [{ id: "i", title: "T" }] }] };

  // First render of a command: action "new" with the stable root page id, plus the onPop callback
  // id the renderer's Escape path invokes.
  const first = uiTreeToRenderModel(tree, { firstRender: true, onPopId: "__pop__" });
  assert.equal(first.navigationStack.navigationInfo.action, "new");
  assert.equal(first.navigationStack.navigationInfo.id, "flowkey");
  assert.equal(first.navigationStack.onPop, "__pop__");

  // Later commits update the top page in place (idle, no id).
  const idle = uiTreeToRenderModel(tree, { firstRender: false, onPopId: "__pop__" });
  assert.equal(idle.navigationStack.navigationInfo.action, "idle");
  assert.equal(idle.navigationStack.navigationInfo.id, null);

  // A subview push carries the worker-generated page id; the local-pop reply echoes the
  // renderer's pop id so the top page updates in place instead of pushing again.
  const pushed = uiTreeToRenderModel(tree, { firstRender: false, navAction: "push", navId: "flowkey-push-1", onPopId: "__pop__" });
  assert.equal(pushed.navigationStack.navigationInfo.action, "push");
  assert.equal(pushed.navigationStack.navigationInfo.id, "flowkey-push-1");
  const localPop = uiTreeToRenderModel(tree, { firstRender: false, navAction: "localPop", navId: "pop42", onPopId: "__pop__" });
  assert.equal(localPop.navigationStack.navigationInfo.action, "localPop");
  assert.equal(localPop.navigationStack.navigationInfo.id, "pop42");

  // Without an explicit onPop id the field serializes away (direct adapter callers, tests).
  const bare = uiTreeToRenderModel(tree, { firstRender: true });
  assert.equal(bare.navigationStack.onPop, undefined);
});
