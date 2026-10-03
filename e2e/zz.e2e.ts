import { test } from '@playwright/test';
test('repro-handles', async ({ page }) => {
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('/');
  // Copy the folder into the origin-private file system, then hand its real handle to NeAR as if picked.
  await page.locator('body').evaluate(() => {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = 'loader'; i.webkitdirectory = true; document.body.append(i);
  });
  await page.locator('#loader').setInputFiles('C:/Users/MD/AppData/Local/Temp/claude/D--Dropbox-Source-Repos-Web-NeAR/ab955a77-d35a-4026-a998-76628d879ed6/scratchpad/TestItems');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('TestItems', { create: true });
    for (const f of (document.querySelector('#loader') as HTMLInputElement).files!) {
      const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
      await w.write(f); await w.close();
    }
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => dir, configurable: true });
  });
  await page.getByRole('button', { name: /Create a study/ }).click();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Choose study folder…' }).click();
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(500); if (await page.locator('.found').count()) break; }
  console.log('ELAPSED', Date.now() - t0);
  console.log('PAGE', (await page.locator('main').innerText()).slice(0, 600));
});
