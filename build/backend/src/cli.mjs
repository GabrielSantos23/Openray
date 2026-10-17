// Openray CLI (docs/development.md): `node build/backend/src/cli.mjs run <command.id> [jsonParams]`
// runs one registry command — same registry, same envelope as the app, the control channel and
// MCP — and `cli.mjs mcp` starts the MCP server on stdio. Bridged when the app is running,
// headless otherwise; `--mode bridged|headless` forces it.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function modeForced(args) {
  const flag = args.indexOf("--mode");
  return flag >= 0 ? args[flag + 1] : undefined;
}

function positional(args) {
  const out = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--mode") {
      index++;
      continue;
    }
    if (!args[index].startsWith("--")) out.push(args[index]);
  }
  return out;
}

async function gatewayFor(args) {
  const { resolveGateway } = await import("./mcp-server.mjs");
  const gateway = await resolveGateway(modeForced(args));
  if (gateway.kind === "headless") {
    // The headless runtime logs asynchronously; keep its chatter off our stdout.
    console.log = (...parts) => console.error(...parts);
    console.info = (...parts) => console.error(...parts);
  }
  return gateway;
}

function usage() {
  console.log(`Openray CLI

  node cli.mjs run <command.id> [jsonParams] [--mode bridged|headless] [--allow-destructive]
      Run one command, e.g. run settings.set '{"values":{"zoom":1.5}}'
      Prints the result envelope; exits 0 when ok, 1 otherwise.

  node cli.mjs list [filter] [--mode bridged|headless]
      List registry commands.

  node cli.mjs mcp [--mode bridged|headless]
      Start the MCP server on stdio (Claude Code and friends).`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "mcp") {
    const child = spawn(process.execPath, [path.join(here, "mcp-server.mjs"), ...rest], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
    return;
  }
  if (command === "list") {
    const filter = positional(rest)[0] ?? "";
    const gateway = await gatewayFor(rest);
    const envelope = await gateway.listCommands(filter || undefined);
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    // One-shot: the headless runtime holds store handles that would keep the loop alive.
    process.exit(envelope.ok ? 0 : 1);
  }
  if (command === "run") {
    const args = positional(rest);
    const id = args[0];
    if (!id) {
      usage();
      process.exitCode = 2;
      return;
    }
    let params = {};
    if (args[1] !== undefined) {
      try {
        params = JSON.parse(args[1]);
      } catch (error) {
        console.error(`params must be JSON: ${error.message}`);
        process.exitCode = 2;
        return;
      }
    }
    const gateway = await gatewayFor(rest);
    const envelope = await gateway.runCommand(id, params, rest.includes("--allow-destructive"));
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    process.exit(envelope.ok ? 0 : 1);
  }
  usage();
  process.exitCode = command === undefined ? 0 : 2;
}

main().catch((error) => {
  console.error("[openray-cli]", error?.message ?? error);
  process.exit(1);
});
