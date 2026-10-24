// Persora Table — local backups of unsaved edits (IndexedDB, this device only).
//
// While a table has changes the server hasn't confirmed, the current document
// is written here (throttled). It is removed once everything is saved. On
// open, a leftover draft that differs from the server copy is offered back to
// the member; nothing is discarded without asking.
import type { TableDoc } from "./table-sync";

export interface TableDraft {
  tableId: string;
  userId: string;
  name: string;
  baseRevision: number;
  savedAt: number;
  doc: TableDoc;
}

const DB_NAME = "persora-table-drafts";
const STORE = "drafts";
const memory = new Map<string, TableDraft>();
let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

const keyOf = (userId: string, tableId: string) => `${userId}:${tableId}`;

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export async function saveDraft(draft: TableDraft): Promise<void> {
  const key = keyOf(draft.userId, draft.tableId);
  memory.set(key, draft);
  await withStore("readwrite", (store) => store.put(draft, key));
}

export async function loadDraft(userId: string, tableId: string): Promise<TableDraft | null> {
  const key = keyOf(userId, tableId);
  const stored = await withStore<TableDraft>("readonly", (store) => store.get(key) as IDBRequest<TableDraft>);
  return stored ?? memory.get(key) ?? null;
}

export async function deleteDraft(userId: string, tableId: string): Promise<void> {
  const key = keyOf(userId, tableId);
  memory.delete(key);
  await withStore("readwrite", (store) => store.delete(key));
}

/** Drafts for the home page ("Unsaved changes on this device"). */
export async function listDrafts(userId: string): Promise<TableDraft[]> {
  const all = await withStore<TableDraft[]>("readonly", (store) => store.getAll() as IDBRequest<TableDraft[]>);
  const list = all ?? [...memory.values()];
  return list.filter((draft) => draft.userId === userId);
}
