# Svgl (Search SVG Logos)

A clean-room port of the [svgl extension for Raycast](https://github.com/raycast/extensions/tree/main/extensions/svgl)
(MIT, by 1weiho, ridemountainpig, 0xdhrv) onto the FlowKey extension SDK. Logo data and the
component-generation endpoints are served by [svgl.app](https://svgl.app) (MIT); nothing from
the upstream repo ships in this tree — behavior was re-implemented from its sources.

## Command

**Search SVG Logos** (`ext.svgl.index`, mode `view`) — a grid of SVG logos (6 columns) fetched
from `https://api.svgl.app`, grouped by category with counts. The search bar's dropdown filters
by All / Pinned / Recently Used / category. Tiles render the light logo (dark variant when the
theme appearance is dark, via the SDK's `uriDark` icon field).

Search filters titles (every token must match); filtering is extension-owned, like all FlowKey
grids.

## Actions (titled ActionPanel.Sections, default action leads)

- **Copy SVG** — Copy SVG Text (`↵`; split Copy Light/Dark on `Ctrl+L`/`Ctrl+D` for two-variant
  logos). Fetched SVGs get their ids/`url(#…)` references prefixed with the filename, exactly
  like the original, so mixed documents cannot collide.
- **Copy SVG File** (`Ctrl+↵`) — fetches, writes to `<dataRoot>/extension-temp/<Logo>.svg`
  (backend `files.writeTemp` route) and puts a file drop list on the clipboard.
- **Copy SVG Wordmark** — text (and URL) actions when the logo has a wordmark; hidden behind
  the `showWordmark` preference.
- **Copy shadcn/ui Registry** — `pnpm dlx shadcn@latest add @svgl/<slug>` with the runner from
  the `defaultPackageManager` preference (falls back to pnpm, as the original's lookup does).
- **Copy React Component** — svgr endpoint (`Ctrl+T` / `Ctrl+J`, light/dark variants on
  `Ctrl+Shift+…`); **Copy Vue / Svelte Component** — local TS/JS templates;
  **Copy Angular / Astro Component** — the original's templates.
- **Copy SVG URL / Wordmark URL** — copies the route without fetching.
- **Operation** — Pin/Unpin SVG (`Ctrl+P`), Move up/Down in Pinned (`Ctrl+↑`/`Ctrl+↓`).
- **SVG Info** — Copy SVG Title, Open SVG in Browser (`Ctrl+O`), Visit <Logo> Website
  (`Ctrl+V`), Visit Brand Website (`Ctrl+B`, when the API provides one), Visit This Category
  in Svgl.

Copies record the logo in Recently Used (most recent first, 12 shown, pinned excluded).

## Secondary commands

- **Setup shadcn/ui Registry** (`ext.svgl.setup-shadcn-registry`) — copies the svgl registry
  JSON and links the shadcn/ui registry docs.
- **Request SVG Logo** (`ext.svgl.request`) — form that opens a pre-filled issue on the svgl
  repository.

## Preferences

- `svgDefaultAction` (dropdown, default `copySvg`) — leads the action panel and runs on `↵`.
- `showWordmark` (checkbox, default on).
- `defaultPackageManager` (dropdown, optional) — pnpm/npm/yarn/bun.

## Consent surface

`nativeMethods`: `http.fetch`, `clipboard.write`, `hud.show`, `toast.show`, `shell.openUrl`,
`files.writeTemp`, `cache.get`, `cache.set`, `storage.get`, `storage.set`.
`httpHosts`: `svgl.app`, `api.svgl.app`. Library/lists cache 5 minutes, SVG documents and
components 1 week (per-extension cache capability).

## Distribution

Not preinstalled. Published through the Store (`store.import` → `store.install` with source
`uploaded`), which copies the package into the live extensions root.

## Known gaps (vs the Raycast original)

- The package-manager first-run setup view is replaced by the pnpm fallback.
- The category dropdown does not persist the last selection across sessions.
- See `docs/gaps.md` §8.
