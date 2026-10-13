// The compatibility classifier (docs/store-implementation-plan.md M2): the five policy fixtures,
// coverage-version recomputation, and persistence in store.sqlite.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const buildRoot = path.resolve(here, "..", "..");
const FIXTURES = path.join(here, "fixtures", "classifier");
const { COVERAGE_VERSION, classifyCommand, classifyExtension } = require("../src/classifier.js");
const { createStore } = require("../src/store.js");

function readFixture(name) {
  const dir = path.join(FIXTURES, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
  const commands = (manifest.commands ?? []).map((command) => {
    let entrySource = null;
    for (const extension of [".tsx", ".ts", ".jsx", ".js"]) {
      try {
        entrySource = fs.readFileSync(path.join(dir, "src", `${command.name}${extension}`), "utf-8");
        break;
      } catch {
        /* try next */
      }
    }
    return { command, entrySource, bundleSource: null };
  });
  return { manifest, commands };
}

test("policy fixture 1: tools-only-AI — tools ignored, plain command compatible", () => {
  const { manifest, commands } = readFixture("tools-only-ai");
  const classification = classifyExtension({ manifest, commands });
  assert.equal(classification.installable, true);
  assert.equal(classification.badge, null);
  assert.equal(classification.commands.plain.class, "compatible");
  assert.ok(!("ai-tool" in classification.commands), "tools never classified (policy D6)");
});

test("policy fixture 2: AI.ask direct — disabled with the AI reason", () => {
  const { manifest, commands } = readFixture("ai-direct");
  const classification = classifyExtension({ manifest, commands });
  assert.equal(classification.installable, false);
  assert.equal(classification.badge, "requires unsupported APIs");
  const ask = classification.commands.ask;
  assert.equal(ask.class, "disabled-api");
  assert.deepEqual(ask.missingApis, ["AI.ask"]);
  assert.equal(ask.reason, "Requires Raycast AI, not supported");
});

test("policy fixture 3: optional AI behind canAccess — stays enabled with the guard recorded", () => {
  const { manifest, commands } = readFixture("ai-optional");
  const classification = classifyExtension({ manifest, commands });
  const maybeAi = classification.commands["maybe-ai"];
  assert.equal(maybeAi.class, "compatible");
  assert.deepEqual(maybeAi.guardedApis, ["AI"]);
  assert.deepEqual(maybeAi.missingApis, []);
});

test("policy fixture 4: macOS-only command inside a Windows extension — disabled, extension installable with badge", () => {
  const { manifest, commands } = readFixture("macos-command-in-windows");
  const classification = classifyExtension({ manifest, commands });
  assert.equal(classification.installable, true);
  assert.equal(classification.badge, "some features unavailable");
  assert.equal(classification.commands["windows-cmd"].class, "compatible");
  const macos = classification.commands["macos-cmd"];
  assert.equal(macos.class, "disabled-manifest");
  assert.match(macos.reason, /not available on Windows/);
});

test("policy fixture 5: menu-bar command — disabled-mode", () => {
  const { manifest, commands } = readFixture("menubar");
  const classification = classifyExtension({ manifest, commands });
  assert.equal(classification.installable, false);
  const menubar = classification.commands["menubar-cmd"];
  assert.equal(menubar.class, "disabled-mode");
  assert.equal(menubar.reason, "Menu bar commands are not supported");
});

test("interval commands are disabled at the manifest level (decision D8)", () => {
  const result = classifyCommand({ command: { name: "bg", mode: "no-view", interval: "10m" }, entrySource: "x" });
  assert.equal(result.class, "disabled-manifest");
  assert.match(result.reason, /Background refresh/);
});

test("OAuth and WindowManagement markers disable; a canAccess guard keeps them optional", () => {
  const direct = classifyCommand({ command: { name: "a", mode: "view" }, entrySource: "const t = OAuth.PKCEClient; WindowManagement.getDesktops();" });
  assert.equal(direct.class, "disabled-api");
  assert.ok(direct.missingApis.includes("OAuth"));
  assert.ok(direct.missingApis.includes("WindowManagement"));

  const guarded = classifyCommand({
    command: { name: "a", mode: "view" },
    entrySource: "if (environment.canAccess(WindowManagement)) { WindowManagement.getDesktops(); }",
  });
  assert.equal(guarded.class, "compatible");
  assert.deepEqual(guarded.guardedApis, ["WindowManagement"]);
});

test("AppleScript/osascript markers disable with the macOS reason", () => {
  const result = classifyCommand({ command: { name: "a", mode: "view" }, entrySource: "runAppleScript('tell app')", bundleSource: "osascript -e" });
  assert.equal(result.class, "disabled-api");
  assert.ok(result.missingApis.includes("AppleScript"));
  assert.match(result.reason, /AppleScript \(macOS\), not supported/);
});

function makeStore() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "classifier-store-"));
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "classifier-ext-"));
  const store = createStore({ dataRoot, extensionsRoot, apiRoot: path.join(buildRoot, "api") });
  return { store, dataRoot, extensionsRoot, cleanup() {
    store.close();
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(extensionsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } };
}

function stageFixture(extensionsRoot, fixtureName, uuid) {
  const target = path.join(extensionsRoot, uuid);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(FIXTURES, fixtureName), target, { recursive: true });
  return target;
}

test("classifications persist in store.sqlite and recompute when coverage_version changes", () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    stageFixture(extensionsRoot, "ai-direct", "uuid-direct");
    stageFixture(extensionsRoot, "macos-command-in-windows", "uuid-mixed");
    const refreshed = store.syncClassifications();
    assert.deepEqual(refreshed.sort(), ["uuid-direct", "uuid-mixed"]);

    const direct = store.getCommandClassification("uuid-direct", "ask");
    assert.equal(direct.class, "disabled-api");
    const mixed = store.getExtensionClassification("uuid-mixed");
    assert.equal(mixed.installable, 1);
    assert.equal(mixed.badge, "some features unavailable");
    assert.equal(mixed.coverage_version, COVERAGE_VERSION);

    const compat = store.getSummariesCompat();
    assert.equal(compat["uuid-direct"].badge, "requires unsupported APIs");
    assert.equal(compat["uuid-mixed"].commands["macos-cmd"].class, "disabled-manifest");

    // Second sync is a no-op.
    assert.deepEqual(store.syncClassifications(), []);

    // Simulate an older coverage version (we implemented new APIs elsewhere): recompute happens.
    store.db.prepare("UPDATE extension_classifications SET coverage_version = 0").run();
    const again = store.syncClassifications();
    assert.deepEqual(again.sort(), ["uuid-direct", "uuid-mixed"]);
    assert.equal(store.getExtensionClassification("uuid-mixed").coverage_version, COVERAGE_VERSION);

    // Launch gate: disabled commands are refused, compatible ones pass.
    assert.throws(() => store.assertLaunchable("uuid-direct", "ask", "Ask"), /disabled: Requires Raycast AI/);
    assert.doesNotThrow(() => store.assertLaunchable("uuid-mixed", "windows-cmd", "Windows Command"));
  } finally {
    cleanup();
  }
});

test("fresh extensions on disk are picked up by sync without a registry row", () => {
  const { store, extensionsRoot, cleanup } = makeStore();
  try {
    stageFixture(extensionsRoot, "tools-only-ai", "uuid-tools");
    store.syncClassifications();
    assert.equal(store.getCommandClassification("uuid-tools", "plain").class, "compatible");
  } finally {
    cleanup();
  }
});
