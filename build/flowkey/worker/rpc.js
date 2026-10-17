// Worker <-> backend JSON-RPC over the parentPort. Ported from the api-shim runtime's
// `runtime/rpc.ts` (same wire shape: registerMethod for host-initiated calls, request/notify for
// worker-initiated ones) so the backend's session machinery works with both worker kinds.
"use strict";

const { parentPort } = require("node:worker_threads");

const methods = new Map();
const pendingResults = new Map();
let nextId = 1;

/** Register a host-initiated method the worker implements (initialize / nativeCallback / terminate). */
function registerMethod(method, handler) {
  methods.set(method, handler);
}

/** Promise-returning call into the backend. */
function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pendingResults.set(id, (result) => {
      if (!result.success) {
        const message = typeof result.error === "string" ? result.error : (result.error?.message ?? `${method} failed`);
        const error = new Error(message);
        if (result.error?.stack) error.stack = result.error.stack;
        reject(error);
      } else resolve(result.value);
    });
    queueMicrotask(() => {
      parentPort?.postMessage({ kind: "request", id, method, params });
    });
  });
}

/** Fire-and-forget call into the backend. */
function notify(method, params = {}) {
  queueMicrotask(() => {
    parentPort?.postMessage({ kind: "notify", method, params });
  });
}

let started = false;

/** Start listening. Idempotent. */
function startRpc() {
  if (started) return;
  started = true;
  parentPort?.on("message", async (message) => {
    if (!message || typeof message !== "object") return;
    if (message.kind === "request") {
      const handler = methods.get(message.method);
      try {
        if (!handler) throw new Error(`no rpc method ${message.method}`);
        const value = await handler(message.params ?? {});
        parentPort?.postMessage({ kind: "result", id: message.id, result: { success: true, value } });
      } catch (error) {
        parentPort?.postMessage({
          kind: "result",
          id: message.id,
          // `{ message, stack }` — the backend's failure logger prints `error.stack` when present.
          result: {
            success: false,
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : { message: String(error) },
          },
        });
      }
      return;
    }
    if (message.kind === "result") {
      const pending = pendingResults.get(message.id);
      if (!pending) return;
      pendingResults.delete(message.id);
      pending(message.result ?? { success: false, error: "no result" });
    }
  });
}

module.exports = { registerMethod, request, notify, startRpc };
