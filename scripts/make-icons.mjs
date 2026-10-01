// Generates the PWA icons in public/: a 2×2 mosaic of NeAR's colour-field tiles
// (one reference-blue tile) drawn with the same algorithm as the app.
// Run with: npm run icons
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const out = new URL('../public/', import.meta.url);

// Deterministic RNG so the icons are stable between runs.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function colourWheel(p) {
  const phase = Math.floor(p * 8), up = p * 8 - phase, down = 1 - up;
  let r = 0, g = 0, b = 0;
  switch (phase) {
    case 1: b = 1; g = up; break;
    case 2: b = down; g = 1; break;
    case 3: r = up; g = 1; break;
    case 4: r = 1; g = down; break;
    case 5: r = 1; b = up; break;
    case 6: r = down; b = 1; break;
    default: b = down;
  }
  return [r * 255, g * 255, b * 255];
}

function gaussian(rnd) {
  return { uq: rnd(), up: rnd(), sq: rnd() + 0.33, sp: rnd() + 0.33, r: rnd() * 1.6 - 0.8 };
}
function density(q, p, g) {
  const t1 = (q - g.uq) ** 2 / g.sq ** 2, t2 = (p - g.up) ** 2 / g.sp ** 2;
  const t3 = (2 * g.r * (q - g.uq) * (p - g.up)) / (g.sq * g.sp);
  return Math.exp(-(t1 + t2 - t3) / (2 * (1 - g.r * g.r)));
}

const fields = [11, 23, 0, 47].map((seed) => {
  if (seed === 0) return null; // reference tile
  const rnd = mulberry32(seed);
  return [gaussian(rnd), gaussian(rnd)];
});

function render(size, inset) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [31, 59, 115];
  const pad = Math.round(size * inset);
  const gap = Math.round(size * 0.04);
  const cell = (size - 2 * pad - gap) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = bg;
      const cx = x - pad, cy = y - pad;
      const col = cx < cell ? 0 : cx >= cell + gap ? 1 : -1;
      const row = cy < cell ? 0 : cy >= cell + gap ? 1 : -1;
      if (cx >= 0 && cy >= 0 && cx < 2 * cell + gap && cy < 2 * cell + gap && col >= 0 && row >= 0) {
        const f = fields[row * 2 + col];
        const q = (cx - col * (cell + gap)) / cell, p = (cy - row * (cell + gap)) / cell;
        if (!f) c = [100, 149, 237];
        else {
          const a = density(q, p, f[1]), b = density(q, p, f[0]);
          c = colourWheel(Number.isFinite(a / (a + b)) ? a / (a + b) : 0.5);
        }
      }
      const i = (y * size + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return png(size, px);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL('icon-192.png', out), render(192, 0.1));
writeFileSync(new URL('icon-512.png', out), render(512, 0.1));
writeFileSync(new URL('icon-512-maskable.png', out), render(512, 0.2)); // keeps tiles inside the safe zone
writeFileSync(new URL('apple-touch-icon.png', out), render(180, 0.12));
console.log('Icons written to public/');
