// The launcher UI: Raycast's root search — the `apps` section (installed applications) plus the
// installed extension commands — and the running command's rendered view.
//
// Mirrors `Raycast.WebView.MainWindow` + the `NodeCommand` component tree in Raycast's
// `main-window-*.js` bundle. Section ordering follows the shipped manifest:
// `rootSearch: { section: "apps" }` puts applications first.
// The entry model lives in ./entries, the section ranking in ./buildSections, the shared helpers
// in ./rootHelpers and the command session in ./CommandSession.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  closeMainWindow,
  ipc,
  ipcRequest,
  installHostMessageListener,
  onNotification,
  openSettings,
} from "../ipc";
import { useExtensionCommand } from "../useExtensionCommand";
import { alertStore, type ExtensionAlertPayload } from "../alertStore";
import AlertHost from "../AlertHost";
import { installTestHooks, isDevExtensionsEnabled, overrideTestHooks, setDevExtensions } from "../testHooks";
import { readCommandHotkeys, registerAllCommandHotkeys } from "../commandConfig";
import { installSystemAccent } from "./systemAccent";
import { installSettingsPush, subscribeSettings, syncFromBackend, updateSettings, useSetting } from "../settings/store";
import { POP_TO_ROOT_BY_LABEL } from "../settings/persistence";
import { applyTheme, clearThemeOverride, resolveThemeName, themeByName } from "./themes";
import { ActionPanel, type ActionGroup } from "../ActionPanel";
import {
  hudStore,
  setHostWindowVisible,
  styleToVariant,
  toastStore,
  type ExtensionHudPayload,
  type ExtensionToastPayload,
  type ToastState,
} from "../toastStore";
import { OpenrayIcon } from "../icons";
import { ExtensionIcon } from "../features/extensions/useExtensionIcon";
import { readStoredHotkeys, reregisterStoredHotkeys, runWindowManagementCommand, wmCommandDefinition, wmCommandIcon } from "../windowManagement";
import {
  cancelFocusSession,
  completeFocusSession,
  pauseFocusSession,
  readLastStartInput,
  resumeFocusSession,
  restartFocusSession,
  runFocusAction,
  useSessionState,
  type FocusSessionState,
} from "../focus";
import { getGameFlags, hideGame, markAsApplication, type GamePayload } from "../games";
import { applicationFavoriteKey, commandFavoriteKey, internalFavoriteKey, useFavorites } from "../favorites";
import {
  type ApplicationCommand,
  runApplicationAction,
  useApplications,
  useApplicationGroups,
} from "../applications";
import { ArgsForm as QuicklinkArgsForm, type ArgsState as QuicklinkArgsState, type QuicklinksCommandName } from "../features/quicklinks/QuicklinksView";
import { openQuicklink, setPendingCreateLink, useQuicklinks, type QuicklinkEntry } from "../quicklinks";
import { LoadingBar } from "../LoadingBar";
import type { TranslateSeed } from "../features/translator/TranslateView";
import { useSnippets } from "../snippets";
import {
  plainTextOf,
  type ClipboardEntry,
  type ClipboardEntryAction,
} from "../clipboardHistory";
import {
  rankEntries,
  type RankedEntry,
  type Sensitivity,
  type FallbackCommand,
  type FileSearchResult,
  generateKeywords,
} from "../matching";
import { type FallbackCommandSpec } from "../settings/persistence";
import {
  fetchFileResults,
  fetchFileSettings,
  fetchIndexState,
  fileActionGroups,
  fileIconFor,
  runFileAction,
  trackFileUsage,
  type FileIndexState,
  type FileSearchRow,
  type FileSearchSettings,
} from "../fileSearch";
import { getInlineSectionResults, loadInlineSectionSettings, type InlineSectionResult, type InlineSectionSettings } from "../inlineSections";
import {
  getCommandArguments,
  validateArguments,
  getDefaultArgumentValues,
  hasArguments,
  addArgumentHistory,
  getArgumentSuggestions,
  type ArgumentDefinition,
  type ArgumentValues,
} from "../arguments";
import {
  type CalculatorEvaluation,
  type CalculatorRatesMeta,
  CLIPBOARD_COMMAND,
  CLIPBOARD_FAVORITE_KEY,
  type ClipboardEntryResult,
  type ExtensionEntry,
  type InternalCommandEntry,
  type ExtensionSummary,
  INTERNAL_EXTENSION_META,
  INTERNAL_COMMANDS,
  internalCommandEntry,
  type InternalArea,
  type InternalCommandName,
  type CalculatorEntry,
  type FocusActionEntry,
  type FocusSessionEntry,
  type FocusViewEntry,
  type GameEntry,
  type RootEntry,
  type SearchableEntry,
  type TranslateEntry,
  type TranslatorCustomCommand,
} from "./entries";
import { buildSections, FOCUS_COMMANDS } from "./buildSections";
import {
  formatRelativeTime,
  nextToastId,
  hudStoreOpenForExtension,
  keepSearchFocus,
  marks,
  openClipboardUrl,
  runClipboardEntryAction,
  runToastAction,
  subscribeClipboardStateChanged,
  useToastActionGroups,
  ROOT_SECTION_ICON_SIZE,
} from "./rootHelpers";
import { CommandSession } from "./CommandSession";

/** The dynamic session row's subtitle: remaining time for timed sessions, paused state otherwise. */
function focusSessionSubtitle(entry: FocusSessionEntry): string {
  if (entry.status === "paused") return entry.pauseEndsAt ? "Paused — resumes automatically" : "Paused";
  if (entry.mode === "noLimit") return "No time limit";
  if (entry.remainingMs === null) return "Running";
  const minutes = Math.max(0, Math.round(entry.remainingMs / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m remaining` : `${rest}m remaining`;
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
  const [commandPanelEntry, setCommandPanelEntry] = useState<ExtensionEntry | ClipboardEntryResult | InternalCommandEntry | null>(
    null,
  );
  const [hostError, setHostError] = useState<string | null>(null);
  const [extensionsLoading, setExtensionsLoading] = useState(true);
  // Settings-store consumers (Raycast's `subscribeUpdate<Key>`): every window re-renders on push.
  syncFromBackend();
  const sensitivityLabel = String(useSetting("root-search-sensitivity") ?? "High");
  const sensitivity: Sensitivity =
    sensitivityLabel.toLowerCase() === "low" ? "low" : sensitivityLabel.toLowerCase() === "medium" ? "medium" : "high";
  const popToRootLabel = String(useSetting("pop-to-root-search") ?? "After 90 seconds");
  const popToRootSeconds = POP_TO_ROOT_BY_LABEL[popToRootLabel] ?? 90;
  const escapeBehavior = String(useSetting("escape-key-behavior") ?? "Navigate back or close window");
  const navigationBindings = String(useSetting("navigation-bindings") ?? "Emacs (Alt+B, Alt+F, Alt+P, Alt+N)");
  const interfaceSize = String(useSetting("interface-size") ?? "1");
  const windowMode = String(useSetting("window-mode") ?? "expanded");
  const showFavoritesCompact = useSetting("show-favorites-in-compact-mode") !== false;
  const [usageScores, setUsageScores] = useState<Map<string, number>>(new Map());
  // File Search: settings and index state live in the backend; the results cache is per query.
  const [fileSearchSettings, setFileSearchSettings] = useState<FileSearchSettings | null>(null);
  const [fileIndexState, setFileIndexState] = useState<FileIndexState | null>(null);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [fileSearchRefresh, setFileSearchRefresh] = useState(0);
  // Action panel for a file result row (Ctrl+K on the Files section).
  const [filePanel, setFilePanel] = useState<FileSearchRow | null>(null);
  const [inlineSectionSettings, setInlineSectionSettings] = useState(() => loadInlineSectionSettings());
  const [inlineResults, setInlineResults] = useState<InlineSectionResult[]>([]);
  // Action panel for the ephemeral calculator row (Ctrl+K on the split row).
  const [calculatorPanel, setCalculatorPanel] = useState<CalculatorEntry | null>(null);
  // Action panels for the Focus session row and the dynamic game rows.
  const [focusSessionPanel, setFocusSessionPanel] = useState<FocusSessionEntry | null>(null);
  const [gamePanel, setGamePanel] = useState<GameEntry | null>(null);
  // Translator: saved custom commands (dynamic root rows) and the seed the quick row passes to
  // the Translate view when "Open in Translator" runs.
  const [customTranslateCommands, setCustomTranslateCommands] = useState<TranslatorCustomCommand[]>([]);
  const [translatePanel, setTranslatePanel] = useState<TranslateEntry | null>(null);
  const [translatorSeed, setTranslatorSeed] = useState<TranslateSeed | null>(null);
  // Quicklinks: one root row per stored quicklink, refreshed on `quicklinks.updated`.
  const { quicklinks: quicklinkRows } = useQuicklinks();
  const [quicklinkArgs, setQuicklinkArgs] = useState<QuicklinkEntry | null>(null);
  const [quicklinkCreateLink, setQuicklinkCreateLink] = useState<string | { link: string; name?: string } | null>(null);
  // Argument input state
  const [argumentEntry, setArgumentEntry] = useState<ExtensionEntry | null>(null);
  const [argumentValues, setArgumentValues] = useState<ArgumentValues>({});
  const [argumentErrors, setArgumentErrors] = useState<string[]>([]);
  const [argumentFocusIndex, setArgumentFocusIndex] = useState(0);
  // Pop to root timeout state ("Immediately" = 0 resets on hide; "After N seconds" = N * 1000).
  const [popToRootTimer, setPopToRootTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const popToRootTimeout = popToRootSeconds <= 0 ? 0 : popToRootSeconds * 1000;
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
            if (key?.startsWith("openray:usage:")) {
              const appId = key.slice("openray:usage:".length);
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

  // Search sensitivity follows the settings store (live via `settings.changed`).

  // Theme engine: the bundled palettes override the root token set; Follow System Appearance
  // switches dark/light with the OS, otherwise the dark theme always applies.
  const followSystemAppearance = useSetting("follow-system-appearance") !== false;
  const themeDark = String(useSetting("theme-dark") ?? "Raycast Dark");
  const themeLight = String(useSetting("theme-light") ?? "Raycast Light");
  const storedActiveTheme = String(useSetting("active-theme") ?? "");
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = themeByName(storedActiveTheme || resolveThemeName(followSystemAppearance, query.matches, themeDark, themeLight));
      applyTheme(theme);
      void ipcRequest(
        "settings.setChromeAppearance",
        {
          light: theme?.appearance === "light",
          color: getComputedStyle(document.querySelector(".window") ?? document.body).backgroundColor,
        },
        { module: "frontend" },
      ).catch(() => undefined);
    };
    apply();
    const onChange = () => {
      clearThemeOverride();
      updateSettings({ "active-theme": "" });
      apply();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [followSystemAppearance, themeDark, themeLight, storedActiveTheme]);

  // Interface Size zooms the whole window like Raycast's `--spx` (1 / 1.1 / 1.2).
  useEffect(() => {
    const zoom = Number(interfaceSize);
    document.documentElement.style.zoom = zoom > 1 && zoom <= 1.2 ? String(zoom) : "";
  }, [interfaceSize]);

  // Compact window mode: the host shrinks to the search bar while the list is empty and grows
  // back when results appear; "expanded" always uses the full height. The latest request is kept
  // in a ref and re-asserted whenever the window becomes visible again (a mode changed while the
  // launcher was hidden must win over whatever height the window ended up with).
  const compactListVisible = windowMode !== "compact" || searchText.trim().length > 0;
  const launcherHeightRef = useRef<{ compact: boolean; visible: boolean }>({ compact: false, visible: true });
  useEffect(() => {
    const request = { compact: windowMode === "compact", visible: compactListVisible };
    launcherHeightRef.current = request;
    void ipcRequest("window.setLauncherHeight", request, { module: "frontend" }).catch(() => undefined);
  }, [windowMode, compactListVisible]);

  // Fallback commands arrive as serializable specs from the Launcher settings page; the actions
  // are rebuilt here because closures cannot cross the settings JSON boundary.
  const buildFallbackCommands = useCallback((specs: FallbackCommandSpec[]): FallbackCommand[] => {
    return specs.map((spec) => ({
      id: spec.id,
      title: spec.title,
      subtitle: spec.provider,
      keywords: [spec.title.toLowerCase(), spec.provider.toLowerCase()].filter(Boolean),
      action:
        spec.kind === "url" && spec.url
          ? (query: string) => {
              window.open(spec.url!.replace("{query}", encodeURIComponent(query)), "_blank", "noopener");
            }
          : (query: string) => {
              if (query.trim()) setSearchText(query);
              setSelected(
                internalCommandEntry(
                  (spec.area ?? "quicklinks") as Parameters<typeof internalCommandEntry>[0],
                  (spec.command ?? "search") as Parameters<typeof internalCommandEntry>[1],
                ),
              );
            },
    }));
  }, []);

  const [fallbackSpecs, setFallbackSpecs] = useState<FallbackCommandSpec[]>(() => {
    try {
      const stored = localStorage.getItem("openray:fallback-commands");
      return stored ? (JSON.parse(stored) as FallbackCommandSpec[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const handleFallbackChange = (event: CustomEvent<FallbackCommandSpec[]>) => {
      setFallbackSpecs(event.detail);
    };
    window.addEventListener("openray:fallback-commands-changed", handleFallbackChange as EventListener);
    return () => window.removeEventListener("openray:fallback-commands-changed", handleFallbackChange as EventListener);
  }, []);

  const fallbackCommands = useMemo(() => buildFallbackCommands(fallbackSpecs), [fallbackSpecs, buildFallbackCommands]);

  // File Search — debounced backend query while `Include Files in Root Search` is on.
  useEffect(() => {
    if (!fileSearchSettings?.showInRootSearch || searchText.trim().length === 0) {
      setFileResults([]);
      return;
    }
    const trimmed = searchText.trim();
    const timer = setTimeout(() => {
      fetchFileResults(trimmed, { limit: 10 })
        .then((rows) => setFileResults(rows))
        .catch(() => setFileResults([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [searchText, fileSearchSettings, fileSearchRefresh]);

  // Inline sections - update results when query changes
  useEffect(() => {
    if (searchText.trim().length === 0) {
      setInlineResults([]);
      return;
    }
    
    const results = getInlineSectionResults(searchText).filter((r) => {
      if (r.type === "snippet" && !inlineSectionSettings.snippets) return false;
      if (r.type === "web-search" && !inlineSectionSettings.webSearch) return false;
      return true;
    });
    
    setInlineResults(results);
  }, [searchText, inlineSectionSettings]);

  // The calculator row evaluates against the backend engine (`calculator.calculate`) — the same
  // evaluation the `{calculator}` placeholder uses, so snippets, quicklinks and this row agree.
  // Debounced per keystroke; only the latest query may commit.
  const [calculatorEntry, setCalculatorEntry] = useState<CalculatorEntry | null>(null);
  useEffect(() => {
    const query = searchText.trim();
    if (!query || !inlineSectionSettings.calculator) {
      setCalculatorEntry(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void ipc
        .backend("calculator.calculate", { expression: query }, { module: "backend" })
        .then((raw) => {
          if (cancelled) return;
          const payload = raw as { result: CalculatorEvaluation | null; error?: string | null; rates?: CalculatorRatesMeta | null };
          setCalculatorEntry(
            payload.result
              ? { kind: "calculator", expression: query, evaluation: payload.result, rates: payload.rates ?? null }
              : null,
          );
        })
        .catch(() => {
          if (!cancelled) setCalculatorEntry(null);
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText, inlineSectionSettings.calculator]);

  // The quick-translate row runs the backend's confirmed parser (`in|into <language>`, ≥ 3 chars,
  // prefix match) with the confirmed 150 ms debounce. Row states pending/failed/ready: the row
  // flips to pending the moment the term parses and settles on the provider response.
  const [translateEntry, setTranslateEntry] = useState<TranslateEntry | null>(null);
  useEffect(() => {
    const query = searchText.trim();
    if (!query || !inlineSectionSettings.translate) {
      setTranslateEntry(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void ipc
        .backend("translator.parseQuickTranslate", { term: query }, { module: "backend" })
        .then((raw) => {
          const match = raw as { matched: boolean; sourceText?: string; target?: string; targetLabel?: string };
          if (cancelled || !match.matched) {
            if (!cancelled) setTranslateEntry(null);
            return null;
          }
          setTranslateEntry({
            kind: "translate",
            row: {
              status: "pending",
              sourceText: match.sourceText ?? "",
              target: match.target ?? "",
              targetLabel: match.targetLabel ?? "",
              sourceLabel: null,
              translatedText: null,
            },
          });
          return ipc.backend(
            "translator.translate",
            { text: match.sourceText, source: "auto", target: match.target },
            { module: "backend" },
          );
        })
        .then((raw) => {
          if (cancelled || !raw) return;
          const payload = raw as {
            status: "ready" | "failed";
            translatedText?: string;
            detectedSourceLanguage?: string | null;
            sourceLabel?: string | null;
            targetLabel?: string | null;
          };
          setTranslateEntry((current) => {
            if (!current) return null;
            return {
              kind: "translate",
              row: {
                ...current.row,
                status: payload.status,
                translatedText: payload.status === "ready" ? payload.translatedText ?? "" : null,
                sourceLabel: payload.sourceLabel ?? null,
              },
            };
          });
        })
        .catch(() => {
          if (!cancelled) setTranslateEntry(null);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText, inlineSectionSettings.translate]);

  // Saved custom translate commands power the dynamic root rows; the store pushes
  // `translator.customCommandsUpdated` on every mutation (settings dialogs included).
  const refreshCustomTranslateCommands = useCallback(() => {
    void ipc.backend("translator.getAllTranslateCustomCommands", {}, { module: "backend" })
      .then((raw) => {
        const commands = ((raw as { commands?: TranslatorCustomCommand[] }).commands ?? []) as TranslatorCustomCommand[];
        setCustomTranslateCommands(commands.filter((command) => command.enabled));
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refreshCustomTranslateCommands();
    return onNotification("translator.customCommandsUpdated", refreshCustomTranslateCommands);
  }, [refreshCustomTranslateCommands]);

  // File Search settings and index state live in the backend store; the indexer pushes
  // `fileSearch.indexState` (live counts for the pinned indexing row) and `settingsUpdated`
  // whenever the Settings window changes a row.
  useEffect(() => {
    fetchFileSettings().then(setFileSearchSettings).catch(() => undefined);
    fetchIndexState().then(setFileIndexState).catch(() => undefined);
    const offState = onNotification("fileSearch.indexState", (raw) => {
      setFileIndexState(raw as FileIndexState);
    });
    const offSettings = onNotification("fileSearch.settingsUpdated", (raw) => {
      setFileSearchSettings((raw as { settings?: FileSearchSettings }).settings ?? null);
    });
    return () => {
      offState();
      offSettings();
    };
  }, []);

  // Listen for inline section settings changes from Settings
  useEffect(() => {
    const handleSettingsChange = (event: CustomEvent<InlineSectionSettings>) => {
      setInlineSectionSettings(event.detail);
    };
    window.addEventListener("openray:inline-section-settings-changed", handleSettingsChange as EventListener);
    return () => window.removeEventListener("openray:inline-section-settings-changed", handleSettingsChange as EventListener);
  }, []);

  // Pop to root on hide: Raycast resets to root search after the window has been closed for the
  // configured timeout ("Pop to Root Search"). Hiding starts the timer; showing cancels it. Both
  // the document visibilitychange and the host’s explicit `window.visibilityChanged` push feed the
  // same timer — WPF Hide() does not always surface as a renderer visibility event.
  const popToRootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Window Management: preset hotkey labels refresh when the launcher reopens (the Settings
  // window edits them in its own document), and the host's registrations are replayed on mount.
  const [storedWmHotkeys, setStoredWmHotkeys] = useState<Record<string, string>>(() => readStoredHotkeys());
  useEffect(() => {
    void reregisterStoredHotkeys().catch(() => undefined);
    return onNotification("windowManagement.hotkey", (raw) => {
      const payload = raw as { commandKey?: string };
      if (!payload.commandKey) return;
      // Store command hotkeys are keyed `cmd:<uuid>/<command>`; reveal the launcher and open the
      // command (the WM presets fall through to the geometry runner below).
      if (payload.commandKey.startsWith("cmd:")) {
        const [uuid, commandName] = payload.commandKey.slice("cmd:".length).split("/");
        void ipcRequest("window.showMainWindow", {}, { module: "frontend" }).catch(() => undefined);
        setExtensions((current) => {
          const extension = current.find((candidate) => candidate.uuid === uuid);
          const command = extension?.commands.find((candidate) => candidate.name === commandName);
          if (extension && command && !command.disabledReason) {
            setSelected({ kind: "extension", extension, command });
          }
          return current;
        });
        return;
      }
      void runWindowManagementCommand(payload.commandKey, { showToast, closeMainWindow });
    });
    // showToast/closeMainWindow are stable callbacks; the subscription lives for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const offHost = onNotification("window.visibilityChanged", (raw) => {
      const payload = raw as { visible?: boolean };
      if (payload.visible === true) setStoredWmHotkeys(readStoredHotkeys());
    });
    return offHost;
  }, []);
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
        void ipcRequest("window.setLauncherHeight", launcherHeightRef.current, { module: "frontend" }).catch(() => undefined);
        return;
      }
      const resetToRoot = () => {
        setSelected(null);
        setOpenApplication(null);
        setCommandPanelEntry(null);
        setArgumentEntry(null);
      };
      if (popToRootTimeout <= 0) {
        // "Immediately": the next show starts at the root search.
        resetToRoot();
        return;
      }
      if (popToRootTimerRef.current) return;
      const timer = setTimeout(() => {
        popToRootTimerRef.current = null;
        setPopToRootTimer(null);
        resetToRoot();
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
    installSystemAccent();
    const offSettingsPush = installSettingsPush();
    const refreshExtensions = async () => {
      const payload = (await ipc.backend("extensionHost.getInstalledNodeExtensionSummaries")) as {
        extensions?: ExtensionSummary[];
      };
      setExtensions(payload.extensions ?? []);
    };
    // The host forwards `--dev-extensions` / OPENRAY_DEV_EXTENSIONS=1; the push can race this
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
      offSettingsPush();
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

  // The Notes window's `Create Quicklink` action: the host reveals the launcher with the
  // Quicklinks create form prefilled with the note deeplink and title (the confirmed cross-window
  // action `Create Quicklink`).
  useEffect(() => {
    return onNotification("quicklink.createSeed", (raw) => {
      const payload = raw as { link?: string; name?: string } | null;
      if (!payload?.link) return;
      setQuicklinkCreateLink({ link: payload.link, name: payload.name });
      setSelected(internalCommandEntry("quicklinks", "create"));
    });
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
      // A no-view session is done: unload it while the window is hidden so the next open lands
      // on root search instead of the command's outcome view.
      setSelected(null);
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
    // Extension-initiated `closeMainWindow()` (`closeMainOpenrayWindow`): the backend forwards it
    // here; hiding is the host's job (`window.close`), like Raycast's `closeMainOpenrayWindow` →
    // `Raycast.WebView.Window` close. Without this the window stays visible and the toast never
    // falls back to the floating HUD.
    const offCloseWindow = onNotification("extensionHost.closeMainOpenrayWindow", () => {
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

  // Store installs/uninstalls change the installed set; the backend pushes `store.installed` and
  // root search re-reads the summaries (compat classification included).
  useEffect(() => {
    return onNotification("store.installed", () => {
      void ipc.backend("extensionHost.getInstalledNodeExtensionSummaries")
        .then((payload) => setExtensions((payload as { extensions?: ExtensionSummary[] }).extensions ?? []))
        .catch(() => undefined);
    });
  }, []);

  // Command hotkeys live in the host process; re-register the stored ones on renderer mount
  // and whenever the Settings window edits them (the store push bumps this subscription).
  useEffect(() => {
    void registerAllCommandHotkeys();
    let last = JSON.stringify(readCommandHotkeys());
    return subscribeSettings(() => {
      const next = JSON.stringify(readCommandHotkeys());
      if (next === last) return;
      last = next;
      void registerAllCommandHotkeys();
    });
  }, []);

  const { applications, error: applicationsError, loading: applicationsLoading } = useApplications(true);

  // Focus (docs/focus-games-taskbar-spec.md §A): the dynamic session row subscribes to the
  // backend's `focus.sessionChanged` push; the games flag map feeds the dynamic `game` rows.
  const { state: focusState, refresh: refreshFocus } = useSessionState();
  const [gameFlags, setGameFlags] = useState<Record<string, boolean>>({});
  const refreshGameFlags = useCallback(() => {
    getGameFlags()
      .then((flags) => setGameFlags(flags.games))
      .catch(() => undefined);
  }, []);
  useEffect(refreshGameFlags, [refreshGameFlags]);
  useEffect(() => {
    // Flags can change from the Settings window (Game Mode presets) or a game view session.
    return onNotification("window.visibilityChanged", (raw) => {
      const payload = raw as { visible?: boolean };
      if (payload.visible === true) refreshGameFlags();
    });
  }, [refreshGameFlags]);

  // Focus: the panel window's buttons route into the backend state machine; `edit` opens the
  // edit form in the launcher (surfacing the hidden window, like the alert store does).
  useEffect(() => {
    return onNotification("focus.panelAction", (raw) => {
      const payload = raw as { action?: string; Action?: string; durationMs?: number | null; DurationMs?: number | null };
      const action = payload.action ?? payload.Action;
      const durationMs = payload.durationMs ?? payload.DurationMs;
      if (action === "edit") {
        setSelected({ kind: "focus-view", command: "edit", title: "Edit Focus Session" });
        void ipcRequest("window.showMainWindow", {}, { module: "frontend" }).catch(() => undefined);
        return;
      }
      const run = action === "pause"
        ? pauseFocusSession(durationMs ?? null)
        : action === "resume"
          ? resumeFocusSession()
          : action === "complete"
            ? completeFocusSession()
            : action === "cancel"
              ? cancelFocusSession()
              : null;
      if (!run) return;
      void run.then(() => refreshFocus()).catch(() => undefined);
    });
  }, [refreshFocus]);
  const gameApps = useMemo(
    () => applications.filter((app) => gameFlags[app.payload.id]),
    [applications, gameFlags],
  );
  const gamePanelGroups = useMemo<ActionGroup[]>(() => {
    if (!gamePanel) return [];
    const id = gamePanel.app.id;
    return [
      {
        name: "general",
        actions: [
          { id: "game:open", title: "Open Game", itemId: id },
          { id: "game:runAsAdministrator", title: "Run as Administrator", itemId: id },
          { id: "game:reveal", title: "Show in File Explorer", itemId: id },
        ],
      },
      {
        name: "copy",
        actions: [
          { id: "game:copyPath", title: "Copy Path", itemId: id },
          { id: "game:copyName", title: "Copy Name", itemId: id },
          { id: "game:copyBundleIdentifier", title: "Copy Bundle Identifier", itemId: id },
        ],
      },
      {
        name: "configure",
        actions: [
          { id: "game:treatAsApplication", title: "Treat as Application", itemId: id },
          { id: "game:hide", title: "Hide Game", itemId: id },
        ],
      },
    ];
  }, [gamePanel]);

  const rootLoading = applicationsLoading || extensionsLoading;

  // Update usage scores when applications are loaded
  useEffect(() => {
    if (applications.length > 0) {
      const newScores = new Map(usageScores);
      let changed = false;
      for (const app of applications) {
        try {
          const raw = localStorage.getItem(`openray:usage:${app.payload.id}`);
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

  // `usage.getAppUsage` keys counts by application id, but the root ranker compares by title —
  // alias the counts so an app's open frequency breaks ties in its favor.
  const rootUsageScores = useMemo(() => {
    const map = new Map(usageScores);
    for (const app of applications) {
      const count = usageScores.get(app.payload.id);
      if (count !== undefined) map.set(app.title, count);
    }
    return map;
  }, [usageScores, applications]);

  // Root Search renders Favorites / Applications / Commands as named sections, exactly like
  // Raycast's root search, and the flat selection index walks all of them in order.
  const sections = useMemo(
    () => buildSections(searchText, applications, extensions, favorites, sensitivity, rootUsageScores, fallbackCommands, fileResults, inlineResults, quicklinkRows, calculatorEntry, translateEntry, customTranslateCommands, fileIndexState, fileSearchSettings?.showInRootSearch ?? false, focusState?.session ?? null, gameApps),
    [searchText, applications, extensions, favorites, sensitivity, rootUsageScores, fallbackCommands, fileResults, inlineResults, quicklinkRows, calculatorEntry, translateEntry, customTranslateCommands, fileIndexState, fileSearchSettings, focusState, gameApps],
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
  panelOpenRef.current = openApplication !== null || commandPanelEntry !== null || calculatorPanel !== null || translatePanel !== null;

  // Hooks must run before any early return, so the action source is resolved here.
  const panelApp = openApplication?.payload ?? null;
  const panelGroups = useApplicationGroups(panelApp, {
    favorite: panelApp ? isFavorite(applicationFavoriteKey(panelApp.id)) : false,
  });

  // Raycast's root action panel for a command result: run it, pin it, configure it. The
  // synthetic Clipboard History entry shares the panel; only the favorite key differs.
  const commandPanelGroups = useMemo<ActionGroup[]>(() => {
    if (!commandPanelEntry) return [];
    // Internal commands are filed by area/command at the root; they have no favorite key
    // (root sections match favorites only for applications, clipboard and extension commands).
    if (commandPanelEntry.kind === "internal") {
      const internalKey = internalFavoriteKey(commandPanelEntry.commandId);
      return [
        { name: "general", actions: [{ id: "command:open", title: "Open Command", itemId: internalKey }] },
        {
          name: "favorites",
          actions: [
            {
              id: "command:favorite",
              title: isFavorite(internalKey) ? "Remove from Favorites" : "Add to Favorites",
              itemId: internalKey,
            },
          ],
        },
        {
          name: "configure",
          actions: [{ id: "command:configureCommand", title: "Configure Command", itemId: internalKey }],
        },
      ];
    }
    const key =
      commandPanelEntry.kind === "clipboard"
        ? CLIPBOARD_FAVORITE_KEY
        : commandFavoriteKey(commandPanelEntry.extension.uuid, commandPanelEntry.command.name);
    // Disabled (classifier-disabled) commands cannot be launched — no Open action in the panel.
    const disabled = commandPanelEntry.kind === "extension" && Boolean(commandPanelEntry.command.disabledReason);
    const groups: ActionGroup[] = [];
    if (!disabled) {
      groups.push({ name: "general", actions: [{ id: "command:open", title: "Open Command", itemId: key }] });
    }
    groups.push({
      name: "favorites",
      actions: [
        {
          id: "command:favorite",
          title: isFavorite(key) ? "Remove from Favorites" : "Add to Favorites",
          itemId: key,
        },
      ],
    });
    groups.push({ name: "configure", actions: [{ id: "command:configureCommand", title: "Configure Command", itemId: key }] });
    return groups;
  }, [commandPanelEntry, isFavorite]);

  // Opening a file hides the launcher first, like every launching action in Raycast.
  const openFileEntry = useCallback(
    (file: FileSearchResult) => {
      trackFileUsage(file.path);
      closeMainWindow();
      void ipc.backend("fileSystem.openFile", { path: file.path }, { module: "backend" }).catch(() => {
        showToast("Failed to open file", file.name);
      });
    },
    [closeMainWindow, showToast],
  );

  // The `Open in File Explorer` fallback: trailing separator → open the directory, otherwise
  // select the target in its parent (the confirmed `explorer /select` behavior).
  const openExplorerEntry = useCallback(
    (target: string) => {
      closeMainWindow();
      const trimmed = target.replace(/[\\/]+$/, "");
      const isDirectory = /[\\/]$/.test(target);
      void ipc
        .backend(isDirectory ? "fileSystem.openFile" : "shell.revealFile", { path: trimmed }, { module: "backend" })
        .catch(() => undefined);
    },
    [closeMainWindow],
  );

  // Ctrl+K / right-click / footer button all funnel through here, whatever the row is.
  const openRootActionPanel = useCallback((entry: RootEntry | undefined) => {    if (!entry) return;
    if (entry.kind === "application") setOpenApplication(entry.application);
    // Extension commands, internal commands AND the Clipboard History entry get the command
    // action panel — Ctrl+K must never run the command directly.
    else if (entry.kind === "internal") setCommandPanelEntry(entry);
    else if (entry.kind === "quicklink-create") setSelected(entry);
    else if (entry.kind === "calculator") setCalculatorPanel(entry);
    else if (entry.kind === "translate") setTranslatePanel(entry);
    else if (entry.kind === "file") setFilePanel(entry.file as FileSearchRow);
    else if (entry.kind === "open-in-explorer") openExplorerEntry(entry.path);
    // Window Management commands have no view or action panel — running IS the only action (the
    // `open-in-explorer` row above works the same way); the args commands open their view.
    else if (entry.kind === "wm-command") runWindowManagementCommand(entry.commandKey, { showToast, closeMainWindow });
    else if (entry.kind === "wm-args") setSelected(entry);
    else if (entry.kind === "focus-action") void runFocusAction(entry.action, { showToast, refresh: refreshFocus }, readLastStartInput());
    else if (entry.kind === "focus-view" || entry.kind === "games-view") setSelected(entry);
    else if (entry.kind === "focus-session") setFocusSessionPanel(entry);
    else if (entry.kind === "game") setGamePanel(entry);
    // A custom translate command's primary action IS opening the view; the panel would add
    // nothing, so Ctrl+K opens the prefilled Translate view directly.
    else if (entry.kind === "translator-command") setSelected(entry);
    else if (entry.kind !== "fallback" && entry.kind !== "inline" && entry.kind !== "quicklink" && entry.kind !== "file-indexing") setCommandPanelEntry(entry);
  }, [showToast, closeMainWindow, refreshFocus]);

  // Raycast rows carry an actions chevron on the right edge; clicking it opens the action panel
  // instead of running the row's primary action (same as Ctrl+K / right-click).
  const renderRowActions = (entry: RootEntry) => (
    <span
      className="list__rowActions"
      role="button"
      title="Actions (Ctrl K)"
      onClick={(event) => {
        event.stopPropagation();
        openRootActionPanel(entry);
      }}
    >
      <OpenrayIcon name="chevron-right" size={12} />
    </span>
  );

  // Enter on a dynamic game row launches it (primary action `Open Game`).
  const openGameEntry = useCallback((game: GamePayload) => {
    void ipc.backend("usage.incrementAppUsage", { appId: game.id, count: 1 }, { module: "backend" }).catch(() => undefined);
    closeMainWindow();
    void ipc.backend("applications.open", { id: game.id }, { module: "backend" }).catch(() => undefined);
  }, [closeMainWindow]);

  const runGamePanelAction = useCallback(
    (game: GamePayload, actionId: string) => {
      const verb = actionId.slice(actionId.indexOf(":") + 1);
      setGamePanel(null);
      switch (verb) {
        case "open":
          openGameEntry(game);
          return;
        case "runAsAdministrator":
          closeMainWindow();
          void ipc.backend("applications.runAsAdministrator", { id: game.id }, { module: "backend" }).catch(() => undefined);
          return;
        case "reveal":
          void ipc.backend("applications.reveal", { id: game.id }, { module: "backend" }).catch(() => undefined);
          return;
        case "copyPath":
        case "copyName":
          void ipc
            .backend(`applications.${verb}`, { id: game.id }, { module: "backend" })
            .then((result) => {
              const content = (result as { content?: string }).content;
              if (content) {
                void ipc.backend("clipboard.write", { content }, { module: "backend" });
                showToast("Copied to clipboard", content);
              }
            })
            .catch(() => undefined);
          return;
        case "copyBundleIdentifier":
          if (game.bundleId) {
            void ipc.backend("clipboard.write", { content: game.bundleId }, { module: "backend" });
            showToast("Copied to clipboard", game.bundleId);
          }
          return;
        case "treatAsApplication":
          void markAsApplication(game.id).then(() => {
            showToast("Marked as application", game.name);
            refreshGameFlags();
          });
          return;
        case "hide":
          void hideGame(game.id).then(() => {
            showToast("Hidden Game", game.name);
            refreshGameFlags();
          });
          return;
        default:
          return;
      }
    },
    [closeMainWindow, openGameEntry, refreshGameFlags, showToast],
  );

  // The Focus session row's actions (the shipped dynamic `session` command). Raycast renders the
  // pause durations as a submenu; this clone flattens them into five actions — documented delta.
  const focusSessionPanelGroups = useMemo<ActionGroup[]>(() => {
    if (!focusSessionPanel) return [];
    const groups: ActionGroup[] = [{ name: "primary", actions: [{ id: "focus:edit", title: "Edit Session", itemId: focusSessionPanel.title }] }];
    const session: ActionGroup[] = [{ name: "session", actions: [] }];
    const actions = session[0].actions;
    actions.push({ id: "focus:restart", title: "Restart Session", itemId: focusSessionPanel.title });
    actions.push({ id: "focus:complete", title: "Complete Session", itemId: focusSessionPanel.title });
    if (focusSessionPanel.status === "running") {
      for (const [label, durationMs] of [
        ["Pause Session for 1 Minute", 60000],
        ["Pause Session for 2 Minutes", 120000],
        ["Pause Session for 5 Minutes", 300000],
        ["Pause Session for 10 Minutes", 600000],
        ["Pause Session Indefinitely", 0],
      ] as const) {
        actions.push({ id: `focus:pause:${durationMs}`, title: label, itemId: focusSessionPanel.title });
      }
    }
    if (focusSessionPanel.status === "paused") {
      actions.push({ id: "focus:resume", title: "Resume Session", itemId: focusSessionPanel.title });
    }
    actions.push({ id: "focus:cancel", title: "Cancel Session", itemId: focusSessionPanel.title });
    groups.push(session[0]);
    return groups;
  }, [focusSessionPanel]);

  const runFocusPanelAction = useCallback(
    (actionId: string) => {
      setFocusSessionPanel(null);
      const verb = actionId.slice(actionId.indexOf(":") + 1);
      const fail = (title: string, error: unknown) => showToast(title, error instanceof Error ? error.message : String(error));
      if (verb === "edit") {
        setSelected({ kind: "focus-view", command: "edit", title: "Edit Focus Session" });
        return;
      }
      if (verb === "restart") {
        void restartFocusSession().then(() => showToast("Focus session started.")).catch((error) => fail("Failed to restart focus session", error));
      } else if (verb === "complete") {
        void completeFocusSession().then(() => showToast("Focus session completed")).catch((error) => fail("Failed to complete focus session", error));
      } else if (verb.startsWith("pause:")) {
        const durationMs = Number(verb.slice("pause:".length));
        void pauseFocusSession(durationMs > 0 ? durationMs : null).then(() => showToast("Focus session paused.")).catch((error) => fail("Failed to pause focus session", error));
      } else if (verb === "resume") {
        void resumeFocusSession().then(() => showToast("Focus session running.")).catch((error) => fail("Failed to resume focus session", error));
      } else if (verb === "cancel") {
        void cancelFocusSession().then(() => showToast("Focus session cancelled")).catch((error) => fail("Failed to cancel focus session", error));
      }
      refreshFocus();
    },
    [refreshFocus, showToast],
  );

  // --- File Search actions (docs/file-search-spec.md — the confirmed action set) ---------------

  const refreshFileSearch = useCallback(() => setFileSearchRefresh((value) => value + 1), []);

  const fileActionHandlers = useMemo(
    () => ({
      showToast,
      refresh: refreshFileSearch,
      openWith: () => undefined, // the root panel omits "Open With…" (it lives in the view)
      saveAsQuicklink: (row: FileSearchRow) => {
        void ipc.backend(
          "quicklinks.save",
          { name: row.name, link: `file:///${row.path.replace(/\\/g, "/")}`, openWith: null, icon: null, tags: ["file"] },
          { module: "backend" },
        )
          .then(() => showToast("Saved as Quicklink", row.name))
          .catch(() => showToast("Failed to save Quicklink"));
      },
    }),
    [showToast, refreshFileSearch],
  );

  const filePanelGroups = useMemo<ActionGroup[]>(
    () => (filePanel ? fileActionGroups(filePanel, { indexing: fileIndexState?.state === "indexing" }) : []),
    [filePanel, fileIndexState],
  );

  const runFilePanelAction = useCallback(
    async (file: FileSearchRow, actionId: string) => {
      const verb = actionId.slice(actionId.indexOf(":") + 1);
      setFilePanel(null);
      if (verb === "delete") {
        // Confirmed confirm string: `Are you sure you want to delete ${filename}?`
        alertStore.open({
          title: `Are you sure you want to delete ${file.name}?`,
          primaryAction: {
            title: "Delete",
            style: "destructive",
            action: () => runFileAction(file, actionId, fileActionHandlers),
          },
          secondaryAction: { title: "Cancel", action: () => undefined },
        });
        return;
      }
      await runFileAction(file, actionId, fileActionHandlers);
    },
    [fileActionHandlers],
  );

  // --- Calculator actions (docs/calculator-spec.md — root row and history row action set) ------

  const upsertCalculatorHistory = useCallback((entry: CalculatorEntry) => {
    return ipc.backend(
      "calculator.historyUpsert",
      { expression: entry.expression, answer: entry.evaluation.answer, category: entry.evaluation.category },
      { module: "backend" },
    );
  }, []);

  const copyCalculatorAnswer = useCallback(
    (entry: CalculatorEntry) => {
      void ipc.backend("clipboard.write", { content: entry.evaluation.answer }, { module: "backend" })
        .then(() => upsertCalculatorHistory(entry))
        .then(() => {
          // Copying gets the launcher out of the way so the paste target is visible; the toast
          // migrates to the HUD (same flow as the application actions).
          showToast("Copied answer to clipboard");
          closeMainWindow();
        })
        .catch(() => showToast("Failed copying answer"));
    },
    [showToast, closeMainWindow, upsertCalculatorHistory],
  );

  const pasteCalculatorAnswer = useCallback(
    (entry: CalculatorEntry) => {
      void upsertCalculatorHistory(entry)
        .then(() => ipc.backend("clipboard.paste", { text: entry.evaluation.answer, shouldCloseWindow: true }, { module: "backend" }))
        .catch(() => showToast("Failed to paste"));
    },
    [showToast, upsertCalculatorHistory],
  );

  const pinCalculation = useCallback(
    (entry: CalculatorEntry) => {
      void upsertCalculatorHistory(entry)
        .then((created) => ipc.backend("calculator.historyPin", { id: (created as { id: string }).id }, { module: "backend" }))
        .then(() => showToast("Pinned calculation"))
        .catch(() => showToast("Failed to pin calculation"));
    },
    [showToast, upsertCalculatorHistory],
  );

  const refreshCurrencies = useCallback(() => {
    void ipc.backend("calculator.refreshCurrencies", {}, { module: "backend" })
      .then(() => showToast("Currencies refreshed!"))
      .catch((error) => showToast("Failed to refresh currencies", error instanceof Error ? error.message : String(error)));
  }, [showToast]);

  const calculatorPanelGroups = useMemo<ActionGroup[]>(() => {
    if (!calculatorPanel) return [];
    const entry = calculatorPanel;
    const actions: Array<{ id: string; title: string; itemId: string }> = [
      { id: "calc:copyAnswer", title: "Copy Answer", itemId: "calculator" },
      { id: "calc:pasteAnswer", title: "Paste Answer", itemId: "calculator" },
      { id: "calc:copyUnformatted", title: "Copy Unformatted Answer", itemId: "calculator" },
      { id: "calc:copyQuestionAndAnswer", title: "Copy Question and Answer", itemId: "calculator" },
      { id: "calc:putAnswerInSearchBar", title: "Put Answer in Search Bar", itemId: "calculator" },
      { id: "calc:pin", title: "Pin Calculation", itemId: "calculator" },
      { id: "calc:showHistory", title: "Show History", itemId: "calculator" },
    ];
    if (entry.evaluation.swappedExpression) {
      actions.splice(5, 0, { id: "calc:swapUnits", title: "Swap Units", itemId: "calculator" });
    }
    if (entry.evaluation.currencyTo) {
      actions.push({ id: "calc:refreshCurrencies", title: "Refresh Currencies", itemId: "calculator" });
    }
    return [{ name: "actions", actions }];
  }, [calculatorPanel]);

  // --- Translator actions (docs/translator-spec.md — quick row and view action set) -----------

  const copyTranslation = useCallback(
    (entry: TranslateEntry) => {
      if (entry.row.status !== "ready" || !entry.row.translatedText) return;
      void ipc.backend("clipboard.write", { content: entry.row.translatedText }, { module: "backend" })
        .then(() => {
          showToast("Copied translation to clipboard");
          closeMainWindow();
        })
        .catch(() => showToast("Failed copying translation"));
    },
    [showToast, closeMainWindow],
  );

  const copySourceText = useCallback(
    (entry: TranslateEntry) => {
      if (!entry.row.sourceText) return;
      void ipc.backend("clipboard.write", { content: entry.row.sourceText }, { module: "backend" })
        .then(() => {
          showToast("Copied source text to clipboard");
          closeMainWindow();
        })
        .catch(() => showToast("Failed copying source text"));
    },
    [showToast, closeMainWindow],
  );

  /** "Open in Translator": the view prefills the source phrase and the row's languages. */
  const openInTranslator = useCallback(
    (entry: TranslateEntry) => {
      setTranslatorSeed({
        id: `quick-${Date.now()}`,
        sourceText: entry.row.sourceText,
        source: "auto",
        target: entry.row.target,
      });
      setSelected(internalCommandEntry("translator", "translate"));
    },
    [],
  );

  const translatePanelGroups = useMemo<ActionGroup[]>(() => {
    if (!translatePanel) return [];
    return [
      {
        name: "actions",
        actions: [
          { id: "tr:copyTranslation", title: "Copy Translation", itemId: "translator" },
          { id: "tr:copySourceText", title: "Copy Source Text", itemId: "translator" },
          { id: "tr:openInTranslator", title: "Open in Translator", itemId: "translator" },
        ],
      },
    ];
  }, [translatePanel]);

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
        // Compact mode with an empty search bar shows no list, so there is no row to act on —
        // Ctrl+K must do nothing (Raycast's compact window behaves the same).
        if (windowMode === "compact" && searchText.trim() === "") return;
        event.preventDefault();
        openRootActionPanel(entries[selectedIndex]);
        return;
      }
      if (key === "ArrowDown" || (key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, entries.length - 1));
      } else if (key === "ArrowUp" || (key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key.length === 1) {
        // Navigation bindings (Keyboard page): emacs Alt+P/Alt+N + Alt+B/Alt-F caret moves, or
        // vim Alt+K/Alt+J + Alt+H/Alt+L — Raycast's `navigationBindings`.
        const vim = navigationBindings.startsWith("Vim");
        const lower = key.toLowerCase();
        const downKey = vim ? "j" : "n";
        const upKey = vim ? "k" : "p";
        if (lower === downKey) {
          event.preventDefault();
          setSelectedIndex((index) => Math.min(index + 1, entries.length - 1));
        } else if (lower === upKey) {
          event.preventDefault();
          setSelectedIndex((index) => Math.max(index - 1, 0));
        } else if (lower === (vim ? "h" : "b") || lower === (vim ? "l" : "f")) {
          event.preventDefault();
          searchRef.current?.focus();
          const input = searchRef.current;
          if (input) {
            const position = lower === (vim ? "h" : "b")
              ? Math.max(0, input.selectionStart ?? input.value.length) - 1
              : Math.min(input.value.length, (input.selectionStart ?? 0) + 1);
            input.setSelectionRange(position, position);
          }
        }
      } else if (key === "Enter") {
        if (panelOpenRef.current) return;
        const entry = entries[selectedIndex];
        if (!entry) return;
        event.preventDefault();
        if (entry.kind === "application") openApplicationEntry(entry.application);
        else if (entry.kind === "quicklink") openQuicklinkRow(entry.quicklink);
        else if (entry.kind === "internal") setSelected(entry);
        else if (entry.kind === "quicklink-create") {
          setQuicklinkCreateLink(entry.link);
          setPendingCreateLink(entry.link);
          setSelected(internalCommandEntry("quicklinks", "create"));
        }
        else if (entry.kind === "extension" && entry.command.disabledReason) {
          // Classified-disabled commands cannot be launched (the backend refuses too); the row
          // explains itself.
          showToast(entry.command.title, entry.command.disabledReason);
        }
        else if (entry.kind === "extension" && hasArguments(entry.command)) {
          // Show argument input UI
          const args = getCommandArguments(entry.command);
          setArgumentValues(getDefaultArgumentValues(args));
          setArgumentErrors([]);
          setArgumentFocusIndex(0);
          setArgumentEntry(entry);
        } else if (entry.kind === "extension" && entry.command.mode === "no-view") {
          // Raycast's no-view commands never open a screen: the window hides at once, the
          // background session runs, and its HUD lands on the host HUD window.
          closeMainWindow();
          setSelected(entry);
        } else if (entry.kind === "inline") {
          // Inline entries (quicklink, snippet, web-search) execute their action and stay/close
          entry.result.action(searchText, closeMainWindow);
          // Optionally close or keep open - for calculator, stay open
        } else if (entry.kind === "calculator") {
          // Enter = primary action = Copy Answer (confirmed).
          copyCalculatorAnswer(entry);
        } else if (entry.kind === "translate") {
          // Enter = primary action = Copy Translation (confirmed for the quick row).
          copyTranslation(entry);
        } else if (entry.kind === "file") {
          openFileEntry(entry.file);
        } else if (entry.kind === "open-in-explorer") {
          openExplorerEntry(entry.path);
        } else if (entry.kind === "wm-command") {
          runWindowManagementCommand(entry.commandKey, { showToast, closeMainWindow });
        } else if (entry.kind === "wm-args") {
          setSelected(entry);
        } else if (entry.kind === "focus-action") {
          void runFocusAction(entry.action, { showToast, refresh: refreshFocus }, readLastStartInput());
        } else if (entry.kind === "focus-view" || entry.kind === "games-view") {
          setSelected(entry);
        } else if (entry.kind === "focus-session") {
          // The session row's primary action is Edit Session (the shipped dynamic command).
          setSelected({ kind: "focus-view", command: "edit", title: "Edit Focus Session" });
        } else if (entry.kind === "game") {
          openGameEntry(entry.app);
        } else {
          setSelected(entry);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entries, selectedIndex, openApplication, commandPanelEntry, selected, quicklinkArgs, openQuicklinkRow, openRootActionPanel, copyCalculatorAnswer, copyTranslation, openFileEntry, openExplorerEntry, showToast, closeMainWindow, refreshFocus, openGameEntry, navigationBindings, windowMode, searchText]);

  // Escape per the Escape Key Behavior setting: "Navigate back or close window" closes at the root
  // (command views pop back on their own); "Close window and pop to root" intercepts every Escape
  // in capture, resets to the root and closes the window — Raycast's two modes.
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
    if (escapeBehavior !== "Close window and pop to root") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSelected(null);
      setOpenApplication(null);
      setCommandPanelEntry(null);
      setArgumentEntry(null);
      closeMainWindow();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [escapeBehavior]);


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
  // Application / quicklink / internal-command hotkeys registered on the Shortcuts page:
  // a separate subscription so the lookups can close over the loaded data.
  useEffect(() => {
    return onNotification("windowManagement.hotkey", (raw) => {
      const payload = raw as { commandKey?: string };
      if (!payload.commandKey) return;
      if (payload.commandKey.startsWith("app:")) {
        const appId = payload.commandKey.slice("app:".length);
        const app = applications.find((candidate) => candidate.payload.id === appId);
        if (app) openApplicationEntry(app);
        return;
      }
      if (payload.commandKey.startsWith("quicklink:")) {
        const quicklinkId = payload.commandKey.slice("quicklink:".length);
        const quicklink = quicklinkRows.find((candidate) => candidate.id === quicklinkId);
        if (quicklink) {
          void ipcRequest("window.showMainWindow", {}, { module: "frontend" }).catch(() => undefined);
          openQuicklinkRow(quicklink);
        }
        return;
      }
      if (payload.commandKey.startsWith("command:internal/")) {
        const [, area, command] = payload.commandKey.split("/");
        void ipcRequest("window.showMainWindow", {}, { module: "frontend" }).catch(() => undefined);
        setSelected(internalCommandEntry(area as InternalArea, command as InternalCommandName));
        return;
      }
      if (payload.commandKey.startsWith("command:")) {
        // Installed-extension command hotkey (`command:<uuid>/<command>`): no-view commands run
        // exactly like their root rows — the window hides and the command lands in the HUD —
        // while view commands open the launcher on the command.
        const [uuid, ...rest] = payload.commandKey.slice("command:".length).split("/");
        const extension = extensions.find((candidate) => candidate.uuid === uuid);
        const commandName = rest.join("/");
        const command = extension?.commands?.find((candidate) => candidate.name === commandName);
        if (extension && command && !command.disabledReason) {
          if (command.mode === "no-view") closeMainWindow();
          else {
            void ipcRequest("window.showMainWindow", {}, { module: "frontend" }).catch(() => undefined);
          }
          setSelected({ kind: "extension", extension, command });
        }
      }
    });
    // openApplicationEntry/openQuicklinkRow are stable; data flows through the deps below.
  }, [applications, quicklinkRows, extensions, openApplicationEntry, openQuicklinkRow, closeMainWindow, setSelected]);

  // Toast actions merge into whatever action panel is open, like Raycast's `getToastActions()`.
  const toastGroups = useToastActionGroups();

  // The Store's "Open Commands…" page launches an installed FlowKey command through the normal
  // session path: swap the running Store session for the extension command.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ uuid: string; command: string }>).detail;
      const extension = extensions.find((entry) => entry.uuid === detail.uuid);
      const command = extension?.commands.find((entry) => entry.name === detail.command);
      if (!extension || !command) return;
      setSelected({ kind: "extension", extension, command });
    };
    window.addEventListener("openray:launch-extension-command", handler);
    return () => window.removeEventListener("openray:launch-extension-command", handler);
  }, [extensions]);

  if (selected) {
    return (
      <>
        <CommandSession
          entry={selected}
          onBack={() => {
            // The seed is consumed on mount; clearing it here keeps a later plain "Translate"
            // open from silently reusing a quick row's phrase.
            setTranslatorSeed(null);
            setSelected(null);
          }}
          showToast={showToast}
          closeMainWindow={closeMainWindow}
          applications={applications}
          createLink={quicklinkCreateLink}
          onConsumeCreateLink={() => setQuicklinkCreateLink(null)}
          translatorSeed={translatorSeed}
          onOpenQuicklinkCreate={(seed) => {
            // The note's Create Quicklink action routes to the Quicklinks create form prefilled.
            setQuicklinkCreateLink(seed);
            setSelected(internalCommandEntry("quicklinks", "create"));
          }}
        />
        <AlertHost />
      </>
    );
  }

  return (
    <div
      className="window"
      onMouseDown={keepSearchFocus}
      data-window-mode={windowMode}
      data-compact-hidden={windowMode === "compact" && searchText.trim().length === 0 ? "true" : undefined}
      data-favorites-compact={showFavoritesCompact ? undefined : "hidden"}
    >
      <header className="window__header">
        <span className="openray-mark" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path fill="currentColor" d="M3.6 3.6h6.4v6.4H3.6zM14 3.6h6.4v6.4H14zM3.6 14h6.4v6.4H3.6zM14 14h6.4v6.4H14z" />
            <path fill="currentColor" d="M14 10.4h-3.6V14H10a3.6 3.6 0 1 0 4 0z" opacity=".9" />
          </svg>
        </span>

        <div className="searchbar">
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
              section.entries.length === 0 ||
              (windowMode === "compact" && !showFavoritesCompact && section.id === "favorites") ? null : (
                <li key={section.id} className="list__section">
                  <div className="list__sectionHeader">
                    <span className="list__sectionTitle">{section.title}</span>
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
                                <OpenrayIcon name="app-window-list" size={16} />
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
                              <span className="list__command-type">Application</span>
                              {renderRowActions(entry)}
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
                              <OpenrayIcon name="copy-clipboard" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">Clipboard History</span>
                              <span className="list__subtitle">
                                Search for text, images, links and colors you copied earlier and paste it
                                again.
                              </span>
                            </span>
                            <span className="list__accessory">
                                                            <span className="list__command-type">view</span>
                              {renderRowActions(entry)}
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
                              <OpenrayIcon name="link" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.quicklink.name}</span>
                              <span className="list__subtitle">{entry.quicklink.link}</span>
                            </span>
                            <span className="list__accessory">
                              {entry.quicklink.args.length > 0 ? (
                                <span className="list__command-type">{entry.quicklink.args.length} args</span>
                              ) : null}
                              <span className="list__command-type">Quicklink</span>
                              {renderRowActions(entry)}
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
                              setSelected(internalCommandEntry("quicklinks", "create"));
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <OpenrayIcon name="plus" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">Create Quicklink</span>
                              <span className="list__subtitle">{entry.link}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">Quicklink</span>
                              {renderRowActions(entry)}
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "internal" ? (
                        <li key={`internal:${entry.commandId}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected(entry)}
                          >
                            <span className={`icon-wrap command-tile ${INTERNAL_EXTENSION_META[entry.area].tile}`} aria-hidden>
                              <OpenrayIcon name={INTERNAL_EXTENSION_META[entry.area].icon} size={13} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{INTERNAL_COMMANDS.find((definition) => definition.area === entry.area && definition.command === entry.command)?.title}</span>
                              <span className="list__subtitle">{INTERNAL_EXTENSION_META[entry.area].title}</span>
                            </span>
                            <span className="list__accessory">
                                                            <span className="list__command-type">Command</span>
                              {renderRowActions(entry)}
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "wm-command" || entry.kind === "wm-args" ? (
                        <li key={`wm:${entry.kind}:${entry.commandKey}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() =>
                              entry.kind === "wm-args"
                                ? setSelected(entry)
                                : runWindowManagementCommand(entry.commandKey, { showToast, closeMainWindow })
                            }
                          >
                            <span className="icon-wrap command-tile command-tile--windowmanagement" aria-hidden>
                              <OpenrayIcon name={wmCommandIcon(entry.commandKey)} size={13} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">{wmCommandDefinition(entry.commandKey)?.description}</span>
                            </span>
                            <span className="list__accessory">
                              {storedWmHotkeys[entry.commandKey] ? (
                                <span className="list__command-type">{storedWmHotkeys[entry.commandKey]}</span>
                              ) : entry.kind === "wm-args" ? (
                                <span className="list__command-type">Args</span>
                              ) : null}
                              {renderRowActions(entry)}
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "focus-view" || entry.kind === "focus-action" ? (
                        <li key={`focus:${entry.kind}:${entry.kind === "focus-view" ? entry.command : entry.action}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() =>
                              entry.kind === "focus-action"
                                ? void runFocusAction(entry.action, { showToast, refresh: refreshFocus }, readLastStartInput())
                                : setSelected(entry)
                            }
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openRootActionPanel(entry);
                            }}
                          >
                            <span className="icon-wrap command-tile command-tile--focus" aria-hidden>
                              <OpenrayIcon name="clock" size={13} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">
                                {FOCUS_COMMANDS.find((definition) => definition.command === (entry.kind === "focus-view" ? entry.command : entry.action))?.description}
                              </span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">Command</span>
                              {renderRowActions(entry)}
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "focus-session" ? (
                        <li key="focus:session-row">
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected({ kind: "focus-view", command: "edit", title: "Edit Focus Session" })}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setFocusSessionPanel(entry);
                            }}
                          >
                            <span className="icon-wrap command-tile command-tile--focus" aria-hidden>
                              <OpenrayIcon name="clock" size={13} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">{focusSessionSubtitle(entry)}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">{entry.status === "paused" ? "Paused" : "Running"}</span>
                              {renderRowActions(entry)}
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "game" ? (
                        <li key={`game:${entry.app.id}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => openGameEntry(entry.app)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setGamePanel(entry);
                            }}
                          >
                            <span className="icon-wrap" aria-hidden>
                              {entry.app.icon ? (
                                <img className="icon__img" src={entry.app.icon} alt="" />
                              ) : (
                                <OpenrayIcon name="game-controller" size={16} />
                              )}
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.app.name}</span>
                              {entry.app.path ? <span className="list__subtitle">{entry.app.path}</span> : null}
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">Game</span>
                              {renderRowActions(entry)}
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
                              <OpenrayIcon name="Blocks" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.command.title}</span>
                              {entry.command.subtitle ? (
                                <span className="list__subtitle">{entry.command.subtitle}</span>
                              ) : null}
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">fallback</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "calculator" ? (
                        <li key="calculator:root-row">
                          <button
                            type="button"
                            className="list__row calc-row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => copyCalculatorAnswer(entry)}
                          >
                            <span className="calc-row__left">
                              <span className="calc-row__expression">{entry.expression}</span>
                              <span className="calc-row__badge">
                                {entry.evaluation.unitFrom ?? entry.evaluation.currencyFrom ?? "Expression"}
                              </span>
                              {entry.evaluation.currencyTo && entry.rates ? (
                                <span className="calc-row__rates" data-stale={entry.rates.stale || undefined}>
                                  {entry.rates.stale
                                    ? "Currency rates are out of date"
                                    : `Updated ${formatRelativeTime(entry.rates.fetchedAt)}`}
                                </span>
                              ) : null}
                            </span>
                            <span className="calc-row__divider" aria-hidden>
                              <OpenrayIcon name="chevron-right" size={14} />
                            </span>
                            <span className="calc-row__right">
                              <span className="calc-row__answer">{entry.evaluation.answer}</span>
                              <span className="calc-row__badge">
                                {entry.evaluation.unitTo ?? entry.evaluation.currencyTo ?? "Result"}
                              </span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "translate" ? (
                        <li key="translate:quick-row">
                          <button
                            type="button"
                            className="list__row calc-row translate-row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => (entry.row.status === "ready" ? copyTranslation(entry) : openInTranslator(entry))}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openRootActionPanel(entry);
                            }}
                          >
                            <span className="calc-row__left">
                              <span className="calc-row__expression">{entry.row.sourceText}</span>
                              <span className="calc-row__badge">
                                {entry.row.sourceLabel ?? "Original"}
                              </span>
                            </span>
                            <span className="calc-row__divider" aria-hidden>
                              <OpenrayIcon name="chevron-right" size={14} />
                            </span>
                            <span className="calc-row__right">
                              <span className={`calc-row__answer${entry.row.status !== "ready" ? " translate-row__pending" : ""}`}>
                                {entry.row.status === "pending"
                                  ? "Translating…"
                                  : entry.row.status === "failed"
                                    ? "Translation unavailable"
                                    : entry.row.translatedText}
                              </span>
                              <span className="calc-row__badge">{entry.row.targetLabel}</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "translator-command" ? (
                        <li key={`translator-command:${entry.command.id}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected(entry)}
                          >
                            <span className={`icon-wrap command-tile ${INTERNAL_EXTENSION_META.translator.tile}`} aria-hidden>
                              <OpenrayIcon name={INTERNAL_EXTENSION_META.translator.icon} size={13} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.command.name}</span>
                              <span className="list__subtitle">
                                {entry.command.sourceLabel
                                  ? `Translate ${entry.command.sourceLabel} to ${entry.command.targetLabel}`
                                  : `Translate to ${entry.command.targetLabel}`}
                              </span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">Translator</span>
                              {renderRowActions(entry)}
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
                              {entry.result.type === "snippet" && <OpenrayIcon name="copy" size={16} />}
                              {entry.result.type === "web-search" && entry.result.icon && (
                                <span className="web-search-icon" dangerouslySetInnerHTML={{ __html: entry.result.icon }} />
                              )}
                              {entry.result.type === "web-search" && !entry.result.icon && <OpenrayIcon name="globe" size={16} />}
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.result.title}</span>
                              <span className="list__subtitle">{entry.result.subtitle}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">{entry.result.type}</span>
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
                            onClick={() => openFileEntry(entry.file)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openRootActionPanel(entry);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <OpenrayIcon name={fileIconFor(entry.file.contentType ?? "other")} size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.file.name}</span>
                              <span className="list__subtitle">{entry.file.folder}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">{entry.file.contentType ?? "file"}</span>
                              {renderRowActions(entry)}
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "file-indexing" ? (
                        <li key="file-indexing">
                          <div className="list__row list__row--static" data-selected={index === selectedIndex}>
                            <span className="icon" aria-hidden>
                              <OpenrayIcon name="arrow-clockwise" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">File Search is indexing…</span>
                              <span className="list__subtitle">
                                Indexing {entry.fileCount} files
                                {entry.entriesPerSecond ? ` (${entry.entriesPerSecond} entries/s)` : ""}
                              </span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">files</span>
                            </span>
                          </div>
                        </li>
                      ) : entry.kind === "open-in-explorer" ? (
                        <li key="open-in-explorer">
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => openExplorerEntry(entry.path)}
                          >
                            <span className="icon" aria-hidden>
                              <OpenrayIcon name="folder" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">Open in File Explorer</span>
                              <span className="list__subtitle">{entry.path}</span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">explorer</span>
                            </span>
                          </button>
                        </li>
                      ) : entry.kind === "games-view" ? (
                        <li key="games:launcher-row">
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => setSelected(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelected(entry);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <OpenrayIcon name="game-controller" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">Launch games from Steam, Epic, Xbox, Riot, and more.</span>
                            </span>
                            <span className="list__accessory">
                              <span className="list__command-type">Command</span>
                            </span>
                          </button>
                        </li>
                      ) : (
                        <li key={`ext:${entry.extension.uuid}:${entry.command.name}`}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            data-disabled={entry.command.disabledReason ? "true" : undefined}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => {
                              if (entry.command.disabledReason) {
                                showToast(entry.command.title, entry.command.disabledReason);
                                return;
                              }
                              if (entry.command.mode === "no-view") {
                                closeMainWindow();
                                setSelected(entry);
                                return;
                              }
                              setSelected(entry);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openRootActionPanel(entry);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <ExtensionIcon uuid={entry.extension.uuid} size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.command.title}</span>
                              <span className="list__subtitle">
                                {entry.command.disabledReason || entry.command.description || entry.extension.title}
                              </span>
                            </span>
                            <span className="list__accessory">
                              {entry.command.disabledReason ? (
                                <span className="pill list__disabled-pill" title={entry.command.disabledReason}>Disabled</span>
                              ) : null}
                              <span className="list__command-type">{entry.command.mode ?? "view"}</span>
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
          <OpenrayIcon name="cog" size={16} />
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
        title={
          commandPanelEntry?.kind === "clipboard"
            ? "Clipboard History"
            : commandPanelEntry?.kind === "internal"
              ? INTERNAL_COMMANDS.find((definition) => definition.area === commandPanelEntry.area && definition.command === commandPanelEntry.command)?.title
              : commandPanelEntry?.command.title
        }
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
                : entry.kind === "internal"
                  ? internalFavoriteKey(entry.commandId)
                  : commandFavoriteKey(entry.extension.uuid, entry.command.name);
            const added = toggleFavorite(key);
            showToast(
              added ? "Added to Favorites" : "Removed from Favorites",
              entry.kind === "clipboard"
                ? "Clipboard History"
                : entry.kind === "internal"
                  ? (INTERNAL_COMMANDS.find((definition) => definition.area === entry.area && definition.command === entry.command)?.title ?? entry.commandId)
                  : entry.command.title,
            );
          } else if (verb === "configureCommand") {
            openSettings();
          }
        }}
      />

      <ActionPanel
        open={filePanel !== null}
        title={filePanel?.name}
        groups={filePanelGroups}
        onClose={() => setFilePanel(null)}
        onRun={async (action) => {
          const file = filePanel;
          if (!file) return;
          if (action.id === "file:open") closeMainWindow();
          await runFilePanelAction(file, action.id);
        }}
      />

      <ActionPanel
        open={calculatorPanel !== null}
        title="Calculator"
        groups={[...calculatorPanelGroups, ...toastGroups]}
        onClose={() => setCalculatorPanel(null)}
        onRun={async (action) => {
          const entry = calculatorPanel;
          if (!entry) return;
          if (await runToastAction(action.id)) {
            setCalculatorPanel(null);
            return;
          }
          setCalculatorPanel(null);
          switch (action.id) {
            case "calc:copyAnswer":
              copyCalculatorAnswer(entry);
              break;
            case "calc:pasteAnswer":
              pasteCalculatorAnswer(entry);
              break;
            case "calc:copyUnformatted":
              void ipc.backend("clipboard.write", { content: entry.evaluation.unformatted }, { module: "backend" })
                .then(() => upsertCalculatorHistory(entry))
                .then(() => {
                  showToast("Copied to clipboard");
                  closeMainWindow();
                })
                .catch(() => showToast("No unformatted result available"));
              break;
            case "calc:copyQuestionAndAnswer":
              void ipc.backend(
                "clipboard.write",
                { content: `${entry.expression} = ${entry.evaluation.answer}` },
                { module: "backend" },
              )
                .then(() => upsertCalculatorHistory(entry))
                .then(() => {
                  showToast("Copied to clipboard");
                  closeMainWindow();
                })
                .catch(() => showToast("Failed copying answer"));
              break;
            case "calc:putAnswerInSearchBar":
              setSearchText(entry.evaluation.answer);
              break;
            case "calc:swapUnits":
              if (entry.evaluation.swappedExpression) setSearchText(entry.evaluation.swappedExpression);
              break;
            case "calc:pin":
              pinCalculation(entry);
              break;
            case "calc:showHistory":
              setSelected(internalCommandEntry("calculator", "history"));
              break;
            case "calc:refreshCurrencies":
              refreshCurrencies();
              break;
          }
        }}
      />

      <ActionPanel
        open={focusSessionPanel !== null}
        title="Focus Session"
        groups={[...focusSessionPanelGroups, ...toastGroups]}
        onClose={() => setFocusSessionPanel(null)}
        onRun={async (action) => {
          if (await runToastAction(action.id)) {
            setFocusSessionPanel(null);
            return;
          }
          runFocusPanelAction(action.id);
        }}
      />

      <ActionPanel
        open={gamePanel !== null}
        title="Game"
        groups={[...gamePanelGroups, ...toastGroups]}
        onClose={() => setGamePanel(null)}
        onRun={async (action) => {
          const entry = gamePanel;
          if (!entry) return;
          if (await runToastAction(action.id)) {
            setGamePanel(null);
            return;
          }
          runGamePanelAction(entry.app, action.id);
        }}
      />

      <ActionPanel
        open={translatePanel !== null}
        title="Translate"
        groups={[...translatePanelGroups, ...toastGroups]}
        onClose={() => setTranslatePanel(null)}
        onRun={async (action) => {
          const entry = translatePanel;
          if (!entry) return;
          if (await runToastAction(action.id)) {
            setTranslatePanel(null);
            return;
          }
          setTranslatePanel(null);
          switch (action.id) {
            case "tr:copyTranslation":
              copyTranslation(entry);
              break;
            case "tr:copySourceText":
              copySourceText(entry);
              break;
            case "tr:openInTranslator":
              openInTranslator(entry);
              break;
          }
        }}
      />

      <AlertHost />

    </div>
  );
}

