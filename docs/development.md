# Development

## Build and test

```sh
node --test build/backend/tests/                    # backend tests (note: the fuzz test needs --test-force-exit, see below)
node --test --test-force-exit build/backend/tests/command-fuzz.test.mjs
node --test build/tests/                            # frontend logic tests
cd build/frontend && npm run build                  # typecheck + bundle the frontend
dotnet build build/host/Openray.csproj -c m3-release           # host build
node build/scripts/layer-check.mjs                  # one-way layering check
```

The app instance used for day-to-day testing runs from
`build/host/bin/m3-release/net9.0-windows10.0.19041.0/Openray.exe` with dev extensions and a
debuggable WebView2 (`--remote-debugging-port=9223`, CDP on `127.0.0.1:9223`).

## Run with the control channel

```sh
$env:OPENRAY_PIPE='openray-ipc-m3'; $env:OPENRAY_DATA_DIR="$env:LOCALAPPDATA\Openray-m3"; `
  $env:OPENRAY_DEV_EXTENSIONS='1'; $env:OPENRAY_CONTROL='1'
build\host\bin\m3-release\net9.0-windows10.0.19041.0\Openray.exe
```

`--control` on the backend argv works too. On startup the backend writes two files under the
data dir: `control-token` (per-launch bearer token) and `control-endpoint.json`
(`127.0.0.1:<port>`); their paths are printed, the token never is.

## Drive the running app

```sh
node build/backend/src/cli.mjs list [filter]              # list registry commands (bridged if the app runs, else headless)
node build/backend/src/cli.mjs run settings.get '{"key":"zoom"}'
node build/backend/src/cli.mjs run calculator.calculate '{"expression":"6*7"}'
node build/scripts/mcp-verify.mjs                          # MCP protocol smoke test
node build/backend/scripts/phase6-verify.mjs               # full end-to-end scenario through MCP
```

Raw HTTP against the control channel (token in `<dataRoot>/control-token`):

```sh
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/commands?filter=snippets
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/state
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"type":"setQuery","query":"clip"}' http://127.0.0.1:$PORT/input
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/screenshot -o shot.png
```

MCP client config for Claude Code and friends: docs/mcp-architecture.md.

## Debug tricks

- **CDP**: `--remote-debugging-port=9223` exposes the launcher renderer; use JS evaluation
  only (`window.__openrayTest`, `window.__openrayControl`) — never inject OS-level input.
- **Pipe probe**: `node %TEMP%\m3-probe.js openray-ipc-m3 <method>` calls one backend method
  over the named pipe.
- **Crash diagnosis**: Windows Event Log (Application, Id 1000/1026). A classic failure is
  file IO inside the low-level keyboard hook — hooks time out and the process dies; use a
  UI-thread-polled flag instead.
- **Logs**: the host writes `launcher.log` under the data dir; the backend logs to the host's
  stderr.
- The Settings window is a separate WebView2 browser process and is NOT reachable through the
  CDP port; verify its UI statically or through `settings.*` commands.
