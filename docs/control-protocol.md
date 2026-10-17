# Control protocol

Loopback HTTP server inside the Node backend. Off by default; enabled with `--control` (argv)
or `OPENRAY_CONTROL=1`. Binds to `127.0.0.1` only, random port unless `OPENRAY_CONTROL_PORT`
is set.

## Auth

A 256-bit token is generated at every launch and written to `<dataRoot>/control-token`
(0600); `<dataRoot>/control-endpoint.json` records the loopback address for bridged clients.
Both paths are printed at startup; **the token itself is never logged**. Every request
requires `Authorization: Bearer <token>` (timing-safe compare). Failures return
`401 { ok:false, error:{ code:"unauthorized" } }`.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/commands?filter=&domain=` | — | `{ ok, result: { commands: [{ id, title, description, risk, domain }] } }` |
| GET | `/commands/:id` | — | full command description (params JSON Schema, risk) or 404 `unknown_command` |
| POST | `/commands/:id/run` | `{ params?, allowDestructive? }` | the registry envelope `{ ok, result \| error }` |
| GET | `/state` | — | `{ ok, result: LauncherState \| null }` |
| POST | `/input` | one input event | `{ ok, result: { ok } }` |
| GET | `/screenshot` | — | `image/png` body, or 503 `needs_ui` when capture fails |
| GET | `/events?since=&limit=` | — | `{ ok, result: { events: [{ name, data, at }] } }` |

Every renderer/host round trip is bounded (15s) and answers `504 { code: "timeout" }` when
the app is gone.

## `get_state` shape (`LauncherState`)

```json
{
  "window": "launcher",
  "view": "root | command-view | dialog:<name>",
  "query": "current search text",
  "windowMode": "expanded | compact",
  "sections": [{ "id": "apps", "title": "Applications", "count": 42 }],
  "items": [{ "index": 0, "kind": "application", "title": "7-Zip" }],
  "selectedIndex": 3,
  "selected": { "index": 3, "kind": "application", "title": "7-Zip" },
  "openDialog": "application-panel | command-panel | ... | null"
}
```

Item `kind` mirrors the renderer's entry kinds (application, extension, internal, quicklink,
calculator, color, translate, file, inline, wm-command, focus-*, game, …).

## Input events

App-internal routing only — no OS-level input injection. Events are applied by the
renderer's `window.__openrayControl.input` hook:

- `{ type: "text", text }` — append to the search query
- `{ type: "setQuery", query }` — replace the query
- `{ type: "clear" }`, `{ type: "backspace" }`
- `{ type: "key", key }` — dispatches a synthetic `keydown` through the window-level
  handlers (ArrowDown/ArrowUp move the selection, Enter activates, Escape pops)
- `{ type: "action", name: "openSettings" | "close" | "popToRoot" }`

Read `/state` after each step; state updates commit on the next React render (~a frame).

## Risk gate

`run` refuses commands with `risk: "destructive"` unless the body sets
`allowDestructive: true`; the refusal is `200 { ok:false, error:{ code:"destructive_refused" } }`.
Validation failures return `invalid_params` with the schema violation in `message`.

## Screenshot limits

`PrintWindow` with `PW_RENDERFULLCONTENT` captures the composed window (WPF chrome + WebView2
content). The launcher hides itself on deactivation and a hidden window's web layer does not
compose (black frame), so the host makes the window visible first and waits a few frames —
the capture may therefore surface the window. Only the launcher window is captured; the
Settings window (separate WebView2 browser process) is not.

## Events

The ring buffer (500 entries) carries `command.started`, `command.finished`, `command.failed`,
`registry.changed` and domain pushes (`settings.changed`, …). `since` filters by epoch ms.
