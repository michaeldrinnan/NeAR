import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { commitStudy, deleteStudy, listStudies, readStudyLines, StudyConflictError, studyId, writeStudy } from '../src/lib/studies';
import { resultsFor } from '../src/lib/results';
import type { OpenStudy } from '../src/lib/sources';
import { defaultDefinition } from '../src/lib/studyFormat';

const H = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,a.wav';
const row = (who: string) => `${who},2026-10-02,10:00:00,S #01234567,,0,1`;
let n = 0;
const fresh = () => `study-${++n}`;
const create = { name: 'S', format: 'identity' };

describe('browser-kept results', () => {
  it('are only stored once a session is saved, so a study that is just looked at leaves nothing behind', async () => {
    const id = fresh();
    expect(await readStudyLines(id)).toBeNull();
    expect((await listStudies()).find((s) => s.id === id)).toBeUndefined();
    await commitStudy(id, [H, row('First')], null, create);
    expect(await readStudyLines(id)).toEqual([H, row('First')]);
  });

  it('save a session when the results are unchanged since it started, and return what was saved', async () => {
    const id = fresh();
    await commitStudy(id, [H, row('First')], null, create);
    const saved = await commitStudy(id, [H, row('First'), row('Second')], [H, row('First')], create);
    expect(saved).toEqual([H, row('First'), row('Second')]);
    expect(await readStudyLines(id)).toEqual(saved);
  });

  it('refuse, rather than merging or overwriting, when another tab saved a session meanwhile (even the first)', async () => {
    const id = fresh();
    // Both tabs read nothing when their sessions started; the first to finish wins, the second is refused.
    const results = await Promise.allSettled([
      commitStudy(id, [H, row('TabA')], null, create),
      commitStudy(id, [H, row('TabB')], null, create),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(StudyConflictError);
    expect(await readStudyLines(id)).toHaveLength(2); // exactly the winner's session, nothing merged
  });

  it('never overwrite an import made while a session was running (even with different columns)', async () => {
    const id = fresh();
    await commitStudy(id, [H, row('Before')], null, create);
    const imported = ['RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,other.wav', 'Imported,2020-01-01,09:00:00,S,,0,1'];
    await writeStudy(id, imported); // another tab imports during this session
    await expect(commitStudy(id, [H, row('Before'), row('Session')], [H, row('Before')], create)).rejects.toBeInstanceOf(StudyConflictError);
    expect(await readStudyLines(id)).toEqual(imported);
  });

  it('allow a deliberate reset to a fresh file when nothing changed meanwhile', async () => {
    const id = fresh();
    const old = ['RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,old.wav', 'Old,2020-01-01,09:00:00,S,,0,1'];
    await commitStudy(id, old, null, create);
    await commitStudy(id, [H, row('New')], old, create);
    expect(await readStudyLines(id)).toEqual([H, row('New')]);
  });

  it('report a save to results deleted in another tab instead of losing it silently or starting again', async () => {
    const id = fresh();
    await commitStudy(id, [H, row('First')], null, create);
    await deleteStudy(id);
    await expect(commitStudy(id, [H, row('First'), row('Late')], [H, row('First')], create)).rejects.toBeInstanceOf(StudyConflictError);
    expect(await readStudyLines(id)).toBeNull();
  });

  it('are kept per study identity: the same study carries on, a changed one starts afresh', async () => {
    const study = (identity: string): OpenStudy => ({
      definition: defaultDefinition('Voices'),
      warnings: [],
      samples: [new File(['A'], 'a.wav')],
      references: [],
      identity,
      hasDefinition: true,
      results: [],
      origin: { kind: 'zip', name: 'Voices.zip', bytes: new Uint8Array() },
      folderName: 'Voices.zip',
    });
    const first = resultsFor(study('aaaaaaaa1111'));
    expect(first.inBrowser).toBe(true);
    expect(first.fileName).toBe('NeAR_Voices_aaaaaaaa.csv');
    expect(await first.read()).toBeNull();
    await first.commit([H, row('One')]);
    const again = resultsFor(study('aaaaaaaa1111'));
    expect(await again.read()).toEqual([H, row('One')]);
    expect(await resultsFor(study('bbbbbbbb2222')).read()).toBeNull();
    const kept = (await listStudies()).find((s) => s.id === studyId('aaaaaaaa1111'));
    expect(kept).toMatchObject({ name: 'Voices', format: 'aaaaaaaa1111' });
  });
});
