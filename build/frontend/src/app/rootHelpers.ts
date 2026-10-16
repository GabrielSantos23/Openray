// Shared root-window helpers: toast action groups, the HUD hand-off, clipboard entry actions and
// the diagnostics marks, used by both the root search and the command session.

import { useMemo, useSyncExternalStore, type MouseEvent } from "react";
import type { ActionGroup } from "../ActionPanel";
import { hostHud, toastStore } from "../toastStore";
import { ipc, onNotification } from "../ipc";
import { APPLICATION_AREA_KEYS } from "../applications";
import { plainTextOf, type ClipboardEntry, type ClipboardEntryAction } from "../clipboardHistory";

export function nextToastId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `toast_${Math.random().toString(36).slice(2)}`;
}

/** `Updated ${relativeTime}` third line on currency rows — the shipped row's relative label. */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** `Hne`: after the window closes, the HUD is what remains — command icon at 22px in Raycast.
 * The host-owned HUD window is the only one still visible once the launcher hides, which is
 * exactly when a no-view command's HUD fires. */
export function hudStoreOpenForExtension(title: string) {
  hostHud.show({ title, durationMs: 1200 });
}

/** `getToastActions()` — primary/secondary surface in the open action panel while the toast lives. */
export function useToastActionGroups(): ActionGroup[] {
  const toast = useSyncExternalStore(
    toastStore.subscribe.bind(toastStore),
    toastStore.get.bind(toastStore),
  );
  return useMemo(() => {
    const actions = [toast?.primaryAction, toast?.secondaryAction].filter(Boolean);
    if (actions.length === 0) return [];
    return [
      {
        name: "toast",
        actions: actions.map((action, index) => ({
          id: index === 0 ? "toast:primary" : "toast:secondary",
          title: action!.title,
          shortcut: action!.shortcut,
        })),
      },
    ];
  }, [toast]);
}

/** Runs a toast action from the panel; returns false when the action is not a toast action. */
export async function runToastAction(actionId: string): Promise<boolean> {
  if (actionId !== "toast:primary" && actionId !== "toast:secondary") return false;
  const toast = toastStore.get();
  const action =
    actionId === "toast:primary" ? toast?.primaryAction : toast?.secondaryAction;
  if (!action) return false;
  await action.action();
  toastStore.closeIfCurrent(toast ?? null);
  return true;
}

export interface MiniMarks {
  marks: string[];
}

/**
 * Raycast's Root Search splits its results into named sections and renders a header above each
 * one: `Favorites`, then the pinned `Applications` area, then the installed `Commands`. The
 * section shapes come from the shipped `rootSearch.section` values on the internal commands.
 */

export const ROOT_SECTION_ICON_SIZE = 15;

// Ordered breadcrumbs the host can read back with ExecuteScriptAsync, so a UI that renders but
// never issues IPC is diagnosable from launcher.log.
export const marks: MiniMarks = {
  marks: ["app-module-evaluated", `exported-application-area-keys=${APPLICATION_AREA_KEYS.join(",")}`],
};
(window as unknown as { __raycastMiniMarks: MiniMarks }).__raycastMiniMarks = marks;

/**
 * Raycast's live refresh: the clipboard view subscribes to `clipboard.stateChanged`, which the Node
 * backend emits whenever the store mutates (`ipcNotification.clipboard.subscribeStateChanged`).
 */
export function subscribeClipboardStateChanged(handler: () => void): () => void {
  return onNotification("clipboard.stateChanged", () => handler());
}

/** Paste/Copy for a clipboard row: the host writes the entry and hands focus back to the app. */
export async function runClipboardEntryAction(
  entry: ClipboardEntry,
  action: ClipboardEntryAction,
): Promise<void> {
  if (action === "copy" || action === "pasteAndKeepOpen") {
    const method = action === "copy" ? "clipboard.copy" : "clipboard.paste";
    await ipc.backend(
      method,
      { id: entry.id, shouldCloseWindow: action === "copy", keepWindowOpen: action !== "copy" },
      { module: "backend" },
    );
    return;
  }
  if (action === "paste") {
    await ipc.backend("clipboard.paste", { id: entry.id, shouldCloseWindow: true }, { module: "backend" });
    return;
  }
  const text = plainTextOf(entry);
  await ipc.backend(
    "clipboard.paste",
    { text: text ?? "", sourceEntryId: entry.id, shouldCloseWindow: true },
    { module: "backend" },
  );
}

export async function openClipboardUrl(url: string): Promise<void> {
  await ipc.backend("clipboard.openUrl", { url }, { module: "backend" });
}

/**
 * Raycast keeps the root search field focused at all times: clicking a row, the footer or the
 * window body never moves focus out of the input. `preventDefault` on mousedown stops the
 * browser from moving focus while leaving the click (selection, buttons) fully functional.
 */
export function keepSearchFocus(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".searchbar, .action-panel__filter")) return;
  event.preventDefault();
}
