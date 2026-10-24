// Persora Table — spreadsheet editor: toolbar, formula bar, grid, sheet tabs,
// find, sort, temporary filter and the selection summary.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ, ArrowDownZA, ArrowUpDown, ChevronLeft, ChevronRight, Copy, Download, Filter, MoreHorizontal, Pencil, Plus, Rows3, Search, Snowflake, Trash2, X,
} from "lucide-react";
import {
  SUPPORTED_FUNCTIONS, WorkbookCalculator, addressName, columnName, isFormulaError, type CalculatorSource, type CellResult,
} from "../../../cloudflare/table-formula.js";
import {
  ROW_HEIGHT, TABLE_LIMITS, TableValidationError, cellEditText, formatCellValue, validateSheetName, valuesSummary, type Sheet, type SheetData, type Workbook,
} from "../../../cloudflare/table-rules.js";
import {
  addSheet, applyStyle, cellFromInput, clearRange, deleteColumns, deleteRows, deleteSheet, duplicateSheet, ensureSize, extractRange, fillRange, formulaCellsOf,
  insertColumns, insertRows, moveSheet, normalizeRect, parseClipboardText, pasteBlock, renameSheet, resizeColumn, resizeRow, setCells, sortRows, toTsv, type CopiedBlock,
} from "../../../cloudflare/table-sheet-ops.js";
import { sheetCsvRows, workbookXlsxSheets } from "../../../cloudflare/table-io.js";
import { exportCsv, exportXlsx, safeDownloadName } from "../../lib/table/table-files";
import type { TableDoc } from "../../lib/table/table-sync";
import { ConfirmDialog } from "../VaultDialogs";
import ModalPortal from "../ModalPortal";
import type { Commit } from "./TableEditor";
import FormatToolbar, { type StylePatch } from "./FormatToolbar";
import ExportDialog from "./ExportDialog";
import type { GridSelection, SheetGridHandle } from "./SheetGrid";
import { Menu, PromptDialog, newId, plural } from "./table-ui";

const SheetGrid = lazy(() => import("./SheetGrid"));

type SpreadsheetDoc = Extract<TableDoc, { kind: "spreadsheet" }>;
const REBUILD_THRESHOLD = 4000;
const SUMMARY_CELL_LIMIT = 100_000;

const scalarForClipboard = (value: CellResult) => (isFormulaError(value) ? value.error : value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value);

export default function SpreadsheetEditor({ doc, tableName, commit, readOnly, notify }: {
  doc: SpreadsheetDoc;
  tableName: string;
  commit: Commit;
  readOnly: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const sheets = doc.sheets;
  const [activeId, setActiveId] = useState(sheets[0]?.id);
  const active = sheets.find((sheet) => sheet.id === activeId) || sheets[0];
  const data = active.data;
  const frozen = Math.min(data.frozenRows, data.rowCount - 1);
  const gridRef = useRef<SheetGridHandle>(null);
  const [sel, setSel] = useState<GridSelection>({ rect: { r1: 0, c1: 0, r2: 0, c2: 0 }, focus: { row: 0, col: 0 } });
  const [barText, setBarText] = useState("");
  const [barDirty, setBarDirty] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [filters, setFilters] = useState<Record<string, { col: number; text: string }>>({});
  const [filterPrompt, setFilterPrompt] = useState(false);
  const [renameSheetId, setRenameSheetId] = useState<string | null>(null);
  const [deleteSheetId, setDeleteSheetId] = useState<string | null>(null);
  const [rowHeightPrompt, setRowHeightPrompt] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const clipRef = useRef<{ text: string; block: CopiedBlock } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!sheets.some((sheet) => sheet.id === activeId)) setActiveId(sheets[0]?.id); }, [sheets, activeId]);

  // ---- formulas: one calculator for the workbook, updated per changed cell ------------------
  const sheetsRef = useRef(sheets);
  const byIdRef = useRef<{ list: Sheet[]; map: Map<string, Sheet> }>({ list: [], map: new Map() });
  const byId = (id: string) => {
    if (byIdRef.current.list !== sheetsRef.current) byIdRef.current = { list: sheetsRef.current, map: new Map(sheetsRef.current.map((sheet) => [sheet.id, sheet])) };
    return byIdRef.current.map.get(id);
  };
  const source = useMemo<CalculatorSource>(() => ({
    sheets: () => sheetsRef.current.map((sheet) => ({ id: sheet.id, name: sheet.name, rows: sheet.data.rowCount, cols: sheet.data.colCount })),
    cell: (id, row, col) => byId(id)?.data.cells[`${row}:${col}`],
    formulaCells: (id) => { const sheet = byId(id); return sheet ? formulaCellsOf(sheet.data) : []; },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const calcRef = useRef<WorkbookCalculator | null>(null);
  const prevSheets = useRef<Sheet[] | null>(null);
  const versionRef = useRef(0);
  const change = useMemo(() => {
    sheetsRef.current = sheets;
    versionRef.current += 1;
    const previous = prevSheets.current;
    prevSheets.current = sheets;
    if (!calcRef.current || !previous) {
      calcRef.current = new WorkbookCalculator(source);
      calcRef.current.rebuild();
      return { version: versionRef.current, rowsBySheet: null as Map<string, Set<number>> | null };
    }
    const structural = previous.length !== sheets.length || previous.some((sheet, index) => {
      const next = sheets[index];
      return sheet.id !== next.id || sheet.name !== next.name || sheet.data.rowCount !== next.data.rowCount || sheet.data.colCount !== next.data.colCount;
    });
    if (structural) { calcRef.current.rebuild(); return { version: versionRef.current, rowsBySheet: null }; }
    const rowsBySheet = new Map<string, Set<number>>();
    let total = 0;
    const perSheet: Array<[string, Array<[number, number]>]> = [];
    for (let index = 0; index < sheets.length; index += 1) {
      const before = previous[index].data.cells;
      const after = sheets[index].data.cells;
      if (before === after) continue;
      const changed: Array<[number, number]> = [];
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (before[key] === after[key]) continue;
        const sep = key.indexOf(":");
        changed.push([Number(key.slice(0, sep)), Number(key.slice(sep + 1))]);
      }
      total += changed.length;
      if (changed.length) perSheet.push([sheets[index].id, changed]);
    }
    if (total > REBUILD_THRESHOLD) { calcRef.current.rebuild(); return { version: versionRef.current, rowsBySheet: null }; }
    for (const [sheetId, cells] of perSheet) {
      const rows = rowsBySheet.get(sheetId) || new Set<number>();
      for (const [row] of cells) rows.add(row);
      rowsBySheet.set(sheetId, rows);
      for (const key of calcRef.current.update(sheetId, cells)) {
        const [id, address] = key.split("|");
        const target = rowsBySheet.get(id) || new Set<number>();
        target.add(Number(address.slice(0, address.indexOf(":"))));
        rowsBySheet.set(id, target);
      }
    }
    return { version: versionRef.current, rowsBySheet };
  }, [sheets, source]);
  const calc = calcRef.current!;
  const lastSheetRef = useRef(active.id);
  const sheetSwitched = lastSheetRef.current !== active.id;
  lastSheetRef.current = active.id;
  const changedRows = useMemo(() => (sheetSwitched || !change.rowsBySheet ? null : [...(change.rowsBySheet.get(active.id) || [])]), [change, active.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const valueAt = useCallback((row: number, col: number) => calc.value(active.id, row, col), [calc, active.id, change]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- formula bar follows the focused cell -----------------------------------------------------
  const focusCell = data.cells[`${sel.focus.row}:${sel.focus.col}`];
  const focusValue = focusCell ? calc.value(active.id, sel.focus.row, sel.focus.col) : null;
  useEffect(() => { if (!barDirty) setBarText(cellEditText(focusCell)); }, [focusCell, sel.focus.row, sel.focus.col, active.id, barDirty]);

  // ---- committing --------------------------------------------------------------------------------
  const run = useCallback(<T,>(fn: () => T): T | null => {
    try { return fn(); } catch (error) {
      notify(error instanceof TableValidationError || error instanceof Error ? error.message : "That change couldn't be made.", "error");
      return null;
    }
  }, [notify]);
  const applySheet = useCallback((label: string, fn: (sheetData: SheetData) => SheetData) => {
    if (readOnly) return false;
    const next = run(() => fn(active.data));
    if (!next || next === active.data) return false;
    commit({ kind: "spreadsheet", sheets: sheets.map((sheet) => (sheet.id === active.id ? { ...sheet, data: next } : sheet)) }, label);
    return true;
  }, [readOnly, run, active, sheets, commit]);
  const applyWorkbook = useCallback((label: string, fn: (workbook: Workbook) => Workbook) => {
    if (readOnly) return false;
    const next = run(() => fn({ sheets }));
    if (!next || next.sheets === sheets) return false;
    commit({ kind: "spreadsheet", sheets: next.sheets }, label);
    return true;
  }, [readOnly, run, sheets, commit]);

  const rect = normalizeRect(sel.rect);
  const editCell = (row: number, col: number, text: string) => {
    applySheet(`Edit ${addressName(row, col)}`, (sheetData) => {
      const existing = sheetData.cells[`${row}:${col}`];
      if (cellEditText(existing) === text) return sheetData;
      const sized = ensureSize(sheetData, row + 1, col + 1);
      return setCells(sized, [[row, col, cellFromInput(text, existing)]]);
    });
  };
  const commitBar = (move: "down" | "right" | "stay") => {
    setBarDirty(false);
    editCell(sel.focus.row, sel.focus.col, barText);
    const next = move === "down" ? { row: Math.min(sel.focus.row + 1, data.rowCount - 1), col: sel.focus.col } : move === "right" ? { row: sel.focus.row, col: Math.min(sel.focus.col + 1, data.colCount - 1) } : sel.focus;
    requestAnimationFrame(() => gridRef.current?.focusCell(next.row, next.col));
  };
  const clearSelection = () => applySheet(rect.r1 === rect.r2 && rect.c1 === rect.c2 ? `Clear ${addressName(rect.r1, rect.c1)}` : "Clear cells", (sheetData) => clearRange(sheetData, rect, "contents"));
  const style = (patch: StylePatch, label: string) => applySheet(label, (sheetData) => applyStyle(sheetData, rect, patch));

  // ---- clipboard (copy, cut, paste) ------------------------------------------------------------------
  useEffect(() => {
    const copy = (event: ClipboardEvent, cut: boolean) => {
      if (!gridRef.current?.hasFocus() || !event.clipboardData) return;
      event.preventDefault();
      const block = extractRange(data, rect);
      const lines: unknown[][] = [];
      block.values = [];
      for (let row = rect.r1; row <= rect.r2; row += 1) {
        const line: unknown[] = []; const values: CellResult[] = [];
        for (let col = rect.c1; col <= rect.c2; col += 1) { const value = calc.value(active.id, row, col); values.push(value); line.push(scalarForClipboard(value)); }
        lines.push(line); block.values.push(values);
      }
      const text = toTsv(lines);
      event.clipboardData.setData("text/plain", text);
      clipRef.current = { text, block };
      if (cut && !readOnly) applySheet("Cut", (sheetData) => clearRange(sheetData, rect, "all"));
    };
    const onCopy = (event: ClipboardEvent) => copy(event, false);
    const onCut = (event: ClipboardEvent) => copy(event, true);
    const onPaste = (event: ClipboardEvent) => {
      if (!gridRef.current?.hasFocus() || !event.clipboardData) return;
      event.preventDefault();
      if (readOnly) return;
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      const internal = clipRef.current && clipRef.current.text === text ? clipRef.current.block : null;
      const lines = internal ? null : parseClipboardText(text);
      const rows = internal ? internal.rows : lines!.length;
      const cols = internal ? internal.cols : Math.max(1, ...lines!.map((line) => line.length));
      if (rows * cols > TABLE_LIMITS.cellsPerSheet) { notify("That's too much to paste at once.", "error"); return; }
      const at = { row: rect.r1, col: rect.c1 };
      if (applySheet("Paste", (sheetData) => pasteBlock(sheetData, at, internal || { text: lines! }))) {
        requestAnimationFrame(() => gridRef.current?.focusCell(at.row, at.col, at.row + rows - 1, at.col + cols - 1));
      }
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => { document.removeEventListener("copy", onCopy); document.removeEventListener("cut", onCut); document.removeEventListener("paste", onPaste); };
  }, [data, rect.r1, rect.r2, rect.c1, rect.c2, calc, active.id, readOnly, applySheet, notify]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- rows, columns, sheets ----------------------------------------------------------------------------
  const rowsSelected = rect.r2 - rect.r1 + 1;
  const colsSelected = rect.c2 - rect.c1 + 1;
  const lastUsedRow = useMemo(() => {
    let last = -1;
    for (const key of Object.keys(data.cells)) { const row = Number(key.slice(0, key.indexOf(":"))); if (row > last && (data.cells[key].v !== undefined || data.cells[key].f !== undefined)) last = row; }
    return last;
  }, [data.cells]);
  const sortBy = (dir: "asc" | "desc") => {
    const col = sel.focus.col;
    const multi = rect.r2 > rect.r1;
    const r1 = multi ? Math.max(rect.r1, frozen) : frozen;
    const r2 = multi ? rect.r2 : lastUsedRow;
    if (r2 <= r1) { notify("There's nothing to sort below the header.", "error"); return; }
    if (applySheet(`Sort by column ${columnName(col)}`, (sheetData) => sortRows(sheetData, { r1, r2 }, col, dir, valueAt))) {
      notify(`Sorted ${plural(r2 - r1 + 1, "row")} by column ${columnName(col)}${frozen ? " (header row kept in place)" : ""}.`);
    }
  };

  // ---- temporary filter and find -------------------------------------------------------------------------
  const filter = filters[active.id] || null;
  const hiddenRows = useMemo(() => {
    const hidden = new Set<number>();
    if (!filter) return hidden;
    const query = filter.text.toLocaleLowerCase();
    for (let row = frozen; row < data.rowCount; row += 1) {
      const cell = data.cells[`${row}:${filter.col}`];
      const text = cell ? formatCellValue(calc.value(active.id, row, filter.col), cell.s).toLocaleLowerCase() : "";
      if (!text.includes(query)) hidden.add(row);
    }
    return hidden;
  }, [filter, data, frozen, calc, active.id, change]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = useMemo(() => {
    const query = findQuery.trim().toLocaleLowerCase();
    if (!query) return [] as Array<[number, number]>;
    const list: Array<[number, number]> = [];
    for (const [key, cell] of Object.entries(data.cells)) {
      if (cell.v === undefined && cell.f === undefined) continue;
      const sep = key.indexOf(":");
      const row = Number(key.slice(0, sep)); const col = Number(key.slice(sep + 1));
      const shown = formatCellValue(calc.value(active.id, row, col), cell.s).toLocaleLowerCase();
      if (shown.includes(query) || cellEditText(cell).toLocaleLowerCase().includes(query)) list.push([row, col]);
    }
    return list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }, [findQuery, data.cells, calc, active.id, change]); // eslint-disable-line react-hooks/exhaustive-deps
  const goToMatch = (step: number) => {
    if (!matches.length) return;
    const index = ((findIndex + step) % matches.length + matches.length) % matches.length;
    setFindIndex(index);
    gridRef.current?.focusCell(matches[index][0], matches[index][1]);
  };
  useEffect(() => { setFindIndex(-1); }, [findQuery, active.id]);

  // ---- selection summary ------------------------------------------------------------------------------------
  const summary = useMemo(() => {
    const cells = rowsSelected * colsSelected;
    if (cells < 2 || cells > SUMMARY_CELL_LIMIT) return null;
    const values: CellResult[] = [];
    for (let row = rect.r1; row <= rect.r2; row += 1) {
      if (hiddenRows.has(row)) continue;
      for (let col = rect.c1; col <= rect.c2; col += 1) values.push(calc.value(active.id, row, col));
    }
    return valuesSummary(values);
  }, [rect.r1, rect.r2, rect.c1, rect.c2, calc, active.id, change, hiddenRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard shortcuts ----------------------------------------------------------------------------------------
  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const inGrid = gridRef.current?.hasFocus();
    const key = event.key.toLowerCase();
    if (mod && key === "f") { event.preventDefault(); setFindOpen(true); requestAnimationFrame(() => findInput.current?.focus()); return; }
    if (!inGrid) return;
    if (mod && key === "b") { event.preventDefault(); style({ b: focusCell?.s?.b ? null : 1 }, "Bold"); }
    else if (mod && key === "i") { event.preventDefault(); style({ i: focusCell?.s?.i ? null : 1 }, "Italic"); }
    else if (event.key === "F2") { event.preventDefault(); gridRef.current?.editFocused(); }
  };

  const exportFile = async (format: "csv" | "xlsx") => {
    if (format === "csv") await exportCsv(sheetCsvRows(active, valueAt), safeDownloadName(sheets.length > 1 ? `${tableName} - ${active.name}` : tableName, "csv"));
    else await exportXlsx(workbookXlsxSheets(sheets), safeDownloadName(tableName, "xlsx"));
  };

  const sheetMenu = (sheet: Sheet, index: number) => <Menu label={`Sheet options for ${sheet.name}`} icon={<MoreHorizontal size={13}/>} buttonClassName="tb-tab-menu" items={[
    { id: "rename", label: "Rename", icon: <Pencil size={14}/>, disabled: readOnly, onSelect: () => setRenameSheetId(sheet.id) },
    { id: "duplicate", label: "Duplicate", icon: <Copy size={14}/>, disabled: readOnly || sheets.length >= TABLE_LIMITS.sheets, onSelect: () => { const id = newId(); if (applyWorkbook(`Duplicate ${sheet.name}`, (workbook) => duplicateSheet(workbook, sheet.id, id))) setActiveId(id); } },
    { id: "left", label: "Move left", icon: <ChevronLeft size={14}/>, disabled: readOnly || index === 0, onSelect: () => applyWorkbook(`Move ${sheet.name}`, (workbook) => moveSheet(workbook, sheet.id, index - 1)) },
    { id: "right", label: "Move right", icon: <ChevronRight size={14}/>, disabled: readOnly || index === sheets.length - 1, onSelect: () => applyWorkbook(`Move ${sheet.name}`, (workbook) => moveSheet(workbook, sheet.id, index + 1)) },
    "divider",
    { id: "delete", label: "Delete", icon: <Trash2 size={14}/>, danger: true, disabled: readOnly || sheets.length <= 1, onSelect: () => setDeleteSheetId(sheet.id) },
  ]}/>;

  const address = rowsSelected * colsSelected > 1 ? `${addressName(rect.r1, rect.c1)}:${addressName(rect.r2, rect.c2)}` : addressName(sel.focus.row, sel.focus.col);

  return <div className="tb-sheet-editor" onKeyDown={onKeyDown}>
    <div className="tb-toolbar" role="toolbar" aria-label="Spreadsheet tools">
      <Menu label="Rows and columns" icon={<Rows3 size={15}/>} items={[
        { id: "row-above", label: "Insert row above", disabled: readOnly, onSelect: () => applyWorkbook("Insert row", (workbook) => insertRows(workbook, active.id, rect.r1, 1)) },
        { id: "row-below", label: rowsSelected > 1 ? `Insert ${rowsSelected} rows below` : "Insert row below", disabled: readOnly, onSelect: () => applyWorkbook("Insert rows", (workbook) => insertRows(workbook, active.id, rect.r2 + 1, rowsSelected)) },
        { id: "row-delete", label: rowsSelected > 1 ? `Delete ${rowsSelected} rows` : "Delete row", danger: true, disabled: readOnly || rowsSelected >= data.rowCount, onSelect: () => applyWorkbook("Delete rows", (workbook) => deleteRows(workbook, active.id, rect.r1, rowsSelected)) },
        "divider",
        { id: "col-left", label: "Insert column left", disabled: readOnly, onSelect: () => applyWorkbook("Insert column", (workbook) => insertColumns(workbook, active.id, rect.c1, 1)) },
        { id: "col-right", label: colsSelected > 1 ? `Insert ${colsSelected} columns right` : "Insert column right", disabled: readOnly, onSelect: () => applyWorkbook("Insert columns", (workbook) => insertColumns(workbook, active.id, rect.c2 + 1, colsSelected)) },
        { id: "col-delete", label: colsSelected > 1 ? `Delete ${colsSelected} columns` : "Delete column", danger: true, disabled: readOnly || colsSelected >= data.colCount, onSelect: () => applyWorkbook("Delete columns", (workbook) => deleteColumns(workbook, active.id, rect.c1, colsSelected)) },
        "divider",
        { id: "add-rows", label: "Add 100 rows at the bottom", disabled: readOnly || data.rowCount >= TABLE_LIMITS.rows, onSelect: () => applySheet("Add rows", (sheetData) => ensureSize(sheetData, Math.min(TABLE_LIMITS.rows, sheetData.rowCount + 100), sheetData.colCount)) },
        { id: "add-cols", label: "Add 5 columns at the end", disabled: readOnly || data.colCount >= TABLE_LIMITS.cols, onSelect: () => applySheet("Add columns", (sheetData) => ensureSize(sheetData, sheetData.rowCount, Math.min(TABLE_LIMITS.cols, sheetData.colCount + 5))) },
        { id: "row-height", label: "Row height…", disabled: readOnly, onSelect: () => setRowHeightPrompt(true) },
      ]}/>
      <button type="button" className={`tb-icon-button ${frozen ? "is-on" : ""}`} aria-pressed={frozen > 0} disabled={readOnly} title={frozen ? "Unfreeze header row" : "Freeze header row"} aria-label="Freeze header row"
        onClick={() => applySheet(frozen ? "Unfreeze header row" : "Freeze header row", (sheetData) => ({ ...sheetData, frozenRows: frozen ? 0 : 1 }))}><Snowflake size={15}/></button>
      <span className="tb-toolbar-sep" aria-hidden="true"/>
      <FormatToolbar style={focusCell?.s} disabled={readOnly} onStyle={style}
        onBorder={(mode) => applySheet(mode === "none" ? "Remove borders" : "Borders", (sheetData) => applyStyle(sheetData, rect, null, mode))}
        onClearFormat={() => applySheet("Clear formatting", (sheetData) => clearRange(sheetData, rect, "formats"))}/>
      <span className="tb-toolbar-sep" aria-hidden="true"/>
      <Menu label="Sort" icon={<ArrowUpDown size={15}/>} items={[
        { id: "asc", label: `Sort A → Z by column ${columnName(sel.focus.col)}`, icon: <ArrowDownAZ size={14}/>, disabled: readOnly, onSelect: () => sortBy("asc") },
        { id: "desc", label: `Sort Z → A by column ${columnName(sel.focus.col)}`, icon: <ArrowDownZA size={14}/>, disabled: readOnly, onSelect: () => sortBy("desc") },
      ]}/>
      <button type="button" className={`tb-icon-button ${filter ? "is-on" : ""}`} aria-pressed={Boolean(filter)} title="Filter rows" aria-label="Filter rows" onClick={() => (filter ? setFilters((all) => { const next = { ...all }; delete next[active.id]; return next; }) : setFilterPrompt(true))}><Filter size={15}/></button>
      <button type="button" className={`tb-icon-button ${findOpen ? "is-on" : ""}`} aria-pressed={findOpen} title="Find (Ctrl+F)" aria-label="Find" onClick={() => { setFindOpen((open) => !open); requestAnimationFrame(() => findInput.current?.focus()); }}><Search size={15}/></button>
      <span className="tb-head-spacer"/>
      <button type="button" className="tb-icon-button" title="Export" aria-label="Export" onClick={() => setExportOpen(true)}><Download size={15}/></button>
    </div>

    {findOpen && <div className="tb-findbar" role="search">
      <Search size={14} aria-hidden="true"/>
      <input ref={findInput} type="search" placeholder={`Find in ${active.name}`} aria-label="Find in sheet" value={findQuery} onChange={(event) => setFindQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); goToMatch(event.shiftKey ? -1 : 1); } if (event.key === "Escape") setFindOpen(false); }}/>
      <span className="tb-muted" aria-live="polite">{findQuery.trim() ? (matches.length ? `${findIndex >= 0 ? findIndex + 1 : 0} of ${matches.length}` : "No matches") : ""}</span>
      <button type="button" className="tb-icon-button" aria-label="Previous match" disabled={!matches.length} onClick={() => goToMatch(-1)}><ChevronLeft size={15}/></button>
      <button type="button" className="tb-icon-button" aria-label="Next match" disabled={!matches.length} onClick={() => goToMatch(1)}><ChevronRight size={15}/></button>
      <button type="button" className="tb-icon-button" aria-label="Close find" onClick={() => setFindOpen(false)}><X size={15}/></button>
    </div>}
    {filter && <div className="tb-filterbar" role="status">
      <Filter size={13} aria-hidden="true"/> Showing rows where column {columnName(filter.col)} contains “{filter.text}” · {plural(data.rowCount - frozen - hiddenRows.size, "row")} shown. Filters here are temporary and aren't saved.
      <button type="button" className="tb-link-button" onClick={() => setFilters((all) => { const next = { ...all }; delete next[active.id]; return next; })}>Clear filter</button>
    </div>}

    <div className="tb-formula-bar">
      <span className="tb-address" aria-label="Selected cell">{address}</span>
      <button type="button" className={`tb-fx ${showHelp ? "is-on" : ""}`} aria-expanded={showHelp} onClick={() => setShowHelp((open) => !open)} title="Formula help">fx</button>
      <input className="tb-formula-input" aria-label={`Contents of ${addressName(sel.focus.row, sel.focus.col)}`} value={barText} disabled={readOnly} spellCheck={false}
        maxLength={TABLE_LIMITS.cellText}
        onChange={(event) => { setBarText(event.target.value); setBarDirty(true); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commitBar("down"); }
          else if (event.key === "Tab") { event.preventDefault(); commitBar("right"); }
          else if (event.key === "Escape") { event.preventDefault(); setBarDirty(false); setBarText(cellEditText(focusCell)); gridRef.current?.focusCell(sel.focus.row, sel.focus.col); }
        }}
        onBlur={() => { if (barDirty) commitBar("stay"); }}/>
      {barDirty && <button type="button" className="tb-secondary-button tb-bar-apply" onMouseDown={(event) => event.preventDefault()} onClick={() => commitBar("stay")}>Apply</button>}
    </div>
    {isFormulaError(focusValue) && <p className="tb-formula-error" role="status"><b>{focusValue.error}</b> {focusValue.message}</p>}
    {showHelp && <div className="tb-formula-help">
      <p>Start with <code>=</code>. Use <code>+ − * /</code>, parentheses, cell references like <code>B2</code>, ranges like <code>B2:B10</code>, other sheets like <code>'Sheet 2'!A1</code>, and these functions: {SUPPORTED_FUNCTIONS.map((name) => <code key={name}>{name}</code>)}.</p>
      <p>Example: <code>=IF(SUM(B2:B5)&gt;100, "Over", "OK")</code>. Other functions show <code>#NAME?</code> and the formula is kept. To enter text starting with “=”, type an apostrophe first: <code>'=not a formula</code>.</p>
    </div>}

    <Suspense fallback={<div className="tb-loading tb-grid" role="status"><span className="spinner"/> Loading grid…</div>}>
      <SheetGrid ref={gridRef} sheetId={active.id} data={data} calc={calc} changedRows={changedRows} version={change.version} hiddenRows={hiddenRows} readOnly={readOnly}
        onEdit={editCell}
        onClear={clearSelection}
        onFill={(fillSource, target) => applySheet("Fill", (sheetData) => fillRange(sheetData, fillSource, target))}
        onSelection={(next) => { setSel(next); setBarDirty(false); }}
        onColumnResize={(col, width) => applySheet(`Resize column ${columnName(col)}`, (sheetData) => resizeColumn(sheetData, col, width))}
        onSelectColumn={(col) => gridRef.current?.focusCell(frozen, col, data.rowCount - 1, col)}/>
    </Suspense>

    <div className="tb-sheet-foot">
      <div className="tb-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((sheet, index) => <div key={sheet.id} className={`tb-tab ${sheet.id === active.id ? "is-active" : ""}`}>
          <button type="button" role="tab" aria-selected={sheet.id === active.id} onClick={() => setActiveId(sheet.id)} onDoubleClick={() => !readOnly && setRenameSheetId(sheet.id)}>{sheet.name}</button>
          {sheet.id === active.id && sheetMenu(sheet, index)}
        </div>)}
        <button type="button" className="tb-icon-button" aria-label="Add sheet" title="Add sheet" disabled={readOnly || sheets.length >= TABLE_LIMITS.sheets}
          onClick={() => { const id = newId(); if (applyWorkbook("Add sheet", (workbook) => addSheet(workbook, null, id))) setActiveId(id); }}><Plus size={15}/></button>
      </div>
      <div className="tb-status" aria-live="polite">
        {summary ? <>
          {summary.numbers > 0 && <span>Sum <b>{formatCellValue(summary.sum, focusCell?.s)}</b></span>}
          {summary.average !== null && <span>Average <b>{formatCellValue(summary.average, focusCell?.s)}</b></span>}
          <span>Count <b>{summary.count.toLocaleString()}</b></span>
        </> : <span className="tb-muted">{plural(data.rowCount, "row")} × {plural(data.colCount, "column")}</span>}
      </div>
    </div>

    {filterPrompt && <PromptDialog id="tb-filter-title" title={`Filter by column ${columnName(sel.focus.col)}`} label="Show rows where this column contains" initial="" maxLength={200} confirmLabel="Filter"
      validate={(value) => (value.trim() ? null : "Enter some text to match.")} onCancel={() => setFilterPrompt(false)}
      onConfirm={(value) => { setFilters((all) => ({ ...all, [active.id]: { col: sel.focus.col, text: value.trim() } })); setFilterPrompt(false); }}/>}
    {renameSheetId && <PromptDialog id="tb-sheet-rename" title="Rename sheet" label="Sheet name" initial={sheets.find((sheet) => sheet.id === renameSheetId)?.name || ""} maxLength={TABLE_LIMITS.sheetNameLength}
      validate={(value) => { try { validateSheetName(value, sheets.filter((sheet) => sheet.id !== renameSheetId).map((sheet) => sheet.name)); return null; } catch (error) { return error instanceof Error ? error.message : "Choose another name."; } }}
      onCancel={() => setRenameSheetId(null)} onConfirm={(value) => { applyWorkbook("Rename sheet", (workbook) => renameSheet(workbook, renameSheetId, value)); setRenameSheetId(null); }}/>}
    {rowHeightPrompt && <PromptDialog id="tb-row-height" title={rowsSelected > 1 ? `Height of ${rowsSelected} rows` : `Height of row ${rect.r1 + 1}`} label={`Height in pixels (${ROW_HEIGHT.min}–${ROW_HEIGHT.max})`}
      initial={String(data.rowHeights[rect.r1] || ROW_HEIGHT.default)} maxLength={3}
      validate={(value) => { const height = Number(value); return Number.isInteger(height) && height >= ROW_HEIGHT.min && height <= ROW_HEIGHT.max ? null : `Enter a whole number from ${ROW_HEIGHT.min} to ${ROW_HEIGHT.max}.`; }}
      onCancel={() => setRowHeightPrompt(false)}
      onConfirm={(value) => { applySheet("Row height", (sheetData) => { let next = sheetData; for (let row = rect.r1; row <= rect.r2; row += 1) next = resizeRow(next, row, Number(value)); return next; }); setRowHeightPrompt(false); }}/>}
    {deleteSheetId && <ModalPortal><ConfirmDialog title={`Delete sheet “${sheets.find((sheet) => sheet.id === deleteSheetId)?.name}”?`} confirmLabel="Delete sheet" onCancel={() => setDeleteSheetId(null)}
      onConfirm={() => { applyWorkbook("Delete sheet", (workbook) => deleteSheet(workbook, deleteSheetId)); setDeleteSheetId(null); }}>
      <p>Its cells are removed and formulas on other sheets that point to it will show <code>#REF!</code>. You can undo this with Ctrl+Z.</p>
    </ConfirmDialog></ModalPortal>}
    {exportOpen && <ExportDialog kind="spreadsheet" sheets={sheets.length} scopeNote={`CSV exports only the current sheet, “${active.name}”.`} onClose={() => setExportOpen(false)} onExport={exportFile}/>}
  </div>;
}
