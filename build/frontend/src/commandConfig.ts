// Per-command aliases and hotkeys for installed (Store) commands, plus per-command preference
// loading. Aliases/hotkeys persist in localStorage (the clone's client-side convention, like
// favorites); hotkeys register with the host through the generic `windowManagement.
// registerCommandHotkey` route the Window Management presets already use, keyed
// `cmd:<uuid>/<command>` so they never collide with the WM preset keys.

import { ipc } from "./ipc";

const ALIASES_KEY = "raycast-mini:command-aliases";
const HOTKEYS_KEY = "raycast-mini:command-hotkeys";

/** `command:<uuid>/<name>` — the same key shape favorites use. */
export type CommandConfigKey = string;

export function commandConfigKey(uuid: string, commandName: string): CommandConfigKey {
  return `command:${uuid}/${commandName}`;
}

function readMap(storageKey: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(storageKey: string, map: Record<string, string>): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    /* private mode / quota — config does not persist */
  }
}

export function readCommandAliases(): Record<string, string> {
  return readMap(ALIASES_KEY);
}

/** Returns the current alias for the command ("" clears it). */
export function writeCommandAlias(key: CommandConfigKey, alias: string): Record<string, string> {
  const map = readCommandAliases();
  const trimmed = alias.trim();
  if (trimmed) map[key] = trimmed;
  else delete map[key];
  writeMap(ALIASES_KEY, map);
  return map;
}

export function readCommandHotkeys(): Record<string, string> {
  return readMap(HOTKEYS_KEY);
}

export function writeCommandHotkey(key: CommandConfigKey, hotkey: string | null): Record<string, string> {
  const map = readCommandHotkeys();
  if (hotkey) map[key] = hotkey;
  else delete map[key];
  writeMap(HOTKEYS_KEY, map);
  return map;
}

export interface HotkeyCombo {
  modifiers: string[];
  key: string;
}

/** `"Ctrl+Shift+G"` → `{modifiers:["ctrl","shift"], key:"G"}` — the host's parser shape. */
export function parseHotkeyCombo(hotkey: string): HotkeyCombo | null {
  const parts = hotkey.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  if (!key || key.length !== 1) return null;
  const modifiers: string[] = [];
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "alt" || lower === "shift" || lower === "meta") modifiers.push(lower);
    else return null;
  }
  return { modifiers, key: key.toUpperCase() };
}

/** Push one command hotkey to the host. `null` unregisters. */
export async function registerCommandHotkeyWithHost(commandKey: string, hotkey: string | null): Promise<boolean> {
  try {
    if (!hotkey) {
      await ipc.backend("windowManagement.registerCommandHotkey", { commandKey }, { module: "backend" });
      return true;
    }
    const combo = parseHotkeyCombo(hotkey);
    if (!combo) return false;
    await ipc.backend(
      "windowManagement.registerCommandHotkey",
      { commandKey, hotkey: { modifiers: combo.modifiers, key: combo.key } },
      { module: "backend" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Re-register every stored command hotkey (after a backend restart or on launcher mount). */
export async function registerAllCommandHotkeys(): Promise<void> {
  const hotkeys = readCommandHotkeys();
  await Promise.all(Object.entries(hotkeys).map(([key, hotkey]) => registerCommandHotkeyWithHost(key, hotkey)));
}
