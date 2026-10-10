# Raycast Clipboard History — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
This document is the source of truth for the clone. Every "confirmed" item below was read out of the
shipped artifacts; nothing here is inferred from Raycast's public documentation.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/shell/native.dll` (Rust) | Clipboard listener, concealment formats, retry/debounce, captured formats, paste flow |
| `artifacts/shell/Raycast.dll` (.NET) | IPC surface (`IPCTypesClipboard*`), org policy fields, `ApplyClipboardSettingsAsync` |
| `artifacts/backend/index.mjs` (obfuscated Node) | Store semantics, dedupe/merge, titles, categories, retention, maintenance, task schedule |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` | Extension + command registration, preferences and defaults |
| `artifacts/frontend/clipboard-*.js` | MIME/representation helpers, settings and filters UI |
| `artifacts/frontend/main-window-g1Vb1JLY.js` | List sections, filters, action panel, detail previews |

REA MCP output was unusable in this environment (schema mismatch); the managed-PE inspector and
custom UTF-16/ASCII string extractors over the same binaries produced the findings above. No native
disassembly engine (Hopper/Ghidra/IDA) is installed, so control flow inside `native.dll` is known
from its log strings and IPC contract rather than from decompiled code.

---

## Confirmed behavior

### Capture (event-driven, no polling)

- A hidden listener window registers with `AddClipboardFormatListener`; changes arrive as
  `nativeevents.on_clipboard_changed`. Raycast's Rust type is `RaycastClipboardListener`, backed by a
  helper window.
- Formats captured: `text/plain`, `text/html`, `text/rtf`, `text/uri-list`, `image/png`,
  `image/jpeg`, plus a custom `application/raycast-clipboard-metadata` channel.
- Concealment via Win32 clipboard formats:
  - `ExcludeClipboardContentFromMonitorProcessing` — entry is dropped before monitoring sees it.
  - `CanIncludeInClipboardHistory` — `0` drops the entry, `1` explicitly includes it. A read failure
    is logged and the default policy applies.
- Ignore rules exist for executables and class/image names
  (`IsIgnoredExecutable`, `IgnoredExecutablePatterns`, `IgnoredClassNames`, `IgnoredImageNames`,
  `bIgnoreDuplicate`). A per-application "Disabled Applications" preference is the user-facing form of
  this and is honored on the ingest path.
- Backpressure: while another process holds the clipboard open, capture is retried on a delay and
  given up on after a bounded number of attempts. Some source processes require a longer debounce
  (`firefox.exe`, `zen.exe` and similar). The listener holds the clipboard open itself while reading.
- Entries are skipped when: a file pointer targets a TEMP path, a format carries non-file-list
  content, no native items were produced, no representations survived validation, or merged file paths
  had no matching captured format.
- BMP clipboard images are converted to PNG, and the conversion result is validated before use.

### Persistence

- `contentHash` is an MD5 over the normalized item list. For file-backed representations the file is
  streamed into the hash; very large files are hashed by sampling the first 40 MB plus the last 10 MB.
- Text representations at or above 30 KB are written to a cache directory under an MD5-based name with
  a mime-derived extension, and the stored representation becomes a file reference rather than inline
  content. Images are likewise written to the cache directory.
- Re-copying an existing entry merges into it: representations are unioned, categories are unioned,
  `copyCount` increments, `updatedAt` is bumped, `createdAt` is preserved. If nothing changed the
  entry is left untouched — including `copyCount`. In other words `copyCount` counts *merges*, not
  *copies*: an identical re-copy from the same source is a deliberate no-op, and the counter only
  moves when the copy actually contributes a representation, a category, a source change or tags.
- Title rules, in order:
  1. file-backed item → basename of the path;
  2. image item → `Image (<width>x<height>)`, or `Image (<locale date string>)` when dimensions are
     unknown;
  3. text item → the first lines of the text, whitespace-trimmed, joined and capped at ~100
     characters;
  4. nothing usable → `Untitled`.
- Categories derived per entry: `file` (plus `image` for image files), `image`, `link` (plus `email`
  when the URL is a mailto/email-shaped value), `color` for color strings, otherwise `text`.
- Stale observations are dropped using per-host sequence numbers carried in `observationId`
  (`<host>:<seq>`).
- Delete APIs: by id, all, all before a date, all after a date. Bulk deletes take `includePinned`.
- Pin/unpin, move-pinned-up and move-pinned-down are store-level operations.
- Retention: `historyDuration` accepts `5m`, `60m`, `P1D`, `P1W` (default), `P1M`, `P3M`, `P6M`,
  `P1Y`, `unlimited`. Organization policy overrides the user value. Pruning runs every 12 hours and
  on auth change.
- Cache maintenance runs daily: entries whose source files vanished are removed or trimmed, orphaned
  cache files are deleted, foreign files are left alone.
- OCR runs in the background with a 500 ms debounce and stores its result as an
  `application/vnd.raycast.ocr` text representation; a stale OCR write is discarded rather than
  clobbering a concurrent change.

### Command surface

- Internal extension key `clipboard-history`, commands `history` (view command),
  `pasteSequential`, `resetPasteSequence`, and an AI command `@clipboard`.
- Extension preferences and defaults: `historyDuration: "P1W"`, `textRecognitionEnabled: true`,
  `ocrLevel: undefined`, `disabledApplications` (macOS defaults; empty on Windows).
- Command preferences: `primaryAction` (`paste` | `copy`, default `paste`),
  `preferPastingAsPlainText` (false), `showLinkVisualInformation` (true),
  `updateHistoryAfterAction` (true).
- List sections, in order: `Pinned`, `Recent`, `Today`, `Yesterday`, `This Week`, `This Month`,
  `This Year`, `Older`. `Recent` is the last 24 hours; everything older falls through to `Older`.
- Filters: a free-text filter over entries, a type filter (`all`, `text`, `image`, `file`, `link`,
  `email`, `color`), and a tag filter. Filtering is applied server-side through the store.
- Live refresh: the view subscribes to clipboard state changes and re-fetches, preserving the current
  selection and scroll position.
- Detail previews per category: text (bounded line count plus character and word counts), link
  (favicon and title), email, color (swatch), image (dimensions and size), file (path and size),
  multi-item (count and per-source metadata).
- Row icons: file list count for multi-item entries, image thumbnail, file glyph, favicon for links,
  color chip, `@` glyph for email.
- Actions: `Paste`, `Paste and Keep Window Open`, `Paste as Plain Text`, `Paste as…` (submenu of
  representations), `Copy to Clipboard`, `Copy Color as…`, `Open in Default Application`, `Share…`,
  `Edit`, `Rename Entry…`, `Copy Formatted JSON`, AI attach/send, `Annotate`, `Show in File Explorer`,
  `Pin Entry`, `Unpin Entry`, `Move Up in Pinned`, `Move Down in Pinned`, `Save as Snippet`,
  `Save as Quicklink`, `Save as File`, `Copy Text from Image`, `Copy Text from QR Code`,
  `Delete Entry`, `Delete Recent Entries…` (submenu), `Delete All Entries`.
- Pasting requires accessibility permission; the action raises an explicit permission alert when the
  grant is missing.
- `Paste Sequentially` keeps an offset into the newest entries, resets after the configured timeout,
  optionally appends a newline, and hides the main window when it runs out of items.

---

## Unconfirmed

These could not be established from the shipped artifacts. Raycast's values are private to its
backend database; the clone picks the documented default in "Our decisions".

- **List page size.** Raycast paginates the clipboard list with a cursor, but the page size constant
  was not recoverable from the artifacts (the frontend passes `pageSize` through an internal list
  model that is built elsewhere).
- **Database path and schema.** The store is a local SQLite database reached over the host IPC; no
  SQL, table names, or file path were recoverable. No `CREATE TABLE`, `content_hash`, `copy_count`,
  `updated_at`, or `clipboard_entries` string exists in `Raycast.dll`, `native.dll`, or the
  obfuscated backend outside a debug-seed fixture.
- **Tag colors.** Raycast derives a deterministic color per tag from the tag string; the exact
  palette and hash were not recoverable from the shipped chunks.
- Exact string constants for the SQL DDL, the internal database file name, and the list page size.
- Whether the accessibility permission alert reuses a shared UI component.

---

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| List page size | Load all entries for the active filter, no pagination | The clone is local-only with a bounded history; Raycast paginates for a much larger store. Revisit when retention lands. |
| Database path | `%LOCALAPPDATA%\RaycastMini\clipboard-history.sqlite` | Matches the existing `%LOCALAPPDATA%\RaycastMini\` convention already used for `launcher.log`, `backend.log`, and the WebView2 profile. |
| Schema | `clipboard_entries` (id, title, categories JSON, tags JSON, items JSON, source JSON, content_hash, copy_count, created_at, updated_at, pinned_order, pinned_at) plus `clipboard_tags` and `clipboard_filters` | Mirrors the field set the store API exposes. `content_hash` is indexed because every capture looks up by it. |
| Hash algorithm | MD5, matching Raycast's `createHash("md5")` | Keeps dedupe behavior identical; not a security boundary. |
| Large-text spill threshold | 30 KB (30 * 1024) | Raycast's `jco` constant. |
| Large-file hash sampling | First 40 MB plus last 10 MB | Raycast's `vct` / `bIe` constants. |
| OCR debounce | 500 ms | Raycast's `Qco`. |
| Image capture | PNG and JPEG written to the cache directory; BMP converted to PNG | Raycast's captured format list; BMP conversion is required because Windows hands out DIB data. |
| Retention options | All of `5m`, `60m`, `P1D`, `P1W`, `P1M`, `P3M`, `P6M`, `P1Y`, `unlimited` available to everyone | Pro gating is out of scope for this clone. |
| Tag colors | Deterministic HSL from an MD5 of the tag string, one of six hues | Raycast's `kt(lm, tag)` derives a color from the tag text; the exact palette is unknown, so this reproduces the property (stable per-tag color, readable in dark mode) rather than the literal values. |
| Paste focus restore | Record the foreground window when the launcher loses activation, restore it before sending the paste keystroke, then restore the previous clipboard contents | Raycast keeps `paste: no last foreground window available` as a distinct failure and backs up/restores the clipboard around the paste. |
| Retention | Not implemented in increment 1 | Explicitly deferred; listed as pending. |

---

## Implementation checklist

Status legend: `[x]` done, `[~]` partial, `[ ]` pending.

### Increment 1 — core (this increment)

- [x] Event-based listener window using `AddClipboardFormatListener`, no polling loop
- [x] Concealment formats honored: `ExcludeClipboardContentFromMonitorProcessing` drops,
      `CanIncludeInClipboardHistory` 0 drops / 1 includes
- [x] Retry-while-held with bounded attempts and delay, plus per-process debounce
- [x] Capture `text/plain`, `text/html`, `text/rtf`, `text/uri-list`, `image/png`, `image/jpeg`
      (BMP converted to PNG)
- [x] Local SQLite store with `contentHash` dedupe and merge-on-recopy
      (union of representations, `copyCount++`, `updatedAt` bumped, `createdAt` preserved)
- [x] Large text (>= 30 KB) and images spilled to a cache directory under MD5 names, never held in
      memory by the store
- [x] Title rules (basename → `Image (WxH)` / `Image (date)` → ~100 chars of text → `Untitled`)
- [x] Category detection: text, link, email, color, image, file
- [x] Command registered like the other commands, visible in root search
- [x] List sections: Pinned, Recent, Today, Yesterday, This Week, This Month, This Year, Older
- [x] Free-text filter and type filter
- [x] Detail preview pane per category (text, image, file, multi-item; link/email/color fall through to the text layout)
- [x] Actions: Paste, Paste as Plain Text, Copy, Pin, Unpin, Delete Entry, Delete All Entries
- [x] Ctrl+K action panel
- [x] Paste restores focus to the previously active app and reports a clear error on failure
- [x] Live refresh on new clipboard entries while the command is open

### Later increments (pending)

- [x] Tags on entries (add/remove), a tag filter in the navigation bar, and deterministic per-tag
      colours derived from the tag text
- [x] Retention with all nine options, pruned every 12 h and on startup, never touching pinned entries
- [x] Daily cache maintenance that drops entries whose source files vanished and removes only the
      orphaned files it created
- [x] Cursor pagination instead of loading the whole set, so Unlimited retention stays usable
- [x] Ignored applications (exact executable names and `*` patterns) plus the duplicate-drop gate
- [x] Stale-observation handling via the `<host>:<seq>` observation id
- [x] Multi-item entries: the listener emits one item per copied file, so a multi-file copy becomes a
      multi-item entry with a count badge and a per-file preview
- [x] Move Up / Move Down in Pinned
- [x] Paste and Keep Window Open
- [ ] Per-app filters view (the `clipboard_filters` UI: enable/disable and assign tags per app)
- [ ] Paste Sequentially + Reset Paste Sequence commands
- [ ] OCR (`performOcr`, `application/vnd.raycast.ocr`, 500 ms debounce, accurate/fast level)
- [ ] QR code decode action
- [ ] Save as Snippet / Save as Quicklink / Save as File
- [ ] Auto-tagging filters (`clipboard_filters`, applied on ingest)
- [ ] `Paste as…` submenu over representations
- [ ] Edit / Rename Entry / Copy Formatted JSON

### Out of scope

- [ ] Pro gating (retention options are always available instead)
- [ ] Organization policy (`organization_clipboard_history_retention_days`,
      `organization_clipboard_history_disabled_applications`)
- [ ] Cloud sync
- [ ] AI command (`@clipboard`, AI attach/send)
- [ ] Quicklink save action
- [ ] Share services

---

## Manual test checklist

Run `build/scripts/build.ps1` then launch the app and press the global hotkey (`Ctrl+Alt+Space`).

1. **Capture, text** — copy a short string in Notepad. Open Clipboard History: the entry appears under
   `Today` (or `Recent`), title is the text itself, and the detail pane shows the text with character
   and word counts.
2. **Capture, HTML/RTF** — copy rich text from a browser page. The row is the plain-text title; the
   entry keeps the `text/html` representation so Paste restores formatting.
3. **Capture, image** — copy an image (Win+Shift+S). The row shows a thumbnail; the detail pane shows
   dimensions and size. The bytes live in the cache directory, not inline in the database.
4. **Capture, file list** — copy several files in Explorer. The row shows the file count and the
   detail pane lists each source path.
5. **Dedupe (identical re-copy is a no-op)** — copy the same text twice from the same app. There is
   still exactly one entry, and nothing about it changes: `copyCount` stays at `1`, the detail pane
   keeps reading `Copied <time>` rather than `Times copied`, and `updatedAt` does not move. This is
   Raycast's behaviour — `oG` returns `didMutate: false` when representations, categories, source and
   tags are all unchanged, so an identical re-copy must not inflate the counter.
6. **Merge (this is what increments `copyCount`)** — copy text A, then copy *the same text plus an
   extra format* so the merge has something to add. Run `build\scripts\set-clipboard-conceal.ps1`
   variants or a rich-text editor: copy the text plainly first, then copy the identical text again
   with `text/html` attached. Expect exactly one entry, `Times copied 2` in the detail pane,
   `updatedAt` moved, `createdAt` unchanged, and both `text/plain` and `text/html` representations on
   the row.
7. **Large payload** — copy > 30 KB of text (e.g. `powershell -c '1..5000 | % { "line $_" }' | Set-Clipboard`).
   The row still renders, the title is truncated to ~100 characters, and the file is written under
   `%LOCALAPPDATA%\RaycastMini\clipboard-cache\` with an MD5 name.
8. **Sections** — entries from today, yesterday, this week and older are grouped correctly. Pinned
   entries sit in their own `Pinned` section, above everything else.
9. **Text filter** — type into the search field; entries narrow down and clear with Escape.
10. **Type filter** — open the type filter and choose `Images Only` / `Text Only` / `Links Only`;
    only matching rows remain.
11. **Preview per type** — select a text, link, email, color, image and file entry in turn; each shows
    its own detail layout.
12. **Pin / Unpin** — Ctrl+K → `Pin Entry`. The row moves to `Pinned` and the action becomes
    `Unpin Entry`.
13. **Delete Entry** — Ctrl+K → `Delete Entry`. The row disappears and a `Deleted entry` toast shows.
14. **Delete All Entries** — Ctrl+K → `Delete All Entries`, confirm. The list empties.
15. **Copy** — Ctrl+K → `Copy to Clipboard`. The launcher hides and the entry's original formats land
    on the clipboard; paste into Notepad and confirm rich content survives.
16. **Paste with focus restore** — put Notepad in front, focus a text field, open Clipboard History,
    Enter on an entry. Focus returns to Notepad and the content is pasted into the field.
17. **Paste failure is clear** — close every app window you could paste into, then Paste. A failure
    toast/error names the cause rather than failing silently.
18. **Paste as Plain Text** — with rich content selected, Ctrl+K → `Paste as Plain Text`; the target
    receives unformatted text.
19. **Clipboard survives** — after a Paste, press Ctrl+V in Notepad: the clipboard still holds the
    entry you pasted (Raycast backs up and restores the previous contents).
20. **Concealment** — run the four probes below. The launcher log names the flag and the
    outcome, so each decision is verifiable without inspecting the list.

    ```
    build\scripts\set-clipboard-conceal.ps1 -Mode exclude       -> "…ExcludeClipboardContentFromMonitorProcessing set"  and NO new entry
    build\scripts\set-clipboard-conceal.ps1 -Mode can-include-0 -> "…CanIncludeInClipboardHistory = 0"                     and NO new entry
    build\scripts\set-clipboard-conceal.ps1 -Mode can-include-1 -> "…CanIncludeInClipboardHistory = 1"                     and the entry IS recorded
    build\scripts\set-clipboard-conceal.ps1 -Mode none          -> plain copy, recorded (control)
    ```

    Add `-Html` to attach `text/html` and `-ExtraRtfBytes 1` for `text/rtf`. The script writes both concealment
    formats itself, so no other tool is required.
21. **Retry-while-held** — copy from an app that briefly locks the clipboard; the entry still appears,
    and `launcher.log` shows the retry lines rather than a dropped capture.
22. **Live refresh** — leave the command open and copy something new; the list updates without
    reopening the command.
23. **No polling** — with the app idle, `launcher.log` shows no repeating clipboard reads.

---

## Increment 2 — manual test checklist

Settings live in **Settings → Clipboard History**. The store is at
`%LOCALAPPDATA%\RaycastMini\clipboard-history.sqlite`, cached payloads under
`%LOCALAPPDATA%\RaycastMini\clipboard-cache\`, and clipboard preferences in
`clipboard-settings.json` beside the database. Delete both to start from a clean slate.

### Retention

1. **All nine options present** — the `Keep history for` dropdown lists 5 Minutes, 1 Hour, 1 Day,
   1 Week, 1 Month, 3 Months, 6 Months, 1 Year, Unlimited. Nothing is locked or marked Pro.
2. **Default is one week** — on a fresh profile the dropdown reads 1 Week.
3. **Prune on startup** — set `Keep history for` to 5 Minutes, quit the launcher, wait a few minutes,
   relaunch. Entries older than five minutes are gone and the backend log shows
   `pruned N entries older than 5m`.
4. **Pinned entries survive pruning** — pin an entry, set retention to 5 Minutes, restart. The pinned
   row is still there and still in the `Pinned` section.
5. **Unlimited keeps everything** — set Unlimited, restart, confirm nothing is pruned.
6. **Retention change prunes immediately** — with old entries present, switching to 1 Month deletes the
   entries older than a month without a restart.
7. **12-hour cadence** — leave the launcher running and watch for a second prune in
   `%LOCALAPPDATA%\RaycastMini\backend.log` roughly every 12 h.

### Cache maintenance

8. **Vanished source file drops the entry** — copy a file, delete the file, then Settings → Clipboard
   History → `Run Maintenance Now`. The entry is gone and the toast reports it.
9. **Partial entries are trimmed** — copy two files, delete one, run maintenance. The entry survives
   with only the surviving file.
10. **Orphaned cache files are removed** — drop a stray file named `raycast-<32 hex>.<ext>` into
    `clipboard-cache`, run maintenance. It is deleted.
11. **Foreign files are preserved** — drop a file named `notes.txt` (no `raycast-` prefix) into the
    cache dir, run maintenance. It is still there and the report counts it as skipped.
12. **Daily cadence** — maintenance also runs once at every startup and every 24 h while running; both
    log `finished cache maintenance` with their counters.

### Pagination

13. **Pages append** — create more than 50 entries, open Clipboard History. The first 50 render and
    scrolling near the bottom appends the next page with no duplicate rows.
14. **Cursor survives a filter** — apply a text filter with more than 50 matches; paging still works and
    no row appears twice.
15. **Unlimited stays responsive** — with thousands of entries and retention set to Unlimited, opening
    the command does not hang and does not read every row.

### Ignored applications

16. **Exact name is ignored** — add `KeePassXC.exe` to Disabled Applications. Copying from KeePassXC
    creates no entry; copying from Notepad still does.
17. **Glob pattern is ignored** — add `chrome*.exe`. Copies from `chrome.exe` and `chrome-beta.exe`
    are both dropped.
18. **Ignores survive a restart** — quit and relaunch; the list is still in effect.
19. **Duplicate drop gate** — turn on `Ignore Duplicates`, then re-copy something already in the
    history. The entry does not change and `copyCount` does not move. Turn the gate off and re-copy:
    normal merge behaviour returns.

### Tags

20. **Add and remove tags** — Ctrl+K → `Edit Tags…`, type `work, urgent`, Save. The row shows both
    tags; the detail pane lists them.
21. **Tags are deduplicated and sorted** — enter `work, work, urgent`; the entry ends up with exactly
    two tags.
22. **Tag colours are stable** — the same tag text always gets the same colour across entries and
    across restarts.
23. **Tag filter** — the tag button in the navigation bar lists every tag in use; picking one narrows
    the list to entries carrying it, and `All Tags` clears it.
24. **Tag filter combines with the type filter** — apply both and confirm only rows satisfying both
    remain.

### Pinned ordering

25. **Move Up / Move Down** — pin three entries, select the second one, Ctrl+K → `Move Down in Pinned`.
    It swaps with the third. The actions are offered only for pinned rows.
26. **Boundary is a no-op** — `Move Up in Pinned` on the first pinned row leaves the order unchanged.
27. **Order survives a restart** — relaunch and confirm the pinned order is intact.

### Paste and Keep Open

28. **Keeps the launcher up** — Alt+Enter (or Ctrl+K → `Paste and Keep Window Open`). The paste is
    delivered and the window stays open with the selection intact.
29. **Plain Paste still hides** — Enter on a row closes the launcher as before.

### Multi-item entries

30. **Multiple files become one entry** — select three files in Explorer and copy. A single row appears
    with a count badge, its title lists the three basenames, and the detail pane shows three paths.
31. **Row icon is the count** — the multi-file row shows a number badge rather than a file glyph.

### Stale observations

32. **Out-of-order capture is dropped** — this is only reachable through the host, so verify the
    backend log rather than the UI: two captures in quick succession must not produce an entry whose
    content is the older one.

### Settings regression

33. **Other settings pages still work** — General, Launcher, Keyboard and the rest are unchanged; the new
    Clipboard History page appears in the sidebar in Raycast's position and is searchable.
34. **Maintenance reports back** — `Run Maintenance Now` raises a toast with the prune/drop/file counts.
