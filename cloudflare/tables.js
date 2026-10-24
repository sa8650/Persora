// Persora Table — Pages API routes.
//
// Every route runs for the signed-in member only (api.js authorizes first) and
// every database call passes that member's id, which the SQL functions in
// supabase/migrations/202610300001_persora_table.sql use to scope each
// statement — an id from another account simply isn't found. Input is
// validated here with the shared rules (cloudflare/table-rules.js) and again by
// the database (row locks, revision checks, limits, constraints).
//
// Sharing: tables are owner-only for now. The routes take the table id in the
// path and resolve access through the owner-scoped functions, so a future
// share model can add an access check in one place (loadAccess) without
// changing the client contract.
//
// Saving: PUT /tables/:id/content takes one batch {baseRevision, batchId, …}.
// 200 {ok:true, table} — applied (or a retry of an already applied batch).
// 409 {conflict:true, table} — the table changed elsewhere; nothing written.

import {
  TABLE_KINDS, TABLE_LIMITS, TableValidationError, attachmentIdsIn, cleanName, cleanText, finalizeRecordValues, isUuid,
  normalizeRecordValues, normalizeSaveBatch, normalizeSheetData, normalizeSmartMeta, validateSheetName,
} from "./table-rules.js";
import { TABLE_TEMPLATES } from "./table-templates.js";

export const TABLES_ROUTE_PREFIX = "/tables";
const MAX_CREATE_BYTES = 13 * 1024 * 1024;
const MAX_SAVE_BYTES = TABLE_LIMITS.saveBytes + 256 * 1024;
const ATTACHMENT_MAX_BYTES_CAP = 25 * 1024 * 1024;
const PRUNE_GRACE_MS = 24 * 3_600_000;
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// Executable/script content is refused outright; everything else is stored as
// an opaque private file and always downloaded (never rendered) except the
// raster image types above, which the gallery shows inline.
const BLOCKED_EXTENSIONS = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|mjs|jar|sh|app|dll|html?|xhtml|svg)$/i;

export class TableError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------------------
// HTTP + database plumbing (same conventions as the loan and habit modules)
// ---------------------------------------------------------------------------

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
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
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new TableError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "23514" || code === "22007" || code === "22008" || code === "22P02" || code === "22003") return new TableError("Those table details aren't valid. Check them and try again.", 400);
  if (code === "23505") return new TableError("That change conflicts with another one. Reload and try again.", 409);
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") {
    return new TableError("Persora Table needs its database migration (202610300001_persora_table.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora Table database request failed", response.status, code, message);
  return new TableError("The table database could not complete the request. Please try again shortly.", 502);
}
async function rpc(name, args, env) {
  const response = await fetch(dbUrl(env, `rpc/${name}`), {
    method: "POST", headers: dbHeaders(env, { "Content-Type": "application/json" }), body: JSON.stringify(args),
  });
  if (!response.ok) throw await databaseError(response);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new TableError("This change is too large to send at once.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new TableError("This change is too large to send at once.", 413);
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new TableError("The request could not be read.", 400);
  }
}

// ---------------------------------------------------------------------------
// Shaping and validation
// ---------------------------------------------------------------------------

/** Validates a whole new table (blank, template or import). Nothing is trusted from the client. */
export function normalizeCreateInput(body) {
  if (!isUuid(body?.id)) throw new TableValidationError("The new table needs an id.");
  if (!TABLE_KINDS.includes(body.kind)) throw new TableValidationError("Choose Spreadsheet or Smart Table.");
  const name = cleanName(body.name, TABLE_LIMITS.nameLength, "Table name");
  const label = cleanText(body.label ?? "", TABLE_LIMITS.labelLength);
  const template = typeof body.template === "string" && TABLE_TEMPLATES.some((entry) => entry.id === body.template) ? body.template : null;
  if (body.kind === "spreadsheet") {
    if (body.records?.length || body.meta) throw new TableValidationError("Spreadsheets don't have fields or records.");
    const list = Array.isArray(body.sheets) ? body.sheets : [];
    if (!list.length) throw new TableValidationError("A spreadsheet needs at least one sheet.");
    if (list.length > TABLE_LIMITS.sheets) throw new TableValidationError(`A spreadsheet can have at most ${TABLE_LIMITS.sheets} sheets.`);
    const names = [];
    const sheets = list.map((sheet, index) => {
      if (!isUuid(sheet?.id)) throw new TableValidationError("A sheet is malformed.");
      const sheetName = validateSheetName(sheet.name, names);
      names.push(sheetName);
      return { id: sheet.id, name: sheetName, position: index, data: normalizeSheetData(sheet.data) };
    });
    return { id: body.id, table: { kind: "spreadsheet", name, label, template }, sheets, records: [] };
  }
  if (body.sheets?.length) throw new TableValidationError("Smart Tables don't have sheets.");
  const meta = normalizeSmartMeta(body.meta);
  const fieldIds = new Set(meta.fields.map((field) => field.id));
  const list = Array.isArray(body.records) ? body.records : [];
  if (list.length > TABLE_LIMITS.records) throw new TableValidationError(`A Smart Table can have at most ${TABLE_LIMITS.records.toLocaleString("en")} records.`);
  const seen = new Set();
  const records = list.map((record, index) => {
    if (!isUuid(record?.id) || seen.has(record.id)) throw new TableValidationError("A record is malformed.");
    seen.add(record.id);
    return { id: record.id, position: (index + 1) * 1024, values: normalizeRecordValues(record.values ?? {}, fieldIds), example: record.example === true };
  });
  return { id: body.id, table: { kind: "smart", name, label, template, meta }, sheets: [], records };
}

export function normalizeInfoInput(body) {
  const out = { name: null, label: null, starred: null };
  if (body.name !== undefined) out.name = cleanName(body.name, TABLE_LIMITS.nameLength, "Table name");
  if (body.label !== undefined) out.label = cleanText(body.label, TABLE_LIMITS.labelLength);
  if (body.starred !== undefined) {
    if (typeof body.starred !== "boolean") throw new TableValidationError("Starred must be true or false.");
    out.starred = body.starred;
  }
  if (out.name === null && out.label === null && out.starred === null) throw new TableValidationError("Nothing to change.");
  return out;
}

function tableView(row) {
  if (!row) return null;
  return {
    id: row.id, kind: row.kind, name: row.name, label: row.label || "", starred: Boolean(row.starred), template: row.template || null,
    revision: Number(row.revision), sheetCount: Number(row.sheet_count) || 0, recordCount: Number(row.record_count) || 0, sizeBytes: Number(row.size_bytes) || 0,
    createdAt: row.created_at, updatedAt: row.updated_at, openedAt: row.opened_at || null,
    ...(row.meta ? { meta: row.meta } : {}),
  };
}
function attachmentView(row) {
  return { id: row.id, name: row.name, type: row.type, size: Number(row.size) || 0, createdAt: row.created_at };
}

function safeFileName(name) {
  const cleaned = String(name || "file").normalize("NFKC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
  return cleaned || "file";
}
function safeContentType(type) {
  return typeof type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type.toLowerCase().slice(0, 120) : "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function loadTable(identity, id, env) {
  const detail = await rpc("persora_table_get", { p_owner: identity.id, p_id: id, p_touch: true }, env);
  return detail;
}

/**
 * Removes attachment rows no longer referenced by any record (after a grace
 * period so a recent removal can still be undone), then deletes each stored
 * file that nothing else references. Best effort: never fails the open.
 */
async function pruneAttachments(identity, id, detail, env, services) {
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
  if (!attachments.length || detail.table?.kind !== "smart") return detail;
  const keep = attachmentIdsIn(detail.table.meta, detail.records || []);
  const cutoff = Date.now() - PRUNE_GRACE_MS;
  const stale = attachments.filter((row) => !keep.has(row.id) && Date.parse(row.created_at) < cutoff);
  if (!stale.length) return detail;
  try {
    const keys = await rpc("persora_table_attachments_prune", { p_owner: identity.id, p_table: id, p_keep: [...keep], p_before: new Date(cutoff).toISOString() }, env);
    if (typeof services.deleteFileIfUnreferenced === "function" && env.VAULT_FILES) {
      for (const key of Array.isArray(keys) ? keys : []) await services.deleteFileIfUnreferenced(identity.id, key, env);
    }
    const removed = new Set(stale.map((row) => row.id));
    return { ...detail, attachments: attachments.filter((row) => !removed.has(row.id)) };
  } catch (error) {
    console.error("Persora Table attachment cleanup", error instanceof Error ? error.message : "unknown error");
    return detail;
  }
}

async function saveContent(request, identity, id, env) {
  const body = await readJson(request, MAX_SAVE_BYTES);
  const head = await rpc("persora_table_head", { p_owner: identity.id, p_id: id, p_meta: true }, env);
  let batch = normalizeSaveBatch(head.kind, body);
  if (batch.valuesPending) batch = finalizeRecordValues(batch, normalizeSmartMeta(head.meta).fields);
  const result = await rpc("persora_table_save", {
    p_owner: identity.id, p_id: id, p_base: batch.baseRevision, p_batch: batch.batchId, p_meta: batch.meta,
    p_sheet_upserts: batch.sheetUpserts, p_sheet_deletes: batch.sheetDeletes, p_record_upserts: batch.recordUpserts, p_record_deletes: batch.recordDeletes,
  }, env);
  if (result?.conflict) {
    throw new TableError("This table was changed in another tab or on another device. Your edits were not saved over it.", 409, { conflict: true, table: tableView(result.table) });
  }
  if (!result?.ok || !result.table) throw new TableError("The save could not be confirmed. Your edits are kept on this device; try again.", 502);
  return { ok: true, replayed: Boolean(result.replayed), table: tableView(result.table) };
}

function uploadLimit(services) {
  const maxMb = Math.max(1, Math.min(ATTACHMENT_MAX_BYTES_CAP / 1024 / 1024, Number(services?.maxUploadMb) || 25));
  return { maxMb, maxBytes: maxMb * 1024 * 1024 };
}

async function uploadAttachment(request, identity, tableId, env, services) {
  if (!env.VAULT_FILES) throw new TableError("Private file storage is not configured.", 503);
  if (typeof services?.storageUsage !== "function") throw new TableError("Private file storage is unavailable.", 503);
  const { maxMb, maxBytes } = uploadLimit(services);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes + 1024 * 1024) throw new TableError(`Files must be ${maxMb} MB or smaller.`, 413);
  let form;
  try { form = await request.formData(); } catch { throw new TableError("The upload could not be read. Please try again.", 400); }
  const file = form.get("file");
  const attachmentId = String(form.get("id") || "");
  if (!isUuid(attachmentId)) throw new TableError("The upload needs an id.", 400);
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new TableError("Choose a file to attach.", 400);
  if (file.size > maxBytes) throw new TableError(`Files must be ${maxMb} MB or smaller.`, 413);
  const name = safeFileName(file.name);
  if (BLOCKED_EXTENSIONS.test(name)) throw new TableError("That file type can't be attached. Attach documents, images or spreadsheets instead.", 415);
  const type = safeContentType(file.type);
  if (/javascript|ecmascript|x-msdownload|x-sh|html|svg/.test(type)) throw new TableError("That file type can't be attached. Attach documents, images or spreadsheets instead.", 415);
  // The table must exist and belong to this member before anything is stored.
  const head = await rpc("persora_table_head", { p_owner: identity.id, p_id: tableId, p_meta: false }, env);
  if (head.kind !== "smart") throw new TableError("Files can only be attached to Smart Tables.", 400);
  const usage = await services.storageUsage(identity.id, env.VAULT_FILES, env);
  if (usage.bytesUsed + file.size > usage.storageLimitBytes) throw new TableError(`This file exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit.`, 413);
  const key = `${identity.id}/persora-table/${crypto.randomUUID()}`;
  await env.VAULT_FILES.put(key, file.stream(), {
    httpMetadata: { contentType: type },
    customMetadata: { ownerId: identity.id, persoraTable: "true", originalName: name, createdAt: new Date().toISOString() },
  });
  try {
    const row = await rpc("persora_table_attachment_add", { p_owner: identity.id, p_table: tableId, p_id: attachmentId, p_key: key, p_name: name, p_type: type, p_size: file.size }, env);
    return { attachment: { ...attachmentView(row), ref: { id: row.id, name: row.name, size: Number(row.size) || 0, type: row.type } } };
  } catch (error) {
    try { await env.VAULT_FILES.delete(key); } catch { /* logged below */ }
    throw error;
  }
}

async function serveAttachment(identity, tableId, attachmentId, env, origin, download) {
  if (!env.VAULT_FILES) throw new TableError("Private file storage is not configured.", 503);
  const row = await rpc("persora_table_attachment_get", { p_owner: identity.id, p_table: tableId, p_id: attachmentId }, env);
  const key = row?.file_key || "";
  if (!key.startsWith(`${identity.id}/persora-table/`) || key.includes("..")) throw new TableError("That file is not available.", 404);
  const object = await env.VAULT_FILES.get(key);
  if (!object || object.customMetadata?.ownerId !== identity.id) throw new TableError("That file is not available. It may have been removed from storage.", 404);
  const type = safeContentType(row.type);
  const inline = !download && INLINE_IMAGE_TYPES.has(type);
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": inline ? type : (download ? type : "application/octet-stream"),
      "Content-Length": String(object.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name || "file")}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store, max-age=0",
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
    },
  });
}

/** Account data export (Settings → export): every table with its content and file list. */
export async function exportTableData(userId, env) {
  try {
    const data = await rpc("persora_tables_export", { p_owner: userId }, env);
    return {
      tables: Array.isArray(data?.tables) ? data.tables : [], sheets: Array.isArray(data?.sheets) ? data.sheets : [],
      records: Array.isArray(data?.records) ? data.records : [], attachments: (Array.isArray(data?.attachments) ? data.attachments : []).map(({ file_key: _key, ...rest }) => rest),
    };
  } catch (error) {
    if (error?.status === 503) return { tables: [], sheets: [], records: [], attachments: [] };
    throw error;
  }
}

/**
 * @param {Request} request
 * @param {{ id: string }} identity signed-in member (authorized by api.js)
 * @param {*} env
 * @param {string} origin
 * @param {{ storageUsage?: Function, maxUploadMb?: number, deleteFileIfUnreferenced?: Function }} [services]
 */
export async function handleTables(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(TABLES_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;
  try {
    if (!segments.length) {
      if (method === "GET") {
        const rows = await rpc("persora_tables_list", { p_owner: identity.id }, env);
        return json({ tables: (Array.isArray(rows) ? rows : []).map(tableView), limits: { tables: TABLE_LIMITS.tables } }, 200, origin);
      }
      if (method === "POST") {
        const input = normalizeCreateInput(await readJson(request, MAX_CREATE_BYTES));
        const result = await rpc("persora_table_create", { p_owner: identity.id, p_id: input.id, p_table: input.table, p_sheets: input.sheets, p_records: input.records }, env);
        return json({ table: tableView(result.table), replayed: Boolean(result.replayed) }, result.replayed ? 200 : 201, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }
    if (segments.length === 1 && segments[0] === "people") {
      if (method !== "GET") return json({ error: "Method not allowed." }, 405, origin);
      const people = await rpc("persora_table_people", { p_owner: identity.id }, env);
      return json({ people: Array.isArray(people) ? people : [] }, 200, origin);
    }
    const tableId = segments[0];
    if (!isUuid(tableId)) return json({ error: "That table is not available in your account." }, 404, origin);
    if (segments.length === 1) {
      if (method === "GET") {
        const detail = await pruneAttachments(identity, tableId, await loadTable(identity, tableId, env), env, services);
        return json({
          table: tableView(detail.table), sheets: detail.sheets || [], records: detail.records || [],
          attachments: (detail.attachments || []).map(attachmentView),
        }, 200, origin);
      }
      if (method === "PATCH") {
        const input = normalizeInfoInput(await readJson(request, 16 * 1024));
        const row = await rpc("persora_table_update_info", { p_owner: identity.id, p_id: tableId, p_name: input.name, p_label: input.label, p_starred: input.starred }, env);
        return json({ table: tableView(row) }, 200, origin);
      }
      if (method === "DELETE") {
        const trash = await rpc("persora_table_trash_move", { p_owner: identity.id, p_id: tableId }, env);
        return json({ ok: true, trashed: true, trashId: trash?.id || tableId, expiresAt: trash?.expires_at || null }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }
    const action = segments[1];
    if (segments.length === 2 && action === "revision" && method === "GET") {
      const head = await rpc("persora_table_head", { p_owner: identity.id, p_id: tableId, p_meta: false }, env);
      return json({ table: tableView(head) }, 200, origin);
    }
    if (segments.length === 2 && action === "content" && method === "PUT") return json(await saveContent(request, identity, tableId, env), 200, origin);
    if (segments.length === 2 && action === "duplicate" && method === "POST") {
      const body = await readJson(request, 16 * 1024);
      if (!isUuid(body.id)) throw new TableValidationError("The copy needs an id.");
      const name = cleanName(body.name, TABLE_LIMITS.nameLength, "Table name");
      const result = await rpc("persora_table_duplicate", { p_owner: identity.id, p_source: tableId, p_new_id: body.id, p_name: name }, env);
      return json({ table: tableView(result.table), replayed: Boolean(result.replayed) }, result.replayed ? 200 : 201, origin);
    }
    if (segments.length === 2 && action === "attachments" && method === "POST") return json(await uploadAttachment(request, identity, tableId, env, services), 201, origin);
    if (segments.length === 3 && action === "attachments" && method === "GET") {
      if (!isUuid(segments[2])) return json({ error: "That file is not available." }, 404, origin);
      return await serveAttachment(identity, tableId, segments[2], env, origin, url.searchParams.get("download") === "1");
    }
    return json({ error: "That table route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof TableValidationError) return json({ error: error.message, field: error.field || null }, error.status || 400, origin);
    if (error instanceof TableError) return json({ error: error.message, ...error.extra }, error.status, origin);
    throw error;
  }
}
