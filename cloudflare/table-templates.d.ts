import type { Sheet, SmartMeta, TableKind, TableRecord } from "./table-rules.js";

export interface TemplateInfo { id: string; name: string; kind: TableKind; description: string }
export type TableContent = { kind: "smart"; meta: SmartMeta; records: TableRecord[] } | { kind: "spreadsheet"; sheets: Sheet[] };
export const TABLE_TEMPLATES: readonly TemplateInfo[];
export function buildTemplate(id: string, today: string): TableContent | null;
export function blankSmartTable(): Extract<TableContent, { kind: "smart" }>;
export function blankSpreadsheet(): Extract<TableContent, { kind: "spreadsheet" }>;
