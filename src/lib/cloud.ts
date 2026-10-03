import type { AdminConsoleSnapshot, AdminMetrics, AlarmRingtone, BillingSnapshot, BusinessCardDraft, BusinessSocialLink, DigitalBusinessCard, DocumentTypeOption, MedicalRecord, MedicalRecordDraft, MedicalRecordFile, MedicalRecordLink, PersoraContact, PaymentRecord, PublicDigitalBusinessCard, ShareComment, ShareNotification, SharePermission, SharedDirection, SharedVaultEntry, RecordShareEntry, SiteContent, SmartScanFieldDefinition, SmartScanResult, SubscriptionPlan, TimelineAttachment, TimelineDraft, TimelineEvent, TransferProgress, VaultFile, VaultFolder, VaultFolderDraft, VaultFolderScope, VaultItem } from "../types";
import { DEFAULT_SITE_CONTENT } from "../data/siteContent";

const pagesFunctionsEnabled = import.meta.env.VITE_USE_PAGES_FUNCTIONS === "true";
const apiBase = pagesFunctionsEnabled ? "/api" : "";
export const isPagesApiConfigured = pagesFunctionsEnabled;

export class PagesApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = "PagesApiError"; this.status = status; }
}

async function responseError(response: Response, service: string): Promise<PagesApiError> {
  let message = `${service} returned ${response.status}.`;
  try {
    const body = await response.json() as { error?: string };
    if (body.error) message = body.error;
  } catch { /* Retain the generic status message. */ }
  return new PagesApiError(message, response.status);
}

export async function pagesApiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!apiBase) throw new Error("Persora's Pages Functions API is not enabled. Set VITE_USE_PAGES_FUNCTIONS=true in Cloudflare Pages settings.");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await responseError(response, "Persora service");
  return response;
}

export async function pagesApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await pagesApiRequest(path, init);
  return response.json() as Promise<T>;
}

async function publicRequest(path: string): Promise<Response> {
  return pagesApiRequest(path, { method: "GET" });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return pagesApiJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function fromRow(row: Record<string, unknown>): VaultItem {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, string> : {};
  const fileName = typeof row.file_name === "string" ? row.file_name : "";
  const file: VaultFile | undefined = fileName ? {
    name: fileName,
    ...(typeof row.file_key === "string" ? { key: row.file_key } : {}),
    ...(typeof row.file_size === "number" ? { size: row.file_size } : {}),
    ...(typeof row.file_type === "string" ? { type: row.file_type } : {}),
  } : undefined;
  return {
    id: String(row.id),
    section: row.section as VaultItem["section"],
    title: String(row.title || "Untitled"),
    subtitle: typeof row.subtitle === "string" ? row.subtitle : undefined,
    metadata,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    ...(file ? { file } : {}),
    favorite: Boolean(row.favorite),
    pinned: Boolean(row.pinned),
    ...(typeof row.folder_id === "string" && row.folder_id ? { folderId: row.folder_id } : {}),
  };
}

export async function loadVaultItems(): Promise<VaultItem[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/vault/items");
  return Array.isArray(rows) ? rows.map(fromRow) : [];
}

function vaultFolderFromRow(row: Record<string, unknown>): VaultFolder {
  return {
    id: String(row.id || ""), scope: String(row.scope || "documents") as VaultFolderScope,
    name: String(row.name || "Untitled folder"), color: String(row.color || "blue") as VaultFolder["color"],
    pinned: Boolean(row.pinned), createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

export async function loadVaultFolders(scope: VaultFolderScope): Promise<VaultFolder[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>(`/vault/folders?scope=${encodeURIComponent(scope)}`);
  return Array.isArray(rows) ? rows.map(vaultFolderFromRow) : [];
}

export async function saveVaultFolder(folder: VaultFolderDraft): Promise<VaultFolder> {
  const row = await postJson<Record<string, unknown>>("/vault/folders", folder);
  return vaultFolderFromRow(row);
}

export async function deleteVaultFolder(id: string, scope: VaultFolderScope): Promise<void> {
  await pagesApiRequest(`/vault/folders?id=${encodeURIComponent(id)}&scope=${encodeURIComponent(scope)}`, { method: "DELETE" });
}

function contactFromRow(row: Record<string, unknown>): PersoraContact {
  const phones = Array.isArray(row.phone_numbers) ? row.phone_numbers : [];
  return {
    id: String(row.id || ""),
    name: String(row.full_name || ""),
    phoneNumbers: phones.filter((phone): phone is Record<string, unknown> => Boolean(phone) && typeof phone === "object" && !Array.isArray(phone)).map((phone) => ({ label: String(phone.label || "Mobile"), number: String(phone.number || "") })).filter((phone) => phone.number),
    email: String(row.email || ""), company: String(row.company || ""), jobTitle: String(row.job_title || ""),
    address: String(row.address || ""), birthday: String(row.birthday || ""), notes: String(row.notes || ""),
    category: String(row.category || "Other") as PersoraContact["category"],
    ...(typeof row.photo_key === "string" && row.photo_key ? { photoKey: row.photo_key } : {}),
    favorite: Boolean(row.favorite), ...(typeof row.folder_id === "string" && row.folder_id ? { folderId: row.folder_id } : {}), createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

export async function loadContacts(): Promise<PersoraContact[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/contacts");
  return Array.isArray(rows) ? rows.map(contactFromRow) : [];
}

export async function saveContactRecord(contact: Omit<PersoraContact, "id" | "createdAt" | "updatedAt" | "photoDataUrl"> & { id?: string }): Promise<PersoraContact> {
  const row = await postJson<Record<string, unknown>>("/contacts", {
    id: contact.id, name: contact.name, phoneNumbers: contact.phoneNumbers, email: contact.email,
    company: contact.company, jobTitle: contact.jobTitle, address: contact.address, birthday: contact.birthday,
    notes: contact.notes, category: contact.category, favorite: contact.favorite, photoKey: contact.photoKey || null, folderId: contact.folderId || null,
  });
  return contactFromRow(row);
}

export async function deleteContactRecord(id: string): Promise<void> {
  await pagesApiRequest(`/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function mergeContactRecords(primaryId: string, duplicateIds: string[]): Promise<PersoraContact> {
  const row = await postJson<Record<string, unknown>>("/contacts/merge", { primaryId, duplicateIds });
  return contactFromRow(row);
}

export async function fetchContactPhoto(contactId: string): Promise<Blob> {
  const response = await pagesApiRequest(`/contacts/photo?id=${encodeURIComponent(contactId)}`);
  return response.blob();
}

function businessCardFromRow(row: Record<string, unknown>): DigitalBusinessCard {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  const phones = Array.isArray(row.phone_numbers) ? row.phone_numbers : [];
  const socials = Array.isArray(row.social_links) ? row.social_links : [];
  const links = Array.isArray(row.custom_links) ? row.custom_links : [];
  return {
    id: String(row.id || ""), ...(typeof row.card_id === "string" && row.card_id ? { cardId: row.card_id } : {}),
    isPublic: Boolean(row.is_public), style: (typeof row.card_style === "string" ? row.card_style : "garden") as DigitalBusinessCard["style"], fullName: String(row.full_name || ""),
    ...(typeof row.profile_photo_key === "string" && row.profile_photo_key ? { profilePhotoKey: row.profile_photo_key } : {}),
    ...(typeof row.business_logo_key === "string" && row.business_logo_key ? { businessLogoKey: row.business_logo_key } : {}),
    jobTitle: String(row.job_title || ""), company: String(row.company || ""),
    phoneNumbers: phones.filter((phone): phone is Record<string, unknown> => Boolean(phone) && typeof phone === "object" && !Array.isArray(phone)).map((phone) => ({ label: String(phone.label || "Mobile"), number: String(phone.number || "") })).filter((phone) => phone.number),
    email: String(row.email || ""), websites: strings(row.websites),
    socialLinks: socials.filter((link): link is Record<string, unknown> => Boolean(link) && typeof link === "object" && !Array.isArray(link)).map((link) => ({ platform: String(link.platform || "Facebook") as BusinessSocialLink["platform"], url: String(link.url || "") })).filter((link) => link.url),
    address: String(row.address || ""), bio: String(row.bio || ""),
    customLinks: links.filter((link): link is Record<string, unknown> => Boolean(link) && typeof link === "object" && !Array.isArray(link)).map((link) => ({ label: String(link.label || "Link"), url: String(link.url || "") })).filter((link) => link.url),
    createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || new Date().toISOString()),
    ...(typeof row.folder_id === "string" && row.folder_id ? { folderId: row.folder_id } : {}),
  };
}

export async function loadBusinessCards(): Promise<DigitalBusinessCard[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/business-cards");
  return Array.isArray(rows) ? rows.map(businessCardFromRow) : [];
}

export async function saveBusinessCard(card: BusinessCardDraft): Promise<DigitalBusinessCard> {
  const row = await postJson<Record<string, unknown>>("/business-cards", {
    id: card.id, cardId: card.cardId || null, isPublic: card.isPublic, style: card.style || "garden", fullName: card.fullName, jobTitle: card.jobTitle, company: card.company,
    phoneNumbers: card.phoneNumbers, email: card.email, websites: card.websites, socialLinks: card.socialLinks, address: card.address, bio: card.bio,
    customLinks: card.customLinks, profilePhotoKey: card.profilePhotoKey || null, businessLogoKey: card.businessLogoKey || null, folderId: card.folderId || null,
  });
  return businessCardFromRow(row);
}

export async function deleteBusinessCard(id: string): Promise<void> {
  await pagesApiRequest(`/business-cards?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchPublicBusinessCard(cardId: string): Promise<PublicDigitalBusinessCard> {
  const row = await pagesApiJson<Record<string, unknown>>(`/public-cards/${encodeURIComponent(cardId)}`);
  const card = businessCardFromRow(row);
  return {
    cardId: card.cardId || cardId, isPublic: true, style: card.style, fullName: card.fullName, jobTitle: card.jobTitle, company: card.company,
    phoneNumbers: card.phoneNumbers, email: card.email, websites: card.websites, socialLinks: card.socialLinks,
    address: card.address, bio: card.bio, customLinks: card.customLinks,
    ...(typeof row.profilePhotoUrl === "string" && row.profilePhotoUrl ? { profilePhotoUrl: row.profilePhotoUrl } : {}),
    ...(typeof row.businessLogoUrl === "string" && row.businessLogoUrl ? { businessLogoUrl: row.businessLogoUrl } : {}),
  };
}

export async function fetchPublicBusinessCardPhoto(cardId: string, kind: "profile" | "logo"): Promise<Blob> {
  const response = await pagesApiRequest(`/public-cards/${encodeURIComponent(cardId)}/photo?kind=${kind}`);
  return response.blob();
}

export async function reportPublicBusinessCard(cardId: string, reason: string, details = ""): Promise<void> {
  await postJson(`/public-cards/${encodeURIComponent(cardId)}/report`, { reason, details });
}

function sharedEntry(row: Record<string, unknown>, direction: SharedDirection): SharedVaultEntry {
  return {
    shareId: String(row.shareId || row.id || ""),
    permission: row.permission as SharePermission,
    createdAt: String(row.createdAt || ""),
    item: fromRow((row.item || {}) as Record<string, unknown>),
    owner: row.owner as SharedVaultEntry["owner"],
    recipient: row.recipient as SharedVaultEntry["recipient"],
    direction,
  };
}

export async function loadSharedItems(direction: SharedDirection): Promise<SharedVaultEntry[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>(`/shares?direction=${direction === "outgoing" ? "outgoing" : "incoming"}`);
  return Array.isArray(rows) ? rows.map((row) => sharedEntry(row, direction)) : [];
}

export async function loadRecordShares(direction: SharedDirection): Promise<RecordShareEntry[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>(`/record-shares?direction=${direction === "outgoing" ? "outgoing" : "incoming"}`);
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const resourceType = row.resourceType === "contact" || row.resourceType === "business_card" ? row.resourceType : null;
    if (!resourceType || !row.record || typeof row.record !== "object") return [];
    const raw = row.record as Record<string, unknown>;
    return [{
      shareId: String(row.shareId || ""), resourceType, resourceId: String(row.resourceId || raw.id || ""),
      record: resourceType === "contact" ? contactFromRow(raw) : businessCardFromRow(raw),
      owner: row.owner as RecordShareEntry["owner"], recipient: row.recipient as RecordShareEntry["recipient"],
      direction, createdAt: String(row.createdAt || ""),
    }];
  });
}

export async function createRecordShare(resourceType: "contact" | "business_card", resourceId: string, recipient: string): Promise<void> {
  await postJson("/record-shares", { resourceType, resourceId, recipient });
}

export async function revokeRecordShare(shareId: string): Promise<void> {
  await pagesApiJson("/record-shares", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareId }) });
}

export async function createDocumentShare(itemId: string, recipient: string, permission: SharePermission): Promise<void> {
  await postJson("/shares", { itemId, recipient, permission });
}

export async function changeDocumentSharePermission(shareId: string, permission: SharePermission): Promise<void> {
  await pagesApiJson("/shares", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareId, permission }) });
}

export async function revokeDocumentShare(shareId: string): Promise<void> {
  await pagesApiJson("/shares", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareId }) });
}

export async function saveSharedDocument(shareId: string, item: VaultItem): Promise<VaultItem> {
  const row = await postJson<Record<string, unknown>>("/shares/item", { shareId, ...item, sharedAccess: undefined });
  return fromRow(row);
}

function timelineEventFromPayload(value: Record<string, unknown>): TimelineEvent {
  const linked = Array.isArray(value.linkedRecordIds) ? value.linkedRecordIds.filter((id): id is string => typeof id === "string") : [];
  const attachmentValue = value.attachment && typeof value.attachment === "object" ? value.attachment as Record<string, unknown> : null;
  const attachment: TimelineAttachment | undefined = attachmentValue && typeof attachmentValue.name === "string" ? {
    name: attachmentValue.name, size: Number(attachmentValue.size || 0), type: String(attachmentValue.type || "application/octet-stream"),
    ...(typeof attachmentValue.key === "string" ? { key: attachmentValue.key } : {}),
  } : undefined;
  return {
    id: String(value.id || ""), eventType: value.eventType === "automatic" ? "automatic" : "manual", eventDate: String(value.eventDate || ""),
    title: String(value.title || ""), description: String(value.description || ""), ...(typeof value.url === "string" && value.url ? { url: value.url } : {}),
    ...(typeof value.eventKey === "string" ? { eventKey: value.eventKey } : {}), ...(typeof value.recordId === "string" ? { recordId: value.recordId } : {}),
    linkedRecordIds: linked, ...(attachment ? { attachment } : {}), createdAt: String(value.createdAt || ""), updatedAt: String(value.updatedAt || ""),
  };
}

export async function loadTimelineEvents(): Promise<TimelineEvent[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/timeline");
  return Array.isArray(rows) ? rows.map(timelineEventFromPayload) : [];
}

export async function saveTimelineEvent(draft: TimelineDraft): Promise<TimelineEvent> {
  const row = await postJson<Record<string, unknown>>("/timeline", {
    id: draft.id, eventDate: draft.eventDate, title: draft.title, description: draft.description, url: draft.url,
    linkedRecordIds: draft.linkedRecordIds, attachment: draft.removeAttachment ? null : draft.attachment || null,
  });
  return timelineEventFromPayload(row);
}

export async function deleteTimelineEvent(id: string): Promise<void> {
  await pagesApiRequest(`/timeline?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadTimelineAttachment(file: File): Promise<TimelineAttachment> {
  const form = new FormData(); form.append("file", file, file.name);
  const result = await uploadMultipart<TimelineAttachment>("/timeline/attachment", form);
  return result;
}

export async function downloadTimelineAttachment(eventId: string): Promise<void> {
  const response = await pagesApiRequest(`/timeline/attachment?eventId=${encodeURIComponent(eventId)}`);
  const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob);
  const encoded = response.headers.get("X-File-Name"); let name = "timeline-attachment";
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { name = encoded; } }
  const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function medicalRecordFromRow(row: Record<string, unknown>): MedicalRecord {
  const file = typeof row.file_name === "string" && row.file_name ? {
    name: row.file_name, size: Number(row.file_size || 0), type: String(row.file_type || "application/octet-stream"),
    ...(typeof row.file_key === "string" && row.file_key ? { key: row.file_key } : {}),
  } satisfies MedicalRecordFile : undefined;
  const links: MedicalRecordLink[] = Array.isArray(row.links) ? row.links.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const link = value as Record<string, unknown>;
    if ((link.record_type !== "contact" && link.record_type !== "vault_item") || typeof link.record_id !== "string") return [];
    return [{ recordType: link.record_type, recordId: link.record_id, linkKind: link.link_kind === "reminder" ? "reminder" : "related" }];
  }) : [];
  return {
    id: String(row.id || ""), title: String(row.title || ""), recordType: String(row.record_type || "Other") as MedicalRecord["recordType"],
    recordDate: String(row.record_date || ""), provider: String(row.provider || ""), hospital: String(row.hospital || ""), specialty: String(row.specialty || ""), notes: String(row.notes || ""),
    diagnosis: String(row.diagnosis || ""), testName: String(row.test_name || ""), testResult: String(row.test_result || ""), medicationNotes: String(row.medication_notes || ""),
    followUpDate: String(row.follow_up_date || ""), ...(typeof row.related_reminder_id === "string" && row.related_reminder_id ? { relatedReminderId: row.related_reminder_id } : {}),
    ...(file ? { file } : {}), links: links.filter((link) => link.linkKind !== "reminder"),
    ...(typeof row.folder_id === "string" && row.folder_id ? { folderId: row.folder_id } : {}), createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
  };
}

export async function loadMedicalRecords(): Promise<MedicalRecord[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/medical-records");
  return Array.isArray(rows) ? rows.map(medicalRecordFromRow) : [];
}

export async function saveMedicalRecord(draft: MedicalRecordDraft): Promise<MedicalRecord> {
  const row = await postJson<Record<string, unknown>>("/medical-records", {
    id: draft.id, title: draft.title, recordType: draft.recordType, recordDate: draft.recordDate, provider: draft.provider, hospital: draft.hospital, specialty: draft.specialty, notes: draft.notes,
    diagnosis: draft.diagnosis, testName: draft.testName, testResult: draft.testResult, medicationNotes: draft.medicationNotes, followUpDate: draft.followUpDate,
    relatedReminderId: draft.relatedReminderId || null, links: draft.links, file: draft.removeFile ? null : draft.file || null, folderId: draft.folderId || null,
  });
  return medicalRecordFromRow(row);
}

export async function deleteMedicalRecord(id: string): Promise<void> {
  await pagesApiRequest(`/medical-records?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadMedicalRecordFile(file: File, onProgress?: (progress: TransferProgress) => void): Promise<MedicalRecordFile> {
  const form = new FormData(); form.append("file", file, file.name);
  const result = await uploadMultipart<MedicalRecordFile>("/medical-records/upload", form, onProgress);
  return result;
}

export async function deleteUnattachedMedicalRecordFile(key: string): Promise<void> {
  await pagesApiRequest(`/medical-records/upload?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function fetchMedicalRecordFile(recordId: string): Promise<{ blob: Blob; name: string }> {
  const response = await pagesApiRequest(`/medical-records/file?id=${encodeURIComponent(recordId)}`);
  const encoded = response.headers.get("X-File-Name"); let name = "medical-record";
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { name = encoded; } }
  return { blob: await response.blob(), name };
}

export async function downloadMedicalRecordFile(recordId: string): Promise<void> {
  const { blob, name } = await fetchMedicalRecordFile(recordId);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function uploadMultipart<T>(path: string, form: FormData, onProgress?: (progress: TransferProgress) => void): Promise<T> {
  if (!apiBase) return Promise.reject(new Error("Persora's Pages Functions API is not enabled. Set VITE_USE_PAGES_FUNCTIONS=true in Cloudflare Pages settings."));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fileValue = form.get("file");
    const fileSize = fileValue instanceof File ? fileValue.size : 0;
    const start = performance.now();
    xhr.open("POST", `${apiBase}${path}`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.addEventListener("progress", (event) => {
      const total = fileSize || (event.lengthComputable && event.total > 0 ? event.total : event.loaded);
      const loaded = Math.min(event.loaded, total || event.loaded);
      const percent = total ? Math.round(loaded / total * 100) : 0;
      const elapsed = Math.max(0.1, (performance.now() - start) / 1000);
      const rate = loaded / elapsed;
      const remainingSeconds = total && rate > 0 ? Math.max(0, (total - loaded) / rate) : null;
      onProgress?.({ loaded, total, percent, remainingSeconds });
    });
    xhr.onerror = () => reject(new Error("Upload failed due to a network error. Please try again."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.onload = () => {
      const payload = xhr.response || (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = payload && typeof payload === "object" && typeof payload.error === "string" ? payload.error : `Persora service returned ${xhr.status}.`;
        reject(new PagesApiError(message, xhr.status));
        return;
      }
      onProgress?.({ loaded: Number(form.get("file") instanceof File ? (form.get("file") as File).size : 0), total: Number(form.get("file") instanceof File ? (form.get("file") as File).size : 0), percent: 100, remainingSeconds: 0 });
      resolve(payload as T);
    };
    xhr.send(form);
  });
}

export async function uploadSharedDocumentFile(shareId: string, file: File, onProgress?: (progress: TransferProgress) => void): Promise<VaultFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  const result = await uploadMultipart<{ key: string; name: string; size: number; type: string }>(`/shares/upload?shareId=${encodeURIComponent(shareId)}`, form, onProgress);
  return { key: result.key, name: result.name, size: result.size, type: result.type };
}

export async function deleteUnattachedSharedUpload(shareId: string, key: string): Promise<void> {
  await pagesApiRequest(`/shares/upload?shareId=${encodeURIComponent(shareId)}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function loadShareComments(shareId: string): Promise<ShareComment[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>(`/shares/comments?shareId=${encodeURIComponent(shareId)}`);
  return Array.isArray(rows) ? rows.map((row) => ({ id: String(row.id), shareId: String(row.shareId), authorId: String(row.authorId), authorName: String(row.authorName || "Persora member"), body: String(row.body || ""), createdAt: String(row.createdAt || "") })) : [];
}

export async function addShareComment(shareId: string, body: string): Promise<ShareComment> {
  const row = await postJson<Record<string, unknown>>("/shares/comments", { shareId, body });
  return { id: String(row.id), shareId: String(row.shareId), authorId: String(row.authorId), authorName: String(row.authorName || "Persora member"), body: String(row.body || ""), createdAt: String(row.createdAt || "") };
}

export async function loadShareNotifications(): Promise<ShareNotification[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/notifications");
  return Array.isArray(rows) ? rows.map((row) => ({ id: String(row.id), kind: row.kind as ShareNotification["kind"], itemTitle: String(row.item_title || "Shared document"), actorName: String(row.actor_name || "Persora user"), message: String(row.message || ""), createdAt: String(row.created_at || ""), readAt: typeof row.read_at === "string" ? row.read_at : undefined })) : [];
}

export async function markShareNotificationsRead(): Promise<void> {
  await pagesApiJson("/notifications", { method: "PATCH" });
}

export async function saveVaultItem(item: VaultItem): Promise<VaultItem> {
  const row = await postJson<Record<string, unknown>>("/vault/items", item);
  return fromRow(row);
}

export async function removeVaultItem(id: string): Promise<void> {
  await pagesApiRequest(`/vault/items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateProfile(values: { fullName: string; timezone: string; avatarUrl?: string }): Promise<void> {
  await pagesApiJson("/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
}

export async function uploadVaultFile(file: File, onProgress?: (progress: TransferProgress) => void): Promise<VaultFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  const result = await uploadMultipart<{ key: string; name: string; size: number; type: string }>("/upload", form, onProgress);
  return { key: result.key, name: result.name, size: result.size, type: result.type };
}

export async function smartScanDocument(file: File, section: string, fields: SmartScanFieldDefinition[], retry = false): Promise<SmartScanResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("section", section);
  form.append("fields", JSON.stringify(fields));
  form.append("retry", retry ? "true" : "false");
  return uploadMultipart<SmartScanResult>("/smart-scan", form);
}

export async function deleteVaultFile(key: string): Promise<void> {
  await pagesApiRequest(`/file?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function fetchVaultFile(key: string): Promise<{ blob: Blob; name: string }> {
  const response = await pagesApiRequest(`/file?key=${encodeURIComponent(key)}`);
  const encodedName = response.headers.get("X-File-Name");
  let name = key.split("/").pop() || "persora-file";
  if (encodedName) { try { name = decodeURIComponent(encodedName); } catch { name = encodedName; } }
  return { blob: await response.blob(), name };
}

export async function openVaultFile(key: string): Promise<void> {
  const { blob, name } = await fetchVaultFile(key);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function loadAlarmRingtones(): Promise<AlarmRingtone[]> {
  const result = await pagesApiJson<AlarmRingtone[]>("/alarm-ringtones");
  return Array.isArray(result) ? result : [];
}

export function alarmRingtoneAudioPath(id: string): string {
  return `${apiBase}/alarm-ringtones/${encodeURIComponent(id)}/audio`;
}

export async function uploadAlarmRingtone(name: string, file: File): Promise<AlarmRingtone> {
  const form = new FormData();
  form.append("name", name);
  form.append("file", file, file.name);
  return uploadMultipart<AlarmRingtone>("/admin/alarm-ringtones", form);
}

export async function deleteAlarmRingtone(id: string): Promise<void> {
  await pagesApiRequest(`/admin/alarm-ringtones?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function runAdminAction(userId: string, action: "suspend" | "restore" | "delete" | "promote" | "demote"): Promise<void> {
  await postJson("/admin/users", { userId, action });
}

export async function loadAdminConsole(): Promise<AdminConsoleSnapshot> {
  const snapshot = await pagesApiJson<AdminConsoleSnapshot>("/admin/console");
  return {
    ...snapshot,
    paymentMethods: Array.isArray(snapshot.paymentMethods) ? snapshot.paymentMethods : [],
    siteContent: { ...DEFAULT_SITE_CONTENT, ...(snapshot.siteContent || {}) },
  };
}

export async function savePlatformSetting(key: "billing" | "storage" | "payment_methods" | "site_content", value: unknown): Promise<void> {
  await postJson("/admin/settings", { key, value });
}

export async function saveSubscriptionPlan(plan: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
  return postJson("/admin/plans", plan);
}

export async function saveDocumentType(type: Partial<DocumentTypeOption>): Promise<DocumentTypeOption> {
  return postJson("/admin/document-types", type);
}

export async function reviewPayment(paymentId: string, decision: "approve" | "reject", note: string): Promise<void> {
  await postJson("/admin/payments", { paymentId, decision, note });
}

export async function loadAdminBootstrapStatus(): Promise<{ initialized: boolean | null; enabled: boolean }> {
  return pagesApiJson("/admin/bootstrap/status");
}

export async function claimFirstAdmin(secret: string): Promise<void> {
  await postJson("/admin/bootstrap", { secret });
}

export async function loadPublicPlans(): Promise<{ plans: SubscriptionPlan[]; billingEnabled: boolean; currency: string; maxUploadMb: number }> {
  const response = await publicRequest("/plans");
  const body = await response.json() as { plans: SubscriptionPlan[]; billingSettings: { billingEnabled: boolean; currency: string }; maxUploadMb?: number };
  return { plans: body.plans || [], billingEnabled: Boolean(body.billingSettings?.billingEnabled), currency: body.billingSettings?.currency || "BDT", maxUploadMb: body.maxUploadMb || 25 };
}

export async function loadDocumentTypes(): Promise<DocumentTypeOption[]> {
  const response = await publicRequest("/document-types");
  return response.json() as Promise<DocumentTypeOption[]>;
}

export async function loadPublicSiteContent(): Promise<SiteContent> {
  const saved = await pagesApiJson<Partial<SiteContent>>("/site-content");
  return { ...DEFAULT_SITE_CONTENT, ...(saved || {}) };
}

export async function loadBilling(): Promise<BillingSnapshot> {
  return pagesApiJson<BillingSnapshot>("/billing");
}

export async function submitPaymentRequest(planId: string, methodId: string, reference: string, billingPeriod: "monthly" | "yearly", durationCount: number): Promise<PaymentRecord> {
  return postJson("/payments", { planId, methodId, reference, billingPeriod, durationCount });
}

export async function loadStorageUsage(): Promise<BillingSnapshot["storage"]> {
  return pagesApiJson("/storage/usage");
}

export async function loadAdminMetrics(): Promise<AdminMetrics> {
  const snapshot = await loadAdminConsole();
  return snapshot.metrics;
}

export async function deleteOwnAccount(): Promise<void> {
  await pagesApiRequest("/account", { method: "DELETE" });
}

export async function updatePassword(currentPassword: string, newPassword: string): Promise<void> {
  await postJson("/auth/password", { currentPassword, newPassword });
}

export async function healthCheck(): Promise<{ ok: boolean; service?: string }> {
  return pagesApiJson("/health");
}
