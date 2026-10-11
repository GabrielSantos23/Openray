// File Search (`fileSearch.*` handlers): the indexer over a real temp tree — content-type
// classification, the confirmed Windows default excludes, ignore patterns, hidden files, the
// confirmed ranking tiers (name-prefix > name-substring > path, then usage, then modified),
// the type filter, the incremental watcher, settings round-trip/reset, excludeFromIndex,
// metadata, and the backend.js wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createFileIndexer,
  compileIgnorePatterns,
  isIgnored,
  WINDOWS_DEFAULT_EXCLUDES,
} = require("../src/file-indexer.js");
const { createBackend } = require("../src/backend.js");

// The tree must live OUTSIDE %USERPROFILE%: os.tmpdir() sits under AppData and the confirmed
// `**/AppData/**` default exclude would swallow it whole.
const scratchRoot = fileURLToPath(new URL("../../", import.meta.url));

/** A real directory tree exercising every content type and every default exclude. */
function makeTree() {
  const root = fs.mkdtempSync(path.join(scratchRoot, "fs-tree-"));
  const write = (relative, content = "x") => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  };
  return {
    root,
    notes: write("notes.txt"),
    photo: write("photo.png", "png"),
    archive: write("archive.zip"),
    video: write("clip.mp4"),
    song: write("song.mp3"),
    report: write("report.pdf"),
    tool: write("tool.exe"),
    alphabet: write("alphabet.txt"),
    alphaTool: write("alphatool.txt"),
    substringHit: write("sub/extra-alpha-file.txt"),
    pathOnly: write("alphafolder/plain.txt"),
    secret: write("secret.txt"),
    hidden: write(".hidden-file"),
    insideHiddenDir: write(".hiddendir/inner.txt"),
    inNodeModules: write("node_modules/lib.js"),
    inTmp: write("tmp/scratch.txt"),
    inCache: write("cache/cached.txt"),
    tempFile: write("leftover.temp"),
  };
}

async function withIndexer(run, tree) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "file-search-index-"));
  const notifications = [];
  const indexer = createFileIndexer({
    dataRoot: directory,
    pushToFrontend: (method, data) => notifications.push({ method, data }),
    autoStart: false,
  });
  indexer.handlers.setSettings({ include: [tree.root] });
  const result = await indexer.handlers.startIndexing();
  const cleanup = () => {
    indexer.close();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(tree.root, { recursive: true, force: true });
  };
  const outcome = await run(indexer, notifications, result);
  cleanup();
  return outcome;
}

function search(indexer, query, options = {}) {
  return indexer.handlers.search({ query, ...options }).results.map((row) => row.name);
}

// ---------------------------------------------------------------------------------------------
// Indexing and content types
// ---------------------------------------------------------------------------------------------

test("indexing completes, reports counts through indexState pushes and classifies content types", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer, notifications, result) => {
    assert.equal(result.status, "ready");
    assert.ok(result.fileCount >= 13, `expected the full tree, got ${result.fileCount}`);
    const statePushes = notifications.filter((push) => push.method === "fileSearch.indexState");
    const finalPush = statePushes.at(-1)?.data;
    assert.equal(finalPush.state, "idle");
    assert.ok(finalPush.fileCount >= 13);
    assert.ok(typeof finalPush.durationMs === "number");

    const types = indexer.handlers.search({ query: "" });
    const byType = (type) => types.results.filter((row) => row.contentType === type).map((row) => row.name);
    assert.deepEqual(byType("image"), ["photo.png"]);
    assert.deepEqual(byType("archive"), ["archive.zip"]);
    assert.deepEqual(byType("video"), ["clip.mp4"]);
    assert.deepEqual(byType("audio"), ["song.mp3"]);
    assert.deepEqual(byType("document"), ["report.pdf"]);
    assert.ok(byType("text").includes("notes.txt"));
    assert.ok(byType("other").includes("tool.exe"));
    assert.ok(types.results.some((row) => row.contentType === "directory" && row.name === "sub"));
  }, tree);
});

test("the confirmed Windows default excludes never reach the index", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    const names = search(indexer, "");
    assert.ok(names.includes("notes.txt"), "ordinary files are indexed");
    assert.ok(!names.includes("lib.js"), "node_modules must be excluded");
    assert.ok(!names.includes("scratch.txt"), "tmp/ must be excluded");
    assert.ok(!names.includes("cached.txt"), "the [Cc]ache class must match lowercase cache dirs");
    assert.ok(!names.includes("leftover.temp"), "*.temp must be excluded");
    assert.ok(!names.includes(".hidden-file"), "hidden files are excluded by default");
    assert.ok(!names.includes("inner.txt"), "hidden directories are excluded with their contents");
  }, tree);
});

test("the type filter narrows results: Directory and File are category queries", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    const directories = indexer.handlers.search({ query: "", type: "directory" }).results;
    assert.ok(directories.length > 0);
    assert.ok(directories.every((row) => row.contentType === "directory"));
    const files = indexer.handlers.search({ query: "txt", type: "file" }).results;
    assert.ok(files.length > 0);
    assert.ok(files.every((row) => row.contentType !== "directory"));
    assert.deepEqual(search(indexer, "", { type: "image" }), ["photo.png"]);
  }, tree);
});

test("includeHiddenFiles reveals dot files and their directories", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    indexer.handlers.setSettings({ includeHiddenFiles: true });
    await indexer.handlers.startIndexing();
    const names = search(indexer, "");
    assert.ok(names.includes(".hidden-file"));
    assert.ok(names.includes("inner.txt"));
  }, tree);
});

// ---------------------------------------------------------------------------------------------
// Ranking (confirmed tiers)
// ---------------------------------------------------------------------------------------------

test("name-prefix beats name-substring beats path match, then usage, then modified time", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    const ranked = indexer.handlers.search({ query: "alpha", sort: "rank" }).results;
    // Tier 0: name prefixes (the two files plus the `alphafolder` directory row, whose internal
    // order is free on identical mtimes); tier 1: the name substring; tier 2: the path match.
    assert.deepEqual(
      [ranked.slice(0, 3).map((row) => row.name).sort(), ranked[3]?.name, ranked[4]?.name],
      [
        ["alphabet.txt", "alphafolder", "alphatool.txt"],
        "extra-alpha-file.txt",
        "plain.txt",
      ],
    );
    // plain.txt only matches because its folder name does — the path tier.
    assert.equal(ranked.at(-1).contentType, "text");

    // Usage counts reorder within a tier, never across tiers.
    indexer.handlers.trackUsage({ path: tree.alphaTool });
    indexer.handlers.trackUsage({ path: tree.alphaTool });
    const withUsage = indexer.handlers.search({ query: "alpha", sort: "rank" }).results;
    assert.equal(withUsage[0].name, "alphatool.txt");
    assert.equal(withUsage[4].name, "plain.txt");
  }, tree);
});

test("an explicit sort replaces the relevance order", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    const byName = indexer.handlers.search({ query: "txt", sort: "name" }).results.map((row) => row.name);
    assert.ok(byName.length >= 4, `expected several matches, got ${byName.length}`);
    const sorted = [...byName].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(byName, sorted);
  }, tree);
});

// ---------------------------------------------------------------------------------------------
// Ignore patterns and excludes
// ---------------------------------------------------------------------------------------------

test("user ignore patterns apply after reindex: segments and basename globs", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    indexer.handlers.setSettings({ ignore: ["secret", "*.txt"] });
    await indexer.handlers.startIndexing();
    const names = search(indexer, "");
    assert.ok(!names.includes("secret.txt"));
    assert.ok(!names.includes("notes.txt"), "the basename glob *.txt excludes every text file");
  }, tree);
});

test("excludeFromIndex removes the row, persists the pattern and pushes settings", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer, notifications) => {
    indexer.handlers.excludeFromIndex({ path: tree.alphabet });
    const names = search(indexer, "");
    assert.ok(!names.includes("alphabet.txt"));
    assert.ok(indexer.handlers.getSettings().settings.ignore.includes(tree.alphabet));
    assert.ok(notifications.some((push) => push.method === "fileSearch.settingsUpdated"));
  }, tree);
});

test("an absolute-path ignore excludes exactly that subtree", () => {
  const compiled = compileIgnorePatterns(["C:\\data\\private"]);
  assert.equal(isIgnored("C:\\data\\private\\secret.txt", compiled, []), true);
  assert.equal(isIgnored("C:\\data\\private", compiled, []), true);
  assert.equal(isIgnored("C:\\data\\private-other\\file.txt", compiled, []), false);
});

test("the default exclude list is the confirmed one", () => {
  assert.deepEqual(WINDOWS_DEFAULT_EXCLUDES, [
    "*.tmp",
    "*.temp",
    "node_modules",
    "**/tmp/**",
    "**/temp/**",
    "**/[Cc]ache/**",
    "**/[Cc]aches/**",
    "**/AppData/**",
  ]);
});

// ---------------------------------------------------------------------------------------------
// Watcher (incremental updates)
// ---------------------------------------------------------------------------------------------

test("created files appear and deleted files disappear without a full reindex", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    const added = path.join(tree.root, "watched-new.txt");
    fs.writeFileSync(added, "fresh");
    await waitFor(() => search(indexer, "watched-new").includes("watched-new.txt"));
    fs.rmSync(added);
    await waitFor(() => !search(indexer, "watched-new").includes("watched-new.txt"));

    const addedDir = path.join(tree.root, "watched-dir");
    fs.mkdirSync(addedDir);
    fs.writeFileSync(path.join(addedDir, "deep.txt"), "deep");
    await waitFor(() => search(indexer, "deep").includes("deep.txt"));
    fs.rmSync(addedDir, { recursive: true });
    await waitFor(() => !search(indexer, "deep").includes("deep.txt"));
  }, tree);
});

function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch (error) {
        return reject(error);
      }
      if (Date.now() > deadline) return reject(new Error("condition not reached in time"));
      setTimeout(tick, 150);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------------------------
// Settings, metadata
// ---------------------------------------------------------------------------------------------

test("settings round-trip with validation, reset restores the home-dir scope", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    indexer.handlers.setSettings({ showInRootSearch: false, ignore: ["secret"] });
    const updated = indexer.handlers.getSettings().settings;
    assert.equal(updated.showInRootSearch, false);
    assert.deepEqual(updated.ignore, ["secret"]);
    assert.throws(() => indexer.handlers.setSettings({ showInRootSearch: "yes" }), /must be a boolean/);
    assert.throws(() => indexer.handlers.setSettings({ include: [42] }), /array of paths/);

    indexer.handlers.resetToDefaults();
    indexer.handlers.stopIndexing(); // the reset reindexes the home dir in the background
    const reset = indexer.handlers.getSettings().settings;
    assert.deepEqual(reset.include, [os.homedir()]);
    assert.deepEqual(reset.ignore, []);
    assert.equal(reset.includeHiddenFiles, false);
    assert.equal(reset.showInRootSearch, true);
  }, tree);
});

test("a first run without a settings file defaults the scope to the user profile", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-search-first-"));
  const indexer = createFileIndexer({ dataRoot: dataDir, autoStart: false });
  const settings = indexer.handlers.getSettings().settings;
  indexer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  assert.deepEqual(settings.include, [os.homedir()]);
  assert.equal(settings.showInRootSearch, true);
});

test("getMetadata returns the confirmed Metadata rows for a file", async () => {
  const tree = makeTree();
  await withIndexer(async (indexer) => {
    const meta = await indexer.handlers.getMetadata({ path: tree.photo });
    assert.equal(meta.name, "photo.png");
    assert.equal(meta.where, tree.root);
    assert.equal(meta.type, "Image");
    assert.equal(meta.size, 3);
    assert.ok(typeof meta.created === "number" && typeof meta.modified === "number" && typeof meta.accessed === "number");
    const folder = await indexer.handlers.getMetadata({ path: path.join(tree.root, "sub") });
    assert.equal(folder.type, "Folder");
  }, tree);
});

// ---------------------------------------------------------------------------------------------
// Backend wiring
// ---------------------------------------------------------------------------------------------

test("backend.js routes fileSearch.* methods through the registered handler table", async () => {
  const backend = createBackend({ pipeName: "smoke-test-pipe", apiRoot: ".", frontendRoot: ".", extensionsRoot: "." });
  backend.registerFileIndexerHandler({
    getState: () => ({ status: "ready", state: "idle", fileCount: 7 }),
  });
  const response = await backend.dispatchMessage("backend", "fileSearch.getState", {});
  assert.deepEqual(response, { status: "ready", state: "idle", fileCount: 7 });
});
