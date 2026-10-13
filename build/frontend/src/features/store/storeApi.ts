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
  extensions: CatalogExtension[];
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

export function storeSearch(query: string, category: string | null): Promise<StoreSearchResult> {
  return ipc.backend("store.search", { query, category }, { module: "backend" }) as Promise<StoreSearchResult>;
}

export function storeCategories(): Promise<{ categories: StoreCategory[] }> {
  return ipc.backend("store.categories", {}, { module: "backend" }) as Promise<{ categories: StoreCategory[] }>;
}

export function storeDetail(handle: string): Promise<StoreDetail> {
  return ipc.backend("store.detail", { handle }, { module: "backend" }) as Promise<StoreDetail>;
}

export function storeRefreshCatalog(): Promise<{ commit: string; fetched: number }> {
  return ipc.backend("store.refreshCatalog", {}, { module: "backend" }) as Promise<{ commit: string; fetched: number }>;
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
