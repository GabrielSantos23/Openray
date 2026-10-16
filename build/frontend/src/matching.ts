// Raycast's root search matcher and ranking implementation
// Based on reverse-engineered functions: pe, he, me, W, ki from menu.namespace and main-window bundles

export interface NormalizedText {
  normalizedText: string;
  wordBoundaries: Uint8Array;
}

export interface MatchResult {
  type: "exact" | "unmatched" | "partial";
  score: number;
  skipped: number;
}

export interface RankingScore {
  title: string | MatchResult;
  subtitle: string | MatchResult;
  keywords: (string | MatchResult)[];
  isMatching: boolean;
}

export interface RankedEntry<T> {
  entry: T;
  ranking: RankingScore;
  originalIndex: number;
  usageScore: number;
  titleLength: number;
  subtitleLength: number;
}

export type Sensitivity = "low" | "medium" | "high";

export interface FallbackCommand {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  action: (query: string) => void;
}

export interface FileSearchResult {
  path: string;
  name: string;
  extension: string;
  folder: string;
  modifiedTime: number;
  size: number;
  /** Present on rows from the backend indexer (`fileSearch.search`). */
  parentFolder?: string;
  createdTime?: number;
  contentType?: string;
}

// Remove diacritics and normalize text
function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// pe(e,t) - Normalize text and find word boundaries
export function normalizeText(text: string, includeWordBoundaries: boolean): NormalizedText {
  const cleaned = removeDiacritics(text);
  const lower = cleaned.toLowerCase();
  let wordBoundaries = new Uint8Array(0);
  if (includeWordBoundaries) {
    const boundaries = new Uint8Array(lower.length);
    // Detect word boundaries on the original (cleaned) text, not the lowercased version
    // A word boundary occurs when a lowercase letter or digit is followed by an uppercase letter
    for (let i = 1; i < cleaned.length; i++) {
      const prev = cleaned[i - 1];
      const curr = cleaned[i];
      if (
        (prev >= "a" && prev <= "z" || prev >= "0" && prev <= "9") &&
        (curr >= "A" && curr <= "Z")
      ) {
        boundaries[i] = 1;
      }
    }
    wordBoundaries = boundaries;
  }
  return { normalizedText: lower, wordBoundaries };
}

// he(e,t) - Core matching algorithm
export function matchText(searchTerm: NormalizedText, target: NormalizedText): MatchResult {
  const needle = searchTerm.normalizedText;
  const haystack = target.normalizedText;
  const n = needle.length;
  const m = haystack.length;

  if (n === 0) return { type: "exact", score: Number.MAX_SAFE_INTEGER, skipped: 0 };
  if (needle === haystack) {
    return { type: "exact", score: Number.MAX_SAFE_INTEGER, skipped: 0 };
  }

  // Check for prefix match (haystack starts with needle) - high priority
  if (haystack.startsWith(needle)) {
    const isWordBoundary = target.wordBoundaries[n] === 1 || n === m;
    return {
      type: "partial",
      score: 100 + (isWordBoundary ? 50 : 0),
      skipped: 0,
    };
  }

  // Check for reverse prefix match (needle starts with haystack) - target is prefix of query.
  // An empty target must not match: entries without a subtitle would otherwise match every query.
  if (haystack.length > 0 && needle.startsWith(haystack)) {
    // The target is a prefix of the query, high relevance
    return {
      type: "partial",
      score: 90,
      skipped: 0,
    };
  }

  let score = 0;
  let skipped = 0;
  let j = 0;

  for (let i = 0; i < n; i++) {
    const needleChar = needle[i];
    let found = false;
    while (j < m) {
      if (haystack[j] === needleChar) {
        found = true;
        const isWordBoundary = target.wordBoundaries[j] === 1;
        const isStartOfWord = j === 0 || target.wordBoundaries[j] === 1;
        if (isStartOfWord) score += 10;
        else if (isWordBoundary) score += 5;
        else score += 1;
        j++;
        break;
      }
      skipped++;
      j++;
    }
    if (!found) {
      return { type: "unmatched", score: Number.MIN_SAFE_INTEGER, skipped: m };
    }
  }

  return { type: "partial", score, skipped };
}

// me(t,e,n) - Sensitivity threshold check
export function checkSensitivity(
  match: MatchResult,
  searchTermLength: number,
  sensitivity: Sensitivity
): boolean {
  if (match.type === "unmatched") return false;
  if (match.type === "exact") return true;

  switch (sensitivity) {
    case "low":
      return true;
    case "medium":
      return match.score >= 1.5 * (searchTermLength - match.skipped - 2) + 4;
    case "high":
      return match.score > 2 * (searchTermLength - match.skipped);
  }
}

// W(e) - Convert match result to numeric score
export function scoreToValue(match: string | MatchResult): number {
  if (typeof match === "string") {
    if (match === "unmatched") return Number.MIN_SAFE_INTEGER;
    if (match === "exact") return Number.MAX_SAFE_INTEGER;
    return 0;
  }
  if (match.type === "unmatched") return Number.MIN_SAFE_INTEGER;
  if (match.type === "exact") return Number.MAX_SAFE_INTEGER;
  return match.score;
}

// Generate all keyword combinations (title + subtitle, subtitle + title)
export function generateKeywords(title: string, subtitle: string | null): string[] {
  const keywords: string[] = [];
  const normalizedTitle = removeDiacritics(title).toLowerCase();
  const normalizedSubtitle = subtitle ? removeDiacritics(subtitle).toLowerCase() : "";

  if (normalizedSubtitle) {
    keywords.push(`${normalizedTitle} ${normalizedSubtitle}`);
    keywords.push(`${normalizedSubtitle} ${normalizedTitle}`);
  }
  keywords.push(normalizedTitle);
  if (normalizedSubtitle) keywords.push(normalizedSubtitle);

  return keywords;
}

// ki(e,t,n) - Multi-tier comparator function
const HQ = 4; // Minimum search term length for exact matches to influence ranking

export function compareRankedEntries<T>(
  a: RankedEntry<T>,
  b: RankedEntry<T>,
  searchTermLength: number
): number {
  // Tier 1: For search terms > 3 characters, exact title matches get priority
  if (searchTermLength > HQ) {
    const aExactTitle = a.ranking.title === "exact" || (typeof a.ranking.title === "object" && a.ranking.title.type === "exact");
    const bExactTitle = b.ranking.title === "exact" || (typeof b.ranking.title === "object" && b.ranking.title.type === "exact");
    if (aExactTitle && bExactTitle) return 0;
    if (aExactTitle) return -1;
    if (bExactTitle) return 1;
  }

  // Tier 1.5: Best keyword (alias) score — an exact alias match outranks fuzzy title hits and
  // usage, which is what makes per-command aliases surface their row the way Raycast does.
  const bestKeywordScore = (ranking: typeof a.ranking) => {
    let best = Number.MIN_SAFE_INTEGER;
    for (const keyword of ranking.keywords ?? []) {
      const value = scoreToValue(keyword);
      if (value > best) best = value;
    }
    return best;
  };
  const aKeywordScore = bestKeywordScore(a.ranking);
  const bKeywordScore = bestKeywordScore(b.ranking);
  if (aKeywordScore !== bKeywordScore) return bKeywordScore - aKeywordScore;

  // Tier 2: Title score difference
  const aTitleScore = scoreToValue(a.ranking.title);
  const bTitleScore = scoreToValue(b.ranking.title);
  if (aTitleScore !== bTitleScore) return bTitleScore - aTitleScore;

  // Tier 3: Subtitle score difference
  const aSubtitleScore = scoreToValue(a.ranking.subtitle);
  const bSubtitleScore = scoreToValue(b.ranking.subtitle);
  if (aSubtitleScore !== bSubtitleScore) return bSubtitleScore - aSubtitleScore;

  // Tier 4: Usage score difference (Tq)
  if (a.usageScore !== b.usageScore) return b.usageScore - a.usageScore;

  // Tier 5: Title length difference (Lr)
  if (a.titleLength !== b.titleLength) return a.titleLength - b.titleLength;

  // Tier 6: Subtitle length difference (Eq)
  if (a.subtitleLength !== b.subtitleLength) return a.subtitleLength - b.subtitleLength;

  // Tier 7: Original index as final tiebreaker
  return a.originalIndex - b.originalIndex;
}

// Build ranking for a single entry
export function buildRanking<T extends { title: string; subtitle: string | null; keywords: string[] }>(
  entry: T,
  searchTerm: string,
  sensitivity: Sensitivity,
  usageScore: number,
  originalIndex: number
): RankedEntry<T> {
  const normalizedSearch = normalizeText(searchTerm, true);
  const normalizedTitle = normalizeText(entry.title, true);
  const normalizedSubtitle = normalizeText(entry.subtitle ?? "", true);

  const titleMatch = matchText(normalizedSearch, normalizedTitle);
  const subtitleMatch = matchText(normalizedSearch, normalizedSubtitle);

  const keywords = entry.keywords.map((kw) => {
    const normalizedKw = normalizeText(kw, true);
    return matchText(normalizedSearch, normalizedKw);
  });

  const isMatching =
    checkSensitivity(titleMatch, searchTerm.length, sensitivity) ||
    checkSensitivity(subtitleMatch, searchTerm.length, sensitivity) ||
    keywords.some((k) => checkSensitivity(k, searchTerm.length, sensitivity));

  return {
    entry,
    ranking: {
      title: titleMatch,
      subtitle: subtitleMatch,
      keywords,
      isMatching,
    },
    originalIndex,
    usageScore,
    titleLength: entry.title.length,
    subtitleLength: entry.subtitle?.length ?? 0,
  };
}

// Filter and sort entries using the full ranking algorithm
export function rankEntries<T extends { title: string; subtitle: string | null; keywords: string[] }>(
  entries: T[],
  searchTerm: string,
  sensitivity: Sensitivity,
  usageScores: Map<string, number>
): RankedEntry<T>[] {
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) {
    return entries.map((entry, index) => ({
      entry,
      ranking: {
        title: "unmatched",
        subtitle: "unmatched",
        keywords: entry.keywords.map(() => "unmatched"),
        isMatching: true,
      },
      originalIndex: index,
      usageScore: usageScores.get(entry.title) ?? 0,
      titleLength: entry.title.length,
      subtitleLength: entry.subtitle?.length ?? 0,
    }));
  }

  const ranked = entries
    .map((entry, index) => buildRanking(entry, trimmed, sensitivity, usageScores.get(entry.title) ?? 0, index))
    .filter((r) => r.ranking.isMatching);

  ranked.sort((a, b) => compareRankedEntries(a, b, trimmed.length));
  return ranked;
}

// Rank entries with fallback commands support
export function rankEntriesWithFallbacks<T extends { title: string; subtitle: string | null; keywords: string[] }>(
  entries: T[],
  searchTerm: string,
  sensitivity: Sensitivity,
  usageScores: Map<string, number>,
  fallbackCommands: FallbackCommand[]
): { results: RankedEntry<T>[]; showFallbacks: boolean } {
  const trimmed = searchTerm.trim();
  const ranked = rankEntries(entries, searchTerm, sensitivity, usageScores);
  
  // Show fallbacks only when no results match and there's a non-empty query
  const showFallbacks = trimmed.length > 0 && ranked.length === 0 && fallbackCommands.length > 0;
  
  if (showFallbacks) {
    // Create ranked entries for fallback commands
    const fallbackRanked: RankedEntry<T>[] = fallbackCommands.map((cmd, index) => ({
      entry: {
        title: cmd.title,
        subtitle: cmd.subtitle ?? "",
        keywords: cmd.keywords ?? [],
      } as T,
      ranking: {
        title: "exact",
        subtitle: "exact",
        keywords: (cmd.keywords ?? []).map(() => "exact"),
        isMatching: true,
      },
      originalIndex: entries.length + index,
      usageScore: 0,
      titleLength: cmd.title.length,
      subtitleLength: cmd.subtitle?.length ?? 0,
    }));
    
    return { results: [...ranked, ...fallbackRanked], showFallbacks: true };
  }
  
  return { results: ranked, showFallbacks: false };
}