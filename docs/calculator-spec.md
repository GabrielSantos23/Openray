> **REA REFERENCE (archived for the A6 grep gate):** documents the real Raycast build for evidence and verification — describes upstream behavior, not Openray's implementation.

# Calculator — behavioral spec

Reverse-engineered from the shipped Windows build `Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a`.
Source of truth for the clone. Every "confirmed" item was read out of the shipped artifacts.

## Evidence sources

| Artifact | What it gave us |
| --- | --- |
| `artifacts/frontend/internal-extensions-C7AXi5Nw.js` @~10084 | Extension block, command, root-search wiring |
| `artifacts/backend/calculator-worker.mjs` (read fully) | Native worker wrapper: `calculate`, `updateRates`, `supportedCurrencies`, config `{datePicker, locale, rates, remToPxRate, workHoursPerDay}` |
| `artifacts/backend/index.mjs` @~3319000–3333000 (engine selection, handlers `xPe`), @~4916882 (root-search actions `WHr`), @1563130 (Raycast API base URL), @~3301500 (places/weather endpoints) | Handler surface, history store semantics, 2 h rate refresh, evaluation/metadata type enums |
| `artifacts/frontend/main-window-g1Vb1JLY.js` @~1320170 (row renderer), @~333000–356000 (history view), @~345900–350200 (metadata/labels), @~717795 (frontend handlers) | Root row layout, history view, action strings, put-answer-in-search-bar / swap-units |
| `calculator-settings-page-definition-*` | Settings rows |

## Confirmed behavior

### Extension and command

- Internal extension key `calculator`, title `Calculator`, description `Calculate numbers and
  expressions.`
- One ephemeral command with `rootSearch:{section:'calculator', matching:'always'}` and
  `omitFromFrecencyTracking` — the calculator row appears in root search whenever the search term
  evaluates; it is not a searchable command.
- The row is a split item, height 124: left block = the parsed expression tokens (with optional
  syntax highlighting) and a metadata badge (default label `Expression`; unit name; formatted date
  for date expressions), a divider with an arrow, right block = the answer
  (`evaluation.description`) and a right badge (default `Result`; unit long name; `Your time` when a
  timezone offset matches local). Currency conversions show a third line: `Currency rates are out of
  date` or `Updated ${relativeTime}`.
- Enter = primary action = `Copy Answer`.

### Engine

- The engine is a native addon (`Calculator.node`) behind a worker thread, config
  `{datePicker, locale, remToPxRate, workHoursPerDay}`; methods `calculate`, `updateRates`,
  `supportedCurrencies` (→ `{fiat:[], crypto:[]}`). A 5 s outer timeout returns no result; error
  codes `null_result` / `invalid_expression` are treated as no result.
- The addon itself is not shipped in the recovered artifacts, so the exact expression grammar is
  only observable through the evaluation/metadata type enums.
- Handlers: `calculate({expression, locale})`, `parseDate`, `parseDuration`, `refreshCurrencies`.
  `parseDate` normalizes `may`→`May`, `-`→`.`, day-month patterns, bare `d/m` (current year
  appended), number words `one`..`twelve`, and `X at Y` time composition (`noon/midday/midnight`,
  `9 am`, `14:30`). `parseDuration` handles `mm:ss`, "until 5 pm" (time until next occurrence), and
  unit words (`ms, s, sec, second, m, min, h, hr, d, day, w, week, ...`).
- Result metadata types: `conversion, singleUnitExpression, singleNumber, singleDatestamp,
  dateSeeking, unitUntilDateSeeking, intervalBetweenDatesSeeking, timeAtPlaceSeeking,
  timeDifferenceBetweenPlacesSeeking, timeConversionToPlace, customFunction, other`. Evaluation
  types group into `dateTime` (`date, iso8601, datespan, timespan`), `unitConversion`
  (`unitExpression, unitRate, unitRange`), `math` (`decimal, percentage, multiplier, fraction,
  binary, octal, hexadecimal, scientificNotation, boolean, salesTax, timestamp,
  degreesMinutesSeconds`), everything else `unknown`.
- History category mapping is metadata-first, then evaluation type → `unitConversion | dateTime |
  math | unknown`.

### Currency rates

- Minimum refresh interval 2 h (`7200 * 1e3`). Fiat rates from Raycast's backend
  (`backend.raycast.com/api/v1`, `.quotes` keyed `USDxxx`); crypto from a second endpoint with
  per-code rates. Rates are stored (`setFiat`/`setCrypto`) and pushed to all engine instances via
  `updateRates`. Conversion syntax `{quantity} {from} to|in {target}`; `lastUpdated` is shown for
  currency conversions.

### Actions (root row and history)

- `Copy Answer` (primary; toast `Copied answer to clipboard`, failure `Failed copying answer` /
  `Calculator result is not available`), `Paste Answer` (`Failed to paste`), `Copy Unformatted
  Answer` (`No unformatted result available`), `Copy Question and Answer` (text
  `${expression} = ${answer}`, toast `Copied to clipboard`), `Show History` (navigates to
  `/extension/calculator/history`), `Pin Calculation` (`Pinned calculation` / `Failed to pin
  calculation`), `Put Answer in Search Bar` (replaces the search bar text with the answer),
  `Swap Units` (rewrites the expression with the units swapped and re-searches), `Refresh
  Currencies` (`Currencies refreshed!` / `Failed to refresh currencies`), `Discover the power of
  Calculator` (opens the manual).

### History

- Handlers: `historyGetAll`, `historyUpsert` (+ `deleteExceedingLimit(4096)`), `historyDelete`,
  `historyDeleteAll({includePinned})`, `historyPin`, `historyUnpin`, `historyMovePinnedUp`,
  `historyMovePinnedDown`. Retention: entries older than 90 days are deleted ("preserved for the
  last 3 months").
- History view (`/extension/calculator/history`): search placeholder `Do math, convert units, or
  search your past calculations...`; a live result row is computed per keystroke; sections `Pinned`,
  `Today`, `Yesterday`, `This Week`, `This Month`, `This Year`, `Older`. Empty state `You have no
  recent calculations` / description ``Try "9 am SF", "17m", or "25% of $500 in GBP"``; no-match
  `No results` / `Try a different expression`.
- History row: icon by category (`math`→calculator, `unitConversion`→switch, `dateTime`→clock), left
  = expression, right = answer. Actions mirror the root row plus `Copy Question` (shortcut
  copyTertiary), `Put Question in Search Bar`, `Pin Entry`/`Unpin Entry`, `Move Up/Down in Pinned`,
  `Delete Entry`, `Delete All Entries` (confirm dialog `Delete All Entries` / `Are you sure you want
  to proceed with deleting all calculator history entries? Only pinned entries will remain.` /
  destructive `Delete All`; keeps pinned). Clearing the search saves the live result to history.

### Settings page

Page keywords `[calculator, color, hex, pixels, rem, em, syntax highlighting, flight tracker]`.
Rows: `Enable Color Conversion` (`enableColorDetection`), `Enable Flight Tracker` (defined but not
rendered in the view), `Syntax highlighting` (`enableSyntaxHighlighting`), `REM/EM to Pixel
Conversion` (number input, min 1, step 1, `remToPxRate`). Registry also has `workHoursPerDay`
default 8 (no settings row). **No currency-base or decimal-separator setting** — separators come
from the system locale.

## Unconfirmed

- **The calculation grammar inside `Calculator.node`.** The addon is not among the recovered
  artifacts; the supported operator/unit/date surface is known only through the type enums and the
  handler normalizers. "Soulver" branding is unconfirmed (no such string anywhere).
- **`parseDate`/`parseDuration` full grammars** beyond the normalization steps listed above.
- **`Copy Unformatted Answer`** — which formatting differs is not visible (only the failure string
  `No unformatted result available` confirms a separate unformatted path).
- **`workHoursPerDay` application** (registered default 8, no settings row; presumably duration
  math) — not traced.
- **Fiat rate vendor** behind Raycast's `currencies` endpoint — not observable client-side.

## Our decisions

| Item | Decision | Why |
| --- | --- | --- |
| Engine | Our own evaluator in `build/backend/src/calculator-engine.js` (single implementation, backend-owned; the renderer calls `calculator.calculate` over IPC), recursive-descent parser, **no `eval`/`Function`** | Raycast's grammar lives in an unavailable native module; the clone reimplements the observable behavior locally and testably. One engine serves the root-search row, the history live row and the `{calculator}` placeholder, exactly where Raycast's addon sits in its backend. |
| Supported grammar (increment 1) | Arithmetic `+ - * / ^ %` with parentheses and unary minus (spaced `%` is modulo, an attached `%` is a percent suffix); functions `sqrt, sin, cos, tan, log` (log10)`, ln, abs, round, floor, ceil, min, max, pow, exp`; constants `pi, e, tau`; percentage forms `25%`, `X% of Y`, `Y + X%`, `Y - X%`; number formats `1_000`, `0x/0b/0o`, `1e5`; unit conversions `10 km to mi` (`to`/`in`) over length (mm,cm,m,km,in,ft,yd,mi), mass (mg,g,kg,t,oz,lb), data (B,KB,MB,GB,TB,KiB,MiB,GiB,TiB), duration (ms,s,min,h,day,week), temperature (°C,°F,K); `rem`/`em`→px via `remToPxRate` (default 16); currency-symbol prefixes `$ € £ ¥` | Covers the confirmed math + unitConversion + percentage/number-format evaluation types that are cheap to reproduce exactly; listed per-item so tests can pin behavior. `Y - X%` is the symmetric completion of the confirmed `Y + X%` form (pinned in tests); `log` = log10 is our choice (unconfirmable in the shipped addon). |
| Dates | Time-at-place is implemented (`time in china` / `china time` / `time in asia/tokyo` — the confirmed `timeAtPlaceSeeking` metadata type: current local time as the answer, the place and `GMT±N` as badges, resolved locally against a curated country/city table plus direct IANA zones, no network). The rest of the date grammar (`parseDate`/`parseDuration`: `9 am SF`, `until 5 pm`, `17m`, date math) is **pending** | Large grammar, unconfirmable details; time-at-place was prioritized because it is the visible daily-driver behavior. |
| Currency rates | Source `https://open.er-api.com/v6/latest/USD`, refreshed at most every 2 h (stale refreshes happen in the background on `calculate`; `refreshCurrencies` forces), cached at `%LOCALAPPDATA%\Openray\calculator-rates.json` (`{base:"USD", rates, fetchedAt}`); offline uses the cache; no cache → clear error `Currency rates unavailable offline` (intent recognized through a fixed ISO-4217 list, so the error fires even with an empty cache). Codes, symbols — prefix (`$500`, `€50`) and glued suffix (`100$`, `100€`) — compounds (`r$`, `us$`, `c$`, `a$`, `nz$`, `hk$`) and names/shorthand (`dol`, `dolar`, `dólar`, `dollar`, `euro`, `libra`, `real`, `reais`, `yen`, `iene`, …) all resolve to ISO codes — the answer and the Swap Units rewrite always carry the code | Raycast's rate source is account-bound (requires auth); the local-first rule allows a rate fetch. 2 h matches the confirmed refresh interval; the symbol positions and name variants are how people actually type conversions. |
| Answer formatting | `Intl.NumberFormat` with the system locale (maximumFractionDigits scaled to the value), plain rendering for non-finite; unit/currency conversions append the target symbol to the answer (`5 GB to MB` → `5,000 MB`) | Matches "separators come from the system locale" (confirmed); the unit on the answer string is the visible `evaluation.description` behavior of the shipped row. |
| Root row | Ephemeral root-search section `calculator`, 124 px split row, labels `Expression`/`Result`, third line for currency `Updated ...` / `Currency rates are out of date`, Enter = Copy Answer. Copy actions (Copy Answer, Copy Unformatted, Copy Question and Answer, Paste) get the launcher out of the way first — the window hides and the toast migrates to the HUD, matching Raycast's run-an-action-then-hide flow | Confirmed layout; the hide-on-copy flow is Raycast's standard action behavior. |
| History storage | `%LOCALAPPDATA%\Openray\calculator.sqlite`, table `calculator_history` (id, expression, answer, category, pinned_order, created_at); upsert on Copy/Paste actions and on search clear in the history view (same expression+answer bumps the timestamp instead of duplicating); cap 4096 (pinned survive); purge > 90 days on startup | Confirmed store semantics. |
| `Put Answer in Search Bar` | Sets the root search input to the answer text | Same effect as Raycast's `rootSearch.search(answer, ...)`. |
| `Swap Units` | Rewrite the expression `X from to|in target` ⇄ `X target to|in from` and re-evaluate (symbol-led amounts rebuild as `500 GBP in USD` so the rewrite re-evaluates) | Confirmed rewrite rule. |
| Settings rows | `REM/EM to Pixel Conversion` only | Color Conversion and Flight Tracker are separate extensions out of scope; Syntax highlighting is cosmetic and omitted. |
| Unformatted answer | `Copy Unformatted Answer` copies the raw numeric result without locale grouping | Raycast has a separate unformatted path; the formatted/unformatted distinction is the only observable contract. |

## Implementation status (this clone)

- Engine: `build/backend/src/calculator-engine.js` — tokenizer/parser/evaluator, units, currency,
  formatting; never throws; malformed input → no result. Verified by `build/backend/tests/calculator.test.mjs`.
- Backend handlers: `build/backend/src/calculator.js` — `calculate`, `swapUnits`, `refreshCurrencies`,
  `getPreferences`/`setPreference` (`remToPxRate`), and the history store
  `historyGetAll|Upsert|Delete|DeleteAll|historyPin|historyUnpin|historyMovePinnedUp|historyMovePinnedDown`
  with the 4096 cap and 90-day startup purge. Rate cache with the 2 h minimum interval and offline fallback.
- Placeholder wiring: `snippets.resolve` and quicklinks `open`/`resolve` now pass the engine's
  synchronous `calculateExpression` into `resolvePlaceholders`, so `{calculator expression=…}` resolves
  (previously it rendered "Invalid expression").
- Root search: the inline client-side evaluator was removed; `App.tsx` renders the confirmed 124 px
  split row (`Expression` → `Result` badges, currency third line) from `calculator.calculate`, with
  Enter = Copy Answer and the Ctrl+K action panel (Copy/Paste/Unformatted/Question and Answer/Put
  Answer in Search Bar/Swap Units/Pin/Show History/Refresh Currencies).
- History view: `build/frontend/src/CalculatorHistoryView.tsx`, reachable only through `Show History`
  (the calculator is not a searchable command — confirmed), with the live result row, confirmed
  sections/empty states, and the mirrored action set plus Copy Question / pin management / Delete All.
- Settings: Calculator page with `REM/EM to Pixel Conversion`, persisted in
  `calculator-settings.json` via `calculator.setPreference`.
- Tests: `build/backend/tests/calculator.test.mjs` — 23 tests (engine grammar/percentages/units/
  rem-em/currency incl. symbol amounts, suffix/compound symbols, name aliases and offline errors,
  time-at-place, history dedupe/pin/cap/purge, rate-cache interval/offline/stale-refresh,
  preference persistence). All green; all pre-existing suites remain green.
- Toast/HUD reliability: the HUD window's WebView2 initialization cannot complete while the HUD
  window has never been `Show()`n (no HWND), so the original `ShowHud` had two failure modes — its
  bounded 5 s wait for init let a payload be queued and then wiped by the init winner's reset
  (inconsistent first toast), and tightening that wait into a proper handshake deadlocked
  init ↔ Show entirely (no toast at all). `ShowHud` now shows the window *before* awaiting init;
  the payload is queued and delivered at the page's `hud:ready`, however long initialization takes.
  Copy actions also write through `clipboard.write` with the `content` field the host route reads.

## Implementation checklist

- [x] Engine module `build/backend/src/calculator-engine.js`: tokenizer, parser, evaluator,
      unit/currency conversion, percentage forms, answer formatting + input→output test table
      (single backend engine; the renderer calls `calculator.calculate` over IPC)
- [x] Rate fetch + cache module (2 h minimum interval, offline fallback, clear offline error) —
      `build/backend/src/calculator.js`
- [x] Root-search wiring: ephemeral split calculator row in `App.tsx` (section `calculator`,
      124 px row, third currency line), replacing the old inline client-side evaluator
- [x] Actions: Copy Answer / Paste Answer / Copy Unformatted / Copy Question and Answer / Put Answer
      in Search Bar / Swap Units / Refresh Currencies / Pin / Show History
- [x] Backend: `calculator.js` history store + namespace `calculator.*` (`historyGetAll|Upsert|
      Delete|DeleteAll|historyPin|Unpin|MovePinnedUp|MovePinnedDown`), 4096 cap, 90-day purge
- [x] History view with confirmed strings, live row, sections, actions
      (`build/frontend/src/CalculatorHistoryView.tsx`, opened by `Show History`)
- [x] Settings page: REM/EM to Pixel Conversion (persisted in `calculator-settings.json`)
- [x] Tests: `build/backend/tests/calculator.test.mjs` — engine cases (arithmetic, precedence,
      percentages, units, temperature, data sizes, currency with a stubbed rate table, rem/em,
      malformed input → no result), history store (upsert/pin/cap/purge), rate cache (interval,
      offline fallback)

## Manual test checklist

1. **Root row** — type `2+2*3` → row shows `2+2*3` → `8`; Enter copies the answer (toast `Copied
   answer to clipboard`) and the entry lands in history.
2. **Percentages** — `25% of 500` → `125`; `500 + 10%` → `550`; `50%` alone → `0.5`.
3. **Units** — `10 km to mi` → `6.213711922 mi`; `5 GB to MB` → `5,000 MB`; `100 °f to c` →
   `37.77777778 °C`; `90 min to h` → `1.5 h`.
4. **rem/em** — with `remToPxRate = 16`, `2rem to px` → `32`.
5. **Currency** — `100 usd to eur` → answer with the `Updated ...` third line; after
   `%LOCALAPPDATA%\Openray\calculator-rates.json` is deleted and the network is blocked, a clear
   offline error appears instead of a hang; with a stale cache present the stale rates are used.
6. **Malformed input** — `2+`, `foo bar`, `(` produce no calculator row (no crash, no eval).
7. **History** — `Show History` opens the view; live evaluation works in the search bar; Pin/Unpin
   and Delete All Entries (pinned preserved) behave as confirmed; entries older than 90 days vanish
   on restart (seed one by editing the sqlite file).
8. **Put Answer in Search Bar** — replaces the query with the answer; `Swap Units` rewrites the
   expression and re-evaluates.
9. **Currency variants** — `100 dol to eur`, `100 dólar to euro`, `100 dollars in reais`,
   `$500 in GBP` all convert; the answer carries the ISO code.
10. **Time at place** — `time in china` → the current time with `China` / `GMT+8` badges;
    `china time` matches; `time in new york` → `New York` / `GMT-4`; `time in atlantis` shows no
    row.
11. **Copy hides the launcher** — Enter or clicking the calculator row copies the answer, hides the
    window, and the `Copied answer to clipboard` toast shows in the HUD over the app behind.
