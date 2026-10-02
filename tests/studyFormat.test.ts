import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  DEFAULT_OPTIONS,
  fileTitle,
  formatNote,
  layoutStudy,
  looksLikeAudio,
  makeStudyZip,
  parseStudyFileName,
  parseStudyText,
  readStudyZip,
  sourceLabel,
  studyFileName,
  StudyFormatError,
  tidyTitle,
  titleProblem,
  writeStudyText,
  type StudyDefinition,
  type StudyEntry,
} from '../src/lib/studyFormat';

/** A minimal file that starts like a WAV file; `body` makes its contents distinct. */
const wavBytes = (body: string) => strToU8(`RIFF\0\0\0\0WAVE${body}`);
const wav = (name: string, body = name) => new File([wavBytes(body)], name, { type: 'audio/wav' });

const EXAMPLE = `# NeAR study definition
title         = Dysphonia ranking 2026
version       = 2
instructions  = Rank by overall severity.
instructions  = Least severe at top left.
random        = on
numbers       = no
play_count    =            # blank: the default
LEAVE_UNRATED = Yes
animate       = no
`;

describe('study.txt', () => {
  it('reads titles, multi-line instructions and options; blank and missing options take the defaults', () => {
    const { definition, warnings } = parseStudyText(EXAMPLE);
    expect(warnings).toEqual([]); // version and animate are from earlier versions: ignored quietly
    expect(definition).toEqual({
      title: 'Dysphonia ranking 2026',
      instructions: ['Rank by overall severity.', 'Least severe at top left.'],
      options: { random: true, numbers: false, names: false, play_count: false, leave_unrated: true },
    });
  });

  it('uses the defaults for a minimal file, and the folder name when there is no title', () => {
    expect(parseStudyText('title = Minimal').definition).toEqual({ title: 'Minimal', instructions: [], options: DEFAULT_OPTIONS });
    expect(DEFAULT_OPTIONS).toEqual({ random: true, numbers: true, names: false, play_count: false, leave_unrated: false });
    expect(parseStudyText('random = off', 'Voices 2026').definition.title).toBe('Voices 2026');
  });

  it('keeps going past unknown settings, and old answer-key lines, with a warning', () => {
    expect(parseStudyText('title = T\ncolour = blue\n').warnings).toEqual(['study.txt, line 2: unknown setting “colour” ignored.']);
    expect(parseStudyText('title = Old\nanswer_key = a, b\nshow_answers = yes\n').warnings).toEqual([
      'study.txt, line 2: unknown setting “answer_key” ignored.',
      'study.txt, line 3: unknown setting “show_answers” ignored.',
    ]);
  });

  it('stops on invalid values or lines, naming the line', () => {
    expect(() => parseStudyText('title = T\nrandom = maybe')).toThrow(/line 2: “random = maybe” should be on or off/);
    expect(() => parseStudyText('title = T\njust some words')).toThrow(/line 2: expected “key = value”/);
    expect(() => parseStudyText('just some words')).toThrow(StudyFormatError);
  });

  it('loads a hand-edited title that can’t be used in file names, with a warning, and sanitises file names', () => {
    const { definition, warnings } = parseStudyText('title = Before/after: “ah”?');
    expect(definition.title).toBe('Before/after: “ah”?');
    expect(warnings[0]).toMatch(/can’t be used as it is/);
    expect(studyFileName(definition.title, 'abcdef0123456789', 'csv')).toBe('NeAR_Before_after_ “ah”__abcdef01.csv');
  });

  it('writes a file that reads back to the same definition', () => {
    const def: StudyDefinition = {
      title: 'Round trip',
      instructions: ['One', 'Two'],
      options: { random: false, numbers: true, names: true, play_count: false, leave_unrated: true },
    };
    expect(parseStudyText(writeStudyText(def)).definition).toEqual(def);
    expect(writeStudyText(def)).not.toMatch(/version/);
  });
});

describe('titles', () => {
  it('refuses characters no file name may contain, and overlong titles', () => {
    for (const bad of ['a\\b', 'a/b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\tb']) expect(titleProblem(bad)).toMatch(/can’t contain/);
    expect(titleProblem('   ')).toMatch(/Enter a title/);
    expect(titleProblem('x'.repeat(81))).toMatch(/80 characters/);
    expect(titleProblem('Dysphonia ranking 2026 – pilot (v2)')).toBeNull();
  });

  it('trims spaces and a trailing full stop', () => {
    expect(tidyTitle('  My study.  ')).toBe('My study');
    expect(fileTitle('My study...')).toBe('My study');
  });

  it('names files NeAR_<title>_<code>, and reads the names back', () => {
    const id = '0123456789abcdef'.repeat(4);
    expect(studyFileName('Voices_2026', id, 'csv')).toBe('NeAR_Voices_2026_01234567.csv');
    expect(studyFileName('Voices', id, 'csv', ' (copy)')).toBe('NeAR_Voices_01234567 (copy).csv');
    expect(studyFileName('Voices', id, 'zip')).toBe('NeAR_Voices_01234567.zip');
    expect(parseStudyFileName('NeAR_Voices_2026_01234567.csv')).toEqual({ title: 'Voices_2026', code: '01234567' });
    expect(parseStudyFileName('NeAR_Voices_01234567 (copy).csv')).toEqual({ title: 'Voices', code: '01234567' });
    expect(parseStudyFileName('NeAR.csv')).toBeNull();
    expect(sourceLabel('Voices', id)).toBe('Voices #01234567');
  });
});

describe('study folders', () => {
  const entries = (paths: string[]): StudyEntry[] => paths.map((path) => ({ path, file: async () => wav(path.split('/').pop()!) }));

  it('finds Test and Ref in any case, and prefers them to the older TestItems and RefItems', () => {
    const l = layoutStudy(entries(['test/b.wav', 'test/a.wav', 'REF/r.wav', 'TestItems/x.wav', 'study.txt', 'NeAR_S_01234567.csv', 'NeAR.csv', 'notes.docx', 'Thumbs.db']));
    expect([l.testFolder, l.refFolder]).toEqual(['test', 'REF']);
    expect(l.samples.map((e) => e.path)).toEqual(['test/a.wav', 'test/b.wav']);
    expect(l.references.map((e) => e.path)).toEqual(['REF/r.wav']);
    expect(l.studyText?.path).toBe('study.txt');
    expect(l.results.map((e) => e.path)).toEqual(['NeAR_S_01234567.csv', 'NeAR.csv']);
    expect(l.ignored).toBe(2); // notes.docx and the TestItems folder; Thumbs.db doesn't count
  });

  it('treats 2012-style WAVs loose in the folder as the voices to rate, unless there is a Test folder', () => {
    const loose = layoutStudy(entries(['a.wav', 'b.wav']));
    expect([loose.testFolder, loose.samples.length, loose.references.length]).toEqual([null, 2, 0]);
    const both = layoutStudy(entries(['a.wav', 'Test/b.wav', 'Test/c.wav']));
    expect(both.samples.map((e) => e.path)).toEqual(['Test/b.wav', 'Test/c.wav']);
    expect(both.ignored).toBe(1);
  });

  it('accepts WAV, MP3, M4A, AAC, FLAC, Ogg and Opus in any case, mixed, sorted by name', () => {
    const l = layoutStudy(entries(['Test/f.FLAC', 'Test/a.mp3', 'Test/c.Wav', 'Test/b.m4a', 'Test/d.aac', 'Test/e.ogg', 'Test/g.opus', 'Test/h.wma', 'Test/i.txt']));
    expect(l.samples.map((e) => e.path)).toEqual(['Test/a.mp3', 'Test/b.m4a', 'Test/c.Wav', 'Test/d.aac', 'Test/e.ogg', 'Test/f.FLAC', 'Test/g.opus']);
    expect(l.ignored).toBe(2);
  });
});

describe('audio files', () => {
  const file = (name: string, head: number[] | string) => new File([typeof head === 'string' ? strToU8(head) : new Uint8Array(head)], name);

  it('recognise each accepted type by how it starts', async () => {
    const good: [string, number[] | string][] = [
      ['a.wav', 'RIFF\0\0\0\0WAVEfmt '],
      ['a.mp3', 'ID3\x04\0\0\0\0\0\0\0\0'],
      ['b.mp3', [0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]],
      ['a.m4a', '\0\0\0\x20ftypM4A '],
      ['a.aac', [0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]],
      ['a.flac', 'fLaC\0\0\0\x22\0\0\0\0'],
      ['a.ogg', 'OggS\0\x02\0\0\0\0\0\0'],
      ['a.opus', 'OggS\0\x02\0\0\0\0\0\0'],
    ];
    for (const [name, head] of good) expect(await looksLikeAudio(file(name, head), name), name).toBe(true);
    expect(await looksLikeAudio(file('a.mp3', 'RIFF\0\0\0\0WAVE'), 'a.mp3')).toBe(false); // not what its name says
    expect(await looksLikeAudio(file('a.flac', 'not audio at all'), 'a.flac')).toBe(false);
  });

  it('notes Ogg and Opus files, which some browsers can’t play', () => {
    expect(formatNote([wav('a.wav'), new File([], 'b.mp3')])).toBeNull();
    expect(formatNote([wav('a.wav'), new File([], 'b.OGG'), new File([], 'c.opus')])).toMatch(/^2 files are Ogg or Opus, which may not play in Safari/);
  });
});

describe('study zips', () => {
  const def = parseStudyText(EXAMPLE).definition;

  it('round-trip in Test and Ref, with references only when Ref has WAVs', async () => {
    const zip = await makeStudyZip(def, [wav('b.wav'), wav('a.wav'), wav('c.wav')], [wav('r1.wav')]);
    const pkg = await readStudyZip(zip);
    expect(pkg.definition).toEqual(def);
    expect(pkg.samples.map((f) => f.name)).toEqual(['a.wav', 'b.wav', 'c.wav']); // Windows order
    expect(pkg.references.map((f) => f.name)).toEqual(['r1.wav']);
    const noRefs = await readStudyZip(await makeStudyZip(def, [wav('a.wav'), wav('b.wav'), wav('c.wav')], []));
    expect(noRefs.references).toEqual([]);
  });

  it('accept contents inside one top-level folder and older TestItems/RefItems zips, ignoring other files', async () => {
    const zip = zipSync({
      'My study': {
        'study.txt': strToU8('title = Nested\nversion = 1\n'),
        TestItems: { 'a.wav': wavBytes('A'), 'b.wav': wavBytes('B'), 'notes.txt': strToU8('x'), deeper: { 'z.wav': wavBytes('Z') } },
        RefItems: { 'r.wav': wavBytes('R') },
        'README.txt': strToU8('hello'),
      },
    });
    const pkg = await readStudyZip(zip);
    expect(pkg.definition.title).toBe('Nested');
    expect(pkg.samples.map((f) => f.name)).toEqual(['a.wav', 'b.wav']);
    expect(pkg.references.map((f) => f.name)).toEqual(['r.wav']);
  });

  it('without study.txt use the defaults, titled after the zip', async () => {
    const pkg = await readStudyZip(zipSync({ Test: { 'a.wav': wavBytes('A'), 'b.wav': wavBytes('B') } }), 'Voices 2026.zip');
    expect(pkg.definition).toEqual({ title: 'Voices 2026', instructions: [], options: DEFAULT_OPTIONS });
    expect(pkg.hasDefinition).toBe(false);
  });

  it('explain what is wrong with an unusable study', async () => {
    await expect(readStudyZip(strToU8('not a zip'))).rejects.toThrow(/not a readable \.zip/);
    await expect(readStudyZip(zipSync({ 'study.txt': strToU8('title = T') }))).rejects.toThrow('No audio files (WAV, MP3, M4A, AAC, FLAC, Ogg or Opus) were found');
    await expect(readStudyZip(zipSync({ Test: { 'a.wav': wavBytes('A') } }))).rejects.toThrow(/Only one voice to rate was found in Test/);
    await expect(readStudyZip(zipSync({ Test: { 'a.wav': wavBytes('A'), 'b.wav': strToU8('not audio') } }))).rejects.toThrow('“b.wav” in Test can’t be played');
    await expect(readStudyZip(zipSync({ Test: { 'a.wav': wavBytes('A'), 'b.opus': strToU8('not audio') } }))).rejects.toThrow('Ogg and Opus files don’t play in some browsers');
    await expect(readStudyZip(zipSync({ 'study.txt': strToU8('random = maybe'), Test: { 'a.wav': wavBytes('A'), 'b.wav': wavBytes('B') } }))).rejects.toThrow(/line 1/);
  });

  it('give the same identity regardless of comments, layout and retired settings, and a new one for any real change', async () => {
    const files = () => [wav('a.wav'), wav('b.wav'), wav('c.wav')];
    const base = await readStudyZip(await makeStudyZip(def, files(), []));
    const relaidOut = await readStudyZip(
      zipSync({
        'study.txt': strToU8(EXAMPLE.replace('# NeAR study definition', '# a different comment').replaceAll('  =', ' =').replace('version       = 2', 'version = 7')),
        TestItems: { 'a.wav': wavBytes('a.wav'), 'b.wav': wavBytes('b.wav'), 'c.wav': wavBytes('c.wav') },
      }),
    );
    expect(relaidOut.identity).toBe(base.identity);
    const changed = async (d: StudyDefinition, f = files()) => (await readStudyZip(await makeStudyZip(d, f, []))).identity;
    expect(await changed({ ...def, title: 'Other' })).not.toBe(base.identity);
    expect(await changed({ ...def, instructions: ['Other'] })).not.toBe(base.identity);
    expect(await changed({ ...def, options: { ...def.options, names: true } })).not.toBe(base.identity);
    expect(await changed(def, [wav('a.wav', 'other audio'), wav('b.wav'), wav('c.wav')])).not.toBe(base.identity);
  });
});
