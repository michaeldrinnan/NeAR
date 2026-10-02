import {
  canUseFolders,
  pickDirectory,
  readDirectory,
  rememberedDirectory,
  reopenDirectory,
  sourceFromFiles,
  type Source,
  type SourceKind,
} from '../lib/sources';
import { CSV_FILE, buildHeader, buildRow, computeRanks, parseLines, raterUsed, sameLines, summarize } from '../lib/csv';
import { downloadLines, importBrowserResults, resultsFor, saveCopy } from '../lib/results';
import { alertBox, ask, yesNo, yesNoCancel } from './dialog';
import { runRating, type RatingOptions } from './rating';
import { chooseStudy, recoverResults } from './studies';
import { discardIfEmpty, packageStudy, readStudy } from '../lib/studies';
import {
  compareWithKey,
  makeStudyZip,
  OPTION_KEYS,
  readStudyZip,
  sourceLabel,
  type OptionKey,
  type StudyDefinition,
  type StudyPackage,
} from '../lib/studyFormat';
import { stem } from '../lib/order';

const OPTIONS_KEY = 'near.options';

type Settings = Omit<RatingOptions, 'instructions'> & {
  useRefs: boolean;
};

const defaults: Settings = {
  random: false,
  numbers: false,
  names: false,
  showCount: false,
  canLeave: false,
  animate: true,
  useRefs: false,
};

function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(s));
  } catch {
    /* settings are a convenience only */
  }
}

const CHECKBOXES: [keyof Settings, string][] = [
  ['random', 'Present the audio samples in random order. Unticked, the samples are presented alphabetically by filename.'],
  ['numbers', 'Label each audio sample with a number, in the order the samples are first presented.'],
  ['names', 'Label each audio sample with its file name. This is probably not what you want.'],
  ['showCount', 'Show the number of times each sample has been played on its PLAY button.'],
  ['canLeave', 'Allow the rater to leave some audio samples unrated.'],
  ['animate', 'Animate the samples as they are dragged and dropped. Untick if movement on screen is uncomfortable.'],
];

const pickButtons = (kind: SourceKind) =>
  canUseFolders
    ? `<button type="button" data-pick="${kind}">Choose folder…</button>
       <button type="button" data-reopen="${kind}" hidden></button>`
    : `<button type="button" data-pick-folder="${kind}">Choose folder…</button>
       <button type="button" data-pick-files="${kind}">Choose files…</button>`;

// Chosen folders and the session name carry over from one session to the next, as in the original.
const sources: Record<SourceKind, Source | null> = { samples: null, refs: null };
let rater = '';
// Shared across replacement forms, through rating and the complete save/recovery flow.
let sessionBusy = false;

const SESSION_ACTIVE = 'A session is already active in another NeAR window. Finish or close it before continuing.';

/**
 * One NeAR operation at a time across every window and tab of this browser: reading results,
 * rating and saving, as well as imports, downloads, deletions and clean-up. The browser
 * releases the lock by itself if the window holding it closes or crashes. Browsers without
 * the Web Locks API fall back to the single-window guard plus commit()'s conflict check.
 */
async function withSessionLock(action: () => Promise<void>): Promise<'done' | 'busy'> {
  if (!navigator.locks) {
    await action();
    return 'done';
  }
  return navigator.locks.request('near-session', { ifAvailable: true }, async (lock) => {
    if (!lock) return 'busy' as const;
    await action();
    return 'done' as const;
  });
}
// Refreshes the "results kept in this browser" line on the current start screen.
let refreshKept: () => void = () => {};

// The study package currently loaded, if any (docs/study-format.md). Its fixed options are locked.
let loaded: StudyPackage | null = null;
// A ?study= link is opened once, when the app starts.
let linkChecked = false;

/** The bundled example files, as a built-in study package. */
const EXAMPLE_STUDY_URL = 'examples/NeAR-examples.zip';

/** The settings a session actually uses: the user's, with a loaded study's fixed options on top. */
function effectiveSettings(settings: Settings): Settings {
  if (!loaded) return settings;
  const s: Settings = { ...settings, useRefs: loaded.references.length > 0 };
  for (const [key, option] of Object.entries(OPTION_KEYS) as [OptionKey, keyof Settings][]) {
    const fixed = loaded.definition.options[key];
    if (fixed !== undefined) (s[option] as boolean) = fixed;
  }
  return s;
}

/** Which start-screen boxes a loaded study fixes. */
function lockedSettings(): Set<keyof Settings> {
  const locked = new Set<keyof Settings>();
  if (!loaded) return locked;
  locked.add('useRefs'); // references are used exactly when the package has RefItems
  for (const [key, option] of Object.entries(OPTION_KEYS) as [OptionKey, keyof Settings][]) {
    if (loaded.definition.options[key] !== undefined) locked.add(option);
  }
  return locked;
}

/** After a session: the rater's order beside the study's answer key, with Spearman's rho. */
async function showAnswers(pkg: StudyPackage, ratedBox: readonly string[]) {
  const order = ratedBox.filter((id) => id.startsWith('s:')).map((id) => stem(id.slice(2)));
  const key = pkg.definition.answerKey;
  const { rho, n } = compareWithKey(order, key);
  const left = key.filter((k) => !order.includes(k));
  await ask(
    `How your order compares with the answer key for “${pkg.definition.title}”:\n\n` +
      `Your order (best first):  ${order.join(', ') || '(none rated)'}\n` +
      `Answer key (best first):  ${key.join(', ')}\n\n` +
      (rho === null
        ? 'Too few samples were rated to compare.'
        : `Agreement (Spearman's rank correlation): ${rho.toFixed(2)}, over ${n} samples.`) +
      (left.length ? `\nUnrated samples were left out: ${left.join(', ')}.` : ''),
    [{ label: 'OK', value: 'ok', primary: true }],
    'Answer key',
  );
}

/** The start-settings screen (the old DlgStart form) and the session flow behind its Start button. */
export function showSetup(root: HTMLElement): void {
  const settings = loadSettings();

  root.innerHTML = `
    <form class="setup" novalidate>
      <fieldset class="panel tone-rose demo">
        <legend>New to NeAR?</legend>
        <div class="row"><button type="button" data-demo>Try with example files</button>
          <a class="button" href="./manual/NeAR-user-manual.pdf" target="_blank" rel="noopener">Read the user manual</a></div>
        <p class="status">You can also <a href="./examples/NeAR-examples.zip" download>download the example study (.zip)</a> to open later or share.</p>
      </fieldset>
      <fieldset class="panel tone-green" data-study-panel>
        <legend>Study</legend>
        <p class="status" data-loaded>No study loaded: choose your own files below, or open a ready-made study (.zip).</p>
        <p class="status warnings" data-warnings hidden></p>
        <div class="row">
          <button type="button" data-open-study>Open study…</button>
          <button type="button" data-save-study>Save as study…</button>
          <button type="button" data-close-study hidden>Close study</button>
        </div>
        <input type="file" data-input-study hidden accept=".zip,application/zip">
      </fieldset>
      <fieldset class="panel tone-blue">
        <legend>Audio samples to rate</legend>
        <p>Choose the folder containing your audio files in WAV format.
          The results file <b>${CSV_FILE}</b> is kept ${canUseFolders ? 'in the same folder' : 'in this browser'}.</p>
        <div class="row">${pickButtons('samples')}</div>
        <p class="status" data-status="samples">No folder chosen.</p>
        <p class="status kept" data-kept hidden></p>
        <div class="row"><button type="button" data-study hidden>Choose study…</button>
          <button type="button" data-recover>Recover older results…</button></div>
      </fieldset>

      <fieldset class="panel tone-teal">
        <legend>Reference samples (optional)</legend>
        <label class="check"><input type="checkbox" name="useRefs">
          <span>Use reference audio files. They are displayed in alphanumeric order (0…9, A…Z) and their order
          cannot be changed; name them so the best comes first. Untick the box if you don't want any references.</span></label>
        <div class="row refs-only">${pickButtons('refs')}</div>
        <p class="status refs-only" data-status="refs">No folder chosen.</p>
      </fieldset>

      <fieldset class="panel tone-purple">
        <legend>Rating options</legend>
        ${CHECKBOXES.map(([k, text]) => `<label class="check"><input type="checkbox" name="${k}"><span>${text}</span></label>`).join('')}
      </fieldset>

      <fieldset class="panel tone-amber">
        <legend>Rating session</legend>
        <label for="rater">Enter a name to identify this rating session. The results of all rating sessions are
          written to ${CSV_FILE}, which can be opened in Excel or any statistics package; the text you enter
          here identifies this session.</label>
        <input id="rater" name="rater" autocomplete="off" spellcheck="false">
      </fieldset>

      <div class="actions">
        <button type="submit" class="primary start">Start</button>
        <span class="saved" aria-live="polite"></span>
        <span class="spacer"></span>
        <button type="button" data-download ${canUseFolders ? 'hidden' : ''}>Download ${CSV_FILE}</button>
        <button type="button" data-import ${canUseFolders ? 'hidden' : ''}>Import ${CSV_FILE}…</button>
      </div>
      ${canUseFolders ? '' : `<p class="note">This browser can't save into folders, so results are kept in this
        browser. Download ${CSV_FILE} after your sessions to keep a copy, or use Chrome or Edge on a computer to
        write ${CSV_FILE} straight into the samples folder.</p>`}
      <input type="file" data-input-folder hidden webkitdirectory multiple>
      <input type="file" data-input-files hidden multiple accept=".wav,audio/wav,audio/x-wav">
      <input type="file" data-input-csv hidden accept=".csv,text/csv">
    </form>`;

  const form = root.querySelector<HTMLFormElement>('form')!;
  const q = <T extends Element>(sel: string) => form.querySelector<T>(sel)!;
  const saved = q<HTMLElement>('.saved');
  const raterInput = q<HTMLInputElement>('#rater');

  form.inert = sessionBusy;
  q<HTMLButtonElement>('.start').disabled = sessionBusy;
  async function exclusive(action: () => Promise<void>) {
    if (sessionBusy) return;
    sessionBusy = true;
    form.inert = true;
    q<HTMLButtonElement>('.start').disabled = true;
    try {
      if ((await withSessionLock(action)) === 'busy') await alertBox(SESSION_ACTIVE);
    } catch (e) {
      await alertBox(`Couldn't complete this action.\n\n${(e as Error).message}`);
    } finally {
      sessionBusy = false;
      const current = root.querySelector<HTMLFormElement>('form');
      if (current) {
        current.inert = false;
        current.querySelector<HTMLButtonElement>('.start')!.disabled = false;
      }
    }
  }
  // The study created by the Start currently in progress, if any (and only if it created one).
  let createdByStart: string | undefined;
  async function ensureStudy(src: Source, forStart = false): Promise<boolean> {
    if (src.dir || src.studyId) return true;
    const chosen = await chooseStudy(src);
    if (forStart && chosen && chosen.created) createdByStart = src.studyId;
    if (sources.samples === src) await showKept(src);
    return !!chosen;
  }
  q<HTMLButtonElement>('[data-study]').addEventListener('click', () => void exclusive(async () => {
    const src = sources.samples;
    if (src && !src.dir) {
      await chooseStudy(src);
      await showKept(src); // also after a deletion, even if the chooser was then cancelled
    }
  }));
  q<HTMLButtonElement>('[data-recover]').addEventListener('click', () => void exclusive(async () => {
    if (await recoverResults(sources.samples)) refreshKept();
  }));

  // ---- options ----
  // A loaded study's fixed options are shown as set, greyed out and marked; the rest stay the user's.
  const locked = lockedSettings();
  const shown = effectiveSettings(settings);
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    const box = q<HTMLInputElement>(`input[name="${key}"]`);
    box.checked = shown[key];
    if (locked.has(key)) {
      box.disabled = true;
      // Inside the label's text, so the note flows with it.
      box.closest('label')!.querySelector('span')!.append(Object.assign(document.createElement('span'), { className: 'locked-note', textContent: ' (set by this study)' }));
      continue;
    }
    box.addEventListener('change', () => {
      settings[key] = box.checked;
      saveSettings(settings);
      syncRefs();
    });
  }
  const syncRefs = () =>
    form.querySelectorAll<HTMLElement>('.refs-only').forEach((el) => el.classList.toggle('disabled', !effectiveSettings(settings).useRefs));
  syncRefs();

  // ---- choosing files ----
  /** Browser-only mode: say what is already kept in this browser for the chosen study. */
  refreshKept = () => {
    if (sources.samples) void showKept(sources.samples);
  };

  async function showKept(src: Source) {
    const kept = q<HTMLElement>('[data-kept]');
    q<HTMLButtonElement>('[data-study]').hidden = !!src.dir || !!loaded; // a loaded study has its own results
    q<HTMLButtonElement>('[data-download]').hidden = !!src.dir;
    q<HTMLButtonElement>('[data-import]').hidden = !!src.dir;
    if (!src.dir && !src.studyId) {
      kept.hidden = false;
      kept.textContent = 'Choose a study before starting. To retrieve results from an older version, use Recover older results.';
      return;
    }
    const store = resultsFor(src);
    kept.hidden = !store.inBrowser;
    if (!store.readStored) return;
    let stored: string[] | null;
    let studyName = src.label;
    try {
      if (src.studyId) studyName = (await readStudy(src.studyId)).name;
      stored = await store.readStored();
    } catch {
      kept.textContent = 'The results kept in this browser for this study could not be read.';
      return;
    }
    if (sources.samples !== src) return; // a different folder was chosen meanwhile
    const { sessions, last } = summarize(stored);
    kept.textContent = sessions
      ? `Results kept in this browser for “${studyName}”: ${sessions} session${sessions === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}.`
      : `No results kept in this browser for “${studyName}” yet.`;
  }

  function setSource(kind: SourceKind, src: Source | null) {
    sources[kind] = src;
    const status = q<HTMLElement>(`[data-status="${kind}"]`);
    if (kind === 'samples' && !src) q<HTMLElement>('[data-kept]').hidden = true;
    if (!src) {
      status.textContent = 'No folder chosen.';
      return;
    }
    const n = src.items.length;
    status.textContent =
      kind === 'samples'
        ? `Rating ${n} WAV file${n === 1 ? '' : 's'} in “${src.label}”.`
        : `Using ${n} WAV file${n === 1 ? '' : 's'} as reference in “${src.label}”.`;
    if (kind === 'samples' && src.csv) status.textContent += ` Found ${CSV_FILE} there.`;
    if (kind === 'samples') void showKept(src);
    const reopen = form.querySelector<HTMLElement>(`[data-reopen="${kind}"]`);
    if (reopen) reopen.hidden = true;
  }

  form.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.pick as SourceKind;
      try {
        const src = await pickDirectory(kind);
        if (src) setSource(kind, src);
      } catch (e) {
        await alertBox(`Couldn't open that folder.\n\n${(e as Error).message}`);
      }
    }),
  );

  // Offer to reconnect to the folders used last time (the browser needs a click to grant access again).
  for (const kind of ['samples', 'refs'] as SourceKind[]) {
    const btn = form.querySelector<HTMLButtonElement>(`[data-reopen="${kind}"]`);
    if (!btn) continue;
    void rememberedDirectory(kind).then(async (dir) => {
      if (!dir || sources[kind]) return;
      const src = await reopenDirectory(dir, kind, false).catch(() => null);
      if (src) return setSource(kind, src);
      btn.textContent = `Use “${dir.name}” again`;
      btn.hidden = false;
      btn.onclick = async () => {
        try {
          const again = await reopenDirectory(dir, kind, true);
          if (again) setSource(kind, again);
        } catch (e) {
          await alertBox(`Couldn't open “${dir.name}”. Has it been moved or deleted?\n\n${(e as Error).message}`);
        }
      };
    });
  }

  let pendingKind: SourceKind = 'samples';
  const folderInput = q<HTMLInputElement>('[data-input-folder]');
  const filesInput = q<HTMLInputElement>('[data-input-files]');
  for (const [attr, input] of [['pickFolder', folderInput], ['pickFiles', filesInput]] as const) {
    form.querySelectorAll<HTMLButtonElement>(`[data-${attr === 'pickFolder' ? 'pick-folder' : 'pick-files'}]`).forEach((btn) =>
      btn.addEventListener('click', () => {
        pendingKind = btn.dataset[attr] as SourceKind;
        input.value = '';
        input.click();
      }),
    );
    input.addEventListener('change', () => {
      if (input.files?.length) setSource(pendingKind, sourceFromFiles(input.files, pendingKind));
    });
  }

  // ---- study packages (docs/study-format.md) ----
  /** Makes a study package the current set-up: its files, its own results, its fixed options. */
  async function usePackage(pkg: StudyPackage, message: string) {
    const samples: Source = { ...sourceFromFiles(pkg.samples, 'samples'), label: sourceLabel(pkg) };
    const refs: Source | null = pkg.references.length ? { ...sourceFromFiles(pkg.references, 'refs'), label: 'RefItems' } : null;
    const { title, version } = pkg.definition;
    samples.studyId = (await packageStudy(samples, pkg.identity, `${title} v${version}`)).id;
    loaded = pkg;
    sources.samples = samples;
    sources.refs = refs;
    rater = raterInput.value;
    showSetup(root); // redraw with the study's settings locked
    const status = root.querySelector<HTMLElement>('.saved');
    if (status) status.textContent = message;
  }

  async function openPackage(read: () => Promise<Uint8Array>, failure: string, message: string) {
    try {
      await usePackage(await readStudyZip(await read()), message);
    } catch (e) {
      await alertBox(`${failure}\n\n${(e as Error).message}`);
    }
  }

  /** Opens a study from a web address (a ?study= link, or a file on this site). */
  const openFromUrl = (url: string, failure: string, message: string) =>
    openPackage(
      async () => {
        const res = await fetch(new URL(url, document.baseURI));
        if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      failure,
      message,
    );

  form.querySelector<HTMLButtonElement>('[data-demo]')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    if (!raterInput.value) raterInput.value = 'Demo';
    await openFromUrl(EXAMPLE_STUDY_URL, "Couldn't load the example files. Are you offline?", 'Example files loaded: press Start.');
    btn.disabled = false;
  });

  const studyInput = q<HTMLInputElement>('[data-input-study]');
  q<HTMLButtonElement>('[data-open-study]').addEventListener('click', () => {
    studyInput.value = '';
    studyInput.click();
  });
  studyInput.addEventListener('change', () => {
    const file = studyInput.files?.[0];
    if (file) void openPackage(async () => new Uint8Array(await file.arrayBuffer()), `Couldn't open “${file.name}” as a study.`, 'Study loaded: press Start.');
  });

  q<HTMLButtonElement>('[data-close-study]').addEventListener('click', () => {
    loaded = null;
    sources.samples = sources.refs = null;
    rater = raterInput.value;
    showSetup(root);
  });

  q<HTMLButtonElement>('[data-save-study]').addEventListener('click', () => void saveAsStudy());

  /** Writes the current set-up (files, references, every rating option fixed) as a study .zip. */
  async function saveAsStudy() {
    const samples = sources.samples;
    if (loaded) return void alertBox('This set-up is already a study. Close it first to save a new one.');
    if (!samples?.items.length) return void alertBox('Choose the audio samples first.');
    const body = document.createElement('div');
    body.className = 'study-form';
    const label = Object.assign(document.createElement('label'), { textContent: 'Study title' });
    const title = Object.assign(document.createElement('input'), { value: samples.label === 'Selected files' ? '' : samples.label });
    label.append(title);
    const instructions = Object.assign(document.createElement('label'), { textContent: 'Instructions for raters (optional)' });
    const text = Object.assign(document.createElement('textarea'), { rows: 3 });
    instructions.append(text);
    body.append(
      label,
      instructions,
      Object.assign(document.createElement('p'), {
        textContent:
          'The study will contain copies of the audio files and fix every rating option as it is set now. ' +
          'You can edit study.txt in the zip afterwards, e.g. to leave options for raters to choose.',
      }),
    );
    for (;;) {
      const answer = await ask(body, [
        { label: 'Save study', value: 'save' as const, primary: true },
        { label: 'Cancel', value: 'cancel' as const },
      ], 'Save as study');
      if (answer === 'cancel') return;
      if (!title.value.trim()) {
        await alertBox('Enter a title for the study.');
        continue;
      }
      break;
    }
    const s = effectiveSettings(settings);
    const def: StudyDefinition = {
      title: title.value.trim(),
      version: '1',
      instructions: text.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      options: Object.fromEntries((Object.entries(OPTION_KEYS) as [OptionKey, keyof Settings][]).map(([k, o]) => [k, s[o] as boolean])),
      answerKey: [],
      showAnswers: false,
    };
    try {
      const files = (src: Source | null) =>
        Promise.all((src?.items ?? []).map(async (i) => new File([await i.getFile()], i.name, { type: 'audio/wav' })));
      const zip = await makeStudyZip(def, await files(samples), s.useRefs ? await files(sources.refs) : []);
      const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `${def.title.replace(/[\\/:*?"<>|]/g, '_')}.zip` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      saved.textContent = `Saved the study “${def.title}”.`;
    } catch (e) {
      await alertBox(`Couldn't save the study.\n\n${(e as Error).message}`);
    }
  }

  // The study panel: what's loaded, and the folder buttons locked while a study supplies the files.
  if (loaded) {
    const { title, version } = loaded.definition;
    q<HTMLElement>('[data-loaded]').textContent =
      `Study: “${title}”, version ${version} (#${loaded.identity.slice(0, 8)}). Its files are used, and settings marked “set by this study” are fixed.`;
    if (loaded.warnings.length) {
      q<HTMLElement>('[data-warnings]').textContent = loaded.warnings.join(' ');
      q<HTMLElement>('[data-warnings]').hidden = false;
    }
    q<HTMLButtonElement>('[data-close-study]').hidden = false;
    q<HTMLButtonElement>('[data-save-study]').hidden = true;
    form
      .querySelectorAll<HTMLButtonElement>('[data-pick], [data-pick-folder], [data-pick-files], [data-reopen]')
      .forEach((b) => (b.disabled = true));
  }

  // ---- browser-kept results (no folder access) ----
  form.querySelector('[data-download]')?.addEventListener('click', () => void exclusive(async () => {
    const src = sources.samples;
    if (!src) return void alertBox('Choose the samples first; results are kept per samples folder.');
    if (!await ensureStudy(src)) return;
    let lines: string[] | null;
    try {
      lines = await resultsFor(src).read();
    } catch (e) {
      return void alertBox(`The results kept in this browser could not be read.

${(e as Error).message}`);
    }
    if (!lines) return void alertBox(`There are no results for “${src.label}” yet.`);
    downloadLines(lines, CSV_FILE);
  }));
  const csvInput = q<HTMLInputElement>('[data-input-csv]');
  form.querySelector('[data-import]')?.addEventListener('click', () => {
    if (!sources.samples) return void alertBox('Choose the samples first; results are kept per samples folder.');
    csvInput.value = '';
    csvInput.click();
  });
  csvInput.addEventListener('change', () => void exclusive(async () => {
    const file = csvInput.files?.[0];
    const src = sources.samples;
    if (!file || !src) return;
    if (!await ensureStudy(src)) return;
    const ok = await yesNo(`Replace the results kept in this browser for “${src.label}” with “${file.name}”?`);
    if (ok === 'yes') {
      await importBrowserResults(src, file);
      saved.textContent = `Imported ${file.name}.`;
      void showKept(src);
    }
  }));

  setSource('samples', sources.samples);
  setSource('refs', sources.refs);
  raterInput.value = rater;
  const afterSession: { run?: () => Promise<void> } = {};
  const takeAfterSession = () => {
    const run = afterSession.run;
    afterSession.run = undefined;
    return run;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    afterSession.run = undefined;
    await exclusive(async () => {
      rater = raterInput.value;
      const samples = sources.samples;
      createdByStart = undefined;
      try {
        await start();
      } finally {
        // A study this Start created, for a session that was then abandoned, is removed again.
        // Studies that already existed are never touched, even if they are empty.
        const created = createdByStart;
        createdByStart = undefined;
        if (created && (await discardIfEmpty(created).catch(() => false))) {
          if (samples?.studyId === created) samples.studyId = undefined;
          refreshKept();
        }
      }
    });
    const run = takeAfterSession();
    await run?.();
  });

  // ---- the session (the old BtnStart_Click) ----
  async function start() {
    const study = loaded;
    const session = effectiveSettings(settings); // a loaded study's fixed options win
    let samples = sources.samples;
    let refs = session.useRefs ? sources.refs : null;

    // Re-read the folders in case files were added or removed since they were chosen.
    try {
      if (samples?.dir) setSource('samples', (samples = await readDirectory(samples.dir, 'samples')));
      if (refs?.dir) setSource('refs', (refs = await readDirectory(refs.dir, 'refs')));
    } catch (e) {
      return void alertBox(`Couldn't read the folder.\n\n${(e as Error).message}`);
    }

    if (!samples)
      return void alertBox("Either you haven't picked a folder, or the one you picked doesn't exist.\nThere's no task for the raters!");
    if (samples.items.length === 0)
      return void alertBox("The folder you picked has no WAV files in it.\nThere's no task for the raters!");
    if (session.useRefs && !refs)
      return void alertBox("You've indicated you'd like to use some reference files.\nHowever, you haven't picked a folder.\nThere are no reference files!");
    if (refs && refs.items.length === 0)
      return void alertBox("You've indicated you'd like to use some reference files.\nHowever, the folder you picked has no WAV files in it.\nThere are no reference files!");
    if (rater.length === 0)
      return void alertBox('You need to identify the rating session in the white text box.\nThe results will be identified by what you type.');
    if (rater.includes(','))
      return void alertBox('Your rating session ID contains the comma character.\nThis will be misinterpreted by programs that include Microsoft Excel, and should be removed.');

    if (!await ensureStudy(samples, true)) return;
    const store = resultsFor(samples);
    const header = buildHeader(samples.items.map((s) => s.name));

    let existing: string[] | null;
    try {
      const choice = await chooseCopy(store, samples);
      if (choice === 'cancel') return;
      existing = await store.read();
    } catch {
      return void alertBox(
        `The results file exists, but could not be read:\n\n  ${store.where}\n\n` +
          'Is the file being used by another program?\nIn any case, you need to deal with the problem before you can continue.',
      );
    }

    let lines: string[];
    if (!existing || existing.length === 0) {
      lines = [header];
    } else if (existing[0] !== header) {
      for (;;) {
        const key = await yesNoCancel(
          'The audio files in this folder have changed since the last session.\n' +
            `The results file '${CSV_FILE}' needs to be reset to represent the new files.\n\n` +
            `Would you like to save the existing results in '${CSV_FILE}' under a different name?\n\n` +
            'Choose YES to save under a different name.\n' +
            'Choose NO and you will LOSE YOUR DATA.\n' +
            'CANCEL to abandon the rating session you were about to start. You will keep your data.',
        );
        if (key === 'cancel') return;
        if (key === 'no') break;
        if (await saveCopy(existing, 'NeAR old results.csv', samples.dir)) break;
      }
      lines = [header];
    } else {
      lines = existing;
    }

    if (raterUsed(lines, rater) && (await yesNo('It seems this rater ID has already been used.\nAre you sure you want to continue?')) === 'no')
      return;

    // ---- rate ----
    const ratedBox = await runRating(root, samples.items, refs?.items ?? null, { ...session, instructions: study?.definition.instructions });
    lines.push(
      buildRow({
        rater,
        when: new Date(), // time the session finished, as before
        source: samples.label,
        reference: refs ? refs.label : null,
        nrefs: refs?.items.length ?? 0,
        ranks: computeRanks(samples.items.map((s) => s.id), ratedBox),
      }),
    );
    root.innerHTML = '<section aria-live="polite"><p>Saving results…</p><p class="saved"></p></section>';
    const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnOnLeave);
    try {
      await writeResults(root, store, lines, samples.dir);
    } finally {
      window.removeEventListener('beforeunload', warnOnLeave);
    }
    const message = root.querySelector<HTMLElement>('.saved')?.textContent ?? '';
    showSetup(root);
    root.querySelector<HTMLElement>('.saved')!.textContent = message;
    refreshKept();
    // Shown once the session (and its lock) is over, so other windows aren't kept waiting.
    if (study?.definition.showAnswers && study.definition.answerKey.length) afterSession.run = () => showAnswers(study, ratedBox);
  }

  // A ?study=<address of a .zip> link opens that study once, when NeAR starts.
  if (!linkChecked) {
    linkChecked = true;
    const link = new URLSearchParams(location.search).get('study');
    if (link) void openFromUrl(link, `Couldn't open the study at ${link}. The server holding it may not allow downloads from other web sites.`, 'Study loaded: press Start.');
  }
}

/** Saves the results, offering retry / save elsewhere on failure (the old WriteRecentResults). */
async function writeResults(
  root: HTMLElement,
  store: ReturnType<typeof resultsFor>,
  lines: string[],
  dir: FileSystemDirectoryHandle | undefined,
) {
  const status = (text: string) => {
    const el = root.querySelector<HTMLElement>('.saved');
    if (el) el.textContent = text;
  };
  for (;;) {
    try {
      let committed: readonly string[] = lines;
      if (store.commit) committed = await store.commit(lines);
      else await store.write(lines);
      status(`Saved to ${store.where} at ${new Date().toLocaleTimeString()}.`);
      if (store.inBrowser) {
        const key = await ask(
          `Your results have been saved in this browser.\n\nDownload an up-to-date copy of ${CSV_FILE} now?`,
          [
            { label: 'Download', value: 'yes', primary: true },
            { label: 'Not now', value: 'no' },
          ],
        );
        if (key === 'yes') downloadLines(committed, CSV_FILE); // exactly what was saved
      }
      return;
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
      if (key === 'cancel') return status('Results were NOT saved.');
      if (key === 'no') {
        const name = await saveCopy(lines, 'NeAR temporary results.csv', dir);
        if (name) {
          status(`Saved a copy to ${name}.`);
          await alertBox(
            'PLEASE NOTE: You have saved an entire copy of your results to a temporary file. ' +
              'This file will NOT be used in future ratings.\n' +
              `Before your next session, you should make sure '${CSV_FILE}' is up-to-date.\n\n` +
              'You can do this in one of two ways:\n' +
              ` - Replace '${CSV_FILE}' with the temporary file;\n` +
              ` - Copy the new results from the last line of the temporary file to the end of '${CSV_FILE}'.`,
          );
          return;
        }
      }
    }
  }
}

/**
 * Browser-only mode: if the chosen folder has a NeAR.csv and this browser also
 * keeps results for the same study, and the two differ, ask which to carry on
 * with rather than silently preferring the browser's copy. Choosing the folder's
 * file replaces the browser's copy (which can be downloaded first).
 */
async function chooseCopy(store: ReturnType<typeof resultsFor>, samples: Source): Promise<'ok' | 'cancel'> {
  if (!store.readStored || !samples.csv) return 'ok';
  const stored = await store.readStored();
  if (!stored) return 'ok';
  const folder = parseLines(await samples.csv.text());
  if (sameLines(stored, folder)) return 'ok';
  const describe = (lines: string[]) => {
    const { sessions, last } = summarize(lines);
    return `${sessions} session${sessions === 1 ? '' : 's'}${last ? `, last on ${last}` : ''}`;
  };
  for (;;) {
    const key = await ask(
      'There are two different copies of the results for this study:\n\n' +
        `  • ${CSV_FILE} in the folder you chose: ${describe(folder)}\n` +
        `  • the copy kept in this browser: ${describe(stored)}\n\n` +
        'Which one should NeAR carry on with? If you choose the folder’s file, the copy kept in this browser is ' +
        'replaced, so download it first if you might need it.',
      [
        { label: 'Use the folder’s file', value: 'folder' as const },
        { label: 'Use this browser’s copy', value: 'browser' as const, primary: true },
        { label: 'Download browser’s copy', value: 'download' as const },
        { label: 'Cancel', value: 'cancel' as const },
      ],
    );
    if (key === 'cancel') return 'cancel';
    if (key === 'browser') return 'ok';
    if (key === 'download') {
      downloadLines(stored, 'NeAR browser copy.csv');
      continue;
    }
    await store.write(folder);
    return 'ok';
  }
}
