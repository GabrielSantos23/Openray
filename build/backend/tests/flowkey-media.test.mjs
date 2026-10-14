// M5b (docs/flowkey-migration-plan.md): the media bridge — `media.current` snapshots and
// `media.control` transport commands route from a FlowKey extension through the manifest consent
// gate and the native hop to the C# host (`MediaControl.cs`, Windows SMTC). The host side is
// stubbed at the transport boundary here (the real WinRT path is exercised when the app runs);
// the tests pin the routing, the payload shape, and the typed error paths.

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
const MEDIA_SRC = path.join(here, "fixtures", "flowkey", "media-src");
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));
const vendorRequire = createRequire(path.join(FLOWKEY, "vendor", "package.json"));

const UUID = "media-probe-uuid";
let pipeSeq = 0;

async function stageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowkey-media-"));
  const extensionDir = path.join(root, UUID);
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.cpSync(MEDIA_SRC, extensionDir, { recursive: true });
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

const SNAPSHOT = {
  playing: true,
  title: "Track A",
  artist: "Artist A",
  album: "Album A",
  positionMs: 61_000,
  durationMs: 210_000,
  updatedAtMs: 1_700_000_000_000,
};

/** Backend + transport stub standing in for the C# host's media routes. */
async function stageBackend(root, rendered) {
  const backend = createBackend({ pipeName: `flowkey-media-${++pipeSeq}`, apiRoot: API_ROOT, extensionsRoot: root });
  const hostCalls = [];
  backend.setTransport(async (_module, method, data) => {
    if (method === "extensionHost.render") data.__seq = rendered.length + 1;
    rendered.push({ method, data });
    if (method === "media.current") {
      hostCalls.push({ method, data });
      return SNAPSHOT;
    }
    if (method === "media.control") {
      hostCalls.push({ method, data });
      if (data.command === "rewind") throw new Error('media.control: unknown command "rewind"');
      return { ok: true };
    }
    return undefined;
  });
  return { backend, hostCalls };
}

function loadProbe(backend, root) {
  return backend.dispatchMessage("backend", "extensionHost.loadCommand", {
    extension: {
      uuid: UUID,
      name: "media-probe",
      title: "media-probe",
      author: "flowkey",
      commands: [{ name: "open", title: "Open", mode: "view", type: "command" }],
      assetsPath: path.join(root, UUID, "assets"),
    },
    command: { name: "open", title: "Open", mode: "view", type: "command" },
    preferences: {},
    debug: false,
  });
}

function bodyOf(entry) {
  return JSON.parse(entry.data.renderTree).model?.navigationStack?.body ?? null;
}

function itemById(body, id) {
  return (body?.sections ?? []).flatMap((section) => section.items).find((item) => item.id === id) ?? null;
}

async function waitForItem(rendered, predicate, { after = 0, label = "item" } = {}) {
  const deadline = Date.now() + 10000;
  let seen = after;
  while (Date.now() < deadline) {
    for (const entry of rendered) {
      if (entry.method !== "extensionHost.render") continue;
      const seq = entry.data.__seq ?? 0;
      if (seq <= seen) continue;
      seen = seq;
      const body = bodyOf(entry);
      const item = itemById(body, "snapshot");
      if (item && predicate(item, itemById(body, "control"))) return { item, control: itemById(body, "control"), seq };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no render matching ${label} within timeout`);
}

const withFixture = (fn) => async () => {
  const root = await stageFixture();
  const rendered = [];
  try {
    const { backend, hostCalls } = await stageBackend(root, rendered);
    await fn({ backend, root, rendered, hostCalls });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

test(
  "media.current routes through the manifest gate to the host and the snapshot reaches the extension",
  withFixture(async ({ backend, root, rendered, hostCalls }) => {
    const session = await loadProbe(backend, root);
    try {
      const first = await waitForItem(rendered, () => true, { label: "first render" });
      const readAction = first.item.actions.find((action) => action.title === "Read media.current");

      await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
        sessionId: session.sessionId,
        callbackId: readAction.id,
        data: {},
      });
      const updated = await waitForItem(
        rendered,
        (item) => item.subtitle === JSON.stringify(SNAPSHOT),
        { after: first.seq, label: "snapshot echo" },
      );
      assert.ok(updated.item.subtitle.includes('"title":"Track A"'), "the SMTC snapshot JSON reaches the extension");

      const hop = hostCalls.find((call) => call.method === "media.current");
      assert.ok(hop, "the route crossed the native hop as a bare media.current request");
      assert.deepEqual(hop.data, {});
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);

test(
  "media.control forwards the command; unknown commands surface the typed host error",
  withFixture(async ({ backend, root, rendered, hostCalls }) => {
    const session = await loadProbe(backend, root);
    try {
      const first = await waitForItem(rendered, () => true, { label: "first render" });
      const actions = first.item.actions;
      const nextAction = actions.find((action) => action.title === "Send next");
      const unknownAction = actions.find((action) => action.title === "Unknown command");
      const undeclaredAction = actions.find((action) => action.title === "Undeclared media");

      await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
        sessionId: session.sessionId,
        callbackId: nextAction.id,
        data: {},
      });
      await waitForItem(rendered, (_item, control) => control?.subtitle === "next sent", {
        after: first.seq,
        label: "next sent",
      });
      assert.deepEqual(
        hostCalls.find((call) => call.method === "media.control")?.data,
        { command: "next" },
      );

      await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
        sessionId: session.sessionId,
        callbackId: unknownAction.id,
        data: {},
      });
      await waitForItem(
        rendered,
        (_item, control) => control?.subtitle === 'typed: media.control: unknown command "rewind"',
        { after: first.seq + 1, label: "typed unknown command" },
      );

      // The consent gate still runs before any dispatch: media.seek is not in the manifest.
      await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
        sessionId: session.sessionId,
        callbackId: undeclaredAction.id,
        data: {},
      });
      await waitForItem(
        rendered,
        (_item, control) => control?.subtitle === "typed: native method media.seek is not declared in the manifest",
        { after: first.seq + 2, label: "undeclared gate" },
      );
      assert.equal(hostCalls.filter((call) => call.data?.command === "rewind").length, 1, "rewind reached the host exactly once (typed error path, not retried)");
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);
