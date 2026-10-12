// The `Search Notes` command view (docs/notes-spec.md, "Search Notes view (in the launcher)"):
// recency sections (Pinned/Today/Yesterday/This Week/This Month/Older), the Information pane with
// the live preview and search-term highlighting, and the confirmed action set.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { ipc } from "../../ipc";
import { RaycastIcon } from "../../icons";
import { alertStore } from "../../alertStore";
import { CommandFooter } from "../../commandChrome";
import { openNotesWindow, useNotes, noteDeeplink, filterNotes, groupNotesByRecency, type NoteEntry } from "../../notes";

export type NotesCommandName = "open" | "create" | "search";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Splits the preview into plain and highlighted chunks around the query terms. */
function highlightPreview(text: string, query: string): Array<{ value: string; hit: boolean }> {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [{ value: text, hit: false }];
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((chunk) => chunk !== "")
    .map((chunk) => ({ value: chunk, hit: pattern.test(chunk) && terms.includes(chunk.toLowerCase()) }));
}

export interface SearchNotesViewProps {
  command: NotesCommandName;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
  onCreateQuicklink?: (note: NoteEntry) => void;
}

export function SearchNotesView({
  searchText,
  onSearchTextChange,
  showToast,
  closeMainWindow,
  onCreateQuicklink,
}: SearchNotesViewProps) {
  const { notes, refresh } = useNotes();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => filterNotes(notes, searchText), [notes, searchText]);
  const sections = useMemo(() => groupNotesByRecency(filtered, Date.now()), [filtered]);
  const rows = useMemo(() => sections.flatMap((section) => section.notes), [sections]);
  const selected = rows[selectedIndex] ?? null;

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

  const runOpen = useCallback(
    (entry: NoteEntry) => {
      closeMainWindow();
      openNotesWindow({ noteId: entry.id });
    },
    [closeMainWindow],
  );

  const runCreateNote = useCallback(() => {
    closeMainWindow();
    openNotesWindow({ create: true });
  }, [closeMainWindow]);

  const copyAs = useCallback(
    async (entry: NoteEntry, format: "markdown" | "html" | "plain") => {
      try {
        let content = entry.text;
        if (format === "html") {
          content = ((await ipc.backend("notes.markdownToHtml", { text: entry.text }, { module: "backend" })) as { html: string }).html;
        } else if (format === "plain") {
          content = ((await ipc.backend("notes.toPlainText", { text: entry.text }, { module: "backend" })) as { text: string }).text;
        }
        await navigator.clipboard.writeText(content);
        const toast = format === "markdown" ? "Copied as Markdown" : format === "html" ? "Copied as HTML" : "Copied as Plain Text";
        showToast(toast);
      } catch (cause) {
        showToast("Copy failed", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [showToast],
  );

  const runDuplicate = useCallback(
    async (entry: NoteEntry) => {
      try {
        await ipc.backend("notes.create", { text: entry.text, title: `${entry.title} (Copy)` }, { module: "backend" });
        showToast("Duplicated Note");
      } catch (cause) {
        showToast("Could not duplicate note", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [showToast],
  );

  const runDelete = useCallback(
    async (entry: NoteEntry) => {
      try {
        await ipc.backend("notes.delete", { id: entry.id }, { module: "backend" });
        showToast("Note moved to Recently Deleted");
      } catch (cause) {
        showToast("Could not delete note", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [showToast],
  );

  const runExport = useCallback(
    async (entry: NoteEntry, format: "md" | "html" | "txt") => {
      try {
        let content = entry.text;
        if (format === "html") {
          content = ((await ipc.backend("notes.markdownToHtml", { text: entry.text }, { module: "backend" })) as { html: string }).html;
        } else if (format === "txt") {
          content = ((await ipc.backend("notes.toPlainText", { text: entry.text }, { module: "backend" })) as { text: string }).text;
        }
        const extension = format === "md" ? "md" : format === "html" ? "html" : "txt";
        const response = (await ipc.backend(
          "fileSystem.showSaveFileDialog",
          { title: "Export Note", fileName: `${entry.title}.${extension}` },
          { module: "frontend" },
        )) as { path?: string | null };
        if (!response.path) return;
        await ipc.backend("fileSystem.writeFile", { path: response.path, content }, { module: "frontend" });
        showToast(`Exported as ${format === "md" ? "Markdown" : format === "html" ? "HTML" : "Plain Text"}`, response.path);
      } catch (cause) {
        showToast("Export failed", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [showToast],
  );

  const runAction = useCallback(
    async (actionId: string) => {
      setPanelOpen(false);
      const entry = selected;
      if (!entry && actionId !== "notes:create" && actionId !== "notes:deleteAll") return;
      switch (actionId) {
        case "notes:open":
          if (entry) runOpen(entry);
          return;
        case "notes:create":
          runCreateNote();
          return;
        case "notes:pin":
          if (entry) {
            await ipc.backend("notes.pin", { id: entry.id }, { module: "backend" });
            showToast("Pinned Note");
          }
          return;
        case "notes:unpin":
          if (entry) {
            await ipc.backend("notes.unpin", { id: entry.id }, { module: "backend" });
            showToast("Unpinned Note");
          }
          return;
        case "notes:moveUp":
          if (entry) {
            await ipc.backend("notes.movePinnedUp", { id: entry.id }, { module: "backend" });
            showToast("Moved Note up");
          }
          return;
        case "notes:moveDown":
          if (entry) {
            await ipc.backend("notes.movePinnedDown", { id: entry.id }, { module: "backend" });
            showToast("Moved Note down");
          }
          return;
        case "notes:copyContent":
          if (entry) {
            await navigator.clipboard.writeText(entry.text);
            showToast("Copied Content");
          }
          return;
        case "notes:copyMarkdown":
          if (entry) void copyAs(entry, "markdown");
          return;
        case "notes:copyHtml":
          if (entry) void copyAs(entry, "html");
          return;
        case "notes:copyPlainText":
          if (entry) void copyAs(entry, "plain");
          return;
        case "notes:copyDeeplink":
          if (entry) {
            await navigator.clipboard.writeText(noteDeeplink(entry.id));
            showToast("Copied Deeplink");
          }
          return;
        case "notes:createQuicklink":
          if (entry) onCreateQuicklink?.(entry);
          return;
        case "notes:exportMarkdown":
          if (entry) void runExport(entry, "md");
          return;
        case "notes:exportHtml":
          if (entry) void runExport(entry, "html");
          return;
        case "notes:exportPlainText":
          if (entry) void runExport(entry, "txt");
          return;
        case "notes:duplicate":
          if (entry) void runDuplicate(entry);
          return;
        case "notes:delete":
          if (entry) void runDelete(entry);
          return;
        case "notes:deleteAll":
          alertStore.open({
            title: "Delete All Notes?",
            description: "Warning: this operation cannot be undone.",
            primaryAction: {
              title: "Delete",
              style: "destructive",
              action: async () => {
                await ipc.backend("notes.deleteAll", {}, { module: "backend" });
                showToast("Deleted All Notes");
              },
            },
            secondaryAction: { title: "Cancel", action: () => undefined },
          });
          return;
        default:
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, runOpen, runCreateNote, copyAs, runDuplicate, runDelete, runExport, showToast, onCreateQuicklink],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
        const entry = rows[selectedIndex];
        if (!entry) return;
        event.preventDefault();
        runOpen(entry);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, selectedIndex, runOpen]);

  const actionGroups = useMemo<ActionGroup[]>(() => {
    const open: ActionGroup["actions"] = [];
    const manage: ActionGroup["actions"] = [];
    const share: ActionGroup["actions"] = [];
    const remove: ActionGroup["actions"] = [];
    if (selected) {
      open.push({ id: "notes:open", title: "Open Note", itemId: "" });
      if (selected.pinned === null) manage.push({ id: "notes:pin", title: "Pin Note", itemId: "" });
      else {
        manage.push({ id: "notes:unpin", title: "Unpin Note", itemId: "" });
        manage.push({ id: "notes:moveUp", title: "Move Up", itemId: "" });
        manage.push({ id: "notes:moveDown", title: "Move Down", itemId: "" });
      }
      manage.push({ id: "notes:duplicate", title: "Duplicate Note", itemId: "" });
      share.push({ id: "notes:copyContent", title: "Copy Content", itemId: "" });
      share.push({ id: "notes:copyMarkdown", title: "Copy as Markdown", itemId: "" });
      share.push({ id: "notes:copyHtml", title: "Copy as HTML", itemId: "" });
      share.push({ id: "notes:copyPlainText", title: "Copy as Plain Text", itemId: "" });
      share.push({ id: "notes:copyDeeplink", title: "Copy Deeplink", itemId: "" });
      share.push({ id: "notes:createQuicklink", title: "Create Quicklink", itemId: "" });
      share.push({ id: "notes:exportMarkdown", title: "Export as Markdown", itemId: "" });
      share.push({ id: "notes:exportHtml", title: "Export as HTML", itemId: "" });
      share.push({ id: "notes:exportPlainText", title: "Export as Plain Text", itemId: "" });
      remove.push({ id: "notes:delete", title: "Delete Note", itemId: "" });
    }
    open.push({ id: "notes:create", title: "Create Note", itemId: "" });
    remove.push({ id: "notes:deleteAll", title: "Delete All Notes", itemId: "" });
    return [
      { name: "open", actions: open },
      { name: "manage", actions: manage },
      { name: "share", actions: share },
      { name: "delete", actions: remove },
    ].filter((group) => group.actions.length > 0);
  }, [selected]);

  const previewChunks = useMemo(
    () => (selected ? highlightPreview(selected.text.slice(0, 2000), searchText) : []),
    [selected, searchText],
  );

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={() => setPanelOpen((open) => !open)} aria-label="Actions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
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
            placeholder="Search notes…"
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>
      </header>

      <main className="window__body clipboard-body">
        {notes.length === 0 ? (
          <div className="state">
            <div className="state__title">No Notes Found</div>
            <div className="state__message">Create your first Raycast Note</div>
            <button type="button" className="action action--primary" onClick={runCreateNote}>
              <span>Create Note</span>
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="state">
            <div className="state__title">No Results</div>
            <div className="state__message">No notes match the current search.</div>
          </div>
        ) : (
          <div className="clipboard-split">
            <ul className="list clipboard-list" ref={listRef}>
              {sections.map((section) => (
                <li key={section.title} className="list__section">
                  <div className="list__sectionHeader">
                    <span className="list__sectionTitle">{section.title}</span>
                    <span className="list__sectionCount">{section.notes.length}</span>
                  </div>
                  <ul className="list__sectionBody">
                    {section.notes.map((entry) => {
                      const index = rows.findIndex((row) => row.id === entry.id);
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => runOpen(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelectedIndex(index);
                              setPanelOpen(true);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name="blank-document" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">{entry.text.split("\n")[0]}</span>
                            </span>
                            <span className="list__accessory">
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
                <div className="snippet-preview">
                  {previewChunks.map((chunk, index) =>
                    chunk.hit ? (
                      <mark key={index}>{chunk.value}</mark>
                    ) : (
                      <span key={index}>{chunk.value}</span>
                    ),
                  )}
                </div>
                <div className="clipboard-detail__section">
                  <div className="clipboard-detail__heading">Information</div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Title</span>
                    <span className="clipboard-detail__value">{selected.title}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Modified</span>
                    <span className="clipboard-detail__value">{formatDate(selected.updatedAt)}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Created</span>
                    <span className="clipboard-detail__value">{formatDate(selected.createdAt)}</span>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </main>

      <CommandFooter
        area="notes"
        title="Search Notes"
        primary={
          selected
            ? { label: "Open Note", key: "", onPress: () => runOpen(selected) }
            : { label: "Create Note", key: "", onPress: runCreateNote }
        }
        actions={
          <button type="button" className="footer-action footer-action--kbd" onClick={() => setPanelOpen((open) => !open)}>
            Actions <span className="kbd">Ctrl</span>
            <span className="kbd">K</span>
          </button>
        }
      />

      <ActionPanel
        open={panelOpen}
        title="Notes"
        groups={actionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={(action) => void runAction(action.id)}
      />
    </div>
  );
}
