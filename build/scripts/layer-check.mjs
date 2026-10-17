// Layer check (AGENTS.md §2): one-way layering enforced by import scanning.
//
//   L0 foundation      node builtins only
//   L1 core services   node builtins + sibling store modules + flowkey-vault
//   L2 registry        node builtins only
//   L2 commands        node builtins + registry
//   L2 dispatch        backend.js: node builtins + flowkey-vault
//   L5 control/MCP     node builtins + registry + backend + commands + control-server
//
// Nothing below the UI may import from build/frontend, and nothing may import from the
// C# host. Run: node build/scripts/layer-check.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPathSafe()), "..", "..");
const SRC = path.join(ROOT, "build", "backend", "src");
const FRONTEND = path.join(ROOT, "build", "frontend", "src");

function fileURLToPathSafe() {
  // import.meta.url parsing without importing node:url (keeps the tool dependency-free)
  return new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
}

const RULES = [
  {
    name: "registry (L2 core) stays dependency-free",
    files: [path.join(SRC, "registry.js")],
    forbidden: [/require\(\s*"\.\/(?!registry)/, /require\(\s*"\.\.\//, /from ["']\.\//],
  },
  {
    name: "commands (L2) depend only on the registry",
    files: listFiles(path.join(SRC, "commands")),
    forbidden: [/require\(\s*"\.\.\/backend"/, /require\(\s*"\.\.\/(?!\.\.\/registry)/, /build\/frontend/, /chrome\.webview/],
  },
  {
    name: "control server (L5) uses no UI modules",
    files: [path.join(SRC, "control-server.js")],
    forbidden: [/build\/frontend/, /chrome\.webview/, /require\(\s*"\.\/backend"/, /require\(\s*"\.\/(?!(control-server))\w+(-\w+)?\.js"\)/],
  },
  {
    name: "frontend never imports backend sources",
    files: listFiles(FRONTEND),
    forbidden: [/build\/backend/, /require\(\s*"node:(fs|path|os|net|child_process)/, /worker_threads/],
  },
];

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.(js|mjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let violations = 0;
for (const rule of RULES) {
  for (const file of rule.files) {
    // Strip line comments first: docs may legitimately mention layer paths.
    const text = fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
      .join("\n");
    for (const pattern of rule.forbidden) {
      if (pattern.test(text)) {
        console.error(`LAYER VIOLATION [${rule.name}]: ${path.relative(ROOT, file)} matches ${pattern}`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`layer check failed: ${violations} violation(s)`);
  process.exit(1);
}
console.log(`layer check ok: ${RULES.reduce((n, r) => n + r.files.length, 0)} files scanned`);
