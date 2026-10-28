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

import { addressName, columnName, parseAddress, removeSheetFromFormula, renameSheetInFormula, shiftFormula, translateFormula, isFormulaError } from "./table-formula.js";
import {
  MAX_MERGES_PER_SHEET, SHEET_CHART_TYPES, TABLE_LIMITS, TableValidationError, cleanText, emptySheetData, newLocalId, normalizeBorderEdges, normalizeMerges,
  normalizeSheetCharts, normalizeSheetComments, parseCellInput, parseNumberText, sanitizeStyle, uniqueSheetName, validateSheetName,
} from "./table-rules.js";

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
export function rectsOverlap(a, b) {
  return !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);
}
function clampRect(rect, data) {
  const r = normalizeRect(rect);
  return { r1: Math.max(0, r.r1), c1: Math.max(0, r.c1), r2: Math.min(data.rowCount - 1, r.r2), c2: Math.min(data.colCount - 1, r.c2) };
}

/** Returns the merged rectangle covering (row, col), or null if unmerged. */
export function mergeAt(data, row, col) {
  const merges = data?.merges;
  if (!Array.isArray(merges) || !merges.length) return null;
  for (const merge of merges) {
    if (row >= merge.r1 && row <= merge.r2 && col >= merge.c1 && col <= merge.c2) return merge;
  }
  return null;
}

/** Returns all merges overlapping `rect`. */
export function mergesInRect(data, rect) {
  const merges = data?.merges;
  if (!Array.isArray(merges) || !merges.length) return [];
  const r = clampRect(rect, data);
  return merges.filter((merge) => rectsOverlap(r, merge));
}

/** Expands `rect` until no merged region partially crosses its boundary. */
export function expandRectToMerges(data, rect) {
  let r = clampRect(rect, data);
  const merges = data?.merges;
  if (!Array.isArray(merges) || !merges.length) return r;
  let changed = true;
  while (changed) {
    changed = false;
    for (const merge of merges) {
      if (!rectsOverlap(r, merge)) continue;
      if (merge.r1 < r.r1 || merge.r2 > r.r2 || merge.c1 < r.c1 || merge.c2 > r.c2) {
        r = { r1: Math.min(r.r1, merge.r1), c1: Math.min(r.c1, merge.c1), r2: Math.max(r.r2, merge.r2), c2: Math.max(r.c2, merge.c2) };
        changed = true;
      }
    }
  }
  return r;
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
  return clearRanges(data, [rect], mode);
}

export function clearRanges(data, ranges, mode = "all") {
  if (!Array.isArray(ranges) || !ranges.length) return data;
  const clamped = ranges.map((rect) => expandRectToMerges(data, rect));
  const inAny = (row, col) => clamped.some((r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2);
  let changed = false;
  const cells = { ...data.cells };
  for (const [key, cell] of Object.entries(data.cells)) {
    const [row, col] = splitKey(key);
    if (!inAny(row, col)) continue;
    changed = true;
    if (mode === "all") delete cells[key];
    else if (mode === "contents") {
      if (cell.s) {
        if (cell.v !== undefined || cell.f !== undefined) cells[key] = { s: cell.s };
        else changed = changed || false;
      } else delete cells[key];
    } else if (mode === "formats") {
      const { s: _style, ...rest } = cell;
      if (rest.v === undefined && rest.f === undefined) delete cells[key];
      else cells[key] = rest;
    }
  }
  let merges = data.merges;
  if (mode === "all" && Array.isArray(merges) && merges.length) {
    const nextMerges = merges.filter((merge) => !clamped.some((r) => rectsOverlap(r, merge)));
    if (nextMerges.length !== merges.length) { merges = nextMerges; changed = true; }
  }
  return changed ? { ...data, cells, ...(merges !== data.merges ? { merges } : {}) } : data;
}

function computeBorderEdges(mode, row, col, r, existingEdges) {
  const keep = (edge) => (existingEdges.includes(edge) ? edge : "");
  switch (mode) {
    case "all": return "trbl";
    case "none": return "";
    case "outer": return `${row === r.r1 ? "t" : ""}${col === r.c2 ? "r" : ""}${row === r.r2 ? "b" : ""}${col === r.c1 ? "l" : ""}`;
    case "inner": return `${row > r.r1 ? "t" : keep("t")}${col < r.c2 ? "r" : keep("r")}${row < r.r2 ? "b" : keep("b")}${col > r.c1 ? "l" : keep("l")}`;
    case "horiz": return `${row > r.r1 ? "t" : keep("t")}${keep("r")}${row < r.r2 ? "b" : keep("b")}${keep("l")}`;
    case "vert": return `${keep("t")}${col < r.c2 ? "r" : keep("r")}${keep("b")}${col > r.c1 ? "l" : keep("l")}`;
    case "top": return `${row === r.r1 ? "t" : keep("t")}${keep("r")}${keep("b")}${keep("l")}`;
    case "bottom": return `${keep("t")}${keep("r")}${row === r.r2 ? "b" : keep("b")}${keep("l")}`;
    case "left": return `${keep("t")}${keep("r")}${keep("b")}${col === r.c1 ? "l" : keep("l")}`;
    case "right": return `${keep("t")}${col === r.c2 ? "r" : keep("r")}${keep("b")}${keep("l")}`;
    default: return existingEdges;
  }
}

/**
 * Merges a style patch into every cell of a range. `null` values remove a key.
 * `border`: "all" | "inner" | "horiz" | "vert" | "outer" | "top" | "bottom" | "left" | "right" | "none".
 */
export function applyStyle(data, rect, patch, border, borderOpts) {
  return applyStyleToRanges(data, [rect], patch, border, borderOpts);
}

export function applyStyleToRanges(data, ranges, patch, border, borderOpts) {
  if (!Array.isArray(ranges) || !ranges.length) return data;
  const clamped = ranges.map((rect) => expandRectToMerges(data, rect));
  let totalCells = 0;
  for (const r of clamped) totalCells += (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
  if (totalCells > TABLE_LIMITS.cellsPerSheet) throw new TableValidationError("That range is too large to format at once.");
  const cells = { ...data.cells };
  for (const r of clamped) {
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
          const prevEdges = normalizeBorderEdges(style.bd);
          const edges = normalizeBorderEdges(computeBorderEdges(border, row, col, r, prevEdges));
          if (edges) {
            style.bd = edges;
            if (borderOpts?.style) style.bs = borderOpts.style === "thin" ? undefined : borderOpts.style;
            if (borderOpts?.color !== undefined) {
              if (!borderOpts.color) delete style.bc;
              else style.bc = borderOpts.color;
            }
          } else {
            delete style.bd;
            delete style.bs;
            delete style.bc;
          }
        }
        const clean = sanitizeStyle(style);
        const next = { ...cell };
        if (clean) next.s = clean;
        else delete next.s;
        if (next.v === undefined && next.f === undefined && !next.s) delete cells[key];
        else cells[key] = next;
      }
    }
  }
  return { ...data, cells };
}

/**
 * Merges cells in `rect`. `mode`:
 *   - "all": merges the entire rectangle into one cell
 *   - "horizontal": merges each row across c1..c2
 *   - "vertical": merges each column down r1..r2
 * Preserves the top-left (or first non-empty) cell's value/formula in the merge anchor.
 */
export function mergeCells(data, rect, mode = "all") {
  const r = expandRectToMerges(data, rect);
  const targets = [];
  if (mode === "horizontal") {
    if (r.c2 <= r.c1) return data;
    for (let row = r.r1; row <= r.r2; row += 1) targets.push({ r1: row, c1: r.c1, r2: row, c2: r.c2 });
  } else if (mode === "vertical") {
    if (r.r2 <= r.r1) return data;
    for (let col = r.c1; col <= r.c2; col += 1) targets.push({ r1: r.r1, c1: col, r2: r.r2, c2: col });
  } else {
    if (r.r1 === r.r2 && r.c1 === r.c2) return data;
    targets.push(r);
  }
  const existingMerges = Array.isArray(data.merges) ? data.merges : [];
  const keptMerges = existingMerges.filter((merge) => !targets.some((target) => rectsOverlap(target, merge)));
  if (keptMerges.length + targets.length > MAX_MERGES_PER_SHEET) {
    throw new TableValidationError(`A sheet can have at most ${MAX_MERGES_PER_SHEET} merged regions.`);
  }
  const cells = { ...data.cells };
  for (const box of targets) {
    let donor = null;
    for (let row = box.r1; row <= box.r2 && !donor; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) {
        const candidate = cells[keyOf(row, col)];
        if (candidate && (candidate.v !== undefined || candidate.f !== undefined)) { donor = candidate; break; }
      }
    }
    const anchorKey = keyOf(box.r1, box.c1);
    const anchor = cells[anchorKey] || {};
    const mergedStyle = anchor.s || donor?.s;
    const nextAnchor = {};
    if (donor?.f !== undefined) nextAnchor.f = donor.f;
    else if (donor?.v !== undefined) nextAnchor.v = donor.v;
    if (mergedStyle) nextAnchor.s = { ...mergedStyle };
    if (Object.keys(nextAnchor).length) cells[anchorKey] = nextAnchor;
    else delete cells[anchorKey];
    for (let row = box.r1; row <= box.r2; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) {
        if (row === box.r1 && col === box.c1) continue;
        const key = keyOf(row, col);
        const sub = cells[key];
        if (!sub) continue;
        if (sub.s) cells[key] = { s: sub.s };
        else delete cells[key];
      }
    }
  }
  const merges = normalizeMerges([...keptMerges, ...targets], data.rowCount, data.colCount);
  return { ...data, cells, merges };
}

/** Removes any merged cell regions overlapping `rect`. */
export function unmergeCells(data, rect) {
  const existing = Array.isArray(data.merges) ? data.merges : [];
  if (!existing.length) return data;
  const r = clampRect(rect, data);
  const next = existing.filter((merge) => !rectsOverlap(r, merge));
  return next.length === existing.length ? data : { ...data, merges: next };
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

function remapRectInterval(rect, axis, index, count, newCount) {
  let a = axis === "row" ? rect.r1 : rect.c1;
  let b = axis === "row" ? rect.r2 : rect.c2;
  if (count > 0) {
    if (index <= a) { a += count; b += count; }
    else if (index <= b) b += count;
  } else {
    const delStart = index;
    const delEnd = index - count - 1;
    if (b < delStart) { /* unchanged */ }
    else if (a > delEnd) { a += count; b += count; }
    else {
      const survivedBefore = Math.max(0, delStart - a);
      const survivedAfter = Math.max(0, b - delEnd);
      const totalSurvived = survivedBefore + survivedAfter;
      if (totalSurvived <= 0) return null;
      a = Math.min(a, delStart);
      b = a + totalSurvived - 1;
    }
  }
  a = Math.max(0, Math.min(newCount - 1, a));
  b = Math.max(a, Math.min(newCount - 1, b));
  return axis === "row" ? { r1: a, c1: rect.c1, r2: b, c2: rect.c2 } : { r1: rect.r1, c1: a, r2: rect.r2, c2: b };
}

function remapMerges(merges, axis, index, count, newCount) {
  if (!Array.isArray(merges) || !merges.length) return [];
  const next = [];
  for (const m of merges) {
    const merged = remapRectInterval(m, axis, index, count, newCount);
    if (!merged || (merged.r1 === merged.r2 && merged.c1 === merged.c2)) continue;
    next.push(merged);
  }
  return normalizeMerges(next, axis === "row" ? newCount : Infinity, axis === "col" ? newCount : Infinity);
}

function remapSheet(data, axis, mapIndex, newCount, index = 0, count = 0) {
  const cells = {};
  for (const [key, cell] of Object.entries(data.cells)) {
    const [row, col] = splitKey(key);
    const next = mapIndex(axis === "row" ? row : col);
    if (next === null) continue;
    cells[axis === "row" ? keyOf(next, col) : keyOf(row, next)] = cell;
  }
  const sizesKey = axis === "row" ? "rowHeights" : "colWidths";
  const sizes = {};
  for (const [idx, size] of Object.entries(data[sizesKey])) {
    const next = mapIndex(Number(idx));
    if (next !== null) sizes[next] = size;
  }
  const nextRows = axis === "row" ? newCount : data.rowCount;
  const nextCols = axis === "col" ? newCount : data.colCount;
  const merges = Array.isArray(data.merges) && data.merges.length
    ? normalizeMerges(remapMerges(data.merges, axis, index, count, newCount), nextRows, nextCols)
    : (data.merges || []);
  let nextComments;
  if (data.comments && typeof data.comments === "object") {
    const movedComments = {};
    for (const [key, comment] of Object.entries(data.comments)) {
      const [row, col] = splitKey(key);
      const next = mapIndex(axis === "row" ? row : col);
      if (next === null) continue;
      movedComments[axis === "row" ? keyOf(next, col) : keyOf(row, next)] = comment;
    }
    if (Object.keys(movedComments).length) nextComments = movedComments;
  }
  let nextCharts;
  if (Array.isArray(data.charts) && data.charts.length) {
    const movedCharts = [];
    for (const chart of data.charts) {
      const shiftedRange = remapRectInterval(chart.range, axis, index, count, newCount);
      if (shiftedRange) movedCharts.push({ ...chart, range: shiftedRange });
    }
    if (movedCharts.length) nextCharts = normalizeSheetCharts(movedCharts, nextRows, nextCols);
  }
  const result = { ...data, cells, [sizesKey]: sizes, merges, ...(axis === "row" ? { rowCount: newCount } : { colCount: newCount }) };
  if (nextComments) result.comments = nextComments;
  else delete result.comments;
  if (nextCharts && nextCharts.length) result.charts = nextCharts;
  else delete result.charts;
  return result;
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
    const data = remapSheet(entry.data, axis, mapIndex, total + count, index, count);
    if (axis === "row" && count < 0 && data.frozenRows > 0) data.frozenRows = Math.min(data.frozenRows, data.rowCount - 1);
    if (axis === "col" && count < 0 && (data.frozenCols || 0) > 0) data.frozenCols = Math.min(data.frozenCols || 0, data.colCount - 1);
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
  const result = { ...data, cells, [sizesKey]: sizes };
  if (data.comments && typeof data.comments === "object") {
    const movedComments = {};
    for (const [key, comment] of Object.entries(data.comments)) {
      const [row, col] = splitKey(key);
      const index = axis === "row" ? row : col;
      const moved = target.has(index) ? target.get(index) : index;
      movedComments[axis === "row" ? keyOf(moved, col) : keyOf(row, moved)] = comment;
    }
    result.comments = movedComments;
  }
  return result;
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
  const copy = {
    id: newId,
    name,
    position: index + 1,
    data: {
      ...sheet.data,
      cells: { ...sheet.data.cells },
      merges: Array.isArray(sheet.data.merges) ? sheet.data.merges.map((merge) => ({ ...merge })) : [],
      ...(sheet.data.comments && Object.keys(sheet.data.comments).length
        ? {
            comments: Object.fromEntries(
              Object.entries(sheet.data.comments).map(([k, cm]) => [k, { ...cm, id: newLocalId("cm") }]),
            ),
          }
        : {}),
      ...(Array.isArray(sheet.data.charts) && sheet.data.charts.length
        ? {
            charts: sheet.data.charts.map((ch) => ({ ...ch, id: newLocalId("ch"), range: { ...ch.range } })),
          }
        : {}),
    },
  };
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

// ---------------------------------------------------------------------------
// Range formatting, grid extensions, cell comments, and spreadsheet charts
// ---------------------------------------------------------------------------

export function formatRangeName(rect) {
  const r = normalizeRect(rect);
  if (r.r1 === r.r2 && r.c1 === r.c2) return addressName(r.r1, r.c1);
  return `${addressName(r.r1, r.c1)}:${addressName(r.r2, r.c2)}`;
}

export function parseRangeText(text, maxRows = TABLE_LIMITS.rows, maxCols = TABLE_LIMITS.cols) {
  const clean = String(text ?? "").trim().replace(/\$/gu, "");
  if (!clean) return null;
  const parts = clean.split(":");
  if (parts.length > 2) return null;
  const a = parseAddress(parts[0].trim());
  const b = parts.length === 2 ? parseAddress(parts[1].trim()) : a;
  if (!a || !b) return null;
  const r = normalizeRect({ r1: a.row, c1: a.col, r2: b.row, c2: b.col });
  if (r.r1 < 0 || r.c1 < 0 || r.r2 >= maxRows || r.c2 >= maxCols) return null;
  return r;
}

/** Extends a sheet by `addRows` rows and/or `addCols` columns within TABLE_LIMITS. */
export function extendSheetDimensions(data, addRows = 0, addCols = 0) {
  const dr = Math.max(0, Math.trunc(Number(addRows) || 0));
  const dc = Math.max(0, Math.trunc(Number(addCols) || 0));
  if (dr === 0 && dc === 0) return data;
  const nextRows = Math.min(TABLE_LIMITS.rows, data.rowCount + dr);
  const nextCols = Math.min(TABLE_LIMITS.cols, data.colCount + dc);
  if (nextRows === data.rowCount && nextCols === data.colCount) {
    throw new TableValidationError(`Sheet is already at maximum capacity (${TABLE_LIMITS.rows} rows × ${TABLE_LIMITS.cols} columns).`);
  }
  return { ...data, rowCount: nextRows, colCount: nextCols };
}

export function setGridlinesHidden(data, hidden) {
  const next = { ...data };
  if (hidden) next.hideGridlines = true;
  else delete next.hideGridlines;
  return next;
}

/** Creates or updates a cell comment on `(row, col)`. */
export function setCellComment(data, row, col, input) {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= data.rowCount || col < 0 || col >= data.colCount) {
    throw new TableValidationError("Cell address is outside the sheet.");
  }
  const text = cleanText(input?.text ?? "", TABLE_LIMITS.commentText).trim();
  if (!text) throw new TableValidationError("Comment text can't be empty.");
  const key = keyOf(row, col);
  const existing = data.comments?.[key];
  const currentCount = data.comments ? Object.keys(data.comments).length : 0;
  if (!existing && currentCount >= TABLE_LIMITS.commentsPerSheet) {
    throw new TableValidationError(`A sheet can hold at most ${TABLE_LIMITS.commentsPerSheet} comments.`);
  }
  const nowIso = typeof input?.now === "string" && Number.isFinite(Date.parse(input.now)) ? input.now : new Date().toISOString();
  const author = cleanText(input?.author || existing?.author || "Persora Member", 80).replace(/\s+/gu, " ").trim() || "Persora Member";
  const nextComment = {
    id: existing?.id || newLocalId("cm"),
    text,
    author,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  const comments = normalizeSheetComments({ ...(data.comments || {}), [key]: nextComment }, data.rowCount, data.colCount);
  return { ...data, comments };
}

/** Deletes the comment on `(row, col)`, if present. */
export function deleteCellComment(data, row, col) {
  const key = keyOf(row, col);
  if (!data.comments || !data.comments[key]) return data;
  const nextComments = { ...data.comments };
  delete nextComments[key];
  const next = { ...data };
  if (Object.keys(nextComments).length) next.comments = nextComments;
  else delete next.comments;
  return next;
}

/** Auto-detects whether the top row of `rect` looks like header labels over numeric series. */
export function detectRangeHeaders(data, rect, valueAt) {
  const r = normalizeRect(rect);
  if (r.r2 <= r.r1) return false;
  let firstRowHasText = false;
  let secondRowHasNum = false;
  for (let c = r.c1; c <= r.c2; c += 1) {
    const v0 = valueAt ? valueAt(r.r1, c) : data.cells[keyOf(r.r1, c)]?.v;
    const v1 = valueAt ? valueAt(r.r1 + 1, c) : data.cells[keyOf(r.r1 + 1, c)]?.v;
    if (typeof v0 === "string" && v0.trim() !== "" && parseNumberText(v0) === null) firstRowHasText = true;
    if (typeof v1 === "number" || (typeof v1 === "string" && parseNumberText(v1) !== null)) secondRowHasNum = true;
  }
  return firstRowHasText && secondRowHasNum;
}

export function addSheetChart(data, input) {
  const existing = Array.isArray(data.charts) ? data.charts : [];
  if (existing.length >= TABLE_LIMITS.chartsPerSheet) {
    throw new TableValidationError(`A sheet can hold at most ${TABLE_LIMITS.chartsPerSheet} charts.`);
  }
  const type = SHEET_CHART_TYPES.includes(input?.type) ? input.type : "bar";
  const r = clampRect(input?.range || { r1: 0, c1: 0, r2: 4, c2: 1 }, data);
  const nextChart = {
    id: newLocalId("ch"),
    type,
    title: cleanText(input?.title || "", TABLE_LIMITS.nameLength).trim() || `${type[0].toUpperCase()}${type.slice(1)} chart (${formatRangeName(r)})`,
    range: r,
    hasHeaders: input?.hasHeaders ?? false,
    x: Number.isFinite(Number(input?.x)) ? Math.round(Number(input.x)) : 96 + existing.length * 28,
    y: Number.isFinite(Number(input?.y)) ? Math.round(Number(input.y)) : 56 + existing.length * 28,
    width: Number.isFinite(Number(input?.width)) ? Math.round(Number(input.width)) : 430,
    height: Number.isFinite(Number(input?.height)) ? Math.round(Number(input.height)) : 296,
  };
  const charts = normalizeSheetCharts([...existing, nextChart], data.rowCount, data.colCount);
  return { ...data, charts };
}

export function updateSheetChart(data, chartId, patch) {
  const existing = Array.isArray(data.charts) ? data.charts : [];
  if (!existing.some((ch) => ch.id === chartId)) return data;
  const updated = existing.map((ch) => (ch.id === chartId ? { ...ch, ...patch, id: ch.id } : ch));
  return { ...data, charts: normalizeSheetCharts(updated, data.rowCount, data.colCount) };
}

export function deleteSheetChart(data, chartId) {
  const existing = Array.isArray(data.charts) ? data.charts : [];
  const remaining = existing.filter((ch) => ch.id !== chartId);
  if (remaining.length === existing.length) return data;
  const next = { ...data };
  if (remaining.length) next.charts = remaining;
  else delete next.charts;
  return next;
}

function numericCell(val) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const parsed = parseNumberText(val);
    if (parsed !== null && Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function labelCell(val, fallback) {
  if (val === null || val === undefined || isFormulaError(val)) return fallback;
  const s = String(val).trim();
  return s || fallback;
}

/** Extracts live categories and numeric series from a `SheetChart` and computed `valueAt(r, c)`. */
export function extractSheetChartSeries(data, chart, valueAt) {
  const read = (r, c) => (valueAt ? valueAt(r, c) : (data.cells[keyOf(r, c)]?.v ?? null));
  const r = clampRect(chart.range, data);
  // Single column selection
  if (r.c1 === r.c2) {
    const useHeader = Boolean(chart.hasHeaders && r.r2 > r.r1);
    const startRow = useHeader ? r.r1 + 1 : r.r1;
    const seriesName = useHeader ? labelCell(read(r.r1, r.c1), columnName(r.c1)) : columnName(r.c1);
    const categories = [];
    const values = [];
    for (let row = startRow; row <= r.r2; row += 1) {
      categories.push(`Row ${row + 1}`);
      values.push(numericCell(read(row, r.c1)));
    }
    return { categories, series: [{ name: seriesName, values }] };
  }
  // Single row selection
  if (r.r1 === r.r2) {
    const useHeader = Boolean(chart.hasHeaders && r.c2 > r.c1);
    const startCol = useHeader ? r.c1 + 1 : r.c1;
    const seriesName = useHeader ? labelCell(read(r.r1, r.c1), `Row ${r.r1 + 1}`) : `Row ${r.r1 + 1}`;
    const categories = [];
    const values = [];
    for (let col = startCol; col <= r.c2; col += 1) {
      categories.push(columnName(col));
      values.push(numericCell(read(r.r1, col)));
    }
    return { categories, series: [{ name: seriesName, values }] };
  }
  // Multi-row × multi-column selection: first column = categories, remaining columns = numeric series
  const useHeader = Boolean(chart.hasHeaders && r.r2 > r.r1);
  const startRow = useHeader ? r.r1 + 1 : r.r1;
  const categories = [];
  for (let row = startRow; row <= r.r2; row += 1) {
    categories.push(labelCell(read(row, r.c1), `Row ${row + 1}`));
  }
  const series = [];
  for (let col = r.c1 + 1; col <= r.c2; col += 1) {
    const name = useHeader ? labelCell(read(r.r1, col), columnName(col)) : columnName(col);
    const values = [];
    for (let row = startRow; row <= r.r2; row += 1) {
      values.push(numericCell(read(row, col)));
    }
    series.push({ name, values });
  }
  return { categories, series };
}
