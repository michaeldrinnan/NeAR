import { CSV_FILE, parseLines, serializeLines } from './csv';
import { kvGet, kvSet } from './kv';
import type { Source } from './sources';

/** Where NeAR.csv lives: in the samples folder, or (without folder access) in this browser. */
export interface ResultsStore {
  /** Human-readable location, e.g. 'NeAR.csv in folder "Voices"'. */
  where: string;
  inBrowser: boolean;
  /** The file's lines, or null if there is no results file yet. */
  read(): Promise<string[] | null>;
  write(lines: readonly string[]): Promise<void>;
  /** Browser-kept results only: what is stored for this study, ignoring any NeAR.csv found with the files. */
  readStored?(): Promise<string[] | null>;
}

export function resultsFor(source: Source): ResultsStore {
  return source.dir ? folderResults(source.dir) : browserResults(source);
}

function folderResults(dir: FileSystemDirectoryHandle): ResultsStore {
  return {
    where: `${CSV_FILE} in folder “${dir.name}”`,
    inBrowser: false,
    async read() {
      let handle: FileSystemFileHandle;
      try {
        handle = await dir.getFileHandle(CSV_FILE);
      } catch (e) {
        if ((e as DOMException).name === 'NotFoundError') return null;
        throw e;
      }
      return parseLines(await (await handle.getFile()).text());
    },
    async write(lines) {
      const handle = await dir.getFileHandle(CSV_FILE, { create: true });
      const out = await handle.createWritable();
      await out.write(serializeLines(lines));
      await out.close();
    },
  };
}

/**
 * Browser-kept results belong to a study: the folder name plus the exact set of
 * WAV files (names and sizes). A browser can't see full paths, so the name alone
 * would let two different folders called "Voices" — or every "Choose files…"
 * pick — share, mix or wipe each other's results.
 */
export function studyKey(source: Pick<Source, 'label' | 'items'>): string {
  const files = source.items.map((i) => `${i.name}:${i.size ?? '?'}`).join('|');
  return `results:${source.label}:${hash(files)}`;
}

/** cyrb53 – a small, fast, well-mixed 53-bit string hash (not cryptographic). */
function hash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function browserResults(source: Source): ResultsStore {
  const key = studyKey(source);
  const seed = source.csv;
  const readStored = async () => (await kvGet<string[]>(key)) ?? null;
  return {
    where: `this browser (results for “${source.label}”)`,
    inBrowser: true,
    readStored,
    async read() {
      const stored = await readStored();
      if (stored) return stored;
      return seed ? parseLines(await seed.text()) : null;
    },
    async write(lines) {
      await kvSet(key, [...lines]);
    },
  };
}

/** Replaces the browser-kept results for a study, e.g. from an imported NeAR.csv. */
export async function importBrowserResults(source: Source, file: File): Promise<void> {
  await kvSet(studyKey(source), parseLines(await file.text()));
}

export function downloadLines(lines: readonly string[], fileName: string): void {
  const url = URL.createObjectURL(new Blob([serializeLines(lines)], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves a copy of the results under a name the user chooses (or as a
 * download where the browser can't show a save dialog). Returns the saved
 * name, or null if the user cancelled or the save failed.
 */
export async function saveCopy(lines: readonly string[], suggestedName: string, startIn?: FileSystemHandle): Promise<string | null> {
  if (!window.showSaveFilePicker) {
    downloadLines(lines, suggestedName);
    return suggestedName;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      startIn,
      id: 'near-save',
      types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }],
    });
    const out = await handle.createWritable();
    await out.write(serializeLines(lines));
    await out.close();
    return handle.name;
  } catch {
    return null;
  }
}
