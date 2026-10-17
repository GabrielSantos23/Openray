// Clipboard history: the Node half.
//
// Raycast keeps the store in `backend/index.mjs` behind `C.clipboard.*` and drives it from
// `handler::clipboard-history`. The shipped bundle gave us the contract this file implements:
//
//   * `contentHash` = MD5 over the normalized items, used as the dedupe key;
//   * re-copying merges into the existing entry (union of representations, `copyCount++`,
//     `updatedAt` bumped, `createdAt` preserved) instead of inserting a duplicate;
//   * large payloads (>= 30 KB text, all images) are spilled to a cache directory under an MD5 name
//     and referenced by path, so the database never holds big blobs;
//   * titles follow basename -> `Image (WxH)` / `Image (date)` -> ~100 chars of text -> `Untitled`;
//   * categories are `text`, `link`, `email`, `color`, `image`, `file`.
//
// Storage is local-only: `node:sqlite` (Node 22.5+, no native module to ship) at
// `%LOCALAPPDATA%\Openray\clipboard-history.sqlite`.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const LARGE_TEXT_BYTES = 30 * 1024;
const HASH_HEAD_BYTES = 40 * 1024 * 1024;
const HASH_TAIL_BYTES = 10 * 1024 * 1024;

const TEXT_MIME_TYPES = ["text/plain", "text/html", "text/rtf", "application/vnd.raycast.rtfd"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clipboard_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  categories TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  items TEXT NOT NULL,
  source TEXT,
  content_hash TEXT NOT NULL,
  copy_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  pinned_order INTEGER,
  pinned_at INTEGER
);
CREATE INDEX IF NOT EXISTS clipboard_entries_hash ON clipboard_entries (content_hash);
CREATE INDEX IF NOT EXISTS clipboard_entries_updated ON clipboard_entries (updated_at DESC);
CREATE TABLE IF NOT EXISTS clipboard_tags (
  tag TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS clipboard_filters (
  source_url TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1
);
`;

function nowIso() {
  return new Date().toISOString();
}

let lastTimestamp = "";
let timestampCounter = 0;
function nextTimestamp() {
  const now = new Date().toISOString();
  if (now === lastTimestamp) {
    timestampCounter++;
    // Ensure unique timestamp by incrementing milliseconds
    const base = now.slice(0, -1); // Remove 'Z'
    const ms = parseInt(now.slice(-4, -1), 10) || 0;
    const newMs = (ms + timestampCounter) % 1000;
    lastTimestamp = `${base}${newMs.toString().padStart(3, '0')}Z`;
  } else if (now < lastTimestamp) {
    // If system clock went backwards or we're in the same millisecond but lastTimestamp was incremented
    timestampCounter++;
    const base = lastTimestamp.slice(0, -1); // Remove 'Z'
    const ms = parseInt(lastTimestamp.slice(-4, -1), 10) || 0;
    const newMs = (ms + timestampCounter) % 1000;
    lastTimestamp = `${base}${newMs.toString().padStart(3, '0')}Z`;
  } else {
    lastTimestamp = now;
    timestampCounter = 0;
  }
  return lastTimestamp;
}

/** MD5 of a string, matching Raycast's `createHash("md5")`. */
function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function parseMime(mimeType) {
  const [essence] = String(mimeType ?? "").split(";");
  const [type, subtype = ""] = essence.split("/");
  return { base: essence, type: type.toLowerCase(), subtype: subtype.toLowerCase() };
}

const CACHE_FILE_PREFIX = "raycast-";

/** Raycast stores recognised text as its own representation on the image item. */
const OCR_MIME = "application/vnd.raycast.ocr";

/** One path per line from a `text/uri-list` representation, or a single path from a file reference. */
function pathsFrom(representation) {
  if (!representation?.content) return [];
  if (representation.contentType !== "text") return [representation.content];
  return representation.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** True when the representation names a path the entry owns (never one of our own cache files). */
function isSourcePath(representation) {
  if (representation.contentType === "url") {
    return !path.basename(representation.content ?? "").startsWith(CACHE_FILE_PREFIX);
  }
  return representation.contentType === "text" && /^text\/uri-list$/i.test(representation.mimeType ?? "");
}

function representationText(item) {
  return item?.representations?.find(
    (representation) =>
      representation.contentType === "text" &&
      TEXT_MIME_TYPES.includes(parseMime(representation.mimeType).base),
  );
}

function representationPlainText(item) {
  return item?.representations?.find(
    (representation) =>
      representation.contentType === "text" &&
      parseMime(representation.mimeType).base === "text/plain",
  );
}

function representationImage(item) {
  return item?.representations?.find(
    (representation) => parseMime(representation.mimeType).type === "image",
  );
}

function representationUrl(item) {
  return item?.representations?.find(
    (representation) =>
      representation.contentType === "text" &&
      parseMime(representation.mimeType).base === "text/uri-list",
  );
}

const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$|^hsla?\(\s*\d{1,3}(?:\.\d+)?(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

function looksLikeColor(value) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return COLOR_PATTERN.test(trimmed);
}

function looksLikeEmail(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("mailto:")) return true;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
}

function isLink(value) {
  const trimmed = value.trim();
  return /^(https?|ftp|file):\/\/\S+$/i.test(trimmed) || /^mailto:\S+$/i.test(trimmed);
}

function createClipboardStore(options = {}) {
  const dataRoot =
    options.dataRoot ??
    path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Openray");
  const databasePath = options.databasePath ?? path.join(dataRoot, "clipboard-history.sqlite");
  const cacheRoot = options.cacheRoot ?? path.join(dataRoot, "clipboard-cache");

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const listeners = new Set();

  function emitStateChanged() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error("[clipboard] state listener failed", error);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Cache spill
  // ---------------------------------------------------------------------------------------------

  function extensionFor(mimeType) {
    const { base, subtype } = parseMime(mimeType);
    switch (base) {
      case "image/png":
        return "png";
      case "image/jpeg":
      case "image/jpg":
        return "jpeg";
      case "text/html":
        return "html";
      case "text/rtf":
        return "rtf";
      case "text/uri-list":
      case "text/plain":
        return "txt";
      default:
        return subtype ? "bin" : null;
    }
  }

  /**
   * Reads pixel dimensions straight out of the image header so titles can be `Image (WxH)` without
   * decoding the payload. Raycast does the same (`WCe`) before falling back to a date.
   */
  function imageDimensions(buffer) {
    if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
      if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        const isFrame =
          (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    return null;
  }

  function spill(content, mimeType) {
    const hash = md5(content);
    const extension = extensionFor(mimeType);
    const target = path.join(cacheRoot, `${CACHE_FILE_PREFIX}${hash}${extension ? `.${extension}` : ""}`);
    if (!fs.existsSync(target)) fs.writeFileSync(target, content);
    return target;
  }

  /**
   * Moves a representation's payload out of the database. Images always spill; text spills once it
   * reaches Raycast's 30 KB threshold. `url` representations already point at a file.
   */
  function normalizeRepresentation(representation) {
    if (representation.contentType !== "text") {
      if (representation.contentType === "blob") {
        const bytes = Buffer.from(representation.content ?? "", "base64");
        const spilled = spill(bytes, representation.mimeType);
        const dimensions = imageDimensions(bytes);
        return {
          mimeType: representation.mimeType,
          contentType: "url",
          content: spilled,
          size: bytes.length,
          ...(dimensions ?? {}),
        };
      }
      return representation;
    }
    const size = Buffer.byteLength(representation.content ?? "", "utf8");
    if (size < LARGE_TEXT_BYTES) return { ...representation, size };
    const spilled = spill(representation.content, representation.mimeType);
    return { mimeType: representation.mimeType, contentType: "url", content: spilled, size };
  }

  function normalizeItems(items) {
    const normalized = [];
    for (const item of items ?? []) {
      const representations = (item?.representations ?? [])
        .map(normalizeRepresentation)
        .filter(Boolean);
      if (representations.length > 0) normalized.push({ representations });
    }
    return normalized;
  }

  // ---------------------------------------------------------------------------------------------
  // Hashing / titles / categories
  // ---------------------------------------------------------------------------------------------

  function updateRepresentation(hash, representation) {
    if (!representation) return;
    hash.update(representation.mimeType);
    if (representation.contentType === "url") {
      let size = 0;
      try {
        size = fs.statSync(representation.content).size;
      } catch {
        return;
      }
      // Raycast streams the whole file when it is small enough, and samples head+tail beyond that.
      hash.update(
        size <= HASH_HEAD_BYTES + HASH_TAIL_BYTES
          ? fs.readFileSync(representation.content)
          : samplingHashInput(representation.content, size),
      );
      return;
    }
    hash.update(String(representation.content ?? ""));
  }

  function samplingHashInput(filePath, size) {
    const head = Buffer.allocUnsafe(HASH_HEAD_BYTES);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, head, 0, HASH_HEAD_BYTES, 0);
      const tail = Buffer.allocUnsafe(HASH_TAIL_BYTES);
      fs.readSync(fd, tail, 0, HASH_TAIL_BYTES, size - HASH_TAIL_BYTES);
      return Buffer.concat([head, tail, Buffer.from(String(size))]);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** One item contributes exactly one representation to the hash (the displayable one). */
  function hashableRepresentation(item) {
    const candidates = [
      representationImage(item),
      representationUrl(item),
      representationText(item),
      item?.representations?.[0],
    ];
    return candidates.find(Boolean);
  }

  function contentHash(items) {
    const hash = crypto.createHash("md5");
    for (const item of items) {
      const representation = hashableRepresentation(item);
      if (!representation) continue;
      if (
        representation.contentType === "text" &&
        representation.mimeType.includes("com.microsoft.Object-Descriptor")
      ) {
        continue;
      }
      updateRepresentation(hash, representation);
    }
    return hash.digest("hex");
  }

  /**
   * `observationId` is `<host>:<seq>` (`llo`). Raycast keeps the highest sequence seen per host and
   * drops anything older (`plo`), because a slow clipboard read can deliver observations out of order
   * and a stale one must not overwrite a newer entry.
   */
  function parseObservationId(observationId) {
    if (typeof observationId !== "string") return null;
    const match = /^(macos|windows):(\d+)$/.exec(observationId);
    if (!match) return null;
    const sequence = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(sequence) || sequence < 0) return null;
    return { host: match[1], sequence };
  }

  const latestSequenceByHost = new Map();

  function titleFor(items) {
    const parts = [];
    for (const item of items) {
      const fileish = representationUrl(item);
      const filePaths = pathsFrom(fileish);
      if (filePaths.length > 0) {
        // One item per copied file, so a multi-file copy is several items and the title lists their
        // basenames joined with commas (Raycast's `qF` joins every item's title with ", ").
        parts.push(path.basename(filePaths[0]));
        continue;
      }
      const image = representationImage(item);
      if (image && !representationText(item)?.content?.trim()) {
        if (image.width && image.height) parts.push(`Image (${image.width}x${image.height})`);
        else parts.push(`Image (${new Date().toLocaleString()})`);
        continue;
      }
      const text = inlineTextOf(item);
      if (text) parts.push(summarizeText(text));
    }
    if (parts.length === 0) return "Untitled";
    return parts.join(", ");
  }

  function inlineTextOf(item) {
    const direct = representationText(item)?.content;
    if (direct) return direct;
    const reference = representationUrl(item);
    if (!reference?.content) return null;
    try {
      return fs.readFileSync(reference.content, "utf-8");
    } catch {
      return null;
    }
  }

  function summarizeText(text) {
    const words = [];
    let length = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const remaining = 100 - length;
      const piece = trimmed.length > remaining ? trimmed.substring(0, remaining) : trimmed;
      words.push(piece);
      length += piece.length;
      if (length >= 100) break;
    }
    return words.join(" ");
  }

  function categoriesFor(items) {
    const categories = new Set();
    for (const item of items) {
      const urlRepresentation = representationUrl(item);
      if (urlRepresentation) {
        categories.add("file");
        if (representationImage(item)) categories.add("image");
        continue;
      }
      if (representationImage(item) && !representationText(item)) {
        categories.add("image");
        continue;
      }
      const text = representationPlainText(item)?.content ?? representationUrl(item)?.content ?? "";
      if (text) {
        if (isLink(text)) {
          categories.add("link");
          if (looksLikeEmail(text)) categories.add("email");
          continue;
        }
        if (looksLikeColor(text)) {
          categories.add("color");
          continue;
        }
      }
      categories.add("text");
    }
    return [...categories];
  }

  // ---------------------------------------------------------------------------------------------
  // Row mapping
  // ---------------------------------------------------------------------------------------------

  function rowToEntry(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      categories: JSON.parse(row.categories),
      tags: JSON.parse(row.tags),
      items: JSON.parse(row.items),
      source: row.source ? JSON.parse(row.source) : null,
      contentHash: row.content_hash,
      copyCount: row.copy_count,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      pinned: row.pinned_order === null ? undefined : row.pinned_order,
    };
  }

  function insertStatement() {
    return db.prepare(
      `INSERT INTO clipboard_entries
         (id, title, categories, tags, items, source, content_hash, copy_count, created_at, updated_at, pinned_order, pinned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    );
  }

  function selectOneByHash(hash) {
    return db.prepare("SELECT * FROM clipboard_entries WHERE content_hash = ? LIMIT 1").get(hash);
  }

  function getOneByContentHash(hash) {
    return rowToEntry(selectOneByHash(hash));
  }

  /**
   * The dedupe hash for a raw incoming item list. Used by the ingest path's duplicate pre-check, so
   * the hash the check compares is produced by the same code that stores the entry.
   */
  function hashOf(items) {
    const normalized = normalizeItems(items);
    return normalized.length === 0 ? null : contentHash(normalized);
  }

  function selectOne(id) {
    return db.prepare("SELECT * FROM clipboard_entries WHERE id = ?").get(id);
  }

  function nextPinnedOrder() {
    const row = db.prepare("SELECT MAX(pinned_order) AS max FROM clipboard_entries").get();
    return (row?.max ?? -1) + 1;
  }

  function unionRepresentations(existing, incoming) {
    let changed = false;
    const result = existing.map((item) => ({ representations: [...item.representations] }));
    incoming.forEach((incomingItem, index) => {
      const target = result[index];
      if (!target) {
        result.push({ representations: [...incomingItem.representations] });
        changed = true;
        return;
      }
      for (const representation of incomingItem.representations) {
        const known = target.representations.some(
          (candidate) =>
            candidate.mimeType === representation.mimeType &&
            candidate.contentType === representation.contentType &&
            candidate.content === representation.content,
        );
        if (!known) {
          target.representations.push(representation);
          changed = true;
        }
      }
    });
    return { items: changed ? result : existing, changed };
  }

  function sameItems(left, right) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => {
      const other = right[index];
      if (!other || item.representations.length !== other.representations.length) return false;
      return item.representations.every((representation, position) => {
        const candidate = other.representations[position];
        return (
          candidate &&
          candidate.mimeType === representation.mimeType &&
          candidate.contentType === representation.contentType &&
          candidate.content === representation.content
        );
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Ingest
  // ---------------------------------------------------------------------------------------------

  /**
   * `oG({entry})` in Raycast: insert, or merge into the existing entry with the same content hash.
   * Returns `{ entry, didMutate, mutationKind }`.
   */
  function add(entry) {
    const observation = parseObservationId(entry?.observationId);
    if (observation) {
      const latest = latestSequenceByHost.get(observation.host);
      if (latest !== undefined && observation.sequence < latest) {
        return { entry: undefined, didMutate: false, mutationKind: "stale-observation" };
      }
      if (latest === undefined || observation.sequence > latest) {
        latestSequenceByHost.set(observation.host, observation.sequence);
      }
    }

    const items = normalizeItems(entry?.items);
    if (items.length === 0) {
      console.info("[clipboard] received clipboard entry with no items, discarding...");
      return { entry: undefined, didMutate: false, mutationKind: undefined };
    }

    const hash = contentHash(items);
    const categories = categoriesFor(items);
    const title = titleFor(items);
    const source = entry.source ? { host: "Windows", ...entry.source } : null;
    const existing = selectOneByHash(hash);

    if (existing) {
      const current = rowToEntry(existing);
      const { items: merged, changed } = unionRepresentations(current.items, items);
      const mergedCategories = [...new Set([...current.categories, ...categories])];
      const categoryChanged = JSON.stringify([...current.categories].sort()) !==
        JSON.stringify([...mergedCategories].sort());
      const sourceChanged =
        (current.source?.host ?? null) !== (source?.host ?? null) ||
        (current.source?.name ?? null) !== (source?.name ?? null) ||
        (current.source?.url ?? null) !== (source?.url ?? null);

      if (!changed && !categoryChanged && !sourceChanged) {
        return { entry: current, didMutate: false, mutationKind: undefined };
      }

      const updated = {
        ...current,
        title,
        categories: mergedCategories,
        items: merged,
        source: source ?? current.source,
        contentHash: hash,
        copyCount: (current.copyCount ?? 0) + 1,
        updatedAt: nextTimestamp(),
      };
      writeRow(updated);
      return {
        entry: updated,
        didMutate: true,
        mutationKind: changed ? "representations-enriched" : "updated-existing",
      };
    }

    if (categories.length === 1 && categories[0] === "text" && !title.trim()) {
      console.info("[clipboard] clipboard entry discarded because it is likely empty");
      return { entry: undefined, didMutate: false, mutationKind: undefined };
    }

    const inserted = {
      id: crypto.randomUUID(),
      title,
      categories,
      tags: entry.tags ?? [],
      items,
      source,
      contentHash: hash,
      copyCount: 1,
      createdAt: nextTimestamp(),
      updatedAt: nextTimestamp(),
      pinned: undefined,
    };
    insertStatement().run(
      inserted.id,
      inserted.title,
      JSON.stringify(inserted.categories),
      JSON.stringify(inserted.tags),
      JSON.stringify(inserted.items),
      inserted.source ? JSON.stringify(inserted.source) : null,
      inserted.contentHash,
      inserted.copyCount,
      Date.parse(inserted.createdAt),
      Date.parse(inserted.updatedAt),
    );
    return { entry: inserted, didMutate: true, mutationKind: "inserted" };
  }

  function writeRow(entry) {
    db.prepare(
      `UPDATE clipboard_entries
         SET title = ?, categories = ?, tags = ?, items = ?, source = ?, content_hash = ?,
             copy_count = ?, updated_at = ?, pinned_order = ?, pinned_at = ?
       WHERE id = ?`,
    ).run(
      entry.title,
      JSON.stringify(entry.categories),
      JSON.stringify(entry.tags ?? []),
      JSON.stringify(entry.items),
      entry.source ? JSON.stringify(entry.source) : null,
      entry.contentHash,
      entry.copyCount ?? 1,
      Date.parse(entry.updatedAt),
      entry.pinned ?? null,
      entry.pinned === undefined ? null : Date.parse(entry.updatedAt),
      entry.id,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Queries and mutations
  // ---------------------------------------------------------------------------------------------

  /**
   * Cursor pagination. The cursor is `<updatedAt>|<id>` because `updated_at` alone is not unique —
   * a merge bumps two entries in the same millisecond often enough to drop rows on a plain
   * `updated_at < cursor` walk. Ordering by `(updated_at DESC, id DESC)` and comparing the tuple
   * makes paging stable.
   */
  const ENTRY_COLUMNS = `id, title, categories, tags, items, source, content_hash, copy_count,
    created_at, updated_at, pinned_order, pinned_at`;

  function parseCursor(cursor) {
    if (typeof cursor !== "string") return null;
    const separator = cursor.lastIndexOf("|");
    if (separator < 0) return null;
    const updatedAt = Number.parseInt(cursor.slice(0, separator), 10);
    const id = cursor.slice(separator + 1);
    if (!Number.isSafeInteger(updatedAt) || id.length === 0) return null;
    return { updatedAt, id };
  }

  function buildQuery({ cursor, filter, category, tag, pinned }) {
    const clauses = [];
    const parameters = [];

    if (pinned === true) clauses.push("pinned_order IS NOT NULL");
    else if (pinned === false) clauses.push("pinned_order IS NULL");

    const position = parseCursor(cursor);
    if (position) {
      clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      parameters.push(position.updatedAt, position.updatedAt, position.id);
    }
    if (category && category !== "all") {
      clauses.push("categories LIKE ?");
      parameters.push(`%"${category}"%`);
    }
    if (filter) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR items LIKE ? ESCAPE '\\')");
      const escaped = filter.replace(/[\\%_]/g, (character) => `\\${character}`);
      parameters.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (tag) {
      clauses.push("tags LIKE ? ESCAPE '\\'");
      const escapedTag = tag.replace(/[\\%_]/g, (character) => `\\${character}`);
      parameters.push(`%"${escapedTag}"%`);
    }

    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      parameters,
    };
  }

  function query({ cursor, limit, filter, category, tag, pinned, order }) {
    const { where, parameters } = buildQuery({ cursor, filter, category, tag, pinned });
    const direction = order === "asc" ? "ASC" : "DESC";
    const rows = db
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM clipboard_entries ${where}
         ORDER BY pinned_order IS NULL, pinned_order ${direction}, updated_at ${direction}, id ${direction}
         LIMIT ?`,
      )
      .all(...parameters, limit);
    return rows;
  }

  /** Trim an entry's representations (cache maintenance), recomputing the hash. */
  function replaceItems(id, items) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't update clipboard entry because it doesn't exist anymore");
    const updated = {
      ...entry,
      items,
      contentHash: contentHash(items),
      updatedAt: nowIso(),
    };
    writeRow(updated);
    emitStateChanged();
    return getOne(id);
  }

  /**
   * Pinned entries are not paginated: they are the user's explicit shortlist, there are never many,
   * and they must sort above every age section in their own order. The cursor walks the unpinned
   * entries only, which is where the unbounded volume lives once retention is set to Unlimited.
   */
  function all({ cursor, limit = 100, filter, category, tag } = {}) {
    // Pinned entries ride along with the first page only. Including them in every page would repeat
    // the same rows and make `nextCursor` pages overlap.
    const pinned = cursor
      ? []
      : query({ limit, filter, category, tag, pinned: true, order: "asc" });
    const unpinned = query({ cursor, limit: limit + 1, filter, category, tag, pinned: false, order: "desc" });
    const hasMore = unpinned.length > limit;
    const unpinnedPage = unpinned.slice(0, limit);
    const last = unpinnedPage[unpinnedPage.length - 1];
    return {
      entries: [...pinned, ...unpinnedPage].map(rowToEntry),
      nextCursor: hasMore && last ? `${last.updated_at}|${last.id}` : null,
    };
  }

  /**
   * Raycast's `getLast({ offset })`. The tiebreaker matches `all()` on purpose: two entries copied in
   * the same millisecond would otherwise come back in a different order from the list than from a
   * sequential paste, so the run would skip or repeat an entry.
   */
  function last(offset = 0) {
    const row = db
      .prepare(
        `SELECT * FROM clipboard_entries
         WHERE pinned_order IS NULL
         ORDER BY updated_at DESC, id DESC LIMIT 1 OFFSET ?`,
      )
      .get(offset);
    return rowToEntry(row);
  }

  function getOne(id) {
    return rowToEntry(selectOne(id));
  }

  function deleteOne(id) {
    const result = db.prepare("DELETE FROM clipboard_entries WHERE id = ?").run(id);
    emitStateChanged();
    return result.changes > 0;
  }

  function deleteAll({ includePinned = false } = {}) {
    const result = includePinned
      ? db.prepare("DELETE FROM clipboard_entries").run()
      : db.prepare("DELETE FROM clipboard_entries WHERE pinned_order IS NULL").run();
    emitStateChanged();
    return result.changes;
  }

  function deleteAllBeforeDate({ date, includePinned = false }) {
    const cutoff = Date.parse(date);
    const result = includePinned
      ? db.prepare("DELETE FROM clipboard_entries WHERE updated_at < ?").run(cutoff)
      : db
          .prepare("DELETE FROM clipboard_entries WHERE updated_at < ? AND pinned_order IS NULL")
          .run(cutoff);
    emitStateChanged();
    return result.changes;
  }

  function deleteAllAfterDate({ date, includePinned = false }) {
    const cutoff = Date.parse(date);
    const result = includePinned
      ? db.prepare("DELETE FROM clipboard_entries WHERE updated_at > ?").run(cutoff)
      : db
          .prepare("DELETE FROM clipboard_entries WHERE updated_at > ? AND pinned_order IS NULL")
          .run(cutoff);
    emitStateChanged();
    return result.changes;
  }

  /**
   * Raycast's `updateHistoryAfterAction`: copying or pasting moves an entry to the top of the history
   * by bumping `copyCount` and `updatedAt`. `createdAt` is deliberately untouched.
   */
  function touchCopy(id) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't update clipboard entry because it doesn't exist anymore");
    const updated = { ...entry, copyCount: (entry.copyCount ?? 0) + 1, updatedAt: nowIso() };
    writeRow(updated);
    emitStateChanged();
    return getOne(id);
  }

  function pin(id) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't pin clipboard entry because it doesn't exist anymore");
    entry.pinned = nextPinnedOrder();
    entry.updatedAt = nowIso();
    writeRow(entry);
    emitStateChanged();
    return getOne(id);
  }

  function unpin(id) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't unpin clipboard entry because it doesn't exist anymore");
    entry.pinned = undefined;
    entry.updatedAt = nowIso();
    writeRow(entry);
    emitStateChanged();
    return getOne(id);
  }

  /**
   * `Vlo` in Raycast: `5m`/`60m` are minute offsets, the rest are ISO-8601 day periods, and
   * `unlimited` means no cutoff at all.
   */
  const HISTORY_DURATIONS = {
    "5m": { label: "5 Minutes", minutes: 5 },
    "60m": { label: "1 Hour", minutes: 60 },
    P1D: { label: "1 Day", days: 1 },
    P1W: { label: "1 Week", days: 7 },
    P1M: { label: "1 Month", months: 1 },
    P3M: { label: "3 Months", months: 3 },
    P6M: { label: "6 Months", months: 6 },
    P1Y: { label: "1 Year", years: 1 },
    unlimited: { label: "Unlimited", unlimited: true },
  };

  const DEFAULT_HISTORY_DURATION = "P1W";

  function normalizeDuration(value) {
    return typeof value === "string" && value in HISTORY_DURATIONS ? value : DEFAULT_HISTORY_DURATION;
  }

  /** Cutoff date for a duration, or null when nothing should be pruned. */
  function cutoffForDuration(duration, now = new Date()) {
    const spec = HISTORY_DURATIONS[normalizeDuration(duration)];
    if (spec.unlimited) return null;
    const cutoff = new Date(now.getTime());
    if (spec.minutes !== undefined) cutoff.setMinutes(cutoff.getMinutes() - spec.minutes);
    if (spec.days !== undefined) cutoff.setDate(cutoff.getDate() - spec.days);
    if (spec.months !== undefined) cutoff.setMonth(cutoff.getMonth() - spec.months);
    if (spec.years !== undefined) cutoff.setFullYear(cutoff.getFullYear() - spec.years);
    return cutoff;
  }

  /**
   * `kct` in Raycast, run every 12 hours and on startup. Pinned entries are never pruned, which is
   * why the delete passes `includePinned: false`.
   */
  function pruneHistory(duration, now = new Date()) {
    const cutoff = cutoffForDuration(duration, now);
    if (cutoff === null) return { pruned: 0, duration: normalizeDuration(duration) };
    const deleted = deleteAllBeforeDate({ date: cutoff.toISOString(), includePinned: false });
    return { pruned: deleted, duration: normalizeDuration(duration), cutoff: cutoff.toISOString() };
  }

  function historyDurations() {
    return Object.entries(HISTORY_DURATIONS).map(([value, spec]) => ({ value, label: spec.label }));
  }

  function getAllTags() {
    const tags = new Set();
    for (const row of db.prepare("SELECT tags FROM clipboard_entries").all()) {
      for (const tag of JSON.parse(row.tags)) tags.add(tag);
    }
    for (const row of db.prepare("SELECT tag FROM clipboard_tags").all()) tags.add(row.tag);
    return [...tags].sort((left, right) => left.localeCompare(right));
  }

  /** Raycast's `setTags`: replace the tag list and keep the `clipboard_tags` dictionary in step. */
  function setTags(id, tags) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't update clipboard entry tags because it doesn't exist anymore");
    const cleaned = [
      ...new Set((tags ?? []).map((tag) => String(tag).trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right));
    const updated = { ...entry, tags: cleaned, updatedAt: nowIso() };
    writeRow(updated);
    const known = new Set(getAllTags());
    for (const tag of cleaned) {
      if (known.has(tag)) continue;
      db.prepare("INSERT OR IGNORE INTO clipboard_tags (tag) VALUES (?)").run(tag);
    }
    emitStateChanged();
    return getOne(id);
  }

  /**
   * `movePinnedUp` / `movePinnedDown`: swap `pinned_order` with the neighbouring pinned entry. Raycast
   * only offers these actions for pinned rows, and only when a neighbour actually exists.
   */
  function movePinned(id, direction) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't move the entry because it doesn't exist anymore");
    if (entry.pinned === undefined) {
      throw new Error("Couldn't move the entry because it is not pinned");
    }
    const neighbour = db
      .prepare(
        `SELECT id, pinned_order FROM clipboard_entries
         WHERE pinned_order IS NOT NULL AND pinned_order ${direction === "up" ? "<" : ">"} ?
         ORDER BY pinned_order ${direction === "up" ? "DESC" : "ASC"} LIMIT 1`,
      )
      .get(entry.pinned);
    if (!neighbour) return getOne(id);

    const mine = entry.pinned;
    db.prepare("UPDATE clipboard_entries SET pinned_order = ? WHERE id = ?").run(neighbour.pinned_order, id);
    db.prepare("UPDATE clipboard_entries SET pinned_order = ? WHERE id = ?").run(mine, neighbour.id);
    emitStateChanged();
    return getOne(id);
  }

  function getAllFilters() {
    return db
      .prepare("SELECT source_url, tags, enabled FROM clipboard_filters ORDER BY source_url")
      .all()
      .map((row) => ({
        sourceUrl: row.source_url,
        tags: JSON.parse(row.tags),
        enabled: row.enabled === 1,
      }));
  }

  /**
   * Raycast's `upsertFilter`: `{ sourceUrl, tags, enabled }` keyed on the source executable's URL, so
   * one rule applies to every window that process copies from.
   */
  function upsertFilter(filter) {
    const sourceUrl = String(filter?.sourceUrl ?? "").trim();
    if (!sourceUrl) throw new Error("Couldn't save the filter because it has no source");
    const cleaned = [
      ...new Set((filter?.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right));
    db.prepare(
      `INSERT INTO clipboard_filters (source_url, tags, enabled) VALUES (?, ?, ?)
       ON CONFLICT(source_url) DO UPDATE SET tags = excluded.tags, enabled = excluded.enabled`,
    ).run(sourceUrl, JSON.stringify(cleaned), filter?.enabled === false ? 0 : 1);
    return { sourceUrl, tags: cleaned, enabled: filter?.enabled !== false };
  }

  function deleteFilter(sourceUrl) {
    const result = db.prepare("DELETE FROM clipboard_filters WHERE source_url = ?").run(sourceUrl);
    return result.changes > 0;
  }

  /**
   * Raycast's `updateOne`, used by OCR writes and by rename/edit: it re-checks the row's identity
   * before writing, so a write that was computed from a stale read is rejected instead of clobbering
   * whatever landed in the meantime.
   */
  function updateOne(id, changes, { expectedUpdatedAt } = {}) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't update clipboard entry because it doesn't exist anymore");
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && entry.updatedAt !== expectedUpdatedAt) {
      const error = new Error("Ignoring stale update after concurrent clipboard mutation");
      error.code = "STALE_CLIPBOARD_MUTATION";
      throw error;
    }
    const updated = { ...entry, ...changes, updatedAt: nowIso() };
    writeRow(updated);
    emitStateChanged();
    return getOne(id);
  }

  function renameOne(id, title) {
    const cleaned = String(title ?? "").trim();
    if (!cleaned) throw new Error("Couldn't rename the entry because the title is empty");
    return updateOne(id, { title: cleaned });
  }

  /** Appends OCR text to the image item it came from, as `application/vnd.raycast.ocr`. */
  function appendOcrRepresentation(id, imagePath, text) {
    const entry = getOne(id);
    if (!entry) throw new Error("Couldn't store OCR text because the entry no longer exists");
    const updatedAt = entry.updatedAt;
    let changed = false;
    const items = entry.items.map((item) => {
      const holdsImage = item.representations.some(
        (representation) =>
          String(representation.mimeType ?? "").startsWith("image/")
          && (representation.content === imagePath || imagePath === null),
      );
      if (!holdsImage) return item;
      const already = item.representations.some(
        (representation) =>
          representation.mimeType === OCR_MIME && representation.content === text,
      );
      if (already) return item;
      changed = true;
      return {
        representations: [
          ...item.representations,
          { mimeType: OCR_MIME, contentType: "text", content: text },
        ],
      };
    });
    if (!changed) return entry;
    return updateOne(id, { items }, { expectedUpdatedAt: updatedAt });
  }

  function hasOcrRepresentation(entry) {
    return entry.items.some((item) =>
      item.representations.some((representation) => representation.mimeType === OCR_MIME));
  }

  return {
    add,
    all,
    last,
    getOne,
    getOneByContentHash,
    hashOf,
    replaceItems,
    deleteOne,
    deleteAll,
    deleteAllBeforeDate,
    deleteAllAfterDate,
    touchCopy,
    pin,
    unpin,
    movePinned,
    setTags,
    getAllTags,
    getAllFilters,
    upsertFilter,
    deleteFilter,
    updateOne,
    renameOne,
    appendOcrRepresentation,
    hasOcrRepresentation,
    pruneHistory,
    historyDurations,
    normalizeDuration,
    cutoffForDuration,
    subscribeStateChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitStateChanged,
    paths: { databasePath, cacheRoot },
  };
}

/**
 * `HJn` in Raycast, run daily: drop entries whose source files vanished, then delete the cache files
 * nothing references any more. Files the cache did not create are left alone (`Qlo` guards the
 * `raycast-` prefix), so a stray file dropped into the directory is never destroyed.
 */
function maintainCache(store, logger = console) {
  const { cacheRoot } = store.paths;
  let cached;
  try {
    cached = new Set(fs.readdirSync(cacheRoot));
  } catch (error) {
    logger.error("[clipboard] could not create clipboard cache directory", error);
    return { updatedEntries: 0, deletedEntries: 0, removedFiles: 0, skippedForeignFiles: 0 };
  }

  // Everything currently referenced by a stored entry.
  const referenced = new Set();
  for (const entry of store.all({ limit: Number.MAX_SAFE_INTEGER }).entries) {
    for (const item of entry.items) {
      for (const representation of item.representations) {
        if (representation.contentType !== "url") continue;
        // Only our own cache files are candidates for deletion; source files the user copied
        // (documents, screenshots elsewhere on disk) must never be touched.
        const name = path.basename(representation.content);
        if (representation.content.startsWith(cacheRoot) && name.startsWith(CACHE_FILE_PREFIX)) {
          referenced.add(name);
        }
      }
    }
  }

  let updatedEntries = 0;
  let deletedEntries = 0;
  let removedFiles = 0;
  let skippedForeignFiles = 0;

  const page = store.all({ limit: Number.MAX_SAFE_INTEGER });
  for (const entry of page.entries) {
// Only paths the entry *owns* can vanish: file-backed representations, plus inline
      // `text/uri-list` text, which is how the listener records a copied file. Cache files under our
      // own prefix are never treated as source paths.
      const filePaths = entry.items.flatMap((item) =>
      item.representations.flatMap((representation) =>
        isSourcePath(representation) ? pathsFrom(representation) : [],
      ),
    );
    const vanished = filePaths.filter((target) => {
      try {
        fs.accessSync(target);
        return false;
      } catch {
        return true;
      }
    });
    if (vanished.length === 0) continue;

    if (filePaths.length === vanished.length) {
      store.deleteOne(entry.id);
      deletedEntries += 1;
      continue;
    }
    const surviving = new Set(filePaths.filter((target) => !vanished.includes(target)));
    const trimmed = entry.items
      .map((item) => {
        const representations = item.representations.filter((representation) => {
          if (!isSourcePath(representation)) return true;
          return pathsFrom(representation).some((target) => surviving.has(target));
        });
        return { representations };
      })
      .filter((item) => item.representations.length > 0);
    if (trimmed.length === 0) {
      store.deleteOne(entry.id);
      deletedEntries += 1;
      continue;
    }
    store.replaceItems(entry.id, trimmed);
    updatedEntries += 1;
  }

  for (const name of cached) {
    if (referenced.has(name)) continue;
    if (!name.startsWith(CACHE_FILE_PREFIX)) {
      skippedForeignFiles += 1;
      continue;
    }
    try {
      fs.unlinkSync(path.join(cacheRoot, name));
      removedFiles += 1;
    } catch (error) {
      logger.warn("[clipboard] could not remove an orphaned cache file", name, error);
    }
  }

  logger.info("[clipboard] finished cache maintenance", {
    updatedEntries,
    deletedEntries,
    removedFiles,
    skippedForeignFiles,
  });
  return { updatedEntries, deletedEntries, removedFiles, skippedForeignFiles };
}

module.exports = { createClipboardStore, maintainCache, LARGE_TEXT_BYTES, CACHE_FILE_PREFIX, OCR_MIME };