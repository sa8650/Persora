// Persora Docs — IndexedDB crash-recovery backup for unsaved in-progress edits.
// Documents are canonically stored on the Persora backend (Supabase). This store
// holds only temporary unsaved edits if the network drops or the tab closes mid-save,
// and deletes the entry as soon as the server confirms "Saved".
import type { DocContent } from "../../cloudflare/docs-rules.js";

export interface DocDraftBackup {
  docId: string;
  userId: string;
  title: string;
  baseRevision: number;
  savedAt: number;
  content: DocContent;
}

const DB_NAME = "persora-docs-drafts";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

function draftKey(userId: string, docId: string) {
  return `${userId}:${docId}`;
}

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveDocDraft(draft: DocDraftBackup): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ ...draft, key: draftKey(draft.userId, draft.docId) });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadDocDraft(userId: string, docId: string): Promise<DocDraftBackup | null> {
  const db = await openDraftDb();
  if (!db) return null;
  return new Promise<DocDraftBackup | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(draftKey(userId, docId));
      req.onsuccess = () => {
        const val = req.result as (DocDraftBackup & { key?: string }) | undefined;
        db.close();
        if (!val || !val.content || val.content.type !== "doc") {
          resolve(null);
          return;
        }
        const { key: _omit, ...rest } = val;
        resolve(rest);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function deleteDocDraft(userId: string, docId: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(draftKey(userId, docId));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
