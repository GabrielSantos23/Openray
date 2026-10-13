// Root-search matcher tests: src/matching.ts is TypeScript, so the suite bundles it with esbuild
// (already a dev dependency of the frontend) and asserts against the compiled output.
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
const outDir = mkdtempSync(join(tmpdir(), "raycast-mini-matching-"));
const outFile = join(outDir, "matching.cjs");

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/matching.ts", import.meta.url))],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent",
});
writeFileSync(outFile, bundled.outputFiles[0].text);

const require = createRequire(import.meta.url);
const { matchText, normalizeText, checkSensitivity, rankEntries, compareRankedEntries } = require(outFile);

test.after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

/** The application row shape buildSections feeds the ranker: apps found by the process walk have no subtitle. */
function appRow(title, keywords = [], subtitle = null) {
  return { title, subtitle, keywords };
}

test("an entry without a subtitle never matches a non-empty query (running-apps flood)", () => {
  const target = normalizeText("", true);
  const result = matchText(normalizeText("translate", true), target);
  assert.equal(result.type, "unmatched");
  const ranked = rankEntries(
    [appRow("node"), appRow("ApplicationFrameHost"), appRow("Translate", ["translate"])],
    "translate",
    "low",
    new Map(),
  );
  assert.deepEqual(ranked.map((row) => row.entry.title), ["Translate"]);
});

test("reverse prefix still matches: target is a prefix of the query", () => {
  const ranked = rankEntries([appRow("Raycast", ["raycast"])], "raycast mini", "low", new Map());
  assert.deepEqual(ranked.map((row) => row.entry.title), ["Raycast"]);
});

test("word-boundary prefix match ranks above mid-word subsequence matches", () => {
  const ranked = rankEntries(
    [appRow("TranslateX"), appRow("SystemTranslate")],
    "translate",
    "low",
    new Map(),
  );
  assert.equal(ranked[0].entry.title, "TranslateX");
});

test("sensitivity thresholds: a mid-word match with a skip is rejected by medium and high", () => {
  // "ab" inside "cab": score 2 (no word-boundary bonus), 1 skipped char. The shipped formula
  // gives medium 1.5*(2-1-2)+4 = 2.5 and high 2*(2-1) = 2 — the match clears neither.
  const search = normalizeText("ab", true);
  const target = normalizeText("cab", true);
  const result = matchText(search, target);
  assert.equal(checkSensitivity(result, 2, "low"), true);
  assert.equal(checkSensitivity(result, 2, "medium"), false);
  assert.equal(checkSensitivity(result, 2, "high"), false);
});

test("an empty query keeps every entry with its given order", () => {
  const rows = [appRow("Zed"), appRow("Alpha"), appRow("Mid")];
  const ranked = rankEntries(rows, "  ", "low", new Map());
  assert.deepEqual(ranked.map((row) => row.entry.title), ["Zed", "Alpha", "Mid"]);
});

test("usage score breaks ties between equal title matches", () => {
  // Both titles prefix-match "app" with the same score (100), so the usage tier decides.
  const rows = [appRow("Apples"), appRow("Append")];
  const ranked = rankEntries(rows, "app", "low", new Map([["Append", 7], ["Apples", 2]]));
  assert.equal(ranked[0].entry.title, "Append");
});

test("shorter titles win the final tiebreak, like the shipped comparator", () => {
  const ranked = [
    { entry: appRow("LongerName"), ranking: { title: "unmatched", subtitle: "unmatched", keywords: [], isMatching: true }, originalIndex: 0, usageScore: 0, titleLength: 10, subtitleLength: 0 },
    { entry: appRow("Short"), ranking: { title: "unmatched", subtitle: "unmatched", keywords: [], isMatching: true }, originalIndex: 1, usageScore: 0, titleLength: 5, subtitleLength: 0 },
  ];
  ranked.sort((a, b) => compareRankedEntries(a, b, 4));
  assert.equal(ranked[0].entry.title, "Short");
});
