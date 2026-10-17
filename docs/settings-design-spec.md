# Openray Settings — Design Spec

Source of truth: five screenshots of Raycast for Windows 2.4.0 (attached to the task) +
REA of the installed app. REA artifacts live in `C:\Users\gabs\.t3\scratch\rea-settings\`:
`frontend/` is a copy of the MSIX package's WebView2 frontend (minified Vite/React chunks with
all page definitions, views, CSS), and `Raycast.dll` is the managed host (settings are persisted
in SQLCipher-encrypted `settings_v2.db`; keys/values/defaults were recovered from the frontend
chunks instead).

**Screenshot coverage note.** The task promised one image per page/state (general, extensions,
advanced, dropdowns open, hotkey recording, a selected extension). Seven screenshots arrived —
General (two takes), Launcher, Shortcuts, Keyboard, **Extensions with a selected extension
(Spotify Player), and Advanced**. The dropdown-open and hotkey-recorder states are still
**reconstructed from the frontend code, not from screenshots**; they are marked `(reconstructed)`
and remain accepted deviations.

## 0. Platform facts

- Raycast's Settings window is WebView2-hosted (like the rest of its UI); the window chrome
  (titlebar, caption buttons) is native. Sidebar 231px + 1px separator, titlebar 40px tall
  (`--space-40`) with `fg-5` background and 1px bottom separator, caption button strip 96px wide
  reserved top-right. Window corner radius on Windows: 8px (`--radius-window`).
- Base font: InterVariable (weights 100–900) at 13px/400; mono font JetBrainsMono. Font feature
  settings `liga, calt, kern, ss03`. Windows header text uses `Segoe UI Variable` first.
- All screenshots were captured at **100% DPI** (titlebar measures exactly 40px, sidebar 232px
  with border, row 46–47px), so image px = CSS px. Window size in the captures: 1371×756
  (user-resized; Raycast's settings window is freely resizable — Openray will use default
  1200×760, min 720×480, and the comparison captures resize to 1371×756).

## 1. Design tokens (from `css-FlvQZ5S4.css` + rendered screenshots)

Raycast's system is: opaque base colors + white overlay ramps. The rendered hexes below were
sampled from the clean General screenshot and match the token math exactly (e.g. section card =
fg 2.5% over #1F1F1F = #242424). Openray defines the computed hexes as the token values.

### 1.1 Surfaces and text

| Token | Raycast definition | Rendered value (dark, Windows) |
|---|---|---|
| `--settings-window-bg` | `--color-window-bg` = bg 40% over `#333c` backdrop | `#1F1F1F` (page + sidebar base) |
| `--settings-card-bg` | `rgb(from --fg / 2.5%)` | `#242424` |
| `--settings-sidebar-titlebar-bg` | `fg-5` | `#2A2A2A` |
| `--settings-control-bg` | `--color-surface-control` = `fg-10` | `#353535` (search field, buttons, selected sidebar row) |
| `--settings-input-bg` | `--color-surface-input-field` = `#ffffff0d` | `#353535` over card |
| `--settings-hover` | `fg-5` | `#2A2A2A` |
| `--settings-active` | `selection-10` | `#353535` |
| `--settings-toggle-off` | `fg-20` | `#505050` |
| `--settings-separator` | `--color-border-tertiary` = `fg-5` | `#303030`–`#343434` |
| `--settings-separator-strong` | `--color-border-separator` = `fg-10` | `#373737` |
| `--settings-text-primary` | `fg` | `#FFFFFF` (sampled #EDEDED on AA edges) |
| `--settings-text-secondary` | `fg-60` | `#A7A7A7` |
| `--settings-text-tertiary` | `fg-40` | `#7C7C7C` (descriptions, placeholders) |
| `--settings-text-quaternary` | `fg-20` | `#505050` |
| `--settings-accent` | `--color-system-accent` | Windows system accent, sampled `#0078D4` |
| `--settings-brand` | `--color-brand` | `#FF6363` |
| blue / red / green / yellow / orange / purple | theme | `#56C2FF` / `#FF6363` / `#59D499` / `#FFC531` / `#FF9217` / `#A485FF` |
| `--settings-focus-ring` | 1px solid `fg 50%` | `rgba(255,255,255,0.5)` |
| Panel/popup backdrop | `#333c` + blur 120 + `#ffffff1a` overlay | solid approx `#3A3A3A` with `--shadow-panel` |

`--shadow-panel` (popovers): `inset 0 0 0 1px rgba(255,255,255,0.2), 0 8px 10px -6px rgba(0,0,0,.1), 0 20px 25px -5px rgba(0,0,0,.2)`.

### 1.2 Scale

- Radii: 2/4/6/8/10/12/16/18/20/26/full. Cards and rows: 8 (`--space-8`); section cards 6 on
  Windows (Shortcuts table); controls (inputs/buttons) `radius-4`.
- Spacing: 2/4/6/8/12/16/24/32/40/48/56. Layout: content padding-x 16, sidebar padding-x 10,
  row padding-block 12, row padding-inline 12.
- Font sizes: 8/11/13/16/18/24. Body 13; descriptions and `small-text` 11; window title 13.
- Interface Size multiplies everything by `--zoom` (`--spx = 1px * zoom`): 1 / 1.1 / 1.2,
  clamped 1–1.2 (step 0.1).
- Icon sizes: 12/16/22/32. Sidebar icons 22; row accessory icons 16.

### 1.3 Key metrics (screenshots)

- Window: titlebar 40; sidebar width 231 (+1 border); content pad-x 16; row min-height **46**;
  row vertical rhythm **47** (46 + 1px separator inside cards); section title block min-height
  **32**; gap between sections **16**; page bottom padding 16.
- Search field (sidebar): height 32, radius 8 (screenshot corners ≈8), bg `#353535`, no border,
  16px magnifier icon, placeholder "Search settings…" in tertiary, focus ring `fg-50` 1px.
- Sidebar item: height 32, padding-inline 6, gap 8, icon 22, radius 8, selected bg `#353535`,
  hover `#2A2A2A`, Pro badge = 16px-tall pill, blue `#56C2FF` text on `blue-10` (#242E35 over
  sidebar), 11px text.
- Account block: 40px avatar, name 13px primary, subtitle "Account" 11px secondary.
- Toggle: 28×16 track (radius full), 3px padding, 10px thumb; on = accent, off = `#505050`,
  thumb `#ffffffe6` → `#fffffff2`; transition .1s. Disabled opacity .4. Focus ring offset 2.
- Ghost dropdown (rows): height 24, padding 8/6, hover `fg-5`, open `fg-10`, chevron 16 tertiary,
  text 13 primary. Popup: width ≥ trigger, max-height 320, radius 6, `--shadow-panel`, items 28px
  with 16px leading check for selected, hover `fg-5`, section headers 11px tertiary. `(reconstructed)`
- Buttons: small height 24 (`Upgrade to Pro` standout = `fg-20` bg; `Reset`/`Replace Start Menu`
  secondary = `fg-10` bg + `fg-20` 1px ring, radius 4, 13px text); icon buttons 24×24 (header
  search, collapse "–", reset hotkey) hover `fg-5`.
- Keycaps (VisualShortcut): height 18, min-width 18, 10px font, inset ring `--color-border-token`,
  secondary text; Windows logo glyph 11px.
- Hotkey recorder popover `(reconstructed from code)`: width 320, max-height 170, side top;
  gradient background animates green (`green-15→green-8→transparent`) on save, red on conflict;
  key buttons 24px min, `fg-10` bg; states idle/recording/conflict; strings in §4.
- Applications/Shortcuts table: rows 46; grid `1fr | 100 | 140 | 14` gap 8 padding-inline 12;
  column header row 24 (11px secondary "Name / Alias / Hotkey"); category header row 46 with
  icon, title, chevron, tri-state checkbox; section card radius 6; nested command rows indent 24.
- Window Mode cards: image 148×88 (grayscale when inactive, 50% on hover), label pill
  (`fg-20` bg when active), gap 16, captions "Compact" / "Expanded".

## 2. Sidebar (screenshots)

Structure top→bottom: search field; account block (avatar, "Gabs", "Account"); then two groups
separated by 16px gap:

1. Root pages: General, Launcher, Shortcuts, Keyboard, Cloud Sync (Pro), Advanced, Organizations,
   About.
2. Extension pages, alphabetical: AI (Pro), Applications, Browser, Calculator, Clipboard History,
   Developer, Dictation (Pro), Emoji & Symbols, File Search, … (continues alphabetically: Games,
   Notes, Quicklinks, Raycast Focus, Remote, Screenshots, Snippets, Translator, Window
   Management, Windows Run, plus Windows Settings and script pages below the fold).

Selected item: `#353535` rounded 8. Hover: `#2A2A2A`. Keyboard focus adds ring. The search
replaces the tree with grouped results ("Settings"/"Commands") navigable with arrows and Enter;
Esc clears; Ctrl+F focuses the field. Remember last visited page (Raycast does via router);
openable directly to `#/general`, `#/shortcuts`, `#/general?row=open-at-login` etc. so action
panel "Configure" commands land on the right row (row deep-link scrolls and pulses
`selection-5` for 2s — Raycast's `data-highlight` behavior).

Pro badges on: Cloud Sync, AI, Dictation (screenshot 1). Pro pages in Openray render the same
rows disabled with the "Not available in Openray" hint.

## 3. Window chrome

- Titlebar (40px): sidebar side shows "Settings" 13px secondary (`Segoe UI Variable` first,
  translateY(-1px)); content side shows back/forward chevron buttons 16×16 (history navigation,
  disabled 40%), page title area (animated, static pages show the page title, extension pages
  show icon + title), and right-aligned `navigationOptions` slot with margin-right reserving the
  96px caption strip (minimize/close are native WebView2 caption buttons).
- Shortcuts page header additionally shows: search icon button (expands into a 190px input,
  placeholder "Search by name or alias") and the filter dropdown (see §5.3) — screenshot 3.
- The whole header is a drag region; buttons opt out.

## 4. Page catalog and behavior

Store: one settings store (`settings` module in the Node backend, JSON at
`%LOCALAPPDATA%\Openray\store\settings.json`) replaces Raycast's `raycastSettingsStore` +
`updateGeneralSettings` backend payload + encrypted DB. Every key below lives there; the store
emits change events so **both windows update live** (Raycast: `subscribeUpdate*` host pushes —
same contract). Renderer caches are dropped in favor of store reads.

### 4.1 General (`/general`)

Description: "Configure appearance, startup behavior, and the Raycast hotkey."

Section 1 (untitled):
- `open-at-login` — "Open at Login" switch. **Default true.** Writes store + registers a real
  Run-key/scheduled-task entry via host; failure rolls the switch back and toasts the error
  message (Raycast: toast titled error.message or "Failed to update Open at Login").
- `show-in-menu-bar` — "Show in System Tray" switch. **Default true.** Tray icon shown/hidden
  live.
- `automatically-show-taskbar` — "Automatically Show the Taskbar" switch (Windows-only row).
  **Default false.** Toggles the auto-hide behavior of the Windows taskbar in the host.
- `raycast-hotkey` — "Raycast Hotkey" row: [Replace Start Menu ⊞ button — shown only when the
  current hotkey differs from the default Win-key hotkey; tooltip "The Win key will open Raycast
  instead of the Start Menu. You'll still be able to open the Start Menu from the taskbar.";
  sets hotkey back to Win] [hotkey recorder showing current keycaps — screenshot shows "Alt
  Space"] [reset icon button, tooltip "Reset to default hotkey"]. Default global hotkey: **Win
  key alone** (`Meta`). Openray's default stays its own current default (documented as
  accepted deviation: Win-key interception is out of scope; default `Alt+Space`, recorder +
  conflict handling + registration failure toasts are real).

Section "Appearance":
- `follow-system-appearance` switch — **default true** (`appearance: 'system'`). When on: shows
  "Dark Theme" + "Light Theme" dropdowns. When off: a single "Theme" dropdown grouped into
  "Dark Themes"/"Light Themes" sections that also switches appearance.
- Theme dropdowns: options = the 8 bundled themes (dark: Raycast Dark, Sky, Sunset, Midnight;
  light: Raycast Light, Dawn, Overcast, Noon), each with its theme icon. **Default Raycast
  Dark / Raycast Light.** Themes apply live (CSS variables swap) in both windows.
- `theme-studio` — "Theme Studio" + description "Edit or create themes for Raycast", button
  "Upgrade to Pro". **Not available in Openray** (disabled button + hint).
- `interface-size` — "Interface Size" + "Adjust the size of the Raycast interface"; three `Aa`
  icon radio buttons (Aa sizes ≈10/13/17px) mapping to zoom **1 / 1.1 / 1.2**, labels
  Default/Large/Larger. Applies live by setting `--zoom` on the root of both windows.
- `window-mode` — "Window Mode" + "Choose your preferred mode when opening Raycast": two visual
  radio cards 148×88 (wallpaper + mini launcher art) labeled Compact / Expanded. **Default
  `expanded`.** Applies live to the launcher window (compact = 750×64 collapsed style; Raycast
  only collapses when root search is empty).
- `show-favorites-in-compact-mode` — "Show Favorites in Compact Mode" + "Show your favorites as
  icons in the compact window" switch, **always rendered, disabled unless window-mode is
  compact**. Default true.

### 4.2 Launcher (`/launcher`)

Description: "Configure content shown in root search." Sections: Behavior, Customize Search,
Fallback Commands.

Behavior:
- `show-openray-on` — "Show Raycast on" ghost dropdown: `mouse-screen` "Screen containing
  mouse" / `active-screen` "Screen with active window" / `primary-screen` "Primary screen".
  **Default `mouse-screen`** (screenshot shows default).
- `pop-to-root-search` — description "Timeout after which Raycast will reset to root search
  after closing the window." Options (seconds): 0 "Immediately", 5/15/30/60/90/120/180 "After N
  seconds". **Default 90** (screenshot).
- `root-search-sensitivity` — long description (verbatim from screenshot): "Search sensitivity
  controls the number of matching results presented in Root Search. Low sensitivity produces
  many results for a search term, while high sensitivity displays fewer results." Options
  low/medium/high → "Low"/"Medium"/"High". **Default `high`** (screenshot shows user's "Medium" —
  a stored user value, not a discrepancy).
- `reset-search-history` — title "Search History", description "Clear recent searches restored
  when pressing the up arrow in Root Search.", button "Reset". Confirm dialog: title "Reset
  Search History?", description "The history of recent searches restored with the up arrow in
  Root Search will be cleared.", primary "Reset" (destructive); success toast "Search history
  cleared". Clears the real root-search history key.

Customize Search:
- `include-files-in-root-search` — "Include Files in Root Search" switch → File Search settings
  `showInRootSearch`. Default true (screenshot ON).
- `search-file-contents-in-root-search` — "Include File Content search results in Root Search"
  switch → `contentSearchInRootSearch`, default false, **disabled unless content search enabled**
  (screenshot OFF, disabled state gray).
- `include-contacts-in-root-search` / `include-agents-in-root-search` — defined but not rendered
  in Raycast's Windows view (contacts/agents don't exist); omit rows (REA: compiled as null).

Fallback Commands (drag-reorder list, not the current textarea):
- "Add Fallback Command" ghost row with `plus-square` icon → command-picker popover (width 320,
  max-height 360, search field "Search commands", grouped by extension sorted by title, only
  not-yet-configured fallback-capable commands).
- Configured rows: command icon + title, trailing extension title (secondary, ellipsized, swaps
  to a minus "Remove" icon button on hover/focus); drag handle on hover; rows sorted by
  `fallbackOrder`; separators 1px `border-tertiary`.
- Empty state: "No Fallback Commands" (11px quaternary, centered, 16px padding-block).
- Persistence: per-extension `enabledFallbackCommandIds` + per-command `fallbackOrder` (index;
  null when removed).
- Openray mapping: fallback-capable commands = web-search-ish commands (Google/DuckDuckGo
  from web-search data, Search Snippets, Store, Spotify Search, etc. — all root-search commands
  flagged fallback-capable); same picker/reorder/remove UI, same storage keys in the settings
  store. Replaces the current `fallback-commands-list` textarea + `fallback-commands-enabled`
  toggle (removed; existing localStorage data migrates to the new shape).

### 4.3 Shortcuts (`/shortcuts`)

Page: title "Shortcuts", description "Manage command hotkeys and aliases across Raycast."
Icon `commandIcons.shortcutsWindows`. This is the Name/Alias/Hotkey page in screenshot 3 —
**not** the "Applications" extension page.

Header (right of titlebar): search icon button (tooltip "Search by name or alias", expands to
input) + filter dropdown (tooltip "Filter").

Filter dropdown options (verbatim):
- Section "Modifications": "Hotkey Set" (keyboard icon), "Alias Set" (text-cursor), "Enabled"
  (check-circle), "Disabled" (x-mark-circle).
- Section "Categories": "All categories", "Applications", "Extensions", "Games", "Quicklinks",
  "System", "Windows Settings" (with their icons). Trigger shows the single selection ("Applications")
  or "Filters" when several. Persisted in `settings-shortcuts-filters`.

Table: categories in fixed order — Applications, Extensions, Quicklinks, Games, System,
Windows Settings — each a collapsible group (chevron rotates −90°, collapse state persisted in
`settings-shortcuts-collapsed-categories`/`-extensions`): header row 46px with category icon +
title + **tri-state checkbox** (all enabled / none / mixed); left-click toggles collapse,
right-click toggles all commands in the category. Column header row (24px, 11px secondary):
"Name", "Alias", "Hotkey". Rows 46px, grid `1fr | 100 | 140 | 14`, gap 8, padding-inline 12,
1px separators (`border-tertiary`), radius 6 card, nested extension commands indent 24px.
Name cell: 16px icon + title. Alias cell: inline input, placeholder "Add Alias" (tertiary),
commits lowercased alias on Enter/blur, Esc restores, emptied → alias cleared; spaces show as
`␣` while editing. Hotkey cell: keycap visual when set, "Record Hotkey" tertiary text when
empty; click opens the recorder popover; hover shows 12px `xmark` clear; 6px red conflict dot
with tooltip "Also assigned to <command name>" when conflicting. Checkbox toggles that
command's `enabled`. Search filters by title+alias (match-sorter). Rows virtualized (46px
estimate, overscan 10). Empty state: "No results".

Openray mapping: Applications = the app index (per-app alias/hotkey/enabled already used by
root search — the backend app store gains alias/hotkey/enabled fields); Extensions = installed
extensions and their commands (alias/hotkey/enabled per command — replaces the current
ExtensionPreferences page; that page's per-command preference fields move to a detail view);
Quicklinks/Games/System/Windows Settings render what exists (Quicklinks commands exist; Games
commands exist; System actions = Openray's system commands; Windows Settings rows render
disabled "Not available in Openray").

Hotkey recorder popover (shared component; used by Raycast Hotkey, Clipboard History hotkey,
Shortcuts rows) — `(reconstructed from code)`:
- Trigger: keycaps or "Record Hotkey" (11px tertiary); while recording "Recording…".
- Popover 320×170: centered state; idle shows current keys or hint; recording shows pressed keys
  live; strings: "Press Backspace to delete", "or click keys to edit further" / "Click keys to
  edit further", "or record a new hotkey" / "Record a new hotkey"; rotating example row
  ("e.g. Single Step / Single Key / Double Tap" every 1.8s); conflict: "Already used by
  <command>" or "Already used by Raycast", footer "Overwrite it or record a new hotkey" /
  "Discard or record a new hotkey", buttons "Back" / "Close" / "Overwrite" (Overwrite saves with
  `overwriteHotkeyConflict: true`); invalid combo: "This key combination isn't supported";
  pre-existing conflict banner "Also used by <name>"; external-app warning "Also used by another
  app"; info tooltip "Modifier keys: Left, right or any side" / "Character keys: Physical key
  position (default) or key-equivalent (e.g. \"S\" on all keyboard layouts)".
- Host registration errors toast the error message; conflicts are detected against all
  registered hotkeys (commands + global) before save.

### 4.4 Keyboard (`/keyboard`)

Description: "Configure keyboard behavior, navigation bindings, input sources, and Hyper Key."
Section "Keyboard":

- `escape-key-behavior` — "Escape Key Behavior". Full description (screenshot shows truncated +
  "Show more"; the row description clamps to 2 lines with an 11px "Show more" toggle):
  "Preferred behavior for the Main window when the Escape key is pressed. The default behavior
  is to clear the search → navigate back → close the window in the Main window." (line break)
  "This setting applies only to the Main window." (line break) "Change to \"Close window and pop
  to root\" to immediately close the window on Escape." Options: `pop-back-or-close` "Navigate
  back or close window" / `close-and-pop-to-root` "Close window and pop to root". **Default
  `pop-back-or-close`** (screenshot).
- `escape-key-closes-window` — "Escape Key Closes Window" + "Dismiss windows such as AI Chat,
  Notes, and Settings by pressing the Escape key." **Default true** (screenshot ON).
- `auto-switch-input-source` — "Auto-switch Input Source" + "Automatically switch to the
  selected keyboard input source when opening Raycast. The previous input source will be
  restored when closing." Options: "None" + system keyboard layouts (loaded async; disabled
  while loading/empty). Store key `enforcedInputSourceId`. **Not available in Openray**
  (disabled "None" + hint).
- `navigation-bindings` — "Key bindings for quick navigation in supported controls." Options:
  `emacs` "Emacs (Alt+B, Alt+F, Alt+P, Alt+N)" / `vim-motions` "Vim Motions (Alt+H, Alt+L,
  Alt+K, Alt+J)". **Default `emacs`** (screenshot). Wired into the list navigation key handlers.
- `page-navigation-keys` — "Key equivalent for navigating back and forward in paginated
  context." Options: `square-brackets` "Square Brackets" (Ctrl+[ / Ctrl+]) / `arrow-keys`
  "Arrow Keys" (Ctrl+Alt+←/→). **Default `square-brackets`** (screenshot). Drives the titlebar
  back/forward buttons.
- `hyper-key` — "Hyper Key": dropdown None / "Caps Lock (⇪)" / "Left Ctrl" / "Left Shift" /
  "Left Alt" / "Left Win" / "Right Ctrl" / "Right Shift" / "Right Alt" / "Right Win" / "F1"–
  "F12" / "Copilot". Default None (screenshot). When a key is picked, an extra "Quick Press"
  dropdown appears (options "Does Nothing" / "Trigger <label>") and the row description reads
  "Pressing <label> will trigger the left Ctrl+Alt+Shift+Win modifier keys." + "Hyper Key
  shortcuts will be shown in Raycast with ✦."; failure state "Hyper Key failed to start." /
  "Hyper Key unavailable" ("An app is using Secure Input"). **Not available in Openray** —
  row + dependent rows render disabled with hint.
- `hyper-key-include-shift` — "Include Shift (⇧)" switch, default true, disabled when Copilot is
  selected. `(reconstructed: hidden until Hyper Key set — Raycast hides it while key is None)`.
- `hyper-key-display-shortcut` — "Replace occurrences of Ctrl+Alt+Shift+Win with ✦" (label
  dynamic: without Shift it reads Ctrl+Alt+Win), default true. Same visibility rule.

### 4.5 Advanced (`/advanced`) — confirmed by screenshot 6 + chunk `advanced-settings-view-BmQYrfuX.js`

Description: "Tune advanced behavior, exporting, and connectivity." Sections in render order:

- Untitled section: "Favicon Provider" — "Select the provider used to fetch favicons or None to
  disable favicon fetching." Options: none "None", duckduckgo "DuckDuckGo", google "Google",
  raycast "Raycast" (with "Default" accessory). Default `raycast`. (The chunk also defines
  "Window Activation Behavior" and "Tidy Menu Bar" rows, but both are macOS-gated / not rendered
  by the Windows view — Openray renders neither.) Openray: stored value wired to the
  favicon fetcher if one exists; otherwise disabled + hint.
- Section "File Explorer" (Windows): "Open Folders in Tabs" — "Open folders as new tabs in an
  existing File Explorer window instead of opening new windows." Default false. Switch also
  calls host `openFoldersInTabs({enabled})`. **Openray: disabled + hint** (opening a folder
  as a tab of an existing Explorer window needs COM IShellWindows automation Openray's host
  does not have; there is no explorer.exe CLI flag for tabs — the earlier `/existing` note was
  wrong).
- Section "Accessibility" (Windows): "Run the Accessibility Helper Elevated" — "Turn this on if
  global shortcuts, snippet expansion, or copying selected text aren't working on your PC.
  Raycast then launches its input helper with administrator rights via the Raycast System
  Service. Requires an administrator account — on standard Windows accounts this has no effect,
  since Windows can't grant elevation without a password prompt. Takes effect after you restart
  Raycast." (error-state descriptions exist for service-down / standard-account). **Openray:
  disabled + hint** (no System Service).
- Section "Export" (non-Pro view; pro view swaps the second row for Scheduled Backup/Location/
  Auto-Delete): "Export Passphrase" — small password input (max-width 180) with eye/eye-disabled
  accessory; default description "A passphrase to encrypt your exported settings and data.";
  validation: empty or ≥8 chars, else description becomes red "Passphrase must be at least 8
  characters long."; persisted on blur (Raycast: userDefaults `ExportSettingsDataPassphrase`).
  Then "Scheduled Export" — "Automatically back up your settings and data with Raycast Pro" with
  a standout "Upgrade to Pro" button. **Openray**: passphrase is real (used to AES-encrypt
  the Export Settings file); "Scheduled Export" keeps the layout with the standout button
  disabled + "Not available in Openray" hint (no Pro tier). The real **Export Settings /
  Import Settings pair** Raycast ships as commands: Openray puts two working rows here —
  "Export Settings" writes a versioned JSON (settings store + aliases/hotkeys + extension
  settings, encrypted when a passphrase is set) through a Save dialog; "Import Settings" reads it
  back, validates, applies live and toasts success/failure. (Raycast's import/export is a
  command, not a settings row — accepted deviation, listed per task item 4.)
- Section "Connection": "Use System Proxy Settings" switch ("Automatically use your computer's
  proxy configuration for network connections.") — default false, real (honored by the backend
  http layer via a system-proxy dispatcher); "Additional Certificate Authority" — description
  "Choose a certificate file (.crt, .cer, .pem) to trust connections that would otherwise show
  security warnings or fail." with a small secondary "+ Add File" button (plus icon) opening a
  multi-select picker for .pem/.crt/.cer/.der, width 180.

### 4.6 About (`/about`)

Description: "Check for updates, view links, and open feedback destinations." Rows: "Raycast
Updates" (action "Check for Updates", value = version — real: opens the releases check),
"Open Changelog", "Website", "Slack Community", "Send Feedback" — same as current implementation
with Openray's links.

### 4.7 Cloud Sync / Organizations / Account

Cloud Sync (Pro badge): rows "Cloud Sync" (switch), "Synced Devices", "Synced Content" — all
disabled + "Not available in Openray". Organizations: empty-state text. Account: kept as the
sidebar-top account block (avatar/name/"Account") — non-navigating in Openray (signed-out
state), row content omitted (Raycast's account page is auth-bound). `(reconstructed)`

### 4.8 Extension pages (group 2 of the sidebar) — layout confirmed by screenshot 5 (Spotify Player)

Rendering rules for every page: titlebar right shows an "…" icon button + the extension's enable
switch (accent when on); intro block — 56px icon (radius ~14), 22px semibold title, 13px
secondary description centered with max-width ~500 clamped to 2 lines and a "Show More" /
"Show Less" chevron expander when the description is long; then preference rows in section cards
(auth rows like "Logged into Spotify" with a secondary "Logout" button appear here, as do
per-extension preferences such as "Close window on action"); then a "Commands" section header
(13px semibold) with one row per command — 22px command icon, 13px name, a 16px tertiary chevron
after the name for commands that have argument sub-pages, ghost "Add Alias" (~100px) and "Record
Hotkey" (~140px) placeholder cells, and a 16px enable checkbox at the far right; rows ~50px with
1px separators. Alias and hotkey cells behave like the Shortcuts table (recorder popover, inline
alias input). Extension disabled → whole content 50% opacity, pointer-events none.

- **Applications** (description "Quickly launch your installed applications."): rows "Auto Quit"
  (navigates to sub-page; description "Automatically quit apps shortly after you stop using
  them.") **N/A**, "Hotkey Action" dropdown Toggle Visibility/Always Show ("Behavior when
  triggering an application hotkey." — default `toggle`, real for Openray app hotkeys),
  "Search Scopes" (plus button opens folder dialog; list of default + user scopes with
  plus/minus toggles — maps onto File Search scopes), "Deep Search" switch Windows-only
  ("Search up to 3 levels deep inside added directories") — maps to File Search's index depth
  setting; then the per-installed-application command table.
- **Clipboard History**: current page content (hotkey, keep-history-for with the 9 durations,
  text recognition, recognition mode, ignore duplicates, behaviour, filters, disabled apps,
  maintenance) rendered with the new row visuals; values/keys unchanged.
- **Snippets / Quicklinks / Calculator / Translator / File Search / Window Management / Raycast
  Focus / Games / Notes / Taskbar**: current pages.ts content re-rendered in the new visuals;
  stores unchanged (these were verified working in prior sessions).
- **AI, Browser, Calendar, Contacts, Developer, Dictation, Emoji & Symbols, Remote, Screenshots,
  Script Commands, Windows Run, Windows Settings, Internal**: intro block + rows/empty state
  rendered disabled with the "Not available in Openray" hint (task item 3). Pro badge on AI
  and Dictation.

## 5. Live update contract

Raycast: the settings window writes the store optimistically, persists to localStorage + backend,
fans out per-key host IPC, and every other window subscribes to `subscribeUpdate<Key>` pushes.
Openray equivalent:

1. `settings.set(patch)` in the Node store: validates, merges, persists JSON, then broadcasts
   `settings.changed {keys}` on the existing NDJSON pipe to both windows.
2. Launcher subscribes: appearance/theme → re-render tokens; uiZoom → `--zoom`; windowMode →
   compact/expanded window sizing; popToRootTimeout → close timer; rootSearchSensitivity →
   matcher; show-openray-on → window placement; raycast-hotkey → host re-register; escape keys →
   Escape handler; fallback commands → root search fallback list; shortcuts aliases/hotkeys →
   command catalog; clipboard/snippets/etc. → their existing store paths.
3. Settings window subscribes to the same event (e.g. launcher edits a hotkey) and re-reads.
4. Hotkey registration failures roll back the stored value + toast (Raycast's openAtLogin/hotkey
   pattern).

## 6. Controls inventory (component list to build)

Switch, GhostSelect + popup menu, ButtonRadioGroup (Aa), WindowMode cards, HotkeyRecorder +
VisualShortcut keycaps, inline AliasInput, HotkeyCell button + clear + conflict dot, tri-state
Checkbox, small icon buttons, secondary/standout buttons, Filter dropdown (multi-select with
sections), command-picker popover with search, confirm dialog (existing alert host), toast
(existing), searchable sidebar + account block, collapsible category groups, virtualized table,
extension detail view (confirmed by screenshot: intro + Show More expander + enable switch +
"…" header button + preference/auth rows + Commands section with alias/hotkey/checkbox cells).

## 7. Accepted deviations (each with reason)

1. **Missing screenshots** for: dropdown-open state and hotkey-recorder states. Marked
   `(reconstructed)` from code; layout follows the same row/section system so only those states
   can drift. (Extensions detail, Advanced and the selected-extension state were confirmed by
   screenshots 5 and 6; markers removed.)
2. **Raycast Hotkey default**: Raycast default is the Win key; Openray keeps `Alt+Space`
   (Win-key interception needs a low-level keyboard hook that Openray's host does not have).
   Recorder, conflict flow, reset button and Replace-Start-Menu-style row are otherwise real
   (Openray shows no start-menu row; documented in §4.1).
3. **Import/Export settings** as Advanced rows instead of Raycast's standalone commands
   (task item 4 asked for it to work for real; placement differs).
4. **Theme Studio**, **Auto-Quit**, **Deep Search (3-level)** — features absent; rows disabled.
5. **Window size**: default 1200×760, min 720×480 (Raycast's is user-resized; captures compare
   at 1371×756).
6. **Fallback Commands storage** replaces the old textarea shape (migrated once).
7. **Extension pages below the fold** (Games, Notes, …) order taken as alphabetical per the
   visible prefix; exact Raycast order below "File Search" is not visible in any screenshot.
