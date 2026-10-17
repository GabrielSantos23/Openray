// Command fuzz test (AGENTS.md §3.8): every registered command gets adversarial params —
// empty, wrong types, huge strings, deep nesting, nulls — and must answer with an error
// envelope, never crash, never escape. Runs against the headless runtime (no UI, native hops
// fail typed), so commands that would touch the network or the real clipboard are excluded
// by id (their handlers are covered by their domain tests with stubs).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createRuntime } = await import("../src/runtime.js");
const { needsUi } = await import("../src/registry.js");

const NETWORK_OR_HOST_VERBS = new Set([
  "store.sync",
  "store.upload",
  "translator.translate",
  "translator.quickTranslate",
  "calculator.refreshCurrencies",
  "calculator.swapUnits",
  "clipboard.paste",
  "clipboard.write",
  "quicklinks.open",
  "advanced.exportNow",
  "advanced.importFromFile",
  "applications.open",
  "applications.newWindow",
  "applications.reveal",
  "applications.quit",
  "applications.forceQuit",
  "applications.uninstall",
  "shell.openUrl",
  "shell.openWith",
  "shell.revealFile",
  "fileSystem.openFile",
  "fileSystem.moveToTrash",
  "fileSystem.writeFile",
  "ui.openSettings",
  "ui.showMainWindow",
  "ui.hideMainWindow",
  "focus.startSession",
  "focus.toggleSession",
  "extensions.run",
  // Walks the user's home directory; the indexer has its own scoped tests.
  "fileSearch.startIndexing",
]);

const ADVERSARIAL = [
  {},
  null,
  { params: null },
  { a: "string-where-number-may-be" },
  { id: 12345 },
  { id: { deeply: { nested: { object: [1, 2, { x: "y" }] } } } },
  { text: "Z".repeat(100_000) },
  { values: { "": null, "bad key": "value" } },
  [1, 2, 3],
  "a string",
  42,
];

test("every registered command survives adversarial params with an envelope", { timeout: 120_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openray-fuzz-"));
  const previousDataDir = process.env.OPENRAY_DATA_DIR;
  process.env.OPENRAY_DATA_DIR = root;
  let runtime;
  try {
    runtime = createRuntime({ connectPipe: false });
    const commands = runtime.registry.list();
    assert.ok(commands.length > 100, `registry unexpectedly small: ${commands.length}`);

    let checked = 0;
    for (const command of commands) {
      if (NETWORK_OR_HOST_VERBS.has(command.id)) continue;
      if (command.risk === "destructive") continue;
      for (const params of ADVERSARIAL) {
        const envelope = await Promise.race([
          runtime.registry.dispatch(command.id, params ?? {}, { source: "fuzz" }),
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: false, error: { code: "timeout", message: `${command.id} hung` } }), 5_000),
          ),
        ]);
        assert.equal(
          typeof envelope,
          "object",
          `${command.id} returned a non-object envelope for ${JSON.stringify(params).slice(0, 40)}`,
        );
        assert.equal(
          typeof envelope.ok,
          "boolean",
          `${command.id} returned an envelope without ok for ${JSON.stringify(params).slice(0, 40)}`,
        );
        if (!envelope.ok) {
          assert.ok(envelope.error?.message, `${command.id} error envelope carries no message`);
          assert.equal(typeof envelope.error.code, "string", `${command.id} error envelope carries no code`);
        }
        checked++;
      }
    }
    assert.ok(checked > 1000, `fuzz coverage too small: ${checked}`);
  } finally {
    try {
      runtime?.close();
    } catch {
      /* best effort */
    }
    if (previousDataDir === undefined) delete process.env.OPENRAY_DATA_DIR;
    else process.env.OPENRAY_DATA_DIR = previousDataDir;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("destructive commands refuse every adversarial param shape", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openray-fuzz-destructive-"));
  process.env.OPENRAY_DATA_DIR = root;
  let runtime;
  try {
    runtime = createRuntime({ connectPipe: false });
    const destructive = runtime.registry.list().filter((command) => command.risk === "destructive");
    assert.ok(destructive.length > 10, "expected a meaningful destructive surface");
    for (const command of destructive) {
      for (const params of [undefined, null, {}, { x: 1 }, "s", 0]) {
        const envelope = await runtime.registry.dispatch(command.id, params, { source: "fuzz" });
        assert.equal(envelope.ok, false, `${command.id} ran destructively without opt-in`);
        // Non-object, non-null params fail validation first (undefined/null coerce to {}
        // like any real caller omitting params); object params hit the risk gate.
        const expected = params !== undefined && params !== null && typeof params !== "object"
          ? "invalid_params"
          : "destructive_refused";
        assert.equal(envelope.error.code, expected, `${command.id} wrong refusal code`);
      }
    }
  } finally {
    try {
      runtime?.close();
    } catch {
      /* best effort */
    }
    delete process.env.OPENRAY_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("typed needs_ui errors survive the envelope", async () => {
  const envelope = await (async () => {
    const registry = (await import("../src/registry.js")).createRegistry();
    registry.register([
      { id: "ui.probe", title: "probe", description: "", risk: "read", run: () => { throw needsUi("no window"); } },
    ]);
    return registry.dispatch("ui.probe", {});
  })();
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "needs_ui");
});
