// `$c(e)` in Raycast — the "render" entry point.
//
//   async function $c(e){
//     let t = rd(e);                                        // shadow tree -> model
//     if (t.suspended) { … return await T("renderSuspense", {}); }
//     let r = AP(uh || {}, t);                              // diff vs. previous model
//     uh = t;
//     if (!r.hasChanges) return await T("renderEmpty", {});
//     let o = JSON.stringify({ model: t, changes: r.changes });
//     let n = jO(o);                                        // gzip + base64
//     return await T("render", n);                          // { renderTree, gzipped }
//   }
//
// `jO` gzips once the payload passes `byteThreshold`, and the schema is
// `render: { params: { renderTree: string, gzipped: boolean }, returns: unknown }`.

import { gzipSync } from "node:zlib";
import { EventEmitter } from "node:events";
import { createRoot, onCommit } from "./reconciler";
import { diffModels, toModel, type RenderModel } from "./model";
import { notify, request } from "./rpc";

const GZIP_BYTE_THRESHOLD = 16 * 1024; // Raycast's default `byteThreshold`
const GZIP_MIN_SAVINGS_RATIO = 0.1;

export const renderEvents = new EventEmitter();

let previousModel: RenderModel | null = null;
let previousWasSuspended = false;
let emptyRenderStreak = 0;
let warnedAboutLoop = false;
let inFlight: Promise<void> | null = null;

function encode(payload: string): { renderTree: string; gzipped: boolean } {
  const bytes = Buffer.byteLength(payload);
  if (bytes > GZIP_BYTE_THRESHOLD) {
    const compressed = gzipSync(Buffer.from(payload, "utf-8"));
    if (compressed.length < bytes * (1 - GZIP_MIN_SAVINGS_RATIO)) {
      return { renderTree: compressed.toString("base64"), gzipped: true };
    }
  }
  return { renderTree: payload, gzipped: false };
}

/** Serialise + diff + ship the current shadow tree. Serialised, with a dirty re-run. */
export function renderCurrent(root: { getShadowRoot(): any }): Promise<void> {
  dirty = true;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    while (dirty) {
      dirty = false;
      await renderOnce(root);
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let dirty = false;

async function renderOnce(root: { getShadowRoot(): any }): Promise<void> {
  const model = toModel(root.getShadowRoot());

    if (model.suspended) {
      previousWasSuspended = true;
      try {
        if (previousModel?.navigationStack?.body) previousModel.navigationStack.body.isLoading = true;
      } catch {
        /* ignore */
      }
      renderEvents.emit("suspense");
      await request("renderSuspense", {});
      return;
    }
    previousWasSuspended = false;

    const diff = diffModels(previousModel, model);
    previousModel = model;

    if (!diff.hasChanges) {
      emptyRenderStreak += 1;
      if (emptyRenderStreak > 20 && !warnedAboutLoop) {
        warnedAboutLoop = true;
        console.warn(
          "Looks like the command is rendering a lot without any changes. This might indicate a " +
            "rendering loop caused by a `setState` not being wrapped in a `useEffect`.",
        );
      }
      renderEvents.emit("did-render", { empty: true });
      await request("renderEmpty", {});
      return;
    }

    emptyRenderStreak = 0;
    warnedAboutLoop = false;

    const payload = JSON.stringify({ model, changes: diff.changes });
    const encoded = encode(payload);
    renderEvents.emit("did-render", { empty: false });
    await request("render", encoded);
}

export function createCommandRoot(extensionElement: unknown) {
  const root = createRoot(extensionElement as any);

  // Raycast's `$c(e)` is the render entry point; it runs after every React commit.
  const unsubscribe = onCommit(() => {
    void renderCurrent(root);
  });

  return {
    render(node: unknown) {
      root.render(node as any);
    },
    async unmount() {
      unsubscribe();
      await root.unmount();
    },
    flush() {
      return renderCurrent(root);
    },
    getShadowRoot() {
      return root.getShadowRoot();
    },
  };
}

/** Push the navigation state (used by `push` / `popToRoot`). */
export function setNavigationInfo(root: { getShadowRoot(): any }, info: { id: string | null; action: string }) {
  const shadowRoot = root.getShadowRoot();
  shadowRoot.navigationInfo = info;
}

export function setOnPopCallback(root: { getShadowRoot(): any }, callbackId: string | undefined) {
  const shadowRoot = root.getShadowRoot();
  shadowRoot.onPopCallbackId = callbackId;
}

void notify;
