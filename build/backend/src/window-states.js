// Per-window saved bounds for the Window Management `Restore` command. Raycast's backend exposes
// `windowManagement.getSavedWindowState`/`saveWindowState`; the exact windowId derivation is
// unconfirmed (see the spec's decisions table), so the clone keys on `exe|title` captured before
// the command ran. Storage is local-only SQLite.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const STATES_DB = process.env.RAYCASTMINI_WINDOW_STATES_DB
  || path.join(process.env.LOCALAPPDATA, "RaycastMini", "window-states.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS window_states (
  key TEXT PRIMARY KEY,
  display_index INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  fullscreen INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;

let db = null;

function initDatabase() {
  if (db) return;
  fs.mkdirSync(path.dirname(STATES_DB), { recursive: true });
  db = new DatabaseSync(STATES_DB);
  db.exec(SCHEMA);
}

function getSavedWindowState(windowId) {
  initDatabase();
  const row = db.prepare("SELECT display_index, x, y, width, height, fullscreen FROM window_states WHERE key = ?").get(windowId);
  if (!row) return null;
  return row.fullscreen
    ? { fullscreen: true }
    : {
        displayIndex: row.display_index,
        position: { x: row.x, y: row.y },
        size: { width: row.width, height: row.height },
      };
}

function saveWindowState(windowId, bounds) {
  initDatabase();
  const now = Date.now();
  if (bounds === "fullscreen" || bounds?.fullscreen) {
    db.prepare(
      `INSERT INTO window_states (key, display_index, x, y, width, height, fullscreen, updated_at)
       VALUES (?, 0, 0, 0, 0, 0, 1, ?)
       ON CONFLICT(key) DO UPDATE SET fullscreen = 1, updated_at = excluded.updated_at`,
    ).run(windowId, now);
    return { ok: true };
  }
  const displayIndex = Number.isFinite(bounds?.displayIndex) ? bounds.displayIndex : 0;
  const position = bounds?.position ?? {};
  const size = bounds?.size ?? {};
  db.prepare(
    `INSERT INTO window_states (key, display_index, x, y, width, height, fullscreen, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(key) DO UPDATE SET
       display_index = excluded.display_index, x = excluded.x, y = excluded.y,
       width = excluded.width, height = excluded.height, fullscreen = 0,
       updated_at = excluded.updated_at`,
  ).run(
    windowId,
    displayIndex,
    Number(position.x) || 0,
    Number(position.y) || 0,
    Number(size.width) || 0,
    Number(size.height) || 0,
    now,
  );
  return { ok: true };
}

function createWindowStates() {
  const handlers = {
    getSavedWindowState: (data) => ({ state: getSavedWindowState(data?.windowId) }),
    saveWindowState: (data) => saveWindowState(data?.windowId, data?.bounds),
  };
  return { handlers };
}

/** Test/cleanup hook: close the SQLite handle so a scratch database can be removed. */
function closeDatabase() {
  db?.close();
  db = null;
}

module.exports = { createWindowStates, getSavedWindowState, saveWindowState, closeDatabase, STATES_DB };
