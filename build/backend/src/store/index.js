// The extension store (the Raycast-Store-style browse/install surface, FlowKey migration era):
//
//   <dataRoot>/store/
//     catalog/<name>/package.json   GitHub metadata cache (one file per extension)
//     catalog/index.json            the merged sync result the list view reads
//     catalog/sync-state.json       live progress for the Store view's progress row
//     icons/ · screenshots/ · readme/   lazily downloaded, content-cached
//     installed/<name>/             full GitHub source downloads (staging for the porting pass)
//     uploaded/<name>/              FlowKey extensions imported/published locally (see uploads.js)
//     store-state.json              installed marks
//
// `store.sync` walks the raycast/extensions repo (2 API calls, then ~1800 package.json CDN
// fetches) and never blocks the pipe: it starts a background run and `store.status` reports
// progress. Installing an uploaded (FlowKey) extension copies it into the live extensions root;
// installing a GitHub extension stages its full source under installed/ — those are still
// @raycast/api sources and light up in the app once ported to the FlowKey library.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const github = require("./github");
const uploads = require("./uploads");

const IMAGE_EXT = uploads.IMAGE_EXT;
const CONCURRENCY = 24;

function storePaths(storeRoot) {
  return {
    catalog: path.join(storeRoot, "catalog"),
    icons: path.join(storeRoot, "icons"),
    screenshots: path.join(storeRoot, "screenshots"),
    readme: path.join(storeRoot, "readme"),
    installed: path.join(storeRoot, "installed"),
    state: path.join(storeRoot, "store-state.json"),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readState(storeRoot) {
  return readJson(storePaths(storeRoot).state) ?? { installed: {} };
}

function writeState(storeRoot, state) {
  writeJson(storePaths(storeRoot).state, state);
}

function markInstalled(storeRoot, key, extra = {}) {
  const state = readState(storeRoot);
  state.installed[key] = { at: new Date().toISOString(), ...extra };
  writeState(storeRoot, state);
}

function isMarkedInstalled(storeRoot, key) {
  return Boolean(readState(storeRoot).installed[key]);
}

// --- sync -------------------------------------------------------------------------------------

function entryFromPackage(name, pkg) {
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name ?? null;
  return {
    source: "github",
    name,
    title: pkg.title ?? name,
    description: pkg.description ?? "",
    author,
    categories: Array.isArray(pkg.categories) ? pkg.categories : [],
    icon: typeof pkg.icon === "string" ? pkg.icon : null,
    contributors: Array.isArray(pkg.contributors) ? pkg.contributors : [],
    sha: null,
    installedAt: null,
  };
}

async function syncStoreCatalog({ storeRoot, fetchImpl = fetch, log = () => {} } = {}) {
  const { catalog } = storePaths(storeRoot);
  const syncStateFile = path.join(catalog, "sync-state.json");
  const startedAt = new Date().toISOString();
  writeJson(syncStateFile, { running: true, phase: "listing", done: 0, total: 0, startedAt, error: null });

  try {
    const dirs = await github.fetchExtensionDirs(fetchImpl);
    const headCommitDate = await github.fetchLastCommitDate("", fetchImpl);
    writeJson(syncStateFile, { running: true, phase: "packages", done: 0, total: dirs.length, startedAt, error: null });
    log(`store sync: ${dirs.length} extensions`);

    const index = { syncedAt: startedAt, headCommitDate, extensions: [] };
    let done = 0;
    let failed = 0;
    const failures = [];
    await github.pool(
      dirs,
      CONCURRENCY,
      async (dir) => {
        const raw = await github.fetchRawText(`extensions/${dir.name}/package.json`, fetchImpl);
        const pkg = JSON.parse(raw);
        const entry = entryFromPackage(dir.name, pkg);
        entry.sha = dir.sha;
        fs.mkdirSync(path.join(catalog, dir.name), { recursive: true });
        fs.writeFileSync(path.join(catalog, dir.name, "package.json"), raw);
        index.extensions.push(entry);
      },
      (dir, error) => {
        failed += 1;
        failures.push(`${dir.name}: ${error.message}`);
      },
    );
    // Progress in one write per quarter instead of per file.
    const progressWriter = setInterval(() => {
      try {
        writeJson(syncStateFile, { running: true, phase: "packages", done, total: dirs.length, startedAt, error: null });
      } catch {
        /* status write is best-effort */
      }
    }, 2000);
    progressWriter.unref?.();

    index.extensions.sort((a, b) => a.title.localeCompare(b.title));
    writeJson(path.join(catalog, "index.json"), index);
    writeJson(syncStateFile, {
      running: false,
      phase: "done",
      done: dirs.length,
      total: dirs.length,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: failed > 0 ? `${failed} extension(s) failed; first: ${failures[0]}` : null,
    });
    log(`store sync: done (${index.extensions.length} indexed, ${failed} failed)`);
    return { synced: index.extensions.length, failed };
  } catch (error) {
    writeJson(syncStateFile, {
      running: false,
      phase: "error",
      done: 0,
      total: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// --- reads ------------------------------------------------------------------------------------

function readIndex(storeRoot) {
  return readJson(path.join(storePaths(storeRoot).catalog, "index.json"));
}

function storeStatus(storeRoot) {
  const syncState = readJson(path.join(storePaths(storeRoot).catalog, "sync-state.json"));
  const index = readIndex(storeRoot);
  const state = readState(storeRoot);
  return {
    running: syncState?.running ?? false,
    phase: syncState?.phase ?? "never",
    done: syncState?.done ?? 0,
    total: syncState?.total ?? 0,
    error: syncState?.error ?? null,
    syncedAt: index?.syncedAt ?? null,
    headCommitDate: index?.headCommitDate ?? null,
    extensionCount: index?.extensions?.length ?? 0,
    uploadedCount: uploads.listUploadedExtensions(storeRoot).length,
    installedCount: Object.keys(state.installed).length,
  };
}

function liveExtensionIds(extensionsRoot) {
  const ids = new Set();
  try {
    for (const entry of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = uploads.readJson(path.join(extensionsRoot, entry.name, "manifest.json"));
      if (manifest?.id) ids.add(manifest.id);
    }
  } catch {
    /* no extensions root */
  }
  return ids;
}

/**
 * The merged catalog: uploaded entries first, then the GitHub index, with install state applied.
 * Paginated — the full index is well over a megabyte and a pipe message that size never reached
 * the renderer; slices of ~100 keep each response small and the list loads more on scroll.
 *
 * The default browse list is what can actually run here (uploaded FlowKey extensions plus GitHub
 * entries that were installed); the unported ~3,400 Raycast-only entries stay behind `showAll`
 * so the Store does not drown them out.
 */
function listStoreExtensions({ storeRoot, extensionsRoot, query = "", category = null, offset = 0, limit = 100, showAll = false }) {
  const index = readIndex(storeRoot);
  const live = liveExtensionIds(extensionsRoot);
  const state = readState(storeRoot);
  const uploaded = uploads.listUploadedExtensions(storeRoot);
  const uploadedNames = new Set(uploaded.map((entry) => entry.name));
  const githubEntries = showAll
    ? (index?.extensions ?? [])
    : (index?.extensions ?? []).filter((entry) => Boolean(state.installed[`github:${entry.name}`]));
  const entries = [
    ...uploaded,
    ...githubEntries.filter((entry) => !uploadedNames.has(entry.name)),
  ];
  const needle = query.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    if (category && !(entry.categories ?? []).includes(category)) return false;
    if (!needle) return true;
    return (
      entry.title.toLowerCase().includes(needle) ||
      entry.name.toLowerCase().includes(needle) ||
      (entry.description ?? "").toLowerCase().includes(needle) ||
      (entry.author ?? "").toLowerCase().includes(needle)
    );
  });
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(Math.max(1, Number(limit) || 100), 500);
  return {
    syncedAt: index?.syncedAt ?? null,
    categories: [...new Set(entries.flatMap((entry) => entry.categories ?? []))].sort(),
    total: filtered.length,
    offset: start,
    hasMore: start + size < filtered.length,
    extensions: filtered.slice(start, start + size).map((entry) => ({
      ...entry,
      installed: Boolean(state.installed[`${entry.source}:${entry.name}`]) || live.has(entry.name),
    })),
  };
}

/**
 * The detail page payload. GitHub extensions lazily fetch (and cache) their file listing for
 * screenshots and their last commit date — two API calls on first view, none afterwards.
 */
async function storeDetail({ storeRoot, extensionsRoot, fetchImpl = fetch, name, source }) {
  if (source === "uploaded") {
    const dir = uploads.uploadedDir(storeRoot, name);
    const manifest = uploads.readJson(path.join(dir, "manifest.json"));
    if (!manifest) throw new Error(`store.detail: uploaded extension ${name} not found`);
    const meta = uploads.readJson(path.join(dir, "store.json")) ?? {};
    const live = liveExtensionIds(extensionsRoot);
    let screenshots = meta.screenshots ?? [];
    if (screenshots.length === 0) {
      try {
        screenshots = fs
          .readdirSync(path.join(dir, "assets", "screenshots"))
          .filter((file) => IMAGE_EXT.test(file))
          .map((file) => `assets/screenshots/${file}`);
      } catch {
        screenshots = [];
      }
    }
    // Uploaded screenshots are local files: hand the frontend ready-to-<img> URIs.
    const screenshotUris = screenshots.map((relative) =>
      /^file:|^https?:/.test(relative)
        ? relative
        : `file:///${path.join(dir, relative).replace(/\\/g, "/")}`,
    );
    let readme = null;
    try {
      readme = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
    } catch {
      readme = null;
    }
    return {
      source: "uploaded",
      name,
      title: manifest.name ?? name,
      description: manifest.description ?? "",
      author: meta.author ?? manifest.author ?? null,
      categories: meta.categories ?? [],
      commands: (manifest.commands ?? []).map((command) => ({
        name: command.id ?? command.name,
        title: command.title ?? command.id,
        description: command.description ?? "",
        mode: command.mode ?? "view",
      })),
      contributors: [],
      lastUpdate: meta.importedAt ?? null,
      screenshots: screenshotUris,
      readme,
      readmeUrl: null,
      installed: live.has(manifest.id),
      runnable: true,
      version: manifest.version ?? null,
    };
  }

  const pkgFile = path.join(storePaths(storeRoot).catalog, path.basename(name), "package.json");
  const pkg = uploads.readJson(pkgFile);
  if (!pkg) throw new Error(`store.detail: ${name} is not in the catalog; sync first`);
  const detailCache = path.join(storePaths(storeRoot).catalog, path.basename(name), "detail.json");
  let extra = uploads.readJson(detailCache);
  if (!extra) {
    const dirs = await github.fetchExtensionDirs(fetchImpl);
    const sha = dirs.find((dir) => dir.name === name)?.sha;
    let screenshots = [];
    try {
      const listing = sha ? await github.fetchDirListing(sha, fetchImpl) : [];
      // The repo's store screenshots live under `metadata/screenshot-*.png`; older extensions
      // keep them in `assets/screenshots/`. Icons never count as screenshots.
      screenshots = listing
        .map((blob) => blob.path)
        .filter(
          (filePath) =>
            IMAGE_EXT.test(filePath) &&
            (/^metadata\//.test(filePath) || /^assets\/screenshots\//.test(filePath)) &&
            !/icon/i.test(path.basename(filePath)),
        )
        .sort();
    } catch {
      screenshots = [];
    }
    let lastUpdate = null;
    try {
      lastUpdate = await github.fetchLastCommitDate(`extensions/${name}`, fetchImpl);
    } catch {
      lastUpdate = null;
    }
    extra = { screenshots, lastUpdate };
    writeJson(detailCache, extra);
  }

  let readme = null;
  const readmeCache = path.join(storePaths(storeRoot).readme, `${path.basename(name)}.md`);
  try {
    readme = fs.readFileSync(readmeCache, "utf-8");
  } catch {
    try {
      readme = await github.fetchRawText(`extensions/${name}/README.md`, fetchImpl);
      fs.mkdirSync(path.dirname(readmeCache), { recursive: true });
      fs.writeFileSync(readmeCache, readme);
    } catch {
      readme = null;
    }
  }

  const live = liveExtensionIds(extensionsRoot);
  return {
    source: "github",
    name,
    title: pkg.title ?? name,
    description: pkg.description ?? "",
    author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name ?? null,
    categories: Array.isArray(pkg.categories) ? pkg.categories : [],
    commands: (pkg.commands ?? []).map((command) => ({
      name: command.name,
      title: command.title ?? command.name,
      description: command.description ?? "",
      mode: command.mode ?? "view",
    })),
    contributors: Array.isArray(pkg.contributors) ? pkg.contributors : [],
    lastUpdate: extra.lastUpdate,
    screenshots: extra.screenshots,
    readme,
    readmeUrl: github.blobUrl(`extensions/${name}/README.md`),
    installed: isMarkedInstalled(storeRoot, `github:${name}`) || live.has(name),
    runnable: live.has(name),
    version: null,
  };
}

const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon" };

function dataUrlFromFile(file) {
  const mime = IMAGE_MIME[path.extname(file).slice(1).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** The extension icon as a data URL (lazily downloaded from the repo, cached on disk). */
async function storeIcon({ storeRoot, extensionsRoot, fetchImpl = fetch, name, source }) {
  const key = `${source}-${path.basename(name)}`;
  if (source === "uploaded") {
    const dir = uploads.uploadedDir(storeRoot, name);
    const manifest = uploads.readJson(path.join(dir, "manifest.json"));
    const declared = typeof manifest?.icon === "string" ? manifest.icon : null;
    if (declared) {
      for (const candidate of [path.join(dir, "assets", declared), path.join(dir, declared)]) {
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return { icon: dataUrlFromFile(candidate), emoji: null };
          }
        } catch {
          /* unreadable candidate falls through */
        }
      }
    }
    // Manifest icons may be emoji (FlowKey convention) rather than files — surface them as-is.
    const emoji = declared && !/[\\/]/.test(declared) && !declared.includes(".") ? declared : null;
    return { icon: null, emoji };
  }
  // A live FlowKey install of the same name wins: the store shows what actually runs.
  const liveIcon = path.join(extensionsRoot, path.basename(name), "icon.png");
  if (fs.existsSync(liveIcon)) {
    return { icon: `data:image/png;base64,${fs.readFileSync(liveIcon).toString("base64")}` };
  }
  const iconsDir = storePaths(storeRoot).icons;
  try {
    for (const file of fs.readdirSync(iconsDir)) {
      if (file.startsWith(`${key}.`)) {
        const cachedFile = path.join(iconsDir, file);
        return { icon: `data:image/${path.extname(file).slice(1)};base64,${fs.readFileSync(cachedFile).toString("base64")}` };
      }
    }
  } catch {
    /* empty icon cache */
  }
  const pkg = uploads.readJson(path.join(storePaths(storeRoot).catalog, path.basename(name), "package.json"));
  if (!pkg?.icon) return { icon: null };
  // package.json `icon` is repo-root-relative to the extension directory (e.g. "command-icon.png"
  // or "assets/icon.png") — it already carries its own folder.
  const bytes = await github.fetchRawBuffer(`extensions/${name}/${String(pkg.icon).replace(/^\.\//, "")}`, fetchImpl);
  const ext = path.extname(pkg.icon) || ".png";
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(iconsDir, `${key}${ext}`), bytes);
  return { icon: `data:image/${ext.slice(1)};base64,${bytes.toString("base64")}` };
}

/** One screenshot as a `file://` URI the frontend can <img> (downloaded and cached on demand). */
async function storeScreenshot({ storeRoot, fetchImpl = fetch, name, screenshotPath }) {
  const clean = String(screenshotPath ?? "").replace(/\\/g, "/");
  if (!clean || clean.includes("..")) throw new Error("store.screenshot: invalid path");
  const file = path.join(storePaths(storeRoot).screenshots, path.basename(name), path.basename(clean));
  if (!fs.existsSync(file)) {
    const bytes = await github.fetchRawBuffer(`extensions/${name}/${clean}`, fetchImpl);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return { uri: `file:///${file.replace(/\\/g, "/")}` };
}

// --- install ----------------------------------------------------------------------------------

async function installStoreExtension({ storeRoot, extensionsRoot, fetchImpl = fetch, name, source, log = () => {} }) {
  if (source === "uploaded") {
    const dir = uploads.uploadedDir(storeRoot, name);
    const manifest = uploads.readJson(path.join(dir, "manifest.json"));
    if (!manifest?.id) throw new Error(`store.install: uploaded extension ${name} has no manifest.json`);
    const target = path.join(extensionsRoot, manifest.id);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(extensionsRoot, { recursive: true });
    fs.cpSync(dir, target, { recursive: true, filter: (item) => !/node_modules([/\\]|$)/.test(item) });
    markInstalled(storeRoot, `uploaded:${name}`, { live: manifest.id });
    log(`store install: ${name} -> ${target}`);
    return { installed: true, runnable: true, live: manifest.id };
  }

  // GitHub extension: stage the full source under installed/<name> (the porting pass works from
  // there). It only reaches the live extensions root if a FlowKey manifest is already present.
  const dirs = await github.fetchExtensionDirs(fetchImpl);
  const sha = dirs.find((dir) => dir.name === name)?.sha;
  if (!sha) throw new Error(`store.install: ${name} is not in the extensions repo`);
  const staging = path.join(storePaths(storeRoot).installed, path.basename(name));
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const listing = await github.fetchDirListing(sha, fetchImpl);
  let failed = 0;
  await github.pool(
    listing,
    CONCURRENCY,
    async (blob) => {
      // `fetchDirListing` paths are relative to the extension directory (the git trees contract).
      const file = path.join(staging, blob.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await github.fetchRawBuffer(`extensions/${name}/${blob.path}`, fetchImpl));
    },
    (blob, error) => {
      failed += 1;
      log(`store install: ${blob.path} failed: ${error.message}`);
    },
  );
  if (failed > 0) throw new Error(`store.install: ${failed} file(s) failed to download`);
  const manifest = uploads.readJson(path.join(staging, "manifest.json"));
  let live = null;
  if (manifest?.id) {
    live = manifest.id;
    const target = path.join(extensionsRoot, manifest.id);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(staging, target, { recursive: true, filter: (item) => !/node_modules([/\\]|$)/.test(item) });
  }
  markInstalled(storeRoot, `github:${name}`, { staged: staging, live });
  return { installed: true, runnable: Boolean(live), live, staged: staging };
}

// --- the handler table ------------------------------------------------------------------------

function createExtensionStore({ dataRoot, extensionsRoot, fetchImpl = fetch } = {}) {
  const storeRoot = path.join(dataRoot, "store");
  let syncRunning = false;

  const handlers = {
    /** Starts a catalog sync in the background; `store.status` reports progress. */
    async sync() {
      if (syncRunning) return { started: false, reason: "sync already running" };
      syncRunning = true;
      void syncStoreCatalog({ storeRoot, fetchImpl, log: (message) => console.log(`[store] ${message}`) })
        .catch((error) => console.error("[store] sync failed:", error.message))
        .finally(() => {
          syncRunning = false;
        });
      return { started: true };
    },
    status() {
      return storeStatus(storeRoot);
    },
    list(params) {
      return listStoreExtensions({
        storeRoot,
        extensionsRoot,
        query: String(params?.query ?? ""),
        category: params?.category ?? null,
        offset: Number(params?.offset) || 0,
        limit: Number(params?.limit) || 100,
        showAll: params?.showAll === true,
      });
    },
    detail(params) {
      return storeDetail({
        storeRoot,
        extensionsRoot,
        fetchImpl,
        name: String(params?.name ?? ""),
        source: params?.source === "uploaded" ? "uploaded" : "github",
      });
    },
    async icon(params) {
      return storeIcon({
        storeRoot,
        extensionsRoot,
        fetchImpl,
        name: String(params?.name ?? ""),
        source: params?.source === "uploaded" ? "uploaded" : "github",
      });
    },
    screenshot(params) {
      return storeScreenshot({
        storeRoot,
        fetchImpl,
        name: String(params?.name ?? ""),
        screenshotPath: params?.path,
      });
    },
    async install(params) {
      return installStoreExtension({
        storeRoot,
        extensionsRoot,
        fetchImpl,
        name: String(params?.name ?? ""),
        source: params?.source === "uploaded" ? "uploaded" : "github",
        log: (message) => console.log(`[store] ${message}`),
      });
    },
    /** Publish a local FlowKey extension folder into the Store's uploaded entries. */
    import(params) {
      const sourceDir = String(params?.sourceDir ?? "");
      if (!sourceDir) throw new Error("store.import: sourceDir is required");
      return uploads.importUploadedExtension({ storeRoot, sourceDir, author: params?.author ?? null });
    },
  };

  return { handlers, storeRoot };
}

module.exports = {
  createExtensionStore,
  syncStoreCatalog,
  storeStatus,
  listStoreExtensions,
  storeDetail,
  storeIcon,
  storeScreenshot,
  installStoreExtension,
  storePaths,
};
