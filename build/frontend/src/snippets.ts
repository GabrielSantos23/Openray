// The Snippets internal extension — data layer.
//
// Mirrors the shipped contracts in `docs/snippets-spec.md`: the store fields, the confirmed import
// format (`{name, text, keyword?|alias?}` in a bare array or `{"snippets":[...]}`), the delete
// warning flag (localStorage `settings-snippets-remember-delete`) and the per-command primary
// action (`paste` | `copy`, default `paste`).

import { useCallback, useEffect, useState } from "react";
import { ipc, onNotification } from "./ipc";

export interface SnippetEntry {
  id: string;
  title: string;
  keyword: string | null;
  text: string;
  tags: string[];
  pinned: number | null;
  copyCount: number;
  accessedAt: number;
  createdAt: number;
  updatedAt: number;
}

export function useSnippets(): {
  snippets: SnippetEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [snippets, setSnippets] = useState<SnippetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .backend("snippets.list", {}, { module: "backend" })
      .then((response) => {
        if (cancelled) return;
        setSnippets((response as { snippets?: SnippetEntry[] }).snippets ?? []);
        setError(null);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    const off = onNotification("snippets.updated", () => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, [version, refresh]);

  return { snippets, loading, error, refresh };
}

/** Resolves a snippet's placeholders in the backend (`{clipboard}`, `{date}`, nested `{snippet}`…). */
export async function resolveSnippet(options: { snippetId?: string; text?: string }): Promise<{
  text: string;
  cursor: number | null;
}> {
  const response = (await ipc.backend("snippets.resolve", options, { module: "backend" })) as {
    text?: string;
    cursor?: number | null;
  };
  return { text: response.text ?? "", cursor: response.cursor ?? null };
}

export interface SnippetImportEntry {
  name: string;
  text: string;
  keyword?: string | null;
  tags?: string[];
}

/**
 * Parses an import payload: a bare array or `{"snippets":[...]}`, with the confirmed field fallback
 * (`keyword` ← `alias`). Returns the confirmed error string on anything that is not one of those
 * shapes.
 */
export function parseImportPayload(text: string): { entries: SnippetImportEntry[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Invalid snippet import format" };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { snippets?: unknown[] }).snippets)
      ? (parsed as { snippets: unknown[] }).snippets
      : null;
  if (list === null) return { error: "Invalid snippet import format" };
  const entries: SnippetImportEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const body = typeof record.text === "string" && record.text ? record.text : typeof record.content === "string" ? record.content : "";
    if (!name || !body) continue;
    const keyword =
      typeof record.keyword === "string" && record.keyword ? record.keyword : typeof record.alias === "string" ? record.alias : null;
    entries.push({
      name,
      text: body,
      keyword,
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    });
  }
  return { entries };
}

const WARN_DELETE_KEY = "settings-snippets-remember-delete";

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

const PRIMARY_ACTION_KEY = "settings-snippets-primary-action";

export type SnippetPrimaryAction = "paste" | "copy";

export function primaryAction(): SnippetPrimaryAction {
  try {
    const stored = localStorage.getItem(PRIMARY_ACTION_KEY);
    return stored === "copy" ? "copy" : "paste";
  } catch {
    return "paste";
  }
}

export function setPrimaryAction(value: SnippetPrimaryAction): void {
  try {
    localStorage.setItem(PRIMARY_ACTION_KEY, value);
  } catch {
    /* storage unavailable keeps the default */
  }
}
