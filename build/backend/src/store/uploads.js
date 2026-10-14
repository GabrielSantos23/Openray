// Uploaded ("publish your own") store entries: FlowKey extensions the user or the maintainer
// drops into `<storeRoot>/uploaded/<name>/` — a `manifest.json` + built bundle, plus an optional
// `store.json` (author, screenshots, importedFrom). The Store lists them alongside the GitHub
// catalog, and installing one copies it into the live extensions root where the FlowKey runtime
// picks it up.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

function uploadedDir(storeRoot, name) {
  return path.join(storeRoot, "uploaded", path.basename(name));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** Copy a source extension dir (must contain manifest.json) into the uploads folder. */
function importUploadedExtension({ storeRoot, sourceDir, author = null }) {
  const manifest = readJson(path.join(sourceDir, "manifest.json"));
  if (!manifest?.id) throw new Error(`store.import: ${sourceDir} has no manifest.json with an id`);
  const target = uploadedDir(storeRoot, manifest.id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceDir, target, {
    recursive: true,
    filter: (source) => !/node_modules([/\\]|$)/.test(source),
  });
  const previous = readJson(path.join(target, "store.json")) ?? {};
  fs.writeFileSync(
    path.join(target, "store.json"),
    JSON.stringify(
      {
        source: "uploaded",
        author: author ?? previous.author ?? manifest.author ?? null,
        screenshots: previous.screenshots ?? [],
        importedFrom: sourceDir,
        importedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { name: manifest.id, target };
}

/** Every uploaded extension as a store entry (same shape the GitHub catalog produces). */
function listUploadedExtensions(storeRoot) {
  const root = path.join(storeRoot, "uploaded");
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const listed = [];
  for (const entry of entries) {
    const dir = path.join(root, entry.name);
    const manifest = readJson(path.join(dir, "manifest.json"));
    if (!manifest?.id) continue;
    const meta = readJson(path.join(dir, "store.json")) ?? {};
    // Screenshots: the declared list, else any image sitting in assets/screenshots/.
    let screenshots = meta.screenshots ?? [];
    if (screenshots.length === 0) {
      try {
        screenshots = fs
          .readdirSync(path.join(dir, "assets", "screenshots"))
          .filter((file) => IMAGE_EXT.test(file))
          .map((file) => `assets/screenshots/${file}`);
      } catch {
        screenshots = [];
      }
    }
    listed.push({
      source: "uploaded",
      name: manifest.id,
      title: manifest.name ?? manifest.id,
      description: manifest.description ?? "",
      author: meta.author ?? manifest.author ?? null,
      categories: meta.categories ?? [],
      icon: manifest.icon ?? null,
      contributors: [],
      sha: null,
      installedAt: null,
    });
  }
  return listed;
}

module.exports = { importUploadedExtension, listUploadedExtensions, uploadedDir, readJson, IMAGE_EXT };
