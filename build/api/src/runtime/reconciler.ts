// Raycast's extension UI is rendered headlessly.
//
// From `api/node_modules/@raycast/api/index.js`:
//
//   const K = Reconciler(hostConfig);                  // react-reconciler with a custom host config
//   K.createContainer(element, ConcurrentRoot, …)
//   K.updateContainer(<Providers>{element}</Providers>, container, null, cb)
//
// The host config's host components are named after Raycast's own view kinds:
//
//   ray-navigation-stack, ray-list, ray-grid, ray-form, ray-detail, ray-menu-bar-extra
//
// `createInstance` returns a plain "shadow node" `{ name, props, childElements }`, and the finished
// shadow tree is converted to a serialisable JSON model (`rd` / `iP` / `hee` below). Nothing here
// touches a DOM — the real HTML is produced later, by the launcher renderer.

import * as React from "react";
// react-reconciler is CommonJS (`module.exports = reconciler`), so take the namespace and fall back
// to `.default` when it is interop-wrapped.
import * as ReactReconciler from "react-reconciler";

const Reconciler: any = (ReactReconciler as any).default ?? ReactReconciler;

export interface ShadowNode {
  name: string;
  props: Record<string, unknown>;
  childElements: ShadowNode[];
  /** Text children, joined at commit time. */
  textContent?: string;
  /** When true the props hold an action table (callbackId -> callback registration). */
  actionSlot?: "actions";
}

export interface ShadowRoot extends ShadowNode {
  name: "__root__";
  navigationInfo: { id: string | null; action: string };
  onPop?: (id: string) => void;
}

/** Callback registry: extension-side functions keyed by an id that survives JSON. */
const callbackRegistry = new Map<string, (...args: unknown[]) => unknown>();

export function registerCallback(id: string, fn: (...args: unknown[]) => unknown): void {
  callbackRegistry.set(id, fn);
}

export function resolveCallback(id: string) {
  return callbackRegistry.get(id);
}

export function serializeCallback(fn: (...args: unknown[]) => unknown): string {
  const id = `cb_${Math.random().toString(36).slice(2, 10)}`;
  registerCallback(id, fn);
  return id;
}

// Props that describe layout/visuals — everything else (functions, class instances, symbols) is
// dropped, exactly like Raycast does, because the model is shipped as JSON.
const SKIP_PROPS = new Set(["children", "key", "ref"]);

function collectProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (SKIP_PROPS.has(key)) continue;
    if (typeof value === "function") continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "symbol") continue;
    try {
      JSON.stringify(value);
      out[key] = value;
    } catch {
      /* not serialisable -> drop, as Raycast does */
    }
  }
  return out;
}

const hostConfig: any = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  // react-reconciler 0.29 additions
  supportsMicrotasks: false,
  getCurrentEventPriority: () => 16 /* DefaultEventPriority */,
  scheduleMicrotask: (fn: () => void) => {
    queueMicrotask(fn);
  },
  detachDeletedInstance: () => {},
  preparePortalMount: () => {},
  scheduleTimeout: (fn: () => void, delay?: number) => setTimeout(fn, delay),
  cancelTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  noTimeout: -1,
  getInstanceFromNode: () => null,

  createInstance(type: string, props: Record<string, unknown>): ShadowNode {
    return { name: type, props: collectProps(props), childElements: [] };
  },

  createTextInstance(text: string): ShadowNode {
    return { name: "#text", props: { text }, childElements: [] };
  },

  appendInitialChild(parent: ShadowNode, child: ShadowNode) {
    parent.childElements.push(child);
  },

  appendChild(parent: ShadowNode, child: ShadowNode) {
    parent.childElements.push(child);
  },

  appendChildToContainer(container: ShadowRoot, child: ShadowNode) {
    container.childElements.push(child);
  },

  insertBefore(parent: ShadowNode, child: ShadowNode, before: ShadowNode) {
    const index = parent.childElements.indexOf(before);
    parent.childElements.splice(index < 0 ? parent.childElements.length : index, 0, child);
  },

  insertInContainerBefore(container: ShadowRoot, child: ShadowNode, before: ShadowNode) {
    const index = container.childElements.indexOf(before);
    container.childElements.splice(index < 0 ? container.childElements.length : index, 0, child);
  },

  removeChild(parent: ShadowNode, child: ShadowNode) {
    const index = parent.childElements.indexOf(child);
    if (index >= 0) parent.childElements.splice(index, 1);
  },

  removeChildFromContainer(container: ShadowRoot, child: ShadowNode) {
    const index = container.childElements.indexOf(child);
    if (index >= 0) container.childElements.splice(index, 1);
  },

  commitUpdate(instance: ShadowNode, _type: string, oldProps: any, newProps: any) {
    instance.props = collectProps(newProps);
  },

  commitTextUpdate(instance: ShadowNode, _oldText: string, newText: string) {
    instance.props.text = newText;
  },

  prepareUpdate() {
    return true;
  },

  shouldSetTextContent() {
    return false;
  },

  getRootHostContext() {
    return null;
  },

  getChildHostContext(parentHostContext: unknown) {
    return parentHostContext;
  },

  getPublicInstance(instance: ShadowNode) {
    return instance;
  },

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    /* no-op: no DOM to commit into */
  },

  finalizeInitialChildren() {
    return false;
  },

  clearContainer(container: ShadowRoot) {
    container.childElements.length = 0;
  },
};

export const HeadlessReconciler: any = Reconciler(hostConfig);

/** The root host element handed to `createContainer`. */
export function createShadowRoot(): ShadowRoot {
  return {
    name: "__root__",
    props: {},
    childElements: [],
    navigationInfo: { id: null, action: "idle" },
  };
}

let containers = new WeakMap<object, any>();

/** Invoked after every host commit; `render.ts` uses this to ship the model. */
const commitListeners = new Set<() => void>();

export function onCommit(listener: () => void): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

export function createRoot(element: React.ReactElement) {
  const shadowRoot = createShadowRoot();
  const container = HeadlessReconciler.createContainer(
    shadowRoot,
    1 /* ConcurrentRoot */,
    false,
    null,
    false,
    "",
    console.error,
    null,
  );
  containers.set(shadowRoot, container);

  // Raycast wraps every tree in the same two providers (selected item + loading state), so that
  // `List`/`Grid` can read them through context.
  return {
    render(node: React.ReactNode) {
      // React commits asynchronously, so the serialisation must be triggered from the
      // `updateContainer` callback — never from right after the call.
      HeadlessReconciler.updateContainer(
        React.createElement(
          SelectedItemContext.Provider,
          { value: undefined },
          React.createElement(LoadingContext.Provider, { value: false }, node),
        ),
        container,
        null,
        () => {
          // React commits asynchronously, so serialisation must be triggered from here, never
          // straight after the `updateContainer` call.
          for (const listener of commitListeners) listener();
        },
      );
    },
    async unmount() {
      HeadlessReconciler.updateContainer(null, container, null, () => undefined);
    },
    getShadowRoot() {
      return shadowRoot;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Contexts, matching Raycast's `dh.Provider` (selectedItem) and `Qw.Provider` (isLoading)
// ---------------------------------------------------------------------------------------------

export const SelectedItemContext = React.createContext<any>(undefined);
export const LoadingContext = React.createContext<boolean>(false);
