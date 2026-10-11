// The Settings row controls: switch, radio group, dropdown, hotkey recorder and the shared
// key-cap visuals, styled after Raycast's `settings-ui` primitives.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RaycastIcon } from "../icons";

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="settings-switch"
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch__knob" />
    </button>
  );
}

export function RadioGroup({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="settings-radio" role="radiogroup">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className="settings-radio__item"
          data-active={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * Raycast's dropdown: a `dropdown-button` (label + chevron that flips while open) that opens a
 * blurred menu popover anchored to its right edge, like `dropdown-button__*` + `select__popover`.
 */
export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const current = options.includes(value) ? value : options[0];

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open]);

  return (
    <span className="settings-dropdown" ref={rootRef}>
      <button
        type="button"
        className="settings-dropdownButton"
        data-state={open ? "open" : "closed"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="settings-dropdownButton__text">{current}</span>
        <span className="settings-dropdownButton__indicator">
          <RaycastIcon name="Forward" size={12} />
        </span>
      </button>
      {open ? (
        <div className="settings-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === current}
              className="settings-menu__item"
              data-selected={option === current}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** One key cap: Raycast's `keyboard-shortcut-recorder__keyButton` / `visual-shortcut__root`. */
export function KeyCap({ children, uppercase }: { children: ReactNode; uppercase?: boolean }) {
  return (
    <span className="settings-keyChip" data-uppercase={uppercase ? "true" : undefined}>
      {children}
    </span>
  );
}

/** Renders "Ctrl + Alt + Space" as Raycast's key caps. */
export function VisualShortcut({ shortcut }: { shortcut: string }) {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  return (
    <span className="settings-recorder__keys">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} style={{ display: "inline-flex" }}>
          <KeyCap uppercase={part.length === 1}>{part}</KeyCap>
        </span>
      ))}
    </span>
  );
}

// Raycast cycles these while the recorder has nothing to show yet.
export const HOTKEY_TYPE_HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "⌘", "A"], label: "Single Step" },
  { keys: ["⌘"], label: "Single Key" },
  { keys: ["Ctrl", "Ctrl"], label: "Double Tap" },
];

/**
 * Raycast's `KeyboardShortcutRecorder`: the row shows the current hotkey as key caps, clicking it
 * opens a 320px popover above the trigger that records the next key combination and reports the
 * result (saved / conflict) with a command-panel footer.
 */
export function HotkeyRecorder({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<"saved" | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      setRecording(false);
      return;
    }

    let timer = 0;
    if (!recording) {
      // Raycast rotates the example shortcuts every 1.8s while nothing is being recorded.
      timer = window.setInterval(() => setHintIndex((index) => (index + 1) % HOTKEY_TYPE_HINTS.length), 1800);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const key = event.key;
      if (key === "Escape") {
        setOpen(false);
        setRecording(false);
        return;
      }
      if (!recording) return;
      if (key === "Backspace" || key === "Delete") {
        onChange("");
        setOpen(false);
        return;
      }
      const parts: string[] = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Alt");
      if (event.shiftKey) parts.push("Shift");
      if (event.metaKey) parts.push("Win");
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      onChange(parts.join(" + "));
      setRecording(false);
      setFlash("saved");
      window.setTimeout(() => setFlash(null), 200);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, recording, onChange]);

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open]);

  const variant = flash ?? "idle";

  return (
    <span className="settings-dropdown settings-hotkeyContainer" ref={rootRef}>
      <button
        type="button"
        className="settings-hotkeyButton"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {value ? (
          <VisualShortcut shortcut={value} />
        ) : (
          <span className="settings-dropdownButton__text">Record Hotkey</span>
        )}
      </button>

      {open ? (
        <div className="settings-recorder" data-variant={variant} role="dialog" aria-label="Record hotkey">
          <div className="settings-recorder__content">
            {recording ? (
              <>
                <span className="settings-recorder__message">Press keys…</span>
                <span className="settings-recorder__keys">
                  <KeyCap>…</KeyCap>
                </span>
              </>
            ) : value ? (
              <>
                <span className="settings-recorder__message">Press Backspace to delete</span>
                <VisualShortcut shortcut={value} />
                <span className="settings-recorder__message">or record a new hotkey</span>
              </>
            ) : (
              <>
                <span className="settings-recorder__message">e.g.</span>
                <span className="settings-recorder__keys">
                  {HOTKEY_TYPE_HINTS[hintIndex].keys.map((key, index) => (
                    <KeyCap key={`${key}-${index}`} uppercase={key.length === 1}>
                      {key}
                    </KeyCap>
                  ))}
                </span>
                <span className="settings-recorder__message">{HOTKEY_TYPE_HINTS[hintIndex].label}</span>
              </>
            )}
          </div>

          <div className="settings-recorder__footer">
            <span className="settings-recorder__info">Record Hotkey</span>
            <span className="settings-recorder__actions">
              <button
                type="button"
                className="settings-recorder__action"
                onClick={() => {
                  setOpen(false);
                  setRecording(false);
                }}
              >
                Close
                <KeyCap>Esc</KeyCap>
              </button>
              {!recording ? (
                <button
                  type="button"
                  className="settings-recorder__action"
                  onClick={() => setRecording(true)}
                >
                  Record
                  <KeyCap>↵</KeyCap>
                </button>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------------------------

/** Raycast's `input-field-primitive`: leading icon + borderless input in a rounded 32px shell. */
