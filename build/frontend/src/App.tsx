// The launcher UI: Raycast's root search — the `apps` section (installed applications) plus the
// installed extension commands — and the running command's rendered view.
//
// Mirrors `Raycast.WebView.MainWindow` + the `NodeCommand` component tree in Raycast's
// `main-window-*.js` bundle. Section ordering follows the shipped manifest:
// `rootSearch: { section: "apps" }` puts applications first.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import {
  closeMainWindow,
  ipc,
  ipcRequest,
  installHostMessageListener,
  onNotification,
  openSettings,
} from "./ipc";
import { ExtensionCommand, useExtensionCommand, type ViewAction, type ViewBody } from "./useExtensionCommand";
import { RenderedView, SearchBarDropdown, flatItems, gridRowWidths, selectableIds } from "./RenderedView";
import {
  applyRender,
  emptyPages,
  popPage,
  popToRootPages,
  topPage,
  updateTop,
  type CommandPagesState,
} from "./commandPages";
import { alertStore, type ExtensionAlertPayload } from "./alertStore";
import AlertHost from "./AlertHost";
import { installTestHooks, isDevExtensionsEnabled, overrideTestHooks, setDevExtensions } from "./testHooks";
import { ActionPanel, type ActionGroup } from "./ActionPanel";
import {
  hudStore,
  setHostWindowVisible,
  styleToVariant,
  toastStore,
  type ExtensionHudPayload,
  type ExtensionToastPayload,
  type ToastState,
} from "./toastStore";

function nextToastId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `toast_${Math.random().toString(36).slice(2)}`;
}

/** `Hne`: after the window closes, the HUD is what remains — command icon at 22px in Raycast. */
function hudStoreOpenForExtension(title: string) {
  hudStore.open({ id: nextToastId(), title, variant: "default" }, { durationMs: 1200 });
}

/** `getToastActions()` — primary/secondary surface in the open action panel while the toast lives. */
function useToastActionGroups(): ActionGroup[] {
  const toast = useSyncExternalStore(
    toastStore.subscribe.bind(toastStore),
    toastStore.get.bind(toastStore),
  );
  return useMemo(() => {
    const actions = [toast?.primaryAction, toast?.secondaryAction].filter(Boolean);
    if (actions.length === 0) return [];
    return [
      {
        name: "toast",
        actions: actions.map((action, index) => ({
          id: index === 0 ? "toast:primary" : "toast:secondary",
          title: action!.title,
          shortcut: action!.shortcut,
        })),
      },
    ];
  }, [toast]);
}

/** Runs a toast action from the panel; returns false when the action is not a toast action. */
async function runToastAction(actionId: string): Promise<boolean> {
  if (actionId !== "toast:primary" && actionId !== "toast:secondary") return false;
  const toast = toastStore.get();
  const action =
    actionId === "toast:primary" ? toast?.primaryAction : toast?.secondaryAction;
  if (!action) return false;
  await action.action();
  toastStore.closeIfCurrent(toast ?? null);
  return true;
}
import { RaycastIcon } from "./icons";
import { applicationFavoriteKey, commandFavoriteKey, useFavorites } from "./favorites";
import {
  APPLICATION_AREA_KEYS,
  ApplicationCommand,
  runApplicationAction,
  useApplications,
  useApplicationGroups,
} from "./applications";
import { ClipboardHistoryView } from "./ClipboardHistoryView";
import { ArgsForm as QuicklinkArgsForm, QuicklinksView, type ArgsState as QuicklinkArgsState } from "./QuicklinksView";
import { isLikelyUrl, openQuicklink, setPendingCreateLink, useQuicklinks, type QuicklinkEntry } from "./quicklinks";
import {
  CLIPBOARD_AREA,
  plainTextOf,
  type ClipboardEntry,
  type ClipboardEntryAction,
} from "./clipboardHistory";
import {
  rankEntries,
  rankEntriesWithFallbacks,
  type RankedEntry,
  type Sensitivity,
  type FallbackCommand,
  type FileSearchResult,
  generateKeywords,
} from "./matching";
import { searchFiles, loadFileSearchConfig, loadFileUsageScores, trackFileUsage } from "./fileSearch";
import { getInlineSectionResults, loadInlineSectionSettings, type InlineSectionResult, type InlineSectionSettings } from "./inlineSections";
import {
  getCommandArguments,
  validateArguments,
  getDefaultArgumentValues,
  hasArguments,
  addArgumentHistory,
  getArgumentSuggestions,
  type ArgumentDefinition,
  type ArgumentValues,
} from "./arguments";

interface ExtensionSummary {
  uuid: string;
  name: string;
  title: string;
  description?: string;
  commands: Array<{ name: string; title: string; description?: string; mode?: "view" | "no-view" | "menu-bar" }>;
}

interface ExtensionEntry {
  kind: "extension";
  extension: ExtensionSummary;
  command: ExtensionSummary["commands"][number];
}

interface ApplicationEntry {
  kind: "application";
  application: ApplicationCommand;
}

/**
 * Raycast's internal `clipboard-history` extension is not a Node extension, so it is not part of the
 * installed-extension list. It is modelled here exactly like the internal Applications area: a
 * synthetic entry that opens a native view.
 */
interface ClipboardEntryResult {
  kind: "clipboard";
  commandId: string;
}

/** The Quicklinks internal extension: the search view plus one root row per stored quicklink. */
interface QuicklinksCommandEntry {
  kind: "quicklinks";
  commandId: string;
}

interface QuicklinkRowEntry {
  kind: "quicklink";
  quicklink: QuicklinkEntry;
}

/** `createWithURL`: offered while the search term itself is a URL. */
interface QuicklinkCreateEntry {
  kind: "quicklink-create";
  link: string;
}

const QUICKLINKS_COMMAND: QuicklinksCommandEntry = {
  kind: "quicklinks",
  commandId: "quicklinks/search",
};

/**
 * Fallback command entry - shown when no results match the search query.
 */
interface FallbackCommandEntry {
  kind: "fallback";
  command: FallbackCommand;
}

/**
 * File search result entry.
 */
interface FileEntry {
  kind: "file";
  file: FileSearchResult;
}

/**
 * Inline section result entry (calculator, quicklinks, snippets, web search).
 */
interface InlineEntry {
  kind: "inline";
  result: InlineSectionResult;
}

type RootEntry = ExtensionEntry | ApplicationEntry | ClipboardEntryResult | QuicklinksCommandEntry | QuicklinkRowEntry | QuicklinkCreateEntry | FallbackCommandEntry | FileEntry | InlineEntry;

interface SearchableEntry {
  title: string;
  subtitle: string | null;
  keywords: string[];
  rootEntry: RootEntry;
}

const CLIPBOARD_COMMAND: ClipboardEntryResult = {
  kind: "clipboard",
  commandId: `${CLIPBOARD_AREA}/history`,
};

const CLIPBOARD_FAVORITE_KEY = commandFavoriteKey(CLIPBOARD_AREA, "history");

interface MiniMarks {
  marks: string[];
}

/**
 * Raycast's Root Search splits its results into named sections and renders a header above each
 * one: `Favorites`, then the pinned `Applications` area, then the installed `Commands`. The
 * section shapes come from the shipped `rootSearch.section` values on the internal commands.
 */
type RootSectionId = "favorites" | "applications" | "commands" | "fallback-commands" | "files" | "calculator" | "quicklinks" | "snippets" | "web-search";

interface RootSection {
  id: RootSectionId;
  title: string;
  icon: string;
  entries: RootEntry[];
}

function buildSections(
  query: string,
  applications: ApplicationCommand[],
  extensions: ExtensionSummary[],
  favorites: string[],
  sensitivity: Sensitivity,
  usageScores: Map<string, number>,
  fallbackCommands: FallbackCommand[],
  fileResults: FileSearchResult[],
  inlineResults: InlineSectionResult[],
  quicklinkRows: QuicklinkEntry[]
): RootSection[] {
  // Build searchable entries for all applications
  const appSearchables: SearchableEntry[] = applications.map((app) => ({
    title: app.title,
    subtitle: app.subtitle,
    keywords: app.keywords,
    rootEntry: { kind: "application" as const, application: app },
  }));

  // Build searchable entries for clipboard history
  const clipboardSearchable: SearchableEntry = {
    title: "Clipboard History",
    subtitle: "Search for text, images, links and colors you copied earlier and paste it again.",
    keywords: ["clipboard history clipboard"],
    rootEntry: CLIPBOARD_COMMAND,
  };

  const quicklinksCommandSearchable: SearchableEntry = {
    title: "Search Quicklinks",
    subtitle: "Search all your quicklinks.",
    keywords: ["quicklinks"],
    rootEntry: QUICKLINKS_COMMAND,
  };

  // Dynamic quicklink rows: title = name, keywords include the `quicklink` tag (Raycast's
  // `dynamicCommands.quicklink`).
  const quicklinkSearchables: SearchableEntry[] = quicklinkRows.map((entry) => ({
    title: entry.name,
    subtitle: entry.link,
    keywords: ["quicklink", ...entry.tags.map((tag) => tag.toLowerCase())],
    rootEntry: { kind: "quicklink" as const, quicklink: entry },
  }));

  // Build searchable entries for extension commands
  const commandSearchables: SearchableEntry[] = [];
  for (const extension of extensions) {
    for (const command of extension.commands ?? []) {
      if (command.mode === "no-view") continue;
      // Dev-only test extensions stay hidden unless the flag is on: localStorage
      // `raycast-mini:dev-extensions=1`, or the host's `--dev-extensions` / env equivalent.
      if (extension.name === "command-ux-test" && !isDevExtensionsEnabled()) continue;
      const entry: ExtensionEntry = { kind: "extension", extension, command };
      commandSearchables.push({
        title: command.title,
        subtitle: command.description ?? extension.title,
        keywords: generateKeywords(`${extension.title} ${command.title}`, command.description ?? ""),
        rootEntry: entry,
      });
    }
  }

  // Combine all searchable entries
  const allSearchables = [...appSearchables, clipboardSearchable, quicklinksCommandSearchable, ...commandSearchables, ...quicklinkSearchables];

  // Rank all entries using the full Raycast algorithm with fallback support
  const { results: ranked, showFallbacks } = rankEntriesWithFallbacks(
    allSearchables,
    query,
    sensitivity,
    usageScores,
    fallbackCommands
  );

  // Separate favorites from regular results
  const favoriteRows = new Set<RootEntry>();
  for (const key of favorites) {
    const entry = ranked.find((r) => {
      const re = r.entry.rootEntry;
      if (re.kind === "application") {
        return applicationFavoriteKey(re.application.payload.id) === key;
      } else if (re.kind === "clipboard") {
        return CLIPBOARD_FAVORITE_KEY === key;
      } else if (re.kind === "extension") {
        return commandFavoriteKey(re.extension.uuid, re.command.name) === key;
      }
      return false;
    });
    if (entry) favoriteRows.add(entry.entry.rootEntry);
  }

  const favoriteEntries = favorites
    .map((key) => {
      const rankedEntry = ranked.find((r) => {
        const re = r.entry.rootEntry;
        if (re.kind === "application") {
          return applicationFavoriteKey(re.application.payload.id) === key;
        } else if (re.kind === "clipboard") {
          return CLIPBOARD_FAVORITE_KEY === key;
        } else if (re.kind === "extension") {
          return commandFavoriteKey(re.extension.uuid, re.command.name) === key;
        }
        return false;
      });
      return rankedEntry?.entry.rootEntry;
    })
    .filter((e): e is RootEntry => e !== undefined);

  // Filter out favorites from regular results
  const regularResults = ranked.filter((r) => !favoriteRows.has(r.entry.rootEntry));

  // Separate by type
  const apps = regularResults
    .filter((r) => r.entry.rootEntry.kind === "application")
    .map((r) => r.entry.rootEntry);
  const clipboardEntries = favorites.includes(CLIPBOARD_FAVORITE_KEY)
    ? []
    : regularResults.filter((r) => r.entry.rootEntry.kind === "clipboard").map((r) => r.entry.rootEntry);
  const quicklinksCommandEntries = regularResults
    .filter((r) => r.entry.rootEntry.kind === "quicklinks")
    .map((r) => r.entry.rootEntry);
  const commands = regularResults
    .filter((r) => r.entry.rootEntry.kind === "extension")
    .map((r) => r.entry.rootEntry);

  // Handle fallback commands - they appear as a separate section when shown
  const fallbackEntries = showFallbacks
    ? fallbackCommands.map((cmd) => ({ kind: "fallback" as const, command: cmd }))
    : [];

  // File search results
  const fileEntries = fileResults.map((file) => ({ kind: "file" as const, file }));

  // Inline section results - group by type
  const calculatorEntries = inlineResults
    .filter((r) => r.type === "calculator")
    .map((result) => ({ kind: "inline" as const, result }));
  const quicklinkCreateEntries: QuicklinkCreateEntry[] = isLikelyUrl(query)
    ? [{ kind: "quicklink-create", link: query.trim() }]
    : [];
  const snippetEntries = inlineResults
    .filter((r) => r.type === "snippet")
    .map((result) => ({ kind: "inline" as const, result }));
  const webSearchEntries = inlineResults
    .filter((r) => r.type === "web-search")
    .map((result) => ({ kind: "inline" as const, result }));

  const sections: RootSection[] = [
    { id: "favorites", title: "Favorites", icon: "star", entries: favoriteEntries },
  ];

  // Calculator section (highest priority inline section) - appears before applications
  if (calculatorEntries.length > 0) {
    sections.push({ id: "calculator", title: "Calculator", icon: "calculator", entries: calculatorEntries });
  }

  // Applications section
  if (apps.length > 0) {
    sections.push({ id: "applications", title: "Applications", icon: "app-window-list", entries: apps });
  }

  // Commands section
  if (clipboardEntries.length > 0 || quicklinksCommandEntries.length > 0 || commands.length > 0) {
    sections.push({ id: "commands", title: "Commands", icon: "Blocks", entries: [...clipboardEntries, ...quicklinksCommandEntries, ...commands] });
  }

  // Quicklinks section: the createWithURL entry, then dynamic quicklink rows. Dynamic rows only
  // show while searching — Raycast's dynamic quicklink commands are searchable, not always visible.
  const searching = query.trim().length > 0;
  const quicklinkRowsShown = searching
    ? regularResults.filter((r) => r.entry.rootEntry.kind === "quicklink").map((r) => r.entry.rootEntry)
    : [];
  if (quicklinkCreateEntries.length > 0 || quicklinkRowsShown.length > 0) {
    sections.push({ id: "quicklinks", title: "Quicklinks", icon: "link", entries: [...quicklinkCreateEntries, ...quicklinkRowsShown] });
  }

  // Snippets section
  if (snippetEntries.length > 0) {
    sections.push({ id: "snippets", title: "Snippets", icon: "copy", entries: snippetEntries });
  }

  // Files section (after commands, before fallback)
  if (fileEntries.length > 0) {
    sections.push({ id: "files", title: "Files", icon: "file-text", entries: fileEntries });
  }

  // Web search suggestions (lowest priority)
  if (webSearchEntries.length > 0) {
    sections.push({ id: "web-search", title: "Search Web", icon: "globe", entries: webSearchEntries });
  }

  if (showFallbacks && fallbackEntries.length > 0) {
    sections.push({ id: "fallback-commands", title: "Fallback Commands", icon: "Blocks", entries: fallbackEntries });
  }

  return sections;
}

const ROOT_SECTION_ICON_SIZE = 15;

// Ordered breadcrumbs the host can read back with ExecuteScriptAsync, so a UI that renders but
// never issues IPC is diagnosable from launcher.log.
const marks: MiniMarks = {
  marks: ["app-module-evaluated", `exported-application-area-keys=${APPLICATION_AREA_KEYS.join(",")}`],
};
(window as unknown as { __raycastMiniMarks: MiniMarks }).__raycastMiniMarks = marks;

/**
 * Raycast's live refresh: the clipboard view subscribes to `clipboard.stateChanged`, which the Node
 * backend emits whenever the store mutates (`ipcNotification.clipboard.subscribeStateChanged`).
 */
function subscribeClipboardStateChanged(handler: () => void): () => void {
  return onNotification("clipboard.stateChanged", () => handler());
}

/** Paste/Copy for a clipboard row: the host writes the entry and hands focus back to the app. */
async function runClipboardEntryAction(
  entry: ClipboardEntry,
  action: ClipboardEntryAction,
): Promise<void> {
  if (action === "copy" || action === "pasteAndKeepOpen") {
    const method = action === "copy" ? "clipboard.copy" : "clipboard.paste";
    await ipc.backend(
      method,
      { id: entry.id, shouldCloseWindow: action === "copy", keepWindowOpen: action !== "copy" },
      { module: "backend" },
    );
    return;
  }
  if (action === "paste") {
    await ipc.backend("clipboard.paste", { id: entry.id, shouldCloseWindow: true }, { module: "backend" });
    return;
  }
  const text = plainTextOf(entry);
  await ipc.backend(
    "clipboard.paste",
    { text: text ?? "", sourceEntryId: entry.id, shouldCloseWindow: true },
    { module: "backend" },
  );
}

async function openClipboardUrl(url: string): Promise<void> {
  await ipc.backend("clipboard.openUrl", { url }, { module: "backend" });
}

// Raycast's navigation-bar loading indicator: shown only after `isLoading` has been true for
// 300ms, then fades in/out, exactly like `NavigationBarUI.Root` in the shipped bundle.
function LoadingBar({ isLoading }: { isLoading: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setVisible(true), 300);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [isLoading]);
  return <div className="loader-bar" data-state={visible ? "loading" : undefined} />;
}

/**
 * Raycast keeps the root search field focused at all times: clicking a row, the footer or the
 * window body never moves focus out of the input. `preventDefault` on mousedown stops the
 * browser from moving focus while leaving the click (selection, buttons) fully functional.
 */
function keepSearchFocus(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".searchbar, .action-panel__filter")) return;
  event.preventDefault();
}

export function MainWindow() {
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selected, setSelected] = useState<RootEntry | null>(null);
  const [openApplication, setOpenApplication] = useState<ApplicationCommand | null>(null);
  // Action panel for a command row (extension commands and the synthetic Clipboard History
  // entry) — Raycast's root search opens the same action popover for every result kind, not
  // just applications.
  const [commandPanelEntry, setCommandPanelEntry] = useState<ExtensionEntry | ClipboardEntryResult | null>(
    null,
  );
  const [hostError, setHostError] = useState<string | null>(null);
  const [extensionsLoading, setExtensionsLoading] = useState(true);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("medium");
  const [usageScores, setUsageScores] = useState<Map<string, number>>(new Map());
  const [fallbackCommands, setFallbackCommands] = useState<FallbackCommand[]>([]);
  const [fileSearchConfig, setFileSearchConfig] = useState(() => loadFileSearchConfig());
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [fileUsageScores, setFileUsageScores] = useState(() => loadFileUsageScores());
  const [inlineSectionSettings, setInlineSectionSettings] = useState(() => loadInlineSectionSettings());
  const [inlineResults, setInlineResults] = useState<InlineSectionResult[]>([]);
  // Quicklinks: one root row per stored quicklink, refreshed on `quicklinks.updated`.
  const { quicklinks: quicklinkRows } = useQuicklinks();
  const [quicklinkArgs, setQuicklinkArgs] = useState<QuicklinkEntry | null>(null);
  const [quicklinkCreateLink, setQuicklinkCreateLink] = useState<string | null>(null);
  // Argument input state
  const [argumentEntry, setArgumentEntry] = useState<ExtensionEntry | null>(null);
  const [argumentValues, setArgumentValues] = useState<ArgumentValues>({});
  const [argumentErrors, setArgumentErrors] = useState<string[]>([]);
  const [argumentFocusIndex, setArgumentFocusIndex] = useState(0);
  // Search history state
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("raycast-mini:search-history");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  // Pop to root timeout state
  const [popToRootTimer, setPopToRootTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [popToRootTimeout, setPopToRootTimeout] = useState(() => {
    try {
      const stored = localStorage.getItem("raycast-mini:pop-to-root-timeout");
      return stored ? Number(stored) : 30000; // Default 30 seconds
    } catch {
      return 30000;
    }
  });
  const listRef = useRef<HTMLUListElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  // Mirrors "is an action panel open" for the window-level key handlers. React state inside a
  // keydown closure can be a render stale (an action just closed the panel within the same
  // keystroke), so the guard reads the ref — always current — instead of the closure value.
  const panelOpenRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { favorites, isFavorite, toggleFavorite } = useFavorites();

  // Root-search and internal UI confirmations go through the same store the extension API uses —
  // Raycast's internal actions also call `showToast` (e.g. `Copy Error`), variant `success`.
  const showToast = useCallback((title: string, message?: string) => {
    toastStore.open({ id: nextToastId(), title, message, variant: "success" });
  }, []);

  const actionHandlers = useMemo(
    () => ({
      toggleFavorite: (app: ApplicationCommand["payload"]) =>
        toggleFavorite(applicationFavoriteKey(app.id)),
      openSettings,
      showToast,
    }),
    [toggleFavorite, showToast],
  );

  // Load usage scores from backend on mount
  useEffect(() => {
    const loadUsage = async () => {
      try {
        const response = await ipc.backend("usage.getAppUsage", {}, { module: "backend" });
        const data = response as { usage?: Record<string, number> };
        if (data.usage) {
          const map = new Map<string, number>(Object.entries(data.usage));
          setUsageScores(map);
        }
      } catch (error) {
        console.warn("[usage] Failed to load app usage:", error);
        // Fallback to localStorage for migration
        const scores = new Map<string, number>();
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("raycast-mini:usage:")) {
              const appId = key.slice("raycast-mini:usage:".length);
              const count = Number.parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
              scores.set(appId, count);
            }
          }
        } catch {
          // Ignore localStorage errors
        }
        setUsageScores(scores);
      }
    };
    loadUsage();
  }, []);

  // Load sensitivity from localStorage and listen for changes from Settings window
  useEffect(() => {
    const stored = localStorage.getItem("raycast-mini:root-search-sensitivity");
    if (stored === "low" || stored === "medium" || stored === "high") {
      setSensitivity(stored);
    }

    const handleSensitivityChange = (event: CustomEvent<Sensitivity>) => {
      setSensitivity(event.detail);
    };
    window.addEventListener("raycast-mini:root-search-sensitivity-changed", handleSensitivityChange as EventListener);
    return () => window.removeEventListener("raycast-mini:root-search-sensitivity-changed", handleSensitivityChange as EventListener);
  }, []);

  // Load fallback commands from localStorage and listen for changes from Settings window
  useEffect(() => {
    const stored = localStorage.getItem("raycast-mini:fallback-commands");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as FallbackCommand[];
        setFallbackCommands(parsed.filter((cmd) => cmd.id && cmd.title));
      } catch {
        // Ignore parse errors
      }
    }

    const handleFallbackChange = (event: CustomEvent<FallbackCommand[]>) => {
      setFallbackCommands(event.detail);
    };
    window.addEventListener("raycast-mini:fallback-commands-changed", handleFallbackChange as EventListener);
    return () => window.removeEventListener("raycast-mini:fallback-commands-changed", handleFallbackChange as EventListener);
  }, []);

  // File search - search files when query changes and file search is enabled
  useEffect(() => {
    if (!fileSearchConfig.enabled || searchText.trim().length === 0) {
      setFileResults([]);
      return;
    }
    
    const trimmed = searchText.trim();
    const results = searchFiles(trimmed, fileSearchConfig, fileUsageScores);
    results.then(setFileResults);
  }, [searchText, fileSearchConfig, fileUsageScores]);

  // Inline sections - update results when query changes
  useEffect(() => {
    if (searchText.trim().length === 0) {
      setInlineResults([]);
      return;
    }
    
    const results = getInlineSectionResults(searchText).filter((r) => {
      if (r.type === "calculator" && !inlineSectionSettings.calculator) return false;
      if (r.type === "snippet" && !inlineSectionSettings.snippets) return false;
      if (r.type === "web-search" && !inlineSectionSettings.webSearch) return false;
      return true;
    });
    
    setInlineResults(results);
  }, [searchText, inlineSectionSettings]);

  // Listen for file search config changes from Settings
  useEffect(() => {
    const handleConfigChange = (event: CustomEvent) => {
      setFileSearchConfig(event.detail);
    };
    window.addEventListener("raycast-mini:file-search-config-changed", handleConfigChange as EventListener);
    return () => window.removeEventListener("raycast-mini:file-search-config-changed", handleConfigChange as EventListener);
  }, []);

  // Listen for inline section settings changes from Settings
  useEffect(() => {
    const handleSettingsChange = (event: CustomEvent<InlineSectionSettings>) => {
      setInlineSectionSettings(event.detail);
    };
    window.addEventListener("raycast-mini:inline-section-settings-changed", handleSettingsChange as EventListener);
    return () => window.removeEventListener("raycast-mini:inline-section-settings-changed", handleSettingsChange as EventListener);
  }, []);

  // Pop to root on hide: Raycast resets to root search after the window has been closed for the
  // configured timeout ("Pop to Root Search"). Hiding starts the timer; showing cancels it. Both
  // the document visibilitychange and the host’s explicit `window.visibilityChanged` push feed the
  // same timer — WPF Hide() does not always surface as a renderer visibility event.
  const popToRootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handleVisibility = (visible: boolean) => {
      // The toast store mirrors host visibility: a live in-window toast migrates to the HUD.
      setHostWindowVisible(visible);
      if (visible) {
        if (popToRootTimerRef.current) {
          clearTimeout(popToRootTimerRef.current);
          popToRootTimerRef.current = null;
        }
        setPopToRootTimer(null);
        return;
      }
      if (popToRootTimeout <= 0) return;
      if (popToRootTimerRef.current) return;
      const timer = setTimeout(() => {
        popToRootTimerRef.current = null;
        setPopToRootTimer(null);
        setSelected(null);
        setOpenApplication(null);
        setCommandPanelEntry(null);
        setArgumentEntry(null);
      }, popToRootTimeout);
      popToRootTimerRef.current = timer;
      setPopToRootTimer(timer);
    };
    const onDocumentVisibility = () => handleVisibility(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onDocumentVisibility);
    const offHost = onNotification('window.visibilityChanged', (raw) => {
      const payload = raw as { visible?: boolean };
      handleVisibility(payload.visible === true);
    });
    return () => {
      document.removeEventListener('visibilitychange', onDocumentVisibility);
      offHost();
      if (popToRootTimerRef.current) {
        clearTimeout(popToRootTimerRef.current);
        popToRootTimerRef.current = null;
      }
    };
  }, [popToRootTimeout]);

  useEffect(() => {
    marks.marks.push("effects:installed-host-message-listener");
    installHostMessageListener();
    const refreshExtensions = async () => {
      const payload = (await ipc.backend("extensionHost.getInstalledNodeExtensionSummaries")) as {
        extensions?: ExtensionSummary[];
      };
      setExtensions(payload.extensions ?? []);
    };
    // The host forwards `--dev-extensions` / RAYCAST_MINI_DEV_EXTENSIONS=1; the push can race this
    // module's first render, so the flag is also pulled once here.
    const pullDevFlag = async () => {
      try {
        const value = (await ipcRequest("window.getDevExtensions", {}, { module: "frontend" })) as {
          enabled?: boolean;
        } | null;
        if (value?.enabled === true) {
          setDevExtensions(true);
          void refreshExtensions();
        }
      } catch {
        /* best-effort: the flag stays off without a host object (browser harness) */
      }
    };
    void pullDevFlag();
    // The host push (and any later flip) refreshes the list too.
    const offDev = onNotification("window.devExtensions", (raw) => {
      const payload = raw as { enabled?: boolean };
      if (payload.enabled !== true) return;
      setDevExtensions(true);
      void refreshExtensions().catch(() => undefined);
    });
    // Dev automation channel: an external driver posts a script through the pipe, the renderer
    // turns it into a real `window.eval` host call (which logs the result for the driver).
    const offTestScript = onNotification("window.runTestScript", (raw) => {
      const payload = raw as { script?: string };
      if (!payload.script || !isDevExtensionsEnabled()) return;
      void ipcRequest("window.eval", { script: payload.script }, { module: "frontend" }).catch(
        () => undefined,
      );
    });
    return () => {
      offDev();
      offTestScript();
    };
  }, []);

  // The Clipboard History global hotkey asks the host to reveal the launcher already pointing at that
  // command, the same way Raycast's per-command hotkeys behave.
  useEffect(() => {
    const off = onNotification("raycast.mini.navigate", (route) => {
      if (route !== "/extension/clipboard-history") return;
      setSearchText("");
      setSelected(CLIPBOARD_COMMAND);
    });
    return off;
  }, []);

  // The renderer-side toast/HUD handlers. Raycast's equivalents live in `main-window-g1Vb1JLY.js`:
  //
  //   function showToastHandler(e) {                     // Ine
  //     e.instance && e.instance !== window.identifier
  //       ? nodeExtensionUI.send({ window: e.instance, data: { type: `showToast`, params: e } })
  //       : toastStore.open({ title, message, variant: styleToVariant(e.style), onClose, primaryAction, secondaryAction });
  //   }
  //   async function showHUDHandler(e) {                 // Hne
  //     await closeMainWindow({ clearSearch, popToRootType });
  //     hudStore.open({ title, icon: commandIcon(…) });
  //   }
  //
  // Actions/onHide travel as callback ids and loop back through `callNodeCallback`.
  useEffect(() => {
    marks.marks.push("effects:subscribed-notifications");
    const callExtensionCallback = (sessionId: string | undefined, callbackId: string | undefined) => {
      if (!sessionId || !callbackId) return;
      void ipc.backend.extensionHost
        .callNodeCallback({ sessionId, callbackId, data: {} })
        .catch((error) => console.error("[toast] callback failed", error));
    };
    const offToast = onNotification("extensionHost.showToast", (raw) => {
      const payload = raw as ExtensionToastPayload;
      const toast: ToastState = {
        id: nextToastId(),
        title: payload.title ?? "",
        message: payload.message,
        variant: styleToVariant(payload.style),
        onClose: () => callExtensionCallback(payload.sessionId, payload.onHide),
        primaryAction: payload.primaryAction
          ? {
              title: payload.primaryAction.title,
              shortcut: payload.primaryAction.shortcut,
              action: () => callExtensionCallback(payload.sessionId, payload.primaryAction?.onAction),
            }
          : undefined,
        secondaryAction: payload.secondaryAction
          ? {
              title: payload.secondaryAction.title,
              shortcut: payload.secondaryAction.shortcut,
              action: () => callExtensionCallback(payload.sessionId, payload.secondaryAction?.onAction),
            }
          : undefined,
      };
      toastStore.open(toast);
    });
    const offHud = onNotification("extensionHost.showHUD", (raw) => {
      const payload = raw as ExtensionHudPayload;
      // Raycast's `Hne` closes/pops the main window first — the HUD is what remains on screen.
      closeMainWindow();
      void payload.clearRootSearch;
      void payload.popToRootType;
      toastStore.get()?.onClose?.();
      hudStoreOpenForExtension(payload.title ?? "");
    });
    const offHideToast = onNotification("extensionHost.hideToast", () => {
      toastStore.close();
    });
    // No-view command exceptions have nowhere to render — Raycast surfaces them as a failure
    // toast with a built-in `Copy Error` action (`Pne` in the main-window bundle).
    const offException = onNotification("extensionHost.commandException", (raw) => {
      const payload = raw as { sessionId?: string; title?: string; message?: string; name?: string };
      const detail = [payload.name, payload.message].filter(Boolean).join(": ");
      const formatted = detail || "Command failed";
      toastStore.open({
        id: nextToastId(),
        title: payload.title || "Command failed",
        message: payload.message,
        variant: "failure",
        primaryAction: {
          title: "Copy Error",
          action: async () => {
            try {
              await navigator.clipboard.writeText(formatted);
              showToast("Error copied to Clipboard");
            } catch {
              showToast("Couldn't copy error");
            }
          },
        },
      });
    });
    // Extension-initiated `closeMainWindow()` (`closeMainRaycastWindow`): the backend forwards it
    // here; hiding is the host's job (`window.close`), like Raycast's `closeMainRaycastWindow` →
    // `Raycast.WebView.Window` close. Without this the window stays visible and the toast never
    // falls back to the floating HUD.
    const offCloseWindow = onNotification("extensionHost.closeMainRaycastWindow", () => {
      closeMainWindow();
    });
    // `extensionHost.showAlert` (`Une`): route the payload into the alert store; the primary /
    // dismiss callbacks loop back through `callNodeCallback`, which is what resolves the
    // extension's `confirmAlert` promise.
    const offAlert = onNotification("extensionHost.showAlert", (raw) => {
      const payload = raw as ExtensionAlertPayload;
      const callExtensionCallback = (callbackId: string | undefined) => () => {
        if (!callbackId) return;
        void ipc.backend.extensionHost
          .callNodeCallback({ sessionId: payload.sessionId, callbackId, data: {} })
          .catch((error) => console.error("[alert] callback failed", error));
      };
      alertStore.open({
        title: payload.title ?? "",
        description: payload.message,
        icon: payload.icon,
        primaryAction: payload.primaryAction
          ? {
              title: payload.primaryAction.title ?? "Confirm",
              style: payload.primaryAction.style,
              action: callExtensionCallback(payload.primaryAction.onAction),
            }
          : undefined,
        secondaryAction: payload.secondaryAction
          ? {
              title: payload.secondaryAction.title ?? "",
              style: payload.secondaryAction.style,
              action: callExtensionCallback(payload.secondaryAction.onAction),
            }
          : undefined,
        dismissAction: payload.dismissAction
          ? {
              title: payload.dismissAction.title ?? "Cancel",
              style: payload.dismissAction.style,
              action: callExtensionCallback(payload.dismissAction.onAction),
            }
          : { title: "Cancel", action: () => undefined },
      });
    });
    return () => {
      offToast();
      offHud();
      offHideToast();
      offException();
      offCloseWindow();
      offAlert();
    };
  }, []);

  useEffect(() => {
    marks.marks.push("effect:extensions-requested");
    ipc
      .backend("extensionHost.getInstalledNodeExtensionSummaries")
      .then((payload) => setExtensions((payload as { extensions?: ExtensionSummary[] }).extensions ?? []))
      .catch((error) => setHostError(error instanceof Error ? error.message : String(error)))
      .finally(() => setExtensionsLoading(false));
  }, []);

  const { applications, error: applicationsError, loading: applicationsLoading } = useApplications(true);

  const rootLoading = applicationsLoading || extensionsLoading;

  // Update usage scores when applications are loaded
  useEffect(() => {
    if (applications.length > 0) {
      const newScores = new Map(usageScores);
      let changed = false;
      for (const app of applications) {
        try {
          const raw = localStorage.getItem(`raycast-mini:usage:${app.payload.id}`);
          const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
          if (newScores.get(app.payload.id) !== count) {
            newScores.set(app.payload.id, count);
            changed = true;
          }
        } catch {
          // Ignore
        }
      }
      if (changed) setUsageScores(newScores);
    }
  }, [applications, usageScores]);

  // Root Search renders Favorites / Applications / Commands as named sections, exactly like
  // Raycast's root search, and the flat selection index walks all of them in order.
  const sections = useMemo(
    () => buildSections(searchText, applications, extensions, favorites, sensitivity, usageScores, fallbackCommands, fileResults, inlineResults, quicklinkRows),
    [searchText, applications, extensions, favorites, sensitivity, usageScores, fallbackCommands, fileResults, inlineResults, quicklinkRows],
  );

  const entries = useMemo(() => sections.flatMap((section) => section.entries), [sections]);

  // Dev-only automation hooks (`--dev-extensions`), driven through the host's `window.eval`.
  useEffect(() => {
    if (!isDevExtensionsEnabled()) return;
    installTestHooks({
      openCommand: (query) => {
        const q = query.toLowerCase();
        const match = entries.find(
          (entry) => entry.kind === "extension" && entry.command.title.toLowerCase().includes(q),
        );
        if (!match || match.kind !== "extension") return null;
        setSelected(match);
        return { title: match.command.title };
      },
      rootSearch: (query) => {
        setSelected(null);
        setSearchText(query);
      },
      press: () => false,
      state: () => ({ view: "root", entries: entries.length, search: searchText }),
    });
  }, [entries, searchText]);

  const selectedEntry = entries[selectedIndex];
  panelOpenRef.current = openApplication !== null || commandPanelEntry !== null;

  // Hooks must run before any early return, so the action source is resolved here.
  const panelApp = openApplication?.payload ?? null;
  const panelGroups = useApplicationGroups(panelApp, {
    favorite: panelApp ? isFavorite(applicationFavoriteKey(panelApp.id)) : false,
  });

  // Raycast's root action panel for a command result: run it, pin it, configure it. The
  // synthetic Clipboard History entry shares the panel; only the favorite key differs.
  const commandPanelGroups = useMemo<ActionGroup[]>(() => {
    if (!commandPanelEntry) return [];
    const key =
      commandPanelEntry.kind === "clipboard"
        ? CLIPBOARD_FAVORITE_KEY
        : commandFavoriteKey(commandPanelEntry.extension.uuid, commandPanelEntry.command.name);
    return [
      { name: "general", actions: [{ id: "command:open", title: "Open Command", itemId: key }] },
      {
        name: "favorites",
        actions: [
          {
            id: "command:favorite",
            title: isFavorite(key) ? "Remove from Favorites" : "Add to Favorites",
            itemId: key,
          },
        ],
      },
      {
        name: "configure",
        actions: [{ id: "command:configureCommand", title: "Configure Command", itemId: key }],
      },
    ];
  }, [commandPanelEntry, isFavorite]);

  // Ctrl+K / right-click / footer button all funnel through here, whatever the row is.
  const openRootActionPanel = useCallback((entry: RootEntry | undefined) => {
    if (!entry) return;
    if (entry.kind === "application") setOpenApplication(entry.application);
    // Extension commands AND the Clipboard History entry get the command action panel —
    // Ctrl+K must never run the command directly.
    else if (entry.kind === "quicklinks" || entry.kind === "quicklink-create") setSelected(entry);
    else if (entry.kind !== "fallback" && entry.kind !== "file" && entry.kind !== "inline" && entry.kind !== "quicklink") setCommandPanelEntry(entry);
  }, []);

  // Opening a quicklink from root search: required placeholders collect their values through the
  // shared argument form first (Raycast's `/snippets/argument-form`), then the backend resolves the
  // link and the host opens it.
  const openQuicklinkRow = useCallback(
    (entry: QuicklinkEntry) => {
      if (entry.argsError) {
        showToast("Unable to open quicklink", entry.argsError);
        return;
      }
      if (entry.args.some((arg) => arg.required && !arg.value)) {
        setQuicklinkArgs(entry);
        return;
      }
      closeMainWindow();
      void openQuicklink(entry.id, entry.args.map((arg) => arg.value)).catch((error) => {
        showToast("Unable to open quicklink", error instanceof Error ? error.message : String(error));
      });
    },
    [closeMainWindow, showToast],
  );


// Argument input helpers
  const closeArgumentInput = useCallback(() => {
    setArgumentEntry(null);
    setArgumentValues({});
    setArgumentErrors([]);
    setArgumentFocusIndex(0);
    searchRef.current?.focus();
  }, []);

  const isArgumentFormValid = useCallback(() => {
    if (!argumentEntry) return false;
    const args = getCommandArguments(argumentEntry.command);
    for (const arg of args) {
      if (arg.required && (!argumentValues[arg.name] || argumentValues[arg.name].trim().length === 0)) {
        return false;
      }
    }
    return true;
  }, [argumentEntry, argumentValues]);

  const handleArgumentSubmit = useCallback(() => {
    if (!argumentEntry || !isArgumentFormValid()) return;
    
    const args = getCommandArguments(argumentEntry.command);
    const { valid, errors } = validateArguments(args, argumentValues);
    
    if (!valid) {
      setArgumentErrors(errors.map((e) => e.split('"')[1] ?? e));
      return;
    }
    
    // Save argument history
    for (const arg of args) {
      if (argumentValues[arg.name]) {
        addArgumentHistory(argumentEntry.extension.uuid, arg.name, argumentValues[arg.name]);
      }
    }
    
    // Execute command with arguments
    const entry = argumentEntry;
    closeArgumentInput();
    setSelected(entry);
  }, [argumentEntry, argumentValues, isArgumentFormValid, closeArgumentInput]);

  // When an action panel closes, focus returns to the search field — Raycast's root search is
  // never left unfocused.
  useEffect(() => {
    if (!openApplication && !commandPanelEntry) searchRef.current?.focus();
  }, [openApplication, commandPanelEntry]);

  // Focus safety net: if focus ever lands on the body (a click the browser focused anyway, a
  // dismissed popup), printable keys and Backspace are routed straight into the search field,
  // like Raycast's always-focused root search.
  useEffect(() => {
    if (openApplication || commandPanelEntry || selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        setSearchText((text) => text.slice(0, -1));
        searchRef.current?.focus();
      } else if (event.key.length === 1) {
        event.preventDefault();
        setSearchText((text) => text + event.key);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [openApplication, commandPanelEntry, selected]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchText]);

// Keyboard navigation is handled globally (not on the search input) so arrow keys move the
  // selection and scroll-follow the list no matter where focus is — Raycast's root search behaves
  // the same way whether you click the input or a row. Also handles Ctrl+K (action panel) and Enter.
  useEffect(() => {
    // A running command owns the keyboard (CommandViewKeyboard); the root list must not also
    // react to the same keystroke or arrows/Enter "leak" into the search page underneath.
    if (panelOpenRef.current || selected || quicklinkArgs) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === "Escape") return; // dedicated Escape handler below
      if (key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openRootActionPanel(entries[selectedIndex]);
        return;
      }
      if (key === "ArrowDown" || (key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, entries.length - 1));
      } else if (key === "ArrowUp" || (key === "Tab" && event.shiftKey)) {
        // Up arrow in empty search bar shows search history
        if (searchText.trim() === "" && searchHistory.length > 0) {
          event.preventDefault();
          const lastQuery = searchHistory[searchHistory.length - 1];
          setSearchText(lastQuery);
          setSearchHistory((prev) => prev.slice(0, -1)); // Remove last item as it's now active
          return;
        }
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (key === "Enter") {
        if (panelOpenRef.current) return;
        const entry = entries[selectedIndex];
        if (!entry) return;
        event.preventDefault();
        // Save search history
        if (searchText.trim() !== "") {
          setSearchHistory((prev) => {
            const filtered = prev.filter((q) => q !== searchText.trim());
            return [...filtered, searchText.trim()].slice(-50); // Keep last 50
          });
        }
        if (entry.kind === "application") openApplicationEntry(entry.application);
        else if (entry.kind === "quicklink") openQuicklinkRow(entry.quicklink);
        else if (entry.kind === "quicklinks") setSelected(entry);
        else if (entry.kind === "quicklink-create") {
          setQuicklinkCreateLink(entry.link);
          setPendingCreateLink(entry.link);
          setSelected(QUICKLINKS_COMMAND);
        }
        else if (entry.kind === "extension" && hasArguments(entry.command)) {
          // Show argument input UI
          const args = getCommandArguments(entry.command);
          setArgumentValues(getDefaultArgumentValues(args));
          setArgumentErrors([]);
          setArgumentFocusIndex(0);
          setArgumentEntry(entry);
        } else if (entry.kind === "inline") {
          // Inline entries (calculator, quicklink, snippet, web-search) execute their action and stay/close
          entry.result.action(searchText, closeMainWindow);
          // Optionally close or keep open - for calculator, stay open
        } else {
          setSelected(entry);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entries, selectedIndex, openApplication, commandPanelEntry, selected, quicklinkArgs, openQuicklinkRow, openRootActionPanel]);

  // Escape closes the launcher, matching Raycast: the window hides and the global hotkey brings it
  // back. While the action panel is open it owns Escape (capture handler + stopPropagation), and a
  // running command handles its own Escape to pop back.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panelOpenRef.current || selected) return;
      event.preventDefault();
      closeMainWindow();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [openApplication, commandPanelEntry, selected]);


  useEffect(() => {
    // Raycast keeps the selection visible as you arrow through the list. Scrolling the body
    // explicitly is more reliable than `scrollIntoView` inside the nested flex/overflow chain.
    const container = bodyRef.current;
    const row = listRef.current?.querySelector<HTMLElement>('.list__row[data-selected="true"]');
    if (!container || !row) return;
    const rowRect = row.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (rowRect.top < viewRect.top) {
      container.scrollTop -= viewRect.top - rowRect.top + 4;
    } else if (rowRect.bottom > viewRect.bottom) {
      container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
    }
  }, [selectedIndex, entries.length, searchText]);

  // Running an application action hides the launcher immediately — Raycast gets the window out
  // of the way the moment an action runs, while the host does its work in the background. The
  // 30s app cache on the host side keeps the action itself fast too.
  const runApplicationActionById = async (application: ApplicationCommand, actionId: string) => {
    setOpenApplication(null);
    closeMainWindow();
    await runApplicationAction(application.payload, actionId, actionHandlers);
  };

  // Opening an application (Enter on a row, or clicking it) actually launches the app — the batch
  // file in the extension host does that — and hides the launcher. Raycast hides *first*: the
  // window is out of the way before the launched app can paint over it, so the launcher never
  // lingers on top of the opening app. `window.close` only hides the WebView2 host window, so the
  // in-flight backend request below still completes.
  const openApplicationEntry = (application: ApplicationCommand) => {
    // Raycast learns from what you open; this store is what "Reset Ranking" clears.
    // Now uses backend SQLite store via IPC
    void ipc.backend("usage.incrementAppUsage", { appId: application.payload.id, count: 1 }, { module: "backend" }).catch(() => {
      /* usage tracking is best-effort */
    });
    closeMainWindow();
    void runApplicationAction(application.payload, "openApplication", actionHandlers).catch((error) => {
      console.info(`[applications] open failed: ${String(error)}`);
    });
  };

  // Toast actions merge into whatever action panel is open, like Raycast's `getToastActions()`.
  const toastGroups = useToastActionGroups();

  if (selected) {
    return (
      <>
        <CommandSession
          entry={selected}
          onBack={() => setSelected(null)}
          showToast={showToast}
          closeMainWindow={closeMainWindow}
          applications={applications}
          createLink={quicklinkCreateLink}
          onConsumeCreateLink={() => setQuicklinkCreateLink(null)}
        />
        <AlertHost />
      </>
    );
  }

  return (
    <div className="window" onMouseDown={keepSearchFocus}>
      <header className="window__header">
        <span className="raycast-mark" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path fill="currentColor" d="M3.6 3.6h6.4v6.4H3.6zM14 3.6h6.4v6.4H14zM3.6 14h6.4v6.4H3.6zM14 14h6.4v6.4H14z" />
            <path fill="currentColor" d="M14 10.4h-3.6V14H10a3.6 3.6 0 1 0 4 0z" opacity=".9" />
          </svg>
        </span>

        <div className="searchbar">
          <span className="searchbar__icon" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
          </span>
<input
            ref={searchRef}
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder="Search for apps and commands…"
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>

        <LoadingBar isLoading={rootLoading} />
      </header>

      {/* Argument input UI */}
      {argumentEntry && (
        <div className="argument-input">
          <div className="argument-input__header">
            <span className="argument-input__title">{argumentEntry.command.title}</span>
            <button
              type="button"
              className="argument-input__close"
              onClick={() => {
                setArgumentEntry(null);
                setArgumentValues({});
                setArgumentErrors([]);
                setArgumentFocusIndex(0);
                searchRef.current?.focus();
              }}
              aria-label="Close argument input"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="argument-input__fields">
            {getCommandArguments(argumentEntry.command).map((arg, index) => (
              <div key={arg.name} className="argument-input__field">
                <label className="argument-input__label" htmlFor={`arg-${arg.name}`}>
                  {arg.title}
                  {arg.required && <span className="argument-input__required">*</span>}
                </label>
                {arg.type === "dropdown" ? (
                  <select
                    id={`arg-${arg.name}`}
                    className="argument-input__select"
                    value={argumentValues[arg.name] ?? ""}
                    onChange={(e) => setArgumentValues((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const args = getCommandArguments(argumentEntry!.command);
                        setArgumentFocusIndex((i) => (i + (e.shiftKey ? -1 : 1) + args.length) % args.length);
                      } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleArgumentSubmit();
                      } else if (e.key === "Escape") {
                        closeArgumentInput();
                      }
                    }}
                    ref={(el) => index === argumentFocusIndex && el?.focus()}
                  >
                    <option value="">Select…</option>
                    {arg.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.title}
                      </option>
                    ))}
                  </select>
                ) : arg.type === "password" ? (
                  <input
                    id={`arg-${arg.name}`}
                    type="password"
                    className="argument-input__input"
                    value={argumentValues[arg.name] ?? ""}
                    placeholder={arg.placeholder ?? ""}
                    onChange={(e) => setArgumentValues((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const args = getCommandArguments(argumentEntry!.command);
                        setArgumentFocusIndex((i) => (i + (e.shiftKey ? -1 : 1) + args.length) % args.length);
                      } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleArgumentSubmit();
                      } else if (e.key === "Escape") {
                        closeArgumentInput();
                      }
                    }}
                    ref={(el) => index === argumentFocusIndex && el?.focus()}
                  />
                ) : (
                  <input
                    id={`arg-${arg.name}`}
                    type="text"
                    className="argument-input__input"
                    value={argumentValues[arg.name] ?? ""}
                    placeholder={arg.placeholder ?? ""}
                    onChange={(e) => setArgumentValues((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const args = getCommandArguments(argumentEntry!.command);
                        setArgumentFocusIndex((i) => (i + (e.shiftKey ? -1 : 1) + args.length) % args.length);
                      } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleArgumentSubmit();
                      } else if (e.key === "Escape") {
                        closeArgumentInput();
                      }
                    }}
                    ref={(el) => index === argumentFocusIndex && el?.focus()}
                  />
                )}
                {argumentErrors.includes(arg.name) && (
                  <span className="argument-input__error">Required</span>
                )}
              </div>
            ))}
          </div>
          <div className="argument-input__actions">
            <button
              type="button"
              className="argument-input__cancel"
              onClick={closeArgumentInput}
            >
              Cancel
            </button>
            <button
              type="button"
              className="argument-input__submit"
              onClick={handleArgumentSubmit}
              disabled={!isArgumentFormValid()}
            >
              Run Command
            </button>
          </div>
        </div>
      )}

      {quicklinkArgs ? (
        <QuicklinkArgsForm
          state={{ entry: quicklinkArgs, values: quicklinkArgs.args.map((arg) => arg.value), error: null } satisfies QuicklinkArgsState}
          onCancel={() => setQuicklinkArgs(null)}
          onSubmit={async (values) => {
            const entry = quicklinkArgs;
            setQuicklinkArgs(null);
            closeMainWindow();
            await openQuicklink(entry.id, values).catch((error) => {
              showToast("Unable to open quicklink", error instanceof Error ? error.message : String(error));
            });
          }}
        />
      ) : null}

      <main className="window__body" ref={bodyRef}>
        {hostError || applicationsError ? (
          <div className="state">
            <div className="state__title">Something went wrong</div>
            <div className="state__message">{hostError ?? applicationsError}</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="state">
            <div className="state__title">No results</div>
            <div className="state__message">Try a different search term.</div>
          </div>
        ) : (
          <ul className="list" ref={listRef}>
            {sections.map((section) =>
              section.entries.length === 0 ? null : (
                <li key={section.id} className="list__section">
                  <div className="list__sectionHeader">
                    <span className="list__sectionIcon" aria-hidden>
                      <RaycastIcon name={section.icon} size={ROOT_SECTION_ICON_SIZE} />
                    </span>
                    <span className="list__sectionTitle">{section.title}</span>
                    <span className="list__sectionCount">{section.entries.length}</span>
                  </div>
                  <ul className="list__sectionBody">
                    {section.entries.map((entry) => {
                      const index = entries.indexOf(entry);
                      return entry.kind === "application" ? (
                        <li key={`app:${entry.application.commandId}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => openApplicationEntry(entry.application)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setOpenApplication(entry.application);
                            }}
                          >
                            <span className="icon-wrap" aria-hidden>
                              {entry.application.payload.icon ? (
                                <img className="icon__img" src={entry.application.payload.icon} alt="" />
                              ) : (
                                <RaycastIcon name="app-window-list" size={16} />
                              )}
                              {entry.application.payload.isRunning ? (
                                <span className="dot" title="Running" />
                              ) : null}
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.application.title}</span>
                              {entry.application.subtitle ? (
                                <span className="list__subtitle">{entry.application.subtitle}</span>
                              ) : null}
                            </span>
                            <span className="list__accessory">
                              {isFavorite(applicationFavoriteKey(entry.application.payload.id)) ? (
                                <span className="list__favorite" title="Favorite">
                                  <RaycastIcon name="star" size={13} />
                                </span>
                              ) : null}
                              <span className="pill">Application</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "clipboard" ? (
                        <li key={`clipboard:${entry.commandId}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openRootActionPanel(entry);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="copy-clipboard" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">Clipboard History</span>
                              <span className="list__subtitle">
                                Search for text, images, links and colors you copied earlier and paste it
                                again.
                              </span>
                            </span>
                            <span className="list__accessory">
                              {isFavorite(CLIPBOARD_FAVORITE_KEY) ? (
                                <span className="list__favorite" title="Favorite">
                                  <RaycastIcon name="star" size={13} />
                                </span>
                              ) : null}
                              <span className="pill">view</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "quicklink" ? (
                        <li key={`quicklink:${entry.quicklink.id}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => openQuicklinkRow(entry.quicklink)}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="link" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.quicklink.name}</span>
                              <span className="list__subtitle">{entry.quicklink.link}</span>
                            </span>
                            <span className="list__accessory">
                              {entry.quicklink.args.length > 0 ? (
                                <span className="pill">{entry.quicklink.args.length} args</span>
                              ) : null}
                              <span className="pill">Quicklink</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "quicklink-create" ? (
                        <li key="quicklink:create-with-url">
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => {
                              setQuicklinkCreateLink(entry.link);
                              setPendingCreateLink(entry.link);
                              setSelected(QUICKLINKS_COMMAND);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="plus" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">Create Quicklink</span>
                              <span className="list__subtitle">{entry.link}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="pill">Quicklink</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "quicklinks" ? (
                        <li key={`quicklinks:${entry.commandId}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected(entry)}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="link" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">Search Quicklinks</span>
                              <span className="list__subtitle">Search all your quicklinks.</span>
                            </span>
                            <span className="list__accessory">
                              <span className="pill">view</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "fallback" ? (
                        <li key={`fallback:${entry.command.id}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => entry.command.action(searchText)}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="Blocks" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.command.title}</span>
                              {entry.command.subtitle ? (
                                <span className="list__subtitle">{entry.command.subtitle}</span>
                              ) : null}
                            </span>
                            <span className="list__accessory">
                              <span className="pill">fallback</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "inline" ? (
                        <li key={`inline:${entry.result.type}:${entry.result.title}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => entry.result.action(searchText, closeMainWindow)}
                          >
                            <span className="icon" aria-hidden>
                              {entry.result.type === "calculator" && <RaycastIcon name="calculator" size={16} />}
                              {entry.result.type === "snippet" && <RaycastIcon name="copy" size={16} />}
                              {entry.result.type === "web-search" && entry.result.icon && (
                                <span className="web-search-icon" dangerouslySetInnerHTML={{ __html: entry.result.icon }} />
                              )}
                              {entry.result.type === "web-search" && !entry.result.icon && <RaycastIcon name="globe" size={16} />}
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.result.title}</span>
                              <span className="list__subtitle">{entry.result.subtitle}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="pill">{entry.result.type}</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "file" ? (
                        <li key={`file:${entry.file.path}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => {
                              trackFileUsage(entry.file.path);
                              window.open(`file:///${entry.file.path.replace(/\\/g, "/")}`, "_blank");
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="file-text" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.file.name}</span>
                              <span className="list__subtitle">{entry.file.folder}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="pill">file</span>
                            </span>
                          </button>
                        </li>
                      ) : (
                        <li key={`ext:${entry.extension.uuid}:${entry.command.name}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openRootActionPanel(entry);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="Blocks" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.command.title}</span>
                              <span className="list__subtitle">
                                {entry.command.description || entry.extension.title}
                              </span>
                            </span>
                            <span className="list__accessory">
                              {isFavorite(commandFavoriteKey(entry.extension.uuid, entry.command.name)) ? (
                                <span className="list__favorite" title="Favorite">
                                  <RaycastIcon name="star" size={13} />
                                </span>
                              ) : null}
                              <span className="pill">{entry.command.mode ?? "view"}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ),
            )}
          </ul>
        )}
      </main>

      <footer className="window__footer">
        <button
          type="button"
          className="footer-icon-button"
          aria-label="Settings"
          onClick={openSettings}
        >
          <RaycastIcon name="cog" size={16} />
        </button>
        <span className="footer__spacer" />
        <button
          type="button"
          className="footer-action footer-action--kbd"
          onClick={() => openRootActionPanel(selectedEntry)}
        >
          Actions <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </button>
      </footer>

      <ActionPanel
        open={openApplication !== null}
        title={openApplication?.title}
        groups={panelGroups}
        onClose={() => setOpenApplication(null)}
        onRun={async (action) => {
          if (openApplication) await runApplicationActionById(openApplication, action.id);
        }}
      />

      <ActionPanel
        open={commandPanelEntry !== null}
        title={commandPanelEntry?.kind === "clipboard" ? "Clipboard History" : commandPanelEntry?.command.title}
        groups={[...commandPanelGroups, ...toastGroups]}
        onClose={() => setCommandPanelEntry(null)}
        onRun={async (action) => {
          const entry = commandPanelEntry;
          if (!entry) return;
          if (await runToastAction(action.id)) {
            setCommandPanelEntry(null);
            return;
          }
          const verb = action.id.slice(action.id.lastIndexOf(":") + 1);
          setCommandPanelEntry(null);
          if (verb === "open") {
            setSelected(entry);
          } else if (verb === "favorite") {
            const key =
              entry.kind === "clipboard"
                ? CLIPBOARD_FAVORITE_KEY
                : commandFavoriteKey(entry.extension.uuid, entry.command.name);
            const added = toggleFavorite(key);
            showToast(
              added ? "Added to Favorites" : "Removed from Favorites",
              entry.kind === "clipboard" ? "Clipboard History" : entry.command.title,
            );
          } else if (verb === "configureCommand") {
            openSettings();
          }
        }}
      />

      <AlertHost />

    </div>
  );
}

function CommandSession({
  entry,
  onBack,
  showToast,
  closeMainWindow: closeWindow,
  applications,
  createLink,
  onConsumeCreateLink,
}: {
  entry: RootEntry;
  onBack: () => void;
  showToast: (title: string, message?: string) => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
  createLink?: string | null;
  onConsumeCreateLink?: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const toastGroups = useToastActionGroups();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The command's filter field is always-focused, like the root search: when the action panel
  // closes, focus comes straight back here.
  useEffect(() => {
    if (!panelOpen) searchInputRef.current?.focus();
  }, [panelOpen]);

  const command = useExtensionCommand(
    entry.kind === "extension" ? entry.extension : null,
    entry.kind === "extension" ? entry.command : null,
  );

  // The renderer-side page stack (Raycast's `z.mainRouter.context.nodeExtensionStack`): pushed
  // pages stay in the stack with their own filter text/selection so popping restores them.
  const [pages, setPages] = useState<CommandPagesState>(emptyPages);
  const lastLocalPopId = useRef<string | null>(null);

  useEffect(() => {
    const tree = command.renderTree;
    if (!tree?.navigationStack) return;
    setPages((previous) => applyRender(previous, tree));
  }, [command.renderTree]);

  const searchText = topPage(pages)?.searchText ?? "";
  const setSearchText = useCallback((value: string) => {
    setPages((previous) => updateTop(previous, { searchText: value }));
  }, []);

  const selectedItemId = topPage(pages)?.selectedItemId ?? null;
  const setSelectedItemId = useCallback((itemId: string | null) => {
    setPages((previous) => updateTop(previous, { selectedItemId: itemId }));
  }, []);

  // Local pop (Escape / Ctrl+[): drop the top page here, then notify the extension through its
  // `navigationStack.onPop` callback — its reply carries the same pop id and `applyRender` updates
  // the top page in place (Raycast's `localPop` dedupe).
  const popOne = useCallback(() => {
    const popId = `localpop_${Math.random().toString(36).slice(2, 10)}`;
    let popped = false;
    setPages((previous) => {
      const next = popPage(previous, popId);
      popped = next.popped;
      return next.state;
    });
    const onPop = command.renderTree?.navigationStack?.onPop;
    if (popped && onPop) {
      lastLocalPopId.current = popId;
      void command.createCallback(onPop)(popId);
    }
  }, [command]);

  const popToRoot = useCallback(() => {
    setPages((previous) => popToRootPages(previous));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      setSearchText((event as CustomEvent<string>).detail);
      setPanelOpen(false);
    };
    window.addEventListener("raycast-mini:search", handler);
    return () => window.removeEventListener("raycast-mini:search", handler);
  }, [setSearchText]);

  // `extensionHost.popToRoot` (`Fne`): unwind every page, optionally clearing the search bar.
  useEffect(() => {
    if (!command.sessionId) return;
    return onNotification("extensionHost.popToRoot", (raw) => {
      const payload = raw as { sessionId?: string; clearSearchBar?: boolean };
      if (payload.sessionId && payload.sessionId !== command.sessionId) return;
      popToRoot();
      if (payload.clearSearchBar) setSearchText("");
      setPanelOpen(false);
    });
  }, [command.sessionId, popToRoot, setSearchText]);

  const body = topPage(pages)?.body;
  // Effective selection: the keyboard, the action groups and the test hooks operate on the row
  // that is actually highlighted — a fresh page has no stored selection, and Raycast's fallback
  // is the first item. Without this, the first ArrowDown only "fills in" the already-highlighted
  // first row and looks like a dead key.
  const bodyItems = useMemo(() => (body ? flatItems(body) : []), [body]);
  const effectiveSelectedId = useMemo(() => {
    if (selectedItemId && bodyItems.some((item) => item.id === selectedItemId)) return selectedItemId;
    return bodyItems[0]?.id ?? null;
  }, [selectedItemId, bodyItems]);

  const groups: ActionGroup[] = useMemo(() => {
    if (entry.kind !== "extension" || !body) return [];
    const itemActions = bodyItems
      .filter((item) => item.id === effectiveSelectedId)
      .flatMap((item) => item.actions ?? []);
    const models = [...(body.actions ?? []), ...itemActions];
    return models.length ? [{ name: "actions", actions: models }] : [];
  }, [entry, body, bodyItems, effectiveSelectedId]);

  // Dev-only automation hooks for the running command (see testHooks.ts).
  useEffect(() => {
    if (!isDevExtensionsEnabled() || entry.kind !== "extension") return;
    const runPrimary = () => {
      if (!body) return false;
      const items = bodyItems;
      const selected = items.find((item) => item.id === effectiveSelectedId) ?? items[0];
      const primary = selected?.actions?.[0] ?? body.actions?.[0];
      if (!primary) return false;
      void command.createCallback(primary.id)({ itemId: primary.itemId });
      return true;
    };
    overrideTestHooks({
      press: (key) => {
        if (key === "enter") return runPrimary();
        if (key === "pop") {
          popOne();
          return true;
        }
        if (key === "popToRoot") {
          popToRoot();
          return true;
        }
        if (key === "escape") {
          onBack();
          return true;
        }
        return false;
      },
      state: () => ({
        view: "command",
        command: entry.command.title,
        pages: pages.pages.length,
        kind: body?.kind ?? null,
        selectedItemId,
        searchText,
      }),
    });
  });

  if (entry.kind === "clipboard") {
    return (
      <ClipboardHistoryView
        searchText={searchText}
        onSearchTextChange={setSearchText}
        subscribeStateChanged={subscribeClipboardStateChanged}
        showToast={showToast}
        onBack={onBack}
        runEntryAction={runClipboardEntryAction}
        closeMainWindow={closeWindow}
        openUrl={openClipboardUrl}
      />
    );
  }

  if (entry.kind === "quicklinks") {
    return (
      <QuicklinksView
        searchText={searchText}
        onSearchTextChange={setSearchText}
        showToast={showToast}
        onBack={onBack}
        closeMainWindow={closeWindow}
        applications={applications}
        createLink={createLink}
        onConsumeCreateLink={onConsumeCreateLink}
      />
    );
  }

  if (entry.kind !== "extension") {
    // Applications are handled natively; this keeps the type narrow.
    return null;
  }

  return (
    <div className="window" onMouseDown={keepSearchFocus}>
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={pages.pages.length > 1 ? popOne : onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="searchbar">
          {/* Raycast's single search bar: the command view's input doubles as the List/Grid search
              (placeholder + accessory come from the current page's body) — never a second input. */}
          <input
            ref={searchInputRef}
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder={body?.searchBarPlaceholder ?? `Filter ${entry.command.title}…`}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                setPanelOpen((open) => !open);
              } else if (event.key === "[" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (pages.pages.length > 1) popOne();
                else onBack();
              } else if (event.key === "Escape") {
                if (searchText) setSearchText("");
                else if (panelOpen) setPanelOpen(false);
                else if (pages.pages.length > 1) popOne();
                else onBack();
              } else if (event.key === "Enter" && event.shiftKey) {
                // Shift+Enter toggles the action panel, like Raycast's action-bar button.
                setPanelOpen((open) => !open);
              }
            }}
          />
          {body?.searchBarAccessory && "sections" in body.searchBarAccessory ? (
            <SearchBarDropdown accessory={body.searchBarAccessory} createCallback={command.createCallback} />
          ) : null}
        </div>
        <button
          type="button"
          className="action-bar-button"
          aria-label="Actions"
          data-state={panelOpen ? "open" : "closed"}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
          </svg>
        </button>

        <LoadingBar isLoading={command.isLoading || command.phase === "loading"} />
      </header>

      <main className="window__body" style={{ padding: 0 }}>
        {command.isLoading || command.phase === "loading" ? (
          <div className="state">
            <div className="state__title">Loading…</div>
          </div>
        ) : command.error ? (
          <div className="state">
            <div className="state__title">Command failed</div>
            <div className="state__message">{command.error.message}</div>
          </div>
        ) : command.suspended ? (
          <div className="state">
            <div className="state__title">Preparing view…</div>
          </div>
        ) : body ? (
          <CommandViewKeyboard
            body={body}
            selectedItemId={effectiveSelectedId}
            onSelectionChange={setSelectedItemId}
            onPopOne={popOne}
            onPopToRoot={popToRoot}
            onRunPrimary={(action) => {
              void command.createCallback(action.id)({ itemId: action.itemId });
            }}
          >
            <RenderedView
              page={topPage(pages)!}
              onSelectionChange={setSelectedItemId}
              createCallback={command.createCallback}
              onLoadMore={() => {
                const onLoadMore = body.pagination?.onLoadMore;
                if (onLoadMore) void command.createCallback(onLoadMore)({});
              }}
            />
          </CommandViewKeyboard>
        ) : (
          <div className="state">
            <div className="state__title">Preparing view…</div>
          </div>
        )}
      </main>

      <footer className="window__footer">
        <button
          type="button"
          className="footer-icon-button"
          aria-label="Settings"
          onClick={openSettings}
        >
          <RaycastIcon name="cog" size={16} />
        </button>
        <span className="footer__spacer" />
        <button
          type="button"
          className="footer-action footer-action--kbd"
          onClick={() => setPanelOpen((open) => !open)}
        >
          Actions <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </button>
      </footer>

      <ActionPanel
        open={panelOpen}
        title="Actions"
        groups={[...groups, ...toastGroups]}
        onClose={() => setPanelOpen(false)}
        onRun={async (action) => {
          if (await runToastAction(action.id)) {
            setPanelOpen(false);
            return;
          }
          command.createCallback(action.id)({ itemId: action.itemId });
          setPanelOpen(false);
        }}
      />
    </div>
  );
}

/**
 * Window-level keyboard for a running command view: arrows move the selection (1D lists and 2D
 * grids), Enter runs the selected item's primary action, Escape/Ctrl+[ pop, Shift+Escape pops to
 * root — Raycast's `goBack`/`popToRoot` shortcuts (`shortcuts-C1kqjDmf.js`). Delegated to a child so
 * the key map can read the current page's items.
 */
function CommandViewKeyboard({
  body,
  selectedItemId,
  onSelectionChange,
  onPopOne,
  onPopToRoot,
  onRunPrimary,
  children,
}: {
  body: ViewBody;
  selectedItemId: string | null;
  onSelectionChange: (id: string | null) => void;
  onPopOne: () => void;
  onPopToRoot: () => void;
  onRunPrimary: (action: ViewAction) => void;
  children: ReactNode;
}) {
  const ids = useMemo(() => selectableIds(body.sections, flatItems(body)), [body]);
  const rowWidths = useMemo(() => (body.kind === "Grid" ? gridRowWidths(body) : null), [body]);
  const items = useMemo(() => flatItems(body), [body]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inSearch = target?.classList?.contains("searchbar__input") ?? false;
      if (event.key === "Escape" && event.shiftKey) {
        event.preventDefault();
        onPopToRoot();
        return;
      }
      if (event.key === "[" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onPopOne();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") return; // the search input and the session handle Escape
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (ids.length === 0) return;
        event.preventDefault();
        const index = selectedItemId ? ids.indexOf(selectedItemId) : -1;
        if (rowWidths) {
          onSelectionChange(moveInGrid(ids, rowWidths, index, event.key));
        } else if (event.key === "ArrowDown") {
          onSelectionChange(ids[Math.min(index + 1, ids.length - 1)]);
        } else if (event.key === "ArrowUp") {
          onSelectionChange(ids[Math.max(index - 1, 0)]);
        }
        return;
      }
      if (event.key === "Enter") {
        // Enter runs the selected item's primary action from anywhere in the command view —
        // including the search input, which keeps focus by design (keepSearchFocus).
        const selected = items.find((item) => item.id === selectedItemId) ?? items[0];
        const primary = selected?.actions?.[0];
        if (primary) {
          event.preventDefault();
          onRunPrimary(primary);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ids, rowWidths, items, selectedItemId, onSelectionChange, onPopOne, onPopToRoot, onRunPrimary]);

  return <>{children}</>;
}

/** 2D movement over ragged grid rows (`rowWidths` per row). */
export function moveInGrid(ids: string[], rowWidths: number[], currentIndex: number, key: string): string {
  if (ids.length === 0) return ids[0] ?? null as unknown as string;
  if (currentIndex < 0) return ids[0];
  // Build row offset table.
  const rowStarts: number[] = [];
  let offset = 0;
  for (const width of rowWidths) {
    rowStarts.push(offset);
    offset += width;
  }
  let row = rowStarts.findIndex((start, rowIndex) => currentIndex >= start && currentIndex < start + rowWidths[rowIndex]);
  if (row < 0) row = 0;
  const column = currentIndex - rowStarts[row];
  if (key === "ArrowRight") {
    const next = currentIndex + 1;
    return next < ids.length ? ids[next] : ids[currentIndex];
  }
  if (key === "ArrowLeft") {
    const previous = currentIndex - 1;
    return previous >= 0 ? ids[previous] : ids[currentIndex];
  }
  if (key === "ArrowDown") {
    const nextRow = row + 1;
    if (nextRow >= rowWidths.length) return ids[currentIndex];
    const targetColumn = Math.min(column, rowWidths[nextRow] - 1);
    return ids[rowStarts[nextRow] + targetColumn];
  }
  // ArrowUp
  const previousRow = row - 1;
  if (previousRow < 0) return ids[currentIndex];
  const targetColumn = Math.min(column, rowWidths[previousRow] - 1);
  return ids[rowStarts[previousRow] + targetColumn];
}

void APPLICATION_AREA_KEYS;
