// The Snippets command views (`snippets/create|export|import|search`).
//
// Ported from the shipped `SearchSnippetsView` + `CreateSnippetForm` + the import/export pages (see
// `docs/snippets-spec.md`): each command renders its own full-window view — the search list with the
// Information pane, the Create form (Snippet textarea with the placeholder tools, Name & Icon,
// Keyword, Tags) and the Import/Export states with the centered artwork. Auto-expansion itself lives
// in the native hook.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { ipc } from "../../ipc";
import { OpenrayIcon } from "../../icons";
import { rankEntries } from "../../matching";
import { CommandFooter, CommandTile } from "../../commandChrome";
import {
  parseImportPayload,
  primaryAction,
  resolveSnippet,
  useSnippets,
  warnBeforeDelete,
  type SnippetEntry,
  type SnippetImportEntry,
} from "../../snippets";

export type SnippetsCommandName = "search" | "create" | "import" | "export";

const PLACEHOLDER_TOKENS: Array<{ label: string; token: string }> = [
  { label: "Argument", token: '{argument name="Argument"}' },
  { label: "Clipboard", token: "{clipboard}" },
  { label: "Date", token: "{date}" },
  { label: "Time", token: "{time}" },
  { label: "Date & Time", token: "{datetime}" },
  { label: "Day", token: "{day}" },
  { label: "UUID", token: "{uuid}" },
  { label: "Selected Text", token: "{selection}" },
  { label: "Cursor", token: "{cursor}" },
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

const AGE_SECTIONS: Array<{ id: string; title: string; match: (timestamp: number, now: number) => boolean }> = [
  { id: "recent", title: "Recent", match: (timestamp, now) => now - timestamp < 60 * 60 * 1000 },
  { id: "today", title: "Today", match: (timestamp, now) => timestamp >= startOfDay(now) },
  { id: "yesterday", title: "Yesterday", match: (timestamp, now) => timestamp >= startOfDay(now) - 24 * 60 * 60 * 1000 },
  { id: "week", title: "This Week", match: (timestamp, now) => now - timestamp < 7 * 24 * 60 * 60 * 1000 },
  { id: "month", title: "This Month", match: (timestamp, now) => now - timestamp < 30 * 24 * 60 * 60 * 1000 },
  { id: "year", title: "This Year", match: (timestamp, now) => new Date(timestamp).getFullYear() === new Date(now).getFullYear() },
  { id: "older", title: "Older", match: () => true },
];

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

interface EditingState {
  mode: "create" | "edit" | "duplicate";
  id?: string;
  title: string;
  text: string;
  keyword: string;
  tags: string;
}

export interface SnippetsViewProps {
  command: SnippetsCommandName;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
}

export function SnippetsView({ command, searchText, onSearchTextChange, showToast, onBack, closeMainWindow }: SnippetsViewProps) {
  const { snippets, refresh } = useSnippets();
  const [form, setForm] = useState<EditingState | null>(
    command === "create" ? { mode: "create", title: "", text: "", keyword: "", tags: "" } : null,
  );

  if (command === "import") {
    return <ImportSnippets showToast={showToast} onBack={onBack} />;
  }

  if (command === "export") {
    return <ExportSnippets showToast={showToast} onBack={onBack} />;
  }

  if (form) {
    return (
      <CreateSnippetForm
        editing={form}
        onBack={() => setForm(null)}
        onSaved={(title) => {
          setForm(null);
          showToast(title);
          refresh();
        }}
        onError={(message) => showToast("Snippet not saved", message)}
      />
    );
  }

  return (
    <SearchSnippets
      searchText={searchText}
      onSearchTextChange={onSearchTextChange}
      showToast={showToast}
      onBack={onBack}
      closeMainWindow={closeMainWindow}
      onEdit={setForm}
      refresh={refresh}
      snippets={snippets}
    />
  );
}

// -------------------------------------------------------------------------------------------
// Search Snippets
// -------------------------------------------------------------------------------------------

interface SearchSnippetsProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
  onEdit: (state: EditingState) => void;
  refresh: () => void;
  snippets: SnippetEntry[];
}

function SearchSnippets({
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
  onEdit,
  refresh,
  snippets,
}: SearchSnippetsProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<SnippetEntry | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [rememberDelete, setRememberDelete] = useState(!warnBeforeDelete());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const ranked = useMemo(() => {
    const trimmed = searchText.trim();
    if (!trimmed) return snippets.map((entry, index) => ({ entry, value: index }));
    const rankedEntries = rankEntries(
      snippets.map((entry) => ({
        entry,
        title: entry.title,
        subtitle: entry.keyword ?? null,
        keywords: [
          entry.keyword?.toLowerCase() ?? "",
          ...entry.tags.map((tag) => tag.toLowerCase()),
          entry.text.toLowerCase(),
        ].filter(Boolean),
      })),
      trimmed,
      "medium",
      new Map(),
    );
    return rankedEntries.map((rankedEntry) => ({ entry: rankedEntry.entry.entry, value: 0 }));
  }, [snippets, searchText]);

  const sections = useMemo(() => {
    const now = Date.now();
    const pinned = ranked.filter((item) => item.entry.pinned !== null);
    const unpinned = ranked.filter((item) => item.entry.pinned === null);
    const result: Array<{ id: string; title: string; entries: typeof ranked }> = [];
    if (pinned.length) result.push({ id: "pinned", title: "Pinned", entries: pinned });
    for (const section of AGE_SECTIONS) {
      const entries = unpinned.filter((item) => section.match(item.entry.accessedAt, now));
      if (entries.length) result.push({ id: section.id, title: section.title, entries });
    }
    return result;
  }, [ranked]);

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

  const runCopy = useCallback(
    async (entry: SnippetEntry) => {
      try {
        const { text } = await resolveSnippet({ snippetId: entry.id });
        await navigator.clipboard.writeText(text);
        await ipc.backend("snippets.updateCopyCount", { id: entry.id }, { module: "backend" });
        showToast("Copied snippet to clipboard");
      } catch {
        showToast("Copy failed");
      }
    },
    [showToast],
  );

  const runPaste = useCallback(
    async (entry: SnippetEntry) => {
      try {
        const { text } = await resolveSnippet({ snippetId: entry.id });
        await ipc.backend(
          "clipboardHistory.placeInClipboard",
          {
            target: "frontmost",
            shouldCloseWindow: true,
            overridePasteboard: true,
            representations: [{ mimeType: "text/plain", text }],
          },
          { module: "frontend" },
        );
        closeMainWindow();
      } catch {
        showToast("Paste failed");
      }
    },
    [closeMainWindow, showToast],
  );

  const runPrimary = useCallback(
    (entry: SnippetEntry) => {
      if (primaryAction() === "copy") void runCopy(entry);
      else void runPaste(entry);
    },
    [runCopy, runPaste],
  );

  const runDelete = useCallback(
    async (entry: SnippetEntry) => {
      try {
        await ipc.backend("snippets.delete", { id: entry.id }, { module: "backend" });
        showToast("Deleted Snippet");
      } catch (cause) {
        showToast("Failed to delete snippet", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [showToast],
  );

  const runAction = useCallback(
    async (actionId: string) => {
      setPanelOpen(false);
      const entry = selected;
      if (!entry && actionId !== "snippets:create" && actionId !== "snippets:deleteAll") return;
      switch (actionId) {
        case "snippets:create":
          onEdit({ mode: "create", title: "", text: "", keyword: "", tags: "" });
          return;
        case "snippets:paste":
          if (entry) void runPaste(entry);
          return;
        case "snippets:copy":
          if (entry) void runCopy(entry);
          return;
        case "snippets:pin":
          if (entry) {
            await ipc.backend("snippets.pin", { id: entry.id }, { module: "backend" });
            showToast("Pinned Snippet");
          }
          return;
        case "snippets:unpin":
          if (entry) {
            await ipc.backend("snippets.unpin", { id: entry.id }, { module: "backend" });
            showToast("Unpinned Snippet");
          }
          return;
        case "snippets:moveUp":
          if (entry) {
            await ipc.backend("snippets.movePinnedUp", { id: entry.id }, { module: "backend" });
            showToast("Moved Snippet up");
          }
          return;
        case "snippets:moveDown":
          if (entry) {
            await ipc.backend("snippets.movePinnedDown", { id: entry.id }, { module: "backend" });
            showToast("Moved Snippet down");
          }
          return;
        case "snippets:edit":
          if (entry) {
            onEdit({
              mode: "edit",
              id: entry.id,
              title: entry.title,
              text: entry.text,
              keyword: entry.keyword ?? "",
              tags: entry.tags.join(", "),
            });
          }
          return;
        case "snippets:duplicate":
          if (entry) {
            onEdit({
              mode: "duplicate",
              title: `${entry.title} Copy`,
              text: entry.text,
              keyword: entry.keyword ?? "",
              tags: entry.tags.join(", "),
            });
          }
          return;
        case "snippets:exportSingle": {
          if (!entry) return;
          try {
            const response = (await ipc.backend(
              "fileSystem.showSaveFileDialog",
              { title: "Export Snippet", fileName: `${entry.title}.json` },
              { module: "frontend" },
            )) as { path?: string | null };
            if (!response.path) return;
            const payload = {
              name: entry.title,
              text: entry.text,
              ...(entry.keyword ? { keyword: entry.keyword } : {}),
              ...(entry.tags.length ? { tags: entry.tags } : {}),
            };
            await ipc.backend(
              "fileSystem.writeFile",
              { path: response.path, content: JSON.stringify(payload, null, 2) },
              { module: "frontend" },
            );
            showToast("Exported snippet", response.path);
          } catch (cause) {
            showToast("Failed to export snippet", cause instanceof Error ? cause.message : String(cause));
          }
          return;
        }
        case "snippets:delete":
          if (entry) {
            if (warnBeforeDelete()) setConfirmingDelete(entry);
            else void runDelete(entry);
          }
          return;
        case "snippets:deleteAll":
          setConfirmingDeleteAll(true);
          return;
        default:
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, runPaste, runCopy, runDelete, showToast, onEdit],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (confirmingDelete || confirmingDeleteAll) return;
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
        runPrimary(entry);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, selectedIndex, runPrimary, confirmingDelete, confirmingDeleteAll]);

  const actionGroups = useMemo<ActionGroup[]>(() => {
    const primary: ActionGroup["actions"] = [];
    const favorites: ActionGroup["actions"] = [];
    const manage: ActionGroup["actions"] = [];
    const remove: ActionGroup["actions"] = [];
    if (selected) {
      primary.push({ id: "snippets:paste", title: "Paste", itemId: "" });
      primary.push({ id: "snippets:copy", title: "Copy to Clipboard", itemId: "" });
      primary.push({ id: "snippets:edit", title: "Edit Snippet", itemId: "" });
      primary.push({ id: "snippets:duplicate", title: "Duplicate Snippet", itemId: "" });
      primary.push({ id: "snippets:exportSingle", title: "Export Snippet", itemId: "" });
      if (selected.pinned === null) favorites.push({ id: "snippets:pin", title: "Pin Snippet", itemId: "" });
      else {
        favorites.push({ id: "snippets:unpin", title: "Unpin Snippet", itemId: "" });
        favorites.push({ id: "snippets:moveUp", title: "Move Up", itemId: "" });
        favorites.push({ id: "snippets:moveDown", title: "Move Down", itemId: "" });
      }
      remove.push({ id: "snippets:delete", title: "Delete Snippet", itemId: "" });
    }
    manage.push({ id: "snippets:create", title: "Create Snippet", itemId: "" });
    remove.push({ id: "snippets:deleteAll", title: "Delete All Local Snippets", itemId: "" });
    return [
      { name: "primary", actions: primary },
      { name: "favorites", actions: favorites },
      { name: "manage", actions: manage },
      { name: "delete", actions: remove },
    ].filter((group) => group.actions.length > 0);
  }, [selected]);

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
            ref={searchRef}
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder="Search snippets…"
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>
      </header>

      <main className="window__body clipboard-body">
        {rows.length === 0 ? (
          <div className="state">
            <div className="state__title">No Snippets Found</div>
            <div className="state__message">Write faster by storing and inserting frequently used text.</div>
            <div className="state__message">Create your first snippet to get started.</div>
            <button
              type="button"
              className="action action--primary"
              onClick={() => onEdit({ mode: "create", title: "", text: "", keyword: "", tags: "" })}
            >
              <span>Create Snippet</span>
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
                            onClick={() => runPrimary(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelectedIndex(index);
                              setPanelOpen(true);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <OpenrayIcon name="blank-document" size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">{entry.text.split("\n")[0]}</span>
                            </span>
                            <span className="list__accessory">
                              {entry.keyword ? <span className="pill snippets-keyword">{entry.keyword}</span> : null}
                              {entry.pinned !== null ? (
                                <span className="list__favorite" title="Pinned">
                                  <OpenrayIcon name="tack" size={13} />
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
                  <span>{selected.text || " "}</span>
                </div>
                <div className="clipboard-detail__section">
                  <div className="clipboard-detail__heading">Information</div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Name</span>
                    <span className="clipboard-detail__value">{selected.title}</span>
                  </div>
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
                    <span className="clipboard-detail__label">Content Type</span>
                    <span className="clipboard-detail__value">Text</span>
                  </div>
                  {selected.copyCount > 0 ? (
                    <div className="clipboard-detail__row">
                      <span className="clipboard-detail__label">Times Copied</span>
                      <span className="clipboard-detail__value">{selected.copyCount}</span>
                    </div>
                  ) : null}
                  {selected.accessedAt !== selected.updatedAt ? (
                    <div className="clipboard-detail__row">
                      <span className="clipboard-detail__label">Last Copied</span>
                      <span className="clipboard-detail__value">{formatDate(selected.accessedAt)}</span>
                    </div>
                  ) : null}
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
        area="snippets"
        title="Search Snippets"
        primary={
          selected
            ? { label: primaryAction() === "copy" ? "Copy to Clipboard" : "Paste", key: "", onPress: () => runPrimary(selected) }
            : undefined
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
        title="Snippets"
        groups={actionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={(action) => runAction(action.id)}
      />

      {confirmingDelete ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirmingDelete(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">Delete Snippet?</div>
            <div className="clipboard-confirm__body">Warning: this operation cannot be undone.</div>
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
                  try {
                    localStorage.setItem("settings-snippets-remember-delete", rememberDelete ? "1" : "0");
                  } catch {
                    /* storage unavailable keeps the default */
                  }
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
            <div className="action-panel__title">Delete All Local Snippets?</div>
            <div className="clipboard-confirm__body">Warning: this operation cannot be undone.</div>
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
                    await ipc.backend("snippets.deleteAll", {}, { module: "backend" });
                    showToast("Deleted All Local Snippets");
                  } catch (cause) {
                    showToast("Failed to delete snippets", cause instanceof Error ? cause.message : String(cause));
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
// Create Snippet (also serves Edit / Duplicate)
// -------------------------------------------------------------------------------------------

function CreateSnippetForm({
  editing,
  onBack,
  onSaved,
  onError,
}: {
  editing: EditingState;
  onBack: () => void;
  onSaved: (title: string) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(editing.title);
  const [text, setText] = useState(editing.text);
  const [keyword, setKeyword] = useState(editing.keyword);
  const [tags, setTags] = useState(editing.tags);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const submitTitle =
    editing.mode === "edit" ? "Update Snippet" : editing.mode === "duplicate" ? "Duplicate Snippet" : "Create Snippet";

  const insertToken = (token: string) => {
    const element = textRef.current;
    if (!element) {
      setText((current) => `${current}${token}`);
      return;
    }
    const start = element.selectionStart ?? text.length;
    const end = element.selectionEnd ?? text.length;
    setText((current) => `${current.slice(0, start)}${token}${current.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const submit = async () => {
    if (busy) return;
    const validation: string[] = [];
    if (!title.trim()) validation.push("Name cannot be empty");
    if (!text.trim()) validation.push("Snippet cannot be empty");
    if (validation.length) {
      setErrors(validation);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        text,
        keyword: keyword.trim() || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      };
      if (editing.mode === "edit" && editing.id) {
        await ipc.backend("snippets.update", { id: editing.id, ...payload }, { module: "backend" });
        onSaved("Snippet updated");
      } else {
        await ipc.backend("snippets.create", payload, { module: "backend" });
        onSaved("Created snippet");
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
        <button type="button" tabIndex={-1} className="back-button" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <main className="window__body command-page">
        <form
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
            <label className="command-form__label" htmlFor="snippet-text">
              Snippet
            </label>            <div className="command-form__field">
              <div className="command-form__textarea-wrap">
                <textarea
                  id="snippet-text"
                  ref={textRef}
                  className="command-form__textarea"
                  rows={4}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <div className="command-form__textarea-tools">
                  <select
                    className="command-form__iconpicker command-form__insert"
                    title="Add Placeholder"
                    value=""
                    onChange={(event) => {
                      const token = PLACEHOLDER_TOKENS.find((placeholder) => placeholder.label === event.target.value);
                      if (token) insertToken(token.token);
                    }}
                  >
                    <option value="">Add Placeholder</option>
                    {PLACEHOLDER_TOKENS.map((placeholder) => (
                      <option key={placeholder.label} value={placeholder.label}>
                        {placeholder.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="command-form__help">
                Include{" "}
                <button type="button" className="command-form__help-link" onClick={() => insertToken("{clipboard}")}>
                  {"{Dynamic Placeholders}"}
                </button>{" "}
                for context like the copied text or the current date
              </div>
              <div className="command-form__help">{`{cursor}`} places the cursor at this position after snippet expansion</div>
            </div>
          </div>

          <div className="command-form__row">
            <label className="command-form__label" htmlFor="snippet-name">
              Name &amp; Icon
            </label>
            <div className="command-form__field">
              <input id="snippet-name" value={title} placeholder="Snippet name" onChange={(event) => setTitle(event.target.value)} />
            </div>
          </div>
          <div className="command-form__row">
            <label className="command-form__label" htmlFor="snippet-keyword">
              Keyword
            </label>
            <div className="command-form__field">
              <input
                id="snippet-keyword"
                value={keyword}
                placeholder="Keyword"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          </div>
          <div className="command-form__row">
            <label className="command-form__label" htmlFor="snippet-tags">
              Tags
            </label>
            <div className="command-form__field">
              <input id="snippet-tags" value={tags} placeholder="Tags" onChange={(event) => setTags(event.target.value)} />
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
        area="snippets"
        title={editing.mode === "create" ? "Create Snippet" : editing.mode === "edit" ? "Edit Snippet" : "Duplicate Snippet"}
        primary={{ label: submitTitle, key: "Ctrl", onPress: () => void submit() }}
      />
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Import / Export states
// -------------------------------------------------------------------------------------------

function ImportSnippets({
  showToast,
  onBack,
}: {
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
}) {
  const [confirming, setConfirming] = useState<SnippetImportEntry[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const { refresh } = useSnippets();

  const pickFile = async () => {
    try {
      const response = (await ipc.backend(
        "fileSystem.showOpenFileDialog",
        { title: "Import Snippets", allowedTypes: ["json"] },
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
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <main className="window__body drop-state">
        <span className="drop-state__icon" aria-hidden>
          <CommandTile area="snippets" size={64} />
          <span className="drop-state__badge drop-state__badge--down">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 4v12m0 0 5-5m-5 5-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
        <div className="drop-state__title">Import Snippets</div>
        <div className="drop-state__subtitle">Select file from your computer to continue</div>
      </main>

      <CommandFooter area="snippets" title="Import Snippets" primary={{ label: "Select file", key: "", onPress: () => void pickFile() }} />

      {confirming ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirming(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="dialog">
            <div className="action-panel__title">Import Snippets</div>
            <div className="clipboard-confirm__body">{confirming.length} snippet(s) found in the file.</div>
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
                    const result = (await ipc.backend("snippets.importEntries", { entries }, { module: "backend" })) as {
                      added?: number;
                      skipped?: number;
                    };
                    showToast(
                      "Import successful",
                      `${result.added ?? 0} snippet(s) added, ${result.skipped ?? 0} duplicate(s) skipped`,
                    );
                    refresh();
                  } catch (cause) {
                    showToast("Import failed", cause instanceof Error ? cause.message : String(cause));
                  }
                }}
              >
                <span>Import {confirming.length} Snippet(s)</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {parseError ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setParseError(null)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">Import Snippets</div>
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

function ExportSnippets({
  showToast,
  onBack,
}: {
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
}) {
  const runExport = async () => {
    try {
      const data = (await ipc.backend("snippets.exportAll", {}, { module: "backend" })) as SnippetImportEntry[];
      const date = new Date().toISOString().slice(0, 10);
      const response = (await ipc.backend(
        "fileSystem.showSaveFileDialog",
        { title: "Export Snippets", fileName: `Snippets ${date}.json` },
        { module: "frontend" },
      )) as { path?: string | null };
      if (!response.path) return;
      await ipc.backend(
        "fileSystem.writeFile",
        { path: response.path, content: JSON.stringify(data ?? [], null, 2) },
        { module: "frontend" },
      );
      showToast("Exported snippets", response.path);
    } catch (cause) {
      showToast("Failed to export snippets", cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <main className="window__body drop-state">
        <span className="drop-state__icon" aria-hidden>
          <CommandTile area="snippets" size={64} />
          <span className="drop-state__badge drop-state__badge--up">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 20V8m0 0 5 5m-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
        <div className="drop-state__title">Export Snippets</div>
        <div className="drop-state__subtitle">Choose an output location to continue</div>
      </main>

      <CommandFooter area="snippets" title="Export Snippets" primary={{ label: "Export", key: "", onPress: () => void runExport() }} />
    </div>
  );
}
