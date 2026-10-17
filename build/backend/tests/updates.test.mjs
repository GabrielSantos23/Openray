// Updates module (`updates.*`): version comparison, GitHub Releases state machine and the
// install download path, with the network stubbed. Run: `node --test tests/updates.test.mjs`
// from build/backend (or the repo's test-all runner).

import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { createUpdates, isNewerVersion, parseVersion, pickZipAsset } = await import("../src/updates.js");

function release(tag, assets = [{ name: `Openray-${tag.replace(/^v/, "")}-win-x64.zip`, browser_download_url: `https://x/${tag}.zip` }]) {
  return { tag_name: tag, html_url: `https://github.com/x/releases/tag/${tag}`, assets, body: "notes", published_at: "2026-10-17T00:00:00Z" };
}

test("version parsing and comparison", () => {
  assert.deepEqual(parseVersion("2.4.0.0"), [2, 4, 0, 0]);
  assert.deepEqual(parseVersion("v2.10"), [2, 10]);
  assert.equal(isNewerVersion("2.4.1", "2.4.0.0"), true);
  assert.equal(isNewerVersion("2.10", "2.9.9.9"), true);
  assert.equal(isNewerVersion("2.4.0.0", "2.4.0.0"), false);
  assert.equal(isNewerVersion("2.3.9", "2.4.0.0"), false);
});

test("pickZipAsset", () => {
  assert.equal(pickZipAsset([{ name: "a.sig" }, { name: "Openray-2.4.1-win-x64.zip" }])?.name, "Openray-2.4.1-win-x64.zip");
  assert.equal(pickZipAsset([]), null);
  assert.equal(pickZipAsset(undefined), null);
});

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  impl.calls = calls;
  return impl;
}

function makeModule({ appVersion = "2.4.0.0", fetchImpl, dataRoot }) {
  const pushes = [];
  const dispatched = [];
  dataRoot = dataRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "openray-updates-"));
  const mod = createUpdates({
    pushToFrontend: (method, data) => pushes.push({ method, data }),
    dispatch: async (module, method, data) => dispatched.push({ module, method, data }),
    fetchImpl,
    appVersion,
    repo: "x/y",
    dataRoot,
  });
  return { mod, pushes, dispatched, dataRoot };
}

test("getState starts unavailable and a check against a newer release flips it", async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, json: async () => release("v2.5.0") }));
  const { mod, pushes } = makeModule({ fetchImpl });
  assert.equal(mod.snapshot().available, false);

  const state = await mod.handlers.check();
  assert.equal(state.available, true);
  assert.equal(state.latestVersion, "v2.5.0");
  assert.equal(state.downloadUrl, "https://x/v2.5.0.zip");
  assert.equal(state.lastError, null);
  assert.ok(pushes.length >= 2); // checking=true push + final push
  assert.equal(pushes.at(-1).method, "updates.changed");
  mod.close();
});

test("same or older release stays unavailable; 404 is not an error", async () => {
  const fetchImpl = fakeFetch((url) =>
    url.includes("releases/latest")
      ? { ok: true, status: 200, json: async () => release("v2.4.0.0") }
      : { ok: false, status: 404 });
  const { mod } = makeModule({ fetchImpl });
  const state = await mod.handlers.check();
  assert.equal(state.available, false);
  assert.equal(state.lastError, null);
  mod.close();

  const mod2 = makeModule({
    fetchImpl: fakeFetch(() => ({ ok: false, status: 404 })),
  });
  const state2 = await mod2.mod.handlers.check();
  assert.equal(state2.available, false);
  assert.equal(state2.lastError, null);
  mod2.mod.close();
});

test("skipVersion hides the card and persists across instances", async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, json: async () => release("v2.5.0") }));
  const first = makeModule({ fetchImpl, appVersion: "2.4.0.0" });
  await first.mod.handlers.check();
  assert.equal(first.mod.snapshot().available, true);
  await first.mod.handlers.skipVersion({ version: "v2.5.0" });
  assert.equal(first.mod.snapshot().available, false);
  first.mod.close();

  // A fresh instance (restart) restores the skip from updates-state.json.
  const second = makeModule({ fetchImpl, appVersion: "2.4.0.0", dataRoot: first.dataRoot });
  await second.mod.handlers.check();
  assert.equal(second.mod.snapshot().available, false);
  second.mod.close();

  // A newer release overrides the skip.
  const third = makeModule({
    fetchImpl: fakeFetch(() => ({ ok: true, status: 200, json: async () => release("v2.6.0") })),
    appVersion: "2.4.0.0",
    dataRoot: first.dataRoot,
  });
  await third.mod.handlers.check();
  assert.equal(third.mod.snapshot().available, true);
  third.mod.close();
});

test("install downloads the zip asset and reveals it via the host", async () => {
  const zipBytes = Buffer.from("PK\x03\x04 fake zip");
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("releases/latest")) return { ok: true, status: 200, json: async () => release("v2.5.0") };
    // `Readable.fromWeb` needs a real WHATWG ReadableStream, exactly what `fetch` hands back.
    return { ok: true, status: 200, body: new Response(zipBytes).body };
  });
  const { mod, dispatched } = makeModule({ fetchImpl });
  await mod.handlers.check();
  const result = await mod.handlers.install();
  assert.ok(fs.existsSync(result.path));
  assert.deepEqual(fs.readFileSync(result.path), zipBytes);
  assert.equal(result.path, path.join(os.tmpdir(), "Openray-update", "Openray-2.5.0-win-x64.zip"));
  assert.deepEqual(dispatched, [{ module: "backend", method: "shell.revealFile", data: { path: result.path } }]);

  // Install without an available update is refused.
  await mod.handlers.skipVersion({ version: "v2.5.0" });
  await assert.rejects(() => mod.handlers.install(), /no update available/);
  mod.close();
});

test("install without a zip asset fails with a typed error", async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, json: async () => release("v2.5.0", [{ name: "sig.txt", browser_download_url: "https://x/sig" }]) }));
  const { mod } = makeModule({ fetchImpl, appVersion: "2.4.0.0" });
  await mod.handlers.check();
  assert.equal(mod.snapshot().available, true); // release is newer even without an asset
  await assert.rejects(() => mod.handlers.install(), /no update available/);
  mod.close();
});
