// The Quicklinks command views (`quicklinks/create|export|import|search`).
//
// Ported from the shipped `SearchQuicklinksView` + `CreateQuicklinkForm` + the import/export pages
// (see `docs/quicklinks-spec.md`): each command renders its own full-window view — the search list
// with the link preview + Information pane, the Create form (Link textarea with placeholder tools,
// Name & Icon, Open With, Tags), and the Import/Export states with the centered artwork. The
// argument form and the library/import/delete dialogs run in-view, the way the clone's other
// command views host their dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { ipc } from "../../ipc";
import { RaycastIcon } from "../../icons";
import { rankEntries } from "../../matching";
import type { ApplicationCommand } from "../../applications";
import { CommandFooter, CommandTile, type InternalArea } from "../../commandChrome";
import {
  FEATURED_LIBRARY,
  isFileLink,
  openQuicklink,
  copyResolvedLink,
  parseImportPayload,
  useQuicklinks,
  warnBeforeDelete,
  type ImportEntry,
  type QuicklinkArg,
  type QuicklinkEntry,
} from "../../quicklinks";

export type QuicklinksCommandName = "search" | "create" | "import" | "export";

const ICON_CHOICES = [
  "link", "globe", "star", "folder", "file", "tag", "bolt", "gear", "code", "person", "clock", "mail", "music", "video", "image", "text",
];

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

/** The link preview renders unresolved arguments as an ellipsis, like the shipped detail pane. */
function previewLink(link: string): string {
  return link.replace(/\{argument[^}]*\}/g, "…");
}

/** A local name suggestion from a pasted link: the hostname (or the file stem). */
function nameFromValue(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    if (host) return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    /* not an absolute URL — fall through to the file stem */
  }
  const stem = value.split(/[\\/]/).filter(Boolean).pop() ?? value;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** Anything that reads as a link or path: a scheme, www., a drive/UNC path, or a dotted domain. */
function isLinkish(value: string): boolean {
  if (value.length < 4 || value.length > 2048 || /\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  if (/^www\./i.test(value)) return true;
  if (/^[a-z]:[\\/]|^\\\\/i.test(value)) return true;
  return /\.[a-z]{2,24}([/?#:]|$)/i.test(value);
}

function quicklinkIcon(entry: QuicklinkEntry, size = 16): JSX.Element {
  if (entry.icon && ICON_CHOICES.includes(entry.icon)) {
    return (
      <span className="icon" aria-hidden>
        <RaycastIcon name={entry.icon} size={size} />
      </span>
    );
  }
  return (
    <span
      className="icon quicklinks-monogram"
      style={{ background: `hsl(${monogramHue(entry.name)} 45% 30%)` }}
      aria-hidden
    >
      {entry.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

interface EditingState {
  mode: "create" | "edit" | "duplicate";
  id?: string;
  name: string;
  link: string;
  openWith: string;
  tags: string;
  icon: string;
}

interface ArgsState {
  entry: QuicklinkEntry;
  values: string[];
  error: string | null;
}

export type { ArgsState };

export interface QuicklinksViewProps {
  command: QuicklinksCommandName;
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
  command,
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
  applications,
  createLink,
  onConsumeCreateLink,
}: QuicklinksViewProps) {
  const { quicklinks, refresh } = useQuicklinks();
  // The create form also serves Edit/Duplicate pushed from the search view.
  const [form, setForm] = useState<EditingState | null>(
    command === "create" ? { mode: "create", name: "", link: "", openWith: "", tags: "", icon: "" } : null,
  );

  useEffect(() => {
    if (createLink) {
      setForm({ mode: "create", name: "", link: createLink, openWith: "", tags: "", icon: "" });
      onConsumeCreateLink?.();
    }
  }, [createLink, onConsumeCreateLink]);

  if (command === "import") {
    return <ImportQuicklinks showToast={showToast} onBack={onBack} />;
  }

  if (command === "export") {
    return <ExportQuicklinks showToast={showToast} onBack={onBack} />;
  }

  if (form) {
    return (
      <CreateQuicklinkForm
        editing={form}
        applications={applications}
        onBack={() => setForm(null)}
        onClose={() => {
          setForm(null);
          onBack();
        }}
        onSaved={(title) => {
          setForm(null);
          showToast(title);
          refresh();
        }}
        onError={(message) => showToast("Failed saving quicklink", message)}
      />
    );
  }

  return (
    <SearchQuicklinks
      searchText={searchText}
      onSearchTextChange={onSearchTextChange}
      showToast={showToast}
      onBack={onBack}
      closeMainWindow={closeMainWindow}
      applications={applications}
      onEdit={setForm}
      refresh={refresh}
      quicklinks={quicklinks}
    />
  );
}

// -------------------------------------------------------------------------------------------
// Search Quicklinks
// -------------------------------------------------------------------------------------------

interface SearchQuicklinksProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
  onEdit: (state: EditingState) => void;
  refresh: () => void;
  quicklinks: QuicklinkEntry[];
}

function SearchQuicklinks({
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
  applications,
  onEdit,
  refresh,
  quicklinks,
}: SearchQuicklinksProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [argsState, setArgsState] = useState<ArgsState | null>(null);
  const [openWithState, setOpenWithState] = useState<QuicklinkEntry | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<QuicklinkEntry | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [rememberDelete, setRememberDelete] = useState(!warnBeforeDelete());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const entry of quicklinks) for (const tag of entry.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [quicklinks]);

  const ranked = useMemo(() => {
    const filtered = tagFilter ? quicklinks.filter((entry) => entry.tags.includes(tagFilter)) : quicklinks;
    const trimmed = searchText.trim();
    if (!trimmed) return filtered.map((entry, index) => ({ entry, value: index }));
    const rankedEntries = rankEntries(
      filtered.map((entry) => ({
        entry,
        title: entry.name,
        subtitle: entry.link,
        keywords: [entry.link.toLowerCase(), ...entry.tags.map((tag) => tag.toLowerCase())],
      })),
      trimmed,
      "medium",
      new Map(filtered.map((entry) => [entry.name, entry.openCount])),
    );
    return rankedEntries.map((rankedEntry) => ({ entry: rankedEntry.entry.entry, value: 0 }));
  }, [quicklinks, searchText, tagFilter]);

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
  }, [searchText, tagFilter]);

  useEffect(() => {
    const container = listRef.current?.parentElement;
    const row = listRef.current?.querySelector<HTMLElement>('.list__row[data-selected="true"]');
    if (!container || !row) return;
    const rowRect = row.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (rowRect.top < viewRect.top) container.scrollTop -= viewRect.top - rowRect.top + 4;
    else if (rowRect.bottom > viewRect.bottom) container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
  }, [selectedIndex, rows.length, searchText, tagFilter]);

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
      if (!entry && actionId !== "quicklinks:create" && actionId !== "quicklinks:library" && actionId !== "quicklinks:deleteAll") return;
      switch (actionId) {
        case "quicklinks:create":
          onEdit({ mode: "create", name: "", link: "", openWith: "", tags: "", icon: "" });
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
            onEdit({ mode: "edit", id: entry.id, name: entry.name, link: entry.link, openWith: entry.openWith ?? "", tags: entry.tags.join(", "), icon: entry.icon ?? "" });
          }
          return;
        case "quicklinks:duplicate":
          if (entry) {
            onEdit({ mode: "duplicate", name: entry.name, link: entry.link, openWith: entry.openWith ?? "", tags: entry.tags.join(", "), icon: entry.icon ?? "" });
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
    [selected, activate, showToast, runDelete, onEdit],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (argsState || openWithState || libraryOpen || confirmingDelete || confirmingDeleteAll) return;
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
  }, [rows, selectedIndex, activate, argsState, openWithState, libraryOpen, confirmingDelete, confirmingDeleteAll]);

  const actionGroups = useMemo<ActionGroup[]>(() => {
    const general: ActionGroup["actions"] = [];
    const copy: ActionGroup["actions"] = [];
    const favorites: ActionGroup["actions"] = [];
    const manage: ActionGroup["actions"] = [];
    const remove: ActionGroup["actions"] = [];
    if (selected) {
      general.push({ id: "quicklinks:open", title: "Open Quicklink", itemId: "" });
      general.push({ id: "quicklinks:openWith", title: "Open With…", itemId: "" });
      if (isFileLink(selected.link)) {
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
          {selected && selected.args.length > 0 ? (
            <span className="searchbar__accessory" aria-hidden>
              {selected.args[0].placeholder}
            </span>
          ) : null}
        </div>

        <select
          className="header-dropdown"
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          aria-label="Filter by tag"
        >
          <option value="">All Tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </header>

      <main className="window__body clipboard-body">
        {rows.length === 0 ? (
          <div className="state">
            <div className="state__title">No Quicklinks Found</div>
            <div className="state__message">Save frequently used links for quick access.</div>
            <button
              type="button"
              className="action action--primary"
              onClick={() => onEdit({ mode: "create", name: "", link: "", openWith: "", tags: "", icon: "" })}
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
                            {quicklinkIcon(entry)}
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
              <aside className="clipboard-detail quicklinks-detail">
                <div className="quicklink-preview">
                  <span>{previewLink(selected.link)}</span>
                </div>
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
                      <span className="clipboard-detail__value clipboard-detail__value--pills">
                        {selected.tags.map((tag) => (
                          <span key={tag} className="tag-pill">
                            {tag}
                          </span>
                        ))}
                      </span>
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
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </main>

      <CommandFooter
        area="quicklinks"
        title="Search Quicklinks"
        primary={selected ? { label: "Open Quicklink", key: "", onPress: () => activate(selected) } : undefined}
        actions={
          <button type="button" className="footer-action footer-action--kbd" onClick={() => setPanelOpen((open) => !open)}>
            Actions <span className="kbd">Ctrl</span>
            <span className="kbd">K</span>
          </button>
        }
      />

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

// -------------------------------------------------------------------------------------------
// Open With picker — the shipped dropdown: app rows with icons, the system default browser first
// (labelled "Default"), and a search field pinned at the bottom.
// -------------------------------------------------------------------------------------------

function OpenWithPicker({
  applications,
  value,
  onChange,
}: {
  applications: ApplicationCommand[];
  value: string;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [defaultPath, setDefaultPath] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ipc
      .backend("applications.getDefaultBrowser", {}, { module: "frontend" })
      .then((response) => setDefaultPath((response as { path?: string | null }).path ?? null))
      .catch(() => undefined);
  }, []);

  // Raycast preselects the user's default browser; an untouched picker adopts it once known.
  useEffect(() => {
    if (defaultPath && !value) onChange(defaultPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPath]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const byPath = useCallback(
    (path: string | null | undefined) =>
      path ? applications.find((app) => (app.payload.path ?? "").toLowerCase() === path.toLowerCase()) : null,
    [applications],
  );
  const defaultApp = byPath(defaultPath);
  const selected = byPath(value);

  const list = useMemo(() => {
    const rest = applications.filter((app) => app !== defaultApp);
    const ordered = defaultApp ? [defaultApp, ...rest] : applications;
    const trimmed = query.trim().toLowerCase();
    return trimmed ? ordered.filter((app) => app.payload.name.toLowerCase().includes(trimmed)) : ordered;
  }, [applications, defaultApp, query]);

  useEffect(() => {
    if (!open) return;
    const index = list.findIndex((app) => app === selected);
    setHighlight(Math.max(0, index));
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (app: ApplicationCommand) => {
    onChange(app.payload.path ?? "");
    setOpen(false);
    setQuery("");
  };

  const display = selected ?? defaultApp;

  return (
    <div className="openwith" ref={rootRef}>
      <button
        type="button"
        id="quicklink-openwith"
        className="command-form__picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {display?.payload.icon ? (
          <img className="openwith__icon" src={display.payload.icon} alt="" />
        ) : (
          <RaycastIcon name="app-window-list" size={14} />
        )}
        <span className="openwith__name">{display?.payload.name ?? "System Default"}</span>
        <svg className="openwith__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden>
          <path d="m1 1 4 4 4-4" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="openwith__popover" role="listbox">
          <ul className="openwith__list">
            {list.map((app, index) => (
              <li key={app.payload.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  className="openwith__row"
                  data-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(app)}
                >
                  {app.payload.icon ? (
                    <img className="openwith__icon" src={app.payload.icon} alt="" />
                  ) : (
                    <span className="openwith__icon openwith__icon--blank" aria-hidden />
                  )}
                  <span className="openwith__name">{app.payload.name}</span>
                  {app === defaultApp ? <span className="openwith__default">Default</span> : null}
                </button>
              </li>
            ))}
            {list.length === 0 ? <li className="openwith__empty">No applications found</li> : null}
          </ul>
          <input
            ref={searchRef}
            className="openwith__search"
            placeholder="Search…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((index) => Math.min(index + 1, Math.max(list.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const app = list[highlight];
                if (app) choose(app);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
              event.stopPropagation();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Create Quicklink (also serves Edit / Duplicate)
// -------------------------------------------------------------------------------------------

function CreateQuicklinkForm({
  editing,
  applications,
  onBack,
  onClose,
  onSaved,
  onError,
}: {
  editing: EditingState;
  applications: ApplicationCommand[];
  /** Pop back to the search view (Edit/Duplicate pushed from there). */
  onBack: () => void;
  /** The create command has no search view underneath — hand control back to the root. */
  onClose: () => void;
  onSaved: (title: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(editing.name);
  const [link, setLink] = useState(editing.link);
  const [openWith, setOpenWith] = useState(editing.openWith);
  const [tags, setTags] = useState(editing.tags);
  const [icon, setIcon] = useState(editing.icon);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const linkRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Raycast seeds the form from the clipboard: a copied link lands in the textarea and a
  // hostname-derived suggestion fills Name & Icon. Everything stays local — no page fetch.
  useEffect(() => {
    if (editing.mode !== "create") return;
    let cancelled = false;
    const seed = async () => {
      let value = "";
      try {
        const response = (await ipc.backend("clipboard.read", {}, { module: "frontend" })) as { value?: string | null };
        value = (response.value ?? "").trim();
      } catch {
        value = "";
      }
      if (!value) {
        try {
          value = (await navigator.clipboard.readText()).trim();
        } catch {
          return;
        }
      }
      if (cancelled || !value || !isLinkish(value)) return;
      if ((linkRef.current?.value ?? "").length > 0) return;
      setLink((current) => current || value);
      setName((current) => current || nameFromValue(value));
    };
    const run = async () => {
      await seed();
      // The launcher may still be settling when the form mounts; try once more if still empty.
      if (!cancelled && !(linkRef.current?.value ?? "").length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!cancelled) await seed();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTitle =
    editing.mode === "edit" ? "Update Quicklink" : editing.mode === "duplicate" ? "Duplicate Quicklink" : "Save Quicklink";

  const insertAtCursor = (value: string) => {
    const element = linkRef.current;
    if (!element) {
      setLink((current) => `${current}${value}`);
      return;
    }
    const start = element.selectionStart ?? link.length;
    const end = element.selectionEnd ?? link.length;
    setLink((current) => `${current.slice(0, start)}${value}${current.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const insertPath = async (kind: "file" | "folder") => {
    try {
      const response = (await ipc.backend(
        "fileSystem.showOpenFileDialog",
        kind === "folder" ? { title: "Choose a folder" } : { title: "Choose a file" },
        { module: "frontend" },
      )) as { path?: string | null };
      if (response.path) insertAtCursor(response.path);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = async () => {
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
        icon: icon || null,
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
  };

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" tabIndex={-1} className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="footer__spacer" />
        <button
          type="button"
          tabIndex={-1}
          className="command-guide-link"
          onClick={() => void ipc.backend("shell.openUrl", { url: "https://manual.raycast.com/quicklinks" }, { module: "backend" })}
        >
          Quicklinks Guide
        </button>
      </header>

      <main className="window__body command-page">
        <form
          ref={formRef}
          className="command-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        >
          <div className="command-form__row command-form__row--top">
            <label className="command-form__label" htmlFor="quicklink-link">
              Link
            </label>
            <div className="command-form__field">
              <div className="command-form__textarea-wrap">
                <textarea
                  id="quicklink-link"
                  ref={linkRef}
                  className="command-form__textarea"
                  rows={3}
                  value={link}
                  placeholder="https://www.google.com/search?q={argument}"
                  onChange={(event) => setLink(event.target.value)}
                />
                <div className="command-form__textarea-tools">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="icon icon--plain"
                    title="Insert placeholder"
                    onClick={() => insertAtCursor("{argument name=\"Argument\"}")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button type="button" tabIndex={-1} className="icon icon--plain" title="Insert a file path" onClick={() => void insertPath("file")}>
                    <RaycastIcon name="file" size={14} />
                  </button>
                  <button type="button" tabIndex={-1} className="icon icon--plain" title="Insert a folder path" onClick={() => void insertPath("folder")}>
                    <RaycastIcon name="folder" size={14} />
                  </button>
                </div>
              </div>
              <div className="command-form__help">
                Include{" "}
                <button type="button" tabIndex={-1} className="command-form__help-link" onClick={() => insertAtCursor('{argument name="Argument"}')}>
                  {"{Dynamic Placeholders}"}
                </button>{" "}
                to add arguments or context like the selected or copied text in the link
              </div>
            </div>
          </div>

          <div className="command-form__row">
            <label className="command-form__label" htmlFor="quicklink-name">
              Name &amp; Icon
            </label>
            <div className="command-form__field">
              <div className="command-form__paired">
                <input
                  id="quicklink-name"
                  value={name}
                  placeholder="Quicklink name"
                  onChange={(event) => setName(event.target.value)}
                />
                <select
                  className="command-form__iconpicker"
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  aria-label="Icon"
                >
                  <option value="">Link</option>
                  {ICON_CHOICES.filter((choice) => choice !== "link").map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="command-form__row">
            <label className="command-form__label" htmlFor="quicklink-openwith">
              Open With
            </label>
            <div className="command-form__field">
              <OpenWithPicker applications={applications} value={openWith} onChange={setOpenWith} />
            </div>
          </div>

          <div className="command-form__row">
            <label className="command-form__label" htmlFor="quicklink-tags">
              Tags
            </label>
            <div className="command-form__field">
              <input id="quicklink-tags" value={tags} placeholder="Tags" onChange={(event) => setTags(event.target.value)} />
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="command-form__errors">
              {errors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          ) : null}
        </form>
      </main>

      <CommandFooter
        area="quicklinks"
        title="Create Quicklink"
        primary={{ label: submitTitle, key: "Ctrl", onPress: () => void submit() }}
      />
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Import / Export states
// -------------------------------------------------------------------------------------------

function ImportQuicklinks({
  showToast,
  onBack,
}: {
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
}) {
  const [confirming, setConfirming] = useState<ImportEntry[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const { refresh } = useQuicklinks();

  const pickFile = async () => {
    try {
      const response = (await ipc.backend(
        "fileSystem.showOpenFileDialog",
        { title: "Import Quicklinks", allowedTypes: ["json"] },
        { module: "frontend" },
      )) as { path?: string | null };
      if (!response.path) return;
      const file = (await ipc.backend("fileSystem.readFile", { path: response.path }, { module: "frontend" })) as {
        content?: string;
      };
      const parsed = parseImportPayload(file.content ?? "");
      if ("error" in parsed) {
        setParseError(parsed.error);
        setConfirming(null);
      } else {
        setParseError(null);
        setConfirming(parsed.entries);
      }
    } catch (cause) {
      showToast("Import failed", cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <main className="window__body drop-state">
        <span className="drop-state__icon" aria-hidden>
          <CommandTile area="quicklinks" size={64} />
          <span className="drop-state__badge drop-state__badge--down">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 4v12m0 0 5-5m-5 5-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
        <div className="drop-state__title">Import Quicklinks</div>
        <div className="drop-state__subtitle">Select file from your computer to continue</div>
      </main>

      <CommandFooter area="quicklinks" title="Import Quicklinks" primary={{ label: "Select file", key: "", onPress: () => void pickFile() }} />

      {confirming ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirming(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="dialog">
            <div className="action-panel__title">Import Quicklinks</div>
            <div className="clipboard-confirm__body">{confirming.length} quicklink(s) found in the file.</div>
            <div className="clipboard-confirm__actions">
              <button type="button" className="action" onClick={() => setConfirming(null)}>
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="action action--primary"
                onClick={async () => {
                  const entries = confirming;
                  setConfirming(null);
                  try {
                    const result = (await ipc.backend("quicklinks.importEntries", { entries }, { module: "backend" })) as {
                      added?: number;
                      skipped?: number;
                    };
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
                <span>Import {confirming.length} Quicklink(s)</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {parseError ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setParseError(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">Import Quicklinks</div>
            <div className="clipboard-confirm__body">{parseError}</div>
            <div className="clipboard-confirm__actions">
              <button type="button" className="action" onClick={() => setParseError(null)} autoFocus>
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExportQuicklinks({
  showToast,
  onBack,
}: {
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
}) {
  const runExport = async () => {
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
  };

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <main className="window__body drop-state">
        <span className="drop-state__icon" aria-hidden>
          <CommandTile area="quicklinks" size={64} />
          <span className="drop-state__badge drop-state__badge--up">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 20V8m0 0 5 5m-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
        <div className="drop-state__title">Export Quicklinks</div>
        <div className="drop-state__subtitle">Choose an output location to continue</div>
      </main>

      <CommandFooter area="quicklinks" title="Export Quicklinks" primary={{ label: "Export", key: "", onPress: () => void runExport() }} />
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
