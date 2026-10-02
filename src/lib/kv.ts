/** Minimal IndexedDB key/value store (holds folder handles and browser-kept results). */

const DB_NAME = 'near';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbPromise = null; // let a later call try again
    throw e;
  });
  return dbPromise;
}

/**
 * Runs one request and settles only when its transaction has finished, so a
 * write that fails to commit (e.g. storage quota exceeded) is reported as a failure.
 */
async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const tx = (await db()).transaction(STORE, mode);
  return new Promise<T>((resolve, reject) => {
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? req.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

/** Reads a value; read failures are thrown so callers never mistake them for "nothing stored". */
export function kvGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('readonly', (s) => s.get(key));
}

/** Reads a value where a failure can safely be treated as "nothing stored" (e.g. a remembered folder). */
export async function kvGetQuiet<T>(key: string): Promise<T | undefined> {
  try {
    return await kvGet<T>(key);
  } catch {
    return undefined;
  }
}

export function kvSet(key: string, value: unknown): Promise<void> {
  return run('readwrite', (s) => s.put(value, key));
}

export function kvDelete(key: string): Promise<void> {
  return run('readwrite', (s) => s.delete(key));
}

export function kvKeys(): Promise<IDBValidKey[]> {
  return run('readonly', (s) => s.getAllKeys());
}
