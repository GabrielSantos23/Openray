// Settings store — the `settings.*` namespace.
//
// Raycast persists general settings in its (encrypted) settings DB and pushes every change to
// each window (`subscribeUpdate*`). This store owns the same keys as one JSON document under
// the data dir, validates writes, and fans every change back out to both windows through
// `settings.changed` so the launcher and the Settings window stay live.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Values must survive a JSON round-trip and stay bounded; keys are dotted row ids. */
function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("settings.set expects a values object");
  }
  const entries = Object.entries(patch);
  if (entries.length > 512) throw new Error("Too many settings in one write");
  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.length === 0 || key.length > 128) {
      throw new Error(`Invalid settings key: ${String(key).slice(0, 32)}`);
    }
    const type = typeof value;
    if (type !== "boolean" && type !== "string" && type !== "number") {
      throw new Error(`Setting ${key} must be a boolean, string, or number`);
    }
    if (type === "string" && value.length > 64 * 1024) {
      throw new Error(`Setting ${key} is too large`);
    }
  }
  return entries;
}

function createSettingsStore({ dataRoot, toRenderer } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini");
  const storePath = path.join(root, "store", "settings.json");

  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  let values = {};
  try {
    values = JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    /* first run keeps an empty map over the renderer defaults */
  }

  function persist() {
    try {
      const temp = `${storePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(values, null, 2));
      fs.renameSync(temp, storePath);
    } catch (error) {
      console.error("[settings] could not persist", error);
    }
  }

  function push() {
    if (typeof toRenderer === "function") {
      toRenderer("settings.changed", { values: { ...values } });
    }
  }

  const handlers = {
    getAll: () => ({ values: { ...values } }),
    set: (data) => {
      const patch = data?.values;
      validatePatch(patch);
      values = { ...values, ...patch };
      persist();
      push();
      return { ok: true, values: { ...values } };
    },
    replaceAll: (data) => {
      // Import Settings: one atomic, validated replacement (not a merge).
      const patch = data?.values;
      validatePatch(patch);
      values = { ...patch };
      persist();
      push();
      return { ok: true, values: { ...values } };
    },
  };

  return { handlers, getValues: () => ({ ...values }) };
}

module.exports = { createSettingsStore, validatePatch };
