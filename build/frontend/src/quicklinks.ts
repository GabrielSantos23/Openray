// The Quicklinks internal extension — data layer.
//
// Mirrors the shipped contracts in `docs/quicklinks-spec.md`: the store fields, the featured
// library, the import format (`{name, link?|url?, icon?|iconName?, openWith?|applicationID?}` in a
// bare array or `{"quicklinks":[...]}`) and the file-link rule
// (`/^(?:[a-zA-Z]:[\\/]|\\\\|\/|~(\/|$)|file:\/\/)/`) behind `Show in File Explorer`.

import { useCallback, useEffect, useState } from "react";
import { ipc } from "./ipc";
import { onNotification } from "./ipc";

export interface QuicklinkArg {
  type: "text" | "dropdown";
  name: string;
  placeholder: string;
  value: string;
  required: boolean;
  data?: Array<{ title: string; value: string }>;
}

export interface QuicklinkEntry {
  id: string;
  name: string;
  link: string;
  icon: string | null;
  openWith: string | null;
  tags: string[];
  pinned: number | null;
  openCount: number;
  createdAt: number;
  updatedAt: number;
  args: QuicklinkArg[];
  argsError: string | null;
}

/** The 16 hardcoded `Featured` library entries the shipped view offers. */
export const FEATURED_LIBRARY: ReadonlyArray<{ name: string; link: string }> = Object.freeze([
  { name: "Search Google", link: 'https://google.com/search?q={argument name="Query"}' },
  { name: "Search DuckDuckGo", link: 'https://duckduckgo.com/?q={argument name="Query"}' },
  { name: "Search Google Images", link: 'https://google.com/search?q={argument name="Query"}&tbm=isch' },
  { name: "Search Wikipedia", link: 'https://en.wikipedia.org/w/index.php?search={argument name="Query"}' },
  { name: "Search Hacker News", link: 'https://hn.algolia.com/?q={argument name="Query"}' },
  { name: "Search YouTube", link: 'https://www.youtube.com/results?search_query={argument name="Query"}' },
  { name: "Search Unsplash", link: 'https://unsplash.com/s/photos/{argument name="Query"}' },
  { name: "Search Stack Overflow", link: 'https://stackoverflow.com/search?q={argument name="Query"}' },
  { name: "Search Twitter", link: 'https://twitter.com/search?q={argument name="Query"}' },
  { name: "Search Dribbble", link: 'https://dribbble.com/search/{argument name="Query"}' },
  { name: "Search Giphy", link: 'https://giphy.com/{argument name="Query"}' },
  { name: "Search LinkedIn", link: 'https://www.linkedin.com/search/results/all/?keywords={argument name="Query"}' },
  {
    name: "Search Translate",
    link:
      'https://translate.google.com/?sl={argument name="Source Language" default="auto"}&tl={argument name="Target Language"}&text={argument name="Word"}&op=translate',
  },
  { name: "Search Google Maps", link: 'https://www.google.com/maps/search/{argument name="Place"}' },
  { name: "Search App Store", link: 'itms-apps://itunes.apple.com/search?term={argument name="App"}' },
]);

const FILE_LINK_PATTERN = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~(\/|$)|file:\/\/)/;

export function isFileLink(link: string): boolean {
  return FILE_LINK_PATTERN.test(link);
}

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+|^(?:https?:\/\/|www\.)\S+$/i;

/** `createWithURL`: the root-search entry appears while the term itself is a URL. */
export function isLikelyUrl(term: string): boolean {
  const trimmed = term.trim();
  return trimmed.length > 0 && URL_PATTERN.test(trimmed);
}

export interface ImportEntry {
  name: string;
  link: string;
  icon?: string | null;
  openWith?: string | null;
  tags?: string[];
}

/**
 * Parses an import payload: a bare array or `{"quicklinks":[...]}`, with the confirmed field
 * fallbacks (`link` ← `url`, `openWith` ← `applicationID`). Returns the confirmed error string on
 * anything that is not one of those shapes.
 */
export function parseImportPayload(text: string): { entries: ImportEntry[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Invalid quicklink import format" };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { quicklinks?: unknown[] }).quicklinks)
      ? (parsed as { quicklinks: unknown[] }).quicklinks
      : null;
  if (list === null) return { error: "Invalid quicklink import format" };
  const entries: ImportEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const link = typeof record.link === "string" && record.link ? record.link : typeof record.url === "string" ? record.url : "";
    if (!name || !link) continue;
    entries.push({
      name,
      link,
      icon: typeof record.icon === "string" ? record.icon : typeof record.iconName === "string" ? record.iconName : null,
      openWith:
        typeof record.openWith === "string" ? record.openWith : typeof record.applicationID === "string" ? record.applicationID : null,
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    });
  }
  return { entries };
}

export function useQuicklinks(): {
  quicklinks: QuicklinkEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [quicklinks, setQuicklinks] = useState<QuicklinkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .backend("quicklinks.list", {}, { module: "backend" })
      .then((response) => {
        if (cancelled) return;
        setQuicklinks((response as { quicklinks?: QuicklinkEntry[] }).quicklinks ?? []);
        setError(null);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    const off = onNotification("quicklinks.updated", () => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, [version, refresh]);

  return { quicklinks, loading, error, refresh };
}

export async function openQuicklink(id: string, args: string[]): Promise<string> {
  const response = (await ipc.backend("quicklinks.open", { id, arguments: args }, { module: "backend" })) as {
    url?: string;
  };
  return response.url ?? "";
}

export async function copyResolvedLink(link: string, args: string[]): Promise<string> {
  const response = (await ipc.backend("quicklinks.resolve", { link, arguments: args }, { module: "backend" })) as {
    link?: string;
  };
  return response.link ?? "";
}

/** `createWithURL`: the prefill handed to the create form when the view opens from root search. */
let pendingCreateLink: string | null = null;

export function setPendingCreateLink(link: string): void {
  pendingCreateLink = link;
}

export function consumePendingCreateLink(): string | null {
  const value = pendingCreateLink;
  pendingCreateLink = null;
  return value;
}

const WARN_DELETE_KEY = "openray:quicklinks-warn-delete";

export function warnBeforeDelete(): boolean {
  try {
    return localStorage.getItem(WARN_DELETE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setWarnBeforeDelete(value: boolean): void {
  try {
    localStorage.setItem(WARN_DELETE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable keeps the warning on */
  }
}
