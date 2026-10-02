import { CSV_FILE, parseLines, serializeLines } from './csv';
import { commitStudy, readStudy, writeStudy } from './studies';
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
  /**
   * Browser-kept results only: saves a finished session, but only if the stored results are still
   * what the last read() saw. Resolves with the lines committed.
   */
  commit?(lines: readonly string[]): Promise<string[]>;
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

function browserResults(source: Source): ResultsStore {
  const id = source.studyId;
  if (!id) throw new Error('Choose a browser study first.');
  const seed = source.csv;
  const readStored = async () => (await readStudy(id)).lines;
  // What the stored results were when this session read them, for commit() to check against.
  let seen: string[] | null | undefined;
  return {
    where: `this browser (results for “${source.label}”)`,
    inBrowser: true,
    readStored,
    async read() {
      const stored = await readStored();
      seen = stored ? [...stored] : null; // a copy: the caller appends its new row to the array it gets back
      if (stored) return stored;
      return seed ? parseLines(await seed.text()) : null;
    },
    async write(lines) {
      await writeStudy(id, lines);
    },
    async commit(lines) {
      if (seen === undefined) throw new Error('The results were not read before saving.');
      const committed = await commitStudy(id, lines, seen);
      seen = committed;
      return committed;
    },
  };
}

/** Replaces the browser-kept results for a study, e.g. from an imported NeAR.csv. */
export async function importBrowserResults(source: Source, file: File): Promise<void> {
  await resultsFor(source).write(parseLines(await file.text()));
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
