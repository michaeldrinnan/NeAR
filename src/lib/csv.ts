/**
 * The NeAR.csv results format, kept column-for-column compatible with the
 * 2012 Windows version:
 *
 *   RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,<sample 1>,<sample 2>,...
 *
 * Each rank is the sample's position in the rated box counting reference
 * samples too (1 = best), or 0 if left unrated.
 */

export const CSV_FILE = 'NeAR.csv';
const FIXED_COLUMNS = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS';

/** Commas would break the columns; the original replaced them with spaces. */
export function clean(text: string): string {
  return text.replaceAll(',', ' ');
}

export function buildHeader(sampleNames: readonly string[]): string {
  return [FIXED_COLUMNS, ...sampleNames.map(clean)].join(',');
}

export interface SessionResult {
  rater: string;
  when: Date;
  source: string;
  /** Reference folder label, or null when no references were used. */
  reference: string | null;
  nrefs: number;
  /** One rank per sample, in header order. */
  ranks: readonly number[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local time as 24-hour HH:MM:SS. */
export function isoTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function buildRow(r: SessionResult): string {
  const withRefs = r.reference !== null;
  return [
    r.rater,
    isoDate(r.when),
    isoTime(r.when),
    clean(r.source),
    withRefs ? clean(r.reference!) : '',
    withRefs ? String(r.nrefs) : '0',
    ...r.ranks.map(String),
  ].join(',');
}

/**
 * Rank of each sample (in `sampleIds` order) given the final contents of the
 * rated box, which may include reference ids.
 */
export function computeRanks(sampleIds: readonly string[], ratedBox: readonly string[]): number[] {
  return sampleIds.map((id) => ratedBox.indexOf(id) + 1);
}

/** Splits file text into lines like .NET's File.ReadAllLines. */
export function parseLines(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Joins lines like .NET's File.WriteAllLines (CRLF after every line). */
export function serializeLines(lines: readonly string[]): string {
  return lines.map((l) => l + '\r\n').join('');
}

/** True if a data row (not the header) already uses exactly this rater ID. */
export function raterUsed(lines: readonly string[], rater: string): boolean {
  return lines.slice(1).some((line) => line.split(',')[0] === rater);
}
