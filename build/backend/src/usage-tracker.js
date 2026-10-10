// Usage tracking store - tracks app usage, file usage, and argument history
// Runs in the Node backend process with SQLite

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const USAGE_DB_PATH = path.join(
  process.env.LOCALAPPDATA,
  "RaycastMini",
  "usage-tracking.sqlite"
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_usage (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS file_usage (
  path TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS argument_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL,
  argument_name TEXT NOT NULL,
  value TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  UNIQUE(command_id, argument_name, value)
);
CREATE INDEX IF NOT EXISTS argument_history_cmd_arg ON argument_history (command_id, argument_name);
`;

let db = null;
let lastTimestamp = "";
let timestampCounter = 0;

function nextTimestamp() {
  const now = new Date().toISOString();
  if (now === lastTimestamp) {
    timestampCounter++;
    const base = now.slice(0, -1); // Remove 'Z'
    const ms = parseInt(now.slice(-4, -1), 10) || 0;
    const newMs = (ms + timestampCounter) % 1000;
    lastTimestamp = `${base}${newMs.toString().padStart(3, '0')}Z`;
  } else {
    lastTimestamp = now;
    timestampCounter = 0;
  }
  return lastTimestamp;
}

function initDatabase() {
  const dir = path.dirname(USAGE_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new DatabaseSync(USAGE_DB_PATH);
  db.exec(SCHEMA);
}

function migrateFromLocalStorage(localStorageData) {
  // Called once to migrate existing localStorage data
  if (!localStorageData) return;
  
  for (const [key, value] of Object.entries(localStorageData)) {
    if (key.startsWith("raycast-mini:usage:")) {
      const appId = key.slice("raycast-mini:usage:".length);
      const count = Number.parseInt(value, 10) || 0;
      if (count > 0) {
        incrementAppUsage(appId, count);
      }
    } else if (key.startsWith("raycast-mini:file-usage:")) {
      const filePath = key.slice("raycast-mini:file-usage:".length);
      const count = Number.parseInt(value, 10) || 0;
      if (count > 0) {
        incrementFileUsage(filePath, count);
      }
    } else if (key.startsWith("raycast-mini:argument-history:")) {
      const parts = key.slice("raycast-mini:argument-history:".length).split(":");
      if (parts.length === 2) {
        const [commandId, argumentName] = parts;
        const values = JSON.parse(value);
        for (const val of values) {
          addArgumentHistory(commandId, argumentName, val);
        }
      }
    }
  }
}

// App usage tracking
function incrementAppUsage(appId, count = 1) {
  if (!db) initDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO app_usage (id, count, last_used_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      count = count + ?,
      last_used_at = ?
  `);
  stmt.run(appId, count, now, now, count, now);
}

function getAppUsage(appId) {
  if (!db) initDatabase();
  const row = db.prepare("SELECT count FROM app_usage WHERE id = ?").get(appId);
  return row ? row.count : 0;
}

function getAllAppUsage() {
  if (!db) initDatabase();
  const rows = db.prepare("SELECT id, count FROM app_usage").all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, row.count);
  }
  return map;
}

function resetAppUsage(appId) {
  if (!db) initDatabase();
  db.prepare("DELETE FROM app_usage WHERE id = ?").run(appId);
}

function resetAllAppUsage() {
  if (!db) initDatabase();
  db.prepare("DELETE FROM app_usage").run();
}

// File usage tracking
function incrementFileUsage(filePath, count = 1) {
  if (!db) initDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO file_usage (path, count, last_used_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      count = count + ?,
      last_used_at = ?
  `);
  stmt.run(filePath, count, now, now, count, now);
}

function getFileUsage(filePath) {
  if (!db) initDatabase();
  const row = db.prepare("SELECT count FROM file_usage WHERE path = ?").get(filePath);
  return row ? row.count : 0;
}

function getAllFileUsage() {
  if (!db) initDatabase();
  const rows = db.prepare("SELECT path, count FROM file_usage").all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.path, row.count);
  }
  return map;
}

// Argument history
function addArgumentHistory(commandId, argumentName, value) {
  if (!db) initDatabase();
  if (!value || value.trim().length === 0) return;
  
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO argument_history (command_id, argument_name, value, used_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(commandId, argumentName, value.trim(), Date.now());
}

function getArgumentHistory(commandId, argumentName, limit = 10) {
  if (!db) initDatabase();
  const rows = db.prepare(`
    SELECT value FROM argument_history
    WHERE command_id = ? AND argument_name = ?
    ORDER BY used_at DESC
    LIMIT ?
  `).all(commandId, argumentName, limit);
  return rows.map(r => r.value);
}

function createUsageTracker({ dispatch }) {
  initDatabase();
  
  const handlers = {
    getAppUsage: (data) => {
      return { usage: getAllAppUsage() };
    },
    incrementAppUsage: (data) => {
      incrementAppUsage(data.appId, data.count);
      return { ok: true };
    },
    resetAppUsage: (data) => {
      resetAppUsage(data.appId);
      return { ok: true };
    },
    resetAllAppUsage: () => {
      resetAllAppUsage();
      return { ok: true };
    },
    getFileUsage: (data) => {
      return { usage: getAllFileUsage() };
    },
    incrementFileUsage: (data) => {
      incrementFileUsage(data.filePath, data.count);
      return { ok: true };
    },
    getArgumentHistory: (data) => {
      const history = getArgumentHistory(data.commandId, data.argumentName, data.limit);
      return { history };
    },
    addArgumentHistory: (data) => {
      addArgumentHistory(data.commandId, data.argumentName, data.value);
      return { ok: true };
    },
    migrateFromLocalStorage: (data) => {
      migrateFromLocalStorage(data.data);
      return { ok: true };
    },
  };
  
  return { handlers };
}

module.exports = {
  createUsageTracker,
  initDatabase,
  incrementAppUsage,
  getAppUsage,
  getAllAppUsage,
  resetAppUsage,
  resetAllAppUsage,
  incrementFileUsage,
  getFileUsage,
  getAllFileUsage,
  addArgumentHistory,
  getArgumentHistory,
  migrateFromLocalStorage,
};