// Background OCR for image entries, and local QR decoding.
//
// REA confirms both shapes in Raycast's bundle: OCR is dispatched as
// `host.clipboard.performOcr({ path | imageData, level })` with a 500 ms debounce keyed on the entry
// id, and the recognised text is stored as an extra `application/vnd.raycast.ocr` representation on the
// image item. The write is skipped when the entry changed underneath the run.

"use strict";

const fs = require("node:fs");
const { OCR_DEBOUNCE_MS } = require("./clipboard-actions");

const OCR_MIME = "application/vnd.raycast.ocr";
const OCR_LEVELS = ["fast", "accurate"];

/**
 * Schedules OCR for one entry. Repeated calls for the same entry replace the pending timer, which is how
 * Ray coalesces a burst of copies into a single pass.
 */
function createOcrScheduler({ dispatch, store, logger = console, debounceMs = OCR_DEBOUNCE_MS }) {
  const pending = new Map();

  function schedule(entryId) {
    const existing = pending.get(entryId);
    if (existing) clearTimeout(existing.timer);
    const entry = store.getOne(entryId);
    if (!entry) return;
    const timer = setTimeout(() => {
      pending.delete(entryId);
      run(entryId).catch((error) => {
        logger.error("[clipboard] OCR background task failed", error);
      });
    }, debounceMs);
    timer.unref?.();
    pending.set(entryId, { timer });
  }

  async function run(entryId) {
    const entry = store.getOne(entryId);
    if (!entry) return { stored: false, reason: "missing" };
    if (!store.hasOcrRepresentation(entry)) {
      const targets = imageTargetsOf(entry);
      for (const target of targets) {
        try {
          const result = await dispatch("clipboardHistory.performOcr", {
            path: target.path,
            level: target.level,
          });
          const text = String(result?.text ?? "").trim();
          if (!text) continue;
          // A stale write — the entry changed or moved on while OCR ran — must not clobber it.
          store.appendOcrRepresentation(entryId, target.path, text);
          logger.info(`[clipboard] stored OCR text on entry ${entryId} (${text.length} chars)`);
        } catch (error) {
          if (error instanceof Error && /The system cannot find the file specified/.test(error.message)) {
            continue;
          }
          logger.error("[clipboard] failed to analyze image with OCR", error);
        }
      }
    }
    return { stored: true };
  }

  function cancel(entryId) {
    const existing = pending.get(entryId);
    if (!existing) return;
    clearTimeout(existing.timer);
    pending.delete(entryId);
  }

  return { schedule, cancel, run, pending };
}

function imageTargetsOf(entry, level = "fast") {
  const targets = [];
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (!String(representation.mimeType ?? "").startsWith("image/")) continue;
      if (representation.contentType === "url" && representation.content) {
        targets.push({ path: representation.content, level });
      }
    }
  }
  return targets;
}

/**
 * Raycast's `getQrCodeFromImage`: decodes locally and returns every non-empty string it found, one per
 * symbol. Pixels come from the host, which decodes the image so no image library is needed here.
 */
function createQrDecoder({ dispatch, logger = console }) {
  return async function decodeQrCode({ path, imageData }) {
    if (!path && !imageData) {
      throw new Error("Either path or imageData must be provided");
    }
    let pixels = null;
    if (path) {
      pixels = await dispatch("clipboardHistory.readImagePixels", { path });
    } else {
      pixels = imageData;
    }
    if (!pixels?.width || !pixels?.height) return [];

    // jsqr wants RGBA; the host hands back BGRA, which is the same bytes in a different channel order.
    const rgba = Buffer.from(pixels.base64, "base64");
    for (let index = 0; index < rgba.length; index += 4) {
      const blue = rgba[index];
      rgba[index] = rgba[index + 2];
      rgba[index + 2] = blue;
    }
    const rgbaData = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);

    let jsqr;
    try {
      jsqr = require("jsqr");
    } catch (error) {
      logger.error("[clipboard] QR decoding is unavailable because jsqr is not installed", error);
      throw new Error("QR decoding is unavailable");
    }

    const decoded = jsqr.default(rgbaData, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    if (!decoded?.data) return [];
    return [decoded.data.trim()].filter((value) => value.length > 0);
  };
}

/**
 * The backend capability report, so the UI can hide actions this host genuinely cannot perform instead
 * of failing when they are pressed.
 */
function clipboardCapabilities(dispatch) {
  return dispatch("clipboardHistory.clipboardCapabilities", {}).catch((error) => ({
    ocr: { available: false, reason: error.message },
    qr: { available: false },
    shell: {},
  }));
}

function ocrTextOf(entry) {
  const parts = [];
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (representation.mimeType === OCR_MIME && representation.contentType === "text") {
        parts.push(representation.content);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function hasOcr(entry) {
  return entry.items.some((item) =>
    item.representations.some((representation) => representation.mimeType === OCR_MIME));
}

function readImageBytes(entry) {
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (!String(representation.mimeType ?? "").startsWith("image/")) continue;
      if (representation.contentType === "url" && fs.existsSync(representation.content)) {
        return fs.readFileSync(representation.content);
      }
    }
  }
  return null;
}

module.exports = {
  OCR_LEVELS,
  OCR_MIME,
  clipboardCapabilities,
  createOcrScheduler,
  createQrDecoder,
  hasOcr,
  imageTargetsOf,
  ocrTextOf,
  readImageBytes,
};