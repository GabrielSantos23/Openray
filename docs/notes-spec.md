# Raycast Notes — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~60306 (backend @~1226295) | Extension block, preferences, commands |
| `artifacts/frontend/notes-window-DJ58vPJx.js` + `notes-window.html` | Window shell, top bar, editor, find/replace bar, bottom bar, action panel, Browse Notes switcher, Recently Deleted |
| `notes-store-DN9OI5Y0.js` | Store, free-limit dialogs, error strings |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~768.9k (open/create handlers), @~989k–996k (Search Notes view) | Command behaviors, search view strings/actions |
| `artifacts/backend/index.mjs` @~3616k (handler surface `UO`), @~7190k (sync config: table `notes`, columns), @~2680k (deeplink mapping) | Store semantics, SQLite schema hints, trash purge 60 days |
| `notes-settings-page-definition-BPsraOHa.js` / `notes-settings-view-CDH95rjN.js` / `notes-zoom-*` | Settings rows |
| `artifacts/shell/Raycast.dll` (strings, via handler references `host.raycast.showNotesWindow|hideWindow|resizeWindow|resignKeyWindow`) | Window host surface |

## Confirmed behavior

### Extension and commands

- Extension key `notes`, title `Raycast Notes`, description `Create and manage your notes.`
  Preferences: `showMenuBarToggle` (default false, synced; macOS row), `escapeKeyBehavior` (default
  `closesWindow`, other value `losesFocus`), `zoom` (default 1, local; range 0.75–2.0 step 0.05).
- Commands: `open` (`Raycast Notes`, keywords `[notes]`), `search` (`Search Notes`, keywords
  `search-notes` handler), `create` (`Create Note`, keywords `[new note]`,
  `fallbackStatus:"available"`), AI extension `Ask Raycast Notes` (`@raycast-notes`).
- `open`/`create` close the main window and call `host.raycast.showNotesWindow({noteId?})` (note id
  from arguments or launchContext JSON `{id}`; bad JSON → toast `Failed to open Note` / `Invalid
  JSON data`); `create` takes text from `fallbackText`/launchContext `{text}`.
- **No notes section exists in root search** — notes are reachable only through the three commands;
  `Create Note` is fallback-command eligible.

### Data model and storage

- Note fields: `id`, `title` (derived — first line), `text`, `rawContent` (ProseMirror doc),
  `caretPosition`, `pinned` (numeric order), `createdAt`, `updatedAt`, `lastAccessedAt`,
  `deletedAt` (trashed).
- Storage is SQLite (`main` database) with a confirmed sync config: table `notes`, columns
  `title, text, raw_content, pinned, created_at, deleted_at`. Current-note pointer in
  `NotesCurrentNoteId`. Trash purge after 60 days (`purgeOldDeleted`).
- Backend handler surface: `create, update (expectedUpdatedAt → "ok"|"conflict"), delete, deleteAll,
  pin, unpin, movePinnedUp, movePinnedDown, list, browse, count, getWindowData(noteId),
  getCurrentWindowData, setCurrentNote, touchAccessed, listDeleted, recoverNote, permanentlyDelete,
  emptyTrash, purgeOldDeletedNotes`.
- Free tier limits 5 notes (upgrade dialog `You've hit the maximum of 5 notes` / `Unlock Unlimited
  Notes`) — Pro gating, out of scope for the clone.
- An onboarding note is auto-created once with text `Welcome to Raycast Notes` and markdown content
  (`# Welcome to Raycast Notes`, browsing/resizing/actions/formatting sections).

### Notes window

- Window title `Notes`; boot payload `{currentNote, previousNoteId, nextNoteId,
  pinnedShortcutNoteIds}`; URL query `noteId`.
- Top bar: live note title (first non-empty line, else `Untitled`) and three icon buttons — `Action
  Panel` (Ctrl K), `Browse Notes`, `Create Note`.
- Editor: ProseMirror/Tiptap with caret restore on note switch (300 ms debounce) and 300 ms debounced
  content flush (text + rawContent + title).
- Find/Replace bar: `Find` input, match counter `N/M`, prev/next, expandable `Replace` row
  (`replace-one`/`replace`), opened by `Find in Note` / Ctrl F, pre-seeded with the selection.
- Bottom bar: word/character counter (toggle persisted in `openray-notes-counter-mode`), `Show
  Format Buttons` toggle (persisted `openray-notes-format-bar-visible`), format bar (Heading/Format/
  Link/Code/Code Block/Blockquote/List popovers).
- Action panel (Ctrl K) items: `New Note`, `Duplicate Note`, `Pin Note`/`Unpin Note`, `Browse Notes`,
  `Go Back`, `Go Forward`; `Find in Note`; `Copy Note As…` (`Markdown` → `Copied as Markdown`,
  `HTML` → `Copied as HTML`, `Plain Text` → `Copied as Plain Text`); `Copy Deeplink` (`Copied
  Deeplink`); `Create Quicklink` (routes to the Quicklinks create form prefilled with the note
  deeplink + title); `Export…` (Markdown `.md` / HTML `.html` / Plain Text `.txt` via save dialog →
  toasts `Exported as Markdown/HTML/Plain Text`); `Move List Item Up/Down`, `Format…`; `Enable
  Window Auto-Sizing`/`Disable Window Auto-Sizing`, `Toggle Format Bar`; `Reset Zoom` (`Zoom reset
  to default`), `Zoom In`, `Zoom Out` (toasts `Zoomed to N%`); `Open Raycast Notes Settings`; `Show
  Recently Deleted Notes`, `Delete Note` (destructive).
- Browse Notes switcher: search `Search for notes…`; sections `Pinned` (when any) and `Notes`;
  row subtitle `Current • N characters` or `Opened <relative time> • N characters`; hover actions
  Pin/Unpin and Delete; toasts `Pinned Note`/`Unpinned Note`/`Note deleted` (failures `Could not
  pin note` etc.).
- Recently Deleted: search `Search for deleted notes…`; banner `Notes in Recently Deleted will be
  permanently removed after 60 days.`; rows `Deleted <date> • N characters`; `Restore note` (toast
  `Note Recovered`), `Permanently delete` (confirm `Permanently Delete Note?` / `This note will be
  permanently deleted. This action cannot be undone.` → `Permanently deleted note`); archived-view
  banner `You are viewing an archived note` with `Restore` (toast `Note Restored`).
- Window behavior: auto-sizing on by default (measures editor + find bar, clamps minHeight 128,
  maxHeight 860, min 442 while the action panel is open; manual resize disables auto-sizing);
  Escape per `escapeKeyBehavior` — `closesWindow` (hides the window) or `losesFocus`.
- **No always-on-top option and no dedicated global hotkey exist** in the shipped code (the menu-bar
  toggle row is macOS-gated). Users assign a hotkey to the `Raycast Notes` command through the
  normal mechanism.

### Markdown flavor (confirmed)

Marks: bold (`<strong>`), italic (`<em>`), strike (`<s>`), underline (`<u>`), code (`<code>`), link
(`<a href>`). Nodes: paragraph, heading 1–6 (`#`×level), blockquote (`> `), codeBlock (``` fence with
`language`), horizontalRule (`---`), bullet list (`- `), ordered list (`1. ` with start), task list
(`- [ ] `/`- [x] `), hardBreak. Copy out produces GitHub-style markdown and HTML; paste
auto-detects markdown and parses it.

### Search Notes view (in the launcher)

- Placeholder `Search notes…`; sections by recency: `Pinned`, `Today`, `Yesterday`, `This Week`,
  `This Month`, `Older`.
- Detail pane `Information` rows: `Title`, `Modified`, `Created`, with a live note preview and
  search-term highlighting.
- Actions: `Open Note`, `Pin Note`/`Unpin Note`, `Move Up`/`Move Down` (pinned only, toasts `Moved
  Note up/down`), `Copy Content` (`Copied Content`), `Copy Note As…`, `Copy Deeplink`, `Create
  Quicklink`, `Create Note`, `Duplicate Note` (title suffix ` (Copy)`, toast `Duplicated Note`),
  `Delete Note` (toast `Note moved to Recently Deleted`), `Delete All Notes` (confirm `Delete All
  Notes?` / `Warning: this operation cannot be undone.` → `Deleted All Notes`).
- Empty state: `No Results`/`No Notes Found` + `Create your first Raycast Note` + `Create Note`
  button.

## Unconfirmed

- **Pinned ordering values** — `pinned` is numeric and movePinnedUp/Down swap it, but the exact
  scheme (integers vs fractional) is not visible.
- **Whether the stubbed extension-API methods** (`readRaycastNote`, `searchRaycastNotes`,
  `updateRaycastNote`, `openRaycastNote` return stubs in this build) are completed server-side in
  production.
- **An always-on-top option or dedicated hotkey for Notes** — none found; absence is supported by
  exhaustive search but not provable.
- **Deeplink opening from outside the app** (protocol registration behavior for the notes deeplink).

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Storage | `%LOCALAPPDATA%\Openray\notes.sqlite`, table `notes` (id, title, text, pinned_order, created_at, updated_at, accessed_at, deleted_at) | Mirrors the confirmed SQLite schema (minus `raw_content` — see editor decision); trash purge after 60 days runs at startup. |
| Editor | Rich `contentEditable` editor over the confirmed markdown node subset: the backend renders markdown → HTML on note load and serializes the DOM back on the 300 ms debounce (`notes.htmlToMarkdown`, tested round-trip); markdown input rules (`# `, `## `, `- `, `1. `, `> ` + Space) and markdown paste convert on the fly; empty notes are legal (`Untitled`) | The user wants visible formatting; the confirmed storage format (markdown text) is preserved end-to-end and the node set stays exactly the confirmed one. |
| Markdown rendering | Rendered in-editor (rich editor); `Copy Note As… → HTML` and the HTML export convert server-side via `notes-markdown.js` for the confirmed subset with tests | One tested source of truth behind editor rendering, copy and export. |
| Formatting bar | **Implemented** in the footer (user requirement): Heading dropdown (Paragraph/H1–H3/Blockquote), Format dropdown (Bold/Italic/Underline/Strikethrough), Link (in-page URL popover), inline code, code block, task list, list dropdown; the circular button hides/shows the bar (persisted `openray-notes-format-bar-visible`), also exposed as the confirmed `Show/Hide Format Buttons` action | The confirmed footer surface; `document.execCommand` drives the contentEditable. |
| Window | C# `NotesWindow` — borderless WPF + WebView2 loading `frontend/dist/notes.html`, **always on top** (user requirement), built exactly like the launcher: transparent borderless window whose opaque rounded WPF `Border` (#1C1C1E, CornerRadius 8, drop shadow) paints the window's pixels — a fully transparent WPF surface is click-through for a layered window, which is why earlier borderless iterations swallowed all input. The page paints on top of the same colour; the custom title bar (action-panel/browse/create buttons left, centred live title, close button right) lives in the page, and empty areas drag the window via the `notes:drag` message → ReleaseCapture+HTCAPTION. The WebView is inset 6 DIP and WndProc turns that opaque ring into native resize borders (WM_NCHITTEST → HT* edges). Each show docks the window to the bottom-right of the work area (24 px gap) until the user drags or resizes it; Escape handled in the page per `escapeKeyBehavior` (`closesWindow` hides via `window.hideNotes`, `losesFocus` blurs the editor); closing (X/Alt+F4) hides instead of closing, and a closed instance is recreated on the next open; auto-height via page reports `notes.setSize` (clamped 128–860, min 442 with the action panel open, ring added to the window height); a user drag (WM_SIZING) disables auto-sizing for the window's lifetime | The confirmed window behaviors plus the user's always-on-top, custom-title-bar, corner placement and resize requirements. |
| Zoom | Preference applied to the editor font-size scale (0.75–2.0, step 0.05) with the confirmed toasts; also a Settings page select with 5% steps | Confirmed range; rendering differs (textarea). |
| Browse/Action panel | Implemented inside the notes page: top bar (title + Action Panel/Browse/Create buttons), Ctrl+K action panel with the confirmed items minus Format/format-bar entries, Browse Notes list (Pinned/Notes, confirmed subtitles/toasts), Recently Deleted view with the confirmed banner/restore/permanent-delete/Empty Trash flow | The confirmed surfaces, subset where the editor stack is absent. |
| Deeplink | `openray://notes/<id>` (Copy Deeplink copies this) | Raycast's `raycast://extensions/raycast/raycast-notes/raycast-notes?context=...` depends on its protocol registration; the clone's format is ours and documented. |
| Free limit | None — unlimited notes | No accounts/pro in the clone. |
| Onboarding note | Auto-created on first run (`Welcome to Raycast Notes`), flagged `onboarded` in `notes-settings.json` | Confirmed behavior; our own markdown content covers the confirmed browsing/resizing/actions sections. |
| Create Quicklink action | Reveals the launcher on the Quicklinks create form prefilled with the note deeplink + title (host push `quicklink.createSeed`); the launcher's Search Notes view routes through the same `createLink` seed | Confirmed cross-extension action (routes to the Quicklinks form prefilled). |
| Pin ordering | Same integer-swap scheme as Snippets (`pin` shifts pinned rows and inserts at 0; movePinnedUp/Down swap neighbours) | The exact shipped scheme is unconfirmed (see Unconfirmed); one consistent store convention. |
| Logging | Never log note text/titles; ids and counts only | Rule: notes stay local and are never logged. |
| Search Notes view | Implemented in the launcher with the confirmed recency sections, Information pane (Title/Modified/Created + highlighted preview), actions and empty states | Confirmed. |
| Notes settings page | Rows `Escape Key Behavior` + `Zoom` writing through to the backend store (`notes-settings.json`); the confirmed macOS-only `showMenuBarToggle` row is omitted and `showMenuBarToggle:false` stays in the payload | Confirmed non-macOS rows; the clone has no menu bar. |

## Implementation checklist

- [x] Backend: `notes.js` store (SQLite, CRUD, pin ordering, trash: listDeleted/recoverNote/
      permanentlyDelete/emptyTrash/60-day purge, touchAccessed, conflict-checked update) +
      namespace `notes.*` (+ `notes-markdown.js` conversions behind copy/export)
- [x] Host: `NotesWindow.cs` — WebView2 window, hide-on-escape, auto-height route, single instance
- [x] Frontend: `notes.html` page — top bar, rich contentEditable editor with markdown input rules
      and the 300 ms debounced flush, find bar with the N/M counter, footer with the Raycast format
      buttons + counters, action panel (confirmed items), Browse Notes, Recently Deleted, zoom
- [x] Frontend: Search Notes view in the launcher (sections, preview pane, actions, delete alerts)
- [x] Commands: Raycast Notes / Search Notes / Create Note, per-command alias/hotkey through the
      normal command settings mechanism
- [x] Markdown→HTML converter for the confirmed node subset
- [x] Tests: store CRUD/pin/trash/purge, title derivation, markdown converter (node set), search
      view ranking (recency sections), settings round-trip (`build/backend/tests/notes.test.mjs`,
      `build/frontend/tests/notes.test.mjs`)

## Manual test checklist

1. **Create** — `Create Note` opens the Notes window with an empty note; typing `Shopping list`
   updates the window title; closing and reopening shows the same note.
2. **Persistence** — a second note created via `New Note` is listed in Browse Notes; restarting the
   app preserves both; `backend.log` contains ids only.
3. **Pin** — pin a note (toast `Pinned Note`); it appears under `Pinned` in the switcher and the
   launcher search view; Move Up/Down reorders.
4. **Search Notes** — searching matches titles and content with the confirmed recency sections and
   empty state; Open Note jumps into the window.
5. **Find bar** — Ctrl+F finds occurrences with `N/M` counter; replace-one/replace-all update the
   text.
6. **Copy As / Export** — Copy Note As Markdown/HTML/Plain Text produce the right formats (HTML
   renders headings/lists); Export writes `.md`/`.html`/`.txt` via the save dialog with `Exported
   as ...` toasts.
7. **Delete / trash** — Delete Note moves it to Recently Deleted (toast `Note moved to Recently
   Deleted`); Restore recovers it; Permanently delete requires the confirm dialog; notes deleted 60+
   days ago vanish on startup.
8. **Escape / zoom** — Escape hides the window (with `losesFocus` set it only defocuses); Zoom
   In/Out/Reset change the editor font scale with the confirmed toasts.
9. **Onboarding** — on a fresh data directory the Welcome note exists exactly once.
