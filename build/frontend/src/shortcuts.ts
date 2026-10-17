// Display formatting for declared action shortcuts. The worker adapter flattens an extension's
// `{ key, modifiers }` into a single string (`ctrl+shift+return`); the UI renders it as keycap
// pills (Raycast's shortcut rendering) and the command session matches it against key events.

const SHORTCUT_KEY_LABELS: Record<string, string> = {
  return: "↵",
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "Tab",
};

/** `ctrl+shift+return` → keycap pills `Ctrl Shift ↵`. */
export function shortcutPills(shortcut: string): string[] {
  return shortcut
    .split("+")
    .filter(Boolean)
    .map((part) => {
      if (part.length === 1) return part.toUpperCase();
      return SHORTCUT_KEY_LABELS[part] ?? part.charAt(0).toUpperCase() + part.slice(1);
    });
}

const SHORTCUT_KEY_EVENTS: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  space: " ",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  tab: "Tab",
  home: "Home",
  end: "End",
  pageUp: "PageUp",
  pageDown: "PageDown",
};

/**
 * Matches a declared shortcut against a keyboard event. Modifiers must match exactly, so a plain
 * Enter never triggers the Ctrl+↵ copy action.
 */
export function shortcutMatches(shortcut: string | undefined, event: KeyboardEvent): boolean {
  if (!shortcut || typeof shortcut !== "string") return false;
  const parts = shortcut.split("+").filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts.pop() as string;
  const modifiers = new Set(parts);
  if (event.ctrlKey !== modifiers.has("ctrl")) return false;
  if (event.altKey !== modifiers.has("alt")) return false;
  if (event.shiftKey !== modifiers.has("shift")) return false;
  if (event.metaKey !== modifiers.has("windows")) return false;
  const expected = SHORTCUT_KEY_EVENTS[key] ?? key.toLowerCase();
  const actual = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return actual === expected;
}
