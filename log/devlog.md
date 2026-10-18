## 2026-10-17 (evening) — footer hold-and-drag moves the launcher window

Raycast's footer drag, ported: mousedown anywhere on the launcher footer (except the
Settings / Actions / Install Update buttons, which `closest("button")` excludes) calls the
new host route `window.dragMainWindow`, which enters the native move loop with
ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION — the same trick the Settings titlebar uses,
because plain DragMove's button check races the IPC hop. A GetAsyncKeyState(VK_LBUTTON)
guard keeps the raw SendMessage from parking in the move loop when the button was released
during the hop (or was never physically held — dev-tools synthetic events). Verified via
CDP: synthetic footer mousedown → `window.dragMainWindow ok:true` in the host log, no
stuck move loop; the physical hold-drag itself is user-testable. Deployment note: publish
must target `build/host/bin/m3-release/...` (the path restart-mini.ps1 launches), not the
repo-root `bin/` the earlier sessions' command produced — a stale-binary mismatch cost a
round of "no native handler" debugging.

## 2026-10-17 (later) — update check + update card (GitHub Releases)

**What landed**

- `build/backend/src/updates.js` — the `updates.*` module: an unauthenticated GitHub Releases
  check against `OPENRAY_UPDATE_REPO` (default `GabrielSantos23/Openray`), boot check after
  15s then every 6h, numeric version compare (`v` stripped, `2.10 > 2.9`), 404 = "no releases
  yet" not an error, and `updates.install` (streams the release `.zip` asset to
  `%TEMP%\Openray-update\`, reveals it in Explorer via `shell.revealFile`). Skipped
  versions persist in `<dataRoot>/updates-state.json`; every state change pushes
  `updates.changed` to the renderer. APP_VERSION constant must be bumped with the csproj.
- Root-search card: headerless first section above Favorites (empty query only) —
  "New Update Available / Version X — you have Y", green download tile. Enter or click =
  Install; Ctrl+K panel = Install / Open Release Page / Copy Download URL / Skip This
  Version. Footer gains a persistent "Install Update ↗" button while an update is available.
  New `UpdateEntry` kind in `entries.ts`, `useUpdateState()` in `update.ts`.
- `.github/workflows/release.yml` — on a `v*` tag: vite build, backend `npm ci --omit=dev`,
  `dotnet publish`, stage the runtime layout the host expects (`app/` + `backend/` +
  `frontend/dist` + `Start Openray.cmd` setting OPENRAY_ROOT), zip it, `gh release create`
  with generated notes. Release process documented in docs/updates.md (three version bumps,
  then push the tag).
- Tests: new `tests/updates.test.mjs` (7 tests: compare, zip pick, check state machine,
  404, skip persistence across restarts, install download + reveal, install refusals) —
  all pass; full backend suite 234/234. Stale assertion fixed in `lucide-icons.test.mjs`
  (it expected `clipboard.paste` to be unrouted, but the paste route shipped in the emoji
  milestone — now asserts the call reaches the host as `placeInClipboard(frontmost)`).
- Verified live in an isolated instance (own pipe/data-dir/CDP port, `OPENRAY_UPDATE_REPO`
  pointed at `cli/cli` so a real newer release exists): boot check flips the card on via the
  `updates.changed` push (no reload), card is the selected first row, footer shows
  "Install Update ↗", Ctrl+K panel lists Install / Open Release Page / Copy Download URL /
  Skip This Version, Enter downloads the real 15.5MB `gh_2.102.0_windows_amd64.zip` into
  `%TEMP%\Openray-update\` and reveals it in Explorer, Copy Download URL puts the asset URL
  on the clipboard, Skip removes the card and persists `skippedVersion`. Multi-asset
  releases prefer a 64-bit Windows zip (the first pick grabbed `windows_386`). Rate-limited
  (HTTP 403) degrades to `lastError` with no card — observed before the API quota reset.

## 2026-10-17 (late) — emoji picker polish + the svgl extension (store-published)

**What landed**

- Emoji picker (`ext.emoji.search`) follow-up to the user's design pass: 34cqw container-query
  glyphs on hidden-label tiles, `LoadingBar` wired to `Grid isLoading`, and the category
  dropdown restyled to the shipped settings menu (per-category OpenrayIcon, checkmark,
  26px icon button with chevron).
- New extension `build/extensions/svgl` — clean-room port of the MIT-licensed svgl extension
  (behavior read from the pinned upstream commit; nothing pasted). Grid of svgl.app logos
  (columns 6, light/dark `uriDark` variants), category dropdown (All/Pinned/Recently Used +
  svgl categories with counts), and the full titled action panel: Copy SVG Text/File
  (Ctrl+↵), Wordmark, shadcn/ui registry install command (package-manager preference),
  React (svgr endpoint) / Vue / Svelte / Angular / Astro components, URLs, Pin/Unpin/Move
  (Ctrl+P, Ctrl+↑/↓), and SVG Info (copy title, open in browser Ctrl+O, visit
  website/brand/category). Pinned/Recently Used state lives in extension storage.
- SDK plumbing needed by svgl: `ActionPanel.Section` (serializer groups actions with the
  section title; the panel renders titled groups in first-appearance order), `IconSpec.uriDark`
  (adapter maps `source: { light, dark }`; the renderer picks by `data-theme-appearance`),
  and grid tiles render remote/data icons as full images (`.grid__tileImg`, ~55% share after
  the user's "svgs are too big" pass).
- Backend: FlowKey `clipboard.write` now honors `{ html, paths }` (rich writes) and gained a
  `files.writeTemp` route (backend-owned scratch under `<dataRoot>/extension-temp`, name
  sanitized); `setClipboard` translates the FlowKey `text` field to the host verb's `content`
  (a silent empty-string write before — the emoji Copy-to-Clipboard was broken by this too).
- Host: `ReadRepresentations` accepts both the captured-entry `{ items: [{ representations }] }`
  shape and the bare `representations` array every paste caller actually sends, and file-drop
  representations may be `{ path }` without a mimeType. Before this, `placeInClipboard` from
  the snippets view and the FlowKey paste routes silently wrote nothing.
- svgl is NOT preinstalled: it is published through the store (`store.import` →
  `store.install`, source "uploaded") and installed into the live extensions root that way.

**Verified through MCP + CDP (screenshots in build/shot-svgl-*.png)**

- Store publish → install → registry (`ext.svgl.index/setup-shadcn-registry/request`), launch
  via root search; grid renders 41 sections / 1007 logos with tile logos, counts, footer
  "Copy SVG Text ↵ | Actions Ctrl K" (matches the reference screenshot).
- Action panel: titled groups (Copy SVG / Copy SVG File / Copy shadcn/ui Registry / Copy React
  Component / …) with shortcut pills over the selected logo.
- Copy SVG Text (Enter): clipboard reads back the 9.4KB id-prefixed SVG; window closes with the
  HUD. Copy SVG File: clipboard holds a CF_HDROP drop list pointing at
  `<dataRoot>/extension-temp/<Logo>.svg`. Recently Used section appears after a copy
  ("Recently Used 1"); Pin → "Pinned Plausible Analytics" toast + Pinned section; category
  dropdown selection filters the grid ("Analytics 8").
- Tests: registry + wiring + fuzz + adapter + contract + store + clipboard-actions 58 pass
  (adapter gains the group/uriDark pin); layer-check ok (75 files).

**Fixed along the way**

- The FlowKey HTTP capability returns `body`, not `bodyText` (svgl fetched undefined → empty
  grid); response-body field name documented in the extension's api.ts.
- `FlowKeyCapabilities.http.fetch` responses were being mis-unwrapped in the worker repro
  harness only (no product code change).

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
