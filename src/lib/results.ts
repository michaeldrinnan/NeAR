import { CSV_FILE, parseLines, serializeLines } from './csv';
import { commitStudy, readStudyLines, studyId, writeStudy } from './studies';
import { studyFileName } from './studyFormat';
import type { OpenStudy } from './sources';

/**
 * Where a study's results file NeAR_<title>_<code>.csv lives: in the study folder
 * (Chrome/Edge), or otherwise in this browser.
 */
export interface ResultsStore {
  fileName: string;
  /** Human-readable location, e.g. 'NeAR_Voices_1a2b3c4d.csv in folder “Voices”'. */
  where: string;
  inBrowser: boolean;
  /** The file's lines, or null if there is no results file yet. */
  read(): Promise<string[] | null>;
  /**
   * Saves a finished session. Browser-kept results are saved only if they are still
   * what the last read() saw. Resolves with the lines saved.
   */
  commit(lines: readonly string[]): Promise<string[]>;
}

export const resultsFileName = (study: Pick<OpenStudy, 'definition' | 'identity'>) =>
  studyFileName(study.definition.title, study.identity, 'csv');

export function resultsFor(study: OpenStudy): ResultsStore {
  return study.origin.kind === 'folder' ? folderResults(study.origin.dir, resultsFileName(study)) : browserResults(study);
}

async function readFolderFile(dir: FileSystemDirectoryHandle, name: string): Promise<string[] | null> {
  let handle: FileSystemFileHandle;
  try {
    handle = await dir.getFileHandle(name);
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError' || (e as DOMException).name === 'TypeMismatchError') return null;
    throw e;
  }
  return parseLines(await (await handle.getFile()).text());
}

function folderResults(dir: FileSystemDirectoryHandle, fileName: string): ResultsStore {
  return {
    fileName,
    where: `${fileName} in folder “${dir.name}”`,
    inBrowser: false,
    read: () => readFolderFile(dir, fileName),
    async commit(lines) {
      const handle = await dir.getFileHandle(fileName, { create: true });
      const out = await handle.createWritable();
      await out.write(serializeLines(lines));
      await out.close();
      return [...lines];
    },
  };
}

function browserResults(study: OpenStudy): ResultsStore {
  const id = studyId(study.identity);
  // What the stored results were when this session read them, for commit() to check against.
  let seen: string[] | null | undefined;
  return {
    fileName: resultsFileName(study),
    where: 'this browser',
    inBrowser: true,
    async read() {
      const stored = await readStudyLines(id);
      seen = stored ? [...stored] : null; // a copy: the caller appends its new row to the array it gets back
      return stored;
    },
    async commit(lines) {
      if (seen === undefined) throw new Error('The results were not read before saving.');
      const committed = await commitStudy(id, lines, seen, { name: study.definition.title, format: study.identity });
      seen = committed;
      return committed;
    },
  };
}

/** A plain NeAR.csv from the 2012 version (or an earlier web version) beside the study, if there is one. */
export async function legacyResultsFile(study: OpenStudy): Promise<string[] | null> {
  if (study.origin.kind === 'folder') return readFolderFile(study.origin.dir, CSV_FILE);
  const file = study.results.find((f) => f.name.toLowerCase() === CSV_FILE.toLowerCase());
  return file ? parseLines(await file.text()) : null;
}

/** A copy of this study's results file found among a folder's files (browsers without folder access). */
export async function folderCopy(study: OpenStudy): Promise<string[] | null> {
  if (study.origin.kind !== 'files') return null;
  const name = resultsFileName(study).toLowerCase();
  const file = study.results.find((f) => f.name.toLowerCase() === name);
  return file ? parseLines(await file.text()) : null;
}

/** Replaces the browser-kept results for a study (Results page imports). */
export async function importResults(id: string, file: File): Promise<void> {
  await writeStudy(id, parseLines(await file.text()));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadLines(lines: readonly string[], fileName: string): void {
  downloadBlob(new Blob([serializeLines(lines)], { type: 'text/csv' }), fileName);
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
