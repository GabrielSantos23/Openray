// The Store build pipeline (docs/store-spec.md D2): install-time `npm install` + esbuild.
//
// The real app's Store serves prebuilt release ZIPs built in Raycast's CI; we cannot produce those,
// so we build locally: dependencies install into the extension copy, every command entry point
// bundles to a flat `<commandName>.js` next to the manifest (the real app's on-disk layout,
// store-spec §3), `@raycast/api`/`react` stay external (resolved through NODE_PATH at run time),
// everything else is inlined. Native `.node` addons are never bundled and stay in the extension's
// `node_modules`. `tools/` directories are never produced (policy D6 — tools are ignored).
//
// Bundling imports nothing and runs no extension code, so install never executes the extension.

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

/** Externals resolve through NODE_PATH at run time — the host owns the API, like Raycast. */
const ESBUILD_EXTERNALS = ["@raycast/api", "react", "react/jsx-runtime", "react-reconciler", "react-dom"];

const ENTRY_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

const COPY_EXCLUDES = new Set(["node_modules", ".git", "dist", ".DS_Store"]);

/** Resolve esbuild from the API package's node_modules (the build host's own copy). */
function resolveEsbuild(apiRoot) {
  const anchor = path.join(apiRoot, "node_modules", "esbuild", "package.json");
  const required = createRequire(anchor);
  try {
    return required("esbuild");
  } catch (error) {
    throw new Error(`store-bundler: esbuild not found under ${apiRoot} (${error.message})`);
  }
}

/** `src/<commandName>.<ext>` with a recursive basename fallback for nested sources. */
function resolveCommandEntry(sourceRoot, commandName) {
  for (const extension of ENTRY_EXTENSIONS) {
    const direct = path.join(sourceRoot, "src", `${commandName}${extension}`);
    if (fs.existsSync(direct)) return direct;
  }
  const srcDir = path.join(sourceRoot, "src");
  if (!fs.existsSync(srcDir)) return null;
  const queue = [srcDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        queue.push(path.join(dir, entry.name));
        continue;
      }
      const base = path.basename(entry.name, path.extname(entry.name));
      if (base === commandName && ENTRY_EXTENSIONS.includes(path.extname(entry.name))) {
        return path.join(dir, entry.name);
      }
    }
  }
  return null;
}

/** `npm install --omit=dev --no-audit --no-fund` inside the extension copy. */
function installDependencies(sourceRoot, { onOutput } = {}) {
  return new Promise((resolve, reject) => {
    // Windows resolves npm through npm.cmd, which Node refuses to spawn without a shell
    // (the args are static strings, so the shell adds no injection surface).
    const child = spawn(
      "npm",
      ["install", "--omit=dev", "--no-audit", "--no-fund"],
      { cwd: sourceRoot, shell: process.platform === "win32", windowsHide: true },
    );
    let output = "";
    const collect = (chunk) => {
      output += chunk.toString();
      if (onOutput) onOutput(chunk.toString());
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => reject(new Error(`npm install failed to start: ${error.message}`)));
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`npm install exited with ${code}\n${output.slice(-4000)}`));
    });
  });
}

/**
 * Bundle one command entry point. No minify, so the classifier can scan the output text for
 * unsupported `@raycast/api` calls; a metafile records which sources each bundle pulled in.
 */
async function bundleCommand({ apiRoot, entryPath, outFile }) {
  const esbuild = resolveEsbuild(apiRoot);
  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: outFile,
    external: ESBUILD_EXTERNALS,
    metafile: true,
    sourcemap: true,
    logLevel: "silent",
    // Store extensions use the automatic JSX runtime (the official `ray` CLI's setting): no
    // `React` import required, `react/jsx-runtime` stays external like `react` itself.
    jsx: "automatic",
    loader: { ".png": "file", ".jpg": "file", ".jpeg": "file", ".gif": "file", ".svg": "file" },
  });
  return { metafile: result.metafile };
}

/** Recursive copy that skips node_modules/.git/dist (dependencies install fresh in the target). */
function copySourceTree(sourceRoot, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  const stack = [["", sourceRoot]];
  while (stack.length > 0) {
    const [relative, absolute] = stack.pop();
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (COPY_EXCLUDES.has(entry.name)) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childSource = path.join(absolute, entry.name);
      const childTarget = path.join(targetRoot, childRelative);
      if (entry.isDirectory()) {
        fs.mkdirSync(childTarget, { recursive: true });
        stack.push([childRelative, childSource]);
      } else if (entry.isFile()) {
        fs.copyFileSync(childSource, childTarget);
      }
    }
  }
}

/**
 * Build a prepared extension copy into a runnable install tree:
 * `npm install` inside `targetDir`, one flat bundle per command, assets + manifest in place.
 * Returns per-command output paths plus the metafiles (the classifier's input).
 * Commands whose entry point cannot be resolved are reported in `unresolved` — never silently
 * skipped — and the caller classifies them as disabled.
 */
async function buildExtension({ apiRoot, targetDir, manifest, onProgress } = {}) {
  if (!manifest || !Array.isArray(manifest.commands)) {
    throw new Error("store-bundler: manifest with commands[] required");
  }
  const progress = onProgress ?? (() => undefined);

  progress({ step: "dependencies", message: "Installing dependencies" });
  await installDependencies(targetDir, {
    onOutput: (chunk) => progress({ step: "dependencies", message: chunk.trim().split("\n").pop() ?? "" }),
  });

  const commandOutFiles = {};
  const metafiles = {};
  const unresolved = [];
  const commands = manifest.commands.filter((command) => command.mode !== "menu-bar");
  for (const command of commands) {
    const entryPath = resolveCommandEntry(targetDir, command.name);
    if (!entryPath) {
      unresolved.push(command.name);
      continue;
    }
    progress({ step: "bundle", message: `Bundling ${command.name}` });
    const outFile = path.join(targetDir, `${command.name}.js`);
    const { metafile } = await bundleCommand({ apiRoot, entryPath, outFile });
    commandOutFiles[command.name] = outFile;
    metafiles[command.name] = metafile;
  }

  return { commandOutFiles, metafiles, unresolved };
}

module.exports = {
  ESBUILD_EXTERNALS,
  buildExtension,
  bundleCommand,
  copySourceTree,
  installDependencies,
  resolveCommandEntry,
  resolveEsbuild,
};
