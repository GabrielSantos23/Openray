# Snippets — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~103447 | Extension block, commands, extension preferences and defaults |
| `artifacts/backend/index.mjs` @~4468000–4477000 (store `Ac`), @~1000174 (limits), backend host-RPC surface `z.host.snippets.*` | Snippet fields, keyword uniqueness, limits, host registration |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~1417000–1434000 (create/edit), @~1445140 (manual expand `Mde`), @~1446600–1465000 (search view), @~1463400 (expansion pause) | Form labels/errors, paste flow, list sections/actions, pause counter |
| `artifacts/shell/Raycast.dll` (.NET strings) | `[Snippets]` log lines: config push, native-id resolution, match cancellation, size limits, `ExpandSnippet`, `RegisterSnippets`, `UnregisterSnippets`, `EnableSnippetAutoExpansion`, `UpdateSnippetExpansionConfig`, `UpdateSnippetExpansionDisabledApps` |
| `artifacts/shell/native.dll` (PE export table, `build/.native-exports.txt`) | UniFFI exports `REGISTER_SNIPPETS`, `UNREGISTER_SNIPPETS`, `ENABLE_SNIPPET_AUTO_EXPANSION`, `EXPAND_SNIPPET`, `UPDATE_SNIPPET_EXPANSION_CONFIG`, `UPDATE_SNIPPET_EXPANSION_DISABLED_APPS`, `PASTE_IN_FOREGROUND_APP`; `on_snippet_matched` / `on_snippet_match_cancelled` events |
| `snippets-settings-page-definition-*` / `snippets-settings-view-*` | Settings rows with exact labels, option values and descriptions |

## Confirmed behavior

### Extension and commands

- Internal extension key `snippets`, title `Snippets`, description `Snippets provide quick access to
  short snippets of text, code, etc..` (double period is in the shipped string).
- Commands: `createSnippet` (`Create Snippet`, keywords `["new snippet"]`, `suggestionPriority:30`),
  `searchSnippets` (`Search Snippets`, description `Search for a snippet`, with command preference
  `primaryAction` dropdown `Paste to Active App`/`Copy to Clipboard`, default `paste`),
  `importSnippets` (`Import Snippets`), `exportSnippets` (`Export Snippets`), and AI extension
  `Ask Snippets` (`@snippets`, out of scope).
- `Search Snippets` is registered in `enabledFallbackCommandIds` — it acts as a fallback command.
- Snippets do NOT appear as root-search rows while typing; auto-expansion is the mechanism. The
  commands themselves are normal searchable commands.

### Data model and storage

- Fields: `id`, `icon`, `title`, `keyword?`, `rawContent` (TipTap doc built from the text's lines),
  `text`, `copyCount`, `tags`, `pinned?`, `createdAt`, `updatedAt`, `accessedAt`.
- Limits: text < 65536 chars (`Snippet length limit exceeded. The current limit is 65,536
  characters`), keyword ≤ 30 chars (`Keyword is too long. The maximum length is 30 characters`).
- Keyword uniqueness: exact-match check across all keywords — error `This keyword is already in use`.
- Store API: `create|update|move|delete|deleteAll|list|getOne|getByTitle|getTags|pin|unpin|
  movePinnedUp|movePinnedDown|isKeywordAvailable|updateAccessedAt|updateCopyCount`.
- On every create/update/delete the backend re-registers keywords with the host:
  `host.snippets.register({snippetIds, keywords})` / `host.snippets.remove({snippetIds})`, with
  duplicate/empty keywords suppressed before registration.

### Auto-expansion (native host)

- The keyword hook lives in the native host: a low-level keyboard hook with registered keywords
  (grapheme counts computed at registration), match and cancel events
  (`on_snippet_matched`, `on_snippet_match_cancelled`), and config pushed from the C# shell
  (`enabled`, `responseTime`, `mode`, `injectionDelay`, `withinWords`, disabled apps, sound).
- While the Create/Edit Snippet view is open, expansion is paused (frontend increments/decrements a
  pause counter around the editor).
- Placeholder resolution during expansion produces `resolved_text`/`resolved_html` in the native
  payload; the C# shell forwards content between frontend resolver and native expander
  (`IPCTypesClientFrontendSnippetsExpandSnippetInput/Output`).
- Failed resolution and size limits are logged (`Combined snippet size ... exceeds maximum`,
  `Resolved snippet text ... exceeds maximum size, truncating`, `Expanded snippet successfully`).

### Manual paste

- `Paste` in Search Snippets resolves placeholders in the frontend, then calls
  `host.snippets.expand({snippetId, text, html})` which inserts the text into the foreground app;
  failure toast `Paste failed`.

### Search view

- Placeholder `Search snippets…`; sections `Pinned`, `Recent`, `Today`, `Yesterday`, `This Week`,
  `This Month`, `This Year`, `Older` (pinned by pinned index, the rest by `accessedAt`).
- Row: icon (fallback `blank-document`), title, keyword badge (filled variant).
- Empty state: `No Snippets Found` / `Write faster by storing and inserting frequently used text.` /
  `Create your first snippet to get started.` with a `Create Snippet` button.
- Details pane `Information` rows: `Name`, `Tags`, `Content Type` (`Text`), `Times Copied` (only
  when > 0), `Last Copied` (when `accessedAt != updatedAt`), `Modified`, `Created`.
- Actions: `Copy to Clipboard` (toast `Copied snippet to clipboard`, failure `Copy failed`), `Paste`
  (title shows the frontmost app name), `Pin Snippet`/`Unpin Snippet` (toasts `Pinned Snippet` /
  `Unpinned Snippet`), `Move Up`/`Move Down` (toasts `Moved Snippet up/down`), `Edit Snippet`,
  `Duplicate Snippet` (title `${title} Copy`), `Create Snippet`, `Export Snippet`, `Share Snippet`,
  `Delete Snippet` (alert `Delete Snippet?`, `Warning: this operation cannot be undone.`; toasts
  `Deleted Snippet` / `Failed to delete snippet`), `Delete All Local Snippets` (alert `Delete All
  Local Snippets?`; toast `Deleted All Local Snippets`).

### Create/Edit form

- Fields: `Snippet` (text editor), `Name & Icon` (placeholder `Snippet name`), `Keyword` (placeholder
  `Keyword`), `Tags`.
- Help line: `Include {Dynamic Placeholders} for context like the copied text or the current date`.
- Errors: `Name cannot be empty`, `Snippet cannot be empty`, the two limit strings, keyword-in-use.
- Toasts: `Created snippet`, `Snippet updated`, `Snippet moved`; failures `Failed to create snippet`
  / `Failed to update snippet`.
- The `cursor` placeholder is allowed only in snippets, max 1 (`Only one Cursor placeholder is
  allowed`; description `Places the cursor at this position after snippet expansion`).

### Import / Export / Share

- Export all: save dialog `Snippets ${date}.json`, JSON array `{name, text, keyword?, tags?}`.
  Single-snippet export writes `${title}.json` with `{name, text, keyword?, tags?, icon}`.
- Import: per entry `{name, text, keyword?, alias?}` (`alias` maps to keyword), array or
  `{"snippets":[...]}`; error `Invalid snippet import format`; dedupe on text + keyword + title;
  result strings `${n} snippet(s) added` / `${n} duplicate(s) skipped`; toasts `Import successful` /
  `Import failed` / `Invalid JSON format`.
- Share opens `https://snippets.ray.so/shared?snippet=...` (out of scope for the clone).

### Settings page

Section `Snippet Expansion`, page keywords `[completion sound, injection delay, snippet expansion,
snippets]`. Rows (exact labels/options/descriptions):

- `Enable Snippet Expansion` (`autoExpansionEnabled`, default true).
- `Expansion Mode`: `Immediately` (`Just requires you to write the Snippet keyword.`),
  `After Delimiter (keeping)` (`Requires you to write the Snippet keyword followed by a delimiter
  (e.g. space or ENTER). The delimiter is kept after expansion.`), `After Delimiter (discarding)`
  (same but the delimiter is removed).
- `Expand within Words`: `If toggled off (default), a Snippet will only get expanded if the keyword
  is a single word. If toggled on, a Snippet keyword can be part of a wider word.`
- `Injection Delay` (only when mode is `Immediately`): `None, Short, Regular, Long, Extra Long` —
  `Injection delays serve two purposes: It lets you write words containing a snippet keyword without
  expanding that snippet, and it lets you have snippets with similar prefixes. For example, you might
  have a snippet with keyword '@@' to expand your email and another snippet with keyword '@@p' for
  the email of your partner.`
- `Response Time`: `Instant, Quick, Default, Delayed, Extended` — `Some systems are capable of faster
  response times processing clipboard entries. ... If Raycast doesn't expand your snippets correctly,
  slower response times might help.`
- `Completion Sound`: `Play a sound when a snippet is expanded automatically.` — Windows system
  sounds (`None`, `Windows Default`, `Windows Ding`, `Windows Error`, `Windows Exclamation`, ... 15
  options total).
- `Disabled Applications`: `Snippet expansion will not work in these applications.` — app picker,
  rows show app name with a remove button.
- `Show Warning Before Deleting Snippets` (localStorage `settings-snippets-remember-delete`).

## Unconfirmed

- **Keyword matching algorithm details** (case sensitivity, prefix/suffix semantics, minimum keyword
  length, multi-keyword buffer behavior) — implemented in native Rust; the behavior strings confirm
  registration/match/cancel events but not the rules.
- **Injection-delay and response-time numeric values** — the shipped options are named; the actual
  milliseconds are not in the artifacts.
- **Completion-sound playback mapping** — Raycast plays via `host.media.playSystemSound({soundName})`
  with the option list above; the exact sound-file mapping per option is not visible.
- **Placeholder resolution handoff order** during auto-expansion (native match → C# → frontend
  resolve → native expand) is inferred from IPC type names and log strings, not a single code path.
- **Per-app snooze from the blocked-app toast** — not applicable to snippets; the snippet-side
  equivalent (expansion suppress lists) is fully covered by `Disabled Applications`.

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Storage | `%LOCALAPPDATA%\Openray\snippets.sqlite`, table `snippets` (id, title, keyword, text, tags JSON, pinned_order, copy_count, accessed_at, created_at, updated_at) | Clone convention; mirrors the confirmed field set. `rawContent` is not stored — the clone keeps plain text plus the placeholder markup (single source of truth). |
| Hook | C# low-level keyboard hook (`WH_KEYBOARD_LL`) in the launcher host with a fixed keyword ring buffer sized to the longest registered keyword | Same architecture as Raycast's native hook (low-level hook + precomputed keyword lengths). |
| Keyword matching | Case-insensitive exact keyword match; with `Expand within Words` off the keyword must be delimited by non-word characters on both sides | Reproduces the property Raycast documents in the settings description; the exact native rules are unconfirmed. |
| Expansion modes | `Immediately` (expand on match), `After Delimiter (keeping)` / `(discarding)` (wait for Space/Enter/Tab, keep or drop it) | Confirmed option semantics. |
| Injection delay values | `None=0ms, Short=150ms, Regular=300ms, Long=600ms, ExtraLong=1200ms` | Unconfirmed in Raycast; our values chosen to match the described prefix-disambiguation behavior. |
| Response time values | `Instant=100ms, Quick=200ms, Default=350ms, Delayed=600ms, Extended=1000ms` (clipboard backup/restore settle delay around the paste) | Unconfirmed; our mapping of the confirmed option names. |
| Text insertion | Backspace × keyword length, then `SendInput` with `KEYEVENTF_UNICODE` for the resolved text; `cursor` placeholder splits the text so the caret lands between before/after parts | Matches the confirmed native approach (SendInput, resolved text); cursor semantics per the placeholder description. |
| Placeholders | Resolved by the shared backend engine (`placeholders.js`) — the host asks the backend over the pipe (`snippets.resolve {text, arguments?}`) | One engine for snippets + quicklinks; the backend is alive while the main window is hidden. |
| Safety skips | Skip expansion when the foreground window is a password field (UIA `IsPassword`), when its process is elevated (token check), or when the launcher itself is foreground; expansion paused while the main window is visible | UIA IsPassword and elevated handling confirmed for Raycast's hook; pause-while-editor confirmed. |
| Completion sound | Mapped to `SystemSounds` (Asterisk/Beep/Exclamation/Hand/Question); settings offers those five options instead of Raycast's 15 Windows sound names | Exact 15-name mapping unconfirmed; five plays real system sounds with the confirmed intent. |
| Disabled applications | Match by foreground process name (exe), `*` glob patterns supported like Clipboard History's ignored apps | Same mechanism the clone already has. |
| Logging | Never log snippet text, keywords, or resolved content; log ids, counts, and outcomes only | Rule: snippet content stays local and is never logged. |
| Paste action | Reuse the existing clipboard-paste host route (backup clipboard → set text → paste → restore) with the confirmed `Paste failed` toast | Same primitive Raycast's `PASTE_IN_FOREGROUND_APP` provides. |
| Import/Export | Same host file-dialog routes as Quicklinks; formats exactly as confirmed | Confirmed. |
| Age section boundaries | `Recent` = accessed within the last hour; `Today`/`Yesterday` = calendar days; `This Week`/`This Month` = rolling 7/30 days; `This Year` = calendar year | The shipped section list is confirmed; the bucket boundaries are not in the artifacts. |
| Buffer rules | Printable chars append (via `ToUnicodeEx`, so non-US layouts map correctly); Backspace pops one char; any other non-printable key clears the buffer; Ctrl/Alt/Win-held keystrokes are ignored; injected events (`LLKHF_INJECTED` + our `dwExtraInfo` marker) pass through unbuffered | Unconfirmed native details; these rules keep the buffer consistent with what the target app holds. |
| Injection-delay cancellation | Any buffer growth during the delay window cancels the pending match (a longer keyword then re-arms on its own keystroke) | Matches the confirmed description's two purposes (words containing the keyword; similar prefixes). |
| Paste action title | The clone shows plain `Paste` (Raycast shows the frontmost app name) | The frontmost-app name is not wired into the action list. |
| Manual paste cursor | `{cursor}` only moves the caret on auto-expansion; a manual Paste inserts the resolved text with the caret at the end | The clipboard-paste route cannot position the caret. |
| Primary Action preference | Stored renderer-side (`localStorage settings-snippets-primary-action`), editable on the Snippets settings page | Raycast keeps it as a command preference; the clone has no per-command preference store yet. |
| `{calculator}` in snippets | Returns `Invalid expression` until the Calculator extension lands | The clone's calculator currently lives in the renderer; the backend engine context is wired for it (`calculate`), so extension 3 plugs in without a store change. |
| Legacy inline Snippets section | The root-search inline snippet rows keep reading their localStorage source; the SQLite-backed view is `Search Snippets` | Snippets are not root-search rows (confirmed); with an empty legacy store the inline section simply never appears. |
| Share Snippet | Not implemented (Raycast opens `https://snippets.ray.so`) | Out of scope per the confirmed evidence. |

## Implementation checklist

- [x] Backend: `snippets.js` store (SQLite, keyword availability check, limits) + pipe namespace
      `snippets.*` (`create|update|delete|deleteAll|list|getOne|getTags|pin|unpin|movePinnedUp|
      movePinnedDown|isKeywordAvailable|updateAccessedAt|updateCopyCount|resolve|importEntries|
      exportAll|getPreferences|setPreference`)
- [x] Backend: keyword registration push to host on every mutation (`snippets.register` /
      `snippets.remove`) and config push on settings change; startup pushes both (the host buffers
      them until the hook exists)
- [x] Host: `SnippetMatcher.cs` (pure: keyword match over the typed buffer, boundary rules,
      backspace/caret plan, `{cursor}` split) + `SnippetHook.cs` — WH_KEYBOARD_LL hook, config
      (enabled/mode/withinWords/injectionDelay/responseTime/disabledApps/sound), match/cancel flow,
      expansion via SendInput, UIA IsPassword + elevated + disabled-app + launcher-visible skips
- [x] Host: `snippets.register|remove|setConfig` dispatch routes
- [x] Frontend: Search Snippets view (sections, keyword badge, details pane, actions, delete alerts)
- [x] Frontend: Create/Edit form (fields, limits, keyword uniqueness error, cursor placeholder hint)
- [x] Frontend: Import/Export (confirmed formats, dedupe, single-snippet export)
- [x] Frontend: Settings page rows exactly as confirmed (including the conditional Injection Delay row)
- [~] Root search: `Search Snippets` command searchable and rendered; snippets are not root rows
      (confirmed). Registration in `enabledFallbackCommandIds` is pending — the clone's fallback
      list is user-configured in Settings.
- [x] Tests: 11 node tests (`snippets.test.mjs`: limits, uniqueness, registration, pin order,
      import/export, resolve, preferences) + 9 C# checks (`build/host.tests` console harness:
      matcher/buffer/delimiter/cursor logic against a fake keystroke stream)

## Manual test checklist

1. **Create** — `Create Snippet`, name `Email`, keyword `;em`, text `john@example.com`. Toast
   `Created snippet`. Typing `;em` in Notepad within ~a second expands to the address; the keyword is
   removed.
2. **Placeholder** — text `Today is {date format="yyyy-MM-dd"}` expands with today's date;
   `{clipboard}` inserts the current clipboard text.
3. **Cursor** — a snippet with `{cursor}` places the caret between the surrounding text parts.
4. **Within words off** — typing `a;emb` does not expand (keyword not delimited); toggling
   `Expand within Words` on makes it expand.
5. **Delimiter modes** — `After Delimiter (keeping)` requires a trailing space (kept);
   `(discarding)` removes it.
6. **Disabled applications** — adding `notepad.exe` stops expansion in Notepad; other apps still
   expand.
7. **Search view** — sections fill as confirmed; Copy to Clipboard increments `Times Copied`; Paste
   pastes into the foreground app.
8. **Limits** — a 70k-char text is rejected with the confirmed message; a duplicate keyword shows
   `This keyword is already in use`.
9. **Privacy** — `launcher.log`/`backend.log` contain snippet ids and counts but no snippet text or
   keywords.
10. **Import/Export** — round-trip the export file; duplicates are skipped with the confirmed counts.
