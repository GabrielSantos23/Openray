// The Store view's backend calls (`store.*` handlers live in build/backend/src/store/).

import { ipc } from "../../ipc";

export interface StoreEntry {
  source: "github" | "uploaded";
  name: string;
  title: string;
  description: string;
  author: string | null;
  categories: string[];
  icon: string | null;
  contributors: string[];
  installed: boolean;
}

export interface StoreStatus {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  error: string | null;
  syncedAt: string | null;
  headCommitDate: string | null;
  extensionCount: number;
  uploadedCount: number;
  installedCount: number;
}

export interface StoreDetail {
  source: "github" | "uploaded";
  name: string;
  title: string;
  description: string;
  author: string | null;
  categories: string[];
  commands: Array<{ name: string; title: string; description: string; mode: string }>;
  contributors: string[];
  lastUpdate: string | null;
  screenshots: string[];
  readme: string | null;
  readmeUrl: string | null;
  installed: boolean;
  runnable: boolean;
  version: string | null;
}

export function fetchStoreStatus(): Promise<StoreStatus> {
  return ipc.backend("store.status", {}) as Promise<StoreStatus>;
}

export function startStoreSync(): Promise<{ started: boolean }> {
  return ipc.backend("store.sync", {}) as Promise<{ started: boolean }>;
}

export function fetchStoreList(query: string, category: string | null = null): Promise<{
  syncedAt: string | null;
  categories: string[];
  extensions: StoreEntry[];
}> {
  return ipc.backend("store.list", { query, category }) as Promise<{
    syncedAt: string | null;
    categories: string[];
    extensions: StoreEntry[];
  }>;
}

export function fetchStoreDetail(name: string, source: "github" | "uploaded"): Promise<StoreDetail> {
  return ipc.backend("store.detail", { name, source }) as Promise<StoreDetail>;
}

export function fetchStoreIcon(name: string, source: "github" | "uploaded"): Promise<string | null> {
  return ipc.backend("store.icon", { name, source }) as Promise<string | null>;
}

export function fetchStoreScreenshot(name: string, screenshotPath: string): Promise<string | null> {
  return ipc.backend("store.screenshot", { name, path: screenshotPath }) as Promise<string | null>;
}

export function installStoreExtension(name: string, source: "github" | "uploaded"): Promise<{ installed: boolean; runnable: boolean; live?: string | null }> {
  return ipc.backend("store.install", { name, source }) as Promise<{ installed: boolean; runnable: boolean; live?: string | null }>;
}

export async function importStoreExtension(): Promise<string | null> {
  const picked = (await ipc.backend("fileSystem.showSelectFolderDialog", { title: "Select a FlowKey extension folder" }, { module: "backend" })) as {
    path?: string | null;
  };
  const sourceDir = picked?.path;
  if (!sourceDir) return null;
  const result = (await ipc.backend("store.import", { sourceDir })) as { name?: string };
  return result.name ?? null;
}

/** An installed FlowKey extension's command, launched through the root-search session path. */
export function launchStoreCommand(uuid: string, commandName: string): void {
  window.dispatchEvent(new CustomEvent("raycast-mini:launch-extension-command", { detail: { uuid, command: commandName } }));
}

// Session-level icon cache: one backend round trip per extension per window.
const iconCache = new Map<string, string | null>();

export async function cachedStoreIcon(name: string, source: "github" | "uploaded"): Promise<string | null> {
  const key = `${source}:${name}`;
  if (iconCache.has(key)) return iconCache.get(key) ?? null;
  try {
    const icon = await fetchStoreIcon(name, source);
    iconCache.set(key, icon);
    return icon;
  } catch {
    iconCache.set(key, null);
    return null;
  }
}
