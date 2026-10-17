## 2026-10-17 (evening) — action panel redesign, scroll-appearing scrollbar, translucent settings popovers

**What landed**

- Root-search scrollbar shows only while scrolling (`data-scrolling` fed by the body scroll
  handler, 600ms fade; fg-20 thumb, 8px track).
- Action panel rebuilt to the shipped menu layout (menu-XUV8Agq8.css / popover-BU57MK8Q.css):
  330px wide, 8px radius, 36px rows, entry-title header, group separators instead of labels,
  shortcut keycap pills, the search field at the bottom ("Search for actions…", 34px, top
  separator), and the shipped [windows] popover material (panel-overlay + panel-background
  gradients over the panel backdrop, 120px blur).
- Settings dropdown menus and the hotkey recorder use the same translucent popover material.
- Control input hook: `key` events accept modifiers, and `text` routes to the focused input
  (so the action panel's search is drivable through MCP).

**Verified through MCP**

- Scrollbar: 40 ArrowDowns then an immediate screenshot — thumb pixels present (fg-20 at the
  track edge); 1.5s later at rest the same pixels are window background.
- Action panel: ctrl+k via `/input` opens it (get_state view `dialog:command-panel`);
  panel-scoped text filters in place ("favor" -> "Remove from Favorites", "sh" -> "No actions"
  state); Escape closes.
- phase6 suite 13/13 after the changes.
- Settings-window surfaces verified in the built CSS (backdrop-filter + popover material on
  `.settings-menu`/`.settings-recorder`); the Settings window itself is not screenshotable via
  the control channel (separate WebView2 process, docs/gaps.md #1).

## 2026-10-17 (later) — launcher restyle to the shipped palette + MCP theme commands

**What landed**

- `build/frontend/src/styles/themes.css`: one `:root[data-theme="<id>"]` block per bundled
  theme (8 themes, verbatim palettes from artifacts/frontend/themes-BIClSzcF.js) plus the
  appearance-level constants from css-FlvQZ5S4.css (.theme-root[dark]/[light]: window base,
  fg/bg max, panel backdrop, Windows backdrop #333c / #fffc). Default dark theme: Raycast
  Dark (shipped `themeDarkId` default).
- `themes.ts`: applying a theme now switches the `data-theme`/`data-theme-appearance`
  attributes (values live in CSS, no inline overrides); chrome base exported for the WPF
  backdrop (#333 dark / #fff light).
- Launcher restyle to the shipped metrics: 750x475 window (host geometry), 12px radius,
  64px search bar with 20px padding, 18px input with the caret hidden while empty, muted
  grayscale 22px logo, 8px list padding with hidden scrollbars, 12px/500 section headers
  (12/12/6 padding), 40px rows (12px padding, 8px radius) with 28px icon tiles, 14px/600
  titles + 14px secondary subtitles, 13px accessories, Pro pill (fg-20 ground, 11px/500),
  44px footer (16px padding) with the list icon left and primary-action + Enter keycap,
  divider, Actions Ctrl K right, 20px keycaps with the shipped transparent/fg-20-ring style.
- MCP surface: `themes.list` / `themes.get` / `themes.set` (build/backend/src/commands/themes.js),
  switching writes `theme-dark`/`theme-light` plus `active-theme` (the frontend's live-preview
  precedence), so a switch applies immediately.

**Verification (through the MCP server only)**

- phase6-verify 13/13 on the restyled build.
- Pixel probes of control-channel screenshots match the shipped derivations exactly:
  Raycast Dark window #1f1f1f (bg-40 over the #333c backdrop), selected row #363636
  (selection-10), hover/rows/dividers consistent; Noon (#fff5e7 -> #fee8dd gradient) and Sky
  (#242a37 -> #3a4548) apply live through `themes.set`.
- send_input/get_state flows: query "calcul" filters 123 -> 35 items, footer primary action
  adapts (Open Command / Open Application).
- Regression: fuzz + wiring + registry + control-server suites 30/30.

## 2026-10-17 — command registry, control channel, MCP server (the agent-facing milestone)

**What landed**

- `build/backend/src/registry.js`: command registry with JSON-Schema-subset validation,
  risk metadata (read/write/destructive), the `{ok, result|error}` envelope, an event bus
  and a 500-entry ring buffer. 250+ commands.
- `build/backend/src/commands/`: every existing backend handler method became a command with
  the same id (behavior-preserving moves); native verbs (`shell.*`, `applications.*`,
  `clipboard.*`, `fileSystem.*`, `windowManagement.*`) forward over the existing pipe; `ui.*`
  verbs cover the window surface; `extensions.list/reload/run` + `ext.<name>.<command>` from
  the FlowKey manifests. The named pipe now routes through the registry — one dispatch path
  for pipe, control channel, CLI and MCP.
- `build/backend/src/control-server.js`: loopback-only HTTP (`--control` or
  `OPENRAY_CONTROL=1`), per-launch bearer token in `<dataRoot>/control-token`, endpoint in
  `control-endpoint.json`. Endpoints: commands list/describe/run, `get_state`, `send_input`,
  `screenshot`, `get_events`. 15s bound per renderer/host round trip.
- `build/backend/src/runtime.js`: the app wiring extracted from `index.js` so the MCP/CLI can
  run the same stores headless (renderer pushes resolve null; native hops fail typed
  `needs_ui`).
- `build/backend/src/mcp-server.mjs` + `cli.mjs`: MCP stdio server (7 tools +
  `openray://commands` resource), bridged/headless with auto-detect and endpoint re-discovery
  after a backend restart; CLI `run`/`list`/`mcp`.
- Host: `window.controlState`/`window.controlInput` renderer round trips and a
  `window.capture` PNG route (PrintWindow + PW_RENDERFULLCONTENT; shows the window first —
  a hidden window composes black).
- Frontend: `window.__openrayControl` (`controlHooks.ts`) — serializable state (view, query,
  sections, items, selection, dialogs) and app-internal input routing (text/setQuery/key/
  action); no OS input injection.
- Tooling: `build/scripts/layer-check.mjs` (one-way layering, 73 files),
  `build/backend/tests/command-fuzz.test.mjs` (every command × adversarial params, 2178+
  dispatches green; needs `--test-force-exit`), `build/scripts/mcp-verify.mjs` and
  `build/backend/scripts/phase6-verify.mjs` (13/13 through the MCP server).

**Numbers**

- Full backend suite: 215 tests pass (registry 11, wiring 8, control server 8, fuzz 3).
- Registry: 250 commands, 29 destructive (gated), 19 fuzz-excluded (network/real-host verbs).
- Phase 6 end-to-end: 13/13 through MCP bridged, including kill-the-backend → typed failure
  → watchdog recovery on the same client connection.

**Fixed along the way**

- File indexer ignored `OPENRAY_DATA_DIR` (collided with the live app's index DB).
- Fire-and-forget store pushes (clipboard state, indexer state) could escape as unhandled
  rejections; caught at the source, and headless pushes resolve null by contract.

**Still open**

- Settings window not inspectable via `get_state`/`screenshot` (docs/gaps.md #1).
- Generated command descriptions minimal; schemas permissive (docs/gaps.md #2/#3).
- Public GitHub mirror behind local main.
