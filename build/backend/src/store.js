// The Store module (docs/store-implementation-plan.md §1.4): registry, classifications and the
// install pipeline state in `store.sqlite` under the data dir, following the per-extension store
// convention (quicklinks/translator/...: one module, one handler table, one SQLite file).
//
// Classification rows carry `coverage_version` (docs/api-coverage.md); at bootstrap anything
// computed under an older version recomputes, so commands re-enable themselves when an API we
// support is implemented (plan §1.5).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const { COVERAGE_VERSION, classifyExtension } = require("./classifier");
const { copySourceTree, buildExtension } = require("./store-bundler");

const CATALOG_REPO = "https://github.com/raycast/extensions";
const CATALOG_RAW = "https://raw.githubusercontent.com/raycast/extensions";
const CATALOG_API = "https://api.github.com/repos/raycast/extensions";
const APP_API_VERSION = "2.4.0.0";
const DEFAULT_MIN_API_VERSION = "1.25.0";
const FETCH_CONCURRENCY = 16;

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

  // -------------------------------------------------------------------------------------------
  // Catalog (decision D1): github.com/raycast/extensions pinned to a commit, sparse-checked-out
  // per install. `catalogRefresh` pins the current main commit and caches every extension's
  // package.json; search/categories/detail read the cache. Tests inject `localCatalogRoot`
  // instead of the network.
  // -------------------------------------------------------------------------------------------

  const cacheDir = path.join(dataRoot, "store-cache");

  function setMeta(key, value) {
    db.prepare("INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
  }

  function getMeta(key) {
    const row = db.prepare("SELECT value FROM catalog_meta WHERE key = ?").get(key);
    return row?.value ?? null;
  }

  function fetchText(url) {
    return fetch(url, { headers: { "User-Agent": "RaycastMini" } }).then(async (response) => {
      if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
      return response.text();
    });
  }

  function runGit(args, cwd) {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args.join(" ")} failed: ${String(stderr || error.message).slice(0, 500)}`));
        else resolve(String(stdout));
      });
    });
  }

  async function mapPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function lane() {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return results;
  }

  /** The pinned commit for catalog browsing and installs. */
  function pinnedCommit() {
    return getMeta("commit_sha");
  }

  async function catalogRefresh() {
    // Pin the commit first.
    const branch = JSON.parse(await fetchText(`${CATALOG_API}/branches/main`));
    const sha = branch.commit.sha;
    setMeta("commit_sha", sha);
    setMeta("refreshed_at", Date.now());

    // Two tree calls list every extension handle at that commit.
    const rootTree = JSON.parse(await fetchText(`${CATALOG_API}/git/trees/${sha}`));
    const extensionsNode = (rootTree.tree ?? []).find((entry) => entry.path === "extensions" && entry.type === "tree");
    if (!extensionsNode) throw new Error("catalog: no extensions/ tree in the pinned commit");
    const extensionsTree = JSON.parse(await fetchText(`${CATALOG_API}/git/trees/${extensionsNode.sha}`));
    const handles = (extensionsTree.tree ?? []).filter((entry) => entry.type === "tree").map((entry) => entry.path);

    // Every manifest, fetched from the pinned commit and cached.
    const now = Date.now();
    let fetched = 0;
    await mapPool(handles, FETCH_CONCURRENCY, async (handle) => {
      let manifest = null;
      try {
        manifest = JSON.parse(await fetchText(`${CATALOG_RAW}/${sha}/extensions/${handle}/package.json`));
      } catch {
        return; // unparseable manifest — excluded from the catalog, reported in stats
      }
      db.prepare(
        `INSERT INTO catalog_extensions (handle, name, title, description, author, categories, platforms, version, updated_at, commands_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(handle) DO UPDATE SET name=excluded.name, title=excluded.title, description=excluded.description,
           author=excluded.author, categories=excluded.categories, platforms=excluded.platforms, version=excluded.version,
           updated_at=excluded.updated_at, commands_json=excluded.commands_json, fetched_at=excluded.fetched_at`,
      ).run(
        handle,
        manifest.name ?? handle,
        manifest.title ?? manifest.name ?? handle,
        manifest.description ?? "",
        typeof manifest.author === "object" ? manifest.author?.name ?? handle : manifest.author ?? "unknown",
        JSON.stringify(manifest.categories ?? []),
        JSON.stringify(manifest.platforms ?? []),
        String(manifest.updated_at ?? ""),
        typeof manifest.updated_at === "number" ? manifest.updated_at : null,
        JSON.stringify((manifest.commands ?? []).map((command) => ({
          name: command.name, title: command.title, description: command.description, mode: command.mode,
          platforms: command.platforms, interval: command.interval,
        }))),
        now,
      );
      fetched += 1;
    });
    return { commit: sha, handles: handles.length, fetched };
  }

  /**
   * Fetch one extension's full manifest (with every field, not just the listing subset) and its
   * README at the pinned commit.
   */
  async function fetchCatalogDetail(handle) {
    const sha = pinnedCommit();
    if (!sha) throw new Error("catalog not refreshed yet");
    const [manifestText, readmeText] = await Promise.all([
      fetchText(`${CATALOG_RAW}/${sha}/extensions/${handle}/package.json`),
      fetchText(`${CATALOG_RAW}/${sha}/extensions/${handle}/README.md`).catch(() => null),
    ]);
    return { manifest: JSON.parse(manifestText), readme: readmeText, commit: sha };
  }

  /** Local test seam: a directory of `extensions/<handle>` used instead of the network. */
  function localCatalogRoot() {
    return options.localCatalogRoot ?? null;
  }

  function readLocalManifest(handle) {
    return JSON.parse(fs.readFileSync(path.join(localCatalogRoot(), "extensions", handle, "package.json"), "utf-8"));
  }

  /**
   * Gate: the real installer refuses listings without Windows in `platforms`
   * (`"${title} is not available on Windows"`), and enforces the minimum API version
   * (default 1.25.0).
   */
  function assertInstallableManifest(manifest) {
    const platforms = manifest.platforms ?? [];
    if (!platforms.includes("Windows")) {
      throw new Error(`${manifest.title ?? manifest.name} is not available on Windows`);
    }
    const min = manifest.api_version ?? DEFAULT_MIN_API_VERSION;
    if (compareVersions(min, APP_API_VERSION) > 0) {
      throw new Error(`${manifest.title ?? manifest.name} requires Raycast API v${min}. Update Raycast to install this extension.`);
    }
  }

  function compareVersions(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
      const va = pa[i] ?? 0;
      const vb = pb[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  /**
   * Materialize the pinned source for one handle into `targetDir`. Production: sparse checkout
   * (blob-filtered clone shared by all extensions) at the pinned commit. Tests: copy from the
   * local catalog root.
   */
  async function acquireSource(handle, targetDir, sha) {
    const local = localCatalogRoot();
    if (local) {
      copySourceTree(path.join(local, "extensions", handle), targetDir);
      return;
    }
    if (!fs.existsSync(path.join(cacheDir, ".git"))) {
      fs.mkdirSync(cacheDir, { recursive: true });
      await runGit(["clone", "--filter=blob:none", "--no-checkout", CATALOG_REPO, cacheDir]);
    }
    await runGit(["sparse-checkout", "set", `extensions/${handle}`], cacheDir);
    await runGit(["fetch", "--filter=blob:none", "origin", sha], cacheDir);
    await runGit(["checkout", sha], cacheDir);
    copySourceTree(path.join(cacheDir, "extensions", handle), targetDir);
  }

  const installJobs = new Map(); // handle -> Promise

  /**
   * Install (or update) one extension, mirroring the real installer's staging/backup/rollback
   * (docs/store-spec.md §2.7): build in `.<uuid>.staging`, back up any existing install, rename
   * into place, register, roll everything back on failure.
   */
  async function installExtension({ handle, confirmed, commitSha } = {}) {
    if (!handle) throw new Error("store.install: missing handle");
    if (confirmed !== true) throw new Error("store.install: confirmation required (the user must click Install)");
    if (installJobs.has(handle)) return installJobs.get(handle);
    const job = doInstall(handle, commitSha ?? pinnedCommit()).finally(() => installJobs.delete(handle));
    installJobs.set(handle, job);
    return job;
  }

  async function doInstall(handle, sha) {
    if (!sha) throw new Error("catalog not refreshed yet — nothing is pinned");
    // Pre-download gate: the cached listing already knows the platforms (the real installer
    // refuses before downloading — docs/store-spec.md §2.2).
    const listing = db.prepare("SELECT platforms, title FROM catalog_extensions WHERE handle = ?").get(handle);
    if (listing) {
      const platforms = JSON.parse(listing.platforms ?? "[]");
      if (!platforms.includes("Windows")) {
        throw new Error(`${listing.title ?? handle} is not available on Windows`);
      }
    }
    await progress(handle, "download", "Fetching source");
    const staging = path.join(extensionsRoot, `.${handle}.staging-${Date.now().toString(36)}`);
    const backup = path.join(extensionsRoot, `.${handle}.backup-${Date.now().toString(36)}`);
    const target = extensionDir(handle);
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    try {
      await acquireSource(handle, staging, sha);
      const manifest = JSON.parse(fs.readFileSync(path.join(staging, "package.json"), "utf-8"));
      assertInstallableManifest(manifest);
      fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify(manifest, null, 2));

      await progress(handle, "build", "Building commands");
      await buildExtension({ apiRoot, targetDir: staging, manifest, onProgress: (step) => progress(handle, step.step, step.message) });

      // Classification runs against the staged tree before it becomes visible.
      const classification = classifyExtension({
        manifest,
        commands: (manifest.commands ?? []).map((command) => ({
          command,
          entrySource: readSourceFrom(staging, command.name),
          bundleSource: readBundleFrom(staging, command.name),
        })),
      });

      await progress(handle, "install", "Installing");
      const existed = fs.existsSync(target);
      if (existed) fs.renameSync(target, backup);
      try {
        fs.renameSync(staging, target);
      } catch (error) {
        if (existed) fs.renameSync(backup, target);
        throw error;
      }

      try {
        db.prepare(
          `INSERT INTO installed_extensions (uuid, handle, name, title, author, commit_sha, installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(uuid) DO UPDATE SET handle=excluded.handle, name=excluded.name, title=excluded.title,
             author=excluded.author, commit_sha=excluded.commit_sha, updated_at=excluded.updated_at`,
        ).run(handle, handle, manifest.name ?? handle, manifest.title ?? handle,
          typeof manifest.author === "object" ? manifest.author?.name ?? handle : manifest.author ?? "unknown",
          sha, Date.now(), typeof manifest.updated_at === "number" ? manifest.updated_at : Date.now());
        persistClassification(handle, manifest, classification, sha);
      } catch (error) {
        // DB rollback: put the previous install back.
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        if (existed && fs.existsSync(backup)) fs.renameSync(backup, target);
        throw error;
      }

      await progress(handle, "done", classification.badge ? `Installed (${classification.badge})` : "Installed");
      pushToFrontend("store.installed", { handle, commit: sha }).catch(() => undefined);
      return { handle, commit: sha, classification };
    } catch (error) {
      await progress(handle, "error", error instanceof Error ? error.message : String(error)).catch(() => undefined);
      throw error;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      fs.rmSync(backup, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  function readSourceFrom(dir, commandName) {
    for (const extension of [".tsx", ".ts", ".jsx", ".js", ".mjs"]) {
      try {
        return fs.readFileSync(path.join(dir, "src", `${commandName}${extension}`), "utf-8");
      } catch {
        /* try next */
      }
    }
    return null;
  }

  function readBundleFrom(dir, commandName) {
    try {
      return fs.readFileSync(path.join(dir, `${commandName}.js`), "utf-8");
    } catch {
      return null;
    }
  }

  function persistClassification(uuid, manifest, classification, sha) {
    db.prepare(
      `INSERT INTO extension_classifications (uuid, name, installable, badge, coverage_version, computed_at, commit_sha)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET name=excluded.name, installable=excluded.installable,
         badge=excluded.badge, coverage_version=excluded.coverage_version, computed_at=excluded.computed_at,
         commit_sha=excluded.commit_sha`,
    ).run(uuid, manifest.name ?? uuid, classification.installable ? 1 : 0, classification.badge, COVERAGE_VERSION, Date.now(), sha);
    db.prepare("DELETE FROM command_classifications WHERE uuid = ?").run(uuid);
    const insert = db.prepare(
      `INSERT INTO command_classifications (uuid, command_name, class, missing_apis, guarded_apis, reason, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [name, entry] of Object.entries(classification.commands)) {
      insert.run(uuid, name, entry.class, JSON.stringify(entry.missingApis), JSON.stringify(entry.guardedApis), entry.reason, entry.mode);
    }
  }

  function progress(handle, step, message) {
    return pushToFrontend("store.progress", { handle, step, message });
  }

  async function uninstallExtension({ handle } = {}) {
    if (!handle) throw new Error("store.uninstall: missing handle");
    db.prepare("DELETE FROM installed_extensions WHERE uuid = ?").run(handle);
    db.prepare("DELETE FROM extension_classifications WHERE uuid = ?").run(handle);
    db.prepare("DELETE FROM command_classifications WHERE uuid = ?").run(handle);
    db.prepare("DELETE FROM command_preferences WHERE uuid = ?").run(handle);
    fs.rmSync(extensionDir(handle), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    pushToFrontend("store.installed", { handle, removed: true }).catch(() => undefined);
    return { ok: true };
  }

  /** Update check: the real app compares `updated_at` per installed uuid (store-spec §7). */
  async function checkForUpdates() {
    const sha = pinnedCommit();
    const installed = db.prepare("SELECT * FROM installed_extensions").all();
    const updates = [];
    for (const row of installed) {
      let catalogRow = db.prepare("SELECT * FROM catalog_extensions WHERE handle = ?").get(row.handle);
      let catalogSha = sha;
      if (!catalogRow && localCatalogRoot()) {
        try {
          const manifest = readLocalManifest(row.handle);
          catalogRow = {
            handle: row.handle,
            version: String(manifest.updated_at ?? ""),
            title: manifest.title ?? row.handle,
          };
        } catch { /* gone from the catalog */ }
      }
      if (!catalogRow) continue;
      if (String(catalogRow.version ?? "") !== String(row.updated_at ?? "") || (catalogSha && catalogSha !== row.commit_sha)) {
        updates.push({ handle: row.handle, title: row.title, from: row.commit_sha, to: catalogSha });
      }
    }
    return { updates, commit: sha };
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

    refreshCatalog: async () => {
      const local = localCatalogRoot();
      if (local) {
        // Test seam: index a local directory of extensions/<handle> at a fake pinned commit.
        const rootDir = path.join(local, "extensions");
        const handles = fs.existsSync(rootDir) ? fs.readdirSync(rootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
        const now = Date.now();
        for (const handle of handles) {
          let manifest;
          try {
            manifest = readLocalManifest(handle);
          } catch {
            continue;
          }
          db.prepare(
            `INSERT INTO catalog_extensions (handle, name, title, description, author, categories, platforms, version, updated_at, commands_json, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(handle) DO UPDATE SET name=excluded.name, title=excluded.title, description=excluded.description,
               author=excluded.author, categories=excluded.categories, platforms=excluded.platforms, version=excluded.version,
               updated_at=excluded.updated_at, commands_json=excluded.commands_json, fetched_at=excluded.fetched_at`,
          ).run(handle, manifest.name ?? handle, manifest.title ?? handle, manifest.description ?? "",
            typeof manifest.author === "object" ? manifest.author?.name ?? handle : manifest.author ?? "unknown",
            JSON.stringify(manifest.categories ?? []), JSON.stringify(manifest.platforms ?? []),
            String(manifest.updated_at ?? ""), typeof manifest.updated_at === "number" ? manifest.updated_at : null,
            JSON.stringify((manifest.commands ?? []).map((command) => ({
              name: command.name, title: command.title, description: command.description, mode: command.mode,
              platforms: command.platforms, interval: command.interval,
            }))), now);
        }
        setMeta("commit_sha", "local-pinned-commit");
        setMeta("refreshed_at", now);
        return { commit: "local-pinned-commit", handles: handles.length, fetched: handles.length };
      }
      return catalogRefresh();
    },

    search: (params) => {
      const query = String(params?.query ?? "").trim().toLowerCase();
      const category = params?.category ?? null;
      let rows = db.prepare("SELECT * FROM catalog_extensions ORDER BY title COLLATE NOCASE").all();
      if (category && category !== "all") {
        rows = rows.filter((row) => JSON.parse(row.categories ?? "[]").includes(category));
      }
      if (query) {
        rows = rows.filter((row) =>
          row.title.toLowerCase().includes(query) ||
          row.name.toLowerCase().includes(query) ||
          String(row.description ?? "").toLowerCase().includes(query) ||
          String(row.author ?? "").toLowerCase().includes(query));
      }
      // Windows listings only (the real gate is the installer's; the Store lists what can install).
      const windows = rows
        .filter((row) => JSON.parse(row.platforms ?? "[]").includes("Windows"))
        .map((row) => ({
          handle: row.handle,
          name: row.name,
          title: row.title,
          description: row.description,
          author: row.author,
          categories: JSON.parse(row.categories ?? "[]"),
          version: row.version,
          updatedAt: row.updated_at,
          commands: JSON.parse(row.commands_json ?? "[]"),
          installed: Boolean(db.prepare("SELECT 1 FROM installed_extensions WHERE uuid = ?").get(row.handle)),
        }));
      return { commit: pinnedCommit(), extensions: windows };
    },

    categories: () => {
      const counts = new Map();
      for (const row of db.prepare("SELECT categories FROM catalog_extensions").all()) {
        for (const category of JSON.parse(row.categories ?? "[]")) {
          counts.set(category, (counts.get(category) ?? 0) + 1);
        }
      }
      return { categories: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
    },

    detail: async (params) => {
      const handle = params?.handle;
      const local = localCatalogRoot();
      let manifest;
      let readme = null;
      let commit = pinnedCommit();
      if (local) {
        manifest = readLocalManifest(handle);
        try {
          readme = fs.readFileSync(path.join(local, "extensions", handle, "README.md"), "utf-8");
        } catch {
          readme = null;
        }
      } else {
        const fetched = await fetchCatalogDetail(handle);
        manifest = fetched.manifest;
        readme = fetched.readme;
        commit = fetched.commit;
      }
      // Manifest-level status preview for the detail's command list; the full source-level
      // classification runs at install.
      const commands = (manifest.commands ?? []).map((command) => {
        const preview = classifyExtension({
          manifest,
          commands: [{ command, entrySource: null, bundleSource: null }],
        }, { preview: true }).commands[command.name];
        return { name: command.name, title: command.title, description: command.description, mode: command.mode, class: preview.class, reason: preview.reason };
      });
      const installed = db.prepare("SELECT * FROM installed_extensions WHERE uuid = ?").get(handle);
      return {
        handle,
        commit,
        manifest: {
          name: manifest.name,
          title: manifest.title,
          description: manifest.description,
          author: typeof manifest.author === "object" ? manifest.author?.name : manifest.author,
          contributors: (manifest.contributors ?? []).map((contributor) => typeof contributor === "object" ? contributor.name : contributor),
          categories: manifest.categories ?? [],
          platforms: manifest.platforms ?? [],
          icon: manifest.icon ?? null,
          updatedAt: typeof manifest.updated_at === "number" ? manifest.updated_at : null,
        },
        commands,
        readme,
        installed: installed ? { installedAt: installed.installed_at, commit: installed.commit_sha } : null,
      };
    },

    getInstalled: () => ({
      extensions: db.prepare("SELECT * FROM installed_extensions ORDER BY title").all(),
    }),

    install: (params) => installExtension({ handle: params?.handle, confirmed: params?.confirmed === true, commitSha: params?.commitSha }),
    uninstall: (params) => uninstallExtension(params ?? {}),
    checkForUpdates: () => checkForUpdates(),
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
    catalogRefresh,
    installExtension,
    uninstallExtension,
    checkForUpdates,
    pinnedCommit,
  };
}

module.exports = { createStore, COVERAGE_VERSION };
