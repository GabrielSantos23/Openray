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
  const pool = { "ray-dev": [], "ray-prod": [], "fk-dev": [], "fk-prod": [] };
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
  let storeHandlers = {};
  // Set by index.js to the store's classification gate; loadCommand refuses disabled commands.
  let launchGate = null;

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
    // The store's per-command classification rides on every summary so the renderer can grey out
    // disabled commands (badge + one-line reason).
    let compat = null;
    try {
      compat = storeHandlers.getSummariesCompat?.()?.compat ?? null;
    } catch {
      compat = null;
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        // FlowKey extensions declare manifest.json (commands keyed by `id`); @raycast ones
        // package.json. Both land in the same summary shape the renderer consumes.
        const flowkeyManifestPath = path.join(options.extensionsRoot, entry.name, "manifest.json");
        if (fs.existsSync(flowkeyManifestPath)) {
          const fk = JSON.parse(fs.readFileSync(flowkeyManifestPath, "utf-8"));
          out.push({
            uuid: entry.name,
            id: fk.id ?? entry.name,
            name: fk.name,
            title: fk.name,
            description: fk.description ?? "",
            author: "flowkey",
            icon: null,
            badge: null,
            commands: (fk.commands ?? []).map((command) => ({
              name: command.id,
              title: command.title,
              description: command.subtitle,
              mode: command.mode === "background" ? "no-view" : "view",
              disabledReason: null,
            })),
            tools: [],
            path: P.extensionDir(entry.name),
            assetsPath: P.assetsPath(entry.name),
            isFlowkey: true,
          });
          continue;
        }
        const manifest = JSON.parse(
          fs.readFileSync(path.join(options.extensionsRoot, entry.name, "package.json"), "utf-8"),
        );
        const extensionCompat = compat?.[entry.name] ?? null;
        out.push({
          uuid: entry.name,
          id: entry.name,
          name: manifest.name,
          title: manifest.title ?? manifest.name,
          description: manifest.description ?? "",
          author: manifest.author ?? "local",
          icon: manifest.icon,
          badge: extensionCompat?.badge ?? null,
          commands: (manifest.commands ?? []).map((command) => ({
            ...command,
            disabledReason: extensionCompat?.commands?.[command.name]?.class
              && extensionCompat.commands[command.name].class !== "compatible"
              ? extensionCompat.commands[command.name].reason ?? "Not supported"
              : null,
          })),
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

  const FLOWKEY_WORKER_ENTRY = path.resolve(options.apiRoot, "..", "flowkey", "worker", "dist", "flowkey-worker.js");

  function createWorker({ isDevelopment = false, appearance = "dark", flowkey = false } = {}) {
    const workerId = `w_${Math.random().toString(36).slice(2, 10)}`;
    const callbacks = new Map();
    let context = null;
    let terminated = false;
    let nextId = 1;
    const kind = flowkey ? "fk" : "ray";

    const worker = flowkey
      ? new Worker(FLOWKEY_WORKER_ENTRY, {
          workerData: { extensionsRoot: options.extensionsRoot, isDevelopment },
          env: { ...process.env, NODE_ENV: isDevelopment ? "development" : "production" },
          resourceLimits: { maxOldGenerationSizeMb: 100 },
        })
      : new Worker(WORKER_ENTRY, {
          workerData: {
            apiRoot: options.apiRoot,
            extensionsRoot: options.extensionsRoot,
            isDevelopment,
            // The clone has no AI, browser extension, or window-management integration — the same
            // flag values the real app produces without a pro subscription (docs/store-spec.md §5).
            canAccessAI: false,
            canAccessBetterAIModels: false,
            isBrowserExtensionInstalled: false,
            canAccessWindowManagement: false,
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
      kind,
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
        rejectPendingWorkers("worker unloaded");
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

    // A crashed worker is discarded (never pooled), its session torn down, and the failure
    // surfaces as a `commandException` toast naming the extension (plan §1.3). Every pending
    // request into the worker rejects, so a death mid-`initialize` cannot hang `loadCommand`.
    function rejectPendingWorkers(reason) {
      for (const [, waiter] of callbacks) waiter.reject(new Error(reason));
      callbacks.clear();
    }

    function reportWorkerCrash(name, message) {
      rejectPendingWorkers(`worker crashed: ${message}`);
      if (terminated || !sessions.has(workerId)) return;
      sessions.delete(workerId);
      for (const [sessionId, mappedWorkerId] of activeSessions) {
        if (mappedWorkerId === workerId) activeSessions.delete(sessionId);
      }
      toRenderer("extensionHost.commandException", {
        sessionId: workerId,
        title: context?.extensionName ?? "Extension",
        name,
        message,
      }).catch(() => undefined);
    }

    worker.on("error", (error) => {
      console.error(`[backend] worker ${workerId} error`, error);
      reportWorkerCrash(error?.name ?? "Error", error?.message ?? String(error));
    });
    worker.on("exit", (code) => {
      if (!terminated) {
        console.error(`[backend] worker ${workerId} exited with ${code}`);
        reportWorkerCrash("WorkerExited", `Command worker exited unexpectedly with code ${code}`);
      }
    });

    return record;
  }

  function takeFromPool(isDevelopment, kind = "ray") {
    const bucket = pool[`${kind}-${isDevelopment ? "dev" : "prod"}`];
    const worker = bucket?.pop();
    if (!worker) return null;
    sessions.delete(worker.id);
    return worker;
  }

  function releaseToPool(worker) {
    sessions.delete(worker.id);
    const bucket = pool[`${worker.kind ?? "ray"}-${worker.isDevelopment ? "dev" : "prod"}`];
    bucket?.push(worker);
  }

  // ---------------------------------------------------------------------------------------------
  // OAuth PKCE loopback redirect service (one shared server, waiters keyed by state).
  // ---------------------------------------------------------------------------------------------

  const OAUTH_REDIRECT_TIMEOUT_MS = 300_000;
  // One pending sign-in per extension: views refetch and would otherwise open a browser tab on
  // every attempt. Concurrent authorizes join the pending flow until it resolves or times out.
  const oauthPendingByExtension = new Map();
  // Pending authorization responses keyed by the PKCE state.
  const oauthWaiters = new Map();
  let oauthClipboardTimer = null;

  // FlowKey per-extension transient caches (`cache.*` capability) and pending alert.confirm
  // promises whose resolution rides the normal nativeCallback path.
  const flowkeyCaches = new Map();
  function getFlowkeyCache(ctx) {
    const key = ctx.extensionId ?? ctx.extension?.uuid ?? "unknown";
    let cache = flowkeyCaches.get(key);
    if (!cache) {
      cache = new Map();
      flowkeyCaches.set(key, cache);
    }
    return cache;
  }
  const pendingFlowkeyAlerts = new Map();
  let flowkeyAlertSeq = 0;

  /**
   * While a sign-in is pending, watch the clipboard for the provider's redirect URL. The redirect
   * goes to `raycast.com/redirect` (the URI every extension's provider has registered), whose page
   * hands the response to the real app through the `raycast://` protocol — the clone completes the
   * same handshake when the user copies that page's URL (Ctrl+L, Ctrl+C). Matching is keyed on the
   * pending state, so unrelated clipboard content can never complete a flow.
   */
  function ensureOAuthClipboardPolling() {
    if (oauthClipboardTimer) return;
    oauthClipboardTimer = setInterval(async () => {
      if (oauthWaiters.size === 0) return;
      let text;
      try {
        // Through the handler table so tests can stub the clipboard like any native route.
        const result = await hostHandlers.getClipboard({}, {});
        text = typeof result === "string" ? result : (result?.value ?? "");
      } catch {
        return; // clipboard unavailable this tick
      }
      if (typeof text !== "string" || !text.includes("state=")) return;
      for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        let url;
        try {
          url = new URL(match[0]);
        } catch {
          continue;
        }
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (!state || !code || !oauthWaiters.has(state)) continue;
        const waiter = oauthWaiters.get(state);
        oauthWaiters.delete(state);
        clearTimeout(waiter.timer);
        waiter.resolve(code);
      }
    }, 1500);
    oauthClipboardTimer.unref();
  }

  function waitForOAuthRedirect(state) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        oauthWaiters.delete(state);
        reject(new Error(`OAuth authorization timed out after ${OAUTH_REDIRECT_TIMEOUT_MS / 1000}s`));
      }, OAUTH_REDIRECT_TIMEOUT_MS);
      oauthWaiters.set(state, { resolve, reject, timer });
    });
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
        launchContext: params.context ?? null,
        debug: false,
      });
    },

    // --- file / shell routes the extended API surface forwards natively -----------------------
    async "fileSystem.moveToTrash"(ctx, params) {
      return dispatch("backend", "fileSystem.moveToTrash", params);
    },
    async "shell.revealFile"(ctx, params) {
      return dispatch("backend", "shell.revealFile", params);
    },
    async "shell.openWith"(ctx, params) {
      return dispatch("backend", "shell.openWith", params);
    },

    /** Worker-side `getApplications` — the same native route the launcher's app list uses. */
    async getApplications(ctx, params) {
      const result = await send("backend", "native", { method: "applications.getAll", data: params ?? {} });
      return result ?? { value: [] };
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

    // --- FlowKey capability calls (nativeCall) ----------------------------------------------
    // `native.call('http.fetch', …)` from a FlowKey extension lands here. The manifest consent
    // gate (`nativeMethods` / `httpHosts`) runs before any route dispatch; routes the clone does
    // not implement yet fail with a typed error, never a silent no-op.
    async nativeCall(ctx, params) {
      // The worker sends `{ method, params }`; every route reads the inner call params.
      const method = String(params?.method ?? "");
      const call = params?.params ?? {};
      const manifestNative = ctx.flowkeyManifest?.nativeMethods ?? [];
      const allowed = manifestNative.some((declared) =>
        declared.endsWith(".*") ? method.startsWith(declared.slice(0, -1)) : declared === method,
      );
      if (!allowed) throw new Error(`native method ${method} is not declared in the manifest`);

      const flowkeyCache = getFlowkeyCache(ctx);
      const storageKey = ctx.extensionId ?? ctx.extension?.uuid ?? "unknown";
      switch (method) {
        case "http.fetch": {
          const url = String(call.url ?? "");
          let host;
          try { host = new URL(url).host; } catch { throw new Error(`http.fetch: invalid url ${url}`); }
          const hosts = ctx.flowkeyManifest?.httpHosts ?? [];
          const allowedHost = hosts.some((declared) =>
            declared.startsWith(".") ? host.endsWith(declared.slice(1)) || host === declared.slice(1) : host === declared,
          );
          if (!allowedHost) throw new Error(`http.fetch: ${host} is not in the manifest httpHosts`);
          const response = await fetch(url, {
            method: call.method ?? "GET",
            headers: call.headers ?? {},
            body: call.body,
            signal: AbortSignal.timeout(30_000),
          });
          const bodyText = await response.text();
          return { status: response.status, headers: Object.fromEntries(response.headers.entries()), bodyText };
        }
        case "clipboard.read":
          return getClipboard(ctx).then((value) => ({ text: value?.value ?? null }));
        case "clipboard.write":
          return setClipboard(ctx, { text: String(call.text ?? "") });
        case "storage.get": {
          const store = await storage(ctx);
          const raw = store[`flowkey:${call.key}`];
          return { value: raw === undefined ? null : JSON.parse(raw) };
        }
        case "storage.set":
          return storage(ctx).then((store) => writeStorage(ctx, { ...store, [`flowkey:${call.key}`]: JSON.stringify(call.value ?? null) }));
        case "storage.delete":
          return storage(ctx).then((store) => {
            delete store[`flowkey:${call.key}`];
            return writeStorage(ctx, store);
          });
        case "storage.keys": {
          const store = await storage(ctx);
          return { keys: Object.keys(store).filter((key) => key.startsWith("flowkey:")).map((key) => key.slice("flowkey:".length)) };
        }
        case "storage.allItems": {
          const store = await storage(ctx);
          const items = {};
          for (const [key, raw] of Object.entries(store)) {
            if (key.startsWith("flowkey:")) items[key.slice("flowkey:".length)] = JSON.parse(raw);
          }
          return { items };
        }
        case "cache.get":
          return { value: flowkeyCache.get(String(call.key)) ?? null };
        case "cache.set":
          flowkeyCache.set(String(call.key), call.value ?? null);
          return {};
        case "cache.delete":
          flowkeyCache.delete(String(call.key));
          return {};
        case "cache.clear":
          flowkeyCache.clear();
          return {};
        case "shell.openUrl":
        case "shell.openPath":
          return open(ctx, { path: String(call.url ?? call.path ?? "") });
        case "shell.revealPath":
          return dispatch("backend", "shell.revealFile", { path: String(call.path ?? "") });
        case "apps.list": {
          const payload = await dispatch("backend", "applications.getAll", {});
          const apps = payload?.value ?? [];
          return { apps: apps.map((app) => ({ id: app.id ?? app.path, name: app.name })) };
        }
        case "hud.show":
          return showHUD(ctx, { title: String(call.title ?? "") });
        case "toast.show":
          return showToast(ctx, { title: String(call.title ?? ""), message: call.message, style: call.style === "failure" ? "failure" : "success" });
        case "alert.confirm":
          return new Promise((resolve) => {
            const alertId = `fkalert${flowkeyAlertSeq++}`;
            const okId = `${alertId}-ok`;
            const cancelId = `${alertId}-cancel`;
            pendingFlowkeyAlerts.set(okId, () => resolve(true));
            pendingFlowkeyAlerts.set(cancelId, () => resolve(false));
            const timeout = setTimeout(() => {
              if (pendingFlowkeyAlerts.has(okId)) {
                pendingFlowkeyAlerts.delete(okId);
                pendingFlowkeyAlerts.delete(cancelId);
                resolve(false);
              }
            }, 120_000);
            timeout.unref?.();
            return showAlert(ctx, {
              title: String(call.title ?? ""),
              message: call.message,
              primaryAction: { title: call.confirmTitle ?? "Confirm", onAction: okId },
              dismissAction: { title: call.cancelTitle ?? "Cancel", onAction: cancelId },
            });
          });
        default:
          throw new Error(`FlowKey native method ${method} is not implemented yet`);
      }
    },

    // --- OAuth PKCE redirect service --------------------------------------------------------
    // The redirect goes to `raycast.com/redirect` (registered by every extension's provider —
    // a loopback URI is rejected with "Not matching configuration"). While the sign-in page is
    // open, the backend watches the clipboard for the copied redirect URL and completes the
    // handshake when its `state` matches (see ensureOAuthClipboardPolling).
    async "oauth.redirectOrigin"() {
      return { redirectURI: "https://raycast.com/redirect?packageName=Extension" };
    },    async "oauth.authorize"(ctx, params) {
      // Headless runs (test harness) have no real UI: fail fast instead of spawning a browser.
      if (transport && !overriddenHandlers.has("open")) {
        throw new Error("OAuth sign-in is unavailable in headless mode");
      }
      const key = String(ctx.extensionId ?? ctx.extension?.uuid ?? "unknown");
      const pending = oauthPendingByExtension.get(key);
      if (pending) return pending;
      const flow = (async () => {
        const url = String(params.url ?? "");
        await hostHandlers["open"](ctx, { path: url });
        try {
          await hostHandlers.showToast(ctx, {
            title: "Sign in in the browser",
            message: "After signing in, copy the page URL (Ctrl+L, Ctrl+C) to finish connecting.",
          });
        } catch {
          /* background launches refuse toasts — the flow continues regardless */
        }
        ensureOAuthClipboardPolling();
        return { authorizationCode: await waitForOAuthRedirect(String(params.state ?? "")) };
      })();
      oauthPendingByExtension.set(key, flow);
      try {
        return await flow;
      } finally {
        oauthPendingByExtension.delete(key);
      }
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

      // The store's classification gate: disabled commands never reach a worker.
      if (launchGate) await launchGate(extension, command);

      // FlowKey extensions declare themselves with a root manifest.json (@raycast ones with a
      // package.json) and run in the FlowKey worker against the @flowkey-mini library.
      const flowkeyManifestPath = path.join(P.extensionDir(extension.uuid), "manifest.json");
      const isFlowkey = fs.existsSync(flowkeyManifestPath);
      const flowkeyManifest = isFlowkey
        ? JSON.parse(fs.readFileSync(flowkeyManifestPath, "utf-8"))
        : null;

      const isDevelopment = Boolean(debug);
      const worker = takeFromPool(isDevelopment, isFlowkey ? "fk" : "ray") ?? createWorker({ isDevelopment, flowkey: isFlowkey });
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
        launchContext: params.launchContext ?? props?.launchContext ?? null,
        assetsPath: extension.assetsPath ?? P.assetsPath(extension),
        supportPath: P.extensionDir(extension.uuid),
        commandPath: P.commandEntry(extension, command),
        flowkeyManifest,
        query: props?.query ?? "",
        filterValue: props?.filterValue ?? null,
      };

      worker.onNotify(async (method, notificationParams) => {
        const handler = notifyTable[method];
        if (handler) await handler({ ...context, worker }, notificationParams ?? {});
      });

      try {
        if (isFlowkey) {
          await worker.initialize({
            ...context,
            flowkey: {
              bundlePath: path.join(P.extensionDir(extension.uuid), flowkeyManifest.entry ?? "main.js"),
              manifest: flowkeyManifest,
            },
          });
        } else {
          await worker.initialize(context);
        }
      } catch (error) {
        await worker.unload();
        sessions.delete(worker.id);
        activeSessions.delete(sessionId);
        throw error;
      }

      if (context.entryPointMode === "no-view" && !isFlowkey) {
        // `if (mode === "no-view" && !deferNoViewUnload) unload()` in Raycast. FlowKey background
        // commands park until their work finishes — the worker decides when it is done.
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
      // FlowKey alert.confirm buttons resolve backend-side, not in the extension's registry.
      const pendingAlert = pendingFlowkeyAlerts.get(params.callbackId);
      if (pendingAlert) {
        pendingFlowkeyAlerts.delete(params.callbackId);
        pendingAlert();
        return undefined;
      }
      const workerId = activeSessions.get(params.sessionId);
      if (!workerId) throw new Error(`no worker for session ${params.sessionId}`);
      const worker = sessions.get(workerId);
      return worker.nativeCallback(params.callbackId, params.data);
    },

    async getInstalledNodeExtensionSummaries() {
      // The store's per-command classification rides along (badge + disabled reasons) so root
      // search can grey out disabled commands; extensions with no classification simply lack it.
      let compat = null;
      try {
        compat = storeHandlers.getSummariesCompat?.()?.compat ?? null;
      } catch {
        compat = null;
      }
      return { extensions: await allExtensions(), compat };
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
  // Host handlers replaced via overrideHostHandler (tests stub native side effects like `open`).
  const overriddenHandlers = new Set();
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

      // Store (`store.*`): catalog, install/update/uninstall, classifications, command
      // preferences — all persisted in this process (store.sqlite under the data dir).
      if (method.startsWith("store.")) {
        const handler = storeHandlers[method.slice("store.".length)];
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
    /** Install the store handler table (catalog, install, classifications, preferences). */
    registerStoreHandler(handlers) {
      storeHandlers = handlers ?? {};
    },
    /** Install the launch gate (the store's classification check); throwing refuses a launch. */
    setLaunchGate(gate) {
      launchGate = gate ?? null;
    },
    /** Replace one host handler (tests stub native side effects like `open` this way). */
    overrideHostHandler(name, handler) {
      hostHandlers[name] = handler;
      overriddenHandlers.add(name);
    },
  };
}

module.exports = { createBackend };
