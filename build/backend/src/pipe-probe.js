// Standalone pipe probe: connect to the launcher's named pipe and send one request.
"use strict";
const net = require("node:net");
const readline = require("node:readline");

const name = process.argv[2] ?? "raycast-mini-ipc";
const method = process.argv[3] ?? "extensionHost.getInstalledNodeExtensionSummaries";
const address = process.platform === "win32" ? `\\\\.\\pipe\\${name}` : name;

console.log("[probe] connecting to", address);
const client = net.createConnection(address, () => {
  console.log("[probe] connected");
  client.write(`${JSON.stringify({ type: "request", id: 1, module: "backend", method, data: {} })}\n`);
});

const rl = readline.createInterface({ input: client, crlfDelay: Infinity });
rl.on("line", (line) => console.log("[probe] <-", line));

client.on("error", (error) => console.error("[probe] error:", error.message));
client.on("close", () => console.error("[probe] closed"));
setTimeout(() => process.exit(0), 8000);
