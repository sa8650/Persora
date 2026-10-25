// Persora Connections — linking external services to a Persora account.
//
// Design (see CONNECTIONS.md):
//   * A small provider registry drives the Connections page. Only EMS is live
//     this release; the rest are listed as "coming soon" so new providers plug
//     into the same page, table and admin console without schema changes.
//   * EMS is connected WITHOUT redirects. The member types their EMS
//     administrator email + password into Persora; this worker forwards them
//     once, server-to-server, to EMS's signed /api/persora/authorize endpoint.
//     The password is never stored. EMS returns a revocable per-admin grant
//     token, which is encrypted (AES-GCM, key bound to the member) and kept in
//     public.user_connections. The browser never sees the grant or the secret.
//   * Every EMS call is signed with the shared integration secret configured in
//     both admin consoles (HMAC-SHA256 over timestamp, nonce, method, path,
//     body hash and grant hash). Either side disabling the integration — or a
//     secret mismatch — blocks access immediately.
//   * EMS enforces read-only access, tenant isolation and Vaultium eligibility.
//     Persora additionally validates every identifier and only proxies GETs.
//   * Temporary EMS failures never delete a connection. Only an explicit
//     Disconnect removes Persora's row; an invalid/expired grant flips the row
//     to "reauth_required" so the member sees "Reconnect EMS".

export const CONNECTIONS_ROUTE_PREFIX = "/connections";
export const ADMIN_INTEGRATIONS_PREFIX = "/admin/integrations";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 256;
const EMS_TIMEOUT_MS = 15_000;
const EMS_FILE_TIMEOUT_MS = 60_000;
const EMS_FOLDER_NAME = "EMS Vaultium";
/** Types a browser may render inline from our origin. Everything else downloads. */
const INLINE_SAFE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "application/pdf", "text/plain"]);

/**
 * Provider registry. `available: false` providers render as "Coming soon"
 * rows with no connect action; flipping one on only requires a handler + admin
 * config entry. Every provider needs its own official logo in
 * src/assets/connections (see PROVIDER_LOGOS in ConnectionParts.tsx).
 */
export const CONNECTION_PROVIDERS = Object.freeze([
  { id: "ems", name: "EMS", vendor: "Dexter Studio", category: "Business", available: true,
    description: "Browse your EMS shops' Vaultium files, download them, and save private copies to Persora.",
    capabilities: ["View Vaultium files", "Download", "Save copies to Persora"] },
  { id: "google-drive", name: "Google Drive", vendor: "Google", category: "Storage", available: false, description: "Bring files from your Drive into Persora.", capabilities: [] },
  { id: "google-photos", name: "Google Photos", vendor: "Google", category: "Photos", available: false, description: "Save selected photos to your private vault.", capabilities: [] },
  { id: "google-docs", name: "Google Docs", vendor: "Google", category: "Documents", available: false, description: "Keep copies of important documents in Persora.", capabilities: [] },
  { id: "google-calendar", name: "Google Calendar", vendor: "Google", category: "Calendar", available: false, description: "See your calendar alongside Persora reminders.", capabilities: [] },
  { id: "notion", name: "Notion", vendor: "Notion Labs", category: "Notes", available: false, description: "Link pages and notes from your workspace.", capabilities: [] },
  { id: "microsoft-onedrive", name: "Microsoft OneDrive", vendor: "Microsoft", category: "Storage", available: false, description: "Keep copies of your OneDrive files in Persora.", capabilities: [] },
  { id: "microsoft-outlook", name: "Microsoft Outlook", vendor: "Microsoft", category: "Calendar", available: false, description: "Bring Outlook calendar events next to your Persora reminders.", capabilities: [] },
]);
const ADMIN_PROVIDERS = new Set(["ems"]);

export class ConnectionError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ http */
function baseHeaders(origin, extra = {}) {
  return {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Content-Disposition,Content-Length,X-File-Name",
    Vary: "Origin",
    ...extra,
  };
}
function json(value, status, origin) {
  return new Response(JSON.stringify(value), { status, headers: baseHeaders(origin, { "Content-Type": "application/json; charset=utf-8" }) });
}
function errorResponse(error, origin) {
  const status = error instanceof ConnectionError || Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error("Persora connections request failed", status, error?.code || "", error instanceof Error ? error.message : "");
  const safe = error instanceof ConnectionError || (status < 500 && error instanceof Error);
  const body = { error: safe ? error.message : "The connection service couldn't complete that request." };
  if (error?.code) body.code = error.code;
  return json(body, status, origin);
}
async function readJson(request) {
  const text = await request.text();
  if (text.length > 8192) throw new ConnectionError("Request body is too large.", 413);
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { throw new ConnectionError("Send a valid JSON body.", 400); }
}

/* ------------------------------------------------------------------ database */
function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new ConnectionError("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.", 503);
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}
function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new ConnectionError("Set SUPABASE_URL in Cloudflare Pages settings.", 503);
  return `${base}/rest/v1/${path}`;
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42703") {
    return new ConnectionError("Connections need their database migration (202610310001_connections.sql). Ask an administrator to apply it.", 503, "migration_required");
  }
  console.error("Persora connections database request failed", response.status, code);
  return new ConnectionError("The connection service couldn't reach the database.", 502);
}
async function dbRows(path, env) {
  const response = await fetch(dbUrl(env, path), { headers: dbHeaders(env) });
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}
async function dbWrite(path, env, method, body, prefer = "return=representation") {
  const response = await fetch(dbUrl(env, path), {
    method,
    headers: dbHeaders(env, { "Content-Type": "application/json", Prefer: prefer }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await databaseError(response);
  if (prefer.includes("return=minimal") || response.status === 204) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [rows];
}

/* ------------------------------------------------------------------ crypto */
const enc = new TextEncoder();
const dec = new TextDecoder();
function toBase64(bytes) { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); }
function fromBase64(value) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
function base64Url(bytes) { return toBase64(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
export async function sha256Hex(value) {
  const data = typeof value === "string" ? enc.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Must stay byte-for-byte identical to EMS functions/_lib/persora_integration.js. */
export function canonicalRequest({ timestamp, nonce, method, pathWithQuery, bodyHash, grantHash }) {
  return ["ems-persora-v1", timestamp, nonce, String(method).toUpperCase(), pathWithQuery, bodyHash, grantHash].join("\n");
}
function masterSecret(env) {
  const dedicated = String(env.CONNECTIONS_ENCRYPTION_KEY || "");
  if (dedicated.length >= 32) return `dedicated:${dedicated}`;
  const timeline = String(env.TIMELINE_ENCRYPTION_KEY || "");
  if (timeline.length >= 32) return `timeline-derived:${timeline}`;
  return "";
}
async function aesKey(env, purpose) {
  const master = masterSecret(env);
  if (!master) throw new ConnectionError("Set CONNECTIONS_ENCRYPTION_KEY (32+ characters) in Cloudflare Pages settings to store connection secrets.", 503, "encryption_unavailable");
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`persora-connections-v1:${purpose}:${master}`));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealSecret(env, purpose, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env, purpose), enc.encode(plain));
  return `v1.${toBase64(iv)}.${toBase64(cipher)}`;
}
export async function openSecret(env, purpose, packed) {
  const [version, iv, cipher] = String(packed || "").split(".");
  if (version !== "v1" || !iv || !cipher) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await aesKey(env, purpose), fromBase64(cipher))); }
  catch (error) { if (error instanceof ConnectionError) throw error; return null; }
}
const integrationPurpose = (provider) => `integration:${provider}`;
const credentialPurpose = (userId, provider) => `user:${userId}:${provider}`;

/* ------------------------------------------------------------------ integration settings */
export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw new ConnectionError("Enter the EMS address as a full URL, e.g. https://ems.example.com.", 400); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ConnectionError("The EMS address must use HTTPS.", 400);
  if (url.username || url.password || url.search || url.hash) throw new ConnectionError("The EMS address cannot contain credentials, a query string or a fragment.", 400);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
async function readIntegrationRow(provider, env) {
  const rows = await dbRows(`integration_settings?provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`, env);
  return rows[0] || null;
}
/** Effective EMS integration config. Environment variables override the console. */
async function emsConfig(env) {
  const row = await readIntegrationRow("ems", env);
  const envSecret = String(env.EMS_INTEGRATION_SECRET || "");
  let secret = null; let secretSource = null; let secretReadable = true;
  if (envSecret) { secret = envSecret; secretSource = "environment"; }
  else if (row?.secret_ciphertext) {
    secretSource = "console";
    try { secret = await openSecret(env, integrationPurpose("ems"), row.secret_ciphertext); } catch { secret = null; }
    secretReadable = Boolean(secret);
  }
  let baseUrl = ""; let baseUrlSource = null;
  if (row?.base_url) { baseUrl = row.base_url; baseUrlSource = "console"; }
  else if (env.EMS_API_BASE_URL) { try { baseUrl = normalizeBaseUrl(env.EMS_API_BASE_URL); baseUrlSource = "environment"; } catch { baseUrl = ""; } }
  const usableSecret = secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
  return {
    row, enabled: row?.enabled === true, secret: usableSecret, secretSource, secretReadable,
    secretLast4: secretSource === "environment" ? envSecret.slice(-4) : (row?.secret_last4 || ""),
    baseUrl, baseUrlSource, ready: row?.enabled === true && Boolean(usableSecret) && Boolean(baseUrl),
  };
}

/* ------------------------------------------------------------------ EMS client */
/**
 * Calls EMS. Returns { ok, status, code, data, response }. Never throws for
 * HTTP-level failures; network errors and timeouts map to status 0.
 */
async function emsCall(cfg, method, subPath, { body, grant = "", raw = false, timeoutMs = EMS_TIMEOUT_MS } = {}) {
  const url = new URL(`${cfg.baseUrl}/api/persora/${subPath}`);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(18)));
  const signature = await hmacHex(cfg.secret, canonicalRequest({
    timestamp, nonce, method, pathWithQuery: url.pathname + url.search, bodyHash: await sha256Hex(payload), grantHash: await sha256Hex(grant),
  }));
  const headers = { "X-Persora-Timestamp": timestamp, "X-Persora-Nonce": nonce, "X-Persora-Signature": signature, Accept: raw ? "*/*" : "application/json" };
  if (payload) headers["Content-Type"] = "application/json";
  if (grant) headers["X-EMS-Grant"] = grant;
  let response;
  try {
    response = await fetch(url.toString(), { method, headers, body: payload || undefined, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, status: 0, code: "ems_unreachable", data: null };
  }
  if (response.ok && raw) return { ok: true, status: response.status, code: "", data: null, response };
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (response.status >= 300 && response.status < 400) return { ok: false, status: 502, code: "ems_redirected", data: null };
  return { ok: response.ok, status: response.status, code: typeof data?.code === "string" ? data.code : "", data };
}
const REAUTH_CODES = new Set(["grant_invalid", "account_inactive"]);
const PLATFORM_CODES = new Set(["integration_disabled", "signature_invalid", "request_expired"]);
/** Translate an EMS failure into a member-facing error, updating the connection row if needed. */
async function emsFailure(result, env, connection) {
  if (REAUTH_CODES.has(result.code)) {
    if (connection) await markConnection(connection, env, { status: "reauth_required", last_error: result.code === "account_inactive" ? "Your EMS administrator account is deactivated." : "EMS ended this connection. Sign in again to reconnect." });
    return new ConnectionError(result.code === "account_inactive" ? "Your EMS administrator account is deactivated. Reconnect EMS after it is reactivated." : "Your EMS connection has expired or was revoked. Reconnect EMS to continue.", 409, "reauth_required");
  }
  if (PLATFORM_CODES.has(result.code)) return new ConnectionError("The EMS integration is currently unavailable. Ask a Persora administrator to check the EMS integration settings.", 503, "integration_unavailable");
  if (result.code === "vaultium_not_eligible") return new ConnectionError("Vaultium isn't available for this EMS account. It needs to have purchased Vaultium at least once.", 403, "vaultium_not_eligible");
  if (result.status === 404) return new ConnectionError(result.data?.error || "That EMS item was not found.", 404, "not_found");
  if (result.status === 0) {
    if (connection) await markConnection(connection, env, { last_error: "EMS could not be reached." }, false);
    return new ConnectionError("EMS couldn't be reached right now. Your connection is kept — try again shortly.", 502, "ems_unreachable");
  }
  if (connection) await markConnection(connection, env, { last_error: `EMS returned ${result.status}.` }, false);
  return new ConnectionError("EMS is temporarily unavailable. Your connection is kept — try again shortly.", 502, "ems_unavailable");
}

/* ------------------------------------------------------------------ connections table */
async function loadConnection(userId, provider, env) {
  const rows = await dbRows(`user_connections?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`, env);
  return rows[0] || null;
}
async function markConnection(connection, env, patch, strict = true) {
  const now = new Date().toISOString();
  const body = { ...patch, updated_at: now, ...(patch.last_error ? { last_error_at: now } : {}) };
  try {
    await dbWrite(`user_connections?id=eq.${encodeURIComponent(connection.id)}&user_id=eq.${encodeURIComponent(connection.user_id)}`, env, "PATCH", body, "return=minimal");
    Object.assign(connection, body);
  } catch (error) { if (strict) throw error; }
}
function publicConnection(row) {
  if (!row) return null;
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    provider: row.provider, status: row.status,
    account: { id: row.account_ref || null, name: row.account_label || "", email: row.account_email || "", code: meta.admin_code || null },
    connectedAt: row.connected_at, lastSyncedAt: row.last_synced_at || null,
    lastError: row.status === "reauth_required" ? (row.last_error || null) : null,
  };
}
async function grantFor(connection, env) {
  const grant = await openSecret(env, credentialPurpose(connection.user_id, connection.provider), connection.credential_ciphertext);
  if (!grant) {
    await markConnection(connection, env, { status: "reauth_required", last_error: "Stored EMS authorization could not be read. Reconnect EMS." });
    throw new ConnectionError("Your EMS connection needs to be renewed. Reconnect EMS to continue.", 409, "reauth_required");
  }
  return grant;
}
async function activeEmsContext(identity, env) {
  const connection = await loadConnection(identity.id, "ems", env);
  if (!connection) throw new ConnectionError("Connect EMS first.", 404, "not_connected");
  if (connection.status === "reauth_required") throw new ConnectionError("Your EMS connection has expired or was revoked. Reconnect EMS to continue.", 409, "reauth_required");
  const cfg = await emsConfig(env);
  if (!cfg.ready) throw new ConnectionError("The EMS integration is currently turned off by the Persora administrator.", 503, "integration_unavailable");
  return { connection, cfg, grant: await grantFor(connection, env) };
}

/* ------------------------------------------------------------------ helpers */
function safeFileName(name) {
  return String(name || "file").normalize("NFKC").replace(/[^\w.()-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}
function safeType(type) {
  const value = String(type || "").split(";")[0].trim().toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value.slice(0, 120) : "application/octet-stream";
}
function decodeHeader(value) { try { return decodeURIComponent(String(value || "")); } catch { return String(value || ""); } }
function intParam(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function shopFromMeta(connection, storeId) {
  const stores = Array.isArray(connection?.metadata?.stores) ? connection.metadata.stores : [];
  return stores.find((s) => s && s.id === storeId) || null;
}
async function rateLimited(services, fingerprint) {
  if (!services?.rateLimit) return false;
  const until = await services.rateLimit.blocked(fingerprint);
  return Boolean(until && Date.parse(until) > Date.now());
}

/* ------------------------------------------------------------------ member routes */
/**
 * Routes under /connections. `services` is injected by api.js so this module
 * reuses Persora's existing upload rules, vault item writer and rate limiter:
 *   rateLimit: { blocked(fp), record(fp, success, limit) }
 *   hasUploadPlan(userId, env), uploadPlanError(), maxUploadMb(),
 *   storageUsage(userId, bucket, env), saveVaultItem(identity, body, env),
 *   saveVaultFolder(identity, body, env)
 */
export async function handleConnections(request, identity, env, origin, services = {}) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, "");
    const method = request.method;

    if (path === CONNECTIONS_ROUTE_PREFIX && method === "GET") {
      const [rows, cfg] = await Promise.all([
        dbRows(`user_connections?user_id=eq.${encodeURIComponent(identity.id)}&select=*`, env),
        emsConfig(env).catch((error) => { if (error?.code === "migration_required") throw error; return { ready: false }; }),
      ]);
      const byProvider = new Map(rows.map((row) => [row.provider, row]));
      return json({
        providers: CONNECTION_PROVIDERS.map((provider) => {
          const row = byProvider.get(provider.id);
          const ready = provider.id === "ems" ? cfg.ready : false;
          return { ...provider, enabled: provider.available && ready, connection: publicConnection(row), status: row ? row.status : provider.available ? (ready ? "not_connected" : "unavailable") : "coming_soon" };
        }),
      }, 200, origin);
    }

    if (path === `${CONNECTIONS_ROUTE_PREFIX}/ems/connect` && method === "POST") {
      const body = await readJson(request);
      const email = String(body.email || "").trim().toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 512) {
        throw new ConnectionError("Enter your EMS administrator email and password.", 400, "invalid_input");
      }
      const cfg = await emsConfig(env);
      if (!cfg.ready) throw new ConnectionError("The EMS integration is currently turned off by the Persora administrator.", 503, "integration_unavailable");
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const fp = await sha256Hex(`ems-connect|${identity.id}`);
      const ipFp = await sha256Hex(`ems-connect-ip|${ip}`);
      if ((await rateLimited(services, fp)) || (await rateLimited(services, ipFp))) throw new ConnectionError("Too many EMS sign-in attempts. Try again in 15 minutes.", 429, "rate_limited");
      const result = await emsCall(cfg, "POST", "authorize", { body: { email, password, persora_user_ref: identity.id, label: `Persora · ${identity.login_id || identity.email || identity.id}`.slice(0, 80) } });
      if (!result.ok || !result.data?.grant) {
        if (result.code === "invalid_credentials" || result.code === "account_inactive") {
          if (services.rateLimit) await Promise.all([services.rateLimit.record(fp, false, 8), services.rateLimit.record(ipFp, false, 30)]);
          // 400, not 401: a wrong EMS password must never look like an expired Persora session.
          throw new ConnectionError(result.code === "account_inactive" ? "This EMS administrator account is deactivated." : "Wrong EMS email or password.", result.code === "account_inactive" ? 403 : 400, result.code);
        }
        throw await emsFailure(result, env, null);
      }
      if (services.rateLimit) await services.rateLimit.record(fp, true, 8).catch(() => {});
      const now = new Date().toISOString();
      const admin = result.data.admin || {};
      const existing = await loadConnection(identity.id, "ems", env);
      const record = {
        user_id: identity.id, provider: "ems", status: "connected",
        account_ref: String(admin.id || "").slice(0, 120) || null, account_label: String(admin.name || "").slice(0, 160) || null, account_email: String(admin.email || email).slice(0, 254),
        credential_ciphertext: await sealSecret(env, credentialPurpose(identity.id, "ems"), result.data.grant),
        metadata: { admin_code: admin.admin_code || null, eligibility: result.data.eligibility || null, grant_id: result.data.grant_id || null, grant_expires_at: result.data.expires_at || null },
        last_synced_at: now, last_error: null, last_error_at: null, connected_at: existing && existing.status !== "revoked" && existing.account_ref === admin.id ? existing.connected_at : now, updated_at: now,
      };
      const [row] = await dbWrite("user_connections?on_conflict=user_id,provider", env, "POST", record, "resolution=merge-duplicates,return=representation");
      return json({ connection: publicConnection(row || record) }, 201, origin);
    }

    if (path === `${CONNECTIONS_ROUTE_PREFIX}/ems` && method === "GET") {
      const connection = await loadConnection(identity.id, "ems", env);
      const cfg = await emsConfig(env).catch(() => ({ ready: false }));
      if (!connection) return json({ status: "not_connected", integrationReady: cfg.ready, connection: null }, 200, origin);
      const cachedStores = Array.isArray(connection.metadata?.stores) ? connection.metadata.stores : [];
      const cached = { admin: publicConnection(connection).account, stores: cachedStores, eligibility: connection.metadata?.eligibility || null, totalFiles: connection.metadata?.total_files ?? null };
      if (connection.status === "reauth_required") return json({ status: "reauth_required", integrationReady: cfg.ready, connection: publicConnection(connection), account: cached }, 200, origin);
      if (!cfg.ready) return json({ status: connection.status, integrationReady: false, degraded: true, notice: "The EMS integration is currently turned off by the Persora administrator.", connection: publicConnection(connection), account: cached }, 200, origin);
      let grant;
      try { grant = await grantFor(connection, env); }
      catch (error) { if (error?.code === "reauth_required") return json({ status: "reauth_required", integrationReady: true, connection: publicConnection(connection), account: cached }, 200, origin); throw error; }
      const result = await emsCall(cfg, "GET", "account", { grant });
      if (!result.ok) {
        const failure = await emsFailure(result, env, connection);
        if (failure.code === "reauth_required") return json({ status: "reauth_required", integrationReady: true, connection: publicConnection(connection), account: cached }, 200, origin);
        return json({ status: connection.status, integrationReady: true, degraded: true, notice: failure.message, code: failure.code, connection: publicConnection(connection), account: cached }, 200, origin);
      }
      const data = result.data || {};
      const stores = (Array.isArray(data.stores) ? data.stores : []).slice(0, 200).map((s) => ({
        id: String(s.id || ""), name: String(s.name || "Shop").slice(0, 160), code: s.shop_code ? String(s.shop_code).slice(0, 40) : null,
        status: String(s.status || ""), type: s.shop_type ? String(s.shop_type).slice(0, 40) : null, fileCount: Number.isFinite(Number(s.file_count)) ? Number(s.file_count) : null,
      })).filter((s) => UUID_RE.test(s.id));
      const admin = data.admin || {};
      const now = new Date().toISOString();
      await markConnection(connection, env, {
        status: "connected", account_label: String(admin.name || connection.account_label || "").slice(0, 160) || null, account_email: String(admin.email || connection.account_email || "").slice(0, 254) || null,
        metadata: { ...connection.metadata, admin_code: admin.admin_code || connection.metadata?.admin_code || null, eligibility: data.eligibility || null, stores, total_files: Number(data.total_files) || 0 },
        last_synced_at: now, last_error: null, last_error_at: null,
      }, false);
      return json({
        status: "connected", integrationReady: true, degraded: false, connection: publicConnection(connection),
        account: { admin: publicConnection(connection).account, stores, eligibility: data.eligibility || null, totalFiles: Number(data.total_files) || 0 },
      }, 200, origin);
    }

    if (path === `${CONNECTIONS_ROUTE_PREFIX}/ems/files` && method === "GET") {
      const storeId = url.searchParams.get("storeId") || "";
      if (storeId && !UUID_RE.test(storeId)) throw new ConnectionError("Choose a valid shop.", 400, "invalid_input");
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
      const limit = intParam(url.searchParams.get("limit"), 50, 1, 100);
      const offset = intParam(url.searchParams.get("offset"), 0, 0, 2000);
      const { connection, cfg, grant } = await activeEmsContext(identity, env);
      const query = new URLSearchParams();
      if (storeId) query.set("store_id", storeId);
      if (q) query.set("q", q);
      query.set("limit", String(limit));
      query.set("offset", String(offset));
      const result = await emsCall(cfg, "GET", `files?${query.toString()}`, { grant });
      if (!result.ok) throw await emsFailure(result, env, connection);
      const files = (Array.isArray(result.data?.files) ? result.data.files : []).map((f) => ({
        id: String(f.id || ""), storeId: String(f.store_id || ""), name: String(f.filename || "file").slice(0, 240), type: safeType(f.content_type),
        size: Math.max(0, Number(f.size_bytes) || 0), createdAt: f.created_at || null, reference: f.invoice_number || f.expense_code || null,
        category: ["invoice", "expense"].includes(f.category) ? f.category : "file",
      })).filter((f) => UUID_RE.test(f.id));
      return json({ files, total: Number(result.data?.total) || files.length, offset, limit, hasMore: Boolean(result.data?.has_more) }, 200, origin);
    }

    const fileMatch = path.match(/^\/connections\/ems\/files\/([^/]+)(\/save)?$/);
    if (fileMatch) {
      const fileId = fileMatch[1];
      if (!UUID_RE.test(fileId)) throw new ConnectionError("That EMS file was not found.", 404, "not_found");
      const saving = Boolean(fileMatch[2]);
      if (!saving && method !== "GET") throw new ConnectionError("EMS files are read-only in Persora.", 405, "read_only");
      if (saving && method !== "POST") throw new ConnectionError("Method not allowed.", 405);
      if (saving) {
        // Same rules as every other upload into Persora storage.
        if (services.hasUploadPlan && !(await services.hasUploadPlan(identity.id, env))) throw services.uploadPlanError ? services.uploadPlanError() : new ConnectionError("Saving files requires an active paid plan.", 403, "upload_plan_required");
      }
      const { connection, cfg, grant } = await activeEmsContext(identity, env);
      const result = await emsCall(cfg, "GET", `files/${fileId}/content`, { grant, raw: true, timeoutMs: EMS_FILE_TIMEOUT_MS });
      if (!result.ok) throw await emsFailure(result, env, connection);
      const upstream = result.response;
      const name = decodeHeader(upstream.headers.get("x-ems-file-name")) || "file";
      const type = safeType(upstream.headers.get("content-type"));
      const declaredSize = Number(upstream.headers.get("x-ems-file-size")) || 0;

      if (!saving) {
        const wantsInline = url.searchParams.get("disposition") === "inline";
        const inline = wantsInline && INLINE_SAFE_TYPES.has(type);
        const headers = baseHeaders(origin, {
          "Content-Type": inline ? type : (type === "text/html" || type === "image/svg+xml" || type.includes("xml") || type.includes("javascript") ? "application/octet-stream" : type),
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'",
          "Cache-Control": "private, no-store",
          "X-File-Name": encodeURIComponent(name),
        });
        if (declaredSize) headers["Content-Length"] = String(declaredSize);
        return new Response(upstream.body, { status: 200, headers });
      }

      // ---- Save an independent copy into the member's Persora storage. ----
      if (!env.VAULT_FILES) throw new ConnectionError("Private file storage is not configured.", 503);
      const maxMb = services.maxUploadMb ? await services.maxUploadMb() : 25;
      const maxBytes = Math.max(1, maxMb) * 1024 * 1024;
      if (declaredSize > maxBytes) { await upstream.body?.cancel().catch(() => {}); throw new ConnectionError(`Files must be ${maxMb} MB or smaller to save into Persora.`, 413, "too_large"); }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new ConnectionError(`Files must be between 1 byte and ${maxMb} MB to save into Persora.`, 413, "too_large");
      if (services.storageUsage) {
        const usage = await services.storageUsage(identity.id, env.VAULT_FILES, env);
        if (usage.bytesUsed + bytes.byteLength > usage.storageLimitBytes) throw new ConnectionError(`This copy exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit. Choose a larger plan or remove files first.`, 413, "quota_exceeded");
      }
      const storeId = upstream.headers.get("x-ems-store-id") || "";
      const reference = decodeHeader(upstream.headers.get("x-ems-reference")).slice(0, 80);
      const shop = shopFromMeta(connection, storeId);
      const fileName = safeFileName(name);
      const key = `${identity.id}/${crypto.randomUUID()}-${fileName}`;
      const nowIso = new Date().toISOString();
      await env.VAULT_FILES.put(key, bytes, {
        httpMetadata: { contentType: type },
        customMetadata: { ownerId: identity.id, originalName: fileName, createdAt: nowIso, source: "ems-vaultium", sourceFileId: fileId },
      });
      try {
        const folderId = await ensureEmsFolder(identity, env, services);
        const title = name.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim().slice(0, 240) || "EMS file";
        const item = await services.saveVaultItem(identity, {
          id: crypto.randomUUID(), section: "documents", title,
          subtitle: `EMS Vaultium${shop?.name ? ` · ${shop.name}` : ""}`.slice(0, 240),
          metadata: {
            type: "Other", documentNumber: reference, issueDate: "", expiryDate: "",
            notes: `Copied from EMS Vaultium${shop?.name ? ` (${shop.name})` : ""} on ${nowIso.slice(0, 10)}. This is an independent copy — the EMS original is unchanged.`.slice(0, 5000),
            source: "EMS Vaultium", sourceShop: String(shop?.name || "").slice(0, 160),
          },
          folderId, file: { key, name: name.slice(0, 240), size: bytes.byteLength, type },
        }, env);
        return json({ ok: true, item: { id: item?.id, title: item?.title || title, section: "documents", folderId, folderName: EMS_FOLDER_NAME } }, 201, origin);
      } catch (error) {
        await env.VAULT_FILES.delete(key).catch(() => {});
        throw error;
      }
    }

    if (path === `${CONNECTIONS_ROUTE_PREFIX}/ems` && method === "DELETE") {
      const connection = await loadConnection(identity.id, "ems", env);
      if (!connection) return json({ ok: true, remoteRevoked: false }, 200, origin);
      let remoteRevoked = false;
      try {
        const cfg = await emsConfig(env);
        const grant = await openSecret(env, credentialPurpose(identity.id, "ems"), connection.credential_ciphertext).catch(() => null);
        if (cfg.ready && grant) {
          const result = await emsCall(cfg, "POST", "revoke", { grant, body: {}, timeoutMs: 5000 });
          remoteRevoked = result.ok;
        }
      } catch { /* best effort: the local row is removed regardless */ }
      await dbWrite(`user_connections?id=eq.${encodeURIComponent(connection.id)}&user_id=eq.${encodeURIComponent(identity.id)}`, env, "DELETE", undefined, "return=minimal");
      return json({ ok: true, remoteRevoked }, 200, origin);
    }

    if (path.startsWith(`${CONNECTIONS_ROUTE_PREFIX}/`) && !path.startsWith(`${CONNECTIONS_ROUTE_PREFIX}/ems`)) {
      throw new ConnectionError("That service isn't available to connect yet.", 404, "provider_unavailable");
    }
    return json({ error: "Not found." }, 404, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}

async function ensureEmsFolder(identity, env, services) {
  const find = async () => {
    const rows = await dbRows(`vault_folders?user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.documents&name=ilike.${encodeURIComponent(EMS_FOLDER_NAME)}&select=id&limit=1`, env);
    return rows[0]?.id || null;
  };
  const existing = await find();
  if (existing) return existing;
  if (!services.saveVaultFolder) return null;
  try {
    const row = await services.saveVaultFolder(identity, { scope: "documents", name: EMS_FOLDER_NAME, color: "teal", pinned: false }, env);
    return row?.id || null;
  } catch (error) {
    if (error?.status === 409) return find(); // created concurrently
    throw error;
  }
}

/* ------------------------------------------------------------------ admin routes */
async function adminStatus(provider, env) {
  if (provider !== "ems") throw new ConnectionError("Unknown integration.", 404);
  const cfg = await emsConfig(env);
  let connections = { connected: 0, reauthRequired: 0 };
  try {
    const rows = await dbRows("user_connections?provider=eq.ems&select=status&limit=10000", env);
    connections = { connected: rows.filter((r) => r.status === "connected").length, reauthRequired: rows.filter((r) => r.status === "reauth_required").length };
  } catch { /* table may not exist yet */ }
  return {
    provider: "ems", name: "EMS", enabled: cfg.enabled, ready: cfg.ready,
    baseUrl: cfg.baseUrl || "", baseUrlSource: cfg.baseUrlSource,
    secretConfigured: Boolean(cfg.secret), secretReadable: cfg.secretReadable, secretSource: cfg.secretSource,
    secretHint: cfg.secret && cfg.secretLast4 ? `••••${cfg.secretLast4}` : null,
    encryptionConfigured: Boolean(masterSecret(env)),
    updatedAt: cfg.row?.updated_at || null,
    lastCheck: cfg.row?.last_check_at ? { at: cfg.row.last_check_at, ok: cfg.row.last_check_ok === true, message: cfg.row.last_check_message || "" } : null,
    connections, minSecretLength: MIN_SECRET_LENGTH,
  };
}

/**
 * /admin/integrations (GET list), /admin/integrations/ems (GET/POST),
 * /admin/integrations/ems/test (POST). Caller must already be an authorised
 * Persora administrator; `services.logAdminEvent(actor, target, type, env, details)`.
 */
export async function handleIntegrationAdmin(request, identity, env, origin, services = {}) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, "");
    if (path === ADMIN_INTEGRATIONS_PREFIX && request.method === "GET") {
      return json({ integrations: [await adminStatus("ems", env)] }, 200, origin);
    }
    const match = path.match(/^\/admin\/integrations\/([a-z-]+)(\/test)?$/);
    if (!match || !ADMIN_PROVIDERS.has(match[1])) throw new ConnectionError("Unknown integration.", 404);
    const provider = match[1];
    if (!match[2] && request.method === "GET") return json(await adminStatus(provider, env), 200, origin);
    if (!match[2] && request.method === "POST") {
      const body = await readJson(request);
      const current = await readIntegrationRow(provider, env);
      const record = { provider, updated_by: identity.id, updated_at: new Date().toISOString() };
      const changes = {};
      if (body.enabled !== undefined) { if (typeof body.enabled !== "boolean") throw new ConnectionError("Choose whether the integration is enabled.", 400); record.enabled = body.enabled; changes.enabled = body.enabled; }
      else record.enabled = current?.enabled === true;
      if (body.baseUrl !== undefined) { record.base_url = normalizeBaseUrl(body.baseUrl) || null; changes.baseUrl = record.base_url; }
      if (typeof body.secret === "string" && body.secret.length) {
        if (env.EMS_INTEGRATION_SECRET) throw new ConnectionError("The shared secret is managed by the EMS_INTEGRATION_SECRET environment variable.", 409);
        const secret = body.secret;
        if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH || !/^[\x21-\x7e]+$/.test(secret)) throw new ConnectionError(`The shared secret must be ${MIN_SECRET_LENGTH}–${MAX_SECRET_LENGTH} printable characters without spaces.`, 400);
        record.secret_ciphertext = await sealSecret(env, integrationPurpose(provider), secret);
        record.secret_last4 = secret.slice(-4);
        record.last_check_at = null; record.last_check_ok = null; record.last_check_message = null;
        changes.secretReplaced = true;
      }
      if (body.clearSecret === true) { record.secret_ciphertext = null; record.secret_last4 = null; changes.secretCleared = true; }
      const willHaveSecret = Boolean(env.EMS_INTEGRATION_SECRET) || (record.secret_ciphertext !== undefined ? Boolean(record.secret_ciphertext) : Boolean(current?.secret_ciphertext));
      const willHaveUrl = record.base_url !== undefined ? Boolean(record.base_url) : Boolean(current?.base_url || env.EMS_API_BASE_URL);
      if (record.enabled && (!willHaveSecret || !willHaveUrl)) throw new ConnectionError("Set the EMS address and shared secret before enabling the integration.", 400);
      await dbWrite("integration_settings?on_conflict=provider", env, "POST", record, "resolution=merge-duplicates,return=minimal");
      if (services.logAdminEvent) await services.logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "update_integration", env, { provider, ...changes, ...(changes.secretReplaced ? { secretReplaced: true } : {}) });
      return json(await adminStatus(provider, env), 200, origin);
    }
    if (match[2] && request.method === "POST") {
      const cfg = await emsConfig(env);
      let ok = false; let message;
      if (!cfg.baseUrl || !cfg.secret) message = "Set the EMS address and shared secret first.";
      else {
        const result = await emsCall(cfg, "POST", "ping", { body: {}, timeoutMs: 10_000 });
        ok = result.ok && result.data?.ok === true;
        message = ok ? "EMS accepted Persora's signed request." :
          result.code === "integration_disabled" ? "EMS reachable, but the Persora integration is disabled in the EMS Owner Console." :
          result.code === "signature_invalid" ? "EMS rejected the signature — the shared secrets do not match." :
          result.code === "request_expired" ? "EMS rejected the request time — check server clocks." :
          result.status === 0 ? "EMS could not be reached at that address." :
          result.status === 404 ? "That address does not expose the EMS Persora API. Check the EMS address." :
          `EMS returned HTTP ${result.status}.`;
      }
      await dbWrite("integration_settings?on_conflict=provider", env, "POST", { provider, enabled: cfg.row?.enabled === true, last_check_at: new Date().toISOString(), last_check_ok: ok, last_check_message: message.slice(0, 240) }, "resolution=merge-duplicates,return=minimal").catch(() => {});
      if (services.logAdminEvent) await services.logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "test_integration", env, { provider, ok });
      return json({ ok, message, status: await adminStatus(provider, env) }, 200, origin);
    }
    throw new ConnectionError("Method not allowed.", 405);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
