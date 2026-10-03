import { buildHeader, buildRow, computeRanks, raterUsed, serializeLines, summarize } from '../lib/csv';
import { downloadLines, downloadStudyResults, folderCopy, legacyResultsFile, resultsFor, saveCopy, type ResultsStore } from '../lib/results';
import { rememberStudy } from '../lib/recent';
import { markDownloaded, studyId } from '../lib/studies';
import { canShareFile, installAdvice, requestPersistence, shareFile } from '../lib/safekeeping';
import { audioItems, writeMissingDefinition, type OpenStudy } from '../lib/sources';
import { ratingOptions, sourceLabel, studyCode, studyFileName } from '../lib/studyFormat';
import { alertBox, ask, yesNo, yesNoCancel } from './dialog';
import { animateCheckbox, runRating } from './rating';
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
 * Opens a study: the Study info screen (with the session name), then rating, then saving. `back`
 * returns to wherever the study was opened from. `remember` adds it to Recent studies; `preset`
 * fills in the session name (Start another session).
 */
export async function rateStudy(root: HTMLElement, study: OpenStudy, back: () => void, remember = true, preset = ''): Promise<void> {
  let rater = preset;
  let message = '';
  const outcome = await withSessionLock(async () => {
    const store = resultsFor(study);
    const lines = await prepareResults(store, study);
    if (!lines) return 'cancelled' as const;
    if (remember) await rememberStudy(study).catch(() => {}); // a convenience: never stops a session
    const name = await infoPage(root, study, store, lines, preset);
    if (name === null) return 'left' as const;
    rater = name;
    const box = await ratingPage(root, study, store, lines, rater);
    if (!box) return 'left' as const;
    lines.push(
      buildRow({
        rater,
        when: new Date(), // time the session finished, as before
        source: sourceLabel(study.definition.title, study.identity),
        reference: study.references.length ? 'Ref' : null,
        nrefs: study.references.length,
        ranks: computeRanks(study.samples.map((s) => 's:' + s.name), box),
      }),
    );
    root.replaceChildren(page([el('section', { className: 'panel tone-rate', 'aria-live': 'polite' }, [el('p', { textContent: 'Saving results…' })])]));
    const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnOnLeave);
    try {
      message = await writeResults(store, lines, study);
      if (!store.inBrowser && message.startsWith('Saved to')) await writeMissingDefinition(study);
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
  again.addEventListener('click', () => void rateStudy(root, study, back, false, rater));
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

/** Everything about a study a rater may want to know: shown on the Study info screen and in its dialog. */
function studyInfo(study: OpenStudy, store: ResultsStore, lines: readonly string[]): HTMLElement[] {
  const { definition: def } = study;
  const n = study.samples.length;
  const r = study.references.length;
  const { sessions: saved } = summarize(lines);
  const resultsNote = store.inBrowser ? `Results are kept in this browser as ${store.fileName}.` : `Results are saved to ${store.where}.`;
  return [
    el('h1', { className: 'study-title', textContent: def.title }),
    el('p', {
      className: 'muted meta',
      textContent: `${n} voices · ${r ? `${r} reference${r === 1 ? '' : 's'}` : 'no references'} · study #${studyCode(study.identity)}`,
    }),
    el('div', { className: 'instr', hidden: !def.instructions.length }, def.instructions.map((t) => el('p', { textContent: t }))),
    el('div', { className: 'how' }, [
      el('h2', { textContent: 'How to rate' }),
      el('p', {
        textContent:
          'Click Play on a sample to listen, then drag it into the upper box. Arrange the samples there with the BEST at the top left, ' +
          'and move them around until you are happy with the order. The lower box holds the samples still to rate, and any you are not sure about.' +
          (r ? ' The plain blue samples are references; their order cannot be changed.' : ''),
      }),
      el('p', { textContent: 'When you have finished, press Save and finish.' }),
    ]),
    el('p', { className: 'note results-note', textContent: `${resultsNote} ${saved ? `${sessions(lines)} so far.` : 'No sessions saved yet.'}` }),
    el('p', { className: 'note warnings', hidden: !study.warnings.length, textContent: study.warnings.join(' ') }),
    animateCheckbox(),
  ];
}

const nameProblem = (value: string) => {
  const v = value.trim();
  if (!v) return 'empty';
  if (v.includes(',')) return 'A session name can’t contain a comma: programs such as Excel would read it as two columns.';
  return null;
};

/**
 * The Study info screen every study opens on: what the study is, how to rate, where results go,
 * and the session name, which must be entered before Start rating. Resolves with the name, or
 * null for Back (to wherever the study was opened from).
 */
function infoPage(root: HTMLElement, study: OpenStudy, store: ResultsStore, lines: readonly string[], preset: string): Promise<string | null> {
  const back = el('button', { type: 'button', className: 'big back', textContent: '← Back' });
  const name = el('input', { id: 'rater', type: 'text', placeholder: 'Type a name to begin', autocomplete: 'off', spellcheck: false, value: preset });
  const nameNote = el('p', { className: 'field-note', hidden: true });
  const start = el('button', { type: 'submit', className: 'primary big', textContent: 'Start rating' });
  const form = el('form', { className: 'sess' }, [
    el('label', { htmlFor: 'rater', textContent: 'Session name' }),
    el('div', { className: 'row' }, [name, start]),
    nameNote,
  ]);
  root.replaceChildren(page([el('nav', { className: 'nav' }, [back]), el('section', { className: 'panel tone-rate study-head' }, [...studyInfo(study, store, lines), form])]));
  const check = () => {
    const problem = nameProblem(name.value);
    nameNote.hidden = problem === null || problem === 'empty';
    nameNote.textContent = problem && problem !== 'empty' ? problem : '';
    start.disabled = problem !== null;
  };
  name.addEventListener('input', check);
  check();
  name.focus();
  return new Promise((resolve) => {
    back.addEventListener('click', () => resolve(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!nameProblem(name.value)) resolve(name.value.trim());
    });
  });
}

/**
 * The rating screen: a slim bar (Back, which asks first; Study info; the player; Save and finish),
 * the instructions and the two boxes. Resolves with the rated box, or null if the rater left.
 */
function ratingPage(root: HTMLElement, study: OpenStudy, store: ResultsStore, lines: readonly string[], rater: string): Promise<string[] | null> {
  const r = study.references.length;
  return new Promise((resolve) => {
    const host = el('div', { className: 'page' });
    root.replaceChildren(host);
    window.scrollTo(0, 0);
    const session = runRating(
      host,
      audioItems(study.samples, 's:'),
      r ? audioItems(study.references, 'r:') : null,
      {
        ...ratingOptions(study.definition),
        instructions: study.definition.instructions,
        async onBack() {
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
        },
        onInfo() {
          // The same information, read-only: the session name is fixed once rating has started.
          const body = el('div', { className: 'study-info' }, [
            ...studyInfo(study, store, lines),
            el('p', { className: 'sess-fixed' }, ['Session name: ', el('strong', { textContent: rater })]),
          ]);
          void ask(body, [{ label: 'Return to rating', value: 'ok', primary: true }], 'Study info');
        },
      },
      async () => {
        if (raterUsed(lines, rater)) {
          return (await yesNo(`The session name “${rater}” has already been used for this study.\nAre you sure you want to continue?`)) === 'yes';
        }
        return true;
      },
    );
    void session.done.then(resolve);
  });
}

/**
 * The Save a copy step after a session whose results are kept in this browser: Share… (to Files,
 * email, AirDrop… where the browser can share files) or Download, or Not now. Escape doesn't
 * skip it; only Not now does. Resolves true if a copy was saved, which counts as a download.
 */
async function saveACopy(id: string, lines: readonly string[], fileName: string): Promise<boolean> {
  const file = new File([serializeLines(lines)], fileName, { type: 'text/csv' });
  const share = canShareFile(file);
  const advice = installAdvice();
  const body =
    `Your results are saved, but only in this browser on this device. Save a copy of ${fileName} now, ` +
    'so they are safe even if the browser’s data is cleared. It holds every session so far.' +
    (advice ? `\n\n${advice}` : '');
  for (;;) {
    const key = await ask(
      body,
      [
        ...(share ? [{ label: 'Share…', value: 'share' as const, primary: true }] : []),
        { label: 'Download', value: 'download' as const, primary: !share },
        { label: 'Not now', value: 'skip' as const },
      ],
      'Save a copy of your results',
      'again',
    );
    if (key === 'skip') return false;
    if (key === 'again') continue; // Escape: ask again rather than skip by accident
    if (key === 'share') {
      if (!(await shareFile(file, fileName))) continue; // cancelled: back to the choice
      await markDownloaded(id, lines.length).catch(() => {});
      return true;
    }
    await downloadStudyResults(id, lines, fileName); // exactly what was saved
    return true;
  }
}

/** Saves the results, offering retry / save elsewhere on failure (the old WriteRecentResults). Resolves with what happened. */
async function writeResults(store: ResultsStore, lines: string[], study: OpenStudy): Promise<string> {
  for (;;) {
    try {
      const committed = await store.commit(lines);
      const time = new Date().toLocaleTimeString();
      if (!store.inBrowser) return `Saved to ${store.where} at ${time}.`;
      void requestPersistence(); // ask the browser to keep NeAR's storage, now that it holds results
      const copied = await saveACopy(studyId(study.identity), committed, store.fileName);
      return (
        `Saved to this browser at ${time}. ` +
        (copied ? `A copy of ${store.fileName} was saved too.` : `Save a copy of ${store.fileName} from the Results page at any time.`)
      );
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
