// IndexedDB の最小ラッパー。スペース本体・一覧状態・埋め込みキャッシュを保存する。
// 使えない環境（プライベートブラウズ等）ではメモリ上だけで動く。

const DB_NAME = 'mindatlas-spatial';
const DB_VERSION = 1;
export type StoreName = 'spaces' | 'kv' | 'embeddings';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Record<StoreName, Map<string, unknown>> = {
  spaces: new Map(),
  kv: new Map(),
  embeddings: new Map(),
};

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['spaces', 'kv', 'embeddings']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory[store].get(key) as T | undefined;
  try {
    return (await wrap(db.transaction(store).objectStore(store).get(key))) as T | undefined;
  } catch {
    return memory[store].get(key) as T | undefined;
  }
}

export async function idbGetMany<T>(store: StoreName, keys: string[]): Promise<(T | undefined)[]> {
  const db = await open();
  if (!db) return keys.map((k) => memory[store].get(k) as T | undefined);
  try {
    const os = db.transaction(store).objectStore(store);
    return await Promise.all(keys.map((k) => wrap(os.get(k)) as Promise<T | undefined>));
  } catch {
    return keys.map((k) => memory[store].get(k) as T | undefined);
  }
}

export async function idbSet(store: StoreName, key: string, value: unknown) {
  memory[store].set(key, value);
  const db = await open();
  if (!db) return;
  try {
    await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
  } catch {
    // 容量超過などは、メモリ上の値で続行する
  }
}

export async function idbSetMany(store: StoreName, entries: [string, unknown][]) {
  for (const [k, v] of entries) memory[store].set(k, v);
  const db = await open();
  if (!db || !entries.length) return;
  try {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const [k, v] of entries) os.put(v, k);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // メモリ上の値で続行する
  }
}

export async function idbDelete(store: StoreName, key: string) {
  memory[store].delete(key);
  const db = await open();
  if (!db) return;
  try {
    await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
  } catch {
    // 無視
  }
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  if (!db) return [...memory[store].values()] as T[];
  try {
    return (await wrap(db.transaction(store).objectStore(store).getAll())) as T[];
  } catch {
    return [...memory[store].values()] as T[];
  }
}
