// Raycast's internal "Clipboard History" extension.
//
// Raycast registers this as an internal extension (`internal-extensions-C7AXi5Nw.js`):
//
//   Ze = _({ key: "clipboard-history", title: "Clipboard History",
//            description: "Search for text, images, links and colors you copied earlier and paste it again.",
//            icon: standard.clipboardHistory, settings: { historyDuration: "P1W", … },
//            commands: { history: { title: "Clipboard History", type: "view-command",
//                                  suggestionPriority: 80, … }, pasteSequential, resetPasteSequence } })
//
// and renders it at `/extension/clipboard-history` with `ClipboardHistoryView`
// (`main-window-g1Vb1JLY.js`). The list sections and the action panel below are taken from that
// component, so the clone shows the same rows in the same order with the same actions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "./ipc";
import type { ActionGroup } from "./ActionPanel";
import type { ViewAction } from "./useExtensionCommand";

export const CLIPBOARD_AREA = "clipboard-history";

export interface ClipboardRepresentation {
  mimeType: string;
  contentType: "text" | "url" | "blob";
  content: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface ClipboardItem {
  representations: ClipboardRepresentation[];
}

export interface ClipboardSource {
  host?: string;
  name?: string;
  url?: string;
}

export interface ClipboardEntry {
  id: string;
  title: string;
  categories: string[];
  tags: string[];
  items: ClipboardItem[];
  source: ClipboardSource | null;
  copyCount: number;
  createdAt: string;
  updatedAt: string;
  pinned?: number;
}

export interface ClipboardPreviewFile {
  path: string;
  size: number | null;
}

export interface ClipboardPreview {
  id: string;
  title: string;
  categories: string[];
  source: ClipboardSource | null;
  copyCount: number;
  createdAt: string;
  updatedAt: string;
  kind: "text" | "image" | "file" | "multi" | "none";
  text: string | null;
  paths: ClipboardPreviewFile[];
  image: {
    path: string;
    width: number | null;
    height: number | null;
    size: number;
    dataUrl: string | null;
  } | null;
  items?: Array<{ text: string | null; paths: ClipboardPreviewFile[] }>;
  fileCount?: number;
}

/** Raycast's type filter (`navigation-filter::clipboard-category`). */
export const CLIPBOARD_TYPE_FILTERS = [
  { value: "all", label: "All Types", icon: "bullet-points" },
  { value: "text", label: "Text Only", icon: "text" },
  { value: "image", label: "Images Only", icon: "image" },
  { value: "file", label: "Files Only", icon: "blank-document" },
  { value: "link", label: "Links Only", icon: "link" },
  { value: "email", label: "Emails Only", icon: "at-symbol" },
  { value: "color", label: "Colors Only", icon: "eye-dropper" },
] as const;

/**
 * Deterministic tag colour from the tag text. The spec's "our decisions" section records that
 * Raycast's palette is derived from the tag string (`kt(lm, tag)`) but the exact values could not be
 * recovered from the shipped chunks, so this reproduces the property rather than the literal palette:
 * the same tag always gets the same hue, and every hue is legible against the dark surface.
 */
const TAG_HUES = [6, 32, 48, 96, 152, 186, 212, 262, 292, 330];

/**
 * MD5 of the tag text, matching the plan in the spec. Implemented here rather than imported because the
 * renderer has no node:crypto and the colour has to be derivable synchronously while a row paints.
 */
export function md5Hex(value: string): string {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let index = 0; index < 64; index += 1) {
    K[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296);
  }

  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const rotate = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    const M = new Uint32Array(16);
    for (let word = 0; word < 16; word += 1) M[word] = view.getUint32(chunk + word * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let step = 0; step < 64; step += 1) {
      let F: number;
      let g: number;
      if (step < 16) {
        F = (B & C) | (~B & D);
        g = step;
      } else if (step < 32) {
        F = (D & B) | (~D & C);
        g = (5 * step + 1) % 16;
      } else if (step < 48) {
        F = B ^ C ^ D;
        g = (3 * step + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * step) % 16;
      }
      F = (F + A + K[step] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotate(F, S[step])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // MD5 emits each state word little-endian, so the bytes are swapped rather than the number being
  // printed in host order.
  const toHex = (word: number) => {
    const bytes = [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
    return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  return `${toHex(a0)}${toHex(b0)}${toHex(c0)}${toHex(d0)}`;
}

export function tagColor(tag: string): string {
  // The first two hex digits carry the entropy; the documented plan maps the digest onto one of ten
  // fixed hues so the palette stays small enough to stay legible on the dark surface.
  const digest = md5Hex(tag);
  const hue = TAG_HUES[parseInt(digest.slice(0, 8), 16) % TAG_HUES.length];
  return `hsl(${hue} 72% 66%)`;
}

export type ClipboardTypeFilter = (typeof CLIPBOARD_TYPE_FILTERS)[number]["value"];

export interface ClipboardSection {
  id: "pinned" | "recent" | "today" | "yesterday" | "thisWeek" | "thisMonth" | "thisYear" | "older";
  title: string;
  entries: ClipboardEntry[];
}

const DAY_MS = 86_400_000;

/**
 * `Oae` in Raycast: pinned entries get their own section, everything else is bucketed by age.
 * `Recent` is the last 24 hours and anything beyond a year lands in `Older`.
 */
export function buildClipboardSections(entries: ClipboardEntry[], now = Date.now()): ClipboardSection[] {
  const sections: ClipboardSection[] = [
    { id: "pinned", title: "Pinned", entries: [] },
    { id: "recent", title: "Recent", entries: [] },
    { id: "today", title: "Today", entries: [] },
    { id: "yesterday", title: "Yesterday", entries: [] },
    { id: "thisWeek", title: "This Week", entries: [] },
    { id: "thisMonth", title: "This Month", entries: [] },
    { id: "thisYear", title: "This Year", entries: [] },
    { id: "older", title: "Older", entries: [] },
  ];
  const byId = new Map(sections.map((section) => [section.id, section]));

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const startOfYesterday = todayStart - DAY_MS;
  const startOfWeek = todayStart - ((startOfToday.getDay() + 6) % 7) * DAY_MS;
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1).getTime();
  const startOfYear = new Date(startOfToday.getFullYear(), 0, 1).getTime();
  const startOfRecent = now - DAY_MS;

  for (const entry of entries) {
    if (entry.pinned !== undefined) {
      byId.get("pinned")!.entries.push(entry);
      continue;
    }
    const updated = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updated)) continue;
    if (updated >= startOfRecent) byId.get("recent")!.entries.push(entry);
    else if (updated >= todayStart) byId.get("today")!.entries.push(entry);
    else if (updated >= startOfYesterday) byId.get("yesterday")!.entries.push(entry);
    else if (updated >= startOfWeek) byId.get("thisWeek")!.entries.push(entry);
    else if (updated >= startOfMonth) byId.get("thisMonth")!.entries.push(entry);
    else if (updated >= startOfYear) byId.get("thisYear")!.entries.push(entry);
    else byId.get("older")!.entries.push(entry);
  }

  const pinned = byId.get("pinned")!.entries;
  pinned.sort((left, right) => (left.pinned ?? 0) - (right.pinned ?? 0));
  return sections.filter((section) => section.entries.length > 0);
}

function mimeBase(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function plainTextOf(entry: ClipboardEntry): string | null {
  for (const item of entry.items) {
    const representation = item.representations.find(
      (candidate) => mimeBase(candidate.mimeType) === "text/plain",
    );
    if (representation && representation.contentType === "text") return representation.content;
  }
  return null;
}

/** Raycast's `Mae`: a link entry opens in the browser with `L.open`. */
export function openUrlOf(entry: ClipboardEntry): string | null {
  if (!entry.categories.includes("link") || entry.categories.includes("email")) return null;
  for (const item of entry.items) {
    const representation = item.representations.find(
      (candidate) => mimeBase(candidate.mimeType) === "text/plain",
    );
    if (representation && representation.contentType === "text" && /^https?:\/\//i.test(representation.content)) {
      return representation.content;
    }
  }
  return null;
}

export function iconForEntry(entry: ClipboardEntry): string {
  if (entry.items.length > 1) return "blank-document";
  const item = entry.items[0];
  if (!item) return "blank-document";
  if (item.representations.some((representation) => mimeBase(representation.mimeType).startsWith("image"))) {
    return "image";
  }
  if (entry.categories.includes("email")) return "at-symbol";
  if (entry.categories.includes("link")) return "link";
  if (entry.categories.includes("color")) return "eye-dropper";
  if (entry.categories.includes("file")) return "blank-document";
  return "text";
}

export function subtitleForEntry(entry: ClipboardEntry): string {
  const parts: string[] = [];
  if (entry.source?.name) parts.push(entry.source.name);
  if (entry.categories.length > 0) parts.push(entry.categories[0]);
  if (entry.items.length > 1) parts.push(`${entry.items.length} items`);
  return parts.join(" · ");
}

/**
 * Raycast's action model for a clipboard row (`toe` + the `WN`/`GN`/`Aae` builders), reduced to the
 * actions this increment implements.
 */
export function clipboardActionGroups(entry: ClipboardEntry): ActionGroup[] {
  const actions: ViewAction[] = [
    { id: `clipboard:paste:${entry.id}`, title: "Paste", shortcut: "⏎" },
  ];

  if (plainTextOf(entry) !== null) {
    actions.push({
      id: `clipboard:pasteAsPlainText:${entry.id}`,
      title: "Paste as Plain Text",
      shortcut: "⇧⏎",
    });
  }

  actions.push({ id: `clipboard:copy:${entry.id}`, title: "Copy to Clipboard", shortcut: "⌘C" });
  // Raycast's "Paste and Keep Window Open": same paste, but the launcher stays up so you can paste
  // the next entry straight away.
  actions.push({
    id: `clipboard:pasteAndKeepOpen:${entry.id}`,
    title: "Paste and Keep Window Open",
    shortcut: "⌥⏎",
  });
  // Only offered when the entry genuinely holds more than one format, so the submenu is never empty.
  if (formatCountOf(entry) > 1) {
    actions.push({ id: `clipboard:pasteAs:${entry.id}`, title: "Paste as…" });
  }

  const secondary: ViewAction[] = [];
  const url = openUrlOf(entry);
  if (url) secondary.push({ id: `clipboard:openUrl:${entry.id}`, title: "Open in Browser", shortcut: "⌘⏎" });
  if (openTargetOf(entry)) secondary.push({ id: `clipboard:openInApp:${entry.id}`, title: "Open in App" });
  secondary.push({ id: `clipboard:editTags:${entry.id}`, title: "Edit Tags…" });
  if (hasImage(entry)) {
    secondary.push({ id: `clipboard:copyTextFromImage:${entry.id}`, title: "Copy Text from Image" });
    secondary.push({ id: `clipboard:copyTextFromQrCode:${entry.id}`, title: "Copy Text from QR Code" });
    secondary.push({ id: `clipboard:saveAsFile:${entry.id}`, title: "Save as File…" });
  } else {
    secondary.push({ id: `clipboard:edit:${entry.id}`, title: "Edit Entry" });
    secondary.push({ id: `clipboard:rename:${entry.id}`, title: "Rename Entry" });
    secondary.push({ id: `clipboard:saveAsFile:${entry.id}`, title: "Save as File…" });
  }
  if (entry.categories.includes("color")) {
    secondary.push({ id: `clipboard:copyColorAs:${entry.id}`, title: "Copy Color as…" });
  }
  secondary.push({ id: `clipboard:copyFormattedJson:${entry.id}`, title: "Copy Formatted JSON" });
  secondary.push({ id: `clipboard:pasteSequentially:${entry.id}`, title: "Paste Sequentially" });
  if (entry.pinned === undefined) {
    secondary.push({ id: `clipboard:pin:${entry.id}`, title: "Pin Entry" });
  } else {
    secondary.push({ id: `clipboard:unpin:${entry.id}`, title: "Unpin Entry" });
    secondary.push({ id: `clipboard:movePinnedUp:${entry.id}`, title: "Move Up in Pinned" });
    secondary.push({ id: `clipboard:movePinnedDown:${entry.id}`, title: "Move Down in Pinned" });
  }

  const destructive: ViewAction[] = [
    { id: `clipboard:delete:${entry.id}`, title: "Delete Entry", shortcut: "⌫", style: "Destructive" },
    { id: "clipboard:deleteAll", title: "Delete All Entries", style: "Destructive" },
  ];

  return [
    { name: "primary", actions },
    { name: "general", actions: secondary },
    { name: "delete", actions: destructive },
  ];
}

function mimeBaseLocal(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/** Distinct formats an entry holds, which is what decides whether `Paste as…` is worth offering. */
export function formatCountOf(entry: ClipboardEntry): number {
  const seen = new Set<string>();
  for (const item of entry.items) {
    for (const representation of item.representations) seen.add(mimeBaseLocal(representation.mimeType));
  }
  return seen.size;
}

export function hasImage(entry: ClipboardEntry): boolean {
  return entry.items.some((item) =>
    item.representations.some((representation) => mimeBaseLocal(representation.mimeType).startsWith("image/")));
}

export function hasOcrText(entry: ClipboardEntry): boolean {
  return entry.items.some((item) =>
    item.representations.some((representation) => representation.mimeType === "application/vnd.raycast.ocr"));
}

/**
 * What `Open in App` hands to the shell: an `http(s)` link goes to the browser, an image or file path
 * goes to its registered handler.
 */
export function openTargetOf(entry: ClipboardEntry): string | null {
  for (const item of entry.items) {
    for (const representation of item.representations) {
      const base = mimeBaseLocal(representation.mimeType);
      if (base.startsWith("image/") && representation.contentType === "url") return representation.content;
    }
  }
  const text = plainTextOf(entry)?.trim();
  if (text && /^https?:\/\//i.test(text)) return text;
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (mimeBaseLocal(representation.mimeType) === "text/uri-list" && representation.content) {
        const first = String(representation.content).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (first) return first;
      }
    }
  }
  return null;
}

export interface ClipboardColorFormat {
  id: string;
  label: string;
  value: string;
}

/** The on-disk path of an image entry's payload, which is what OCR and QR decoding read. */
export function imagePathOf(entry: ClipboardEntry): string | null {
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (mimeBaseLocal(representation.mimeType).startsWith("image/")) return representation.content;
    }
  }
  return null;
}

/** The colour format ids, in the order Raycast's `Jos` array lists them. */
export const CLIPBOARD_COLOR_FORMAT_IDS = [
  "hex",
  "hexAlpha",
  "rgba",
  "rgbaPercentage",
  "rgbCss4",
  "hsl",
  "hsla",
  "hslCss4",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "nsColor",
  "uiColor",
] as const;

export type ClipboardEntryAction =
  | "paste"
  | "pasteAsPlainText"
  | "copy"
  | "pasteAndKeepOpen";

export interface ClipboardHandlers {
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  run: (entry: ClipboardEntry, action: ClipboardEntryAction) => Promise<void>;
  editTags: (entry: ClipboardEntry) => void;
  /** Submenus and prompts the view owns, so the action runner stays free of UI state. */
  showPasteAs?: (entry: ClipboardEntry) => void;
  showColorFormats?: (entry: ClipboardEntry) => void;
  showEdit?: (entry: ClipboardEntry) => void;
  showRename?: (entry: ClipboardEntry) => void;
  showSaveAs?: (entry: ClipboardEntry) => void;
  runCommand?: (commandId: string) => Promise<void>;
}

/** Maps a chosen action onto the store call that performs it. */
export async function runClipboardAction(
  entry: ClipboardEntry,
  actionId: string,
  handlers: ClipboardHandlers,
): Promise<void> {
  const action = actionId.includes(":") ? actionId.slice(actionId.indexOf(":") + 1) : actionId;
  try {
    switch (action) {
      case "paste":
        await handlers.run(entry, "paste");
        return;
      case "pasteAsPlainText":
        await handlers.run(entry, "pasteAsPlainText");
        return;
      case "copy":
        await handlers.run(entry, "copy");
        return;
      case "pasteAndKeepOpen":
        await handlers.run(entry, "pasteAndKeepOpen");
        return;
      case "editTags":
        handlers.editTags(entry);
        return;
      case "pasteAs":
        handlers.showPasteAs?.(entry);
        return;
      case "copyColorAs":
        handlers.showColorFormats?.(entry);
        return;
      case "edit":
        handlers.showEdit?.(entry);
        return;
      case "rename":
        handlers.showRename?.(entry);
        return;
      case "saveAsFile":
        handlers.showSaveAs?.(entry);
        return;
      case "copyTextFromImage": {
        const result = (await ipc.backend("clipboard.getTextFromImage", { id: entry.id }, { module: "backend" })) as
          | { text: string }
          | undefined;
        if (result?.text) {
          await ipc.backend("clipboard.copy", { text: result.text, shouldCloseWindow: false }, { module: "backend" });
          handlers.showToast("Copied text from image", result.text.slice(0, 60));
        } else {
          handlers.showToast("No text found in image");
        }
        return;
      }
      case "copyTextFromQrCode": {
        const path = imagePathOf(entry);
        if (!path) {
          handlers.showToast("No image found in this entry");
          return;
        }
        const result = (await ipc.backend("clipboard.getQrCodeFromImage", { path }, { module: "backend" })) as
          | { results: string[] }
          | undefined;
        const text = result?.results?.[0];
        if (!text) {
          handlers.showToast("No QR code found in this image");
          return;
        }
        await ipc.backend("clipboard.copy", { text, shouldCloseWindow: false }, { module: "backend" });
        handlers.showToast("Copied text from QR Code", text.slice(0, 60));
        return;
      }
      case "copyFormattedJson": {
        const result = (await ipc.backend("clipboard.getFormattedJson", { id: entry.id }, { module: "backend" })) as
          | { json: string }
          | undefined;
        if (!result?.json) return;
        await ipc.backend("clipboard.copy", { text: result.json, shouldCloseWindow: false }, { module: "backend" });
        handlers.showToast("Copied formatted JSON");
        return;
      }
      case "openInApp":
        await ipc.backend("clipboard.openInApp", { id: entry.id }, { module: "backend" });
        return;
      case "pasteSequentially":
        await handlers.runCommand?.("clipboard.pasteSequentially");
        return;
      case "movePinnedUp":
        await ipc.backend("clipboard.movePinnedUp", { id: entry.id }, { module: "backend" });
        handlers.showToast("Moved entry up");
        return;
      case "movePinnedDown":
        await ipc.backend("clipboard.movePinnedDown", { id: entry.id }, { module: "backend" });
        handlers.showToast("Moved entry down");
        return;
      case "openUrl": {
        const url = openUrlOf(entry);
        if (url) await ipc.backend("clipboard.openUrl", { url }, { module: "backend" });
        return;
      }
      case "pin":
        await ipc.backend("clipboard.pin", { id: entry.id }, { module: "backend" });
        handlers.showToast("Pinned entry");
        return;
      case "unpin":
        await ipc.backend("clipboard.unpin", { id: entry.id }, { module: "backend" });
        handlers.showToast("Unpinned entry");
        return;
      case "delete":
        await ipc.backend("clipboard.delete", { id: entry.id }, { module: "backend" });
        handlers.showToast("Deleted entry");
        return;
      case "deleteAll":
        await ipc.backend("clipboard.deleteAll", { includePinned: false }, { module: "backend" });
        handlers.showToast("Deleted all entries");
        return;
      default:
        console.info(`[clipboard] action ${action} is not implemented yet`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    handlers.showToast(`Failed: ${action}`, message);
  }
}

export const CLIPBOARD_PAGE_SIZE = 50;

export interface ClipboardDataState {
  entries: ClipboardEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}

/**
 * Loads the history for the active filters and re-loads it whenever the store signals a change —
 * Raycast's `ipcNotification.clipboard.subscribeStateChanged`. Pages are appended as the user scrolls,
 * because Unlimited retention means the set can be arbitrarily large.
 */
export function useClipboardHistory(
  filter: string,
  category: ClipboardTypeFilter,
  tag: string | null,
  subscribe: (handler: () => void) => () => void,
): ClipboardDataState {
  // Pages are appended as the user scrolls, because Unlimited retention means the set can be
  // arbitrarily large. Raycast does the same with `endThreshold: 80`.
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => subscribe(refresh), [subscribe, refresh]);

  const trimmedFilter = filter.trim();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .backend(
        "clipboard.getAll",
        {
          limit: CLIPBOARD_PAGE_SIZE,
          filter: trimmedFilter === "" ? undefined : trimmedFilter,
          category: category === "all" ? undefined : category,
          tag: tag ?? undefined,
        },
        { module: "backend" },
      )
      .then((response) => {
        if (cancelled) return;
        const page = response as { entries?: ClipboardEntry[]; nextCursor?: string | null };
        setEntries(page.entries ?? []);
        setCursor(page.nextCursor ?? null);
        setHasMore(Boolean(page.nextCursor));
        setError(null);
      })
      .catch((reason) => {
        if (cancelled) return;
        setEntries([]);
        setCursor(null);
        setHasMore(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmedFilter, category, tag, token]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    ipc
      .backend(
        "clipboard.getAll",
        {
          limit: CLIPBOARD_PAGE_SIZE,
          cursor,
          filter: trimmedFilter === "" ? undefined : trimmedFilter,
          category: category === "all" ? undefined : category,
          tag: tag ?? undefined,
        },
        { module: "backend" },
      )
      .then((response) => {
        const page = response as { entries?: ClipboardEntry[]; nextCursor?: string | null };
        setEntries((current) => {
          const known = new Set(current.map((entry) => entry.id));
          return [...current, ...(page.entries ?? []).filter((entry) => !known.has(entry.id))];
        });
        setCursor(page.nextCursor ?? null);
        setHasMore(Boolean(page.nextCursor));
      })
      .catch(() => {
        setHasMore(false);
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, trimmedFilter, category, tag]);

  return { entries, loading, error, refresh, loadMore, hasMore, loadingMore };
}

/** Preview for the selected row only, so image bytes are never fetched for rows nobody looks at. */
export function useClipboardPreview(entry: ClipboardEntry | null, token: number) {
  const [preview, setPreview] = useState<ClipboardPreview | null>(null);

  useEffect(() => {
    if (!entry) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    ipc
      .backend("clipboard.getPreview", { id: entry.id }, { module: "backend" })
      .then((response) => {
        if (!cancelled) setPreview(response as ClipboardPreview);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.id, token]);

  return preview;
}

export function useClipboardSections(entries: ClipboardEntry[]): ClipboardSection[] {
  return useMemo(() => buildClipboardSections(entries), [entries]);
}