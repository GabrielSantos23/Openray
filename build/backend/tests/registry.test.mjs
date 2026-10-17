import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry, needsUi } from "../src/registry.js";

function demoRegistry() {
  const registry = createRegistry();
  registry.register([
    {
      id: "math.add",
      title: "Add",
      description: "Adds two numbers.",
      risk: "read",
      params: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
        additionalProperties: false,
      },
      run: (params) => ({ sum: params.a + params.b }),
    },
    {
      id: "math.fail",
      title: "Fail",
      description: "Always fails with a typed error.",
      risk: "read",
      run: () => {
        throw needsUi("the launcher window is closed");
      },
    },
  ]);
  return registry;
}

test("register, list and describe", () => {
  const registry = demoRegistry();
  assert.equal(registry.get("math.add").risk, "read");
  assert.deepEqual(
    registry.list({ filter: "add" }).map((c) => c.id),
    ["math.add"],
  );
  const described = registry.describe("math.add");
  assert.equal(described.params.required[0], "a");
  assert.equal(registry.describe("nope.nope"), null);
});

test("duplicate ids are rejected", () => {
  const registry = demoRegistry();
  assert.throws(() => registry.register([{ id: "math.add", risk: "read", run: () => {} }]), /duplicate/);
});

test("invalid specs are rejected", () => {
  const registry = createRegistry();
  assert.throws(() => registry.register([{ id: "no-dot", risk: "read", run: () => {} }]), /dot-separated/);
  assert.throws(() => registry.register([{ id: "a.b", risk: "explode", run: () => {} }]), /risk/);
  assert.throws(() => registry.register([{ id: "a.b", risk: "read" }]), /run/);
});

test("dispatch returns the success envelope", async () => {
  const registry = demoRegistry();
  const envelope = await registry.dispatch("math.add", { a: 2, b: 3 });
  assert.deepEqual(envelope, { ok: true, result: { sum: 5 } });
});

test("validation errors: missing, wrong-type and unknown fields", async () => {
  const registry = demoRegistry();
  const missing = await registry.dispatch("math.add", { a: 1 });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "invalid_params");
  assert.match(missing.error.message, /b is required/);

  const wrongType = await registry.dispatch("math.add", { a: "x", b: 1 });
  assert.equal(wrongType.error.code, "invalid_params");

  const unknown = await registry.dispatch("math.add", { a: 1, b: 2, extra: true });
  assert.match(unknown.error.message, /not an accepted field/);

  const nonObject = await registry.dispatch("math.add", [1, 2]);
  assert.equal(nonObject.error.code, "invalid_params");
});

test("unknown commands return the typed envelope", async () => {
  const registry = demoRegistry();
  const envelope = await registry.dispatch("nope.nope", {});
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "unknown_command");
});

test("destructive commands are refused without the opt-in", async () => {
  const registry = createRegistry();
  let ran = false;
  registry.register([
    {
      id: "notes.deleteAll",
      title: "Delete all",
      risk: "destructive",
      run: () => {
        ran = true;
        return { ok: true };
      },
    },
  ]);
  const refused = await registry.dispatch("notes.deleteAll", {});
  assert.equal(refused.error.code, "destructive_refused");
  assert.equal(ran, false);
  const allowed = await registry.dispatch("notes.deleteAll", {}, { allowDestructive: true });
  assert.equal(allowed.ok, true);
  assert.equal(ran, true);
});

test("handler exceptions become error envelopes, never escapes", async () => {
  const registry = demoRegistry();
  const typed = await registry.dispatch("math.fail", {});
  assert.equal(typed.ok, false);
  assert.equal(typed.error.code, "needs_ui");

  registry.register([
    {
      id: "chaos.break",
      title: "Break",
      risk: "read",
      run: () => {
        throw new TypeError("cannot read properties of undefined");
      },
    },
  ]);
  const raw = await registry.dispatch("chaos.break", {});
  assert.equal(raw.ok, false);
  assert.equal(raw.error.code, "internal");
});

test("event bus and ring buffer", async () => {
  const registry = demoRegistry();
  const seen = [];
  const off = registry.subscribe((event) => seen.push(event.name));
  await registry.dispatch("math.add", { a: 1, b: 1 });
  registry.emit("settings.changed", {});
  assert.ok(seen.includes("command.started"));
  assert.ok(seen.includes("command.finished"));
  assert.ok(seen.includes("settings.changed"));
  off();
  registry.emit("after.off", {});
  assert.equal(seen.includes("after.off"), false);

  const names = registry.recentEvents().map((e) => e.name);
  assert.ok(names.includes("registry.changed"));
  assert.ok(names.includes("command.started"));
  const failed = await registry.dispatch("math.fail", {});
  assert.equal(failed.ok, false);
  assert.ok(registry.recentEvents().some((e) => e.name === "command.failed"));
});

test("ring buffer stays bounded", async () => {
  const registry = createRegistry();
  for (let i = 0; i < 700; i++) registry.emit("noise.tick", { i });
  assert.equal(registry.recentEvents({ limit: 1000 }).length, 500);
});

test("failing subscribers do not break dispatch", async () => {
  const registry = demoRegistry();
  registry.subscribe(() => {
    throw new Error("subscriber exploded");
  });
  const envelope = await registry.dispatch("math.add", { a: 1, b: 2 });
  assert.equal(envelope.ok, true);
});
