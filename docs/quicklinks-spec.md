# Quicklinks — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts;
nothing is inferred from Raycast's public documentation.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~64995 | Extension block, commands (`create`, `createWithURL`, `search`, `import`, `export`), dynamic `quicklink` command, extension preferences, action groups |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~431540–433300 (open flow `MM`/`PM`), @~1060000 (form), @~1078000–1094000 (search view), @~776000 (import schema), @~1069000 (export), @~789000 (args form errors) | Resolve/open behavior, create/edit form labels, list/actions/detail strings, import/export formats |
| `artifacts/backend/index.mjs` @~4384800 (library/bangs), @~4391280 (handlers `fu`), @~4542400 (arg enumeration `Ras`), @~4542513 (`createWithURL` resolver) | Store API, DuckDuckGo bangs, argument derivation |
| `artifacts/frontend/compose-ai-command-prompt-eLUJwcjU.js` (identical copy in backend @~3013000–3037000) | The shared dynamic-placeholder engine (contexts, resolvers, modifiers, output encoding) |
| `quicklinks-settings-view-*` / `quicklink-delete-confirmation-B9ASUxmt.js` | Settings rows, delete confirmation strings |

## Confirmed behavior

### Extension and commands

- Internal extension key `quicklinks`, title `Quicklinks`, description `Create links to open your
  frequently used websites and apps.`
- Static commands (all `view-command` unless noted):
  - `create` — `Create Quicklink`, keywords `["new quicklink"]`, `suggestionPriority:30`,
    `fallbackStatus:"available"`. Command preference `autofill` (checkbox, default true, label
    `Autofill selected text`).
  - `createWithURL` — `Create Quicklink`, `ephemeral`, `rootSearch:{when:'searching',matching:'url'}`;
    backend resolver produces `{link}` from the search term. Out of scope for increment 1 (see decisions).
  - `search` — `Search Quicklinks`, description `Search all your quicklinks.`
  - `import` — `Import Quicklinks`, description `Import quicklinks from a file or URL.`
  - `export` — `Export Quicklinks`, description `Export all quicklinks.`
- Dynamic command per quicklink: title = name, keywords `["quicklink"]`, type `no-view-command`,
  `fallbackStatus` `available` when the link has no argument placeholders else `not-available`,
  settings config `{enabled, alias, hotkey, favoriteOrder, fallbackOrder}` all true. Icon
  normalization strips a trailing `-16`; `"default"`/`link` map to the standard Quicklinks icon.
- Actions on the dynamic command: `Open Quicklink` (primary), `Open With…`, `Show in File Explorer`
  (only when the link matches `/^([a-zA-Z]:[\\/]|\\\\|\\/|~(\\/|\$)|file:\\/\\/)/`), `Edit Quicklink`,
  `Duplicate Quicklink`, `Copy Name`, `Copy Link`, `Delete Quicklink` (keywords `["remove"]`),
  plus favorites/deeplink/configure groups.

### Placeholder engine (shared with Snippets)

- Syntax: `{` keyword `[\w-]+` + `name=value` options (values may be quoted) + `|modifier` + `}`.
  Modifiers: `uppercase`, `lowercase`, `trim`, `percent-encode`, `json-stringify`, `raw`.
- Resolvers (ids exact): `uuid` (`crypto.randomUUID`), `clipboard` (option `offset`, reads last
  clipboard entries), `calculator` (option `expression`), `argument` (options `name`, `default`,
  `options` for a dropdown; max 3 distinct arguments — error `Only 3 different Arguments are allowed`),
  `selection` (selected text), `date`/`time`/`datetime`/`day` (options `format`, `locale`, `offset`
  like `+3d`; offsets in `m/h/d/M/y`), `cursor` (snippet-only, max 1), `snippet` (embed by id),
  `browser-tab`/`ai` (out of scope — external dependencies).
- Output encoding for the quicklink context: every placeholder value is
  `encodeURIComponent`-encoded unless the `raw` modifier is present.
- Placeholders are replaced right-to-left by range so nested results are not re-parsed.
- There is no `{Query}` legacy token. The only legacy syntax is the deprecated positional
  `{name:default}` form for quicklink arguments.

### Argument placeholders in links

- Each `argument` placeholder in a link becomes a command argument: `{type:"text", name, placeholder,
  value: defaultValue, required: defaultValue === undefined}` or a dropdown
  `{type:"dropdown", data:[{title,value}]}`; max 3.
- Opening a quicklink with required args shows the shared argument form; errors
  `Please enter a value for "${placeholder}"` and `Invalid value for "${placeholder}"`.
- Argument enumeration is cached per link and invalidated on `quicklinks:updated`.

### Open behavior

1. Resolve the link through the placeholder engine with the provided argument values.
2. If `openWith` is set → close the launcher window, then open the resolved value with that
   application.
3. Else → `openUrl` (system default browser/handler), honoring the extension preference
   `preferExistingTabs` on Raycast's side.
4. On success `updateOpenCount({id})` is called. Failure toast: `Unable to open quicklink`, message
   `Invalid URL`.

### Create/Edit form

- Fields: `Link` (with an `Add Placeholder` toolbar button that inserts `{`), `Name & Icon`
  (input placeholder `Quicklink name`), `Open With` (first option `System Default`, then installed
  apps), `Tags`.
- Help text: `Include {Dynamic Placeholders} to add arguments or context like the selected or copied
  text in the link`.
- Validation errors: `Please enter a name`, `Please enter a link`.
- Save button: `Update Quicklink` (edit) / `Duplicate Quicklink` (duplicate) / `Save Quicklink`.
  Toasts: `Creating quicklink` / `Updating quicklink` pending; `Created Quicklink` (with `Search
  Quicklinks` and `Open Quicklink` actions), `Updated Quicklink`; failures `Failed creating
  quicklink` / `Failed updating quicklink`.
- Autofill (create, pref default true): prefill link/name from the frontmost window context or from
  the last clipboard item when it parses as a URL.

### Search view

- Placeholder `Search for Quicklinks…`; sections `Pinned` then `Quicklinks`.
- Row: favicon when icon is `default`/`link` and a link exists, else the icon (fallback `link`);
  title = name; alias badge; hotkey chip on the selected row.
- Empty state: `No Quicklinks Found` / `Save frequently used links for quick access.` with a
  `Create Quicklink` button.
- Details pane section `Information` rows: `Name`, `Link` (mono), `Tags`, `Created`, `Last Updated`,
  `Opened` (`Never` / `Once` / `${n} times`).
- Actions: primary `Open Quicklink` / `Open With…` / `Show in File Explorer` (file links) / `Edit
  Quicklink` / `Duplicate Quicklink`; secondary `Pin Quicklink`/`Unpin Quicklink` (toasts `Pinned
  Quicklink` / `Unpinned Quicklink`), `Move Up`/`Move Down` (toasts `Moved Quicklink up/down`); copy
  `Copy Name`, `Copy Link`; delete `Delete Quicklink`, `Delete All Local Quicklinks`; configure
  `Configure Quicklink` submenu (`Set Alias`/`Update Alias`, `Set Hotkey`/`Update Hotkey`, `Delete
  Alias`, `Delete Hotkey`) and `Hide in Root Search`/`Show in Root Search`.
- Delete confirmation alert: title ``Delete Quicklink "${name}"``, description
  `Warning: This action cannot be undone.`, destructive button `Delete`. Delete-all alert:
  `Delete All Local Quicklinks?`, same warning. Toasts `Quicklink deleted` / `Failed to delete
  quicklink`; `All local quicklinks deleted` / `Failed to delete all quicklinks`.

### Data model and store

- Fields: `name`, `link`, `icon`, `openWith`, `tags`, `pinned`, `openCount`, `createdAt`, `updatedAt`.
- Store API (backend handlers `list, getQuicklink, getTags, save, delete, deleteAll, update, move,
  updateOpenCount, pin, unpin, movePinnedUp, movePinnedDown`).
- Every mutation emits `quicklinks:updated` so root-search dynamic commands re-resolve.

### Import / Export

- Import accepts a bare JSON array or `{"quicklinks":[...]}`; per entry `{name, link?|url?,
  icon?|iconName?, openWith?|applicationID?}` (fallbacks as shown); icon normalization strips a
  trailing `-16`. Error `Invalid quicklink import format`. Dedupe by identical `link`.
  Result strings `${n} quicklink(s) added` and `${n} duplicate(s) skipped`; toasts `Import
  successful` / `Import failed`.
- Export opens a save dialog with `fileName: Quicklinks ${date}.json` and writes a pretty-printed
  JSON array of `{name, link, icon, tags?}`; toast `Exported quicklinks`, failure `Failed to export
  quicklinks`.

### Library

- The `Add from Library` picker ships 16 hardcoded `Featured` quicklinks titled `Search ${name}`
  (Google, DuckDuckGo, Google Images, Wikipedia, Hacker News, YouTube, Unsplash, Stack Overflow,
  Twitter, Dribbble, Giphy, LinkedIn, Raycast Manual, Translate (3 named arguments), Google Maps
  (argument `Place`), App Store), each with its URL and `{argument}` placeholders.
- The full library is a fetch of `https://duckduckgo.com/bang.js` (15 s timeout) where each bang
  becomes `Search ${name}` with `{{{s}}}` replaced by `{argument name="Query"}` (`Query2`, `Query3`).

### Settings page

Page description `Configure Quicklinks behavior and command settings.` Rows:
`Show Link Previews` (`showPreviews`, default true), `Prefer Existing Tabs` (`preferExistingTabs`,
default false, description `When opening a Quicklink, check if the URL is already open and activate
that tab instead of opening a new one.`), `Pass Selected Text as Argument` (`passSelectedTextAsArgument`,
default false, description `When enabled, Raycast will automatically pass selected text from the
active application to Quicklinks with a single argument when invoked via hotkey.`), `Show Warning
Before Deleting Quicklinks`. The view also lists static commands and per-quicklink dynamic commands.

### Root search integration

- Dynamic quicklink rows render with title = name and a `Quicklink` label; they participate in the
  normal command ranking (alias, hotkey, favorites, frecency) and are NOT in a dedicated root-search
  section.
- `createWithURL` appears while searching when the term matches a URL.

## Unconfirmed

- **Favicon resolution.** Raycast resolves favicons for `default`-icon quicklinks; the lookup host
  and caching were not traced (link-info fetch with 15 s timeout was confirmed for previews, the
  favicon path itself was not).
- **`preferExistingTabs` mechanism.** The preference is read into the open flow; the tab-matching
  API behind it is not visible in the shipped JS.
- **`openWith` identifier format.** Entries store a `raycastAppId`; the mapping from that id to an
  executable on Windows was not traced end-to-end.
- **Exact autofill priority** between frontmost-window context and clipboard when both are available.
- **The full 133-language-style metadata of `passSelectedTextAsArgument`** beyond its settings
  description (the pref is read, but the end-to-end application path was not traced).

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Storage | `%LOCALAPPDATA%\Openray\quicklinks.sqlite`, table `quicklinks` (id, name, link, icon, open_with, tags JSON, pinned_order, open_count, created_at, updated_at) | Matches the clone's per-extension SQLite convention (clipboard history). |
| Placeholder engine | Reimplemented from the spec'd behavior in backend JS (`build/backend/src/placeholders.js`), shared by Quicklinks, Snippets and the Calculator resolver; frontend calls it over IPC | One engine, testable in the backend suite; the backend resolves during snippet auto-expansion when the frontend may be hidden. Resolvers: `argument`, `clipboard`, `date`, `time`, `datetime`, `day`, `uuid`, `calculator`, `selection`, `cursor`, `snippet`. No `browser-tab`, no `ai`, no fallback `??` (flag-gated and off in Raycast). |
| Library | The 16 hardcoded Featured quicklinks only; no `duckduckgo.com/bang.js` fetch | Local-first rule: only currency rates and the translator may use the network. |
| Link previews | Dropped (`showPreviews` row omitted from the settings page) | Requires Raycast's preview service; no local equivalent. |
| Prefer Existing Tabs | Dropped (row omitted) | No browser-tab API in the clone. |
| Pass Selected Text as Argument | Preference implemented; functional only when the host's `applications.getSelectedText` returns text (currently a stub that may return null) | Real UIA selection reading is a separate, unconfirmed item; the placeholder degrades to empty text. |
| Open flow | `shell.openUrl` (Process.Start with UseShellExecute) for links; `shell.openWith {path, app}` for `openWith`; `shell.revealFile` for `Show in File Explorer` | New host routes in `NativeHost.cs`; mirror the confirmed 3-step flow including `updateOpenCount`. |
| Open With picker | Dropdown of installed applications from the existing `applications` store (same data the Applications extension uses) | Raycast lists all installed apps; the clone already has that inventory. |
| Import/Export | New host routes `fileSystem.showOpenFileDialog` / `fileSystem.showSaveFileDialog` (Win32 dialogs, reusable by Snippets and Notes); export default filename `Quicklinks ${yyyy-MM-dd}.json` | Raycast uses native dialogs; the clone has no dialog route yet. |
| Arg form | Reuse the existing argument input UI in `App.tsx` (already built for command arguments) with the confirmed error strings | Same interaction shape as Raycast's shared argument form. |
| Icon | Monogram tile (first letter of the name) as the fallback; `default`/`link` map to the link glyph | No favicon fetching (local-first); the fallback icon name is confirmed. |
| Alias/hotkey/favorites | Via the existing per-command mechanism (backend command settings + host `RegisterCommandHotkey` route map) | Confirmed settings config `{alias, hotkey, favoriteOrder, fallbackOrder}`. |
| `createWithURL` | Implemented: when the root-search term matches a URL, offer `Create Quicklink` prefilling the form | Confirmed `matching:'url'`; cheap once the form exists. |
| Delete warning | Implemented with the confirmed alert strings; remembered choice stored in localStorage `settings-quicklinks-remember-delete` | Confirmed behavior. |

## Implementation checklist

Status legend: `[x]` done, `[~]` partial, `[ ]` pending.

- [x] Backend: `quicklinks.js` store (SQLite, all handler methods) + pipe namespace `quicklinks.*`
- [x] Placeholder engine in backend JS with the confirmed resolvers/modifiers + unit tests
      (resolution order, encoding, modifiers, arg limits, date offsets)
- [x] Argument derivation from links (max 3, dropdown options, required flag) + tests
- [x] Host routes: `shell.openUrl`, `shell.openWith`, `shell.revealFile`, `fileSystem.showOpenFileDialog`,
      `fileSystem.showSaveFileDialog` (+ `readFile`/`writeFile` for import/export)
- [x] Frontend: Search Quicklinks view (sections, details pane, empty state, actions, alerts, filters)
- [x] Frontend: Create/Edit form (fields, placeholder toolbar, help text, validation, toasts)
- [x] Frontend: Import/Export with the confirmed formats and dedupe
- [x] Frontend: Library picker (16 Featured quicklinks)
- [x] Root search: `Search Quicklinks` command in Commands; dynamic quicklink rows while searching
      (args → argument form; `createWithURL` entry when the term is a URL)
- [x] Settings page: `Pass Selected Text as Argument`, `Show Warning Before Deleting Quicklinks`
- [x] Replace the inline localStorage quicklinks placeholder in `inlineSections.ts` / `App.tsx`
- [x] Tests: placeholder resolution (14 cases), arg enumeration, import parsing/dedupe, store CRUD +
      pin ordering (9 cases) — 39/39 backend tests green

Pending manual verification in the running app (user-driven): the Manual test checklist below.

### Out of scope

- [ ] `browser-tab` and `ai` placeholders, fallback `??` syntax
- [ ] Link previews, `preferExistingTabs`, organizations, cloud sync, share (`ray.so/quicklinks/shared`),
      `Ask Quicklinks` AI extension
- [ ] Remote DuckDuckGo bangs library

## Manual test checklist

1. **Create** — open `Create Quicklink`, enter `https://google.com/search?q={argument name="Query"}`
   named `Search Google`. Toast `Created Quicklink`; the row appears under `Quicklinks`.
2. **Open with argument** — search `Search Google`, press Enter: the argument form asks for `Query`;
   typing `raycast` and Enter opens `https://google.com/search?q=raycast` in the default browser and
   `openCount` becomes 1 (details pane shows `Once`).
3. **Placeholders** — a quicklink with `{clipboard}` pastes the last clipboard text into the URL
   (percent-encoded); `{date format="yyyy-MM-dd"}` resolves to today; `|uppercase` uppercases.
4. **Root search** — the quicklink appears when typing its name; alias works; per-command hotkey
   registered through Configure opens it directly.
5. **Pin / reorder / delete** — pin two quicklinks (`Pinned` section, `Pinned Quicklink` toast),
   Move Up/Down reorders, Delete shows the confirmed alert and removes the row.
6. **Import/Export** — export produces `Quicklinks <date>.json` in the chosen folder; import of that
   file adds duplicates-skipped counts; importing a malformed file shows
   `Invalid quicklink import format`.
7. **Library** — `Add from Library` lists the 16 featured entries; adding Translate produces a
   3-argument quicklink.
8. **Logs** — `backend.log` shows no quicklink content (names/links are never logged).
