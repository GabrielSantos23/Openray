// Shared chrome for the internal extension command views: the purple extension tile and the
// Raycast-style command footer (left: tile + command name, right: primary action + Actions).

import type { ReactNode } from "react";
import { OpenrayIcon } from "./icons";

export type InternalArea = "quicklinks" | "snippets" | "calculator" | "translator" | "file-search" | "notes" | "store";

const AREA_META: Record<InternalArea, { icon: string; tile: string }> = {
  quicklinks: { icon: "link", tile: "command-tile--quicklinks" },
  snippets: { icon: "text", tile: "command-tile--snippets" },
  calculator: { icon: "calculator", tile: "command-tile--calculator" },
  translator: { icon: "Globe", tile: "command-tile--translator" },
  "file-search": { icon: "folder-search", tile: "command-tile--filesearch" },
  notes: { icon: "blank-document", tile: "command-tile--notes" },
  store: { icon: "extension", tile: "command-tile--store" },
};

export function CommandTile({ area, size = 22 }: { area: InternalArea; size?: number }): JSX.Element {
  const meta = AREA_META[area];
  return (
    <span
      className={`command-tile ${meta.tile}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <OpenrayIcon name={meta.icon} size={Math.round(size * 0.58)} />
    </span>
  );
}

export function CommandFooter({
  area,
  title,
  primary,
  leftActions,
  actions,
}: {
  area: InternalArea;
  title: string;
  /** The right-hand primary action: label + keyboard hint + handler. */
  primary?: { label: string; key?: string; onPress: () => void };
  /** Buttons pinned to the left, next to the command name (before the spacer). */
  leftActions?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <footer className="window__footer">
      <span className="footer-command">
        <CommandTile area={area} size={18} />
        <span className="footer-command__label">{title}</span>
      </span>
      {leftActions}
      <span className="footer__spacer" />
      {primary ? (
        <button type="button" className="footer-action footer-action--kbd footer-primary" onClick={primary.onPress}>
          {primary.label}
          {primary.key !== "" ? (
            <>
              {primary.key ? <span className="kbd">{primary.key}</span> : null}
              <span className="kbd footer-primary__return" aria-hidden>
                ↵
              </span>
            </>
          ) : null}
        </button>
      ) : null}
      {actions}
    </footer>
  );
}
