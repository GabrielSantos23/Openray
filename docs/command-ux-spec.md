# Raycast Command UX Spec — navigation, forms, alerts, detail, grid, list

Target: Raycast 2.4.0.0 (MSIX). Sources: extracted frontend chunks (`../artifacts/frontend/`),
the bundled extension API (`../artifacts/api/node_modules/@raycast/api/index.js`, referred to as
`api/index.js`), backend `../artifacts/backend/index.mjs`. The clone reference is `../build/`.

Tags: **[CONFIRMED]** = read directly from shipped code (chunk + minified name given).
**[INFERRED]** = deduced from code shape. **[DEFAULT]** = not observable in code; we chose a value.

Toast/HUD was reverse-engineered and implemented earlier; see `docs/toast-hud-spec.md` (out of scope here).

---

## 1. Navigation stack

### 1.1 Who owns what

Two stacks cooperate:

- **Extension side (Node worker)** — `api/index.js` `zg` (InternalNavigationRoot) keeps
  `useState({ routes: [{node, onPop}...], lastNavigationInfo: {action, id} })` and renders
  `<ray-navigation-stack navigationInfo={t.lastNavigationInfo} onPop={pop}>` with **all routes as
  children**. The model serializer (`iP`) ships only the **last** child (the top page) plus
  `navigationInfo` and the serialized `onPop` callback id.
- **Renderer side** — `main-window-g1Vb1JLY.js` `NQ` (NodeCommandViewContent) keeps
  `z.mainRouter.context.nodeExtensionStack`: an array of pages `{id, view}`. `IQ` (NavigationStack)
  renders the pages **reversed**, top page first with `isActive: true` — all pages stay mounted, which
  is what restores search text/selection on pop.

### 1.2 Actions (`navigationInfo.action`)

`push`, `pop`, `localPop`, `new`, `idle` **[CONFIRMED]**:

- `new` — initial render (`{action:"new", id:""}`); renderer pushes the first page.
- `push` — `useNavigation().push(node, onPop?)` (`Mw`): appends `{node: <InternalNavigationView key=id>, onPop}`,
  `lastNavigationInfo = {action:"push", id}`. Renderer: `nodeExtensionStack.push(...)` and remembers
  the assumed view kind.
- `pop` — `useNavigation().pop()`: pops the extension's last route (firing its `onPop` unless already
  popped for the same id), `lastNavigationInfo = {action:"pop", id}`. Renderer: `nodeExtensionStack.pop()`
  then **updates the new top page's view element** with the incoming body (case `pop` calls `AQ()` and
  `update({...e, view})`).
- `localPop` — renderer-initiated pop (Escape/Ctrl+[). Renderer `x()` generates a pop id
  (`pi()`), records `b.current = {id, action:"localPop"}` and calls the **extension's `onPop` callback**
  through `callNodeCallback`. The extension pops its routes with the same id
  (`zg`'s `n(i)` — `lastNavigationInfo = {action:"localPop", id:i}`), and the dedupe
  `w.navigationInfo.id === b.current?.id` rewrites the incoming action to `idle` so the renderer
  updates the top page in place **[CONFIRMED]**.
- `idle` — plain re-render of the current page: renderer replaces the top page's view
  (`case idle: update({...e, view})`) **[CONFIRMED]**.

`onPop` dedupe: both `zg` (`o.current !== i`) and `useNavigation` guard against firing the route's
`onPop` twice for the same pop id **[CONFIRMED]**.

### 1.3 Renderer-side pop triggers and restoration

**[CONFIRMED]** (`NQ`):
- A stack-length watcher (`C.current > l.length`) notices the renderer stack shrank (Escape/back
  handled by the router) and calls `x()` (localPop).
- Per-page view state: because pages stay mounted, filter text and selection live in each page's own
  components and are restored automatically when the page becomes active again. The command's search
  text is buffered per command in `S.current` (`bufferedValue`), seeded from `props.fallbackText`.

### 1.4 Keyboard

**[CONFIRMED]** `shortcuts-C1kqjDmf.js`: `goBack = Ctrl+[` (Windows; `goBackAlternative = Ctrl+Alt+Left`),
`goForward = Ctrl+]`, `popToRoot = Shift+Escape` (Windows; mac `Cmd+Escape`), `escape` = Escape.
Escape pops one page while a command is open and hides the launcher at root (existing behavior).

### 1.5 popToRoot

- Extension API: `popToRoot({clearSearchBar})` → RPC `popToRoot` (schema `{clearSearchBar}`)
  **[CONFIRMED]** (`api/index.js`, `U8`); backend forwards to renderer
  (`extensionHost.popToRoot`) **[CONFIRMED]** (`index.mjs` handler table).
- Renderer handler `Fne`: `await window.mainWindow.popToRoot({clearSearch: e.clearSearchBar})` **[CONFIRMED]**.
  This unwinds every open stack (all pages of the node extension stack are dropped) and optionally
  clears the root search text.
- `PopToRootType` (`Immediate`/`Suspended`/`Default`) also applies when the launcher hides; the
  "Pop to Root Search" setting (`disablePopToRootSearch` preference seen in `NQ`) governs the
  inactivity timeout **[CONFIRMED names, DEFAULT behaviour for the timeout]**.

### 1.6 Our clone decisions

- Renderer keeps `pages: {id, kind, body, actions, searchText, selectedItemId}[]` inside the command
  session. Top page active; previous pages unmounted (unlike Raycast we re-mount on pop and restore
  `searchText`/`selectedItemId` from the page record — same observable behavior, simpler state).
- `navigationInfo.action` drives: `push`/`new` → append page; `pop` → drop top page, apply body to
  new top; `localPop`/`idle` → replace top page body.
- Escape: if search text → clear text; else if pages > 1 → pop one (localPop round trip); else hide
  the launcher. Ctrl+[ pops one page directly. Shift+Escape pops to root.
- `extensionHost.popToRoot` → pages = [root page] (+ clear search per payload).
- When the launcher hides, the command session stack is cleared unless the session is still "active"
  — we follow the existing pop-to-root-timeout setting: hiding always clears the extension stack
  (matches "pop to root when launcher closes" default) **[DEFAULT: always clear on hide]**.
- Extension API additions: `useNavigation()` ({push, pop}), `Action.Push` already exists;
  `popToRoot` already exists.

---

## 2. Forms

### 2.1 Model (`ray-form-*` → kind)

**[CONFIRMED]** `api/index.js` converter (`b8` map + converter at `ray-form-textfield`):
- `ray-form` → `<ray-form navigationTitle isLoading enableDrafts>` + children `[searchBarAccessory, actions, ...fields]`.
- `ray-form-textfield` → `kind:"TextField"` (isSecure:false); `ray-form-passwordfield` → `kind:"TextField"` with `isSecure:true`.
- `ray-form-textarea` → `kind:"TextArea"` (+`enableMarkdown`).
- `ray-form-checkbox` → `kind:"Checkbox"` (`checkboxTitle` = the checkbox label, `title` = row label).
- `ray-form-dropdown` → `kind:"Dropdown"` with `menu: {sections: [{id,title,items:[{id,title,icon}]}]}` (Dropdown.Item id = `value`), `placeholder`, `throttlingEnabled`, `filteringEnabled`, `keepSectionOrder`.
- `ray-form-tagpicker` → `kind:"TagPicker"` with `suggestionValues` (from TagPicker.Item: `{title, value, icon}`), `onCreate`.
- `ray-form-datepicker` → `kind:"DatePicker"` with `type` ("date"|"datetime"), `min`/`max` ISO strings, date values ISO-encoded.
- `ray-form-filepicker` → `kind:"FilePicker"` with `canChooseFiles`, `canChooseDirectories`, `allowMultipleSelection`, `showHiddenFiles`; value = array of paths.
- `ray-form-separator` → `kind:"Separator"`; `ray-form-description` → `kind:"Description"` (+`text`).
- Every field carries: `id, title, info, error, autoFocus, value?, defaultValue?, placeholder?, onChange?, onBlur?, onFocus?` (callbacks as ids).

### 2.2 Renderer

**[CONFIRMED]** `main-window-g1Vb1JLY.js`:
- `eq` (FormItemsRenderer) is a switch on `t.kind` (`TextField` incl. password via `isSecure`,
  `Checkbox`, `FilePicker`, `Dropdown`, `TagPicker`, `DatePicker`, `TextArea`, `Description`,
  `Separator`). Field wrapper `XK` (FormField) shows label + `info` + `error`; inputs get
  `state:"error"`/`validity:"invalid"` when `t.error` is set — **validation is computed extension-side
  and travels in the model as `error`**.
- `nq` (NodeFormView): `<form onSubmit preventDefault>`, scroll container, nav bar shows
  `searchBarAccessory` as a link; focus restore when the form has focusable items.
- Events: onChange/onBlur/onFocus → `callNodeCallback(field.onChange, value)`; DatePicker onChange
  sends `{...event, value: ISO string}`; FilePicker onBlur/onFocus parse JSON arrays; Dropdown search
  term is stored under `id + "_search_term"`.
- Submit: **[CONFIRMED]** `CK` action builder — a `submit-form` action's handler does
  `storeFormValues(); clearDraft(); getFormValues() → callNodeCallback(onAction, values)`.
  Values shape `{[fieldId]: {type?: "date", value}}` (`js()` converts date entries back to `Date`
  extension-side).
- Form action shortcuts **[CONFIRMED]** (`CK` with `shouldAddShortcuts`): first action → if it is
  `submit-form`, shortcut `Ctrl+Shift`, else `Ctrl`; second action → `Ctrl+Shift` (or `Ctrl+Alt` if the
  first was submit). Form action panels carry these shortcuts only when `changes.actionPanel` is set.
- `formReset` / `formSetFocus` RPC: `{itemId}` **[CONFIRMED]** (schema + `pt()` imperative handle:
  `focus()` → `formSetFocus`, `reset()` → `formReset`). `formReset` clears the field's value in the
  renderer store; `formSetFocus` moves focus to the field.

### 2.3 Drafts

**[CONFIRMED]**: `<Form enableDrafts>` exists (api default **false**). Renderer
`ES` = `FormDraftsStore` `{drafts: {}}` persisted via `ipc.backend.userDefaults.set`
(localStorage-backed). Draft record: `{id: uuid, commandId, routePath, routeSearch, values, summary
(field values joined with " • ", truncated to 80 chars), savedAt}`. On load with a `draftId` search
param, saved values are injected as `props.draftValues` (JSON string); forms read them into initial
state and `discardDraft` on clear. `hasDraft`/`clearDraft` exposed to the form.

### 2.4 Our clone decisions

- Field kinds implemented exactly as the wire model above (TextField w/ isSecure, TextArea, Checkbox,
  Dropdown, TagPicker, DatePicker date+datetime, FilePicker, Separator, Description).
- Validation: extension-side `error` prop per field (red state + message under the field); required
  fields gate submit (submit action disabled while a field with `error` present — **[DEFAULT]**).
- `onChange` fires immediately per keystroke (throttled 120ms **[DEFAULT]** — Raycast throttles
  `throttlingEnabled` search/onChange callbacks; exact interval not observed); onBlur/onFocus with the
  field value.
- `formSetFocus`/`formReset` handled by the renderer by field id.
- Drafts: per command+form draft in localStorage keyed by commandId, saved on change (debounced),
  restored when the command relaunches; cleared after successful submit (Raycast semantics
  **[INFERRED]** from `clearDraft()` in the submit path).
- Submit via action panel: first submit-form action gets `Ctrl+Shift`, plain `Enter` also submits
  (**[INFERRED]** from Raycast's action-bar Enter behavior); values passed as
  `{[fieldId]: value}` with dates as ISO strings.

---

## 3. Alerts

**[CONFIRMED]** `api/index.js`:
- `Alert.ActionStyle = {Default:"default", Cancel:"cancel", Destructive:"destructive"}` (`Xs`).
- `confirmAlert(options)` → `Promise<boolean>` (`LC`): defaults primaryAction title **"Confirm"**,
  dismissAction title **"Cancel"**; resolves `true` on primary, `false` on dismiss. `MC` (Alert class)
  sends `showAlert {title, message?, icon?, primaryAction?{title, style}, dismissAction?{...}}` and
  registers callbacks `alert_<id>_onPrimaryAction` / `alert_<id>_onDismissAction`.
- Wire schema (`showAlert`): `{title, message?, icon?, primaryAction?{title, style?, onAction}, dismissAction?{...}}`.
- Backend forwards to renderer (`extensionHost.showAlert`).

**[CONFIRMED]** renderer (`main-window-g1Vb1JLY.js` `Une` + `window-shell-hosts-EYbE8QAm.js`):
- Handler routes to owner window or `alertStore.open({iconNode, title, description: message,
  primaryAction: {variant, title, action → callNodeCallback(primaryAction.onAction)}, dismissAction: {...}})`.
- `gn` (Alert component): props `{icon?, title, description?, primaryAction?, secondaryAction?,
  dismissAction?, buttonLayout?, textField? {label, placeholder, defaultValue, validator, password?,
  accessory?}, rememberUserChoice?}`.
  - Buttons: primary `variant:"primary"` (accent fill), secondary colored text, dismiss per variant;
    destructive style = red. Layout horizontal unless (primary&&secondary) or neither or a title is
    longer than 13 chars → vertical.
  - Optional text field with validator gating the primary button, and a
    "Do not show this message again" checkbox (`rememberUserChoice`).
  - Focus: text field first (select-all) else panel; previous focus restored on close.
  - Keyboard: document-level matcher `ie([primary, secondary, dismiss], event)` runs the action whose
    shortcut matches the keystroke; Tab is swallowed. Shortcuts come from `alert-utils-CDcEvLSx.js`
    `t(alert, close)`: primaryAction → `Ctrl` (win), secondaryAction → `Ctrl+Shift`, dismissAction →
    `Escape` (title "Cancel" default; when there is no primary/secondary the dismiss becomes the
    primary-styled button with shortcut `[Ctrl, Escape]`).
  - `softClose()` = 50ms delayed close so a replacement alert doesn't flicker (`alert-store`, `o=50`).
  - If the launcher window is not active, `open()` first brings the main window up
    (`ipc.host.raycast.showMainWindow({})`).
- Result channel: the extension's confirmAlert promise resolves via those callbacks — the renderer
  calls `callNodeCallback({sessionId, callbackId})`; **no boolean value travels back**, only which
  callback fired.

### Our clone decisions

- `AlertHost` in the renderer: single-slot store (mirrors `alert-store-Bwt5kwst.js`), softClose 50ms,
  dialog overlay with title/description/icon, buttons Confirm (accent) / Cancel; `style:
  "Destructive"` renders the primary red; `style: "Cancel"` renders dismiss accent when no primary.
- Keyboard: Enter → primary, Escape → dismiss (also closes when clicking the overlay).
- Result: call `primaryAction.onAction` or `dismissAction.onAction` callback ids; extension-side
  `confirmAlert` resolves true/false and returns the value to the worker (`nativeCallback` round trip).
- Optional `textField` (label/placeholder/password/validator) and checkbox supported.
- If the launcher is hidden when an alert arrives, the host is asked to show the window first.

---

## 4. Toasts / HUD

Already reverse-engineered and implemented — see `docs/toast-hud-spec.md` (§7 lists implementation
status). Not part of this task (user decision, 2026-10-10).

---

## 5. Detail

**[CONFIRMED]** `api/index.js`: `<Detail markdown navigationTitle isLoading>` +
`Detail.Metadata` → `ray-metadata`; `Metadata.Label {title, text?, icon?}`,
`Metadata.Link {title, text?, target}`, `Metadata.TagList {title}` + `Item {text, icon?, color?,
onAction?}`, `Metadata.Separator`. `List.Item.Detail` exists too (`ray-list-item-detail` with
`markdown` + metadata) for the List detail pane.

**[CONFIRMED]** renderer (`main-window-g1Vb1JLY.js`):
- `DK` (NodeDetailView): markdown via `Pp` with a custom `img` component (`sH` — proxied image
  loading); the first `# ` heading is extracted (`EK`, regex `/^\s*#\s+(.+?)(?:\n|$)/`) and shown in
  the nav bar only while scrolled out of view (IntersectionObserver threshold 1, 250ms fly-in);
  metadata pane on the right with `layout:"narrow"`.
- `_K` (NodeMetadata): renders item kinds `Label | Link | TagList | Separator`; TagList as
  `NodeTagItem` pills (flex-wrap, `gap: var(--space-4)`, justified end in wide layout); Link renders
  `<a href>` with an arrow-ne icon. Layout primitives from `data-list.namespace-DYTt4U39.js`
  (`DataList.Root/Items/Item/Label/Value/Separator`, label = small-text secondary `<dt>`,
  value = truncated `<dd>`).
- `CommandListItemAccessory` (`command-list-item-accessory-Bd5W6oi2.js`): accessory
  `{icon?, text?, tag?, date?, color?, tooltip?}` — tag renders as a colored pill
  (`var(--color)/20%` background), a numeric tag is formatted as a date; date renders as formatted
  date with color; text colored `color` or secondary.

### Markdown

**[CONFIRMED]** Raycast renders markdown with a full component pipeline (`markdown-BLthXIVh.js`,
455KB — a bundled markdown renderer with syntax highlighting) inside the scroll container, custom
`img` handling. Headings, lists, tables, code blocks, images, links all supported.

### Our clone decisions

- Metadata pane on the right of Detail (wide label/value rows, separators, links open via host
  `system.openUrl`, tag pills with color mapping: known color names → CSS tokens, hex → 20% alpha bg).
- Markdown: replace the line-based fake parser with a real renderer. We vendor `marked` (small, no
  runtime deps) + escape HTML, render into the scroll container with CSS matching Raycast's dark
  markdown styles (headings, lists, tables, code blocks, images via `<img>` with max-width). Titles:
  first `# ` heading mirrors into the nav bar (scroll-aware is **[DEFAULT]** — we show it statically
  on Detail pages).
- `List.Item.Detail` (isShowingDetail pane) renders markdown + metadata in the right pane.

---

## 6. Grid

**[CONFIRMED]** `api/index.js`:
- `<Grid columns itemSize aspectRatio fit inset ...>`; `Grid.ItemSize = {Small:"small",
  Medium:"medium", Large:"large"}` (`jC`), `Grid.Inset = {Zero:"zero", Small:"sm", Medium:"md",
  Large:"lg"}` (`qC`), `Grid.Fit = {Contain:"contain", Fill:"fill"}` (`WC`), columns clamped
  `{min:1, max:8}` (`JC`).
- `Grid.Section {title, subtitle, columns?, aspectRatio?, fit?, inset?}` (per-section overrides),
  `Grid.Item {id, title, subtitle, keywords, accessory (icon), content (image), quickLook}`.
- Items placed without a section are wrapped in an implicit section `__raycast_implicit_section_N`.
- Search/filter/pagination props identical to List (`throttle`, `filtering`/`enableFiltering`,
  `onSearchTextChange`, `pagination {pageSize, hasMore, onLoadMore}` with the worker heap guard that
  refuses further pages near `maxOldGenerationSizeMb`).

**[CONFIRMED]** renderer (`Aq` = NodeGridComponent):
- Section defaults: `columns = section.columns ?? root.columns ?? 5`, `aspectRatio ?? "1"`,
  `fit ?? "contain"`, `inset ?? "zero"`.
- Empty view rendered when no items; empty views can carry actions (`NodeEmptyView`).
- Keyboard: 2D navigation over the virtualized grid via the shared selection store (`Hr`/`update`
  with `{sections, options {preserveSelection, selectedIdHint, scrollAlignment}}`); paging via
  `onEndReached` (threshold `kq = 80` px), `onLoadMoreItems` → callback.

### Our clone decisions

- Grid renderer with sections (each with its own columns/aspect/inset/fit), item cells 22px-icon
  style (image content or icon + title/subtitle), keyboard: Left/Right move within a row, Up/Down
  move a row (column-count aware), Home/End jump; Enter runs primary action, Ctrl+K opens action
  panel.
- Pagination: `pagination.pageSize` honored; when the last visible item is within 80px of the bottom
  and `hasMore`, fire `onLoadMoreItems` (**[INFERRED]** threshold value `kq=80` read from bundle).
- Empty view with actions supported.

---

## 7. List

**[CONFIRMED]** `api/index.js`:
- `<List>` props: `searchBarPlaceholder, filtering/enableFiltering, throttle, navigationTitle,
  isLoading, searchText, onSearchTextChange, onSelectionChange, selectedItemId, isShowingDetail,
  pagination, searchBarAccessory` (+ `enableDrafts` not on List). Children: `List.Item`,
  `List.Section {title, subtitle}`, `List.EmptyView {icon, title, description}` (actions allowed
  inside), `List.Dropdown` (search-bar accessory dropdown → `ray-search-bar-dropdown` with sections
  like Form Dropdown).
- `List.Item {id, title, subtitle, keywords, icon, accessoryIcon, accessoryTitle, accessories,
  quickLook}` + optional `List.Item.Detail {isLoading, markdown, metadata}` rendered only for the
  **selected** item (`qc(t)` gate).
- Model: `{throttle, filteringEnabled, keepSectionOrder, itemsPerPage: pagination.pageSize,
  hasMoreItems: pagination.hasMore, isShowingDetail}`.

**[CONFIRMED]** renderer (`Nq` = NodeListComponent):
- Native filtering: `_q(sections, searchTerm, keepSectionOrder, rootSearchSensitivity)` — per-item
  match over title/subtitle/keywords with the same ranking family as root search (normalize →
  `Rr` match → threshold `ni` → sort `Cq`: exact title first, exact subtitle, weight, match length,
  stable index). With `keepSectionOrder` sections keep position and just lose non-matching items;
  otherwise the flat match regroups by section (empty sections disappear).
- Detail pane: `isShowingDetail ? showDetails() : hideDetails()`; right pane shows
  `detail.markdown` (with border when metadata present) and/or `detail.metadata` (`NodeMetadata`).
- Selection: `selectedItemId` carries `{value, eventCount}` to arbitrate extension-set vs user
  selection; `onSelectionChange` receives `{value: itemId, eventCount}`.
- Empty view with actions; pagination identical to Grid (`endThreshold: 80`).
- Accessories rendered via `CommandListItemAccessory` (see §5).

### Our clone decisions

- List renderer: sections + subtitle + keywords filtering (reuse the root-search matcher on
  item title/subtitle/keywords with the current sensitivity), `keepSectionOrder` honored
  (**[DEFAULT]** true when prop set), accessories (text/tag/date/icon with color), empty view with
  actions, item Detail pane (markdown + metadata) toggled by `isShowingDetail`, List.Dropdown as a
  dropdown control in the search bar row.
- `onSelectionChange` fires with `{value, eventCount}`; `selectedItemId` sets selection.
- `throttle: true` (default) throttles `onSearchTextChange` at 120ms (**[DEFAULT]** interval).

---

## 8. Wire contract summary (what we implement)

Renderer push methods (host → renderer, `module:"frontend"`):
`extensionHost.render {renderTree, gzipped, sessionId}`, `renderEmpty`, `renderSuspense`,
`showAlert`, `showToast`, `hideToast`, `showHUD`, `popToRoot {clearSearchBar}`,
`clearSearchBar {forceScrollToTop}`, `closeMainRaycastWindow`, `commandException`,
`openCommandPreferences`, `openExtensionPreferences`.

Renderer → backend requests: `extensionHost.loadCommand`, `unloadEntryPoint`,
`callNodeCallback {sessionId, callbackId, data}`.

All **[CONFIRMED]** from `index.mjs` handler tables + `main-window-g1Vb1JLY.js` `Qne` table.
