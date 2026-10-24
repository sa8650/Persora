// Persora Table — pure spreadsheet operations.
//
// Every function returns new objects and never mutates its input; sheets that
// don't change keep their identity (the save queue compares references to find
// what to send, and undo/redo keeps previous workbooks as snapshots).
//
// Reference behaviour (same as common spreadsheet apps):
//   * inserting/deleting rows or columns moves every reference to the moved
//     cells, in every sheet; references into deleted cells become #REF!;
//   * copy/paste and fill translate relative references ($ anchors stay);
//   * sorting and moving rows moves cell contents; formulas inside the moved
//     rows are translated like a paste, references elsewhere are unchanged;
//   * renaming a sheet rewrites references to it; deleting a sheet turns them into #REF!.

import { removeSheetFromFormula, renameSheetInFormula, shiftFormula, translateFormula, isFormulaError } from "./table-formula.js";
import { TABLE_LIMITS, TableValidationError, cleanText, normalizeBorderEdges, parseCellInput, sanitizeStyle, uniqueSheetName, validateSheetName, emptySheetData } from "./table-rules.js";

export function keyOf(row, col) {
  return `${row}:${col}`;
}
export function splitKey(key) {
  const index = key.indexOf(":");
  return [Number(key.slice(0, index)), Number(key.slice(index + 1))];
}
export function normalizeRect(rect) {
  return { r1: Math.min(rect.r1, rect.r2), r2: Math.max(rect.r1, rect.r2), c1: Math.min(rect.c1, rect.c2), c2: Math.max(rect.c1, rect.c2) };
}
function clampRect(rect, data) {
  const r = normalizeRect(rect);
  return { r1: Math.max(0, r.r1), c1: Math.max(0, r.c1), r2: Math.min(data.rowCount - 1, r.r2), c2: Math.min(data.colCount - 1, r.c2) };
}
function withSheet(workbook, sheetId, update) {
  let found = false;
  const sheets = workbook.sheets.map((sheet) => {
    if (sheet.id !== sheetId) return sheet;
    found = true;
    return update(sheet);
  });
  if (!found) throw new TableValidationError("That sheet no longer exists.");
  return { ...workbook, sheets };
}
function sheetById(workbook, sheetId) {
  const sheet = workbook.sheets.find((entry) => entry.id === sheetId);
  if (!sheet) throw new TableValidationError("That sheet no longer exists.");
  return sheet;
}
/** Applies `rewrite(formula, sheet)` to every formula of every sheet; unchanged sheets keep identity. */
function rewriteAllFormulas(workbook, rewrite) {
  const sheets = workbook.sheets.map((sheet) => {
    let cells = null;
    for (const [key, cell] of Object.entries(sheet.data.cells)) {
      if (typeof cell.f !== "string") continue;
      const next = rewrite(cell.f, sheet);
      if (next === cell.f) continue;
      if (!cells) cells = { ...sheet.data.cells };
      cells[key] = { ...cell, f: next };
    }
    return cells ? { ...sheet, data: { ...sheet.data, cells } } : sheet;
  });
  return { ...workbook, sheets };
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** Writes cells: entries are [row, col, cell|null] (null clears content and format). */
export function setCells(data, entries) {
  if (!entries.length) return data;
  const cells = { ...data.cells };
  for (const [row, col, cell] of entries) {
    if (row < 0 || col < 0 || row >= data.rowCount || col >= data.colCount) continue;
    const key = keyOf(row, col);
    if (!cell || (cell.v === undefined && cell.f === undefined && !cell.s)) delete cells[key];
    else cells[key] = cell;
  }
  return { ...data, cells };
}

/**
 * Applies typed text to one cell, keeping its format. A recognised percent/currency/date
 * suggests a format only when the cell has none yet.
 */
export function cellFromInput(text, existing) {
  const parsed = parseCellInput(text);
  const style = existing?.s ? { ...existing.s } : undefined;
  if (parsed.empty) return style ? { s: style } : null;
  if (parsed.formula) return { f: parsed.formula, ...(style ? { s: style } : {}) };
  let nextStyle = style;
  if (parsed.format && (!style || !style.nf)) nextStyle = sanitizeStyle({ ...(style || {}), ...parsed.format });
  return { v: parsed.value, ...(nextStyle ? { s: nextStyle } : {}) };
}

export function clearRange(data, rect, mode = "all") {
  const r = clampRect(rect, data);
  const cells = { ...data.cells };
  for (const [key, cell] of Object.entries(data.cells)) {
    const [row, col] = splitKey(key);
    if (row < r.r1 || row > r.r2 || col < r.c1 || col > r.c2) continue;
    if (mode === "all") delete cells[key];
    else if (mode === "contents") { if (cell.s) cells[key] = { s: cell.s }; else delete cells[key]; }
    else if (mode === "formats") {
      const { s: _style, ...rest } = cell;
      if (rest.v === undefined && rest.f === undefined) delete cells[key];
      else cells[key] = rest;
    }
  }
  return { ...data, cells };
}

/**
 * Merges a style patch into every cell of a range. `null` values remove a key.
 * `border`: "all" | "outer" | "bottom" | "none" sets cell edges for the whole range.
 */
export function applyStyle(data, rect, patch, border) {
  const r = clampRect(rect, data);
  if ((r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > TABLE_LIMITS.cellsPerSheet) throw new TableValidationError("That range is too large to format at once.");
  const cells = { ...data.cells };
  for (let row = r.r1; row <= r.r2; row += 1) {
    for (let col = r.c1; col <= r.c2; col += 1) {
      const key = keyOf(row, col);
      const cell = cells[key] || {};
      const style = { ...(cell.s || {}) };
      for (const [name, value] of Object.entries(patch || {})) {
        if (value === null || value === undefined) delete style[name];
        else style[name] = value;
      }
      if (border) {
        let edges = "";
        if (border === "all") edges = "trbl";
        else if (border === "bottom") edges = `${normalizeBorderEdges(style.bd).replace("b", "")}b`;
        else if (border === "outer") edges = `${row === r.r1 ? "t" : ""}${col === r.c2 ? "r" : ""}${row === r.r2 ? "b" : ""}${col === r.c1 ? "l" : ""}`;
        const normalized = normalizeBorderEdges(edges);
        if (normalized) style.bd = normalized;
        else delete style.bd;
      }
      const clean = sanitizeStyle(style);
      const next = { ...cell };
      if (clean) next.s = clean;
      else delete next.s;
      if (next.v === undefined && next.f === undefined && !next.s) delete cells[key];
      else cells[key] = next;
    }
  }
  return { ...data, cells };
}

// ---------------------------------------------------------------------------
// Copy / paste / fill
// ---------------------------------------------------------------------------

/** Copies a range: {rows, cols, origin: {row, col}, cells: (cell|null)[][]}. */
export function extractRange(data, rect) {
  const r = clampRect(rect, data);
  const cells = [];
  for (let row = r.r1; row <= r.r2; row += 1) {
    const line = [];
    for (let col = r.c1; col <= r.c2; col += 1) line.push(data.cells[keyOf(row, col)] || null);
    cells.push(line);
  }
  return { rows: r.r2 - r.r1 + 1, cols: r.c2 - r.c1 + 1, origin: { row: r.r1, col: r.c1 }, cells };
}

/** Tab-separated text for the system clipboard (displayed values; quotes where needed). */
export function toTsv(lines) {
  return lines.map((line) => line.map((value) => {
    const text = String(value ?? "");
    return /[\t\n\r"]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  }).join("\t")).join("\n");
}

/** Parses clipboard text from spreadsheets (tabs, quoted cells with newlines). */
export function parseClipboardText(text) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Grows a sheet so (rows × cols) fit; refuses to exceed the limits. */
export function ensureSize(data, rows, cols) {
  if (rows > TABLE_LIMITS.rows || cols > TABLE_LIMITS.cols) throw new TableValidationError(`That doesn't fit: a sheet can have at most ${TABLE_LIMITS.rows} rows and ${TABLE_LIMITS.cols} columns.`);
  if (rows <= data.rowCount && cols <= data.colCount) return data;
  return { ...data, rowCount: Math.max(data.rowCount, rows), colCount: Math.max(data.colCount, cols) };
}

/**
 * Pastes a copied block at (row, col). Internal copies keep formulas (translated by the
 * offset) and formats; `mode: "values"` pastes `values` (computed results) instead.
 * Plain text from other apps is passed as `text` rows and parsed like typing.
 */
export function pasteBlock(data, at, block) {
  let rowsNeeded;
  let colsNeeded;
  const entries = [];
  if (block.text) {
    const lines = block.text;
    rowsNeeded = at.row + lines.length;
    colsNeeded = at.col + Math.max(1, ...lines.map((line) => line.length));
    lines.forEach((line, dr) => line.forEach((text, dc) => {
      const existing = data.cells[keyOf(at.row + dr, at.col + dc)];
      entries.push([at.row + dr, at.col + dc, cellFromInput(cleanText(text, TABLE_LIMITS.cellText), existing)]);
    }));
  } else {
    rowsNeeded = at.row + block.rows;
    colsNeeded = at.col + block.cols;
    const dRow = at.row - block.origin.row;
    const dCol = at.col - block.origin.col;
    block.cells.forEach((line, dr) => line.forEach((cell, dc) => {
      let next = cell ? { ...cell } : null;
      if (next && typeof next.f === "string") {
        if (block.mode === "values") {
          const value = block.values?.[dr]?.[dc];
          delete next.f;
          if (value === null || value === undefined || isFormulaError(value)) delete next.v;
          else next.v = value;
        } else next.f = translateFormula(next.f, dRow, dCol);
      }
      entries.push([at.row + dr, at.col + dc, next]);
    }));
  }
  const sized = ensureSize(data, rowsNeeded, colsNeeded);
  return setCells(sized, entries);
}

/** Detects a constant-step numeric series (2+ numbers). Returns the step or null. */
function seriesStep(values) {
  if (values.length < 2 || !values.every((value) => typeof value === "number")) return null;
  const step = values[1] - values[0];
  for (let i = 2; i < values.length; i += 1) if (Math.abs(values[i] - values[i - 1] - step) > 1e-9) return null;
  return step;
}

/**
 * Fill handle: extends `source` over `target` (which contains it and extends it
 * down/up/right/left). Formulas are translated; 2+ numbers continue their series; other cells repeat.
 */
export function fillRange(data, source, target) {
  const s = normalizeRect(source);
  const t = normalizeRect(target);
  const vertical = t.c1 === s.c1 && t.c2 === s.c2;
  const entries = [];
  const sized = ensureSize(data, t.r2 + 1, t.c2 + 1);
  if (vertical) {
    const height = s.r2 - s.r1 + 1;
    for (let col = s.c1; col <= s.c2; col += 1) {
      const column = [];
      for (let row = s.r1; row <= s.r2; row += 1) column.push(data.cells[keyOf(row, col)] || null);
      const step = column.every((cell) => cell && typeof cell.f !== "string") ? seriesStep(column.map((cell) => cell.v)) : null;
      for (let row = t.r1; row <= t.r2; row += 1) {
        if (row >= s.r1 && row <= s.r2) continue;
        const offset = row - s.r1;
        const index = ((offset % height) + height) % height;
        const base = column[index];
        if (step !== null) {
          const last = row > s.r2 ? column[height - 1].v + step * (row - s.r2) : column[0].v - step * (s.r1 - row);
          entries.push([row, col, { ...base, v: Number(last.toPrecision(15)) }]);
        } else if (base && typeof base.f === "string") entries.push([row, col, { ...base, f: translateFormula(base.f, row - (s.r1 + index), 0) }]);
        else entries.push([row, col, base ? { ...base } : null]);
      }
    }
  } else {
    const width = s.c2 - s.c1 + 1;
    for (let row = s.r1; row <= s.r2; row += 1) {
      const line = [];
      for (let col = s.c1; col <= s.c2; col += 1) line.push(data.cells[keyOf(row, col)] || null);
      const step = line.every((cell) => cell && typeof cell.f !== "string") ? seriesStep(line.map((cell) => cell.v)) : null;
      for (let col = t.c1; col <= t.c2; col += 1) {
        if (col >= s.c1 && col <= s.c2) continue;
        const offset = col - s.c1;
        const index = ((offset % width) + width) % width;
        const base = line[index];
        if (step !== null) {
          const last = col > s.c2 ? line[width - 1].v + step * (col - s.c2) : line[0].v - step * (s.c1 - col);
          entries.push([row, col, { ...base, v: Number(last.toPrecision(15)) }]);
        } else if (base && typeof base.f === "string") entries.push([row, col, { ...base, f: translateFormula(base.f, 0, col - (s.c1 + index)) }]);
        else entries.push([row, col, base ? { ...base } : null]);
      }
    }
  }
  return setCells(sized, entries);
}

// ---------------------------------------------------------------------------
// Rows, columns and sheets (structural changes)
// ---------------------------------------------------------------------------

function remapSheet(data, axis, mapIndex, newCount) {
  const cells = {};
  for (const [key, cell] of Object.entries(data.cells)) {
    const [row, col] = splitKey(key);
    const next = mapIndex(axis === "row" ? row : col);
    if (next === null) continue;
    cells[axis === "row" ? keyOf(next, col) : keyOf(row, next)] = cell;
  }
  const sizesKey = axis === "row" ? "rowHeights" : "colWidths";
  const sizes = {};
  for (const [index, size] of Object.entries(data[sizesKey])) {
    const next = mapIndex(Number(index));
    if (next !== null) sizes[next] = size;
  }
  return { ...data, cells, [sizesKey]: sizes, ...(axis === "row" ? { rowCount: newCount } : { colCount: newCount }) };
}

function structural(workbook, sheetId, axis, index, count) {
  const sheet = sheetById(workbook, sheetId);
  const total = axis === "row" ? sheet.data.rowCount : sheet.data.colCount;
  const limit = axis === "row" ? TABLE_LIMITS.rows : TABLE_LIMITS.cols;
  if (!Number.isInteger(index) || !Number.isInteger(count) || count === 0) throw new TableValidationError("Nothing to change.");
  if (count > 0 && total + count > limit) throw new TableValidationError(`A sheet can have at most ${limit} ${axis === "row" ? "rows" : "columns"}.`);
  if (count < 0 && (index < 0 || index - count > total)) throw new TableValidationError("Those rows or columns don't exist.");
  if (count < 0 && total + count < 1) throw new TableValidationError(`A sheet needs at least one ${axis === "row" ? "row" : "column"}.`);
  // 1. Move the cells of the changed sheet.
  const mapIndex = count > 0
    ? (value) => (value >= index ? value + count : value)
    : (value) => (value < index ? value : value < index - count ? null : value + count);
  let next = withSheet(workbook, sheetId, (entry) => {
    const data = remapSheet(entry.data, axis, mapIndex, total + count);
    if (axis === "row" && count < 0 && data.frozenRows > 0) data.frozenRows = Math.min(data.frozenRows, data.rowCount - 1);
    return { ...entry, data };
  });
  // 2. Move references to them in every sheet.
  next = rewriteAllFormulas(next, (formula, owner) => shiftFormula(formula, { axis, index, count, changedSheet: sheet.name, formulaSheet: owner.name }));
  return next;
}
export const insertRows = (workbook, sheetId, index, count = 1) => structural(workbook, sheetId, "row", index, count);
export const deleteRows = (workbook, sheetId, index, count = 1) => structural(workbook, sheetId, "row", index, -count);
export const insertColumns = (workbook, sheetId, index, count = 1) => structural(workbook, sheetId, "col", index, count);
export const deleteColumns = (workbook, sheetId, index, count = 1) => structural(workbook, sheetId, "col", index, -count);

/** Reorders whole rows (or columns) of one sheet by a permutation of the range [start, start+order.length). */
function permute(data, axis, start, order) {
  const target = new Map(order.map((from, offset) => [from, start + offset])); // old index → new index
  const cells = {};
  for (const [key, cell] of Object.entries(data.cells)) {
    const [row, col] = splitKey(key);
    const index = axis === "row" ? row : col;
    const moved = target.has(index) ? target.get(index) : index;
    const delta = moved - index;
    const next = delta && typeof cell.f === "string" ? { ...cell, f: axis === "row" ? translateFormula(cell.f, delta, 0) : translateFormula(cell.f, 0, delta) } : cell;
    cells[axis === "row" ? keyOf(moved, col) : keyOf(row, moved)] = next;
  }
  const sizesKey = axis === "row" ? "rowHeights" : "colWidths";
  const sizes = {};
  for (const [index, size] of Object.entries(data[sizesKey])) {
    const n = Number(index);
    sizes[target.has(n) ? target.get(n) : n] = size;
  }
  return { ...data, cells, [sizesKey]: sizes };
}

/** Moves `count` rows starting at `from` so they start at `to` (indexes before the move). */
export function moveRows(data, from, count, to) {
  return moveBlock(data, "row", from, count, to);
}
export function moveColumns(data, from, count, to) {
  return moveBlock(data, "col", from, count, to);
}
function moveBlock(data, axis, from, count, to) {
  const total = axis === "row" ? data.rowCount : data.colCount;
  if (from < 0 || count < 1 || from + count > total || to < 0 || to + count > total || to === from) return data;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to) + count; // exclusive
  const indexes = [];
  for (let i = lo; i < hi; i += 1) indexes.push(i);
  const block = indexes.filter((i) => i >= from && i < from + count);
  const others = indexes.filter((i) => i < from || i >= from + count);
  const order = to > from ? [...others.slice(0, to - from), ...block, ...others.slice(to - from)] : [...block, ...others];
  return permute(data, axis, lo, order);
}

/**
 * Sorts rows r1..r2 by the computed values of column `col` (blanks last, numbers before text).
 * `valueAt(row, col)` returns computed values (formula results).
 */
export function sortRows(data, { r1, r2 }, col, dir, valueAt) {
  const rows = [];
  for (let row = r1; row <= r2; row += 1) rows.push(row);
  const rank = (value) => (value === null || value === undefined || value === "" || isFormulaError(value) ? 3 : typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2);
  const sorted = rows.slice().sort((a, b) => {
    const va = valueAt(a, col);
    const vb = valueAt(b, col);
    const ra = rank(va);
    const rb = rank(vb);
    if (ra === 3 || rb === 3) return ra === rb ? a - b : ra === 3 ? 1 : -1;
    let diff = ra - rb;
    if (!diff) diff = ra === 0 ? va - vb : ra === 1 ? String(va).localeCompare(String(vb), "en", { numeric: true, sensitivity: "base" }) : Number(va) - Number(vb);
    if (!diff) return a - b;
    return dir === "desc" ? -diff : diff;
  });
  if (sorted.every((row, index) => row === rows[index])) return data;
  return permute(data, "row", r1, sorted);
}

export function resizeColumn(data, col, width) {
  return { ...data, colWidths: { ...data.colWidths, [col]: Math.round(width) } };
}
export function resizeRow(data, row, height) {
  return { ...data, rowHeights: { ...data.rowHeights, [row]: Math.round(height) } };
}

export function addSheet(workbook, name, id) {
  if (workbook.sheets.length >= TABLE_LIMITS.sheets) throw new TableValidationError(`A spreadsheet can have at most ${TABLE_LIMITS.sheets} sheets.`);
  const names = workbook.sheets.map((sheet) => sheet.name);
  const finalName = name ? validateSheetName(name, names) : uniqueSheetName(`Sheet${workbook.sheets.length + 1}`, names);
  const sheet = { id, name: finalName, position: workbook.sheets.length, data: emptySheetData() };
  return { ...workbook, sheets: [...workbook.sheets, sheet] };
}
export function renameSheet(workbook, sheetId, name) {
  const sheet = sheetById(workbook, sheetId);
  const finalName = validateSheetName(name, workbook.sheets.filter((entry) => entry.id !== sheetId).map((entry) => entry.name));
  if (finalName === sheet.name) return workbook;
  const renamed = withSheet(workbook, sheetId, (entry) => ({ ...entry, name: finalName }));
  return rewriteAllFormulas(renamed, (formula) => renameSheetInFormula(formula, sheet.name, finalName));
}
export function deleteSheet(workbook, sheetId) {
  const sheet = sheetById(workbook, sheetId);
  if (workbook.sheets.length <= 1) throw new TableValidationError("A spreadsheet needs at least one sheet.");
  const rest = { ...workbook, sheets: workbook.sheets.filter((entry) => entry.id !== sheetId).map((entry, position) => (entry.position === position ? entry : { ...entry, position })) };
  return rewriteAllFormulas(rest, (formula) => removeSheetFromFormula(formula, sheet.name));
}
export function duplicateSheet(workbook, sheetId, newId) {
  const sheet = sheetById(workbook, sheetId);
  if (workbook.sheets.length >= TABLE_LIMITS.sheets) throw new TableValidationError(`A spreadsheet can have at most ${TABLE_LIMITS.sheets} sheets.`);
  const name = uniqueSheetName(`${sheet.name} copy`, workbook.sheets.map((entry) => entry.name));
  const index = workbook.sheets.indexOf(sheet);
  const copy = { id: newId, name, position: index + 1, data: { ...sheet.data, cells: { ...sheet.data.cells } } };
  const sheets = [...workbook.sheets.slice(0, index + 1), copy, ...workbook.sheets.slice(index + 1)].map((entry, position) => (entry.position === position ? entry : { ...entry, position }));
  return { ...workbook, sheets };
}
export function moveSheet(workbook, sheetId, toIndex) {
  const from = workbook.sheets.findIndex((sheet) => sheet.id === sheetId);
  if (from === -1 || toIndex < 0 || toIndex >= workbook.sheets.length || toIndex === from) return workbook;
  const list = workbook.sheets.slice();
  const [sheet] = list.splice(from, 1);
  list.splice(toIndex, 0, sheet);
  return { ...workbook, sheets: list.map((entry, position) => (entry.position === position ? entry : { ...entry, position })) };
}

/** Iterates the formula cells of a sheet for the calculator: [row, col, formula]. */
export function* formulaCellsOf(data) {
  for (const [key, cell] of Object.entries(data.cells)) {
    if (typeof cell?.f !== "string") continue;
    const [row, col] = splitKey(key);
    yield [row, col, cell.f];
  }
}
