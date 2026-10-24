// Persora Table — import analysis and export mapping (library-free, pure).
//
// The browser wrapper (src/lib/table/table-files.ts) lazy-loads papaparse,
// read-excel-file and write-excel-file and feeds/consumes the plain data
// structures built here, so the rules below are unit-tested in Node.
//
// Import never creates a partial table: anything over the limits is refused
// with a clear reason before a single row is saved, and the whole table is
// created in one database transaction. Values that start with "=" are
// imported as text unless the member chooses to import formulas (spreadsheets).

import { isFormulaError } from "./table-formula.js";
import {
  TABLE_LIMITS, TableValidationError, cleanText, coerceFieldInput, emptySheetData, isIsoDate, isValidUrl, newField, newView, parseCellInput,
  parseNumberText, sanitizeStyle, textOfValue, toIsoDate, uniqueSheetName, NUMERIC_TYPES,
} from "./table-rules.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Converts a raw imported value (CSV string, or XLSX string/number/boolean/Date) into a plain string/number/boolean/null. */
export function normalizeImportedValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  const text = cleanText(value, TABLE_LIMITS.cellText);
  return text.trim() === "" ? null : text;
}

export const CSV_DELIMITERS = Object.freeze([
  { id: "auto", label: "Detect automatically", value: "" }, { id: "comma", label: "Comma ( , )", value: "," },
  { id: "semicolon", label: "Semicolon ( ; )", value: ";" }, { id: "tab", label: "Tab", value: "\t" }, { id: "pipe", label: "Pipe ( | )", value: "|" },
]);

/**
 * Parses CSV text with papaparse (passed in, so the browser can lazy-load it).
 * The delimiter is detected on a sample with blank lines skipped (blank lines
 * confuse detection), then the whole file is parsed with it so blank rows are
 * still counted in the import report. Quoted values, embedded newlines, a UTF-8
 * BOM and Unicode are handled by the parser.
 * @returns {{rows: string[][], delimiter: string, errors: Array<{row: number, message: string}>}}
 */
export function parseCsvText(Papa, text, delimiter = "") {
  const source = String(text ?? "").replace(/^\uFEFF/u, "");
  let chosen = delimiter;
  if (!chosen) {
    const sample = Papa.parse(source.slice(0, 64 * 1024), { skipEmptyLines: "greedy", preview: 50 });
    chosen = sample.meta.delimiter || ",";
  }
  const result = Papa.parse(source, { delimiter: chosen, skipEmptyLines: false });
  const rows = result.data;
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop(); // trailing newline
  const errors = result.errors.slice(0, 20).map((error) => ({ row: typeof error.row === "number" ? error.row + 1 : 0, message: error.message }));
  return { rows, delimiter: chosen, errors };
}

/** Trims fully empty trailing rows/columns and reports what an import contains. */
export function inspectMatrix(rows) {
  const matrix = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row.map(normalizeImportedValue) : []));
  let width = 0;
  for (const row of matrix) for (let c = row.length - 1; c >= 0; c -= 1) if (row[c] !== null) { width = Math.max(width, c + 1); break; }
  let height = matrix.length;
  while (height > 0 && matrix[height - 1].every((value) => value === null)) height -= 1;
  const trimmed = matrix.slice(0, height).map((row) => Array.from({ length: width }, (_, c) => row[c] ?? null));
  return { rows: trimmed, width, height };
}

/** Throws (refusing the whole import) when a matrix is over the limits. */
export function assertImportFits(height, width, what = "This file") {
  if (!height || !width) throw new TableValidationError(`${what} has no data to import.`);
  if (height > TABLE_LIMITS.importRows) throw new TableValidationError(`${what} has ${height.toLocaleString("en")} rows; the limit is ${TABLE_LIMITS.importRows.toLocaleString("en")}. Nothing was imported — split the file and try again.`);
  if (width > TABLE_LIMITS.importCols) throw new TableValidationError(`${what} has ${width} columns; the limit is ${TABLE_LIMITS.importCols}. Nothing was imported.`);
}

function headerNames(row, width) {
  const used = new Set();
  return Array.from({ length: width }, (_, c) => {
    let base = cleanText(row?.[c] ?? "", TABLE_LIMITS.fieldNameLength).replace(/\s+/gu, " ").trim() || `Column ${c + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, TABLE_LIMITS.fieldNameLength - 4)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * Picks a field type only when every non-empty value fits it, so detection never
 * loses data; anything mixed stays Text (members can change the type later).
 */
export function detectFieldType(values) {
  const filled = values.filter((value) => value !== null && value !== "");
  if (!filled.length) return { type: "text" };
  const strings = filled.map((value) => String(value).trim());
  if (filled.every((value) => typeof value === "boolean") || strings.every((text) => /^(true|false|yes|no)$/iu.test(text))) return { type: "checkbox" };
  if (filled.every((value) => typeof value === "number" || parseNumberText(value) !== null)) return { type: "number", decimals: strings.some((text) => text.includes(".")) ? 2 : 0 };
  if (strings.every((text) => /^[+-]?[\d.,]+\s?%$/u.test(text) && parseNumberText(text.replace(/\s?%$/u, "")) !== null)) return { type: "percent" };
  const symbol = /^-?([৳$€£₹])\s?[\d.,]+$/u;
  if (strings.every((text) => symbol.test(text) && parseNumberText(text.replace(/[৳$€£₹\s]/gu, "")) !== null)) {
    const currency = { "৳": "BDT", $: "USD", "€": "EUR", "£": "GBP", "₹": "INR" }[symbol.exec(strings[0])[1]];
    return { type: "currency", currency };
  }
  if (strings.every((text) => toIsoDate(text) !== null)) return { type: "date" };
  if (strings.every((text) => EMAIL_RE.test(text))) return { type: "email" };
  if (strings.every((text) => /^https?:\/\//iu.test(text) && isValidUrl(text))) return { type: "url" };
  const distinct = new Set(strings.map((text) => text.toLowerCase()));
  if (filled.length >= 4 && distinct.size <= 12 && distinct.size <= filled.length / 2 && strings.every((text) => text.length <= TABLE_LIMITS.choiceLength && !/[,;]/u.test(text))) return { type: "select" };
  return { type: "text" };
}

/**
 * Builds a Smart Table from an imported matrix.
 * @returns {{meta: object, records: object[], report: {rows: number, columns: number, emptyRowsSkipped: number, types: Array<{name: string, type: string}>, kept: Array<{row: number, field: string, value: string}>}}}
 */
export function buildSmartImport(matrixRows, { headerRow = true } = {}) {
  const { rows, width, height } = inspectMatrix(matrixRows);
  const dataRows = headerRow ? rows.slice(1) : rows;
  assertImportFits(dataRows.length, width, "This file");
  if (width > TABLE_LIMITS.fields) throw new TableValidationError(`This file has ${width} columns; a Smart Table can have at most ${TABLE_LIMITS.fields} fields. Nothing was imported — import it as a spreadsheet instead.`);
  const names = headerNames(headerRow ? rows[0] : [], width);
  const fields = names.map((name, c) => {
    const detected = detectFieldType(dataRows.map((row) => row[c]));
    const field = newField(name, detected.type, detected);
    if (detected.type === "select") field.choices = [];
    return field;
  });
  const records = [];
  const kept = [];
  let emptyRowsSkipped = 0;
  dataRows.forEach((row, index) => {
    if (row.every((value) => value === null)) { emptyRowsSkipped += 1; return; }
    const values = {};
    fields.forEach((field, c) => {
      const raw = row[c];
      if (raw === null) return;
      let input = raw;
      if (field.type === "date" && typeof raw === "number") input = String(raw);
      // XLSX numbers are already typed (a percent cell holds its fraction, e.g. 0.15).
      const result = typeof input === "number" && NUMERIC_TYPES.includes(field.type) ? { ok: true, value: input }
        : coerceFieldInput(field, typeof input === "string" ? input : String(input), { createChoices: true });
      if (result.newChoices) field.choices = [...field.choices, ...result.newChoices];
      if (!result.ok) kept.push({ row: index + (headerRow ? 2 : 1), field: field.name, value: String(raw).slice(0, 80) });
      values[field.id] = result.value;
    });
    records.push({ id: crypto.randomUUID(), position: records.length + 1, values, example: false });
  });
  if (!records.length) throw new TableValidationError("This file has no data rows to import.");
  const meta = { fields, views: [newView("table", "Grid")], charts: [], primaryField: fields[0].id };
  return { meta, records, report: { rows: records.length, columns: width, emptyRowsSkipped, types: fields.map((field) => ({ name: field.name, type: field.type })), kept } };
}

/**
 * Builds spreadsheet sheets from imported matrices ([{name, rows}]).
 * CSV strings are read like typing (numbers, percentages, dates), except that a
 * leading "=" is kept as text unless `formulas` is true. XLSX values keep their types.
 */
export function buildSheetImport(sources, { headerRow = true, formulas = false } = {}) {
  if (!sources.length) throw new TableValidationError("This file has no sheets.");
  if (sources.length > TABLE_LIMITS.sheets) throw new TableValidationError(`This file has ${sources.length} sheets; the limit is ${TABLE_LIMITS.sheets}. Nothing was imported.`);
  const names = [];
  let emptySheets = 0;
  const sheets = [];
  const report = { sheets: [], formulasAsText: 0 };
  for (const source of sources) {
    const { rows, width, height } = inspectMatrix(source.rows);
    if (!height || !width) { emptySheets += 1; continue; }
    assertImportFits(height, width, `Sheet “${source.name}”`);
    const name = uniqueSheetName(source.name || `Sheet${sheets.length + 1}`, names);
    names.push(name);
    const data = emptySheetData(Math.min(TABLE_LIMITS.rows, Math.max(height + 20, 100)), Math.min(TABLE_LIMITS.cols, Math.max(width + 2, 26)));
    let cells = 0;
    rows.forEach((row, r) => row.forEach((value, c) => {
      if (value === null) return;
      let cell;
      if (typeof value === "string") {
        if (value.startsWith("=") && !formulas) { cell = { v: value }; report.formulasAsText += 1; }
        else {
          const parsed = parseCellInput(value);
          if (parsed.empty) return;
          cell = parsed.formula ? { f: parsed.formula } : { v: parsed.value, ...(parsed.format ? { s: sanitizeStyle(parsed.format) } : {}) };
        }
      } else if (typeof value === "number" || typeof value === "boolean") cell = { v: value };
      if (typeof value === "string" && isIsoDate(value) && !cell.s) cell.s = { nf: "date" };
      if (headerRow && r === 0) cell.s = { ...(cell.s || {}), b: 1 };
      data.cells[`${r}:${c}`] = cell;
      cells += 1;
    }));
    if (cells > TABLE_LIMITS.cellsPerSheet) throw new TableValidationError(`Sheet “${source.name}” has too many filled cells. Nothing was imported.`);
    if (headerRow && height > 1) data.frozenRows = 1;
    sheets.push({ id: crypto.randomUUID(), name, position: sheets.length, data });
    report.sheets.push({ name, rows: height, columns: width });
  }
  if (!sheets.length) throw new TableValidationError("This file has no data to import.");
  return { sheets, report: { ...report, emptySheets } };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Spreadsheet → CSV rows for one sheet (displayed results, never formulas). */
export function sheetCsvRows(sheet, valueAt) {
  const { rowCount, colCount } = usedBounds(sheet.data);
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    const line = [];
    for (let c = 0; c < colCount; c += 1) {
      const value = valueAt(r, c);
      line.push(value === null || value === undefined ? "" : isFormulaError(value) ? value.error : value);
    }
    rows.push(line);
  }
  return rows;
}

/** The used area of a sheet (last row/column holding content or format). */
export function usedBounds(data) {
  let rowCount = 0;
  let colCount = 0;
  for (const key of Object.keys(data.cells)) {
    const [row, col] = key.split(":").map(Number);
    rowCount = Math.max(rowCount, row + 1);
    colCount = Math.max(colCount, col + 1);
  }
  return { rowCount, colCount };
}

const CURRENCY_FORMAT = { BDT: '"৳"', USD: '"$"', EUR: '"€"', GBP: '"£"', INR: '"₹"' };
function numberFormat(style) {
  const dp = style?.dp;
  const decimals = (count) => (count > 0 ? `.${"0".repeat(count)}` : "");
  switch (style?.nf) {
    case "number": return `#,##0${decimals(dp ?? 2)}`;
    case "currency": return `${CURRENCY_FORMAT[style.cur || "BDT"] || `"${style.cur} "`}#,##0${decimals(dp ?? 2)}`;
    case "percent": return `0${decimals(dp ?? 0)}%`;
    default: return undefined;
  }
}
function isoToDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Style → write-excel-file cell properties. */
function xlsxStyle(style) {
  if (!style) return {};
  const out = {};
  if (style.b) out.fontWeight = "bold";
  if (style.i) out.fontStyle = "italic";
  if (style.a) out.align = style.a === "l" ? "left" : style.a === "c" ? "center" : "right";
  if (style.c) out.textColor = style.c;
  if (style.bg) out.backgroundColor = style.bg;
  if (style.fs) out.fontSize = Math.round(style.fs * 0.85); // screen px → points
  if (style.bd) {
    if (style.bd.includes("t")) out.topBorderStyle = "thin";
    if (style.bd.includes("r")) out.rightBorderStyle = "thin";
    if (style.bd.includes("b")) out.bottomBorderStyle = "thin";
    if (style.bd.includes("l")) out.leftBorderStyle = "thin";
  }
  return out;
}

/**
 * Spreadsheet → write-excel-file sheets: values, formulas (as Excel formulas), number formats,
 * bold/italic/alignment/colours/borders/font size, column widths and the frozen header.
 */
export function workbookXlsxSheets(sheets) {
  return sheets.map((sheet) => {
    const { rowCount, colCount } = usedBounds(sheet.data);
    const data = [];
    for (let r = 0; r < Math.max(rowCount, 1); r += 1) {
      const line = [];
      for (let c = 0; c < Math.max(colCount, 1); c += 1) {
        const cell = sheet.data.cells[`${r}:${c}`];
        if (!cell) { line.push(null); continue; }
        const style = xlsxStyle(cell.s);
        const format = numberFormat(cell.s);
        if (typeof cell.f === "string") {
          // OOXML stores formulas without the leading "=".
          line.push({ type: "Formula", value: cell.f.replace(/^=/u, ""), ...style, ...(format ? { format } : {}) });
          continue;
        }
        const value = cell.v;
        if (value === undefined) line.push(Object.keys(style).length ? { value: "", type: String, ...style } : null);
        else if (typeof value === "number") line.push({ value, type: Number, ...style, ...(format ? { format } : {}) });
        else if (typeof value === "boolean") line.push({ value, type: Boolean, ...style });
        else if (cell.s?.nf === "date" && isIsoDate(value)) line.push({ value: isoToDate(value), type: Date, format: "yyyy-mm-dd", ...style });
        else line.push({ value: String(value), type: String, ...style });
      }
      data.push(line);
    }
    const columns = Array.from({ length: Math.max(colCount, 1) }, (_, c) => ({ width: Math.max(6, Math.round((sheet.data.colWidths[c] || 110) / 7)) }));
    return { sheet: sheet.name, data, columns, ...(sheet.data.frozenRows ? { stickyRowsCount: sheet.data.frozenRows } : {}) };
  });
}

/** Smart Table → rows of plain text/number values for CSV (header row first). */
export function smartCsvRows(fields, records) {
  const rows = [fields.map((field) => field.name)];
  for (const record of records) {
    rows.push(fields.map((field) => {
      const value = record.values?.[field.id];
      if (NUMERIC_TYPES.includes(field.type) && typeof value === "number") return value;
      return textOfValue(field, value);
    }));
  }
  return rows;
}

/** Smart Table → one write-excel-file sheet with typed cells and formats. */
export function smartXlsxSheet(name, fields, records) {
  const header = fields.map((field) => ({ value: field.name, type: String, fontWeight: "bold", backgroundColor: "#F2F4F7", bottomBorderStyle: "thin" }));
  const data = [header];
  for (const record of records) {
    data.push(fields.map((field) => {
      const value = record.values?.[field.id];
      if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
      if (NUMERIC_TYPES.includes(field.type) && typeof value === "number") {
        const format = field.type === "currency" ? numberFormat({ nf: "currency", cur: field.currency, dp: field.decimals }) : field.type === "percent" ? numberFormat({ nf: "percent", dp: field.decimals }) : numberFormat({ nf: "number", dp: field.decimals });
        return { value, type: Number, format };
      }
      if (field.type === "date" && isIsoDate(value)) return { value: isoToDate(value), type: Date, format: "yyyy-mm-dd" };
      if (field.type === "checkbox" && typeof value === "boolean") return { value, type: Boolean };
      return { value: textOfValue(field, value), type: String };
    }));
  }
  const columns = fields.map((field) => ({ width: Math.max(8, Math.round((field.width || 180) / 7)) }));
  return { sheet: cleanText(name, 31).replace(/[:\\/?*[\]]/gu, " ").trim() || "Table", data, columns, stickyRowsCount: 1 };
}

/** Plain-language notes shown before exporting (what each format keeps or loses). */
export function exportNotes(kind, format, { sheets = 1, attachments = false } = {}) {
  const notes = [];
  if (format === "csv") {
    notes.push("CSV keeps values only — no formatting, formulas or column widths.");
    if (kind === "spreadsheet") notes.push("Formulas are saved as their current results.");
    if (kind === "spreadsheet" && sheets > 1) notes.push("CSV holds one sheet: only the current sheet is exported.");
    notes.push("Text that starts with = + - or @ is prefixed with an apostrophe so other apps don't run it as a formula.");
  } else {
    if (kind === "spreadsheet") notes.push("Keeps sheets, values, formulas, number formats, basic formatting, column widths and the frozen header row.", "Row heights aren't exported. Excel recalculates formulas when the file opens.");
    else notes.push("Keeps field names, values, number/date formats and column widths. Select options are exported as their labels.");
  }
  if (kind === "smart") notes.push("Views, filters and summaries aren't part of the export.");
  if (attachments) notes.push("Attachments are exported as file names only — the files themselves stay in Persora.");
  return notes;
}
