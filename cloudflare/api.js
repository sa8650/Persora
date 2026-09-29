const DEFAULT_SETTINGS = {
  billing: { currency: "BDT", manualInstructions: "Follow the account details shown for your selected payment method.", billingEnabled: false },
  storage: { defaultFreeGb: 5, maxUploadMb: 25 },
  paymentMethods: [],
  siteContent: {},
};
const MAX_CONFIGURABLE_UPLOAD_MB = 150;
class HttpError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    // Pages Functions serve the API on the same origin. Derive that origin automatically
    // so a separate APP_ORIGIN setting is not needed for the Pages deployment.
    const pagesOrigin = url.pathname === "/api" || url.pathname.startsWith("/api/") ? url.origin : "*";
    const allowedOrigins = (env.APP_ORIGIN || pagesOrigin).split(",").map((value) => value.trim()).filter(Boolean);
    const origin = allowedOrigins.includes("*")
      ? "*"
      : requestOrigin && allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : allowedOrigins[0] || "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "persora-pages-api" }, 200, origin);
      }
      if (url.pathname === "/auth/register" && request.method === "POST") {
        const body = await readBody(request);
        const result = await registerAccount(body, request, env);
        return jsonWithCookie({ user: publicUser(result.profile) }, 201, origin, sessionCookie(result.token, request));
      }
      if (url.pathname === "/auth/login" && request.method === "POST") {
        const body = await readBody(request);
        const result = await loginAccount(body, request, env);
        return jsonWithCookie({ user: publicUser(result.profile) }, 200, origin, sessionCookie(result.token, request));
      }
      if (url.pathname === "/auth/me" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Your session expired. Sign in again." }, 401, origin);
        return json({ user: publicUser(identity) }, 200, origin);
      }
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        await logoutSession(request, env);
        return jsonWithCookie({ ok: true }, 200, origin, sessionCookie("", request, 0));
      }
      if (url.pathname === "/auth/password" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Your session expired. Sign in again." }, 401, origin);
        const body = await readBody(request);
        return json(await changePassword(identity, body, env), 200, origin);
      }
      if (url.pathname === "/admin/bootstrap/status" && request.method === "GET") {
        return json(await bootstrapStatus(env), 200, origin);
      }
      if (url.pathname === "/plans" && request.method === "GET") {
        const [plans, settings] = await Promise.all([listPlans(env, true), loadSettings(env)]);
        const hasActivePaymentMethod = settings.paymentMethods.some((method) => method && method.active === true);
        const publicBilling = { ...settings.billing, billingEnabled: Boolean(settings.billing.billingEnabled && hasActivePaymentMethod) };
        return json({ plans: plans.map((plan) => publicPlan(plan, settings.billing.currency)), billingSettings: publicBilling, maxUploadMb: settings.storage.maxUploadMb }, 200, origin);
      }
      if (url.pathname === "/site-content" && request.method === "GET") {
        const settings = await loadSettings(env);
        return json(settings.siteContent, 200, origin);
      }
      if (url.pathname === "/document-types" && request.method === "GET") {
        const types = await restRows("document_types?select=id,name,active,sort_order&active=eq.true&order=sort_order.asc,name.asc", env);
        return json(types, 200, origin);
      }
      if (url.pathname === "/vault/items" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const rows = await restRows(`vault_items?user_id=eq.${encodeURIComponent(identity.id)}&select=*&order=updated_at.desc`, env);
        return json(rows, 200, origin);
      }
      if (url.pathname === "/vault/items" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        const row = await saveOwnedVaultItem(identity, body, env);
        return json(row, 200, origin);
      }
      if (url.pathname === "/vault/items" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id)) return json({ error: "Choose a valid vault item." }, 400, origin);
        const result = await supabaseAdminFetch(`/rest/v1/vault_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        if (!result.ok) return upstreamError(result, origin);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/profile" && request.method === "PATCH") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
        const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
        if (fullName.length < 1 || fullName.length > 100) return json({ error: "Enter a name between 1 and 100 characters." }, 400, origin);
        if (!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone) || timezone.length > 80) return json({ error: "Choose a valid timezone." }, 400, origin);
        const result = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(identity.id)}`, env, {
          method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ full_name: fullName, timezone }),
        });
        if (!result.ok) return upstreamError(result, origin);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/admin/bootstrap" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in with the account that should own Persora first." }, 401, origin);
        if (!env.ADMIN_BOOTSTRAP_SECRET) return json({ error: "First-admin setup is not enabled in Cloudflare Pages settings." }, 503, origin);
        const body = await readBody(request);
        const candidate = typeof body.secret === "string" ? body.secret : "";
        if (candidate.length < 32 || candidate.length > 256 || !constantTimeEqual(candidate, env.ADMIN_BOOTSTRAP_SECRET)) {
          return json({ error: "That first-admin setup code is not valid." }, 403, origin);
        }
        const response = await supabaseAdminFetch("/rest/v1/rpc/persora_claim_first_admin", env, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_user_id: identity.id }),
        });
        if (!response.ok) return upstreamError(response, origin);
        const claimed = await response.json();
        if (claimed !== true) return json({ error: "First-admin setup has already been claimed or this account is inactive." }, 409, origin);
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "bootstrap_first_admin", env);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/billing" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await loadBilling(identity, env), 200, origin);
      }
      if (url.pathname === "/storage/usage" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await userStorageUsage(identity.id, env.VAULT_FILES, env), 200, origin);
      }
      if (url.pathname === "/payments" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        const payment = await createPaymentRequest(identity, body, env);
        return json(payment, 201, origin);
      }

      if (url.pathname === "/upload" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to upload a private file." }, 401, origin);
        const settings = await loadSettings(env);
        const maxFileBytes = Math.max(1, Math.min(MAX_CONFIGURABLE_UPLOAD_MB, Number(settings.storage.maxUploadMb) || 25)) * 1024 * 1024;
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > maxFileBytes + 1024 * 1024) return json({ error: `Files must be ${Math.floor(maxFileBytes / 1024 / 1024)} MB or smaller.` }, 413, origin);
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "Choose a file to upload." }, 400, origin);
        if (!file.size || file.size > maxFileBytes) return json({ error: `Files must be between 1 byte and ${Math.floor(maxFileBytes / 1024 / 1024)} MB.` }, 413, origin);
        const usage = await userStorageUsage(identity.id, env.VAULT_FILES, env);
        if (usage.bytesUsed + file.size > usage.storageLimitBytes) {
          return json({ error: `This upload exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit. Choose a larger plan or remove files first.` }, 413, origin);
        }
        const safeName = sanitizeFileName(file.name);
        const key = `${identity.id}/${crypto.randomUUID()}-${safeName}`;
        await env.VAULT_FILES.put(key, file.stream(), {
          httpMetadata: { contentType: safeContentType(file.type) },
          customMetadata: { ownerId: identity.id, originalName: safeName, createdAt: new Date().toISOString() },
        });
        return json({ key, name: file.name, size: file.size, type: safeContentType(file.type) }, 201, origin);
      }
      if (url.pathname === "/file" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to open a private file." }, 401, origin);
        const key = url.searchParams.get("key") || "";
        if (!ownsKey(identity.id, key)) return json({ error: "That file isn't available in your vault." }, 404, origin);
        const object = await env.VAULT_FILES.get(key);
        if (!object || object.customMetadata?.ownerId !== identity.id) return json({ error: "That file isn't available in your vault." }, 404, origin);
        const name = object.customMetadata?.originalName || key.split("/").pop() || "persora-file";
        const headers = new Headers({
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
          "X-File-Name": encodeURIComponent(name),
          "Content-Length": String(object.size),
          ...corsHeaders(origin),
        });
        return new Response(object.body, { headers });
      }
      if (url.pathname === "/file" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to remove a private file." }, 401, origin);
        const key = url.searchParams.get("key") || "";
        if (!ownsKey(identity.id, key)) return json({ error: "That file isn't available in your vault." }, 404, origin);
        const object = await env.VAULT_FILES.get(key);
        if (!object || object.customMetadata?.ownerId !== identity.id) return json({ error: "That file isn't available in your vault." }, 404, origin);
        await env.VAULT_FILES.delete(key);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/admin/console" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        return json(await loadAdminConsole(env), 200, origin);
      }
      if (url.pathname === "/admin/settings" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        const saved = await savePlatformSetting(body.key, body.value, identity.id, env);
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "update_platform_settings", env, { setting_key: body.key });
        return json(saved, 200, origin);
      }
      if (url.pathname === "/admin/plans" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        const saved = await savePlan(body, env);
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "save_subscription_plan", env, { plan_id: saved.id, plan_name: saved.name });
        return json(saved, 200, origin);
      }
      if (url.pathname === "/admin/document-types" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        const saved = await saveDocumentType(body, env);
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "save_document_type", env, { document_type_id: saved.id });
        return json(saved, 200, origin);
      }
      if (url.pathname === "/admin/payments" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        const result = await reviewPayment(body, identity, env);
        return json(result, 200, origin);
      }
      if (url.pathname === "/admin/users" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        const targetId = typeof body.userId === "string" ? body.userId : "";
        const action = body.action;
        if (!isUuid(targetId)) return json({ error: "Choose a valid account." }, 400, origin);
        if (targetId === identity.id) return json({ error: "You can't change your own administrator account here." }, 400, origin);
        if (!["suspend", "restore", "delete", "promote", "demote"].includes(action)) return json({ error: "Choose a supported account action." }, 400, origin);
        const target = await getProfile(targetId, env);
        if (!target) return json({ error: "That account could not be found." }, 404, origin);
        if (action === "demote" && target.role === "admin") {
          const admins = await countRows("profiles?role=eq.admin&account_status=eq.active", "id", env);
          if (admins <= 1) return json({ error: "Promote another administrator before demoting the last active admin." }, 409, origin);
        } else if (target.role === "admin" && ["suspend", "delete", "promote"].includes(action)) {
          return json({ error: "Active administrator accounts cannot be suspended or deleted from this screen. Demote another admin first." }, 403, origin);
        }
        if (action === "delete") {
          const deleted = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
          if (!deleted.ok) return upstreamError(deleted, origin);
          try { await deleteOwnedFiles(targetId, env.VAULT_FILES); } catch (error) { console.error("Persora R2 cleanup pending after account deletion", safeError(error)); }
          await logAdminEvent(identity, target, "delete_user", env);
          return json({ ok: true, action }, 200, origin);
        }
        if (action === "promote" || action === "demote") {
          if (action === "promote" && target.role === "admin") return json({ error: "This account is already an administrator." }, 409, origin);
          const role = action === "promote" ? "admin" : "user";
          const updated = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}`, env, {
            method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ role }),
          });
          if (!updated.ok) return upstreamError(updated, origin);
          await logAdminEvent(identity, target, action === "promote" ? "promote_user" : "demote_admin", env);
          return json({ ok: true, action }, 200, origin);
        }
        const isSuspending = action === "suspend";
        const profileUpdate = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}`, env, {
          method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ account_status: isSuspending ? "suspended" : "active" }),
        });
        if (!profileUpdate.ok) return upstreamError(profileUpdate, origin);
        if (isSuspending) {
          const revokeSessions = await supabaseAdminFetch(`/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(targetId)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
          if (!revokeSessions.ok) console.error("Persora could not revoke sessions for the suspended account", revokeSessions.status);
        }
        await logAdminEvent(identity, target, isSuspending ? "suspend_user" : "restore_user", env);
        return json({ ok: true, action }, 200, origin);
      }
      if (url.pathname === "/account" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to delete your account." }, 401, origin);
        if (identity.role === "admin" && await countRows("profiles?role=eq.admin&account_status=eq.active", "id", env) <= 1) {
          return json({ error: "Promote another active administrator before deleting this account." }, 409, origin);
        }
        const deleted = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        if (!deleted.ok) return upstreamError(deleted, origin);
        try { await deleteOwnedFiles(identity.id, env.VAULT_FILES); } catch (error) { console.error("Persora R2 cleanup pending after account deletion", safeError(error)); }
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "delete_own_account", env);
        return jsonWithCookie({ ok: true }, 200, origin, sessionCookie("", request, 0));
      }
      return json({ error: "Not found." }, 404, origin);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error("Persora Pages API request failed", safeError(error));
      return json({ error: error instanceof Error ? error.message : "The private service couldn't complete that request." }, status, origin);
    }
  },
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Range",
    "Access-Control-Expose-Headers": "Content-Disposition,Content-Length,X-File-Name",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}
function jsonWithCookie(value, status, origin, cookie) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) });
  headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(value), { status, headers });
}

async function readBody(request) {
  const value = await request.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function safeError(error) { return error instanceof Error ? error.message : "unknown error"; }
function sanitizeFileName(name) { return String(name || "file").normalize("NFKC").replace(/[^\w.()-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file"; }
function safeContentType(type) { return typeof type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type.slice(0, 120) : "application/octet-stream"; }
function ownsKey(userId, key) { return Boolean(key && key.startsWith(`${userId}/`) && !key.includes("..") && !key.includes("\\")); }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index++) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(value) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid cryptographic data.");
  return Uint8Array.from(value.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}
async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function randomHex(byteCount) { const bytes = new Uint8Array(byteCount); crypto.getRandomValues(bytes); return bytesToHex(bytes); }
function randomLoginId() {
  const range = 9_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return String(1_000_000 + (sample[0] % range));
}
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const DUMMY_PASSWORD = "persora-login-timing-padding-never-use";
const VALID_SECTIONS = new Set(["documents", "academics", "subscriptions", "family", "purchases", "accounts", "memberships", "study", "business-card", "urls"]);
function validPasswordLength(password) { return typeof password === "string" && password.length >= 12 && new TextEncoder().encode(password).length <= 72; }
function rpcValue(value) {
  if (Array.isArray(value)) return value.length ? rpcValue(value[0]) : null;
  if (value && typeof value === "object") return rpcValue(Object.values(value)[0]);
  return value;
}
async function hashPassword(password, env) {
  const value = rpcValue(await callRpc("persora_hash_password", { p_password: password }, env));
  if (typeof value !== "string" || !/^\$2[a-z]\$/.test(value.slice(0, 5))) throw new Error("The password hashing service returned an invalid result.");
  return value;
}
async function verifyPassword(password, passwordHash, env) {
  if (typeof passwordHash !== "string" || !/^\$2[a-z]\$/.test(passwordHash.slice(0, 5))) {
    await hashPassword(DUMMY_PASSWORD, env);
    return false;
  }
  const value = rpcValue(await callRpc("persora_verify_password", { p_password: password, p_hash: passwordHash }, env));
  return value === true;
}
function readSessionCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === "persora_session") return part.slice(separator + 1).trim();
  }
  return "";
}
function sessionCookie(token, request, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `persora_session=${token}; Path=/api; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
function publicUser(profile) {
  return {
    id: String(profile.id),
    userId: String(profile.login_id || ""),
    email: String(profile.email || ""),
    fullName: String(profile.full_name || "Persora member"),
    role: profile.role === "admin" ? "admin" : "user",
    timezone: String(profile.timezone || "Asia/Dhaka"),
    demo: false,
  };
}
function getSupabaseUrl(env) { return String(env.SUPABASE_URL || "").replace(/\/$/, ""); }
function serviceHeaders(env, extra = {}) {
  const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  const headers = { apikey: secretKey, ...extra };
  // New sb_secret keys are API keys, not JWTs; Supabase requires them in apikey only.
  // Keep the Authorization bearer header only for legacy service_role JWTs.
  if (!String(secretKey).startsWith("sb_secret_")) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}
async function supabaseAdminFetch(path, env, init = {}) {
  const base = getSupabaseUrl(env);
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return fetch(`${base}${path}`, { ...init, headers: serviceHeaders(env, init.headers || {}) });
}
async function restRows(path, env) {
  const base = getSupabaseUrl(env);
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: serviceHeaders(env) });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  return response.json();
}
async function callRpc(name, params, env) {
  const response = await supabaseAdminFetch(`/rest/v1/rpc/${name}`, env, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(`Database action ${name} failed (${response.status}).`);
  return response.json();
}
async function authorize(request, env) {
  const token = readSessionCookie(request);
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256Hex(token);
  const sessions = await restRows(`user_sessions?token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,user_id`, env);
  if (!Array.isArray(sessions) || !sessions[0]) return null;
  const profiles = await restRows(`profiles?id=eq.${encodeURIComponent(sessions[0].user_id)}&select=id,login_id,email,full_name,role,account_status,timezone`, env);
  const profile = profiles?.[0];
  if (!profile || profile.account_status !== "active") return null;
  return { ...profile, session_id: sessions[0].id };
}
function rpcTimestamp(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return rpcTimestamp(value[0]);
  if (value && typeof value === "object") return rpcTimestamp(Object.values(value)[0]);
  return null;
}
async function recordLoginAttempt(fingerprint, success, env, limit = 8) {
  return rpcTimestamp(await callRpc("persora_record_login_attempt", { p_fingerprint: fingerprint, p_success: success, p_limit: limit }, env));
}
async function createSession(userId, env) {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const response = await supabaseAdminFetch("/rest/v1/user_sessions", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, token_hash: await sha256Hex(token), expires_at: expiresAt }),
  });
  if (!response.ok) throw new Error(`Could not create a secure session (${response.status}).`);
  return token;
}
async function registerAccount(body, request, env) {
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (fullName.length < 1 || fullName.length > 100) throw new HttpError("Enter a name between 1 and 100 characters.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Enter a valid email address.");
  if (!validPasswordLength(password)) throw new HttpError("Use a password with at least 12 characters and no more than 72 bytes.");
  const existing = await restRows(`profiles?email=eq.${encodeURIComponent(email)}&select=id`, env);
  if (existing.length) throw new HttpError("An account with this email already exists.", 409);
  const plans = await restRows("subscription_plans?slug=eq.free&active=eq.true&select=id,storage_gb", env);
  if (!plans[0]) throw new HttpError("The Free plan is not configured. Please contact the site administrator.", 503);
  const hash = await hashPassword(password, env);
  let profile = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = {
      login_id: randomLoginId(), email, full_name: fullName,
      password_hash: hash,
      timezone: "Asia/Dhaka", role: "user", account_status: "active",
    };
    const response = await supabaseAdminFetch("/rest/v1/profiles", env, {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(candidate),
    });
    if (response.status === 409) {
      const emailExists = await restRows(`profiles?email=eq.${encodeURIComponent(email)}&select=id`, env);
      if (emailExists.length) throw new HttpError("An account with this email already exists.", 409);
      continue;
    }
    if (!response.ok) throw new Error(`Could not create the account (${response.status}).`);
    const created = await response.json();
    profile = Array.isArray(created) ? created[0] : created;
    break;
  }
  if (!profile?.id) throw new HttpError("Could not assign a unique seven-digit Persora ID. Please try again.", 503);
  try {
    const subscription = await supabaseAdminFetch("/rest/v1/user_subscriptions", env, {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: profile.id, plan_id: plans[0].id, status: "active", storage_limit_gb: Number(plans[0].storage_gb) }),
    });
    if (!subscription.ok) throw new Error(`Could not activate the Free plan (${subscription.status}).`);
    const token = await createSession(profile.id, env);
    return { profile, token };
  } catch (error) {
    await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, env, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}
async function loginAccount(body, request, env) {
  const rawIdentifier = typeof body.identifier === "string" ? body.identifier : typeof body.userId === "string" ? body.userId : "";
  const password = typeof body.password === "string" ? body.password : "";
  const isLoginId = /^[0-9]{7}$/.test(rawIdentifier.trim());
  const identifier = isLoginId ? rawIdentifier.trim() : rawIdentifier.trim().toLowerCase();
  const validEmail = identifier.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
  if ((!isLoginId && !validEmail) || !password || new TextEncoder().encode(password).length > 72) throw new HttpError("Enter a valid email address or seven-digit Persora ID and password.");
  const lookup = isLoginId ? `login_id=eq.${identifier}` : `email=eq.${encodeURIComponent(identifier)}`;
  const rows = await restRows(`profiles?${lookup}&select=id,login_id,email,full_name,role,account_status,timezone,password_hash`, env);
  const profile = rows[0];
  // Use the canonical Persora ID so attempting the same account via email and ID
  // consumes one shared account limit; unknown identifiers get their own bucket.
  const ratePrincipal = typeof profile?.login_id === "string" && /^[0-9]{7}$/.test(profile.login_id) ? profile.login_id : identifier;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const fingerprint = await sha256Hex(`account|${ratePrincipal}`);
  const ipFingerprint = await sha256Hex(`ip|${ip}`);
  const [blocked, ipBlocked] = await Promise.all([
    callRpc("persora_login_blocked", { p_fingerprint: fingerprint }, env).then(rpcTimestamp),
    callRpc("persora_login_blocked", { p_fingerprint: ipFingerprint }, env).then(rpcTimestamp),
  ]);
  if ([blocked, ipBlocked].some((value) => value && Date.parse(value) > Date.now())) throw new HttpError("Too many sign-in attempts. Try again in 15 minutes.", 429);
  const validPassword = profile ? await verifyPassword(password, profile.password_hash, env) : (await hashPassword(DUMMY_PASSWORD, env), false);
  if (!profile || profile.account_status !== "active" || !validPassword) {
    const [nextBlock, nextIpBlock] = await Promise.all([
      recordLoginAttempt(fingerprint, false, env, 8),
      recordLoginAttempt(ipFingerprint, false, env, 30),
    ]);
    if ([nextBlock, nextIpBlock].some((value) => value && Date.parse(value) > Date.now())) throw new HttpError("Too many sign-in attempts. Try again in 15 minutes.", 429);
    throw new HttpError("That email or Persora ID/password combination is incorrect.", 401);
  }
  await Promise.all([recordLoginAttempt(fingerprint, true, env, 8), recordLoginAttempt(ipFingerprint, true, env, 30)]);
  const token = await createSession(profile.id, env);
  return { profile, token };
}
async function logoutSession(request, env) {
  const token = readSessionCookie(request);
  if (!token || token.length > 200) return;
  try {
    const tokenHash = await sha256Hex(token);
    const response = await supabaseAdminFetch(`/rest/v1/user_sessions?token_hash=eq.${tokenHash}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (!response.ok) console.error("Persora session could not be removed during sign-out", response.status);
  } catch (error) { console.error("Persora session cleanup failed during sign-out", safeError(error)); }
}
async function changePassword(identity, body, env) {
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!validPasswordLength(newPassword)) throw new HttpError("Use a new password with at least 12 characters and no more than 72 bytes.");
  const rows = await restRows(`profiles?id=eq.${encodeURIComponent(identity.id)}&select=password_hash`, env);
  const profile = rows[0];
  if (!profile || !(await verifyPassword(currentPassword, profile.password_hash, env))) throw new HttpError("Your current password is incorrect.", 401);
  const hash = await hashPassword(newPassword, env);
  const response = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(identity.id)}`, env, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ password_hash: hash }),
  });
  if (!response.ok) throw new Error(`Could not update the password (${response.status}).`);
  if (identity.session_id) {
    await supabaseAdminFetch(`/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(identity.id)}&id=neq.${encodeURIComponent(identity.session_id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  return { ok: true };
}

async function saveOwnedVaultItem(identity, body, env) {
  const id = typeof body.id === "string" ? body.id : "";
  const section = typeof body.section === "string" ? body.section : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subtitle = typeof body.subtitle === "string" ? body.subtitle.trim() : "";
  if (!isUuid(id)) throw new HttpError("Choose a valid vault item.");
  if (!VALID_SECTIONS.has(section)) throw new HttpError("Choose a valid vault section.");
  if (!title || title.length > 240 || subtitle.length > 240) throw new HttpError("Enter a title and keep it under 240 characters.");
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
  const entries = Object.entries(metadata);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata)).length;
  if (entries.length > 40 || metadataBytes > 20_000 || entries.some(([key, value]) => key.length > 80 || typeof value !== "string" || value.length > 5000)) throw new HttpError("Some item details are too long.");
  const file = body.file && typeof body.file === "object" ? body.file : null;
  const fileKey = typeof file?.key === "string" ? file.key : "";
  const fileName = typeof file?.name === "string" ? file.name.trim() : "";
  if (fileKey) {
    if (!ownsKey(identity.id, fileKey) || !fileName) throw new HttpError("That file is not available in your vault.", 403);
    const object = await env.VAULT_FILES.get(fileKey);
    if (!object || object.customMetadata?.ownerId !== identity.id) throw new HttpError("That file is not available in your vault.", 404);
  }
  const existing = await restRows(`vault_items?id=eq.${encodeURIComponent(id)}&select=user_id`, env);
  if (existing[0] && existing[0].user_id !== identity.id) throw new HttpError("That vault item belongs to another account.", 403);
  const row = {
    section, title, subtitle: subtitle || null, metadata,
    file_key: fileKey || null, file_name: fileKey ? fileName.slice(0, 240) : null,
    file_size: fileKey && Number.isFinite(Number(file.size)) ? Math.max(0, Number(file.size)) : null,
    file_type: fileKey ? safeContentType(file.type) : null,
    favorite: Boolean(body.favorite), updated_at: new Date().toISOString(),
  };
  const isUpdate = Boolean(existing[0]);
  const path = isUpdate
    ? `/rest/v1/vault_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}`
    : "/rest/v1/vault_items";
  const response = await supabaseAdminFetch(path, env, {
    method: isUpdate ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(isUpdate ? row : { id, user_id: identity.id, ...row }),
  });
  if (!response.ok) throw new Error(`Could not save the vault item (${response.status}).`);
  const saved = await response.json();
  const savedRow = Array.isArray(saved) ? saved[0] : saved;
  if (!savedRow) throw new HttpError("That vault item could not be found for this account.", 404);
  return savedRow;
}

async function isAdministrator(userId, env) {
  const rows = await restRows(`profiles?id=eq.${encodeURIComponent(userId)}&select=role,account_status`, env);
  return Array.isArray(rows) && rows[0]?.role === "admin" && rows[0]?.account_status === "active";
}
async function getProfile(userId, env) {
  const rows = await restRows(`profiles?id=eq.${encodeURIComponent(userId)}&select=id,login_id,role,account_status,email,full_name`, env);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function countRows(tableQuery, column, env) {
  const [table, query = ""] = tableQuery.split("?");
  const suffix = query ? `${query}&` : "";
  const response = await supabaseAdminFetch(`/rest/v1/${table}?${suffix}select=${column}`, env, { method: "GET", headers: { Prefer: "count=exact", Range: "0-0" } });
  if (!response.ok) throw new Error(`Could not count ${tableQuery}.`);
  const count = Number((response.headers.get("Content-Range") || "").split("/").pop());
  return Number.isFinite(count) ? count : 0;
}
async function logAdminEvent(actor, target, eventType, env, details = {}) {
  const response = await supabaseAdminFetch("/rest/v1/admin_audit_events", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ actor_id: actor.id, actor_email: actor.email || "", event_type: eventType, target_user_id: target.id, target_email: target.email || "", details }),
  });
  if (!response.ok) console.error("Persora admin audit event could not be saved", response.status);
}
async function upstreamError(response, origin) {
  const body = await response.json().catch(() => ({}));
  return json({ error: body.message || body.msg || body.error_description || "The account service rejected that action." }, response.status >= 400 ? response.status : 502, origin);
}
async function deleteOwnedFiles(userId, bucket) {
  let cursor;
  do {
    const page = await bucket.list({ prefix: `${userId}/`, cursor, limit: 1000 });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function bootstrapStatus(env) {
  const rows = await restRows("admin_bootstrap_state?id=eq.true&select=initialized_at", env);
  return { initialized: Boolean(rows[0]?.initialized_at), enabled: Boolean(env.ADMIN_BOOTSTRAP_SECRET) };
}
function slugify(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
async function loadSettings(env) {
  const rows = await restRows("platform_settings?select=setting_key,value", env);
  const stored = Object.fromEntries((rows || []).map((row) => [row.setting_key, row.value || {}]));
  return {
    billing: { ...DEFAULT_SETTINGS.billing, ...(stored.billing || {}) },
    storage: { ...DEFAULT_SETTINGS.storage, ...(stored.storage || {}) },
    paymentMethods: Array.isArray(stored.payment_methods) ? stored.payment_methods : DEFAULT_SETTINGS.paymentMethods,
    siteContent: stored.site_content && typeof stored.site_content === "object" && !Array.isArray(stored.site_content) ? stored.site_content : DEFAULT_SETTINGS.siteContent,
  };
}
function publicPlan(row, currency) {
  const storageGb = Number(row.storage_gb) || 0;
  const perGb = Number(row.price_per_gb_monthly) || 0;
  return { ...row, storage_gb: storageGb, price_per_gb_monthly: perGb, monthly_price: Number((storageGb * perGb).toFixed(2)), currency };
}
async function listPlans(env, activeOnly = false) {
  const activeFilter = activeOnly ? "&active=eq.true" : "";
  return restRows(`subscription_plans?select=id,slug,name,description,storage_gb,price_per_gb_monthly,active,sort_order&order=sort_order.asc,storage_gb.asc${activeFilter}`, env);
}
async function readUsage(bucket, prefix) {
  let cursor;
  let bytes = 0;
  let objectCount = 0;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) { bytes += Number(object.size) || 0; objectCount++; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { bytes, objectCount };
}
async function markSubscriptionPastDue(userId, env) {
  const response = await supabaseAdminFetch(`/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active`, env, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "past_due" }),
  });
  if (!response.ok) console.error("Persora could not mark an expired subscription past due", response.status);
}
async function userStorageUsage(userId, bucket, env) {
  const [settings, subscriptionRows] = await Promise.all([
    loadSettings(env),
    restRows(`user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan_id,status,storage_limit_gb,current_period_end`, env),
  ]);
  const subscription = subscriptionRows[0];
  const planRows = subscription?.plan_id ? await restRows(`subscription_plans?id=eq.${encodeURIComponent(subscription.plan_id)}&select=name,slug,storage_gb`, env) : [];
  const currentPlan = planRows[0];
  const expired = subscription?.status === "active" && currentPlan?.slug !== "free" && subscription.current_period_end && Date.parse(subscription.current_period_end) <= Date.now();
  if (expired) {
    await markSubscriptionPastDue(userId, env);
    subscription.status = "past_due";
  }
  const active = subscription?.status === "active";
  const isFreePlan = active && currentPlan?.slug === "free";
  const storageLimitGb = active
    ? (isFreePlan ? Number(currentPlan?.storage_gb || subscription.storage_limit_gb) : Number(subscription.storage_limit_gb))
    : Number(settings.storage.defaultFreeGb) || 5;
  const usage = await readUsage(bucket, `${userId}/`);
  return {
    bytesUsed: usage.bytes,
    objectCount: usage.objectCount,
    storageLimitBytes: storageLimitGb * 1024 * 1024 * 1024,
    storageLimitGb,
    planName: active && !isFreePlan ? (currentPlan?.name || "Current plan") : "Free",
  };
}
async function loadBilling(identity, env) {
  const [settings, plans, subscriptionRows, paymentRows, usage] = await Promise.all([
    loadSettings(env), listPlans(env, true),
    restRows(`user_subscriptions?user_id=eq.${encodeURIComponent(identity.id)}&select=plan_id,status,storage_limit_gb,current_period_end`, env),
    restRows(`payment_records?user_id=eq.${encodeURIComponent(identity.id)}&select=id,user_id,plan_id,amount,currency,method,reference,status,submitted_at,reviewed_at,reviewed_by,admin_note&order=submitted_at.desc&limit=100`, env),
    userStorageUsage(identity.id, env.VAULT_FILES, env),
  ]);
  const subscription = subscriptionRows[0];
  const plan = subscription?.plan_id ? (await restRows(`subscription_plans?id=eq.${encodeURIComponent(subscription.plan_id)}&select=name,slug,storage_gb`, env))[0] : null;
  let subscriptionStatus = subscription?.status || "active";
  const expired = subscriptionStatus === "active" && plan?.slug !== "free" && subscription?.current_period_end && Date.parse(subscription.current_period_end) <= Date.now();
  if (expired) { await markSubscriptionPastDue(identity.id, env); subscriptionStatus = "past_due"; }
  const planById = new Map(plans.map((row) => [row.id, row]));
  const payments = paymentRows.map((row) => ({ ...row, email: identity.email || "", plan_name: planById.get(row.plan_id)?.name || "Plan", storage_gb: Number(planById.get(row.plan_id)?.storage_gb || 0) }));
  return {
    subscription: { plan_id: subscription?.plan_id || "", plan_name: subscriptionStatus === "active" ? (plan?.name || "Free") : "Free", storage_limit_gb: subscriptionStatus === "active" ? (plan?.slug === "free" ? Number(plan.storage_gb || settings.storage.defaultFreeGb) : Number(subscription?.storage_limit_gb || settings.storage.defaultFreeGb)) : Number(settings.storage.defaultFreeGb), status: subscriptionStatus, current_period_end: subscription?.current_period_end || null },
    plans: plans.map((row) => publicPlan(row, settings.billing.currency)),
    payments,
    storage: usage,
    billingSettings: settings.billing,
    paymentMethods: settings.paymentMethods.filter((method) => method && method.active === true).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    maxUploadMb: settings.storage.maxUploadMb,
  };
}
async function createPaymentRequest(identity, body, env) {
  const planId = typeof body.planId === "string" ? body.planId : "";
  const methodId = typeof body.methodId === "string" ? body.methodId.trim().slice(0, 80) : "";
  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 180) : "";
  if (!isUuid(planId) || !methodId || reference.length < 1) throw new HttpError("Choose a plan, payment method, and transaction reference.", 400);
  const settings = await loadSettings(env);
  if (!settings.billing.billingEnabled) throw new HttpError("Manual subscription payments are not enabled yet. Please check back later.", 409);
  const methodConfig = settings.paymentMethods.find((entry) => entry && entry.id === methodId && entry.active === true);
  if (!methodConfig) throw new HttpError("That payment method is unavailable. Refresh and choose an active method.", 409);
  const method = methodConfig.name;
  const rows = await restRows(`subscription_plans?id=eq.${encodeURIComponent(planId)}&active=eq.true&select=id,name,storage_gb,price_per_gb_monthly`, env);
  const plan = rows[0];
  if (!plan) throw new HttpError("That plan is no longer available.", 404);
  const amount = Number((Number(plan.storage_gb) * Number(plan.price_per_gb_monthly)).toFixed(2));
  if (amount <= 0) throw new HttpError("The free plan does not require a payment request.", 400);
  const pending = await restRows(`payment_records?user_id=eq.${encodeURIComponent(identity.id)}&status=eq.pending&select=id&limit=1`, env);
  if (pending.length) throw new HttpError("You already have a payment request waiting for review.", 409);
  const response = await supabaseAdminFetch("/rest/v1/payment_records", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ user_id: identity.id, plan_id: plan.id, amount, currency: settings.billing.currency, method, reference, status: "pending" }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Payment request could not be submitted.");
  }
  const created = (await response.json())[0];
  return { ...created, email: identity.email || "", plan_name: plan.name, storage_gb: Number(plan.storage_gb) };
}
async function savePlatformSetting(key, value, actorId, env) {
  if (key === "billing") {
    if (!value || typeof value !== "object") throw new HttpError("Invalid billing settings.", 400);
    const currency = String(value.currency || "").trim().toUpperCase();
    const manualInstructions = String(value.manualInstructions || "").slice(0, 3000);
    if (!/^[A-Z]{3}$/.test(currency) || typeof value.billingEnabled !== "boolean") throw new HttpError("Set a valid three-letter currency and payment status.", 400);
    value = { currency, manualInstructions, billingEnabled: value.billingEnabled };
  } else if (key === "storage") {
    if (!value || typeof value !== "object") throw new HttpError("Invalid storage settings.", 400);
    const defaultFreeGb = Number(value.defaultFreeGb);
    const maxUploadMb = Number(value.maxUploadMb);
    if (!Number.isFinite(defaultFreeGb) || defaultFreeGb < 0.1 || defaultFreeGb > 10000 || !Number.isFinite(maxUploadMb) || maxUploadMb < 1 || maxUploadMb > MAX_CONFIGURABLE_UPLOAD_MB) throw new HttpError(`Storage quota must be 0.1–10,000 GB and upload size 1–${MAX_CONFIGURABLE_UPLOAD_MB} MB.`, 400);
    value = { defaultFreeGb, maxUploadMb };
  } else if (key === "payment_methods") {
    if (!Array.isArray(value) || value.length > 20) throw new HttpError("Add no more than 20 payment methods.", 400);
    const seenIds = new Set();
    value = value.map((entry) => {
      if (!entry || typeof entry !== "object") throw new HttpError("One of the payment methods is invalid.", 400);
      const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : "";
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const accountName = typeof entry.accountName === "string" ? entry.accountName.trim() : "";
      const accountIdentifier = typeof entry.accountIdentifier === "string" ? entry.accountIdentifier.trim() : "";
      const instructions = typeof entry.instructions === "string" ? entry.instructions.trim() : "";
      const sortOrder = Number.isFinite(Number(entry.sort_order)) ? Number(entry.sort_order) : 100;
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || name.length < 2 || name.length > 80 || accountName.length > 120 || accountIdentifier.length > 180 || instructions.length > 1000 || typeof entry.active !== "boolean") throw new HttpError("Enter a method ID, name, account details under 180 characters, and valid status.", 400);
      if (seenIds.has(id)) throw new HttpError("Payment method IDs must be unique.", 400);
      seenIds.add(id);
      return { id, name, accountName, accountIdentifier, instructions, active: entry.active, sort_order: sortOrder };
    });
  } else if (key === "site_content") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError("Invalid website content.", 400);
    const limits = { privacyTitle: 120, privacyBody: 12000, termsTitle: 120, termsBody: 12000, contactTitle: 120, contactBody: 4000, contactEmail: 254, contactPhone: 80, contactWhatsApp: 80, contactAddress: 500 };
    const cleaned = {};
    for (const [field, maxLength] of Object.entries(limits)) {
      const text = typeof value[field] === "string" ? value[field].trim() : "";
      if (text.length > maxLength) throw new HttpError(`${field} is too long (maximum ${maxLength} characters).`, 400);
      cleaned[field] = text;
    }
    if (!cleaned.privacyTitle || !cleaned.privacyBody || !cleaned.termsTitle || !cleaned.termsBody || !cleaned.contactTitle) throw new HttpError("Add a title and policy text for both legal pages.", 400);
    if (cleaned.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.contactEmail)) throw new HttpError("Enter a valid contact email address.", 400);
    value = cleaned;
  } else {
    throw new HttpError("Choose a supported platform setting.", 400);
  }
  const response = await supabaseAdminFetch("/rest/v1/platform_settings?on_conflict=setting_key", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ setting_key: key, value, updated_by: actorId, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Settings could not be saved (${response.status}).`);
  return (await response.json())[0];
}
async function savePlan(body, env) {
  const id = typeof body.id === "string" && isUuid(body.id) ? body.id : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const slug = slugify(body.slug || name);
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const storageGb = Number(body.storage_gb);
  const rate = Number(body.price_per_gb_monthly);
  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100;
  const active = Boolean(body.active);
  if (!name || !slug || !Number.isFinite(storageGb) || storageGb <= 0 || storageGb > 100000 || !Number.isFinite(rate) || rate < 0 || rate > 1000000) throw new HttpError("Enter a name, storage allocation, and non-negative price per GB/month.", 400);
  if (slug === "free" && !active) throw new HttpError("The default Free plan cannot be disabled.", 400);
  const settings = await loadSettings(env);
  const record = { ...(id ? { id } : {}), slug, name, description, storage_gb: storageGb, price_per_gb_monthly: rate, active, sort_order: sortOrder, updated_at: new Date().toISOString() };
  const response = await supabaseAdminFetch(id ? `/rest/v1/subscription_plans?id=eq.${encodeURIComponent(id)}` : "/rest/v1/subscription_plans", env, {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(record),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new HttpError(body.message || body.details || "Plan could not be saved. Check that the plan name/slug is unique.", response.status === 409 ? 409 : 400);
  }
  const saved = id ? (await response.json())[0] : (await response.json())[0];
  return publicPlan(saved, settings.billing.currency);
}
async function saveDocumentType(body, env) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const id = slugify(body.id || name);
  if (!name || !id) throw new HttpError("Enter a document type name.", 400);
  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100;
  const record = { id, name, active: Boolean(body.active), sort_order: sortOrder, updated_at: new Date().toISOString() };
  const response = await supabaseAdminFetch("/rest/v1/document_types?on_conflict=id", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(record),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Document type could not be saved.");
  }
  return (await response.json())[0];
}
async function reviewPayment(body, identity, env) {
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!isUuid(paymentId) || !decision) throw new HttpError("Choose a payment and approval decision.", 400);
  const paymentRows = await restRows(`payment_records?id=eq.${encodeURIComponent(paymentId)}&select=id,user_id,plan_id,amount,currency,method,reference,status`, env);
  const payment = paymentRows[0];
  if (!payment) throw new HttpError("Payment record was not found.", 404);
  const response = await supabaseAdminFetch("/rest/v1/rpc/persora_review_payment", env, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment_id: paymentId, reviewer_id: identity.id, decision, review_note: note }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "The payment review could not be saved.");
  }
  const reviewed = await response.json();
  if (reviewed !== true) throw new HttpError("That payment has already been reviewed or its plan is no longer active.", 409);
  const target = await getProfile(payment.user_id, env);
  await logAdminEvent(identity, target || { id: payment.user_id, email: "" }, decision === "approved" ? "approve_payment" : "reject_payment", env, { payment_id: paymentId, amount: payment.amount, currency: payment.currency });
  return { ok: true, status: decision };
}
async function summarizeBucket(bucket) {
  let cursor;
  let bytesUsed = 0;
  let objectCount = 0;
  const byUser = {};
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const object of page.objects) {
      bytesUsed += Number(object.size) || 0;
      objectCount++;
      const owner = object.key.split("/")[0];
      if (isUuid(owner)) {
        byUser[owner] ||= { bytes: 0, objects: 0 };
        byUser[owner].bytes += Number(object.size) || 0;
        byUser[owner].objects++;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { bytesUsed, objectCount, usersWithFiles: Object.keys(byUser).length, byUser };
}
async function loadAdminConsole(env) {
  const settings = await loadSettings(env);
  const [profileRows, eventRows, plans, typeRows, paymentRows, totalAccounts, activeAccounts, vaultEntries, pendingPayments, storageResult] = await Promise.all([
    restRows("profiles?select=id,login_id,email,full_name,role,account_status,created_at&order=created_at.desc&limit=1000", env),
    restRows("admin_audit_events?select=id,actor_email,event_type,target_user_id,target_email,created_at,details&order=created_at.desc&limit=30", env),
    listPlans(env, false),
    restRows("document_types?select=id,name,active,sort_order&order=sort_order.asc,name.asc", env),
    restRows("payment_records?select=id,user_id,plan_id,amount,currency,method,reference,status,submitted_at,reviewed_at,reviewed_by,admin_note&order=submitted_at.desc&limit=500", env),
    countRows("profiles", "id", env),
    countRows("profiles?account_status=eq.active", "id", env),
    countRows("vault_items", "id", env),
    countRows("payment_records?status=eq.pending", "id", env),
    summarizeBucket(env.VAULT_FILES).then((data) => ({ status: "connected", ...data })).catch(() => ({ status: "unavailable", bytesUsed: 0, objectCount: 0, usersWithFiles: 0, byUser: {} })),
  ]);
  const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
  const planMap = new Map(plans.map((plan) => [plan.id, plan]));
  const payments = paymentRows.map((payment) => ({
    ...payment,
    email: profileMap.get(payment.user_id)?.email || "",
    plan_name: planMap.get(payment.plan_id)?.name || "Removed plan",
    storage_gb: Number(planMap.get(payment.plan_id)?.storage_gb || 0),
  }));
  const billing = { ...settings.billing };
  return {
    metrics: { totalAccounts, activeAccounts, vaultEntries, pendingPayments },
    profiles: profileRows.map((profile) => ({ ...profile, storage_bytes: storageResult.byUser[profile.id]?.bytes || 0 })),
    events: eventRows,
    plans: plans.map((plan) => publicPlan(plan, billing.currency)),
    documentTypes: typeRows,
    payments,
    billingSettings: billing,
    paymentMethods: settings.paymentMethods,
    siteContent: settings.siteContent,
    storageSettings: settings.storage,
    storage: storageResult,
    system: { database: "connected", storage: storageResult.status, supabaseUrlConfigured: Boolean(getSupabaseUrl(env)), secretKeyConfigured: Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) },
  };
}

