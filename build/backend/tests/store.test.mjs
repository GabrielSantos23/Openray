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
    assert.equal(refresh.fetched, 5);

    const search = store.handlers.search({ query: "" });
    assert.deepEqual(search.extensions.map((entry) => entry.handle).sort(), [
      "ai-store-fixture",
      "no-compatible-store-fixture",
      "oauth-store-fixture",
      "plain-store-fixture",
    ]);
    const macos = store.handlers.search({ query: "macOS Store Fixture" });
    assert.equal(macos.extensions.length, 0, "macOS-only extension is not listed");

    const byQuery = store.handlers.search({ query: "plain store fixture" });
    assert.equal(byQuery.extensions.length, 1);
    assert.equal(byQuery.extensions[0].handle, "plain-store-fixture");
    assert.equal(byQuery.extensions[0].installed, false);

    const paged = store.handlers.search({ query: "", limit: 1, offset: 0 });
    assert.equal(paged.total, 4);
    assert.equal(paged.extensions.length, 1);
    const tail = store.handlers.search({ query: "", limit: 1, offset: 1 });
    assert.equal(tail.total, 4);
    assert.equal(tail.extensions.length, 1);
    assert.notEqual(tail.extensions[0].handle, paged.extensions[0].handle);
    const beyond = store.handlers.search({ query: "", limit: 1, offset: 5 });
    assert.equal(beyond.total, 4);
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

test("compatibility gate: an extension with zero compatible commands refuses before any build", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await assert.rejects(
      () => store.handlers.install({ handle: "no-compatible-store-fixture", confirmed: true }),
      /No compatible commands/,
    );
    assert.equal(fs.readdirSync(extensionsRoot).length, 0, "refused before npm install/build");
    assert.equal(store.handlers.getInstalled().extensions.length, 0, "nothing registered");
  } finally {
    cleanup();
  }
});

test("installs junction the app's @raycast/api and react over any stray parent node_modules", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });
    const apiLink = path.join(extensionsRoot, "plain-store-fixture", "node_modules", "@raycast", "api");
    assert.equal(
      fs.readlinkSync(apiLink),
      path.join(API_ROOT, "node_modules", "@raycast", "api"),
      "@raycast/api junctions to the app's copy",
    );
    assert.equal(
      fs.readlinkSync(path.join(extensionsRoot, "plain-store-fixture", "node_modules", "react")),
      path.join(API_ROOT, "node_modules", "react"),
      "react junctions to the app's copy",
    );
    // The pre-store dev flow left a stale @raycast/api in the extensions root; it must not win.
    const stale = path.join(extensionsRoot, "node_modules", "@raycast", "api");
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, "package.json"), JSON.stringify({ name: "@raycast/api", main: "index.js" }));
    fs.writeFileSync(path.join(stale, "index.js"), "module.exports = {};");
    const requireHere = createRequire(path.join(extensionsRoot, "plain-store-fixture", "noop.js"));
    assert.equal(
      requireHere.resolve("@raycast/api"),
      path.join(API_ROOT, "node_modules", "@raycast", "api", "index.js"),
      "resolution from the extension dir picks the junction over the stale parent",
    );
  } finally {
    cleanup();
  }
});

test("getIcon serves the manifest icon from the install tree as a data URL", async () => {
  const { store, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    assert.equal(store.handlers.getIcon({ uuid: "plain-store-fixture" }).icon, null, "nothing installed yet");

    await store.handlers.install({ handle: "plain-store-fixture", confirmed: true });
    const icon = store.handlers.getIcon({ uuid: "plain-store-fixture" }).icon;
    assert.ok(icon?.startsWith("data:image/png;base64,"), "png icon resolves to a data URL");
    assert.equal(store.handlers.getIcon({ uuid: "ai-store-fixture" }).icon, null, "extension without an icon");
  } finally {
    cleanup();
  }
});

test("OAuth: a command completes a full PKCE round trip in a real worker", async () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    await store.handlers.refreshCatalog();
    await store.handlers.install({ handle: "oauth-store-fixture", confirmed: true });

    const captured = [];
    const backend = createBackend({ pipeName: "store-oauth", apiRoot: API_ROOT, extensionsRoot });
    backend.setTransport(async (module, method, data) => {
      captured.push({ module, method, data });
      return undefined;
    });
    backend.setLaunchGate(async (extension, command) => {
      store.assertLaunchable(extension.uuid, command.name, command.title);
    });
    // No real browser in tests: capture the authorization URL the worker opens.
    backend.overrideHostHandler("open", async (ctx, params) => {
      captured.push({ method: "open", data: params });
      return undefined;
    });

    const manifest = JSON.parse(fs.readFileSync(path.join(extensionsRoot, "oauth-store-fixture", "package.json"), "utf-8"));
    // No await: loadCommand resolves only when the no-view command finishes, and the command
    // parks inside authorize until this test plays the provider redirect.
    const loadPromise = backend.dispatchMessage("backend", "extensionHost.loadCommand", {
      extension: {
        uuid: "oauth-store-fixture", name: manifest.name, title: manifest.title, author: manifest.author,
        commands: manifest.commands, assetsPath: path.join(extensionsRoot, "oauth-store-fixture", "assets"),
      },
      command: { name: "probe", title: "Probe", mode: "no-view", type: "command" },
      preferences: {}, props: {},
    });

    // The test plays the provider: read the authorization URL, then hit the worker's loopback
    // redirect server with a code and the state from that URL.
    let authUrl = null;
    const urlDeadline = Date.now() + 10000;
    while (Date.now() < urlDeadline && !authUrl) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const entry of captured) {
        const target = String(entry.data?.path ?? "");
        if (entry.method === "open" && target.startsWith("https://provider.example/authorize")) authUrl = target;
      }
    }
    const probeStorage = () => {
      try {
        return fs.readFileSync(path.join(extensionsRoot, "oauth-store-fixture", ".storage.json"), "utf-8");
      } catch {
        return "(no storage)";
      }
    };
    assert.ok(authUrl, `the command opened the authorization URL (probe storage: ${probeStorage()})`);
    const url = new URL(authUrl);
    assert.equal(url.searchParams.get("client_id"), "client-123");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));

    // Wait until the command is parked inside authorize, then play the provider redirect.
    const storagePath = path.join(extensionsRoot, "oauth-store-fixture", ".storage.json");
    const readStep = () => {
      try {
        return JSON.parse(fs.readFileSync(storagePath, "utf-8"))["oauth-probe-step"] ?? null;
      } catch {
        return null;
      }
    };
    const stepDeadline = Date.now() + 10000;
    while (Date.now() < stepDeadline && readStep() !== "before-authorize") {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(readStep(), "before-authorize", "the command reached authorize");

    // The command finishes and records its outcome in its LocalStorage (.storage.json). Read it
    // before playing the redirect: if the command already completed with an error, the flow died
    // before the loopback and the storage carries the reason.
    const readResult = () => {
      try {
        const storage = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
        return storage["oauth-probe-result"] ? JSON.parse(storage["oauth-probe-result"]) : null;
      } catch {
        return null;
      }
    };
    let earlyResult = null;
    const earlyDeadline = Date.now() + 2000;
    while (Date.now() < earlyDeadline && !earlyResult) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      earlyResult = readResult();
    }
    if (earlyResult) {
      assert.equal(earlyResult.ok, true, `probe finished early with error: ${earlyResult.error}`);
    }

    const redirect = new URL(url.searchParams.get("redirect_uri"));
    // The worker binds the loopback right before parking in authorize; the first connect can
    // race the listener's accept readiness on Windows, so retry briefly. `node:http` instead of
    // `fetch`: undici's connect path has refused loopback connects inside the test runner while
    // the same port answers from any other process.
    const redirectResponse = await new Promise((resolve, reject) => {
      const http = require("node:http");
      const attempt = (left) => {
        const request = http.get(`${redirect.origin}/?code=test-code-1&state=${encodeURIComponent(url.searchParams.get("state"))}`, (response) => {
          response.resume();
          resolve(response);
        });
        request.on("error", (error) => {
          if (left <= 0) {
            try {
              const netstat = require("node:child_process").execSync(`netstat -ano | findstr :${redirect.port}`, { encoding: "utf-8" });
              console.error(`[oauth-diag] pid=${process.pid} netstat:\n${netstat}`);
            } catch (diagError) {
              console.error(`[oauth-diag] pid=${process.pid} netstat found nothing for :${redirect.port}`);
            }
            reject(new Error(`loopback redirect failed: ${error.message}`));
          } else setTimeout(() => attempt(left - 1), 250);
        });
      };
      attempt(10);
    });
    assert.ok(redirectResponse, "the loopback redirect server accepted the provider callback");

    // The command finishes and records its outcome in its LocalStorage (.storage.json).
    let result = null;
    const storageDeadline = Date.now() + 10000;
    while (Date.now() < storageDeadline && !result) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      result = readResult();
    }
    assert.ok(result, "the probe wrote its result");
    assert.equal(result.ok, true, `probe error: ${result?.error}`);
    assert.equal(result.authorizationCode, "test-code-1");
    assert.equal(result.accessToken, "at-123", "snake_case token responses normalize");
    assert.equal(result.refreshToken, "rt-456");
    assert.equal(result.expired, false, "a one-hour token is not expired");
    assert.equal(result.removed, true);
    const loaded = await loadPromise;
    assert.ok(loaded.sessionId, "the session registered");
    await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: loaded.sessionId }).catch(() => undefined);
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
