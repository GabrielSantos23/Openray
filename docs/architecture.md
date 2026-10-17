# Architecture

One launcher, three processes, one command registry.

## Processes

| Process | Path | Owns |
|---|---|---|
| `Openray.exe` (WPF host) | `build/host/Openray.csproj` | Windows: named pipe server, hotkeys, windows, clipboard capture, focus loop, taskbar AppBar, HUD, media (SMTC) |
| `node backend/src/index.js` | `build/backend/` | Extension host: worker pool, all stores (settings, snippets, quicklinks, notes, calculator, translator, file index, clipboard history, usage, window states), **command registry**, control channel |
| WebView2 renderers | `build/frontend/` | Launcher, Settings, Notes windows (React/TS, dark UI, CSS-variable tokens) |

Topology: the host owns `\\.\pipe\openray-ipc` (per-instance name via `OPENRAY_PIPE`); the
backend dials in and answers host requests; the renderers reach the host through
`window.chrome.webview.hostObjects.ipc` and receive pushes as web messages.

## Layers

```text
L0 foundation      logging, JSON helpers                        build/backend/src/ (node builtins only)
L1 core services   stores, indexers, hooks                      build/backend/src/*.js
                   native services                              build/host/*.cs
L2 dispatch        backend.js routes methods -> handler tables  build/backend/src/backend.js
L2 registry        command registry, schemas, risk, event bus   build/backend/src/registry.js
                   command wiring (one command per method)      build/backend/src/commands/
L3 extensions      FlowKey worker pool + manifest scan          build/backend/src/backend.js, build/flowkey/worker/
L4 UI              launcher/settings/notes windows              build/frontend/src/, build/host/*Window*.cs
L5 control + MCP   loopback HTTP, MCP server, CLI               build/backend/src/control-server.js
                                                                build/backend/src/mcp-server.mjs, cli.mjs
```

Dependency rules (enforced by `node build/scripts/layer-check.mjs`):

- `registry.js` imports node builtins only.
- `commands/` imports node builtins and the registry.
- Nothing below L4 imports UI code; the frontend never imports backend sources.
- The registry and stores must not assume a window exists; UI-bound verbs fail with the
  typed `needs_ui` error.

## The registry/UI seam

Every backend method (`domain.action`) is a command with the same id, registered by
`build/backend/src/commands/index.js` from the existing handler tables — one dispatch path for
the pipe, control channel, CLI and MCP (docs/mcp-architecture.md). The UI keeps pure view
state (selection, panels, scroll); everything user-visible on the backend side is reachable as
a command. Handlers emit events (`settings.changed`, `registry.changed`, `command.finished`…)
instead of calling the UI.

## Extension runtime

A FlowKey extension is a folder with `manifest.json` (commands, preferences, consent lists).
`extensionHost.loadCommand` spawns/pools a `flowkey-worker.js` worker thread per running
command; the worker drives the host through `hostHandlers` (render, toast, clipboard, storage,
`nativeCall` with manifest consent gates). Registry ids: `ext.<extension>.<command>`;
`extensions.list/reload/run` manage them.

## Control channel and MCP

`--control` (or `OPENRAY_CONTROL=1`) starts a loopback HTTP server inside the backend with a
per-launch bearer token. The MCP server (`build/backend/src/mcp-server.mjs`, stdio) runs
bridged (control channel) or headless (registry in-process, UI verbs return `needs_ui`).
Protocol details: docs/control-protocol.md.
