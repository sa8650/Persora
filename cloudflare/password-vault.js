// Persora Password Manager — Pages Functions routes.
//
// Model (see PASSWORD_VAULT.md):
//   * A master password, separate from the Persora sign-in password, gates the
//     vault. Postgres stores only a salted bcrypt verifier (pgcrypto, the same
//     implementation Persora uses for sign-in passwords) and checks it inside
//     persora_vault_unlock — on every unlock, on every device.
//   * A successful unlock returns a random vault token (only its SHA-256 is
//     stored), bound to the member's Persora session, sliding 30-minute idle
//     timeout, 12-hour maximum. Every record read/write must present it in the
//     X-Persora-Vault-Token header and the database function re-checks it, so
//     the master password is enforced by the backend, not just by the UI.
//   * Saved logins are stored as JSON in password_vault_items.data. They are
//     NOT encrypted by the application: they rely on Supabase's
//     provider-managed encryption at rest and on TLS in transit. The master
//     password is an access control, not an encryption key.
//   * Forgot master password: rate-limited 6-digit email OTP (HMAC-hashed,
//     10 minutes, 5 attempts, single use) → 15-minute single-use reset grant →
//     new verifier. Records are never touched; every device must unlock again.
//
// Every route is scoped to the authenticated member (identity.id) and their
// Persora session (identity.session_id). No route accepts a user id from the
// client. Request bodies and master passwords are never logged.

export const PASSWORD_VAULT_ROUTE_PREFIX = "/password-vault";
export const VAULT_TOKEN_HEADER = "X-Persora-Vault-Token";
export const VAULT_ITEM_LIMIT = 5000;
export const VAULT_MAX_CHANGES = 1000;
export const VAULT_ITEM_MAX_BYTES = 65536;
export const MASTER_PASSWORD_MIN_LENGTH = 10;
export const MASTER_PASSWORD_MAX_BYTES = 72; // bcrypt input limit
export const VAULT_IDLE_SECONDS = 30 * 60;
export const VAULT_MAX_SECONDS = 12 * 60 * 60;
export const VAULT_MAX_UNLOCK_FAILURES = 5; // then 15 minutes blocked (auth_login_attempts)
export const RECOVERY_GRANT_TTL_MS = 15 * 60 * 1000;
export const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000;
export const RECOVERY_RESEND_MS = 60 * 1000;
export const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
export const RECOVERY_MAX_SENDS = 5;
export const RECOVERY_MAX_ATTEMPTS = 5;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

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
function hex(bytes) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(text) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text))); }
export function isUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
const newToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// ── Record validation ───────────────────────────────────────────────────────
const LIMITS = { title: 1000, login: 1000, password: 4096, url: 4096, notes: 20000, folder: 200, question: 2000, answer: 2000, questions: 50 };
function text(value, max, field, strict) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") { if (strict) throw new PasswordVaultError(`The ${field} of a saved password is invalid.`, 400); return String(value); }
  if (strict && value.length > max) throw new PasswordVaultError(`The ${field} of a saved password is too long.`, 400);
  return value;
}
function timestamp(value, fallback) { const n = Number(value); return Number.isFinite(n) && n >= 0 && n < 8.64e15 ? Math.floor(n) : fallback; }

/**
 * Canonical stored shape of one saved login (the `data` JSON, without id).
 * strict = API input (types and lengths enforced); lenient = legacy migration
 * (coerces old values so no saved password is dropped).
 */
export function normalizeVaultEntry(raw, { strict = true, now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PasswordVaultError("A saved password is invalid.", 400);
  const rawQuestions = raw.questions === undefined || raw.questions === null ? [] : raw.questions;
  if (!Array.isArray(rawQuestions) || (strict && rawQuestions.length > LIMITS.questions)) throw new PasswordVaultError("The security questions of a saved password are invalid.", 400);
  const data = {
    title: text(raw.title, LIMITS.title, "title", strict),
    login: text(raw.login, LIMITS.login, "username", strict),
    password: text(raw.password, LIMITS.password, "password", strict),
    url: text(raw.url, LIMITS.url, "website", strict),
    notes: text(raw.notes, LIMITS.notes, "notes", strict),
    questions: rawQuestions.filter((qa) => qa && typeof qa === "object").map((qa) => ({ question: text(qa.question, LIMITS.question, "security question", strict), answer: text(qa.answer, LIMITS.answer, "security answer", strict) })),
    folder: text(raw.folder, LIMITS.folder, "folder", strict),
    favorite: raw.favorite === true,
    pinned: raw.pinned === true,
    updated: timestamp(raw.updated, now),
  };
  if (raw.trash && typeof raw.trash === "object") {
    const deletedAt = timestamp(raw.trash.deletedAt, NaN); const expiresAt = timestamp(raw.trash.expiresAt, NaN);
    if (Number.isFinite(deletedAt) && Number.isFinite(expiresAt)) data.trash = { deletedAt, expiresAt };
    else if (strict) throw new PasswordVaultError("The Trash state of a saved password is invalid.", 400);
  }
  if (encoder.encode(JSON.stringify(data)).length > VAULT_ITEM_MAX_BYTES - 1024) throw new PasswordVaultError("A saved password is too large.", 413);
  return data;
}

export function validateChanges(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new PasswordVaultError("No changes to save.", 400);
  if (raw.length > VAULT_MAX_CHANGES) throw new PasswordVaultError(`Save at most ${VAULT_MAX_CHANGES} changes at a time.`, 413);
  const seen = new Set();
  return raw.map((change) => {
    if (!change || !isUuid(change.id) || seen.has(change.id.toLowerCase())) throw new PasswordVaultError("A saved password has an invalid id.", 400);
    seen.add(change.id.toLowerCase());
    if (!Number.isInteger(change.baseRevision) || change.baseRevision < 0) throw new PasswordVaultError("A saved password has an invalid revision.", 400);
    if (change.deleted === true) return { id: change.id.toLowerCase(), baseRevision: change.baseRevision, deleted: true };
    return { id: change.id.toLowerCase(), baseRevision: change.baseRevision, deleted: false, data: normalizeVaultEntry(change.entry) };
  });
}

function masterPassword(value, label = "master password") {
  if (typeof value !== "string" || value.length < MASTER_PASSWORD_MIN_LENGTH) throw new PasswordVaultError(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for your ${label}.`, 400, { reason: "too_short" });
  if (encoder.encode(value).length > MASTER_PASSWORD_MAX_BYTES) throw new PasswordVaultError(`Your ${label} can be at most ${MASTER_PASSWORD_MAX_BYTES} bytes long (about ${MASTER_PASSWORD_MAX_BYTES} letters or numbers).`, 400, { reason: "too_long" });
  return value;
}
function outcomeError(outcome) {
  switch (outcome) {
    case "too_short": return new PasswordVaultError(`Use at least ${MASTER_PASSWORD_MIN_LENGTH} characters for your master password.`, 400, { reason: outcome });
    case "too_long": return new PasswordVaultError(`Your master password can be at most ${MASTER_PASSWORD_MAX_BYTES} bytes long.`, 400, { reason: outcome });
    case "same_as_login": return new PasswordVaultError("Choose a master password that's different from your Persora sign-in password.", 400, { reason: outcome });
    case "locked": return new PasswordVaultError(VAULT_LOCKED, 403, { reason: "vault_locked" });
    default: return new PasswordVaultError(UNAVAILABLE, 503);
  }
}

// ── Database (service role; RPCs from 202610240001) ─────────────────────────
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
      const error = new Error(String(detail?.message || `rpc ${response.status}`));
      error.rpcStatus = response.status;
      throw error;
    }
    return response.json();
  };
}
async function rpcCall(rpc, fn, args) {
  try { return await rpc(fn, args); } catch (error) {
    if (error instanceof PasswordVaultError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (message.includes("password_vault_item_limit")) throw new PasswordVaultError(`A vault can hold up to ${VAULT_ITEM_LIMIT} passwords.`, 413);
    if (message.includes("password_vault_invalid_items")) throw new PasswordVaultError("The saved passwords are invalid.", 400);
    if (message.includes("password_vault_session_invalid")) throw new PasswordVaultError("Your session expired. Sign in again.", 401);
    console.error("Persora password vault database request failed", fn, error?.rpcStatus || (error instanceof Error ? error.name : "unknown"));
    throw new PasswordVaultError(UNAVAILABLE, 503);
  }
}
const firstRow = (value) => (Array.isArray(value) ? value[0] : value) || {};

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new PasswordVaultError("This request is too large.", 413);
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) throw new PasswordVaultError("This request is too large.", 413);
  try { const value = JSON.parse(body || "{}"); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* fall through */ }
  throw new PasswordVaultError("The request body is not valid JSON.", 400);
}

/** Converts stored rows to client entries ({ id, ...data }). */
function present(state) {
  const items = (Array.isArray(state?.items) ? state.items : []).map((item) => (
    item.deleted ? { id: item.id, revision: item.revision, seq: item.seq, deleted: true }
      : { id: item.id, revision: item.revision, seq: item.seq, deleted: false, entry: { ...item.data, id: item.id } }
  ));
  return { items, cursor: Number(state?.cursor) || 0, pending: Number(state?.pending) || 0 };
}
function unlocked(token, result) {
  return { token, expiresAt: result.expiresAt, idleSeconds: VAULT_IDLE_SECONDS, ...present(result.state) };
}

/** HMAC of the OTP bound to member id + email (same scheme as 202610210001). */
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

const UNAVAILABLE = "Password Manager is temporarily unavailable. Please try again.";
const VAULT_LOCKED = "Your password vault is locked. Enter your master password to continue.";
const GRANT_INVALID = "This reset session is no longer valid. Request a new code.";

export async function handlePasswordVault(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4); // Pages serves the API under /api
  const path = url.pathname.slice(PASSWORD_VAULT_ROUTE_PREFIX.length) || "/";
  const rpc = services.rpc || defaultRpc(env);
  const now = services.now || (() => new Date());
  const method = request.method;
  const userId = identity.id;
  const sessionId = identity.session_id;
  const session = { idle: VAULT_IDLE_SECONDS, max: VAULT_MAX_SECONDS };
  /** Hash of the vault token from the header; a missing/garbled token is simply "locked". */
  const tokenHash = async () => {
    const token = request.headers.get(VAULT_TOKEN_HEADER) || "";
    if (!TOKEN_PATTERN.test(token)) throw new PasswordVaultError(VAULT_LOCKED, 403, { reason: "vault_locked" });
    return sha256Hex(token);
  };
  try {
    if (!isUuid(userId) || !isUuid(sessionId)) throw new PasswordVaultError("Sign in to open your password vault.", 401);

    if (path === "/" && method === "GET") {
      const status = firstRow(await rpcCall(rpc, "persora_vault_status", { p_user_id: userId }));
      return json({ hasVault: status.hasVault === true, records: Number(status.records) || 0, pending: Number(status.pending) || 0, recoveryAvailable: Boolean(identity.email) }, 200, origin);
    }
    if (path === "/setup" && method === "POST") {
      const body = await readJson(request);
      const password = masterPassword(body.masterPassword);
      const token = newToken();
      const result = await rpcCall(rpc, "persora_vault_create_master", {
        p_user_id: userId, p_session_id: sessionId, p_password: password, p_token_hash: await sha256Hex(token),
        p_now: now().toISOString(), p_idle_seconds: session.idle, p_max_seconds: session.max,
      });
      if (result?.outcome === "ok") return json(unlocked(token, result), 201, origin);
      if (result?.outcome === "exists") throw new PasswordVaultError("A master password was already set for your vault, possibly on another device. Unlock with it instead.", 409, { reason: "exists" });
      throw outcomeError(result?.outcome);
    }
    if (path === "/unlock" && method === "POST") {
      const body = await readJson(request);
      const password = typeof body.masterPassword === "string" ? body.masterPassword : "";
      if (!password) throw new PasswordVaultError("Enter your master password.", 400);
      const token = newToken();
      const result = await rpcCall(rpc, "persora_vault_unlock", {
        p_user_id: userId, p_session_id: sessionId, p_password: password, p_token_hash: await sha256Hex(token),
        p_now: now().toISOString(), p_idle_seconds: session.idle, p_max_seconds: session.max, p_max_failures: VAULT_MAX_UNLOCK_FAILURES,
      });
      switch (result?.outcome) {
        case "ok": return json(unlocked(token, result), 200, origin);
        case "wrong_password": throw new PasswordVaultError("That master password isn't right. Try again.", 401, { reason: "wrong_password" });
        case "blocked": {
          const minutes = Math.max(1, Math.ceil((Number(result.retryAfterSeconds) || 900) / 60));
          throw new PasswordVaultError(`Too many incorrect master passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset it with “Forgot master password?”.`, 429, { reason: "blocked", retryAfterSeconds: Number(result.retryAfterSeconds) || 900 });
        }
        case "not_set": throw new PasswordVaultError("Create your master password first.", 404, { reason: "not_set" });
        default: throw outcomeError(result?.outcome);
      }
    }
    if (path === "/lock" && method === "POST") {
      const token = request.headers.get(VAULT_TOKEN_HEADER) || "";
      if (TOKEN_PATTERN.test(token)) await rpcCall(rpc, "persora_vault_lock", { p_user_id: userId, p_token_hash: await sha256Hex(token) });
      return json({ ok: true }, 200, origin);
    }
    if (path === "/items" && method === "GET") {
      const raw = url.searchParams.get("since") || "0";
      if (!/^\d{1,15}$/.test(raw)) throw new PasswordVaultError("The sync cursor is invalid.", 400);
      const result = await rpcCall(rpc, "persora_vault_items", {
        p_user_id: userId, p_session_id: sessionId, p_token_hash: await tokenHash(), p_now: now().toISOString(), p_idle_seconds: session.idle, p_since: Number(raw),
      });
      if (result?.outcome === "locked") throw outcomeError("locked");
      if (result?.outcome !== "ok") throw new PasswordVaultError(UNAVAILABLE, 503);
      return json({ expiresAt: result.expiresAt, ...present(result) }, 200, origin);
    }
    if (path === "/items" && method === "POST") {
      const hash = await tokenHash();
      const body = await readJson(request);
      const changes = validateChanges(body.changes);
      const result = await rpcCall(rpc, "persora_vault_apply", {
        p_user_id: userId, p_session_id: sessionId, p_token_hash: hash, p_now: now().toISOString(), p_idle_seconds: session.idle, p_changes: changes,
      });
      if (result?.outcome === "ok") return json({ expiresAt: result.expiresAt, items: result.items || [] }, 200, origin);
      if (result?.outcome === "locked") throw outcomeError("locked");
      if (result?.outcome === "conflict") throw new PasswordVaultError("This password was changed on another device.", 409, { reason: "conflict", conflicts: result.conflicts || [] });
      throw new PasswordVaultError(UNAVAILABLE, 503);
    }

    // ── Forgot master password ──────────────────────────────────────────────
    if (path === "/recovery/send" && method === "POST") {
      if (!identity.email || identity.account_status !== "active") throw new PasswordVaultError("An active account email is required to reset the master password.", 403);
      if (typeof services.prepareRecoveryEmail !== "function") throw new PasswordVaultError("Master password reset email is temporarily unavailable.", 503);
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
        if (reservation.reason === "hourly_limit") throw new PasswordVaultError("Too many reset emails. Try again in an hour.", 429);
        if (reservation.reason === "email_changed") throw new PasswordVaultError("Your account email changed. Sign in again and retry.", 409);
        throw new PasswordVaultError("Master password reset email is temporarily unavailable.", 503);
      }
      try {
        await sendEmail({
          to: identity.email,
          subject: "Your Persora Password Manager reset code",
          textContent: `Your Password Manager reset code is ${code}. It expires in 10 minutes and can be used once. Use it to set a new master password for your Persora password vault; your saved passwords are kept. If you didn't request this, ignore this email; your master password is unchanged.`,
          htmlContent: `<div style="font-family:Arial,sans-serif;color:#182230;max-width:520px;margin:24px auto;padding:28px;border:1px solid #e5e7eb;border-radius:16px"><h2>Reset your Password Manager master password</h2><p>Your one-time code:</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1a73e8">${code}</p><p>It expires in 10 minutes and can be used once. Your saved passwords are kept. If you didn't request this, ignore this email — your master password is unchanged.</p></div>`,
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
      if (!/^\d{6}$/.test(code)) throw new PasswordVaultError("Enter the six-digit code from your email.", 400);
      const grant = newToken();
      const at = now();
      const result = await rpcCall(rpc, "persora_vault_reset_verify", {
        p_user_id: userId, p_email: String(identity.email || "").trim().toLowerCase(),
        p_candidate_hash: await vaultRecoveryCodeHash(identity, code, env), p_now: at.toISOString(), p_max_attempts: RECOVERY_MAX_ATTEMPTS,
        p_grant_hash: await sha256Hex(grant), p_grant_expires_at: new Date(at.getTime() + RECOVERY_GRANT_TTL_MS).toISOString(),
      });
      switch (result?.outcome) {
        case "success": return json({ ok: true, verified: true, grant, grantExpiresInSeconds: RECOVERY_GRANT_TTL_MS / 1000 }, 200, origin);
        case "expired": throw new PasswordVaultError("That code has expired. Request a new code.", 400);
        case "mismatch": throw new PasswordVaultError("That code doesn't match. Check your email and try again.", 400);
        case "too_many_attempts": throw new PasswordVaultError("Too many incorrect attempts. Request a new code.", 429);
        case "email_changed": throw new PasswordVaultError("Your account email changed. Request a new code.", 409);
        default: throw new PasswordVaultError("Request a new code before trying again.", 400);
      }
    }
    if (path === "/recovery/complete" && method === "POST") {
      const body = await readJson(request);
      const grant = typeof body.grant === "string" && TOKEN_PATTERN.test(body.grant) ? body.grant : null;
      if (!grant) throw new PasswordVaultError(GRANT_INVALID, 403);
      const password = masterPassword(body.masterPassword, "new master password");
      const token = newToken();
      const result = await rpcCall(rpc, "persora_vault_reset_complete", {
        p_user_id: userId, p_session_id: sessionId, p_grant_hash: await sha256Hex(grant), p_password: password,
        p_token_hash: await sha256Hex(token), p_now: now().toISOString(), p_idle_seconds: session.idle, p_max_seconds: session.max,
      });
      if (result?.outcome === "ok") return json(unlocked(token, result), 200, origin);
      if (result?.outcome === "invalid" || result?.outcome === "expired") throw new PasswordVaultError(GRANT_INVALID, 403, { reason: "grant_invalid" });
      throw outcomeError(result?.outcome);
    }

    throw new PasswordVaultError("Not found.", 404);
  } catch (error) {
    if (error instanceof PasswordVaultError) return json({ error: error.message, ...error.extra }, error.status, origin);
    if (error && typeof error.status === "number" && error.message) return json({ error: error.message }, error.status, origin); // e.g. email provider HttpError
    console.error("Persora password vault request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: UNAVAILABLE }, 503, origin);
  }
}
