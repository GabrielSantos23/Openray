// Games client (docs/focus-games-taskbar-spec.md §B) — the `games.*` backend namespace plus the
// launcher-vs-game classification the Game Launcher view ships (executable set and name set,
// both verbatim from the shipped view).

import { ipc } from "./ipc";
import type { ApplicationPayload } from "./applications";

export type GamePayload = ApplicationPayload & { isGame?: boolean; hidden?: boolean };

export interface GameSettings {
  gameModeEnabled: boolean;
}

export function listGames(): Promise<{ games: GamePayload[] }> {
  return ipc.backend("games.list", {}, { module: "backend" }) as Promise<{ games: GamePayload[] }>;
}

export function getGameFlags(): Promise<{ games: Record<string, boolean>; hidden: Record<string, boolean> }> {
  return ipc.backend("games.getFlags", {}, { module: "backend" }) as Promise<{ games: Record<string, boolean>; hidden: Record<string, boolean> }>;
}

export function markAsGame(id: string): Promise<unknown> {
  return ipc.backend("games.markAsGame", { id }, { module: "backend" });
}

export function markAsApplication(id: string): Promise<unknown> {
  return ipc.backend("games.markAsApplication", { id }, { module: "backend" });
}

export function hideGame(id: string): Promise<unknown> {
  return ipc.backend("games.hideGame", { id }, { module: "backend" });
}

export function getGameSettings(): Promise<GameSettings> {
  return ipc.backend("games.getSettings", {}, { module: "backend" }) as Promise<GameSettings>;
}

export function setGameMode(enabled: boolean): Promise<GameSettings> {
  return ipc.backend("games.setGameMode", { enabled }, { module: "backend" }) as Promise<GameSettings>;
}

/** Launcher executables the shipped Game Launcher view classifies by. */
export const LAUNCHER_EXECUTABLES: ReadonlySet<string> = new Set([
  "steam.exe",
  "epicgameslauncher.exe",
  "galaxyclient.exe",
  "ubisoftconnect.exe",
  "battle.net launcher.exe",
  "eadesktop.exe",
  "itch.exe",
  "riotclientservices.exe",
  "bsglauncher.exe",
  "geforcenow.exe",
]);

/** Launcher display names the shipped view classifies by (substring match on the game name). */
export const LAUNCHER_NAMES: ReadonlyArray<string> = [
  "battle.net",
  "steam",
  "epic games launcher",
  "gog galaxy",
  "ubisoft connect",
  "xbox",
  "riot client",
  "ea app",
  "ea desktop",
  "itch",
  "geforce now",
];

/** `Suggestions` are the first five games with an empty query (confirmed). */
export const SUGGESTIONS_COUNT = 5;

export function executableName(path: string | null | undefined): string {
  if (!path) return "";
  return (path.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase();
}

export function isGameLauncher(game: GamePayload): boolean {
  const exe = executableName(game.path);
  if (LAUNCHER_EXECUTABLES.has(exe)) return true;
  const name = game.name.toLowerCase();
  return LAUNCHER_NAMES.some((launcher) => name.includes(launcher));
}

/** Splits the game list into the three confirmed sections for an empty query. */
export function partitionGames(games: GamePayload[]): { suggestions: GamePayload[]; games: GamePayload[]; launchers: GamePayload[] } {
  const launchers = games.filter(isGameLauncher);
  const plainGames = games.filter((game) => !isGameLauncher(game));
  return { suggestions: plainGames.slice(0, SUGGESTIONS_COUNT), games: plainGames, launchers };
}

export function filterGames(games: GamePayload[], query: string): GamePayload[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const terms = trimmed.split(/\s+/);
  return games.filter((game) => {
    const haystack = [game.name, game.path ?? "", game.bundleId ?? ""].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
