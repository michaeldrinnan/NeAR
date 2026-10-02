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

test('Create: only the folder step is available until a folder is chosen; then what was found is shown', async ({ page }) => {
  await mockFolders(page, { 'Dysphonia 2026': STUDY });
  await toCreate(page);
  await expect(page.locator('.step.needs')).toHaveCount(2);
  for (const b of ['Save', 'Save as zip…', 'Try it now']) await expect(page.getByRole('button', { name: b, exact: true })).toBeDisabled();
  await expect(page.locator('.status')).toHaveText('Choose a study folder to continue.');

  await chooseFolder(page, 'Dysphonia 2026');
  const found = page.locator('.found');
  await expect(found).toContainText('3 voices to rate in Test');
  await expect(found).toContainText('1 reference voice in Ref');
  await expect(found).toContainText('No study.txt yet, so NeAR starts from the defaults');
  await expect(found).toContainText('1 other file or folder ignored');
  await expect(page.locator('.step.needs')).toHaveCount(0);

  // The defaults, and the folder's name as the title.
  const pressed = (key: string) => page.locator(`[data-option="${key}"] [aria-pressed="true"]`);
  await expect(pressed('random')).toHaveText('On');
  await expect(pressed('numbers')).toHaveText('On');
  await expect(pressed('names')).toHaveText('Off');
  await expect(pressed('leave_unrated')).toHaveText('Off');
  await expect(pressed('play_count')).toHaveText('Off');
  await expect(page.locator('#study-title')).toHaveValue('Dysphonia 2026');
  await expect(page.locator('.code-line')).toContainText(/Study code #[0-9a-f]{8}\. Results go to NeAR_Dysphonia 2026_[0-9a-f]{8}\.csv\. Not saved yet/);
});

test('Create: titles that can’t be used in file names are refused with a note', async ({ page }) => {
  await mockFolders(page, { Voices: STUDY });
  await toCreate(page);
  await chooseFolder(page, 'Voices');
  const title = page.locator('#study-title');
  await title.fill('Before/after');
  await expect(page.locator('.field-note')).toContainText('can’t contain');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await title.fill('x'.repeat(81));
  await expect(page.locator('.field-note')).toContainText('80 characters');
  await title.fill('Before and after.');
  await expect(page.locator('.field-note')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(page.locator('.code-line')).toContainText('NeAR_Before and after_'); // trailing full stop dropped
});

test('Create: Save writes study.txt; choosing the folder again edits it; any change gives a new code', async ({ page }) => {
  await mockFolders(page, { Voices: STUDY });
  await toCreate(page);
  await chooseFolder(page, 'Voices');
  await page.locator('[data-option="numbers"]').getByRole('button', { name: 'Off' }).click();
  await page.locator('#study-title').fill('Dysphonia ranking');
  await page.locator('#study-instructions').fill('Rank by severity.\nLeast severe at top left.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.status')).toHaveText(/^Saved study\.txt in “Voices”\. Study code #[0-9a-f]{8}\.$/);
  await expect(page.locator('.code-line')).toContainText('Saved in study.txt.');
  const code = (await page.locator('.code-line').textContent())!.match(/#([0-9a-f]{8})/)![1];
  const text = (await folderFiles(page, 'Voices'))['study.txt'];
  expect(text).toContain('title         = Dysphonia ranking');
  expect(text).toContain('instructions  = Least severe at top left.');
  expect(text).toContain('numbers       = off');
  expect(text).not.toContain('version');

  // Edit: back to Home, then choose the folder again; its settings are read from study.txt.
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Create a study/ }).click();
  await chooseFolder(page, 'Voices');
  await expect(page.locator('.found')).toContainText('Settings read from study.txt.');
  await expect(page.locator('#study-title')).toHaveValue('Dysphonia ranking');
  await expect(page.locator('[data-option="numbers"] [aria-pressed="true"]')).toHaveText('Off');
  await expect(page.locator('.code-line')).toContainText(`#${code}`);
  await expect(page.locator('.code-line')).toContainText('Saved in study.txt.');
  await page.locator('[data-option="play_count"]').getByRole('button', { name: 'On' }).click();
  await expect(page.locator('.code-line')).toContainText('Changed since study.txt was saved');
  await expect(page.locator('.code-line')).not.toContainText(`#${code}`);
});

test('Create: Save as zip makes a study that opens with the same code; Try it now comes back to the page', async ({ page }) => {
  await mockFolders(page, { Voices: STUDY });
  await toCreate(page);
  await chooseFolder(page, 'Voices');
  await page.locator('#study-title').fill('Zipped');
  await page.locator('#study-instructions').fill('Listen carefully.');
  await expect(page.locator('.code-line')).toContainText('NeAR_Zipped_');
  const code = (await page.locator('.code-line').textContent())!.match(/#([0-9a-f]{8})/)![1];

  // Try it now: the rating screen for exactly this design, and Back returns to the page as it was.
  await page.getByRole('button', { name: 'Try it now' }).click();
  await expect(page.locator('.study-title')).toHaveText('Zipped');
  await expect(page.locator('.meta')).toHaveText(`3 voices · 1 reference · study #${code}`);
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('#study-title')).toHaveValue('Zipped');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as zip…' }).click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe(`NeAR_Zipped_${code}.zip`);
  const zipPath = await zip.path();

  await page.getByRole('button', { name: '← Back' }).click();
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
  await expect(page.getByRole('button', { name: 'Try it now' })).toBeDisabled();
  await chooseFolder(page, 'Mislabelled'); // any case, any accepted type
  await expect(problem).toContainText('“b.mp3” in Test can’t be played in this browser');
  await chooseFolder(page, 'Patchy');
  await expect(problem).toContainText('Ogg and Opus files don’t play in some browsers');

  // A mistake in study.txt names the line, and offers the defaults instead.
  await chooseFolder(page, 'Mistake');
  await expect(problem).toContainText('line 2: “random = maybe” should be on or off');
  await expect(page.locator('.step.needs')).toHaveCount(2);
  await page.getByRole('button', { name: 'Start from the defaults' }).click();
  await expect(page.locator('.step.needs')).toHaveCount(0);
  await expect(page.locator('#study-title')).toHaveValue('Mistake');

  // 2012 style: audio files loose in the folder are the voices to rate, with no references.
  await chooseFolder(page, 'Old');
  await expect(page.locator('.found')).toContainText('2 voices to rate, loose in the folder (2012 style)');
  await expect(page.locator('.found')).toContainText('No Ref folder, so there are no references');
  await expect(page.getByRole('button', { name: 'Try it now' })).toBeEnabled();
});

test('Create without folder access (Safari, Firefox): pick the folder’s files; Save downloads study.txt', async ({ page }) => {
  await page.addInitScript(() => delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker);
  await toCreate(page);
  await page.locator('input[type="file"]').setInputFiles('public/examples');
  await expect(page.locator('.found')).toContainText('8 voices to rate in Test');
  await expect(page.locator('.found')).toContainText('5 reference voices in Ref');
  await expect(page.locator('.found')).toContainText('Settings read from study.txt.');
  await expect(page.locator('#study-title')).toHaveValue('Example files');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('study.txt');
  await expect(page.locator('.status')).toContainText('Put it in the study folder');
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
