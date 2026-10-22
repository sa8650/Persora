// Persora Photo Studio — worker routes for saved official photographs.
//
// Persistence guarantees (see supabase/migrations/202610220006_photo_studio.sql):
//   * Nothing is written before the member's final Save. The browser keeps the
//     selected/edited image in memory; POST /photo-studio/photos is the ONLY
//     route that writes, and it uploads one R2 object and then creates the row
//     (plus an optional new folder) in a single database transaction.
//   * If the transaction fails, the just-uploaded object is removed again, so a
//     failed save leaves no orphan file and no partial row.
//   * Edited versions are new rows (source_photo_id → original); originals are
//     never modified. Deleting moves the row into the global Trash.
//   * The primary AI background-removal route is stateless: the image is
//     processed in memory by Cloudflare Images and returned; nothing is stored.
import { PHOTO_SAVE_TYPES, aspectRatio, matchPreset, readImageInfo, MAX_PHOTO_DIMENSION } from "./photo-metadata.js";

export const PHOTO_STUDIO_ROUTE_PREFIX = "/photo-studio";
export const PHOTO_STUDIO_CATEGORIES = Object.freeze(["passport", "stamp", "visa", "id-card", "job-application", "other"]);
const FOLDER_COLORS = new Set(["blue", "sky", "teal", "violet", "amber", "rose", "slate", "mint"]);
const PHOTO_MAX_BYTES_CAP = 30 * 1024 * 1024;
const BACKGROUND_MAX_BYTES = 12 * 1024 * 1024;
const BACKGROUND_TIMEOUT_MS = 30_000;
const PHOTO_COLUMNS = "id,user_id,folder_id,source_photo_id,title,category,notes,file_name,file_size,file_type,width_px,height_px,dpi,metadata,edit_settings,created_at,updated_at";

export class PhotoStudioError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function headersFor(origin, extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    ...extra,
  };
}
function json(value, status, origin) {
  return new Response(JSON.stringify(value), { status, headers: headersFor(origin) });
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
async function dbFetch(path, env, init = {}) {
  return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) });
}
async function listRows(path, env) {
  const response = await dbFetch(path, env);
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new PhotoStudioError("The Photo Studio service received an invalid record list.", 502);
  return rows;
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new PhotoStudioError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") {
    return new PhotoStudioError("Photo Studio needs its database migration (202610220006_photo_studio.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora Photo Studio database request failed", response.status, code, message);
  return new PhotoStudioError("The Photo Studio database could not complete the request. Please try again shortly.", 502);
}
async function rpc(name, args, env) {
  const response = await dbFetch(`rpc/${name}`, env, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Input sanitising (pure — covered by tests)
// ---------------------------------------------------------------------------
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** Keeps only small JSON-safe values: strings ≤200, finite numbers, booleans, shallow nesting. */
function compactJson(value, depth = 0) {
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (typeof value === "boolean" || value === null) return value;
  if (depth >= 2) return null;
  if (Array.isArray(value)) return value.slice(0, 12).map((entry) => compactJson(entry, depth + 1));
  const object = plainObject(value);
  if (!object) return null;
  const output = {};
  for (const [key, entry] of Object.entries(object).slice(0, 40)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
    const compacted = compactJson(entry, depth + 1);
    if (compacted !== undefined) output[key] = compacted;
  }
  return output;
}

/**
 * Validates the organise-form fields for a new photo (or, with `partial`, a
 * metadata update). Throws PhotoStudioError with a member-facing message.
 */
export function sanitizePhotoInput(raw, { partial = false } = {}) {
  const body = plainObject(raw);
  if (!body) throw new PhotoStudioError("The photo details could not be read.", 400);
  const output = {};
  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title, 121);
    if (!title || title.length > 120) throw new PhotoStudioError("Give the photo a title between 1 and 120 characters.", 400);
    output.title = title;
  }
  if (!partial || body.category !== undefined) {
    const category = String(body.category || "");
    if (!PHOTO_STUDIO_CATEGORIES.includes(category)) throw new PhotoStudioError("Choose a photo category.", 400);
    output.category = category;
  }
  if (!partial || body.notes !== undefined) {
    const notes = cleanText(body.notes, 1001);
    if (notes.length > 1000) throw new PhotoStudioError("Notes can be up to 1,000 characters.", 400);
    output.notes = notes;
  }
  if (!partial || body.folderId !== undefined) {
    const folderId = body.folderId === null || body.folderId === undefined || body.folderId === "" ? null : String(body.folderId);
    if (folderId && !isUuid(folderId)) throw new PhotoStudioError("Choose a valid Photo Studio folder.", 400);
    output.folderId = folderId;
  }
  if (!partial) {
    const newFolder = plainObject(body.newFolder);
    if (newFolder) {
      const name = cleanText(newFolder.name, 65);
      if (!name || name.length > 64) throw new PhotoStudioError("Enter a folder name between 1 and 64 characters.", 400);
      output.newFolder = { name, color: FOLDER_COLORS.has(newFolder.color) ? newFolder.color : "blue" };
      output.folderId = null;
    } else output.newFolder = null;
    const sourcePhotoId = body.sourcePhotoId ? String(body.sourcePhotoId) : null;
    if (sourcePhotoId && !isUuid(sourcePhotoId)) throw new PhotoStudioError("The original photo reference is invalid.", 400);
    output.sourcePhotoId = sourcePhotoId;
    const dpi = body.dpi === null || body.dpi === undefined || body.dpi === "" ? null : Number(body.dpi);
    if (dpi !== null && (!Number.isFinite(dpi) || dpi < 1 || dpi > 10000)) throw new PhotoStudioError("The photo resolution (DPI) must be between 1 and 10,000.", 400);
    output.dpi = dpi;
    output.metadata = compactJson(plainObject(body.metadata) || {}) || {};
    output.editSettings = compactJson(plainObject(body.editSettings) || {}) || {};
    if (JSON.stringify(output.metadata).length > 6000) throw new PhotoStudioError("The photo metadata is too large.", 400);
    if (JSON.stringify(output.editSettings).length > 12000) throw new PhotoStudioError("The edit details are too large.", 400);
    output.fileName = cleanText(body.fileName, 200);
  }
  return output;
}

/** Normalises a saved file name so its extension matches the verified type. */
export function photoFileName(name, mime) {
  const extension = PHOTO_SAVE_TYPES[mime]?.extension || "jpg";
  const base = String(name || "photo").normalize("NFKC").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[^\w.() -]+/g, "_").replace(/^[.\s]+/, "").trim().slice(0, 150) || "photo";
  return `${base}.${extension}`;
}

/**
 * Verifies uploaded bytes are a supported, decodable-looking photo and returns
 * the authoritative header metadata. The declared MIME type must agree.
 */
export function verifyPhotoBytes(bytes, declaredType = "") {
  const info = readImageInfo(bytes);
  if (!info || !PHOTO_SAVE_TYPES[info.mime]) throw new PhotoStudioError("Photo Studio saves JPEG, PNG or WebP photos.", 415);
  const declared = String(declaredType || "").toLowerCase().trim();
  if (declared && declared !== "application/octet-stream" && declared !== info.mime && !(declared === "image/jpg" && info.mime === "image/jpeg")) {
    throw new PhotoStudioError("The photo's file type does not match its contents.", 400);
  }
  if (!(info.width >= 1 && info.height >= 1 && info.width <= MAX_PHOTO_DIMENSION && info.height <= MAX_PHOTO_DIMENSION)) {
    throw new PhotoStudioError("The photo's dimensions could not be read. Choose another image.", 422);
  }
  return info;
}

function photoView(row) {
  return {
    id: row.id, folder_id: row.folder_id || null, source_photo_id: row.source_photo_id || null, title: row.title, category: row.category, notes: row.notes || "",
    file_name: row.file_name, file_size: Number(row.file_size), file_type: row.file_type, width_px: Number(row.width_px), height_px: Number(row.height_px),
    dpi: row.dpi === null || row.dpi === undefined ? null : Number(row.dpi), metadata: plainObject(row.metadata) || {}, edit_settings: plainObject(row.edit_settings) || {},
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function createPhoto(request, identity, env, services) {
  if (!env.VAULT_FILES) throw new PhotoStudioError("Private photo storage is not configured.", 503);
  const maxMb = Math.max(1, Math.min(30, Number(services?.maxUploadMb) || 25));
  const maxBytes = Math.min(PHOTO_MAX_BYTES_CAP, maxMb * 1024 * 1024);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes + 1024 * 1024) throw new PhotoStudioError(`Photos must be ${maxMb} MB or smaller.`, 413);
  let form;
  try { form = await request.formData(); } catch { throw new PhotoStudioError("The photo upload could not be read. Please try saving again.", 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new PhotoStudioError("Choose a photo to save.", 400);
  if (file.size > maxBytes) throw new PhotoStudioError(`Photos must be ${maxMb} MB or smaller.`, 413);
  let rawMeta;
  try { rawMeta = JSON.parse(String(form.get("meta") || "{}")); } catch { throw new PhotoStudioError("The photo details could not be read.", 400); }
  const input = sanitizePhotoInput(rawMeta);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = verifyPhotoBytes(bytes, file.type);

  if (typeof services?.storageUsage !== "function") throw new PhotoStudioError("Private photo storage is unavailable.", 503);
  const usage = await services.storageUsage(identity.id, env.VAULT_FILES, env);
  if (usage.bytesUsed + bytes.byteLength > usage.storageLimitBytes) throw new PhotoStudioError(`This photo exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit.`, 413);

  const dpi = info.dpi ?? input.dpi;
  const match = matchPreset(info.width, info.height, dpi);
  const metadata = {
    ...input.metadata,
    format: info.format,
    aspectRatio: aspectRatio(info.width, info.height).label,
    orientation: info.orientation,
    dpiSource: info.dpi ? info.dpiSource : input.dpi ? "editor" : null,
    presetId: match?.preset.id || null,
    presetExact: Boolean(match?.exact),
  };
  const fileName = photoFileName(input.fileName || file.name, info.mime);
  const key = `${identity.id}/photo-studio/${crypto.randomUUID()}.${PHOTO_SAVE_TYPES[info.mime].extension}`;
  await env.VAULT_FILES.put(key, bytes, {
    httpMetadata: { contentType: info.mime },
    customMetadata: { ownerId: identity.id, photoStudio: "true", originalName: fileName, createdAt: new Date().toISOString() },
  });
  try {
    const result = await rpc("persora_photo_studio_save", {
      p_owner: identity.id,
      p_folder_id: input.folderId,
      p_new_folder_name: input.newFolder?.name || null,
      p_new_folder_color: input.newFolder?.color || null,
      p_source_photo_id: input.sourcePhotoId,
      p_title: input.title,
      p_category: input.category,
      p_notes: input.notes,
      p_file_key: key,
      p_file_name: fileName,
      p_file_size: bytes.byteLength,
      p_file_type: info.mime,
      p_width: info.width,
      p_height: info.height,
      p_dpi: dpi,
      p_metadata: metadata,
      p_edit_settings: input.editSettings,
    }, env);
    const saved = Array.isArray(result) ? result[0] : result;
    if (!isUuid(saved?.photo?.id)) throw new PhotoStudioError("The photo save could not be confirmed. Refresh Photo Studio before retrying.", 502);
    return { photo: photoView(saved.photo), folder: saved.folder || null, createdFolder: Boolean(saved.createdFolder) };
  } catch (error) {
    // Never leave an orphan object behind — but never delete one a committed
    // row references either (a transport error can follow a commit).
    try {
      const refs = await listRows(`photo_studio_photos?file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
      if (!refs.length) await env.VAULT_FILES.delete(key);
    } catch (cleanupError) {
      try { await env.VAULT_FILES.delete(key); } catch { /* logged below */ }
      console.error("Photo Studio upload cleanup", cleanupError instanceof Error ? cleanupError.message : "unknown error");
    }
    throw error;
  }
}

async function updatePhoto(request, identity, photoId, env) {
  let body;
  try { body = await request.json(); } catch { throw new PhotoStudioError("The photo details could not be read.", 400); }
  const input = sanitizePhotoInput(body, { partial: true });
  const patch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.category !== undefined) patch.category = input.category;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.folderId !== undefined) {
    if (input.folderId) {
      const folders = await listRows(`vault_folders?id=eq.${encodeURIComponent(input.folderId)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.photo-studio&select=id&limit=1`, env);
      if (!folders.length) throw new PhotoStudioError("That folder does not belong to Photo Studio.", 403);
    }
    patch.folder_id = input.folderId;
  }
  if (!Object.keys(patch).length) throw new PhotoStudioError("Nothing to update.", 400);
  const response = await dbFetch(`photo_studio_photos?id=eq.${encodeURIComponent(photoId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=${PHOTO_COLUMNS}`, env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new PhotoStudioError("That photo is not available.", 404);
  return { photo: photoView(rows[0]) };
}

async function downloadPhoto(identity, photoId, env, origin, download) {
  if (!env.VAULT_FILES) throw new PhotoStudioError("Private photo storage is not configured.", 503);
  const rows = await listRows(`photo_studio_photos?id=eq.${encodeURIComponent(photoId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=file_key,file_name,file_type,title&limit=1`, env);
  const row = rows[0];
  const key = row?.file_key || "";
  if (!row || !key.startsWith(`${identity.id}/photo-studio/`) || key.includes("..") || key.includes("\\")) throw new PhotoStudioError("That photo is not available.", 404);
  const object = await env.VAULT_FILES.get(key);
  const metadata = object?.customMetadata || {};
  if (!object || metadata.ownerId !== identity.id || metadata.photoStudio !== "true") throw new PhotoStudioError("That private photo is unavailable.", 404);
  const type = PHOTO_SAVE_TYPES[row.file_type] ? row.file_type : "image/jpeg";
  const fileName = photoFileName(row.title || row.file_name, type);
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(object.body, { status: 200, headers: headersFor(origin, {
    "Content-Type": type,
    "Content-Length": String(object.size),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "X-File-Name": encodeURIComponent(fileName),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store, max-age=0",
  }) });
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new PhotoStudioError("The AI background service timed out.", 504, { reason: "timeout", fallback: true })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Primary AI background removal via the Cloudflare Images binding
 * (`segment: "foreground"`, BiRefNet on Workers AI). Stateless: the image is
 * never written to storage or the database. Every failure answers with
 * `fallback: true` so the browser switches to its local model.
 */
async function removeBackground(request, env, services) {
  if (services?.aiEnabled === false) throw new PhotoStudioError("AI background removal is turned off by an administrator.", 503, { reason: "disabled", fallback: true });
  if (services?.planAllowed === false) throw new PhotoStudioError("Cloud AI background removal is included with paid plans.", 403, { reason: "plan", fallback: true });
  const images = env.IMAGES;
  if (!images || typeof images.input !== "function") throw new PhotoStudioError("The AI background service isn't configured on this server.", 503, { reason: "unavailable", fallback: true });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > BACKGROUND_MAX_BYTES + 512 * 1024) throw new PhotoStudioError("Images for AI background removal must be 12 MB or smaller.", 413, { reason: "too-large", fallback: true });
  let form;
  try { form = await request.formData(); } catch { throw new PhotoStudioError("The image could not be read.", 400, { reason: "invalid", fallback: true }); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new PhotoStudioError("Choose an image.", 400, { reason: "invalid", fallback: true });
  if (file.size > BACKGROUND_MAX_BYTES) throw new PhotoStudioError("Images for AI background removal must be 12 MB or smaller.", 413, { reason: "too-large", fallback: true });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = readImageInfo(bytes);
  if (!info || !PHOTO_SAVE_TYPES[info.mime]) throw new PhotoStudioError("AI background removal supports JPEG, PNG or WebP images.", 415, { reason: "invalid", fallback: true });
  let output;
  try {
    const result = await withTimeout(
      images.input(new Blob([bytes]).stream()).transform({ segment: "foreground" }).output({ format: "image/png" }),
      BACKGROUND_TIMEOUT_MS,
    );
    const response = typeof result?.response === "function" ? result.response() : null;
    if (!response) throw new Error("The Images binding returned no image.");
    output = new Uint8Array(await withTimeout(response.arrayBuffer(), BACKGROUND_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof PhotoStudioError) throw error;
    console.error("Photo Studio AI background removal failed", error instanceof Error ? error.message : "unknown error");
    throw new PhotoStudioError("The AI background service couldn't process this photo.", 502, { reason: "failed", fallback: true });
  }
  const outputInfo = readImageInfo(output);
  if (!outputInfo || outputInfo.mime !== "image/png" || !outputInfo.width || !outputInfo.height) {
    throw new PhotoStudioError("The AI background service returned an unusable image.", 502, { reason: "unusable", fallback: true });
  }
  return output;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function handlePhotoStudio(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(PHOTO_STUDIO_ROUTE_PREFIX.length).split("/").filter(Boolean);
  try {
    if (segments[0] === "background-removal" && segments.length === 1) {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
      const output = await removeBackground(request, env, services);
      return new Response(output, { status: 200, headers: headersFor(origin, { "Content-Type": "image/png", "Content-Length": String(output.byteLength), "X-Persora-Background-Source": "cloudflare-images" }) });
    }
    if (segments[0] !== "photos") return json({ error: "That Photo Studio route is not available." }, 404, origin);
    if (segments.length === 1) {
      if (request.method === "GET") {
        const rows = await listRows(`photo_studio_photos?user_id=eq.${encodeURIComponent(identity.id)}&select=${PHOTO_COLUMNS}&order=created_at.desc&limit=1000`, env);
        return json({ photos: rows.map(photoView) }, 200, origin);
      }
      if (request.method === "POST") return json(await createPhoto(request, identity, env, services), 201, origin);
      return json({ error: "Method not allowed." }, 405, origin);
    }
    const photoId = segments[1];
    if (!isUuid(photoId)) return json({ error: "That photo is not available." }, 404, origin);
    if (segments.length === 2) {
      if (request.method === "PATCH") return json(await updatePhoto(request, identity, photoId, env), 200, origin);
      if (request.method === "DELETE") {
        await rpc("persora_photo_studio_trash_move", { p_owner: identity.id, p_id: photoId }, env);
        return json({ ok: true, trashed: true }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }
    if (segments.length === 3 && segments[2] === "file" && request.method === "GET") {
      return await downloadPhoto(identity, photoId, env, origin, url.searchParams.get("download") === "1");
    }
    return json({ error: "That Photo Studio route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof PhotoStudioError) return json({ error: error.message, ...error.extra }, error.status, origin);
    console.error("Persora Photo Studio request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Photo Studio couldn't complete that request. Please try again." }, 500, origin);
  }
}
