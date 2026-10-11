// The Translator (`translator.*` handlers): the confirmed quick-translate grammar (in|into,
// quote stripping, transliteration + lowercase, ≥ 3 chars, exact-then-shortest prefix match),
// the translate call against a stubbed provider (fixture payload parsing, guards, cache, offline
// failure), the custom-command store (auto-name, CRUD, invalidation push) and the four
// preferences with their validation.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTranslator, parseQuickTranslate, normalizeToken, LANGUAGES } = require("../src/translator.js");
const { createBackend } = require("../src/backend.js");

function withTranslator(run, { fetchImpl, cacheLimit } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "translator-"));
  const notifications = [];
  const translator = createTranslator({
    dataRoot: directory,
    pushToFrontend: (method, data) => notifications.push({ method, data }),
    fetchImpl,
    cacheLimit,
  });
  const cleanup = () => {
    translator.close();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  const result = run(translator, notifications, directory);
  if (result instanceof Promise) return result.finally(cleanup);
  cleanup();
  return result;
}

/** The Google `translate_a/single` payload shape: nested translation segments + detected language. */
function googlePayload(translated, detected) {
  return [[[translated, "ignored", null, null, 10]], null, detected];
}

function okProvider(translated, detected) {
  return async () => ({ ok: true, status: 200, json: async () => googlePayload(translated, detected) });
}

// ---------------------------------------------------------------------------------------------
// Quick-translate parser (confirmed grammar)
// ---------------------------------------------------------------------------------------------

test("parser matches `in` and `into`, strips quotes, transliterates and lowercases", () => {
  assert.deepEqual(parseQuickTranslate("hello in french"), { sourceText: "hello", target: "fr", targetLabel: "French" });
  assert.deepEqual(parseQuickTranslate("hello INTO german"), { sourceText: "hello", target: "de", targetLabel: "German" });
  assert.deepEqual(parseQuickTranslate('"hello world" in french'), { sourceText: "hello world", target: "fr", targetLabel: "French" });
  assert.deepEqual(parseQuickTranslate("'bonjour' in FRENCH"), { sourceText: "bonjour", target: "fr", targetLabel: "French" });
});

test("the confirmed transliteration strips accents and lowercases the language token", () => {
  assert.equal(normalizeToken("Français"), "francais");
  assert.equal(normalizeToken("GERMAN"), "german");
  // The normalized token still has to prefix-match the curated English names, so an accented
  // token that no name matches yields no row.
  assert.equal(parseQuickTranslate("hola in Français"), null);
});

test("parser prefix-matches: exact name first, then the shortest name", () => {
  assert.deepEqual(parseQuickTranslate("hi in germ"), { sourceText: "hi", target: "de", targetLabel: "German" });
  // `chinese` is not an exact name; the shortest matching name wins. The language token is a
  // single non-space word (`[^\s]+`), so "chinese trad" can never match.
  assert.deepEqual(parseQuickTranslate("hi in chinese"), { sourceText: "hi", target: "zh-CN", targetLabel: "Chinese (Simplified)" });
  assert.equal(parseQuickTranslate("hi in chinese trad"), null);
  assert.deepEqual(parseQuickTranslate("hi in bulgarian"), { sourceText: "hi", target: "bg", targetLabel: "Bulgarian" });
  assert.deepEqual(parseQuickTranslate("hi in english"), { sourceText: "hi", target: "en", targetLabel: "English" });
});

test("parser rejects short tokens, unknown languages and non-matching terms", () => {
  assert.equal(parseQuickTranslate("hi in it"), null, "language token shorter than 3 chars");
  assert.equal(parseQuickTranslate("hi in atlantean"), null, "unknown language");
  assert.equal(parseQuickTranslate("hello"), null, "no in|into separator");
  assert.equal(parseQuickTranslate("in french"), null, "empty source phrase");
  assert.equal(parseQuickTranslate(""), null, "empty term");
});

test("the curated list holds the major languages with unique codes", () => {
  assert.ok(LANGUAGES.length >= 80, `expected a curated list of 80+, got ${LANGUAGES.length}`);
  const codes = new Set(LANGUAGES.map((language) => language.code));
  assert.equal(codes.size, LANGUAGES.length);
  for (const code of ["en", "fr", "de", "es", "zh-CN", "pt", "ru", "ja"]) {
    assert.ok(codes.has(code), `expected ${code} in the list`);
  }
});

// ---------------------------------------------------------------------------------------------
// Translate call — provider parsing, guards, cache, failures
// ---------------------------------------------------------------------------------------------

test("translate parses the provider payload and reports detected source + labels", async () => {
  await withTranslator(async (translator) => {
    const result = await translator.translate({ text: "hello world", source: "auto", target: "es" });
    assert.equal(result.status, "ready");
    assert.equal(result.translatedText, "Hola mundo");
    assert.equal(result.detectedSourceLanguage, "en");
    assert.equal(result.sourceLabel, "English");
    assert.equal(result.targetLabel, "Spanish");
  }, { fetchImpl: okProvider("Hola mundo", "en") });
});

test("multi-segment translations join without separators", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => [[["Hallo", "hello", null, null, 10], [" Welt", " world", null, null, 10]], null, "en"],
  });
  await withTranslator(async (translator) => {
    const result = await translator.translate({ text: "hello world", target: "de" });
    assert.equal(result.translatedText, "Hallo Welt");
    assert.equal(result.sourceLabel, "English");
  }, { fetchImpl });
});

test("auto detect without a detected language leaves the source badge open", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => [[["Hola", "hello", null, null, 10]], null],
  });
  await withTranslator(async (translator) => {
    const result = await translator.translate({ text: "hello", target: "es" });
    assert.equal(result.translatedText, "Hola");
    assert.equal(result.detectedSourceLanguage, null);
    assert.equal(result.sourceLabel, null);
  }, { fetchImpl });
});

test("the confirmed guards fire before any network call", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return okProvider("x", "en")();
  };
  await withTranslator(async (translator) => {
    const noText = await translator.translate({ text: "   ", target: "es" });
    assert.equal(noText.status, "failed");
    assert.equal(noText.error, "Text to be translated is empty");
    const noTarget = await translator.translate({ text: "hello" });
    assert.equal(noTarget.status, "failed");
    assert.equal(noTarget.error, "Target language is required for translation");
    assert.equal(calls, 0, "guards must not reach the provider");
  }, { fetchImpl });
});

test("results cache per (source, target, text) and the cache serves repeats", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return okProvider("Bonjour", "en")();
  };
  await withTranslator(async (translator) => {
    const first = await translator.translate({ text: "hello", target: "fr" });
    assert.equal(first.fromCache, false);
    const second = await translator.translate({ text: "hello", target: "fr" });
    assert.equal(second.fromCache, true);
    assert.equal(second.translatedText, "Bonjour");
    const different = await translator.translate({ text: "hello", target: "de" });
    assert.equal(different.fromCache, false, "a different target is a different key");
    const explicitSource = await translator.translate({ text: "hello", source: "en", target: "fr" });
    assert.equal(explicitSource.fromCache, false, "an explicit source is a different key");
    assert.equal(calls, 3);
  }, { fetchImpl });
});

test("the cache is a bounded LRU (oldest entry evicted)", async () => {
  const fetchImpl = async (url) => {
    const text = decodeURIComponent(/&q=(.*)$/.exec(String(url))[1]);
    return okProvider(`out:${text}`, "en")();
  };
  await withTranslator(async (translator) => {
    const first = await translator.translate({ text: "a", target: "fr" });
    await translator.translate({ text: "b", target: "fr" });
    // Re-reading `a` refreshes its recency, so `b` is now the oldest of the two entries.
    await translator.translate({ text: "a", target: "fr" });
    assert.equal(first.translatedText, "out:a");
    const cached = await translator.translate({ text: "a", target: "fr" });
    assert.equal(cached.fromCache, true);
    // The third insert overflows the 2-entry cache and evicts the oldest (`b`); `a` survives.
    const third = await translator.translate({ text: "c", target: "fr" });
    assert.equal(third.translatedText, "out:c");
    const survivor = await translator.translate({ text: "a", target: "fr" });
    assert.equal(survivor.fromCache, true, "a survived the eviction");
    const evicted = await translator.translate({ text: "b", target: "fr" });
    assert.equal(evicted.fromCache, false, "b was evicted by the 2-entry LRU");
  }, { fetchImpl, cacheLimit: 2 });
});

test("provider failures return the failed status with the underlying message, uncached", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("getaddrinfo ENOTFOUND translate.googleapis.com");
  };
  await withTranslator(async (translator) => {
    const failed = await translator.translate({ text: "hello", target: "fr" });
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /ENOTFOUND/);
    const again = await translator.translate({ text: "hello", target: "fr" });
    assert.equal(again.status, "failed", "failures are not cached");
    assert.equal(calls, 2, "the retry reached the provider again");
  }, { fetchImpl });
});

test("HTTP error statuses surface as failures", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await withTranslator(async (translator) => {
    const result = await translator.translate({ text: "hello", target: "fr" });
    assert.equal(result.status, "failed");
    assert.match(result.error, /429/);
  }, { fetchImpl });
});

// ---------------------------------------------------------------------------------------------
// Custom commands store
// ---------------------------------------------------------------------------------------------

test("save auto-names from the languages, validates the target and pushes the update", async () => {
  await withTranslator(async (translator, notifications) => {
    const withSource = await translator.handlers.saveTranslateCustomCommand({ source: "fr", target: "de" });
    assert.equal(withSource.name, "Translate French to German");
    const withoutSource = await translator.handlers.saveTranslateCustomCommand({ target: "de" });
    assert.equal(withoutSource.name, "Translate to German");
    assert.equal(withoutSource.outputBehavior, "open");
    assert.equal(withoutSource.enabled, true);
    assert.equal(notifications.filter((entry) => entry.method === "translator.customCommandsUpdated").length, 2);

    assert.throws(
      () => translator.handlers.saveTranslateCustomCommand({ source: "fr" }),
      /Target language is required/,
    );
    assert.throws(
      () => translator.handlers.saveTranslateCustomCommand({ target: "klingon" }),
      /Target language is required/,
    );
  });
});

test("getAll, update (rename, disable, behavior) and delete round-trip", async () => {
  await withTranslator(async (translator, notifications) => {
    const created = await translator.handlers.saveTranslateCustomCommand({ name: "My Command", target: "de" });
    const renamed = await translator.handlers.updateTranslateCustomCommand({
      id: created.id,
      name: "Renamed",
      outputBehavior: "replace",
      enabled: false,
    });
    assert.equal(renamed.name, "Renamed");
    assert.equal(renamed.outputBehavior, "replace");
    assert.equal(renamed.enabled, false);
    assert.equal(renamed.target, "de", "untouched fields keep their values");

    const listed = (await translator.handlers.getAllTranslateCustomCommands()).commands;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const reEnabled = await translator.handlers.updateTranslateCustomCommand({ id: created.id, enabled: true });
    assert.equal(reEnabled.enabled, true);

    await translator.handlers.deleteTranslateCustomCommand({ id: created.id });
    assert.equal((await translator.handlers.getAllTranslateCustomCommands()).commands.length, 0);
    assert.throws(() => translator.handlers.deleteTranslateCustomCommand({ id: created.id }), /unknown custom command/);
    assert.throws(() => translator.handlers.updateTranslateCustomCommand({ id: "nope" }), /unknown custom command/);
    assert.ok(notifications.every((entry) => entry.method === "translator.customCommandsUpdated"));
  });
});

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

test("preferences default per the spec, persist and validate", async () => {
  await withTranslator(async (translator, notifications, directory) => {
    const defaults = await translator.handlers.getPreferences();
    assert.deepEqual(defaults, {
      primaryAction: "copy",
      prefillFromSelectedText: false,
      defaultSourceLanguage: null,
      defaultTargetLanguage: null,
    });

    await translator.handlers.setPreference({ key: "primaryAction", value: "paste" });
    await translator.handlers.setPreference({ key: "prefillFromSelectedText", value: true });
    await translator.handlers.setPreference({ key: "defaultTargetLanguage", value: "de" });

    // Reopen the store over the same data root: the settings file feeds the new instance.
    const reopened = createTranslator({ dataRoot: directory });
    const persisted = await reopened.handlers.getPreferences();
    assert.equal(persisted.primaryAction, "paste");
    assert.equal(persisted.prefillFromSelectedText, true);
    assert.equal(persisted.defaultTargetLanguage, "de");
    reopened.close();

    assert.throws(() => translator.handlers.setPreference({ key: "nope", value: 1 }), /unknown translator preference/);
    assert.throws(() => translator.handlers.setPreference({ key: "primaryAction", value: "pasted" }), /'copy' or 'paste'/);
    assert.throws(() => translator.handlers.setPreference({ key: "defaultTargetLanguage", value: "xx" }), /language code/);
    assert.throws(() => translator.handlers.setPreference({ key: "defaultSourceLanguage", value: "xx" }), /language code/);
    assert.throws(() => translator.handlers.setPreference({ key: "prefillFromSelectedText", value: "yes" }), /boolean/);
  });
});

// ---------------------------------------------------------------------------------------------
// Backend wiring — no other suite loads backend.js, so a syntax error there only ever surfaced
// as a crash loop at app startup.
// ---------------------------------------------------------------------------------------------

test("backend.js loads, registers the translator table and routes translator.* methods", async () => {
  const backend = createBackend({ pipeName: "smoke-test-pipe", apiRoot: ".", frontendRoot: ".", extensionsRoot: "." });
  backend.registerTranslatorHandler({
    getLanguages: () => ({ languages: [{ code: "en", name: "English" }] }),
  });
  const response = await backend.dispatchMessage("backend", "translator.getLanguages", {});
  assert.deepEqual(response, { languages: [{ code: "en", name: "English" }] });
});
