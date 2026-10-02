import { expect, type Page } from '@playwright/test';

/**
 * A tiny real WAV file (8 kHz, 8-bit mono, 80 samples) as text, so browsers can decode it;
 * every byte is below 0x80, so it survives being stored as a string. `body` makes it distinct.
 */
export const W = (body: string) => {
  const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => String.fromCharCode((n >> (8 * i)) & 0xff)).join('');
  const data = body.repeat(Math.ceil(80 / body.length)).slice(0, 80);
  return `RIFF${le(36 + data.length, 4)}WAVEfmt ${le(16, 4)}${le(1, 2)}${le(1, 2)}${le(8000, 4)}${le(8000, 4)}${le(1, 2)}${le(8, 2)}data${le(data.length, 4)}${data}`;
};

/** Drags a tile with real mouse moves, the way a rater would. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

/** Home → Rate a study. */
export async function toRate(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Rate a study/ }).click();
  await expect(page.getByRole('heading', { name: 'Which study are you rating?' })).toBeVisible();
}

/** Opens a built-in example from the Rate page (0 = the default). */
export async function openExample(page: Page, index = 0) {
  await toRate(page);
  await page.locator('#example-select').selectOption(String(index));
  await page.getByRole('button', { name: 'Try it', exact: true }).click();
  await expect(page.locator('#rater')).toBeVisible();
}

/** On the Study info screen: types a session name and starts rating. */
export async function name(page: Page, rater: string) {
  await page.locator('#rater').fill(rater);
  await page.getByRole('button', { name: 'Start rating' }).click();
  await expect(page.locator('.rating')).toBeVisible();
}

/** Presses Save and finish and confirms. */
export async function saveAndFinish(page: Page) {
  await page.getByRole('button', { name: 'Save and finish' }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
}

/** The results kept in this browser, by study title. */
export function storedResults(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, string[]>>((resolve, reject) => {
        const open = indexedDB.open('near');
        open.onerror = () => reject(open.error);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onsuccess = () => {
          const all = open.result.transaction('kv').objectStore('kv').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            const out: Record<string, string[]> = {};
            for (const v of all.result as { format?: string; name?: string; lines?: string[] }[]) {
              if (v && v.format && v.name && v.lines) out[v.name] = v.lines;
            }
            open.result.close();
            resolve(out);
          };
        };
      }),
  );
}

/**
 * Stands in for Chrome's folder picker with folders held in memory: `folders` maps each
 * folder name to its files (path → text). Set window.nextFolder to the name to pick.
 * With window.holdWrites set, each write waits for window.release(fail).
 */
export async function mockFolders(page: Page, folders: Record<string, Record<string, string>>) {
  await page.addInitScript((initial) => {
    type Files = Record<string, string>;
    const w = window as unknown as {
      folders: Record<string, Files>;
      nextFolder?: string;
      holdWrites?: boolean;
      writes: number;
      release: (fail: boolean) => void;
    };
    w.folders = initial;
    w.writes = 0;
    w.release = () => {};
    const fileHandle = (root: string, path: string) => ({
      kind: 'file',
      name: path.split('/').pop(),
      getFile: async () => new File([w.folders[root][path]], path.split('/').pop()!),
      createWritable: async () => {
        let pending = '';
        return {
          write: async (data: string | Blob) => {
            pending = typeof data === 'string' ? data : await new Blob([data]).text();
          },
          close: () =>
            new Promise<void>((resolve, reject) => {
              w.writes++;
              const finish = (fail: boolean) => {
                if (fail) return reject(new Error('Simulated disk failure'));
                w.folders[root][path] = pending;
                resolve();
              };
              if (w.holdWrites) w.release = finish;
              else finish(false);
            }),
        };
      },
    });
    const dir = (root: string, prefix: string): unknown => ({
      kind: 'directory',
      name: prefix ? prefix.slice(0, -1).split('/').pop() : root,
      async *entries() {
        const seen = new Set<string>();
        for (const p of Object.keys(w.folders[root])) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          const i = rest.indexOf('/');
          if (i < 0) yield [rest, fileHandle(root, p)];
          else if (!seen.has(rest.slice(0, i))) {
            seen.add(rest.slice(0, i));
            yield [rest.slice(0, i), dir(root, prefix + rest.slice(0, i) + '/')];
          }
        }
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const p = prefix + name;
        if (!(p in w.folders[root])) {
          if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
          w.folders[root][p] = '';
        }
        return fileHandle(root, p);
      },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      isSameEntry: async () => false,
    });
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => {
        if (!w.nextFolder) throw new DOMException('Cancelled', 'AbortError');
        return dir(w.nextFolder, '');
      },
    });
  }, folders);
}

export const pickFolder = (page: Page, folder: string) => page.evaluate((f) => ((window as unknown as { nextFolder: string }).nextFolder = f), folder);
export const folderFiles = (page: Page, folder: string) =>
  page.evaluate((f) => (window as unknown as { folders: Record<string, Record<string, string>> }).folders[f], folder);
