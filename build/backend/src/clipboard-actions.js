// The rest of Raycast's clipboard actions: sequential pasting, OCR, QR decoding, per-format paste
// submenus, colour formatting, editing and the shell hand-offs.
//
// Everything here follows the same two rules Raycast does. Work that could take a moment — OCR, QR
// decoding, file writes — is awaited off the UI thread, and nothing ever leaves the machine.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Raycast's OCR debounce. REA shows `Qco = 5e2`, i.e. half a second after the last capture. */
const OCR_DEBOUNCE_MS = 500;

/** Raycast's `sequenceTimeout` default, in seconds (`t?.meta?.sequenceTimeout || 60`). */
const DEFAULT_SEQUENCE_TIMEOUT_SECONDS = 60;

/** Raycast defaults `addNewLine` to true. */
const DEFAULT_SEQUENCE_NEWLINE = true;

/**
 * Raycast's `PA` triple from the backend bundle: the paste-sequence cursor, when it was last used, and
 * the top entry it started from. Held in memory only, exactly as Raycast holds it, so a restart always
 * begins from the newest entry.
 */
function createPasteSequenceState() {
  return { offset: 0, lastInvocation: null, topItemId: null };
}

/**
 * One step of `Paste Sequentially`.
 *
 * Mirrors Raycast's handler: reset when the gap exceeds the configured timeout, reset when the newest
 * entry has changed underneath the run, then advance the offset and paste that entry. Text-like
 * entries go out as plain text with the optional trailing newline; everything else is pasted as its
 * own items so the target receives the real representations.
 */
function pasteSequentiallyStep({ history, state, sequenceTimeoutSeconds, addNewLine, now = new Date() }) {
  if (state.lastInvocation && now.getTime() - state.lastInvocation.getTime() > sequenceTimeoutSeconds * 1000) {
    state.offset = 0;
  }

  const top = history.store.last(0);
  if (top && top.id !== state.topItemId) {
    state.offset = 0;
    state.topItemId = top.id;
  }

  state.lastInvocation = now;
  const entry = history.store.last(state.offset);
  if (!entry) {
    state.offset = 0;
    return { status: "exhausted", pasted: false, offset: 0 };
  }

  state.offset += 1;
  const text = plainTextOf(entry);
  if (text !== null && isTextLike(entry)) {
    return {
      status: "pasted",
      pasted: true,
      entryId: entry.id,
      offset: state.offset,
      text: addNewLine ? `${text}\n` : text,
      asText: true,
    };
  }
  return {
    status: "pasted",
    pasted: true,
    entryId: entry.id,
    offset: state.offset,
    items: history.preparedEntry(entry).items,
    asText: false,
  };
}

/** Raycast only takes the plain-text path for text, link and colour categories. */
function isTextLike(entry) {
  return entry.categories.some((category) => category === "text" || category === "link" || category === "color");
}

function plainTextOf(entry) {
  const item = entry.items[0];
  const representation = item?.representations?.find(
    (candidate) => candidate.contentType === "text" && baseMime(candidate.mimeType) === "text/plain",
  );
  return representation ? representation.content : null;
}

function baseMime(mimeType) {
  return String(mimeType ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Colour formats. The ids and labels are lifted verbatim from Raycast's `Kos`/`Jos` pair in
 * `index.mjs`, which is the list the `Copy Color as…` submenu is built from.
 */
const COLOR_FORMATS = [
  { id: "hex", label: "Hex" },
  { id: "hexAlpha", label: "Hex with Alpha" },
  { id: "rgba", label: "RGBA" },
  { id: "rgbaPercentage", label: "RGBA (Percentage)" },
  { id: "rgbCss4", label: "RGB (CSS4)" },
  { id: "hsl", label: "HSL" },
  { id: "hsla", label: "HSL with Alpha" },
  { id: "hslCss4", label: "HSL (CSS4)" },
  { id: "hwb", label: "HWB" },
  { id: "lab", label: "Lab" },
  { id: "lch", label: "LCH" },
  { id: "oklab", label: "Oklab" },
  { id: "oklch", label: "Oklch" },
  { id: "nsColor", label: "NSColor (macOS)" },
  { id: "uiColor", label: "UIColor (iOS)" },
];

const NAMED_COLORS = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  olive: "#808000",
  maroon: "#800000",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  brown: "#a52a2a",
  pink: "#ffc0cb",
  gold: "#ffd700",
  indigo: "#4b0082",
  violet: "#ee82ee",
};

function round(value) {
  const factor = 1e12;
  return Math.round(value * factor) / factor;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function hexPair(value) {
  return Math.round(clamp01(value) * 255).toString(16).padStart(2, "0").toUpperCase();
}

/** Parses the colour strings Raycast recognises in clipboard entries. Returns null when unrecognised. */
function parseColor(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  const named = NAMED_COLORS[text.toLowerCase()];
  const source = named ?? text;

  if (/^#([0-9a-f]{3,8})$/i.test(source)) return parseHex(source);
  if (/^[0-9a-f]{6,8}$/i.test(source)) return parseHex(`#${source}`);

  const functional = source.match(/^(rgba?|hsla?)\s*\(([^)]*)\)$/i);
  if (functional) {
    const name = functional[1].toLowerCase();
    const parts = functional[2].split(/[,/]/).map((part) => part.trim()).filter(Boolean);
    if (name === "rgb" || name === "rgba") return parseRgb(parts);
    return parseHsl(parts);
  }
  return null;
}

function parseHex(hex) {
  const body = hex.slice(1);
  const expand = (value) => parseInt(value.length === 1 ? value + value : value, 16) / 255;
  if (body.length === 3 || body.length === 4) {
    return {
      r: expand(body[0]),
      g: expand(body[1]),
      b: expand(body[2]),
      a: body.length === 4 ? expand(body[3]) : 1,
    };
  }
  if (body.length === 6 || body.length === 8) {
    return {
      r: parseInt(body.slice(0, 2), 16) / 255,
      g: parseInt(body.slice(2, 4), 16) / 255,
      b: parseInt(body.slice(4, 6), 16) / 255,
      a: body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function component(token, scale) {
  const percent = token.endsWith("%");
  const numeric = Number(percent ? token.slice(0, -1) : token);
  if (!Number.isFinite(numeric)) return null;
  return clamp01(percent ? numeric / 100 : numeric / scale);
}

function parseRgb(parts) {
  if (parts.length < 3) return null;
  const r = component(parts[0], 255);
  const g = component(parts[1], 255);
  const b = component(parts[2], 255);
  if (r === null || g === null || b === null) return null;
  const alpha = parts.length > 3 ? component(parts[3], 1) : 1;
  return { r, g, b, a: alpha === null ? 1 : alpha };
}

function parseHsl(parts) {
  if (parts.length < 3) return null;
  const hue = Number(parts[0].replace(/deg$/i, ""));
  const saturation = component(parts[1], 1);
  const lightness = component(parts[2], 1);
  if (!Number.isFinite(hue) || saturation === null || lightness === null) return null;
  const alpha = parts.length > 3 ? component(parts[3], 1) : 1;
  const [r, g, b] = hslToRgb(((hue % 360) + 360) % 360, saturation, lightness);
  return { r, g, b, a: alpha === null ? 1 : alpha };
}

function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  let rgb;
  if (hue < 60) rgb = [chroma, secondary, 0];
  else if (hue < 120) rgb = [secondary, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, secondary];
  else if (hue < 240) rgb = [0, secondary, chroma];
  else if (hue < 300) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];
  return rgb.map((value) => clamp01(value + match));
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return [hue, saturation, lightness];
}

function rgbToHwb(r, g, b) {
  const whiteness = Math.min(r, g, b);
  const blackness = 1 - Math.max(r, g, b);
  return [rgbToHsl(r, g, b)[0], whiteness, blackness];
}

function srgbToXyz(r, g, b) {
  const linear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return [linear(r) * 0.4124 + linear(g) * 0.3576 + linear(b) * 0.1805,
    linear(r) * 0.2126 + linear(g) * 0.7152 + linear(b) * 0.0722,
    linear(r) * 0.0193 + linear(g) * 0.1192 + linear(b) * 0.9505];
}

function xyzToLab([x, y, z]) {
  const f = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = f(x / 0.95047);
  const fy = f(y);
  const fz = f(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToLch([l, a, b]) {
  const chroma = Math.sqrt(a * a + b * b);
  let hue = (Math.atan2(b, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return [l, chroma, hue];
}

function formatColor(color, id) {
  const { r, g, b, a } = color;
  switch (id) {
    case "hex":
      return `#${hexPair(r)}${hexPair(g)}${hexPair(b)}`;
    case "hexAlpha":
      return `#${hexPair(r)}${hexPair(g)}${hexPair(b)}${hexPair(a)}`;
    case "rgba":
      return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${round(a)})`;
    case "rgbaPercentage":
      return `rgba(${Math.round(r * 100)}%, ${Math.round(g * 100)}%, ${Math.round(b * 100)}%, ${round(a)})`;
    case "rgbCss4":
      return a < 1
        ? `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)} / ${Math.round(a * 100)}%)`
        : `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    case "hsl":
      return `hsl(${round(rgbToHsl(r, g, b)[0])}deg, ${round(rgbToHsl(r, g, b)[1] * 100)}%, ${round(rgbToHsl(r, g, b)[2] * 100)}%)`;
    case "hsla": {
      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      return `hsl(${round(hue)}deg, ${round(saturation * 100)}%, ${round(lightness * 100)}%, ${round(a)})`;
    }
    case "hslCss4": {
      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      return a < 1
        ? `hsl(${round(hue)}deg ${round(saturation * 100)}% ${round(lightness * 100)}% / ${round(a * 100)}%)`
        : `hsl(${round(hue)}deg ${round(saturation * 100)}% ${round(lightness * 100)}%)`;
    }
    case "hwb": {
      const [hue, whiteness, blackness] = rgbToHwb(r, g, b);
      return `hwb(${round(hue)} ${round(whiteness * 100)}% ${round(blackness * 100)}%)`;
    }
    case "lab": {
      // CIE Lab already reports L on 0..100 and a/b in roughly -128..127.
      const [l, labA, labB] = xyzToLab(srgbToXyz(r, g, b));
      return `lab(${round(l)}% ${round(labA)} ${round(labB)})`;
    }
    case "lch": {
      const [l, chroma, hue] = labToLch(xyzToLab(srgbToXyz(r, g, b)));
      return `lch(${round(l)}% ${round(chroma)} ${round(hue)})`;
    }
    case "oklab":
    case "oklch": {
      // Oklab reports L on 0..1 with a/b around -0.4..0.4, which is what the syntax carries directly.
      const [lightness, okA, okB] = oklabFromSrgb(r, g, b);
      if (id === "oklab") {
        return `oklab(${round(lightness * 100)}% ${round(okA)} ${round(okB)})`;
      }
      const chroma = Math.sqrt(okA * okA + okB * okB);
      let hue = (Math.atan2(okB, okA) * 180) / Math.PI;
      if (hue < 0) hue += 360;
      return a < 1
        ? `oklch(${round(lightness * 100)}% ${round(chroma)} ${round(hue)}deg / ${round(a * 100)}%)`
        : `oklch(${round(lightness * 100)}% ${round(chroma)} ${round(hue)}deg)`;
    }
    case "nsColor":
      return `NSColor(red: ${round(r)}, green: ${round(g)}, blue: ${round(b)}, alpha: ${round(a)})`;
    case "uiColor":
      return `UIColor(red: ${round(r)}, green: ${round(g)}, blue: ${round(b)}, alpha: ${round(a)})`;
    default:
      throw new Error(`unknown color format ${id}`);
  }
}

function oklabFromSrgb(r, g, b) {
  const linear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Every colour format for one entry, in Raycast's order. Throws when the entry is not a colour. */
function formattedColors(input) {
  const color = parseColor(input);
  if (!color) throw new Error("Failed to format color");
  return COLOR_FORMATS.map((format) => ({
    id: format.id,
    label: format.label,
    value: formatColor(color, format.id),
  }));
}

/** The shape `Copy Formatted JSON` copies: the entry, with its payloads still on disk. */
function formattedJson(entry) {
  return `${JSON.stringify(entry, null, 2)}\n`;
}

/** Sanitises a title the way Raycast does when renaming: trimmed, and never blank. */
function normalizeTitle(title) {
  const value = String(title ?? "").trim();
  return value.length === 0 ? null : value;
}

/** The bytes a `Save as File` writes for a text-ish entry, decoded from the representations. */
function exportBytes(entry) {
  const image = imageRepresentationOf(entry);
  if (image) return { bytes: fs.readFileSync(image.content), extension: extensionForMime(image.mimeType) };

  const text = plainTextOf(entry);
  if (text !== null) return { bytes: Buffer.from(text, "utf8"), extension: ".txt" };

  const path = filePathOf(entry);
  if (path) {
    try {
      return { bytes: fs.readFileSync(path), extension: path.extname(path) };
    } catch {
      return null;
    }
  }
  return null;
}

function extensionForMime(mimeType) {
  switch (baseMime(mimeType)) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/bmp": return ".bmp";
    case "image/webp": return ".webp";
    case "image/tiff": return ".tiff";
    case "text/html": return ".html";
    case "text/rtf": return ".rtf";
    case "text/csv": return ".csv";
    case "application/json": return ".json";
    default: return ".txt";
  }
}

function imageRepresentationOf(entry) {
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (baseMime(representation.mimeType).startsWith("image/")) return representation;
    }
  }
  return null;
}

function filePathOf(entry) {
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (baseMime(representation.mimeType).startsWith("text/uri-list") && representation.content) {
        const first = String(representation.content).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        return first ?? null;
      }
    }
  }
  return null;
}

/** The label Raycast shows for a format in the `Paste as…` submenu. */
function labelForMime(mimeType) {
  const base = baseMime(mimeType);
  const labels = {
    "text/plain": "Plain Text",
    "text/html": "HTML",
    "text/rtf": "RTF",
    "text/uri-list": "File",
    "application/vnd.raycast.ocr": "Recognized Text",
    "application/json": "JSON",
  };
  if (labels[base]) return labels[base];
  if (base.startsWith("image/")) return "Image";
  return base;
}

/**
 * The `Paste as…` submenu for an entry: only the formats that entry actually holds, in the order
 * Raycast lists them (plain text first, then the richer formats).
 */
function pasteAsOptions(entry) {
  const seen = new Set();
  const options = [];
  for (const item of entry.items) {
    for (const representation of item.representations) {
      const base = baseMime(representation.mimeType);
      if (seen.has(base)) continue;
      seen.add(base);
      options.push({
        mimeType: representation.mimeType,
        base,
        label: labelForMime(representation.mimeType),
        contentType: representation.contentType,
      });
    }
  }
  const order = ["text/plain", "text/html", "text/rtf", "text/uri-list", "application/vnd.raycast.ocr"];
  return options.sort((a, b) => {
    const indexA = order.indexOf(a.base);
    const indexB = order.indexOf(b.base);
    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}

/** The single representation matching one of the submenu's mime types, ready for the host. */
function representationForMime(entry, mimeType) {
  const wanted = baseMime(mimeType);
  for (const item of entry.items) {
    for (const representation of item.representations) {
      if (baseMime(representation.mimeType) === wanted) return representation;
    }
  }
  return null;
}

module.exports = {
  COLOR_FORMATS,
  NAMED_COLORS,
  DEFAULT_SEQUENCE_NEWLINE,
  DEFAULT_SEQUENCE_TIMEOUT_SECONDS,
  OCR_DEBOUNCE_MS,
  baseMime,
  createPasteSequenceState,
  exportBytes,
  filePathOf,
  formatColor,
  formattedColors,
  formattedJson,
  imageRepresentationOf,
  isTextLike,
  labelForMime,
  normalizeTitle,
  parseColor,
  pasteAsOptions,
  pasteSequentiallyStep,
  plainTextOf,
  representationForMime,
};