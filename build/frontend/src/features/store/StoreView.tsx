// The Store command view: catalog search → extension detail → Install / Update / Uninstall with
// progress. Modeled on the clone's other full-window command views (Clipboard History): the search
// bar filters the catalog, the detail replaces the list, and the confirm modal mirrors the real
// install confirmation (Extension / Author / commit).

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { RaycastIcon } from "../../icons";
import { renderMarkdown } from "../../markdown";
import {
  onStoreCatalogProgress,
  onStoreInstalled,
  onStoreProgress,
  storeCategories,
  storeCheckForUpdates,
  storeDetail,
  storeInstall,
  storeRefreshCatalog,
  storeSearch,
  storeUninstall,
  type CatalogExtension,
  type CatalogProgress,
  type InstallProgress,
  type StoreCategory,
  type StoreDetail,
} from "./storeApi";

function formatUpdatedAt(unixSeconds: number | null): string {
  if (!unixSeconds) return "unknown";
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const CLASS_LABELS: Record<string, string> = {
  compatible: "Compatible",
  "disabled-manifest": "Unavailable",
  "disabled-api": "Requires unsupported APIs",
  "disabled-mode": "Unavailable",
};

/** Rows fetched per search request; the list appends more pages as the user scrolls. */
const PAGE_SIZE = 50;

export function StoreView({
  showToast,
  onBack,
}: {
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
}) {
  // Search text is local: the shared page stack is only populated by extension render trees, and
  // an internal view like this one never pushes a page — a controlled input bound to it would
  // never update (updateTop no-ops on an empty stack).
  const [searchText, setSearchText] = useState("");
  const [extensions, setExtensions] = useState<CatalogExtension[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [commit, setCommit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState<CatalogProgress | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirming, setConfirming] = useState<CatalogExtension | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [busyHandle, setBusyHandle] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const loadedRef = useRef({ query: "", category: "all", offset: 0 });

  const reload = useCallback(
    async (query: string, activeCategory: string, options?: { append?: boolean; spinner?: boolean }) => {
      const append = options?.append ?? false;
      if (options?.spinner) setLoading(true);
      try {
        const offset = append ? loadedRef.current.offset : 0;
        const [result, categoryResult] = await Promise.all([
          storeSearch(query, activeCategory, PAGE_SIZE, offset),
          storeCategories(),
        ]);
        loadedRef.current = { query, category: activeCategory, offset: offset + result.extensions.length };
        setExtensions((previous) => {
          if (!append) return result.extensions;
          const seen = new Set(previous.map((entry) => entry.handle));
          return [...previous, ...result.extensions.filter((entry) => !seen.has(entry.handle))];
        });
        setTotal(result.total);
        setCommit(result.commit);
        setCategories(categoryResult.categories);
      } catch (error) {
        showToast("Store is unavailable", error instanceof Error ? error.message : String(error));
      } finally {
        if (options?.spinner) setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void reload(searchText, category, { spinner: true }), 150);
    return () => clearTimeout(timer);
  }, [searchText, category, reload]);

  // Catalog refresh progress: manifest rows land in SQLite while the fetch is still running, so
  // re-query periodically and the list grows live — including for whatever search text is active.
  const lastLiveQuery = useRef(0);
  useEffect(() => {
    return onStoreCatalogProgress((entry) => {
      setCatalogProgress(entry);
      if (entry.done || Date.now() - lastLiveQuery.current > 500) {
        lastLiveQuery.current = Date.now();
        void reload(searchText, category);
      }
    });
  }, [reload, searchText, category]);

  // Install/uninstall completion and progress push from the backend.
  useEffect(() => {
    const offProgress = onStoreProgress((entry) => setProgress(entry));
    const offInstalled = onStoreInstalled((payload) => {
      setBusyHandle(null);
      setProgress(null);
      setConfirming(null);
      void reload(searchText, category);
      // An open detail page must flip its Install/Uninstall button without being reopened.
      if (detail && payload.handle === detail.handle) {
        storeDetail(detail.handle).then(setDetail).catch(() => setDetail(null));
      }
    });
    return () => {
      offProgress();
      offInstalled();
    };
  }, [reload, searchText, category, detail]);

  const rows = useMemo(() => extensions, [extensions]);
  const selected = rows[selectedIndex] ?? null;

  const openDetail = useCallback(
    async (handle: string) => {
      setDetailLoading(true);
      try {
        setDetail(await storeDetail(handle));
      } catch (error) {
        showToast("Could not load extension", error instanceof Error ? error.message : String(error));
      } finally {
        setDetailLoading(false);
      }
    },
    [showToast],
  );

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await storeRefreshCatalog();
      showToast(
        result.cached ? "Catalog is up to date" : "Catalog updated",
        result.cached
          ? `${result.handles} extensions at commit ${result.commit.slice(0, 7)}`
          : `${result.fetched} extensions${result.failed ? `, ${result.failed} failed` : ""} at commit ${result.commit.slice(0, 7)}`,
      );
      await reload(searchText, category);
    } catch (error) {
      showToast("Could not refresh the catalog", error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [reload, searchText, category, showToast]);

  // First open with an empty cache: start the refresh automatically instead of leaving the user
  // on an empty list until they find the refresh button.
  const autoRefreshStarted = useRef(false);
  useEffect(() => {
    if (loading || autoRefreshStarted.current || commit !== null) return;
    autoRefreshStarted.current = true;
    void refreshCatalog();
  }, [loading, commit, refreshCatalog]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || detail || confirming || extensions.length >= total) return;
    if (loadedRef.current.query !== searchText || loadedRef.current.category !== category) return;
    setLoadingMore(true);
    void reload(searchText, category, { append: true }).finally(() => setLoadingMore(false));
  }, [loading, loadingMore, detail, confirming, extensions.length, total, searchText, category, reload]);

  const onListScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const element = event.currentTarget;
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 400) loadMore();
    },
    [loadMore],
  );

  // Keep the keyboard selection visible: the scroller is an ancestor (.window__body), so let the
  // browser walk up to it. Walking into the last rows pulls the next page, like scrolling does.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    row?.scrollIntoView({ block: "nearest" });
    if (selectedIndex >= rows.length - 5) loadMore();
  }, [selectedIndex, rows.length, loadMore]);

  const runInstall = useCallback(
    async (handle: string) => {
      setBusyHandle(handle);
      setConfirming(null);
      try {
        await storeInstall(handle);
        showToast("Extension installed");
      } catch (error) {
        showToast("Install failed", error instanceof Error ? error.message : String(error));
        setBusyHandle(null);
      }
    },
    [showToast],
  );

  const runUninstall = useCallback(
    async (handle: string) => {
      setBusyHandle(handle);
      try {
        await storeUninstall(handle);
        setDetail(null);
        showToast("Extension removed");
      } catch (error) {
        showToast("Uninstall failed", error instanceof Error ? error.message : String(error));
        setBusyHandle(null);
      }
    },
    [showToast],
  );

  const checkUpdates = useCallback(async () => {
    try {
      const { updates } = await storeCheckForUpdates();
      if (updates.length === 0) showToast("Everything is up to date");
      else showToast(`${updates.length} update${updates.length === 1 ? "" : "s"} available`, updates.map((update) => update.title).join(", "));
    } catch (error) {
      showToast("Could not check for updates", error instanceof Error ? error.message : String(error));
    }
  }, [showToast]);

  // Window-level keyboard for the catalog list (detail and modals own their keys).
  useEffect(() => {
    if (detail || confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) =>
          event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0),
        );
      } else if (event.key === "Enter") {
        if (!selected) return;
        event.preventDefault();
        void openDetail(selected.handle);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, selected, detail, confirming, openDetail]);

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="back-button" onClick={() => (detail ? setDetail(null) : onBack())} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="searchbar">
          <input
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder={detail ? "" : "Search the Store…"}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && selected && !detail) {
                event.preventDefault();
                void openDetail(selected.handle);
              }
            }}
          />
        </div>
        {commit ? <span className="store-commit" title={`Catalog commit ${commit}`}>{commit.slice(0, 7)}</span> : null}
        <button type="button" className="store-refresh" onClick={() => void checkUpdates()} aria-label="Check for updates">
          <RaycastIcon name="arrow-clockwise" size={14} />
        </button>
      </header>

      {/* The scroll container is `.window__body` (overflow: hidden auto), not the list itself —
          appending pages must listen here. */}
      <main className="window__body" onScroll={onListScroll}>
        {loading ? (
          <div className="state">
            <div className="state__title">Loading Store…</div>
          </div>
        ) : !detail ? (
          <>
            <div className="store-toolbar">
              <select
                className="store-toolbar__select"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Category"
              >
                <option value="all">All categories</option>
                {categories.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name} ({entry.count})
                  </option>
                ))}
              </select>
              <button type="button" className="store-toolbar__refresh" onClick={() => void refreshCatalog()} disabled={refreshing}>
                {refreshing
                  ? catalogProgress && !catalogProgress.done
                    ? `Loading ${catalogProgress.fetched}/${catalogProgress.total}…`
                    : "Refreshing…"
                  : "Refresh catalog"}
              </button>
            </div>
            {rows.length === 0 ? (
              catalogProgress && !catalogProgress.done && catalogProgress.total > 0 ? (
                <div className="state">
                  <div className="state__title">Loading catalog…</div>
                  <div className="state__message">{catalogProgress.fetched} of {catalogProgress.total} extensions cached — results appear as they arrive.</div>
                </div>
              ) : (
                <div className="state">
                  <div className="state__title">No extensions found</div>
                  <div className="state__message">Try a different search term or refresh the catalog.</div>
                </div>
              )
            ) : (
              <ul className="list store-list" ref={listRef}>
                {rows.map((entry, index) => (
                  <li key={entry.handle}>
                    <button
                      type="button"
                      className="list__row"
                      data-selected={index === selectedIndex}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => void openDetail(entry.handle)}
                    >
                      <span className="icon-wrap command-tile command-tile--store" aria-hidden>
                        <RaycastIcon name="extension" size={13} />
                      </span>
                      <span className="list__text">
                        <span className="list__title">{entry.title}</span>
                        <span className="list__subtitle">{entry.description || entry.name}</span>
                      </span>
                      <span className="list__accessory">
                        <span className="store-meta">{entry.author}</span>
                        {entry.installed ? <span className="pill">Installed</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
                {extensions.length < total ? (
                  <li className="store-list__more" aria-live="polite">
                    {loadingMore ? "Loading more…" : `${extensions.length} of ${total} — scroll for more`}
                  </li>
                ) : null}
              </ul>
            )}
          </>
        ) : (
          <div className="store-detail">
            <div className="store-detail__header">
              <div>
                <h1 className="store-detail__title">{detail.manifest.title}</h1>
                <p className="store-detail__description">{detail.manifest.description}</p>
              </div>
            </div>
            <dl className="store-detail__meta">
              <div>
                <dt>Author</dt>
                <dd>{detail.manifest.author}</dd>
              </div>
              <div>
                <dt>Contributors</dt>
                <dd>{detail.manifest.contributors.length > 0 ? detail.manifest.contributors.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>{formatUpdatedAt(detail.manifest.updatedAt)}</dd>
              </div>
              <div>
                <dt>Categories</dt>
                <dd>{detail.manifest.categories.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt>Install commit</dt>
                <dd className="store-detail__commit">{detail.commit}</dd>
              </div>
            </dl>

            <div className="store-detail__commands">
              <h2 className="store-detail__sectionTitle">Commands</h2>
              {detail.commands.map((command) => (
                <div key={command.name} className="store-command" data-class={command.class}>
                  <div className="store-command__text">
                    <span className="store-command__title">{command.title}</span>
                    <span className="store-command__description">{command.description || command.name}</span>
                    {command.class !== "compatible" && command.reason ? (
                      <span className="store-command__reason">{command.reason}</span>
                    ) : null}
                  </div>
                  <span className="pill" data-class={command.class}>
                    {CLASS_LABELS[command.class] ?? command.class}
                  </span>
                </div>
              ))}
            </div>

            <div className="store-detail__actions">
              {detail.installed ? (
                <button
                  type="button"
                  className="store-install"
                  disabled={busyHandle === detail.handle}
                  onClick={() => void runInstall(detail.handle)}
                >
                  Update
                </button>
              ) : (
                <button
                  type="button"
                  className="store-install"
                  disabled={busyHandle === detail.handle}
                  onClick={() => setConfirming({ ...({ handle: detail.handle, title: detail.manifest.title, author: detail.manifest.author } as CatalogExtension) })}
                >
                  Install
                </button>
              )}
              {detail.installed ? (
                <button
                  type="button"
                  className="store-uninstall"
                  disabled={busyHandle === detail.handle}
                  onClick={() => void runUninstall(detail.handle)}
                >
                  Uninstall
                </button>
              ) : null}
              {busyHandle === detail.handle && progress ? (
                <span className="store-progress">
                  {progress.step === "error" ? "Failed: " : ""}
                  {progress.message}
                </span>
              ) : null}
            </div>

            {detail.readme ? (
              <div className="store-detail__readme">
                <h2 className="store-detail__sectionTitle">README</h2>
                <div className="store-detail__markdown">{renderMarkdown(detail.readme)}</div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      {confirming ? (
        <div className="store-confirm" role="dialog" aria-label="Confirm install">
          <div className="store-confirm__card">
            <h3 className="store-confirm__title">Install Extension</h3>
            <dl className="store-confirm__meta">
              <div>
                <dt>Extension</dt>
                <dd>{confirming.title}</dd>
              </div>
              <div>
                <dt>Author</dt>
                <dd>{confirming.author}</dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd className="store-detail__commit">{commit ?? "—"}</dd>
              </div>
            </dl>
            <div className="store-confirm__actions">
              <button type="button" className="store-uninstall" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button type="button" className="store-install" onClick={() => void runInstall(confirming.handle)}>
                Install
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="window__footer">
        <span className="footer__spacer" />
        <span className="store-footer-hint">
          {detail ? "Escape goes back" : "Enter opens the extension"}
        </span>
      </footer>
    </div>
  );
}
