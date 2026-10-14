// Bundles the FlowKey worker: self-contained CJS the backend spawns as a worker_threads script.
// react/react-reconciler/scheduler come from build/flowkey/vendor (React 19 + reconciler 0.33).
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const vendorRequire = createRequire(pathToFileURL(path.join(process.cwd(), "..", "vendor", "x.js")));
const { build } = vendorRequire("esbuild");

await build({
  entryPoints: ["./flowkey-worker.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "./dist/flowkey-worker.js",
  sourcemap: false,
  nodePaths: [path.resolve("../vendor/node_modules")],
  alias: {
    "@flowkey-mini/react-ui": path.resolve("../react-ui/src/index.ts"),
    "@flowkey-mini/native-sdk": path.resolve("../native-sdk/src/index.ts"),
  },
  external: ["node:worker_threads", "node:crypto", "node:http", "node:https", "node:fs", "node:path"],
  logLevel: "info",
});
