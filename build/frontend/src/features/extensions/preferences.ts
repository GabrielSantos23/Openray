// FlowKey extension preference values: the BACKEND file (`<dataRoot>/flowkey-preferences.json`)
// is the single source of truth — the Settings window is a separate WebView2 profile, so its
// localStorage never reached the main window that launches extensions (the Spotify client id
// bug). The mirror below is only a synchronous cache for the launcher's first paint;
// useExtensionCommand refreshes from the backend before every loadCommand.

import { ipc } from "../../ipc";

const MIRROR_KEY = "raycast-mini:flowkey-preferences";

type Values = Record<string, unknown>;

function readMirror(): Record<string, Values> {
  try {
    return JSON.parse(localStorage.getItem(MIRROR_KEY) ?? "{}") as Record<string, Values>;
  } catch {
    return {};
  }
}

/** Synchronous cache read (stale-tolerant); the authoritative read is `fetchFlowkeyPreferences`. */
export function readFlowkeyPreferences(uuid: string): Values {
  return readMirror()[uuid] ?? {};
}

function writeMirror(uuid: string, values: Values): void {
  const all = readMirror();
  all[uuid] = values;
  localStorage.setItem(MIRROR_KEY, JSON.stringify(all));
}

/** Authoritative values, straight from the backend file. */
export async function fetchFlowkeyPreferences(uuid: string): Promise<Values> {
  const payload = (await ipc.backend("extensionHost.getFlowkeyPreferences", { uuid })) as { values?: Values };
  const values = payload.values ?? {};
  writeMirror(uuid, values);
  return values;
}

/** Persist one preference through the backend and refresh the mirror. */
export async function saveFlowkeyPreference(uuid: string, name: string, value: unknown): Promise<Values> {
  const payload = (await ipc.backend("extensionHost.setFlowkeyPreference", { uuid, name, value })) as {
    values?: Values;
  };
  const values = payload.values ?? {};
  writeMirror(uuid, values);
  return values;
}

/** Optimistic local write (kept for checkbox/dropdown rows that save on change). */
export async function writeFlowkeyPreference(uuid: string, name: string, value: unknown): Promise<Values> {
  const all = readMirror();
  const next = { ...(all[uuid] ?? {}), [name]: value };
  writeMirror(uuid, next);
  try {
    return await saveFlowkeyPreference(uuid, name, value);
  } catch {
    return next;
  }
}
