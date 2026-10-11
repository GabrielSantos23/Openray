// The Clipboard History command view.
//
// Ported from `ClipboardHistoryView` in `artifacts/frontend/main-window-g1Vb1JLY.js`, which is the
// component Raycast routes `/extension/clipboard-history` to. Kept: the header with a back button and
// a "Type to filter entries…" search field, the type-filter popover, the age sections, the
// master/detail split (list on the left, `ClipboardHistoryDetails` on the right), and the action panel
// behind Ctrl+K.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { ipc } from "../../ipc";
import { RaycastIcon } from "../../icons";
import {
  CLIPBOARD_TYPE_FILTERS,
  clipboardActionGroups,
  type ClipboardColorFormat,
  type ClipboardEntry,
  type ClipboardEntryAction,
  type ClipboardPreview,
  type ClipboardTypeFilter,
  iconForEntry,
  imagePathOf,
  plainTextOf,
  runClipboardAction,
  subtitleForEntry,
  tagColor,
  useClipboardHistory,
  useClipboardPreview,
  useClipboardSections,
} from "../../clipboardHistory";

/** One row of the `Paste as…` submenu: a format this entry actually holds. */
interface PasteAsOption {
  mimeType: string;
  base: string;
  label: string;
}

export interface ClipboardHistoryViewProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  subscribeStateChanged: (handler: () => void) => () => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  /** Performs a paste/copy through the host and hides the launcher, like Raycast's action handlers. */
  runEntryAction: (entry: ClipboardEntry, action: ClipboardEntryAction) => Promise<void>;
  closeMainWindow: () => void;
  openUrl: (url: string) => Promise<void>;
}

export function ClipboardHistoryView({
  searchText,
  onSearchTextChange,
  subscribeStateChanged,
  showToast,
  onBack,
  runEntryAction,
  closeMainWindow,
  openUrl,
}: ClipboardHistoryViewProps) {
  const [category, setCategory] = useState<ClipboardTypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<ClipboardEntry | null>(null);
  const [pasteAs, setPasteAs] = useState<ClipboardEntry | null>(null);
  const [colorEntry, setColorEntry] = useState<ClipboardEntry | null>(null);
  const [colorFormats, setColorFormats] = useState<ClipboardColorFormat[]>([]);
  const [editingEntry, setEditingEntry] = useState<ClipboardEntry | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<ClipboardEntry | null>(null);
  const [savingEntry, setSavingEntry] = useState<ClipboardEntry | null>(null);
  const [pasteAsOptions, setPasteAsOptions] = useState<PasteAsOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const subscribe = useCallback(subscribeStateChanged, [subscribeStateChanged]);
  const { entries, loading, error, refresh, loadMore, hasMore, loadingMore } = useClipboardHistory(
    searchText,
    category,
    tag,
    subscribe,
  );
  const sections = useClipboardSections(entries);
  const rows = useMemo(() => sections.flatMap((section) => section.entries), [sections]);
  const selected = rows[selectedIndex] ?? null;
  const preview = useClipboardPreview(selected, version);

  useEffect(() => {
    ipc
      .backend("clipboard.getTags", {}, { module: "backend" })
      .then((response) => setTags((response as { tags?: string[] }).tags ?? []))
      .catch(() => setTags([]));
  }, [version]);

  // Each submenu is built from the entry that was chosen when it opened, so switching rows cannot
  // leave a stale format list behind.
  useEffect(() => {
    if (!pasteAs) {
      setPasteAsOptions([]);
      return;
    }
    let cancelled = false;
    ipc
      .backend("clipboard.getPasteAsOptions", { id: pasteAs.id }, { module: "backend" })
      .then((response) => {
        if (!cancelled) setPasteAsOptions((response as { options?: PasteAsOption[] }).options ?? []);
      })
      .catch(() => {
        if (!cancelled) setPasteAsOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pasteAs]);

  useEffect(() => {
    if (!colorEntry) {
      setColorFormats([]);
      return;
    }
    let cancelled = false;
    const value = plainTextOf(colorEntry) ?? "";
    ipc
      .backend("clipboard.getFormattedColors", { color: value }, { module: "backend" })
      .then((response) => {
        if (!cancelled) setColorFormats((response as { formats?: ClipboardColorFormat[] }).formats ?? []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setColorFormats([]);
        showToast("Couldn't format color", error instanceof Error ? error.message : undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [colorEntry, showToast]);

  // Append the next page as the user nears the end, the way Raycast's list `endThreshold` does. The
  // scrollable element is the list itself — `.window__body` is laid out to fit its content, so a
  // listener there would never fire and pagination would stall after the first page.
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const container = listRef.current;
    if (!container) return;
    const onScroll = () => {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 240) loadMore();
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, [hasMore, loadingMore, loadMore]);

  // A page that never fills the viewport has no scrollbar to reach, so keep going until it does.
  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;
    const container = listRef.current;
    if (!container) return;
    if (container.scrollHeight <= container.clientHeight + 8) loadMore();
  }, [hasMore, loadingMore, loading, entries.length, loadMore]);

  useEffect(() => {
    if (!panelOpen && !filterOpen && !tagOpen && !editingTags) searchRef.current?.focus();
  }, [panelOpen, filterOpen, tagOpen, editingTags]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchText, category]);

  useEffect(() => {
    const container = listRef.current;
    const row = listRef.current?.querySelector<HTMLElement>('.list__row[data-selected="true"]');
    if (!container || !row) return;
    const rowRect = row.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (rowRect.top < viewRect.top) container.scrollTop -= viewRect.top - rowRect.top + 4;
    else if (rowRect.bottom > viewRect.bottom) container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
  }, [selectedIndex, rows.length]);

  const handlers = useMemo(
    () => ({
      showToast,
      onBack,
      run: runEntryAction,
      editTags: (entry: ClipboardEntry) => setEditingTags(entry),
      showPasteAs: (entry: ClipboardEntry) => setPasteAs(entry),
      showColorFormats: (entry: ClipboardEntry) => setColorEntry(entry),
      showEdit: (entry: ClipboardEntry) => setEditingEntry(entry),
      showRename: (entry: ClipboardEntry) => setRenamingEntry(entry),
      showSaveAs: (entry: ClipboardEntry) => setSavingEntry(entry),
      runCommand: async (commandId: string) => {
        const result = (await ipc.backend(commandId, {}, { module: "backend" })) as
          | { status?: string; pasted?: boolean }
          | undefined;
        if (commandId === "clipboard.pasteSequentially") {
          if (!result?.pasted) {
            showToast("No clipboard item found to paste");
            closeMainWindow();
          }
          return;
        }
        showToast("Paste sequence reset");
        closeMainWindow();
      },
    }),
    [showToast, onBack, runEntryAction, closeMainWindow],
  );

  const activate = useCallback(
    async (entry: ClipboardEntry, action: ClipboardEntryAction = "paste") => {
      // Raycast hides the launcher before pasting so the target app can paint over it. "Paste and Keep
      // Window Open" deliberately leaves it up.
      if (action !== "pasteAndKeepOpen") closeMainWindow();
      await runEntryAction(entry, action);
    },
    [closeMainWindow, runEntryAction],
  );

  const panelGroups: ActionGroup[] = useMemo(
    () => (selected ? clipboardActionGroups(selected) : []),
    [selected],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (panelOpen || filterOpen || tagOpen || editingTags) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "k") {
          event.preventDefault();
          setPanelOpen(true);
        }
        return;
      }
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, rows.length - 1));
      } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        const entry = rows[selectedIndex];
        if (!entry) return;
        event.preventDefault();
        if (event.shiftKey) {
          setPanelOpen(true);
          return;
        }
        // Alt+Enter is Raycast's Paste and Keep Window Open.
        void activate(entry, event.altKey ? "pasteAndKeepOpen" : "paste");
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (searchText) onSearchTextChange("");
        else onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    rows,
    selectedIndex,
    panelOpen,
    filterOpen,
    tagOpen,
    editingTags,
    searchText,
    activate,
    onBack,
    onSearchTextChange,
  ]);

  const activeFilter = CLIPBOARD_TYPE_FILTERS.find((option) => option.value === category);

  // Keep the selection on the same entry across reloads: an entry that moved to a different section
  // should not silently lose the row the user was looking at.
  useEffect(() => {
    const index = selected ? rows.indexOf(selected) : -1;
    if (index >= 0) setSelectedIndex(index);
  }, [preview?.id, rows.length]);

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
            placeholder="Type to filter entries…"
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>

        <button
          type="button"
          className="clipboard-filter-button"
          title="Filter by Type"
          data-state={filterOpen ? "open" : "closed"}
          onClick={() => setFilterOpen((open) => !open)}
        >
          <RaycastIcon name={activeFilter?.icon ?? "bullet-points"} size={15} />
          <span className="clipboard-filter-button__label">{activeFilter?.label ?? "All Types"}</span>
        </button>

        <button
          type="button"
          className="clipboard-filter-button"
          title="Filter by Tag"
          data-state={tagOpen ? "open" : tag !== null ? "active" : "closed"}
          onClick={() => setTagOpen((open) => !open)}
        >
          <span
            className="clipboard-filter-button__swatch"
            style={tag !== null ? { background: tagColor(tag) } : undefined}
            aria-hidden
          />
          <span className="clipboard-filter-button__label">{tag ?? "All Tags"}</span>
        </button>
      </header>

      <main className="window__body clipboard-body" ref={bodyRef}>
        {loading && rows.length === 0 ? (
          <div className="state">
            <div className="state__title">Loading…</div>
          </div>
        ) : error ? (
          <div className="state">
            <div className="state__title">Could not read clipboard history</div>
            <div className="state__message">{error}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="state">
            <div className="state__title">No clipboard history</div>
            <div className="state__message">Copy something and it will show up here.</div>
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
                    {section.entries.map((entry) => {
                      const index = rows.indexOf(entry);
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="list__row"
                            data-selected={index === selectedIndex}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => void activate(entry)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelectedIndex(index);
                              setPanelOpen(true);
                            }}
                          >
                            <span className="icon" aria-hidden>
                              <RaycastIcon name={iconForEntry(entry)} size={16} />
                            </span>
                            <span className="list__text">
                              <span className="list__title">{entry.title}</span>
                              <span className="list__subtitle">{subtitleForEntry(entry)}</span>
                            </span>
                            <span className="list__accessory">
                              {entry.tags.slice(0, 3).map((name) => (
                                <span
                                  key={name}
                                  className="clipboard-tag"
                                  style={{ borderColor: tagColor(name) }}
                                  title={name}
                                >
                                  <span className="clipboard-tag__dot" style={{ background: tagColor(name) }} />
                                  {name}
                                </span>
                              ))}
                              {entry.tags.length > 3 ? (
                                <span className="clipboard-tag__more">+{entry.tags.length - 3}</span>
                              ) : null}
                              {entry.pinned !== undefined ? (
                                <span className="list__favorite" title="Pinned">
                                  <RaycastIcon name="tack" size={13} />
                                </span>
                              ) : null}
                              {entry.copyCount > 1 ? <span className="pill">{entry.copyCount}×</span> : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>

            <ClipboardDetailPane preview={preview} />
          </div>
        )}
        {loadingMore ? <div className="clipboard-loading-more">Loading more…</div> : null}
      </main>

      <footer className="window__footer">
        <button
          type="button"
          className="footer-icon-button"
          aria-label="Refresh"
          onClick={() => {
            refresh();
            setVersion((value) => value + 1);
          }}
        >
          <RaycastIcon name="arrow-clockwise" size={16} />
        </button>
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
        open={tagOpen}
        title="Filter by Tag"
        groups={[
          {
            name: "default",
            actions: [
              { id: "clipboard-tag:all", title: "All Tags", itemId: "" },
              ...tags.map((name) => ({
                id: `clipboard-tag:${name}`,
                title: name,
                itemId: name,
              })),
            ],
          },
        ]}
        onClose={() => setTagOpen(false)}
        onRun={(action) => {
          setTag((action.itemId ?? "") === "" ? null : (action.itemId ?? null));
          setTagOpen(false);
        }}
      />

      <ActionPanel
        open={filterOpen}
        title="Filter by Type"
        groups={[
          {
            name: "default",
            actions: CLIPBOARD_TYPE_FILTERS.map((option) => ({
              id: `clipboard-type:${option.value}`,
              title: option.label,
              itemId: option.value,
            })),
          },
        ]}
        onClose={() => setFilterOpen(false)}
        onRun={(action) => {
          const value = action.itemId ?? "all";
          setCategory(value as ClipboardTypeFilter);
          setFilterOpen(false);
        }}
      />

      <ActionPanel
        open={panelOpen}
        title={selected?.title ?? "Actions"}
        groups={panelGroups}
        onClose={() => setPanelOpen(false)}
        onRun={async (action) => {
          setPanelOpen(false);
          if (!selected) return;
          const id = action.itemId ?? action.id;
          if (action.id.startsWith("clipboard:openUrl:")) {
            await openUrl(id);
            return;
          }
          // Raycast asks before wiping the whole history; the destructive button is not enough.
          if (id === "clipboard:deleteAll") {
            setConfirmingDeleteAll(true);
            return;
          }
          await runClipboardAction(selected, id, handlers);
        }}
      />

      {editingTags ? (
        <TagEditor
          entry={editingTags}
          knownTags={tags}
          onCancel={() => setEditingTags(null)}
          onSave={async (next) => {
            setEditingTags(null);
            await ipc.backend("clipboard.setTags", { id: editingTags.id, tags: next }, { module: "backend" });
            showToast("Entry saved");
            setVersion((value) => value + 1);
          }}
        />
      ) : null}

      <ActionPanel
        open={pasteAs !== null}
        title="Paste as…"
        groups={[
          {
            name: "default",
            actions: pasteAsOptions.map((option) => ({
              id: `clipboard-pasteAs:${option.base}`,
              title: option.label,
              itemId: option.mimeType,
            })),
          },
        ]}
        onClose={() => setPasteAs(null)}
        onRun={async (action) => {
          const entry = pasteAs;
          const mimeType = action.itemId;
          setPasteAs(null);
          if (!entry || !mimeType) return;
          closeMainWindow();
          try {
            await ipc.backend("clipboard.pasteAs", { id: entry.id, mimeType }, { module: "backend" });
          } catch (error) {
            showToast("Couldn't paste this format", error instanceof Error ? error.message : undefined);
          }
        }}
      />

      <ActionPanel
        open={colorEntry !== null}
        title="Copy Color as…"
        groups={[
          {
            name: "default",
            actions: colorFormats.map((format) => ({
              id: `clipboard-color:${format.id}`,
              title: `${format.label} — ${format.value}`,
              itemId: format.value,
            })),
          },
        ]}
        onClose={() => setColorEntry(null)}
        onRun={async (action) => {
          const value = action.itemId;
          setColorEntry(null);
          if (!value) return;
          try {
            await ipc.backend(
              "clipboard.copy",
              { text: value, shouldCloseWindow: false },
              { module: "backend" },
            );
            showToast("Copied colour", value);
          } catch (error) {
            showToast("Couldn't copy colour", error instanceof Error ? error.message : undefined);
          }
        }}
      />

      {editingEntry ? (
        <PromptDialog
          title="Edit Entry"
          label="Text"
          initialValue={plainTextOf(editingEntry) ?? ""}
          multiline
          onCancel={() => setEditingEntry(null)}
          onSubmit={async (value) => {
            const entry = editingEntry;
            setEditingEntry(null);
            try {
              await ipc.backend("clipboard.editEntry", { id: entry.id, text: value }, { module: "backend" });
              showToast("Entry updated");
              setVersion((current) => current + 1);
            } catch (error) {
              showToast("Couldn't edit entry", error instanceof Error ? error.message : undefined);
            }
          }}
        />
      ) : null}

      {renamingEntry ? (
        <PromptDialog
          title="Rename Entry"
          label="Name"
          initialValue={renamingEntry.title}
          onCancel={() => setRenamingEntry(null)}
          onSubmit={async (value) => {
            const entry = renamingEntry;
            setRenamingEntry(null);
            try {
              await ipc.backend("clipboard.renameEntry", { id: entry.id, title: value }, { module: "backend" });
              showToast("Entry renamed");
              setVersion((current) => current + 1);
            } catch (error) {
              showToast("Couldn't rename entry", error instanceof Error ? error.message : undefined);
            }
          }}
        />
      ) : null}

      {savingEntry ? (
        <SaveAsDialog
          entry={savingEntry}
          onCancel={() => setSavingEntry(null)}
          onSaved={(path) => {
            setSavingEntry(null);
            showToast("Entry saved", path);
          }}
          onError={(message) => showToast("Couldn't save entry", message)}
        />
      ) : null}

      {confirmingDeleteAll ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirmingDeleteAll(false)} aria-hidden />
          <div className="action-panel__popover clipboard-confirm" role="alertdialog">
            <div className="action-panel__title">Delete All Entries</div>
            <div className="clipboard-confirm__body">
              Are you sure you want to proceed with deleting all clipboard history entries?
            </div>
            <div className="clipboard-confirm__actions">
              <button
                type="button"
                className="action"
                onClick={() => setConfirmingDeleteAll(false)}
                autoFocus
              >
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="action action--destructive"
                onClick={async () => {
                  setConfirmingDeleteAll(false);
                  await runClipboardAction(
                    selected ?? { id: "" } as ClipboardEntry,
                    "clipboard:deleteAll",
                    handlers,
                  );
                }}
              >
                <span>Delete All</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A single-field prompt, matching the shape Raycast uses for `Edit Entry` and `Rename Entry`: a
 * labelled input in the same popover chrome as the action panel, with Enter to confirm and Escape to
 * cancel.
 */
function PromptDialog({
  title,
  label,
  initialValue,
  multiline = false,
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  initialValue: string;
  multiline?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();

  return (
    <div className="action-panel">
      <div className="action-panel__backdrop" onClick={onCancel} aria-hidden />
      <form
        className="action-panel__popover clipboard-prompt"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || trimmed.length === 0) return;
          setBusy(true);
          await onSubmit(trimmed);
          setBusy(false);
        }}
      >
        <div className="action-panel__title">{title}</div>
        <div className="clipboard-tag-editor__field">
          {multiline ? (
            <textarea
              autoFocus
              rows={4}
              value={value}
              aria-label={label}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCancel();
                }
              }}
            />
          ) : (
            <input
              autoFocus
              value={value}
              aria-label={label}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCancel();
                }
              }}
            />
          )}
        </div>
        <div className="clipboard-confirm__actions">
          <button type="button" className="action" onClick={onCancel}>
            <span>Cancel</span>
          </button>
          <button type="submit" className="action action--primary" disabled={busy || trimmed.length === 0}>
            <span>Save</span>
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * `Save as File`: a path field seeded with a suggestion from the entry, writing through the host so the
 * bytes never pass through the renderer as a string.
 */
function SaveAsDialog({
  entry,
  onCancel,
  onSaved,
  onError,
}: {
  entry: ClipboardEntry;
  onCancel: () => void;
  onSaved: (path: string) => void;
  onError: (message: string) => void;
}) {
  const [suggestion, setSuggestion] = useState("");
  const image = useMemo(() => imagePathOf(entry), [entry]);
  const fallback = useMemo(
    () => `${(entry.title || "clipboard-entry").replace(/[<>:"/\\|?*]/g, " ").trim().slice(0, 80)}${image ? "" : ".txt"}`,
    [entry.title, image],
  );

  useEffect(() => {
    let cancelled = false;
    ipc
      .backend("clipboard.getExportSuggestion", { id: entry.id }, { module: "backend" })
      .then((response) => {
        if (cancelled) return;
        setSuggestion((response as { suggestedName?: string }).suggestedName ?? "");
      })
      .catch(() => {
        if (!cancelled) setSuggestion("");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  return (
    <PromptDialog
      title="Save as File"
      label="File name"
      initialValue={suggestion || fallback}
      onCancel={onCancel}
      onSubmit={async (value) => {
        try {
          await ipc.backend("clipboard.saveAsFile", { id: entry.id, destination: value }, { module: "backend" });
          onSaved(value);
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }}
    />
  );
}

/**
 * Raycast's `token-input-field` on the clipboard entry: a comma-separated tag field that offers the
 * tags already in use and colour-codes each one from its text.
 */
function TagEditor({
  entry,
  knownTags,
  onCancel,
  onSave,
}: {
  entry: ClipboardEntry;
  knownTags: string[];
  onCancel: () => void;
  onSave: (tags: string[]) => Promise<void>;
}) {
  const [text, setText] = useState(entry.tags.join(", "));
  const [saving, setSaving] = useState(false);

  const chips = useMemo(
    () =>
      text
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [text],
  );

  return (
    <div className="action-panel">
      <div className="action-panel__backdrop" onClick={onCancel} aria-hidden />
      <form
        className="action-panel__popover clipboard-tag-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          setSaving(true);
          await onSave(chips);
          setSaving(false);
        }}
      >
        <div className="action-panel__title">Edit Tags</div>
        <div className="clipboard-tag-editor__field">
          <input
            autoFocus
            value={text}
            placeholder="work, urgent"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
              }
            }}
          />
        </div>

        {chips.length > 0 ? (
          <div className="clipboard-tag-editor__chips">
            {chips.map((tag) => (
              <span key={tag} className="clipboard-tag" style={{ borderColor: tagColor(tag) }}>
                <span className="clipboard-tag__dot" style={{ background: tagColor(tag) }} />
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {knownTags.length > 0 ? (
          <div className="clipboard-tag-editor__known">
            {knownTags
              .filter((tag) => !chips.includes(tag))
              .map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="clipboard-tag"
                  style={{ borderColor: tagColor(tag) }}
                  onClick={() => setText((current) => (current.trim() ? `${current.trim()}, ${tag}` : tag))}
                >
                  <span className="clipboard-tag__dot" style={{ background: tagColor(tag) }} />
                  {tag}
                </button>
              ))}
          </div>
        ) : null}

        <div className="clipboard-tag-editor__actions">
          <button type="button" className="action" onClick={onCancel} autoFocus>
            <span>Cancel</span>
          </button>
          <button type="submit" className="action">
            <span>{saving ? "Saving…" : "Save"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ClipboardDetailPane({ preview }: { preview: ClipboardPreview | null }) {
  if (!preview) {
    return (
      <div className="clipboard-detail">
        <div className="clipboard-detail__empty">No preview</div>
      </div>
    );
  }

  return (
    <div className="clipboard-detail">
      {preview.kind === "image" && preview.image ? (
        <div className="clipboard-detail__preview">
          {preview.image.dataUrl ? (
            <img src={preview.image.dataUrl} alt={preview.title} />
          ) : (
            <div className="clipboard-detail__imagePlaceholder">Image preview unavailable</div>
          )}
        </div>
      ) : preview.kind === "text" && preview.text !== null ? (
        <div className="clipboard-detail__preview clipboard-detail__preview--text">
          {preview.text}
        </div>
      ) : preview.kind === "multi" ? (
        <div className="clipboard-detail__preview clipboard-detail__preview--files">
          {preview.items?.flatMap((item) => item.paths).map((file) => (
            <div key={file.path} className="clipboard-detail__file">
              <RaycastIcon name="blank-document" size={13} />
              <span className="clipboard-detail__filePath">{file.path}</span>
            </div>
          ))}
        </div>
      ) : preview.kind === "file" ? (
        <div className="clipboard-detail__preview clipboard-detail__preview--files">
          {preview.paths.map((file) => (
            <div key={file.path} className="clipboard-detail__file">
              <RaycastIcon name="blank-document" size={13} />
              <span className="clipboard-detail__filePath">{file.path}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="clipboard-detail__preview clipboard-detail__empty">
          No preview for this entry
        </div>
      )}

      <div className="clipboard-detail__info">
        {preview.source?.name ? (
          <div className="clipboard-detail__row">
            <span className="clipboard-detail__key">Source</span>
            <span className="clipboard-detail__value">{preview.source.name}</span>
          </div>
        ) : null}
        <div className="clipboard-detail__row">
          <span className="clipboard-detail__key">Type</span>
          <span className="clipboard-detail__value">
            {preview.kind === "multi"
              ? `${preview.fileCount} items`
              : preview.categories[0] ?? "Text"}
          </span>
        </div>
        {preview.kind === "image" && preview.image ? (
          <>
            <div className="clipboard-detail__row">
              <span className="clipboard-detail__key">Dimensions</span>
              <span className="clipboard-detail__value">
                {preview.image.width && preview.image.height
                  ? `${preview.image.width}×${preview.image.height}`
                  : "—"}
              </span>
            </div>
            <div className="clipboard-detail__row">
              <span className="clipboard-detail__key">Size</span>
              <span className="clipboard-detail__value">{formatSize(preview.image.size)}</span>
            </div>
          </>
        ) : null}
        {preview.kind === "file"
          ? preview.paths.map((file) => (
              <div className="clipboard-detail__row" key={file.path}>
                <span className="clipboard-detail__key">Path</span>
                <span className="clipboard-detail__value">{file.path}</span>
              </div>
            ))
          : null}
        {preview.kind === "text" && preview.text !== null ? (
          <>
            <div className="clipboard-detail__row">
              <span className="clipboard-detail__key">Characters</span>
              <span className="clipboard-detail__value">{preview.text.length.toLocaleString()}</span>
            </div>
            <div className="clipboard-detail__row">
              <span className="clipboard-detail__key">Words</span>
              <span className="clipboard-detail__value">
                {preview.text.split(/\s+/).filter(Boolean).length.toLocaleString()}
              </span>
            </div>
          </>
        ) : null}
        <div className="clipboard-detail__row">
          <span className="clipboard-detail__key">{preview.copyCount === 1 ? "Copied" : "Times copied"}</span>
          <span className="clipboard-detail__value">
            {preview.copyCount === 1
              ? new Date(preview.createdAt).toLocaleString()
              : preview.copyCount.toLocaleString()}
          </span>
        </div>
        {preview.copyCount > 1 ? (
          <div className="clipboard-detail__row">
            <span className="clipboard-detail__key">Last copied</span>
            <span className="clipboard-detail__value">
              {new Date(preview.updatedAt).toLocaleString()}
            </span>
          </div>
        ) : null}
        {preview.copyCount > 1 ? (
          <div className="clipboard-detail__row">
            <span className="clipboard-detail__key">First copied</span>
            <span className="clipboard-detail__value">
              {new Date(preview.createdAt).toLocaleString()}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}