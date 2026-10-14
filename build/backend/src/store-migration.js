// A4 (docs/flowkey-migration-plan.md M2): the Store's on-disk artifacts are MOVED, never deleted,
// into `<dataRoot>/_removed-store-backup/` — store.sqlite (+ wal/shm), the Store-installed
// extension folders and the stale extensions-root node_modules. Idempotent: items already in the
// backup (or absent at the source) are skipped, and every run rewrites migration-log.json with
// what it saw. Nothing under the real Raycast install or any user file outside these three
// categories is touched.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * A Store-installed extension dir: package.json carrying the historical Store $schema marker,
 * and no FlowKey manifest.json — a dir with a manifest.json is a FlowKey extension the runtime
 * loads, and is never swept even if its package.json still mentions the old schema.
 */
function isStoreInstalledExtension(dir) {
  if (fs.existsSync(path.join(dir, "manifest.json"))) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
    return typeof manifest.$schema === "string" && manifest.$schema.includes("raycast");
  } catch {
    return false;
  }
}

function moveItem(source, backupRoot) {
  const destination = path.join(backupRoot, path.basename(source));
  if (fs.existsSync(destination)) {
    // Same-named artifact from an earlier run: keep the old copy, suffix the new one.
    const suffixed = `${destination}-${Date.now()}`;
    fs.renameSync(source, suffixed);
    return { source, destination: suffixed };
  }
  fs.renameSync(source, destination);
  return { source, destination };
}

/**
 * Move every Store artifact into the backup folder. Returns the migration record that is also
 * written to `migration-log.json` inside the backup.
 */
function migrateRemovedStoreArtifacts({ dataRoot, extensionsRoot }) {
  const backupRoot = path.join(dataRoot, "_removed-store-backup");
  const moved = [];
  const skipped = [];

  const candidates = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    candidates.push(path.join(dataRoot, `store.sqlite${suffix}`));
  }
  try {
    for (const entry of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(extensionsRoot, entry.name);
      if (isStoreInstalledExtension(dir)) candidates.push(dir);
    }
  } catch {
    /* no extensions root */
  }
  const nodeModules = path.join(extensionsRoot, "node_modules");
  if (fs.existsSync(nodeModules)) candidates.push(nodeModules);

  fs.mkdirSync(backupRoot, { recursive: true });
  for (const source of candidates) {
    if (!fs.existsSync(source)) {
      continue;
    }
    try {
      moved.push(moveItem(source, backupRoot));
    } catch (error) {
      skipped.push({ source, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const log = {
    migratedAt: new Date().toISOString(),
    dataRoot,
    extensionsRoot,
    moved,
    skipped,
    note: "Store artifacts moved (never deleted) during the FlowKey migration M2; re-runs move nothing new.",
  };
  fs.writeFileSync(path.join(backupRoot, "migration-log.json"), JSON.stringify(log, null, 2));
  return log;
}

module.exports = { migrateRemovedStoreArtifacts, isStoreInstalledExtension };
