// Standalone smoke test for the extension host path.
//
// Spawns one worker through the same factory the backend uses, sends an `initialize` with a launch
// context, and prints everything the worker sends back — including the `render` request carrying
// the gzipped render tree.

"use strict";

const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { createBackend } = require("./src/backend");

const buildRoot = path.join(__dirname, "..");
const extensionsRoot = path.join(buildRoot, "extensions");

const backend = createBackend({
  pipeName: "openray-test",
  frontendRoot: path.join(buildRoot, "frontend"),
  extensionsRoot,
});

(async () => {
  const extensions = await backend.allExtensions();
  console.log("installed extensions:", extensions.map((e) => `${e.name} (${e.commands.length} commands)`).join(", "));

  const target = extensions.find((extension) => extension.name === "Lucide Icons");
  if (!target) throw new Error("Lucide Icons not installed");

  const command = target.commands.find((entry) => entry.name === "open");

// Bypass the named pipe for the request path; intercept the render notification.
backend.setTransport(async (module, method, data) => {
  if (method.startsWith("extensionHost.")) {
    console.log(`\n=== worker -> host -> renderer (module "${module}"): ${method} ===`);
    const payload = { ...data };
    if (payload.renderTree) {
      payload.gzipped = data.gzipped;
      payload.bytes = data.renderTree.length;
      payload.bytesUncompressed = data.gzipped
        ? gunzipSync(Buffer.from(data.renderTree, "base64")).length
        : undefined;
      const text = data.gzipped
        ? gunzipSync(Buffer.from(data.renderTree, "base64")).toString("utf-8")
        : data.renderTree;
      payload.renderTree = JSON.parse(text);
    }
    console.log(JSON.stringify(payload, null, 2));
    return undefined;
  }
  console.log(`\n=== extension -> host (module "${module}"): ${method} ===`, JSON.stringify(data, null, 2));
  if (method === "clipboard.read") return { value: "(clipboard unavailable in this harness)" };
  if (method === "clipboard.write") return { ok: true };
  return undefined;
});

const { sessionId } = await backend.dispatchMessage("backend", "extensionHost.loadCommand", {
    extension: target,
    command,
    preferences: {},
    props: {},
    debug: false,
  });

  console.log("\nsession:", sessionId);

  // Let the async render settle.
  await new Promise((resolve) => setTimeout(resolve, 800));

  await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId });
  console.log("\nunloaded OK");
  process.exit(0);
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
