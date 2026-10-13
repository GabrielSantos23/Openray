// Notes frontend tests (docs/notes-spec.md): the Search Notes recency sections, the substring
// filter, the Browse `Opened <relative time>` fragment, and the word counter. `src/notes.ts`
// bundles with esbuild like the focus-games tests do.

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const outDir = mkdtempSync(join(tmpdir(), "raycast-mini-notes-"));
const notesFile = join(outDir, "notes.cjs");

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/notes.ts", import.meta.url))],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent",
  define: { window: "globalThis" },
});
writeFileSync(notesFile, bundled.outputFiles[0].text);

const require = createRequire(import.meta.url);
const notes = require(notesFile);

test.after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function makeNote(overrides = {}) {
  return {
    id: "n1",
    title: "Shopping list",
    text: "milk\neggs",
    pinned: null,
    createdAt: 0,
    updatedAt: 0,
    accessedAt: 0,
    charCount: 10,
    ...overrides,
  };
}

// 2026-10-12 is a Monday; the buckets key off local midnight.
const NOW = new Date(2026, 9, 12, 15, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

test("recencyBucket: pinned wins, then Today/Yesterday/This Week/This Month/Older", () => {
  assert.equal(notes.recencyBucket(makeNote({ pinned: 0, updatedAt: NOW - 40 * DAY }), NOW), "Pinned");
  assert.equal(notes.recencyBucket(makeNote({ updatedAt: NOW }), NOW), "Today");
  assert.equal(notes.recencyBucket(makeNote({ updatedAt: NOW - 1 }), NOW), "Today");
  const yesterday = new Date(2026, 9, 11, 23, 59).getTime();
  assert.equal(notes.recencyBucket(makeNote({ updatedAt: yesterday }), NOW), "Yesterday");
  const lastWeek = new Date(2026, 9, 6, 12, 0).getTime();
  assert.equal(notes.recencyBucket(makeNote({ updatedAt: lastWeek }), NOW), "This Week");
  const thisMonth = new Date(2026, 9, 1, 9, 0).getTime();
  assert.equal(notes.recencyBucket(makeNote({ updatedAt: thisMonth }), NOW), "This Month");
  assert.equal(notes.recencyBucket(makeNote({ updatedAt: NOW - 40 * DAY }), NOW), "Older");
});

test("groupNotesByRecency files sections in the confirmed order and drops empty ones", () => {
  const grouped = notes.groupNotesByRecency(
    [
      makeNote({ id: "old", updatedAt: NOW - 90 * DAY }),
      makeNote({ id: "pinned", pinned: 0, updatedAt: NOW - 90 * DAY }),
      makeNote({ id: "today", updatedAt: NOW }),
    ],
    NOW,
  );
  assert.deepEqual(
    grouped.map((group) => group.title),
    ["Pinned", "Today", "Older"],
  );
  assert.deepEqual(grouped[0].notes.map((note) => note.id), ["pinned"]);
});

test("filterNotes matches every whitespace-separated term across title and content", () => {
  const list = [
    makeNote({ id: "1", title: "Shopping list", text: "milk and eggs" }),
    makeNote({ id: "2", title: "Work", text: "standup notes" }),
  ];
  assert.equal(notes.filterNotes(list, "shopping").length, 1);
  assert.equal(notes.filterNotes(list, "milk eggs").length, 1);
  assert.equal(notes.filterNotes(list, "notes").length, 1, "the term hits the one note whose body contains it");
  assert.equal(notes.filterNotes(list, "missing term").length, 0);
  assert.equal(notes.filterNotes(list, "   ").length, 2, "an empty query matches everything");
});

test("relativeOpened reads back like the Browse subtitle", () => {
  assert.equal(notes.relativeOpened(NOW - 20_000, NOW), "just now");
  assert.equal(notes.relativeOpened(NOW - 5 * 60_000, NOW), "5 minutes ago");
  assert.equal(notes.relativeOpened(NOW - 3_600_000, NOW), "1 hour ago");
  assert.equal(notes.relativeOpened(NOW - 3 * 3_600_000, NOW), "3 hours ago");
  assert.equal(notes.relativeOpened(NOW - 30 * 60_000, NOW), "30 minutes ago");
  assert.equal(notes.relativeOpened(NOW - 1.5 * DAY, NOW), "yesterday");
  assert.equal(notes.relativeOpened(NOW - 5 * DAY, NOW), "5 days ago");
});

test("noteDeeplink uses the documented clone scheme", () => {
  assert.equal(notes.noteDeeplink("abc-123"), "raycast-mini://notes/abc-123");
});

test("countWords counts non-empty whitespace-separated runs", () => {
  assert.equal(notes.countWords("milk\neggs"), 2);
  assert.equal(notes.countWords(""), 0);
  assert.equal(notes.countWords("   \n  "), 0);
  assert.equal(notes.countWords("one two  three"), 3);
});
