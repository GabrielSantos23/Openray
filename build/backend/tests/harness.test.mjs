// The harness test (docs/store-implementation-plan.md M5): the 15 candidate Store extensions are
// installed unmodified through the real pipeline and every command classified compatible must
// load in a worker. Disabled commands are asserted never launched. Network use is limited to the
// catalog commit, the extension sources and their dependencies (task allowance).

import assert from "node:assert/strict";
import test from "node:test";
import { runHarness, CANDIDATES } from "../../scripts/harness-report.mjs";

test("harness: all candidates classified compatible load; disabled commands never launch", { timeout: 20 * 60 * 1000 }, async () => {
  const report = await runHarness({ candidates: CANDIDATES });
  const lines = [];
  for (const entry of report.extensions) {
    lines.push(`${entry.handle}: ${entry.status}${entry.note ? ` (${entry.note})` : ""}`);
    for (const command of entry.commands) {
      lines.push(`   ${command.name} [${command.class}] ${command.harness}${command.reason ? ` — ${command.reason}` : ""}${command.note ? ` (${command.note})` : ""}`);
    }
  }
  // Full report in the output (also shown when the test fails).
  console.log(`\nharness report (commit ${report.commit}):\n${lines.join("\n")}\n`);

  // No silent errors: every candidate resolves to an honest status. `install-failed` is allowed
  // but must carry the reason (github: undeclared upstream devDependency `graphql-tag`).
  const errored = report.extensions.filter((entry) => entry.status === "error");
  assert.deepEqual(errored.map((entry) => `${entry.handle}: ${entry.note}`), [], "no harness errors");
  for (const entry of report.extensions.filter((candidate) => candidate.status === "install-failed")) {
    assert.ok(entry.note, `${entry.handle} install-failed must carry the reason`);
  }

  // Every compatible command loaded; disabled commands never attempted.
  for (const entry of report.extensions) {
    for (const command of entry.commands) {
      if (command.class === "compatible") {
        // auth-required: the command loads but parks on OAuth sign-in, which needs the app UI.
        assert.ok(
          command.harness === "pass" || command.harness === "auth-required",
          `${entry.handle}/${command.name} must load (got ${command.harness}: ${command.note})`,
        );
      } else {
        assert.equal(command.harness, "disabled-by-policy", `${entry.handle}/${command.name} must not launch`);
        assert.ok(command.reason, `${entry.handle}/${command.name} carries a one-line reason`);
      }
    }
  }

  // At least one extension exercised each policy branch the plan calls out.
  const allCommands = report.extensions.flatMap((entry) => entry.commands);
  assert.ok(allCommands.some((command) => command.class === "disabled-api" && /AI/.test(command.reason)), "an AI-disabled command appears");
  assert.ok(allCommands.some((command) => command.class === "compatible"), "compatible commands appear");
});
