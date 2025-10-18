/**
 * ワークスペース結果を保存するためのシンプルな IndexedDB ラッパー。
 * IndexedDB が利用できない環境（テストなど）の場合はメモリ上の Map を使用する。
 */

const DB_NAME = 'paper-forge-workspace';
const STORE_NAME = 'results';
const DB_VERSION = 1;

type StorageBackend = 'indexedDB' | 'memory';

const inMemoryStore = new Map<string, Blob>();
const backend: StorageBackend = typeof indexedDB === 'undefined' ? 'memory' : 'indexedDB';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDatabase = (): Promise<IDBDatabase> => {
  if (backend === 'memory') {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });
  }
  return dbPromise;
};

const saveBlobIndexedDb = async (id: string, blob: Blob) => {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(blob, id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to store blob'));
  });
};

const loadBlobIndexedDb = async (id: string): Promise<Blob | null> => {
  const db = await openDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error('Failed to read blob'));
  });
};

const deleteBlobIndexedDb = async (id: string): Promise<void> => {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete blob'));
  });
};

export const workspaceDb = {
  async save(id: string, blob: Blob): Promise<void> {
    if (backend === 'memory') {
      inMemoryStore.set(id, blob);
      return;
    }
    await saveBlobIndexedDb(id, blob);
  },

  async get(id: string): Promise<Blob | null> {
    if (backend === 'memory') {
      return inMemoryStore.get(id) ?? null;
    }
    return loadBlobIndexedDb(id);
  },

  async remove(id: string): Promise<void> {
    if (backend === 'memory') {
      inMemoryStore.delete(id);
      return;
    }
    await deleteBlobIndexedDb(id);
  },

  async clearAll(): Promise<void> {
    if (backend === 'memory') {
      inMemoryStore.clear();
      return;
    }
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Failed to clear blobs'));
    });
  },
};
