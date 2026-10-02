import { buildHeader, summarize } from '../lib/csv';
import { downloadLines } from '../lib/results';
import { createStudy, deleteStudy, fingerprintSource, legacyResults, listStudies, recoverStudy } from '../lib/studies';
import type { Source } from '../lib/sources';
import type { Study } from '../lib/studies';
import { alertBox, ask } from './dialog';

function field<T extends HTMLElement>(body: HTMLElement, title: string, control: T): T {
  const label = document.createElement('label');
  label.textContent = title;
  label.append(control);
  body.append(label);
  return control;
}

/** A content match is a suggestion only: the user must select a study explicitly. */
/** What the chooser did: nothing (cancelled), selected an existing study, or created a new one. */
export type StudyChoice = false | { created: boolean };

export async function chooseStudy(source: Source): Promise<StudyChoice> {
  const [fingerprint, studies] = await Promise.all([fingerprintSource(source), listStudies()]);
  const body = document.createElement('div');
  body.className = 'study-form';
  const intro = document.createElement('p');
  intro.textContent = 'Choose a study to continue, or create a separate study. Existing studies can be continued only with the same sample names and recordings.';
  body.append(intro);
  const select = field(body, 'Study', document.createElement('select'));
  select.add(new Option('Create a new study', 'new'));
  for (const study of studies) {
    const matches = study.fingerprint === fingerprint;
    const sessions = summarize(study.lines).sessions;
    const option = new Option(`${study.name} — ${sessions} session${sessions === 1 ? '' : 's'}${matches ? ' (matching recordings)' : ' (different recordings)'}`, study.id);
    option.disabled = !matches;
    select.add(option);
  }
  const name = field(body, 'New study name', document.createElement('input'));
  name.value = source.label;
  name.maxLength = 200;
  select.addEventListener('change', () => { name.disabled = select.value !== 'new'; });
  // Exactly one study holds these recordings: offer to carry on with it, so pressing Continue doesn't split it.
  const matching = studies.filter((s) => s.fingerprint === fingerprint);
  if (matching.length === 1) {
    select.value = matching[0].id;
    name.disabled = true;
  }
  for (;;) {
    const answer = await ask(body, [
      { label: 'Continue', value: 'continue', primary: true },
      ...(studies.length ? [{ label: 'Delete…', value: 'delete' as const }] : []),
      { label: 'Cancel', value: 'cancel' },
    ], 'Choose a study');
    if (answer === 'cancel') return false;
    if (answer === 'delete') {
      await deleteStudies(source, studies);
      return chooseStudy(source); // start again with the remaining studies
    }
    if (select.value === 'new') {
      if (!name.value.trim()) { await alertBox('Enter a study name.'); continue; }
      source.studyId = (await createStudy(source, name.value)).id;
      return { created: true };
    }
    const study = studies.find((s) => s.id === select.value && s.fingerprint === fingerprint);
    if (!study) { await alertBox('Choose a study with matching recordings.'); continue; }
    source.studyId = study.id;
    return { created: false };
  }
}

/** Both historical storage formats remain downloadable, even without the original audio. */
export async function recoverResults(source: Source | null): Promise<boolean> {
  const entries = await legacyResults();
  if (!entries.length) { await alertBox('No results from older versions were found in this browser.'); return false; }
  const body = document.createElement('div');
  body.className = 'study-form';
  const select = field(body, 'Older results', document.createElement('select'));
  for (const entry of entries) select.add(new Option(entry.key.slice('results:'.length), entry.key));
  const details = document.createElement('p');
  body.append(details);
  const name = field(body, 'Recovered study name', document.createElement('input'));
  name.value = `${source?.label ?? 'Older results'} (recovered)`;
  const header = source ? buildHeader(source.items.map((i) => i.name)) : null;
  const selected = () => entries.find((e) => e.key === select.value)!;
  const update = () => {
    const entry = selected();
    const { sessions, last } = summarize(entry.lines);
    details.textContent = `${sessions} session${sessions === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}. ` +
      (header === entry.lines[0] ? 'Sample columns match. Confirm these results belong to the selected recordings before recovering them.' :
        'Sample columns do not match. Select the original samples to recover, or download a copy now.') +
      ' Recovery creates a separate study and keeps the original results as a backup.';
  };
  select.addEventListener('change', update);
  update();
  for (;;) {
    const choice = await ask(body, [
      { label: 'Download older results', value: 'download' },
      { label: 'Recover into new study', value: 'recover' },
      { label: 'Cancel', value: 'cancel' },
    ], 'Recover older results');
    if (choice === 'cancel') return false;
    if (choice === 'download') { downloadLines(selected().lines, 'NeAR recovered results.csv'); continue; }
    if (!source || source.dir || !source.items.length || header !== selected().lines[0]) {
      await alertBox('Choose the matching samples in browser-storage mode first. You can still download the older results.');
      continue;
    }
    if (!name.value.trim()) { await alertBox('Enter a study name.'); continue; }
    source.studyId = (await recoverStudy(source, name.value, selected().key)).id;
    return true;
  }
}

/** Lets the user delete any study kept in this browser, offering a download of its results first. */
async function deleteStudies(source: Source, studies: Study[]): Promise<void> {
  const body = document.createElement('div');
  body.className = 'study-form';
  const select = field(body, 'Study to delete', document.createElement('select'));
  for (const study of studies) {
    const { sessions, last } = summarize(study.lines);
    select.add(new Option(`${study.name} — ${sessions} session${sessions === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}`, study.id));
  }
  const warning = document.createElement('p');
  warning.textContent = 'Deleting removes the study and all its results from this browser. This cannot be undone, so download the results first if you might need them.';
  body.append(warning);
  for (;;) {
    const choice = await ask(body, [
      { label: 'Download results', value: 'download' as const },
      { label: 'Delete study', value: 'delete' as const },
      { label: 'Cancel', value: 'cancel' as const },
    ], 'Delete a study');
    if (choice === 'cancel') return;
    const study = studies.find((s) => s.id === select.value)!;
    if (choice === 'download') {
      if (study.lines?.length) downloadLines(study.lines, `NeAR ${study.name}.csv`);
      else await alertBox(`“${study.name}” has no results to download.`);
      continue;
    }
    const sure = await ask(`Delete “${study.name}” and all its results from this browser?`, [
      { label: 'Delete', value: 'yes' as const },
      { label: 'Keep it', value: 'no' as const, primary: true },
    ]);
    if (sure === 'no') continue;
    await deleteStudy(study.id);
    if (source.studyId === study.id) source.studyId = undefined;
    return;
  }
}
