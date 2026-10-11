# Translator — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~124551 | Extension block, `translate` / `quickTranslate` / dynamic `customTranslate` commands, root-search wiring, pro gating flags |
| `artifacts/backend/index.mjs` @~4835159 (translate call `$2r`), @~4836700 (quick-translate parser `Sms`, debounce `Ams=150`, language prefix match `Nnt`) | Backend translate call, quick-translate grammar, custom-command store |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~1476500–1492000 (Translate view `N7`), @~800386 (frontend handlers) | View placeholders, selectors, counters, actions, output behaviors |
| `translator-settings-page-definition-*` / `translator-settings-view-*` | Settings rows, custom-command dialog strings |

## Confirmed behavior

### Commands

- `translate` — title `Translate`, description `Translate any text into other languages`,
  view-command with `fallbackStatus:"available"`; primary action `open-translator` navigates to
  `/extension/translate`.
- `quickTranslate` — ephemeral root-search command, `rootSearch:{section:'translate', when:'searching',
  matching:'always'}`; dynamic title `Translate to ${targetLanguageLabel}`, dynamic description =
  the source phrase. Actions: `Copy Translation`, `Copy Source Text`.
- `customTranslate` (dynamic per saved custom command) — title = command name, type view-command;
  primary `Open Translator with Command`.
- All three carry `proFeature:'translator'` in Raycast (Pro gating is out of scope for the clone).

### Backend translate

- Raycast's backend performs the translation: `POST https://backend.raycast.com/api/v1/translations`
  with `{format:"text", q, source?, target}` and a Bearer token; response
  `data.translations[].{translatedText, detectedSourceLanguage}`. Guards: `Text to be translated is
  empty`, `Target language is required for translation`, `Authorization is required for translation`
  (401). Timeout 10 s, per-user abort controllers. **No offline/local fallback exists.**
- Custom commands: store `C.translateCustomCommands.{list,getOne,save,updateOne,deleteOne}`;
  invalidation event `translator:customCommandsUpdated`.

### Quick translate in root search

- Parser matches `^(.*)\s+(?:in|into)\s+([^\s]+)$` (case-insensitive) on the search term, strips
  quotes, transliterates + lowercases the language token, requires ≥ 3 chars, and prefix-matches the
  hardcoded language list (exact match first, then shortest). Debounce 150 ms. Row states
  `pending | failed | ready` with `{translatedText, detectedSourceLanguage}`.

### Translate view (`/extension/translate`)

- Source text placeholder `Enter text…` (dictation: `Listening…`); result placeholder `Translation`;
  pending appends `…`.
- Language selectors: source = `Detect Language` + language list (tooltip `Choose source language`),
  target = language list (tooltip `Choose target language`). Persisted in localStorage
  `translator::source-language` (default `auto`), `translator::target-language` (default `en`),
  `translator::recent-text`. Debounce 330 ms; same-language short-circuit.
- Footer: `` `${n} Word(s) · ${n} Character(s)` `` counters; `Listen to text` / `Listen to
  translation` TTS buttons; `Dictate` button (disabled tooltip `Source language required`).
- Actions: `Copy Translation` (feedback `Copied translation to clipboard`), `Paste` (to the active
  app, per the `primaryAction` pref), `Copy Source Text` (`Copied source text to clipboard`),
  `Swap Languages` (shortcut save), `Change Source Language`, `Change Target Language`. Error toast
  `Translation failed`. ActionBar label `Translator`.

### Settings page

- Rows: `Primary Action` (`The default action for the Translator command.`, options `Copy
  Translation` / `Paste to Active App`, default `copy`), `Use Selected Text as Source`
  (`prefillFromSelectedText`, `When enabled, selected text from the foremost app will be filled as
  the source text.`, default false), `Default Source Language` (options `Detect Language` + list,
  default null → `auto`), `Default Target Language` (default null → `en`).
- Custom commands dialog: header `New Translate Command` / `Edit Translate Command`; fields
  `Translate From` (`Language you would like to translate from`), `Translate To` (`Language you
  would like this command to translate to`), `Output Behavior` (`Open Translator, or replace the
  selected text in place`; options `Open in Raycast` / `Replace Selection`), `Command Name`
  (placeholder `Translate to…`, required error `Please enter a name`); auto-name
  `Translate to ${target}` or `Translate ${sourceLabel} to ${targetLabel}`; buttons `Cancel` /
  `Create Command` / `Save Command`.
- Custom-command list menu: `Edit Command`, `Duplicate Command` (`${name} Copy`), `Copy Deeplink`,
  `Disable Command`/`Enable Command`, `Delete Command` (alert `` Delete Command "${title}" `` /
  `Warning: This action cannot be undone.`); section button `Create Command`; section title `Custom
  Commands`.

### Root-search row

- Left = source phrase (badge = detected/source language label, fallback `Original`), right =
  `Translating…` (pending) / `Translation unavailable` (failed) / translated text; right badge =
  target language label.

## Unconfirmed

- **Upstream provider** behind Raycast's `POST /api/v1/translations` (vendor, rate limits) — not
  observable client-side.
- **The full 133-entry language list.** The list identifier (`Nnt`) and its matching rules are
  confirmed, but the entries themselves were not extracted from the artifacts.
- **`runOnConsecutiveHotkey` semantics** — the flag exists on the translator commands; its runtime
  behavior is not visible.
- **TTS/dictation plumbing** — `raycast.startDictation`/`stopDictation` host RPCs exist; the exact
  speech pipeline is not visible.

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Translation provider | `https://translate.googleapis.com/translate_a/single?client=gtx&sl=<src>&tl=<tgt>&dt=t&q=<text>` (unofficial free endpoint, no key), parsed from the nested array response; detected source language read from the response | Raycast's endpoint requires a Raycast account; the local-first rule explicitly allows the translator to use the network. Implemented behind a single `translate()` function so the provider is swappable. |
| Error/offline handling | Timeout 10 s; failures surface as the confirmed `Translation failed` toast with the underlying message; nothing cached to disk | Matches the confirmed guard/error behavior; no silent stale results. |
| Language list | Curated list of the major Google-Translate-supported languages (≈ 60 entries, code + English name), including all commonly used ones | The exact 133-entry shipped list was not extracted; a curated list reproduces the observable behavior (prefix matching ≥ 3 chars, exact-first). Listed as a decision without full evidence. |
| Caching | In-memory LRU per `(text, source, target)` in the backend, bounded at 200 entries | Keeps repeated quick-translates instant without disk growth. |
| Quick translate | Backend implements the confirmed parser (`in|into`, quote stripping, transliteration + lowercase, ≥ 3 chars prefix match, 150 ms debounce, pending/failed/ready states); the frontend renders the split row | Confirmed grammar. |
| Custom commands | Backend store `translator_custom_commands` (id, name, source, target, output_behavior, enabled) in the shared settings/SQLite convention | Confirmed store surface. |
| `Replace Selection` output | Row present; functional only when the host's `applications.getSelectedText` returns text — otherwise falls back to opening the Translate view | The clone's selection read is a stub; real UIA selection is a separate unconfirmed item. |
| TTS / dictation | Omitted (`Listen to text` / `Listen to translation` / `Dictate` not implemented) | Requires a speech stack the clone does not have; listed as out of scope, not mocked. |
| Pro gating | None — the Translator is free for everyone | Clone has no accounts; Raycast's `proFeature` gating is not reproducible or needed. |
| Settings persistence | Extension settings JSON file beside the SQLite stores (`translator-settings.json`) with the four confirmed preferences | Matches the clone's settings convention. |
| Root-search section | `translate`, ephemeral, visible while searching when the term matches the quick-translate grammar | Confirmed wiring. |
| Section placement | The ephemeral Translate section renders directly under Calculator (both are ephemeral answer rows); custom-command rows get their own `Translate` section after Quicklinks, shown only while searching | The shipped section order is not observable client-side; placement is our choice. |
| Custom-command rows | Only `enabled` commands appear as dynamic root rows; their primary action is opening the Translate view with the command's languages (the confirmed `Open Translator with Command`) | Disabled commands stay in the Settings list only. The row's Ctrl+K opens the view directly instead of an action panel — the panel would duplicate the single primary action. |
| `Swap Languages` with auto source | Uses the detected source language from the last result; without one, `en` stands in so the swap stays well-defined | The shipped swap semantics for auto are not observable. |
| Copy Deeplink | Copies `raycast-mini://translate?id=<id>` | No protocol handler is registered in the clone; the string mirrors Raycast's deeplink shape and is informational only. |
| `Open in Raycast` label | Kept verbatim as the confirmed Output Behavior option label | Confirmed strings are the source of truth for the clone's UI text. |

## Implementation status (2026-10-11)

- **Backend** (`build/backend/src/translator.js`): the confirmed quick-translate parser (regex, quote
  stripping, NFD transliteration + lowercase, ≥ 3 chars, exact-then-shortest prefix match over the
  curated 87-language list), the provider call behind the single swappable `translateText` function
  (free Google `translate_a/single` endpoint, 10 s timeout, the two confirmed guard strings),
  the in-memory LRU cache (200 entries, no disk cache), the custom-command SQLite store
  (`translator.sqlite`) with auto-name + `translator.customCommandsUpdated` pushes, and the four
  preferences in `translator-settings.json` with validation. Logging is outcome-only (char count,
  languages, duration) — never the text.
- **Frontend**: `TranslateView.tsx` — the shipped two-pane layout (language selectors with a flag
  icon on the top bar, side-by-side source/result panes split by a hairline, the circular swap
  button floating bottom-center, the shared `LoadingBar` sweeping while a translation is in
  flight); `Detect Language` + list selectors persisted in the confirmed localStorage keys, 330 ms
  debounce, same-language short-circuit, `` `${n} Word(s) · ${n} Character(s)` `` counters, the
  confirmed action set, `Translation failed` toast with the underlying message, a language-picker
  overlay styled and keyboard-driven like the ActionPanel lists, and copy actions that hide the
  launcher so the toast migrates to the HUD; the
  root-search quick-translate row (pending `Translating…` / failed `Translation unavailable` /
  ready with badges, 150 ms debounce, split-row layout shared with the calculator row); the
  `Translate` command row; dynamic custom-command rows.
- **Settings** (`Settings.tsx`): the Translator page with the four confirmed preference rows and
  the Custom Commands section (Create/Edit dialog with the confirmed field labels, auto-name,
  `Please enter a name` error, `Cancel` / `Create Command` / `Save Command` buttons; per-command
  menu with `Edit Command`, `Duplicate Command` (`` `${name} Copy` ``), `Copy Deeplink`,
  `Disable/Enable Command`, `Delete Command` with the confirmed alert).
- **Out of scope (not mocked)**: TTS (`Listen to text` / `Listen to translation`), dictation,
  `Replace Selection` in-place output (the host's `shell.getSelectedText` is a stub returning
  `null`; the `Use Selected Text as Source` prefill and the `replace` behavior are wired and
  become functional once the host reads real selections), Pro gating.
- **Tests**: `build/backend/tests/translator.test.mjs` — 17 tests covering the parser grammar,
  prefix matching, provider payload parsing (multi-segment, detected language, no-detection),
  the confirmed guards (no network on violation), cache keying + LRU eviction, offline/HTTP
  failures (uncached), custom-command CRUD with auto-name + pushes, preference
  persistence/validation, and a backend-wiring smoke test (no other suite loads `backend.js`, so a
  syntax error there previously only surfaced as a crash loop at startup). All 90 backend tests
  across the six suites pass.

## Implementation checklist

- [x] Backend: `translator.js` — provider call (swappable), language list, quick-translate parser
      (regex, quote stripping, transliteration + lowercase, ≥ 3 chars prefix match), in-memory
      cache, custom-command store + namespace
      `translator.*` (`translate|parseQuickTranslate|quickTranslate|getLanguages|getPreferences|
      setPreference|getAllTranslateCustomCommands|saveTranslateCustomCommand|
      updateTranslateCustomCommand|deleteTranslateCustomCommand`)
- [x] Frontend: Translate view (`/extension/translate`) — placeholders, selectors with persisted
      languages, 330 ms debounce, same-language short-circuit, counters, actions, error toast
- [x] Frontend: root-search quick-translate row (pending/failed/ready, badges)
- [x] Frontend: Custom Commands management (dialog with confirmed fields/labels, list menu, delete
      alert) — hosted on the Translator Settings page
- [x] Settings page: Primary Action, Use Selected Text as Source, Default Source/Target Language
- [x] Tests: parser cases (`hello in french`, quotes, short language token, `into`), prefix matching,
      provider response parsing (fixture payload), cache behavior, custom-command CRUD

## Manual test checklist

1. **View** — open `Translate`, type `Hello world`: translation appears with a target of English;
   the counter reads `2 Word(s) · 11 Character(s)`; switching target to German re-translates after
   the 330 ms debounce.
2. **Detect** — paste French text with source `Detect Language`; the result badge shows the detected
   language.
3. **Quick translate** — type `bonjour in german` in root search: the split row shows the phrase on
   the left and the translation on the right with badge `German`; Enter copies the translation
   (toast `Copied translation to clipboard`).
4. **Errors** — with networking disabled, the row shows `Translation unavailable` and the view shows
   `Translation failed` (no hang).
5. **Custom command** — create `Translate to German` (auto-named), it appears in root search and
   opens the view with languages prefilled; delete shows the confirmed alert.
6. **Settings** — Primary Action `Paste to Active App` makes the view's primary action paste;
   Default Target Language persists across restarts.
7. **Logs** — `backend.log` contains the request outcome but never the translated text.
