// The Store module end to end, headless (docs/store-implementation-plan.md M4): catalog
// (through the local-catalog test seam — the network path is exercised by the M5 harness),
// search/categories/detail, the install gate, install with staging/backup/rollback,
// classification after install, update, and uninstall.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const buildRoot = path.resolve(here, "..", "..");
const API_ROOT = path.join(buildRoot, "api");
const FIXTURES = path.join(here, "fixtures", "catalog");
const { createStore } = require("../src/store.js");
const { createBackend } = require("../src/backend.js");

function makeStore() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "store-e2e-data-"));
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "store-e2e-ext-"));
  const store = createStore({
    dataRoot,
    extensionsRoot,
    apiRoot: API_ROOT,
    localCatalogRoot: FIXTURES,
    pushToFrontend: async () => undefined,
  });
  return {
    store,
    extensionsRoot,
    cleanup() {
      store.close();
      fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      fs.rmSync(extensionsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

test("catalog refresh indexes the pinned sources; search lists Windows extensions only", async () => {
  const { store, cleanup } = makeStore();
  try {
    const refresh = await store.handlers.refreshCatalog();
    assert.equal(refresh.commit, "local-pinned-commit");
    assert.equal(refresh.fetched, 3);

    const search = store.handlers.search({ query: "" });
    assert.deepEqual(search.extensions.map((entry) => entry.handle).sort(), ["ai-store-fixture", "plain-store-fixture"]);
    const macos = store.handlers.search({ query: "macOS Store Fixture" });
    assert.equal(macos.extensions.length, 0, "macOS-only extension is not listed");

    const byQuery = store.handlers.search({ query: "plain store fixture" });
    assert.equal(byQuery.extensions.length, 1);
    assert.equal(byQuery.extensions[0].handle, "plain-store-fixture");
    assert.equal(byQuery.extensions[0].installed, false);

    const paged = store.handlers.search({ query: "", limit: 1, offset: 0 });
    assert.equal(paged.total, 2);
    assert.equal(paged.extensions.length, 1);
    const tail = store.handlers.search({ query: "", limit: 1, offset: 1 });
    assert.equal(tail.total, 2);
    assert.equal(tail.extensions.length, 1);
    assert.notEqual(tail.extensions[0].handle, paged.extensions[0].handle);
    const beyond = store.handlers.search({ query: "", limit: 1, offset: 5 });
    assert.equal(beyond.total, 2);
    assert.equal(beyond.extensions.length, 0);

    const categories = store.handlers.categories();
    assert.ok(categories.categories.some((entry) => entry.name === "Developer Tools"));
    assert.ok(categories.categories.some((entry) => entry.name === "Productivity"));
  } finally {
    cleanup();
  }
});

test("detail shows README, contributors, commands with manifest-level status", async () => {
  const { store, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    const detail = await store.handlers.detail({ handle: "plain-store-fixture" });
    assert.equal(detail.manifest.author, "fixture-author");
    assert.deepEqual(detail.manifest.contributors, ["co-fixture"]);
    assert.equal(detail.readme, null);
    assert.equal(detail.commands[0].name, "go");
    assert.equal(detail.commands[0].class, "compatible");
    assert.equal(detail.installed, null);

    const aiDetail = await store.handlers.detail({ handle: "ai-store-fixture" });
    assert.equal(aiDetail.commands.find((command) => command.name === "plain").class, "compatible");
  } finally {
    cleanup();
  }
});

test("install gate: no confirmation, no install; macOS-only refuses before any source is copied", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await assert.rejects(() => store.handlers.install({ handle: "plain-store-fixture" }), /confirmation required/);
    assert.equal(fs.readdirSync(extensionsRoot).length, 0, "nothing downloaded without confirmation");

    await assert.rejects(
      () => store.handlers.install({ handle: "macos-store-fixture", confirmed: true }),
      /is not available on Windows/,
    );
    assert.equal(fs.readdirSync(extensionsRoot).length, 0, "refused before any download");
  } finally {
    cleanup();
  }
});

test("install builds a runnable tree, classifies it, registers it, and refreshes summaries", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    const result = await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });
    assert.equal(result.handle, "plain-store-fixture");
    assert.equal(result.classification.installable, true);
    assert.equal(result.classification.badge, null);

    const target = path.join(extensionsRoot, "plain-store-fixture");
    assert.ok(fs.existsSync(path.join(target, "go.js")), "flat bundle at install root");
    assert.ok(fs.existsSync(path.join(target, "package.json")));
    assert.ok(!fs.existsSync(path.join(target, "tools")), "no tools directory (policy D6)");
    assert.equal(fs.readdirSync(extensionsRoot).filter((name) => name.startsWith(".")).length, 0, "staging/backup cleaned up");

    const installed = store.handlers.getInstalled().extensions;
    assert.equal(installed.length, 1);
    assert.equal(installed[0].commit_sha, "local-pinned-commit");

    const classification = store.getCommandClassification("plain-store-fixture", "go");
    assert.equal(classification.class, "compatible");
    assert.doesNotThrow(() => store.assertLaunchable("plain-store-fixture", "go", "Go Fixture"));

    const partial = await store.handlers.install({ handle: "ai-store-fixture", confirmed: true });
    assert.equal(partial.classification.badge, "some features unavailable");
    assert.equal(store.getCommandClassification("ai-store-fixture", "smartz").class, "disabled-api");
    assert.throws(() => store.assertLaunchable("ai-store-fixture", "smartz", "Smart"), /disabled/);
  } finally {
    cleanup();
  }
});

test("installed extension loads in a worker through the normal launch path", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });

    const rendered = [];
    const backend = createBackend({ pipeName: "store-e2e", apiRoot: API_ROOT, extensionsRoot });
    backend.setTransport(async (module, method, data) => {
      rendered.push({ module, method, data });
      return undefined;
    });
    backend.setLaunchGate(async (extension, command) => {
      store.assertLaunchable(extension.uuid, command.name, command.title);
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionsRoot, "plain-store-fixture", "package.json"), "utf-8"));
    const response = await backend.dispatchMessage("backend", "extensionHost.loadCommand", {
      extension: {
        uuid: "plain-store-fixture", name: manifest.name, title: manifest.title, author: manifest.author,
        commands: manifest.commands, assetsPath: path.join(extensionsRoot, "plain-store-fixture", "assets"),
      },
      command: { name: "go", title: "Go Fixture", mode: "view", type: "command" },
      preferences: {}, props: {},
    });
    assert.ok(response.sessionId);
    const deadline = Date.now() + 8000;
    let sawLoaded = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const entry of rendered.filter((candidate) => candidate.method === "extensionHost.render")) {
        const data = entry.data;
        const text = data.gzipped
          ? require("node:zlib").gunzipSync(Buffer.from(data.renderTree, "base64")).toString()
          : data.renderTree;
        if (JSON.stringify(text).includes("after-effect")) sawLoaded = true;
      }
      if (sawLoaded) break;
    }
    assert.ok(sawLoaded, "the effect-driven second render arrived (setState re-render works)");
    await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: response.sessionId }).catch(() => undefined);
  } finally {
    cleanup();
  }
});

test("update reinstalls over the previous version with the commit recorded; checkForUpdates detects changes", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });
    const first = store.handlers.getInstalled().extensions[0];
    assert.equal(first.updated_at, 1728000000);

    // The "catalog" moves: bump the fixture's updated_at and re-index.
    const manifestPath = path.join(FIXTURES, "extensions", "plain-store-fixture", "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.updated_at = 1728100000;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    try {
      await store.handlers.refreshCatalog();
      const updates = await store.handlers.checkForUpdates();
      assert.deepEqual(updates.updates.map((update) => update.handle), ["plain-store-fixture"]);

      const result = await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });
      assert.equal(result.handle, "plain-store-fixture");
      const second = store.handlers.getInstalled().extensions[0];
      assert.equal(second.updated_at, 1728100000);
      assert.equal(fs.readdirSync(extensionsRoot).filter((name) => name.startsWith(".")).length, 0, "backup cleaned up");
    } finally {
      manifest.updated_at = 1728000000;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  } finally {
    cleanup();
  }
});

test("uninstall removes the tree, registry rows, classifications, preferences and storage", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });
    store.setCommandPreferences("plain-store-fixture", "go", { token: "abc" });
    assert.ok(fs.existsSync(path.join(extensionsRoot, "plain-store-fixture", "go.js")));

    await store.handlers.uninstall({ handle: "plain-store-fixture" });
    assert.ok(!fs.existsSync(path.join(extensionsRoot, "plain-store-fixture")), "install tree removed");
    assert.equal(store.handlers.getInstalled().extensions.length, 0);
    assert.equal(store.getCommandClassification("plain-store-fixture", "go"), null);
    assert.deepEqual(store.getCommandPreferences("plain-store-fixture", "go"), {});
    assert.equal(store.getCommandClassification("plain-store-fixture", "go"), null);
  } finally {
    cleanup();
  }
});
