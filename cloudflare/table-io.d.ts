import type { CellResult } from "./table-formula.js";
import type { Field, FieldType, Sheet, SmartMeta, TableKind, TableRecord } from "./table-rules.js";

export const CSV_DELIMITERS: ReadonlyArray<{ id: string; label: string; value: string }>;
export interface PapaLike { parse(input: string, config: Record<string, unknown>): { data: string[][]; errors: Array<{ row?: number; message: string }>; meta: { delimiter: string } } }
export function parseCsvText(Papa: PapaLike, text: string, delimiter?: string): { rows: string[][]; delimiter: string; errors: Array<{ row: number; message: string }> };
export type ImportedValue = string | number | boolean | Date | null | undefined;
export function normalizeImportedValue(value: ImportedValue): string | number | boolean | null;
export function inspectMatrix(rows: ImportedValue[][]): { rows: Array<Array<string | number | boolean | null>>; width: number; height: number };
export function assertImportFits(height: number, width: number, what?: string): void;
export function detectFieldType(values: Array<string | number | boolean | null>): { type: FieldType; decimals?: number; currency?: string };
export interface SmartImportReport { rows: number; columns: number; emptyRowsSkipped: number; types: Array<{ name: string; type: FieldType }>; kept: Array<{ row: number; field: string; value: string }> }
export function buildSmartImport(rows: ImportedValue[][], options?: { headerRow?: boolean }): { meta: SmartMeta; records: TableRecord[]; report: SmartImportReport };
export interface SheetImportReport { sheets: Array<{ name: string; rows: number; columns: number }>; formulasAsText: number; emptySheets: number }
export function buildSheetImport(sources: Array<{ name: string; rows: ImportedValue[][] }>, options?: { headerRow?: boolean; formulas?: boolean }): { sheets: Sheet[]; report: SheetImportReport };
export function sheetCsvRows(sheet: Sheet, valueAt: (row: number, col: number) => CellResult): Array<Array<string | number | boolean>>;
export function usedBounds(data: Sheet["data"]): { rowCount: number; colCount: number };
// write-excel-file sheet objects (typed loosely here; the library validates them).
export interface XlsxSheet { sheet: string; data: unknown[][]; columns: Array<{ width: number }>; stickyRowsCount?: number }
export function workbookXlsxSheets(sheets: Sheet[]): XlsxSheet[];
export function smartCsvRows(fields: Field[], records: TableRecord[]): Array<Array<string | number>>;
export function smartXlsxSheet(name: string, fields: Field[], records: TableRecord[]): XlsxSheet;
export function exportNotes(kind: TableKind, format: "csv" | "xlsx", options?: { sheets?: number; attachments?: boolean }): string[];
