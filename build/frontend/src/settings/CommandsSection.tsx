// Shared extension-page pieces: the centered page intro (Raycast's extension detail header) and
// the Commands card — the same alias / hotkey / enable row used on the Shortcuts page, driven by
// the commandConfig stores. Built-in extension pages render their internal commands through
// `InternalCommandsSection`; installed extensions get their rows on the detail page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { OpenrayIcon } from "../icons";
import { INTERNAL_COMMANDS, INTERNAL_EXTENSION_META, type InternalArea } from "../app/entries";
import type { PageDefinition } from "./pages";
import { WM_COMMANDS, wmCommandIcon } from "../windowManagement";
import {
  commandConfigKey,
  internalConfigKey,
  readCommandAliases,
  readCommandHotkeys,
  readShortcutDisabled,
  registerCommandHotkeyWithHost,
  writeCommandAlias,
  writeCommandHotkey,
  writeShortcutDisabled,
} from "../commandConfig";
import { HotkeyRecorder } from "./controls";

export interface CommandRowData {
  key: string;
  title: string;
  subtitle?: string;
  iconUrl?: string | null;
  lucide?: string;
  /** Extension commands carry the backend's gating reason; their switch reflects it. */
  lockedReason?: string | null;
}

/** The Commands section: label above a Shortcuts-style card of command rows. */
export function CommandsSection({ title = "Commands", rows }: { title?: string; rows: CommandRowData[] }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((state) => state + 1), []);

  const aliases = useMemo(() => {
    void version;
    return readCommandAliases();
  }, [version]);
  const hotkeys = useMemo(() => {
    void version;
    return readCommandHotkeys();
  }, [version]);
  const disabled = useMemo(() => {
    void version;
    return readShortcutDisabled();
  }, [version]);

  const setAlias = (row: CommandRowData, alias: string) => {
    writeCommandAlias(row.key, alias);
    bump();
  };
  const setHotkey = (row: CommandRowData, hotkey: string) => {
    void registerCommandHotkeyWithHost(row.key, hotkey || null);
    writeCommandHotkey(row.key, hotkey || null);
    bump();
  };
  const setEnabled = (row: CommandRowData, enabled: boolean) => {
    writeShortcutDisabled(row.key, !enabled);
    bump();
  };

  if (rows.length === 0) return null;

  return (
    <section className="settings-commands">
      <h2 className="settings-commands__title">{title}</h2>
      <div className="settings-shortcuts__group">
        <ul className="settings-shortcuts__rows">
          {rows.map((row) => (
            <CommandRowView
              key={row.key}
              row={row}
              alias={aliases[row.key] ?? ""}
              hotkey={hotkeys[row.key] ?? ""}
              enabled={!disabled[row.key] && !row.lockedReason}
              lockedReason={row.lockedReason}
              onAlias={(alias) => setAlias(row, alias)}
              onHotkey={(hotkey) => setHotkey(row, hotkey)}
              onEnabled={(enabled) => setEnabled(row, enabled)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function CommandRowView({
  row,
  alias,
  hotkey,
  enabled,
  lockedReason,
  onAlias,
  onHotkey,
  onEnabled,
}: {
  row: CommandRowData;
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
          {row.iconUrl ? (
            <img src={row.iconUrl} alt="" />
          ) : (
            <OpenrayIcon name={row.lucide ?? "app-window-list"} size={14} />
          )}
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
        <HotkeyRecorder value={hotkey} onChange={onHotkey} disabled={disabledRow} footerLabel="Record Hotkey" />
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

/** The Commands card for a built-in extension page (its internal + window-management commands). */
export function InternalCommandsSection({ pageId }: { pageId: string }) {
  if (pageId === "window-management") {
    return (
      <CommandsSection
        rows={WM_COMMANDS.map((definition) => ({
          key: `wm-${definition.key}`,
          title: definition.title,
          subtitle: definition.description,
          lucide: wmCommandIcon(definition.key),
        }))}
      />
    );
  }
  const area = pageId as InternalArea;
  if (!(area in INTERNAL_EXTENSION_META)) return null;
  const rows: CommandRowData[] = INTERNAL_COMMANDS.filter((definition) => definition.area === area).map(
    (definition) => ({
      key: internalConfigKey(definition.area, definition.command),
      title: definition.title,
      subtitle: INTERNAL_EXTENSION_META[definition.area].title,
      lucide: INTERNAL_EXTENSION_META[definition.area].icon,
    }),
  );
  return <CommandsSection rows={rows} />;
}

/** Centered intro header for the built-in extension pages (icon tile, title, description). */
export function PageIntro({ page }: { page: PageDefinition }) {
  const [expanded, setExpanded] = useState(false);
  const long = page.description.length > 140;
  return (
    <div className="settings-page__intro">
      <span className="settings-page__introIcon">
        <span className="settings-introTile" data-tile={page.id}>
          <OpenrayIcon name={page.icon} size={26} />
        </span>
      </span>
      <div className="settings-page__introText">
        <h1 className="settings-page__introTitle">{page.title}</h1>
        <p className="settings-page__introDescription" data-clamped={!expanded && long ? "true" : undefined}>
          {page.description}
        </p>
        {long ? (
          <button type="button" className="settings-page__introToggle" onClick={() => setExpanded((state) => !state)}>
            {expanded ? "Show Less" : "Show More"}{" "}
            <span className="settings-page__introToggleChevron" data-expanded={expanded ? "true" : undefined}>
              <OpenrayIcon name="chevron-down" size={10} />
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
