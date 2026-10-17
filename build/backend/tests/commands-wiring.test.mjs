// The registry wiring: handler tables become commands, dispatch flows through one path, and
// the named-pipe entry (`dispatchMessage`) resolves registry-resolvable methods through it.
// Stores run headless against a temp data root with UI pushes stubbed to typed errors.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createRegistry, needsUi } = await import("../src/registry.js");
const { createWiring, defaultRisk } = await import("../src/commands/index.js");
const { createBackend } = await import("../src/backend.js");
const { createSettingsStore } = await import("../src/settings-store.js");
const { createQuicklinks } = await import("../src/quicklinks.js");
const { createSnippets } = await import("../src/snippets.js");
const { createNotes } = await import("../src/notes.js");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openray-wiring-"));
}

function stubUi() {
  return (module, method) => Promise.resolve(null);
}

test("handler tables become registry commands with the same ids", () => {
  const registry = createRegistry();
  const wiring = createWiring({
    registry,
    backend: { dispatch: stubUi() },
  });
  wiring.registerTable("settings", {
    getAll: () => ({ values: {} }),
    set: () => ({ ok: true }),
    replaceAll: () => ({ ok: true }),
  });
  wiring.registerNative("shell.openUrl", { risk: "write" });
  wiring.registerUi("ui.openSettings", "window.openSettings", "Open the Settings window.");

  const ids = registry.list().map((c) => c.id);
  assert.ok(ids.includes("settings.getAll"));
  assert.ok(ids.includes("settings.set"));
  assert.ok(ids.includes("shell.openUrl"));
  assert.ok(ids.includes("ui.openSettings"));
  assert.equal(registry.get("settings.getAll").risk, "read");
  assert.equal(registry.get("settings.replaceAll").risk, "destructive");
  assert.equal(registry.get("shell.openUrl").risk, "write");
  assert.equal(registry.get("ui.openSettings").risk, "write");
});

test("risk heuristic", () => {
  assert.equal(defaultRisk("getAll"), "read");
  assert.equal(defaultRisk("list"), "read");
  assert.equal(defaultRisk("search"), "read");
  assert.equal(defaultRisk("delete"), "destructive");
  assert.equal(defaultRisk("deleteAll"), "destructive");
  assert.equal(defaultRisk("resetToDefaults"), "destructive");
  assert.equal(defaultRisk("emptyTrash"), "destructive");
  assert.equal(defaultRisk("create"), "write");
  assert.equal(defaultRisk("pin"), "write");
});

test("dispatch runs the real handler: settings.set round-trips", async () => {
  const root = tempRoot();
  try {
    const registry = createRegistry();
    const wiring = createWiring({ registry, backend: { dispatch: stubUi() } });
    const settingsStore = createSettingsStore({ dataRoot: root, toRenderer: stubUi() });
    wiring.registerTable("settings", settingsStore.handlers, { risk: { replaceAll: "destructive" } });

    const set = await registry.dispatch("settings.set", { values: { zoom: 1.25 } });
    assert.equal(set.ok, true);
    const get = await registry.dispatch("settings.getAll", {});
    assert.equal(get.ok, true);
    assert.equal(get.result.values.zoom, 1.25);

    const bad = await registry.dispatch("settings.set", { values: { bad: { nested: true } } });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "internal");
    assert.match(bad.error.message, /must be a boolean/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("destructive store verbs are gated; read verbs pass", async () => {
  const root = tempRoot();
  const registry = createRegistry();
  const wiring = createWiring({ registry, backend: { dispatch: stubUi() } });
  let notes;
  try {
    notes = createNotes({ dispatch: stubUi(), pushToFrontend: stubUi(), dataRoot: root });
    wiring.registerTable("notes", notes.handlers);

    const create = await registry.dispatch("notes.create", { title: "Agent note", text: "hello" });
    assert.equal(create.ok, true, create.error?.message);
    const deleted = create.result?.note?.id ?? create.result?.id;
    assert.ok(deleted, "create returns the note id");

    const refused = await registry.dispatch("notes.delete", { id: deleted });
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "destructive_refused");

    const allowed = await registry.dispatch("notes.delete", { id: deleted }, { allowDestructive: true });
    assert.equal(allowed.ok, true, allowed.error?.message);
  } finally {
    try { notes.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native verbs forward through the backend transport", async () => {
  const registry = createRegistry();
  const sent = [];
  const wiring = createWiring({
    registry,
    backend: {
      dispatch: async (module, method, data) => {
        sent.push([module, method, data]);
        return { ok: true, method };
      },
    },
  });
  wiring.registerNative("shell.openUrl", { risk: "write" });
  const envelope = await registry.dispatch("shell.openUrl", { url: "https://example.com" });
  assert.equal(envelope.ok, true);
  assert.deepEqual(sent[0], ["backend", "native", { method: "shell.openUrl", data: { url: "https://example.com" } }]);
});

test("ui verbs route to the frontend module and need the window", async () => {
  const registry = createRegistry();
  const calls = [];
  const wiring = createWiring({
    registry,
    backend: {
      dispatch: async (module, method) => {
        calls.push([module, method]);
        return null;
      },
    },
  });
  wiring.registerUi("ui.openSettings", "window.openSettings", "Open the Settings window.");
  const envelope = await registry.dispatch("ui.openSettings", {});
  assert.equal(envelope.ok, true);
  assert.deepEqual(calls[0], ["frontend", "window.openSettings"]);
});

test("quicklinks and snippets resolve headless", async () => {
  const root = tempRoot();
  let quicklinks;
  let snippets;
  try {
    const registry = createRegistry();
    const wiring = createWiring({ registry, backend: { dispatch: stubUi() } });
    quicklinks = createQuicklinks({
      dispatch: stubUi(),
      pushToFrontend: stubUi(),
      dataRoot: root,
      calculate: () => null,
    });
    snippets = createSnippets({
      dispatch: stubUi(),
      pushToFrontend: stubUi(),
      dataRoot: root,
      calculate: () => null,
    });
    wiring.registerTable("quicklinks", quicklinks.handlers, { risk: { resolve: "read" } });
    wiring.registerTable("snippets", snippets.handlers, { risk: { resolve: "read" } });

    const saved = await registry.dispatch("quicklinks.save", { name: "Example", link: "https://example.com/?q={argument}" });
    assert.equal(saved.ok, true, saved.error?.message);
    const listed = await registry.dispatch("quicklinks.list", {});
    assert.equal(listed.ok, true);
    assert.ok(listed.result.quicklinks.length >= 1);

    const snippet = await registry.dispatch("snippets.create", { title: "Greeting", keyword: ";hdr", text: "Best regards" });
    assert.equal(snippet.ok, true, snippet.error?.message);
    const resolved = await registry.dispatch("snippets.resolve", { text: ";hdr" });
    assert.equal(resolved.ok, true, resolved.error?.message);
  } finally {
    try { quicklinks.close(); } catch {}
    try { snippets.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dispatchMessage resolves registry commands before the handler tables", async () => {
  const root = tempRoot();
  try {
    const backend = createBackend({
      pipeName: "wiring-test-pipe",
      frontendRoot: root,
      extensionsRoot: root,
      dataRoot: root,
    });
    backend.setTransport(stubUi());
    const registry = createRegistry();
    registry.register([
      {
        id: "pipe.echo",
        title: "pipe echo",
        description: "Echoes params back.",
        risk: "read",
        params: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        run: (params) => ({ echoed: params.value }),
      },
    ]);
    backend.registerRegistry(registry);

    const result = await backend.dispatchMessage("backend", "pipe.echo", { value: "hi" });
    assert.deepEqual(result, { echoed: "hi" });

    await assert.rejects(
      () => backend.dispatchMessage("backend", "pipe.echo", { value: 1, extra: true }),
      /must be of type string/,
    );
    await assert.rejects(() => backend.dispatchMessage("backend", "pipe.echo", {}), /value is required/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
