# Raycast Toast / HUD Spec (reverse-engineered)

Target: Raycast 2.4.0.0 (MSIX), extracted frontend chunks in `../artifacts/frontend/`,
bundled `@raycast/api` in `../artifacts/api/node_modules/@raycast/api/index.js`,
backend `../artifacts/backend/index.mjs`, C# host strings from `Raycast.dll`.
Clone reference: `../build/` (RaycastMini).

Tags: **[CONFIRMED]** = read directly from shipped code. **[INFERRED]** = behavior deduced
from code shape, not observed in execution.

---

## 1. The mental model: two presenters, one logical toast

Raycast has two visual layers for "confirmation feedback", and they are *the same feature
routed to different presenters*:

| | **Toast** (in-window) | **HUD** (floating) |
|---|---|---|
| Where | Inside the launcher window, centered horizontally **below the search bar** (`top: 40px`) | Separate always-on-top native window, bottom-center of the screen |
| When | Main window visible **and** not compact | Window hidden/compact, **or** explicit `showHUD()` |
| Lifetime | **3 s** auto-dismiss (200 ms fade-out) | **1.2 s** auto-dismiss (native `animateOut`) |
| Variant dot | ActivityIndicator on the left | ActivityIndicator badge on the icon's bottom-right corner |
| Actions | primary/secondary merged into the action panel | none (only optional hover "Cancel" X) |

**[CONFIRMED]** `toast-store-u8aSMNQe.js` — the fallback rule:

```js
open(e) {
  if (window.identifier !== `main`) { this.set(e); return }        // non-main windows: inline toast
  let t = windowStateStore.peek().isVisible,
      n = windowStateStore.peek().isCompact;
  t && !n ? this.set(e) : (this.set(null), hudStore.open(e))       // hidden/compact -> HUD instead
}
close() {
  if (hudStore.get() !== null) { hudStore.close(); return }        // close() closes the HUD first
  this.toast?.onClose && this.toast.onClose(); this.set(null)
}
closeIfCurrent(e) { /* closes whichever presenter currently shows `e` */ }
getToastActions() { return [this.toast?.primaryAction, this.toast?.secondaryAction].filter(Boolean) }
```

Both stores are tiny single-slot observable singletons over a 4-line base class
(`store-D71BMUnY.js`): `listeners: Set`, `subscribe(fn) -> unsub`, `notify()`, consumed via
`useSyncExternalStore(subscribe, getState)`. **One toast at a time; one HUD at a time.**
A new toast replaces the current one (no queue, no stacking).

---

## 2. End-to-end data flow

### 2.1 Extension → renderer (showToast)

**[CONFIRMED]** API side (`@raycast/api/index.js`):

```js
class Toast {                       // minified: Dt
  constructor(opts) {
    this.id = uuid();
    this.options = { ...rest, title, message, style: opts.style || Toast.Style.Success };  // DEFAULT = SUCCESS
    this.callbacks = { onPrimaryAction, onSecondaryAction };
  }
  // every setter (title/message/style/primaryAction/secondaryAction) calls this.update()
  async show()   { /* register callbacks as "toast_<id>_onHide" / "_onPrimaryAction" / "_onSecondaryAction" */
                  await T("showToast", { ...this.options, onHide, primaryAction: {...p, onAction: cbId}, secondaryAction: {...s, onAction: cbId} }) }
  async hide()   { await T("hideToast", {}) }
  async update() { await T("updateToast", /* same payload as show */) }
}
// public: showToast(options) OR showToast(style, title, message)
Toast.Style = { Success: "SUCCESS", Failure: "FAILURE", Animated: "ANIMATED" }
```

Notes:
- The public API Toast has **no `icon`** — the worker-side Zod schema validates exactly
  `{title, message?, style, onHide, primaryAction?, secondaryAction?}` (each action:
  `{title, shortcut?, onAction}`). Callbacks travel as string IDs; the renderer calls back
  with `callNodeCallback({sessionId, callbackId})`.
- `showHUD(title, options?)` sends `{title, clearRootSearch: false, popToRootType: "default"}`.

**[CONFIRMED]** backend handlers (`index.mjs`, handler table):

```js
hideToast: (ctx, t) => frontend.extensionHost.hideToast({ ...t, instance: ctx.origin })
showHUD:   (ctx, t) => frontend.extensionHost.showHUD({ ...t, sessionId: ctx.worker.id, extension: {...} })
showToast: (ctx, t) => frontend.extensionHost.showToast({ ...t, sessionId: ctx.worker.id, instance: ctx.origin })
updateToast: /* identical to showToast — an upsert */
```

Guards: **[CONFIRMED]** `showToast`/`updateToast` throw `"Toast API is not available when
command is launched in background"`; `showHUD` throws for `model_provider` entry points.

### 2.2 Renderer side (main-window bundle)

**[CONFIRMED]** style → variant mapping and handlers:

```js
function styleToVariant(style) {           // minified: Ane
  switch (style) {
    case `ANIMATED`: return `pending`;
    case `FAILURE`:  return `failure`;
    default:         return `success`;
  }
}

async function showToastHandler(e) {       // minified: Ine
  e.instance && e.instance !== window.identifier
    ? nodeExtensionUI.send({ window: e.instance, data: { type: `showToast`, params: e } })  // route to owner window
    : toastStore.open({
        title: e.title, message: e.message,
        variant: styleToVariant(e.style),
        onClose: async () => { await ipc.backend.extensionHost.callNodeCallback({ sessionId: e.sessionId, callbackId: e.onHide, data: {} }) },
        primaryAction:   e.primaryAction   ? { title, shortcut: normalize(shortcut), action: () => callNodeCallback(e.primaryAction.onAction) }   : undefined,
        secondaryAction: e.secondaryAction ? { title, shortcut: normalize(shortcut), action: () => callNodeCallback(e.secondaryAction.onAction) } : undefined,
      });
}

async function showHUDHandler(e) {         // minified: Hne
  await closeMainWindow({ clearSearch: e.clearRootSearch, popToRootType: e.popToRootType ?? `default` });
  hudStore.open({ title: e.title, icon: commandIcon(extension, entryPoint, 22) });   // HUD carries the command's icon
}
```

- `popToRootType` valid values: `["default", "immediate", "suspended"]` **[CONFIRMED]**.
- **[CONFIRMED]** command exception with no view → failure toast with a built-in action:

```js
toastStore.open({ title: error.title, message: error.message, variant: `failure`,
                  primaryAction: { title: `Copy Error`, action: () => copyToClipboard(format(error)) } })
```

- **[CONFIRMED]** `getToastActions()` is imported by the command action-bar chunk
  (`command-list-item-accessory-Bd5W6oi2.js`) so the toast's primary/secondary actions appear
  in the root action panel while the toast is visible.

---

## 3. The in-window Toast (`window-shell-hosts-EYbE8QAm.js` + `window-shell-hosts-BjQOV-zH.css`)

### 3.1 Component **[CONFIRMED]**

```js
function Toast({ variant = `default`, title, message, progress, ...rest }) {
  return (
    <div className="toast__root" {...rest}>
      <div className="toast__variantBackground" data-variant={variant} />
      {variant !== `default` && <ActivityIndicator variant={variant} progress={progress} className="toast__indicator" />}
      <div className="toast__details">
        <h1 className="text truncate">{title}</h1>
        {message && <p className="toast__message small-text secondary truncate">{message}</p>}
      </div>
    </div>
  );
}

function InWindowToasts({ top = 40 }) {    // minified: zt — mounted once inside the launcher's ActionBar scope
  const toast = useToast();
  const windowActive = useRef(true);
  focusHook(({ isActive }) => {
    windowActive.current = isActive;
    if (toast?.variant === `pending` && !isActive) closeToast();     // pending dies when window loses focus
  });
  const scheduleDismiss = useCallback(() => {
    // cancel previous; setTimeout(3000) -> if window active: fade via WAAPI then close; else close immediately
    const anim = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    anim.addEventListener(`finish`, closeToast);
  }, []);
  useEffect(() => { if (toast && toast.variant !== `pending`) return scheduleDismiss(); }, [toast]);
  useEffect(() => () => closeToast(), []);                            // unmount closes
  return (
    <div ref={node} className="in-window-toasts__wrapper" style={{ top }}>  {/* fixed, left:0;right:0, centered grid */}
      {toast && <Toast className="in-window-toasts__root" variant={toast.variant} title={toast.title} message={toast.message}
        onPointerEnter={() => cancelDismiss()}                                   // hover pauses
        onPointerLeave={() => { if (toast.variant !== `pending`) scheduleDismiss(); }} />}
    </div>
  );
}
```

### 3.2 CSS **[CONFIRMED]**

```css
.in-window-toasts__wrapper { position: fixed; left: 0; right: 0; top: 40px; display: grid;
  place-items: center; padding-inline: 56px; pointer-events: none;
  animation: .3s ease-out in-window-toasts__open; }        /* open: opacity 0 -> 1, translateY(-5px) -> 0 */
.in-window-toasts__root { pointer-events: all }

.toast__root { display: flex; align-items: center; gap: 6px; padding-inline: 12px; padding-block: 8px;
  max-width: min(600px, 100%); position: relative; overflow: hidden; }
.toast__root:has(.toast__indicator) { padding-inline-start: 8px; padding-inline-end: 16px }
.toast__root { background-color: var(--bg-40); backdrop-filter: blur(var(--blur-1)); }          /* windows */
.toast__root:after { content:""; position:absolute; inset:0; border-radius: inherit; z-index:1;   /* hairline border */
  box-shadow: inset 0 .5px 0 0 var(--fg-10), inset 0 0 0 1px var(--fg-10); }

.toast__variantBackground { position: absolute; inset: 0;
  transition: --gradient-base-color 1.2s var(--easing-ease-out-expo);
  background-image: radial-gradient(45% 30% at 50% -10%, var(--gradient-base-color), transparent),
                    radial-gradient(100% 90% at 50% -15%, var(--gradient-base-color), transparent); }
.toast__variantBackground[data-variant=success] { --gradient-base-color: rgb(from var(--green)  r g b / 26%) }
.toast__variantBackground[data-variant=warning] { --gradient-base-color: rgb(from var(--yellow) r g b / 26%) }
.toast__variantBackground[data-variant=failure] { --gradient-base-color: rgb(from var(--red)   r g b / 26%) }
```

Token values: `--bg-40` = bg @ 40 % alpha, `--fg-10` = fg @ 10 % alpha,
`--easing-ease-out-expo = cubic-bezier(.16, 1, .3, 1)`, spacing tokens are `round(N * --spx)`
with `--spx = 1px * zoom`.

---

## 4. The HUD (floating window)

### 4.1 Component **[CONFIRMED]** (compound primitive)

```js
Hud.Root   ({ variant, isMockedNativeView }) -> div.hud-primitive__root  [+ variantBackground, VariantContext]
Hud.Icon   ({ icon })  -> div.hud-primitive__iconWrapper (22px)
                            > div.hud-primitive__iconMask > BoxedGlyphIcon   /* icon in rounded box, radius 4win/6mac */
                            + variant !== default && <ActivityIndicator variant spinnerScaling={.6}
                                                className="hud-primitive__indicator" />   /* badge at bottom:-6 right:-6 */
Hud.Details()          -> div.hud-primitive__details (column, gap 2px, nowrap, min-height 22px)
Hud.Title()            -> h1.text.truncate        /* hud-primitive__title */
Hud.Message()          -> p.small-text.secondary.truncate
Hud.CancelOverlay({onClick}) -> hover-revealed X (opacity 0 -> 1 on root:hover; details get a
                                linear-gradient mask fading the text near the button)

function Hud({ variant, title, message, icon, onCancel }) {
  return <Hud.Root variant={variant}>
    {icon && <Hud.Icon icon={icon} />}
    <Hud.Details><Hud.Title>{title}</Hud.Title>{message && <Hud.Message>{message}</Hud.Message>}</Hud.Details>
    {onCancel && <Hud.CancelOverlay onClick={onCancel} />}
  </Hud.Root>
}

function Huds() {                                  // minified: br — the store -> window bridge
  const hud = useHUD();  const AUTO_DISMISS = 1200;                     // yr = 1200
  const schedule = useCallback(() => {
    setTimeout(() => { const w = nativeRef.current?.getWindow();
                       w?.animateOut ? w.animateOut() : hudStore.close(); }, AUTO_DISMISS);
    /* cancel = w.cancelAnimateOut() + clearTimeout */ }, []);
  useEffect(() => { if (hud && hud.variant !== `pending`) return schedule(); }, [hud]);
  focusHook(({ isActive }) => { if (hud?.variant === `pending` && isActive) hudStore.close(); });
  if (!hud) return null;
  const interactive = !!hud.onCancel;
  return <HudNativeView feature={`hud`} onClose={hudStore.close}
            queryParams={interactive ? { interactive: `true` } : undefined}
            key={interactive ? `cancellable` : `default`}>        {/* remount when interactivity flips */}
    <Hud {...hud} onCancel={interactive ? () => { hud.onCancel?.(); hudStore.close(); } : undefined} />
  </HudNativeView>;
}
```

### 4.2 CSS **[CONFIRMED]**

```css
.hud-primitive__root { display: inline-flex; align-items: center; gap: 12px; padding: 12px;
  padding-inline-end: 24px; max-width: 500px; height: 46px;               /* 52px on macOS */
  position: relative; overflow: hidden; background-color: var(--bg-40); }
.hud-primitive__root:not(:has(.iconWrapper))                  { padding-inline-start: 24px }  /* no icon */
.hud-primitive__root:has(.iconWrapper):not(:has(.message))    { padding-inline-start: 16px }
.hud-primitive__root:has(.iconWrapper):has(.message)          { padding-inline-start: 16px; padding-inline-end: 24px }
.hud-primitive__root:has(.message)                            { height: 56px }
.hud-primitive__root[data-is-mocked-native-view] { border-radius: 8px }       /* 26px on macOS */
/* + same variantBackground / hairline :after / details+message rules as the toast */
.hud-primitive__iconWrapper { width: 22px; height: 22px; display: flex; }
.hud-primitive__indicator   { position: absolute; bottom: -6px; right: -6px; }  /* dot badge on the icon */
```

### 4.3 Native window side **[CONFIRMED strings / INFERRED geometry]**

The HUD is *not* DOM inside the launcher — `HudNativeView` (feature `hud`) is a separate
native window hosted by the C# app. `Raycast.dll` strings:
`HUDWindowParameters`, `PerformanceHUDWindow`, `CancelAnimateOut`, `NotifyAnimateOutComplete`,
`_animateOutRequested`, `WorkArea`, `SetScreenBounds`, `UpdateScreenBounds`,
`SPI_GETWORKAREA`. So the C# host sizes/positions the HUD window (work-area based; bottom-center
placement is **[INFERRED]** from the JS contract `animateOut()/cancelAnimateOut()` + standard
Raycast placement), and the WebView content calls `animateOut()` when the 1200 ms timer fires —
the native layer plays the dismiss animation and reports completion.

### 4.4 ActivityIndicator (the variant badge) **[CONFIRMED]**

16×16 SVG: back circle `stroke: var(--color-text-quaternary)`, arc path with animated dash
(`stroke-dasharray: 25% 75%`, `activity-indicator__rotate` 0.8 s linear infinite) while
`variant=pending` (determinate mode: `stroke-dashoffset` tracks `progress`). For
`success/warning/failure` the spinner is scaled to 0.6 & faded out, and a **5 px glowing dot**
(`border-radius: full`, `box-shadow: 0 0 12px 8px var(--<variant>-20)`) appears in the center —
green/yellow/red. Transition between states: `all .8s var(--easing-ease-out-expo)`.
This is the dot seen at the icon's bottom-right in clipboard-copy HUDs.

---

## 5. Gap analysis — clone (`../build/`) vs Raycast

| Behavior | Raycast | Clone today |
|---|---|---|
| Toast position | Below search bar, centered, `top: 40px`, in-window | Bottom of window above footer (`styles.css` `.toast`) |
| HUD | Separate topmost native window, bottom-center of screen, survives window hide | `.hud` div rendered **inside** the launcher at `top: header` — invisible once window hides |
| Fallback rule | toast → HUD when window hidden/compact | none — clipboard copy closes the window and the toast dies with it |
| Auto-dismiss | toast 3 s + 200 ms fade-out; HUD 1.2 s + native animateOut | toast 2.6 s / HUD 0.9 s, hard `setToast(null)`, no fade |
| Hover pause | yes (both presenters) | none |
| `pending` variant | stays until closed / until window focus flips | not implemented (`Toast` interface is `{title?, message?}`) |
| Variant styling | radial variant-color gradient bg + ActivityIndicator dot/spinner | none (no variant, no icon, no indicator) |
| Style mapping | `ANIMATED→pending, FAILURE→failure, else success`; default `SUCCESS` | `style` field forwarded but ignored by UI |
| API surface | `Toast` class w/ updatable props, `updateToast`, `hideToast`, background-command guard | bare `showToast`/`showHUD` request fns; no update/hide; no guard |
| Actions | primary/secondary wired via `callNodeCallback`, merged into action panel | serialized in API payload; UI ignores them; no `callNodeCallback` wiring for toast |
| `onHide` callback | fired on close → extension | not delivered |
| Error path | no-view exception → failure toast + "Copy Error" action | `commandException` only sets session error state |
| Dead code | — | `useExtensionCommand.ts` dispatches `raycast-mini:toast`/`:hud` CustomEvents nobody listens to |

Existing assets the clone can reuse: `--red/--green/--yellow` tokens (`styles.css:30-32`),
`--bg-40`-style panel backdrop + blur tokens, `createCallback` → `callNodeCallback` plumbing
(`useExtensionCommand.ts:143`), backend `showToast`/`showHUD` handlers (`backend.js:249-253`),
topmost frameless window patterns in `host/MainWindow.xaml.cs`.

---

## 6. Implementation to-do list (RaycastMini)

Ordered; each item is shippable on its own. Files are relative to `../build/`.

### A. Frontend toast/HUD core (in-window presenter)

1. **Create `frontend/src/toastStore.ts`** — port the store duality:
   - `ToastState = { id, title, message, variant: "default"|"pending"|"success"|"warning"|"failure", primaryAction?, secondaryAction?, onClose? }`.
   - Single-slot `toastStore` + `hudStore` (listener-Set base class like Raycast's
     `store-D71BMUnY.js`); `open`/`close`/`closeIfCurrent`.
   - Toast `open()`: if main window hidden → delegate to `hudStore.open()` (drop actions), else set.
     `close()`: HUD first, then toast.
   - Replace `App.tsx` `toast`/`hud` `useState` pairs with `useSyncExternalStore` hooks.
2. **Map API style → variant** at the notification boundary (`App.tsx:594`):
   `ANIMATED→pending`, `FAILURE→failure`, else `success`; deliver `onHide` by calling
   `ipc.backend("extensionHost.callNodeCallback", { sessionId, callbackId: onHide, data: {} })`.
   (Move the sessionId-scoped duplicates in `useExtensionCommand.ts:220-235` here and delete the
   dead `raycast-mini:toast`/`raycast-mini:hud` CustomEvents.)
3. **Build `Toast` + `Hud` components** (new `frontend/src/Toast.tsx`) with the extracted CSS
   (§3.2/§4.2): toast fixed `top: 40px` centered below the header (keep `pointer-events:none`
   wrapper + `all` on the root); HUD visuals shared via a `hud-primitive` block; hairline
   `:after` border; `--bg-40` + blur backdrop; variant radial gradient at 26 % alpha using the
   existing `--green/--yellow/--red` tokens.
4. **Port the ActivityIndicator** (16 px SVG arc spinner for `pending`, glowing 5 px dot for
   success/warning/failure, 0.8 s expo transitions); in the HUD place it as a `-6px/-6px`
   badge on the 22 px icon box.
5. **Toast timing** (`InWindowToasts` port): 3 s auto-dismiss → 200 ms opacity fade-out before
   close (WAAPI `element.animate` or a CSS class + `transitionend`); hover pauses
   (`onPointerEnter` cancels, `onPointerLeave` reschedules); `pending` never auto-dismisses and
   closes when the window loses focus; unmount closes.
6. **HUD auto-dismiss = 1.2 s** with fade+slide-down animate-out; `pending` closes when the
   window *activates* (Raycast's inverse rule for HUD).
7. **Toast actions UI**: render primary/secondary as action-bar buttons and merge
   `getToastActions()` into the existing action panel model (`App.tsx` command panel), pressing
   one calls `createCallback(action.onAction)({})` then closes per Raycast (`closeIfCurrent`).

### B. Host: native HUD window

8. **Add `host/HudWindow.cs`** — frameless, transparent, `Topmost`, non-activating
   (`ShowActivated=false`, `WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW`) WPF window (or a second WebView2
   loading a tiny `hud.html` entry, mirroring Raycast's `HudNativeView`); content = the same
   Hud markup/styles.
9. **Position it** bottom-center of the work area of the screen the launcher was on
   (`SystemParameters.WorkArea` / `Screen.FromHandle`), sized to content (~46 px height, max
   width 500 px).
10. **IPC**: add a host-object method (e.g. `window.chrome.webview.hostObjects.ipc.showHud(payload)`
    or a pipe message) so the renderer pushes `{title, message, icon?, variant, duration}`; host
    shows the window and auto-hides after the duration with a fade/slide `animateOut`
    (Storyboard), plus `cancelAnimateOut()` support.
11. **Route HUD through it**: when the toast store delegates (window hidden/compact) or
    `extensionHost.showHUD` fires, call the host HUD window instead of the in-window `.hud` div;
    keep the in-window HUD only as the "mocked native view" fallback (debug/browsers).

### C. API + backend parity

12. **`api/src/index.ts`**: add a `Toast` class (id, default `style = "SUCCESS"`, getters/setters
    that auto-`update()`, `show()/hide()`), plus `updateToast`/`hideToast` request functions;
    keep the callback-ID serialization pattern already used for actions.
13. **`backend/src/backend.js`**: add `updateToast` (same handler as `showToast`) and `hideToast`
    (`{instance}`) handlers; add Raycast's guards (toast forbidden for background commands, HUD
    forbidden for model providers) for parity.
14. **`onHide` delivery**: when the frontend closes a toast whose `onHide` callback id exists,
    call `extensionHost.callNodeCallback` (backend already exposes it — verify routing).
15. **Error path parity**: in `useExtensionCommand.ts` `commandException` handling, when the
    command mode is `no-view`, open a `failure` toast with a built-in **Copy Error** primary
    action (copies formatted error) instead of only setting session error state.

### D. Verification

16. **Browser harness**: extend the existing harness with a toast test page that exercises
    style→variant mapping, 3 s/1.2 s timers, hover pause, pending behavior, and the
    hidden-window→HUD delegation (assert computed styles: 40 px top, 46 px HUD height, 26 %
    variant gradient, 200 ms fade).
17. **End-to-end**: copy from Clipboard History with the window auto-closing → floating HUD
    "Copied entry to clipboard" stays visible ≥1.2 s after the window hides (the exact scenario
    from the screenshots); extension `showToast({style: "ANIMATED"})` → spinner that never
    auto-dismisses until `toast.hide()`.

---

## 7. Implementation status (2026-10-10) — items 1–15 implemented

| Item | Where |
|---|---|
| 1–2. Store duality + style→variant + onHide delivery | `frontend/src/toastStore.ts` (new); handlers in `App.tsx` (`extensionHost.showToast/showHUD/hideToast/commandException` subscriptions); dead `raycast-mini:toast`/`:hud` CustomEvents removed from `useExtensionCommand.ts` |
| 3–4. Toast/Hud primitives + ActivityIndicator + CSS | `frontend/src/Toast.tsx` (new); `.toast__*`, `.hud-primitive__*`, `.in-window-toasts__*`, `.activity-indicator__*` blocks in `frontend/src/styles.css` (with `@property` for the animatable gradient colour) |
| 5–6. Timing rules | 3 s + 200 ms WAAPI fade + hover pause + pending-on-blur in `InWindowToasts`; HUD 1.2 s in the HUD page and the in-window fallback |
| 7. Toast actions | `useToastActionGroups()` / `runToastAction()` in `App.tsx`; merged into both action panels under a `Toast` group; presses loop back via `callNodeCallback` |
| 8–11. Native HUD window | `host/HudWindow.cs` (new): frameless, `WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW`, topmost, bottom-centre of the launcher monitor's work area (DPI-aware), WebView2 loading the new `frontend/hud.html` entry (`hud-main.tsx`) from its own user-data folder; `window.showHud`/`window.hideHud` dispatch in `MainWindow.xaml.cs`; pending HUD dies when the launcher re-activates |
| 12. API | `Toast` class (`Toast.Style`, auto-updating setters, `show/hide/update`), `showToast(options|style,title,message)`, default style `SUCCESS`; `showHUD` now defaults `clearRootSearch:false, popToRootType:"default"` |
| 13. Backend | `updateToast` (upsert via `showToast`), `hideToast` (`{instance}`), background-command guard, model-provider guard on `showHUD` |
| 14. onHide | delivered through `callNodeCallback` from the renderer on every close path |
| 15. Error path | `extensionHost.commandException` → failure toast with a built-in **Copy Error** action |

Verification: frontend `tsc + vite build` clean (incl. new `hud.html` entry), `@raycast/api`
esbuild build clean, `dotnet build` 0 errors, backend test suite unchanged (the single failing
clipboard test fails without these changes too — missing optional `systemevents` module).
Browser-harness check (vite dev + `window.__raycastMiniToast`, dev builds only): success/failure/
pending toasts and the HUD fallback all render per the extracted CSS; 3 s auto-dismiss observed.

### 7.1 Fixes found during live testing (2026-10-10, all deployed and verified on-machine)

Live testing surfaced five latent bugs — all fixed:

1. **Renderer dropped every host push** (`frontend/src/ipc.ts`): `PostWebMessageAsJson` delivers
   `event.data` as an already-parsed object, but the listener `JSON.parse`d it — throwing on
   every message. This is why extension views hung on "Preparing view…" while everything that
   used direct renderer→host calls worked. Now handles both strings and objects.
2. **Render raced `loadCommand`** (`frontend/src/useExtensionCommand.ts`): the worker renders
   inside `initialize`, so `extensionHost.render` reaches the WebView before the session id is
   known. Fixed with a buffer-and-replay around the session listeners (Raycast's
   `Raycast.Backend.FrontendNotificationQueue` solves the same problem host-side).
3. **HUD page crashed on load** (`frontend/src/hud-main.tsx`): React error #299 — a nested
   `createRoot(document.getElementById("hud-content"))` ran before that element existed. Now a
   single root on `#hud-root`; the page posts `hud:ready` once its listener is live.
4. **HUD host/page handshake + string messages** (`host/HudWindow.cs`): the host holds the latest
   `hud:show` until `hud:ready` (first-show race), unwraps the page's double-encoded string
   messages, prewarms the HUD WebView at launcher startup, and cache-busts both window URLs.
5. **`extensionHost.closeMainRaycastWindow` was never handled** (`frontend/src/App.tsx`): the
   extension API's `closeMainWindow()` push was dropped, so "copy then close" never hid the
   window and the toast never fell back to the floating HUD. Now wired to the host's
   `window.close`.

End-to-end verified on the deployed install (`C:\Users\gabs\RaycastMini`): in-window toasts with
variants, the floating HUD ("Hello from the floating HUD" / "Copied entry to clipboard") shown
outside the launcher at the bottom-centre of the screen, and the clipboard-copy fallback.
Note: extensions install to `%LOCALAPPDATA%\RaycastMini\extensions` (per `BackendProcess.cs`),
not the repo's `extensions/` folder; the Toast Playground extension lives in both.
