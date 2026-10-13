// Settings persistence: localStorage-backed values, the row-id sets that route rows to their
// backend stores, and the label/value maps for the option rows.

import type { Sensitivity } from "../matching";
import type { SettingsMap, SettingsValue } from "./pages";

export const STORAGE_KEY = "raycast-mini:settings";

/** Clipboard rows persist to the Node store, not localStorage, so every reader sees one value. */
export const CLIPBOARD_ROW_IDS = new Set([
  "clipboard-history-hotkey",
  "clipboard-keep-history-for",
  "clipboard-text-recognition",
  "clipboard-recognition-mode",
  "clipboard-ignore-duplicate",
  "clipboard-ignored-applications",
  "clipboard-filters",
  "clipboard-primary-action",
  "clipboard-prefer-plain-text",
  "clipboard-show-link-visuals",
  "clipboard-update-history-after-action",
  "clipboard-add-newline-after-paste",
  "clipboard-paste-sequence-timeout",
]);

export const QUICKLINKS_ROW_IDS = new Set(["quicklinks-pass-selected-text", "quicklinks-warn-before-delete"]);

/** The calculator page's one preference lives in the backend store (`remToPxRate`). */
export const CALCULATOR_ROW_IDS = new Set(["calculator-rem-to-px"]);

/** File Search rows persist to the Node store (`file-search-settings.json`). */
export const FILE_SEARCH_ROW_IDS = new Set([
  "include-files-in-root-search",
  "file-search-scopes",
  "file-search-ignore-patterns",
  "file-search-include-hidden",
  "file-search-respect-ignore-files",
  "file-search-reset",
]);

/** Translator rows persist to the backend store (`translator-settings.json`). */
export const TRANSLATOR_ROW_IDS = new Set([
  "translator-primary-action",
  "translator-prefill-from-selected-text",
  "translator-default-source-language",
  "translator-default-target-language",
]);

/** Snippet rows persist to the Node store (expansion settings) or the renderer (command flags). */
export const SNIPPETS_ROW_IDS = new Set([
  "snippets-enable-expansion",
  "snippets-expansion-mode",
  "snippets-expand-within-words",
  "snippets-injection-delay",
  "snippets-response-time",
  "snippets-completion-sound",
  "snippets-disabled-applications",
  "snippets-primary-action",
  "snippets-warn-before-delete",
]);

/** Settings labels -> the backend preference values the snippets store understands. */
export const SNIPPETS_MODE_BY_LABEL: Record<string, string> = {
  "Immediately": "immediately",
  "After Delimiter (keeping)": "after-delimiter-keeping",
  "After Delimiter (discarding)": "after-delimiter-discarding",
};
export const SNIPPETS_MODE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SNIPPETS_MODE_BY_LABEL).map(([label, value]) => [value, label]),
);
export const SNIPPETS_INJECTION_DELAY_BY_LABEL: Record<string, string> = {
  "None": "none",
  "Short": "short",
  "Regular": "regular",
  "Long": "long",
  "Extra Long": "extra-long",
};
export const SNIPPETS_INJECTION_DELAY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SNIPPETS_INJECTION_DELAY_BY_LABEL).map(([label, value]) => [value, label]),
);
export const SNIPPETS_RESPONSE_TIME_BY_LABEL: Record<string, string> = {
  "Instant": "instant",
  "Quick": "quick",
  "Default": "default",
  "Delayed": "delayed",
  "Extended": "extended",
};
export const SNIPPETS_RESPONSE_TIME_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SNIPPETS_RESPONSE_TIME_BY_LABEL).map(([label, value]) => [value, label]),
);
export const SNIPPETS_SOUND_BY_LABEL: Record<string, string> = {
  "None": "none",
  "Asterisk": "asterisk",
  "Beep": "beep",
  "Exclamation": "exclamation",
  "Hand": "hand",
  "Question": "question",
};
export const SNIPPETS_SOUND_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SNIPPETS_SOUND_BY_LABEL).map(([label, value]) => [value, label]),
);

/** Notes rows persist to the Node store (`notes-settings.json`). */
export const NOTES_ROW_IDS = new Set(["notes-escape-key-behavior", "notes-zoom"]);
export const NOTES_ESCAPE_BY_LABEL: Record<string, string> = {
  "Closes Window": "closesWindow",
  "Loses Focus": "losesFocus",
};
export const NOTES_ESCAPE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(NOTES_ESCAPE_BY_LABEL).map(([label, value]) => [value, label]),
);

export const DEFAULTS: SettingsMap = {
  "follow-system-appearance": true,
  "theme-dark": "Raycast Dark",
  "theme-light": "Raycast Light",
  "interface-size": "Default",
  "window-mode": "Compact",
  "show-favorites-in-compact-mode": true,
  "open-at-login": false,
  "show-in-menu-bar": true,
  "automatically-show-taskbar": false,
  "show-raycast-on": "Primary display",
  "pop-to-root-search": "Immediately",
  "root-search-sensitivity": "Balanced",
  "escape-key-behavior": "Pop to Root Search",
  "escape-key-closes-window": true,
  "navigation-bindings": "Default",
  "window-activation-behavior": "Current Space",
  "favicon-provider": "None",
  "open-folders-in-tabs": false,
  "use-system-proxy-settings": true,
  "clipboard-history-hotkey": "Ctrl + Shift + V",
  "clipboard-keep-history-for": "1 Week",
  "clipboard-text-recognition": true,
  "clipboard-recognition-mode": "Fast",
  "clipboard-ignore-duplicate": false,
  "clipboard-ignored-applications": "",
  "clipboard-filters": "",
  "clipboard-primary-action": "Paste",
  "clipboard-prefer-plain-text": false,
  "clipboard-show-link-visuals": true,
  "clipboard-update-history-after-action": true,
  "clipboard-add-newline-after-paste": true,
  "clipboard-paste-sequence-timeout": "60",
  "fallback-commands-list": "Search Web | Search the web for \"{query}\" | https://www.google.com/search?q={query}\nSearch GitHub | Search GitHub for \"{query}\" | https://github.com/search?q={query}",
  "fallback-commands-enabled": true,
  "snippets-enable-expansion": true,
  "snippets-expansion-mode": "Immediately",
  "snippets-expand-within-words": false,
  "snippets-injection-delay": "None",
  "snippets-response-time": "Default",
  "snippets-completion-sound": "None",
  "snippets-disabled-applications": "",
  "snippets-primary-action": "Paste to Active App",
  "snippets-warn-before-delete": true,
  "calculator-rem-to-px": "16",
  "include-files-in-root-search": true,
  "file-search-ignore-patterns": "",
  "file-search-include-hidden": false,
  "file-search-respect-ignore-files": true,
  "wm-inner-gap": "None",
  "wm-outer-gap": "None",
  "wm-cycle-mode": "None",
  "wm-preset": "None",
  "focus-snooze-duration": "3 minutes",
  "focus-play-sound": true,
  "focus-restore-apps": false,
  "games-game-mode": false,
  "taskbar-show": false,
  "taskbar-position": "Bottom",
  "notes-escape-key-behavior": "Closes Window",
  "notes-zoom": "100%",
};

/** Focus Snooze Duration labels -> the backend `snoozeDurationMs` (null = No Snooze). */
export const FOCUS_SNOOZE_BY_LABEL: Record<string, number | null> = {
  "1 minute": 60000,
  "3 minutes": 180000,
  "5 minutes": 300000,
  "10 minutes": 600000,
  "No Snooze": null,
};
export const FOCUS_SNOOZE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(FOCUS_SNOOZE_BY_LABEL).map(([label, ms]) => [ms === null ? "null" : String(ms), label]),
);

/** Taskbar Position labels -> the backend `position` value. */
export const TASKBAR_POSITION_BY_LABEL: Record<string, string> = {
  "Top": "top",
  "Bottom": "bottom",
  "Left": "left",
  "Right": "right",
};
export const TASKBAR_POSITION_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TASKBAR_POSITION_BY_LABEL).map(([label, value]) => [value, label]),
);

export const SENSITIVITY_MAP: Record<string, Sensitivity> = {
  "Low": "low",
  "Balanced": "medium",
  "High": "high",
};

/** `textarea` row id -> the store handler and payload key it maps onto. */
export const CLIPBOARD_TEXTAREA_ROW: Record<string, { method: string; field: string }> = {
  "clipboard-ignored-applications": { method: "clipboard.setIgnoredApplications", field: "applications" },
  "clipboard-filters": { method: "clipboard.setFiltersFromText", field: "text" },
};

/** Parses the filters textarea back into rules; mirrors `formatFilterRows`. */
export function parseFilterRows(text: string): ClipboardFilter[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const enabled = !line.startsWith("-");
      const body = enabled ? line : line.slice(1).trim();
      const separator = body.indexOf(":");
      const sourceUrl = (separator === -1 ? body : body.slice(0, separator)).trim();
      const tags = (separator === -1 ? "" : body.slice(separator + 1))
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      return { sourceUrl, tags, enabled };
    })
    .filter((filter) => filter.sourceUrl.length > 0);
}

/** One auto-tagging rule: `{ sourceUrl, tags, enabled }`, as Raycast's `clipboard_filters` stores it. */
export interface ClipboardFilter {
  sourceUrl: string;
  tags: string[];
  enabled: boolean;
}

/**
 * The filters textarea's wire format: `app.exe: tag1, tag2`, with a leading `-` marking a disabled
 * rule. Keeping it a single text field matches how Raycast exposes the same data as a per-app list while
 * staying editable without a second view.
 */
export function formatFilterRows(filters: ClipboardFilter[]): string {
  return filters
    .map((filter) => `${filter.enabled ? "" : "-"}${filter.sourceUrl}: ${filter.tags.join(", ")}`)
    .join("\n");
}

export function parseFallbackCommands(text: string, enabled: boolean): FallbackCommand[] {
  if (!enabled) return [];
  const commands: FallbackCommand[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;
    const title = parts[0];
    const subtitle = parts[1] ?? "";
    const url = parts[2] ?? "";
    commands.push({
      id: `fallback-${index}`,
      title,
      subtitle,
      keywords: [title.toLowerCase(), subtitle.toLowerCase()].filter(Boolean),
      action: (query: string) => {
        const finalUrl = url.replace(/\{query\}/g, encodeURIComponent(query));
        window.open(finalUrl, "_blank", "noopener");
      },
    });
  }
  return commands;
}

export interface FallbackCommand {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  action: (query: string) => void;
}

/** Single-row clipboard settings, each mapping onto one `clipboard.setPreference` key. */
export const CLIPBOARD_PREFERENCE_ROWS: Record<string, { key: string; value: (raw: SettingsValue) => unknown }> = {
  "clipboard-text-recognition": { key: "textRecognitionEnabled", value: (raw) => raw === true },
  "clipboard-recognition-mode": { key: "ocrLevel", value: (raw) => (raw === "Accurate" ? "accurate" : "fast") },
  "clipboard-primary-action": { key: "primaryAction", value: (raw) => (raw === "Copy" ? "copy" : "paste") },
  "clipboard-prefer-plain-text": { key: "preferPastingAsPlainText", value: (raw) => raw === true },
  "clipboard-show-link-visuals": { key: "showLinkVisualInformation", value: (raw) => raw !== false },
  "clipboard-update-history-after-action": { key: "updateHistoryAfterAction", value: (raw) => raw !== false },
  "clipboard-add-newline-after-paste": { key: "addNewLineAfterPaste", value: (raw) => raw !== false },
  "clipboard-paste-sequence-timeout": {
    key: "sequentialPasteTimeoutSeconds",
    value: (raw) => {
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Enter a positive number of seconds");
      return seconds;
    },
  },
};

export const HISTORY_DURATION_BY_LABEL: Record<string, string> = {
  "5 Minutes": "5m",
  "1 Hour": "60m",
  "1 Day": "P1D",
  "1 Week": "P1W",
  "1 Month": "P1M",
  "3 Months": "P3M",
  "6 Months": "P6M",
  "1 Year": "P1Y",
  Unlimited: "unlimited",
};

export function loadSettings(): SettingsMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as SettingsMap;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function persistSettings(values: SettingsMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* private mode / quota — settings simply do not persist */
  }
}

// ---------------------------------------------------------------------------------------------
// Controls — Raycast's `input-field-primitive`, `dropdown-button` and
// `keyboard-shortcut-recorder` (plus `visual-shortcut` for the key caps).
// ---------------------------------------------------------------------------------------------
