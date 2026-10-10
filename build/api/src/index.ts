// The extension-facing API.
//
// In Raycast this module *is* the worker entry point: `yIr = join(node_modules, "@raycast", "api",
// "index.js")` is passed to `new Worker(...)`, and the host drives it with `initialize` /
// `nativeCallback` / `terminate`. `@raycast/api` therefore behaves as a library when imported (for
// types/authoring) and as a runtime when it is the main module of the worker.

import * as React from "react";
import {
  createCommandRoot,
  renderCurrent,
} from "./runtime/render";
import { registerMethod, request, startRpc, notify } from "./runtime/rpc";
import { resolveCallback, serializeCallback } from "./runtime/reconciler";
import { InternalNavigationRoot, resetNavigation, useNavigation } from "./runtime/navigation";

export { useNavigation };

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------

const ICONS = [
  "Bird","Text","CopyClipboard","Link","Person","Trash","Star","Search","Plus","Minus","Checkmark",
  "XMark","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Gear","Window","Folder","Document","Download",
  "Upload","Eye","EyeSlash","Lock","Unlock","Globe","Cloud","Bolt","Clock","Calendar","Music","Play",
  "Pause","Stop","Forward","Rewind","VolumeHigh","VolumeLow","Mute","Camera","Image","Video","Code",
  "Terminal","Bug","Lightbulb","QuestionMark","Warning","Info","Bookmark","Tag","List","Grid","Tag2",
];

function makeIcon(name: string) {
  return { source: { light: `icon://${name}.png`, dark: `icon://${name}.png` } };
}

export const Icon = Object.fromEntries(
  ICONS.map((name) => [name, makeIcon(name)]),
) as Record<string, unknown>;

export const Color = {
  Red: "#ef4444", Orange: "#f97316", Yellow: "#eab308", Green: "#22c55e",
  Blue: "#3b82f6", Purple: "#a855f7", Pink: "#ec4899", Magenta: "#ff00ff",
  PrimaryText: "rgba(255,255,255,0.95)", SecondaryText: "rgba(255,255,255,0.55)",
  Brown: "#92400e", Gray: "#6b7280",
};

// ---------------------------------------------------------------------------------------------
// View components. Each maps 1:1 onto a `ray-*` host component that the headless reconciler knows.
// ---------------------------------------------------------------------------------------------

type ActionLike = React.ReactElement | { __isAction: true; title: string };

interface BaseProps {
  key?: React.Key;
  id?: string;
  title: string;
}

/**
 * `<ActionPanel>` + `<Action>`. Actions are serialised by callback id and invoked through
 * `nativeCallback` — functions cannot cross the worker port, so `onAction` is replaced by a
 * `callbackId` before the tree is serialised.
 */
export function ActionPanel({ children }: { children?: React.ReactNode }) {
  return React.createElement("ray-action-panel", {}, children);
}

function makeAction(kind: string) {
  return function Action(props: Record<string, unknown>) {
    const hostProps: Record<string, unknown> = { ...props };
    let onAction = hostProps.onAction as ((...args: unknown[]) => unknown) | undefined;
    delete hostProps.onAction;

    // Built-in behaviours that Raycast implements natively, expressed through the same RPCs.
    if (!onAction && (kind === "copy-to-clipboard" || kind === "paste") && "content" in hostProps) {
      const content = hostProps.content;
      onAction = () => request(kind === "paste" ? "paste" : "setClipboard", { content });
    }
    if (!onAction && (kind === "open" || kind === "open-in-browser") && ("target" in hostProps || "path" in hostProps)) {
      const target = (hostProps.target ?? hostProps.path) as string;
      onAction = () => request("open", { path: target });
    }
    if (onAction) hostProps.callbackId = serializeCallback(onAction);
    return React.createElement(`ray-action-${kind}`, hostProps);
  };
}

export const Action = Object.assign(makeAction("default"), {
  CopyToClipboard: makeAction("copy-to-clipboard"),
  Open: makeAction("open"),
  OpenInBrowser: makeAction("open-in-browser"),
  ShowInFinder: makeAction("show-in-finder"),
  Paste: makeAction("paste"),
  Style: { Regular: "Regular", Destructive: "Destructive" },
});

/**
 * `Action.Push` (`Xne` in the API bundle): pushes `target` onto the navigation stack when run.
 * The optional `onPop` fires when that page is popped (extension- or renderer-initiated).
 */
function PushAction(props: Record<string, unknown>) {
  const { target, onPush, onPop, ...rest } = props as any;
  const navigation = useNavigation();
  const hostProps: Record<string, unknown> = { ...rest };
  hostProps.callbackId = serializeCallback(() => {
    onPush?.();
    navigation.push(target, onPop);
  });
  hostProps.type = "push";
  return React.createElement("ray-action-push", hostProps);
}

/**
 * `Action.SubmitForm` (`_w` in the API bundle): the renderer resolves the current form values and
 * passes them to `onSubmit`; returning `false` shakes the window in Raycast, which we mirror by
 * sending `shakeMainRaycastWindow`.
 */
function SubmitFormAction(props: Record<string, unknown>) {
  const { title = "Submit Form", onSubmit, icon, shortcut, style, ...rest } = props as any;
  const hostProps: Record<string, unknown> = { ...rest, title, icon, shortcut, style };
  hostProps.callbackId = serializeCallback(async (values: unknown) => {
    if (!values) return;
    const result = await onSubmit?.(values);
    if (result === false) await request("shakeMainRaycastWindow", {});
  });
  hostProps.type = "submit-form";
  return React.createElement("ray-action-submit-form", hostProps);
}

Action.Push = PushAction;
Action.SubmitForm = SubmitFormAction;

export interface PaginationOptions {
  pageSize: number;
  hasMore: boolean;
  onLoadMore?: () => void;
}

function paginationPayload(pagination: PaginationOptions | undefined) {
  if (!pagination) return undefined;
  return {
    pageSize: pagination.pageSize,
    hasMore: pagination.hasMore,
    onLoadMore: pagination.onLoadMore ? serializeCallback(() => pagination.onLoadMore?.()) : undefined,
  };
}

export interface ListProps {
  children?: React.ReactNode;
  isLoading?: boolean;
  filtering?: boolean;
  enableFiltering?: boolean;
  throttle?: boolean;
  searchBarPlaceholder?: string;
  searchBarAccessory?: React.ReactNode;
  navigationTitle?: string;
  selectedItemId?: string;
  onSelectionChange?: (id: string) => void;
  isShowingDetail?: boolean;
  pagination?: PaginationOptions;
  actions?: React.ReactNode;
  emptyView?: React.ReactNode;
}

export function List({
  children,
  isLoading = false,
  filtering,
  enableFiltering,
  throttle,
  searchBarPlaceholder,
  searchBarAccessory,
  navigationTitle,
  selectedItemId,
  onSelectionChange,
  isShowingDetail,
  pagination,
  actions,
  emptyView,
  ...rest
}: ListProps) {
  const props: Record<string, unknown> = {
    isLoading,
    searchBarPlaceholder,
    navigationTitle,
    isShowingDetail,
    throttle,
    filtering: filtering ?? enableFiltering,
    filteringEnabled: filtering ?? enableFiltering,
    selectedItemId,
    onSelectionChange: onSelectionChange ? serializeCallback(onSelectionChange) : undefined,
    pagination: paginationPayload(pagination),
    ...rest,
  };
  return React.createElement(
    "ray-list",
    props,
    actions,
    searchBarAccessory,
    emptyView,
    children,
  );
}

/** `List.Item.Detail` (`Fh`): markdown and metadata for the selected row's right-hand pane. */
List.Item = function ListItem(props: Record<string, unknown> & { detail?: React.ReactNode }) {
  const { actions, detail, ...rest } = props;
  return React.createElement("ray-list-item", rest, detail, actions);
};
List.Item.Detail = function ItemDetail(props: Record<string, unknown> & { metadata?: React.ReactNode }) {
  const { metadata, children, ...rest } = props;
  return React.createElement("ray-list-item-detail", rest, metadata);
};
List.Section = function Section({ title, subtitle, children, ...rest }: any) {
  return React.createElement("ray-list-section", { title, subtitle, ...rest }, children);
};
List.EmptyView = function EmptyView(props: Record<string, unknown>) {
  return React.createElement("ray-empty-view", props);
};

/** `List.Dropdown` (`Ni`) — the search-bar accessory dropdown. */
List.Dropdown = function Dropdown({ children, tooltip, value, defaultValue, onChange, throttle, filtering, isLoading, onSearchTextChange, placeholder, ...rest }: any) {
  const props: Record<string, unknown> = {
    tooltip,
    value,
    defaultValue,
    placeholder,
    throttle,
    filtering,
    filteringEnabled: filtering,
    isLoading,
    onChange: onChange ? serializeCallback(onChange) : undefined,
    onSearchTextChange: onSearchTextChange ? serializeCallback(onSearchTextChange) : undefined,
    ...rest,
  };
  return React.createElement("ray-search-bar-dropdown", props, children);
};
List.Dropdown.Section = function DropdownSection({ title, children, ...rest }: any) {
  return React.createElement("ray-menu-section", { title, ...rest }, children);
};
List.Dropdown.Item = function DropdownItem(props: Record<string, unknown>) {
  return React.createElement("ray-menu-item", { ...props, id: props.id ?? props.value });
};

export interface GridProps extends Omit<ListProps, "isShowingDetail"> {
  columns?: number;
  itemSize?: "small" | "medium" | "large";
  aspectRatio?: string;
  fit?: "contain" | "fill";
  inset?: "zero" | "sm" | "md" | "lg";
}

export function Grid({
  children,
  columns = 5,
  itemSize,
  aspectRatio,
  fit,
  inset = "zero",
  isLoading = false,
  filtering,
  enableFiltering,
  throttle,
  searchBarPlaceholder,
  searchBarAccessory,
  navigationTitle,
  selectedItemId,
  onSelectionChange,
  pagination,
  actions,
  emptyView,
  ...rest
}: GridProps) {
  return React.createElement(
    "ray-grid",
    {
      columns,
      itemSize,
      aspectRatio,
      fit,
      inset,
      isLoading,
      searchBarPlaceholder,
      navigationTitle,
      throttle,
      filtering: filtering ?? enableFiltering,
      filteringEnabled: filtering ?? enableFiltering,
      selectedItemId,
      onSelectionChange: onSelectionChange ? serializeCallback(onSelectionChange) : undefined,
      pagination: paginationPayload(pagination),
      ...rest,
    },
    actions,
    searchBarAccessory,
    emptyView,
    children,
  );
}

/** Raycast's `Grid.ItemSize` / `Grid.Inset` / `Grid.Fit` (`jC` / `qC` / `WC`). */
Grid.ItemSize = { Small: "small", Medium: "medium", Large: "large" } as const;
Grid.Inset = { Zero: "zero", Small: "sm", Medium: "md", Large: "lg" } as const;
Grid.Fit = { Contain: "contain", Fill: "fill" } as const;

Grid.Item = function GridItem(props: Record<string, unknown>) {
  const { actions, ...rest } = props;
  return React.createElement("ray-grid-item", rest, actions);
};
Grid.Section = function Section({ title, subtitle, columns, aspectRatio, fit, inset, children, ...rest }: any) {
  return React.createElement(
    "ray-grid-section",
    { title, subtitle, columns, aspectRatio, fit, inset, ...rest },
    children,
  );
};
Grid.EmptyView = function EmptyView(props: Record<string, unknown>) {
  return React.createElement("ray-empty-view", props);
};
Grid.Dropdown = List.Dropdown;

export function Detail({ markdown, navigationTitle, isLoading = false, metadata, actions, ...rest }: any) {
  return React.createElement("ray-detail", { markdown, navigationTitle, isLoading, ...rest }, actions, metadata);
}
Detail.Metadata = function Metadata({ children }: { children?: React.ReactNode }) {
  return React.createElement("ray-metadata", {}, children);
};
Detail.Metadata.Label = function MetadataLabel({ title, text, icon, ...rest }: any) {
  return React.createElement("ray-metadata-label", { title, text, icon, ...rest });
};
Detail.Metadata.Link = function MetadataLink({ title, text, target, ...rest }: any) {
  return React.createElement("ray-metadata-link", { title, text, target, ...rest });
};
Detail.Metadata.TagList = function TagList({ title, children }: any) {
  return React.createElement("ray-metadata-taglist", { title }, children);
};
Detail.Metadata.TagList.Item = function TagItem({ text, icon, color, onAction, ...rest }: any) {
  return React.createElement("ray-metadata-taglist-item", {
    text, icon, color,
    onAction: onAction ? serializeCallback(onAction) : undefined,
    ...rest,
  });
};
Detail.Metadata.Separator = function Separator() {
  return React.createElement("ray-metadata-separator", {});
};

export function Form({ children, actions, isLoading = false, navigationTitle, enableDrafts, searchBarAccessory, ...rest }: any) {
  return React.createElement(
    "ray-form",
    { isLoading, navigationTitle, enableDrafts, ...rest },
    searchBarAccessory,
    actions,
    children,
  );
}

/**
 * `pt(e)` in the API bundle — the imperative handle every form field exposes through a ref:
 * `focus()` sends `formSetFocus {itemId}` and `reset()` sends `formReset {itemId}`.
 */
function fieldHandle(id?: string) {
  return {
    focus: async () => id !== undefined && (await request("formSetFocus", { itemId: id })),
    reset: async () => id !== undefined && (await request("formReset", { itemId: id })),
  };
}

/** `ke(value, defaultValue, onChange)` — the controlled/uncontrolled value triad. */
function useFieldValue(props: { value?: unknown; defaultValue?: unknown; onChange?: (value: any) => void }) {
  const { value, defaultValue, onChange } = props;
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const current = isControlled ? value : uncontrolled;
  const set = React.useCallback(
    (next: unknown) => {
      if (!isControlled) setUncontrolled(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );
  return [current, defaultValue, set] as const;
}

Form.TextField = function TextField(props: Record<string, unknown>) {
  const { id, title, info, error, storeValue, autoFocus, value, defaultValue, placeholder, onChange, onBlur, onFocus, ...rest } = props as any;
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-textfield", {
    id, title, info, error, storeValue, autoFocus,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    placeholder,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  });
};
Form.PasswordField = function PasswordField(props: Record<string, unknown>) {
  const { id, title, info, error, storeValue, autoFocus, value, defaultValue, placeholder, onChange, onBlur, onFocus, ...rest } = props as any;
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-passwordfield", {
    id, title, info, error, storeValue, autoFocus,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    placeholder,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  });
};
Form.TextArea = function TextArea(props: Record<string, unknown>) {
  const { id, title, info, error, storeValue, autoFocus, value, defaultValue, placeholder, enableMarkdown, onChange, onBlur, onFocus, ...rest } = props as any;
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-textarea", {
    id, title, info, error, storeValue, autoFocus, enableMarkdown,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    placeholder,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  });
};
Form.Checkbox = function Checkbox(props: Record<string, unknown>) {
  const { id, label, title, info, error, storeValue, autoFocus, value, defaultValue, onChange, onBlur, onFocus, ...rest } = props as any;
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-checkbox", {
    id, label, title, info, error, storeValue, autoFocus,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  });
};
Form.Dropdown = function Dropdown({ id, title, info, error, storeValue, autoFocus, value, defaultValue, placeholder, throttle, filtering, isLoading, onSearchTextChange, onChange, onBlur, onFocus, children, ...rest }: any) {
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-dropdown", {
    id, title, info, error, storeValue, autoFocus,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    placeholder,
    throttle,
    filtering,
    isLoading,
    onChange: serializeCallback(set),
    onSearchTextChange: onSearchTextChange ? serializeCallback(onSearchTextChange) : undefined,
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  }, children);
};
Form.Dropdown.Item = function DropdownItem(props: Record<string, unknown>) {
  return React.createElement("ray-menu-item", { ...props, id: props.id ?? props.value });
};
Form.Dropdown.Section = function DropdownSection({ title, children, ...rest }: any) {
  return React.createElement("ray-menu-section", { title, ...rest }, children);
};
Form.TagPicker = function TagPicker({ id, title, info, error, storeValue, autoFocus, value, defaultValue, placeholder, onCreate, onChange, onBlur, onFocus, children, ...rest }: any) {
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-tagpicker", {
    id, title, info, error, storeValue, autoFocus,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    placeholder,
    onCreate: onCreate ? serializeCallback(onCreate) : undefined,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  }, children);
};
Form.TagPicker.Item = function TagPickerItem(props: Record<string, unknown>) {
  return React.createElement("ray-form-tagpicker-item", props);
};
Form.DatePicker = function DatePicker({ id, title, info, error, storeValue, autoFocus, value, defaultValue, type = "date", min, max, onChange, onBlur, onFocus, ...rest }: any) {
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-datepicker", {
    id, title, info, error, storeValue, autoFocus, type,
    value: current instanceof Date ? current : current ? new Date(current as any) : undefined,
    defaultValue: value === undefined
      ? initial instanceof Date ? initial : initial ? new Date(initial as any) : undefined
      : undefined,
    min, max,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  });
};
Form.FilePicker = function FilePicker({ id, title, info, error, autoFocus, value, defaultValue, canChooseFiles = true, canChooseDirectories, allowMultipleSelection, showHiddenFiles, onChange, onBlur, onFocus, ...rest }: any) {
  const [current, initial, set] = useFieldValue({ value, defaultValue, onChange });
  return React.createElement("ray-form-filepicker", {
    id, title, info, error, autoFocus,
    canChooseFiles, canChooseDirectories, allowMultipleSelection, showHiddenFiles,
    value: current,
    defaultValue: value === undefined ? initial : undefined,
    onChange: serializeCallback(set),
    onBlur: onBlur ? serializeCallback(onBlur) : undefined,
    onFocus: onFocus ? serializeCallback(onFocus) : undefined,
    ...rest,
  });
};
Form.Separator = function Separator() {
  return React.createElement("ray-form-separator", {});
};
Form.Description = function Description({ text }: { text: string }) {
  return React.createElement("ray-form-description", { text });
};

export function MenuBarExtra({ children, icon, isLoading = false, title, ...rest }: any) {
  return React.createElement("ray-menu-bar-extra", { icon, isLoading, title, ...rest }, children);
}
MenuBarExtra.Item = function MenuBarItem(props: Record<string, unknown>) {
  const { actions, ...rest } = props;
  return React.createElement("ray-menu-bar-item", rest, actions);
};
MenuBarExtra.Separator = function MenuBarSeparator() {
  return React.createElement("ray-menu-bar-separator", {});
};
MenuBarExtra.Submenu = function Submenu({ title, children }: any) {
  return React.createElement("ray-menu-bar-submenu", { title }, children);
};

export interface ToastOptions {
  title?: string | number;
  message?: string | number;
  style?: string;
  primaryAction?: { title: string; shortcut?: unknown; onAction: () => void };
  secondaryAction?: { title: string; shortcut?: unknown; onAction: () => void };
}

/**
 * The Toast API (`Dt` in `@raycast/api/index.js`): an updatable handle with `show()` / `hide()`,
 * default style `Success`, and every setter triggering `update()` so a pending toast can be
 * flipped to success/failure in place.
 */
export class Toast {
  static readonly Style = {
    Success: "SUCCESS",
    Failure: "FAILURE",
    Animated: "ANIMATED",
  } as const;

  readonly id: string;
  options: Required<Pick<ToastOptions, "style">> & ToastOptions;
  private callbacks: { onPrimaryAction?: () => void; onSecondaryAction?: () => void };

  constructor(options: ToastOptions) {
    this.id = nextToastId();
    const { primaryAction, secondaryAction, title, message, ...rest } = options;
    this.options = {
      ...rest,
      title: title?.toString(),
      message: message?.toString(),
      style: rest.style || Toast.Style.Success,
    };
    this.callbacks = {
      onPrimaryAction: primaryAction?.onAction,
      onSecondaryAction: secondaryAction?.onAction,
    };
  }

  get style(): string { return this.options.style; }
  set style(value: string) { this.options.style = value; void this.update(); }

  get title(): string | undefined { return this.options.title?.toString(); }
  set title(value: string | number | undefined) { this.options.title = value?.toString(); void this.update(); }

  get message(): string | undefined { return this.options.message?.toString(); }
  set message(value: string | number | undefined) { this.options.message = value?.toString(); void this.update(); }

  get primaryAction() { return this.options.primaryAction; }
  set primaryAction(value: ToastOptions["primaryAction"] | undefined) {
    if (value) {
      const { onAction, ...rest } = value;
      this.callbacks.onPrimaryAction = onAction;
      this.options.primaryAction = rest as ToastOptions["primaryAction"];
    } else {
      delete this.callbacks.onPrimaryAction;
      delete this.options.primaryAction;
    }
    void this.update();
  }

  get secondaryAction() { return this.options.secondaryAction; }
  set secondaryAction(value: ToastOptions["secondaryAction"] | undefined) {
    if (value) {
      const { onAction, ...rest } = value;
      this.callbacks.onSecondaryAction = onAction;
      this.options.secondaryAction = rest as ToastOptions["secondaryAction"];
    } else {
      delete this.callbacks.onSecondaryAction;
      delete this.options.secondaryAction;
    }
    void this.update();
  }

  /** Serialises actions to callback ids — functions cannot cross the worker port. */
  private payload() {
    return {
      ...this.options,
      onHide: serializeCallback(async () => {
        // `toast_<id>_onHide` clears the action callbacks once the toast is gone.
      }),
      primaryAction: this.options.primaryAction
        ? { ...this.options.primaryAction, onAction: serializeCallback(() => this.callbacks.onPrimaryAction?.()) }
        : undefined,
      secondaryAction: this.options.secondaryAction
        ? { ...this.options.secondaryAction, onAction: serializeCallback(() => this.callbacks.onSecondaryAction?.()) }
        : undefined,
    };
  }

  async show(): Promise<void> {
    await request("showToast", this.payload());
  }

  async hide(): Promise<void> {
    await request("hideToast", {});
  }

  async update(): Promise<void> {
    await request("updateToast", this.payload());
  }
}

function nextToastId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `toast_${Math.random().toString(36).slice(2)}`;
}

/** `showToast(options)` or the legacy `showToast(style, title, message)` shape. */
export async function showToast(
  optionsOrStyle: ToastOptions | string,
  title?: string,
  message?: string,
): Promise<Toast> {
  const toast = new Toast(
    typeof optionsOrStyle === "object"
      ? optionsOrStyle
      : { style: optionsOrStyle, title: title || "", message },
  );
  await toast.show();
  return toast;
}

/**
 * `LC(e)` in the API bundle — `confirmAlert(options)` resolves `true` when the primary action runs
 * and `false` on dismiss. The boolean never crosses the wire: the renderer fires whichever callback
 * id the payload carried, and this promise resolves from that callback.
 */
export async function confirmAlert(options: {
  title?: string;
  message?: string;
  icon?: unknown;
  primaryAction?: { title?: string; style?: string; onAction?: () => void };
  dismissAction?: { title?: string; style?: string; onAction?: () => void };
}): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const payload = {
      title: options.title,
      message: options.message,
      icon: options.icon,
      primaryAction: {
        title: "Confirm",
        ...options.primaryAction,
        onAction: serializeCallback(async () => {
          options.primaryAction?.onAction?.();
          resolve(true);
        }),
      },
      dismissAction: {
        title: "Cancel",
        ...options.dismissAction,
        onAction: serializeCallback(async () => {
          options.dismissAction?.onAction?.();
          resolve(false);
        }),
      },
    };
    request("showAlert", payload).catch(reject);
  });
}

/** Raycast's `Alert.ActionStyle` (`Xs`). */
export const Alert = {
  ActionStyle: { Default: "default", Cancel: "cancel", Destructive: "destructive" } as const,
};

// ---------------------------------------------------------------------------------------------
// Navigation / launcher control
// ---------------------------------------------------------------------------------------------

export const environment = {
  commandName: process.env.COMMAND_NAME,
  extensionName: process.env.EXTENSION_NAME,
  raycastVersion: process.env.RAYCAST_VERSION,
  isDevelopment: process.env.NODE_ENV === "development",
  assetsPath: process.env.ASSETS_PATH,
  supportPath: process.env.SUPPORT_PATH,
  appearance: "dark" as "light" | "dark",
  textSize: "medium" as "small" | "medium" | "large",
  canAccess: (feature: string) => feature === "AI",
};

export async function popToRoot(options?: { clearSearchBar?: boolean }) {
  await request("popToRoot", { clearSearchBar: options?.clearSearchBar ?? false });
}

/** `{itemId}` RPCs — `pt()` in the API bundle; also usable without a field ref. */
export async function formSetFocus(itemId: string) {
  await request("formSetFocus", { itemId });
}

export async function formReset(itemId: string) {
  await request("formReset", { itemId });
}

export async function clearSearchBar(options?: { forceScrollToTop?: boolean }) {
  await request("clearSearchBar", { forceScrollToTop: options?.forceScrollToTop ?? false });
}

export async function launchCommand(options: {
  name: string;
  type: "userInitiated" | "background";
  extensionName?: string;
  ownerOrAuthorName?: string;
  arguments?: Record<string, unknown> | null;
  context?: string | null;
  fallbackText?: string | null;
}) {
  await request("launchCommand", options);
}

export async function open(target: string, application?: string) {
  await request("open", { path: target, app: application });
}

export async function openExtensionPreferences() {
  await request("openExtensionPreferences", {});
}

export async function showHUD(title: string, options?: { clearRootSearch?: boolean; popToRootType?: string }) {
  await request("showHUD", { title, clearRootSearch: options?.clearRootSearch ?? false, popToRootType: options?.popToRootType ?? "default" });
}

export async function closeMainWindow(options?: { clearRootSearch?: boolean; popToRootType?: string }) {
  await request("closeMainRaycastWindow", { ...(options ?? {}) });
}

export async function getSelectedText() {
  const result = await request<{ value: string }>("getSelectedText", {});
  return result.value;
}

export async function getFrontmostApplication() {
  const result = await request<{ value: unknown }>("getFrontmostApplication", {});
  return result.value;
}

export async function getApplications(path?: string) {
  const result = await request<{ value: unknown[] }>("getApplications", { path });
  return result.value;
}

// Clipboard
export const Clipboard = {
  async copy(content: unknown) { await request("setClipboard", { content }); },
  async paste(content: unknown) { await request("paste", { content }); },
  async clear() { await request("clearClipboard", {}); },
  async readText() {
    const result = await request<{ value: string | null }>("getClipboard", {});
    return result.value;
  },
};

// Local Storage (per extension)
export const LocalStorage = {
  async getItem(key: string) {
    return (await request<{ value: string | null }>("getLocalStorageItem", { key })).value;
  },
  async setItem(key: string, value: string) { await request("setLocalStorageItem", { key, value }); },
  async removeItem(key: string) { await request("removeLocalStorageItem", { key }); },
  async clear() { await request("clearLocalStorage", {}); },
  async allItems() {
    return (await request<{ value: Record<string, string> }>("allLocalStorageItems", {})).value;
  },
};

export const AI = {
  async ask(prompt: string, options?: { model?: string; creativity?: "none" | "low" | "medium" | "high" | "maximum" }) {
    const streamCallbackId = serializeCallback(() => undefined);
    return request<{ value: string }>("completePrompt", {
      prompt, model: options?.model, temperature: options?.creativity, streamCallbackId,
    });
  },
};

export const Tool = {
  Confirmation: null as unknown,
};

export function getFavicon(url: string, options?: { size?: number }) {
  return `https://www.google.com/s2/favicons?sz=${options?.size ?? 32}&domain_url=${encodeURIComponent(url)}`;
}

// ---------------------------------------------------------------------------------------------
// Worker bootstrap — this is what `initialize` drives.
// ---------------------------------------------------------------------------------------------

let activeRoot: ReturnType<typeof createCommandRoot> | null = null;

export function currentRoot() {
  return activeRoot;
}

registerMethod("initialize", async (launchContext: any) => {
  process.env.EXTENSION_NAME = launchContext.extensionName;
  process.env.COMMAND_NAME = launchContext.entryPointName;
  process.env.ASSETS_PATH = launchContext.assetsPath;
  process.env.SUPPORT_PATH = launchContext.supportPath;
  process.env.RAYCAST_SESSION = launchContext.id;

  const path =
    launchContext.commandPath ?? launchContext.toolPath ?? launchContext.modelProviderPath;
  if (!path) throw new Error("initialize: no entry point path supplied");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const commandModule = require(path);
  const Component =
    (launchContext.namedExport && commandModule[launchContext.namedExport]) ||
    commandModule.default;

  if (typeof Component !== "function") {
    throw new Error(`Entry point ${path} has no default export`);
  }

  const preferences = launchContext.preferences ?? {};
  const argumentValues = launchContext.argumentValues ?? {};
  const launchType = launchContext.launchType ?? "userInitiated";

  // `Yg` (InternalRootComponent): the command tree lives inside the navigation root, which owns
  // the `ray-navigation-stack` element and the routes the stack model is built from. Navigation
  // state is module-level (see navigation.ts); a push/pop re-renders this root. The root element
  // is rebuilt on every render on purpose — re-rendering the same element object would bail the
  // reconciler out (oldProps === newProps by reference) and module-state changes would never
  // reach the shadow tree, so `push` would produce a renderEmpty.
  const commandProps = {
    arguments: argumentValues,
    launchArguments: argumentValues,
    preferences,
    launchType,
  };
  const buildRoot = () =>
    React.createElement(InternalNavigationRoot, null, React.createElement(Component, commandProps));
  activeRoot = createCommandRoot(buildRoot());
  resetNavigation(
    React.createElement(Component, commandProps),
    () => {
      if (activeRoot) activeRoot.render(buildRoot());
    },
  );
  activeRoot.render(buildRoot());

  // The commit listener ships the model; this call covers a command that renders nothing at all.
  await new Promise((resolve) => queueMicrotask(resolve));
  await renderCurrent(activeRoot);

  if (launchContext.entryPointType === "tool") {
    // A tool is a plain async function, not a React component.
    return await (Component as (input: unknown) => unknown)(argumentValues);
  }
  return undefined;
});

registerMethod("nativeCallback", async ({ callbackId, data }: { callbackId: string; data?: unknown }) => {
  const callback = resolveCallback(callbackId);
  if (!callback) throw new Error(`Unknown callback ${callbackId}`);
  const result = await callback(data);
  return { data: result };
});

registerMethod("terminate", async ({ code }: { code: number }) => {
  process.exit(code ?? 0);
});

// `registerCallback` lives in the reconciler module; re-exported here to keep a single registry.

startRpc();
