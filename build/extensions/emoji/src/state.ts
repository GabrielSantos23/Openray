import type { FlowKeyCapabilities } from "@flowkey-mini/native-sdk";

/**
 * Per-user picker state, persisted through the extension storage route (one JSON document, so a
 * crash mid-write can only lose the last mutation, never corrupt siblings): pinned order,
 * frecency (copy count + last use) and custom search keywords — the three state families the
 * shipped picker keeps server-side (pin, unpin, movePinnedUp/Down, uprank, updateCustomKeywords).
 */
export interface FrecencyEntry {
  c: number;
  t: number;
}

export interface EmojiState {
  pinned: string[];
  frecency: Record<string, FrecencyEntry>;
  keywords: Record<string, string[]>;
}

export const EMPTY_STATE: EmojiState = { pinned: [], frecency: {}, keywords: {} };

const STATE_KEY = "state";

function sanitize(value: unknown): EmojiState {
  if (typeof value !== "object" || value === null) return { ...EMPTY_STATE };
  const raw = value as Partial<EmojiState>;
  return {
    pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((symbol) => typeof symbol === "string") : [],
    frecency: sanitizeFrecency(raw.frecency),
    keywords: sanitizeKeywords(raw.keywords),
  };
}

function sanitizeFrecency(value: unknown): Record<string, FrecencyEntry> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, FrecencyEntry> = {};
  for (const [symbol, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as FrecencyEntry).c === "number" &&
      typeof (entry as FrecencyEntry).t === "number"
    ) {
      result[symbol] = { c: (entry as FrecencyEntry).c, t: (entry as FrecencyEntry).t };
    }
  }
  return result;
}

function sanitizeKeywords(value: unknown): Record<string, string[]> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, string[]> = {};
  for (const [symbol, keywords] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(keywords) && keywords.every((keyword) => typeof keyword === "string")) {
      result[symbol] = keywords as string[];
    }
  }
  return result;
}

export async function loadState(capabilities: FlowKeyCapabilities): Promise<EmojiState> {
  try {
    return sanitize(await capabilities.storage.get(STATE_KEY));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function saveState(capabilities: FlowKeyCapabilities, state: EmojiState): Promise<void> {
  await capabilities.storage.set(STATE_KEY, state);
}

/** `emojiPicker.uprank`: a use bumps the copy count and refreshes the recency timestamp. */
export function recordUse(state: EmojiState, symbol: string, now = Date.now()): EmojiState {
  const previous = state.frecency[symbol] ?? { c: 0, t: 0 };
  return {
    ...state,
    frecency: { ...state.frecency, [symbol]: { c: previous.c + 1, t: now } },
  };
}

export function togglePinned(state: EmojiState, symbol: string): EmojiState {
  const pinned = state.pinned.includes(symbol)
    ? state.pinned.filter((entry) => entry !== symbol)
    : [...state.pinned, symbol];
  return { ...state, pinned };
}

export function movePinned(state: EmojiState, symbol: string, offset: -1 | 1): EmojiState {
  const index = state.pinned.indexOf(symbol);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= state.pinned.length) return state;
  const pinned = [...state.pinned];
  [pinned[index], pinned[target]] = [pinned[target], pinned[index]];
  return { ...state, pinned };
}

export function setKeywords(state: EmojiState, symbol: string, keywords: string[]): EmojiState {
  const next = { ...state.keywords };
  if (keywords.length === 0) delete next[symbol];
  else next[symbol] = keywords;
  return { ...state, keywords: next };
}
