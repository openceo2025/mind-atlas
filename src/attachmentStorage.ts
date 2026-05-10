import type { AtlasNode, NodeAttachment } from "./types";

const DB_NAME = "mind-atlas-attachments";
const DB_VERSION = 1;
const STORE_NAME = "attachment-blobs";

type StoredAttachmentBlob = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  blob: Blob;
};

export async function saveStoredAttachmentBlob(attachment: NodeAttachment, blob: Blob) {
  const db = await openAttachmentDb();
  if (!db) return;
  try {
    await runStoreRequest(
      db,
      "readwrite",
      (store) =>
        store.put({
          id: attachment.id,
          name: attachment.name,
          mimeType: blob.type || attachment.mimeType,
          size: blob.size || attachment.size,
          updatedAt: new Date().toISOString(),
          blob,
        } satisfies StoredAttachmentBlob),
    );
  } finally {
    db.close();
  }
}

export async function getStoredAttachmentBlob(id: string) {
  const db = await openAttachmentDb();
  if (!db) return undefined;
  try {
    const record = await runStoreRequest(db, "readonly", (store) => store.get(id));
    return (record as StoredAttachmentBlob | undefined)?.blob;
  } finally {
    db.close();
  }
}

export async function deleteStoredAttachmentBlob(id: string) {
  const db = await openAttachmentDb();
  if (!db) return;
  try {
    await runStoreRequest(db, "readwrite", (store) => store.delete(id));
  } finally {
    db.close();
  }
}

export async function deleteStoredAttachmentBlobs(ids: string[]) {
  if (!ids.length) return;
  const db = await openAttachmentDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function clearStoredAttachmentBlobs() {
  const db = await openAttachmentDb();
  if (!db) return;
  try {
    await runStoreRequest(db, "readwrite", (store) => store.clear());
  } finally {
    db.close();
  }
}

export async function replaceStoredAttachmentBlobs(root: AtlasNode, attachmentBlobs: Record<string, Blob>) {
  await clearStoredAttachmentBlobs();
  const attachments = collectAttachments(root);
  await Promise.all(
    attachments.map((attachment) => {
      const blob = attachmentBlobs[attachment.id];
      return blob ? saveStoredAttachmentBlob(attachment, blob) : Promise.resolve();
    }),
  );
}

export async function createStoredAttachmentPreviewUrls(root: AtlasNode) {
  const previewUrls: Record<string, string> = {};
  const attachments = collectAttachments(root);
  await Promise.all(
    attachments.map(async (attachment) => {
      const blob = await getStoredAttachmentBlob(attachment.id);
      if (blob) previewUrls[attachment.id] = URL.createObjectURL(blob);
    }),
  );
  return previewUrls;
}

function collectAttachments(node: AtlasNode): NodeAttachment[] {
  return [...node.attachments, ...node.children.flatMap((child) => collectAttachments(child))];
}

function openAttachmentDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runStoreRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
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
