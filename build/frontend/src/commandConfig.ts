// Per-command aliases and hotkeys for installed (Store) commands, plus per-command preference
// loading. Aliases/hotkeys persist in localStorage (the clone's client-side convention, like
// favorites); hotkeys register with the host through the generic `windowManagement.
// registerCommandHotkey` route the Window Management presets already use, keyed
// `cmd:<uuid>/<command>` so they never collide with the WM preset keys.

import { ipc } from "./ipc";
import { updateSettings , isExtensionEnabled } from "./settings/store";

// The Settings window runs in its own WebView2 profile, so its localStorage is invisible to the
// launcher. All per-command config therefore lives in the settings store (backend-persisted,
// pushed to both windows via `settings.changed` and mirrored into each window's localStorage
// under `openray:settings`); the legacy localStorage keys remain as a read fallback.
const STORE_KEY = "openray:settings";
const ALIASES_STORE_KEY = "command-aliases";
const HOTKEYS_STORE_KEY = "command-hotkeys";
const APP_ALIASES_STORE_KEY = "app-aliases";
const QUICKLINK_ALIASES_STORE_KEY = "quicklink-aliases";
const DISABLED_STORE_KEY = "shortcuts-disabled";
const ALIASES_KEY = "openray:command-aliases";
const HOTKEYS_KEY = "openray:command-hotkeys";
const APP_ALIASES_KEY = "openray:app-aliases";
const QUICKLINK_ALIASES_KEY = "openray:quicklink-aliases";
const DISABLED_KEY = "openray:shortcuts-disabled";

/** `command:<uuid>/<name>` — the same key shape favorites use. */
export type CommandConfigKey = string;

export function commandConfigKey(uuid: string, commandName: string): CommandConfigKey {
  return `command:${uuid}/${commandName}`;
}

export function appConfigKey(applicationId: string): CommandConfigKey {
  return `app:${applicationId}`;
}

export function quicklinkConfigKey(quicklinkId: string): CommandConfigKey {
  return `quicklink:${quicklinkId}`;
}

export function internalConfigKey(area: string, command: string): CommandConfigKey {
  return `command:internal/${area}/${command}`;
}

function readStoreMap(storeKey: string, legacyKey: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const entry = parsed[storeKey];
      if (typeof entry === "string") {
        const map = JSON.parse(entry) as Record<string, string>;
        if (map && typeof map === "object") return map;
      }
    }
  } catch {
    /* fall through to the legacy key */
  }
  return readLegacyMap(legacyKey);
}

function readLegacyMap(storageKey: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoreMap(storeKey: string, map: Record<string, string>): void {
  updateSettings({ [storeKey]: JSON.stringify(map) });
}

export function readCommandAliases(): Record<string, string> {
  return readStoreMap(ALIASES_STORE_KEY, ALIASES_KEY);
}

/** Returns the current alias for the command ("" clears it). */
export function writeCommandAlias(key: CommandConfigKey, alias: string): Record<string, string> {
  const map = readCommandAliases();
  const trimmed = alias.trim();
  if (trimmed) map[key] = trimmed;
  else delete map[key];
  writeStoreMap(ALIASES_STORE_KEY, map);
  return map;
}

export function readCommandHotkeys(): Record<string, string> {
  return readStoreMap(HOTKEYS_STORE_KEY, HOTKEYS_KEY);
}

export function readAppAliases(): Record<string, string> {
  return readStoreMap(APP_ALIASES_STORE_KEY, APP_ALIASES_KEY);
}

export function writeAppAlias(key: CommandConfigKey, alias: string): Record<string, string> {
  return writeAliasMap(APP_ALIASES_STORE_KEY, APP_ALIASES_KEY, key, alias);
}

export function readQuicklinkAliases(): Record<string, string> {
  return readStoreMap(QUICKLINK_ALIASES_STORE_KEY, QUICKLINK_ALIASES_KEY);
}

export function writeQuicklinkAlias(key: CommandConfigKey, alias: string): Record<string, string> {
  return writeAliasMap(QUICKLINK_ALIASES_STORE_KEY, QUICKLINK_ALIASES_KEY, key, alias);
}

function writeAliasMap(storeKey: string, legacyKey: string, key: CommandConfigKey, alias: string): Record<string, string> {
  const map = readStoreMap(storeKey, legacyKey);
  const trimmed = alias.trim();
  if (trimmed) map[key] = trimmed;
  else delete map[key];
  writeStoreMap(storeKey, map);
  return map;
}

/** True when the item was switched off on the Shortcuts page (hidden from root search). */
export function isShortcutDisabled(key: CommandConfigKey): boolean {
  return readStoreMap(DISABLED_STORE_KEY, DISABLED_KEY)[key] === "1";
}

export function readShortcutDisabled(): Record<string, string> {
  return readStoreMap(DISABLED_STORE_KEY, DISABLED_KEY);
}

export function writeShortcutDisabled(key: CommandConfigKey, disabled: boolean): Record<string, string> {
  const map = readStoreMap(DISABLED_STORE_KEY, DISABLED_KEY);
  if (disabled) map[key] = "1";
  else delete map[key];
  writeStoreMap(DISABLED_STORE_KEY, map);
  return map;
}

export function writeCommandHotkey(key: CommandConfigKey, hotkey: string | null): Record<string, string> {
  const map = readCommandHotkeys();
  if (hotkey) map[key] = hotkey;
  else delete map[key];
  writeStoreMap(HOTKEYS_STORE_KEY, map);
  return map;
}

export interface HotkeyCombo {
  modifiers: string[];
  key: string;
}

/** Named keys the host's `VirtualKey` switch accepts, in exactly the casing it matches. */
const NAMED_HOTKEY_KEYS = new Set([
  "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
  "Backspace", "Delete", "Enter", "Return", "Escape",
  "Minus", "Equal", "Space", "Tab", "Home", "End", "PageUp", "PageDown", "Insert",
]);

/** `"Ctrl+Shift+G"` → `{modifiers:["ctrl","shift"], key:"G"}` — the host's parser shape.
 * Named keys (arrows, F-keys, media-adjacent keys) pass through with their canonical casing;
 * a length check alone would reject them and silently drop the registration. */
export function parseHotkeyCombo(hotkey: string): HotkeyCombo | null {
  const parts = hotkey.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const rawKey = parts[parts.length - 1];
  if (!rawKey) return null;
  const modifiers: string[] = [];
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "alt" || lower === "shift" || lower === "meta") modifiers.push(lower);
    else return null;
  }
  const key = NAMED_HOTKEY_KEYS.has(rawKey) || /^F\d{1,2}$/.test(rawKey)
    ? rawKey
    : rawKey.length === 1 ? rawKey.toUpperCase() : null;
  if (!key) return null;
  return { modifiers, key };
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

/**
 * Which system extension (Settings titlebar switch) a shortcut key belongs to; null = no page
 * switch covers it (installed extensions, favorites).
 */
export function areaForCommandKey(key: string): string | null {
  if (key.startsWith("app:")) return "applications";
  if (key.startsWith("quicklink:")) return "quicklinks";
  if (key.startsWith("wm-")) return "window-management";
  if (key.startsWith("command:internal/")) return key.split("/")[2] ?? null;
  return null;
}

/** Re-register every stored command hotkey (after a backend restart or on launcher mount).
 * Keys of disabled system extensions are skipped — a disabled extension has no hotkeys. */
export async function registerAllCommandHotkeys(): Promise<void> {
  const hotkeys = readCommandHotkeys();
  await Promise.all(
    Object.entries(hotkeys).map(([key, hotkey]) => {
      const area = areaForCommandKey(key);
      if (area && !isExtensionEnabled(area)) return Promise.resolve();
      return registerCommandHotkeyWithHost(key, hotkey);
    }),
  );
}

/** Reconcile host registrations after an extension switch flips: unregister every key of the
 * disabled area, re-register the enabled ones. */
export async function syncCommandHotkeysWithExtensions(): Promise<void> {
  const hotkeys = readCommandHotkeys();
  await Promise.all(
    Object.entries(hotkeys).map(([key, hotkey]) => {
      const area = areaForCommandKey(key);
      if (!area) return Promise.resolve();
      return registerCommandHotkeyWithHost(key, isExtensionEnabled(area) ? hotkey : null);
    }),
  );
}
