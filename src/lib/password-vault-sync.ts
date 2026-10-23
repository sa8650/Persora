// Storage backends for the encrypted Password Manager vault. Both only ever
// see ciphertext + wrapped keys produced by password-vault-crypto.ts.
//   * serverVaultBackend: Persora's database through the authenticated Pages
//     Functions routes (cloudflare/password-vault.js) — multi-device sync and
//     trusted email recovery.
//   * deviceVaultBackend: same contract kept in localStorage, used for demo mode
//     (no Persora account / API), so the UI behaves identically there.
import { PagesApiError, pagesApiJson } from "./cloud";
import type { EciesBlob, EscrowPublicKey, VaultKeyInfo, VaultKeyMaterial } from "./password-vault-crypto";

export type RemoteItem = { id: string; revision: number; seq: number; deleted: boolean; keyGeneration: number; iv?: string | null; ciphertext?: string | null };
export type VaultSnapshot = { vault: VaultKeyInfo | null; items: RemoteItem[]; cursor: number; escrow: EscrowPublicKey | null; recoveryAvailable: boolean };
export type NewItem = { id: string; iv: string; ciphertext: string };
export type ItemChange = { id: string; baseRevision: number; deleted?: boolean; iv?: string; ciphertext?: string };
export type AppliedItem = { id: string; revision: number; seq: number; deleted: boolean; keyGeneration: number };

/** The server refused a write because another device changed the vault first. */
export class VaultConflictError extends Error {
  constructor(message: string) { super(message); this.name = "VaultConflictError"; }
}

export interface RecoveryBackend {
  send(): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }>;
  verify(code: string): Promise<{ hasVault: boolean; grant: string | null }>;
  releaseKey(grant: string, publicKey: JsonWebKey): Promise<{ keyGeneration: number; transport: EciesBlob }>;
  complete(input: { grant: string; expectedKeyGeneration: number; vault: VaultKeyMaterial; items: NewItem[] }): Promise<VaultSnapshot>;
}
export interface VaultBackend {
  readonly kind: "server" | "device";
  load(): Promise<VaultSnapshot>;
  changes(since: number): Promise<VaultSnapshot>;
  setup(input: { vault: VaultKeyMaterial; items: NewItem[] }): Promise<VaultSnapshot>;
  apply(input: { keyGeneration: number; changes: ItemChange[] }): Promise<{ items: AppliedItem[] }>;
  updateEscrow(input: { keyGeneration: number; escrow: EciesBlob; escrowKeyId: string }): Promise<void>;
  readonly recovery: RecoveryBackend | null;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  try {
    return await pagesApiJson<T>(`/password-vault${path}`, method === "GET" ? { method } : { method, headers: JSON_HEADERS, body: JSON.stringify(body ?? {}) });
  } catch (error) {
    if (error instanceof PagesApiError && error.status === 409) throw new VaultConflictError(error.message);
    throw error;
  }
}

export function serverVaultBackend(): VaultBackend {
  return {
    kind: "server",
    load: () => call<VaultSnapshot>(""),
    changes: (since) => call<VaultSnapshot>(`/changes?since=${encodeURIComponent(String(Math.max(0, Math.floor(since))))}`),
    setup: (input) => call<VaultSnapshot>("/setup", "POST", input),
    apply: (input) => call<{ items: AppliedItem[] }>("/items", "POST", input),
    updateEscrow: async (input) => { await call<{ ok: boolean }>("/escrow", "PUT", input); },
    recovery: {
      send: () => call("/recovery/send", "POST", {}),
      verify: (code) => call("/recovery/verify", "POST", { code }),
      releaseKey: (grant, publicKey) => call("/recovery/key", "POST", { grant, publicKey }),
      complete: (input) => call<VaultSnapshot>("/recovery/complete", "POST", input),
    },
  };
}

type DeviceState = { vault: (VaultKeyInfo & { escrow: EciesBlob | null }) | null; items: Record<string, RemoteItem>; seq: number };
export const deviceVaultStorageKey = (userId: string) => `persora-password-vault-v3:${userId}`;

/** localStorage implementation of the same contract (demo mode; no recovery). */
export function deviceVaultBackend(userId: string, storage: Storage = localStorage): VaultBackend {
  const key = deviceVaultStorageKey(userId);
  const read = (): DeviceState => { try { const value = JSON.parse(storage.getItem(key) || "null"); if (value && typeof value === "object") return value as DeviceState; } catch { /* treat as empty */ } return { vault: null, items: {}, seq: 0 }; };
  const write = (state: DeviceState) => storage.setItem(key, JSON.stringify(state));
  const snapshot = (state: DeviceState, since = 0): VaultSnapshot => {
    const items = Object.values(state.items).filter((item) => item.seq > since && (since > 0 || !item.deleted)).sort((a, b) => a.seq - b.seq);
    const vault = state.vault ? { keyGeneration: state.vault.keyGeneration, kdf: state.vault.kdf, salt: state.vault.salt, wrappedDek: state.vault.wrappedDek, keyCheck: state.vault.keyCheck, escrowKeyId: null } : null;
    return { vault, items: vault ? items : [], cursor: vault ? Math.max(since, ...Object.values(state.items).map((item) => item.seq), 0) : 0, escrow: null, recoveryAvailable: false };
  };
  return {
    kind: "device",
    load: async () => snapshot(read()),
    changes: async (since) => snapshot(read(), since),
    setup: async ({ vault, items }) => {
      const state = read();
      if (state.vault) throw new VaultConflictError("A password vault already exists. Unlock it instead.");
      state.vault = { keyGeneration: 1, kdf: vault.kdf, salt: vault.salt, wrappedDek: vault.wrappedDek, keyCheck: vault.keyCheck, escrowKeyId: null, escrow: null };
      state.items = {};
      for (const item of items) state.items[item.id] = { id: item.id, iv: item.iv, ciphertext: item.ciphertext, revision: 1, seq: ++state.seq, deleted: false, keyGeneration: 1 };
      write(state);
      return snapshot(state);
    },
    apply: async ({ keyGeneration, changes }) => {
      const state = read();
      if (!state.vault) throw new VaultConflictError("The vault no longer exists.");
      if (state.vault.keyGeneration !== keyGeneration) throw new VaultConflictError("Your master password was reset. Unlock again to continue.");
      for (const change of changes) {
        const current = state.items[change.id];
        const ok = current ? current.revision === change.baseRevision || (current.deleted && change.baseRevision === 0) : change.baseRevision === 0;
        if (!ok) throw new VaultConflictError("This password changed elsewhere. Your vault was refreshed.");
      }
      const applied: AppliedItem[] = [];
      for (const change of changes) {
        const current = state.items[change.id];
        if (change.deleted) {
          if (!current || current.deleted) continue;
          state.items[change.id] = { ...current, iv: null, ciphertext: null, deleted: true, revision: current.revision + 1, seq: ++state.seq };
        } else {
          state.items[change.id] = { id: change.id, iv: change.iv, ciphertext: change.ciphertext, deleted: false, keyGeneration, revision: (current?.revision || 0) + 1, seq: ++state.seq };
        }
        const { id, revision, seq, deleted } = state.items[change.id];
        applied.push({ id, revision, seq, deleted, keyGeneration });
      }
      write(state);
      return { items: applied };
    },
    updateEscrow: async () => { /* device vaults have no escrow */ },
    recovery: null,
  };
}
