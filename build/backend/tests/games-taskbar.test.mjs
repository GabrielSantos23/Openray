// Games + Taskbar tests (docs/focus-games-taskbar-spec.md §B/§C): the isGame flag store over the
// application list, the Game Mode toggle, and the taskbar settings persistence + toggle. All host
// interaction goes through a dispatch spy.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGames } = require("../src/games");
const { createTaskbar } = require("../src/taskbar");

function withGames(fn) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "openray-games-"));
    const hostCalls = [];
    const games = createGames({
      dataRoot: root,
      dispatch: (method, data) => {
        hostCalls.push({ method, data });
        return Promise.resolve({ value: APPLICATIONS });
      },
    });
    try {
      await fn({ games, hostCalls, root });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

const APPLICATIONS = [
  { id: "path:c:\\games\\stardew.exe", name: "Stardew Valley", path: "c:\\games\\stardew.exe" },
  { id: "path:c:\\apps\\notepad.exe", name: "Notepad", path: "c:\\apps\\notepad.exe" },
];

test("mark-as-game / mark-as-application flip the flag with the shipped semantics", withGames(async ({ games, hostCalls }) => {
  const marked = games.handlers.markAsGame({ id: "path:c:\\games\\stardew.exe" });
  assert.deepEqual(marked, { id: "path:c:\\games\\stardew.exe", isGame: true });
  assert.throws(() => games.handlers.markAsGame({}), /Application id is required/);

  const list = await games.handlers.list();
  assert.equal(list.games.length, 1);
  assert.equal(list.games[0].name, "Stardew Valley");
  assert.equal(list.games[0].isGame, true);
  assert.equal(list.games[0].hidden, false);

  const unmarked = games.handlers.markAsApplication({ id: "path:c:\\games\\stardew.exe" });
  assert.equal(unmarked.isGame, false);
  const empty = await games.handlers.list();
  assert.equal(empty.games.length, 0);
  assert.deepEqual(games.handlers.getFlags(), { games: {}, hidden: {} });
}));

test("hidden games leave the list but keep their flag", withGames(async ({ games }) => {
  games.handlers.markAsGame({ id: "path:c:\\games\\stardew.exe" });
  games.handlers.hideGame({ id: "path:c:\\games\\stardew.exe" });
  const list = await games.handlers.list();
  assert.equal(list.games.length, 0);
  assert.equal(games.handlers.getFlags().games["path:c:\\games\\stardew.exe"], true);
}));

test("list merges flags onto the host application payload without mutating applications.getAll", withGames(async ({ games }) => {
  games.handlers.markAsGame({ id: "path:c:\\games\\stardew.exe" });
  const list = await games.handlers.list();
  assert.equal(APPLICATIONS[0].isGame, undefined, "the source payload must stay untouched");
  assert.equal(APPLICATIONS[1].isGame, undefined);
  assert.equal(list.games[0].isGame, true);
  assert.equal(list.games[0].path, "c:\\games\\stardew.exe");
}));

test("Game Mode setting persists and forwards to the host", withGames(async ({ games, hostCalls }) => {
  assert.deepEqual(games.handlers.getSettings(), { gameModeEnabled: false });
  const enabled = games.handlers.setGameMode({ enabled: true });
  assert.deepEqual(enabled, { gameModeEnabled: true });
  assert.deepEqual(hostCalls, [{ method: "games.setGameMode", data: { enabled: true } }]);
}));

function withTaskbar(fn) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "openray-taskbar-"));
    const hostCalls = [];
    const taskbar = createTaskbar({
      dataRoot: root,
      dispatch: (method, data) => {
        hostCalls.push({ method, data });
        return Promise.resolve({});
      },
    });
    try {
      await fn({ taskbar, hostCalls, root });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("taskbar settings round-trip with the confirmed defaults and validate position", withTaskbar(async ({ taskbar }) => {
  assert.deepEqual(taskbar.handlers.getSettings(), { showTaskbar: false, position: "bottom" });
  assert.throws(() => taskbar.handlers.setSetting({ key: "position", value: "middle" }), /Unknown taskbar position/);
  assert.throws(() => taskbar.handlers.setSetting({ key: "compact", value: true }), /Unknown taskbar setting/);
  const moved = taskbar.handlers.setSetting({ key: "position", value: "left" });
  assert.deepEqual(moved, { showTaskbar: false, position: "left" });
}));

test("toggle flips showTaskbar and drives the host show/hide routes", withTaskbar(async ({ taskbar, hostCalls }) => {
  const shown = taskbar.handlers.toggle();
  assert.deepEqual(shown, { visible: true, showTaskbar: true, position: "bottom" });
  assert.deepEqual(hostCalls, [{ method: "taskbar.show", data: {} }]);
  const hidden = taskbar.handlers.toggle();
  assert.equal(hidden.visible, false);
  assert.deepEqual(hostCalls, [
    { method: "taskbar.show", data: {} },
    { method: "taskbar.hide", data: {} },
  ]);
  const explicit = taskbar.handlers.setSetting({ key: "showTaskbar", value: true });
  assert.equal(explicit.showTaskbar, true);
  assert.deepEqual(hostCalls.slice(-1), [{ method: "taskbar.show", data: {} }]);
}));

test("pushSettingsToHost re-applies the persisted state at startup", withTaskbar(async ({ taskbar, hostCalls }) => {
  taskbar.handlers.setSetting({ key: "position", value: "top" });
  taskbar.handlers.setSetting({ key: "showTaskbar", value: true });
  hostCalls.length = 0;
  taskbar.pushSettingsToHost();
  assert.deepEqual(hostCalls, [
    { method: "taskbar.show", data: {} },
    { method: "taskbar.setPosition", data: { position: "top" } },
  ]);
}));
