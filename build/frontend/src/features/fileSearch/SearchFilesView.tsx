// The Search Files command view — Raycast's internal `file-search` extension
// (docs/file-search-spec.md): `Search files…` box, `Filter by Type` + sort dropdowns, the
// `Metadata` details pane, the confirmed action panel set, and the delete confirmation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ipc, onNotification } from "../../ipc";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { RaycastIcon } from "../../icons";
import { LoadingBar } from "../../LoadingBar";
import { CommandFooter } from "../../commandChrome";
import { alertStore } from "../../alertStore";
import type { ApplicationCommand } from "../../applications";
import {
  fetchFileResults,
  fetchFileMetadata,
  fetchIndexState,
  fileActionGroups,
  fileIconFor,
  formatFileSize,
  runFileAction,
  trackFileUsage,
  startIndexing,
  stopIndexing,
  FILE_TYPE_FILTERS,
  FILE_SORT_OPTIONS,
  type FileIndexState,
  type FileMetadata,
  type FileSearchRow,
  type FileSearchSettings,
} from "../../fileSearch";

type SearchFilesCommand = "searchFiles";

export function SearchFilesView({
  command,
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
  applications,
}: {
  command: SearchFilesCommand;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
}) {
  void command;
  return (
    <SearchFiles
      searchText={searchText}
      onSearchTextChange={onSearchTextChange}
      showToast={showToast}
      onBack={onBack}
      closeMainWindow={closeMainWindow}
      applications={applications}
    />
  );
}

function SearchFiles({
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
  applications,
}: {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
}) {
  const [results, setResults] = useState<FileSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("modified");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [indexState, setIndexState] = useState<FileIndexState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openWithPath, setOpenWithPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileSearchRow | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = results[selectedIndex] ?? null;

  // Live index state: the footer mirrors the pinned root row (`Indexing N files`).
  useEffect(() => {
    fetchIndexState().then(setIndexState).catch(() => undefined);
    return onNotification("fileSearch.indexState", (raw) => setIndexState(raw as FileIndexState));
  }, []);

  // Debounced backend query (Raycast's content search debounce is 200ms; names use the same).
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      fetchFileResults(searchText, { type: typeFilter, sort, limit: 200 })
        .then((rows) => setResults(rows))
        .catch(() => {
          // Confirmed fetch-failure toast.
          showToast("Failed to fetch files");
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [searchText, typeFilter, sort, refreshTick, showToast]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchText, typeFilter, sort]);

  // The details pane shows the confirmed `Metadata` rows for the selected row.
  useEffect(() => {
    if (!detailsOpen || !selected) {
      setMetadata(null);
      return;
    }
    let cancelled = false;
    fetchFileMetadata(selected.path).then((value) => {
      if (!cancelled) setMetadata(value);
    });
    return () => {
      cancelled = true;
    };
  }, [detailsOpen, selected]);

  useEffect(() => {
    const container = listRef.current?.parentElement;
    const row = listRef.current?.querySelector<HTMLElement>('.list__row[data-selected="true"]');
    if (!container || !row) return;
    const rowRect = row.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (rowRect.top < viewRect.top) container.scrollTop -= viewRect.top - rowRect.top + 4;
    else if (rowRect.bottom > viewRect.bottom) container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
  }, [selectedIndex, results.length]);

  // Window-level keyboard: arrows move the selection, Enter opens, Ctrl+K the panel, Ctrl+I the
  // info panel, Escape pops back (the panel owns Escape while open).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (panelOpen || deleteTarget || openWithPath) return;
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanelOpen(true);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setDetailsOpen((open) => !open);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (selected) void runPrimary(selected);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, deleteTarget, openWithPath, results, selectedIndex, onBack]);

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  const runPrimary = useCallback(
    async (row: FileSearchRow) => {
      trackFileUsage(row.path);
      closeMainWindow();
      await ipc.backend("fileSystem.openFile", { path: row.path }, { module: "backend" }).catch(() => {
        showToast("Failed to open file", row.name);
      });
    },
    [closeMainWindow, showToast],
  );

  const handlers = useMemo(
    () => ({
      showToast,
      refresh,
      openWith: (path: string) => setOpenWithPath(path),
      saveAsQuicklink: (row: FileSearchRow) => {
        void ipc.backend(
          "quicklinks.save",
          { name: row.name, link: `file:///${row.path.replace(/\\/g, "/")}`, openWith: null, icon: null, tags: ["file"] },
          { module: "backend" },
        )
          .then(() => showToast("Saved as Quicklink", row.name))
          .catch(() => showToast("Failed to save Quicklink"));
      },
    }),
    [showToast, refresh],
  );

  const runPanelAction = useCallback(
    async (row: FileSearchRow, actionId: string) => {
      const verb = actionId.slice(actionId.indexOf(":") + 1);
      setPanelOpen(false);
      if (verb === "delete") {
        setDeleteTarget(row);
        return;
      }
      await runFileAction(row, actionId, handlers);
    },
    [handlers],
  );

  const panelGroups = useMemo<ActionGroup[]>(
    () => (selected ? fileActionGroups(selected, { indexing: indexState?.state === "indexing", openWith: true }) : []),
    [selected, indexState],
  );

  // The confirmed confirm string, with the confirmed `Deleted file` toast inside runFileAction.
  const confirmDelete = useCallback(
    (row: FileSearchRow) => {
      setDeleteTarget(null);
      void runFileAction(row, "file:delete", handlers);
    },
    [handlers],
  );

  // `Open With…`: Raycast lists every application that can open the file. The clone lists the
  // discovered applications and launches the chosen one with the path as its argument.
  const openWithGroups = useMemo<ActionGroup[]>(() => {
    if (!openWithPath) return [];
    return [
      {
        name: "applications",
        actions: applications.slice(0, 60).map((app) => ({
          id: `openwith:${app.payload.id}`,
          title: app.title,
          itemId: app.payload.id,
        })),
      },
    ];
  }, [openWithPath, applications]);

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of results) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
    return counts;
  }, [results]);

  const indexing = indexState?.state === "indexing";
  const typeLabel = FILE_TYPE_FILTERS.find((option) => option.value === typeFilter)?.label ?? "All Types";
  const sortLabel = FILE_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Date Modified";

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="searchbar">
          <span className="searchbar__icon" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder="Search files…"
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>

        <DropdownMenu
          label={typeLabel}
          open={typeMenuOpen}
          onOpenChange={setTypeMenuOpen}
          options={FILE_TYPE_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
          value={typeFilter}
          onSelect={(value) => setTypeFilter(value)}
        />
        {searchText.trim().length > 0 ? (
          <DropdownMenu
            label={sortLabel}
            open={sortMenuOpen}
            onOpenChange={setSortMenuOpen}
            options={FILE_SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            value={sort}
            onSelect={(value) => setSort(value)}
          />
        ) : null}
      </header>

      <main className="window__body">
        <LoadingBar isLoading={loading} />
        {results.length === 0 && !loading ? (
          <div className="state">
            <div className="state__title">No files found</div>
            <div className="state__message">
              {indexing
                ? `Indexing ${indexState?.fileCount ?? 0} files — try again in a moment.`
                : "Files from your indexed folders appear here."}
            </div>
          </div>
        ) : (
          <div className={detailsOpen ? "clipboard-split" : undefined}>
            <ul className="list clipboard-list" ref={listRef}>
              {results.map((row, index) => {
                const duplicate = (duplicates.get(row.name) ?? 0) > 1;
                return (
                  <li key={row.path}>
                    <button
                      type="button"
                      className="list__row"
                      data-selected={index === selectedIndex}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => void runPrimary(row)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSelectedIndex(index);
                        setPanelOpen(true);
                      }}
                    >
                      <span className="icon" aria-hidden>
                        <RaycastIcon name={fileIconFor(row.contentType)} size={16} />
                      </span>
                      <span className="list__text">
                        <span className="list__title">{row.name}</span>
                        <span className="list__subtitle">
                          {detailsOpen || duplicate ? row.parentFolder || row.folder : ""}
                        </span>
                      </span>
                      <span className="list__accessory">
                        {row.hidden ? <span className="pill">hidden</span> : null}
                        <span className="pill">{row.contentType}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {detailsOpen && selected ? (
              <div className="clipboard-detail">
                <div className="clipboard-detail__header">Metadata</div>
                <div className="filesearch-metadata">
                  <MetadataRow label="Name" value={metadata?.name ?? selected.name} />
                  <MetadataRow label="Where" value={metadata?.where ?? selected.folder} />
                  <MetadataRow label="Type" value={metadata?.type ?? selected.contentType} />
                  <MetadataRow label="Size" value={formatFileSize(metadata ? metadata.size : selected.size)} />
                  <MetadataRow label="Created" value={formatDate(metadata?.created ?? selected.createdTime)} />
                  <MetadataRow label="Modified" value={formatDate(metadata?.modified ?? selected.modifiedTime)} />
                  {metadata ? <MetadataRow label="Accessed" value={formatDate(metadata.accessed)} /> : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      <CommandFooter
        area="file-search"
        title="Search Files"
        primary={selected ? { label: "Open", key: "", onPress: () => void runPrimary(selected) } : undefined}
        leftActions={
          indexing ? (
            <button type="button" className="footer-action" onClick={() => void stopIndexing().then(refresh)}>
              Stop Indexing
            </button>
          ) : (
            <button type="button" className="footer-action" onClick={() => void startIndexing().then(() => showToast("Indexing Files…"))}>
              Index Files
            </button>
          )
        }
        actions={
          <>
            <span className="translate-counters">
              {results.length} item{results.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="footer-action footer-action--kbd"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              Toggle Info Panel
              <span className="kbd">Ctrl</span>
              <span className="kbd">I</span>
            </button>
            <button type="button" className="footer-action footer-action--kbd" onClick={() => setPanelOpen(true)}>
              Actions
              <span className="kbd">Ctrl</span>
              <span className="kbd">K</span>
            </button>
          </>
        }
      />

      <ActionPanel
        open={panelOpen && selected !== null}
        title={selected?.name}
        groups={panelGroups}
        onClose={() => setPanelOpen(false)}
        onRun={async (action) => {
          if (selected) await runPanelAction(selected, action.id);
        }}
      />

      <ActionPanel
        open={openWithPath !== null}
        title="Open With…"
        groups={openWithGroups}
        onClose={() => setOpenWithPath(null)}
        onRun={async (action) => {
          const target = openWithPath;
          setOpenWithPath(null);
          if (!target) return;
          const app = applications.find((candidate) => candidate.payload.id === action.itemId);
          if (!app?.payload.path) return;
          await ipc
            .backend("shell.openWith", { path: target, app: app.payload.path }, { module: "backend" })
            .catch(() => showToast("Failed to open file", target));
        }}
      />

      {deleteTarget ? (
        <DeleteConfirm
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => confirmDelete(deleteTarget)}
        />
      ) : null}
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="filesearch-metadata__row">
      <span className="filesearch-metadata__label">{label}</span>
      <span className="filesearch-metadata__value" title={value}>
        {value}
      </span>
    </div>
  );
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function DeleteConfirm({
  target,
  onCancel,
  onConfirm,
}: {
  target: FileSearchRow;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    // The shared alert host renders the confirmed confirm string with destructive styling.
    alertStore.open({
      title: `Are you sure you want to delete ${target.name}?`,
      primaryAction: { title: "Delete", style: "destructive", action: onConfirm },
      secondaryAction: { title: "Cancel", action: onCancel },
    });
    return () => {
      alertStore.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.path]);
  return null;
}

/** The settings-menu dropdown, anchored to a header button (same classes as the language picker). */
function DropdownMenu({
  label,
  open,
  onOpenChange,
  options,
  value,
  onSelect,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
  onSelect: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open, onOpenChange]);
  return (
    <div className="translate-language-anchor" ref={ref}>
      <button
        type="button"
        className="settings-select__trigger translate-language"
        data-state={open ? "open" : undefined}
        onClick={() => onOpenChange(!open)}
      >
        {label}
        <RaycastIcon name="chevron-right" size={13} className="translate-language__chevron" />
      </button>
      {open ? (
        <div className="settings-menu translate-menu translate-menu--header" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="settings-menu__item translate-menu__item"
              data-selected={option.value === value}
              onClick={() => {
                onSelect(option.value);
                onOpenChange(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <RaycastIcon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
