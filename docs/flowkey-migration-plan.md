# FlowKey migration plan

Decision being implemented: the Raycast Store is retired and `@raycast/api` is replaced by the
FlowKey library as the only extension API. Reverse engineering of the real Raycast continues for UX
parity only. This document is Phase 1 (read-only); no application code changes until it is approved.

Sources read for this plan:

| Source | What it is |
|---|---|
| npm `@flowkey-cli/native-sdk@0.5.2` | Types, manifest validation, capability groups (`src/types.ts` 569 L, `capabilities.ts` 541 L). |
| npm `@flowkey-cli/react-ui@0.3.0` | React components + reconciler host (react-reconciler **0.33**, React 19 semantics), serializer, hooks. |
| npm `@flowkey-cli/cli@0.4.0` | esbuild packaging with **shim aliases** (`react`, `react/jsx-runtime`, `@flowkey-cli/react-ui`, `@flowkey-cli/native-sdk` → runtime shims reading `globalThis.__FLOWKEY_HOST__`), `.flowkey` zip packaging, manifest validation. |
| GitHub `GabrielSantos23/flowkey-launcher` @ main | `flowkey-native/sidecar` (stdio JSON-lines child process, protocol v1), `flowkey-native/shell` (WPF shell, 116 C# files incl. `SpotifyAuthConfig.cs`), `flowkey-native/contract` (pinned fixtures), `flowkey-native/extensions/*` (native apps, calculator, clipboard-history, emoji, google-translate, lucide-icons, obsidian-notes, quicklinks, snippets, **spotify**, system, window-switcher), `flowkey-native/docs/*`. |
| This repo @ `feature/store` (7a53739) | Everything inventoried below. |

Safety state already applied:

- `feature/store` last commit `7a53739` tagged **`archive/store-final`**. No git remote exists
  (verified: `git remote | wc -l` = 0), so the tag is local-only — nothing to push.
- `main` is fully merged into `feature/store` (`git merge-base --is-ancestor main feature/store`
  passes), so `feature/store` is the right base: it carries every fix from the Store phase.
- New worktree `C:\Users\gabs\.t3\scratch\RaycastMini-flowkey` on new branch
  **`feature/flowkey-lib`**, branched from `feature/store` @ `7a53739`. The main working directory
  was not touched.

## 1. Store inventory (everything that goes away)

### Backend (`build/backend/src/`)

| File | Store role | Removal notes |
|---|---|---|
| `store.js` (~800 L) | SQLite schema (`catalog_meta`, `catalog_extensions`, `installed_extensions`, `extension_classifications`, `command_classifications`, `command_preferences` in `store.sqlite`), GitHub catalog refresh (pinned commit, 2 tree calls + 3,4k manifest fetches), install pipeline gates, staging/backup/rollback install, uninstall, update check, per-command classification persistence, launch gate (`assertLaunchable`), command preferences, `getIcon` (data URL from `assets/<icon>`), runtime junctions (`ensureRuntimeLinksInDir`). | Delete. The one-time migration drops the six tables. `getIcon` and the junction logic are worth re-creating for the FlowKey installer (see §5). |
| `store-bundler.js` (~250 L) | npm install in staging (win32 `shell: true`), esbuild bundling per command (`jsx: automatic`, externals `@raycast/api`, `react`, `react/jsx-runtime`, `react-dom`, `react-reconciler`), host-owned package stripping, source graph walking (`stagedEntryGraph`). | Delete. FlowKey's CLI does the equivalent with shim aliases; our port of it replaces this. |
| `classifier.js` (~250 L) | COVERAGE_VERSION 2, unsupported-API markers, `classifyCommand`/`classifyExtension`, guard detection. | Delete. FlowKey gates by manifest (`nativeMethods`, `httpHosts`, consent), not by source scanning. |
| `backend.js` | `storeHandlers` + `registerStoreHandler` + `setLaunchGate`, store dispatch branch (`store.*`), `getInstalledNodeExtensionSummaries` (compat payload), worker crash reporting, OAuth handlers (`oauth.redirectOrigin`, `oauth.authorize` + clipboard handshake — kept, re-homed), `getApplications` worker route, `reportWorkerCrash`. | Surgical: remove store-specific parts; keep everything the FlowKey host needs (worker supervision, OAuth vault, clipboard, applications). |
| `index.js` | `createStore` wiring, `setLaunchGate`, `syncClassifications()` bootstrap, `RAYCAST_MINI_DATA_DIR`. | Remove store lines; data-dir logic stays. |

### Frontend (`build/frontend/src/`)

| File | Store role |
|---|---|
| `features/store/StoreView.tsx` (~450 L) | Full-window Store view: search, categories, detail, install confirm, progress, update/uninstall. |
| `features/store/storeApi.ts` | `store.*` typed RPC wrappers + push subscriptions (`onStoreProgress`, `onStoreInstalled`, `onStoreCatalogProgress`). |
| `features/store/store.css` | Store styles. |
| `features/store/useExtensionIcon.tsx` | Icon hook — **keep** (re-homed; FlowKey extensions carry icons too). |
| `app/CommandSession.tsx` | `entry.area === "store"` route, `useStorePreferences` launch gating, store.css import. |
| `app/App.tsx` | `store.installed` push → summaries re-fetch; compat pills/disabled rows; junction of store-installed commands in root search. |
| `app/entries.ts` | `InternalArea`/`InternalCommandName` "store"/"browse", `INTERNAL_EXTENSION_META.store`, `INTERNAL_COMMANDS` Store row, `ExtensionSummary` badge/disabledReason. |
| `app/buildSections.ts` | Aliases as keywords; disabledReason subtitles. |
| `settings/ExtensionPreferences.tsx` + `settings-extensions.css` | Per-extension aliases/hotkeys/preferences + polling (the settings window's IPC bridge itself stays — it fixed a real gap). |
| `settings/Settings.tsx`, `settings/pages.ts` | "Extension Preferences" page registration (page stays; content becomes FlowKey extension settings). |

### Host (`build/host/`) — nothing Store-specific. The settings-window IPC bridge
(`RequestBackendAsync`) stays: FlowKey extension settings need the same pipe.

### Scripts, tests, docs, data

- `build/scripts/harness-report.mjs` (~260 L) + `harness-quiet.mjs`: 15-candidate GitHub-catalog harness. Delete; replaced by FlowKey contract tests (§4/§6).
- `build/scripts/install-extension.ps1`: dev-extension installer (@raycast/api shape). Rewrite for `.flowkey` packages.
- `build/scripts/build.ps1`: builds "the `@raycast/api` runtime". Reword + retarget.
- Tests: `build/backend/tests/store.test.mjs` (10), `classifier.test.mjs` (11), `store-bundler.test.mjs` (4), `gating.test.mjs` (3), `harness.test.mjs` (1, 20 min), `fixtures/catalog/*` (6 fixture extensions), `fixtures/classifier/*` (6), `fixtures/store/*` (3). All deleted with the Store; their living assertions (worker round trip, OAuth handshake, junctions) move into the FlowKey contract tests (§4).
- Docs: `docs/store-spec.md` (REA findings — keep as historical REA record, mark archived), `docs/store-implementation-plan.md` (mark archived), `docs/api-coverage.md` (the @raycast/api coverage table — archived with the shim; FlowKey capability table replaces it going forward).
- Data (RaycastMini-owned only): `%LOCALAPPDATA%\RaycastMini\store.sqlite` (drop the six tables — one-time migration), `%LOCALAPPDATA%\RaycastMini\extensions\<handle>` for Store installs (spotify-player, lucide-icons, command-ux-test, toast-playground, 1f0a1b2c-…), and the stray `%LOCALAPPDATA%\RaycastMini\extensions\node_modules` (the pre-Store dev-flow leftover that shadowed the API). Nothing under `~/.config/raycast` or the MSIX folders is ever touched.

## 2. `@raycast/api` / `@raycast/utils` inventory

`@raycast/utils` has **zero** imports in this repo (it appeared only inside Store-installed
third-party bundles, which go away with the Store). `@raycast/api` appears in:

| Location | What it is |
|---|---|
| `build/api/` — the shim itself: `src/index.ts` (1,471 L: environment/canAccess, AI/OAuth/BrowserExtension/WindowManagement namespaces, Cache, LocalStorage, Clipboard, Toast/HUD/Alert, Keyboard, Action/ActionPanel, List/Detail/Grid/Form components, `showHUD`/`showToast`/`confirmAlert`/`open`/`trash`/`showInFinder`/`launchCommand`/`getApplications`…), `src/runtime/{model,reconciler,render,rpc,navigation}.ts` (2,537 L total: headless React renderer to `ray-*` JSON models, callback ids, navigation stack), `src/unsupported.ts`. | The whole thing is replaced by the FlowKey library + a thin sidecar. Anything FlowKey lacks that our renderer needs is ported INTO the FlowKey package (§5), not kept as a shim. |
| `build/api/package.json` | Package literally named `@raycast/api` (deps: react 18.3.1, react-reconciler 0.29.2) + `package-lock.json` with the same name. | Renamed/replaced by the FlowKey package (§4); lockfile regenerated. |
| `build/backend/src/worker-entry.js` | Worker entry: `require(<apiRoot>/node_modules/@raycast/api)`. | Replaced by the FlowKey worker bootstrap (host globals + shims). |
| `build/backend/src/backend.js` | `NODE_PATH = <apiRoot>/node_modules` (the hook that makes extension requires resolve), worker `resourceLimits`, comments referencing `yIr`/Raycast's api bundle. | NODE_PATH dies with the shim (FlowKey resolves via junctions/host globals — see §4); comments rewritten. |
| `build/backend/src/store-bundler.js`, `store.js`, `classifier.js` | Externals list, marker patterns, harness references. | Deleted with the Store. |
| `build/extensions/command-ux-test/` | The one internal @raycast/api consumer (navigation stack, forms, alerts, grid, accessories test extension) + its `build.mjs` externals + `package.json` (`$schema: raycast.com/schemas/extension.json`). | Ported to the FlowKey API as the contract-test extension (M1). |
| `build/backend/tests/fixtures/**` (catalog, classifier, store) | Fixture extensions importing `@raycast/api`. | Deleted/replaced with FlowKey fixtures. |
| `build/backend/tests/api-shim.test.mjs` | Shim behavior tests (canAccess routing, Cache, preferences, typed throws, OAuth). | The still-true assertions (worker RPC, LocalStorage, typed errors) move to FlowKey contract tests; the rest die with the shim. |
| `build/scripts/harness-report.mjs`, `install-extension.ps1`, `build.ps1` | Candidate list pinned to `raycast/extensions` raw URLs; dev installer; build wording. | Deleted/rewritten (§1, §6). |
| `build/frontend/src/icons.tsx` | Two comments noting the Icon names mirror `@raycast/api`'s Lucide spellings. | Comment rewrite (the icon names themselves stay — they are Lucide names). |
| Data: `build/api/node_modules/@raycast/api/index.js` | The committed built bundle. | Removed with the shim. |

## 3. FlowKey library surface vs. what we use today

### Message contract (protocol v1, pinned by `contract/*.fixture.json`)

- Transport: sidecar is a **stdio JSON-lines child process** of the shell. `HostMessage`: `init`
  (protocol version, extensionsDir, preferences, disabled extensions), `search` (requestId,
  extensionId, query, commandId, filterValue, arguments), `action` (actionId, item, formValues),
  `preferences` (updated values), `nativeResult`, `webCall`/`webAbort` (WebView2 mode bridge).
  `SidecarMessage`: `ready` (extensions + load failures), `ui`/`uiPush` (UiTree), `error`, `ack`,
  `nativeCall` (extension asks the shell to do something), `windowCommand`
  (closeMainWindow/popToRoot/clearSearchBar), `launchCommand`, `webView`, `webResult`, `log`.
- Mapping to ours: our backend↔host named pipe and worker RPC map 1:1 (init ≈ loadCommand context,
  search ≈ initialize + render, action ≈ nativeCallback, nativeCall/nativeResult ≈ our
  request/result). The contract is JSON, ours is JSON — the adapter is structural, not conceptual.

### Extension model

- `manifest.json` at package root: `id`, `name`, `version`, `description`, `icon` (emoji), `entry`
  (bundled `main.js`), `commands[]` (`id`, `title`, `keywords`, `mode: "view" | "background"`,
  `ui: "tree" | "web"`, `arguments[]`, `disabledByDefault`, `interval` ≥ 60 s), `nativeMethods[]`
  (exact or `ns.*`), `httpHosts[]`, `oauth[]` (provider ids), `fsPaths[]` (globs with
  `{{preference}}` interpolation), `uriSchemes[]`, `preferences[]`. Validated twice (SDK + shell)
  and pinned by `contract/manifest.fixture.json`.
- Packages: `.flowkey` = plain zip (zip-slip, 32 MB/entry, 64 MB total, 512 entries caps,
  semver-strictly-newer install rule, per-capability consent stored at install and enforced per
  native call). Installed to `%LOCALAPPDATA%\FlowKey.Shell\extensions\<id>\` — we keep our own root.

### Runtime (sidecar)

- Node child process; loads bundles with `globalThis.__FLOWKEY_HOST__` = `{ react, reactJsx,
  reactUi, nativeSdk }` installed BEFORE the bundle import; build-time shims alias `react`,
  `react/jsx-runtime`, `@flowkey-cli/react-ui`, `@flowkey-cli/native-sdk` to modules that read the
  globals — one React copy by construction (this is the clean answer to the dual-React crash we
  fought with NODE_PATH stripping, and react-reconciler 0.33 brings React 19 semantics — the `use`
  hook works).
- `defineReactExtension({ manifest, component })` — component receives `CommandProps`:
  `{ query, filterValue, commandId, arguments, preferences, environment, window, native, capabilities, signal }`.
- `SearchHandlers` shape for tree-mode extensions: `search(query, ctx) → UiTree`, `onAction(actionId, item, ctx, formValues) → UiTree | null`, `command(commandId, ctx)` for background commands.
- Background schedules: `interval` commands re-run by the sidecar for its lifetime.
- Web mode (`ui: "web"`): WebView2 surface with `webView`/`webCall`/`webResult` bridging.

### UI trees (what the renderer receives)

`ListTree` (sections/items with `id`, `title`, `subtitle`, `keywords`, `accessories` (text + color),
`pane` (preview fields), `actions`, per-item `detail` (preview/image), `emptyView`, `filter`
dropdown, `isLoading`, `searchBarPlaceholder`, server `pagination`), `DetailTree` (fields with
link/tags/separator kinds, markdown description, `mediaKeys`), `GridTree`, `FormTree` (10 field
kinds incl. datepicker/tagpicker/filepicker, shell-owned editing state, `submitActionId`).
Strict prop whitelists enforced by the serializer (`unknown prop 'x' on <y>` errors).

### Capabilities (typed groups over `nativeCall`, consent-gated per manifest)

`http.fetch/fetchJson/upload` (manifest `httpHosts` allowlist), `clipboard` (read/write/paste +
full history management incl. pasteEntry/editEntry), `storage` (per-extension KV), `cache` (TTL,
disposable), **`oauth` (vaulted host-side: `authorize/status/disconnect`; tokens never reach the
extension; `http.fetch` injects via `options.auth`)**, `secrets`, `shell.openUrl/openPath/revealPath`,
`fs` (manifest-scoped globs, trash included), `apps.list/launch/frontmost/defaultFor`,
`media.current/control` (play/pause/next/previous via SMTC), `image.fetch` (download+downscale+cache
→ `file:` URI), `system.selectedText` (UIA first, Ctrl+C fallback), `hud.show`, `toast.show`,
`alert.confirm`.

### What our internal extensions use today vs. FlowKey equivalents

Our internal extensions (calculator, translator, clipboard-history, quicklinks, snippets, notes,
focus, games, taskbar, file-search, window-states) are **backend-native modules** that emit our
`ray-*` model directly — they consume no `@raycast/api` at all, so the grep gate does not force
their rewrite. The ones the user wants ported from FlowKey (spotify, lucide-icons) come with
FlowKey-native implementations already written against the capability surface above.

Gaps that matter for parity with what we already ship (details in §5):

| Our feature today | FlowKey equivalent | Gap |
|---|---|---|
| `ray-*` model: navigation stack (push/pop pages), metadata panes, dropdown filter, inline sections, form validation errors, action shortcuts | `UiTree` covers list/detail/grid/form + item pane/detail + filter + actions with `push`; no navigation **stack** semantics beyond `push`, no form field validation errors, no per-field icons in metadata | Adapter + library additions (§5) |
| API shim: `confirmAlert`, `Cache` LRU, `LocalStorage`, `Keyboard.Shortcut.Common`, `getPreferenceValues`, `launchCommand` with launchContext | `alert.confirm`, `cache`, `storage`, action `shortcut`, manifest preferences, `launchCommand(commandId, query)` | launchContext / launch arguments mapping (small addition) |
| OAuth: PKCE with per-extension token storage (`@raycast/api` shape) | Vaulted `oauth.*` + `http.fetch` `auth` injection | Port our PKCE machinery into the shell's vault routes; Spotify = bring-your-own client id (`SpotifyAuthConfig` pattern) |
| Clipboard history (OCR, paste, pin…) | `clipboard.history` capability + clipboard-history extension | Our backend's clipboard-store stays; capability route maps onto it |
| `media` playback (Spotify) | `media.current/control` (SMTC) | New host route (Windows SMTC — new native code) |
| `system.selectedText` | `system.selectedText` (UIA + Ctrl+C fallback) | New host route |
| Image fetch/downscale | `image.fetch` | New host route |
| Worker-per-command crash isolation | Sidecar is single-process (one extension crash kills all) | Keep our worker_threads topology under the FlowKey contract (§4) |

## 4. Integration approach

### What we adopt

1. **The FlowKey packages, vendored as `@flowkey-mini/*`** (no "raycast" in any name):
   `@flowkey-mini/native-sdk` (types + manifest validation + capabilities), `@flowkey-mini/react-ui`
   (components + reconciler host + serializer + hooks), `@flowkey-mini/cli` (esbuild shims +
   packaging). They are ports of `@flowkey-cli/*` from the FlowKey repo with attribution notes kept
   (MIT-style headers preserved; third-party derivations — e.g. the reconciler host pattern — keep
   their notes). Vendoring (copying into `build/flowkey/`) rather than an npm dependency keeps the
   repo self-contained and lets us extend the library (§5) without forks of a remote.
2. **Worker topology stays ours; the contract becomes FlowKey's.** Our `worker_threads` give
   per-command crash isolation that FlowKey's in-process sidecar lacks. So: the worker entry boots
   `installHostGlobals()` (React 19 + react-ui + native-sdk instances), loads the extension bundle,
   and speaks the FlowKey HostMessage/SidecarMessage contract with the backend over the existing
   worker RPC. The backend translates: `init` ↔ loadCommand context, `search` ↔ query pushes,
   `action` ↔ nativeCallback, `nativeCall` ↔ backend hostHandlers (with the manifest consent gate),
   `ui`/`uiPush` ↔ render pushes.
3. **Renderer: UiTree adapter.** A backend-side adapter converts `UiTree` → our existing `ray-*`
   wire model (list sections/items/accessories/detail map ~1:1; grid/form map to grid/form models;
   `push` maps to a synthetic navigation page; actions map to callback ids). The frontend keeps its
   renderer; FlowKey trees light it up without a frontend rewrite. Diff/gzip transport unchanged.
4. **Manifest + consent gate.** The backend validates manifests with the ported
   `validateManifest`, stores the accepted capability set per install, and enforces
   `nativeMethods`/`httpHosts`/`fsPaths` per native call (the classifier's job, done the FlowKey
   way).
5. **OAuth vault.** Our PKCE backend work (the raycast.com/redirect + clipboard handshake) is
   re-homed as the shell-side vault: `oauth.authorize/status/disconnect` routes keyed by provider,
   tokens never entering the extension, `http.fetch` `auth` injection. Spotify uses FlowKey's
   bring-your-own-client-id pattern (`spotify-auth.json` in the data dir / env var, optional fixed
   redirect port).
6. **CLI.** Port `@flowkey-cli/cli` as `@flowkey-mini/cli` (build/validate/package) and a
   `install-extension.ps1` replacement that installs `.flowkey` packages (or dev folders) into our
   extensions root with the consent step.

### Alternatives considered

- **Keep the @raycast/api shim and add FlowKey beside it** — rejected: two extension APIs to
  maintain, and the shim's React 18.3.1 ceiling is exactly what blocks Spotify views (`use`).
- **Run FlowKey's sidecar child-process as-is inside our backend** — most faithful, but it collapses
  crash isolation (one broken extension kills every extension) and duplicates Node processes; our
  worker topology already solves what the sidecar solves.
- **Render FlowKey UiTree natively in the frontend (skip our model)** — largest churn in the
  frontend for zero user-visible gain; the UiTree→model adapter gives parity now and the renderer
  can adopt the trees natively later if needed.
- **npm dependencies instead of vendoring** — FlowKey is versioned 0.x and we need library
  extensions (§5); vendoring with attribution keeps us in control and the repo self-contained.

## 5. Extension migration

### Ports from the FlowKey repo (user-requested, hand-written against FlowKey)

| Extension | What it needs | Notes |
|---|---|---|
| **spotify** (`flowkey-native/extensions/spotify`, ~30 source files + 10 test files) | `http.fetch` (7 allowlisted hosts), vaulted `oauth` (spotify, BYO client id), `secrets`, `image.fetch`, `hud.show`, `media.current/control`, `storage.*`, `clipboard.write` | FlowKey's own Spotify port replaces the raycast one entirely — no OAuth-in-extension, playback via `media.control` (SMTC), cover art via `image.fetch`. Needs: the OAuth vault (our PKCE work re-homed), `media.*` host route (new, SMTC), `image.fetch` host route (new), `secrets` host route (DPAPI or file-based). |
| **lucide-icons** (`flowkey-native/extensions/lucide-icons`) | `storage`/`cache`, list/grid views, copy actions | Smallest end-to-end port — migration pilot (M2). |

### Our own extensions

- `command-ux-test` → ported to `defineReactExtension` as the **contract-test extension** (M1):
  exercises list/detail/grid/form, actions, arguments, preferences, filter, pagination — the
  FlowKey equivalent of the old shim-probe.
- The backend-native internal extensions (calculator, translator, clipboard-history, quicklinks,
  snippets, notes, focus, games, taskbar, file-search, window-states) consume no `@raycast/api`;
  they keep working unchanged and migrate to FlowKey trees opportunistically later. The grep gate
  does not require them.

### Library additions the ports force (FlowKey gaps we add in `@flowkey-mini/*`)

1. `UiTree` → `ray-*` model coverage: metadata pane fields already exist; add navigation-stack
   mapping (FlowKey `push` → our page stack) and form validation-error transport if a port needs it.
2. `Keyboard.Shortcut.Common` equivalents as action `shortcut` presets (our host already parses
   Ctrl/Alt/Shift only).
3. Vaulted OAuth providers: `spotify` first (our PKCE + clipboard handshake behind
   `oauth.authorize`), provider registry in the shell config.
4. `media.*` host routes (SMTC) — new C# in the host, capability methods in the SDK.
5. `image.fetch` host route (download + downscale + cache under the data dir).
6. `secrets` host route (DPAPI-encrypted file under the data dir).
7. `system.selectedText` host route (UIA; optional Ctrl+C fallback).
8. Alias/hotkey surfaces for FlowKey commands in root search (reuses our existing aliases/hotkeys
   stores — they are keyed by extension/command ids).

## 6. Removal order (milestones, each ending green + committed)

- **M0 — safety (done before this plan):** `archive/store-final` tag; `feature/flowkey-lib`
  worktree from `feature/store`.
- **M1 — library in:** vendor `@flowkey-mini/{native-sdk,react-ui,cli}` under `build/flowkey/` with
  attribution; worker entry boots host globals + loads a bundle by manifest; contract tests
  (manifest fixtures pinned to `contract/*.fixture.json`; a worker round trip renders a List tree
  through the adapter; action invocation round trip). `command-ux-test` ported. Nothing removed yet.
- **M2 — first real extension:** lucide-icons ported end-to-end (root search entry, detail, copy
  actions, settings preferences via the IPC bridge). Store UI still present but unused.
- **M3 — spotify:** OAuth vault + `media`/`image`/`secrets`/`selectedText` host routes; spotify
  ported; BYO client id (`spotify-auth.json`); playback verified against the isolated instance.
- **M4 — Store removed:** delete `store.js`, `store-bundler.js`, `classifier.js`, store frontend
  (StoreView/storeApi/store.css), store routes in `backend.js`/`index.js`, harness scripts, store
  tests/fixtures, Store root-search entries and settings page content; one-time migration drops the
  six `store.sqlite` tables and deletes RaycastMini's own installed-extension folders + the stray
  extensions-root `node_modules` (never touches `~/.config/raycast` or MSIX); `getIcon`/
  junction logic re-created for the FlowKey installer.
- **M5 — shim + aliases removed:** delete `build/api/` (shim + runtime + built bundle),
  `worker-entry.js` api require, `NODE_PATH` wiring, `command-ux-test` @raycast shape, fixtures;
  rename/repoint `build.ps1`; icon comment rewrite; **grep gate** (below) passes; full suites green;
  isolated instance verified (pipe + data dir + extensions root isolated, hotkey caveat as before).

### One-time data migration (M4)

`store.sqlite`: `DROP TABLE IF EXISTS` for the six Store tables (the file itself stays — other
stores live elsewhere; store.sqlite holds only Store tables, so dropping leaves an empty DB that
can be deleted outright). `%LOCALAPPDATA%\RaycastMini\extensions\<handle>` folders for Store
installs are deleted (RaycastMini-owned). The extensions-root `node_modules` (stale dev-flow
artifact) is deleted. Aliases/hotkeys stores keep their entries; orphans are pruned by id.

## 7. Final gate

After M5, a grep over the repo must return **zero hits** for `@raycast/api`, `@raycast/utils` and
`raycast/extensions` across:

- all code (`*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`, `*.cs`),
- configs and manifests (`*.json` incl. `package.json` files and lockfiles, `*.ps1`, `.gitignore`,
  `.zcodeignore`),
- tests and fixtures.

Allowed to keep the strings: the REA spec documents (`docs/store-spec.md`, `docs/api-coverage.md`,
`docs/store-implementation-plan.md`) as historical analysis records, clearly marked as archived.
`build/api/package-lock.json` is regenerated/deleted with the package rename, since a lockfile
keeps the old name alive. The gate command is recorded in the plan and run with output in the
Phase 2 final report:

```
grep -rniE "@raycast/api|@raycast/utils|raycast/extensions" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.cjs" \
  --include="*.cs" --include="*.json" --include="*.ps1" build/ | grep -v node_modules
```
