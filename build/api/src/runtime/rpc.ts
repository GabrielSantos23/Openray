// The extension-side JSON-RPC transport.
//
// Mirrors `api/node_modules/@raycast/api/index.js` in Raycast 2.4.0.0:
//
//   var Hs = require("worker_threads");
//   Hs.parentPort?.on("message", async (e) => { … case "request" … case "result" … });
//   function FM(method, params, cb) {
//     setImmediate(() => {
//       if (cb) { let n = ot(); cC.set(n, cb);
//                 Hs.parentPort?.postMessage({ kind: "request", id: n, method, params }); }
//       else    Hs.parentPort?.postMessage({ kind: "notify",  method, params });
//     });
//   }
//
// i.e. an extension never talks to Raycast directly. It runs in a Node worker thread and
// every call into Raycast is a message over its `parentPort`.

import { parentPort } from "node:worker_threads";

export type Json = unknown;

export interface RpcMessage {
  kind: "request" | "notify" | "result";
  id?: number;
  method?: string;
  params?: Json;
  result?: { success: boolean; value?: Json; error?: unknown };
}

type ResultHandler = (result: { success: boolean; value?: unknown; error?: unknown }) => void;

const requestHandlers = new Map<string, (params: any) => unknown>();
const pendingResults = new Map<number, ResultHandler>();
let nextId = 1;

/** Register a host-initiated method the extension implements (initialize / nativeCallback / terminate). */
export function registerMethod(method: string, handler: (params: any) => unknown): void {
  requestHandlers.set(method, handler);
}

/** Fire-and-forget call into Raycast. */
export function notify(method: string, params: Json): void {
  queueMicrotask(() => {
    parentPort?.postMessage({ kind: "notify", method, params });
  });
}

/** Promise-returning call into Raycast. */
export function request<T = unknown>(method: string, params: Json = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pendingResults.set(id, (result) => {
      if (!result.success) reject(result.error ?? new Error(`${method} failed`));
      else resolve(result.value as T);
    });
    queueMicrotask(() => {
      parentPort?.postMessage({ kind: "request", id, method, params });
    });
  });
}

function serializeValue(value: unknown): unknown {
  // Functions/promises cannot cross the structured clone boundary.
  if (value instanceof Promise) return "[Promise]";
  if (typeof value === "function") return "[Function]";
  return value;
}

/** Start listening. Idempotent. */
export function startRpc(): void {
  parentPort?.on("message", async (message: RpcMessage) => {
    const { kind, id, method, params } = message;
    if (!kind || !id) return;
    if (kind === "request") {
      const handler = method ? requestHandlers.get(method) : undefined;
      try {
        const value = handler ? await handler(params) : undefined;
        parentPort?.postMessage({
          kind: "result",
          id,
          result: { success: true, value: serializeValue(value) },
        });
      } catch (error) {
        parentPort?.postMessage({ kind: "result", id, result: { success: false, error } });
      }
    } else if (kind === "result") {
      const handler = pendingResults.get(id);
      pendingResults.delete(id);
      handler?.(message.result!);
    }
  });
}
