import type { CellResult } from "./table-formula.js";
import type { CellStyle, SheetCell, SheetData, Workbook } from "./table-rules.js";

export interface Rect { r1: number; c1: number; r2: number; c2: number }
export interface CopiedBlock { rows: number; cols: number; origin: { row: number; col: number }; cells: Array<Array<SheetCell | null>>; mode?: "all" | "values"; values?: CellResult[][] }

export function keyOf(row: number, col: number): string;
export function splitKey(key: string): [number, number];
export function normalizeRect(rect: Rect): Rect;
export function setCells(data: SheetData, entries: Array<[number, number, SheetCell | null]>): SheetData;
export function cellFromInput(text: string, existing?: SheetCell | null): SheetCell | null;
export function clearRange(data: SheetData, rect: Rect, mode?: "all" | "contents" | "formats"): SheetData;
export function applyStyle(data: SheetData, rect: Rect, patch: Partial<Record<keyof CellStyle, unknown>> | null, border?: "all" | "outer" | "bottom" | "none"): SheetData;
export function extractRange(data: SheetData, rect: Rect): CopiedBlock;
export function toTsv(lines: unknown[][]): string;
export function parseClipboardText(text: string): string[][];
export function ensureSize(data: SheetData, rows: number, cols: number): SheetData;
export function pasteBlock(data: SheetData, at: { row: number; col: number }, block: CopiedBlock | { text: string[][] }): SheetData;
export function fillRange(data: SheetData, source: Rect, target: Rect): SheetData;
export function insertRows(workbook: Workbook, sheetId: string, index: number, count?: number): Workbook;
export function deleteRows(workbook: Workbook, sheetId: string, index: number, count?: number): Workbook;
export function insertColumns(workbook: Workbook, sheetId: string, index: number, count?: number): Workbook;
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
