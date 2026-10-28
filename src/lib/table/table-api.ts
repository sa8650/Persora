// Persora Table — browser client for /api/tables/* and /api/public/tables/*.
import type { AttachmentRef, SheetComment, Sheet, SmartMeta, TableKind, TableRecord } from "../../../cloudflare/table-rules.js";
import { PagesApiError, pagesApiJson, pagesApiRequest, uploadMultipart } from "../cloud";
import type { SharePermission, TransferProgress } from "../../types";

export type TableAccessPermission = "owner" | "edit" | "comment" | "view";
export type TablePublicLinkPermission = "view" | "comment" | "edit";

export interface TableSummary {
  id: string;
  kind: TableKind;
  name: string;
  label: string;
  starred: boolean;
  template: string | null;
  revision: number;
  sheetCount: number;
  recordCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  shared?: boolean;
  hasShares?: boolean;
  permission?: TableAccessPermission;
  shareId?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  ownerLoginId?: string | null;
  meta?: SmartMeta;
}

export interface TableAttachmentInfo { id: string; name: string; type: string; size: number; createdAt: string }

export interface TableThreadComment {
  id: string;
  authorName: string;
  targetKind: "table" | "cell" | "record";
  sheetId: string | null;
  cellRef: string | null;
  recordId: string | null;
  body: string;
  createdAt: string;
}

export interface TableDetail {
  table: TableSummary;
  sheets: Sheet[];
  records: TableRecord[];
  attachments: TableAttachmentInfo[];
  comments?: TableThreadComment[];
}

export interface TableMemberShare {
  id: string;
  recipientId: string;
  recipientName: string;
  recipientLoginId: string;
  recipientEmail: string;
  permission: SharePermission;
  createdAt: string;
  updatedAt: string;
}

export interface TableShareLinkState {
  enabled: boolean;
  permission: TablePublicLinkPermission;
  shareToken: string | null;
  updatedAt: string | null;
}

export interface TableSharingOverview {
  tableId: string;
  tableName: string;
  shares: TableMemberShare[];
  link: TableShareLinkState;
}

export interface PublicSharedTableSummary {
  id: string;
  kind: TableKind;
  name: string;
  revision: number;
  sheetCount: number;
  recordCount: number;
  updatedAt: string;
  meta?: SmartMeta;
}

export interface PublicSharedTableDetail {
  permission: TablePublicLinkPermission;
  table: PublicSharedTableSummary;
  sheets: Sheet[];
  records: TableRecord[];
  attachments: TableAttachmentInfo[];
  comments: TableThreadComment[];
}

export interface TablePerson { id: string; name: string; me: boolean }

export interface CreateTableBody {
  id: string;
  kind: TableKind;
  name: string;
  label?: string;
  template?: string | null;
  meta?: SmartMeta;
  records?: TableRecord[];
  sheets?: Sheet[];
}

export interface SaveBatchBody {
  baseRevision: number;
  batchId: string;
  meta?: SmartMeta;
  sheets?: { upsert: Sheet[]; delete: string[] };
  records?: { upsert: Array<{ id: string; position: number; values: TableRecord["values"]; example: boolean }>; delete: string[] };
}

export interface SaveResult { ok: true; replayed: boolean; table: TableSummary }
export interface PublicSaveResult { ok: true; replayed: boolean; table: PublicSharedTableSummary }

const tablePath = (id: string) => `/tables/${encodeURIComponent(id)}`;
const publicTablePath = (token: string) => `/public/tables/${encodeURIComponent(token)}`;
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const buildSharedTableUrl = (shareToken: string) => `${window.location.origin}/SharedTable/${encodeURIComponent(shareToken)}`;

export async function listTables(signal?: AbortSignal): Promise<TableSummary[]> {
  const body = await pagesApiJson<{ tables: TableSummary[] }>("/tables", { signal });
  return body.tables;
}
export function getTable(id: string, signal?: AbortSignal): Promise<TableDetail> {
  return pagesApiJson<TableDetail>(tablePath(id), { signal });
}
export function getTablePreview(id: string, signal?: AbortSignal): Promise<TableDetail> {
  return pagesApiJson<TableDetail>(`${tablePath(id)}?preview=1`, { signal });
}
export async function createTable(body: CreateTableBody): Promise<TableSummary> {
  const result = await pagesApiJson<{ table: TableSummary }>("/tables", jsonInit("POST", body));
  return result.table;
}
export async function updateTableInfo(id: string, patch: { name?: string; label?: string; starred?: boolean }): Promise<TableSummary> {
  const result = await pagesApiJson<{ table: TableSummary }>(tablePath(id), jsonInit("PATCH", patch));
  return result.table;
}
export async function duplicateTable(id: string, newId: string, name: string): Promise<TableSummary> {
  const result = await pagesApiJson<{ table: TableSummary }>(`${tablePath(id)}/duplicate`, jsonInit("POST", { id: newId, name }));
  return result.table;
}
export async function deleteTable(id: string): Promise<void> {
  await pagesApiJson(tablePath(id), { method: "DELETE" });
}
/** Throws PagesApiError(409) when the table changed elsewhere (nothing was written). */
export function saveTableContent(id: string, batch: SaveBatchBody, signal?: AbortSignal): Promise<SaveResult> {
  return pagesApiJson<SaveResult>(`${tablePath(id)}/content`, { ...jsonInit("PUT", batch), signal });
}
export async function getTableRevision(id: string, signal?: AbortSignal): Promise<TableSummary> {
  const result = await pagesApiJson<{ table: TableSummary }>(`${tablePath(id)}/revision`, { signal });
  return result.table;
}
export async function listTablePeople(): Promise<TablePerson[]> {
  const result = await pagesApiJson<{ people: TablePerson[] }>("/tables/people");
  return result.people;
}
export async function uploadTableAttachment(tableId: string, file: File, id: string, onProgress?: (progress: TransferProgress) => void): Promise<{ info: TableAttachmentInfo; ref: AttachmentRef }> {
  const form = new FormData();
  form.set("id", id);
  form.set("file", file, file.name);
  const result = await uploadMultipart<{ attachment: TableAttachmentInfo & { ref: AttachmentRef } }>(`${tablePath(tableId)}/attachments`, form, onProgress);
  const { ref, ...info } = result.attachment;
  return { info, ref };
}
/** Fetches a private attachment on demand (never preloaded) and returns an object URL the caller must revoke. */
export async function fetchTableAttachment(tableId: string, attachmentId: string, download = false): Promise<string> {
  const response = await pagesApiRequest(`${tablePath(tableId)}/attachments/${encodeURIComponent(attachmentId)}${download ? "?download=1" : ""}`);
  return URL.createObjectURL(await response.blob());
}

// ---- Sharing & Comments (Authenticated) --------------------------------------

export function getTableSharing(tableId: string, signal?: AbortSignal): Promise<TableSharingOverview> {
  return pagesApiJson<TableSharingOverview>(`${tablePath(tableId)}/sharing`, { signal });
}

export async function shareTableWithMember(
  tableId: string,
  recipient: string,
  permission: SharePermission,
): Promise<{ created: boolean; share: TableMemberShare }> {
  const res = await pagesApiJson<{ ok: true; created: boolean; share: TableMemberShare }>(
    `${tablePath(tableId)}/sharing/members`,
    jsonInit("POST", { recipient, permission }),
  );
  return { created: res.created, share: res.share };
}

export async function updateTableMemberPermission(
  tableId: string,
  shareId: string,
  permission: SharePermission,
): Promise<TableMemberShare> {
  const res = await pagesApiJson<{ ok: true; share: TableMemberShare }>(
    `${tablePath(tableId)}/sharing/members/${encodeURIComponent(shareId)}`,
    jsonInit("PATCH", { permission }),
  );
  return res.share;
}

export async function revokeTableMemberShare(tableId: string, shareId: string): Promise<void> {
  await pagesApiJson(`${tablePath(tableId)}/sharing/members/${encodeURIComponent(shareId)}`, { method: "DELETE" });
}

export async function configureTableShareLink(
  tableId: string,
  options: { enabled: boolean; permission?: TablePublicLinkPermission; regenerate?: boolean },
): Promise<TableShareLinkState> {
  const res = await pagesApiJson<{ ok: true; link: TableShareLinkState }>(
    `${tablePath(tableId)}/sharing/link`,
    jsonInit("PUT", options),
  );
  return res.link;
}

export async function postTableCellComment(
  tableId: string,
  payload: { sheetId: string; row: number; col: number; text: string; delete?: boolean },
): Promise<{ revision: number; sheetId: string; cellKey: string; comment: SheetComment | null }> {
  const res = await pagesApiJson<{ ok: true; revision: number; sheetId: string; cellKey: string; comment: SheetComment | null }>(
    `${tablePath(tableId)}/comments`,
    jsonInit("POST", { kind: "cell", ...payload }),
  );
  return res;
}

export async function postTableThreadComment(
  tableId: string,
  payload: { targetKind?: "table" | "cell" | "record"; sheetId?: string | null; cellRef?: string | null; recordId?: string | null; body: string },
): Promise<TableThreadComment> {
  const res = await pagesApiJson<{ ok: true; comment: TableThreadComment }>(
    `${tablePath(tableId)}/comments`,
    jsonInit("POST", { kind: "thread", ...payload }),
  );
  return res.comment;
}

// ---- Public Shared Table Links (No Sign-in Required) -------------------------

export function getPublicSharedTable(token: string, signal?: AbortSignal): Promise<PublicSharedTableDetail> {
  return pagesApiJson<PublicSharedTableDetail>(publicTablePath(token), { signal });
}

export function savePublicTableContent(token: string, body: SaveBatchBody): Promise<PublicSaveResult> {
  return pagesApiJson<PublicSaveResult>(`${publicTablePath(token)}/content`, jsonInit("PUT", body));
}

export async function fetchPublicTableAttachment(token: string, attachmentId: string, download = false): Promise<string> {
  const response = await pagesApiRequest(`${publicTablePath(token)}/attachments/${encodeURIComponent(attachmentId)}${download ? "?download=1" : ""}`);
  return URL.createObjectURL(await response.blob());
}

export async function postPublicTableCellComment(
  token: string,
  payload: { sheetId: string; row: number; col: number; text: string; authorName?: string; delete?: boolean },
): Promise<{ revision: number; sheetId: string; cellKey: string; comment: SheetComment | null }> {
  const res = await pagesApiJson<{ ok: true; revision: number; sheetId: string; cellKey: string; comment: SheetComment | null }>(
    `${publicTablePath(token)}/comments`,
    jsonInit("POST", { kind: "cell", ...payload }),
  );
  return res;
}

export async function postPublicTableThreadComment(
  token: string,
  payload: { targetKind?: "table" | "cell" | "record"; sheetId?: string | null; cellRef?: string | null; recordId?: string | null; body: string; authorName?: string },
): Promise<TableThreadComment> {
  const res = await pagesApiJson<{ ok: true; comment: TableThreadComment }>(
    `${publicTablePath(token)}/comments`,
    jsonInit("POST", { kind: "thread", ...payload }),
  );
  return res.comment;
}

export const isConflictError = (error: unknown) => error instanceof PagesApiError && error.status === 409;
export const isGoneError = (error: unknown) => error instanceof PagesApiError && error.status === 404;
export const isForbiddenError = (error: unknown) => error instanceof PagesApiError && error.status === 403;
/** Server messages are shown as-is; network failures (fetch's TypeError) get the friendly fallback. */
export const tableErrorMessage = (error: unknown, fallback: string) => (error instanceof Error && !(error instanceof TypeError) && error.name !== "AbortError" && error.message ? error.message : fallback);
