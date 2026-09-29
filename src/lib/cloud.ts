import type { AdminConsoleSnapshot, AdminMetrics, BillingSnapshot, DocumentTypeOption, PaymentRecord, SiteContent, SubscriptionPlan, VaultFile, VaultItem } from "../types";
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
  };
}

export async function loadVaultItems(): Promise<VaultItem[]> {
  const rows = await pagesApiJson<Record<string, unknown>[]>("/vault/items");
  return Array.isArray(rows) ? rows.map(fromRow) : [];
}

export async function saveVaultItem(item: VaultItem): Promise<VaultItem> {
  const row = await postJson<Record<string, unknown>>("/vault/items", item);
  return fromRow(row);
}

export async function removeVaultItem(id: string): Promise<void> {
  await pagesApiRequest(`/vault/items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateProfile(values: { fullName: string; timezone: string }): Promise<void> {
  await pagesApiJson("/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
}

export async function uploadVaultFile(file: File): Promise<VaultFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  const result = await pagesApiJson<{ key: string; name: string; size: number; type: string }>("/upload", { method: "POST", body: form });
  return { key: result.key, name: result.name, size: result.size, type: result.type };
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

export async function submitPaymentRequest(planId: string, methodId: string, reference: string): Promise<PaymentRecord> {
  return postJson("/payments", { planId, methodId, reference });
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
