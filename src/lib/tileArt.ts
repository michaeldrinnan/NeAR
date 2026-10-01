/**
 * Tile backgrounds, ported from Subject.DrawBackgrounds() in the 2012 app.
 * Each tile gets a random two-Gaussian colour field so raters can tell the
 * samples apart; brightness shows the state (muted = unrated, mid = being
 * dragged, full = rated). References are plain cornflower blue.
 */

export type Rgb = [number, number, number];

export interface TileImages {
  unrated: string;
  moving: string;
  rated: string;
}

/**
 * Faithful to the original, including its quirk: phase 0 falls through to the
 * final branch (the original's first `if` was overwritten by the else-chain).
 */
export function colourWheel(p: number, saturation: number): Rgb {
  const phase = Math.floor(p * 8);
  const up = p * 8 - phase;
  const down = 1 - up;
  let r = 0, g = 0, b = 0;
  switch (phase) {
    case 1: b = 1; g = up; break;
    case 2: b = down; g = 1; break;
    case 3: r = up; g = 1; break;
    case 4: r = 1; g = down; break;
    case 5: r = 1; b = up; break;
    case 6: r = down; b = 1; break;
    default: b = down; break;
  }
  const scale = 255 * saturation;
  return [Math.trunc(r * scale), Math.trunc(g * scale), Math.trunc(b * scale)];
}

interface Gaussian { uq: number; up: number; sq: number; sp: number; r: number }

function randomGaussian(random: () => number): Gaussian {
  return {
    uq: random(),
    up: random(),
    sq: random() + 0.33,
    sp: random() + 0.33,
    r: random() * 2 - 1,
  };
}

function density(q: number, p: number, g: Gaussian): number {
  const t1 = ((q - g.uq) ** 2) / (g.sq * g.sq);
  const t2 = ((p - g.up) ** 2) / (g.sp * g.sp);
  const t3 = (2 * g.r * (q - g.uq) * (p - g.up)) / (g.sq * g.sp);
  return Math.exp(-(t1 + t2 - t3) / (2 * (1 - g.r * g.r)));
}

/** Posterior of the second Gaussian at (q, p); 0.5 where both underflow. */
export function mixture(q: number, p: number, g0: Gaussian, g1: Gaussian): number {
  const pos = density(q, p, g1);
  const neg = density(q, p, g0);
  const v = pos / (neg + pos);
  return Number.isFinite(v) ? v : 0.5;
}

export function makeTileImages(size = 96, random: () => number = Math.random): TileImages {
  const g0 = randomGaussian(random);
  const g1 = randomGaussian(random);
  const sats = [0.45, 0.72, 1.0]; // unrated, moving, rated (unrated was 0.25 in 2012: too dark on screen)
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const images = sats.map(() => ctx.createImageData(size, size));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = mixture(x / size, y / size, g0, g1);
      const i = (y * size + x) * 4;
      sats.forEach((s, k) => {
        const [r, g, b] = colourWheel(p, s);
        const d = images[k].data;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      });
    }
  }

  const [unrated, moving, rated] = images.map((img) => {
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  });
  return { unrated, moving, rated };
}
