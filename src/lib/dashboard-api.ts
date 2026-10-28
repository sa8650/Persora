// Persora Customizable Dashboard — browser API client, device cache, and
// privacy-safe Recent Activity tracker (records real item open timestamps only).

import {
  DASHBOARD_PRESETS,
  DASHBOARD_PRESET_BY_ID,
  DASHBOARD_WIDGET_BY_TYPE,
  DASHBOARD_WIDGET_CATALOG,
  DASHBOARD_WIDGET_CATEGORIES,
  DASHBOARD_WIDGET_HEIGHTS,
  DASHBOARD_WIDGET_WIDTHS,
  DEFAULT_QUICK_ACTION_IDS,
  QUICK_ACTION_DEFINITIONS,
  WIDTH_RANK,
  WIDTH_SPAN_DESKTOP,
  buildPresetWidgets,
  clampWidgetWidth,
  createDefaultDashboardLayout,
  createWidgetFromLibrary,
  duplicateWidgetInstance,
  isDashboardHeight,
  isDashboardPresetId,
  isDashboardWidgetType,
  moveWidgetById,
  normalizeWidgetConfig,
  removeWidgetInstance,
  reorderWidgets,
  stepWidgetOrder,
  updateWidgetInstance,
  type DashboardCategoryMeta,
  type DashboardLayoutSnapshot,
  type DashboardPresetDefinition,
  type DashboardPresetId,
  type DashboardWidgetCatalogItem,
  type DashboardWidgetCategoryId,
  type DashboardWidgetHeight,
  type DashboardWidgetInstance,
  type DashboardWidgetType,
  type DashboardWidgetWidth,
  type QuickActionDefinition,
  type QuickActionId,
} from "../../cloudflare/dashboard-rules.js";
import { PagesApiError, isPagesApiConfigured, pagesApiRequest } from "./cloud";

export {
  DASHBOARD_PRESETS,
  DASHBOARD_PRESET_BY_ID,
  DASHBOARD_WIDGET_BY_TYPE,
  DASHBOARD_WIDGET_CATALOG,
  DASHBOARD_WIDGET_CATEGORIES,
  DASHBOARD_WIDGET_HEIGHTS,
  DASHBOARD_WIDGET_WIDTHS,
  DEFAULT_QUICK_ACTION_IDS,
  QUICK_ACTION_DEFINITIONS,
  WIDTH_RANK,
  WIDTH_SPAN_DESKTOP,
  buildPresetWidgets,
  clampWidgetWidth,
  createDefaultDashboardLayout,
  createWidgetFromLibrary,
  duplicateWidgetInstance,
  isDashboardHeight,
  isDashboardPresetId,
  isDashboardWidgetType,
  moveWidgetById,
  normalizeWidgetConfig,
  removeWidgetInstance,
  reorderWidgets,
  stepWidgetOrder,
  updateWidgetInstance,
};

export type {
  DashboardCategoryMeta,
  DashboardLayoutSnapshot,
  DashboardPresetDefinition,
  DashboardPresetId,
  DashboardWidgetCatalogItem,
  DashboardWidgetCategoryId,
  DashboardWidgetHeight,
  DashboardWidgetInstance,
  DashboardWidgetType,
  DashboardWidgetWidth,
  QuickActionDefinition,
  QuickActionId,
};

export class DashboardConflictError extends Error {
  readonly status = 409;
  readonly current: DashboardLayoutSnapshot | null;
  constructor(message: string, current: DashboardLayoutSnapshot | null) {
    super(message);
    this.name = "DashboardConflictError";
    this.current = current;
  }
}

export async function loadDashboardConfig(signal?: AbortSignal): Promise<DashboardLayoutSnapshot> {
  const response = await pagesApiRequest("/dashboard", { signal });
  return (await response.json()) as DashboardLayoutSnapshot;
}

export async function saveDashboardConfig(input: {
  activePreset: DashboardPresetId | "custom";
  expectedRevision: number | null;
  widgets: DashboardWidgetInstance[];
}): Promise<DashboardLayoutSnapshot> {
  let response: Response;
  try {
    response = await pagesApiRequest("/dashboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    if (err instanceof PagesApiError && err.status === 409) {
      throw new DashboardConflictError(err.message, null);
    }
    throw err;
  }
  return (await response.json()) as DashboardLayoutSnapshot;
}

/**
 * Direct conflict-aware save that preserves the `current` snapshot returned on HTTP 409.
 */
export async function saveDashboardConfigConflictSafe(input: {
  activePreset: DashboardPresetId | "custom";
  expectedRevision: number | null;
  widgets: DashboardWidgetInstance[];
}): Promise<DashboardLayoutSnapshot> {
  const response = await fetch("/api/dashboard", {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (response.status === 409) {
    const current = payload.current && typeof payload.current === "object"
      ? sanitizeSnapshot(payload.current as Partial<DashboardLayoutSnapshot>)
      : null;
    throw new DashboardConflictError(
      typeof payload.error === "string" ? payload.error : "Your dashboard was updated on another device.",
      current,
    );
  }
  if (!response.ok) {
    throw new PagesApiError(
      typeof payload.error === "string" ? payload.error : "Could not save your dashboard.",
      response.status,
    );
  }
  return sanitizeSnapshot(payload as Partial<DashboardLayoutSnapshot>);
}

export async function resetDashboardConfig(expectedRevision?: number | null): Promise<DashboardLayoutSnapshot> {
  const response = await pagesApiRequest("/dashboard/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: expectedRevision ?? null }),
  });
  return sanitizeSnapshot((await response.json()) as Partial<DashboardLayoutSnapshot>);
}

export function sanitizeSnapshot(raw: Partial<DashboardLayoutSnapshot> | null | undefined): DashboardLayoutSnapshot {
  if (!raw || typeof raw !== "object" || !raw.customized || !Array.isArray(raw.widgets)) {
    return createDefaultDashboardLayout();
  }
  const activePreset = raw.activePreset === "custom" || isDashboardPresetId(raw.activePreset)
    ? raw.activePreset
    : "custom";
  const widgets: DashboardWidgetInstance[] = [];
  for (const entry of raw.widgets) {
    if (!entry || typeof entry !== "object" || !isDashboardWidgetType(entry.type)) continue;
    const meta = DASHBOARD_WIDGET_BY_TYPE[entry.type];
    widgets.push({
      id: String(entry.id || `w-${widgets.length}`),
      type: entry.type,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : meta.defaultTitle,
      config: normalizeWidgetConfig(entry.type, entry.config, { strict: false }),
      position: widgets.length,
      width: clampWidgetWidth(entry.type, entry.width),
      height: isDashboardHeight(entry.height) ? entry.height : meta.defaultHeight,
      visible: entry.visible === undefined ? true : Boolean(entry.visible),
      collapsed: entry.collapsed === undefined ? false : Boolean(entry.collapsed),
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : undefined,
    });
  }
  return {
    customized: true,
    activePreset,
    revision: typeof raw.revision === "number" && raw.revision >= 0 ? raw.revision : 1,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    widgets,
  };
}

// ---------------------------------------------------------------------------
// Per-user device cache (instant render + demo workspace persistence)
// ---------------------------------------------------------------------------
export interface StoredDashboardCache {
  snapshot: DashboardLayoutSnapshot;
  synced: boolean;
}

const layoutCacheKey = (userId: string) => `persora-dashboard-layout:v1:${encodeURIComponent(userId || "anon")}`;

export function readStoredDashboardLayout(userId: string): StoredDashboardCache | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(layoutCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { snapshot?: Partial<DashboardLayoutSnapshot>; synced?: boolean };
    if (!parsed || typeof parsed !== "object" || !parsed.snapshot) return null;
    return {
      snapshot: sanitizeSnapshot(parsed.snapshot),
      synced: Boolean(parsed.synced),
    };
  } catch {
    return null;
  }
}

export function writeStoredDashboardLayout(userId: string, cache: StoredDashboardCache): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(layoutCacheKey(userId), JSON.stringify(cache));
  } catch {
    /* Best-effort browser cache */
  }
}

export function clearStoredDashboardLayout(userId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(layoutCacheKey(userId));
  } catch {
    /* Best-effort browser cache */
  }
}

// ---------------------------------------------------------------------------
// Real Item Open Activity Log (privacy-safe: stores only IDs & timestamps)
// ---------------------------------------------------------------------------
export interface RecentAccessEntry {
  kind: "vault" | "contact" | "business-card";
  id: string;
  openedAt: string;
}

export const DASHBOARD_RECENT_OPEN_EVENT = "persora-dashboard-recent-open";
const RECENT_OPENS_MAX = 40;
const recentOpensKey = (userId: string) => `persora-recent-opens:v1:${encodeURIComponent(userId || "anon")}`;

export function readRecentItemAccess(userId: string): RecentAccessEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(recentOpensKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentAccessEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry &&
        (entry.kind === "vault" || entry.kind === "contact" || entry.kind === "business-card") &&
        typeof entry.id === "string" &&
        typeof entry.openedAt === "string",
    );
  } catch {
    return [];
  }
}

const SENSITIVE_RECENT_SECTIONS = new Set(["medical-records", "password-manager"]);

export function recordRecentItemAccess(
  userId: string,
  entry: { kind: "vault" | "contact" | "business-card"; id: string; section?: string; openedAt?: string },
): void {
  if (!userId || !entry.id || typeof localStorage === "undefined") return;
  if (
    (entry.section && SENSITIVE_RECENT_SECTIONS.has(entry.section)) ||
    /^(medical-records|password-manager):/i.test(entry.id)
  ) {
    return;
  }
  const openedAt = entry.openedAt || new Date().toISOString();
  const existing = readRecentItemAccess(userId).filter(
    (item) => !(item.kind === entry.kind && item.id === entry.id),
  );
  const next: RecentAccessEntry[] = [{ kind: entry.kind, id: entry.id, openedAt }, ...existing].slice(
    0,
    RECENT_OPENS_MAX,
  );
  try {
    localStorage.setItem(recentOpensKey(userId), JSON.stringify(next));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(DASHBOARD_RECENT_OPEN_EVENT));
    }
  } catch {
    /* Best-effort */
  }
}

export { isPagesApiConfigured };
