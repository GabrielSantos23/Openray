// Root-search entry model: every row kind the launcher can render (applications, extension
// commands, the internal extension commands, quicklinks, the ephemeral calculator and
// quick-translate rows, files, inline sections) plus the internal-command catalog.

import type { ExtensionCommand } from "../useExtensionCommand";
import type { ApplicationCommand } from "../applications";
import { commandFavoriteKey } from "../favorites";
import type { QuicklinkEntry } from "../quicklinks";
import type { FallbackCommand, FileSearchResult } from "../matching";
import type { InlineSectionResult } from "../inlineSections";
import { CLIPBOARD_AREA } from "../clipboardHistory";

export interface ExtensionSummary {
  uuid: string;
  name: string;
  title: string;
  description?: string;
  commands: Array<{ name: string; title: string; description?: string; mode?: "view" | "no-view" | "menu-bar" }>;
}

export interface ExtensionEntry {
  kind: "extension";
  extension: ExtensionSummary;
  command: ExtensionSummary["commands"][number];
}

export interface ApplicationEntry {
  kind: "application";
  application: ApplicationCommand;
}

/**
 * Raycast's internal `clipboard-history` extension is not a Node extension, so it is not part of the
 * installed-extension list. It is modelled here exactly like the internal Applications area: a
 * synthetic entry that opens a native view.
 */
export interface ClipboardEntryResult {
  kind: "clipboard";
  commandId: string;
}

/**
 * Internal extensions expose one root-search row per command, exactly like installed extensions:
 * four Quicklinks commands (create/export/import/search) and four Snippets commands, each opening
 * its own view.
 */
export type InternalArea = "quicklinks" | "snippets" | "calculator" | "translator";
export type InternalCommandName = "search" | "create" | "import" | "export" | "history" | "translate";

export interface InternalCommandEntry {
  kind: "internal";
  area: InternalArea;
  command: InternalCommandName;
  commandId: string;
}

export interface QuicklinkRowEntry {
  kind: "quicklink";
  quicklink: QuicklinkEntry;
}

/** `createWithURL`: offered while the search term itself is a URL. */
export interface QuicklinkCreateEntry {
  kind: "quicklink-create";
  link: string;
}

export const INTERNAL_EXTENSION_META: Record<InternalArea, { title: string; icon: string; tile: string }> = {
  quicklinks: { title: "Quicklinks", icon: "link", tile: "command-tile--quicklinks" },
  snippets: { title: "Snippets", icon: "text", tile: "command-tile--snippets" },
  calculator: { title: "Calculator", icon: "calculator", tile: "command-tile--calculator" },
  translator: { title: "Translator", icon: "Globe", tile: "command-tile--translator" },
};

export const INTERNAL_COMMANDS: ReadonlyArray<{
  area: InternalArea;
  command: InternalCommandName;
  title: string;
  keywords: string[];
}> = [
  { area: "quicklinks", command: "create", title: "Create Quicklink", keywords: ["quicklinks", "new quicklink"] },
  { area: "quicklinks", command: "export", title: "Export Quicklinks", keywords: ["quicklinks"] },
  { area: "quicklinks", command: "import", title: "Import Quicklinks", keywords: ["quicklinks"] },
  { area: "quicklinks", command: "search", title: "Search Quicklinks", keywords: ["quicklinks"] },
  { area: "snippets", command: "create", title: "Create Snippet", keywords: ["snippets", "new snippet"] },
  { area: "snippets", command: "export", title: "Export Snippets", keywords: ["snippets"] },
  { area: "snippets", command: "import", title: "Import Snippets", keywords: ["snippets"] },
  { area: "snippets", command: "search", title: "Search Snippets", keywords: ["snippets"] },
  { area: "translator", command: "translate", title: "Translate", keywords: ["translator", "translate", "translation"] },
];

export function internalCommandEntry(area: InternalArea, command: InternalCommandName): InternalCommandEntry {
  return { kind: "internal", area, command, commandId: `${area}/${command}` };
}

/**
 * Fallback command entry - shown when no results match the search query.
 */
export interface FallbackCommandEntry {
  kind: "fallback";
  command: FallbackCommand;
}

/**
 * File search result entry.
 */
export interface FileEntry {
  kind: "file";
  file: FileSearchResult;
}

/**
 * Inline section result entry (quicklinks, snippets, web search).
 */
export interface InlineEntry {
  kind: "inline";
  result: InlineSectionResult;
}

/** The backend engine's evaluation (docs/calculator-spec.md — the split row payload). */
export interface CalculatorEvaluation {
  answer: string;
  unformatted: string;
  category: "math" | "unitConversion";
  evaluationType: string;
  metadataType: string;
  unitFrom: string | null;
  unitTo: string | null;
  currencyFrom: string | null;
  currencyTo: string | null;
  swappedExpression: string | null;
}

export interface CalculatorRatesMeta {
  fetchedAt: number;
  stale: boolean;
}

/** The ephemeral root-search row: `rootSearch:{section:'calculator', matching:'always'}`. */
export interface CalculatorEntry {
  kind: "calculator";
  expression: string;
  evaluation: CalculatorEvaluation;
  rates: CalculatorRatesMeta | null;
}

/** The quick-translate row states: `pending | failed | ready` (docs/translator-spec.md). */
export interface TranslateQuickRow {
  status: "pending" | "failed" | "ready";
  sourceText: string;
  target: string;
  targetLabel: string;
  sourceLabel: string | null;
  translatedText: string | null;
}

/** `rootSearch:{section:'translate', when:'searching', matching:'always'}` — ephemeral like the calculator row. */
export interface TranslateEntry {
  kind: "translate";
  row: TranslateQuickRow;
}

/** A saved custom translate command (`C.translateCustomCommands`). */
export interface TranslatorCustomCommand {
  id: string;
  name: string;
  source: string | null;
  target: string;
  sourceLabel: string | null;
  targetLabel: string;
  outputBehavior: "open" | "replace";
  enabled: boolean;
}

/** The dynamic per-command root row: primary action `Open Translator with Command`. */
export interface TranslatorCommandEntry {
  kind: "translator-command";
  command: TranslatorCustomCommand;
}

export type RootEntry = ExtensionEntry | ApplicationEntry | ClipboardEntryResult | InternalCommandEntry | QuicklinkRowEntry | QuicklinkCreateEntry | FallbackCommandEntry | FileEntry | InlineEntry | CalculatorEntry | TranslateEntry | TranslatorCommandEntry;

export interface SearchableEntry {
  title: string;
  subtitle: string | null;
  keywords: string[];
  rootEntry: RootEntry;
}

export const CLIPBOARD_COMMAND: ClipboardEntryResult = {
  kind: "clipboard",
  commandId: `${CLIPBOARD_AREA}/history`,
};

export const CLIPBOARD_FAVORITE_KEY = commandFavoriteKey(CLIPBOARD_AREA, "history");
