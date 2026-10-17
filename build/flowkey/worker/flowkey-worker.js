// The FlowKey extension worker. One worker per running command (crash isolation), speaking the
// FlowKey contract to the backend over the worker RPC:
//
//   backend -> worker: initialize / nativeCallback / terminate (the same methods the previous
//                      api-shim worker answered, so the backend session machinery is shared)
//   worker -> backend: `render` pushes (UiTree already adapted to the ray-* model), `nativeCall`
//                      (capability calls — the backend enforces the manifest consent gate)
//
// The bundle/manifest arrive with the initialize payload (the backend reads them from the
// extension dir when it loads the command). Host globals are installed BEFORE the extension
// bundle import: the bundle's build-time shims (`react`, `@flowkey-mini/react-ui`,
// `@flowkey-mini/native-sdk`) read `globalThis.__FLOWKEY_HOST__`, so hooks and the serializer
// share this worker's single module instances.
"use strict";

const { workerData } = require("node:worker_threads");
const react = require("react");
const ReactJsxRuntime = require("react/jsx-runtime");
const reactUi = require("@flowkey-mini/react-ui");
const nativeSdk = require("@flowkey-mini/native-sdk");
const { registerMethod, request, notify, startRpc } = require("./rpc.js");
const { uiTreeToRenderModel } = require("./adapter.js");

globalThis.__FLOWKEY_HOST__ = {
  react,
  reactJsx: ReactJsxRuntime,
  reactUi: {
    List: reactUi.List,
    Detail: reactUi.Detail,
    Grid: reactUi.Grid,
    Form: reactUi.Form,
    ActionPanel: reactUi.ActionPanel,
    Action: reactUi.Action,
    defineReactExtension: reactUi.defineReactExtension,
    usePromise: reactUi.usePromise,
    useFetch: reactUi.useFetch,
    useDebounce: reactUi.useDebounce,
    useCachedState: reactUi.useCachedState,
    useLocalStorage: reactUi.useLocalStorage,
    useCachedPromise: reactUi.useCachedPromise,
    withCache: reactUi.withCache,
    Color: reactUi.Color,
    Icon: reactUi.Icon,
  },
  nativeSdk: {
    defineExtension: nativeSdk.defineExtension,
    createCapabilities: nativeSdk.createCapabilities,
    randomId: nativeSdk.randomId,
    captureException: nativeSdk.captureException,
  },
};

startRpc();

const abortController = new AbortController();
let root = null;
let registry = null;
let firstRender = true;
let context = null;
let manifest = null;

// Same-extension subview navigation (M5b). `Action push="…"`, `window.launchCommand(id)` and the
// renderer's onPop callback all relaunch this session's component with a different commandId while
// the renderer page stack pushes/pops — no second worker session is involved.
const POP_CALLBACK_ID = "__pop__";
let commandStack = [];
let pushTargets = new Map();
let pendingNav = null;
let pushSeq = 0;

const nativeCall = async (method, params) => {
  return await request("nativeCall", { method, params: params ?? {} });
};
const capabilities = nativeSdk.createCapabilities(nativeCall);

/** Push targets of the committed tree: action id -> subview command key. */
function collectPushTargets(tree) {
  pushTargets = new Map();
  const fromActions = (actions) => {
    for (const action of actions ?? []) {
      if (action?.id && action.push) pushTargets.set(action.id, String(action.push));
    }
  };
  fromActions(tree?.actions);
  for (const section of tree?.sections ?? []) {
    for (const item of section?.items ?? []) fromActions(item?.actions);
  }
  for (const item of tree?.items ?? []) fromActions(item?.actions);
}

/** Switch this session's component to `commandId` and emit a render the renderer pushes a page for. */
async function switchCommand(commandId, query) {
  if (!root) throw new Error("launchCommand: no React command is running");
  const id = String(commandId ?? "");
  if (!id) throw new Error("launchCommand: commandId is required");
  const manifestCommand = (manifest?.commands ?? []).find((command) => command.id === id);
  if (manifestCommand?.mode === "background") {
    throw new Error(`launchCommand: ${id} is a background command and cannot be pushed`);
  }
  commandStack.push({ commandId: id, query: query ?? "" });
  context = { ...context, commandId: id, query: query ?? "", filterValue: null };
  pendingNav = { action: "push", navId: `flowkey-push-${++pushSeq}` };
  root.update(buildProps());
  root.flushEffects();
  return {};
}

/** The renderer popped its top page; unwind to the previous command and update it in place. */
async function handlePop(popId) {
  if (commandStack.length <= 1) return {};
  commandStack.pop();
  const current = commandStack[commandStack.length - 1];
  context = { ...context, commandId: current.commandId, query: current.query ?? "", filterValue: null };
  pendingNav = { action: "localPop", navId: String(popId ?? "") || `flowkey-pop-${++pushSeq}` };
  root?.update(buildProps());
  root?.flushEffects();
  return {};
}

/**
 * Search-bar state push from the renderer (Raycast's searchText/filterValue semantics): the
 * running command re-renders with the new `query` / `filterValue` props, top page updated in
 * place. The renderer stops filtering rows client-side for command pages (the adapter marks
 * them `filtering: false`), so this is the only filter that applies.
 */
async function setSearchState(params) {
  if (!root) return {};
  const text = String(params?.query ?? "");
  const filterValue = params?.filterValue === undefined ? context.filterValue : params.filterValue;
  const top = commandStack[commandStack.length - 1];
  if (top) {
    top.query = text;
    top.filterValue = filterValue;
  }
  context = { ...context, query: text, filterValue };
  root.update(buildProps());
  root.flushEffects();
  return {};
}

function buildEnvironment() {
  return {
    extensionId: context.extensionId,
    extensionName: manifest?.name,
    extensionVersion: manifest?.version,
    commandId: context.commandId,
    commandMode: context.commandMode ?? "view",
    isDevelopment: context.isDevelopment ?? false,
  };
}

function buildProps() {
  return {
    query: context.query ?? "",
    filterValue: context.filterValue,
    commandId: context.commandId,
    arguments: context.arguments ?? {},
    preferences: context.preferences ?? {},
    environment: buildEnvironment(),
    window: {
      closeMainWindow: () => request("closeMainOpenrayWindow", {}),
      popToRoot: () => {
        const hadSubviews = commandStack.length > 1;
        commandStack.length = 1;
        // Notify first: the renderer pops its pages, then the re-render below arrives and updates
        // the surviving root page in place. Both ride the same pipe in FIFO order.
        const notified = request("popToRoot", {});
        if (hadSubviews && root) {
          const current = commandStack[0];
          context = { ...context, commandId: current.commandId, query: current.query ?? "", filterValue: null };
          pendingNav = { action: "new", navId: "flowkey" };
          root.update(buildProps());
          root.flushEffects();
        }
        return notified;
      },
      clearSearchBar: () => request("clearSearchBar", {}),
      launchCommand: (commandId, query) => switchCommand(commandId, query),
    },
    native: {
      call: nativeCall,
      showHud: (options) => request("showHUD", { title: options.title, icon: options.icon, duration: options.duration }),
    },
    capabilities,
    signal: abortController.signal,
  };
}

function emitRender(tree) {
  // A pending navigation wins for exactly one render (the push/pop the renderer page stack acts
  // on); every later commit updates the top page in place.
  let options;
  if (pendingNav) {
    options = { firstRender: false, navAction: pendingNav.action, navId: pendingNav.navId, onPopId: POP_CALLBACK_ID };
    pendingNav = null;
  } else {
    options = { firstRender, onPopId: POP_CALLBACK_ID };
  }
  firstRender = false;
  const model = uiTreeToRenderModel(tree, options);
  const payload = JSON.stringify({ model, changes: [] });
  return request("render", { renderTree: payload, gzipped: false });
}

async function initialize(params) {
  context = {
    extensionId: params.extensionId,
    commandId: params.command?.name ?? params.entryPointName,
    query: params.query ?? "",
    filterValue: params.filterValue ?? null,
    arguments: params.argumentValues ?? {},
    isDevelopment: params.isDevelopment ?? Boolean(workerData.isDevelopment),
    commandMode: params.entryPointMode === "no-view" ? "background" : "view",
    preferences: {},
  };
  manifest = params.flowkey?.manifest ?? null;
  commandStack = [{ commandId: context.commandId, query: context.query ?? "" }];
  pushTargets = new Map();
  pendingNav = null;
  firstRender = true;

  const rawPreferences = params.preferences ?? {};
  context.preferences = Object.fromEntries(
    Object.entries(rawPreferences).map(([key, entry]) => [
      key,
      entry && typeof entry === "object" && "value" in entry ? entry.value ?? entry.default : entry,
    ]),
  );

  const manifestCommand = (manifest?.commands ?? []).find((command) => command.id === context.commandId);
  context.commandMode = manifestCommand?.mode === "background" ? "background" : "view";

  const mod = require(params.flowkey.bundlePath);
  // esbuild's CJS interop wraps the bundle's ESM default export in `{ default }`.
  const loaded = mod?.default ?? mod;
  if (typeof loaded.component === "function") {
    root = new reactUi.ReactRoot(loaded.component, {
      onCommit: (tree, _json, reg) => {
        registry = reg;
        collectPushTargets(tree);
        // The renderer pops pages locally and notifies through this id (RenderedView →
        // callNodeCallback); a fresh registry per commit, so the reserved id never collides with
        // the extension's actions unless it names one "__pop__" itself.
        reg.registerExplicit(POP_CALLBACK_ID, (payload) => handlePop(payload));
        void emitRender(tree);
      },
      onError: (error) => {
        notify("commandException", { name: manifest?.name, message: error instanceof Error ? error.message : String(error) });
      },
    });
    root.update(buildProps());
    root.flushEffects();
    return { rendered: true };
  }
  if (loaded.handlers?.search) {
    registry = new reactUi.ActionRegistry();
    const tree = await loaded.handlers.search({
      preferences: context.preferences,
      commandId: context.commandId,
      arguments: context.arguments,
      environment: buildEnvironment(),
      native: { call: nativeCall },
      capabilities,
    });
    if (tree) await emitRender(tree);
    return { rendered: true, treeMode: true };
  }
  throw new Error(`FlowKey bundle ${manifest?.id ?? "?"} exports neither a component nor search handlers`);
}

async function nativeCallback(params) {
  const handler = registry?.resolve(params.callbackId);
  if (!handler) return {};
  const payload = params.data?.formValues ?? params.data;
  const outcome = await handler(payload);
  // Tree-mode handlers may return a replacement tree; React mode re-renders through commits.
  if (outcome && typeof outcome === "object" && outcome.type) await emitRender(outcome);
  // A `push` action navigates after its onAction side effect ran (e.g. warming the subview cache).
  const pushTarget = pushTargets.get(params.callbackId);
  if (pushTarget) await switchCommand(pushTarget);
  return {};
}

function terminate() {
  abortController.abort();
  try {
    root?.unmount();
  } catch {
    /* session is going away regardless */
  }
  return {};
}

registerMethod("initialize", initialize);
registerMethod("nativeCallback", nativeCallback);
registerMethod("setSearchState", setSearchState);
registerMethod("terminate", terminate);
