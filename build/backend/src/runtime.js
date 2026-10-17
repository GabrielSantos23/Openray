"use strict";

// Openray — Node extension host (shared runtime).
//
// This is the Node half of Raycast's architecture: `Raycast.exe` spawns `backend/node.exe
// backend/index.mjs`, which keeps a pool of `worker_threads` workers (one per running extension
// command) and bridges extension <-> host <-> renderer traffic over a named pipe.
//
// The three legs, mirroring Raycast 2.4.0.0:
//
//   1. extension worker  -> backend     `parentPort.postMessage({kind:"request"|"notify", …})`
//   2. backend           -> renderer    `z.frontend.extensionHost.render({…})`
//   3. renderer          -> backend     `dispatchRequest("backend","extensionHost.loadCommand",…)`
//
// (2) and (3) both travel over the named pipe that the .NET launcher owns. Protocol messages are
// newline-delimited JSON:
//
//   -> { type:"request",  id, module:"frontend"|"backend", method, data }
//   <- { type:"response", id, ok, data | error }
//   <- { type:"push",     module:"frontend", method, data }       (host -> renderer)
//
// `module: "frontend"` means "deliver to the WebView2 renderer" (Raycast's `z.frontend.*`);
// `module: "backend"` means "ask the Node host / native host to do something"
// (Raycast's `dispatchRequest("backend", …)`).

"use strict";

const path = require("node:path");
const { createBackend } = require("./backend");
const { createClipboardHistory } = require("./clipboard-history");
const { createQuicklinks } = require("./quicklinks");
const { createSnippets } = require("./snippets");
const { createCalculator } = require("./calculator");
const { createTranslator } = require("./translator");
const { createFileIndexer } = require("./file-indexer");
const { createUsageTracker } = require("./usage-tracker");
const { migrateRemovedStoreArtifacts } = require("./store-migration");
const { createWindowStates } = require("./window-states");
const { createFocus } = require("./focus");
const { createGames } = require("./games");
const { createAdvanced } = require("./advanced");
const { createTaskbar } = require("./taskbar");
const { createSettingsStore } = require("./settings-store");
const { createNotes } = require("./notes");
const { createExtensionStore } = require("./store");


// The runtime is shared by the live app (index.js) and the headless MCP/CLI mode: one wiring
// of backend + stores + registry, with the pipe connection optional. Headless mode fails every
// native/UI hop with the typed needs_ui error instead of hanging on a pipe that never opens.
const { createRegistry, needsUi } = require("./registry");

function quietly(start, label) {
  try {
    Promise.resolve(start()).catch((error) =>
      console.warn(`[runtime] ${label} failed:`, error?.message ?? error),
    );
  } catch (error) {
    console.warn(`[runtime] ${label} failed:`, error?.message ?? error);
  }
}

function createRuntime(options = {}) {
  const { connectPipe = true } = options;
  // Store-side pushes are fire-and-forget by design (a renderer push or a native hop may fail
  // while the window is hidden or in headless mode); a failed push logs, never crashes.
  process.on("uncaughtException", (error) => console.error("[backend] uncaught", error));
  process.on("unhandledRejection", (error) => console.error("[backend] unhandled rejection", error));
const config = {
  // Must match host/NamedPipeBridge.cs
  pipeName: process.env.OPENRAY_PIPE ?? "openray-ipc",
  frontendRoot: process.env.OPENRAY_FRONTEND_ROOT ?? path.join(__dirname, "..", "..", "frontend"),
  extensionsRoot:
    process.env.OPENRAY_EXTENSIONS_ROOT ??
    path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray", "extensions"),
};

const backend = createBackend({
  pipeName: config.pipeName,
  frontendRoot: config.frontendRoot,
  extensionsRoot: config.extensionsRoot,
  dataRoot: process.env.OPENRAY_DATA_DIR ?? path.dirname(config.extensionsRoot),
});

// `connect()` owns the single pipe reader and answers host requests too, so nothing else has to
// attach a second `readline` to the socket.
if (options.connectPipe) {
  backend.connect();
} else {
  // Headless runtime (MCP/CLI): nothing dials the host. Renderer pushes are fire-and-forget
  // by contract (the host never answers them), so they resolve null; native hops fail typed.
  backend.setTransport(async (module, method) => {
    if (module === "frontend") return null;
    throw needsUi(
      `${module}.${method} needs the running app`,
      "start Openray (optionally with --control) or use bridged mode",
    );
  });
}

// Raycast's internal `clipboard-history` extension is not a Node extension: the .NET host captures
// clipboard changes, and this store persists them (`handler::clipboard-history`). Registering it here
// keeps the capture path identical to Raycast's: host -> backend, never through a worker.
const clipboard = createClipboardHistory({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
});
backend.registerClipboardHandler(clipboard.handlers);

// Quicklinks is likewise an internal extension persisted in this process (`quicklinks.*`). Links
// resolve through the shared placeholder engine before the host opens them. `{calculator …}`
// placeholders evaluate against the calculator store's in-memory rate table.
const calculator = createCalculator({
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerCalculatorHandler(calculator.handlers);
calculator.warmRates();
calculator.purgeOldEntries();

// Translator is the fourth internal extension (`translator.*`). It is also the second
// network-allowed feature (docs/translator-spec.md): the provider call goes through one
// swappable function and results are cached in memory only.
const translator = createTranslator({
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerTranslatorHandler(translator.handlers);

const quicklinks = createQuicklinks({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
  calculate: (expression) => calculator.calculateExpression(expression),
});
backend.registerQuicklinksHandler(quicklinks.handlers);
quietly(() => quicklinks.pushPreferencesToHost(), "quicklinks.pushPreferencesToHost");

// Snippets is the third internal extension persisted in this process (`snippets.*`). The native
// hook asks this store to resolve placeholders (`snippets.resolve`) because the backend is alive
// while the launcher window is hidden.
const snippets = createSnippets({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
  calculate: (expression) => calculator.calculateExpression(expression),
  clipboardTextAt: (offset) => {
    const entry = clipboard.store.last(offset ?? 0);
    if (!entry) return null;
    for (const item of entry.items ?? []) {
      for (const representation of item.representations ?? []) {
        const base = String(representation.mimeType ?? "").split(";")[0].trim().toLowerCase();
        if (base === "text/plain" && typeof representation.content === "string") {
          return representation.content;
        }
      }
    }
    return null;
  },
});
backend.registerSnippetsHandler(snippets.handlers);
// Initial keyword registration and expansion config: the hook buffers both, so an early push
// survives the host installing the hook moments later.
quietly(() => snippets.registerKeywordsWithHost(), "snippets.registerKeywordsWithHost");
quietly(() => snippets.pushExpansionConfigToHost(), "snippets.pushExpansionConfigToHost");

// File indexer — indexes the user's scopes in the background and answers fileSearch.* searches.
const fileIndexer = createFileIndexer({
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
  dataRoot: process.env.OPENRAY_DATA_DIR ?? path.dirname(config.extensionsRoot),
});
backend.registerFileIndexerHandler(fileIndexer.handlers);

  // Usage tracker
  const usageTracker = createUsageTracker({});
  backend.registerUsageTrackerHandler(usageTracker.handlers);

// Window Management saved bounds — the store behind the `Restore` command.
const windowStates = createWindowStates();
backend.registerWindowStateHandler(windowStates.handlers);

// Focus is the sixth internal extension (`focus.*`). The session state machine lives here and
// re-syncs the host on every mutation; the host owns the blocking loop and the timer panel.
// Bootstrap restores the persisted session and upserts the built-in categories.
const focus = createFocus({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerFocusHandler(focus.handlers);
quietly(() => focus.bootstrap(), "focus.bootstrap");

// Games is the seventh (`games.*`): the isGame flag store over the host application list plus the
// Game Mode toggle forwarded to the host's fullscreen watch.
const games = createGames({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
});
backend.registerGamesHandler(games.handlers);
quietly(() => games.pushSettingsToHost(), "games.pushSettingsToHost");

// Windows Taskbar is the eighth (`taskbar.*`): strip settings persisted here, the AppBar window
// lives in the host.
const taskbar = createTaskbar({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
});
backend.registerTaskbarHandler(taskbar.handlers);
quietly(() => taskbar.pushSettingsToHost(), "taskbar.pushSettingsToHost");

// General settings (`settings.*`): the shared store both windows read; every change is pushed
// back out so the launcher and the Settings window update live.
const settingsStore = createSettingsStore({
  toRenderer: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerSettingsStoreHandler(settingsStore.handlers);

// Advanced (`advanced.*`): the Export section (manual + scheduled backups with an optional
// AES-GCM passphrase) and the Connection preferences applied to this process at boot.
const advanced = createAdvanced({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  dataRoot: process.env.OPENRAY_DATA_DIR ?? path.dirname(config.extensionsRoot),
  settings: {
    getAll: () => settingsStore.getValues(),
    set: (patch) => settingsStore.handlers.set({ values: patch }),
  },
});
backend.registerAdvancedHandler(advanced.handlers);
quietly(() => advanced.bootstrap(), "advanced.bootstrap");

// Notes is the ninth (`notes.*`): the SQLite store, the trash with its 60-day purge and the
// markdown conversions behind Copy As / Export live here; the window page and the launcher's
// Search Notes view are both readers. Note text and titles never reach the logs.
const notes = createNotes({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerNotesHandler(notes.handlers);
quietly(() => notes.bootstrap(), "notes.bootstrap");

// The extension Store (`store.*`): the GitHub catalog (raycast/extensions) plus locally published
// FlowKey extensions, living under `<dataRoot>/store/`. `store.sync` downloads the catalog in the
// background; installs of uploaded extensions land in the live extensions root.
const extensionStore = createExtensionStore({
  dataRoot: process.env.OPENRAY_DATA_DIR ?? path.dirname(config.extensionsRoot),
  extensionsRoot: config.extensionsRoot,
});
backend.registerStoreHandler(extensionStore.handlers);

// ---------------------------------------------------------------------------------------------
// Command registry (docs/mcp-architecture.md): every handler method above becomes a command
// with the same id, so the pipe, the control channel, the CLI and MCP share one dispatch path.
// ---------------------------------------------------------------------------------------------
const { createWiring, CATALOG } = require("./commands");
const { createExtensionCommands } = require("./commands/extensions");

const registry = createRegistry();
backend.registerRegistry(registry);
const wiring = createWiring({ registry, backend });

wiring.registerTable("settings", settingsStore.handlers, { risk: { replaceAll: "destructive" } });
wiring.registerTable("clipboard", clipboard.handlers);
wiring.registerTable("calculator", calculator.handlers, {
  risk: { calculate: "read", getColor: "read" },
});
wiring.registerTable("translator", translator.handlers);
wiring.registerTable("quicklinks", quicklinks.handlers, { risk: { resolve: "read" } });
wiring.registerTable("snippets", snippets.handlers, {
  risk: { resolve: "read", isKeywordAvailable: "read" },
});
wiring.registerTable("fileSearch", fileIndexer.handlers);
wiring.registerTable("usage", usageTracker.handlers);
wiring.registerTable("windowManagement", windowStates.handlers);
wiring.registerTable("focus", focus.handlers);
wiring.registerTable("games", games.handlers);
wiring.registerTable("taskbar", taskbar.handlers);
wiring.registerTable("advanced", advanced.handlers, { risk: { importFromFile: "destructive" } });
wiring.registerTable("notes", notes.handlers);
wiring.registerTable("store", extensionStore.handlers);

for (const [method, risk] of [
  ["clipboard.read", "read"],
  ["clipboard.write", "write"],
  ["clipboard.clear", "destructive"],
  ["shell.getSelectedText", "read"],
  ["shell.getFrontmostApplication", "read"],
  ["shell.openUrl", "write"],
  ["shell.openWith", "write"],
  ["shell.revealFile", "write"],
  ["shell.setOpenUrlPreferences", "write"],
  ["applications.getAll", "read"],
  ["applications.isForeground", "read"],
  ["applications.getDefaultBrowser", "read"],
  ["applications.open", "write"],
  ["applications.newWindow", "write"],
  ["applications.hide", "write"],
  ["applications.reveal", "write"],
  ["applications.showProperties", "write"],
  ["applications.openRecentFiles", "write"],
  ["applications.setActivationBehavior", "write"],
  ["applications.runAsAdministrator", "write"],
  ["applications.runAsUser", "write"],
  ["applications.quit", "destructive"],
  ["applications.restart", "destructive"],
  ["applications.forceQuit", "destructive"],
  ["applications.uninstall", "destructive"],
  ["fileSystem.openFile", "write"],
  ["fileSystem.readFile", "read"],
  ["fileSystem.writeFile", "destructive"],
  ["fileSystem.moveToTrash", "destructive"],
  ["fileSystem.showOpenFileDialog", "write"],
  ["fileSystem.showSaveFileDialog", "write"],
  ["fileSystem.showSelectFolderDialog", "write"],
  ["windowManagement.getDisplays", "read"],
  ["windowManagement.getActiveWindow", "read"],
  ["windowManagement.enumerateVisibleWindows", "read"],
  ["windowManagement.setWindowBounds", "write"],
  ["windowManagement.minimizeWindow", "write"],
  ["windowManagement.toggleAlwaysOnTop", "write"],
  ["windowManagement.cycleAppWindows", "write"],
  ["windowManagement.registerCommandHotkey", "write"],
  ["windowManagement.hotkey", "write"],
]) {
  wiring.registerNative(method, { risk, description: CATALOG[method] });
}

wiring.registerUi(
  "ui.openSettings",
  "window.openSettings",
  CATALOG["ui.openSettings"],
);
wiring.registerUi("ui.showMainWindow", "window.showMainWindow", CATALOG["ui.showMainWindow"]);
wiring.registerUi("ui.hideMainWindow", "window.close", CATALOG["ui.hideMainWindow"]);

registry.register([
  {
    id: "settings.get",
    title: "settings get",
    description: CATALOG["settings.get"],
    risk: "read",
    domain: "settings",
    params: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
    run: (params) => {
      const values = settingsStore.getValues();
      return { key: params.key, value: values[params.key] ?? null };
    },
  },
  {
    id: "settings.list",
    title: "settings list",
    description: CATALOG["settings.list"],
    risk: "read",
    domain: "settings",
    params: { type: "object" },
    run: () => ({
      settings: Object.entries(settingsStore.getValues()).map(([key, value]) => ({
        key,
        value,
        type: Array.isArray(value) ? "array" : typeof value,
      })),
    }),
  },
  {
    id: "registry.list",
    title: "registry list",
    description: CATALOG["registry.list"],
    risk: "read",
    domain: "registry",
    params: {
      type: "object",
      properties: { filter: { type: "string" } },
      additionalProperties: false,
    },
    run: (params) => ({ commands: registry.list({ filter: params?.filter }) }),
  },
  {
    id: "registry.describe",
    title: "registry describe",
    description: CATALOG["registry.describe"],
    risk: "read",
    domain: "registry",
    params: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (params) => {
      const described = registry.describe(params.id);
      if (!described) {
        const error = new Error(`no such command: ${params.id}`);
        error.code = "unknown_command";
        error.hint = "call registry.list to discover ids";
        throw error;
      }
      return described;
    },
  },
]);

const extensionCommands = createExtensionCommands({ registry, backend });
extensionCommands
  .registerInstalled()
  .then((summary) => console.log(JSON.stringify({ registryReady: true, ...summary })))
  .catch((error) =>
    console.warn("[registry] extension command registration failed:", error?.message ?? error),
  );

// Needs a connected launcher window by definition; exposed so callers get the typed error
// instead of guessing which commands are UI-bound.
registry.register([
  {
    id: "ui.getWindowState",
    title: "ui getWindowState",
    description:
      "Read the launcher renderer's UI state (open view, query, visible items, selection). Requires the running app; see get_state on the control channel.",
    risk: "read",
    domain: "ui",
    params: { type: "object" },
    run: () => {
      throw needsUi(
        "ui.getWindowState needs the launcher window; use the control channel get_state instead",
        "start the app with --control and call get_state",
      );
    },
  },
]);

// Control channel (docs/control-protocol.md): loopback-only HTTP with a per-launch bearer
// token; off by default, enabled with `--control` (argv) or OPENRAY_CONTROL=1.
const controlRequested = process.argv.includes("--control") || process.env.OPENRAY_CONTROL === "1";
if (controlRequested) {
  const fs = require("node:fs");
  const { createControlServer, writeControlToken, writeControlEndpoint } = require("./control-server");
  const { token, file } = writeControlToken(process.env.OPENRAY_DATA_DIR);
  const port = Number(process.env.OPENRAY_CONTROL_PORT ?? 0) || 0;
  createControlServer({ registry, backend, token, port })
    .then((control) => {
      writeControlEndpoint(process.env.OPENRAY_DATA_DIR, control.address);
      // The token itself is never logged; agents read it from the token file.
      console.log(JSON.stringify({ control: true, address: control.address, tokenFile: file }));
    })
    .catch((error) => console.error("[control] failed to start:", error?.message ?? error));
}

// FlowKey migration M2: the Store is gone. Any Store artifacts still on disk (store.sqlite,
// Store-installed extension folders, the stale extensions-root node_modules) move into the
// backup folder — move, never delete, idempotent, logged (docs/flowkey-migration-plan.md A4).
try {
  const migration = migrateRemovedStoreArtifacts({
    dataRoot: process.env.OPENRAY_DATA_DIR ?? path.dirname(config.extensionsRoot),
    extensionsRoot: config.extensionsRoot,
  });
  if (migration.moved.length > 0) {
    console.warn(`[migration] moved ${migration.moved.length} Store artifact(s) to the backup folder`);
  }
} catch (error) {
  console.warn("[migration] Store artifact migration failed:", error instanceof Error ? error.message : error);
}

// The Clipboard History shortcut is a per-command hotkey in Raycast, registered with the host once the
// window exists. Re-registering is harmless if it is already in place.
clipboard.handlers
  .getHotkey()
  .then(({ hotkey }) => backend.dispatch("backend", "clipboardHistory.registerHotkey", { hotkey }))
  .catch((error) => console.warn("[clipboard] could not register the clipboard history hotkey", error.message));

if (options.connectPipe) {
  console.log(
    JSON.stringify({
      ready: true,
      pipe: config.pipeName,
      extensionsRoot: config.extensionsRoot,
    }),
  );
}


  function close() {
    // Headless one-shots (CLI, tests) stop the stores' watchers and DB handles so the
    // event loop can drain; a live process never calls this.
    const closers = [
      () => clipboard.stopTasks(),
      () => fileIndexer.close(),
      () => notes.close(),
      () => quicklinks.close(),
      () => snippets.close(),
      () => calculator.close(),
      () => translator.close(),
    ];
    for (const closer of closers) {
      try {
        closer();
      } catch {
        /* already closed */
      }
    }
  }

  return { backend, registry, config, close, clipboard, calculator, translator, quicklinks, snippets, fileIndexer, focus, games, taskbar, settingsStore, advanced, notes, extensionStore };
}

module.exports = { createRuntime };
