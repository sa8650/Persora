import type { CellResult } from "./table-formula.js";
import type { BorderLineStyle, BorderMode, CellStyle, MergeRect, SheetCell, SheetChart, SheetChartType, SheetData, Workbook } from "./table-rules.js";

export interface Rect { r1: number; c1: number; r2: number; c2: number }
export interface CopiedBlock { rows: number; cols: number; origin: { row: number; col: number }; cells: Array<Array<SheetCell | null>>; mode?: "all" | "values"; values?: CellResult[][] }
export interface BorderApplyOptions { style?: BorderLineStyle; color?: string | null }

export function keyOf(row: number, col: number): string;
export function splitKey(key: string): [number, number];
export function normalizeRect(rect: Rect): Rect;
export function rectsOverlap(a: Rect, b: Rect): boolean;
export function mergeAt(data: SheetData, row: number, col: number): MergeRect | null;
export function mergesInRect(data: SheetData, rect: Rect): MergeRect[];
export function expandRectToMerges(data: SheetData, rect: Rect): Rect;
export function mergeCells(data: SheetData, rect: Rect, mode?: "all" | "horizontal" | "vertical"): SheetData;
export function unmergeCells(data: SheetData, rect: Rect): SheetData;
export function setCells(data: SheetData, entries: Array<[number, number, SheetCell | null]>): SheetData;
export function cellFromInput(text: string, existing?: SheetCell | null): SheetCell | null;
export function clearRange(data: SheetData, rect: Rect, mode?: "all" | "contents" | "formats"): SheetData;
export function clearRanges(data: SheetData, ranges: Rect[], mode?: "all" | "contents" | "formats"): SheetData;
export function applyStyle(data: SheetData, rect: Rect, patch: Partial<Record<keyof CellStyle, unknown>> | null, border?: BorderMode, borderOpts?: BorderApplyOptions): SheetData;
export function applyStyleToRanges(data: SheetData, ranges: Rect[], patch: Partial<Record<keyof CellStyle, unknown>> | null, border?: BorderMode, borderOpts?: BorderApplyOptions): SheetData;
export function extractRange(data: SheetData, rect: Rect): CopiedBlock;
export function toTsv(lines: unknown[][]): string;
export function parseClipboardText(text: string): string[][];
export function ensureSize(data: SheetData, rows: number, cols: number): SheetData;
export function pasteBlock(data: SheetData, at: { row: number; col: number }, block: CopiedBlock | { text: string[][] }): SheetData;
export function fillRange(data: SheetData, source: Rect, target: Rect): SheetData;
export function insertRows(workbook: Workbook, sheetId: string, index: number, count?: number): Workbook;
export function deleteRows(workbook: Workbook, sheetId: string, index: number, count?: number): Workbook;
export function insertColumns(workbook: Workbook, sheetId: string, index, count?: number): Workbook;
export function deleteColumns(workbook: Workbook, sheetId: string, index: number, count?: number): Workbook;
export function moveRows(data: SheetData, from: number, count: number, to: number): SheetData;
export function moveColumns(data: SheetData, from: number, count: number, to: number): SheetData;
export function sortRows(data: SheetData, range: { r1: number; r2: number }, col: number, dir: "asc" | "desc", valueAt: (row: number, col: number) => CellResult): SheetData;
export function resizeColumn(data: SheetData, col: number, width: number): SheetData;
export function resizeRow(data: SheetData, row: number, height: number): SheetData;
export function addSheet(workbook: Workbook, name: string | null, id: string): Workbook;
export function renameSheet(workbook: Workbook, sheetId: string, name: string): Workbook;
export function deleteSheet(workbook: Workbook, sheetId: string): Workbook;
export function duplicateSheet(workbook: Workbook, sheetId: string, newId: string): Workbook;
export function moveSheet(workbook: Workbook, sheetId: string, toIndex: number): Workbook;
export function formulaCellsOf(data: SheetData): Iterable<[number, number, string]>;

export function formatRangeName(rect: Rect): string;
export function parseRangeText(text: string, maxRows?: number, maxCols?: number): Rect | null;
export function extendSheetDimensions(data: SheetData, addRows?: number, addCols?: number): SheetData;
export function setGridlinesHidden(data: SheetData, hidden: boolean): SheetData;
export function setCellComment(data: SheetData, row: number, col: number, input: { text: string; author?: string; now?: string }): SheetData;
export function deleteCellComment(data: SheetData, row: number, col: number): SheetData;
export function detectRangeHeaders(data: SheetData, rect: Rect, valueAt?: (row: number, col: number) => CellResult): boolean;
export function addSheetChart(
  data: SheetData,
  input: { type?: SheetChartType; title?: string; range?: Rect; hasHeaders?: boolean; x?: number; y?: number; width?: number; height?: number },
): SheetData;
export function updateSheetChart(data: SheetData, chartId: string, patch: Partial<Omit<SheetChart, "id">>): SheetData;
export function deleteSheetChart(data: SheetData, chartId: string): SheetData;
export function extractSheetChartSeries(
  data: SheetData,
  chart: SheetChart,
  valueAt?: (row: number, col: number) => CellResult,
): { categories: string[]; series: Array<{ name: string; values: number[] }> };
