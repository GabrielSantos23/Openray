> **ARCHIVED (FlowKey migration M2, 2026-10-14):** the Raycast Store was removed; extensions come from the FlowKey library (see flowkey-migration-plan.md). Kept for reference.

# @raycast/api coverage in Openray

Source of truth: official `@raycast/api@2.7.3` npm package, `types/index.d.ts` (9,712 lines) — the complete public surface. The `llms-api.txt` / `llms-utils.txt` files referenced in the task no longer exist upstream (the `gh-pages` branch is gone; raw URLs 404 as of 2026-10-11), so the type definitions are the API-docs source used. Statuses reflect Phase 2 (Store) completion, 2026-10-13.

Statuses:

- **supported** — implemented in `build/api` through the real renderer/nativeCallback path, no mock involved.
- **partial** — implemented subset, or implemented with a named limitation.
- **missing** — not implemented. Exported and throws `UnsupportedApiError` when called.
- **out-of-scope** — declared unsupported by task policy (AI, OAuth, BrowserExtension, WindowManagement, menu-bar commands, tools). `environment.canAccess` answers **false** for these; direct calls throw.

**Runtime failure policy for missing/out-of-scope**: every missing/out-of-scope symbol is exported and throws `UnsupportedApiError` (typed error carrying the call name, extension name and command name) when called; the constructor also reports itself to the host over the `commandException` channel, which renders a failure toast naming the extension and logs it. Nothing returns fake/empty results and nothing is sent anywhere.

## Top-level exports

| Export | Status | Notes |
|---|---|---|
| `Action` | supported | `makeAction` variants + `Action.Style`. Namespace members below. |
| `Action.CopyToClipboard / Open / OpenInBrowser / ShowInFinder / Paste / Push / SubmitForm` | supported | Rendered through ActionPanel; callbacks via nativeCallback. |
| `Action.CreateQuicklink` | supported (partial data) | Creates a quicklink through the quicklinks backend store; fields limited to Title/Link/Open With (clone's quicklink model). No mock. |
| `Action.CreateSnippet` | supported (partial data) | Creates through the snippets store; snippet placeholder grammar limited to the clone's engine. |
| `Action.OpenWith` | supported | Host `shell.openWith` route; done in Phase 2. |
| `Action.Trash` | supported | Host `fileSystem.moveToTrash` route; done in Phase 2. |
| `Action.ToggleQuickLook` | missing | Throws `UnsupportedApiError` (decided in Phase 2; the Windows QuickLook path differs). |
| `Action.PickDate` | missing | Throws `UnsupportedApiError`. |
| `Action.InstallMCPServer` | out-of-scope | Throws. |
| `ActionPanel` (+`.Item`, `.Section`, `.Submenu`) | supported | Clone's Ctrl+K ActionPanel with groups/submenus. |
| `ActionPanelItem` / `ActionPanelSection` / `ActionPanelSubmenu` | supported | Deprecated aliases exported since Phase 2. |
| `AI` (`.ask`, `experimental_decide`, `refreshModels`, `betterAIModels`, `AI.Style`) | out-of-scope | Phase 2 removed the old no-op stub (a `completePrompt` request no handler ever answered — the prompt never left the machine, the promise always rejected). Now `canAccess(AI)` → false and `AI.ask` throws `UnsupportedApiError`; `betterAIModels` carries the shipped model list for `canAccess`. Nothing is routed to any AI service. |
| `Alert` (`.ActionResult`, `.Options`, `.ActionStyle`) + `confirmAlert` | supported | Promise-based, styles Default/Cancel/Destructive (command-ux-spec §alerts, implemented). |
| `BrowserExtension` | out-of-scope | Namespace present, every method throws; `canAccess(BrowserExtension.dangerously)` → false. |
| `Cache` | supported | In-memory LRU with byte capacity, official `get/set/remove/clear/contains/isEmpty/subscribe` (real change notifications; `subscribe` is an instance property because `@raycast/utils` passes it unbound to `useSyncExternalStore`). Disk persistence (`directory`) is accepted-and-ignored — a named limitation, not a mock. |
| `clearSearchBar` | supported | `rootSearch: clearSearchBar` route exists. |
| `Clipboard` (`.copy`, `.read`, `.clear`) | supported | Native clipboard routes; `.read` returns `{text, file?, html?}` per host capability; `content` File objects partial. |
| `Clipboard.paste` / `pasteText` | supported | Host `paste` route (paste-into-frontmost implemented for clipboard history). |
| `closeMainWindow` | supported | |
| `Color` | partial | The 12 hex constants the clone ships; `Color.Dynamic` missing (throws on use). |
| `Detail` (+`Detail.Metadata`, `Label`, `Link`, `TagList`, `Separator`) | supported | |
| `environment` | supported | All official fields present: `launchType`, `commandMode`, `launchContext` added in Phase 2. `canAccess` implements the real routing (store-spec §5): AI / betterAI models / BrowserExtension / WindowManagement → the worker flags (all false in the clone); anything else → true. `appearance` fixed "dark". |
| `Form` (+ all 9 field kinds, `Form.Dropdown.Item/Section`) | supported | Error validation extension-side, submit values map (command-ux-spec §forms). |
| `getApplications` | supported | C# Applications.cs scan. |
| `getDefaultApplication` | missing | No host route exists; throws `UnsupportedApiError` (decided Phase 2 — a fabricated answer would violate the no-fake-data policy). |
| `getFrontmostApplication` | missing | The old stub returned a fake "Openray" application; removed in Phase 2, throws `UnsupportedApiError`. |
| `getPreferenceValues` | supported | Flattened preferences (`value ?? default`, the real `pne()` semantics) captured from the launch session; values come from the store's per-command preference storage, edited in Settings → Extension Preferences. |
| `getSelectedFinderItems` | missing | Windows has no Finder; throws `UnsupportedApiError`. |
| `getSelectedText` | missing | The old host stub returned null; removed in Phase 2, throws `UnsupportedApiError` (the synthetic-clipboard route was rejected as fragile — plan §4.4). |
| `Grid` (+`Item`, `Section`, `ItemSize`, `Inset`, `Fit`, `Dropdown`) | supported | |
| `Icon` | partial | Clone ships 55 names; official enum has ~150. Unknown `Icon.X` values are `undefined` → renderer falls back to a default icon (no crash, no fake). Phase 2: extend the set and add a fallback. |
| `Image` types (`ImageLike`, `Source`, `Mask`) | partial | File/theme-source/remote-URL images supported; `Image.Mask`/`ImageMask` missing (throws). |
| `Keyboard` (`.Shortcut`, `KeyEquivalent`, `KeyModifier`) | partial | Shortcut definitions parse and are stored on items/actions; only a subset renders/registers on Windows (no `cmd` modifier semantics — host registers Ctrl/Alt/Shift only, confirmed in MainWindow.xaml.cs hotkey parser). Unrenderable shortcuts are ignored, not faked. |
| `launchCommand` | supported | `LaunchType.UserInitiated`/`Background`; `context` (launchContext) forwarded since Phase 2. |
| `LaunchType` | supported | Exported since Phase 2. |
| `List` (+`Item`, `Section`, `EmptyView`, `Dropdown`+`Item`/`Section`, `Item.Accessory`, pagination) | supported | command-ux-spec §8 verified. |
| `LocalStorage` (+`getItem/setItem/removeItem/allItems/clear`) | supported | Per-extension `.storage.json` (backend.js §LocalStorage handlers). |
| `MenuBarExtra` | out-of-scope | Component exists in clone code but menu-bar commands are out of scope; a menu-bar command is classified disabled and throws when launched. |
| `OAuth.PKCEClient` (Web redirect) | supported | Real PKCE flow (RFC 7636): the backend runs a loopback HTTP server on 127.0.0.1, opens the provider in the browser, catches the redirect, and the worker exchanges/stores tokens in its LocalStorage (snake_case `TokenResponse` accepted). Verified end to end in a real worker (store.test OAuth round trip). |
| `open` | supported | `shell.openUrl` / `fileSystem.openFile` routes. |
| `openCommandPreferences` / `openExtensionPreferences` | supported | Renderer routes exist. |
| `PopToRootType` | supported | Exported since Phase 2. |
| `popToRoot` | supported | |
| `showHUD` | supported | HUD window + duality per toast-hud-spec. |
| `showInFinder` | supported | Alias to the host `shell.revealFile` route; done in Phase 2. |
| `showToast` / `Toast` (`.Style`, `.Animation`, `updateToast`, `hideToast`) | supported | toast-hud-spec items 1–15. |
| `trash` | supported | Host `fileSystem.moveToTrash` route; done in Phase 2. |
| `updateCommandMetadata` | supported (partial) | `updateCommandMetadata` route exists; commands metadata usage in root search is Phase 2 store wiring. |
| `WindowManagement` | out-of-scope | Every method throws; `canAccess(WindowManagement.…)` → false (matches real app: requires pro). The clone's separate window-management internal extension is unrelated. |
| `captureException` | partial | Logs locally over the `captureException` notify (no Sentry); never silent. |
| `getFavicon` | supported (partial) | Current impl hits Google's favicon service (network); keep, documented as network-per-request. |
| `preferences` | supported (planned) | Reactive preferences for menu-bar only; out-of-scope with MenuBarExtra — throws. |
| `useNavigation` | supported | Module-state navigation root (build/api/src/runtime/navigation.ts). |
| `unstable_AI` / `useUnstableAI` | out-of-scope | Throw; `canAccess` false. |
| `Tool` (`.Confirmation`) | out-of-scope | Tools never load; symbol exported with throwing semantics for completeness. |
| `randomId`, `useId` | supported | Exported since Phase 2 (`randomId` = UUID, `useId` = React's hook). |
| `specialKeys` | missing | Not exported (never implemented; corrected from the earlier "supported" claim). |
| `captureMemorySnapshot` | missing | Throws `UnsupportedApiError`. |
| `useActionPanel` | missing | Throws `UnsupportedApiError`. |
| `Environment`/`PreferenceValues`/etc. (types only) | n/a | Types only — erased at runtime; provided via the bundle's package.json `types` if we ship types (we don't; extensions are compiled by us, types not needed at runtime). |


## Summary counts (top-level runtime symbols)

Of the ~60 runtime symbols in the official surface:

- **supported: 32** — `Action`, the seven built-in `Action.*` actions, `ActionPanel` + deprecated aliases, `Alert`/`confirmAlert`, `Cache`, `clearSearchBar`, `Clipboard`, `closeMainWindow`, `Detail`, `environment`, `Form`, `getApplications`, `getPreferenceValues`, `Grid`, `launchCommand`, `LaunchType`, `List`, `LocalStorage`, `OAuth.PKCEClient` (loopback web redirect), `open`, `openCommandPreferences`/`openExtensionPreferences`, `PopToRootType`, `popToRoot`, `randomId`, `useId`, `showHUD`, `showInFinder`, `showToast`/`Toast`, `trash`, `useNavigation`.
- **partial: 10** — `Action.CreateQuicklink`, `Action.CreateSnippet`, `Clipboard.read` (File content), `Color`, `Icon`, `Image` (Mask), `Keyboard`, `getFavicon`, `captureException`, `updateCommandMetadata`.
- **missing (exported, throws `UnsupportedApiError`): 8** — `Action.PickDate`, `Action.ToggleQuickLook`, `getSelectedFinderItems`, `getFrontmostApplication`, `getSelectedText`, `getDefaultApplication`, `captureMemorySnapshot`, `useActionPanel`.
- **out-of-scope (exported, throw; `canAccess` false): 9** — `AI`, `BrowserExtension`, `WindowManagement`, `MenuBarExtra`, `OAuth` (`RedirectMethod.App`/`Codeloop` + the free `authorize`), `Tool`, `unstable_AI`/`useUnstableAI`/`useAI`, `preferences`, `Action.InstallMCPServer`.
- Not shipped: `specialKeys` (was previously mis-reported as supported).

Every Phase-2 "planned" item resolved: `Cache`, `trash`, `showInFinder`, `Action.OpenWith`, `Action.Trash` became supported; `getDefaultApplication` became an honest typed throw (no host route to answer it); `getSelectedText`/`getFrontmostApplication` stubs became typed throws.

## Mocks and stubs (honest list, post-Phase-2)

1. ~~`AI.ask` → backend `completePrompt`~~ — removed in Phase 2. The old path sent the prompt to a backend method that had no handler, so every call rejected locally; no data ever left the machine. Now a typed throw.
2. ~~`environment.canAccess` returning true for AI~~ — replaced with the real routing.
3. ~~`shell.getFrontmostApplication` / `shell.getSelectedText` stubs~~ — the API surface no longer calls them; both throw `UnsupportedApiError`. The host routes still exist but are unreachable from the API.
4. ~~OAuth handlers in backend.js~~ — replaced post-Phase-2: `OAuth.PKCEClient` is implemented for the loopback web redirect (backend-side loopback server + browser open; tokens in per-extension LocalStorage). The old inert `auth.*` dispatch is unchanged dead code.
5. `Cache` persistence: `directory` accepted and ignored (in-memory only) — named limitation, not a mock.

## @raycast/utils

Not provided by us (unchanged by Phase 2): it is a normal npm dependency of extensions, installed at install time and bundled by our pipeline. Imports of `@raycast/utils` symbols that wrap unsupported APIs (e.g. `useAI`) fail at runtime through the underlying API throw. The classifier scans its imports for `useAI`/`useOAuth` and flags the command accordingly.
