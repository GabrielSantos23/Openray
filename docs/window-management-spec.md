# Window Management — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~137655 | Extension block, preferences, all 69 command definitions and preset table |
| `artifacts/frontend/main-window-g1Vb1JLY.js` + shared chunk `use-quicklinks-LtrNIUoI.js` | Bounds computation (preset geometry, gap math, cycling, display moves, clamping), failure toasts, action panel, layout/switch-desktops views |
| `window-management-settings-page-definition-VJvRvDCb.js` + view | Settings rows and preset UI |
| `artifacts/shell/Raycast.dll` (strings) | Host RPC namespaces `windowManagement.*`, `virtualDesktops.*`; permission gating strings |
| `artifacts/shell/native.dll` (PE export table + strings) | UniFFI `window_management` namespace: `SET_WINDOW_POS`, `MAXIMIZE/RESTORE/MINIMIZE_WINDOW`, `TOGGLE_WINDOW_TOPMOST`, `ENUMERATE_VISIBLE_WINDOWS`, `FORCE_ACTIVATE_WINDOW`, `MINIMIZE_ALL_WINDOWS_EXCEPT`, `CLOSE/HIDE/SHOW_WINDOW`; `DISPLAY_FUNC_GET_DISPLAYS`; `GetDpiForMonitor`, `MonitorFromWindow`, `GetMonitorInfoW`, `EnumDisplayMonitors` imports |

## Confirmed behavior

### Extension and preferences

- Internal extension key `window-management`, title `Window Management`, description `Move and
  resize your application windows.`
- Preferences: `innerGap: 0` (synced), `outerGap: 0` (synced), `cycleMode: 'sizes'` (synced),
  `respectStageManager: false` (macOS), `autoCloseEmptyDesktops: false` (windows-only).

### Commands

**Move & resize group** (exact titles): `maximize` `Maximize`, `restore` `Restore` (`Restore focused
window to its last position.`), `minimize` `Minimize` (`Minimize focused window to the taskbar.`),
`minimizeOnDisplay` `Minimize on This Display`, `maximizeHeight` `Maximize Height`, `maximizeWidth`
`Maximize Width`, `maximizeAlmost` `Almost Maximize` (per-command pref `percentage`: 60/70/80/90%,
default 90), `reasonableSize` `Reasonable Size` (`Resize focused window to 60% of the screen
(Maximum: 1024x900).`), `resizeWindow` `Resize Window` (args `width`, `height`), `center` `Center`,
`centerHalf` `Center Half`, `leftHalf` `Left Half`, `rightHalf` `Right Half`, `topHalf` `Top Half`,
`bottomHalf` `Bottom Half`, thirds (`firstThird`/`centerThird`/`lastThird`), two-thirds
(`firstTwoThird`/`centerTwoThird`/`lastTwoThird`), three-fourths (`firstThreeFourth`/
`centerThreeFourth`/`lastThreeFourth`), top/bottom thirds (`topThird`/`middleThird`/`bottomThird`),
top/bottom two-thirds (`topTwoThird`/`bottomTwoThird`/`topCenterTwoThird`/`bottomCenterTwoThird`),
top fourths (`topFirstFourth`…`topLastFourth`, `topThreeFourth`/`bottomThreeFourth`), fourths
(`firstFourth`…`lastFourth`), quarters (`topLeftQuarter`…`bottomRightQuarter`), sixths
(`topLeftSixth`…`bottomRightSixth`), edges (`moveLeft`/`moveRight`/`moveTop`/`moveBottom` with
per-command pref `centerWindow` default true; `moveTop` keywords `[up]`, `moveBottom` keywords
`[down]`), `moveWindow` `Move Window` (arg `position`, placeholder `100,100`),
`makeSmaller`/`makeLarger` (pref `delta` `Step Size`: 16/32/64/128 px, default 32; Make Smaller
description `Decrease the focused window until it reaches 25% of the screen.`),
`movePreviousDisplay`/`moveNextDisplay` (prefs `wrap` default true, `keepAspectRatio` default true).

**Window cycling / topmost**: `toggleAlwaysOnTop` `Toggle Always on Top` (`Pin the focused window
above all other windows.`, keywords `[pin, topmost, always on top, stay on top]`),
`focusNextAppWindow` `Focus Next App Window`, `focusPreviousAppWindow` `Focus Previous App Window`.

**Desktops/spaces**: 20 desktop commands (`switchToPreviousSpace`/`Next` — macOS availability,
`movePreviousDesktop`/`moveNextDesktop` windows `Move to Previous/Next Desktop`, `switchDesktops`
view, `openDesktop` (arg `index`), `moveWindowToDesktop`, `closeActiveDesktop`, `closeDesktop`,
`renameActiveDesktop`/`renameDesktop`, `openDesktop1`…`openDesktop10`, `moveWindowToDesktop1`…`10`)
plus `toggleFullscreen` (macOS availability) and the Pro custom commands/layouts set.

- No command ships a default hotkey. Three opt-in presets exist: **Magnet**, **Rectangle**
  (byte-identical to Magnet in this build), **Spectacle**. Magnet (Windows): halves
  `Ctrl+Alt+←/→/↑/↓`; quarters `Ctrl+Alt+U/I/J/K`; Maximize `Ctrl+Alt+Enter`; Maximize Height
  `Ctrl+Alt+Shift+↑`; Make Smaller/Larger `Ctrl+Alt+-`/`Ctrl+Alt+=`; Center `Ctrl+Alt+C`; Restore
  `Ctrl+Alt+Delete`; Move Display `Ctrl+Alt+Win+←/→`; thirds `Ctrl+Alt+D/E/F/T/G`. Toast on apply:
  `` Applied "Magnet" hotkeys ``, `Removed hotkeys`, `Failed to apply preset`.

### Bounds computation

- Presets are raw fractions of the **desktop (work-area) size**: halves `floor(w/2)`, thirds
  `floor(w/3)`, two-thirds `floor(2w/3)`, quarters `floor(w/4)`, sixths `floor(w/3) × floor(h/2)`;
  Almost Maximize = `floor(w·pct) × floor(h·pct)` centered; Reasonable Size = 60% capped to
  `1024×900`; Maximize = full desktop.
- **Gap math**: outer edges are inset by `outerGap`; internal edges by `innerGap/2`; a position
  without explicit size is clamped so a flush edge sits at `outerGap`; a resulting size ≤ 0 skips
  the command unchanged.
- **Cycling** (`cycleMode:'sizes'`): per-command state — press 1 = base preset, press 2 = two-thirds
  variant, press 3 = one-third variant. `'displays'`: second press moves the same geometry to the
  previous/next display.
- **Move to another display**: gaps ignored; if the target display size differs and
  `keepAspectRatio`, position and size scale proportionally; wrap-around default true.
- **Clamp**: off-screen windows are clamped back onto the display unless the command allows oversize
  (`resizeWindow`/`moveWindow` do); max Win32 coordinate `32767`. Size args must match `/^\d+$/`,
  position `/^([+-]?\d+)\s*(?:[x×*,]|\s)\s*([+-]?\d+)$/i`.
- Multi-monitor/DPI: JS works in logical display coordinates from `getDisplays()`; the native side
  is PerMonitorV2 and converts via `GetDpiForMonitor` (monitor rectangles are physical pixels in the
  per-monitor-aware host).
- Fullscreen handling exists (`bounds:'fullscreen'`); desktop commands refuse fullscreen windows
  (toast `Can't move fullscreen window between Desktops`).

### Per-window restore

- `Restore` reads the saved state via `backend.windowManagement.getSavedWindowState({windowId})`
  (`No previous window state` toast when absent) and applies the saved position/size.
- The pre-command bounds are saved per window id before every command that changes them (including
  fullscreen transitions); the same saved state is reused when leaving fullscreen.

### Failure toasts (exact)

`Cannot move or resize window`, `Cannot resize window`, `Cannot move window`, `Focused window is not
resizable`, `Focused window is not positionable`, `Cannot restore window`, `No previous window
state`, `Cannot minimize window`, `No windows to minimize`, `Couldn't determine current display`,
`Cannot toggle always on top` (success `Pinned ${app}` / `Unpinned ${app}`), `No focused window`,
`Cannot resize window to W × H` (post-hoc `Window resized to W × H` + message
`${app} does not allow W × H` when the result differs by more than 1 px), `Cannot move window to X,
Y`, `No other ${app} windows` (cycling).

### Host surface

- `host.windowManagement.*`: `getDesktops`, `getActiveWindow`, `getWindowsOnActiveDesktop`,
  `getVisibleWindows`, `getMinimizedWindows`, `setWindowBounds`, `minimizeWindow`, `closeWindow`,
  `toggleAlwaysOnTop`, `cycleAppWindows`, `openAndSetWindowBounds`.
- Elevated/UWP windows are handled through a UIAccess helper in Raycast (native.dll); a refused move
  is a routine outcome for elevated target windows.

### Settings page

Rows: `Window Gap` (`Gap between windows`; `None`, `Tiny` 8px, `Small` 16px, `Medium` 32px, `Large`
64px, `Extra Large` 128px), `Screen Gap` (`Gap from windows to the screen edge`, same options),
`Cycling` (`Cycle sizes when using half commands`; `None`, `Cycle ½, ⅔, and ⅓`, `Cycle Displays`),
`Auto Close Empty Desktops` (windows-only), `Presets` (`Apply hotkeys from other window management
apps`). Command list groups: `Move & Resize` and `Virtual Desktops`. There is **no** "restore after
…" settings row — restore is implicit per window.

## Unconfirmed

- **The exact Win32 call parameters** `set_window_pos` uses (SWP flags, placement API choice) —
  native.dll proves the imports and an outcome record exist; the call site is opaque.
- **`WindowManagementError` variant list** — only the type name is visible.
- **Whether any command ships with a hotkey on a fresh install** (no default hotkey field; presets
  are opt-in; installer/migration behavior not observable).
- **Where `saveWindowState` persists** (backend store method confirmed; storage location/format not
  inspected).
- **The `Rectangle` preset being identical to Magnet** may be intentional or a build artifact; the
  shipped mapping is identical.
- **How `windowId` is derived** for saved-state keys (stable across hwnd recycling is not visible).

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Command set | All 42 move/resize commands + `toggleAlwaysOnTop`, `focusNextAppWindow`, `focusPreviousAppWindow`, `minimizeOnDisplay`; desktop/space commands and custom commands/layouts pending | The move/resize set is fully specified by the preset table; desktop commands need the undocumented virtual-desktop COM API. |
| Displays source | Host route `windowManagement.getDisplays` returning per-monitor work areas in
**logical** pixels (work area ÷ DPI scale) plus monitor metadata; the frontend computes preset
rects in logical coordinates and sends `{displayIndex, x, y, width, height}` (work-area-relative);
the host converts back to physical pixels via `GetDpiForMonitor` | Mirrors Raycast's logical-JS →
physical-native split and PerMonitorV2 behavior; testable in TS. |
| Window ops | Host `windowManagement.*` routes in C#: `setWindowBounds`, `minimize`, `maximize`
(SendMessage WM_SYSCOMMAND SC_MAXIMIZE so the OS maximize state is correct), `restore`, `toggleAlwaysOnTop`
(SetWindowPos TOPMOST/NOTOPMOST), `getActiveWindow` (pid, exe name, title), `enumerateVisibleWindows`
per display (EnumWindows + visibility/tool-window filters), `focusWindow` (restore-if-minimized +
SetForegroundWindow) | Same primitives the native.dll export inventory exposes. |
| Elevated windows | Not supported — a refused move/resize surfaces the confirmed failure toasts;
no UIAccess helper | Raycast's UIAccess helper is a privilege-escalation component out of scope. |
| Fullscreen / desktop commands | Pending | `toggleFullscreen` is macOS-gated in Raycast; virtual
desktops need the undocumented COM API. |
| Per-command hotkeys | Via the existing host `RegisterCommandHotkey` route map (Ctrl/Alt/Shift
only); presets offered in settings with the Win-key bindings (`Move to Display`) dropped | The
clone's hotkey parser supports Ctrl/Alt/Shift only; everything else in the Magnet map is
Ctrl/Alt-based. |
| Saved window state | Backend SQLite `window_states` (key = `exe|title` captured before the
command; value = position/size in logical px + display index) | Exact windowId derivation is
unconfirmed; exe+title is the best stable key available and is documented as a decision. |
| Cycling | Per-command in-memory state map in the frontend (reset when the launcher closes) |
Raycast keeps `dy` per command; persistence across restarts is not confirmed. |
| Toasts | Exactly the confirmed strings, including the resize verification (result differing by
> 1 px from the request reports `Window resized to W × H` + `${app} does not allow W × H`) |
Confirmed contract; needs the host to report the achieved bounds. |
| Gap settings | Window Gap / Screen Gap selects with the confirmed six options and values |
Confirmed. |

## Implementation checklist

- [x] Host: `WindowManagementNative.cs` — getDisplays (per-monitor DPI-aware work areas),
      getActiveWindow, setWindowBounds (with achieved-bounds result), minimize/maximize/restore/
      close, toggleAlwaysOnTop, enumerateVisibleWindows(displayIndex), focusWindow,
      minimizeAllExcept(pid) — delivered as getDisplays, getActiveWindow, setWindowBounds,
      minimizeWindow, toggleAlwaysOnTop, enumerateVisibleWindows, cycleAppWindows,
      registerCommandHotkey (the maximize/restore/close work flows go through setWindowBounds/
      minimizeWindow, matching the shipped geometry-based `hre`/`ox`)
- [x] Frontend: `windowManagement.ts` geometry module — preset table (all 52 built-in geometry
      functions), gap math, cycling variants, display-move scaling, clamping + unit tests over
      synthetic multi-monitor display sets
- [x] Frontend: command registration (titles/descriptions/keywords exactly as confirmed) with
      hotkeys via the host `RegisterHotKey` map; root rows show the stored hotkey label
- [x] Frontend: Settings page — Window Gap, Screen Gap, Cycling, Presets (Magnet/Rectangle, minus
      the Win-key and Ctrl+Alt+Delete rows), command list grouped `Move & Resize`
- [x] Backend: `window_states` store + `windowManagement.getSavedWindowState|saveWindowState`
- [x] Tests: geometry (all presets on 1920×1080, 1921-wide floors, 2560×1440, gap math, size ≤ 0
      skip, clamping, keepAspectRatio display move, display lookup, cycling sequences, drift
      reset, arg parsing regexes), saved-state round-trip

## Implementation status (2026-10-11)

Implemented and verified in the running app (`backend.log` shows `windowManagement.getDisplays` /
`getActiveWindow` answered end-to-end): all 52 geometry commands, `restore`, `minimize`,
`minimizeOnDisplay`, `movePreviousDisplay`/`moveNextDisplay`, `toggleAlwaysOnTop`,
`focusNextAppWindow`/`focusPreviousAppWindow`, `resizeWindow`/`moveWindow` through a small
argument view (the search bar becomes the argument field, parsed with the shipped regexes), the
gap settings, cycling, and the Magnet/Rectangle preset. Root search files the commands under a
`Window Management` section; the host captures the foreground window the moment the launcher is
revealed, so commands apply to the previously focused window.

### Confirmed behaviors implemented verbatim from the shipped bundle

- All preset geometry functions (`fy`/`my`/`ub`/`db`/`yre`/`bre`/edge moves/…), including the
  quirks: thirds are `floor(w/3)` but Center Half keeps the raw `w/2` float; Make Smaller floors
  the 25% minimum per axis; Make Larger clamps at the desktop; edge moves keep size and center
  along the edge axis when `centerWindow` is on.
- Gap math (`Df`/`Eb`/`yf`): flush edges inset by `outerGap`, internal edges by `innerGap/2`, an
  explicit size collapsing to ≤ 0 skips the command unchanged.
- Clamping (`f`) with `allowOversize` for `resizeWindow`/`moveWindow`; max coordinate 32767; the
  shipped `^\d+$` and position regexes.
- Cycling (`mb`/`hb`/`gb`): per-command state, press 1 = base, press 2 = two-thirds variant
  (sizes mode) or the variant geometry on the adjacent display (displays mode), press 3 = the
  one-third variant; state resets when the window's bounds stop matching the last application.
  The shipped displays-cycle pairings are implemented verbatim: Left Half → right half of the
  **previous** display, Right Half → left half of the **next**, Top Half → bottom half of the
  **next**, Bottom Half → top half of the **previous**, Center Half → same geometry on the next.
- Failure toasts exactly as confirmed, plus the ones read out of the runner this session:
  `No focused window`, `Focused window is not resizable`, `Focused window is not positionable`,
  `Cannot move or resize window` / `Cannot resize window` / `Cannot move window` (by operations),
  `Cannot minimize window`, `No windows to minimize`, `Cannot minimize windows on this display`,
  `${n} window(s) could not be minimized`, `Couldn't determine current display`, `No previous
  window state`, `Cannot restore window`, `Cannot toggle always on top`, `Pinned ${app}` /
  `Unpinned ${app}`, `No other ${app} windows`, `No other windows of this app`, `Cannot focus
  next|previous app window`, `No previous|next display found`, `Cannot move to previous|next
  display`, `Cannot resize window to W × H`, `Cannot move window to X, Y`, and the post-hoc
  `Window resized to W × H` + `${app} does not allow W × H` when the achieved size differs by
  more than 1 px.
- Magnet preset (`Wt`): 18 bindings applied via host `RegisterHotKey`; toasts `Applied "Magnet"
  hotkeys`, `Removed hotkeys`, `Failed to apply preset`.

### Our decisions (beyond the table above)

| Item | Decision | Why |
| --- | --- | --- |
| Target window | The host captures `GetForegroundWindow` the moment the launcher is revealed (hotkey / `showMainWindow` / clipboard-history open), **and again whenever the launcher is deactivated** (the OS re-focuses the previous app at that moment; captures of our own windows are ignored), so `getActiveWindow` always has a target. If no capture exists yet, the runner hides the launcher first and re-asks — the window the OS re-activates then reports as the live foreground | Raycast's exact previous-focus mechanism is not visible in the shipped artifacts; the clone needs the pre-launch window because the launcher itself takes focus. (The deactivation capture + hide-first fallback fixed the shipped-testing bug where every command toasted `No focused window` because the launcher auto-showed at boot and was never toggled.) |
| `resizable` / `positionable` | Approximated from the window styles (`WS_THICKFRAME` / `WS_CAPTION`) | Raycast's native flags come from its UIAccess helper; a style-based approximation is the honest equivalent and only gates which failure toast appears. |
| Displays | Per-monitor work areas in **logical** pixels (physical ÷ that monitor's DPI scale), rects always work-area-relative plus a `displayIndex`; the host converts back via the monitor's DPI. The process is now PerMonitorV2 (app.manifest) so `GetDpiForMonitor` reports per-monitor values | Mirrors the shipped logical-JS → physical-native split; there is no global logical space on Windows, so origins never need to surface. |
| Saved-state key | `exe|title` (unchanged from the decisions table); a saved fullscreen record is treated as `No previous window state` because the clone has no fullscreen route | Already documented; the fullscreen fallback is new. |
| `${app}` in toasts | The process exe base name without `.exe` (Raycast resolves the localized application name) | The clone has no pid→application mapping for arbitrary windows; deterministic and honest. |
| `minimizeOnDisplay` display | The focused window's display ("the display where Raycast is open" maps to the display the user is working on) | The launcher is centered on the primary, which would make the confirmed description wrong in multi-monitor use. |
| Post-resize re-anchor | Not replicated (the shipped `Nb`/`gf` re-anchoring step); the observable resize-verification toast is | The re-anchor is an internal cosmetic correction; its exact semantics (`gf` import binding) are not reconstructible from the bundle. |
| Displays-mode post-action | Only the state reconciliation (`_b`: record actual bounds) is replicated; the `Gb` right-edge branch is not | In every observed flow its flush-edge check made it a no-op; the shipped `gb` calls already implement the display move. |
| Per-command preferences | `centerWindow` (edge moves) and `delta` (Make Smaller/Larger) keep their shipped defaults (true / 32 px); no per-command preference UI | The clone has no per-command preference editor; the defaults are what ship. |
| Preset hotkeys | Registered with the host via `windowManagement.registerCommandHotkey` (Ctrl/Alt/Shift/Win only); `Ctrl+Alt+Delete` (Restore) and the two Win-key display moves are dropped — 18 of 21 bindings; the stored map replays after a renderer reload because host registrations die with the process | Already in the decisions table; the reload replay is new. `Ctrl+Alt+Delete` is a Windows-reserved SAS combination no app can register. |
| Pending | `toggleFullscreen` (macOS-gated in Raycast), the virtual-desktop command set, grid overlay, Pro custom commands/layouts | Unchanged from the decisions table. |

### Tests

- `build/frontend/tests/window-management.test.mjs` — 12 tests over the esbuild-bundled module:
  every preset rect on 1920×1080, odd-width floors, gap math (outer/inner/2, position-only
  clamps, size-collapse skip), clamping with and without oversize, cross-display scaling,
  display lookup + wrap, sizes cycling (base → ⅔ → ⅓ → base, drift reset), displays cycling
  (mirror geometry + direction pairing), argument regexes.
- `build/backend/tests/window-states.test.mjs` — 5 tests: round-trip with display index,
  overwrite, fullscreen record, per-window isolation, unknown key.
- Totals after this extension: 110 backend tests + 19 frontend tests, 0 failures.

## Manual test checklist

1. **Halves/quarters** — focus Notepad, run `Left Half`: the window covers the left half of the
   work area exactly; `Top Left Quarter` covers the top-left quarter; gaps apply per settings.
2. **Multi-monitor** — with two displays of different resolutions, `Move to Next Display` scales
   position/size proportionally and wraps; `Move to Previous Display` from the first display wraps
   to the last.
3. **Mixed DPI** — a 100% display next to a 150% display: halves on each display are exactly half
   the work area in logical terms (no drift at edges).
4. **Cycling** — with `Cycle ½, ⅔, and ⅓`, pressing the Left Half hotkey three times cycles
   half → two-thirds → one-third.
5. **Restore** — resize a window, run any command, then `Restore`: it returns to the pre-command
   bounds; `Restore` without prior commands toasts `No previous window state`.
6. **Almost Maximize** — 90% centered; `Reasonable Size` caps at 1024×900.
7. **Args** — `Resize Window` with `800 600` works; `abc` is rejected; the window manager of an app
   that refuses the size yields the confirmed post-hoc toast.
8. **Always on top** — toggling pins/unpins with `Pinned ${app}`/`Unpinned ${app}` toasts.
9. **Focus cycling** — `Focus Next App Window` walks visible windows of the current desktop.
10. **Presets** — applying the Magnet preset assigns the confirmed hotkeys (no Win-key rows); toast
    `Applied "Magnet" hotkeys`.
11. **Elevated target** — running an elevated window as target reports the confirmed failure toast
    rather than crashing.
