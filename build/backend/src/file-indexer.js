// File search indexer for Windows - builds a local file index with file watcher
// Runs in the Node backend process

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const INDEX_DB_PATH = path.join(
  process.env.LOCALAPPDATA,
  "RaycastMini",
  "file-index.sqlite"
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  folder TEXT NOT NULL,
  modified_time INTEGER NOT NULL,
  size INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS file_index_name ON file_index (name);
CREATE INDEX IF NOT EXISTS file_index_folder ON file_index (folder);
CREATE INDEX IF NOT EXISTS file_index_modified ON file_index (modified_time DESC);
CREATE INDEX IF NOT EXISTS file_index_extension ON file_index (extension);
`;

let db = null;
let watchers = new Map();
let config = {
  enabled: false,
  includedFolders: [],
  excludedFolders: [],
  extensions: [],
  maxResults: 50,
};

function initDatabase() {
  if (!fs.existsSync(path.dirname(INDEX_DB_PATH))) {
    fs.mkdirSync(path.dirname(INDEX_DB_PATH), { recursive: true });
  }
  db = new DatabaseSync(INDEX_DB_PATH);
  db.exec(SCHEMA);
}

function normalizePath(p) {
  return p.replace(/\\/g, "/").toLowerCase();
}

function shouldIncludePath(p, cfg) {
  const normalized = normalizePath(p);
  
  for (const excluded of cfg.excludedFolders) {
    if (normalized.includes(normalizePath(excluded))) {
      return false;
    }
  }
  
  if (cfg.includedFolders.length > 0) {
    let included = false;
    for (const inc of cfg.includedFolders) {
      if (normalized.startsWith(normalizePath(inc))) {
        included = true;
        break;
      }
    }
    if (!included) return false;
  }
  
  return true;
}

function isExtensionAllowed(filename, cfg) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return cfg.extensions.length === 0 || cfg.extensions.includes(ext);
}

function indexFile(filePath, stats) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const name = path.basename(filePath);
  const folder = path.dirname(filePath);
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO file_index (path, name, extension, folder, modified_time, size, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(filePath, name, ext, folder, stats.mtimeMs, stats.size, Date.now());
}

function removeFromIndex(filePath) {
  const stmt = db.prepare("DELETE FROM file_index WHERE path = ?");
  stmt.run(filePath);
}

async function indexFolder(folderPath, cfg) {
  if (!shouldIncludePath(folderPath, cfg)) return;
  
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        await indexFolder(fullPath, cfg);
      } else if (entry.isFile()) {
        if (isExtensionAllowed(entry.name, cfg)) {
          try {
            const stats = fs.statSync(fullPath);
            indexFile(fullPath, stats);
          } catch {
            // Ignore permission errors
          }
        }
      }
    }
  } catch {
    // Ignore permission errors
  }
}

async function buildIndex(cfg) {
  config = { ...config, ...cfg };
  initDatabase();
  
  // Clear existing index for included folders
  for (const folder of config.includedFolders) {
    const normalized = normalizePath(folder);
    db.prepare("DELETE FROM file_index WHERE folder LIKE ?").run(normalizePath(folder) + "%");
  }
  
  // Index all included folders
  for (const folder of config.includedFolders) {
    await indexFolder(folder, config);
  }
  
  // Setup watchers
  setupWatchers();
}

function setupWatchers() {
  // Clear existing watchers
  for (const [, watcher] of watchers) {
    watcher.close();
  }
  watchers.clear();
  
  for (const folder of config.includedFolders) {
    try {
      const watcher = fs.watch(folder, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(folder, filename);
        if (eventType === "rename") {
          // Check if file still exists
          if (fs.existsSync(fullPath)) {
            try {
              const stats = fs.statSync(fullPath);
              if (stats.isFile() && isExtensionAllowed(filename, config)) {
                indexFile(fullPath, stats);
              }
            } catch {
              // File was deleted
              removeFromIndex(fullPath);
            }
          } else {
            // File was deleted or renamed away
            removeFromIndex(fullPath);
          }
        } else if (eventType === "change") {
          try {
            const stats = fs.statSync(fullPath);
            if (stats.isFile() && isExtensionAllowed(filename, config)) {
              indexFile(fullPath, stats);
            }
          } catch {
            // File might have been deleted
          }
        }
      });
      watchers.set(folder, watcher);
    } catch {
      // Ignore permission errors
    }
  }
}

function searchFiles(query, cfg, usageScores) {
  if (!cfg.enabled || !query.trim()) return [];
  
  const searchTerm = query.trim().toLowerCase();
  const likePattern = `%${searchTerm}%`;
  
  const extensions = config.extensions.length > 0 ? config.extensions : [""];
  const placeholders = extensions.map(() => "?").join(",");
  
  const stmt = db.prepare(`
    SELECT path, name, extension, folder, modified_time, size
    FROM file_index
    WHERE (name LIKE ? OR path LIKE ?)
    AND extension IN (${placeholders})
    ORDER BY 
      CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
      modified_time DESC
    LIMIT ?
  `);
  
  const params = [likePattern, likePattern, ...extensions, likePattern, config.maxResults];
  
  const rows = stmt.all(...params);
  
  const results = rows.map(row => ({
    path: row.path,
    name: row.name,
    extension: row.extension,
    folder: row.folder,
    modifiedTime: row.modified_time,
    size: row.size,
  }));
  
  // Apply usage scoring
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

function getConfig() {
  return { ...config };
}

function setConfig(cfg) {
  config = { ...config, ...cfg };
}

function createFileIndexer({ dispatch }) {
  const handlers = {
    "fileSearch.buildIndex": async (data) => {
      await buildIndex(data.config);
      return { ok: true };
    },
    "fileSearch.search": (data) => {
      // usageScores would come from the backend store
      const usageScores = new Map(); // TODO: integrate with usage store
      const results = searchFiles(data.query, config, usageScores);
      return { results };
    },
    "fileSearch.getConfig": () => {
      return { config: getConfig() };
    },
    "fileSearch.setConfig": (data) => {
      setConfig(data.config);
      return { ok: true };
    },
    "fileSearch.trackUsage": (data) => {
      // Track file usage for ranking
      // This would be stored in a separate usage table
      return { ok: true };
    },
  };
  
  return { handlers };
}

module.exports = {
  createFileIndexer,
  buildIndex,
  searchFiles,
  getConfig,
  setConfig,
  initDatabase,
};