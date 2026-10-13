var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/tests/fixtures/store/shim-probe/src/probe.tsx
var probe_exports = {};
__export(probe_exports, {
  default: () => Command
});
module.exports = __toCommonJS(probe_exports);
var import_api = require("@raycast/api");
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function errorNameOf(run) {
  return run().then(
    () => "no-throw",
    (error) => error.name
  );
}
function Command() {
  const [outcomes, setOutcomes] = (0, import_react.useState)([]);
  (0, import_react.useEffect)(() => {
    const cache = new import_api.Cache();
    cache.set("probe", "hit");
    const preferences = (0, import_api.getPreferenceValues)();
    const jobs = [
      Promise.resolve({ name: "canAccess-AI", value: String(import_api.environment.canAccess(import_api.AI)) }),
      Promise.resolve({ name: "canAccess-model", value: String(import_api.environment.canAccess("openai-gpt-5.5")) }),
      Promise.resolve({ name: "canAccess-other", value: String(import_api.environment.canAccess("whatever")) }),
      Promise.resolve({ name: "cache-get", value: String(cache.get("probe")) }),
      Promise.resolve({ name: "cache-contains", value: String(cache.contains("probe")) }),
      Promise.resolve({ name: "prefs", value: `${String(preferences.token)}|${String(preferences.plain)}` }),
      Promise.resolve({ name: "launchContext", value: String(import_api.environment.launchContext) }),
      errorNameOf(() => import_api.AI.ask("hello")).then((value) => ({ name: "AI.ask", value })),
      errorNameOf(() => import("@raycast/api").then((api) => api.getSelectedText())).then((value) => ({ name: "getSelectedText", value })),
      errorNameOf(() => import("@raycast/api").then((api) => api.WindowManagement.getDesktops())).then((value) => ({ name: "WindowManagement", value })),
      errorNameOf(() => import("@raycast/api").then((api) => api.BrowserExtension.getTabs())).then((value) => ({ name: "BrowserExtension", value })),
      errorNameOf(() => import("@raycast/api").then((api) => new api.OAuth.PKCEClient().authorize())).then((value) => ({ name: "OAuth", value })),
      errorNameOf(() => import("@raycast/api").then((api) => api.useUnstableAI())).then((value) => ({ name: "useUnstableAI", value })),
      Promise.resolve({ name: "error-class", value: String(typeof import_api.UnsupportedApiError === "function") })
    ];
    void Promise.all(jobs).then((done) => setOutcomes(done));
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api.List, { navigationTitle: "Probe", children: outcomes.map((outcome) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api.List.Item, { title: outcome.name, subtitle: outcome.value }, outcome.name)) });
}
