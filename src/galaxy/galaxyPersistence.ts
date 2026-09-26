/**
 * IndexedDB storage for the galaxy. It lives in its own database so the
 * existing single-notebook storage (`notebookPersistence.ts`) keeps working
 * unchanged: the active space is still the notebook in `current`, and this
 * database holds the galaxy state plus the roots of every inactive space.
 *
 * Mode: shared-core.
 */
import type { AtlasNode } from "../types";
import { isAboutDemoMode } from "../aboutDemo";
import type { GalaxyState } from "./galaxyTypes";

const DB_NAME = "mind-atlas-galaxy";
const DB_VERSION = 1;
const META_STORE = "meta";
const SPACE_STORE = "spaces";
const HISTORY_STORE = "history";
const STATE_KEY = "state";
const HISTORY_LIMIT = 30;

type StoredState = { key: typeof STATE_KEY; state: GalaxyState; generation: number };
type StoredSpaceRoot = { spaceId: string; root: AtlasNode; updatedAt: string };
type StoredHistory = { id: string; generation: number; savedAt: string; state: GalaxyState };

export function galaxyStorageAvailable() {
  return typeof indexedDB !== "undefined" && !isAboutDemoMode();
}

export async function loadGalaxyState(): Promise<GalaxyState | null> {
  const db = await openGalaxyDb();
  if (!db) return null;
  try {
    const stored = await request<StoredState | undefined>(db, META_STORE, "readonly", (store) => store.get(STATE_KEY));
    return stored?.state ?? null;
  } finally {
    db.close();
  }
}

export async function saveGalaxyState(state: GalaxyState) {
  const db = await openGalaxyDb();
  if (!db) return;
  try {
    const previous = await request<StoredState | undefined>(db, META_STORE, "readonly", (store) => store.get(STATE_KEY));
    const generation = (previous?.generation ?? 0) + 1;
    const savedAt = new Date().toISOString();
    const tx = db.transaction([META_STORE, HISTORY_STORE], "readwrite");
    tx.objectStore(META_STORE).put({ key: STATE_KEY, state, generation } satisfies StoredState);
    // The ledger is hand-entered and cannot be rebuilt from anything else, so
    // every save also keeps a rolling history the user can fall back to.
    tx.objectStore(HISTORY_STORE).put({ id: `g-${generation}`, generation, savedAt, state } satisfies StoredHistory);
    await done(tx);
    await pruneHistory(db);
  } finally {
    db.close();
  }
}

export async function loadSpaceRoot(spaceId: string): Promise<AtlasNode | null> {
  const db = await openGalaxyDb();
  if (!db) return null;
  try {
    const stored = await request<StoredSpaceRoot | undefined>(db, SPACE_STORE, "readonly", (store) => store.get(spaceId));
    return stored?.root ?? null;
  } finally {
    db.close();
  }
}

export async function loadAllSpaceRoots(): Promise<Record<string, AtlasNode>> {
  const db = await openGalaxyDb();
  if (!db) return {};
  try {
    const all = await request<StoredSpaceRoot[]>(db, SPACE_STORE, "readonly", (store) => store.getAll());
    return Object.fromEntries(all.map((entry) => [entry.spaceId, entry.root]));
  } finally {
    db.close();
  }
}

export async function saveSpaceRoot(spaceId: string, root: AtlasNode) {
  const db = await openGalaxyDb();
  if (!db) return;
  try {
    const tx = db.transaction(SPACE_STORE, "readwrite");
    tx.objectStore(SPACE_STORE).put({ spaceId, root, updatedAt: new Date().toISOString() } satisfies StoredSpaceRoot);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function deleteSpaceRoot(spaceId: string) {
  const db = await openGalaxyDb();
  if (!db) return;
  try {
    const tx = db.transaction(SPACE_STORE, "readwrite");
    tx.objectStore(SPACE_STORE).delete(spaceId);
    await done(tx);
  } finally {
    db.close();
  }
}

async function pruneHistory(db: IDBDatabase) {
  const all = await request<StoredHistory[]>(db, HISTORY_STORE, "readonly", (store) => store.getAll());
  const stale = all.sort((a, b) => b.generation - a.generation).slice(HISTORY_LIMIT);
  if (!stale.length) return;
  const tx = db.transaction(HISTORY_STORE, "readwrite");
  stale.forEach((entry) => tx.objectStore(HISTORY_STORE).delete(entry.id));
  await done(tx);
}

function openGalaxyDb(): Promise<IDBDatabase | null> {
  if (!galaxyStorageAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SPACE_STORE)) db.createObjectStore(SPACE_STORE, { keyPath: "spaceId" });
      if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

function request<T>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
