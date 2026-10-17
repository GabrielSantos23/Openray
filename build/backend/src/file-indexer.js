// File Search (Raycast's internal `file-search` extension) — the indexer backend.
//
// Raycast ships a native indexer (`indexer.win32-x64-msvc.node`) behind a worker thread; this clone
// reproduces its observable behavior with Node async I/O on the existing `file-index.sqlite`:
// chunked background indexing that never blocks the pipe loop, `fs.watch {recursive:true}` per
// scope with a 500ms debounce feeding incremental upserts/deletes, content-type classification,
// ignore patterns, and index-state push notifications.
//
// Confirmed behavior implemented here (docs/file-search-spec.md): the preference set
// (`showInRootSearch`, `includeHiddenFiles`, `respectIgnoreFiles`, `ignore`, `include`), the
// Windows default excludes (`*.tmp`, `*.temp`, `node_modules`, `**/tmp/**`, `**/temp/**`,
// `**/[Cc]ache/**`, `**/[Cc]aches/**`, `**/AppData/**`), the type filter categories
// (archive/document/image/video/audio/text/other + Directory), `Indexing ${n} files` progress,
// and the ranking tiers (name-prefix > name-substring > path, then usage count, then modified).

"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const SETTINGS_FILE = "file-search-settings.json";
const INDEX_DB = "file-index.sqlite";
const WATCH_DEBOUNCE_MS = 500;
const YIELD_EVERY = 250;
const PROGRESS_EVERY_MS = 1000;
/** Matches on this many path characters before the first yield stay anonymous — never log paths. */

const DEFAULT_SETTINGS = {
  showInRootSearch: true,
  contentSearch: false,
  contentSearchInRootSearch: false,
  includeHiddenFiles: false,
  respectIgnoreFiles: true,
  ignore: [],
  include: [],
};

// `file-search-preferences-CaWvd-f1.js` — excluded automatically on Windows.
const WINDOWS_DEFAULT_EXCLUDES = [
  "*.tmp",
  "*.temp",
  "node_modules",
  "**/tmp/**",
  "**/temp/**",
  "**/[Cc]ache/**",
  "**/[Cc]aches/**",
  "**/AppData/**",
];

const CONTENT_TYPE_BY_EXTENSION = {
  archive: ["zip", "tar", "gz", "bz2", "xz", "zst", "rar", "7z", "cab", "iso", "jar", "tgz"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "pages", "numbers", "key", "epub", "csv"],
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "tif", "heic", "avif"],
  video: ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts"],
  audio: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus", "aiff"],
  text: ["txt", "md", "markdown", "log", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "srt", "vtt"],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS file_index (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  folder TEXT NOT NULL,
  parent_folder TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified_time INTEGER NOT NULL,
  created_time INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS file_index_name ON file_index (name);
CREATE INDEX IF NOT EXISTS file_index_folder ON file_index (folder);
CREATE INDEX IF NOT EXISTS file_index_modified ON file_index (modified_time DESC);
CREATE INDEX IF NOT EXISTS file_index_type ON file_index (content_type);
CREATE TABLE IF NOT EXISTS file_usage (
  path TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
`;

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

/** Glob → RegExp. `*`/`?` never cross separators; `**/` and `/**` span them. */
function globToRegExp(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        const isParent = i === 0 || pattern[i - 1] === "/";
        const isChild = pattern[i + 2] === "/";
        if (isParent && isChild) {
          source += "(?:.*/)?";
          i += 2;
          continue;
        }
        source += ".*";
        i++;
        continue;
      }
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      // A glob character class (`[Cc]ache` in the Windows defaults) passes through verbatim.
      const end = pattern.indexOf("]", i + 1);
      if (end !== -1) {
        source += pattern.slice(i, end + 1);
        i = end;
      } else {
        source += "\\[";
      }
    } else if (char === "/") {
      source += "[\\\\/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
}

function compileIgnorePatterns(patterns) {
  return patterns
    .map((raw) => {
      const pattern = String(raw).trim();
      if (!pattern) return null;
      const normalized = normalizeSlashes(pattern);
      if (/^[a-zA-Z]:[\\/]/.test(pattern) || pattern.startsWith("/") || pattern.startsWith("~")) {
        // An absolute path excludes exactly that file or directory (and everything below it).
        const base = normalized.toLowerCase().replace(/\/+$/, "");
        return { kind: "path", base };
      }
      if (normalized.includes("/")) {
        // A path glob (`**/tmp/**`) matches against the whole normalized path.
        return { kind: "pathGlob", regex: globToRegExp(normalized.replace(/^\/+|\/+$/g, "")) };
      }
      if (normalized.includes("*") || normalized.includes("?")) {
        // A basename glob (`*.tmp`) matches any single path segment.
        return { kind: "basename", regex: globToRegExp(normalized) };
      }
      // A plain name (`node_modules`) excludes every path carrying a segment with that name.
      return { kind: "segment", name: normalized.toLowerCase() };
    })
    .filter(Boolean);
}

/**
 * `ignore` semantics: comma-separated filenames or directories (per the confirmed settings
 * description) plus the Windows default excludes.
 */
function isIgnored(fullPath, compiledDefaults, compiledUser) {
  const normalizedPath = normalizeSlashes(fullPath.toLowerCase());
  const segments = normalizedPath.split("/").filter(Boolean);
  for (const compiled of [...compiledDefaults, ...compiledUser]) {
    if (compiled.kind === "path") {
      if (normalizedPath === compiled.base || normalizedPath.startsWith(`${compiled.base}/`)) return true;
    } else if (compiled.kind === "segment") {
      if (segments.includes(compiled.name)) return true;
    } else if (compiled.kind === "basename") {
      if (segments.some((segment) => compiled.regex.test(segment))) return true;
    } else if (compiled.kind === "pathGlob") {
      if (compiled.regex.test(normalizedPath)) return true;
    }
  }
  return false;
}

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

function contentTypeFor(name, isDirectory) {
  if (isDirectory) return "directory";
  const extension = extensionOf(name);
  for (const [type, extensions] of Object.entries(CONTENT_TYPE_BY_EXTENSION)) {
    if (extensions.includes(extension)) return type;
  }
  return "other";
}

function isHiddenName(name) {
  return name.startsWith(".");
}

function createFileIndexer({ pushToFrontend, dataRoot, autoStart = true } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Openray");
  fs.mkdirSync(root, { recursive: true });
  const settingsFile = path.join(root, SETTINGS_FILE);
  const db = new DatabaseSync(path.join(root, INDEX_DB));
  db.exec(SCHEMA);

  let settings = loadSettings();
  let firstRun = !fs.existsSync(settingsFile);
  if (firstRun) {
    // First-run default scope is unconfirmed in Raycast; the confirmed `Reset to Defaults` target
    // is the home directory, so the clone starts there (docs/file-search-spec.md, decisions).
    settings = { ...DEFAULT_SETTINGS, include: [os.homedir()] };
    persistSettings();
  }

  let state = "idle";
  let fileCount = 0;
  let indexStart = 0;
  let stopRequested = false;
  let currentRun = null;
  let watchers = [];
  const debounces = new Map();
  const compiledDefaults = compileIgnorePatterns(WINDOWS_DEFAULT_EXCLUDES);
  let compiledUser = compileIgnorePatterns(settings.ignore);

  const insertStmt = db.prepare(
    `INSERT INTO file_index (path, name, extension, folder, parent_folder, size, modified_time, created_time, content_type, hidden)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       name=excluded.name, extension=excluded.extension, folder=excluded.folder,
       parent_folder=excluded.parent_folder, size=excluded.size, modified_time=excluded.modified_time,
       created_time=excluded.created_time, content_type=excluded.content_type, hidden=excluded.hidden`,
  );
  const deleteStmt = db.prepare("DELETE FROM file_index WHERE path = ?");
  const deleteTreeStmt = db.prepare("DELETE FROM file_index WHERE path = ? OR path LIKE ? ESCAPE '\\'");
  const usageStmt = db.prepare(
    `INSERT INTO file_usage (path, count) VALUES (?, 1)
     ON CONFLICT(path) DO UPDATE SET count = count + 1`,
  );

  function loadSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      return {
        ...DEFAULT_SETTINGS,
        ...Object.fromEntries(
          Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
            key,
            raw[key] === undefined ? fallback : raw[key],
          ]),
        ),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistSettings() {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  }

  let lastPushAt = 0;
  function pushState(extra = {}, force = false) {
    // Concurrent walks each throttle their own report timer; one global floor keeps the pipe
    // (and everything sharing it, like launch responses) from drowning in state pushes.
    if (!force && Date.now() - lastPushAt < 800) return;
    lastPushAt = Date.now();
    if (pushToFrontend) {
      pushToFrontend("fileSearch.indexState", {
        state,
        fileCount,
        entriesPerSecond:
          state === "indexing" && indexStart > 0
            ? Math.round(fileCount / Math.max(0.001, (Date.now() - indexStart) / 1000))
            : null,
        ...extra,
      });
    }
  }

  function pushSettings() {
    if (pushToFrontend) pushToFrontend("fileSearch.settingsUpdated", { settings });
  }

  const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

  function shouldIndex(fullPath, name, isDirectory) {
    if (isIgnored(fullPath, compiledDefaults, compiledUser)) return false;
    // Skipping a hidden directory also keeps its children out of the index, because the walk
    // never descends into a directory that fails this check.
    if (!settings.includeHiddenFiles && isHiddenName(name)) return false;
    return true;
  }

  function upsert(fullPath, stats, isDirectory) {
    const name = path.basename(fullPath);
    insertStmt.run(
      fullPath,
      name,
      isDirectory ? "" : extensionOf(name),
      path.dirname(fullPath),
      path.basename(path.dirname(fullPath)),
      isDirectory ? 0 : Number(stats?.size ?? 0),
      Math.round(stats?.mtimeMs ?? 0),
      Math.round(stats?.birthtimeMs ?? 0),
      contentTypeFor(name, isDirectory),
      isHiddenName(name) ? 1 : 0,
    );
  }

  /**
   * Depth-first walk of one scope root. Directories are indexed too (Raycast's `Directory` type
   * filter lists folders). Yields to the event loop every `YIELD_EVERY` entries and reports
   * progress at most once per second so the pipe loop and the renderer stay responsive.
   */
  async function walk(root, onEntry) {
    const stack = [root];
    let processed = 0;
    let nextReport = Date.now() + PROGRESS_EVERY_MS;
    while (stack.length > 0) {
      if (stopRequested) return false;
      const directory = stack.pop();
      let dirents;
      try {
        dirents = await fsp.readdir(directory, { withFileTypes: true });
      } catch {
        continue; // permission denied, vanished mid-walk, etc.
      }
      for (const dirent of dirents) {
        if (stopRequested) return false;
        const full = path.join(directory, dirent.name);
        const isDirectory = dirent.isDirectory();
        if (!shouldIndex(full, dirent.name, isDirectory)) continue;
        if (isDirectory) {
          onEntry(full, null, true);
          stack.push(full);
          fileCount++;
        } else if (dirent.isFile()) {
          try {
            const stats = await fsp.stat(full);
            onEntry(full, stats, false);
            fileCount++;
          } catch {
            continue;
          }
        }
        processed++;
        if (processed % YIELD_EVERY === 0) await yieldToEventLoop();
        if (Date.now() >= nextReport) {
          pushState();
          nextReport = Date.now() + PROGRESS_EVERY_MS;
        }
      }
    }
    return true;
  }

  async function runIndexing() {
    state = "indexing";
    fileCount = 0;
    indexStart = Date.now();
    stopRequested = false;
    pushState();

    const batch = [];
    const flush = () => {
      if (batch.length === 0) return;
      try {
        db.exec("BEGIN");
        for (const row of batch) {
          try {
            row();
          } catch {
            // The entry vanished or turned unreadable between the walk and the write: skip it.
          }
        }
        db.exec("COMMIT");
      } catch {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* no transaction open */
        }
      }
      batch.length = 0;
    };
    const onEntry = (full, stats, isDirectory) => {
      batch.push(() => upsert(full, stats, isDirectory));
      if (batch.length >= 500) flush();
    };

    try {
      db.exec("DELETE FROM file_index");
      let completed = true;
      for (const scope of settings.include) {
        if (!scope || !fs.existsSync(scope)) continue;
        completed = (await walk(scope, onEntry)) && completed;
      }
      flush();
      if (!completed) {
        state = "stopped";
        pushState({ fileCount }, true);
        return { status: "ready", stopped: true, fileCount, durationMs: Date.now() - indexStart };
      }
      state = "idle";
      const durationMs = Date.now() - indexStart;
      pushState({ fileCount, durationMs }, true);
      console.log(`[fileSearch] indexed ${fileCount} entries in ${durationMs}ms`); // counts only
      return { status: "ready", fileCount, durationMs };
    } catch (error) {
      state = "failed";
      pushState({ error: error instanceof Error ? error.message : String(error) }, true);
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      flush();
      currentRun = null;
    }
  }

  function startIndexing() {
    if (currentRun) return currentRun;
    currentRun = runIndexing();
    return currentRun;
  }

  function stopIndexing() {
    if (state !== "indexing") return { status: "ready", state };
    stopRequested = true;
    return { status: "ready", state: "stopping" };
  }

  function closeWatchers() {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
    watchers = [];
    for (const timer of debounces.values()) clearTimeout(timer);
    debounces.clear();
  }

  function handleWatchEvent(scope, relativePath) {
    if (!relativePath) return;
    const full = path.join(scope, String(relativePath));
    const existing = debounces.get(full);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      debounces.delete(full);
      try {
        const stats = await fsp.stat(full);
        const isDirectory = stats.isDirectory();
        if (!shouldIndex(full, path.basename(full), isDirectory)) {
          deleteStmt.run(full);
          return;
        }
        upsert(full, stats, isDirectory);
        if (isDirectory) {
          // A new directory arrives as one rename event: index its subtree incrementally.
          fileCount = 0;
          await walk(full, (child, childStats, childIsDirectory) => upsert(child, childStats, childIsDirectory));
        }
      } catch {
        // Gone (deleted or renamed away): drop the row; a directory subtree goes with it.
        deleteTreeStmt.run(full, `${escapeLike(full)}\\%`);
      }
    }, WATCH_DEBOUNCE_MS);
    debounces.set(full, timer);
  }

  function escapeLike(value) {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  function watchScopes() {
    closeWatchers();
    for (const scope of settings.include) {
      if (!scope || !fs.existsSync(scope)) continue;
      try {
        const watcher = fs.watch(scope, { recursive: true }, (event, filename) =>
          handleWatchEvent(scope, filename),
        );
        watchers.push(watcher);
      } catch {
        // Scope vanished or is unreadable — search simply returns nothing for it.
      }
    }
  }

  function scopeRowCount() {
    let total = 0;
    for (const scope of settings.include) {
      if (!scope) continue;
      // SQLite's LIKE is case-insensitive for ASCII, matching Windows paths either way.
      const row = db
        .prepare(`SELECT COUNT(*) AS count FROM file_index WHERE path = ? OR path LIKE ? ${LIKE_ESCAPE}`)
        .get(scope, `${escapeLike(scope)}\\%`);
      total += row?.count ?? 0;
    }
    return total;
  }

  function validateSettings(patch) {
    const next = { ...settings };
    for (const key of ["showInRootSearch", "contentSearch", "contentSearchInRootSearch", "includeHiddenFiles", "respectIgnoreFiles"]) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== "boolean") throw new Error(`fileSearch setting "${key}" must be a boolean`);
        next[key] = patch[key];
      }
    }
    if (patch.include !== undefined) {
      if (!Array.isArray(patch.include) || patch.include.some((item) => typeof item !== "string")) {
        throw new Error('fileSearch setting "include" must be an array of paths');
      }
      next.include = patch.include.map((item) => path.resolve(item));
    }
    if (patch.ignore !== undefined) {
      if (!Array.isArray(patch.ignore) || patch.ignore.some((item) => typeof item !== "string")) {
        throw new Error('fileSearch setting "ignore" must be an array of patterns');
      }
      next.ignore = patch.ignore.map((item) => String(item).trim()).filter(Boolean);
    }
    return next;
  }

  function applySettings(next) {
    const structureChanged =
      JSON.stringify(next.include) !== JSON.stringify(settings.include) ||
      JSON.stringify(next.ignore) !== JSON.stringify(settings.ignore) ||
      next.includeHiddenFiles !== settings.includeHiddenFiles;
    settings = next;
    persistSettings();
    compiledUser = compileIgnorePatterns(settings.ignore);
    pushSettings();
    if (structureChanged) startIndexing();
    watchScopes();
    return { status: "ready", settings };
  }

  const LIKE_ESCAPE = "ESCAPE '\\'";

  function search({ query = "", type = "all", sort = "rank", limit = 100 } = {}) {
    const trimmed = String(query).trim();
    const includeHidden = settings.includeHiddenFiles;
    const params = [];
    const conditions = [];

    if (type === "directory") conditions.push("fi.content_type = 'directory'");
    else if (type === "file") conditions.push("fi.content_type != 'directory'");
    else if (type !== "all") {
      conditions.push("fi.content_type = ?");
      params.push(type);
    }
    if (!includeHidden) conditions.push("fi.hidden = 0");

    let rankingOrder;
    if (trimmed.length > 0) {
      const needle = `%${escapeLike(trimmed.toLowerCase())}%`;
      const prefix = `${escapeLike(trimmed.toLowerCase())}%`;
      conditions.push(`(fi.name LIKE ? ${LIKE_ESCAPE} OR fi.path LIKE ? ${LIKE_ESCAPE})`);
      params.push(needle, needle);
      // Confirmed ranking tiers: name-prefix > name-substring > path match, then usage count,
      // then modified time. The explicit sort options (Date Modified/Date Created/Name) replace
      // the relevance order when chosen in the view.
      rankingOrder =
        sort === "rank"
          ? `CASE
              WHEN fi.name LIKE ? ${LIKE_ESCAPE} THEN 0
              WHEN fi.name LIKE ? ${LIKE_ESCAPE} THEN 1
              ELSE 2 END, usage DESC, fi.modified_time DESC`
          : sort === "name"
            ? "fi.name COLLATE NOCASE ASC"
            : sort === "created"
              ? "fi.created_time DESC, usage DESC"
              : "fi.modified_time DESC, usage DESC";
      if (sort === "rank") params.push(prefix, needle);
    } else {
      // Empty query (the view's landing list) reads like Raycast's Recently Used: latest first.
      rankingOrder =
        sort === "name"
          ? "fi.name COLLATE NOCASE ASC"
          : sort === "created"
            ? "fi.created_time DESC, usage DESC"
            : "fi.modified_time DESC, usage DESC";
    }

    const sql = `
      SELECT fi.path, fi.name, fi.extension, fi.folder, fi.parent_folder, fi.size,
             fi.modified_time, fi.created_time, fi.content_type, fi.hidden,
             COALESCE(fu.count, 0) AS usage
      FROM file_index fi LEFT JOIN file_usage fu ON fu.path = fi.path
      ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY ${rankingOrder}
      LIMIT ?`;
    params.push(Math.max(1, Math.min(1000, Number(limit) || 100)));

    const rows = db.prepare(sql).all(...params);
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      extension: row.extension,
      folder: row.folder,
      parentFolder: row.parent_folder,
      modifiedTime: row.modified_time,
      createdTime: row.created_time,
      size: row.size,
      contentType: row.content_type,
      hidden: row.hidden === 1,
      usageCount: row.usage,
    }));
  }

  async function getMetadata({ path: filePath }) {
    if (!filePath) throw new Error("path is required");
    const stats = await fsp.stat(filePath);
    const name = path.basename(filePath);
    const isDirectory = stats.isDirectory();
    const typeLabels = { directory: "Folder", archive: "Archive", document: "Document", image: "Image", video: "Video", audio: "Audio", text: "Text", other: "Other" };
    return {
      name,
      where: path.dirname(filePath),
      type: typeLabels[contentTypeFor(name, isDirectory)] ?? "Other",
      size: isDirectory ? null : Number(stats.size),
      created: Math.round(stats.birthtimeMs),
      modified: Math.round(stats.mtimeMs),
      accessed: Math.round(stats.atimeMs),
    };
  }

  const handlers = {
    search: (data) => ({
      status: "ready",
      results: search(data ?? {}),
      state,
      fileCount,
    }),
    getMetadata: (data) => getMetadata(data ?? {}),
    getState: () => ({ status: "ready", state, fileCount }),
    startIndexing: async () => await startIndexing(),
    stopIndexing: () => stopIndexing(),
    getSettings: () => ({ status: "ready", settings }),
    setSettings: (data) => applySettings(validateSettings(data ?? {})),
    resetToDefaults: () =>
      applySettings(
        validateSettings({
          include: [os.homedir()],
          ignore: [],
          includeHiddenFiles: false,
          showInRootSearch: true,
        }),
      ),
    excludeFromIndex: (data) => {
      const target = data?.path;
      if (!target) throw new Error("path is required");
      if (!settings.ignore.includes(target)) {
        settings = { ...settings, ignore: [...settings.ignore, target] };
        persistSettings();
        compiledUser = compileIgnorePatterns(settings.ignore);
      }
      deleteTreeStmt.run(target, `${escapeLike(target)}\\%`);
      pushSettings();
      return { status: "ready", settings };
    },
    trackUsage: (data) => {
      if (!data?.path) throw new Error("path is required");
      usageStmt.run(data.path);
      return { status: "ready" };
    },
  };

  watchScopes();
  if (autoStart && (firstRun || scopeRowCount() === 0)) {
    startIndexing();
  }

  function close() {
    stopRequested = true;
    closeWatchers();
    db.close();
  }

  return { handlers, search, settings: () => ({ ...settings }), state: () => state, close };
}

module.exports = {
  createFileIndexer,
  compileIgnorePatterns,
  isIgnored,
  globToRegExp,
  contentTypeFor,
  extensionOf,
  isHiddenName,
  WINDOWS_DEFAULT_EXCLUDES,
  DEFAULT_SETTINGS,
};
