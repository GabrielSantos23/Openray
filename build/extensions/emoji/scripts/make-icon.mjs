// Generates assets/command-icon.png: a 64x64 smiley on the launcher's dark tile.
// Run: node scripts/make-icon.mjs
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

const cx = 32;
const cy = 32;
const radius = 26;
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const distance = Math.hypot(x - cx, y - cy);
    if (distance <= radius - 1.2) put(x, y, 250, 204, 56);
    else if (distance <= radius + 0.4) put(x, y, 232, 178, 40);
  }
}
// Eyes
for (const eyeX of [22, 42]) {
  for (let y = 22; y <= 29; y += 1) {
    for (let x = eyeX - 3; x <= eyeX + 1; x += 1) {
      if (Math.hypot(x - (eyeX - 1), y - 25.5) <= 3.2) put(x, y, 66, 52, 24);
    }
  }
}
// Smile: arc between (18,36) and (46,36), dipping to y=44
for (let x = 18; x <= 46; x += 1) {
  const t = (x - 18) / 28;
  const y = Math.round(35 + Math.sin(t * Math.PI) * 8);
  for (let thickness = 0; thickness <= 2; thickness += 1) put(x, y + thickness, 66, 52, 24);
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
