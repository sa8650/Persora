// Read-only support for the two on-device vault formats Persora used before
// encrypted sync (localStorage key `persora-password-vault-v1:${userId}`):
//   v1  {salt, iv, cipher}: PBKDF2-SHA-256 (310k) key directly on the entries.
//   v2  VaultEnvelopeV2: random DEK wrapped by PBKDF2 (master password) and by
//       an HKDF key from an offline recovery key the member saved.
// They are only ever *decrypted* here, to migrate the entries into the synced
// Argon2id vault (see password-vault-client.ts). Nothing writes these formats.
import type { VaultEntry } from "./password-vault-crypto";

export type VaultEnvelopeV2 = { version: 2; kdf: "PBKDF2-SHA-256"; iterations: number; masterSalt: string; recoverySalt: string; dataIv: string; dataCiphertext: string; masterIv: string; masterWrap: string; recoveryIv: string; recoveryWrap: string };
type VaultEnvelopeV1 = { salt: string; iv: string; cipher: string };

export const legacyStorageKey = (userId: string) => `persora-password-vault-v1:${userId}`;
const ITERATIONS = 310000;
const encoder = new TextEncoder();
const un64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
function unb64url(text: string) { const t = text.trim().replace(/-/g, "+").replace(/_/g, "/"); return un64(t + "=".repeat((4 - (t.length % 4)) % 4)); }

async function pbkdf2Key(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations: ITERATIONS }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function hkdfKey(raw: Uint8Array, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(raw), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: encoder.encode("persora-password-vault-recovery-v1") }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function decrypt(key: CryptoKey, iv: string, cipher: string) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(un64(iv)) }, key, new Uint8Array(un64(cipher)));
}
function parseEntries(plain: ArrayBuffer): VaultEntry[] {
  const value = JSON.parse(new TextDecoder().decode(plain));
  if (!Array.isArray(value)) throw new Error("The on-device vault is not readable.");
  return value as VaultEntry[];
}
function parse(raw: string): VaultEnvelopeV1 | VaultEnvelopeV2 {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("The on-device vault is not readable.");
  return parsed;
}

/** True when a v2 envelope (with an offline recovery-key wrap) is present. */
export function legacyHasRecoveryKey(raw: string | null): boolean {
  if (!raw) return false;
  try { return (JSON.parse(raw) as { version?: number }).version === 2; } catch { return false; }
}

/** Decrypts a v1 or v2 on-device vault with its master password. */
export async function unlockLegacyVault(raw: string, password: string): Promise<VaultEntry[]> {
  const parsed = parse(raw);
  if ((parsed as VaultEnvelopeV2).version === 2) {
    const env = parsed as VaultEnvelopeV2;
    const dek = await decrypt(await pbkdf2Key(password, un64(env.masterSalt)), env.masterIv, env.masterWrap);
    const key = await crypto.subtle.importKey("raw", dek, "AES-GCM", false, ["decrypt"]);
    return parseEntries(await decrypt(key, env.dataIv, env.dataCiphertext));
  }
  const v1 = parsed as VaultEnvelopeV1;
  return parseEntries(await decrypt(await pbkdf2Key(password, un64(v1.salt)), v1.iv, v1.cipher));
}

/** Decrypts a v2 on-device vault with the offline recovery key saved at setup. */
export async function recoverLegacyVault(raw: string, recoveryKey: string): Promise<VaultEntry[]> {
  const env = parse(raw) as VaultEnvelopeV2;
  if (env.version !== 2) throw new Error("This on-device vault was created before recovery keys existed and can only be unlocked with its master password.");
  const dek = await decrypt(await hkdfKey(unb64url(recoveryKey), un64(env.recoverySalt)), env.recoveryIv, env.recoveryWrap);
  const key = await crypto.subtle.importKey("raw", dek, "AES-GCM", false, ["decrypt"]);
  return parseEntries(await decrypt(key, env.dataIv, env.dataCiphertext));
}
