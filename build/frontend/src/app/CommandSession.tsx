// The running-command session: hosts the extension renderer (page stack, command search bar,
// action panel, window-level keyboard) and dispatches the internal command views
// (Clipboard History, Quicklinks, Snippets, Calculator History, Translate).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useExtensionCommand, type ViewAction, type ViewBody } from "../useExtensionCommand";
import { RenderedView, SearchBarDropdown, flatItems, gridRowWidths, selectableIds } from "../RenderedView";
import {
  applyRender,
  emptyPages,
  popPage,
  popToRootPages,
  topPage,
  updateTop,
  type CommandPagesState,
} from "../commandPages";
import { onNotification, openSettings } from "../ipc";
import { isDevExtensionsEnabled, overrideTestHooks } from "../testHooks";
import { ActionPanel, type ActionGroup } from "../ActionPanel";
import { RaycastIcon } from "../icons";
import { ClipboardHistoryView } from "../features/clipboard/ClipboardHistoryView";
import { QuicklinksView, type QuicklinksCommandName } from "../features/quicklinks/QuicklinksView";
import { SnippetsView, type SnippetsCommandName } from "../features/snippets/SnippetsView";
import { CalculatorHistoryView } from "../features/calculator/CalculatorHistoryView";
import { TranslateView, type TranslateSeed } from "../features/translator/TranslateView";
import { SearchFilesView } from "../features/fileSearch/SearchFilesView";
import { StoreView } from "../features/store/StoreView";
import { storeGetCommandPreferences } from "../features/store/storeApi";
import "../features/store/store.css";
import { WindowManagementArgsView } from "../features/windowManagement/WindowManagementArgsView";
import { FocusCategoriesSession, FocusFormView, FocusImportView } from "../features/focus/FocusViews";
import { GameLauncherView } from "../features/games/GameLauncherView";
import { SearchNotesView } from "../features/notes/SearchNotesView";
import { noteDeeplink, openNotesWindow } from "../notes";
import { LoadingBar } from "../LoadingBar";
import type { ApplicationCommand } from "../applications";
import type { RootEntry } from "./entries";
import {
  keepSearchFocus,
  openClipboardUrl,
  runClipboardEntryAction,
  runToastAction,
  subscribeClipboardStateChanged,
  useToastActionGroups,
} from "./rootHelpers";

export function CommandSession({
  entry,
  onBack,
  showToast,
  closeMainWindow: closeWindow,
  applications,
  createLink,
  onConsumeCreateLink,
  translatorSeed,
  onOpenQuicklinkCreate,
}: {
  entry: RootEntry;
  onBack: () => void;
  showToast: (title: string, message?: string) => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
  createLink?: string | { link: string; name?: string } | null;
  onConsumeCreateLink?: () => void;
  translatorSeed?: TranslateSeed | null;
  onOpenQuicklinkCreate?: (seed: { link: string; name?: string }) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const toastGroups = useToastActionGroups();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The command's filter field is always-focused, like the root search: when the action panel
  // closes, focus comes straight back here.
  useEffect(() => {
    if (!panelOpen) searchInputRef.current?.focus();
  }, [panelOpen]);

  // Store-installed commands launch with their stored preferences (`store.getCommandPreferences`);
  // null means "still loading" and holds the launch until the values are in.
  const storePreferences = useStorePreferences(
    entry.kind === "extension" ? entry.extension.uuid : null,
    entry.kind === "extension" ? entry.command.name : null,
  );
  const command = useExtensionCommand(
    entry.kind === "extension" && storePreferences !== null ? entry.extension : null,
    entry.kind === "extension" && storePreferences !== null ? entry.command : null,
    storePreferences ?? {},
  );

  // The renderer-side page stack (Raycast's `z.mainRouter.context.nodeExtensionStack`): pushed
  // pages stay in the stack with their own filter text/selection so popping restores them.
  const [pages, setPages] = useState<CommandPagesState>(emptyPages);
  const lastLocalPopId = useRef<string | null>(null);

  useEffect(() => {
    const tree = command.renderTree;
    if (!tree?.navigationStack) return;
    setPages((previous) => applyRender(previous, tree));
  }, [command.renderTree]);

  const searchText = topPage(pages)?.searchText ?? "";
  const setSearchText = useCallback((value: string) => {
    setPages((previous) => updateTop(previous, { searchText: value }));
  }, []);

  const selectedItemId = topPage(pages)?.selectedItemId ?? null;
  const setSelectedItemId = useCallback((itemId: string | null) => {
    setPages((previous) => updateTop(previous, { selectedItemId: itemId }));
  }, []);

  // Local pop (Escape / Ctrl+[): drop the top page here, then notify the extension through its
  // `navigationStack.onPop` callback — its reply carries the same pop id and `applyRender` updates
  // the top page in place (Raycast's `localPop` dedupe).
  const popOne = useCallback(() => {
    const popId = `localpop_${Math.random().toString(36).slice(2, 10)}`;
    let popped = false;
    setPages((previous) => {
      const next = popPage(previous, popId);
      popped = next.popped;
      return next.state;
    });
    const onPop = command.renderTree?.navigationStack?.onPop;
    if (popped && onPop) {
      lastLocalPopId.current = popId;
      void command.createCallback(onPop)(popId);
    }
  }, [command]);

  const popToRoot = useCallback(() => {
    setPages((previous) => popToRootPages(previous));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      setSearchText((event as CustomEvent<string>).detail);
      setPanelOpen(false);
    };
    window.addEventListener("raycast-mini:search", handler);
    return () => window.removeEventListener("raycast-mini:search", handler);
  }, [setSearchText]);

  // `extensionHost.popToRoot` (`Fne`): unwind every page, optionally clearing the search bar.
  useEffect(() => {
    if (!command.sessionId) return;
    return onNotification("extensionHost.popToRoot", (raw) => {
      const payload = raw as { sessionId?: string; clearSearchBar?: boolean };
      if (payload.sessionId && payload.sessionId !== command.sessionId) return;
      popToRoot();
      if (payload.clearSearchBar) setSearchText("");
      setPanelOpen(false);
    });
  }, [command.sessionId, popToRoot, setSearchText]);

  const body = topPage(pages)?.body;
  // Effective selection: the keyboard, the action groups and the test hooks operate on the row
  // that is actually highlighted — a fresh page has no stored selection, and Raycast's fallback
  // is the first item. Without this, the first ArrowDown only "fills in" the already-highlighted
  // first row and looks like a dead key.
  const bodyItems = useMemo(() => (body ? flatItems(body) : []), [body]);
  const effectiveSelectedId = useMemo(() => {
    if (selectedItemId && bodyItems.some((item) => item.id === selectedItemId)) return selectedItemId;
    return bodyItems[0]?.id ?? null;
  }, [selectedItemId, bodyItems]);

  const groups: ActionGroup[] = useMemo(() => {
    if (entry.kind !== "extension" || !body) return [];
    const itemActions = bodyItems
      .filter((item) => item.id === effectiveSelectedId)
      .flatMap((item) => item.actions ?? []);
    const models = [...(body.actions ?? []), ...itemActions];
    return models.length ? [{ name: "actions", actions: models }] : [];
  }, [entry, body, bodyItems, effectiveSelectedId]);

  // Dev-only automation hooks for the running command (see testHooks.ts).
  useEffect(() => {
    if (!isDevExtensionsEnabled() || entry.kind !== "extension") return;
    const runPrimary = () => {
      if (!body) return false;
      const items = bodyItems;
      const selected = items.find((item) => item.id === effectiveSelectedId) ?? items[0];
      const primary = selected?.actions?.[0] ?? body.actions?.[0];
      if (!primary) return false;
      void command.createCallback(primary.id)({ itemId: primary.itemId });
      return true;
    };
    overrideTestHooks({
      press: (key) => {
        if (key === "enter") return runPrimary();
        if (key === "pop") {
          popOne();
          return true;
        }
        if (key === "popToRoot") {
          popToRoot();
          return true;
        }
        if (key === "escape") {
          onBack();
          return true;
        }
        return false;
      },
      state: () => ({
        view: "command",
        command: entry.command.title,
        pages: pages.pages.length,
        kind: body?.kind ?? null,
        selectedItemId,
        searchText,
      }),
    });
  });

  if (entry.kind === "clipboard") {
    return (
      <ClipboardHistoryView
        searchText={searchText}
        onSearchTextChange={setSearchText}
        subscribeStateChanged={subscribeClipboardStateChanged}
        showToast={showToast}
        onBack={onBack}
        runEntryAction={runClipboardEntryAction}
        closeMainWindow={closeWindow}
        openUrl={openClipboardUrl}
      />
    );
  }

  if (entry.kind === "translator-command") {
    // "Open Translator with Command": the view opens with the command's languages applied.
    return (
      <TranslateView
        command="translate"
        seed={{ id: entry.command.id, source: entry.command.source ?? "auto", target: entry.command.target }}
        showToast={showToast}
        onBack={onBack}
        closeMainWindow={closeWindow}
      />
    );
  }

  if (entry.kind === "internal") {
    if (entry.area === "quicklinks") {
      // The InternalCommandEntry type is a product of area × command; only the four quicklinks
      // commands are ever filed under this area (INTERNAL_COMMANDS is the single source).
      return (
        <QuicklinksView
          command={entry.command as QuicklinksCommandName}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          showToast={showToast}
          onBack={onBack}
          closeMainWindow={closeWindow}
          applications={applications}
          createLink={createLink}
          onConsumeCreateLink={onConsumeCreateLink}
        />
      );
    }
    if (entry.area === "calculator") {
      // Only reachable through the calculator row's `Show History` action — the calculator is an
      // ephemeral root-search section, not a searchable command.
      return (
        <CalculatorHistoryView
          command="history"
          searchText={searchText}
          onSearchTextChange={setSearchText}
          showToast={showToast}
          onBack={onBack}
          closeMainWindow={closeWindow}
        />
      );
    }
    if (entry.area === "translator") {
      // The Translate command view: a form, not a filter — the seed (quick row / custom command)
      // prefills the source text and selectors on mount.
      return (
        <TranslateView
          command="translate"
          seed={translatorSeed}
          showToast={showToast}
          onBack={onBack}
          closeMainWindow={closeWindow}
        />
      );
    }
    if (entry.area === "file-search") {
      // The Search Files view: the filter IS the backend indexer query; the type/sort dropdowns
      // and the details pane live inside the view.
      return (
        <SearchFilesView
          command="searchFiles"
          searchText={searchText}
          onSearchTextChange={setSearchText}
          showToast={showToast}
          onBack={onBack}
          closeMainWindow={closeWindow}
          applications={applications}
        />
      );
    }
    if (entry.area === "store") {
      // The Store view: catalog search, extension detail, Install/Update/Uninstall.
      return (
        <StoreView
          searchText={searchText}
          onSearchTextChange={setSearchText}
          showToast={showToast}
          onBack={onBack}
        />
      );
    }
    if (entry.area === "notes") {
      // Raycast Notes: `open`/`create` have no view — they close the launcher and open the Notes
      // window; `search` renders the confirmed Search Notes view.
      if (entry.command === "open" || entry.command === "create") {
        return <NotesWindowRedirect command={entry.command} closeMainWindow={closeWindow} onBack={onBack} />;
      }
      return (
        <SearchNotesView
          command="search"
          searchText={searchText}
          onSearchTextChange={setSearchText}
          showToast={showToast}
          onBack={onBack}
          closeMainWindow={closeWindow}
          onCreateQuicklink={(note) => onOpenQuicklinkCreate?.({ link: noteDeeplink(note.id), name: note.title })}
        />
      );
    }
    return (
      <SnippetsView
        command={entry.command as SnippetsCommandName}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        showToast={showToast}
        onBack={onBack}
        closeMainWindow={closeWindow}
      />
    );
  }

  if (entry.kind === "wm-args") {
    // `Resize Window` / `Move Window`: the search bar becomes the argument field, Enter applies.
    return (
      <WindowManagementArgsView
        commandKey={entry.commandKey}
        showToast={showToast}
        onBack={onBack}
        closeMainWindow={closeWindow}
      />
    );
  }

  if (entry.kind === "focus-view") {
    // Focus commands: the Start/Edit form (the edit prefill comes from the backend's last start
    // input), the categories session (view + create/edit/open forms), or the import picker.
    if (entry.command === "searchCategories") {
      return <FocusCategoriesSession showToast={showToast} onBack={onBack} applications={applications} />;
    }
    if (entry.command === "importCategories") {
      return <FocusImportView showToast={showToast} onBack={onBack} onChanged={() => undefined} />;
    }
    return (
      <FocusFormView
        formMode={entry.command === "edit" ? "edit" : "start"}
        showToast={showToast}
        onBack={onBack}
        closeMainWindow={closeWindow}
        applications={applications}
      />
    );
  }

  if (entry.kind === "games-view") {
    return <GameLauncherView showToast={showToast} onBack={onBack} closeMainWindow={closeWindow} />;
  }

  if (entry.kind !== "extension") {
    // Applications are handled natively; this keeps the type narrow.
    return null;
  }

  return (
    <div className="window" onMouseDown={keepSearchFocus}>
      <header className="window__header">
        <button type="button" className="back-button" onClick={pages.pages.length > 1 ? popOne : onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="searchbar">
          {/* Raycast's single search bar: the command view's input doubles as the List/Grid search
              (placeholder + accessory come from the current page's body) — never a second input. */}
          <input
            ref={searchInputRef}
            className="searchbar__input"
            autoFocus
            value={searchText}
            placeholder={body?.searchBarPlaceholder ?? `Filter ${entry.command.title}…`}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                setPanelOpen((open) => !open);
              } else if (event.key === "[" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (pages.pages.length > 1) popOne();
                else onBack();
              } else if (event.key === "Escape") {
                if (searchText) setSearchText("");
                else if (panelOpen) setPanelOpen(false);
                else if (pages.pages.length > 1) popOne();
                else onBack();
              } else if (event.key === "Enter" && event.shiftKey) {
                // Shift+Enter toggles the action panel, like Raycast's action-bar button.
                setPanelOpen((open) => !open);
              }
            }}
          />
          {body?.searchBarAccessory && "sections" in body.searchBarAccessory ? (
            <SearchBarDropdown accessory={body.searchBarAccessory} createCallback={command.createCallback} />
          ) : null}
        </div>
        <button
          type="button"
          className="action-bar-button"
          aria-label="Actions"
          data-state={panelOpen ? "open" : "closed"}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
          </svg>
        </button>

        <LoadingBar isLoading={command.isLoading || command.phase === "loading"} />
      </header>

      <main className="window__body" style={{ padding: 0 }}>
        {command.isLoading || command.phase === "loading" ? (
          <div className="state">
            <div className="state__title">Loading…</div>
          </div>
        ) : command.error ? (
          <div className="state">
            <div className="state__title">Command failed</div>
            <div className="state__message">{command.error.message}</div>
          </div>
        ) : command.suspended ? (
          <div className="state">
            <div className="state__title">Preparing view…</div>
          </div>
        ) : body ? (
          <CommandViewKeyboard
            body={body}
            selectedItemId={effectiveSelectedId}
            onSelectionChange={setSelectedItemId}
            onPopOne={popOne}
            onPopToRoot={popToRoot}
            onRunPrimary={(action) => {
              void command.createCallback(action.id)({ itemId: action.itemId });
            }}
          >
            <RenderedView
              page={topPage(pages)!}
              onSelectionChange={setSelectedItemId}
              createCallback={command.createCallback}
              onLoadMore={() => {
                const onLoadMore = body.pagination?.onLoadMore;
                if (onLoadMore) void command.createCallback(onLoadMore)({});
              }}
            />
          </CommandViewKeyboard>
        ) : (
          <div className="state">
            <div className="state__title">Preparing view…</div>
          </div>
        )}
      </main>

      <footer className="window__footer">
        <button
          type="button"
          className="footer-icon-button"
          aria-label="Settings"
          onClick={openSettings}
        >
          <RaycastIcon name="cog" size={16} />
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
        open={panelOpen}
        title="Actions"
        groups={[...groups, ...toastGroups]}
        onClose={() => setPanelOpen(false)}
        onRun={async (action) => {
          if (await runToastAction(action.id)) {
            setPanelOpen(false);
            return;
          }
          command.createCallback(action.id)({ itemId: action.itemId });
          setPanelOpen(false);
        }}
      />
    </div>
  );
}

/**
 * The Notes window entry commands (`Raycast Notes` / `Create Note`): Raycast closes the main
 * window and calls `host.raycast.showNotesWindow` — no view exists for these two commands. The
 * selection is reset immediately so the next launcher show lands at the root.
 */
function NotesWindowRedirect({
  command,
  closeMainWindow,
  onBack,
}: {
  command: "open" | "create";
  closeMainWindow: () => void;
  onBack: () => void;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    closeMainWindow();
    openNotesWindow(command === "create" ? { create: true } : {});
    onBack();
    // Raycast's command runs exactly once per invocation; the deps exist to satisfy the linter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Window-level keyboard for a running command view: arrows move the selection (1D lists and 2D
 * grids), Enter runs the selected item's primary action, Escape/Ctrl+[ pop, Shift+Escape pops to
 * root — Raycast's `goBack`/`popToRoot` shortcuts (`shortcuts-C1kqjDmf.js`). Delegated to a child so
 * the key map can read the current page's items.
 */
function CommandViewKeyboard({
  body,
  selectedItemId,
  onSelectionChange,
  onPopOne,
  onPopToRoot,
  onRunPrimary,
  children,
}: {
  body: ViewBody;
  selectedItemId: string | null;
  onSelectionChange: (id: string | null) => void;
  onPopOne: () => void;
  onPopToRoot: () => void;
  onRunPrimary: (action: ViewAction) => void;
  children: ReactNode;
}) {
  const ids = useMemo(() => selectableIds(body.sections, flatItems(body)), [body]);
  const rowWidths = useMemo(() => (body.kind === "Grid" ? gridRowWidths(body) : null), [body]);
  const items = useMemo(() => flatItems(body), [body]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inSearch = target?.classList?.contains("searchbar__input") ?? false;
      if (event.key === "Escape" && event.shiftKey) {
        event.preventDefault();
        onPopToRoot();
        return;
      }
      if (event.key === "[" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onPopOne();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") return; // the search input and the session handle Escape
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (ids.length === 0) return;
        event.preventDefault();
        const index = selectedItemId ? ids.indexOf(selectedItemId) : -1;
        if (rowWidths) {
          onSelectionChange(moveInGrid(ids, rowWidths, index, event.key));
        } else if (event.key === "ArrowDown") {
          onSelectionChange(ids[Math.min(index + 1, ids.length - 1)]);
        } else if (event.key === "ArrowUp") {
          onSelectionChange(ids[Math.max(index - 1, 0)]);
        }
        return;
      }
      if (event.key === "Enter") {
        // Enter runs the selected item's primary action from anywhere in the command view —
        // including the search input, which keeps focus by design (keepSearchFocus).
        const selected = items.find((item) => item.id === selectedItemId) ?? items[0];
        const primary = selected?.actions?.[0];
        if (primary) {
          event.preventDefault();
          onRunPrimary(primary);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ids, rowWidths, items, selectedItemId, onSelectionChange, onPopOne, onPopToRoot, onRunPrimary]);

  return <>{children}</>;
}

/** 2D movement over ragged grid rows (`rowWidths` per row). */
export function moveInGrid(ids: string[], rowWidths: number[], currentIndex: number, key: string): string {
  if (ids.length === 0) return ids[0] ?? null as unknown as string;
  if (currentIndex < 0) return ids[0];
  // Build row offset table.
  const rowStarts: number[] = [];
  let offset = 0;
  for (const width of rowWidths) {
    rowStarts.push(offset);
    offset += width;
  }
  let row = rowStarts.findIndex((start, rowIndex) => currentIndex >= start && currentIndex < start + rowWidths[rowIndex]);
  if (row < 0) row = 0;
  const column = currentIndex - rowStarts[row];
  if (key === "ArrowRight") {
    const next = currentIndex + 1;
    return next < ids.length ? ids[next] : ids[currentIndex];
  }
  if (key === "ArrowLeft") {
    const previous = currentIndex - 1;
    return previous >= 0 ? ids[previous] : ids[currentIndex];
  }
  if (key === "ArrowDown") {
    const nextRow = row + 1;
    if (nextRow >= rowWidths.length) return ids[currentIndex];
    const targetColumn = Math.min(column, rowWidths[nextRow] - 1);
    return ids[rowStarts[nextRow] + targetColumn];
  }
  // ArrowUp
  const previousRow = row - 1;
  if (previousRow < 0) return ids[currentIndex];
  const targetColumn = Math.min(column, rowWidths[previousRow] - 1);
  return ids[rowStarts[previousRow] + targetColumn];
}



/**
 * Stored per-command preferences (`store.getCommandPreferences`): `null` while loading, the
 * (possibly empty) preference map once fetched. Local SQLite — resolves in a tick.
 */
function useStorePreferences(
  uuid: string | null,
  commandName: string | null,
): Record<string, unknown> | null {
  const [preferences, setPreferences] = useState<Record<string, unknown> | null>(null);
  const uuidKey = uuid ?? "";
  const commandKey = commandName ?? "";
  useEffect(() => {
    if (!uuidKey || !commandKey) {
      setPreferences({});
      return;
    }
    let cancelled = false;
    setPreferences(null);
    void storeGetCommandPreferences(uuidKey, commandKey)
      .then((result) => {
        if (!cancelled) setPreferences(result.preferences ?? {});
      })
      .catch(() => {
        if (!cancelled) setPreferences({});
      });
    return () => {
      cancelled = true;
    };
  }, [uuidKey, commandKey]);
  return preferences;
}
