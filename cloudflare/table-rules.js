// Persora Table — shared rules for the browser and the Pages API.
//
// One source of truth for limits, the stored shapes (spreadsheet sheets and
// Smart Table fields/records/views), cell input parsing and display
// formatting, field validation and safe retyping, view filtering/sorting,
// summaries and chart data, and validation of save batches. The database
// enforces the same limits again (supabase/migrations/202610300001_persora_table.sql).

import { LOAN_CURRENCIES } from "./loan-rules.js";
import { isFormulaError } from "./table-formula.js";

export const TABLE_KINDS = Object.freeze(["spreadsheet", "smart"]);
export const TABLE_CURRENCIES = LOAN_CURRENCIES;

export const TABLE_LIMITS = Object.freeze({
  tables: 300,
  nameLength: 120,
  labelLength: 40,
  sheets: 20,
  sheetNameLength: 31, // Excel's limit, so every sheet survives an XLSX round trip
  rows: 5000,
  cols: 100,
  cellsPerSheet: 200_000,
  cellText: 10_000,
  fields: 60,
  fieldNameLength: 60,
  choices: 60,
  choiceLength: 60,
  records: 5000,
  recordBytes: 64 * 1024,
  views: 20,
  viewFilters: 12,
  attachmentsPerCell: 10,
  attachmentsPerTable: 500,
  saveBytes: 6 * 1024 * 1024,
  tableBytes: 12 * 1024 * 1024,
  importBytes: 10 * 1024 * 1024,
  importRows: 5000,
  importCols: 100,
});

export class TableValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.field = field;
    this.status = 400;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_ID = /^[a-z][a-z0-9_]{1,31}$/iu;
export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}
export function isLocalId(value) {
  return typeof value === "string" && LOCAL_ID.test(value);
}
/** Short ids for fields, views and choices (stable across renames). */
export function newLocalId(prefix = "f") {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, max);
}
export function cleanName(value, max, what = "Name") {
  const name = cleanText(value, max * 2).replace(/\s+/gu, " ").trim();
  if (!name) throw new TableValidationError(`${what} can't be empty.`);
  if (name.length > max) throw new TableValidationError(`${what} can be at most ${max} characters.`);
  return name;
}
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
export function isIsoDate(value) {
  const match = ISO_DATE.exec(String(value ?? ""));
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Palette and cell styles (a restrained set; stored as hex so exports keep them)
// ---------------------------------------------------------------------------

export const TEXT_COLORS = Object.freeze([
  { id: "ink", label: "Default", hex: "#1F2937" }, { id: "gray", label: "Gray", hex: "#6B7280" }, { id: "red", label: "Red", hex: "#B42318" },
  { id: "orange", label: "Orange", hex: "#B54708" }, { id: "green", label: "Green", hex: "#067647" }, { id: "blue", label: "Blue", hex: "#175CD3" },
  { id: "violet", label: "Violet", hex: "#6941C6" },
]);
export const FILL_COLORS = Object.freeze([
  { id: "gray", label: "Gray", hex: "#F2F4F7" }, { id: "red", label: "Red", hex: "#FEE4E2" }, { id: "orange", label: "Orange", hex: "#FEF0C7" },
  { id: "yellow", label: "Yellow", hex: "#FEF7C3" }, { id: "green", label: "Green", hex: "#DCFAE6" }, { id: "blue", label: "Blue", hex: "#D1E9FF" },
  { id: "violet", label: "Violet", hex: "#EBE9FE" },
]);
export const CHOICE_COLORS = Object.freeze(["gray", "blue", "green", "yellow", "orange", "red", "violet", "teal"]);
export const FONT_SIZES = Object.freeze([10, 11, 12, 13, 14, 16, 18, 20, 24]);
export const DEFAULT_FONT_SIZE = 13;
export const NUMBER_FORMATS = Object.freeze(["general", "number", "currency", "percent", "date", "text"]);
export const BORDER_STYLES = Object.freeze(["none", "all", "outer", "bottom"]);
/** Normalizes a border edge set ("t", "r", "b", "l" in any combination) to canonical order, or "". */
export function normalizeBorderEdges(value) {
  if (typeof value !== "string" || !/^[trbl]{1,4}$/u.test(value)) return "";
  return ["t", "r", "b", "l"].filter((edge) => value.includes(edge)).join("");
}
const TEXT_HEX = new Set(TEXT_COLORS.map((color) => color.hex));
const FILL_HEX = new Set(FILL_COLORS.map((color) => color.hex));

/** Keeps only known style keys/values. Returns undefined for an empty style. */
export function sanitizeStyle(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) return undefined;
  const out = {};
  if (style.b === 1 || style.b === true) out.b = 1;
  if (style.i === 1 || style.i === true) out.i = 1;
  if (["l", "c", "r"].includes(style.a)) out.a = style.a;
  if (typeof style.c === "string" && TEXT_HEX.has(style.c.toUpperCase())) out.c = style.c.toUpperCase();
  if (typeof style.bg === "string" && FILL_HEX.has(style.bg.toUpperCase())) out.bg = style.bg.toUpperCase();
  if (FONT_SIZES.includes(style.fs) && style.fs !== DEFAULT_FONT_SIZE) out.fs = style.fs;
  const edges = normalizeBorderEdges(style.bd);
  if (edges) out.bd = edges;
  if (NUMBER_FORMATS.includes(style.nf) && style.nf !== "general") out.nf = style.nf;
  if (Number.isInteger(style.dp) && style.dp >= 0 && style.dp <= 6) out.dp = style.dp;
  if (typeof style.cur === "string" && TABLE_CURRENCIES.includes(style.cur)) out.cur = style.cur;
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Spreadsheet cells: entered value vs formula vs displayed result
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = Object.freeze({ "৳": "BDT", $: "USD", "€": "EUR", "£": "GBP", "₹": "INR" });
const NUMBER_TEXT = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$|^[+-]?\.\d+$/u;

/** Parses "1,234.5" style text to a number, or null. */
export function parseNumberText(text) {
  const trimmed = String(text ?? "").trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const number = Number(trimmed.replace(/,/gu, ""));
  return Number.isFinite(number) ? number : null;
}

/**
 * What the user typed → what is stored. A leading "=" makes a formula (kept
 * verbatim, even when invalid); a leading apostrophe forces text (so "'=x" and
 * "'007" stay text). Numbers, percentages, currency amounts, TRUE/FALSE and
 * ISO dates are recognised; `format` suggests a number format for the cell.
 * @returns {{empty: true} | {formula: string} | {value: string|number|boolean, format?: {nf: string, cur?: string, dp?: number}}}
 */
export function parseCellInput(input) {
  const text = cleanText(input, TABLE_LIMITS.cellText);
  if (text === "") return { empty: true };
  if (text.startsWith("'")) return { value: text.slice(1) };
  if (text.startsWith("=") && text.length > 1) return { formula: text };
  const trimmed = text.trim();
  if (/^(true|false)$/iu.test(trimmed)) return { value: trimmed.toLowerCase() === "true" };
  const number = parseNumberText(trimmed);
  if (number !== null) return { value: number };
  const percent = /^(.+?)\s?%$/u.exec(trimmed);
  if (percent) {
    const base = parseNumberText(percent[1]);
    if (base !== null) {
      const decimals = (percent[1].split(".")[1] || "").length;
      return { value: Number((base / 100).toPrecision(15)), format: { nf: "percent", dp: Math.min(decimals, 6) } };
    }
  }
  const money = /^([৳$€£₹])\s?(.+)$/u.exec(trimmed) || /^(-)([৳$€£₹])\s?(.+)$/u.exec(trimmed);
  if (money) {
    const negative = money.length === 4;
    const symbol = negative ? money[2] : money[1];
    const amount = parseNumberText(negative ? money[3] : money[2]);
    if (amount !== null) return { value: negative ? -amount : amount, format: { nf: "currency", cur: CURRENCY_SYMBOLS[symbol] } };
  }
  if (isIsoDate(trimmed)) return { value: trimmed, format: { nf: "date" } };
  return { value: text };
}

/** The text an editor shows for a stored cell: the formula, or the entered value (text that would be misread gets an apostrophe). */
export function cellEditText(cell) {
  if (!cell) return "";
  if (typeof cell.f === "string") return cell.f;
  if (cell.v === undefined || cell.v === null) return "";
  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  if (typeof cell.v === "number") {
    if (cell.s?.nf === "percent") return `${Number((cell.v * 100).toPrecision(15))}%`;
    return String(cell.v);
  }
  const text = String(cell.v);
  const parsed = parseCellInput(text);
  const roundTrips = !parsed.formula && !parsed.empty && parsed.value === text;
  return roundTrips ? text : `'${text}`;
}

function intlNumber(value, decimals, locale) {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}
export function formatCurrency(value, currency = "BDT", decimals = 2, locale = "en") {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  } catch {
    return `${currency} ${intlNumber(value, decimals, locale)}`;
  }
}
export function formatDate(iso, locale = "en") {
  if (!isIsoDate(iso)) return String(iso);
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
/** General number display: up to 10 significant digits, no float noise (0.1+0.2 → 0.3). */
export function formatGeneralNumber(value) {
  if (!Number.isFinite(value)) return "#VALUE!";
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const precise = Number(value.toPrecision(10));
  return Math.abs(precise) >= 1e15 || (precise !== 0 && Math.abs(precise) < 1e-9) ? precise.toExponential(4) : String(precise);
}

/** Display text for a computed cell value with its style's number format. */
export function formatCellValue(value, style, locale = "en") {
  if (value === null || value === undefined || value === "") return "";
  if (isFormulaError(value)) return value.error;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const nf = style?.nf || "general";
  if (typeof value === "number") {
    switch (nf) {
      case "number": return intlNumber(value, style?.dp ?? 2, locale);
      case "currency": return formatCurrency(value, style?.cur || "BDT", style?.dp ?? 2, locale);
      case "percent": return `${intlNumber(value * 100, style?.dp ?? 0, locale)}%`;
      default: return formatGeneralNumber(value);
    }
  }
  if (nf === "date" && isIsoDate(value)) return formatDate(value, locale);
  return String(value);
}

// ---------------------------------------------------------------------------
// Spreadsheet sheets
// ---------------------------------------------------------------------------

export const DEFAULT_SHEET_SIZE = Object.freeze({ rows: 100, cols: 26 });
export const COLUMN_WIDTH = Object.freeze({ min: 40, max: 600, default: 110 });
export const ROW_HEIGHT = Object.freeze({ min: 22, max: 200, default: 30 });

export function emptySheetData(rows = DEFAULT_SHEET_SIZE.rows, cols = DEFAULT_SHEET_SIZE.cols) {
  return { rowCount: rows, colCount: cols, cells: {}, colWidths: {}, rowHeights: {}, frozenRows: 0 };
}

/** Rejects names Excel can't store and duplicates (case-insensitive). */
export function validateSheetName(name, others = []) {
  const clean = cleanName(name, TABLE_LIMITS.sheetNameLength, "Sheet name");
  if (/[:\\/?*[\]]/u.test(clean)) throw new TableValidationError("Sheet names can't contain : \\ / ? * [ or ].");
  if (clean.startsWith("'") || clean.endsWith("'")) throw new TableValidationError("Sheet names can't start or end with an apostrophe.");
  if (others.some((other) => String(other).toLowerCase() === clean.toLowerCase())) throw new TableValidationError(`There's already a sheet named “${clean}”.`);
  return clean;
}
export function uniqueSheetName(base, existing) {
  const taken = new Set(existing.map((name) => String(name).toLowerCase()));
  const root = cleanText(base, TABLE_LIMITS.sheetNameLength).replace(/[:\\/?*[\]]/gu, " ").replace(/^'+|'+$/gu, "").trim() || "Sheet";
  if (!taken.has(root.toLowerCase())) return root;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${root.slice(0, TABLE_LIMITS.sheetNameLength - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `Sheet ${Date.now() % 100000}`;
}

function cleanCell(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const cell = {};
  if (typeof raw.f === "string" && raw.f.startsWith("=")) cell.f = cleanText(raw.f, TABLE_LIMITS.cellText);
  else if (typeof raw.f === "string" && raw.f.trim()) cell.v = cleanText(raw.f, TABLE_LIMITS.cellText); // malformed formula: kept as text, never dropped
  else if (typeof raw.v === "number" && Number.isFinite(raw.v)) cell.v = raw.v;
  else if (typeof raw.v === "boolean") cell.v = raw.v;
  else if (typeof raw.v === "string" && raw.v !== "") cell.v = cleanText(raw.v, TABLE_LIMITS.cellText);
  const style = sanitizeStyle(raw.s);
  if (style) cell.s = style;
  return Object.keys(cell).length ? cell : undefined;
}

/** Validates and normalizes stored sheet data (server and client use the same rules). */
export function normalizeSheetData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TableValidationError("The sheet data is malformed.");
  const rowCount = Number(data.rowCount);
  const colCount = Number(data.colCount);
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > TABLE_LIMITS.rows) throw new TableValidationError(`A sheet can have 1 to ${TABLE_LIMITS.rows} rows.`);
  if (!Number.isInteger(colCount) || colCount < 1 || colCount > TABLE_LIMITS.cols) throw new TableValidationError(`A sheet can have 1 to ${TABLE_LIMITS.cols} columns.`);
  const cells = {};
  let count = 0;
  for (const [key, raw] of Object.entries(data.cells && typeof data.cells === "object" ? data.cells : {})) {
    const match = /^(\d{1,5}):(\d{1,3})$/u.exec(key);
    if (!match) throw new TableValidationError("The sheet has an invalid cell address.");
    const row = Number(match[1]);
    const col = Number(match[2]);
    if (row >= rowCount || col >= colCount) throw new TableValidationError("The sheet has a cell outside its rows or columns.");
    const cell = cleanCell(raw);
    if (!cell) continue;
    count += 1;
    if (count > TABLE_LIMITS.cellsPerSheet) throw new TableValidationError(`A sheet can hold at most ${TABLE_LIMITS.cellsPerSheet.toLocaleString("en")} filled cells.`);
    cells[`${row}:${col}`] = cell;
  }
  const sizes = (source, limit, bounds) => {
    const out = {};
    for (const [key, value] of Object.entries(source && typeof source === "object" ? source : {})) {
      const index = Number(key);
      const size = Math.round(Number(value));
      if (!Number.isInteger(index) || index < 0 || index >= limit || !Number.isFinite(size)) continue;
      out[index] = Math.min(bounds.max, Math.max(bounds.min, size));
    }
    return out;
  };
  const frozenRows = Number.isInteger(data.frozenRows) ? Math.min(Math.max(data.frozenRows, 0), Math.min(10, rowCount - 1)) : 0;
  return { rowCount, colCount, cells, colWidths: sizes(data.colWidths, colCount, COLUMN_WIDTH), rowHeights: sizes(data.rowHeights, rowCount, ROW_HEIGHT), frozenRows };
}

// ---------------------------------------------------------------------------
// Smart Table fields
// ---------------------------------------------------------------------------

export const FIELD_TYPES = Object.freeze([
  { id: "text", label: "Text" }, { id: "number", label: "Number" }, { id: "currency", label: "Currency" }, { id: "percent", label: "Percent" },
  { id: "date", label: "Date" }, { id: "checkbox", label: "Checkbox" }, { id: "select", label: "Single select" }, { id: "multiselect", label: "Multiple select" },
  { id: "status", label: "Status" }, { id: "url", label: "URL" }, { id: "email", label: "Email" }, { id: "person", label: "Person" }, { id: "attachment", label: "Attachment" },
]);
const FIELD_TYPE_IDS = new Set(FIELD_TYPES.map((type) => type.id));
export const CHOICE_TYPES = Object.freeze(["select", "multiselect", "status"]);
export const NUMERIC_TYPES = Object.freeze(["number", "currency", "percent"]);
export const DEFAULT_STATUS_CHOICES = Object.freeze([
  { label: "Not started", color: "gray" }, { label: "In progress", color: "blue" }, { label: "Done", color: "green" },
]);

export function fieldTypeLabel(type) {
  return FIELD_TYPES.find((entry) => entry.id === type)?.label || type;
}

export function makeChoices(list) {
  return list.map((choice) => ({ id: newLocalId("c"), label: choice.label, color: choice.color || "gray" }));
}

/** Creates a field with sensible options for its type. */
export function newField(name, type = "text", options = {}) {
  const field = { id: newLocalId("f"), name, type, width: 180 };
  if (CHOICE_TYPES.includes(type)) field.choices = options.choices || (type === "status" ? makeChoices(DEFAULT_STATUS_CHOICES) : []);
  if (type === "currency") field.currency = options.currency || "BDT";
  if (NUMERIC_TYPES.includes(type)) field.decimals = options.decimals ?? (type === "percent" ? 0 : 2);
  return field;
}

function normalizeChoices(choices, fieldName) {
  if (!Array.isArray(choices)) return [];
  if (choices.length > TABLE_LIMITS.choices) throw new TableValidationError(`“${fieldName}” can have at most ${TABLE_LIMITS.choices} options.`);
  const ids = new Set();
  const labels = new Set();
  return choices.map((choice) => {
    if (!isLocalId(choice?.id) || ids.has(choice.id)) throw new TableValidationError(`An option of “${fieldName}” is malformed.`);
    const label = cleanName(choice.label, TABLE_LIMITS.choiceLength, "Option name");
    if (labels.has(label.toLowerCase())) throw new TableValidationError(`“${fieldName}” has the option “${label}” twice.`);
    ids.add(choice.id);
    labels.add(label.toLowerCase());
    return { id: choice.id, label, color: CHOICE_COLORS.includes(choice.color) ? choice.color : "gray" };
  });
}

export function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length < 1) throw new TableValidationError("A Smart Table needs at least one field.");
  if (fields.length > TABLE_LIMITS.fields) throw new TableValidationError(`A Smart Table can have at most ${TABLE_LIMITS.fields} fields.`);
  const ids = new Set();
  const names = new Set();
  return fields.map((raw) => {
    if (!raw || typeof raw !== "object" || !isLocalId(raw.id) || ids.has(raw.id)) throw new TableValidationError("A field is malformed.");
    if (!FIELD_TYPE_IDS.has(raw.type)) throw new TableValidationError("A field has an unknown type.");
    const name = cleanName(raw.name, TABLE_LIMITS.fieldNameLength, "Field name");
    if (names.has(name.toLowerCase())) throw new TableValidationError(`There's already a field named “${name}”.`);
    ids.add(raw.id);
    names.add(name.toLowerCase());
    const field = { id: raw.id, name, type: raw.type, width: Math.min(600, Math.max(80, Math.round(Number(raw.width) || 180))) };
    if (CHOICE_TYPES.includes(raw.type)) field.choices = normalizeChoices(raw.choices, name);
    if (raw.type === "currency") field.currency = TABLE_CURRENCIES.includes(raw.currency) ? raw.currency : "BDT";
    if (NUMERIC_TYPES.includes(raw.type)) field.decimals = Number.isInteger(raw.decimals) && raw.decimals >= 0 && raw.decimals <= 6 ? raw.decimals : raw.type === "percent" ? 0 : 2;
    return field;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
export function isValidUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
export function isEmptyValue(value) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Is a stored value valid for its field? Invalid values are kept (never
 * silently dropped) and shown with a warning until fixed.
 * @returns {{valid: boolean, message?: string}}
 */
export function validateFieldValue(field, value) {
  if (isEmptyValue(value)) return { valid: true };
  const bad = (message) => ({ valid: false, message });
  switch (field.type) {
    case "text": return typeof value === "string" ? { valid: true } : bad("Expected text.");
    case "number": case "currency": case "percent": return typeof value === "number" && Number.isFinite(value) ? { valid: true } : bad("Not a valid number.");
    case "date": return isIsoDate(value) ? { valid: true } : bad("Not a valid date.");
    case "checkbox": return typeof value === "boolean" ? { valid: true } : bad("Expected checked or unchecked.");
    case "select": case "status": return typeof value === "string" && (field.choices || []).some((choice) => choice.id === value) ? { valid: true } : bad("Not one of the options.");
    case "multiselect": return Array.isArray(value) && value.every((id) => (field.choices || []).some((choice) => choice.id === id)) ? { valid: true } : bad("Contains an unknown option.");
    case "url": return typeof value === "string" && isValidUrl(value) ? { valid: true } : bad("Not a valid http(s) link.");
    case "email": return typeof value === "string" && EMAIL_RE.test(value) ? { valid: true } : bad("Not a valid email address.");
    case "person": return value && typeof value === "object" && isUuid(value.id) && typeof value.name === "string" ? { valid: true } : bad("Not a Persora member.");
    case "attachment": return Array.isArray(value) && value.length <= TABLE_LIMITS.attachmentsPerCell && value.every((file) => isUuid(file?.id) && typeof file.name === "string") ? { valid: true } : bad("Not a file list.");
    default: return bad("Unknown field type.");
  }
}

function findChoiceByLabel(field, label) {
  const target = String(label).trim().toLowerCase();
  return (field.choices || []).find((choice) => choice.label.toLowerCase() === target);
}

/**
 * Converts typed/pasted/imported text to a field value.
 * `createChoices`: unknown select labels become new options (returned in `newChoices`)
 * instead of failing. Returns ok:false with the raw text kept as `value` when it can't convert.
 * @returns {{ok: boolean, value: any, message?: string, newChoices?: Array<{id: string, label: string, color: string}>}}
 */
export function coerceFieldInput(field, input, { createChoices = false } = {}) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") {
    const check = validateFieldValue(field, input);
    if (check.valid) return { ok: true, value: input };
    input = textOfValue(field, input);
  }
  const text = cleanText(input, TABLE_LIMITS.cellText);
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const fail = (message) => ({ ok: false, value: text, message });
  switch (field.type) {
    case "text": return { ok: true, value: text };
    case "number": case "currency": {
      const cleaned = trimmed.replace(/^[৳$€£₹]\s?/u, "").replace(/^-[৳$€£₹]\s?/u, "-").replace(/^[A-Z]{3}\s+/u, "");
      const number = parseNumberText(cleaned);
      return number === null ? fail("Enter a number.") : { ok: true, value: number };
    }
    case "percent": {
      const number = parseNumberText(trimmed.replace(/\s?%$/u, ""));
      return number === null ? fail("Enter a percentage, e.g. 15 or 15%.") : { ok: true, value: Number((number / 100).toPrecision(15)) };
    }
    case "date": {
      const iso = toIsoDate(trimmed);
      return iso ? { ok: true, value: iso } : fail("Enter a date as YYYY-MM-DD.");
    }
    case "checkbox": {
      if (/^(true|yes|y|1|checked|x|✓)$/iu.test(trimmed)) return { ok: true, value: true };
      if (/^(false|no|n|0|unchecked)$/iu.test(trimmed)) return { ok: true, value: false };
      return fail("Use yes/no or true/false.");
    }
    case "select": case "status": {
      const choice = findChoiceByLabel(field, trimmed);
      if (choice) return { ok: true, value: choice.id };
      if (createChoices && trimmed.length <= TABLE_LIMITS.choiceLength) {
        const created = { id: newLocalId("c"), label: trimmed, color: CHOICE_COLORS[(field.choices?.length || 0) % CHOICE_COLORS.length] };
        return { ok: true, value: created.id, newChoices: [created] };
      }
      return fail(`“${trimmed}” isn't one of the options.`);
    }
    case "multiselect": {
      const labels = [...new Set(trimmed.split(/\s*[,;]\s*/u).filter(Boolean))];
      const ids = [];
      const newChoices = [];
      const working = { ...field, choices: [...(field.choices || [])] };
      for (const label of labels) {
        const choice = findChoiceByLabel(working, label);
        if (choice) { ids.push(choice.id); continue; }
        if (!createChoices || label.length > TABLE_LIMITS.choiceLength) return fail(`“${label}” isn't one of the options.`);
        const created = { id: newLocalId("c"), label, color: CHOICE_COLORS[working.choices.length % CHOICE_COLORS.length] };
        working.choices.push(created);
        newChoices.push(created);
        ids.push(created.id);
      }
      return { ok: true, value: ids, ...(newChoices.length ? { newChoices } : {}) };
    }
    case "url": {
      const candidate = /^[a-z][a-z0-9+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`;
      return isValidUrl(candidate) && /\./u.test(new URL(candidate).hostname) ? { ok: true, value: candidate } : fail("Enter a web address, e.g. example.com.");
    }
    case "email": return EMAIL_RE.test(trimmed) ? { ok: true, value: trimmed } : fail("Enter an email address.");
    case "person": return fail("Pick a person from the list.");
    case "attachment": return fail("Upload files with the attachment button.");
    default: return fail("Unknown field type.");
  }
}

/** Recognises YYYY-MM-DD and YYYY/MM/DD only (day/month order is ambiguous otherwise, so other forms stay as text). */
export function toIsoDate(text) {
  const value = String(text ?? "").trim();
  if (isIsoDate(value)) return value;
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/u.exec(value);
  if (slash) {
    const iso = `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }
  const stamp = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/u.exec(value);
  return stamp && isIsoDate(stamp[1]) ? stamp[1] : null;
}

/** Plain text for any stored value (search, CSV export, copy, retype). */
export function textOfValue(field, value, locale = "en") {
  if (isEmptyValue(value)) return "";
  if (!validateFieldValue(field, value).valid) return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  switch (field.type) {
    case "number": return formatGeneralNumber(value);
    case "currency": return String(value);
    case "percent": return `${Number((value * 100).toPrecision(12))}%`;
    case "checkbox": return value ? "true" : "false";
    case "select": case "status": return (field.choices || []).find((choice) => choice.id === value)?.label || "";
    case "multiselect": return value.map((id) => (field.choices || []).find((choice) => choice.id === id)?.label).filter(Boolean).join(", ");
    case "person": return value.name;
    case "attachment": return value.map((file) => file.name).join(", ");
    default: return String(value);
  }
}

/** Display text (formatted numbers/dates). */
export function displayValue(field, value, locale = "en") {
  if (isEmptyValue(value)) return "";
  if (!validateFieldValue(field, value).valid) return textOfValue(field, value, locale);
  switch (field.type) {
    case "number": return intlNumber(value, field.decimals ?? 2, locale);
    case "currency": return formatCurrency(value, field.currency || "BDT", field.decimals ?? 2, locale);
    case "percent": return `${intlNumber(value * 100, field.decimals ?? 0, locale)}%`;
    case "date": return formatDate(value, locale);
    case "checkbox": return value ? "Yes" : "No";
    default: return textOfValue(field, value, locale);
  }
}

/**
 * Plans a field type change without losing anything: every value is converted
 * when possible; values that can't convert are kept unchanged (and flagged as
 * invalid in the UI) — never deleted. Converting away from Attachment is
 * refused because it would detach stored files.
 * @returns {{allowed: boolean, reason?: string, field: object, converted: number, kept: number, examples: string[], values: Map<string, any>}}
 */
export function planRetype(field, toType, records) {
  if (!FIELD_TYPE_IDS.has(toType)) throw new TableValidationError("Unknown field type.");
  const target = { ...newField(field.name, toType), id: field.id, width: field.width };
  if (CHOICE_TYPES.includes(field.type) && CHOICE_TYPES.includes(toType)) target.choices = (field.choices || []).map((choice) => ({ ...choice }));
  if (field.type === "currency" && toType === "currency") target.currency = field.currency;
  const result = { allowed: true, field: target, converted: 0, kept: 0, examples: [], values: new Map() };
  if (field.type === toType) return result;
  if (field.type === "attachment") return { ...result, allowed: false, reason: "Attachment fields can't change type because their files would be detached. Create a new field instead." };
  if (toType === "attachment") return { ...result, allowed: false, reason: "Files can't be created from other values. Add a new Attachment field instead." };
  for (const record of records) {
    const value = record.values?.[field.id];
    if (isEmptyValue(value)) continue;
    let converted;
    if (NUMERIC_TYPES.includes(field.type) && NUMERIC_TYPES.includes(toType) && typeof value === "number") converted = { ok: true, value };
    else if (CHOICE_TYPES.includes(field.type) && CHOICE_TYPES.includes(toType)) {
      const ids = Array.isArray(value) ? value : [value];
      if (toType === "multiselect") converted = { ok: true, value: ids };
      else converted = ids.length <= 1 ? { ok: true, value: ids[0] ?? null } : { ok: false };
    } else {
      const text = typeof value === "string" ? value : textOfValue(field, value);
      converted = coerceFieldInput(target, text, { createChoices: true });
      if (converted.newChoices) target.choices = [...(target.choices || []), ...converted.newChoices];
    }
    if (converted.ok) {
      result.converted += 1;
      result.values.set(record.id, converted.value);
    } else {
      result.kept += 1;
      if (result.examples.length < 3) result.examples.push(textOfValue(field, value) || String(value));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Views (never modify records)
// ---------------------------------------------------------------------------

export const VIEW_TYPES = Object.freeze([
  { id: "table", label: "Table" }, { id: "board", label: "Board" }, { id: "calendar", label: "Calendar" }, { id: "gallery", label: "Gallery" },
]);
export const FILTER_OPERATORS = Object.freeze({
  contains: "contains", not_contains: "doesn't contain", is: "is", is_not: "is not", empty: "is empty", not_empty: "is not empty",
  gt: ">", gte: "≥", lt: "<", lte: "≤", before: "is before", after: "is after", checked: "is checked", unchecked: "is not checked", has_any: "has any of",
});
export function operatorsFor(type) {
  switch (type) {
    case "number": case "currency": case "percent": return ["is", "is_not", "gt", "gte", "lt", "lte", "empty", "not_empty"];
    case "date": return ["is", "before", "after", "empty", "not_empty"];
    case "checkbox": return ["checked", "unchecked"];
    case "select": case "status": return ["is", "is_not", "empty", "not_empty"];
    case "multiselect": return ["has_any", "empty", "not_empty"];
    case "attachment": return ["empty", "not_empty"];
    default: return ["contains", "not_contains", "is", "is_not", "empty", "not_empty"];
  }
}

export function newView(type = "table", name) {
  return { id: newLocalId("v"), name: name || VIEW_TYPES.find((entry) => entry.id === type)?.label || "View", type, filters: [], sort: [], hidden: [], groupBy: null, dateField: null, coverField: null };
}

export function normalizeViews(views, fields) {
  if (!Array.isArray(views) || views.length < 1) throw new TableValidationError("A Smart Table needs at least one view.");
  if (views.length > TABLE_LIMITS.views) throw new TableValidationError(`A Smart Table can have at most ${TABLE_LIMITS.views} views.`);
  const fieldIds = new Set(fields.map((field) => field.id));
  const ids = new Set();
  const ref = (value) => (typeof value === "string" && fieldIds.has(value) ? value : null);
  return views.map((raw) => {
    if (!raw || !isLocalId(raw.id) || ids.has(raw.id) || !VIEW_TYPES.some((entry) => entry.id === raw.type)) throw new TableValidationError("A view is malformed.");
    ids.add(raw.id);
    const filters = (Array.isArray(raw.filters) ? raw.filters : []).slice(0, TABLE_LIMITS.viewFilters)
      .filter((filter) => ref(filter?.fieldId) && Object.hasOwn(FILTER_OPERATORS, filter.op))
      .map((filter) => ({ fieldId: filter.fieldId, op: filter.op, value: normalizeFilterValue(filter.value) }));
    const sort = (Array.isArray(raw.sort) ? raw.sort : []).slice(0, 3).filter((entry) => ref(entry?.fieldId)).map((entry) => ({ fieldId: entry.fieldId, dir: entry.dir === "desc" ? "desc" : "asc" }));
    return {
      id: raw.id, name: cleanName(raw.name, 40, "View name"), type: raw.type, filters, sort,
      hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).filter((id) => ref(id)),
      groupBy: ref(raw.groupBy), dateField: ref(raw.dateField), coverField: ref(raw.coverField),
    };
  });
}
function normalizeFilterValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string").slice(0, TABLE_LIMITS.choices).map((entry) => entry.slice(0, 64));
  return cleanText(value ?? "", 200);
}

function matchesFilter(field, value, filter) {
  const empty = isEmptyValue(value);
  switch (filter.op) {
    case "empty": return empty;
    case "not_empty": return !empty;
    case "checked": return value === true;
    case "unchecked": return value !== true;
    default: break;
  }
  if (NUMERIC_TYPES.includes(field.type)) {
    let target = typeof filter.value === "number" ? filter.value : parseNumberText(String(filter.value ?? "").replace(/%$/u, ""));
    if (target === null || target === undefined) return true; // incomplete filter: ignore
    if (field.type === "percent" && typeof filter.value !== "number") target /= 100;
    if (typeof value !== "number") return filter.op === "is_not";
    switch (filter.op) {
      case "is": return value === target;
      case "is_not": return value !== target;
      case "gt": return value > target;
      case "gte": return value >= target;
      case "lt": return value < target;
      case "lte": return value <= target;
      default: return true;
    }
  }
  if (field.type === "date") {
    if (!isIsoDate(filter.value)) return true;
    if (!isIsoDate(value)) return false;
    if (filter.op === "is") return value === filter.value;
    if (filter.op === "before") return value < filter.value;
    if (filter.op === "after") return value > filter.value;
    return true;
  }
  if (field.type === "select" || field.type === "status") {
    if (!filter.value) return true;
    if (filter.op === "is") return value === filter.value;
    if (filter.op === "is_not") return value !== filter.value;
    return true;
  }
  if (field.type === "multiselect") {
    const wanted = Array.isArray(filter.value) ? filter.value : filter.value ? [filter.value] : [];
    if (!wanted.length) return true;
    return Array.isArray(value) && value.some((id) => wanted.includes(id));
  }
  const needle = String(filter.value ?? "").trim().toLowerCase();
  if (!needle) return true;
  const hay = textOfValue(field, value).toLowerCase();
  switch (filter.op) {
    case "contains": return hay.includes(needle);
    case "not_contains": return !hay.includes(needle);
    case "is": return hay === needle;
    case "is_not": return hay !== needle;
    default: return true;
  }
}

function compareValues(field, a, b) {
  const ea = isEmptyValue(a);
  const eb = isEmptyValue(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // blanks last
  if (NUMERIC_TYPES.includes(field.type) && typeof a === "number" && typeof b === "number") return a - b;
  if (field.type === "checkbox") return (a === true ? 1 : 0) - (b === true ? 1 : 0);
  if (field.type === "select" || field.type === "status") {
    const order = (field.choices || []).map((choice) => choice.id);
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
  }
  return textOfValue(field, a).localeCompare(textOfValue(field, b), "en", { numeric: true, sensitivity: "base" });
}

/**
 * Records shown by a view: search + filters + sort, in that order. Never
 * mutates the records; without a sort the stored order (position) is kept.
 */
export function applyView(fields, records, view, search = "") {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const filters = (view?.filters || []).filter((filter) => byId.has(filter.fieldId));
  const needle = String(search || "").trim().toLowerCase();
  let rows = records.filter((record) => {
    for (const filter of filters) if (!matchesFilter(byId.get(filter.fieldId), record.values?.[filter.fieldId], filter)) return false;
    if (!needle) return true;
    return fields.some((field) => textOfValue(field, record.values?.[field.id]).toLowerCase().includes(needle));
  });
  const sort = (view?.sort || []).filter((entry) => byId.has(entry.fieldId));
  rows = rows.map((record, index) => ({ record, index }));
  rows.sort((x, y) => {
    for (const entry of sort) {
      const field = byId.get(entry.fieldId);
      const a = x.record.values?.[field.id];
      const b = y.record.values?.[field.id];
      // Blanks and values that don't fit the field (kept, flagged) sort last in both directions.
      const blankA = isEmptyValue(a) || !validateFieldValue(field, a).valid;
      const blankB = isEmptyValue(b) || !validateFieldValue(field, b).valid;
      if (blankA !== blankB) return blankA ? 1 : -1;
      if (blankA) continue;
      const diff = compareValues(field, a, b);
      if (diff) return entry.dir === "desc" ? -diff : diff;
    }
    return (x.record.position ?? x.index) - (y.record.position ?? y.index) || x.index - y.index;
  });
  return rows.map((entry) => entry.record);
}

/** Board columns for a select/status field: one per option plus "No value" (and "Other" for invalid values). */
export function groupForBoard(field, records) {
  const groups = (field.choices || []).map((choice) => ({ id: choice.id, label: choice.label, color: choice.color, records: [] }));
  const none = { id: "", label: `No ${field.name}`, color: "gray", records: [] };
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const record of records) {
    const value = record.values?.[field.id];
    const group = typeof value === "string" ? byId.get(value) : null;
    (group || none).records.push(record);
  }
  return [...groups, none];
}

/** Why a view can't render yet (missing setup), or null. */
export function viewSetupProblem(view, fields) {
  const byId = new Map(fields.map((field) => [field.id, field]));
  if (view.type === "board") {
    const candidates = fields.filter((field) => field.type === "select" || field.type === "status");
    if (!candidates.length) return "Board view groups records by a Single select or Status field. Add one to use this view.";
    if (!view.groupBy || !byId.has(view.groupBy) || !["select", "status"].includes(byId.get(view.groupBy).type)) return "Choose which Single select or Status field to group the board by.";
  }
  if (view.type === "calendar") {
    if (!fields.some((field) => field.type === "date")) return "Calendar view places records on a Date field. Add a Date field to use this view.";
    if (!view.dateField || byId.get(view.dateField)?.type !== "date") return "Choose which Date field places records on the calendar.";
  }
  if (view.type === "gallery" && view.coverField && byId.get(view.coverField)?.type !== "attachment") return "The gallery cover must be an Attachment field.";
  return null;
}

// ---------------------------------------------------------------------------
// Summaries and chart data (respect the current view: pass the view's records)
// ---------------------------------------------------------------------------

export function fieldSummary(field, records) {
  const values = records.map((record) => record.values?.[field.id]);
  const filled = values.filter((value) => !isEmptyValue(value)).length;
  const summary = { count: records.length, filled, empty: records.length - filled };
  if (NUMERIC_TYPES.includes(field.type)) {
    const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    const sum = numbers.reduce((total, value) => total + value, 0);
    return { ...summary, numbers: numbers.length, sum, average: numbers.length ? sum / numbers.length : null, min: numbers.length ? Math.min(...numbers) : null, max: numbers.length ? Math.max(...numbers) : null };
  }
  if (field.type === "checkbox") return { ...summary, checked: values.filter((value) => value === true).length };
  if (CHOICE_TYPES.includes(field.type)) {
    const distribution = (field.choices || []).map((choice) => ({ id: choice.id, label: choice.label, color: choice.color, count: 0 }));
    const byId = new Map(distribution.map((entry) => [entry.id, entry]));
    for (const value of values) for (const id of Array.isArray(value) ? value : value ? [value] : []) if (byId.has(id)) byId.get(id).count += 1;
    return { ...summary, distribution };
  }
  return summary;
}

/** Spreadsheet column summary over computed values (numbers only for sum/average). */
export function valuesSummary(values) {
  const filled = values.filter((value) => value !== null && value !== undefined && value !== "" && !isFormulaError(value));
  const numbers = filled.filter((value) => typeof value === "number" && Number.isFinite(value));
  const sum = numbers.reduce((total, value) => total + value, 0);
  return { count: filled.length, numbers: numbers.length, sum, average: numbers.length ? sum / numbers.length : null, min: numbers.length ? Math.min(...numbers) : null, max: numbers.length ? Math.max(...numbers) : null };
}

export const CHART_TYPES = Object.freeze(["bar", "line", "donut"]);
/**
 * Groups records by a field and aggregates a numeric field (or counts).
 * Date fields group by month (line charts read left→right in time order).
 * At most `limit` groups; the rest are combined as "Other".
 * @returns {{points: Array<{key: string, label: string, value: number, color?: string}>, skipped: number}}
 */
export function chartData(fields, records, { groupField, valueField = null, aggregate = "count", limit = 12 } = {}) {
  const group = fields.find((field) => field.id === groupField);
  if (!group) return { points: [], skipped: records.length };
  const value = valueField ? fields.find((field) => field.id === valueField && NUMERIC_TYPES.includes(field.type)) : null;
  const buckets = new Map();
  let skipped = 0;
  const add = (key, label, color, record) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, color, sum: 0, n: 0, count: 0 });
    const bucket = buckets.get(key);
    bucket.count += 1;
    const number = value ? record.values?.[value.id] : null;
    if (typeof number === "number" && Number.isFinite(number)) { bucket.sum += number; bucket.n += 1; }
  };
  for (const record of records) {
    const raw = record.values?.[group.id];
    if (isEmptyValue(raw) || !validateFieldValue(group, raw).valid) { skipped += 1; continue; }
    if (CHOICE_TYPES.includes(group.type)) {
      for (const id of Array.isArray(raw) ? raw : [raw]) {
        const choice = (group.choices || []).find((entry) => entry.id === id);
        if (choice) add(choice.id, choice.label, choice.color, record);
      }
    } else if (group.type === "date") add(raw.slice(0, 7), formatMonth(raw.slice(0, 7)), undefined, record);
    else if (group.type === "checkbox") add(String(raw), raw ? "Checked" : "Not checked", undefined, record);
    else { const label = textOfValue(group, raw).slice(0, 40); add(label.toLowerCase(), label, undefined, record); }
  }
  let points = [...buckets.values()].map((bucket) => ({
    key: bucket.key, label: bucket.label, color: bucket.color,
    value: !value || aggregate === "count" ? bucket.count : aggregate === "average" ? (bucket.n ? bucket.sum / bucket.n : 0) : bucket.sum,
  }));
  if (group.type === "date") points.sort((a, b) => a.key.localeCompare(b.key));
  else if (CHOICE_TYPES.includes(group.type)) {
    const order = (group.choices || []).map((choice) => choice.id);
    points.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else points.sort((a, b) => b.value - a.value);
  if (points.length > limit) {
    const rest = points.slice(limit - 1);
    points = [...points.slice(0, limit - 1), { key: "__other", label: "Other", value: rest.reduce((sum, point) => sum + point.value, 0) }];
  }
  return { points, skipped };
}
function formatMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

// ---------------------------------------------------------------------------
// Smart Table meta, records and save batches
// ---------------------------------------------------------------------------

export function normalizeSmartMeta(meta) {
  if (!meta || typeof meta !== "object") throw new TableValidationError("The table settings are malformed.");
  const fields = normalizeFields(meta.fields);
  const views = normalizeViews(meta.views, fields);
  const fieldIds = new Set(fields.map((field) => field.id));
  const charts = (Array.isArray(meta.charts) ? meta.charts : []).slice(0, 6)
    .filter((chart) => isLocalId(chart?.id) && CHART_TYPES.includes(chart.type) && fieldIds.has(chart.groupField))
    .map((chart) => ({ id: chart.id, type: chart.type, groupField: chart.groupField, valueField: fieldIds.has(chart.valueField) ? chart.valueField : null, aggregate: ["count", "sum", "average"].includes(chart.aggregate) ? chart.aggregate : "count" }));
  const primary = fieldIds.has(meta.primaryField) ? meta.primaryField : fields[0].id;
  return { fields, views, charts, primaryField: primary };
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function normalizeRecordValues(values, fieldIds) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new TableValidationError("A record is malformed.");
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (!fieldIds.has(key) || isEmptyValue(value)) continue;
    if (typeof value === "string") out[key] = cleanText(value, TABLE_LIMITS.cellText);
    else if (typeof value === "number") { if (Number.isFinite(value)) out[key] = value; }
    else if (typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value)) {
      if (value.length > TABLE_LIMITS.choices) throw new TableValidationError("A record has too many values in one field.");
      out[key] = value.map((entry) => {
        if (typeof entry === "string") return entry.slice(0, 64);
        if (entry && typeof entry === "object" && isUuid(entry.id)) return { id: entry.id, name: cleanText(entry.name, 255), size: Math.max(0, Math.round(Number(entry.size) || 0)), type: cleanText(entry.type, 120) };
        throw new TableValidationError("A record has a malformed list value.");
      });
    } else if (value && typeof value === "object" && isUuid(value.id)) out[key] = { id: value.id, name: cleanText(value.name, 120) };
    else throw new TableValidationError("A record has a malformed value.");
  }
  if (jsonBytes(out) > TABLE_LIMITS.recordBytes) throw new TableValidationError("A record is too large.");
  return out;
}

/** Attachment ids referenced by records (used to keep only files the table still uses). */
export function attachmentIdsIn(meta, records) {
  const fields = (meta?.fields || []).filter((field) => field.type === "attachment").map((field) => field.id);
  const ids = new Set();
  for (const record of records) for (const id of fields) for (const file of Array.isArray(record.values?.[id]) ? record.values[id] : []) if (isUuid(file?.id)) ids.add(file.id);
  return ids;
}

/**
 * Validates a save batch from the browser.
 * Shape: {baseRevision, batchId, meta?, sheets?: {upsert: [{id, name, position, data}], delete: [id]},
 *         records?: {upsert: [{id, position, values, example?}], delete: [id]}}
 * Spreadsheets accept sheet changes only; Smart Tables accept meta + record changes only.
 */
export function normalizeSaveBatch(kind, batch) {
  if (!batch || typeof batch !== "object") throw new TableValidationError("The change set is malformed.");
  if (!Number.isInteger(batch.baseRevision) || batch.baseRevision < 1) throw new TableValidationError("The change set has no base version.");
  if (!isUuid(batch.batchId)) throw new TableValidationError("The change set needs an id.");
  if (jsonBytes(batch) > TABLE_LIMITS.saveBytes) throw new TableValidationError("This change is too large to save at once.");
  const out = { baseRevision: batch.baseRevision, batchId: batch.batchId, meta: null, sheetUpserts: [], sheetDeletes: [], recordUpserts: [], recordDeletes: [] };
  const ids = (list, what) => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.some((id) => !isUuid(id))) throw new TableValidationError(`The ${what} list is malformed.`);
    return [...new Set(list)];
  };
  if (kind === "spreadsheet") {
    if (batch.meta || batch.records) throw new TableValidationError("Spreadsheets don't have fields or records.");
    const sheets = batch.sheets || {};
    if (!Array.isArray(sheets.upsert ?? [])) throw new TableValidationError("The sheet list is malformed.");
    if ((sheets.upsert || []).length > TABLE_LIMITS.sheets) throw new TableValidationError(`A spreadsheet can have at most ${TABLE_LIMITS.sheets} sheets.`);
    const names = [];
    out.sheetUpserts = (sheets.upsert || []).map((sheet) => {
      if (!isUuid(sheet?.id)) throw new TableValidationError("A sheet is malformed.");
      const name = validateSheetName(sheet.name, names);
      names.push(name);
      const position = Number(sheet.position);
      if (!Number.isInteger(position) || position < 0 || position > 1000) throw new TableValidationError("A sheet position is malformed.");
      return { id: sheet.id, name, position, data: normalizeSheetData(sheet.data) };
    });
    out.sheetDeletes = ids(sheets.delete, "deleted sheet");
  } else {
    if (batch.sheets) throw new TableValidationError("Smart Tables don't have sheets.");
    out.meta = batch.meta === undefined || batch.meta === null ? null : normalizeSmartMeta(batch.meta);
    const records = batch.records || {};
    if (!Array.isArray(records.upsert ?? [])) throw new TableValidationError("The record list is malformed.");
    if ((records.upsert || []).length > TABLE_LIMITS.records) throw new TableValidationError(`A Smart Table can have at most ${TABLE_LIMITS.records.toLocaleString("en")} records.`);
    const fieldIds = out.meta ? new Set(out.meta.fields.map((field) => field.id)) : null;
    out.recordUpserts = (records.upsert || []).map((record) => {
      if (!isUuid(record?.id)) throw new TableValidationError("A record is malformed.");
      const position = Number(record.position);
      if (!Number.isFinite(position) || Math.abs(position) > 1e12) throw new TableValidationError("A record position is malformed.");
      return { id: record.id, position: Math.round(position), values: record.values, example: record.example === true };
    });
    if (fieldIds) for (const record of out.recordUpserts) record.values = normalizeRecordValues(record.values, fieldIds);
    else out.valuesPending = true; // checked against the stored fields by finalizeRecordValues()
    out.recordDeletes = ids(records.delete, "deleted record");
  }
  return out;
}

/** Checks record values of a batch without meta against the table's stored fields. */
export function finalizeRecordValues(batch, fields) {
  if (!batch.valuesPending) return batch;
  const allowed = new Set(fields.map((field) => field.id));
  for (const record of batch.recordUpserts) record.values = normalizeRecordValues(record.values, allowed);
  batch.valuesPending = false;
  return batch;
}

/** Size estimate used for the per-table storage cap. */
export function estimateBytes(value) {
  return jsonBytes(value);
}
