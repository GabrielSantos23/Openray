// The Store module (docs/store-implementation-plan.md §1.4): registry, classifications and the
// install pipeline state in `store.sqlite` under the data dir, following the per-extension store
// convention (quicklinks/translator/...: one module, one handler table, one SQLite file).
//
// Classification rows carry `coverage_version` (docs/api-coverage.md); at bootstrap anything
// computed under an older version recomputes, so commands re-enable themselves when an API we
// support is implemented (plan §1.5).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { COVERAGE_VERSION, classifyExtension } = require("./classifier");
const { copySourceTree, buildExtension } = require("./store-bundler");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS catalog_extensions (
  handle TEXT PRIMARY KEY,
  name TEXT,
  title TEXT,
  description TEXT,
  author TEXT,
  categories TEXT,
  platforms TEXT,
  version TEXT,
  updated_at INTEGER,
  commands_json TEXT,
  fetched_at INTEGER
);
CREATE TABLE IF NOT EXISTS installed_extensions (
  uuid TEXT PRIMARY KEY,
  handle TEXT,
  name TEXT,
  title TEXT,
  author TEXT,
  commit_sha TEXT,
  installed_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS extension_classifications (
  uuid TEXT PRIMARY KEY,
  name TEXT,
  installable INTEGER,
  badge TEXT,
  coverage_version INTEGER,
  computed_at INTEGER,
  commit_sha TEXT
);
CREATE TABLE IF NOT EXISTS command_classifications (
  uuid TEXT,
  command_name TEXT,
  class TEXT,
  missing_apis TEXT,
  guarded_apis TEXT,
  reason TEXT,
  mode TEXT,
  PRIMARY KEY (uuid, command_name)
);
CREATE TABLE IF NOT EXISTS command_preferences (
  uuid TEXT,
  command_name TEXT,
  preferences TEXT,
  PRIMARY KEY (uuid, command_name)
);
`;

function createStore(options) {
  const dataRoot = options.dataRoot;
  const extensionsRoot = options.extensionsRoot;
  const apiRoot = options.apiRoot;
  const pushToFrontend = options.pushToFrontend ?? (() => Promise.resolve(undefined));

  fs.mkdirSync(dataRoot, { recursive: true });
  const db = new DatabaseSync(path.join(dataRoot, "store.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  // -------------------------------------------------------------------------------------------
  // Classification persistence.
  // -------------------------------------------------------------------------------------------

  function extensionDir(uuid) {
    return path.join(extensionsRoot, uuid);
  }

  function readManifest(uuid) {
    try {
      return JSON.parse(fs.readFileSync(path.join(extensionDir(uuid), "package.json"), "utf-8"));
    } catch {
      return null;
    }
  }

  function readEntrySource(uuid, commandName) {
    for (const extension of [".tsx", ".ts", ".jsx", ".js", ".mjs"]) {
      const file = path.join(extensionDir(uuid), "src", `${commandName}${extension}`);
      try {
        return fs.readFileSync(file, "utf-8");
      } catch {
        /* try next */
      }
    }
    return null;
  }

  function readBundleSource(uuid, commandName) {
    for (const file of [path.join(extensionDir(uuid), `${commandName}.js`), path.join(extensionDir(uuid), "dist", `${commandName}.js`)]) {
      try {
        return fs.readFileSync(file, "utf-8");
      } catch {
        /* try next */
      }
    }
    return null;
  }

  /** Classify one installed extension from its manifest + sources and persist the rows. */
  function classifyInstalledExtension(uuid, { commitSha = null } = {}) {
    const manifest = readManifest(uuid);
    if (!manifest) return null;
    const classification = classifyExtension({
      manifest,
      commands: (manifest.commands ?? []).map((command) => ({
        command,
        entrySource: readEntrySource(uuid, command.name),
        bundleSource: readBundleSource(uuid, command.name),
      })),
    });
    db.prepare(
      `INSERT INTO extension_classifications (uuid, name, installable, badge, coverage_version, computed_at, commit_sha)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET name=excluded.name, installable=excluded.installable,
         badge=excluded.badge, coverage_version=excluded.coverage_version,
         computed_at=excluded.computed_at, commit_sha=excluded.commit_sha`,
    ).run(
      uuid,
      manifest.name ?? uuid,
      classification.installable ? 1 : 0,
      classification.badge,
      COVERAGE_VERSION,
      Date.now(),
      commitSha,
    );
    db.prepare("DELETE FROM command_classifications WHERE uuid = ?").run(uuid);
    const insert = db.prepare(
      `INSERT INTO command_classifications (uuid, command_name, class, missing_apis, guarded_apis, reason, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [name, entry] of Object.entries(classification.commands)) {
      insert.run(uuid, name, entry.class, JSON.stringify(entry.missingApis), JSON.stringify(entry.guardedApis), entry.reason, entry.mode);
    }
    return classification;
  }

  /** Classify every extension directory, recomputing anything stale or missing. */
  function syncClassifications() {
    let entries = [];
    try {
      entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const refreshed = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const existing = db
        .prepare("SELECT coverage_version FROM extension_classifications WHERE uuid = ?")
        .get(entry.name);
      if (existing && existing.coverage_version === COVERAGE_VERSION) continue;
      const installed = db.prepare("SELECT commit_sha FROM installed_extensions WHERE uuid = ?").get(entry.name);
      if (classifyInstalledExtension(entry.name, { commitSha: installed?.commitSha ?? null })) {
        refreshed.push(entry.name);
      }
    }
    return refreshed;
  }

  function getCommandClassification(uuid, commandName) {
    return db
      .prepare("SELECT * FROM command_classifications WHERE uuid = ? AND command_name = ?")
      .get(uuid, commandName) ?? null;
  }

  function getExtensionClassification(uuid) {
    return db.prepare("SELECT * FROM extension_classifications WHERE uuid = ?").get(uuid) ?? null;
  }

  /** Classification payload the renderer summaries attach to each extension. */
  function getSummariesCompat() {
    const extensions = db.prepare("SELECT uuid, badge FROM extension_classifications").all();
    const commands = db.prepare("SELECT uuid, command_name, class, reason FROM command_classifications").all();
    const byUuid = new Map(extensions.map((row) => [row.uuid, { badge: row.badge, commands: {} }]));
    for (const row of commands) {
      const bucket = byUuid.get(row.uuid);
      if (!bucket) continue;
      bucket.commands[row.command_name] = { class: row.class, reason: row.reason };
    }
    return Object.fromEntries(byUuid);
  }

  /** Launch gate: refuse commands the classifier marked disabled. */
  function assertLaunchable(uuid, commandName, commandTitle) {
    const row = getCommandClassification(uuid, commandName);
    if (row && row.class !== "compatible") {
      throw new Error(`"${commandTitle ?? commandName}" is disabled: ${row.reason ?? "not supported"}`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Command preferences (per extension/command, manifest-shaped).
  // -------------------------------------------------------------------------------------------

  function getCommandPreferences(uuid, commandName) {
    const row = db
      .prepare("SELECT preferences FROM command_preferences WHERE uuid = ? AND command_name = ?")
      .get(uuid, commandName);
    if (!row) return {};
    try {
      return JSON.parse(row.preferences);
    } catch {
      return {};
    }
  }

  function setCommandPreferences(uuid, commandName, preferences) {
    db.prepare(
      `INSERT INTO command_preferences (uuid, command_name, preferences) VALUES (?, ?, ?)
       ON CONFLICT(uuid, command_name) DO UPDATE SET preferences=excluded.preferences`,
    ).run(uuid, commandName, JSON.stringify(preferences ?? {}));
    return { ok: true };
  }

  const handlers = {
    getClassifications: (params) => {
      const uuid = params?.uuid;
      if (uuid) {
        return { extension: getExtensionClassification(uuid), commands: db.prepare("SELECT * FROM command_classifications WHERE uuid = ?").all(uuid) };
      }
      return { extensions: db.prepare("SELECT * FROM extension_classifications").all(), commands: db.prepare("SELECT * FROM command_classifications").all() };
    },
    getSummariesCompat: () => ({ compat: getSummariesCompat() }),
    getCommandPreferences: (params) => ({ preferences: getCommandPreferences(params.uuid, params.commandName) }),
    setCommandPreferences: (params) => setCommandPreferences(params.uuid, params.commandName, params.preferences),
  };

  return {
    handlers,
    db,
    close: () => db.close(),
    syncClassifications,
    classifyInstalledExtension,
    getCommandClassification,
    getExtensionClassification,
    getSummariesCompat,
    assertLaunchable,
    getCommandPreferences,
    setCommandPreferences,
  };
}

module.exports = { createStore, COVERAGE_VERSION };
