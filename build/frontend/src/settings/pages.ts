// The Settings page catalog: the model Raycast's `settings-page-definition-utils` produces and
// the full page definitions (titles, descriptions, sections, rows, keywords) for the sidebar.

import { WM_COMMANDS } from "../wm-commands";

export type SettingsValue = boolean | string | number;
export type SettingsMap = Record<string, SettingsValue>;

export type ControlKind =
  | "switch"
  | "select"
  | "radio"
  | "hotkey"
  | "action"
  | "info"
  | "textarea"
  | "textarea-commit"
  | "text"
  | "none";/** The version the launcher reports everywhere else, kept in one place. */
export const VERSION = "2.4.0.0";
export const HOST_NAME = "This Computer";
export interface RowDefinition {
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
  /** Hidden until the predicate passes (e.g. the Injection Delay row needs the Immediately mode). */
  visibleWhen?: (values: SettingsMap) => boolean;
}

export interface SectionDefinition {
  id: string;
  title?: string;
  /** Shown under the section header, in Raycast's muted style. */
  description?: string;
  rows: RowDefinition[];
  /** Shown instead of the card when the section has no rows to render. */
  empty?: string;
}

// The confirmed Window Management option lists (the shipped `Qt`/`$t` maps and the preset menu).
export const WM_GAP_OPTION_LABELS = ["None", "Tiny", "Small", "Medium", "Large", "Extra Large"] as const;
export const WM_CYCLE_OPTION_LABELS = ["None", "Cycle ½, ⅔, and ⅓", "Cycle Displays"] as const;
export const WM_PRESET_OPTION_LABELS = ["None", "Magnet", "Rectangle"] as const;

export interface PageDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  sections: SectionDefinition[];
  keywords: string[];
  /** Shown when the page has no renderable sections at all. */
  empty?: string;
}

export const DARK_THEMES = ["Raycast Dark", "Midnight", "Sky", "Sunset"] as const;
export const LIGHT_THEMES = ["Raycast Light", "Dawn", "Overcast", "Noon"] as const;
export const WINDOW_MODES = ["Compact", "Expanded"] as const;
export const INTERFACE_SIZES = ["Default", "Large", "Larger"] as const;

/**
 * Raycast's `keep-history-for` options (`Vlo`), with every Pro tier unlocked because gating is out of
 * scope for this clone.
 */
export const HISTORY_DURATION_LABELS = [
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

export const PAGES: readonly PageDefinition[] = [
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
          { id: "include-files-in-root-search", title: "Include Files in Root Search", control: "switch" },
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
    id: "quicklinks",
    title: "Quicklinks",
    description: "Configure Quicklinks behavior and command settings.",
    icon: "link",
    keywords: [
      "quicklinks", "link previews", "tabs", "quicklinks", "selected text", "argument", "hotkey", "quick search",
    ],
    sections: [
      {
        id: "quicklinks",
        rows: [
          {
            id: "quicklinks-pass-selected-text",
            title: "Pass Selected Text as Argument",
            description:
              "When enabled, Raycast will automatically pass selected text from the active application to Quicklinks with a single argument when invoked via hotkey.",
            control: "switch",
          },
          {
            id: "quicklinks-warn-before-delete",
            title: "Show Warning Before Deleting Quicklinks",
            description: "Ask for confirmation before a quicklink is deleted.",
            control: "switch",
          },
        ],
      },
    ],
  },
  {
    id: "snippets",
    title: "Snippets",
    description: "Snippets provide quick access to short snippets of text, code, etc..",
    icon: "blank-document",
    keywords: ["completion sound", "injection delay", "snippet expansion", "snippets"],
    sections: [
      {
        id: "snippet-expansion",
        title: "Snippet Expansion",
        rows: [
          {
            id: "snippets-enable-expansion",
            title: "Enable Snippet Expansion",
            control: "switch",
          },
          {
            id: "snippets-expansion-mode",
            title: "Expansion Mode",
            control: "select",
            options: ["Immediately", "After Delimiter (keeping)", "After Delimiter (discarding)"],
          },
          {
            id: "snippets-expand-within-words",
            title: "Expand within Words",
            description:
              "If toggled off, a Snippet will only get expanded if the keyword is a single word. If toggled on, a Snippet keyword can be part of a wider word.",
            control: "switch",
          },
          {
            id: "snippets-injection-delay",
            title: "Injection Delay",
            description:
              "Injection delays serve two purposes: It lets you write words containing a snippet keyword without expanding that snippet, and it lets you have snippets with similar prefixes. For example, you might have a snippet with keyword '@@' to expand your email and another snippet with keyword '@@p' for the email of your partner.",
            control: "select",
            options: ["None", "Short", "Regular", "Long", "Extra Long"],
            visibleWhen: (values) => String(values["snippets-expansion-mode"] ?? "Immediately") === "Immediately",
          },
          {
            id: "snippets-response-time",
            title: "Response Time",
            description:
              "Some systems are capable of faster response times processing clipboard entries. If Raycast doesn't expand your snippets correctly, slower response times might help.",
            control: "select",
            options: ["Instant", "Quick", "Default", "Delayed", "Extended"],
          },
          {
            id: "snippets-completion-sound",
            title: "Completion Sound",
            description: "Play a sound when a snippet is expanded automatically.",
            control: "select",
            options: ["None", "Asterisk", "Beep", "Exclamation", "Hand", "Question"],
          },
          {
            id: "snippets-disabled-applications",
            title: "Disabled Applications",
            description: "Snippet expansion will not work in these applications.",
            control: "textarea",
          },
        ],
      },
      {
        id: "snippet-behaviour",
        title: "Behaviour",
        rows: [
          {
            id: "snippets-primary-action",
            title: "Primary Action",
            description: "What Enter does on a snippet in Search Snippets.",
            control: "select",
            options: ["Paste to Active App", "Copy to Clipboard"],
          },
          {
            id: "snippets-warn-before-delete",
            title: "Show Warning Before Deleting Snippets",
            description: "Ask for confirmation before a snippet is deleted.",
            control: "switch",
          },
        ],
      },
    ],
  },
  {
    id: "calculator",
    title: "Calculator",
    description: "Calculate numbers and expressions.",
    icon: "calculator",
    keywords: ["calculator", "color", "hex", "pixels", "rem", "em", "syntax highlighting", "flight tracker"],
    sections: [
      {
        id: "calculator-conversion",
        title: "Conversion",
        rows: [
          {
            id: "calculator-rem-to-px",
            title: "REM/EM to Pixel Conversion",
            description: "How many pixels one rem/em is worth when converting between rem/em and pixels.",
            control: "text",
          },
        ],
      },
    ],
  },
  {
    id: "translator",
    title: "Translator",
    description: "Translate any text into other languages.",
    icon: "Globe",
    keywords: ["translator", "translate", "translation", "language", "languages", "detect language"],
    sections: [
      {
        id: "translator-general",
        title: "General",
        rows: [
          {
            id: "translator-primary-action",
            title: "Primary Action",
            description: "The default action for the Translator command.",
            control: "select",
            options: ["Copy Translation", "Paste to Active App"],
          },
          {
            id: "translator-prefill-from-selected-text",
            title: "Use Selected Text as Source",
            description:
              "When enabled, selected text from the foremost app will be filled as the source text.",
            control: "switch",
          },
        ],
      },
      {
        id: "translator-languages",
        title: "Languages",
        rows: [
          {
            id: "translator-default-source-language",
            title: "Default Source Language",
            description: "The source language the Translate view starts with.",
            control: "select",
            options: [],
          },
          {
            id: "translator-default-target-language",
            title: "Default Target Language",
            description: "The target language the Translate view starts with.",
            control: "select",
            options: [],
          },
        ],
      },
    ],
  },
  {
    id: "file-search",
    title: "File Search",
    description: "Search for files and folders on your computer.",
    icon: "folder-search",
    keywords: [
      "file search", "files", "folders", "scopes", "ignore patterns", "hidden files",
      "ignore files", "gitignore", "index", "reset",
    ],
    sections: [
      {
        id: "file-search",
        rows: [
          {
            id: "file-search-scopes",
            title: "Search Scopes",
            description: "Pick additional directories to be included when searching for files",
            control: "action",
            action: "Pick Folder",
          },
          {
            id: "file-search-ignore-patterns",
            title: "Ignore Patterns",
            description:
              "File Search respects .gitignore, .ignore, Git exclude files, and .rayignore by default. Add comma-separated filenames or directories here to ignore them globally in Raycast.",
            control: "textarea-commit",
          },
          {
            id: "file-search-include-hidden",
            title: "Include Hidden Files",
            description: "Files and folders whose names start with a dot are indexed too.",
            control: "switch",
          },
          {
            id: "file-search-respect-ignore-files",
            title: "Use ignore files",
            description: "Respect .gitignore and .ignore files inside the searched scopes.",
            control: "switch",
          },
          {
            id: "file-search-reset",
            title: "Reset to Defaults",
            description: "Scopes reset to your home directory and ignore patterns are cleared, then everything is reindexed.",
            control: "action",
            action: "Reset",
          },
        ],
      },
    ],
  },
  {
    id: "window-management",
    title: "Window Management",
    description: "Move and resize your application windows.",
    icon: "app-window",
    keywords: [
      "window management", "windows", "gap", "gaps", "cycling", "cycle", "presets", "magnet",
      "hotkeys", "halves", "thirds", "quarters", "sixths", "maximize", "restore", "minimize",
      "move", "resize", "always on top",
    ],
    sections: [
      {
        id: "window-management-gaps",
        title: "Gaps",
        rows: [
          {
            id: "wm-inner-gap",
            title: "Window Gap",
            description: "Gap between windows",
            control: "select",
            options: WM_GAP_OPTION_LABELS,
          },
          {
            id: "wm-outer-gap",
            title: "Screen Gap",
            description: "Gap from windows to the screen edge",
            control: "select",
            options: WM_GAP_OPTION_LABELS,
          },
        ],
      },
      {
        id: "window-management-cycling",
        title: "Cycling",
        rows: [
          {
            id: "wm-cycle-mode",
            title: "Cycling",
            description: "Cycle sizes when using half commands",
            control: "select",
            options: WM_CYCLE_OPTION_LABELS,
          },
        ],
      },
      {
        id: "window-management-presets",
        title: "Presets",
        description: "Apply hotkeys from other window management apps",
        rows: [
          {
            id: "wm-preset",
            title: "Preset",
            description: "Rectangle ships byte-identical to Magnet in the build we reverse-engineered.",
            control: "select",
            options: WM_PRESET_OPTION_LABELS,
          },
        ],
      },
      {
        id: "window-management-commands",
        title: "Move & Resize",
        description: "Every command also runs from root search. Preset hotkeys show on the right.",
        rows: WM_COMMANDS.map((definition) => ({
          id: `wm-cmd-${definition.key}`,
          title: definition.title,
          control: "info" as const,
        })),
      },
    ],
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


export const ACCOUNT_PAGE_ID = "account";
export const SIDEBAR_PAGE_IDS = [
  "general",
  "launcher",
  "shortcuts",
  "keyboard",
  "quicklinks",
  "snippets",
  "calculator",
  "translator",
  "file-search",
  "window-management",
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
