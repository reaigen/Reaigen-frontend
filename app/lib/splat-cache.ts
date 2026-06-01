/**
 * IndexedDB cache for converted Gaussian splat buffers.
 *
 * Stores ArrayBuffer output of ConvertPLYWithSHToSplatAsync so repeat
 * visits skip both network download AND JS conversion.
 *
 * Keys: splat:{id}:startup | splat:{id}:full
 * TTL:  14 days
 * Budget: 1.5 GB — LRU eviction (oldest access first)
 */

const DB_NAME = "reaigen-splat-cache-v1";
const STORE = "blobs";
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;

interface Entry {
  key: string;
  buffer: ArrayBuffer;
  accessedAt: number;
  sizeBytes: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCache(
  splatId: number,
  stage: "startup" | "full",
  version?: string | null,
): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    const key = version ? `splat:${splatId}:${stage}:${version}` : `splat:${splatId}:${stage}`;
    // If version provided, delete old unversioned entry
    if (version) {
      const oldKey = `splat:${splatId}:${stage}`;
      const tx0 = db.transaction(STORE, "readwrite");
      tx0.objectStore(STORE).delete(oldKey);
    }
    return await new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const e: Entry | undefined = req.result;
        if (!e) { resolve(null); return; }
        if (Date.now() - e.accessedAt > TTL_MS) {
          tx.objectStore(STORE).delete(key);
          resolve(null);
          return;
        }
        e.accessedAt = Date.now();
        tx.objectStore(STORE).put(e);
        resolve(e.buffer);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCache(
  splatId: number,
  stage: "startup" | "full",
  buffer: ArrayBuffer,
  version?: string | null,
): Promise<void> {
  try {
    const db = await openDB();
    const key = version ? `splat:${splatId}:${stage}:${version}` : `splat:${splatId}:${stage}`;
    await evictIfNeeded(db, buffer.byteLength);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        key, buffer, accessedAt: Date.now(), sizeBytes: buffer.byteLength,
      } as Entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-fatal */ }
}

async function evictIfNeeded(db: IDBDatabase, incomingBytes: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const entries: Entry[] = req.result;
      let total = entries.reduce((s, e) => s + e.sizeBytes, 0) + incomingBytes;
      if (total <= MAX_BYTES) { resolve(); return; }
      entries.sort((a, b) => a.accessedAt - b.accessedAt);
      for (const e of entries) {
        if (total <= MAX_BYTES) break;
        tx.objectStore(STORE).delete(e.key);
        total -= e.sizeBytes;
      }
      resolve();
    };
    req.onerror = () => resolve();
  });
}
