import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sameLines, summarize, buildHeader } from '../src/lib/csv';
import { createStudy, fingerprintSource, legacyResults, recoverStudy, readStudy, writeStudy } from '../src/lib/studies';
import { resultsFor } from '../src/lib/results';
import type { Source } from '../src/lib/sources';

const memory = vi.hoisted(() => new Map<string, unknown>());
const write = vi.hoisted(() => vi.fn(async (key: string, value: unknown) => { memory.set(key, structuredClone(value)); }));
vi.mock('../src/lib/kv', () => ({
  kvKeys: async () => [...memory.keys()],
  kvGet: async (key: string) => structuredClone(memory.get(key)),
  kvSet: write,
}));
beforeEach(() => { memory.clear(); write.mockClear(); });

const source = (body = 'AAAA', label = 'Selected files'): Source => ({
  label, items: [{ id: 's:a.wav', name: 'a.wav', size: body.length, getFile: async () => new File([body], 'a.wav') }],
});

describe('explicit browser studies', () => {
  it('distinguishes actual recordings with identical names and sizes', async () => {
    expect(await fingerprintSource(source('AAAA'))).not.toBe(await fingerprintSource(source('BBBB')));
  });
  it('matches identical recordings regardless of folder label or selection order', async () => {
    const a = source();
    a.items.push({ id: 's:b.wav', name: 'b.wav', getFile: async () => new File(['BB'], 'b.wav') });
    expect(await fingerprintSource(a)).toBe(await fingerprintSource({ label: 'Renamed folder', items: [...a.items].reverse() }));
  });
  it('keeps separate studies with identical audio independent, and requires explicit selection', async () => {
    const a = source(), b = source();
    expect(() => resultsFor(a)).toThrow('Choose a browser study');
    a.studyId = (await createStudy(a, 'Study A')).id;
    b.studyId = (await createStudy(b, 'Study B')).id;
    expect(a.studyId).not.toBe(b.studyId);
    await resultsFor(a).write(['header', 'A result']);
    expect(await resultsFor(b).read()).toBeNull();
    const reopened = { ...source(), studyId: a.studyId };
    expect(await resultsFor(reopened).read()).toEqual(['header', 'A result']);
  });
});

describe('legacy recovery', () => {
  it('finds both older formats without deleting or assigning them', async () => {
    memory.set('results:Selected files', ['old']);
    memory.set('results:Selected files:abc123', ['intermediate']);
    const before = structuredClone(memory);
    expect(await legacyResults()).toHaveLength(2);
    expect(memory).toEqual(before);
  });
  it('recovers matching columns into a new study and retains the original', async () => {
    const src = source();
    const lines = [buildHeader(['a.wav']), 'Legacy,2026-01-01,12:00:00,src,,0,1'];
    memory.set('results:Selected files', lines);
    const study = await recoverStudy(src, 'Recovered', 'results:Selected files');
    expect((await readStudy(study.id)).lines).toEqual(lines);
    await writeStudy(study.id, [...lines, 'new result']);
    expect(memory.get('results:Selected files')).toEqual(lines);
  });
  it('preserves the legacy copy and creates no partial study when migration fails', async () => {
    const lines = [buildHeader(['a.wav']), 'legacy result'];
    memory.set('results:Selected files', lines);
    write.mockRejectedValueOnce(new Error('Commit failed'));
    await expect(recoverStudy(source(), 'Recovered', 'results:Selected files')).rejects.toThrow('Commit failed');
    expect([...memory.entries()]).toEqual([['results:Selected files', lines]]);
  });
  it('rejects mismatched sample columns without writing anything', async () => {
    memory.set('results:Selected files', [buildHeader(['other.wav'])]);
    await expect(recoverStudy(source(), 'Recovered', 'results:Selected files')).rejects.toThrow('sample columns');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('summarize', () => {
  it('counts sessions and reports the date of the last one', () => {
    const lines = ['RATER,DATE,TIME', 'Anne,2026-09-30,10:00:00', 'Brian,2026-10-01,11:00:00'];
    expect(summarize(lines)).toEqual({ sessions: 2, last: '2026-10-01' });
  });

  it('copes with no file, a header only, blank lines and old-style dates', () => {
    expect(summarize(null)).toEqual({ sessions: 0, last: null });
    expect(summarize(['RATER,DATE,TIME'])).toEqual({ sessions: 0, last: null });
    expect(summarize(['RATER,DATE', 'Anne, 07 January 2012', ''])).toEqual({ sessions: 1, last: '07 January 2012' });
  });
});

describe('sameLines', () => {
  it('compares copies line by line', () => {
    expect(sameLines(['h', 'a'], ['h', 'a'])).toBe(true);
    expect(sameLines(['h', 'a'], ['h', 'b'])).toBe(false);
    expect(sameLines(['h'], ['h', 'a'])).toBe(false);
  });
});
