// Focus + Games frontend tests (docs/focus-games-taskbar-spec.md §A/§B): the duration grammar
// the Start/Edit form shares, the preference merge for the toggle command, and the shipped
// launcher-vs-game classification the Game Launcher view uses. Both modules bundle with esbuild
// like matching.test.mjs does.

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// esbuild.exe cannot write files under the build sandbox, so bundle to memory and let Node
// persist the output itself.
const outDir = mkdtempSync(join(tmpdir(), "openray-focus-games-"));
const focusFile = join(outDir, "focus.cjs");
const gamesFile = join(outDir, "games.cjs");

for (const [entry, out] of [
  ["../src/focus.ts", focusFile],
  ["../src/games.ts", gamesFile],
]) {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    logLevel: "silent",
    define: { window: "globalThis" },
  });
  writeFileSync(out, bundled.outputFiles[0].text);
}

const require = createRequire(import.meta.url);
const focus = require(focusFile);
const games = require(gamesFile);

test.after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

test("parseDurationText: minutes, hours, combos, glued minutes", () => {
  const now = new Date("2026-10-11T10:00:00");
  assert.deepEqual(focus.parseDurationText("15m", now), { mode: "duration", durationMs: 15 * 60 * 1000 });
  assert.deepEqual(focus.parseDurationText("1h", now), { mode: "duration", durationMs: 60 * 60 * 1000 });
  assert.deepEqual(focus.parseDurationText("1h 30m", now), { mode: "duration", durationMs: 90 * 60 * 1000 });
  assert.deepEqual(focus.parseDurationText("1h30", now), { mode: "duration", durationMs: 90 * 60 * 1000 });
  assert.deepEqual(focus.parseDurationText("90", now), { mode: "duration", durationMs: 90 * 60 * 1000 });
});

test("parseDurationText: clock targets roll to tomorrow when already past", () => {
  const now = new Date("2026-10-11T18:30:00");
  const until6pm = focus.parseDurationText("until 6pm", now);
  assert.equal(until6pm?.mode, "duration");
  assert.ok(Math.abs(until6pm.durationMs - 23.5 * 60 * 60 * 1000) < 60000);
  const morning = new Date("2026-10-11T09:00:00");
  const noon = focus.parseDurationText("until noon", morning);
  assert.deepEqual(noon, { mode: "duration", durationMs: 3 * 60 * 60 * 1000 });
  const workday = focus.parseDurationText("workday", morning);
  assert.deepEqual(workday, { mode: "duration", durationMs: 9 * 60 * 60 * 1000 });
});

test("parseDurationText: empty is No Limit, garbage and >24h are rejected", () => {
  const now = new Date("2026-10-11T10:00:00");
  assert.deepEqual(focus.parseDurationText("", now), { mode: "noLimit" });
  assert.equal(focus.parseDurationText("soon", now), null);
  assert.equal(focus.parseDurationText("25h", now), null);
  assert.equal(focus.parseDurationText("0m", now), null);
  assert.equal(focus.parseDurationText("until never", now), null);
});

test("formatDuration reads durations back the way the field labels them", () => {
  assert.equal(focus.formatDuration({ mode: "noLimit" }), "No Limit");
  assert.equal(focus.formatDuration({ mode: "duration", durationMs: 15 * 60 * 1000 }), "15m");
  assert.equal(focus.formatDuration({ mode: "duration", durationMs: 60 * 60 * 1000 }), "1h");
  assert.equal(focus.formatDuration({ mode: "duration", durationMs: 90 * 60 * 1000 }), "1h 30m");
});

test("mergePreferences fills the toggle command's input from the stored preferences", () => {
  const input = { ...focus.DEFAULT_START_INPUT, snoozeDurationMs: null };
  const merged = focus.mergePreferences(input, { snoozeDurationMs: 60000, playSound: false, restoreAppsWhenSessionEnds: true, allowAllOnEmptyWebsiteAllowlist: true });
  assert.equal(merged.snoozeDurationMs, 60000);
  assert.equal(merged.allowAllOnEmptyWebsiteAllowlist, true);
  assert.equal(merged.restoreAppsWhenSessionEnds, true);
});

test("isGameLauncher classifies by the shipped executable and name sets", () => {
  const launcher = (name, path) => ({ id: path ?? name, name, path: path ?? `c:\\games\\${name}.exe`, isRunning: false });
  assert.equal(games.isGameLauncher(launcher("Steam", "c:\\program files (x86)\\steam\\steam.exe")), true);
  assert.equal(games.isGameLauncher(launcher("Epic Games Launcher", "c:\\epic\\EpicGamesLauncher.exe")), true);
  assert.equal(games.isGameLauncher(launcher("Battle.net", "c:\\bnet\\Battle.net Launcher.exe")), true);
  assert.equal(games.isGameLauncher(launcher("Xbox", null)), true);
  assert.equal(games.isGameLauncher(launcher("Stardew Valley", "c:\\games\\stardew.exe")), false);
  assert.equal(games.isGameLauncher(launcher("Stardew Valley", null)), false);
});

test("partitionGames fills Suggestions with the first five non-launcher games", () => {
  const mk = (name) => ({ id: `id:${name}`, name, path: `c:\\games\\${name}.exe`, isRunning: false });
  const sevenGames = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"].map(mk);
  const launchers = [{ id: "steam", name: "Steam", path: "c:\\steam\\steam.exe", isRunning: false }];
  const partitioned = games.partitionGames([...sevenGames, ...launchers]);
  assert.deepEqual(partitioned.suggestions.map((game) => game.name), ["One", "Two", "Three", "Four", "Five"]);
  assert.equal(partitioned.games.length, 7);
  assert.deepEqual(partitioned.launchers.map((game) => game.name), ["Steam"]);
});

test("filterGames matches every whitespace-separated term across name and path", () => {
  const game = { id: "id:1", name: "Stardew Valley", path: "c:\\games\\stardew valley.exe", isRunning: false };
  assert.equal(games.filterGames([game], "stardew").length, 1);
  assert.equal(games.filterGames([game], "stardew valley").length, 1);
  assert.equal(games.filterGames([game], "stardew missing").length, 0);
  assert.equal(games.filterGames([game], "").length, 0, "an empty query filters to nothing in the Results section");
});
