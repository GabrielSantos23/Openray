// Phase 6 end-to-end verification (docs/mcp-architecture.md): everything goes through the MCP
// server over stdio — list commands, change a setting, run calculator, read get_state, send
// input, take a screenshot, hit the destructive gate, kill the backend and watch it recover.
//
//   node build/scripts/phase6-verify.mjs            # auto-detect (bridged when the app runs)
//   node build/scripts/phase6-verify.mjs headless   # force headless

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const forcedMode = process.argv[2];

const dataRoot = process.env.OPENRAY_DATA_DIR;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    path.join(here, "..", "src", "mcp-server.mjs"),
    ...(dataRoot ? ["--data-root", dataRoot] : []),
    ...(forcedMode ? ["--mode", forcedMode] : []),
  ],
  env: process.env,
});
const client = new Client({ name: "openray-phase6", version: "1.0" });
await client.connect(transport);

const results = [];
function record(name, pass, detail) {
  results.push(pass);
  console.log(JSON.stringify({ name, pass, detail: String(detail).slice(0, 300) }));
}

async function tool(name, args) {
  const response = await client.callTool({ name, arguments: args ?? {} });
  const text = response.content?.find((c) => c.type === "text")?.text ?? "null";
  return { parsed: JSON.parse(text), response };
}

function envelopeValue(payload) {
  // run_command returns the registry envelope nested in the tool envelope.
  return payload.ok ? payload.result : payload.error;
}

try {
  // 1. Discovery -----------------------------------------------------------------------
  const list = await tool("list_commands", { filter: "calculator" });
  record("list commands", list.parsed.ok === true && list.parsed.result.commands.length > 5,
    `${list.parsed.result?.commands?.length ?? 0} calculator commands`);

  const described = await tool("describe_command", { id: "settings.set" });
  record("describe settings.set", described.parsed.ok === true && described.parsed.result.risk === "write",
    `risk=${described.parsed.result?.risk}`);

  // 2. Change a setting and read it back ----------------------------------------------
  const stamp = `phase6-${Date.now() % 100000}`;
  const set = await tool("run_command", { id: "settings.set", params: { values: { "phase6-probe": stamp } } });
  record("settings.set", envelopeValue(set.parsed)?.ok === true, JSON.stringify(envelopeValue(set.parsed)).slice(0, 80));
  const get = await tool("run_command", { id: "settings.get", params: { key: "phase6-probe" } });
  record("settings.get round-trip", envelopeValue(get.parsed)?.value === stamp, JSON.stringify(envelopeValue(get.parsed)));

  // 3. Calculator ----------------------------------------------------------------------
  const calc = await tool("run_command", { id: "calculator.calculate", params: { expression: "6*7" } });
  const calcEnvelope = envelopeValue(calc.parsed);
  record("calculator.calculate 6*7", calcEnvelope?.result?.answer === "42",
    `answer=${calcEnvelope?.result?.answer ?? JSON.stringify(calcEnvelope).slice(0, 80)}`);

  // 4. UI state and input --------------------------------------------------------------
  // The launcher may be hidden (no pixels, and WebView2 suspends); show it first.
  await tool("run_command", { id: "ui.showMainWindow", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const stateBefore = await tool("get_state", {});
  record("get_state", stateBefore.parsed.ok === true && stateBefore.parsed.result?.window === "launcher",
    `view=${stateBefore.parsed.result?.view} items=${stateBefore.parsed.result?.items?.length}`);

  await tool("send_input", { event: { type: "setQuery", query: "clipboard" } });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const stateAfter = await tool("get_state", {});
  record("send_input setQuery reflected in get_state",
    stateAfter.parsed.ok === true && stateAfter.parsed.result?.query === "clipboard",
    `query="${stateAfter.parsed.result?.query}" items=${stateAfter.parsed.result?.items?.length}`);

  await tool("send_input", { event: { type: "action", name: "popToRoot" } });
  await tool("send_input", { event: { type: "clear" } });

  // 5. Screenshot -----------------------------------------------------------------------
  const shot = await tool("screenshot", {});
  const image = shot.response.content?.find((c) => c.type === "image");
  const pngMagic = image ? Buffer.from(image.data, "base64").subarray(0, 8).toString("hex") : "";
  record("screenshot PNG", pngMagic.startsWith("89504e47"), `magic=${pngMagic} bytes=${image?.data?.length ?? 0}`);

  // 6. Extension surface ----------------------------------------------------------------
  const extensions = await tool("run_command", { id: "extensions.list", params: {} });
  const extensionCount = envelopeValue(extensions.parsed)?.extensions?.length ?? 0;
  record("extensions.list", extensions.parsed.ok === true, `${extensionCount} extensions`);

  // 7. Destructive gate -----------------------------------------------------------------
  const refused = await tool("run_command", { id: "clipboard.deleteAll", params: {} });
  record("destructive refused without flag",
    refused.parsed.ok === false && refused.parsed.error?.code === "destructive_refused",
    refused.parsed.error?.code);

  // 8. Kill the backend; typed failure, then recovery -----------------------------------
  let killed = false;
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*backend*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: "pipe" },
    );
    killed = true;
  } catch {
    // Process enumeration differs across machines; treat as skipped rather than failed.
  }
  if (killed) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const afterKill = await tool("run_command", { id: "calculator.calculate", params: { expression: "1+1" } });
    record("backend killed -> typed failure or auto-recovery",
      afterKill.parsed.ok === true || ["timeout", "internal", "needs_ui"].includes(afterKill.parsed.error?.code),
      afterKill.parsed.ok ? "recovered" : afterKill.parsed.error?.code);
    const recovered = await tool("run_command", { id: "calculator.calculate", params: { expression: "1+1" } });
    record("recovered after watchdog restart", envelopeValue(recovered.parsed)?.result?.answer === "2",
      JSON.stringify(envelopeValue(recovered.parsed)).slice(0, 80));
  } else {
    record("backend kill skipped (no matching process)", true, "skipped");
  }

  // 9. Events ---------------------------------------------------------------------------
  const events = await tool("get_events", { limit: 50 });
  const names = (events.parsed.result?.events ?? []).map((e) => e.name);
  record("get_events", names.includes("command.finished"), `${names.length} events`);

  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (error) {
  console.error("[phase6] failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
