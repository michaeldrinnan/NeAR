import { parseLines, summarize } from '../lib/csv';
import { downloadBlob } from '../lib/results';
import { canUseFolders, filesEntries, folderEntries, pickStudyFolder, type OpenStudy } from '../lib/sources';
import {
  baseName,
  defaultDefinition,
  fileHashes,
  formatNote,
  identityOf,
  layoutProblem,
  layoutStudy,
  makeStudyZip,
  parseStudyText,
  STUDY_FILE,
  studyCode,
  studyFileName,
  StudyFormatError,
  tidyTitle,
  titleFromName,
  titleProblem,
  TITLE_MAX,
  writeStudyText,
  type OptionKey,
  type StudyDefinition,
  type StudyEntry,
  type StudyLayout,
} from '../lib/studyFormat';
import { alertBox } from './dialog';
import { backNav, el, page } from './page';

const OPTION_LABELS: [OptionKey, string][] = [
  ['random', 'Random order'],
  ['numbers', 'Number labels'],
  ['names', 'File name labels'],
  ['leave_unrated', 'Allow samples left unrated'],
  ['play_count', 'Show play counts'],
];

/** The study folder chosen on the Create page. Kept while NeAR is open, so Try it now can come back to it. */
interface Chosen {
  name: string;
  /** Chrome/Edge: the folder itself, so Save can write study.txt into it. */
  dir?: FileSystemDirectoryHandle;
  layout: StudyLayout;
  samples: File[];
  references: File[];
  results: File[];
  /** Why the folder can't be a study; nothing else is available until it's fixed. */
  problem: string | null;
  /** A mistake in study.txt, until the user chooses to start from the defaults. */
  textError: string | null;
  warnings: string[];
  /** Identity of the study as saved in study.txt, if it has one. */
  savedIdentity: string | null;
  hashes: Promise<{ test: [string, string][]; ref: [string, string][] }>;
}

let chosen: Chosen | null = null;
let draft: StudyDefinition | null = null;
let message = '';

export function showCreate(root: HTMLElement, back: () => void, tryStudy: (study: OpenStudy) => void): void {
  const render = () => showCreate(root, back, tryStudy);

  // ---- step 1: the folder ----
  const pick = el('button', { type: 'button', className: 'primary', textContent: 'Choose study folder…' });
  const filesInput = el('input', { type: 'file', hidden: true, multiple: true });
  filesInput.webkitdirectory = true;
  pick.addEventListener('click', async () => {
    if (!canUseFolders) {
      filesInput.value = '';
      filesInput.click();
      return;
    }
    let dir: FileSystemDirectoryHandle | null;
    try {
      dir = await pickStudyFolder();
      if (!dir) return;
      pick.disabled = true;
      await choose(dir.name, await folderEntries(dir), dir);
    } catch (e) {
      await alertBox(`Couldn't open that folder.\n\n${(e as Error).message}`);
    }
    render();
  });
  filesInput.addEventListener('change', async () => {
    if (!filesInput.files?.length) return;
    const { name, entries } = filesEntries(filesInput.files);
    pick.disabled = true;
    try {
      await choose(name, entries);
    } catch (e) {
      await alertBox(`Couldn't read that folder.\n\n${(e as Error).message}`);
    }
    render();
  });

  const ready = !!chosen && !chosen.problem && !chosen.textError && !!draft;
  const step = (n: number, title: string, body: Node[], enabled = true) =>
    el('div', { className: enabled ? 'step' : 'step needs', 'aria-disabled': String(!enabled) }, [
      el('span', { className: 'n', textContent: String(n) }),
      el('div', { className: 'b' }, [el('h2', { textContent: title }), ...body]),
    ]);

  const found = chosen ? foundBox(chosen, render) : null;
  const step1 = step(1, 'Study folder', [
    el('p', { className: 'note' }, [
      'Put the voices to rate in a ', el('span', { className: 'mono', textContent: 'Test' }),
      ' sub-folder and any reference voices in a ', el('span', { className: 'mono', textContent: 'Ref' }),
      ' sub-folder, then choose the folder that contains them. To edit a study, choose its folder again.',
    ]),
    el('div', { className: 'row' }, [pick, filesInput]),
    ...(found ? [found] : []),
  ]);

  // ---- step 2: options ----
  const def = draft ?? defaultDefinition('');
  const segs = OPTION_LABELS.map(([key, label]) => {
    const on = el('button', { type: 'button', textContent: 'On', 'aria-pressed': String(def.options[key]) });
    const off = el('button', { type: 'button', textContent: 'Off', 'aria-pressed': String(!def.options[key]) });
    const set = (value: boolean) => {
      def.options[key] = value;
      on.setAttribute('aria-pressed', String(value));
      off.setAttribute('aria-pressed', String(!value));
      changed();
    };
    on.addEventListener('click', () => set(true));
    off.addEventListener('click', () => set(false));
    return el('div', { className: 'opt' }, [
      el('span', { textContent: label }),
      el('span', { className: 'seg', role: 'group', 'aria-label': label, 'data-option': key }, [on, off]),
    ]);
  });
  const step2 = step(2, 'Options', [el('p', { className: 'note', textContent: 'Every option is fixed for the study; raters can’t change them.' }), ...segs], ready);

  // ---- step 3: title and instructions ----
  const title = el('input', { id: 'study-title', className: 'ftitle', type: 'text', value: def.title, maxLength: TITLE_MAX + 20, autocomplete: 'off' });
  const titleNote = el('p', { className: 'field-note', hidden: true });
  const instructions = el('textarea', { id: 'study-instructions', className: 'finstr', rows: 3, value: def.instructions.join('\n') });
  title.addEventListener('input', () => {
    def.title = tidyTitle(title.value);
    changed();
  });
  instructions.addEventListener('input', () => {
    def.instructions = instructions.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    changed();
  });
  const step3 = step(3, 'Title and instructions', [
    el('label', { className: 'flabel', htmlFor: 'study-title', textContent: 'Study title' }),
    title,
    titleNote,
    el('label', { className: 'flabel', htmlFor: 'study-instructions', textContent: 'Instructions shown to raters' }),
    instructions,
  ], ready);

  // ---- the study code, and the buttons ----
  const codeLine = el('p', { className: 'note code-line', hidden: !ready });
  const save = el('button', { type: 'button', className: 'primary', textContent: 'Save', disabled: true });
  const zip = el('button', { type: 'button', textContent: 'Save as zip…', disabled: true });
  const tryIt = el('button', { type: 'button', textContent: 'Try it now', disabled: true });
  const status = el('p', { className: 'note status', 'aria-live': 'polite', textContent: ready ? message : 'Choose a study folder to continue.' });

  let identity: string | null = null;
  let version = 0;
  async function changed() {
    const problem = ready ? titleProblem(title.value) : 'not ready';
    titleNote.hidden = !ready || !problem;
    titleNote.textContent = ready && problem ? problem : '';
    for (const b of [save, zip, tryIt]) b.disabled = !!problem;
    if (!ready || problem || !chosen) {
      identity = null;
      codeLine.textContent = problem && ready ? 'Correct the title to see the study code.' : '';
      return;
    }
    const mine = ++version;
    const { test, ref } = await chosen.hashes;
    const id = await identityOf(def, test, ref);
    if (mine !== version) return; // a later change has taken over
    identity = id;
    const code = studyCode(id);
    const state =
      chosen.savedIdentity === id
        ? 'Saved in study.txt.'
        : chosen.savedIdentity
          ? 'Changed since study.txt was saved: saving gives the study a new code, so its results start in a new file.'
          : `Not saved yet: Save writes ${STUDY_FILE}.`;
    codeLine.replaceChildren(`Study code #${code}. Results go to `, el('span', { className: 'mono', textContent: studyFileName(def.title, id, 'csv') }), `. ${state}`);
  }
  void changed();

  const current = async (): Promise<string> => {
    while (!identity) {
      await new Promise((r) => setTimeout(r, 20));
      if (!chosen || !draft) throw new Error('No study folder chosen.');
    }
    return identity;
  };

  save.addEventListener('click', async () => {
    if (!chosen || !draft) return;
    const id = await current();
    const text = writeStudyText(def);
    try {
      if (chosen.dir) {
        const name = chosen.layout.studyText ? baseName(chosen.layout.studyText.path) : STUDY_FILE;
        const handle = await chosen.dir.getFileHandle(name, { create: true });
        const out = await handle.createWritable();
        await out.write(text);
        await out.close();
        chosen.layout.studyText = { path: name, file: () => handle.getFile() };
        message = `Saved ${name} in “${chosen.name}”. Study code #${studyCode(id)}.`;
      } else {
        downloadBlob(new Blob([text], { type: 'text/plain' }), STUDY_FILE);
        message = `Downloaded ${STUDY_FILE}. Put it in the study folder “${chosen.name}”, replacing any older copy.`;
      }
      chosen.savedIdentity = id;
      status.textContent = message;
      void changed();
    } catch (e) {
      await alertBox(`Couldn't save ${STUDY_FILE}.\n\n${(e as Error).message}`);
    }
  });

  zip.addEventListener('click', async () => {
    if (!chosen || !draft) return;
    zip.disabled = true;
    try {
      const id = await current();
      const bytes = await makeStudyZip(def, chosen.samples, chosen.references);
      const name = studyFileName(def.title, id, 'zip');
      downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name);
      status.textContent = message = `Saved the study as ${name}.`;
    } catch (e) {
      await alertBox(`Couldn't save the study.\n\n${(e as Error).message}`);
    } finally {
      zip.disabled = false;
    }
  });

  tryIt.addEventListener('click', async () => {
    if (!chosen || !draft) return;
    const id = await current();
    tryStudy({
      definition: structuredClone(def),
      warnings: [],
      samples: chosen.samples,
      references: chosen.references,
      identity: id,
      hasDefinition: chosen.savedIdentity === id,
      results: chosen.results,
      origin: chosen.dir ? { kind: 'folder', dir: chosen.dir } : { kind: 'files', name: chosen.name },
      folderName: chosen.name,
    });
  });

  root.replaceChildren(
    page([
      backNav(back),
      el('h1', { textContent: 'Create or edit a study' }),
      el('section', { className: 'panel tone-create steps' }, [step1, step2, step3, codeLine]),
      el('div', { className: 'row' }, [save, zip, tryIt]),
      status,
      el('p', { className: 'callout' }, [
        canUseFolders
          ? `Save writes ${STUDY_FILE} into the study folder, and results go to a file named after the study in the same folder. `
          : `This browser can’t write to folders, so Save downloads ${STUDY_FILE} for you to put in the study folder, and results are kept in this browser. `,
        'Any change to the voices, options, title or instructions gives the study a new code, so its results start in a new file. ',
        'Voices can be WAV, MP3, M4A, AAC, FLAC, Ogg or Opus files, mixed as you like. A 2012-style folder with the audio files loose at the top (no Test sub-folder) is treated as the voices to rate.',
      ]),
    ]),
  );
}

/** Reads a chosen folder into the page state. */
async function choose(name: string, entries: StudyEntry[], dir?: FileSystemDirectoryHandle) {
  const layout = layoutStudy(entries);
  const load = (list: StudyEntry[]) => Promise.all(list.map(async (e) => named(await e.file(), baseName(e.path))));
  const samples = await load(layout.samples);
  const references = await load(layout.references);
  const results = await load(layout.results);
  const problem = await layoutProblem(layout, { samples, references });
  const hashes = (async () => ({ test: await fileHashes(samples), ref: await fileHashes(references) }))();
  hashes.catch(() => {}); // reported when used
  let textError: string | null = null;
  let warnings: string[] = [];
  let definition = defaultDefinition(titleFromName(name));
  let savedIdentity: string | null = null;
  if (layout.studyText && !problem) {
    try {
      const parsed = parseStudyText(await (await layout.studyText.file()).text(), name);
      definition = parsed.definition;
      warnings = parsed.warnings;
      const h = await hashes;
      savedIdentity = await identityOf(definition, h.test, h.ref);
    } catch (e) {
      if (!(e instanceof StudyFormatError)) throw e;
      textError = e.message;
    }
  }
  chosen = { name, dir, layout, samples, references, results, problem, textError, warnings, savedIdentity, hashes };
  draft = problem || textError ? null : definition;
  message = '';
}

function named(file: File, name: string): File {
  return file.name === name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/** What was found in the folder, in plain words. */
function foundBox(c: Chosen, render: () => void): HTMLElement {
  const { layout } = c;
  const items: (Node | string)[][] = [];
  const n = c.samples.length;
  const r = c.references.length;
  if (layout.testFolder) items.push([`${n} voice${n === 1 ? '' : 's'} to rate in `, mono(layout.testFolder)]);
  else if (n) items.push([`${n} voice${n === 1 ? '' : 's'} to rate, loose in the folder (2012 style)`]);
  if (layout.refFolder) items.push(r ? [`${r} reference voice${r === 1 ? '' : 's'} in `, mono(layout.refFolder)] : [mono(layout.refFolder), ' is empty, so there are no references']);
  else items.push(['No ', mono('Ref'), ' folder, so there are no references']);
  if (!layout.studyText) items.push([`No ${STUDY_FILE} yet, so NeAR starts from the defaults. Saving creates it.`]);
  else if (!c.textError) items.push([`Settings read from ${STUDY_FILE}.`]);
  for (const f of c.results) {
    if (/^near\.csv$/i.test(f.name)) items.push([mono(f.name), ' from an older version: raters will be offered to carry its sessions on.']);
    else items.push(['Results file ', mono(f.name)]);
  }
  if (layout.ignored) items.push([`${layout.ignored} other file${layout.ignored === 1 ? '' : 's'} or folder${layout.ignored === 1 ? '' : 's'} ignored.`]);
  const list = el('ul', {}, items.map((parts) => el('li', {}, parts)));
  void Promise.all(
    c.results.map(async (f, i) => {
      const { sessions } = summarize(parseLines(await f.text()));
      return [i, sessions] as const;
    }),
  ).then((counts) => {
    for (const [i, sessions] of counts) {
      const li = [...list.querySelectorAll('li')].find((x) => x.querySelector('.mono')?.textContent === c.results[i].name);
      li?.append(` (${sessions} session${sessions === 1 ? '' : 's'})`);
    }
  });
  const children: Node[] = [el('div', { className: 'mono', textContent: c.name }), list];
  if (c.problem) children.push(el('p', { className: 'problem', role: 'alert', textContent: c.problem }));
  if (c.textError) {
    const useDefaults = el('button', { type: 'button', textContent: 'Start from the defaults' });
    useDefaults.addEventListener('click', () => {
      c.textError = null;
      draft = defaultDefinition(titleFromName(c.name));
      render();
    });
    children.push(
      el('p', { className: 'problem', role: 'alert', textContent: `${c.textError} Correct ${STUDY_FILE} and choose the folder again, or start from the defaults (saving replaces it).` }),
      el('div', { className: 'row' }, [useDefaults]),
    );
  }
  const note = c.problem ? null : formatNote([...c.samples, ...c.references]);
  if (note) children.push(el('p', { className: 'note warnings', textContent: note }));
  if (c.warnings.length) children.push(el('p', { className: 'note warnings', textContent: c.warnings.join(' ') }));
  return el('div', { className: c.problem || c.textError ? 'found bad' : 'found' }, children);
}

const mono = (text: string) => el('span', { className: 'mono', textContent: text });

