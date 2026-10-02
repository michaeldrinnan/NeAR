import { expect, test, type Page } from '@playwright/test';

interface Examples {
  samples: string[];
  references: string[];
}

/** Drags a tile with real mouse moves, the way a rater would. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

test('a demo session with the example files saves the expected ranks', async ({ page, request }, testInfo) => {
  const examples = (await (await request.get('examples/examples.json')).json()) as Examples;
  const key = await (await request.get('examples/ANSWER-KEY.txt')).text();
  const keyLines = key.split(/\r?\n/);
  const bestFirst = keyLines[keyLines.findIndex((l) => l.startsWith('Answer key')) + 1].trim().split(', ');
  expect(bestFirst).toHaveLength(8);

  await page.goto('/');
  await page.getByRole('button', { name: 'Try with example files' }).click();
  await expect(page.locator('[data-status="samples"]')).toHaveText('Rating 8 WAV files in “Example files”.');
  await expect(page.locator('[data-status="refs"]')).toHaveText('Using 5 WAV files as reference in “Example references”.');
  await expect(page.locator('#rater')).toHaveValue('Demo');
  // The examples have their own built-in study, so the demo needs no study choice: just Start.
  await expect(page.locator('[data-kept]')).toHaveText('No results kept in this browser for “Example files” yet.');
  const animate = page.locator('input[name="animate"]');
  await expect(animate).toBeChecked(); // on by default
  if (testInfo.project.name === 'not-animated') await animate.uncheck();
  await page.locator('input[name="showCount"]').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // Instructions are plain paragraphs (a stray flex layout once split them around the bold 'Play').
  await expect(page.locator('.rating p.hint').first()).toHaveCSS('display', 'block');

  const rated = page.locator('.box.rated');
  await expect(rated.locator('.tile.ref')).toHaveCount(5);
  await expect(page.locator('.box.unrated .tile')).toHaveCount(8);

  // Playing a sample loads it into the player without an error.
  await page.locator('.box.unrated .tile .play').first().click();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.box.unrated .tile .play').first()).toHaveText('1');

  // Play counts include the references, as in the 2012 version.
  const refPlay = rated.locator('.tile.ref .play').first();
  await refPlay.click();
  await refPlay.click();
  await expect(refPlay).toHaveText('2');

  // Drop each sample, best first, into the empty space after the references.
  for (const name of bestFirst) {
    const tile = page.locator(`[data-id="s:${name}.wav"]`);
    const t = (await tile.boundingBox())!;
    const box = (await rated.boundingBox())!;
    await drag(page, { x: t.x + t.width / 2, y: t.y + 20 }, { x: box.x + box.width - 20, y: box.y + box.height - 15 });
    await page.waitForTimeout(400); // let the slide and settle animations finish
  }
  await expect(page.locator('.count')).toHaveText('0 of 8 left to rate');

  // Swapping: dragging a rated sample over its neighbour moves it past, and dragging it back restores the order.
  const ratedIds = () => rated.locator('.tile').evaluateAll((ts) => ts.map((t) => (t as HTMLElement).dataset.id));
  const grip = async (name: string) => {
    const b = (await page.locator(`[data-id="s:${name}.wav"]`).boundingBox())!;
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

  await page.getByRole('button', { name: 'Finished rating' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.saved')).toContainText('Saved to this browser');

  const lines = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('near');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          // Each explicitly chosen study has its own persistent ID.
          const store = open.result.transaction('kv').objectStore('kv');
          const keys = store.getAllKeys();
          keys.onerror = () => reject(keys.error);
          keys.onsuccess = () => {
            const key = (keys.result as string[]).filter((k) => k.startsWith('study:'));
            if (key.length !== 1) return reject(new Error(`expected one example-files store, found ${key.length}`));
            const get = store.get(key[0]);
            get.onsuccess = () => resolve(get.result.lines as string[]);
            get.onerror = () => reject(get.error);
          };
        };
      }),
  );

  const names = examples.samples.map((p) => p.split('/').pop()!);
  expect(lines[0]).toBe(`RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,${names.join(',')}`);
  const row = lines[1].split(',');
  expect(row.slice(0, 6)).toEqual([
    'Demo',
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/),
    'Example files',
    'Example references',
    '5',
  ]);
  // References fill ranks 1-5, so the samples follow from 6 in answer-key order.
  const expected = names.map((n) => String(6 + bestFirst.indexOf(n.replace(/\.wav$/, ''))));
  expect(row.slice(6)).toEqual(expected);

  // Start can't be pressed again while a session is being set up: here the "already used" question is open.
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await start.click();
  await expect(page.locator('dialog')).toContainText('this rater ID has already been used');
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: 'No' }).click();
  await expect(start).toBeEnabled();
  await expect(page.locator('.rating')).toHaveCount(0);
});

test('dragging to the edge of the window scrolls to boxes that are off screen', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 300 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with example files' }).click();
  await expect(page.locator('[data-status="samples"]')).toContainText('Rating 8 WAV files');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.box.unrated .tile')).toHaveCount(8);

  // Scroll to the bottom; the top of the rated box is now above the window.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const rated = page.locator('.box.rated');
  const above = (await rated.boundingBox())!;
  expect(above.y).toBeLessThan(0);

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
  await expect(page.locator('.count')).toHaveText('7 of 8 left to rate');
});

// Playwright hands files over as Node buffers; declared here so the browser-side tsconfig needn't load Node's types.
declare const Buffer: { from(data: string): unknown };

/** "Choose files…" route (iPad, Safari, Firefox): every pick is labelled "Selected files". */
async function pickFiles(page: Page, files: Record<string, string>) {
  await page.locator('[data-input-files]').setInputFiles(
    Object.entries(files).map(([name, body]) => ({
      name,
      mimeType: name.endsWith('.csv') ? 'text/csv' : 'audio/wav',
      buffer: Buffer.from(body) as never,
    })),
  );
}

/** Rates nothing (unrated samples allowed) and saves, adding one session to the study's results. */
async function quickSession(page: Page, rater: string) {
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await page.locator('#rater').fill(rater);
  await expect(page.locator('#rater')).toHaveValue(rater);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Finished rating' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.saved')).toContainText('Saved to this browser');
}

test('browser-kept results are kept per study, summarised, and a differing NeAR.csv is asked about', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="canLeave"]').check();
  const kept = page.locator('[data-kept]');
  const studyA = { 'a1.wav': 'AAAA', 'a2.wav': 'AAAAAA' };
  const studyB = { 'a1.wav': 'BBBB', 'a2.wav': 'BBBBBB' }; // same filenames and sizes; different audio

  // (c) The start screen says what this browser already keeps for the chosen study.
  await pickFiles(page, studyA);
  await chooseNewStudy(page, 'Study A');
  await expect(kept).toContainText('No results kept');
  await quickSession(page, 'Rater 1');
  await expect(kept).toHaveText(/^Results kept in this browser for “Study A”: 1 session, last on \d{4}-\d{2}-\d{2}\.$/);

  // (a) Another "Choose files…" pick is a different study, so it starts empty instead of sharing A's results.
  await pickFiles(page, studyB);
  await page.locator('[data-study]').click();
  await expect(page.locator('dialog option').filter({ hasText: 'Study A' })).toHaveJSProperty('disabled', true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await chooseNewStudy(page, 'Study B');
  await expect(kept).toContainText('No results kept');
  // Re-picking A: the one study holding these recordings is already selected, so Continue carries on with it.
  await pickFiles(page, studyA);
  await page.locator('[data-study]').click();
  const studyAId = await page.locator('dialog option').filter({ hasText: 'Study A —' }).getAttribute('value');
  await expect(page.getByRole('combobox', { name: 'Study', exact: true })).toHaveValue(studyAId!);
  await expect(page.getByLabel('New study name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(kept).toContainText('1 session');

  // (b) The same study picked with a NeAR.csv that differs from the browser's copy: NeAR asks which to use.
  const folderCsv = 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,a1.wav,a2.wav\r\nOld,2020-01-01,09:00:00,Lab,,0,1,2\r\nOlder,2020-01-02,09:00:00,Lab,,0,2,1\r\n';
  await pickFiles(page, { ...studyA, 'NeAR.csv': folderCsv });
  await chooseExistingStudy(page, 'Study A');
  await page.locator('#rater').fill('Rater 2');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const question = page.locator('dialog');
  await expect(question).toContainText('two different copies');
  await expect(question).toContainText('NeAR.csv in the folder you chose: 2 sessions, last on 2020-01-02');
  await expect(question).toContainText('the copy kept in this browser: 1 session');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.rating')).toHaveCount(0);

  // Choosing the folder's file carries on from it: its 2 sessions plus the new one.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Use the folder’s file' }).click();
  await page.getByRole('button', { name: 'Finished rating' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(kept).toContainText('3 sessions');
});

async function chooseNewStudy(page: Page, name: string) {
  await page.locator("[data-study]").click();
  await page.getByRole('combobox', { name: 'Study', exact: true }).selectOption('new');
  await page.getByLabel("New study name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
}

async function chooseExistingStudy(page: Page, name: string) {
  await page.locator("[data-study]").click();
  const id = await page.locator("dialog option").filter({ hasText: name + " —" }).getAttribute("value");
  await page.getByRole('combobox', { name: 'Study', exact: true }).selectOption(id!);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
}

test('identical recordings can belong to separate studies', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="canLeave"]').check();
  await pickFiles(page, { 'a.wav': 'AAAA' });
  await chooseNewStudy(page, 'First study');
  await quickSession(page, 'First rater');
  await chooseNewStudy(page, 'Second study');
  await expect(page.locator('[data-kept]')).toContainText('No results kept');
  await chooseExistingStudy(page, 'First study');
  await expect(page.locator('[data-kept]')).toContainText('1 session');
});

test('older results can be downloaded, cancelled, and recovered without deleting the originals', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('near', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
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
  await page.locator('[data-recover]').click();
  await expect(page.locator('dialog select option')).toHaveCount(2);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download older results', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('NeAR recovered results.csv');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await pickFiles(page, { 'a.wav': 'AAAA' });
  await page.locator('[data-recover]').click();
  await expect(page.locator('dialog')).toContainText('Sample columns match');
  await expect(page.locator('dialog')).toContainText('1 session, last on 2020-01-01');
  await page.getByRole('button', { name: 'Recover into new study', exact: true }).click();
  await expect(page.locator('[data-kept]')).toContainText('1 session');
  await page.locator('[data-recover]').click();
  await expect(page.locator('dialog select option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('Start is unavailable throughout a delayed save, failed save and retry', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { csv: '', attempts: 0, release: (_fail: boolean) => {} };
    (window as unknown as { testSave: typeof state }).testSave = state;
    const sample = { kind: 'file', getFile: async () => new File(['AAAA'], 'a.wav') };
    const results = {
      getFile: async () => new File([state.csv], 'NeAR.csv'),
      createWritable: async () => {
        let pending = '';
        return {
          write: async (text: string) => { pending = text; },
          close: () => new Promise<void>((resolve, reject) => {
            state.attempts++;
            state.release = (fail: boolean) => {
              if (fail) reject(new Error('Simulated disk failure'));
              else { state.csv = pending; resolve(); }
            };
          }),
        };
      },
    };
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => ({
      name: 'Test folder', kind: 'directory',
      async *entries() { yield ['a.wav', sample]; },
      getFileHandle: async (_name: string, options?: { create?: boolean }) => {
        if (!state.csv && !options?.create) throw new DOMException('Missing', 'NotFoundError');
        return results;
      },
    }) });
  });
  await page.goto('/');
  await page.locator('[data-pick="samples"]').click();
  await page.locator('input[name="canLeave"]').check();
  await page.locator('#rater').fill('Rater 1');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Finished rating' }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByText('Saving results…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  const attempts = () => page.evaluate(() => (window as unknown as { testSave: { attempts: number } }).testSave.attempts);
  const release = (fail: boolean) => page.evaluate((f) => (window as unknown as { testSave: { release(fail: boolean): void } }).testSave.release(f), fail);
  await expect.poll(attempts).toBe(1);
  await release(true);
  await expect(page.locator('dialog')).toContainText('Your results have not been saved');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect.poll(attempts).toBe(2);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await release(false);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await expect(page.locator('.saved')).toContainText('Saved to');
  await page.locator('#rater').fill('Rater 2');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Finished rating' }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect.poll(attempts).toBe(3);
  await release(false);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  const csv = await page.evaluate(() => (window as unknown as { testSave: { csv: string } }).testSave.csv);
  expect(csv).toContain('Rater 1,');
  expect(csv).toContain('Rater 2,');
  // Explicit abandonment also releases the application-level guard.
  await page.locator('#rater').fill('Rater 3');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Finished rating' }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect.poll(attempts).toBe(4);
  await release(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await expect(page.locator('.saved')).toContainText('NOT saved');
});

test('a study created for a session that is then abandoned is removed again', async ({ page }) => {
  await page.goto('/');
  // The folder's NeAR.csv belongs to other recordings, so NeAR will ask to reset it; cancelling abandons the session.
  await pickFiles(page, { 'a.wav': 'AAAA', 'NeAR.csv': 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,other.wav\r\n' });
  await page.locator('#rater').fill('Rater');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('New study name', { exact: true }).fill('Abandoned');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('have changed since the last session');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(page.locator('[data-kept]')).toContainText('Choose a study before starting');
  await page.locator('[data-study]').click();
  await expect(page.locator('dialog option').filter({ hasText: 'Abandoned' })).toHaveCount(0);
});

test('a study can be deleted from the chooser, with its results downloaded first', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="canLeave"]').check();
  await pickFiles(page, { 'a.wav': 'AAAA' });
  await chooseNewStudy(page, 'Old study');
  await quickSession(page, 'Rater 1');
  await chooseNewStudy(page, 'Keep me');

  await page.locator('[data-study]').click();
  await page.getByRole('button', { name: 'Delete…' }).click();
  const target = page.getByRole('combobox', { name: 'Study to delete' });
  const id = await page.locator('dialog option').filter({ hasText: 'Old study —' }).getAttribute('value');
  await target.selectOption(id!);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download results' }).click();
  expect((await download).suggestedFilename()).toBe('NeAR Old study.csv');

  await page.getByRole('button', { name: 'Delete study' }).click();
  await page.getByRole('button', { name: 'Keep it' }).click(); // changed mind: nothing deleted
  await page.getByRole('button', { name: 'Delete study' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  // Back in the chooser: the deleted study is gone, the other remains.
  await expect(page.locator('dialog option').filter({ hasText: 'Old study' })).toHaveCount(0);
  await expect(page.locator('dialog option').filter({ hasText: 'Keep me' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-kept]')).toContainText('“Keep me”');
});

test('abandoning a Start never removes a study that already existed, even an empty one', async ({ page }) => {
  await page.goto('/');
  await pickFiles(page, { 'a.wav': 'AAAA' });
  await chooseNewStudy(page, 'Existing but empty');

  // Same recordings again, now with a NeAR.csv for other files: Start will ask to reset it.
  await pickFiles(page, { 'a.wav': 'AAAA', 'NeAR.csv': 'RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,other.wav\r\n' });
  await page.locator('#rater').fill('Rater');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Study', exact: true })).not.toHaveValue('new'); // the existing study is pre-selected
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('have changed since the last session');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.locator('[data-study]').click();
  await expect(page.locator('dialog option').filter({ hasText: 'Existing but empty' })).toHaveCount(1);
});

test('the demo uses its own built-in study, not a user study with the same name and recordings', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="canLeave"]').check();
  await page.getByRole('button', { name: 'Try with example files' }).click();
  await expect(page.locator('[data-status="samples"]')).toContainText('Rating 8 WAV files');
  // Make a study of one's own from the example recordings, and call it "Example files" too.
  await chooseNewStudy(page, 'Example files');

  // Loading the examples again picks NeAR's built-in study; a demo session goes there.
  await page.getByRole('button', { name: 'Try with example files' }).click();
  await expect(page.locator('[data-kept]')).toContainText('“Example files”');
  await quickSession(page, 'Demo');

  const studies = await page.evaluate(
    () =>
      new Promise<{ name: string; builtin?: string; lines: string[] | null }[]>((resolve, reject) => {
        const open = indexedDB.open('near');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction('kv').objectStore('kv');
          const all = store.getAll();
          all.onsuccess = () => resolve((all.result as { name?: string }[]).filter((v) => v && typeof v === 'object' && 'name' in v) as never);
          all.onerror = () => reject(all.error);
        };
      }),
  );
  const builtin = studies.filter((s) => s.builtin === 'examples');
  const own = studies.filter((s) => s.name === 'Example files' && !s.builtin);
  expect(builtin).toHaveLength(1);
  expect(own).toHaveLength(1);
  expect(builtin[0].lines).toHaveLength(2); // header + the demo session
  expect(own[0].lines).toBeNull(); // the user's own study is untouched
});

test('only one NeAR session runs at a time across windows, and the download after saving matches what was saved', async ({ context }) => {
  const busy = 'A session is already active in another NeAR window. Finish or close it before continuing.';
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const p of [a, b]) {
    await p.goto('/');
    await p.locator('input[name="canLeave"]').check();
    await p.getByRole('button', { name: 'Try with example files' }).click();
    await expect(p.locator('[data-status="samples"]')).toContainText('Rating 8 WAV files');
  }

  // Window A starts a session and holds it.
  await a.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(a.locator('.rating')).toHaveCount(1);

  // Window B can't start, download, import or change studies meanwhile.
  const refused = async (act: () => Promise<void>) => {
    await act();
    await expect(b.locator('dialog')).toContainText(busy);
    await b.getByRole('button', { name: 'OK' }).click();
  };
  await refused(() => b.getByRole('button', { name: 'Start', exact: true }).click());
  await refused(() => b.getByRole('button', { name: 'Download NeAR.csv' }).click());
  await refused(() => b.locator('[data-study]').click());
  await refused(() =>
    b.locator('[data-input-csv]').setInputFiles({ name: 'NeAR.csv', mimeType: 'text/csv', buffer: Buffer.from('RATER,DATE\r\n') as never }),
  );
  await expect(b.locator('.rating')).toHaveCount(0);

  // A finishes and takes the offered download: it is exactly what was saved.
  await a.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      void blob.text().then((t) => ((window as unknown as { lastDownload: string }).lastDownload = t));
      return original(blob);
    };
  });
  await a.getByRole('button', { name: 'Finished rating' }).click();
  await a.getByRole('button', { name: 'Yes' }).click();
  await a.getByRole('button', { name: 'Download' }).click();
  await expect(a.locator('.saved')).toContainText('Saved to this browser');
  const downloaded = await a.waitForFunction(() => (window as unknown as { lastDownload?: string }).lastDownload).then((h) => h.jsonValue());
  const stored = await a.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('near');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('kv').objectStore('kv').getAll();
          all.onsuccess = () => resolve((all.result as { builtin?: string; lines: string[] }[]).find((v) => v?.builtin === 'examples')!.lines);
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(downloaded).toBe(stored.map((l) => l + '\r\n').join(''));

  // Now that A has finished, B can start (as a different rater, to skip the "already used" question).
  await b.locator('#rater').fill('Demo B');
  await b.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(b.locator('.rating')).toHaveCount(1);
});

test('closing the window that holds a session frees it for other windows', async ({ context }) => {
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const p of [a, b]) {
    await p.goto('/');
    await p.getByRole('button', { name: 'Try with example files' }).click();
    await expect(p.locator('[data-status="samples"]')).toContainText('Rating 8 WAV files');
  }
  await a.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(a.locator('.rating')).toHaveCount(1);
  await a.close({ runBeforeUnload: false });
  await b.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(b.locator('.rating')).toHaveCount(1);
});
