// Raycast's root-search section builder: ranks every searchable entry and files the results into
// the named sections (Favorites, Calculator, Translate, Applications, Commands, Quicklinks,
// Snippets, Files, Search Web, Fallback Commands) with the shipped ordering.

import type { ApplicationCommand } from "../applications";
import type { FocusSessionState } from "../focus";
import { applicationFavoriteKey, commandFavoriteKey } from "../favorites";
import { isDevExtensionsEnabled } from "../testHooks";
import { isLikelyUrl, type QuicklinkEntry } from "../quicklinks";
import { looksLikeFilePath } from "../fileSearch";
import { WM_COMMANDS } from "../windowManagement";
import { generateKeywords, rankEntriesWithFallbacks, type FallbackCommand, type FileSearchResult, type Sensitivity } from "../matching";
import type { InlineSectionResult } from "../inlineSections";
import {
  CLIPBOARD_COMMAND,
  CLIPBOARD_FAVORITE_KEY,
  INTERNAL_COMMANDS,
  INTERNAL_EXTENSION_META,
  internalCommandEntry,
  type CalculatorEntry,
  type ExtensionEntry,
  type ExtensionSummary,
  type FocusActionEntry,
  type FocusViewEntry,
  type OpenInExplorerEntry,
  type QuicklinkCreateEntry,
  type RootEntry,
  type SearchableEntry,
  type TranslateEntry,
  type TranslatorCustomCommand,
} from "./entries";

type RootSectionId = "favorites" | "applications" | "commands" | "fallback-commands" | "files" | "calculator" | "translate" | "translate-commands" | "quicklinks" | "snippets" | "web-search" | "window-management" | "focus" | "focus-commands" | "games";

interface RootSection {
  id: RootSectionId;
  title: string;
  icon: string;
  entries: RootEntry[];
}

/**
 * The Focus + Games command catalogs, with the shipped titles/descriptions/keywords. Ephemeral
 * commands (`pause`/`resume`/`complete`/`edit`) only exist while a session does; `resume` needs a
 * paused one — the shipped manifest marks them `ephemeral` and the session row carries the same
 * visibility rules.
 */
export const FOCUS_COMMANDS: ReadonlyArray<{
  command: string;
  title: string;
  description: string;
  keywords: string[];
  view: boolean;
  needsSession?: boolean;
  needsPaused?: boolean;
}> = [
  { command: "start", title: "Start Focus Session", description: "Start a new focus session", keywords: ["focus", "session"], view: true },
  { command: "toggle", title: "Toggle Focus Session", description: "Start with last settings or stop the current focus session", keywords: ["focus"], view: false },
  { command: "pause", title: "Pause Focus Session", description: "Pause the current focus session", keywords: ["focus"], view: false, needsSession: true },
  { command: "resume", title: "Resume Focus Session", description: "Resume the current focus session", keywords: ["focus"], view: false, needsSession: true, needsPaused: true },
  { command: "complete", title: "Complete Focus Session", description: "Complete the current focus session", keywords: ["focus"], view: false, needsSession: true },
  { command: "edit", title: "Edit Focus Session", description: "Edit the current focus session", keywords: ["focus"], view: true, needsSession: true },
  { command: "searchCategories", title: "Search Focus Categories", description: "Search through focus categories", keywords: ["focus", "categories"], view: true },
  { command: "createCategory", title: "Create Focus Category", description: "Create a new focus category", keywords: ["new focus category"], view: true },
  { command: "importCategories", title: "Import Focus Categories", description: "Import focus categories from a JSON file", keywords: ["import focus categories"], view: true },
];

export const GAMES_COMMANDS: ReadonlyArray<{ command: string; title: string; description: string; keywords: string[] }> = [
  { command: "searchGames", title: "Game Launcher", description: "Launch games from Steam, Epic, Xbox, Riot, and more.", keywords: ["game", "games"] },
];

export function buildSections(
  query: string,
  applications: ApplicationCommand[],
  extensions: ExtensionSummary[],
  favorites: string[],
  sensitivity: Sensitivity,
  usageScores: Map<string, number>,
  fallbackCommands: FallbackCommand[],
  fileResults: FileSearchResult[],
  inlineResults: InlineSectionResult[],
  quicklinkRows: QuicklinkEntry[],
  calculatorEntry: CalculatorEntry | null,
  translateEntry: TranslateEntry | null,
  customTranslateCommands: TranslatorCustomCommand[],
  fileIndexState: { state: string; fileCount: number; entriesPerSecond?: number | null } | null,
  showFilesInRoot: boolean,
  focusSession: FocusSessionState | null,
  gameApps: ApplicationCommand[]
): RootSection[] {  // Build searchable entries for all applications
  const appSearchables: SearchableEntry[] = applications.map((app) => ({
    title: app.title,
    subtitle: app.subtitle,
    keywords: app.keywords,
    rootEntry: { kind: "application" as const, application: app },
  }));

  // Build searchable entries for clipboard history
  const clipboardSearchable: SearchableEntry = {
    title: "Clipboard History",
    subtitle: "Search for text, images, links and colors you copied earlier and paste it again.",
    keywords: ["clipboard history clipboard"],
    rootEntry: CLIPBOARD_COMMAND,
  };

  // Internal extension commands: one root row per command, rendered like installed commands.
  const internalCommandSearchables: SearchableEntry[] = INTERNAL_COMMANDS.map((definition) => ({
    title: definition.title,
    subtitle: INTERNAL_EXTENSION_META[definition.area].title,
    keywords: definition.keywords,
    rootEntry: internalCommandEntry(definition.area, definition.command),
  }));

  // Window Management commands: every row applies to the previously focused window; the two
  // argument commands open the args view instead of running directly.
  const windowManagementSearchables: SearchableEntry[] = WM_COMMANDS.map((definition) => ({
    title: definition.title,
    subtitle: definition.description,
    keywords: definition.keywords,
    rootEntry: (definition.args
      ? { kind: "wm-args", commandKey: definition.key, title: definition.title }
      : { kind: "wm-command", commandKey: definition.key, title: definition.title }) as RootEntry,
  }));

  // Focus + Games internal extensions: view commands open their view, ephemeral session commands
  // run directly. Ephemeral rows only exist while a session does.
  const sessionVisible = (needsSession?: boolean, needsPaused?: boolean) =>
    !needsSession || (focusSession !== null && (!needsPaused || focusSession.status === "paused"));
  const focusSearchables: SearchableEntry[] = FOCUS_COMMANDS.filter((definition) =>
    sessionVisible(definition.needsSession, definition.needsPaused),
  ).map((definition) => ({
    title: definition.title,
    subtitle: definition.description,
    keywords: definition.keywords,
    rootEntry: (definition.view
      ? { kind: "focus-view", command: definition.command as FocusViewEntry["command"], title: definition.title }
      : { kind: "focus-action", action: definition.command as FocusActionEntry["action"], title: definition.title }) as RootEntry,
  }));
  const gamesSearchables: SearchableEntry[] = GAMES_COMMANDS.map((definition) => ({
    title: definition.title,
    subtitle: definition.description,
    keywords: definition.keywords,
    rootEntry: { kind: "games-view", command: "searchGames", title: definition.title },
  }));

  // Dynamic `game` command rows (root-search section `apps`): flagged applications, shown while
  // searching exactly like dynamic quicklink rows.
  const gameSearchables: SearchableEntry[] = gameApps.map((app) => ({
    title: app.title,
    subtitle: app.subtitle,
    keywords: ["game", "games", ...app.keywords],
    rootEntry: { kind: "game" as const, app: app.payload },
  }));

  // Dynamic quicklink rows: title = name, keywords include the `quicklink` tag (Raycast's
  // `dynamicCommands.quicklink`).
  const quicklinkSearchables: SearchableEntry[] = quicklinkRows.map((entry) => ({
    title: entry.name,
    subtitle: entry.link,
    keywords: ["quicklink", ...entry.tags.map((tag) => tag.toLowerCase())],
    rootEntry: { kind: "quicklink" as const, quicklink: entry },
  }));

  // Dynamic custom translate commands (`customTranslate`): title = command name. Like the other
  // dynamic commands they are searchable rows, shown while searching.
  const customTranslateSearchables: SearchableEntry[] = customTranslateCommands.map((command) => ({
    title: command.name,
    subtitle: command.sourceLabel
      ? `Translate ${command.sourceLabel} to ${command.targetLabel}`
      : `Translate to ${command.targetLabel}`,
    keywords: ["translator", "translate", "translation"],
    rootEntry: { kind: "translator-command" as const, command },
  }));

  // Build searchable entries for extension commands
  const commandSearchables: SearchableEntry[] = [];
  for (const extension of extensions) {
    for (const command of extension.commands ?? []) {
      if (command.mode === "no-view") continue;
      // Dev-only test extensions stay hidden unless the flag is on: localStorage
      // `raycast-mini:dev-extensions=1`, or the host's `--dev-extensions` / env equivalent.
      if (extension.name === "command-ux-test" && !isDevExtensionsEnabled()) continue;
      const entry: ExtensionEntry = { kind: "extension", extension, command };
      commandSearchables.push({
        title: command.title,
        subtitle: command.description ?? extension.title,
        keywords: generateKeywords(`${extension.title} ${command.title}`, command.description ?? ""),
        rootEntry: entry,
      });
    }
  }

  // Combine all searchable entries
  const allSearchables = [...appSearchables, clipboardSearchable, ...internalCommandSearchables, ...windowManagementSearchables, ...focusSearchables, ...gamesSearchables, ...gameSearchables, ...commandSearchables, ...quicklinkSearchables, ...customTranslateSearchables];

  // Rank all entries using the full Raycast algorithm with fallback support
  const { results: ranked, showFallbacks } = rankEntriesWithFallbacks(
    allSearchables,
    query,
    sensitivity,
    usageScores,
    fallbackCommands
  );

  // Separate favorites from regular results
  const favoriteRows = new Set<RootEntry>();
  for (const key of favorites) {
    const entry = ranked.find((r) => {
      const re = r.entry.rootEntry;
      if (re.kind === "application") {
        return applicationFavoriteKey(re.application.payload.id) === key;
      } else if (re.kind === "clipboard") {
        return CLIPBOARD_FAVORITE_KEY === key;
      } else if (re.kind === "extension") {
        return commandFavoriteKey(re.extension.uuid, re.command.name) === key;
      }
      return false;
    });
    if (entry) favoriteRows.add(entry.entry.rootEntry);
  }

  const favoriteEntries = favorites
    .map((key) => {
      const rankedEntry = ranked.find((r) => {
        const re = r.entry.rootEntry;
        if (re.kind === "application") {
          return applicationFavoriteKey(re.application.payload.id) === key;
        } else if (re.kind === "clipboard") {
          return CLIPBOARD_FAVORITE_KEY === key;
        } else if (re.kind === "extension") {
          return commandFavoriteKey(re.extension.uuid, re.command.name) === key;
        }
        return false;
      });
      return rankedEntry?.entry.rootEntry;
    })
    .filter((e): e is RootEntry => e !== undefined);

  // Filter out favorites from regular results
  const regularResults = ranked.filter((r) => !favoriteRows.has(r.entry.rootEntry));

  const searching = query.trim().length > 0;

  // Separate by type
  const apps = regularResults
    .filter((r) => r.entry.rootEntry.kind === "application")
    .map((r) => r.entry.rootEntry);
  const gameRows = searching
    ? regularResults.filter((r) => r.entry.rootEntry.kind === "game").map((r) => r.entry.rootEntry)
    : [];
  const clipboardEntries = favorites.includes(CLIPBOARD_FAVORITE_KEY)
    ? []
    : regularResults.filter((r) => r.entry.rootEntry.kind === "clipboard").map((r) => r.entry.rootEntry);
  const internalCommandEntries = regularResults
    .filter((r) => r.entry.rootEntry.kind === "internal")
    .map((r) => r.entry.rootEntry);
  const commands = regularResults
    .filter((r) => r.entry.rootEntry.kind === "extension")
    .map((r) => r.entry.rootEntry);
  const windowManagementEntries = regularResults
    .filter((r) => r.entry.rootEntry.kind === "wm-command" || r.entry.rootEntry.kind === "wm-args")
    .map((r) => r.entry.rootEntry);
  const focusCommandEntries = regularResults
    .filter((r) => r.entry.rootEntry.kind === "focus-view" || r.entry.rootEntry.kind === "focus-action")
    .map((r) => r.entry.rootEntry);
  const gamesCommandEntries = regularResults
    .filter((r) => r.entry.rootEntry.kind === "games-view")
    .map((r) => r.entry.rootEntry);

  // Handle fallback commands - they appear as a separate section when shown. Raycast Notes'
  // `Create Note` ships `fallbackStatus: "available"`, so it leads the fallback suggestions.
  const fallbackEntries: RootEntry[] = showFallbacks
    ? [
        {
          kind: "internal" as const,
          area: "notes",
          command: "create" as const,
          commandId: "notes/create",
        },
        ...fallbackCommands.map((cmd) => ({ kind: "fallback" as const, command: cmd })),
      ]
    : [];

  // File search results — plus the pinned `File Search is indexing…` row (confirmed
  // `rootSearch:{section:'files', pinned:1}`) and the `Open in File Explorer` ephemeral fallback
  // for path-like queries (docs/file-search-spec.md, decisions).
  const indexing = fileIndexState?.state === "indexing";
  const fileEntries: RootEntry[] = [
    ...(indexing
      ? [{ kind: "file-indexing" as const, fileCount: fileIndexState?.fileCount ?? 0, entriesPerSecond: fileIndexState?.entriesPerSecond ?? null }]
      : []),
    ...fileResults.map((file) => ({ kind: "file" as const, file })),
  ];
  const explorerEntry: OpenInExplorerEntry | null = looksLikeFilePath(query)
    ? { kind: "open-in-explorer" as const, path: query.trim() }
    : null;
  if (explorerEntry) fileEntries.push(explorerEntry);

  // Inline section results - group by type
  const quicklinkCreateEntries: QuicklinkCreateEntry[] = isLikelyUrl(query)
    ? [{ kind: "quicklink-create", link: query.trim() }]
    : [];
  const snippetEntries = inlineResults
    .filter((r) => r.type === "snippet")
    .map((result) => ({ kind: "inline" as const, result }));
  const webSearchEntries = inlineResults
    .filter((r) => r.type === "web-search")
    .map((result) => ({ kind: "inline" as const, result }));

  const sections: RootSection[] = [
    { id: "favorites", title: "Favorites", icon: "star", entries: favoriteEntries },
  ];

  // Calculator section (highest priority) - the ephemeral row appears whenever the search term
  // evaluates; it is not a searchable command (rootSearch matching:'always').
  const calculatorEntries: RootEntry[] = calculatorEntry ? [calculatorEntry] : [];
  if (calculatorEntries.length > 0) {
    sections.push({ id: "calculator", title: "Calculator", icon: "calculator", entries: calculatorEntries });
  }

  // Translate section: the ephemeral quick-translate row (`rootSearch:{section:'translate',
  // when:'searching', matching:'always'}`), matched against the backend parser.
  const translateEntries: RootEntry[] = translateEntry ? [translateEntry] : [];
  if (translateEntries.length > 0) {
    sections.push({ id: "translate", title: "Translate", icon: "Globe", entries: translateEntries });
  }

  // Applications section: dynamic `game` command rows are filed under `apps` too (confirmed).
  if (apps.length > 0 || gameRows.length > 0) {
    sections.push({ id: "applications", title: "Applications", icon: "app-window-list", entries: [...apps, ...gameRows] });
  }

  // Commands section
  if (clipboardEntries.length > 0 || internalCommandEntries.length > 0 || commands.length > 0) {
    sections.push({ id: "commands", title: "Commands", icon: "Blocks", entries: [...clipboardEntries, ...internalCommandEntries, ...commands] });
  }

  // Window Management section: Raycast files the extension's commands under their product area.
  if (windowManagementEntries.length > 0) {
    sections.push({ id: "window-management", title: "Window Management", icon: "app-window", entries: windowManagementEntries });
  }

  // Focus section: the dynamic `session` row (rootSearch:{section:'focus',when:'empty'}) shows
  // with an empty query while a session runs; the Focus view/ephemeral commands file under
  // Commands. The Game Launcher command gets the same treatment under its own area.
  if (!searching && focusSession) {
    sections.push({
      id: "focus",
      title: "Focus",
      icon: "bulls-eye",
      entries: [
        {
          kind: "focus-session",
          title: focusSession.title.trim() !== "" ? focusSession.title : "Focus Session",
          status: focusSession.status,
          mode: focusSession.mode,
          remainingMs: focusSession.remainingMs,
          targetEndAt: focusSession.targetEndAt,
          pauseEndsAt: focusSession.pauseEndsAt,
        },
      ],
    });
  }
  if (focusCommandEntries.length > 0) {
    sections.push({ id: "focus-commands", title: "Focus", icon: "bulls-eye", entries: focusCommandEntries });
  }
  if (gamesCommandEntries.length > 0) {
    sections.push({ id: "games", title: "Games", icon: "game-controller", entries: gamesCommandEntries });
  }

  // Quicklinks section: the createWithURL entry, then dynamic quicklink rows. Dynamic rows only
  // show while searching — Raycast's dynamic quicklink commands are searchable, not always visible.
  const quicklinkRowsShown = searching
    ? regularResults.filter((r) => r.entry.rootEntry.kind === "quicklink").map((r) => r.entry.rootEntry)
    : [];
  const customTranslateRowsShown = searching
    ? regularResults.filter((r) => r.entry.rootEntry.kind === "translator-command").map((r) => r.entry.rootEntry)
    : [];
  if (quicklinkCreateEntries.length > 0 || quicklinkRowsShown.length > 0) {
    sections.push({ id: "quicklinks", title: "Quicklinks", icon: "link", entries: [...quicklinkCreateEntries, ...quicklinkRowsShown] });
  }

  // Custom translate commands: dynamic command rows under their own section, shown while searching.
  if (customTranslateRowsShown.length > 0) {
    sections.push({ id: "translate-commands", title: "Translate", icon: "Globe", entries: customTranslateRowsShown });
  }

  // Snippets section
  if (snippetEntries.length > 0) {
    sections.push({ id: "snippets", title: "Snippets", icon: "copy", entries: snippetEntries });
  }

  // Files section (after commands, before fallback); the indexing row keeps it visible alone.
  if (showFilesInRoot && fileEntries.length > 0) {
    sections.push({ id: "files", title: "Files", icon: "file-text", entries: fileEntries });
  }

  // Web search suggestions (lowest priority)
  if (webSearchEntries.length > 0) {
    sections.push({ id: "web-search", title: "Search Web", icon: "globe", entries: webSearchEntries });
  }

  if (showFallbacks && fallbackEntries.length > 0) {
    sections.push({ id: "fallback-commands", title: "Fallback Commands", icon: "Blocks", entries: fallbackEntries });
  }

  return sections;
}
