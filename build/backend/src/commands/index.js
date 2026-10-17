// Wires the existing per-domain handler tables into the command registry (AGENTS.md
// "everything is a command"): one command per handler method, id = the existing IPC method
// name, so the pipe, the control channel, the CLI and MCP all share one dispatch path with
// no parallel handlers. Behavior-preserving: a command's `run` is the handler itself.

"use strict";

const DESTRUCTIVE = /^(delete|deleteAll|clear|clearAll|emptyTrash|permanentlyDelete|purge|reset|resetAll|trash|moveToTrash|replaceAll)/;
const READ = /^(get|list|search|resolve|find|describe|read|export|is[A-Z]|state|status|browse|count)/;

function defaultRisk(method) {
  if (DESTRUCTIVE.test(method)) return "destructive";
  if (READ.test(method)) return "read";
  return "write";
}

// Descriptions for the commands an agent is most likely to call; everything else gets the
// generated default. Risk overrides where the heuristic reads the intent wrong.
const CATALOG = {
  "settings.getAll": "Read every launcher setting as a key/value map.",
  "settings.get": "Read one setting by key; returns null when unset.",
  "settings.list": "List every setting with its key, value and JSON type.",
  "settings.set": "Merge a patch of settings; every Settings-page control is reachable this way. Change events push to both windows.",
  "settings.replaceAll": "Replace the whole settings map (Settings import). Wipes every key not in the patch.",
  "calculator.calculate": "Evaluate a math expression (unit conversion, currencies, hex/bin/oct bases).",
  "calculator.getColor": "Parse a color in any common format and return all Raycast color formats plus the closest CSS name.",
  "calculator.getPreferences": "Read calculator preferences (syntax highlighting, color detection, rem rate).",
  "calculator.setPreference": "Set one calculator preference.",
  "calculator.historyGetAll": "Read the calculator history entries with pinned-first ordering.",
  "calculator.historyUpsert": "Add or update a calculator history entry.",
  "calculator.historyDelete": "Delete one calculator history entry by id.",
  "calculator.historyDeleteAll": "Delete every calculator history entry.",
  "snippets.list": "List snippets with pins first, then most recently used.",
  "snippets.create": "Create a snippet (keyword expansion text with optional placeholders).",
  "snippets.update": "Update one snippet by id.",
  "snippets.delete": "Delete one snippet by id.",
  "snippets.deleteAll": "Delete every snippet.",
  "snippets.resolve": "Resolve placeholders in text the way the expansion hook would.",
  "quicklinks.list": "List quicklinks with pins first.",
  "quicklinks.save": "Create a quicklink (name, link with {argument} placeholders, tags).",
  "quicklinks.update": "Update one quicklink by id.",
  "quicklinks.delete": "Delete one quicklink by id.",
  "quicklinks.deleteAll": "Delete every quicklink.",
  "quicklinks.open": "Resolve and open a quicklink; {argument} placeholders are filled from params.",
  "notes.list": "List notes (title, preview, pinned, folders).",
  "notes.create": "Create a note; returns the stored record.",
  "notes.update": "Update a note's title or text.",
  "notes.delete": "Move one note to the trash (recoverable with notes.recoverNote).",
  "notes.deleteAll": "Move every note to the trash.",
  "notes.permanentlyDelete": "Permanently delete a trashed note. Not recoverable.",
  "notes.emptyTrash": "Permanently delete everything in the trash. Not recoverable.",
  "notes.markdownToHtml": "Convert markdown to HTML (the Copy As action).",
  "translator.translate": "Translate text through the configured provider.",
  "translator.quickTranslate": "Parse a `text = target` quick-translate input and translate it.",
  "clipboard.getAll": "Read clipboard history entries (paged, filterable by category/tag).",
  "clipboard.paste": "Paste a clipboard entry (by id) or explicit items back to the system clipboard.",
  "clipboard.copy": "Copy one clipboard history entry to the system clipboard.",
  "clipboard.delete": "Delete one clipboard history entry.",
  "clipboard.deleteAll": "Delete the whole clipboard history.",
  "clipboard.read": "Read the current system clipboard text.",
  "clipboard.write": "Write text to the system clipboard.",
  "clipboard.clear": "Clear the system clipboard.",
  "applications.getAll": "List installed applications (name, path, bundle id, disambiguator).",
  "applications.open": "Launch an application by id/path.",
  "applications.isForeground": "Check whether the given application is the foreground window.",
  "applications.quit": "Ask an application to quit gracefully.",
  "applications.forceQuit": "Force-kill an application's processes.",
  "applications.uninstall": "Uninstall an application (opens the system uninstaller).",
  "fileSearch.search": "Search the file index; results ranked by name match.",
  "fileSearch.getState": "Read the indexer status (indexed file count, scanning state).",
  "focus.getSession": "Read the current focus session state machine snapshot.",
  "focus.startSession": "Start a focus session (duration, category, blocking).",
  "focus.cancelSession": "Cancel the running focus session.",
  "focus.searchCategories": "List focus categories (built-in and custom).",
  "games.list": "List installed games (host classification plus manual flags).",
  "games.setGameMode": "Toggle Game Mode (fullscreen watch + blocking).",
  "taskbar.getSettings": "Read the Windows taskbar strip settings.",
  "taskbar.setSetting": "Set one taskbar setting (position, visibility).",
  "windowManagement.getDisplays": "List displays with work areas and DPI.",
  "windowManagement.getActiveWindow": "Read the foreground window (id, title, process, bounds).",
  "windowManagement.setWindowBounds": "Move/resize a window by id (host-native geometry).",
  "windowManagement.enumerateVisibleWindows": "List all visible top-level windows.",
  "windowManagement.cycleAppWindows": "Cycle windows of the frontmost application.",
  "windowManagement.getSavedWindowState": "Read a saved window state by windowId.",
  "windowManagement.saveWindowState": "Save the given bounds under a windowId.",
  "usage.getAppUsage": "Read per-application launch counts.",
  "usage.resetAllAppUsage": "Reset all application usage counters.",
  "advanced.getExportPreferences": "Read backup/export preferences (schedule, location, passphrase set).",
  "advanced.exportNow": "Run a settings/data export now.",
  "ui.openSettings": "Open the Settings window.",
  "ui.showMainWindow": "Show the launcher window.",
  "ui.hideMainWindow": "Hide the launcher window.",
  "extensions.list": "List installed extensions with their commands.",
  "extensions.reload": "Rescan the extensions root and refresh the registry's ext.* commands.",
  "extensions.run": "Run an extension command; view commands need the launcher window.",
  "registry.list": "List registry commands, optionally filtered by a text query.",
  "registry.describe": "Describe one command: params schema, risk, description.",
};

function describeFor(id, title) {
  return CATALOG[id] ?? `Runs the ${title} action.`;
}

function createWiring({ registry, backend }) {
  // Methods that are internal lifecycle, not user-visible actions.
  const SKIP = new Set(["close", "closeWatchers"]);

  function registerTable(domain, handlers, { risk = {}, skip = [] } = {}) {
    const specs = [];
    for (const [method, handler] of Object.entries(handlers ?? {})) {
      if (SKIP.has(method) || skip.includes(method)) continue;
      if (typeof handler !== "function") continue;
      const id = `${domain}.${method}`;
      specs.push({
        id,
        title: `${domain} ${method}`,
        description: describeFor(id, `${domain} ${method}`),
        risk: risk[method] ?? defaultRisk(method),
        domain,
        params: { type: "object" },
        run: (params) => handler(params ?? {}),
      });
    }
    registry.register(specs);
  }

  // Native verbs live in the WPF host; the command forwards over the existing pipe. Without a
  // host the dispatch fails with the transport error, which surfaces as a typed envelope.
  function registerNative(method, { risk, description, params } = {}) {
    registry.register([
      {
        id: method,
        title: method,
        description: description ?? describeFor(method, method),
        risk: risk ?? defaultRisk(method.split(".")[1] ?? method),
        domain: method.split(".")[0],
        params: params ?? { type: "object" },
        run: (params2) => backend.dispatch("backend", "native", { method, data: params2 ?? {} }),
      },
    ]);
  }

  // Frontend-module verbs are answered by the WPF window itself (MainWindow.DispatchIpcAsync).
  function registerUi(id, hostMethod, description, params) {
    registry.register([
      {
        id,
        title: id,
        description,
        risk: "write",
        domain: "ui",
        params: params ?? { type: "object" },
        run: (params2) => backend.dispatch("frontend", hostMethod, params2 ?? {}),
      },
    ]);
  }

  return { registerTable, registerNative, registerUi };
}

module.exports = { createWiring, defaultRisk, CATALOG };
