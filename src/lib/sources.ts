import { readStudy, readStudyZip, type StudyEntry, type StudyPackage } from './studyFormat';

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
export const canUseFolders = typeof window.showDirectoryPicker === 'function';

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
  return { ...(await readStudy(await folderEntries(dir), dir.name)), origin: { kind: 'folder', dir }, folderName: dir.name };
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

/** Asks for a study folder NeAR may write to; null if the user cancels. */
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
