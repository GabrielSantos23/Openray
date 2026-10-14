// A5 (docs/flowkey-migration-plan.md M3): the lucide-icons pilot launches in a real FlowKey
// worker through the normal loadCommand path and renders the expected grid. No network: the
// icon metadata ships with the extension. Drives the preferences path (primaryAction,
// pascalCaseName), the search-bar color dropdown (filter -> searchBarAccessory), the copy action
// (round trip -> clipboard.write reaching the host clipboard handler) and the typed error for
// the not-yet-routed clipboard.paste.

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
const EXT = path.resolve(buildRoot, "extensions", "lucide-icons");
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));
const vendorRequire = createRequire(path.join(FLOWKEY, "vendor", "package.json"));

const UUID = "lucide-icons";
let pipeSeq = 0;

async function stageInstalled() {
  // The pilot lands in a temp extensions root the way install-flowkey.ps1 would: manifest +
  // bundle + assets under <root>/<manifest.id>.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucide-e2e-"));
  const target = path.join(root, UUID);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(EXT, target, { recursive: true });
  return root;
}

function loadPilot(backend, root, { preferences = {}, filterValue = null, query = "" } = {}) {
  return backend.dispatchMessage("backend", "extensionHost.loadCommand", {
    extension: {
      uuid: UUID,
      name: "lucide-icons",
      title: "Lucide Icons",
      author: "flowkey",
      commands: [{ name: "open", title: "Search Icons", mode: "view", type: "command" }],
      assetsPath: path.join(root, UUID, "assets"),
    },
    command: { name: "open", title: "Search Icons", mode: "view", type: "command" },
    preferences,
    props: { filterValue, query },
    debug: true,
  });
}

function bodyOf(entry) {
  const text = entry.data.gzipped
    ? require("node:zlib").gunzipSync(Buffer.from(entry.data.renderTree, "base64")).toString()
    : entry.data.renderTree;
  return JSON.parse(text).model?.navigationStack?.body ?? null;
}

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

const withPilot = (fn) => async () => {
  const root = await stageInstalled();
  try {
    const rendered = [];
    let seq = 0;
    const overrides = [];
    const backend = createBackend({ pipeName: `lucide-e2e-${++pipeSeq}`, apiRoot: API_ROOT, extensionsRoot: root });
    backend.setTransport(async (_module, method, data) => {
      if (method === "extensionHost.render") data.__seq = ++seq;
      rendered.push({ method, data });
      return undefined;
    });
    await fn({ backend, root, rendered, overrides });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

test(
  "A5: the pilot renders the full grid through the normal path — sections, filter dropdown, svg icons",
  withPilot(async ({ backend, root, rendered }) => {
    const session = await loadPilot(backend, root, {
      preferences: { primaryAction: { value: "copy-name", default: "copy-name" } },
    });
    try {
      assert.ok(session.sessionId);
      const { body } = await waitForBody(rendered, (candidate) => candidate?.kind === "Grid", { label: "grid" });
      assert.equal(body.columns, 8);
      assert.deepEqual(body.searchBarAccessory, {
        sections: [
          {
            items: [
              { id: "PrimaryText", title: "PrimaryText" },
              { id: "Red", title: "Red" },
              { id: "Orange", title: "Orange" },
              { id: "Yellow", title: "Yellow" },
              { id: "Green", title: "Green" },
              { id: "Blue", title: "Blue" },
              { id: "Purple", title: "Purple" },
              { id: "Pink", title: "Pink" },
              { id: "Brown", title: "Brown" },
            ],
          },
        ],
      }, "the color filter maps to the search-bar dropdown");
      assert.equal(body.emptyView?.title, "No icons found");

      const section = body.sections.find((candidate) => candidate.title === "Results");
      assert.ok(section, "results section present");
      assert.equal(section.subtitle, "1636", "the full set renders with no query");
      const apple = section.items.find((item) => item.id === "apple");
      assert.ok(apple, "the apple icon is in the grid");
      assert.match(apple.icon.source.light, /^data:image\/svg\+xml;base64,/, "svg icon maps to a data URI the frontend can <img>");
      assert.ok(
        apple.actions.some((action) => action.title === "Copy Name"),
        "primaryAction preference (copy-name) picks the primary action",
      );
      assert.ok(apple.actions.some((action) => action.title === "Open In Browser"));
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);

test(
  "A5: search text filters the grid; color filterValue tints; actions reach the clipboard handler",
  withPilot(async ({ backend, root, rendered, overrides }) => {
    let clipboardWrites = [];
    overrides.push(
      backend.overrideHostHandler("getClipboard", () => ({ value: null })),
      backend.overrideHostHandler("setClipboard", (_ctx, params) => {
        clipboardWrites.push(params);
        return undefined;
      }),
    );
    const session = await loadPilot(backend, root, {
      preferences: { primaryAction: { value: "copy-name", default: "copy-name" }, pascalCaseName: { value: true, default: false } },
      query: "arrow down",
    });
    try {
      const { body } = await waitForBody(rendered, (candidate) => candidate?.kind === "Grid", { label: "filtered grid" });
      const section = body.sections.find((candidate) => candidate.title === "Results");
      const ids = section.items.map((item) => item.id);
      assert.ok(ids.includes("a-arrow-down"), `"arrow down" recall: a-arrow-down (${ids.slice(0, 8).join(", ")}…)`);
      assert.ok(ids.length < 50, "the query narrows the grid");

      // Run Copy Name on the first result: the fka id round-trips through callNodeCallback and
      // reaches the backend clipboard handler with the PascalCase name (pascalCaseName: true).
      const item = section.items[0];
      const copyName = item.actions.find((action) => action.title === "Copy Name");
      clipboardWrites = [];
      await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
        sessionId: session.sessionId,
        callbackId: copyName.id,
        data: {},
      });
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && clipboardWrites.length === 0) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(clipboardWrites.length, 1, "clipboard.write reached the host handler");
      assert.match(clipboardWrites[0].text, /A[A-Z]/, "PascalCase preference applies to the copied name");

      // The typed error path: clipboard.paste is declared but not routed yet.
      const paste = item.actions.find((action) => action.title === "Paste SVG");
      await assert.rejects(
        () =>
          backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
            sessionId: session.sessionId,
            callbackId: paste.id,
            data: {},
          }),
        /FlowKey native method clipboard\.paste is not implemented yet/,
      );
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  }),
);
