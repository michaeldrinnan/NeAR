// Generates the example audio in public/examples/: synthetic sustained "ah"
// vowels with increasing hoarseness (pitch jitter, loudness shimmer, breath
// noise).
// Run with: npm run examples
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/examples/', import.meta.url);
const SR = 22050;
const DURATION = 2.0;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd) {
  return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

/** Two-pole resonator (formant filter), unity gain at DC removed by the source derivative. */
function resonator(freq, bw) {
  const r = Math.exp((-Math.PI * bw) / SR);
  const a1 = 2 * r * Math.cos((2 * Math.PI * freq) / SR);
  const a2 = -r * r;
  const g = 1 - r;
  let y1 = 0, y2 = 0;
  return (x) => {
    const y = g * x + a1 * y1 + a2 * y2;
    y2 = y1; y1 = y;
    return y;
  };
}

/** Synthesises one vowel; hoarseness h runs from 0 (clear) to 1 (very rough and breathy). */
function vowel(h, seed) {
  const rnd = mulberry32(seed);
  const n = Math.round(SR * DURATION);
  const source = new Float64Array(n);
  const flow = new Float64Array(n);

  const jitter = 0.002 + 0.035 * h;      // cycle-to-cycle period variation
  const shimmer = 0.02 + 0.3 * h;        // cycle-to-cycle amplitude variation
  const subharmonic = 0.35 * h * h;      // alternating cycle amplitudes (diplophonia)
  const breath = 0.03 + 0.9 * h;         // aspiration noise level

  // Glottal flow pulses (Rosenberg shape), cycle by cycle.
  let t = 0, cycle = 0;
  while (t < n) {
    const f0 = 118 * (1 + 0.015 * Math.sin((2 * Math.PI * t) / SR * 0.7));
    const period = (SR / f0) * (1 + jitter * gaussian(rnd));
    const amp = Math.max(0.05, (1 + shimmer * gaussian(rnd)) * (cycle % 2 ? 1 - subharmonic : 1));
    const open = 0.6 * period, closing = 0.25 * period;
    for (let k = 0; k < period && t + k < n; k++) {
      let g = 0;
      if (k < open) g = 0.5 * (1 - Math.cos((Math.PI * k) / open));
      else if (k < open + closing) g = Math.cos((Math.PI * (k - open)) / (2 * closing));
      flow[Math.floor(t + k)] = amp * g;
    }
    t += period;
    cycle++;
  }
  // Excitation = flow derivative plus flow-modulated breath noise.
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const d = flow[i] - prev;
    prev = flow[i];
    source[i] = d * 8 + breath * (0.3 + flow[i]) * gaussian(rnd) * 0.25;
  }
  // Vocal tract for /a/: cascade of four formants.
  const formants = [[730, 90], [1090, 110], [2440, 170], [3400, 250]].map(([f, b]) => resonator(f, b));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let y = source[i];
    for (const f of formants) y = f(y);
    out[i] = y;
  }
  // Equal loudness (RMS) so level gives nothing away; 40 ms fades.
  const rms = Math.sqrt(out.reduce((s, v) => s + v * v, 0) / n);
  const gain = 0.1 / rms;
  const fade = Math.round(0.04 * SR);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    pcm[i] = Math.max(-32767, Math.min(32767, Math.round(out[i] * gain * env * 32767)));
  }
  return pcm;
}

function wav(pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}

// ---- minimal ZIP writer (stored, no compression) ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 1;
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---- the example set ----
// Eight samples spread across the hoarseness range, given neutral letter names; five
// references, named best first as the manual asks for references.
const sampleLevels = [0.04, 0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.9];
const letters = ['E', 'B', 'G', 'A', 'H', 'D', 'F', 'C']; // letters[i] gets sampleLevels[i]
const refLevels = [0, 0.25, 0.5, 0.75, 1];

mkdirSync(new URL('TestItems/', OUT), { recursive: true });
mkdirSync(new URL('RefItems/', OUT), { recursive: true });

const files = [];
sampleLevels.forEach((h, i) => files.push([`TestItems/sample-${letters[i]}.wav`, wav(vowel(h, 1000 + i))]));
refLevels.forEach((h, i) => files.push([`RefItems/ref-${i + 1}.wav`, wav(vowel(h, 2000 + i))]));

// No answer key: ranking voices is a subjective judgement, so NeAR never marks an order right or wrong.
for (const [name, data] of files) writeFileSync(new URL(name, OUT), data);
writeFileSync(
  new URL('examples.json', OUT),
  JSON.stringify({
    samples: files.filter(([n]) => n.startsWith('TestItems/')).map(([n]) => n).sort(),
    references: files.filter(([n]) => n.startsWith('RefItems/')).map(([n]) => n).sort(),
  }, null, 2) + '\n',
);
writeFileSync(new URL('NeAR-examples.zip', OUT), zip(files.map(([n, d]) => [`NeAR-examples/${n}`, d])));
console.log('Example voices and NeAR-examples.zip written to public/examples/.');
