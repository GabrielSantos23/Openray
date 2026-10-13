// The Store build pipeline (docs/store-implementation-plan.md M1):
//
//  1. `copySourceTree` + `installDependencies` + `buildExtension` produce a runnable install tree
//     from a fixture TS/JSX extension that has a real npm dependency (`file:` dependency so the
//     suite stays offline).
//  2. The built command executes in a real worker thread against the built `@raycast/api` bundle —
//     the same worker entry the host uses — and its rendered model reaches the (captured) transport.

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
const { copySourceTree, buildExtension } = require("../src/store-bundler.js");
const { createBackend } = require("../src/backend.js");

const FIXTURES = path.join(here, "fixtures", "store");

/**
 * Stage a fixture into an extensions root. The fixture's `file:../fixture-helper` dependency must
 * be staged at the same relative spot next to the copied extension, or npm install in the temp
 * root would resolve nothing.
 */
function stageExtension(root, fixtureName, uuid) {
  const extensionDir = path.join(root, uuid);
  copySourceTree(path.join(FIXTURES, fixtureName), extensionDir);
  const helperSource = path.join(FIXTURES, "fixture-helper");
  const helperTarget = path.join(root, "fixture-helper");
  fs.mkdirSync(helperTarget, { recursive: true });
  for (const entry of fs.readdirSync(helperSource)) {
    fs.copyFileSync(path.join(helperSource, entry), path.join(helperTarget, entry));
  }
  return extensionDir;
}

function withExtensionsRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-bundler-ext-"));
  const finish = () => {
    // npm/esbuild on Windows keep handles alive briefly; retry so a late lock can't mask a
    // genuine test failure.
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (cleanupError) {
      console.error(`[store-bundler.test] cleanup failed for ${root}:`, cleanupError);
    }
  };
  let result;
  try {
    result = run(root);
  } finally {
    if (result && typeof result.finally === "function") {
      return result.finally(finish);
    }
    finish();
  }
}

/** Build the @raycast/api bundle if no earlier build step has (build.ps1 owns it normally). */
function ensureApiBundle() {
  const bundle = path.join(API_ROOT, "node_modules", "@raycast", "api", "index.js");
  if (fs.existsSync(bundle)) return;
  const { execFileSync } = require("node:child_process");
  execFileSync(process.execPath, [path.join(API_ROOT, "build.mjs")], { stdio: "pipe" });
}

test("copySourceTree skips node_modules and dist", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "store-bundler-src-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "store-bundler-dst-"));
  try {
    fs.mkdirSync(path.join(source, "node_modules", "dep"), { recursive: true });
    fs.mkdirSync(path.join(source, "dist"), { recursive: true });
    fs.mkdirSync(path.join(source, "src"), { recursive: true });
    fs.writeFileSync(path.join(source, "src", "index.tsx"), "export default 1;\n");
    fs.writeFileSync(path.join(source, "node_modules", "dep", "x.js"), "x");
    fs.writeFileSync(path.join(source, "dist", "index.js"), "x");
    copySourceTree(source, target);
    assert.ok(fs.existsSync(path.join(target, "src", "index.tsx")));
    assert.ok(!fs.existsSync(path.join(target, "node_modules")));
    assert.ok(!fs.existsSync(path.join(target, "dist")));
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("buildExtension bundles a TSX command with a file: npm dependency into a runnable tree", () =>
  withExtensionsRoot(async (root) => {
    ensureApiBundle();
    const extensionDir = stageExtension(root, "plain-extension", "fixture-uuid-1");
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf-8"));
    const progress = [];
    const result = await buildExtension({
      apiRoot: API_ROOT,
      targetDir: extensionDir,
      manifest,
      onProgress: (step) => progress.push(step),
    });

    assert.deepEqual(result.unresolved, []);
    assert.ok(result.commandOutFiles.search, "search command bundle produced");
    const steps = progress.map((entry) => entry.step);
    assert.ok(steps.includes("dependencies"), "npm install ran");
    assert.ok(steps.includes("bundle"), "bundle step ran");
    assert.ok(fs.existsSync(path.join(extensionDir, "search.js")), "flat bundle at install root");
    assert.ok(fs.existsSync(path.join(extensionDir, "search.js.map")), "sourcemap alongside bundle");
    assert.ok(fs.existsSync(path.join(extensionDir, "node_modules", "fixture-helper")), "dependency installed");
    assert.ok(!fs.existsSync(path.join(extensionDir, "tools")), "no tools directory (policy D6)");

    const bundleText = fs.readFileSync(path.join(extensionDir, "search.js"), "utf-8");
    assert.ok(bundleText.includes('require("@raycast/api")'), "api stays external");
    assert.ok(bundleText.includes("hello from dependency"), "dependency is inlined");
  }));

test("buildExtension reports unresolvable entry points instead of skipping them", () =>
  withExtensionsRoot(async (root) => {
    ensureApiBundle();
    const extensionDir = path.join(root, "fixture-uuid-2");
    fs.mkdirSync(extensionDir, { recursive: true });
    const manifest = {
      name: "store-missing-entry-fixture",
      commands: [{ name: "ghost", title: "Ghost", mode: "view" }],
    };
    fs.writeFileSync(path.join(extensionDir, "package.json"), JSON.stringify(manifest));
    const result = await buildExtension({ apiRoot: API_ROOT, targetDir: extensionDir, manifest });
    assert.deepEqual(result.unresolved, ["ghost"]);
    assert.equal(result.commandOutFiles.ghost, undefined);
  }));

test("built bundle executes in a worker against the api bundle and renders through the host", () =>
  withExtensionsRoot(async (root) => {
    ensureApiBundle();
    const extensionDir = stageExtension(root, "plain-extension", "fixture-uuid-3");
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf-8"));
    await buildExtension({ apiRoot: API_ROOT, targetDir: extensionDir, manifest });

    const rendered = [];
    const backend = createBackend({
      pipeName: "store-bundler-test",
      apiRoot: API_ROOT,
      extensionsRoot: root,
    });
    backend.setTransport(async (module, method, data) => {
      rendered.push({ module, method, data });
      return undefined;
    });

    const extension = {
      uuid: "fixture-uuid-3",
      name: manifest.name,
      title: manifest.title,
      author: manifest.author,
      icon: manifest.icon,
      commands: manifest.commands,
      assetsPath: path.join(extensionDir, "assets"),
    };
    const response = await backend.dispatchMessage("backend", "extensionHost.loadCommand", {
      extension,
      command: { name: "search", title: "Fixture Search", mode: "view", type: "command" },
      preferences: {},
      props: {},
    });
    assert.ok(response.sessionId, "session created");

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", {
      sessionId: response.sessionId,
    });

    const render = rendered.find((entry) => entry.method === "extensionHost.render");
    assert.ok(render, "extension rendered");
    const payload = render.data;
    const text = payload.gzipped
      ? require("node:zlib").gunzipSync(Buffer.from(payload.renderTree, "base64")).toString()
      : payload.renderTree;
    const model = JSON.parse(text).model ?? JSON.parse(text);
    const body = model.navigationStack?.body ?? model;
    assert.equal(body.kind, "List");
    const titles = (body.items ?? []).map((item) => item.title);
    assert.deepEqual(titles, ["First row", "Second row"]);
    assert.ok(
      JSON.stringify(body).includes("hello from dependency"),
      "dependency code actually executed",
    );
  }));
