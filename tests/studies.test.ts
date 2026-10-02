import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { commitStudy, createStudy, discardIfEmpty, exampleStudy, listStudies, readStudy, StudyConflictError, writeStudy } from '../src/lib/studies';
import type { Source } from '../src/lib/sources';

/** A study source whose recordings are the given strings. */
const source = (label: string, files: Record<string, string>): Source => ({
  label,
  items: Object.entries(files).map(([name, body]) => {
    const file = new File([body], name);
    return { id: 's:' + name, name, size: file.size, getFile: async () => file };
  }),
});

const H = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,a.wav';

describe('browser studies in IndexedDB', () => {
  const row = (who: string) => `${who},2026-10-02,10:00:00,S,,0,1`;

  it('never deletes a session saved by another tab while an empty study is being cleaned up', async () => {
    for (let i = 0; i < 20; i++) {
      const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Racing ' + i);
      // One tab abandons the fresh study while another saves the first session to it.
      const save = () => commitStudy(study.id, [H, row('Rater')], null);
      const [saved, discarded] = await Promise.allSettled([i % 2 ? save() : Promise.resolve().then(save), discardIfEmpty(study.id)]);
      const left = (await listStudies()).find((s) => s.id === study.id);
      if (saved.status === 'fulfilled') {
        // The save committed, so the study and its session must still be there.
        expect(left?.lines).toEqual([H, row('Rater')]);
        expect(discarded).toEqual({ status: 'fulfilled', value: false });
      } else {
        // The clean-up won: the save was refused (and reported), nothing half-written.
        expect(discarded).toEqual({ status: 'fulfilled', value: true });
        expect(left).toBeUndefined();
      }
    }
  });

  it('only discards studies that are still empty', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Has results');
    await commitStudy(study.id, [H, row('Anne')], null);
    expect(await discardIfEmpty(study.id)).toBe(false);
    expect((await readStudy(study.id)).lines).toHaveLength(2);
  });

  it('saves a session when the results are unchanged since it started, and returns what was saved', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Plain save');
    await writeStudy(study.id, [H, row('First')]);
    const saved = await commitStudy(study.id, [H, row('First'), row('Second')], [H, row('First')]);
    expect(saved).toEqual([H, row('First'), row('Second')]);
    expect((await readStudy(study.id)).lines).toEqual(saved);
  });

  it('refuses, rather than merging or overwriting, when another tab saved a session meanwhile', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Two tabs');
    await writeStudy(study.id, [H]);
    // Both tabs read [H] when their sessions started; the first to finish wins, the second is refused.
    const results = await Promise.allSettled([
      commitStudy(study.id, [H, row('TabA')], [H]),
      commitStudy(study.id, [H, row('TabB')], [H]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(StudyConflictError);
    const lines = (await readStudy(study.id)).lines!;
    expect(lines).toHaveLength(2); // exactly the winner's session, nothing merged
  });

  it('never overwrites an import made while a session was running (even with different columns)', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Import race');
    await writeStudy(study.id, [H, row('Before')]);
    const imported = ['RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,other.wav', 'Imported,2020-01-01,09:00:00,S,,0,1'];
    await writeStudy(study.id, imported); // another tab imports during this session
    await expect(commitStudy(study.id, [H, row('Before'), row('Session')], [H, row('Before')])).rejects.toBeInstanceOf(StudyConflictError);
    expect((await readStudy(study.id)).lines).toEqual(imported);
  });

  it('allows a deliberate reset to a fresh file when nothing changed meanwhile', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Reset');
    const old = ['RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,old.wav', 'Old,2020-01-01,09:00:00,S,,0,1'];
    await writeStudy(study.id, old);
    await commitStudy(study.id, [H, row('New')], old);
    expect((await readStudy(study.id)).lines).toEqual([H, row('New')]);
  });

  it('reports a save to a study deleted in another tab instead of losing it silently', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Gone');
    expect(await discardIfEmpty(study.id)).toBe(true);
    await expect(commitStudy(study.id, [H, row('Late')], null)).rejects.toThrow(/could not be found/);
  });

  it('uses only its own built-in study for the examples, never a user study with the same name and recordings', async () => {
    const examples = source('Example files', { 'sample-A.wav': 'xyz', 'sample-B.wav': 'pqr' });
    const users = await createStudy(examples, 'Example files'); // a user-made study that looks just like it
    const builtin = await exampleStudy(examples);
    expect(builtin.id).not.toBe(users.id);
    expect(builtin.builtin).toBe('examples');
    expect(builtin.name).toBe('Example files');
    // Later demos reuse the same built-in study.
    expect((await exampleStudy(source('Example files', { 'sample-A.wav': 'xyz', 'sample-B.wav': 'pqr' }))).id).toBe(builtin.id);
  });
});
