export interface StoredLiveScanFrame {
  sessionId: string;
  frameId: string;
  capturedAt: string;
  blob: Blob;
}

const DATABASE_NAME = "reaigen-live-scan";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-frames";
const SESSION_INDEX = "session-id";

function frameKey(sessionId: string, frameId: string): string {
  return `${sessionId}:${frameId}`;
}

function openFrameDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Durable browser storage is unavailable."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "key" });
      if (!store.indexNames.contains(SESSION_INDEX)) {
        store.createIndex(SESSION_INDEX, "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open durable frame storage."));
    request.onblocked = () => reject(new Error("Durable frame storage is blocked."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Frame storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Frame storage transaction was aborted."));
  });
}

function strictReadwriteTransaction(database: IDBDatabase): IDBTransaction {
  try {
    return database.transaction(STORE_NAME, "readwrite", { durability: "strict" });
  } catch {
    // Older iOS Safari versions understand IndexedDB but not durability
    // hints. Their ordinary readwrite transaction remains persistent.
    return database.transaction(STORE_NAME, "readwrite");
  }
}

export async function storeLiveScanFrame(frame: StoredLiveScanFrame): Promise<void> {
  const database = await openFrameDatabase();
  try {
    const transaction = strictReadwriteTransaction(database);
    transaction.objectStore(STORE_NAME).put({
      key: frameKey(frame.sessionId, frame.frameId),
      ...frame,
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function removeLiveScanFrame(
  sessionId: string,
  frameId: string,
): Promise<void> {
  const database = await openFrameDatabase();
  try {
    const transaction = strictReadwriteTransaction(database);
    transaction.objectStore(STORE_NAME).delete(frameKey(sessionId, frameId));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function listLiveScanFrames(sessionId: string): Promise<StoredLiveScanFrame[]> {
  const database = await openFrameDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index(SESSION_INDEX).getAll(sessionId);
    const rows = await new Promise<Array<StoredLiveScanFrame & { key: string }>>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Array<StoredLiveScanFrame & { key: string }>);
      request.onerror = () => reject(request.error ?? new Error("Could not recover captured frames."));
    });
    await transactionComplete(transaction);
    return rows
      .map(({ sessionId: storedSessionId, frameId, capturedAt, blob }) => ({
        sessionId: storedSessionId,
        frameId,
        capturedAt,
        blob,
      }))
      .sort((left, right) => (
        left.capturedAt.localeCompare(right.capturedAt)
        || left.frameId.localeCompare(right.frameId)
      ));
  } finally {
    database.close();
  }
}
