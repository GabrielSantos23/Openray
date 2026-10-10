// The alert dialog host — port of `gn` (Alert) + `Xt` (AlertPrimitive.Root) in
// `window-shell-hosts-EYbE8QAm.js`, fed by `alertStore` (port of `alert-store-Bwt5kwst.js`).
//
// Keyboard: the shipped component matches the keystroke against [primary, secondary, dismiss]
// shortcuts (`ie([t, n, r], e)`); from `alert-utils-CDcEvLSx.js` the shortcuts are primary = Ctrl
// (win), secondary = Ctrl+Shift, dismiss = Escape. Enter runs the primary button, Escape dismisses,
// Tab is swallowed (the dialog owns the keystrokes while open).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { alertStore, type AlertAction, type AlertState } from "./alertStore";
import { RaycastIcon } from "./icons";

export function useAlert(): AlertState | null {
  return useSyncExternalStore(
    alertStore.subscribe.bind(alertStore),
    alertStore.get.bind(alertStore),
  );
}

type ResolvedAction = AlertAction & { kind: "primary" | "secondary" | "dismiss" };

function AlertHost() {
  const alert = useAlert();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [textValue, setTextValue] = useState("");

  useEffect(() => {
    if (!alert) return;
    setTextValue(alert.textField?.defaultValue ?? "");
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      if (alert.textField) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        panelRef.current?.focus();
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      restoreFocusRef.current?.focus?.();
    };
  }, [alert]);

  const actions = useMemo<ResolvedAction[]>(() => {
    if (!alert) return [];
    const resolved: ResolvedAction[] = [];
    if (alert.primaryAction) resolved.push({ ...alert.primaryAction, kind: "primary" });
    if (alert.secondaryAction) resolved.push({ ...alert.secondaryAction, kind: "secondary" });
    if (alert.dismissAction) resolved.push({ ...alert.dismissAction, kind: "dismiss" });
    return resolved;
  }, [alert]);

  const primaryInvalid = useMemo(() => {
    if (!alert?.textField || !alert.primaryAction) return false;
    const validator = alert.textField.validator ?? ((value: string) => value !== "");
    return !validator(textValue);
  }, [alert, textValue]);

  useEffect(() => {
    if (!alert) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Tab") {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const dismiss = actions.find((action) => action.kind === "dismiss") ?? actions.find((action) => action.kind === "primary");
        void dismiss?.action();
        alertStore.close();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const primary = actions.find((action) => action.kind === "primary");
        if (primary && !primaryInvalid) {
          void primary.action();
          alertStore.close();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [alert, actions, primaryInvalid]);

  if (!alert) return null;

  const run = (action: ResolvedAction) => {
    if (action.kind === "primary" && primaryInvalid) return;
    void action.action();
    alertStore.close();
  };

  const buttonClass = (action: ResolvedAction) =>
    [
      "alert__button",
      action.kind === "primary" && action.style !== "destructive" ? "alert__button--primary" : "",
      action.kind === "primary" && action.style === "destructive" ? "alert__button--destructive" : "",
      action.kind === "secondary" ? "alert__button--secondary" : "",
      action.kind === "dismiss" && action.style !== "destructive" && !alert.primaryAction && !alert.secondaryAction
        ? "alert__button--primary"
        : "",
      action.kind === "dismiss" && action.style === "destructive" ? "alert__button--destructive" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const layout: "horizontal" | "vertical" =
    (alert.primaryAction && alert.secondaryAction) || (!alert.primaryAction && !alert.secondaryAction)
      ? "vertical"
      : (alert.primaryAction?.title.length ?? 0) > 13 || (alert.dismissAction?.title.length ?? 0) > 13
        ? "vertical"
        : "horizontal";

  return (
    <div className="alert" role="alertdialog" aria-modal aria-label={alert.title}>
      <div className="alert__overlay" onClick={() => alertStore.softClose()} />
      <div className="alert__panel" ref={panelRef} tabIndex={-1}>
        <div className="alert__body">
          {alert.icon ? (
            <span className="alert__icon" aria-hidden>
              <RaycastIcon name="warning" size={20} />
            </span>
          ) : null}
          <h1 className="alert__title">{alert.title}</h1>
          {alert.description ? <p className="alert__description">{alert.description}</p> : null}
          {alert.textField ? (
            <>
              {alert.textField.label ? <label className="alert__textFieldLabel" htmlFor="alert-input">{alert.textField.label}</label> : null}
              <input
                id="alert-input"
                ref={inputRef}
                className="alert__textField"
                type={alert.textField.password ? "password" : "text"}
                placeholder={alert.textField.placeholder}
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
              />
            </>
          ) : null}
        </div>
        <div className="alert__buttons" data-layout={layout}>
          {actions.map((action) => (
            <button
              key={action.kind}
              type="button"
              tabIndex={-1}
              className={buttonClass(action)}
              onClick={() => run(action)}
              disabled={action.kind === "primary" && primaryInvalid}
            >
              {action.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AlertHost;
