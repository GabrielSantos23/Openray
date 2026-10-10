// Shadow tree -> serialisable model, and model -> model diff. This is `rd` / `iP` / `hee` / `AP`
// from `api/node_modules/@raycast/api/index.js`.
//
//   function rd(e){ … return { kind:"commandView", navigationStack, actions, suspended } }
//   function iP(e){ … return { navigationStack, actions } }
//   function hee(e){ switch(e.name){ case "ray-list": … case "ray-grid": …
//                      case "ray-form": … case "ray-detail": … case "ray-menu-bar-extra": … } }
//
// and the result is shipped as `JSON.stringify({ model, changes })` under `T("render", …)`.
//
// The shapes below mirror Raycast's wire model (see docs/command-ux-spec.md §2/§5/§6/§7):
// List items carry accessories/keywords/detail, Grid sections carry per-section
// columns/aspectRatio/fit/inset, Form fields use the `kind` strings the renderer switches on, and
// Detail metadata uses `Label | Link | TagList | Separator`.

import type { ShadowNode, ShadowRoot } from "./reconciler";

export type ViewKind = "List" | "Grid" | "Detail" | "Form" | "MenuBarExtra";

export interface ViewAction {
  id: string;
  title: string;
  shortcut?: string;
  style?: string;
  type?: string;
  itemId?: string;
}

export interface Accessory {
  icon?: unknown;
  text?: string;
  tag?: string | number;
  date?: number | string;
  color?: string;
  tooltip?: string;
}

export interface ItemDetail {
  isLoading?: boolean;
  markdown?: string;
  metadata?: MetadataItem[];
}

export type MetadataItem =
  | { kind: "Label"; id?: string; title: string; text?: string; icon?: unknown }
  | { kind: "Link"; id?: string; title: string; text?: string; target: string }
  | { kind: "TagList"; id?: string; title: string; items: { text?: string; icon?: unknown; color?: string; onAction?: string }[] }
  | { kind: "Separator"; id?: string };

export interface ViewListItem {
  id: string;
  title?: string;
  subtitle?: string;
  keywords?: string[];
  icon?: unknown;
  accessories?: Accessory[];
  quickLook?: unknown;
  detail?: ItemDetail;
  actions: ViewAction[];
}

export interface ViewSection {
  id?: string;
  title?: string;
  subtitle?: string;
  items: ViewListItem[];
  /** Grid sections only */
  columns?: number;
  aspectRatio?: string;
  fit?: string;
  inset?: string;
}

export interface Pagination {
  pageSize: number;
  hasMore: boolean;
  onLoadMore?: string;
}

export type FormFieldValue = string | boolean | string[] | number | null;

export interface ViewFormField {
  kind:
    | "TextField"
    | "TextArea"
    | "Checkbox"
    | "Dropdown"
    | "TagPicker"
    | "DatePicker"
    | "FilePicker"
    | "Separator"
    | "Description";
  id: string;
  title?: string;
  info?: string;
  error?: string;
  autoFocus?: boolean;
  placeholder?: string;
  value?: { value?: FormFieldValue };
  defaultValue?: { value?: FormFieldValue };
  storeValue?: boolean;
  onChange?: string;
  onBlur?: string;
  onFocus?: string;
  // TextField
  isSecure?: boolean;
  // TextArea
  enableMarkdown?: boolean;
  // Checkbox
  checkboxTitle?: string;
  // Dropdown
  menu?: { sections: { id?: string; title?: string; items: { id: string; title?: string; icon?: unknown }[] }[] };
  filteringEnabled?: boolean;
  keepSectionOrder?: boolean;
  onSearchTextChange?: string;
  isLoading?: boolean;
  // TagPicker
  suggestionValues?: { title?: string; value: string; icon?: unknown }[];
  onCreate?: string;
  // DatePicker
  type?: "date" | "datetime";
  min?: string;
  max?: string;
  // FilePicker
  canChooseFiles?: boolean;
  canChooseDirectories?: boolean;
  allowMultipleSelection?: boolean;
  showHiddenFiles?: boolean;
  // Description
  text?: string;
}

export interface ViewBody {
  kind: ViewKind;
  id?: string;
  navigationTitle?: string;
  isLoading?: boolean;
  filtering?: boolean;
  filteringEnabled?: boolean;
  keepSectionOrder?: boolean;
  throttle?: boolean;
  searchBarPlaceholder?: string;
  searchBarAccessory?: { text?: string; target?: string } | { tooltip?: string; value?: string; defaultValue?: string; onChange?: string; sections?: { title?: string; items: { id: string; title?: string }[] }[] };
  // List
  items?: ViewListItem[];
  sections?: ViewSection[];
  selectedItemId?: { value: string; eventCount?: number };
  onSelectionChange?: string;
  isShowingDetail?: boolean;
  pagination?: Pagination;
  emptyView?: { title?: string; description?: string; icon?: unknown; actions?: ViewAction[] };
  // Grid
  columns?: number;
  itemSize?: string;
  aspectRatio?: string;
  fit?: string;
  inset?: string;
  // Detail
  markdown?: string;
  metadata?: MetadataItem[];
  // Form
  fields?: ViewFormField[];
  enableDrafts?: boolean;
  // MenuBarExtra
  title?: string;
  icon?: unknown;
}

export interface RenderModel {
  kind: "commandView";
  suspended?: boolean;
  navigationStack?: {
    kind: "navigationStack";
    id: string;
    body: ViewBody | null;
    navigationInfo: { id: string | null; action: string };
    onPop?: string;
    /** synthetic, produced here for convenience */
    actions?: ViewAction[];
  };
  actions?: ViewAction[];
}

interface Diff {
  hasChanges: boolean;
  changes: { path: string[]; op: "set" | "remove"; value?: unknown }[];
}

const BODY_BY_HOST_NAME: Record<string, ViewKind> = {
  "ray-list": "List",
  "ray-grid": "Grid",
  "ray-form": "Form",
  "ray-detail": "Detail",
  "ray-menu-bar-extra": "MenuBarExtra",
};

const FORM_KIND_BY_HOST_NAME: Record<string, ViewFormField["kind"]> = {
  "ray-form-textfield": "TextField",
  "ray-form-passwordfield": "TextField",
  "ray-form-textarea": "TextArea",
  "ray-form-checkbox": "Checkbox",
  "ray-form-dropdown": "Dropdown",
  "ray-form-tagpicker": "TagPicker",
  "ray-form-datepicker": "DatePicker",
  "ray-form-filepicker": "FilePicker",
  "ray-form-separator": "Separator",
  "ray-form-description": "Description",
};

function actionTable(node: ShadowNode): ViewAction[] {
  const panel = node.childElements.find((c) => c.name === "ray-action-panel");
  if (!panel) return [];
  return panel.childElements
    .filter((c) => c.name.startsWith("ray-action"))
    .map((action, index) => {
      const props = action.props as Record<string, any>;
      const callbackId = props.callbackId as string | undefined;
      return {
        id: callbackId ?? `action_${index}`,
        title: String(props.title ?? props.name ?? "Action"),
        shortcut: props.shortcut as string | undefined,
        style: props.style as string | undefined,
        type: (props.type as string | undefined) ?? "default",
        itemId: (node.props as any).id as string | undefined,
      };
    });
}

function dropdownMenu(node: ShadowNode): ViewFormField["menu"] {
  const sections = node.childElements
    .filter((c) => c.name === "ray-menu-section" || c.name === "ray-form-dropdown-section")
    .map((section) => ({
      id: String((section.props as any).id ?? (section.props as any).title ?? ""),
      title: (section.props as any).title,
      items: section.childElements
        .filter((item) => item.name === "ray-menu-item" || item.name === "ray-form-dropdown-item")
        .map((item) => ({
          id: String((item.props as any).id ?? (item.props as any).value ?? ""),
          title: (item.props as any).title,
          icon: (item.props as any).icon,
        })),
    }));
  return { sections };
}

function toField(node: ShadowNode): ViewFormField {
  const props = node.props as Record<string, any>;
  const kind = FORM_KIND_BY_HOST_NAME[node.name] ?? "TextField";
  const field: ViewFormField = {
    kind,
    id: String(props.id ?? ""),
    title: props.title ?? props.label,
    info: props.info,
    error: props.error,
    autoFocus: props.autoFocus,
    placeholder: props.placeholder,
    value: props.value !== undefined ? { value: props.value } : undefined,
    defaultValue: props.defaultValue !== undefined ? { value: props.defaultValue } : undefined,
    storeValue: props.storeValue,
    onChange: props.onChange as string | undefined,
    onBlur: props.onBlur as string | undefined,
    onFocus: props.onFocus as string | undefined,
  };
  if (kind === "TextField") field.isSecure = node.name === "ray-form-passwordfield" || props.isSecure === true;
  if (kind === "TextArea") field.enableMarkdown = props.enableMarkdown === true;
  if (kind === "Checkbox") field.checkboxTitle = props.label;
  if (kind === "Dropdown") {
    field.menu = dropdownMenu(node);
    field.filteringEnabled = props.filteringEnabled;
    field.keepSectionOrder = props.keepSectionOrder;
    field.onSearchTextChange = props.onSearchTextChange as string | undefined;
    field.isLoading = props.isLoading;
  }
  if (kind === "TagPicker") {
    field.suggestionValues = node.childElements
      .filter((c) => c.name === "ray-form-tagpicker-item")
      .map((item) => ({
        title: (item.props as any).title,
        value: String((item.props as any).value ?? ""),
        icon: (item.props as any).icon,
      }));
    field.onCreate = props.onCreate as string | undefined;
  }
  if (kind === "DatePicker") {
    field.type = props.type === "datetime" ? "datetime" : "date";
    field.min = props.min instanceof Date ? props.min.toISOString() : props.min;
    field.max = props.max instanceof Date ? props.max.toISOString() : props.max;
    if (props.value instanceof Date) field.value = { value: props.value.toISOString() };
    if (props.defaultValue instanceof Date) field.defaultValue = { value: props.defaultValue.toISOString() };
  }
  if (kind === "FilePicker") {
    field.canChooseFiles = props.canChooseFiles;
    field.canChooseDirectories = props.canChooseDirectories;
    field.allowMultipleSelection = props.allowMultipleSelection;
    field.showHiddenFiles = props.showHiddenFiles;
  }
  if (kind === "Description") field.text = props.text;
  return field;
}

function toMetadata(node: ShadowNode): MetadataItem[] {
  return node.childElements.map((child) => {
    const props = child.props as Record<string, any>;
    switch (child.name) {
      case "ray-metadata-link":
        return { kind: "Link", id: props.id, title: props.title, text: props.text, target: props.target };
      case "ray-metadata-taglist":
        return {
          kind: "TagList",
          id: props.id,
          title: props.title,
          items: child.childElements
            .filter((tag) => tag.name === "ray-metadata-taglist-item")
            .map((tag) => {
              const tagProps = tag.props as Record<string, any>;
              return {
                text: tagProps.text,
                icon: tagProps.icon,
                color: tagProps.color,
                onAction: tagProps.onAction as string | undefined,
              };
            }),
        };
      case "ray-metadata-separator":
        return { kind: "Separator", id: props.id };
      case "ray-metadata-label":
      default:
        return { kind: "Label", id: props.id, title: props.title, text: props.text, icon: props.icon };
    }
  });
}

function toListItem(node: ShadowNode): ViewListItem {
  const props = node.props as Record<string, any>;
  const detailNode = node.childElements.find((c) => c.name === "ray-list-item-detail");
  return {
    id: String(props.id ?? props.key ?? ""),
    title: props.title,
    subtitle: props.subtitle,
    keywords: props.keywords,
    icon: props.icon,
    accessories: props.accessories,
    quickLook: props.quickLook,
    detail: detailNode
      ? {
          isLoading: (detailNode.props as any).isLoading,
          markdown: (detailNode.props as any).markdown,
          metadata: detailNode.childElements
            .filter((c) => c.name === "ray-metadata")
            .flatMap((metadata) => toMetadata(metadata)),
        }
      : undefined,
    actions: actionTable(node),
  };
}

function toSection(node: ShadowNode): ViewSection {
  const props = node.props as Record<string, any>;
  return {
    id: props.id ? String(props.id) : undefined,
    title: props.title,
    subtitle: props.subtitle,
    columns: props.columns,
    aspectRatio: props.aspectRatio,
    fit: props.fit,
    inset: props.inset,
    items: node.childElements
      .filter((child) => child.name === "ray-list-item" || child.name === "ray-grid-item")
      .map(toListItem),
  };
}

function toBody(node: ShadowNode): ViewBody {
  const kind = BODY_BY_HOST_NAME[node.name] ?? "List";
  const props = node.props as Record<string, any>;
  const body: ViewBody = {
    kind,
    id: props.id ? String(props.id) : undefined,
    navigationTitle: props.navigationTitle,
    isLoading: props.isLoading,
    filtering: props.filtering,
    filteringEnabled: props.filteringEnabled,
    keepSectionOrder: props.keepSectionOrder,
    throttle: props.throttle,
    searchBarPlaceholder: props.searchBarPlaceholder,
    selectedItemId:
      props.selectedItemId && typeof props.selectedItemId === "object"
        ? { value: String(props.selectedItemId.value ?? ""), eventCount: props.selectedItemId.eventCount }
        : props.selectedItemId !== undefined
          ? { value: String(props.selectedItemId) }
          : undefined,
    onSelectionChange: props.onSelectionChange as string | undefined,
    isShowingDetail: props.isShowingDetail,
    pagination: props.pagination
      ? {
          pageSize: Number(props.pagination.pageSize ?? 100),
          hasMore: Boolean(props.pagination.hasMore),
          onLoadMore: props.pagination.onLoadMore as string | undefined,
        }
      : undefined,
    emptyView: props.emptyView,
    columns: props.columns,
    itemSize: props.itemSize,
    aspectRatio: props.aspectRatio,
    fit: props.fit,
    inset: props.inset,
    enableDrafts: props.enableDrafts,
  };

  if (kind === "List" || kind === "Grid") {
    const sections = node.childElements.filter(
      (c) => c.name === "ray-list-section" || c.name === "ray-grid-section",
    );
    if (sections.length > 0) {
      body.sections = sections.map(toSection);
    } else {
      body.items = node.childElements
        .filter((child) => child.name === "ray-list-item" || child.name === "ray-grid-item")
        .map(toListItem);
    }
    const emptyView = node.childElements.find((c) => c.name === "ray-empty-view");
    if (emptyView) {
      body.emptyView = {
        title: (emptyView.props as any).title,
        description: (emptyView.props as any).description,
        icon: (emptyView.props as any).icon,
        actions: actionTable(emptyView),
      };
    }
    const accessory = node.childElements.find((c) => c.name === "ray-search-bar-dropdown");
    if (accessory) {
      body.searchBarAccessory = {
        tooltip: (accessory.props as any).tooltip,
        value: (accessory.props as any).value,
        defaultValue: (accessory.props as any).defaultValue,
        onChange: (accessory.props as any).onChange as string | undefined,
        sections: dropdownMenu(accessory)?.sections,
      };
    }
  } else if (kind === "Detail") {
    body.markdown = props.markdown;
    const metadata = node.childElements.find((c) => c.name === "ray-metadata");
    if (metadata) body.metadata = toMetadata(metadata);
  } else if (kind === "Form") {
    body.fields = node.childElements
      .filter((c) => c.name.startsWith("ray-form-"))
      .map(toField);
  } else if (kind === "MenuBarExtra") {
    body.title = props.title;
    body.icon = props.icon;
    body.items = node.childElements
      .filter((c) => c.name === "ray-menu-bar-extra-item")
      .map((child) => {
        const item = toListItem(child);
        return { ...item, id: item.id || String((child.props as any).id ?? "") };
      });
  }
  return body;
}

/** Shadow root -> model. `rd(e)` in Raycast. */
export function toModel(root: ShadowRoot): RenderModel {
  if (root.childElements.length === 0) return { kind: "commandView", suspended: true };

  const model: RenderModel = { kind: "commandView" };

  for (const child of root.childElements) {
    if (child.name === "ray-navigation-stack") {
      const top = child.childElements[child.childElements.length - 1];
      const body: ViewBody | null = top ? toBody(top) : null;
      const stack = {
        kind: "navigationStack" as const,
        id: "navigationStack",
        body,
        // The stack element's own prop is the source of truth (InternalNavigationRoot passes
        // `navigationInfo: state.lastNavigationInfo`); the shadow-root field is only the
        // imperative fallback (render.ts's setNavigationInfo).
        navigationInfo: ((child.props as any)?.navigationInfo ?? root.navigationInfo) as {
          id: string | null;
          action: string;
        },
        onPop: (child.props as any).onPopCallbackId as string | undefined,
        actions: body?.actions,
      };
      model.navigationStack = stack;
      if (stack.actions) model.actions = stack.actions;
    } else if (child.name === "ray-top-level-suspense") {
      model.suspended = true;
    } else if (child.name === "ray-menu-bar-extra") {
      // A MenuBarExtra at the root is rendered straight into the status item by the host.
      const body = toBody(child);
      model.navigationStack = {
        kind: "navigationStack",
        id: "navigationStack",
        body,
        navigationInfo: { id: null, action: "idle" },
        actions: body.actions,
      };
      model.actions = body.actions;
    }
  }
  return model;
}

/** Minimal JSON-path diff used to build `changes`. `AP(prev, next)` in Raycast. */
export function diffModels(previous: RenderModel | null, next: RenderModel): Diff {
  const changes: Diff["changes"] = [];
  const flat: Record<string, unknown> = {};
  flatten(previous ?? {}, [], flat);
  const nextFlat: Record<string, unknown> = {};
  flatten(next, [], nextFlat);

  for (const [path, value] of Object.entries(nextFlat)) {
    if (!(path in flat) || JSON.stringify(flat[path]) !== JSON.stringify(value)) {
      changes.push({ path: path.split("/"), op: "set", value });
    }
  }
  for (const path of Object.keys(flat)) {
    if (!(path in nextFlat)) changes.push({ path: path.split("/"), op: "remove" });
  }
  return { hasChanges: changes.length > 0, changes };
}

function flatten(value: unknown, path: string[], out: Record<string, unknown>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[path.join("/")] = [];
      return;
    }
    value.forEach((entry, index) => flatten(entry, [...path, String(index)], out));
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out[path.join("/")] = {};
      return;
    }
    for (const [key, entry] of entries) flatten(entry, [...path, key], out);
    return;
  }
  out[path.join("/")] = value;
}
