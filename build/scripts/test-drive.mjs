#!/usr/bin/env node
// Dev driver: runs one script in the launcher renderer through the pipe
// (`window.runTestScript` -> renderer `window.eval` -> `window.__openrayTest` hooks), then
// waits for the `[test] …` result line in launcher.log and prints it.
//
//   node scripts/test-drive.mjs "JSON.stringify(__openrayTest.state())"
//   node scripts/test-drive.mjs "JSON.stringify(__openrayTest.openCommand('exercises'))"

import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const script = process.argv[2];
if (!script) {
  console.error("usage: node test-drive.mjs <script>");
  process.exit(1);
}

const logPath = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Openray",
  "launcher.log",
);
const backendLogPath = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Openray",
  "backend.log",
);
const log = fs.readFileSync(logPath, "utf8");
const existing = (log.match(/\[test\] /g) ?? []).length;

// The host's pipe name is `openray-ipc-<host pid>`; derive it from the live process (the
// backend's handshake line lags behind fresh launches).
import { execSync } from "node:child_process";
const tasklist = execSync("tasklist /FI \"IMAGENAME eq Openray.exe\" /FO CSV", { encoding: "utf8" });
const pidMatch = /"Openray\.exe","(\d+)"/.exec(tasklist);
if (!pidMatch) {
  console.error("Openray.exe is not running");
  process.exit(1);
}
const pipeName = `openray-ipc-${pidMatch[1]}`;

const socket = net.createConnection(`\\\\.\\pipe\\${pipeName}`, () => {
  const message = {
    type: "request",
    id: `test-${Date.now()}`,
    module: "frontend",
    method: "window.runTestScript",
    data: { script },
  };
  socket.write(`${JSON.stringify(message)}\n`);
});

let buffer = "";
socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  if (buffer.includes("\n")) {
    socket.end();
  }
});
socket.on("error", (error) => {
  console.error("pipe error:", error.message);
  process.exit(1);
});
socket.on("close", () => {
  // The host logs the eval result; poll launcher.log for the new [test] line.
  const deadline = Date.now() + 10_000;
  const poll = setInterval(() => {
    const current = fs.readFileSync(logPath, "utf8");
    const lines = [...current.matchAll(/\[test\] (.*)$/g)].map((m) => m[1]);
    if (lines.length > existing) {
      clearInterval(poll);
      console.log(lines.at(-1));
      process.exit(0);
    }
    if (Date.now() > deadline) {
      clearInterval(poll);
      console.error("timed out waiting for [test] result");
      process.exit(1);
    }
  }, 250);
});
