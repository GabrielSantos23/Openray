// The extension UI renderer.
//
// Raycast's frontend does exactly this (`main-window-g1Vb1JLY.js`):
//
//   let u = extensionUIRegistry.get(sessionId);
//   u.registerRender(async (e) => {
//     let t = DQ(e.renderTree, e.gzipped);      // gunzip(base64) -> JSON.parse
//     ReactDOM.flushSync(() => setState(t));
//   });
//
//   function DQ(renderTree, gzipped) {
//     let text = gzipped
//       ? gunzipSync(Uint8Array.from(atob(renderTree), c => c.charCodeAt(0)), { to: "string" })
//       : renderTree;
//     return JSON.parse(text);                  // -> { model, changes }
//   }
//
// The model is *data*, not React elements. The launcher re-materialises it into its own native-
// looking components — which is why an extension's React tree never runs in the renderer.

import { useCallback, useEffect, useRef, useState } from "react";
import { Inflate } from "pako";
import { ipc, onNotification, windowIdentifier } from "./ipc";

function gunzipToString(data: Uint8Array): string {
  const inflator = new Inflate({ to: "string" });
  inflator.push(data, true);
  return inflator.result as string;
}

export interface ViewAction {
  id: string;
  title: string;
  /** Titled ActionPanel.Section this action belongs to (panel grouping, in panel order). */
  group?: string;
  icon?: unknown;
  shortcut?: string;
  style?: string;
  type?: string;
  itemId?: string;
}

export interface ViewAccessory {
  icon?: unknown;
  text?: string;
  tag?: string | number;
  date?: number | string;
  color?: string;
  tooltip?: string;
}

export type MetadataItem =
  | { kind: "Label"; id?: string; title: string; text?: string; icon?: unknown }
  | { kind: "Link"; id?: string; title: string; text?: string; target: string }
  | { kind: "TagList"; id?: string; title: string; items: { text?: string; icon?: unknown; color?: string; onAction?: string }[] }
  | { kind: "Separator"; id?: string };

export interface ViewItemDetail {
  isLoading?: boolean;
  markdown?: string;
  metadata?: MetadataItem[];
}

export interface ViewListItem {
  id: string;
  title?: string;
  subtitle?: string;
  keywords?: string[];
  icon?: unknown;
  accessories?: ViewAccessory[];
  quickLook?: unknown;
  detail?: ViewItemDetail;
  actions?: ViewAction[];
}

export interface ViewSection {
  id?: string;
  title?: string;
  subtitle?: string;
  items: ViewListItem[];
  columns?: number;
  aspectRatio?: string;
  fit?: string;
  inset?: string;
}

export interface ViewPagination {
  pageSize: number;
  hasMore: boolean;
  onLoadMore?: string;
}

export type FormFieldValue = string | boolean | string[] | number | null;

export interface ViewFormField {
  kind: "TextField" | "TextArea" | "Checkbox" | "Dropdown" | "TagPicker" | "DatePicker" | "FilePicker" | "Separator" | "Description";
  id: string;
  title?: string;
  info?: string;
  error?: string;
  autoFocus?: boolean;
  placeholder?: string;
  value?: { value?: FormFieldValue };
  defaultValue?: { value?: FormFieldValue };
  onChange?: string;
  onBlur?: string;
  onFocus?: string;
  isSecure?: boolean;
  enableMarkdown?: boolean;
  checkboxTitle?: string;
  menu?: { sections: { id?: string; title?: string; items: { id: string; title?: string; icon?: unknown }[] }[] };
  filteringEnabled?: boolean;
  onSearchTextChange?: string;
  isLoading?: boolean;
  suggestionValues?: { title?: string; value: string; icon?: unknown }[];
  onCreate?: string;
  type?: "date" | "datetime";
  min?: string;
  max?: string;
  canChooseFiles?: boolean;
  canChooseDirectories?: boolean;
  allowMultipleSelection?: boolean;
  showHiddenFiles?: boolean;
  text?: string;
}

export type SearchBarAccessory =
  | { text?: string; target?: string }
  | {
      tooltip?: string;
      value?: string;
      defaultValue?: string;
      onChange?: string;
      sections?: { title?: string; items: { id: string; title?: string }[] }[];
    };

export interface ViewBody {
  kind: "List" | "Grid" | "Detail" | "Form" | "MenuBarExtra";
  navigationTitle?: string;
  isLoading?: boolean;
  filtering?: boolean;
  filteringEnabled?: boolean;
  keepSectionOrder?: boolean;
  throttle?: boolean;
  searchBarPlaceholder?: string;
  searchBarAccessory?: SearchBarAccessory;
  actions?: ViewAction[];
  items?: ViewListItem[];
  sections?: ViewSection[];
  selectedItemId?: { value: string; eventCount?: number };
  onSelectionChange?: string;
  isShowingDetail?: boolean;
  pagination?: ViewPagination;
  emptyView?: { title?: string; description?: string; icon?: unknown; actions?: ViewAction[] };
  columns?: number;
  itemSize?: string;
  /** `hidden` drops the per-cell labels (icon-only grids like the emoji picker). */
  labels?: string;
  aspectRatio?: string;
  fit?: string;
  inset?: string;
  image?: string;
  markdown?: string;
  metadata?: MetadataItem[];
  fields?: ViewFormField[];
  enableDrafts?: boolean;
  title?: string;
  icon?: unknown;
}

export interface RenderTree {
  kind: "commandView";
  suspended?: boolean;
  navigationStack?: {
    kind: "navigationStack";
    body: ViewBody | null;
    navigationInfo: { id: string | null; action: string };
    onPop?: string;
    actions?: ViewAction[];
  };
  actions?: ViewAction[];
}

export interface RenderMessage {
  renderTree: string;
  gzipped: boolean;
  sessionId: string;
}

/** `DQ(renderTree, gzipped)` — decompress and deserialise. */
export function decodeRenderTree(renderTree: string, gzipped: boolean): { model: RenderTree; changes: unknown[] } {
  const text = gzipped ? gunzipToString(Uint8Array.from(atob(renderTree), (c) => c.charCodeAt(0))) : renderTree;
  return JSON.parse(text) as { model: RenderTree; changes: unknown[] };
}

export type CommandPhase = "not-loaded" | "loading" | "loaded" | "unloading" | "unloaded" | "failure";

export interface ExtensionCommand {
  uuid: string;
  name: string;
  title: string;
  description?: string;
  commands?: Array<{
    name: string;
    title: string;
    description?: string;
    mode?: "view" | "no-view" | "menu-bar";
  }>;
}
export interface LoadedCommand {
  sessionId: string;
}

export interface UseExtensionCommandResult {
  phase: CommandPhase;
  renderTree: RenderTree | null;
  error: Error | null;
  isLoading: boolean;
  suspended: boolean;
  sessionId: string | null;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
  reload: () => void;
}

/**
 * Drives one running command. This is the `OQ(...)` hook in Raycast: a state machine around
 * `loadCommand` / `unloadEntryPoint` plus the `registerRender` / `registerRenderEmpty` /
 * `registerRenderSuspense` subscriptions.
 */
export function useExtensionCommand(
  extension: ExtensionCommand | null,
  command: { name: string; title: string; mode?: string } | null,
  preferences: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
  debug = false,
): UseExtensionCommandResult {
  const [phase, setPhase] = useState<CommandPhase>("not-loaded");
  const [renderTree, setRenderTree] = useState<RenderTree | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [suspended, setSuspended] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const phaseRef = useRef<CommandPhase>("not-loaded");
  const loadAttemptRef = useRef(0);

  phaseRef.current = phase;

  const createCallback = useCallback(
    (callbackId: string) => async (data: unknown) => {
      if (!sessionIdRef.current) return;
      await ipc.backend.extensionHost.callNodeCallback({
        sessionId: sessionIdRef.current,
        callbackId,
        data,
      });
    },
    [],
  );

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    let cancelled = false;

    if (!extension || !command) {
      setIsLoading(false);
      return () => undefined;
    }

    const attempt = ++loadAttemptRef.current;
    setPhase("loading");
    setIsLoading(true);

    // The worker renders *inside* `initialize`, so `extensionHost.render` reaches the WebView
    // before the `loadCommand` response resolves and the per-session listeners below exist —
    // the render would be dropped and the view stuck on "Preparing view…". Raycast solves this
    // with its `Raycast.Backend.FrontendNotificationQueue`; buffer and replay here. The buffer
    // listeners are torn down and the real ones registered synchronously, so nothing is lost.
    const buffered: Array<{ method: (typeof BUFFERED_METHODS)[number]; raw: unknown }> = [];
    const BUFFERED_METHODS = ["render", "renderEmpty", "renderSuspense"] as const;
    const bufferUnsubs = BUFFERED_METHODS.map((name) =>
      onNotification(`extensionHost.${name}`, (raw) => buffered.push({ method: name, raw })),
    );

    (async () => {
      try {
        // Preference values are authoritative in the backend file (the Settings window is a
        // separate WebView2 profile); the passed-in `preferences` are only the localStorage
        // mirror. Refresh before loadCommand so every launch runs with the saved values.
        let effectivePreferences = preferences;
        try {
          const { fetchFlowkeyPreferences } = await import("./features/extensions/preferences");
          effectivePreferences = { ...preferences, ...(await fetchFlowkeyPreferences(extension.uuid)) };
        } catch {
          /* offline backend: launch with the mirror */
        }
        const loaded = (await ipc.backend.extensionHost.loadCommand({
          extension,
          command: { ...command, type: "command" },
          preferences: effectivePreferences,
          props,
          debug,
          origin: windowIdentifier,
        })) as LoadedCommand;
        if (cancelled || attempt !== loadAttemptRef.current) {
          // A newer load won; abandon this session.
          await ipc.backend.extensionHost
            .unloadEntryPoint({ sessionId: loaded.sessionId })
            .catch(() => undefined);
          return;
        }

        sessionIdRef.current = loaded.sessionId;
        setPhase("loaded");
        setIsLoading(false);

        // Raycast keys these subscriptions by session id. Same here.
        const handlers: Record<(typeof BUFFERED_METHODS)[number], (raw: unknown) => void> = {
          render: (raw) => {
            const message = raw as RenderMessage;
            if (message.sessionId !== loaded.sessionId) return;
            try {
              const decoded = decodeRenderTree(message.renderTree, message.gzipped);
              setSuspended(false);
              // flushSync equivalent: the model is applied in one synchronous batch.
              setRenderTree((previous) => mergeModel(previous, decoded));
            } catch (decodeError) {
              setError(decodeError instanceof Error ? decodeError : new Error(String(decodeError)));
            }
          },
          renderEmpty: (raw) => {
            const message = raw as { sessionId: string };
            if (message.sessionId !== loaded.sessionId) return;
            setIsLoading(false);
          },
          renderSuspense: (raw) => {
            const message = raw as { sessionId: string };
            if (message.sessionId !== loaded.sessionId) return;
            setSuspended(true);
          },
        };
        // Swap buffer listeners for the real ones synchronously — no drop window.
        for (const unsubscribe of bufferUnsubs) unsubscribe();
        for (const name of BUFFERED_METHODS) {
          unsubscribers.push(onNotification(`extensionHost.${name}`, handlers[name]));
        }
        // Replay whatever arrived before the session id was known.
        for (const { method, raw } of buffered) handlers[method](raw);

        // `extensionHost.showToast` / `showHUD` are handled globally in App.tsx (Raycast's renderer
        // handler table `Qne` is global too — the payload carries the sessionId its callbacks use).
        unsubscribers.push(
          onNotification("extensionHost.commandException", (raw) => {
            const message = raw as { sessionId: string; message?: string };
            if (message.sessionId !== loaded.sessionId) return;
            setError(new Error(message.message ?? "Command failed"));
          }),
        );
      } catch (loadError) {
        if (cancelled || attempt !== loadAttemptRef.current) return;
        for (const unsubscribe of bufferUnsubs) unsubscribe();
        setPhase("failure");
        setIsLoading(false);
        setError(loadError instanceof Error ? loadError : new Error(String(loadError)));
      }
    })();

    return () => {
      cancelled = true;
      for (const unsubscribe of bufferUnsubs) unsubscribe();
      for (const unsubscribe of unsubscribers) unsubscribe();
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        ipc.backend.extensionHost
          .unloadEntryPoint({ sessionId })
          .catch(() => undefined);
      }
      sessionIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension?.uuid, command?.name, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { phase, renderTree, error, isLoading, suspended, sessionId: sessionIdRef.current, createCallback, reload };
}

/** Apply `{model, changes}` on top of the previous model. */
function mergeModel(previous: RenderTree | null, decoded: { model: RenderTree; changes: unknown[] }): RenderTree {
  if (!Array.isArray(decoded.changes) || decoded.changes.length === 0) return decoded.model;
  // The diff is authoritative, but applying it path-by-path would need a JSON-patch engine; the
  // full model is always present so a straight replace is equivalent and simpler.
  void previous;
  return decoded.model;
}
