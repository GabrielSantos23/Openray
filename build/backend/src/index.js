// Raycast Mini — Node extension host.
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
const { createTaskbar } = require("./taskbar");
const { createSettingsStore } = require("./settings-store");
const { createNotes } = require("./notes");
const { createExtensionStore } = require("./store");

const config = {
  // Must match host/NamedPipeBridge.cs
  pipeName: process.env.RAYCAST_MINI_PIPE ?? "raycast-mini-ipc",
  frontendRoot: process.env.RAYCAST_MINI_FRONTEND_ROOT ?? path.join(__dirname, "..", "..", "frontend"),
  extensionsRoot:
    process.env.RAYCAST_MINI_EXTENSIONS_ROOT ??
    path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini", "extensions"),
};

const backend = createBackend({
  pipeName: config.pipeName,
  frontendRoot: config.frontendRoot,
  extensionsRoot: config.extensionsRoot,
  dataRoot: process.env.RAYCAST_MINI_DATA_DIR ?? path.dirname(config.extensionsRoot),
});

// `connect()` owns the single pipe reader and answers host requests too, so nothing else has to
// attach a second `readline` to the socket.
backend.connect();

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
snippets.registerKeywordsWithHost();
snippets.pushExpansionConfigToHost();

// File indexer — indexes the user's scopes in the background and answers fileSearch.* searches.
const fileIndexer = createFileIndexer({
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerFileIndexerHandler(fileIndexer.handlers);

  // Usage tracker
  const usageTracker = createUsageTracker({});
  backend.registerUsageTrackerHandler(usageTracker.handlers);

// Window Management saved bounds — the store behind the `Restore` command.
backend.registerWindowStateHandler(createWindowStates().handlers);

// Focus is the sixth internal extension (`focus.*`). The session state machine lives here and
// re-syncs the host on every mutation; the host owns the blocking loop and the timer panel.
// Bootstrap restores the persisted session and upserts the built-in categories.
const focus = createFocus({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerFocusHandler(focus.handlers);
focus.bootstrap();

// Games is the seventh (`games.*`): the isGame flag store over the host application list plus the
// Game Mode toggle forwarded to the host's fullscreen watch.
const games = createGames({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
});
backend.registerGamesHandler(games.handlers);
games.pushSettingsToHost();

// Windows Taskbar is the eighth (`taskbar.*`): strip settings persisted here, the AppBar window
// lives in the host.
const taskbar = createTaskbar({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
});
backend.registerTaskbarHandler(taskbar.handlers);
taskbar.pushSettingsToHost();

// General settings (`settings.*`): the shared store both windows read; every change is pushed
// back out so the launcher and the Settings window update live.
const settingsStore = createSettingsStore({
  toRenderer: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerSettingsStoreHandler(settingsStore.handlers);

// Notes is the ninth (`notes.*`): the SQLite store, the trash with its 60-day purge and the
// markdown conversions behind Copy As / Export live here; the window page and the launcher's
// Search Notes view are both readers. Note text and titles never reach the logs.
const notes = createNotes({
  dispatch: (method, data) => backend.dispatch("backend", method, data),
  pushToFrontend: (method, data) => backend.dispatch("frontend", method, data),
});
backend.registerNotesHandler(notes.handlers);
notes.bootstrap();

// The extension Store (`store.*`): the GitHub catalog (raycast/extensions) plus locally published
// FlowKey extensions, living under `<dataRoot>/store/`. `store.sync` downloads the catalog in the
// background; installs of uploaded extensions land in the live extensions root.
const extensionStore = createExtensionStore({
  dataRoot: process.env.RAYCAST_MINI_DATA_DIR ?? path.dirname(config.extensionsRoot),
  extensionsRoot: config.extensionsRoot,
});
backend.registerStoreHandler(extensionStore.handlers);

// FlowKey migration M2: the Store is gone. Any Store artifacts still on disk (store.sqlite,
// Store-installed extension folders, the stale extensions-root node_modules) move into the
// backup folder — move, never delete, idempotent, logged (docs/flowkey-migration-plan.md A4).
try {
  const migration = migrateRemovedStoreArtifacts({
    dataRoot: process.env.RAYCAST_MINI_DATA_DIR ?? path.dirname(config.extensionsRoot),
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

console.log(
  JSON.stringify({
    ready: true,
    pipe: config.pipeName,
    extensionsRoot: config.extensionsRoot,
    }),
);

process.on("uncaughtException", (error) => console.error("[backend] uncaught", error));
process.on("unhandledRejection", (error) => console.error("[backend] unhandled rejection", error));

// Keeps the process alive; the pipe does too, but this makes the intent explicit.
setInterval(() => undefined, 1 << 30).unref();
