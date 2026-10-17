// The Openray MCP server (docs/mcp-architecture.md): stdio transport for Claude Code and
// similar clients. Two modes share one tool surface:
//
//   bridged  — talks to the running app through the loopback control channel (token file)
//   headless — builds the command registry in-process, no UI (UI-bound verbs return needs_ui)
//
// Auto-detect probes the control endpoint and falls back to headless; `--mode` forces one.
// No tool per command: agents discover the registry through list_commands/describe_command.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const DATA_ROOT =
  process.env.OPENRAY_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");

function controlEndpoint(dataRoot = DATA_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot, "control-endpoint.json"), "utf-8"));
  } catch {
    return null;
  }
}

function controlToken(dataRoot = DATA_ROOT) {
  try {
    return fs.readFileSync(path.join(dataRoot, "control-token"), "utf-8").trim();
  } catch {
    return null;
  }
}

/** The HTTP client for bridged mode; every call is bounded so a dead app cannot hang MCP. */
function createBridgedGateway(endpoint, token) {
  const base = `http://${endpoint.address}`;

  async function call(pathname, { method = "GET", body } = {}) {
    const response = await fetch(base + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) return response.json();
    if ((contentType ?? "").startsWith("image/")) return Buffer.from(await response.arrayBuffer());
    return null;
  }

  return {
    kind: "bridged",
    async probe() {
      try {
        const commands = await call("/commands?filter=registry.list");
        return commands?.ok === true;
      } catch {
        return false;
      }
    },
    listCommands: async (filter) => (await call(`/commands${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`)),
    describeCommand: async (id) => await call(`/commands/${encodeURIComponent(id)}`),
    runCommand: async (id, params, allowDestructive) =>
      await call(`/commands/${encodeURIComponent(id)}/run`, {
        method: "POST",
        body: { params: params ?? {}, allowDestructive: allowDestructive === true },
      }),
    getState: async () => await call("/state"),
    sendInput: async (event) => await call("/input", { method: "POST", body: event }),
    screenshot: async () => await call("/screenshot"),
    getEvents: async (since, limit) =>
      await call(`/events?${new URLSearchParams({ ...(since ? { since: String(since) } : {}), ...(limit ? { limit: String(limit) } : {}) })}`),
  };
}

/** Headless gateway: the registry in-process; UI-bound verbs come back as needs_ui envelopes. */
async function createHeadlessGateway() {
  const { createRuntime } = await import("./runtime.js");
  // stdio is the MCP protocol channel: runtime logging (store maintenance, ready lines) must
  // never land on stdout, so it moves to stderr inside this process only.
  console.log = (...parts) => console.error(...parts);
  console.info = (...parts) => console.error(...parts);
  const runtime = createRuntime({ connectPipe: false });
  return {
    kind: "headless",
    async probe() {
      return true;
    },
    listCommands: async (filter) => ({
      ok: true,
      result: { commands: runtime.registry.list({ filter }) },
    }),
    describeCommand: async (id) => {
      const described = runtime.registry.describe(id);
      return described
        ? { ok: true, result: described }
        : { ok: false, error: { code: "unknown_command", message: `no such command: ${id}` } };
    },
    runCommand: async (id, params, allowDestructive) =>
      await runtime.registry.dispatch(id, params ?? {}, {
        allowDestructive: allowDestructive === true,
        source: "mcp-headless",
      }),
    getState: async () => ({
      ok: false,
      error: {
        code: "needs_ui",
        message: "headless mode has no UI; start the Openray app and use bridged mode",
        hint: "launch Openray (it publishes the control endpoint automatically), or run the MCP server with --mode bridged",
      },
    }),
    sendInput: async () => ({
      ok: false,
      error: { code: "needs_ui", message: "headless mode has no UI to receive input" },
    }),
    screenshot: async () => ({
      ok: false,
      error: { code: "needs_ui", message: "headless mode has no window to capture" },
    }),
    getEvents: async (since, limit) => ({
      ok: true,
      result: { events: runtime.registry.recentEvents({ since, limit }) },
    }),
  };
}

export async function resolveGateway(forcedMode) {
  const endpoint = controlEndpoint();
  const token = controlToken();
  const bridged = endpoint && token ? createBridgedGateway(endpoint, token) : null;
  if (bridged && forcedMode !== "headless") {
    const alive = await bridged.probe();
    if (alive) return bridged;
  }
  if (forcedMode === "bridged") {
    throw new Error(
      "bridged mode forced but no running Openray app was found (no control endpoint/token, or the app did not answer)",
    );
  }
  return createHeadlessGateway();
}

function text(result) {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

async function main() {
  const args = process.argv.slice(2);
  const modeFlag = args.indexOf("--mode");
  const forcedMode = modeFlag >= 0 ? args[modeFlag + 1] : undefined;
  if (forcedMode && !["bridged", "headless"].includes(forcedMode)) {
    throw new Error(`--mode must be bridged or headless, got ${forcedMode}`);
  }

  const gateway = await resolveGateway(forcedMode);

  const server = new McpServer({
    name: "openray",
    version: "2.4.0",
  });

  server.registerTool(
    "list_commands",
    {
      title: "List Openray commands",
      description:
        "List the commands of the Openray launcher (apps, snippets, quicklinks, calculator, notes, clipboard, windows, settings, extensions and more). Pass a text filter to narrow by id/title/description. Call describe_command for a command's parameter schema before running it.",
      inputSchema: { filter: z.string().optional().describe("Case-insensitive text filter over id, title and description") },
    },
    async ({ filter }) => text(await gateway.listCommands(filter)),
  );

  server.registerTool(
    "describe_command",
    {
      title: "Describe an Openray command",
      description:
        "Return one Openray command's full definition: params JSON Schema, risk (read/write/destructive) and description. Always call this before run_command with a new command id.",
      inputSchema: { id: z.string().describe("Command id, e.g. settings.set or snippets.create") },
    },
    async ({ id }) => text(await gateway.describeCommand(id)),
  );

  server.registerTool(
    "run_command",
    {
      title: "Run an Openray command",
      description:
        "Run one Openray command by id with a params object. The result is the envelope {ok, result|error}. Destructive commands (delete/clear/reset, app quit/uninstall) are refused unless allowDestructive is true — set it only when the user asked for the destructive action.",
      inputSchema: {
        id: z.string().describe("Command id from list_commands"),
        params: z.record(z.string(), z.unknown()).optional().describe("Params object validated against the command's schema"),
        allowDestructive: z.boolean().optional().describe("Explicit opt-in required by destructive commands"),
      },
    },
    async ({ id, params, allowDestructive }) => text(await gateway.runCommand(id, params, allowDestructive)),
  );

  server.registerTool(
    "get_state",
    {
      title: "Read the Openray UI state",
      description:
        "Read what the launcher window currently shows: view, search query, visible items (index/kind/title), selected item and open dialogs. Headless mode returns a needs_ui error.",
      inputSchema: {},
    },
    async () => text(await gateway.getState()),
  );

  server.registerTool(
    "send_input",
    {
      title: "Send input to the Openray window",
      description:
        "Drive the launcher UI: {type:'text',text} appends to the search query, {type:'setQuery',query} replaces it, {type:'clear'}, {type:'backspace'}, {type:'key',key} dispatches a key (ArrowDown/ArrowUp/Enter/Escape/Tab), {type:'action',name} runs openSettings/close/popToRoot. Read get_state after each step.",
      inputSchema: {
        event: z
          .object({ type: z.string() })
          .passthrough()
          .describe("One input event: {type:'text'|'setQuery'|'clear'|'backspace'|'key'|'action', ...}"),
      },
    },
    async ({ event }) => text(await gateway.sendInput(event)),
  );

  server.registerTool(
    "screenshot",
    {
      title: "Capture the Openray window",
      description:
        "Capture the launcher window as a PNG image. The window must be visible. Headless mode returns a needs_ui error.",
      inputSchema: {},
    },
    async () => {
      const result = await gateway.screenshot();
      if (Buffer.isBuffer(result)) {
        return { content: [{ type: "image", data: result.toString("base64"), mimeType: "image/png" }] };
      }
      return text(result);
    },
  );

  server.registerTool(
    "get_events",
    {
      title: "Read recent Openray events",
      description:
        "Read the launcher's recent event ring buffer (command.started/finished/failed, settings.changed, registry.changed) to see what the app has been doing.",
      inputSchema: {
        since: z.number().optional().describe("Only events after this epoch ms"),
        limit: z.number().optional().describe("Max events returned (default 200)"),
      },
    },
    async ({ since, limit }) => text(await gateway.getEvents(since, limit)),
  );

  server.registerResource(
    "commands",
    "openray://commands",
    { title: "Openray command registry", description: "Every command with id, title, risk and description" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify((await gateway.listCommands()).result?.commands ?? []),
        },
      ],
    }),
  );

  await server.connect(new StdioServerTransport());
  // Unlike the live app (pipe + host), headless has nothing that keeps the event loop alive;
  // without this the server would exit right after startup and the client sees a closed pipe.
  setInterval(() => undefined, 1 << 30);
  // The mode is the only thing worth reporting; stdout belongs to the MCP protocol.
  console.error(`[openray-mcp] ready (${gateway.kind} mode)`);
}

// Run the server only when this file is the entry point; the CLI imports resolveGateway.
import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("[openray-mcp] fatal:", error?.message ?? error);
    process.exit(1);
  });
}
