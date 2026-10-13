// The compatibility classifier (docs/store-implementation-plan.md §1.5).
//
// Static, three levels, per command entry point:
//   1. manifest level — extension/command platforms, command mode, `interval`;
//   2. source level  — unsupported `@raycast/api` / `@raycast/utils` markers in the command's
//      bundle output (the bundler never minifies, so call sites keep their names) plus the
//      original entry source;
//   3. guard level   — `environment.canAccess(<family>)` in the same source marks that family's
//      usage optional: the command stays enabled and the runtime answers `false` (store-spec §5,
//      the real app's behavior).
//
// Tools are ignored entirely (policy D6) — the caller never hands them here.

"use strict";

/**
 * Bump whenever docs/api-coverage.md changes what the classifier should treat as unsupported, so
 * installed extensions recompute at startup and commands re-enable themselves when we implement
 * an API.
 */
const COVERAGE_VERSION = 1;

/** A command class: compatible, or disabled with the level that disabled it. */
const COMMAND_CLASSES = ["compatible", "disabled-manifest", "disabled-api", "disabled-mode"];

const EXTENSION_BADGES = {
  none: null,
  someFeaturesUnavailable: "some features unavailable",
  requiresUnsupportedApis: "requires unsupported APIs",
};

/**
 * Unsupported call markers. `reason` is the one-line reason shown in the Store and root search.
 * `guardable` families can be used behind `environment.canAccess(...)` and stay enabled.
 */
const UNSUPPORTED_MARKERS = [
  { api: "AI.ask", pattern: /\bAI\s*\.\s*ask\b/, reason: "Requires Raycast AI, not supported", guardable: "AI" },
  { api: "AI.askText", pattern: /\bAI\s*\.\s*askText\b/, reason: "Requires Raycast AI, not supported", guardable: "AI" },
  { api: "unstable_AI", pattern: /\buseUnstableAI\b|\bunstable_AI\b|\buseUnstableObjectGeneration\b/, reason: "Requires Raycast AI, not supported", guardable: "AI" },
  { api: "OAuth", pattern: /\bOAuth\s*\.|\bPKCEClient\b|\buseOAuth\b/, reason: "Requires OAuth, not supported", guardable: "OAuth" },
  { api: "WindowManagement", pattern: /\bWindowManagement\s*\./, reason: "Requires Window Management, not supported", guardable: "WindowManagement" },
  { api: "BrowserExtension", pattern: /\bBrowserExtension\s*\./, reason: "Requires the Raycast browser extension, not supported", guardable: "BrowserExtension" },
  { api: "MenuBarExtra", pattern: /\bMenuBarExtra\b/, reason: "Menu bar commands are not supported", guardable: null },
  { api: "AppleScript", pattern: /\brunAppleScript\b|\bosascript\b/, reason: "Requires AppleScript (macOS), not supported", guardable: null },
  { api: "getSelectedFinderItems", pattern: /\bgetSelectedFinderItems\b/, reason: "Requires Finder (macOS), not supported", guardable: null },
  { api: "Action.PickDate", pattern: /\bAction\s*\.\s*PickDate\b/, reason: "Date picker action is not supported", guardable: null },
  { api: "captureMemorySnapshot", pattern: /\bcaptureMemorySnapshot\b/, reason: "Memory snapshots are not supported", guardable: null },
  { api: "useActionPanel", pattern: /\buseActionPanel\b/, reason: "The action panel hook is not supported", guardable: null },
  { api: "getSelectedText", pattern: /\bgetSelectedText\b/, reason: "Reading selected text is not supported in Raycast Mini", guardable: null },
  { api: "getFrontmostApplication", pattern: /\bgetFrontmostApplication\b/, reason: "Reading the frontmost application is not supported in Raycast Mini", guardable: null },
  { api: "useAI", pattern: /from\s+["']@raycast\/utils["'][^\0]*\buseAI\b|\buseAI\s*\(/, reason: "Requires Raycast AI, not supported", guardable: "AI" },
];

/** `canAccess(...)` mentioning a guardable family marks that family optional. */
function detectGuards(sourceText) {
  const guarded = new Set();
  if (!sourceText) return guarded;
  for (const marker of UNSUPPORTED_MARKERS) {
    if (!marker.guardable) continue;
    const escaped = marker.guardable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const guard = new RegExp(`canAccess\\s*\\(\\s*[^)]{0,80}\\b${escaped}\\b`);
    if (guard.test(sourceText)) guarded.add(marker.guardable);
  }
  return guarded;
}

/** Scan one text blob; returns the markers whose api was hit and not guarded. */
function scanUnsupported(text, guarded) {
  const hits = new Map();
  if (!text) return hits;
  for (const marker of UNSUPPORTED_MARKERS) {
    if (marker.guardable && guarded.has(marker.guardable)) continue;
    if (marker.pattern.test(text)) hits.set(marker.api, marker.reason);
  }
  return hits;
}

/**
 * Classify one command. `entrySource` is the original entry file text; `bundleSource` is the
 * bundled output text (both optional but at least one should be present).
 */
function classifyCommand({ command, entrySource, bundleSource }) {
  const mode = command.mode ?? "view";

  // Manifest level first — the cheapest signals decide without any source scan.
  if (mode === "menu-bar") {
    return { class: "disabled-mode", missingApis: [], guardedApis: [], reason: "Menu bar commands are not supported", mode };
  }
  if (command.interval) {
    return { class: "disabled-manifest", missingApis: [], guardedApis: [], reason: "Background refresh (interval) is not supported", mode };
  }
  if (Array.isArray(command.platforms) && command.platforms.length > 0 && !command.platforms.includes("Windows")) {
    return { class: "disabled-manifest", missingApis: [], guardedApis: [], reason: `${command.title ?? command.name} is not available on Windows`, mode };
  }
  if (!entrySource && !bundleSource) {
    return { class: "disabled-manifest", missingApis: [], guardedApis: [], reason: "Command entry point not found", mode };
  }

  // Guard level: a canAccess mention keeps that family's usage optional.
  const guarded = detectGuards(entrySource);
  for (const api of detectGuards(bundleSource)) guarded.add(api);

  // Source level: unsupported calls across the entry source and the bundle output.
  const hits = scanUnsupported(entrySource, guarded);
  for (const [api, reason] of scanUnsupported(bundleSource, guarded)) hits.set(api, reason);

  if (hits.size === 0) {
    return { class: "compatible", missingApis: [], guardedApis: [...guarded], reason: null, mode };
  }
  const missingApis = [...hits.keys()];
  const reasons = [...new Set(hits.values())];
  const reason = reasons.length === 1 ? reasons[0] : `Requires ${missingApis.join(", ")}, not supported`;
  return { class: "disabled-api", missingApis, guardedApis: [...guarded], reason, mode };
}

/**
 * Classify a whole extension from its manifest and per-command scan inputs.
 * `commands` entries: `{ command: manifestCommand, entrySource, bundleSource }`.
 * Tools entries in `manifest.tools` are ignored (policy D6).
 */
function classifyExtension({ manifest, commands }) {
  const commandClassifications = {};
  for (const { command, entrySource, bundleSource } of commands) {
    commandClassifications[command.name] = classifyCommand({ command, entrySource, bundleSource });
  }
  const names = Object.keys(commandClassifications);
  const compatible = names.filter((name) => commandClassifications[name].class === "compatible");
  const installable = compatible.length > 0;
  let badge = EXTENSION_BADGES.none;
  if (!installable && names.length > 0) badge = EXTENSION_BADGES.requiresUnsupportedApis;
  else if (compatible.length < names.length) badge = EXTENSION_BADGES.someFeaturesUnavailable;
  return {
    installable,
    badge,
    commands: commandClassifications,
  };
}

module.exports = {
  COVERAGE_VERSION,
  EXTENSION_BADGES,
  UNSUPPORTED_MARKERS,
  classifyCommand,
  classifyExtension,
};
