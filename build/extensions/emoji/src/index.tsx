import { useEffect, useState, type ReactElement } from "react";
import {
  Action,
  ActionPanel,
  Grid,
  defineReactExtension,
  type CommandProps,
} from "@flowkey-mini/react-ui";
import type { ExtensionManifest } from "@flowkey-mini/native-sdk";
import manifestJson from "../manifest.json";
import {
  ALL,
  CATEGORY_ORDER,
  FILTER_OPTIONS,
  applyTone,
  byCategory,
  frequentlyUsed,
  searchEmoji,
  unicodeRepresentation,
  type CategoryId,
  type EmojiRecord,
} from "./data";
import {
  EMPTY_STATE,
  loadState,
  movePinned,
  recordUse,
  saveState,
  setKeywords,
  togglePinned,
  type EmojiState,
} from "./state";

const manifest = manifestJson as unknown as ExtensionManifest;

interface PickerPreferences {
  primaryAction: "paste" | "copy";
  columnCount: number;
  skinTone: string;
}

function readPreferences(props: CommandProps): PickerPreferences {
  const primaryAction = props.preferences.primaryAction === "copy" ? "copy" : "paste";
  const rawColumns = Number(props.preferences.columnCount);
  const columnCount = Number.isFinite(rawColumns) ? Math.min(12, Math.max(2, Math.round(rawColumns))) : 8;
  const skinTone = typeof props.preferences.skinTone === "string" ? props.preferences.skinTone : "none";
  return { primaryAction, columnCount, skinTone };
}

interface SectionRef {
  id: string;
  items: EmojiRecord[];
}

function EmojiPickerView(props: CommandProps) {
  const [state, setState] = useState<EmojiState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void loadState(props.capabilities).then((next) => {
      setState(next);
      setLoaded(true);
    });
    // The picker loads once per command session; capabilities are stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preferences = readPreferences(props);
  const query = props.query.trim();
  const category = props.filterValue && props.filterValue !== "all" ? props.filterValue : undefined;

  const update = (next: EmojiState) => {
    setState(next);
    void saveState(props.capabilities, next);
  };

  const glyph = (record: EmojiRecord) => applyTone(record.s, preferences.skinTone);

  const uprank = (record: EmojiRecord) => {
    setState((previous) => {
      const next = recordUse(previous, record.s);
      void saveState(props.capabilities, next);
      return next;
    });
  };

  const copy = async (text: string, message: string) => {
    await props.capabilities.clipboard.write(text);
    await props.capabilities.hud.show({ title: message, icon: text });
  };

  const paste = async (text: string, message: string, keepOpen: boolean) => {
    // Raycast's paste: write the clipboard, hand focus back to the frontmost app, deliver the
    // keystroke there, then close the launcher (unless the caller asked to keep it open).
    await props.capabilities.clipboard.paste(text);
    await props.capabilities.hud.show({ title: message, icon: text });
    if (!keepOpen) props.window.closeMainWindow();
  };

  const saveAsSnippet = async (record: EmojiRecord) => {
    await props.native.call("snippets.create", { title: record.n, text: record.s });
    await props.capabilities.hud.show({ title: "Snippet saved", icon: glyph(record) });
  };

  const pinnedRecords = state.pinned
    .map((symbol) => ALL.find((record) => record.s === symbol))
    .filter((record): record is EmojiRecord => record !== undefined);

  const results = query.length > 0 ? searchEmoji(state, query) : [];
  const recent = query.length === 0 ? frequentlyUsed(state, preferences.columnCount * 2) : [];

  const actionsFor = (record: EmojiRecord, section: SectionRef): ReactElement => {
    const text = glyph(record);
    const frecencyEntry = state.frecency[record.s];
    const pinnedIndex = state.pinned.indexOf(record.s);
    const isPinned = pinnedIndex >= 0;
    const keywords = state.keywords[record.s] ?? [];
    const panel: ReactElement[] = [];

    const copyAction = (title: string, shortcut: { key: string; modifiers?: string[] }) => (
      <Action
        key={title}
        title={title}
        icon={{ lucide: "clipboard-copy" }}
        shortcut={shortcut}
        onAction={async () => {
          await copy(text, "Copied to clipboard");
          uprank(record);
        }}
      />
    );
    const pasteAction = (title: string, shortcut: { key: string; modifiers?: string[] }, keepOpen: boolean) => (
      <Action
        key={title}
        title={title}
        icon={{ lucide: "clipboard-paste" }}
        shortcut={shortcut}
        onAction={async () => {
          await paste(text, "Pasted", keepOpen);
          uprank(record);
        }}
      />
    );

    if (preferences.primaryAction === "paste") {
      panel.push(pasteAction("Paste", { key: "return" }, false));
      panel.push(copyAction("Copy to Clipboard", { key: "return", modifiers: ["ctrl"] }));
      panel.push(pasteAction("Paste and Keep Window Open", { key: "return", modifiers: ["ctrl", "shift"] }, true));
    } else {
      panel.push(copyAction("Copy to Clipboard", { key: "return" }));
      panel.push(pasteAction("Paste", { key: "return", modifiers: ["ctrl"] }, false));
      panel.push(copyAction("Copy and Keep Window Open", { key: "return", modifiers: ["ctrl", "shift"] }));
    }

    panel.push(
      <Action
        key="copy-unicode"
        title="Copy Unicode"
        icon={{ lucide: "hash" }}
        shortcut={{ key: "c", modifiers: ["ctrl", "alt", "shift"] }}
        onAction={async () => {
          await copy(unicodeRepresentation(text), "Unicode copied");
        }}
      />,
    );
    if (section.items.length > 1) {
      panel.push(
        <Action
          key="copy-section"
          title="Copy All Emojis from Section"
          icon={{ lucide: "list" }}
          shortcut={{ key: "c", modifiers: ["alt", "shift"] }}
          onAction={async () => {
            await copy(section.items.map((entry) => glyph(entry)).join(" "), "Section copied");
          }}
        />,
      );
    }
    panel.push(
      <Action
        key="save-snippet"
        title="Save as Snippet"
        icon={{ lucide: "notebook-pen" }}
        shortcut={{ key: "s", modifiers: ["ctrl"] }}
        onAction={() => saveAsSnippet(record)}
      />,
    );
    panel.push(
      isPinned ? (
        <Action
          key="pin"
          title={`Unpin ${record.c === "unicode_symbols" ? "Symbol" : "Emoji"}`}
          icon={{ lucide: "pin-off" }}
          onAction={() => update(togglePinned(state, record.s))}
        />
      ) : (
        <Action
          key="pin"
          title={`Pin ${record.c === "unicode_symbols" ? "Symbol" : "Emoji"}`}
          icon={{ lucide: "pin" }}
          onAction={() => update(togglePinned(state, record.s))}
        />
      ),
    );
    if (isPinned && pinnedIndex > 0) {
      panel.push(
        <Action
          key="pin-up"
          title="Move Up in Pinned"
          icon={{ lucide: "arrow-up" }}
          onAction={() => update(movePinned(state, record.s, -1))}
        />,
      );
    }
    if (isPinned && pinnedIndex < state.pinned.length - 1) {
      panel.push(
        <Action
          key="pin-down"
          title="Move Down in Pinned"
          icon={{ lucide: "arrow-down" }}
          onAction={() => update(movePinned(state, record.s, 1))}
        />,
      );
    }
    if (frecencyEntry) {
      panel.push(
        <Action
          key="reset-ranking"
          title="Reset Ranking"
          icon={{ lucide: "rotate-ccw" }}
          onAction={() => {
            const next = { ...state };
            delete next.frecency[record.s];
            update(next);
          }}
        />,
      );
    }
    if (keywords.length > 0) {
      panel.push(
        <Action
          key="delete-keywords"
          title="Delete Custom Keywords"
          icon={{ lucide: "trash-2" }}
          style="destructive"
          onAction={() => update(setKeywords(state, record.s, []))}
        />,
      );
    }
    return <ActionPanel>{panel}</ActionPanel>;
  };

  const renderItem = (record: EmojiRecord, section: SectionRef, suffix = "") => (
    <Grid.Item
      key={record.s + suffix}
      id={record.s + suffix}
      title={record.n}
      icon={{ emoji: glyph(record) }}
      actions={actionsFor(record, section)}
    />
  );

  const sections: ReactElement[] = [];
  if (query.length > 0) {
    sections.push(
      <Grid.Section key="results" title="Results" subtitle={String(results.length)}>
        {results.map((record) => renderItem(record, { id: "results", items: results }))}
      </Grid.Section>,
    );
  } else {
    if ((!category || category === "pinned") && pinnedRecords.length > 0) {
      sections.push(
        <Grid.Section key="pinned" title="Pinned" subtitle={String(pinnedRecords.length)}>
          {pinnedRecords.map((record) => renderItem(record, { id: "pinned", items: pinnedRecords }, "_pinned"))}
        </Grid.Section>,
      );
    }
    if ((!category || category === "recent") && recent.length > 0) {
      sections.push(
        <Grid.Section key="recent" title="Frequently Used" subtitle={String(recent.length)}>
          {recent.map((record) => renderItem(record, { id: "recent", items: recent }, "_suggested"))}
        </Grid.Section>,
      );
    }
    for (const id of CATEGORY_ORDER) {
      if (category && category !== id) continue;
      const records = byCategory(id as CategoryId);
      const label = FILTER_OPTIONS.find((option) => option.value === id)?.label ?? id;
      sections.push(
        <Grid.Section key={id} title={label} subtitle={String(records.length)}>
          {records.map((record) => renderItem(record, { id, items: records }))}
        </Grid.Section>,
      );
    }
  }

  return (
    <Grid
      columns={preferences.columnCount}
      filter={FILTER_OPTIONS}
      searchBarPlaceholder="Search Emoji & Symbols…"
      labels="hidden"
      isLoading={!loaded}
    >
      <Grid.EmptyView
        title="No emoji found"
        description={query.length > 0 ? `Nothing matches "${props.query}"` : undefined}
      />
      {sections}
    </Grid>
  );
}

export default defineReactExtension({
  manifest,
  component: EmojiPickerView,
});
