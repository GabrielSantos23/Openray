// The @raycast/api shim surface (docs/store-implementation-plan.md M3):
//
//  * `environment.canAccess` routes AI / betterAI models / BrowserExtension / WindowManagement to
//    the worker flags (all false in the clone) and answers true otherwise;
//  * every out-of-scope call throws the typed `UnsupportedApiError` (never a fake result, never
//    any external call) and the failure reaches the host as a `commandException` notify;
//  * `Cache`, `trash`, `showInFinder`, `getPreferenceValues`, `launchContext` behave as documented.
//
// The probe fixtures run in real workers against the built API bundle; the bundle is rebuilt from
// src first so the suite always tests the current source.

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
const FIXTURES = path.join(here, "fixtures", "store");
const { execFileSync } = require("node:child_process");

// Rebuild the bundle so these tests exercise the current src (cheap, ~50 ms).
execFileSync(process.execPath, [path.join(API_ROOT, "build.mjs")], { stdio: "pipe" });
const api = require(path.join(API_ROOT, "node_modules", "@raycast", "api", "index.js"));
const { createBackend } = require("../src/backend.js");

const FIXTURE_EXTENSIONS = ["@raycast/api", "react", "react/jsx-runtime", "react-reconciler", "react-dom"];

function stageFixture(root, fixtureName, uuid) {
  const extensionDir = path.join(root, uuid);
  fs.mkdirSync(path.join(extensionDir, "src"), { recursive: true });
  fs.cpSync(path.join(FIXTURES, fixtureName), extensionDir, { recursive: true });
  // Bundle with the same pipeline the store uses.
  const esbuild = require(path.join(API_ROOT, "node_modules", "esbuild", "lib", "main.js"));
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf-8"));
  for (const command of manifest.commands) {
    esbuild.buildSync({
      entryPoints: [path.join(extensionDir, "src", `${command.name}.tsx`)],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: path.join(extensionDir, `${command.name}.js`),
      external: FIXTURE_EXTENSIONS,
      jsx: "automatic",
      logLevel: "silent",
    });
  }
  return { extensionDir, manifest };
}

function loadCommand(backend, root, uuid, manifest, { preferences = {}, props = {} } = {}) {
  const extension = {
    uuid,
    name: manifest.name,
    title: manifest.title,
    author: manifest.author,
    icon: manifest.icon,
    commands: manifest.commands,
    assetsPath: path.join(root, uuid, "assets"),
  };
  return backend.dispatchMessage("backend", "extensionHost.loadCommand", {
    extension,
    command: { ...manifest.commands[0], type: "command" },
    preferences,
    props,
  });
}

async function collectRenders(backend, rendered, run) {
  await run();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const renders = rendered.filter((entry) => entry.method === "extensionHost.render");
    if (renders.length > 0) {
      const last = renders[renders.length - 1].data;
      const text = last.gzipped
        ? require("node:zlib").gunzipSync(Buffer.from(last.renderTree, "base64")).toString()
        : last.renderTree;
      const model = JSON.parse(text).model ?? JSON.parse(text);
      const body = model.navigationStack?.body ?? model;
      if ((body.items ?? []).length > 0) return body;
    }
  }
  throw new Error("no rendered items within 8s");
}

test("canAccess routes AI / betterAI / BrowserExtension / WindowManagement to false, others true", () => {
  assert.equal(api.environment.canAccess(api.AI), false);
  assert.equal(api.environment.canAccess("openai-gpt-5.5"), false);
  assert.equal(api.environment.canAccess("openai-gpt-4"), false);
  assert.equal(api.environment.canAccess(api.BrowserExtension), false);
  assert.equal(api.environment.canAccess("browserExtensionGetTabs"), false);
  assert.equal(api.environment.canAccess(api.WindowManagement), false);
  assert.equal(api.environment.canAccess("whatever"), true);
  assert.equal(api.environment.canAccess({}), true);
});

test("out-of-scope calls throw UnsupportedApiError in the main thread too", async () => {
  await assert.rejects(() => api.AI.ask("hello"), (error) => {
    assert.equal(error.name, "UnsupportedApiError");
    assert.match(error.message, /AI\.ask is not supported/);
    return true;
  });
  await assert.rejects(() => api.getSelectedText(), { name: "UnsupportedApiError" });
  await assert.rejects(() => api.getFrontmostApplication(), { name: "UnsupportedApiError" });
  await assert.rejects(() => api.getDefaultApplication("C:/x"), { name: "UnsupportedApiError" });
  await assert.rejects(() => api.WindowManagement.getDesktops(), { name: "UnsupportedApiError" });
  await assert.rejects(() => api.WindowManagement.setWindowBounds({ id: "1" }), { name: "UnsupportedApiError" });
  await assert.rejects(() => api.BrowserExtension.getTabs(), { name: "UnsupportedApiError" });
  // Hooks throw synchronously, like every React hook misuse.
  assert.throws(() => api.useUnstableAI(), { name: "UnsupportedApiError" });
  assert.throws(() => api.useAI(), { name: "UnsupportedApiError" });
  // The real PKCEClient only supports the loopback "web" redirect method; anything else (or no
  // options at all) is a typed unsupported error.
  assert.throws(() => new api.OAuth.PKCEClient(), { name: "UnsupportedApiError" });
  assert.equal(typeof api.UnsupportedApiError, "function");
});

test("Cache stores, refreshes recency, evicts by capacity", () => {
  const cache = new api.Cache({ capacity: 100 });
  assert.equal(cache.isEmpty, true);
  cache.set("a", "x".repeat(60));
  cache.set("b", "y".repeat(60));
  assert.equal(cache.get("a"), undefined, "a evicted, least recently used");
  assert.equal(cache.get("b"), "y".repeat(60));
  cache.set("c", "z");
  assert.equal(cache.contains("c"), true);
  assert.equal(cache.remove("c"), true);
  assert.equal(cache.contains("c"), false);
  cache.clear();
  assert.equal(cache.isEmpty, true);
});

test("worker probe: canAccess, Cache, preferences, launchContext and typed throws end to end", () =>
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-shim-probe-"));
    try {
      const { manifest } = stageFixture(root, "shim-probe", "uuid-probe");
      const rendered = [];
      const notified = [];
      const backend = createBackend({ pipeName: "api-shim-test", apiRoot: API_ROOT, extensionsRoot: root });
      backend.setTransport(async (module, method, data) => {
        rendered.push({ module, method, data });
        return undefined;
      });
      const session = await loadCommand(backend, root, "uuid-probe", manifest, {
        preferences: { token: { value: "abc123", default: "fallback" }, plain: "yes" },
        props: { launchContext: "ctx-42" },
      });
      try {
        assert.ok(session.sessionId);

        const body = await collectRenders(backend, rendered, async () => undefined);
        const byName = Object.fromEntries((body.items ?? []).map((item) => [item.title, item.subtitle]));
        assert.equal(byName["canAccess-AI"], "false");
        assert.equal(byName["canAccess-model"], "false");
        assert.equal(byName["canAccess-other"], "true");
        assert.equal(byName["cache-get"], "hit");
        assert.equal(byName["cache-contains"], "true");
        assert.equal(byName["prefs"], "abc123|yes");
        assert.equal(byName["launchContext"], "ctx-42");
        assert.equal(byName["AI.ask"], "UnsupportedApiError");
        assert.equal(byName["getSelectedText"], "UnsupportedApiError");
        assert.equal(byName["WindowManagement"], "UnsupportedApiError");
        assert.equal(byName["BrowserExtension"], "UnsupportedApiError");
        assert.equal(byName["OAuth"], "UnsupportedApiError");
        assert.equal(byName["useUnstableAI"], "UnsupportedApiError");
        assert.equal(byName["error-class"], "true");
      } finally {
        await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  })());

test("worker probe: trash and showInFinder reach the host as native calls, with commandException toasts for throws", () =>
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-shim-trash-"));
    try {
      const { manifest } = stageFixture(root, "shim-trash", "uuid-trash");
      const rendered = [];
      const backend = createBackend({ pipeName: "api-shim-test2", apiRoot: API_ROOT, extensionsRoot: root });
      backend.setTransport(async (module, method, data) => {
        rendered.push({ module, method, data });
        return undefined;
      });
      const session = await loadCommand(backend, root, "uuid-trash", manifest);
      try {
        assert.ok(session.sessionId);
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (rendered.some((entry) => entry.method === "extensionHost.showToast")) break;
        }
        const methods = rendered.map((entry) => entry.method);
        assert.ok(methods.includes("fileSystem.moveToTrash"), "trash reached the native route");
        assert.ok(methods.includes("shell.revealFile"), "showInFinder reached the native route");
        const trashCall = rendered.find((entry) => entry.method === "fileSystem.moveToTrash");
        assert.equal(trashCall.data.path, "C:/nonexistent-for-probe.bin");
      } finally {
        await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  })());
