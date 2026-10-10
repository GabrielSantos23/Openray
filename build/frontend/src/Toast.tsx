// The toast / HUD presenters, ported from Raycast's `window-shell-hosts-EYbE8QAm.js` +
// `window-shell-hosts-BjQOV-zH.css`:
//
//   function Toast({ variant = `default`, title, message, progress, ...i }) { ... }        // Lt
//   function InWindowToasts({ top: e = 40 }) { ... }                                       // zt
//   Hud.Root / Hud.Icon / Hud.Details / Hud.Title / Hud.Message                            // Tn/En/…
//   function Huds() { const hud = useHUD(); ... yr = 1200 ... }                            // br
//
// Timing rules preserved exactly: toast auto-dismiss 3000ms with a 200ms WAAPI fade-out,
// hover pauses the timer, `pending` never auto-dismisses and closes when the window loses
// focus; the HUD auto-dismisses after 1200ms (native `animateOut` on Raycast, a local fade
// on the in-window fallback).

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { hudStore, toastStore, type ToastState, type ToastVariant } from "./toastStore";

const TOAST_AUTO_DISMISS_MS = 3000;
const TOAST_FADE_OUT_MS = 200;
const HUD_AUTO_DISMISS_MS = 1200;

// -------------------------------------------------------------------------------------------
// ActivityIndicator (`activity-indicator-46TxbseK.js` + `activity-indicator-CxsLT95H.css`):
// 16px SVG — a quaternary back circle plus an arc that spins while `variant=pending`
// (dasharray 25%/75%, 0.8s linear infinite; determinate mode tracks `progress`), and for
// success/warning/failure a 5px glowing dot in the variant colour.
// -------------------------------------------------------------------------------------------

export function ActivityIndicator({
  variant,
  progress,
  spinnerScaling = 1,
  className,
  style,
}: {
  variant: ToastVariant;
  progress?: number;
  spinnerScaling?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const determinate = variant === "pending" && typeof progress === "number";
  const clamped = determinate ? Math.max(0, Math.min(1, progress as number)) : 0;
  const arcRef = useCallback((node: SVGPathElement | null) => {
    if (!node) return;
    const length = node.getTotalLength();
    node.style.setProperty("--path-length", String(length));
    node.style.setProperty("--negative-path-length", String(-length));
  }, []);
  return (
    <div className={className ? `activity-indicator ${className}` : "activity-indicator"} data-variant={variant} style={style}>
      <svg
        className="activity-indicator__spinner"
        width={16}
        height={16}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ "--spinner-scaling": spinnerScaling } as CSSProperties}
      >
        <circle className="activity-indicator__spinnerBack" cx={8} cy={8} r={6.25} strokeWidth={1.5} />
        <path
          ref={arcRef}
          className="activity-indicator__spinnerArc"
          d="M 8 1.75 A 6.25 6.25 0 0 1 14.25 8 A 6.25 6.25 0 0 1 8 14.25 A 6.25 6.25 0 0 1 1.75 8 A 6.25 6.25 0 0 1 8 1.75"
          strokeWidth={1.5}
          strokeLinecap="round"
          data-is-determinate={determinate}
          style={{ "--progress": determinate ? clamped : 0 } as CSSProperties}
        />
      </svg>
      <div className="activity-indicator__indicator" />
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Toast primitive (`Lt`) — variant gradient background + indicator + title/message.
// -------------------------------------------------------------------------------------------

export function ToastPrimitive({
  variant = "default",
  title,
  message,
  progress,
  ...rest
}: {
  variant?: ToastVariant;
  title?: string;
  message?: string;
  progress?: number;
} & HTMLAttributes<HTMLDivElement>) {
  const hasIndicator = variant !== "default";
  return (
    <div {...rest} className={rest.className ? `toast__root ${rest.className}` : "toast__root"}>
      <div className="toast__variantBackground" data-variant={variant} />
      {hasIndicator ? (
        <ActivityIndicator variant={variant} progress={progress} className="toast__indicator" />
      ) : null}
      <div className="toast__details">
        <h1 className="toast__title">{title}</h1>
        {message ? <p className="toast__message">{message}</p> : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// In-window toasts (`zt`) — mounted once per window tree, fixed `top: 40px`, centred.
// -------------------------------------------------------------------------------------------

export function InWindowToasts({ top = 40 }: { top?: number }) {
  const toast = useSyncExternalStore(
    toastStore.subscribe.bind(toastStore),
    toastStore.get.bind(toastStore),
  ) as ToastState | null;
  const nodeRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const isActiveRef = useRef(true);
  const toastRef = useRef<ToastState | null>(null);
  toastRef.current = toast;

  useEffect(() => {
    const update = () => {
      isActiveRef.current = document.visibilityState === "visible";
      // Pending toast + window lost focus -> close (Raycast's `t?.variant === `pending` && !e && O()`).
      if (toastRef.current?.variant === "pending" && !isActiveRef.current) toastStore.close();
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const scheduleDismiss = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    cancelRef.current?.();
    let animation: Animation | undefined;
    const timer = window.setTimeout(() => {
      if (isActiveRef.current) {
        // Raycast fades with the Web Animations API and closes on `finish`.
        animation = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TOAST_FADE_OUT_MS });
        animation.addEventListener("finish", () => toastStore.close());
      } else {
        toastStore.close();
      }
    }, TOAST_AUTO_DISMISS_MS);
    cancelRef.current = () => {
      animation?.cancel();
      window.clearTimeout(timer);
    };
    return cancelRef.current;
  }, []);

  useEffect(() => {
    if (toast && toast.variant !== "pending") return scheduleDismiss();
    cancelRef.current?.();
  }, [toast, scheduleDismiss]);

  useEffect(() => () => toastStore.close(), []);

  const pause = useCallback(() => cancelRef.current?.(), []);
  const resume = useCallback(() => {
    if (toastRef.current && toastRef.current.variant !== "pending") scheduleDismiss();
  }, [scheduleDismiss]);

  if (toast === null) return null;
  return (
    <div ref={nodeRef} className="in-window-toasts__wrapper" style={{ top }}>
      <ToastPrimitive
        className="in-window-toasts__root"
        variant={toast.variant}
        title={toast.title}
        message={toast.message}
        progress={toast.progress}
        role="status"
        onPointerEnter={pause}
        onPointerLeave={resume}
      />
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// HUD primitive (`Tn`/`En`/`Dn`/`Pn`/`Fn`) and the in-window fallback presenter (`br`).
// The real HUD lives in the host's native window; this is the mocked-native-view path used
// when no host object exists (browser harness).
// -------------------------------------------------------------------------------------------

export function HudPrimitive({
  variant = "default",
  title,
  message,
  ...rest
}: {
  variant?: ToastVariant;
  title?: string;
  message?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={rest.className ? `hud-primitive__root ${rest.className}` : "hud-primitive__root"} data-is-mocked-native-view="">
      <div className="hud-primitive__variantBackground" data-variant={variant} />
      {variant !== "default" ? (
        <ActivityIndicator variant={variant} spinnerScaling={0.6} className="hud-primitive__indicator" />
      ) : null}
      <div className="hud-primitive__details">
        <h1 className="hud-primitive__title">{title}</h1>
        {message ? <p className="hud-primitive__message">{message}</p> : null}
      </div>
    </div>
  );
}

export function InWindowHud() {
  const hud = useSyncExternalStore(hudStore.subscribe.bind(hudStore), hudStore.get.bind(hudStore)) as ToastState | null;
  // `Huds` (`br`): auto-dismiss after 1200ms unless `pending`; pending closes when the window
  // becomes active — handled by the visibilitychange listener below.
  useEffect(() => {
    if (hud === null || hud.variant === "pending") return;
    const timer = window.setTimeout(() => hudStore.close(), HUD_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [hud]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && hudStore.get()?.variant === "pending") hudStore.close();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  if (hud === null || !hudStore.inWindow) return null;
  return <HudPrimitive className="hud-fallback__root" variant={hud.variant} title={hud.title} message={hud.message} role="status" />;
}

/** Both presenters in one mount point; used inside the root search and the command session. */
export function ToastLayer() {
  return (
    <>
      <InWindowToasts />
      <InWindowHud />
    </>
  );
}

export type { ToastState, ToastVariant };
export { HUD_AUTO_DISMISS_MS, TOAST_AUTO_DISMISS_MS, toastStore, hudStore };
