// A1 (docs/flowkey-migration-plan.md M1): the worker↔backend FlowKey contract, end to end —
// manifest-driven summaries, a real FlowKey bundle loading in the real FlowKey worker and
// rendering through the adapter, action invocation round trips, LocalStorage persistence across
// sessions, preference flattening, and the typed nativeCall error paths (undeclared method,
// declared-but-unimplemented).
//
// This suite also carries the api-shim assertions that stay valid after the @raycast/api removal
// (adjustment 7): storage semantics persist to disk, and out-of-contract calls fail with typed
// errors that reach the host — never silent no-ops. The @raycast-specific probes (canAccess, AI,
// hooks) die with the shim in M4.
//
// No network: the fixture declares an empty httpHosts allowlist and exercises only storage.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const buildRoot = path.resolve(here, "..", "..");
const API_ROOT = path.join(buildRoot, "api");
const FLOWKEY = path.join(buildRoot, "flowkey");
const CONTRACT_SRC = path.join(here, "fixtures", "flowkey", "contract-src");
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));
const vendorRequire = createRequire(path.join(FLOWKEY, "vendor", "package.json"));

const UUID = "contract-probe-uuid";
let pipeSeq = 0;

// Stage the fixture into a fresh extensions root and bundle it with the same shim pipeline the
// command-ux-test build uses (react/@flowkey-mini aliased to the sidecar shims).
async function stageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowkey-contract-"));
  const extensionDir = path.join(root, UUID);
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.cpSync(CONTRACT_SRC, extensionDir, { recursive: true });
  await vendorRequire("esbuild").build({
    entryPoints: [path.join(extensionDir, "index.tsx")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    jsx: "automatic",
    outfile: path.join(extensionDir, "main.js"),
    alias: {
      react: path.join(FLOWKEY, "cli", "shims", "react.ts"),
      "react/jsx-runtime": path.join(FLOWKEY, "cli", "shims", "react-jsx-runtime.ts"),
      "react/jsx-dev-runtime": path.join(FLOWKEY, "cli", "shims", "react-jsx-runtime.ts"),
      "@flowkey-mini/react-ui": path.join(FLOWKEY, "cli", "shims", "flowkey-react-ui.ts"),
      "@flowkey-mini/native-sdk": path.join(FLOWKEY, "cli", "shims", "flowkey-native-sdk.ts"),
    },
    logLevel: "silent",
  });
  return root;
}

function loadProbe(backend, root, { preferences = {}, debug = false } = {}) {
  return backend.dispatchMessage("backend", "extensionHost.loadCommand", {
    extension: {
      uuid: UUID,
      name: "contract-probe",
      title: "contract-probe",
      author: "flowkey",
      commands: [{ name: "open", title: "Open", mode: "view", type: "command" }],
      assetsPath: path.join(root, UUID, "assets"),
    },
    command: { name: "open", title: "Open", mode: "view", type: "command" },
    preferences,
    debug,
  });
}

function bodyOf(entry) {
  const text = entry.data.gzipped
    ? require("node:zlib").gunzipSync(Buffer.from(entry.data.renderTree, "base64")).toString()
    : entry.data.renderTree;
  return JSON.parse(text).model?.navigationStack?.body ?? null;
}

function itemById(body, id) {
  return (body?.sections ?? []).flatMap((section) => section.items).find((item) => item.id === id) ?? null;
}

/** Wait for a render whose body satisfies `predicate`; returns that body. */
async function waitForBody(rendered, predicate, { after = 0, timeoutMs = 10000, label = "body" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = after;
  while (Date.now() < deadline) {
    for (const entry of rendered) {
      if (entry.method !== "extensionHost.render") continue;
      const seq = entry.data.__seq ?? 0;
      if (seq <= seen) continue;
      seen = seq;
      const body = bodyOf(entry);
      if (predicate(body)) return { body, seq };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no render matching ${label} within ${timeoutMs}ms`);
}

const withFixture = (fn) => async () => {
  const root = await stageFixture();
  try {
    const rendered = [];
    let seq = 0;
    const backend = createBackend({ pipeName: `flowkey-contract-${++pipeSeq}`, apiRoot: API_ROOT, extensionsRoot: root });
    backend.setTransport(async (_module, method, data) => {
      if (method === "extensionHost.render") data.__seq = ++seq;
      rendered.push({ method, data });
      return undefined;
    });
    await fn({ backend, root, rendered });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

test("manifest.json extensions surface in allExtensions with FlowKey command mapping", async () => {
  const root = await stageFixture();
  try {
    const backend = createBackend({ pipeName: `flowkey-summaries-${++pipeSeq}`, apiRoot: API_ROOT, extensionsRoot: root });
    const summaries = await backend.allExtensions();
    const probe = summaries.find((entry) => entry.uuid === UUID);
    assert.ok(probe, "flowkey extension summarized");
    assert.equal(probe.isFlowkey, true);
    assert.equal(probe.author, "flowkey");
    assert.deepEqual(
      probe.commands.map((command) => `${command.name}:${command.mode}`),
      ["open:view", "tick:no-view"],
      "background mode maps to no-view",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("A3: store.* RPCs fail with the typed removed error, never a silent no-op", async () => {
  const root = await stageFixture();
  try {
    const backend = createBackend({ pipeName: `flowkey-store-removed-${++pipeSeq}`, apiRoot: API_ROOT, extensionsRoot: root });
    await assert.rejects(
      () => backend.dispatchMessage("backend", "store.search", { query: "x" }),
      /store\.search: the Raycast Store was removed/,
    );
    await assert.rejects(
      () => backend.dispatchMessage("backend", "store.getCommandPreferences", { uuid: UUID, commandName: "open" }),
      /the Raycast Store was removed/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test(
  "flowkey worker round trip: bundle loads, List renders through the adapter, preferences flatten",
  withFixture(async ({ backend, root, rendered }) => {
    const session = await loadProbe(backend, root, {
      preferences: { sampleText: { value: "setvalue", default: "fallback" }, plain: "yes" },
    });
    try {
      assert.ok(session.sessionId);
      const { body } = await waitForBody(rendered, (candidate) => candidate?.kind === "List", { label: "first List render" });
      const env = itemById(body, "env");
      const prefs = itemById(body, "prefs");
      assert.equal(env.subtitle, "contract-probe|open|view");
      assert.equal(prefs.subtitle, "setvalue", "{value,default} preference objects flatten to value");
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);

test(
  "storage round trip persists to .storage.json under the flowkey: prefix and survives a fresh session",
  withFixture(async ({ backend, root, rendered }) => {
    const first = await loadProbe(backend, root);
    const storageFile = path.join(root, UUID, ".storage.json");
    try {
      // The mount effect: get -> "(empty)" render, then set -> disk write (namespaced).
      await waitForBody(rendered, (body) => itemById(body, "storage")?.subtitle === "(empty)", { label: "storage read" });
      const diskDeadline = Date.now() + 10000;
      let disk = null;
      while (Date.now() < diskDeadline) {
        try {
          disk = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
          if (disk["flowkey:probe"] !== undefined) break;
        } catch {
          /* not written yet */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(disk?.["flowkey:probe"], '{"n":42}', "storage.set landed on disk under the flowkey: prefix");
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: first.sessionId }).catch(() => undefined);
    }

    // A brand-new session (fresh worker) reads the persisted value on mount.
    const second = await loadProbe(backend, root);
    try {
      const { body } = await waitForBody(rendered, (candidate) => itemById(candidate, "storage")?.subtitle === '{"n":42}', {
        after: rendered.filter((entry) => entry.method === "extensionHost.render").length,
        label: "persisted storage echo",
      });
      assert.equal(itemById(body, "storage").subtitle, '{"n":42}');
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: second.sessionId }).catch(() => undefined);
    }
  }),
);

test(
  "action invocation round trip: rendered fka id -> callNodeCallback -> state update re-renders",
  withFixture(async ({ backend, root, rendered }) => {
    const session = await loadProbe(backend, root);
    try {
      const first = await waitForBody(rendered, (body) => body?.kind === "List", { label: "first render" });
      const counter = itemById(first.body, "counter");
      const increment = counter.actions.find((action) => action.title === "Increment");
      assert.match(increment.id, /^fka\d+$/);
      assert.equal(counter.title, "Count 0");

      await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
        sessionId: session.sessionId,
        callbackId: increment.id,
        data: {},
      });
      const second = await waitForBody(rendered, (body) => itemById(body, "counter")?.title === "Count 1", {
        after: first.seq,
        label: "post-increment render",
      });
      const updated = itemById(second.body, "counter");
      assert.equal(updated.accessories[0].text, "count=1");
      assert.equal(updated.accessories[0].color, "#4aa3ff", "accent accessory color maps to the palette hex");
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);

test(
  "declared-but-unimplemented native method fails typed ('not implemented yet'), undeclared method fails the manifest gate",
  withFixture(async ({ backend, root, rendered }) => {
    const session = await loadProbe(backend, root);
    try {
      const first = await waitForBody(rendered, (body) => body?.kind === "List", { label: "first render" });
      const counter = itemById(first.body, "counter");
      const unimplemented = counter.actions.find((action) => action.title === "Declared but unimplemented");
      const undeclared = counter.actions.find((action) => action.title === "Undeclared method");

      await assert.rejects(
        () =>
          backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
            sessionId: session.sessionId,
            callbackId: unimplemented.id,
            data: {},
          }),
        /FlowKey native method system\.selectedText is not implemented yet/,
      );
      await assert.rejects(
        () =>
          backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
            sessionId: session.sessionId,
            callbackId: undeclared.id,
            data: {},
          }),
        /native method fs\.read is not declared in the manifest/,
      );
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);
