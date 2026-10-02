import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A tiny stand-in for IndexedDB, just enough to drive kv.ts: each request
 * succeeds or fails, then its transaction completes or aborts.
 */
type Outcome = { request: 'success' | 'error'; tx: 'complete' | 'abort'; result?: unknown };

function fakeIndexedDB(outcome: Outcome) {
  const fire = (fn: (() => void) | null) => setTimeout(() => fn?.(), 0);
  const makeRequest = () => {
    const req: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null };
    return req;
  };
  const db = {
    transaction() {
      const tx: Record<string, unknown> = { error: null, oncomplete: null, onerror: null, onabort: null };
      const op = () => {
        const req = makeRequest();
        setTimeout(() => {
          if (outcome.request === 'success') {
            req.result = outcome.result;
            (req.onsuccess as (() => void) | null)?.();
          } else {
            req.error = new DOMException('read failed', 'UnknownError');
            (req.onerror as (() => void) | null)?.();
            tx.error = req.error;
            (tx.onerror as (() => void) | null)?.();
          }
          if (outcome.tx === 'complete' && outcome.request === 'success') fire(tx.oncomplete as () => void);
          else if (outcome.tx === 'abort') {
            tx.error ??= new DOMException('quota exceeded', 'QuotaExceededError');
            fire(tx.onabort as () => void);
          }
        }, 0);
        return req;
      };
      tx.objectStore = () => ({ get: op, put: op, delete: op });
      return tx;
    },
  };
  return {
    open() {
      const req = makeRequest();
      req.result = db;
      fire(() => (req.onsuccess as (() => void) | null)?.());
      return req;
    },
  };
}

async function kvWith(outcome: Outcome) {
  vi.resetModules();
  vi.stubGlobal('indexedDB', fakeIndexedDB(outcome));
  return import('../src/lib/kv');
}

afterEach(() => vi.unstubAllGlobals());

describe('kv store', () => {
  it('returns stored values once the transaction completes', async () => {
    const kv = await kvWith({ request: 'success', tx: 'complete', result: ['a', 'b'] });
    await expect(kv.kvGet('k')).resolves.toEqual(['a', 'b']);
  });

  it('reports a write that is accepted but never committed (e.g. quota exceeded)', async () => {
    const kv = await kvWith({ request: 'success', tx: 'abort' });
    await expect(kv.kvSet('k', ['row'])).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });

  it('lets read failures through, so they are never mistaken for "no results yet"', async () => {
    const kv = await kvWith({ request: 'error', tx: 'abort' });
    await expect(kv.kvGet('k')).rejects.toBeInstanceOf(DOMException);
  });

  it('can treat a failed read as "nothing stored" where that is safe', async () => {
    const kv = await kvWith({ request: 'error', tx: 'abort' });
    await expect(kv.kvGetQuiet('k')).resolves.toBeUndefined();
  });
});
