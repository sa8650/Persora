// Persora Table — browser client for /api/tables/*.
import type { AttachmentRef, Sheet, SmartMeta, TableKind, TableRecord } from "../../../cloudflare/table-rules.js";
import { PagesApiError, pagesApiJson, pagesApiRequest } from "../cloud";

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
  meta?: SmartMeta;
}

export interface TableAttachmentInfo { id: string; name: string; type: string; size: number; createdAt: string }

export interface TableDetail {
  table: TableSummary;
  sheets: Sheet[];
  records: TableRecord[];
  attachments: TableAttachmentInfo[];
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

const tablePath = (id: string) => `/tables/${encodeURIComponent(id)}`;
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function listTables(signal?: AbortSignal): Promise<TableSummary[]> {
  const body = await pagesApiJson<{ tables: TableSummary[] }>("/tables", { signal });
  return body.tables;
}
export function getTable(id: string, signal?: AbortSignal): Promise<TableDetail> {
  return pagesApiJson<TableDetail>(tablePath(id), { signal });
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
export async function uploadTableAttachment(tableId: string, file: File, id: string): Promise<{ info: TableAttachmentInfo; ref: AttachmentRef }> {
  const form = new FormData();
  form.set("id", id);
  form.set("file", file, file.name);
  const result = await pagesApiJson<{ attachment: TableAttachmentInfo & { ref: AttachmentRef } }>(`${tablePath(tableId)}/attachments`, { method: "POST", body: form });
  const { ref, ...info } = result.attachment;
  return { info, ref };
}
/** Fetches a private attachment on demand (never preloaded) and returns an object URL the caller must revoke. */
export async function fetchTableAttachment(tableId: string, attachmentId: string, download = false): Promise<string> {
  const response = await pagesApiRequest(`${tablePath(tableId)}/attachments/${encodeURIComponent(attachmentId)}${download ? "?download=1" : ""}`);
  return URL.createObjectURL(await response.blob());
}

export const isConflictError = (error: unknown) => error instanceof PagesApiError && error.status === 409;
export const isGoneError = (error: unknown) => error instanceof PagesApiError && error.status === 404;
/** Server messages are shown as-is; network failures (fetch's TypeError) get the friendly fallback. */
export const tableErrorMessage = (error: unknown, fallback: string) => (error instanceof Error && !(error instanceof TypeError) && error.name !== "AbortError" && error.message ? error.message : fallback);
