import { buildHeader, buildRow, computeRanks, raterUsed, summarize } from '../lib/csv';
import { downloadLines, folderCopy, legacyResultsFile, resultsFor, saveCopy, type ResultsStore } from '../lib/results';
import { rememberStudy } from '../lib/recent';
import { audioItems, type OpenStudy } from '../lib/sources';
import { ratingOptions, sourceLabel, studyCode, studyFileName } from '../lib/studyFormat';
import { alertBox, ask, yesNo, yesNoCancel } from './dialog';
import { runRating } from './rating';
import { el, page } from './page';

export const SESSION_ACTIVE = 'A session is already active in another NeAR window. Finish or close it before continuing.';

// Guards this window when the browser has no Web Locks.
let busy = false;

/**
 * One NeAR operation at a time across every window and tab of this browser: reading results,
 * rating and saving, as well as imports and deletions. The browser releases the lock by itself
 * if the window holding it closes or crashes. Browsers without the Web Locks API fall back to a
 * single-window guard plus the browser store's conflict check.
 */
export async function withSessionLock<T>(action: () => Promise<T>): Promise<T | 'busy'> {
  if (busy) return 'busy';
  busy = true;
  try {
    if (!navigator.locks) return await action();
    return await navigator.locks.request('near-session', { ifAvailable: true }, async (lock) => (lock ? action() : ('busy' as const)));
  } finally {
    busy = false;
  }
}

/** Runs `action` under the session lock, explaining if another window is busy or the action fails. */
export async function exclusive(action: () => Promise<void>): Promise<void> {
  try {
    if ((await withSessionLock(action)) === 'busy') await alertBox(SESSION_ACTIVE);
  } catch (e) {
    await alertBox(`Couldn't complete this action.\n\n${(e as Error).message}`);
  }
}

const sessions = (lines: readonly string[] | null) => {
  const { sessions: n, last } = summarize(lines);
  return `${n} session${n === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}`;
};

/**
 * Opens a study on the rating screen: a session name, then rating, then saving. `back`
 * returns to wherever the study was opened from. `remember` adds it to Recent studies.
 */
export async function rateStudy(root: HTMLElement, study: OpenStudy, back: () => void, remember = true): Promise<void> {
  let message = '';
  const outcome = await withSessionLock(async () => {
    const store = resultsFor(study);
    const lines = await prepareResults(store, study);
    if (!lines) return 'cancelled' as const;
    if (remember) await rememberStudy(study).catch(() => {}); // a convenience: never stops a session
    const ranked = await ratingPage(root, study, store, lines);
    if (!ranked) return 'left' as const;
    lines.push(
      buildRow({
        rater: ranked.rater,
        when: new Date(), // time the session finished, as before
        source: sourceLabel(study.definition.title, study.identity),
        reference: study.references.length ? 'Ref' : null,
        nrefs: study.references.length,
        ranks: computeRanks(study.samples.map((s) => 's:' + s.name), ranked.box),
      }),
    );
    root.replaceChildren(page([el('section', { className: 'panel tone-rate', 'aria-live': 'polite' }, [el('p', { textContent: 'Saving results…' })])]));
    const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnOnLeave);
    try {
      message = await writeResults(store, lines, study);
    } finally {
      window.removeEventListener('beforeunload', warnOnLeave);
    }
    return 'saved' as const;
  }).catch(async (e: Error) => {
    await alertBox(`Couldn't open this study.\n\n${e.message}`);
    return 'cancelled' as const;
  });
  if (outcome === 'busy') await alertBox(SESSION_ACTIVE);
  if (outcome !== 'saved') return back();

  // Saved: offer the next session straight away.
  const again = el('button', { type: 'button', className: 'primary', textContent: 'Start another session' });
  const backBtn = el('button', { type: 'button', className: 'big back', textContent: '← Back' });
  root.replaceChildren(
    page([
      el('nav', { className: 'nav' }, [backBtn]),
      el('section', { className: 'panel tone-rate' }, [
        el('h1', { textContent: study.definition.title }),
        el('p', { className: 'saved', textContent: message }),
        el('div', { className: 'row' }, [again]),
      ]),
    ]),
  );
  backBtn.addEventListener('click', back);
  again.addEventListener('click', () => void rateStudy(root, study, back, false));
  again.focus();
}

/**
 * Reads the study's results so far, settling any question about them first. Resolves with
 * the lines to add this session to, or null if the user cancelled or they can't be read.
 */
async function prepareResults(store: ResultsStore, study: OpenStudy): Promise<string[] | null> {
  const header = buildHeader(study.samples.map((s) => s.name));
  let existing: string[] | null;
  try {
    existing = await store.read();
  } catch {
    await alertBox(
      `The results file exists, but could not be read:\n\n  ${store.where}\n\n` +
        'Is the file being used by another program?\nIn any case, you need to deal with the problem before you can continue.',
    );
    return null;
  }

  // Browsers without folder access: the study folder may hold a copy of this study's results file.
  const copy = await folderCopy(study).catch(() => null);
  if (copy && !existing) existing = copy;
  else if (copy && existing && copy.join('\n') !== existing.join('\n')) {
    for (;;) {
      const key = await ask(
        'There are two different copies of the results for this study:\n\n' +
          `  • ${store.fileName} in the study folder: ${sessions(copy)}\n` +
          `  • the copy kept in this browser: ${sessions(existing)}\n\n` +
          'Which one should NeAR carry on with? If you choose the folder’s file, the copy kept in this browser is ' +
          'replaced when this session is saved, so download it first if you might need it.',
        [
          { label: 'Use the folder’s file', value: 'folder' as const },
          { label: 'Use this browser’s copy', value: 'browser' as const, primary: true },
          { label: 'Download browser’s copy', value: 'download' as const },
          { label: 'Cancel', value: 'cancel' as const },
        ],
      );
      if (key === 'cancel') return null;
      if (key === 'download') {
        downloadLines(existing, studyFileName(study.definition.title, study.identity, 'csv', ' (browser copy)'));
        continue;
      }
      if (key === 'folder') existing = copy;
      break;
    }
  }

  // A plain NeAR.csv from the 2012 version with the same voices: offered until this study's own file exists.
  if (!existing) {
    const legacy = await legacyResultsFile(study).catch(() => null);
    if (legacy && legacy.length > 1 && legacy[0] === header) {
      const key = await ask(
        `This study's folder also has NeAR.csv, from an older version of NeAR, with the same voices (${sessions(legacy)}).\n\n` +
          `Carry those sessions on into ${store.fileName}? NeAR.csv itself is left unchanged.`,
        [
          { label: 'Carry them on', value: 'carry' as const, primary: true },
          { label: 'Start a new results file', value: 'new' as const },
          { label: 'Cancel', value: 'cancel' as const },
        ],
      );
      if (key === 'cancel') return null;
      if (key === 'carry') existing = [...legacy];
    }
  }

  if (!existing || existing.length === 0) return [header];
  if (existing[0] === header) return existing;
  // Only if the file was edited by hand: its columns no longer match the study's voices.
  for (;;) {
    const key = await yesNoCancel(
      `The columns in ${store.fileName} don't match this study's voices.\n` +
        'It needs to be reset to represent them.\n\n' +
        'Would you like to save the existing results under a different name?\n\n' +
        'Choose YES to save under a different name.\n' +
        'Choose NO and you will LOSE YOUR DATA.\n' +
        'CANCEL to abandon the rating session you were about to start. You will keep your data.',
    );
    if (key === 'cancel') return null;
    if (key === 'no') return [header];
    const dir = study.origin.kind === 'folder' ? study.origin.dir : undefined;
    if (await saveCopy(existing, studyFileName(study.definition.title, study.identity, 'csv', ' (old)'), dir)) return [header];
  }
}

/**
 * The rating screen: study title and instructions, a session name that must be entered
 * before the tiles unlock, the board, and Back (which asks first). Resolves with the
 * session name and the rated box, or null if the rater left without saving.
 */
function ratingPage(root: HTMLElement, study: OpenStudy, store: ResultsStore, lines: readonly string[]): Promise<{ rater: string; box: string[] } | null> {
  const { definition: def } = study;
  const n = study.samples.length;
  const r = study.references.length;
  const back = el('button', { type: 'button', className: 'big back', textContent: '← Back' });
  const name = el('input', { id: 'rater', type: 'text', placeholder: 'Type a name to begin', autocomplete: 'off', spellcheck: false });
  const nameNote = el('p', { className: 'field-note', hidden: true });
  const instructions = el('div', { className: 'instr', hidden: !def.instructions.length }, def.instructions.map((t) => el('p', { textContent: t })));
  const { sessions: saved } = summarize(lines);
  const resultsNote = store.inBrowser
    ? `Results are kept in this browser as ${store.fileName}.`
    : `Results are saved to ${store.where}.`;
  const host = el('div');
  root.replaceChildren(
    page([
      el('nav', { className: 'nav' }, [back]),
      el('section', { className: 'panel tone-rate study-head' }, [
        el('div', { className: 'sessbar' }, [
          el('div', { className: 't' }, [
            el('h1', { className: 'study-title', textContent: def.title }),
            el('p', {
              className: 'muted meta',
              textContent: `${n} voices · ${r ? `${r} reference${r === 1 ? '' : 's'}` : 'no references'} · study #${studyCode(study.identity)}`,
            }),
          ]),
          el('div', { className: 'sess' }, [el('label', { htmlFor: 'rater', textContent: 'Session name' }), name, nameNote]),
        ]),
        instructions,
        el('p', { className: 'note results-note', textContent: `${resultsNote} ${saved ? `${sessions(lines)} so far.` : 'No sessions saved yet.'}` }),
        el('p', { className: 'note warnings', hidden: !study.warnings.length, textContent: study.warnings.join(' ') }),
      ]),
      host,
    ]),
  );

  const nameProblem = () => {
    const v = name.value.trim();
    if (!v) return 'empty';
    if (v.includes(',')) return 'A session name can’t contain a comma: programs such as Excel would read it as two columns.';
    return null;
  };
  const session = runRating(host, audioItems(study.samples, 's:'), r ? audioItems(study.references, 'r:') : null, ratingOptions(def), async () => {
    if (nameProblem()) return false;
    if (raterUsed(lines, name.value.trim())) {
      return (await yesNo('This session name has already been used for this study.\nAre you sure you want to continue?')) === 'yes';
    }
    return true;
  });
  name.addEventListener('input', () => {
    const problem = nameProblem();
    nameNote.hidden = problem === null || problem === 'empty';
    nameNote.textContent = problem && problem !== 'empty' ? problem : '';
    session.setLocked(problem !== null, problem === 'empty' || problem === null ? undefined : 'Correct the session name above to carry on rating');
  });
  name.focus();

  return new Promise((resolve) => {
    back.addEventListener('click', async () => {
      const key = await ask(
        'Your ranking hasn’t been saved. If you leave now, it will be lost.',
        [
          { label: 'Keep rating', value: 'keep' as const, primary: true },
          { label: 'Leave without saving', value: 'leave' as const, danger: true },
        ],
        'Leave this rating session?',
        'keep',
      );
      if (key !== 'leave') return;
      session.stop();
      resolve(null);
    });
    void session.done.then((box) => resolve({ rater: name.value.trim(), box }));
  });
}

/** Saves the results, offering retry / save elsewhere on failure (the old WriteRecentResults). Resolves with what happened. */
async function writeResults(store: ResultsStore, lines: string[], study: OpenStudy): Promise<string> {
  for (;;) {
    try {
      const committed = await store.commit(lines);
      const time = new Date().toLocaleTimeString();
      if (!store.inBrowser) return `Saved to ${store.where} at ${time}.`;
      const key = await ask(
        `Your results have been saved in this browser.\n\nDownload an up-to-date copy of ${store.fileName} now?`,
        [
          { label: 'Download', value: 'yes', primary: true },
          { label: 'Not now', value: 'no' },
        ],
      );
      if (key === 'yes') downloadLines(committed, store.fileName); // exactly what was saved
      return `Saved to this browser at ${time}. Download ${store.fileName} from the Results page at any time.`;
    } catch (e) {
      const key = await yesNoCancel(
        `There was a problem writing to:\n  ${store.where}\n\n${(e as Error).message}\n\n` +
          'Your results have not been saved.\n' +
          'If the file is open in another program (such as Excel), close it.\n\n' +
          'Do you want to try the same file again?\n' +
          'If you choose YES, this file will be tried again.\n' +
          'If you choose NO, you will be given the opportunity to choose a new file name.\n' +
          'If you choose CANCEL, you will LOSE YOUR RESULTS.',
      );
      if (key === 'cancel') return 'Results were NOT saved.';
      if (key === 'no') {
        const copyName = studyFileName(study.definition.title, study.identity, 'csv', ' (copy)');
        const dir = study.origin.kind === 'folder' ? study.origin.dir : undefined;
        const name = await saveCopy(lines, copyName, dir);
        if (name) {
          await alertBox(
            'PLEASE NOTE: You have saved an entire copy of your results to a temporary file. ' +
              'This file will NOT be used in future ratings.\n' +
              `Before your next session, you should make sure '${store.fileName}' is up-to-date.\n\n` +
              'You can do this in one of two ways:\n' +
              ` - Replace '${store.fileName}' with the temporary file;\n` +
              ` - Copy the new results from the last line of the temporary file to the end of '${store.fileName}'.`,
          );
          return `Saved a copy to ${name}.`;
        }
      }
    }
  }
}
