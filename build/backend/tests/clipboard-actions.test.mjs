// Raycast's clipboard behaviour that has no store behind it: the sequential paste cursor, the colour
// formatter, the JSON export, the format submenu and the ingest-time auto-tag filters.
//
// Runs against the real store in a temp directory, with the host calls stubbed so the native side can be
// asserted on from Node.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClipboardHistory } = require("../src/clipboard-history.js");
const {
  COLOR_FORMATS,
  exportBytes,
  formattedColors,
  formattedJson,
  normalizeTitle,
  parseColor,
  pasteAsOptions,
  pasteSequentiallyStep,
  representationForMime,
} = require("../src/clipboard-actions.js");

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { createClipboardStore } = require("../src/clipboard-store.js");

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-actions-"));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const result = run(directory);
    // An async body cleans up when it settles, not when it returns the promise.
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * A store rooted at a temp directory, so nothing touches the real profile. `dataRoot` is the option the
 * store actually reads — passing anything else would silently fall back to `%LOCALAPPDATA%\RaycastMini`.
 */
function makeStore(directory) {
  return createClipboardStore({ dataRoot: directory });
}



const textEntry = (text, extra = {}) => ({
  items: [
    {
      representations: [
        { mimeType: "text/plain", contentType: "text", content: text },
        ...(extra.html
          ? [{ mimeType: "text/html", contentType: "text", content: `<p>${text}</p>` }]
          : []),
      ],
    },
  ],
  source: { host: "Windows", name: "notepad.exe", url: "C:/Windows/notepad.exe" },
  observationId: "test:1",
  ...extra,
});

/** Same-millisecond adds tiebreak on the random UUID, so multi-entry tests space their adds out. */
const tickMs = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

test("paste sequentially walks newest to oldest and restarts when the run goes quiet", async () => {
  await withStore(async () => {
    const store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "cb-seq-")));
    store.add(textEntry("first"));
    await tickMs();
    store.add(textEntry("second"));
    await tickMs();
    store.add(textEntry("third"));

    const history = { store, preparedEntry: () => ({ items: [] }) };
    const state = { offset: 0, lastInvocation: null, topItemId: null };

    const step = (options = {}) =>
      pasteSequentiallyStep({
        history,
        state,
        sequenceTimeoutSeconds: 60,
        addNewLine: false,
        ...options,
      });

    const first = step();
    assert.equal(first.status, "pasted");
    assert.equal(first.entryId, store.last(0).id);
    assert.equal(first.text, "third");
    assert.equal(state.offset, 1);

    const second = step();
    assert.equal(second.text, "second");
    assert.equal(state.offset, 2);

    const third = step();
    assert.equal(third.text, "first");
    assert.equal(state.offset, 3);

    assert.equal(step().status, "exhausted");
    assert.equal(state.offset, 0, "an exhausted run resets its cursor");

    // A quiet gap restarts the sequence at the newest entry.
    const later = step({ now: new Date(Date.now() + 61_000) });
    assert.equal(later.text, "third");
    assert.equal(state.offset, 1);
  });
});

test("paste sequentially appends the configured newline only for text-like entries", () => {
  withStore(() => {
    const store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "cb-seq-nl-")));
    store.add(textEntry("plain text"));

    const history = { store, preparedEntry: () => ({ items: [{ representations: [] }] }) };
    const state = { offset: 0, lastInvocation: null, topItemId: null };

    const withNewline = pasteSequentiallyStep({
      history,
      state,
      sequenceTimeoutSeconds: 60,
      addNewLine: true,
    });
    assert.equal(withNewline.asText, true);
    assert.equal(withNewline.text, "plain text\n");

    // Only one entry added, so the second call is exhausted.
    const withoutNewline = pasteSequentiallyStep({
      history,
      state,
      sequenceTimeoutSeconds: 60,
      addNewLine: false,
    });
    assert.equal(withoutNewline.status, "exhausted");
  });
});

test("paste sequentially restarts when the newest entry changes underneath the run", async () => {
  await withStore(async () => {
    const store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "cb-seq-top-")));
    store.add(textEntry("one"));
    await tickMs();
    store.add(textEntry("two"));

    const history = { store, preparedEntry: () => ({ items: [] }) };
    const state = { offset: 0, lastInvocation: null, topItemId: null };

    const first = pasteSequentiallyStep({
      history, state, sequenceTimeoutSeconds: 60, addNewLine: false,
    });
    assert.equal(first.text, "two");
    assert.equal(state.offset, 1);

    await tickMs();
    store.add(textEntry("three"));
    const restarted = pasteSequentiallyStep({
      history, state, sequenceTimeoutSeconds: 60, addNewLine: false,
    });
    assert.equal(restarted.text, "three", "a new top entry restarts the run");
    assert.equal(state.offset, 1);
  });
});

test("a non-text entry is pasted as its own items rather than as plain text", () => {
  withStore(() => {
    const store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "cb-seq-file-")));
    const file = path.join(os.tmpdir(), `cb-file-${Date.now()}.txt`);
    fs.writeFileSync(file, "on disk");
    store.add({
      items: [{ representations: [{ mimeType: "text/uri-list", contentType: "text", content: file }] }],
      source: { host: "Windows", name: "explorer.exe", url: "C:/Windows/explorer.exe" },
      observationId: "test:file",
    });

    const history = {
      store,
      preparedEntry: () => ({ items: [{ representations: [{ mimeType: "text/uri-list", text: file }] }] }),
    };
    const state = { offset: 0, lastInvocation: null, topItemId: null };
    const step = pasteSequentiallyStep({
      history, state, sequenceTimeoutSeconds: 60, addNewLine: true,
    });
    assert.equal(step.asText, false);
    assert.deepEqual(step.items, [{ representations: [{ mimeType: "text/uri-list", text: file }] }]);
  });
});

test("Copy Color as… produces Raycast's fifteen formats in Raycast's order", () => {
  assert.deepEqual(
    COLOR_FORMATS.map((format) => format.id),
    [
      "hex", "hexAlpha", "rgba", "rgbaPercentage", "rgbCss4", "hsl", "hsla", "hslCss4", "hwb",
      "lab", "lch", "oklab", "oklch", "nsColor", "uiColor",
    ],
  );

  const formats = formattedColors("#3366cc");
  assert.equal(formats.length, 15);
  assert.deepEqual(formats.map((format) => format.id), COLOR_FORMATS.map((format) => format.id));
  assert.deepEqual(
    Object.fromEntries(formats.map((format) => [format.id, format.value])),
    {
      hex: "#3366CC",
      hexAlpha: "#3366CCFF",
      rgba: "rgba(51, 102, 204, 1)",
      rgbaPercentage: "rgba(20%, 40%, 80%, 1)",
      rgbCss4: "rgb(51, 102, 204)",
      hsl: "hsl(220deg, 60%, 50%)",
      hsla: "hsl(220deg, 60%, 50%, 1)",
      hslCss4: "hsl(220deg 60% 50%)",
      // HWB whiteness is the darkest channel and blackness the lightest-channel remainder, so a fully
      // saturated blue with a 20% floor reads 20/20.
      hwb: "hwb(220 20% 20%)",
      lab: "lab(45.034198244872% 18.721198307832 -57.859259727132)",
      lch: "lch(45.034198244872% 60.812640151969 287.929735950575)",
      oklab: "oklab(53.248255954991% -0.022511845707 -0.166349164068)",
      oklch: "oklch(53.248255954991% 0.167865504447 262.293046996813deg)",
      nsColor: "NSColor(red: 0.2, green: 0.4, blue: 0.8, alpha: 1)",
      uiColor: "UIColor(red: 0.2, green: 0.4, blue: 0.8, alpha: 1)",
    },
  );
});

test("the colour parser accepts the notations a clipboard entry realistically holds", () => {
  const red = { r: 1, g: 0, b: 0, a: 1 };
  for (const value of ["#ff0000", "#f00", "ff0000", "red", "rgb(255, 0, 0)", "rgb(100%, 0%, 0%)", "hsl(0deg, 100%, 50%)"]) {
    const parsed = parseColor(value);
    assert.ok(parsed, `${value} should parse`);
    assert.ok(Math.abs(parsed.r - red.r) < 0.01, `${value} red channel`);
    assert.ok(Math.abs(parsed.g - red.g) < 0.01, `${value} green channel`);
    assert.ok(Math.abs(parsed.b - red.b) < 0.01, `${value} blue channel`);
  }

  const half = parseColor("rgba(255, 0, 0, 0.5)");
  assert.ok(Math.abs(half.a - 0.5) < 0.001);

  for (const value of ["", "   ", "not-a-colour", "#ggg", "rgb(", "hsl(1)"]) {
    assert.equal(parseColor(value), null, `${JSON.stringify(value)} should not parse`);
  }

  assert.throws(() => formattedColors("definitely not a colour"), /Failed to format color/);
});

test("an alpha channel flows through the formats that carry it", () => {
  const formats = Object.fromEntries(
    formattedColors("rgba(255, 0, 0, 0.5)").map((format) => [format.id, format.value]),
  );
  assert.equal(formats.hex, "#FF0000", "hex drops alpha, as Raycast does");
  assert.equal(formats.hexAlpha, "#FF000080");
  assert.equal(formats.rgba, "rgba(255, 0, 0, 0.5)");
  assert.equal(formats.rgbCss4, "rgb(255, 0, 0 / 50%)");
  // Only the formats that name an alpha channel carry it, and they all carry the same 50%.
assert.equal(formats.hsla, "hsl(0deg, 100%, 50%, 0.5)");
assert.equal(formats.hslCss4, "hsl(0deg 100% 50% / 50%)");
assert.match(formats.oklch, /\/ 50%\)$/, "oklch reports alpha in CSS4 style");
assert.equal(formats.oklch.includes("/"), true);
assert.equal(formats.lab.includes("50%"), false, "lab has no alpha slot and is left opaque");
assert.equal(formats.oklab.includes("/"), false, "oklab has no alpha slot either");
assert.equal(formats.nsColor, "NSColor(red: 1, green: 0, blue: 0, alpha: 0.5)");
assert.equal(formats.uiColor, "UIColor(red: 1, green: 0, blue: 0, alpha: 0.5)");
});

test("Paste as… lists only the formats the entry actually holds, plain text first", () => {
  const entry = {
    items: [
      {
        representations: [
          { mimeType: "text/html", contentType: "text", content: "<p>hi</p>" },
          { mimeType: "text/plain", contentType: "text", content: "hi" },
          { mimeType: "application/vnd.raycast.ocr", contentType: "text", content: "hi" },
        ],
      },
      { representations: [{ mimeType: "image/png", contentType: "url", content: "C:/tmp/x.png" }] },
    ],
  };
  assert.deepEqual(
    pasteAsOptions(entry).map((option) => option.base),
    ["text/plain", "text/html", "application/vnd.raycast.ocr", "image/png"],
  );
  assert.deepEqual(
    pasteAsOptions(entry).map((option) => option.label),
    ["Plain Text", "HTML", "Recognized Text", "Image"],
  );

  const plain = { items: [{ representations: [{ mimeType: "text/plain", contentType: "text", content: "x" }] }] };
  assert.equal(pasteAsOptions(plain).length, 1, "a single-format entry has nothing to choose from");

  assert.equal(
    representationForMime(entry, "text/html").content,
    "<p>hi</p>",
  );
  assert.equal(representationForMime(entry, "text/rtf"), null, "an absent format resolves to null");
});

test("Copy Formatted JSON keeps the payloads on disk and stays parseable", () => {
  const entry = {
    id: "abc",
    title: "hello",
    items: [{ representations: [{ mimeType: "text/plain", contentType: "text", content: "hello" }] }],
    source: { host: "Windows", name: "notepad.exe", url: "C:/notepad.exe" },
  };
  const json = formattedJson(entry);
  assert.ok(json.endsWith("\n"), "formatted JSON ends with a newline");
  assert.deepEqual(JSON.parse(json), entry);
  assert.match(json, /^\{\n {2}"id": "abc"/, "it is indented rather than minified");
});

test("Save as File exports text as UTF-8 and images byte-for-byte", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-export-"));
  const imagePath = path.join(directory, "shot.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
  fs.writeFileSync(imagePath, bytes);

  const textEntry = {
    items: [{ representations: [{ mimeType: "text/plain", contentType: "text", content: "héllo" }] }],
  };
  const textExport = exportBytes(textEntry);
  assert.equal(textExport.extension, ".txt");
  assert.equal(textExport.bytes.toString("utf8"), "héllo", "multi-byte text survives the round trip");

  const imageEntry = {
    items: [{ representations: [{ mimeType: "image/png", contentType: "url", content: imagePath }] }],
  };
  const imageExport = exportBytes(imageEntry);
  assert.equal(imageExport.extension, ".png");
  assert.ok(imageExport.bytes.equals(bytes), "image bytes are passed through untouched");

  assert.equal(exportBytes({ items: [] }), null, "an entry with nothing to export reports null");
});

test("a rename never accepts a blank title", () => {
  assert.equal(normalizeTitle("  spaced  "), "spaced");
  assert.equal(normalizeTitle(""), null);
  assert.equal(normalizeTitle("   "), null);
  assert.equal(normalizeTitle(undefined), null);
});

test("an enabled per-app filter tags copies from a matching application, in any path form", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-filters-"));
  const dispatched = [];
  const store = makeStore(directory);
  const history = createClipboardHistory({
    dispatch: async (method, data) => {
      dispatched.push([method, data]);
      return { text: "OCR", results: [] };
    },
    store,
  });

  history.handlers.setFilter({
    filter: { sourceUrl: "chrome.exe", tags: ["work", "browser"], enabled: true },
  });
  history.handlers.setFilter({
    filter: { sourceUrl: "slack.exe", tags: ["ignored-for-now"], enabled: false },
  });

  await history.handlers.capture({
    ...textEntry("from chrome"),
    source: { host: "Windows", name: "chrome.exe", url: "C:/Program Files/Google/Chrome/Application/chrome.exe" },
    observationId: "test:chrome",
  });

  const entries = store.all({ limit: 10 }).entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].tags, ["browser", "work"]);
  assert.equal(entries[0].source.name, "chrome.exe");

  // A disabled rule contributes nothing.
  await history.handlers.capture({
    ...textEntry("from slack"),
    source: { host: "Windows", name: "slack.exe", url: "C:/Users/me/AppData/Local/Slack/slack.exe" },
    observationId: "test:slack",
  });
  const afterTwo = store.all({ limit: 10 }).entries;
  assert.equal(afterTwo.length, 2);
  assert.deepEqual(
    afterTwo.find((entry) => entry.title === "from slack").tags,
    [],
    "a disabled filter does not tag",
  );

  // An application with no rule at all is still stored, untagged.
  await history.handlers.capture({
    ...textEntry("from notepad"),
    source: { host: "Windows", name: "notepad.exe", url: "C:/Windows/notepad.exe" },
    observationId: "test:notepad",
  });
  const untagged = store.all({ limit: 10 }).entries.find((entry) => entry.title === "from notepad");
  assert.deepEqual(untagged.tags, []);

  assert.deepEqual((await history.handlers.getFilters()).filters.length, 2);
  history.stopTasks();
});

test("the filters textarea round trips through setFiltersFromText", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-filtertext-"));
  const store = makeStore(directory);
  const history = createClipboardHistory({
    dispatch: async () => ({}),
    store,
  });

  const response = await history.handlers.setFiltersFromText({
    text: ["chrome.exe: work, browser", "-slack.exe: chat", "code.exe: code"].join("\n"),
  });
  assert.deepEqual(
    response.filters.map((filter) => [filter.sourceUrl, filter.tags, filter.enabled]),
    [
      ["chrome.exe", ["browser", "work"], true],
      ["code.exe", ["code"], true],
      ["slack.exe", ["chat"], false],
    ],
  );

  // Blank lines and whitespace are ignored rather than creating empty rules.
  const second = await history.handlers.setFiltersFromText({ text: "\n  \ncode.exe: code\n" });
  assert.equal(second.filters.length, 1, "a shorter list removes the rules it no longer names");
  history.stopTasks();
});

test("preferences persist, validate and reject unknown keys", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-prefs-"));
  const store = makeStore(directory);
  const history = createClipboardHistory({ dispatch: async () => ({}), store });

  const defaults = await history.handlers.getPreferences();
  assert.equal(defaults.primaryAction, "paste");
  assert.equal(defaults.preferPastingAsPlainText, false);
  assert.equal(defaults.showLinkVisualInformation, true);
  assert.equal(defaults.updateHistoryAfterAction, true);
  assert.equal(defaults.textRecognitionEnabled, true);
  assert.equal(defaults.ocrLevel, "fast");
  assert.equal(defaults.sequentialPasteTimeoutSeconds, 60);
  assert.equal(defaults.addNewLineAfterPaste, true);

  for (const [key, value, expected] of [
    ["primaryAction", "copy", "copy"],
    ["primaryAction", "nonsense", "paste"],
    ["preferPastingAsPlainText", true, true],
    ["showLinkVisualInformation", false, false],
    ["showLinkVisualInformation", undefined, true],
    ["updateHistoryAfterAction", false, false],
    ["textRecognitionEnabled", false, false],
    ["ocrLevel", "accurate", "accurate"],
    ["ocrLevel", "fast", "fast"],
    ["addNewLineAfterPaste", false, false],
    ["sequentialPasteTimeoutSeconds", 5, 5],
  ]) {
    const result = await history.handlers.setPreference({ key, value });
    assert.equal(result.value, expected, `${key}=${JSON.stringify(value)} should store ${expected}`);
  }

  await assert.rejects(
    () => history.handlers.setPreference({ key: "sequentialPasteTimeoutSeconds", value: 0 }),
    /positive number/,
  );
  await assert.rejects(
    () => history.handlers.setPreference({ key: "sequentialPasteTimeoutSeconds", value: "soon" }),
    /positive number/,
  );
  await assert.rejects(
    () => history.handlers.setPreference({ key: "notAThing", value: 1 }),
    /Unknown clipboard preference/,
  );

  history.stopTasks();
});

test("the clipboard hotkey is normalised and rejects a bare key", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-hotkey-"));
  const store = makeStore(directory);
  const registered = [];
  const history = createClipboardHistory({
    dispatch: async (method, data) => {
      registered.push(data.hotkey);
      return { ok: true };
    },
    store,
  });

  assert.equal((await history.handlers.getHotkey()).hotkey, "Ctrl + Shift + V");
  assert.equal((await history.handlers.setHotkey({ hotkey: "alt + v" })).hotkey, "Alt + V");
  assert.equal((await history.handlers.setHotkey({ hotkey: "shift+ctrl+f5" })).hotkey, "Ctrl + Shift + F5");
  assert.equal((await history.handlers.setHotkey({ hotkey: "cmd+space" })).hotkey, "Cmd + Space");

  await assert.rejects(() => history.handlers.setHotkey({ hotkey: "V" }), /not a shortcut/);
  await assert.rejects(() => history.handlers.setHotkey({ hotkey: "Ctrl + A + B" }), /not a shortcut/);
  assert.ok(registered.length >= 3, "each accepted hotkey is handed to the host");
  history.stopTasks();
});

test("resetPasteSequence clears the in-memory cursor", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cb-reset-"));
  const store = makeStore(directory);
  const history = createClipboardHistory({ dispatch: async () => ({}), store });

  store.add(textEntry("one"));
  await tickMs();
  store.add(textEntry("two"));
  await history.handlers.pasteSequentially();
  assert.equal(history.pasteSequence.offset, 1);

  const reset = await history.handlers.resetPasteSequence();
  assert.deepEqual(reset, { reset: true });
  assert.equal(history.pasteSequence.offset, 0);
  assert.equal(history.pasteSequence.lastInvocation, null);
  assert.equal(history.pasteSequence.topItemId, null);
  history.stopTasks();
});