import { compareNtfs, isWav } from './order';
import { CSV_FILE } from './csv';
import { kvGetQuiet, kvSet } from './kv';

export interface AudioItem {
  /** Unique within a session ("s:" samples, "r:" references). */
  id: string;
  name: string;
  getFile(): Promise<File>;
}

/** A set of WAV files to rate, or to use as references. */
export interface Source {
  /** Folder name, written to the SOURCE / REFERENCE columns. */
  label: string;
  items: AudioItem[];
  /** Present when the folder was opened with the File System Access API. */
  dir?: FileSystemDirectoryHandle;
  /** NeAR.csv picked up alongside the WAVs when no folder handle is available. */
  csv?: File;
}

export type SourceKind = 'samples' | 'refs';

/** Chrome/Edge can open folders and write NeAR.csv back into them. */
export const canUseFolders = typeof window.showDirectoryPicker === 'function';

const prefix = (kind: SourceKind) => (kind === 'samples' ? 's:' : 'r:');
const modeFor = (kind: SourceKind): FsPermissionMode => (kind === 'samples' ? 'readwrite' : 'read');
const handleKey = (kind: SourceKind) => `dir:${kind}`;

function byName(a: AudioItem, b: AudioItem) {
  return compareNtfs(a.name, b.name);
}

/** Lists the WAV files directly inside a folder (not sub-folders), in Windows order. */
export async function readDirectory(dir: FileSystemDirectoryHandle, kind: SourceKind): Promise<Source> {
  const items: AudioItem[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && isWav(name)) {
      const fh = handle as FileSystemFileHandle;
      items.push({ id: prefix(kind) + name, name, getFile: () => fh.getFile() });
    }
  }
  items.sort(byName);
  return { label: dir.name, items, dir };
}

/** Asks the user for a folder; returns null if they cancel. */
export async function pickDirectory(kind: SourceKind): Promise<Source | null> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker!({ id: `near-${kind}`, mode: modeFor(kind) });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
  await kvSet(handleKey(kind), dir).catch(() => {});
  return readDirectory(dir, kind);
}

/** The folder used last time, if the browser kept it. */
export async function rememberedDirectory(kind: SourceKind): Promise<FileSystemDirectoryHandle | undefined> {
  if (!canUseFolders) return undefined;
  return kvGetQuiet<FileSystemDirectoryHandle>(handleKey(kind));
}

/** Re-opens a remembered folder, asking for permission if needed (needs a click). */
export async function reopenDirectory(dir: FileSystemDirectoryHandle, kind: SourceKind, prompt: boolean): Promise<Source | null> {
  const mode = modeFor(kind);
  let state = await dir.queryPermission({ mode });
  if (state !== 'granted' && prompt) state = await dir.requestPermission({ mode });
  return state === 'granted' ? readDirectory(dir, kind) : null;
}

/**
 * Builds a source from an <input type=file> selection. With a folder
 * selection only files directly inside the chosen folder count, as before.
 */
export function sourceFromFiles(files: Iterable<File>, kind: SourceKind): Source {
  const items: AudioItem[] = [];
  let label = '';
  let csv: File | undefined;
  for (const file of files) {
    const parts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];
    if (parts.length > 2) continue;
    if (parts.length === 2) label ||= parts[0];
    if (isWav(file.name)) {
      items.push({ id: prefix(kind) + file.name, name: file.name, getFile: async () => file });
    } else if (file.name.toLowerCase() === CSV_FILE.toLowerCase()) {
      csv = file;
    }
  }
  items.sort(byName);
  return { label: label || 'Selected files', items, csv };
}
