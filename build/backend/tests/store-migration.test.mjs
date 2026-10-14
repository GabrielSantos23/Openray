// A4 (docs/flowkey-migration-plan.md M2): the Store artifact migration moves — never deletes —
// store.sqlite (+ wal/shm), Store-installed extension folders (identified by the Store $schema
// marker in package.json) and the stale extensions-root node_modules into
// `<dataRoot>/_removed-store-backup/`, writes migration-log.json, and is idempotent: re-running
// moves nothing and rewrites the log. Dev extensions (no $schema) and unrelated files stay put.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { isStoreInstalledExtension, migrateRemovedStoreArtifacts } = await import(
  new URL("file://" + path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src", "store-migration.js").replace(/\\/g, "/")).href
);

function stage({ withStoreDb = true, withStoreExtension = true, withDevExtension = true, withNodeModules = true, withIcon = false } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "store-migration-data-"));
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "store-migration-ext-"));
  if (withStoreDb) fs.writeFileSync(path.join(dataRoot, "store.sqlite"), "db");
  if (withStoreDb) fs.writeFileSync(path.join(dataRoot, "store.sqlite-wal"), "wal");
  if (withStoreExtension) {
    const dir = path.join(extensionsRoot, "spotify-player");
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ $schema: "https://raycast.example/schema/raycast-extension.json", name: "spotify-player", commands: [] }),
    );
    fs.writeFileSync(path.join(dir, "search.js"), "bundle");
    if (withIcon) fs.writeFileSync(path.join(dir, "assets", "icon.png"), "png");
  }
  if (withDevExtension) {
    const dir = path.join(extensionsRoot, "command-ux-test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "command-ux-test", commands: [] }));
  }
  if (withNodeModules) {
    const dir = path.join(extensionsRoot, "node_modules", "react");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.js"), "react");
  }
  return { dataRoot, extensionsRoot };
}

test("moves store.sqlite(+wal), Store-installed folders and node_modules; keeps dev extensions; logs every move", () => {
  const { dataRoot, extensionsRoot } = stage({ withIcon: true });
  const log = migrateRemovedStoreArtifacts({ dataRoot, extensionsRoot });

  const backup = path.join(dataRoot, "_removed-store-backup");
  assert.equal(fs.existsSync(path.join(dataRoot, "store.sqlite")), false, "store.sqlite moved out");
  assert.equal(fs.existsSync(path.join(extensionsRoot, "spotify-player")), false, "Store extension moved out");
  assert.equal(fs.existsSync(path.join(extensionsRoot, "node_modules")), false, "node_modules moved out");
  assert.equal(fs.existsSync(path.join(backup, "store.sqlite")), true);
  assert.equal(fs.existsSync(path.join(backup, "store.sqlite-wal")), true);
  assert.equal(fs.existsSync(path.join(backup, "spotify-player", "search.js")), true);
  assert.equal(fs.existsSync(path.join(backup, "spotify-player", "assets", "icon.png")), true);
  assert.equal(fs.existsSync(path.join(backup, "node_modules", "react", "index.js")), true);
  // Move, never delete-into-void: dev extensions untouched, no node_modules collateral.
  assert.equal(fs.existsSync(path.join(extensionsRoot, "command-ux-test", "manifest.json")), true);

  const destinations = log.moved.map((entry) => path.basename(entry.destination)).sort();
  assert.deepEqual(destinations, ["node_modules", "spotify-player", "store.sqlite", "store.sqlite-wal"]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(backup, "migration-log.json"), "utf-8"));
  assert.equal(onDisk.moved.length, log.moved.length);
  assert.equal(fs.existsSync(path.join(backup, "command-ux-test")), false, "dev extension never copied");
});

test("idempotent: a re-run moves nothing and rewrites the log", () => {
  const { dataRoot, extensionsRoot } = stage();
  migrateRemovedStoreArtifacts({ dataRoot, extensionsRoot });
  const second = migrateRemovedStoreArtifacts({ dataRoot, extensionsRoot });

  assert.deepEqual(second.moved, [], "nothing left to move");
  assert.deepEqual(second.skipped, []);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataRoot, "_removed-store-backup", "migration-log.json"), "utf-8"));
  assert.deepEqual(onDisk.moved, []);
});

test("a source re-appearing after a previous run lands under a fresh name, never overwrites the backup", () => {
  const { dataRoot, extensionsRoot } = stage({ withStoreDb: true, withStoreExtension: false, withDevExtension: false, withNodeModules: false });
  migrateRemovedStoreArtifacts({ dataRoot, extensionsRoot });
  fs.writeFileSync(path.join(dataRoot, "store.sqlite"), "db-again");
  const second = migrateRemovedStoreArtifacts({ dataRoot, extensionsRoot });

  assert.equal(second.moved.length, 1);
  assert.match(path.basename(second.moved[0].destination), /store\.sqlite-\d+$/);
  assert.equal(fs.readFileSync(second.moved[0].destination, "utf-8"), "db-again");
  assert.equal(fs.readFileSync(path.join(dataRoot, "_removed-store-backup", "store.sqlite"), "utf-8"), "db");
});

test("isStoreInstalledExtension: only the Store $schema marker qualifies; manifest.json-only dirs are dev", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-migration-probe-"));
  try {
    const storeOne = path.join(root, "store-one");
    fs.mkdirSync(storeOne);
    fs.writeFileSync(path.join(storeOne, "package.json"), JSON.stringify({ $schema: "https://raycast.example/schema/raycast-extension.json" }));
    const devOne = path.join(root, "dev-one");
    fs.mkdirSync(devOne);
    fs.writeFileSync(path.join(devOne, "manifest.json"), JSON.stringify({ id: "dev-one" }));
    const junk = path.join(root, "junk");
    fs.mkdirSync(junk);
    fs.writeFileSync(path.join(junk, "package.json"), "{not json");
    // A deployed FlowKey extension that still ships a legacy Store $schema package.json must
    // never be swept: the manifest.json makes it a FlowKey extension the runtime loads.
    const flowkey = path.join(root, "flowkey-one");
    fs.mkdirSync(flowkey);
    fs.writeFileSync(path.join(flowkey, "package.json"), JSON.stringify({ $schema: "https://raycast.example/schema/raycast-extension.json" }));
    fs.writeFileSync(path.join(flowkey, "manifest.json"), JSON.stringify({ id: "flowkey-one", commands: [] }));

    assert.equal(isStoreInstalledExtension(storeOne), true);
    assert.equal(isStoreInstalledExtension(devOne), false);
    assert.equal(isStoreInstalledExtension(junk), false);
    assert.equal(isStoreInstalledExtension(flowkey), false, "manifest.json wins over a legacy $schema");
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
