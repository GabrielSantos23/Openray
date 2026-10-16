// The Settings window shell: custom titlebar (Raycast's `settings-navigation-header`), sidebar
// (search + account + grouped pages), hash router with row deep-links, and the row renderer.
// Rows write through `setValue` to the backend stores they belong to (unchanged wiring), and the
// General/Keyboard rows use the settings store from ./store (live-updated in both windows).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RaycastIcon } from "../icons";
import { ipc, ipcRequest, onNotification } from "../ipc";
import { installSystemAccent } from "../app/systemAccent";
import { type Sensitivity } from "../matching";
import type { FileSearchSettings } from "../fileSearch";
import {
  ACCOUNT_PAGE_ID,
  PAGES,
  SIDEBAR_PAGE_IDS,
  EXTENSION_PAGE_IDS,
  type PageDefinition,
  type RowDefinition,
  type SettingsMap,
  type SettingsValue,
  NOTES_ZOOM_LABEL_BY_VALUE,
  NOTES_ZOOM_VALUE_BY_LABEL,
} from "./pages";
import {
  CALCULATOR_ROW_IDS,
  CLIPBOARD_PREFERENCE_ROWS,
  CLIPBOARD_ROW_IDS,
  DEFAULTS,
  FILE_SEARCH_ROW_IDS,
  FOCUS_SNOOZE_BY_LABEL,
  FOCUS_SNOOZE_LABEL,
  HISTORY_DURATION_BY_LABEL,
  NOTES_ESCAPE_BY_LABEL,
  NOTES_ESCAPE_LABEL,
  NOTES_ROW_IDS,
  QUICKLINKS_ROW_IDS,
  SENSITIVITY_MAP,
  SNIPPETS_INJECTION_DELAY_BY_LABEL,
  SNIPPETS_INJECTION_DELAY_LABEL,
  SNIPPETS_MODE_BY_LABEL,
  SNIPPETS_MODE_LABEL,
  SNIPPETS_RESPONSE_TIME_BY_LABEL,
  SNIPPETS_RESPONSE_TIME_LABEL,
  SNIPPETS_SOUND_BY_LABEL,
  SNIPPETS_SOUND_LABEL,
  SNIPPETS_ROW_IDS,
  TASKBAR_POSITION_BY_LABEL,
  TASKBAR_POSITION_LABEL,
  TRANSLATOR_ROW_IDS,
  formatFilterRows,
  parseFallbackCommands,
  parseFilterRows,
  persistSettings,
  type ClipboardFilter,
} from "./persistence";
import {
  Button,
  ButtonRadioGroup,
  HotkeyRecorder,
  IconButton,
  SearchField,
  Select,
  Switch,
  WindowModeCards,
} from "./controls";
import { TranslatorCustomCommands } from "./TranslatorCustomCommands";
import { ExtensionPreferences } from "./ExtensionPreferences";
import { applyPreset, readStoredHotkeys } from "../windowManagement";
import { WM_COMMANDS } from "../wm-commands";
import { getSettings, installSettingsPush, syncFromBackend, updateSettings, useSetting, useSettings } from "./store";

/** The launcher default; Raycast's own default (Win key) is not interceptable here. */
const RAYCASTMINI_DEFAULT_HOTKEY = "Alt + Space";

export function Settings() {
  const [query, setQuery] = useState("");
  const storedValues = useSettings();
  // The legacy per-row stores (clipboard/snippets/...) still merge into a local map so the same
  // Row renderer can show them; they write through to their backend modules in `setValue`.
  const [values, setValues] = useState<SettingsMap>(() => ({ ...DEFAULTS, ...getSettings() }));

  const mergeValues = useCallback((patch: SettingsMap) => {
    setValues((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    syncFromBackend();
    installSystemAccent();
    const offNavigate = onNotification("settings.navigate", (route) => {
      if (typeof route === "string" && route) window.location.hash = `#/${route.replace(/^\/+/, "")}`;
    });
    const offPush = installSettingsPush();
    return () => {
      offNavigate();
      offPush();
    };
  }, []);

  // Interface Size zooms the Settings window too (Raycast scales the whole app).
  const interfaceSize = String(useSetting("interface-size") ?? "1");
  useEffect(() => {
    const zoom = Number(interfaceSize);
    document.documentElement.style.zoom = zoom > 1 && zoom <= 1.2 ? String(zoom) : "";
  }, [interfaceSize]);

  // Escape Key Closes Window (Keyboard page): Escape dismisses the Settings window.
  const escapeClosesWindow = useSetting("escape-key-closes-window") !== false;
  useEffect(() => {
    if (!escapeClosesWindow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      void ipcRequest("window.closeSettings", {}, { module: "frontend" }).catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [escapeClosesWindow]);

  // Keep the legacy mirror in sync with the settings store for the ids it owns.
  useEffect(() => {
    setValues((current) => {
      let changed = false;
      const merged = { ...current };
      for (const [key, value] of Object.entries(storedValues) as Array<[string, SettingsValue]>) {
        if (!(key in DEFAULTS)) continue;
        if (JSON.stringify(merged[key]) !== JSON.stringify(value)) {
          merged[key] = value;
          changed = true;
        }
      }
      return changed ? merged : current;
    });
  }, [storedValues]);

  const [route, setRoute] = useState<string>(() => {
    const hash = window.location.hash.replace(/^#\/?/, "");
    const page = hash.split("?")[0] || window.localStorage.getItem("settings:last-page") || "general";
    return page;
  });
  const [highlightRow, setHighlightRow] = useState<string | null>(() => {
    const hash = window.location.hash.replace(/^#\/?/, "");
    const params = new URLSearchParams(hash.split("?")[1] ?? "");
    return params.get("row");
  });

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, "");
      setRoute(hash.split("?")[0] || "general");
      setHighlightRow(new URLSearchParams(hash.split("?")[1] ?? "").get("row"));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((pageId: string) => {
    window.localStorage.setItem("settings:last-page", pageId);
    window.location.hash = `#/${pageId}`;
    setRoute(pageId);
    setHighlightRow(null);
    setQuery("");
  }, []);

  // Row deep-links: scroll the row into view and pulse it (Raycast's `data-highlight`).
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!highlightRow) return;
    const element = rowRefs.current.get(highlightRow);
    element?.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => setHighlightRow(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightRow, route]);

  // ...legacy backend-backed mirrors (clipboard, quicklinks, snippets, calculator, translator,
  // file search, focus/games/taskbar/notes, window-management hotkeys) — unchanged wiring.
  useLegacyRowMirrors(mergeValues);

  const setValue = useCallback(
    (id: string, next: SettingsValue) => {
      const generalKeys = new Set([
        "open-at-login",
        "show-in-menu-bar",
        "automatically-show-taskbar",
        "raycast-hotkey",
        "replace-start-menu",
        "follow-system-appearance",
        "theme-dark",
        "theme-light",
        "window-mode",
        "show-favorites-in-compact-mode",
        "interface-size",
        "show-raycast-on",
        "pop-to-root-search",
        "root-search-sensitivity",
        "escape-key-behavior",
        "escape-key-closes-window",
      ]);
      if (generalKeys.has(id)) {
        const previous = values[id] ?? DEFAULTS[id] ?? next;
        updateSettings({ [id]: next });
        mergeValues({ [id]: next });
        applyGeneralSetting(id, next).catch((error: unknown) => {
          // Registration failures restore the previous value (not a blind `!next`, which would
          // corrupt non-boolean rows like the hotkey) and surface Raycast's error toast.
          updateSettings({ [id]: previous });
          mergeValues({ [id]: previous });
          window.dispatchEvent(
            new CustomEvent("raycast-mini:settings-toast", {
              detail: {
                title: error instanceof Error ? error.message : "Failed to update Open at Login",
              },
            }),
          );
        });
        return;
      }
      setValues((current) => {
        const merged = { ...current, [id]: next };
        persistSettings(merged);
        return merged;
      });
      routeLegacyRow(id, next, values);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergeValues, values],
  );

  const runAction = useCallback((id: string) => {
    runLegacyAction(id, values, mergeValues);
    if (id === "reset-search-history") {
      window.localStorage.removeItem("raycast-mini:search-history");
      window.dispatchEvent(
        new CustomEvent("raycast-mini:settings-toast", { detail: { title: "Search history cleared" } }),
      );
      return;
    }
    if (id === "reset-all-rankings") {
      void ipc
        .backend("usage.resetAllAppUsage", {}, { module: "backend" })
        .then(() => {
          window.dispatchEvent(
            new CustomEvent("raycast-mini:settings-toast", { detail: { title: "All rankings reset" } }),
          );
        })
        .catch(() => {
          window.dispatchEvent(
            new CustomEvent("raycast-mini:settings-toast", { detail: { title: "Failed to reset rankings" } }),
          );
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, mergeValues]);

  const page = useMemo(() => PAGES.find((candidate) => candidate.id === route) ?? PAGES[0], [route]);
  const results = useMemo(() => searchResults(query), [query]);

  const [translatorLanguages, setTranslatorLanguages] = useState<Array<{ code: string; name: string }>>([]);
  useEffect(() => {
    ipc
      .backend("translator.getLanguages", {}, { module: "backend" })
      .then((response) => {
        setTranslatorLanguages(((response as { languages?: Array<{ code: string; name: string }> }).languages ?? []) as Array<{ code: string; name: string }>);
      })
      .catch(() => undefined);
  }, []);

  const translatorDynamicOptions = useMemo(() => {
    const names = translatorLanguages.map((language) => language.name);
    return {
      "translator-default-source-language": ["Detect Language", ...names],
      "translator-default-target-language": names,
    };
  }, [translatorLanguages]);

  return (
    <div className="settings-window">
      <Titlebar page={page} onNavigate={navigate} />
      <div className="settings-chrome">
        <Sidebar
          route={route}
          query={query}
          onQueryChange={setQuery}
          results={results}
          onNavigate={navigate}
        />
        <main className="settings-main">
          <header className="settings-header" data-raycast-window-draggable-region="true" />
          <div className="settings-page__scroll">
            <div className="settings-page">
              {page.sections.length === 0 || page.sections.every((section) => section.rows.length === 0) ? (
                <div className="settings-page__empty">{page.empty ?? "No settings available."}</div>
              ) : (
                page.sections.map((section) =>
                  section.rows.length === 0 ? null : (
                    <section className="settings-section" key={section.id}>
                      {section.title ? (
                        <h2 className="settings-section__title">
                          <span className="settings-section__titleInner">{section.title}</span>
                        </h2>
                      ) : null}
                      {section.description ? (
                        <p className="settings-section__description">{section.description}</p>
                      ) : null}
                      <div className="settings-section__content">
                        {section.rows
                          .filter((row) => !row.visibleWhen || row.visibleWhen(values))
                          .map((row) => (
                            <div key={row.id} ref={(element) => {
                              if (element) rowRefs.current.set(row.id, element);
                              else rowRefs.current.delete(row.id);
                            }}>
                              <Row
                                row={row}
                                value={values[row.id]}
                                highlight={highlightRow === row.id}
                                onValueChange={(next) => setValue(row.id, next)}
                                onAction={() => runAction(row.id)}
                                allValues={values}
                                dynamicOptions={translatorDynamicOptions}
                              />
                            </div>
                          ))}
                      </div>
                      {section.empty ? <p className="settings-section__empty">{section.empty}</p> : null}
                    </section>
                  ),
                )
              )}
              {page.id === "translator" ? <TranslatorCustomCommands /> : null}
              {page.id === "extensions" ? <ExtensionPreferences /> : null}
            </div>
          </div>
        </main>
      </div>
      <SettingsToastHost />
    </div>
  );
}

/** The in-page titlebar: sidebar "Settings" label, back/forward, page title, caption buttons. */
function Titlebar({ page, onNavigate }: { page: PageDefinition; onNavigate: (pageId: string) => void }) {
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const update = () => {
      setCanGoBack(window.history.length > 1 && window.history.state?.index > 0);
      setCanGoForward(Boolean(window.history.state?.index < (window.history.state?.length ?? 1) - 1));
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return createPortal(
    <div
      className="settings-titlebar"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        void ipcRequest("window.dragSettings", {}, { module: "frontend" }).catch(() => undefined);
      }}
      onDoubleClick={() => void ipcRequest("window.maximizeSettings", {}, { module: "frontend" }).catch(() => undefined)}
    >
      <span className="settings-titlebar__sidebarLabel">Settings</span>
      <div className="settings-titlebar__nav" data-raycast-window-draggable-region="true">
        <button
          type="button"
          className="settings-titlebar__chevron"
          onMouseDown={(event) => event.stopPropagation()}
          disabled={!canGoBack}
          aria-label="Back"
          onClick={() => window.history.back()}
        >
          <RaycastIcon name="chevron-right" size={12} />
        </button>
        <button
          type="button"
          className="settings-titlebar__chevron"
          onMouseDown={(event) => event.stopPropagation()}
          disabled={!canGoForward}
          aria-label="Forward"
          onClick={() => window.history.forward()}
        >
          <RaycastIcon name="chevron-right" size={12} />
        </button>
        <span className="settings-titlebar__page">{page.title}</span>
      </div>
      <div className="settings-titlebar__caption">
        <button
          type="button"
          className="settings-caption-button"
          aria-label="Minimize"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void ipcRequest("window.minimize", {}, { module: "frontend" })}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="settings-caption-button settings-caption-button--close"
          aria-label="Close"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void ipcRequest("window.closeSettings", {}, { module: "frontend" })}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}

function Sidebar({
  route,
  query,
  onQueryChange,
  results,
  onNavigate,
}: {
  route: string;
  query: string;
  onQueryChange: (next: string) => void;
  results: Array<{ pageId: string; rowId?: string; title: string; group: string }>;
  onNavigate: (pageId: string) => void;
}) {
  const searchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navRef = useRef<HTMLDivElement>(null);
  const onNavKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>(".settings-navlink") ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
    items[index === -1 ? 0 : next]?.focus();
  };

  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar__spacer" />
      <div className="settings-sidebar__search" ref={searchRef}>
        <SearchField
          value={query}
          placeholder="Search settings…"
          ariaLabel="Search settings"
          onChange={onQueryChange}
          onEscape={() => onQueryChange("")}
        />
      </div>
      <div className="settings-sidebar__scroll">
        {results.length > 0 ? (
          <div className="settings-sidebar__content" data-searching="true">
            {results.map((result) => (
              <button
                key={`${result.pageId}:${result.rowId ?? result.title}`}
                type="button"
                className="settings-navlink settings-navlink--result"
                onClick={() => {
                  onNavigate(result.pageId);
                  if (result.rowId) {
                    window.location.hash = `#/${result.pageId}?row=${result.rowId}`;
                  }
                }}
              >
                <span className="settings-navlink__icon">
                  <RaycastIcon name={result.rowId ? "chevron-right" : (PAGES.find((p) => p.id === result.pageId)?.icon ?? "cog")} size={16} />
                </span>
                <span className="settings-navlink__resultText">
                  <span className="settings-navlink__label">{result.title}</span>
                  <span className="settings-navlink__group">{result.group}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="settings-sidebar__content" onKeyDown={onNavKeyDown}>
            <div className="settings-sidebar__group" ref={navRef}>
              <div className="settings-account">
                <span className="settings-account__avatar">
                  <RaycastIcon name="person" size={20} />
                </span>
                <span className="settings-account__text">
                  <span className="settings-account__name">RaycastMini</span>
                  <span className="settings-account__subtitle">Account</span>
                </span>
              </div>
              {SIDEBAR_PAGE_IDS.map((pageId) => {
                const definition = PAGES.find((candidate) => candidate.id === pageId);
                if (!definition) return null;
                return (
                  <SidebarLink
                    key={pageId}
                    pageId={pageId}
                    title={definition.title}
                    icon={definition.icon}
                    pro={definition.pro}
                    active={route === pageId}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
            <div className="settings-sidebar__group">
              {EXTENSION_PAGE_IDS.map((pageId) => {
                const definition = PAGES.find((candidate) => candidate.id === pageId);
                if (!definition) return null;
                return (
                  <SidebarLink
                    key={pageId}
                    pageId={pageId}
                    title={definition.title}
                    icon={definition.icon}
                    pro={definition.pro}
                    active={route === pageId}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function SidebarLink({
  pageId,
  title,
  icon,
  pro,
  active,
  onNavigate,
}: {
  pageId: string;
  title: string;
  icon: string;
  pro?: boolean;
  active: boolean;
  onNavigate: (pageId: string) => void;
}) {
  return (
    <button type="button" className="settings-navlink" data-active={active} onClick={() => onNavigate(pageId)}>
      <span className="settings-navlink__icon">
        <RaycastIcon name={icon} size={18} />
      </span>
      <span className="settings-navlink__label">{title}</span>
      {pro ? <span className="settings-badge">Pro</span> : null}
    </button>
  );
}

function Row({
  row,
  value,
  onValueChange,
  onAction,
  allValues,
  dynamicOptions,
  highlight,
}: {
  row: RowDefinition;
  value: SettingsValue | undefined;
  onValueChange: (next: SettingsValue) => void;
  onAction: () => void;
  allValues: SettingsMap;
  dynamicOptions?: Record<string, string[]>;
  highlight?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const descriptionClampable = Boolean(row.description && row.description.length > 140);

  const right = (): ReactNode => {
    switch (row.control) {
      case "switch":
        return (
          <Switch
            label={row.title}
            checked={Boolean(value)}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "select":
        return (
          <Select
            label={row.title}
            value={String(value ?? row.options?.[0] ?? "")}
            options={dynamicOptions?.[row.id] ?? row.options ?? []}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "interfaceSize": {
        const zoom = Number(value ?? 1);
        const aa = (px: number) => <span style={{ fontSize: px, lineHeight: 1 }}>Aa</span>;
        return (
          <ButtonRadioGroup
            label="Interface Size"
            value={String(zoom)}
            onChange={onValueChange}
            items={[
              { value: "1", label: "Default", render: aa(10) },
              { value: "1.1", label: "Large", render: aa(13) },
              { value: "1.2", label: "Larger", render: aa(17) },
            ]}
          />
        );
      }
      case "windowMode":
        return <WindowModeCards value={String(value ?? "expanded")} onChange={onValueChange} />;
      case "hotkey":
        return <HotkeyRow row={row} value={String(value ?? "")} onValueChange={onValueChange} />;
      case "textarea":
        return (
          <textarea
            className="settings-textarea"
            aria-label={row.title}
            placeholder={row.description}
            value={String(value ?? "")}
            disabled={row.unavailable}
            onChange={(event) => onValueChange(event.target.value)}
          />
        );
      case "textarea-commit":
        return <CommitTextarea row={row} value={String(value ?? "")} onCommit={onValueChange} />;
      case "text":
        return (
          <input
            className="settings-textfield"
            aria-label={row.title}
            inputMode="numeric"
            value={String(value ?? "")}
            disabled={row.unavailable}
            onChange={(event) => onValueChange(event.target.value)}
          />
        );
      case "action": {
        const actionValue = value === undefined || value === "" ? row.value : String(value);
        return (
          <span className="settings-row__right">
            {actionValue ? <span className="settings-row__value">{actionValue}</span> : null}
            <Button disabled={row.unavailable} onClick={() => { onAction(); void runRowAction(row); }}>
              {row.action}
            </Button>
          </span>
        );
      }
      case "info":
        return <span className="settings-row__value">{row.value ?? (value !== undefined ? String(value) : "")}</span>;
      default:
        return null;
    }
  };

  return (
    <div
      className="settings-row"
      data-row-id={row.id}
      data-align={row.description ? "start" : "center"}
      data-highlight={highlight ? "true" : undefined}
    >
      <div className="settings-row__left">
        <div className="settings-row__text">
          <span className="settings-row__title">
            {row.title}
            {row.pro ? <span className="settings-badge" style={{ marginLeft: 8 }}>Pro</span> : null}
          </span>
          {row.description ? (
            <>
              <span className="settings-row__description" data-clamped={!expanded && descriptionClampable ? "true" : undefined}>
                {row.description}
              </span>
              {descriptionClampable ? (
                <button type="button" className="settings-row__showMore" onClick={() => setExpanded((state) => !state)}>
                  {expanded ? "Show less" : "Show more"}
                </button>
              ) : null}
            </>
          ) : null}
          {row.unavailable ? <span className="settings-row__unavailable">Not available in RaycastMini</span> : null}
        </div>
      </div>
      <div className="settings-row__right">{right()}</div>
    </div>
  );
}

/** The Raycast Hotkey composite: Replace Start Menu toggle, recorder, reset. */
function HotkeyRow({
  row,
  value,
  onValueChange,
}: {
  row: RowDefinition;
  value: string;
  onValueChange: (next: string) => void;
}) {
  const isDefault = value === row.value;
  const replaceStartMenu = useSetting("replace-start-menu") === true;
  const toggleStartMenu = () => {
    const next = !replaceStartMenu;
    updateSettings({ "replace-start-menu": next });
    void ipcRequest("settings.replaceStartMenu", { enabled: next }, { module: "frontend" }).catch(() => {
      updateSettings({ "replace-start-menu": !next });
      window.dispatchEvent(
        new CustomEvent("raycast-mini:settings-toast", {
          detail: { title: next ? "Failed to register the Win key" : "Failed to restore the Start Menu" },
        }),
      );
    });
  };
  return (
    <span className="settings-row__right">
      {row.id === "raycast-hotkey" ? (
        <Button
          title="The Win key will open Raycast instead of the Start Menu. You'll still be able to open the Start Menu from the taskbar."
          onClick={toggleStartMenu}
        >
          {replaceStartMenu ? "Restore Start Menu" : "Replace Start Menu"} <span aria-hidden>⊞</span>
        </Button>
      ) : null}
      {!isDefault && row.value && row.id !== "raycast-hotkey" ? (
        <Button onClick={() => onValueChange(row.value ?? "")}>Restore Default</Button>
      ) : null}
      <HotkeyRecorder value={value} onChange={onValueChange} footerLabel="Raycast Hotkey" />
      <IconButton
        icon="arrow-clockwise"
        size={12}
        title="Reset to default hotkey"
        disabled={isDefault}
        onClick={() => onValueChange(row.value ?? "")}
      />
    </span>
  );
}

function CommitTextarea({
  row,
  value,
  onCommit,
}: {
  row: RowDefinition;
  value: string;
  onCommit: (next: SettingsValue) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <textarea
      className="settings-textarea"
      aria-label={row.title}
      placeholder={row.description}
      value={draft}
      disabled={row.unavailable}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function SettingsToastHost() {
  const [toast, setToast] = useState<{ title: string; message?: string } | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      setToast((event as CustomEvent).detail as { title: string; message?: string });
    };
    window.addEventListener("raycast-mini:settings-toast", handler);
    return () => window.removeEventListener("raycast-mini:settings-toast", handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="settings-toastHost">
      <div className="settings-section__content" style={{ minWidth: 260, padding: "10px 12px" }}>
        <div style={{ fontSize: 13 }}>{toast.title}</div>
        {toast.message ? (
          <div style={{ fontSize: 11, color: "var(--settings-text-secondary)", marginTop: 4 }}>{toast.message}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Rows whose "action" is a real link or a no-op with a visible outcome. */
async function runRowAction(row: RowDefinition): Promise<void> {
  const links: Record<string, string> = {
    website: "https://github.com/GabrielSantos23/RaycastMini",
    "slack-community": "https://github.com/GabrielSantos23/RaycastMini",
    "open-changelog": "https://github.com/GabrielSantos23/RaycastMini/releases",
    "send-feedback": "https://github.com/GabrielSantos23/RaycastMini/issues",
  };
  const target = links[row.id];
  if (target) window.open(target, "_blank", "noopener");
}

// ---------------------------------------------------------------------------------------------
// General/Keyboard rows apply at runtime through the host. Failures throw so the caller can roll
// the switch back (Raycast's openAtLogin rollback + toast).
// ---------------------------------------------------------------------------------------------

async function applyGeneralSetting(id: string, next: SettingsValue): Promise<void> {
  switch (id) {
    case "open-at-login":
      await ipcRequest("settings.openAtLogin", { enabled: Boolean(next) }, { module: "frontend" });
      return;
    case "show-in-menu-bar":
      await ipcRequest("settings.trayIcon", { enabled: Boolean(next) }, { module: "frontend" });
      return;
    case "automatically-show-taskbar":
      await ipcRequest("settings.automaticallyShowTaskbar", { enabled: Boolean(next) }, { module: "frontend" });
      return;
    case "raycast-hotkey":
      await ipcRequest("settings.setGlobalHotkey", { hotkey: String(next) }, { module: "frontend" });
      return;
    case "replace-start-menu":
      await ipcRequest("settings.replaceStartMenu", { enabled: Boolean(next) }, { module: "frontend" });
      return;
    case "follow-system-appearance":
    case "theme-dark":
    case "theme-light":
    case "window-mode":
    case "show-favorites-in-compact-mode":
    case "interface-size":
      // Pure renderer concerns applied via the settings.changed push in both windows.
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------------------------
// Legacy row routing — the per-store writes that predate the settings store and keep working.
// ---------------------------------------------------------------------------------------------

function routeLegacyRow(id: string, next: SettingsValue, values: SettingsMap): void {
  const toaster = (title: string, message?: string) =>
    window.dispatchEvent(new CustomEvent("raycast-mini:settings-toast", { detail: { title, message } }));

  if (QUICKLINKS_ROW_IDS.has(id)) {
    if (id === "quicklinks-pass-selected-text") {
      void ipc.backend("quicklinks.setPreference", { key: "passSelectedTextAsArgument", value: Boolean(next) }, { module: "backend" }).catch(() => undefined);
    } else if (id === "quicklinks-warn-before-delete") {
      window.localStorage.setItem("raycast-mini:quicklinks-warn-delete", next ? "1" : "0");
    }
    return;
  }
  if (SNIPPETS_ROW_IDS.has(id)) {
    const setSnippetPreference = (key: string, value: unknown) => {
      void ipc.backend("snippets.setPreference", { key, value }, { module: "backend" }).catch(() => undefined);
    };
    if (id === "snippets-enable-expansion") setSnippetPreference("autoExpansionEnabled", Boolean(next));
    else if (id === "snippets-expansion-mode") setSnippetPreference("expansionMode", SNIPPETS_MODE_BY_LABEL[String(next)] ?? "immediately");
    else if (id === "snippets-expand-within-words") setSnippetPreference("expandWithinWords", Boolean(next));
    else if (id === "snippets-injection-delay") setSnippetPreference("injectionDelay", SNIPPETS_INJECTION_DELAY_BY_LABEL[String(next)] ?? "none");
    else if (id === "snippets-response-time") setSnippetPreference("responseTime", SNIPPETS_RESPONSE_TIME_BY_LABEL[String(next)] ?? "default");
    else if (id === "snippets-completion-sound") setSnippetPreference("completionSound", SNIPPETS_SOUND_BY_LABEL[String(next)] ?? "none");
    else if (id === "snippets-disabled-applications") {
      setSnippetPreference(
        "disabledApplications",
        String(next).split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      );
    } else if (id === "snippets-primary-action") {
      window.localStorage.setItem("settings-snippets-primary-action", next === "Copy to Clipboard" ? "copy" : "paste");
    } else if (id === "snippets-warn-before-delete") {
      window.localStorage.setItem("settings-snippets-remember-delete", next ? "1" : "0");
    }
    return;
  }
  if (FILE_SEARCH_ROW_IDS.has(id)) {
    if (id === "file-search-scopes" || id === "file-search-reset") return;
    const patch: Record<string, unknown> =
      id === "include-files-in-root-search"
        ? { showInRootSearch: Boolean(next) }
        : id === "file-search-include-hidden"
          ? { includeHiddenFiles: Boolean(next) }
          : id === "file-search-respect-ignore-files"
            ? { respectIgnoreFiles: Boolean(next) }
            : { ignore: String(next).split(",").map((item) => item.trim()).filter(Boolean) };
    void ipc
      .backend("fileSearch.setSettings", patch, { module: "backend" })
      .catch((error: unknown) => toaster("Couldn't save that setting", error instanceof Error ? error.message : undefined));
    return;
  }
  if (id === "wm-preset") {
    const preset = next === "Magnet" || next === "Rectangle" ? "Magnet" : null;
    void applyPreset(preset)
      .then(() => {
        const hotkeys = readStoredHotkeys();
        const merged: SettingsMap = { ...getSettings(), [id]: next };
        for (const definition of WM_COMMANDS) {
          merged[`wm-cmd-${definition.key}`] = hotkeys[definition.key] ?? "";
        }
        persistSettings(merged);
        updateSettings(merged);
        toaster(preset ? `Applied "${String(next)}" hotkeys` : "Removed hotkeys");
      })
      .catch(() => toaster("Failed to apply preset"));
    return;
  }
  if (id === "focus-snooze-duration" || id === "focus-play-sound" || id === "focus-restore-apps") {
    const setFocusPreference = (key: string, value: unknown) => {
      void ipc.backend("focus.setPreferences", { [key]: value }, { module: "backend" }).catch(() => undefined);
    };
    if (id === "focus-snooze-duration") setFocusPreference("snoozeDurationMs", FOCUS_SNOOZE_BY_LABEL[String(next)] ?? null);
    else if (id === "focus-play-sound") setFocusPreference("playSound", Boolean(next));
    else if (id === "focus-restore-apps") setFocusPreference("restoreAppsWhenSessionEnds", Boolean(next));
    return;
  }
  if (id === "games-game-mode") {
    void ipc.backend("games.setGameMode", { enabled: Boolean(next) }, { module: "backend" }).catch(() => undefined);
    return;
  }
  if (id === "taskbar-show" || id === "taskbar-position") {
    const payload = id === "taskbar-show"
      ? { key: "showTaskbar", value: Boolean(next) }
      : { key: "position", value: TASKBAR_POSITION_BY_LABEL[String(next)] ?? "bottom" };
    void ipc.backend("taskbar.setSetting", payload, { module: "backend" }).catch(() => undefined);
    return;
  }
  if (NOTES_ROW_IDS.has(id)) {
    const setNotePreference = (key: string, value: unknown) => {
      void ipc.backend("notes.setPreference", { key, value }, { module: "backend" }).catch(() => undefined);
    };
    if (id === "notes-escape-key-behavior") setNotePreference("escapeKeyBehavior", NOTES_ESCAPE_BY_LABEL[String(next)] ?? "closesWindow");
    else if (id === "notes-zoom") setNotePreference("zoom", NOTES_ZOOM_VALUE_BY_LABEL[String(next)] ?? 1);
    return;
  }
  if (CALCULATOR_ROW_IDS.has(id)) {
    if (id === "calculator-rem-to-px") {
      const rate = Number(next);
      if (Number.isFinite(rate) && rate >= 1) {
        void ipc.backend("calculator.setPreference", { key: "remToPxRate", value: rate }, { module: "backend" }).catch(() => undefined);
      }
    }
    return;
  }
  if (TRANSLATOR_ROW_IDS.has(id)) {
    const setTranslatorPreference = (key: string, value: unknown) => {
      void ipc.backend("translator.setPreference", { key, value }, { module: "backend" }).catch(() => undefined);
    };
    if (id === "translator-primary-action") setTranslatorPreference("primaryAction", next === "Paste to Active App" ? "paste" : "copy");
    else if (id === "translator-prefill-from-selected-text") setTranslatorPreference("prefillFromSelectedText", Boolean(next));
    else if (id === "translator-default-source-language") {
      const label = String(next);
      const code = label === "Detect Language" ? null : label;
      setTranslatorPreference("defaultSourceLanguage", code);
    } else if (id === "translator-default-target-language") {
      setTranslatorPreference("defaultTargetLanguage", next === "English" ? null : String(next));
    }
    return;
  }
  if (CLIPBOARD_ROW_IDS.has(id)) {
    if (id === "clipboard-history-hotkey") {
      void ipc.backend("clipboard.setHotkey", { hotkey: String(next) }, { module: "backend" });
      return;
    }
    if (id === "clipboard-keep-history-for") {
      const duration = HISTORY_DURATION_BY_LABEL[String(next)] ?? "P1W";
      void ipc.backend("clipboard.setHistoryDuration", { duration }, { module: "backend" });
      return;
    }
    if (id === "clipboard-ignore-duplicate") {
      void ipc.backend("clipboard.setIgnoreDuplicate", { enabled: Boolean(next) }, { module: "backend" });
      return;
    }
    if (id === "clipboard-ignored-applications") {
      const applications = String(next)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.startsWith("#") ? { name: "", className: line.slice(1).trim() } : { name: line }))
        .filter((application) => application.name || application.className);
      void ipc.backend("clipboard.setIgnoredApplications", { applications }, { module: "backend" });
      return;
    }
    if (id === "clipboard-filters") {
      void ipc.backend("clipboard.setFiltersFromText", { text: String(next) }, { module: "backend" });
      return;
    }
    const preference = CLIPBOARD_PREFERENCE_ROWS[id];
    if (!preference) return;
    void ipc
      .backend("clipboard.setPreference", { key: preference.key, value: preference.value(next) }, { module: "backend" })
      .catch((error: unknown) => toaster("Couldn't save that setting", error instanceof Error ? error.message : undefined));
    return;
  }
  if (id === "root-search-sensitivity") {
    const sensitivity = SENSITIVITY_MAP[String(next)] ?? "medium";
    window.localStorage.setItem("raycast-mini:root-search-sensitivity", sensitivity);
    window.dispatchEvent(new CustomEvent("raycast-mini:root-search-sensitivity-changed", { detail: sensitivity }));
    return;
  }
  if (id === "fallback-commands-list" || id === "fallback-commands-enabled") {
    const list = values["fallback-commands-list"] ?? "";
    const enabled = values["fallback-commands-enabled"] ?? true;
    const commands = parseFallbackCommands(String(list), Boolean(enabled));
    window.localStorage.setItem("raycast-mini:fallback-commands", JSON.stringify(commands));
    window.dispatchEvent(new CustomEvent("raycast-mini:fallback-commands-changed", { detail: commands }));
    return;
  }
}

function runLegacyAction(
  id: string,
  values: SettingsMap,
  mergeValues: (patch: SettingsMap) => void,
): void {
  const toaster = (title: string, message?: string) =>
    window.dispatchEvent(new CustomEvent("raycast-mini:settings-toast", { detail: { title, message } }));

  const applyFileSearchSettings = (settings: FileSearchSettings | undefined) => {
    if (!settings) return;
    mergeValues({
      "include-files-in-root-search": settings.showInRootSearch,
      "file-search-ignore-patterns": settings.ignore.join(", "),
      "file-search-include-hidden": settings.includeHiddenFiles,
      "file-search-respect-ignore-files": settings.respectIgnoreFiles,
      "file-search-scopes": `${settings.include.length} folder${settings.include.length === 1 ? "" : "s"}`,
    });
  };

  if (id === "file-search-scopes") {
    void ipc
      .backend("fileSystem.showSelectFolderDialog", { title: "Add Search Scope" }, { module: "backend" })
      .then((response) => {
        const folder = (response as { path?: string | null }).path;
        if (!folder) return;
        const current = values["file-search-scopes"];
        void current;
        return ipc
          .backend("fileSearch.addScope", { path: folder }, { module: "backend" })
          .then((response) => {
            applyFileSearchSettings((response as { settings?: FileSearchSettings }).settings);
            toaster("Indexing Files…");
          });
      })
      .catch((error: unknown) => toaster("Couldn't add that folder", error instanceof Error ? error.message : undefined));
    return;
  }
  if (id === "file-search-reset") {
    if (!window.confirm("Reset File Search Settings?")) return;
    void ipc
      .backend("fileSearch.resetToDefaults", {}, { module: "backend" })
      .then((response) => {
        applyFileSearchSettings((response as { settings?: FileSearchSettings }).settings);
        toaster("File Search settings reset to defaults");
      });
    return;
  }
  if (id === "clipboard-run-maintenance") {
    void ipc
      .backend("clipboard.runMaintenance", {}, { module: "backend" })
      .then((response) => {
        const report = response as { cache?: { deletedEntries?: number; removedFiles?: number }; pruned?: number };
        const pruned = report.pruned ?? 0;
        const removed = report.cache?.deletedEntries ?? 0;
        const files = report.cache?.removedFiles ?? 0;
        toaster("Maintenance finished", `${pruned} pruned, ${removed} entries dropped, ${files} cached files removed.`);
      });
  }
}

/** The legacy mirrors that hydrate row values from the per-feature backend stores on boot. */
function useLegacyRowMirrors(mergeValues: (patch: SettingsMap) => void): void {
  useEffect(() => {
    const fetch = (method: string) =>
      ipc.backend(method, {}, { module: "backend" }).catch(() => null);

    void fetch("clipboard.getSettings").then((response) => {
      if (!response) return;
      const settings = response as {
        historyDuration?: string;
        ignoreDuplicate?: boolean;
        ignoredApplications?: Array<{ name: string; className?: string }>;
      };
      const label =
        Object.entries(HISTORY_DURATION_BY_LABEL).find(([, value]) => value === settings.historyDuration)?.[0] ?? "1 Week";
      mergeValues({
        "clipboard-keep-history-for": label,
        "clipboard-ignore-duplicate": Boolean(settings.ignoreDuplicate),
        "clipboard-ignored-applications": (settings.ignoredApplications ?? [])
          .map((application) => (application.className && !application.name ? `#${application.className}` : application.name))
          .filter(Boolean)
          .join("\n"),
      });
    });
    void fetch("clipboard.getFilters").then((response) => {
      if (!response) return;
      const filters = (response as { filters?: ClipboardFilter[] }).filters ?? [];
      mergeValues({ "clipboard-filters": formatFilterRows(filters) });
    });

    void fetch("quicklinks.getPreferences").then((response) => {
      if (!response) return;
      const preferences = response as { passSelectedTextAsArgument?: boolean };
      mergeValues({ "quicklinks-pass-selected-text": Boolean(preferences.passSelectedTextAsArgument) });
    });
    mergeValues({
      "quicklinks-warn-before-delete": window.localStorage.getItem("raycast-mini:quicklinks-warn-delete") !== "0",
    });

    void fetch("snippets.getPreferences").then((response) => {
      if (!response) return;
      const preferences = response as {
        autoExpansionEnabled?: boolean;
        expansionMode?: string;
        expandWithinWords?: boolean;
        injectionDelay?: string;
        responseTime?: string;
        completionSound?: string;
        disabledApplications?: string[];
      };
      mergeValues({
        "snippets-enable-expansion": Boolean(preferences.autoExpansionEnabled),
        "snippets-expansion-mode": SNIPPETS_MODE_LABEL[preferences.expansionMode ?? "immediately"] ?? "Immediately",
        "snippets-expand-within-words": Boolean(preferences.expandWithinWords),
        "snippets-injection-delay": SNIPPETS_INJECTION_DELAY_LABEL[preferences.injectionDelay ?? "none"] ?? "None",
        "snippets-response-time": SNIPPETS_RESPONSE_TIME_LABEL[preferences.responseTime ?? "default"] ?? "Default",
        "snippets-completion-sound": SNIPPETS_SOUND_LABEL[preferences.completionSound ?? "none"] ?? "None",
        "snippets-disabled-applications": (preferences.disabledApplications ?? []).join("\n"),
      });
    });
    mergeValues({
      "snippets-warn-before-delete": window.localStorage.getItem("settings-snippets-remember-delete") !== "0",
      "snippets-primary-action":
        window.localStorage.getItem("settings-snippets-primary-action") === "copy" ? "Copy to Clipboard" : "Paste to Active App",
    });

    void fetch("calculator.getPreferences").then((response) => {
      if (!response) return;
      const preferences = response as { remToPxRate?: number };
      mergeValues({ "calculator-rem-to-px": String(preferences.remToPxRate ?? 16) });
    });

    void fetch("translator.getPreferences").then((response) => {
      if (!response) return;
      const preferences = response as {
        primaryAction?: "copy" | "paste";
        prefillFromSelectedText?: boolean;
        defaultSourceLanguage?: string | null;
        defaultTargetLanguage?: string | null;
      };
      mergeValues({
        "translator-primary-action": preferences.primaryAction === "paste" ? "Paste to Active App" : "Copy Translation",
        "translator-prefill-from-selected-text": Boolean(preferences.prefillFromSelectedText),
        "translator-default-source-language": preferences.defaultSourceLanguage ?? "Detect Language",
        "translator-default-target-language": preferences.defaultTargetLanguage ?? "English",
      });
    });

    void fetch("fileSearch.getSettings").then((response) => {
      if (!response) return;
      const settings = (response as { settings?: FileSearchSettings }).settings;
      if (!settings) return;
      mergeValues({
        "include-files-in-root-search": settings.showInRootSearch,
        "file-search-ignore-patterns": settings.ignore.join(", "),
        "file-search-include-hidden": settings.includeHiddenFiles,
        "file-search-respect-ignore-files": settings.respectIgnoreFiles,
        "file-search-scopes": `${settings.include.length} folder${settings.include.length === 1 ? "" : "s"}`,
      });
    });

    void fetch("focus.getSession").then((response) => {
      if (!response) return;
      const preferences = (response as { preferences?: { snoozeDurationMs: number | null; playSound: boolean; restoreAppsWhenSessionEnds: boolean } }).preferences;
      if (!preferences) return;
      mergeValues({
        "focus-snooze-duration": FOCUS_SNOOZE_LABEL[String(preferences.snoozeDurationMs ?? "null")] ?? "3 minutes",
        "focus-play-sound": preferences.playSound !== false,
        "focus-restore-apps": preferences.restoreAppsWhenSessionEnds === true,
      });
    });
    void fetch("games.getSettings").then((response) => {
      if (!response) return;
      const enabled = (response as { gameModeEnabled?: boolean }).gameModeEnabled === true;
      mergeValues({ "games-game-mode": enabled });
    });
    void fetch("taskbar.getSettings").then((response) => {
      if (!response) return;
      const settings = response as { showTaskbar?: boolean; position?: string };
      mergeValues({
        "taskbar-show": settings.showTaskbar === true,
        "taskbar-position": TASKBAR_POSITION_LABEL[settings.position ?? "bottom"] ?? "Bottom",
      });
    });
    void fetch("notes.getPreferences").then((response) => {
      if (!response) return;
      const preferences = response as { zoom?: number; escapeKeyBehavior?: string };
      mergeValues({
        "notes-escape-key-behavior": NOTES_ESCAPE_LABEL[preferences.escapeKeyBehavior ?? "closesWindow"] ?? "Closes Window",
        "notes-zoom": NOTES_ZOOM_LABEL_BY_VALUE[String(preferences.zoom ?? 1)] ?? "100%",
      });
    });

    const hotkeys = readStoredHotkeys();
    const patch: SettingsMap = {};
    for (const definition of WM_COMMANDS) {
      patch[`wm-cmd-${definition.key}`] = hotkeys[definition.key] ?? "";
    }
    mergeValues(patch);
  }, [mergeValues]);
}

// ---------------------------------------------------------------------------------------------
// Sidebar search: Raycast's settings search (page + row titles/keywords).
// ---------------------------------------------------------------------------------------------

function searchResults(query: string): Array<{ pageId: string; rowId?: string; title: string; group: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: Array<{ pageId: string; rowId?: string; title: string; group: string }> = [];
  for (const page of PAGES) {
    const pageMatch =
      page.title.toLowerCase().includes(needle) ||
      page.keywords.some((keyword) => keyword.toLowerCase().includes(needle));
    if (pageMatch) results.push({ pageId: page.id, title: page.title, group: "Settings" });
    for (const section of page.sections) {
      for (const row of section.rows) {
        const rowMatch =
          row.title.toLowerCase().includes(needle) ||
          (row.description ?? "").toLowerCase().includes(needle) ||
          page.keywords.some((keyword) => keyword.toLowerCase().includes(needle));
        if (rowMatch && !pageMatch) {
          results.push({ pageId: page.id, rowId: row.id, title: row.title, group: page.title });
        }
      }
      if (section.title && section.title.toLowerCase().includes(needle) && !pageMatch) {
        results.push({ pageId: page.id, title: section.title, group: page.title });
      }
    }
  }
  return results.slice(0, 12);
}

export { ACCOUNT_PAGE_ID };
