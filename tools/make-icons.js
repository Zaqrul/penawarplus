#!/usr/bin/env node
/**
 * Generates icons/{16,32,48,128}.png (teal disc with a white plus) using only
 * Node built-ins. Re-run with `npm run icons` after changing the design.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEAL = [15, 118, 110];
const WHITE = [255, 255, 255];
const SS = 4; // supersampling for smooth edges

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const radius = size * 0.47;
  const arm = size * 0.26;   // half-length of each plus arm
  const half = size * 0.075; // half-thickness
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - c;
          const py = y + (sy + 0.5) / SS - c;
          if (px * px + py * py > radius * radius) continue;
          const plus = (Math.abs(px) <= half && Math.abs(py) <= arm) || (Math.abs(py) <= half && Math.abs(px) <= arm);
          const col = plus ? WHITE : TEAL;
          r += col[0]; g += col[1]; b += col[2]; a += 1;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      if (a > 0) {
        raw[o] = Math.round(r / a);
        raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a);
        raw[o + 3] = Math.round((a / n) * 255);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(path.join(dir, `${size}.png`), render(size));
console.log('icons written to', dir);
