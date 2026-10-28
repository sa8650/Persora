export const DOCS_ROUTE_PREFIX = "/docs";
export const PUBLIC_DOCS_ROUTE_PREFIX = "/public/docs";

export class DocError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status?: number, extra?: Record<string, unknown>);
}

export function isUuid(value: unknown): value is string;
export function generateDocShareToken(): string;
export function handlePublicDocs(request: Request, env: Record<string, unknown>, origin: string): Promise<Response>;
export function exportDocsData(userId: string, env: Record<string, unknown>): Promise<{ docs: unknown[] }>;
export function handleDocs(
  request: Request,
  identity: { id: string; email?: string; full_name?: string; login_id?: string },
  env: Record<string, unknown>,
  origin: string,
  services?: Record<string, unknown>,
): Promise<Response>;
