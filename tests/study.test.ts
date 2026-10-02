import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sameLines, summarize } from '../src/lib/csv';
import { legacyResults } from '../src/lib/studies';

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/lib/kv', () => ({
  kvKeys: async () => [...memory.keys()],
  kvGet: async (key: string) => structuredClone(memory.get(key)),
}));
beforeEach(() => memory.clear());

describe('results from older versions', () => {
  it('are found in both older formats without deleting or assigning them', async () => {
    memory.set('results:Selected files', ['old']);
    memory.set('results:Selected files:abc123', ['intermediate']);
    memory.set('study:pkg-1', { id: 'pkg-1', lines: ['not legacy'] });
    const before = structuredClone(memory);
    expect((await legacyResults()).map((e) => e.key)).toEqual(['results:Selected files', 'results:Selected files:abc123']);
    expect(memory).toEqual(before);
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
