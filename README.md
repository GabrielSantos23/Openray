# Openray

A keyboard-driven launcher for Windows: root search, clipboard history, window management,
quicklinks, snippets, notes, focus mode, a media-aware Spotify extension, an extension store,
and more.

## Architecture

| Layer | Stack | Path |
| --- | --- | --- |
| Host | .NET 9 WPF (`Openray.exe`) — windows, global hotkeys, clipboard, native OS surface | `build/host` |
| Backend | Node.js extension host — named-pipe bridge, extension worker pool, stores | `build/backend` |
| Frontend | TypeScript + React in WebView2 — launcher, HUD, Settings, Notes windows | `build/frontend` |
| Extension library | FlowKey worker library + bundled extensions (Spotify, Lucide Icons, …) | `build/flowkey`, `build/extensions` |

The host owns the named pipe and spawns the Node backend; the backend runs each extension
command in a worker thread and renders through a small React serializer. All persistence
(settings, clipboard history, quicklinks, usage, extension storage) lives under
`%LOCALAPPDATA%\Openray`.

## Build & run

```powershell
# frontend
cd build/frontend
npm install
npm run build

# backend
cd ../backend
npm install

# host (produces Openray.exe)
cd ../host
dotnet build Openray.csproj -c Release
```

## Extensions

Extensions are Node packages with a `manifest.json` and are installed per-user under
`%LOCALAPPDATA%\Openray\extensions\<uuid>`. The bundled Spotify extension talks directly to
the Spotify Web API (bring your own client id) and exposes search, library, queue, devices,
now-playing and no-view playback commands.
