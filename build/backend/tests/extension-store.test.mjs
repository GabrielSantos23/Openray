// The extension Store: catalog sync against a local fixture GitHub server (the real wire shape —
// trees API, commits API, raw CDN), list/search/category reads, lazy detail (screenshots + last
// update + README, cached), icons, screenshots, GitHub install staging, uploaded FlowKey import +
// install into the live extensions root, and the backend prefs round trip that fixes the
// Settings-window localStorage split (the Spotify client id bug). `store.search` keeps the typed
// removed-store error (A3).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const buildRoot = path.resolve(here, "..", "..");
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));
const store = require(path.join(buildRoot, "backend", "src", "store", "index.js"));
const uploads = require(path.join(buildRoot, "backend", "src", "store", "uploads.js"));

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const PKGS = {
  alpha: {
    $schema: "https://www.raycast.com/schemas/extension.json",
    name: "alpha",
    title: "Alpha Player",
    description: "Alpha description",
    icon: "extension-icon.png",
    author: "alpha-dev",
    categories: ["Media"],
    contributors: ["friend-one", "friend-two"],
    commands: [
      { name: "search", title: "Search", description: "Search things", mode: "view" },
      { name: "toggle", title: "Toggle", description: "Toggle it", mode: "mode-no-view" },
    ],
  },
  beta: {
    name: "beta",
    title: "Beta Notes",
    description: "Beta description",
    icon: "icon.png",
    author: { name: "beta-dev" },
    categories: ["Productivity"],
    commands: [{ name: "open", title: "Open Beta" }],
  },
};

const TREE = {
  // Paths are relative to the extension directory — the real `git/trees/<sha>` contract.
  alpha: [
    { path: "package.json", type: "blob", size: 10 },
    { path: "README.md", type: "blob", size: 10 },
    { path: "assets/extension-icon.png", type: "blob", size: PNG.length },
    { path: "assets/screenshots/one.png", type: "blob", size: PNG.length },
    { path: "assets/screenshots/two.png", type: "blob", size: PNG.length },
    { path: "metadata/screenshot-1.png", type: "blob", size: PNG.length },
    { path: "assets/extension-icon-small.png", type: "blob", size: 3 },
  ],
  beta: [
    { path: "package.json", type: "blob", size: 10 },
    { path: "assets/icon.png", type: "blob", size: PNG.length },
  ],
};

/** Fixture GitHub: API paths at the root, raw paths under /raw/. */
async function startFixture() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://fixture");
    const respond = (code, body, type = "application/json") => {
      response.writeHead(code, { "content-type": type });
      response.end(body);
    };
    if (url.pathname.endsWith("/git/trees/main")) {
      return respond(200, JSON.stringify({ tree: [{ path: "extensions", type: "tree", sha: "sha-extensions" }] }));
    }
    if (url.pathname.endsWith("/git/trees/sha-extensions")) {
      return respond(200, JSON.stringify({
        tree: [
          { path: "alpha", type: "tree", sha: "sha-alpha" },
          { path: "beta", type: "tree", sha: "sha-beta" },
        ],
      }));
    }
    if (url.pathname.endsWith("/git/trees/sha-alpha") || url.pathname.endsWith("/git/trees/sha-beta")) {
      const name = url.pathname.endsWith("/git/trees/sha-alpha") ? "alpha" : "beta";
      return respond(200, JSON.stringify({ truncated: false, tree: TREE[name] }));
    }
    if (url.pathname.endsWith("/commits")) {
      const repoPath = url.searchParams.get("path") ?? "";
      const date = repoPath === "" || repoPath === "extensions/alpha" ? "2026-10-01T00:00:00Z" : "2026-09-15T00:00:00Z";
      return respond(200, JSON.stringify([{ commit: { committer: { date } } }]));
    }
    if (url.pathname.startsWith("/raw/extensions/")) {
      const relative = url.pathname.slice("/raw/extensions/".length);
      const [name, ...rest] = relative.split("/");
      if (rest.join("/") === "package.json") return respond(200, JSON.stringify(PKGS[name]));
      if (rest.join("/") === "README.md") return respond(200, `# ${name} readme`, "text/markdown");
      if (rest.join("/") === "assets/screenshots/one.png") return respond(200, PNG, "image/png");
      if (rest.join("/") === "assets/screenshots/two.png") return respond(200, PNG, "image/png");
      if (rest.join("/") === "metadata/screenshot-1.png") return respond(200, PNG, "image/png");
      if (rest.join("/") === `assets/${PKGS[name]?.icon}`) return respond(200, PNG, "image/png");
      return respond(404, "nope", "text/plain");
    }
    respond(404, "nope", "text/plain");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (url, init) =>
    fetch(String(url).replace("https://api.github.com", base).replace("https://raw.githubusercontent.com/raycast/extensions/main", `${base}/raw`), init);
  return { server, fetchImpl };
}

const withStore = (fn) => async () => {
  const { server, fetchImpl } = await startFixture();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "extstore-data-"));
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "extstore-live-"));
  const storeRoot = path.join(dataRoot, "store");
  try {
    await fn({ fetchImpl, dataRoot, extensionsRoot, storeRoot });
  } finally {
    server.close();
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(extensionsRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

test(
  "sync walks the full extensions tree, indexes every package.json, and the list reads it back",
  withStore(async ({ fetchImpl, storeRoot }) => {
    const result = await store.syncStoreCatalog({ storeRoot, fetchImpl });
    assert.deepEqual(result, { synced: 2, failed: 0 });

    const status = store.storeStatus(storeRoot);
    assert.equal(status.running, false);
    assert.equal(status.extensionCount, 2);
    assert.equal(status.headCommitDate, "2026-10-01T00:00:00Z");

    const list = store.listStoreExtensions({ storeRoot, extensionsRoot: os.tmpdir(), query: "" });
    assert.deepEqual(list.extensions.map((entry) => entry.title), ["Alpha Player", "Beta Notes"]);
    assert.deepEqual(list.categories, ["Media", "Productivity"]);

    const filtered = store.listStoreExtensions({ storeRoot, extensionsRoot: os.tmpdir(), query: "beta" });
    assert.deepEqual(filtered.extensions.map((entry) => entry.name), ["beta"]);
    const byCategory = store.listStoreExtensions({ storeRoot, extensionsRoot: os.tmpdir(), category: "Media" });
    assert.deepEqual(byCategory.extensions.map((entry) => entry.name), ["alpha"]);
  }),
);

test(
  "detail lazily fetches screenshots, last update and README once, then serves them from cache",
  withStore(async ({ fetchImpl, storeRoot }) => {
    await store.syncStoreCatalog({ storeRoot, fetchImpl });
    const detail = await store.storeDetail({ storeRoot, extensionsRoot: os.tmpdir(), fetchImpl, name: "alpha", source: "github" });
    assert.equal(detail.title, "Alpha Player");
    assert.equal(detail.author, "alpha-dev");
    assert.deepEqual(detail.screenshots, [
      "assets/screenshots/one.png",
      "assets/screenshots/two.png",
      "metadata/screenshot-1.png",
    ]);
    assert.equal(detail.lastUpdate, "2026-10-01T00:00:00Z");
    assert.equal(detail.readme, "# alpha readme");
    assert.deepEqual(detail.commands.map((command) => command.name), ["search", "toggle"]);
    assert.deepEqual(detail.contributors, ["friend-one", "friend-two"]);

    const again = await store.storeDetail({ storeRoot, extensionsRoot: os.tmpdir(), fetchImpl, name: "alpha", source: "github" });
    assert.deepEqual(again.screenshots, detail.screenshots, "second read comes from detail.json cache");
    const icon = await store.storeIcon({ storeRoot, extensionsRoot: os.tmpdir(), fetchImpl, name: "alpha", source: "github" });
    assert.match(icon.icon, /^data:image\/png;base64,/);
    const shot = await store.storeScreenshot({ storeRoot, fetchImpl, name: "alpha", screenshotPath: "assets/screenshots/one.png" });
    assert.match(shot.uri, /^file:\/\/\//);
    assert.ok(fs.existsSync(new URL(shot.uri)));
  }),
);

test(
  "installing a GitHub extension stages the full source without touching the live root; uploads install live",
  withStore(async ({ fetchImpl, storeRoot, extensionsRoot }) => {
    await store.syncStoreCatalog({ storeRoot, fetchImpl });
    const githubInstall = await store.installStoreExtension({ storeRoot, extensionsRoot, fetchImpl, name: "beta", source: "github" });
    assert.equal(githubInstall.installed, true);
    assert.equal(githubInstall.runnable, false, "a @raycast/api source is not runnable until ported");
    assert.ok(fs.existsSync(path.join(storeRoot, "installed", "beta", "package.json")));
    assert.ok(fs.existsSync(path.join(storeRoot, "installed", "beta", "assets", "icon.png")));
    assert.equal(fs.existsSync(path.join(extensionsRoot, "beta")), false, "the live root stays FlowKey-only");
    assert.equal(
      store.listStoreExtensions({ storeRoot, extensionsRoot, query: "beta" }).extensions[0].installed,
      true,
      "the store marks the staged install",
    );

    // An uploaded FlowKey extension imports, lists, and installs into the live root.
    const sourceDir = path.join(extensionsRoot, "..", "upload-src");
    fs.mkdirSync(path.join(sourceDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "manifest.json"), JSON.stringify({ id: "my-probe", name: "My Probe", version: "1.0.0", commands: [] }));
    fs.writeFileSync(path.join(sourceDir, "main.js"), "module.exports = {};");
    const imported = uploads.importUploadedExtension({ storeRoot, sourceDir, author: "gabriel" });
    assert.equal(imported.name, "my-probe");
    const listed = uploads.listUploadedExtensions(storeRoot);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].author, "gabriel");

    const install = await store.installStoreExtension({ storeRoot, extensionsRoot, fetchImpl, name: "my-probe", source: "uploaded" });
    assert.equal(install.runnable, true);
    assert.equal(fs.existsSync(path.join(extensionsRoot, "my-probe", "main.js")), true);
    assert.equal(
      store.listStoreExtensions({ storeRoot, extensionsRoot, query: "" }).extensions.find((entry) => entry.name === "my-probe").installed,
      true,
    );
  }),
);

test(
  "backend routes store.sync/list through the new table; store.search keeps the typed removed error; prefs persist backend-side",
  async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "extstore-backend-"));
    const extensionsRoot = path.join(dataRoot, "extensions");
    fs.mkdirSync(extensionsRoot, { recursive: true });
    try {
      const backend = createBackend({ pipeName: `extstore-backend-${Date.now()}`, apiRoot: path.join(buildRoot, "api"), extensionsRoot, dataRoot });
      const { server, fetchImpl } = await startFixture();
      try {
        const { createExtensionStore } = require(path.join(buildRoot, "backend", "src", "store", "index.js"));
        backend.registerStoreHandler(createExtensionStore({ dataRoot, extensionsRoot, fetchImpl }).handlers);

        // Unknown store verb: still the typed removed-store error (A3 keeps its pin).
        await assert.rejects(
          () => backend.dispatchMessage("backend", "store.search", { query: "x" }),
          /the Raycast Store was removed/,
        );

        backend.dispatchMessage("backend", "store.sync", {}).then((result) => assert.equal(result.started, true));
        await assert.rejects(
          () => backend.dispatchMessage("backend", "store.detail", { name: "missing", source: "github" }),
          /is not in the catalog/,
        );

        // FlowKey preferences: the backend file is the single source of truth across windows.
        await backend.dispatchMessage("backend", "extensionHost.setFlowkeyPreference", { uuid: "spotify", name: "clientId", value: "abc123" });
        const read = await backend.dispatchMessage("backend", "extensionHost.getFlowkeyPreferences", { uuid: "spotify" });
        assert.deepEqual(read.values, { clientId: "abc123" });
        const fresh = createBackend({ pipeName: `extstore-backend2-${Date.now()}`, apiRoot: path.join(buildRoot, "api"), extensionsRoot, dataRoot });
        const persisted = await fresh.dispatchMessage("backend", "extensionHost.getFlowkeyPreferences", { uuid: "spotify" });
        assert.deepEqual(persisted.values, { clientId: "abc123" }, "the value outlives the backend instance");
      } finally {
        server.close();
      }
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  },
);
