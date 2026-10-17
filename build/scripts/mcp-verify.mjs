// Drives the Openray MCP server over stdio the way a real client would (JSON-RPC 2.0), so
// Phase 6 verification (docs/mcp-architecture.md) goes through the server, not around it.
//
//   node build/scripts/mcp-verify.mjs [-- <mcp-server args...>]
//
// Each scenario prints one JSON line: { name, pass, detail }.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverArgs = process.argv.slice(2);

const child = spawn(process.execPath, [path.join(here, "..", "backend", "src", "mcp-server.mjs"), ...serverArgs], {
  stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
const pending = new Map();
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf-8");
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter(message);
      }
    } catch {
      // non-JSON stdout noise would break the protocol; surface it
      console.error("[verify] non-JSON server output:", line.slice(0, 200));
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 30_000).unref();
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(name, args) {
  const response = await request("tools/call", { name, arguments: args });
  if (response.error) return { ok: false, error: response.error };
  const payload = JSON.parse(response.result.content[0].text);
  return payload;
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(JSON.stringify({ name, pass, detail }));
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "openray-verify", version: "1.0" },
  });
  record("initialize", Boolean(init.result?.serverInfo?.name === "openray"), init.result?.serverInfo);
  notify("notifications/initialized", {});

  const tools = await request("tools/list", {});
  const names = tools.result.tools.map((tool) => tool.name);
  record(
    "tools/list",
    ["list_commands", "describe_command", "run_command", "get_state", "send_input", "screenshot", "get_events"].every((n) => names.includes(n)),
    names.join(","),
  );

  const list = await callTool("list_commands", { filter: "snippets" });
  const ids = (list.result?.commands ?? []).map((c) => c.id);
  record("list_commands filter=snippets", list.ok === true && ids.includes("snippets.create"), `${ids.length} commands`);

  const described = await callTool("describe_command", { id: "settings.set" });
  record("describe_command settings.set", described.ok === true && Boolean(described.result?.params), described.result?.risk);

  const bad = await callTool("run_command", { id: "nope.nope" });
  record("run_command unknown id", bad.ok === false && bad.error?.code === "unknown_command", bad.error?.code);

  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
} catch (error) {
  console.error("[verify] failed:", error.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
