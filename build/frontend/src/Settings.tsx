// The Settings window, rendered in its own OS window (`settings.html` entry).
//
// Raycast hosts Settings as a separate window (`settings-window-*.js`), not an overlay inside the
// launcher; the host's `SettingsWindow` WebView2 loads this page. The layout, sidebar, page
// catalog and row/section structure below were reconstructed from the shipped artifacts with REA
// (see `NOTES-raycast-settings-re.md`):
//
//   • sidebar  = title bar ("Settings") + search field + account link + nav sections
//   • nav order = General, Launcher, Shortcuts, Keyboard, Cloud Sync, Advanced, Organizations,
//                 Internal, Remote, About   (Account is pulled out and rendered above them)
//   • content  = navigation header (breadcrumb) + page title/description + Sections of rows in
//                translucent cards, separated by hairlines (Raycast's `settings-ui__*`)
//
// Controls that the real Raycast owns but this clone cannot perform (cloud sync, accounts,
// hyper key, …) are still rendered with their real titles and descriptions so the UI matches;
// they are marked unavailable rather than silently doing nothing. Raycast behaves the same way
// on Windows for its own macOS-only rows.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RaycastIcon } from "./icons";
import { ipc } from "./ipc";
import { type Sensitivity } from "./matching";

// ---------------------------------------------------------------------------------------------
// Model — the same shape Raycast's `settings-page-definition-utils` produces.
// ---------------------------------------------------------------------------------------------

type ControlKind =
  | "switch"
  | "select"
  | "radio"
  | "hotkey"
  | "action"
  | "info"
  | "textarea"
  | "text"
  | "none";/** The version the launcher reports everywhere else, kept in one place. */
const VERSION = "2.4.0.0";
const HOST_NAME = "This Computer";
interface RowDefinition {
  id: string;
  title: string;
  description?: string;
  control: ControlKind;
  options?: readonly string[];
  /** Label for `control === "action"`; the action id is the row id itself. */
  action?: string;
  /** Static right-hand text for `control === "info"`. */
  value?: string;
  /** Rendered but inert — the real Raycast feature has no equivalent here. */
  unavailable?: boolean;
  pro?: boolean;
}

interface SectionDefinition {
  id: string;
  title?: string;
  /** Shown under the section header, in Raycast's muted style. */
  description?: string;
  rows: RowDefinition[];
  /** Shown instead of the card when the section has no rows to render. */
  empty?: string;
}

interface PageDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  sections: SectionDefinition[];
  keywords: string[];
  /** Shown when the page has no renderable sections at all. */
  empty?: string;
}

const DARK_THEMES = ["Raycast Dark", "Midnight", "Sky", "Sunset"] as const;
const LIGHT_THEMES = ["Raycast Light", "Dawn", "Overcast", "Noon"] as const;
const WINDOW_MODES = ["Compact", "Expanded"] as const;
const INTERFACE_SIZES = ["Default", "Large", "Larger"] as const;

/**
 * Raycast's `keep-history-for` options (`Vlo`), with every Pro tier unlocked because gating is out of
 * scope for this clone.
 */
const HISTORY_DURATION_LABELS = [
  "5 Minutes",
  "1 Hour",
  "1 Day",
  "1 Week",
  "1 Month",
  "3 Months",
  "6 Months",
  "1 Year",
  "Unlimited",
] as const;

/** Every settings page, in the real Raycast sidebar order (Account first, above the list). */
const PAGES: readonly PageDefinition[] = [
  {
    id: "general",
    title: "General",
    description: "Configure appearance, startup behavior, and the Raycast hotkey.",
    icon: "general",
    keywords: [
      "appearance", "compact", "favorites", "dark", "expanded", "hotkey", "light", "menu bar",
      "open at login", "scale", "startup", "system tray", "taskbar", "theme", "window mode", "zoom",
    ],
    sections: [
      {
        id: "general",
        rows: [
          { id: "open-at-login", title: "Open at Login", control: "switch" },
          { id: "show-in-menu-bar", title: "Show in System Tray", control: "switch" },
          { id: "automatically-show-taskbar", title: "Automatically Show the Taskbar", control: "switch" },
          { id: "raycast-hotkey", title: "Raycast Hotkey", control: "hotkey", value: "Ctrl + Alt + Space" },
        ],
      },
      {
        id: "appearance",
        title: "Appearance",
        rows: [
          { id: "follow-system-appearance", title: "Follow System Appearance", control: "switch" },
          { id: "theme-dark", title: "Dark Theme", control: "select", options: DARK_THEMES },
          { id: "theme-light", title: "Light Theme", control: "select", options: LIGHT_THEMES },
          {
            id: "theme-studio",
            title: "Theme Studio",
            description: "Edit or create themes for Raycast",
            control: "action",
            action: "Upgrade to Pro",
            unavailable: true,
          },
          {
            id: "interface-size",
            title: "Interface Size",
            description: "Adjust the size of the Raycast interface",
            control: "radio",
            options: INTERFACE_SIZES,
          },
          {
            id: "window-mode",
            title: "Window Mode",
            description: "Choose your preferred mode when opening Raycast",
            control: "radio",
            options: WINDOW_MODES,
          },
          {
            id: "show-favorites-in-compact-mode",
            title: "Show Favorites in Compact Mode",
            description: "Show your favorites as icons in the compact window",
            control: "switch",
            unavailable: true,
          },
        ],
      },
    ],
  },
  {
    id: "launcher",
    title: "Launcher",
    description: "Configure content shown in root search.",
    icon: "launcher",
    keywords: ["files", "file search", "launcher", "pop to root", "root search", "search sensitivity", "show raycast on"],
    sections: [
      {
        id: "behavior",
        title: "Behavior",
        rows: [
          {
            id: "show-raycast-on",
            title: "Show Raycast on",
            control: "select",
            options: ["Primary display", "Display with mouse", "Active display"],
          },
          {
            id: "pop-to-root-search",
            title: "Pop to Root Search",
            description: "Timeout after which Raycast will reset to root search after closing the window.",
            control: "select",
            options: ["Immediately", "After 1 minute", "After 5 minutes", "Never"],
          },
          {
            id: "root-search-sensitivity",
            title: "Root Search Sensitivity",
            description:
              "Search sensitivity controls the number of matching results presented in Root Search. Low sensitivity produces many results for a search term, while high sensitivity displays fewer results.",
            control: "select",
            options: ["Low", "Balanced", "High"],
          },
          {
            id: "reset-search-history",
            title: "Search History",
            description: "Clear recent searches restored when pressing the up arrow in Root Search.",
            control: "action",
            action: "Clear Search History",
          },
          {
            id: "reset-all-rankings",
            title: "Reset All Rankings",
            description: "Clear all learned usage data for apps, files, and commands.",
            control: "action",
            action: "Reset All Rankings",
          },
        ],
      },
      {
        id: "customize-search",
        title: "Customize Search",
        rows: [
          { id: "include-files-in-root-search", title: "Include Files in Root Search", control: "switch", unavailable: true },
          {
            id: "search-file-contents-in-root-search",
            title: "Include File Content search results in Root Search",
            control: "switch",
            unavailable: true,
          },
          { id: "include-contacts-in-root-search", title: "Include Contacts in Root Search", control: "switch", unavailable: true },
          { id: "include-agents-in-root-search", title: "Include Agents in Root Search", control: "switch", unavailable: true },
        ],
      },
      {
        id: "fallback-commands",
        title: "Fallback Commands",
        description: "Commands shown when root search has no results. One per line: Title | Subtitle | URL (URL opens in browser).",
        rows: [
          {
            id: "fallback-commands-list",
            title: "Fallback Commands",
            description: "One per line: Title | Subtitle | URL",
            control: "textarea",
          },
          {
            id: "fallback-commands-enabled",
            title: "Enable Fallback Commands",
            description: "Show fallback commands when no results match.",
            control: "switch",
          },
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Shortcuts",
    description: "Manage command hotkeys and aliases across Raycast.",
    icon: "shortcuts",
    keywords: ["aliases", "applications", "commands", "extensions", "hotkeys", "keybindings", "keyboard", "quicklinks"],
    empty: "Hotkeys and aliases are stored per command. Raycast Mini keeps them with their extension.",
    sections: [],
  },
  {
    id: "keyboard",
    title: "Keyboard",
    description: "Configure keyboard behavior, navigation bindings, input sources, and Hyper Key.",
    icon: "keyboard",
    keywords: ["caps lock", "copilot", "emacs", "escape key", "hyper key", "input source", "keyboard", "navigation", "vim"],
    sections: [
      {
        id: "keyboard",
        title: "Keyboard",
        rows: [
          {
            id: "escape-key-behavior",
            title: "Escape Key Behavior",
            description: "Choose what happens when pressing Escape in the Main window.",
            control: "select",
            options: ["Pop to Root Search", "Close Window"],
            value: "Pop to Root Search",
          },
          {
            id: "escape-key-closes-window",
            title: "Escape Key Closes Window",
            description: "Dismiss windows such as AI Chat, Notes, and Settings by pressing the Escape key.",
            control: "switch",
          },
          {
            id: "auto-switch-input-source",
            title: "Auto-switch Input Source",
            description:
              "Automatically switch to the selected keyboard input source when opening Raycast. The previous input source will be restored when closing.",
            control: "switch",
            unavailable: true,
          },
          {
            id: "navigation-bindings",
            title: "Navigation Bindings",
            description: "Key bindings for quick navigation in supported controls.",
            control: "select",
            options: ["Default", "Vim"],
          },
          {
            id: "page-navigation-keys",
            title: "Page Navigation Keys",
            description: "Key equivalent for navigating back and forward in paginated context.",
            control: "hotkey",
            unavailable: true,
          },
          {
            id: "builtin-hotkeys-preset",
            title: "Built-in Hotkeys Preset",
            control: "select",
            options: ["Restore Defaults"],
            unavailable: true,
          },
          { id: "hyper-key", title: "Hyper Key", control: "switch", unavailable: true },
        ],
      },
    ],
  },
  {
    id: "cloud-sync",
    title: "Cloud Sync",
    description: "Enable cloud sync for settings and content across devices.",
    icon: "cloud-sync",
    keywords: ["backup", "cloud", "raycast pro", "sync"],
    sections: [
      {
        id: "cloud-sync",
        rows: [
          {
            id: "cloud-sync-enabled",
            title: "Cloud Sync",
            description: "Keep settings and content synchronised across devices.",
            control: "switch",
            unavailable: true,
          },
          {
            id: "cloud-sync-synced-devices",
            title: "Synced Devices",
            description: "View devices connected to Cloud Sync.",
            control: "action",
            action: "View Devices",
            unavailable: true,
          },
          {
            id: "cloud-sync-synced-content",
            title: "Synced Content",
            description: "See which content categories are synced across devices.",
            control: "action",
            action: "View Content",
            unavailable: true,
          },
        ],
      },
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Tune advanced behavior, exporting, and connectivity.",
    icon: "advanced",
    keywords: ["backup", "certificate", "connection", "export", "favicon", "proxy", "scheduled backup", "window activation behavior", "tidy menu bar"],
    sections: [
      {
        id: "advanced",
        rows: [
          {
            id: "window-activation-behavior",
            title: "Window Activation Behavior",
            description: "Choose whether Raycast brings windows to your current Space or switches to the Space where they are open.",
            control: "select",
            options: ["Current Space", "Window's Space"],
          },
          {
            id: "favicon-provider",
            title: "Favicon Provider",
            description: "Select the provider used to fetch favicons or None to disable favicon fetching.",
            control: "select",
            options: ["None", "Raycast", "DuckDuckGo", "Google"],
          },
          {
            id: "open-folders-in-tabs",
            title: "Open Folders in Tabs",
            description: "Open folders as new tabs in an existing File Explorer window instead of opening new windows.",
            control: "switch",
          },
        ],
      },
      {
        id: "export",
        title: "Export",
        rows: [
          { id: "export-passphrase", title: "Export Passphrase", control: "action", action: "Set Passphrase", unavailable: true },
          {
            id: "backup-frequency",
            title: "Scheduled Backup",
            description: "Automatically export your Raycast settings and data on a schedule.",
            control: "select",
            options: ["Never", "Daily", "Weekly"],
            pro: true,
            unavailable: true,
          },
          { id: "backup-location", title: "Backup Location", control: "action", action: "Choose Folder", pro: true, unavailable: true },
        ],
      },
      {
        id: "connection",
        title: "Connection",
        rows: [
          {
            id: "use-system-proxy-settings",
            title: "Use System Proxy Settings",
            description: "Automatically use your computer's proxy configuration for network connections.",
            control: "switch",
          },
          {
            id: "additional-certificate-authorities",
            title: "Additional Certificate Authority",
            description: "Choose a certificate file (.crt, .cer, .pem) to trust connections that would otherwise show security warnings or fail.",
            control: "action",
            action: "Choose File",
            unavailable: true,
          },
        ],
      },
    ],
  },
  {
    id: "organizations",
    title: "Organizations",
    description: "Manage organizations, members, and organization settings.",
    icon: "organizations",
    keywords: ["invite", "members", "organization", "org", "team", "teams", "webhooks"],
    empty: "Organizations require a signed-in Raycast account.",
    sections: [],
  },
  {
    id: "clipboard-history",
    title: "Clipboard History",
    description:
      "Search for text, images, links and colors you copied earlier and paste it again.",
    icon: "copy-clipboard",
    keywords: [
      "clipboard", "history", "retention", "keep history", "duration", "prune", "ignored apps",
      "ignore apps", "excluded apps", "duplicate", "ocr", "recognition", "tags",
    ],
    sections: [
      {
        id: "clipboard-history",
        rows: [
          {
            id: "clipboard-history-hotkey",
            title: "Clipboard History Hotkey",
            description: "Open Clipboard History directly from anywhere.",
            control: "hotkey",
            value: "Ctrl + Shift + V",
          },
          {
            id: "clipboard-keep-history-for",
            title: "Keep history for",
            description: "How long clipboard entries are kept before they are pruned.",
            control: "select",
            options: HISTORY_DURATION_LABELS,
          },
          {
            id: "clipboard-text-recognition",
            title: "Text Recognition",
            description: "Text content in images will be automatically extracted and can be searched.",
            control: "switch",
          },
          {
            id: "clipboard-recognition-mode",
            title: "Recognition Mode",
            description:
              "Choose between faster processing or more accurate text recognition. Accurate mode uses more CPU resources.",
            control: "select",
            options: ["Fast", "Accurate"],
          },
          {
            id: "clipboard-ignore-duplicate",
            title: "Ignore Duplicates",
            description:
              "When a copy matches an entry you already have, leave the history alone instead of counting it again.",
            control: "switch",
          },
        ],
      },
      {
        id: "clipboard-behaviour",
        title: "Behaviour",
        rows: [
          {
            id: "clipboard-primary-action",
            title: "Primary Action",
            description: "What Enter does on a clipboard entry: paste it, or put it on the clipboard.",
            control: "select",
            options: ["Paste", "Copy"],
          },
          {
            id: "clipboard-prefer-plain-text",
            title: "Prefer Pasting as Plain Text",
            description:
              "Paste the plain-text form of a rich entry, dropping its HTML and RTF representations.",
            control: "switch",
          },
          {
            id: "clipboard-show-link-visuals",
            title: "Show Link Visual Information",
            description: "Show a link's favicon and domain alongside link entries.",
            control: "switch",
          },
          {
            id: "clipboard-update-history-after-action",
            title: "Update History After Action",
            description: "Move an entry to the top and count the copy after it is pasted or copied.",
            control: "switch",
          },
          {
            id: "clipboard-add-newline-after-paste",
            title: "Add a New Line After Pasting Text",
            description: "Append a line break to each entry pasted by Paste Sequentially.",
            control: "switch",
          },
          {
            id: "clipboard-paste-sequence-timeout",
            title: "Paste Sequence Timeout",
            description:
              "Seconds of inactivity after which Paste Sequentially starts again from the newest entry.",
            control: "text",
          },
        ],
      },
      {
        id: "clipboard-filters",
        title: "Filters",
        description: "Copying from a matching application tags new entries automatically.",
        rows: [
          {
            id: "clipboard-filters",
            title: "Applications and their tags",
            description:
              "One rule per line as `app.exe: tag1, tag2`, prefixed with `-` to disable it. For example `chrome.exe: work, browser`",
            control: "textarea",
          },
        ],
        empty: "No filters are configured. Every copy is stored without extra tags.",
      },
      {
        id: "clipboard-ignored-applications",
        title: "Disabled Applications",
        rows: [
          {
            id: "clipboard-ignored-applications",
            title: "Clipboard changes from these applications will not be recorded.",
            description:
              "One executable name, `*` pattern or window class per line. For example KeePassXC.exe, chrome*.exe or Chrome_WidgetWin_1",
            control: "textarea",
          },
        ],
        empty: "No applications are excluded. Clipboard changes from every application are recorded.",
      },
      {
        id: "clipboard-maintenance",
        title: "Maintenance",
        rows: [
          {
            id: "clipboard-run-maintenance",
            title: "Run Maintenance Now",
            description:
              "Prunes expired entries, drops entries whose source files are gone, and removes orphaned cached files.",
            control: "action",
            action: "Run Maintenance",
          },
        ],
      },
    ],
  },
  {
    id: "internal",
    title: "Internal",
    description: "Development-only toggles and internal debugging settings.",
    icon: "internal",
    keywords: ["debug", "developer", "feature flags", "internal", "preload", "worker", "raycast api environment"],
    empty: "No internal settings are available in this build of Raycast Mini.",
    sections: [],
  },
  {
    id: "remote",
    title: "Remote",
    description: "Connect an iPhone to run AI chats through this computer.",
    icon: "remote",
    keywords: ["computer", "iphone", "pair", "remote", "x-ray"],
    sections: [
      {
        id: "remote",
        rows: [
          {
            id: "remote-chat-enabled",
            title: "Available to iPhone",
            description: "Allow AI Chat on your iPhone to run through Raycast on this computer.",
            control: "switch",
            unavailable: true,
          },
          {
            id: "remote-chat-device-name",
            title: "Computer Name",
            description: "The name shown when choosing this computer on iPhone.",
            control: "select",
            options: [HOST_NAME],
            unavailable: true,
          },
          {
            id: "remote-chat-keep-available",
            title: "Keep This Computer Available",
            description: "Prevent idle system sleep so this computer remains available for remote chats.",
            control: "switch",
            unavailable: true,
          },
          { id: "remote-chat-pair-phone", title: "Connect iPhone", description: "Scan a short-lived QR code in Raycast for iPhone to connect it to this computer.", control: "action", action: "Pair iPhone", unavailable: true },
          { id: "remote-chat-diagnostics", title: "Remote Diagnostics", description: "Copy a privacy-safe connection report for troubleshooting Remote AI Chat.", control: "action", action: "Copy Diagnostics", unavailable: true },
        ],
      },
    ],
  },
  {
    id: "about",
    title: "About",
    description: "Check for updates, view links, and open feedback destinations.",
    icon: "about",
    keywords: ["changelog", "community", "feedback", "support", "updates", "version", "website"],
    sections: [
      {
        id: "about",
        rows: [
          { id: "raycast-updates", title: "Raycast Updates", control: "action", action: "Check for Updates", value: VERSION },
          { id: "open-changelog", title: "Open Changelog", control: "action", action: "Open Changelog" },
          { id: "website", title: "Website", control: "action", action: "raycast.com" },
          { id: "slack-community", title: "Slack Community", control: "action", action: "Join Slack" },
          { id: "send-feedback", title: "Send Feedback", control: "action", action: "Send Email" },
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Account",
    description: "Manage your Raycast account, AI usage, credits, and plan.",
    icon: "account",
    keywords: ["account", "balance", "credits", "login", "logout", "pricing", "pro", "sign in", "sign out", "usage"],
    sections: [
      {
        id: "account-section",
        title: "Account",
        rows: [
          { id: "sign-in", title: "Sign In", description: "Sign in to sync settings and unlock Pro features.", control: "action", action: "Sign In" },
          { id: "manage-account", title: "Manage Account", control: "action", action: "Manage Account", unavailable: true },
          { id: "sign-out", title: "Sign Out", control: "action", action: "Sign Out", unavailable: true },
        ],
      },
    ],
  },
];


const ACCOUNT_PAGE_ID = "account";
const SIDEBAR_PAGE_IDS = [
  "general",
  "launcher",
  "shortcuts",
  "keyboard",
  "clipboard-history",
  "cloud-sync",
  "advanced",
  "organizations",
  "internal",
  "remote",
  "about",
];

// ---------------------------------------------------------------------------------------------
// Persisted settings — Raycast keeps these in its own settings store; the clone uses
// localStorage so toggles survive a window reload.
// ---------------------------------------------------------------------------------------------

const STORAGE_KEY = "raycast-mini:settings";
type SettingsValue = boolean | string | number;
type SettingsMap = Record<string, SettingsValue>;

/** Clipboard rows persist to the Node store, not localStorage, so every reader sees one value. */
const CLIPBOARD_ROW_IDS = new Set([
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

const DEFAULTS: SettingsMap = {
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
};

const SENSITIVITY_MAP: Record<string, Sensitivity> = {
  "Low": "low",
  "Balanced": "medium",
  "High": "high",
};

/** `textarea` row id -> the store handler and payload key it maps onto. */
const CLIPBOARD_TEXTAREA_ROW: Record<string, { method: string; field: string }> = {
  "clipboard-ignored-applications": { method: "clipboard.setIgnoredApplications", field: "applications" },
  "clipboard-filters": { method: "clipboard.setFiltersFromText", field: "text" },
};

/** Parses the filters textarea back into rules; mirrors `formatFilterRows`. */
function parseFilterRows(text: string): ClipboardFilter[] {
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
interface ClipboardFilter {
  sourceUrl: string;
  tags: string[];
  enabled: boolean;
}

/**
 * The filters textarea's wire format: `app.exe: tag1, tag2`, with a leading `-` marking a disabled
 * rule. Keeping it a single text field matches how Raycast exposes the same data as a per-app list while
 * staying editable without a second view.
 */
function formatFilterRows(filters: ClipboardFilter[]): string {
  return filters
    .map((filter) => `${filter.enabled ? "" : "-"}${filter.sourceUrl}: ${filter.tags.join(", ")}`)
    .join("\n");
}

function parseFallbackCommands(text: string, enabled: boolean): FallbackCommand[] {
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

interface FallbackCommand {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  action: (query: string) => void;
}

/** Single-row clipboard settings, each mapping onto one `clipboard.setPreference` key. */
const CLIPBOARD_PREFERENCE_ROWS: Record<string, { key: string; value: (raw: SettingsValue) => unknown }> = {
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

const HISTORY_DURATION_BY_LABEL: Record<string, string> = {
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

function loadSettings(): SettingsMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as SettingsMap;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistSettings(values: SettingsMap): void {
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

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="settings-switch"
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch__knob" />
    </button>
  );
}

function RadioGroup({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="settings-radio" role="radiogroup">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className="settings-radio__item"
          data-active={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * Raycast's dropdown: a `dropdown-button` (label + chevron that flips while open) that opens a
 * blurred menu popover anchored to its right edge, like `dropdown-button__*` + `select__popover`.
 */
function Dropdown({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const current = options.includes(value) ? value : options[0];

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open]);

  return (
    <span className="settings-dropdown" ref={rootRef}>
      <button
        type="button"
        className="settings-dropdownButton"
        data-state={open ? "open" : "closed"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="settings-dropdownButton__text">{current}</span>
        <span className="settings-dropdownButton__indicator">
          <RaycastIcon name="Forward" size={12} />
        </span>
      </button>
      {open ? (
        <div className="settings-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === current}
              className="settings-menu__item"
              data-selected={option === current}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** One key cap: Raycast's `keyboard-shortcut-recorder__keyButton` / `visual-shortcut__root`. */
function KeyCap({ children, uppercase }: { children: ReactNode; uppercase?: boolean }) {
  return (
    <span className="settings-keyChip" data-uppercase={uppercase ? "true" : undefined}>
      {children}
    </span>
  );
}

/** Renders "Ctrl + Alt + Space" as Raycast's key caps. */
function VisualShortcut({ shortcut }: { shortcut: string }) {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  return (
    <span className="settings-recorder__keys">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} style={{ display: "inline-flex" }}>
          <KeyCap uppercase={part.length === 1}>{part}</KeyCap>
        </span>
      ))}
    </span>
  );
}

// Raycast cycles these while the recorder has nothing to show yet.
const HOTKEY_TYPE_HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "⌘", "A"], label: "Single Step" },
  { keys: ["⌘"], label: "Single Key" },
  { keys: ["Ctrl", "Ctrl"], label: "Double Tap" },
];

/**
 * Raycast's `KeyboardShortcutRecorder`: the row shows the current hotkey as key caps, clicking it
 * opens a 320px popover above the trigger that records the next key combination and reports the
 * result (saved / conflict) with a command-panel footer.
 */
function HotkeyRecorder({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<"saved" | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      setRecording(false);
      return;
    }

    let timer = 0;
    if (!recording) {
      // Raycast rotates the example shortcuts every 1.8s while nothing is being recorded.
      timer = window.setInterval(() => setHintIndex((index) => (index + 1) % HOTKEY_TYPE_HINTS.length), 1800);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const key = event.key;
      if (key === "Escape") {
        setOpen(false);
        setRecording(false);
        return;
      }
      if (!recording) return;
      if (key === "Backspace" || key === "Delete") {
        onChange("");
        setOpen(false);
        return;
      }
      const parts: string[] = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Alt");
      if (event.shiftKey) parts.push("Shift");
      if (event.metaKey) parts.push("Win");
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      onChange(parts.join(" + "));
      setRecording(false);
      setFlash("saved");
      window.setTimeout(() => setFlash(null), 200);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, recording, onChange]);

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open]);

  const variant = flash ?? "idle";

  return (
    <span className="settings-dropdown settings-hotkeyContainer" ref={rootRef}>
      <button
        type="button"
        className="settings-hotkeyButton"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {value ? (
          <VisualShortcut shortcut={value} />
        ) : (
          <span className="settings-dropdownButton__text">Record Hotkey</span>
        )}
      </button>

      {open ? (
        <div className="settings-recorder" data-variant={variant} role="dialog" aria-label="Record hotkey">
          <div className="settings-recorder__content">
            {recording ? (
              <>
                <span className="settings-recorder__message">Press keys…</span>
                <span className="settings-recorder__keys">
                  <KeyCap>…</KeyCap>
                </span>
              </>
            ) : value ? (
              <>
                <span className="settings-recorder__message">Press Backspace to delete</span>
                <VisualShortcut shortcut={value} />
                <span className="settings-recorder__message">or record a new hotkey</span>
              </>
            ) : (
              <>
                <span className="settings-recorder__message">e.g.</span>
                <span className="settings-recorder__keys">
                  {HOTKEY_TYPE_HINTS[hintIndex].keys.map((key, index) => (
                    <KeyCap key={`${key}-${index}`} uppercase={key.length === 1}>
                      {key}
                    </KeyCap>
                  ))}
                </span>
                <span className="settings-recorder__message">{HOTKEY_TYPE_HINTS[hintIndex].label}</span>
              </>
            )}
          </div>

          <div className="settings-recorder__footer">
            <span className="settings-recorder__info">Record Hotkey</span>
            <span className="settings-recorder__actions">
              <button
                type="button"
                className="settings-recorder__action"
                onClick={() => {
                  setOpen(false);
                  setRecording(false);
                }}
              >
                Close
                <KeyCap>Esc</KeyCap>
              </button>
              {!recording ? (
                <button
                  type="button"
                  className="settings-recorder__action"
                  onClick={() => setRecording(true)}
                >
                  Record
                  <KeyCap>↵</KeyCap>
                </button>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------------------------

/** Raycast's `input-field-primitive`: leading icon + borderless input in a rounded 32px shell. */
function SearchField({
  value,
  placeholder,
  onChange,
  onEscape,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onEscape?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="settings-input" data-state={focused ? "focus" : "blur"}>
      <span className="settings-input__icon">
        <RaycastIcon name="magnifying-glass" size={15} />
      </span>
      <input
        className="settings-input__input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscape) {
            event.preventDefault();
            onEscape();
          }
        }}
      />
    </div>
  );
}

interface SearchResult {
  pageId: string;
  rowId?: string;
  title: string;
  /** Group header: the row's page when the result is a row. */
  group: string;
  description?: string;
}

function searchResults(query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  for (const page of PAGES) {
    if (page.title.toLowerCase().includes(needle)) {
      results.push({ pageId: page.id, title: page.title, group: "Settings" });
    }
    for (const section of page.sections) {
      for (const row of section.rows) {
        const haystack = [row.title, row.description ?? "", page.title].join(" ").toLowerCase();
        if (haystack.includes(needle)) {
          results.push({
            pageId: page.id,
            rowId: row.id,
            title: row.title,
            group: `${page.title}${section.title ? ` / ${section.title}` : ""}`,
            description: row.description,
          });
        }
      }
    }
  }
  return results;
}

function SidebarLink({
  pageId,
  title,
  active,
  onNavigate,
}: {
  pageId: string;
  title: string;
  active: boolean;
  onNavigate: (pageId: string) => void;
}) {
  const page = PAGES.find((candidate) => candidate.id === pageId);
  return (
    <a
      className="settings-navlink"
      href={`#/${pageId}`}
      data-active={active}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(pageId);
      }}
    >
      <span className="settings-navlink__icon">
        <RaycastIcon name={page?.icon ?? "cog"} size={16} />
      </span>
      <span className="settings-navlink__label">{title}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------------------------

export function Settings() {
  const [values, setValues] = useState<SettingsMap>(() => loadSettings());
  const [query, setQuery] = useState("");

  const [route, setRoute] = useState<string>(() => window.location.hash.replace(/^#\/?/, "") || "general");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace(/^#\/?/, "") || "general");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((pageId: string) => {
    window.location.hash = `#/${pageId}`;
    setRoute(pageId);
    setQuery("");
  }, []);

  // The clipboard rows live in the Node store; mirror them into the local map so the same Row
  // component renders them, but write through to the backend instead of localStorage.
  const [clipboardSettings, setClipboardSettings] = useState({
    historyDuration: "P1W",
    ignoreDuplicate: false,
    ignoredApplications: [] as Array<{ name: string; className?: string }>,
    filters: [] as ClipboardFilter[],
  });

  useEffect(() => {
    ipc
      .backend("clipboard.getSettings", {}, { module: "backend" })
      .then((response) => {
        const settings = response as {
          historyDuration?: string;
          ignoreDuplicate?: boolean;
          ignoredApplications?: Array<{ name: string; className?: string }>;
        };
        const label =
          Object.entries(HISTORY_DURATION_BY_LABEL).find(([, value]) => value === settings.historyDuration)?.[0] ??
          "1 Week";
        setClipboardSettings((current) => ({
          ...current,
          historyDuration: settings.historyDuration ?? "P1W",
          ignoreDuplicate: Boolean(settings.ignoreDuplicate),
          ignoredApplications: settings.ignoredApplications ?? [],
        }));
        setValues((current) => {
          const merged = {
            ...current,
            "clipboard-keep-history-for": label,
            "clipboard-ignore-duplicate": Boolean(settings.ignoreDuplicate),
            // A line carrying only a class name is rendered with the class-name marker so the round trip
            // through this field does not silently turn it into an executable name.
            "clipboard-ignored-applications": (settings.ignoredApplications ?? [])
              .map((application) => (application.className && !application.name
                ? `#${application.className}`
                : application.name))
              .filter(Boolean)
              .join("\n"),
          };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* the backend may not be up yet; the defaults stay in place */
      });

    ipc
      .backend("clipboard.getFilters", {}, { module: "backend" })
      .then((response) => {
        const filters = (response as { filters?: ClipboardFilter[] }).filters ?? [];
        setClipboardSettings((current) => ({ ...current, filters }));
        setValues((current) => {
          const merged = { ...current, "clipboard-filters": formatFilterRows(filters) };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* no filters yet */
      });
  }, []);

// Migrate localStorage usage data to backend on first run
  useEffect(() => {
    const migrationDone = localStorage.getItem("raycast-mini:usage-migrated");
    if (migrationDone) return;
    
    const usageData: Record<string, string> = {};
    const fileUsageData: Record<string, string> = {};
    const argumentHistoryData: Record<string, string> = {};
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (!value) continue;
        if (key.startsWith("raycast-mini:usage:")) {
          usageData[key.slice("raycast-mini:usage:".length)] = value;
        } else if (key?.startsWith("raycast-mini:file-usage:")) {
          fileUsageData[key.slice("raycast-mini:file-usage:".length)] = value;
        } else if (key?.startsWith("raycast-mini:argument-history:")) {
          argumentHistoryData[key.slice("raycast-mini:argument-history:".length)] = value;
        }
      }
    } catch {
      // Ignore errors
    }
    
    if (Object.keys(usageData).length > 0 || Object.keys(fileUsageData).length > 0 || Object.keys(argumentHistoryData).length > 0) {
      void ipc.backend("usage.migrateFromLocalStorage", { data: { usageData, fileUsageData, argumentHistoryData } }, { module: "backend" })
        .then(() => {
          localStorage.setItem("raycast-mini:usage-migrated", "true");
        })
        .catch(() => {
          // Ignore migration errors
        });
    }
  }, []);

  const setValue = useCallback((id: string, next: SettingsValue) => {
    setValues((current) => {
      const merged = { ...current, [id]: next };
      persistSettings(merged);
      return merged;
    });

    if (!CLIPBOARD_ROW_IDS.has(id)) {
      if (id === "root-search-sensitivity") {
        const sensitivity = SENSITIVITY_MAP[String(next)] ?? "medium";
        localStorage.setItem("raycast-mini:root-search-sensitivity", sensitivity);
        window.dispatchEvent(new CustomEvent("raycast-mini:root-search-sensitivity-changed", { detail: sensitivity }));
      }
      if (id === "fallback-commands-list" || id === "fallback-commands-enabled") {
        const list = values["fallback-commands-list"] ?? "";
        const enabled = values["fallback-commands-enabled"] ?? true;
        const commands = parseFallbackCommands(String(list), Boolean(enabled));
        localStorage.setItem("raycast-mini:fallback-commands", JSON.stringify(commands));
        window.dispatchEvent(new CustomEvent("raycast-mini:fallback-commands-changed", { detail: commands }));
      }
      return;
    }
    if (id === "clipboard-history-hotkey") {
      // The recorder's key caps are the source of truth; the host re-registers the global hotkey.
      void ipc.backend("clipboard.setHotkey", { hotkey: String(next) }, { module: "backend" });
      return;
    }
    if (id === "clipboard-keep-history-for") {
      const duration = HISTORY_DURATION_BY_LABEL[String(next)] ?? "P1W";
      void ipc.backend("clipboard.setHistoryDuration", { duration }, { module: "backend" });
      setClipboardSettings((current) => ({ ...current, historyDuration: duration }));
      return;
    }
    if (id === "clipboard-ignore-duplicate") {
      const enabled = Boolean(next);
      void ipc.backend("clipboard.setIgnoreDuplicate", { enabled }, { module: "backend" });
      setClipboardSettings((current) => ({ ...current, ignoreDuplicate: enabled }));
      return;
    }
    if (id === "clipboard-ignored-applications") {
      // A `#` prefix marks a window class name, which Raycast matches through `IgnoredClassNames`
      // rather than against the executable file name.
      const applications = String(next)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) =>
          line.startsWith("#") ? { name: "", className: line.slice(1).trim() } : { name: line },
        )
        .filter((application) => application.name || application.className);
      void ipc
        .backend("clipboard.setIgnoredApplications", { applications }, { module: "backend" })
        .then(() => setClipboardSettings((current) => ({ ...current, ignoredApplications: applications })));
      return;
    }
    if (id === "clipboard-filters") {
      const filters = parseFilterRows(String(next));
      void ipc
        .backend("clipboard.setFiltersFromText", { text: String(next) }, { module: "backend" })
        .then(() => setClipboardSettings((current) => ({ ...current, filters })));
      return;
    }
    const preference = CLIPBOARD_PREFERENCE_ROWS[id];
    if (!preference) return;
    void ipc
      .backend(
        "clipboard.setPreference",
        { key: preference.key, value: preference.value(next) },
        { module: "backend" },
      )
      .catch((error: unknown) => {
        window.dispatchEvent(
          new CustomEvent("raycast-mini:settings-toast", {
            detail: {
              title: "Couldn't save that setting",
              message: error instanceof Error ? error.message : undefined,
            },
          }),
        );
      });
  }, []);

  const runAction = useCallback((id: string) => {
    if (id === "clipboard-run-maintenance") {
      void ipc
        .backend("clipboard.runMaintenance", {}, { module: "backend" })
        .then((response) => {
          const report = response as { cache?: { deletedEntries?: number; removedFiles?: number }; pruned?: number };
          const pruned = report.pruned ?? 0;
          const removed = report.cache?.deletedEntries ?? 0;
          const files = report.cache?.removedFiles ?? 0;
          window.dispatchEvent(
            new CustomEvent("raycast-mini:settings-toast", {
              detail: {
                title: "Maintenance finished",
                message: `${pruned} pruned, ${removed} entries dropped, ${files} cached files removed.`,
              },
            }),
          );
        });
    }
  }, []);

  const page = useMemo(() => PAGES.find((candidate) => candidate.id === route) ?? PAGES[0], [route]);
  const results = useMemo(() => searchResults(query), [query]);

  return (
    <div className="settings-window">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__titlebar">
          <span className="settings-sidebar__titletext">Settings</span>
        </div>

        <div className="settings-sidebar__search">
          {/* Raycast's `input-field-primitive`: 32px tall, rounded, 5% white fill, leading icon. */}
          <SearchField
            value={query}
            placeholder="Search settings"
            onChange={setQuery}
            onEscape={() => setQuery("")}
          />
        </div>

        <div className="settings-sidebar__scroll">
          {results.length > 0 ? (
            <div className="settings-sidebar__content" data-searching="true">
              {results.map((result) => (
                <button
                  key={`${result.pageId}:${result.rowId ?? result.title}`}
                  type="button"
                  className="settings-navlink settings-navlink--result"
                  onClick={() => navigate(result.pageId)}
                >
                  <span className="settings-navlink__icon">
                    <RaycastIcon name={result.rowId ? "chevron-right" : (PAGES.find((p) => p.id === result.pageId)?.icon ?? "cog")} size={14} />
                  </span>
                  <span className="settings-navlink__text">
                    <span className="settings-navlink__label">{result.title}</span>
                    <span className="settings-navlink__group">{result.group}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="settings-sidebar__content">
              {/* Raycast pulls the account link out of the page list and pins it on top. */}
              <SidebarLink
                pageId={ACCOUNT_PAGE_ID}
                title="Account"
                active={route === ACCOUNT_PAGE_ID || route.startsWith(`${ACCOUNT_PAGE_ID}/`)}
                onNavigate={navigate}
              />

              <div className="settings-sidebar__section">
                {SIDEBAR_PAGE_IDS.map((pageId) => {
                  const definition = PAGES.find((candidate) => candidate.id === pageId)!;
                  return (
                    <SidebarLink
                      key={pageId}
                      pageId={pageId}
                      title={definition.title}
                      active={route === pageId}
                      onNavigate={navigate}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="settings-main">
        <header className="settings-navigationHeader">
          <div className="settings-navigationHeader__breadcrumbs">
            <span className="settings-navigationHeader__crumb">Settings</span>
            <RaycastIcon name="ArrowRight" size={12} />
            <span className="settings-navigationHeader__crumb settings-navigationHeader__crumb--current">{page.title}</span>
          </div>
        </header>

        <div className="settings-page__scroll">
          <div className="settings-page">
            <div className="settings-page__heading">
              <h1 className="settings-page__title">{page.title}</h1>
              <p className="settings-page__description">{page.description}</p>
            </div>

            {page.sections.length === 0 || page.sections.every((section) => section.rows.length === 0) ? (
              <div className="settings-page__empty">{page.empty ?? "No settings available."}</div>
            ) : (
              page.sections.map((section) =>
                section.rows.length === 0 ? null : (
                  <section className="settings-section" key={section.id}>
                    {section.title ? <h2 className="settings-section__title">{section.title}</h2> : null}
                    {section.description ? (
                      <p className="settings-section__description">{section.description}</p>
                    ) : null}
                    <div className="settings-section__content">
                      {section.rows.map((row) => (
                        <Row
                          key={row.id}
                          row={row}
                          value={values[row.id]}
                          onValueChange={(next) => setValue(row.id, next)}
                          onAction={() => runAction(row.id)}
                        />
                      ))}
                    </div>
                    {section.empty ? <p className="settings-section__empty">{section.empty}</p> : null}
                  </section>
                ),
              )
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({
  row,
  value,
  onValueChange,
  onAction,
}: {
  row: RowDefinition;
  value: SettingsValue | undefined;
  onValueChange: (next: SettingsValue) => void;
  onAction: () => void;
}) {
  const right = () => {
    switch (row.control) {
      case "switch":
        return (
          <Switch
            label={row.title}
            checked={Boolean(value)}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "select":
        return (
          <Dropdown
            label={row.title}
            value={String(value ?? row.options?.[0] ?? "")}
            options={row.options ?? []}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "radio":
        return (
          <RadioGroup
            value={String(value ?? row.options?.[0] ?? "")}
            options={row.options ?? []}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "hotkey":
        return (
          <HotkeyRecorder
            value={String(value ?? row.value ?? "")}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "textarea":
        return (
          <textarea
            className="settings-textarea"
            aria-label={row.title}
            placeholder={row.description}
            value={String(value ?? "")}
            disabled={row.unavailable}
            onChange={(event) => onValueChange(event.target.value)}
          />
        );
      case "text":
        return (
          <input
            className="settings-textfield"
            aria-label={row.title}
            inputMode="numeric"
            value={String(value ?? "")}
            disabled={row.unavailable}
            onChange={(event) => onValueChange(event.target.value)}
          />
        );
      case "action":
        return (
          <span className="settings-row__actions">
            {row.value ? <span className="settings-row__value">{row.value}</span> : null}
            <button
              type="button"
              className="settings-button"
              disabled={row.unavailable}
              onClick={() => {
                onAction();
                void runRowAction(row);
              }}
            >
              {row.action}
            </button>
          </span>
        );
      case "info":
        return <span className="settings-row__value">{row.value}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="settings-row" data-row-id={row.id} data-align={row.description ? "start" : "center"}>
      <div className="settings-row__column">
        <span className="settings-row__title">
          {row.title}
          {row.pro ? <span className="settings-row__pro">Pro</span> : null}
        </span>
        {row.description ? (
          <span className="settings-row__description" data-settings-description>
            {row.description}
          </span>
        ) : null}
        {row.unavailable ? <span className="settings-row__unavailable">Not available in Raycast Mini</span> : null}
      </div>
      <div className="settings-row__right" data-settings-accessory>
        {right()}
      </div>
    </div>
  );
}

/** Rows whose "action" is a real link or a no-op with a visible outcome. */
function runRowAction(row: RowDefinition): void {
  const links: Record<string, string> = {
    website: "https://www.raycast.com",
    "slack-community": "https://raycast.com/community",
    "open-changelog": "https://www.raycast.com/changelog",
    "send-feedback": "mailto:support@raycast.com",
  };
  const target = links[row.id];
  if (target) window.open(target, "_blank", "noopener");

  if (row.id === "reset-search-history") {
    // Clear search history from localStorage
    localStorage.removeItem("raycast-mini:search-history");
    window.dispatchEvent(
      new CustomEvent("raycast-mini:settings-toast", {
        detail: { title: "Search history cleared" },
      }),
    );
    return;
  }

  if (row.id === "reset-all-rankings") {
    // Reset all usage rankings via backend
    void ipc
      .backend("usage.resetAllAppUsage", {}, { module: "backend" })
      .then(() => {
        window.dispatchEvent(
          new CustomEvent("raycast-mini:settings-toast", {
            detail: { title: "All rankings reset" },
          }),
        );
      })
      .catch(() => {
        window.dispatchEvent(
          new CustomEvent("raycast-mini:settings-toast", {
            detail: { title: "Failed to reset rankings" },
          }),
        );
      });
    return;
  }
}
