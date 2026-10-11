// File Search frontend client — Raycast's internal `file-search` extension (docs/file-search-spec.md).
// All state lives in the backend indexer (`file-index.sqlite` + `file-search-settings.json`); this
// module is a thin typed wrapper over `fileSearch.*` plus the confirmed action set for file rows.

import { ipc } from "./ipc";
import type { ActionGroup } from "./ActionPanel";

export interface FileSearchSettings {
  showInRootSearch: boolean;
  contentSearch: boolean;
  contentSearchInRootSearch: boolean;
  includeHiddenFiles: boolean;
  respectIgnoreFiles: boolean;
  ignore: string[];
  include: string[];
}

export interface FileSearchRow {
  path: string;
  name: string;
  extension: string;
  folder: string;
  parentFolder: string;
  modifiedTime: number;
  createdTime: number;
  size: number;
  contentType: string;
  hidden: boolean;
  usageCount: number;
}

export interface FileIndexState {
  state: "idle" | "indexing" | "stopped" | "failed";
  fileCount: number;
  entriesPerSecond?: number | null;
  durationMs?: number;
}

export interface FileMetadata {
  name: string;
  where: string;
  type: string;
  size: number | null;
  created: number;
  modified: number;
  accessed: number;
}

/** The confirmed `Filter by Type` dropdown (content-type bitflag categories + Directory/File). */
export const FILE_TYPE_FILTERS = [
  { value: "all", label: "All Types" },
  { value: "directory", label: "Directory" },
  { value: "file", label: "File" },
  { value: "archive", label: "Archive" },
  { value: "document", label: "Document" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "text", label: "Text" },
  { value: "other", label: "Other" },
] as const;

/** The confirmed sort dropdown, offered once a query is set. */
export const FILE_SORT_OPTIONS = [
  { value: "modified", label: "Date Modified" },
  { value: "created", label: "Date Created" },
  { value: "name", label: "Name" },
] as const;

export async function fetchFileSettings(): Promise<FileSearchSettings> {
  const response = (await ipc.backend("fileSearch.getSettings", {}, { module: "backend" })) as {
    settings?: FileSearchSettings;
  };
  return response.settings as FileSearchSettings;
}

export async function saveFileSettings(patch: Partial<FileSearchSettings>): Promise<FileSearchSettings> {
  const response = (await ipc.backend("fileSearch.setSettings", patch, { module: "backend" })) as {
    settings?: FileSearchSettings;
  };
  return response.settings as FileSearchSettings;
}

export async function resetFileSettings(): Promise<FileSearchSettings> {
  const response = (await ipc.backend("fileSearch.resetToDefaults", {}, { module: "backend" })) as {
    settings?: FileSearchSettings;
  };
  return response.settings as FileSearchSettings;
}

export async function fetchIndexState(): Promise<FileIndexState> {
  const response = (await ipc.backend("fileSearch.getState", {}, { module: "backend" })) as FileIndexState;
  return response;
}

export async function startIndexing(): Promise<void> {
  await ipc.backend("fileSearch.startIndexing", {}, { module: "backend" });
}

export async function stopIndexing(): Promise<void> {
  await ipc.backend("fileSearch.stopIndexing", {}, { module: "backend" });
}

export async function excludeFromIndex(path: string): Promise<FileSearchSettings> {
  const response = (await ipc.backend("fileSearch.excludeFromIndex", { path }, { module: "backend" })) as {
    settings?: FileSearchSettings;
  };
  return response.settings as FileSearchSettings;
}

export async function fetchFileResults(
  query: string,
  options: { type?: string; sort?: string; limit?: number } = {},
): Promise<FileSearchRow[]> {
  const response = (await ipc.backend(
    "fileSearch.search",
    { query, ...options },
    { module: "backend" },
  )) as { results?: FileSearchRow[] };
  return response.results ?? [];
}

export async function fetchFileMetadata(path: string): Promise<FileMetadata | null> {
  try {
    const response = (await ipc.backend("fileSearch.getMetadata", { path }, { module: "backend" })) as FileMetadata;
    return response;
  } catch {
    return null;
  }
}

export function trackFileUsage(path: string): void {
  void ipc.backend("fileSearch.trackUsage", { path }, { module: "backend" }).catch(() => {
    /* usage tracking must never break opening a file */
  });
}

/** The confirmed `Open in File Explorer` fallback triggers on path-like queries. */
export function looksLikeFilePath(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;
  return /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("~") || /[\\/]/.test(trimmed);
}

/** The icon the launcher and the view render per content type. */
export function fileIconFor(contentType: string): string {
  switch (contentType) {
    case "directory":
      return "folder";
    case "image":
      return "image";
    case "video":
      return "film";
    case "audio":
      return "music";
    case "archive":
      return "archive";
    case "document":
      return "file-text";
    case "text":
      return "file-text";
    default:
      return "file";
  }
}

export function formatFileSize(size: number | null): string {
  if (size === null || size === undefined) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Raycast's exact action groups for a file or folder result (docs/file-search-spec.md). */
export function fileActionGroups(
  row: { path: string; name: string; contentType: string },
  options: { indexing: boolean; openWith?: boolean },
): ActionGroup[] {
  return [
    {
      name: "general",
      actions: [
        { id: "file:open", title: "Open", itemId: row.path },
        { id: "file:reveal", title: "Show in File Explorer", itemId: row.path },
        ...(options.openWith && row.contentType !== "directory"
          ? [{ id: "file:openWith", title: "Open With…", itemId: row.path }]
          : []),
      ],
    },
    {
      name: "copy",
      actions: [
        { id: "file:copyName", title: "Copy Name", itemId: row.path },
        // The confirmed `Copy Path` copies the quoted path.
        { id: "file:copyPath", title: "Copy Path", itemId: row.path },
      ],
    },
    {
      name: "configure",
      actions: [
        { id: "file:quicklink", title: "Save as Quicklink", itemId: row.path },
        { id: "file:exclude", title: "Exclude From Index", itemId: row.path },
        ...(options.indexing
          ? [{ id: "file:stopIndexing", title: "Stop Indexing", itemId: row.path }]
          : [{ id: "file:index", title: "Index Files", itemId: row.path }]),
      ],
    },
    {
      name: "danger",
      actions: [{ id: "file:delete", title: "Delete", style: "Destructive", itemId: row.path }],
    },
  ];
}

/** Callbacks the launcher/view supplies so file actions can touch shared UI state. */
export interface FileActionHandlers {
  showToast: (title: string, message?: string) => void;
  refresh: () => void;
  openWith: (path: string) => void;
  saveAsQuicklink: (row: FileSearchRow) => void;
}

/** Maps a chosen action onto the backend method that performs it. */
export async function runFileAction(
  row: FileSearchRow,
  actionId: string,
  handlers: FileActionHandlers,
): Promise<void> {
  const action = actionId.includes(":") ? actionId.slice(actionId.indexOf(":") + 1) : actionId;
  switch (action) {
    case "open":
      trackFileUsage(row.path);
      await ipc.backend("fileSystem.openFile", { path: row.path }, { module: "backend" });
      return;
    case "reveal":
      await ipc.backend("shell.revealFile", { path: row.path }, { module: "backend" });
      return;
    case "openWith":
      handlers.openWith(row.path);
      return;
    case "copyName":
      await ipc.backend("clipboard.write", { content: row.name }, { module: "backend" });
      handlers.showToast("Copied to clipboard", row.name);
      return;
    case "copyPath":
      // Confirmed: `Copy Path` copies the quoted path.
      await ipc.backend("clipboard.write", { content: `"${row.path}"` }, { module: "backend" });
      handlers.showToast("Copied to clipboard", row.path);
      return;
    case "quicklink":
      handlers.saveAsQuicklink(row);
      return;
    case "exclude": {
      await excludeFromIndex(row.path);
      handlers.showToast("Excluded from index", row.name);
      handlers.refresh();
      return;
    }
    case "index":
      await startIndexing();
      handlers.showToast("Indexing Files…");
      return;
    case "stopIndexing":
      await stopIndexing();
      handlers.showToast("Indexing Stopped");
      return;
    case "delete":
      await ipc.backend("fileSystem.moveToTrash", { path: row.path }, { module: "backend" });
      handlers.showToast("Deleted file");
      handlers.refresh();
      return;
    default:
      return;
  }
}
