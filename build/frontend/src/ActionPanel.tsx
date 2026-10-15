// The action panel.
//
// Extracted from Raycast's frontend (`main-window-*.js`):
//
//   (0, q.jsx)(ActionPanel, { for: (0, q.jsx)(_d, { icon: `action`, size: `small`,
//       variant: `ghost`, className: jC.actionBarButton,
//       onClick: () => Ae.props.onOpenChange(!0), … }) })
//   (0, q.jsx)(ap, { open: Ae.props.open, onClose: …,
//       getReference: () => np(je.current, { scale: Me }), align: `end`,
//       rootMenuModel: Ae.props.rootMenuModel, … })
//
// i.e. an ActionPanel is a **popover anchored to the action-bar button, aligned to the end**,
// rendered from the action model the extension produced (`rootMenuModel`), and dismissed with
// Escape. Raycast's internal Applications extension groups its actions as
// `general` / `favorites` / `copy` / `configure` / `app-management` (see `applications.ts`).

import { useEffect, useMemo, useRef, useState } from "react";
import { RaycastIcon } from "./icons";
import type { ViewAction } from "./useExtensionCommand";

export interface ActionGroup {
  /** Raycast's group name: `general`, `favorites`, `copy`, `configure`, `app-management`. */
  name: string;
  actions: ViewAction[];
}

export interface ActionPanelProps {
  open: boolean;
  groups: ActionGroup[];
  onClose: () => void;
  onRun: (action: ViewAction) => void | Promise<void>;
  title?: string;
}

export const ACTION_GROUP_LABELS: Record<string, string> = {
  primary: "",
  general: "Actions",
  favorites: "Favorites",
  copy: "Copy",
  configure: "Configure",
  "app-management": "App Management",
  actions: "Actions",
  toast: "Toast",
};

export function ActionPanel({ open, groups, onClose, onRun, title }: ActionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleGroups = useMemo<ActionGroup[]>(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        actions: group.actions.filter((action) => action.title.toLowerCase().includes(query)),
      }))
      .filter((group) => group.actions.length > 0);
  }, [groups, filter]);

  const flat = useMemo(() => visibleGroups.flatMap((group) => group.actions), [visibleGroups]);

  useEffect(() => {
    if (!open) return;
    setFilter("");
    setActiveIndex(0);
    // Raycast focuses the action panel's own search field as soon as it opens.
    filterRef.current?.focus();
  }, [open]);

  useEffect(() => {
    // Keep the highlighted action visible while arrowing through a long panel.
    const container = scrollRef.current;
    if (!open || !container) return;
    const item = container.querySelector<HTMLElement>('[data-selected="true"]');
    if (!item) return;
    const itemRect = item.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (itemRect.top < viewRect.top) {
      container.scrollTop -= viewRect.top - itemRect.top + 4;
    } else if (itemRect.bottom > viewRect.bottom) {
      container.scrollTop += itemRect.bottom - viewRect.bottom + 4;
    }
  }, [open, activeIndex, filter]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Capture-phase stopPropagation is load-bearing: the launcher window also listens for
      // Enter/Escape on `window`, and when an action closes this panel its *stale* window
      // listener still fires for the same keystroke — launching the selected app right after
      // e.g. "Add to Favorites". Swallow the event here so the panel fully owns it.
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const action = flat[activeIndex];
        if (action) void onRun(action);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, flat, activeIndex, onClose, onRun]);

  if (!open) return null;
  if (flat.length === 0) {
    return (
      <div className="action-panel">
        <div className="action-panel__backdrop" onClick={onClose} aria-hidden />
        <div className="action-panel__popover" role="menu" ref={panelRef} tabIndex={-1}>
          <div className="action-panel__title">{title ?? "Actions"}</div>
          <div className="action-panel__empty">No actions</div>
        </div>
      </div>
    );
  }

  let cursor = 0;

  return (
    <div className="action-panel">
      <div className="action-panel__backdrop" onClick={onClose} aria-hidden />
      <div className="action-panel__popover" role="menu" ref={panelRef} tabIndex={-1}>
        {title ? <div className="action-panel__title">{title}</div> : null}

        {/* Raycast's action panel always carries its own filter ("Search for actions…"). */}
        <div className="action-panel__filter">
          <RaycastIcon name="magnifying-glass" size={14} />
          <input
            ref={filterRef}
            value={filter}
            placeholder="Search for actions…"
            onChange={(event) => {
              setFilter(event.target.value);
              setActiveIndex(0);
            }}
          />
        </div>

        <div className="action-panel__scroll" ref={scrollRef}>
          {visibleGroups.map((group) => {
            const label = ACTION_GROUP_LABELS[group.name] ?? group.name;
            return (
              <div className="action-panel__group" key={group.name}>
                {label ? <div className="action-panel__groupLabel">{label}</div> : null}
                {group.actions.map((action) => {
                  const index = cursor++;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      className="action-panel__item"
                      data-selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={(event) => {
                        // Keep the click inside the panel: an action that closes the panel must
                        // never let the same click fall through onto the list row underneath.
                        event.preventDefault();
                        event.stopPropagation();
                        void onRun(action);
                      }}
                    >
                      <span className={`action-panel__icon action-panel__icon--${iconKind(action)}`} aria-hidden>
                        {action.icon ? <ActionModelIcon icon={action.icon} fallbackTitle={action.title} /> : <RaycastIcon name={iconKeyFor(action.title)} size={15} />}
                      </span>
                      <span className="action-panel__label">{action.title}</span>
                      {action.shortcut ? (
                        <span className="action-panel__shortcut">{action.shortcut}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function iconKind(action: ViewAction): string {
  if (action.style === "Destructive") return "destructive";
  return "default";
}

/**
 * The icon the extension put on its Action (`icon` in the render model — data/file URLs, lucide
 * names via `icon://`, emoji via `emoji://`). Falls back to the title heuristic when the model
 * carries none.
 */
export function ActionModelIcon({ icon, fallbackTitle }: { icon: unknown; fallbackTitle: string }) {
  const spec = icon as { source?: { light?: string }; svg?: unknown; color?: unknown } | undefined;
  if (typeof spec?.svg === "string" && spec.svg.length > 0) {
    return (
      <span
        aria-hidden
        className="action-panel__svgIcon"
        style={{ color: typeof spec.color === "string" ? spec.color : undefined }}
        dangerouslySetInnerHTML={{ __html: spec.svg }}
      />
    );
  }
  const source = spec?.source?.light;
  if (typeof source === "string" && source.startsWith("emoji://")) {
    return <span style={{ fontSize: 13, lineHeight: 1 }}>{decodeURIComponent(source.slice("emoji://".length))}</span>;
  }
  if (typeof source === "string" && source.startsWith("icon://")) {
    return <RaycastIcon name={source.slice("icon://".length).replace(/\.png$/, "")} size={15} />;
  }
  if (typeof source === "string" && (/^(https?:|data:|file:)/.test(source) || /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(source))) {
    return <img src={source} width={15} height={15} alt="" style={{ objectFit: "contain", borderRadius: 3 }} />;
  }
  return <RaycastIcon name={iconKeyFor(fallbackTitle)} size={15} />;
}

/**
 * Raycast icon key for an action, using the same names the shipped manifest uses
 * (`internal-extensions-C7AXi5Nw.js`): `app-window-list`, `folder`, `copy-clipboard`, `shield-04`,
 * `person`, `clock`, `x-mark-circle`, `eye-disabled`, `arrow-clockwise`, `trash`, `star`, `cog`,
 * `game-controller`. All of them are Lucide icon names under a different spelling, which
 * `RaycastIcon` resolves.
 */
const ACTION_ICON_KEYS: Record<string, string> = {
  "Open Application": "app-window-list",
  "Open Command": "app-window-list",
  "New Application Window": "app-window-list",
  "Open Recent Files.": "clock",
  "Run as Administrator": "shield-04",
  "Run as Different User": "person",
  "Show in File Explorer": "folder",
  "Show in Finder": "finder",
  "Show Advanced Options": "cog",
  "Add to Favorites": "star",
  "Remove from Favorites": "star",
  favorite: "star",
  "Copy Path": "copy-clipboard",
  "Copy Name": "copy-clipboard",
  "Copy Bundle Identifier": "copy-clipboard",
  "Copy Greeting": "copy-clipboard",
  "Configure Command": "cog",
  "Configure Extension": "cog",
  "Reset Ranking": "arrow-clockwise",
  "Hide Application": "eye-disabled",
  "Quit Application": "x-mark-circle",
  "Force Quit Application": "x-mark-circle",
  "Enable Auto Quit": "x-mark-circle-half-dash",
  "Disable Auto Quit": "x-mark-circle-half-dash",
  "Restart Application": "arrow-clockwise",
  "Uninstall Application": "trash",
  "Open Raycast": "app-window-list",
  "Open in Browser": "globe",
  "Say Hi": "app-window-list",
  "Read Clipboard": "copy-clipboard",

  // Clipboard history actions (`clipboardActionGroups` titles).
  Paste: "app-window-list",
  "Paste as Plain Text": "text",
  "Copy to Clipboard": "copy-clipboard",
  "Paste and Keep Window Open": "app-window-list",
  "Paste as…": "app-window-list",
  "Open in App": "app-window-list",
  "Edit Tags…": "tag",
  "Copy Text from Image": "text",
  "Copy Text from QR Code": "code",
  "Save as File…": "download",
  "Edit Entry": "text",
  "Rename Entry": "text",
  "Copy Color as…": "eye-dropper",
  "Copy Formatted JSON": "code",
  "Paste Sequentially": "list",
  Pin: "tack",
  "Pin Entry": "tack",
  "Unpin Entry": "tack",
};

export function iconKeyFor(title: string): string {
  return ACTION_ICON_KEYS[title] ?? title;
}

