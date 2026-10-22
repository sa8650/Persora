import type { TrashEntry, TrashKind, TrashSpace } from "../types";

/** Demo/local-mode Trash: mirrors the cloud lifecycle (7 days, restore, purge)
 * entirely in browser storage for the demo account. Cloud accounts use the
 * server-side trash_items pipeline instead. */
export interface LocalTrashEntry extends TrashEntry {
  /** Full original object, used to put the record back on restore. */
  payload: unknown;
}

export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const storageKey = (ownerId: string) => `persora-local-trash-v1:${ownerId}`;

/** Pure factory shared by the demo delete flows (new expiry window on every
 * deletion — re-deleting a restored item starts a fresh 7-day period). */
export function buildTrashEntry(input: {
  id: string;
  kind: TrashKind;
  title: string;
  space: TrashSpace | null;
  folder?: string | null;
  eventDate?: string | null;
  recordType?: string | null;
  hasFiles?: boolean;
  payload: unknown;
  now?: number;
}): LocalTrashEntry {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    space: input.space,
    folder: input.folder ?? null,
    ...(input.eventDate ? { eventDate: input.eventDate } : {}),
    ...(input.recordType ? { recordType: input.recordType } : {}),
    ...(input.hasFiles ? { hasFiles: true } : {}),
    deletedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TRASH_RETENTION_MS).toISOString(),
    payload: input.payload,
  };
}

/** Pure expiry split: expired entries are purged, active ones stay listed and
 * restorable. The Trash page (and every Trash load) uses this as the local
 * equivalent of the server-side scheduled purge. */
export function partitionTrashByExpiry(entries: LocalTrashEntry[], now = Date.now()): { active: LocalTrashEntry[]; expired: LocalTrashEntry[] } {
  const active: LocalTrashEntry[] = [];
  const expired: LocalTrashEntry[] = [];
  for (const entry of entries) {
    const expiry = Date.parse(entry.expiresAt);
    if (Number.isFinite(expiry) && expiry > now) active.push(entry);
    else expired.push(entry);
  }
  return { active, expired };
}

function readAll(ownerId: string): LocalTrashEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalTrashEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.id === "string" && typeof entry.kind === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(ownerId: string, entries: LocalTrashEntry[]): void {
  try {
    if (entries.length) localStorage.setItem(storageKey(ownerId), JSON.stringify(entries));
    else localStorage.removeItem(storageKey(ownerId));
  } catch {
    // Demo Trash is best-effort browser storage.
  }
}

/** Loads the owner's Trash, hard-purging anything past its expiry first. */
export function loadLocalTrash(ownerId: string): LocalTrashEntry[] {
  const { active, expired } = partitionTrashByExpiry(readAll(ownerId));
  if (expired.length) writeAll(ownerId, active);
  return active.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

export function pushLocalTrash(ownerId: string, entry: LocalTrashEntry): void {
  const current = readAll(ownerId).filter((existing) => existing.id !== entry.id);
  writeAll(ownerId, [entry, ...current]);
}

export function removeLocalTrash(ownerId: string, ids: string[]): void {
  const remove = new Set(ids);
  writeAll(ownerId, readAll(ownerId).filter((entry) => !remove.has(entry.id)));
}

export function clearLocalTrash(ownerId: string): LocalTrashEntry[] {
  const { active } = partitionTrashByExpiry(readAll(ownerId));
  writeAll(ownerId, []);
  return active;
}
