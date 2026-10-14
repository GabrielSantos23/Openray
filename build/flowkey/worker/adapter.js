// FlowKey UiTree -> RaycastMini `ray-*` render model adapter.
//
// The renderer consumes `{ kind: "commandView", navigationStack: { body } }` models (see
// build/api/src/runtime/model.ts types). FlowKey trees carry their own vocabulary; this module is
// the only place the two meet, and flowkey-adapter.test.mjs pins every tree kind.
//
// Known unexpressible-in-renderer features (reported, not silently dropped — see
// flowkey-adapter.test.mjs "documented adapter gaps"):
//   * `iconSvg` -> data URI maps across but the frontend `Icon` only <img>s URLs ending in an
//     image extension, so inline SVG falls back to the generic icon until the renderer learns
//     data URIs.
//   * `iconColor` has no ray item-icon field (accessory colors do map).
//   * Emoji icons (`icon: "🚀"`) and `DetailTree.imageUri` / `UiPane.previewImageUri` have no
//     ray model counterpart; dropped.
//   * `DetailTree.mediaKeys` / `subtitle` are dropped (media controls land in M5b).
//   * Action `primary` is carried as an extra field; the ray renderer treats `actions[0]` as
//     primary, so FlowKey `primary: true` on a later action is not honored positionally.
"use strict";

const ACCESSORY_COLORS = {
  success: "#59d499",
  danger: "#ff6363",
  accent: "#4aa3ff",
  secondary: "rgba(255, 255, 255, 0.4)",
};

function accessoryColor(color) {
  return ACCESSORY_COLORS[color] ?? color;
}

function mapIcon(item) {
  if (item.iconName) return { source: { light: `icon://${item.iconName}.png` } };
  if (item.iconSvg) {
    return { source: { light: `data:image/svg+xml;base64,${Buffer.from(item.iconSvg).toString("base64")}` } };
  }
  if (item.iconUri) return { source: { light: item.iconUri } };
  if (typeof item.icon === "string" && /^(https?:|data:|file:)|\.(png|jpe?g|gif|svg|webp|ico)$/i.test(item.icon)) {
    return { source: { light: item.icon } };
  }
  return undefined;
}

function filterAccessory(filter) {
  return filter?.options?.length
    ? { sections: [{ items: filter.options.map((option) => ({ id: option.value, title: option.label })) }] }
    : undefined;
}

function mapActions(actions) {
  return (actions ?? []).map((action) => ({
    id: action.id,
    title: action.title ?? "Action",
    shortcut: action.shortcut ? [action.shortcut.modifiers ?? [], action.shortcut.key].flat().join("+") : undefined,
    style: action.style,
    primary: action.primary ? "primary" : undefined,
  }));
}

function mapMetadataFields(fields) {
  return (fields ?? []).map((field) => {
    if (field.kind === "link") {
      return { kind: "Link", title: field.label, text: field.value, target: field.href ?? "" };
    }
    if (field.kind === "tags") {
      return { kind: "TagList", title: field.label, items: (field.tags ?? []).map((tag) => ({ text: tag })) };
    }
    if (field.kind === "separator") {
      return { kind: "Separator" };
    }
    return { kind: "Label", title: field.label, text: field.value };
  });
}

function mapItem(item) {
  const mapped = {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    icon: mapIcon(item),
    keywords: item.keywords?.length ? item.keywords : undefined,
    accessories: item.accessories?.length
      ? item.accessories.map((accessory) => ({
          text: accessory.text,
          color: accessoryColor(accessory.color),
          tooltip: accessory.tooltip,
        }))
      : undefined,
    actions: mapActions(item.actions),
  };
  if (item.pane) {
    mapped.detail = {
      markdown: item.pane.preview,
      metadata: item.pane.fields?.length ? mapMetadataFields(item.pane.fields) : undefined,
    };
  }
  return mapped;
}

function mapFormFields(fields) {
  return (fields ?? []).map((field) => {
    const base = { id: field.id, title: field.label, info: field.placeholder, placeholder: field.placeholder };
    switch (field.kind) {
      case "password":
        return { ...base, kind: "TextField", isSecure: true, defaultValue: { value: field.default ?? null } };
      case "textarea":
        return { ...base, kind: "TextArea", defaultValue: { value: field.default ?? null } };
      case "checkbox":
        return { ...base, kind: "Checkbox", checkboxTitle: field.label, defaultValue: { value: Boolean(field.default) } };
      case "dropdown":
        return {
          ...base,
          kind: "Dropdown",
          defaultValue: { value: field.default ?? null },
          menu: { sections: [{ items: (field.options ?? []).map((option) => ({ id: option.value, title: option.title })) }] },
        };
      case "datepicker":
        return { ...base, kind: "DatePicker" };
      case "tagpicker":
        return {
          ...base,
          kind: "TagPicker",
          suggestionValues: (field.options ?? []).map((option) => ({ title: option.title, value: option.value })),
          defaultValue: { value: field.defaults ?? null },
        };
      case "filepicker":
        return {
          ...base,
          kind: "FilePicker",
          canChooseFiles: field.canChooseFiles ?? true,
          canChooseDirectories: field.canChooseDirectories ?? false,
          allowMultipleSelection: field.allowMultipleSelection ?? false,
        };
      case "description":
        return { ...base, kind: "Description", text: field.label };
      case "separator":
        return { ...base, kind: "Separator" };
      default:
        return { ...base, kind: "TextField", defaultValue: { value: field.default ?? null } };
    }
  });
}

function toBody(tree) {
  if (tree.type === "detail") {
    return {
      kind: "Detail",
      navigationTitle: tree.title,
      markdown: tree.description,
      metadata: mapMetadataFields(tree.fields),
      actions: mapActions(tree.actions),
    };
  }
  if (tree.type === "grid") {
    const sections = tree.sections?.length
      ? tree.sections.map((section) => ({ title: section.title, subtitle: section.subtitle, items: (section.items ?? []).map(mapItem) }))
      : (tree.items ?? []).length
        ? [{ items: (tree.items ?? []).map(mapItem) }]
        : [];
    return {
      kind: "Grid",
      columns: tree.columns ?? 5,
      sections,
      isLoading: tree.isLoading,
      searchBarPlaceholder: tree.searchBarPlaceholder,
      searchBarAccessory: filterAccessory(tree.filter),
      emptyView: tree.emptyView,
      actions: mapActions(tree.actions),
    };
  }
  if (tree.type === "form") {
    const actions = mapActions(tree.actions);
    if (tree.submitActionId && !actions.some((action) => action.id === tree.submitActionId)) {
      actions.push({ id: tree.submitActionId, title: "Submit", type: "submit-form", primary: "primary" });
    }
    return {
      kind: "Form",
      navigationTitle: tree.title,
      fields: mapFormFields(tree.fields),
      actions,
    };
  }
  // list
  return {
    kind: "List",
    isLoading: tree.isLoading,
    searchBarPlaceholder: tree.searchBarPlaceholder,
    searchBarAccessory: filterAccessory(tree.filter),
    sections: (tree.sections ?? []).map((section) => ({
      title: section.title,
      subtitle: section.subtitle,
      items: (section.items ?? []).map(mapItem),
    })),
    emptyView: tree.emptyView,
    pagination: tree.pagination
      ? { pageSize: tree.pagination.pageSize ?? 100, hasMore: tree.pagination.hasNextPage, onLoadMore: tree.pagination.moreActionId }
      : undefined,
    actions: mapActions(tree.actions),
  };
}

/**
 * UiTree -> `{ kind: "commandView", navigationStack }`. `action` is "new" for the first render of
 * a command and "idle" afterwards (the renderer updates the top page in place).
 */
function uiTreeToRenderModel(tree, { firstRender }) {
  const body = toBody(tree);
  const stack = {
    kind: "navigationStack",
    id: "navigationStack",
    body,
    navigationInfo: { id: firstRender ? "flowkey" : null, action: firstRender ? "new" : "idle" },
    actions: body.actions,
  };
  return { kind: "commandView", navigationStack: stack, actions: body.actions };
}

module.exports = { uiTreeToRenderModel, mapActions, mapMetadataFields };
