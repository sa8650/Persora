// Persora Table — the spreadsheet grid. RevoGrid (MIT community edition)
// renders a virtualised grid with keyboard navigation, range selection,
// column resizing and the fill handle; this component only translates its
// events into sheet operations. RevoGrid never owns data: every change goes
// back through SpreadsheetEditor as a new document, so undo, saving and
// formulas stay in one place.
//
// Cell editing uses Persora's own input instead of RevoGrid's editor. It opens
// synchronously on the key that starts the edit, so every following keystroke
// lands in it, and it always belongs to exactly one cell. (RevoGrid's editor
// opens a frame later and is reused between edits, which loses or mixes up
// characters when someone types quickly right after confirming a cell.)
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { RevoGrid } from "@revolist/react-datagrid";
import type { WorkbookCalculator } from "../../../cloudflare/table-formula.js";
import { columnName, isFormulaError } from "../../../cloudflare/table-formula.js";
import { COLUMN_WIDTH, ROW_HEIGHT, TABLE_LIMITS, cellEditText, formatCellValue, type SheetData } from "../../../cloudflare/table-rules.js";
import type { Rect } from "../../../cloudflare/table-sheet-ops.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- RevoGrid's event and template typings are loose */

export interface GridSelection { rect: Rect; focus: { row: number; col: number } }
export interface SheetGridHandle {
  focusCell(row: number, col: number, toRow?: number, toCol?: number): void;
  hasFocus(): boolean;
  editFocused(): void;
}

type RowType = "rowPinStart" | "rgRow";
type RowModel = Record<string, string | number>;
/** Each row model carries its sheet row, so templates never depend on virtual (filtered) indexes. */
const ROW_KEY = "__r";
const colOfProp = (prop: unknown) => Number(String(prop).slice(1));

function isDarkTheme() {
  const root = document.documentElement;
  return root.classList.contains("dark") || root.getAttribute("data-theme") === "dark" || document.body.classList.contains("dark");
}
const isTextTarget = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));

export default forwardRef<SheetGridHandle, {
  sheetId: string;
  data: SheetData;
  calc: WorkbookCalculator;
  /** Rows whose model changed since the last render (null = rebuild every row). */
  changedRows: number[] | null;
  version: number;
  hiddenRows: Set<number>;
  readOnly: boolean;
  onEdit: (row: number, col: number, text: string) => void;
  onClear: () => void;
  onFill: (source: Rect, target: Rect) => void;
  onSelection: (selection: GridSelection) => void;
  onColumnResize: (col: number, width: number) => void;
  onSelectColumn: (col: number) => void;
}>(function SheetGrid({ sheetId, data, calc, changedRows, version, hiddenRows, readOnly, onEdit, onClear, onFill, onSelection, onColumnResize, onSelectColumn }, ref) {
  const wrapper = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data); dataRef.current = data;
  const calcRef = useRef(calc); calcRef.current = calc;
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly;
  const frozen = Math.min(data.frozenRows, data.rowCount - 1);
  const frozenRef = useRef(frozen); frozenRef.current = frozen;
  const handlers = useRef({ onEdit, onClear, onFill, onSelection, onColumnResize, onSelectColumn });
  handlers.current = { onEdit, onClear, onFill, onSelection, onColumnResize, onSelectColumn };
  const grid = () => wrapper.current?.querySelector("revo-grid") as any | null;
  const gridFocused = useRef(false);
  const editingRef = useRef<{ row: number; col: number; pointerSinceOpen: boolean } | null>(null);
  /**
   * The cell that is about to have focus. RevoGrid updates its focus a little
   * after a click (and focusCell is async), so keys typed in between would go
   * to the previous cell; until RevoGrid reports this cell, it wins.
   */
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);

  // ---- row models: raw editable text per cell (formulas keep their "=") -------------
  const rowsRef = useRef<{ sheetId: string; rows: RowModel[]; rowCount: number; colCount: number } | null>(null);
  const buildRow = (sheet: SheetData, row: number) => {
    const model: RowModel = { [ROW_KEY]: row };
    for (let col = 0; col < sheet.colCount; col += 1) {
      const cell = sheet.cells[`${row}:${col}`];
      if (cell && (cell.v !== undefined || cell.f !== undefined)) model[`c${col}`] = cellEditText(cell);
    }
    return model;
  };
  const allRows = useMemo(() => {
    const cached = rowsRef.current;
    let rows: RowModel[];
    if (!cached || cached.sheetId !== sheetId || changedRows === null || cached.rowCount !== data.rowCount || cached.colCount !== data.colCount) {
      rows = Array.from({ length: data.rowCount }, (_, row) => ({ [ROW_KEY]: row }));
      for (const [key, cell] of Object.entries(data.cells)) {
        if (cell.v === undefined && cell.f === undefined) continue;
        const sep = key.indexOf(":");
        const row = Number(key.slice(0, sep));
        if (row < data.rowCount) rows[row][`c${key.slice(sep + 1)}`] = cellEditText(cell);
      }
    } else {
      rows = cached.rows.slice();
      for (const row of changedRows) if (row >= 0 && row < data.rowCount) rows[row] = buildRow(data, row);
    }
    rowsRef.current = { sheetId, rows, rowCount: data.rowCount, colCount: data.colCount };
    return rows;
  }, [sheetId, data, changedRows, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = useMemo(() => allRows.slice(0, frozen), [allRows, frozen]);
  const body = useMemo(() => allRows.slice(frozen), [allRows, frozen]);

  // ---- filtered rows and virtual <-> sheet row mapping ----------------------------------
  const trimmed = useMemo(() => {
    const result: Record<number, boolean> = {};
    for (const row of hiddenRows) if (row >= frozen) result[row - frozen] = true;
    return result;
  }, [hiddenRows, frozen]);
  /** Body rows (relative to the frozen rows) that are visible, in order: RevoGrid's virtual row index → body row. */
  const visibleBody = useMemo(() => {
    const list: number[] = [];
    for (let index = 0; index < data.rowCount - frozen; index += 1) if (!trimmed[index]) list.push(index);
    return list;
  }, [data.rowCount, frozen, trimmed]);
  const visibleRef = useRef(visibleBody); visibleRef.current = visibleBody;
  const sheetRow = (type: string | undefined, y: number) => (type === "rowPinStart" ? y : frozenRef.current + (visibleRef.current[y] ?? y));
  /** Linear position among visible rows (frozen rows first), used to move up/down past hidden rows. */
  const linearOf = (row: number) => {
    const frozenRows = frozenRef.current;
    if (row < frozenRows) return row;
    const list = visibleRef.current; const target = row - frozenRows;
    let lo = 0; let hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < target) lo = mid + 1; else hi = mid; }
    return frozenRows + lo;
  };
  const rowAtLinear = (linear: number) => {
    const frozenRows = frozenRef.current; const list = visibleRef.current;
    const clamped = Math.max(0, Math.min(linear, frozenRows + list.length - 1));
    return clamped < frozenRows ? clamped : frozenRows + list[clamped - frozenRows];
  };
  const virtualOf = (row: number): { type: RowType; y: number } => (row < frozenRef.current ? { type: "rowPinStart", y: row } : { type: "rgRow", y: linearOf(row) - frozenRef.current });

  // ---- columns: display comes from the calculator, style from the cell --------------
  const widthsKey = JSON.stringify(data.colWidths);
  const columns = useMemo(() => Array.from({ length: data.colCount }, (_, col) => ({
    prop: `c${col}`,
    name: columnName(col),
    size: data.colWidths[col] || COLUMN_WIDTH.default,
    minSize: COLUMN_WIDTH.min,
    maxSize: COLUMN_WIDTH.max,
    sortable: false,
    cellTemplate: (h: any, props: any) => {
      const row = Number(props.model?.[ROW_KEY]);
      const cell = dataRef.current.cells[`${row}:${col}`];
      if (!cell || (cell.v === undefined && cell.f === undefined)) return "";
      const value = calcRef.current.value(sheetId, row, col);
      const text = formatCellValue(value, cell.s);
      if (isFormulaError(value)) return h("span", { class: "tb-cell-error", title: value.message }, text);
      return text;
    },
    cellProperties: (props: any) => {
      const row = Number(props.model?.[ROW_KEY]);
      const cell = dataRef.current.cells[`${row}:${col}`];
      const style: Record<string, string> = {};
      const classes: Record<string, boolean> = {};
      const s = cell?.s;
      if (s) {
        if (s.b) style.fontWeight = "700";
        if (s.i) style.fontStyle = "italic";
        if (s.c) style.color = s.c;
        if (s.bg) { style.backgroundColor = s.bg; if (!s.c) style.color = "#1F2937"; } // fills are light; keep text readable in dark mode
        if (s.fs) style.fontSize = `${s.fs}px`;
        if (s.a) style.textAlign = s.a === "l" ? "left" : s.a === "c" ? "center" : "right";
        if (s.bd) for (const edge of s.bd) {
          const side = edge === "t" ? "Top" : edge === "r" ? "Right" : edge === "b" ? "Bottom" : edge === "l" ? "Left" : null;
          if (side) style[`border${side}`] = "1px solid var(--tb-cell-border-strong)";
        }
      }
      if (!s?.a && cell) {
        const value = calcRef.current.value(sheetId, row, col);
        if (typeof value === "number") classes["tb-cell-num"] = true;
      }
      return { style, class: classes };
    },
  })), [data.colCount, widthsKey, sheetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowDefinitions = useMemo(() => Object.entries(data.rowHeights).flatMap(([key, size]) => {
    const row = Number(key);
    if (row < frozen) return [{ type: "rowPinStart" as RowType, index: row, size }];
    const y = visibleBody.indexOf(row - frozen);
    return y < 0 ? [] : [{ type: "rgRow" as RowType, index: y, size }];
  }), [data.rowHeights, frozen, visibleBody]);

  // ---- selection ------------------------------------------------------------------------
  const reportSelection = useCallback(async () => {
    const element = grid();
    if (!element?.getSelectedRange) return;
    const range = await element.getSelectedRange();
    const focused = element.getFocused ? await element.getFocused() : null;
    if (range) {
      const rect = { r1: sheetRow(range.type, range.y), c1: range.x, r2: sheetRow(range.type, range.y1), c2: range.x1 };
      const focus = focused?.cell ? { row: sheetRow(focused.rowType ?? range.type, focused.cell.y), col: focused.cell.x } : { row: rect.r1, col: rect.c1 };
      if (pendingFocus.current && pendingFocus.current.row === focus.row && pendingFocus.current.col === focus.col) pendingFocus.current = null;
      handlers.current.onSelection({ rect, focus });
    } else if (focused?.cell) {
      const row = sheetRow(focused.rowType, focused.cell.y);
      if (pendingFocus.current && pendingFocus.current.row === row && pendingFocus.current.col === focused.cell.x) pendingFocus.current = null;
      handlers.current.onSelection({ rect: { r1: row, c1: focused.cell.x, r2: row, c2: focused.cell.x }, focus: { row, col: focused.cell.x } });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const focusCell = useCallback((row: number, col: number, toRow = row, toCol = col) => {
    const element = grid();
    if (!element?.setCellsFocus) return;
    pendingFocus.current = { row, col };
    const start = virtualOf(row);
    // A range can't span the frozen rows and the body; keep it within the start's part.
    const endRow = start.type === "rowPinStart" ? Math.min(toRow, frozenRef.current - 1) : Math.max(toRow, frozenRef.current);
    const end = virtualOf(endRow);
    void element.setCellsFocus({ x: col, y: start.y }, { x: toCol, y: end.y }, "rgCol", start.type).then(() => {
      void element.scrollToCoordinate?.({ x: col, y: start.y });
      void reportSelection();
    });
  }, [reportSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Persora's cell editor ----------------------------------------------------------------
  const positionEditor = useCallback(() => {
    const editing = editingRef.current; const input = editorRef.current; const host = wrapper.current;
    if (!editing || !input || !host) return;
    const { type, y } = virtualOf(editing.row);
    const target = host.querySelector<HTMLElement>(`revogr-data[type="${type}"][col-type="rgCol"] .rgCell[data-rgrow="${y}"][data-rgcol="${editing.col}"]`)
      || host.querySelector<HTMLElement>("revogr-focus");
    const hostRect = host.getBoundingClientRect();
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width === 0) { input.style.left = "48px"; input.style.top = "32px"; input.style.width = "200px"; input.style.height = "30px"; return; }
    input.style.left = `${Math.max(0, rect.left - hostRect.left)}px`;
    input.style.top = `${Math.max(0, rect.top - hostRect.top)}px`;
    input.style.width = `${Math.max(rect.width, 120)}px`;
    input.style.height = `${Math.max(rect.height, 28)}px`;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openEditor = useCallback((row: number, col: number, initial: string | null) => {
    const input = editorRef.current; const host = wrapper.current;
    if (!input || !host || readOnlyRef.current || row < 0 || col < 0) return false;
    const text = initial ?? cellEditText(dataRef.current.cells[`${row}:${col}`]);
    editingRef.current = { row, col, pointerSinceOpen: false };
    input.value = text;
    input.setAttribute("aria-label", `Edit ${columnName(col)}${row + 1}`);
    positionEditor();
    input.hidden = false;
    host.classList.add("is-editing");
    input.focus({ preventScroll: true });
    input.setSelectionRange(text.length, text.length);
    return true;
  }, [positionEditor]);

  /** Closes the editor. `move` is where focus goes next; null leaves focus to whatever took it (e.g. a click). */
  const closeEditor = useCallback((commit: boolean, move: { dr: number; dc: number } | null) => {
    const editing = editingRef.current; const input = editorRef.current;
    if (!editing || !input) return;
    editingRef.current = null;
    const value = input.value;
    input.hidden = true;
    wrapper.current?.classList.remove("is-editing");
    if (commit) handlers.current.onEdit(editing.row, editing.col, value);
    if (move) {
      const row = rowAtLinear(linearOf(editing.row) + move.dr);
      const col = Math.max(0, Math.min(editing.col + move.dc, dataRef.current.colCount - 1));
      pendingFocus.current = { row, col };
      requestAnimationFrame(() => focusCell(row, col));
    }
  }, [focusCell]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (readOnly) closeEditor(false, null); }, [readOnly, closeEditor]);
  useEffect(() => () => { editingRef.current = null; }, [sheetId]);

  useImperativeHandle(ref, () => ({
    focusCell,
    hasFocus() {
      if (!gridFocused.current || editingRef.current) return false;
      const active = document.activeElement;
      return !active || active === document.body || Boolean(wrapper.current?.contains(active));
    },
    editFocused() {
      const element = grid();
      if (!element?.getFocused) return;
      void element.getFocused().then((focused: any) => { if (focused?.cell) openEditor(sheetRow(focused.rowType, focused.cell.y), focused.cell.x, null); });
    },
  }), [focusCell, openEditor]); // eslint-disable-line react-hooks/exhaustive-deps

  // RevoGrid handles every keydown on the page while a cell has focus; this decides which ones it gets.
  const onBeforeKeyDown = (event: any) => {
    const original = event.detail?.original as KeyboardEvent | undefined;
    if (!original) return;
    // Only keys aimed at the page or the grid are grid input; keys typed into the cell editor, the
    // formula bar, find, a menu or a dialog belong to that control.
    const target = original.target as Node | null;
    const aimedAtGrid = !target || target === document.body || target === document.documentElement || Boolean(wrapper.current?.contains(target));
    if (editingRef.current || isTextTarget(original.target) || !aimedAtGrid) { event.preventDefault(); return; }
    const focus = event.detail?.focus;
    const pending = pendingFocus.current;
    if ((!focus && !pending) || original.defaultPrevented) return;
    const mod = original.ctrlKey || original.metaKey || original.altKey;
    const startsTyping = !mod && original.key.length === 1 && !original.isComposing;
    const startsEditing = !mod && (original.key === "Enter" || original.key === "F2");
    if (!startsTyping && !startsEditing) {
      if (focus && !["Shift", "Control", "Meta", "Alt"].includes(original.key)) pendingFocus.current = null; // RevoGrid navigates from its own focus
      return;
    }
    event.preventDefault();
    original.preventDefault();
    if (readOnlyRef.current) return;
    const type = (event.detail?.el as HTMLElement | undefined)?.getAttribute("type") || "rgRow";
    const cell = pending || { row: sheetRow(type, focus.y), col: focus.x };
    openEditor(cell.row, cell.col, startsTyping ? original.key : null);
  };

  const [theme, setTheme] = useThemeName();
  useEffect(() => { setTheme(isDarkTheme() ? "darkCompact" : "compact"); }, [setTheme]);

  const onPointerDownCapture = (event: React.PointerEvent) => {
    if (editingRef.current && event.target !== editorRef.current) editingRef.current.pointerSinceOpen = true;
    if (event.shiftKey || event.button !== 0) return; // shift-click extends the range from the current focus
    const target = (event.target as HTMLElement).closest?.(".rgCell");
    const part = target?.closest("revogr-data");
    if (!target || !part || part.getAttribute("col-type") !== "rgCol") return;
    const y = Number(target.getAttribute("data-rgrow")); const col = Number(target.getAttribute("data-rgcol"));
    if (Number.isInteger(y) && Number.isInteger(col)) pendingFocus.current = { row: sheetRow(part.getAttribute("type") || "rgRow", y), col };
    gridFocused.current = true;
  };

  return <div className="tb-grid" ref={wrapper} onPointerDownCapture={onPointerDownCapture} onMouseUp={() => void reportSelection()} onKeyUp={() => void reportSelection()}>
    <RevoGrid
      source={body}
      pinnedTopSource={pinned}
      columns={columns}
      rowHeaders
      range
      resize
      canFocus
      useClipboard={false}
      readonly={readOnly}
      rowSize={ROW_HEIGHT.default}
      rowDefinitions={rowDefinitions}
      trimmedRows={trimmed}
      theme={theme}
      canMoveColumns={false}
      onBeforeeditstart={(event: any) => {
        // Double-click (or anything else that would open RevoGrid's editor) opens Persora's instead.
        event.preventDefault();
        const detail = event.detail || {};
        const row = Number(detail.model?.[ROW_KEY]);
        const col = colOfProp(detail.prop);
        if (Number.isInteger(row) && Number.isInteger(col)) openEditor(row, col, null);
      }}
      onBeforeedit={(event: any) => { event.preventDefault(); }}
      onBeforerangeedit={(event: any) => {
        event.preventDefault();
        if (readOnlyRef.current) return;
        const rows = Object.values(event.detail?.data || {}) as Array<Record<string, unknown>>;
        const allEmpty = rows.every((row) => Object.entries(row || {}).every(([key, value]) => key === ROW_KEY || value === "" || value === null || value === undefined));
        if (allEmpty) handlers.current.onClear();
      }}
      onBeforeautofill={(event: any) => {
        event.preventDefault();
        if (readOnlyRef.current) return;
        const { type, oldRange, newRange } = event.detail || {};
        if (!oldRange || !newRange) return;
        const source = { r1: sheetRow(type, oldRange.y), c1: oldRange.x, r2: sheetRow(type, oldRange.y1), c2: oldRange.x1 };
        const target = { r1: sheetRow(type, newRange.y), c1: newRange.x, r2: sheetRow(type, newRange.y1), c2: newRange.x1 };
        handlers.current.onFill(source, target);
      }}
      onAfterfocus={(event: any) => {
        gridFocused.current = true;
        const detail = event.detail;
        const pending = pendingFocus.current;
        if (pending && detail && sheetRow(detail.rowType, detail.rowIndex) === pending.row && detail.colIndex === pending.col) pendingFocus.current = null;
        void reportSelection();
      }}
      onBeforefocuslost={() => { gridFocused.current = false; }}
      {...({ onSetrange: () => void reportSelection(), onBeforekeydown: onBeforeKeyDown } as Record<string, unknown>) /* emitted by revogr-overlay-selection; not in the wrapper typings */}
      onViewportscroll={() => positionEditor()}
      onAftercolumnresize={(event: any) => {
        for (const column of Object.values(event.detail || {}) as any[]) {
          const col = colOfProp(column?.prop);
          if (Number.isInteger(col) && column?.size) handlers.current.onColumnResize(col, column.size);
        }
      }}
      onHeaderclick={(event: any) => {
        const col = colOfProp(event.detail?.prop ?? event.detail?.column?.prop);
        if (Number.isInteger(col)) handlers.current.onSelectColumn(col);
      }}
    />
    <input ref={editorRef} className="tb-cell-editor" hidden type="text" spellCheck={false} autoComplete="off" maxLength={TABLE_LIMITS.cellText} enterKeyHint="enter"
      onKeyDown={(event) => {
        event.stopPropagation(); // the grid, the editor's shortcuts and RevoGrid never see keys typed here
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); closeEditor(true, { dr: event.shiftKey ? -1 : 1, dc: 0 }); }
        else if (event.key === "Tab") { event.preventDefault(); closeEditor(true, { dr: 0, dc: event.shiftKey ? -1 : 1 }); }
        else if (event.key === "Escape") { event.preventDefault(); closeEditor(false, { dr: 0, dc: 0 }); }
      }}
      onBlur={(event) => {
        const editing = editingRef.current;
        if (!editing) return;
        // RevoGrid focuses the clicked cell a frame after the click; that isn't the person leaving the editor.
        const next = event.relatedTarget as Node | null;
        if (next && wrapper.current?.contains(next) && !editing.pointerSinceOpen) { event.currentTarget.focus({ preventScroll: true }); return; }
        closeEditor(true, null);
      }}/>
  </div>;
});

function useThemeName(): [string, (value: string) => void] {
  const [theme, setTheme] = useState(() => (typeof document !== "undefined" && isDarkTheme() ? "darkCompact" : "compact"));
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(isDarkTheme() ? "darkCompact" : "compact"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return [theme, setTheme];
}
