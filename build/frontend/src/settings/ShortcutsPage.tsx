// Shortcuts page — Raycast's per-command shortcut manager: one table per category with an
// alias input, a hotkey recorder and an enable switch per row, filtered by the title-bar
// search and the Modifications/Categories dropdown.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RaycastIcon } from "../icons";
import { ipc } from "../ipc";
import { INTERNAL_COMMANDS, INTERNAL_EXTENSION_META, type ExtensionSummary } from "../app/entries";
import { WM_COMMANDS, wmCommandIcon } from "../windowManagement";
import type { ApplicationCommand } from "../applications";
import type { QuicklinkEntry } from "../quicklinks";
import {
  appConfigKey,
  commandConfigKey,
  internalConfigKey,
  quicklinkConfigKey,
  readAppAliases,
  readCommandAliases,
  readCommandHotkeys,
  readQuicklinkAliases,
  readShortcutDisabled,
  registerCommandHotkeyWithHost,
  writeAppAlias,
  writeCommandAlias,
  writeCommandHotkey,
  writeQuicklinkAlias,
  writeShortcutDisabled,
} from "../commandConfig";
import { HotkeyRecorder, SearchField, useDismiss, usePopupRect } from "./controls";

export type ShortcutCategory = "Applications" | "Extensions" | "Games" | "Quicklinks" | "System";

export interface ShortcutsFilter {
  query: string;
  categories: ShortcutCategory[];
  modifications: Set<"hotkey" | "alias" | "enabled" | "disabled">;
}

export const ShortcutsFilterContext = createContext<{
  filter: ShortcutsFilter;
  setFilter: (next: ShortcutsFilter) => void;
} | null>(null);

interface ShortcutRow {
  key: string;
  category: ShortcutCategory;
  title: string;
  subtitle?: string;
  iconUrl?: string | null;
  lucide?: string;
  /** Extension commands carry the backend's gating reason; their switch reflects it. */
  lockedReason?: string | null;
}

const ALL_CATEGORIES: ShortcutCategory[] = ["Applications", "Extensions", "Games", "Quicklinks", "System"];

export function ShortcutsPage() {
  const context = useContext(ShortcutsFilterContext);
  const filter = context?.filter ?? { query: "", categories: [], modifications: new Set() };
  const [rows, setRows] = useState<ShortcutRow[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((state) => state + 1), []);

  const [applications, setApplications] = useState<ApplicationCommand[]>([]);
  const [gameIds, setGameIds] = useState<Set<string>>(new Set());
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [quicklinks, setQuicklinks] = useState<QuicklinkEntry[]>([]);

  useEffect(() => {
    void ipc.backend("applications.getAll", {}, { module: "backend" }).then((response) => {
      const value = (response as { value?: ApplicationCommand["payload"][] }).value ?? [];
      setApplications(
        value.map((payload) => ({
          extensionId: "applications",
          commandId: `applications/${payload.id}`,
          title: payload.name,
          subtitle: null,
          keywords: [],
          payload,
        })),
      );
    });
    void ipc.backend("games.getFlags", {}, { module: "backend" }).then((response) => {
      setGameIds(new Set(Object.keys((response as { games?: Record<string, unknown> }).games ?? {})));
    });
    void ipc.backend("extensionHost.getInstalledNodeExtensionSummaries", {}, { module: "backend" }).then((response) => {
      setExtensions((response as { extensions?: ExtensionSummary[] }).extensions ?? []);
    });
    void ipc.backend("quicklinks.list", {}, { module: "backend" }).then((response) => {
      setQuicklinks((response as { quicklinks?: QuicklinkEntry[] }).quicklinks ?? []);
    });
  }, []);

  useEffect(() => {
    const next: ShortcutRow[] = [];
    for (const app of applications) {
      const isGame = gameIds.has(app.payload.id);
      next.push({
        key: appConfigKey(app.payload.id),
        category: isGame ? "Games" : "Applications",
        title: app.title,
        subtitle: app.subtitle ?? undefined,
        iconUrl: app.payload.icon,
      });
    }
    for (const extension of extensions) {
      for (const command of extension.commands ?? []) {
        if (command.mode === "no-view") continue;
        next.push({
          key: commandConfigKey(extension.uuid, command.name),
          category: "Extensions",
          title: command.title,
          subtitle: extension.title,
          lockedReason: command.disabledReason,
        });
      }
    }
    for (const quicklink of quicklinks) {
      next.push({
        key: quicklinkConfigKey(quicklink.id),
        category: "Quicklinks",
        title: quicklink.name,
        subtitle: quicklink.link,
        iconUrl: quicklink.icon,
      });
    }
    for (const definition of INTERNAL_COMMANDS) {
      next.push({
        key: internalConfigKey(definition.area, definition.command),
        category: "System",
        title: definition.title,
        subtitle: INTERNAL_EXTENSION_META[definition.area].title,
        lucide: INTERNAL_EXTENSION_META[definition.area].icon,
      });
    }
    for (const definition of WM_COMMANDS) {
      next.push({
        key: `wm-${definition.key}`,
        category: "System",
        title: definition.title,
        subtitle: definition.description,
        lucide: wmCommandIcon(definition.key),
      });
    }
    next.sort((a, b) => a.title.localeCompare(b.title));
    setRows(next);
  }, [applications, extensions, quicklinks, gameIds]);

  const aliases = useMemo(() => {
    void version;
    return {
      ...readAppAliases(),
      ...readQuicklinkAliases(),
      ...readCommandAliases(),
    };
  }, [version]);
  const hotkeys = useMemo(() => {
    void version;
    return readCommandHotkeys();
  }, [version]);
  const disabled = useMemo(() => {
    void version;
    return readShortcutDisabled();
  }, [version]);

  const aliasFor = (row: ShortcutRow) => aliases[row.key] ?? "";
  const hotkeyFor = (row: ShortcutRow) => hotkeys[row.key] ?? "";

  const setAlias = (row: ShortcutRow, alias: string) => {
    if (row.key.startsWith("app:")) writeAppAlias(row.key, alias);
    else if (row.key.startsWith("quicklink:")) writeQuicklinkAlias(row.key, alias);
    else writeCommandAlias(row.key, alias);
    bump();
  };

  const setHotkey = (row: ShortcutRow, hotkey: string) => {
    void registerCommandHotkeyWithHost(row.key, hotkey || null);
    writeCommandHotkey(row.key, hotkey || null);
    bump();
  };

  const setEnabled = (row: ShortcutRow, enabled: boolean) => {
    writeShortcutDisabled(row.key, !enabled);
    bump();
  };

  const visible = rows.filter((row) => {
    if (filter.categories.length > 0 && !filter.categories.includes(row.category)) return false;
    if (filter.modifications.has("hotkey") && !hotkeyFor(row)) return false;
    if (filter.modifications.has("alias") && !aliasFor(row)) return false;
    const isDisabled = Boolean(disabled[row.key]) || Boolean(row.lockedReason);
    if (filter.modifications.has("enabled") && isDisabled) return false;
    if (filter.modifications.has("disabled") && !isDisabled) return false;
    const query = filter.query.trim().toLowerCase();
    if (query && !`${row.title} ${row.subtitle ?? ""} ${aliasFor(row)}`.toLowerCase().includes(query)) return false;
    return true;
  });

  const grouped = useMemo(() => {
    const map = new Map<ShortcutCategory, ShortcutRow[]>();
    for (const row of visible) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return map;
  }, [visible, hotkeys, aliases, disabled]);

  return (
    <div className="settings-shortcuts">
      {[...grouped.entries()].map(([category, categoryRows]) => (
        <section className="settings-shortcuts__group" key={category}>
          <header className="settings-shortcuts__header">
            <ShortcutsCategorySelect current={category} />
            <button
              type="button"
              className="settings-shortcuts__collapse"
              aria-label={collapsed ? "Expand" : "Collapse"}
              onClick={() => setCollapsed((state) => !state)}
            >
              <RaycastIcon name={collapsed ? "plus" : "minus"} size={10} />
            </button>
          </header>
          {!collapsed ? (
            <>
              <div className="settings-shortcuts__columns">
                <span>Name</span>
                <span>Alias</span>
                <span>Hotkey</span>
                <span />
              </div>
              <ul className="settings-shortcuts__rows">
                {categoryRows.map((row) => (
                  <ShortcutRowView
                    key={row.key}
                    row={row}
                    alias={aliasFor(row)}
                    hotkey={hotkeyFor(row)}
                    enabled={!disabled[row.key] && !row.lockedReason}
                    lockedReason={row.lockedReason}
                    onAlias={(alias) => setAlias(row, alias)}
                    onHotkey={(hotkey) => setHotkey(row, hotkey)}
                    onEnabled={(enabled) => setEnabled(row, enabled)}
                  />
                ))}
                {categoryRows.length === 0 ? <li className="settings-shortcuts__emptyRow">No shortcuts match.</li> : null}
              </ul>
            </>
          ) : null}
        </section>
      ))}
      {visible.length === 0 ? <p className="settings-shortcuts__empty">No shortcuts match the current filters.</p> : null}
    </div>
  );
}

function ShortcutRowView({
  row,
  alias,
  hotkey,
  enabled,
  lockedReason,
  onAlias,
  onHotkey,
  onEnabled,
}: {
  row: ShortcutRow;
  alias: string;
  hotkey: string;
  enabled: boolean;
  lockedReason?: string | null;
  onAlias: (alias: string) => void;
  onHotkey: (hotkey: string) => void;
  onEnabled: (enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState(alias);
  useEffect(() => setDraft(alias), [alias]);
  const disabledRow = Boolean(lockedReason);

  return (
    <li className="settings-shortcuts__row" title={lockedReason ?? undefined}>
      <span className="settings-shortcuts__name">
        <span className="settings-shortcuts__icon">
          {row.iconUrl ? <img src={row.iconUrl} alt="" /> : <RaycastIcon name={row.lucide ?? "app-window-list"} size={14} />}
        </span>
        <span className="settings-shortcuts__title">{row.title}</span>
      </span>
      <input
        className="settings-shortcuts__alias"
        type="text"
        placeholder="Add Alias"
        aria-label={`Alias for ${row.title}`}
        value={draft}
        disabled={disabledRow}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft.trim() !== alias && onAlias(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="settings-shortcuts__hotkey">
        <HotkeyRecorder
          value={hotkey}
          onChange={onHotkey}
          disabled={disabledRow}
          footerLabel="Record Hotkey"
        />
      </span>
      <input
        className="settings-shortcuts__enabled"
        type="checkbox"
        aria-label={`${enabled ? "Disable" : "Enable"} ${row.title}`}
        checked={enabled}
        disabled={disabledRow}
        onChange={(event) => onEnabled(event.target.checked)}
      />
    </li>
  );
}

/** The category header doubles as a quick switcher between the groups present on this install. */
function ShortcutsCategorySelect({ current }: { current: ShortcutCategory }) {
  const context = useContext(ShortcutsFilterContext);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), rootRef);
  const popupRect = usePopupRect(open, triggerRef, "bottom");
  const categories = ALL_CATEGORIES;

  const pick = (category: ShortcutCategory) => {
    context?.setFilter({ ...context.filter, categories: [category] });
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <span className="settings-shortcuts__categorySelect" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-shortcuts__categoryTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-open={open ? "true" : undefined}
        onClick={() => setOpen((state) => !state)}
      >
        {current === "Applications" ? (
          <span className="settings-shortcuts__appGrid" />
        ) : (
          <span className="settings-shortcuts__categoryIcon">
            <RaycastIcon name={categoryMeta(current).icon} size={14} />
          </span>
        )}
        {current}
        <span className="settings-shortcuts__categoryChevron">
          <RaycastIcon name="chevron-down" size={12} />
        </span>
      </button>
      {open && popupRect
        ? createPortal(
            <div className="settings-menu" role="listbox" aria-label="Category" style={{ left: popupRect.left, top: popupRect.top, minWidth: 200 }}>
              {categories.map((category) => (
                <button key={category} type="button" role="option" aria-selected={category === current} className="settings-menu__item" onClick={() => pick(category)}>
                  <span className="settings-shortcuts__categoryIcon">
                    <RaycastIcon name={categoryMeta(category).icon} size={13} />
                  </span>
                  <span>{category}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function categoryMeta(category: ShortcutCategory): { icon: string } {
  switch (category) {
    case "Applications":
      return { icon: "app-window-list" };
    case "Extensions":
      return { icon: "extension" };
    case "Games":
      return { icon: "game-controller" };
    case "Quicklinks":
      return { icon: "link" };
    case "System":
      return { icon: "cog" };
  }
}

/** Title-bar slot: the boxed search field and the Modifications/Categories filter dropdown. */
export function ShortcutsTitlebarActions() {
  const context = useContext(ShortcutsFilterContext);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), rootRef);
  const popupRect = usePopupRect(open, triggerRef, "bottom");
  if (!context) return null;
  const { filter, setFilter } = context;
  const label = filter.categories.length === 1 ? filter.categories[0] : "All categories";

  const toggleCategory = (category: ShortcutCategory) => {
    const has = filter.categories.includes(category);
    setFilter({
      ...filter,
      categories: has ? filter.categories.filter((item) => item !== category) : [...filter.categories, category],
    });
  };

  const toggleModification = (key: "hotkey" | "alias" | "enabled" | "disabled") => {
    const next = new Set(filter.modifications);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFilter({ ...filter, modifications: next });
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <span className="settings-shortcuts__titlebar" ref={rootRef}>
      <span className="settings-shortcuts__search" data-open={searchOpen || filter.query ? "true" : undefined}>
        <button
          type="button"
          className="settings-shortcuts__searchToggle"
          aria-label="Search shortcuts"
          onClick={() => setSearchOpen(true)}
        >
          <RaycastIcon name="magnifying-glass" size={14} />
        </button>
        <input
          ref={searchInputRef}
          className="settings-shortcuts__searchInput"
          type="text"
          placeholder="Search by name or alias"
          aria-label="Search shortcuts"
          value={filter.query}
          onChange={(event) => setFilter({ ...filter, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setFilter({ ...filter, query: "" });
              setSearchOpen(false);
            }
          }}
          onBlur={() => {
            if (!filter.query) setSearchOpen(false);
          }}
        />
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="settings-shortcuts__filterTrigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-open={open ? "true" : undefined}
        onClick={() => setOpen((state) => !state)}
      >
        {label}
        <span className="settings-shortcuts__filterChevron">
          <RaycastIcon name="chevron-down" size={12} />
        </span>
      </button>
      {open && popupRect
        ? createPortal(
            <div className="settings-menu settings-shortcuts__filterMenu" role="dialog" aria-label="Filter shortcuts" style={{ left: Math.min(popupRect.left, window.innerWidth - 280), top: popupRect.top, width: 280 }}>
              <div className="settings-shortcuts__filterSearch">
                <SearchField
                  value={filter.query}
                  placeholder="Search..."
                  ariaLabel="Search shortcuts"
                  onChange={(query) => setFilter({ ...filter, query })}
                  onEscape={() => setFilter({ ...filter, query: "" })}
                />
              </div>
              <div className="settings-menu__section">Modifications</div>
              {([
                ["hotkey", "Hotkey Set", "clock"],
                ["alias", "Alias Set", "text"],
                ["enabled", "Enabled", "info"],
                ["disabled", "Disabled", "info"],
              ] as const).map(([key, label_, icon]) => (
                <button key={key} type="button" role="option" aria-selected={filter.modifications.has(key)} className="settings-menu__item" onClick={() => toggleModification(key)}>
                  <span className="settings-shortcuts__filterCheck">
                    <input type="checkbox" checked={filter.modifications.has(key)} readOnly tabIndex={-1} />
                  </span>
                  <RaycastIcon name={icon} size={13} />
                  <span>{label_}</span>
                </button>
              ))}
              <div className="settings-menu__section">Categories</div>
              <button type="button" role="option" aria-selected={filter.categories.length === 0} className="settings-menu__item" onClick={() => setFilter({ ...filter, categories: [] })}>
                <span className="settings-shortcuts__filterCheck">
                  <input type="checkbox" checked={filter.categories.length === 0} readOnly tabIndex={-1} />
                </span>
                <span>All categories</span>
              </button>
              {ALL_CATEGORIES.map((category) => (
                <button key={category} type="button" role="option" aria-selected={filter.categories.includes(category)} className="settings-menu__item" onClick={() => toggleCategory(category)}>
                  <span className="settings-shortcuts__filterCheck">
                    <input type="checkbox" checked={filter.categories.includes(category)} readOnly tabIndex={-1} />
                  </span>
                  <RaycastIcon name={categoryMeta(category).icon} size={13} />
                  <span>{category}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

