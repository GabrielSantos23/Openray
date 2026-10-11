# Store spec — how the real Raycast for Windows installs, builds, stores and loads Store extensions

Evidence sources (all analysis-only, no execution of native code):

| Source | What it is |
|---|---|
| `artifacts/shell/Raycast.exe` (sha256 `bf7171814353bdf27be03283c2a7804972eab4dc5be51e3afa95a032c23a04a7`) | Analysis-only copy of the shipped launcher from the MSIX package `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`. Ghidra-analyzed (`rea analyze` in this session). |
| `artifacts/backend/index.mjs` (7.7 MB) | The shipped Node backend bundle (`<MSIX>\Raycast\backend\index.mjs`), confirmed running as `<MSIX>\Raycast\backend\node.exe --disable-sigusr1 <MSIX>\Raycast\backend\index.mjs` (Win32_Process CommandLine, this session). Minified; symbols quoted below are its own names. |
| `artifacts/api/node_modules/@raycast/api/index.js` (990 KB) | The shipped `@raycast/api` runtime bundle that the app provides to extensions. |
| `C:\Users\gabs\.config\raycast\extensions\<uuid>\` | The real on-disk install tree of ~20 Store extensions (read-only inspection). |
| npm `@raycast/api@2.7.3` | Official CLI (`ray`) + official `types/index.d.ts` (9,712 lines) = authoritative public API surface. |
| `artifacts/frontend/*.js` | Shipped renderer chunks (store UI names, `node-extension-*` chunks). |

Tagging: **[CONFIRMED]** = read from shipped code (minified symbol given) or observed on disk. **[UNCONFIRMED]** = not directly observed; each has a default under "Our decisions".

## 1. Process model [CONFIRMED]

- The WPF shell (.NET 9, WPF + WebView2 — `Raycast.dll` is a managed WPF assembly; deps list `Microsoft.Web.WebView2.Wpf`) spawns its own bundled Node: `backend\node.exe --disable-sigusr1 backend\index.mjs`. `backend.pid` lives in `%LOCALAPPDATA%\Raycast\node\`.
- The backend spawns extension code on **worker_threads**, not child processes. Worker program is the API bundle itself: `yIr = join(apiNodeModules, "@raycast", "api", "index.js")`; `new Worker(yIr, { workerData: <context>, stdin: true, stdout: true, stderr: true, env: { PATH, NODE_ENV, ... }, maxHeapSizeMb: 100 })` (symbol `yIr`, pool object `YI={dev:[],prod:[]}` in `index.mjs`).
- Extensions resolve `@raycast/api` through `NODE_PATH = join(backendDir, "..", "api", "node_modules")` — the app owns the API; extension bundles externalize it (`env` object in `index.mjs`; confirmed on disk: installed command bundles start with `require("@raycast/api")` and their `node_modules` contains no `@raycast`).
- V8 compile cache dir `<support>/.config/raycast/node-compile-cache` (function `AWn`); Node `NODE_COMPILE_CACHE`-style caching only, no other precompilation observed at run time.

## 2. Install flow (Store) [CONFIRMED unless noted]

All from the installer `Gwt` and store client `Kd` in `backend/index.mjs`:

1. **Search/lookup**: `store_listings/latest` (POST, filter by ids) and `extensions/<handle>/<name>` (GET, Bearer token; response includes `readme`, sanitized by `iZo`). Store install tool `gos` ("install-store-extension") has `requiresConfirmation: !0` and shows Extension / Author / Installs in its confirmation.
2. **Gates before download**:
   - Platform: `zIr` → `TY(e) = wEn(e, "Windows")` where `wEn` is `e.platforms ? e.platforms.includes(t) : (e.access === "private" || t === "macOS")`. So a Store listing without a `platforms` field is macOS-only and refused on Windows (`"${title} is not available on Windows"`). `ignorePlatformRestrictions` bypass exists (internal flag).
   - API version: `$Ir` compares the extension's `api_version` minimum against the app version, default minimum `1.25.0`, error "requires Raycast API v… Update Raycast to install this extension."
3. **Download**: streamed ZIP from `extensions/<handle>/<name>/download` (Bearer token) into a temp file `<id>-<nonce>.zip`.
4. **Extract**: ZIP → temp dir; content root located by finding `package.json` (handles a single wrapper directory).
5. **Build**: nothing happens here — the Store serves a **prebuilt release ZIP**. [CONFIRMED: no bundler/esbuild/npm call in the install path `Gwt`; installed trees contain flat compiled `*.js` + `.map` and a populated `node_modules`. The `ray` CLI (npm package, depends on `esbuild`) does `npm install && npm run dev` for *development* extensions (`hCr` builds that command string; dev extensions carry `localSources`).] Where Raycast CI builds the ZIP is outside the app. [UNCONFIRMED → our decision: we build locally with esbuild at install time.]
6. **Manifest processing**: parse `package.json` (strip `@workaround/` from `name`, validate `Hy.parse`), compute `commandDigests`, `toolDigests`, `modelProviderDigest` (`mZo` — content digests per command/tool, used for update detection), collect icon variants per extension/command/tool (`pZo`), commands stored with `isEnabled: !disabledByDefault`, tools with `confirmation: !1` default.
7. **Atomic install**: target `<installRoot>/extensions/<uuid>`; staging dir `.<id>-<nonce>.staging` inside the target's parent; existing install backed up to `.<id>-<nonce>.backup`; staging renamed into place; DB record added/updated; full rollback (files + DB) on any failure; temp dirs cleaned in `finally`.
8. **Database**: extension/commands/tools state lives in encrypted local DBs (`main.db`, `settings_v2.db` — headers show encrypted (SQLCipher-like) non-SQLite bytes; table names visible in code: `node_extensions` (settings_v2) holds enable state, synced meta, enabled_fallback_command_ids; per-command settings under `commands`).

## 3. On-disk layout of an installed extension [CONFIRMED, on disk]

```
~/.config/raycast/extensions/<uuid>/          ← install root (function kn: join(Fd(), "extensions", uuid))
├── <commandName>.js                          ← compiled command bundle (esbuild CJS, flat at root)
├── <commandName>.js.map
├── tools/<toolName>.js                       ← tool bundles (function yq)
├── assets/                                   ← extension assets incl. icons (assets/google-translate.png)
├── node_modules/                             ← runtime deps bundled into the release zip
│   └── .raycast-shared-dependencies          ← marker for shared dedup
└── package.json
%LOCALAPPDATA%\Raycast\extensions\<uuid>\com.raycast.api.cache\   ← LocalStorage persistence
```

`Fd()` resolves to `join(home, ".config", "raycast")` on Windows too [CONFIRMED: observed install tree at `C:\Users\gabs\.config\raycast\extensions`]. `Fc()` (`join(SUPPORT_DIR, "extensions", uuid)`) is the alternate (support-dir) root used for dev extensions. [UNCONFIRMED which of the two `Fc` paths is used when → default: we use one root only.]

## 4. Manifest fields [CONFIRMED from a real installed package.json (Google Translate) + official schema + d.ts]

- Extension: `name`, `title`, `description`, `icon`, `author`, `contributors`, `categories`, `keywords`, `license`, `platforms`, `commands[]`, `tools[]`, `preferences[]`, `dependencies`, `devDependencies`, `ai` (top-level AI declarations), `icon`/`iconVariants` (light/dark), `api_version` (gate, §2).
- Command: `name`, `title`, `subtitle`, `description`, `mode` (`view`|`no-view`|`menu-bar`), `keywords`, `disabledByDefault`, `arguments[]` (name, placeholder, type text/password/dropdown, required, data), `preferences[]`, `permissions[]`, `interval` (background refresh), `refreshTitle`, `clear searchBarState`.
- Preference: `name`, `title`, `type` (`textfield`|`password`|`checkbox`|`dropdown`|`appPicker`|`directory`|`file`), `required`, `description`, `placeholder`, `default`, `data` (dropdown options), `required`. Preference values reach the API as objects and are flattened as `preferences[r]?.value ?? preferences[r]?.default` [CONFIRMED: `pne()` in shipped `@raycast/api` bundle].
- Tools (`tools[]`): `name`, `title`, `description`, `mode: "tool"`, `parameters` (JSON-schema-like), `requiresConfirmation`/`confirmation` [CONFIRMED both spellings: manifest default `confirmation: !1` in installer; Tool namespace `Tool.Confirmation` in d.ts]. Tools are compiled to `tools/<name>.js`, registered separately from commands, and update flows can kill-list and remove them (`kill_listed_at` → uninstall).

## 5. Runtime request surface between worker and backend [CONFIRMED, backend/index.mjs]

- Method schema registered on the worker link includes `nativeCallback: { params: { callbackId, data? }, returns: { data? } }` and `terminate` — callbacks are invoked by id with a data payload and can return data (streaming AI text uses `nativeCallback {callbackId: streamCallbackId, data: {value: text}}`; clicks deliver `{callbackId, data: {type: "left-click"|"right-click"}}`).
- Worker context (`workerData`) carries: `canAccessAI`, `canAccessBetterAIModels`, `isBrowserExtensionInstalled`, `canAccessWindowManagement`, `appearance`, `textSize`, `commandName`, `commandMode`, `preferences` (objects with `value`/`default`), `launchContext`. [CONFIRMED: `canAccess` body and `environment` getters in shipped api bundle; backend passes `canAccessAI: (has_pro_features || has_better_ai) && !any_organization_has_ai_disabled`, `canAccessWindowManagement: !!0 || has_pro_features`.]

### environment.canAccess [CONFIRMED, shipped api bundle]

```text
canAccess(feature):
  feature === AI (enum object or its values)            → workerData.canAccessAI
  feature is a string in AI.betterAIModels              → workerData.canAccessBetterAIModels
  feature === BrowserExtension permission (or values)   → workerData.isBrowserExtensionInstalled
  feature === WindowManagement permission (or values)   → workerData.canAccessWindowManagement
  anything else                                          → true
```

There is no per-API static gating at runtime — everything is canAccess + real implementations. On this machine (no pro subscription) `canAccessAI` is false.

## 6. AI / MenuBarExtra / BrowserExtension / WindowManagement handling

- AI: `AI.ask` streams via `nativeCallback` with `{value}` chunks through the backend to Raycast's servers. Desktop-window command AI access is the `canAccessAI` flag above. [CONFIRMED transport shape; server side out of scope.]
- MenuBarExtra: `mode: "menu-bar"` commands render a persistent menu-bar item (d.ts `MenuBarExtra` namespace with `rootView`, `Item`, `ActionStyle`, action events `left-click`/`right-click` delivered via `nativeCallback`). The Windows build ships the API namespace; no menu-bar host UI observed in the WPF shell. [UNCONFIRMED whether Windows 2.4.0.0 actually hosts menu-bar commands → default: unsupported, gated.]
- BrowserExtension: `BrowserExtension.getWindowsContent|getSelectedTab|openTabInBrowser` gated by `isBrowserExtensionInstalled` [CONFIRMED in `canAccess`]; native companion not present in the WPF shell deps.
- WindowManagement: full namespace in d.ts (`getWindowsOnActiveDesktop`, `setWindowBounds`, screens/desktops), gated by `canAccessWindowManagement` (false without pro on Windows).

## 7. Store UI metadata [CONFIRMED endpoint shapes, backend/index.mjs]

Store listing objects carry: `id`, `title`, `description`, `author` (`{name, handle}`), `owner`, `categories`, `platforms`, `download_count`, `updated_at` (unix seconds — stored as the extension `version`), `source_url`, `readme_url`, `store_url`, `access`, `commands` (with titles), `aiToo…` (AI-related flags), `kill_listed_at`. Updates: `store_listings/latest` filtered by installed uuids, compared by `updated_at` (`Kd.checkForExtensionUpdates`); kill-listed extensions are uninstalled with settings during update ("Removed because this extension was withdrawn from the Store").

## 8. What we mirror vs decide (for RaycastMini)

Mirrored as-is (already in the clone, now evidence-confirmed): bundled node process over named pipe; worker_threads with the API bundle as worker program; NODE_PATH-provided `@raycast/api`; `nativeCallback {callbackId, data}`; dev/prod worker pools; ~100 MB heap cap; preference objects `value ?? default`; LocalStorage dir per extension uuid.

Our decisions (deltas):

| # | Decision | Why |
|---|---|---|
| D1 | Catalog from GitHub `raycast/extensions` (sparse checkout, pinned commit), not Raycast's store API | Task requirement; no Raycast account/auth needed; local-first |
| D2 | Build at install time with esbuild (`npm install` + bundle per command to `<cmd>.js`, externalize `@raycast/api`/`react`) | Real app installs prebuilt zips we cannot produce; dev-mode flow (`hCr` = `npm install && npm run dev`, CLI uses esbuild) shows esbuild is the official bundler |
| D3 | Install root `%LOCALAPPDATA%\RaycastMini\extensions\<uuid>` (existing clone root) | Clone's data dir convention; isolation from the real app |
| D4 | `environment.canAccess`: false for AI, betterAI models, BrowserExtension permissions, WindowManagement; true otherwise — exact routing of the real `canAccess` | Confirmed real behavior; unsupported ⇒ false |
| D5 | No compatibility gating at runtime beyond canAccess; unsupported API calls throw a typed error naming the call | Task policy; real app has no runtime gating either |
| D6 | Tools listed in manifests are ignored (not built, not registered, never block install) | Task policy |
| D7 | Commands with `mode: "menu-bar"` are classified unsupported (disabled) | No menu-bar host exists in clone; real Windows hosting unconfirmed |
| D8 | Background refresh (`interval`) implemented only if confirmed in the real app | Task requirement; the real backend has extension interval handling [UNCONFIRMED for Windows → default: classify interval commands as unsupported-disabled, revisit] |
