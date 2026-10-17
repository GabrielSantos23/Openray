// A7 (docs/flowkey-migration-plan.md M5a): the OAuth vault — BYO client id config, PKCE authorize
// URL, the loopback callback server (real HTTP), the token exchange/refresh (stubbed fetch), the
// per-provider token files, and the backend routes (secrets round trip through a real worker,
// http.fetch auth-injection consent checks, image.fetch allowlist, oauth.status on an empty
// vault). These tests replace the removed clipboard-handshake tests.
//
// No external network: token endpoints are stubbed; the loopback server is 127.0.0.1.

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
const API_ROOT = path.join(buildRoot, "api");
const FLOWKEY = path.join(buildRoot, "flowkey");
const CONTRACT_SRC = path.join(here, "fixtures", "flowkey", "contract-src");
const vault = require(path.join(buildRoot, "backend", "src", "flowkey-vault.js"));
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));
const vendorRequire = createRequire(path.join(FLOWKEY, "vendor", "package.json"));

const UUID = "contract-probe-uuid";
let pipeSeq = 0;

test("loadProviderConfig: env wins over the auth json; redirectUri overrides the default callback", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-config-"));
  try {
    const oauthDir = path.join(dataRoot, "oauth");
    fs.mkdirSync(oauthDir, { recursive: true });
    fs.writeFileSync(
      path.join(oauthDir, "spotify-auth.json"),
      JSON.stringify({ clientId: "file-id" }),
    );
    const fromFile = vault.loadProviderConfig(dataRoot, "spotify");
    assert.deepEqual(fromFile, { clientId: "file-id", redirectUri: null });
    assert.equal(vault.redirectUriOf(fromFile), vault.DEFAULT_REDIRECT_URI, "no override falls back to the registered default");

    fs.writeFileSync(
      path.join(oauthDir, "spotify-auth.json"),
      JSON.stringify({ clientId: "file-id", redirectUri: "http://127.0.0.1:51515/callback" }),
    );
    const overridden = vault.loadProviderConfig(dataRoot, "spotify");
    assert.equal(overridden.redirectUri, "http://127.0.0.1:51515/callback", "a loopback redirectUri override is honored");
    assert.equal(vault.redirectUriOf(overridden), "http://127.0.0.1:51515/callback");
    // Non-loopback overrides are refused (Spotify requires https except 127.0.0.1 loopback).
    fs.writeFileSync(
      path.join(oauthDir, "spotify-auth.json"),
      JSON.stringify({ clientId: "file-id", redirectUri: "https://evil.example/callback" }),
    );
    assert.equal(vault.loadProviderConfig(dataRoot, "spotify").redirectUri, null);

    process.env.FLOWKEY_SPOTIFY_CLIENT_ID = "env-id";
    try {
      const fromEnv = vault.loadProviderConfig(dataRoot, "spotify");
      assert.deepEqual(fromEnv, { clientId: "env-id", redirectUri: null });
      assert.equal(vault.redirectUriOf(fromEnv), vault.DEFAULT_REDIRECT_URI);
    } finally {
      delete process.env.FLOWKEY_SPOTIFY_CLIENT_ID;
    }

    fs.writeFileSync(path.join(oauthDir, "spotify-auth.json"), "{not json");
    const broken = vault.loadProviderConfig(dataRoot, "spotify");
    assert.equal(broken.clientId, null, "broken config falls back to env/none");
    assert.equal(broken.redirectUri, null);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("authorize requires a configured client id with the BYO error text", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-byo-"));
  try {
    await assert.rejects(
      () => vault.authorize(dataRoot, "spotify", { open: async () => undefined }),
      /FLOWKEY_SPOTIFY_CLIENT_ID|client id is not configured/,
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("buildAuthorizeUrl: PKCE S256 challenge matches the verifier, loopback redirect, fixed scopes", () => {
  const spec = vault.PROVIDERS.spotify;
  const url = new URL(
    vault.buildAuthorizeUrl(spec, {
      clientId: "byo-id",
      redirectUri: "http://127.0.0.1:42749/oauth/callback",
      verifier: "test-verifier",
      state: "test-state",
    }),
  );
  assert.equal(url.origin + url.pathname, spec.authorizeUrl);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "byo-id");
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:42749/oauth/callback");
  const { createHash } = require("node:crypto");
  const expected = createHash("sha256").update("test-verifier").digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(url.searchParams.get("code_challenge"), expected);
  assert.ok(spec.scopes.includes("user-read-playback-state"));
});

test("loopback callback: state match resolves the code, mismatch is rejected, provider errors surface", async () => {
  const call = (port, route) =>
    new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${route}`, (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve({ status: response.statusCode, body }));
        })
        .on("error", reject);
    });

  // Resolve path.
  {
    const wait = vault.startLoopbackWait("http://127.0.0.1:42801/oauth/callback", "state-1", { timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const response = await call(42801, "/oauth/callback?code=abc&state=state-1");
    assert.equal(response.status, 200);
    const payload = await wait;
    assert.deepEqual(payload, { code: "abc" });
  }
  // A custom path override is honored end to end.
  {
    const wait = vault.startLoopbackWait("http://127.0.0.1:42804/my/callback", "state-4", { timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const wrong = await call(42804, "/oauth/callback?code=abc&state=state-4");
    assert.equal(wrong.status, 404, "the default path is not accepted under an override");
    const right = await call(42804, "/my/callback?code=xyz&state=state-4");
    assert.equal(right.status, 200);
    assert.deepEqual(await wait, { code: "xyz" });
  }
  // Mismatched state -> HTTP 400, the wait stays pending.
  {
    const wait = vault.startLoopbackWait("http://127.0.0.1:42802/oauth/callback", "state-2", { timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const response = await call(42802, "/oauth/callback?code=abc&state=WRONG");
    assert.equal(response.status, 400);
    const response2 = await call(42802, "/oauth/callback?code=abc&state=state-2");
    assert.equal(response2.status, 200);
    assert.deepEqual(await wait, { code: "abc" });
  }
  // Provider error -> resolved payload carries the error text.
  {
    const wait = vault.startLoopbackWait("http://127.0.0.1:42803/oauth/callback", "state-3", { timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await call(42803, "/oauth/callback?error=access_denied&error_description=user+said+no&state=state-3");
    const payload = await wait;
    assert.match(payload.error, /access_denied: user said no/);
  }
});

test("exchangeCode posts the PKCE form; authorize() end to end with stubbed fetch and a real loopback", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-e2e-"));
  const opened = [];
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 3600,
        scope: "user-read-playback-state",
      }),
    };
  };
  try {
    // BYO client id + explicit redirect override (keeps the test off the shared default port).
    const overrideUri = "http://127.0.0.1:42805/my/callback";
    fs.mkdirSync(path.join(dataRoot, "oauth"), { recursive: true });
    fs.writeFileSync(
      path.join(dataRoot, "oauth", "spotify-auth.json"),
      JSON.stringify({ clientId: "byo-id", redirectUri: overrideUri }),
    );
    const status = await vault.authorize(dataRoot, "spotify", {
      clientIdOverride: "byo-id",
      open: async (url) => {
        opened.push(url);
        // Simulate the browser landing on the loopback callback.
        const redirect = new URL(new URL(url).searchParams.get("redirect_uri"));
        await new Promise((resolve) => setTimeout(resolve, 100));
        await new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${redirect.port}${redirect.pathname}?code=the-code&state=${new URL(url).searchParams.get("state")}`, (r) => r.resume().on("close", resolve))
            .on("error", reject);
        });
      },
      fetchImpl,
    });
    assert.deepEqual(status, { ok: true, expiresAt: status.expiresAt, scope: "user-read-playback-state" });
    assert.match(status.expiresAt, /^\d{4}-/);
    assert.equal(opened.length, 1);
    assert.match(opened[0], /accounts\.spotify\.com\/authorize/);

    assert.equal(fetchCalls.length, 1);
    const body = new URLSearchParams(fetchCalls[0].options.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "the-code");
    assert.equal(body.get("client_id"), "byo-id");
    assert.ok(body.get("code_verifier").length >= 43, "PKCE verifier ships");
    assert.equal(body.get("redirect_uri"), "http://127.0.0.1:42805/my/callback");

    // The vault holds the tokens on disk.
    const tokens = vault.vaultRead(dataRoot, "spotify");
    assert.equal(tokens.accessToken, "at-1");
    assert.equal(tokens.refreshToken, "rt-1");

    // getValidToken returns the fresh token without touching the network.
    fetchCalls.length = 0;
    const fresh = await vault.getValidToken(dataRoot, "spotify", { fetchImpl });
    assert.equal(fresh.accessToken, "at-1");
    assert.equal(fetchCalls.length, 0);

    // Expired -> refresh via the stored refresh token; vault updated.
    tokens.expiresAt = new Date(Date.now() - 1000).toISOString();
    vault.vaultWrite(dataRoot, "spotify", tokens);
    const refreshed = await vault.getValidToken(dataRoot, "spotify", { fetchImpl });
    assert.equal(refreshed.accessToken, "at-1");
    assert.equal(fetchCalls.length, 1);
    const refreshBody = new URLSearchParams(fetchCalls[0].options.body);
    assert.equal(refreshBody.get("grant_type"), "refresh_token");
    assert.equal(refreshBody.get("refresh_token"), "rt-1");
    assert.equal(vault.vaultRead(dataRoot, "spotify").refreshToken, "rt-1", "refresh token kept when the provider does not rotate");

    // Expired with no refresh token -> cleared, null (extension must re-authorize).
    vault.vaultWrite(dataRoot, "spotify", { accessToken: "at-2", refreshToken: null, expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(await vault.getValidToken(dataRoot, "spotify", { fetchImpl }), null);
    assert.equal(vault.vaultRead(dataRoot, "spotify"), null);

    vault.vaultClear(dataRoot, "spotify");
    assert.equal(vault.vaultRead(dataRoot, "spotify"), null);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

// --- Backend routes through a real worker --------------------------------------------------

const withBackend = (fn) => async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-contract-"));
  try {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-data-"));
    try {
      const rendered = [];
      let seq = 0;
      const backend = createBackend({
        pipeName: `vault-contract-${++pipeSeq}`,
        apiRoot: API_ROOT,
        extensionsRoot: root,
        dataRoot,
      });
      backend.setTransport(async (_module, method, data) => {
        if (method === "extensionHost.render") data.__seq = ++seq;
        rendered.push({ method, data });
        return undefined;
      });
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
      const session = await backend.dispatchMessage("backend", "extensionHost.loadCommand", {
        extension: {
          uuid: UUID,
          name: "contract-probe",
          title: "contract-probe",
          author: "flowkey",
          commands: [{ name: "open", title: "Open", mode: "view", type: "command" }],
          assetsPath: path.join(extensionDir, "assets"),
        },
        command: { name: "open", title: "Open", mode: "view", type: "command" },
        preferences: {},
        debug: true,
      });
      try {
        // Wait for the first render, then run actions by title through the normal callback path.
        const deadline = Date.now() + 10000;
        let body = null;
        outer: while (Date.now() < deadline) {
          for (const entry of rendered) {
            if (entry.method !== "extensionHost.render") continue;
            const text = entry.data.gzipped
              ? require("node:zlib").gunzipSync(Buffer.from(entry.data.renderTree, "base64")).toString()
              : entry.data.renderTree;
            const candidate = JSON.parse(text).model?.navigationStack?.body ?? null;
            if (candidate?.kind === "List" && (candidate.sections ?? []).length > 0) {
              body = candidate;
              break outer;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.ok(body, "first render arrived");
        const vaultItem = body.sections.flatMap((section) => section.items).find((item) => item.id === "vault");
        assert.ok(vaultItem, "vault item rendered");
        await fn({ backend, session, vaultItem, rendered, dataRoot });
      } finally {
        await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: session.sessionId }).catch(() => undefined);
      }
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

function actionByTitle(item, title) {
  const action = item.actions.find((candidate) => candidate.title === title);
  assert.ok(action, `action ${title} present`);
  return action;
}

async function runAction(backend, session, action) {
  await backend.dispatchMessage("backend", "extensionHost.callNodeCallback", {
    sessionId: session.sessionId,
    callbackId: action.id,
    data: {},
  });
}

test(
  "backend routes through the worker: secrets round trip, oauth.status on an empty vault, consent gates",
  withBackend(async ({ backend, session, vaultItem, rendered, dataRoot }) => {
    // secrets round trip: set + get -> the item echo updates.
    await runAction(backend, session, actionByTitle(vaultItem, "Save secret"));
    await runAction(backend, session, actionByTitle(vaultItem, "OAuth status"));

    // The vault item re-renders with both echoes.
    const deadline = Date.now() + 10000;
    let body = null;
    outer: while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const entries = rendered.filter((entry) => entry.method === "extensionHost.render");
      for (let i = entries.length - 1; i >= 0; i--) {
        const text = entries[i].data.gzipped
          ? require("node:zlib").gunzipSync(Buffer.from(entries[i].data.renderTree, "base64")).toString()
          : entries[i].data.renderTree;
        const candidate = JSON.parse(text).model?.navigationStack?.body ?? null;
        const item = (candidate?.sections ?? []).flatMap((section) => section.items).find((entry) => entry.id === "vault");
        if (item?.subtitle?.includes("secret=probe-value") && item.subtitle.includes('oauth={"ok":false}')) {
          body = candidate;
          break outer;
        }
      }
    }
    assert.ok(body, "vault echoes updated (secret=probe-value, oauth status ok:false on an empty vault)");
    assert.ok(fs.existsSync(path.join(dataRoot, "oauth", "secrets", `${UUID}.json`)), "secrets file persisted under the data dir");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataRoot, "oauth", "secrets", `${UUID}.json`), "utf-8")), {
      "probe-key": "probe-value",
    });

    // Consent: an undeclared provider never reaches the vault (typed error through the worker).
    await assert.rejects(
      () => runAction(backend, session, actionByTitle(vaultItem, "OAuth status undeclared")),
      /oauth provider other is not declared in the manifest/,
    );

    // Headless guard: authorize fails fast instead of spawning a browser.
    await assert.rejects(
      () => runAction(backend, session, actionByTitle(vaultItem, "Authorize headless")),
      /OAuth sign-in is unavailable in headless mode/,
    );

    // image.fetch: an undeclared host is a typed error before any network.
    await assert.rejects(
      () => runAction(backend, session, actionByTitle(vaultItem, "Image bad host")),
      /evil\.example is not in the manifest httpHosts/,
    );

    // http.fetch auth injection consent: undeclared provider errors before any token lookup.
    await assert.rejects(
      () => runAction(backend, session, actionByTitle(vaultItem, "Fetch auth undeclared")),
      /provider other is not declared in the manifest oauth list/,
    );
    await assert.rejects(
      () => runAction(backend, session, actionByTitle(vaultItem, "Fetch auth not signed in")),
      /provider spotify is not signed in/,
    );
  }),
);

// image.fetch success path: the extension gets a renderer-loadable URL on the openray-img
// virtual host (the C# main window maps it onto the cache folder), with the bytes cached on disk.
test("image.fetch returns a virtual-host url for a declared loopback host", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  process.env.OPENRAY_TEST_IMAGE_URL = `http://127.0.0.1:${port}/icon.png`;
  try {
    await withBackend(async ({ backend, session, vaultItem, rendered, dataRoot }) => {
      await runAction(backend, session, actionByTitle(vaultItem, "Image data uri"));
      const deadline = Date.now() + 10000;
      let echo = null;
      outer: while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        const entries = rendered.filter((entry) => entry.method === "extensionHost.render");
        for (let i = entries.length - 1; i >= 0; i--) {
          const text = entries[i].data.gzipped
            ? require("node:zlib").gunzipSync(Buffer.from(entries[i].data.renderTree, "base64")).toString()
            : entries[i].data.renderTree;
          const item = (JSON.parse(text).model?.navigationStack?.body ?? null)?.sections
            ?.flatMap((section) => section.items)
            .find((entry) => entry.id === "vault");
          if (item?.subtitle?.includes("img=https://openray-img/")) {
            echo = item.subtitle;
            break outer;
          }
        }
      }
      assert.ok(echo, "vault echoes the fetched image as a virtual-host url");
      assert.match(echo, /img=https:\/\/openray-img\/[0-9a-f]{40}\.png/);
      const cacheDir = path.join(dataRoot, "oauth", "image-cache");
      const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
      assert.equal(cached.length, 1, "the fetched bytes are cached once under the data dir");
      assert.match(cached[0], /\.png$/);
    })();
  } finally {
    delete process.env.OPENRAY_TEST_IMAGE_URL;
    await new Promise((resolve) => server.close(resolve));
  }
});
