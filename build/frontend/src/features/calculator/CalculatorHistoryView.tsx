// The Calculator History view (`/extension/calculator/history` in the shipped app).
//
// Ported from the shipped history page (docs/calculator-spec.md): the search bar doubles as a
// live evaluator (a result row is computed per keystroke), history sections are
// Pinned/Today/Yesterday/This Week/This Month/This Year/Older, rows show the expression on the
// left and the answer on the right with the category icon, and the action set mirrors the root
// calculator row plus Copy Question / Put Question in Search Bar / pin management / deletes.
// Clearing the search saves the live result to history (confirmed behavior).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { ipc, onNotification } from "../../ipc";
import { OpenrayIcon } from "../../icons";
import { CommandFooter } from "../../commandChrome";

interface HistoryEntry {
  id: string;
  expression: string;
  answer: string;
  category: string;
  pinned: number | null;
  createdAt: number;
}

interface Evaluation {
  answer: string;
  unformatted: string;
  category: string;
  swappedExpression: string | null;
  unitFrom: string | null;
  unitTo: string | null;
  currencyFrom: string | null;
  currencyTo: string | null;
}

interface RatesMeta {
  fetchedAt: number;
  stale: boolean;
}

const CATEGORY_ICONS: Record<string, string> = {
  math: "calculator",
  unitConversion: "switch",
  dateTime: "clock",
};

const AGE_SECTIONS: Array<{ id: string; title: string; match: (timestamp: number, now: number) => boolean }> = [
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

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface CalculatorHistoryViewProps {
  command: "history";
  searchText: string;
  onSearchTextChange: (value: string) => void;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
}

export function CalculatorHistoryView({
  command,
  searchText,
  onSearchTextChange,
  showToast,
  onBack,
  closeMainWindow,
}: CalculatorHistoryViewProps) {
  void command;
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [live, setLive] = useState<{ expression: string; evaluation: Evaluation; rates: RatesMeta | null } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const refresh = useCallback(() => {
    void ipc.backend("calculator.historyGetAll", {}, { module: "backend" })
      .then((raw) => setEntries(((raw as { entries?: HistoryEntry[] }).entries ?? []) as HistoryEntry[]))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    return onNotification("calculator.updated", refresh);
  }, [refresh]);

  // Live evaluation per keystroke — the same backend engine the root row uses.
  useEffect(() => {
    const query = searchText.trim();
    if (!query) {
      setLive(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void ipc.backend("calculator.calculate", { expression: query }, { module: "backend" })
        .then((raw) => {
          if (cancelled) return;
          const payload = raw as { result: Evaluation | null; rates?: RatesMeta | null };
          setLive(payload.result ? { expression: query, evaluation: payload.result, rates: payload.rates ?? null } : null);
        })
        .catch(() => {
          if (!cancelled) setLive(null);
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText]);

  // Confirmed: clearing the search saves the live result to history.
  const previousSearch = useRef(searchText);
  useEffect(() => {
    const wasTyping = previousSearch.current.trim().length > 0;
    previousSearch.current = searchText;
    if (!wasTyping || searchText.trim().length > 0 || !live) return;
    void ipc.backend(
      "calculator.historyUpsert",
      { expression: live.expression, answer: live.evaluation.answer, category: live.evaluation.category },
      { module: "backend" },
    ).catch(() => undefined);
  }, [searchText, live]);

  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(
      (entry) => entry.expression.toLowerCase().includes(query) || entry.answer.toLowerCase().includes(query),
    );
  }, [entries, searchText]);

  const sections = useMemo(() => {
    const now = Date.now();
    const pinned = filtered.filter((entry) => entry.pinned !== null);
    const unpinned = filtered.filter((entry) => entry.pinned === null);
    const result: Array<{ id: string; title: string; entries: HistoryEntry[] }> = [];
    if (pinned.length) result.push({ id: "pinned", title: "Pinned", entries: pinned });
    for (const section of AGE_SECTIONS) {
      const sectionEntries = unpinned.filter((entry) => section.match(entry.createdAt, now));
      if (sectionEntries.length) result.push({ id: section.id, title: section.title, entries: sectionEntries });
    }
    return result;
  }, [filtered]);

  const rows = useMemo(
    () => (live ? [{ kind: "live" as const, entry: null }, ...sections.flatMap((section) => section.entries.map((entry) => ({ kind: "history" as const, entry })))] : sections.flatMap((section) => section.entries.map((entry) => ({ kind: "history" as const, entry })))),
    [live, sections],
  );

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

  const selectedRow = rows[selectedIndex] ?? null;
  const selectedHistory = selectedRow?.kind === "history" ? selectedRow.entry : null;

  const copyAnswer = useCallback(
    async (answer: string, upsert?: { expression: string; category: string }) => {
      try {
        await ipc.backend("clipboard.write", { content: answer }, { module: "backend" });
        if (upsert) {
          await ipc.backend(
            "calculator.historyUpsert",
            { expression: upsert.expression, answer, category: upsert.category },
            { module: "backend" },
          );
        }
        showToast("Copied answer to clipboard");
      } catch {
        showToast("Failed copying answer");
      }
    },
    [showToast],
  );

  const pasteAnswer = useCallback(
    async (answer: string, upsert?: { expression: string; category: string }) => {
      try {
        if (upsert) {
          await ipc.backend(
            "calculator.historyUpsert",
            { expression: upsert.expression, answer, category: upsert.category },
            { module: "backend" },
          );
        }
        await ipc.backend("clipboard.paste", { text: answer, shouldCloseWindow: true }, { module: "backend" });
      } catch {
        showToast("Failed to paste");
      }
    },
    [showToast],
  );

  const runSwapUnits = useCallback(
    async (expression: string) => {
      try {
        const response = (await ipc.backend("calculator.swapUnits", { expression }, { module: "backend" })) as {
          expression: string | null;
        };
        if (response.expression) onSearchTextChange(response.expression);
      } catch {
        /* nothing to swap */
      }
    },
    [onSearchTextChange],
  );

  const runPrimary = useCallback(
    (row: (typeof rows)[number]) => {
      if (row.kind === "live") {
        if (live) void copyAnswer(live.evaluation.answer, { expression: live.expression, category: live.evaluation.category });
        return;
      }
      void copyAnswer(row.entry.answer, { expression: row.entry.expression, category: row.entry.category });
    },
    [live, copyAnswer],
  );

  const runAction = useCallback(
    async (actionId: string) => {
      setPanelOpen(false);
      switch (actionId) {
        case "calc:copyAnswer":
          if (selectedRow) runPrimary(selectedRow);
          return;
        case "calc:pasteAnswer":
          if (selectedRow?.kind === "live" && live) {
            void pasteAnswer(live.evaluation.answer, { expression: live.expression, category: live.evaluation.category });
          } else if (selectedRow?.kind === "history" && selectedRow.entry) {
            void pasteAnswer(selectedRow.entry.answer, { expression: selectedRow.entry.expression, category: selectedRow.entry.category });
          }
          return;
        case "calc:copyUnformatted": {
          const answer = selectedRow?.kind === "live" ? live?.evaluation.unformatted : undefined;
          try {
            await ipc.backend(
              "clipboard.write",
              { content: answer ?? (selectedHistory ? String(selectedHistory.answer) : "") },
              { module: "backend" },
            );
            showToast("Copied to clipboard");
          } catch {
            showToast("No unformatted result available");
          }
          return;
        }
        case "calc:copyQuestionAndAnswer": {
          const source = selectedRow?.kind === "live" && live
            ? `${live.expression} = ${live.evaluation.answer}`
            : selectedHistory
              ? `${selectedHistory.expression} = ${selectedHistory.answer}`
              : null;
          if (!source) return;
          try {
            await ipc.backend("clipboard.write", { content: source }, { module: "backend" });
            showToast("Copied to clipboard");
          } catch {
            showToast("Failed copying answer");
          }
          return;
        }
        case "calc:copyQuestion": {
          const question = selectedRow?.kind === "live" ? live?.expression : selectedHistory?.expression;
          if (!question) return;
          try {
            await ipc.backend("clipboard.write", { content: question }, { module: "backend" });
            showToast("Copied to clipboard");
          } catch {
            showToast("Failed copying answer");
          }
          return;
        }
        case "calc:putQuestionInSearchBar": {
          const question = selectedRow?.kind === "live" ? live?.expression : selectedHistory?.expression;
          if (question) onSearchTextChange(question);
          return;
        }
        case "calc:putAnswerInSearchBar": {
          const answer = selectedRow?.kind === "live" ? live?.evaluation.answer : selectedHistory?.answer;
          if (answer) onSearchTextChange(answer);
          return;
        }
        case "calc:swapUnits": {
          const expression = selectedRow?.kind === "live" ? live?.expression : selectedHistory?.expression;
          if (expression) void runSwapUnits(expression);
          return;
        }
        case "calc:pin":
          if (selectedHistory) {
            await ipc.backend("calculator.historyPin", { id: selectedHistory.id }, { module: "backend" });
            showToast("Pinned calculation");
          }
          return;
        case "calc:unpin":
          if (selectedHistory) {
            await ipc.backend("calculator.historyUnpin", { id: selectedHistory.id }, { module: "backend" });
            showToast("Unpinned calculation");
          }
          return;
        case "calc:moveUp":
          if (selectedHistory) await ipc.backend("calculator.historyMovePinnedUp", { id: selectedHistory.id }, { module: "backend" });
          return;
        case "calc:moveDown":
          if (selectedHistory) await ipc.backend("calculator.historyMovePinnedDown", { id: selectedHistory.id }, { module: "backend" });
          return;
        case "calc:delete":
          if (selectedHistory) {
            await ipc.backend("calculator.historyDelete", { id: selectedHistory.id }, { module: "backend" });
            showToast("Deleted Entry");
          }
          return;
        case "calc:deleteAll":
          setConfirmingDeleteAll(true);
          return;
        case "calc:refreshCurrencies":
          try {
            await ipc.backend("calculator.refreshCurrencies", {}, { module: "backend" });
            showToast("Currencies refreshed!");
          } catch (cause) {
            showToast("Failed to refresh currencies", cause instanceof Error ? cause.message : String(cause));
          }
          return;
        default:
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRow, selectedHistory, live, runPrimary, pasteAnswer, runSwapUnits, showToast, onSearchTextChange],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (confirmingDeleteAll) return;
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
        const row = rows[selectedIndex];
        if (!row) return;
        event.preventDefault();
        runPrimary(row);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, selectedIndex, runPrimary, confirmingDeleteAll]);

  const actionGroups = useMemo<ActionGroup[]>(() => {
    const primary: ActionGroup["actions"] = [];
    const manage: ActionGroup["actions"] = [];
    const remove: ActionGroup["actions"] = [];
    const expression = selectedRow?.kind === "live" ? live?.expression : selectedHistory?.expression;
    if (selectedRow) {
      primary.push({ id: "calc:copyAnswer", title: "Copy Answer", itemId: "" });
      primary.push({ id: "calc:pasteAnswer", title: "Paste Answer", itemId: "" });
      primary.push({ id: "calc:copyUnformatted", title: "Copy Unformatted Answer", itemId: "" });
      primary.push({ id: "calc:copyQuestionAndAnswer", title: "Copy Question and Answer", itemId: "" });
      primary.push({ id: "calc:copyQuestion", title: "Copy Question", itemId: "" });
      primary.push({ id: "calc:putQuestionInSearchBar", title: "Put Question in Search Bar", itemId: "" });
      primary.push({ id: "calc:putAnswerInSearchBar", title: "Put Answer in Search Bar", itemId: "" });
      if (expression) primary.push({ id: "calc:swapUnits", title: "Swap Units", itemId: "" });
      if (selectedHistory) {
        if (selectedHistory.pinned === null) manage.push({ id: "calc:pin", title: "Pin Entry", itemId: "" });
        else {
          manage.push({ id: "calc:unpin", title: "Unpin Entry", itemId: "" });
          manage.push({ id: "calc:moveUp", title: "Move Up in Pinned", itemId: "" });
          manage.push({ id: "calc:moveDown", title: "Move Down in Pinned", itemId: "" });
        }
        remove.push({ id: "calc:delete", title: "Delete Entry", itemId: "" });
      }
    }
    remove.push({ id: "calc:deleteAll", title: "Delete All Entries", itemId: "" });
    return [
      { name: "primary", actions: primary },
      { name: "manage", actions: manage },
      { name: "delete", actions: remove },
    ].filter((group) => group.actions.length > 0);
  }, [selectedRow, selectedHistory, live]);

  const categoryIcon = (category: string) => CATEGORY_ICONS[category] ?? "calculator";

  const renderHistoryRow = (entry: HistoryEntry) => {
    const index = rows.findIndex((row) => row.kind === "history" && row.entry?.id === entry.id);
    return (
      <li key={entry.id}>
        <button
          type="button"
          className="list__row calc-history-row"
          data-selected={index === selectedIndex}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => runPrimary({ kind: "history", entry })}
          onContextMenu={(event) => {
            event.preventDefault();
            setSelectedIndex(index);
            setPanelOpen(true);
          }}
        >
          <span className="icon" aria-hidden>
            <OpenrayIcon name={categoryIcon(entry.category)} size={16} />
          </span>
          <span className="list__text calc-history-row__text">
            <span className="list__title">{entry.expression}</span>
          </span>
          <span className="calc-history-row__answer">{entry.answer}</span>
          {entry.pinned !== null ? (
            <span className="list__favorite" title="Pinned">
              <OpenrayIcon name="tack" size={13} />
            </span>
          ) : null}
        </button>
      </li>
    );
  };

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
            placeholder="Do math, convert units, or search your past calculations..."
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>
      </header>

      <main className="window__body clipboard-body">
        {rows.length === 0 ? (
          <div className="state">
            <div className="state__title">{entries.length === 0 ? "You have no recent calculations" : "No results"}</div>
            <div className="state__message">
              {entries.length === 0
                ? 'Try "9 am SF", "17m", or "25% of $500 in GBP"'
                : "Try a different expression"}
            </div>
          </div>
        ) : (
          <div className="clipboard-split">
            <ul className="list clipboard-list" ref={listRef}>
              {live ? (
                <li>
                  <button
                    type="button"
                    className="list__row calc-row calc-row--history"
                    data-selected={selectedIndex === 0}
                    onMouseEnter={() => setSelectedIndex(0)}
                    onClick={() => runPrimary({ kind: "live", entry: null })}
                  >
                    <span className="calc-row__left">
                      <span className="calc-row__expression">{live.expression}</span>
                      <span className="calc-row__badge">
                        {live.evaluation.unitFrom ?? live.evaluation.currencyFrom ?? "Expression"}
                      </span>
                      {live.evaluation.currencyTo && live.rates ? (
                        <span className="calc-row__rates" data-stale={live.rates.stale || undefined}>
                          {live.rates.stale ? "Currency rates are out of date" : `Updated ${formatRelative(live.rates.fetchedAt)}`}
                        </span>
                      ) : null}
                    </span>
                    <span className="calc-row__divider" aria-hidden>
                      <OpenrayIcon name="chevron-right" size={14} />
                    </span>
                    <span className="calc-row__right">
                      <span className="calc-row__answer">{live.evaluation.answer}</span>
                      <span className="calc-row__badge">
                        {live.evaluation.unitTo ?? live.evaluation.currencyTo ?? "Result"}
                      </span>
                    </span>
                  </button>
                </li>
              ) : null}

              {sections.map((section) => (
                <li key={section.id} className="list__section">
                  <div className="list__sectionHeader">
                    <span className="list__sectionTitle">{section.title}</span>
                    <span className="list__sectionCount">{section.entries.length}</span>
                  </div>
                  <ul className="list__sectionBody">{section.entries.map(renderHistoryRow)}</ul>
                </li>
              ))}
            </ul>

            {selectedHistory ? (
              <aside className="clipboard-detail">
                <div className="clipboard-detail__section">
                  <div className="clipboard-detail__heading">Information</div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Expression</span>
                    <span className="clipboard-detail__value">{selectedHistory.expression}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Answer</span>
                    <span className="clipboard-detail__value">{selectedHistory.answer}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Category</span>
                    <span className="clipboard-detail__value">{selectedHistory.category}</span>
                  </div>
                  <div className="clipboard-detail__row">
                    <span className="clipboard-detail__label">Calculated</span>
                    <span className="clipboard-detail__value">{new Date(selectedHistory.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </main>

      <CommandFooter
        area="calculator"
        title="Calculator History"
        primary={
          selectedRow
            ? {
                label: "Copy Answer",
                key: "",
                onPress: () => runPrimary(selectedRow),
              }
            : undefined
        }
        actions={
          <button type="button" className="footer-action footer-action--kbd" onClick={() => setPanelOpen(true)}>
            Actions <span className="kbd">Ctrl</span>
            <span className="kbd">K</span>
          </button>
        }
      />

      <ActionPanel
        open={panelOpen}
        title="Calculator History"
        groups={actionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={(action) => runAction(action.id)}
      />

      {confirmingDeleteAll ? (
        <div className="action-panel">
          <div className="action-panel__backdrop" onClick={() => setConfirmingDeleteAll(false)} aria-hidden />
          <div className="action-panel__popover clipboard-prompt" role="alertdialog">
            <div className="action-panel__title">Delete All Entries</div>
            <div className="clipboard-confirm__body">
              Are you sure you want to proceed with deleting all calculator history entries? Only pinned
              entries will remain.
            </div>
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
                    await ipc.backend("calculator.historyDeleteAll", {}, { module: "backend" });
                    showToast("Deleted All Entries");
                  } catch (cause) {
                    showToast("Failed to delete entries", cause instanceof Error ? cause.message : String(cause));
                  }
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
