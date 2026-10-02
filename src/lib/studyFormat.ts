/**
 * NeAR study packages (docs/study-format.md): a .zip holding study.txt plus
 * TestItems/*.wav and optionally RefItems/*.wav.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { compareNtfs, isWav, stem } from './order';
import type { RatingOptions } from '../ui/rating';

export const STUDY_FILE = 'study.txt';

/** study.txt option keys, and the rating option each one controls. */
export const OPTION_KEYS = {
  random: 'random',
  numbers: 'numbers',
  names: 'names',
  play_count: 'showCount',
  leave_unrated: 'canLeave',
  animate: 'animate',
} as const satisfies Record<string, keyof RatingOptions>;

export type OptionKey = keyof typeof OPTION_KEYS;

export interface StudyDefinition {
  title: string;
  version: string;
  instructions: string[];
  /** Fixed options only; a missing key means the rater may choose. */
  options: Partial<Record<OptionKey, boolean>>;
  answerKey: string[];
  showAnswers: boolean;
}

export class StudyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudyFormatError';
  }
}

const YES = new Set(['yes', 'true', '1', 'on']);
const NO = new Set(['no', 'false', '0', 'off']);

function yesNo(value: string, line: number, key: string): boolean | undefined {
  const v = value.toLowerCase();
  if (v === '') return undefined;
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  throw new StudyFormatError(`${STUDY_FILE}, line ${line}: “${key} = ${value}” should be yes, no or blank.`);
}

/** Reads study.txt. Unknown keys are returned as warnings; invalid values throw, naming the line. */
export function parseStudyText(text: string): { definition: StudyDefinition; warnings: string[] } {
  const def: StudyDefinition = { title: '', version: '1', instructions: [], options: {}, answerKey: [], showAnswers: false };
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
    if (key === 'title') def.title = value;
    else if (key === 'version') def.version = value || '1';
    else if (key === 'instructions') {
      if (value) def.instructions.push(value);
    } else if (key in OPTION_KEYS) {
      const v = yesNo(value, line, key);
      if (v === undefined) delete def.options[key as OptionKey];
      else def.options[key as OptionKey] = v;
    } else if (key === 'answer_key') {
      def.answerKey = value.split(',').map((s) => s.trim().replace(/\.wav$/i, '')).filter(Boolean);
    } else if (key === 'show_answers') {
      def.showAnswers = yesNo(value, line, key) ?? false;
    } else {
      warnings.push(`${STUDY_FILE}, line ${line}: unknown setting “${key}” ignored.`);
    }
  });
  if (!def.title) throw new StudyFormatError(`${STUDY_FILE} needs a title, e.g. “title = My study”.`);
  return { definition: def, warnings };
}

/** Writes study.txt for a definition (used by "Save as study…"). */
export function writeStudyText(def: StudyDefinition): string {
  const yn = (v: boolean | undefined) => (v === undefined ? '' : v ? 'yes' : 'no');
  const out = [
    '# NeAR study definition — see docs/study-format.md',
    '# Options: yes or no fixes the setting; leave blank to let the rater choose.',
    `title         = ${def.title}`,
    `version       = ${def.version}`,
    ...(def.instructions.length ? def.instructions.map((l) => `instructions  = ${l}`) : ['instructions  =']),
    ...Object.keys(OPTION_KEYS).map((k) => `${k.padEnd(13)} = ${yn(def.options[k as OptionKey])}`),
    `answer_key    = ${def.answerKey.join(', ')}`,
    `show_answers  = ${def.showAnswers ? 'yes' : 'no'}`,
    '',
  ];
  return out.join('\r\n');
}

export interface StudyPackage {
  definition: StudyDefinition;
  warnings: string[];
  samples: File[];
  references: File[];
  /** SHA-256 (hex) of the normalised definition plus every file's name and checksum. */
  identity: string;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data: BufferSource) => hex(await crypto.subtle.digest('SHA-256', data));

/** The definition reduced to its meaning, so comments, spacing and key order don't change the identity. */
function normalised(def: StudyDefinition) {
  return {
    title: def.title,
    version: def.version,
    instructions: def.instructions,
    options: Object.keys(OPTION_KEYS).map((k) => [k, def.options[k as OptionKey] ?? null]),
    answerKey: def.answerKey,
    showAnswers: def.showAnswers,
  };
}

export async function studyIdentity(def: StudyDefinition, samples: File[], references: File[]): Promise<string> {
  const files = async (list: File[]) => {
    const out: [string, string][] = [];
    for (const f of list) out.push([f.name, await sha256(await f.arrayBuffer())]);
    return out;
  };
  const text = JSON.stringify({ definition: normalised(def), test: await files(samples), ref: await files(references) });
  return sha256(new TextEncoder().encode(text));
}

/** Reads a study .zip. Throws StudyFormatError with a plain explanation if it isn't a usable study. */
export async function readStudyZip(bytes: Uint8Array): Promise<StudyPackage> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new StudyFormatError('This file is not a readable .zip study package.');
  }
  // Allow everything to sit inside one top-level folder, as many zip tools produce.
  const names = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/'));
  const definitionPath = names.find((n) => /(^|\/)study\.txt$/i.test(n) && n.split('/').length <= 2);
  if (!definitionPath) throw new StudyFormatError(`The package has no ${STUDY_FILE}.`);
  const root = definitionPath.slice(0, definitionPath.length - STUDY_FILE.length);
  const filesIn = (folder: string) =>
    names
      .filter((n) => n.toLowerCase().startsWith((root + folder + '/').toLowerCase()))
      .map((n) => [n, n.slice(root.length + folder.length + 1)] as const)
      .filter(([, rest]) => !rest.includes('/') && isWav(rest)) // directly inside, WAV only
      .map(([n, rest]) => new File([entries[n] as Uint8Array<ArrayBuffer>], rest, { type: 'audio/wav' }))
      .sort((a, b) => compareNtfs(a.name, b.name));

  const { definition, warnings } = parseStudyText(new TextDecoder().decode(entries[definitionPath]));
  const samples = filesIn('TestItems');
  const references = filesIn('RefItems');
  if (!samples.length) throw new StudyFormatError('The package has no WAV files in TestItems/.');
  const stems = new Set(samples.map((f) => stem(f.name)));
  const unknown = definition.answerKey.filter((k) => !stems.has(k));
  if (unknown.length) warnings.push(`answer_key names files that aren't in TestItems/: ${unknown.join(', ')}.`);
  return { definition, warnings, samples, references, identity: await studyIdentity(definition, samples, references) };
}

/** Builds a study .zip from a definition and the audio files. */
export async function makeStudyZip(def: StudyDefinition, samples: File[], references: File[]): Promise<Uint8Array> {
  const tree: Zippable = { [STUDY_FILE]: strToU8(writeStudyText(def)) };
  const add = async (folder: string, files: File[]) => {
    const dir: Zippable = {};
    for (const f of files) dir[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }]; // WAVs barely compress
    tree[folder] = dir;
  };
  await add('TestItems', samples);
  if (references.length) await add('RefItems', references);
  return zipSync(tree);
}

/** "Title vVERSION #HASH8", written to the SOURCE column. */
export function sourceLabel(pkg: Pick<StudyPackage, 'definition' | 'identity'>): string {
  return `${pkg.definition.title} v${pkg.definition.version} #${pkg.identity.slice(0, 8)}`;
}

/**
 * Spearman's rank correlation between the rater's order and the answer key, over the
 * samples that appear in both (unrated samples are left out). Null if fewer than two.
 */
export function compareWithKey(raterBestFirst: readonly string[], key: readonly string[]): { rho: number | null; n: number } {
  const common = raterBestFirst.filter((s) => key.includes(s));
  const n = common.length;
  if (n < 2) return { rho: null, n };
  const keyOrder = key.filter((s) => common.includes(s));
  let d2 = 0;
  common.forEach((s, i) => {
    const d = i - keyOrder.indexOf(s);
    d2 += d * d;
  });
  return { rho: 1 - (6 * d2) / (n * (n * n - 1)), n };
}
