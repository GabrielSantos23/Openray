// Games handler — the `games.*` namespace (docs/focus-games-taskbar-spec.md §B).
//
// The shipped classification marks app-index entries with content-type bit 2048 as games
// (`setUserContentType(instanceId, AppIndexContentType.Game)`); the user-facing actions are
// `mark-as-game` / `mark-as-application` with the `Marked as game` / `Marked as application`
// toasts. The clone keeps the same semantics over the host's application list: flags live in a
// JSON store keyed by application id, `games.list` merges them onto `applications.getAll`, and
// `games.setGameMode` forwards the Game Mode toggle to the host's fullscreen watch.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = { gameModeEnabled: false };

function createGames({ dispatch, dataRoot } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini");
  const flagsPath = path.join(root, "game-flags.json");
  const settingsPath = path.join(root, "games-settings.json");

  fs.mkdirSync(root, { recursive: true });

  let flags = { games: {}, hidden: {} };
  try {
    const stored = JSON.parse(fs.readFileSync(flagsPath, "utf-8"));
    if (stored && typeof stored === "object") {
      flags = { games: stored.games ?? {}, hidden: stored.hidden ?? {} };
    }
  } catch {
    /* first run keeps empty flags */
  }

  let settings = { ...DEFAULT_SETTINGS };
  try {
    Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath, "utf-8")));
  } catch {
    /* first run keeps the defaults */
  }

  function persistFlags() {
    try {
      fs.writeFileSync(flagsPath, JSON.stringify(flags, null, 2));
    } catch (error) {
      console.error("[games] could not persist flags", error);
    }
  }

  function persistSettings() {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error("[games] could not persist settings", error);
    }
  }

  function setFlag(id, value) {
    const key = String(id ?? "").trim();
    if (key === "") throw new Error("Application id is required");
    if (value) flags.games[key] = true;
    else delete flags.games[key];
    persistFlags();
    return { id: key, isGame: Boolean(value) };
  }

  function hostCall(method, data) {
    if (typeof dispatch !== "function") return;
    Promise.resolve(dispatch(method, data)).catch((error) => console.error(`[games] ${method} failed`, error));
  }

  const handlers = {
    getFlags: () => ({ games: { ...flags.games }, hidden: { ...flags.hidden } }),
    getSettings: () => ({ ...settings }),
    list: async () => {
      if (typeof dispatch !== "function") return { games: [] };
      const response = await dispatch("applications.getAll", {});
      const applications = (response?.value ?? []).map((payload) => ({
        ...payload,
        // The host classifies games by install location; the JSON flags hold manual overrides.
        isGame: Boolean(flags.games[payload.id]) || Boolean(payload.isGame),
        hidden: Boolean(flags.hidden[payload.id]),
      }));
      return { games: applications.filter((payload) => payload.isGame && !payload.hidden) };
    },
    markAsGame: (data) => setFlag(data?.id, true),
    markAsApplication: (data) => setFlag(data?.id, false),
    hideGame: (data) => {
      const id = String(data?.id ?? "").trim();
      if (id === "") throw new Error("Application id is required");
      flags.hidden[id] = true;
      persistFlags();
      return { ok: true };
    },
    setGameMode: (data) => {
      settings.gameModeEnabled = data?.enabled === true;
      persistSettings();
      hostCall("games.setGameMode", { enabled: settings.gameModeEnabled });
      return { ...settings };
    },
  };

  return {
    handlers,
    /** Applied at backend start so a previously enabled Game Mode survives restarts. */
    pushSettingsToHost() {
      hostCall("games.setGameMode", { enabled: settings.gameModeEnabled });
    },
  };
}

module.exports = { createGames };
