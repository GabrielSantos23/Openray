// One-time carry-over of localStorage keys written before the Openray rename. The renderer
// profile moved with the data dir, but the keys inside it still use the old `raycast-mini:`
// prefix (usage rankings, fallback commands, inline section settings, snippets view state).
// Copies each legacy key into its new name when the new name is unset, then drops the old one.

const LEGACY_PREFIX = "raycast-mini:";
const LEGACY_SINGLE_KEYS = [
  "raycast-notes-counter-mode",
  "raycast-notes-format-bar-visible",
];

export function migrateLegacyLocalStorageKeys(): void {
  try {
    const legacyPrefixed: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_PREFIX)) legacyPrefixed.push(key);
    }
    for (const key of legacyPrefixed) {
      const nextKey = `openray:${key.slice(LEGACY_PREFIX.length)}`;
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, value);
      localStorage.removeItem(key);
    }
    for (const key of LEGACY_SINGLE_KEYS) {
      const value = localStorage.getItem(key);
      if (value === null) continue;
      const nextKey = `openray-${key.slice("raycast-".length)}`;
      if (localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, value);
      localStorage.removeItem(key);
    }
  } catch (error) {
    // Storage can be unavailable in private modes; the defaults are fine.
    console.warn("[legacy-keys] migration skipped", error);
  }
}
