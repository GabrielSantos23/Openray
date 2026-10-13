// The Store command view: catalog search → extension detail → Install / Update / Uninstall with
// progress. Modeled on the clone's other full-window command views (Clipboard History): the search
// bar filters the catalog, the detail replaces the list, and the confirm modal mirrors the real
// install confirmation (Extension / Author / commit).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RaycastIcon } from "../../icons";
import { renderMarkdown } from "../../markdown";
import {
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
  const [extensions, setExtensions] = useState<CatalogExtension[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [commit, setCommit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirming, setConfirming] = useState<CatalogExtension | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [busyHandle, setBusyHandle] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const reload = useCallback(
    async (query: string, activeCategory: string) => {
      try {
        const [result, categoryResult] = await Promise.all([
          storeSearch(query, activeCategory),
          storeCategories(),
        ]);
        setExtensions(result.extensions);
        setCommit(result.commit);
        setCategories(categoryResult.categories);
      } catch (error) {
        showToast("Store is unavailable", error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void reload(searchText, category), 150);
    return () => clearTimeout(timer);
  }, [searchText, category, reload]);

  // Install/uninstall completion and progress push from the backend.
  useEffect(() => {
    const offProgress = onStoreProgress((entry) => setProgress(entry));
    const offInstalled = onStoreInstalled(() => {
      setBusyHandle(null);
      setProgress(null);
      setConfirming(null);
      void reload(searchText, category);
    });
    return () => {
      offProgress();
      offInstalled();
    };
  }, [reload, searchText, category]);

  const rows = useMemo(() => extensions, [extensions]);
  const selected = rows[selectedIndex] ?? null;

  useEffect(() => {
    const container = listRef.current;
    const row = container?.querySelector<HTMLElement>('[data-selected="true"]');
    if (container && row) {
      const rowRect = row.getBoundingClientRect();
      const viewRect = container.getBoundingClientRect();
      if (rowRect.top < viewRect.top) container.scrollTop -= viewRect.top - rowRect.top + 4;
      else if (rowRect.bottom > viewRect.bottom) container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
    }
  }, [selectedIndex]);

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
      showToast("Catalog updated", `${result.fetched} extensions at commit ${result.commit.slice(0, 7)}`);
      await reload(searchText, category);
    } catch (error) {
      showToast("Could not refresh the catalog", error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [reload, searchText, category, showToast]);

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
            onChange={(event) => onSearchTextChange(event.target.value)}
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

      <main className="window__body">
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
                {refreshing ? "Refreshing…" : "Refresh catalog"}
              </button>
            </div>
            {rows.length === 0 ? (
              <div className="state">
                <div className="state__title">No extensions found</div>
                <div className="state__message">Try a different search term or refresh the catalog.</div>
              </div>
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
