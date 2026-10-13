# File Search — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~41592 (identical copy in backend @~1208800) | Extension block, commands, AI-extension names |
| `artifacts/frontend/file-search-preferences-CaWvd-f1.js` + registration | Preference keys, types, defaults, Windows platform defaults |
| `artifacts/frontend/file-search-settings-page-definition-BuzB-1ay.js` | Settings rows with exact labels/descriptions |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~671000 (`FileSearchView`), content-search constants `nz=3`/`rz=200` | Search view, type/sort filters, action panel, details pane, banners |
| `artifacts/backend/indexer-worker.mjs` (read fully) + backend facade exports @~1929700 | Native indexer client surface (`IndexerClient`, search/state notifications) |
| `artifacts/shell/native.dll` (strings) | Monitor/display work-area records (used by the indexer's volume logic); no index/search primitives are native |

## Confirmed behavior

### Extension and commands

- Internal extension key `file-search`, title `File Search`, description `Search for files and
  folders on your computer.`
- `searchFiles` — `Search Files`, view-command, `fallbackStatus:"available"`,
  `suggestionPriority:70`, navigates to `/extension/file-search/search`.
- `quickOpen` — `` `Open in Finder` `` / windows `` `Open in File Explorer` ``, ephemeral,
  `rootSearch:{when:'searching', matching:'file-path'}` — a fallback that opens the typed path in
  File Explorer. Has `resetRanking` in its configure actions.
- `indexing` — `` `File Search is indexing…` ``, ephemeral, `omitFromFrecencyTracking`,
  `rootSearch:{section:'files', pinned:1, when:'always', matching:'always'}`; subtitle
  `Indexing ${fileCount} files` (or `Indexing ${fileCount} files (${entriesPerSecond} entries/s)`);
  actions `Open File Search` and `Stop Indexing`.
- Dynamic `result` rows (root-search file hits): title = filename, subtitle = parent directory,
  section `files`, always matching (the backend ranks them).

### Preferences

- `showInRootSearch: true` (synced), `contentSearch: false` (synced),
  `contentSearchInRootSearch: false` (synced), `includeHiddenFiles: false` (synced),
  `respectIgnoreFiles: true` (synced), `useNtfsScanner: false`, `keepRemovedVolumeFiles: true`,
  `ignore: []` (local), `include: []` (local), content-engine `native` (local).
- Excluded-automatically Windows defaults: `*.tmp`, `*.temp`, `node_modules`, `**/tmp/**`,
  `**/temp/**`, `**/[Cc]ache/**`, `**/[Cc]aches/**`, `**/AppData/**`.
- There is **no max-results preference**. Content search (Pro, off by default) requires query length
  ≥ 3 (`nz=3`) with a 200 ms debounce (`rz=200`).

### Search Files view

- Search box placeholder `Search files…`. Type filter dropdown (`Filter by Type`): `All Types`,
  `Directory`, `File`, `Archive`, `Document`, `Image`, `Video`, `Audio`, `Text`, `Other` (content
  type bitflags: archive 8, document 16, image 32, video 64, audio 128, text 1024, other 1).
- Sort dropdown (when a query is set): `Date Modified`, `Date Created`, `Name`.
- No query syntax (`folder:`/`ext:` tokens do not exist). Empty query shows a `Recently Used`
  section.
- Row: icon, filename (a parent-directory prefix is rendered when duplicate names exist), location
  subtitle when the details pane is open, a volume-unavailable indicator for disconnected volumes.
- Details pane, header `Metadata`, rows exactly: `Name`, `Where`, `Type` (value `Folder` or
  mime-derived), `Size`, `Created`, `Modified`, `Accessed`.
- Action panel (ids/titles exact): `Open`, `Show in File Explorer` (keywords `[reveal in explorer]`),
  `Open in Terminal` (folders), `Open With…`, `Show Properties`, `Toggle Hidden Files`, `Toggle Info
  Panel`, `Copy File`, `Paste File`, `Copy Name`, `Copy Path` (copies the quoted path), `Navigate
  Up`/`Navigate Down`, `Save as Quicklink`, `Duplicate`, `Rename…`, `Copy to…`, `Move to…`, `Delete`
  (id `moveToTrash`, destructive, keywords `[delete, remove, recycle]`, confirm `Are you sure you
  want to delete ${filename}?`, success `Deleted file`, backend `fileSystem.moveToTrash`), `Index
  Files` (reindex), `Stop Indexing`, `Exclude From Index`.
- Fetch failure toast `Failed to fetch files`.
- Settings toggles elsewhere: `Include Files in Root Search` (`showInRootSearch`) and `Include File
  Content search results in Root Search` (`contentSearchInRootSearch`) on the Launcher settings page.

### Indexer

- Raycast's indexer is a native napi module (`indexer.win32-x64-msvc.node`) behind a worker thread
  with a healthcheck loop, state notifications (`indexStateChanged`, `indexUpdated`), startup vs
  incremental indexing params, exclude patterns, and recent-files snapshots. Status toasts:
  `Indexing Files…` (with progress), `Indexing Files Complete` (files + duration), `Indexing
  Stopped`, `Indexing Failed`, `Low Disk Space`.
- Settings page also exposes index stats: `Disk Usage`, `Total Entries`, `Files`, `Directories`,
  `Symlinks`, `Invalid Entries`, `Last Duration`.

### Settings page rows (exact)

`Search Scopes` (`Pick additional directories to be included when searching for files`), `Ignore
Patterns` (`File Search respects .gitignore, .ignore, Git exclude files, and .rayignore by default.
Add comma-separated filenames or directories here to ignore them globally in Raycast.`, input
placeholder `Add pattern…`), `Excluded Automatically` (churn hotspots with `Restore`), `Content
Search` (`Also search the text inside files, not just their names.` — Pro, Windows-Search-backed,
with availability warning and `Open Search Settings` → `ms-settings:cortana-windowssearch`), `Include
Hidden Files`, `Use ignore files` (`respectIgnoreFiles`), `Keep Files from Removed Volumes`,
`Use NTFS Scanner` (experimental, UAC), `Reset to Defaults` (confirm `Reset File Search Settings?`,
resets scopes to the home dir and ignore patterns to the Windows defaults, then reindexes; toasts
`File Search settings reset to defaults`).

## Unconfirmed

- **`indexer.win32-x64-msvc.node` internals** — index format, watcher debounces, walk pace values;
  the module is not among the recovered artifacts.
- **`SearchSorting`/`SearchKind`/`WalkPace` native enum values** — the frontend only shows
  `modifiedDate/createdDate/name` and `default/background/expedited`.
- **First-run default scope.** The `include` preference defaults to `[]`, while `Reset to Defaults`
  resets scopes to the home directory (`include(homeDir,'windows')`); whether a fresh install starts
  with the home dir indexed is not derivable from the artifacts.
- **How scanned games/app entries get their content-type bit set** (native side) — not visible.
- **Whether hidden-file detection uses the Windows hidden attribute or dot-prefix heuristics** — the
  native scanner decides; the frontend only passes the flag.

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Indexer | Rewrite `build/backend/src/file-indexer.js` as an async incremental indexer on the existing `file-index.sqlite` (columns: path, name, extension, folder, parent_folder, size, modified_time, created_time, content_type, hidden); indexing runs in chunks with `await` yields so the pipe loop never blocks; `fs.watch {recursive:true}` per root with a 500 ms debounce feeding incremental upserts/deletes | The clone has no native indexer; Node async I/O reproduces the observable behavior (incremental watch, status counts). |
| Default scope | User profile folder (`%USERPROFILE%`) on first run, matching the confirmed Reset-to-Defaults target | First-run default is unconfirmed; Reset-to-Defaults is confirmed evidence for the intended default. |
| Hidden files | `includeHiddenFiles` gates files whose name starts with `.` (dot-prefix heuristic); the Windows hidden attribute is not detected (Node does not expose it) | Attribute detection is unconfirmed in Raycast and unavailable in Node; documented delta. |
| Content type classification | By extension table → `archive|document|image|video|audio|text|other`, directories separate | Mirrors the confirmed bitflag categories without native metadata. |
| Ranking | Name-prefix match > name-substring > path match, then usage count, then modified time desc; type filter applied in SQL | Reproduces Raycast's front-loaded name ranking with the tools available. |
| Recently Used | Empty query lists all indexed files sorted by modified time (no `Recently Used` section) | The shell recent-items API (`.lnk` parsing) is out of scope for increment 1; documented delta. |
| Content Search | Pending — row not shown | Windows Search integration is Pro-gated in Raycast and has no local equivalent yet. |
| NTFS Scanner / churn hotspots / volume tracking | Not implemented (rows omitted) | Native-only features with no clone equivalent. |
| Actions implemented | Open, Show in File Explorer (`explorer /select`), Copy Name, Copy Path, Delete (recycle via `SHFileOperationW FOF_ALLOWUNDO`), Save as Quicklink, Index Files (force reindex), Stop Indexing, Exclude From Index, Open With… | The confirmed action set minus OS features the clone lacks (Quick Look, Terminal, Rename, Duplicate, Copy/Move dialogs pending). |
| Save as Quicklink | Creates a quicklink with `file:///` link and the filename as name via the Quicklinks store | Confirmed cross-extension action. |
| Root search | `files` section populated when `showInRootSearch`; `Open in File Explorer` fallback when the query looks like a path (`/^[a-zA-Z]:[\\\/]/` or starts with `~` or contains `\`/`/`); pinned `File Search is indexing…` row while indexing with live counts | Confirmed wiring. |
| Settings rows implemented | Search Scopes, Ignore Patterns, Include Hidden Files, Reset to Defaults (+ per-command hotkeys/aliases) | The remaining confirmed rows depend on unimplemented native features. |
| respectIgnoreFiles | Row present; functional only as a passthrough (`.gitignore` parsing pending) | Parsing `.gitignore` semantics is a later increment; listed as pending, not mocked. |

## Implementation checklist

- [x] Backend: rewrite `file-indexer.js` — async chunked indexing, incremental watcher, content-type
      classification, SQL search with type filter + ranking, index-state events
      (`fileSearch.indexState` push), stop/exclude handlers
- [x] Backend: config persistence (JSON settings file like Clipboard History's), Windows default
      ignore patterns, scope validation
- [x] Host routes: `fileSystem.moveToTrash` (SHFileOperationW recycle), reveal via the existing
      `shell.revealFile` (`explorer /select`), plus new `fileSystem.openFile` and
      `fileSystem.showSelectFolderDialog`
- [x] Frontend: Search Files view (`Search files…`, type filter, sort, details pane `Metadata` rows,
      action panel, delete confirm, empty state)
- [x] Frontend: root `files` section + `Open in File Explorer` fallback + indexing pinned row
- [x] Frontend: Settings page rows (Search Scopes picker, Ignore Patterns, Include Hidden Files,
      Reset to Defaults) + extension toggle; the Launcher page's `Include Files in Root Search`
      row is live (`showInRootSearch`)
- [x] Replace `fileSearch.ts` localStorage config with the backend store
- [x] Tests: `build/backend/tests/file-search.test.mjs` (15 tests) — real temp tree: content types,
      Windows default excludes, ignore patterns (segments, globs, absolute paths), hidden files,
      ranking tiers + usage tiebreak, type filter, watcher adds/deletes, settings round-trip +
      reset + first-run scope, excludeFromIndex, metadata, backend wiring; plus
      `build/frontend/tests/matching.test.mjs` for the root-search matcher

## Implementation status (2026-10-11)

Implemented per the decisions table above. Deltas worth restating:

- **Recently Used**: empty query in the view lists every indexed row sorted by modified time (no
  `Recently Used` section header) — the decided stand-in for the shell recent-items API.
- **Sort dropdown**: offered once a query is set, options exactly `Date Modified / Date Created /
  Name`; the relevance ranking (name-prefix > name-substring > path, then usage, then modified)
  applies when no explicit sort is chosen (root search always uses relevance).
- **Duplicate names**: the parent-directory prefix renders as the row *subtitle* (always when
  duplicates exist or the info panel is open), not as a title prefix.
- **Delete confirm** uses the confirmed string; in the Settings window it is a native
  `window.confirm` (the settings window has no alert host).
- **Open With…** lists the discovered applications (up to 60) and launches the chosen one with the
  path as its argument via `shell.openWith`.
- **View actions not implemented** (native/OS or later increments): `Toggle Hidden Files` (hidden
  rows only exist when `includeHiddenFiles` was on at index time), volume-unavailable indicator,
  `Open in Terminal`, `Rename…`, `Duplicate`, `Copy to…`/`Move to…`, `Copy File`/`Paste File`,
  content search, NTFS scanner, churn hotspots.
- **Logs**: `backend.log` carries `[fileSearch] indexed N entries in Xms` and per-push counts only;
  no file paths or content are logged.

## Manual test checklist

1. **First run** — with default settings the user profile is indexed; the pinned row
   `File Search is indexing…` shows live counts and disappears when done (toast `Indexing Files
   Complete`).
2. **Search** — typing a filename prefix ranks prefix matches first; the details pane shows
   `Metadata` rows with correct `Where`/`Size`/dates.
3. **Type filter** — `Image` shows only images (png/jpg/...); `Directory` only folders.
4. **Ignore patterns** — files under `node_modules` never appear; adding a custom pattern excludes
   it after reindex.
5. **Watch** — create a file in a scoped folder while the app runs; it appears within a second
   without a full reindex; deleting it removes it.
6. **Actions** — Open launches the file; Show in File Explorer selects it; Copy Path puts the quoted
   path on the clipboard; Delete moves the file to the Recycle Bin (it is recoverable) with the
   confirmed confirm/toast strings.
7. **Save as Quicklink** — produces a quicklink whose Open launches the file.
8. **Fallback** — typing `C:\Windows\notepad.exe` in root search offers `Open in File Explorer`.
9. **Root section** — with `showInRootSearch` on, file rows appear in root search; toggling it off
   removes them.
10. **Logs** — `backend.log` shows index progress counts; no file content is logged.
