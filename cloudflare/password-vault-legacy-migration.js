// ONE-TIME MIGRATION — delete this file (and its two call sites in
// password-vault.js plus scripts/migrate-password-vault-legacy.mjs) once
// 202610240002_password_vault_drop_legacy_encryption.sql has been applied.
//
// Converts records saved by the retired Password Manager release (browser-side
// AES-256-GCM under a per-member vault key, with an escrow copy of that key
// sealed to the server's PASSWORD_VAULT_ESCROW_PRIVATE_KEY) into the plain JSON
// records used now. It uses only the escrow copy, never a master password, so
// no Argon2id is involved: ECDH P-256 + HKDF-SHA-256 opens the escrowed vault
// key, the AES-GCM key-check value confirms it, and each record is decrypted
// with AES-GCM and its original additional data (member id, key generation,
// record id). Decrypted records are stored with persora_vault_legacy_store,
// which only converts rows still at the same revision. A record that can't be
// opened is left untouched and reported, never deleted.

import { normalizeVaultEntry } from "./password-vault.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ESCROW_INFO = "persora-vault-escrow-v1";
const KEY_CHECK_PLAINTEXT = "persora-vault-key-check-v1";
const aad = {
  escrow: (userId, generation, keyId) => `persora-vault/escrow/v1|${userId}|${generation}|${keyId}`,
  check: (userId, generation) => `persora-vault/check/v1|${userId}|${generation}`,
  item: (userId, generation, itemId) => `persora-vault/item/v1|${userId}|${generation}|${itemId}`,
};
const b64 = (text) => Uint8Array.from(atob(String(text || "")), (c) => c.charCodeAt(0));
function b64urlDecode(text) { const t = String(text).replace(/-/g, "+").replace(/_/g, "/"); return b64(t + "=".repeat((4 - (t.length % 4)) % 4)); }
function b64url(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

export function legacyMigrationConfigured(env) { return Boolean(String(env?.PASSWORD_VAULT_ESCROW_PRIVATE_KEY || "").trim()); }

async function importEscrowKey(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string" || typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("invalid escrow key");
  const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: false }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const raw = new Uint8Array([4, ...b64urlDecode(jwk.x), ...b64urlDecode(jwk.y)]);
  const keyId = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))).slice(0, 22);
  return { keyId, privateKey };
}
/** PASSWORD_VAULT_ESCROW_PRIVATE_KEY plus optional PASSWORD_VAULT_ESCROW_RETIRED_KEYS (JSON array). */
export async function loadEscrowKeys(env) {
  const keys = new Map();
  const current = String(env?.PASSWORD_VAULT_ESCROW_PRIVATE_KEY || "").trim();
  const retired = String(env?.PASSWORD_VAULT_ESCROW_RETIRED_KEYS || "").trim();
  for (const jwk of [...(current ? [JSON.parse(current)] : []), ...(retired ? JSON.parse(retired) : [])]) {
    const key = await importEscrowKey(jwk);
    if (!keys.has(key.keyId)) keys.set(key.keyId, key);
  }
  return keys;
}

async function openEscrow(privateKey, blob, additional) {
  const publicKey = await crypto.subtle.importKey("raw", b64(blob.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: b64(blob.salt), info: encoder.encode(ESCROW_INFO) }, hkdf, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv), additionalData: encoder.encode(additional) }, key, b64(blob.ciphertext)));
}
async function gcmOpen(key, sealed, additional) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(sealed.iv), additionalData: encoder.encode(additional) }, key, b64(sealed.ciphertext)));
}

/** Decrypts one member's pending legacy records. Returns { items, failed, reason }. */
export async function decryptLegacyVault(vault, keys, now = Date.now()) {
  const { userId, keyGeneration } = vault;
  const key = keys.get(vault.escrowKeyId);
  if (!key) return { items: [], failed: vault.items.length, reason: "escrow_key_unavailable" };
  let dek;
  try {
    const raw = await openEscrow(key.privateKey, vault.escrow, aad.escrow(userId, keyGeneration, vault.escrowKeyId));
    if (raw.length !== 32) throw new Error("bad key length");
    dek = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    raw.fill(0);
    if (decoder.decode(await gcmOpen(dek, vault.keyCheck, aad.check(userId, keyGeneration))) !== KEY_CHECK_PLAINTEXT) throw new Error("key check");
  } catch {
    return { items: [], failed: vault.items.length, reason: "escrow_unreadable" };
  }
  const items = []; let failed = 0;
  for (const item of vault.items) {
    try {
      const entry = JSON.parse(decoder.decode(await gcmOpen(dek, item, aad.item(userId, item.keyGeneration ?? keyGeneration, item.id))));
      if (!entry || String(entry.id).toLowerCase() !== String(item.id).toLowerCase()) throw new Error("id mismatch");
      items.push({ id: item.id, revision: item.revision, data: normalizeVaultEntry(entry, { strict: false, now }) });
    } catch { failed += 1; }
  }
  return { items, failed, reason: failed ? "record_unreadable" : null };
}

/**
 * Converts pending legacy vaults (one member when userId is given, otherwise
 * every member, in user-id order). Safe to run repeatedly and concurrently
 * with live traffic. Returns a report without any record contents.
 */
export async function migrateLegacyVaults({ rpc, env, userId = null, limit = 50, maxVaults = 500, dryRun = false }) {
  const keys = await loadEscrowKeys(env);
  const report = { vaults: 0, converted: 0, failed: [], dryRun, next: null };
  let after = null;
  while (report.vaults < maxVaults) {
    const page = await rpc("persora_vault_legacy_pending", { p_user_id: userId, p_limit: limit, p_after: after });
    const vaults = Array.isArray(page) ? page : [];
    if (!vaults.length) break;
    for (const vault of vaults) {
      report.vaults += 1; after = vault.userId;
      const result = await decryptLegacyVault(vault, keys);
      if (result.items.length && !dryRun) {
        const stored = await rpc("persora_vault_legacy_store", { p_user_id: vault.userId, p_items: result.items });
        report.converted += Number(stored?.stored) || 0;
      } else if (dryRun) report.converted += result.items.length;
      if (result.failed) report.failed.push({ userId: vault.userId, records: result.failed, reason: result.reason });
    }
    if (userId || vaults.length < limit) { after = null; break; }
  }
  report.next = after;
  const remaining = await rpc("persora_vault_legacy_pending", { p_user_id: userId, p_limit: 500, p_after: null });
  report.pendingVaults = Array.isArray(remaining) ? remaining.length : 0;
  report.pending = Array.isArray(remaining) ? remaining.reduce((sum, vault) => sum + (vault.items?.length || 0), 0) : 0;
  return report;
}
