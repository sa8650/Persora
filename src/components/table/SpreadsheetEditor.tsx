// Persora Table — spreadsheet editor: collapsible formatting ribbon, formula bar,
// virtualized 200×52+ grid, multi-range selection, merges, freeze panes, sheet tabs,
// find, sort, temporary filter, context menu, and selection summary.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ, ArrowDownZA, ArrowUpDown, BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardPaste, Copy,
  Download, Eraser, Filter, MessageSquarePlus, MoreHorizontal, Pencil, Plus, Printer, Redo2, Rows3, Scissors, Search, Snowflake, TableCellsMerge,
  TableCellsSplit, Trash2, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  SUPPORTED_FUNCTIONS, WorkbookCalculator, addressName, columnName, isFormulaError, type CalculatorSource, type CellResult,
} from "../../../cloudflare/table-formula.js";
import {
  COLUMN_WIDTH, DEFAULT_BORDER_COLOR, DEFAULT_SHEET_SIZE, ROW_HEIGHT, TABLE_LIMITS, TableValidationError, cellEditText,
  formatCellValue, validateSheetName, valuesSummary,
  type BorderLineStyle, type BorderMode, type Sheet, type SheetChart, type SheetChartType, type SheetData, type Workbook,
} from "../../../cloudflare/table-rules.js";
import {
  addSheet, addSheetChart, applyStyleToRanges, cellFromInput, clearRange, clearRanges, deleteCellComment, deleteColumns, deleteRows, deleteSheet,
  deleteSheetChart, duplicateSheet, ensureSize, extendSheetDimensions, extractRange, fillRange, formulaCellsOf, insertColumns, insertRows, mergeCells,
  mergesInRect, moveSheet, normalizeRect, parseClipboardText, pasteBlock, renameSheet, resizeColumn, resizeRow,
  setCellComment, setCells, setGridlinesHidden, sortRows, toTsv, unmergeCells, updateSheetChart, type CopiedBlock, type Rect,
} from "../../../cloudflare/table-sheet-ops.js";
import { sheetCsvRows, workbookXlsxSheets } from "../../../cloudflare/table-io.js";
import { exportCsv, exportXlsx, safeDownloadName } from "../../lib/table/table-files";
import { DocHistory } from "../../lib/table/table-history";
import type { TableDoc } from "../../lib/table/table-sync";
import { ConfirmDialog } from "../VaultDialogs";
import ModalPortal from "../ModalPortal";
import type { Commit } from "./TableEditor";
import FormatToolbar, { type StylePatch } from "./FormatToolbar";
import ExportDialog from "./ExportDialog";
import { SheetChartLayer, SheetChartModal } from "./SheetCharts";
import SheetGrid, { clampGridZoom, type GridSelection, type SheetGridContextRequest, type SheetGridHandle } from "./SheetGrid";
import { Menu, PromptDialog, newId, plural } from "./table-ui";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/design-system";

type SpreadsheetDoc = Extract<TableDoc, { kind: "spreadsheet" }>;
const REBUILD_THRESHOLD = 4000;
const SUMMARY_CELL_LIMIT = 100_000;
const RIBBON_PREF_KEY = "persora.table.ribbonHidden";

const scalarForClipboard = (value: CellResult) =>
  isFormulaError(value) ? value.error : value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value;

export default function SpreadsheetEditor({
  doc,
  tableName,
  commit: externalCommit,
  readOnly,
  notify,
  authorName = "Persora Member",
  canUndo: externalCanUndo,
  canRedo: externalCanRedo,
  onUndo: externalUndo,
  onRedo: externalRedo,
  onRenameTable,
  onDuplicateTable,
  onDeleteTable,
  onCloseTable,
  allowComment = false,
  askCommentAuthor = false,
  onSaveCellComment,
}: {
  doc: SpreadsheetDoc;
  tableName: string;
  commit: Commit;
  readOnly: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  authorName?: string;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onRenameTable?: () => void;
  onDuplicateTable?: () => void;
  onDeleteTable?: () => void;
  onCloseTable?: () => void;
  allowComment?: boolean;
  askCommentAuthor?: boolean;
  onSaveCellComment?: (args: { sheetId: string; row: number; col: number; text: string; authorName?: string }) => Promise<void>;
}) {
  // Local fallback undo/redo stack when SpreadsheetEditor is mounted outside TableEditor
  const localHistoryRef = useRef(new DocHistory<SpreadsheetDoc>(100));
  const [, setLocalHistoryTick] = useState(0);
  const docLatestRef = useRef(doc);
  docLatestRef.current = doc;

  const commit = useCallback<Commit>(
    (next, label) => {
      if (!externalUndo && next.kind === "spreadsheet") {
        localHistoryRef.current.push(docLatestRef.current, label);
        setLocalHistoryTick((t) => t + 1);
      }
      externalCommit(next, label);
    },
    [externalCommit, externalUndo],
  );

  const canUndo = externalUndo ? Boolean(externalCanUndo) : localHistoryRef.current.canUndo;
  const canRedo = externalRedo ? Boolean(externalCanRedo) : localHistoryRef.current.canRedo;

  const triggerUndo = useCallback(() => {
    if (readOnly) return;
    if (externalUndo) {
      externalUndo();
      return;
    }
    const prev = localHistoryRef.current.undo(docLatestRef.current);
    if (prev) {
      setLocalHistoryTick((t) => t + 1);
      externalCommit(prev.doc, `Undo ${prev.label}`);
    }
  }, [readOnly, externalUndo, externalCommit]);

  const triggerRedo = useCallback(() => {
    if (readOnly) return;
    if (externalRedo) {
      externalRedo();
      return;
    }
    const next = localHistoryRef.current.redo(docLatestRef.current);
    if (next) {
      setLocalHistoryTick((t) => t + 1);
      externalCommit(next.doc, `Redo ${next.label}`);
    }
  }, [readOnly, externalRedo, externalCommit]);
  const sheets = doc.sheets;
  const [activeId, setActiveId] = useState(sheets[0]?.id);
  const active = sheets.find((sheet) => sheet.id === activeId) || sheets[0];

  // Ensure working spreadsheet always offers at least 200 rows × 52 columns (A..AZ)
  // without mutating untouched saved revisions on load.
  const data = useMemo<SheetData>(() => {
    const raw = active.data;
    if (raw.rowCount >= DEFAULT_SHEET_SIZE.rows && raw.colCount >= DEFAULT_SHEET_SIZE.cols) return raw;
    return {
      ...raw,
      rowCount: Math.max(raw.rowCount, DEFAULT_SHEET_SIZE.rows),
      colCount: Math.max(raw.colCount, DEFAULT_SHEET_SIZE.cols),
    };
  }, [active.data]);

  const frozen = Math.min(data.frozenRows || 0, Math.max(0, data.rowCount - 1));
  const frozenCols = Math.min(data.frozenCols || 0, Math.max(0, data.colCount - 1));

  const gridRef = useRef<SheetGridHandle>(null);
  const [sel, setSel] = useState<GridSelection>({
    rect: { r1: 0, c1: 0, r2: 0, c2: 0 },
    ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }],
    focus: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
  });
  const [barText, setBarText] = useState("");
  const [barDirty, setBarDirty] = useState(false);
  const [liveDraft, setLiveDraft] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [ribbonHidden, setRibbonHidden] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(RIBBON_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [borderStyle, setBorderStyle] = useState<BorderLineStyle>("thin");
  const [borderColor, setBorderColor] = useState<string>(DEFAULT_BORDER_COLOR);

  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState("");
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [filters, setFilters] = useState<Record<string, { col: number; text: string }>>({});
  const [filterPrompt, setFilterPrompt] = useState(false);
  const [renameSheetId, setRenameSheetId] = useState<string | null>(null);
  const [deleteSheetId, setDeleteSheetId] = useState<string | null>(null);
  const [rowHeightPrompt, setRowHeightPrompt] = useState(false);
  const [colWidthPrompt, setColWidthPrompt] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [contextTarget, setContextTarget] = useState<SheetGridContextRequest | null>(null);
  const [gridZoom, setGridZoom] = useState<number>(1);
  const [formulaBarHidden, setFormulaBarHidden] = useState(false);
  const [chartModal, setChartModal] = useState<{ chart: SheetChart | null; presetType?: SheetChartType } | null>(null);
  const [commentDialog, setCommentDialog] = useState<{
    row: number;
    col: number;
    editing: boolean;
    draft: string;
    guestAuthor: string;
    saving?: boolean;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const canCommentCells = !readOnly || Boolean(allowComment);

  const clipRef = useRef<{ text: string; block: CopiedBlock } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sheets.some((sheet) => sheet.id === activeId)) setActiveId(sheets[0]?.id);
  }, [sheets, activeId]);

  const toggleRibbon = useCallback(() => {
    setRibbonHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RIBBON_PREF_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage errors in restricted contexts
      }
      return next;
    });
  }, []);

  // ---- formulas: one calculator for the workbook, updated per changed cell ------------------
  const sheetsRef = useRef(sheets);
  const byIdRef = useRef<{ list: Sheet[]; map: Map<string, Sheet> }>({ list: [], map: new Map() });
  const byId = (id: string) => {
    if (byIdRef.current.list !== sheetsRef.current) {
      byIdRef.current = { list: sheetsRef.current, map: new Map(sheetsRef.current.map((sheet) => [sheet.id, sheet])) };
    }
    return byIdRef.current.map.get(id);
  };
  const source = useMemo<CalculatorSource>(
    () => ({
      sheets: () =>
        sheetsRef.current.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          rows: Math.max(sheet.data.rowCount, DEFAULT_SHEET_SIZE.rows),
          cols: Math.max(sheet.data.colCount, DEFAULT_SHEET_SIZE.cols),
        })),
      cell: (id, row, col) => byId(id)?.data.cells[`${row}:${col}`],
      formulaCells: (id) => {
        const sheet = byId(id);
        return sheet ? formulaCellsOf(sheet.data) : [];
      },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
    const structural =
      previous.length !== sheets.length ||
      previous.some((sheet, index) => {
        const next = sheets[index];
        return (
          sheet.id !== next.id ||
          sheet.name !== next.name ||
          sheet.data.rowCount !== next.data.rowCount ||
          sheet.data.colCount !== next.data.colCount
        );
      });
    if (structural) {
      calcRef.current.rebuild();
      return { version: versionRef.current, rowsBySheet: null };
    }
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
    if (total > REBUILD_THRESHOLD) {
      calcRef.current.rebuild();
      return { version: versionRef.current, rowsBySheet: null };
    }
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
  const changedRows = useMemo(
    () => (sheetSwitched || !change.rowsBySheet ? null : [...(change.rowsBySheet.get(active.id) || [])]),
    [change, active.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const valueAt = useCallback((row: number, col: number) => calc.value(active.id, row, col), [calc, active.id, change]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- formula bar follows the focused cell -----------------------------------------------------
  const focusCell = data.cells[`${sel.focus.row}:${sel.focus.col}`];
  const focusValue = focusCell ? calc.value(active.id, sel.focus.row, sel.focus.col) : null;
  useEffect(() => {
    if (!barDirty) setBarText(cellEditText(focusCell));
  }, [focusCell, sel.focus.row, sel.focus.col, active.id, barDirty]);

  // ---- committing --------------------------------------------------------------------------------
  const run = useCallback(
    <T,>(fn: () => T): T | null => {
      try {
        return fn();
      } catch (error) {
        notify(error instanceof TableValidationError || error instanceof Error ? error.message : "That change couldn't be made.", "error");
        return null;
      }
    },
    [notify],
  );

  const applySheet = useCallback(
    (label: string, fn: (sheetData: SheetData) => SheetData) => {
      if (readOnly) return false;
      const base = ensureSize(active.data, DEFAULT_SHEET_SIZE.rows, DEFAULT_SHEET_SIZE.cols);
      const next = run(() => fn(base));
      if (!next || next === active.data) return false;
      commit({ kind: "spreadsheet", sheets: sheets.map((sheet) => (sheet.id === active.id ? { ...sheet, data: next } : sheet)) }, label);
      return true;
    },
    [readOnly, run, active, sheets, commit],
  );

  const applyWorkbook = useCallback(
    (label: string, fn: (workbook: Workbook) => Workbook) => {
      if (readOnly) return false;
      const expandedSheets = sheets.map((sheet) =>
        sheet.id === active.id
          ? { ...sheet, data: ensureSize(sheet.data, DEFAULT_SHEET_SIZE.rows, DEFAULT_SHEET_SIZE.cols) }
          : sheet,
      );
      const next = run(() => fn({ sheets: expandedSheets }));
      if (!next || next.sheets === sheets) return false;
      commit({ kind: "spreadsheet", sheets: next.sheets }, label);
      return true;
    },
    [readOnly, run, sheets, active.id, commit],
  );

  const rect = normalizeRect(sel.rect);
  const selectedRanges: Rect[] = sel.ranges?.length ? sel.ranges.map(normalizeRect) : [rect];

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
    const next =
      move === "down"
        ? { row: Math.min(sel.focus.row + 1, data.rowCount - 1), col: sel.focus.col }
        : move === "right"
          ? { row: sel.focus.row, col: Math.min(sel.focus.col + 1, data.colCount - 1) }
          : sel.focus;
    requestAnimationFrame(() => gridRef.current?.focusCell(next.row, next.col));
  };

  const clearSelection = useCallback(() => {
    applySheet(
      selectedRanges.length === 1 && rect.r1 === rect.r2 && rect.c1 === rect.c2
        ? `Clear ${addressName(rect.r1, rect.c1)}`
        : "Clear contents",
      (sheetData) => clearRanges(sheetData, selectedRanges, "contents"),
    );
  }, [applySheet, selectedRanges, rect]);

  const style = useCallback(
    (patch: StylePatch, label: string) => {
      applySheet(label, (sheetData) => applyStyleToRanges(sheetData, selectedRanges, patch));
    },
    [applySheet, selectedRanges],
  );

  const applyBorders = useCallback(
    (mode: BorderMode, overrideOpts?: { style?: BorderLineStyle; color?: string }) => {
      const bs = overrideOpts?.style ?? borderStyle;
      const bc = overrideOpts?.color ?? borderColor;
      applySheet(mode === "none" ? "Clear borders" : "Borders", (sheetData) =>
        applyStyleToRanges(sheetData, selectedRanges, null, mode, { style: bs, color: bc }),
      );
    },
    [applySheet, selectedRanges, borderStyle, borderColor],
  );

  const handleBorderPenChange = useCallback(
    (next: { style?: BorderLineStyle; color?: string }) => {
      const nextStyle = next.style ?? borderStyle;
      const nextColor = next.color ?? borderColor;
      if (next.style) setBorderStyle(next.style);
      if (next.color) setBorderColor(next.color);

      // If any cell in the current selection already has borders, update its border style/color immediately!
      let hasExistingBorders = false;
      for (const r of selectedRanges) {
        for (let row = r.r1; row <= r.r2 && !hasExistingBorders; row += 1) {
          for (let col = r.c1; col <= r.c2; col += 1) {
            if (data.cells[`${row}:${col}`]?.s?.bd) {
              hasExistingBorders = true;
              break;
            }
          }
        }
      }
      if (hasExistingBorders) {
        applySheet("Update border style", (sheetData) =>
          applyStyleToRanges(sheetData, selectedRanges, {
            bs: nextStyle === "thin" ? null : nextStyle,
            bc: nextColor.toUpperCase() === DEFAULT_BORDER_COLOR ? null : nextColor,
          }),
        );
      }
    },
    [borderStyle, borderColor, selectedRanges, data.cells, applySheet],
  );

  // Merge state for current selection
  const mergesOverSelection = useMemo(() => mergesInRect(data, rect), [data, rect]);
  const hasMerged = mergesOverSelection.length > 0;
  const canMerge = rect.r2 > rect.r1 || rect.c2 > rect.c1;
  const canMergeHoriz = rect.c2 > rect.c1;
  const canMergeVert = rect.r2 > rect.r1;

  const handleMerge = useCallback(
    (mode: "all" | "horizontal" | "vertical") => {
      if (applySheet("Merge cells", (sheetData) => mergeCells(sheetData, rect, mode))) {
        requestAnimationFrame(() => gridRef.current?.focusCell(rect.r1, rect.c1, rect.r2, rect.c2));
      }
    },
    [applySheet, rect],
  );

  const handleUnmerge = useCallback(() => {
    applySheet("Unmerge cells", (sheetData) => unmergeCells(sheetData, rect));
  }, [applySheet, rect]);

  // ---- clipboard (copy, cut, paste — both keyboard events & toolbar/menu triggers) ----------------
  const buildClipboardPayload = useCallback(() => {
    const block = extractRange(data, rect);
    const lines: unknown[][] = [];
    block.values = [];
    for (let row = rect.r1; row <= rect.r2; row += 1) {
      const line: unknown[] = [];
      const values: CellResult[] = [];
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        const value = calc.value(active.id, row, col);
        values.push(value);
        line.push(scalarForClipboard(value));
      }
      lines.push(line);
      block.values.push(values);
    }
    const text = toTsv(lines);
    clipRef.current = { text, block };
    return text;
  }, [data, rect, calc, active.id]);

  const triggerCopy = useCallback(
    async (cut: boolean) => {
      const text = buildClipboardPayload();
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        // Internal clipboard still works even if browser denies async clipboard write
      }
      if (cut && !readOnly) {
        applySheet("Cut", (sheetData) => clearRange(sheetData, rect, "all"));
      }
    },
    [buildClipboardPayload, readOnly, applySheet, rect],
  );

  const triggerPasteFromText = useCallback(
    (text: string, valuesOnly = false) => {
      if (readOnly || !text) return;
      const internal = clipRef.current && clipRef.current.text === text
        ? (valuesOnly ? { ...clipRef.current.block, mode: "values" as const } : clipRef.current.block)
        : null;
      const lines = internal ? null : parseClipboardText(text);
      const rows = internal ? internal.rows : lines!.length;
      const cols = internal ? internal.cols : Math.max(1, ...lines!.map((line) => line.length));
      if (rows * cols > TABLE_LIMITS.cellsPerSheet) {
        notify("That's too much to paste at once.", "error");
        return;
      }
      const at = { row: rect.r1, col: rect.c1 };
      if (applySheet(valuesOnly ? "Paste values" : "Paste", (sheetData) => pasteBlock(sheetData, at, internal || { text: lines! }))) {
        requestAnimationFrame(() => gridRef.current?.focusCell(at.row, at.col, at.row + rows - 1, at.col + cols - 1));
      }
    },
    [readOnly, notify, rect.r1, rect.c1, applySheet],
  );

  const triggerPasteButton = useCallback(async (valuesOnly = false) => {
    if (readOnly) return;
    try {
      const sysText = await navigator.clipboard?.readText();
      if (sysText) {
        triggerPasteFromText(sysText, valuesOnly);
        return;
      }
    } catch {
      // Fallback to in-app copied block
    }
    if (clipRef.current) {
      triggerPasteFromText(clipRef.current.text, valuesOnly);
    } else {
      notify("Use Ctrl+V (or Cmd+V) to paste from your system clipboard.");
    }
  }, [readOnly, triggerPasteFromText, notify]);

  useEffect(() => {
    const copy = (event: ClipboardEvent, cut: boolean) => {
      if (!gridRef.current?.hasFocus() || !event.clipboardData) return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;
      event.preventDefault();
      const text = buildClipboardPayload();
      event.clipboardData.setData("text/plain", text);
      if (cut && !readOnly) applySheet("Cut", (sheetData) => clearRange(sheetData, rect, "all"));
    };
    const onCopy = (event: ClipboardEvent) => copy(event, false);
    const onCut = (event: ClipboardEvent) => copy(event, true);
    const onPaste = (event: ClipboardEvent) => {
      if (!gridRef.current?.hasFocus() || !event.clipboardData) return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      if (text) triggerPasteFromText(text);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [buildClipboardPayload, readOnly, applySheet, rect, triggerPasteFromText]);

  // ---- rows, columns, sheets ----------------------------------------------------------------------------
  const rowsSelected = rect.r2 - rect.r1 + 1;
  const colsSelected = rect.c2 - rect.c1 + 1;
  const lastUsedRow = useMemo(() => {
    let last = -1;
    for (const key of Object.keys(data.cells)) {
      const row = Number(key.slice(0, key.indexOf(":")));
      if (row > last && (data.cells[key].v !== undefined || data.cells[key].f !== undefined)) last = row;
    }
    return last;
  }, [data.cells]);

  const sortBy = (dir: "asc" | "desc") => {
    const col = sel.focus.col;
    const multi = rect.r2 > rect.r1;
    const r1 = multi ? Math.max(rect.r1, frozen) : frozen;
    const r2 = multi ? rect.r2 : lastUsedRow;
    if (r2 <= r1) {
      notify("There's nothing to sort below the header.", "error");
      return;
    }
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
      const row = Number(key.slice(0, sep));
      const col = Number(key.slice(sep + 1));
      const shown = formatCellValue(calc.value(active.id, row, col), cell.s).toLocaleLowerCase();
      if (shown.includes(query) || cellEditText(cell).toLocaleLowerCase().includes(query)) list.push([row, col]);
    }
    return list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }, [findQuery, data.cells, calc, active.id, change]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchMatchKeys = useMemo(
    () => new Set(matches.map(([r, c]) => `${r}:${c}`)),
    [matches],
  );

  const clampedFindIndex = matches.length
    ? Math.max(0, Math.min(findIndex < 0 ? 0 : findIndex, matches.length - 1))
    : -1;
  const activeMatchKey =
    clampedFindIndex >= 0 && matches[clampedFindIndex]
      ? `${matches[clampedFindIndex][0]}:${matches[clampedFindIndex][1]}`
      : null;

  const focusSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }, []);

  const goToMatch = (step: number, stealFocus = false) => {
    if (!matches.length) return;
    const base = clampedFindIndex < 0 ? 0 : clampedFindIndex;
    const index = (((base + step) % matches.length) + matches.length) % matches.length;
    setFindIndex(index);
    gridRef.current?.focusCell(matches[index][0], matches[index][1], matches[index][0], matches[index][1], stealFocus);
  };

  useEffect(() => {
    if (!findQuery.trim()) {
      setFindIndex(0);
      return;
    }
    setFindIndex(0);
    if (matches.length > 0) {
      gridRef.current?.focusCell(matches[0][0], matches[0][1], matches[0][0], matches[0][1], false);
    }
  }, [findQuery, active.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceCurrentMatch = () => {
    if (readOnly || !findQuery.trim() || clampedFindIndex < 0 || !matches[clampedFindIndex]) return;
    const [row, col] = matches[clampedFindIndex];
    const cell = data.cells[`${row}:${col}`];
    if (!cell || cell.f !== undefined) {
      notify("Formula cells aren't replaced automatically.", "error");
      return;
    }
    const raw = cellEditText(cell);
    const escaped = findQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    const updated = regex.test(raw) ? raw.replace(regex, replaceText) : replaceText;
    applySheet("Replace cell text", (sheetData) => setCells(sheetData, [[row, col, cellFromInput(updated, cell)]]));
  };

  const replaceAllMatches = () => {
    if (readOnly || !findQuery.trim() || !matches.length) return;
    const escaped = findQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    const edits: Array<[number, number, ReturnType<typeof cellFromInput>]> = [];
    for (const [row, col] of matches) {
      const cell = data.cells[`${row}:${col}`];
      if (!cell || cell.f !== undefined) continue;
      const raw = cellEditText(cell);
      if (regex.test(raw)) {
        regex.lastIndex = 0;
        const nextText = raw.replace(regex, replaceText);
        edits.push([row, col, cellFromInput(nextText, cell)]);
      }
    }
    if (!edits.length) {
      notify("No non-formula text matches to replace.", "error");
      return;
    }
    applySheet(`Replace ${edits.length} matches`, (sheetData) => setCells(sheetData, edits));
    notify(`Replaced in ${plural(edits.length, "cell")}.`, "success");
  };

  // ---- selection summary (across all selected ranges) ----------------------------------------------------
  const summary = useMemo(() => {
    let totalCount = 0;
    for (const r of selectedRanges) totalCount += (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    if (totalCount < 2 || totalCount > SUMMARY_CELL_LIMIT) return null;
    const values: CellResult[] = [];
    const visited = selectedRanges.length > 1 ? new Set<string>() : null;
    for (const r of selectedRanges) {
      for (let row = r.r1; row <= r.r2; row += 1) {
        if (hiddenRows.has(row)) continue;
        for (let col = r.c1; col <= r.c2; col += 1) {
          if (visited) {
            const k = `${row}:${col}`;
            if (visited.has(k)) continue;
            visited.add(k);
          }
          values.push(calc.value(active.id, row, col));
        }
      }
    }
    return valuesSummary(values);
  }, [selectedRanges, calc, active.id, change, hiddenRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCommentForCell = useCallback(
    (row: number, col: number, anchorRect?: DOMRect) => {
      const existing = data.comments?.[`${row}:${col}`];
      if (!existing && !canCommentCells) return;
      const cx = anchorRect ? Math.min(anchorRect.left, window.innerWidth - 340) : Math.max(24, Math.round(window.innerWidth / 2 - 160));
      const cy = anchorRect ? Math.min(anchorRect.bottom + 8, window.innerHeight - 280) : Math.max(80, Math.round(window.innerHeight / 2 - 130));
      setCommentDialog({
        row,
        col,
        editing: !existing && canCommentCells,
        draft: existing?.text || "",
        guestAuthor: authorName === "Guest commenter" ? "" : authorName,
        anchorX: Math.max(12, cx),
        anchorY: Math.max(12, cy),
      });
    },
    [data.comments, canCommentCells, authorName],
  );

  const extendGrid = useCallback(
    (addRows: number, addCols: number) => {
      applySheet(
        addRows > 0 ? `Add ${addRows} rows` : `Add ${addCols} columns`,
        (sheetData) => extendSheetDimensions(sheetData, addRows, addCols),
      );
    },
    [applySheet],
  );

  // ---- keyboard shortcuts ----------------------------------------------------------------------------------------
  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const inGrid = gridRef.current?.hasFocus();
    const key = event.key.toLowerCase();
    if (mod && event.shiftKey && key === "f") {
      event.preventDefault();
      toggleRibbon();
      return;
    }
    if (mod && key === "f") {
      event.preventDefault();
      focusSearchInput();
      return;
    }
    if (mod && event.altKey && key === "m") {
      event.preventDefault();
      openCommentForCell(sel.focus.row, sel.focus.col);
      return;
    }
    if (mod && !externalUndo && !event.altKey) {
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        triggerUndo();
        return;
      }
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        triggerRedo();
        return;
      }
    }
    if (mod && event.shiftKey && key === "v" && inGrid) {
      event.preventDefault();
      void triggerPasteButton(true);
      return;
    }
    if (event.altKey && event.shiftKey && event.key === "5" && inGrid) {
      event.preventDefault();
      style({ st: focusCell?.s?.st ? null : 1 }, "Strikethrough");
      return;
    }
    if (!inGrid) return;
    if (mod && key === "b") {
      event.preventDefault();
      style({ b: focusCell?.s?.b ? null : 1 }, "Bold");
    } else if (mod && key === "i") {
      event.preventDefault();
      style({ i: focusCell?.s?.i ? null : 1 }, "Italic");
    } else if (mod && key === "u") {
      event.preventDefault();
      style({ u: focusCell?.s?.u ? null : 1 }, "Underline");
    } else if (event.key === "F2") {
      event.preventDefault();
      gridRef.current?.editFocused();
    }
  };

  const exportFile = async (format: "csv" | "xlsx") => {
    if (format === "csv") {
      await exportCsv(sheetCsvRows(active, valueAt), safeDownloadName(sheets.length > 1 ? `${tableName} - ${active.name}` : tableName, "csv"));
    } else {
      await exportXlsx(workbookXlsxSheets(sheets), safeDownloadName(tableName, "xlsx"));
    }
  };

  const sheetMenu = (sheet: Sheet, index: number) => (
    <Menu
      label={`Sheet options for ${sheet.name}`}
      icon={<MoreHorizontal size={13} />}
      buttonClassName="tb-tab-menu"
      side="top"
      items={[
        { id: "rename", label: "Rename", icon: <Pencil size={14} />, disabled: readOnly, onSelect: () => setRenameSheetId(sheet.id) },
        {
          id: "duplicate",
          label: "Duplicate",
          icon: <Copy size={14} />,
          disabled: readOnly || sheets.length >= TABLE_LIMITS.sheets,
          onSelect: () => {
            const id = newId();
            if (applyWorkbook(`Duplicate ${sheet.name}`, (workbook) => duplicateSheet(workbook, sheet.id, id))) setActiveId(id);
          },
        },
        {
          id: "left",
          label: "Move left",
          icon: <ChevronLeft size={14} />,
          disabled: readOnly || index === 0,
          onSelect: () => applyWorkbook(`Move ${sheet.name}`, (workbook) => moveSheet(workbook, sheet.id, index - 1)),
        },
        {
          id: "right",
          label: "Move right",
          icon: <ChevronRight size={14} />,
          disabled: readOnly || index === sheets.length - 1,
          onSelect: () => applyWorkbook(`Move ${sheet.name}`, (workbook) => moveSheet(workbook, sheet.id, index + 1)),
        },
        "divider",
        {
          id: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: readOnly || sheets.length <= 1,
          onSelect: () => setDeleteSheetId(sheet.id),
        },
      ]}
    />
  );

  const primaryAddress =
    rowsSelected * colsSelected > 1
      ? `${addressName(rect.r1, rect.c1)}:${addressName(rect.r2, rect.c2)}`
      : addressName(sel.focus.row, sel.focus.col);
  const address = selectedRanges.length > 1 ? `${primaryAddress} (+${selectedRanges.length - 1})` : primaryAddress;
  const shownBarText = liveDraft !== null ? liveDraft : barText;
  const focusComment = data.comments?.[`${sel.focus.row}:${sel.focus.col}`];
  const activeComment = commentDialog ? data.comments?.[`${commentDialog.row}:${commentDialog.col}`] : undefined;

  return (
    <div className={`tb-sheet-editor ${ribbonHidden ? "is-ribbon-hidden" : ""}`} onKeyDown={onKeyDown}>
      {/* ReUI Menubar — Persora Design System spreadsheet command bar */}
      <nav className="tb-menubar" aria-label="Spreadsheet menu bar">
        <Menubar className="tb-reui-menubar">
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarLabel>Workbook</MenubarLabel>
                {onRenameTable && (
                  <MenubarItem disabled={readOnly} onClick={onRenameTable}>
                    <Pencil size={14} /> Rename table…
                  </MenubarItem>
                )}
                {onDuplicateTable && (
                  <MenubarItem onClick={onDuplicateTable}>
                    <Copy size={14} /> Make a copy
                  </MenubarItem>
                )}
                <MenubarItem
                  disabled={readOnly || sheets.length >= TABLE_LIMITS.sheets}
                  onClick={() => {
                    const id = newId();
                    if (applyWorkbook("Add sheet", (workbook) => addSheet(workbook, null, id))) setActiveId(id);
                  }}
                >
                  <Plus size={14} /> New sheet
                </MenubarItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarGroup>
                <MenubarLabel>Export</MenubarLabel>
                <MenubarItem onClick={() => void exportFile("csv")}>
                  <Download size={14} /> Download CSV (.csv)
                </MenubarItem>
                <MenubarItem onClick={() => void exportFile("xlsx")}>
                  <Download size={14} /> Download Excel (.xlsx)
                </MenubarItem>
                <MenubarItem onClick={() => setExportOpen(true)}>
                  Export options…
                </MenubarItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarItem onClick={() => window.print()}>
                <Printer size={14} /> Print
                <MenubarShortcut>Ctrl+P</MenubarShortcut>
              </MenubarItem>
              {onDeleteTable && (
                <>
                  <MenubarSeparator />
                  <MenubarItem variant="destructive" onClick={onDeleteTable}>
                    <Trash2 size={14} /> Move to Trash
                  </MenubarItem>
                </>
              )}
              {onCloseTable && (
                <>
                  <MenubarSeparator />
                  <MenubarItem onClick={onCloseTable}>
                    Back to all tables
                  </MenubarItem>
                </>
              )}
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>Edit</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarItem disabled={readOnly || !canUndo} onClick={triggerUndo}>
                  <Undo2 size={14} /> Undo
                  <MenubarShortcut>Ctrl+Z</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={readOnly || !canRedo} onClick={triggerRedo}>
                  <Redo2 size={14} /> Redo
                  <MenubarShortcut>Ctrl+Y</MenubarShortcut>
                </MenubarItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarGroup>
                <MenubarItem disabled={readOnly} onClick={() => void triggerCopy(true)}>
                  <Scissors size={14} /> Cut
                  <MenubarShortcut>Ctrl+X</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => void triggerCopy(false)}>
                  <Copy size={14} /> Copy
                  <MenubarShortcut>Ctrl+C</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={readOnly} onClick={() => void triggerPasteButton(false)}>
                  <ClipboardPaste size={14} /> Paste
                  <MenubarShortcut>Ctrl+V</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={readOnly} onClick={() => void triggerPasteButton(true)}>
                  Paste values only
                  <MenubarShortcut>Ctrl+Shift+V</MenubarShortcut>
                </MenubarItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarGroup>
                <MenubarItem disabled={readOnly} onClick={clearSelection}>
                  <Eraser size={14} /> Clear contents
                  <MenubarShortcut>Del</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={readOnly} onClick={() => applySheet("Clear formatting", (sheetData) => clearRanges(sheetData, selectedRanges, "formats"))}>
                  Clear formatting
                </MenubarItem>
                <MenubarItem disabled={readOnly} onClick={() => applySheet("Clear all", (sheetData) => clearRanges(sheetData, selectedRanges, "all"))}>
                  Clear contents &amp; formatting
                </MenubarItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarGroup>
                <MenubarItem onClick={() => gridRef.current?.selectAll()}>
                  Select all
                  <MenubarShortcut>Ctrl+A</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={focusSearchInput}>
                  <Search size={14} /> Find in sheet…
                  <MenubarShortcut>Ctrl+F</MenubarShortcut>
                </MenubarItem>
              </MenubarGroup>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>Insert</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarLabel>Rows &amp; Columns</MenubarLabel>
                <MenubarItem disabled={readOnly || data.rowCount >= TABLE_LIMITS.rows} onClick={() => applyWorkbook("Insert row", (workbook) => insertRows(workbook, active.id, rect.r1, 1))}>
                  Row above
                </MenubarItem>
                <MenubarItem disabled={readOnly || data.rowCount + rowsSelected > TABLE_LIMITS.rows} onClick={() => applyWorkbook("Insert rows", (workbook) => insertRows(workbook, active.id, rect.r2 + 1, rowsSelected))}>
                  {rowsSelected > 1 ? `${rowsSelected} rows below` : "Row below"}
                </MenubarItem>
                <MenubarItem disabled={readOnly || data.colCount >= TABLE_LIMITS.cols} onClick={() => applyWorkbook("Insert column", (workbook) => insertColumns(workbook, active.id, rect.c1, 1))}>
                  Column left
                </MenubarItem>
                <MenubarItem disabled={readOnly || data.colCount + colsSelected > TABLE_LIMITS.cols} onClick={() => applyWorkbook("Insert columns", (workbook) => insertColumns(workbook, active.id, rect.c2 + 1, colsSelected))}>
                  {colsSelected > 1 ? `${colsSelected} columns right` : "Column right"}
                </MenubarItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>
                  <BarChart3 size={14} /> Chart
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem disabled={readOnly} onClick={() => setChartModal({ chart: null })}>
                    Configure chart…
                  </MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem disabled={readOnly} onClick={() => setChartModal({ chart: null, presetType: "bar" })}>
                    Bar chart from selection
                  </MenubarItem>
                  <MenubarItem disabled={readOnly} onClick={() => setChartModal({ chart: null, presetType: "line" })}>
                    Line chart from selection
                  </MenubarItem>
                  <MenubarItem disabled={readOnly} onClick={() => setChartModal({ chart: null, presetType: "pie" })}>
                    Pie chart from selection
                  </MenubarItem>
                  <MenubarItem disabled={readOnly} onClick={() => setChartModal({ chart: null, presetType: "doughnut" })}>
                    Doughnut chart from selection
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarItem disabled={!canCommentCells && !focusComment} onClick={() => openCommentForCell(sel.focus.row, sel.focus.col)}>
                <MessageSquarePlus size={14} /> {focusComment ? (canCommentCells ? "Edit cell comment…" : "View cell comment…") : "Comment…"}
                <MenubarShortcut>Ctrl+Alt+M</MenubarShortcut>
              </MenubarItem>
              <MenubarItem
                disabled={readOnly || sheets.length >= TABLE_LIMITS.sheets}
                onClick={() => {
                  const id = newId();
                  if (applyWorkbook("Add sheet", (workbook) => addSheet(workbook, null, id))) setActiveId(id);
                }}
              >
                <Plus size={14} /> New sheet
              </MenubarItem>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>Extend capacity</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem disabled={readOnly || data.rowCount >= TABLE_LIMITS.rows} onClick={() => extendGrid(25, 0)}>+25 rows</MenubarItem>
                  <MenubarItem disabled={readOnly || data.rowCount >= TABLE_LIMITS.rows} onClick={() => extendGrid(100, 0)}>+100 rows</MenubarItem>
                  <MenubarSeparator />
                  <MenubarItem disabled={readOnly || data.colCount >= TABLE_LIMITS.cols} onClick={() => extendGrid(0, 10)}>+10 columns</MenubarItem>
                  <MenubarItem disabled={readOnly || data.colCount >= TABLE_LIMITS.cols} onClick={() => extendGrid(0, 26)}>+26 columns</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>Format</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarCheckboxItem checked={Boolean(focusCell?.s?.b)} disabled={readOnly} onClick={() => style({ b: focusCell?.s?.b ? null : 1 }, "Bold")}>
                  Bold <MenubarShortcut>Ctrl+B</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={Boolean(focusCell?.s?.i)} disabled={readOnly} onClick={() => style({ i: focusCell?.s?.i ? null : 1 }, "Italic")}>
                  Italic <MenubarShortcut>Ctrl+I</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={Boolean(focusCell?.s?.u)} disabled={readOnly} onClick={() => style({ u: focusCell?.s?.u ? null : 1 }, "Underline")}>
                  Underline <MenubarShortcut>Ctrl+U</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={Boolean(focusCell?.s?.st)} disabled={readOnly} onClick={() => style({ st: focusCell?.s?.st ? null : 1 }, "Strikethrough")}>
                  Strikethrough <MenubarShortcut>Alt+Shift+5</MenubarShortcut>
                </MenubarCheckboxItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>Alignment</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarCheckboxItem checked={focusCell?.s?.a === "l"} disabled={readOnly} onClick={() => style({ a: "l" }, "Align left")}>Align left</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.a === "c"} disabled={readOnly} onClick={() => style({ a: "c" }, "Align center")}>Align center</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.a === "r"} disabled={readOnly} onClick={() => style({ a: "r" }, "Align right")}>Align right</MenubarCheckboxItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>Text wrapping</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarCheckboxItem checked={!focusCell?.s?.w} disabled={readOnly} onClick={() => style({ w: null }, "Overflow text")}>Overflow</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.w === "wrap"} disabled={readOnly} onClick={() => style({ w: "wrap" }, "Wrap text")}>Wrap</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.w === "clip"} disabled={readOnly} onClick={() => style({ w: "clip" }, "Clip text")}>Clip</MenubarCheckboxItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>Number format</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarCheckboxItem checked={!focusCell?.s?.nf || focusCell?.s?.nf === "general"} disabled={readOnly} onClick={() => style({ nf: null, dp: null, cur: null }, "Automatic format")}>Automatic</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.nf === "number"} disabled={readOnly} onClick={() => style({ nf: "number", dp: 2 }, "Number format")}>Number (1,234.56)</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.nf === "currency"} disabled={readOnly} onClick={() => style({ nf: "currency", dp: 2 }, "Currency format")}>Currency</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.nf === "percent"} disabled={readOnly} onClick={() => style({ nf: "percent", dp: 0 }, "Percent format")}>Percent</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.nf === "date"} disabled={readOnly} onClick={() => style({ nf: "date" }, "Date format")}>Date</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={focusCell?.s?.nf === "text"} disabled={readOnly} onClick={() => style({ nf: "text" }, "Plain text format")}>Plain text</MenubarCheckboxItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarItem disabled={readOnly || !canMerge} onClick={() => handleMerge("all")}>
                <TableCellsMerge size={14} /> Merge all cells
              </MenubarItem>
              <MenubarItem disabled={readOnly || !hasMerged} onClick={handleUnmerge}>
                <TableCellsSplit size={14} /> Unmerge cells
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem disabled={readOnly} onClick={() => applySheet("Clear formatting", (sheetData) => clearRanges(sheetData, selectedRanges, "formats"))}>
                Clear formatting
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>Data</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarLabel>Sort &amp; Filter</MenubarLabel>
                <MenubarItem disabled={readOnly} onClick={() => sortBy("asc")}>
                  <ArrowDownAZ size={14} /> Sort column {columnName(sel.focus.col)} A → Z
                </MenubarItem>
                <MenubarItem disabled={readOnly} onClick={() => sortBy("desc")}>
                  <ArrowDownZA size={14} /> Sort column {columnName(sel.focus.col)} Z → A
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => setFilterPrompt(true)}>
                  <Filter size={14} /> Filter by column {columnName(sel.focus.col)}…
                </MenubarItem>
                {filter && (
                  <MenubarItem
                    onClick={() =>
                      setFilters((all) => {
                        const next = { ...all };
                        delete next[active.id];
                        return next;
                      })
                    }
                  >
                    Clear active filter
                  </MenubarItem>
                )}
              </MenubarGroup>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>View</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarCheckboxItem checked={!ribbonHidden} onClick={toggleRibbon}>
                  Show formatting ribbon <MenubarShortcut>Ctrl+Shift+F</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={!formulaBarHidden} onClick={() => setFormulaBarHidden((prev) => !prev)}>
                  Show formula bar
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={!data.hideGridlines}
                  disabled={readOnly}
                  onClick={() => applySheet(data.hideGridlines ? "Show gridlines" : "Hide gridlines", (sheetData) => setGridlinesHidden(sheetData, !sheetData.hideGridlines))}
                >
                  Show gridlines
                </MenubarCheckboxItem>
              </MenubarGroup>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger>Zoom ({Math.round(gridZoom * 100)}%)</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarRadioGroup value={String(Math.round(gridZoom * 100))}>
                    {[50, 75, 90, 100, 125, 150, 200].map((pct) => (
                      <MenubarRadioItem key={pct} value={String(pct)} onClick={() => setGridZoom(pct / 100)}>
                        {pct}%
                      </MenubarRadioItem>
                    ))}
                  </MenubarRadioGroup>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>Freeze rows</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarCheckboxItem checked={frozen === 0} disabled={readOnly} onClick={() => applySheet("Unfreeze rows", (sheetData) => ({ ...sheetData, frozenRows: 0 }))}>No frozen rows</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={frozen === 1} disabled={readOnly} onClick={() => applySheet("Freeze 1 row", (sheetData) => ({ ...sheetData, frozenRows: 1 }))}>Freeze 1 row</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={frozen === 2} disabled={readOnly || data.rowCount <= 2} onClick={() => applySheet("Freeze 2 rows", (sheetData) => ({ ...sheetData, frozenRows: 2 }))}>Freeze 2 rows</MenubarCheckboxItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger disabled={readOnly}>Freeze columns</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarCheckboxItem checked={frozenCols === 0} disabled={readOnly} onClick={() => applySheet("Unfreeze columns", (sheetData) => ({ ...sheetData, frozenCols: 0 }))}>No frozen columns</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={frozenCols === 1} disabled={readOnly} onClick={() => applySheet("Freeze 1 column", (sheetData) => ({ ...sheetData, frozenCols: 1 }))}>Freeze 1 column</MenubarCheckboxItem>
                  <MenubarCheckboxItem checked={frozenCols === 2} disabled={readOnly || data.colCount <= 2} onClick={() => applySheet("Freeze 2 columns", (sheetData) => ({ ...sheetData, frozenCols: 2 }))}>Freeze 2 columns</MenubarCheckboxItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarCheckboxItem checked={showHelp} onClick={() => setShowHelp((open) => !open)}>
                Show formula reference
              </MenubarCheckboxItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>

        <div className="tb-menubar-meta">
          <div className={`tb-sheet-search ${findQuery.trim() ? "has-query" : ""}`} role="search">
            <Search size={13} className="tb-sheet-search-icon" aria-hidden="true" />
            <input
              ref={findInput}
              type="search"
              className="tb-sheet-search-input"
              placeholder={`Search in ${active.name}…`}
              aria-label="Search in sheet"
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  goToMatch(event.shiftKey ? -1 : 1, false);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setFindQuery("");
                  setReplaceOpen(false);
                  gridRef.current?.focusCell(sel.focus.row, sel.focus.col, sel.focus.row, sel.focus.col, true);
                }
              }}
            />
            {findQuery.trim() ? (
              <div className="tb-sheet-search-controls">
                <span className="tb-sheet-search-count" aria-live="polite">
                  {matches.length ? `${clampedFindIndex + 1}/${matches.length}` : "0"}
                </span>
                <button
                  type="button"
                  className="tb-sheet-search-nav"
                  aria-label="Previous match"
                  title="Previous match (Shift+Enter)"
                  disabled={!matches.length}
                  onClick={() => goToMatch(-1, false)}
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  className="tb-sheet-search-nav"
                  aria-label="Next match"
                  title="Next match (Enter)"
                  disabled={!matches.length}
                  onClick={() => goToMatch(1, false)}
                >
                  <ChevronRight size={13} />
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    className={`tb-sheet-search-replace-toggle ${replaceOpen ? "is-on" : ""}`}
                    aria-expanded={replaceOpen}
                    title="Find and replace"
                    onClick={() => setReplaceOpen((open) => !open)}
                  >
                    Replace
                  </button>
                )}
                <button
                  type="button"
                  className="tb-sheet-search-nav"
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  onClick={() => {
                    setFindQuery("");
                    setReplaceOpen(false);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <kbd className="tb-sheet-search-kbd" aria-hidden="true">Ctrl+F</kbd>
            )}
          </div>
          <span className="tb-menubar-dims" title="Current sheet capacity">
            {data.rowCount.toLocaleString()} × {data.colCount}
          </span>
          {ribbonHidden && (
            <button
              type="button"
              className="tb-ribbon-toggle is-collapsed"
              aria-expanded={false}
              aria-controls="tb-spreadsheet-ribbon"
              title="Show formatting ribbon (Ctrl+Shift+F)"
              onClick={toggleRibbon}
            >
              <ChevronDown size={14} aria-hidden="true" />
              <span>Show ribbon</span>
            </button>
          )}
        </div>
      </nav>

      {!ribbonHidden && (
        <div id="tb-spreadsheet-ribbon" className="tb-toolbar" role="toolbar" aria-label="Spreadsheet tools">
          <div className="tb-toolbar-group" role="group" aria-label="Clipboard and structure">
            <button
              type="button"
              className="tb-icon-button"
              disabled={readOnly}
              title="Cut (Ctrl+X)"
              aria-label="Cut"
              onClick={() => triggerCopy(true)}
            >
              <Scissors size={14} />
            </button>
            <button
              type="button"
              className="tb-icon-button"
              title="Copy (Ctrl+C)"
              aria-label="Copy"
              onClick={() => triggerCopy(false)}
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="tb-icon-button"
              disabled={readOnly}
              title="Paste (Ctrl+V)"
              aria-label="Paste"
              onClick={() => void triggerPasteButton(false)}
            >
              <ClipboardPaste size={14} />
            </button>
          </div>

          <span className="tb-toolbar-sep" aria-hidden="true" />

          <Menu
            label="Rows and columns"
            icon={<Rows3 size={15} />}
            items={[
              {
                id: "row-above",
                label: "Insert row above",
                disabled: readOnly,
                onSelect: () => applyWorkbook("Insert row", (workbook) => insertRows(workbook, active.id, rect.r1, 1)),
              },
              {
                id: "row-below",
                label: rowsSelected > 1 ? `Insert ${rowsSelected} rows below` : "Insert row below",
                disabled: readOnly,
                onSelect: () => applyWorkbook("Insert rows", (workbook) => insertRows(workbook, active.id, rect.r2 + 1, rowsSelected)),
              },
              {
                id: "row-delete",
                label: rowsSelected > 1 ? `Delete ${rowsSelected} rows` : "Delete row",
                danger: true,
                disabled: readOnly || rowsSelected >= data.rowCount,
                onSelect: () => applyWorkbook("Delete rows", (workbook) => deleteRows(workbook, active.id, rect.r1, rowsSelected)),
              },
              "divider",
              {
                id: "col-left",
                label: "Insert column left",
                disabled: readOnly,
                onSelect: () => applyWorkbook("Insert column", (workbook) => insertColumns(workbook, active.id, rect.c1, 1)),
              },
              {
                id: "col-right",
                label: colsSelected > 1 ? `Insert ${colsSelected} columns right` : "Insert column right",
                disabled: readOnly,
                onSelect: () => applyWorkbook("Insert columns", (workbook) => insertColumns(workbook, active.id, rect.c2 + 1, colsSelected)),
              },
              {
                id: "col-delete",
                label: colsSelected > 1 ? `Delete ${colsSelected} columns` : "Delete column",
                danger: true,
                disabled: readOnly || colsSelected >= data.colCount,
                onSelect: () => applyWorkbook("Delete columns", (workbook) => deleteColumns(workbook, active.id, rect.c1, colsSelected)),
              },
              "divider",
              {
                id: "clear-contents",
                label: "Clear cell contents",
                hint: "Del",
                disabled: readOnly,
                onSelect: clearSelection,
              },
              {
                id: "add-rows",
                label: "Add 100 rows at bottom",
                disabled: readOnly || data.rowCount >= TABLE_LIMITS.rows,
                onSelect: () =>
                  applySheet("Add rows", (sheetData) =>
                    ensureSize(sheetData, Math.min(TABLE_LIMITS.rows, sheetData.rowCount + 100), sheetData.colCount),
                  ),
              },
              {
                id: "add-cols",
                label: "Add 10 columns at end",
                disabled: readOnly || data.colCount >= TABLE_LIMITS.cols,
                onSelect: () =>
                  applySheet("Add columns", (sheetData) =>
                    ensureSize(sheetData, sheetData.rowCount, Math.min(TABLE_LIMITS.cols, sheetData.colCount + 10)),
                  ),
              },
              { id: "row-height", label: "Row height…", disabled: readOnly, onSelect: () => setRowHeightPrompt(true) },
              { id: "col-width", label: "Column width…", disabled: readOnly, onSelect: () => setColWidthPrompt(true) },
            ]}
          />

          <Menu
            label="Freeze panes"
            icon={<Snowflake size={15} />}
            buttonClassName={`tb-icon-button ${frozen > 0 || frozenCols > 0 ? "is-on" : ""}`}
            items={[
              {
                id: "fr-0",
                label: "No frozen rows",
                checked: frozen === 0,
                disabled: readOnly,
                onSelect: () => applySheet("Unfreeze rows", (sheetData) => ({ ...sheetData, frozenRows: 0 })),
              },
              {
                id: "fr-1",
                label: "Freeze 1 row",
                checked: frozen === 1,
                disabled: readOnly,
                onSelect: () => applySheet("Freeze 1 row", (sheetData) => ({ ...sheetData, frozenRows: 1 })),
              },
              {
                id: "fr-2",
                label: "Freeze 2 rows",
                checked: frozen === 2,
                disabled: readOnly || data.rowCount <= 2,
                onSelect: () => applySheet("Freeze 2 rows", (sheetData) => ({ ...sheetData, frozenRows: 2 })),
              },
              ...(sel.focus.row >= 2 && sel.focus.row < 10
                ? [
                    {
                      id: "fr-cur",
                      label: `Freeze up to row ${sel.focus.row + 1}`,
                      checked: frozen === sel.focus.row + 1,
                      disabled: readOnly,
                      onSelect: () =>
                        applySheet(`Freeze ${sel.focus.row + 1} rows`, (sheetData) => ({ ...sheetData, frozenRows: sel.focus.row + 1 })),
                    },
                  ]
                : []),
              "divider",
              {
                id: "fc-0",
                label: "No frozen columns",
                checked: frozenCols === 0,
                disabled: readOnly,
                onSelect: () => applySheet("Unfreeze columns", (sheetData) => ({ ...sheetData, frozenCols: 0 })),
              },
              {
                id: "fc-1",
                label: "Freeze 1 column",
                checked: frozenCols === 1,
                disabled: readOnly,
                onSelect: () => applySheet("Freeze 1 column", (sheetData) => ({ ...sheetData, frozenCols: 1 })),
              },
              {
                id: "fc-2",
                label: "Freeze 2 columns",
                checked: frozenCols === 2,
                disabled: readOnly || data.colCount <= 2,
                onSelect: () => applySheet("Freeze 2 columns", (sheetData) => ({ ...sheetData, frozenCols: 2 })),
              },
              ...(sel.focus.col >= 2 && sel.focus.col < 10
                ? [
                    {
                      id: "fc-cur",
                      label: `Freeze up to column ${columnName(sel.focus.col)}`,
                      checked: frozenCols === sel.focus.col + 1,
                      disabled: readOnly,
                      onSelect: () =>
                        applySheet(`Freeze ${sel.focus.col + 1} columns`, (sheetData) => ({
                          ...sheetData,
                          frozenCols: sel.focus.col + 1,
                        })),
                    },
                  ]
                : []),
            ]}
          />

          <span className="tb-toolbar-sep" aria-hidden="true" />

          <FormatToolbar
            style={focusCell?.s}
            disabled={readOnly}
            canMerge={canMerge}
            hasMerged={hasMerged}
            canMergeHoriz={canMergeHoriz}
            canMergeVert={canMergeVert}
            borderStyle={borderStyle}
            borderColor={borderColor}
            onBorderPenChange={handleBorderPenChange}
            onStyle={style}
            onBorder={applyBorders}
            onMerge={handleMerge}
            onUnmerge={handleUnmerge}
            onClearFormat={() => applySheet("Clear formatting", (sheetData) => clearRanges(sheetData, selectedRanges, "formats"))}
          />

          <span className="tb-toolbar-sep" aria-hidden="true" />

          <Menu
            label="Sort"
            icon={<ArrowUpDown size={15} />}
            items={[
              {
                id: "asc",
                label: `Sort A → Z by column ${columnName(sel.focus.col)}`,
                icon: <ArrowDownAZ size={14} />,
                disabled: readOnly,
                onSelect: () => sortBy("asc"),
              },
              {
                id: "desc",
                label: `Sort Z → A by column ${columnName(sel.focus.col)}`,
                icon: <ArrowDownZA size={14} />,
                disabled: readOnly,
                onSelect: () => sortBy("desc"),
              },
            ]}
          />

          <button
            type="button"
            className={`tb-icon-button ${filter ? "is-on" : ""}`}
            aria-pressed={Boolean(filter)}
            title="Filter rows"
            aria-label="Filter rows"
            onClick={() =>
              filter
                ? setFilters((all) => {
                    const next = { ...all };
                    delete next[active.id];
                    return next;
                  })
                : setFilterPrompt(true)
            }
          >
            <Filter size={15} />
          </button>
          <button
            type="button"
            className={`tb-icon-button ${findQuery.trim() ? "is-on" : ""}`}
            title="Search in sheet (Ctrl+F)"
            aria-label="Find"
            onClick={focusSearchInput}
          >
            <Search size={15} />
          </button>

          <button
            type="button"
            className="tb-icon-button"
            disabled={readOnly}
            title="Insert chart"
            aria-label="Insert chart"
            onClick={() => setChartModal({ chart: null })}
          >
            <BarChart3 size={15} />
          </button>
          <button
            type="button"
            className={`tb-icon-button ${focusComment ? "is-on" : ""}`}
            disabled={!canCommentCells && !focusComment}
            title={focusComment ? "View or edit comment (Ctrl+Alt+M)" : "Insert comment (Ctrl+Alt+M)"}
            aria-label="Insert comment"
            onClick={() => openCommentForCell(sel.focus.row, sel.focus.col)}
          >
            <MessageSquarePlus size={15} />
          </button>

          <span className="tb-head-spacer" />

          <button type="button" className="tb-icon-button" title="Export" aria-label="Export" onClick={() => setExportOpen(true)}>
            <Download size={15} />
          </button>
          <button
            type="button"
            className="tb-ribbon-toggle"
            aria-expanded={!ribbonHidden}
            aria-controls="tb-spreadsheet-ribbon"
            title="Hide formatting ribbon (Ctrl+Shift+F)"
            onClick={toggleRibbon}
          >
            <ChevronUp size={14} aria-hidden="true" />
            <span>Hide ribbon</span>
          </button>
        </div>
      )}

      {!readOnly && replaceOpen && findQuery.trim() !== "" && (
        <div className="tb-findbar" role="region" aria-label="Replace in sheet">
          <span className="tb-replace-label">Replace with</span>
          <input
            type="text"
            placeholder="Replacement value…"
            aria-label="Replace with"
            value={replaceText}
            onChange={(event) => setReplaceText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                replaceCurrentMatch();
              }
              if (event.key === "Escape") setReplaceOpen(false);
            }}
          />
          <button type="button" className="tb-button" disabled={!matches.length} onClick={replaceCurrentMatch}>
            Replace
          </button>
          <button type="button" className="tb-button" disabled={!matches.length} onClick={replaceAllMatches}>
            Replace all
          </button>
          <button type="button" className="tb-icon-button" aria-label="Close replace" onClick={() => setReplaceOpen(false)}>
            <X size={15} />
          </button>
        </div>
      )}

      {filter && (
        <div className="tb-filterbar" role="status">
          <Filter size={13} aria-hidden="true" /> Showing rows where column {columnName(filter.col)} contains “{filter.text}” ·{" "}
          {plural(data.rowCount - frozen - hiddenRows.size, "row")} shown. Filters here are temporary and aren&apos;t saved.
          <button
            type="button"
            className="tb-link-button"
            onClick={() =>
              setFilters((all) => {
                const next = { ...all };
                delete next[active.id];
                return next;
              })
            }
          >
            Clear filter
          </button>
        </div>
      )}

      {!formulaBarHidden && (
      <div className="tb-formula-bar">
        <span className="tb-address" aria-label="Selected cell" title={address}>
          {address}
        </span>
        <button
          type="button"
          className={`tb-fx ${showHelp ? "is-on" : ""}`}
          aria-expanded={showHelp}
          onClick={() => setShowHelp((open) => !open)}
          title="Formula help"
        >
          fx
        </button>
        <input
          className="tb-formula-input"
          aria-label={`Contents of ${addressName(sel.focus.row, sel.focus.col)}`}
          value={shownBarText}
          disabled={readOnly}
          spellCheck={false}
          maxLength={TABLE_LIMITS.cellText}
          placeholder="Enter value or =formula"
          onChange={(event) => {
            setLiveDraft(null);
            setBarText(event.target.value);
            setBarDirty(true);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              commitBar("down");
            } else if (event.key === "Tab") {
              event.preventDefault();
              commitBar("right");
            } else if (event.key === "Escape") {
              event.preventDefault();
              setBarDirty(false);
              setBarText(cellEditText(focusCell));
              gridRef.current?.focusCell(sel.focus.row, sel.focus.col);
            }
          }}
          onBlur={() => {
            if (barDirty) commitBar("stay");
          }}
        />
        {barDirty && (
          <button
            type="button"
            className="tb-secondary-button tb-bar-apply"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => commitBar("stay")}
          >
            Apply
          </button>
        )}
      </div>
      )}

      {isFormulaError(focusValue) && (
        <p className="tb-formula-error" role="status">
          <b>{focusValue.error}</b> {focusValue.message}
        </p>
      )}
      {showHelp && (
        <div className="tb-formula-help">
          <p>
            Start with <code>=</code>. Use <code>+ − * /</code>, parentheses, cell references like <code>B2</code>, ranges like{" "}
            <code>B2:B10</code>, other sheets like <code>&apos;Sheet 2&apos;!A1</code>, and these functions:{" "}
            {SUPPORTED_FUNCTIONS.map((name) => (
              <code key={name}>{name}</code>
            ))}
            .
          </p>
          <p>
            Example: <code>=IF(SUM(B2:B5)&gt;100, &quot;Over&quot;, &quot;OK&quot;)</code>. Other functions show <code>#NAME?</code> and
            the formula is kept. To enter text starting with “=”, type an apostrophe first: <code>&apos;=not a formula</code>.
          </p>
        </div>
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="tb-grid-context-host">
            <SheetGrid
              ref={gridRef}
              sheetId={active.id}
              data={data}
              calc={calc}
              changedRows={changedRows}
              version={change.version}
              hiddenRows={hiddenRows}
              readOnly={readOnly}
              zoom={gridZoom}
              onZoomChange={setGridZoom}
              searchMatchKeys={searchMatchKeys.size ? searchMatchKeys : undefined}
              activeMatchKey={activeMatchKey}
              onEdit={editCell}
              onClear={clearSelection}
              onFill={(fillSource, target) => applySheet("Fill", (sheetData) => fillRange(sheetData, fillSource, target))}
              onSelection={(next) => {
                setSel(next);
                setBarDirty(false);
              }}
              onColumnResize={(col, width) => applySheet(`Resize column ${columnName(col)}`, (sheetData) => resizeColumn(sheetData, col, width))}
              onRowResize={(row, height) => applySheet(`Resize row ${row + 1}`, (sheetData) => resizeRow(sheetData, row, height))}
              onLiveDraft={setLiveDraft}
              onContextAction={(req) => setContextTarget(req)}
              onOpenComment={(row, col, anchorRect) => openCommentForCell(row, col, anchorRect)}
              onExtendGrid={extendGrid}
              overlaySlot={
                <SheetChartLayer
                  data={data}
                  valueAt={valueAt}
                  readOnly={readOnly}
                  onMoveChart={(chartId, x, y) =>
                    applySheet("Move chart", (sheetData) => updateSheetChart(sheetData, chartId, { x, y }))
                  }
                  onEditChart={(chart) => setChartModal({ chart })}
                  onDeleteChart={(chartId) =>
                    applySheet("Delete chart", (sheetData) => deleteSheetChart(sheetData, chartId))
                  }
                />
              }
            />
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-60">
          <ContextMenuGroup>
            <ContextMenuLabel>
              {contextTarget?.kind === "col"
                ? `Column ${columnName(contextTarget.col)}`
                : contextTarget?.kind === "row"
                  ? `Row ${contextTarget.row + 1}`
                  : `Cell ${address}`}
            </ContextMenuLabel>
            <ContextMenuItem disabled={readOnly} onClick={() => void triggerCopy(true)}>
              <Scissors size={14} /> Cut
              <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void triggerCopy(false)}>
              <Copy size={14} /> Copy
              <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onClick={() => void triggerPasteButton(false)}>
              <ClipboardPaste size={14} /> Paste
              <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onClick={() => void triggerPasteButton(true)}>
              Paste values only
              <ContextMenuShortcut>Ctrl+Shift+V</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>

          <ContextMenuSeparator />

          <ContextMenuGroup>
            <ContextMenuItem
              disabled={!canCommentCells && !data.comments?.[`${(contextTarget?.row ?? sel.focus.row)}:${(contextTarget?.col ?? sel.focus.col)}`]}
              onClick={() => openCommentForCell(contextTarget?.row ?? sel.focus.row, contextTarget?.col ?? sel.focus.col)}
            >
              <MessageSquarePlus size={14} />
              {data.comments?.[`${(contextTarget?.row ?? sel.focus.row)}:${(contextTarget?.col ?? sel.focus.col)}`]
                ? canCommentCells
                  ? "View / edit comment"
                  : "View comment"
                : "Insert comment"}
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onClick={() => setChartModal({ chart: null })}>
              <BarChart3 size={14} /> Create chart from selection
            </ContextMenuItem>
            {(canMerge || hasMerged) && (
              <ContextMenuItem
                disabled={readOnly}
                onClick={() => {
                  if (hasMerged) handleUnmerge();
                  else handleMerge("all");
                }}
              >
                {hasMerged ? <TableCellsSplit size={14} /> : <TableCellsMerge size={14} />}
                {hasMerged ? "Unmerge cells" : "Merge cells"}
              </ContextMenuItem>
            )}
            <ContextMenuItem disabled={readOnly} onClick={clearSelection}>
              <Eraser size={14} /> Clear contents
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>

          <ContextMenuSeparator />

          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={readOnly}>Rows</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem disabled={readOnly} onClick={() => applyWorkbook("Insert row", (workbook) => insertRows(workbook, active.id, rect.r1, 1))}>
                Insert row above
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onClick={() => applyWorkbook("Insert row below", (workbook) => insertRows(workbook, active.id, rect.r2 + 1, rowsSelected))}>
                {rowsSelected > 1 ? `Insert ${rowsSelected} rows below` : "Insert row below"}
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onClick={() => setRowHeightPrompt(true)}>
                Resize row height…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={readOnly || rowsSelected >= data.rowCount}
                onClick={() => applyWorkbook("Delete rows", (workbook) => deleteRows(workbook, active.id, rect.r1, rowsSelected))}
              >
                <Trash2 size={14} />
                {rowsSelected > 1 ? `Delete ${rowsSelected} rows` : "Delete row"}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={readOnly}>Columns</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem disabled={readOnly} onClick={() => applyWorkbook("Insert column", (workbook) => insertColumns(workbook, active.id, rect.c1, 1))}>
                Insert column left
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onClick={() => applyWorkbook("Insert column right", (workbook) => insertColumns(workbook, active.id, rect.c2 + 1, colsSelected))}>
                {colsSelected > 1 ? `Insert ${colsSelected} columns right` : "Insert column right"}
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onClick={() => setColWidthPrompt(true)}>
                Resize column width…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={readOnly || colsSelected >= data.colCount}
                onClick={() => applyWorkbook("Delete columns", (workbook) => deleteColumns(workbook, active.id, rect.c1, colsSelected))}
              >
                <Trash2 size={14} />
                {colsSelected > 1 ? `Delete ${colsSelected} columns` : "Delete column"}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>

      <div className="tb-sheet-foot">
        <div className="tb-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((sheet, index) => (
            <div key={sheet.id} className={`tb-tab ${sheet.id === active.id ? "is-active" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={sheet.id === active.id}
                onClick={() => setActiveId(sheet.id)}
                onDoubleClick={() => !readOnly && setRenameSheetId(sheet.id)}
              >
                {sheet.name}
              </button>
              {sheet.id === active.id && sheetMenu(sheet, index)}
            </div>
          ))}
          <button
            type="button"
            className="tb-icon-button"
            aria-label="Add sheet"
            title="Add sheet"
            disabled={readOnly || sheets.length >= TABLE_LIMITS.sheets}
            onClick={() => {
              const id = newId();
              if (applyWorkbook("Add sheet", (workbook) => addSheet(workbook, null, id))) setActiveId(id);
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="tb-status" aria-live="polite">
          {summary ? (
            <>
              {summary.numbers > 0 && (
                <span>
                  Sum <b>{formatCellValue(summary.sum, focusCell?.s)}</b>
                </span>
              )}
              {summary.average !== null && (
                <span>
                  Average <b>{formatCellValue(summary.average, focusCell?.s)}</b>
                </span>
              )}
              <span>
                Count <b>{summary.count.toLocaleString()}</b>
              </span>
            </>
          ) : (
            <span className="tb-muted">
              {plural(data.rowCount, "row")} × {plural(data.colCount, "column")} ({columnName(0)}–{columnName(data.colCount - 1)})
            </span>
          )}
          {!readOnly && data.rowCount < TABLE_LIMITS.rows && (
            <button
              type="button"
              className="tb-status-extend"
              title="Add 50 rows to this sheet"
              onClick={() => extendGrid(50, 0)}
            >
              +50 rows
            </button>
          )}
          {!readOnly && data.colCount < TABLE_LIMITS.cols && (
            <button
              type="button"
              className="tb-status-extend"
              title="Add 10 columns to this sheet"
              onClick={() => extendGrid(0, 10)}
            >
              +10 cols
            </button>
          )}
          <div className="tb-zoom-pill" role="group" aria-label="Spreadsheet cell zoom">
            <button
              type="button"
              className="tb-zoom-btn"
              aria-label="Zoom out cells"
              title="Zoom out cells"
              disabled={gridZoom <= 0.5}
              onClick={() => setGridZoom((z) => clampGridZoom(z - 0.1))}
            >
              <ZoomOut size={12} />
            </button>
            <button
              type="button"
              className="tb-zoom-readout"
              aria-label="Reset cell zoom to 100%"
              title="Pinch or Ctrl+scroll on cells to zoom · click to reset"
              onClick={() => setGridZoom(1)}
            >
              {Math.round(gridZoom * 100)}%
            </button>
            <button
              type="button"
              className="tb-zoom-btn"
              aria-label="Zoom in cells"
              title="Zoom in cells"
              disabled={gridZoom >= 2}
              onClick={() => setGridZoom((z) => clampGridZoom(z + 0.1))}
            >
              <ZoomIn size={12} />
            </button>
          </div>
        </div>
      </div>

      {commentDialog && (
        <ModalPortal>
          <div
            className="tb-comment-scrim"
            role="presentation"
            onMouseDown={(ev) => {
              if (ev.target === ev.currentTarget) setCommentDialog(null);
            }}
          >
            <section
              className="tb-comment-popover"
              role="dialog"
              aria-modal="true"
              aria-label={`Comment on ${addressName(commentDialog.row, commentDialog.col)}`}
              style={{
                left: Math.min(commentDialog.anchorX, window.innerWidth - 340),
                top: Math.min(commentDialog.anchorY, window.innerHeight - 260),
              }}
              onMouseDown={(ev) => ev.stopPropagation()}
            >
              <header className="tb-comment-head">
                <div className="tb-comment-author-meta">
                  <span className="tb-comment-cell-badge">{addressName(commentDialog.row, commentDialog.col)}</span>
                  <div>
                    <b className="tb-comment-author">{activeComment?.author || authorName}</b>
                    <small className="tb-comment-time">
                      {activeComment
                        ? `${new Date(activeComment.updatedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}${activeComment.updatedAt !== activeComment.createdAt ? " · edited" : ""}`
                        : "New comment"}
                    </small>
                  </div>
                </div>
                <button
                  type="button"
                  className="tb-icon-button"
                  aria-label="Close comment"
                  onClick={() => setCommentDialog(null)}
                >
                  <X size={15} />
                </button>
              </header>

              {commentDialog.editing ? (
                <form
                  className="tb-comment-form"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const trimmed = commentDialog.draft.trim();
                    if (!trimmed || commentDialog.saving) return;
                    if (readOnly && allowComment && onSaveCellComment) {
                      const chosenAuthor = askCommentAuthor ? (commentDialog.guestAuthor.trim() || "Guest commenter") : authorName;
                      setCommentDialog((prev) => (prev ? { ...prev, saving: true } : null));
                      void onSaveCellComment({
                        sheetId: active.id,
                        row: commentDialog.row,
                        col: commentDialog.col,
                        text: trimmed,
                        authorName: chosenAuthor,
                      })
                        .then(() => {
                          setCommentDialog((prev) => (prev ? { ...prev, saving: false, editing: false, draft: trimmed } : null));
                        })
                        .catch((err) => {
                          setCommentDialog((prev) => (prev ? { ...prev, saving: false } : null));
                          notify(err instanceof Error && err.message ? err.message : "Comment couldn't be posted.", "error");
                        });
                      return;
                    }
                    const ok = applySheet(`Comment on ${addressName(commentDialog.row, commentDialog.col)}`, (sheetData) =>
                      setCellComment(sheetData, commentDialog.row, commentDialog.col, {
                        text: trimmed,
                        author: activeComment?.author || authorName,
                      }),
                    );
                    if (ok) {
                      setCommentDialog((prev) => (prev ? { ...prev, editing: false, draft: trimmed } : null));
                    }
                  }}
                >
                  {askCommentAuthor && (
                    <input
                      type="text"
                      className="tb-comment-author-input"
                      aria-label="Your name (optional)"
                      maxLength={60}
                      placeholder="Your name (optional)"
                      value={commentDialog.guestAuthor}
                      onChange={(ev) => setCommentDialog((prev) => (prev ? { ...prev, guestAuthor: ev.target.value } : null))}
                    />
                  )}
                  <textarea
                    className="tb-comment-textarea"
                    aria-label="Comment text"
                    rows={3}
                    maxLength={TABLE_LIMITS.commentText}
                    placeholder="Add context or notes for this cell…"
                    autoFocus
                    value={commentDialog.draft}
                    onChange={(ev) => setCommentDialog((prev) => (prev ? { ...prev, draft: ev.target.value } : null))}
                  />
                  <div className="tb-comment-actions">
                    {activeComment && (
                      <button
                        type="button"
                        className="tb-secondary-button"
                        onClick={() =>
                          setCommentDialog((prev) =>
                            prev ? { ...prev, editing: false, draft: activeComment.text } : null,
                          )
                        }
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      className="tb-primary-button"
                      disabled={!commentDialog.draft.trim() || Boolean(commentDialog.saving)}
                    >
                      {commentDialog.saving ? "Posting…" : activeComment ? "Save changes" : "Post comment"}
                    </button>
                  </div>
                </form>
              ) : activeComment ? (
                <div className="tb-comment-body">
                  <p className="tb-comment-text">{activeComment.text}</p>
                  {canCommentCells && (
                    <div className="tb-comment-actions">
                      <button
                        type="button"
                        className="tb-secondary-button"
                        onClick={() =>
                          setCommentDialog((prev) =>
                            prev ? { ...prev, editing: true, draft: activeComment.text } : null,
                          )
                        }
                      >
                        <Pencil size={13} /> {readOnly ? "Update comment" : "Edit"}
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          className="tb-secondary-button tb-comment-delete"
                          onClick={() => {
                            applySheet(
                              `Delete comment on ${addressName(commentDialog.row, commentDialog.col)}`,
                              (sheetData) => deleteCellComment(sheetData, commentDialog.row, commentDialog.col),
                            );
                            setCommentDialog(null);
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          </div>
        </ModalPortal>
      )}

      {chartModal && (
        <SheetChartModal
          data={data}
          valueAt={valueAt}
          selectionRect={rect}
          initialChart={chartModal.chart}
          presetType={chartModal.presetType}
          onClose={() => setChartModal(null)}
          onSave={(payload) => {
            if (chartModal.chart) {
              applySheet("Update chart", (sheetData) =>
                updateSheetChart(sheetData, chartModal.chart!.id, payload),
              );
            } else {
              applySheet("Insert chart", (sheetData) => addSheetChart(sheetData, payload));
            }
            setChartModal(null);
          }}
        />
      )}

      {filterPrompt && (
        <PromptDialog
          id="tb-filter-title"
          title={`Filter by column ${columnName(sel.focus.col)}`}
          label="Show rows where this column contains"
          initial=""
          maxLength={200}
          confirmLabel="Filter"
          validate={(value) => (value.trim() ? null : "Enter some text to match.")}
          onCancel={() => setFilterPrompt(false)}
          onConfirm={(value) => {
            setFilters((all) => ({ ...all, [active.id]: { col: sel.focus.col, text: value.trim() } }));
            setFilterPrompt(false);
          }}
        />
      )}
      {renameSheetId && (
        <PromptDialog
          id="tb-sheet-rename"
          title="Rename sheet"
          label="Sheet name"
          initial={sheets.find((sheet) => sheet.id === renameSheetId)?.name || ""}
          maxLength={TABLE_LIMITS.sheetNameLength}
          validate={(value) => {
            try {
              validateSheetName(
                value,
                sheets.filter((sheet) => sheet.id !== renameSheetId).map((sheet) => sheet.name),
              );
              return null;
            } catch (error) {
              return error instanceof Error ? error.message : "Choose another name.";
            }
          }}
          onCancel={() => setRenameSheetId(null)}
          onConfirm={(value) => {
            applyWorkbook("Rename sheet", (workbook) => renameSheet(workbook, renameSheetId, value));
            setRenameSheetId(null);
          }}
        />
      )}
      {rowHeightPrompt && (
        <PromptDialog
          id="tb-row-height"
          title={rowsSelected > 1 ? `Height of ${rowsSelected} rows` : `Height of row ${rect.r1 + 1}`}
          label={`Height in pixels (${ROW_HEIGHT.min}–${ROW_HEIGHT.max})`}
          initial={String(data.rowHeights[rect.r1] || ROW_HEIGHT.default)}
          maxLength={3}
          validate={(value) => {
            const height = Number(value);
            return Number.isInteger(height) && height >= ROW_HEIGHT.min && height <= ROW_HEIGHT.max
              ? null
              : `Enter a whole number from ${ROW_HEIGHT.min} to ${ROW_HEIGHT.max}.`;
          }}
          onCancel={() => setRowHeightPrompt(false)}
          onConfirm={(value) => {
            applySheet("Row height", (sheetData) => {
              let next = sheetData;
              for (let row = rect.r1; row <= rect.r2; row += 1) next = resizeRow(next, row, Number(value));
              return next;
            });
            setRowHeightPrompt(false);
          }}
        />
      )}
      {colWidthPrompt && (
        <PromptDialog
          id="tb-col-width"
          title={colsSelected > 1 ? `Width of ${colsSelected} columns` : `Width of column ${columnName(rect.c1)}`}
          label={`Width in pixels (${COLUMN_WIDTH.min}–${COLUMN_WIDTH.max})`}
          initial={String(data.colWidths[rect.c1] || COLUMN_WIDTH.default)}
          maxLength={3}
          validate={(value) => {
            const width = Number(value);
            return Number.isInteger(width) && width >= COLUMN_WIDTH.min && width <= COLUMN_WIDTH.max
              ? null
              : `Enter a whole number from ${COLUMN_WIDTH.min} to ${COLUMN_WIDTH.max}.`;
          }}
          onCancel={() => setColWidthPrompt(false)}
          onConfirm={(value) => {
            applySheet("Column width", (sheetData) => {
              let next = sheetData;
              for (let col = rect.c1; col <= rect.c2; col += 1) next = resizeColumn(next, col, Number(value));
              return next;
            });
            setColWidthPrompt(false);
          }}
        />
      )}
      {deleteSheetId && (
        <ModalPortal>
          <ConfirmDialog
            title={`Delete sheet “${sheets.find((sheet) => sheet.id === deleteSheetId)?.name}”?`}
            confirmLabel="Delete sheet"
            onCancel={() => setDeleteSheetId(null)}
            onConfirm={() => {
              applyWorkbook("Delete sheet", (workbook) => deleteSheet(workbook, deleteSheetId));
              setDeleteSheetId(null);
            }}
          >
            <p>
              Its cells are removed and formulas on other sheets that point to it will show <code>#REF!</code>. You can undo this with Ctrl+Z.
            </p>
          </ConfirmDialog>
        </ModalPortal>
      )}
      {exportOpen && (
        <ExportDialog
          kind="spreadsheet"
          sheets={sheets.length}
          scopeNote={`CSV exports only the current sheet, “${active.name}”.`}
          onClose={() => setExportOpen(false)}
          onExport={exportFile}
        />
      )}
    </div>
  );
}
