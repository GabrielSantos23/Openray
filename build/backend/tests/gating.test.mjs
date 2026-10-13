// Gating (docs/store-implementation-plan.md M4 acceptance): disabled commands are refused at
// launch and surface their reason in the summaries; a crashed/throwing command surfaces the
// failure as a `commandException` toast naming the extension and tears the session down.

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
const { buildExtension } = require("../src/store-bundler.js");

function makeWorld() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gating-data-"));
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gating-ext-"));
  const store = createStore({
    dataRoot,
    extensionsRoot,
    apiRoot: API_ROOT,
    localCatalogRoot: FIXTURES,
    pushToFrontend: async () => undefined,
  });
  const rendered = [];
  const backend = createBackend({ pipeName: "gating", apiRoot: API_ROOT, extensionsRoot });
  backend.setTransport(async (module, method, data) => {
    rendered.push({ module, method, data });
    return undefined;
  });
  backend.registerStoreHandler(store.handlers);
  backend.setLaunchGate(async (extension, command) => {
    store.assertLaunchable(extension.uuid, command.name, command.title);
  });
  return {
    store,
    backend,
    rendered,
    extensionsRoot,
    async install(handle) {
      await store.handlers.refreshCatalog();
      return store.handlers.install({ handle, confirmed: true });
    },
    cleanup() {
      store.close();
      fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      fs.rmSync(extensionsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

test("summaries carry the badge and per-command disabled reasons", async () => {
  const world = makeWorld();
  try {
    await world.install("ai-store-fixture");
    const payload = await world.backend.dispatchMessage("backend", "extensionHost.getInstalledNodeExtensionSummaries", {});
    const extension = payload.extensions.find((entry) => entry.uuid === "ai-store-fixture");
    assert.ok(extension, "installed extension present");
    assert.equal(extension.badge, "some features unavailable");
    const smartz = extension.commands.find((command) => command.name === "smartz");
    const plain = extension.commands.find((command) => command.name === "plain");
    assert.equal(smartz.disabledReason, "Requires Raycast AI, not supported");
    assert.equal(plain.disabledReason, null);
  } finally {
    world.cleanup();
  }
});

test("the launch gate refuses disabled commands with the reason", async () => {
  const world = makeWorld();
  try {
    await world.install("ai-store-fixture");
    const manifest = JSON.parse(fs.readFileSync(path.join(world.extensionsRoot, "ai-store-fixture", "package.json"), "utf-8"));
    await assert.rejects(
      () =>
        world.backend.dispatchMessage("backend", "extensionHost.loadCommand", {
          extension: { uuid: "ai-store-fixture", name: manifest.name, title: manifest.title, author: manifest.author, commands: manifest.commands },
          command: { name: "smartz", title: "Smart", mode: "no-view", type: "command" },
          preferences: {},
          props: {},
        }),
      (error) => {
        assert.match(error.message, /disabled: Requires Raycast AI, not supported/);
        return true;
      },
    );
  } finally {
    world.cleanup();
  }
});

test("a crashing command surfaces commandException with the extension name and frees the session", async () => {
  const world = makeWorld();
  try {
    await world.install("plain-store-fixture");
    // Sabotage: a command bundle that throws during render. The install tree is ours (test-owned).
    fs.writeFileSync(
      path.join(world.extensionsRoot, "plain-store-fixture", "go.js"),
      "module.exports.default = function boom() { renderNothing(); };",
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(world.extensionsRoot, "plain-store-fixture", "package.json"), "utf-8"));
    // The launch fails (initialize rejects — no hung loader) and the crash surfaces as a
    // commandException toast naming the extension.
    await assert.rejects(
      () =>
        world.backend.dispatchMessage("backend", "extensionHost.loadCommand", {
          extension: {
            uuid: "plain-store-fixture", name: manifest.name, title: manifest.title, author: manifest.author,
            commands: manifest.commands, assetsPath: path.join(world.extensionsRoot, "plain-store-fixture", "assets"),
          },
          command: { name: "go", title: "Go Fixture", mode: "view", type: "command" },
          preferences: {}, props: {},
        }),
      /worker crashed: renderNothing/,
    );
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (world.rendered.some((entry) => entry.method === "extensionHost.commandException")) break;
    }
    const exception = world.rendered.find((entry) => entry.method === "extensionHost.commandException");
    assert.ok(exception, "commandException reached the renderer");
    assert.equal(exception.data.title, "plain-store-fixture");
    assert.match(String(exception.data.message), /renderNothing/);
  } finally {
    world.cleanup();
  }
});
