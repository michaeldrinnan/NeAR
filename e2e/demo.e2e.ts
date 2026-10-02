import { expect, test } from '@playwright/test';
import { drag, folderFiles, mockFolders, name, openExample, pickFolder, saveAndFinish, storedResults, toRate, W } from './helpers';

interface Examples {
  samples: string[];
  references: string[];
}

test('a demo session with the example study saves the expected ranks', async ({ page, request }, testInfo) => {
  const examples = (await (await request.get('examples/examples.json')).json()) as Examples;
  // The order this test rates the samples in: any order will do (there is no "right" order),
  // so use one that differs from the files' own order to check the saved ranks properly.
  const bestFirst = examples.samples.map((p) => p.split('/').pop()!.replace(/\.wav$/, '')).reverse();
  expect(bestFirst).toHaveLength(8);

  // Home has four bars, each opening its own page.
  await page.goto('/');
  await expect(page.locator('.bar h2')).toHaveText(['New to NeAR?', 'Create a study', 'Rate a study', 'Results']);
  await openExample(page);

  // The Study info screen: the study's title, what it holds, its instructions, how to rate, where results go; no options.
  await expect(page.locator('.study-title')).toHaveText('Example files');
  await expect(page.locator('.meta')).toHaveText(/^8 voices · 5 references · study #[0-9a-f]{8}$/);
  await expect(page.locator('.instr')).toContainText('Rank them from the clearest voice');
  await expect(page.locator('.how')).toContainText('The plain blue samples are references');
  await expect(page.locator('.results-note')).toHaveText(/^Results are kept in this browser as NeAR_Example files_[0-9a-f]{8}\.csv\. No sessions saved yet\.$/);
  await expect(page.locator('input[type="checkbox"]:not([name="animate"])')).toHaveCount(0);

  // Animation is each rater's own preference: on by default.
  const animate = page.locator('input[name="animate"]');
  await expect(animate).toBeChecked();
  if (testInfo.project.name === 'not-animated') await animate.uncheck();

  // Rating can't start until the session has a name.
  await expect(page.getByRole('button', { name: 'Start rating' })).toBeDisabled();
  await name(page, 'Demo');

  // The rating screen itself: one bar, the instructions, and the two boxes.
  await expect(page.locator('.rating > *')).toHaveCount(6); // bar, instructions, prompt, box, prompt, box
  await expect(page.locator('.prompt')).toHaveText(['Put the BEST sample here at top left. Reference samples are plain blue and cannot be moved.', /^In the box below are the unrated samples/]);
  await expect(page.getByText(/left to rate/)).toHaveCount(0);
  await expect(page.locator('.rating-instr')).toContainText('Rank them from the clearest voice');
  await expect(page.locator('#rater')).toHaveCount(0);

  const rated = page.locator('.box.rated');
  await expect(rated.locator('.tile.ref')).toHaveCount(5);
  await expect(page.locator('.box.unrated .tile')).toHaveCount(8);
  // The example study fixes number labels on and play counts off.
  await expect(page.locator('.box.unrated .tile-label')).toHaveCount(8);

  // Playing a sample loads it into the player without an error.
  await page.locator('.box.unrated .tile .play').first().click();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.box.unrated .tile .play').first()).toHaveText('Play');

  // Drop each sample, best first, into the empty space after the references.
  for (const n of bestFirst) {
    const tile = page.locator(`[data-id="s:${n}.wav"]`);
    const t = (await tile.boundingBox())!;
    const box = (await rated.boundingBox())!;
    await drag(page, { x: t.x + t.width / 2, y: t.y + 20 }, { x: box.x + box.width - 20, y: box.y + box.height - 15 });
    await page.waitForTimeout(400); // let the slide and settle animations finish
  }
  await expect(page.locator('.box.unrated .tile')).toHaveCount(0);

  // Swapping: dragging a rated sample over its neighbour moves it past, and dragging it back restores the order.
  const ratedIds = () => rated.locator('.tile').evaluateAll((ts) => ts.map((t) => (t as HTMLElement).dataset.id));
  const grip = async (n: string) => {
    const b = (await page.locator(`[data-id="s:${n}.wav"]`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + 20 };
  };
  const [first, second] = bestFirst;
  await drag(page, await grip(first), await grip(second));
  await page.waitForTimeout(400);
  expect((await ratedIds()).slice(5, 7)).toEqual([`s:${second}.wav`, `s:${first}.wav`]);
  await drag(page, await grip(first), await grip(second));
  await page.waitForTimeout(400);
  expect((await ratedIds()).slice(5, 7)).toEqual([`s:${first}.wav`, `s:${second}.wav`]);
  await expect(page.locator('.drag-avatar')).toHaveCount(0);

  await saveAndFinish(page);
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.saved')).toContainText('Saved to this browser');
  await expect(page.locator('dialog')).toHaveCount(0); // nothing is "marked": NeAR has no answer key

  const lines = (await storedResults(page))['Example files'];
  const names = examples.samples.map((p) => p.split('/').pop()!);
  expect(lines[0]).toBe(`RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,${names.join(',')}`);
  const row = lines[1].split(',');
  expect(row.slice(0, 6)).toEqual([
    'Demo',
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/),
    expect.stringMatching(/^Example files #[0-9a-f]{8}$/),
    'Ref',
    '5',
  ]);
  // References fill ranks 1-5, so the samples follow from 6 in the order they were placed.
  const expected = names.map((n) => String(6 + bestFirst.indexOf(n.replace(/\.wav$/, ''))));
  expect(row.slice(6)).toEqual(expected);

  // Another session straight away; a session name already used is questioned when saving.
  await page.getByRole('button', { name: 'Start another session' }).click();
  await expect(page.locator('.results-note')).toContainText('1 session, last on');
  await expect(page.locator('#rater')).toHaveValue('Demo'); // the name carries over, to change or keep
  await page.getByRole('button', { name: 'Start rating' }).click();
  await page.getByRole('button', { name: 'Save and finish' }).click();
  await expect(page.locator('dialog')).toContainText('All the samples must be rated'); // the example fixes this
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Save and finish' }).click({ modifiers: ['Control'] }); // the supervisor's override
  await expect(page.locator('dialog')).toContainText('The session name “Demo” has already been used for this study');
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await expect(page.locator('.rating')).toHaveCount(1);
});

test('dragging to the edge of the window scrolls to boxes that are off screen', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 400 });
  await openExample(page);
  await name(page, 'Scroller');
  await expect(page.locator('.box.unrated .tile')).toHaveCount(8);

  // Scroll to the bottom; the top of the rated box is now above the window.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const rated = page.locator('.box.rated');
  expect((await rated.boundingBox())!.y).toBeLessThan(0);

  // Pick up a sample and hold it at the top edge: the page scrolls up by itself.
  const tile = (await page.locator('.box.unrated .tile').first().boundingBox())!;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + 20);
  await page.mouse.down();
  await page.mouse.move(tile.x + tile.width / 2, 8, { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBe(0);

  // Now the rated box is in view: drop the sample into it.
  const box = (await rated.boundingBox())!;
  await page.mouse.move(box.x + box.width - 30, box.y + 40, { steps: 10 }); // empty space beside the references
  await page.mouse.up();
  await expect(page.locator('.box.unrated .tile')).toHaveCount(7);
});

test('Back from the rating screen always asks, with Keep rating as the safe choice', async ({ page }) => {
  await openExample(page);
  await name(page, 'Undecided');

  // Study info, mid-session: the same information read-only; returning keeps every tile where it was.
  const tile = page.locator('.box.unrated .tile').first();
  const t = (await tile.boundingBox())!;
  const r = (await page.locator('.box.rated').boundingBox())!;
  await drag(page, { x: t.x + t.width / 2, y: t.y + 20 }, { x: r.x + r.width - 20, y: r.y + r.height - 15 });
  await expect(page.locator('.box.unrated .tile')).toHaveCount(7);
  const order = await page.locator('.tile').evaluateAll((ts) => ts.map((x) => (x as HTMLElement).dataset.id));
  await page.getByRole('button', { name: 'Study info' }).click();
  const info = page.locator('dialog');
  await expect(info.locator('.study-title')).toHaveText('Example files');
  await expect(info).toContainText('Session name: Undecided');
  await expect(info.locator('input:not([name="animate"])')).toHaveCount(0); // the name is fixed once rating has started
  await info.getByRole('button', { name: 'Return to rating' }).click();
  expect(await page.locator('.tile').evaluateAll((ts) => ts.map((x) => (x as HTMLElement).dataset.id))).toEqual(order);

  const back = page.getByRole('button', { name: '← Back' });
  await back.click();
  const dialog = page.locator('dialog');
  await expect(dialog.locator('h2')).toHaveText('Leave this rating session?');
  await expect(dialog.getByRole('button', { name: 'Keep rating' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Leave without saving' })).toHaveClass(/danger/);
  await page.keyboard.press('Escape'); // Escape keeps rating too
  await expect(page.locator('.rating')).toHaveCount(1);
  await back.click();
  await page.getByRole('button', { name: 'Keep rating' }).click();
  await expect(page.locator('.box.unrated .tile')).toHaveCount(7);
  await back.click();
  await page.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.getByRole('heading', { name: 'Which study are you rating?' })).toBeVisible();
  expect(await storedResults(page)).toEqual({}); // nothing saved, nothing left behind
});

test('a session name with a comma can’t start rating, with a note; Back from Study info needs no warning', async ({ page }) => {
  await openExample(page);
  await page.locator('#rater').fill('Smith, J');
  await expect(page.locator('.field-note')).toContainText('can’t contain a comma');
  await expect(page.getByRole('button', { name: 'Start rating' })).toBeDisabled();
  await page.locator('#rater').fill('Smith J');
  await expect(page.locator('.field-note')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start rating' })).toBeEnabled();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByRole('heading', { name: 'Which study are you rating?' })).toBeVisible();
});

test('recent studies: carry on with the last one, or open any from the list', async ({ page }) => {
  await openExample(page, 1);
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Rate a study/ }).click();
  const panels = page.locator('.page > section h2, .page > section strong').first();
  await expect(panels).toHaveText('Example studies'); // examples stay at the top
  await expect(page.locator('.carry')).toContainText('Carry on with Example: no references');
  await expect(page.locator('.list .item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Carry on' }).click();
  await expect(page.locator('.study-title')).toHaveText('Example: no references');
  await expect(page.locator('.meta')).toContainText('8 voices · no references');
  // This example shows play counts and allows samples to be left unrated.
  await name(page, 'Counter');
  const play = page.locator('.box.unrated .tile .play').first();
  await play.click();
  await play.click();
  await expect(play).toHaveText('2');
  await expect(page.locator('.box.unrated .tile-label')).toHaveCount(0); // no number labels in this one
  await expect(page.locator('.prompt').first()).toHaveText('Put the BEST sample here at top left.'); // no references, no note about them
  await saveAndFinish(page);
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.saved')).toContainText('Saved to this browser');
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('.carry')).toContainText('1 session saved');

  // Remove asks first, warning about sessions not yet downloaded, and offers the download.
  const item = page.locator('.list .item').filter({ hasText: 'Example: no references' });
  await item.getByRole('button', { name: 'Remove' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('Its results (1 session) stay in this browser');
  await expect(dialog).toContainText('WARNING: this session has not been downloaded yet');
  await page.keyboard.press('Escape'); // keeps it
  await expect(page.locator('.list .item')).toHaveCount(1);
  await item.getByRole('button', { name: 'Remove' }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download results' }).click();
  expect((await download).suggestedFilename()).toMatch(/^NeAR_Example_ no references_[0-9a-f]{8}\.csv$/);
  await expect(dialog).not.toContainText('WARNING'); // asked again, now downloaded
  await expect(dialog).toContainText('You can open it again from Example studies.');
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.list .item')).toHaveCount(0);
});

test('Results: download with the study’s file name, import, delete, and older results', async ({ page }) => {
  await openExample(page, 1);
  await name(page, 'Rater 1');
  await saveAndFinish(page);
  const offered = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const fileName = (await offered).suggestedFilename();
  expect(fileName).toMatch(/^NeAR_Example_ no references_[0-9a-f]{8}\.csv$/);

  // Results from the two oldest browser formats, kept as a backup.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('near', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', 'readwrite');
        const lines = ['RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,a.wav', 'Old,2020-01-01,12:00:00,src,,0,1'];
        tx.objectStore('kv').put(lines, 'results:Selected files');
        tx.objectStore('kv').put(lines, 'results:Selected files:oldhash');
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });

  await page.getByRole('button', { name: '← Back' }).click(); // to Rate a study
  await page.getByRole('button', { name: '← Back' }).click(); // to Home
  await page.getByRole('button', { name: /^Results/ }).click();
  const row = page.locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Example: no references');
  await expect(row.locator('td').nth(1)).toHaveText('1');
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe(fileName);

  // Import replaces the chosen study's results.
  const header = (await storedResults(page))['Example: no references'][0];
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/csv',
    buffer: Buffer.from(`${header}\r\nA,2026-01-01,09:00:00,x,,0\r\nB,2026-01-02,09:00:00,x,,0\r\n`) as never,
  });
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('tbody tr td').nth(1)).toHaveText('2');

  // Older results can be downloaded; the originals stay.
  await page.getByRole('button', { name: 'Recover older results…' }).click();
  await expect(page.locator('dialog select option')).toHaveCount(2);
  const older = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download older results' }).click();
  expect((await older).suggestedFilename()).toBe('NeAR recovered results.csv');
  await page.getByRole('button', { name: 'Close' }).click();

  // Delete asks first, offering a download; Keep it changes nothing.
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByText('No results are kept in this browser yet.')).toBeVisible();
});

// Playwright hands files over as Node buffers; declared here so the browser-side tsconfig needn't load Node's types.
declare const Buffer: { from(data: string | Uint8Array): unknown };

const VOICES = { 'Test/a.wav': W('A'), 'Test/b.wav': W('B') };

test('in a study folder, results are written to NeAR_<title>_<code>.csv; saving waits, retries and can be abandoned', async ({ page }) => {
  await mockFolders(page, { Voices: { ...VOICES, 'study.txt': 'title = Voices\nleave_unrated = on\n' } });
  await toRate(page);
  await pickFolder(page, 'Voices');
  await page.evaluate(() => ((window as unknown as { holdWrites: boolean }).holdWrites = true));
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await expect(page.locator('.results-note')).toHaveText(/^Results are saved to NeAR_Voices_[0-9a-f]{8}\.csv in folder “Voices”\. No sessions saved yet\.$/);
  const writes = () => page.evaluate(() => (window as unknown as { writes: number }).writes);
  const release = (fail: boolean) => page.evaluate((f) => (window as unknown as { release(fail: boolean): void }).release(f), fail);

  await name(page, 'Rater 1');
  await saveAndFinish(page);
  await expect(page.getByText('Saving results…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '← Back' })).toHaveCount(0); // nowhere to go while saving
  await expect.poll(writes).toBe(1);
  await release(true);
  await expect(page.locator('dialog')).toContainText('Your results have not been saved');
  await page.getByRole('button', { name: 'Yes', exact: true }).click(); // try again
  await expect.poll(writes).toBe(2);
  await release(false);
  await expect(page.locator('.saved')).toContainText('Saved to NeAR_Voices_');

  await page.getByRole('button', { name: 'Start another session' }).click();
  await name(page, 'Rater 2');
  await saveAndFinish(page);
  await expect.poll(writes).toBe(3);
  await release(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); // abandon
  await expect(page.locator('.saved')).toContainText('NOT saved');

  const files = await folderFiles(page, 'Voices');
  const csv = Object.keys(files).find((f) => f.startsWith('NeAR_'))!;
  expect(csv).toMatch(/^NeAR_Voices_[0-9a-f]{8}\.csv$/);
  expect(files[csv]).toContain('Rater 1,');
  expect(files[csv]).not.toContain('Rater 2,');
  expect(files[csv].split('\r\n')[1].split(',')[3]).toBe(`Voices #${csv.slice(-12, -4)}`);
});

test('an old plain NeAR.csv with the same voices is offered once, as a copy', async ({ page }) => {
  const old = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,a.wav,b.wav\r\nOld,2012-01-07,09:00:00,Voices,,0,1,2\r\n';
  await mockFolders(page, { Voices: { ...VOICES, 'NeAR.csv': old } });
  await toRate(page);
  await pickFolder(page, 'Voices');
  await page.getByRole('button', { name: 'Open study folder…' }).click();
  await expect(page.locator('dialog')).toContainText('also has NeAR.csv, from an older version of NeAR, with the same voices (1 session, last on 2012-01-07)');
  await page.getByRole('button', { name: 'Carry them on' }).click();
  await expect(page.locator('.results-note')).toContainText('1 session, last on 2012-01-07 so far');
  await name(page, 'New rater');
  // No study.txt: the defaults apply, so every sample must be rated; the supervisor overrides.
  await page.getByRole('button', { name: 'Save and finish' }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.locator('.saved')).toContainText('Saved to');
  const files = await folderFiles(page, 'Voices');
  expect(files['NeAR.csv']).toBe(old); // untouched
  const csv = Object.keys(files).find((f) => /^NeAR_Voices_/.test(f))!;
  expect(files[csv]).toContain('Old,2012-01-07');
  expect(files[csv]).toContain('New rater,');

  // Now that the study has its own file, NeAR.csv isn't offered again.
  await page.getByRole('button', { name: 'Start another session' }).click();
  await expect(page.locator('.results-note')).toContainText('2 sessions');
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('only one NeAR session runs at a time across windows, and the download after saving matches what was saved', async ({ context }) => {
  const busy = 'A session is already active in another NeAR window. Finish or close it before continuing.';
  const [a, b] = [await context.newPage(), await context.newPage()];
  await openExample(a, 1); // window A holds a session
  await toRate(b);
  await b.getByRole('button', { name: 'Try it', exact: true }).click();
  await expect(b.locator('dialog')).toContainText(busy);
  await b.getByRole('button', { name: 'OK' }).click();
  await expect(b.locator('.rating')).toHaveCount(0);
  await b.getByRole('button', { name: '← Back' }).click();
  await b.getByRole('button', { name: /^Results/ }).click();
  await b.getByRole('button', { name: 'Recover older results…' }).click();
  await expect(b.locator('dialog')).toContainText(busy);
  await b.getByRole('button', { name: 'OK' }).click();

  // A finishes and takes the offered download: it is exactly what was saved.
  await a.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      void blob.text().then((t) => ((window as unknown as { lastDownload: string }).lastDownload = t));
      return original(blob as Blob);
    };
  });
  await name(a, 'Rater A');
  await saveAndFinish(a);
  await a.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(a.locator('.saved')).toContainText('Saved to this browser');
  const downloaded = await a.waitForFunction(() => (window as unknown as { lastDownload?: string }).lastDownload).then((h) => h.jsonValue());
  const stored = (await storedResults(a))['Example: no references'];
  expect(downloaded).toBe(stored.map((l) => l + '\r\n').join(''));

  // Now that A has finished, B can open the study.
  await b.getByRole('button', { name: '← Back' }).click();
  await b.getByRole('button', { name: /Rate a study/ }).click();
  await b.getByRole('button', { name: 'Try it', exact: true }).click();
  await expect(b.locator('#rater')).toHaveCount(1);
});

test('closing the window that holds a session frees it for other windows', async ({ context }) => {
  const [a, b] = [await context.newPage(), await context.newPage()];
  await openExample(a);
  await a.close({ runBeforeUnload: false });
  await openExample(b);
  await expect(b.locator('#rater')).toHaveCount(1);
});
