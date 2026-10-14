// M5a (docs/flowkey-migration-plan.md): the OAuth vault. Bring-your-own client id (the FlowKey
// pattern — `spotify-auth.json` next to the data dir or the FLOWKEY_SPOTIFY_CLIENT_ID env var),
// PKCE over a loopback redirect on 127.0.0.1 with a fixed configurable port, and per-provider
// token files under `<dataRoot>/oauth/`. Tokens never leave the backend: extensions see only
// `oauth.status` shapes and let `http.fetch({ auth: provider })` inject the Authorization header.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const OAUTH_DIR = "oauth";
const DEFAULT_REDIRECT_PORT = 42749;
const EXPIRY_SKEW_MS = 60_000;

const PROVIDERS = {
  spotify: {
    authorizeUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes: "user-read-playback-state user-modify-playback-state user-read-currently-playing",
    envVar: "FLOWKEY_SPOTIFY_CLIENT_ID",
    configFile: "spotify-auth.json",
  },
};

function oauthDir(dataRoot) {
  return path.join(dataRoot, OAUTH_DIR);
}

/**
 * BYO client id: env var wins, then `<dataRoot>/oauth/<provider>-auth.json`
 * (`{"clientId":"...","redirectPort":0}`). Mirrors FlowKey's SpotifyAuthConfig.
 */
function loadProviderConfig(dataRoot, provider) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown oauth provider ${provider}`);
  let fromFile = null;
  let redirectPort = DEFAULT_REDIRECT_PORT;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(oauthDir(dataRoot), spec.configFile), "utf-8"));
    if (typeof raw.clientId === "string" && raw.clientId.trim() !== "") fromFile = raw.clientId.trim();
    if (Number.isInteger(raw.redirectPort) && raw.redirectPort > 0 && raw.redirectPort <= 65535) {
      redirectPort = raw.redirectPort;
    }
  } catch {
    /* no config file */
  }
  const fromEnv = process.env[spec.envVar];
  const clientId = fromEnv && fromEnv.trim() !== "" ? fromEnv.trim() : fromFile;
  return { clientId, redirectPort };
}

function vaultPath(dataRoot, provider) {
  return path.join(oauthDir(dataRoot), `${provider}.tokens.json`);
}

function vaultWrite(dataRoot, provider, tokens) {
  fs.mkdirSync(oauthDir(dataRoot), { recursive: true });
  fs.writeFileSync(vaultPath(dataRoot, provider), JSON.stringify(tokens, null, 2));
}

function vaultRead(dataRoot, provider) {
  try {
    return JSON.parse(fs.readFileSync(vaultPath(dataRoot, provider), "utf-8"));
  } catch {
    return null;
  }
}

function vaultClear(dataRoot, provider) {
  try {
    fs.rmSync(vaultPath(dataRoot, provider), { force: true });
  } catch {
    /* already gone */
  }
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildAuthorizeUrl(spec, { clientId, redirectPort, verifier, state }) {
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", spec.scopes);
  url.searchParams.set("redirect_uri", `http://127.0.0.1:${redirectPort}/oauth/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  return url.toString();
}

/** One loopback wait: a server on the fixed port that resolves on the first matching callback. */
function startLoopbackWait(redirectPort, state, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${redirectPort}`);
      if (url.pathname !== "/oauth/callback") {
        response.writeHead(404).end();
        return;
      }
      const finish = (payload) => {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<html><body><script>window.close()</script>Sign-in complete — you can close this tab.</body></html>");
        server.close();
        server.unref();
        resolve(payload);
      };
      const error = url.searchParams.get("error");
      if (error) {
        finish({ error: `${error}: ${url.searchParams.get("error_description") ?? "provider rejected the sign-in"}` });
        return;
      }
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400).end("state mismatch");
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        response.writeHead(400).end("missing code");
        return;
      }
      finish({ code });
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`oauth loopback server failed on port ${redirectPort}: ${error.message}`));
    });
    const timer = setTimeout(() => {
      server.close();
      server.unref();
      reject(new Error(`oauth sign-in timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    server.listen(redirectPort, "127.0.0.1");
  });
}

async function exchangeCode(spec, { clientId, redirectPort, code, verifier, fetchImpl }) {
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(spec.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `http://127.0.0.1:${redirectPort}/oauth/callback`,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`oauth token exchange failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function refreshTokens(spec, { clientId, refreshToken, fetchImpl }) {
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(spec.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`oauth refresh failed: HTTP ${response.status}`);
  }
  return response.json();
}

function statusShape(tokens) {
  if (!tokens?.accessToken) return { ok: false };
  return { ok: true, expiresAt: tokens.expiresAt ?? null, scope: tokens.scope ?? null };
}

/**
 * Full browser PKCE flow: config -> verifier/state -> loopback wait -> open() -> exchange ->
 * vault. `open(url)` opens the sign-in page (the backend's shell.open route).
 */
async function authorize(dataRoot, provider, { clientIdOverride, open, fetchImpl, timeoutMs } = {}) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown oauth provider ${provider}`);
  const config = loadProviderConfig(dataRoot, provider);
  const clientId = clientIdOverride || config.clientId;
  if (!clientId) {
    throw new Error(
      `${provider} client id is not configured. Set the ${spec.envVar} environment variable or create ` +
        `${path.join(oauthDir(dataRoot), spec.configFile)} with {"clientId":"..."} — see README 'Bring your own ${provider} app'.`,
    );
  }
  const verifier = base64url(crypto.randomBytes(48));
  const state = base64url(crypto.randomBytes(24));
  const loopback = startLoopbackWait(config.redirectPort, state, { timeoutMs });
  const url = buildAuthorizeUrl(spec, { clientId, redirectPort: config.redirectPort, verifier, state });
  await open(url);
  const callback = await loopback;
  if (callback.error) throw new Error(callback.error);
  const tokens = await exchangeCode(spec, {
    clientId,
    redirectPort: config.redirectPort,
    code: callback.code,
    verifier,
    fetchImpl,
  });
  const vault = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    scope: tokens.scope ?? spec.scopes,
  };
  vaultWrite(dataRoot, provider, vault);
  return statusShape(vault);
}

/**
 * Vaulted token good for at least `EXPIRY_SKEW_MS`, refreshed when needed. Returns null when
 * the provider is not signed in; throws when a refresh is attempted and fails (the extension
 * can then re-authorize).
 */
async function getValidToken(dataRoot, provider, { fetchImpl, now = Date.now } = {}) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown oauth provider ${provider}`);
  const tokens = vaultRead(dataRoot, provider);
  if (!tokens?.accessToken) return null;
  const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : 0;
  if (expiresAt - now() > EXPIRY_SKEW_MS) return tokens;
  if (!tokens.refreshToken) {
    vaultClear(dataRoot, provider);
    return null;
  }
  const config = loadProviderConfig(dataRoot, provider);
  if (!config.clientId) {
    vaultClear(dataRoot, provider);
    return null;
  }
  const refreshed = await refreshTokens(spec, { clientId: config.clientId, refreshToken: tokens.refreshToken, fetchImpl });
  const next = {
    accessToken: refreshed.access_token,
    // Spotify does not always rotate the refresh token; keep the old one when absent.
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
    scope: refreshed.scope ?? tokens.scope,
  };
  vaultWrite(dataRoot, provider, next);
  return next;
}

module.exports = {
  DEFAULT_REDIRECT_PORT,
  PROVIDERS,
  authorize,
  buildAuthorizeUrl,
  exchangeCode,
  getValidToken,
  loadProviderConfig,
  startLoopbackWait,
  statusShape,
  vaultClear,
  vaultPath,
  vaultRead,
  vaultWrite,
};
