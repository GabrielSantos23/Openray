# Focus, Games, Windows Taskbar — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.
These three internal extensions are grouped in one spec because their shipped Windows behavior is
partly host-native and partly gated; each has its own section and its own scope decisions.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~49471 (raycast-focus), @~54251 (games), @~163225 (windows-taskbar) | Extension blocks, commands, preferences, availability gates |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~749908 (toggle), @~1231k–1236k (focus forms), @~827k–833k (Game Launcher view) | Form fields, toasts, view strings |
| `artifacts/backend/index.mjs` @~3757k–3780k (focus session manager + built-in categories), @1010825 (host RPC `raycastFocus.*`), @~1953263/1931916/1960549 (games index, bitmask 2048), @~4913573 (mark-as-game/application), @4959361 (toggle-taskbar) | Session lifecycle, blocking delegation, game classification, taskbar toggle |
| `artifacts/frontend/window-shell-hosts-EYbE8QAm.js` @~26.9k–35k (FocusSessionPanel), taskbar host + widget registry @44754 | Focus panel UI, taskbar widgets, `windowsTaskbar.setEdge` |
| `settings-window-CpZLjTdD.js` @~55.7k | Taskbar settings rows |
| `artifacts/shell/Raycast.dll` (UTF-16LE strings) | `[Focus]` app-termination flow, `[FocusWebsite]` browser polling, focus panel portal, Game Mode suppression, taskbar window/ABM strings, `WindowsTaskbarExtensionMeta`, `GamesExtensionMeta`, `FocusExtensionMeta` |
| `games-settings-page-definition-BQFb0hhs.js` / `raycast-focus-settings-page-definition-BPulwIxh.js` | Settings rows |

## A) Raycast Focus

### Confirmed behavior

- Extension key `raycast-focus`, title `Raycast Focus`, description `Manage focus sessions and
  categories.` Preferences: `snoozeDurationMs` default 180000 (synced), `playSound` default true,
  `restoreAppsWhenSessionEnds` default false, `allowAllOnEmptyWebsiteAllowlist` default false.
- Commands: `start` (`Start Focus Session`), `toggle` (`Toggle Focus Session` — start from persisted
  last input, or complete + close when a session is running), `pause`, `resume`, `complete`, `edit`
  (`Edit Focus Session`), `searchCategories` (`Search Focus Categories`), `createCategory`
  (`Create Focus Category`, keywords `new focus category`), `importCategories`, AI extension
  `Ask Raycast Focus`, and a dynamic `session` command (root-search section `focus`, shown when
  empty; actions Edit / Restart / Complete / Pause (submenu 1/2/5/10 minutes + `Indefinitely`) /
  Resume / Cancel / `Move to Taskbar` / `Detach from Taskbar`).
- Start/Edit form fields: `Goal` (placeholder `What are you focusing on?`), `Duration` (label `No
  Limit`; suggestions `15 minutes`, `30 minutes`, `1 hour`, `1 hour 30 minutes`, `Until Noon`, `Until
  6 pm`, `Workday (8 am to 6 pm)`), `Mode` (`Block Apps & Websites` / `Allow Apps & Websites`), and a
  filter field labeled `Block`/`Allow` (placeholder `What apps or websites do you want to block?` /
  `...allow?`, sections `Focus Categories`, `Applications`, selected websites). Toasts: `Focus
  session started.` / `Focus session paused.` / `Focus session running.` / `Focus session updated.`;
  failures `Failed to ${start|toggle|update} focus session`, `Failed parsing website URL`.
- Category form: `Name & Icon` (placeholder `Name your focus category`, error `Title is required`),
  `Apps & Websites` filter field. Search Categories view: sections `Results`/`Custom`/`Built-in`,
  accessories `N website(s)` / `N app(s)`, actions Edit / Open / Copy Websites / Copy Apps / Export
  (`Exported Focus Category`) / Delete (confirm + `Deleted Focus Category`).
- Built-in categories (7): `Messaging`, `Gaming`, `Shopping`, `Social`, `Streaming`, `News`,
  `Travel`, each with Windows app ids (e.g. Messaging: WhatsApp, Telegram, Discord, Teams, Slack,
  Signal; Gaming: Steam, Epic, Xbox, GOG, Twitch hosts) and website hosts.
- Windows blocking mechanics (Raycast.dll strings): **app blocking = process termination** —
  `[Focus] Starting app blocking, {Count} Raycast app IDs, mode={Mode}`, `Requesting graceful quit
  for blocked app`, `Blocked app is still running; requesting force quit`, `Restoring previously
  terminated app` (the `restoreAppsWhenSessionEnds` feature re-opens terminated apps when the
  session ends). A blocked app launch shows a native toast `… has been blocked by Raycast` with
  actions (`This app`, `Snooze for N minutes|hours`, `1 hour`, `Indefinitely`, `Complete`, `Cancel`,
  `Resume`, `Pause`, `Detach from Taskbar`).
- **Website blocking = browser URL polling + redirect** to `https://raycast.com/focus-session?...`
  with a snooze callback (`[FocusWebsite]` log family). No overlay mechanism exists.
- Timer UI: floating panel (progress bar, timer pill with tick granularity ≤ 10 min → 1 s, ≥ 1 h →
  1 min, else 5 s; title fallback `Focus session`; no-limit icon; `Pause`/`Resume` with the five
  pause durations, `Complete`, ellipsis menu `Edit`, `Cancel`, `Move to Taskbar`, `Reset Panel
  Position`; draggable) or the taskbar tray (`presentation === 'menuBar'` on Windows).
- Session persistence: backend keeps the last start input and resumes timers on bootstrap; auto-
  completes expired sessions; auto-resumes timed pauses; presentation persisted under
  `FocusSessionLastPresentation`; frontend persists the last toggle input under
  `raycast-focus::last-start-input` (capped at 24 h). Max goal duration `1440 * 60 * 1e3` (24 h);
  default title `Focus session`.
- Settings rows: `Snooze Duration` (`1 minute`, `3 minutes`, `5 minutes`, `10 minutes`, `No Snooze`),
  `Play Sound`, `Allow all Websites` (`Allow all websites when a browser is allowed but no specific
  websites are listed.`), `Restore Terminated Apps` (`Reopen apps Raycast Focus terminated when the
  session ends.`).
- Pause submenu values: 60 000 / 120 000 / 300 000 / 600 000 ms + `Indefinitely` (`durationMs: null`).

### Unconfirmed (Focus)

- Whether HUD toasts fire on session start/end (the session surface is the panel/tray/toast window).
- The supported-browser list for website blocking (only "unsupported executable" logging is visible).
- Per-app snooze semantics from the blocked toast (`This app`).

### Our decisions (Focus)

| Item | Decision | Why |
| --- | --- | --- |
| Session store | `%LOCALAPPDATA%\RaycastMini\focus-session.json` (active session + last start input + presentation); categories in `%LOCALAPPDATA%\RaycastMini\focus-categories.sqlite` (title, icon, website_hosts, app_ids, builtin) | Only one active session exists in Raycast; JSON is the same convention as settings files. Categories need CRUD + filtering. |
| App blocking | Host watch loop (500 ms, foreground only): a blocked app that comes to the foreground is NOT closed — a fullscreen black overlay covers it; switching focus to another window while the overlay shows closes the app (graceful → force after 5 s), and terminated apps re-launch on session end when `restoreAppsWhenSessionEnds` is on. Product decision (2026-10-11), overriding the shipped terminate-on-match flow. |
| Blocked-app surface | Fullscreen overlay (per the blocked app's monitor): bullseye mark, `X has been blocked by Raycast Mini`, a `Snooze for N minutes` button (the session's `snoozeDurationMs`), `Switching focus to another window will close this app.` Snoozing allows the app for that duration. Product decision (2026-10-11) — the user wants the app visible under the overlay, matching the shipped screenshot. |
| Website blocking | Pending (not implemented) | Requires per-browser URL polling integrations; the mechanism is confirmed but the browser surface is unconfirmed. |
| Timer panel | Native WPF pill panel (draggable by the 2×3 dot grip) with the two shipped variants: idle shows only the title pill (green mark + session title + remaining time); hovering expands it with the thin progress bar (timed sessions) and the `Pause ⏸ / Complete ✓ / ⋯ / grip` row. ⋯ opens Edit / Cancel / Move to Taskbar / Reset Panel Position; Pause opens the five durations; dark context menus app-wide; the panel is activatable so menus receive clicks. Matches the confirmed FocusSessionPanel screenshots. |
| `Move to Taskbar` presentation | A real notification-area icon (Shell_NotifyIcon, green Focus badge, tooltip "Raycast Mini Focus"); left/right-click opens the session menu at the mouse — header, Pause (submenu with the five durations), Complete, Cancel, Detach from Taskbar. Implemented 2026-10-11 per the user's screenshots. |
| Duration parsing | Free-text grammar: `Nm`, `Nh`, `Nh Nm`, `Nh30`, `until <time>`, `workday`; suggestions exactly as confirmed; max 24 h enforced | Confirmed suggestions + max duration. |
| Sounds | Session end plays a system sound when `playSound` is on | `Play Sound` pref confirmed; exact sound unconfirmed. |
| `Allow all Websites` / website category hosts | Preference stored but non-functional until website blocking lands (row hidden) | Honest pending state instead of a mock toggle. |

### Focus implementation checklist

- [x] Backend: `focus.js` — session lifecycle (`start|toggle|pause|resume|complete|cancel|restart|
      update|getSession`), auto-complete/auto-resume on bootstrap, category store, namespace `focus.*`
- [x] Host: `FocusSession.cs` — blocking watch loop, graceful→force termination, restore on end,
      focus panel window (WPF), blocked-app push
- [x] Frontend: Start/Edit forms, Search/Create/Edit/Import category views, dynamic session row
- [x] Settings page rows: Snooze Duration, Play Sound, Restore Terminated Apps
- [x] Tests: session state machine (start/pause/resume/complete/expiry), duration parser cases,
      category CRUD, blocked-app matching by app rules (backend `focus.test.mjs`, frontend
      `focus-games.test.mjs`)

### Focus manual test checklist

1. Start a 1-minute session with a blocked app (e.g. Notepad): the panel appears with a progress bar;
   launching Notepad closes it (graceful) and shows the blocked HUD toast; the app re-opens when the
   session ends (Restore Terminated Apps on).
2. Pause via the 1-minute menu entry: the timer freezes and resumes automatically.
3. Toggle command: starts with the last input; toggling again completes the session.
4. Sessions survive an app restart (session resumed from `focus-session.json`).
5. Categories: create/search/delete with the confirmed strings; built-in categories are listed but
   not deletable.

## B) Games

### Confirmed behavior

- Extension key `games`, title `Games`, description `Quickly launch your installed games.`,
  windows-gated. Preference `gameModeEnabled` default false (platform storage).
- Command `searchGames` — title **`Game Launcher`**, description `Launch games from Steam, Epic,
  Xbox, Riot, and more.`, view-command → `/extension/games/search`.
- Dynamic `game` command per game entry: title = game name, keywords `[game, games, bundleId, name,
  path]`, root-search section `apps`. Actions: `Open Game` (primary), `Run as Administrator`
  (tertiary shortcut), `Show in File Explorer`, `Copy Path`, `Copy Name`, `Copy Bundle Identifier`,
  `Treat as Application`, `Hide Game`, `Quit Game`, `Force Quit Game`, `Restart Game`, `Uninstall
  Game`, `Disable Command`. The Applications extension has the inverse `Treat as Game` action
  (`Marked as game` / `Marked as application` toasts).
- Classification: app-index entries with content-type bit 2048 and a raycastAppId are games;
  `getAllGames` lists them; `getGame` fuzzy-matches with frecency ranking.
- Launcher scanning lives in the C# host: Steam (`steam://rungameid/`, appmanifest), Epic
  (`EpicGameManifest`, `com.epicgames.launcher://apps/`), Xbox/GamingApp, Riot, itch.io,
  Battlestate, EA (`C:\Program Files\EA Games`), Rockstar (`SOFTWARE\WOW6432Node\Rockstar Games`),
  Ubisoft (`Ubisoft Game Launcher`), Blizzard, Roblox, GOG — registry/manifest-based install
  detection with install/uninstall logging.
- **Game Mode** = hotkey suppression while a game window is foreground: `Game in foreground:
  {IsGameInForeground}` + `Failed to set hotkeys suppressed={Suppressed}` +
  `uiaccess_set_hotkeys_suppressed` — the native host watches the foreground window and suppresses
  Raycast hotkeys while a game is in front.
- Game Launcher view: placeholder `Search games…`; empty query sections `Suggestions` (first 5),
  `Games`, `Game Launchers`; with query `Results`. Game-vs-launcher classification by launcher
  executable set (Steam.exe, EpicGamesLauncher.exe, GalaxyClient.exe, UbisoftConnect.exe,
  Battle.net Launcher.exe, EADesktop.exe, itch.exe, RiotClientServices.exe, BsgLauncher.exe,
  GeForceNOW.exe, …) and launcher-name set (`battle.net`, `steam`, `epic games launcher`, `gog
  galaxy`, `ubisoft connect`, `xbox`, …). Empty states `Unable to Load Games` / `No Games Found` /
  `No Results` / `Try a different search term.` ActionBar label `Game Launcher`.
- Settings: single row `Game Mode` — `Disable Raycast hotkeys while a game window is detected in the
  foreground.` (keywords `[disable hotkeys]`), windows-gated.

### Unconfirmed (Games)

- The Game-Mode trigger scope (fullscreen-only vs any game-listed executable in foreground).
- How scanned games receive the Game content-type bit (native indexer side).
- Whether any in-game overlay/HUD exists beyond hotkey suppression.

### Our decisions (Games)

| Item | Decision | Why |
| --- | --- | --- |
| Game index | Games = applications flagged as games in the existing applications store (new `isGame` flag with bit semantics mirroring content-type 2048); `Treat as Game` / `Treat as Application` actions flip it (toasts `Marked as game` / `Marked as application`) | The confirmed user-facing classification mechanism; launcher scanning is separate. |
| Launcher scanning | Pending (Steam/Epic/Xbox/... manifests and registry not parsed) | Large launcher-specific surface with unconfirmed details; the confirmed mechanism is documented but not reproduced. |
| Game Launcher view | Implemented over the flagged-application index with the confirmed sections/empty states/placeholder | Confirmed UI. |
| Game Mode detection | **Fullscreen-proxy**: hotkeys are suppressed while the foreground window is borderless-fullscreen covering a monitor (documented delta), regardless of the game list | The exact trigger is unconfirmed; fullscreen detection is deterministic and testable. Documented as our deviation. |
| Game actions | Open, Run as Administrator (host route with `runas` verb), Show in File Explorer, Copy Path/Name, Hide Game | The confirmed action set minus launcher-management actions (Quit/Force Quit/Restart/Uninstall) which need per-launcher knowledge — pending with launcher scanning. |

### Games implementation checklist

- [x] Backend: `isGame` flag + `mark-as-game`/`mark-as-application` handlers + `games.list`
- [x] Frontend: Game Launcher view (confirmed strings/sections) + `Treat as Game` action on
      Applications rows
- [x] Host: fullscreen detection + hotkey suppression wired to `gameModeEnabled`
- [x] Settings page: Game Mode row
- [x] Tests: flag flip handlers, launcher-vs-game classification lists; fullscreen detection
      verified manually (host-side)

### Games manual test checklist

1. Flag an application as a game (toast `Marked as game`); it appears in Game Launcher under
   `Games`; un-flagging returns it to Applications only.
2. `Open Game` launches the executable; `Run as Administrator` triggers the UAC prompt.
3. With Game Mode on and a fullscreen game/app in front, the launcher hotkey does nothing; exiting
   fullscreen restores it.
4. Search filters with the confirmed empty states.

## C) Windows Taskbar

### Confirmed behavior

- Extension key `windows-taskbar`, title `Taskbar`, description `Customizable taskbar behaviour.`,
  **availability `{windows:'internal'}`** — internal/dev-channel gating in Raycast's own build.
- Command `toggleTaskbar` — `Toggle Taskbar Window` (subtitle `Taskbar`), description `Show or hide
  the taskbar window.`, keywords `[bar, show, hide]`; toasts `Taskbar Window Shown` / `Taskbar Window
  Hidden`.
- Config: `showTaskbar` default false (synced), `position` default `bottom` (top/bottom/left/right),
  `sidebar` default false, `compact` default false, `size` default `regular` (smallest/small/regular/
  large/largest), widgets default `{start:['raycast','weather'], center:['desktops'],
  end:['menuBar','media','volume','clock']}`.
- Widget registry: `clock` Clock, `desktops` Virtual Desktops, `media` Media, `menuBar` Menu Bar
  Commands (**disabled in this build**), `raycast` Raycast, `volume` Volume, `weather` Weather.
- Window mechanics: a portal window re-parented on a screen edge; thickness per size
  (`bar: 32/40/48/56/64`); host call `windowsTaskbar.setEdge({edge, thickness, compact})`; native
  taskbar interplay strings (`Shell_TrayWnd`, auto-hide messages, `Unexpected taskbar edge`); a
  General Settings row `Automatically Show the Taskbar` exists.
- Settings rows: `Show Taskbar Window`, `Position` (Top/Bottom/Left/Right), `Sidebar Mode`
  (`Widen the taskbar so widgets can show labels, titles and groups instead of icons alone.`),
  `Compact Mode` (`Shrink the taskbar to a centered panel around its widgets.`), `Size` (5 ticks),
  `Widgets` (drag-and-drop into `Start`/`Center`/`End`).

### Unconfirmed (Taskbar)

- Whether availability is additionally server-flag-gated per user.
- The Weather widget's data source/entitlement.
- The exact native-taskbar auto-hide interop mechanism (ABM state messages inferred from strings).

### Our decisions (Taskbar)

| Item | Decision | Why |
| --- | --- | --- |
| Scope | Minimal real strip: edge-anchored topmost WPF window with space reservation via `SHAppBarMessage` (ABM_NEW/ABM_SETPOS), widgets = `clock` and `raycast` (launcher toggle button) only | Raycast's is internal-gated with seven widgets requiring media/weather/desktops stacks the clone lacks; a real, functioning strip with two widgets beats a mock of seven. Widgets beyond clock/raycast are pending, not mocked. |
| Toggle command | `toggleTaskbar` with the confirmed HUD toasts, wired to `showTaskbar` | Confirmed. |
| Settings rows | `Show Taskbar Window`, `Position` | Sidebar/compact/size/widgets rows pending with their widgets. |
| Weather / media / volume / desktops widgets | Pending | Need data sources that do not exist yet in the clone. |

### Taskbar implementation checklist

- [x] Host: `TaskbarWindow.cs` — AppBar registration, edge anchoring, DPI-aware sizing
- [x] Taskbar content: clock widget + Raycast Mini toggle button (native WPF markup per decision)
- [x] Backend: `toggle` handler + settings persistence (`showTaskbar`, `position`)
- [x] Settings page rows: Show Taskbar Window, Position
- [x] Tests: toggle handler state, settings round-trip; window placement verified manually

### Taskbar manual test checklist

1. `Toggle Taskbar Window` shows a strip docked to the bottom edge that reserves space (maximized
   windows do not cover it); HUD toast `Taskbar Window Shown`; toggling again hides it.
2. Position setting Top/Bottom/Left/Right moves the strip; other windows respect the reserved edge.
3. The clock shows the current time; the Raycast button opens the launcher.
4. After an app restart with `showTaskbar: true` the strip re-appears.

## Implementation status (2026-10-11)

All three sub-extensions are implemented and running; suites green (130 backend + 27 frontend
tests, 0 failures). Every behavior below that is not tagged "confirmed" is one of the decisions
from the tables above, stated plainly.

### Focus — what shipped

- Session state machine on the backend (`focus.*`): start/update/toggle/pause/resume/restart/
  complete/cancel with the shipped semantics — toggle from the backend pauses a running session
  and resumes a paused one, while the **Toggle Focus Session root command completes a running
  session and starts from the last input when none is running** (confirmed frontend handler
  `toggle-focus-session`); timed sessions auto-complete on expiry and on bootstrap; timed pauses
  auto-resume; a session that expired while the app was closed auto-completes on start.
  Confirmed against the shipped manager: the public state shape
  (`id/title/status/mode/presentation/pauseEndsAt/startedAt/targetEndAt/effectiveEndAt/remainingMs`),
  the 24 h cap (`1440*60*1e3`), the default title `Focus session`, pause submenu durations
  (60 000/120 000/300 000/600 000 ms + Indefinitely), and the default start input
  (`block` mode, `snoozeDurationMs: 180000`, no-limit goal).
- Session persistence: `focus-session.json` (active session + last start input + presentation);
  the frontend mirrors the shipped `raycast-focus::last-start-input` localStorage key with the
  same 24 h cap for the toggle command.
- Categories: SQLite store with the seven built-ins upserted verbatim from the shipped artifact
  (ids, titles, icons, website hosts, windows app ids), custom CRUD with slugified unique ids,
  accessed-at tracking on filter resolution, and the confirmed guardrails (built-ins resist
  update/delete; a custom category reusing a built-in id suppresses the built-in upsert).
- App blocking: the backend normalizes every blocked app identifier into match rules
  (`path:` → exe path + exe name; bare `X.exe` → exe name; package/bundle id → exe base name) and
  sends them with `focus.startSession`; the host watch loop (2 s) asks matched processes to close
  gracefully and force-kills after a grace period, remembers terminated processes, and re-launches
  them on completion when `restoreAppsWhenSessionEnds` is on. A blocked process pushes
  `focus.blockedApp` and the launcher toasts `X has been blocked by Raycast Mini` (our decision;
  no interactive snooze actions).
- Timer panel: native WPF borderless topmost draggable panel (bottom-right default) with the
  confirmed controls — progress bar (timed sessions), the confirmed tick granularity
  (≤ 10 min → 1 s, ≥ 1 h → 1 min, else 5 s), title fallback `Focus session`, Pause/Resume with
  the five pause durations, Complete, Cancel. Panel buttons route through the renderer into the
  backend state machine.
- Views: Start/Edit session form (Goal `What are you focusing on?`, Duration with the seven
  confirmed suggestions and the free-text grammar `Nm/Nh/Nh Nm/Nh30/until <time>/workday`,
  Mode `Block|Allow Apps & Websites`, filter field with the confirmed placeholders and sections);
  Search Focus Categories (`Search focus categories...`, Results/Custom/Built-in, the confirmed
  `N website(s)` / `N app(s)` accessories, empty state `No Focus Categories Found` with both
  confirmed descriptions, actions Edit/Open/Copy Websites/Copy Apps/Export/Delete with the
  shipped toasts and the shipped export JSON shape); Create/Edit/Open category form
  (`Name & Icon`, `Title is required`); Import with the export shape. The dynamic `session` root
  row shows in the `Focus` section with an empty query while a session runs, with Edit/Restart/
  Complete/Pause/Resume/Cancel actions.
- Settings: Snooze Duration (confirmed labels), Play Sound, Restore Terminated Apps.
  `Allow all Websites` is hidden per the decision table (non-functional until website blocking
  lands).

Focus deltas (confirmed behavior not reproduced, updated 2026-10-11): website blocking (URL
polling + redirect) is pending; app blocking intentionally deviates from the shipped
terminate-on-match flow (overlay + snooze + close-on-focus-switch instead — see the decision
table); the category `Open` action opens the
read-only form instead of the shipped open-mode navigation; toasts `Focus session completed` /
`cancelled` for the complete/cancel root actions use plain past tense (the shipped completion
toast strings were not extractable); the session row's pause submenu is flattened into five
actions because the action panel has no submenu support.

### Games — what shipped

- The `isGame` flag store (`game-flags.json`) over the host application list with the confirmed
  `mark-as-game` / `mark-as-application` semantics and toasts (`Marked as game` /
  `Marked as application`); `games.list` merges flags onto `applications.getAll` and filters
  hidden ids (`Hide Game`, toast `Hidden Game` — our string; the shipped toast was not
  extractable).
- Game Launcher view (`searchGames`): confirmed placeholder `Search games…`, empty-query sections
  `Suggestions` (first five non-launcher games) / `Games` / `Game Launchers`, `Results` while
  searching, the confirmed empty states (`Unable to Load Games` / `No Games Found` / `No Results`
  + `Try a different search term.`), the ActionBar label `Game Launcher`, and the confirmed
  launcher classification sets (Steam.exe, EpicGamesLauncher.exe, GalaxyClient.exe, … plus the
  launcher-name list). Actions implemented: Open Game, Run as Administrator, Show in File
  Explorer, Copy Path/Name/Bundle Identifier, Treat as Application, Hide Game. Dynamic `game`
  rows are filed under the Applications section while searching (confirmed section `apps`).
- Game Mode: the fullscreen-proxy from the decision table — a borderless fullscreen foreground
  window suppresses every registered hotkey (launcher, Clipboard History, Window Management
  commands) by unregistering them and re-registering the identical combinations on exit;
  `gameModeEnabled` persists in the backend (`games-settings.json`) and re-applies at startup.
- Settings: Game Mode row with the confirmed description.

Games deltas: launcher scanning (Steam/Epic/Xbox/... manifests) is pending — games are only what
the user flags; Quit/Force Quit/Restart/Uninstall Game actions are pending with it; the shipped
frecency ranking for `getGame` is not reproduced (the clone filters with the shared term matcher).

### Windows Taskbar — what shipped

- `TaskbarWindow.cs`: an edge-anchored topmost WPF strip registered as an application desktop bar
  (SHAppBarMessage ABM_NEW/ABM_SETPOS) so maximized windows respect the reserved edge, with the
  `regular` thickness from the confirmed bar scale (48 px horizontal, 64 px vertical edges) and
  DPI-aware sizing. Widgets: a live clock and a Raycast Mini button that opens the launcher —
  exactly the decision-table scope; the other five widgets stay pending, not mocked.
- `toggleTaskbar` (Toggle Taskbar Window, keywords bar/show/hide) flips the persisted
  `showTaskbar` and drives `taskbar.show`/`taskbar.hide` with the confirmed toasts
  `Taskbar Window Shown` / `Taskbar Window Hidden`; the Position setting re-anchors the strip via
  ABM_SETPOS. Settings persist in `taskbar-settings.json` and re-apply at startup. Sidebar/
  compact/size/widgets rows are pending with their widgets.

Taskbar deltas: only the clock and Raycast widgets; the native-taskbar auto-hide interop
(Shell_TrayWnd messages) is not implemented — space reservation relies on the AppBar contract
alone.

### Tests

- Backend `tests/focus.test.mjs` (12): built-in upsert, custom-vs-builtin guardrails, CRUD,
  filter resolution, app-rule normalizer, the full session lifecycle with host-sync assertions,
  auto-complete/auto-resume timers, update keeping elapsed time, restart semantics, persistence
  restore across instances, preference defaults (snooze 180 000 ms etc.).
- Backend `tests/games-taskbar.test.mjs` (8): flag flips, hidden games, payload merge without
  mutation, Game Mode persistence + host forward, taskbar defaults/position validation, toggle
  host routes, startup re-apply.
- Frontend `tests/focus-games.test.mjs` (8): duration grammar (minutes/hours/combos/glued, clock
  targets rolling to tomorrow, workday, >24 h rejection), duration formatting, preference merge
  for the toggle command, launcher classification sets, Suggestions partitioning, term filtering.
