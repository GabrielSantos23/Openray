# @raycast/api coverage in RaycastMini

Source of truth: official `@raycast/api@2.7.3` npm package, `types/index.d.ts` (9,712 lines) — the complete public surface. The `llms-api.txt` / `llms-utils.txt` files referenced in the task no longer exist upstream (the `gh-pages` branch is gone; raw URLs 404 as of 2026-10-11), so the type definitions are the API-docs source used.

Statuses:

- **supported** — implemented in `build/api` through the real renderer/nativeCallback path, no mock involved.
- **partial** — implemented subset, or implemented with a stub behind it (stub is named).
- **missing** — not implemented. Fails per the runtime policy below.
- **out-of-scope** — declared unsupported by task policy (AI, OAuth, BrowserExtension, WindowManagement, menu-bar commands, tools). `environment.canAccess` answers **false** for these; direct calls throw.

**Runtime failure policy for missing/out-of-scope**: any import-time-resolvable missing symbol is exported and throws `UnsupportedApiError` (new typed error carrying the call name, extension name and command name) when called; the host turns it into a failure toast naming the extension and logs it. Nothing returns fake/empty results.

## Top-level exports

| Export | Status | Notes |
|---|---|---|
| `Action` | supported | `makeAction` variants + `Action.Style`. Namespace members below. |
| `Action.CopyToClipboard / Open / OpenInBrowser / ShowInFinder / Paste / Push / SubmitForm` | supported | Rendered through ActionPanel; callbacks via nativeCallback. |
| `Action.CreateQuicklink` | supported (partial data) | Creates a quicklink through the quicklinks backend store; fields limited to Title/Link/Open With (clone's quicklink model). No mock. |
| `Action.CreateSnippet` | supported (partial data) | Creates through the snippets store; snippet placeholder grammar limited to the clone's engine. |
| `Action.OpenWith` | missing → supported (planned) | Host `shell.openWith` route already exists in NativeHost; wire the action to it in Phase 2. |
| `Action.Trash` | missing → supported (planned) | Host `fileSystem.moveToTrash` exists (SHFileOperationW); wire the action. |
| `Action.ToggleQuickLook` | partial | Windows QuickLook differs; renderer will map to the clone's QuickLook path if present, else throw. Decide in Phase 2; default: throws. |
| `Action.PickDate` | missing | Throws `UnsupportedApiError`. |
| `Action.InstallMCPServer` | out-of-scope | Throws. |
| `ActionPanel` (+`.Item`, `.Section`, `.Submenu`) | supported | Clone's Ctrl+K ActionPanel with groups/submenus. |
| `ActionPanelItem` / `ActionPanelSection` / `ActionPanelSubmenu` | supported | Deprecated aliases of ActionPanel members; exported as aliases. |
| `AI` (`.ask`, `.ask` streaming, models, `AI.Style`) | out-of-scope | Currently a **mock** in the clone (`AI.ask` → backend `completePrompt` stub). Phase 2 replaces with: `canAccess(AI)` → false, `AI.ask` throws. Never routes to any AI service. |
| `Alert` (`.ActionResult`, `.Options`, `.ActionStyle`) + `confirmAlert` | supported | Promise-based, styles Default/Cancel/Destructive (command-ux-spec §alerts, implemented). |
| `BrowserExtension` | out-of-scope | Namespace present, every method throws; `canAccess(BrowserExtension.dangerously)` → false. |
| `Cache` | supported (planned Phase 2) | Trivial in-memory Map cache with TTL per official semantics; new file, no host round-trip. |
| `clearSearchBar` | supported | `rootSearch: clearSearchBar` route exists. |
| `Clipboard` (`.copy`, `.read`, `.clear`) | supported | Native clipboard routes; `.read` returns `{text, file?, html?}` per host capability; `content` File objects partial. |
| `Clipboard.paste` / `pasteText` | supported | Host `paste` route (paste-into-frontmost implemented for clipboard history). |
| `closeMainWindow` | supported | |
| `Color` | partial | The 12 hex constants the clone ships; `Color.Dynamic` missing (throws on use). |
| `Detail` (+`Detail.Metadata`, `Label`, `Link`, `TagList`, `Separator`) | supported | |
| `environment` | partial | All fields of the official interface except: `launchType`/`launchContext` (Phase 2, launchContext planned), `canAccess` currently **wrong** — returns `feature === "AI"` (true). Phase 2 replaces with the real routing from docs/store-spec.md §5: false for AI/betterAI models/BrowserExtension/WindowManagement, true otherwise. `environment.theme` deprecated alias present. |
| `Form` (+ all 9 field kinds, `Form.Dropdown.Item/Section`) | supported | Error validation extension-side, submit values map (command-ux-spec §forms). |
| `getApplications` | supported | C# Applications.cs scan. |
| `getDefaultApplication` | missing → supported (planned) | Thin query over the applications native route; Phase 2. |
| `getFrontmostApplication` | **partial (stub)** | `NativeHost.shell.getFrontmostApplication` currently returns a stub (null). Phase 2: real impl via Win32 `GetForegroundWindow` + process query, or throws if not wired. Reported here as stub, not implemented. |
| `getPreferenceValues` | supported (planned Phase 2 store wiring) | Reads the flattened preferences map (`value ?? default`, matching the real `pne()`); populated from the installed extension's manifest preferences + user settings (new per-extension preference store). |
| `getSelectedFinderItems` | missing | Windows has no Finder; throws `UnsupportedApiError`. |
| `getSelectedText` | **partial (stub)** | Host `shell.getSelectedText` is a stub returning null today. Phase 2: real impl (SendInput copy via clipboard restore) or typed throw; reported as stub, not implemented. |
| `Grid` (+`Item`, `Section`, `ItemSize`, `Inset`, `Fit`, `Dropdown`) | supported | |
| `Icon` | partial | Clone ships 55 names; official enum has ~150. Unknown `Icon.X` values are `undefined` → renderer falls back to a default icon (no crash, no fake). Phase 2: extend the set and add a fallback. |
| `Image` types (`ImageLike`, `Source`, `Mask`) | partial | File/theme-source/remote-URL images supported; `Image.Mask`/`ImageMask` missing (throws). |
| `Keyboard` (`.Shortcut`, `KeyEquivalent`, `KeyModifier`) | partial | Shortcut definitions parse and are stored on items/actions; only a subset renders/registers on Windows (no `cmd` modifier semantics — host registers Ctrl/Alt/Shift only, confirmed in MainWindow.xaml.cs hotkey parser). Unrenderable shortcuts are ignored, not faked. |
| `launchCommand` | supported | `LaunchType.UserInitiated`/`Background` with the clone's launchCommand route. |
| `LaunchType` | supported | |
| `List` (+`Item`, `Section`, `EmptyView`, `Dropdown`+`Item`/`Section`, `Item.Accessory`, pagination) | supported | command-ux-spec §8 verified. |
| `LocalStorage` (+`getItem/setItem/removeItem/allItems/clear`) | supported | Per-extension `.storage.json` (backend.js §LocalStorage handlers). |
| `MenuBarExtra` | out-of-scope | Component exists in clone code but menu-bar commands are out of scope; a menu-bar command is classified disabled and throws when launched. |
| `OAuth` (all: `PKCEClient`, `AuthorizationOptions`, token storage) | out-of-scope | Namespace present, methods throw; `canAccess(OAuth)` → false. No token ever leaves the machine. |
| `open` | supported | `shell.openUrl` / `fileSystem.openFile` routes. |
| `openCommandPreferences` / `openExtensionPreferences` | supported | Renderer routes exist. |
| `PopToRootType` | supported | |
| `popToRoot` | supported | |
| `showHUD` | supported | HUD window + duality per toast-hud-spec. |
| `showInFinder` | missing → supported (planned) | `shell.revealFile` exists in NativeHost; alias to it in Phase 2. |
| `showToast` / `Toast` (`.Style`, `.Animation`, `updateToast`, `hideToast`) | supported | toast-hud-spec items 1–15. |
| `trash` | missing → supported (planned) | Wire to host `fileSystem.moveToTrash`. |
| `updateCommandMetadata` | supported (partial) | `updateCommandMetadata` route exists; commands metadata usage in root search is Phase 2 store wiring. |
| `WindowManagement` | out-of-scope | Every method throws; `canAccess(WindowManagement.…)` → false (matches real app: requires pro). The clone's separate window-management internal extension is unrelated. |
| `captureException` | partial | Logs locally (no Sentry); never silent — writes to backend log. |
| `captureMemorySnapshot` | missing | Throws. |
| `getFavicon` | supported (partial) | Current impl hits Google's favicon service (network); keep, documented as network-per-request. |
| `randomId`, `useId`, `specialKeys`, `render` | supported | Internal utilities; trivial implementations. |
| `preferences` | supported (planned) | Reactive preferences for menu-bar only; out-of-scope with MenuBarExtra — throws. |
| `useNavigation` | supported | Module-state navigation root (build/api/src/runtime/navigation.ts). |
| `useActionPanel` | missing | Throws. |
| `unstable_AI` / `useUnstableAI` | out-of-scope | Throw; `canAccess` false. |
| `Tool` (`.Confirmation`) | out-of-scope | Tools never load; symbol exported with throwing semantics for completeness. |
| `Environment`/`PreferenceValues`/etc. (types only) | n/a | Types only — erased at runtime; provided via the bundle's package.json `types` if we ship types (we don't; extensions are compiled by us, types not needed at runtime). |

## Summary counts (top-level runtime symbols)

- Official surface: **~60 runtime symbols** (excluding pure types).
- supported: **35** · partial: **8** (`Action.ToggleQuickLook`, `Color`, `environment`, `getFrontmostApplication` (stub), `getSelectedText` (stub), `Icon`, `Image`, `Keyboard`, `captureException`, `getFavicon`, `updateCommandMetadata`) · out-of-scope: **8** (`AI`, `BrowserExtension`, `WindowManagement`, `MenuBarExtra`, `OAuth`, `Tool`, `unstable_AI`/`useUnstableAI`, `preferences`) · missing-but-planned: **6** (`Action.OpenWith`, `Action.Trash`, `Cache`, `getDefaultApplication`, `showInFinder`, `trash`) · missing (throws, no plan): **4** (`Action.PickDate`, `getSelectedFinderItems`, `captureMemorySnapshot`, `useActionPanel`).

These numbers are restated as done/partial/pending in the final spec status after Phase 2; "planned" items become supported or honestly reported otherwise.

## @raycast/utils

Not provided by us: it is a normal npm dependency of extensions, installed at install time and bundled or left external by our pipeline. Imports of `@raycast/utils` symbols that wrap unsupported APIs (e.g. `useAI`) fail at runtime through the underlying API throw. The classifier scans its imports for `useAI`/`useOAuth` and flags the command accordingly.

## Mocks currently in the clone (honest list, to be resolved in Phase 2)

1. `AI.ask` → backend `completePrompt` request (mock). Phase 2: typed throw.
2. `environment.canAccess` returns true for AI. Phase 2: real routing.
3. `shell.getFrontmostApplication` and `shell.getSelectedText` in NativeHost return stubs. Phase 2: implement or throw.
4. OAuth handlers exist as stubs in backend.js. Phase 2: throw `UnsupportedApiError`.
