import type { FlowKeyCapabilities } from './capabilities';

export const PROTOCOL_VERSION = 1;

export interface UiAction {
  id: string;
  title: string;
  primary?: boolean;
  push?: string;
  /** `destructive` tints the action row in the action panel. */
  style?: 'destructive';
  /** Display-only shortcut hint (the shell's keycap rendering). */
  shortcut?: UiShortcut;
}

export interface UiPaneField {
  label: string;
  value: string;
  valueIconUri?: string;
}

export interface UiPane {
  title?: string;
  preview?: string;
  previewImageUri?: string;
  fields?: UiPaneField[];
}

export interface UiAccessory {
  text: string;
  tooltip?: string;
  /** Semantic tint: `success`, `danger`, `accent` or `secondary` (default). */
  color?: 'success' | 'danger' | 'accent' | 'secondary';
}

export interface UiItem {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  icon?: string;
  iconName?: string;
  iconColor?: string;
  iconUri?: string;
  /** Raw SVG markup rendered as a vector (tinted by `iconColor`). */
  iconSvg?: string;
  /** Extra search terms matched by the shell's filter. */
  keywords?: string[];
  /** Trailing chips shown at the end of a list row. */
  accessories?: UiAccessory[];
  pane?: UiPane;
  actions?: UiAction[];
}

export interface UiEmptyView {
  title: string;
  description?: string;
}

export interface UiSection {
  title?: string;
  subtitle?: string;
  items: UiItem[];
}

export interface UiFilter {
  options: UiFilterOption[];
}

export interface UiFilterOption {
  label: string;
  value: string;
}

export interface ListTree {
  type: 'list';
  layout?: string;
  filter?: UiFilter;
  sections: UiSection[];
  emptyView?: UiEmptyView;
  /** Keeps the shell's loading indicator active after the tree arrives. */
  isLoading?: boolean;
  /** Placeholder text for the search bar while this tree is shown. */
  searchBarPlaceholder?: string;
  /** Server-side pagination: the shell offers a Load-more affordance that runs `moreActionId`. */
  pagination?: UiPagination;
}

export interface UiPagination {
  /** Whether more pages exist; false collapses the Load-more affordance. */
  hasNextPage: boolean;
  /** Registry action id the shell invokes to load the next page. */
  moreActionId: string;
  pageSize?: number;
}

export interface UiField {
  label: string;
  value: string;
  /** `link` fields open `href` in the user's browser. */
  href?: string;
  /** `tags` fields render a chip list instead of plain text. */
  tags?: string[];
  /** Field variant; defaults to a plain key/value row. */
  kind?: 'text' | 'link' | 'tags' | 'separator';
}

export interface UiShortcut {
  key: string;
  modifiers?: string[];
}

export interface DetailTree {
  type: 'detail';
  title: string;
  mediaKeys?: boolean;
  subtitle?: string;
  imageUri?: string;
  fields: UiField[];
  description?: string;
  actions?: UiAction[];
}

export interface GridTree {
  type: 'grid';
  title?: string;
  columns: number;
  /** Flat item list; ignored when `sections` is present. */
  items: UiItem[];
  /** Grouped items with optional headers (rendered as header rows). */
  sections?: UiSection[];
  /** Search-bar dropdown options shown while this grid view is open. */
  filter?: UiFilter;
  emptyView?: UiEmptyView;
  /** Keeps the shell's loading indicator active after the tree arrives. */
  isLoading?: boolean;
  /** Placeholder text for the search bar while this tree is shown. */
  searchBarPlaceholder?: string;
}

export interface FormFieldOption {
  value: string;
  title: string;
}

/** One editable field of a `form` tree. The shell owns the editing state. */
export interface FormField {
  /** Stable key in the submitted values bag. */
  id: string;
  kind:
    | 'textfield'
    | 'password'
    | 'textarea'
    | 'checkbox'
    | 'dropdown'
    | 'datepicker'
    | 'tagpicker'
    | 'filepicker'
    | 'description'
    | 'separator';
  /** Row label (also the description text for `description` fields). */
  label?: string;
  placeholder?: string;
  /** Initial value: string for text-like fields, boolean for checkbox. */
  default?: string | boolean;
  required?: boolean;
  /** Dropdown/tagpicker options. */
  options?: FormFieldOption[];
  /** Initial selection for tagpickers. */
  defaults?: string[];
  /** Filepicker behaviour. */
  canChooseFiles?: boolean;
  canChooseDirectories?: boolean;
  allowMultipleSelection?: boolean;
}

export interface FormTree {
  type: 'form';
  title: string;
  fields: FormField[];
  actions?: UiAction[];
  /** Registry action id of the Form's onSubmit; the shell sends `formValues` with it. */
  submitActionId?: string;
}

export type UiTree = ListTree | DetailTree | GridTree | FormTree;

export interface CommandArgument {
  /** Key in the `arguments` bag handed to the command. */
  name: string;
  type: 'text' | 'password' | 'dropdown';
  placeholder: string;
  required?: boolean;
  /** Required for dropdown arguments. */
  data?: { value: string; title: string }[];
}

export interface ManifestCommand {
  id: string;
  title: string;
  /** Optional subtitle shown under the title in the root command list. */
  subtitle?: string;
  keywords?: string[];
  mode?: 'view' | 'background';
  /** Rendering surface: `tree` (default, native UI tree) or `web` (WebView2). */
  ui?: 'tree' | 'web';
  /** Web bundle filename for `ui: 'web'` commands (default `main.web.js`). */
  webEntry?: string;
  icon?: string;
  iconColor?: string;
  /** Command starts disabled until the user enables it. */
  disabledByDefault?: boolean;
  /** Background refresh cadence in seconds (>= 60, background commands only). */
  interval?: number;
  /** Positional arguments captured by the search bar before the command runs. */
  arguments?: CommandArgument[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  /**
   * Bundled JavaScript entry file that the sidecar imports at runtime,
   * relative to the package root. Defaults to 'main.js'.
   */
  entry?: string;
  commands: ManifestCommand[];
  nativeMethods: string[];
  httpHosts: string[];
  oauth?: string[];
  /**
   * Filesystem scopes granted to the extension, as absolute path globs —
   * e.g. a Windows vault path with a recursive wildcard and an `.md`
   * extension filter, or the same shape with a `{{vaultPath}}` placeholder
   * that interpolates the user's preference value at call time. Required
   * for every `fs.*` native method and for `shell.openPath` /
   * `shell.revealPath`.
   */
  fsPaths?: string[];
  /**
   * Additional URI schemes `shell.openUrl` may open (http and https are
   * always allowed) — e.g. `["obsidian"]` for `obsidian://` links.
   */
  uriSchemes?: string[];
  preferences?: PreferenceSchema[];
}

export type Preferences = Record<string, unknown>;

/**
 * Mount/update directive for a web-mode command (`ui: 'web'`): the shell
 * shows its WebView2 surface and loads the extension's web bundle. Sent in
 * place of a `ui`/`uiPush` tree whenever the command declares web UI.
 */
export interface WebViewMessage {
  type: 'webView';
  requestId: string;
  extensionId: string;
  commandId: string;
  /** Web bundle filename inside the extension package (e.g. `main.web.js`). */
  entry: string;
  props: {
    query: string;
    filterValue?: string;
    arguments?: Arguments;
    preferences: Preferences;
    environment: ExtensionEnvironment;
  };
}

/** Capability call relayed from the webview; the sidecar routes it through NativeBridge. */
export interface WebCallMessage {
  type: 'webCall';
  /** Shell-minted bridge id; echoed by `webResult` and matched by `webAbort`. */
  bridgeId: string;
  extensionId: string;
  method: string;
  /** Bridge-level deadline for the relayed call (absent = sidecar default). */
  timeoutMs?: number;
  params?: Record<string, unknown>;
}

export interface WebResultMessage {
  type: 'webResult';
  bridgeId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** Webview-side abort of an in-flight bridged call. */
export interface WebAbortMessage {
  type: 'webAbort';
  bridgeId: string;
  extensionId: string;
}

/** Captured command arguments keyed by argument name (values are strings). */
export type Arguments = Record<string, string>;

/**
 * Read-only facts about the running extension and the entry point that is
 * executing. Built by the sidecar and injected into every context and
 * component's props.
 */
export interface ExtensionEnvironment {
  extensionId: string;
  extensionName: string;
  extensionVersion: string;
  /** Set when the current call targets a specific command. */
  commandId?: string;
  /** Manifest mode of `commandId`, when known. */
  commandMode?: 'view' | 'background';
  /** True when the extension was loaded from the repo instead of an installed package. */
  isDevelopment: boolean;
}

export interface HudOptions {
  title: string;
  icon?: string;
  duration?: number;
}

/** Visual accent of a toast notification. */
export type ToastStyle = 'success' | 'failure';

export interface ToastOptions {
  title: string;
  message?: string;
  style?: ToastStyle;
  /** Emoji or `data:`/`file:` icon URI, resolved by the shell like the HUD icon. */
  icon?: string;
  duration?: number;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  /** Styles the confirm action as destructive (danger accent). */
  destructive?: boolean;
}

/**
 * Window/launch controls the sidecar forwards to the shell as protocol
 * messages (not native calls — no consent-gated OS access involved).
 */
export interface ExtensionWindow {
  /** Hides the launcher window. */
  closeMainWindow(): void;
  /** Returns to the root search, clearing pushed views. */
  popToRoot(): void;
  /** Clears the root search text. */
  clearSearchBar(): void;
  /** Opens one of this extension's commands (view or background). */
  launchCommand(commandId: string, query?: string): void;
}

export interface ExtensionContext {
  preferences: Preferences;
  commandId?: string;
  filterValue?: string;
  /** Captured command arguments for the running command, when declared. */
  arguments?: Arguments;
  environment: ExtensionEnvironment;
  window: ExtensionWindow;
  native: {
    call<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      options?: { signal?: AbortSignal; timeoutMs?: number },
    ): Promise<T>;
    showHud(options: HudOptions): Promise<void>;
  };
  /** Typed capability groups over `native.call` (http, storage, clipboard, …). */
  capabilities: FlowKeyCapabilities;
}

export interface SearchHandlers {
  search(query: string, ctx: ExtensionContext): Promise<UiTree>;
  onAction?(
    actionId: string,
    item: UiItem | undefined,
    ctx: ExtensionContext,
    formValues?: Record<string, unknown>,
  ): Promise<UiTree | null>;
  command?(commandId: string, ctx: ExtensionContext): Promise<void>;
}

export interface ExtensionModule {
  manifest: ExtensionManifest;
  handlers: SearchHandlers;
}

export interface PreferenceSchema {
  name: string;
  type: 'text' | 'password' | 'checkbox' | 'dropdown' | 'file' | 'directory' | 'appPicker';
  title: string;
  description?: string;
  default?: string | boolean;
  required?: boolean;
  options?: { value: string; title: string }[];
  /** Checkbox display label. */
  label?: string;
  /** Hint text for text-like fields (text, password, file, directory). */
  placeholder?: string;
}

export interface ReadyExtension {
  id: string;
  name: string;
  version: string;
  icon?: string;
  description?: string;
  preferences?: PreferenceSchema[];
  commands: ManifestCommand[];
  nativeMethods: string[];
  httpHosts: string[];
  oauth?: string[];
  fsPaths?: string[];
  uriSchemes?: string[];
}

export interface InitMessage {
  type: 'init';
  protocolVersion: number;
  extensionsDir: string;
  preferences: Record<string, Preferences>;
  /** Installed extension ids the shell has disabled; the sidecar must not load them. */
  disabledExtensions?: string[];
}

export interface SearchMessage {
  type: 'search';
  requestId: string;
  extensionId: string;
  query: string;
  commandId?: string;
  filterValue?: string;
  arguments?: Arguments;
}

export interface ActionMessage {
  type: 'action';
  requestId: string;
  extensionId: string;
  actionId: string;
  item?: UiItem;
  arguments?: Arguments;
  /** Current form field values, sent by the shell while a form view is active. */
  formValues?: Record<string, unknown>;
}

export interface PreferencesMessage {
  type: 'preferences';
  extensionId: string;
  values: Preferences;
}

export type HostMessage =
  | InitMessage
  | SearchMessage
  | ActionMessage
  | PreferencesMessage
  | NativeResultMessage
  | WebCallMessage
  | WebAbortMessage;

export interface ReadyFailure {
  id: string;
  message: string;
}

export interface ReadyMessage {
  type: 'ready';
  protocolVersion: number;
  extensions: ReadyExtension[];
  /** Installed extensions that were discovered but failed to load. */
  failures?: ReadyFailure[];
}

export interface UiMessage {
  type: 'ui';
  requestId: string;
  tree: UiTree;
}

export interface UiPushMessage {
  type: 'uiPush';
  extensionId: string;
  commandId: string;
  query: string;
  filterValue?: string;
  tree: UiTree;
}

export interface ErrorMessage {
  type: 'error';
  requestId: string;
  error: { code: string; message: string };
}

export interface NativeCallMessage {
  type: 'nativeCall';
  requestId: string;
  extensionId: string;
  method: string;
  params?: Record<string, unknown>;
}

export type NativeResultMessage =
  | {
      type: 'nativeResult';
      requestId: string;
      ok: true;
      result?: unknown;
    }
  | {
      type: 'nativeResult';
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };

export interface AckMessage {
  type: 'ack';
  requestId: string;
}

export interface LogMessage {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface WindowCommandMessage {
  type: 'windowCommand';
  extensionId: string;
  /** `closeMainWindow` | `popToRoot` | `clearSearchBar` */
  command: 'closeMainWindow' | 'popToRoot' | 'clearSearchBar';
}

export interface LaunchCommandMessage {
  type: 'launchCommand';
  extensionId: string;
  commandId: string;
  query?: string;
}

export type SidecarMessage =
  | ReadyMessage
  | UiMessage
  | UiPushMessage
  | ErrorMessage
  | AckMessage
  | NativeCallMessage
  | WindowCommandMessage
  | LaunchCommandMessage
  | WebViewMessage
  | WebResultMessage
  | LogMessage;

export function defineExtension(module: ExtensionModule): ExtensionModule {
  return module;
}
