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
  | "interfaceSize"
  | "windowMode"
  | "fallbackAdd"
  | "fallbackList"
  | "none";/** The version the launcher reports everywhere else, kept in one place. */
export const VERSION = "2.4.0.0";
export const HOST_NAME = "This Computer";
/** Raycast's default hotkey is the Win key; the clone's registrable default is Ctrl+Alt+Space. */
export const OPENRAY_DEFAULT_HOTKEY = "Ctrl + Alt + Space";
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
  /** Text inputs render as password fields with an eye accessory. */
  secret?: boolean;
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
/** The confirmed snooze options (shipped settings rows); values map to ms via SNOOZE_BY_LABEL. */
export const FOCUS_SNOOZE_OPTION_LABELS = ["1 minute", "3 minutes", "5 minutes", "10 minutes", "No Snooze"] as const;
export const TASKBAR_POSITION_OPTION_LABELS = ["Top", "Bottom", "Left", "Right"] as const;
/** The confirmed zoom range 0.75–2.0; the settings row exposes 5% steps as labels. */
export const NOTES_ZOOM_OPTION_LABELS: readonly string[] = Array.from({ length: 26 }, (_, index) => `${75 + index * 5}%`);
export const NOTES_ZOOM_VALUE_BY_LABEL: Record<string, number> = Object.fromEntries(
  NOTES_ZOOM_OPTION_LABELS.map((label, index) => [label, Math.round(75 + index * 5) / 100]),
);
export const NOTES_ZOOM_LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(NOTES_ZOOM_VALUE_BY_LABEL).map(([label, value]) => [String(value), label]),
);

export interface PageDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  sections: SectionDefinition[];
  keywords: string[];
  /** Pro-gated page in Raycast (badge in the sidebar); rows render disabled here. */
  pro?: boolean;
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
    description: "Configure appearance, startup behavior, and the Openray hotkey.",
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
          { id: "openray-hotkey", title: "Openray Hotkey", control: "hotkey", value: OPENRAY_DEFAULT_HOTKEY },
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
            id: "interface-size",
            title: "Interface Size",
            description: "Adjust the size of the Openray interface",
            control: "interfaceSize",
            options: ["1", "1.1", "1.2"],
          },
          {
            id: "window-mode",
            title: "Window Mode",
            description: "Choose your preferred mode when opening Openray",
            control: "windowMode",
            options: ["compact", "expanded"],
          },
          {
            id: "show-favorites-in-compact-mode",
            title: "Show Favorites in Compact Mode",
            description: "Show your favorites as icons in the compact window",
            control: "switch",
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
            id: "show-openray-on",
            title: "Show Openray on",
            control: "select",
            options: ["Screen containing mouse", "Screen with active window", "Primary screen"],
          },
          {
            id: "pop-to-root-search",
            title: "Pop to Root Search",
            description: "Timeout after which Openray will reset to root search after closing the window.",
            control: "select",
            options: [
              "Immediately",
              "After 5 seconds",
              "After 15 seconds",
              "After 30 seconds",
              "After 60 seconds",
              "After 90 seconds",
              "After 120 seconds",
              "After 180 seconds",
            ],
          },
          {
            id: "root-search-sensitivity",
            title: "Root Search Sensitivity",
            description:
              "Search sensitivity controls the number of matching results presented in Root Search. Low sensitivity produces many results for a search term, while high sensitivity displays fewer results.",
            control: "select",
            options: ["Low", "Medium", "High"],
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
          },
        ],
      },
      {
        id: "fallback-commands",
        title: "Fallback Commands",
        rows: [
          { id: "add-fallback-command", title: "Add Fallback Command", control: "fallbackAdd" },
          { id: "fallback-commands-items", title: "Fallback Commands", control: "fallbackList" },
        ],
      },
    ],
  },
  {
    id: "extensions",
    title: "Extension Preferences",
    description: "Aliases, hotkeys and preference fields for installed extensions.",
    icon: "extension",
    keywords: ["extensions", "aliases", "hotkeys", "preferences", "store"],
    sections: [],
  },
  {
    id: "shortcuts",
    title: "Shortcuts",
    description: "Manage command hotkeys and aliases across Openray.",
    icon: "shortcuts",
    keywords: ["aliases", "applications", "commands", "extensions", "hotkeys", "keybindings", "keyboard", "quicklinks"],
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
            description:
              "Preferred behavior for the Main window when the Escape key is pressed. The default behavior is to clear the search → navigate back → close the window in the Main window.\n\nThis setting applies only to the Main window.\n\nChange to \"Close window and pop to root\" to immediately close the window on Escape.",
            control: "select",
            options: ["Navigate back or close window", "Close window and pop to root"],
            value: "Navigate back or close window",
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
              "Automatically switch to the selected keyboard input source when opening Openray. The previous input source will be restored when closing.",
            control: "select",
            options: ["None"],
            unavailable: true,
          },
          {
            id: "navigation-bindings",
            title: "Navigation Bindings",
            description: "Key bindings for quick navigation in supported controls.",
            control: "select",
            options: ["Emacs (Alt+B, Alt+F, Alt+P, Alt+N)", "Vim Motions (Alt+H, Alt+L, Alt+K, Alt+J)"],
            value: "Emacs (Alt+B, Alt+F, Alt+P, Alt+N)",
          },
          {
            id: "page-navigation-keys",
            title: "Page Navigation Keys",
            description: "Key equivalent for navigating back and forward in paginated context.",
            control: "select",
            options: ["Square Brackets", "Arrow Keys"],
            value: "Square Brackets",
          },
          {
            id: "builtin-hotkeys-preset",
            title: "Built-in Hotkeys Preset",
            description: "Choose the default hotkeys for built-in commands. Improved adds the Clipboard History hotkey alongside the launcher; Classic keeps only the launcher hotkey.",
            control: "select",
            options: ["Improved", "Classic"],
            value: "Improved",
          },
          {
            id: "hyper-key",
            title: "Hyper Key",
            description:
              "Select a physical key to remap to the Ctrl+Alt+Shift+Win modifier keys simultaneously.",
            control: "select",
            options: [
              "None",
              "Caps Lock (⇪)",
              "Left Ctrl",
              "Left Shift",
              "Left Alt",
              "Left Win",
              "Right Ctrl",
              "Right Shift",
              "Right Alt",
              "Right Win",
              "F1",
              "F2",
              "F3",
              "F4",
              "F5",
              "F6",
              "F7",
              "F8",
              "F9",
              "F10",
              "F11",
              "F12",
              "Copilot",
            ],
            unavailable: true,
          },
          {
            id: "hyper-key-include-shift",
            title: "Include Shift (⇧)",
            control: "switch",
            unavailable: true,
          },
          {
            id: "hyper-key-display-shortcut",
            title: "Replace occurrences of Ctrl+Alt+Shift+Win with ✦",
            control: "switch",
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
    keywords: ["backup", "certificate", "connection", "export", "favicon", "proxy", "scheduled export"],
    sections: [
      {
        id: "advanced",
        rows: [
          {
            id: "window-activation-behavior",
            title: "Window Activation Behavior",
            description: "Choose whether Raycast brings windows to your current Space or switches to the Space where they are open.",
            control: "select",
            options: ["Move to Active Space", "Switch Space"],
            value: "Move to Active Space",
          },
          {
            id: "favicon-provider",
            title: "Favicon Provider",
            description: "Select the provider used to fetch favicons or None to disable favicon fetching.",
            control: "select",
            options: ["None", "Raycast", "DuckDuckGo", "Google"],
            unavailable: true,
          },
        ],
      },
      {
        id: "file-explorer",
        title: "File Explorer",
        rows: [
          {
            id: "open-folders-in-tabs",
            title: "Open Folders in Tabs",
            description: "Open folders as new tabs in an existing File Explorer window instead of opening new windows.",
            control: "switch",
            unavailable: true,
          },
        ],
      },
      {
        id: "accessibility",
        title: "Accessibility",
        rows: [
          {
            id: "run-accessibility-helper-elevated",
            title: "Run the Accessibility Helper Elevated",
            description:
              "Turn this on if global shortcuts, snippet expansion, or copying selected text aren't working on your PC. Openray then launches its input helper with administrator rights via the Openray System Service. Requires an administrator account — on standard Windows accounts this has no effect, since Windows can't grant elevation without a password prompt. Takes effect after you restart Openray.",
            control: "switch",
            unavailable: true,
          },
        ],
      },
      {
        id: "export",
        title: "Export",
        rows: [
          { id: "export-passphrase", title: "Export Passphrase", description: "A passphrase to encrypt your exported settings and data.", control: "text", secret: true },
          {
            id: "scheduled-backup",
            title: "Scheduled Backup",
            description: "Automatically export your Openray settings and data on a schedule.",
            control: "select",
            options: ["Off", "Daily", "Weekly", "Monthly"],
            value: "Off",
          },
          { id: "backup-location", title: "Backup Location", description: "Folder that receives the scheduled backup files.", control: "action", action: "Choose Folder" },
          {
            id: "auto-delete-backups",
            title: "Auto-Delete",
            description: "Automatically delete old backups to save disk space.",
            control: "select",
            options: ["Never", "Keep Latest", "Keep Last 5", "Keep Last 10"],
            value: "Never",
          },
          {
            id: "skip-on-battery",
            title: "Skip on Battery",
            description: "Skip scheduled exports while on battery power and run them once back on AC power.",
            control: "switch",
          },
          { id: "export-settings", title: "Export Settings", control: "action", action: "Export Settings" },
          { id: "import-settings", title: "Import Settings", control: "action", action: "Import Settings" },
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
            action: "+ Add File",
          },
        ],
      },
    ],
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
            id: "quicklinks-show-link-previews",
            title: "Show Link Previews",
            description: "Show the resolved link as the row preview in Root Search.",
            control: "switch",
          },
          {
            id: "quicklinks-prefer-existing-tabs",
            title: "Prefer Existing Tabs",
            description: "When opening a Quicklink, check if the URL is already open and activate that window instead of opening a new one.",
            control: "switch",
          },
          {
            id: "quicklinks-pass-selected-text",
            title: "Pass Selected Text as Argument",
            description:
              "When enabled, Openray will automatically pass selected text from the active application to Quicklinks with a single argument when invoked via hotkey.",
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
              "Some systems are capable of faster response times processing clipboard entries. If Openray doesn't expand your snippets correctly, slower response times might help.",
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
        id: "calculator-general",
        rows: [
          {
            id: "calculator-syntax-highlighting",
            title: "Syntax highlighting",
            description: "Color the numbers, operators and functions in calculated expressions.",
            control: "switch",
          },
          {
            id: "calculator-color-conversion",
            title: "Enable Color Conversion",
            description: "Preview and convert color values from Root Search.",
            control: "switch",
          },
          {
            id: "calculator-rem-to-px",
            title: "REM/EM to Pixel Conversion",
            description: "Input the desired number of pixels equivalent to 1 rem/em.",
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
              "File Search respects .gitignore, .ignore, Git exclude files, and .rayignore by default. Add comma-separated filenames or directories here to ignore them globally in Openray.",
            control: "textarea-commit",
          },
          {
            id: "file-search-content-search",
            title: "Content Search",
            description: "Also search the text inside files, not just their names.",
            control: "switch",
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
    id: "raycast-focus",
    title: "Openray Focus",
    description: "Manage focus sessions and categories.",
    icon: "clock",
    keywords: [
      "focus", "session", "snooze", "sound", "restore", "terminated apps", "categories",
      "blocking", "block apps", "allow apps",
    ],
    sections: [
      {
        id: "focus",
        rows: [
          {
            id: "focus-snooze-duration",
            title: "Snooze Duration",
            description: "How long a blocked app stays snoozed when you snooze it.",
            control: "select",
            options: FOCUS_SNOOZE_OPTION_LABELS,
          },
          {
            id: "focus-play-sound",
            title: "Play Sound",
            description: "Play a sound when a focus session ends.",
            control: "switch",
          },
          {
            id: "focus-allow-all-websites",
            title: "Allow all Websites",
            description: "Allow all websites when a browser is allowed but no specific websites are listed.",
            control: "switch",
          },
          {
            id: "focus-restore-apps",
            title: "Restore Terminated Apps",
            description: "Reopen apps Openray Focus terminated when the session ends.",
            control: "switch",
          },
        ],
      },
    ],
  },
  {
    id: "games",
    title: "Games",
    description: "Quickly launch your installed games.",
    icon: "game-controller",
    keywords: ["games", "game mode", "disable hotkeys", "hotkeys", "fullscreen"],
    sections: [
      {
        id: "games",
        rows: [
          {
            id: "games-game-mode",
            title: "Game Mode",
            description: "Disable Openray hotkeys while a game window is detected in the foreground.",
            control: "switch",
          },
        ],
      },
    ],
  },
  {
    id: "taskbar",
    title: "Taskbar",
    description: "Customizable taskbar behaviour.",
    icon: "app-window-list",
    keywords: ["taskbar", "bar", "position", "top", "bottom", "left", "right", "show", "hide"],
    sections: [
      {
        id: "taskbar",
        rows: [
          {
            id: "taskbar-show",
            title: "Show Taskbar Window",
            description: "Show or hide the taskbar window.",
            control: "switch",
          },
          {
            id: "taskbar-position",
            title: "Position",
            description: "Which screen edge the taskbar window docks to.",
            control: "select",
            options: TASKBAR_POSITION_OPTION_LABELS,
          },
        ],
      },
    ],
  },
  {
    id: "notes",
    title: "Openray Notes",
    description: "Create and manage your notes.",
    icon: "blank-document",
    keywords: ["notes", "note", "escape", "zoom", "editor"],
    sections: [
      {
        id: "notes",
        rows: [
          {
            id: "notes-escape-key-behavior",
            title: "Escape Key Behavior",
            description: "What happens when you press Escape in the Notes window.",
            control: "select",
            options: ["Closes Window", "Loses Focus"],
          },
          {
            id: "notes-zoom",
            title: "Zoom",
            description: "The editor text scale (the confirmed 75%–200% range).",
            control: "select",
            options: NOTES_ZOOM_OPTION_LABELS,
          },
        ],
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
    empty: "No internal settings are available in this build of Openray.",
    sections: [],
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
          { id: "openray-updates", title: "Openray Updates", control: "action", action: "Check for Updates", value: VERSION },
          { id: "open-changelog", title: "Open Changelog", control: "action", action: "Open Changelog" },
          { id: "website", title: "Website", control: "action", action: "github.com/GabrielSantos23/Openray" },
          { id: "slack-community", title: "Slack Community", control: "action", action: "Join Slack" },
          { id: "send-feedback", title: "Send Feedback", control: "action", action: "Send Email" },
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Account",
    description: "Manage your Openray account, AI usage, credits, and plan.",
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
  {
    id: "applications",
    title: "Applications",
    description: "Quickly launch your installed applications.",
    icon: "app-window-list",
    keywords: ["applications", "directories", "folders", "hotkey action", "search scope", "apps"],
    sections: [
      {
        id: "applications",
        rows: [
          {
            id: "applications-auto-quit",
            title: "Auto Quit",
            description: "Automatically quit apps shortly after you stop using them.",
            control: "action",
            action: "Configure",
          },
          {
            id: "applications-hotkey-action",
            title: "Hotkey Action",
            description: "Behavior when triggering an application hotkey.",
            control: "select",
            options: ["Toggle Visibility", "Always Show", "Always Hide"],
            value: "Toggle Visibility",
          },
          {
            id: "applications-deep-search",
            title: "Deep Search",
            description: "Search up to 3 levels deep inside added directories",
            control: "switch",
          },
        ],
      },
    ],
  },
  {
    id: "applications-auto-quit",
    title: "Auto Quit",
    description: "Automatically quit apps shortly after you stop using them.",
    icon: "app-window-list",
    keywords: ["auto quit"],
    sections: [
      {
        id: "applications-auto-quit",
        rows: [
          {
            id: "applications-auto-quit-enabled",
            title: "Auto Quit",
            description: "Automatically quit apps you have not used for a while.",
            control: "switch",
          },
          {
            id: "applications-auto-quit-delay",
            title: "Quit Delay",
            description: "How long an app stays open after you stop using it.",
            control: "select",
            options: ["After 1 minute", "After 5 minutes", "After 10 minutes", "After 30 minutes", "After 1 hour"],
            value: "After 5 minutes",
            visibleWhen: (values) => values["applications-auto-quit-enabled"] === true,
          },
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
  "advanced",
  "about",
];

/** Reachable only via the Auto Quit row on the Applications page; hidden from the sidebar and search. */
export const HIDDEN_PAGE_IDS = ["applications-auto-quit"];

/** The extension-pages group under the root pages, alphabetical like Raycast's sidebar. */
export const EXTENSION_PAGE_IDS = [
  "applications",
  "calculator",
  "clipboard-history",
  "file-search",
  "games",
  "notes",
  "quicklinks",
  "raycast-focus",
  "snippets",
  "taskbar",
  "translator",
  "window-management",
];

// ---------------------------------------------------------------------------------------------
// Persisted settings — Raycast keeps these in its own settings store; the clone uses
// localStorage so toggles survive a window reload.
// ---------------------------------------------------------------------------------------------
