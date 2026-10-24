// Persora Table — attachment previews fetched on demand through the
// authenticated API (never public URLs). Only common image types render
// inline; everything else downloads.
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { fetchTableAttachment } from "../../lib/table/table-api";
import type { AttachmentRef } from "../../../cloudflare/table-rules.js";

export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const isImage = (ref: Pick<AttachmentRef, "type">) => INLINE_IMAGE_TYPES.has(ref.type);

// Object URLs are shared per attachment for the session and revoked when the
// table editor unmounts (see releaseAttachmentUrls).
const urlCache = new Map<string, Promise<string>>();
const cacheKey = (tableId: string, id: string) => `${tableId}/${id}`;

export function attachmentUrl(tableId: string, id: string) {
  const key = cacheKey(tableId, id);
  let entry = urlCache.get(key);
  if (!entry) {
    entry = fetchTableAttachment(tableId, id);
    entry.catch(() => urlCache.delete(key));
    urlCache.set(key, entry);
  }
  return entry;
}

export function releaseAttachmentUrls(tableId: string) {
  for (const [key, entry] of urlCache) {
    if (!key.startsWith(`${tableId}/`)) continue;
    urlCache.delete(key);
    void entry.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
}

export async function downloadAttachment(tableId: string, ref: AttachmentRef) {
  const url = await fetchTableAttachment(tableId, ref.id, true);
  const link = document.createElement("a");
  link.href = url;
  link.download = ref.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function AttachmentThumb({ tableId, file, className = "" }: { tableId: string; file: AttachmentRef; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isImage(file)) return;
    let alive = true;
    attachmentUrl(tableId, file.id).then((value) => { if (alive) setUrl(value); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [tableId, file]);
  if (!isImage(file) || failed) return <span className={`tb-thumb is-file ${className}`} title={file.name}><FileText size={18} aria-hidden="true"/></span>;
  return url ? <img className={`tb-thumb ${className}`} src={url} alt={file.name} loading="lazy"/> : <span className={`tb-thumb is-loading ${className}`} aria-label={`Loading ${file.name}`}/>;
}

export const formatBytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
