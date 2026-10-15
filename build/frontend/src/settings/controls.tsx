// The Settings row controls, rebuilt against Raycast for Windows 2.4.0's shipped primitives:
// `switch__*`, `dropdown-button__*`, `menu__*`, `select__*`, `keyboard-shortcut-recorder__*`,
// `visual-shortcut__*`, `checkbox__*` and the General page's ButtonRadioGroup/WindowMode cards.
// Metrics and colors come from docs/settings-design-spec.md.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RaycastIcon } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
  accessory?: string;
  disabled?: boolean;
}

export interface SelectSection {
  title: string;
  options: SelectOption[];
}

function asSections(options: readonly (string | SelectOption)[] | undefined, sections?: readonly SelectSection[]): SelectSection[] {
  if (sections) return [...sections];
  const list = options ?? [];
  const normalized = list.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  return [{ title: "", options: normalized }];
}

function useDismiss(open: boolean, onClose: () => void, rootRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      // The popups portal to <body>, so also ignore clicks inside any open popup shell.
      const target = event.target as Element | null;
      if (target?.closest(".settings-menu, .settings-recorder")) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose, rootRef]);
}

/** Anchors a portal popup under (or over) the trigger rect, clamped to the viewport. */
function usePopupRect(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, placement: "bottom" | "top") {
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setRect({ left: box.left, top: placement === "bottom" ? box.bottom + 4 : box.top });
  }, [open, placement]);
  return rect;
}

/**
 * Raycast's row select: a ghost trigger (label + theme icon + chevron that flips while open)
 * opening a radius-6 panel menu with optional grouped sections, selected check, accessories and
 * full keyboard navigation (arrows, Home/End, Enter, Esc).
 */
export function Select({
  value,
  options,
  sections,
  onChange,
  disabled,
  label,
  leadingIcon,
  variant = "ghost",
}: {
  value: string;
  options?: readonly (string | SelectOption)[];
  sections?: readonly SelectSection[];
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
  leadingIcon?: string;
  /** `ghost` = row selects; `boxed` = boxed dropdown (Shortcuts filter, header controls). */
  variant?: "ghost" | "boxed";
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const allSections = asSections(options, sections);
  const flat = allSections.flatMap((section) => section.options);
  const current = flat.find((option) => option.value === value) ?? flat[0];
  useDismiss(open, useCallback(() => setOpen(false), []), rootRef);
  const popupRect = usePopupRect(open, triggerRef, "bottom");

  useEffect(() => {
    if (!open) {
      setFocusIndex(-1);
      return;
    }
    const selectedIndex = flat.findIndex((option) => option.value === (current?.value ?? value));
    setFocusIndex(selectedIndex >= 0 ? selectedIndex : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setFocusIndex((index) => {
        for (let step = 1; step <= flat.length; step++) {
          const candidate = (((index + delta * step) % flat.length) + flat.length) % flat.length;
          if (!flat[candidate].disabled) return candidate;
        }
        return index;
      });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = flat[focusIndex];
      if (option && !option.disabled) commit(option.value);
    }
  };

  return (
    <span className="settings-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={variant === "ghost" ? "settings-select__trigger" : "settings-button"}
        data-state={open ? "open" : "closed"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((state) => !state)}
        onKeyDown={onKeyDown}
      >
        {leadingIcon ? (
          <span className="settings-select__leadingIcon">
            <RaycastIcon name={leadingIcon} size={12} />
          </span>
        ) : null}
        <span className="settings-select__label">{current?.label ?? value}</span>
        <span className="settings-select__indicator">
          <RaycastIcon name="chevron-right" size={10} />
        </span>
      </button>
      {open && popupRect
        ? createPortal(
            <div
              ref={popupRef}
              className="settings-menu"
              role="listbox"
              aria-label={label}
              style={{
                left: Math.min(popupRect.left, window.innerWidth - 180),
                top: popupRect.top,
                minWidth: Math.max(140, (triggerRef.current?.getBoundingClientRect().width ?? 0)),
              }}
            >
              {allSections.map((section, sectionIndex) => (
                <div key={section.title || sectionIndex}>
                  {section.title ? <div className="settings-menu__section">{section.title}</div> : null}
                  {section.options.map((option) => {
                    const index = flat.indexOf(option);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={option.value === current?.value}
                        className="settings-menu__item"
                        data-selected={option.value === current?.value}
                        data-focused={index === focusIndex}
                        disabled={option.disabled}
                        onMouseEnter={() => setFocusIndex(index)}
                        onClick={() => commit(option.value)}
                      >
                        <span className="settings-menu__check">
                          <RaycastIcon name="Checkmark" size={12} />
                        </span>
                        {option.icon ? <RaycastIcon name={option.icon} size={14} /> : null}
                        <span>{option.label}</span>
                        {option.accessory ? <span className="settings-menu__accessory">{option.accessory}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

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
      <span className="settings-switch__thumb" />
    </button>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 14, height: 14 }}>
      <input
        ref={ref}
        type="checkbox"
        className="settings-checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="settings-checkbox__mark">
        {indeterminate ? (
          <RaycastIcon name="Minus" size={10} />
        ) : checked ? (
          <RaycastIcon name="Checkmark" size={10} />
        ) : null}
      </span>
    </span>
  );
}

/** Raycast's Interface Size control: three `Aa` icon radio buttons. */
export function ButtonRadioGroup({
  value,
  items,
  onChange,
  label,
}: {
  value: string;
  items: Array<{ value: string; label: string; render: ReactNode }>;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <div className="settings-radioGroup" role="radiogroup" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={value === item.value}
          aria-label={item.label}
          className="settings-radioGroup__item"
          data-active={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.render}
        </button>
      ))}
    </div>
  );
}

/** Window Mode: two 148×88 preview cards with pill labels; the CSS draws the mini launcher art. */
export function WindowModeCards({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const modes: Array<{ value: string; label: string }> = [
    { value: "compact", label: "Compact" },
    { value: "expanded", label: "Expanded" },
  ];
  return (
    <div className="settings-windowMode" role="radiogroup" aria-label="Window Mode">
      {modes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          role="radio"
          aria-checked={value === mode.value}
          className="settings-windowMode__item"
          data-active={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          <span className="settings-windowMode__visual">
            {mode.value === "compact" ? (
              <span
                style={{
                  position: "absolute",
                  left: 24,
                  right: 24,
                  top: "50%",
                  height: 10,
                  transform: "translateY(-50%)",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.16)",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 4,
                }}
              >
                <span style={{ width: 3, height: 3, borderRadius: 999, background: "rgba(255,255,255,0.5)" }} />
              </span>
            ) : (
              <span
                style={{
                  position: "absolute",
                  inset: "14px 18px",
                  borderRadius: 4,
                  background: "rgba(10,30,90,0.85)",
                  boxShadow: "0 0 24px rgba(40,90,255,0.55)",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "flex-end",
                  padding: 5,
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 7, lineHeight: 1 }}>✦</span>
              </span>
            )}
          </span>
          <span className="settings-windowMode__label">{mode.label}</span>
        </button>
      ))}
    </div>
  );
}

/** One key cap (18px, inset ring). */
export function KeyCap({ children, uppercase }: { children: ReactNode; uppercase?: boolean }) {
  return (
    <span className="settings-keycap" data-uppercase={uppercase ? "true" : undefined}>
      {children}
    </span>
  );
}

/** Renders "Ctrl + Alt + Space" as Raycast's key caps. */
export function VisualShortcut({ shortcut }: { shortcut: string }) {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  return (
    <span className="settings-keycaps">
      {parts.map((part, index) => (
        <KeyCap key={`${part}-${index}`} uppercase={part.length === 1}>
          {part}
        </KeyCap>
      ))}
    </span>
  );
}

// Raycast cycles these while the recorder has nothing to show yet.
export const HOTKEY_TYPE_HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "Win", "A"], label: "Single Step" },
  { keys: ["Win"], label: "Single Key" },
  { keys: ["Ctrl", "Ctrl"], label: "Double Tap" },
];

export interface HotkeyConflict {
  /** "global" = the Raycast hotkey itself; otherwise the conflicting command's name. */
  name: string;
}

/**
 * Raycast's `KeyboardShortcutRecorder`: key-cap trigger, 320px popover with idle/recording/
 * conflict/saved states, the rotating `e.g.` hints, Backspace to clear and the
 * Back / Close / Overwrite footer. `conflict` (when provided) is shown with the red gradient
 * and the "Overwrite" affordance.
 */
export function HotkeyRecorder({
  value,
  onChange,
  disabled,
  conflict,
  onOverwrite,
  footerLabel = "Record Hotkey",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  conflict?: HotkeyConflict | null;
  onOverwrite?: () => void;
  footerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<"saved" | "conflict" | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRect = usePopupRect(open, triggerRef, "top");
  useDismiss(open, useCallback(() => setOpen(false), []), rootRef);

  useEffect(() => {
    if (!open) {
      setRecording(false);
      return;
    }
    let timer = 0;
    if (!recording) {
      timer = window.setInterval(() => setHintIndex((index) => (index + 1) % HOTKEY_TYPE_HINTS.length), 1800);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setOpen(false);
        setRecording(false);
        triggerRef.current?.focus();
        return;
      }
      if (!recording) {
        if (event.key === "Enter") {
          event.preventDefault();
          setRecording(true);
        }
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        onChange("");
        setOpen(false);
        return;
      }
      if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") {
        return; // modifiers alone keep recording (Raycast waits for the full combination)
      }
      const parts: string[] = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Alt");
      if (event.shiftKey) parts.push("Shift");
      if (event.metaKey) parts.push("Win");
      parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
      onChange(parts.join(" + "));
      setRecording(false);
      setFlash(conflict ? "conflict" : "saved");
      window.setTimeout(() => setFlash(null), 250);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, recording, onChange, conflict]);

  const variant = flash ?? (conflict ? "conflict" : "idle");

  return (
    <span className="settings-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-hotkeyTrigger"
        data-empty={value ? undefined : "true"}
        disabled={disabled}
        aria-label={footerLabel}
        onClick={() => setOpen((state) => !state)}
      >
        {value ? <VisualShortcut shortcut={value} /> : "Record Hotkey"}
      </button>
      {open && popupRect
        ? createPortal(
            <div
              className="settings-recorder"
              data-variant={variant}
              role="dialog"
              aria-label={footerLabel}
              style={{ left: Math.min(popupRect.left, window.innerWidth - 336), top: popupRect.top - 170 }}
            >
              <div className="settings-recorder__content">
                {recording ? (
                  <>
                    <span className="settings-recorder__keys">
                      <KeyCap>…</KeyCap>
                    </span>
                    <span className="settings-recorder__message">Recording…</span>
                  </>
                ) : value ? (
                  <>
                    <span className="settings-recorder__message">Press Backspace to delete</span>
                    <VisualShortcut shortcut={value} />
                    <span className="settings-recorder__message">
                      {conflict ? `Also used by ${conflict.name}` : "or record a new hotkey"}
                    </span>
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
                <span className="settings-recorder__info">
                  {conflict ? `Overwrite it or record a new hotkey` : footerLabel}
                </span>
                <span className="settings-recorder__actions">
                  <button type="button" className="settings-recorder__action" onClick={() => setRecording((state) => !state)}>
                    {recording ? "Back" : "Record"}
                    <KeyCap>↵</KeyCap>
                  </button>
                  {conflict && onOverwrite ? (
                    <button
                      type="button"
                      className="settings-recorder__action"
                      onClick={() => {
                        onOverwrite();
                        setOpen(false);
                      }}
                    >
                      Overwrite
                    </button>
                  ) : null}
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
                </span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/** Raycast's `input-field-primitive` as used by the sidebar search. */
export function SearchField({
  value,
  placeholder,
  onChange,
  onEscape,
  ariaLabel,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onEscape?: () => void;
  ariaLabel?: string;
}) {
  return (
    <span className="settings-searchField">
      <span className="settings-searchField__icon">
        <RaycastIcon name="magnifying-glass" size={14} />
      </span>
      <input
        className="settings-searchField__input"
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onEscape?.();
          }
        }}
      />
      {value ? (
        <button type="button" className="settings-searchField__clear" aria-label="Clear" onClick={() => onChange("")}>
          <RaycastIcon name="XMark" size={10} />
        </button>
      ) : null}
    </span>
  );
}

/** Raycast's small ghost icon button (24×24, hover `fg-5`). */
export function IconButton({
  icon,
  onClick,
  title,
  disabled,
  size = 12,
}: {
  icon: string;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <button type="button" className="settings-iconButton" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <RaycastIcon name={icon} size={size} />
    </button>
  );
}

export function Button({
  children,
  variant,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  variant?: "standout" | "destructive";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="settings-button"
      data-variant={variant}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
