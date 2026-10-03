import { readStudy, readStudyZip, STUDY_FILE, writeStudyText, type StudyEntry, type StudyPackage } from './studyFormat';

export interface AudioItem {
  /** Unique within a session ("s:" samples, "r:" references). */
  id: string;
  name: string;
  /** Size in bytes, when known without opening the file. */
  size?: number;
  getFile(): Promise<File>;
}

export const audioItems = (files: readonly File[], prefix: 's:' | 'r:'): AudioItem[] =>
  files.map((file) => ({ id: prefix + file.name, name: file.name, size: file.size, getFile: async () => file }));

/** Chrome/Edge can open folders and write results back into them. */
export const canUseFolders = typeof window.showDirectoryPicker === 'function' && !inCrossOriginFrame();

/**
 * True when NeAR is shown inside another site's frame, e.g. VS Code's Simple Browser: Chrome
 * refuses the folder picker there (SecurityError), though the ordinary folder input still works.
 */
export function inCrossOriginFrame(): boolean {
  try {
    return window.top !== window.self && !window.top!.location.href;
  } catch {
    return true; // reading another origin's location throws
  }
}

/** Why Create a study is unavailable in browsers (or windows) that can't give NeAR access to a folder. */
export const CREATE_NEEDS_FOLDERS =
  'Creating a study needs Chrome or Edge on a computer. You can still rate studies here.';

/** When a folder chooser comes back with no files (some embedded views never pass them on). */
export const NO_FILES_NOTE =
  'No files arrived from that folder. This window may not be able to read folders: open NeAR in Chrome or Edge, or use Open study file… with a zip.';

/** When the folder picker fails outright (rather than being cancelled). */
export const CANT_OPEN_FOLDERS = 'This window can’t open folders. Open NeAR in Chrome or Edge, or use Open study file… with a zip.';

/** Where an open study came from: decides where its results go, and how Recent studies reopen it. */
export type StudyOrigin =
  | { kind: 'zip'; name: string; bytes: Uint8Array }
  | { kind: 'url'; url: string }
  /** Chrome/Edge: a study folder NeAR may write to; results are kept in it. */
  | { kind: 'folder'; dir: FileSystemDirectoryHandle }
  /** Other browsers: a folder's files, read once; results are kept in this browser. */
  | { kind: 'files'; name: string };

export interface OpenStudy extends StudyPackage {
  origin: StudyOrigin;
  /** The folder or file it was opened from, for messages. */
  folderName: string;
  /** A folder opened as it is, with no study.txt: its defaults are written there once results are saved. */
  writeDefinition?: boolean;
}

export async function studyFromZip(bytes: Uint8Array, name: string): Promise<OpenStudy> {
  return { ...(await readStudyZip(bytes, name)), origin: { kind: 'zip', name, bytes }, folderName: name };
}

/** Opens a study from a web address (a ?study= link, or an example on this site). */
export async function studyFromUrl(url: string): Promise<OpenStudy> {
  const res = await fetch(new URL(url, document.baseURI));
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const name = decodeURIComponent(new URL(url, document.baseURI).pathname.split('/').pop() || 'Study');
  const pkg = await readStudyZip(new Uint8Array(await res.arrayBuffer()), name);
  return { ...pkg, origin: { kind: 'url', url }, folderName: name };
}

/** Lists a folder's files, and those one level down, as study entries. */
export async function folderEntries(dir: FileSystemDirectoryHandle): Promise<StudyEntry[]> {
  const entries: StudyEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      entries.push({ path: name, file: () => (handle as FileSystemFileHandle).getFile() });
      continue;
    }
    for await (const [inner, h] of (handle as FileSystemDirectoryHandle).entries()) {
      // Deeper folders are only counted as ignored, so a placeholder name is enough.
      entries.push(h.kind === 'file' ? { path: `${name}/${inner}`, file: () => (h as FileSystemFileHandle).getFile() } : { path: `${name}/${inner}/(folder)`, file: never });
    }
  }
  return entries;
}

const never = (): Promise<File> => Promise.reject(new Error('Not a file'));

export async function studyFromFolder(dir: FileSystemDirectoryHandle): Promise<OpenStudy> {
  const pkg = await readStudy(await folderEntries(dir), dir.name);
  return { ...pkg, origin: { kind: 'folder', dir }, folderName: dir.name, writeDefinition: !pkg.hasDefinition };
}

/** The entries of an <input webkitdirectory> selection, relative to the chosen folder. */
export function filesEntries(files: Iterable<File>): { name: string; entries: StudyEntry[] } {
  let name = '';
  const entries: StudyEntry[] = [];
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/');
    if (parts.length > 1) name ||= parts[0];
    entries.push({ path: parts.slice(parts.length > 1 ? 1 : 0).join('/'), file: async () => file });
  }
  return { name: name || 'Selected folder', entries };
}

export async function studyFromFiles(files: Iterable<File>): Promise<OpenStudy> {
  const { name, entries } = filesEntries(files);
  return { ...(await readStudy(entries, name)), origin: { kind: 'files', name }, folderName: name };
}

/** Shown when the folder picker comes back with no folder, so choosing one is never met with silence. */
export const NO_FOLDER_NOTE =
  'No folder was opened. If you chose one and nothing happened, the browser may have asked whether NeAR can view and ' +
  'edit its files: NeAR needs that to save results into the folder, so choose Allow (or Edit files) when asked.';

/** Asks for a study folder NeAR may write to; null if the user cancels (or the browser refuses). */
/**
 * Writes study.txt into a folder study that has none, with the settings it was rated with, so
 * the folder keeps its title and options even if it is renamed. The study code is unchanged.
 * Called once results have been saved there (NeAR already has write access); failures are ignored.
 */
export async function writeMissingDefinition(study: OpenStudy): Promise<void> {
  if (!study.writeDefinition || study.origin.kind !== 'folder') return;
  study.writeDefinition = false;
  try {
    const dir = study.origin.dir;
    try {
      await dir.getFileHandle(STUDY_FILE);
      return; // one has appeared meanwhile: leave it alone
    } catch {
      /* none: write it */
    }
    const out = await (await dir.getFileHandle(STUDY_FILE, { create: true })).createWritable();
    await out.write(writeStudyText(study.definition));
    await out.close();
    study.hasDefinition = true;
  } catch {
    /* a read-only folder: carry on without it */
  }
}

export async function pickStudyFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker!({ id: 'near-study', mode: 'readwrite' });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** Makes sure NeAR may still write to a remembered folder, asking if needed (needs a click). */
export async function folderAccess(dir: FileSystemDirectoryHandle): Promise<boolean> {
  let state = await dir.queryPermission({ mode: 'readwrite' });
  if (state !== 'granted') state = await dir.requestPermission({ mode: 'readwrite' });
  return state === 'granted';
}
