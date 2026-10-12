// Game Launcher view (docs/focus-games-taskbar-spec.md §B): the confirmed search surface over the
// flagged-application index — sections Suggestions/Games/Game Launchers with an empty query,
// Results while searching, the confirmed empty states, and the implemented action set (Open,
// Run as Administrator, Show in File Explorer, Copy Path/Name, Treat as Application, Hide Game).

import { useEffect, useMemo, useState } from "react";
import { RaycastIcon } from "../../icons";
import { ipc } from "../../ipc";
import {
  filterGames,
  listGames,
  markAsApplication,
  hideGame,
  partitionGames,
  type GamePayload,
} from "../../games";

type FocusToasts = (title: string, message?: string) => void;

interface GameRow {
  key: string;
  game: GamePayload;
  section: string;
}

export function GameLauncherView({
  showToast,
  onBack,
  closeMainWindow,
}: {
  showToast: FocusToasts;
  onBack: () => void;
  closeMainWindow: () => void;
}) {
  const [query, setQuery] = useState("");
  const [games, setGames] = useState<GamePayload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const refresh = () => {
    listGames()
      .then((result) => {
        setGames(result.games);
        setError(null);
      })
      .catch((reason) => {
        setGames([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  useEffect(refresh, []);

  const searching = query.trim().length > 0;
  const rows = useMemo<GameRow[]>(() => {
    if (games === null) return [];
    if (searching) {
      return filterGames(games, query).map((game) => ({ key: game.id, game, section: "Results" }));
    }
    const partitioned = partitionGames(games);
    return [
      ...partitioned.suggestions.map((game) => ({ key: `s:${game.id}`, game, section: "Suggestions" })),
      ...partitioned.games.map((game) => ({ key: `g:${game.id}`, game, section: "Games" })),
      ...partitioned.launchers.map((game) => ({ key: `l:${game.id}`, game, section: "Game Launchers" })),
    ];
  }, [games, searching, query]);

  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  const openGame = (game: GamePayload) => {
    void ipc.backend("applications.open", { id: game.id }, { module: "backend" }).catch(() => undefined);
    closeMainWindow();
  };

  const copyContent = async (game: GamePayload, verb: "copyPath" | "copyName") => {
    const result = (await ipc.backend(`applications.${verb}`, { id: game.id }, { module: "backend" })) as { content?: string };
    if (result?.content) {
      await ipc.backend("clipboard.write", { content: result.content }, { module: "backend" });
      showToast("Copied to clipboard", result.content);
    }
  };

  const runGameAction = (game: GamePayload, action: string) => {
    switch (action) {
      case "open":
        openGame(game);
        return;
      case "runAsAdministrator":
        void ipc.backend("applications.runAsAdministrator", { id: game.id }, { module: "backend" }).catch(() => undefined);
        closeMainWindow();
        return;
      case "reveal":
        void ipc.backend("applications.reveal", { id: game.id }, { module: "backend" }).catch(() => undefined);
        return;
      case "copyPath":
      case "copyName":
        void copyContent(game, action);
        return;
      case "treatAsApplication":
        void markAsApplication(game.id).then(() => {
          showToast("Marked as application", game.name);
          refresh();
        });
        return;
      case "hide":
        void hideGame(game.id).then(() => {
          showToast("Hidden Game", game.name);
          setSelectedKey(null);
          refresh();
        });
        return;
      default:
        return;
    }
  };

  const runPrimary = () => {
    if (selected) openGame(selected.game);
  };

  const sections = useMemo(() => {
    const map = new Map<string, GameRow[]>();
    for (const row of rows) {
      const list = map.get(row.section) ?? [];
      list.push(row);
      map.set(row.section, list);
    }
    return [...map.entries()];
  }, [rows]);

  const emptyState = error
    ? { title: "Unable to Load Games", description: error }
    : games !== null && games.length === 0
      ? { title: "No Games Found", description: "Flag an application as a game to see it here." }
      : games !== null && rows.length === 0 && searching
        ? { title: "No Results", description: "Try a different search term." }
        : null;

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="searchbar">
          <input
            className="searchbar__input"
            autoFocus
            value={query}
            placeholder="Search games…"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedKey(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runPrimary();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const ids = rows.map((row) => row.key);
                const index = selectedKey ? ids.indexOf(selectedKey) : -1;
                const next = event.key === "ArrowDown" ? Math.min(index + 1, ids.length - 1) : Math.max(index - 1, 0);
                setSelectedKey(ids[next] ?? null);
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
        </div>
      </header>

      <main className="window__body" style={{ padding: 0 }}>
        {emptyState ? (
          <div className="state">
            <div className="state__title">{emptyState.title}</div>
            <div className="state__message">{emptyState.description}</div>
          </div>
        ) : (
          <ul className="list">
            {sections.map(([title, sectionRows]) => (
              <li key={title} className="list__section">
                <div className="list__sectionHeader">
                  <span className="list__sectionTitle">{title}</span>
                  <span className="list__sectionCount">{sectionRows.length}</span>
                </div>
                <ul className="list__sectionBody">
                  {sectionRows.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        className="list__row"
                        data-selected={selected?.key === row.key}
                        onClick={() => setSelectedKey(row.key)}
                        onDoubleClick={() => openGame(row.game)}
                      >
                        <span className="icon" aria-hidden>
                          <RaycastIcon name="game-controller" size={16} />
                        </span>
                        <span className="list__text">
                          <span className="list__title">{row.game.name}</span>
                          {row.game.path ? <span className="list__subtitle">{row.game.path}</span> : null}
                        </span>
                        <span className="list__accessory">
                          <span className="pill">Game</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="window__footer">
        <button type="button" className="footer-icon-button" aria-label="Back" onClick={onBack}>
          <RaycastIcon name="arrow-clockwise" size={16} />
        </button>
        <span className="games-footer__label">Game Launcher</span>
        <span className="footer__spacer" />
        <button type="button" className="footer-action footer-action--kbd" onClick={runPrimary} disabled={!selected}>
          Open Game <span className="kbd">Enter</span>
        </button>
        {selected ? (
          <>
            <button type="button" className="footer-action" onClick={() => runGameAction(selected.game, "runAsAdministrator")}>
              Run as Administrator
            </button>
            <button type="button" className="footer-action" onClick={() => runGameAction(selected.game, "reveal")}>
              Show in File Explorer
            </button>
            <button type="button" className="footer-action" onClick={() => runGameAction(selected.game, "copyPath")}>
              Copy Path
            </button>
            <button type="button" className="footer-action" onClick={() => runGameAction(selected.game, "copyName")}>
              Copy Name
            </button>
            <button type="button" className="footer-action" onClick={() => runGameAction(selected.game, "treatAsApplication")}>
              Treat as Application
            </button>
            <button type="button" className="footer-action" onClick={() => runGameAction(selected.game, "hide")}>
              Hide Game
            </button>
          </>
        ) : null}
      </footer>
    </div>
  );
}
