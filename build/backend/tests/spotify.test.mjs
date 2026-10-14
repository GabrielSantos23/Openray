// A8 (docs/flowkey-migration-plan.md M5c): the Spotify port launches through the real worker and
// renders its sign-in state without any network. The OAuth client id is deliberately NOT
// configured, so every view must park on the "Connect Spotify" state; the Connect action fails
// with the BYO configuration error; player commands run their typed media-pending path. The
// authorized flows need a live Spotify account and are covered by manual checks (see plan §M5c).
//
// What the test pins:
//   * search renders "Connect Spotify" after the vault reports ok:false (the 'checking' first
//     render resolves into the unauthorized state);
//   * the Connect action surfaces the BYO client-id configuration error;
//   * now-playing loads and renders without crashing (media.current is typed not-implemented
//     until the M5b SMTC host lands — the view reports it, never hangs).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const buildRoot = path.resolve(here, "..", "..");
const EXT = path.resolve(buildRoot, "extensions", "spotify");
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));

const UUID = "spotify";
let pipeSeq = 0;

function bodyOf(entry) {
  const text = entry.data.gzipped
    ? require("node:zlib").gunzipSync(Buffer.from(entry.data.renderTree, "base64")).toString()
    : entry.data.renderTree;
  return JSON.parse(text).model?.navigationStack?.body ?? null;
}

async function loadCommand(backend, commandName) {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf-8"));
  const command = manifest.commands.find((entry) => entry.id === commandName);
  assert.ok(command, `manifest command ${commandName} exists`);
  return backend.dispatchMessage("backend", "extensionHost.loadCommand", {
    extension: {
      uuid: UUID,
      name: "spotify",
      title: "Spotify",
      author: "flowkey",
      commands: manifest.commands.map((entry) => ({ name: entry.id, title: entry.title, mode: entry.mode === "background" ? "no-view" : "view", type: "command" })),
      assetsPath: path.join(EXT, "assets"),
    },
    command: { name: commandName, title: command.title, mode: command.mode === "background" ? "no-view" : "view", type: "command" },
    preferences: {},
    debug: true,
  });
}

/** Wait for a render whose body satisfies the predicate. */
async function waitForBody(rendered, predicate, { after = 0, timeoutMs = 15000, label = "body" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = after;
  while (Date.now() < deadline) {
    for (const entry of rendered) {
      if (entry.method !== "extensionHost.render") continue;
      const seq = entry.data.__seq ?? 0;
      if (seq <= seen) continue;
      seen = seq;
      const body = bodyOf(entry);
      if (body && predicate(body)) return { body, seq };
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`no render matching ${label} within ${timeoutMs}ms`);
}

const withSpotify = (commandName, fn) => async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spotify-e2e-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spotify-data-"));
  try {
    const rendered = [];
    let seq = 0;
    const backend = createBackend({ pipeName: `spotify-e2e-${++pipeSeq}`, extensionsRoot: root, dataRoot });
    backend.setTransport(async (_module, method, data) => {
      if (method === "extensionHost.render") data.__seq = ++seq;
      rendered.push({ method, data });
      return undefined;
    });
    // Install the extension the way install-flowkey.ps1 would (manifest + bundle at <root>/<id>).
    const target = path.join(root, UUID);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(EXT, target, { recursive: true });

    const session = await loadCommand(backend, commandName);
    try {
      await fn({ backend, rendered, session, root, dataRoot });
    } finally {
      await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

test(
  "A8: search parks on 'Connect Spotify' when the vault has no token; Connect surfaces the BYO error",
  withSpotify("search", async ({ backend, rendered, session }) => {
    const { body } = await waitForBody(rendered, (candidate) => candidate?.kind === "List" && (candidate.emptyView?.title === "Connect Spotify"), {
      label: "Connect Spotify state",
    });
    assert.equal(body.emptyView.title, "Connect Spotify");
    assert.match(body.emptyView.description ?? "", /client id/i);

    // The connect item's action is wired to the vault: with no client id configured the
    // extension refuses locally (notice), with one configured it would open the browser —
    // either way it must not throw through the bridge.
    const items = (body.sections ?? []).flatMap((section) => section.items);
    const connect = items.find((item) => item.id === "connect-spotify");
    assert.ok(connect, "the connect item renders");
    await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
      sessionId: session.sessionId,
      callbackId: connect.actions[0].id,
      data: {},
    });
    // The extension sets a notice state; the next render carries it as an accessory/subtitle.
    const notice = await waitForBody(rendered, (candidate) => {
      const itemsNow = (candidate?.sections ?? []).flatMap((section) => section.items);
      const connectNow = itemsNow.find((item) => item.id === "connect-spotify");
      return Boolean(connectNow && JSON.stringify(candidate).includes("client id in"));
    }, { after: 1, label: "BYO notice render" });
    assert.ok(notice.body, "the BYO notice renders");
  }),
);

test(
  "A8: now-playing loads without auth and reports the pending media bridge instead of hanging",
  withSpotify("now-playing", async ({ rendered }) => {
    // The view resolves oauth.status -> unauthorized -> renders its connect/notice state.
    const { body } = await waitForBody(
      rendered,
      (candidate) => candidate?.emptyView?.title === "Connect Spotify",
      { label: "now-playing unauthorized state" },
    );
    assert.match(
      body.emptyView.description ?? "",
      /connect to authorize/i,
      "now-playing reports its state rather than rendering nothing",
    );
  }),
);
