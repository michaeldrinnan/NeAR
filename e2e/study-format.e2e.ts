import { expect, test, type Page } from '@playwright/test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { folderFiles, mockFolders, name, pickFolder, saveAndFinish, storedResults, toRate, W } from './helpers';

// Playwright hands files over as Node buffers.
declare const Buffer: { from(data: string | Uint8Array): unknown };

async function toCreate(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Create a study/ }).click();
  await expect(page.getByRole('heading', { name: 'Create or edit a study' })).toBeVisible();
}

const chooseFolder = async (page: Page, folder: string) => {
  await pickFolder(page, folder);
  await page.getByRole('button', { name: 'Choose study folder…' }).click();
};

const STUDY = {
  'Test/v1.wav': W('1'),
  'Test/v2.wav': W('2'),
  'Test/v3.wav': W('3'),
  'Ref/best.wav': W('R'),
  'notes.docx': 'notes',
};

const TRY = 'Try without saving results';
const codeOf = async (page: Page) => {
  await expect(page.locator('.code-line')).toContainText(/#[0-9a-f]{8}/);
  return (await page.locator('.code-line').textContent())!.match(/#([0-9a-f]{8})/)![1];
};
const saveBtn = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

test('Create: only the folder step is available until a folder is chosen; then what was found is shown', async ({ page }) => {
  await mockFolders(page, { 'Dysphonia 2026': STUDY });
  await toCreate(page);
  await expect(page.locator('.step.needs')).toHaveCount(2);
  for (const b of ['Save', 'Save as zip…', TRY, 'Undo all changes']) await expect(page.getByRole('button', { name: b, exact: true })).toBeDisabled();
  await expect(page.locator('.status')).toHaveText('Choose a study folder to continue.');
  await expect(page.getByText('Every option is fixed')).toHaveCount(0);

  await chooseFolder(page, 'Dysphonia 2026');
  const found = page.locator('.found');
  await expect(found).toContainText('3 voices to rate in Test');
  await expect(found).toContainText('1 reference voice in Ref');
  await expect(found).toContainText('No study.txt yet, so NeAR starts from the defaults. Save creates it.');
  await expect(found).toContainText('1 other file or folder ignored');
  await expect(page.locator('.step.needs')).toHaveCount(0);

  // The defaults, and the folder's name as the title; nothing is written until Save.
  const pressed = (key: string) => page.locator(`[data-option="${key}"] [aria-pressed="true"]`);
  await expect(pressed('random')).toHaveText('On');
  await expect(pressed('numbers')).toHaveText('On');
  await expect(pressed('names')).toHaveText('Off');
  await expect(pressed('leave_unrated')).toHaveText('Off');
  await expect(pressed('play_count')).toHaveText('Off');
  await expect(page.locator('#study-title')).toHaveValue('Dysphonia 2026');
  await expect(page.locator('.code-line')).toHaveText(/^Study code #[0-9a-f]{8}\. Results go to NeAR_Dysphonia 2026_[0-9a-f]{8}\.csv\.$/);
  expect((await folderFiles(page, 'Dysphonia 2026'))['study.txt']).toBeUndefined();
  await expect(saveBtn(page)).toBeEnabled(); // there is no study.txt yet
  const code = await codeOf(page);
  await saveBtn(page).click();
  await expect(page.locator('.status')).toHaveText(`Saved to study.txt in “Dysphonia 2026” · study code #${code}.`);
  expect((await folderFiles(page, 'Dysphonia 2026'))['study.txt']).toContain('title         = Dysphonia 2026');
  await expect(saveBtn(page)).toBeDisabled(); // nothing left to save

  // The same study (same code) when opened to rate.
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await expect(page.locator('.study-title')).toHaveText('Dysphonia 2026');
  await expect(page.locator('.instr')).toBeHidden();
  await expect(page.locator('.meta')).toContainText(`study #${code}`);
});

test('Create: titles that can’t be used in file names are refused with a note', async ({ page }) => {
  await mockFolders(page, { Voices: STUDY });
  await toCreate(page);
  await chooseFolder(page, 'Voices');
  const title = page.locator('#study-title');
  await title.fill('Before/after');
  await expect(page.locator('.field-note')).toContainText('can’t contain');
  await expect(saveBtn(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: TRY })).toBeDisabled();
  await title.fill('x'.repeat(81));
  await expect(page.locator('.field-note')).toContainText('80 characters');
  await title.fill('Before and after.');
  await expect(page.locator('.field-note')).toBeHidden();
  await expect(saveBtn(page)).toBeEnabled();
  await expect(page.locator('.code-line')).toContainText('NeAR_Before and after_'); // trailing full stop dropped
});

test('Create: Save writes study.txt; Back leaves without saving (asking first); Undo goes back to how the folder was', async ({ page }) => {
  const original = '# my notes\ntitle = Dysphonia ranking\ninstructions = Rank by severity.\nnumbers = off\n';
  await mockFolders(page, { Voices: { ...STUDY, 'study.txt': original }, Fresh: STUDY });
  await toCreate(page);
  await chooseFolder(page, 'Voices');
  await expect(page.locator('.found')).toContainText('Settings read from study.txt.');
  await expect(page.locator('#study-title')).toHaveValue('Dysphonia ranking');
  await expect(page.locator('[data-option="numbers"] [aria-pressed="true"]')).toHaveText('Off');
  const code = await codeOf(page);
  await expect(saveBtn(page)).toBeDisabled(); // nothing changed yet
  await expect(page.getByRole('button', { name: 'Undo all changes' })).toBeDisabled();

  // Edits aren't written until Save; each change gives a new code.
  await page.locator('[data-option="play_count"]').getByRole('button', { name: 'On' }).click();
  await page.locator('#study-instructions').fill('Rank by severity.\nLeast severe at top left.');
  await expect(page.locator('.status')).toContainText('Unsaved changes');
  await expect(page.locator('.code-line')).not.toContainText(`#${code}`);
  expect((await folderFiles(page, 'Voices'))['study.txt']).toBe(original);
  await saveBtn(page).click();
  await expect(page.locator('.status')).toContainText('Saved to study.txt in “Voices”');
  const saved = (await folderFiles(page, 'Voices'))['study.txt'];
  expect(saved).toContain('play_count    = on');
  expect(saved).toContain('instructions  = Least severe at top left.');

  // Back with unsaved edits asks; leaving drops them and keeps what was saved.
  await page.locator('#study-title').fill('Something else');
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('dialog h2')).toHaveText('Leave without saving?');
  await page.keyboard.press('Escape'); // keeps editing
  await expect(page.locator('#study-title')).toHaveValue('Something else');
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.locator('.bar')).toHaveCount(4);
  expect((await folderFiles(page, 'Voices'))['study.txt']).toBe(saved);

  // Edit again: the folder now opens as saved. Undo all changes puts study.txt back as it was on choosing it.
  await page.getByRole('button', { name: /Create a study/ }).click();
  await chooseFolder(page, 'Voices');
  await expect(page.locator('[data-option="play_count"] [aria-pressed="true"]')).toHaveText('On');
  await page.locator('[data-option="names"]').getByRole('button', { name: 'On' }).click();
  await saveBtn(page).click();
  await expect(page.locator('.status')).toContainText('Saved to study.txt');
  await page.getByRole('button', { name: 'Undo all changes' }).click();
  await expect(page.locator('.status')).toHaveText('Undone: back to study.txt as it was when you chose the folder.');
  expect((await folderFiles(page, 'Voices'))['study.txt']).toBe(saved);
  await expect(page.locator('[data-option="names"] [aria-pressed="true"]')).toHaveText('Off');
  await expect(page.getByRole('button', { name: 'Undo all changes' })).toBeDisabled();

  // A folder that had no study.txt: Undo removes the one saved since.
  await chooseFolder(page, 'Fresh');
  await saveBtn(page).click();
  await expect(page.locator('.status')).toContainText('Saved to study.txt');
  await page.getByRole('button', { name: 'Undo all changes' }).click();
  expect((await folderFiles(page, 'Fresh'))['study.txt']).toBeUndefined();
});

test('Create: saving a change to a study that already has sessions asks first; Cancel saves nothing', async ({ page }) => {
  const text = 'title = Used\n';
  await mockFolders(page, { Used: { ...STUDY, 'study.txt': text } });
  await toCreate(page);
  await chooseFolder(page, 'Used');
  const code = await codeOf(page);
  // Give the study as it stands two saved sessions, then choose the folder again.
  await page.evaluate((c) => {
    const w = window as unknown as { folders: Record<string, Record<string, string>> };
    w.folders.Used[`NeAR_Used_${c}.csv`] = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,v1.wav,v2.wav,v3.wav\r\nA,2026-10-01,10:00:00,x,Ref,1,2,3,4\r\nB,2026-10-02,10:00:00,x,Ref,1,4,3,2\r\n';
  }, code);
  await chooseFolder(page, 'Used');
  await page.locator('[data-option="names"]').getByRole('button', { name: 'On' }).click();
  await saveBtn(page).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('This study has 2 sessions saved. Saving these changes makes a new version with its own results file');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await folderFiles(page, 'Used'))['study.txt']).toBe(text);
  await saveBtn(page).click();
  await page.getByRole('button', { name: 'Save as a new version' }).click();
  await expect.poll(async () => (await folderFiles(page, 'Used'))['study.txt']).toContain('names         = on');
  // The new version has no sessions yet, so further changes save without asking.
  await page.locator('[data-option="numbers"]').getByRole('button', { name: 'Off' }).click();
  await saveBtn(page).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await folderFiles(page, 'Used'))['study.txt']).toContain('numbers       = off');
});

test('Create: Try without saving results writes nothing and comes back to the page; Save as zip opens with the same code', async ({ page }) => {
  await mockFolders(page, { Voices: STUDY });
  await toCreate(page);
  await chooseFolder(page, 'Voices');
  await page.locator('#study-title').fill('Zipped');
  await page.locator('#study-instructions').fill('Listen carefully.');
  await expect(page.locator('.code-line')).toContainText('NeAR_Zipped_');
  const code = await codeOf(page);

  // A try-out: the rating screen for exactly this design; finishing saves nothing anywhere.
  await page.getByRole('button', { name: TRY }).click();
  await expect(page.locator('.study-title')).toHaveText('Zipped');
  await expect(page.locator('.meta')).toHaveText(`3 voices · 1 reference · study #${code}`);
  await expect(page.locator('.results-note')).toHaveText('This is a try-out: nothing will be saved.');
  await expect(page.locator('#rater')).toHaveValue('Try-out');
  await page.getByRole('button', { name: 'Start rating' }).click();
  await page.getByRole('button', { name: 'Finish try-out' }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.locator('.saved')).toHaveText('Try-out finished. Nothing was saved.');
  expect(Object.keys(await folderFiles(page, 'Voices')).filter((f) => f.startsWith('NeAR') || f === 'study.txt')).toEqual([]);
  expect(await storedResults(page)).toEqual({});
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('#study-title')).toHaveValue('Zipped'); // still there, still unsaved

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as zip…' }).click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe(`NeAR_Zipped_${code}.zip`);
  const zipPath = await zip.path();

  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: 'Leave without saving' }).click();
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await page.locator('input[type="file"][accept*="zip"]').setInputFiles(zipPath);
  await expect(page.locator('.study-title')).toHaveText('Zipped');
  await expect(page.locator('.meta')).toContainText(`study #${code}`);
  await expect(page.locator('.instr')).toHaveText('Listen carefully.');
});

test('Create: folders that can’t be studies keep the page locked with a plain message', async ({ page }) => {
  await mockFolders(page, {
    Empty: { 'readme.txt': 'x' },
    One: { 'Test/only.wav': W('1') },
    Broken: { 'Test/a.wav': W('a'), 'Test/b.wav': 'not audio' },
    Mislabelled: { 'Test/a.WAV': W('a'), 'Test/b.mp3': 'not audio' },
    Patchy: { 'Test/a.wav': W('a'), 'Test/b.ogg': 'OggS but not really' },
    Mistake: { 'Test/a.wav': W('a'), 'Test/b.wav': W('b'), 'study.txt': 'title = T\nrandom = maybe\n' },
    Old: { 'a.wav': W('a'), 'b.wav': W('b') },
  });
  await toCreate(page);
  const problem = page.locator('.found .problem');
  await chooseFolder(page, 'Empty');
  await expect(problem).toContainText('No audio files (WAV, MP3, M4A, AAC, FLAC, Ogg or Opus) were found');
  await expect(page.locator('.step.needs')).toHaveCount(2);
  await chooseFolder(page, 'One');
  await expect(problem).toContainText('Only one voice to rate was found in Test');
  await chooseFolder(page, 'Broken');
  await expect(problem).toContainText('“b.wav” in Test can’t be played in this browser');
  await expect(page.getByRole('button', { name: TRY })).toBeDisabled();
  await expect(saveBtn(page)).toBeDisabled();
  await chooseFolder(page, 'Mislabelled'); // any case, any accepted type
  await expect(problem).toContainText('“b.mp3” in Test can’t be played in this browser');
  await chooseFolder(page, 'Patchy');
  await expect(problem).toContainText('Ogg and Opus files don’t play in some browsers');

  // A mistake in study.txt names the line, and offers the defaults instead (Save replaces the file; Undo puts it back).
  await chooseFolder(page, 'Mistake');
  await expect(problem).toContainText('line 2: “random = maybe” should be on or off');
  await expect(page.locator('.step.needs')).toHaveCount(2);
  await page.getByRole('button', { name: 'Start from the defaults' }).click();
  await expect(page.locator('.step.needs')).toHaveCount(0);
  await expect(page.locator('#study-title')).toHaveValue('Mistake');
  await saveBtn(page).click();
  await expect.poll(async () => (await folderFiles(page, 'Mistake'))['study.txt']).toContain('random        = on');
  await page.getByRole('button', { name: 'Undo all changes' }).click();
  expect((await folderFiles(page, 'Mistake'))['study.txt']).toBe('title = T\nrandom = maybe\n');
  await expect(problem).toContainText('line 2');

  // 2012 style: audio files loose in the folder are the voices to rate, with no references.
  await chooseFolder(page, 'Old');
  await expect(page.locator('.found')).toContainText('2 voices to rate, loose in the folder (2012 style)');
  await expect(page.locator('.found')).toContainText('No Ref folder, so there are no references');
  await expect(page.getByRole('button', { name: TRY })).toBeEnabled();
});

test('without folder access (Safari, Firefox, iPad), Create a study is unavailable, with the reason; rating still works', async ({ page }) => {
  await page.addInitScript(() => delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker);
  await page.goto('/');
  const create = page.getByRole('button', { name: /Create a study/ });
  await expect(create).toBeDisabled();
  await expect(create).toContainText('Creating a study needs Chrome or Edge on a computer.');
  await expect(page.locator('.frame-hint')).toHaveCount(0); // a browser of its own, not a frame
  // Rating a folder study still works, with the ordinary folder chooser; a chooser that hands over nothing says so.
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await page.locator('input[type="file"][webkitdirectory]').dispatchEvent('change'); // a choice with no files in it
  await expect(page.locator('.pick-note')).toContainText('No files arrived from that folder');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await (await chooser).setFiles('public/examples');
  await expect(page.locator('.study-title')).toHaveText('Example files');
});

test('a study that cannot be used is refused with a plain explanation', async ({ page }) => {
  await toRate(page);
  await page.locator('input[type="file"][accept*="zip"]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') as never });
  await expect(page.locator('dialog')).toContainText("Couldn't open “broken.zip” as a study.");
  await expect(page.locator('dialog')).toContainText('not a readable .zip');
});

test('a ?study= link goes straight to that study; Back then leads to Rate a study', async ({ page }) => {
  await page.goto('/?study=studies/example-no-references.zip');
  await expect(page.locator('.study-title')).toHaveText('Example: no references');
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByRole('heading', { name: 'Which study are you rating?' })).toBeVisible();
});

test('a changed study is a different study with its own results; the same study carries on', async ({ page }) => {
  const open = async (file: string, buffer: never) => {
    await toRate(page);
    await page.locator('input[type="file"][accept*="zip"]').setInputFiles({ name: file, mimeType: 'application/zip', buffer });
    await expect(page.locator('#rater')).toBeVisible();
  };
  await toRate(page);
  const bytes = Uint8Array.from(await page.evaluate(async () => [...new Uint8Array(await (await fetch('studies/example-no-references.zip')).arrayBuffer())]));
  const original = Buffer.from(bytes) as never;
  await open('copy.zip', original);
  await name(page, 'First');
  await saveAndFinish(page);
  await page.getByRole('button', { name: 'Not now' }).click();
  await open('copy.zip', original);
  await expect(page.locator('.results-note')).toContainText('1 session, last on');
  // A hand-edited copy with an unusable title: loads with a warning; its file names are made safe.
  const entries = unzipSync(bytes);
  entries['study.txt'] = strToU8(new TextDecoder().decode(entries['study.txt']).replace('title         = Example: no references', 'title = Edited: a/b?'));
  await page.getByRole('button', { name: '← Back' }).click();
  await page.locator('input[type="file"][accept*="zip"]').setInputFiles({ name: 'edited.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)) as never });
  await expect(page.locator('.study-title')).toHaveText('Edited: a/b?');
  await expect(page.locator('.results-note')).toContainText('No sessions saved yet'); // a different study
  await expect(page.locator('.results-note')).toContainText(/NeAR_Edited_ a_b__[0-9a-f]{8}\.csv/);
  await expect(page.locator('.warnings')).toContainText('can’t be used as it is');
  expect(Object.keys(await storedResults(page))).toEqual(['Example: no references']);
});

test('the example study offered for download is a valid study that opens with Open study file…', async ({ page }) => {
  await toRate(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download (.zip)' }).click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe('example-files.zip');
  await page.locator('input[type="file"][accept*="zip"]').setInputFiles(await zip.path());
  await expect(page.locator('.study-title')).toHaveText('Example files');
  await expect(page.locator('.meta')).toContainText('8 voices · 5 references');
});

test('a 2012 TestItems folder (loose WAVs and an old NeAR.csv) opens on Create and Rate, with feedback throughout', async ({ page }) => {
  const header = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,CLICK1.WAV,Copy of phon1.wav,phon2.wav';
  await mockFolders(page, {
    TestItems: {
      'CLICK1.WAV': W('c'),
      'Copy of phon1.wav': W('p1'),
      'phon2.wav': W('p2'),
      'NeAR.csv': `${header}\r\nJim,07 January 2012,10:00:00,TestItems,,0,1,2,3\r\n`,
    },
  });
  await toCreate(page);
  await chooseFolder(page, 'TestItems');
  const found = page.locator('.found');
  await expect(found).toContainText('3 voices to rate, loose in the folder (2012 style)');
  await expect(found).toContainText('NeAR.csv from an older version');
  await expect(page.locator('#study-title')).toHaveValue('TestItems');

  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await expect(page.locator('dialog')).toContainText('also has NeAR.csv, from an older version of NeAR, with the same voices (1 session');
  await page.getByRole('button', { name: 'Carry them on' }).click();
  await expect(page.locator('.study-title')).toHaveText('TestItems');
  await expect(page.locator('.meta')).toContainText('3 voices · no references');
  await expect(page.locator('.results-note')).toContainText('1 session, last on 07 January 2012 so far');
});

test('cancelling the folder picker (or refusing access) says so instead of doing nothing', async ({ page }) => {
  await mockFolders(page, {}); // no folder to give: the picker comes back empty, as when cancelled or refused
  await toCreate(page);
  await page.getByRole('button', { name: 'Choose study folder…' }).click();
  await expect(page.locator('.pick-note')).toContainText('No folder was opened');
  await expect(page.locator('.pick-note')).toContainText('choose Allow (or Edit files) when asked');
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await expect(page.locator('.pick-note')).toContainText('No folder was opened');
});

test('where the folder picker is refused (SecurityError), Create and Rate say what to do instead', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => {
        throw new DOMException("Cross origin sub frames aren't allowed to show a file picker.", 'SecurityError');
      },
    }),
  );
  const cant = 'This window can’t open folders. Open NeAR in Chrome or Edge, or use Open study file… with a zip.';
  await toCreate(page);
  await page.getByRole('button', { name: 'Choose study folder…' }).click();
  await expect(page.locator('.pick-note')).toHaveText(cant);
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await expect(page.locator('.pick-note')).toHaveText(cant);
});

test('inside another page’s frame (e.g. VS Code’s Simple Browser), Create is unavailable and study folders open with the ordinary file chooser', async ({ page }) => {
  // A second local page that shows NeAR in a frame, as an editor's preview does.
  // @ts-ignore Node's http module, used only by this test
  const { createServer } = await import('node:http');
  const server = createServer((_req: unknown, res: { setHeader(k: string, v: string): void; end(s: string): void }) => {
    res.setHeader('content-type', 'text/html');
    res.end('<iframe id="f" src="http://localhost:4174/" style="width:900px;height:900px"></iframe>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); // any free port
  try {
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const frame = page.frameLocator('#f');
    // A banner says NeAR is limited here, with its address to open in Chrome or Edge.
    await expect(frame.locator('.frame-hint')).toContainText('NeAR is open inside another app');
    await expect(frame.locator('.frame-hint a')).toHaveAttribute('href', 'http://localhost:4174/');
    // The folder picker is refused in a frame, so Create a study is unavailable there…
    await expect(frame.getByRole('button', { name: /Create a study/ })).toBeDisabled();
    // …but a study folder can still be opened to rate, with the ordinary file chooser.
    await frame.getByRole('button', { name: /Rate a study/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await frame.getByRole('button', { name: 'Open study folder…' }).click();
    await (await chooser).setFiles('public/examples');
    await expect(frame.locator('.study-title')).toHaveText('Example files');
  } finally {
    server.close();
  }
});
