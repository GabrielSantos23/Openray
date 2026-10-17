// The extension host proper: worker pool + handler tables + named-pipe transport.
//
// Mirrors Raycast's `backend/index.mjs` where the shapes match: one worker per running command,
// pool keyed dev/prod, worker message loop routes Notify/Request/Result, and the
// `z.frontend.extensionHost.<method>` renderer-facing handler table.

"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");
const { exec } = require("node:child_process");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const flowkeyVault = require("./flowkey-vault");


/** Mirrors `kn(e)` / `yq(e,t,n)` / `Fd()` from Raycast's backend. */
function paths(options) {
  return {
    configRoot: path.join(
      process.env.LOCALAPPDATA ?? process.env.HOME ?? ".",
      "Openray",
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
  const dataRoot = options.dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  const sessions = new Map(); // workerId -> { worker, context }
  const activeSessions = new Map(); // sessionId -> workerId
  const pool = { "fk-dev": [], "fk-prod": [] };
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
  let advancedHandlers = {};
  let notesHandlers = {};
  let storeHandlers = {};
  let settingsStoreHandlers = {};
  // Set by index.js to a launch gate; loadCommand refuses commands the gate rejects.
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
    // The store's per-command classification used to ride on every summary (badge + one-line
    // reason for greyed-out commands); the Store is gone, so summaries simply never carry one.
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        // FlowKey extensions declare manifest.json (commands keyed by `id`); both kinds land in
        // the same summary shape the renderer consumes.
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
            preferences: fk.preferences ?? [],
            isFlowkey: true,
          });
          continue;
        }
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

  const FLOWKEY_WORKER_ENTRY = path.resolve(__dirname, "..", "..", "flowkey", "worker", "dist", "flowkey-worker.js");

  function createWorker({ isDevelopment = false } = {}) {
    const workerId = `w_${Math.random().toString(36).slice(2, 10)}`;
    const callbacks = new Map();
    let context = null;
    let terminated = false;
    let nextId = 1;
    const kind = "fk";

    const worker = new Worker(FLOWKEY_WORKER_ENTRY, {
      workerData: { extensionsRoot: options.extensionsRoot, isDevelopment },
      env: { ...process.env, NODE_ENV: isDevelopment ? "development" : "production" },
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
      async setSearchState(params) {
        return sendRequest("setSearchState", params);
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
    async closeMainOpenrayWindow(ctx, params) {
      return toRenderer("extensionHost.closeMainOpenrayWindow", { ...params, sessionId: ctx.worker.id });
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
    // `window.launchCommand` never reaches the backend: the worker relaunches its own component
    // (same-extension push, M5b). Cross-extension launches would need a real route here.

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
          const headers = { ...(call.headers ?? {}) };
          if (call.auth) {
            // Token injection: the vault adds the Authorization header backend-side; the token
            // itself never crosses the extension bridge.
            const provider = String(call.auth);
            if (!(ctx.flowkeyManifest?.oauth ?? []).includes(provider)) {
              throw new Error(`http.fetch: provider ${provider} is not declared in the manifest oauth list`);
            }
            const tokens = await flowkeyVault.getValidToken(dataRoot, provider);
            if (!tokens) throw new Error(`http.fetch: provider ${provider} is not signed in; run oauth.authorize first`);
            headers.Authorization = `Bearer ${tokens.accessToken}`;
          }
          const response = await fetch(url, {
            method: call.method ?? "GET",
            headers,
            body: call.body,
            signal: AbortSignal.timeout(Math.min(Math.max(Number(call.timeoutMs) || 30_000, 1_000), 30_000)),
          });
          const bodyText = await response.text();
          return { status: response.status, headers: Object.fromEntries(response.headers.entries()), bodyText };
        }
        case "clipboard.read":
          return hostHandlers.getClipboard(ctx).then((value) => ({ text: value?.value ?? null }));
        case "clipboard.write":
          return hostHandlers.setClipboard(ctx, { text: String(call.text ?? "") });
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
          return hostHandlers.open(ctx, { path: String(call.url ?? call.path ?? "") });
        case "shell.revealPath":
          return dispatch("backend", "shell.revealFile", { path: String(call.path ?? "") });
        case "apps.list": {
          const payload = await dispatch("backend", "applications.getAll", {});
          const apps = payload?.value ?? [];
          return { apps: apps.map((app) => ({ id: app.id ?? app.path, name: app.name })) };
        }
        case "hud.show":
          return hostHandlers.showHUD(ctx, { title: String(call.title ?? "") });
        case "toast.show":
          return hostHandlers.showToast(ctx, { title: String(call.title ?? ""), message: call.message, style: call.style === "failure" ? "failure" : "success" });
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
            return hostHandlers.showAlert(ctx, {
              title: String(call.title ?? ""),
              message: call.message,
              primaryAction: { title: call.confirmTitle ?? "Confirm", onAction: okId },
              dismissAction: { title: call.cancelTitle ?? "Cancel", onAction: cancelId },
            });
          });
        case "secrets.get":
          return { value: readSecrets(ctx)[String(call.key)] ?? null };
        case "secrets.set":
          return writeSecrets(ctx, { ...readSecrets(ctx), [String(call.key)]: String(call.value ?? "") });
        case "secrets.delete": {
          const secrets = { ...readSecrets(ctx) };
          delete secrets[String(call.key)];
          return writeSecrets(ctx, secrets);
        }
        case "oauth.redirectUri": {
          // The exact loopback callback URL the user must register in the provider dashboard —
          // Spotify compares the redirect_uri string exactly ("Not matching configuration").
          const provider = String(call.provider ?? "spotify");
          if (!(ctx.flowkeyManifest?.oauth ?? []).includes(provider)) {
            throw new Error(`oauth provider ${provider} is not declared in the manifest`);
          }
          return { redirectUri: flowkeyVault.redirectUriOf(flowkeyVault.loadProviderConfig(dataRoot, provider)) };
        }
        case "oauth.authorize":
        case "oauth.status":
        case "oauth.disconnect":
          return hostHandlers[method](ctx, call);
        case "image.fetch": {
          const url = String(call.url ?? "");
          let imgHost;
          try { imgHost = new URL(url).hostname; } catch { throw new Error(`image.fetch: invalid url ${url}`); }
          const hosts = ctx.flowkeyManifest?.httpHosts ?? [];
          const allowed = hosts.some((declared) =>
            declared.startsWith(".") ? imgHost.endsWith(declared.slice(1)) || imgHost === declared.slice(1) : imgHost === declared,
          );
          if (!allowed) throw new Error(`image.fetch: ${imgHost} is not in the manifest httpHosts`);
          const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error(`image.fetch: HTTP ${response.status} for ${url}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          const hash = crypto.createHash("sha1").update(url).digest("hex");
          const ext = (url.split("?")[0].match(/\.(png|jpe?g|webp|gif)$/i) ?? [])[1] ?? "jpg";
          const cacheDir = path.join(dataRoot, "oauth", "image-cache");
          fs.mkdirSync(cacheDir, { recursive: true });
          const file = path.join(cacheDir, `${hash}.${ext}`);
          if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
          // The renderer loads images through the `openray-img` virtual host (mapped by the
          // C# main window onto this cache folder) — plain URLs keep the render tree small,
          // where per-item data: URIs OOM the worker on library-sized artwork sets.
          return { ok: true, uri: `https://openray-img/${hash}.${ext}` };
        }
        case "media.current":
          // SMTC snapshot / transport control: the C# host owns the WinRT session manager, the
          // same split as clipboard and fileSystem routes.
          return dispatch("backend", "media.current", {});
        case "media.control":
          return dispatch("backend", "media.control", { command: String(call.command ?? "") });
        default:
          throw new Error(`FlowKey native method ${method} is not implemented yet`);
      }
    },

    // --- OAuth vault (M5a): BYO client id + loopback PKCE; tokens never reach the extension ---
    async "oauth.authorize"(ctx, params) {
      const provider = String(params.provider ?? "");
      if (!(ctx.flowkeyManifest?.oauth ?? []).includes(provider)) {
        throw new Error(`oauth provider ${provider} is not declared in the manifest`);
      }
      // Headless runs (test harness) have no real UI: fail fast instead of spawning a browser.
      if (transport && !overriddenHandlers.has("open")) {
        throw new Error("OAuth sign-in is unavailable in headless mode");
      }
      return flowkeyVault.authorize(dataRoot, provider, {
        clientIdOverride: params.clientId ? String(params.clientId) : undefined,
        open: (url) => hostHandlers.open(ctx, { path: url }),
      });
    },
    async "oauth.status"(ctx, params) {
      const provider = String(params.provider ?? "");
      if (!(ctx.flowkeyManifest?.oauth ?? []).includes(provider)) {
        throw new Error(`oauth provider ${provider} is not declared in the manifest`);
      }
      return flowkeyVault.statusShape(await flowkeyVault.getValidToken(dataRoot, provider));
    },
    async "oauth.disconnect"(ctx, params) {
      const provider = String(params.provider ?? "");
      if (!(ctx.flowkeyManifest?.oauth ?? []).includes(provider)) {
        throw new Error(`oauth provider ${provider} is not declared in the manifest`);
      }
      flowkeyVault.vaultClear(dataRoot, provider);
      return { ok: true };
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

  /** Per-extension secrets (`secrets.*` capability), stored under the data dir's oauth folder. */
  function secretsFile(ctx) {
    return path.join(dataRoot, "oauth", "secrets", `${ctx.extensionId ?? ctx.extension?.uuid ?? "unknown"}.json`);
  }

  function readSecrets(ctx) {
    try {
      return JSON.parse(fs.readFileSync(secretsFile(ctx), "utf-8"));
    } catch {
      return {};
    }
  }

  function writeSecrets(ctx, secrets) {
    fs.mkdirSync(path.dirname(secretsFile(ctx)), { recursive: true });
    fs.writeFileSync(secretsFile(ctx), JSON.stringify(secrets, null, 2));
    return {};
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

      // Extensions declare themselves with a root manifest.json and run in the FlowKey worker
      // against the @flowkey-mini library. The api shim is gone (M4) — an extension without a
      // manifest is a typed error, never a silent fallback.
      const flowkeyManifestPath = path.join(P.extensionDir(extension.uuid), "manifest.json");
      if (!fs.existsSync(flowkeyManifestPath)) {
        throw new Error(`extension ${extension.uuid} has no manifest.json; only FlowKey extensions are supported`);
      }
      const flowkeyManifest = JSON.parse(fs.readFileSync(flowkeyManifestPath, "utf-8"));

      const isDevelopment = Boolean(debug);
      const worker = takeFromPool(isDevelopment, "fk") ?? createWorker({ isDevelopment });
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
        await worker.initialize({
          ...context,
          flowkey: {
            bundlePath: path.join(P.extensionDir(extension.uuid), flowkeyManifest.entry ?? "main.js"),
            manifest: flowkeyManifest,
          },
        });
      } catch (error) {
        await worker.unload();
        sessions.delete(worker.id);
        activeSessions.delete(sessionId);
        throw error;
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
      // `compat` (the store's per-command classification) is gone with the Store; root search
      // treats every installed extension as launchable.
      return { extensions: await allExtensions(), compat: null };
    },

    // An installed extension's manifest icon as a data URL (re-homed from the Store's
    // `store.getIcon`); `iconName` carries FlowKey lucide icon names for the OpenrayIcon fallback,
    // `emoji` carries manifest icons declared as emoji (e.g. the Spotify "🎧").
    // NOTE: extensionHost handlers are invoked with `(data)` — a `(ctx, params)` signature here
    // silently read `params` as undefined and disabled every extension icon.
    async getExtensionIcon(params) {
      const uuid = String(params?.uuid ?? "");
      if (!uuid || uuid.includes("..") || uuid.includes("/") || uuid.includes("\\")) {
        return { icon: null, iconName: null, emoji: null };
      }
      const dir = P.extensionDir(uuid);
      let icon = "";
      let iconName = null;
      for (const manifestName of ["package.json", "manifest.json"]) {
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestName), "utf-8"));
          icon = String(manifest.icon ?? "");
          if (typeof manifest.iconName === "string") iconName = manifest.iconName;
          break;
        } catch {
          /* try the other manifest kind */
        }
      }
      if (!icon) return { icon: null, iconName, emoji: null };
      if (!icon.includes("..") && !path.isAbsolute(icon) && !/[\\/]/.test(icon) && !icon.includes(".")) {
        return { icon: null, iconName, emoji: icon };
      }
      if (icon.includes("..") || path.isAbsolute(icon)) return { icon: null, iconName, emoji: null };
      for (const candidate of [path.join(dir, "assets", icon), path.join(dir, icon)]) {
        try {
          const bytes = fs.readFileSync(candidate);
          const lower = candidate.toLowerCase();
          const mime = lower.endsWith(".svg") ? "image/svg+xml"
            : lower.endsWith(".png") ? "image/png"
            : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
            : lower.endsWith(".ico") ? "image/x-icon"
            : "application/octet-stream";
          return { icon: `data:${mime};base64,${bytes.toString("base64")}`, iconName, emoji: null };
        } catch {
          /* try next */
        }
      }
      return { icon: null, iconName, emoji: null };
    },

    // Search-bar push from the renderer: the running command re-renders with the new
    // query/filterValue (Raycast's launchProps.searchText semantics).
    async setSearchState(params) {
      const workerId = activeSessions.get(params.sessionId);
      if (!workerId) throw new Error(`no worker for session ${params.sessionId}`);
      const worker = sessions.get(workerId);
      return worker.setSearchState({ query: params.query, filterValue: params.filterValue });
    },

    // FlowKey extension preferences persist BACKEND-side (`<dataRoot>/flowkey-preferences.json`),
    // not in localStorage: the Settings window is a separate WebView2 profile, so values typed
    // there never reached the main window that launches extensions (the Spotify client id bug).
    async getFlowkeyPreferences(params) {
      try {
        const all = JSON.parse(fs.readFileSync(path.join(dataRoot, "flowkey-preferences.json"), "utf-8"));
        return { values: all[String(params?.uuid ?? "")] ?? {} };
      } catch {
        return { values: {} };
      }
    },
    async setFlowkeyPreference(params) {
      const uuid = String(params?.uuid ?? "");
      const name = String(params?.name ?? "");
      if (!uuid || !name) throw new Error("setFlowkeyPreference: uuid and name are required");
      let all = {};
      try {
        all = JSON.parse(fs.readFileSync(path.join(dataRoot, "flowkey-preferences.json"), "utf-8"));
      } catch {
        /* first write */
      }
      all[uuid] = { ...(all[uuid] ?? {}), [name]: params?.value ?? null };
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(path.join(dataRoot, "flowkey-preferences.json"), JSON.stringify(all, null, 2));
      return { values: all[uuid] };
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
  // Failed reconnect attempts since the last successful connection (25 -> exit).
  let reconnectAttempts = 0;
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
      reconnectAttempts = 0;
      // Prove this connection was spawned by the current host: the bridge promotes the client
      // whose token matches and rejects stale-token zombies instead of letting one become primary.
      client.write(`${JSON.stringify({ type: "hello", token: process.env.OPENRAY_PIPE_TOKEN ?? "" })}` + "\n");
      console.log(`[backend] connected to launcher pipe "${options.pipeName}"`);
      connectedCallbacks.splice(0).forEach((resolve) => resolve(client));
    });
    client.on("error", (error) => {
      reconnectAttempts += 1;
      console.error(`[backend] pipe error: ${error.message} (attempt ${reconnectAttempts})`);
      // The host is gone for good when it stopped answering; a zombie backend would otherwise
      // reconnect forever (it holds no parent handle), so give up after a grace period.
      if (reconnectAttempts >= 150) {
        console.error("[backend] host unreachable after 150 attempts - exiting");
        process.exit(1);
      }
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
      if (method.startsWith("settings.")) {
        const handler = settingsStoreHandlers[method.slice("settings.".length)];
        if (handler) return handler(data ?? {});
      }

      if (method.startsWith("games.") || method.startsWith("taskbar.") || method.startsWith("advanced.")) {
        const table = method.startsWith("games.") ? gamesHandlers : method.startsWith("taskbar.") ? taskbarHandlers : advancedHandlers;
        const handler = table[method.slice(method.indexOf(".") + 1)];
        if (handler) return handler(data ?? {});
      }

      // Notes (`notes.*`): the store lives in this process; the launcher's Search Notes view and
      // the Notes window page both read through it.
      if (method.startsWith("notes.")) {
        const handler = notesHandlers[method.slice("notes.".length)];
        if (handler) return handler(data ?? {});
      }

      // Store (`store.*`): the new extension Store (GitHub catalog + uploads) first; any verb it
      // does not implement still fails with the typed removed-store error so stale callers
      // (old frontend bundle, saved hotkeys) surface honestly.
      if (method.startsWith("store.")) {
        const handler = storeHandlers[method.slice("store.".length)];
        if (handler) return handler(data ?? {});
        throw new Error(`${method}: the Raycast Store was removed; extensions are installed from the FlowKey library`);
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
    /** Install the extension-store handler table (`store.sync/list/detail/…`; the new Store). */
    registerStoreHandler(handlers) {
      storeHandlers = handlers ?? {};
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
    /** Install the settings store handler table. */
    registerSettingsStoreHandler(handlers) {
      settingsStoreHandlers = handlers ?? {};
    },
    /** Install the advanced handler table. */
    registerAdvancedHandler(handlers) {
      advancedHandlers = handlers ?? {};
    },
    /** Install the notes store handler table. */
    registerNotesHandler(handlers) {
      notesHandlers = handlers ?? {};
    },
    /** Install the launch gate (optional); throwing refuses a launch. */
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
