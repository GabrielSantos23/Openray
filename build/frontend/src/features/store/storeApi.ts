// The Store command's backend surface (`store.*` handlers) and the pushes it emits.
// Kept separate from the view so tests and other callers share one client.

import { ipc, onNotification } from "../../ipc";

export interface CatalogCommand {
  name: string;
  title: string;
  description?: string;
  mode?: string;
  platforms?: string[];
  interval?: string;
}

export interface CatalogExtension {
  handle: string;
  name: string;
  title: string;
  description: string;
  author: string;
  categories: string[];
  version: string;
  updatedAt: number | null;
  commands: CatalogCommand[];
  installed: boolean;
}

export interface StoreCategory {
  name: string;
  count: number;
}

export interface StoreSearchResult {
  commit: string | null;
  /** Total matches on the backend; `extensions` is one page of them. */
  total: number;
  extensions: CatalogExtension[];
}

/** Progress of a catalog refresh push (`store.catalogProgress`). */
export interface CatalogProgress {
  fetched: number;
  total: number;
  done: boolean;
}

export interface StoreDetailCommand {
  name: string;
  title: string;
  description?: string;
  mode?: string;
  class: string;
  reason: string | null;
}

export interface StoreDetail {
  handle: string;
  commit: string;
  manifest: {
    name: string;
    title: string;
    description: string;
    author: string;
    contributors: string[];
    categories: string[];
    platforms: string[];
    icon: string | null;
    updatedAt: number | null;
  };
  commands: StoreDetailCommand[];
  readme: string | null;
  installed: { installedAt: number; commit: string } | null;
}

export interface InstallProgress {
  handle: string;
  step: string;
  message: string;
}

export function storeSearch(query: string, category: string | null, limit = 50, offset = 0): Promise<StoreSearchResult> {
  return ipc.backend("store.search", { query, category, limit, offset }, { module: "backend" }) as Promise<StoreSearchResult>;
}

export function storeCategories(): Promise<{ categories: StoreCategory[] }> {
  return ipc.backend("store.categories", {}, { module: "backend" }) as Promise<{ categories: StoreCategory[] }>;
}

export function storeDetail(handle: string): Promise<StoreDetail> {
  return ipc.backend("store.detail", { handle }, { module: "backend" }) as Promise<StoreDetail>;
}

export function storeRefreshCatalog(): Promise<{ commit: string; handles: number; fetched: number; failed: number; cached: boolean }> {
  return ipc.backend("store.refreshCatalog", {}, { module: "backend", timeoutMs: 0 }) as Promise<{ commit: string; handles: number; fetched: number; failed: number; cached: boolean }>;
}

export function storeInstall(handle: string): Promise<unknown> {
  return ipc.backend("store.install", { handle, confirmed: true }, { module: "backend", timeoutMs: 0 });
}

export function storeUninstall(handle: string): Promise<unknown> {
  return ipc.backend("store.uninstall", { handle }, { module: "backend", timeoutMs: 0 });
}

export function storeCheckForUpdates(): Promise<{ updates: Array<{ handle: string; title: string }> }> {
  return ipc.backend("store.checkForUpdates", {}, { module: "backend" }) as Promise<{ updates: Array<{ handle: string; title: string }> }>;
}

/** Per-extension/command classification rows for the renderer (gating in root search). */
export function storeSummariesCompat(): Promise<{ compat: Record<string, { badge: string | null; commands: Record<string, { class: string; reason: string | null }> }> }> {
  return ipc.backend("store.getSummariesCompat", {}, { module: "backend" }) as Promise<{ compat: Record<string, { badge: string | null; commands: Record<string, { class: string; reason: string | null }> }> }>;
}

export function storeGetCommandPreferences(uuid: string, commandName: string): Promise<{ preferences: Record<string, unknown> }> {
  return ipc.backend("store.getCommandPreferences", { uuid, commandName }, { module: "backend" }) as Promise<{ preferences: Record<string, unknown> }>;
}

export function storeSetCommandPreferences(uuid: string, commandName: string, preferences: Record<string, unknown>): Promise<unknown> {
  return ipc.backend("store.setCommandPreferences", { uuid, commandName, preferences }, { module: "backend" });
}

export function storeGetInstalled(): Promise<{ extensions: Array<{ uuid: string; handle: string; title: string; commit_sha: string; updated_at: number }> }> {
  return ipc.backend("store.getInstalled", {}, { module: "backend" }) as Promise<{ extensions: Array<{ uuid: string; handle: string; title: string; commit_sha: string; updated_at: number }> }>;
}

/** Subscribe to install/uninstall progress and completion pushes. */
export function onStoreProgress(handler: (progress: InstallProgress) => void): () => void {
  return onNotification("store.progress", handler as (data: unknown) => void);
}

export function onStoreInstalled(handler: (payload: { handle: string; removed?: boolean }) => void): () => void {
  return onNotification("store.installed", handler as (data: unknown) => void);
}

/** Subscribe to catalog refresh progress pushes (rows landing in the cache while fetching). */
export function onStoreCatalogProgress(handler: (progress: CatalogProgress) => void): () => void {
  return onNotification("store.catalogProgress", handler as (data: unknown) => void);
}

/** The installed extension's manifest icon as a data URL, or null when it has none. */
export function storeGetIcon(uuid: string): Promise<{ icon: string | null }> {
  return ipc.backend("store.getIcon", { uuid }, { module: "backend" }) as Promise<{ icon: string | null }>;
}
