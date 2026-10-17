"use strict";

// Openray — Node extension host entry point (the live process).
//
// This is the Node half of Raycast's architecture: `Raycast.exe` spawns `node backend/index.js`,
// which keeps a pool of `worker_threads` workers (one per running extension command) and bridges
// extension <-> host <-> renderer traffic over a named pipe. All the wiring — backend, internal
// extension stores, command registry, control channel — lives in `runtime.js`, shared with the
// headless MCP/CLI mode (docs/mcp-architecture.md).
//
// The three legs, mirroring Raycast 2.4.0.0:
//
//   1. extension worker  -> backend     `parentPort.postMessage({kind:"request"|"notify", …})`
//   2. backend           -> renderer    `z.frontend.extensionHost.render({…})`
//   3. renderer          -> backend     `dispatchRequest("backend","extensionHost.loadCommand",…)`
//
// (2) and (3) both travel over the named pipe that the .NET launcher owns. Protocol messages are
// newline-delimited JSON:
//
//   -> { type:"request",  id, module:"frontend"|"backend", method, data }
//   <- { type:"response", id, ok, data | error }
//   <- { type:"push",     module:"frontend", method, data }       (host -> renderer)

const { createRuntime } = require("./runtime");
const { createControlServer, writeControlToken, writeControlEndpoint } = require("./control-server");

const runtime = createRuntime({ connectPipe: true });
const { registry, backend, config } = runtime;

// Control channel (docs/control-protocol.md): loopback-only HTTP with a per-launch bearer
// token; off by default, enabled with `--control` (argv) or OPENRAY_CONTROL=1.
const controlRequested = process.argv.includes("--control") || process.env.OPENRAY_CONTROL === "1";
if (controlRequested) {
  const fs = require("node:fs");
  const { token, file } = writeControlToken(process.env.OPENRAY_DATA_DIR);
  const port = Number(process.env.OPENRAY_CONTROL_PORT ?? 0) || 0;
  createControlServer({ registry, backend, token, port })
    .then((control) => {
      writeControlEndpoint(process.env.OPENRAY_DATA_DIR, control.address);
      // The token itself is never logged; agents read it from the token file.
      console.log(JSON.stringify({ control: true, address: control.address, tokenFile: file }));
    })
    .catch((error) => console.error("[control] failed to start:", error?.message ?? error));

  // The token is rewritten per launch; drop the endpoint marker when the host goes away so
  // bridged clients fall back to headless instead of probing a dead port.
  process.on("exit", () => {
    try {
      const dataRoot = process.env.OPENRAY_DATA_DIR
        ?? require("node:path").dirname(config.extensionsRoot);
      fs.unlinkSync(require("node:path").join(dataRoot, "control-endpoint.json"));
    } catch {
      /* best effort */
    }
  });
}

process.on("uncaughtException", (error) => console.error("[backend] uncaught", error));
process.on("unhandledRejection", (error) => console.error("[backend] unhandled rejection", error));

// Keeps the process alive; the pipe does too, but this makes the intent explicit.
setInterval(() => undefined, 1 << 30).unref();
