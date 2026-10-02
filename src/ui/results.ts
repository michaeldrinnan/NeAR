import { summarize } from '../lib/csv';
import { downloadLines, importResults } from '../lib/results';
import { deleteStudy, legacyResults, listStudies, type Study } from '../lib/studies';
import { canUseFolders } from '../lib/sources';
import { fileTitle, studyFileName } from '../lib/studyFormat';
import { alertBox, ask } from './dialog';
import { backNav, el, page } from './page';
import { exclusive } from './session';

/** The download name for a study's results: NeAR_<title>_<code>.csv (studies from older versions have no code). */
const fileNameFor = (s: Study) => (s.format ? studyFileName(s.name, s.format, 'csv') : `NeAR_${fileTitle(s.name)}.csv`);

const label = (s: Study) => {
  const { sessions, last } = summarize(s.lines);
  return `${s.name}${s.format ? ` #${s.format.slice(0, 8)}` : ''} — ${sessions} session${sessions === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}`;
};

/** Results kept in this browser: download, import, delete, and recovery of older formats. To be simplified. */
export function showResults(root: HTMLElement, back: () => void): void {
  const again = () => showResults(root, back);
  const body = el('tbody');
  const table = el('div', { className: 'tablewrap', hidden: true }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Study', 'Sessions', 'Last saved', ''].map((t) => el('th', { textContent: t })))]),
      body,
    ]),
  ]);
  const empty = el('p', { className: 'muted', textContent: 'No results are kept in this browser yet.', hidden: true });
  const csvInput = el('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
  const importBtn = el('button', { type: 'button', textContent: 'Import results file…' });
  const recoverBtn = el('button', { type: 'button', textContent: 'Recover older results…' });

  let studies: Study[] = [];
  void listStudies().then(
    (list) => {
      studies = list;
      empty.hidden = list.length > 0;
      table.hidden = list.length === 0;
      body.replaceChildren(
        ...list.map((s) => {
          const { sessions, last } = summarize(s.lines);
          const download = el('button', { type: 'button', textContent: 'Download' });
          download.addEventListener('click', () =>
            s.lines?.length ? downloadLines(s.lines, fileNameFor(s)) : void alertBox(`“${s.name}” has no results to download.`),
          );
          const remove = el('button', { type: 'button', textContent: 'Delete…' });
          remove.addEventListener('click', () => void exclusive(async () => {
            if (await confirmDelete(s)) again();
          }));
          return el('tr', {}, [
            el('td', {}, [el('strong', { textContent: s.name }), ...(s.format ? [' ', el('span', { className: 'mono', textContent: `#${s.format.slice(0, 8)}` })] : [])]),
            el('td', { textContent: String(sessions) }),
            el('td', { textContent: last ?? '' }),
            el('td', {}, [el('div', { className: 'row' }, [download, remove])]),
          ]);
        }),
      );
    },
    (e: Error) => void alertBox(`The results kept in this browser could not be read.\n\n${e.message}`),
  );

  importBtn.addEventListener('click', () => {
    if (!studies.length) return void alertBox('There are no studies in this browser to import results into. Rate a study first.');
    csvInput.value = '';
    csvInput.click();
  });
  csvInput.addEventListener('change', () => void exclusive(async () => {
    const file = csvInput.files?.[0];
    if (!file) return;
    const select = el('select', {}, studies.map((s) => new Option(label(s), s.id)));
    const form = el('div', { className: 'study-form' }, [
      el('label', {}, ['Replace the results of', select]),
      el('p', { textContent: `The results kept in this browser for the chosen study are replaced by “${file.name}”. Download them first if you might need them.` }),
    ]);
    const key = await ask(form, [
      { label: 'Replace', value: 'yes' as const, primary: true },
      { label: 'Cancel', value: 'no' as const },
    ], 'Import results');
    if (key !== 'yes') return;
    await importResults(select.value, file);
    again();
  }));
  recoverBtn.addEventListener('click', () => void exclusive(recoverOlder));

  root.replaceChildren(
    page([
      backNav(back),
      el('h1', { textContent: 'Results kept in this browser' }),
      el('p', { className: 'placeholder tone-results', textContent: 'To be simplified: we’ll come back to this page.' }),
      el('p', {
        className: 'muted',
        textContent: canUseFolders
          ? 'Studies opened from a folder keep their results in that folder, in a file named after the study, so they aren’t listed here. Studies opened from a .zip file keep their results in this browser.'
          : 'This browser can’t write to folders, so results are kept here. Download them after your sessions to keep a copy.',
      }),
      table,
      empty,
      el('div', { className: 'row' }, [importBtn, recoverBtn, csvInput]),
    ]),
  );
}

/** Asks before deleting, offering a download first. Resolves true if the study was deleted. */
async function confirmDelete(s: Study): Promise<boolean> {
  for (;;) {
    const key = await ask(
      `Delete “${s.name}” and all its results from this browser? This cannot be undone, so download the results first if you might need them.`,
      [
        { label: 'Download results', value: 'download' as const },
        { label: 'Delete', value: 'delete' as const, danger: true },
        { label: 'Keep it', value: 'keep' as const, primary: true },
      ],
      'Delete results',
      'keep',
    );
    if (key === 'keep') return false;
    if (key === 'download') {
      if (s.lines?.length) downloadLines(s.lines, fileNameFor(s));
      else await alertBox(`“${s.name}” has no results to download.`);
      continue;
    }
    await deleteStudy(s.id);
    return true;
  }
}

/** Results saved by the two earliest browser-storage formats remain downloadable; the originals are kept. */
async function recoverOlder() {
  const entries = await legacyResults();
  if (!entries.length) return void alertBox('No results from older versions were found in this browser.');
  const select = el('select', {}, entries.map((e) => new Option(e.key.slice('results:'.length), e.key)));
  const details = el('p');
  const update = () => {
    const { sessions, last } = summarize(entries.find((e) => e.key === select.value)!.lines);
    details.textContent = `${sessions} session${sessions === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}. The original stays in this browser as a backup.`;
  };
  select.addEventListener('change', update);
  update();
  const form = el('div', { className: 'study-form' }, [el('label', {}, ['Older results', select]), details]);
  for (;;) {
    const choice = await ask(form, [
      { label: 'Download older results', value: 'download' as const, primary: true },
      { label: 'Close', value: 'close' as const },
    ], 'Recover older results');
    if (choice === 'close') return;
    downloadLines(entries.find((e) => e.key === select.value)!.lines, 'NeAR recovered results.csv');
  }
}
