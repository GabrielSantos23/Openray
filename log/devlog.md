# Devlog

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
