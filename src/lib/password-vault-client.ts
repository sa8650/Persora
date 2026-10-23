// Password Manager session: create/unlock, sync, migration and recovery. All
// encryption happens here in the browser; backends only see ciphertext.
import {
  MASTER_PASSWORD_MIN_LENGTH, VaultIntegrityError, WrongMasterPasswordError, createKeyMaterial, createTransportKeyPair,
  decryptEntry, encryptEntry, generateDek, importDek, openTransport, sealEscrow, unwrapDek, verifyKeyCheck,
  type VaultEntry,
} from "./password-vault-crypto";
import { legacyHasRecoveryKey, legacyStorageKey, recoverLegacyVault, unlockLegacyVault } from "./password-vault-legacy";
import { VaultConflictError, type ItemChange, type NewItem, type RemoteItem, type VaultBackend, type VaultSnapshot } from "./password-vault-sync";

/** The vault key was replaced on another device (master password reset). */
export class VaultKeyChangedError extends Error {
  constructor() { super("Your master password was reset on another device. Unlock with the new master password."); this.name = "VaultKeyChangedError"; }
}

export type VaultStatus = { hasVault: boolean; hasServerVault: boolean; hasLegacy: boolean; legacyRecoverable: boolean; recoveryAvailable: boolean; canCreate: boolean; backend: "server" | "device" };
export type OpenResult = { entries: VaultEntry[]; created: boolean; migratedCount: number; legacyPending: boolean; unreadableCount: number };
export type RecoveryMode = "escrow" | "legacy" | "none";

const MAX_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Older on-device entries may carry non-UUID or duplicate ids; give them fresh ids (content unchanged). */
export function normalizeEntryIds(entries: VaultEntry[]): VaultEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => entry && typeof entry === "object").map((entry) => {
    let id = typeof entry.id === "string" ? entry.id.toLowerCase() : "";
    if (!UUID.test(id) || seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
}
const FAILURE_FREE_ATTEMPTS = 5;

export class PasswordVaultSession {
  private dek: CryptoKey | null = null;
  private generation = 0;
  private cursor = 0;
  private known = new Map<string, { revision: number; json: string; entry: VaultEntry }>();
  private last: VaultSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private lockedUntil = 0;
  private grant: string | null = null;
  private legacyRecovered: VaultEntry[] | null = null;

  constructor(readonly userId: string, readonly backend: VaultBackend, private readonly storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage, private readonly now: () => number = () => Date.now()) {}

  get isUnlocked() { return this.dek !== null; }
  get keyGeneration() { return this.generation; }
  entries(): VaultEntry[] { return [...this.known.values()].map((item) => item.entry); }

  private legacyRaw(): string | null { try { return this.storage?.getItem(legacyStorageKey(this.userId)) || null; } catch { return null; } }
  private dropLegacy() { try { this.storage?.removeItem(legacyStorageKey(this.userId)); } catch { /* storage unavailable */ } }

  /** Serializes vault mutations so sync and saves never interleave. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async status(): Promise<VaultStatus> {
    const snapshot = await this.backend.load();
    this.last = snapshot;
    const legacy = this.legacyRaw();
    return {
      hasVault: Boolean(snapshot.vault || legacy), hasServerVault: Boolean(snapshot.vault), hasLegacy: Boolean(legacy),
      legacyRecoverable: legacyHasRecoveryKey(legacy), recoveryAvailable: snapshot.recoveryAvailable,
      canCreate: this.backend.kind === "device" || Boolean(snapshot.escrow), backend: this.backend.kind,
    };
  }

  private assertNotThrottled() {
    const wait = this.lockedUntil - this.now();
    if (wait > 0) throw new Error(`Too many incorrect attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`);
  }
  private recordFailure() {
    this.failures += 1;
    if (this.failures >= FAILURE_FREE_ATTEMPTS) this.lockedUntil = this.now() + Math.min(300_000, 30_000 * 2 ** (this.failures - FAILURE_FREE_ATTEMPTS));
  }

  /** Decrypts a snapshot's items into the known map. Returns how many were unreadable. */
  private async adopt(snapshot: VaultSnapshot, dek: CryptoKey, strict = false): Promise<number> {
    if (!snapshot.vault) throw new Error("The vault is missing.");
    const known = new Map<string, { revision: number; json: string; entry: VaultEntry }>();
    let unreadable = 0;
    for (const item of snapshot.items) {
      if (item.deleted || !item.iv || !item.ciphertext) continue;
      try {
        const entry = await decryptEntry(dek, this.userId, item.keyGeneration, item.id, { iv: item.iv, ciphertext: item.ciphertext });
        known.set(item.id, { revision: item.revision, json: JSON.stringify(entry), entry });
      } catch (error) {
        if (strict) throw error;
        unreadable += 1;
      }
    }
    this.dek = dek;
    this.generation = snapshot.vault.keyGeneration;
    this.cursor = snapshot.cursor;
    this.known = known;
    this.last = snapshot;
    return unreadable;
  }

  private async encryptAll(dek: CryptoKey, generation: number, entries: VaultEntry[]): Promise<NewItem[]> {
    const items: NewItem[] = [];
    for (const entry of entries) items.push({ id: entry.id, ...(await encryptEntry(dek, this.userId, generation, entry)) });
    return items;
  }

  private async createVault(password: string, entries: VaultEntry[], escrow = this.last?.escrow || null): Promise<void> {
    if (this.backend.kind === "server" && !escrow) throw new Error("Password Manager recovery isn't configured on this Persora server yet, so a new vault can't be created. Ask your administrator to finish the Password Manager setup.");
    const dekRaw = generateDek();
    try {
      const vault = await createKeyMaterial({ userId: this.userId, generation: 1, password, dekRaw, escrowKey: escrow });
      const dek = await importDek(dekRaw);
      const snapshot = await this.backend.setup({ vault, items: await this.encryptAll(dek, 1, entries) });
      await this.adopt(snapshot, dek, true);
    } catch (error) {
      if (error instanceof VaultConflictError) throw new Error("A password vault was just created for your account on another device. Unlock it with that master password.");
      throw error;
    } finally { dekRaw.fill(0); }
  }

  /** Unlocks the synced vault, migrates an on-device vault, or creates a new one. */
  open(password: string): Promise<OpenResult> {
    return this.exclusive(async () => {
      this.assertNotThrottled();
      if (password.length < MASTER_PASSWORD_MIN_LENGTH) throw new Error(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for your master password.`);
      const snapshot = await this.backend.load();
      this.last = snapshot;
      const legacy = this.legacyRaw();
      if (snapshot.vault) {
        let unlocked: { dek: CryptoKey; dekRaw: Uint8Array };
        try { unlocked = await unwrapDek(this.userId, snapshot.vault, password); } catch (error) { if (error instanceof WrongMasterPasswordError) this.recordFailure(); throw error; }
        this.failures = 0;
        try {
          const unreadableCount = await this.adopt(snapshot, unlocked.dek);
          // Operator rotated the escrow key pair: re-seal the escrow copy now.
          if (snapshot.escrow && snapshot.vault.escrowKeyId !== snapshot.escrow.keyId) {
            const escrow = await sealEscrow(snapshot.escrow, this.userId, this.generation, unlocked.dekRaw);
            await this.backend.updateEscrow({ keyGeneration: this.generation, escrow, escrowKeyId: snapshot.escrow.keyId }).catch(() => undefined);
          }
          let migratedCount = 0; let legacyPending = false;
          if (legacy) {
            try { migratedCount = await this.mergeEntries(normalizeEntryIds(await unlockLegacyVault(legacy, password))); this.dropLegacy(); } catch { legacyPending = true; }
          }
          return { entries: this.entries(), created: false, migratedCount, legacyPending, unreadableCount };
        } finally { unlocked.dekRaw.fill(0); }
      }
      if (legacy) {
        // First open after the upgrade: decrypt the on-device vault with its
        // master password, upload it as an Argon2id vault, verify, then drop it.
        let entries: VaultEntry[];
        try { entries = normalizeEntryIds(await unlockLegacyVault(legacy, password)); } catch { this.recordFailure(); throw new WrongMasterPasswordError(); }
        this.failures = 0;
        await this.createVault(password, entries);
        await this.verifyUploaded(entries);
        this.dropLegacy();
        return { entries: this.entries(), created: true, migratedCount: entries.length, legacyPending: false, unreadableCount: 0 };
      }
      await this.createVault(password, []);
      return { entries: [], created: true, migratedCount: 0, legacyPending: false, unreadableCount: 0 };
    });
  }

  /** Re-downloads the vault and confirms every migrated entry decrypts. */
  private async verifyUploaded(entries: VaultEntry[]) {
    if (!this.dek) throw new Error("The vault is locked.");
    const check = new PasswordVaultSession(this.userId, this.backend, null);
    await check.adopt(await this.backend.load(), this.dek, true);
    const stored = new Map(check.entries().map((entry) => [entry.id, JSON.stringify(entry)]));
    if (entries.some((entry) => stored.get(entry.id) !== JSON.stringify(entry))) throw new VaultIntegrityError("Your passwords couldn't be verified after upload. The copy on this device was kept.");
  }

  /** Adds entries missing from the synced vault (or newer copies). Returns the count. */
  private async mergeEntries(incoming: VaultEntry[]): Promise<number> {
    const merged = new Map(this.entries().map((entry) => [entry.id, entry]));
    let count = 0;
    for (const entry of incoming) {
      const current = merged.get(entry.id);
      if (!current || (entry.updated || 0) > (current.updated || 0)) { merged.set(entry.id, entry); count += 1; }
    }
    if (count) await this.write([...merged.values()]);
    return count;
  }

  /** Merges an older on-device vault protected by a different master password. */
  mergeLegacy(password: string): Promise<{ entries: VaultEntry[]; merged: number }> {
    return this.exclusive(async () => {
      const legacy = this.legacyRaw();
      if (!legacy) return { entries: this.entries(), merged: 0 };
      this.assertNotThrottled();
      let incoming: VaultEntry[];
      try { incoming = normalizeEntryIds(await unlockLegacyVault(legacy, password)); } catch { this.recordFailure(); throw new Error("That master password doesn't unlock the older vault on this device."); }
      this.failures = 0;
      const merged = await this.mergeEntries(incoming);
      this.dropLegacy();
      return { entries: this.entries(), merged };
    });
  }

  /** Persists the full entry list by syncing only the records that changed. */
  save(next: VaultEntry[]): Promise<VaultEntry[]> { return this.exclusive(() => this.write(next)); }

  private async write(next: VaultEntry[]): Promise<VaultEntry[]> {
    const dek = this.dek;
    if (!dek) throw new Error("The vault is locked.");
    const changes: ItemChange[] = [];
    const seen = new Set<string>();
    for (const entry of next) {
      seen.add(entry.id);
      const known = this.known.get(entry.id);
      const json = JSON.stringify(entry);
      if (known?.json === json) continue;
      changes.push({ id: entry.id, baseRevision: known?.revision || 0, ...(await encryptEntry(dek, this.userId, this.generation, entry)) });
    }
    for (const [id, known] of this.known) if (!seen.has(id)) changes.push({ id, baseRevision: known.revision, deleted: true });
    for (let offset = 0; offset < changes.length; offset += MAX_BATCH) {
      const batch = changes.slice(offset, offset + MAX_BATCH);
      let result;
      try { result = await this.backend.apply({ keyGeneration: this.generation, changes: batch }); } catch (error) {
        if (error instanceof VaultConflictError) { await this.reload(); throw new VaultConflictError(`${error.message} Your vault now shows the latest version — please make the change again if it's still needed.`); }
        throw error;
      }
      const applied = new Map(result.items.map((item) => [item.id, item]));
      const byId = new Map(next.map((entry) => [entry.id, entry]));
      for (const change of batch) {
        const item = applied.get(change.id);
        if (change.deleted) { this.known.delete(change.id); continue; }
        const entry = byId.get(change.id)!;
        this.known.set(change.id, { revision: item?.revision || (this.known.get(change.id)?.revision || 0) + 1, json: JSON.stringify(entry), entry });
      }
    }
    return this.entries();
  }

  /** Full reload after a conflict. Locks if the vault key was replaced. */
  private async reload() {
    const snapshot = await this.backend.load();
    if (!snapshot.vault || snapshot.vault.keyGeneration !== this.generation || !this.dek) { this.lock(); throw new VaultKeyChangedError(); }
    await this.adopt(snapshot, this.dek);
  }

  /** Pulls changes made on other devices. Resolves null when nothing changed. */
  sync(): Promise<VaultEntry[] | null> {
    return this.exclusive(async () => {
      const dek = this.dek;
      if (!dek) return null;
      const snapshot = await this.backend.changes(this.cursor);
      if (!snapshot.vault || snapshot.vault.keyGeneration !== this.generation) { this.lock(); throw new VaultKeyChangedError(); }
      let changed = false;
      for (const item of snapshot.items as RemoteItem[]) {
        if (item.deleted || !item.iv || !item.ciphertext) { changed = this.known.delete(item.id) || changed; continue; }
        if (this.known.get(item.id)?.revision === item.revision) continue;
        try {
          const entry = await decryptEntry(dek, this.userId, item.keyGeneration, item.id, { iv: item.iv, ciphertext: item.ciphertext });
          this.known.set(item.id, { revision: item.revision, json: JSON.stringify(entry), entry });
          changed = true;
        } catch { /* leave unreadable records untouched */ }
      }
      this.cursor = snapshot.cursor;
      return changed ? this.entries() : null;
    });
  }

  lock() {
    this.dek = null; this.known = new Map(); this.generation = 0; this.cursor = 0;
    this.grant = null; this.legacyRecovered = null;
  }

  // ── Forgot master password ────────────────────────────────────────────────
  private recoveryBackend() {
    if (!this.backend.recovery) throw new Error("Email recovery needs a signed-in Persora account.");
    return this.backend.recovery;
  }
  async sendRecoveryCode() { return this.recoveryBackend().send(); }

  /** Verifies the emailed OTP. "escrow" → reset now; "legacy" → on-device vault needs its recovery key. */
  async verifyRecoveryCode(code: string): Promise<RecoveryMode> {
    const result = await this.recoveryBackend().verify(code);
    this.grant = result.grant;
    if (result.hasVault && result.grant) return "escrow";
    return legacyHasRecoveryKey(this.legacyRaw()) ? "legacy" : "none";
  }

  /** Legacy on-device vault: checks the offline recovery key (locally) before a new password is set. */
  async checkLegacyRecoveryKey(recoveryKey: string): Promise<void> {
    const legacy = this.legacyRaw();
    if (!legacy) throw new Error("This device has no older vault data to recover.");
    try { this.legacyRecovered = normalizeEntryIds(await recoverLegacyVault(legacy, recoveryKey)); } catch (error) {
      throw error instanceof Error && /before recovery keys/.test(error.message) ? error : new Error("That recovery key doesn't match the vault on this device.");
    }
  }

  /**
   * Trusted email recovery: the server releases the escrowed vault key (once,
   * sealed to an ephemeral key of this browser). We verify it, generate a NEW
   * vault key, re-encrypt every entry, wrap it with the new master password and
   * commit everything atomically. If anything fails nothing is changed.
   */
  resetMasterPassword(newPassword: string): Promise<OpenResult> {
    return this.exclusive(async () => {
      if (newPassword.length < MASTER_PASSWORD_MIN_LENGTH) throw new Error(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for the new master password.`);
      if (this.legacyRecovered) {
        const entries = this.legacyRecovered;
        const snapshot = await this.backend.load();
        this.last = snapshot;
        if (snapshot.vault) throw new Error("Your synced vault already exists. Use email recovery for it instead.");
        await this.createVault(newPassword, entries);
        await this.verifyUploaded(entries);
        this.dropLegacy();
        this.legacyRecovered = null;
        return { entries: this.entries(), created: true, migratedCount: entries.length, legacyPending: false, unreadableCount: 0 };
      }
      const grant = this.grant;
      if (!grant) throw new Error("Verify your registered email first.");
      const recovery = this.recoveryBackend();
      const transport = await createTransportKeyPair();
      const released = await recovery.releaseKey(grant, transport.publicKey);
      const snapshot = await this.backend.load();
      if (!snapshot.vault || snapshot.vault.keyGeneration !== released.keyGeneration) throw new Error("Your vault changed during recovery. Request a new code and try again.");
      if (!snapshot.escrow) throw new Error("Password Manager recovery isn't configured on this server.");
      const oldRaw = await openTransport(transport.privateKey, this.userId, released.keyGeneration, released.transport);
      const newRaw = generateDek();
      try {
        const oldDek = await importDek(oldRaw);
        await verifyKeyCheck(oldDek, this.userId, snapshot.vault);
        const reader = new PasswordVaultSession(this.userId, this.backend, null);
        await reader.adopt(snapshot, oldDek, true); // every entry must decrypt, or nothing changes
        const entries = reader.entries();
        const generation = released.keyGeneration + 1;
        const vault = await createKeyMaterial({ userId: this.userId, generation, password: newPassword, dekRaw: newRaw, escrowKey: snapshot.escrow });
        const newDek = await importDek(newRaw);
        const result = await recovery.complete({ grant, expectedKeyGeneration: released.keyGeneration, vault, items: await this.encryptAll(newDek, generation, entries) });
        await this.adopt(result, newDek, true);
        this.grant = null;
        this.failures = 0; this.lockedUntil = 0;
        return { entries: this.entries(), created: false, migratedCount: 0, legacyPending: Boolean(this.legacyRaw()), unreadableCount: 0 };
      } finally { oldRaw.fill(0); newRaw.fill(0); }
    });
  }
}
