// Pinned / recently-used logo state, persisted in the extension's storage like the emoji
// extension's. `pinned` keeps manual order; `recent` is most-recent-first.

export interface SvglState {
  pinned: number[];
  recent: number[];
}

export const EMPTY_STATE: SvglState = { pinned: [], recent: [] };

export function sanitizeState(value: unknown): SvglState {
  if (typeof value !== "object" || value === null) return { ...EMPTY_STATE };
  const raw = value as { pinned?: unknown; recent?: unknown };
  const ids = (list: unknown): number[] =>
    Array.isArray(list)
      ? [...new Set(list.filter((id): id is number => typeof id === "number" && Number.isFinite(id)))]
      : [];
  return { pinned: ids(raw.pinned), recent: ids(raw.recent) };
}

export async function loadState(capabilities: { storage: { get<T>(key: string): Promise<T | null> } }): Promise<SvglState> {
  const stored = await capabilities.storage.get<SvglState>("state").catch(() => null);
  return stored ? sanitizeState(stored) : { ...EMPTY_STATE };
}

export async function saveState(
  capabilities: { storage: { set(key: string, value: unknown): Promise<void> } },
  state: SvglState,
): Promise<void> {
  await capabilities.storage.set("state", state);
}

export function withPinned(state: SvglState, id: number): SvglState {
  if (state.pinned.includes(id)) return state;
  return { ...state, pinned: [id, ...state.pinned] };
}

export function withoutPinned(state: SvglState, id: number): SvglState {
  return { ...state, pinned: state.pinned.filter((pinnedId) => pinnedId !== id) };
}

export function withMoved(state: SvglState, id: number, delta: -1 | 1): SvglState {
  const index = state.pinned.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= state.pinned.length) return state;
  const pinned = [...state.pinned];
  pinned.splice(index, 1);
  pinned.splice(target, 0, id);
  return { ...state, pinned };
}

export function withRecent(state: SvglState, id: number): SvglState {
  return { ...state, recent: [id, ...state.recent.filter((recentId) => recentId !== id)].slice(0, 50) };
}
