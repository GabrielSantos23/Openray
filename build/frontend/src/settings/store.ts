// Settings store client. Raycast keeps a `raycastSettingsStore` per window that persists through
// the backend and receives host pushes (`subscribeUpdate*`); this is the same shape: one
// subscribe-able map, optimistic writes, and a `settings.changed` push reconciling both windows.

import { useSyncExternalStore } from "react";
import { ipc, onNotification } from "../ipc";
import type { SettingsMap, SettingsValue } from "./pages";
import { DEFAULTS } from "./persistence";

const STORAGE_KEY = "openray:settings";

function readLocal(): SettingsMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as SettingsMap) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeLocal(values: SettingsMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* private mode / quota — the backend store still persists */
  }
}

let values: SettingsMap = readLocal();
const listeners = new Set<() => void>();
let backendSynced = false;

function emit(): void {
  for (const listener of listeners) listener();
}

export function getSettings(): SettingsMap {
  return values;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the whole map (rows subscribe per key with `useSetting(id)` below). */
export function useSettings(): SettingsMap {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

export function useSetting(id: string): SettingsValue | undefined {
  return useSyncExternalStore(subscribeSettings, () => values[id]);
}

/**
 * System-extension switches (`ext-enabled:<area>`): an area whose switch is off in the Settings
 * titlebar is fully disabled in the launcher — no root-search rows, no hotkeys, no aliases.
 * Absent counts as enabled (the default).
 */
export function isExtensionEnabled(area: string): boolean {
  return values[`ext-enabled:${area}`] !== false;
}

/** Optimistic write: update locally, persist, then let the backend fan the change back out. */
export function updateSettings(patch: SettingsMap): void {
  values = { ...values, ...patch };
  writeLocal(values);
  emit();
  void ipc
    .backend("settings.set", { values: patch }, { module: "backend" })
    .catch(() => {
      /* the backend store lands in a later milestone; localStorage still holds the value */
    });
}

/**
 * Pull the backend copy once per window boot so a change made in the other window (before this
 * one opened) is visible; afterwards the `settings.changed` push keeps both live.
 */
export function syncFromBackend(): void {
  if (backendSynced) return;
  backendSynced = true;
  void ipc
    .backend("settings.getAll", {}, { module: "backend" })
    .then((response) => {
      const stored = (response as { values?: SettingsMap }).values;
      if (stored && Object.keys(stored).length > 0) {
        values = { ...values, ...stored };
        writeLocal(values);
        emit();
      }
    })
    .catch(() => {
      backendSynced = false;
    });
}

export function installSettingsPush(): () => void {
  return onNotification("settings.changed", (data) => {
    const pushed = (data as { values?: SettingsMap }).values;
    if (!pushed) return;
    values = { ...values, ...pushed };
    writeLocal(values);
    emit();
  });
}

/** Live-update hook for the launcher: re-renders when any of the given keys change. */
export function useSettingsKeys(...ids: string[]): SettingsMap {
  return useSyncExternalStore(subscribeSettings, () => {
    const slice: SettingsMap = {};
    for (const id of ids) slice[id] = values[id];
    return slice;
  });
}
