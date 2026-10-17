// Window Management saved-state store tests (the `Restore` command's persistence).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// Point the store at a scratch database before the first require (the module reads the env once).
const dataRoot = mkdtempSync(join(tmpdir(), "openray-wm-states-"));
process.env.OPENRAY_WINDOW_STATES_DB = join(dataRoot, "window-states.sqlite");

const require = createRequire(import.meta.url);
const { getSavedWindowState, saveWindowState, closeDatabase } = require("../src/window-states.js");

test.after(() => {
  closeDatabase();
  rmSync(dataRoot, { recursive: true, force: true });
});

test("an unknown window has no saved state", () => {
  assert.equal(getSavedWindowState("missing.exe|Nothing"), null);
});

test("saved bounds round-trip with their display index", () => {
  saveWindowState("notepad.exe|Untitled - Notepad", {
    displayIndex: 1,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 400 },
  });
  assert.deepEqual(getSavedWindowState("notepad.exe|Untitled - Notepad"), {
    displayIndex: 1,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 400 },
  });
});

test("saving again overwrites the previous state", () => {
  saveWindowState("notepad.exe|Untitled - Notepad", {
    displayIndex: 0,
    position: { x: -5, y: 0 },
    size: { width: 1280, height: 720 },
  });
  assert.deepEqual(getSavedWindowState("notepad.exe|Untitled - Notepad"), {
    displayIndex: 0,
    position: { x: -5, y: 0 },
    size: { width: 1280, height: 720 },
  });
});

test("fullscreen states round-trip distinctly from bounds", () => {
  saveWindowState("vlc.exe|Movie", "fullscreen");
  assert.deepEqual(getSavedWindowState("vlc.exe|Movie"), { fullscreen: true });
  // And moving the window afterwards replaces the fullscreen record with bounds.
  saveWindowState("vlc.exe|Movie", {
    displayIndex: 0,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
  });
  assert.deepEqual(getSavedWindowState("vlc.exe|Movie"), {
    displayIndex: 0,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
  });
});

test("different windows keep independent states", () => {
  saveWindowState("explorer.exe|Documents", {
    displayIndex: 0,
    position: { x: 1, y: 2 },
    size: { width: 3, height: 4 },
  });
  assert.notEqual(getSavedWindowState("notepad.exe|Untitled - Notepad"), null);
  assert.equal(getSavedWindowState("explorer.exe|Music"), null);
});
