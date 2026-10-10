// Builds the `@raycast/api` package into `node_modules/@raycast/api/index.js` as CommonJS.
//
// Raycast ships the *same* file as both the npm package extension authors install and the worker
// entry point handed to `new Worker(...)`. This build keeps that property.

import * as esbuild from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = here; // this script lives at <build>/api/build.mjs
const target = path.join(root, "node_modules", "@raycast", "api");

await mkdir(target, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.join(target, "index.js"),
  // The runtime resolves `react` / `react-reconciler` from NODE_PATH, exactly like Raycast.
  external: ["react", "react-reconciler", "react/jsx-runtime"],
  logLevel: "info",
  sourcemap: false,
  minify: true,
});

await writeFile(
  path.join(target, "package.json"),
  `${JSON.stringify({ name: "@raycast/api", version: "2.4.0.0", main: "index.js", private: true }, null, 2)}\n`,
);

console.log("@raycast/api built ->", path.relative(root, path.join(target, "index.js")));
