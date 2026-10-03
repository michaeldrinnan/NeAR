import { summarize } from '../lib/csv';
import { forgetRecent, listRecent, reopenRecent, type RecentStudy } from '../lib/recent';
import { notDownloaded, readStudyLines, readStudyRecord, studyId } from '../lib/studies';
import { downloadStudyResults } from '../lib/results';
import { canUseFolders, CANT_OPEN_FOLDERS, CREATE_NEEDS_FOLDERS, NO_FILES_NOTE, filesEntries, NO_FOLDER_NOTE, pickStudyFolder, studyFromFiles, studyFromFolder, studyFromUrl, studyFromZip, type OpenStudy } from '../lib/sources';
import { studyCode, studyFileName } from '../lib/studyFormat';
import { showCreate } from './create';
import { alertBox, ask } from './dialog';
import { backNav, el, page } from './page';
import { showResults } from './results';
import { rateStudy } from './session';

export type PageName = 'home' | 'newto' | 'create' | 'rate' | 'results';

let root: HTMLElement;

export function startApp(app: HTMLElement): void {
  root = app;
  // A ?study=<address of a .zip> link skips Home and opens that study straight away.
  const link = new URLSearchParams(location.search).get('study');
  if (!link) return go('home');
  root.replaceChildren(page([el('p', { className: 'muted', textContent: 'Opening the study…' })]));
  void studyFromUrl(link).then(
    (study) => rateStudy(root, study, () => go('rate')),
    async (e: Error) => {
      await alertBox(`Couldn't open the study at ${link}. The server holding it may not allow downloads from other web sites.\n\n${e.message}`);
      go('home');
    },
  );
}

export function go(name: PageName): void {
  const home = () => go('home');
  if (name === 'home') showHome();
  else if (name === 'newto') showNewTo(home);
  else if (name === 'create') showCreate(root, home, (study) => rateStudy(root, study, () => go('create'), false));
  else if (name === 'rate') void showRate(home);
  else showResults(root, home);
}

function showHome() {
  const bar = (target: PageName, tone: string, title: string, text: string, disabled = false) => {
    const b = el('button', { type: 'button', className: `bar tone-${tone}`, disabled }, [
      el('span', { className: 't' }, [el('h2', { textContent: title }), el('span', { className: 'muted', textContent: text })]),
      el('span', { className: 'arr', 'aria-hidden': 'true', textContent: '›' }),
    ]);
    b.addEventListener('click', () => go(target));
    return b;
  };
  root.replaceChildren(
    page([
      el('div', { className: 'bars' }, [
        bar('newto', 'new', 'New to NeAR?', 'See how it works and try an example study.'),
        // Creating a study needs folder access (Chrome or Edge on a computer); elsewhere the bar says so.
        canUseFolders
          ? bar('create', 'create', 'Create a study', 'Choose a folder of voices, set the options, and save it as a study.')
          : bar('create', 'create', 'Create a study', CREATE_NEEDS_FOLDERS, true),
        bar('rate', 'rate', 'Rate a study', 'Carry on, open a study you were sent, or try an example.'),
        bar('results', 'results', 'Results', 'Download, import or delete results kept in this browser.'),
      ]),
    ]),
  );
}

// ---- New to NeAR? ----

function showNewTo(back: () => void) {
  const tryIt = el('button', { type: 'button', className: 'primary', textContent: 'Try the example' });
  tryIt.addEventListener('click', () => void openExample(0, tryIt, () => go('newto')));
  root.replaceChildren(
    page([
      backNav(back),
      el('h1', { textContent: 'New to NeAR?' }),
      el('section', { className: 'panel tone-new' }, [
        el('div', { className: 'placeholder' }, [
          el('p', { textContent: 'NeAR lets raters put a set of voice recordings in order by listening and dragging, comparing them as often as they like.' }),
          el('p', { textContent: '(Placeholder: better instructions to follow, explaining what a study is and how a rating session works.)' }),
        ]),
        el('div', { className: 'row' }, [
          tryIt,
          el('a', { className: 'button', href: './manual/NeAR-user-manual.pdf', target: '_blank', rel: 'noopener', textContent: 'Read the user manual' }),
        ]),
      ]),
    ]),
  );
}

// ---- built-in examples ----

/** Built-in example studies: public/studies/index.json lists them; the first is the default. */
interface BuiltinStudy {
  title: string;
  file: string;
}
const BUILTIN_FALLBACK: BuiltinStudy[] = [{ title: 'Example files', file: 'example-files.zip' }];
let builtinList: Promise<BuiltinStudy[]> | null = null;
let builtinChoice = 0;
function builtinStudies(): Promise<BuiltinStudy[]> {
  builtinList ??= fetch(new URL('studies/index.json', document.baseURI))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
    .then((j: { studies?: BuiltinStudy[] }) => (j.studies?.length ? j.studies : BUILTIN_FALLBACK))
    .catch(() => {
      builtinList = null; // try again next time (e.g. once back online)
      return BUILTIN_FALLBACK;
    });
  return builtinList;
}
const builtinUrl = (s: BuiltinStudy) => `studies/${s.file}`;

async function openExample(index: number, button: HTMLButtonElement, back: () => void) {
  button.disabled = true;
  const chosen = (await builtinStudies())[index] ?? BUILTIN_FALLBACK[0];
  await open(() => studyFromUrl(builtinUrl(chosen)), "Couldn't load the example study. Are you offline?", back);
  button.disabled = false;
}

/** Loads a study, then goes straight to its rating screen. */
async function open(load: () => Promise<OpenStudy>, failure: string, back: () => void) {
  let study: OpenStudy;
  try {
    study = await load();
  } catch (e) {
    await alertBox(`${failure}\n\n${(e as Error).message}`);
    return;
  }
  await rateStudy(root, study, back);
}

// ---- Rate a study ----

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "3 sessions saved", where that can be known without asking for permission. */
async function savedCount(r: RecentStudy): Promise<string> {
  try {
    if (r.source.kind !== 'folder') {
      const n = summarize(await readStudyLines(studyId(r.identity))).sessions;
      return ` · ${n} session${n === 1 ? '' : 's'} saved`;
    }
  } catch {
    /* leave it out */
  }
  return '';
}

async function showRate(back: () => void) {
  const again = () => void showRate(back);
  const rateBack = () => go('rate');

  /** A row of the Rate page: text on the left, its buttons stacked on the right, all the same size. */
  const choice = (left: (Node | string)[], buttons: HTMLButtonElement[], className = 'choice') => {
    for (const b of buttons) b.classList.add('primary');
    return el('div', { className }, [el('div', { className: 't' }, left), el('div', { className: 'side' }, buttons)]);
  };

  // 1. Example studies
  const select = el('select', { id: 'example-select', 'aria-label': 'Example study' });
  const tryIt = el('button', { type: 'button', textContent: 'Try it' });
  const download = el('button', { type: 'button', textContent: 'Download (.zip)' });
  let chosen: BuiltinStudy = BUILTIN_FALLBACK[0];
  tryIt.addEventListener('click', () => void openExample(Number(select.value) || 0, tryIt, rateBack));
  download.addEventListener('click', () => {
    const a = el('a', { href: `./${builtinUrl(chosen)}`, download: chosen.file });
    document.body.append(a);
    a.click();
    a.remove();
  });
  void builtinStudies().then((list) => {
    select.replaceChildren(...list.map((s, i) => new Option(s.title, String(i))));
    builtinChoice = Math.min(builtinChoice, list.length - 1);
    select.value = String(builtinChoice);
    const sync = () => {
      builtinChoice = Number(select.value);
      chosen = list[builtinChoice];
    };
    select.addEventListener('change', sync);
    sync();
  });

  // 4. A study you were sent
  const zipInput = el('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  const openZip = el('button', { type: 'button', textContent: 'Open study file…' });
  openZip.addEventListener('click', () => {
    zipInput.value = '';
    zipInput.click();
  });
  zipInput.addEventListener('change', () => {
    const file = zipInput.files?.[0];
    if (file) void open(async () => studyFromZip(new Uint8Array(await file.arrayBuffer()), file.name), `Couldn't open “${file.name}” as a study.`, rateBack);
  });
  const folderInput = el('input', { type: 'file', hidden: true, multiple: true });
  folderInput.webkitdirectory = true;
  // Choosing a folder always says what is happening: opening it, or why nothing was opened.
  const folderNote = el('p', { className: 'note pick-note', 'aria-live': 'polite' });
  const opening = (name: string) => `Opening “${name}” and checking that every audio file plays…`;
  const openFolder = el('button', { type: 'button', textContent: 'Open study folder…' });
  openFolder.addEventListener('click', async () => {
    if (!canUseFolders) {
      folderInput.value = '';
      folderInput.click();
      return;
    }
    let dir: FileSystemDirectoryHandle | null;
    folderNote.textContent = '';
    try {
      dir = await pickStudyFolder();
    } catch {
      folderNote.textContent = CANT_OPEN_FOLDERS;
      return;
    }
    if (!dir) {
      folderNote.textContent = NO_FOLDER_NOTE;
      return;
    }
    folderNote.textContent = opening(dir.name);
    await open(() => studyFromFolder(dir), `Couldn't open “${dir.name}” as a study.`, rateBack);
    folderNote.textContent = '';
  });
  folderInput.addEventListener('cancel', () => (folderNote.textContent = 'No folder was opened.'));
  folderInput.addEventListener('change', async () => {
    const files = folderInput.files;
    if (!files?.length) {
      folderNote.textContent = NO_FILES_NOTE;
      return;
    }
    const { name } = filesEntries(files);
    folderNote.textContent = opening(name);
    await open(() => studyFromFiles(files), `Couldn't open “${name}” as a study.`, rateBack);
    folderNote.textContent = '';
  });

  const panels: HTMLElement[] = [
    el('section', { className: 'panel tone-rate shade-1' }, [
      choice([el('h2', { textContent: 'Example studies' }), select], [tryIt, download]),
    ]),
  ];

  // 2 and 3. Carry on, and recent studies
  const recent = await listRecent().catch(() => [] as RecentStudy[]);
  const openRecent = (r: RecentStudy, button: HTMLButtonElement) => async () => {
    button.disabled = true;
    try {
      await open(() => reopenRecent(r), `Couldn't open “${r.title}” again.`, rateBack);
    } finally {
      button.disabled = false;
    }
  };
  if (recent.length) {
    const last = recent[0];
    const carry = el('button', { type: 'button', textContent: 'Carry on' });
    carry.addEventListener('click', openRecent(last, carry));
    const meta = el('span', { className: 'muted', textContent: `Last used ${when(last.lastUsed)}` });
    void savedCount(last).then((t) => (meta.textContent += t));
    panels.push(
      el('section', { className: 'panel tone-rate shade-2 carry' }, [
        choice([el('h2', { textContent: `Carry on with ${last.title}` }), meta], [carry]),
      ]),
    );
    const items = recent.map((r) => {
      const openBtn = el('button', { type: 'button', textContent: 'Open' });
      openBtn.addEventListener('click', openRecent(r, openBtn));
      const forget = el('button', { type: 'button', textContent: 'Remove', title: 'Remove from this list (results are kept)' });
      forget.addEventListener('click', async () => {
        if (!(await confirmRemove(r))) return;
        await forgetRecent(r.identity).catch(() => {});
        again();
      });
      const where = r.source.kind === 'folder' ? `folder “${r.source.dir.name}”` : r.source.kind === 'zip' ? r.source.name : 'example';
      const meta = el('span', { className: 'mono', textContent: `#${studyCode(r.identity)} · ${where} · ${when(r.lastUsed)}` });
      void savedCount(r).then((t) => (meta.textContent += t));
      return choice([el('strong', { textContent: r.title }), meta], [openBtn, forget], 'choice item');
    });
    panels.push(el('section', { className: 'panel tone-rate shade-3' }, [el('h2', { textContent: 'Recent studies' }), el('div', { className: 'list' }, items)]));
  }

  panels.push(
    el('section', { className: 'panel tone-rate shade-4' }, [
      choice(
        [el('h2', { textContent: 'A study you were sent' }), el('p', { className: 'muted', textContent: 'A study is a .zip file, or a folder, containing the voices and the study’s settings.' })],
        [openZip, openFolder],
      ),
      folderNote,
      zipInput,
      folderInput,
    ]),
  );

  root.replaceChildren(page([backNav(back), el('h1', { textContent: 'Which study are you rating?' }), ...panels]));
}

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/**
 * Asks before removing a study from Recent studies, saying where its results stay and how to
 * open it again, and warning (with a download) if any sessions haven't been downloaded yet.
 */
async function confirmRemove(r: RecentStudy): Promise<boolean> {
  for (;;) {
    const parts = [`Remove “${r.title}” from Recent studies?`];
    const id = studyId(r.identity);
    let pending = 0;
    let lines: string[] | null = null;
    if (r.source.kind === 'folder') {
      parts.push(
        `Its results stay in the folder “${r.source.dir.name}”, in ${studyFileName(r.title, r.identity, 'csv')}.`,
        'To rate it again, use Open study folder….',
      );
    } else {
      const study = await readStudyRecord(id).catch(() => undefined);
      lines = study?.lines ?? null;
      const { sessions } = summarize(lines);
      pending = study ? notDownloaded(study) : 0;
      parts.push(sessions ? `Its results (${plural(sessions, 'session')}) stay in this browser, on the Results page.` : 'No sessions have been saved for it.');
      if (pending) {
        parts.push(
          `WARNING: ${pending === sessions ? (pending === 1 ? 'this session has' : `all ${pending} sessions have`) : `${plural(pending, 'session')} of these ${pending === 1 ? 'has' : 'have'}`} not been downloaded yet. ` +
            'Download them first to keep a copy outside this browser.',
        );
      }
      parts.push(
        r.source.kind === 'zip'
          ? `To rate it again you will need the study file “${r.source.name}”.`
          : r.source.url.startsWith('studies/')
            ? 'You can open it again from Example studies.'
            : 'You can open it again from its link.',
      );
    }
    const key = await ask(
      parts.join('\n\n'),
      [
        ...(pending ? [{ label: 'Download results', value: 'download' as const, primary: true }] : []),
        { label: 'Remove', value: 'remove' as const, danger: true },
        { label: 'Keep it', value: 'keep' as const, primary: !pending },
      ],
      'Remove from Recent studies',
      'keep',
    );
    if (key === 'keep') return false;
    if (key === 'remove') return true;
    if (lines) await downloadStudyResults(id, lines, studyFileName(r.title, r.identity, 'csv'));
  }
}
