// The control channel (docs/control-protocol.md): a loopback-only HTTP server inside the Node
// backend that lets an agent run registry commands, read UI state, send input and capture the
// launcher window. Off by default; enabled with `--control` (argv) or OPENRAY_CONTROL=1.
// A random bearer token is generated per launch and required on every request except /health.

"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BODY_LIMIT = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createControlServer({ registry, backend, token, port = 0, host = "127.0.0.1" }) {
  function envelope(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  const ok = (res, result) => envelope(res, 200, { ok: true, result });
  const fail = (res, status, code, message, hint) =>
    envelope(res, status, { ok: false, error: { code, message, ...(hint ? { hint } : {}) } });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > BODY_LIMIT) {
          reject(new Error("request body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("request body must be JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  /** Every renderer/host round trip is bounded so a dead pipe cannot hang the agent. */
  function withTimeout(promise, what) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const error = new Error(`${what} timed out after ${REQUEST_TIMEOUT_MS}ms`);
          error.code = "timeout";
          error.hint = "is the app running with the pipe connected?";
          reject(error);
        }, REQUEST_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  }

  async function route(req, res, url) {
    const auth = req.headers.authorization ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!presented || !timingSafeEqual(presented, token)) {
      return fail(res, 401, "unauthorized", "missing or wrong bearer token", "read the token file path printed at startup");
    }

    if (req.method === "GET" && url.pathname === "/commands") {
      return ok(res, { commands: registry.list({ filter: url.searchParams.get("filter") ?? undefined, domain: url.searchParams.get("domain") ?? undefined }) });
    }

    const runMatch = req.method === "POST" && url.pathname.match(/^\/commands\/([^/]+)\/run$/);
    if (runMatch) {
      const body = await readBody(req);
      const result = await registry.dispatch(decodeURIComponent(runMatch[1]), body.params ?? {}, {
        allowDestructive: body.allowDestructive === true,
        source: "control-channel",
      });
      return envelope(res, 200, result);
    }

    const describeMatch = req.method === "GET" && url.pathname.match(/^\/commands\/([^/]+)$/);
    if (describeMatch) {
      const described = registry.describe(decodeURIComponent(describeMatch[1]));
      if (!described) return fail(res, 404, "unknown_command", `no such command: ${describeMatch[1]}`);
      return ok(res, described);
    }

    if (req.method === "GET" && url.pathname === "/state") {
      const state = await withTimeout(
        backend.dispatch("frontend", "window.controlState", {}),
        "get_state",
      );
      return ok(res, state ?? null);
    }

    if (req.method === "POST" && url.pathname === "/input") {
      const body = await readBody(req);
      if (!body || typeof body.type !== "string") {
        return fail(res, 400, "invalid_params", "input needs a type (text|setQuery|clear|backspace|key|action)");
      }
      const result = await withTimeout(
        backend.dispatch("frontend", "window.controlInput", body),
        "send_input",
      );
      return ok(res, result ?? null);
    }

    if (req.method === "GET" && url.pathname === "/screenshot") {
      const captured = await withTimeout(
        backend.dispatch("frontend", "window.capture", {}),
        "screenshot",
      );
      const png = captured?.png;
      if (typeof png !== "string") {
        return fail(res, 503, "needs_ui", "the launcher window could not be captured", "show the window and retry");
      }
      const bytes = Buffer.from(png, "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length });
      res.end(bytes);
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const since = Number(url.searchParams.get("since") ?? 0) || undefined;
      const limit = Number(url.searchParams.get("limit") ?? 200) || 200;
      return ok(res, { events: registry.recentEvents({ since, limit }) });
    }

    return fail(res, 404, "unknown_route", `no route for ${req.method} ${url.pathname}`);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    Promise.resolve()
      .then(() => route(req, res, url))
      .catch((error) => {
        if (res.headersSent) return res.end();
        const code = error?.code ?? "internal";
        const status = code === "timeout" ? 504 : code === "invalid_params" ? 400 : 500;
        fail(res, status, code, String(error?.message ?? error), error?.hint);
      });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback only, ever. The random port is reported so the token file can carry it.
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        address: `${host}:${actualPort}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** Random per-launch token, persisted where only the current user can read it. */
function writeControlToken(dataRoot) {
  const token = crypto.randomBytes(32).toString("hex");
  const dir = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "control-token");
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { token, file };
}

function readControlToken(dataRoot) {
  const dir = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  try {
    return fs.readFileSync(path.join(dir, "control-token"), "utf-8").trim();
  } catch {
    return null;
  }
}

module.exports = { createControlServer, writeControlToken, readControlToken };
