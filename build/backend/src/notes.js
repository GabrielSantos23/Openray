// Notes handler — the `notes.*` table in the clone's backend.
//
// Mirrors the shipped store contract (docs/notes-spec.md): fields title/text plus pinned and the
// three timestamps, the confirmed handler surface create|update (expectedUpdatedAt → ok|conflict)|
// delete|deleteAll|pin|unpin|movePinnedUp|movePinnedDown|list|browse|count|getWindowData|
// getCurrentWindowData|setCurrentNote|touchAccessed|listDeleted|recoverNote|permanentlyDelete|
// emptyTrash|purgeOldDeletedNotes, and the 60-day trash purge. Notes are sensitive text: logs carry
// ids and counts only, never titles or content.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { markdownToHtml, toPlainText, deriveTitle, htmlToMarkdown } = require("./notes-markdown");

const TRASH_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.0;
const ESCAPE_BEHAVIORS = new Set(["closesWindow", "losesFocus"]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  pinned_order INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`;

const DEFAULT_PREFERENCES = {
  zoom: 1,
  escapeKeyBehavior: "closesWindow",
  windowAutoSizing: true,
  currentNoteId: null,
  onboarded: false,
};

const WELCOME_NOTE = `# Welcome to Openray Notes

Everything you type here is saved automatically, and the note title follows the first line.

## Browsing notes

Use \`Browse Notes\` in the top bar to search and switch between notes, or \`Search Notes\` from the
launcher to jump straight to one.

## Resizing

The window keeps its size between notes. Turn \`Window Auto-Sizing\` off in the action panel (Ctrl K)
once you have resized it by hand.

## Actions

Press \`Ctrl K\` for the action panel: pin this note, copy it as Markdown, HTML or plain text, export
it to a file, or delete it (deleted notes stay in Recently Deleted for 60 days).`;

function createNotes({ dispatch, pushToFrontend, dataRoot, now = () => Date.now() } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  const databasePath = path.join(root, "notes.sqlite");
  const settingsPath = path.join(root, "notes-settings.json");

  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA);

  const preferences = { ...DEFAULT_PREFERENCES };
  try {
    Object.assign(preferences, JSON.parse(fs.readFileSync(settingsPath, "utf-8")));
  } catch {
    /* first run keeps the defaults */
  }

  function persistPreferences() {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(preferences, null, 2));
    } catch (error) {
      console.error("[notes] could not persist preferences", error);
    }
  }

  function rowToNote(row) {
    return {
      id: row.id,
      title: row.title,
      text: row.text,
      pinned: row.pinned_order ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at,
      ...(row.deleted_at !== null && row.deleted_at !== undefined ? { deletedAt: row.deleted_at } : {}),
      charCount: row.text.length,
    };
  }

  function notifyChanged() {
    if (typeof pushToFrontend === "function") {
      Promise.resolve(pushToFrontend("notes.updated", {})).catch(() => undefined);
    }
  }

  /** Recency order — the list the window's previous/next navigation and Browse share. */
  function recencyRows() {
    return db
      .prepare(
        `SELECT * FROM notes WHERE deleted_at IS NULL
         ORDER BY CASE WHEN pinned_order IS NULL THEN 1 ELSE 0 END, pinned_order ASC, updated_at DESC, created_at DESC`,
      )
      .all();
  }

  function getRow(id) {
    return db.prepare("SELECT * FROM notes WHERE id = ?").get(id) ?? null;
  }

  const handlers = {
    list() {
      return { notes: recencyRows().map(rowToNote) };
    },

    browse() {
      return { notes: recencyRows().map(rowToNote) };
    },

    count() {
      return { count: db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL").get().n };
    },

    getOne({ id }) {
      const row = getRow(id);
      return { note: row ? rowToNote(row) : null };
    },

    create({ text, title }) {
      // Notes are freeform: an empty note is legal (New Note) and titles as `Untitled`.
      const cleanTextValue = String(text ?? "");
      const id = crypto.randomUUID();
      const timestamp = now();
      const titleValue = title !== undefined && String(title).trim() ? String(title).trim() : deriveTitle(cleanTextValue);
      db.prepare(
        `INSERT INTO notes (id, title, text, pinned_order, created_at, updated_at, accessed_at, deleted_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)`,
      ).run(id, titleValue, cleanTextValue, timestamp, timestamp, timestamp);
      preferences.currentNoteId = id;
      persistPreferences();
      notifyChanged();
      return { note: rowToNote(getRow(id)) };
    },

    update({ id, text, title, expectedUpdatedAt }) {
      const existing = getRow(id);
      if (!existing) throw new Error("Note not found");
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && expectedUpdatedAt !== existing.updated_at) {
        return { result: "conflict", note: rowToNote(existing) };
      }
      const cleanTextValue = text === undefined ? existing.text : String(text);
      const titleValue = title !== undefined && String(title).trim() ? String(title).trim() : deriveTitle(cleanTextValue);
      db.prepare("UPDATE notes SET title = ?, text = ?, updated_at = ? WHERE id = ?").run(
        titleValue,
        cleanTextValue,
        now(),
        id,
      );
      notifyChanged();
      return { result: "ok", note: rowToNote(getRow(id)) };
    },

    delete({ id }) {
      const existing = getRow(id);
      if (!existing) throw new Error("Note not found");
      db.prepare("UPDATE notes SET deleted_at = ? WHERE id = ?").run(now(), id);
      notifyChanged();
      return { ok: true };
    },

    deleteAll() {
      db.prepare("UPDATE notes SET deleted_at = ? WHERE deleted_at IS NULL").run(now());
      notifyChanged();
      return { ok: true };
    },

    pin({ id }) {
      db.prepare("UPDATE notes SET pinned_order = pinned_order + 1 WHERE pinned_order IS NOT NULL").run();
      db.prepare("UPDATE notes SET pinned_order = 0 WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    unpin({ id }) {
      db.prepare("UPDATE notes SET pinned_order = NULL WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    movePinnedUp({ id }) {
      movePinned(id, -1);
      notifyChanged();
      return { ok: true };
    },

    movePinnedDown({ id }) {
      movePinned(id, 1);
      notifyChanged();
      return { ok: true };
    },

    /** The confirmed window boot payload: current note + recency neighbours + pinned ids. */
    getWindowData({ noteId } = {}) {
      const rows = recencyRows();
      if (rows.length === 0) return { currentNote: null, previousNoteId: null, nextNoteId: null, pinnedShortcutNoteIds: [] };
      const wanted = noteId ?? preferences.currentNoteId ?? null;
      const index = Math.max(0, rows.findIndex((row) => row.id === wanted));
      const current = rows[index] ?? rows[0];
      if (current.id !== preferences.currentNoteId) {
        preferences.currentNoteId = current.id;
        persistPreferences();
      }
      db.prepare("UPDATE notes SET accessed_at = ? WHERE id = ?").run(now(), current.id);
      return {
        currentNote: rowToNote(getRow(current.id)),
        previousNoteId: rows[index + 1]?.id ?? null,
        nextNoteId: index > 0 ? rows[index - 1].id : null,
        pinnedShortcutNoteIds: rows.filter((row) => row.pinned_order !== null).map((row) => row.id),
      };
    },

    getCurrentWindowData() {
      return handlers.getWindowData({});
    },

    setCurrentNote({ id }) {
      if (!getRow(id)) throw new Error("Note not found");
      preferences.currentNoteId = id;
      persistPreferences();
      return { ok: true };
    },

    touchAccessed({ id }) {
      db.prepare("UPDATE notes SET accessed_at = ? WHERE id = ?").run(now(), id);
      return { ok: true };
    },

    listDeleted() {
      const rows = db
        .prepare("SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
        .all();
      return { notes: rows.map(rowToNote) };
    },

    recoverNote({ id }) {
      const existing = getRow(id);
      if (!existing) throw new Error("Note not found");
      db.prepare("UPDATE notes SET deleted_at = NULL WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    permanentlyDelete({ id }) {
      db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    emptyTrash() {
      db.prepare("DELETE FROM notes WHERE deleted_at IS NOT NULL").run();
      notifyChanged();
      return { ok: true };
    },

    purgeOldDeletedNotes() {
      const cutoff = now() - TRASH_RETENTION_MS;
      return { purged: db.prepare("DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff).changes };
    },

    // Copy/export conversions run server-side so the confirmed formats have one tested source.
    markdownToHtml({ text }) {
      return { html: markdownToHtml(String(text ?? "")) };
    },

    toPlainText({ text }) {
      return { text: toPlainText(String(text ?? "")) };
    },

    htmlToMarkdown({ html }) {
      return { text: htmlToMarkdown(String(html ?? "")) };
    },

    getPreferences() {
      return { ...preferences, showMenuBarToggle: false };
    },

    setPreference({ key, value }) {
      if (key === "zoom") {
        const number = Number(value);
        if (!Number.isFinite(number) || number < ZOOM_MIN || number > ZOOM_MAX) {
          throw new Error(`Zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX}`);
        }
        preferences.zoom = Math.round(number * 100) / 100;
      } else if (key === "escapeKeyBehavior") {
        if (!ESCAPE_BEHAVIORS.has(value)) throw new Error(`Invalid escape key behavior: ${value}`);
        preferences.escapeKeyBehavior = value;
      } else if (key === "windowAutoSizing") {
        preferences.windowAutoSizing = value === true;
      } else if (key === "currentNoteId") {
        preferences.currentNoteId = value === null ? null : String(value);
      } else {
        throw new Error(`Unknown note preference: ${key}`);
      }
      persistPreferences();
      return { value: preferences[key] };
    },
  };

  function movePinned(id, direction) {
    const rows = db
      .prepare("SELECT id, pinned_order FROM notes WHERE pinned_order IS NOT NULL ORDER BY pinned_order ASC")
      .all();
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const swapped = rows[index];
    rows[index] = rows[target];
    rows[target] = swapped;
    const update = db.prepare("UPDATE notes SET pinned_order = ? WHERE id = ?");
    rows.forEach((row, position) => update.run(position + 1, row.id));
  }

  return {
    handlers,
    databasePath,
    /** Startup: the confirmed 60-day trash purge, then the one-time onboarding note. */
    bootstrap() {
      handlers.purgeOldDeletedNotes();
      if (!preferences.onboarded) {
        const count = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL").get().n;
        if (count === 0) {
          handlers.create({ text: WELCOME_NOTE });
          console.log("[notes] onboarding note created");
        }
        preferences.onboarded = true;
        persistPreferences();
      }
    },
    close() {
      db.close();
    },
  };
}

module.exports = { createNotes };
