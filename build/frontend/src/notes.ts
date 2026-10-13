// The Notes internal extension — data layer for the launcher's Search Notes view and the shared
// helpers both notes surfaces use (docs/notes-spec.md). Note text and titles are sensitive: this
// module never logs them, and neither do the backend handlers behind it.

import { useCallback, useEffect, useState } from "react";
import { ipc, ipcRequest, onNotification } from "./ipc";

export interface NoteEntry {
  id: string;
  title: string;
  text: string;
  pinned: number | null;
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  deletedAt?: number;
  charCount: number;
}

export function useNotes(): {
  notes: NoteEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .backend("notes.list", {}, { module: "backend" })
      .then((response) => {
        if (cancelled) return;
        setNotes((response as { notes?: NoteEntry[] }).notes ?? []);
        setError(null);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    const off = onNotification("notes.updated", () => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, [version, refresh]);

  return { notes, loading, error, refresh };
}

/**
 * `open`/`create` close the launcher and open the Notes window through the host (Raycast's
 * `host.raycast.showNotesWindow`); the note text travels only through this request, never a log.
 */
export function openNotesWindow(options: { create?: boolean; text?: string; noteId?: string } = {}): void {
  void ipcRequest("window.showNotes", options, { module: "frontend" }).catch(() => {
    /* the host logs the failure; nothing else can surface it */
  });
}

/** Our documented deeplink format (the shipped `raycast://…` scheme depends on its own registration). */
export function noteDeeplink(id: string): string {
  return `raycast-mini://notes/${id}`;
}

export type NoteRecencyBucket = "Pinned" | "Today" | "Yesterday" | "This Week" | "This Month" | "Older";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The confirmed Search Notes sections: Pinned, Today, Yesterday, This Week, This Month, Older. */
export function recencyBucket(note: NoteEntry, nowMs: number): NoteRecencyBucket {
  if (note.pinned !== null && note.pinned !== undefined) return "Pinned";
  const updated = new Date(note.updatedAt);
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (note.updatedAt >= startOfToday) return "Today";
  if (note.updatedAt >= startOfToday - DAY_MS) return "Yesterday";
  if (note.updatedAt >= startOfToday - 6 * DAY_MS) return "This Week";
  const sameMonth = updated.getFullYear() === now.getFullYear() && updated.getMonth() === now.getMonth();
  if (sameMonth) return "This Month";
  return "Older";
}

/** Orders sections the way the shipped view files them. */
export const RECENCY_ORDER: NoteRecencyBucket[] = ["Pinned", "Today", "Yesterday", "This Week", "This Month", "Older"];

export function groupNotesByRecency(
  notes: NoteEntry[],
  nowMs: number,
): Array<{ title: NoteRecencyBucket; notes: NoteEntry[] }> {
  const groups = new Map<NoteRecencyBucket, NoteEntry[]>();
  for (const note of notes) {
    const bucket = recencyBucket(note, nowMs);
    const list = groups.get(bucket) ?? [];
    list.push(note);
    groups.set(bucket, list);
  }
  return RECENCY_ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => ({
    title: bucket,
    notes: groups.get(bucket)!,
  }));
}

/** Case-insensitive substring filter across title and content; an empty query matches everything. */
export function filterNotes(notes: NoteEntry[], query: string): NoteEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return notes;
  return notes.filter((note) => {
    const haystack = `${note.title}\n${note.text}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

const RELATIVE_UNITS: Array<[number, string]> = [
  [60_000, "just now"],
  [3_600_000, "minute"],
  [86_400_000, "hour"],
];

/** The Browse subtitle's `Opened <relative time>` fragment. */
export function relativeOpened(timestamp: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - timestamp);
  if (delta < RELATIVE_UNITS[0][0]) return RELATIVE_UNITS[0][1];
  if (delta < RELATIVE_UNITS[1][0]) return `${Math.floor(delta / 60_000)} minutes ago`;
  if (delta < RELATIVE_UNITS[2][0]) {
    const hours = Math.floor(delta / 3_600_000);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (delta < 2 * DAY_MS) return "yesterday";
  if (delta < 7 * DAY_MS) return `${Math.floor(delta / DAY_MS)} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}
