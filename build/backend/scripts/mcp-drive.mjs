// One-off MCP driver: connects to the Openray MCP server (bridged) and calls the tools named on
// argv, printing each result as JSON. Used to build/verify the emoji extension end to end.
//
//   node build/scripts/mcp-drive.mjs run_command '{"id":"ext.emoji.search"}'
//
// Repeated `--script` steps run in order inside one connection:
//   --script run_command:<json> --script get_state --script screenshot:<file.png>

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = process.env.OPENRAY_DATA_DIR;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "..", "src", "mcp-server.mjs"), ...(dataRoot ? ["--data-root", dataRoot] : [])],
  env: process.env,
});
const client = new Client({ name: "openray-drive", version: "1.0" });
await client.connect(transport);

async function tool(name, args) {
  const response = await client.callTool({ name, arguments: args ?? {} });
  const text = response.content?.find((c) => c.type === "text")?.text ?? "null";
  return JSON.parse(text);
}

const steps = [];
const positional = [];
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--script") {
    const [name, rest] = argv[index + 1].split(/:(.+)/s);
    steps.push({ name, rest });
    index += 1;
  } else {
    positional.push(argv[index]);
  }
}

if (positional.length > 0) {
  const [name, rest] = positional[0].split(/:(.+)/s);
  steps.push({ name, rest });
}

for (const step of steps) {
  const args = step.rest ? JSON.parse(step.rest) : {};
  if (step.name === "sleep") {
    await new Promise((resolve) => setTimeout(resolve, Number(args.ms ?? 500)));
    console.log(`slept ${args.ms ?? 500}ms`);
    continue;
  }
  if (step.name === "screenshot" && typeof args.path === "string") {
    const response = await client.callTool({ name: "screenshot", arguments: {} });
    const image = response.content?.find((c) => c.type === "image");
    if (!image) {
      console.log("screenshot unavailable:", JSON.stringify(response).slice(0, 300));
      continue;
    }
    const bytes = Buffer.from(image.data, "base64");
    fs.writeFileSync(args.path, bytes);
    console.log(`screenshot -> ${args.path} (${bytes.length} bytes)`);
    continue;
  }
  const started = Date.now();
  const result = await tool(step.name, args);
  const text = JSON.stringify(result);
  console.log(`[${step.name}] (${Date.now() - started}ms) ${text.length > 4000 ? `${text.slice(0, 4000)}…(${text.length})` : text}`);
}

await client.close();
process.exit(0);
