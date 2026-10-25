// Persora Connections — browser client. The browser only ever talks to
// Persora's own /api; Persora's worker talks to EMS server-to-server. No EMS
// URL, secret or grant token is ever exposed here.
import { isPagesApiConfigured } from "./cloud";

export type ConnectionStatus = "connected" | "reauth_required" | "revoked" | "not_connected" | "unavailable" | "coming_soon";

export interface ConnectionAccount { id: string | null; name: string; email: string; code: string | null }
export interface ConnectionSummary { provider: string; status: ConnectionStatus; account: ConnectionAccount; connectedAt: string; lastSyncedAt: string | null; lastError: string | null }
export interface ConnectionProvider {
  id: string; name: string; vendor: string; category: string; description: string; capabilities: string[];
  available: boolean; enabled: boolean; status: ConnectionStatus; connection: ConnectionSummary | null;
}
export interface EmsShop { id: string; name: string; code: string | null; status: string; type: string | null; fileCount: number | null }
export interface EmsEligibility { eligible: boolean; sources?: string[]; vaultium_active?: boolean; first_purchased_at?: string | null }
export interface EmsOverview {
  status: ConnectionStatus; integrationReady: boolean; degraded?: boolean; notice?: string; code?: string;
  connection: ConnectionSummary | null;
  account?: { admin: ConnectionAccount; stores: EmsShop[]; eligibility: EmsEligibility | null; totalFiles: number | null };
}
export interface EmsFile { id: string; storeId: string; name: string; type: string; size: number; createdAt: string | null; reference: string | null; category: "invoice" | "expense" | "file" }
export interface EmsFilePage { files: EmsFile[]; total: number; offset: number; limit: number; hasMore: boolean }
export interface IntegrationStatus {
  provider: string; name: string; enabled: boolean; ready: boolean; baseUrl: string; baseUrlSource: "console" | "environment" | null;
  secretConfigured: boolean; secretReadable: boolean; secretSource: "console" | "environment" | null; secretHint: string | null;
  encryptionConfigured: boolean; updatedAt: string | null; lastCheck: { at: string; ok: boolean; message: string } | null;
  connections: { connected: number; reauthRequired: number }; minSecretLength: number;
}

export class ConnectionsApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code = "") { super(message); this.name = "ConnectionsApiError"; this.status = status; this.code = code; }
}

export const connectionsAvailable = isPagesApiConfigured;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isPagesApiConfigured) throw new ConnectionsApiError("Connections need Persora's cloud service. They aren't available in the local demo.", 503, "offline");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ConnectionsApiError("Persora couldn't be reached. Check your connection and try again.", 0, "network");
  }
  if (!response.ok) {
    let message = `Persora returned ${response.status}.`; let code = "";
    try { const body = await response.json() as { error?: string; code?: string }; if (body.error) message = body.error; if (body.code) code = body.code; } catch { /* keep default */ }
    throw new ConnectionsApiError(message, response.status, code);
  }
  return response;
}
async function getJson<T>(path: string): Promise<T> { return (await request(path)).json() as Promise<T>; }
async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return (await request(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<T>;
}

export const loadConnections = () => getJson<{ providers: ConnectionProvider[] }>("/connections").then((r) => r.providers);
export const loadEmsOverview = () => getJson<EmsOverview>("/connections/ems");
export const connectEms = (email: string, password: string) => sendJson<{ connection: ConnectionSummary }>("/connections/ems/connect", "POST", { email, password });
export const disconnectEms = () => sendJson<{ ok: boolean; remoteRevoked: boolean }>("/connections/ems", "DELETE");
export function loadEmsFiles(options: { storeId?: string; q?: string; offset?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (options.storeId) query.set("storeId", options.storeId);
  if (options.q) query.set("q", options.q);
  if (options.offset) query.set("offset", String(options.offset));
  query.set("limit", String(options.limit || 50));
  return getJson<EmsFilePage>(`/connections/ems/files?${query.toString()}`);
}
/** Fetches the file through Persora's proxy as a Blob (used for previews and downloads). */
export async function fetchEmsFile(fileId: string, inline = false): Promise<Blob> {
  const response = await request(`/connections/ems/files/${encodeURIComponent(fileId)}${inline ? "?disposition=inline" : ""}`);
  return response.blob();
}
export const saveEmsFileCopy = (fileId: string) => sendJson<{ ok: boolean; item: { id: string; title: string; folderName: string } }>(`/connections/ems/files/${encodeURIComponent(fileId)}/save`, "POST", {});

export const loadIntegrationStatus = (provider = "ems") => getJson<IntegrationStatus>(`/admin/integrations/${provider}`);
export const saveIntegration = (provider: string, body: { enabled?: boolean; baseUrl?: string; secret?: string; clearSecret?: boolean }) => sendJson<IntegrationStatus>(`/admin/integrations/${provider}`, "POST", body);
export const testIntegration = (provider = "ems") => sendJson<{ ok: boolean; message: string; status: IntegrationStatus }>(`/admin/integrations/${provider}/test`, "POST", {});
