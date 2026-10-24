export type FormulaErrorCode = "#ERROR!" | "#DIV/0!" | "#REF!" | "#NAME?" | "#VALUE!" | "#CYCLE!";
export interface FormulaErrorValue { error: FormulaErrorCode; message: string }
export type CellScalar = number | string | boolean | null;
export type CellResult = CellScalar | FormulaErrorValue;

export const SUPPORTED_FUNCTIONS: readonly string[];
export const FORMULA_ERRORS: Readonly<{ PARSE: "#ERROR!"; DIV0: "#DIV/0!"; REF: "#REF!"; NAME: "#NAME?"; VALUE: "#VALUE!"; CYCLE: "#CYCLE!" }>;
export const FORMULA_LIMITS: Readonly<{ length: number; depth: number; args: number; rangeCells: number; maxCol: number; maxRow: number }>;

export function formulaError(code: FormulaErrorCode, message?: string): FormulaErrorValue;
export function isFormulaError(value: unknown): value is FormulaErrorValue;
export function columnName(index: number): string;
export function columnIndex(name: string): number;
export function parseAddress(text: string): { row: number; col: number } | null;
export function addressName(row: number, col: number): string;
export function cellKey(row: number, col: number): string;
export function quoteSheetName(name: string): string;

export interface FormulaToken { type: string; start: number; end: number; value?: unknown; text?: string; sheet?: string | null; a?: string; b?: string | null }
export function tokenize(body: string): FormulaToken[];
export type FormulaAst = Record<string, unknown> & { type: string };
export function parseFormula(source: string): FormulaAst;
export function checkFormula(source: string): { ok: true; ast: FormulaAst } | { ok: false; error: FormulaErrorValue };
export function formulaDependencies(ast: FormulaAst): Array<{ sheet: string | null; r1: number; c1: number; r2: number; c2: number }>;
export function evaluate(ast: FormulaAst, env: {
  read(sheet: string | null, row: number, col: number): CellResult;
  sheetExists(sheet: string | null): boolean;
  bounds?(sheet: string | null): { rows: number; cols: number };
}): CellResult;

export function translateFormula(formula: string, dRow: number, dCol: number): string;
export function shiftFormula(formula: string, change: { axis: "row" | "col"; index: number; count: number; changedSheet: string; formulaSheet: string }): string;
export function renameSheetInFormula(formula: string, oldName: string, newName: string): string;
export function removeSheetFromFormula(formula: string, name: string): string;

export interface CalculatorSource {
  sheets(): Array<{ id: string; name: string; rows: number; cols: number }>;
  cell(sheetId: string, row: number, col: number): { f?: string; v?: unknown } | undefined;
  formulaCells(sheetId: string): Iterable<[number, number, string]>;
}
export class WorkbookCalculator {
  constructor(source: CalculatorSource);
  rebuild(): void;
  refreshSheets(): void;
  key(sheetId: string, row: number, col: number): string;
  update(sheetId: string, cells: Array<[number, number]>): Set<string>;
  value(sheetId: string, row: number, col: number): CellResult;
  directDependents(sheetId: string, row: number, col: number): Set<string>;
}
