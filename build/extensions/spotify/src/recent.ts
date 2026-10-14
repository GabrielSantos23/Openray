const MAX_ENTRIES = 10;
const MIN_LENGTH = 4;

let entries: string[] = [];

export function rememberSearch(query: string): void {
  const trimmed = query.trim();
  if (trimmed.length < MIN_LENGTH || entries[0] === trimmed) {
    return;
  }
  entries = [trimmed, ...entries.filter((entry) => entry !== trimmed)].slice(0, MAX_ENTRIES);
}

export function recentSearches(): string[] {
  return [...entries];
}

export function removeSearch(query: string): void {
  entries = entries.filter((entry) => entry !== query);
}

export function clearRecentSearches(): void {
  entries = [];
}
