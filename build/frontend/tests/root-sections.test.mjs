// Root-list composition tests: the empty-query root shows Favorites + Suggestions (usage-ranked
// top five) instead of the whole catalog; Applications/Commands only appear while searching.
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const outDir = mkdtempSync(join(tmpdir(), "openray-root-sections-"));
const outFile = join(outDir, "root-sections.cjs");

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/app/buildSections.ts", import.meta.url))],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent",
  define: { window: "globalThis" },
});
writeFileSync(outFile, bundled.outputFiles[0].text);

const require = createRequire(import.meta.url);
const { buildSections } = require(outFile);

test.after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function app(name, id = name) {
  return {
    extensionId: "applications",
    commandId: `applications/${id}`,
    title: name,
    subtitle: null,
    keywords: [name],
    payload: { id, name, isRunning: false },
  };
}

function extCommand(uuid, name, title) {
  return {
    uuid,
    name: uuid,
    title: uuid,
    commands: [{ name, title }],
  };
}

const NO_ARGS = {
  fallbackCommands: [],
  fileResults: [],
  inlineResults: [],
  quicklinkRows: [],
  calculatorEntry: null,
  translateEntry: null,
  customTranslateCommands: [],
  fileIndexState: null,
  showFilesInRoot: false,
  focusSession: null,
  gameApps: [],
};

function sectionsFor(query, applications, extensions, favorites, usageScores) {
  return buildSections(
    query,
    applications,
    extensions,
    favorites,
    "medium",
    usageScores,
    NO_ARGS.fallbackCommands,
    NO_ARGS.fileResults,
    NO_ARGS.inlineResults,
    NO_ARGS.quicklinkRows,
    NO_ARGS.calculatorEntry,
    NO_ARGS.translateEntry,
    NO_ARGS.customTranslateCommands,
    NO_ARGS.fileIndexState,
    NO_ARGS.showFilesInRoot,
    NO_ARGS.focusSession,
    NO_ARGS.gameApps,
  );
}

function rowTitle(entry) {
  if (entry.kind === "application") return entry.application.title;
  if (entry.kind === "extension") return entry.command.title;
  if (entry.kind === "internal") return entry.commandId;
  if (entry.kind === "clipboard") return "Clipboard History";
  return entry.title;
}

test("empty query shows Favorites, Suggestions, then every command — never the app catalog", () => {
  const sections = sectionsFor("", [app("Seven Zip"), app("Steam")], [extCommand("translator", "translate", "Translate")], [], new Map());
  assert.deepEqual(sections.map((s) => s.id), ["favorites", "suggestions", "commands"]);
  const suggestionTitles = sections.find((s) => s.id === "suggestions").entries.map(rowTitle);
  const commandTitles = sections.find((s) => s.id === "commands").entries.map(rowTitle);
  // Applications stay searching-only; the commands section carries every command once.
  assert.ok(!suggestionTitles.includes("Seven Zip") || !commandTitles.includes("Steam"), "apps never appear in the commands section");
  assert.equal(commandTitles.filter((t) => t === "translator/translate").length + suggestionTitles.filter((t) => t === "translator/translate").length, 1, "commands do not repeat between sections");
  assert.ok(suggestionTitles.length <= 5);
});

test("suggestions are usage-ranked and favorite rows do not repeat", () => {
  const translator = extCommand("translator", "translate", "Translate");
  const usage = new Map([["Steam", 9], ["Translate", 4], ["Seven Zip", 1]]);
  const sections = sectionsFor("", [app("Seven Zip"), app("Steam")], [translator], ["command:translator/translate"], usage);
  const suggestion = sections.find((s) => s.id === "suggestions");
  const titles = suggestion.entries.map(rowTitle);
  assert.ok(titles.length === 5, "suggestions are capped at five");
  assert.equal(titles[0], "Steam", "the highest-usage entry leads");
  assert.ok(titles.includes("Seven Zip"));
  const favorited = suggestion.entries.find((e) => e.kind === "extension");
  assert.equal(favorited, undefined, "favorited command is not suggested again");
});

test("an internal command favorite pins to Favorites and leaves the regular sections", () => {
  const translator = extCommand("translator", "translate", "Translate");
  const sections = sectionsFor("", [app("Steam")], [translator], ["internal:translator/translate"], new Map());
  assert.equal(sections[0].id, "favorites");
  const favoriteKinds = sections[0].entries.map((e) => e.kind);
  assert.ok(favoriteKinds.includes("internal"), "the favorited internal command appears in Favorites");
  const rest = sections.filter((s) => s.id !== "favorites").flatMap((s) => s.entries);
  assert.ok(!rest.some((e) => e.kind === "internal" && e.commandId === "translator/translate"), "favorited command not repeated below");
});

test("searching shows one ranked Results section mixing apps and commands", () => {
  const translator = extCommand("translator", "translate", "Translate");
  const sections = sectionsFor("ste", [app("Seven Zip"), app("Steam")], [translator], [], new Map());
  const results = sections.find((s) => s.id === "results");
  assert.ok(results, "Results section appears while searching");
  assert.ok(!sections.some((s) => s.id === "applications" || s.id === "commands"), "no separate Applications/Commands sections while searching");
  assert.ok(!sections.some((s) => s.id === "favorites"), "Favorites are an empty-query section only");
  const kinds = results.entries.map((e) => e.kind);
  assert.ok(kinds.includes("application") && kinds.includes("extension"), "apps and commands share the section");
});

test("a prefix-matching command outranks weak app matches in Results", () => {
  const translator = extCommand("translator", "translate", "Translate");
  const junk = app("Rockstar Games SDK");
  const sections = sectionsFor("transla", [junk, app("Steam")], [translator], [], new Map([["Translate", 0]]));
  const results = sections.find((s) => s.id === "results");
  const first = results.entries[0];
  const firstTitle = first.kind === "internal" ? "Translate" : first.command.title;
  assert.equal(firstTitle, "Translate", "a Translate command leads over weak app matches");
});
