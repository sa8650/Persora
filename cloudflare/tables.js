// Persora Table — Pages API routes.
//
// Authenticated routes run under /tables for signed-in Persora members and
// enforce table access ('owner' | 'edit' | 'comment' | 'view') server-side
// and in Postgres security-definer RPCs.
// Public link routes run under /public/tables/:token without requiring sign-in
// and enforce link-level 'view' or 'comment' access while stripping all private
// account metadata.

import {
  TABLE_KINDS, TABLE_LIMITS, TableValidationError, attachmentIdsIn, cleanName, cleanText, finalizeRecordValues, isUuid,
  normalizeRecordValues, normalizeSaveBatch, normalizeSheetData, normalizeSmartMeta, validateSheetName,
} from "./table-rules.js";
import { WorkbookCalculator, isFormulaError } from "./table-formula.js";
import { TABLE_TEMPLATES } from "./table-templates.js";

export const TABLES_ROUTE_PREFIX = "/tables";
export const PUBLIC_TABLES_ROUTE_PREFIX = "/public/tables";
const MAX_CREATE_BYTES = 13 * 1024 * 1024;
const MAX_SAVE_BYTES = TABLE_LIMITS.saveBytes + 256 * 1024;
const ATTACHMENT_MAX_BYTES_CAP = 25 * 1024 * 1024;
const PRUNE_GRACE_MS = 24 * 3_600_000;
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const BLOCKED_EXTENSIONS = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|mjs|jar|sh|app|dll|html?|xhtml|svg)$/i;
const VALID_MEMBER_PERMISSIONS = new Set(["view", "comment", "edit"]);
const VALID_LINK_PERMISSIONS = new Set(["view", "comment", "edit"]);
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export class TableError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function generateTableShareToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ---------------------------------------------------------------------------
// HTTP + database plumbing
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
    return new TableError("Persora Table needs the Persora database schema (supabase/schema.sql). Ask an administrator to apply it.", 503);
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
  const shared = Boolean(row.shared);
  const permission = typeof row.permission === "string" ? row.permission : "owner";
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    label: row.label || "",
    starred: Boolean(row.starred),
    template: row.template || null,
    revision: Number(row.revision),
    sheetCount: Number(row.sheet_count) || 0,
    recordCount: Number(row.record_count) || 0,
    sizeBytes: Number(row.size_bytes) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at || null,
    shared,
    ...(row.has_shares ? { hasShares: true } : {}),
    permission,
    ...(shared ? {
      shareId: row.share_id || null,
      ownerId: row.owner_id || null,
      ownerName: row.owner_name || "Persora Member",
      ownerLoginId: row.owner_login_id || null,
    } : {}),
    ...(row.meta ? { meta: row.meta } : {}),
  };
}
function publicTableView(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    revision: Number(row.revision),
    sheetCount: Number(row.sheet_count) || 0,
    recordCount: Number(row.record_count) || 0,
    updatedAt: row.updated_at,
    ...(row.meta ? { meta: row.meta } : {}),
  };
}
function attachmentView(row) {
  return { id: row.id, name: row.name, type: row.type, size: Number(row.size) || 0, createdAt: row.created_at };
}
function commentView(row) {
  return {
    id: row.id,
    authorName: row.author_name || "Persora Member",
    targetKind: row.target_kind || "table",
    sheetId: row.sheet_id || null,
    cellRef: row.cell_ref || null,
    recordId: row.record_id || null,
    body: row.body || "",
    createdAt: row.created_at,
  };
}
function shareMemberView(row) {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name || "Persora Member",
    recipientLoginId: row.recipient_login_id || "",
    recipientEmail: row.recipient_email || "",
    permission: row.permission,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function shareLinkView(row) {
  return {
    enabled: Boolean(row?.enabled && row?.share_token),
    permission: row?.permission === "edit" ? "edit" : row?.permission === "comment" ? "comment" : "view",
    shareToken: row?.enabled && row?.share_token ? row.share_token : null,
    updatedAt: row?.updated_at || null,
  };
}

function safeFileName(name) {
  const cleaned = String(name || "file").normalize("NFKC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
  return cleaned || "file";
}
function safeContentType(type) {
  return typeof type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type.toLowerCase().slice(0, 120) : "application/octet-stream";
}
function actorDisplayName(identity) {
  const raw = typeof identity?.full_name === "string" && identity.full_name.trim()
    ? identity.full_name.trim()
    : typeof identity?.email === "string" && identity.email.includes("@")
      ? identity.email.split("@")[0]
      : "Persora Member";
  return cleanText(raw, 80).replace(/\s+/gu, " ").trim() || "Persora Member";
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function loadTable(identity, id, env, touch = true) {
  return await rpc("persora_table_get", { p_owner: identity.id, p_id: id, p_touch: Boolean(touch) }, env);
}

const PREVIEW_SHEET_ROWS = 12;
const PREVIEW_SHEET_COLS = 6;
const PREVIEW_SMART_RECORDS = 10;

/**
 * Builds a lightweight, read-only dashboard card preview payload from a loaded table
 * without stripping formula accuracy (evaluates cross-sheet/deep formulas before trimming).
 */
function buildTablePreviewResponse(detail) {
  const table = tableView(detail.table);
  if (table?.kind === "spreadsheet") {
    const rawSheets = Array.isArray(detail.sheets) ? detail.sheets : [];
    if (!rawSheets.length) {
      return { table, sheets: [], records: [], attachments: [], comments: [] };
    }
    const sheetMap = new Map(rawSheets.map((s) => [s.id, s]));
    const calc = new WorkbookCalculator({
      sheets: () => rawSheets.map((s) => ({
        id: s.id,
        name: s.name,
        rows: Number(s.data?.rowCount ?? s.data?.rows) || 100,
        cols: Number(s.data?.colCount ?? s.data?.cols) || 26,
      })),
      cell: (sheetId, row, col) => sheetMap.get(sheetId)?.data?.cells?.[`${row}:${col}`],
      *formulaCells(sheetId) {
        const cells = sheetMap.get(sheetId)?.data?.cells || {};
        for (const [key, cell] of Object.entries(cells)) {
          if (cell && typeof cell.f === "string") {
            const [r, c] = key.split(":").map(Number);
            if (Number.isInteger(r) && Number.isInteger(c)) yield [r, c, cell.f];
          }
        }
      },
    });
    const first = rawSheets[0];
    const srcData = first.data || {};
    const srcCells = srcData.cells || {};
    const trimmedCells = {};
    const rowCount = Number(srcData.rowCount ?? srcData.rows) || 100;
    const colCount = Number(srcData.colCount ?? srcData.cols) || 26;
    const maxR = Math.min(PREVIEW_SHEET_ROWS, rowCount);
    const maxC = Math.min(PREVIEW_SHEET_COLS, colCount);
    for (let r = 0; r < maxR; r += 1) {
      for (let c = 0; c < maxC; c += 1) {
        const key = `${r}:${c}`;
        const raw = srcCells[key];
        if (!raw) continue;
        if (typeof raw.f === "string") {
          const evaluated = calc.value(first.id, r, c);
          const next = {};
          if (isFormulaError(evaluated)) {
            next.v = evaluated.error;
            next.fe = 1;
          } else if (evaluated !== null && evaluated !== undefined && evaluated !== "") {
            next.v = evaluated;
          }
          if (raw.s) next.s = raw.s;
          if (Object.keys(next).length) trimmedCells[key] = next;
        } else {
          const next = {};
          if (raw.v !== undefined && raw.v !== "") next.v = raw.v;
          if (raw.s) next.s = raw.s;
          if (Object.keys(next).length) trimmedCells[key] = next;
        }
      }
    }
    const trimmedColWidths = {};
    if (srcData.colWidths && typeof srcData.colWidths === "object") {
      for (let c = 0; c < maxC; c += 1) {
        if (srcData.colWidths[c]) trimmedColWidths[c] = srcData.colWidths[c];
      }
    }
    const trimmedMerges = Array.isArray(srcData.merges)
      ? srcData.merges.filter((m) => m && m.r1 < maxR && m.c1 < maxC)
      : [];
    const previewSheet = {
      id: first.id,
      position: first.position ?? 0,
      name: first.name || "Sheet1",
      data: {
        rowCount,
        colCount,
        frozenRows: Math.min(maxR, Number(srcData.frozenRows) || 0),
        frozenCols: Math.min(maxC, Number(srcData.frozenCols) || 0),
        colWidths: trimmedColWidths,
        rowHeights: {},
        merges: trimmedMerges,
        cells: trimmedCells,
      },
    };
    return { table, sheets: [previewSheet], records: [], attachments: [], comments: [] };
  }
  const records = Array.isArray(detail.records) ? detail.records.slice(0, PREVIEW_SMART_RECORDS) : [];
  return { table, sheets: [], records, attachments: [], comments: [] };
}

async function pruneAttachments(identity, id, detail, env, services) {
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
  const role = detail.table?.permission || "owner";
  if (!attachments.length || detail.table?.kind !== "smart" || (role !== "owner" && role !== "edit")) return detail;
  const keep = attachmentIdsIn(detail.table.meta, detail.records || []);
  const cutoff = Date.now() - PRUNE_GRACE_MS;
  const stale = attachments.filter((row) => !keep.has(row.id) && Date.parse(row.created_at) < cutoff);
  if (!stale.length) return detail;
  const ownerId = detail.table?.owner_id || identity.id;
  try {
    const keys = await rpc("persora_table_attachments_prune", { p_owner: identity.id, p_table: id, p_keep: [...keep], p_before: new Date(cutoff).toISOString() }, env);
    if (typeof services.deleteFileIfUnreferenced === "function" && env.VAULT_FILES) {
      for (const key of Array.isArray(keys) ? keys : []) await services.deleteFileIfUnreferenced(ownerId, key, env);
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
  if (head.permission && head.permission !== "owner" && head.permission !== "edit") {
    throw new TableError("You do not have edit permission for this shared table.", 403);
  }
  let batch = normalizeSaveBatch(head.kind, body);
  if (batch.valuesPending) batch = finalizeRecordValues(batch, normalizeSmartMeta(batch.meta || head.meta).fields);
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

async function savePublicContent(request, token, env) {
  const body = await readJson(request, MAX_SAVE_BYTES);
  const detail = await rpc("persora_table_public_get", { p_token: token }, env);
  if (detail?.permission !== "edit") {
    throw new TableError("Editing is disabled for this shared link.", 403);
  }
  let batch = normalizeSaveBatch(detail.table.kind, body);
  if (batch.valuesPending) batch = finalizeRecordValues(batch, normalizeSmartMeta(batch.meta || detail.table.meta).fields);
  const result = await rpc("persora_table_public_save", {
    p_token: token,
    p_base: batch.baseRevision,
    p_batch: batch.batchId,
    p_meta: batch.meta,
    p_sheet_upserts: batch.sheetUpserts,
    p_sheet_deletes: batch.sheetDeletes,
    p_record_upserts: batch.recordUpserts,
    p_record_deletes: batch.recordDeletes,
  }, env);
  if (result?.conflict) {
    throw new TableError("This shared table was updated elsewhere. Reload to get the latest revision before saving.", 409, {
      conflict: true,
      table: publicTableView(result.table),
    });
  }
  if (!result?.ok || !result.table) {
    throw new TableError("The save could not be confirmed. Please try again.", 502);
  }
  return { ok: true, replayed: Boolean(result.replayed), table: publicTableView(result.table) };
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
  const head = await rpc("persora_table_head", { p_owner: identity.id, p_id: tableId, p_meta: false }, env);
  if (head.permission && head.permission !== "owner" && head.permission !== "edit") {
    throw new TableError("You do not have edit permission for this shared table.", 403);
  }
  if (head.kind !== "smart") throw new TableError("Files can only be attached to Smart Tables.", 400);
  const ownerId = head.owner_id || identity.id;
  const usage = await services.storageUsage(ownerId, env.VAULT_FILES, env);
  if (usage.bytesUsed + file.size > usage.storageLimitBytes) throw new TableError(`This file exceeds the table owner's ${usage.storageLimitGb} GB ${usage.planName} storage limit.`, 413);
  const key = `${ownerId}/persora-table/${crypto.randomUUID()}`;
  await env.VAULT_FILES.put(key, file.stream(), {
    httpMetadata: { contentType: type },
    customMetadata: { ownerId, persoraTable: "true", originalName: name, createdAt: new Date().toISOString() },
  });
  try {
    const row = await rpc("persora_table_attachment_add", { p_owner: identity.id, p_table: tableId, p_id: attachmentId, p_key: key, p_name: name, p_type: type, p_size: file.size }, env);
    return { attachment: { ...attachmentView(row), ref: { id: row.id, name: row.name, size: Number(row.size) || 0, type: row.type } } };
  } catch (error) {
    try { await env.VAULT_FILES.delete(key); } catch { /* logged below */ }
    throw error;
  }
}

async function streamStoredAttachment(row, fallbackOwnerId, env, origin, download) {
  if (!env.VAULT_FILES) throw new TableError("Private file storage is not configured.", 503);
  const ownerId = row?.owner_id || fallbackOwnerId;
  const key = row?.file_key || "";
  if (!ownerId || !key.startsWith(`${ownerId}/persora-table/`) || key.includes("..")) throw new TableError("That file is not available.", 404);
  const object = await env.VAULT_FILES.get(key);
  if (!object || object.customMetadata?.ownerId !== ownerId) throw new TableError("That file is not available. It may have been removed from storage.", 404);
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

async function serveAttachment(identity, tableId, attachmentId, env, origin, download) {
  const row = await rpc("persora_table_attachment_get", { p_owner: identity.id, p_table: tableId, p_id: attachmentId }, env);
  return await streamStoredAttachment(row, identity.id, env, origin, download);
}

async function submitComment({ actorId, token, tableId, defaultAuthor, body, env }) {
  const kind = body?.kind === "cell" ? "cell" : "thread";
  const author = cleanText(body?.authorName || defaultAuthor || "Guest commenter", 80).replace(/\s+/gu, " ").trim() || (defaultAuthor || "Guest commenter");

  if (kind === "cell") {
    const sheetId = String(body?.sheetId || "");
    if (!isUuid(sheetId)) throw new TableValidationError("Choose a valid sheet.");
    const row = Number(body?.row);
    const col = Number(body?.col);
    if (!Number.isInteger(row) || row < 0 || row >= TABLE_LIMITS.rows || !Number.isInteger(col) || col < 0 || col >= TABLE_LIMITS.cols) {
      throw new TableValidationError("Choose a valid cell address.");
    }
    const cellKey = `${row}:${col}`;
    if (body?.delete === true) {
      const res = await rpc("persora_table_cell_comment_write", {
        p_actor: actorId || null, p_token: token || null, p_table_id: tableId || null, p_sheet_id: sheetId, p_cell_key: cellKey, p_comment: null,
      }, env);
      return { ok: true, kind: "cell", revision: Number(res.revision), sheetId: res.sheet_id, cellKey: res.cell_key, comment: null };
    }
    const text = cleanText(body?.text ?? "", TABLE_LIMITS.commentText).trim();
    if (!text) throw new TableValidationError("Enter a comment before posting.");
    const nowIso = new Date().toISOString();
    const commentObj = {
      id: `cm_${crypto.randomUUID().slice(0, 12)}`,
      text,
      author,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const res = await rpc("persora_table_cell_comment_write", {
      p_actor: actorId,
      p_token: token || null,
      p_table_id: tableId || null,
      p_sheet_id: sheetId,
      p_cell_key: cellKey,
      p_comment: commentObj,
    }, env);
    return { ok: true, kind: "cell", revision: Number(res.revision), sheetId: res.sheet_id, cellKey: res.cell_key, comment: res.comment };
  }

  const text = cleanText(body?.body ?? body?.text ?? "", TABLE_LIMITS.commentText).trim();
  if (!text) throw new TableValidationError("Enter a comment before posting.");
  const targetKind = body?.targetKind === "record" ? "record" : body?.targetKind === "cell" ? "cell" : "table";
  const sheetId = body?.sheetId && isUuid(body.sheetId) ? body.sheetId : null;
  const recordId = body?.recordId && isUuid(body.recordId) ? body.recordId : null;
  const cellRef = typeof body?.cellRef === "string" ? cleanText(body.cellRef, 24).trim() || null : null;

  const created = await rpc("persora_table_thread_comment_add", {
    p_actor: actorId || null,
    p_token: token || null,
    p_table_id: tableId || null,
    p_author_name: author,
    p_target_kind: targetKind,
    p_sheet_id: sheetId,
    p_cell_ref: cellRef,
    p_record_id: recordId,
    p_body: text,
  }, env);
  return { ok: true, kind: "thread", comment: commentView(created) };
}

async function handleTableSharing(request, identity, tableId, tailSegments, env, origin, services) {
  const method = request.method;
  if (!tailSegments.length && method === "GET") {
    const state = await rpc("persora_table_sharing_get", { p_owner: identity.id, p_table_id: tableId }, env);
    return json({
      tableId: state.table_id,
      tableName: state.table_name,
      shares: (Array.isArray(state.shares) ? state.shares : []).map(shareMemberView),
      link: shareLinkView(state.link),
    }, 200, origin);
  }
  if (tailSegments.length === 1 && tailSegments[0] === "members" && method === "POST") {
    const body = await readJson(request, 16 * 1024);
    const permission = typeof body.permission === "string" ? body.permission.trim() : "view";
    if (!VALID_MEMBER_PERMISSIONS.has(permission)) throw new TableValidationError("Choose view, comment, or edit permission.");
    if (typeof services.resolveShareRecipient !== "function") {
      throw new TableError("Member lookup is unavailable right now.", 503);
    }
    const recipient = await services.resolveShareRecipient(body.recipient, identity.id, env);
    const res = await rpc("persora_table_share_upsert", {
      p_owner: identity.id,
      p_table_id: tableId,
      p_recipient: recipient.id,
      p_permission: permission,
    }, env);
    if (typeof services.writeShareNotification === "function") {
      const actor = actorDisplayName(identity);
      const label = permission === "edit" ? "edit" : permission === "comment" ? "comment" : "view-only";
      await services.writeShareNotification(
        recipient.id,
        identity.id,
        actor,
        res.table_name || "Table",
        res.created ? "shared" : "permission_changed",
        res.created
          ? `${actor} shared the table "${res.table_name || "Table"}" with ${label} access.`
          : `${actor} updated your access on table "${res.table_name || "Table"}" to ${label}.`,
        env,
      ).catch(() => {});
    }
    return json({ ok: true, created: Boolean(res.created), share: shareMemberView(res.share) }, res.created ? 201 : 200, origin);
  }
  if (tailSegments.length === 2 && tailSegments[0] === "members") {
    const shareId = tailSegments[1];
    if (!isUuid(shareId)) return json({ error: "Choose a valid share entry." }, 400, origin);
    if (method === "PATCH") {
      const body = await readJson(request, 16 * 1024);
      const permission = typeof body.permission === "string" ? body.permission.trim() : "";
      if (!VALID_MEMBER_PERMISSIONS.has(permission)) throw new TableValidationError("Choose view, comment, or edit permission.");
      const res = await rpc("persora_table_share_update", {
        p_owner: identity.id,
        p_table_id: tableId,
        p_share_id: shareId,
        p_permission: permission,
      }, env);
      if (typeof services.writeShareNotification === "function" && res.share?.recipient_id) {
        const actor = actorDisplayName(identity);
        const label = permission === "edit" ? "edit" : permission === "comment" ? "comment" : "view-only";
        await services.writeShareNotification(
          res.share.recipient_id,
          identity.id,
          actor,
          res.table_name || "Table",
          "permission_changed",
          `${actor} updated your access on table "${res.table_name || "Table"}" to ${label}.`,
          env,
        ).catch(() => {});
      }
      return json({ ok: true, share: shareMemberView(res.share) }, 200, origin);
    }
    if (method === "DELETE") {
      const res = await rpc("persora_table_share_revoke", {
        p_owner: identity.id,
        p_table_id: tableId,
        p_share_id: shareId,
      }, env);
      if (typeof services.writeShareNotification === "function" && res.recipient_id) {
        const actor = actorDisplayName(identity);
        await services.writeShareNotification(
          res.recipient_id,
          identity.id,
          actor,
          res.table_name || "Table",
          "unshared",
          `${actor} removed your access to table "${res.table_name || "Table"}".`,
          env,
        ).catch(() => {});
      }
      return json({ ok: true }, 200, origin);
    }
    return json({ error: "Method not allowed." }, 405, origin);
  }
  if (tailSegments.length === 1 && tailSegments[0] === "link" && method === "PUT") {
    const body = await readJson(request, 16 * 1024);
    const enabled = Boolean(body.enabled);
    const permission = body.permission === undefined ? "view" : String(body.permission).trim();
    if (!VALID_LINK_PERMISSIONS.has(permission)) throw new TableValidationError("Link permission must be view, comment, or edit.");
    const regenerate = Boolean(body.regenerate);
    // Always mint a fresh 256-bit cryptographic token when regenerating or when no active token exists yet.
    const current = await rpc("persora_table_sharing_get", { p_owner: identity.id, p_table_id: tableId }, env);
    const needsNewToken = regenerate || !enabled || !current?.link?.share_token;
    const token = needsNewToken ? generateTableShareToken() : null;
    const updated = await rpc("persora_table_link_configure", {
      p_owner: identity.id,
      p_table_id: tableId,
      p_enabled: enabled,
      p_permission: permission,
      p_token: token,
    }, env);
    return json({ ok: true, link: shareLinkView(updated) }, 200, origin);
  }
  return json({ error: "That sharing route is not available." }, 404, origin);
}

/** Public /api/public/tables/:token routes (no sign-in required; enforces view, comment, or edit permission). */
export async function handlePublicTables(request, env, origin, signedInIdentity = null) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(PUBLIC_TABLES_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;
  try {
    const token = segments[0] || "";
    if (!SHARE_TOKEN_RE.test(token)) {
      return json({ error: "This shared table link is unavailable, disabled, or has been revoked." }, 404, origin);
    }
    if (segments.length === 1) {
      if (method !== "GET") return json({ error: "Method not allowed." }, 405, origin);
      const detail = await rpc("persora_table_public_get", { p_token: token }, env);
      return json({
        permission: detail.permission === "edit" ? "edit" : detail.permission === "comment" ? "comment" : "view",
        table: publicTableView(detail.table),
        sheets: detail.sheets || [],
        records: detail.records || [],
        attachments: (detail.attachments || []).map(attachmentView),
        comments: (detail.comments || []).map(commentView),
      }, 200, origin);
    }
    if (segments.length === 2 && segments[1] === "content" && method === "PUT") {
      return json(await savePublicContent(request, token, env), 200, origin);
    }
    if (segments.length === 3 && segments[1] === "attachments" && method === "GET") {
      const attId = segments[2];
      if (!isUuid(attId)) return json({ error: "That file is not available." }, 404, origin);
      const row = await rpc("persora_table_public_attachment_get", { p_token: token, p_att_id: attId }, env);
      return await streamStoredAttachment(row, null, env, origin, url.searchParams.get("download") === "1");
    }
    if (segments.length === 2 && segments[1] === "comments" && method === "POST") {
      const body = await readJson(request, 32 * 1024);
      const defaultAuthor = signedInIdentity ? actorDisplayName(signedInIdentity) : "Guest commenter";
      const result = await submitComment({
        actorId: signedInIdentity?.id || null,
        token,
        tableId: null,
        defaultAuthor,
        body,
        env,
      });
      return json(result, 201, origin);
    }
    return json({ error: "That public table route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof TableValidationError) return json({ error: error.message, field: error.field || null }, error.status || 400, origin);
    if (error instanceof TableError) return json({ error: error.message, ...error.extra }, error.status, origin);
    throw error;
  }
}

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
        const isPreview = url.searchParams.get("preview") === "1";
        const touch = !isPreview && url.searchParams.get("touch") !== "0";
        const raw = await loadTable(identity, tableId, env, touch);
        if (isPreview) {
          return json(buildTablePreviewResponse(raw), 200, origin);
        }
        const detail = touch ? await pruneAttachments(identity, tableId, raw, env, services) : raw;
        return json({
          table: tableView(detail.table),
          sheets: detail.sheets || [],
          records: detail.records || [],
          attachments: (detail.attachments || []).map(attachmentView),
          comments: (detail.comments || []).map(commentView),
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
    if (action === "sharing") {
      return await handleTableSharing(request, identity, tableId, segments.slice(2), env, origin, services);
    }
    if (segments.length === 2 && action === "comments" && method === "POST") {
      const body = await readJson(request, 32 * 1024);
      const result = await submitComment({
        actorId: identity.id,
        token: null,
        tableId,
        defaultAuthor: actorDisplayName(identity),
        body,
        env,
      });
      return json(result, 201, origin);
    }
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
    if (typeof error?.status === "number" && error.status >= 400 && error.status < 600) {
      return json({ error: error.message || "Request failed." }, error.status, origin);
    }
    throw error;
  }
}
