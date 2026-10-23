// Persora Password Manager — Pages Functions routes for the encrypted vault.
//
// The browser encrypts every login with AES-256-GCM under a random vault key
// (DEK) that is wrapped with an Argon2id key derived from the member's master
// password (src/lib/password-vault-crypto.ts). These routes only ever receive
// ciphertext, wrapped keys and an *escrow* copy of the DEK sealed to the
// server's recovery public key. They never receive master passwords or
// plaintext entries, and never log request bodies.
//
// Trusted email recovery (NOT zero-knowledge — see PASSWORD_VAULT_RECOVERY.md):
//   1. POST /recovery/send     rate-limited 6-digit OTP to the registered email
//   2. POST /recovery/verify   OTP (hashed, 10 min, 5 attempts, single use)
//                              → single-use recovery grant (15 min, hash stored)
//   3. POST /recovery/key      grant → escrowed DEK decrypted with the private
//                              key in PASSWORD_VAULT_ESCROW_PRIVATE_KEY and
//                              re-sealed to the browser's ephemeral ECDH key
//                              (released once per grant)
//   4. POST /recovery/complete grant → atomically store a NEW vault key wrapped
//                              with the new master password + all entries
//                              re-encrypted under it; grant and OTP consumed.
// Every route is scoped to the authenticated member (identity.id); there are no
// user-supplied ids for vaults, and the tables are RLS-locked to service_role.

export const PASSWORD_VAULT_ROUTE_PREFIX = "/password-vault";
export const VAULT_ITEM_LIMIT = 5000;
export const VAULT_MAX_CHANGES = 1000;
export const VAULT_ITEM_MAX_BYTES = 65536;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
export const RECOVERY_GRANT_TTL_MS = 15 * 60 * 1000;
export const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000;
export const RECOVERY_RESEND_MS = 60 * 1000;
export const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
export const RECOVERY_MAX_SENDS = 5;
export const RECOVERY_MAX_ATTEMPTS = 5;
export const KEY_CHECK_PLAINTEXT = "persora-vault-key-check-v1";
export const ESCROW_INFO = "persora-vault-escrow-v1";
export const TRANSPORT_INFO = "persora-vault-recovery-transport-v1";
const ECIES_ALG = "ECDH-P256+HKDF-SHA256+A256GCM";

export const aad = {
  check: (userId, generation) => `persora-vault/check/v1|${userId}|${generation}`,
  escrow: (userId, generation, keyId) => `persora-vault/escrow/v1|${userId}|${generation}|${keyId}`,
  transport: (userId, generation) => `persora-vault/recovery/v1|${userId}|${generation}`,
};

export class PasswordVaultError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const encoder = new TextEncoder();
function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" },
  });
}
function toBase64(bytes) { let text = ""; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); }
function base64url(bytes) { return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function fromBase64url(text) { const t = text.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); }
function hex(bytes) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(text) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text))); }
export function isUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

/** Strict base64 → bytes with length bounds; anything else is a 400. */
export function decodeBase64(value, { min = 1, max = Infinity, exact, field = "value" } = {}) {
  if (typeof value !== "string" || value.length > Math.ceil(max / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new PasswordVaultError(`The encrypted ${field} is invalid.`, 400);
  }
  let bytes;
  try { bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); } catch { throw new PasswordVaultError(`The encrypted ${field} is invalid.`, 400); }
  if ((exact !== undefined && bytes.length !== exact) || bytes.length < min || bytes.length > max) throw new PasswordVaultError(`The encrypted ${field} is invalid.`, 400);
  return bytes;
}

export function validateKdf(kdf) {
  const ok = kdf && typeof kdf === "object" && kdf.algorithm === "argon2id" && kdf.version === 19
    && Number.isInteger(kdf.memoryKiB) && kdf.memoryKiB >= 19456 && kdf.memoryKiB <= 1048576
    && Number.isInteger(kdf.iterations) && kdf.iterations >= 2 && kdf.iterations <= 20
    && Number.isInteger(kdf.parallelism) && kdf.parallelism >= 1 && kdf.parallelism <= 8;
  if (!ok) throw new PasswordVaultError("The vault must use Argon2id with at least 19 MiB memory and 2 iterations.", 400);
  return { algorithm: "argon2id", version: 19, memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism };
}
function validateSealed(value, ciphertextBytes, field) {
  if (!value || typeof value !== "object") throw new PasswordVaultError(`The encrypted ${field} is invalid.`, 400);
  decodeBase64(value.iv, { exact: 12, field });
  decodeBase64(value.ciphertext, { ...ciphertextBytes, field });
  return { iv: value.iv, ciphertext: value.ciphertext };
}
export function validateEcies(value, field = "recovery key") {
  if (!value || typeof value !== "object" || value.alg !== ECIES_ALG) throw new PasswordVaultError(`The ${field} envelope is invalid.`, 400);
  decodeBase64(value.epk, { exact: 65, field });
  decodeBase64(value.salt, { min: 16, max: 32, field });
  decodeBase64(value.iv, { exact: 12, field });
  decodeBase64(value.ciphertext, { exact: 48, field });
  return { alg: ECIES_ALG, epk: value.epk, salt: value.salt, iv: value.iv, ciphertext: value.ciphertext };
}
/** Vault key material: KDF params, salt, wrapped DEK (32+16), key check, escrow. */
export function validateKeyMaterial(raw) {
  if (!raw || typeof raw !== "object") throw new PasswordVaultError("Vault key material is missing.", 400);
  decodeBase64(raw.salt, { min: 16, max: 64, field: "salt" });
  if (typeof raw.escrowKeyId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(raw.escrowKeyId)) throw new PasswordVaultError("The recovery key id is invalid.", 400);
  return {
    kdf: validateKdf(raw.kdf),
    salt: raw.salt,
    wrappedDek: validateSealed(raw.wrappedDek, { exact: 48 }, "vault key"),
    keyCheck: validateSealed(raw.keyCheck, { exact: encoder.encode(KEY_CHECK_PLAINTEXT).length + 16 }, "key check"),
    escrow: validateEcies(raw.escrow),
    escrowKeyId: raw.escrowKeyId,
  };
}
export function validateItems(raw, max = VAULT_ITEM_LIMIT) {
  if (!Array.isArray(raw)) throw new PasswordVaultError("Encrypted entries are missing.", 400);
  if (raw.length > max) throw new PasswordVaultError(`A vault can hold up to ${VAULT_ITEM_LIMIT} passwords.`, 413);
  const seen = new Set();
  return raw.map((item) => {
    if (!item || !isUuid(item.id) || seen.has(item.id.toLowerCase())) throw new PasswordVaultError("An encrypted entry has an invalid id.", 400);
    seen.add(item.id.toLowerCase());
    return { id: item.id.toLowerCase(), ...validateSealed(item, { min: 17, max: VAULT_ITEM_MAX_BYTES }, "entry") };
  });
}
export function validateChanges(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new PasswordVaultError("No changes to save.", 400);
  if (raw.length > VAULT_MAX_CHANGES) throw new PasswordVaultError(`Save at most ${VAULT_MAX_CHANGES} changes at a time.`, 413);
  const seen = new Set();
  return raw.map((change) => {
    if (!change || !isUuid(change.id) || seen.has(change.id.toLowerCase())) throw new PasswordVaultError("An encrypted entry has an invalid id.", 400);
    seen.add(change.id.toLowerCase());
    if (!Number.isInteger(change.baseRevision) || change.baseRevision < 0) throw new PasswordVaultError("An encrypted entry has an invalid revision.", 400);
    if (change.deleted === true) return { id: change.id.toLowerCase(), baseRevision: change.baseRevision, deleted: true };
    return { id: change.id.toLowerCase(), baseRevision: change.baseRevision, deleted: false, ...validateSealed(change, { min: 17, max: VAULT_ITEM_MAX_BYTES }, "entry") };
  });
}
function validGeneration(value) {
  if (!Number.isInteger(value) || value < 1) throw new PasswordVaultError("The vault key version is invalid.", 400);
  return value;
}
function validGrant(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new PasswordVaultError("This recovery session is no longer valid. Request a new code.", 403);
  return value;
}

// ── Escrow key pair (Worker secret) ─────────────────────────────────────────
const escrowCache = new Map();
async function importEscrowKey(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string" || typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("invalid escrow key");
  const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: false }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const raw = new Uint8Array([4, ...fromBase64url(jwk.x), ...fromBase64url(jwk.y)]);
  if (raw.length !== 65) throw new Error("invalid escrow key");
  const keyId = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))).slice(0, 22);
  return { keyId, privateKey, publicKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } };
}
/**
 * PASSWORD_VAULT_ESCROW_PRIVATE_KEY: JWK (ECDH P-256 private key) used for new
 * escrow copies. PASSWORD_VAULT_ESCROW_RETIRED_KEYS: optional JSON array of
 * older JWKs, still accepted for opening escrow copies until members re-seal.
 */
export async function loadEscrowKeys(env) {
  const current = String(env.PASSWORD_VAULT_ESCROW_PRIVATE_KEY || "").trim();
  const retired = String(env.PASSWORD_VAULT_ESCROW_RETIRED_KEYS || "").trim();
  const cacheKey = `${current}\u0000${retired}`;
  if (escrowCache.has(cacheKey)) return escrowCache.get(cacheKey);
  const result = { current: null, byId: new Map() };
  try {
    if (current) { result.current = await importEscrowKey(JSON.parse(current)); result.byId.set(result.current.keyId, result.current); }
    if (retired) for (const jwk of JSON.parse(retired)) { const key = await importEscrowKey(jwk); if (!result.byId.has(key.keyId)) result.byId.set(key.keyId, key); }
  } catch {
    console.error("Persora password vault escrow key is not a valid P-256 private JWK");
    result.current = null;
  }
  escrowCache.set(cacheKey, result);
  return result;
}

async function eciesKey(privateKey, publicKey, salt, info, usage) {
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(info) }, hkdf, { name: "AES-GCM", length: 256 }, false, [usage]);
}
async function eciesOpen(privateKey, blob, additional, info) {
  const publicKey = await crypto.subtle.importKey("raw", decodeBase64(blob.epk, { exact: 65 }), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const key = await eciesKey(privateKey, publicKey, decodeBase64(blob.salt, { min: 16, max: 32 }), info, "decrypt");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(blob.iv, { exact: 12 }), additionalData: encoder.encode(additional) }, key, decodeBase64(blob.ciphertext, { min: 17 })));
}
async function eciesSeal(recipientJwk, plaintext, additional, info) {
  const publicKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: recipientJwk.x, y: recipientJwk.y, ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await eciesKey(ephemeral.privateKey, publicKey, salt, info, "encrypt");
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(additional) }, key, plaintext));
  return { alg: ECIES_ALG, epk: toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey))), salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

/** Opens an escrow copy and returns the raw DEK (caller must wipe it). */
async function openEscrow(keys, userId, generation, escrow, keyId) {
  const key = keys.byId.get(keyId);
  if (!key) throw new PasswordVaultError("Vault recovery is unavailable because the recovery key was retired. Contact support.", 503);
  let dek;
  try { dek = await eciesOpen(key.privateKey, escrow, aad.escrow(userId, generation, keyId), ESCROW_INFO); } catch { throw new PasswordVaultError("The recovery copy of your vault key couldn't be opened.", 400); }
  if (dek.length !== 32) { dek.fill(0); throw new PasswordVaultError("The recovery copy of your vault key is invalid.", 400); }
  return dek;
}
/**
 * Makes sure an escrow copy really holds this vault's key (so email recovery
 * can never silently fail later): opens it and checks the AES-GCM key check.
 */
async function verifyEscrow(keys, userId, generation, material) {
  if (!keys.current || material.escrowKeyId !== keys.current.keyId) throw new PasswordVaultError("The vault recovery key changed. Reload the Password Manager and try again.", 409, { reason: "escrow_key_changed" });
  const raw = await openEscrow(keys, userId, generation, material.escrow, material.escrowKeyId);
  try {
    const dek = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(material.keyCheck.iv, { exact: 12 }), additionalData: encoder.encode(aad.check(userId, generation)) }, dek, decodeBase64(material.keyCheck.ciphertext, { min: 17 }));
    if (new TextDecoder().decode(plain) !== KEY_CHECK_PLAINTEXT) throw new Error("mismatch");
  } catch {
    throw new PasswordVaultError("The recovery copy doesn't match the vault key. Nothing was saved.", 400);
  } finally { raw.fill(0); }
}

// ── Database (service role; RPCs from 202610230009_password_vault_sync.sql) ──
function defaultRpc(env) {
  return async (fn, args) => {
    const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !secret) throw new PasswordVaultError("Password Manager storage is not configured.", 503);
    const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }) },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const message = String(detail?.message || "");
      if (message.includes("password_vault_item_limit")) throw new PasswordVaultError(`A vault can hold up to ${VAULT_ITEM_LIMIT} passwords.`, 413);
      if (message.includes("password_vault_invalid_items")) throw new PasswordVaultError("The encrypted entries are invalid.", 400);
      console.error("Persora password vault database function failed", fn, response.status);
      throw new PasswordVaultError("Password Manager is temporarily unavailable. Please try again.", 503);
    }
    return response.json();
  };
}
async function rpcCall(rpc, fn, args) {
  try { return await rpc(fn, args); } catch (error) {
    if (error instanceof PasswordVaultError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (message.includes("password_vault_item_limit")) throw new PasswordVaultError(`A vault can hold up to ${VAULT_ITEM_LIMIT} passwords.`, 413);
    if (message.includes("password_vault_invalid_items")) throw new PasswordVaultError("The encrypted entries are invalid.", 400);
    console.error("Persora password vault database request failed", fn);
    throw new PasswordVaultError("Password Manager is temporarily unavailable. Please try again.", 503);
  }
}
const firstRow = (value) => (Array.isArray(value) ? value[0] : value) || {};

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new PasswordVaultError("This request is too large.", 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new PasswordVaultError("This request is too large.", 413);
  try { const value = JSON.parse(text || "{}"); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* fall through */ }
  throw new PasswordVaultError("The request body is not valid JSON.", 400);
}

function snapshotResponse(state, keys) {
  return {
    vault: state?.vault || null,
    items: Array.isArray(state?.items) ? state.items : [],
    cursor: Number(state?.cursor) || 0,
    escrow: keys.current ? { keyId: keys.current.keyId, publicKey: keys.current.publicKey } : null,
    recoveryAvailable: Boolean(keys.current),
  };
}

/** HMAC of the OTP bound to the member id + email (same scheme as 202610210001). */
export async function vaultRecoveryCodeHash(identity, code, env) {
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!secret) throw new PasswordVaultError("Vault recovery is not configured.", 503);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = `persora-vault-recovery-v1|${identity.id}|${String(identity.email || "").trim().toLowerCase()}|${code}`;
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}
export function secureSixDigitCode() {
  const range = 900_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return String(100_000 + (sample[0] % range));
}

const KEY_CHANGED = "Your master password was reset on another device. Unlock with the new master password.";
const GRANT_INVALID = "This recovery session is no longer valid. Request a new code.";

export async function handlePasswordVault(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4); // Pages serves the API under /api
  const path = url.pathname.slice(PASSWORD_VAULT_ROUTE_PREFIX.length) || "/";
  const rpc = services.rpc || defaultRpc(env);
  const now = services.now || (() => new Date());
  const method = request.method;
  const userId = identity.id;
  try {
    const keys = await loadEscrowKeys(env);

    if ((path === "/" || path === "") && method === "GET") {
      return json(snapshotResponse(await rpcCall(rpc, "persora_password_vault_state", { p_user_id: userId, p_since: 0 }), keys), 200, origin);
    }
    if (path === "/changes" && method === "GET") {
      const since = Number(url.searchParams.get("since") || 0);
      if (!Number.isSafeInteger(since) || since < 0) throw new PasswordVaultError("The sync cursor is invalid.", 400);
      return json(snapshotResponse(await rpcCall(rpc, "persora_password_vault_state", { p_user_id: userId, p_since: since }), keys), 200, origin);
    }
    if (path === "/setup" && method === "POST") {
      if (!keys.current) throw new PasswordVaultError("Password Manager recovery isn't configured on this Persora server yet, so a new vault can't be created. Ask your administrator to finish the Password Manager setup.", 503);
      const body = await readJson(request);
      const vault = validateKeyMaterial(body.vault);
      const items = validateItems(body.items);
      await verifyEscrow(keys, userId, 1, vault);
      const result = await rpcCall(rpc, "persora_password_vault_setup", { p_user_id: userId, p_vault: vault, p_items: items });
      if (result?.outcome === "exists") throw new PasswordVaultError("A password vault already exists for your account. Unlock it instead.", 409, { reason: "exists" });
      if (result?.outcome !== "created") throw new PasswordVaultError("Password Manager is temporarily unavailable. Please try again.", 503);
      return json(snapshotResponse(result.state, keys), 201, origin);
    }
    if (path === "/items" && method === "POST") {
      const body = await readJson(request);
      const keyGeneration = validGeneration(body.keyGeneration);
      const changes = validateChanges(body.changes);
      const result = await rpcCall(rpc, "persora_password_vault_apply", { p_user_id: userId, p_key_generation: keyGeneration, p_changes: changes });
      if (result?.outcome === "ok") return json({ items: result.items || [] }, 200, origin);
      if (result?.outcome === "missing") throw new PasswordVaultError("Create your password vault first.", 404);
      if (result?.outcome === "key_changed") throw new PasswordVaultError(KEY_CHANGED, 409, { reason: "key_changed" });
      if (result?.outcome === "conflict") throw new PasswordVaultError("This password was changed on another device.", 409, { reason: "conflict", conflicts: result.conflicts || [] });
      throw new PasswordVaultError("Password Manager is temporarily unavailable. Please try again.", 503);
    }
    if (path === "/escrow" && method === "PUT") {
      const body = await readJson(request);
      const keyGeneration = validGeneration(body.keyGeneration);
      const escrow = validateEcies(body.escrow);
      const state = await rpcCall(rpc, "persora_password_vault_state", { p_user_id: userId, p_since: Number.MAX_SAFE_INTEGER });
      if (!state?.vault) throw new PasswordVaultError("Create your password vault first.", 404);
      if (state.vault.keyGeneration !== keyGeneration) throw new PasswordVaultError(KEY_CHANGED, 409, { reason: "key_changed" });
      await verifyEscrow(keys, userId, keyGeneration, { escrow, escrowKeyId: body.escrowKeyId, keyCheck: state.vault.keyCheck });
      const result = await rpcCall(rpc, "persora_password_vault_update_escrow", { p_user_id: userId, p_key_generation: keyGeneration, p_escrow: escrow, p_escrow_key_id: body.escrowKeyId });
      if (result?.outcome !== "ok") throw new PasswordVaultError(KEY_CHANGED, 409, { reason: "key_changed" });
      return json({ ok: true }, 200, origin);
    }

    // ── Forgot master password ──────────────────────────────────────────────
    if (path === "/recovery/send" && method === "POST") {
      if (!identity.email || identity.account_status !== "active") throw new PasswordVaultError("An active account email is required to recover the vault.", 403);
      if (typeof services.prepareRecoveryEmail !== "function") throw new PasswordVaultError("Vault recovery email is temporarily unavailable.", 503);
      const sendEmail = await services.prepareRecoveryEmail(); // fails before reserving if email isn't configured
      const at = now();
      const code = secureSixDigitCode();
      const codeHash = await vaultRecoveryCodeHash(identity, code, env);
      const reservation = firstRow(await rpcCall(rpc, "reserve_vault_recovery_send", {
        p_user_id: userId, p_email: String(identity.email).trim().toLowerCase(), p_code_hash: codeHash,
        p_now: at.toISOString(), p_expires_at: new Date(at.getTime() + RECOVERY_OTP_TTL_MS).toISOString(),
        p_resend_seconds: RECOVERY_RESEND_MS / 1000, p_window_seconds: RECOVERY_WINDOW_MS / 1000, p_max_sends: RECOVERY_MAX_SENDS,
      }));
      if (reservation.allowed !== true) {
        if (reservation.reason === "resend") throw new PasswordVaultError(`Please wait ${Math.max(1, Number(reservation.retry_after_seconds) || 60)} seconds before requesting another code.`, 429);
        if (reservation.reason === "hourly_limit") throw new PasswordVaultError("Too many recovery emails. Try again in an hour.", 429);
        if (reservation.reason === "email_changed") throw new PasswordVaultError("Your account email changed. Sign in again and retry.", 409);
        throw new PasswordVaultError("Vault recovery email is temporarily unavailable.", 503);
      }
      try {
        await sendEmail({
          to: identity.email,
          subject: "Your Persora Password Manager recovery code",
          textContent: `Your Password Manager recovery code is ${code}. It expires in 10 minutes and can be used once. Use it to set a new master password for your Persora password vault. If you didn't request this, ignore this email; your vault stays locked and your master password is unchanged.`,
          htmlContent: `<div style="font-family:Arial,sans-serif;color:#182230;max-width:520px;margin:24px auto;padding:28px;border:1px solid #e5e7eb;border-radius:16px"><h2>Reset your Password Manager master password</h2><p>Your one-time code:</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1a73e8">${code}</p><p>It expires in 10 minutes and can be used once. If you didn't request this, ignore this email — your vault stays locked and your master password is unchanged.</p></div>`,
        });
      } catch (error) {
        await rpcCall(rpc, "invalidate_vault_recovery_code", { p_user_id: userId, p_code_hash: codeHash, p_now: new Date().toISOString() }).catch(() => {});
        throw error;
      }
      return json({ ok: true, expiresInSeconds: RECOVERY_OTP_TTL_MS / 1000, resendAfterSeconds: RECOVERY_RESEND_MS / 1000 }, 200, origin);
    }
    if (path === "/recovery/verify" && method === "POST") {
      const body = await readJson(request);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) throw new PasswordVaultError("Enter the six-digit code from your recovery email.", 400);
      const grant = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const at = now();
      const result = await rpcCall(rpc, "persora_vault_recovery_verify", {
        p_user_id: userId, p_email: String(identity.email || "").trim().toLowerCase(),
        p_candidate_hash: await vaultRecoveryCodeHash(identity, code, env), p_now: at.toISOString(), p_max_attempts: RECOVERY_MAX_ATTEMPTS,
        p_grant_hash: await sha256Hex(grant), p_grant_expires_at: new Date(at.getTime() + RECOVERY_GRANT_TTL_MS).toISOString(),
      });
      switch (result?.outcome) {
        case "success": return json({ ok: true, verified: true, hasVault: result.hasVault === true, grant: result.hasVault === true ? grant : null, grantExpiresInSeconds: RECOVERY_GRANT_TTL_MS / 1000 }, 200, origin);
        case "expired": throw new PasswordVaultError("That code has expired. Request a new code.", 400);
        case "mismatch": throw new PasswordVaultError("That code doesn't match. Check your email and try again.", 400);
        case "too_many_attempts": throw new PasswordVaultError("Too many incorrect attempts. Request a new code.", 429);
        case "email_changed": throw new PasswordVaultError("Your account email changed. Request a new code.", 409);
        default: throw new PasswordVaultError("Request a new recovery code before trying again.", 400);
      }
    }
    if (path === "/recovery/key" && method === "POST") {
      const body = await readJson(request);
      const grant = validGrant(body.grant);
      const jwk = body.publicKey;
      if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || "d" in jwk) throw new PasswordVaultError("The browser recovery key is invalid.", 400);
      try { await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDH", namedCurve: "P-256" }, false, []); } catch { throw new PasswordVaultError("The browser recovery key is invalid.", 400); }
      const released = await rpcCall(rpc, "persora_vault_recovery_release", { p_user_id: userId, p_grant_hash: await sha256Hex(grant), p_now: now().toISOString() });
      if (released?.outcome === "already_released") throw new PasswordVaultError("This recovery session was already used. Request a new code.", 409, { reason: "grant_used" });
      if (released?.outcome === "missing") throw new PasswordVaultError("There is no synced vault to recover.", 404);
      if (released?.outcome !== "ok") throw new PasswordVaultError(GRANT_INVALID, 403);
      const dek = await openEscrow(keys, userId, released.keyGeneration, released.escrow, released.escrowKeyId);
      try {
        const transport = await eciesSeal(jwk, dek, aad.transport(userId, released.keyGeneration), TRANSPORT_INFO);
        return json({ keyGeneration: released.keyGeneration, transport }, 200, origin);
      } finally { dek.fill(0); }
    }
    if (path === "/recovery/complete" && method === "POST") {
      if (!keys.current) throw new PasswordVaultError("Password Manager recovery isn't configured on this server.", 503);
      const body = await readJson(request);
      const grant = validGrant(body.grant);
      const expected = validGeneration(body.expectedKeyGeneration);
      const vault = validateKeyMaterial(body.vault);
      const items = validateItems(body.items);
      await verifyEscrow(keys, userId, expected + 1, vault);
      const result = await rpcCall(rpc, "persora_vault_recovery_complete", {
        p_user_id: userId, p_grant_hash: await sha256Hex(grant), p_now: now().toISOString(), p_expected_generation: expected, p_vault: vault, p_items: items,
      });
      switch (result?.outcome) {
        case "ok": return json(snapshotResponse(result.state, keys), 200, origin);
        case "key_changed": throw new PasswordVaultError("Your vault changed during recovery. Request a new code and try again.", 409, { reason: "key_changed" });
        case "items_mismatch": throw new PasswordVaultError("Your vault changed during recovery. Request a new code and try again — nothing was changed.", 409, { reason: "items_mismatch" });
        case "missing": throw new PasswordVaultError("There is no synced vault to recover.", 404);
        default: throw new PasswordVaultError(GRANT_INVALID, 403);
      }
    }
    throw new PasswordVaultError("Not found.", 404);
  } catch (error) {
    if (error instanceof PasswordVaultError) return json({ error: error.message, ...error.extra }, error.status, origin);
    if (error && typeof error.status === "number" && error.message) return json({ error: error.message }, error.status, origin); // e.g. email provider HttpError
    console.error("Persora password vault request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "Password Manager is temporarily unavailable. Please try again." }, 503, origin);
  }
}
