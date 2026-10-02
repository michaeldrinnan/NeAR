import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  makeStudyZip,
  parseStudyText,
  readStudyZip,
  sourceLabel,
  StudyFormatError,
  writeStudyText,
  type StudyDefinition,
} from '../src/lib/studyFormat';

const wav = (name: string, body = name) => new File([body], name, { type: 'audio/wav' });

const EXAMPLE = `# NeAR study definition
title         = Dysphonia ranking 2026
version       = 2
instructions  = Rank by overall severity.
instructions  = Least severe at top left.
random        = yes
numbers       = no
play_count    =            # blank: the rater may choose
LEAVE_UNRATED = Off
`;

describe('study.txt', () => {
  it('reads titles, multi-line instructions, and fixed and blank options', () => {
    const { definition, warnings } = parseStudyText(EXAMPLE);
    expect(warnings).toEqual([]);
    expect(definition).toEqual({
      title: 'Dysphonia ranking 2026',
      version: '2',
      instructions: ['Rank by overall severity.', 'Least severe at top left.'],
      options: { random: true, numbers: false, leave_unrated: false },
    });
  });

  it('defaults to version 1 with nothing fixed', () => {
    expect(parseStudyText('title = Minimal').definition).toEqual({
      title: 'Minimal', version: '1', instructions: [], options: {},
    });
  });

  it('keeps going past unknown settings, with a warning', () => {
    const { warnings } = parseStudyText('title = T\ncolour = blue\n');
    expect(warnings).toEqual(['study.txt, line 2: unknown setting “colour” ignored.']);
  });

  it('stops on invalid values or lines, naming the line', () => {
    expect(() => parseStudyText('title = T\nrandom = maybe')).toThrow(/line 2: “random = maybe” should be yes, no or blank/);
    expect(() => parseStudyText('title = T\njust some words')).toThrow(/line 2: expected “key = value”/);
    expect(() => parseStudyText('random = yes')).toThrow(StudyFormatError);
  });

  it('writes a file that reads back to the same definition', () => {
    const def: StudyDefinition = {
      title: 'Round trip', version: '1', instructions: ['One', 'Two'], options: { random: false, animate: true },
    };
    expect(parseStudyText(writeStudyText(def)).definition).toEqual(def);
  });
});

describe('study packages', () => {
  const def = parseStudyText(EXAMPLE).definition;

  it('round-trips through a zip, with references only when RefItems has WAVs', async () => {
    const zip = await makeStudyZip(def, [wav('b.wav'), wav('a.wav'), wav('c.wav')], [wav('r1.wav')]);
    const pkg = await readStudyZip(zip);
    expect(pkg.definition).toEqual(def);
    expect(pkg.samples.map((f) => f.name)).toEqual(['a.wav', 'b.wav', 'c.wav']); // Windows order
    expect(pkg.references.map((f) => f.name)).toEqual(['r1.wav']);
    const noRefs = await readStudyZip(await makeStudyZip(def, [wav('a.wav'), wav('b.wav'), wav('c.wav')], []));
    expect(noRefs.references).toEqual([]);
  });

  it('accepts a zip whose contents sit inside one top-level folder, and ignores other files', async () => {
    const zip = zipSync({
      'My study': {
        'study.txt': strToU8('title = Nested'),
        TestItems: { 'a.wav': strToU8('A'), 'notes.txt': strToU8('x'), deeper: { 'z.wav': strToU8('Z') } },
        'README.txt': strToU8('hello'),
      },
    });
    const pkg = await readStudyZip(zip);
    expect(pkg.definition.title).toBe('Nested');
    expect(pkg.samples.map((f) => f.name)).toEqual(['a.wav']);
  });

  it('explains what is wrong with an unusable package', async () => {
    await expect(readStudyZip(strToU8('not a zip'))).rejects.toThrow(/not a readable \.zip/);
    await expect(readStudyZip(zipSync({ TestItems: { 'a.wav': strToU8('A') } }))).rejects.toThrow(/no study\.txt/);
    await expect(readStudyZip(zipSync({ 'study.txt': strToU8('title = T') }))).rejects.toThrow(/no WAV files in TestItems/);
  });

  it('loads older study files that still have answer-key lines, ignoring them with a warning', async () => {
    const { definition, warnings } = parseStudyText('title = Old\nanswer_key = a, b\nshow_answers = yes\n');
    expect(definition.title).toBe('Old');
    expect(warnings).toEqual([
      'study.txt, line 2: unknown setting “answer_key” ignored.',
      'study.txt, line 3: unknown setting “show_answers” ignored.',
    ]);
  });

  it('gives the same identity regardless of comments and layout, and a new one for any real change', async () => {
    const files = () => [wav('a.wav'), wav('b.wav'), wav('c.wav')];
    const base = await readStudyZip(await makeStudyZip(def, files(), []));
    const relaidOut = await readStudyZip(
      zipSync({
        'study.txt': strToU8(EXAMPLE.replace('# NeAR study definition', '# a different comment').replaceAll('  =', ' =')),
        TestItems: { 'a.wav': strToU8('a.wav'), 'b.wav': strToU8('b.wav'), 'c.wav': strToU8('c.wav') },
      }),
    );
    expect(relaidOut.identity).toBe(base.identity);
    const changed = async (d: StudyDefinition, f = files()) => (await readStudyZip(await makeStudyZip(d, f, []))).identity;
    expect(await changed({ ...def, version: '3' })).not.toBe(base.identity);
    expect(await changed({ ...def, options: { ...def.options, animate: true } })).not.toBe(base.identity);
    expect(await changed(def, [wav('a.wav', 'other audio'), wav('b.wav'), wav('c.wav')])).not.toBe(base.identity);
    expect(sourceLabel(base)).toBe(`Dysphonia ranking 2026 v2 #${base.identity.slice(0, 8)}`);
  });
});
