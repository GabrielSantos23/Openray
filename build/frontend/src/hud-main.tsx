// The HUD window's web content — the counterpart of Raycast's `HudNativeView` (feature `hud`):
// a separate native window whose content is web-rendered. The WPF host (`HudWindow.cs`) owns
// the always-on-top window, positions it bottom-centre of the work area, and drives this page:
//
//   host -> page: { type: "hud:show", payload: { title, message, variant, durationMs } }
//                  { type: "hud:animateOut" }
//   page -> host: { type: "hud:ready" }                     (listener live — host may send)
//                 { type: "hud:size", width, height }       (shrink the window to the content)
//                 { type: "hud:dismissed" }                 (after the fade-out finished)
//
// The page owns the auto-dismiss timer (Raycast's `yr = 1200` in `Huds`) and the animate-out
// animation; the host only shows/hides the window. One React root on #hud-root: a nested
// `createRoot(getElementById(...))` used to crash here with React error #299 (the element only
// exists after the first render commits), which silently killed the whole HUD page.

import { createRoot } from "react-dom/client";
import { HudPrimitive } from "./Toast";
import type { ToastVariant } from "./toastStore";
import "./styles.css";

interface HudPayload {
  title?: string;
  message?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

const FADE_OUT_MS = 200;

let currentPayload: HudPayload | null = null;
let dismissTimer: number | null = null;
let fadeAnimation: Animation | null = null;
let visible = false;

const container = document.getElementById("hud-root")!;
const contentRoot = createRoot(container);

type WebView2Chrome = {
  webview?: {
    postMessage?: (s: string) => void;
    addEventListener?: (t: string, l: (e: MessageEvent) => void) => void;
  };
};
const webviewChrome = (): WebView2Chrome | undefined =>
  (window as unknown as { chrome?: WebView2Chrome }).chrome;

function post(message: Record<string, unknown>): void {
  webviewChrome()?.webview?.postMessage?.(JSON.stringify(message));
}

function render(payload: HudPayload): void {
  contentRoot.render(
    <HudPrimitive
      className="hud-window__root"
      variant={payload.variant ?? "default"}
      title={payload.title ?? ""}
      message={payload.message}
    />,
  );
}

function reportSize(): void {
  requestAnimationFrame(() => {
    const rect = container.firstElementChild?.getBoundingClientRect();
    if (rect) post({ type: "hud:size", width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  });
}

function finishDismiss(): void {
  if (!visible) return;
  visible = false;
  fadeAnimation = null;
  contentRoot.render(null);
  post({ type: "hud:dismissed" });
}

function cancelDismissTimer(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

function animateOut(): void {
  if (!visible) return;
  cancelDismissTimer();
  const node = container.firstElementChild;
  if (node && "animate" in node) {
    fadeAnimation = (node as HTMLElement).animate(
      [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(6px)" }],
      { duration: FADE_OUT_MS, easing: "ease-in" },
    );
    fadeAnimation.addEventListener("finish", finishDismiss);
  } else {
    finishDismiss();
  }
}

function show(payload: HudPayload): void {
  fadeAnimation?.cancel();
  fadeAnimation = null;
  cancelDismissTimer();
  currentPayload = payload;
  visible = true;
  render(payload);
  reportSize();
  if (payload.variant !== "pending") {
    // `Huds`: `yr = 1200` — 1200ms, then `getWindow().animateOut()`.
    const duration = payload.durationMs ?? 1200;
    dismissTimer = window.setTimeout(animateOut, duration);
  }
}

webviewChrome()?.webview?.addEventListener?.("message", (event: MessageEvent) => {
  let message: { type?: string; payload?: HudPayload } | null = null;
  try {
    message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (!message || typeof message !== "object") return;
  if (message.type === "hud:show" && message.payload) show(message.payload);
  else if (message.type === "hud:animateOut") animateOut();
});

// Handshake: the host holds `hud:show` payloads until the listener above is live, so the first
// HUD after window creation is never lost.
post({ type: "hud:ready" });
