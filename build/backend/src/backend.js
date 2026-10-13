// The extension host proper: worker pool + handler tables + named-pipe transport.
//
// Mirrors Raycast's `backend/index.mjs`:
//   * `yIr = join(node_modules, "@raycast", "api", "index.js")` is the worker entry point.
//   * `new Worker(yIr, { workerData, env: { NODE_PATH: â€¦/api/node_modules, â€¦ },
//     resourceLimits: { maxOldGenerationSizeMb: 100 } })`
//   * pool `YI = { dev: [], prod: [] }`, prewarm sizes 1/1, max 8.
//   * worker message loop routes `Notify` -> `wY`, `Request` -> `wIr` + reply, `Result` -> resolver.
//   * handler table `VOe` (render/renderEmpty/renderSuspense/showToast/â€¦) and
//     `z.frontend.extensionHost.<method>` for the renderer-facing side.

"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");
const { exec } = require("node:child_process");
const { Worker } = require("node:worker_threads");

const WORKER_ENTRY = path.join(__dirname, "worker-entry.js");

/** Mirrors `kn(e)` / `yq(e,t,n)` / `Fd()` from Raycast's backend. */
function paths(options) {
  return {
    configRoot: path.join(
      process.env.LOCALAPPDATA ?? process.env.HOME ?? ".",
      "RaycastMini",
    ),
    extensionDir(uuid) {
      return path.join(options.extensionsRoot, uuid);
    },
    commandEntry(extension, command) {
      // Store-installed extensions bundle flat (`<uuid>/<command>.js`, the real app's layout);
      // dev extensions keep their `dist/` output. Flat wins when both exist.
      const root = path.join(options.extensionsRoot, extension.uuid);
      const flat = path.join(root, `${command.name}.js`);
      if (fs.existsSync(flat)) return flat;
      return path.join(root, "dist", `${command.name}.js`);
    },
    toolEntry(extension, tool) {
      return path.join(options.extensionsRoot, extension.uuid, "tools", `${tool.name}.js`);
    },
    assetsPath(uuid) {
      return path.join(options.extensionsRoot, uuid, "assets");
    },
  };
}

function createBackend(options) {
  const P = paths(options);
  const sessions = new Map(); // workerId -> { worker, context }
  const activeSessions = new Map(); // sessionId -> workerId
  const pool = { dev: [], prod: [] };
  const pushSubscribers = new Set();
  // `clipboard.<method>` + `clipboardHistory.<method>`; installed by `index.js`.
  let clipboardHandlers = {};
  let quicklinksHandlers = {};
  let snippetsHandlers = {};
  let calculatorHandlers = {};
  let translatorHandlers = {};
  let fileIndexerHandlers = {};
  let usageTrackerHandlers = {};
  let windowStateHandlers = {};
  let focusHandlers = {};
  let gamesHandlers = {};
  let taskbarHandlers = {};
  let notesHandlers = {};

  // ---------------------------------------------------------------------------------------------
  // Installed-extension registry.
  // ---------------------------------------------------------------------------------------------

  async function allExtensions() {
    let entries = [];
    try {
      entries = fs.readdirSync(options.extensionsRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(options.extensionsRoot, entry.name, "package.json"), "utf-8"),
        );
        out.push({
          uuid: entry.name,
          id: entry.name,
          name: manifest.name,
          title: manifest.title ?? manifest.name,
          description: manifest.description ?? "",
          author: manifest.author ?? "local",
          icon: manifest.icon,
          commands: manifest.commands ?? [],
          tools: manifest.tools ?? [],
          path: P.extensionDir(entry.name),
          assetsPath: P.assetsPath(entry.name),
        });
      } catch {
        /* not an extension */
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  async function findCommand(extensionId, commandName) {
    const extension = (await allExtensions()).find((entry) => entry.uuid === extensionId);
    if (!extension) return null;
    const command = extension.commands.find((entry) => entry.name === commandName);
    if (!command) return null;
    return { extension, command };
  }

  // ---------------------------------------------------------------------------------------------
  // Worker lifecycle (the `t2` class in Raycast).
  // ---------------------------------------------------------------------------------------------

  function createWorker({ isDevelopment = false, appearance = "dark" } = {}) {
    const workerId = `w_${Math.random().toString(36).slice(2, 10)}`;
    const callbacks = new Map();
    let context = null;
    let terminated = false;
    let nextId = 1;

    const worker = new Worker(WORKER_ENTRY, {
      workerData: {
        apiRoot: options.apiRoot,
        extensionsRoot: options.extensionsRoot,
        isDevelopment,
        canAccessAI: true,
        appearance,
        textSize: "medium",
      },
      env: {
        ...process.env,
        NODE_ENV: isDevelopment ? "development" : "production",
        // THE hook that makes `require("@raycast/api")` resolve inside the extension bundle.
        NODE_PATH: path.join(options.apiRoot, "node_modules"),
        RAYCAST_VERSION: "2.4.0.0",
        RAYCAST_SCHEME: "raycast",
      },
      resourceLimits: { maxOldGenerationSizeMb: 100 },
    });

    function sendRequest(method, params) {
      if (terminated) return Promise.reject(new Error("worker terminated"));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        callbacks.set(id, { resolve, reject });
        worker.postMessage({ kind: "request", id, method, params });
      });
    }

    const record = {
      id: workerId,
      worker,
      isDevelopment,
      appearance,
      get context() {
        return context;
      },
      async initialize(nextContext) {
        context = nextContext;
        return sendRequest("initialize", nextContext);
      },
      async nativeCallback(callbackId, data) {
        return sendRequest("nativeCallback", { callbackId, data });
      },
      onNotify(handler) {
        notifyHandlers.push(handler);
      },
      async unload() {
        if (terminated) return;
        terminated = true;
        try {
          await worker.terminate();
        } catch {
          /* already gone */
        }
      },
    };

    const notifyHandlers = [];

    worker.on("message", async (message) => {
      const { kind, id, method, params, result } = message ?? {};
      if (kind === "notify") {
        for (const handler of notifyHandlers) {
          try {
            await handler(method, params);
          } catch (error) {
            console.error("[backend] notify handler failed", method, error);
          }
        }
        return;
      }
      if (kind === "request") {
        // The extension is calling into the host. `wIr` in Raycast.
        try {
          const value = await handleExtensionRequest(record, method, params ?? {});
          worker.postMessage({ kind: "result", id, result: { success: true, value } });
        } catch (error) {
          worker.postMessage({
            kind: "result",
            id,
            result: { success: false, error: String(error?.message ?? error) },
          });
        }
        return;
      }
      if (kind === "result") {
        const waiter = callbacks.get(id);
        callbacks.delete(id);
        if (!waiter) return;
        if (result?.success) waiter.resolve(result.value);
        else {
          console.error("[backend] extension request failed:", result?.error?.stack ?? result?.error);
          waiter.reject(new Error(String(result?.error?.message ?? result?.error ?? "extension request failed")));
        }
      }
    });

    worker.on("error", (error) => console.error(`[backend] worker ${workerId} error`, error));
    worker.on("exit", (code) => {
      if (!terminated) console.error(`[backend] worker ${workerId} exited with ${code}`);
    });

    return record;
  }

  function takeFromPool(isDevelopment) {
    const bucket = isDevelopment ? pool.dev : pool.prod;
    const worker = bucket.pop();
    if (!worker) return null;
    sessions.delete(worker.id);
    return worker;
  }

  function releaseToPool(worker) {
    sessions.delete(worker.id);
    const bucket = worker.isDevelopment ? pool.dev : pool.prod;
    bucket.push(worker);
  }

  // ---------------------------------------------------------------------------------------------
  // Handler tables
  // ---------------------------------------------------------------------------------------------

  /** Extension -> host. `VOe` in Raycast. */
  const hostHandlers = {
    // --- UI pipeline ------------------------------------------------------------------------
    async render(ctx, params) {
      return toRenderer("extensionHost.render", { ...params, sessionId: ctx.worker.id });
    },
    async renderEmpty(ctx, params) {
      return toRenderer("extensionHost.renderEmpty", { ...params, sessionId: ctx.worker.id });
    },
    async renderSuspense(ctx, params) {
      return toRenderer("extensionHost.renderSuspense", { ...params, sessionId: ctx.worker.id });
    },
    async showToast(ctx, params) {
      assertToastAllowed(ctx, "Toast API");
      return toRenderer("extensionHost.showToast", { ...params, sessionId: ctx.worker.id });
    },
    // Raycast routes `updateToast` through the same handler — a toast update is an upsert.
    async updateToast(ctx, params) {
      assertToastAllowed(ctx, "Toast API");
      return toRenderer("extensionHost.showToast", { ...params, sessionId: ctx.worker.id });
    },
    async hideToast(ctx, params) {
      return toRenderer("extensionHost.hideToast", { ...params, instance: ctx.origin });
    },
    async showHUD(ctx, params) {
      if (ctx.entryPointType === "model_provider") {
        throw new Error("HUD API is not available to model provider entry points");
      }
      return toRenderer("extensionHost.showHUD", { ...params, sessionId: ctx.worker.id });
    },
    async showAlert(ctx, params) {
      return toRenderer("extensionHost.showAlert", { ...params, sessionId: ctx.worker.id });
    },
    async formSetFocus(ctx, params) {
      return toRenderer("extensionHost.formSetFocus", { ...params, sessionId: ctx.worker.id });
    },
    async formReset(ctx, params) {
      return toRenderer("extensionHost.formReset", { ...params, sessionId: ctx.worker.id });
    },
    async popToRoot(ctx, params) {
      return toRenderer("extensionHost.popToRoot", { ...params, sessionId: ctx.worker.id });
    },
    async clearSearchBar(ctx, params) {
      return toRenderer("extensionHost.clearSearchBar", { ...params, sessionId: ctx.worker.id });
    },
    async closeMainRaycastWindow(ctx, params) {
      return toRenderer("extensionHost.closeMainRaycastWindow", { ...params, sessionId: ctx.worker.id });
    },
    async openCommandPreferences(ctx, params) {
      return toRenderer("extensionHost.openCommandPreferences", { ...params, sessionId: ctx.worker.id });
    },
    async openExtensionPreferences(ctx, params) {
      return toRenderer("extensionHost.openExtensionPreferences", { ...params, sessionId: ctx.worker.id });
    },
    async commandException(ctx, params) {
      console.error("[backend] commandException", params);
      return toRenderer("extensionHost.commandException", { ...params, sessionId: ctx.worker.id });
    },
    async updateCommandMetadata(ctx, params) {
      return toRenderer("extensionHost.updateCommandMetadata", { ...params, sessionId: ctx.worker.id });
    },
    async launchCommand(ctx, params) {
      return dispatch("backend", "extensionHost.loadCommand", {
        extension: ctx.extension,
        command: { name: params.name, type: params.type, mode: "view" },
        preferences: {},
        props: params.arguments ?? {},
        debug: false,
      });
    },

    // --- OS-level integration ---------------------------------------------------------------
    async open(ctx, params) {
      const target = String(params.path).replace(/"/g, "");
      const command =
        process.platform === "win32" ? `start "" "${target}"` : `open "${target}"`;
      return new Promise((resolve, reject) => {
        exec(command, { shell: true }, (error) => (error ? reject(error) : resolve(undefined)));
      });
    },
    async setClipboard(ctx, params) {
      return dispatch("backend", "clipboard.write", params);
    },
    async getClipboard(ctx) {
      return dispatch("backend", "clipboard.read", {});
    },
    async clearClipboard(ctx) {
      return dispatch("backend", "clipboard.clear", {});
    },
    async getSelectedText() {
      return dispatch("backend", "shell.getSelectedText", {});
    },
    async getFrontmostApplication() {
      return dispatch("backend", "shell.getFrontmostApplication", {});
    },

    // --- extension storage ------------------------------------------------------------------
    async getLocalStorageItem(ctx, params) {
      return storage(ctx).then((store) => ({ value: store[params.key] ?? null }));
    },
    async setLocalStorageItem(ctx, params) {
      return storage(ctx).then((store) => writeStorage(ctx, { ...store, [params.key]: params.value }));
    },
    async removeLocalStorageItem(ctx, params) {
      return storage(ctx).then((store) => {
        delete store[params.key];
        return writeStorage(ctx, store);
      });
    },
    async clearLocalStorage(ctx) {
      return writeStorage(ctx, {});
    },
    async allLocalStorageItems(ctx) {
      return storage(ctx).then((store) => ({ value: store }));
    },

    async authorizeOAuth(ctx, params) {
      return dispatch("backend", "auth.authorizeOAuth", params);
    },
    async initOAuth(ctx, params) {
      return dispatch("backend", "auth.initOAuth", params);
    },
    async getOAuthTokens(ctx, params) {
      return dispatch("backend", "auth.getOAuthTokens", params);
    },
    async setOAuthTokens(ctx, params) {
      return dispatch("backend", "auth.setOAuthTokens", params);
    },
    async removeOAuthTokens(ctx, params) {
      return dispatch("backend", "auth.removeOAuthTokens", params);
    },
  };

  /** Extension -> host, fire and forget. `wY` in Raycast. */
  const notifyTable = {
    async logCommand() {},
    async reportMemoryUsage() {},
    async captureException(ctx, params) {
      console.error("[backend] extension exception", params);
    },
    async commandException(ctx, params) {
      console.error("[backend] commandException", params);
      return toRenderer("extensionHost.commandException", { ...params, sessionId: ctx.worker.id });
    },
  };

  /** Raycast throws this for background commands (`"Toast API is not available when command is
   * launched in background"`); `showHUD` carries the same guard for model providers only. */
  function assertToastAllowed(ctx, api) {
    if (ctx.entryPointType === "command" && ctx.launchType === "background") {
      throw new Error(`${api} is not available when command is launched in background`);
    }
  }

  async function handleExtensionRequest(record, method, params) {
    const context = { ...(record.context ?? {}), worker: record };
    const handler = hostHandlers[method];
    if (!handler) throw new Error(`Handler for method ${method} not found`);
    const result = await handler(context, params);
    return normaliseReturn(result);
  }

  function normaliseReturn(value) {
    if (value instanceof Promise) return "[Promise]";
    if (typeof value === "function") return "[Function]";
    return value;
  }

  /** Per-extension `LocalStorage`, persisted next to the extension. */
  function storageFile(ctx) {
    return path.join(P.extensionDir(ctx.extensionId ?? ctx.extension?.uuid ?? "unknown"), ".storage.json");
  }

  function storage(ctx) {
    return Promise.resolve().then(() => {
      try {
        return JSON.parse(fs.readFileSync(storageFile(ctx), "utf-8"));
      } catch {
        return {};
      }
    });
  }

  function writeStorage(ctx, store) {
    fs.mkdirSync(path.dirname(storageFile(ctx)), { recursive: true });
    fs.writeFileSync(storageFile(ctx), JSON.stringify(store, null, 2));
    return undefined;
  }

  // ---------------------------------------------------------------------------------------------
  // Renderer -> backend. `extensionHost.<method>` in Raycast.
  // ---------------------------------------------------------------------------------------------

  const extensionHostHandlers = {
    async loadCommand(params) {
      const { extension, command, preferences = {}, props = {}, debug = false } = params;
      if (!extension?.uuid) throw new Error("loadCommand: missing extension");
      if (!command?.name) throw new Error("loadCommand: missing command");

      const isDevelopment = Boolean(debug);
      const worker = takeFromPool(isDevelopment) ?? createWorker({ isDevelopment });
      const sessionId = worker.id;
      activeSessions.set(sessionId, worker.id);
      sessions.set(worker.id, worker);

      const context = {
        id: sessionId,
        sessionId,
        ownerOrAuthorName: extension.author,
        extensionName: extension.name,
        extensionId: extension.uuid,
        entryPointName: command.name,
        entryPointType: command.type ?? "command",
        entryPointMode: command.mode ?? "view",
        entryPoint: command,
        extension,
        appearance: worker.appearance,
        preferences,
        argumentValues: props ?? {},
        namedExport: command.namedExport,
        startedAt: Date.now(),
        launchType: props?.launchType ?? "userInitiated",
        assetsPath: extension.assetsPath ?? P.assetsPath(extension),
        supportPath: P.extensionDir(extension.uuid),
        commandPath: P.commandEntry(extension, command),
      };

      worker.onNotify(async (method, notificationParams) => {
        const handler = notifyTable[method];
        if (handler) await handler({ ...context, worker }, notificationParams ?? {});
      });

      try {
        await worker.initialize(context);
      } catch (error) {
        await worker.unload();
        sessions.delete(worker.id);
        activeSessions.delete(sessionId);
        throw error;
      }

      if (context.entryPointMode === "no-view") {
        // `if (mode === "no-view" && !deferNoViewUnload) unload()` in Raycast.
        setImmediate(() => {
          if (sessions.has(worker.id)) {
            sessions.delete(worker.id);
            activeSessions.delete(sessionId);
            worker.unload().catch(() => undefined);
          }
        });
      }

      return { sessionId };
    },

    async unloadEntryPoint(params) {
      const workerId = activeSessions.get(params.sessionId);
      if (!workerId) return undefined;
      activeSessions.delete(params.sessionId);
      const worker = sessions.get(workerId);
      sessions.delete(workerId);
      if (worker) await worker.unload();
      return undefined;
    },

    async callNodeCallback(params) {
      const workerId = activeSessions.get(params.sessionId);
      if (!workerId) throw new Error(`no worker for session ${params.sessionId}`);
      const worker = sessions.get(workerId);
      return worker.nativeCallback(params.callbackId, params.data);
    },

    async getInstalledNodeExtensionSummaries() {
      return { extensions: await allExtensions() };
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Named pipe to the .NET launcher.
  //
  //   -> { type:"request", id, module:"frontend"|"backend", method, data }
  //   <- { type:"response", id, ok, data | error }
  //   <- { type:"push",    module:"frontend", method, data }        (host -> renderer)
  // ---------------------------------------------------------------------------------------------

  let socket = null;
  let nextId = 1;
  const waiters = new Map();
  const connectedCallbacks = [];
  // Overridable transport: defaults to the named pipe, replaced in tests.
  let transport = null;
  // One reader per pipe. `index.js` used to attach a second `readline` to the same stream, which
  // raced the one below and swallowed lines.
  let requestHandler = null;

  function connect() {
    // On Windows a named pipe address must be fully qualified.
    const pipeAddress = process.platform === "win32"
      ? `\\\\.\\pipe\\${options.pipeName}`
      : options.pipeName;
    const client = net.createConnection(pipeAddress, () => {
      socket = client;
      console.log(`[backend] connected to launcher pipe "${options.pipeName}"`);
      connectedCallbacks.splice(0).forEach((resolve) => resolve(client));
    });
    client.on("error", (error) => {
      console.error("[backend] pipe error:", error.message);
      setTimeout(connect, 400);
    });
    client.on("close", () => {
      socket = null;
      console.error("[backend] pipe closed - reconnecting");
      setTimeout(connect, 400);
    });
    client.on("data", (buffer) => {
      const text = buffer.toString("utf-8");
      console.error(`[backend] raw pipe bytes: ${buffer.length} :: head=${text.slice(0, 60)} tail=${text.slice(-40)}`);
    });
    const rl = readline.createInterface({ input: client, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.type === "push") {
        for (const handler of pushSubscribers) {
          handler(message.module, message.method, message.data).catch((error) =>
            console.error("[backend] push handler failed", error),
          );
        }
        return;
      }

      if (message.type === "response") {
        const waiter = waiters.get(message.id);
        waiters.delete(message.id);
        if (!waiter) return;
        if (message.ok === false) waiter.reject(new Error(message.error ?? "host rejected request"));
        else waiter.resolve(message.data);
        return;
      }

      if (message.type === "request") {
        // Requests from the host are answered here so there is exactly one reader on the pipe.
        console.error(`[backend] dispatching ${message.module}.${message.method} id=${message.id}`);
        Promise.resolve()
          .then(() => (requestHandler ?? dispatchMessage)(message.module, message.method, message.data))
          .then((data) => {
            console.error(`[backend] answered ${message.module}.${message.method} id=${message.id}`);
            socket?.write(`${JSON.stringify({ type: "response", id: message.id, ok: true, data })}\n`);
          })
          .catch((error) => {
            socket?.write(
              `${JSON.stringify({ type: "response", id: message.id, ok: false, error: String(error?.message ?? error) })}\n`,
            );
          });
      }
    });
    return client;
  }

  function whenConnected() {
    if (socket) return Promise.resolve(socket);
    return new Promise((resolve) => connectedCallbacks.push(resolve));
  }

  async function send(module, method, data) {
    if (transport) return transport(module, method, data);
    await whenConnected();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiters.set(id, { resolve, reject });
      socket.write(`${JSON.stringify({ type: "request", id, module, method, data })}\n`);
    });
  }

  /** Deliver something to the WebView2 renderer. `z.frontend.*` in Raycast. */
  function toRenderer(method, data) {
    return send("frontend", method, data);
  }

  /** Ask the .NET host to do something. `dispatchRequest("backend", â€¦)` in Raycast. */
  function dispatch(module, method, data) {
    return send(module, method, data);
  }

  // ---------------------------------------------------------------------------------------------

  async function dispatchMessage(module, method, data) {
    if (module === "backend") {
      // The renderer addresses the host with a dotted path — `dispatchRequest("backend",
      // "extensionHost.loadCommand", …)`.
      if (method.startsWith("extensionHost.")) {
        const handler = extensionHostHandlers[method.slice("extensionHost.".length)];
        if (handler) return handler(data ?? {});
      }
      if (extensionHostHandlers[method]) return extensionHostHandlers[method](data ?? {});
      if (hostHandlers[method]) return hostHandlers[method]({ worker: null }, data ?? {});

      // Clipboard history (`ipc.backend.clipboard.*` in the renderer, `clipboardHistory.*` from the
      // native host). Handled here rather than forwarded, because the store lives in this process.
      // `clipboard.write`/`read`/`clear` are the launcher's own raw-clipboard helpers and stay native.
      if (method.startsWith("clipboard.") || method.startsWith("clipboardHistory.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = clipboardHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // File indexer (`ipc.backend.fileSearch.*`)
      if (method.startsWith("fileSearch.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = fileIndexerHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // Quicklinks (`ipc.backend.quicklinks.*`)
      if (method.startsWith("quicklinks.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = quicklinksHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // Snippets (`ipc.backend.snippets.*`; the native hook resolves through here too)
      if (method.startsWith("snippets.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = snippetsHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // Calculator (`ipc.backend.calculator.*`) — evaluation, history store, rate cache.
      if (method.startsWith("calculator.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = calculatorHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // Translator (`ipc.backend.translator.*`) — provider call, quick-translate parser, custom commands.
      if (method.startsWith("translator.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = translatorHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // Usage tracker (`ipc.backend.usage.*`)
      if (method.startsWith("usage.")) {
        const name = method.slice(method.indexOf(".") + 1);
        const handler = usageTrackerHandlers[name];
        if (handler) return handler(data ?? {});
      }

      // Window Management saved bounds (`windowManagement.getSavedWindowState|saveWindowState`)
      // live in this process; the remaining `windowManagement.*` verbs are native host routes.
      if (method === "windowManagement.getSavedWindowState" || method === "windowManagement.saveWindowState") {
        const handler = windowStateHandlers[method.slice("windowManagement.".length)];
        if (handler) return handler(data ?? {});
      }

      // Focus (`focus.*`): the session state machine lives here; the module itself forwards the
      // host half (blocking loop + panel) over the native pipe. Unknown verbs fall through to the
      // native forward below.
      if (method.startsWith("focus.")) {
        const handler = focusHandlers[method.slice("focus.".length)];
        if (handler) return handler(data ?? {});
      }
      if (method.startsWith("games.") || method.startsWith("taskbar.")) {
        const table = method.startsWith("games.") ? gamesHandlers : taskbarHandlers;
        const handler = table[method.slice(method.indexOf(".") + 1)];
        if (handler) return handler(data ?? {});
      }

      // Notes (`notes.*`): the store lives in this process; the launcher's Search Notes view and
      // the Notes window page both read through it.
      if (method.startsWith("notes.")) {
        const handler = notesHandlers[method.slice("notes.".length)];
        if (handler) return handler(data ?? {});
      }

      // Native `.NET` operations (clipboard, shell, and Raycast's internal Applications extension).
      // The clipboard-history verbs the host owns (OCR, image pixels, `Open in App`, `Save as File`,
      // capability probe) are named `clipboardHistory.*` so they are distinguishable from the raw
      // clipboard helpers the handler layer implements itself.
      if (method.startsWith("clipboardHistory.")) {
        return send("backend", "native", { method, data: data ?? {} });
      }
      if (method.startsWith("clipboard.") || method.startsWith("shell.") || method.startsWith("applications.") || method.startsWith("fileSystem.") || method.startsWith("windowManagement.")) {
        return send("backend", "native", { method, data: data ?? {} });
      }

      const extras = {
        "extensions.list": () => ({ extensions: allExtensions() }),
        "extensions.command": (payload) => findCommand(payload.extensionId, payload.commandName),
      };
      if (extras[method]) return extras[method](data ?? {});
      throw new Error(`no such backend method: ${method}`);
    }
    if (module === "frontend") {
      return toRenderer(method, data ?? {});
    }
    throw new Error(`unknown module ${module}`);
  }

  return {
    allExtensions,
    dispatchMessage,
    toRenderer,
    dispatch,
    onPush(handler) {
      pushSubscribers.add(handler);
    },
    releaseToPool,
    createWorker,
    connect,
    /** Replace the named-pipe transport (used by tests and by unit-level harnesses). */
    setTransport(next) {
      transport = next;
    },
    /** Override how host requests are dispatched (defaults to `dispatchMessage`). */
    setRequestHandler(next) {
      requestHandler = next;
    },
    /** Install the clipboard-history handler table (Raycast's `handler::clipboard-history`). */
    registerClipboardHandler(handlers) {
      clipboardHandlers = handlers ?? {};
    },
    /** Install the quicklinks handler table. */
    registerQuicklinksHandler(handlers) {
      quicklinksHandlers = handlers ?? {};
    },
    /** Install the snippets handler table. */
    registerSnippetsHandler(handlers) {
      snippetsHandlers = handlers ?? {};
    },
    /** Install the calculator handler table. */
    registerCalculatorHandler(handlers) {
      calculatorHandlers = handlers ?? {};
    },
    /** Install the translator handler table. */
    registerTranslatorHandler(handlers) {
      translatorHandlers = handlers ?? {};
    },
    /** Install the file indexer handler table. */
    registerFileIndexerHandler(handlers) {
      fileIndexerHandlers = handlers ?? {};
    },
    /** Install the usage tracker handler table. */
    registerUsageTrackerHandler(handlers) {
      usageTrackerHandlers = handlers ?? {};
    },
    /** Install the window saved-state handler table. */
    registerWindowStateHandler(handlers) {
      windowStateHandlers = handlers ?? {};
    },
    /** Install the focus session handler table. */
    registerFocusHandler(handlers) {
      focusHandlers = handlers ?? {};
    },
    /** Install the games handler table. */
    registerGamesHandler(handlers) {
      gamesHandlers = handlers ?? {};
    },
    /** Install the taskbar handler table. */
    registerTaskbarHandler(handlers) {
      taskbarHandlers = handlers ?? {};
    },
    /** Install the notes store handler table. */
    registerNotesHandler(handlers) {
      notesHandlers = handlers ?? {};
    },
  };
}

module.exports = { createBackend };
