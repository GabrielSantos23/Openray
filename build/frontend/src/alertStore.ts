// The alert store — port of `alert-store-Bwt5kwst.js`:
//
//   var o=50, s=new class extends n { alert=null; pendingCloseTimer=null;
//     open(e){ … if window not active && identifier===main -> showMainWindow({}); assign id; set }
//     close(){ cancelPendingClose(); alert=null; notify() }
//     softClose(){ 50ms delayed close so a replacement alert does not flicker }
//   }
//
// One alert at a time, single slot, `useSyncExternalStore` consumption — same store pattern as
// `toastStore.ts`. Actions carry no payloads; the renderer resolves them through `callNodeCallback`.

import { ipcRequest } from "./ipc";

export interface AlertAction {
  title: string;
  /** Raycast's `Alert.ActionStyle`: `default | cancel | destructive`. */
  style?: string;
  action: () => void | Promise<void>;
}

export interface AlertState {
  id: string;
  title: string;
  description?: string;
  icon?: unknown;
  primaryAction?: AlertAction;
  secondaryAction?: AlertAction;
  dismissAction?: AlertAction;
  textField?: { label?: string; placeholder?: string; defaultValue?: string; password?: boolean; validator?: (value: string) => boolean };
}

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

const SOFT_CLOSE_MS = 50;

class AlertStore extends ObservableStore<AlertState | null> {
  private alert: AlertState | null = null;
  private pendingCloseTimer: ReturnType<typeof setTimeout> | null = null;

  /** `open(e)` — asks the host to surface the launcher first when it is hidden (the alert must be
   * seen); `window.showMainWindow` is our `ipc.host.raycast.showMainWindow({})`. */
  open(alert: Omit<AlertState, "id"> & { id?: string }): AlertState {
    this.cancelPendingClose();
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      void ipcRequest("window.showMainWindow", {}, { module: "frontend" }).catch(() => undefined);
    }
    const next: AlertState = { id: alert.id ?? nextAlertId(), ...alert };
    this.alert = next;
    this.notify();
    return next;
  }

  /** `close()` */
  close(): void {
    this.cancelPendingClose();
    this.alert = null;
    this.notify();
  }

  /** `softClose()` — `o = 50` in the shipped store. */
  softClose(): void {
    if (this.alert === null || this.pendingCloseTimer !== null) return;
    this.pendingCloseTimer = setTimeout(() => {
      this.pendingCloseTimer = null;
      this.alert = null;
      this.notify();
    }, SOFT_CLOSE_MS);
  }

  get(): AlertState | null {
    return this.alert;
  }

  isOpen(): boolean {
    return this.alert !== null && this.pendingCloseTimer === null;
  }

  private cancelPendingClose(): void {
    if (this.pendingCloseTimer !== null) {
      clearTimeout(this.pendingCloseTimer);
      this.pendingCloseTimer = null;
    }
  }
}

function nextAlertId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `alert_${Math.random().toString(36).slice(2)}`;
}

export const alertStore = new AlertStore();

/** The shape `z.frontend.extensionHost.showAlert` delivers (worker payload + sessionId). */
export interface ExtensionAlertPayload {
  sessionId?: string;
  title?: string;
  message?: string;
  icon?: unknown;
  primaryAction?: { title?: string; style?: string; onAction?: string };
  secondaryAction?: { title?: string; style?: string; onAction?: string };
  dismissAction?: { title?: string; style?: string; onAction?: string };
}
