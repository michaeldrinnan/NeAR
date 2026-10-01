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
import { CSV_FILE, buildHeader, buildRow, computeRanks, raterUsed } from '../lib/csv';
import { downloadLines, importBrowserResults, resultsFor, saveCopy } from '../lib/results';
import { alertBox, ask, yesNo, yesNoCancel } from './dialog';
import { runRating, type RatingOptions } from './rating';

const OPTIONS_KEY = 'near.options';

interface Settings extends RatingOptions {
  useRefs: boolean;
}

const defaults: Settings = {
  random: false,
  numbers: false,
  names: false,
  showCount: false,
  canLeave: false,
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

const CHECKBOXES: [keyof RatingOptions, string][] = [
  ['random', 'Present the audio samples in random order. Unticked, the samples are presented alphabetically by filename.'],
  ['numbers', 'Label each audio sample with a number, in the order the samples are first presented.'],
  ['names', 'Label each audio sample with its file name. This is probably not what you want.'],
  ['showCount', 'Show the number of times each sample has been played on its PLAY button.'],
  ['canLeave', 'Allow the rater to leave some audio samples unrated.'],
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

/** The start-settings screen (the old DlgStart form) and the session flow behind its Start button. */
export function showSetup(root: HTMLElement): void {
  const settings = loadSettings();

  root.innerHTML = `
    <form class="setup" novalidate>
      <fieldset class="panel tone-rose demo">
        <legend>New to NeAR?</legend>
        <div class="row"><button type="button" data-demo>Try with example files</button>
          <span>or <a href="./examples/NeAR-examples.zip" download>download them (.zip)</a> to use from a folder.</span></div>
      </fieldset>
      <fieldset class="panel tone-blue">
        <legend>Audio samples to rate</legend>
        <p>Choose the folder containing your audio files in WAV format.
          The results file <b>${CSV_FILE}</b> is kept ${canUseFolders ? 'in the same folder' : 'in this browser'}.</p>
        <div class="row">${pickButtons('samples')}</div>
        <p class="status" data-status="samples">No folder chosen.</p>
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
        ${canUseFolders ? '' : `
          <button type="button" data-download>Download ${CSV_FILE}</button>
          <button type="button" data-import>Import ${CSV_FILE}…</button>`}
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

  // ---- options ----
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    const box = q<HTMLInputElement>(`input[name="${key}"]`);
    box.checked = settings[key];
    box.addEventListener('change', () => {
      settings[key] = box.checked;
      saveSettings(settings);
      syncRefs();
    });
  }
  const syncRefs = () => form.querySelectorAll<HTMLElement>('.refs-only').forEach((el) => el.classList.toggle('disabled', !settings.useRefs));
  syncRefs();

  // ---- choosing files ----
  function setSource(kind: SourceKind, src: Source | null) {
    sources[kind] = src;
    const status = q<HTMLElement>(`[data-status="${kind}"]`);
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

  // ---- example files bundled with the app ----
  form.querySelector<HTMLButtonElement>('[data-demo]')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      const { samples, refs } = await loadExamples();
      setSource('samples', samples);
      setSource('refs', refs);
      const useRefs = q<HTMLInputElement>('input[name="useRefs"]');
      useRefs.checked = settings.useRefs = true;
      syncRefs();
      if (!raterInput.value) raterInput.value = 'Demo';
      saved.textContent = 'Example files loaded: press Start.';
    } catch (err) {
      await alertBox(`Couldn't load the example files. Are you offline?\n\n${(err as Error).message}`);
    } finally {
      btn.disabled = false;
    }
  });

  // ---- browser-kept results (no folder access) ----
  form.querySelector('[data-download]')?.addEventListener('click', async () => {
    const src = sources.samples;
    if (!src) return void alertBox('Choose the samples first; results are kept per samples folder.');
    const lines = await resultsFor(src).read();
    if (!lines) return void alertBox(`There are no results for “${src.label}” yet.`);
    downloadLines(lines, CSV_FILE);
  });
  const csvInput = q<HTMLInputElement>('[data-input-csv]');
  form.querySelector('[data-import]')?.addEventListener('click', () => {
    if (!sources.samples) return void alertBox('Choose the samples first; results are kept per samples folder.');
    csvInput.value = '';
    csvInput.click();
  });
  csvInput.addEventListener('change', async () => {
    const file = csvInput.files?.[0];
    const src = sources.samples;
    if (!file || !src) return;
    const ok = await yesNo(`Replace the results kept in this browser for “${src.label}” with “${file.name}”?`);
    if (ok === 'yes') {
      await importBrowserResults(src.label, file);
      saved.textContent = `Imported ${file.name}.`;
    }
  });

  setSource('samples', sources.samples);
  setSource('refs', sources.refs);
  raterInput.value = rater;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    rater = raterInput.value;
    void start();
  });

  // ---- the session (the old BtnStart_Click) ----
  async function start() {
    let samples = sources.samples;
    let refs = settings.useRefs ? sources.refs : null;

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
    if (settings.useRefs && !refs)
      return void alertBox("You've indicated you'd like to use some reference files.\nHowever, you haven't picked a folder.\nThere are no reference files!");
    if (refs && refs.items.length === 0)
      return void alertBox("You've indicated you'd like to use some reference files.\nHowever, the folder you picked has no WAV files in it.\nThere are no reference files!");
    if (rater.length === 0)
      return void alertBox('You need to identify the rating session in the white text box.\nThe results will be identified by what you type.');
    if (rater.includes(','))
      return void alertBox('Your rating session ID contains the comma character.\nThis will be misinterpreted by programs that include Microsoft Excel, and should be removed.');

    const store = resultsFor(samples);
    const header = buildHeader(samples.items.map((s) => s.name));

    let existing: string[] | null;
    try {
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
    const ratedBox = await runRating(root, samples.items, refs?.items ?? null, settings);
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
    showSetup(root);
    await writeResults(root, store, lines, samples.dir);
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
      await store.write(lines);
      status(`Saved to ${store.where} at ${new Date().toLocaleTimeString()}.`);
      if (store.inBrowser) {
        const key = await ask(
          `Your results have been saved in this browser.\n\nDownload an up-to-date copy of ${CSV_FILE} now?`,
          [
            { label: 'Download', value: 'yes', primary: true },
            { label: 'Not now', value: 'no' },
          ],
        );
        if (key === 'yes') downloadLines(lines, CSV_FILE);
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

/** Fetches the example set from public/examples/ (see scripts/make-examples.mjs). */
async function loadExamples(): Promise<{ samples: Source; refs: Source }> {
  const base = new URL('./examples/', document.baseURI);
  const get = async (path: string) => {
    const res = await fetch(new URL(path, base));
    if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
    return res;
  };
  const list = (await (await get('examples.json')).json()) as { samples: string[]; references: string[] };
  const files = (paths: string[]) =>
    Promise.all(
      paths.map(async (p) => new File([await (await get(p)).blob()], p.split('/').pop()!, { type: 'audio/wav' })),
    );
  const [samples, refs] = await Promise.all([files(list.samples), files(list.references)]);
  return {
    samples: { ...sourceFromFiles(samples, 'samples'), label: 'Example files' },
    refs: { ...sourceFromFiles(refs, 'refs'), label: 'Example references' },
  };
}
