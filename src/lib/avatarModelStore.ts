import type {ModelFormat} from './avatarModels';
const DB_NAME = "limeai-avatar";
const STORE = "models";

export type StoredModel = { id: string; name: string; blob: Blob; createdAt: number; format?: ModelFormat };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        let result: T;
        r.onsuccess = () => { result = r.result; };
        t.oncomplete = () => { db.close(); resolve(result); };
        t.onabort = () => { db.close(); reject(t.error || r.error || new Error("モデル保存を完了できませんでした")); };
        t.onerror = () => { db.close(); reject(t.error || r.error); };
      }),
  );
}

export const listModels = () => tx<StoredModel[]>("readonly", (s) => s.getAll());
export const putModel = (m: StoredModel) => tx("readwrite", (s) => s.put(m));
export const deleteModel = (id: string) => tx("readwrite", (s) => s.delete(id));
export const getModel = (id: string) => tx<StoredModel | undefined>("readonly", (s) => s.get(id));

