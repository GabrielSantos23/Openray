// Control channel: auth, risk gate, schema errors and the loopback bind. The server runs
// against a small in-memory registry plus a fake backend transport.

import test from "node:test";
import assert from "node:assert/strict";
import { createControlServer, writeControlToken, readControlToken } from "../src/control-server.js";
import { createRegistry } from "../src/registry.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN = "a".repeat(64);

function demoDeps() {
  const registry = createRegistry();
  registry.register([
    {
      id: "math.double",
      title: "Double",
      description: "Doubles a number.",
      risk: "read",
      params: {
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      },
      run: (params) => ({ n: params.n * 2 }),
    },
    {
      id: "notes.wipe",
      title: "Wipe",
      description: "Destroys everything.",
      risk: "destructive",
      run: () => ({ wiped: true }),
    },
  ]);
  const calls = [];
  const backend = {
    dispatch: async (module, method, data) => {
      calls.push([module, method, data]);
      if (method === "window.controlState") return { window: "launcher", view: "root", query: "" };
      if (method === "window.controlInput") return { ok: true };
      if (method === "window.capture") return { png: Buffer.from("png").toString("base64") };
      return null;
    },
  };
  return { registry, backend, calls };
}

async function start(deps, port = 0) {
  const control = await createControlServer({ ...deps, token: TOKEN, port });
  return { ...control, base: `http://127.0.0.1:${control.port}` };
}

async function call(base, path, { method = "GET", token = TOKEN, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, payload, contentType };
}

test("auth: missing, wrong and malformed tokens are refused", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    const none = await call(control.base, "/commands", { token: "" });
    assert.equal(none.status, 401);
    assert.equal(none.payload.error.code, "unauthorized");
    const wrong = await call(control.base, "/commands", { token: "b".repeat(64) });
    assert.equal(wrong.status, 401);
    const garbage = await call(control.base, "/commands", { token: "Basic xyz" });
    assert.equal(garbage.status, 401);
  } finally {
    await control.close();
  }
});

test("the server binds to 127.0.0.1 only", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    assert.ok(control.address.startsWith("127.0.0.1:"));
  } finally {
    await control.close();
  }
});

test("list, describe and run a command", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    const list = await call(control.base, "/commands?filter=double");
    assert.equal(list.status, 200);
    assert.deepEqual(list.payload.result.commands.map((c) => c.id), ["math.double"]);

    const described = await call(control.base, "/commands/math.double");
    assert.equal(described.payload.result.params.required[0], "n");

    const run = await call(control.base, "/commands/math.double/run", { method: "POST", body: { params: { n: 21 } } });
    assert.deepEqual(run.payload, { ok: true, result: { n: 42 } });

    const unknown = await call(control.base, "/commands/nope.nothing");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.error.code, "unknown_command");
  } finally {
    await control.close();
  }
});

test("schema errors return invalid_params", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    const bad = await call(control.base, "/commands/math.double/run", { method: "POST", body: { params: { n: "x" } } });
    assert.equal(bad.payload.ok, false);
    assert.equal(bad.payload.error.code, "invalid_params");
    const extra = await call(control.base, "/commands/math.double/run", { method: "POST", body: { params: { n: 1, zzz: true } } });
    assert.equal(extra.payload.error.code, "invalid_params");
    const malformed = await call(control.base, "/commands/math.double/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: undefined,
    });
    assert.equal(malformed.status, 200); // empty body -> empty params -> invalid via schema
    assert.equal(malformed.payload.error.code, "invalid_params");
  } finally {
    await control.close();
  }
});

test("the risk gate refuses destructive commands without the flag", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    const refused = await call(control.base, "/commands/notes.wipe/run", { method: "POST", body: { params: {} } });
    assert.equal(refused.payload.error.code, "destructive_refused");
    const allowed = await call(control.base, "/commands/notes.wipe/run", {
      method: "POST",
      body: { params: {}, allowDestructive: true },
    });
    assert.deepEqual(allowed.payload, { ok: true, result: { wiped: true } });
  } finally {
    await control.close();
  }
});

test("get_state, send_input and screenshot round-trip through the host", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    const state = await call(control.base, "/state");
    assert.equal(state.payload.result.window, "launcher");
    assert.deepEqual(deps.calls.at(-1), ["frontend", "window.controlState", {}]);

    const input = await call(control.base, "/input", { method: "POST", body: { type: "key", key: "ArrowDown" } });
    assert.deepEqual(input.payload.result, { ok: true });
    assert.deepEqual(deps.calls.at(-1), ["frontend", "window.controlInput", { type: "key", key: "ArrowDown" }]);

    const badInput = await call(control.base, "/input", { method: "POST", body: {} });
    assert.equal(badInput.status, 400);

    const shot = await call(control.base, "/screenshot");
    assert.equal(shot.contentType, "image/png");
    assert.equal(shot.payload.toString("utf-8"), "png");
  } finally {
    await control.close();
  }
});

test("events exposes the registry ring buffer", async () => {
  const deps = demoDeps();
  const control = await start(deps);
  try {
    await call(control.base, "/commands/math.double/run", { method: "POST", body: { params: { n: 1 } } });
    const events = await call(control.base, "/events");
    const names = events.payload.result.events.map((e) => e.name);
    assert.ok(names.includes("command.started"));
    assert.ok(names.includes("command.finished"));
  } finally {
    await control.close();
  }
});

test("token file round-trips through the user data root", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openray-control-"));
  try {
    assert.equal(readControlToken(dir), null);
    const { token, file } = writeControlToken(dir);
    assert.equal(readControlToken(dir), token);
    assert.ok(fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
