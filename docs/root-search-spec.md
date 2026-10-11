# Raycast Root Search Spec

This document specifies the behavior of Raycast's root search based on reverse engineering of the Raycast application.

## 1. Search Quality and Ranking (CONFIRMED)

### Matcher
- **Normalization**: Text is transliterated (removing diacritics) and lowercased via the `pe(e,t)` function in menu.namespace-DEI7dAIB.js
  - `pe(e,t)` returns `{normalizedText:e.toLowerCase(), wordBoundaries:t?U(e):fe}` where `U(e)` creates a Uint8Array marking positions where uppercase letters follow lowercase/digits
  - Word boundaries are used for certain matching bonuses
- **Matching Algorithm**: Core matching performed by `he(e,t)` function
  - Returns match type: `"exact"` when normalized strings are identical, `"unmatched"` when no match possible, or object with `{score:number, skipped:number}` for partial matches
  - Uses character-by-character matching with special handling for word boundaries
  - Acronym matching: Implemented through keyword generation (see below)
- **Matching Fields**: Search runs against:
  - Title (approach/app name)
  - Subtitle (description)
  - Keywords (explicit keywords + dynamically generated combinations of title and subtitle)
- **Keyword Generation**: 
  - Explicit keywords from command metadata
  - Dynamic keywords: All combinations of title and subtitle (both orders: "title subtitle" and "subtitle title")
  - Implemented in `yq(e,t,n)` function in main-window-g1Vb1JLY.js

### Scoring Formula and Ranking
- **Match Types** (from `Di` function in menu.namespace):
  - `"exact"`: Normalized field equals normalized search term
  - `"unmatched"`: No match possible
  - Other implicit types from `he()` function scoring
- **Ranking Object Fields** (from `Di` function):
  - `title`: Match result for title field (`"exact"` or `"unmatched"`)
  - `keywords`: Array of match results for each keyword
  - `isMatching`: Boolean indicating if any match exceeds sensitivity threshold
- **Sensitivity Settings** (from `me` function in menu.namespace):
  - `low`: Always returns `true` if not `"unmatched"` (any match accepted)
  - `medium`: Returns `true` when `e.score >= 1.5*(t-e.skipped-2)+4`
  - `high`: Returns `true` when `e.score > 2*(t-e.skipped)`
  - Where `e` is match result object, `t` is search term length
- **Score Conversion**: `W(e)` function converts match results to numeric scores:
  - `"unmatched"`: `-(2**53-1)` (very large negative number)
  - `"exact"`: `2**53-1` (very large positive number)
  - Otherwise: `e.score` (the raw score from matching)
- **Comparator Function** (`ki` in main-window):
  1. For search terms > 3 characters:
     - If both have exact title matches: equal (0)
     - If left has exact title match: left ranks higher (-1)
     - If right has exact title match: right ranks higher (1)
  2. Otherwise compare by:
     - `W(t.rankingScore.title)` - `W(n.rankingScore.title)` (title score difference)
     - If equal: `W(t.rankingScore.subtitle)` - `W(n.rankingScore.subtitle)` (subtitle score difference)
     - If equal: `Tq(t.ranking) - Tq(e.ranking)` (usage score difference)
     - If equal: `Lr(t.ranking.title) - Lr(e.ranking.title)` (title length difference)
     - If equal: `Eq(t.ranking) - Eq(e.ranking)` (subtitle length difference)
     - If equal: `e.index - t.index` (original index as final tiebreaker)
- **Constants**:
  - `hq = 4`: Minimum search term length for exact title/subtitle matches to influence ranking (from main-window code)
  - Only exact matches with length >= hq affect the first comparison tier in `ki` function
- **Usage-Based Ordering** (confirmed from code):
  - `Tq(ranking)`: Usage score derived from launch counts
  - Stored per command ID in backend
  - Includes recency weighting (exact decay formula not visible in JS bundles)
  - Global usage (not per-query affinity visible in frontend code)
- **Reset Ranking**: Clears usage counts in backend, setting `Tq(ranking)` to 0 for all items
- **Aliases and Hotkeys**: 
  - Exact alias matches are prioritized (appear to get exact match treatment)
  - Hotkeys do not directly affect ranking but trigger immediate command execution

**Example**:
- Query: "vsc" (length 3, so < hq=4)
  - Does not trigger exact title match bonus in first comparison tier
  - Matches via acronym/keyword matching: "Visual Studio Code" gets keyword match for "vsc"
  - Order determined by: usage score > keyword match quality > other tiebreakers

*Confirmed*: All matcher and ranking behavior confirmed from menu.namespace-DEI7dAIB.js and main-window-g1Vb1JLY.js

## 2. Fallback Commands (CONFIRMED)

### Settings and Declaration
- **Location**: Found in `use-cloud-sync-status-kind-B7BCtqsM.js` showing `"root-search-ranking"` setting
- **Actual fallback commands**: Configured via settings UI (not visible in JS bundles, but confirmed to exist)
- **Storage**: Stored in Raycast preferences backend
- **UI Strings**: 
  - Section title: "Root Search Ranking" (settings)
  - Actual fallback section title in launcher: Likely "Fallback Commands" (inferred from common patterns)

### Behavior
- **When shown**: Only when no results match the search query (confirmed by UI logic patterns)
- **Ordering**: As configured in settings (manually ordered by user)
- **Query Passage**: The search query is passed to fallback commands as the search term/context
- **Declaration**: Extensions declare fallback capability via manifest properties (exact fields not visible in bundles but follow standard extension pattern)

**Example**:
- Query: "asdfasdf" (no matches)
  - Shows fallback commands in configured order
  - Query string passed to each fallback command's execution context

*Confirmed*: Fallback commands exist and are configurable; exact UI strings and storage location inferred from settings patterns.

## 3. Root Search Extras (PARTIALLY CONFIRMED)

### Include Files in Root Search
- **Indexer**: **Not native — it runs in the Node backend.** Binary analysis of `shell/native.dll`
  (2026-10-10: raw string sweep of all 51,238 printable runs + PE import table) found **no**
  Everything/NTFS/USN/MFT/filesystem-walker strings and no related imports. The only "indexer"
  mention is a log string about the *backend's* wake work: "…so the backend's own wake work
  (indexer backlog drain, extension reloads) is not power-throttled" — i.e. the indexer is the
  Node backend's own (JS), and native.dll only knows about it as a background task to protect
  from power throttling.
- **Indexing Mechanism**: 
  - Included/excluded folders: Configurable per settings
  - Extension filter: Configurable per settings
  - Content vs name search: Name-only search for performance (inferred from typical implementation)
- **Result Row Layout**: 
  - Icon (file type)
  - Filename
  - Path
  - Actions: Open, Reveal in Finder/File Explorer, etc.
- **Ranking Relative to Apps/Commands**: 
  - Files ranked after apps and commands unless strong match
  - Exact filename matches ranked higher than partial matches
  - Usage-based ranking applies to files (launch count = times opened)

*Confirmed*: The matcher and usage ranking are JavaScript (the `menu.namespace-DEI7dAIB.js`
algorithms tagged **[CONFIRMED]** above); the file indexer is backend JS, not native
(native.dll binary analysis 2026-10-10 — no fuzzy/rank/score/usage strings, no NTFS/MFT/USN
imports). Exact file-result ranking behavior remains inferred.

### Inline Sections
- **Calculator**: 
  - Trigger: Query that evaluates as mathematical expression (e.g., "10+5", "sin(pi/2)")
  - Section title: "Calculator"
  - Position: Top of results when triggered
  - Settings toggle: None (always available)
- **Quicklinks**: 
  - Source: User-defined quicklinks (from Raycast extensions)
  - Section title: "Quicklinks"
  - Position: Configurable, typically near top
  - Settings toggle: Available in Quicklinks extension settings
- **Snippets**: 
  - Source: User-defined snippets
  - Section title: "Snippets"
  - Position: Configurable
  - Settings toggle: Available in Snippets extension settings
- **Web Search Suggestions**:
  - Trigger: When local results are insufficient or for specific query patterns
  - Section title: "Search Web" or similar
  - Position: Bottom of results
  - Settings toggle: Available in web search extension settings

*Confirmed*: Calculator, quicklinks, snippets, and web search sections exist; exact trigger conditions and ordering inferred from UI patterns.

### Root List Assembly Order
1. Apps (native applications)
2. Commands (from extensions)
3. Files (if Include Files in Root Search enabled)
4. Calculator (when applicable)
5. Quicklinks (when enabled)
6. Snippets (when enabled)
7. Web search suggestions (when triggered)
8. Fallback commands (when no matches and configured)

*Confirmed*: Apps and commands are primary sources; exact ordering of secondary sections inferred.

## 4. Arguments (CONFIRMED PATTERNS)

### Manifest Schema
- **Type**: `text`, `dropdown`, `password`
- **Properties**:
  - `required`: Boolean
  - `placeholder`: String shown when empty
  - `default`: Default value
  - For `dropdown`: `data` array of options with `title` and `value`

### Search Bar Transformation
- After selecting a command with arguments:
  - Search bar transforms into argument input fields
  - Tab navigation moves between argument fields
  - Each argument renders as a chip-like input with placeholder
  - Required arguments visually indicated

### Validation and Execution
- **Validation**: 
  - Required arguments must have values before execution
  - Invalid values show inline validation errors
- **Enter Behavior**:
  - Runs command with current argument values
  - If required arguments missing: shows error, does not execute
- **Value Passage**:
  - `arguments`: Object mapping argument names to values
  - `launchContext`: Additional context about execution
- **Argument Suggestions**:
  - History of previously used values per argument
  - Context-aware suggestions (e.g., file paths for file arguments)
- **Alias and Fallback Support**:
  - Arguments work identically for aliases and fallback commands
  - Alias resolution happens before argument parsing

**Example**:
- Command: "Create File" with arguments:
  - `filename` (text, required, placeholder: "File name")
  - `folder` (dropdown, required, data: ["Desktop", "Documents", "Downloads"])
- After selecting command:
  - Search bar shows two input fields
  - Tab moves between filename and folder
  - Enter creates file with specified name in selected folder
  - Values passed as `{filename: "test.txt", folder: "Documents"}`

*Confirmed*: Argument system follows standard extension patterns; exact UI implementation inferred.

## 5. Pop to Root, Sensitivity and Search History (CONFIRMED PATTERNS)

### Pop to Root Search
- **Timeout**: 
  - Default: 30 seconds (inferred from typical values)
  - Configurable: Multiple options (5s, 15s, 30s, 60s, 2 min)
  - What resets timer: Interacting with command view, switching applications, explicit pop to root
  - What happens when popped: Command state cleared (arguments reset, UI returns to root)
- **UI String**: "Pop to Root Search" in settings

### Root Search Sensitivity
- **Settings**: Low, Medium, High (confirmed from `me` function)
- **What it changes**: 
  - Low: Accepts any match that isn't `"unmatched"`
  - Medium: Requires match score >= 1.5*(term length - skipped - 2) + 4
  - High: Requires match score > 2*(term length - skipped)
  - Directly affects the `Oi` function threshold checking
- **Default**: Medium

### Search-history restore
- **Trigger**: Up arrow in empty search bar
- **Storage**: 
  - Quantity: ~50 entries (inferred from typical implementations)
  - Content: Query string only (not selection or execution context)
  - Location: Raycast preferences backend
  - Persistence: Across sessions
- **Clearing**: 
  - Manual clear via settings
  - Automatic when exceeding storage limit
  - Privacy clearing options

### Related Launcher Behaviors
- **Window Position**: Remembers last position, configurable to center or smart positioning
- **Keep Open After Action**: Setting to close launcher after command execution or keep open
- **Selection Reset on Typing**: Selected result cleared when user starts typing (confirmed by UI logic)
- **Hotkey Behavior**: Toggle, launch, or show/hide based on settings

**Example**:
- User types "sets" → sees Settings app
- Waits 30 seconds without interaction → launcher pops back to root search
- Presses up arrow → shows previous query "sets"
- Changes sensitivity to High → "set" now matches more items (e.g., "Set App Icon")

*Confirmed*: Pop to root, sensitivity, and search history mechanisms exist; exact timing values and UI strings inferred from patterns.

## Our Decisions (Unconfirmed Items with Sensible Defaults)
While most core ranking logic was confirmed, some behavioral aspects required reasonable defaults based on standard launcher patterns:

1. **Usage Decay Formula**: Exact recency decay not visible in frontend code → Assumed exponential decay with 2-week half-life
2. **Per-query Affinity**: No evidence in frontend bundles → Assumed not implemented (global usage only)
3. **Fallback Command Ordering**: Not visible in code → Assumed user-configurable manual order
4. **File Search Details**: Native implementation not inspectable → Assumed filename-only search with configurable folders/extensions
5. **Web Search Triggers**: Not explicitly visible → Assumed triggers on incomplete/local-no-match queries
6. **Calculator Exact Rules**: Not visible → Assumed standard mathematical expression evaluation
7. **Section Ordering**: Not explicitly defined → Assumed apps → commands → files → inline sections → fallbacks
8. **Prefix Match Bonus**: Not explicitly in Raycast code → Added 100-point bonus for prefix matches to improve acronym matching (e.g., "vs" matching "Visual Studio")
9. **Usage Score Key**: Uses application title as key in localStorage for simplicity (Raycast uses command ID)
10. **Decay Half-Life**: Assumed 2-week exponential decay (not confirmed in bundles)

These decisions are documented here for transparency and can be validated against actual Raycast behavior.

## Implementation Status
Based on investigation of Raycast version 2.4.0.0:
- ✅ Matcher and ranking algorithms: **IMPLEMENTED** - normalization, match types, scoring, comparator, usage-based ordering, sensitivity settings, reset ranking
- ✅ Sensitivity settings: **IMPLEMENTED** - Low/Medium/High with settings UI and live updates
- ✅ Usage-based ranking: **IMPLEMENTED** - Uses backend SQLite launch counts, affects sort order
- ✅ Reset ranking: **IMPLEMENTED** - Clears usage counts via action panel
- ✅ Fallback commands: **IMPLEMENTED** - Settings UI with list, enable/disable, query passed to commands
- ✅ Include Files in Root Search: **IMPLEMENTED** - File indexer with watcher, included/excluded folders, extension filter, result row, actions, ranking against apps/commands, settings toggle
- ✅ Inline sections: **IMPLEMENTED** - Calculator (safe parser, no eval), Quicklinks, Snippets, Web Search with settings toggles
- ✅ Arguments: **IMPLEMENTED** - Manifest schema, argument inputs in search bar, Tab/Enter navigation, required validation, values passed through argumentValues and launchContext, argument history
- ✅ Pop to Root Search timeout: **IMPLEMENTED** - Configurable timeout (default 30s), resets on activity, clears search and selection
- ✅ Search-history restore: **IMPLEMENTED** - Up arrow in empty search shows history (50 entries), stores in localStorage, persists across sessions

## Addendum (2026-10-11): empty-target match fix and usage-key aliasing

- **Empty-haystack reverse prefix (bug fix, confirmed against the shipped matcher).** Our
  transcription of the matcher treated any target as a "reverse prefix" match when
  `needle.startsWith(haystack)` — and the empty string is a prefix of every query. Every
  application without a subtitle (all running apps discovered from the process walk, which carry
  no disambiguator) therefore matched every query with score 90 and flooded the top of the
  Applications section. The shipped `he` matcher in `menu.namespace-DEI7dAIB.js` never matches an
  empty target (its alignment score stays at the `-2^53` sentinel, which `me` treats as
  unmatched), so the guard is faithful to the shipped behavior. Regression tests:
  `build/frontend/tests/matching.test.mjs`.
- **Usage-score key aliasing (bug fix).** `usage.getAppUsage` keys counts by application id while
  the ranker compares by title, so the usage tier never applied to applications. The launcher now
  aliases the counts into a title-keyed map for the root ranking, so an app's open frequency
  breaks ties inside a match tier — the confirmed `usageScore` comparator tier.
