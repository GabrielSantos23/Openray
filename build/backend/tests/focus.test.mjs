// Focus extension tests (docs/focus-games-taskbar-spec.md §A): session state machine
// (start/pause/resume/complete/expiry/restart), bootstrap restore, category store CRUD and
// built-in upsert, category filter resolution, and the app-rule normalizer the host watch loop
// consumes. `dataRoot` isolates every instance; `dispatch` is a spy so no host round-trip happens.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFocus, toAppRules, BUILTIN_CATEGORIES } = require("../src/focus");

const MAX_DURATION_PLUS_ONE = 1440 * 60 * 1000 + 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withFocus(fn) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "openray-focus-"));
    const hostCalls = [];
    const pushes = [];
    const instance = createFocus({
      dataRoot: root,
      dispatch: (method, data) => {
        hostCalls.push({ method, data });
        return Promise.resolve({});
      },
      pushToFrontend: (method, data) => {
        pushes.push({ method, data });
        return Promise.resolve({});
      },
    });
    try {
      await fn({ instance, hostCalls, pushes, root });
    } finally {
      instance.closeDatabase();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("bootstrap upserts the seven built-in categories with their confirmed titles and ids", withFocus(async ({ instance }) => {
  instance.bootstrap();
  const { categories } = instance.handlers.searchCategories({});
  assert.deepEqual(
    categories.filter((category) => category.kind === "builtin").map((category) => `${category.categoryId}:${category.title}`).sort(),
    BUILTIN_CATEGORIES.map((builtin) => `${builtin.categoryId}:${builtin.title}`).sort(),
  );
}));

test("a custom category reusing a built-in id suppresses that built-in upsert", withFocus(async ({ instance }) => {
  // "Gaming" slugifies to the built-in id `gaming` — the shipped manager skips the upsert for it.
  instance.handlers.createCategory({ title: "Gaming", applicationIds: ["steam.exe"] });
  instance.bootstrap();
  const gaming = instance.handlers.searchCategories({ query: "gaming" }).categories.find((category) => category.categoryId === "gaming");
  assert.equal(gaming.kind, "custom");
  assert.deepEqual(gaming.applicationIds, ["steam.exe"]);
}));

test("category CRUD: create slugifies and uniquifies, built-ins resist update and delete", withFocus(async ({ instance }) => {
  instance.bootstrap();
  const first = instance.handlers.createCategory({ title: "Deep Work" }).category;
  assert.equal(first.categoryId, "deep-work");
  const second = instance.handlers.createCategory({ title: "Deep Work" }).category;
  assert.equal(second.categoryId, "deep-work-2");
  assert.equal(first.kind, "custom");
  assert.equal(first.icon, "bulls-eye-16");
  assert.equal(first.builtinId, null);

  assert.throws(() => instance.handlers.updateCategory({ categoryId: "messaging", title: "X" }), /Only custom focus categories/);
  assert.throws(() => instance.handlers.deleteCategory({ categoryId: "messaging" }), /Only custom focus categories/);
  assert.throws(() => instance.handlers.createCategory({ title: "  " }), /title cannot be empty/);

  const updated = instance.handlers.updateCategory({ categoryId: "deep-work", title: "Deep Focus", applicationIds: ["steam.exe"], websiteHosts: ["example.com"] }).category;
  assert.equal(updated.title, "Deep Focus");
  assert.deepEqual(updated.applicationIds, ["steam.exe"]);
  assert.deepEqual(updated.websiteHosts, ["example.com"]);

  const search = instance.handlers.searchCategories({ query: "deep" }).categories;
  assert.deepEqual(search.map((category) => category.categoryId), ["deep-work", "deep-work-2"]);
  assert.deepEqual(instance.handlers.searchCategories({ query: "Messaging" }).categories.map((category) => category.categoryId), ["messaging"]);

  instance.handlers.deleteCategory({ categoryId: "deep-work-2" });
  assert.equal(instance.handlers.searchCategories({ query: "deep" }).categories.length, 1);
}));

test("resolveCategoryFilters merges category hosts and apps and reports missing ids", withFocus(async ({ instance }) => {
  instance.bootstrap();
  instance.handlers.createCategory({ title: "One", applicationIds: ["steam.exe"], websiteHosts: ["store.steampowered.com"] });
  const resolved = instance.handlers.resolveCategoryFilters({ categoryIds: ["one", "gaming", "ghost"] });
  assert.deepEqual(resolved.resolvedCategoryIds, ["one", "gaming"]);
  assert.deepEqual(resolved.missingCategoryIds, ["ghost"]);
  assert.ok(resolved.applicationIds.includes("steam.exe"));
  assert.ok(resolved.applicationIds.includes("EpicGamesLauncher.exe"));
  assert.ok(resolved.websiteHosts.includes("store.steampowered.com"));
  assert.ok(resolved.websiteHosts.includes("steampowered.com"));
  const empty = instance.handlers.resolveCategoryFilters({ categoryIds: [] });
  assert.deepEqual(empty, { websiteHosts: [], applicationIds: [], resolvedCategoryIds: [], missingCategoryIds: [] });
}));

test("toAppRules maps paths, exe names and package ids onto host match rules, deduplicated", () => {
  assert.deepEqual(toAppRules(["path:c:\\apps\\steam.exe", "steam.exe", "PATH:C:\\APPS\\STEAM.EXE"]), [
    { kind: "path", value: "c:\\apps\\steam.exe" },
    { kind: "exeName", value: "steam.exe" },
  ]);
  assert.deepEqual(toAppRules(["MSTeams_8wekyb3d8bbwe"]), [{ kind: "exeBase", value: "msteams" }]);
  assert.deepEqual(toAppRules(["com.squirrel.Discord.Discord"]), [{ kind: "exeBase", value: "discord" }]);
  assert.deepEqual(toAppRules(["Signal.exe"]), [{ kind: "exeName", value: "signal.exe" }]);
  assert.deepEqual(toAppRules([]), []);
});

test("start/toggle/pause/resume/complete lifecycle with host sync and pushes", withFocus(async ({ instance, hostCalls, pushes }) => {
  instance.bootstrap();
  hostCalls.length = 0;
  pushes.length = 0;

  const started = await instance.handlers.startSession({ title: "Ship the clone", goal: { mode: "duration", durationMs: 60000 }, openrayAppIds: ["steam.exe"] });
  assert.equal(started.session.status, "running");
  assert.equal(started.session.title, "Ship the clone");
  assert.ok(started.session.remainingMs > 55000 && started.session.remainingMs <= 60000);
  const startCall = hostCalls.find((call) => call.method === "focus.startSession");
  assert.ok(startCall, "host must be told about the session");
  assert.deepEqual(startCall.data.appRules, [{ kind: "exeName", value: "steam.exe" }]);
  assert.equal(startCall.data.durationMs, 60000);
  assert.equal(startCall.data.restoreAppsWhenSessionEnds, false);
  assert.ok(pushes.some((push) => push.method === "focus.sessionChanged" && push.data.session?.status === "running"));

  await assert.rejects(() => instance.handlers.startSession({ goal: { mode: "noLimit" } }), /another session is active/);

  const paused = await instance.handlers.pauseSession({ durationMs: 60000 });
  assert.equal(paused.session.status, "paused");
  assert.ok(paused.session.pauseEndsAt, "timed pause records pauseEndsAt");
  assert.ok(hostCalls.some((call) => call.method === "focus.pauseSession" && call.data.durationMs === 60000));

  const resumed = await instance.handlers.resumeSession();
  assert.equal(resumed.session.status, "running");
  assert.equal(resumed.session.pauseEndsAt, null);
  assert.ok(hostCalls.some((call) => call.method === "focus.resumeSession"));

  // Indefinite pause has no pauseEndsAt and no auto-resume.
  await instance.handlers.pauseSession({});
  assert.equal(instance.getSessionState().session.pauseEndsAt, null);

  const completed = await instance.handlers.completeSession();
  assert.equal(completed.session, null);
  assert.ok(hostCalls.some((call) => call.method === "focus.completeSession"));

  // With no session active, the input guards and duration validation fire (shipped order: the
  // active-session guard comes first, so these were unreachable above).
  await assert.rejects(() => instance.handlers.startSession({ goal: { mode: "duration", durationMs: MAX_DURATION_PLUS_ONE } }), /24 hours/);
  await assert.rejects(() => instance.handlers.startSession({}), /requires a goal/);

  // Backend toggle semantics: start → pause (running) → resume (paused). The frontend toggle
  // command completes instead; that path calls completeSession directly (covered above).
  const toggled = await instance.handlers.toggleSession({ title: "Second", goal: { mode: "noLimit" } });
  assert.equal(toggled.session.status, "running");
  assert.equal(toggled.session.mode, "noLimit");
  assert.equal(toggled.session.remainingMs, null);
  assert.equal(toggled.session.targetEndAt, null);
  const toggledAgain = await instance.handlers.toggleSession({});
  assert.equal(toggledAgain.session.status, "paused");
  const toggledThird = await instance.handlers.toggleSession({});
  assert.equal(toggledThird.session.status, "running");
  await instance.handlers.cancelSession();
  assert.equal(instance.getSessionState().session, null);
  assert.ok(hostCalls.some((call) => call.method === "focus.cancelSession"));
}));

test("a timed session auto-completes when its duration elapses", withFocus(async ({ instance, hostCalls }) => {
  instance.bootstrap();
  hostCalls.length = 0;
  await instance.handlers.startSession({ goal: { mode: "duration", durationMs: 30 } });
  await sleep(120);
  assert.equal(instance.getSessionState().session, null);
  assert.ok(hostCalls.some((call) => call.method === "focus.completeSession"));
}));

test("a timed pause auto-resumes when its duration elapses", withFocus(async ({ instance, hostCalls }) => {
  instance.bootstrap();
  hostCalls.length = 0;
  await instance.handlers.startSession({ goal: { mode: "duration", durationMs: 60000 } });
  await instance.handlers.pauseSession({ durationMs: 30 });
  assert.equal(instance.getSessionState().session.status, "paused");
  await sleep(120);
  assert.equal(instance.getSessionState().session.status, "running");
  assert.ok(hostCalls.some((call) => call.method === "focus.resumeSession"));
}));

test("update keeps elapsed time and rejects durations shorter than the elapsed time", withFocus(async ({ instance }) => {
  instance.bootstrap();
  const input = { title: "Edit me", goal: { mode: "duration", durationMs: 60000 } };
  await instance.handlers.startSession(input);
  const updated = await instance.handlers.updateSession({ ...input, title: "Edited", goal: { mode: "duration", durationMs: 90000 } });
  assert.equal(updated.session.title, "Edited");
  assert.ok(updated.session.remainingMs > 85000, `expected remaining near 90s, got ${updated.session.remainingMs}`);
  await assert.rejects(() => instance.handlers.updateSession({ ...input, goal: { mode: "duration", durationMs: 1 } }), /must exceed elapsed/);
  await instance.handlers.cancelSession();
  await assert.rejects(() => instance.handlers.updateSession({ ...input }), /No active focus session/);
}));

test("restart restarts from the current session input, and from the last input after completion", withFocus(async ({ instance }) => {
  instance.bootstrap();
  await instance.handlers.startSession({ title: "Restart me", goal: { mode: "duration", durationMs: 60000 } });
  const restarted = await instance.handlers.restartSession();
  assert.equal(restarted.session.title, "Restart me");
  await instance.handlers.completeSession();
  // The shipped restart falls back to the persisted last start input, so it starts a fresh
  // session even after completion; it only errors when neither exists.
  const fromLastInput = await instance.handlers.restartSession();
  assert.equal(fromLastInput.session.title, "Restart me");
}));

test("a fresh instance restores a persisted running session from focus-session.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "openray-focus-"));
  try {
    const first = createFocus({ dataRoot: root, dispatch: () => Promise.resolve({}), pushToFrontend: () => Promise.resolve({}) });
    first.bootstrap();
    await first.handlers.startSession({ title: "Persistent", goal: { mode: "duration", durationMs: 60000 } });
    first.closeDatabase();

    const second = createFocus({ dataRoot: root, dispatch: () => Promise.resolve({}), pushToFrontend: () => Promise.resolve({}) });
    const restored = second.bootstrap();
    assert.equal(restored.session.status, "running");
    assert.equal(restored.session.title, "Persistent");
    assert.ok(restored.session.remainingMs > 50000);
    second.closeDatabase();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bootstrap auto-completes a session that expired while the app was closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "openray-focus-"));
  try {
    const first = createFocus({ dataRoot: root, dispatch: () => Promise.resolve({}), pushToFrontend: () => Promise.resolve({}) });
    first.bootstrap();
    await first.handlers.startSession({ title: "Expired", goal: { mode: "duration", durationMs: 60000 } });
    first.closeDatabase();
    // Simulate wall-clock time passing while closed: push the session's end into the past on disk.
    const sessionPath = join(root, "focus-session.json");
    const stored = JSON.parse(readFileSync(sessionPath, "utf-8"));
    stored.session.targetEndAtMs = Date.now() - 1000;
    stored.session.effectiveEndAtMs = Date.now() - 1000;
    writeFileSync(sessionPath, JSON.stringify(stored, null, 2));

    const second = createFocus({ dataRoot: root, dispatch: () => Promise.resolve({}), pushToFrontend: () => Promise.resolve({}) });
    const restored = second.bootstrap();
    assert.equal(restored.session, null, "an expired session must auto-complete on bootstrap");
    second.closeDatabase();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preferences round-trip with the confirmed defaults", withFocus(async ({ instance }) => {
  const initial = instance.handlers.getSession();
  assert.deepEqual(initial.preferences, { snoozeDurationMs: 180000, playSound: true, restoreAppsWhenSessionEnds: false, allowAllOnEmptyWebsiteAllowlist: false });
  const updated = instance.handlers.setPreferences({ playSound: false, snoozeDurationMs: 60000 });
  assert.deepEqual(updated, { snoozeDurationMs: 60000, playSound: false, restoreAppsWhenSessionEnds: false, allowAllOnEmptyWebsiteAllowlist: false });
  assert.throws(() => instance.handlers.setPreferences({ bogus: 1 }), /Unknown focus preference/);
}));
