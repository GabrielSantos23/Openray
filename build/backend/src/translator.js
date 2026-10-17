// Translator handler — the `translator.*` table in the clone's backend.
//
// Mirrors the shipped contract (docs/translator-spec.md): the quick-translate grammar
// (`^(.*)\s+(?:in|into)\s+([^\s]+)$`, quote stripping, transliteration + lowercase, ≥ 3 chars,
// prefix match exact-first-then-shortest, 150 ms debounce on the caller), the translate call with
// the confirmed guards (`Text to be translated is empty`, `Target language is required for
// translation`) and the 10 s timeout, and the custom-command store
// (`getAllTranslateCustomCommands|saveTranslateCustomCommand|updateTranslateCustomCommand|
// deleteTranslateCustomCommand`) with the `translator:customCommandsUpdated` invalidation event.
//
// Raycast's endpoint requires a Raycast account; per the local-first rule the translator is the
// one other network-allowed feature, served here by Google's free `translate_a/single` endpoint
// behind a single swappable `translateText` function. Results are cached in memory only.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const TRANSLATE_TIMEOUT_MS = 10000; // confirmed 10 s timeout
const DEFAULT_CACHE_LIMIT = 200; // our decision: bounded in-memory LRU, no disk cache
const QUICK_TRANSLATE_PATTERN = /^(.*)\s+(?:in|into)\s+([^\s]+)$/i;

// Our decision: a curated list of the major Google-Translate-supported languages (the exact
// 133-entry shipped list was not extracted). Codes are the provider's own codes.
const LANGUAGES = [
  { code: "af", name: "Afrikaans" },
  { code: "sq", name: "Albanian" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "hy", name: "Armenian" },
  { code: "az", name: "Azerbaijani" },
  { code: "eu", name: "Basque" },
  { code: "be", name: "Belarusian" },
  { code: "bn", name: "Bengali" },
  { code: "bs", name: "Bosnian" },
  { code: "bg", name: "Bulgarian" },
  { code: "ca", name: "Catalan" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "eo", name: "Esperanto" },
  { code: "et", name: "Estonian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "gl", name: "Galician" },
  { code: "ka", name: "Georgian" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "gu", name: "Gujarati" },
  { code: "ht", name: "Haitian Creole" },
  { code: "ha", name: "Hausa" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "is", name: "Icelandic" },
  { code: "id", name: "Indonesian" },
  { code: "ga", name: "Irish" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "kn", name: "Kannada" },
  { code: "kk", name: "Kazakh" },
  { code: "km", name: "Khmer" },
  { code: "ko", name: "Korean" },
  { code: "ku", name: "Kurdish" },
  { code: "ky", name: "Kyrgyz" },
  { code: "lo", name: "Lao" },
  { code: "la", name: "Latin" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "lb", name: "Luxembourgish" },
  { code: "mk", name: "Macedonian" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam" },
  { code: "mt", name: "Maltese" },
  { code: "mi", name: "Maori" },
  { code: "mr", name: "Marathi" },
  { code: "mn", name: "Mongolian" },
  { code: "my", name: "Myanmar (Burmese)" },
  { code: "ne", name: "Nepali" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sr", name: "Serbian" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "so", name: "Somali" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Tagalog" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "uz", name: "Uzbek" },
  { code: "vi", name: "Vietnamese" },
  { code: "cy", name: "Welsh" },
  { code: "yi", name: "Yiddish" },
  { code: "yo", name: "Yoruba" },
  { code: "zu", name: "Zulu" },
];

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((language) => [language.code, language]));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS translator_custom_commands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT,
  target TEXT NOT NULL,
  output_behavior TEXT NOT NULL DEFAULT 'open',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** The confirmed transliteration: NFD strip + lowercase, so accented tokens still match. */
function normalizeToken(raw) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function languageLabel(code) {
  return LANGUAGE_BY_CODE.get(code)?.name ?? code;
}

/** The confirmed prefix match: exact language-name match first, then the shortest prefix. */
function findLanguage(token) {
  const needle = normalizeToken(token);
  if (!needle) return null;
  for (const language of LANGUAGES) {
    if (normalizeToken(language.name) === needle) return language;
  }
  let best = null;
  for (const language of LANGUAGES) {
    if (normalizeToken(language.name).startsWith(needle)) {
      if (!best || language.name.length < best.name.length) best = language;
    }
  }
  return best;
}

/** The confirmed quick-translate parser; `null` when the term does not name a language. */
function parseQuickTranslate(term) {
  const text = String(term ?? "").trim();
  if (!text) return null;
  const match = QUICK_TRANSLATE_PATTERN.exec(text);
  if (!match) return null;
  const sourceText = match[1].trim().replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").trim();
  if (!sourceText) return null;
  const token = match[2];
  if ([...token].length < 3) return null;
  const language = findLanguage(token);
  if (!language) return null;
  return { sourceText, target: language.code, targetLabel: language.name };
}

function createTranslator({ pushToFrontend, dataRoot, fetchImpl, now = () => Date.now(), cacheLimit = DEFAULT_CACHE_LIMIT } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  const databasePath = path.join(root, "translator.sqlite");
  const settingsPath = path.join(root, "translator-settings.json");
  const fetchJson = fetchImpl ?? ((url, init) => fetch(url, init));

  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA);

  const DEFAULT_PREFERENCES = {
    primaryAction: "copy",
    prefillFromSelectedText: false,
    defaultSourceLanguage: null,
    defaultTargetLanguage: null,
  };
  const preferences = { ...DEFAULT_PREFERENCES };
  try {
    Object.assign(preferences, JSON.parse(fs.readFileSync(settingsPath, "utf-8")));
  } catch {
    /* first run keeps the defaults */
  }

  const cache = new Map();

  function cacheGet(key) {
    if (!cache.has(key)) return null;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  function notifyCustomCommandsChanged() {
    if (typeof pushToFrontend === "function") {
      Promise.resolve(pushToFrontend("translator.customCommandsUpdated", {})).catch(() => undefined);
    }
  }

  function persistPreferences() {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(preferences, null, 2));
    } catch (error) {
      console.error("[translator] could not persist preferences", error);
    }
  }

  /**
   * The provider call. The shipped app posts to its own translation endpoint;
   * that endpoint needs a Raycast account, so the free Google endpoint stands in behind this one
   * swappable function. Response shape: `[[["Hola","hello",…],…], null, "es", …]`.
   */
  async function translateText(text, source, target) {
    const url =
      `${TRANSLATE_URL}?client=gtx&dt=t&sl=${encodeURIComponent(source)}` +
      `&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text)}`;
    const response = await fetchJson(url, { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`translation endpoint returned ${response.status}`);
    const payload = await response.json();
    const segments = Array.isArray(payload?.[0])
      ? payload[0].map((segment) => (Array.isArray(segment) ? segment[0] : "")).filter(Boolean)
      : [];
    const translatedText = segments.join("");
    if (!translatedText) throw new Error("translation endpoint returned no text");
    const detected = typeof payload?.[2] === "string" && payload[2] ? payload[2] : null;
    return { translatedText, detectedSourceLanguage: detected };
  }

  /** The translate call with the confirmed guards, cache and outcome-only logging. */
  async function translate({ text, source = "auto", target } = {}) {
    const value = String(text ?? "");
    if (!value.trim()) return { status: "failed", error: "Text to be translated is empty" };
    if (!target) return { status: "failed", error: "Target language is required for translation" };
    const requestedSource = source === "auto" || !source ? "auto" : String(source);
    const key = `${requestedSource}|${target}|${value}`;
    const cached = cacheGet(key);
    if (cached) return { ...cached, fromCache: true };
    const startedAt = now();
    try {
      const { translatedText, detectedSourceLanguage } = await translateText(value, requestedSource, target);
      const result = {
        status: "ready",
        translatedText,
        detectedSourceLanguage,
        sourceLabel: requestedSource === "auto" ? (detectedSourceLanguage ? languageLabel(detectedSourceLanguage) : null) : languageLabel(requestedSource),
        targetLabel: languageLabel(target),
      };
      cacheSet(key, result);
      console.log(
        `[translator] translated ${value.length} chars ${requestedSource}->${target} ok in ${now() - startedAt}ms`,
      );
      return { ...result, fromCache: false };
    } catch (error) {
      console.log(`[translator] translate ${requestedSource}->${target} failed after ${now() - startedAt}ms: ${error.message}`);
      return { status: "failed", error: error.message };
    }
  }

  function customCommandRows() {
    return db
      .prepare("SELECT * FROM translator_custom_commands ORDER BY created_at ASC")
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source ?? null,
        target: row.target,
        sourceLabel: row.source ? languageLabel(row.source) : null,
        targetLabel: languageLabel(row.target),
        outputBehavior: row.output_behavior === "replace" ? "replace" : "open",
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  function autoCommandName(source, target) {
    return source && source !== "auto"
      ? `Translate ${languageLabel(source)} to ${languageLabel(target)}`
      : `Translate to ${languageLabel(target)}`;
  }

  const handlers = {
    parseQuickTranslate({ term } = {}) {
      const match = parseQuickTranslate(term);
      return match ? { matched: true, ...match } : { matched: false };
    },

    quickTranslate({ term } = {}) {
      const match = parseQuickTranslate(term);
      if (!match) return Promise.resolve({ matched: false });
      return translate({ text: match.sourceText, source: "auto", target: match.target }).then((result) => ({
        matched: true,
        ...match,
        ...result,
      }));
    },

    translate({ text, source, target } = {}) {
      return translate({ text, source, target });
    },

    getLanguages() {
      return { languages: LANGUAGES };
    },

    getPreferences() {
      return { ...preferences };
    },

    setPreference({ key, value } = {}) {
      if (key === "primaryAction") {
        if (value !== "copy" && value !== "paste") throw new Error("primaryAction must be 'copy' or 'paste'");
      } else if (key === "prefillFromSelectedText") {
        if (typeof value !== "boolean") throw new Error("prefillFromSelectedText must be a boolean");
      } else if (key === "defaultSourceLanguage") {
        if (value !== null && value !== "auto" && !LANGUAGE_BY_CODE.has(value)) {
          throw new Error("defaultSourceLanguage must be null, 'auto' or a language code");
        }
      } else if (key === "defaultTargetLanguage") {
        if (value !== null && !LANGUAGE_BY_CODE.has(value)) {
          throw new Error("defaultTargetLanguage must be null or a language code");
        }
      } else {
        throw new Error(`unknown translator preference '${key}'`);
      }
      preferences[key] = value;
      persistPreferences();
      return { ...preferences };
    },

    getAllTranslateCustomCommands() {
      return { commands: customCommandRows() };
    },

    saveTranslateCustomCommand({ name, source, target, outputBehavior } = {}) {
      if (!target || !LANGUAGE_BY_CODE.has(target)) {
        throw new Error("Target language is required for translation");
      }
      if (source && source !== "auto" && !LANGUAGE_BY_CODE.has(source)) {
        throw new Error(`unknown source language '${source}'`);
      }
      const behavior = outputBehavior === "replace" ? "replace" : "open";
      const timestamp = now();
      const id = `translate_${timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(
        `INSERT INTO translator_custom_commands (id, name, source, target, output_behavior, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(id, String(name ?? "").trim() || autoCommandName(source, target), source ?? null, target, behavior, timestamp, timestamp);
      notifyCustomCommandsChanged();
      return customCommandRows().find((row) => row.id === id);
    },

    updateTranslateCustomCommand({ id, name, source, target, outputBehavior, enabled } = {}) {
      const existing = customCommandRows().find((row) => row.id === id);
      if (!existing) throw new Error("unknown custom command");
      const nextSource = source === undefined ? existing.source : source;
      const nextTarget = target === undefined ? existing.target : target;
      if (!nextTarget || !LANGUAGE_BY_CODE.has(nextTarget)) {
        throw new Error("Target language is required for translation");
      }
      if (nextSource && nextSource !== "auto" && !LANGUAGE_BY_CODE.has(nextSource)) {
        throw new Error(`unknown source language '${nextSource}'`);
      }
      db.prepare(
        `UPDATE translator_custom_commands
         SET name = ?, source = ?, target = ?, output_behavior = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        String(name ?? existing.name).trim() || existing.name,
        nextSource ?? null,
        nextTarget,
        outputBehavior === "replace" || outputBehavior === "open" ? outputBehavior : existing.outputBehavior,
        enabled === undefined ? (existing.enabled ? 1 : 0) : enabled ? 1 : 0,
        now(),
        id,
      );
      notifyCustomCommandsChanged();
      return customCommandRows().find((row) => row.id === id);
    },

    deleteTranslateCustomCommand({ id } = {}) {
      const info = db.prepare("DELETE FROM translator_custom_commands WHERE id = ?").run(String(id ?? ""));
      if (info.changes === 0) throw new Error("unknown custom command");
      notifyCustomCommandsChanged();
      return { deleted: true };
    },
  };

  return {
    handlers,
    parseQuickTranslate,
    translate,
    customCommandRows,
    close() {
      db.close();
    },
  };
}

module.exports = {
  createTranslator,
  LANGUAGES,
  parseQuickTranslate,
  normalizeToken,
  QUICK_TRANSLATE_PATTERN,
  TRANSLATE_TIMEOUT_MS,
  DEFAULT_CACHE_LIMIT,
};
