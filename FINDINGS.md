# Raycast (Windows) — Reverse engineering findings

Target: `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a` (MSIX, `C:\Program Files\WindowsApps\...`).
The user pointed at `/Applications/Raycast.app` (macOS), which does not exist on this Windows host.
The installed artifact is the **Windows** Raycast build, version **2.4.0.0**, so all findings below are
about that build.

SHA-256 of analysed host assembly: `7477c32eb26a9d0ae9b315c3b42e0a1a3b1956e169b622a27b28cee5065a4f07` (`Raycast.dll`, 6 973 224 bytes).

---

## 1. What the app is made of (languages)

| Layer | Technology | Evidence |
|---|---|---|
| App shell / launcher window | **C# on .NET 10 (WPF)** | `Raycast.runtimeconfig.json`: `"tfm":"net10.0"`, frameworks `Microsoft.NETCore.App 10.0.11` + `Microsoft.WindowsDesktop.App 10.0.11`. `Raycast.dll` is a PE/CLI assembly, `implementation: cil`, `TypeDef: 4375`, `MethodDef: 34517`, `Field: 24813`. Deps include `WPF-UI 4.3.0`, `Microsoft.Web.WebView2 1.0.4129.50`, `CommunityToolkit.Mvvm`, `Microsoft.Data.Sqlite`, `Serilog`, `Sentry`. |
| Launcher / launcher UI | **TypeScript + React 19** bundled by **Vite** | `frontend/` is a Vite build (hashed chunk names, `__vite__mapDeps`), entry `frontend/main-window.html` → `main-window-g1Vb1JLY.js`, preloads `react-*.js`, `react-dom-aItrT30d.js`, `useQuery`, `useMutation`, … |
| Backend / extension host | **Node.js (ESM + CJS), obfuscated bundle** | `backend/node.exe` (87 MB), `backend/index.mjs` (7.7 MB, minified: everything renamed to 2–3 char identifiers, `E(()=>{...})` lazy-init wrappers). `backend/package.json`. |
| Native features | **Rust**, exposed to .NET through **UniFFI** | `native.dll` (6.9 MB) contains 289 `uniffi` symbols, 86 `rustc/` paths and ~250 `.rs` source paths (`kb_input_simulation.rs`, `uia.rs`, `clipboard.rs`, …). Raycast.dll contains matching `uniffi_native_fn_func_*` / `uniffi_native_checksum_func_*` symbols. |
| Search index / calculator | **Swift + Rust** | `backend/` ships `swiftCore.dll`, `swiftCRT.dll`, `swift_Concurrency.dll`, `Foundation*.dll`, `_FoundationICU.dll`, `SoulverCoreDynamic.dll`, plus N-API modules `data.win32-x64-msvc.node`, `indexer.win32-x64-msvc.node`, `Calculator.node`, `fs-utils.win32-x64-msvc.node`. |
| Extensions (3rd party) | **TypeScript + React**, plus optional Rust/Swift | See §5. |

So: **C#/.NET + TypeScript/React + Node.js + Rust** (with Swift only for the calculator/indexer).

---

## 2. Process model

```
Raycast.exe (WPF, .NET 10)  ── main process
  ├─ Raycast.UIAccess.exe       (UIAccess helper, separate app entry in AppxManifest)
  ├─ Raycast.SystemService.exe  (background service)
  ├─ Raycast.CrashHelper.exe    (crash dump helper)
  └─ Microsoft.Web.WebView2     (renderer for every window)

Node backend:  Raycast.exe spawns `backend/node.exe backend/index.mjs`
                and talks to it over a **named pipe** (System.IO.Pipes).
Per-running extension command: one Node **worker thread** inside that backend process.
```

Evidence:
- `AppxManifest.xml`: `Executable="Raycast\Raycast.exe"`, a second app `Raycast\Raycast.UIAccess.exe`, restricted capabilities `uiaccess`, `runFullTrust`, `allowElevation`.
- `Raycast.dll` strings: `System.IO.Pipes`, `NamedPipeServerStream`, `NamedPipeClientStream`, `Raycast.InterRaycastPipe.Client/<SendData>`, `Raycast.InterRaycastPipe.Server/<StartListening>`, `Raycast.Backend.XrayBackend/<Start>`, `Raycast.Backend.EventHandler/<OnRequest>`, `Raycast.App/<StartFrontendDevServerAsync>`.
- `Raycast.WebView.*` namespace: `Window`, `MainWindow`, `AiChatWindow`, `SettingsWindow`, `ThemeStudioWindow`, `WelcomeWindow`, `NotesWindow`, `PreviewWindow`, `PortalWindow`, `PlaygroundWindow`, `Bridge`, `BridgeHost`, `ResourceHandler`, `DefaultContextMenu`, `WindowAppearance`, `TitleBarOverlayWindow`, `WindowCaptureOverlayWindow`, `ScreenAreaCaptureOverlayWindow`.
- `Raycast.dll` methods: `Raycast.WebView.Window+<SendIPCRequest>`, `+<SendForwardedIPCNotification>`, `+<MonitorFrontendReadyTimeout>`, `+<webViewWindowWebView_CoreWebView2InitializationCompleted>`, `Raycast.WebView.Bridge+<SendRequestAsync>`, `Raycast.WebView.ResourceHandler+<HandleWebResourceRequest>`.
- `Raycast.Backend.NodeEnvironment`, `Raycast.Backend.FrontendNotificationQueue`, `Raycast.Backend.XrayBackend`.

---

## 3. How extensions are loaded

### 3.1 On-disk layout

`backend/index.mjs` resolves paths from the config root (`Fd()` = `<home>/.config/raycast`; on Windows the equivalent base is `%LOCALAPPDATA%\Raycast`, which is what this machine actually uses):

```js
function Fd(){ return Bc.join(dWn(), ".config", "raycast") }        // config root
function kn(e){ return Bc.join(Fd(), "extensions", e.uuid || e.name) }  // installed extension dir
function Fc(e){ return Bc.join(pe.SUPPORT_DIR, "extensions", e.uuid||e.name) } // bundled copy
function yq(e,t,n){ return Bc.join(e, t === "tool" ? "tools" : "", `${n}.js`) } // entry file
```

So an installed extension is:

```
<configRoot>/extensions/<extension-uuid>/
    package.json            # Raycast manifest ($schema …/schemas/extension.json)
    assets/                 # icons
    dist/<commandName>.js   # CommonJS bundle, produced by `ray build`
    tools/<toolName>.js     # AI "tools" entry points
    node_modules -> symlink to <app>/api/node_modules
```

The last line is the trick that makes the API resolution work: `backend/index.mjs` maintains the symlink

```js
async function Awt(e){
  let t = hIr(Fd(), "extensions", "node_modules");
  try {
    let n = await YOe.promises.readlink(t).catch(() => null);
    if (n === KOe) return;                                   // already correct
    await YOe.promises.rm(t, {recursive:!0, force:!0});
    await YOe.promises.mkdir(N5o(t), {recursive:!0});
    await YOe.promises.symlink(KOe, t, "dir");
  } ...
}
// KOe = hIr(__dirname, "..", "api", "node_modules")
```

i.e. `<configRoot>/extensions/node_modules` → `<app install dir>/Raycast/api/node_modules`, which contains
`@raycast/api` (the API), `react`, `react-reconciler`, `@parcel/watcher`, `react-devtools-raycast`, `@raycast/source-mapper`.

Manifest format, from the bundled template `Raycast/api/template/package.json` and from a real store
extension (`extensions-color-picker.zip`):

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "color-picker",
  "commands": [ { "name": "pick-color", "title": "Pick Color", "mode": "no-view" },
                { "name": "organize-colors", "mode": "view" },
                { "name": "menu-bar", "mode": "menu-bar" } ],
  "tools":   [ { "name": "analyze-contrast", "title": "Analyze Contrast" } ],
  "preferences": [ … ],
  "dependencies": { "@raycast/api": "^1.104.6" },
  "platforms": ["macOS", "Windows"]
}
```

Three command modes exist: `no-view` (runs and exits, no UI), `view` (renders into the launcher) and
`menu-bar` (renders into the status item).

### 3.2 The extension worker

Every running command executes inside a Node **`worker_threads` Worker**. The backend keeps a pool:

```js
var yIr, AIr, L5o, B5o, F5o, U5o, H5o, SIr, YI, VI, xie, t2;
yIr = bwt(KOe, "@raycast", "api", "index.js");     // worker entry point
F5o = 1;  U5o = 1;  H5o = 8;                        // pool sizes: prod=1, dev=1, max=8
YI  = { dev: [], prod: [] };                         // the pool
```

and launches it like this (note the environment — this *is* "how the API is exposed"):

```js
this.worker = new Worker(yIr, {
  workerData: this.context,                 // { isDevelopment, canAccessAI, appearance, textSize, … }
  stdin: true, stdout: true, stderr: true,
  env: {
    PATH: process.env.PATH,
    NODE_ENV: isDevelopment ? "development" : "production",
    NODE_PATH: join(__dirname, "..", "api", "node_modules"),   // <-- API resolution
    RAYCAST_VERSION: pe.VERSION,
    RAYCASTX: "1",
    RAYCAST_SCHEME: vY("Production"),
    HOME: …, TMPDIR: …, TEMP: …, LC_ALL: …, TZ: …,
    FAVICON_PROVIDER: …,
    NODE_COMPILE_CACHE: join(Fd(), "node-compile-cache")
  },
  resourceLimits: { maxOldGenerationSizeMb: 100 }
});
```

The worker entry point is **the API package's own `index.js`** — the same file that is published to npm as
`@raycast/api`. When Raycast starts a command it sends an `initialize` request into the worker whose
payload is the launch context (validated by a Zod schema in the worker):

```js
initialize: { params: {
  id, ownerOrAuthorName, extensionName, entryPointName, entryPointMode,
  assetsPath, supportPath, timeout?, startedAt, launchType, namedExport?,
  entryPointType: "command" | "tool" | "model_provider",
  commandPath?, toolPath?, modelProviderPath?,
  shouldExecuteFunctionsBeforeReturning?, preferences,
  argumentValues?, arguments?, model?, request?, streamId?,
  launchContext?, fallbackText?
}, returns: unknown }
```

The worker then loads `commandPath` (`<extRoot>/dist/<commandName>.js`, built by `ray build` as a
**CommonJS** bundle — see `Raycast/api/template/dist/tools/confirmation.js`, which is `module.exports = …`),
takes its default (or `namedExport`) export as the React component and renders it.

Pool lifecycle: workers are reused (`getFromPool`), prewarmed on launch, terminated when idle or when a
memory limit is hit (`maxOldGenerationSizeMb: 100`, `/Worker terminated due to reaching memory limit/`),
and the pool is cleared when the enable-setting is turned off.

---

## 4. How the API is exposed to extensions

**Over `worker_threads` `MessagePort`, using a small JSON-RPC protocol.** This is the single most
important finding, and it is fully readable in `api/node_modules/@raycast/api/index.js`:

```js
var Hs;                                              // Hs = require("worker_threads")
Hs.parentPort?.on("message", async (e) => {
  let { kind: t, id: r } = e;
  if (!t || !r) return;
  switch (t) {
    case "request":                                  // host -> extension
      try {
        let { method: o, params: n } = e;
        let s = await TM.get(o)?.(n);
        Hs.parentPort?.postMessage({ kind: "result", id: r, result: { success: true, value: B8(s) } });
      } catch (o) {
        Hs.parentPort?.postMessage({ kind: "result", id: r, result: { success: false, error: o } });
      }
      break;
    case "result":                                   // reply to an extension-initiated call
      let { result: o } = e;
      cC.get(r)?.(o); cC.delete(r);
      break;
  }
});

function FM(method, params, cb) {                    // the raw transport
  setImmediate(() => {
    if (cb) { let n = ot(); cC.set(n, cb);
              Hs.parentPort?.postMessage({ kind: "request", id: n, method, params }); }
    else    Hs.parentPort?.postMessage({ kind: "notify",  method, params });
  });
}
function T(method, params, meta, signal) {            // promise-returning RPC used by the public API
  return new Promise((resolve, reject) => {
    FM(method, params, (r) => {
      if (!signal?.aborted) {
        if (r.success === false) { /* nice "called with wrong type" message */ reject(r.error); return; }
        resolve(r.value);
      }
    }, signal);
  });
}
function jr(method, params) { FM(method, params); }    // fire-and-forget (logCommand, reportMemoryUsage, captureException)
```

So the API module is *not* a native binding. It is a **JSON-RPC client over the worker's parent port**.
There is no WebSocket, no named pipe and no child process between extension and Raycast (all the
`WebSocket` hits in the file come from the bundled `undici`, not the transport).

### The exposed surface

The worker-side Zod registry (`Nde`, `Pyt`, `q5o` in the bundle) defines every method the extension may
call. **67 entries**. Grouped:

*Extension-initiated requests (`T(...)`) — 56 of them, mirrored by the backend handler table `VOe`:*

```
allLocalStorageItems  authorizeOAuth  browserExtensionExecuteJS  browserExtensionGetContent
browserExtensionGetTabs  captureException  clearClipboard  clearLocalStorage
clearSearchBar  closeMainRaycastWindow  commandException  commandExited
completePrompt  createQuicklink  createRaycastNote  createSnippet
deleteRaycastNote  formReset  formSetFocus  getActiveWindow
getApplications  getClipboard  getDefaultApplication  getDesktops
getFrontmostApplication  getLocalStorageItem  getOAuthTokens
getSelectedFinderItems  getSelectedText  getWindowsOnActiveDesktop
hideToast  initOAuth  installMCPServer  launchCommand  logCommand
modelProviderStreamChunk  open  openCommandPreferences  openExtensionPreferences
openRaycastNote  paste  popToRoot  readRaycastNote  refreshModels
removeLocalStorageItem  removeOAuthTokens  render  renderEmpty
renderSuspense  reportMemoryUsage  searchRaycastNotes  setClipboard
setLocalStorageItem  setOAuthTokens  setWindowBounds  shakeMainRaycastWindow
showAlert  showHUD  showInFinder  showToast  toggleQuickLook
trashItems  updateCommandMetadata  updateRaycastNote  updateToast
```

*Host-initiated requests (dispatched through `TM`) — the ones the extension implements:*

```
initialize        params = the launch context (§3.2)
nativeCallback    { callbackId, data? }  -> { data? }
terminate         { code }
```

*Fire-and-forget notifications (`jr(...)`):* `logCommand`, `reportMemoryUsage`, `commandException`,
`captureException`.

Both directions are schema-validated. The backend does:

```js
async function wIr(workerId, method, params, id) {     // extension -> host
  let i = wwt(params), o = VOe[method];
  let ctx = Cwt(workerId);                             // resolve the running command for this worker
  let a = Pyt[method].params.safeParse(i);
  if (!a.success) throw new Error(`Invalid parameters for method ${method}`);
  let c = Pyt[method].returns.safeParse(await o(ctx, a.data));
  if (!c.success) throw new Error(`Invalid return value for method ${method}`);
  return c.data;
}
async function wY(workerId, method, params) {          // extension -> host, notify
  let i = q5o[method].params.safeParse(wwt(params)); await VOe[method](Cwt(workerId), i.data);
}
```

and the worker-side message loop (`z.worker.on("message")` in `index.mjs`) routes
`Notify` → `wY`, `Request` → `wIr` + `postMessage({kind:"Result", id, result})`, `Result` → the stored
resolver. Functions cannot travel over the port, so the API converts callbacks to `callbackId`s —
`B8(v)` maps promises/functions to the strings `"[Promise]"` / `"[Function]"`, and the renderer calls
back with `nativeCallback`.

---

## 5. How extension UI is rendered in the launcher

This is the cleverest part, and it is entirely visible in `@raycast/api/index.js`.

### 5.1 The extension renders its React tree *headlessly*

`react-reconciler` is listed in `api/node_modules` next to `react`. The API builds a
`ConcurrentRoot` container and installs a **custom React host config whose host component names are
Raycast's own**:

```js
const K = Reconciler(hostConfig);                       // the custom renderer
function Ew(e){                                         // createRoot(element)
  let t = nA.get(e), r = t?.fiber;
  let o = r || K.createContainer(e, ConcurrentRoot, null, isDev, null, "", console.error, null);
  return { render(n){ K.updateContainer(jsx(Provider, {children:n}), o, null, cb) },
           async unmount(){ … } };
}
```

The host tree is built from these node names (the "shadow tree"):

```
ray-navigation-stack      ->  navigationStack
ray-list                  ->  body kind "List"
ray-grid                  ->  body kind "Grid"
ray-form                  ->  body kind "Form"
ray-detail                ->  body kind "Detail"
ray-menu-bar-extra        ->  body kind "MenuBarExtra"
ray-top-level-suspense    ->  model.suspended = true
```

and is turned into a plain serialisable model:

```js
function rd(e){                                        // shadow root -> model
  if (e.childElements.length === 0) return { kind:"commandView", suspended:true };
  let t = { kind:"commandView" };
  e.childElements.forEach(r => {
    if (r.name === "ray-navigation-stack") {
      let { navigationStack:o, actions:n } = iP(r);
      t.navigationStack = o; if (n) t.actions = n;
    } else if (r.name === "ray-top-level-suspense") t.suspended = true;
  });
  return t;
}
function iP(e){                                        // one navigation stack frame
  let t = e.childElements[e.childElements.length - 1],
      r = { kind:"navigationStack", id:"navigationStack" };
  let { body:o, actions:n } = hee(t);
  r.body = o; r.navigationInfo = e.navigationInfo;
  let i = e.onPop; if (i) Qe(r, "onPop", async s => { i && K.batchedUpdates(i, s) });
  return { navigationStack:r, actions:n };
}
function hee(e){
  let t;
  switch (e.name){
    case "ray-menu-bar-extra": t = WL(e); break;
    case "ray-list":           t = JL(e); break;
    case "ray-grid":           t = HL(e); break;
    case "ray-form":           t = LL(e); break;
    case "ray-detail":         t = NL(e); break;
    default: throw new Error(`Unsupported navigation child: ${e.name}`);
  }
  return { body:t, actions: t.actions ? oP((delete t.actions, t.actions)) : null };
}
```

### 5.2 Diff + compress + send

```js
async function $c(e){                                    // "render" entry point
  let t = rd(e);                                         // model
  if (t.suspended) { … return await T("renderSuspense", {}); }
  let r = AP(uh || {}, t);                               // diff against previous model
  uh = t;
  if (!r.hasChanges) {                                   // nothing changed -> cheap "empty" frame
    …return await T("renderEmpty", {});
  }
  let o = JSON.stringify({ model: t, changes: r.changes });
  let n = jO(o);                                         // gzip + base64
  return await T("render", n);                            // { renderTree, gzipped }
}
```

`jO` gzips when the payload is large (`byteThreshold`/`minimumSavingsRatio`), and the render flag is
part of the schema: `render: { params: { renderTree: string, gzipped: boolean }, returns: unknown }`.

### 5.3 Backend → host → renderer

`backend/index.mjs` handler for `render`:

```js
b5o = async (ctx, t) => {
  if (ctx.entryPointType === "command" && ctx.entryPoint.mode === "menu-bar") {
    // menu-bar commands are parsed here and handed to the tray/menu-bar host
    let r = t.gzipped ? (await gunzip(Buffer.from(t.renderTree,"base64"))).toString("utf-8") : t.renderTree;
    let i = JSON.parse(r), o = findRootComponent(i);
    await z.host.menuBar.handleRender(commandId, ctx.worker.id, toMenuBarNode(o, assetsPath), i.isLoading ?? false);
    return;
  }
  await z.frontend.extensionHost.render({ ...t, sessionId: ctx.worker.id });
};
E5o = async (ctx, t) => { await z.frontend.extensionHost.renderEmpty({ ...t, sessionId: ctx.worker.id }); };
v5o = async (ctx, t) => { await z.frontend.extensionHost.renderSuspense({ ...t, sessionId: ctx.worker.id }); };
```

The C# host relays that to the WebView2 renderer. The renderer→host direction uses WebView2
**host objects**; the host→renderer direction uses `CoreWebView2.WebMessageReceived` +
`chrome.webview.addEventListener("message", …)`:

```js
class Bt {
  ipcRequest = window.chrome.webview.hostObjects.ipcRequest;
  constructor(handlers, notificationCenter) {
    this.messageProcessor = new Lt(handlers, notificationCenter);
    window.chrome?.webview?.addEventListener("message", this.handleMessage);
  }
  async request(module, method, params, timeout, trace) {
    let payload = params === undefined ? "" : this.messageProcessor.safeStringify(params, "request");
    let response = await this.ipcRequest.postMessage(method, payload, module === "backend", timeout ?? -1, trace?.traceId ?? "", trace?.baggage ?? "");
    return this.messageProcessor.safeParse(response, "response");
  }
}
```

Requests from the renderer are routed as `dispatchRequest("backend", "extensionHost.<method>")`, e.g.

```js
loadCommand:      (p,c) => request("backend", "extensionHost.loadCommand",      p, { timeout: 0, context: c }),
unloadEntryPoint: (p,c) => request("backend", "extensionHost.unloadEntryPoint", p, { context: c }),
callNodeCallback: (p,c) => request("backend", "extensionHost.callNodeCallback", p, { context: c }),
getInstalledNodeExtensionSummaries: () => request("backend", "extensionHost.getInstalledNodeExtensionSummaries"),
startDevelopment / stopDevelopment / getDevelopmentCommand / openInEditor / forkExtension /
importExtension / createExtension / addCommand / addTool / uninstall / getDiagnostics …
```

### 5.4 The renderer re-creates Raycast's own components from the model

`frontend/main-window-g1Vb1JLY.js` wires the whole per-command UI around a state machine
(`not-loaded → loading → loaded → unloading → unloaded / failure`):

```js
let c = await ipc.backend.extensionHost.loadCommand({
  extension, command, preferences, props, debug, origin: window.identifier
});
//                                      ^ returns { sessionId }
let u = extensionUIRegistry.get(c.sessionId);
u.registerRender(async (e) => {
  let t = DQ(e.renderTree, e.gzipped);            // gunzip(base64) -> JSON.parse
  ReactDOM.flushSync(() => setState(t));          // push the model into React synchronously
});
u.registerRenderEmpty(async () => setLoading(false));
u.registerRenderSuspense(async () => setSuspended(true));
```

```js
function DQ(renderTree, gzipped) {
  let text = gzipped
    ? gunzipSync(Uint8Array.from(atob(renderTree), ch => ch.charCodeAt(0)), { to: "string" })
    : renderTree;
  try { return JSON.parse(text); }
  catch (e) { throw Error("Could not deserialize render tree", { cause: e }); }
}
```

The command component then only renders from `renderTree.model.navigationStack`:

```js
let view = useMemo(() => {
  if (!u || !u.model.navigationStack.body) return;
  let info = u.model.navigationStack.navigationInfo;
  return { actions: u.model.actions, changes: u.changes, body: u.model.navigationStack.body,
           navigationInfo: info, createCallback, extension, command, commandProps, storedValues, draftId };
}, [u, …]);
// navigationInfo.action: "push" | "pop" | "new"  ->  mainRouter.push / back / …
```

and the host→renderer handler table registered for extension callbacks is:

```js
var Qne = {
  authorizeOAuth, clearSearchBar, closeMainRaycastWindow, commandException, hideToast, initOAuth,
  popToRoot, render, renderEmpty, renderSuspense, showAlert, showToast, showHUD,
  openCommandPreferences, openExtensionPreferences, ensureBrowserExtensionInstalled,
  createSnippet, createQuicklink
};
function render(e)     { return extensionUIRegistry.get(e.sessionId)?.render(e); }
function renderEmpty(e){ return extensionUIRegistry.get(e.sessionId)?.renderEmpty(e); }
```

User interactions inside the rendered view (action press, item select, form submit) call
`ipc.backend.extensionHost.callNodeCallback({ sessionId, callbackId, data })`, which the backend
turns into a `nativeCallback` request into the worker — closing the loop.

So, in one sentence: **an extension's React tree never executes in the renderer. It is rendered
headlessly inside a Node worker with a custom React renderer that emits `ray-*` host nodes, those
nodes are converted to a plain JSON model, diffed, gzipped and shipped over the worker port → Node
backend → named pipe → C# host → WebView2 host object, and the launcher re-materialises that JSON into
its own React components (`List`/`Grid`/`Detail`/`Form`/`MenuBarExtra`) inside the launcher window.**

---

## 6. Other notable subsystems (for completeness)

* **`Raycast.IPC.Types.*`** — a large, fully typed IPC message contract (hundreds of `…Input`/`…Output`
  records, MemoryPack-style `…SerializeHandler`/`…PropInit` helpers) between the C# host, the Node
  backend and the renderer.
* **Internal "extensions"** shipped in C#: `Raycast.Settings.{Applications,Focus,Games,WindowManagement,WindowsTaskbar}ExtensionMeta`,
  with `Raycast.Handlers.Settings.InternalExtensionSettingsUpdatedRequestHandler` and
  `settings.internalExtensionSettingsUpdated`. The frontend hard-codes an internal-extension registry
  (`ai`, `applications`, `clipboard_history`, `file_search`, `raycast_notes`, `organizations`,
  `quicklinks`, `settings`, `snippets`, `translator`, `window_management`).
* **Command kinds**: `Raycast.IPC.Types.CommandLaunchRequest`, `CommandLaunchType`, `CommandProps`,
  `CommandHotkey`; dynamic commands via `extension-dynamic-commands-*.js` and
  `extension-static-commands-*.js`.
* **AI "tools"** (not just commands): `tools/<name>.js` entry points with an optional `confirmation`
  export, driven by `Tool.Confirmation` (`Raycast/api/template/src/tools/confirmation.ts`).
* **Source maps**: errors are remapped in a dedicated `Worker` running
  `<app>/api/node_modules/@raycast/source-mapper/index.js`, with `reactComponentStack` /
  `reactOwnerStack` carried along so React component names survive in crash reports.
* **Security**: external command launches from hotkeys/deep links require an explicit confirmation
  dialog (`Request to run …`), with an "Always Run" opt-in persisted as
  `alwaysAllowsExternalLaunches`.

### 6.x Navigation-bar loading indicator (the bar under the search input)

Raycast does not use a spinner under the input; it renders a 1px animated gradient bar pinned to
the **bottom edge of the navigation bar**. Extracted from `frontend/command-list-item-accessory-*.css`
(`navigation-bar-ui__loaderClassic`) and the matching component in `command-list-item-accessory-*.js`
(`NavigationBarUI.Root`):

```css
.navigation-bar-ui__loaderClassic {
  height: 1px; position: absolute; bottom: 0; left: 0; right: 0;
  pointer-events: none;
  background-image: linear-gradient(to right, var(--loader-0) 25%, var(--loader), var(--loader-0) 75%);
  opacity: 0; transition: opacity .3s ease-in-out;
  animation: 1.5s ease-in-out infinite paused navigation-bar-ui__loaderClassic;
}
.navigation-bar-ui__loaderClassic[data-state=loading] { opacity: 1; animation-play-state: running; }
@keyframes navigation-bar-ui__loaderClassic { 0%,to{transform:translate(-35%)} 50%{transform:translate(35%)} }
```

* The parent `NavigationBarUI.Root` is a `<header>` with `position:relative; overflow:hidden`, so the
  sweeping gradient is clipped to the bar. `loaderGlow` is a 1px variant anchored to the **top**.
* **Timing**: `isLoading` is true → the component sets `data-state="loading"` only after a **300ms**
  `setTimeout` (so quick loads never flash the bar); false → immediate clear.
* **Colour**: `--loader` is a theme token; `--loader-0: rgb(from var(--loader) r g b / 0%)`. On the
  bundled Windows dark theme `loader = #FFFFFF` (Windows light `#000000`; macOS dark `#FFFFFF`).

Clone: `build/frontend/src/styles.css` (`.loader-bar` + `@keyframes loader-bar-sweep`, `--loader` /
`--loader-0` tokens) and `App.tsx` (`LoadingBar` component, 300ms delay, mounted in both the root
search and command-session headers). Verified in the browser harness: computed `height:1px`,
`bottom:0`, gradient `rgb(255,255,255)`, animation running.

---

## 7. Reproduction

See [`../build/`](../build/) for a working re-implementation of this architecture using the same
language stack: C#/.NET WPF launcher + TypeScript/React renderer + Node worker-thread extension host
+ a re-implementation of the `@raycast/api` surface.
