// The argument view for `Resize Window` / `Move Window` (docs/window-management-spec.md): the
// search bar becomes the argument field, Enter parses with the shipped regexes and applies.

import { useEffect, useRef, useState } from "react";
import { OpenrayIcon } from "../../icons";
import { parsePositionArgs, parseSizeArgs, runWindowManagementCommand, wmCommandDefinition } from "../../windowManagement";

export function WindowManagementArgsView({
  commandKey,
  showToast,
  onBack,
  closeMainWindow,
}: {
  commandKey: "resizeWindow" | "moveWindow";
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
}) {
  const definition = wmCommandDefinition(commandKey);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isResize = commandKey === "resizeWindow";
  const parsed = isResize ? parseResizeText(value) : parseMoveText(value);
  const invalid = value.trim().length > 0 && parsed === null;

  const apply = () => {
    if (!parsed) return;
    void runWindowManagementCommand(
      commandKey,
      { showToast, closeMainWindow },
      isResize ? { size: parsed as { width: number; height: number } } : { position: parsed as { x: number; y: number } },
    );
    onBack();
  };

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="searchbar">
          <input
            ref={inputRef}
            className="searchbar__input"
            autoFocus
            value={value}
            placeholder={isResize ? "Width × Height" : "X, Y"}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              } else if (event.key === "Escape") {
                event.preventDefault();
                if (value) setValue("");
                else onBack();
              }
            }}
          />
          <span className={`searchbar__hint${invalid ? " searchbar__hint--invalid" : ""}`}>
            {invalid ? "Enter valid numbers" : definition?.args?.map((arg) => arg.placeholder).join(" ") ?? ""}
          </span>
        </div>
      </header>

      <main className="window__body">
        <div className="state">
          <div className="state__title">{definition?.title ?? commandKey}</div>
          <div className="state__message">
            {isResize
              ? "Type a width and height separated by a space, x, * or comma, then press Enter."
              : "Type coordinates like 100,100, then press Enter. They are relative to the display's work area."}
          </div>
        </div>
      </main>

      <footer className="window__footer">
        <button type="button" className="footer-icon-button" aria-label="Back" onClick={onBack}>
          <OpenrayIcon name="arrow-clockwise" size={16} />
        </button>
        <span className="footer__spacer" />
        <button type="button" className="footer-action footer-action--kbd" onClick={apply} data-state={parsed ? "ready" : "disabled"}>
          Apply <span className="kbd">Enter</span>
        </button>
      </footer>
    </div>
  );
}

/** `800 600`, `800x600`, `800,600` — the size halves must each match the shipped `^\d+$` rule. */
function parseResizeText(text: string): { width: number; height: number } | null {
  const parts = text.trim().split(/\s*(?:[x×*,]|\s)\s*/i).filter(Boolean);
  if (parts.length !== 2) return null;
  return parseSizeArgs(parts[0], parts[1]);
}

function parseMoveText(text: string): { x: number; y: number } | null {
  return parsePositionArgs(text);
}
