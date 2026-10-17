// Snippets handler — the `snippets.*` table in the clone's backend.
//
// Mirrors the shipped store contract (see `docs/snippets-spec.md`): fields title/keyword/text/tags/
// copyCount plus pinned and the three timestamps, the confirmed limits (text < 65,536 characters,
// keyword <= 30 characters, exact-match keyword uniqueness) and the store API create|update|delete|
// deleteAll|list|getOne|getTags|pin|unpin|movePinnedUp|movePinnedDown|isKeywordAvailable|
// updateAccessedAt|updateCopyCount. After every mutation the keyword set is re-registered with the
// native hook (`snippets.register` / `snippets.remove`), and the expansion config is pushed on
// settings changes (`snippets.setConfig`). Placeholder resolution runs through the shared engine in
// `placeholders.js` — `{clipboard}` reads the clipboard store, `{snippet id=…}` nests other snippets.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { resolvePlaceholders } = require("./placeholders");

const MAX_TEXT_LENGTH = 65536;
const MAX_KEYWORD_LENGTH = 30;

const TEXT_LIMIT_ERROR = "Snippet length limit exceeded. The current limit is 65,536 characters";
const KEYWORD_LIMIT_ERROR = "Keyword is too long. The maximum length is 30 characters";
const KEYWORD_IN_USE_ERROR = "This keyword is already in use";

const EXPANSION_MODES = new Set(["immediately", "after-delimiter-keeping", "after-delimiter-discarding"]);
const INJECTION_DELAYS = new Set(["none", "short", "regular", "long", "extra-long"]);
const RESPONSE_TIMES = new Set(["instant", "quick", "default", "delayed", "extended"]);
const COMPLETION_SOUNDS = new Set(["none", "asterisk", "beep", "exclamation", "hand", "question"]);

const DEFAULT_PREFERENCES = {
  autoExpansionEnabled: true,
  expansionMode: "immediately",
  expandWithinWords: false,
  injectionDelay: "none",
  responseTime: "default",
  completionSound: "none",
  disabledApplications: [],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  keyword TEXT,
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  pinned_order INTEGER,
  copy_count INTEGER NOT NULL DEFAULT 0,
  accessed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function createSnippets({ dispatch, pushToFrontend, dataRoot, clipboardTextAt, calculate } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  const databasePath = path.join(root, "snippets.sqlite");
  const settingsPath = path.join(root, "snippets-settings.json");

  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA);

  const preferences = { ...DEFAULT_PREFERENCES };
  try {
    Object.assign(preferences, JSON.parse(fs.readFileSync(settingsPath, "utf-8")));
    preferences.disabledApplications = sanitizeApplications(preferences.disabledApplications);
  } catch {
    /* first run keeps the defaults */
  }

  function persistPreferences() {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(preferences, null, 2));
    } catch (error) {
      console.error("[snippets] could not persist preferences", error);
    }
  }

  function sanitizeApplications(applications) {
    const seen = new Set();
    const cleaned = [];
    for (const application of Array.isArray(applications) ? applications : []) {
      const name = String(application ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      cleaned.push(name);
    }
    return cleaned;
  }

  function rowToSnippet(row) {
    return {
      id: row.id,
      title: row.title,
      keyword: row.keyword ?? null,
      text: row.text,
      tags: JSON.parse(row.tags ?? "[]"),
      pinned: row.pinned_order ?? null,
      copyCount: row.copy_count,
      accessedAt: row.accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function notifyChanged() {
    if (typeof pushToFrontend === "function") {
      Promise.resolve(pushToFrontend("snippets.updated", {})).catch(() => undefined);
    }
  }

  function listRows() {
    return db
      .prepare(
        `SELECT * FROM snippets
         ORDER BY CASE WHEN pinned_order IS NULL THEN 1 ELSE 0 END, pinned_order ASC, accessed_at DESC, created_at DESC`,
      )
      .all();
  }

  /** The confirmed registration payload: duplicate and empty keywords are suppressed. */
  function registerKeywordsWithHost() {
    const seen = new Set();
    const snippetIds = [];
    const keywords = [];
    for (const row of db.prepare("SELECT id, keyword FROM snippets").all()) {
      const keyword = String(row.keyword ?? "").trim();
      if (!keyword || seen.has(keyword.toLowerCase())) continue;
      seen.add(keyword.toLowerCase());
      snippetIds.push(row.id);
      keywords.push(keyword);
    }
    if (typeof dispatch === "function") {
      Promise.resolve(dispatch("snippets.register", { snippetIds, keywords })).catch((error) => {
        console.warn("[snippets] could not register keywords with the host", error.message);
      });
    }
  }

  function removeKeywordsWithHost(snippetIds) {
    if (typeof dispatch === "function") {
      Promise.resolve(dispatch("snippets.remove", { snippetIds })).catch(() => undefined);
    }
  }

  function pushExpansionConfigToHost() {
    if (typeof dispatch === "function") {
      Promise.resolve(dispatch("snippets.setConfig", { ...preferences })).catch((error) => {
        console.warn("[snippets] could not push the expansion config to the host", error.message);
      });
    }
  }

  function cleanText(text) {
    const value = String(text ?? "");
    if (!value.trim()) throw new Error("Snippet cannot be empty");
    if (value.length >= MAX_TEXT_LENGTH) throw new Error(TEXT_LIMIT_ERROR);
    return value;
  }

  function cleanTitle(title) {
    const value = String(title ?? "").trim();
    if (!value) throw new Error("Name cannot be empty");
    return value;
  }

  function cleanKeyword(keyword, excludeId) {
    const value = String(keyword ?? "").trim();
    if (!value) return null;
    if (value.length > MAX_KEYWORD_LENGTH) throw new Error(KEYWORD_LIMIT_ERROR);
    if (!isKeywordAvailable(value, excludeId)) throw new Error(KEYWORD_IN_USE_ERROR);
    return value;
  }

  function isKeywordAvailable(keyword, excludeId) {
    const rows = db.prepare("SELECT id, keyword FROM snippets WHERE keyword IS NOT NULL").all();
    const wanted = String(keyword ?? "").trim().toLowerCase();
    return !rows.some(
      (row) => row.id !== excludeId && String(row.keyword ?? "").trim().toLowerCase() === wanted,
    );
  }

  const handlers = {
    list() {
      return { snippets: listRows().map(rowToSnippet) };
    },

    getOne({ id }) {
      const row = db.prepare("SELECT * FROM snippets WHERE id = ?").get(id);
      return { snippet: row ? rowToSnippet(row) : null };
    },

    getTags() {
      const counts = new Map();
      for (const row of db.prepare("SELECT tags FROM snippets").all()) {
        for (const tag of JSON.parse(row.tags ?? "[]")) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return { tags: [...counts.keys()].sort((a, b) => a.localeCompare(b)) };
    },

    create({ title, text, keyword, tags }) {
      const cleanTitleValue = cleanTitle(title);
      const cleanTextValue = cleanText(text);
      const cleanKeywordValue = cleanKeyword(keyword);
      const id = crypto.randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO snippets (id, title, keyword, text, tags, pinned_order, copy_count, accessed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)`,
      ).run(
        id,
        cleanTitleValue,
        cleanKeywordValue,
        cleanTextValue,
        JSON.stringify(Array.isArray(tags) ? tags : []),
        now,
        now,
        now,
      );
      registerKeywordsWithHost();
      notifyChanged();
      return { id };
    },

    update({ id, title, text, keyword, tags }) {
      const existing = db.prepare("SELECT * FROM snippets WHERE id = ?").get(id);
      if (!existing) throw new Error("Snippet not found");
      const cleanTitleValue = cleanTitle(title ?? existing.title);
      const cleanTextValue = cleanText(text ?? existing.text);
      const cleanKeywordValue = cleanKeyword(
        keyword === undefined ? existing.keyword : keyword,
        id,
      );
      db.prepare(
        `UPDATE snippets SET title = ?, keyword = ?, text = ?, tags = ?, updated_at = ? WHERE id = ?`,
      ).run(
        cleanTitleValue,
        cleanKeywordValue,
        cleanTextValue,
        JSON.stringify(Array.isArray(tags) ? tags : JSON.parse(existing.tags ?? "[]")),
        Date.now(),
        id,
      );
      registerKeywordsWithHost();
      notifyChanged();
      return { id };
    },

    delete({ id }) {
      db.prepare("DELETE FROM snippets WHERE id = ?").run(id);
      removeKeywordsWithHost([id]);
      registerKeywordsWithHost();
      notifyChanged();
      return { ok: true };
    },

    deleteAll() {
      const ids = db.prepare("SELECT id FROM snippets").all().map((row) => row.id);
      db.prepare("DELETE FROM snippets").run();
      removeKeywordsWithHost(ids);
      notifyChanged();
      return { ok: true };
    },

    pin({ id }) {
      db.prepare("UPDATE snippets SET pinned_order = pinned_order + 1 WHERE pinned_order IS NOT NULL").run();
      db.prepare("UPDATE snippets SET pinned_order = 0 WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    unpin({ id }) {
      db.prepare("UPDATE snippets SET pinned_order = NULL WHERE id = ?").run(id);
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

    isKeywordAvailable({ keyword, excludeId }) {
      return { available: isKeywordAvailable(keyword, excludeId) };
    },

    updateAccessedAt({ id }) {
      db.prepare("UPDATE snippets SET accessed_at = ? WHERE id = ?").run(Date.now(), id);
      return { ok: true };
    },

    updateCopyCount({ id }) {
      const now = Date.now();
      db.prepare("UPDATE snippets SET copy_count = copy_count + 1, accessed_at = ? WHERE id = ?").run(now, id);
      return { ok: true };
    },

    /**
     * Resolves placeholders for a manual paste/copy (`{text}`) or for the native hook's
     * auto-expansion (`{snippetId}`). Never logs the content — ids and outcomes only.
     */
    resolve({ text, snippetId, arguments: args }) {
      let source = String(text ?? "");
      if (snippetId !== undefined && snippetId !== null && snippetId !== "") {
        const row = db.prepare("SELECT text FROM snippets WHERE id = ?").get(snippetId);
        if (!row) throw new Error("Snippet not found");
        source = row.text;
      }
      const resolved = resolvePlaceholders(source, {
        context: "snippet",
        arguments: Array.isArray(args) ? args : [],
        clipboard: (offset) => readClipboardText(offset ?? 0),
        selectedText: null,
        calculate: typeof calculate === "function" ? calculate : null,
        getSnippetById: (nestedId) => {
          const row = db.prepare("SELECT text FROM snippets WHERE id = ?").get(nestedId);
          return row ? { text: row.text } : null;
        },
      });
      return { text: resolved.text, cursor: resolved.cursor };
    },

    importEntries({ entries }) {
      const list = Array.isArray(entries) ? entries : [];
      const existing = new Set(
        listRows().map((row) => importKey(row.title, row.keyword, row.text)),
      );
      let added = 0;
      let skipped = 0;
      const insert = db.prepare(
        `INSERT INTO snippets (id, title, keyword, text, tags, pinned_order, copy_count, accessed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)`,
      );
      for (const entry of list) {
        const title = String(entry?.name ?? "").trim();
        const text = String(entry?.text ?? "");
        const keyword = String(entry?.keyword ?? entry?.alias ?? "").trim() || null;
        if (!title || !text.trim()) continue;
        if (text.length >= MAX_TEXT_LENGTH) continue;
        if (keyword && keyword.length > MAX_KEYWORD_LENGTH) continue;
        const key = importKey(title, keyword, text);
        if (existing.has(key)) {
          skipped++;
          continue;
        }
        existing.add(key);
        const now = Date.now();
        insert.run(
          crypto.randomUUID(),
          title,
          keyword,
          text,
          JSON.stringify(Array.isArray(entry?.tags) ? entry.tags : []),
          now,
          now,
          now,
        );
        added++;
      }
      if (added > 0) registerKeywordsWithHost();
      notifyChanged();
      return { added, skipped };
    },

    exportAll() {
      return listRows().map((row) => {
        const tags = JSON.parse(row.tags ?? "[]");
        return {
          name: row.title,
          text: row.text,
          ...(row.keyword ? { keyword: row.keyword } : {}),
          ...(tags.length ? { tags } : {}),
        };
      });
    },

    getPreferences() {
      return { ...preferences };
    },

    setPreference({ key, value }) {
      if (!(key in DEFAULT_PREFERENCES)) {
        throw new Error(`Unknown snippet preference: ${key}`);
      }
      if (key === "autoExpansionEnabled" || key === "expandWithinWords") {
        preferences[key] = value === true;
      } else if (key === "expansionMode") {
        if (!EXPANSION_MODES.has(value)) throw new Error(`Invalid expansion mode: ${value}`);
        preferences[key] = value;
      } else if (key === "injectionDelay") {
        if (!INJECTION_DELAYS.has(value)) throw new Error(`Invalid injection delay: ${value}`);
        preferences[key] = value;
      } else if (key === "responseTime") {
        if (!RESPONSE_TIMES.has(value)) throw new Error(`Invalid response time: ${value}`);
        preferences[key] = value;
      } else if (key === "completionSound") {
        if (!COMPLETION_SOUNDS.has(value)) throw new Error(`Invalid completion sound: ${value}`);
        preferences[key] = value;
      } else if (key === "disabledApplications") {
        preferences[key] = sanitizeApplications(value);
      }
      persistPreferences();
      pushExpansionConfigToHost();
      return { value: preferences[key] };
    },
  };

  function importKey(title, keyword, text) {
    return `${String(title).trim().toLowerCase()}\u241f${String(keyword ?? "").trim().toLowerCase()}\u241f${text}`;
  }

  function readClipboardText(offset) {
    if (typeof clipboardTextAt !== "function") return null;
    try {
      return clipboardTextAt(offset) ?? null;
    } catch {
      return null;
    }
  }

  function movePinned(id, direction) {
    const rows = db
      .prepare(
        `SELECT id, pinned_order FROM snippets WHERE pinned_order IS NOT NULL ORDER BY pinned_order ASC`,
      )
      .all();
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const swapped = rows[index];
    rows[index] = rows[target];
    rows[target] = swapped;
    const update = db.prepare("UPDATE snippets SET pinned_order = ? WHERE id = ?");
    rows.forEach((row, position) => update.run(position + 1, row.id));
  }

  return {
    handlers,
    databasePath,
    registerKeywordsWithHost,
    pushExpansionConfigToHost,
    close() {
      db.close();
    },
  };
}

module.exports = { createSnippets };
