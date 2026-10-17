# FlowKey migration plan

Decision being implemented: the Raycast Store is retired and `@raycast/api` is replaced by the
FlowKey library as the only extension API. Reverse engineering of the real Raycast continues for UX
parity only. Phase 1 produced the inventory below; Phase 2 executes the milestones in the order the
plan owner approved (§6), with the adjustments baked in: Store removal comes before the Spotify
work, the OAuth vault uses a loopback redirect with bring-your-own client id (no raycast.com
dependency), data migration moves (never deletes) Openray-owned files into a backup folder, and
every milestone ends green with test counts reported.

Sources read for this plan:

| Source | What it is |
|---|---|
| npm `@flowkey-cli/native-sdk@0.5.2` | Types, manifest validation, capability groups (`src/types.ts` 569 L, `capabilities.ts` 541 L). |
| npm `@flowkey-cli/react-ui@0.3.0` | React components + reconciler host (react-reconciler **0.33**, React 19 semantics), serializer, hooks. |
| npm `@flowkey-cli/cli@0.4.0` | esbuild packaging with **shim aliases** (`react`, `react/jsx-runtime`, `@flowkey-cli/react-ui`, `@flowkey-cli/native-sdk` → runtime shims reading `globalThis.__FLOWKEY_HOST__`), `.flowkey` zip packaging, manifest validation. |
| GitHub `GabrielSantos23/flowkey-launcher` @ main | `flowkey-native/sidecar` (stdio JSON-lines child process, protocol v1), `flowkey-native/shell` (WPF shell incl. `SpotifyAuthConfig.cs`), `flowkey-native/contract` (pinned fixtures), `flowkey-native/extensions/*` (apps, calculator, clipboard-history, emoji, google-translate, lucide-icons, obsidian-notes, quicklinks, snippets, **spotify**, system, window-switcher), `flowkey-native/docs/*`. |
| This repo @ `feature/store` (7a53739) | Everything inventoried below. |

Safety state already applied:

- `feature/store` last commit `7a53739` tagged **`archive/store-final`**. No git remote exists, so
  per the plan owner's adjustment **git bundles** are created before M2 under
  `C:\Users\gabs\Documents\Openray-backups\` (`openray-archive-store-final.bundle`,
  `openray-feature-flowkey-lib.bundle`).
- `main` is fully merged into `feature/store`; the working branch **`feature/flowkey-lib`**
  (worktree `C:\Users\gabs\.t3\scratch\Openray-flowkey`) branches from it. The main working
  directory is never touched. Before every milestone: merge the latest committed `main` into
  `feature/flowkey-lib` and report conflicts (expected: none — main's changes are launcher-side).

## 1. Store inventory (everything that goes away, in M2)

### Backend (`build/backend/src/`)

| File | Store role | Removal notes |
|---|---|---|
| `store.js` (~800 L) | SQLite schema (`catalog_meta`, `catalog_extensions`, `installed_extensions`, `extension_classifications`, `command_classifications`, `command_preferences` in `store.sqlite`), GitHub catalog refresh, install pipeline (staging/backup/rollback), uninstall, update check, classification persistence, launch gate, command preferences, `getIcon`, runtime junctions (`ensureRuntimeLinksInDir`). | Delete. Junction logic is re-created for FlowKey installs (§4). |
| `store-bundler.js` (~250 L) | npm install in staging, esbuild bundling per command, host-owned package stripping, source-graph walking. | Delete. FlowKey builds bundles with shim aliases; no runtime npm install. |
| `classifier.js` (~250 L) | COVERAGE_VERSION 2, unsupported-API markers, classification, guard detection. | Delete. FlowKey gates by manifest + consent. |
| `backend.js` | `storeHandlers` + `registerStoreHandler` + `setLaunchGate`, `store.*` dispatch, `getInstalledNodeExtensionSummaries` compat payload, worker crash reporting (kept), OAuth handlers (kept, re-designed per §4), `getApplications` worker route (kept). | Surgical removal of store parts. |
| `index.js` | `createStore` wiring, `setLaunchGate`, `syncClassifications()` bootstrap. | Remove store lines; data-dir logic stays. |

### Frontend (`build/frontend/src/`)

| File | Store role |
|---|---|
| `features/store/StoreView.tsx` | Full-window Store view. |
| `features/store/storeApi.ts` | `store.*` RPC wrappers + push subscriptions. |
| `features/store/store.css` | Store styles. |
| `features/store/useExtensionIcon.tsx` | Icon hook — **kept**, re-homed for FlowKey installs. |
| `app/CommandSession.tsx` | Store route + `useStorePreferences` gating. |
| `app/App.tsx` | `store.installed` push, compat pills/disabled rows. |
| `app/entries.ts` | "store" internal area + command row. |
| `settings/ExtensionPreferences.tsx` (+ css), `settings/Settings.tsx`, `settings/pages.ts` | Extensions settings page (page stays; content becomes FlowKey extension settings). |

### Host (`build/host/`) — nothing Store-specific. The settings-window IPC bridge stays.

### Scripts, tests, docs, data

- `build/scripts/harness-report.mjs` + `harness-quiet.mjs`: GitHub-catalog harness. Deleted in M2;
  replaced by FlowKey contract tests.
- `build/scripts/install-extension.ps1`: @raycast-shape dev installer. Replaced by the FlowKey
  installer in M2.
- `build/scripts/build.ps1`: wording retargeted in M4.
- Tests removed in M2: `store.test.mjs`, `classifier.test.mjs`, `store-bundler.test.mjs`,
  `gating.test.mjs`, `harness.test.mjs`, `fixtures/catalog/*`, `fixtures/classifier/*`,
  `fixtures/store/*`. Still-valid assertions (worker RPC round trip, LocalStorage persistence,
  typed unsupported errors) move into the FlowKey contract tests in M1 (§6, acceptance A1).
- Docs: `docs/store-spec.md`, `docs/api-coverage.md`, `docs/store-implementation-plan.md` marked
  **archived REA records** (they remain the only files allowed to name the excluded strings).
- Data (Openray-owned only): `%LOCALAPPDATA%\Openray\store.sqlite`,
  `%LOCALAPPDATA%\Openray\extensions\<handle>` Store installs, and the stray
  `%LOCALAPPDATA%\Openray\extensions\node_modules`. **Moved, not deleted** — see §6 (M2).

## 2. `@raycast/api` / `@raycast/utils` inventory

`@raycast/utils` has zero imports in this repo (it only appeared inside Store-installed
third-party bundles). `@raycast/api` appears in:

| Location | Disposition |
|---|---|
| `build/api/` — the shim (`src/index.ts` 1,471 L, `src/runtime/{model,reconciler,render,rpc,navigation}.ts`), `src/unsupported.ts` | Replaced by the FlowKey library. `runtime/rpc.ts` (our own worker↔backend JSON-RPC) is **moved** into the FlowKey worker, not deleted. |
| `build/api/package.json` (+ `package-lock.json`) named `@raycast/api` (react 18.3.1, react-reconciler 0.29.2) | Renamed/replaced; lockfile deleted (gate: lockfiles must not carry the name). |
| `build/backend/src/worker-entry.js` | Replaced by the FlowKey worker bootstrap. |
| `build/backend/src/backend.js` | `NODE_PATH` wiring + worker-data flags rewritten; comments updated. |
| `build/backend/src/{store-bundler,store,classifier}.js` | Deleted with the Store (M2). |
| `build/extensions/command-ux-test/` (+ its `build.mjs` externals, `package.json` `$schema`) | Ported to `defineReactExtension` in M1; stays dev-flag-only, never shipped. |
| `build/backend/tests/fixtures/**` (catalog/classifier/store) | Deleted in M2; FlowKey fixtures replace them. |
| `build/backend/tests/api-shim.test.mjs` | Still-valid assertions migrated in M1 (acceptance A1); file deleted in M4. |
| `build/scripts/harness-report.mjs`, `install-extension.ps1`, `build.ps1` | M2/M4 as above. |
| `build/frontend/src/icons.tsx` | Two comments rewritten (icon names are Lucide's — they stay). |
| `build/api/node_modules/@raycast/api/index.js` | The committed built bundle — removed with the shim (M4). |

## 3. FlowKey library surface (what we adopt)

- **Message contract (protocol v1, pinned by `contract/*.fixture.json`)**: sidecar over stdio JSON
  lines. `HostMessage`: `init`, `search`, `action`, `preferences`, `nativeResult`, `webCall`,
  `webAbort`. `SidecarMessage`: `ready`, `ui`/`uiPush`, `error`, `ack`, `nativeCall`,
  `windowCommand`, `launchCommand`, `webView`, `webResult`, `log`.
- **Extension model**: `manifest.json` (id, commands with `mode: "view" | "background"`,
  `arguments[]`, `preferences[]`, `nativeMethods[]`, `httpHosts[]`, `oauth[]`, `fsPaths[]`,
  `uriSchemes[]`); `.flowkey` zip packaging with zip-slip/size caps, semver-newer install rule,
  per-capability consent enforced per native call.
- **Runtime**: bundles load with `globalThis.__FLOWKEY_HOST__` = `{ react, reactJsx, reactUi,
  nativeSdk }` installed before import; build-time shims alias `react`, `react/jsx-runtime`,
  `@flowkey-cli/react-ui`, `@flowkey-cli/native-sdk` to globals readers — one React copy by
  construction; react-reconciler 0.33 (React 19 semantics — `use` works).
- **React surface**: `defineReactExtension({ manifest, component })`; `CommandProps` =
  `{ query, filterValue, commandId, arguments, preferences, environment, window, native,
  capabilities, signal }`; hooks `usePromise/useFetch/useDebounce/useCachedState/useLocalStorage/
  useCachedPromise/withCache`; components `List/Detail/Grid/Form` + `ActionPanel/Action`, strict
  prop whitelists, serializer errors on unknown props.
- **UI trees**: `ListTree` (sections/items: keywords, accessories, pane, per-item detail, empty
  view, filter dropdown, isLoading, searchBarPlaceholder, server pagination), `DetailTree` (fields
  with link/tags kinds, markdown, mediaKeys), `GridTree`, `FormTree` (10 field kinds,
  `submitActionId`).
- **Capabilities**: `http.fetch/fetchJson/upload` (allowlist), `clipboard` (incl. history/paste),
  `storage`, `cache`, **`oauth` (vaulted host-side; tokens never reach the extension; `http.fetch`
  injects via `options.auth`)**, `secrets`, `shell`, `fs` (scoped globs, trash), `apps`, `media`
  (SMTC), `image.fetch`, `system.selectedText`, `hud`, `toast`, `alert.confirm`.

## 4. Integration approach (as approved)

1. **Vendored packages** `@flowkey-mini/{native-sdk,react-ui,cli}` under `build/flowkey/`, ported
   from `@flowkey-cli/*` with attribution; `build/flowkey/NOTICE.md` records source package names
   and versions (native-sdk 0.5.2, react-ui 0.3.0, cli 0.4.0), the FlowKey repo commit, the license
   status (checked at vendoring time; FlowKey's repo carries a LICENSE file — recorded verbatim
   there; if it has none, NOTICE says so explicitly) and every third-party note that came with the
   code. Syncing later = re-copy the changed package sources, re-apply our library additions (kept
   in clearly marked sections), re-run the contract tests.
2. **Worker topology stays ours** (per-command `worker_threads` crash isolation); the message
   contract becomes FlowKey's. The FlowKey worker boots host globals, loads the bundle, renders via
   `ReactRoot` + `ActionRegistry`, and speaks HostMessage/SidecarMessage over our worker RPC. The
   backend enforces the manifest consent gate per native call.
3. **UiTree → `ray-*` adapter** in the backend keeps the renderer unchanged (§6 acceptance A2
   lists the covered shapes and reports anything our renderer cannot express yet).
4. **OAuth vault (no raycast.com anywhere)**: `redirect_uri` is a **loopback listener on 127.0.0.1**
   (configurable fixed port via the provider config, random port otherwise), `client_id` is
   bring-your-own per provider (`<dataDir>/oauth/<provider>.json` or env var, the FlowKey
   `SpotifyAuthConfig` pattern), tokens are vaulted host-side, `http.fetch` injects them via
   `options.auth`. The old raycast.com/redirect + clipboard handshake and its tests are dropped.
5. **Build**: `@flowkey-mini/cli` (vendored) builds extension bundles with the shim aliases;
   `install-extension.ps1` becomes the FlowKey installer (dev folders or `.flowkey` zips).
6. **Package name**: `@flowkey-mini/*` — no "raycast" anywhere in names, ids or schemas.

## 5. Extension migration

| Extension | Needs | Milestone |
|---|---|---|
| `command-ux-test` (ours) | Full UI-surface coverage as `defineReactExtension` | M1 |
| **lucide-icons** (port from FlowKey) | storage/cache, list/grid, copy actions, icons | M3 |
| **spotify** (port from FlowKey) | vaulted `oauth` (spotify, BYO client id), `http.fetch` (7 hosts), `secrets`, `image.fetch`, `hud`, `media.current/control`, `storage.*`, `clipboard.write` | M5 (5a vault+routes → 5b SMTC → 5c port) |
| backend-native internal extensions (calculator, translator, clipboard-history, quicklinks, snippets, notes, focus, games, taskbar, file-search, window-states) | no `@raycast/api` usage — unaffected by the gate | opportunistic later |

Library additions forced by the ports (built into `@flowkey-mini/*` / the backend, clearly marked
in the vendored sources): navigation-stack mapping in the adapter, `media.*` + `image.fetch` +
`secrets` + `system.selectedText` host routes, the OAuth vault, alias/hotkey reuse for FlowKey
commands.

## 6. Milestones, acceptance tests, data migration

Baseline test counts (recorded before M1, all green):

| Suite | Count |
|---|---|
| `build/backend` tests (`node --test tests/*.test.mjs` minus the 20-min harness) | 29 pass / 0 fail (store 10, classifier 11, gating 3, bundler 4, api-shim 5 — counts shift when Store suites leave) |
| render-model suite (`build/tests/*.test.mjs`) | 4 files green |
| frontend `tsc --noEmit && vite build` | clean |
| harness (20 min, network) | superseded in M2 by contract tests |

### M1 — library in (command-ux-test port; nothing removed)

- Vendor `@flowkey-mini/*` + NOTICE + vendor deps (react 19, react-reconciler 0.33, scheduler) under
  `build/flowkey/vendor/`; FlowKey worker (`flowkey-worker.js`) + UiTree→`ray-*` adapter
  (`flowkey-adapter.js`) + manifest consent gate; `command-ux-test` ported (dev-flag only, never
  shipped).
- **A1 contract tests** (`flowkey-contract.test.mjs`): manifest validation against FlowKey's pinned
  fixtures' rules; worker round trip renders a List tree through the adapter (assert the produced
  `ray-*` model); action invocation round trip (registry id → handler → new tree); LocalStorage
  persistence via the worker RPC; typed unsupported-capability errors; migrate the still-valid
  api-shim assertions listed in §2.
- **A2 adapter tests**: every tree kind — list with sections, accessories, item detail + metadata
  pane, grid (flat + sections), form (field kinds + submitActionId), push navigation, empty view,
  filter dropdown, pagination. Report (in the commit message + final report) anything our renderer
  cannot express yet instead of dropping it.

**M1 result (2026-10-14).** All suites green: backend 201 pass / 0 fail across 18 suites
(16 pre-existing + `flowkey-adapter` 8 + `flowkey-contract` 5); render-model 4/4; harness 1/1
with two root-caused, documented exceptions (below). Fixes found by the tests: worker
`react` shorthand + `workerData`-vs-initialize-params + esbuild CJS interop; backend pool
kind-keys and the `nativeCall` inner-params unwrap; the port uses the real JSX API
(`Detail.Metadata` / `Form.*` children, `onSubmit`) with pages as elements (per-page hook counts).
The FlowKey JSX surface is stricter than its tree types: pane metadata is label/value only,
`List.Section` has no `subtitle` prop, tags fields need `kind: "tags"`, `Action` requires
`onAction`.
**Adapter gaps reported (not dropped)** — `iconSvg` → data URI maps across but the frontend
`Icon` does not `<img>` data URIs yet; `iconColor` has no ray item-icon field; emoji icons,
`DetailTree.imageUri` / `UiPane.previewImageUri` have no counterpart; `DetailTree.mediaKeys` /
`subtitle` dropped (media lands in M5b); action `primary` is carried as an extra field while the
ray renderer treats `actions[0]` as primary positionally. Item icons otherwise map (lucide
`iconName` → `icon://Name.png`, `iconUri` passthrough, grid `filter` → `searchBarAccessory`).
**Harness exceptions** (the catalog pins live upstream `main`, so upstream drift reclassified two
commands into compatible; both verified pre-existing on `archive/store-final`): `spotify-player/search`
crashes with React 19's `use` in the React 18 shim worker (`react19-use`, the exact bug M5c
fixes) and `chatgpt/ask-selected-image` needs the user's `OPENAI_API_KEY` (`env-required`, same
family as auth-required).

### M2 — Store removed

- Delete: `store.js`, `store-bundler.js`, `classifier.js`, store routes in `backend.js`/`index.js`,
  `features/store/*` (except useExtensionIcon → re-homed), store entries/routes in
  `entries.ts`/`CommandSession.tsx`/`App.tsx`/`buildSections.ts`, settings page store content,
  harness scripts, store/classifier/bundler/gating tests + fixtures, `install-extension.ps1`
  (replaced by the FlowKey installer), store docs marked archived.
- **A3**: all remaining suites green; root search + settings render FlowKey extensions
  (`command-ux-test` behind the dev flag); the old `store.*` RPC returns a typed "removed" error.
- **A4 data migration (move, not delete; idempotent; logged)**: move `store.sqlite`, the
  Store-installed extension folders and the stale extensions-root `node_modules` into
  `%LOCALAPPDATA%\Openray\_removed-store-backup\`, writing `migration-log.json` (source →
  destination per item). Re-running the migration moves nothing and rewrites the log. The folder is
  user-deletable at any time; deleting it only removes the retired Store's data.

### M3 — lucide-icons pilot

- Port `flowkey-native/extensions/lucide-icons`; root-search entry, detail, copy actions,
  preferences via the settings bridge.
- **A5**: e2e test launches the pilot in a worker through the normal path and asserts the rendered
  tree; manual check listed for the isolated instance.

**M3 result (ef387b2).** Ported and green. The frontend `Icon` learned `data:image` URIs so the
adapter's `iconSvg` mapping renders (the M1 gap closes here). A5 found the flowkey routes calling
bare handler names (`setClipboard`/`showHUD`/…) — they dispatch through `hostHandlers` now, so
test overrides apply. Backend 179/179.

### M4 — shim, aliases, NODE_PATH removed; grep gate

- Delete `build/api/` (shim + runtime + built bundle + lockfile), `worker-entry.js`'s api require,
  `NODE_PATH` wiring, old fixtures; `rpc.ts` already moved in M1; `build.ps1` + icon comments
  rewritten.
- **A6 grep gate (git grep over tracked files, excluding only docs/ files explicitly marked
  archived/REA):**

```
git grep -I -n -i -E "@raycast/api|@raycast/utils|raycast/extensions|raycast\.com" -- . ":(exclude)docs/store-spec.md" ":(exclude)docs/api-coverage.md" ":(exclude)docs/store-implementation-plan.md" ":(exclude)docs/findings-REA.md" ":(exclude)docs/flowkey-migration-plan.md" ":(exclude)docs/calculator-spec.md" ":(exclude)docs/command-ux-spec.md" ":(exclude)docs/focus-games-taskbar-spec.md" ":(exclude)docs/toast-hud-spec.md" ":(exclude)docs/translator-spec.md"
```

  must return zero hits (product name "Openray" is allowed and never matches these patterns).
  Run with output in the final report.

**M4 result (bb0f5cd).** `build/api` deleted (−44k lines), FlowKey is the only worker kind,
`loadCommand` refuses non-manifest extensions with a typed error, the OAuth redirect origin moved
to the loopback design ahead of M5a. Shipped links that pointed at raycast.com (Quicklinks guide,
the default "Raycast Manual" quicklink, About website/community/changelog/feedback) now target
`github.com/GabrielSantos23/Openray` — adjust if the product home changes. Six REA reference
docs carry banners and join the exclusions. **A6 gate: zero hits.** Backend 174/174, frontend
38/38, build tests 3/3, tsc+vite clean.

### M5 — Spotify

- **M5a**: OAuth vault (loopback redirect 127.0.0.1, configurable fixed port, BYO client id via
  `<dataDir>/oauth/spotify.json` or `FLOWKEY_SPOTIFY_CLIENT_ID`), `http.fetch` allowlist +
  `auth` injection, `secrets`, `image.fetch` host routes. **A7**: vault flow test (authorize →
  loopback receive → token exchange against a stub provider → `http.fetch` injects the token).
- **M5b**: `media.current/control` host route (Windows SMTC, new file `MediaControl.cs`, small
  NativeHost.cs hook). **A8**: capability test with the session metadata.
- **M5c**: the Spotify extension port (search, library, now-playing, player background commands,
  lyrics). **A9**: contract tests for the non-network pieces (models, store) + isolated-instance
  manual checklist.
- **M5d**: `system.selectedText` only if something we ship needs it.

**M5 result (d6014d2 + a54bf12).** M5a done: `flowkey-vault.js` (BYO client id file/env, PKCE
S256 over the loopback server on 127.0.0.1:42749/configurable, per-provider token files under
`<dataRoot>/oauth/`, refresh with refresh-token retention), `http.fetch` injects `Authorization`
backend-side from `options.auth`, `secrets.*` per extension, `image.fetch` allowlisted +
cached (downscale pending). A7 green (6 tests, real loopback HTTP, stubbed token endpoint). The
clipboard-handshake OAuth is deleted. M5c done: the Spotify extension ported (31 commands; the 9
upstream `ui:"web"` commands render through their tree implementations — the web bundle is not
ported), A8-style tests pin the unauthorized states (search parks on "Connect Spotify", the
Connect action surfaces the BYO notice; now-playing resolves instead of hanging).

**M5b result.** `build/host/MediaControl.cs` (Windows SMTC: `media.current` snapshot with the
timeline projected to now, playing-first session pick; `media.control` playPause/play/pause/next/
previous/stop with typed errors for no session / unknown command) + a three-line prefix hook in
`NativeHost.cs`; backend `media.current`/`media.control` nativeCall routes ride the existing
native hop. Media tests stub the host at the transport boundary and pin routing, payload shape and
error paths (the real WinRT path is exercised when the app runs).

**Subview navigation (was "launchCommand route pending").** Handled in the worker instead of a
backend route: `Action push="key"` and `window.launchCommand(key)` relaunch the same session's
component (new `commandId`, renderer page stack pushes via `navigationInfo.action:"push"`), the
renderer's Escape path notifies `navigationStack.onPop` (`__pop__` registry id) and the worker
rewinds its command stack, replying with `localPop` + the renderer's pop id. `window.popToRoot`
also unwinds the worker stack. The dead backend `hostHandlers.launchCommand` (dispatched to the
C# host, always errored) is removed. Contract test: push → subview render → onPop → root;
`window.launchCommand` takes the same path. Component dispatch must delegate subviews as
elements (different component types), never early-return before hooks.

Backend 186/186 (was 182), frontend 38/38, build tests 3/3, tsc clean. **Pending: M5d**
(selectedText, only when something needs it) and WebView2 command support if the upstream web
views are ever wanted; `image.fetch` downscale.

### M4 — shim, aliases, NODE_PATH removed; grep gate

- Delete `build/api/` (shim + runtime + built bundle + lockfile), `worker-entry.js`'s api require,
  `NODE_PATH` wiring, old fixtures; `rpc.ts` already moved in M1; `build.ps1` + icon comments
  rewritten.
- **A6 grep gate (git grep over tracked files, excluding only docs/ files explicitly marked
  archived/REA):**

```
git grep -I -n -i -E "@raycast/api|@raycast/utils|raycast/extensions|raycast\.com" -- . ":(exclude)docs/store-spec.md" ":(exclude)docs/api-coverage.md" ":(exclude)docs/store-implementation-plan.md" ":(exclude)docs/findings-REA.md" ":(exclude)docs/flowkey-migration-plan.md" ":(exclude)docs/calculator-spec.md" ":(exclude)docs/command-ux-spec.md" ":(exclude)docs/focus-games-taskbar-spec.md" ":(exclude)docs/toast-hud-spec.md" ":(exclude)docs/translator-spec.md"
```

  must return zero hits (product name "Openray" is allowed and never matches these patterns).
  Run with output in the final report.

### M5 — Spotify

- **M5a**: OAuth vault (loopback redirect 127.0.0.1, configurable fixed port, BYO client id via
  `<dataDir>/oauth/spotify.json` or `FLOWKEY_SPOTIFY_CLIENT_ID`), `http.fetch` allowlist +
  `auth` injection, `secrets`, `image.fetch` host routes. **A7**: vault flow test (authorize →
  loopback receive → token exchange against a stub provider → `http.fetch` injects the token).
- **M5b**: `media.current/control` host route (Windows SMTC, new file `MediaControl.cs`, small
  NativeHost.cs hook). **A8**: capability test with the session metadata.
- **M5c**: the Spotify extension port (search, library, now-playing, player background commands,
  lyrics). **A9**: contract tests for the non-network pieces (models, store) + isolated-instance
  manual checklist.
- **M5d**: `system.selectedText` only if something we ship needs it.

## 7. Final gate

The gate from §6 (A6) runs over all tracked files with the three archived REA docs excluded; zero
hits required. Product name "Openray" is fine. The command and its (empty) output appear in the
final report, together with: what was removed, what was migrated, test counts before/after per
suite, backup paths, pending items.
