// Password Manager client: master-password unlock, record sync and
// "Forgot master password?" reset.
//
// The master password is sent over HTTPS to Persora's API, which checks it
// against a salted bcrypt verifier in Postgres and returns a short-lived vault
// token. The token lives only in this object's memory (never in storage), so
// every visit to the vault — on any device — needs the master password again.
// Records travel as JSON over TLS and are stored in Supabase, protected by its
// encryption at rest; they are not encrypted by this code. See PASSWORD_VAULT.md.
import { legacyHasRecoveryKey, legacyStorageKey, recoverLegacyVault, unlockLegacyVault } from "./password-vault-legacy";

export type VaultEntry = { id:string; title:string; login:string; password:string; url:string; notes:string; questions:{question:string;answer:string}[]; folder:string; favorite:boolean; pinned:boolean; updated:number; trash?:{deletedAt:number;expiresAt:number} };

export const MASTER_PASSWORD_MIN_LENGTH = 10;
export const MASTER_PASSWORD_MAX_BYTES = 72;
export const VAULT_TOKEN_HEADER = "X-Persora-Vault-Token";

/** The backend no longer accepts this device's vault session (timed out, locked, or the master password was reset). */
export class VaultLockedError extends Error {
  constructor(message = "Your password vault locked. Enter your master password to continue.") { super(message); this.name = "VaultLockedError"; }
}
/** Another device changed the same record first (or set the master password first). */
export class VaultConflictError extends Error {
  constructor(message: string) { super(message); this.name = "VaultConflictError"; }
}
export class WrongMasterPasswordError extends Error {
  constructor(message = "That master password isn't right. Try again.") { super(message); this.name = "WrongMasterPasswordError"; }
}

export type RemoteItem = { id: string; revision: number; seq: number; deleted: boolean; entry?: VaultEntry };
export type Unlocked = { token: string; expiresAt?: string; items: RemoteItem[]; cursor: number; pending: number };
export type ItemChange = { id: string; baseRevision: number; deleted?: boolean; entry?: VaultEntry };
export type AppliedItem = { id: string; revision: number; seq: number; deleted: boolean };
export type BackendStatus = { hasVault: boolean; records: number; pending: number; recoveryAvailable: boolean };

export interface RecoveryBackend {
  send(): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }>;
  verify(code: string): Promise<{ grant: string }>;
  complete(grant: string, masterPassword: string): Promise<Unlocked>;
}
export interface VaultBackend {
  readonly kind: "server" | "device";
  status(): Promise<BackendStatus>;
  setup(masterPassword: string): Promise<Unlocked>;
  unlock(masterPassword: string): Promise<Unlocked>;
  lock(token: string): Promise<void>;
  changes(token: string, since: number): Promise<{ items: RemoteItem[]; cursor: number; pending: number }>;
  apply(token: string, changes: ItemChange[]): Promise<{ items: AppliedItem[] }>;
  readonly recovery: RecoveryBackend | null;
}

export type VaultStatus = { hasVault: boolean; records: number; hasLegacy: boolean; recoveryAvailable: boolean; backend: "server" | "device"; pending: number };
export type OpenResult = { entries: VaultEntry[]; created: boolean; migratedCount: number; legacyPending: boolean; pending: number };

// ── Server backend (Persora Pages Functions → Supabase) ─────────────────────
type ApiErrorBody = { error?: string; reason?: string };
async function api<T>(path: string, init: RequestInit & { token?: string; body?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.token ? { [VAULT_TOKEN_HEADER]: init.token } : {}) };
  const response = await fetch(`/api/password-vault${path}`, { method: init.method || "GET", headers, body: init.body, credentials: "same-origin", cache: "no-store" });
  if (response.ok) return response.json() as Promise<T>;
  let body: ApiErrorBody = {};
  try { body = await response.json() as ApiErrorBody; } catch { /* keep generic */ }
  const message = body.error || `Persora service returned ${response.status}.`;
  if (body.reason === "vault_locked") throw new VaultLockedError();
  if (body.reason === "wrong_password") throw new WrongMasterPasswordError(message);
  if (response.status === 409 && (body.reason === "conflict" || body.reason === "exists")) throw new VaultConflictError(message);
  throw new Error(message);
}
const post = (body: unknown, token?: string) => ({ method: "POST", body: JSON.stringify(body ?? {}), token });

export function serverVaultBackend(): VaultBackend {
  return {
    kind: "server",
    status: () => api<BackendStatus>(""),
    setup: (masterPassword) => api<Unlocked>("/setup", post({ masterPassword })),
    unlock: (masterPassword) => api<Unlocked>("/unlock", post({ masterPassword })),
    lock: async (token) => { await api("/lock", post({}, token)); },
    changes: (token, since) => api(`/items?since=${encodeURIComponent(String(Math.max(0, Math.floor(since))))}`, { token }),
    apply: (token, changes) => api("/items", post({ changes }, token)),
    recovery: {
      send: () => api("/recovery/send", post({})),
      verify: (code) => api("/recovery/verify", post({ code })),
      complete: (grant, masterPassword) => api<Unlocked>("/recovery/complete", post({ grant, masterPassword })),
    },
  };
}

// ── Device backend (demo workspace only; no Persora account) ────────────────
// Same contract kept in localStorage so the demo behaves like the real vault.
// The demo master password is checked against a salted PBKDF2-SHA-256 verifier
// (WebCrypto); demo records stay on this device and have no email reset.
type DeviceState = { verifier: { salt: string; hash: string; iterations: number } | null; items: Record<string, RemoteItem>; seq: number };
export const deviceVaultStorageKey = (userId: string) => `persora-password-vault-demo:${userId}`;
const DEMO_ITERATIONS = 210_000;
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, material, 256)));
}

export function deviceVaultBackend(userId: string, storage: Storage = localStorage): VaultBackend {
  const key = deviceVaultStorageKey(userId);
  const tokens = new Set<string>();
  const read = (): DeviceState => { try { const value = JSON.parse(storage.getItem(key) || "null"); if (value && typeof value === "object") return value as DeviceState; } catch { /* empty */ } return { verifier: null, items: {}, seq: 0 }; };
  const write = (state: DeviceState) => storage.setItem(key, JSON.stringify(state));
  const live = (state: DeviceState) => Object.values(state.items).filter((item) => !item.deleted).sort((a, b) => a.seq - b.seq);
  const issue = (state: DeviceState): Unlocked => { const token = crypto.randomUUID(); tokens.add(token); return { token, items: live(state), cursor: state.seq, pending: 0 }; };
  const check = (token: string) => { if (!tokens.has(token)) throw new VaultLockedError(); };
  const validate = (password: string) => {
    if (password.length < MASTER_PASSWORD_MIN_LENGTH) throw new Error(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for your master password.`);
    if (new TextEncoder().encode(password).length > MASTER_PASSWORD_MAX_BYTES) throw new Error(`Your master password can be at most ${MASTER_PASSWORD_MAX_BYTES} bytes long.`);
  };
  return {
    kind: "device",
    status: async () => { const state = read(); return { hasVault: Boolean(state.verifier), records: live(state).length, pending: 0, recoveryAvailable: false }; },
    setup: async (password) => {
      validate(password);
      const state = read();
      if (state.verifier) throw new VaultConflictError("A master password was already set for this vault. Unlock with it instead.");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      state.verifier = { salt: b64(salt), hash: await pbkdf2(password, salt, DEMO_ITERATIONS), iterations: DEMO_ITERATIONS };
      write(state);
      return issue(state);
    },
    unlock: async (password) => {
      const state = read();
      if (!state.verifier) throw new Error("Create your master password first.");
      const salt = Uint8Array.from(atob(state.verifier.salt), (c) => c.charCodeAt(0));
      if (await pbkdf2(password, salt, state.verifier.iterations) !== state.verifier.hash) throw new WrongMasterPasswordError();
      return issue(state);
    },
    lock: async (token) => { tokens.delete(token); },
    changes: async (token, since) => { check(token); const state = read(); return { items: Object.values(state.items).filter((item) => item.seq > since).sort((a, b) => a.seq - b.seq), cursor: Math.max(since, state.seq), pending: 0 }; },
    apply: async (token, changes) => {
      check(token);
      const state = read();
      for (const change of changes) {
        const current = state.items[change.id];
        const ok = current ? current.revision === change.baseRevision || (current.deleted && change.baseRevision === 0) : change.baseRevision === 0;
        if (!ok) throw new VaultConflictError("This password was changed elsewhere.");
      }
      const applied: AppliedItem[] = [];
      for (const change of changes) {
        const current = state.items[change.id];
        if (change.deleted) {
          if (!current || current.deleted) continue;
          state.items[change.id] = { id: change.id, revision: current.revision + 1, seq: ++state.seq, deleted: true };
        } else {
          state.items[change.id] = { id: change.id, revision: (current?.revision || 0) + 1, seq: ++state.seq, deleted: false, entry: change.entry };
        }
        const { id, revision, seq, deleted } = state.items[change.id];
        applied.push({ id, revision, seq, deleted });
      }
      write(state);
      return { items: applied };
    },
    recovery: null,
  };
}

// ── Session ─────────────────────────────────────────────────────────────────
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
/** Fills missing fields of a record so the UI can always render it. */
const EMPTY_ENTRY: Omit<VaultEntry, "id" | "updated" | "questions"> = { title: "", login: "", password: "", url: "", notes: "", folder: "", favorite: false, pinned: false };
function complete(entry: VaultEntry): VaultEntry {
  return { ...EMPTY_ENTRY, ...entry, updated: Number.isFinite(entry.updated) ? entry.updated : Date.now(), questions: Array.isArray(entry.questions) ? entry.questions : [] };
}

export class PasswordVaultSession {
  private token: string | null = null;
  private cursor = 0;
  private known = new Map<string, { revision: number; json: string; entry: VaultEntry }>();
  private queue: Promise<unknown> = Promise.resolve();
  private grant: string | null = null;
  private hasVault = false;

  constructor(readonly userId: string, readonly backend: VaultBackend, private readonly storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage) {}

  get isUnlocked() { return this.token !== null; }
  entries(): VaultEntry[] { return [...this.known.values()].map((item) => item.entry); }

  private legacyRaw(): string | null { try { return this.storage?.getItem(legacyStorageKey(this.userId)) || null; } catch { return null; } }
  private dropLegacy() { try { this.storage?.removeItem(legacyStorageKey(this.userId)); } catch { /* storage unavailable */ } }

  /** Serializes vault operations so sync and saves never interleave. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async status(): Promise<VaultStatus> {
    const status = await this.backend.status();
    this.hasVault = status.hasVault;
    return { hasVault: status.hasVault, records: status.records || 0, hasLegacy: Boolean(this.legacyRaw()), recoveryAvailable: Boolean(this.backend.recovery) && status.recoveryAvailable, backend: this.backend.kind, pending: status.pending };
  }

  private adopt(result: Unlocked) {
    this.token = result.token;
    this.cursor = result.cursor;
    this.known = new Map();
    for (const item of result.items) if (!item.deleted && item.entry) { const entry = complete(item.entry); this.known.set(item.id, { revision: item.revision, json: JSON.stringify(entry), entry }); }
  }

  /** Imports a pre-sync on-device vault (v1/v2) that opens with `password`, then removes it. */
  private async importLegacy(password: string): Promise<{ migratedCount: number; legacyPending: boolean }> {
    const legacy = this.legacyRaw();
    if (!legacy) return { migratedCount: 0, legacyPending: false };
    let incoming: VaultEntry[];
    try { incoming = normalizeEntryIds(await unlockLegacyVault(legacy, password)); } catch { return { migratedCount: 0, legacyPending: true }; }
    const migratedCount = await this.mergeEntries(incoming);
    this.dropLegacy();
    return { migratedCount, legacyPending: false };
  }

  /** Creates the master password (first visit) or unlocks with it (every visit, every device). */
  open(password: string): Promise<OpenResult> {
    return this.exclusive(async () => {
      if (password.length < MASTER_PASSWORD_MIN_LENGTH) throw new Error(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for your master password.`);
      let created = false; let result: Unlocked;
      if (this.hasVault) result = await this.backend.unlock(password);
      else {
        try { result = await this.backend.setup(password); created = true; } catch (error) {
          if (error instanceof VaultConflictError) { this.hasVault = true; throw new Error("A master password was just set for your vault on another device. Unlock with that master password."); }
          throw error;
        }
      }
      this.adopt(result);
      this.hasVault = true;
      const legacy = await this.importLegacy(password);
      return { entries: this.entries(), created, ...legacy, pending: result.pending || 0 };
    });
  }

  /** Adds entries missing from the synced vault (or newer copies). Returns the count. */
  private async mergeEntries(incoming: VaultEntry[]): Promise<number> {
    const merged = new Map(this.entries().map((entry) => [entry.id, entry]));
    let count = 0;
    for (const entry of incoming) {
      const current = merged.get(entry.id);
      if (!current || (entry.updated || 0) > (current.updated || 0)) { merged.set(entry.id, complete(entry)); count += 1; }
    }
    if (count) await this.write([...merged.values()]);
    return count;
  }

  /** Merges an older on-device vault protected by a different master password (or its v2 recovery key). */
  mergeLegacy(secret: string): Promise<{ entries: VaultEntry[]; merged: number }> {
    return this.exclusive(async () => {
      const legacy = this.legacyRaw();
      if (!legacy) return { entries: this.entries(), merged: 0 };
      let incoming: VaultEntry[] | null = null;
      try { incoming = await unlockLegacyVault(legacy, secret); } catch { /* try as a recovery key */ }
      if (!incoming && legacyHasRecoveryKey(legacy)) { try { incoming = await recoverLegacyVault(legacy, secret); } catch { /* wrong */ } }
      if (!incoming) throw new Error("That password doesn't unlock the older vault on this device.");
      const merged = await this.mergeEntries(normalizeEntryIds(incoming));
      this.dropLegacy();
      return { entries: this.entries(), merged };
    });
  }

  /** Persists the full entry list by sending only the records that changed. */
  save(next: VaultEntry[]): Promise<VaultEntry[]> { return this.exclusive(() => this.write(next)); }

  private requireToken(): string { if (!this.token) throw new VaultLockedError(); return this.token; }

  private async write(next: VaultEntry[]): Promise<VaultEntry[]> {
    const token = this.requireToken();
    const changes: ItemChange[] = [];
    const seen = new Set<string>();
    for (const entry of next) {
      seen.add(entry.id);
      const known = this.known.get(entry.id);
      if (known?.json === JSON.stringify(entry)) continue;
      changes.push({ id: entry.id, baseRevision: known?.revision || 0, entry });
    }
    for (const [id, known] of this.known) if (!seen.has(id)) changes.push({ id, baseRevision: known.revision, deleted: true });
    for (let offset = 0; offset < changes.length; offset += MAX_BATCH) {
      const batch = changes.slice(offset, offset + MAX_BATCH);
      let result;
      try { result = await this.backend.apply(token, batch); } catch (error) {
        if (error instanceof VaultLockedError) { this.lock(false); throw error; }
        if (error instanceof VaultConflictError) { await this.reload(); throw new VaultConflictError(`${error.message} Your vault now shows the latest version — please make the change again if it's still needed.`); }
        throw error;
      }
      const applied = new Map(result.items.map((item) => [item.id, item]));
      const byId = new Map(next.map((entry) => [entry.id, entry]));
      for (const change of batch) {
        if (change.deleted) { this.known.delete(change.id); continue; }
        const entry = byId.get(change.id)!;
        this.known.set(change.id, { revision: applied.get(change.id)?.revision || (this.known.get(change.id)?.revision || 0) + 1, json: JSON.stringify(entry), entry });
      }
    }
    return this.entries();
  }

  /** Full reload (after a conflict). */
  private async reload() {
    const token = this.requireToken();
    try {
      const snapshot = await this.backend.changes(token, 0);
      this.adopt({ token, ...snapshot });
    } catch (error) { if (error instanceof VaultLockedError) this.lock(false); throw error; }
  }

  /** Pulls changes made on other devices. Resolves null when nothing changed. */
  sync(): Promise<VaultEntry[] | null> {
    return this.exclusive(async () => {
      if (!this.token) return null;
      let snapshot;
      try { snapshot = await this.backend.changes(this.token, this.cursor); } catch (error) { if (error instanceof VaultLockedError) this.lock(false); throw error; }
      let changed = false;
      for (const item of snapshot.items) {
        if (item.deleted || !item.entry) { changed = this.known.delete(item.id) || changed; continue; }
        if (this.known.get(item.id)?.revision === item.revision) continue;
        const entry = complete(item.entry);
        this.known.set(item.id, { revision: item.revision, json: JSON.stringify(entry), entry });
        changed = true;
      }
      this.cursor = snapshot.cursor;
      return changed ? this.entries() : null;
    });
  }

  /** Forgets the token and records locally and (by default) revokes the token on the server. */
  lock(revoke = true) {
    const token = this.token;
    this.token = null; this.known = new Map(); this.cursor = 0; this.grant = null;
    if (revoke && token) void this.backend.lock(token).catch(() => undefined);
  }

  // ── Forgot master password ────────────────────────────────────────────────
  private recoveryBackend() {
    if (!this.backend.recovery) throw new Error("Email reset needs a signed-in Persora account.");
    return this.backend.recovery;
  }
  async sendRecoveryCode() { return this.recoveryBackend().send(); }
  async verifyRecoveryCode(code: string): Promise<void> {
    const result = await this.recoveryBackend().verify(code);
    this.grant = result.grant;
  }
  /** Sets the new master password after a verified OTP. Saved records are not changed. */
  resetMasterPassword(newPassword: string): Promise<OpenResult> {
    return this.exclusive(async () => {
      if (newPassword.length < MASTER_PASSWORD_MIN_LENGTH) throw new Error(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for the new master password.`);
      const grant = this.grant;
      if (!grant) throw new Error("Verify the code from your email first.");
      const result = await this.recoveryBackend().complete(grant, newPassword);
      this.adopt(result);
      this.grant = null; this.hasVault = true;
      const legacy = await this.importLegacy(newPassword);
      return { entries: this.entries(), created: false, ...legacy, pending: result.pending || 0 };
    });
  }
}
