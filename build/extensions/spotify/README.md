# Spotify (RaycastMini)

Spotify search, library, now-playing and player commands for RaycastMini, ported from the
FlowKey launcher (`GabrielSantos23/flowkey-launcher`, `flowkey-native/extensions/spotify` —
the user's own project) with attribution notes kept from the upstream sources.

Changes from the source:

- imports `@flowkey-mini/*` instead of `@flowkey-cli/*`; bundled by `build.mjs` (esbuild +
  the sidecar shims);
- the 9 `ui: "web"` command entries render through their tree implementations instead
  (`search.tsx`, `now-playing.tsx`, `library.tsx`, …) — RaycastMini has no WebView2 command
  surface; the upstream web bundle (`src/web/`) is not ported;
- OAuth runs through RaycastMini's vault (`build/backend/src/flowkey-vault.js`): bring-your-own
  client id via `%LOCALAPPDATA%\RaycastMini\oauth\spotify-auth.json` (`{"clientId":"..."}`, optional
  `"redirectPort"`) or the `FLOWKEY_SPOTIFY_CLIENT_ID` environment variable; the loopback PKCE
  redirect lands on `http://127.0.0.1:<port>/oauth/callback` and the tokens stay in the backend;
- `media.current` / `media.control` are declared but the SMTC host bridge (M5b) is pending —
  playback commands surface the typed "not implemented yet" error until then;
- `window.launchCommand` subviews (`album-songs:<id>`, …) need the backend launch route (pending).

Everything works offline of Raycast's services: search/library/playback talk straight to
`api.spotify.com` with the vault-injected token; lyrics via `lrclib.net`; artwork cached from
the `*.scdn.co` hosts — all allowlisted in `manifest.json` `httpHosts`.
