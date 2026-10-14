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

const nativeCall = async (method, params) => {
  return await request("nativeCall", { method, params: params ?? {} });
};
const capabilities = nativeSdk.createCapabilities(nativeCall);

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
      closeMainWindow: () => request("closeMainRaycastWindow", {}),
      popToRoot: () => request("popToRoot", {}),
      clearSearchBar: () => request("clearSearchBar", {}),
      launchCommand: (commandId, query) => request("launchCommand", { commandId, query }),
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
  const model = uiTreeToRenderModel(tree, { firstRender });
  firstRender = false;
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
registerMethod("terminate", terminate);
