// FlowKey extension preference values (M2 re-home of the store's per-command preferences):
// the manifest declares the schema (surfaced by the summaries RPC); values persist in
// localStorage per extension and reach the worker through loadCommand. Plain values only —
// the worker falls back to the manifest default when a key is absent.

const KEY = "raycast-mini:flowkey-preferences";

type Values = Record<string, unknown>;

function readAll(): Record<string, Values> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Values>;
  } catch {
    return {};
  }
}

export function readFlowkeyPreferences(uuid: string): Values {
  return readAll()[uuid] ?? {};
}

export function writeFlowkeyPreference(uuid: string, name: string, value: unknown): Values {
  const all = readAll();
  const next = { ...(all[uuid] ?? {}), [name]: value };
  all[uuid] = next;
  localStorage.setItem(KEY, JSON.stringify(all));
  return next;
}
