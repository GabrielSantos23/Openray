// Form validation tests — `validateForm` in RenderedView.tsx. Raycast computes validation
// extension-side and ships it as the field's `error` (docs/command-ux-spec.md §2.2); the renderer
// gates the submit-form action while any error is present.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "frontend", "src", "RenderedView.tsx");

const { build } = await import(
  pathToFileURL(path.join(root, "api", "node_modules", "esbuild", "lib", "main.js")).href
);
const result = await build({
  entryPoints: [source],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["react", "./ipc", "./icons", "./markdown", "./commandPages", "./useExtensionCommand"],
  logLevel: "silent",
});
const module = { exports: {} };
const stub = (name) => {
  if (name === "react") return { createElement: () => ({}), Fragment: {} };
  return {};
};
const factory = new Function("module", "exports", "require", result.outputFiles[0].text);
factory(module, module.exports, stub);

const { validateForm } = module.exports;

const field = (kind, id, extra = {}) => ({ kind, id, ...extra });

// 1. A clean form has no errors.
assert.deepEqual(
  validateForm([field("TextField", "name", { title: "Name" }), field("Checkbox", "agree")], { name: "ok", agree: false }),
  [],
  "clean form passes",
);

// 2. Model-declared errors (extension-side validation) surface by field id.
assert.deepEqual(
  validateForm([field("TextField", "name", { error: "Required" })], { name: "" }),
  ["name"],
  "declared error surfaces",
);

// 3. Required-by-convention: a field whose title ends with '*' must be non-empty.
assert.deepEqual(
  validateForm([field("TextField", "name", { title: "Name*" })], { name: "" }),
  ["name"],
  "required title with empty value fails",
);
assert.deepEqual(
  validateForm([field("TextField", "name", { title: "Name*" })], { name: "filled" }),
  [],
  "required title with value passes",
);
assert.deepEqual(
  validateForm([field("TextArea", "notes", { title: "Notes*" })], { notes: "   " }),
  ["notes"],
  "whitespace-only required value fails",
);

// 4. A declared error mentioning 'required' triggers the empty check too.
assert.deepEqual(
  validateForm([field("TextField", "pw", { error: "required" })], { pw: "" }),
  ["pw"],
  "declared 'required' text enforces non-empty",
);

// 5. Optional fields never fail when empty.
assert.deepEqual(
  validateForm([field("TextField", "nickname", { title: "Nickname" })], { nickname: "" }),
  [],
  "optional empty passes",
);

// 6. Multiple errors are reported together, in field order.
assert.deepEqual(
  validateForm(
    [field("TextField", "a", { error: "x" }), field("TextField", "b", { title: "B*" }), field("TextField", "c")],
    { a: "", b: "", c: "" },
  ),
  ["a", "b"],
  "errors collect in field order",
);

// 7. Separators/descriptions never produce errors.
assert.deepEqual(
  validateForm([field("Separator", "sep"), field("Description", "desc", { text: "hi" })], {}),
  [],
  "non-input fields pass",
);

console.log("form-validation.test.mjs: 7 checks passed");
