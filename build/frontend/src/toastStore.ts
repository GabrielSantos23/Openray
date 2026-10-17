// The toast / HUD store duality, ported from Raycast's `toast-store-u8aSMNQe.js` and
// `hud-store-BgPpts59.js`:
//
//   class Store { hud = null; open(e){...} close(){...} getHud(){...} }
//   open(e) {
//     if (window.identifier !== `main`) { this.set(e); return }
//     let t = windowStateStore.peek().isVisible, n = windowStateStore.peek().isCompact;
//     t && !n ? this.set(e) : (this.set(null), hudStore.open(e))   // hidden/compact -> HUD instead
//   }
//   close() { if (hudStore.get() !== null) { hudClose(); return } ... }
//
// Both stores are single-slot: a new toast replaces the current one, there is no queue. The
// window-visibility probe is `document.visibilityState` — the launcher hides (not destroys) its
// window, exactly the state that makes Raycast's toast fall back to the floating HUD.

import { ipcRequest } from "./ipc";

export type ToastVariant = "default" | "pending" | "success" | "warning" | "failure";

export interface ToastAction {
  title: string;
  shortcut?: string;
  action: () => void;
}

export interface ToastState {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  progress?: number;
  primaryAction?: ToastAction;
  secondaryAction?: ToastAction;
  onClose?: () => void;
}

export type HudState = ToastState;

/** `store-D71BMUnY.js` — the 4-line observable base both Raycast stores extend. */
class ObservableStore<T> {
  private listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * The floating-HUD presenter owned by the native host. Raycast's HUD is a separate always-on-top
 * native window (`HUDWindowParameters`, `AnimateOut`/`CancelAnimateOut` in `Raycast.dll`) whose
 * content is web-rendered (`HudNativeView`, feature `hud`) — here the same split: the renderer
 * pushes a payload over `window.showHud`, the WPF host owns the window and its lifetime.
 */
export const hostHud = {
  active: false as boolean,
  show(payload: { title: string; message?: string; variant?: ToastVariant; durationMs?: number }): void {
    this.active = true;
    void ipcRequest("window.showHud", payload, { module: "frontend" }).catch(() => {
      this.active = false;
    });
  },
  hide(): void {
    if (!this.active) return;
    this.active = false;
    void ipcRequest("window.hideHud", {}, { module: "frontend" }).catch(() => undefined);
  },
};

function isLauncherVisible(): boolean {
  // The host's push is authoritative (WPF Hide() does not always surface as a renderer
  // visibility event); before the first push arrives, fall back to the document probe.
  if (hostWindowVisibleTracked !== null) return hostWindowVisibleTracked;
  return typeof document === "undefined" || document.visibilityState === "visible";
}

let hostWindowVisibleTracked: boolean | null = null;

/**
 * `window.visibilityChanged` from the host. Also the migration rule: an in-window toast that
 * outlives the window becomes a HUD — extensions commonly toast right before closing, and the
 * toast must not die with the window (Raycast's hidden-window -> HUD fallback).
 */
export function setHostWindowVisible(visible: boolean): void {
  hostWindowVisibleTracked = visible;
  if (!visible && toastStore.get()) {
    const toast = toastStore.get()!;
    toastStore.clear();
    hostHud.show({
      title: toast.title,
      message: toast.message,
      variant: toast.variant,
      durationMs: toast.variant === "pending" ? undefined : 3000,
    });
  }
}

class ToastStore extends ObservableStore<ToastState | null> {
  private toast: ToastState | null = null;

  /** `open(e)` in Raycast's toast store, including the hidden-window -> HUD fallback. */
  open(toast: ToastState): void {
    if (!isLauncherVisible()) {
      // Window hidden/compact: the in-window toast would die with it, so the toast becomes a HUD.
      this.toast = null;
      this.notify();
      hostHud.show({
        title: toast.title,
        message: toast.message,
        variant: toast.variant,
        durationMs: toast.variant === "pending" ? undefined : 3000,
      });
      return;
    }
    this.toast = toast;
    this.notify();
  }

  /** `close()` — the HUD wins when one is showing, then the toast. */
  close(): void {
    if (hostHud.active) {
      hostHud.hide();
      return;
    }
    if (this.toast?.onClose) this.toast.onClose();
    this.toast = null;
    this.notify();
  }

  /** Drop the current toast silently (used when migrating it to the HUD). */
  clear(): void {
    this.toast = null;
    this.notify();
  }

  /** `closeIfCurrent(e)` — used after an action runs so a newer toast is never killed. */
  closeIfCurrent(toast: ToastState | null): void {
    if (hostHud.active) {
      hostHud.hide();
      return;
    }
    if (toast && this.toast !== toast) return;
    if (this.toast?.onClose) this.toast.onClose();
    this.toast = null;
    this.notify();
  }

  get(): ToastState | null {
    return this.toast;
  }

  /** `getToastActions()` — primary/secondary merge into the action panel while the toast lives. */
  getToastActions(): ToastAction[] {
    return [this.toast?.primaryAction, this.toast?.secondaryAction].filter(
      (action): action is ToastAction => action !== undefined,
    );
  }
}

class HudStore extends ObservableStore<HudState | null> {
  hud: HudState | null = null;
  private inWindowFallback = false;

  /** `open(e)` in the HUD store. The host window is the real presenter; the in-window HUD is the
   * mocked-native-view fallback for browser harnesses (no host object). */
  open(hud: HudState, options: { durationMs?: number } = {}): void {
    this.hud = hud;
    this.notify();
    if (isHostObjectAvailable()) {
      this.inWindowFallback = false;
      hostHud.show({
        title: hud.title,
        message: hud.message,
        variant: hud.variant,
        durationMs: options.durationMs ?? (hud.variant === "pending" ? undefined : 1200),
      });
    } else {
      this.inWindowFallback = true;
    }
  }

  close(): void {
    hostHud.hide();
    this.hud = null;
    this.notify();
  }

  get(): HudState | null {
    return this.hud;
  }

  get inWindow(): boolean {
    return this.inWindowFallback;
  }
}

function isHostObjectAvailable(): boolean {
  return Boolean(
    (window as unknown as { chrome?: { webview?: { hostObjects?: { ipc?: unknown } } } }).chrome?.webview
      ?.hostObjects?.ipc,
  );
}

export const toastStore = new ToastStore();
export const hudStore = new HudStore();

// Harness hook (dev builds only): lets a browser harness drive the stores the way the extension
// host would, mirroring the `__openrayDiag` diagnostics pattern.
if (import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__openrayToast = { toastStore, hudStore, styleToVariant };
}

/** Raycast's `Ane(e)` style -> variant map (`main-window-g1Vb1JLY.js`). */
export function styleToVariant(style: unknown): ToastVariant {
  switch (style) {
    case "ANIMATED":
      return "pending";
    case "FAILURE":
      return "failure";
    case "WARNING":
      return "warning";
    default:
      return "success";
  }
}

/** The shape `z.frontend.extensionHost.showToast` delivers (worker payload + sessionId/instance). */
export interface ExtensionToastPayload {
  sessionId?: string;
  instance?: string;
  title?: string;
  message?: string;
  style?: string;
  onHide?: string;
  primaryAction?: { title: string; shortcut?: string; onAction?: string };
  secondaryAction?: { title: string; shortcut?: string; onAction?: string };
}

/** Same for `extensionHost.showHUD` (Raycast closes the window first, then opens the HUD). */
export interface ExtensionHudPayload {
  sessionId?: string;
  title?: string;
  clearRootSearch?: boolean;
  popToRootType?: string;
}
