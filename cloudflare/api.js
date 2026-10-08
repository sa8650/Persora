import { handleTimeline, loadTimelineExport, readTimelineExportAttachment } from "./timeline.js";
import { SmartScanError, MAX_SMART_SCAN_FILE_BYTES, extractDocumentFields, runAzureDocumentIntelligenceOcr, smartScanMimeType } from "./smart-scan.js";

const DEFAULT_SETTINGS = {
  billing: { currency: "BDT", manualInstructions: "Follow the account details shown for your selected payment method.", billingEnabled: false, minTermMonths: 1, maxTermMonths: 12 },
  storage: { defaultFreeGb: 5, maxUploadMb: 25 },
  paymentMethods: [],
  siteContent: {},
  email: { verificationEnabled: true, senderName: "Persora", senderEmail: "", replyToEmail: "", replyToName: "Persora Support" },
  smartScan: { enabled: true },
  alarmRingtones: [],
};
const MAX_CONFIGURABLE_UPLOAD_MB = 150;
const MAX_ALARM_RINGTONE_BYTES = 10 * 1024 * 1024;
const MAX_ALARM_RINGTONE_COUNT = 50;
const PROFILE_DICEBEAR_AVATARS = new Set([
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Felix",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Oliver",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Zoe",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Leo",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Mia",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Noah",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Ava",
]);
const ALARM_RINGTONE_FORMATS = {
  mp3: { contentType: "audio/mpeg", accepted: ["audio/mpeg", "audio/mp3", "application/octet-stream"] },
  wav: { contentType: "audio/wav", accepted: ["audio/wav", "audio/x-wav", "application/octet-stream"] },
  ogg: { contentType: "audio/ogg", accepted: ["audio/ogg", "application/ogg", "application/octet-stream"] },
  m4a: { contentType: "audio/mp4", accepted: ["audio/mp4", "audio/x-m4a", "audio/m4a", "application/octet-stream"] },
  aac: { contentType: "audio/aac", accepted: ["audio/aac", "audio/x-aac", "application/octet-stream"] },
  webm: { contentType: "audio/webm", accepted: ["audio/webm", "application/octet-stream"] },
};
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
        return jsonWithCookie({ user: await publicUser(result.profile, env) }, 201, origin, sessionCookie(result.token, request));
      }
      if (url.pathname === "/auth/login" && request.method === "POST") {
        const body = await readBody(request);
        const result = await loginAccount(body, request, env);
        return jsonWithCookie({ user: await publicUser(result.profile, env) }, 200, origin, sessionCookie(result.token, request));
      }
      if (url.pathname === "/auth/me" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Your session expired. Sign in again." }, 401, origin);
        return json({ user: await publicUser(identity, env) }, 200, origin);
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
      if (url.pathname === "/email-verification/send" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in to verify your email address." }, 401, origin);
        return json(await sendEmailVerificationCode(identity, env), 200, origin);
      }
      if (url.pathname === "/email-verification/verify" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in to verify your email address." }, 401, origin);
        const body = await readBody(request);
        return json(await verifyEmailVerificationCode(identity, body, env), 200, origin);
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
      const publicCardMatch = url.pathname.match(/^\/public-cards\/([A-Fa-f0-9]{32})(?:\/(photo|report))?$/);
      if (publicCardMatch && url.pathname === `/public-cards/${publicCardMatch[1]}` && request.method === "GET") {
        const row = await getPublicBusinessCard(publicCardMatch[1], env);
        if (!row) return json({ error: "This public business card is unavailable." }, 404, origin);
        return json(publicBusinessCardPayload(row, publicCardMatch[1]), 200, origin);
      }
      if (publicCardMatch && publicCardMatch[2] === "photo" && request.method === "GET") {
        const kind = url.searchParams.get("kind") === "logo" ? "logo" : "profile";
        const row = await getPublicBusinessCard(publicCardMatch[1], env);
        const key = kind === "logo" ? row?.business_logo_key : row?.profile_photo_key;
        if (!row || !key || !ownsKey(row.user_id, key)) return json({ error: "This public card image is unavailable." }, 404, origin);
        const object = await env.VAULT_FILES.get(key);
        if (!object || object.customMetadata?.ownerId !== row.user_id) return json({ error: "This public card image is unavailable." }, 404, origin);
        return new Response(object.body, { status: 200, headers: { "Content-Type": safeContentType(object.httpMetadata?.contentType || "image/jpeg"), "Cache-Control": "no-store, max-age=0", ...corsHeaders(origin) } });
      }
      if (publicCardMatch && publicCardMatch[2] === "report" && request.method === "POST") {
        const body = await readBody(request);
        return json(await reportPublicBusinessCard(publicCardMatch[1], body, request, env), 200, origin);
      }
      if (url.pathname === "/business-cards" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const rows = await restRows(`business_cards?user_id=eq.${encodeURIComponent(identity.id)}&select=*&order=updated_at.desc`, env);
        return json(rows, 200, origin);
      }
      if (url.pathname === "/business-cards" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await saveBusinessCard(identity, await readBody(request), env), 200, origin);
      }
      if (url.pathname === "/business-cards" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id)) return json({ error: "Choose a valid business card." }, 400, origin);
        const rows = await restRows(`business_cards?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&select=profile_photo_key,business_logo_key`, env);
        await supabaseAdminFetch(`/rest/v1/record_shares?resource_type=eq.business_card&resource_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        const result = await supabaseAdminFetch(`/rest/v1/business_cards?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        if (!result.ok) return upstreamError(result, origin);
        for (const key of [rows[0]?.profile_photo_key, rows[0]?.business_logo_key]) await deleteBusinessCardPhotoIfUnreferenced(identity.id, key, env);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/contacts" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const rows = await restRows(`contacts?user_id=eq.${encodeURIComponent(identity.id)}&select=*&order=full_name.asc`, env);
        return json(rows, 200, origin);
      }
      if (url.pathname === "/contacts/photo" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id)) return json({ error: "Choose a valid contact." }, 400, origin);
        const rows = await restRows(`contacts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&select=photo_key&limit=1`, env);
        const key = rows[0]?.photo_key || "";
        if (!key || !ownsKey(identity.id, key)) return json({ error: "This contact has no profile photo." }, 404, origin);
        const object = await env.VAULT_FILES.get(key);
        if (!object || object.customMetadata?.ownerId !== identity.id) return json({ error: "This contact photo is unavailable." }, 404, origin);
        return new Response(object.body, { status: 200, headers: { "Content-Type": safeContentType(object.httpMetadata?.contentType || "image/jpeg"), "Cache-Control": "private, no-store", ...corsHeaders(origin) } });
      }
      if (url.pathname === "/contacts" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await saveContact(identity, body, env), 200, origin);
      }
      if (url.pathname === "/contacts/merge" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await mergeContacts(identity, body, env), 200, origin);
      }
      if (url.pathname === "/contacts" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id)) return json({ error: "Choose a valid contact." }, 400, origin);
        const rows = await restRows(`contacts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&select=photo_key`, env);
        await supabaseAdminFetch(`/rest/v1/record_shares?resource_type=eq.contact&resource_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        const response = await supabaseAdminFetch(`/rest/v1/contacts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        if (!response.ok) return upstreamError(response, origin);
        await deleteContactPhotoIfUnreferenced(identity.id, rows[0]?.photo_key, env);
        return json({ ok: true }, 200, origin);
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
      if (url.pathname === "/vault/folders" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const scope = url.searchParams.get("scope") || "";
        if (!VALID_FOLDER_SCOPES.has(scope)) return json({ error: "Choose a valid page for its folders." }, 400, origin);
        const rows = await restRows(`vault_folders?user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.${encodeURIComponent(scope)}&select=id,scope,name,color,pinned,created_at,updated_at&order=pinned.desc,name.asc`, env);
        return json(rows, 200, origin);
      }
      if (url.pathname === "/vault/folders" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await saveVaultFolder(identity, await readBody(request), env), 200, origin);
      }
      if (url.pathname === "/vault/folders" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        const scope = url.searchParams.get("scope") || "";
        if (!isUuid(id) || !VALID_FOLDER_SCOPES.has(scope)) return json({ error: "Choose a valid page folder." }, 400, origin);
        const result = await supabaseAdminFetch(`/rest/v1/vault_folders?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.${encodeURIComponent(scope)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        if (!result.ok) return upstreamError(result, origin);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/smart-scan" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in to scan a private document." }, 401, origin);
        if (!(await isSmartScanEnabled(identity.id, env))) return json({ error: "Smart Scan is currently disabled for this account by an administrator." }, 403, origin);
        if (!(await hasActivePaidUploadPlan(identity.id, env))) throw uploadPlanRequiredError();
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > MAX_SMART_SCAN_FILE_BYTES + 512 * 1024) return json({ error: "Smart Scan supports files up to 7 MB." }, 413, origin);
        let form;
        try { form = await request.formData(); }
        catch { return json({ error: "The scan upload could not be read. Please select the file again." }, 400, origin); }
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose an image or PDF to scan." }, 400, origin);
        if (!file.size || file.size > MAX_SMART_SCAN_FILE_BYTES) return json({ error: "Smart Scan supports files up to 7 MB." }, 413, origin);
        const mimeType = smartScanMimeType(file.type, file.name);
        if (!mimeType) return json({ error: "Smart Scan supports PDF, JPEG, PNG, WebP, GIF, TIFF, and BMP files." }, 415, origin);
        const section = typeof form.get("section") === "string" ? String(form.get("section")) : "";
        if ((!VALID_SECTIONS.has(section) && section !== "medical-records") || section === "wallet-cards") return json({ error: "Choose a supported record space for Smart Scan." }, 400, origin);
        const fieldsText = typeof form.get("fields") === "string" ? String(form.get("fields")) : "[]";
        if (fieldsText.length > 24000) return json({ error: "The scan form has too many field definitions." }, 400, origin);
        let fields;
        try { fields = JSON.parse(fieldsText); } catch { fields = null; }
        if (!Array.isArray(fields) || fields.length < 1 || fields.length > 40) return json({ error: "The scan form fields could not be read." }, 400, origin);
        const retry = form.get("retry") === "true";
        const bytes = new Uint8Array(await file.arrayBuffer());
        const contentHash = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
        const fieldSignature = await sha256Hex(JSON.stringify({ section, fields, extractionVersion: "additional-data-v2" }));
        await recordSmartScanUsage(identity.id, { scans: 1 }, env);
        let cachedPayload = null;
        let cacheWarning = "";
        try { cachedPayload = await loadSmartScanCache(identity.id, contentHash, env); }
        catch { cacheWarning = "Scan caching is unavailable until the Smart Scan database migration is applied."; }
        const cachedResult = cachedPayload?.extractions?.[fieldSignature];
        if (!retry && cachedResult && typeof cachedResult === "object") {
          return json({ ...cachedResult, cached: true, ocrCached: true, ...(cacheWarning ? { cacheWarning } : {}) }, 200, origin);
        }

        let ocrText = typeof cachedPayload?.ocrText === "string" ? cachedPayload.ocrText : "";
        let pagesProcessed = Number.isFinite(Number(cachedPayload?.pagesProcessed)) ? Number(cachedPayload.pagesProcessed) : undefined;
        let warnings = Array.isArray(cachedPayload?.warnings) ? cachedPayload.warnings.filter((entry) => typeof entry === "string").slice(0, 10) : [];
        const ocrCached = Boolean(ocrText);
        if (!ocrCached) {
          try {
            await recordSmartScanUsage(identity.id, { ocrRuns: 1 }, env);
            const ocr = await runAzureDocumentIntelligenceOcr(bytes, mimeType, env);
            ocrText = ocr.text;
            pagesProcessed = ocr.pagesProcessed;
            warnings = ocr.warnings;
            cachedPayload = { version: 1, ocrText, pagesProcessed, warnings, extractions: cachedPayload?.extractions && typeof cachedPayload.extractions === "object" ? cachedPayload.extractions : {} };
            try { await storeSmartScanCache(identity.id, contentHash, cachedPayload, env); }
            catch { cacheWarning = "Scan caching is unavailable until the Smart Scan database migration is applied."; }
          } catch (error) {
            if (error instanceof SmartScanError) return json({ error: error.message, retryable: error.retryable, phase: error.phase }, error.status, origin);
            throw error;
          }
        }
        let extracted;
        try {
          await recordSmartScanUsage(identity.id, { aiExtractions: 1 }, env);
          extracted = await extractDocumentFields(env, section, fields, ocrText, warnings);
        }
        catch (error) {
          if (error instanceof SmartScanError) return json({ error: error.message, retryable: error.retryable, phase: error.phase, ocrCached, ...(cacheWarning ? { cacheWarning } : {}) }, error.status, origin);
          throw error;
        }
        const result = { ...extracted, cached: false, ocrCached, ...(pagesProcessed !== undefined ? { pagesProcessed } : {}), ...(cacheWarning ? { cacheWarning } : {}) };
        const extractions = { ...(cachedPayload?.extractions && typeof cachedPayload.extractions === "object" ? cachedPayload.extractions : {}), [fieldSignature]: extracted };
        const extractionKeys = Object.keys(extractions);
        if (extractionKeys.length > 8) delete extractions[extractionKeys[0]];
        try { await storeSmartScanCache(identity.id, contentHash, { version: 1, ocrText, pagesProcessed, warnings, extractions }, env); }
        catch { result.cacheWarning = "Scan caching is unavailable until the Smart Scan database migration is applied."; }
        return json(result, 200, origin);
      }
      if (url.pathname === "/profile" && request.method === "PATCH") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
        const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
        if (fullName.length < 1 || fullName.length > 100) return json({ error: "Enter a name between 1 and 100 characters." }, 400, origin);
        if (!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone) || timezone.length > 80) return json({ error: "Choose a valid timezone." }, 400, origin);
        const updates = { full_name: fullName, timezone };
        if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) {
          const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : body.avatarUrl === null ? "" : undefined;
          const isPhoto = typeof avatarUrl === "string" && avatarUrl.length <= 80000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(avatarUrl);
          const isEmoji = typeof avatarUrl === "string" && avatarUrl.length <= 80 && /^emoji:[^\u0000-\u001f<>]{1,24}$/u.test(avatarUrl);
          const isDiceBearAdventurer = typeof avatarUrl === "string" && PROFILE_DICEBEAR_AVATARS.has(avatarUrl);
          if (avatarUrl === undefined || (avatarUrl && !isPhoto && !isEmoji && !isDiceBearAdventurer)) return json({ error: "Choose a supported profile photo, emoji, or DiceBear Adventurer avatar." }, 400, origin);
          if (isPhoto && avatarUrl !== identity.avatar_url && !(await hasActivePaidUploadPlan(identity.id, env))) throw uploadPlanRequiredError();
          updates.avatar_url = avatarUrl || null;
        }
        const result = await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(identity.id)}`, env, {
          method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(updates),
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

      if (url.pathname === "/record-shares" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const direction = url.searchParams.get("direction") === "outgoing" ? "outgoing" : "incoming";
        return json(await listRecordShares(identity, direction, env), 200, origin);
      }
      if (url.pathname === "/record-shares" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await createRecordShare(identity, await readBody(request), env), 201, origin);
      }
      if (url.pathname === "/record-shares" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await revokeRecordShare(identity, await readBody(request), env), 200, origin);
      }
      if (url.pathname === "/shares" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const direction = url.searchParams.get("direction") === "outgoing" ? "outgoing" : "incoming";
        return json(await listShares(identity, direction, env), 200, origin);
      }
      if (url.pathname === "/shares" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await createShare(identity, body, env), 201, origin);
      }
      if (url.pathname === "/shares" && request.method === "PATCH") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await updateSharePermission(identity, body, env), 200, origin);
      }
      if (url.pathname === "/shares" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await revokeShare(identity, body.shareId, env), 200, origin);
      }
      if (url.pathname === "/shares/item" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await saveSharedVaultItem(identity, body, env), 200, origin);
      }
      if (url.pathname === "/shares/upload" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const key = url.searchParams.get("key") || "";
        const object = await env.VAULT_FILES.get(key);
        const ownerId = object?.customMetadata?.ownerId || "";
        if (!object || !isUuid(ownerId) || !ownsKey(ownerId, key) || object.customMetadata?.sharedUploaderId !== identity.id) return json({ error: "That shared upload isn't available." }, 404, origin);
        const references = await restRows(`vault_items?user_id=eq.${encodeURIComponent(ownerId)}&file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
        if (references.length) return json({ error: "That file is already attached to a document." }, 409, origin);
        await env.VAULT_FILES.delete(key);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/shares/upload" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to upload a shared file." }, 401, origin);
        if (!(await hasActivePaidUploadPlan(identity.id, env))) throw uploadPlanRequiredError();
        const share = await requireEditableShare(identity, url.searchParams.get("shareId") || "", env);
        const settings = await loadSettings(env);
        const maxFileBytes = Math.max(1, Math.min(MAX_CONFIGURABLE_UPLOAD_MB, Number(settings.storage.maxUploadMb) || 25)) * 1024 * 1024;
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > maxFileBytes) throw new HttpError(`Files must be between 1 byte and ${Math.floor(maxFileBytes / 1024 / 1024)} MB.`, 413);
        const usage = await userStorageUsage(share.owner_id, env.VAULT_FILES, env);
        if (usage.bytesUsed + file.size > usage.storageLimitBytes) throw new HttpError(`This file exceeds the original owner's ${usage.storageLimitGb} GB ${usage.planName} storage limit.`, 413);
        const safeName = sanitizeFileName(file.name);
        const key = `${share.owner_id}/${crypto.randomUUID()}-${safeName}`;
        await env.VAULT_FILES.put(key, file.stream(), { httpMetadata: { contentType: safeContentType(file.type) }, customMetadata: { ownerId: share.owner_id, originalName: safeName, createdAt: new Date().toISOString(), sharedUploaderId: identity.id } });
        return json({ key, name: file.name, size: file.size, type: safeContentType(file.type) }, 201, origin);
      }
      if (url.pathname === "/shares/comments" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        return json(await listShareComments(identity, url.searchParams.get("shareId") || "", env), 200, origin);
      }
      if (url.pathname === "/shares/comments" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const body = await readBody(request);
        return json(await addShareComment(identity, body, env), 201, origin);
      }
      if (url.pathname === "/notifications" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const rows = await restRows(`share_notifications?recipient_id=eq.${encodeURIComponent(identity.id)}&select=id,kind,item_title,actor_name,message,created_at,read_at&order=created_at.desc&limit=50`, env);
        return json(rows, 200, origin);
      }
      if (url.pathname === "/notifications" && request.method === "PATCH") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        const response = await supabaseAdminFetch(`/rest/v1/share_notifications?recipient_id=eq.${encodeURIComponent(identity.id)}&read_at=is.null`, env, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
        if (!response.ok) return upstreamError(response, origin);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/medical-records" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to access private medical records." }, 401, origin);
        const owner = encodeURIComponent(identity.id);
        const rows = await restRows(`medical_records?user_id=eq.${owner}&select=*&order=record_date.desc,updated_at.desc`, env);
        if (!rows.length) return json([], 200, origin);
        const ids = rows.map((row) => row.id).filter(isUuid);
        const links = ids.length ? await restRows(`medical_record_links?owner_id=eq.${owner}&medical_record_id=in.(${ids.join(",")})&select=medical_record_id,record_type,record_id,link_kind&order=created_at.asc`, env) : [];
        const byRecord = new Map();
        for (const link of links) { const key = link.medical_record_id; byRecord.set(key, [...(byRecord.get(key) || []), link]); }
        return json(rows.map((row) => ({ ...row, links: byRecord.get(row.id) || [] })), 200, origin);
      }
      if (url.pathname === "/medical-records" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to access private medical records." }, 401, origin);
        return json(await saveMedicalRecord(identity, await readBody(request), env), 200, origin);
      }
      if (url.pathname === "/medical-records" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to access private medical records." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id)) return json({ error: "Choose a valid medical record." }, 400, origin);
        await removeMedicalRecord(identity, id, env);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/medical-records/upload" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to upload a private medical file." }, 401, origin);
        if (!(await hasActivePaidUploadPlan(identity.id, env))) throw uploadPlanRequiredError();
        const settings = await loadSettings(env);
        const maxFileBytes = Math.max(1, Math.min(MAX_CONFIGURABLE_UPLOAD_MB, Number(settings.storage.maxUploadMb) || 25)) * 1024 * 1024;
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > maxFileBytes + 1024 * 1024) return json({ error: `Files must be ${Math.floor(maxFileBytes / 1024 / 1024)} MB or smaller.` }, 413, origin);
        const form = await request.formData(); const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "Choose a medical record file to upload." }, 400, origin);
        if (!file.size || file.size > maxFileBytes) return json({ error: `Files must be between 1 byte and ${Math.floor(maxFileBytes / 1024 / 1024)} MB.` }, 413, origin);
        if (!env.VAULT_FILES) throw new HttpError("Private file storage is not configured.", 503);
        const usage = await userStorageUsage(identity.id, env.VAULT_FILES, env);
        if (usage.bytesUsed + file.size > usage.storageLimitBytes) return json({ error: `This file exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit.` }, 413, origin);
        const safeName = sanitizeFileName(file.name); const key = `${identity.id}/${crypto.randomUUID()}-${safeName}`;
        const contentType = safeContentType(file.type);
        await env.VAULT_FILES.put(key, file.stream(), { httpMetadata: { contentType }, customMetadata: { ownerId: identity.id, originalName: safeName, createdAt: new Date().toISOString(), medicalRecordUpload: "true" } });
        return json({ key, name: file.name, size: file.size, type: contentType }, 201, origin);
      }
      if (url.pathname === "/medical-records/upload" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to remove a private medical file." }, 401, origin);
        const key = url.searchParams.get("key") || "";
        if (!ownsKey(identity.id, key) || !env.VAULT_FILES) return json({ error: "That upload isn't available." }, 404, origin);
        const object = await env.VAULT_FILES.get(key);
        if (!object || object.customMetadata?.ownerId !== identity.id || object.customMetadata?.medicalRecordUpload !== "true") return json({ error: "That upload isn't available." }, 404, origin);
        const references = await restRows(`medical_records?user_id=eq.${encodeURIComponent(identity.id)}&file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
        if (references.length) return json({ error: "This file is attached to a medical record and cannot be removed as an upload." }, 409, origin);
        await env.VAULT_FILES.delete(key);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/medical-records/file" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to open a private medical file." }, 401, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id) || !env.VAULT_FILES) return json({ error: "That medical file isn't available." }, 404, origin);
        const rows = await restRows(`medical_records?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&select=file_key,file_name,file_type&limit=1`, env);
        const row = rows[0]; const key = row?.file_key || "";
        if (!row || !ownsKey(identity.id, key)) return json({ error: "That medical file isn't available." }, 404, origin);
        const object = await env.VAULT_FILES.get(key);
        if (!object || object.customMetadata?.ownerId !== identity.id || object.customMetadata?.medicalRecordUpload !== "true") return json({ error: "That medical file isn't available." }, 404, origin);
        const name = row.file_name || object.customMetadata?.originalName || "medical-record";
        return new Response(object.body, { status: 200, headers: { "Content-Type": safeContentType(row.file_type || object.httpMetadata?.contentType || "application/octet-stream"), "Content-Length": String(object.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "X-File-Name": encodeURIComponent(name), "Cache-Control": "private, no-store, max-age=0", ...corsHeaders(origin) } });
      }
      if (url.pathname === "/timeline" || url.pathname.startsWith("/timeline/")) {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to access your private timeline." }, 401, origin);
        if (url.pathname === "/timeline/attachment" && request.method === "POST" && !(await hasActivePaidUploadPlan(identity.id, env))) throw uploadPlanRequiredError();
        const timelineSettings = url.pathname === "/timeline/attachment" && request.method === "POST" ? await loadSettings(env) : null;
        return await handleTimeline(request, identity, env, origin, userStorageUsage, timelineSettings?.storage.maxUploadMb);
      }
      if (url.pathname === "/upload" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to upload a private file." }, 401, origin);
        if (!(await hasActivePaidUploadPlan(identity.id, env))) throw uploadPlanRequiredError();
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
        const object = await env.VAULT_FILES.get(key);
        const ownerId = object?.customMetadata?.ownerId || "";
        if (!object || !isUuid(ownerId) || !ownsKey(ownerId, key)) return json({ error: "That file isn't available in your vault." }, 404, origin);
        if (ownerId !== identity.id) {
          const ownerItems = await restRows(`vault_items?user_id=eq.${encodeURIComponent(ownerId)}&file_key=eq.${encodeURIComponent(key)}&select=id`, env);
          let authorizedShare = false;
          for (const row of ownerItems) {
            const matching = await restRows(`vault_shares?item_id=eq.${encodeURIComponent(row.id)}&owner_id=eq.${encodeURIComponent(ownerId)}&recipient_id=eq.${encodeURIComponent(identity.id)}&select=id&limit=1`, env);
            if (matching.length) { authorizedShare = true; break; }
          }
          if (!authorizedShare) return json({ error: "That file isn't available in your vault." }, 404, origin);
        }
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

      if (url.pathname === "/alarm-ringtones" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in to view available alarm sounds." }, 401, origin);
        const settings = await loadSettings(env);
        return json(settings.alarmRingtones.map(publicAlarmRingtone), 200, origin);
      }
      const ringtoneAudioMatch = url.pathname.match(/^\/alarm-ringtones\/([0-9a-f-]{36})\/audio$/i);
      if (ringtoneAudioMatch && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in to play this alarm sound." }, 401, origin);
        const settings = await loadSettings(env);
        const ringtone = settings.alarmRingtones.find((entry) => entry.id === ringtoneAudioMatch[1]);
        if (!ringtone) return json({ error: "This alarm sound is no longer available." }, 404, origin);
        const object = await env.VAULT_FILES.get(ringtone.fileKey);
        if (!object || object.customMetadata?.ringtoneId !== ringtone.id) return json({ error: "This alarm sound could not be loaded." }, 404, origin);
        return new Response(object.body, { status: 200, headers: { "Content-Type": ringtone.type, "Content-Length": String(ringtone.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...corsHeaders(origin) } });
      }
      if (url.pathname === "/admin/alarm-ringtones" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > MAX_ALARM_RINGTONE_BYTES + 128 * 1024) return json({ error: "Ringtone files must be 10 MB or smaller." }, 413, origin);
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size) return json({ error: "Choose an audio file to upload." }, 400, origin);
        if (file.size > MAX_ALARM_RINGTONE_BYTES) return json({ error: "Ringtone files must be 10 MB or smaller." }, 413, origin);
        const extension = String(file.name || "").split(".").pop().toLowerCase();
        const format = Object.prototype.hasOwnProperty.call(ALARM_RINGTONE_FORMATS, extension) ? ALARM_RINGTONE_FORMATS[extension] : null;
        const providedType = String(file.type || "").toLowerCase();
        if (!format || (providedType && !format.accepted.includes(providedType))) throw new HttpError("Upload an MP3, WAV, OGG, M4A, AAC, or WebM audio file.", 415);
        const name = String(form.get("name") || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
        if (name.length < 2 || name.length > 80) throw new HttpError("Ringtone name must be 2–80 characters.", 400);
        const settings = await loadSettings(env);
        if (settings.alarmRingtones.length >= MAX_ALARM_RINGTONE_COUNT) throw new HttpError(`You can upload up to ${MAX_ALARM_RINGTONE_COUNT} ringtones.`, 409);
        const id = crypto.randomUUID();
        const fileKey = `system/ringtones/${id}.${extension}`;
        await env.VAULT_FILES.put(fileKey, file.stream(), { httpMetadata: { contentType: format.contentType }, customMetadata: { kind: "alarm-ringtone", ringtoneId: id, originalName: sanitizeFileName(file.name), uploadedBy: identity.id, createdAt: new Date().toISOString() } });
        const ringtone = { id, name, type: format.contentType, size: file.size, fileKey };
        try { await savePlatformSetting("alarm_ringtones", [...settings.alarmRingtones, ringtone], identity.id, env); }
        catch (error) { try { await env.VAULT_FILES.delete(fileKey); } catch { /* Asset cleanup can be retried. */ } throw error; }
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "manage_alarm_ringtone", env, { action: "upload", ringtone_id: id, ringtone_name: name });
        return json(publicAlarmRingtone(ringtone), 201, origin);
      }
      if (url.pathname === "/admin/alarm-ringtones" && request.method === "DELETE") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const id = url.searchParams.get("id") || "";
        if (!isUuid(id)) return json({ error: "Choose a valid ringtone." }, 400, origin);
        const settings = await loadSettings(env);
        const target = settings.alarmRingtones.find((entry) => entry.id === id);
        if (!target) return json({ error: "This ringtone is already unavailable." }, 404, origin);
        await savePlatformSetting("alarm_ringtones", settings.alarmRingtones.filter((entry) => entry.id !== id), identity.id, env);
        await env.VAULT_FILES.delete(target.fileKey);
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "manage_alarm_ringtone", env, { action: "delete", ringtone_id: id, ringtone_name: target.name });
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/admin/console" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        return json(await loadAdminConsole(env), 200, origin);
      }
      if (url.pathname === "/admin/smart-scan/access" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        if (typeof body.enabled !== "boolean") return json({ error: "Choose whether Smart Scan is enabled." }, 400, origin);
        if (body.scope === "global") {
          await savePlatformSetting("smart_scan", { enabled: body.enabled }, identity.id, env);
          await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "control_smart_scan", env, { scope: "global", enabled: body.enabled });
          return json({ ok: true, scope: "global", enabled: body.enabled }, 200, origin);
        }
        const targetId = typeof body.userId === "string" ? body.userId : "";
        if (body.scope !== "user" || !isUuid(targetId)) return json({ error: "Choose a valid account or the global setting." }, 400, origin);
        const target = await getProfile(targetId, env);
        if (!target) return json({ error: "That account could not be found." }, 404, origin);
        const updated = await supabaseAdminFetch("/rest/v1/smart_scan_usage?on_conflict=user_id", env, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ user_id: targetId, enabled: body.enabled }),
        });
        if (!updated.ok) throw new HttpError("Smart Scan controls are unavailable. Apply the Smart Scan admin migration, then retry.", 503);
        await logAdminEvent(identity, target, "control_smart_scan", env, { scope: "user", enabled: body.enabled });
        return json({ ok: true, scope: "user", userId: targetId, enabled: body.enabled }, 200, origin);
      }
      if (url.pathname === "/admin/email/test" && request.method === "POST") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required." }, 401, origin);
        if (!(await isAdministrator(identity.id, env))) return json({ error: "Administrator access is required." }, 403, origin);
        const body = await readBody(request);
        const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
        if (!isValidEmailAddress(to)) throw new HttpError("Enter a valid recipient email address.", 400);
        const settings = await loadSettings(env);
        const result = await sendBrevoEmail(env, settings.email, {
          to,
          subject: "Persora email delivery test",
          textContent: "This is a test message from your Persora admin email settings. If you received it, Brevo delivery is working.",
          htmlContent: "<div style=\"font-family:Arial,sans-serif;color:#182230;max-width:520px;margin:24px auto;padding:28px;border:1px solid #e5e7eb;border-radius:16px\"><h2>Persora email test</h2><p>If you received this message, Brevo transactional email delivery is working.</p></div>",
        });
        await logAdminEvent(identity, { id: identity.id, email: identity.email || "" }, "test_email_delivery", env, { provider: "brevo" }).catch((error) => console.error("Persora could not log email test", safeError(error)));
        return json({ ok: true, messageId: result.messageId }, 200, origin);
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
      if (url.pathname === "/account/export" && request.method === "GET") {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: "Sign in is required to export account data." }, 401, origin);
        const exported = await createAccountExport(identity, env);
        return new Response(exported.stream, { status: 200, headers: { "Content-Type": "application/x-tar", "Content-Disposition": `attachment; filename="${exported.filename}"`, "Cache-Control": "no-store", ...corsHeaders(origin) } });
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
const VALID_SECTIONS = new Set(["documents", "academics", "subscriptions", "family", "purchases", "accounts", "memberships", "wallet-cards", "study", "business-card", "urls", "notes", "personal-finance"]);
const VALID_FOLDER_SCOPES = new Set([...VALID_SECTIONS, "contacts", "business-cards", "medical-records"]);
const VALID_FOLDER_COLORS = new Set(["blue", "sky", "teal", "violet", "amber", "rose", "slate", "mint"]);
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
async function publicUser(profile, env) {
  const uploadAccess = await getUploadEntitlement(profile.id, env);
  return {
    id: String(profile.id),
    userId: String(profile.login_id || ""),
    email: String(profile.email || ""),
    fullName: String(profile.full_name || "Persora member"),
    role: profile.role === "admin" ? "admin" : "user",
    timezone: String(profile.timezone || "Asia/Dhaka"),
    avatarUrl: String(profile.avatar_url || ""),
    emailVerified: Boolean(profile.email_verified_at),
    uploadsEnabled: uploadAccess.uploadsEnabled,
    demo: false,
  };
}
const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const EMAIL_VERIFICATION_RESEND_MS = 60 * 1000;
const EMAIL_VERIFICATION_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_MAX_SENDS = 5;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
async function verificationCodeHash(identity, code, env) {
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!secret) throw new HttpError("Email verification is not configured. Please contact Persora support.", 503);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const email = String(identity.email || "").trim().toLowerCase();
  const message = `persora-email-verification-v1|${identity.id}|${email}|${code}`;
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}
function secureSixDigitCode() {
  const range = 900_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return String(100_000 + (sample[0] % range));
}
function secureEmailVerificationError() {
  return new HttpError("Persora couldn't send the verification email. Please try again later.", 502);
}
async function callEmailVerificationRpc(functionName, args, env) {
  let response;
  try {
    response = await supabaseAdminFetch(`/rest/v1/rpc/${functionName}`, env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (error) {
    console.error("Persora email verification database request failed", safeError(error));
    throw new HttpError("Email verification is temporarily unavailable. Please try again later.", 503);
  }
  if (!response.ok) {
    console.error("Persora email verification database function failed", functionName, response.status);
    throw new HttpError("Email verification is temporarily unavailable. Please try again later.", 503);
  }
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object") {
    console.error("Persora email verification database function returned an invalid result", functionName);
    throw new HttpError("Email verification is temporarily unavailable. Please try again later.", 503);
  }
  return result[0];
}
async function invalidateEmailVerificationCode(userId, codeHash, now, env) {
  const response = await supabaseAdminFetch("/rest/v1/rpc/invalidate_email_verification_code", env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_user_id: userId, p_code_hash: codeHash, p_now: now }),
  });
  if (!response.ok) console.error("Persora could not invalidate an undelivered email verification code", response.status);
}
function isValidEmailAddress(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function brevoEmailConfiguration(env, settings) {
  const apiKey = String(env.BREVO_API_KEY || "").trim();
  if (!apiKey) throw new HttpError("Brevo email is not configured. Ask an administrator to add BREVO_API_KEY as an encrypted Cloudflare Pages secret, then redeploy.", 503);
  const senderEmail = String(settings?.senderEmail || "").trim().toLowerCase();
  if (!isValidEmailAddress(senderEmail)) throw new HttpError("Set a valid, verified sender email in Admin → Email settings before sending.", 503);
  const senderName = String(settings?.senderName || "Persora").trim().slice(0, 70) || "Persora";
  const replyToEmail = String(settings?.replyToEmail || "").trim().toLowerCase();
  if (replyToEmail && !isValidEmailAddress(replyToEmail)) throw new HttpError("The Admin → Email settings reply-to address is invalid.", 503);
  const replyToName = String(settings?.replyToName || "").trim().slice(0, 70);
  return {
    apiKey,
    sender: { email: senderEmail, name: senderName },
    ...(replyToEmail ? { replyTo: { email: replyToEmail, ...(replyToName ? { name: replyToName } : {}) } } : {}),
  };
}
async function sendBrevoEmail(env, settings, { to, toName, subject, textContent, htmlContent }) {
  const config = brevoEmailConfiguration(env, settings);
  if (!isValidEmailAddress(String(to || "").trim())) throw new HttpError("Enter a valid recipient email address.", 400);
  const body = {
    sender: config.sender,
    to: [{ email: String(to).trim(), ...(toName ? { name: String(toName).slice(0, 100) } : {}) }],
    subject: String(subject || "").slice(0, 200),
    textContent: String(textContent || "").slice(0, 10000),
    htmlContent: String(htmlContent || "").slice(0, 20000),
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
  };
  let response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("Persora could not reach Brevo transactional email", safeError(error));
    throw new HttpError("Brevo email delivery could not be reached. Please try again later.", 502);
  }
  if (!response.ok) {
    let providerCode = "";
    try { const result = await response.json(); providerCode = typeof result?.code === "string" ? result.code.slice(0, 80) : ""; } catch { /* provider may return non-JSON */ }
    console.error("Brevo rejected a transactional email", response.status, providerCode);
    throw new HttpError(`Brevo rejected the email (HTTP ${response.status}). Verify the sender domain and transactional-email permission on the API key.`, 502);
  }
  let result = {};
  try { result = await response.json(); } catch { /* Brevo may return an empty success response */ }
  return { messageId: typeof result?.messageId === "string" ? result.messageId : "" };
}
async function sendEmailVerificationCode(identity, env) {
  if (identity.email_verified_at) return { ok: true, alreadyVerified: true };
  const email = String(identity.email || "").trim().toLowerCase();
  if (!email) throw new HttpError("This account has no registered email address to verify.", 400);
  const settings = await loadSettings(env);
  if (settings.email.verificationEnabled !== true) throw new HttpError("Email verification is currently disabled by the Persora administrator.", 403);
  // Fail before reserving an OTP so a missing Cloudflare secret or sender setting never consumes a send attempt.
  brevoEmailConfiguration(env, settings.email);

  const now = new Date();
  const nowIso = now.toISOString();
  const code = secureSixDigitCode();
  const codeHash = await verificationCodeHash(identity, code, env);
  const reservation = await callEmailVerificationRpc("reserve_email_verification_send", {
    p_user_id: identity.id,
    p_email: email,
    p_code_hash: codeHash,
    p_now: nowIso,
    p_expires_at: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS).toISOString(),
    p_resend_seconds: EMAIL_VERIFICATION_RESEND_MS / 1000,
    p_window_seconds: EMAIL_VERIFICATION_WINDOW_MS / 1000,
    p_max_sends: EMAIL_VERIFICATION_MAX_SENDS,
  }, env);
  if (reservation.allowed !== true) {
    if (reservation.reason === "already_verified") return { ok: true, alreadyVerified: true };
    if (reservation.reason === "email_changed") throw new HttpError("The registered email changed. Refresh your profile and request a new verification code.", 409);
    if (reservation.reason === "resend") {
      const seconds = Math.max(1, Number(reservation.retry_after_seconds) || 60);
      throw new HttpError(`Please wait ${seconds} seconds before requesting another verification code.`, 429);
    }
    if (reservation.reason === "hourly_limit") throw new HttpError("Too many verification emails were requested. Try again in an hour.", 429);
    throw new HttpError("Email verification is temporarily unavailable. Please try again later.", 503);
  }

  try {
    await sendBrevoEmail(env, settings.email, {
      to: email,
      subject: "Your Persora email verification code",
      textContent: `Your Persora verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      htmlContent: `<div style="font-family:Arial,sans-serif;color:#182230;max-width:520px;margin:24px auto;padding:28px;border:1px solid #e5e7eb;border-radius:16px"><h2 style="margin:0 0 12px">Verify your Persora email</h2><p>Enter this one-time code in Persora Settings:</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#1877f2">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
    });
  } catch (error) {
    await invalidateEmailVerificationCode(identity.id, codeHash, nowIso, env).catch(() => {});
    console.error("Persora Brevo email delivery failed", safeError(error));
    throw secureEmailVerificationError();
  }
  return { ok: true, expiresInSeconds: EMAIL_VERIFICATION_TTL_MS / 1000 };
}
async function verifyEmailVerificationCode(identity, body, env) {
  if (identity.email_verified_at) return { ok: true, user: await publicUser(identity, env) };
  const settings = await loadSettings(env);
  if (settings.email.verificationEnabled !== true) throw new HttpError("Email verification is currently disabled by the Persora administrator.", 403);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new HttpError("Enter the six-digit code from your verification email.", 400);
  const candidateHash = await verificationCodeHash(identity, code, env);
  const result = await callEmailVerificationRpc("complete_email_verification", {
    p_user_id: identity.id,
    p_email: String(identity.email || "").trim().toLowerCase(),
    p_candidate_hash: candidateHash,
    p_now: new Date().toISOString(),
    p_max_attempts: EMAIL_VERIFICATION_MAX_ATTEMPTS,
  }, env);
  switch (result.outcome) {
    case "verified":
    case "already_verified": {
      const verifiedAt = result.verified_at || new Date().toISOString();
      return { ok: true, user: await publicUser({ ...identity, email_verified_at: verifiedAt }, env) };
    }
    case "email_changed": throw new HttpError("The registered email changed. Request a new verification code.", 409);
    case "expired": throw new HttpError("That code has expired. Request a new verification code.", 400);
    case "too_many_attempts": throw new HttpError("Too many incorrect attempts. Request a new verification code.", 429);
    case "mismatch": throw new HttpError("That code doesn't match. Check the email and try again.", 400);
    case "missing": throw new HttpError("Request a new verification code before trying again.", 400);
    default:
      console.error("Persora email verification returned an unknown result", result.outcome);
      throw new HttpError("Email verification is temporarily unavailable. Please try again later.", 503);
  }
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
async function isSmartScanEnabled(userId, env) {
  try {
    const [settings, userRows] = await Promise.all([
      loadSettings(env),
      restRows(`smart_scan_usage?user_id=eq.${encodeURIComponent(userId)}&select=enabled&limit=1`, env),
    ]);
    return settings.smartScan.enabled !== false && userRows?.[0]?.enabled !== false;
  } catch (error) {
    console.error("Persora could not verify Smart Scan access controls", safeError(error));
    throw new HttpError("Smart Scan access controls are temporarily unavailable. Please try again later.", 503);
  }
}
async function recordSmartScanUsage(userId, { scans = 0, ocrRuns = 0, aiExtractions = 0 } = {}, env) {
  try {
    const response = await supabaseAdminFetch("/rest/v1/rpc/persora_record_smart_scan_usage", env, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: userId, p_scans: scans, p_ocr_runs: ocrRuns, p_ai_extractions: aiExtractions }),
    });
    if (!response.ok) console.error("Persora could not record Smart Scan usage", response.status);
  } catch (error) {
    // Usage analytics must never interrupt an otherwise valid private scan.
    console.error("Persora could not record Smart Scan usage", safeError(error));
  }
}
const SMART_SCAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
async function loadSmartScanCache(ownerId, contentHash, env) {
  const now = encodeURIComponent(new Date().toISOString());
  const rows = await restRows(`smart_scan_cache?owner_id=eq.${encodeURIComponent(ownerId)}&content_sha256=eq.${contentHash}&expires_at=gt.${now}&select=payload&limit=1`, env);
  return rows[0]?.payload && typeof rows[0].payload === "object" ? rows[0].payload : null;
}
async function storeSmartScanCache(ownerId, contentHash, payload, env) {
  const now = new Date().toISOString();
  await supabaseAdminFetch(`/rest/v1/smart_scan_cache?expires_at=lt.${encodeURIComponent(now)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
  const response = await supabaseAdminFetch("/rest/v1/smart_scan_cache?on_conflict=owner_id%2Ccontent_sha256", env, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ owner_id: ownerId, content_sha256: contentHash, payload, created_at: now, expires_at: new Date(Date.now() + SMART_SCAN_CACHE_TTL_MS).toISOString() }),
  });
  if (!response.ok) throw new Error(`Smart Scan cache write failed (${response.status}).`);
}
async function restRowsPaged(path, env, pageSize = 1000) {
  const result = [];
  for (let start = 0; ; start += pageSize) {
    const response = await supabaseAdminFetch(`/rest/v1/${path}`, env, { headers: { Range: `${start}-${start + pageSize - 1}`, Prefer: "count=exact" } });
    if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("The database returned an invalid record list.");
    result.push(...page);
    if (page.length < pageSize) break;
  }
  return result;
}
async function readUserDatabaseUsage(userId, env) {
  const owner = encodeURIComponent(userId);
  const paths = [
    `vault_items?user_id=eq.${owner}&select=*&order=id.asc`,
    `contacts?user_id=eq.${owner}&select=*&order=id.asc`,
    `business_cards?user_id=eq.${owner}&select=*&order=id.asc`,
    `timeline_events?user_id=eq.${owner}&select=*&order=id.asc`,
    `timeline_event_links?owner_id=eq.${owner}&select=*&order=event_id.asc`,
    `medical_records?user_id=eq.${owner}&select=*&order=id.asc`,
    `medical_record_links?owner_id=eq.${owner}&select=*&order=medical_record_id.asc`,
  ];
  const tables = await Promise.all(paths.map((path) => restRowsPaged(path, env)));
  const encoder = new TextEncoder();
  let bytes = 0; let records = 0;
  for (const rows of tables) for (const row of rows) { bytes += encoder.encode(JSON.stringify(row)).byteLength; records++; }
  return { bytes, records };
}
async function summarizeDatabase(env) {
  const paths = ["vault_items?select=*&order=id.asc", "contacts?select=*&order=id.asc", "business_cards?select=*&order=id.asc", "timeline_events?select=*&order=id.asc", "timeline_event_links?select=*&order=event_id.asc", "medical_records?select=*&order=id.asc", "medical_record_links?select=*&order=medical_record_id.asc"];
  const tables = await Promise.all(paths.map((path) => restRowsPaged(path, env)));
  const byUser = {}; const encoder = new TextEncoder(); let bytesUsed = 0; let recordCount = 0;
  for (const rows of tables) for (const row of rows) {
    const bytes = encoder.encode(JSON.stringify(row)).byteLength; bytesUsed += bytes; recordCount++;
    const ownerId = isUuid(row.user_id) ? row.user_id : isUuid(row.owner_id) ? row.owner_id : "";
    if (ownerId) { byUser[ownerId] ||= { bytes: 0, records: 0 }; byUser[ownerId].bytes += bytes; byUser[ownerId].records++; }
  }
  return { bytesUsed, recordCount, byUser };
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
  const profiles = await restRows(`profiles?id=eq.${encodeURIComponent(sessions[0].user_id)}&select=id,login_id,email,full_name,role,account_status,timezone,avatar_url,email_verified_at`, env);
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
async function ensureActiveFreePlan(env) {
  const path = "subscription_plans?slug=eq.free&select=id,slug,storage_gb,active&limit=1";
  let rows = await restRows(path, env);
  let plan = rows[0];
  if (plan?.active === true) return plan;

  if (plan) {
    const response = await supabaseAdminFetch(`/rest/v1/subscription_plans?id=eq.${encodeURIComponent(plan.id)}`, env, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ active: true }),
    });
    if (!response.ok) {
      console.error("Persora could not reactivate the default Free plan", response.status);
      throw new HttpError("The Free plan is currently unavailable. Please contact Persora support.", 503);
    }
    const updated = await response.json().catch(() => []);
    plan = Array.isArray(updated) ? updated[0] : updated;
    if (plan?.id && plan.active === true) return plan;
  } else {
    const response = await supabaseAdminFetch("/rest/v1/subscription_plans", env, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ slug: "free", name: "Free", description: "A private place to get started.", storage_gb: 5, price_per_gb_monthly: 0, active: true, sort_order: 0 }),
    });
    if (!response.ok && response.status !== 409) {
      console.error("Persora could not create the default Free plan", response.status);
      throw new HttpError("The Free plan could not be initialized. Please contact Persora support.", 503);
    }
    if (response.ok) {
      const created = await response.json().catch(() => []);
      plan = Array.isArray(created) ? created[0] : created;
      if (plan?.id && plan.active === true) return plan;
    }
  }

  // Another signup may have initialized the row between our read and insert.
  rows = await restRows("subscription_plans?slug=eq.free&active=eq.true&select=id,slug,storage_gb,active&limit=1", env);
  if (rows[0]) return rows[0];
  throw new HttpError("The Free plan is not configured. Please contact Persora support.", 503);
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
  const freePlan = await ensureActiveFreePlan(env);
  const hash = await hashPassword(password, env);
  let profile = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = {
      login_id: randomLoginId(), email, full_name: fullName,
      email_verified_at: null, password_hash: hash,
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
      body: JSON.stringify({ user_id: profile.id, plan_id: freePlan.id, status: "active", storage_limit_gb: Number(freePlan.storage_gb) }),
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
  const rows = await restRows(`profiles?${lookup}&select=id,login_id,email,full_name,role,account_status,timezone,avatar_url,email_verified_at,password_hash`, env);
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

const SHARE_PERMISSIONS = new Set(["view", "comment", "edit"]);
function shareProfile(profile) {
  return {
    id: String(profile.id),
    userId: String(profile.login_id || ""),
    email: String(profile.email || ""),
    fullName: String(profile.full_name || "Persora member"),
  };
}
async function profilesByIds(ids, env) {
  const unique = [...new Set(ids.filter(isUuid))];
  if (!unique.length) return [];
  return restRows(`profiles?id=in.(${unique.join(",")})&select=id,login_id,email,full_name`, env);
}
async function listRecordShares(identity, direction, env) {
  const field = direction === "outgoing" ? "owner_id" : "recipient_id";
  const rows = await restRows(`record_shares?${field}=eq.${encodeURIComponent(identity.id)}&select=id,resource_type,resource_id,owner_id,recipient_id,created_at&order=created_at.desc&limit=300`, env);
  if (!rows.length) return [];
  const contactIds = [...new Set(rows.filter((row) => row.resource_type === "contact").map((row) => row.resource_id).filter(isUuid))];
  const cardIds = [...new Set(rows.filter((row) => row.resource_type === "business_card").map((row) => row.resource_id).filter(isUuid))];
  const userIds = [...new Set(rows.flatMap((row) => [row.owner_id, row.recipient_id]).filter(isUuid))];
  const [contactRows, cardRows, profileRows] = await Promise.all([
    contactIds.length ? restRows(`contacts?id=in.(${contactIds.join(",")})&select=*`, env) : Promise.resolve([]),
    cardIds.length ? restRows(`business_cards?id=in.(${cardIds.join(",")})&select=*`, env) : Promise.resolve([]),
    profilesByIds(userIds, env),
  ]);
  const contacts = new Map(contactRows.map((row) => [row.id, row]));
  const cards = new Map(cardRows.map((row) => [row.id, row]));
  const profiles = new Map(profileRows.map((row) => [row.id, shareProfile(row)]));
  return rows.flatMap((share) => {
    const owner = profiles.get(share.owner_id), recipient = profiles.get(share.recipient_id);
    if (!owner || !recipient) return [];
    const source = share.resource_type === "contact" ? contacts.get(share.resource_id) : cards.get(share.resource_id);
    if (!source || source.user_id !== share.owner_id) return [];
    const record = share.resource_type === "contact" ? {
      id: source.id, full_name: source.full_name, phone_numbers: source.phone_numbers, email: source.email,
      company: source.company, job_title: source.job_title, address: source.address, birthday: source.birthday,
      notes: source.notes, category: source.category, favorite: source.favorite,
      created_at: source.created_at, updated_at: source.updated_at,
    } : {
      id: source.id, full_name: source.full_name, job_title: source.job_title, company: source.company,
      phone_numbers: source.phone_numbers, email: source.email, websites: source.websites, social_links: source.social_links,
      address: source.address, bio: source.bio, custom_links: source.custom_links, card_style: source.card_style,
      created_at: source.created_at, updated_at: source.updated_at,
    };
    return [{ shareId: share.id, resourceType: share.resource_type, resourceId: share.resource_id, record, owner, recipient, direction, createdAt: share.created_at }];
  });
}
async function resolveShareRecipient(rawRecipient, ownerId, env) {
  const raw = typeof rawRecipient === "string" ? rawRecipient.trim() : "";
  let recipientRows = [];
  if (/^[0-9]{7}$/.test(raw)) {
    recipientRows = await restRows(`profiles?login_id=eq.${encodeURIComponent(raw)}&select=id,login_id,email,full_name,account_status`, env);
  } else {
    const email = raw.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Enter a registered email address or seven-digit Persora ID.");
    recipientRows = await restRows(`profiles?email=eq.${encodeURIComponent(email)}&select=id,login_id,email,full_name,account_status`, env);
  }
  const recipient = recipientRows[0];
  if (!recipient || recipient.account_status !== "active") throw new HttpError("No active Persora account matches that email or ID.", 404);
  if (recipient.id === ownerId) throw new HttpError("You already own this record.");
  return recipient;
}
async function createRecordShare(identity, body, env) {
  const resourceType = body.resourceType === "business_card" ? "business_card" : body.resourceType === "contact" ? "contact" : "";
  const resourceId = typeof body.resourceId === "string" ? body.resourceId : "";
  if (!resourceType || !isUuid(resourceId)) throw new HttpError("Choose a valid contact or business card to share.");
  const table = resourceType === "contact" ? "contacts" : "business_cards";
  const titleField = resourceType === "contact" ? "full_name" : "full_name";
  const recordRows = await restRows(`${table}?id=eq.${encodeURIComponent(resourceId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=id,${titleField}`, env);
  if (!recordRows[0]) throw new HttpError("That record isn't available in your account.", 404);
  const recipient = await resolveShareRecipient(body.recipient, identity.id, env);
  const duplicates = await restRows(`record_shares?resource_type=eq.${resourceType}&resource_id=eq.${encodeURIComponent(resourceId)}&recipient_id=eq.${encodeURIComponent(recipient.id)}&select=id&limit=1`, env);
  if (duplicates.length) throw new HttpError("This record is already shared with that account. Manage it in Shared documents.", 409);
  const response = await supabaseAdminFetch("/rest/v1/record_shares", env, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId, owner_id: identity.id, recipient_id: recipient.id }) });
  if (!response.ok) throw new HttpError("The record share could not be saved.", response.status >= 400 ? response.status : 502);
  const result = await response.json(); const share = Array.isArray(result) ? result[0] : result;
  const title = recordRows[0].full_name || (resourceType === "contact" ? "a contact" : "a business card");
  await writeShareNotification(recipient.id, identity.id, identity.full_name, title, "shared", `${identity.full_name} shared ${resourceType === "contact" ? "a contact" : "a business card"} with you.`, env);
  return { shareId: share.id, resourceType, resourceId, recipient: shareProfile(recipient) };
}
async function revokeRecordShare(identity, body, env) {
  const shareId = typeof body.shareId === "string" ? body.shareId : "";
  if (!isUuid(shareId)) throw new HttpError("Choose a valid share.");
  const rows = await restRows(`record_shares?id=eq.${encodeURIComponent(shareId)}&owner_id=eq.${encodeURIComponent(identity.id)}&select=*`, env);
  const share = rows[0];
  if (!share) throw new HttpError("That record share is no longer available.", 404);
  const response = await supabaseAdminFetch(`/rest/v1/record_shares?id=eq.${encodeURIComponent(share.id)}&owner_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!response.ok) throw new HttpError("The record share could not be removed.", response.status >= 400 ? response.status : 502);
  const recipients = await profilesByIds([share.recipient_id], env);
  if (recipients[0]) {
    const label = share.resource_type === "contact" ? "contact" : "business card";
    await writeShareNotification(share.recipient_id, identity.id, identity.full_name, `a shared ${label}`, "unshared", `${identity.full_name} stopped sharing a ${label} with you.`, env);
  }
  return { ok: true };
}
async function listShares(identity, direction, env) {
  const field = direction === "outgoing" ? "owner_id" : "recipient_id";
  const rows = await restRows(`vault_shares?${field}=eq.${encodeURIComponent(identity.id)}&select=id,item_id,owner_id,recipient_id,permission,created_at&order=created_at.desc`, env);
  if (!rows.length) return [];
  const itemIds = [...new Set(rows.map((row) => row.item_id).filter(isUuid))];
  const userIds = [...new Set(rows.flatMap((row) => [row.owner_id, row.recipient_id]).filter(isUuid))];
  const [itemRows, profileRows] = await Promise.all([
    restRows(`vault_items?id=in.(${itemIds.join(",")})&select=*`, env),
    profilesByIds(userIds, env),
  ]);
  const items = new Map(itemRows.map((row) => [row.id, row]));
  const profiles = new Map(profileRows.map((row) => [row.id, shareProfile(row)]));
  return rows.flatMap((row) => {
    const item = items.get(row.item_id), owner = profiles.get(row.owner_id), recipient = profiles.get(row.recipient_id);
    if (!item || item.user_id !== row.owner_id || !owner || !recipient || !SHARE_PERMISSIONS.has(row.permission)) return [];
    return [{ shareId: row.id, item, owner, recipient, permission: row.permission, createdAt: row.created_at, direction }];
  });
}
async function createShare(identity, body, env) {
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const rawRecipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
  const permission = typeof body.permission === "string" ? body.permission : "view";
  if (!isUuid(itemId)) throw new HttpError("Choose a valid document to share.");
  if (!SHARE_PERMISSIONS.has(permission)) throw new HttpError("Choose View, Comment, or Edit access.");
  const itemRows = await restRows(`vault_items?id=eq.${encodeURIComponent(itemId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=id,title`, env);
  if (!itemRows[0]) throw new HttpError("That document is not available in your vault.", 404);
  let recipientRows = [];
  if (/^[0-9]{7}$/.test(rawRecipient)) {
    recipientRows = await restRows(`profiles?login_id=eq.${encodeURIComponent(rawRecipient)}&select=id,login_id,email,full_name,account_status`, env);
  } else {
    const email = rawRecipient.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Enter a registered email address or seven-digit Persora ID.");
    recipientRows = await restRows(`profiles?email=eq.${encodeURIComponent(email)}&select=id,login_id,email,full_name,account_status`, env);
  }
  const recipient = recipientRows[0];
  if (!recipient || recipient.account_status !== "active") throw new HttpError("No active Persora account matches that email or ID.", 404);
  if (recipient.id === identity.id) throw new HttpError("You already own this document.");
  const existing = await restRows(`vault_shares?item_id=eq.${encodeURIComponent(itemId)}&recipient_id=eq.${encodeURIComponent(recipient.id)}&select=id`, env);
  if (existing.length) throw new HttpError("This document is already shared with that account. Update its access in Shared by me.", 409);
  const response = await supabaseAdminFetch("/rest/v1/vault_shares", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ item_id: itemId, owner_id: identity.id, recipient_id: recipient.id, permission }),
  });
  if (!response.ok) {
    if (response.status === 409) throw new HttpError("This document is already shared with that account.", 409);
    throw new HttpError("The database rejected that sharing change.", response.status >= 400 ? response.status : 502);
  }
  const result = await response.json();
  const share = Array.isArray(result) ? result[0] : result;
  await writeShareNotification(recipient.id, identity.id, identity.full_name, itemRows[0].title, "shared", `${identity.full_name} shared “${itemRows[0].title}” with you.`, env);
  return { shareId: share.id, itemId, recipient: shareProfile(recipient), permission: share.permission };
}
async function loadShareForOwner(identity, shareId, env) {
  if (!isUuid(shareId)) throw new HttpError("Choose a valid share.");
  const rows = await restRows(`vault_shares?id=eq.${encodeURIComponent(shareId)}&owner_id=eq.${encodeURIComponent(identity.id)}&select=*`, env);
  if (!rows[0]) throw new HttpError("That share is no longer available.", 404);
  return rows[0];
}
async function updateSharePermission(identity, body, env) {
  const shareId = typeof body.shareId === "string" ? body.shareId : "";
  const permission = typeof body.permission === "string" ? body.permission : "";
  if (!SHARE_PERMISSIONS.has(permission)) throw new HttpError("Choose View, Comment, or Edit access.");
  const share = await loadShareForOwner(identity, shareId, env);
  if (share.permission === permission) return { ok: true };
  const [itemRows, recipientRows] = await Promise.all([
    restRows(`vault_items?id=eq.${encodeURIComponent(share.item_id)}&user_id=eq.${encodeURIComponent(identity.id)}&select=title`, env),
    restRows(`profiles?id=eq.${encodeURIComponent(share.recipient_id)}&select=id`, env),
  ]);
  const response = await supabaseAdminFetch(`/rest/v1/vault_shares?id=eq.${encodeURIComponent(share.id)}&owner_id=eq.${encodeURIComponent(identity.id)}`, env, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ permission, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new HttpError("The database rejected that sharing change.", response.status >= 400 ? response.status : 502);
  const title = itemRows[0]?.title || "a shared document";
  if (recipientRows[0]) await writeShareNotification(share.recipient_id, identity.id, identity.full_name, title, "permission_changed", `${identity.full_name} changed your access to “${title}” to ${permissionLabel(permission)}.`, env);
  return { ok: true };
}
async function revokeShare(identity, shareIdValue, env) {
  const share = await loadShareForOwner(identity, typeof shareIdValue === "string" ? shareIdValue : "", env);
  const [itemRows, recipientRows] = await Promise.all([
    restRows(`vault_items?id=eq.${encodeURIComponent(share.item_id)}&user_id=eq.${encodeURIComponent(identity.id)}&select=title`, env),
    restRows(`profiles?id=eq.${encodeURIComponent(share.recipient_id)}&select=id`, env),
  ]);
  const response = await supabaseAdminFetch(`/rest/v1/vault_shares?id=eq.${encodeURIComponent(share.id)}&owner_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!response.ok) throw new HttpError("The database rejected that sharing change.", response.status >= 400 ? response.status : 502);
  const title = itemRows[0]?.title || "a shared document";
  if (recipientRows[0]) await writeShareNotification(share.recipient_id, identity.id, identity.full_name, title, "unshared", `${identity.full_name} stopped sharing “${title}” with you.`, env);
  return { ok: true };
}
async function requireEditableShare(identity, shareId, env) {
  if (!isUuid(shareId)) throw new HttpError("Choose a valid share.");
  const shares = await restRows(`vault_shares?id=eq.${encodeURIComponent(shareId)}&recipient_id=eq.${encodeURIComponent(identity.id)}&select=*`, env);
  const share = shares[0];
  if (!share) throw new HttpError("You no longer have access to this shared document.", 404);
  if (share.permission !== "edit") throw new HttpError("This share only allows viewing or commenting.", 403);
  const items = await restRows(`vault_items?id=eq.${encodeURIComponent(share.item_id)}&user_id=eq.${encodeURIComponent(share.owner_id)}&select=*`, env);
  if (!items[0]) throw new HttpError("The original document is no longer available.", 404);
  return { ...share, item: items[0] };
}
async function saveSharedVaultItem(identity, body, env) {
  const shareId = typeof body.shareId === "string" ? body.shareId : "";
  const share = await requireEditableShare(identity, shareId, env);
  const current = share.item;
  const id = typeof body.id === "string" ? body.id : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subtitle = typeof body.subtitle === "string" ? body.subtitle.trim() : "";
  const section = typeof body.section === "string" ? body.section : "";
  if (id !== current.id || section !== current.section) throw new HttpError("Shared document identity and type cannot be changed.", 403);
  if (!title || title.length > 240 || subtitle.length > 240) throw new HttpError("Enter a title and keep it under 240 characters.");
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata)).length;
  const entries = Object.entries(metadata);
  if (entries.length > 40 || metadataBytes > 20_000 || entries.some(([key, value]) => key.length > 80 || typeof value !== "string" || value.length > 5000)) throw new HttpError("Some item details are too long.");
  const file = body.file && typeof body.file === "object" ? body.file : null;
  const fileKey = typeof file?.key === "string" ? file.key : "";
  const fileName = typeof file?.name === "string" ? file.name.trim() : "";
  if (fileKey) {
    if (!ownsKey(share.owner_id, fileKey) || !fileName) throw new HttpError("That file is not available in the original owner's vault.", 403);
    const object = await env.VAULT_FILES.get(fileKey);
    if (!object || object.customMetadata?.ownerId !== share.owner_id) throw new HttpError("That file is not available in the original owner's vault.", 404);
    if (fileKey !== current.file_key && object.customMetadata?.sharedUploaderId !== identity.id) throw new HttpError("A shared editor can attach only files uploaded through this shared document.", 403);
  }
  const nextRow = {
    title, subtitle: subtitle || null, metadata,
    file_key: fileKey || null, file_name: fileKey ? fileName.slice(0, 240) : null,
    file_size: fileKey && Number.isFinite(Number(file.size)) ? Math.max(0, Number(file.size)) : null,
    file_type: fileKey ? safeContentType(file.type) : null,
    updated_at: new Date().toISOString(),
  };
  const response = await supabaseAdminFetch(`/rest/v1/vault_items?id=eq.${encodeURIComponent(current.id)}&user_id=eq.${encodeURIComponent(share.owner_id)}`, env, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(nextRow),
  });
  if (!response.ok) throw new HttpError("The database rejected that sharing change.", response.status >= 400 ? response.status : 502);
  const updatedRows = await response.json();
  const saved = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
  if (!saved) throw new HttpError("The original document could not be found.", 404);
  const oldKey = current.file_key || "";
  if (oldKey && oldKey !== fileKey && ownsKey(share.owner_id, oldKey)) {
    try { await env.VAULT_FILES.delete(oldKey); } catch (error) { console.error("Persora shared attachment cleanup pending", safeError(error)); }
  }
  return saved;
}
async function listShareComments(identity, shareId, env) {
  if (!isUuid(shareId)) throw new HttpError("Choose a valid shared document.");
  const shares = await restRows(`vault_shares?id=eq.${encodeURIComponent(shareId)}&select=id,owner_id,recipient_id`, env);
  const share = shares[0];
  if (!share || (share.owner_id !== identity.id && share.recipient_id !== identity.id)) throw new HttpError("You no longer have access to these comments.", 404);
  const rows = await restRows(`vault_share_comments?share_id=eq.${encodeURIComponent(share.id)}&select=id,share_id,author_id,author_name,body,created_at&order=created_at.asc&limit=200`, env);
  return rows.map((row) => ({ id: row.id, shareId: row.share_id, authorId: row.author_id, authorName: row.author_name, body: row.body, createdAt: row.created_at }));
}
async function addShareComment(identity, body, env) {
  const shareId = typeof body.shareId === "string" ? body.shareId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!isUuid(shareId) || !text || text.length > 5000) throw new HttpError("Write a comment up to 5,000 characters.");
  const shares = await restRows(`vault_shares?id=eq.${encodeURIComponent(shareId)}&select=id,owner_id,recipient_id,permission`, env);
  const share = shares[0];
  if (!share || (share.owner_id !== identity.id && share.recipient_id !== identity.id)) throw new HttpError("You no longer have access to this shared document.", 404);
  if (share.recipient_id === identity.id && !["comment", "edit"].includes(share.permission)) throw new HttpError("Your access level doesn't allow comments.", 403);
  const response = await supabaseAdminFetch("/rest/v1/vault_share_comments", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ share_id: share.id, author_id: identity.id, author_name: identity.full_name, body: text }),
  });
  if (!response.ok) throw new HttpError("The database rejected that sharing change.", response.status >= 400 ? response.status : 502);
  const result = await response.json();
  const row = Array.isArray(result) ? result[0] : result;
  return { id: row.id, shareId: row.share_id, authorId: row.author_id, authorName: row.author_name, body: row.body, createdAt: row.created_at };
}
async function writeShareNotification(recipientId, actorId, actorName, itemTitle, kind, message, env) {
  const response = await supabaseAdminFetch("/rest/v1/share_notifications", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ recipient_id: recipientId, actor_id: actorId, actor_name: actorName || "A Persora user", item_title: itemTitle, kind, message }),
  });
  if (!response.ok) console.error("Persora could not save a share notification", response.status);
}
function permissionLabel(permission) { return permission === "edit" ? "Edit" : permission === "comment" ? "Comment" : "View"; }

const BUSINESS_SOCIAL_PLATFORMS = new Set(["Facebook", "Instagram", "LinkedIn", "X", "YouTube", "TikTok", "WhatsApp", "Telegram", "GitHub", "Pinterest"]);
const BUSINESS_CARD_STYLES = new Set(["garden", "minimal", "midnight", "terracotta"]);
const BUSINESS_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
function securePublicCardId() { return randomHex(16).toUpperCase(); }
async function getPublicBusinessCard(cardId, env) {
  if (!/^[A-F0-9]{32}$/i.test(cardId)) return null;
  const rows = await restRows(`business_cards?card_id=eq.${encodeURIComponent(cardId.toUpperCase())}&is_public=eq.true&select=*`, env);
  return rows[0] || null;
}
function publicBusinessCardPayload(row, cardId) {
  return {
    card_id: cardId.toUpperCase(), is_public: true, card_style: BUSINESS_CARD_STYLES.has(row.card_style) ? row.card_style : "garden", full_name: row.full_name, job_title: row.job_title, company: row.company,
    phone_numbers: row.phone_numbers, email: row.email, websites: row.websites, social_links: row.social_links,
    address: row.address, bio: row.bio, custom_links: row.custom_links,
    ...(row.profile_photo_key ? { profilePhotoUrl: `/api/public-cards/${cardId.toUpperCase()}/photo?kind=profile` } : {}),
    ...(row.business_logo_key ? { businessLogoUrl: `/api/public-cards/${cardId.toUpperCase()}/photo?kind=logo` } : {}),
  };
}
function cleanBusinessUrl(value, field) {
  const text = String(value || "").trim();
  if (!text) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let parsed;
  try { parsed = new URL(withProtocol); } catch { throw new HttpError(`${field} must be a valid website URL.`); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || text.length > 500) throw new HttpError(`${field} must be a valid HTTP or HTTPS URL.`);
  return parsed.href;
}
async function validateBusinessPhoto(identity, key, env) {
  if (!key) return "";
  if (!ownsKey(identity.id, key)) throw new HttpError("That business card image is not in your account.", 403);
  const object = await env.VAULT_FILES.get(key);
  const contentType = String(object?.httpMetadata?.contentType || "").toLowerCase();
  if (!object || object.customMetadata?.ownerId !== identity.id || !BUSINESS_PHOTO_TYPES.has(contentType)) throw new HttpError("Choose a JPG, PNG, WEBP, or GIF image uploaded to your account.");
  return key;
}
async function saveBusinessCard(identity, body, env) {
  const requestedId = typeof body.id === "string" ? body.id : "";
  if (requestedId && !isUuid(requestedId)) throw new HttpError("Choose a valid business card.");
  const existingRows = requestedId ? await restRows(`business_cards?id=eq.${encodeURIComponent(requestedId)}&select=*`, env) : [];
  const existing = existingRows[0];
  if (existing && existing.user_id !== identity.id) throw new HttpError("That business card belongs to another account.", 403);
  const fullName = validateContactText(body.fullName, "Full name", 160);
  if (!fullName) throw new HttpError("Full name is required.");
  const jobTitle = validateContactText(typeof body.jobTitle === "string" ? body.jobTitle : "", "Job title", 160);
  const company = validateContactText(typeof body.company === "string" ? body.company : "", "Company", 160);
  const email = validateContactText(typeof body.email === "string" ? body.email : "", "Email", 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Enter a valid email address.");
  const address = validateContactText(typeof body.address === "string" ? body.address : "", "Address", 1200);
  const bio = validateContactText(typeof body.bio === "string" ? body.bio : "", "About", 1200);
  const sourcePhones = Array.isArray(body.phoneNumbers) ? body.phoneNumbers : [];
  if (sourcePhones.length > 20) throw new HttpError("A card can have up to 20 phone numbers.");
  const phoneNumbers = sourcePhones.map((phone) => {
    const number = validateContactText(typeof phone?.number === "string" ? phone.number : "", "Phone number", 40);
    if (!number || !/^\+?[\d\s().-]{3,32}$/.test(number) || number.replace(/\D/g, "").length < 7 || number.replace(/\D/g, "").length > 15) throw new HttpError("Enter a valid phone number with 7 to 15 digits.");
    const label = validateContactText(typeof phone?.label === "string" ? phone.label : "Mobile", "Phone label", 32) || "Mobile";
    return { label, number };
  });
  const sourceWebsites = Array.isArray(body.websites) ? body.websites : [];
  if (sourceWebsites.length > 10) throw new HttpError("Add up to 10 websites.");
  const websites = [...new Set(sourceWebsites.map((value) => cleanBusinessUrl(value, "Website")).filter(Boolean))];
  const sourceSocials = Array.isArray(body.socialLinks) ? body.socialLinks : [];
  if (sourceSocials.length > 16) throw new HttpError("Add up to 16 social profiles.");
  const socialLinks = sourceSocials.map((link) => {
    const platform = typeof link?.platform === "string" ? link.platform : "";
    if (!BUSINESS_SOCIAL_PLATFORMS.has(platform)) throw new HttpError("Choose a supported social network.");
    const url = cleanBusinessUrl(link.url, `${platform} link`);
    if (!url) throw new HttpError("Add a URL for each social profile.");
    return { platform, url };
  });
  const sourceLinks = Array.isArray(body.customLinks) ? body.customLinks : [];
  if (sourceLinks.length > 20) throw new HttpError("Add up to 20 custom links.");
  const customLinks = sourceLinks.map((link) => {
    const label = validateContactText(typeof link?.label === "string" ? link.label : "", "Link label", 60);
    const url = cleanBusinessUrl(link?.url, "Custom link");
    if (!label || !url) throw new HttpError("Each custom link needs a label and valid URL.");
    return { label, url };
  });
  const profilePhotoKey = await validateBusinessPhoto(identity, typeof body.profilePhotoKey === "string" ? body.profilePhotoKey : "", env);
  const businessLogoKey = await validateBusinessPhoto(identity, typeof body.businessLogoKey === "string" ? body.businessLogoKey : "", env);
  const isPublic = Boolean(body.isPublic);
  const folderId = await resolveVaultFolderId(identity, body.folderId, "business-cards", env);
  const style = typeof body.style === "string" && BUSINESS_CARD_STYLES.has(body.style) ? body.style : "garden";
  const cardId = existing?.card_id || (isPublic ? securePublicCardId() : null);
  const now = new Date().toISOString();
  const row = {
    user_id: identity.id, card_id: cardId, is_public: isPublic, card_style: style, full_name: fullName, job_title: jobTitle || null, company: company || null,
    phone_numbers: phoneNumbers, email: email || null, websites, social_links: socialLinks,
    address: address || null, bio: bio || null, custom_links: customLinks,
    profile_photo_key: profilePhotoKey || null, business_logo_key: businessLogoKey || null, folder_id: folderId, updated_at: now,
  };
  const path = existing ? `/rest/v1/business_cards?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(identity.id)}` : "/rest/v1/business_cards";
  const response = await supabaseAdminFetch(path, env, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!response.ok) {
    const failure = await response.clone().json().catch(() => ({}));
    const diagnostic = `${failure.code || ""} ${failure.message || ""} ${failure.details || ""}`.toLowerCase();
    console.error("Persora business-card save was rejected", response.status, failure.code || "unknown");
    if (diagnostic.includes("business_cards") && (diagnostic.includes("schema cache") || diagnostic.includes("does not exist") || diagnostic.includes("could not find"))) {
      throw new HttpError("Business-card storage is not fully set up. Apply the business-card and account-sharing/card-style Supabase migrations, then try again.", 503);
    }
    if (failure.code === "23505") throw new HttpError("A unique business-card URL conflict occurred. Please try saving again.", 409);
    throw new HttpError("The business card could not be saved. Please refresh the page and try again; if it continues, check that the latest Supabase migrations are applied.", response.status >= 400 ? response.status : 502);
  }
  const result = await response.json(); const saved = Array.isArray(result) ? result[0] : result;
  if (!saved) throw new HttpError("The business card could not be saved.", 500);
  if (existing?.profile_photo_key && existing.profile_photo_key !== profilePhotoKey) await deleteBusinessCardPhotoIfUnreferenced(identity.id, existing.profile_photo_key, env);
  if (existing?.business_logo_key && existing.business_logo_key !== businessLogoKey) await deleteBusinessCardPhotoIfUnreferenced(identity.id, existing.business_logo_key, env);
  return saved;
}
async function deleteBusinessCardPhotoIfUnreferenced(userId, key, env) {
  if (!key || !ownsKey(userId, key) || !env.VAULT_FILES) return;
  const [profile, logo] = await Promise.all([
    restRows(`business_cards?user_id=eq.${encodeURIComponent(userId)}&profile_photo_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env),
    restRows(`business_cards?user_id=eq.${encodeURIComponent(userId)}&business_logo_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env),
  ]);
  if (!profile.length && !logo.length) {
    try { const object = await env.VAULT_FILES.get(key); if (object?.customMetadata?.ownerId === userId) await env.VAULT_FILES.delete(key); }
    catch (error) { console.error("Persora business-card image cleanup pending", safeError(error)); }
  }
}
async function reportPublicBusinessCard(cardId, body, request, env) {
  const card = await getPublicBusinessCard(cardId, env);
  if (!card) throw new HttpError("This public business card is unavailable.", 404);
  const allowed = new Set(["Spam or misleading", "Inappropriate content", "Impersonation", "Other"]);
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!allowed.has(reason)) throw new HttpError("Choose a report reason.");
  const details = validateContactText(typeof body.details === "string" ? body.details : "", "Report details", 500);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const reporterHash = await sha256Hex(`${env.SUPABASE_SECRET_KEY || ""}:public-business-card-report:${ip}:${card.id}`);
  const existing = await restRows(`business_card_reports?business_card_id=eq.${encodeURIComponent(card.id)}&reporter_hash=eq.${encodeURIComponent(reporterHash)}&select=id&limit=1`, env);
  if (existing.length) return { ok: true, alreadyReported: true };
  const response = await supabaseAdminFetch("/rest/v1/business_card_reports", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ business_card_id: card.id, reporter_hash: reporterHash, reason, details: details || null }),
  });
  if (!response.ok && response.status !== 409) throw new HttpError("The report could not be submitted.", response.status >= 400 ? response.status : 502);
  return { ok: true };
}

const MEDICAL_RECORD_TYPES = new Set(["Prescription", "Medical Report", "Lab Test", "Imaging / Scan", "Doctor Visit", "Hospital Record", "Vaccination", "Medical Certificate", "Discharge Summary", "Other"]);
function medicalDate(value, label, required = false) {
  const date = typeof value === "string" ? value.trim() : "";
  if (!date && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new HttpError(`Choose a valid ${label.toLowerCase()}.`);
  return date;
}
async function deleteMedicalFileIfUnreferenced(userId, key, env) {
  if (!key || !ownsKey(userId, key) || !env.VAULT_FILES) return;
  const references = await restRows(`medical_records?user_id=eq.${encodeURIComponent(userId)}&file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
  if (references.length) return;
  try { const object = await env.VAULT_FILES.get(key); if (object?.customMetadata?.ownerId === userId && object.customMetadata?.medicalRecordUpload === "true") await env.VAULT_FILES.delete(key); }
  catch (error) { console.error("Persora medical file cleanup pending", safeError(error)); }
}
async function saveMedicalRecord(identity, body, env) {
  const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  if (!isUuid(id)) throw new HttpError("Choose a valid medical record.");
  const existingRows = await restRows(`medical_records?id=eq.${encodeURIComponent(id)}&select=id,user_id,file_key,updated_at&limit=1`, env);
  const existing = existingRows[0];
  if (existing && existing.user_id !== identity.id) throw new HttpError("That medical record belongs to another account.", 403);
  const title = validateContactText(typeof body.title === "string" ? body.title : "", "Record title", 200);
  if (!title) throw new HttpError("Medical record title is required.");
  const recordType = typeof body.recordType === "string" ? body.recordType : "";
  if (!MEDICAL_RECORD_TYPES.has(recordType)) throw new HttpError("Choose a valid medical record type.");
  const recordDate = medicalDate(body.recordDate, "Record date", true);
  const followUpDate = medicalDate(body.followUpDate, "Follow-up date", false);
  const clean = (value, field, limit) => validateContactText(typeof value === "string" ? value : "", field, limit);
  const provider = clean(body.provider, "Healthcare provider", 160);
  const hospital = clean(body.hospital, "Hospital or clinic", 180);
  const specialty = clean(body.specialty, "Medical specialty", 120);
  const notes = clean(body.notes, "Notes", 5000);
  const additionalData = clean(body.additionalData, "Additional Data", 5000);
  const diagnosis = clean(body.diagnosis, "Diagnosis", 400);
  const testName = clean(body.testName, "Test name", 180);
  const testResult = clean(body.testResult, "Test result summary", 600);
  const medicationNotes = clean(body.medicationNotes, "Medication notes", 2000);
  const linksInput = Array.isArray(body.links) ? body.links : [];
  if (linksInput.length > 50) throw new HttpError("A medical record can link to up to 50 other records.");
  const links = [];
  const seenLinks = new Set();
  for (const link of linksInput) {
    if (!link || (link.recordType !== "contact" && link.recordType !== "vault_item") || !isUuid(link.recordId)) throw new HttpError("One of the linked Persora records is invalid.");
    const key = `${link.recordType}:${link.recordId}`;
    if (!seenLinks.has(key)) { links.push({ recordType: link.recordType, recordId: link.recordId, linkKind: "related" }); seenLinks.add(key); }
  }
  const relatedReminderId = typeof body.relatedReminderId === "string" && body.relatedReminderId ? body.relatedReminderId : "";
  if (relatedReminderId && !isUuid(relatedReminderId)) throw new HttpError("Choose a valid related reminder.");
  if (relatedReminderId) {
    links.push({ recordType: "vault_item", recordId: relatedReminderId, linkKind: "reminder" });
  }
  const contactIds = [...new Set(links.filter((link) => link.recordType === "contact").map((link) => link.recordId))];
  const itemIds = [...new Set(links.filter((link) => link.recordType === "vault_item").map((link) => link.recordId))];
  const owner = encodeURIComponent(identity.id);
  const [contacts, items] = await Promise.all([
    contactIds.length ? restRows(`contacts?user_id=eq.${owner}&id=in.(${contactIds.join(",")})&select=id`, env) : Promise.resolve([]),
    itemIds.length ? restRows(`vault_items?user_id=eq.${owner}&id=in.(${itemIds.join(",")})&select=id,metadata`, env) : Promise.resolve([]),
  ]);
  if (contacts.length !== contactIds.length || items.length !== itemIds.length) throw new HttpError("Medical records can only link to records in your own Persora account.", 403);
  if (relatedReminderId) {
    const reminder = items.find((item) => item.id === relatedReminderId);
    if (!reminder || reminder.metadata?.recordType !== "reminder") throw new HttpError("Choose a reminder from your own Persora records.", 400);
  }
  let file = null;
  if (body.file && typeof body.file === "object") {
    const key = typeof body.file.key === "string" ? body.file.key : "";
    if (!ownsKey(identity.id, key) || !env.VAULT_FILES) throw new HttpError("Choose a private file uploaded to your account.", 403);
    const object = await env.VAULT_FILES.get(key);
    if (!object || object.customMetadata?.ownerId !== identity.id || (key !== existing?.file_key && object.customMetadata?.medicalRecordUpload !== "true")) throw new HttpError("That medical file is not available in your account.", 404);
    const otherReferences = await restRows(`medical_records?user_id=eq.${owner}&file_key=eq.${encodeURIComponent(key)}&select=id&limit=2`, env);
    if (otherReferences.some((entry) => entry.id !== id)) throw new HttpError("This file is already attached to another medical record. Upload a separate copy only if you intend to store one.", 409);
    file = { key, name: clean(object.customMetadata?.originalName || body.file.name, "File name", 180) || "medical-record-file", size: Number(object.size), type: safeContentType(object.httpMetadata?.contentType || body.file.type || "application/octet-stream") };
  }
  const folderId = await resolveVaultFolderId(identity, body.folderId, "medical-records", env);
  const row = {
    user_id: identity.id, title, record_type: recordType, record_date: recordDate, provider, hospital, specialty, notes, additional_data: additionalData,
    diagnosis, test_name: testName, test_result: testResult, medication_notes: medicationNotes, follow_up_date: followUpDate,
    related_reminder_id: relatedReminderId || null, file_key: file?.key || null, file_name: file?.name || null, file_size: file?.size ?? null, file_type: file?.type || null, folder_id: folderId,
    updated_at: new Date().toISOString(),
  };
  const response = await supabaseAdminFetch(existing ? `/rest/v1/medical_records?id=eq.${encodeURIComponent(id)}&user_id=eq.${owner}` : "/rest/v1/medical_records", env, {
    method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(existing ? row : { id, ...row }),
  });
  if (!response.ok) throw new HttpError("The database could not save this medical record.", response.status >= 400 ? response.status : 502);
  const savedRows = await response.json(); const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
  if (!saved) throw new HttpError("This medical record could not be saved.", 500);
  if (existing) {
    const deleted = await supabaseAdminFetch(`/rest/v1/medical_record_links?medical_record_id=eq.${encodeURIComponent(id)}&owner_id=eq.${owner}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (!deleted.ok) throw new HttpError("The record was saved, but its links could not be updated. Refresh and try again.", 502);
  }
  if (links.length) {
    const linkRows = links.map((link) => ({ medical_record_id: id, owner_id: identity.id, record_type: link.recordType, record_id: link.recordId, link_kind: link.linkKind }));
    const linked = await supabaseAdminFetch("/rest/v1/medical_record_links", env, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(linkRows) });
    if (!linked.ok) throw new HttpError("The record was saved, but its links could not be saved. Refresh and try again.", 502);
  }
  if (existing?.file_key && existing.file_key !== file?.key) await deleteMedicalFileIfUnreferenced(identity.id, existing.file_key, env);
  return { ...saved, links: links.map((link) => ({ record_type: link.recordType, record_id: link.recordId, link_kind: link.linkKind })) };
}
async function removeMedicalRecord(identity, id, env) {
  const owner = encodeURIComponent(identity.id);
  const rows = await restRows(`medical_records?id=eq.${encodeURIComponent(id)}&user_id=eq.${owner}&select=id,file_key&limit=1`, env);
  if (!rows.length) throw new HttpError("That medical record isn't available in your account.", 404);
  const response = await supabaseAdminFetch(`/rest/v1/medical_records?id=eq.${encodeURIComponent(id)}&user_id=eq.${owner}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!response.ok) throw new HttpError("The medical record could not be deleted.", response.status >= 400 ? response.status : 502);
  if (rows[0].file_key) await deleteMedicalFileIfUnreferenced(identity.id, rows[0].file_key, env);
}

const CONTACT_CATEGORIES = new Set(["Family", "Friends", "Work", "Clients", "Suppliers", "Students", "Other"]);
function validateContactText(value, field, maxLength) {
  if (typeof value !== "string") throw new HttpError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new HttpError(`${field} must be ${maxLength} characters or fewer.`);
  return trimmed;
}
async function saveContact(identity, body, env) {
  const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  if (!isUuid(id)) throw new HttpError("Choose a valid contact.");
  const fullName = validateContactText(body.name, "Name", 160);
  if (!fullName) throw new HttpError("Contact name is required.");
  const email = validateContactText(typeof body.email === "string" ? body.email : "", "Email", 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Enter a valid email address.");
  const company = validateContactText(typeof body.company === "string" ? body.company : "", "Company", 160);
  const jobTitle = validateContactText(typeof body.jobTitle === "string" ? body.jobTitle : "", "Job title", 160);
  const address = validateContactText(typeof body.address === "string" ? body.address : "", "Address", 1200);
  const notes = validateContactText(typeof body.notes === "string" ? body.notes : "", "Notes", 5000);
  const category = typeof body.category === "string" && CONTACT_CATEGORIES.has(body.category) ? body.category : "Other";
  const birthday = typeof body.birthday === "string" ? body.birthday.trim() : "";
  if (birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Number.isNaN(Date.parse(`${birthday}T12:00:00Z`)))) throw new HttpError("Choose a valid birthday.");
  const sourcePhones = Array.isArray(body.phoneNumbers) ? body.phoneNumbers : [];
  if (sourcePhones.length > 20) throw new HttpError("A contact can have up to 20 phone numbers.");
  const phoneNumbers = sourcePhones.map((phone) => {
    const number = validateContactText(typeof phone?.number === "string" ? phone.number : "", "Phone number", 40);
    if (!number || !/^\+?[\d\s().-]{3,32}$/.test(number) || number.replace(/\D/g, "").length < 3) throw new HttpError("Enter a valid phone number.");
    const label = validateContactText(typeof phone?.label === "string" ? phone.label : "Mobile", "Phone label", 32) || "Mobile";
    return { label, number };
  }).filter((phone) => phone.number);
  const photoKey = typeof body.photoKey === "string" ? body.photoKey : "";
  if (photoKey) {
    if (!ownsKey(identity.id, photoKey)) throw new HttpError("That profile photo is not in your account.", 403);
    const photo = await env.VAULT_FILES.get(photoKey);
    const photoType = String(photo?.httpMetadata?.contentType || "").toLowerCase();
    if (!photo || photo.customMetadata?.ownerId !== identity.id || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(photoType)) throw new HttpError("That profile photo is unavailable or uses an unsupported image type.", 404);
  }
  const existing = await restRows(`contacts?id=eq.${encodeURIComponent(id)}&select=id,user_id,photo_key,updated_at`, env);
  if (existing[0] && existing[0].user_id !== identity.id) throw new HttpError("That contact belongs to another account.", 403);
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
  if (expectedUpdatedAt && (!existing[0] || existing[0].updated_at !== expectedUpdatedAt)) {
    throw new HttpError("This contact changed on another device. Refresh before saving your edit.", 409);
  }
  const folderId = await resolveVaultFolderId(identity, body.folderId, "contacts", env);
  const row = {
    full_name: fullName, phone_numbers: phoneNumbers, email: email || null, company: company || null,
    job_title: jobTitle || null, address: address || null, birthday: birthday || null, notes: notes || null,
    category, photo_key: photoKey || null, favorite: Boolean(body.favorite), folder_id: folderId, updated_at: new Date().toISOString(),
  };
  const isUpdate = Boolean(existing[0]);
  const path = isUpdate
    ? `/rest/v1/contacts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}${expectedUpdatedAt ? `&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}` : ""}`
    : "/rest/v1/contacts";
  const response = await supabaseAdminFetch(path, env, {
    method: isUpdate ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(isUpdate ? row : { id, user_id: identity.id, ...row }),
  });
  if (!response.ok) throw new HttpError("The database could not save this contact.", response.status >= 400 ? response.status : 502);
  const result = await response.json();
  const saved = Array.isArray(result) ? result[0] : result;
  if (!saved && expectedUpdatedAt) throw new HttpError("This contact changed on another device. Refresh before saving your edit.", 409);
  if (!saved) throw new HttpError("This contact could not be saved.", 500);
  if (existing[0]?.photo_key && existing[0].photo_key !== photoKey) await deleteContactPhotoIfUnreferenced(identity.id, existing[0].photo_key, env);
  return saved;
}
async function deleteContactPhotoIfUnreferenced(userId, key, env) {
  if (!key || !ownsKey(userId, key) || !env.VAULT_FILES) return;
  const references = await restRows(`contacts?user_id=eq.${encodeURIComponent(userId)}&photo_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
  if (!references.length) {
    try {
      const object = await env.VAULT_FILES.get(key);
      if (object?.customMetadata?.ownerId === userId) await env.VAULT_FILES.delete(key);
    } catch (error) { console.error("Persora contact photo cleanup pending", safeError(error)); }
  }
}
async function mergeContacts(identity, body, env) {
  const primaryId = typeof body.primaryId === "string" ? body.primaryId : "";
  const duplicateIds = Array.isArray(body.duplicateIds) ? [...new Set(body.duplicateIds.filter((id) => typeof id === "string" && isUuid(id) && id !== primaryId))] : [];
  if (!isUuid(primaryId) || !duplicateIds.length || duplicateIds.length > 20) throw new HttpError("Choose a contact and at least one duplicate to merge.");
  const ids = [primaryId, ...duplicateIds];
  const rows = await restRows(`contacts?user_id=eq.${encodeURIComponent(identity.id)}&id=in.(${ids.join(",")})&select=*`, env);
  if (rows.length !== ids.length) throw new HttpError("One or more selected contacts are no longer available.", 404);
  const primary = rows.find((row) => row.id === primaryId);
  const others = rows.filter((row) => row.id !== primaryId);
  const firstText = (key) => String(primary[key] || others.map((row) => row[key]).find(Boolean) || "");
  const phones = new Map();
  for (const contact of [primary, ...others]) for (const phone of Array.isArray(contact.phone_numbers) ? contact.phone_numbers : []) {
    const number = String(phone?.number || "").trim();
    const key = number.replace(/\D/g, "");
    if (number && !phones.has(key)) phones.set(key, { label: String(phone.label || "Mobile"), number });
  }
  const noteBlocks = [...new Set([primary, ...others].filter((row) => String(row.notes || "").trim()).map((row) => `${row.id === primaryId ? "" : `${row.full_name}: `}${String(row.notes).trim()}`))];
  const photoKey = primary.photo_key || others.find((row) => row.photo_key)?.photo_key || null;
  const mergedRow = {
    full_name: firstText("full_name"), phone_numbers: [...phones.values()], email: firstText("email") || null,
    company: firstText("company") || null, job_title: firstText("job_title") || null, address: firstText("address") || null,
    birthday: firstText("birthday") || null, notes: noteBlocks.join("\n\n") || null,
    category: primary.category || "Other", photo_key: photoKey, favorite: rows.some((row) => Boolean(row.favorite)), folder_id: primary.folder_id || null, updated_at: new Date().toISOString(),
  };
  const update = await supabaseAdminFetch(`/rest/v1/contacts?id=eq.${encodeURIComponent(primaryId)}&user_id=eq.${encodeURIComponent(identity.id)}`, env, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(mergedRow),
  });
  if (!update.ok) throw new HttpError("The contact merge could not be saved.", update.status >= 400 ? update.status : 502);
  const result = await update.json();
  const saved = Array.isArray(result) ? result[0] : result;
  if (!saved) throw new HttpError("The contact merge could not be saved.", 500);
  const duplicateShares = await restRows(`record_shares?owner_id=eq.${encodeURIComponent(identity.id)}&resource_type=eq.contact&resource_id=in.(${duplicateIds.join(",")})&select=id,resource_id,recipient_id`, env);
  for (const share of duplicateShares) {
    const alreadyShared = await restRows(`record_shares?owner_id=eq.${encodeURIComponent(identity.id)}&resource_type=eq.contact&resource_id=eq.${encodeURIComponent(primaryId)}&recipient_id=eq.${encodeURIComponent(share.recipient_id)}&select=id&limit=1`, env);
    const path = alreadyShared.length ? `/rest/v1/record_shares?id=eq.${encodeURIComponent(share.id)}` : `/rest/v1/record_shares?id=eq.${encodeURIComponent(share.id)}&owner_id=eq.${encodeURIComponent(identity.id)}`;
    const response = await supabaseAdminFetch(path, env, alreadyShared.length ? { method: "DELETE", headers: { Prefer: "return=minimal" } } : { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ resource_id: primaryId }) });
    if (!response.ok) throw new HttpError("The contact was merged, but its shared access could not be moved. Refresh and review the shares.", 502);
  }
  const remove = await supabaseAdminFetch(`/rest/v1/contacts?user_id=eq.${encodeURIComponent(identity.id)}&id=in.(${duplicateIds.join(",")})`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!remove.ok) throw new HttpError("The merged contact was saved, but duplicates could not be removed. Refresh and try again.", 502);
  for (const row of others) if (row.photo_key && row.photo_key !== photoKey) await deleteContactPhotoIfUnreferenced(identity.id, row.photo_key, env);
  return saved;
}

async function resolveVaultFolderId(identity, value, scope, env) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !isUuid(value)) throw new HttpError("Choose a valid folder from this page.", 400);
  const rows = await restRows(`vault_folders?id=eq.${encodeURIComponent(value)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.${encodeURIComponent(scope)}&select=id&limit=1`, env);
  if (!rows.length) throw new HttpError("That folder does not belong to this page. Move records only within their own page.", 403);
  return value;
}

async function saveVaultFolder(identity, body, env) {
  const id = typeof body.id === "string" ? body.id : "";
  const scope = typeof body.scope === "string" ? body.scope : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const color = typeof body.color === "string" ? body.color : "blue";
  if (!VALID_FOLDER_SCOPES.has(scope)) throw new HttpError("Choose a valid page for this folder.", 400);
  if (name.length < 1 || name.length > 64) throw new HttpError("Enter a folder name between 1 and 64 characters.", 400);
  if (!VALID_FOLDER_COLORS.has(color)) throw new HttpError("Choose a folder color from the palette.", 400);
  if (id && !isUuid(id)) throw new HttpError("Choose a valid folder.", 400);
  if (id) {
    const owned = await restRows(`vault_folders?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.${encodeURIComponent(scope)}&select=id&limit=1`, env);
    if (!owned.length) throw new HttpError("That folder does not belong to this page.", 404);
  }
  const record = { scope, name, color, pinned: Boolean(body.pinned), updated_at: new Date().toISOString() };
  const response = await supabaseAdminFetch(id ? `/rest/v1/vault_folders?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.${encodeURIComponent(scope)}` : "/rest/v1/vault_folders", env, {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(id ? record : { user_id: identity.id, ...record }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 || body.code === "23505") throw new HttpError("A folder with that name already exists in this page.", 409);
    throw new HttpError(body.message || "The folder could not be saved.", response.status >= 400 && response.status < 500 ? response.status : 502);
  }
  const saved = await response.json();
  const row = Array.isArray(saved) ? saved[0] : saved;
  if (!row) throw new HttpError("The folder could not be saved.", 500);
  return row;
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
  if (section === "wallet-cards") {
    const allowedCardFields = new Set(["network", "cardType", "issuer", "cardholder", "lastFour", "expiryMonth", "expiryYear", "currency", "notes"]);
    if (Object.keys(metadata).some((key) => !allowedCardFields.has(key))) throw new HttpError("Wallet cards only save masked card details. Full card numbers and security codes are not accepted.", 400);
    if (metadata.lastFour && !/^\d{4}$/.test(String(metadata.lastFour))) throw new HttpError("Enter only the card's four ending digits.", 400);
    if (metadata.expiryMonth && !/^(0[1-9]|1[0-2])$/.test(String(metadata.expiryMonth))) throw new HttpError("Choose a valid card expiry month.", 400);
    if (metadata.network && !["Visa", "Mastercard", "American Express", "UnionPay", "Discover", "Other"].includes(String(metadata.network))) throw new HttpError("Choose a supported card network.", 400);
  }
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
  const existing = await restRows(`vault_items?id=eq.${encodeURIComponent(id)}&select=user_id,section`, env);
  if (existing[0] && existing[0].user_id !== identity.id) throw new HttpError("That vault item belongs to another account.", 403);
  if (existing[0] && existing[0].section !== section) throw new HttpError("A saved record cannot be moved to a different page. Create a new record in that page instead.", 403);
  const folderId = await resolveVaultFolderId(identity, body.folderId, section, env);
  const row = {
    section, title, subtitle: subtitle || null, metadata, folder_id: folderId,
    file_key: fileKey || null, file_name: fileKey ? fileName.slice(0, 240) : null,
    file_size: fileKey && Number.isFinite(Number(file.size)) ? Math.max(0, Number(file.size)) : null,
    file_type: fileKey ? safeContentType(file.type) : null,
    favorite: Boolean(body.favorite), pinned: Boolean(body.pinned), updated_at: new Date().toISOString(),
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
function publicAlarmRingtone(entry) {
  return { id: entry.id, name: entry.name, type: entry.type, size: entry.size };
}
function cleanAlarmRingtoneSetting(value) {
  if (!Array.isArray(value) || value.length > MAX_ALARM_RINGTONE_COUNT) throw new HttpError("Alarm ringtone list is invalid.", 400);
  const ids = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || !isUuid(entry.id)) throw new HttpError("An alarm ringtone entry is invalid.", 400);
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 80) : "";
    const type = typeof entry.type === "string" ? entry.type : "";
    const size = Number(entry.size);
    const fileKey = typeof entry.fileKey === "string" ? entry.fileKey : "";
    if (name.length < 2 || !Object.values(ALARM_RINGTONE_FORMATS).some((format) => format.contentType === type) || !Number.isFinite(size) || size < 1 || size > MAX_ALARM_RINGTONE_BYTES || fileKey !== `system/ringtones/${entry.id}.${fileKey.split(".").pop()}` || !/^system\/ringtones\/[0-9a-f-]{36}\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(fileKey)) throw new HttpError("An alarm ringtone entry contains invalid file details.", 400);
    if (ids.has(entry.id)) throw new HttpError("Ringtone IDs must be unique.", 400);
    ids.add(entry.id);
    return { id: entry.id, name, type, size, fileKey };
  });
}
async function loadSettings(env) {
  const rows = await restRows("platform_settings?select=setting_key,value", env);
  const stored = Object.fromEntries((rows || []).map((row) => [row.setting_key, row.value || {}]));
  return {
    billing: { ...DEFAULT_SETTINGS.billing, ...(stored.billing || {}) },
    storage: { ...DEFAULT_SETTINGS.storage, ...(stored.storage || {}) },
    paymentMethods: Array.isArray(stored.payment_methods) ? stored.payment_methods : DEFAULT_SETTINGS.paymentMethods,
    siteContent: stored.site_content && typeof stored.site_content === "object" && !Array.isArray(stored.site_content) ? stored.site_content : DEFAULT_SETTINGS.siteContent,
    email: { ...DEFAULT_SETTINGS.email, ...(stored.email && typeof stored.email === "object" && !Array.isArray(stored.email) ? stored.email : {}) },
    smartScan: { ...DEFAULT_SETTINGS.smartScan, ...(stored.smart_scan && typeof stored.smart_scan === "object" && !Array.isArray(stored.smart_scan) ? stored.smart_scan : {}) },
    alarmRingtones: Array.isArray(stored.alarm_ringtones) ? stored.alarm_ringtones : DEFAULT_SETTINGS.alarmRingtones,
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
async function getUploadEntitlement(userId, env) {
  const subscriptions = await restRows(`user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan_id,status,current_period_end`, env);
  const subscription = subscriptions[0];
  if (!subscription?.plan_id || subscription.status !== "active") return { uploadsEnabled: false };
  const plans = await restRows(`subscription_plans?id=eq.${encodeURIComponent(subscription.plan_id)}&select=slug`, env);
  const plan = plans[0];
  if (!plan || plan.slug === "free") return { uploadsEnabled: false };
  const expiry = subscription.current_period_end ? Date.parse(subscription.current_period_end) : NaN;
  if (Number.isFinite(expiry) && expiry <= Date.now()) {
    await markSubscriptionPastDue(userId, env);
    return { uploadsEnabled: false };
  }
  return { uploadsEnabled: true };
}
async function hasActivePaidUploadPlan(userId, env) {
  return (await getUploadEntitlement(userId, env)).uploadsEnabled;
}
function uploadPlanRequiredError() {
  return new HttpError("File uploads require an active paid plan. Your existing files and all records remain available.", 403);
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
  const [usage, databaseUsage] = await Promise.all([readUsage(bucket, `${userId}/`), readUserDatabaseUsage(userId, env)]);
  return {
    bytesUsed: usage.bytes + databaseUsage.bytes,
    fileBytes: usage.bytes,
    databaseBytes: databaseUsage.bytes,
    databaseRecordCount: databaseUsage.records,
    objectCount: usage.objectCount,
    storageLimitBytes: storageLimitGb * 1024 * 1024 * 1024,
    storageLimitGb,
    planName: active && !isFreePlan ? (currentPlan?.name || "Current plan") : "Free",
  };
}
async function loadBilling(identity, env) {
  const [settings, plans, subscriptionRows, paymentRows, usage, uploadAccess] = await Promise.all([
    loadSettings(env), listPlans(env, true),
    restRows(`user_subscriptions?user_id=eq.${encodeURIComponent(identity.id)}&select=plan_id,status,storage_limit_gb,current_period_end`, env),
    restRows(`payment_records?user_id=eq.${encodeURIComponent(identity.id)}&select=id,user_id,plan_id,amount,currency,method,reference,billing_period,duration_count,term_months,status,submitted_at,reviewed_at,reviewed_by,admin_note&order=submitted_at.desc&limit=100`, env),
    userStorageUsage(identity.id, env.VAULT_FILES, env),
    getUploadEntitlement(identity.id, env),
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
    uploadsEnabled: uploadAccess.uploadsEnabled,
    billingSettings: settings.billing,
    paymentMethods: settings.paymentMethods.filter((method) => method && method.active === true).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    maxUploadMb: settings.storage.maxUploadMb,
  };
}
async function createPaymentRequest(identity, body, env) {
  const planId = typeof body.planId === "string" ? body.planId : "";
  const methodId = typeof body.methodId === "string" ? body.methodId.trim().slice(0, 80) : "";
  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 180) : "";
  const billingPeriod = body.billingPeriod === "monthly" || body.billingPeriod === "yearly" ? body.billingPeriod : "";
  const durationCount = Number(body.durationCount);
  if (!isUuid(planId) || !methodId || reference.length < 1 || !billingPeriod || !Number.isInteger(durationCount) || durationCount < 1 || durationCount > 120) throw new HttpError("Choose a plan, payment method, valid billing period, duration, and transaction reference.", 400);
  const settings = await loadSettings(env);
  if (!settings.billing.billingEnabled) throw new HttpError("Manual subscription payments are not enabled yet. Please check back later.", 409);
  const minTermMonths = Math.max(1, Math.trunc(Number(settings.billing.minTermMonths) || 1));
  const maxTermMonths = Math.min(120, Math.max(minTermMonths, Math.trunc(Number(settings.billing.maxTermMonths) || 12)));
  const termMonths = durationCount * (billingPeriod === "yearly" ? 12 : 1);
  if (termMonths < minTermMonths || termMonths > maxTermMonths) throw new HttpError(`Choose a term from ${minTermMonths} to ${maxTermMonths} months, as configured by the administrator.`, 400);
  const methodConfig = settings.paymentMethods.find((entry) => entry && entry.id === methodId && entry.active === true);
  if (!methodConfig) throw new HttpError("That payment method is unavailable. Refresh and choose an active method.", 409);
  const method = methodConfig.name;
  const rows = await restRows(`subscription_plans?id=eq.${encodeURIComponent(planId)}&active=eq.true&select=id,name,storage_gb,price_per_gb_monthly`, env);
  const plan = rows[0];
  if (!plan) throw new HttpError("That plan is no longer available.", 404);
  const amount = Number((Number(plan.storage_gb) * Number(plan.price_per_gb_monthly) * termMonths).toFixed(2));
  if (amount <= 0) throw new HttpError("The free plan does not require a payment request.", 400);
  const pending = await restRows(`payment_records?user_id=eq.${encodeURIComponent(identity.id)}&status=eq.pending&select=id&limit=1`, env);
  if (pending.length) throw new HttpError("You already have a payment request waiting for review.", 409);
  const response = await supabaseAdminFetch("/rest/v1/payment_records", env, {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ user_id: identity.id, plan_id: plan.id, amount, currency: settings.billing.currency, method, reference, billing_period: billingPeriod, duration_count: durationCount, term_months: termMonths, status: "pending" }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = String(body.message || body.error || "");
    if (/billing_period|duration_count|term_months/i.test(message) && /column|schema/i.test(message)) {
      throw new HttpError("The billing-term database migration is still pending. Apply supabase/migrations/202610030002_payment_record_billing_terms.sql, then retry.", 503);
    }
    throw new Error(message || "Payment request could not be submitted.");
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
  } else if (key === "email") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError("Invalid email settings.", 400);
    const verificationEnabled = value.verificationEnabled;
    const senderName = typeof value.senderName === "string" ? value.senderName.trim().slice(0, 70) : "Persora";
    const senderEmail = typeof value.senderEmail === "string" ? value.senderEmail.trim().toLowerCase() : "";
    const replyToEmail = typeof value.replyToEmail === "string" ? value.replyToEmail.trim().toLowerCase() : "";
    const replyToName = typeof value.replyToName === "string" ? value.replyToName.trim().slice(0, 70) : "";
    if (typeof verificationEnabled !== "boolean") throw new HttpError("Choose whether email verification is enabled.", 400);
    if (verificationEnabled && !isValidEmailAddress(senderEmail)) throw new HttpError("Set a valid, verified sender email before enabling email verification.", 400);
    if (senderEmail && !isValidEmailAddress(senderEmail)) throw new HttpError("Enter a valid sender email address.", 400);
    if (replyToEmail && !isValidEmailAddress(replyToEmail)) throw new HttpError("Enter a valid reply-to email address or leave it blank.", 400);
    value = { verificationEnabled, senderName: senderName || "Persora", senderEmail, replyToEmail, replyToName };
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
  } else if (key === "smart_scan") {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean") throw new HttpError("Choose whether Smart Scan is enabled globally.", 400);
    value = { enabled: value.enabled };
  } else if (key === "alarm_ringtones") {
    value = cleanAlarmRingtoneSetting(value);
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
  const paymentRows = await restRows(`payment_records?id=eq.${encodeURIComponent(paymentId)}&select=id,user_id,plan_id,amount,currency,method,reference,billing_period,duration_count,term_months,status`, env);
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
async function createAccountExport(identity, env) {
  if (!env.VAULT_FILES) throw new Error("Private file storage is unavailable for this export.");
  const owner = encodeURIComponent(identity.id);
  const [profileRows, items, contacts, cards, medicalRecords, medicalRecordLinks, documentShares, recordShares, notifications, authoredComments, subscriptions, payments, files, timelineExport] = await Promise.all([
    restRows(`profiles?id=eq.${owner}&select=id,login_id,email,full_name,timezone,avatar_url,created_at,updated_at`, env),
    restRowsPaged(`vault_items?user_id=eq.${owner}&select=*&order=id.asc`, env),
    restRowsPaged(`contacts?user_id=eq.${owner}&select=*&order=id.asc`, env),
    restRowsPaged(`business_cards?user_id=eq.${owner}&select=*&order=id.asc`, env),
    restRowsPaged(`medical_records?user_id=eq.${owner}&select=*&order=id.asc`, env),
    restRowsPaged(`medical_record_links?owner_id=eq.${owner}&select=*&order=medical_record_id.asc`, env),
    restRowsPaged(`vault_shares?or=(owner_id.eq.${owner},recipient_id.eq.${owner})&select=*&order=created_at.asc`, env),
    restRowsPaged(`record_shares?or=(owner_id.eq.${owner},recipient_id.eq.${owner})&select=*&order=created_at.asc`, env),
    restRowsPaged(`share_notifications?recipient_id=eq.${owner}&select=*&order=created_at.asc`, env),
    restRowsPaged(`vault_share_comments?author_id=eq.${owner}&select=*&order=created_at.asc`, env),
    restRows(`user_subscriptions?user_id=eq.${owner}&select=*&limit=1`, env),
    restRowsPaged(`payment_records?user_id=eq.${owner}&select=*&order=submitted_at.asc`, env),
    listAccountFiles(env.VAULT_FILES, identity.id),
    loadTimelineExport(identity, env),
  ]);
  const ordinaryFiles = files.filter((file) => !file.key.startsWith(`${identity.id}/timeline/`));
  const indexedFiles = [
    ...ordinaryFiles.map((file) => ({ ...file, exportSize: file.size, exportName: sanitizeFileName(file.key.slice(file.key.indexOf("/") + 1)) })),
    ...timelineExport.attachments.map((file) => ({ ...file, exportSize: file.size, exportName: sanitizeFileName(file.name) })),
  ];
  const attachmentManifest = indexedFiles.map((file, index) => ({
    key: file.key, path: `files/${String(index + 1).padStart(6, "0")}-${file.exportName.slice(0, 78)}`,
    size: file.exportSize, type: file.type || "application/octet-stream",
  }));
  const manifest = {
    format: "persora-complete-export-v1", exportedAt: new Date().toISOString(),
    account: profileRows[0] || { login_id: identity.login_id || "", email: identity.email || "", full_name: identity.full_name || "" },
    data: { vaultItems: items, contacts, businessCards: cards, medicalRecords, medicalRecordLinks, documentShares, recordShares, notifications, authoredShareComments: authoredComments, subscriptions, paymentHistory: payments, timelineEvents: timelineExport.events },
    attachments: attachmentManifest,
    note: "Private attachment bytes, including medical-record files, are included under files/. Timeline text is decrypted only for this authenticated account export; timeline attachment files are decrypted into the archive. Session tokens, password hashes, and other accounts' private records are excluded.",
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const entries = [
    { name: "persora-export.json", size: manifestBytes.byteLength, stream: new Blob([manifestBytes]).stream() },
    ...ordinaryFiles.map((file, index) => ({ ...file, size: attachmentManifest[index].size, name: attachmentManifest[index].path })),
    ...timelineExport.attachments.map((file, index) => ({ name: attachmentManifest[ordinaryFiles.length + index].path, size: file.size, openStream: async () => new Blob([await readTimelineExportAttachment(identity, file.key, env)]).stream() })),
  ];
  const stream = tarReadableStream(entries, env.VAULT_FILES);
  return { stream, filename: `persora-export-${new Date().toISOString().slice(0, 10)}.tar` };
}
async function listAccountFiles(bucket, userId) {
  const files = []; let cursor;
  do {
    const page = await bucket.list({ prefix: `${userId}/`, cursor, limit: 1000 });
    for (const object of page.objects) if (ownsKey(userId, object.key)) files.push({ key: object.key, size: Number(object.size) || 0, type: object.httpMetadata?.contentType || "application/octet-stream" });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files;
}
function tarHeader(name, size) {
  const header = new Uint8Array(512); const view = new DataView(header.buffer);
  const write = (text, offset, length) => { const bytes = new TextEncoder().encode(String(text)); header.set(bytes.subarray(0, length), offset); };
  const octal = (value, length) => String(Math.max(0, Math.floor(Number(value) || 0)).toString(8)).padStart(length - 1, "0").slice(-(length - 1)) + "\0";
  write(name, 0, 100); write(octal(0o644, 8), 100, 8); write(octal(0, 8), 108, 8); write(octal(0, 8), 116, 8);
  write(octal(size, 12), 124, 12); write(octal(Math.floor(Date.now() / 1000), 12), 136, 12); header.fill(32, 148, 156); write("0", 156, 1); write("ustar\0", 257, 6); write("00", 263, 2);
  let checksum = 0; for (const byte of header) checksum += byte;
  write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}
async function* streamReader(reader) { try { while (true) { const part = await reader.read(); if (part.done) break; yield part.value; } } finally { try { reader.releaseLock(); } catch {} } }
function tarReadableStream(entries, bucket) {
  async function* generate() {
    const encoder = new TextEncoder();
    for (const entry of entries) {
      let source = entry.stream;
      if (!source && typeof entry.openStream === "function") source = await entry.openStream();
      if (!source) {
        const object = await bucket.get(entry.key);
        if (!object?.body) continue;
        source = object.body;
      }
      yield tarHeader(entry.name, entry.size);
      const reader = source.getReader(); let emitted = 0;
      for await (const chunk of streamReader(reader)) { emitted += chunk.byteLength; yield chunk; }
      if (emitted !== entry.size) throw new Error(`An attachment changed during export: ${entry.name}`);
      const padding = (512 - (entry.size % 512)) % 512;
      if (padding) yield new Uint8Array(padding);
    }
    yield new Uint8Array(1024);
  }
  const iterator = generate();
  return new ReadableStream({
    async pull(controller) { try { const part = await iterator.next(); if (part.done) controller.close(); else controller.enqueue(part.value); } catch (error) { controller.error(error); } },
    async cancel() { await iterator.return?.(); },
  });
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
  const [profileRows, eventRows, plans, typeRows, paymentRows, totalAccounts, activeAccounts, vaultEntries, pendingPayments, storageResult, databaseResult] = await Promise.all([
    restRows("profiles?select=id,login_id,email,full_name,role,account_status,created_at&order=created_at.desc&limit=1000", env),
    restRows("admin_audit_events?select=id,actor_email,event_type,target_user_id,target_email,created_at,details&order=created_at.desc&limit=30", env),
    listPlans(env, false),
    restRows("document_types?select=id,name,active,sort_order&order=sort_order.asc,name.asc", env),
    restRows("payment_records?select=id,user_id,plan_id,amount,currency,method,reference,billing_period,duration_count,term_months,status,submitted_at,reviewed_at,reviewed_by,admin_note&order=submitted_at.desc&limit=500", env),
    countRows("profiles", "id", env),
    countRows("profiles?account_status=eq.active", "id", env),
    countRows("vault_items", "id", env),
    countRows("payment_records?status=eq.pending", "id", env),
    summarizeBucket(env.VAULT_FILES).then((data) => ({ status: "connected", ...data })).catch(() => ({ status: "unavailable", bytesUsed: 0, objectCount: 0, usersWithFiles: 0, byUser: {} })),
    summarizeDatabase(env).then((data) => ({ status: "connected", ...data })).catch(() => ({ status: "unavailable", bytesUsed: 0, recordCount: 0, byUser: {} })),
  ]);
  const smartScanUsageRows = await restRowsPaged("smart_scan_usage?select=user_id,enabled,scan_count,ocr_run_count,ai_extraction_count,last_scanned_at&order=last_scanned_at.desc.nullslast", env).catch(() => null);
  const smartScanByUser = {};
  const smartScanTotals = { scans: 0, ocrRuns: 0, aiExtractions: 0 };
  for (const row of smartScanUsageRows || []) {
    if (!isUuid(row.user_id)) continue;
    const usage = {
      enabled: row.enabled !== false,
      scans: Math.max(0, Number(row.scan_count) || 0),
      ocrRuns: Math.max(0, Number(row.ocr_run_count) || 0),
      aiExtractions: Math.max(0, Number(row.ai_extraction_count) || 0),
      lastScannedAt: typeof row.last_scanned_at === "string" ? row.last_scanned_at : null,
    };
    smartScanByUser[row.user_id] = usage;
    smartScanTotals.scans += usage.scans;
    smartScanTotals.ocrRuns += usage.ocrRuns;
    smartScanTotals.aiExtractions += usage.aiExtractions;
  }
  const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
  const planMap = new Map(plans.map((plan) => [plan.id, plan]));
  const payments = paymentRows.map((payment) => ({
    ...payment,
    email: profileMap.get(payment.user_id)?.email || "",
    plan_name: planMap.get(payment.plan_id)?.name || "Removed plan",
    storage_gb: Number(planMap.get(payment.plan_id)?.storage_gb || 0),
  }));
  const billing = { ...settings.billing };
  const accountIds = new Set([...Object.keys(storageResult.byUser), ...Object.keys(databaseResult.byUser)]);
  const combinedByUser = Object.fromEntries([...accountIds].map((id) => {
    const file = storageResult.byUser[id] || { bytes: 0, objects: 0 };
    const database = databaseResult.byUser[id] || { bytes: 0, records: 0 };
    return [id, { bytes: file.bytes, objects: file.objects, databaseBytes: database.bytes, databaseRecords: database.records, totalBytes: file.bytes + database.bytes }];
  }));
  const totalCombinedBytes = storageResult.bytesUsed + databaseResult.bytesUsed;
  return {
    metrics: { totalAccounts, activeAccounts, vaultEntries, pendingPayments },
    smartScan: { enabled: settings.smartScan.enabled !== false, usageAvailable: Array.isArray(smartScanUsageRows), totals: smartScanTotals, byUser: smartScanByUser },
    profiles: profileRows.map((profile) => ({ ...profile, storage_bytes: combinedByUser[profile.id]?.totalBytes || 0, storage_file_bytes: combinedByUser[profile.id]?.bytes || 0, storage_database_bytes: combinedByUser[profile.id]?.databaseBytes || 0 })),
    events: eventRows,
    plans: plans.map((plan) => publicPlan(plan, billing.currency)),
    documentTypes: typeRows,
    payments,
    billingSettings: billing,
    paymentMethods: settings.paymentMethods,
    siteContent: settings.siteContent,
    emailSettings: settings.email,
    storageSettings: settings.storage,
    storage: { ...storageResult, databaseBytesUsed: databaseResult.bytesUsed, databaseRecordCount: databaseResult.recordCount, totalBytesUsed: totalCombinedBytes, databaseStatus: databaseResult.status, byUser: combinedByUser },
    system: { database: databaseResult.status, storage: storageResult.status, supabaseUrlConfigured: Boolean(getSupabaseUrl(env)), secretKeyConfigured: Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY), brevoApiKeyConfigured: Boolean(String(env.BREVO_API_KEY || "").trim()) },
  };
}

