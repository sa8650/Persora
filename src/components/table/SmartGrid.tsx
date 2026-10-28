// Persora Table — Smart Table "Table" view: virtualized grid with multi-row selection,
// configurable row density, ReUI ContextMenu, column menus, grouping, and per-column summary metrics.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowDownAZ, ArrowDownZA, ArrowLeft, ArrowRight, ArrowUp, Calendar, CheckSquare, ChevronDown, CircleDot,
  Coins, Copy, Eraser, EyeOff, Hash, Link, ListChecks, Mail, Maximize2, Paperclip, Pencil, Percent, Plus, Sigma, Tags, Trash2, Type, User,
} from "lucide-react";
import {
  NUMERIC_TYPES, displayValue, fieldSummary, textOfValue,
  type Choice, type Field, type FieldType, type FieldValue, type TableRecord,
} from "../../../cloudflare/table-rules.js";
import type { TablePerson } from "../../lib/table/table-api";
import { ChoiceChip, InlineEditor, ValueView } from "./smart-cells";
import { Menu, plural } from "./table-ui";
import {
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/design-system";

export type SmartRowDensity = "compact" | "standard" | "tall";
export type SmartSummaryMode = "auto" | "none" | "count" | "filled" | "empty" | "percent_filled" | "sum" | "avg" | "min" | "max";

export const DENSITY_ROW_HEIGHT: Record<SmartRowDensity, number> = {
  compact: 30,
  standard: 36,
  tall: 48,
};

const OVERSCAN = 12;

export const FIELD_ICONS: Record<FieldType, typeof Type> = {
  text: Type,
  number: Hash,
  currency: Coins,
  percent: Percent,
  date: Calendar,
  checkbox: CheckSquare,
  select: CircleDot,
  multiselect: Tags,
  status: ListChecks,
  url: Link,
  email: Mail,
  person: User,
  attachment: Paperclip,
};

type Item =
  | { kind: "group"; id: string; label: string; color: string; count: number }
  | { kind: "record"; record: TableRecord; index: number };
type Editing = { recordId: string; fieldId: string; initialText?: string } | null;

export interface SmartGridProps {
  fields: Field[];
  records: TableRecord[];
  groupField: Field | null;
  primaryField: string;
  people: TablePerson[] | null;
  readOnly: boolean;
  openRecordId: string | null;
  canReorder: boolean;
  density?: SmartRowDensity;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (recordId: string, selected: boolean) => void;
  onToggleSelectAll?: (selected: boolean) => void;
  summaryModes?: Record<string, SmartSummaryMode>;
  onChangeSummaryMode?: (fieldId: string, mode: SmartSummaryMode) => void;
  groupCollapseSignal?: { mode: "expand" | "collapse"; nonce: number } | null;
  onCommit: (recordId: string, fieldId: string, value: FieldValue, newChoices?: Choice[]) => void;
  onOpenRecord: (id: string) => void;
  onAddRecord: (groupValue?: { fieldId: string; value: string | null }) => void;
  onDuplicateRecord?: (id: string) => void;
  onRequestDeleteRecord?: (id: string) => void;
  onCopyCellText?: (text: string) => void;
  onMoveRecord: (id: string, delta: -1 | 1) => void;
  onEditField: (field: Field) => void;
  onAddField: (index: number) => void;
  onSortField: (field: Field, dir: "asc" | "desc") => void;
  onHideField: (field: Field) => void;
  onMoveField: (field: Field, delta: -1 | 1) => void;
  onDeleteField: (field: Field) => void;
  onResizeField: (field: Field, width: number) => void;
}

function formatSummaryText(field: Field, records: TableRecord[], mode: SmartSummaryMode = "auto"): string {
  if (mode === "none") return "—";
  const total = records.length;
  const summary = fieldSummary(field, records);
  const isNumeric = NUMERIC_TYPES.includes(field.type);

  if (mode === "count") return `Count ${total}`;
  if (mode === "filled") return `${summary.filled} filled`;
  if (mode === "empty") return `${Math.max(0, total - summary.filled)} empty`;
  if (mode === "percent_filled") {
    const pct = total ? Math.round((summary.filled / total) * 100) : 0;
    return `${pct}% filled`;
  }
  if (isNumeric) {
    if (mode === "sum") return summary.numbers ? `Sum ${displayValue(field, summary.sum ?? 0)}` : "Sum 0";
    if (mode === "avg") return summary.numbers && summary.average !== null && summary.average !== undefined ? `Avg ${displayValue(field, Math.round(summary.average * 100) / 100)}` : "Avg —";
    if (mode === "min") return summary.numbers && summary.min !== null && summary.min !== undefined ? `Min ${displayValue(field, summary.min)}` : "Min —";
    if (mode === "max") return summary.numbers && summary.max !== null && summary.max !== undefined ? `Max ${displayValue(field, summary.max)}` : "Max —";
  }

  // "auto"
  if (isNumeric && summary.numbers) return `Sum ${displayValue(field, summary.sum)}`;
  if (field.type === "checkbox") return `${summary.checked ?? 0} checked`;
  return summary.filled ? `${summary.filled} filled` : "Calculate";
}

export default function SmartGrid(props: SmartGridProps) {
  const {
    fields,
    records,
    groupField,
    primaryField,
    people,
    readOnly,
    openRecordId,
    canReorder,
    density = "standard",
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    summaryModes,
    onChangeSummaryMode,
    groupCollapseSignal,
  } = props;

  const rowH = DENSITY_ROW_HEIGHT[density] || 36;
  const selectable = Boolean(!readOnly && onToggleSelect && selectedIds);
  const numberColWidth = selectable ? 74 : 52;

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [active, setActive] = useState<{ item: number; col: number }>({ item: -1, col: 0 });
  const [editing, setEditing] = useState<Editing>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [resizing, setResizing] = useState<{ fieldId: string; width: number } | null>(null);
  const [ctxTarget, setCtxTarget] = useState<{ itemIndex: number; col: number; record: TableRecord; field: Field } | null>(null);

  const groupKeys = useMemo(() => {
    if (!groupField) return [] as string[];
    return [...(groupField.choices || []).map((c) => c.id), ""];
  }, [groupField]);

  useEffect(() => {
    if (!groupCollapseSignal || !groupField) return;
    if (groupCollapseSignal.mode === "collapse") {
      setCollapsed(new Set(groupKeys));
    } else {
      setCollapsed(new Set());
    }
  }, [groupCollapseSignal, groupField, groupKeys]);

  const items = useMemo<Item[]>(() => {
    if (!groupField) return records.map((record, index) => ({ kind: "record" as const, record, index }));
    const list: Item[] = [];
    const buckets = new Map<string, TableRecord[]>();
    for (const record of records) {
      const value = record.values[groupField.id];
      const key = typeof value === "string" && (groupField.choices || []).some((choice) => choice.id === value) ? value : "";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(record);
    }
    let index = 0;
    for (const group of [
      ...(groupField.choices || []).map((choice) => ({ id: choice.id, label: choice.label, color: String(choice.color) })),
      { id: "", label: `No ${groupField.name}`, color: "gray" },
    ]) {
      const rows = buckets.get(group.id) || [];
      if (!rows.length && group.id === "") continue;
      list.push({ kind: "group", ...group, count: rows.length });
      if (!collapsed.has(group.id)) for (const record of rows) list.push({ kind: "record", record, index: index++ });
      else index += rows.length;
    }
    return list;
  }, [records, groupField, collapsed]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight || 600));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / rowH) + OVERSCAN);
  const widths = fields.map((field) => (resizing?.fieldId === field.id ? resizing.width : field.width));
  const template = `${numberColWidth}px ${widths.map((width) => `${width}px`).join(" ")} 44px`;
  const totalWidth = numberColWidth + widths.reduce((sum, width) => sum + width, 0) + 44;

  // Keep the active cell visible.
  useEffect(() => {
    const element = scroller.current;
    if (!element || active.item < 0) return;
    const top = active.item * rowH;
    const headerH = 36;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + rowH > element.scrollTop + element.clientHeight - headerH * 2) {
      element.scrollTop = top + rowH - element.clientHeight + headerH * 2;
    }
  }, [active.item, rowH]);

  const recordAt = (item: number) => {
    const entry = items[item];
    return entry?.kind === "record" ? entry.record : null;
  };
  const moveActive = (dRow: number, dCol: number) => {
    setActive((current) => {
      let item = current.item < 0 ? 0 : current.item;
      if (dRow) {
        let next = item + dRow;
        while (next >= 0 && next < items.length && items[next].kind !== "record") next += dRow;
        if (next >= 0 && next < items.length) item = next;
      }
      return { item, col: Math.min(Math.max(0, current.col + dCol), fields.length - 1) };
    });
  };
  const focusGrid = () => requestAnimationFrame(() => scroller.current?.focus({ preventScroll: true }));
  const startEdit = (item: number, col: number, initialText?: string) => {
    const record = recordAt(item);
    const field = fields[col];
    if (!record || !field || readOnly) return;
    if (field.type === "checkbox") {
      props.onCommit(record.id, field.id, record.values[field.id] !== true);
      return;
    }
    if (field.type === "attachment") {
      props.onOpenRecord(record.id);
      return;
    }
    if (initialText !== undefined && (field.type === "select" || field.type === "status" || field.type === "person")) initialText = undefined;
    setEditing({ recordId: record.id, fieldId: field.id, initialText });
  };

  const copyCellValue = (record: TableRecord, field: Field) => {
    const text = textOfValue(field, record.values[field.id]);
    props.onCopyCellText?.(text);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;
    const record = recordAt(active.item);
    const field = fields[active.col];
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "c" && record && field) {
      event.preventDefault();
      copyCellValue(record, field);
      return;
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); moveActive(1, 0); return;
      case "ArrowUp": event.preventDefault(); moveActive(-1, 0); return;
      case "ArrowRight": event.preventDefault(); moveActive(0, 1); return;
      case "ArrowLeft": event.preventDefault(); moveActive(0, -1); return;
      case "Tab":
        if (event.shiftKey ? active.col > 0 : active.col < fields.length - 1) {
          event.preventDefault();
          moveActive(0, event.shiftKey ? -1 : 1);
        }
        return;
      case "Home": event.preventDefault(); setActive((current) => ({ ...current, col: 0 })); return;
      case "End": event.preventDefault(); setActive((current) => ({ ...current, col: fields.length - 1 })); return;
      case "Enter":
        event.preventDefault();
        if (mod || event.shiftKey) {
          if (record) props.onOpenRecord(record.id);
        } else startEdit(active.item, active.col);
        return;
      case "F2": event.preventDefault(); startEdit(active.item, active.col); return;
      case " ":
        if (field?.type === "checkbox") {
          event.preventDefault();
          startEdit(active.item, active.col);
        } else if (event.shiftKey && record) {
          event.preventDefault();
          props.onOpenRecord(record.id);
        }
        return;
      case "Delete":
      case "Backspace":
        if (record && field && !readOnly && record.values[field.id] !== undefined && record.values[field.id] !== null) {
          event.preventDefault();
          props.onCommit(record.id, field.id, null);
        }
        return;
      default:
        if (!mod && !event.altKey && event.key.length === 1 && record && field) {
          event.preventDefault();
          startEdit(active.item, active.col, event.key);
        }
    }
  };

  const beginResize = (event: React.PointerEvent, field: Field) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = field.width;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let width = startWidth;
    const move = (moveEvent: PointerEvent) => {
      width = Math.min(600, Math.max(80, startWidth + moveEvent.clientX - startX));
      setResizing({ fieldId: field.id, width });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setResizing(null);
      if (Math.round(width) !== startWidth) props.onResizeField(field, Math.round(width));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const selectedVisibleCount = useMemo(() => {
    if (!selectedIds?.size) return 0;
    let count = 0;
    for (const r of records) if (selectedIds.has(r.id)) count += 1;
    return count;
  }, [records, selectedIds]);

  const allSelected = records.length > 0 && selectedVisibleCount === records.length;
  const someSelected = selectedVisibleCount > 0 && !allSelected;

  const headerH = 36;
  const header = (
    <div className="tb-sg-row tb-sg-head" role="row" style={{ gridTemplateColumns: template, height: headerH }}>
      <div className="tb-sg-num" role="columnheader">
        {selectable ? (
          <Checkbox
            aria-label="Select all records in view"
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            disabled={records.length === 0}
            onCheckedChange={(checked) => onToggleSelectAll?.(checked === true)}
          />
        ) : (
          <span className="tb-visually-hidden">Row</span>
        )}
      </div>
      {fields.map((field, col) => {
        const Icon = FIELD_ICONS[field.type];
        return (
          <div key={field.id} className="tb-sg-th" role="columnheader">
            <Menu
              label={`${field.name} field options`}
              buttonClassName="tb-sg-th-button"
              title={`${field.name} · options`}
              icon={<Icon size={13} aria-hidden="true" />}
              items={[
                { id: "edit", label: "Edit field", icon: <Pencil size={14} />, disabled: readOnly, onSelect: () => props.onEditField(field) },
                { id: "asc", label: "Sort ascending", icon: <ArrowDownAZ size={14} />, disabled: field.type === "attachment", onSelect: () => props.onSortField(field, "asc") },
                { id: "desc", label: "Sort descending", icon: <ArrowDownZA size={14} />, disabled: field.type === "attachment", onSelect: () => props.onSortField(field, "desc") },
                "divider",
                { id: "left", label: "Insert field left", icon: <Plus size={14} />, disabled: readOnly, onSelect: () => props.onAddField(col) },
                { id: "right", label: "Insert field right", icon: <Plus size={14} />, disabled: readOnly, onSelect: () => props.onAddField(col + 1) },
                { id: "move-left", label: "Move left", icon: <ArrowLeft size={14} />, disabled: readOnly || col === 0, onSelect: () => props.onMoveField(field, -1) },
                { id: "move-right", label: "Move right", icon: <ArrowRight size={14} />, disabled: readOnly || col === fields.length - 1, onSelect: () => props.onMoveField(field, 1) },
                { id: "hide", label: "Hide in this view", icon: <EyeOff size={14} />, disabled: field.id === primaryField, onSelect: () => props.onHideField(field) },
                "divider",
                { id: "delete", label: "Delete field", icon: <Trash2 size={14} />, danger: true, disabled: readOnly || field.id === primaryField, onSelect: () => props.onDeleteField(field) },
              ]}
            >
              <span className="tb-sg-th-name">{field.name}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </Menu>
            {!readOnly && (
              <span
                className="tb-sg-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${field.name}`}
                onPointerDown={(event) => beginResize(event, field)}
              />
            )}
          </div>
        );
      })}
      <div className="tb-sg-th tb-sg-add" role="columnheader">
        <button type="button" className="tb-icon-button" aria-label="Add field" title="Add field" disabled={readOnly} onClick={() => props.onAddField(fields.length)}>
          <Plus size={15} />
        </button>
      </div>
    </div>
  );

  const rows: React.ReactNode[] = [];
  for (let itemIndex = first; itemIndex < last; itemIndex += 1) {
    const entry = items[itemIndex];
    if (entry.kind === "group") {
      const isCollapsed = collapsed.has(entry.id);
      rows.push(
        <div key={`g:${entry.id}`} className="tb-sg-row tb-sg-group" role="row" style={{ top: itemIndex * rowH + headerH, height: rowH, width: totalWidth }}>
          <div role="gridcell" aria-colspan={fields.length + 2} className="tb-sg-group-cell">
            <button
              type="button"
              className="tb-link-button"
              aria-expanded={!isCollapsed}
              onClick={() =>
                setCollapsed((set) => {
                  const next = new Set(set);
                  if (next.has(entry.id)) next.delete(entry.id);
                  else next.add(entry.id);
                  return next;
                })
              }
            >
              <ChevronDown size={14} className={isCollapsed ? "is-collapsed" : ""} aria-hidden="true" />
              {entry.id ? <ChoiceChip choice={{ id: entry.id, label: entry.label, color: entry.color }} /> : <span className="tb-muted">{entry.label}</span>}
              <small>{entry.count}</small>
            </button>
            {!readOnly && (
              <button type="button" className="tb-link-button" onClick={() => props.onAddRecord({ fieldId: groupField!.id, value: entry.id || null })}>
                <Plus size={13} /> Add
              </button>
            )}
          </div>
        </div>,
      );
      continue;
    }
    const { record, index } = entry;
    const isOpen = openRecordId === record.id;
    const isSelected = Boolean(selectedIds?.has(record.id));
    rows.push(
      <div
        key={record.id}
        className={`tb-sg-row ${isOpen ? "is-open" : ""} ${isSelected ? "is-selected" : ""} ${record.example ? "is-example" : ""}`}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={isOpen || isSelected}
        style={{ top: itemIndex * rowH + headerH, height: rowH, gridTemplateColumns: template }}
        onContextMenu={() => {
          const fallbackField = fields[Math.max(0, active.col)] || fields[0];
          if (fallbackField) setCtxTarget({ itemIndex, col: Math.max(0, active.col), record, field: fallbackField });
        }}
      >
        <div className={`tb-sg-num ${selectable ? "is-selectable" : ""}`} role="rowheader">
          {selectable && (
            <span className={`tb-sg-row-check ${isSelected ? "is-checked" : ""}`} onClick={(e) => e.stopPropagation()}>
              <Checkbox
                aria-label={`Select record ${index + 1}`}
                checked={isSelected}
                onCheckedChange={(checked) => onToggleSelect?.(record.id, checked === true)}
              />
            </span>
          )}
          <span className="tb-sg-index">{index + 1}</span>
          <button
            type="button"
            className="tb-sg-expand"
            aria-label={`Open record ${index + 1}`}
            title="Open record (Shift+Enter)"
            onClick={() => props.onOpenRecord(record.id)}
          >
            <Maximize2 size={12} />
          </button>
          {record.example && <span className="tb-example-dot" title="Example row">Ex</span>}
        </div>
        {fields.map((field, col) => {
          const isActive = active.item === itemIndex && active.col === col;
          const isEditing = editing?.recordId === record.id && editing.fieldId === field.id;
          return (
            <div
              key={field.id}
              role="gridcell"
              aria-selected={isActive}
              className={`tb-sg-cell is-${field.type} ${density === "tall" ? "is-tall" : ""} ${isActive ? "is-active" : ""} ${isEditing ? "is-editing" : ""} ${NUMERIC_TYPES.includes(field.type) ? "is-num" : ""}`}
              onMouseDown={() => {
                if (!isEditing) {
                  setActive({ item: itemIndex, col });
                  if (editing) setEditing(null);
                }
              }}
              onContextMenu={(ev) => {
                ev.stopPropagation();
                setActive({ item: itemIndex, col });
                setCtxTarget({ itemIndex, col, record, field });
              }}
              onDoubleClick={() => startEdit(itemIndex, col)}
              onClick={() => {
                if (field.type === "checkbox" && isActive && !readOnly) {
                  props.onCommit(record.id, field.id, record.values[field.id] !== true);
                }
              }}
            >
              {isEditing ? (
                <InlineEditor
                  field={field}
                  value={record.values[field.id]}
                  initialText={editing?.initialText}
                  people={people}
                  onCommit={(value, newChoices) => {
                    setEditing(null);
                    props.onCommit(record.id, field.id, value, newChoices);
                    focusGrid();
                  }}
                  onCancel={() => {
                    setEditing(null);
                    focusGrid();
                  }}
                  onMove={(direction) => {
                    moveActive(
                      direction === "down" ? 1 : direction === "up" ? -1 : 0,
                      direction === "right" ? 1 : direction === "left" ? -1 : 0,
                    );
                  }}
                />
              ) : (
                <ValueView field={field} value={record.values[field.id]} compact={density !== "tall"} />
              )}
            </div>
          );
        })}
        <div className="tb-sg-cell tb-sg-tail" role="gridcell">
          {canReorder && !readOnly && isOpen && (
            <span className="tb-sg-move">
              <button type="button" className="tb-icon-button" aria-label="Move record up" onClick={() => props.onMoveRecord(record.id, -1)} disabled={index === 0}>
                ↑
              </button>
              <button type="button" className="tb-icon-button" aria-label="Move record down" onClick={() => props.onMoveRecord(record.id, 1)} disabled={index === records.length - 1}>
                ↓
              </button>
            </span>
          )}
        </div>
      </div>,
    );
  }

  const bodyHeight = items.length * rowH;
  const activeRecord = ctxTarget?.record || recordAt(active.item);
  const activeField = ctxTarget?.field || fields[active.col] || fields[0];
  const activeItemIndex = ctxTarget?.itemIndex ?? active.item;
  const activeColIndex = ctxTarget?.col ?? active.col;
  const activeOrderIndex = activeRecord ? records.findIndex((r) => r.id === activeRecord.id) : -1;

  return (
    <div className="tb-sg-wrap">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`tb-sg is-density-${density}`}
            ref={scroller}
            role="grid"
            aria-rowcount={records.length + 1}
            aria-colcount={fields.length + 1}
            aria-label="Records"
            tabIndex={0}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={onKeyDown}
            onFocus={(event) => {
              if (event.target === event.currentTarget && active.item < 0 && items.length) {
                setActive({ item: items.findIndex((entry) => entry.kind === "record"), col: 0 });
              }
            }}
          >
            <div className="tb-sg-canvas" style={{ height: bodyHeight + headerH + 72, width: totalWidth }}>
              {header}
              {rows}
              <div className="tb-sg-row tb-sg-addrow" style={{ top: bodyHeight + headerH, height: 36, width: totalWidth }}>
                <button type="button" className="tb-link-button" disabled={readOnly} onClick={() => props.onAddRecord()}>
                  <Plus size={14} /> Add record
                </button>
              </div>
              <div className="tb-sg-row tb-sg-foot" role="row" style={{ top: bodyHeight + headerH + 36, height: 36, gridTemplateColumns: template }}>
                <div className="tb-sg-num" role="rowheader" title="Visible records">
                  <small>{records.length}</small>
                </div>
                {fields.map((field) => {
                  const mode = summaryModes?.[field.id] || "auto";
                  const isNumeric = NUMERIC_TYPES.includes(field.type);
                  const text = formatSummaryText(field, records, mode);
                  return (
                    <div key={field.id} className={`tb-sg-cell tb-sg-foot-cell ${isNumeric ? "is-num" : ""}`} role="gridcell">
                      {onChangeSummaryMode ? (
                        <Menu
                          label={`${field.name} summary calculation`}
                          buttonClassName="tb-sg-foot-btn"
                          title={`Summary calculation for ${field.name}`}
                          items={[
                            { id: "auto", label: "Auto summary", icon: <Sigma size={13} />, onSelect: () => onChangeSummaryMode(field.id, "auto") },
                            { id: "none", label: "None", onSelect: () => onChangeSummaryMode(field.id, "none") },
                            "divider",
                            { id: "count", label: "Count all", onSelect: () => onChangeSummaryMode(field.id, "count") },
                            { id: "filled", label: "Filled", onSelect: () => onChangeSummaryMode(field.id, "filled") },
                            { id: "empty", label: "Empty", onSelect: () => onChangeSummaryMode(field.id, "empty") },
                            { id: "percent_filled", label: "Percent filled", onSelect: () => onChangeSummaryMode(field.id, "percent_filled") },
                            ...(isNumeric
                              ? [
                                  "divider" as const,
                                  { id: "sum", label: "Sum", onSelect: () => onChangeSummaryMode(field.id, "sum") },
                                  { id: "avg", label: "Average", onSelect: () => onChangeSummaryMode(field.id, "avg") },
                                  { id: "min", label: "Min", onSelect: () => onChangeSummaryMode(field.id, "min") },
                                  { id: "max", label: "Max", onSelect: () => onChangeSummaryMode(field.id, "max") },
                                ]
                              : []),
                          ]}
                        >
                          <small>{text}</small>
                        </Menu>
                      ) : (
                        <small>{text}</small>
                      )}
                    </div>
                  );
                })}
                <div />
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-60">
          <ContextMenuGroup>
            <ContextMenuLabel>{activeRecord ? `Record #${activeOrderIndex + 1}` : "Smart Table"}</ContextMenuLabel>
            <ContextMenuItem disabled={!activeRecord} onClick={() => activeRecord && props.onOpenRecord(activeRecord.id)}>
              <Maximize2 size={14} /> Open record details
              <ContextMenuShortcut>Shift+Enter</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly || !activeRecord || !activeField || activeItemIndex < 0}
              onClick={() => activeItemIndex >= 0 && startEdit(activeItemIndex, Math.max(0, activeColIndex))}
            >
              <Pencil size={14} /> Edit cell
              <ContextMenuShortcut>Enter</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!activeRecord || !activeField}
              onClick={() => activeRecord && activeField && copyCellValue(activeRecord, activeField)}
            >
              <Copy size={14} /> Copy cell value
              <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly || !activeRecord || !activeField}
              onClick={() => activeRecord && activeField && props.onCommit(activeRecord.id, activeField.id, null)}
            >
              <Eraser size={14} /> Clear cell
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>

          <ContextMenuSeparator />

          <ContextMenuGroup>
            <ContextMenuItem disabled={readOnly} onClick={() => props.onAddRecord()}>
              <Plus size={14} /> New record
            </ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly || !activeRecord || !props.onDuplicateRecord}
              onClick={() => activeRecord && props.onDuplicateRecord?.(activeRecord.id)}
            >
              <Copy size={14} /> Duplicate record
            </ContextMenuItem>
            {canReorder && (
              <>
                <ContextMenuItem
                  disabled={readOnly || !activeRecord || activeOrderIndex <= 0}
                  onClick={() => activeRecord && props.onMoveRecord(activeRecord.id, -1)}
                >
                  <ArrowUp size={14} /> Move record up
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={readOnly || !activeRecord || activeOrderIndex < 0 || activeOrderIndex >= records.length - 1}
                  onClick={() => activeRecord && props.onMoveRecord(activeRecord.id, 1)}
                >
                  <ArrowDown size={14} /> Move record down
                </ContextMenuItem>
              </>
            )}
          </ContextMenuGroup>

          <ContextMenuSeparator />

          <ContextMenuItem
            variant="destructive"
            disabled={readOnly || !activeRecord || !props.onRequestDeleteRecord}
            onClick={() => activeRecord && props.onRequestDeleteRecord?.(activeRecord.id)}
          >
            <Trash2 size={14} /> Delete record…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {records.length === 0 && (
        <p className="tb-sg-empty tb-muted">
          No records match this view. {readOnly ? "" : "Add a record or change the view's filters."}
        </p>
      )}
      <p className="tb-visually-hidden" aria-live="polite">
        {plural(records.length, "record")} in this view.
      </p>
    </div>
  );
}
