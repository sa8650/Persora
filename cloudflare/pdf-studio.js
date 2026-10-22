// Persora PDF Studio — worker routes for saved PDF documents.
//
// Persistence guarantees (see supabase/migrations/202610230008_pdf_studio.sql):
//   * PDFs are created, opened and edited entirely in the browser (PDF.js +
//     pdf-lib). Nothing reaches R2 or the database while a member works.
//   * POST /pdf-studio/documents (Save to Persora → save as a new PDF) and
//     PUT /pdf-studio/documents/:id/file (Save to Persora → update the saved
//     PDF) are the ONLY routes that store a file. Each uploads one R2 object,
//     then commits the row in a single database transaction; if that fails the
//     just-uploaded object is removed again, so no orphan file or partial row
//     is ever left behind. A replaced file is deleted only after the new one is
//     committed.
//   * Deleting moves the row into the global Trash (7-day restore window). The
//     R2 object is released by the existing Trash purge pipeline.

export const PDF_STUDIO_ROUTE_PREFIX = "/pdf-studio";
const FOLDER_COLORS = new Set(["blue", "sky", "teal", "violet", "amber", "rose", "slate", "mint"]);
/** Absolute cap; the admin "max upload size" setting applies below it. */
const PDF_MAX_BYTES_CAP = 150 * 1024 * 1024;
export const PDF_MAX_PAGES = 5000;
export const PDF_THUMBNAIL_MAX_CHARS = 60_000;
const DOCUMENT_COLUMNS = "id,user_id,folder_id,title,notes,file_name,file_size,page_count,thumbnail,metadata,created_at,updated_at";

export class PdfStudioError extends Error {
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
  if (!Array.isArray(rows)) throw new PdfStudioError("The PDF Studio service received an invalid record list.", 502);
  return rows;
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new PdfStudioError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") {
    return new PdfStudioError("PDF Studio needs its database migration (202610230008_pdf_studio.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora PDF Studio database request failed", response.status, code, message);
  return new PdfStudioError("The PDF Studio database could not complete the request. Please try again shortly.", 502);
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
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Validation (pure — covered by tests)
// ---------------------------------------------------------------------------

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
  for (const [key, entry] of Object.entries(object).slice(0, 30)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
    const compacted = compactJson(entry, depth + 1);
    if (compacted !== undefined) output[key] = compacted;
  }
  return output;
}

/** A small JPEG preview of the first page, as a data URL. Returns null when absent or invalid. */
export function sanitizeThumbnail(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (text.length > PDF_THUMBNAIL_MAX_CHARS) throw new PdfStudioError("The PDF preview image is too large.", 400);
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(text);
  if (!match) throw new PdfStudioError("The PDF preview image is invalid.", 400);
  let head;
  try { head = atob(match[1].slice(0, 8)); } catch { throw new PdfStudioError("The PDF preview image is invalid.", 400); }
  if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8) throw new PdfStudioError("The PDF preview image is invalid.", 400);
  return text;
}

/**
 * Validates the save-form fields for a new PDF (or, with `partial`, a details
 * update; with `fileOnly`, the metadata sent with a replacement file).
 */
export function sanitizePdfInput(raw, { partial = false, fileOnly = false } = {}) {
  const body = plainObject(raw);
  if (!body) throw new PdfStudioError("The PDF details could not be read.", 400);
  const output = {};
  if (!fileOnly) {
    if (!partial || body.title !== undefined) {
      const title = cleanText(body.title, 151);
      if (!title || title.length > 150) throw new PdfStudioError("Give the PDF a title between 1 and 150 characters.", 400);
      output.title = title;
    }
    if (!partial || body.notes !== undefined) {
      const notes = cleanText(body.notes, 1001);
      if (notes.length > 1000) throw new PdfStudioError("Notes can be up to 1,000 characters.", 400);
      output.notes = notes;
    }
    if (!partial || body.folderId !== undefined) {
      const folderId = body.folderId === null || body.folderId === undefined || body.folderId === "" ? null : String(body.folderId);
      if (folderId && !isUuid(folderId)) throw new PdfStudioError("Choose a valid PDF Studio folder.", 400);
      output.folderId = folderId;
    }
    if (!partial) {
      const newFolder = plainObject(body.newFolder);
      if (newFolder) {
        const name = cleanText(newFolder.name, 65);
        if (!name || name.length > 64) throw new PdfStudioError("Enter a folder name between 1 and 64 characters.", 400);
        output.newFolder = { name, color: FOLDER_COLORS.has(newFolder.color) ? newFolder.color : "blue" };
        output.folderId = null;
      } else output.newFolder = null;
    }
  }
  if (!partial) {
    const pageCount = Number(body.pageCount);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > PDF_MAX_PAGES) throw new PdfStudioError(`A saved PDF must have between 1 and ${PDF_MAX_PAGES.toLocaleString("en-US")} pages.`, 400);
    output.pageCount = pageCount;
    output.thumbnail = sanitizeThumbnail(body.thumbnail);
    output.metadata = compactJson(plainObject(body.metadata) || {}) || {};
    if (JSON.stringify(output.metadata).length > 4000) throw new PdfStudioError("The PDF details are too large.", 400);
    output.fileName = cleanText(body.fileName, 200);
  }
  return output;
}

/** Normalises a saved file name so it always ends in .pdf and is safe in headers. */
export function pdfFileName(name) {
  const base = String(name || "document").normalize("NFKC").replace(/\.pdf$/i, "").replace(/[^\p{L}\p{M}\p{N}_.() -]+/gu, "_").replace(/^[.\s]+/, "").trim().slice(0, 150) || "document";
  return `${base}.pdf`;
}

/**
 * Checks that uploaded bytes look like a complete PDF: a `%PDF-1.x`/`%PDF-2.x`
 * header near the start and an `%%EOF` marker near the end.
 */
export function verifyPdfBytes(bytes, declaredType = "") {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) throw new PdfStudioError("PDF Studio only saves PDF files.", 415);
  const declared = String(declaredType || "").toLowerCase().trim();
  if (declared && declared !== "application/pdf" && declared !== "application/octet-stream" && declared !== "application/x-pdf") {
    throw new PdfStudioError("The file type does not match a PDF.", 415);
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.byteLength)));
  const version = /%PDF-([12]\.\d)/.exec(head);
  if (!version) throw new PdfStudioError("This file isn't a valid PDF.", 415);
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.byteLength - 2048)));
  if (!tail.includes("%%EOF")) throw new PdfStudioError("This PDF looks incomplete. Export it again and retry.", 422);
  return { version: version[1] };
}

function documentView(row) {
  return {
    id: row.id, folder_id: row.folder_id || null, title: row.title, notes: row.notes || "",
    file_name: row.file_name, file_size: Number(row.file_size), page_count: Number(row.page_count), thumbnail: row.thumbnail || null,
    metadata: plainObject(row.metadata) || {}, created_at: row.created_at, updated_at: row.updated_at,
  };
}

function uploadLimit(services) {
  const maxMb = Math.max(1, Math.min(PDF_MAX_BYTES_CAP / 1024 / 1024, Number(services?.maxUploadMb) || 25));
  return { maxMb, maxBytes: Math.min(PDF_MAX_BYTES_CAP, maxMb * 1024 * 1024) };
}

/** Reads the multipart body (file + meta) for both write routes. */
async function readUpload(request, services, sanitizeOptions) {
  const { maxMb, maxBytes } = uploadLimit(services);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes + 1024 * 1024) throw new PdfStudioError(`PDFs must be ${maxMb} MB or smaller to save to Persora.`, 413);
  let form;
  try { form = await request.formData(); } catch { throw new PdfStudioError("The PDF upload could not be read. Please try saving again.", 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new PdfStudioError("Choose a PDF to save.", 400);
  if (file.size > maxBytes) throw new PdfStudioError(`PDFs must be ${maxMb} MB or smaller to save to Persora.`, 413);
  let rawMeta;
  try { rawMeta = JSON.parse(String(form.get("meta") || "{}")); } catch { throw new PdfStudioError("The PDF details could not be read.", 400); }
  const input = sanitizePdfInput(rawMeta, sanitizeOptions);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = verifyPdfBytes(bytes, file.type);
  return { input, bytes, info, fileName: file.name };
}

async function checkQuota(identity, env, services, addedBytes, releasedBytes = 0) {
  if (typeof services?.storageUsage !== "function") throw new PdfStudioError("Private PDF storage is unavailable.", 503);
  const usage = await services.storageUsage(identity.id, env.VAULT_FILES, env);
  if (usage.bytesUsed - releasedBytes + addedBytes > usage.storageLimitBytes) {
    throw new PdfStudioError(`This PDF exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit.`, 413);
  }
}

async function putObject(env, identity, bytes, fileName) {
  const key = `${identity.id}/pdf-studio/${crypto.randomUUID()}.pdf`;
  await env.VAULT_FILES.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { ownerId: identity.id, pdfStudio: "true", originalName: fileName, createdAt: new Date().toISOString() },
  });
  return key;
}

/** Removes a just-uploaded object unless a committed row references it (a transport error can follow a commit). */
async function cleanupUpload(env, key) {
  try {
    const refs = await listRows(`pdf_studio_documents?file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
    if (!refs.length) await env.VAULT_FILES.delete(key);
  } catch (cleanupError) {
    try { await env.VAULT_FILES.delete(key); } catch { /* logged below */ }
    console.error("PDF Studio upload cleanup", cleanupError instanceof Error ? cleanupError.message : "unknown error");
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function createDocument(request, identity, env, services) {
  if (!env.VAULT_FILES) throw new PdfStudioError("Private PDF storage is not configured.", 503);
  const { input, bytes, info, fileName: uploadedName } = await readUpload(request, services, {});
  await checkQuota(identity, env, services, bytes.byteLength);
  const fileName = pdfFileName(input.fileName || uploadedName || input.title);
  const key = await putObject(env, identity, bytes, fileName);
  try {
    const result = await rpc("persora_pdf_studio_save", {
      p_owner: identity.id,
      p_folder_id: input.folderId,
      p_new_folder_name: input.newFolder?.name || null,
      p_new_folder_color: input.newFolder?.color || null,
      p_title: input.title,
      p_notes: input.notes,
      p_file_key: key,
      p_file_name: fileName,
      p_file_size: bytes.byteLength,
      p_page_count: input.pageCount,
      p_thumbnail: input.thumbnail,
      p_metadata: { ...input.metadata, pdfVersion: info.version },
    }, env);
    const saved = Array.isArray(result) ? result[0] : result;
    if (!isUuid(saved?.document?.id)) throw new PdfStudioError("The PDF save could not be confirmed. Refresh PDF Studio before retrying.", 502);
    return { document: documentView(saved.document), folder: saved.folder || null, createdFolder: Boolean(saved.createdFolder) };
  } catch (error) {
    await cleanupUpload(env, key);
    throw error;
  }
}

async function replaceDocumentFile(request, identity, documentId, env, services) {
  if (!env.VAULT_FILES) throw new PdfStudioError("Private PDF storage is not configured.", 503);
  const existing = await listRows(`pdf_studio_documents?id=eq.${encodeURIComponent(documentId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=id,file_size,file_name,title&limit=1`, env);
  if (!existing.length) throw new PdfStudioError("That PDF is no longer in your PDF Studio. Save it as a new PDF instead.", 404);
  const { input, bytes, info } = await readUpload(request, services, { fileOnly: true });
  await checkQuota(identity, env, services, bytes.byteLength, Number(existing[0].file_size) || 0);
  const fileName = pdfFileName(input.fileName || existing[0].file_name || existing[0].title);
  const key = await putObject(env, identity, bytes, fileName);
  let result;
  try {
    result = await rpc("persora_pdf_studio_replace_file", {
      p_owner: identity.id,
      p_id: documentId,
      p_file_key: key,
      p_file_name: fileName,
      p_file_size: bytes.byteLength,
      p_page_count: input.pageCount,
      p_thumbnail: input.thumbnail,
      p_metadata: { ...input.metadata, pdfVersion: info.version },
    }, env);
  } catch (error) {
    await cleanupUpload(env, key);
    throw error;
  }
  const saved = Array.isArray(result) ? result[0] : result;
  if (!isUuid(saved?.document?.id)) throw new PdfStudioError("The PDF update could not be confirmed. Refresh PDF Studio before retrying.", 502);
  // The new file is committed; the previous object is no longer referenced.
  const previousKey = typeof saved.previousKey === "string" ? saved.previousKey : "";
  if (previousKey && previousKey !== key && previousKey.startsWith(`${identity.id}/pdf-studio/`)) {
    try { await env.VAULT_FILES.delete(previousKey); }
    catch (error) { console.error("PDF Studio previous file cleanup pending", error instanceof Error ? error.message : "unknown error"); }
  }
  return { document: documentView(saved.document) };
}

async function updateDocument(request, identity, documentId, env) {
  let body;
  try { body = await request.json(); } catch { throw new PdfStudioError("The PDF details could not be read.", 400); }
  const input = sanitizePdfInput(body, { partial: true });
  const patch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.folderId !== undefined) {
    if (input.folderId) {
      const folders = await listRows(`vault_folders?id=eq.${encodeURIComponent(input.folderId)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.pdf-studio&select=id&limit=1`, env);
      if (!folders.length) throw new PdfStudioError("That folder does not belong to PDF Studio.", 403);
    }
    patch.folder_id = input.folderId;
  }
  if (!Object.keys(patch).length) throw new PdfStudioError("Nothing to update.", 400);
  const response = await dbFetch(`pdf_studio_documents?id=eq.${encodeURIComponent(documentId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=${DOCUMENT_COLUMNS}`, env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new PdfStudioError("That PDF is not available.", 404);
  return { document: documentView(rows[0]) };
}

async function serveDocumentFile(identity, documentId, env, origin, download) {
  if (!env.VAULT_FILES) throw new PdfStudioError("Private PDF storage is not configured.", 503);
  const rows = await listRows(`pdf_studio_documents?id=eq.${encodeURIComponent(documentId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=file_key,file_name,title&limit=1`, env);
  const row = rows[0];
  const key = row?.file_key || "";
  if (!row || !key.startsWith(`${identity.id}/pdf-studio/`) || key.includes("..") || key.includes("\\")) throw new PdfStudioError("That PDF is not available.", 404);
  const object = await env.VAULT_FILES.get(key);
  const metadata = object?.customMetadata || {};
  if (!object || metadata.ownerId !== identity.id || metadata.pdfStudio !== "true") throw new PdfStudioError("That private PDF is unavailable.", 404);
  const fileName = pdfFileName(row.title || row.file_name);
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(object.body, { status: 200, headers: headersFor(origin, {
    "Content-Type": "application/pdf",
    "Content-Length": String(object.size),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "X-File-Name": encodeURIComponent(fileName),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store, max-age=0",
  }) });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function handlePdfStudio(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(PDF_STUDIO_ROUTE_PREFIX.length).split("/").filter(Boolean);
  try {
    if (segments[0] !== "documents") return json({ error: "That PDF Studio route is not available." }, 404, origin);
    if (segments.length === 1) {
      if (request.method === "GET") {
        const rows = await listRows(`pdf_studio_documents?user_id=eq.${encodeURIComponent(identity.id)}&select=${DOCUMENT_COLUMNS}&order=updated_at.desc&limit=1000`, env);
        return json({ documents: rows.map(documentView) }, 200, origin);
      }
      if (request.method === "POST") return json(await createDocument(request, identity, env, services), 201, origin);
      return json({ error: "Method not allowed." }, 405, origin);
    }
    const documentId = segments[1];
    if (!isUuid(documentId)) return json({ error: "That PDF is not available." }, 404, origin);
    if (segments.length === 2) {
      if (request.method === "PATCH") return json(await updateDocument(request, identity, documentId, env), 200, origin);
      if (request.method === "DELETE") {
        await rpc("persora_pdf_studio_trash_move", { p_owner: identity.id, p_id: documentId }, env);
        return json({ ok: true, trashed: true }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }
    if (segments.length === 3 && segments[2] === "file") {
      if (request.method === "GET") return await serveDocumentFile(identity, documentId, env, origin, url.searchParams.get("download") === "1");
      if (request.method === "PUT") return json(await replaceDocumentFile(request, identity, documentId, env, services), 200, origin);
      return json({ error: "Method not allowed." }, 405, origin);
    }
    return json({ error: "That PDF Studio route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof PdfStudioError) return json({ error: error.message, ...error.extra }, error.status, origin);
    console.error("Persora PDF Studio request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "PDF Studio couldn't complete that request. Please try again." }, 500, origin);
  }
}
