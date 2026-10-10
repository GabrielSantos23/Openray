// `ray build` equivalent for the command-ux-test extension (same as hello-list).
import * as esbuild from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");

await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [{ in: path.join(here, "src", "index.tsx"), out: path.join(dist, "index.js") }],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.join(dist, "index.js"),
  external: ["@raycast/api", "react", "react/jsx-runtime", "react-dom"],
  logLevel: "info",
});

console.log("built: dist/index.js");
