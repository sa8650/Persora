export type DashboardWidgetWidth = "compact" | "half" | "two-thirds" | "full";
export type DashboardWidgetHeight = "compact" | "standard" | "expanded";

export type DashboardWidgetCategoryId =
  | "productivity"
  | "personal-documents"
  | "payments-renewals"
  | "personal-tools"
  | "connected-services";

export type DashboardWidgetType =
  | "quick-actions"
  | "calendar-agenda"
  | "tasks-due"
  | "upcoming-reminders"
  | "habit-tracker"
  | "quick-note"
  | "recently-opened"
  | "project-progress"
  | "recent-project-activity"
  | "expiring-documents"
  | "recent-documents"
  | "pinned-folders"
  | "family-document-overview"
  | "academic-records"
  | "warranty-expiry"
  | "recent-uploads"
  | "upcoming-loan-installments"
  | "subscription-renewals"
  | "combined-upcoming-payments"
  | "payment-status-summary"
  | "favorite-urls"
  | "digital-memberships"
  | "contact-shortcuts"
  | "pdf-studio-shortcut"
  | "photo-studio-shortcut"
  | "medical-records-shortcut"
  | "password-vault-status"
  | "google-drive-status"
  | "external-storage-status"
  | "connected-service-shortcuts";

export type DashboardPresetId =
  | "balanced"
  | "productivity"
  | "personal-records"
  | "payments-and-renewals"
  | "minimal";

export type QuickActionId =
  | "add-document"
  | "create-task"
  | "add-calendar-event"
  | "create-note"
  | "add-reminder"
  | "add-habit"
  | "add-loan"
  | "open-photo-studio"
  | "open-pdf-studio"
  | "open-projects"
  | "open-contacts"
  | "open-tables";

export interface DashboardCategoryMeta {
  id: DashboardWidgetCategoryId;
  label: string;
  description: string;
}

export interface QuickActionDefinition {
  id: QuickActionId;
  label: string;
  hint: string;
}

export type WidgetSchemaRule =
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "int"; min: number; max: number }
  | { kind: "string"; max: number }
  | { kind: "idList"; allowed: ReadonlySet<string>; max: number; min?: number };

export interface DashboardWidgetCatalogItem {
  type: DashboardWidgetType;
  category: DashboardWidgetCategoryId;
  name: string;
  defaultTitle: string;
  description: string;
  previewSummary: string;
  allowMultiple: boolean;
  minWidth: DashboardWidgetWidth;
  defaultWidth: DashboardWidgetWidth;
  defaultHeight: DashboardWidgetHeight;
  defaultConfig: Record<string, unknown>;
  schema: Record<string, WidgetSchemaRule>;
}

export interface DashboardWidgetInstance {
  id: string;
  type: DashboardWidgetType;
  title: string;
  config: Record<string, unknown>;
  position: number;
  width: DashboardWidgetWidth;
  height: DashboardWidgetHeight;
  visible: boolean;
  collapsed: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardPresetDefinition {
  id: DashboardPresetId;
  name: string;
  badge: string;
  description: string;
  widgets: ReadonlyArray<{
    id: string;
    type: DashboardWidgetType;
    title: string;
    width: DashboardWidgetWidth;
    height: DashboardWidgetHeight;
    config: Record<string, unknown>;
  }>;
}

export interface DashboardLayoutSnapshot {
  customized: boolean;
  activePreset: DashboardPresetId | "custom";
  revision: number;
  updatedAt: string | null;
  widgets: DashboardWidgetInstance[];
}

export const DASHBOARD_MAX_WIDGETS: number;
export const DASHBOARD_TITLE_MAX: number;
export const DASHBOARD_NOTE_MAX: number;
export const DASHBOARD_WIDGET_ID_RE: RegExp;

export const DASHBOARD_WIDGET_WIDTHS: readonly DashboardWidgetWidth[];
export const DASHBOARD_WIDGET_HEIGHTS: readonly DashboardWidgetHeight[];
export const WIDTH_SPAN_DESKTOP: Readonly<Record<DashboardWidgetWidth, number>>;
export const WIDTH_RANK: Readonly<Record<DashboardWidgetWidth, number>>;

export const DASHBOARD_WIDGET_CATEGORIES: readonly DashboardCategoryMeta[];
export const QUICK_ACTION_DEFINITIONS: readonly QuickActionDefinition[];
export const QUICK_ACTION_IDS: readonly QuickActionId[];
export const DEFAULT_QUICK_ACTION_IDS: readonly QuickActionId[];

export const DASHBOARD_WIDGET_CATALOG: readonly DashboardWidgetCatalogItem[];
export const DASHBOARD_WIDGET_TYPES: readonly DashboardWidgetType[];
export const DASHBOARD_WIDGET_BY_TYPE: Readonly<Record<DashboardWidgetType, DashboardWidgetCatalogItem>>;

export const DASHBOARD_PRESETS: readonly DashboardPresetDefinition[];
export const DASHBOARD_PRESET_IDS: readonly DashboardPresetId[];
export const DASHBOARD_PRESET_BY_ID: Readonly<Record<DashboardPresetId, DashboardPresetDefinition>>;

export class DashboardValidationError extends Error {
  status: number;
  code: string;
  constructor(message: string, status?: number, code?: string);
}

export function isDashboardWidgetType(value: unknown): value is DashboardWidgetType;
export function isDashboardWidth(value: unknown): value is DashboardWidgetWidth;
export function isDashboardHeight(value: unknown): value is DashboardWidgetHeight;
export function isDashboardPresetId(value: unknown): value is DashboardPresetId;
export function clampWidgetWidth(type: DashboardWidgetType, requestedWidth?: unknown): DashboardWidgetWidth;
export function normalizeWidgetConfig(
  type: DashboardWidgetType,
  rawConfig?: unknown,
  options?: { strict?: boolean },
): Record<string, unknown>;
export function generateWidgetId(type?: string): string;
export function buildPresetWidgets(
  presetId?: DashboardPresetId,
  options?: { freshIds?: boolean; now?: string },
): DashboardWidgetInstance[];
export function createDefaultDashboardLayout(now?: string): DashboardLayoutSnapshot;
export function createWidgetFromLibrary(
  type: DashboardWidgetType,
  existingWidgets?: DashboardWidgetInstance[],
  overrides?: Partial<DashboardWidgetInstance>,
): DashboardWidgetInstance;
export function reindexWidgets(widgets: DashboardWidgetInstance[]): DashboardWidgetInstance[];
export function reorderWidgets(widgets: DashboardWidgetInstance[], fromIndex: number, toIndex: number): DashboardWidgetInstance[];
export function moveWidgetById(widgets: DashboardWidgetInstance[], id: string, targetId: string): DashboardWidgetInstance[];
export function stepWidgetOrder(widgets: DashboardWidgetInstance[], id: string, delta: number): DashboardWidgetInstance[];
export function duplicateWidgetInstance(widgets: DashboardWidgetInstance[], id: string, customNewId?: string): DashboardWidgetInstance[];
export function removeWidgetInstance(widgets: DashboardWidgetInstance[], id: string): DashboardWidgetInstance[];
export function updateWidgetInstance(
  widgets: DashboardWidgetInstance[],
  id: string,
  patch: Partial<Pick<DashboardWidgetInstance, "title" | "width" | "height" | "config" | "visible" | "collapsed">>,
): DashboardWidgetInstance[];
export function validateDashboardSavePayload(
  body: unknown,
  options?: { strict?: boolean },
): {
  activePreset: DashboardPresetId | "custom";
  expectedRevision: number | null;
  widgets: DashboardWidgetInstance[];
};
