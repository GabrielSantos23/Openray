// Quicklinks handler — the `quicklinks.*` table in the clone's backend.
//
// Mirrors the shipped store contract (see `docs/quicklinks-spec.md`): fields name/link/icon/
// openWith/tags/pinned/openCount/createdAt/updatedAt, handlers list/getOne/getTags/save/update/
// delete/deleteAll/updateOpenCount/pin/unpin/movePinnedUp/movePinnedDown plus the clone-side
// open/resolve/import/export/preferences. Links carry `{...}` dynamic placeholders, resolved through
// `placeholders.js` with quicklink output encoding (percent-encoded unless `|raw`).

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { enumerateArguments, resolvePlaceholders } = require("./placeholders");

const DEFAULT_PREFERENCES = {
  passSelectedTextAsArgument: false,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quicklinks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  link TEXT NOT NULL,
  icon TEXT,
  open_with TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  pinned_order INTEGER,
  open_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function createQuicklinks({ dispatch, pushToFrontend, dataRoot, calculate } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini");
  const databasePath = path.join(root, "quicklinks.sqlite");
  const settingsPath = path.join(root, "quicklinks-settings.json");

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
      console.error("[quicklinks] could not persist preferences", error);
    }
  }

  function rowToQuicklink(row) {
    const parsed = enumerateArguments(row.link);
    return {
      id: row.id,
      name: row.name,
      link: row.link,
      icon: row.icon ?? null,
      openWith: row.open_with ?? null,
      tags: JSON.parse(row.tags ?? "[]"),
      pinned: row.pinned_order ?? null,
      openCount: row.open_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      args: parsed.args,
      argsError: parsed.error ?? null,
    };
  }

  function notifyChanged() {
    if (typeof pushToFrontend === "function") {
      Promise.resolve(pushToFrontend("quicklinks.updated", {})).catch(() => undefined);
    }
  }

  function listRows() {
    return db
      .prepare(
        `SELECT * FROM quicklinks
         ORDER BY CASE WHEN pinned_order IS NULL THEN 1 ELSE 0 END, pinned_order ASC, created_at ASC`,
      )
      .all();
  }

  const handlers = {
    list() {
      return { quicklinks: listRows().map(rowToQuicklink) };
    },

    getOne({ id }) {
      const row = db.prepare("SELECT * FROM quicklinks WHERE id = ?").get(id);
      return { quicklink: row ? rowToQuicklink(row) : null };
    },

    getTags() {
      const counts = new Map();
      for (const row of db.prepare("SELECT tags FROM quicklinks").all()) {
        for (const tag of JSON.parse(row.tags ?? "[]")) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return { tags: [...counts.keys()].sort((a, b) => a.localeCompare(b)) };
    },

    save({ name, link, icon, openWith, tags }) {
      const cleanName = String(name ?? "").trim();
      const cleanLink = String(link ?? "").trim();
      if (!cleanName) throw new Error("Please enter a name");
      if (!cleanLink) throw new Error("Please enter a link");
      const parsed = enumerateArguments(cleanLink);
      if (parsed.error) throw new Error(parsed.error);
      const id = crypto.randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO quicklinks (id, name, link, icon, open_with, tags, pinned_order, open_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
      ).run(
        id,
        cleanName,
        cleanLink,
        icon ?? null,
        openWith ?? null,
        JSON.stringify(Array.isArray(tags) ? tags : []),
        now,
        now,
      );
      notifyChanged();
      return { id };
    },

    update({ id, name, link, icon, openWith, tags }) {
      const existing = db.prepare("SELECT * FROM quicklinks WHERE id = ?").get(id);
      if (!existing) throw new Error("Quicklink not found");
      const cleanName = String(name ?? existing.name).trim();
      const cleanLink = String(link ?? existing.link).trim();
      if (!cleanName) throw new Error("Please enter a name");
      if (!cleanLink) throw new Error("Please enter a link");
      const parsed = enumerateArguments(cleanLink);
      if (parsed.error) throw new Error(parsed.error);
      db.prepare(
        `UPDATE quicklinks SET name = ?, link = ?, icon = ?, open_with = ?, tags = ?, updated_at = ? WHERE id = ?`,
      ).run(
        cleanName,
        cleanLink,
        icon === undefined ? existing.icon : icon,
        openWith === undefined ? existing.open_with : openWith,
        JSON.stringify(Array.isArray(tags) ? tags : JSON.parse(existing.tags ?? "[]")),
        Date.now(),
        id,
      );
      notifyChanged();
      return { id };
    },

    delete({ id }) {
      db.prepare("DELETE FROM quicklinks WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    deleteAll() {
      db.prepare("DELETE FROM quicklinks").run();
      notifyChanged();
      return { ok: true };
    },

    updateOpenCount({ id }) {
      db.prepare("UPDATE quicklinks SET open_count = open_count + 1 WHERE id = ?").run(id);
      return { ok: true };
    },

    pin({ id }) {
      db.prepare("UPDATE quicklinks SET pinned_order = pinned_order + 1 WHERE pinned_order IS NOT NULL").run();
      db.prepare("UPDATE quicklinks SET pinned_order = 0 WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    unpin({ id }) {
      db.prepare("UPDATE quicklinks SET pinned_order = NULL WHERE id = ?").run(id);
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

    open({ id, arguments: args }) {
      const row = db.prepare("SELECT * FROM quicklinks WHERE id = ?").get(id);
      if (!row) throw new Error("Quicklink not found");
      const resolved = resolvePlaceholders(row.link, {
        context: "quicklink",
        arguments: Array.isArray(args) ? args : [],
        calculate: typeof calculate === "function" ? calculate : null,
      });
      const target = resolved.text.trim();
      if (!target) throw new Error("Invalid URL");
      if (row.open_with) {
        dispatch("shell.openWith", { path: target, app: row.open_with });
      } else {
        dispatch("shell.openUrl", { url: target });
      }
      handlers.updateOpenCount({ id });
      return { url: target };
    },

    resolve({ link, arguments: args }) {
      const resolved = resolvePlaceholders(String(link ?? ""), {
        context: "quicklink",
        arguments: Array.isArray(args) ? args : [],
        calculate: typeof calculate === "function" ? calculate : null,
      });
      return { link: resolved.text };
    },

    importEntries({ entries }) {
      const list = Array.isArray(entries) ? entries : [];
      const existing = new Set(listRows().map((row) => row.link));
      let added = 0;
      let skipped = 0;
      for (const entry of list) {
        const name = String(entry?.name ?? "").trim();
        const link = String(entry?.link ?? entry?.url ?? "").trim();
        if (!name || !link) continue;
        if (existing.has(link)) {
          skipped++;
          continue;
        }
        const parsed = enumerateArguments(link);
        if (parsed.error) continue;
        existing.add(link);
        db.prepare(
          `INSERT INTO quicklinks (id, name, link, icon, open_with, tags, pinned_order, open_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
        ).run(
          crypto.randomUUID(),
          name,
          link,
          entry.icon ?? entry.iconName ?? null,
          entry.openWith ?? entry.applicationID ?? null,
          JSON.stringify(Array.isArray(entry.tags) ? entry.tags : []),
          Date.now(),
          Date.now(),
        );
        added++;
      }
      notifyChanged();
      return { added, skipped };
    },

    exportAll() {
      return {
        quicklinks: listRows().map((row) => ({
          name: row.name,
          link: row.link,
          ...(row.icon ? { icon: row.icon } : {}),
          ...(JSON.parse(row.tags ?? "[]").length ? { tags: JSON.parse(row.tags) } : {}),
        })),
      };
    },

    getPreferences() {
      return { ...preferences };
    },

    setPreference({ key, value }) {
      if (!(key in DEFAULT_PREFERENCES)) {
        throw new Error(`Unknown quicklinks preference: ${key}`);
      }
      if (key === "passSelectedTextAsArgument") {
        preferences[key] = value === true;
      }
      persistPreferences();
      return { value: preferences[key] };
    },
  };

  function movePinned(id, direction) {
    const rows = db
      .prepare(
        `SELECT id, pinned_order FROM quicklinks WHERE pinned_order IS NOT NULL ORDER BY pinned_order ASC`,
      )
      .all();
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const swapped = rows[index];
    rows[index] = rows[target];
    rows[target] = swapped;
    const update = db.prepare("UPDATE quicklinks SET pinned_order = ? WHERE id = ?");
    rows.forEach((row, position) => update.run(position + 1, row.id));
  }

  return {
    handlers,
    databasePath,
    close() {
      db.close();
    },
  };
}

module.exports = { createQuicklinks };
