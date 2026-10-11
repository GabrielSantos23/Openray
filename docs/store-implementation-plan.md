# Store implementation plan (Phase 2 proposal — awaiting approval)

Everything here builds on docs/store-spec.md (REA evidence) and docs/api-coverage.md. Work happens in the worktree `C:\Users\gabs\.t3\scratch\RaycastMini-store`, branch `feature/store`.

## 1. Architecture decisions

### 1.1 Build pipeline

**Decision:** at install time run `npm install --omit=dev --no-audit --no-fund` inside the checked-out extension source, then bundle each command entry point with esbuild (platform `node`, target `node22`, format `cjs`, `metafile: true`) into `<extensionsRoot>/<uuid>/<commandName>.js`, with `external: ["@raycast/api", "react", "react/jsx-runtime", "react-reconciler"]` and everything else bundled. Native addons (`.node` files) are left external and served from the extension's `node_modules`. Output layout mirrors the real app: flat `<commandName>.js` per command, `assets/` copied, no `tools/` directory ever produced (policy D6).

Alternatives considered:
- **Run TypeScript directly at runtime (tsx/ts-node):** slow per launch, drags a compiler into every worker, diverges from the real app's compiled-bundle model. Rejected.
- **Prebuilt release ZIPs like the real Store (docs/store-spec.md §2.5):** we cannot produce them — that build happens in Raycast's CI outside the app. Rejected.
- **Install the extension's `node_modules` and run unbundled:** unmodified extensions are TypeScript/JSX; Node 22 cannot execute that. esbuild is unavoidable. The official `ray` CLI itself depends on esbuild (confirmed in the npm package's dependencies), so this is the official toolchain.

### 1.2 @raycast/api layer

**Decision:** extend the existing `build/api` shim additively (it already renders List/Grid/Detail/Form through the worker reconciler + nativeCallback, confirmed working). Phase 2 work: fix `environment.canAccess` to the real routing (store-spec §5); add `UnsupportedApiError`; add the missing-but-planned exports (`Cache`, `trash`, `showInFinder`, `Action.OpenWith`, `Action.Trash`, `getDefaultApplication`); convert current mocks (AI.ask, OAuth stubs, getSelectedText/getFrontmostApplication stubs) into typed throws or real implementations; wire `getPreferenceValues`/preferences from the new per-extension preference store; implement `launchContext`.

Alternatives:
- **Fork the real shipped API bundle:** it talks Raycast's private request surface (`completePrompt`, OAuth proxying, etc.) — incompatible with our backend method names; also 990 KB of minified code we'd have to trust. Rejected.
- **New parallel API package:** duplicates the working shim. Rejected.

### 1.3 Process isolation of extension code

**Decision:** keep worker_threads exactly as today (matches the real app — REA §1 of store-spec) with `resourceLimits.maxOldGenerationSizeMb: 100`, one worker per running command session, pools dev/prod. A crashed/thrown worker: session torn down, worker discarded (not pooled), `commandException` toast with the extension name, logged. No change to the host process.

Alternative: child_process per command (stronger isolation, matches Raycast for Mac's separate processes). Rejected: diverges from confirmed Windows behavior, complicates the existing renderer round-trip, and worker crash already cannot take the app down (the backend restarts it, BackendProcess.cs supervision).

### 1.4 Store command

**Decision:** a new internal extension surfaced like the others (root search entry "Store"), implemented as: new backend module `build/backend/src/store.js` (catalog fetch, sparse checkout, install/update/uninstall, classification, SQLite `store.sqlite` + `store-settings.json` under the data dir, following the per-extension store convention) + new frontend full-window view `build/frontend/src/features/store/StoreView.tsx` (modeled on ClipboardHistoryView: search list → detail view → Install/Update/Uninstall with progress rows). Install progress via existing toast/push mechanism; the renderer listens like it does for other backend pushes.

Alternatives:
- **Store as an installable .rmini-style extension:** would need the API layer to self-host — circular. Rejected.
- **Backend-only command with generated JSON models:** already how internal extensions work; chosen (same as Clipboard History: backend store + feature view).

### 1.5 Compatibility classifier

**Decision:** static, three levels, computed per command entry point:

1. **Manifest level** (`package.json`): extension `platforms` must include `"Windows"` to be listed; command-level `platforms` (if present) filters commands; `mode: "menu-bar"` → unsupported; `interval` → unsupported (background refresh, decision D8); `tools[]` ignored entirely.
2. **Source level:** per command entry point, esbuild runs anyway for bundling — its **metafile** gives exactly which `@raycast/api` / `@raycast/utils` imports each bundle pulls in. For *called* symbols (importing `AI` unused vs `AI.ask(...)`), scan the per-command bundle output for call signatures (`AI.ask`, `.ask(`, `OAuth`, `WindowManagement.`, `BrowserExtension.`, `MenuBarExtra`, `runAppleScript`, `osascript`, `environment.canAccess`) plus a per-file AST-free regex pass over the original entry source for the same markers. Unsupported symbol used outside a guard → command class `disabled` with the symbol list as reason.
3. **Guard level:** `environment.canAccess(<unsupported symbol>)` appearing in the source marks that usage *optional* — the command stays enabled (runtime canAccess answers false, matching the real app).

Classes: `compatible`, `partial` (some commands enabled, some disabled), `disabled-command`, and extension-level `installable` (≥1 compatible command) / `not-installable` (all commands incompatible). Persisted in `store.sqlite` (`extension_classifications`, `command_classifications` with `missing_apis` JSON, `reason`, `coverage_version`); recomputed when `coverage_version` (bumped whenever api-coverage changes) differs at startup, so commands re-enable themselves when we implement an API.

Alternative: runtime probing (launch each command and record errors). Rejected as the primary mechanism (side effects, slow) but kept as the harness (Phase 2.6) which does exactly this once per extension at classification time.

## 2. File map

New files/directories (all in the worktree):

| Path | Purpose |
|---|---|
| `build/backend/src/store.js` | Store module: catalog, sparse checkout, install/update/uninstall, registry in SQLite |
| `build/backend/src/store-bundler.js` | esbuild bundling + npm install orchestration + metafile |
| `build/backend/src/classifier.js` | Static compatibility classifier (manifest/source/guard levels) |
| `build/backend/src/store-schema.sql` / migrations inline | `store.sqlite` schema |
| `build/backend/tests/store.test.mjs` | Pipeline tests (bundle a fixture, install, list, uninstall) |
| `build/backend/tests/classifier.test.mjs` | Classifier tests incl. all required fixtures |
| `build/backend/tests/fixtures/<5 fixture extensions>` | tools-only-AI, AI.ask direct, optional AI behind canAccess, macOS-only command in Windows extension, menu-bar command |
| `build/backend/tests/gating.test.mjs` | Root-search + Store gating logic, runtime error path |
| `build/backend/tests/harness.test.mjs` | 15-extension harness runner/report |
| `build/frontend/src/features/store/StoreView.tsx` + `store.css` | Store full-window view (search/detail/install progress) |
| `build/extensions/store/` | Internal extension manifest giving the root-search "Store" entry |
| `build/scripts/harness-report.mjs` | Runs the harness headlessly, prints the per-extension report |

Existing files modified (shared-file overlaps — **likely merge conflicts with the other agent**, kept small and additive):

| Path | Change |
|---|---|
| `build/backend/src/backend.js` | Register `store.*` handler table; route unsupported-API throws to a failure toast naming the extension; expose `extensions.refreshSummaries` push |
| `build/backend/src/index.js` | Register the store module (same pattern as clipboard/quicklinks registration) |
| `build/api/src/index.ts` | Additive exports, `UnsupportedApiError`, `canAccess` fix, preference/launchContext wiring |
| `build/frontend/src/app/CommandSession.tsx` | One new `case "store"` route to StoreView |
| `build/frontend/src/app/App.tsx` | Handle summaries-refresh push (re-fetch installed command entries) |
| `build/frontend/src/app/entries.ts` / `buildSections.ts` | Disabled commands: badge + reason line, excluded from alias/hotkey |
| `build/frontend/src/styles/base.css` | Store view styles (new classes only) |
| `build/host/NativeHost.cs` | Only if `getSelectedText` gets a real implementation: one new `shell.captureSelectedText` route (additive) |
| `build/scripts/build.ps1` | At most: no change expected; store module needs no build step |

## 3. Installation end to end + security model

1. **Catalog**: fetch `https://api.github.com/repos/raycast/extensions/git/trees/main?recursive=0` for the pinned-ref listing + per-extension `package.json` via raw.githubusercontent at the same pinned commit (fetched once, cached in `store.sqlite` with the commit sha; refresh button does a new fetch). The pinned commit is recorded at every fetch; installs pin exactly that commit.
2. **Fetch source**: `git clone --filter=blob:none --no-checkout https://github.com/raycast/extensions <cache>` then `git sparse-checkout set extensions/<name>` and checkout the pinned commit — sparse, blob-filtered, one cache shared by all extensions.
3. **Pinned commit**: recorded in `store.sqlite` per install (`commit_sha`), displayed in the Store detail and in the install confirmation.
4. **Dependencies**: `npm install --omit=dev` inside the extension copy (npm cache shared; no scripts executed by us beyond npm's own lifecycle — documented risk in §9).
5. **Build**: per-command esbuild bundles into the install root (`%LOCALAPPDATA%\RaycastMini\extensions\<uuid>\<command>.js`), assets copied, manifest copied.
6. **Classification**: run the classifier over the built bundles + manifest; store classes.
7. **Registration**: insert into the store registry, then refresh `extensionHost.getInstalledNodeExtensionSummaries` push so root search picks the commands up (fixes the "summaries loaded once at mount" gap via the new push).
8. **Update**: `store.checkForUpdates` compares catalog commit + per-command digests (mirrors the real app's `commandDigests`, store-spec §2.6); update = reinstall with backup/rollback exactly like the real installer (staging dir, rename, DB rollback).
9. **Uninstall**: remove install dir + registry row + classification rows + LocalStorage, unregister aliases/hotkeys for its commands.

**Security model**: the Store detail always shows name, author, contributors, last update, commit sha, README, screenshots (from the repo's metadata/images), and per-command status. Install requires an explicit click on **Install** — nothing downloads, builds or runs before that, and no extension code executes at install time (bundling imports nothing). Extensions run only when the user launches a command; each runs in its own worker thread with a 100 MB heap cap; a crash is contained and toasted. Tools are never built or loaded (D6). Commands classified disabled cannot be launched, aliased or hotkeyed (UI blocks it and the backend refuses the launch).

## 4. API shim design and order (driven by docs/api-coverage.md)

Order of implementation, each item ending with a test:

1. `UnsupportedApiError` + `environment.canAccess` real routing (AI / betterAI models / BrowserExtension / WindowManagement → false, else true) — matches REA-confirmed behavior.
2. Convert mocks: `AI.ask`, `useUnstableAI`, `OAuth.*`, `BrowserExtension.*`, `WindowManagement.*`, `MenuBarExtra` launch → throw naming the call. Host maps the throw to a failure toast with the extension name + backend log.
3. Missing-but-planned: `Cache` (in-memory), `trash`, `showInFinder`, `Action.OpenWith`, `Action.Trash`, `getDefaultApplication` — all thin wrappers over existing native routes.
4. `getSelectedText` / `getFrontmostApplication`: implement `shell.captureSelectedText` in NativeHost (Ctrl+C synth on focused window with clipboard save/restore) or, if that proves fragile, typed throw — decided during Phase 2 with the honest report updated either way.
5. `getPreferenceValues` / per-command `preferences` + `launchContext` + `launchType` from the launch session context (store session preferences per extension/command in `store-settings.json`-style files, exposed in the existing extension preferences pane).
6. Renderer: disabled-command badge + reason in root search and Store detail.

Unsupported-call failure contract (applies to everything marked missing/out-of-scope): typed `UnsupportedApiError { call, extensionName, commandName }` → toast "<Extension>: <call> is not supported" → backend log entry. Never a silent no-op, never fake data, never any external AI/network call by us.

## 5. Classifier data model

```
extension_classifications(uuid PK, name, coverage_version, installable, badge, computed_at, commit_sha)
command_classifications(uuid, command_name, class, missing_apis JSON, guarded_apis JSON, reason, mode, PRIMARY KEY(uuid, command_name))
```

`class ∈ {compatible, disabled-manifest, disabled-api, disabled-mode}`; `badge` at extension level ∈ {none, "some features unavailable", "requires unsupported APIs"}. Policy mapping (per the task): tools ignored; installable iff ≥1 compatible command; disabled commands greyed with one-line reason ("Requires Raycast AI, not supported"); optional AI (canAccess-guarded) stays enabled.

## 6. Testing without disturbing the other agent

- All code and commits in worktree `../RaycastMini-store` (branch `feature/store`); main working tree untouched.
- Tests are headless (`node --test`), using fixture extensions in `build/backend/tests/fixtures/` and the harness driving the store module directly (no app launch).
- If a live instance is warranted: `RAYCAST_MINI_PIPE=raycast-mini-store-test`, `RAYCAST_MINI_EXTENSIONS_ROOT=<worktree>\.store-data\extensions`, `RAYCAST_MINI_ALLOW_MULTI=1`, plus a new `RAYCAST_MINI_DATA_DIR` override (the only host change beyond NativeHost; additive, listed above) so logs/SQLite stay out of `%LOCALAPPDATA%\RaycastMini`. The global hotkey cannot be isolated (one process per hotkey): our instance would fail to register Ctrl+Alt+Space and log it — acceptable for testing; documented for the user instead of fighting over it. Default plan: **headless-only verification**, and I give exact commands to run the isolated instance.
- Never touch the other agent's processes, the main tree's output folder, or uncommitted files.

## 7. The 15 harness extensions

From `github.com/raycast/extensions`, each pinned to the catalog commit; the harness skips any whose `platforms` lacks `Windows` (reporting the skip). Candidate list with reasons:

1. **google-translate** — canonical simple extension: view + no-view commands, preferences, no unsupported APIs (the real machine has it installed — good comparison point).
2. **emoji** — plain search view, large icon usage (exercises Icon fallback).
3. **npmjs** — plain API-backed list, dropdown preferences.
4. **kill-process** — no-view + arguments, shell usage.
5. **clipboard-history** — official, preferences + sectioned list (overlaps our internal one, tests coexistence).
6. **currency-conversion** — preferences (dropdown), plain network call.
7. **urban-dictionary** — minimal view command, smoke test.
8. **doi2bib** (or similar tiny utility) — minimal no-view.
9. **github** — OAuth imports; expect `partial`: commands importing OAuth disabled, token-preference commands enabled (exercises classifier source level).
10. **spotify-player** — required by the task report: uses AppleScript/osascript on macOS → expect `disabled` commands with reason "Requires AppleScript (macOS), not supported"; classification detail reported explicitly.
11. **window-management** — imports `WindowManagement` → expect all commands disabled, extension installable-but-empty per policy (≥1 compatible command fails → reported `not-installable`); exercises WindowManagement class.
12. **ai-translator** (or any AI.ask-using extension listed for Windows) — direct AI usage → disabled with "Requires Raycast AI, not supported".
13. **chatgpt** — AI-heavy + preferences → disabled commands, optional-AI contrast.
14. **create-quicklink-using-ai** (or an extension with canAccess-guarded AI) — optional AI behind `environment.canAccess` → stays enabled, runtime answers false.
15. **raycast-ascii-art / hash** (any plain tool) — harness filler for count statistics; final list fixed at harness time by what `platforms=Windows` filtering admits, reported honestly.

(The harness also runs the 5 synthetic classifier fixtures from §2 but does not count them as store extensions.)

## 8. Milestones (each = small group of commits + acceptance tests)

| Milestone | Commits | Acceptance |
|---|---|---|
| M1 Pipeline | store-bundler.js + tests | `node --test` bundles a fixture TS/JSX extension with npm deps into runnable command files; bundles execute in a worker against the shim |
| M2 Classifier | classifier.js + 5 fixtures + tests | All five policy cases classify as specified; classification persists; coverage-version recompute works |
| M3 API shim | build/api additions + tests | canAccess routing tests; every out-of-scope call throws typed error; Cache/trash/showInFinder/OpenWith tested; no existing suite regresses |
| M4 Store command | store.js + StoreView + registrations | Install/update/uninstall of a fixture end-to-end headless; install-gate tests (no download without explicit call); root-search gating tests (disabled commands blocked from alias/hotkey/launch) |
| M5 Harness + specs | harness runner + spec status updates | 15-extension report produced; everything classified compatible passes; disabled commands never launched; Spotify classification reported |

## 9. Risks, unknowns, out of scope

- **npm install runs lifecycle scripts of extension dependencies** (supply-chain surface identical to the real app's dev flow). Mitigation: `--omit=dev`, pinned catalog commit, only-on-click install, worker isolation at run time. Documented, not solved.
- **GitHub API rate limits** for catalog fetches without auth — cached, refresh is manual; raw.githubusercontent is unauthenticated and cheap.
- **API gaps surface per extension** — the harness measures this; extensions using deep parts (OAuth flows, menu-bar) will be disabled, not half-working.
- **`getSelectedText` via synthetic clipboard** can race with user clipboard use (the real app has native support). Fallback: typed throw, honestly reported.
- **The real app's encrypted DBs** could not be read (SQLCipher-like headers) — command-enable-state schema is confirmed only via code references, not data. Unconfirmed; our own schema is independent.
- **Background refresh (`interval`)** — Windows confirmation not found in REA session → classified unsupported (D8). If evidence appears, revisit.
- **Out of scope**: AI, OAuth, BrowserExtension, WindowManagement, menu-bar commands, tools (per task); porting the real app's store backend/auth; the other agent's in-flight work.
