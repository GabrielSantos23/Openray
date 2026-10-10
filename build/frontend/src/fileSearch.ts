// File search implementation for Raycast Mini root search
// Provides file indexing and searching capabilities via backend IPC

export interface FileSearchConfig {
  enabled: boolean;
  includedFolders: string[];
  excludedFolders: string[];
  extensions: string[];
  maxResults: number;
}

export interface FileResult {
  path: string;
  name: string;
  extension: string;
  folder: string;
  modifiedTime: number;
  size: number;
}

// Default configuration
export const DEFAULT_FILE_SEARCH_CONFIG: FileSearchConfig = {
  enabled: false,
  includedFolders: [],
  excludedFolders: [],
  extensions: [
    "txt", "md", "js", "ts", "tsx", "json", "html", "css", "scss",
    "py", "rs", "go", "java", "kt", "swift", "cpp", "c", "h", "hpp",
    "cs", "php", "rb", "sh", "bat", "ps1", "xml", "yaml", "yml",
    "toml", "ini", "cfg", "conf", "config", "sql", "db", "sqlite",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
    "mp3", "mp4", "wav", "avi", "mov", "mkv",
    "zip", "tar", "gz", "rar", "7z",
    "exe", "msi", "dll", "so", "dylib",
  ],
  maxResults: 50,
};

// Load config from localStorage (for UI state)
export function loadFileSearchConfig(): FileSearchConfig {
  try {
    const stored = localStorage.getItem("raycast-mini:file-search-config");
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_FILE_SEARCH_CONFIG, ...parsed };
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_FILE_SEARCH_CONFIG;
}

// Save config to localStorage (for UI state)
export function saveFileSearchConfig(config: FileSearchConfig): void {
  try {
    localStorage.setItem("raycast-mini:file-search-config", JSON.stringify(config));
  } catch {
    // Ignore errors
  }
}

// Search files via backend IPC
export async function searchFiles(
  query: string,
  config: FileSearchConfig,
  usageScores: Map<string, number>
): Promise<FileResult[]> {
  if (!config.enabled || query.trim().length === 0) {
    return [];
  }

  try {
    // Import ipc dynamically to avoid circular dependency
    const { ipc } = await import("./ipc");
    const response = await ipc.backend("fileSearch.search", { query, config }, { module: "backend" });
    const data = response as { results?: FileResult[] };
    if (data.results) {
      // Apply usage scoring on the frontend
      const results = data.results;
      results.sort((a, b) => {
        const searchTerm = query.trim().toLowerCase();
        const aNameMatch = a.name.toLowerCase().includes(searchTerm);
        const bNameMatch = b.name.toLowerCase().includes(searchTerm);
        
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        
        const aUsage = usageScores.get(a.path) ?? 0;
        const bUsage = usageScores.get(b.path) ?? 0;
        if (aUsage !== bUsage) return bUsage - aUsage;
        
        return b.modifiedTime - a.modifiedTime;
      });
      
      return results.slice(0, config.maxResults);
    }
  } catch (error) {
    console.warn("[fileSearch] IPC search failed:", error);
  }
  
  return [];
}

// Track file usage (stored in localStorage for now, will move to backend)
export function trackFileUsage(filePath: string): void {
  try {
    const key = `raycast-mini:file-usage:${filePath}`;
    const raw = localStorage.getItem(key);
    const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
    localStorage.setItem(key, String(count + 1));
  } catch {
    // Ignore errors
  }
}

// Load file usage scores from localStorage
export function loadFileUsageScores(): Map<string, number> {
  const scores = new Map<string, number>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("raycast-mini:file-usage:")) {
        const filePath = key.slice("raycast-mini:file-usage:".length);
        const count = Number.parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
        scores.set(filePath, count);
      }
    }
  } catch {
    // Ignore errors
  }
  return scores;
}

// Build file index (called from Settings)
export async function buildFileIndex(config: FileSearchConfig): Promise<void> {
  try {
    const { ipc } = await import("./ipc");
    await ipc.backend("fileSearch.buildIndex", { config }, { module: "backend" });
  } catch (error) {
    console.warn("[fileSearch] IPC buildIndex failed:", error);
  }
}

// Get file search config from backend
export async function getFileSearchConfig(): Promise<FileSearchConfig> {
  try {
    const { ipc } = await import("./ipc");
    const response = await ipc.backend("fileSearch.getConfig", {}, { module: "backend" });
    const data = response as { config?: FileSearchConfig };
    return data.config ?? DEFAULT_FILE_SEARCH_CONFIG;
  } catch {
    return DEFAULT_FILE_SEARCH_CONFIG;
  }
}

// Set file search config in backend
export async function setFileSearchConfig(config: FileSearchConfig): Promise<void> {
  try {
    const { ipc } = await import("./ipc");
    await ipc.backend("fileSearch.setConfig", { config }, { module: "backend" });
  } catch (error) {
    console.warn("[fileSearch] IPC setConfig failed:", error);
  }
}