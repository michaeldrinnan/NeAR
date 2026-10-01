import { describe, expect, it } from 'vitest';
import { compareNtfs, shuffle, stem } from '../src/lib/order';
import { buildHeader, buildRow, computeRanks, parseLines, raterUsed, serializeLines } from '../src/lib/csv';
import { colourWheel, mixture } from '../src/lib/tileArt';

describe('compareNtfs', () => {
  it('reproduces the header order of the 2012 RefItems/NeAR.csv', () => {
    const names = [
      'Copy of phon2.wav', 'CLICK3.WAV', 'Copy (3) of phon1.wav', 'Copy of Heartbing.wav', 'CLICK1.WAV',
      'Copy (2) of phon2.wav', 'Copy (4) of phon1.wav', 'CLICK1 - Copy.WAV', 'Copy (2) of phon1.wav',
      'Copy (4) of phon2.wav', 'Copy (3) of phon2.wav', 'Copy of phon1.wav',
    ];
    const header =
      'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,CLICK1 - Copy.WAV,CLICK1.WAV,CLICK3.WAV,Copy (2) of phon1.wav,' +
      'Copy (2) of phon2.wav,Copy (3) of phon1.wav,Copy (3) of phon2.wav,Copy (4) of phon1.wav,Copy (4) of phon2.wav,' +
      'Copy of Heartbing.wav,Copy of phon1.wav,Copy of phon2.wav';
    expect(buildHeader(names.sort(compareNtfs))).toBe(header);
  });

  it('ignores case like Windows does', () => {
    expect(['b.wav', 'A.wav', 'a2.wav'].sort(compareNtfs)).toEqual(['A.wav', 'a2.wav', 'b.wav']);
  });
});

describe('shuffle', () => {
  it('keeps every item', () => {
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('puts each item in each position about equally often', () => {
    const n = 4, trials = 40_000;
    const counts = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let t = 0; t < trials; t++) shuffle([0, 1, 2, 3]).forEach((item, pos) => counts[item][pos]++);
    for (const row of counts) for (const c of row) expect(Math.abs(c / trials - 1 / n)).toBeLessThan(0.015);
  });
});

describe('csv', () => {
  it('replaces commas in file names', () => {
    expect(buildHeader(['a,b.wav'])).toBe('RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,a b.wav');
  });

  it('writes ISO date and 24-hour time, empty reference and NREFS 0 without references', () => {
    const row = buildRow({ rater: 'Anne', when: new Date(2026, 9, 1, 15, 4, 5), source: 'src', reference: null, nrefs: 0, ranks: [4, 3, 2, 1] });
    expect(row).toBe('Anne,2026-10-01,15:04:05,src,,0,4,3,2,1');
  });

  it('writes the reference folder and count', () => {
    const row = buildRow({ rater: 'B', when: new Date(2026, 0, 2, 3, 4, 5), source: 'src', reference: 'my,ref', nrefs: 10, ranks: [1] });
    expect(row).toBe('B,2026-01-02,03:04:05,src,my ref,10,1');
  });

  it('ranks count reference positions and give 0 to unrated samples (manual example)', () => {
    // 10 references r1..r10; rater put zz90 first, zz89 second, zz24 seventh; zz10 left unrated.
    const refs = Array.from({ length: 10 }, (_, i) => `r:${i + 1}`);
    const box = ['s:zz90', 's:zz89', ...refs.slice(0, 4), 's:zz24', ...refs.slice(4)];
    expect(computeRanks(['s:zz10', 's:zz24', 's:zz89', 's:zz90'], box)).toEqual([0, 7, 2, 1]);
  });

  it('reads and writes lines like .NET', () => {
    expect(parseLines('﻿a,b\r\nc\r\n')).toEqual(['a,b', 'c']);
    expect(parseLines('a\nb')).toEqual(['a', 'b']);
    expect(serializeLines(['a', 'b'])).toBe('a\r\nb\r\n');
  });

  it('matches rater IDs exactly', () => {
    const lines = ['RATER,DATE', 'test1,x', 'PreSub,y'];
    expect(raterUsed(lines, '1')).toBe(false);
    expect(raterUsed(lines, 'Sub')).toBe(false);
    expect(raterUsed(lines, 'test1')).toBe(true);
    expect(raterUsed(lines, 'RATER')).toBe(false);
  });
});

describe('tile art', () => {
  it('reproduces the original colour wheel, including its phase-0 behaviour', () => {
    expect(colourWheel(0.0, 1)).toEqual([0, 0, 255]);
    expect(colourWheel(0.5, 1)).toEqual([255, 255, 0]);
    expect(colourWheel(0.3125, 0.25)).toEqual([0, 63, 31]);
  });

  it('never yields NaN', () => {
    const g = { uq: 0, up: 0, sq: 0.33, sp: 0.33, r: 0.999999 };
    expect(mixture(1, 0, g, g)).toBe(0.5);
  });
});

describe('stem', () => {
  it('drops the extension', () => {
    expect(stem('Copy of phon1.wav')).toBe('Copy of phon1');
    expect(stem('noext')).toBe('noext');
  });
});
