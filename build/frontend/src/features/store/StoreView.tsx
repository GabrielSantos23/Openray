// The extension Store (build/backend/src/store/ is its backend): a browse list over the synced
// GitHub catalog plus locally uploaded FlowKey extensions, and the Raycast-style detail page —
// hero (icon, title, author, categories, Installed badge), screenshots carousel, Description +
// Commands on the left, README / Last update / Contributors on the right. The footer's primary
// action is Install while the extension is not installed and Open Commands… once it is.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { CommandFooter } from "../../commandChrome";
import { RaycastIcon } from "../../icons";
import { LoadingBar } from "../../LoadingBar";
import { ipc } from "../../ipc";
import {
  cachedStoreIcon,
  fetchStoreDetail,
  fetchStoreList,
  fetchStoreScreenshot,
  fetchStoreStatus,
  importStoreExtension,
  installStoreExtension,
  launchStoreCommand,
  startStoreSync,
  type StoreDetail,
  type StoreEntry,
  type StoreIconResult,
  type StoreStatus,
} from "./storeApi";
import "./store.css";

type StorePage =
  | { kind: "list" }
  | { kind: "detail"; entry: StoreEntry }
  | { kind: "commands"; detail: StoreDetail };

function entryFromDetail(detail: StoreDetail): StoreEntry {
  return {
    source: detail.source,
    name: detail.name,
    title: detail.title,
    description: detail.description,
    author: detail.author,
    categories: detail.categories,
    icon: null,
    contributors: detail.contributors,
    installed: detail.installed,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** <img> with a graceful fallback to the first letter when the avatar fails to load. */
function Avatar({ user, size = 16 }: { user: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !user) {
    return (
      <span className="store-avatar store-avatar--fallback" style={{ width: size, height: size }}>
        {(user || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="store-avatar"
      src={`https://github.com/${encodeURIComponent(user)}.png?size=40`}
      width={size}
      height={size}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function InstalledBadge({ installed }: { installed: boolean }) {
  if (!installed) return null;
  return (
    <span className="store-installed">
      <RaycastIcon name="Checkmark" size={12} /> Installed
    </span>
  );
}

/** Extension icon with the store's per-session cache; falls back to the declared emoji, then the glyph. */
function StoreIcon({ name, source, size }: { name: string; source: "github" | "uploaded"; size: number }) {
  const [icon, setIcon] = useState<StoreIconResult | null>(null);
  useEffect(() => {
    let alive = true;
    void cachedStoreIcon(name, source).then((value) => {
      if (alive) setIcon(value);
    });
    return () => {
      alive = false;
    };
  }, [name, source]);
  if (icon?.icon) {
    return <img className="store-icon" src={icon.icon} width={size} height={size} alt="" />;
  }
  if (icon?.emoji) {
    return (
      <span className="store-icon store-icon--emoji" style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }} aria-hidden>
        {icon.emoji}
      </span>
    );
  }
  return (
    <span className="store-icon store-icon--fallback" style={{ width: size, height: size }} aria-hidden>
      <RaycastIcon name="extension" size={Math.round(size * 0.58)} />
    </span>
  );
}

/** GitHub screenshot, downloaded through the backend and cached on disk. */
function Screenshot({ name, screenshotPath }: { name: string; screenshotPath: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (/^file:|^https?:|^data:/.test(screenshotPath)) {
      setUri(screenshotPath);
      return;
    }
    void fetchStoreScreenshot(name, screenshotPath)
      .then((value) => {
        if (alive) setUri(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [name, screenshotPath]);
  if (!uri) return <div className="store-screenshot store-screenshot--loading" />;
  return <img className="store-screenshot" src={uri} alt="" loading="lazy" />;
}

export function StoreView({
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
}: {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState<StorePage>({ kind: "list" });
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [entries, setEntries] = useState<StoreEntry[]>([]);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [installing, setInstalling] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [listIndex, setListIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Default browse list: what can actually run here (uploads + installed). The unported
  // Raycast-only catalog (~3.4k entries) is opt-in so it doesn't drown out the working store.
  const [showAll, setShowAll] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(async (query: string, all = showAll) => {
    try {
      const payload = await fetchStoreList(query, 0, null, all);
      setEntries(payload.extensions);
      setHasMore(payload.hasMore);
      setListIndex(0);
    } catch {
      setEntries([]);
      setHasMore(false);
    }
  }, [showAll]);

  // Scroll sentinel: the catalog is ~3.4k entries — render page by page as the user scrolls so
  // neither the DOM nor the icon fetches explode.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || pageRef.current.kind !== "list") return;
    setLoadingMore(true);
    try {
      const payload = await fetchStoreList(searchText, entries.length, null, showAll);
      setEntries((current) => [...current, ...payload.extensions]);
      setHasMore(payload.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, searchText, entries.length, showAll]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || page.kind !== "list") return;
    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries.some((observerEntry) => observerEntry.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [page.kind, loadMore]);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchStoreStatus();
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  // First open: kick a catalog sync if the store was never synced, show whatever is cached, and
  // poll until no sync is running — then read the index once more.
  useEffect(() => {
    let alive = true;
    let interval: number | null = null;
    const boot = async () => {
      const initial = await refreshStatus();
      if (!alive || !initial) return;
      if (initial.phase === "never") void startStoreSync().catch(() => undefined);
      if (!initial.running) void refreshList(searchText);
      interval = window.setInterval(async () => {
        const polled = await refreshStatus();
        if (!alive || !polled || polled.running) return;
        if (interval) window.clearInterval(interval);
        interval = null;
        void refreshList(searchText);
        if (polled.error) showToast("Store sync finished with errors", polled.error);
        else if (polled.phase === "done") showToast("Store catalog synced", `${polled.extensionCount} extensions from GitHub`);
      }, 1500);
    };
    void boot();
    return () => {
      alive = false;
      if (interval) window.clearInterval(interval);
    };
    // Mount-only: the poll loop owns its own lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-query as the user types (the input is the session search bar) and when the scope toggles.
  useEffect(() => {
    if (status?.running) return;
    const handle = window.setTimeout(() => void refreshList(searchText), 150);
    return () => window.clearTimeout(handle);
  }, [searchText, status?.running, refreshList]);

  const openDetail = useCallback(
    async (entry: StoreEntry) => {
      setPage({ kind: "detail", entry });
      onSearchTextChange("");
      setDetail(null);
      try {
        const next = await fetchStoreDetail(entry.name, entry.source);
        setDetail(next);
      } catch (error) {
        showToast("Could not open extension", error instanceof Error ? error.message : String(error));
        setPage({ kind: "list" });
      }
    },
    [onSearchTextChange, showToast],
  );

  const install = useCallback(
    async (target: { name: string; source: "github" | "uploaded" }) => {
      setInstalling(true);
      try {
        const result = await installStoreExtension(target.name, target.source);
        showToast(
          "Installed",
          result.runnable ? `${target.name} is ready in root search` : `${target.name} source staged — port to FlowKey pending`,
        );
        setDetail((current) =>
          current && current.name === target.name ? { ...current, installed: true, runnable: result.runnable } : current,
        );
        setEntries((current) =>
          current.map((entry) =>
            entry.name === target.name && entry.source === target.source ? { ...entry, installed: true } : entry,
          ),
        );
      } catch (error) {
        showToast("Install failed", error instanceof Error ? error.message : String(error));
      } finally {
        setInstalling(false);
      }
    },
    [showToast],
  );

  const goBack = useCallback(() => {
    const current = pageRef.current;
    if (current.kind === "list") onBack();
    else if (current.kind === "commands") setPage({ kind: "detail", entry: entryFromDetail(current.detail) });
    else setPage({ kind: "list" });
  }, [onBack]);

  // Escape walks back through the pages; Ctrl+K toggles the store's action panel.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPanelOpen((open) => !open);
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      goBack();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [goBack]);

  // List keyboard: arrows + Enter while the search input keeps focus, like root search.
  const onListKeyDown = (event: ReactKeyboardEvent) => {
    if (page.kind !== "list") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setListIndex((index) => Math.min(index + 1, Math.max(entries.length - 1, 0)));
      if (listIndex >= entries.length - 5) void loadMore();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setListIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const entry = entries[listIndex];
      if (entry) void openDetail(entry);
    }
  };

  const runSync = useCallback(async () => {
    const result = await startStoreSync().catch(() => null);
    if (result?.started) showToast("Syncing store catalog…", "Downloading every extension from GitHub");
    await refreshStatus();
  }, [showToast, refreshStatus]);

  const runImport = useCallback(async () => {
    try {
      const name = await importStoreExtension();
      if (name) {
        showToast("Extension published", `${name} is now in the Store`);
        void refreshList(searchText);
      }
    } catch (error) {
      showToast("Import failed", error instanceof Error ? error.message : String(error));
    }
  }, [showToast, refreshList, searchText]);

  const runInstallIfOpen = useCallback(() => {
    if (!detail) return;
    if (!detail.installed) void install({ name: detail.name, source: detail.source });
    else setPage({ kind: "commands", detail });
  }, [detail, install]);

  const listActionGroups = useMemo<ActionGroup[]>(
    () => [
      {
        name: "store",
        actions: [
          { id: "store:sync", title: "Sync Catalog from GitHub" },
          { id: "store:showall", title: showAll ? "Show Installable Extensions Only" : "Show the Full Raycast Catalog" },
          { id: "store:import", title: "Publish Extension Folder…" },
        ],
      },
    ],
    [showAll],
  );

  const detailActionGroups = useMemo<ActionGroup[]>(() => {
    if (!detail) return [];
    return [
      {
        name: "extension",
        actions: [
          detail.installed ? { id: "store:commands", title: "Open Commands…" } : { id: "store:install", title: "Install" },
          ...(detail.readmeUrl ? [{ id: "store:readme", title: "Open README on GitHub" }] : []),
          { id: "store:import", title: "Publish Extension Folder…" },
        ],
      },
    ];
  }, [detail]);

  // --- pages ----------------------------------------------------------------------------------

  let body: ReactNode;
  if (page.kind === "list") {
    body = (
      <div className="store-list" onKeyDown={onListKeyDown}>
        {status?.running ? (
          <div className="store-sync-row">
            <span className="store-sync-row__label">
              Syncing catalog from GitHub… {status.total > 0 ? `${status.done}/${status.total}` : ""}
            </span>
            <LoadingBar isLoading />
          </div>
        ) : null}
        {entries.length === 0 && !status?.running ? (
          <div className="state">
            <div className="state__title">No extensions match</div>
            <div className="state__message">
              {searchText
                ? "Try a different search."
                : showAll
                  ? "Sync the catalog from GitHub (Ctrl K → Sync Catalog)."
                  : "Publish a FlowKey extension folder (Ctrl K → Publish…) or browse the full Raycast catalog (Ctrl K → Show the Full Raycast Catalog)."}
            </div>
          </div>
        ) : (
          <ul className="store-list__rows">
            {entries.map((entry, index) => (
              <li
                key={`${entry.source}:${entry.name}`}
                className="store-list__row"
                data-selected={index === listIndex}
                onClick={() => void openDetail(entry)}
                onMouseEnter={() => setListIndex(index)}
              >
                <StoreIcon name={entry.name} source={entry.source} size={28} />
                <span className="store-list__texts">
                  <span className="store-list__title">{entry.title}</span>
                  <span className="store-list__subtitle">
                    {entry.author ?? "unknown author"}
                    {entry.categories.length > 0 ? ` · ${entry.categories.join(", ")}` : ""}
                  </span>
                </span>
                <InstalledBadge installed={entry.installed} />
                <span className="list__rowActions" aria-hidden>
                  <RaycastIcon name="chevron-right" size={12} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {page.kind === "list" ? (
          <div ref={sentinelRef} className="store-list__sentinel">
            {loadingMore ? "Loading more…" : ""}
          </div>
        ) : null}
      </div>
    );
  } else if (page.kind === "detail") {
    const shown = detail;
    body = !shown ? (
      <div className="state">
        <div className="state__title">Loading…</div>
      </div>
    ) : (
      <div className="store-detail__scroll">
        <div className="store-hero">
          <StoreIcon name={shown.name} source={shown.source} size={56} />
          <div className="store-hero__texts">
            <h1 className="store-hero__title">{shown.title}</h1>
            <div className="store-hero__meta">
              {shown.author ? <Avatar user={shown.author} /> : null}
              <span>{shown.author ?? "unknown author"}</span>
              {shown.categories.length > 0 ? (
                <span className="store-hero__categories">{shown.categories.join(" · ")}</span>
              ) : null}
            </div>
          </div>
          <InstalledBadge installed={shown.installed} />
        </div>

        {shown.screenshots.length > 0 ? (
          <div className="store-screenshots">
            {shown.screenshots.map((screenshotPath) => (
              <Screenshot key={screenshotPath} name={shown.name} screenshotPath={screenshotPath} />
            ))}
          </div>
        ) : null}

        <div className="store-columns">
          <div className="store-columns__main">
            <h2 className="store-heading">Description</h2>
            <p className="store-description">{shown.description || "No description."}</p>

            <h2 className="store-heading">Commands</h2>
            <ul className="store-commands">
              {shown.commands.map((command) => (
                <li key={command.name} className="store-commands__row">
                  <StoreIcon name={shown.name} source={shown.source} size={20} />
                  <span className="store-commands__texts">
                    <span className="store-commands__title">{command.title}</span>
                    {command.description ? (
                      <span className="store-commands__description">{command.description}</span>
                    ) : null}
                  </span>
                </li>
              ))}
              {shown.commands.length === 0 ? <li className="store-commands__row">No commands declared.</li> : null}
            </ul>
          </div>

          <div className="store-columns__side">
            <h2 className="store-heading">README</h2>
            {shown.readmeUrl ? (
              <button
                type="button"
                className="store-readme-link"
                onClick={() => void ipc.backend("shell.openUrl", { url: shown.readmeUrl }, { module: "backend" })}
              >
                Open README <span className="store-readme-link__arrow">↗</span>
              </button>
            ) : (
              <span className="store-side-muted">{shown.readme ? "README available locally" : "No README"}</span>
            )}

            <h2 className="store-heading">Last update</h2>
            <span className="store-side-muted">{formatDate(shown.lastUpdate)}</span>

            {shown.contributors.length > 0 ? (
              <>
                <h2 className="store-heading">Contributors</h2>
                <ul className="store-contributors">
                  {shown.contributors.map((user) => (
                    <li key={user} className="store-contributors__row">
                      <Avatar user={user} size={20} />
                      <span>{user}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  } else {
    const shown = page.detail;
    const launchable = shown.installed && shown.runnable;
    body = (
      <ul className="store-list__rows store-commands-page">
        {shown.commands.map((command, index) => (
          <li
            key={command.name}
            className="store-list__row"
            data-selected={index === listIndex}
            onClick={() => {
              if (launchable) {
                launchStoreCommand(shown.name, command.name);
              } else {
                showToast("Not runnable yet", shown.runnable ? "Install the extension first" : "This extension needs a FlowKey port");
              }
            }}
            onMouseEnter={() => setListIndex(index)}
          >
            <StoreIcon name={shown.name} source={shown.source} size={22} />
            <span className="store-list__texts">
              <span className="store-list__title">{command.title}</span>
              <span className="store-list__subtitle">{command.description || command.name}</span>
            </span>
            {command.mode !== "view" ? <span className="store-mode-chip">no-view</span> : null}
          </li>
        ))}
      </ul>
    );
  }

  const footerTitle = page.kind === "list" ? "Store" : page.kind === "detail" ? page.entry.title : page.detail.title;
  const primary =
    page.kind === "detail" && detail
      ? {
          label: installing ? "Installing…" : detail.installed ? "Open Commands…" : "Install",
          key: "",
          onPress: runInstallIfOpen,
        }
      : undefined;

  return (
    <div className="window store-window">
      <header className="window__header">
        <button type="button" className="back-button" onClick={goBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {page.kind === "list" ? (
          <div className="searchbar">
            <input
              className="searchbar__input"
              autoFocus
              value={searchText}
              placeholder="Search Store extensions…"
              onChange={(event) => onSearchTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onListKeyDown(event);
                else if (event.key === "ArrowDown" || event.key === "ArrowUp") onListKeyDown(event);
              }}
            />
          </div>
        ) : (
          <span className="store-header__title">{footerTitle}</span>
        )}
        <LoadingBar isLoading={Boolean(status?.running)} />
      </header>

      <main className="window__body" style={{ padding: 0 }}>
        {body}
      </main>

      <CommandFooter
        area="store"
        title={footerTitle}
        primary={primary}
        leftActions={page.kind !== "list" && detail ? <StoreIcon name={detail.name} source={detail.source} size={18} /> : undefined}
        actions={
          <button type="button" className="footer-action footer-action--kbd" onClick={() => setPanelOpen((open) => !open)}>
            Actions <span className="kbd">Ctrl</span>
            <span className="kbd">K</span>
          </button>
        }
      />

      <ActionPanel
        open={panelOpen}
        title="Actions"
        groups={page.kind === "list" ? listActionGroups : detailActionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={async (action) => {
          setPanelOpen(false);
          if (action.id === "store:sync") void runSync();
          else if (action.id === "store:showall") {
            const next = !showAll;
            setShowAll(next);
            void refreshList(searchText, next);
          }
          else if (action.id === "store:import") void runImport();
          else if (action.id === "store:install" && detail) void install({ name: detail.name, source: detail.source });
          else if (action.id === "store:commands" && detail) setPage({ kind: "commands", detail });
          else if (action.id === "store:readme" && detail?.readmeUrl)
            void ipc.backend("shell.openUrl", { url: detail.readmeUrl }, { module: "backend" }).catch(() => undefined);
        }}
      />
    </div>
  );
}
