import { expect, test, type Page } from '@playwright/test';
import { strToU8, unzipSync, zipSync } from 'fflate';

// Playwright hands files over as Node buffers; declared here so the browser-side tsconfig needn't load Node's types.
declare const Buffer: { from(data: Uint8Array): unknown };

/** A study package as described in docs/study-format.md. */
function studyZip(studyTxt: string, test: Record<string, string>, refs: Record<string, string> = {}): Uint8Array {
  const folder = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([n, b]) => [n, strToU8(b)]));
  return zipSync({
    'study.txt': strToU8(studyTxt),
    TestItems: folder(test),
    ...(Object.keys(refs).length ? { RefItems: folder(refs) } : {}),
  });
}

async function openStudy(page: Page, zip: Uint8Array, name = 'study.zip') {
  await page.locator('[data-input-study]').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(zip) as never });
}

const box = (page: Page, name: string) => page.locator(`input[name="${name}"]`);

test('opening a study fixes its settings, leaves blank ones to the rater, and shows its instructions', async ({ page }) => {
  await page.goto('/');
  await openStudy(
    page,
    studyZip(
      [
        'title = Locked study',
        'version = 3',
        'instructions = Listen to every voice before ranking.',
        'random = no',
        'numbers = yes',
        'leave_unrated = yes',
        'play_count =',
        'colour = blue',
      ].join('\n'),
      { 'a.wav': 'AAAA', 'b.wav': 'BBBB' },
    ),
  );
  await expect(page.locator('[data-loaded]')).toContainText('Study: “Locked study”, version 3');
  await expect(page.locator('[data-warnings]')).toContainText('unknown setting “colour” ignored');
  await expect(page.locator('[data-status="samples"]')).toHaveText(/^Rating 2 WAV files in “Locked study v3 #[0-9a-f]{8}”\.$/);

  // Fixed: shown as set, greyed out, marked.
  await expect(box(page, 'random')).not.toBeChecked();
  await expect(box(page, 'random')).toBeDisabled();
  await expect(box(page, 'numbers')).toBeChecked();
  await expect(box(page, 'numbers')).toBeDisabled();
  await expect(box(page, 'canLeave')).toBeChecked();
  await expect(page.locator('label', { has: box(page, 'numbers') })).toContainText('(set by this study)');
  // No RefItems in the package: no references, and that is fixed too.
  await expect(box(page, 'useRefs')).not.toBeChecked();
  await expect(box(page, 'useRefs')).toBeDisabled();
  // Blank or missing: the rater may change them.
  await expect(box(page, 'showCount')).toBeEnabled();
  await expect(box(page, 'names')).toBeEnabled();
  // The study supplies the files, so the folder buttons are locked.
  await expect(page.locator('[data-pick="samples"]')).toBeDisabled();

  await page.locator('#rater').fill('Rater 1');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.study-instructions')).toHaveText('Listen to every voice before ranking.');
  await expect(page.locator('.box.unrated .tile-label').first()).toHaveText('1'); // numbers = yes
  await page.getByRole('button', { name: 'Finished rating' }).click(); // leave_unrated = yes
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('[data-kept]')).toContainText('“Locked study v3”: 1 session');

  // Close study: back to the user's own set-up, nothing locked.
  await page.getByRole('button', { name: 'Close study' }).click();
  await expect(page.locator('[data-loaded]')).toContainText('No study loaded');
  await expect(box(page, 'random')).toBeEnabled();
  await expect(box(page, 'useRefs')).toBeEnabled();
});

test('a study that cannot be used is refused with a plain explanation', async ({ page }) => {
  await page.goto('/');
  await openStudy(page, studyZip('title = Bad\nrandom = sometimes', { 'a.wav': 'A' }));
  await expect(page.locator('dialog')).toContainText('line 2: “random = sometimes” should be yes, no or blank');
  await page.getByRole('button', { name: 'OK' }).click();
  await openStudy(page, zipSync({ 'study.txt': strToU8('title = Empty') }));
  await expect(page.locator('dialog')).toContainText('no WAV files in TestItems');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('[data-loaded]')).toContainText('No study loaded');
});

test('Save as study writes a package with the files and settings that loads straight back', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="canLeave"]').check();
  await page.locator('input[name="random"]').uncheck();
  await page.locator('[data-input-files]').setInputFiles([
    { name: 'x.wav', mimeType: 'audio/wav', buffer: Buffer.from(strToU8('XXXX')) as never },
    { name: 'y.wav', mimeType: 'audio/wav', buffer: Buffer.from(strToU8('YYYY')) as never },
  ]);
  await page.getByRole('button', { name: 'Save as study…' }).click();
  await page.getByLabel('Study title').fill('My saved study');
  await page.getByLabel('Instructions for raters (optional)').fill('Line one\nLine two');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save study' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('My saved study.zip');

  // Read the zip back: study.txt fixes every option as it was, and the audio is inside.
  const bytes = await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], saved.url());
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files).filter((n) => !n.endsWith('/')).sort()).toEqual(['TestItems/x.wav', 'TestItems/y.wav', 'study.txt']);
  const studyTxt = new TextDecoder().decode(files['study.txt']);
  expect(studyTxt).toContain('title         = My saved study');
  expect(studyTxt).toContain('instructions  = Line two');
  expect(studyTxt).toMatch(/leave_unrated = yes/);
  expect(studyTxt).toMatch(/random\s+= no/);

  // …and it opens as a study.
  await openStudy(page, new Uint8Array(bytes), 'My saved study.zip');
  await expect(page.locator('[data-loaded]')).toContainText('Study: “My saved study”, version 1');
  await expect(box(page, 'canLeave')).toBeChecked();
  await expect(box(page, 'canLeave')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save as study…' })).toBeHidden();
});

test('a ?study= link opens that study when NeAR starts', async ({ page }) => {
  await page.goto('/?study=examples/NeAR-examples.zip');
  await expect(page.locator('[data-loaded]')).toContainText('Study: “Example files”, version 1');
  await expect(page.locator('[data-status="samples"]')).toContainText('Rating 8 WAV files');
});

test('a changed package is a different study with its own results; the same package carries on', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="canLeave"]').check();
  const v1 = studyZip('title = Versioned\nversion = 1\nleave_unrated = yes', { 'a.wav': 'A' });
  const v2 = studyZip('title = Versioned\nversion = 2\nleave_unrated = yes', { 'a.wav': 'A' });
  const session = async () => {
    await page.locator('#rater').fill('R' + Math.random().toString(36).slice(2, 6));
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('button', { name: 'Finished rating' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await page.getByRole('button', { name: 'Not now' }).click();
  };
  await openStudy(page, v1);
  await session();
  await expect(page.locator('[data-kept]')).toContainText('“Versioned v1”: 1 session');
  await openStudy(page, v2);
  await expect(page.locator('[data-kept]')).toContainText('No results kept in this browser for “Versioned v2” yet.');
  await openStudy(page, v1);
  await expect(page.locator('[data-kept]')).toContainText('“Versioned v1”: 1 session');
});
