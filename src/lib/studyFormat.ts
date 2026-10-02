/**
 * NeAR studies (docs/study-format.md): a folder, or a .zip of one, holding study.txt plus
 * Test/ holding the voices to rate (WAV, MP3, M4A/AAC, FLAC, Ogg/Opus) and optionally Ref/.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { audioType, compareNtfs, extension, isAudio, PATCHY_FORMATS } from './order';

export const STUDY_FILE = 'study.txt';

/** The rating options a study fixes, as the rating screen uses them. */
export interface StudyOptions {
  random: boolean;
  numbers: boolean;
  names: boolean;
  showCount: boolean;
  canLeave: boolean;
}

/** study.txt option keys, and the rating option each one controls. */
export const OPTION_KEYS = {
  random: 'random',
  numbers: 'numbers',
  names: 'names',
  play_count: 'showCount',
  leave_unrated: 'canLeave',
} as const satisfies Record<string, keyof StudyOptions>;

export type OptionKey = keyof typeof OPTION_KEYS;

/** What a study uses for any option its study.txt leaves blank or out. */
export const DEFAULT_OPTIONS: Readonly<Record<OptionKey, boolean>> = {
  random: true,
  numbers: true,
  names: false,
  play_count: false,
  leave_unrated: false,
};

export interface StudyDefinition {
  title: string;
  instructions: string[];
  /** Every option, on or off. */
  options: Record<OptionKey, boolean>;
}

export const defaultDefinition = (title: string): StudyDefinition => ({ title, instructions: [], options: { ...DEFAULT_OPTIONS } });

export function ratingOptions(def: StudyDefinition): StudyOptions {
  const out = {} as StudyOptions;
  for (const [key, option] of Object.entries(OPTION_KEYS) as [OptionKey, keyof StudyOptions][]) out[option] = def.options[key];
  return out;
}

export class StudyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudyFormatError';
  }
}

// ---- titles ----

export const TITLE_MAX = 80;
/** Characters no file name may contain on Windows, macOS or Linux, plus control characters. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
const ILLEGAL_ALL = new RegExp(ILLEGAL.source, 'g');

/** Spaces trimmed and trailing full stops removed (Windows drops them from names). */
export function tidyTitle(raw: string): string {
  return raw.trim().replace(/[.\s]+$/, '');
}

/** Why a title typed into NeAR can't be used, or null if it can. */
export function titleProblem(raw: string): string | null {
  if (ILLEGAL.test(raw)) return 'A title can’t contain \\ / : * ? " < > | or control characters, because it is used in file names.';
  const title = tidyTitle(raw);
  if (!title) return 'Enter a title for the study.';
  if (title.length > TITLE_MAX) return `Keep the title to ${TITLE_MAX} characters or fewer (it has ${title.length}).`;
  return null;
}

/** The title as it appears in file names: characters that can't be used become “_”. */
export function fileTitle(title: string): string {
  return tidyTitle(title.replace(ILLEGAL_ALL, '_')).slice(0, TITLE_MAX) || 'Untitled';
}

/** A usable title made from a folder or file name, for a study with no study.txt. */
export function titleFromName(name: string): string {
  return tidyTitle(tidyTitle(name.replace(ILLEGAL_ALL, ' ')).slice(0, TITLE_MAX)) || 'Untitled study';
}

// ---- study.txt ----

const YES = new Set(['yes', 'true', '1', 'on']);
const NO = new Set(['no', 'false', '0', 'off']);
/** Keys from earlier versions of the format, ignored without comment. */
const RETIRED = new Set(['version', 'animate']);

function onOff(value: string, line: number, key: string): boolean | undefined {
  const v = value.toLowerCase();
  if (v === '') return undefined;
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  throw new StudyFormatError(`${STUDY_FILE}, line ${line}: “${key} = ${value}” should be on or off.`);
}

/**
 * Reads study.txt. Blank or missing options take the defaults; a missing title becomes
 * `fallbackTitle`. Unknown keys and unusable titles are returned as warnings; invalid
 * values throw, naming the line.
 */
export function parseStudyText(text: string, fallbackTitle = 'Untitled study'): { definition: StudyDefinition; warnings: string[] } {
  const def = defaultDefinition('');
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/(^|\s)#.*$/, '').trim(); // comments: whole line, or after " #"
    if (!text) return;
    const eq = text.indexOf('=');
    if (eq < 0) throw new StudyFormatError(`${STUDY_FILE}, line ${line}: expected “key = value”, found “${text}”.`);
    const key = text.slice(0, eq).trim().toLowerCase();
    const value = text.slice(eq + 1).trim();
    if (key === 'title') def.title = tidyTitle(value);
    else if (key === 'instructions') {
      if (value) def.instructions.push(value);
    } else if (key in OPTION_KEYS) {
      def.options[key as OptionKey] = onOff(value, line, key) ?? DEFAULT_OPTIONS[key as OptionKey];
    } else if (!RETIRED.has(key)) {
      warnings.push(`${STUDY_FILE}, line ${line}: unknown setting “${key}” ignored.`);
    }
  });
  if (!def.title) def.title = tidyTitle(fallbackTitle) || 'Untitled study';
  const problem = titleProblem(def.title);
  if (problem) warnings.push(`The title “${def.title}” can’t be used as it is: ${problem} File names use “${fileTitle(def.title)}”.`);
  return { definition: def, warnings };
}

/** Writes study.txt for a definition. */
export function writeStudyText(def: StudyDefinition): string {
  const out = [
    '# NeAR study definition - see docs/study-format.md',
    '# Options are on or off; blank or missing options take the defaults.',
    `title         = ${def.title}`,
    ...(def.instructions.length ? def.instructions.map((l) => `instructions  = ${l}`) : ['instructions  =']),
    ...Object.keys(OPTION_KEYS).map((k) => `${k.padEnd(13)} = ${def.options[k as OptionKey] ? 'on' : 'off'}`),
    '',
  ];
  return out.join('\r\n');
}

// ---- folder layout (shared by folders and zips) ----

/** A file somewhere in a study folder, by its path relative to that folder ("Test/a.wav"). */
export interface StudyEntry {
  path: string;
  file(): Promise<File>;
}

export interface StudyLayout {
  /** The test folder's actual name ("Test", "testitems"…), or null for 2012-style audio files loose in the folder. */
  testFolder: string | null;
  /** The reference folder's actual name, or null if there is none. */
  refFolder: string | null;
  samples: StudyEntry[];
  references: StudyEntry[];
  studyText: StudyEntry | null;
  /** CSV files directly in the folder whose names start with "NeAR" (results files). */
  results: StudyEntry[];
  /** How many other files and folders were ignored. */
  ignored: number;
}

const TEST = /^test(items)?$/i;
const REF = /^ref(items)?$/i;
const SYSTEM = /^(\..*|desktop\.ini|thumbs\.db)$/i;

/** Prefers the short name ("Test") when both it and the old one ("TestItems") are present. */
function pickFolder(names: string[], pattern: RegExp): string | null {
  const found = names.filter((n) => pattern.test(n)).sort((a, b) => a.length - b.length || compareNtfs(a, b));
  return found[0] ?? null;
}

/** Sorts out which files in a study folder are what (docs/study-format.md §1). */
export function layoutStudy(entries: readonly StudyEntry[]): StudyLayout {
  const parts = entries.map((e) => ({ e, p: e.path.split('/') })).filter(({ p }) => !SYSTEM.test(p[p.length - 1]));
  const folders = [...new Set(parts.filter(({ p }) => p.length > 1).map(({ p }) => p[0]))];
  const testFolder = pickFolder(folders, TEST);
  const refFolder = pickFolder(folders, REF);
  const wavsIn = (folder: string) =>
    parts.filter(({ p }) => p.length === 2 && p[0] === folder && isAudio(p[1])).map(({ e }) => e);
  const loose = parts.filter(({ p }) => p.length === 1 && isAudio(p[0])).map(({ e }) => e);
  const samples = testFolder ? wavsIn(testFolder) : loose;
  const references = refFolder ? wavsIn(refFolder) : [];
  const studyText = parts.find(({ p }) => p.length === 1 && p[0].toLowerCase() === STUDY_FILE)?.e ?? null;
  const results = parts.filter(({ p }) => p.length === 1 && /^near.*\.csv$/i.test(p[0])).map(({ e }) => e);
  const used = new Set<StudyEntry>([...samples, ...references, ...results, ...(studyText ? [studyText] : [])]);
  // Count each other top-level file, and each other folder once, wherever its files are.
  const ignored = new Set<string>();
  for (const { e, p } of parts) {
    if (used.has(e)) continue;
    if (p.length === 1) ignored.add(p[0]);
    else if (p[0] === testFolder || p[0] === refFolder) ignored.add(p.slice(0, 2).join('/'));
    else ignored.add(p[0] + '/');
  }
  const byName = (a: StudyEntry, b: StudyEntry) => compareNtfs(baseName(a.path), baseName(b.path));
  return { testFolder, refFolder, samples: samples.sort(byName), references: references.sort(byName), studyText, results, ignored: ignored.size };
}

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** True if the file starts the way files of its type do (a quick check where audio can't be decoded). */
export async function looksLikeAudio(file: Blob, name: string): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = (from: number, length = 4) => String.fromCharCode(...b.slice(from, from + length));
  switch (extension(name)) {
    case 'wav':
      return (text(0) === 'RIFF' || text(0) === 'RF64') && text(8) === 'WAVE';
    case 'mp3':
      return text(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case 'm4a':
      return text(4) === 'ftyp';
    case 'aac':
      return text(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0);
    case 'flac':
      return text(0) === 'fLaC' || text(0, 3) === 'ID3';
    case 'ogg':
    case 'opus':
      return text(0) === 'OggS';
    default:
      return false;
  }
}

/**
 * True if this browser can play the file: it is decoded where the Web Audio API is available,
 * otherwise (e.g. in unit tests) only its first bytes are checked.
 */
export async function playable(file: File): Promise<boolean> {
  if (!(await looksLikeAudio(file, file.name))) return false;
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return true;
  try {
    await new Offline(1, 1, 8000).decodeAudioData(await file.arrayBuffer());
    return true;
  } catch {
    return false;
  }
}

const KINDS = 'WAV, MP3, M4A, AAC, FLAC, Ogg or Opus';

/** Why a laid-out folder can't be a study (no voices, too few, or a file that won't play), or null. */
export async function layoutProblem(layout: StudyLayout, files: { samples: File[]; references: File[] }): Promise<string | null> {
  if (!layout.samples.length) {
    return layout.testFolder
      ? `There are no audio files (${KINDS}) in the ${layout.testFolder} folder.`
      : `No audio files (${KINDS}) were found. Put the voices to rate in a sub-folder called Test, and any reference voices in one called Ref.`;
  }
  if (layout.samples.length < 2) {
    return `Only one voice to rate was found${layout.testFolder ? ` in ${layout.testFolder}` : ''}. A study needs at least two.`;
  }
  const where = (f: string | null) => (f ? ` in ${f}` : '');
  for (const [list, folder] of [[files.samples, layout.testFolder], [files.references, layout.refFolder]] as const) {
    for (const f of list) {
      if (await playable(f)) continue;
      const hint = PATCHY_FORMATS.has(extension(f.name))
        ? ' Ogg and Opus files don’t play in some browsers, such as Safari on older iPads and Macs: convert it to WAV, MP3 or M4A.'
        : ' Replace or remove it.';
      return `“${f.name}”${where(folder)} can’t be played in this browser: it may be damaged, or not really the type its name says.${hint}`;
    }
  }
  return null;
}

/** A note for studies with formats that some browsers can't play, or null. */
export function formatNote(files: readonly File[]): string | null {
  const patchy = files.filter((f) => PATCHY_FORMATS.has(extension(f.name)));
  if (!patchy.length) return null;
  return `${patchy.length} file${patchy.length === 1 ? ' is' : 's are'} Ogg or Opus, which may not play in Safari or on iPads. WAV, MP3 or M4A play everywhere.`;
}

// ---- identity ----

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data: BufferSource) => hex(await crypto.subtle.digest('SHA-256', data));

/** Each file's name and SHA-256, the audio part of a study's identity. */
export async function fileHashes(files: readonly File[]): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const f of files) out.push([f.name, await sha256(await f.arrayBuffer())]); // one at a time, to spare memory
  return out;
}

/** SHA-256 (hex) of the definition (reduced to its meaning) plus every file's name and checksum. */
export async function identityOf(def: StudyDefinition, test: [string, string][], ref: [string, string][]): Promise<string> {
  const definition = {
    title: def.title,
    instructions: def.instructions,
    options: Object.keys(OPTION_KEYS).map((k) => [k, def.options[k as OptionKey]]),
  };
  return sha256(new TextEncoder().encode(JSON.stringify({ definition, test, ref })));
}

export async function studyIdentity(def: StudyDefinition, samples: File[], references: File[]): Promise<string> {
  return identityOf(def, await fileHashes(samples), await fileHashes(references));
}

/** The short study code: the first 8 hex digits of the identity. */
export const studyCode = (identity: string) => identity.slice(0, 8);

/** "Title #code", written to the SOURCE column. */
export function sourceLabel(title: string, identity: string): string {
  return `${title} #${studyCode(identity)}`;
}

// ---- file names ----

/** "NeAR_<title>_<code><suffix>.<ext>": results files, their downloads and study zips. */
export function studyFileName(title: string, identity: string, ext: 'csv' | 'zip', suffix = ''): string {
  return `NeAR_${fileTitle(title)}_${studyCode(identity)}${suffix}.${ext}`;
}

/** Reads a name made by studyFileName back (the title may itself contain underscores). */
export function parseStudyFileName(name: string): { title: string; code: string } | null {
  const m = /^NeAR_(.*)_([0-9a-f]{8})(?: \(.*\))?\.(csv|zip)$/i.exec(name);
  return m ? { title: m[1], code: m[2].toLowerCase() } : null;
}

// ---- packages ----

export interface StudyPackage {
  definition: StudyDefinition;
  warnings: string[];
  samples: File[];
  references: File[];
  /** SHA-256 (hex) of the normalised definition plus every file's name and checksum. */
  identity: string;
  /** False if there was no study.txt, so the definition is the defaults. */
  hasDefinition: boolean;
  /** NeAR results files found alongside, by name. */
  results: File[];
}

/** Reads a whole study from its files (a folder, or a zip's contents). Throws StudyFormatError if unusable. */
export async function readStudy(entries: readonly StudyEntry[], folderName: string): Promise<StudyPackage> {
  const layout = layoutStudy(entries);
  const load = (list: StudyEntry[]) => Promise.all(list.map(async (e) => withName(await e.file(), baseName(e.path))));
  const files = { samples: await load(layout.samples), references: await load(layout.references) };
  const problem = await layoutProblem(layout, files);
  if (problem) throw new StudyFormatError(problem);
  const parsed = layout.studyText
    ? parseStudyText(await (await layout.studyText.file()).text(), folderName)
    : { definition: defaultDefinition(titleFromName(folderName)), warnings: [] };
  return {
    ...parsed,
    ...files,
    identity: await studyIdentity(parsed.definition, files.samples, files.references),
    hasDefinition: !!layout.studyText,
    results: await Promise.all(layout.results.map(async (e) => withName(await e.file(), baseName(e.path)))),
  };
}

function withName(file: File, name: string): File {
  return file.name === name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/** Reads a study .zip. Throws StudyFormatError with a plain explanation if it isn't a usable study. */
export async function readStudyZip(bytes: Uint8Array, zipName = 'Study'): Promise<StudyPackage> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new StudyFormatError('This file is not a readable .zip study.');
  }
  let names = Object.keys(unzipped).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/'));
  // Allow everything to sit inside one top-level folder, as many zip tools produce.
  let folderName = zipName.replace(/\.zip$/i, '');
  const tops = new Set(names.map((n) => (n.includes('/') ? n.slice(0, n.indexOf('/')) : '')));
  let strip = '';
  if (tops.size === 1 && !tops.has('')) {
    const [top] = tops;
    if (!TEST.test(top) && !REF.test(top)) {
      strip = top + '/';
      folderName = top;
    }
  }
  names = names.filter((n) => n.startsWith(strip));
  const entries: StudyEntry[] = names.map((n) => ({
    path: n.slice(strip.length),
    file: async () => new File([unzipped[n] as Uint8Array<ArrayBuffer>], baseName(n), { type: audioType(n) ?? '' }),
  }));
  return readStudy(entries, parseStudyFileName(zipName)?.title ?? folderName);
}

/** Builds a study .zip from a definition and the audio files, in Test/ and Ref/. */
export async function makeStudyZip(def: StudyDefinition, samples: File[], references: File[]): Promise<Uint8Array> {
  const tree: Zippable = { [STUDY_FILE]: strToU8(writeStudyText(def)) };
  const add = async (folder: string, files: File[]) => {
    const dir: Zippable = {};
    for (const f of files) dir[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }]; // audio barely compresses
    tree[folder] = dir;
  };
  await add('Test', samples);
  if (references.length) await add('Ref', references);
  return zipSync(tree);
}
