import { buildHeader, sameLines } from './csv';
import { kvDelete, kvGet, kvKeys, kvSet, kvUpdate } from './kv';
import type { Source } from './sources';

export interface Study {
  id: string;
  name: string;
  fingerprint: string;
  created: string;
  lines: string[] | null;
  /** Internal marker for studies NeAR creates itself; never set from anything the user types. */
  builtin?: 'examples';
}

const key = (id: string) => `study:${id}`;
const fingerprints = new WeakMap<Source, Promise<string>>();
const digest = async (bytes: BufferSource) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Names and actual bytes, independent of folder label, selection order or timestamps. */
export function fingerprintSource(source: Source): Promise<string> {
  let pending = fingerprints.get(source);
  if (!pending) {
    pending = (async () => {
      const files: [string, string][] = [];
      // Read one recording at a time rather than holding the whole study in memory.
      for (const item of [...source.items].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        files.push([item.name, await digest(await (await item.getFile()).arrayBuffer())]);
      }
      return digest(new TextEncoder().encode(JSON.stringify(files)));
    })().catch((e) => { fingerprints.delete(source); throw e; });
    fingerprints.set(source, pending);
  }
  return pending;
}

export async function listStudies(): Promise<Study[]> {
  const keys = (await kvKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith('study:'));
  const studies = await Promise.all(keys.map((k) => kvGet<Study>(k)));
  return studies.filter((s): s is Study => !!s).sort((a, b) => a.created.localeCompare(b.created));
}

export async function readStudy(id: string): Promise<Study> {
  const study = await kvGet<Study>(key(id));
  if (!study) throw new Error('This study could not be found. Choose a study again.');
  return study;
}

/** Metadata and recovered results commit together. A failed write cannot expose a partial migration. */
export async function createStudy(
  source: Source,
  name: string,
  lines: string[] | null = null,
  builtin?: Study['builtin'],
): Promise<Study> {
  if (!name.trim()) throw new Error('Enter a study name.');
  const study: Study = {
    id: crypto.randomUUID(), name: name.trim(), fingerprint: await fingerprintSource(source),
    created: new Date().toISOString(), lines, ...(builtin ? { builtin } : {}),
  };
  await kvSet(key(study.id), study);
  return study;
}

/** Permanently removes a study and its results from this browser. */
export function deleteStudy(id: string): Promise<void> {
  return kvDelete(key(id));
}

/**
 * Removes a study that never received any results (created, then the session was
 * abandoned). The emptiness check and the delete share one transaction, so a save
 * from another tab can't land in between and be deleted.
 */
export async function discardIfEmpty(id: string): Promise<boolean> {
  const change = await kvUpdate<Study>(key(id), (study) =>
    study && !(study.lines && study.lines.length > 0) ? { delete: true } : null,
  );
  return change !== null;
}

const missing = () => new Error('This study could not be found (was it deleted in another tab?). Choose a study again.');

/** Replaces a study's results (imports, or carrying on from a folder's NeAR.csv). */
export async function writeStudy(id: string, lines: readonly string[]): Promise<void> {
  await kvUpdate<Study>(key(id), (study) => {
    if (!study) throw missing();
    return { put: { ...study, lines: [...lines] } };
  });
}

/**
 * Saves a finished session. `lines` is the results file as read when the session
 * started plus the new row at the end. Inside one transaction: if nothing changed
 * meanwhile, store it as is; if another tab has added sessions to the same file
 * since, append just the new row to what is there now, so neither session is lost.
 * (If the header differs, this session deliberately started a fresh file.)
 */
export async function appendToStudy(id: string, lines: readonly string[]): Promise<void> {
  const base = lines.slice(0, -1);
  const row = lines[lines.length - 1];
  await kvUpdate<Study>(key(id), (study) => {
    if (!study) throw missing();
    const now = study.lines;
    const merged = !now || !now.length || sameLines(now, base) || now[0] !== lines[0] ? [...lines] : [...now, row];
    return { put: { ...study, lines: merged } };
  });
}

/** The built-in study for the bundled example files, created on first use. */
export async function exampleStudy(source: Source): Promise<Study> {
  const fingerprint = await fingerprintSource(source);
  // Found by NeAR's own marker, never by name, so a user study that happens to be called
  // "Example files" and hold the same recordings is never used for demo sessions.
  const existing = (await listStudies()).find((s) => s.builtin === 'examples' && s.fingerprint === fingerprint);
  return existing ?? createStudy(source, EXAMPLE_STUDY, null, 'examples');
}

export const EXAMPLE_STUDY = 'Example files';

export async function legacyResults(): Promise<{ key: string; lines: string[] }[]> {
  const keys = (await kvKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith('results:'));
  const entries = await Promise.all(keys.map(async (k) => ({ key: k, lines: await kvGet<string[]>(k) })));
  return entries.filter((e): e is { key: string; lines: string[] } => Array.isArray(e.lines));
}

export async function recoverStudy(source: Source, name: string, legacyKey: string): Promise<Study> {
  if (!legacyKey.startsWith('results:')) throw new Error('Not an older results file.');
  const lines = await kvGet<string[]>(legacyKey);
  if (!lines || lines[0] !== buildHeader(source.items.map((i) => i.name))) {
    throw new Error('The sample columns do not match. Choose the original samples or download the results.');
  }
  // Keep the original indefinitely as a recovery copy; never silently assign it to an existing study.
  return createStudy(source, name, [...lines]);
}
