// Settings store: validation, persistence, and the change push both windows rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createSettingsStore } = await import("../src/settings-store.js");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raycastmini-settings-"));
}

test("set validates value types and rejects nested objects", () => {
  const root = tempRoot();
  try {
    const store = createSettingsStore({ dataRoot: root });
    assert.deepEqual(store.handlers.set({ values: { "open-at-login": true, zoom: 1.1 } }), {
      ok: true,
      values: { "open-at-login": true, zoom: 1.1 },
    });
    assert.throws(() => store.handlers.set({ values: { bad: { nested: true } } }), /must be a boolean/);
    assert.throws(() => store.handlers.set({ values: { "": 1 } }), /Invalid settings key/);
    assert.throws(() => store.handlers.set({ values: null }), /expects a values object/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("values persist across store instances and push to the renderer", () => {
  const root = tempRoot();
  try {
    const pushed = [];
    const store = createSettingsStore({ dataRoot: root, toRenderer: (method, data) => pushed.push([method, data]) });
    store.handlers.set({ values: { "pop-to-root-search": "After 90 seconds" } });
    const reopened = createSettingsStore({ dataRoot: root });
    assert.equal(reopened.handlers.getAll().values["pop-to-root-search"], "After 90 seconds");
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0][0], "settings.changed");
    assert.equal(pushed[0][1].values["pop-to-root-search"], "After 90 seconds");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("replaceAll replaces atomically for settings import", () => {
  const root = tempRoot();
  try {
    const store = createSettingsStore({ dataRoot: root });
    store.handlers.set({ values: { a: 1, b: 2 } });
    store.handlers.replaceAll({ values: { c: 3 } });
    assert.deepEqual(store.handlers.getAll().values, { c: 3 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("set merges instead of replacing", () => {
  const root = tempRoot();
  try {
    const store = createSettingsStore({ dataRoot: root });
    store.handlers.set({ values: { a: 1 } });
    store.handlers.set({ values: { b: 2 } });
    assert.deepEqual(store.handlers.getAll().values, { a: 1, b: 2 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
