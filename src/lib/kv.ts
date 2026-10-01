/** Minimal IndexedDB key/value store (holds folder handles and browser-kept results). */

const DB_NAME = 'near';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = op(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>('readonly', (s) => s.get(key));
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
