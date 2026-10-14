import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "frontend", "src", "clipboardHistory.ts");

// The renderer's TypeScript is transpiled by esbuild, the same as the real build, so this exercises the
// shipped function rather than a hand-copied variant.
const { build } = await import(
  pathToFileURL(path.join(root, "flowkey", "vendor", "node_modules", "esbuild", "lib", "main.js")).href
);
const result = await build({
  entryPoints: [source],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["react", "./ipc"],
  logLevel: "silent",
});
const module = { exports: {} };
const factory = new Function("module", "exports", "require", result.outputFiles[0].text);
factory(module, module.exports, () => ({}), );

const { md5Hex, tagColor } = module.exports;
assert.equal(typeof md5Hex, "function", "md5Hex is exported");
assert.equal(typeof tagColor, "function", "tagColor is exported");

const cases = [
  "",
  "a",
  "abc",
  "message digest",
  "abcdefghijklmnopqrstuvwxyz",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  "work",
  "urgent",
  "raycast",
  "clipboard-history",
  "Grüße",
  "日本語タグ",
  "a".repeat(55),
  "a".repeat(56),
  "a".repeat(63),
  "a".repeat(64),
  "a".repeat(65),
  "x".repeat(1000),
];

for (const value of cases) {
  const mine = md5Hex(value);
  const reference = crypto.createHash("md5").update(value, "utf8").digest("hex");
  assert.equal(mine, reference, `md5 mismatch for ${JSON.stringify(value.slice(0, 24))}`);
}

const hueOf = (tag) => Number(tagColor(tag).match(/hsl\((\d+)/)[1]);
const hues = new Set();
for (const tag of ["work", "urgent", "personal", "docs", "code", "todo", "idea", "later", "done", "temp"]) {
  hues.add(hueOf(tag));
  assert.match(tagColor(tag), /^hsl\(\d+ 72% 66%\)$/, `unexpected colour shape for ${tag}`);
}
assert.ok(hues.size > 1, "different tags should not all collapse onto one hue");
assert.equal(tagColor("work"), tagColor("work"), "the same tag must always get the same colour");

console.log(
  `md5Hex matches node:crypto on ${cases.length} cases (ascii, umlaut, CJK, and the 55/56/64-byte padding boundaries); tagColor is deterministic and spreads across ${hues.size} hues`,
);