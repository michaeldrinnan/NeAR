import { describe, expect, it } from 'vitest';
import { studyKey } from '../src/lib/results';
import { sameLines, summarize } from '../src/lib/csv';

const study = (label: string, files: [string, number][]) => ({
  label,
  items: files.map(([name, size]) => ({ id: 's:' + name, name, size, getFile: async () => new File([], name) })),
});

describe('studyKey', () => {
  it('is the same for the same folder name and files', () => {
    expect(studyKey(study('Voices', [['a.wav', 10], ['b.wav', 20]]))).toBe(studyKey(study('Voices', [['a.wav', 10], ['b.wav', 20]])));
  });

  it('separates folders that share a name but hold different files', () => {
    const key = studyKey(study('Voices', [['a.wav', 10], ['b.wav', 20]]));
    expect(studyKey(study('Voices', [['a.wav', 10], ['c.wav', 20]]))).not.toBe(key); // different name
    expect(studyKey(study('Voices', [['a.wav', 10], ['b.wav', 21]]))).not.toBe(key); // same names, different recordings
    expect(studyKey(study('Voices', [['a.wav', 10]]))).not.toBe(key); // a file fewer
  });

  it('separates "Choose files…" picks, which all share the label "Selected files"', () => {
    expect(studyKey(study('Selected files', [['x.wav', 1]]))).not.toBe(studyKey(study('Selected files', [['y.wav', 1]])));
  });

  it('keeps the folder name visible in the key', () => {
    expect(studyKey(study('Example files', [['a.wav', 1]]))).toMatch(/^results:Example files:/);
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
