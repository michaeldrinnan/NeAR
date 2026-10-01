/**
 * Orders file names the way Windows (NTFS) lists a folder: by upper-cased
 * character code. The 2012 app relied on that order for the NeAR.csv header,
 * so matching it keeps existing results files valid.
 */
export function compareNtfs(a: string, b: string): number {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  if (ua !== ub) return ua < ub ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Unbiased Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function isWav(name: string): boolean {
  return name.toLowerCase().endsWith('.wav');
}

/** File name without its extension, as shown on a tile. */
export function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
