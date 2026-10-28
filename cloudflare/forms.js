// Persora Forms — Standalone Cloudflare Pages API routes.
//
// Authenticated owner routes live under /forms.
// Public respondent routes live under /public/forms/:slug.
// Maintains its own standalone forms, R2 image-only assets, and response tables
// with zero coupling to Persora Table or Google Sheets.

import {
  FORM_LIMITS,
  FormValidationError,
  buildFormResponsesCsv,
  cleanFormText,
  defaultFormSettings,
  isFormUuid,
  normalizeFormQuestions,
  normalizeFormSettings,
  normalizeHeaderImage,
  sanitizeQuestionsForRespondent,
  validateAndScoreSubmission,
  validateFormImageBytes,
} from "./forms-rules.js";

export const FORMS_ROUTE_PREFIX = "/forms";
export const PUBLIC_FORMS_ROUTE_PREFIX = "/public/forms";
const SLUG_RE = /^[A-Za-z0-9_-]{24,64}$/;
const MAX_JSON_BYTES = 1024 * 1024;

export class FormApiError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function generateFormPublicSlug() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateRegistrationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "REG-";
  for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}

function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}

async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* fallback below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new FormApiError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "23514" || code === "22P02" || code === "22003") {
    return new FormApiError("Those form details aren't valid. Check them and try again.", 400);
  }
  if (code === "23505") {
    return new FormApiError("A conflicting update occurred. Please reload and try again.", 409);
  }
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") {
    return new FormApiError("Persora Forms needs the latest database migration applied.", 503);
  }
  console.error("Persora Forms database request failed", response.status, code, message);
  return new FormApiError("The Forms database could not complete the request. Please try again shortly.", 502);
}

async function rpc(name, args, env) {
  const response = await fetch(dbUrl(env, `rpc/${name}`), {
    method: "POST",
    headers: dbHeaders(env, { "Content-Type": "application/json" }),
    body: JSON.stringify(args),
  });
  if (!response.ok) throw await databaseError(response);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new FormApiError("This request payload is too large.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new FormApiError("This request payload is too large.", 413);
  try {
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new FormApiError("The request JSON could not be read.", 400);
  }
}

function safeFileName(name) {
  const cleaned = String(name || "image").normalize("NFKC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
  return cleaned || "image";
}

function formSummaryView(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    status: row.status === "published" ? "published" : "draft",
    acceptingResponses: Boolean(row.accepting_responses),
    publicSlug: row.public_slug,
    questionCount: Number(row.question_count) || 0,
    responseCount: Number(row.response_count) || 0,
    quizEnabled: Boolean(row.quiz_enabled),
    eventEnabled: Boolean(row.event_enabled),
    maxRegistrations: row.max_registrations === null || row.max_registrations === undefined ? null : Number(row.max_registrations),
    revision: Number(row.revision) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formDetailView(detail) {
  const form = detail?.form;
  return {
    form: {
      ...formSummaryView(form),
      headerImage: normalizeHeaderImage(form?.header_image),
      questions: Array.isArray(form?.questions) ? form.questions : [],
      settings: normalizeFormSettings(form?.settings),
    },
    assets: (Array.isArray(detail?.assets) ? detail.assets : []).map((a) => ({
      id: a.id,
      role: a.role,
      name: a.name,
      type: a.type,
      size: Number(a.size) || 0,
      createdAt: a.created_at,
    })),
  };
}

function responseItemView(row) {
  return {
    id: row.id,
    respondentName: row.respondent_name || "",
    respondentEmail: row.respondent_email || "",
    answers: row.answers || {},
    quizResult: row.quiz_result || null,
    registrationCode: row.registration_code || null,
    submittedAt: row.submitted_at,
    assets: (Array.isArray(row.assets) ? row.assets : []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      size: Number(a.size) || 0,
    })),
  };
}

async function storeValidatedFormImage({ request, ownerId, formId, role, env, services }) {
  if (!env.VAULT_FILES) throw new FormApiError("Private image storage is not configured.", 503);
  const maxConfiguredBytes = Math.max(1, Math.min(10, Number(services?.maxUploadMb) || 10)) * 1024 * 1024;
  const maxBytes = Math.min(FORM_LIMITS.maxImageBytes, maxConfiguredBytes);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes + 512 * 1024) {
    throw new FormApiError(`Images must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`, 413);
  }
  let formData;
  try { formData = await request.formData(); } catch { throw new FormApiError("The image upload could not be read.", 400); }
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new FormValidationError("Choose a PNG, JPEG, WebP, or GIF image to upload.", "file", 400);
  }
  if (!file.size) {
    throw new FormValidationError("The selected image file is empty.", "file", 400);
  }
  // Check video rejection BEFORE reading large buffers if MIME/extension already reveals video
  if (String(file.type || "").toLowerCase().startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv|3gp|ogv|mpeg|mpg)$/i.test(String(file.name || ""))) {
    throw new FormValidationError(
      "Video uploads are not supported in Persora Forms. Upload a PNG, JPEG, WebP, or GIF image instead.",
      "file",
      415,
    );
  }
  if (file.size > maxBytes) {
    throw new FormApiError(`Images must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verifiedMime = validateFormImageBytes(file.name, file.type, bytes);
  const safeName = safeFileName(file.name);

  if (typeof services?.storageUsage === "function") {
    const usage = await services.storageUsage(ownerId, env.VAULT_FILES, env);
    if (usage.bytesUsed + bytes.byteLength > usage.storageLimitBytes) {
      throw new FormApiError("Storage limit reached for this form.", 413);
    }
  }

  const assetId = isFormUuid(String(formData.get("id") || "")) ? String(formData.get("id")) : crypto.randomUUID();
  const key = `${ownerId}/persora-forms/${crypto.randomUUID()}`;
  await env.VAULT_FILES.put(key, bytes, {
    httpMetadata: { contentType: verifiedMime },
    customMetadata: {
      ownerId,
      persoraForms: "true",
      formId,
      role,
      originalName: safeName,
      createdAt: new Date().toISOString(),
    },
  });
  try {
    const asset = await rpc("persora_form_asset_add", {
      p_owner: ownerId,
      p_form_id: formId,
      p_id: assetId,
      p_role: role,
      p_key: key,
      p_name: safeName,
      p_type: verifiedMime,
      p_size: bytes.byteLength,
    }, env);
    return {
      asset: {
        id: asset.id,
        role: asset.role,
        name: asset.name,
        type: asset.type,
        size: Number(asset.size) || bytes.byteLength,
      },
    };
  } catch (error) {
    try { await env.VAULT_FILES.delete(key); } catch { /* best-effort rollback */ }
    throw error;
  }
}

async function streamFormImage(row, env, origin, cachePublic = false) {
  if (!env.VAULT_FILES) throw new FormApiError("Image storage is not configured.", 503);
  const ownerId = row?.owner_id || "";
  const key = row?.file_key || "";
  if (!ownerId || !key.startsWith(`${ownerId}/persora-forms/`) || key.includes("..")) {
    throw new FormApiError("That image is not available.", 404);
  }
  const object = await env.VAULT_FILES.get(key);
  if (!object || object.customMetadata?.ownerId !== ownerId) {
    throw new FormApiError("That image is not available.", 404);
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": row.type,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name || "image")}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": cachePublic ? "private, max-age=300" : "private, no-store, max-age=0",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

function starterQuestions() {
  return [
    {
      id: `q_${crypto.randomUUID().slice(0, 8)}`,
      type: "short_text",
      title: "Your name or response",
      description: "",
      required: false,
    },
  ];
}

export async function handleForms(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(FORMS_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;

  try {
    if (!segments.length) {
      if (method === "GET") {
        const list = await rpc("persora_forms_list", { p_owner: identity.id }, env);
        return json({ forms: (Array.isArray(list) ? list : []).map(formSummaryView) }, 200, origin);
      }
      if (method === "POST") {
        const body = await readJson(request);
        const id = isFormUuid(body.id) ? body.id : crypto.randomUUID();
        const title = cleanFormText(body.title ?? "Untitled form", FORM_LIMITS.titleLength).trim() || "Untitled form";
        const description = cleanFormText(body.description ?? "", FORM_LIMITS.descriptionLength, true).trim();
        const settings = normalizeFormSettings(body.settings ?? defaultFormSettings());
        const questions = Array.isArray(body.questions) ? normalizeFormQuestions(body.questions) : starterQuestions();
        const detail = await rpc("persora_form_create", {
          p_owner: identity.id,
          p_id: id,
          p_slug: generateFormPublicSlug(),
          p_title: title,
          p_description: description,
          p_questions: questions,
          p_settings: settings,
        }, env);
        return json(formDetailView(detail), 201, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const formId = segments[0];
    if (!isFormUuid(formId)) return json({ error: "That form is not available in your account." }, 404, origin);

    if (segments.length === 1) {
      if (method === "GET") {
        const detail = await rpc("persora_form_get", { p_owner: identity.id, p_id: formId }, env);
        return json(formDetailView(detail), 200, origin);
      }
      if (method === "PUT" || method === "PATCH") {
        const body = await readJson(request);
        const existing = await rpc("persora_form_get", { p_owner: identity.id, p_id: formId }, env);
        const current = existing.form;
        const title = body.title !== undefined
          ? (cleanFormText(body.title, FORM_LIMITS.titleLength).trim() || null)
          : current.title;
        if (body.title !== undefined && !title) throw new FormValidationError("Enter a form title.", "title");
        const description = body.description !== undefined
          ? cleanFormText(body.description, FORM_LIMITS.descriptionLength, true).trim()
          : current.description;
        let status = current.status;
        if (body.status !== undefined) {
          if (body.status !== "draft" && body.status !== "published") {
            throw new FormValidationError("Status must be draft or published.", "status");
          }
          status = body.status;
        }
        const accepting = body.acceptingResponses !== undefined ? Boolean(body.acceptingResponses) : Boolean(current.accepting_responses);
        const headerImage = body.headerImage !== undefined ? normalizeHeaderImage(body.headerImage) : normalizeHeaderImage(current.header_image);
        const questions = body.questions !== undefined ? normalizeFormQuestions(body.questions) : current.questions;
        if (status === "published" && (!Array.isArray(questions) || questions.length < 1)) {
          throw new FormValidationError("Add at least one question before publishing your form.", "questions");
        }
        const settings = body.settings !== undefined ? normalizeFormSettings(body.settings) : normalizeFormSettings(current.settings);
        const rotateSlug = body.regenerateLink === true ? generateFormPublicSlug() : null;

        const saved = await rpc("persora_form_save", {
          p_owner: identity.id,
          p_id: formId,
          p_title: title,
          p_description: description,
          p_status: status,
          p_accepting: accepting,
          p_header_image: headerImage,
          p_questions: questions,
          p_settings: settings,
          p_rotate_slug: rotateSlug,
        }, env);
        return json(formDetailView(saved), 200, origin);
      }
      if (method === "DELETE") {
        const removed = await rpc("persora_form_delete", { p_owner: identity.id, p_id: formId }, env);
        if (typeof services.deleteFileIfUnreferenced === "function" && env.VAULT_FILES) {
          for (const key of Array.isArray(removed?.file_keys) ? removed.file_keys : []) {
            await services.deleteFileIfUnreferenced(identity.id, key, env).catch(() => {});
          }
        }
        return json({ ok: true }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const action = segments[1];
    if (segments.length === 2 && action === "duplicate" && method === "POST") {
      const body = await readJson(request, 16 * 1024);
      const source = await rpc("persora_form_get", { p_owner: identity.id, p_id: formId }, env);
      const nextTitle = cleanFormText(body.title ?? `${source.form.title} (Copy)`, FORM_LIMITS.titleLength).trim() || "Untitled form (Copy)";
      const duplicated = await rpc("persora_form_duplicate", {
        p_owner: identity.id,
        p_source_id: formId,
        p_new_id: isFormUuid(body.id) ? body.id : crypto.randomUUID(),
        p_new_slug: generateFormPublicSlug(),
        p_title: nextTitle,
      }, env);
      return json(formDetailView(duplicated), 201, origin);
    }

    if (segments.length === 2 && action === "responses" && method === "GET") {
      const data = await rpc("persora_form_responses_list", { p_owner: identity.id, p_form_id: formId }, env);
      if (url.searchParams.get("format") === "csv") {
        const detail = await rpc("persora_form_get", { p_owner: identity.id, p_id: formId }, env);
        const csv = buildFormResponsesCsv(
          { questions: detail.form.questions || [], settings: normalizeFormSettings(detail.form.settings) },
          data.responses || [],
        );
        const fileName = `${safeFileName(detail.form.title || "form")}-responses.csv`;
        return new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            "Cache-Control": "private, no-store, max-age=0",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }
      return json({
        responseCount: Number(data.response_count) || 0,
        acceptingResponses: Boolean(data.accepting_responses),
        responses: (Array.isArray(data.responses) ? data.responses : []).map(responseItemView),
      }, 200, origin);
    }

    if (segments.length === 3 && action === "responses" && method === "DELETE") {
      const responseId = segments[2];
      if (!isFormUuid(responseId)) return json({ error: "Choose a valid submission." }, 400, origin);
      const removed = await rpc("persora_form_response_delete", {
        p_owner: identity.id,
        p_form_id: formId,
        p_response_id: responseId,
      }, env);
      if (typeof services.deleteFileIfUnreferenced === "function" && env.VAULT_FILES) {
        for (const key of Array.isArray(removed?.file_keys) ? removed.file_keys : []) {
          await services.deleteFileIfUnreferenced(identity.id, key, env).catch(() => {});
        }
      }
      return json({ ok: true }, 200, origin);
    }

    if (segments.length === 2 && action === "assets" && method === "POST") {
      // Ensure form belongs to identity before accepting upload
      await rpc("persora_form_get", { p_owner: identity.id, p_id: formId }, env);
      const uploaded = await storeValidatedFormImage({
        request,
        ownerId: identity.id,
        formId,
        role: "builder_image",
        env,
        services,
      });
      return json(uploaded, 201, origin);
    }

    if (segments.length === 3 && action === "assets" && method === "GET") {
      const assetId = segments[2];
      if (!isFormUuid(assetId)) return json({ error: "That image is not available." }, 404, origin);
      const row = await rpc("persora_form_asset_get", {
        p_actor: identity.id,
        p_slug: null,
        p_form_id: formId,
        p_asset_id: assetId,
      }, env);
      return await streamFormImage(row, env, origin, false);
    }

    return json({ error: "That Persora Forms route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof FormValidationError) return json({ error: error.message, field: error.field }, error.status || 400, origin);
    if (error instanceof FormApiError) return json({ error: error.message, ...error.extra }, error.status, origin);
    if (typeof error?.status === "number" && error.status >= 400 && error.status < 600) {
      return json({ error: error.message || "Request failed." }, error.status, origin);
    }
    throw error;
  }
}

export async function handlePublicForms(request, env, origin, signedInIdentity = null, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(PUBLIC_FORMS_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;

  try {
    const slug = segments[0] || "";
    if (!SLUG_RE.test(slug)) {
      return json({ error: "This form link is invalid or no longer available." }, 404, origin);
    }

    if (segments.length === 1 && method === "GET") {
      const meta = await rpc("persora_form_public_meta", { p_slug: slug }, env);
      const settings = normalizeFormSettings(meta.settings);
      const maxReg = settings.eventRegistration.enabled ? settings.eventRegistration.maxRegistrations : null;
      const responseCount = Number(meta.response_count) || 0;
      const isFull = maxReg !== null && maxReg > 0 && responseCount >= maxReg;

      return json({
        form: {
          title: meta.title,
          description: meta.description || "",
          acceptingResponses: Boolean(meta.accepting_responses) && !isFull,
          closedReason: !meta.accepting_responses ? "closed" : isFull ? "capacity_full" : null,
          closedMessage: !meta.accepting_responses
            ? settings.closedMessage
            : isFull
              ? "Registration is full — all available spots have been claimed."
              : null,
          requireSignIn: settings.requireSignIn,
          signedIn: Boolean(signedInIdentity),
          headerImage: normalizeHeaderImage(meta.header_image),
          theme: settings.theme,
          questions: sanitizeQuestionsForRespondent(meta.questions || [], settings.quiz.enabled),
          quizEnabled: settings.quiz.enabled,
          eventRegistration: settings.eventRegistration.enabled
            ? {
                enabled: true,
                maxRegistrations: maxReg,
                spotsRemaining: maxReg !== null ? Math.max(0, maxReg - responseCount) : null,
                eventDate: settings.eventRegistration.eventDate,
                eventLocation: settings.eventRegistration.eventLocation,
              }
            : { enabled: false, maxRegistrations: null, spotsRemaining: null, eventDate: "", eventLocation: "" },
        },
      }, 200, origin);
    }

    if (segments.length === 3 && segments[1] === "assets" && method === "GET") {
      const assetId = segments[2];
      if (!isFormUuid(assetId)) return json({ error: "That image is not available." }, 404, origin);
      const row = await rpc("persora_form_asset_get", {
        p_actor: null,
        p_slug: slug,
        p_form_id: null,
        p_asset_id: assetId,
      }, env);
      return await streamFormImage(row, env, origin, true);
    }

    if (segments.length === 2 && segments[1] === "upload" && method === "POST") {
      const meta = await rpc("persora_form_public_meta", { p_slug: slug }, env);
      const settings = normalizeFormSettings(meta.settings);
      if (!meta.accepting_responses) {
        return json({ error: settings.closedMessage || "This form is no longer accepting responses." }, 403, origin);
      }
      const maxReg = settings.eventRegistration.enabled ? settings.eventRegistration.maxRegistrations : null;
      if (maxReg !== null && maxReg > 0 && Number(meta.response_count || 0) >= maxReg) {
        return json({ error: "Registration is full — this form is no longer accepting submissions." }, 409, origin);
      }
      if (settings.requireSignIn && !signedInIdentity) {
        return json({ error: "Sign in with a Persora account to upload an image for this form." }, 401, origin);
      }
      const hasImageUploadQuestion = (meta.questions || []).some((q) => q.type === "image_upload");
      if (!hasImageUploadQuestion) {
        return json({ error: "This form does not accept file uploads." }, 403, origin);
      }
      if (typeof services.checkOwnerUploadPlan === "function" && !(await services.checkOwnerUploadPlan(meta.owner_id))) {
        return json({ error: "File uploads are not enabled for this form." }, 403, origin);
      }
      const uploaded = await storeValidatedFormImage({
        request,
        ownerId: meta.owner_id,
        formId: meta.id,
        role: "response_image",
        env,
        services,
      });
      return json(uploaded, 201, origin);
    }

    if (segments.length === 2 && segments[1] === "submit" && method === "POST") {
      const meta = await rpc("persora_form_public_meta", { p_slug: slug }, env);
      const settings = normalizeFormSettings(meta.settings);
      if (!meta.accepting_responses) {
        return json({ error: settings.closedMessage || "This form is no longer accepting responses." }, 403, origin);
      }
      if (settings.requireSignIn && !signedInIdentity) {
        return json({ error: "Sign in with a Persora account to submit this form." }, 401, origin);
      }
      const body = await readJson(request, 256 * 1024);
      const validated = validateAndScoreSubmission({
        questions: meta.questions || [],
        settings,
        body,
      });
      const registrationCode = settings.eventRegistration.enabled ? generateRegistrationCode() : null;
      const saved = await rpc("persora_form_submit_response", {
        p_slug: slug,
        p_response_id: crypto.randomUUID(),
        p_respondent_user_id: signedInIdentity?.id || null,
        p_respondent_name: validated.respondentName,
        p_respondent_email: validated.respondentEmail,
        p_answers: validated.answers,
        p_quiz_result: validated.quizResult,
        p_registration_code: registrationCode,
        p_asset_ids: validated.assetIds,
      }, env);

      let publicQuizFeedback = null;
      if (settings.quiz.enabled && validated.quizResult && settings.quiz.showScoreImmediately) {
        publicQuizFeedback = {
          score: validated.quizResult.score,
          maxScore: validated.quizResult.maxScore,
          percentage: validated.quizResult.percentage,
          ...(settings.quiz.showCorrectAnswers ? { breakdown: validated.quizResult.breakdown } : {}),
        };
      }

      return json({
        ok: true,
        submittedAt: saved.submitted_at,
        confirmationMessage: settings.confirmationMessage,
        registrationCode: saved.registration_code || null,
        quizResult: publicQuizFeedback,
      }, 201, origin);
    }

    return json({ error: "That public form route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof FormValidationError) return json({ error: error.message, field: error.field }, error.status || 400, origin);
    if (error instanceof FormApiError) return json({ error: error.message, ...error.extra }, error.status, origin);
    throw error;
  }
}

export async function exportFormsData(userId, env) {
  try {
    const data = await rpc("persora_forms_export", { p_owner: userId }, env);
    return {
      forms: Array.isArray(data?.forms) ? data.forms : [],
      responses: Array.isArray(data?.responses) ? data.responses : [],
    };
  } catch (error) {
    if (error?.status === 503) return { forms: [], responses: [] };
    throw error;
  }
}
