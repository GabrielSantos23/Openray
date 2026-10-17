# Updates (update check + update card)

Openray checks GitHub Releases for a newer version and, when one exists, pins an unsectioned
**"New Update Available"** card at the top of the root search (above Favorites, empty query
only) with an **Install Update** button in the launcher footer — the shipped design in
`docs/ui-design.md`.

## How it works

```
backend/src/updates.js        createUpdates(): GitHub Releases check, version compare, install
frontend/src/update.ts        useUpdateState(): mirrors backend state via updates.changed pushes
app/buildSections.ts          the "update" section (headerless first row)
app/App.tsx                   card row, Enter/footer/panel actions, footer Install Update button
.github/workflows/release.yml builds a v* tag into a release zip
```

- **Schedule:** one check 15s after backend boot, then every 6 hours while the backend lives.
  `updates.check` forces a check; `updates.getState` returns the current snapshot.
- **Compare:** numeric segment compare (`2.10 > 2.9`), tag prefixes (`v`) stripped. A release
  equal to or older than the running version shows nothing; a 404 (no releases yet) is not an
  error.
- **Card actions:** Enter or click = **Install Update**; Ctrl+K opens the action panel
  (Install Update / Open Release Page / Copy Download URL / Skip This Version).
  `Skip This Version` persists in `<dataRoot>/updates-state.json` and is overridden by any
  newer release.
- **Install:** the backend downloads the release's `.zip` asset to
  `%TEMP%\Openray-update\<asset>` (streamed, 10-minute timeout) and reveals it in Explorer via
  the host's `shell.revealFile`. The app never replaces its own files at runtime — the user
  runs the extracted installer themselves.
- **Renderer sync:** every state change pushes `updates.changed` to the launcher, so the card
  appears without a reload; the footer button shows whenever an update is available,
  independent of the selected row.

## Configuration

| Knob | Default | Meaning |
| --- | --- | --- |
| `OPENRAY_UPDATE_REPO` | `GabrielSantos23/Openray` | GitHub `owner/repo` checked for releases |
| `APP_VERSION` (`updates.js`) | `2.4.0.0` | running version; keep in sync with the csproj |

The checked repository must be **public** (the check is unauthenticated GitHub API; a private
repo returns 404 and the card simply never shows).

## Cutting a release

1. Bump the version in all three places so they match the tag:
   - `build/host/Openray.csproj` `<Version>`
   - `build/frontend/package.json` `version`
   - `build/backend/src/updates.js` `APP_VERSION`
2. `git tag v2.4.1 && git push origin v2.4.1`.
3. `.github/workflows/release.yml` builds the frontend (`vite build`), installs the backend
   runtime deps, `dotnet publish`es the host, stages the layout and creates the GitHub Release
   with `Openray-<version>-win-x64.zip` and generated notes.

The zip layout is what the host resolves at runtime (`BackendProcess.cs`: repo root contains
`backend/` and `frontend/`):

```
Openray-<version>/
  Start Openray.cmd        sets OPENRAY_ROOT=%~dp0app and starts the exe
  app/Openray.exe + dlls   dotnet publish output
  app/backend/src + node_modules + package.json
  app/frontend/dist
```

Run `Start Openray.cmd` from the extracted folder. Node.js 20+ is required on the target
machine (the host spawns `node backend/src/index.js`).

## Registry surface

`updates.getState` / `updates.check` (read), `updates.skipVersion` / `updates.install`
(write) — registered through `wiring.registerTable("updates", …)`, so the control channel, CLI
and MCP can drive them.
