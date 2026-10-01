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

test('a demo session with the example files saves the expected ranks', async ({ page, request }) => {
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
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const rated = page.locator('.box.rated');
  await expect(rated.locator('.tile.ref')).toHaveCount(5);
  await expect(page.locator('.box.unrated .tile')).toHaveCount(8);

  // Playing a sample loads it into the player without an error.
  await page.locator('.box.unrated .tile .play').first().click();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('dialog')).toHaveCount(0);

  // Drop each sample, best first, into the empty space after the references.
  for (const name of bestFirst) {
    const tile = page.locator(`[data-id="s:${name}.wav"]`);
    const t = (await tile.boundingBox())!;
    const box = (await rated.boundingBox())!;
    await drag(page, { x: t.x + t.width / 2, y: t.y + 20 }, { x: box.x + box.width - 20, y: box.y + box.height - 15 });
  }
  await expect(page.locator('.count')).toHaveText('0 of 8 left to rate');

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
          const get = open.result.transaction('kv').objectStore('kv').get('results:Example files');
          get.onsuccess = () => resolve(get.result as string[]);
          get.onerror = () => reject(get.error);
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
});
