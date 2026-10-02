import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { appendToStudy, createStudy, discardIfEmpty, exampleStudy, listStudies, readStudy, writeStudy } from '../src/lib/studies';
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
  it('never deletes a session saved by another tab while an empty study is being cleaned up', async () => {
    for (let i = 0; i < 20; i++) {
      const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Racing ' + i);
      // One tab abandons the fresh study while another saves the first session to it.
      const [saved, discarded] = await Promise.allSettled([
        i % 2 ? appendToStudy(study.id, [H, 'Rater,2026-10-02,10:00:00,S,,0,1']) : Promise.resolve().then(() => appendToStudy(study.id, [H, 'Rater,2026-10-02,10:00:00,S,,0,1'])),
        discardIfEmpty(study.id),
      ]);
      const left = (await listStudies()).find((s) => s.id === study.id);
      if (saved.status === 'fulfilled') {
        // The save committed, so the study and its session must still be there.
        expect(left?.lines).toEqual([H, 'Rater,2026-10-02,10:00:00,S,,0,1']);
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
    await appendToStudy(study.id, [H, 'Anne,2026-10-02,10:00:00,S,,0,1']);
    expect(await discardIfEmpty(study.id)).toBe(false);
    expect((await readStudy(study.id)).lines).toHaveLength(2);
  });

  it('keeps both sessions when two tabs save to the same study at once', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Two tabs');
    await writeStudy(study.id, [H]);
    // Both tabs read the same file ([H]) when their sessions started.
    await Promise.all([
      appendToStudy(study.id, [H, 'TabA,2026-10-02,10:00:00,S,,0,1']),
      appendToStudy(study.id, [H, 'TabB,2026-10-02,10:00:01,S,,0,1']),
    ]);
    const lines = (await readStudy(study.id)).lines!;
    expect(lines[0]).toBe(H);
    expect(lines.slice(1).sort()).toEqual(['TabA,2026-10-02,10:00:00,S,,0,1', 'TabB,2026-10-02,10:00:01,S,,0,1']);
  });

  it('starts a fresh file when the session deliberately reset it (different header)', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Reset');
    await writeStudy(study.id, ['RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,old.wav', 'Old,2020-01-01,09:00:00,S,,0,1']);
    await appendToStudy(study.id, [H, 'New,2026-10-02,10:00:00,S,,0,1']);
    expect((await readStudy(study.id)).lines).toEqual([H, 'New,2026-10-02,10:00:00,S,,0,1']);
  });

  it('reports a save to a study deleted in another tab instead of losing it silently', async () => {
    const study = await createStudy(source('S', { 'a.wav': 'A' }), 'Gone');
    expect(await discardIfEmpty(study.id)).toBe(true);
    await expect(appendToStudy(study.id, [H, 'Late,2026-10-02,10:00:00,S,,0,1'])).rejects.toThrow(/could not be found/);
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
