// Persora Docs — browser client for /api/docs/* and /api/public/docs/*.
import type { DocContent, DocPreviewBlock } from "../../cloudflare/docs-rules.js";
import { PagesApiError, pagesApiJson } from "./cloud";
import type { SharePermission } from "../types";
import type { ShareResourceAdapter } from "../components/table/ShareTableDialog";
import type {
  TableMemberShare,
  TablePublicLinkPermission,
  TableShareLinkState,
} from "./table/table-api";

export type DocAccessPermission = "owner" | "edit" | "view";
export type DocPublicLinkPermission = "view" | "edit";

export interface DocSummary {
  id: string;
  title: string;
  starred: boolean;
  previewBlocks: DocPreviewBlock[];
  snippet: string;
  wordCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  openedAt: string;
  shared?: boolean;
  hasShares?: boolean;
  permission?: DocAccessPermission;
  shareId?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  ownerLoginId?: string | null;
}

export interface DocDetail extends DocSummary {
  content: DocContent;
}

export interface SaveDocBody {
  baseRevision: number;
  batchId: string;
  title?: string;
  content: DocContent;
}

export interface SaveDocResult {
  ok: true;
  replayed: boolean;
  doc: DocSummary;
}

export interface PublicSharedDocDetail {
  permission: DocPublicLinkPermission;
  ownerName: string;
  doc: {
    id: string;
    title: string;
    content: DocContent;
    wordCount: number;
    revision: number;
    updatedAt: string;
  };
}

const docPath = (id: string) => `/docs/${encodeURIComponent(id)}`;
const publicDocPath = (token: string) => `/public/docs/${encodeURIComponent(token)}`;
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const buildSharedDocUrl = (shareToken: string) =>
  `${window.location.origin}/SharedDoc/${encodeURIComponent(shareToken)}`;

export async function listDocs(signal?: AbortSignal): Promise<DocSummary[]> {
  const res = await pagesApiJson<{ docs: DocSummary[] }>("/docs", { signal });
  return Array.isArray(res.docs) ? res.docs : [];
}

export async function getDoc(id: string, signal?: AbortSignal): Promise<DocDetail> {
  const res = await pagesApiJson<{ doc: DocDetail }>(docPath(id), { signal });
  return res.doc;
}

export async function getDocPreview(id: string, signal?: AbortSignal): Promise<DocDetail> {
  const res = await pagesApiJson<{ doc: DocDetail }>(`${docPath(id)}?preview=1`, { signal });
  return res.doc;
}

export async function createDoc(body: {
  id?: string;
  title?: string;
  starred?: boolean;
  content?: DocContent;
}): Promise<DocDetail> {
  const res = await pagesApiJson<{ doc: DocDetail }>("/docs", jsonInit("POST", body));
  return res.doc;
}

export async function updateDocInfo(
  id: string,
  patch: { title?: string; starred?: boolean },
): Promise<DocSummary> {
  const res = await pagesApiJson<{ doc: DocSummary }>(docPath(id), jsonInit("PATCH", patch));
  return res.doc;
}

export async function duplicateDoc(
  id: string,
  newId: string,
  title?: string,
): Promise<DocSummary> {
  const res = await pagesApiJson<{ doc: DocSummary }>(
    `${docPath(id)}/duplicate`,
    jsonInit("POST", { id: newId, ...(title ? { title } : {}) }),
  );
  return res.doc;
}

export async function deleteDoc(id: string): Promise<void> {
  await pagesApiJson(docPath(id), { method: "DELETE" });
}

export function saveDocContent(
  id: string,
  body: SaveDocBody,
  signal?: AbortSignal,
): Promise<SaveDocResult> {
  return pagesApiJson<SaveDocResult>(`${docPath(id)}/content`, {
    ...jsonInit("PUT", body),
    signal,
  });
}

// ---- Sharing (reuses ShareTableDialog contract) ----------------------------

export async function getDocSharing(
  docId: string,
  signal?: AbortSignal,
): Promise<{ shares: TableMemberShare[]; link: TableShareLinkState }> {
  const res = await pagesApiJson<{
    docId: string;
    docTitle: string;
    shares: TableMemberShare[];
    link: TableShareLinkState;
  }>(`${docPath(docId)}/sharing`, { signal });
  return { shares: res.shares || [], link: res.link };
}

export async function shareDocWithMember(
  docId: string,
  recipient: string,
  permission: SharePermission,
): Promise<{ created: boolean; share: TableMemberShare }> {
  const normalizedPerm = permission === "edit" ? "edit" : "view";
  const res = await pagesApiJson<{ ok: true; created: boolean; share: TableMemberShare }>(
    `${docPath(docId)}/sharing/members`,
    jsonInit("POST", { recipient, permission: normalizedPerm }),
  );
  return { created: res.created, share: res.share };
}

export async function updateDocMemberPermission(
  docId: string,
  shareId: string,
  permission: SharePermission,
): Promise<TableMemberShare> {
  const normalizedPerm = permission === "edit" ? "edit" : "view";
  const res = await pagesApiJson<{ ok: true; share: TableMemberShare }>(
    `${docPath(docId)}/sharing/members/${encodeURIComponent(shareId)}`,
    jsonInit("PATCH", { permission: normalizedPerm }),
  );
  return res.share;
}

export async function revokeDocMemberShare(docId: string, shareId: string): Promise<void> {
  await pagesApiJson(`${docPath(docId)}/sharing/members/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
  });
}

export async function configureDocShareLink(
  docId: string,
  options: { enabled: boolean; permission?: TablePublicLinkPermission; regenerate?: boolean },
): Promise<TableShareLinkState> {
  const normalizedPerm = options.permission === "edit" ? "edit" : "view";
  const res = await pagesApiJson<{ ok: true; link: TableShareLinkState }>(
    `${docPath(docId)}/sharing/link`,
    jsonInit("PUT", { ...options, permission: normalizedPerm }),
  );
  return res.link;
}

export function getPublicSharedDoc(
  token: string,
  signal?: AbortSignal,
): Promise<PublicSharedDocDetail> {
  return pagesApiJson<PublicSharedDocDetail>(publicDocPath(token), { signal });
}

export function savePublicDocContent(
  token: string,
  body: SaveDocBody,
): Promise<SaveDocResult> {
  return pagesApiJson<SaveDocResult>(`${publicDocPath(token)}/content`, jsonInit("PUT", body));
}

export const isDocConflictError = (error: unknown) =>
  error instanceof PagesApiError && error.status === 409;
export const isDocGoneError = (error: unknown) =>
  error instanceof PagesApiError && error.status === 404;
export const isDocForbiddenError = (error: unknown) =>
  error instanceof PagesApiError && error.status === 403;

export const docErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error &&
  !(error instanceof TypeError) &&
  error.name !== "AbortError" &&
  error.message
    ? error.message
    : fallback;

export const docShareAdapter: ShareResourceAdapter = {
  getSharing: getDocSharing,
  shareWithMember: shareDocWithMember,
  updateMemberPermission: updateDocMemberPermission,
  revokeMemberShare: revokeDocMemberShare,
  configureShareLink: configureDocShareLink,
  buildPublicUrl: buildSharedDocUrl,
  errorMessage: docErrorMessage,
};
