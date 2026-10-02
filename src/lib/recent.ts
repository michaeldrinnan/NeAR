/** Studies opened recently in this browser, so they can be opened again with one click. */
import { kvDelete, kvGet, kvKeys, kvSet } from './kv';
import { studyFromFolder, studyFromUrl, studyFromZip, folderAccess, type OpenStudy } from './sources';

export type RecentSource =
  | { kind: 'zip'; name: string; bytes: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'folder'; dir: FileSystemDirectoryHandle };

export interface RecentStudy {
  identity: string;
  title: string;
  samples: number;
  references: number;
  /** ISO time it was last opened for rating. */
  lastUsed: string;
  source: RecentSource;
}

const PREFIX = 'recent:';
const KEEP = 10;

/** Remembers a study as just used. Studies whose files can't be reached again (other browsers' folders) aren't kept. */
export async function rememberStudy(study: OpenStudy): Promise<void> {
  const o = study.origin;
  if (o.kind === 'files') return;
  const source: RecentSource = o.kind === 'folder' ? o : o.kind === 'url' ? o : { kind: 'zip', name: o.name, bytes: o.bytes };
  const all = await listRecent();
  // One entry per folder or link: a folder whose study has changed replaces its old entry.
  for (const r of all) {
    if (r.identity === study.identity) continue;
    const sameFolder = o.kind === 'folder' && r.source.kind === 'folder' && (await r.source.dir.isSameEntry(o.dir).catch(() => false));
    const sameUrl = o.kind === 'url' && r.source.kind === 'url' && r.source.url === o.url;
    if (sameFolder || sameUrl) await kvDelete(PREFIX + r.identity);
  }
  await kvSet(PREFIX + study.identity, {
    identity: study.identity,
    title: study.definition.title,
    samples: study.samples.length,
    references: study.references.length,
    lastUsed: new Date().toISOString(),
    source,
  } satisfies RecentStudy);
  for (const old of (await listRecent()).slice(KEEP)) await kvDelete(PREFIX + old.identity);
}

/** Most recently used first. */
export async function listRecent(): Promise<RecentStudy[]> {
  const keys = (await kvKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX));
  const all = await Promise.all(keys.map((k) => kvGet<RecentStudy>(k).catch(() => undefined)));
  return all.filter((r): r is RecentStudy => !!r).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
}

export function forgetRecent(identity: string): Promise<void> {
  return kvDelete(PREFIX + identity);
}

/** Opens a recent study again (a folder may ask for permission, so call this from a click). */
export async function reopenRecent(r: RecentStudy): Promise<OpenStudy> {
  const s = r.source;
  if (s.kind === 'zip') return studyFromZip(s.bytes, s.name);
  if (s.kind === 'url') return studyFromUrl(s.url);
  if (!(await folderAccess(s.dir))) throw new Error(`NeAR needs permission to use the folder “${s.dir.name}”.`);
  return studyFromFolder(s.dir);
}
