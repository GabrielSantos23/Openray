import dataset from "./generated/emoji-data.json";

export interface EmojiRecord {
  /** The emoji character itself. */
  s: string;
  /** Display name (CLDR, title-cased). */
  n: string;
  /** Slug (`grinning_face`) — doubles as a keyword source. */
  g: string;
  c: CategoryId;
  /** 1 when the emoji supports skin tones. */
  t: 0 | 1;
  v: string;
}

export type CategoryId =
  | "smileys_people"
  | "animals_nature"
  | "food_drink"
  | "activity"
  | "travel_places"
  | "objects"
  | "symbols"
  | "flags"
  | "unicode_symbols";

export const ALL: EmojiRecord[] = dataset as EmojiRecord[];

export const BY_SYMBOL: Map<string, EmojiRecord> = new Map(ALL.map((record) => [record.s, record]));

/** Tonable single-codepoint glyphs — components of ZWJ sequences take the same modifier. */
export const TONABLE: Set<string> = new Set(
  ALL.filter((record) => record.t === 1 && [...record.s].length === 1).map((record) => record.s),
);

export interface CategorySpec {
  value: string;
  label: string;
}

/** Raycast's category list (`KL` in the shipped picker), including the two user buckets. */
export const FILTER_OPTIONS: CategorySpec[] = [
  { value: "all", label: "All Categories" },
  { value: "pinned", label: "Pinned" },
  { value: "recent", label: "Frequently Used" },
  { value: "smileys_people", label: "Smileys & People" },
  { value: "animals_nature", label: "Animals & Nature" },
  { value: "food_drink", label: "Food & Drink" },
  { value: "activity", label: "Activity" },
  { value: "travel_places", label: "Travel & Places" },
  { value: "objects", label: "Objects" },
  { value: "symbols", label: "Symbols" },
  { value: "flags", label: "Flags" },
  { value: "unicode_symbols", label: "Other Symbols" },
];

/** Category display order (Raycast's `KL` order minus the user buckets). */
export const CATEGORY_ORDER: CategoryId[] = [
  "smileys_people",
  "animals_nature",
  "food_drink",
  "activity",
  "travel_places",
  "objects",
  "symbols",
  "flags",
  "unicode_symbols",
];

const TONE_MODIFIERS: Record<string, string> = {
  light: "\u{1F3FB}",
  mediumLight: "\u{1F3FC}",
  medium: "\u{1F3FD}",
  mediumDark: "\u{1F3FE}",
  dark: "\u{1F3FF}",
};

export const SKIN_TONES = ["none", "light", "mediumLight", "medium", "mediumDark", "dark"] as const;

/** Applies the skin-tone modifier to every tonable component of a (possibly ZWJ) sequence. */
export function applyTone(symbol: string, tone: string): string {
  const modifier = TONE_MODIFIERS[tone];
  if (!modifier || !symbol) return symbol;
  return symbol
    .split("\u200D")
    .map((part) => (TONABLE.has(part) ? part + modifier : part))
    .join("\u200D");
}

/** `Copy Unicode` representation: `U+1F643`-style code points, one per character. */
export function unicodeRepresentation(symbol: string): string {
  return [...symbol]
    .map((char) => `u+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`)
    .join(" ");
}

export interface SearchState {
  keywords: Record<string, string[]>;
  frecency: Record<string, { c: number; t: number }>;
}

function frecencyScore(state: SearchState, symbol: string, now: number): number {
  const entry = state.frecency[symbol];
  if (!entry) return 0;
  const ageDays = Math.max(0, (now - entry.t) / 86_400_000);
  return entry.c * Math.pow(0.5, ageDays / 14);
}

function matchScore(record: EmojiRecord, tokens: string[], keywords: string[]): number | null {
  const name = record.n.toLowerCase();
  const nameWords = name.split(/\s+/);
  const slugWords = record.g.split("_");
  const keywordWords = keywords.map((keyword) => keyword.toLowerCase().replace(/_/g, " "));
  let score = 0;
  for (const token of tokens) {
    if (keywordWords.some((word) => word.startsWith(token))) {
      score = Math.max(score, 100);
      continue;
    }
    if (name === token) {
      score = Math.max(score, 90);
      continue;
    }
    if (name.startsWith(token)) {
      score = Math.max(score, 80);
      continue;
    }
    if (slugWords.some((word) => word.startsWith(token)) || keywordWords.some((word) => word.includes(token))) {
      score = Math.max(score, 60);
      continue;
    }
    if (nameWords.some((word) => word.startsWith(token))) {
      score = Math.max(score, 50);
      continue;
    }
    if (name.includes(token) || slugWords.some((word) => word.includes(token))) {
      score = Math.max(score, 30);
      continue;
    }
    return null;
  }
  return score;
}

/** Ranks the dataset for a query: match quality first, frecency as the tie-breaker (uprank). */
export function searchEmoji(state: SearchState, query: string, limit = 120): EmojiRecord[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const now = Date.now();
  const scored: Array<{ record: EmojiRecord; score: number }> = [];
  for (const record of ALL) {
    const score = matchScore(record, tokens, state.keywords[record.s] ?? []);
    if (score === null) continue;
    scored.push({ record, score: score + frecencyScore(state, record.s, now) });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.record.n.length - b.record.n.length ||
      a.record.n.localeCompare(b.record.n),
  );
  return scored.slice(0, limit).map((entry) => entry.record);
}

export function byCategory(category: CategoryId): EmojiRecord[] {
  return ALL.filter((record) => record.c === category);
}

/** The `Frequently Used` bucket: top records by decayed copy count. */
export function frequentlyUsed(state: SearchState, count: number): EmojiRecord[] {
  const now = Date.now();
  return Object.entries(state.frecency)
    .map(([symbol, entry]) => {
      const record = BY_SYMBOL.get(symbol);
      if (!record) return null;
      const ageDays = Math.max(0, (now - entry.t) / 86_400_000);
      return { record, score: entry.c * Math.pow(0.5, ageDays / 14) };
    })
    .filter((entry): entry is { record: EmojiRecord; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.record.n.localeCompare(b.record.n))
    .slice(0, count)
    .map((entry) => entry.record);
}
