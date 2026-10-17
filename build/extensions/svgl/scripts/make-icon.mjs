// Generates assets/command-icon.png: a violet tile with a white pen-nib mark (svgl-flavored,
// drawn from scratch). Run: node scripts/make-icon.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const size = 64;
const pixels = Buffer.alloc(size * size * 4, 0);

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

// Rounded-square tile (#6d28d9) with a subtle darker edge.
const radius = 13;
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx < radius && ry < radius) {
      const distance = Math.hypot(rx - radius, ry - radius);
      if (distance > radius) continue;
      if (distance > radius - 1.4) {
        put(x, y, 91, 33, 182);
        continue;
      }
    }
    put(x, y, 109, 40, 217);
  }
}

// White pen nib: a kite from the tip down to two wings, with a punched ink hole.
const inNib = (x, y) => {
  if (y < 14 || y > 50) return false;
  if (y <= 38) {
    const half = 2 + (y - 14) * (12 / 24);
    return Math.abs(x - 32) <= half;
  }
  const half = 14 - (y - 38) * (14 / 12);
  return Math.abs(x - 32) <= half;
};
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    if (!inNib(x, y)) continue;
    const hole = Math.hypot(x - 32, y - 36);
    if (hole <= 3.6) {
      put(x, y, 109, 40, 217);
    } else if (hole <= 4.6) {
      put(x, y, 224, 210, 245);
    } else {
      put(x, y, 248, 246, 252);
    }
  }
}

const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  raw[y * (size * 4 + 1)] = 0;
  pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
};
const table = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ~crc;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(here, "..", "assets", "command-icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
