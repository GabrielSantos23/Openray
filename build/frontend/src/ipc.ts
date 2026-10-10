// Renderer <-> host IPC, ported from Raycast's frontend bundle
// (`register-query-client-*.js` / `main-window-*.js`):
//
//   class Bt {
//     ipcRequest = window.chrome.webview.hostObjects.ipcRequest;
//     constructor(handlers, notificationCenter) {
//       window.chrome?.webview?.addEventListener("message", this.handleMessage);
//     }
//     async request(module, method, params, timeout, trace) {
//       let payload = params === undefined ? "" : this.messageProcessor.safeStringify(params, "request");
//       let response = await this.ipcRequest.postMessage(method, payload, module === "backend", timeout ?? -1, …);
//       return this.messageProcessor.safeParse(response, "response");
//     }
//   }
//
// and the extension-facing wrappers the launcher itself uses:
//
//   ipc.backend.extensionHost.loadCommand(…)   -> dispatchRequest("backend", "extensionHost.loadCommand", …)
//   ipc.backend.extensionHost.unloadEntryPoint(…)
//   ipc.backend.extensionHost.callNodeCallback(…)
//
// Host -> renderer messages arrive through `chrome.webview` message events and are dispatched to
// the per-module notification centre (Raycast's `notificationCenter.process(method, data)`).

export type IpcModule = "backend" | "frontend";

export interface IpcEnvelope<T = unknown> {
  module: IpcModule;
  method: string;
  data: T;
}

type Handler = (data: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

/**
 * Diagnostics surface the host can read with `ExecuteScriptAsync`. Raycast ships the equivalent
 * hookup in its own bridge; here it exists so the launcher can report why IPC looks dead.
 */
interface MiniDiag {
  hostObjectPresent: boolean;
  postMessageAvailable: boolean;
  readyAt: number | null;
  requests: Array<{ method: string; ok: boolean; detail?: string }>;
  responses?: Array<{ method: string; preview: string }>;
}

const diagnostics: MiniDiag = {
  hostObjectPresent: false,
  postMessageAvailable: false,
  readyAt: null,
  requests: [],
};

(window as unknown as { __raycastMiniDiag: MiniDiag }).__raycastMiniDiag = diagnostics;

function chromeBridge(): { webview?: { hostObjects?: { ipc?: { postMessage?: unknown } } } } | undefined {
  return (window as unknown as { chrome?: { webview?: { hostObjects?: { ipc?: { postMessage?: unknown } } } } })
    .chrome;
}

function hasHostObject(): boolean {
  const ipc = chromeBridge()?.webview?.hostObjects?.ipc;
  diagnostics.hostObjectPresent = Boolean(ipc);
  diagnostics.postMessageAvailable = typeof ipc?.postMessage === "function";
  return Boolean(ipc);
}

/** Subscribe to host-initiated messages (e.g. `extensionHost.render`). */
export function onNotification(method: string, handler: Handler): () => void {
  let set = listeners.get(method);
  if (!set) {
    set = new Set();
    listeners.set(method, set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

let hostObjectsReady: Promise<void> | null = null;

function waitForHostObjects(): Promise<void> {
  if (hostObjectsReady) return hostObjectsReady;
  hostObjectsReady = new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (hasHostObject()) {
        diagnostics.readyAt = Date.now() - started;
        resolve();
        return;
      }
      if (Date.now() - started > 10_000) {
        diagnostics.requests.push({ method: "__waitHostObjects", ok: false, detail: "timeout" });
        resolve(); // proceed and let individual calls fail with a clear message
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
  return hostObjectsReady;
}

/** `ipcRequest.postMessage(method, jsonParams, isBackend, timeoutMs, traceId, baggage)`. */
export async function ipcRequest<T = unknown>(
  method: string,
  params?: unknown,
  options: { module?: IpcModule; timeoutMs?: number } = {},
): Promise<T> {
  await waitForHostObjects();
  const entryCounter = (window as unknown as { __ipcEntries?: number });
  entryCounter.__ipcEntries = (entryCounter.__ipcEntries ?? 0) + 1;
  const ipcHostObject = chromeBridge()?.webview?.hostObjects?.ipc;
  if (!ipcHostObject) {
    diagnostics.requests.push({ method, ok: false, detail: "no host object" });
    throw new Error("Raycast Mini host objects are unavailable (is the page served over the mapped virtual host?)");
  }

  const chrome = chromeBridge()!;
  const payload = params === undefined ? "" : JSON.stringify(params);
  let raw: string;
  try {
    raw = await (ipcHostObject.postMessage as (
      m: string,
      p: string,
      b: boolean,
      t: number,
      a: string,
      g: string,
    ) => Promise<string>)(
      method,
      payload,
      (options.module ?? "backend") === "backend",
      options.timeoutMs ?? -1,
      "",
      "",
    );
  } catch (error) {
    diagnostics.requests.push({ method, ok: false, detail: String(error) });
    throw error;
  }

  const envelope = JSON.parse(raw);
  if (envelope && typeof envelope === "object" && "error" in envelope && envelope.error) {
    diagnostics.requests.push({ method, ok: false, detail: envelope.error.message ?? "ipc request failed" });
    throw new Error(envelope.error.message ?? "ipc request failed");
  }
  diagnostics.requests.push({ method, ok: true });
  // Keep a short preview of every response so shape mismatches (e.g. `{value:[]}` vs `[…]`)
  // are visible in launcher.log without a debugger.
  (diagnostics.responses ??= []).push({
    method,
    preview: typeof raw === "string" ? raw.slice(0, 200) : String(raw),
  });
  if (diagnostics.responses.length > 20) diagnostics.responses.shift();
  return envelope?.data as T;
}

/** Raw request. Mirrors Raycast's `dispatchRequest(module, method, params, …)`. */
export async function ipcRaw<T = unknown>(
  method: string,
  params?: unknown,
  options: { module?: IpcModule; timeoutMs?: number } = {},
): Promise<T> {
  return await ipcRequest<T>(method, params, options);
}

/** `dispatchRequest("backend", "extensionHost.<method>", …)` — same call shape as Raycast's frontend. */
export const ipc = {
  backend: Object.assign(
    (method: string, params?: unknown, options: { module?: IpcModule; timeoutMs?: number } = {}) =>
      ipcRaw(method, params, options),
    {
      extensionHost: {
        loadCommand: (params: unknown) => ipcRequest("extensionHost.loadCommand", params, { timeoutMs: 0 }),
        unloadEntryPoint: (params: unknown) => ipcRequest("extensionHost.unloadEntryPoint", params),
        callNodeCallback: (params: unknown) => ipcRequest("extensionHost.callNodeCallback", params),
        getInstalledNodeExtensionSummaries: () =>
          ipcRequest("extensionHost.getInstalledNodeExtensionSummaries"),
      },
    },
  ),
};

/**
 * Ask the launcher to hide its window (Raycast's `extensionHost.closeMainRaycastWindow`). Routed to
 * the native host (`module: "frontend"`), which owns the WPF window.
 */
export function closeMainWindow(): void {
  void ipcRequest("window.close", {}, { module: "frontend" }).catch(() => {
    /* the window may already be gone */
  });
}

/** Open Settings in its own OS window (`window.openSettings` -> host `SettingsWindow`). */
export function openSettings(): void {
  void ipcRequest("window.openSettings", {}, { module: "frontend" }).catch(() => {
    /* best-effort */
  });
}

export function installHostMessageListener(): void {
  (window as any).chrome?.webview?.addEventListener("message", (event: any) => {
    // `CoreWebView2.PostWebMessageAsJson` delivers `event.data` as an already-parsed object;
    // string payloads (e.g. `postMessage(JSON.stringify(...))` from the HUD page) still arrive
    // as strings. Parse only what needs parsing — `JSON.parse(object)` throws and would drop
    // every host push, which is why extension views used to hang on "Preparing view…".
    let envelope: IpcEnvelope;
    try {
      envelope = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    // A host-side navigation request (the Clipboard History global hotkey) carries a route
    // rather than an envelope, so it is normalised here and dispatched like any other message.
    const navigation = envelope as { route?: unknown } | null;
    if (navigation && typeof navigation === "object" && typeof navigation.route === "string") {
      for (const handler of listeners.get("raycast.mini.navigate") ?? []) {
        try {
          handler(navigation.route);
        } catch (error) {
          console.error("[ipc] navigate handler failed", error);
        }
      }
      return;
    }
    if (!envelope || typeof envelope !== "object" || typeof envelope.method !== "string") return;
    const set = listeners.get(envelope.method);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(envelope.data);
      } catch (error) {
        console.error(`[ipc] handler for ${envelope.method} failed`, error);
      }
    }
  });
}

/** Mirrors Raycast's `window.identifier` — which window is talking. */
export const windowIdentifier = "main";
