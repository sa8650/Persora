import type { VaultEntry } from "./password-vault-crypto";

/** Password Manager Trash lifecycle (7 days, matching the global Trash).
 * Lives inside the encrypted vault envelope: password entries are client-side
 * encrypted before storage, so they can never flow through the server-side
 * trash_items table (the server must never see vault contents). Expired
 * entries are purged deterministically at the same choke points every vault
 * mutation passes through (unlock + save), which keeps behaviour consistent. */
export const PASSWORD_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function markEntryTrashed(entry: VaultEntry, now = Date.now()): VaultEntry {
  return { ...entry, updated: entry.updated || now, trash: { deletedAt: now, expiresAt: now + PASSWORD_TRASH_RETENTION_MS } };
}

export function restoreTrashedEntry(entry: VaultEntry, now = Date.now()): VaultEntry {
  const { trash: _removed, ...rest } = entry;
  return { ...rest, updated: now };
}

export function isTrashExpired(entry: VaultEntry, now = Date.now()): boolean {
  return Boolean(entry.trash && entry.trash.expiresAt <= now);
}

/** Entries shown in the live vault: not trashed at all. */
export function splitVaultEntries(entries: VaultEntry[], now = Date.now()): { live: VaultEntry[]; trashed: VaultEntry[]; expired: VaultEntry[] } {
  const live: VaultEntry[] = [];
  const trashed: VaultEntry[] = [];
  const expired: VaultEntry[] = [];
  for (const entry of entries) {
    if (!entry.trash) live.push(entry);
    else if (entry.trash.expiresAt > now) trashed.push(entry);
    else expired.push(entry);
  }
  return { live, trashed, expired };
}

/** Drops expired trash forever. Returns the remaining entries plus how many
 * were permanently removed so callers can persist + notify. */
export function purgeVaultTrash(entries: VaultEntry[], now = Date.now()): { cleaned: VaultEntry[]; purgedCount: number } {
  const { live, trashed, expired } = splitVaultEntries(entries, now);
  return { cleaned: [...live, ...trashed], purgedCount: expired.length };
}
