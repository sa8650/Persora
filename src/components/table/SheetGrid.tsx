// Persora Table — native virtualized spreadsheet grid with sticky row/column headers,
// frozen rows & columns, merged cells, multi-range selection, drag resizing, and inline editing.
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import {
  addressName, columnName, isFormulaError, type WorkbookCalculator,
} from "../../../cloudflare/table-formula.js";
import {
  COLUMN_WIDTH, DEFAULT_FONT_SIZE, ROW_HEIGHT, TABLE_LIMITS, cellEditText, fontStackOf, formatCellValue,
  type BorderLineStyle, type CellStyle, type MergeRect, type SheetCell, type SheetData,
} from "../../../cloudflare/table-rules.js";
import { expandRectToMerges, mergeAt, normalizeRect, rectsOverlap, type Rect } from "../../../cloudflare/table-sheet-ops.js";

export interface GridSelection {
  rect: Rect;
  ranges: Rect[];
  focus: { row: number; col: number };
  anchor: { row: number; col: number };
}

export interface SheetGridContextRequest {
  kind: "cell" | "row" | "col";
  row: number;
  col: number;
  clientX: number;
  clientY: number;
}

export interface SheetGridHandle {
  focusCell: (row: number, col: number, endRow?: number, endCol?: number, stealFocus?: boolean) => void;
  selectAll: () => void;
  editFocused: (seed?: string) => void;
  hasFocus: () => boolean;
}

const BASE_ROW_HEADER_W = 48;
const BASE_COL_HEADER_H = 26;
const ROW_OVERSCAN = 8;
const COL_OVERSCAN = 4;
const MIN_GRID_ZOOM = 0.5;
const MAX_GRID_ZOOM = 2;

export function clampGridZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(MAX_GRID_ZOOM, Math.max(MIN_GRID_ZOOM, value)) * 100) / 100;
}

function findOffsetIndex(offsets: number[], pos: number): number {
  const count = offsets.length - 1;
  if (count <= 0 || pos <= 0) return 0;
  if (pos >= offsets[count]) return count - 1;
  let lo = 0;
  let hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= pos) lo = mid + 1;
    else if (offsets[mid] > pos) hi = mid - 1;
    else return mid;
  }
  return Math.max(0, Math.min(count - 1, lo));
}

function borderSpecCss(lineStyle: BorderLineStyle | undefined, color: string | undefined): string {
  const strokeColor = color || "var(--tb-cell-border-ink)";
  switch (lineStyle) {
    case "medium": return `2px solid ${strokeColor}`;
    case "thick": return `3px solid ${strokeColor}`;
    case "dashed": return `1.5px dashed ${strokeColor}`;
    case "dotted": return `1.5px dotted ${strokeColor}`;
    case "double": return `3px double ${strokeColor}`;
    default: return `1px solid ${strokeColor}`;
  }
}

function cellInlineStyle(style: CellStyle | undefined, isNumeric: boolean, isError: boolean, zoom = 1): React.CSSProperties {
  const css: React.CSSProperties = {};
  const s = style || {};
  if (s.ff) css.fontFamily = fontStackOf(s.ff);
  const baseFs = s.fs || DEFAULT_FONT_SIZE;
  if (zoom !== 1 || baseFs !== DEFAULT_FONT_SIZE) {
    css.fontSize = `${Math.round(baseFs * zoom * 10) / 10}px`;
  }
  if (s.b) css.fontWeight = 600;
  if (s.i) css.fontStyle = "italic";
  if (s.u && s.st) css.textDecoration = "underline line-through";
  else if (s.u) css.textDecoration = "underline";
  else if (s.st) css.textDecoration = "line-through";
  if (s.bg) {
    css.backgroundColor = s.bg;
    if (!s.c && !isError) css.color = "#111827";
  }
  if (s.c && !isError) css.color = s.c;
  const hAlign = s.a === "c" ? "center" : s.a === "r" ? "right" : s.a === "l" ? "left" : isNumeric ? "right" : "left";
  css.justifyContent = hAlign === "center" ? "center" : hAlign === "right" ? "flex-end" : "flex-start";
  css.textAlign = hAlign;
  css.alignItems = s.va === "t" ? "flex-start" : s.va === "b" ? "flex-end" : "center";
  if (s.bd) {
    const spec = borderSpecCss(s.bs, s.bc);
    if (s.bd.includes("t")) css.borderTop = spec;
    if (s.bd.includes("r")) css.borderRight = spec;
    if (s.bd.includes("b")) css.borderBottom = spec;
    if (s.bd.includes("l")) css.borderLeft = spec;
    css.zIndex = 2;
  }
  return css;
}

function formulaAcceptsReference(draft: string): boolean {
  if (!draft.startsWith("=")) return false;
  return /[=+\-*/(,:\s]$/u.test(draft);
}

export default forwardRef<SheetGridHandle, {
  sheetId: string;
  data: SheetData;
  calc: WorkbookCalculator;
  changedRows: number[] | null;
  version: number;
  hiddenRows: Set<number>;
  readOnly: boolean;
  onEdit: (row: number, col: number, text: string) => void;
  onClear: () => void;
  onFill: (source: Rect, target: Rect) => void;
  onSelection: (selection: GridSelection) => void;
  onColumnResize: (col: number, width: number) => void;
  onRowResize: (row: number, height: number) => void;
  onLiveDraft?: (text: string | null) => void;
  onContextAction?: (req: SheetGridContextRequest) => void;
  onOpenComment?: (row: number, col: number, anchorRect: DOMRect) => void;
  onExtendGrid?: (addRows: number, addCols: number) => void;
  zoom?: number;
  onZoomChange?: (nextZoom: number) => void;
  searchMatchKeys?: ReadonlySet<string>;
  activeMatchKey?: string | null;
  overlaySlot?: React.ReactNode;
}>(function SheetGrid(
  {
    sheetId,
    data,
    calc,
    hiddenRows,
    readOnly,
    onEdit,
    onClear,
    onFill,
    onSelection,
    onColumnResize,
    onRowResize,
    onLiveDraft,
    onContextAction,
    onOpenComment,
    onExtendGrid,
    zoom: zoomProp = 1,
    onZoomChange,
    searchMatchKeys,
    activeMatchKey,
    overlaySlot,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorInputRef = useRef<HTMLInputElement>(null);

  const zoom = clampGridZoom(zoomProp);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const ROW_HEADER_W = Math.max(28, Math.round(BASE_ROW_HEADER_W * zoom));
  const COL_HEADER_H = Math.max(18, Math.round(BASE_COL_HEADER_H * zoom));

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const cb = onZoomChangeRef.current;
      if (!cb) return;
      const delta = ev.deltaMode === 1 ? ev.deltaY * 18 : ev.deltaY;
      const factor = Math.exp(-delta * 0.0045);
      const next = clampGridZoom(zoomRef.current * factor);
      if (next !== zoomRef.current) cb(next);
    };

    let pinchStartDist: number | null = null;
    let pinchStartZoom = 1;
    const touchDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length === 2 && onZoomChangeRef.current) {
        const dist = touchDistance(ev.touches);
        if (dist > 8) {
          pinchStartDist = dist;
          pinchStartZoom = zoomRef.current;
          ev.preventDefault();
        }
      }
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length === 2 && pinchStartDist && onZoomChangeRef.current) {
        ev.preventDefault();
        const dist = touchDistance(ev.touches);
        if (dist > 8) {
          const next = clampGridZoom(pinchStartZoom * (dist / pinchStartDist));
          if (next !== zoomRef.current) onZoomChangeRef.current(next);
        }
      }
    };

    const onTouchEnd = (ev: TouchEvent) => {
      if (ev.touches.length < 2) pinchStartDist = null;
    };

    let safariStartZoom = 1;
    const onGestureStart = (ev: Event) => {
      if (!onZoomChangeRef.current) return;
      ev.preventDefault();
      safariStartZoom = zoomRef.current;
    };
    const onGestureChange = (ev: Event) => {
      const cb = onZoomChangeRef.current;
      if (!cb) return;
      ev.preventDefault();
      const scale = (ev as unknown as { scale?: number }).scale || 1;
      const next = clampGridZoom(safariStartZoom * scale);
      if (next !== zoomRef.current) cb(next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const rowCount = data.rowCount;
  const colCount = data.colCount;
  const frozenRows = Math.min(Math.max(0, data.frozenRows || 0), Math.max(0, rowCount - 1));
  const frozenCols = Math.min(Math.max(0, data.frozenCols || 0), Math.max(0, colCount - 1));
  const merges = useMemo<MergeRect[]>(() => (Array.isArray(data.merges) ? data.merges : []), [data.merges]);

  // Visible rows list (frozen rows are never hidden by temporary filters)
  const visibleRows = useMemo(() => {
    const list: number[] = [];
    for (let r = 0; r < rowCount; r += 1) {
      if (r >= frozenRows && hiddenRows.has(r)) continue;
      list.push(r);
    }
    return list;
  }, [rowCount, frozenRows, hiddenRows]);

  const rowToVisIndex = useMemo(() => {
    const map = new Int32Array(rowCount).fill(-1);
    for (let i = 0; i < visibleRows.length; i += 1) map[visibleRows[i]] = i;
    return map;
  }, [rowCount, visibleRows]);

  // Prefix-sum offsets for visible rows and all columns (scaled by cell zoom)
  const visRowOffsets = useMemo(() => {
    const offsets = new Array<number>(visibleRows.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < visibleRows.length; i += 1) {
      const r = visibleRows[i];
      offsets[i + 1] = offsets[i] + Math.max(14, Math.round((data.rowHeights[r] || ROW_HEIGHT.default) * zoom));
    }
    return offsets;
  }, [visibleRows, data.rowHeights, zoom]);

  const colOffsets = useMemo(() => {
    const offsets = new Array<number>(colCount + 1);
    offsets[0] = 0;
    for (let c = 0; c < colCount; c += 1) {
      offsets[c + 1] = offsets[c] + Math.max(20, Math.round((data.colWidths[c] || COLUMN_WIDTH.default) * zoom));
    }
    return offsets;
  }, [colCount, data.colWidths, zoom]);

  const frozenVisRows = Math.min(frozenRows, visibleRows.length);
  const frozenRowsHeight = visRowOffsets[frozenVisRows] || 0;
  const frozenColsWidth = colOffsets[frozenCols] || 0;
  const totalRowsHeight = visRowOffsets[visibleRows.length] || 0;
  const totalColsWidth = colOffsets[colCount] || 0;

  // Viewport scroll + size state for virtualization
  const [viewport, setViewport] = useState({ scrollTop: 0, scrollLeft: 0, width: 1200, height: 640 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const syncSize = () => {
      setViewport({
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        width: el.clientWidth || 1200,
        height: el.clientHeight || 640,
      });
    };
    syncSize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncSize) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Selection state (supports multi-range via Ctrl/Cmd)
  const [sel, setSel] = useState<GridSelection>(() => ({
    rect: { r1: 0, c1: 0, r2: 0, c2: 0 },
    ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }],
    focus: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
  }));
  const selRef = useRef(sel);
  selRef.current = sel;

  const commitSelection = useCallback(
    (next: GridSelection) => {
      selRef.current = next;
      setSel(next);
      onSelection(next);
    },
    [onSelection],
  );

  // Reset / clamp selection when switching sheets or shrinking dimensions
  const prevSheetIdRef = useRef(sheetId);
  useEffect(() => {
    if (prevSheetIdRef.current !== sheetId) {
      prevSheetIdRef.current = sheetId;
      const box = mergeAt(data, 0, 0) || { r1: 0, c1: 0, r2: 0, c2: 0 };
      commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        scrollRef.current.scrollLeft = 0;
      }
      setEditing(null);
      return;
    }
    const cur = selRef.current;
    const maxR = Math.max(0, rowCount - 1);
    const maxC = Math.max(0, colCount - 1);
    const clampOne = (r: Rect): Rect => ({
      r1: Math.min(maxR, Math.max(0, r.r1)),
      c1: Math.min(maxC, Math.max(0, r.c1)),
      r2: Math.min(maxR, Math.max(0, r.r2)),
      c2: Math.min(maxC, Math.max(0, r.c2)),
    });
    const clampedRanges = cur.ranges.map(clampOne);
    const clampedPrimary = clampedRanges[clampedRanges.length - 1] || { r1: 0, c1: 0, r2: 0, c2: 0 };
    const focusRow = Math.min(maxR, Math.max(0, cur.focus.row));
    const focusCol = Math.min(maxC, Math.max(0, cur.focus.col));
    if (
      focusRow !== cur.focus.row ||
      focusCol !== cur.focus.col ||
      clampedPrimary.r2 !== cur.rect.r2 ||
      clampedPrimary.c2 !== cur.rect.c2
    ) {
      commitSelection({
        rect: clampedPrimary,
        ranges: clampedRanges,
        focus: { row: focusRow, col: focusCol },
        anchor: { row: Math.min(maxR, Math.max(0, cur.anchor.row)), col: Math.min(maxC, Math.max(0, cur.anchor.col)) },
      });
    }
  }, [sheetId, rowCount, colCount, data, commitSelection]);

  // Inline editor state
  const [editing, setEditing] = useState<{ row: number; col: number; text: string } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    onLiveDraft?.(editing ? editing.text : null);
  }, [editing, onLiveDraft]);

  // Fill-handle preview state
  const [fillTarget, setFillTarget] = useState<Rect | null>(null);

  // Active resize guide state
  const [resizeGuide, setResizeGuide] = useState<
    | { axis: "col"; index: number; pos: number; size: number }
    | { axis: "row"; index: number; pos: number; size: number }
    | null
  >(null);

  // Scroll cell into view when navigating via keyboard or Find
  const scrollCellIntoView = useCallback(
    (row: number, col: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const visIdx = rowToVisIndex[row];
      if (visIdx >= frozenVisRows) {
        const cellTop = visRowOffsets[visIdx] - frozenRowsHeight;
        const cellBottom = visRowOffsets[visIdx + 1] - frozenRowsHeight;
        const viewH = Math.max(40, el.clientHeight - COL_HEADER_H - frozenRowsHeight);
        if (cellTop < el.scrollTop) el.scrollTop = cellTop;
        else if (cellBottom > el.scrollTop + viewH) el.scrollTop = Math.max(0, cellBottom - viewH);
      }
      if (col >= frozenCols) {
        const cellLeft = colOffsets[col] - frozenColsWidth;
        const cellRight = colOffsets[col + 1] - frozenColsWidth;
        const viewW = Math.max(60, el.clientWidth - ROW_HEADER_W - frozenColsWidth);
        if (cellLeft < el.scrollLeft) el.scrollLeft = cellLeft;
        else if (cellRight > el.scrollLeft + viewW) el.scrollLeft = Math.max(0, cellRight - viewW);
      }
    },
    [rowToVisIndex, frozenVisRows, visRowOffsets, frozenRowsHeight, frozenCols, colOffsets, frozenColsWidth],
  );

  const openEditor = useCallback(
    (row: number, col: number, seed?: string) => {
      if (readOnly) return;
      const m = mergeAt(data, row, col);
      const targetRow = m ? m.r1 : row;
      const targetCol = m ? m.c1 : col;
      const existing = data.cells[`${targetRow}:${targetCol}`];
      const text = seed !== undefined ? seed : cellEditText(existing);
      setEditing({ row: targetRow, col: targetCol, text });
      requestAnimationFrame(() => {
        const input = editorInputRef.current;
        if (!input) return;
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      });
    },
    [readOnly, data],
  );

  const finishEdit = useCallback(
    (commitChange: boolean, move?: "down" | "up" | "right" | "left") => {
      const curEdit = editingRef.current;
      if (!curEdit) return;
      setEditing(null);
      if (commitChange) onEdit(curEdit.row, curEdit.col, curEdit.text);
      if (move) {
        const m = mergeAt(data, curEdit.row, curEdit.col);
        let nextRow = curEdit.row;
        let nextCol = curEdit.col;
        if (move === "down") nextRow = Math.min(rowCount - 1, (m ? m.r2 : curEdit.row) + 1);
        else if (move === "up") nextRow = Math.max(0, (m ? m.r1 : curEdit.row) - 1);
        else if (move === "right") nextCol = Math.min(colCount - 1, (m ? m.c2 : curEdit.col) + 1);
        else if (move === "left") nextCol = Math.max(0, (m ? m.c1 : curEdit.col) - 1);
        const destMerge = mergeAt(data, nextRow, nextCol);
        const box = destMerge || { r1: nextRow, c1: nextCol, r2: nextRow, c2: nextCol };
        commitSelection({
          rect: box,
          ranges: [box],
          focus: { row: box.r1, col: box.c1 },
          anchor: { row: box.r1, col: box.c1 },
        });
        scrollCellIntoView(box.r1, box.c1);
      }
      requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
    },
    [onEdit, data, rowCount, colCount, commitSelection, scrollCellIntoView],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusCell: (row, col, endRow = row, endCol = col, stealFocus = true) => {
        const r = Math.max(0, Math.min(rowCount - 1, row));
        const c = Math.max(0, Math.min(colCount - 1, col));
        const er = Math.max(0, Math.min(rowCount - 1, endRow));
        const ec = Math.max(0, Math.min(colCount - 1, endCol));
        const box = expandRectToMerges(data, { r1: r, c1: c, r2: er, c2: ec });
        const focusAnchor = mergeAt(data, r, c) || { r1: r, c1: c, r2: r, c2: c };
        commitSelection({
          rect: box,
          ranges: [box],
          focus: { row: focusAnchor.r1, col: focusAnchor.c1 },
          anchor: { row: focusAnchor.r1, col: focusAnchor.c1 },
        });
        scrollCellIntoView(focusAnchor.r1, focusAnchor.c1);
        if (stealFocus) {
          scrollRef.current?.focus({ preventScroll: true });
        }
      },
      selectAll: () => {
        const all = { r1: 0, c1: 0, r2: rowCount - 1, c2: colCount - 1 };
        commitSelection({ rect: all, ranges: [all], focus: selRef.current.focus, anchor: { row: 0, col: 0 } });
        scrollRef.current?.focus({ preventScroll: true });
      },
      editFocused: (seed) => {
        const f = selRef.current.focus;
        scrollCellIntoView(f.row, f.col);
        openEditor(f.row, f.col, seed);
      },
      hasFocus: () => {
        const active = document.activeElement;
        return Boolean(active && rootRef.current?.contains(active));
      },
    }),
    [rowCount, colCount, data, commitSelection, scrollCellIntoView, openEditor],
  );

  // Map client pointer coordinates into (row, col)
  const hitCellFromPoint = useCallback(
    (clientX: number, clientY: number): { row: number; col: number } => {
      const scroller = scrollRef.current;
      if (!scroller) return selRef.current.focus;
      const bounds = scroller.getBoundingClientRect();
      const relX = clientX - bounds.left;
      const relY = clientY - bounds.top;

      let col = 0;
      if (relX < ROW_HEADER_W + frozenColsWidth) {
        const x = Math.max(0, relX - ROW_HEADER_W);
        col = frozenCols > 0 ? Math.min(frozenCols - 1, findOffsetIndex(colOffsets, x)) : findOffsetIndex(colOffsets, scroller.scrollLeft);
      } else {
        const x = frozenColsWidth + scroller.scrollLeft + (relX - ROW_HEADER_W - frozenColsWidth);
        col = findOffsetIndex(colOffsets, x);
      }

      let visIdx = 0;
      if (relY < COL_HEADER_H + frozenRowsHeight) {
        const y = Math.max(0, relY - COL_HEADER_H);
        visIdx = frozenVisRows > 0 ? Math.min(frozenVisRows - 1, findOffsetIndex(visRowOffsets, y)) : findOffsetIndex(visRowOffsets, scroller.scrollTop);
      } else {
        const y = frozenRowsHeight + scroller.scrollTop + (relY - COL_HEADER_H - frozenRowsHeight);
        visIdx = findOffsetIndex(visRowOffsets, y);
      }
      const row = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, visIdx))] ?? 0;
      return { row, col: Math.max(0, Math.min(colCount - 1, col)) };
    },
    [frozenColsWidth, frozenCols, colOffsets, frozenRowsHeight, frozenVisRows, visRowOffsets, visibleRows, colCount],
  );

  // Pointer selection handlers (cells, column headers, row headers)
  const startCellMouseDown = (row: number, col: number, event: React.MouseEvent) => {
    if (event.button === 2) {
      // Right-click: preserve selection if inside an existing range, else select clicked cell
      const inside = selRef.current.ranges.some((r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2);
      if (!inside) {
        const box = mergeAt(data, row, col) || { r1: row, c1: col, r2: row, c2: col };
        commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
      }
      return;
    }
    if (event.button !== 0) return;

    // If editing a formula that expects a cell/range reference, insert A1 or A1:B5!
    const curEdit = editingRef.current;
    if (curEdit && formulaAcceptsReference(curEdit.text)) {
      event.preventDefault();
      const baseText = curEdit.text;
      const startRef = addressName(row, col);
      setEditing({ ...curEdit, text: `${baseText}${startRef}` });
      const onMove = (ev: MouseEvent) => {
        const hit = hitCellFromPoint(ev.clientX, ev.clientY);
        const refText = hit.row === row && hit.col === col
          ? addressName(row, col)
          : `${addressName(Math.min(row, hit.row), Math.min(col, hit.col))}:${addressName(Math.max(row, hit.row), Math.max(col, hit.col))}`;
        setEditing((prev) => (prev ? { ...prev, text: `${baseText}${refText}` } : prev));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        editorInputRef.current?.focus();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }

    if (curEdit) {
      if (curEdit.row === row && curEdit.col === col) return;
      finishEdit(true);
    }

    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });

    const clickedBox = mergeAt(data, row, col) || { r1: row, c1: col, r2: row, c2: col };
    const isMod = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const current = selRef.current;

    let baseRanges: Rect[] = [];
    let anchor = { row: clickedBox.r1, col: clickedBox.c1 };
    let focus = { row: clickedBox.r1, col: clickedBox.c1 };

    if (isShift) {
      baseRanges = current.ranges.slice(0, -1);
      anchor = current.anchor;
      focus = current.focus;
      const extended = expandRectToMerges(data, {
        r1: anchor.row,
        c1: anchor.col,
        r2: row > anchor.row ? clickedBox.r2 : clickedBox.r1,
        c2: col > anchor.col ? clickedBox.c2 : clickedBox.c1,
      });
      const nextRanges = [...baseRanges, extended];
      commitSelection({ rect: extended, ranges: nextRanges, focus, anchor });
    } else if (isMod) {
      const exactIdx = current.ranges.findIndex(
        (r) => r.r1 === clickedBox.r1 && r.c1 === clickedBox.c1 && r.r2 === clickedBox.r2 && r.c2 === clickedBox.c2,
      );
      if (exactIdx !== -1 && current.ranges.length > 1) {
        const remaining = current.ranges.filter((_, i) => i !== exactIdx);
        const last = remaining[remaining.length - 1];
        commitSelection({
          rect: last,
          ranges: remaining,
          focus: { row: last.r1, col: last.c1 },
          anchor: { row: last.r1, col: last.c1 },
        });
        return;
      }
      baseRanges = current.ranges;
      const nextRanges = [...baseRanges, clickedBox];
      commitSelection({ rect: clickedBox, ranges: nextRanges, focus, anchor });
    } else {
      baseRanges = [];
      commitSelection({ rect: clickedBox, ranges: [clickedBox], focus, anchor });
    }

    const onMove = (ev: MouseEvent) => {
      const hit = hitCellFromPoint(ev.clientX, ev.clientY);
      const hitBox = mergeAt(data, hit.row, hit.col) || { r1: hit.row, c1: hit.col, r2: hit.row, c2: hit.col };
      const dragged = expandRectToMerges(data, {
        r1: Math.min(anchor.row, hitBox.r1),
        c1: Math.min(anchor.col, hitBox.c1),
        r2: Math.max(anchor.row, hitBox.r2),
        c2: Math.max(anchor.col, hitBox.c2),
      });
      const prevPrimary = selRef.current.rect;
      if (
        dragged.r1 === prevPrimary.r1 &&
        dragged.c1 === prevPrimary.c1 &&
        dragged.r2 === prevPrimary.r2 &&
        dragged.c2 === prevPrimary.c2
      ) {
        return;
      }
      commitSelection({ rect: dragged, ranges: [...baseRanges, dragged], focus, anchor });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Column header click & drag -> selects entire column(s)
  const startColumnHeaderMouseDown = (col: number, event: React.MouseEvent) => {
    if (event.button === 2) {
      const colRect = { r1: 0, c1: col, r2: rowCount - 1, c2: col };
      const covered = selRef.current.ranges.some((r) => r.r1 === 0 && r.r2 === rowCount - 1 && col >= r.c1 && col <= r.c2);
      if (!covered) {
        commitSelection({ rect: colRect, ranges: [colRect], focus: { row: 0, col }, anchor: { row: 0, col } });
      }
      return;
    }
    if (event.button !== 0) return;
    if (editingRef.current) finishEdit(true);
    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });

    const current = selRef.current;
    const isMod = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const anchorCol = isShift ? current.anchor.col : col;
    const baseRanges = isShift ? current.ranges.slice(0, -1) : isMod ? current.ranges : [];

    if (isMod && !isShift && current.ranges.length > 1) {
      const exactIdx = current.ranges.findIndex((r) => r.r1 === 0 && r.r2 === rowCount - 1 && r.c1 === col && r.c2 === col);
      if (exactIdx !== -1) {
        const remaining = current.ranges.filter((_, i) => i !== exactIdx);
        const last = remaining[remaining.length - 1];
        commitSelection({ rect: last, ranges: remaining, focus: { row: last.r1, col: last.c1 }, anchor: { row: last.r1, col: last.c1 } });
        return;
      }
    }

    const initialRect: Rect = {
      r1: 0,
      c1: Math.min(anchorCol, col),
      r2: rowCount - 1,
      c2: Math.max(anchorCol, col),
    };
    const focus = { row: 0, col: anchorCol };
    const anchor = { row: 0, col: anchorCol };
    commitSelection({ rect: initialRect, ranges: [...baseRanges, initialRect], focus, anchor });

    const onMove = (ev: MouseEvent) => {
      const hit = hitCellFromPoint(ev.clientX, ev.clientY);
      const nextRect: Rect = {
        r1: 0,
        c1: Math.min(anchorCol, hit.col),
        r2: rowCount - 1,
        c2: Math.max(anchorCol, hit.col),
      };
      if (nextRect.c1 === selRef.current.rect.c1 && nextRect.c2 === selRef.current.rect.c2) return;
      commitSelection({ rect: nextRect, ranges: [...baseRanges, nextRect], focus, anchor });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Row header click & drag -> selects entire row(s)
  const startRowHeaderMouseDown = (row: number, event: React.MouseEvent) => {
    if (event.button === 2) {
      const rowRect = { r1: row, c1: 0, r2: row, c2: colCount - 1 };
      const covered = selRef.current.ranges.some((r) => r.c1 === 0 && r.c2 === colCount - 1 && row >= r.r1 && row <= r.r2);
      if (!covered) {
        commitSelection({ rect: rowRect, ranges: [rowRect], focus: { row, col: 0 }, anchor: { row, col: 0 } });
      }
      return;
    }
    if (event.button !== 0) return;
    if (editingRef.current) finishEdit(true);
    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });

    const current = selRef.current;
    const isMod = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const anchorRow = isShift ? current.anchor.row : row;
    const baseRanges = isShift ? current.ranges.slice(0, -1) : isMod ? current.ranges : [];

    if (isMod && !isShift && current.ranges.length > 1) {
      const exactIdx = current.ranges.findIndex((r) => r.c1 === 0 && r.c2 === colCount - 1 && r.r1 === row && r.r2 === row);
      if (exactIdx !== -1) {
        const remaining = current.ranges.filter((_, i) => i !== exactIdx);
        const last = remaining[remaining.length - 1];
        commitSelection({ rect: last, ranges: remaining, focus: { row: last.r1, col: last.c1 }, anchor: { row: last.r1, col: last.c1 } });
        return;
      }
    }

    const initialRect: Rect = {
      r1: Math.min(anchorRow, row),
      c1: 0,
      r2: Math.max(anchorRow, row),
      c2: colCount - 1,
    };
    const focus = { row: anchorRow, col: 0 };
    const anchor = { row: anchorRow, col: 0 };
    commitSelection({ rect: initialRect, ranges: [...baseRanges, initialRect], focus, anchor });

    const onMove = (ev: MouseEvent) => {
      const hit = hitCellFromPoint(ev.clientX, ev.clientY);
      const nextRect: Rect = {
        r1: Math.min(anchorRow, hit.row),
        c1: 0,
        r2: Math.max(anchorRow, hit.row),
        c2: colCount - 1,
      };
      if (nextRect.r1 === selRef.current.rect.r1 && nextRect.r2 === selRef.current.rect.r2) return;
      commitSelection({ rect: nextRect, ranges: [...baseRanges, nextRect], focus, anchor });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Column boundary drag resize + double-click auto-fit
  const startColumnResize = (col: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return;
    if (editingRef.current) finishEdit(true);
    const startX = event.clientX;
    const startWidth = data.colWidths[col] || COLUMN_WIDTH.default;
    const scroller = scrollRef.current;
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const computeGuideX = (width: number) => {
      if (!scroller || !rootBounds) return 0;
      const scaledW = Math.round(width * zoom);
      const colRight = col < frozenCols
        ? ROW_HEADER_W + colOffsets[col] + scaledW
        : ROW_HEADER_W + colOffsets[col] + scaledW - scroller.scrollLeft;
      return Math.max(ROW_HEADER_W, Math.min(rootBounds.width, colRight));
    };
    let latestWidth = startWidth;
    setResizeGuide({ axis: "col", index: col, pos: computeGuideX(startWidth), size: startWidth });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const raw = Math.round(startWidth + (ev.clientX - startX) / zoom);
      latestWidth = Math.max(COLUMN_WIDTH.min, Math.min(COLUMN_WIDTH.max, raw));
      setResizeGuide({ axis: "col", index: col, pos: computeGuideX(latestWidth), size: latestWidth });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizeGuide(null);
      if (latestWidth !== startWidth) onColumnResize(col, latestWidth);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const autoFitColumn = (col: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return;
    let maxChars = Math.max(3, columnName(col).length + 2);
    for (let r = 0; r < rowCount; r += 1) {
      const m = mergeAt(data, r, col);
      if (m && m.c2 > m.c1) continue;
      const cell = data.cells[`${r}:${col}`];
      if (!cell) continue;
      const text = formatCellValue(calc.value(sheetId, r, col), cell.s);
      if (text.length > maxChars) maxChars = text.length;
    }
    const nextWidth = Math.max(68, Math.min(420, Math.round(maxChars * 7.8 + 26)));
    onColumnResize(col, nextWidth);
  };

  // Row boundary drag resize + double-click auto-fit
  const startRowResize = (row: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return;
    if (editingRef.current) finishEdit(true);
    const startY = event.clientY;
    const startHeight = data.rowHeights[row] || ROW_HEIGHT.default;
    const scroller = scrollRef.current;
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const visIdx = rowToVisIndex[row];
    const computeGuideY = (height: number) => {
      if (!scroller || !rootBounds || visIdx < 0) return 0;
      const scaledH = Math.round(height * zoom);
      const rowBottom = visIdx < frozenVisRows
        ? COL_HEADER_H + visRowOffsets[visIdx] + scaledH
        : COL_HEADER_H + visRowOffsets[visIdx] + scaledH - scroller.scrollTop;
      return Math.max(COL_HEADER_H, Math.min(rootBounds.height, rowBottom));
    };
    let latestHeight = startHeight;
    setResizeGuide({ axis: "row", index: row, pos: computeGuideY(startHeight), size: startHeight });
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const raw = Math.round(startHeight + (ev.clientY - startY) / zoom);
      latestHeight = Math.max(ROW_HEIGHT.min, Math.min(ROW_HEIGHT.max, raw));
      setResizeGuide({ axis: "row", index: row, pos: computeGuideY(latestHeight), size: latestHeight });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizeGuide(null);
      if (latestHeight !== startHeight) onRowResize(row, latestHeight);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const autoFitRow = (row: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return;
    let lines = 1;
    let maxFs = DEFAULT_FONT_SIZE;
    for (let c = 0; c < colCount; c += 1) {
      const cell = data.cells[`${row}:${c}`];
      if (!cell) continue;
      const fs = cell.s?.fs || DEFAULT_FONT_SIZE;
      if (fs > maxFs) maxFs = fs;
      const shown = formatCellValue(calc.value(sheetId, row, c), cell.s);
      if (!shown) continue;
      if (cell.s?.w === "wrap") {
        const colW = Math.max(40, (data.colWidths[c] || COLUMN_WIDTH.default) - 16);
        const charsPerLine = Math.max(4, Math.floor(colW / (fs * 0.56)));
        const wrappedLines = shown
          .split("\n")
          .reduce((acc, part) => acc + Math.max(1, Math.ceil(part.length / charsPerLine)), 0);
        lines = Math.max(lines, wrappedLines);
      } else {
        lines = Math.max(lines, shown.split("\n").length);
      }
    }
    const lineH = Math.round(maxFs * 1.45);
    const nextHeight = Math.max(ROW_HEIGHT.default, Math.min(ROW_HEIGHT.max, lines * lineH + 10));
    onRowResize(row, nextHeight);
  };

  // Fill handle drag
  const startFillHandleDrag = (event: React.MouseEvent) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const source = normalizeRect(selRef.current.rect);
    let currentTarget: Rect | null = null;
    const onMove = (ev: MouseEvent) => {
      const hit = hitCellFromPoint(ev.clientX, ev.clientY);
      const dRow = hit.row < source.r1 ? source.r1 - hit.row : hit.row > source.r2 ? hit.row - source.r2 : 0;
      const dCol = hit.col < source.c1 ? source.c1 - hit.col : hit.col > source.c2 ? hit.col - source.c2 : 0;
      if (dRow === 0 && dCol === 0) {
        currentTarget = null;
        setFillTarget(null);
        return;
      }
      if (dRow >= dCol) {
        currentTarget = {
          r1: Math.min(source.r1, hit.row),
          c1: source.c1,
          r2: Math.max(source.r2, hit.row),
          c2: source.c2,
        };
      } else {
        currentTarget = {
          r1: source.r1,
          c1: Math.min(source.c1, hit.col),
          r2: source.r2,
          c2: Math.max(source.c2, hit.col),
        };
      }
      setFillTarget(currentTarget);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setFillTarget(null);
      if (currentTarget) {
        onFill(source, currentTarget);
        commitSelection({
          rect: currentTarget,
          ranges: [currentTarget],
          focus: selRef.current.focus,
          anchor: selRef.current.anchor,
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Grid keyboard navigation & editing triggers
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingRef.current) return;
    const mod = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const current = selRef.current;

    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const all = { r1: 0, c1: 0, r2: rowCount - 1, c2: colCount - 1 };
      commitSelection({ rect: all, ranges: [all], focus: current.focus, anchor: { row: 0, col: 0 } });
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (!readOnly) onClear();
      return;
    }

    if (event.key === "F2") {
      event.preventDefault();
      openEditor(current.focus.row, current.focus.col);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (!readOnly && !shift) {
        openEditor(current.focus.row, current.focus.col);
      } else {
        const m = mergeAt(data, current.focus.row, current.focus.col);
        const nextRow = Math.max(0, (m ? m.r1 : current.focus.row) - 1);
        const box = mergeAt(data, nextRow, current.focus.col) || { r1: nextRow, c1: current.focus.col, r2: nextRow, c2: current.focus.col };
        commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
        scrollCellIntoView(box.r1, box.c1);
      }
      return;
    }

    if (event.key === "Escape") {
      if (current.ranges.length > 1 || current.rect.r1 !== current.rect.r2 || current.rect.c1 !== current.rect.c2) {
        event.preventDefault();
        const box = mergeAt(data, current.focus.row, current.focus.col) || {
          r1: current.focus.row,
          c1: current.focus.col,
          r2: current.focus.row,
          c2: current.focus.col,
        };
        commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
      }
      return;
    }

    const moveDelta: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      Tab: [0, shift ? -1 : 1],
    };

    if (event.key in moveDelta) {
      event.preventDefault();
      const [dr, dc] = moveDelta[event.key];
      if (shift && event.key !== "Tab") {
        // Extend primary selection from anchor
        const p = current.rect;
        const movingBottom = current.anchor.row <= p.r1 && p.r2 >= current.anchor.row ? (dr > 0 || p.r2 > current.anchor.row) : false;
        const edgeRow = dr !== 0 ? (movingBottom ? p.r2 : p.r1) : p.r2;
        const movingRight = current.anchor.col <= p.c1 && p.c2 >= current.anchor.col ? (dc > 0 || p.c2 > current.anchor.col) : false;
        const edgeCol = dc !== 0 ? (movingRight ? p.c2 : p.c1) : p.c2;
        const nextR = mod
          ? (dr > 0 ? rowCount - 1 : dr < 0 ? 0 : edgeRow)
          : Math.max(0, Math.min(rowCount - 1, edgeRow + dr));
        const nextC = mod
          ? (dc > 0 ? colCount - 1 : dc < 0 ? 0 : edgeCol)
          : Math.max(0, Math.min(colCount - 1, edgeCol + dc));
        const nextBox = expandRectToMerges(data, {
          r1: Math.min(current.anchor.row, nextR),
          c1: Math.min(current.anchor.col, nextC),
          r2: Math.max(current.anchor.row, nextR),
          c2: Math.max(current.anchor.col, nextC),
        });
        const base = current.ranges.slice(0, -1);
        commitSelection({ rect: nextBox, ranges: [...base, nextBox], focus: current.focus, anchor: current.anchor });
        scrollCellIntoView(nextR, nextC);
        return;
      }

      const curMerge = mergeAt(data, current.focus.row, current.focus.col);
      let nextRow = current.focus.row;
      let nextCol = current.focus.col;
      if (dr > 0) nextRow = mod ? rowCount - 1 : Math.min(rowCount - 1, (curMerge ? curMerge.r2 : current.focus.row) + 1);
      else if (dr < 0) nextRow = mod ? 0 : Math.max(0, (curMerge ? curMerge.r1 : current.focus.row) - 1);
      if (dc > 0) nextCol = mod ? colCount - 1 : Math.min(colCount - 1, (curMerge ? curMerge.c2 : current.focus.col) + 1);
      else if (dc < 0) nextCol = mod ? 0 : Math.max(0, (curMerge ? curMerge.c1 : current.focus.col) - 1);

      // Skip hidden filtered rows
      if (dr !== 0 && hiddenRows.size > 0) {
        while (nextRow >= frozenRows && nextRow < rowCount - 1 && nextRow > 0 && hiddenRows.has(nextRow)) {
          nextRow += dr > 0 ? 1 : -1;
        }
      }

      const destMerge = mergeAt(data, nextRow, nextCol);
      const box = destMerge || { r1: nextRow, c1: nextCol, r2: nextRow, c2: nextCol };
      commitSelection({
        rect: box,
        ranges: [box],
        focus: { row: box.r1, col: box.c1 },
        anchor: { row: box.r1, col: box.c1 },
      });
      scrollCellIntoView(box.r1, box.c1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const targetRow = mod ? 0 : current.focus.row;
      const box = mergeAt(data, targetRow, 0) || { r1: targetRow, c1: 0, r2: targetRow, c2: 0 };
      commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
      scrollCellIntoView(box.r1, box.c1);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const targetRow = mod ? rowCount - 1 : current.focus.row;
      const targetCol = colCount - 1;
      const box = mergeAt(data, targetRow, targetCol) || { r1: targetRow, c1: targetCol, r2: targetRow, c2: targetCol };
      commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
      scrollCellIntoView(box.r1, box.c1);
      return;
    }

    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const step = event.key === "PageDown" ? 20 : -20;
      const targetRow = Math.max(0, Math.min(rowCount - 1, current.focus.row + step));
      const box = mergeAt(data, targetRow, current.focus.col) || {
        r1: targetRow,
        c1: current.focus.col,
        r2: targetRow,
        c2: current.focus.col,
      };
      commitSelection({ rect: box, ranges: [box], focus: { row: box.r1, col: box.c1 }, anchor: { row: box.r1, col: box.c1 } });
      scrollCellIntoView(box.r1, box.c1);
      return;
    }

    // Start typing directly into focused cell
    if (!mod && !event.altKey && event.key.length === 1 && !readOnly) {
      event.preventDefault();
      openEditor(current.focus.row, current.focus.col, event.key);
    }
  };

  // Virtualized visible window indices
  const scrollableHeight = Math.max(0, viewport.height - COL_HEADER_H - frozenRowsHeight);
  const scrollableWidth = Math.max(0, viewport.width - ROW_HEADER_W - frozenColsWidth);

  const visRowStart = useMemo(() => {
    if (visibleRows.length <= frozenVisRows) return frozenVisRows;
    const raw = findOffsetIndex(visRowOffsets, frozenRowsHeight + viewport.scrollTop);
    return Math.max(frozenVisRows, raw - ROW_OVERSCAN);
  }, [visibleRows.length, frozenVisRows, visRowOffsets, frozenRowsHeight, viewport.scrollTop]);

  const visRowEnd = useMemo(() => {
    if (visibleRows.length <= frozenVisRows) return frozenVisRows - 1;
    const raw = findOffsetIndex(visRowOffsets, frozenRowsHeight + viewport.scrollTop + scrollableHeight);
    return Math.min(visibleRows.length - 1, raw + ROW_OVERSCAN);
  }, [visibleRows.length, frozenVisRows, visRowOffsets, frozenRowsHeight, viewport.scrollTop, scrollableHeight]);

  const colStart = useMemo(() => {
    if (colCount <= frozenCols) return frozenCols;
    const raw = findOffsetIndex(colOffsets, frozenColsWidth + viewport.scrollLeft);
    return Math.max(frozenCols, raw - COL_OVERSCAN);
  }, [colCount, frozenCols, colOffsets, frozenColsWidth, viewport.scrollLeft]);

  const colEnd = useMemo(() => {
    if (colCount <= frozenCols) return frozenCols - 1;
    const raw = findOffsetIndex(colOffsets, frozenColsWidth + viewport.scrollLeft + scrollableWidth);
    return Math.min(colCount - 1, raw + COL_OVERSCAN);
  }, [colCount, frozenCols, colOffsets, frozenColsWidth, viewport.scrollLeft, scrollableWidth]);

  // Quick lookup helpers for header highlight states
  const colHighlightState = useCallback(
    (col: number): "none" | "partial" | "full" => {
      let state: "none" | "partial" | "full" = "none";
      for (const r of sel.ranges) {
        if (col < r.c1 || col > r.c2) continue;
        if (r.r1 === 0 && r.r2 === rowCount - 1) return "full";
        state = "partial";
      }
      return state;
    },
    [sel.ranges, rowCount],
  );

  const rowHighlightState = useCallback(
    (row: number): "none" | "partial" | "full" => {
      let state: "none" | "partial" | "full" = "none";
      for (const r of sel.ranges) {
        if (row < r.r1 || row > r.r2) continue;
        if (r.c1 === 0 && r.c2 === colCount - 1) return "full";
        state = "partial";
      }
      return state;
    },
    [sel.ranges, colCount],
  );

  const isAllSelected =
    sel.ranges.length === 1 &&
    sel.rect.r1 === 0 &&
    sel.rect.c1 === 0 &&
    sel.rect.r2 === rowCount - 1 &&
    sel.rect.c2 === colCount - 1;

  // Compute physical pixel rectangle of any cell range inside a given quadrant
  const rectBoundsInQuadrant = (
    rect: Rect,
    quad: "tl" | "tr" | "bl" | "br",
  ): { left: number; top: number; width: number; height: number; clipTop: boolean; clipBottom: boolean; clipLeft: boolean; clipRight: boolean } | null => {
    const minRow = quad === "tl" || quad === "tr" ? 0 : frozenRows;
    const maxRow = quad === "tl" || quad === "tr" ? frozenRows - 1 : rowCount - 1;
    const minCol = quad === "tl" || quad === "bl" ? 0 : frozenCols;
    const maxCol = quad === "tl" || quad === "bl" ? frozenCols - 1 : colCount - 1;
    if (minRow > maxRow || minCol > maxCol) return null;

    const r1 = Math.max(minRow, rect.r1);
    const r2 = Math.min(maxRow, rect.r2);
    const c1 = Math.max(minCol, rect.c1);
    const c2 = Math.min(maxCol, rect.c2);
    if (r1 > r2 || c1 > c2) return null;

    // Find first and last visible rows in [r1..r2]
    let firstVis = -1;
    let lastVis = -1;
    for (let r = r1; r <= r2; r += 1) {
      const vi = rowToVisIndex[r];
      if (vi >= 0) {
        if (firstVis === -1) firstVis = vi;
        lastVis = vi;
      }
    }
    if (firstVis === -1 || lastVis === -1) return null;

    const originX = quad === "tl" || quad === "bl" ? -ROW_HEADER_W : frozenColsWidth;
    const originY = quad === "tl" || quad === "tr" ? -COL_HEADER_H : frozenRowsHeight;

    const left = colOffsets[c1] - originX;
    const right = colOffsets[c2 + 1] - originX;
    const top = visRowOffsets[firstVis] - originY;
    const bottom = visRowOffsets[lastVis + 1] - originY;

    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
      clipTop: rect.r1 < minRow,
      clipBottom: rect.r2 > maxRow,
      clipLeft: rect.c1 < minCol,
      clipRight: rect.c2 > maxCol,
    };
  };

  // Render cells + selection overlays + inline editor for a quadrant
  const renderQuadrantCells = (
    quad: "tl" | "tr" | "bl" | "br",
    visStart: number,
    visEnd: number,
    cStart: number,
    cEnd: number,
  ) => {
    if (visStart > visEnd || cStart > cEnd) return null;
    const originX = quad === "tl" || quad === "bl" ? -ROW_HEADER_W : frozenColsWidth;
    const originY = quad === "tl" || quad === "tr" ? -COL_HEADER_H : frozenRowsHeight;
    const quadMinRow = quad === "tl" || quad === "tr" ? 0 : frozenRows;
    const quadMaxRow = quad === "tl" || quad === "tr" ? frozenRows - 1 : rowCount - 1;
    const quadMinCol = quad === "tl" || quad === "bl" ? 0 : frozenCols;
    const quadMaxCol = quad === "tl" || quad === "bl" ? frozenCols - 1 : colCount - 1;

    const elements: React.ReactNode[] = [];
    const renderedMerges = new Set<string>();

    const pushCellNode = (row: number, col: number, merge: MergeRect | null) => {
      const r1 = merge ? Math.max(quadMinRow, merge.r1) : row;
      const r2 = merge ? Math.min(quadMaxRow, merge.r2) : row;
      const c1 = merge ? Math.max(quadMinCol, merge.c1) : col;
      const c2 = merge ? Math.min(quadMaxCol, merge.c2) : col;

      let firstVis = -1;
      let lastVis = -1;
      for (let rr = r1; rr <= r2; rr += 1) {
        const vi = rowToVisIndex[rr];
        if (vi >= 0) {
          if (firstVis === -1) firstVis = vi;
          lastVis = vi;
        }
      }
      if (firstVis === -1 || lastVis === -1) return;

      const left = colOffsets[c1] - originX;
      const top = visRowOffsets[firstVis] - originY;
      const width = colOffsets[c2 + 1] - colOffsets[c1];
      const height = visRowOffsets[lastVis + 1] - visRowOffsets[firstVis];

      const anchorRow = merge ? merge.r1 : row;
      const anchorCol = merge ? merge.c1 : col;
      const cell: SheetCell | undefined = data.cells[`${anchorRow}:${anchorCol}`];
      const comment = data.comments?.[`${anchorRow}:${anchorCol}`];
      const computed = cell ? calc.value(sheetId, anchorRow, anchorCol) : null;
      const isErr = isFormulaError(computed);
      const isNum = typeof computed === "number";
      const shown = cell ? formatCellValue(computed, cell.s) : "";
      const wrapMode = cell?.s?.w;
      const styleCss = cellInlineStyle(cell?.s, isNum, isErr, zoom);
      if (merge) {
        const rightStyle = data.cells[`${merge.r1}:${merge.c2}`]?.s;
        if (!styleCss.borderRight && rightStyle?.bd?.includes("r")) {
          styleCss.borderRight = borderSpecCss(rightStyle.bs, rightStyle.bc);
          styleCss.zIndex = 2;
        }
        const bottomStyle = data.cells[`${merge.r2}:${merge.c1}`]?.s;
        if (!styleCss.borderBottom && bottomStyle?.bd?.includes("b")) {
          styleCss.borderBottom = borderSpecCss(bottomStyle.bs, bottomStyle.bc);
          styleCss.zIndex = 2;
        }
      }

      elements.push(
        <div
          key={`c-${anchorRow}:${anchorCol}`}
          role="gridcell"
          aria-colindex={anchorCol + 1}
          aria-rowindex={anchorRow + 1}
          data-cell={`${anchorRow}:${anchorCol}`}
          data-address={addressName(anchorRow, anchorCol)}
          data-merged={merge ? `${merge.r1}:${merge.c1}:${merge.r2}:${merge.c2}` : undefined}
          data-has-comment={comment ? "true" : undefined}
          className={[
            "tb-sgrid-cell",
            merge ? "is-merged" : "",
            isErr ? "is-error" : "",
            isNum ? "is-num" : "",
            comment ? "has-comment" : "",
            searchMatchKeys?.has(`${anchorRow}:${anchorCol}`) ? "is-search-match" : "",
            activeMatchKey === `${anchorRow}:${anchorCol}` ? "is-search-active" : "",
            wrapMode === "wrap" ? "is-wrap" : wrapMode === "clip" ? "is-clip" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            left,
            top,
            width,
            height,
            ...styleCss,
          }}
          title={
            isErr
              ? `${computed.error} — ${computed.message}`
              : comment
                ? `Comment (${comment.author}): ${comment.text}`
                : undefined
          }
          onMouseDown={(ev) => startCellMouseDown(anchorRow, anchorCol, ev)}
          onDoubleClick={() => openEditor(anchorRow, anchorCol)}
          onContextMenu={(ev) => {
            startCellMouseDown(anchorRow, anchorCol, ev);
            onContextAction?.({ kind: "cell", row: anchorRow, col: anchorCol, clientX: ev.clientX, clientY: ev.clientY });
          }}
        >
          {shown && <span className="tb-sgrid-cell-text">{shown}</span>}
          {comment && (
            <button
              type="button"
              className="tb-sgrid-comment-indicator"
              data-comment-indicator={`${anchorRow}:${anchorCol}`}
              aria-label={`Comment on ${addressName(anchorRow, anchorCol)} by ${comment.author}`}
              title={`${comment.author}: ${comment.text}`}
              onMouseDown={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
              }}
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onOpenComment?.(anchorRow, anchorCol, ev.currentTarget.getBoundingClientRect());
              }}
            />
          )}
        </div>,
      );
    };

    // First ensure any merged cell intersecting the visible window is rendered even if its anchor scrolled off
    if (merges.length > 0) {
      const winR1 = visibleRows[visStart];
      const winR2 = visibleRows[visEnd];
      const winRect: Rect = { r1: winR1, c1: cStart, r2: winR2, c2: cEnd };
      for (const m of merges) {
        if (!rectsOverlap(m, winRect)) continue;
        if (m.r2 < quadMinRow || m.r1 > quadMaxRow || m.c2 < quadMinCol || m.c1 > quadMaxCol) continue;
        const mKey = `${m.r1}:${m.c1}`;
        renderedMerges.add(mKey);
        pushCellNode(m.r1, m.c1, m);
      }
    }

    for (let vi = visStart; vi <= visEnd; vi += 1) {
      const row = visibleRows[vi];
      for (let col = cStart; col <= cEnd; col += 1) {
        const m = merges.length ? mergeAt(data, row, col) : null;
        if (m) {
          const mKey = `${m.r1}:${m.c1}`;
          if (!renderedMerges.has(mKey)) {
            renderedMerges.add(mKey);
            pushCellNode(m.r1, m.c1, m);
          }
          continue;
        }
        pushCellNode(row, col, null);
      }
    }

    // Selection range overlays (supports multiple ranges via Ctrl/Cmd!)
    sel.ranges.forEach((range, idx) => {
      const bounds = rectBoundsInQuadrant(range, quad);
      if (!bounds) return;
      const isPrimary = idx === sel.ranges.length - 1;
      const isSingleCell =
        range.r1 === sel.focus.row &&
        range.c1 === sel.focus.col &&
        (() => {
          const fm = mergeAt(data, sel.focus.row, sel.focus.col);
          const fBox = fm || { r1: sel.focus.row, c1: sel.focus.col, r2: sel.focus.row, c2: sel.focus.col };
          return range.r1 === fBox.r1 && range.c1 === fBox.c1 && range.r2 === fBox.r2 && range.c2 === fBox.c2;
        })();

      elements.push(
        <div
          key={`sel-${idx}`}
          aria-hidden="true"
          className={[
            "tb-sgrid-sel-range",
            isSingleCell && sel.ranges.length === 1 ? "is-single" : "is-multi",
            isPrimary ? "is-primary" : "is-secondary",
            bounds.clipTop ? "clip-top" : "",
            bounds.clipBottom ? "clip-bottom" : "",
            bounds.clipLeft ? "clip-left" : "",
            bounds.clipRight ? "clip-right" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          }}
        >
          {isPrimary && !readOnly && !editing && !bounds.clipBottom && !bounds.clipRight && (
            <div
              className="tb-sgrid-fill-handle"
              data-fill-handle="true"
              onMouseDown={startFillHandleDrag}
              title="Drag to fill series or formulas"
            />
          )}
        </div>,
      );
    });

    // Active focus cell crisp indicator when inside a multi-cell range
    const focusMerge = mergeAt(data, sel.focus.row, sel.focus.col);
    const focusBox = focusMerge || { r1: sel.focus.row, c1: sel.focus.col, r2: sel.focus.row, c2: sel.focus.col };
    const focusBounds = rectBoundsInQuadrant(focusBox, quad);
    if (focusBounds) {
      elements.push(
        <div
          key="focus-indicator"
          aria-hidden="true"
          data-active-cell={addressName(sel.focus.row, sel.focus.col)}
          className="tb-sgrid-active-cell"
          style={{
            left: focusBounds.left,
            top: focusBounds.top,
            width: focusBounds.width,
            height: focusBounds.height,
          }}
        />,
      );
    }

    // Fill preview dashed rectangle
    if (fillTarget) {
      const fillBounds = rectBoundsInQuadrant(fillTarget, quad);
      if (fillBounds) {
        elements.push(
          <div
            key="fill-preview"
            aria-hidden="true"
            className="tb-sgrid-fill-preview"
            style={{
              left: fillBounds.left,
              top: fillBounds.top,
              width: fillBounds.width,
              height: fillBounds.height,
            }}
          />,
        );
      }
    }

    // Inline cell editor inside the quadrant owning (editing.row, editing.col)
    if (editing) {
      const ownerQuad: "tl" | "tr" | "bl" | "br" =
        editing.row < frozenRows
          ? editing.col < frozenCols
            ? "tl"
            : "tr"
          : editing.col < frozenCols
            ? "bl"
            : "br";
      if (ownerQuad === quad) {
        const editMerge = mergeAt(data, editing.row, editing.col);
        const editBox = editMerge || { r1: editing.row, c1: editing.col, r2: editing.row, c2: editing.col };
        const editBounds = rectBoundsInQuadrant(editBox, quad);
        if (editBounds) {
          const editCell = data.cells[`${editing.row}:${editing.col}`];
          const s = editCell?.s || {};
          elements.push(
            <div
              key="inline-editor"
              className="tb-sgrid-editor-wrap"
              style={{
                left: editBounds.left,
                top: editBounds.top,
                minWidth: Math.max(editBounds.width, 140),
                minHeight: editBounds.height,
              }}
            >
              <input
                ref={editorInputRef}
                type="text"
                className="tb-sgrid-editor-input"
                aria-label={`Edit ${addressName(editing.row, editing.col)}`}
                value={editing.text}
                maxLength={TABLE_LIMITS.cellText}
                spellCheck={false}
                style={{
                  fontFamily: s.ff ? fontStackOf(s.ff) : undefined,
                  fontSize: s.fs ? `${s.fs}px` : undefined,
                  fontWeight: s.b ? 600 : undefined,
                  fontStyle: s.i ? "italic" : undefined,
                }}
                onChange={(ev) => setEditing((prev) => (prev ? { ...prev, text: ev.target.value } : prev))}
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    finishEdit(true, ev.shiftKey ? "up" : "down");
                  } else if (ev.key === "Tab") {
                    ev.preventDefault();
                    finishEdit(true, ev.shiftKey ? "left" : "right");
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    finishEdit(false);
                  }
                }}
                onBlur={(ev) => {
                  // Ignore blur if clicking another cell to insert formula reference
                  if (editingRef.current && formulaAcceptsReference(editingRef.current.text) && rootRef.current?.contains(ev.relatedTarget as Node)) {
                    return;
                  }
                  finishEdit(true);
                }}
              />
            </div>,
          );
        }
      }
    }

    return elements;
  };

  const renderColumnHeader = (col: number, leftOffset: number) => {
    const width = colOffsets[col + 1] - colOffsets[col];
    const label = columnName(col);
    const hl = colHighlightState(col);
    return (
      <div
        key={`ch-${col}`}
        role="columnheader"
        aria-colindex={col + 1}
        aria-selected={hl === "full"}
        data-col-header={label}
        data-col-index={col}
        className={[
          "tb-sgrid-col-header",
          hl === "full" ? "is-full-selected" : hl === "partial" ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ left: leftOffset, width, height: COL_HEADER_H }}
        title={`Select column ${label}`}
        onMouseDown={(ev) => startColumnHeaderMouseDown(col, ev)}
        onContextMenu={(ev) => {
          startColumnHeaderMouseDown(col, ev);
          onContextAction?.({ kind: "col", row: 0, col, clientX: ev.clientX, clientY: ev.clientY });
        }}
      >
        <span className="tb-sgrid-header-label">{label}</span>
        {!readOnly && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize column ${label}`}
            data-col-resizer={col}
            className="tb-col-resizer"
            onMouseDown={(ev) => startColumnResize(col, ev)}
            onDoubleClick={(ev) => autoFitColumn(col, ev)}
          />
        )}
      </div>
    );
  };

  const renderRowHeader = (visIdx: number, topOffset: number) => {
    const row = visibleRows[visIdx];
    const height = visRowOffsets[visIdx + 1] - visRowOffsets[visIdx];
    const hl = rowHighlightState(row);
    return (
      <div
        key={`rh-${row}`}
        role="rowheader"
        aria-rowindex={row + 1}
        aria-selected={hl === "full"}
        data-row-header={row + 1}
        data-row-index={row}
        className={[
          "tb-sgrid-row-header",
          hl === "full" ? "is-full-selected" : hl === "partial" ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ top: topOffset, width: ROW_HEADER_W, height }}
        title={`Select row ${row + 1}`}
        onMouseDown={(ev) => startRowHeaderMouseDown(row, ev)}
        onContextMenu={(ev) => {
          startRowHeaderMouseDown(row, ev);
          onContextAction?.({ kind: "row", row, col: 0, clientX: ev.clientX, clientY: ev.clientY });
        }}
      >
        <span className="tb-sgrid-header-label">{row + 1}</span>
        {!readOnly && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize row ${row + 1}`}
            data-row-resizer={row}
            className="tb-row-resizer"
            onMouseDown={(ev) => startRowResize(row, ev)}
            onDoubleClick={(ev) => autoFitRow(row, ev)}
          />
        )}
      </div>
    );
  };

  const showExtendStrip = Boolean(!readOnly && onExtendGrid && (rowCount < TABLE_LIMITS.rows || colCount < TABLE_LIMITS.cols));
  const extendStripH = showExtendStrip ? 44 : 0;

  return (
    <div
      ref={rootRef}
      data-zoom={Math.round(zoom * 100)}
      style={{ "--tb-grid-zoom": String(zoom), fontSize: `${Math.round(DEFAULT_FONT_SIZE * zoom * 10) / 10}px` } as React.CSSProperties}
      className={`tb-grid tb-sgrid-root ${data.hideGridlines ? "is-gridlines-hidden" : ""}`}
    >
      <div
        ref={scrollRef}
        className="tb-sgrid-scroll"
        role="grid"
        aria-label="Spreadsheet grid"
        aria-rowcount={rowCount}
        aria-colcount={colCount}
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onScroll={(ev) => {
          const el = ev.currentTarget;
          setViewport((prev) =>
            prev.scrollTop === el.scrollTop && prev.scrollLeft === el.scrollLeft
              ? prev
              : { ...prev, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft },
          );
        }}
      >
        <div
          className="tb-sgrid-canvas"
          style={{
            width: ROW_HEADER_W + totalColsWidth,
            height: COL_HEADER_H + totalRowsHeight + extendStripH,
          }}
        >
          {/* Sticky Top Band: Column Headers + Frozen Rows */}
          <div
            className={`tb-sgrid-top-band ${frozenRows > 0 ? "has-frozen-rows" : ""}`}
            style={{
              height: COL_HEADER_H + frozenRowsHeight,
              width: ROW_HEADER_W + totalColsWidth,
            }}
          >
            {/* Top-Left Pinned Intersection */}
            <div
              className={`tb-sgrid-top-left ${frozenCols > 0 ? "has-frozen-cols" : ""}`}
              style={{
                width: ROW_HEADER_W + frozenColsWidth,
                height: COL_HEADER_H + frozenRowsHeight,
              }}
            >
              <button
                type="button"
                className={`tb-sgrid-corner ${isAllSelected ? "is-selected" : ""}`}
                style={{ width: ROW_HEADER_W, height: COL_HEADER_H }}
                aria-label="Select entire sheet"
                title="Select entire sheet (Ctrl+A)"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  if (editingRef.current) finishEdit(true);
                  const all = { r1: 0, c1: 0, r2: rowCount - 1, c2: colCount - 1 };
                  commitSelection({ rect: all, ranges: [all], focus: selRef.current.focus, anchor: { row: 0, col: 0 } });
                  scrollRef.current?.focus({ preventScroll: true });
                }}
              >
                <span className="tb-sgrid-corner-glyph" aria-hidden="true" />
              </button>

              {Array.from({ length: frozenCols }, (_, c) => renderColumnHeader(c, ROW_HEADER_W + colOffsets[c]))}
              {Array.from({ length: frozenVisRows }, (_, vi) => renderRowHeader(vi, COL_HEADER_H + visRowOffsets[vi]))}
              {frozenVisRows > 0 && frozenCols > 0 && renderQuadrantCells("tl", 0, frozenVisRows - 1, 0, frozenCols - 1)}
            </div>

            {/* Top-Right Horizontally Scrollable Column Headers + Frozen Rows */}
            <div
              className="tb-sgrid-top-right"
              style={{
                width: Math.max(0, totalColsWidth - frozenColsWidth),
                height: COL_HEADER_H + frozenRowsHeight,
              }}
            >
              {Array.from({ length: Math.max(0, colEnd - colStart + 1) }, (_, idx) => {
                const c = colStart + idx;
                return renderColumnHeader(c, colOffsets[c] - frozenColsWidth);
              })}
              {frozenVisRows > 0 && renderQuadrantCells("tr", 0, frozenVisRows - 1, colStart, colEnd)}
            </div>
          </div>

          {/* Main Body Band: Row Headers + Frozen Columns + Virtualized Cells */}
          <div
            className="tb-sgrid-body-band"
            style={{
              width: ROW_HEADER_W + totalColsWidth,
              height: Math.max(0, totalRowsHeight - frozenRowsHeight),
            }}
          >
            {/* Bottom-Left Sticky Row Headers + Frozen Columns */}
            <div
              className={`tb-sgrid-body-left ${frozenCols > 0 ? "has-frozen-cols" : ""}`}
              style={{
                width: ROW_HEADER_W + frozenColsWidth,
                height: Math.max(0, totalRowsHeight - frozenRowsHeight),
              }}
            >
              {Array.from({ length: Math.max(0, visRowEnd - visRowStart + 1) }, (_, idx) => {
                const vi = visRowStart + idx;
                return renderRowHeader(vi, visRowOffsets[vi] - frozenRowsHeight);
              })}
              {frozenCols > 0 && renderQuadrantCells("bl", visRowStart, visRowEnd, 0, frozenCols - 1)}
            </div>

            {/* Bottom-Right Main Cell Viewport */}
            <div
              className="tb-sgrid-body-main"
              style={{
                width: Math.max(0, totalColsWidth - frozenColsWidth),
                height: Math.max(0, totalRowsHeight - frozenRowsHeight),
              }}
            >
              {renderQuadrantCells("br", visRowStart, visRowEnd, colStart, colEnd)}
              {overlaySlot}
            </div>
          </div>

          {showExtendStrip && onExtendGrid && (
            <div className="tb-sgrid-extend-strip" style={{ paddingLeft: ROW_HEADER_W + 12 }}>
              <span className="tb-sgrid-extend-label">
                Sheet size: <b>{rowCount.toLocaleString()} × {colCount}</b>
              </span>
              {rowCount < TABLE_LIMITS.rows && (
                <>
                  <button type="button" className="tb-secondary-button tb-sgrid-extend-btn" onClick={() => onExtendGrid(25, 0)}>
                    +25 rows
                  </button>
                  <button type="button" className="tb-secondary-button tb-sgrid-extend-btn" onClick={() => onExtendGrid(100, 0)}>
                    +100 rows
                  </button>
                </>
              )}
              {colCount < TABLE_LIMITS.cols && (
                <>
                  <button type="button" className="tb-secondary-button tb-sgrid-extend-btn" onClick={() => onExtendGrid(0, 10)}>
                    +10 columns
                  </button>
                  <button type="button" className="tb-secondary-button tb-sgrid-extend-btn" onClick={() => onExtendGrid(0, 26)}>
                    +26 columns
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Live drag-resize guide line + dimension badge */}
      {resizeGuide && (
        <div
          aria-hidden="true"
          className={`tb-sgrid-resize-guide is-${resizeGuide.axis}`}
          style={resizeGuide.axis === "col" ? { left: resizeGuide.pos } : { top: resizeGuide.pos }}
        >
          <span className="tb-sgrid-resize-badge">
            {resizeGuide.axis === "col" ? `${columnName(resizeGuide.index)} · ${resizeGuide.size}px` : `Row ${resizeGuide.index + 1} · ${resizeGuide.size}px`}
          </span>
        </div>
      )}
    </div>
  );
});
