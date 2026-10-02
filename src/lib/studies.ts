import { sameLines } from './csv';
import { kvDelete, kvGet, kvKeys, kvUpdate } from './kv';

/** Results kept in this browser for one study (where the study's folder can't be written to). */
export interface Study {
  id: string;
  /** The study's title. */
  name: string;
  created: string;
  lines: string[] | null;
  /** The study's identity (docs/study-format.md §5). Absent for studies made by earlier versions of NeAR. */
  format?: string;
  /** How many lines the results had when they were last downloaded. */
  downloaded?: number;
  /** Earlier versions: a checksum of the recordings. */
  fingerprint?: string;
}

const key = (id: string) => `study:${id}`;

/** Where this browser keeps the results for a study, found by its identity only, never by name. */
export const studyId = (identity: string) => `pkg-${identity}`;

export async function listStudies(): Promise<Study[]> {
  const keys = (await kvKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith('study:'));
  const studies = await Promise.all(keys.map((k) => kvGet<Study>(k)));
  return studies.filter((s): s is Study => !!s).sort((a, b) => a.created.localeCompare(b.created));
}

/** The results kept for a study, or null if none have been saved yet. */
export async function readStudyLines(id: string): Promise<string[] | null> {
  return (await kvGet<Study>(key(id)))?.lines ?? null;
}

/** Permanently removes a study's results from this browser. */
export function deleteStudy(id: string): Promise<void> {
  return kvDelete(key(id));
}

const missing = () => new Error('The results for this study could not be found (were they deleted in another tab?).');

/** Replaces a study's results (imports). */
export async function writeStudy(id: string, lines: readonly string[]): Promise<void> {
  await kvUpdate<Study>(key(id), (study) => {
    if (!study) throw missing();
    return { put: { ...study, lines: [...lines], downloaded: undefined } };
  });
}

/** Raised when a study's results changed after a session read them; nothing is overwritten. */
export class StudyConflictError extends Error {
  constructor() {
    super(
      'The results for this study were changed elsewhere (in another NeAR window or tab) while this session was ' +
        'running, so they have not been overwritten. Save this session’s results elsewhere and combine them by hand.',
    );
    this.name = 'StudyConflictError';
  }
}

const same = (a: readonly string[] | null, b: readonly string[] | null) => sameLines(a ?? [], b ?? []);

/**
 * Saves a finished session: `lines` replaces the study's results only if they are
 * still exactly `expected` (what the session read when it started); otherwise it
 * raises StudyConflictError and changes nothing. A study's first save creates its
 * record (with `create`), so studies that are only looked at leave nothing behind.
 * One NeAR session runs at a time (see the session lock), so this is a safety net
 * that never merges or overwrites. Resolves with the lines committed.
 */
export async function commitStudy(
  id: string,
  lines: readonly string[],
  expected: readonly string[] | null,
  create?: { name: string; format: string },
): Promise<string[]> {
  const committed = [...lines];
  await kvUpdate<Study>(key(id), (study) => {
    if (!study) {
      if (!create) throw missing();
      if (expected?.length) throw new StudyConflictError(); // deleted meanwhile
      return { put: { id, name: create.name, created: new Date().toISOString(), lines: committed, format: create.format } };
    }
    if (!same(study.lines, expected)) throw new StudyConflictError();
    return { put: { ...study, lines: committed } };
  });
  return committed;
}

/** Results saved by the two earliest browser-storage formats, kept as a backup. */
export async function legacyResults(): Promise<{ key: string; lines: string[] }[]> {
  const keys = (await kvKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith('results:'));
  const entries = await Promise.all(keys.map(async (k) => ({ key: k, lines: await kvGet<string[]>(k) })));
  return entries.filter((e): e is { key: string; lines: string[] } => Array.isArray(e.lines));
}

/** Remembers that a study's results were downloaded as they are now (`lines` lines). */
export async function markDownloaded(id: string, lines: number): Promise<void> {
  await kvUpdate<Study>(key(id), (study) => (study ? { put: { ...study, downloaded: Math.max(study.downloaded ?? 0, lines) } } : null));
}

/** Sessions saved since the results were last downloaded (all of them if never). */
export function notDownloaded(study: Pick<Study, 'lines' | 'downloaded'>): number {
  const lines = study.lines?.length ?? 0;
  const done = Math.min(study.downloaded ?? 0, lines);
  return Math.max(0, lines - Math.max(done, 1)); // the header line is not a session
}

export async function readStudyRecord(id: string): Promise<Study | undefined> {
  return kvGet<Study>(key(id));
}
