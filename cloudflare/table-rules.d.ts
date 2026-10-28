import type { CellResult } from "./table-formula.js";

export type TableKind = "spreadsheet" | "smart";
export type NumberFormat = "general" | "number" | "currency" | "percent" | "date" | "text";
export type FontFamilyId = "sans" | "serif" | "mono" | "humanist" | "rounded";
export type VerticalAlign = "t" | "m" | "b";
export type WrapMode = "overflow" | "wrap" | "clip";
export type BorderLineStyle = "thin" | "medium" | "thick" | "dashed" | "dotted" | "double";
export type BorderMode = "none" | "all" | "inner" | "horiz" | "vert" | "outer" | "top" | "bottom" | "left" | "right";
export interface MergeRect { r1: number; c1: number; r2: number; c2: number }
export type SheetChartType = "bar" | "line" | "pie" | "doughnut";
export interface SheetComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}
export interface SheetChart {
  id: string;
  type: SheetChartType;
  title: string;
  range: MergeRect;
  hasHeaders: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CellStyle {
  b?: 1; i?: 1; u?: 1; st?: 1;
  ff?: FontFamilyId;
  a?: "l" | "c" | "r";
  va?: "t" | "b";
  w?: "wrap" | "clip";
  c?: string; bg?: string; fs?: number;
  bd?: string; bs?: BorderLineStyle; bc?: string;
  nf?: NumberFormat; dp?: number; cur?: string;
}
export interface SheetCell { v?: string | number | boolean; f?: string; s?: CellStyle }
export interface SheetData {
  rowCount: number; colCount: number; cells: Record<string, SheetCell>;
  colWidths: Record<number, number>; rowHeights: Record<number, number>;
  frozenRows: number; frozenCols?: number; merges?: MergeRect[];
  comments?: Record<string, SheetComment>;
  charts?: SheetChart[];
  hideGridlines?: boolean;
}
export interface Sheet { id: string; name: string; position: number; data: SheetData }
export interface Workbook { sheets: Sheet[] }

export type FieldType = "text" | "number" | "currency" | "percent" | "date" | "checkbox" | "select" | "multiselect" | "status" | "url" | "email" | "person" | "attachment";
export type ChoiceColor = "gray" | "blue" | "green" | "yellow" | "orange" | "red" | "violet" | "teal";
export interface Choice { id: string; label: string; color: ChoiceColor | string }
export interface Field { id: string; name: string; type: FieldType; width: number; choices?: Choice[]; currency?: string; decimals?: number }
export interface AttachmentRef { id: string; name: string; size: number; type: string }
export interface PersonRef { id: string; name: string }
export type FieldValue = string | number | boolean | string[] | AttachmentRef[] | PersonRef | null;
export interface TableRecord { id: string; position: number; values: Record<string, FieldValue>; example?: boolean }
export type ViewType = "table" | "board" | "calendar" | "gallery";
export type FilterOperator = "contains" | "not_contains" | "is" | "is_not" | "empty" | "not_empty" | "gt" | "gte" | "lt" | "lte" | "before" | "after" | "checked" | "unchecked" | "has_any";
export interface ViewFilter { fieldId: string; op: FilterOperator; value: string | number | boolean | string[] }
export interface ViewSort { fieldId: string; dir: "asc" | "desc" }
export interface TableView { id: string; name: string; type: ViewType; filters: ViewFilter[]; sort: ViewSort[]; hidden: string[]; groupBy: string | null; dateField: string | null; coverField: string | null }
export type ChartType = "bar" | "line" | "donut";
export interface ChartConfig { id: string; type: ChartType; groupField: string; valueField: string | null; aggregate: "count" | "sum" | "average" }
export interface SmartMeta { fields: Field[]; views: TableView[]; charts: ChartConfig[]; primaryField: string }

export const TABLE_KINDS: readonly TableKind[];
export const TABLE_CURRENCIES: readonly string[];
export const TABLE_LIMITS: Readonly<{
  tables: number; nameLength: number; labelLength: number; sheets: number; sheetNameLength: number; rows: number; cols: number; cellsPerSheet: number; cellText: number;
  commentsPerSheet: number; commentText: number; chartsPerSheet: number;
  fields: number; fieldNameLength: number; choices: number; choiceLength: number; records: number; recordBytes: number; views: number; viewFilters: number;
  attachmentsPerCell: number; attachmentsPerTable: number; saveBytes: number; tableBytes: number; importBytes: number; importRows: number; importCols: number;
}>;
export class TableValidationError extends Error { field: string | null; status: number; constructor(message: string, field?: string | null) }
export function isUuid(value: unknown): value is string;
export function isLocalId(value: unknown): value is string;
export function newLocalId(prefix?: string): string;
export function cleanText(value: unknown, max: number): string;
export function cleanName(value: unknown, max: number, what?: string): string;
export function isIsoDate(value: unknown): value is string;

export const TEXT_COLORS: ReadonlyArray<{ id: string; label: string; hex: string }>;
export const FILL_COLORS: ReadonlyArray<{ id: string; label: string; hex: string }>;
export const BORDER_COLORS: ReadonlyArray<{ id: string; label: string; hex: string }>;
export const FONT_FAMILIES: ReadonlyArray<{ id: FontFamilyId; label: string; stack: string }>;
export const CHOICE_COLORS: readonly ChoiceColor[];
export const FONT_SIZES: readonly number[];
export const DEFAULT_FONT_SIZE: number;
export const NUMBER_FORMATS: readonly NumberFormat[];
export const BORDER_STYLES: readonly BorderMode[];
export const BORDER_LINE_STYLES: readonly BorderLineStyle[];
export const DEFAULT_BORDER_COLOR: string;
export function fontStackOf(id?: string | null): string;
export function normalizeBorderEdges(value: unknown): string;
export function sanitizeStyle(style: unknown): CellStyle | undefined;

export function parseNumberText(text: unknown): number | null;
export function parseCellInput(input: unknown): { empty: true } | { formula: string } | { value: string | number | boolean; format?: { nf: NumberFormat; cur?: string; dp?: number } };
export function cellEditText(cell: SheetCell | undefined | null): string;
export function formatCurrency(value: number, currency?: string, decimals?: number, locale?: string): string;
export function formatDate(iso: string, locale?: string): string;
export function formatGeneralNumber(value: number): string;
export function formatCellValue(value: CellResult | undefined, style?: CellStyle, locale?: string): string;

export const DEFAULT_SHEET_SIZE: Readonly<{ rows: number; cols: number }>;
export const COLUMN_WIDTH: Readonly<{ min: number; max: number; default: number }>;
export const ROW_HEIGHT: Readonly<{ min: number; max: number; default: number }>;
export const MAX_MERGES_PER_SHEET: number;
export const SHEET_CHART_TYPES: readonly SheetChartType[];
export function emptySheetData(rows?: number, cols?: number): SheetData;
export function normalizeMerges(rawMerges: unknown, rowCount: number, colCount: number): MergeRect[];
export function normalizeSheetComments(rawComments: unknown, rowCount: number, colCount: number): Record<string, SheetComment>;
export function normalizeSheetCharts(rawCharts: unknown, rowCount: number, colCount: number): SheetChart[];
export function validateSheetName(name: unknown, others?: string[]): string;
export function uniqueSheetName(base: string, existing: string[]): string;
export function normalizeSheetData(data: unknown): SheetData;

export const FIELD_TYPES: ReadonlyArray<{ id: FieldType; label: string }>;
export const CHOICE_TYPES: readonly FieldType[];
export const NUMERIC_TYPES: readonly FieldType[];
export const DEFAULT_STATUS_CHOICES: ReadonlyArray<{ label: string; color: string }>;
export function fieldTypeLabel(type: string): string;
export function makeChoices(list: Array<{ label: string; color?: string }>): Choice[];
export function newField(name: string, type?: FieldType, options?: { choices?: Choice[]; currency?: string; decimals?: number }): Field;
export function normalizeFields(fields: unknown): Field[];
export function isValidUrl(value: unknown): boolean;
export function isEmptyValue(value: unknown): boolean;
export function validateFieldValue(field: Field, value: unknown): { valid: boolean; message?: string };
export function coerceFieldInput(field: Field, input: unknown, options?: { createChoices?: boolean }): { ok: boolean; value: FieldValue; message?: string; newChoices?: Choice[] };
export function toIsoDate(text: unknown): string | null;
export function textOfValue(field: Field, value: unknown, locale?: string): string;
export function displayValue(field: Field, value: unknown, locale?: string): string;
export function planRetype(field: Field, toType: FieldType, records: TableRecord[]): { allowed: boolean; reason?: string; field: Field; converted: number; kept: number; examples: string[]; values: Map<string, FieldValue> };

export const VIEW_TYPES: ReadonlyArray<{ id: ViewType; label: string }>;
export const FILTER_OPERATORS: Readonly<Record<FilterOperator, string>>;
export function operatorsFor(type: FieldType): FilterOperator[];
export function newView(type?: ViewType, name?: string): TableView;
export function normalizeViews(views: unknown, fields: Field[]): TableView[];
export function applyView(fields: Field[], records: TableRecord[], view: TableView | null | undefined, search?: string): TableRecord[];
export function groupForBoard(field: Field, records: TableRecord[]): Array<{ id: string; label: string; color: string; records: TableRecord[] }>;
export function viewSetupProblem(view: TableView, fields: Field[]): string | null;

export interface FieldSummary { count: number; filled: number; empty: number; numbers?: number; sum?: number; average?: number | null; min?: number | null; max?: number | null; checked?: number; distribution?: Array<{ id: string; label: string; color: string; count: number }> }
export function fieldSummary(field: Field, records: TableRecord[]): FieldSummary;
export function valuesSummary(values: CellResult[]): { count: number; numbers: number; sum: number; average: number | null; min: number | null; max: number | null };
export const CHART_TYPES: readonly ChartType[];
export function chartData(fields: Field[], records: TableRecord[], options: { groupField: string; valueField?: string | null; aggregate?: "count" | "sum" | "average"; limit?: number }): { points: Array<{ key: string; label: string; value: number; color?: string }>; skipped: number };

export function normalizeSmartMeta(meta: unknown): SmartMeta;
export function normalizeRecordValues(values: unknown, fieldIds: Set<string>): Record<string, FieldValue>;
export function attachmentIdsIn(meta: SmartMeta | null | undefined, records: TableRecord[]): Set<string>;
export interface NormalizedBatch {
  baseRevision: number; batchId: string; meta: SmartMeta | null;
  sheetUpserts: Sheet[]; sheetDeletes: string[];
  recordUpserts: Array<{ id: string; position: number; values: Record<string, FieldValue>; example: boolean }>; recordDeletes: string[];
  valuesPending?: boolean;
}
export function normalizeSaveBatch(kind: TableKind, batch: unknown): NormalizedBatch;
export function finalizeRecordValues(batch: NormalizedBatch, fields: Field[]): NormalizedBatch;
export function estimateBytes(value: unknown): number;
