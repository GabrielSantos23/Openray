# MCP architecture: command registry, control channel, MCP server

Status: Phase 0 (discovery) complete; phases 1–7 in progress. This file carries the repo map
(Phase 0), the design, and at the end the Phase 6 verification log.

## 1. What exists today (Phase 0 discovery)

### Layers and paths

| Layer | Responsibility | Path |
|---|---|---|
| L0 foundation | Types, logging (`launcher.log`), JSON helpers | `build/backend/src/` (Node), `build/host/` (C#) |
| L1 core services | Settings (`settings-store.js`), storage (SQLite/JSON stores: notes, snippets, quicklinks, calculator history, window states, usage), file search index (`file-indexer.js`), clipboard history store (`clipboard-history.js`) | `build/backend/src/*.js` |
| Native services | Hotkeys, window management geometry, clipboard capture/OCR, focus loop, taskbar AppBar, HUD/toast windows, media (SMTC) | `build/host/*.cs` |
| L2 dispatch | Method routing to handler tables, native forward, renderer push | `build/backend/src/backend.js` (`dispatchMessage`) |
| L3 extension runtime | FlowKey worker pool (one `worker_threads` worker per running command), manifest scan, extension host handlers | `build/backend/src/backend.js` + `build/flowkey/worker/` |
| L4 UI | Launcher + Settings + Notes windows: React/TS over WebView2; WPF chrome | `build/frontend/src/**`, `build/host/MainWindow.xaml.cs`, `SettingsWindow.cs`, `NotesWindow.cs` |
| L5 control + MCP | *(this work)* registry, control channel, MCP server, CLI | `build/backend/src/registry.js`, `control-server.js`, `cli.js`, `mcp-server.js` |

Process topology: `Openray.exe` (WPF host, owns the named pipe `\\.\pipe\openray-ipc`)
← `node backend/src/index.js` (extension host; dials the pipe)
← WebView2 renderers (launcher, Settings, Notes) that call host objects per window.

### How the UI triggers actions today

The renderer calls `window.chrome.webview.hostObjects.ipc.postMessage(method, payload, isBackend, …)`
(`build/frontend/src/ipc.ts`). `isBackend=true` requests are forwarded over the pipe to the Node
backend; `isBackend=false` requests are answered by the WPF host itself (`MainWindow.DispatchIpcAsync`
→ `window.*`, `settings.*` chrome routes, or `NativeHost.DispatchAsync` for `shell.*`, `clipboard.*`,
`applications.*`, `fileSystem.*`, `windowManagement.*`, `focus.*`, `games.*`, `taskbar.*`, `media.*`).
The backend routes by method prefix to per-domain handler tables installed by `index.js`
(`snippets.*`, `quicklinks.*`, `calculator.*`, `notes.*`, `focus.*`, `settings.*`, `advanced.*`,
`games.*`, `taskbar.*`, `translator.*`, `fileSearch.*`, `usage.*`, `clipboardHistory.*`,
`extensionHost.*`) and forwards unknown `clipboard.*`/`shell.*`/etc. verbs to the host as
`{module:"backend", method:"native"}` requests.

Logic tied to the UI today: root-search composition, list selection, action panels and all view
state live in `App.tsx`/`buildSections.ts` (renderer only); window visibility, hotkeys and native
chrome live in the WPF host. Those stay out of the registry except through explicit commands
(`ui.*`, `window.*`).

### Table of user-visible actions and where they live

| Action | Where it lives today |
|---|---|
| Settings read/write (every toggle) | `settings-store.js` (`settings.getAll/set/replaceAll`), pushed to both renderers as `settings.changed` |
| Calculator evaluate, history, preferences, colors, rates | `calculator.js` / `calculator-engine.js` (`calculator.*`) |
| Snippets CRUD, pinning, import/export, resolve | `snippets.js` (`snippets.*`) + `SnippetHook.cs` (expansion) |
| Quicklinks CRUD, pinning, open/resolve, import/export | `quicklinks.js` (`quicklinks.*`) + placeholders (`placeholders.js`) |
| Notes CRUD, trash, markdown conversions | `notes.js` (`notes.*`) + `NotesWindow.cs` |
| Translator: quick translate, languages, custom commands | `translator.js` (`translator.*`) |
| Clipboard history: list, pin, delete, copy, OCR, save | store in `clipboard-history.js`; OCR/image verbs in `ClipboardNative.cs` (`clipboardHistory.*`) |
| Raw clipboard read/write/clear | `NativeHost.cs` (`clipboard.*`) |
| Applications list / launch / foreground probe | `Applications.cs` (`applications.*`) |
| File search | `file-indexer.js` (`fileSearch.*`) |
| Window management (52 verbs) + saved states | `WindowManagementNative.cs` (`windowManagement.*`), saved states in `window-states.js` |
| Focus sessions | `focus.js` (`focus.*`) + `FocusSession.cs` |
| Games flags, Game Mode | `games.js` (`games.*`) + `GameMode.cs` |
| Taskbar settings | `taskbar.js` (`taskbar.*`) + `TaskbarWindow.cs` |
| Advanced: backups/export, connection prefs | `advanced.js` (`advanced.*`) |
| Usage tracking | `usage-tracker.js` (`usage.*`) |
| Extension Store (catalog) | `store/` (`store.*`) |
| Extension commands (FlowKey) | `backend.js` `extensionHost.loadCommand` → worker |
| Launcher window show/hide, Settings window, HUD, toast | `MainWindow.xaml.cs` (`window.*` frontend-module routes) |

### How extension commands are declared and invoked

A FlowKey extension is a folder under the extensions root with `manifest.json` (`commands` keyed by
`id`, `mode: "view"|"background"`, preferences, `nativeMethods`/`httpHosts` consent lists). The
backend rescans the folder per `allExtensions()` call. The renderer launches one with
`extensionHost.loadCommand({extension:{uuid}, command:{name}, preferences, props})`; the backend
spawns/pools a `flowkey-worker.js` worker thread, initializes it with the command context, and the
worker drives the host through `hostHandlers` (render, toast, clipboard, storage, `nativeCall`…).
From the outside, listing = `allExtensions()` (already exposed as `extensions.list`), running =
`loadCommand` with the extension/command pair.

## 2. Design

- **Registry lives in the Node backend** (lowest layer that runs without a window):
  `build/backend/src/registry.js`. Every internal-extension method becomes a command whose id is the
  existing method name (`domain.action` — the codebase already uses that shape), so the pipe, the
  control channel, the CLI and MCP all dispatch through one path with no parallel handlers.
- **Event bus + ring buffer** in the registry: `command.started`, `command.finished`, `command.failed`
  plus domain events (`settings.changed`, `registry.changed`, …). `get_events` reads the buffer.
- **Native verbs** (`shell.*`, `applications.*`, `clipboard.*`, …) are registered as commands that
  forward to the host over the existing pipe. Without a connected host they return the typed
  `needs_ui` error.
- **Control channel**: loopback-only HTTP server inside the backend process (`control-server.js`),
  off by default, enabled with `--control` (argv) or `OPENRAY_CONTROL=1`. Random bearer token per
  launch written to `<dataRoot>/control-token` (user-only directory); the path, never the token, is
  printed at startup.
- **MCP server**: `build/backend/src/mcp-server.mjs` over stdio (`@modelcontextprotocol/sdk`,
  1.x). Bridged mode talks to the control channel using the token file
  (`--data-root <dir>` or `OPENRAY_DATA_DIR` picks the instance); headless mode builds the
  registry in-process with no pipe. Auto-detect by probing the control endpoint;
  `--mode bridged|headless` forces one. After a backend restart the gateway re-reads the
  endpoint/token files and retries for a grace period, so a killed sidecar recovers without
  restarting the client.
- **CLI**: `node build/backend/src/cli.mjs run <command.id> [jsonParams] [--allow-destructive]`,
  `cli.mjs list [filter]` and `cli.mjs mcp`. Same registry, same envelopes; bridged when the
  app is running, headless otherwise.
- **`get_state` / `send_input` / `screenshot`**: `get_state` and `send_input` are answered by the
  renderer (a serializable state hook and an input hook injected in the frontend, both reachable
  through the host's `window.eval` route — app-internal event routing, no OS input injection);
  `screenshot` is a new `window.capture` native route that renders the WPF window to PNG.

## 3. Risks

- **Threading**: the C# host answers pipe requests on thread-pool threads; window capture and
  `window.eval` must hop to the UI dispatcher (existing routes already do this).
- **Window focus**: driving the launcher via the control channel must not steal focus; input is
  routed inside the renderer, not via `SendInput`.
- **Extension sidecar lifecycle**: a dead worker must surface as a typed error, not a hang —
  `loadCommand` already rejects on worker exit; `extensions.run` adds a timeout wrapper.
- **Settings safety**: `settings.set` accepts arbitrary keys by design; the registry keeps that
  behavior and validates only types, so every Settings control remains reachable.
- **Pipe writer discipline**: the backend has exactly one pipe reader; the control channel must use
  the existing `send` path, never open a second connection.

## 4. MCP client config (Claude Code)

```json
{
  "mcpServers": {
    "openray": {
      "command": "node",
      "args": ["C:\\path\\to\\Openray\\build\\backend\\src\\mcp-server.mjs"],
      "env": { "OPENRAY_DATA_DIR": "C:\\Users\\<you>\\AppData\\Local\\Openray" }
    }
  }
}
```

The server auto-detects: bridged when the app is running (endpoint + token under the data
dir), headless otherwise. `--data-root <dir>` / `--mode bridged|headless` override.

## 5. Phase 6 verification log (2026-10-17)

All steps ran through the MCP server over stdio (`build/backend/scripts/phase6-verify.mjs`,
13/13 pass) against the running app with the control channel on:

1. `tools/list` — the seven tools (`list_commands`, `describe_command`, `run_command`,
   `get_state`, `send_input`, `screenshot`, `get_events`) plus the `openray://commands`
   resource.
2. `list_commands filter=calculator` — 14 commands; `describe_command settings.set` — risk
   `write`, params schema present.
3. `run_command settings.set {values:{phase6-probe}}` → `settings.get` round-trips the value.
4. `run_command calculator.calculate {expression:"6*7"}` → answer `42`.
5. `get_state` — `{window:"launcher", view:"root", items:123}`; `send_input setQuery
   "clipboard"` → `get_state` shows `query:"clipboard"`, items filtered to 18 (UI matched).
6. `screenshot` — PNG (magic `89504e47…`), visually verified as the real launcher window
   (`build/shot-control2.png`).
7. `run_command extensions.list` — installed extensions with their commands.
8. `run_command clipboard.deleteAll` without the flag → `destructive_refused`.
9. Killed the backend `node` process mid-session: the bridged gateway re-read the endpoint,
   the host watchdog restarted the backend, and `calculator.calculate` answered again
   (recovery verified through the same MCP connection).
10. `get_events` — the ring buffer carried `command.finished` for the run.
11. Headless mode with the app closed: `cli.mjs run calculator.calculate '{"expression":"2+2"}'`
    → `{"ok":true,...answer:"4"}`; `get_state`/`screenshot`/`send_input` return the typed
    `needs_ui` envelope.

Known limits (documented, not bugs): the Settings window is a separate WebView2 browser
process, so `get_state`/`screenshot` cover the launcher window only; settings changes are
verified through `settings.get`/`settings.list`. The launcher auto-hides on deactivation;
`screenshot` makes it visible first, so a capture may surface the window.

