import type { AtlasNode } from "./types";
import { isAboutDemoMode } from "./aboutDemo";

export const LEGACY_NOTEBOOK_STORAGE_KEY = "mind-atlas-notebook-v2";

const DB_NAME = "mind-atlas-notebook";
const DB_VERSION = 1;
const META_STORE = "meta";
const SNAPSHOT_STORE = "snapshots";
const CURRENT_KEY = "current";
const LATEST_GENERATION_LIMIT = 20;
const DAILY_GENERATION_LIMIT = 7;
const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;

export type NotebookPersistenceStatus = "idle" | "loading" | "ready" | "error";

export type NotebookSnapshot = {
  id: string;
  createdAt: string;
  generation: number;
  title: string;
  nodeCount: number;
  sizeBytes: number;
};

type StoredCurrentNotebook = {
  key: typeof CURRENT_KEY;
  root: AtlasNode;
  updatedAt: string;
  generation: number;
};

type StoredNotebookSnapshot = NotebookSnapshot & {
  root: AtlasNode;
  dayKey: string;
};

export async function loadPersistedNotebook() {
  if (isAboutDemoMode()) return null;
  const db = await openNotebookDb();
  if (!db) return null;
  try {
    const current = await runStoreRequest<StoredCurrentNotebook | undefined>(db, META_STORE, "readonly", (store) => store.get(CURRENT_KEY));
    return current?.root ?? null;
  } finally {
    db.close();
  }
}

export async function savePersistedNotebook(root: AtlasNode) {
  if (isAboutDemoMode()) return createDemoSnapshot(root);
  const serialized = JSON.stringify(root);
  const sizeBytes = new Blob([serialized]).size;
  if (sizeBytes > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Notebook is too large to snapshot (${formatBytes(sizeBytes)}). Export a backup before adding more content.`);
  }
  const db = await openNotebookDb();
  if (!db) throw new Error("IndexedDB is not available in this browser.");
  try {
    const previous = await runStoreRequest<StoredCurrentNotebook | undefined>(db, META_STORE, "readonly", (store) => store.get(CURRENT_KEY));
    const generation = (previous?.generation ?? 0) + 1;
    const now = new Date().toISOString();
    const snapshot = createSnapshot(root, generation, now, sizeBytes);
    const tx = db.transaction([META_STORE, SNAPSHOT_STORE], "readwrite");
    tx.objectStore(META_STORE).put({ key: CURRENT_KEY, root, updatedAt: now, generation } satisfies StoredCurrentNotebook);
    tx.objectStore(SNAPSHOT_STORE).put(snapshot);
    await waitForTransaction(tx);
    writeLegacyNotebookRecovery(root);
    await pruneSnapshots(db);
    return snapshotMetadata(snapshot);
  } finally {
    db.close();
  }
}

export async function listNotebookSnapshots() {
  if (isAboutDemoMode()) return [];
  const db = await openNotebookDb();
  if (!db) return [];
  try {
    const snapshots = await getAllSnapshots(db);
    return snapshots.map(snapshotMetadata).sort((a, b) => b.generation - a.generation);
  } finally {
    db.close();
  }
}

export async function restoreNotebookSnapshot(id: string) {
  if (isAboutDemoMode()) throw new Error("Notebook history is disabled in the Mind Atlas demo.");
  const db = await openNotebookDb();
  if (!db) throw new Error("IndexedDB is not available in this browser.");
  try {
    const snapshot = await runStoreRequest<StoredNotebookSnapshot | undefined>(db, SNAPSHOT_STORE, "readonly", (store) => store.get(id));
    if (!snapshot) throw new Error("Notebook snapshot was not found.");
    await savePersistedNotebook(snapshot.root);
    return snapshot.root;
  } finally {
    db.close();
  }
}

export async function clearPersistedNotebook() {
  if (isAboutDemoMode()) return;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LEGACY_NOTEBOOK_STORAGE_KEY);
  }
  const db = await openNotebookDb();
  if (!db) return;
  try {
    const tx = db.transaction([META_STORE, SNAPSHOT_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(CURRENT_KEY);
    tx.objectStore(SNAPSHOT_STORE).clear();
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function migrateLegacyNotebookIfNeeded(root: AtlasNode | null) {
  if (isAboutDemoMode()) return null;
  if (typeof window === "undefined") return null;
  const existing = await loadPersistedNotebook();
  if (existing) return existing;
  const legacyRaw = window.localStorage.getItem(LEGACY_NOTEBOOK_STORAGE_KEY);
  if (!legacyRaw && !root) return null;
  const sourceRoot = legacyRaw ? (JSON.parse(legacyRaw) as AtlasNode) : root;
  if (!sourceRoot) return null;
  await savePersistedNotebook(sourceRoot);
  return sourceRoot;
}

export async function requestDurableNotebookStorage() {
  if (isAboutDemoMode()) return false;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function loadLegacyNotebook() {
  if (isAboutDemoMode()) return null;
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LEGACY_NOTEBOOK_STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as AtlasNode;
}

export function writeLegacyNotebookRecovery(root: AtlasNode) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEGACY_NOTEBOOK_STORAGE_KEY, JSON.stringify(root));
  } catch (error) {
    console.warn("Legacy notebook recovery cache could not be updated. Removing stale recovery cache.", error);
    try {
      window.localStorage.removeItem(LEGACY_NOTEBOOK_STORAGE_KEY);
    } catch {
      // Best effort only. IndexedDB remains the source of truth.
    }
  }
}

function createSnapshot(root: AtlasNode, generation: number, createdAt: string, sizeBytes: number): StoredNotebookSnapshot {
  return {
    id: `snapshot-${generation}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    generation,
    title: root.title || "Untitled universe",
    nodeCount: countNodes(root),
    sizeBytes,
    dayKey: createdAt.slice(0, 10),
    root,
  };
}

function createDemoSnapshot(root: AtlasNode): NotebookSnapshot {
  return {
    id: "about-demo-snapshot",
    createdAt: new Date().toISOString(),
    generation: 0,
    title: root.title || "Mind Atlas demo",
    nodeCount: countNodes(root),
    sizeBytes: 0,
  };
}

function snapshotMetadata(snapshot: StoredNotebookSnapshot): NotebookSnapshot {
  const { root: _root, dayKey: _dayKey, ...metadata } = snapshot;
  return metadata;
}

async function pruneSnapshots(db: IDBDatabase) {
  const snapshots = await getAllSnapshots(db);
  const newestFirst = snapshots.sort((a, b) => b.generation - a.generation);
  const keep = new Set<string>();
  newestFirst.slice(0, LATEST_GENERATION_LIMIT).forEach((snapshot) => keep.add(snapshot.id));
  const keptDays = new Set<string>();
  for (const snapshot of newestFirst) {
    if (keptDays.has(snapshot.dayKey)) continue;
    keep.add(snapshot.id);
    keptDays.add(snapshot.dayKey);
    if (keptDays.size >= DAILY_GENERATION_LIMIT) break;
  }
  const deleteIds = newestFirst.filter((snapshot) => !keep.has(snapshot.id)).map((snapshot) => snapshot.id);
  if (!deleteIds.length) return;
  const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
  const store = tx.objectStore(SNAPSHOT_STORE);
  deleteIds.forEach((id) => store.delete(id));
  await waitForTransaction(tx);
}

function getAllSnapshots(db: IDBDatabase) {
  return runStoreRequest<StoredNotebookSnapshot[]>(db, SNAPSHOT_STORE, "readonly", (store) => store.getAll());
}

function openNotebookDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
        store.createIndex("generation", "generation");
        store.createIndex("dayKey", "dayKey");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runStoreRequest<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function waitForTransaction(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function countNodes(node: AtlasNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
