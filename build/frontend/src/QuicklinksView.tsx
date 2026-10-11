// The Quicklinks command view (`/extension/quicklinks/search`).
//
// Ported from `SearchQuicklinksView` in the shipped `main-window-*.js` (see
// `docs/quicklinks-spec.md`): the `Search for Quicklinks…` search field, `Pinned` + `Quicklinks`
// sections, the Information detail pane, and the action panel with the confirmed titles and toasts.
// The create/edit form, import/export and the featured library run as in-view dialogs, the way the
// clone's Clipboard History view hosts its own dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "./ActionPanel";
import { ipc } from "./ipc";
import { RaycastIcon } from "./icons";
import { rankEntries } from "./matching";
import type { ApplicationCommand } from "./applications";
import {
  FEATURED_LIBRARY,
  isFileLink,
  openQuicklink,
  copyResolvedLink,
  parseImportPayload,
  setPendingCreateLink,
  useQuicklinks,
  warnBeforeDelete,
  type ImportEntry,
  type QuicklinkArg,
  type QuicklinkEntry,
} from "./quicklinks";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function monogramHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function openedLabel(count: number): string {
  if (count === 0) return "Never";
  if (count === 1) return "Once";
  return `${count} times`;
}

interface EditingState {
  mode: "create" | "edit" | "duplicate";
  id?: string;
  name: string;
  link: string;
  openWith: string;
  tags: string;
}

interface ArgsState {
  entry: QuicklinkEntry;
  values: string[];
  error: string | null;
}

export type { ArgsState };

export interface QuicklinksViewProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
  /** Seed the create form (the `createWithURL` root-search entry). */
  createLink?: string | null;
  onConsumeCreateLink?: () => void;
}

export function QuicklinksView({
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
  applications,
  createLink,
  onConsumeCreateLink,
}: QuicklinksViewProps) {
  const { quicklinks, loading, error, refresh } = useQuicklinks();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [argsState, setArgsState] = useState<ArgsState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [openWithState, setOpenWithState] = useState<QuicklinkEntry | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [imported, setImported] = useState<ImportEntry[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<QuicklinkEntry | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [rememberDelete, setRememberDelete] = useState(!warnBeforeDelete());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (createLink) {
      setEditing({ mode: "create", name: "", link: createLink, openWith: "", tags: "" });
      onConsumeCreateLink?.();
    }
  }, [createLink, onConsumeCreateLink]);

  const ranked = useMemo(() => {
    const trimmed = searchText.trim();
    if (!trimmed) return quicklinks.map((entry, index) => ({ entry, value: index }));
    const rankedEntries = rankEntries(
      quicklinks.map((entry) => ({
        entry,
        title: entry.name,
        subtitle: entry.link,
        keywords: [entry.link.toLowerCase(), ...entry.tags.map((tag) => tag.toLowerCase())],
      })),
      trimmed,
      "medium",
      new Map(quicklinks.map((entry) => [entry.name, entry.openCount])),
    );
    return rankedEntries.map((rankedEntry) => ({ entry: rankedEntry.entry.entry, value: 0 }));
  }, [quicklinks, searchText]);

  const pinned = ranked.filter((item) => item.entry.pinned !== null);
  const regular = ranked.filter((item) => item.entry.pinned === null);
  const sections = [
    ...(pinned.length ? [{ id: "pinned", title: "Pinned", entries: pinned }] : []),
    ...(regular.length ? [{ id: "quicklinks", title: "Quicklinks", entries: regular }] : []),
  ];
  const rows = useMemo(() => sections.flatMap((section) => section.entries), [sections]);
  const selected = rows[selectedIndex]?.entry ?? null;

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchText]);

  useEffect(() => {
    const container = listRef.current?.parentElement;
    const row = listRef.current?.querySelector<HTMLElement>('.list__row[data-selected="true"]');
    if (!container || !row) return;
    const rowRect = row.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (rowRect.top < viewRect.top) container.scrollTop -= viewRect.top - rowRect.top + 4;
    else if (rowRect.bottom > viewRect.bottom) container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
  }, [selectedIndex, rows.length, searchText]);

  const openWithArgs = useCallback(
    async (entry: QuicklinkEntry, values: string[]) => {
      try {
        await openQuicklink(entry.id, values);
        closeMainWindow();
      } catch (cause) {
        showToast("Unable to open quicklink", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [closeMainWindow, showToast],
  );

  const activate = useCallback(
    (entry: QuicklinkEntry) => {
      if (entry.argsError) {
        showToast("Unable to open quicklink", entry.argsError);
        return;
      }
      const missing = entry.args.some((arg, index) => arg.required && !entry.args[index].value);
      if (missing) {
        setArgsState({ entry, values: entry.args.map((arg) => arg.value), error: null });
        return;
      }
      void openWithArgs(entry, entry.args.map((arg) => arg.value));
    },
    [openWithArgs, showToast],
  );

  const runDelete = useCallback(
    async (entry: QuicklinkEntry) => {
      try {
        await ipc.backend("quicklinks.delete", { id: entry.id }, { module: "backend" });
        showToast("Quicklink deleted");
      } catch (cause) {
        showToast("Failed to delete quicklink", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [showToast],
  );

  const openWithApplication = useCallback(
    async (entry: QuicklinkEntry, appPath: string) => {
      setOpenWithState(null);
      try {
        const resolved = await copyResolvedLink(entry.link, entry.args.map((arg) => arg.value));
        await ipc.backend("shell.openWith", { path: resolved, app: appPath }, { module: "backend" });
        closeMainWindow();
      } catch (cause) {
        showToast("Unable to open quicklink", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [closeMainWindow, showToast],
  );

  const runAction = useCallback(
    async (actionId: string) => {
      setPanelOpen(false);
      const entry = selected;
      if (!entry && actionId !== "quicklinks:create" && actionId !== "quicklinks:import" && actionId !== "quicklinks:export" && actionId !== "quicklinks:library" && actionId !== "quicklinks:deleteAll") return;
      switch (actionId) {
        case "quicklinks:create":
          setEditing({ mode: "create", name: "", link: "", openWith: "", tags: "" });
          return;
        case "quicklinks:open":
          if (entry) activate(entry);
          return;
        case "quicklinks:openWith":
          if (entry) setOpenWithState(entry);
          return;
        case "quicklinks:reveal": {
          if (!entry) return;
          try {
            const resolved = await copyResolvedLink(entry.link, entry.args.map((arg) => arg.value));
            await ipc.backend("shell.revealFile", { path: resolved }, { module: "backend" });
          } catch (cause) {
            showToast("Unable to open quicklink", cause instanceof Error ? cause.message : String(cause));
          }
          return;
        }
        case "quicklinks:edit":
          if (entry) {
            setEditing({ mode: "edit", id: entry.id, name: entry.name, link: entry.link, openWith: entry.openWith ?? "", tags: entry.tags.join(", ") });
          }
          return;
        case "quicklinks:duplicate":
          if (entry) {
            setEditing({ mode: "duplicate", name: entry.name, link: entry.link, openWith: entry.openWith ?? "", tags: entry.tags.join(", ") });
          }
          return;
        case "quicklinks:copyName":
          if (entry) {
            await navigator.clipboard.writeText(entry.name);
            showToast("Copied name");
          }
          return;
        case "quicklinks:copyLink":
          if (entry) {
            try {
              const resolved = await copyResolvedLink(entry.link, entry.args.map((arg) => arg.value));
              await navigator.clipboard.writeText(resolved);
              showToast("Copied link");
            } catch (cause) {
              showToast("Couldn't copy link", cause instanceof Error ? cause.message : String(cause));
            }
          }
          return;
        case "quicklinks:pin":
          if (entry) {
            await ipc.backend("quicklinks.pin", { id: entry.id }, { module: "backend" });
            showToast("Pinned Quicklink");
          }
          return;
        case "quicklinks:unpin":
          if (entry) {
            await ipc.backend("quicklinks.unpin", { id: entry.id }, { module: "backend" });
            showToast("Unpinned Quicklink");
          }
          return;
        case "quicklinks:moveUp":
          if (entry) {
            await ipc.backend("quicklinks.movePinnedUp", { id: entry.id }, { module: "backend" });
            showToast("Moved Quicklink up");
          }
          return;
        case "quicklinks:moveDown":
          if (entry) {
            await ipc.backend("quicklinks.movePinnedDown", { id: entry.id }, { module: "backend" });
            showToast("Moved Quicklink down");
          }
          return;
        case "quicklinks:import": {
          try {
            const response = (await ipc.backend(
              "fileSystem.showOpenFileDialog",
              { title: "Import Quicklinks", allowedTypes: ["json"] },
              { module: "frontend" },
            )) as { path?: string | null };
            if (!response.path) return;
            const file = (await ipc.backend(
              "fileSystem.readFile",
              { path: response.path },
              { module: "frontend" },
            )) as { content?: string };
            const parsed = parseImportPayload(file.content ?? "");
            if ("error" in parsed) {
              setImportError(parsed.error);
              setImported(null);
            } else {
              setImportError(null);
              setImported(parsed.entries);
            }
          } catch (cause) {
            showToast("Import failed", cause instanceof Error ? cause.message : String(cause));
          }
          return;
        }
        case "quicklinks:export": {
          try {
            const data = (await ipc.backend("quicklinks.exportAll", {}, { module: "backend" })) as {
              quicklinks?: ImportEntry[];
            };
            const date = new Date().toISOString().slice(0, 10);
            const response = (await ipc.backend(
              "fileSystem.showSaveFileDialog",
              { title: "Export Quicklinks", fileName: `Quicklinks ${date}.json` },
              { module: "frontend" },
            )) as { path?: string | null };
            if (!response.path) return;
            await ipc.backend(
              "fileSystem.writeFile",
              { path: response.path, content: JSON.stringify(data.quicklinks ?? [], null, 2) },
              { module: "frontend" },
            );
            showToast("Exported quicklinks", response.path);
          } catch (cause) {
            showToast("Failed to export quicklinks", cause instanceof Error ? cause.message : String(cause));
          }
          return;
        }
        case "quicklinks:library":
          setLibraryOpen(true);
          return;
        case "quicklinks:delete":
          if (entry) {
            if (warnBeforeDelete()) setConfirmingDelete(entry);
            else void runDelete(entry);
          }
          return;
        case "quicklinks:deleteAll":
          setConfirmingDeleteAll(true);
          return;
        default:
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, activate, showToast, runDelete],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (argsState || editing || openWithState || libraryOpen || imported || confirmingDelete || confirmingDeleteAll) return;
      const key = event.key;
      if (key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPanelOpen((open) => !open);
        return;
      }
      if (key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, rows.length - 1));
      } else if (key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (key === "Enter") {
        const entry = rows[selectedIndex]?.entry;
        if (!entry) return;
        event.preventDefault();
        activate(entry);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, selectedIndex, activate, argsState, editing, openWithState, libraryOpen, imported, confirmingDelete, confirmingDeleteAll]);

  const actionGroups = useMemo<ActionGroup[]>(() => {
    const general: ActionGroup["actions"] = [];
    const copy: ActionGroup["actions"] = [];
    const favorites: ActionGroup["actions"] = [];
    const manage: ActionGroup["actions"] = [];
    const remove: ActionGroup["actions"] = [];
    if (selected) {
      general.push({ id: "quicklinks:open", title: selected.args.length ? "Open Quicklink" : "Open Quicklink", itemId: "" });
      general.push({ id: "quicklinks:openWith", title: "Open With…", itemId: "" });
      if (selected.link && isFileLink(selected.link)) {
        general.push({ id: "quicklinks:reveal", title: "Show in File Explorer", itemId: "" });
      }
      general.push({ id: "quicklinks:edit", title: "Edit Quicklink", itemId: "" });
      general.push({ id: "quicklinks:duplicate", title: "Duplicate Quicklink", itemId: "" });
      copy.push({ id: "quicklinks:copyName", title: "Copy Name", itemId: "" });
      copy.push({ id: "quicklinks:copyLink", title: "Copy Link", itemId: "" });
      if (selected.pinned === null) favorites.push({ id: "quicklinks:pin", title: "Pin Quicklink", itemId: "" });
      else {
        favorites.push({ id: "quicklinks:unpin", title: "Unpin Quicklink", itemId: "" });
        favorites.push({ id: "quicklinks:moveUp", title: "Move Up", itemId: "" });
        favorites.push({ id: "quicklinks:moveDown", title: "Move Down", itemId: "" });
      }
      remove.push({ id: "quicklinks:delete", title: "Delete Quicklink", itemId: "" });
    }
    manage.push({ id: "quicklinks:create", title: "Create Quicklink", itemId: "" });
    manage.push({ id: "quicklinks:library", title: "Add from Library", itemId: "" });
    manage.push({ id: "quicklinks:import", title: "Import Quicklinks", itemId: "" });
    manage.push({ id: "quicklinks:export", title: "Export Quicklinks", itemId: "" });
    remove.push({ id: "quicklinks:deleteAll", title: "Delete All Local Quicklinks", itemId: "" });
    return [
      { name: "primary", actions: general },
      { name: "favorites", actions: favorites },
      { name: "copy", actions: copy },
      { name: "manage", actions: manage },
      { name: "delete", actions: remove },
    ].filter((group) => group.actions.length > 0);
  }, [selected]);

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
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
            ref={searchRef}
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder="Search for Quicklinks…"
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>

        <button
          type="button"
          className="clipboard-filter-button"
          title="Create Quicklink"
          onClick={() => setEditing({ mode: "create", name: "", link: "", openWith: "", tags: "" })}
        >
          <RaycastIcon name="plus" size={15} />
          <span className="clipboard-filter-button__label">Create Quicklink</span>
        </button>
      </header>

      <main className="window__body clipboard-body">
        {loading && quicklinks.length === 0 ? (
          <div className="state">
            <div className="state__title">Loading…</div>
          </div>
        ) : error ? (
          <div className="state">
            <div className="state__title">Could not read Quicklinks</div>
            <div className="state__message">{error}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="state">
            <div className="state__title">No Quicklinks Found</div>
            <div className="state__message">Save frequently used links for quick access.</div>
            <button
              type="button"
              className="action action--primary"
              onClick={() => setEditing({ mode: "create", name: "", link: "", openWith: "", tags: "" })}
            >
              <span>Create Quicklink</span>
            </button>
          </div>
        ) : (
          <div className="clipboard-split">
            <ul className="list clipboard-list" ref={listRef}>
              {sections.map((section) => (
                <li key={section.id} className="list__section">
                  <div className="list__sectionHeader">
                    <span className="list__sectionTitle">{section.title}</span>
                    <span className="list__sectionCount">{section.entries.length}</span>
                  </div>
                  <ul className="list__sectionBody">
                    {section.entries.map(({ entry }) => {
                      const index = rows.findIndex((row) => row.entry.id === entry.id);
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => activate(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelectedIndex(index);
                              setPanelOpen(true);
                            }}
                          >
                            <span
                              className="icon quicklinks-monogram"
                              style={{ background: `hsl(${monogramHue(entry.name)} 45% 30%)` }}
                              aria-hidden
                            >
                              {entry.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.name}</span>
                              <span className="list__subtitle">{entry.link}</span>
                            </span>
                            <span className="list__accessory">
                              {entry.args.length > 0 ? <span className="pill">{entry.args.length} args</span> : null}
                              {entry.pinned !== null ? (
                                <span className="list__favorite" title="Pinned">
                                  <RaycastIcon name="tack" size={13} />
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>

            {selected ? (
              <aside className="clipboard-detail">
                <div className="clipboard-detail__section">
                  <div className="clipboard-detail__heading">Information</div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Name</span>
                    <span className="clipboard-detail__value">{selected.name}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Link</span>
                    <span className="clipboard-detail__value clipboard-detail__value--mono">{selected.link}</span>
                  </div>
                  {selected.openWith ? (
                    <div className="clipboard-detail__row">
                      <span className="clipboard-detail__label">Application</span>
                      <span className="clipboard-detail__value">{selected.openWith}</span>
                    </div>
                  ) : null}
                  {selected.tags.length > 0 ? (
                    <div className="clipboard-detail__row">
                      <span className="clipboard-detail__label">Tags</span>
                      <span className="clipboard-detail__value">{selected.tags.join(", ")}</span>
                    </div>
                  ) : null}
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Created</span>
                    <span className="clipboard-detail__value">{formatDate(selected.createdAt)}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Last Updated</span>
                    <span className="clipboard-detail__value">{formatDate(selected.updatedAt)}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Opened</span>
                    <span className="clipboard-detail__value">{openedLabel(selected.openCount)}</span>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </main>

      <footer className="window__footer">
        <span className="footer__spacer" />
        <button
          type="button"
          className="footer-action footer-action--kbd"
          onClick={() => setPanelOpen((open) => !open)}
        >
          Actions <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </button>
      </footer>

      <ActionPanel
        open={panelOpen}
        title="Quicklinks"
        groups={actionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={(action) => runAction(action.id)}
      />

      {openWithState ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setOpenWithState(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt quicklinks-library" role="dialog">
            <div className="action-panel__title">Open With…</div>
            <ul className="quicklinks-library__list">
              {applications.map((application) => (
                <li key={application.payload.id}>
                  <button
                    type="button"
                    className="action"
                    onClick={() => void openWithApplication(openWithState, application.payload.path ?? "")}
                  >
                    <span>{application.payload.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {argsState ? (
        <ArgsForm
          state={argsState}
          onCancel={() => setArgsState(null)}
          onSubmit={async (values) => {
            setArgsState(null);
            await openWithArgs(argsState.entry, values);
          }}
        />
      ) : null}

      {editing ? (
        <EditorForm
          editing={editing}
          applications={applications}
          onCancel={() => setEditing(null)}
          onSaved={(title) => {
            setEditing(null);
            showToast(title);
            refresh();
          }}
          onError={(message) => showToast("Failed saving quicklink", message)}
        />
      ) : null}

      {libraryOpen ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setLibraryOpen(false)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt quicklinks-library" role="dialog">
            <div className="action-panel__title">Add from Library</div>
            <ul className="quicklinks-library__list">
              {FEATURED_LIBRARY.map((featured) => (
                <li key={featured.name}>
                  <button
                    type="button"
                    className="action"
                    onClick={async () => {
                      setLibraryOpen(false);
                      try {
                        await ipc.backend(
                          "quicklinks.importEntries",
                          { entries: [{ name: featured.name, link: featured.link }] },
                          { module: "backend" },
                        );
                        showToast("Import successful");
                        refresh();
                      } catch (cause) {
                        showToast("Import failed", cause instanceof Error ? cause.message : String(cause));
                      }
                    }}
                  >
                    <span>{featured.name}</span>
                    <span className="list__subtitle">{featured.link}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {imported ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setImported(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="dialog">
            <div className="action-panel__title">Import Quicklinks</div>
            <div className="clipboard-confirm__body">
              {imported.length} quicklink(s) found in the file.
            </div>
            <div className="clipboard-confirm__actions">
              <button type="button" className="action" onClick={() => setImported(null)}>
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="action action--primary"
                onClick={async () => {
                  const entries = imported;
                  setImported(null);
                  try {
                    const result = (await ipc.backend(
                      "quicklinks.importEntries",
                      { entries },
                      { module: "backend" },
                    )) as { added?: number; skipped?: number };
                    showToast(
                      "Import successful",
                      `${result.added ?? 0} quicklink(s) added, ${result.skipped ?? 0} duplicate(s) skipped`,
                    );
                    refresh();
                  } catch (cause) {
                    showToast("Import failed", cause instanceof Error ? cause.message : String(cause));
                  }
                }}
              >
                <span>Import {imported.length} Quicklink(s)</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importError ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setImportError(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">Import Quicklinks</div>
            <div className="clipboard-confirm__body">{importError}</div>
            <div className="clipboard-confirm__actions">
              <button type="button" className="action" onClick={() => setImportError(null)} autoFocus>
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmingDelete ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirmingDelete(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">{`Delete Quicklink "${confirmingDelete.name}"`}</div>
            <div className="clipboard-confirm__body">Warning: This action cannot be undone.</div>
            <label className="quicklinks-confirm__remember">
              <input
                type="checkbox"
                checked={rememberDelete}
                onChange={(event) => setRememberDelete(event.target.checked)}
              />
              Show this warning next time
            </label>
            <div className="clipboard-confirm__actions">
              <button type="button" className="action" onClick={() => setConfirmingDelete(null)}>
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="action action--destructive"
                onClick={async () => {
                  const entry = confirmingDelete;
                  setConfirmingDelete(null);
                  localStorage.setItem("raycast-mini:quicklinks-warn-delete", rememberDelete ? "1" : "0");
                  await runDelete(entry);
                }}
              >
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmingDeleteAll ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirmingDeleteAll(false)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">Delete All Local Quicklinks?</div>
            <div className="clipboard-confirm__body">Warning: This action cannot be undone.</div>
            <div className="clipboard-confirm__actions">
              <button type="button" className="action" onClick={() => setConfirmingDeleteAll(false)}>
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="action action--destructive"
                onClick={async () => {
                  setConfirmingDeleteAll(false);
                  try {
                    await ipc.backend("quicklinks.deleteAll", {}, { module: "backend" });
                    showToast("All local quicklinks deleted");
                  } catch (cause) {
                    showToast("Failed to delete all quicklinks", cause instanceof Error ? cause.message : String(cause));
                  }
                }}
              >
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The shared argument form: one field per placeholder, dropdowns for `options`. */
export function ArgsForm({
  state,
  onCancel,
  onSubmit,
}: {
  state: ArgsState;
  onCancel: () => void;
  onSubmit: (values: string[]) => Promise<void>;
}) {
  const [values, setValues] = useState<string[]>(state.values);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="action-panel">
      <div className="action-panel__backdrop" onClick={onCancel} aria-hidden />
      <form
        className="action-panel__popover clipboard-prompt quicklinks-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const missing = state.entry.args.find((arg, index) => arg.required && !values[index]?.trim());
          if (missing) {
            setError(`Please enter a value for "${missing.placeholder}"`);
            return;
          }
          setBusy(true);
          await onSubmit(values);
          setBusy(false);
        }}
      >
        <div className="action-panel__title">{state.entry.name}</div>
        {state.entry.args.map((arg: QuicklinkArg, index) => (
          <div key={arg.name} className="clipboard-tag-editor__field">
            <label className="quicklinks-form__label" htmlFor={`quicklink-arg-${index}`}>
              {arg.placeholder}
              {arg.required ? " *" : ""}
            </label>
            {arg.type === "dropdown" ? (
              <select
                id={`quicklink-arg-${index}`}
                autoFocus={index === 0}
                value={values[index] ?? ""}
                onChange={(event) =>
                  setValues((current) => current.map((value, position) => (position === index ? event.target.value : value)))
                }
              >
                <option value="">Select…</option>
                {(arg.data ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`quicklink-arg-${index}`}
                autoFocus={index === 0}
                value={values[index] ?? ""}
                placeholder={arg.placeholder}
                onChange={(event) =>
                  setValues((current) => current.map((value, position) => (position === index ? event.target.value : value)))
                }
              />
            )}
          </div>
        ))}
        {error ? <div className="quicklinks-form__error">{error}</div> : null}
        <div className="clipboard-confirm__actions">
          <button type="button" className="action" onClick={onCancel}>
            <span>Cancel</span>
          </button>
          <button type="submit" className="action action--primary" disabled={busy}>
            <span>Open Quicklink</span>
          </button>
        </div>
      </form>
    </div>
  );
}

/** The create/edit/duplicate form, with the confirmed labels, help text and validation errors. */
function EditorForm({
  editing,
  applications,
  onCancel,
  onSaved,
  onError,
}: {
  editing: EditingState;
  applications: ApplicationCommand[];
  onCancel: () => void;
  onSaved: (title: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(editing.name);
  const [link, setLink] = useState(editing.link);
  const [openWith, setOpenWith] = useState(editing.openWith);
  const [tags, setTags] = useState(editing.tags);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const submitTitle =
    editing.mode === "edit" ? "Update Quicklink" : editing.mode === "duplicate" ? "Duplicate Quicklink" : "Save Quicklink";

  return (
    <div className="action-panel">
      <div className="action-panel__backdrop" onClick={onCancel} aria-hidden />
      <form
        className="action-panel__popover clipboard-prompt quicklinks-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const validation: string[] = [];
          if (!name.trim()) validation.push("Please enter a name");
          if (!link.trim()) validation.push("Please enter a link");
          if (validation.length) {
            setErrors(validation);
            return;
          }
          setBusy(true);
          try {
            const payload = {
              name: name.trim(),
              link: link.trim(),
              openWith: openWith || null,
              tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
            };
            if (editing.mode === "edit" && editing.id) {
              await ipc.backend("quicklinks.update", { id: editing.id, ...payload }, { module: "backend" });
              onSaved("Updated Quicklink");
            } else {
              await ipc.backend("quicklinks.save", payload, { module: "backend" });
              onSaved("Created Quicklink");
            }
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="action-panel__title">{editing.mode === "create" ? "Create Quicklink" : submitTitle}</div>
        <div className="clipboard-tag-editor__field">
          <label className="quicklinks-form__label" htmlFor="quicklink-link">
            Link
          </label>
          <div className="quicklinks-form__link">
            <input
              id="quicklink-link"
              ref={linkRef}
              value={link}
              placeholder="https://…"
              onChange={(event) => setLink(event.target.value)}
            />
            <button
              type="button"
              className="action"
              title="Add Placeholder"
              onClick={() => {
                setLink((current) => `${current}{`);
                requestAnimationFrame(() => linkRef.current?.focus());
              }}
            >
              <span>{"{ }"}</span>
            </button>
          </div>
        </div>
        <div className="clipboard-tag-editor__field">
          <label className="quicklinks-form__label" htmlFor="quicklink-name">
            Name &amp; Icon
          </label>
          <input
            id="quicklink-name"
            value={name}
            placeholder="Quicklink name"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="clipboard-tag-editor__field">
          <label className="quicklinks-form__label" htmlFor="quicklink-openwith">
            Open With
          </label>
          <select id="quicklink-openwith" value={openWith} onChange={(event) => setOpenWith(event.target.value)}>
            <option value="">System Default</option>
            {applications.map((application) => (
              <option key={application.payload.id} value={application.payload.path ?? ""}>
                {application.payload.name}
              </option>
            ))}
          </select>
        </div>
        <div className="clipboard-tag-editor__field">
          <label className="quicklinks-form__label" htmlFor="quicklink-tags">
            Tags
          </label>
          <input
            id="quicklink-tags"
            value={tags}
            placeholder="Tags"
            onChange={(event) => setTags(event.target.value)}
          />
        </div>
        <div className="quicklinks-form__help">
          Include {"{Dynamic Placeholders}"} to add arguments or context like the selected or copied text in
          the link
        </div>
        {errors.length > 0 ? (
          <div className="quicklinks-form__error">
            {errors.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        ) : null}
        <div className="clipboard-confirm__actions">
          <button type="button" className="action" onClick={onCancel}>
            <span>Cancel</span>
          </button>
          <button type="submit" className="action action--primary" disabled={busy}>
            <span>{submitTitle}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
