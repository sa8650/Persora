// Persora Table — Smart Table editor: organized ReUI Menubar + structured view/action toolbar,
// multi-view workspace (Table, Board, Calendar, Gallery), quick Sort/Filter/Group/Fields/Density tools,
// bulk row actions, per-column summaries, record panel, summary & charts, and export.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ, ArrowDownZA, ArrowUpDown, CalendarDays, ChartColumn, Check, ClipboardCopy, Columns3, Copy,
  Database, Download, Eye, EyeOff, Filter, FolderTree, GalleryHorizontalEnd, KanbanSquare, MoreHorizontal,
  Plus, Rows3, Search, SlidersHorizontal, Table2, Trash2, X,
} from "lucide-react";
import {
  FIELD_TYPES, TABLE_LIMITS, VIEW_TYPES, applyView, isEmptyValue, newField, newView, viewSetupProblem,
  type AttachmentRef, type ChartConfig, type Choice, type Field, type FieldType, type FieldValue,
  type SmartMeta, type TableRecord, type TableView, type ViewType,
} from "../../../cloudflare/table-rules.js";
import { smartCsvRows, smartXlsxSheet } from "../../../cloudflare/table-io.js";
import {
  listTablePeople, tableErrorMessage, uploadTableAttachment, type TableAttachmentInfo, type TablePerson,
} from "../../lib/table/table-api";
import type { TransferProgress } from "../../types";
import { exportCsv, exportXlsx, safeDownloadName } from "../../lib/table/table-files";
import type { TableDoc } from "../../lib/table/table-sync";
import {
  Badge,
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
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/design-system";
import { ConfirmDialog } from "../VaultDialogs";
import ModalPortal from "../ModalPortal";
import type { Commit } from "./TableEditor";
import SmartGrid, { FIELD_ICONS, type SmartRowDensity, type SmartSummaryMode } from "./SmartGrid";
import { BoardView, CalendarView, GalleryView } from "./SmartViews";
import RecordPanel from "./RecordPanel";
import FieldDialog, { type FieldSaveResult } from "./FieldDialog";
import ViewSettingsDialog from "./ViewSettingsDialog";
import SummaryPanel from "./SummaryPanel";
import ExportDialog from "./ExportDialog";
import { releaseAttachmentUrls } from "./attachments";
import { ValueView, editTextOf } from "./smart-cells";
import { Menu, newId, plural } from "./table-ui";

type SmartDoc = Extract<TableDoc, { kind: "smart" }>;

const VIEW_ICONS: Record<ViewType, typeof Table2> = {
  table: Table2,
  board: KanbanSquare,
  calendar: CalendarDays,
  gallery: GalleryHorizontalEnd,
};
const POSITION_STEP = 1024;

interface SmartUiPrefs {
  density: SmartRowDensity;
  summaries: Record<string, SmartSummaryMode>;
}

function readSmartUiPrefs(tableId: string, viewId: string): SmartUiPrefs {
  try {
    const raw = window.localStorage.getItem(`persora-smart-ui:${tableId}:${viewId}`);
    if (!raw) return { density: "standard", summaries: {} };
    const parsed = JSON.parse(raw) as Partial<SmartUiPrefs>;
    const density: SmartRowDensity =
      parsed.density === "compact" || parsed.density === "tall" ? parsed.density : "standard";
    const summaries = parsed.summaries && typeof parsed.summaries === "object" ? parsed.summaries : {};
    return { density, summaries };
  } catch {
    return { density: "standard", summaries: {} };
  }
}

function writeSmartUiPrefs(tableId: string, viewId: string, prefs: SmartUiPrefs) {
  try {
    window.localStorage.setItem(`persora-smart-ui:${tableId}:${viewId}`, JSON.stringify(prefs));
  } catch {
    // Non-critical UI preference.
  }
}

function useIsMobile() {
  const query = "(max-width: 640px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return Boolean(mobile);
}

/** Removes every reference to a field from views and charts. */
function withoutField(meta: SmartMeta, fieldId: string): SmartMeta {
  return {
    ...meta,
    fields: meta.fields.filter((field) => field.id !== fieldId),
    views: meta.views.map((view) => ({
      ...view,
      filters: view.filters.filter((filter) => filter.fieldId !== fieldId),
      sort: view.sort.filter((entry) => entry.fieldId !== fieldId),
      hidden: view.hidden.filter((id) => id !== fieldId),
      groupBy: view.groupBy === fieldId ? null : view.groupBy,
      dateField: view.dateField === fieldId ? null : view.dateField,
      coverField: view.coverField === fieldId ? null : view.coverField,
    })),
    charts: meta.charts
      .filter((chart) => chart.groupField !== fieldId)
      .map((chart) => (chart.valueField === fieldId ? { ...chart, valueField: null, aggregate: "count" as const } : chart)),
  };
}

export default function SmartTableEditor({
  doc,
  tableId,
  tableName,
  commit,
  readOnly,
  notify,
  attachments,
  onAttachmentAdded,
  canUpload,
  maxUploadMb,
  onUpgrade,
}: {
  doc: SmartDoc;
  tableId: string;
  tableName: string;
  commit: Commit;
  readOnly: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  attachments: TableAttachmentInfo[];
  onAttachmentAdded: (info: TableAttachmentInfo) => void;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
}) {
  const { meta, records } = doc;
  const docRef = useRef(doc);
  docRef.current = doc;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile();

  const [activeViewId, setActiveViewId] = useState(meta.views[0].id);
  const view = meta.views.find((entry) => entry.id === activeViewId) || meta.views[0];
  const [search, setSearch] = useState("");
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [fieldDialog, setFieldDialog] = useState<{ field: Field | null; index: number } | null>(null);
  const [viewSettings, setViewSettings] = useState(false);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: "field"; field: Field }
    | { kind: "record"; id: string }
    | { kind: "bulk"; ids: string[] }
    | { kind: "view"; view: TableView }
    | { kind: "examples" }
    | { kind: "empty-rows"; ids: string[] }
  >(null);
  const [showSummary, setShowSummary] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [people, setPeople] = useState<TablePerson[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ fieldId: string; progress: TransferProgress } | null>(null);
  const [uiPrefs, setUiPrefs] = useState<SmartUiPrefs>(() => readSmartUiPrefs(tableId, view.id));
  const [groupCollapseSignal, setGroupCollapseSignal] = useState<{ mode: "expand" | "collapse"; nonce: number } | null>(null);

  useEffect(() => () => releaseAttachmentUrls(tableId), [tableId]);
  useEffect(() => {
    if (!meta.views.some((entry) => entry.id === activeViewId)) setActiveViewId(meta.views[0].id);
  }, [meta.views, activeViewId]);
  useEffect(() => {
    setUiPrefs(readSmartUiPrefs(tableId, view.id));
    setSelectedIds(new Set());
  }, [tableId, view.id]);

  // Prune deleted records from selection
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const existing = new Set(records.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (existing.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [records]);

  const hasPersonField = meta.fields.some((field) => field.type === "person");
  useEffect(() => {
    if (!hasPersonField || people) return;
    listTablePeople().then(setPeople).catch(() => setPeople([]));
  }, [hasPersonField, people]);
  useEffect(() => {
    if (openRecordId && !records.some((record) => record.id === openRecordId)) setOpenRecordId(null);
  }, [records, openRecordId]);

  const visibleFields = useMemo(
    () => meta.fields.filter((field) => !view.hidden.includes(field.id) || field.id === meta.primaryField),
    [meta.fields, view.hidden, meta.primaryField],
  );
  const hiddenCount = meta.fields.length - visibleFields.length;
  const viewRecords = useMemo(() => applyView(meta.fields, records, view, search), [meta.fields, records, view, search]);
  const problem = viewSetupProblem(view, meta.fields);
  const exampleCount = useMemo(() => records.filter((record) => record.example).length, [records]);
  const groupableFields = useMemo(
    () => meta.fields.filter((f) => f.type === "status" || f.type === "select"),
    [meta.fields],
  );
  const emptyRecordIds = useMemo(
    () =>
      records
        .filter((rec) => meta.fields.every((f) => isEmptyValue(rec.values[f.id])))
        .map((rec) => rec.id),
    [records, meta.fields],
  );

  const updateDensity = (density: SmartRowDensity) => {
    setUiPrefs((prev) => {
      const next = { ...prev, density };
      writeSmartUiPrefs(tableId, view.id, next);
      return next;
    });
  };

  const updateSummaryMode = (fieldId: string, mode: SmartSummaryMode) => {
    setUiPrefs((prev) => {
      const next = { ...prev, summaries: { ...prev.summaries, [fieldId]: mode } };
      writeSmartUiPrefs(tableId, view.id, next);
      return next;
    });
  };

  // ---- document updates (always from the latest document) ----------------------------------------
  const save = useCallback(
    (next: Partial<Pick<SmartDoc, "meta" | "records">>, label: string) => {
      const current = docRef.current;
      commit({ kind: "smart", meta: next.meta ?? current.meta, records: next.records ?? current.records }, label);
    },
    [commit],
  );

  const setValue = useCallback(
    (recordId: string, fieldId: string, value: FieldValue, newChoices?: Choice[]) => {
      if (readOnly) return;
      const current = docRef.current;
      const field = current.meta.fields.find((entry) => entry.id === fieldId);
      if (!field) return;
      let nextMeta = current.meta;
      if (newChoices?.length) {
        if ((field.choices?.length || 0) + newChoices.length > TABLE_LIMITS.choices) {
          notify(`A field can have at most ${TABLE_LIMITS.choices} options.`, "error");
          return;
        }
        nextMeta = {
          ...current.meta,
          fields: current.meta.fields.map((entry) =>
            entry.id === fieldId ? { ...entry, choices: [...(entry.choices || []), ...newChoices] } : entry,
          ),
        };
      }
      let changed = false;
      const nextRecords = current.records.map((record) => {
        if (record.id !== recordId) return record;
        const before = record.values[fieldId];
        if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) return record;
        changed = true;
        const values = { ...record.values };
        if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete values[fieldId];
        else values[fieldId] = value;
        return { ...record, values };
      });
      if (!changed && nextMeta === current.meta) return;
      save({ meta: nextMeta, records: nextRecords }, `Edit ${field.name}`);
    },
    [readOnly, notify, save],
  );

  const addRecord = (groupValue?: { fieldId: string; value: string | null }, openPanel = true) => {
    if (readOnly) return;
    const current = docRef.current;
    if (current.records.length >= TABLE_LIMITS.records) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.records.toLocaleString()} records.`, "error");
      return;
    }
    const position = current.records.reduce((max, record) => Math.max(max, record.position), 0) + POSITION_STEP;
    const values: Record<string, FieldValue> = {};
    if (groupValue?.value) values[groupValue.fieldId] = groupValue.value;
    const record: TableRecord = { id: newId(), position, values };
    save({ records: [...current.records, record] }, "Add record");
    if (openPanel) setOpenRecordId(record.id);
    if (applyView(current.meta.fields, [record], view, search).length === 0) {
      notify("Record added. It's hidden by this view's filters or search until you fill it in.");
    }
  };

  const addMultipleBlankRows = (count: number) => {
    if (readOnly) return;
    const current = docRef.current;
    const allowed = Math.min(count, TABLE_LIMITS.records - current.records.length);
    if (allowed <= 0) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.records.toLocaleString()} records.`, "error");
      return;
    }
    let pos = current.records.reduce((max, record) => Math.max(max, record.position), 0);
    const added: TableRecord[] = [];
    for (let i = 0; i < allowed; i += 1) {
      pos += POSITION_STEP;
      added.push({ id: newId(), position: pos, values: {} });
    }
    save({ records: [...current.records, ...added] }, `Add ${allowed} records`);
    notify(`Added ${plural(allowed, "blank row")}.`, "success");
  };

  const duplicateRecord = (id: string) => {
    const current = docRef.current;
    const index = current.records.findIndex((record) => record.id === id);
    if (index < 0) return;
    if (current.records.length >= TABLE_LIMITS.records) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.records.toLocaleString()} records.`, "error");
      return;
    }
    const source = current.records[index];
    const nextPosition = current.records[index + 1]?.position;
    const position =
      nextPosition !== undefined && nextPosition - source.position > 1
        ? (source.position + nextPosition) / 2
        : current.records.reduce((max, record) => Math.max(max, record.position), 0) + POSITION_STEP;
    const copy: TableRecord = { id: newId(), position, values: structuredClone(source.values) };
    const list = [...current.records];
    list.splice(index + 1, 0, copy);
    save({ records: list }, "Duplicate record");
    setOpenRecordId(copy.id);
    notify("Record duplicated.");
  };

  const duplicateSelectedRecords = () => {
    if (readOnly || !selectedIds.size) return;
    const current = docRef.current;
    const sources = current.records.filter((r) => selectedIds.has(r.id));
    if (!sources.length) return;
    if (current.records.length + sources.length > TABLE_LIMITS.records) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.records.toLocaleString()} records.`, "error");
      return;
    }
    let pos = current.records.reduce((max, record) => Math.max(max, record.position), 0);
    const copies = sources.map((src) => {
      pos += POSITION_STEP;
      return { id: newId(), position: pos, values: structuredClone(src.values) };
    });
    save({ records: [...current.records, ...copies] }, `Duplicate ${copies.length} records`);
    setSelectedIds(new Set(copies.map((c) => c.id)));
    notify(`Duplicated ${plural(copies.length, "record")}.`, "success");
  };

  const deleteRecords = (ids: Set<string>, label: string) => {
    const current = docRef.current;
    save({ records: current.records.filter((record) => !ids.has(record.id)) }, label);
    if (openRecordId && ids.has(openRecordId)) setOpenRecordId(null);
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    notify(`${ids.size === 1 ? "Record" : plural(ids.size, "record")} deleted. Press Ctrl+Z or Undo to bring ${ids.size === 1 ? "it" : "them"} back.`);
  };

  const moveRecord = (id: string, delta: -1 | 1) => {
    const current = docRef.current;
    const ordered = [...current.records].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((record) => record.id === id);
    const other = ordered[index + delta];
    if (index < 0 || !other) return;
    const a = ordered[index];
    save(
      {
        records: current.records.map((record) =>
          record.id === a.id ? { ...record, position: other.position } : record.id === other.id ? { ...record, position: a.position } : record,
        ),
      },
      "Move record",
    );
  };

  // ---- fields ----------------------------------------------------------------------------------------------
  const saveField = ({ field, values }: FieldSaveResult) => {
    const current = docRef.current;
    const exists = current.meta.fields.some((entry) => entry.id === field.id);
    if (!exists && current.meta.fields.length >= TABLE_LIMITS.fields) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.fields} fields.`, "error");
      return;
    }
    let fields: Field[];
    if (exists) fields = current.meta.fields.map((entry) => (entry.id === field.id ? field : entry));
    else {
      fields = [...current.meta.fields];
      fields.splice(Math.min(fieldDialog?.index ?? fields.length, fields.length), 0, field);
    }
    const nextRecords = values?.size
      ? current.records.map((record) =>
          values.has(record.id) ? { ...record, values: { ...record.values, [field.id]: values.get(record.id)! } } : record,
        )
      : current.records;
    save({ meta: { ...current.meta, fields }, records: nextRecords }, exists ? `Edit field ${field.name}` : `Add field ${field.name}`);
    setFieldDialog(null);
  };

  const quickAddTypedField = (type: FieldType) => {
    if (readOnly) return;
    const current = docRef.current;
    if (current.meta.fields.length >= TABLE_LIMITS.fields) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.fields} fields.`, "error");
      return;
    }
    const typeLabel = FIELD_TYPES.find((t) => t.id === type)?.label || "Field";
    const existingNames = new Set(current.meta.fields.map((f) => f.name.toLowerCase()));
    let candidate = typeLabel;
    let n = 2;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `${typeLabel} ${n++}`;
    }
    const created = newField(candidate, type);
    save({ meta: { ...current.meta, fields: [...current.meta.fields, created] } }, `Add field ${created.name}`);
    notify(`Added “${created.name}” field.`, "success");
  };

  const deleteField = (field: Field) => {
    const current = docRef.current;
    save(
      {
        meta: withoutField(current.meta, field.id),
        records: current.records.map((record) => {
          if (!(field.id in record.values)) return record;
          const values = { ...record.values };
          delete values[field.id];
          return { ...record, values };
        }),
      },
      `Delete field ${field.name}`,
    );
    notify(`Field “${field.name}” deleted. Press Ctrl+Z or Undo to restore it with its values.`);
  };

  const moveField = (field: Field, delta: -1 | 1) => {
    const current = docRef.current;
    const visibleIds = visibleFields.map((entry) => entry.id);
    const target = visibleIds[visibleIds.indexOf(field.id) + delta];
    if (!target) return;
    const fields = [...current.meta.fields];
    const from = fields.findIndex((entry) => entry.id === field.id);
    const to = fields.findIndex((entry) => entry.id === target);
    [fields[from], fields[to]] = [fields[to], fields[from]];
    save({ meta: { ...current.meta, fields } }, "Move field");
  };

  const setView = (next: TableView, label: string) => {
    const current = docRef.current;
    save({ meta: { ...current.meta, views: current.meta.views.map((entry) => (entry.id === next.id ? next : entry)) } }, label);
  };

  const toggleFieldHidden = (field: Field) => {
    if (field.id === meta.primaryField) return;
    const isHidden = view.hidden.includes(field.id);
    const hidden = isHidden ? view.hidden.filter((id) => id !== field.id) : [...view.hidden, field.id];
    setView({ ...view, hidden }, isHidden ? `Show ${field.name}` : `Hide ${field.name}`);
  };

  const showAllFields = () => {
    if (!view.hidden.length) return;
    setView({ ...view, hidden: [] }, "Show all fields");
  };

  const addView = (type: ViewType) => {
    const current = docRef.current;
    if (current.meta.views.length >= TABLE_LIMITS.views) {
      notify(`A Smart Table can have up to ${TABLE_LIMITS.views} views.`, "error");
      return;
    }
    const fresh = newView(type);
    const names = new Set(current.meta.views.map((entry) => entry.name.toLowerCase()));
    let name = fresh.name;
    let n = 2;
    while (names.has(name.toLowerCase())) name = `${fresh.name} ${n++}`;
    const defaultGroup = current.meta.fields.find((field) => field.type === "status") || current.meta.fields.find((field) => field.type === "select");
    const next: TableView = {
      ...fresh,
      name,
      groupBy: type === "board" ? defaultGroup?.id || null : null,
      dateField: type === "calendar" ? current.meta.fields.find((field) => field.type === "date")?.id || null : null,
      coverField: type === "gallery" ? current.meta.fields.find((field) => field.type === "attachment")?.id || null : null,
    };
    save({ meta: { ...current.meta, views: [...current.meta.views, next] } }, `Add ${name} view`);
    setActiveViewId(next.id);
  };

  const setCharts = (charts: ChartConfig[], label: string) => save({ meta: { ...docRef.current.meta, charts } }, label);

  // ---- attachments ------------------------------------------------------------------------------------------
  const upload = async (recordId: string, fieldId: string, files: FileList) => {
    if (readOnly) return;
    if (!canUpload) {
      notify("Attaching files needs a Persora plan with file uploads.", "error");
      onUpgrade?.();
      return;
    }
    setUploading(fieldId);
    setUploadProgress(null);
    try {
      for (const file of [...files]) {
        const record = docRef.current.records.find((entry) => entry.id === recordId);
        const existing = record && Array.isArray(record.values[fieldId]) ? (record.values[fieldId] as AttachmentRef[]) : [];
        if (existing.length >= TABLE_LIMITS.attachmentsPerCell) {
          notify(`Up to ${TABLE_LIMITS.attachmentsPerCell} files per field.`, "error");
          break;
        }
        if (file.size > maxUploadMb * 1024 * 1024) {
          notify(`“${file.name}” is larger than your plan's ${maxUploadMb} MB upload limit.`, "error");
          continue;
        }
        if (!file.size) {
          notify(`“${file.name}” is empty.`, "error");
          continue;
        }
        const { info, ref } = await uploadTableAttachment(tableId, file, newId(), (progress) => setUploadProgress({ fieldId, progress }));
        onAttachmentAdded(info);
        const latest = docRef.current.records.find((entry) => entry.id === recordId);
        if (!latest) {
          notify("The record was removed while the file uploaded. The file wasn't attached.", "error");
          break;
        }
        const current = Array.isArray(latest.values[fieldId]) ? (latest.values[fieldId] as AttachmentRef[]) : [];
        setValue(recordId, fieldId, [...current, ref]);
      }
    } catch (error) {
      notify(tableErrorMessage(error, "The file couldn't be uploaded. Check your connection and try again."), "error");
    } finally {
      setUploading(null);
      setUploadProgress(null);
    }
  };

  const exportFile = async (format: "csv" | "xlsx", recordsOverride?: TableRecord[]) => {
    const targetRecords = recordsOverride ?? viewRecords;
    const name = view === meta.views[0] ? tableName : `${tableName} - ${view.name}`;
    if (format === "csv") await exportCsv(smartCsvRows(visibleFields, targetRecords), safeDownloadName(name, "csv"));
    else await exportXlsx([smartXlsxSheet(view.name, visibleFields, targetRecords)], safeDownloadName(name, "xlsx"));
  };

  const copyViewAsTsv = async () => {
    const rows = smartCsvRows(visibleFields, viewRecords);
    const tsv = rows.map((r) => r.map((cell) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      notify(`Copied ${plural(viewRecords.length, "record")} to clipboard.`, "success");
    } catch {
      notify("Clipboard access isn't available in this browser context.", "error");
    }
  };

  const copyCellText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Cell value copied.", "success");
    } catch {
      notify("Couldn't copy to clipboard.", "error");
    }
  };

  const onSmartKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  };

  const openRecord = records.find((record) => record.id === openRecordId) || null;
  const canReorder = view.sort.length === 0 && !search.trim() && view.filters.length === 0 && !view.groupBy;
  const groupField =
    view.type === "table" && view.groupBy
      ? meta.fields.find((field) => field.id === view.groupBy && (field.type === "select" || field.type === "status")) || null
      : null;
  const activeSortField = view.sort[0] ? meta.fields.find((f) => f.id === view.sort[0].fieldId) : null;

  const viewMenu = (
    <Menu
      label="Add view"
      icon={<Plus size={14} />}
      buttonClassName="tb-view-add"
      items={VIEW_TYPES.map((entry) => {
        const Icon = VIEW_ICONS[entry.id];
        return {
          id: entry.id,
          label: `${entry.label} view`,
          icon: <Icon size={14} />,
          disabled: readOnly || meta.views.length >= TABLE_LIMITS.views,
          onSelect: () => addView(entry.id),
        };
      })}
    />
  );

  const content = () => {
    if (problem) {
      return (
        <div className="tb-setup" role="status">
          <p>{problem}</p>
          <div className="tb-empty-actions">
            {!readOnly && (
              <button type="button" className="tb-secondary-button" onClick={() => setViewSettings(true)}>
                <SlidersHorizontal size={14} /> View settings
              </button>
            )}
            {!readOnly && (
              <button type="button" className="tb-secondary-button" onClick={() => setFieldDialog({ field: null, index: meta.fields.length })}>
                <Plus size={14} /> Add field
              </button>
            )}
          </div>
        </div>
      );
    }
    if (view.type === "board") {
      return (
        <BoardView
          view={view}
          fields={visibleFields}
          records={viewRecords}
          primaryField={meta.primaryField}
          readOnly={readOnly}
          onOpenRecord={setOpenRecordId}
          onSetValue={(id, fieldId, value) => setValue(id, fieldId, value)}
          onAddRecord={(grp) => addRecord(grp)}
        />
      );
    }
    if (view.type === "calendar") {
      return (
        <CalendarView
          view={view}
          fields={visibleFields}
          records={viewRecords}
          primaryField={meta.primaryField}
          readOnly={readOnly}
          onOpenRecord={setOpenRecordId}
          onAddRecord={(grp) => addRecord(grp)}
        />
      );
    }
    if (view.type === "gallery") {
      return <GalleryView view={view} fields={visibleFields} records={viewRecords} primaryField={meta.primaryField} tableId={tableId} onOpenRecord={setOpenRecordId} />;
    }
    if (mobile) {
      const primary = meta.fields.find((field) => field.id === meta.primaryField);
      const others = visibleFields.filter((field) => field.id !== meta.primaryField).slice(0, 3);
      return (
        <div className="tb-mobile-list">
          {viewRecords.length ? (
            <ul>
              {viewRecords.map((record) => (
                <li key={record.id}>
                  <button type="button" className={`tb-mobile-record ${record.example ? "is-example" : ""}`} onClick={() => setOpenRecordId(record.id)}>
                    <b>{primary ? editTextOf(primary, record.values[primary.id]) || "Untitled" : "Untitled"}</b>
                    {record.example && (
                      <Badge variant="warning-light" size="xs" className="tb-example-badge">
                        Example
                      </Badge>
                    )}
                    <span className="tb-mobile-fields">
                      {others.map((field) => (
                        <span key={field.id}>
                          <small>{field.name}</small>
                          <ValueView field={field} value={record.values[field.id]} compact />
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tb-muted tb-view-empty">No records match this view.</p>
          )}
          <button type="button" className="tb-secondary-button tb-mobile-add" disabled={readOnly} onClick={() => addRecord()}>
            <Plus size={15} /> Add record
          </button>
        </div>
      );
    }
    return (
      <SmartGrid
        fields={visibleFields}
        records={viewRecords}
        groupField={groupField}
        primaryField={meta.primaryField}
        people={people}
        readOnly={readOnly}
        openRecordId={openRecordId}
        canReorder={canReorder}
        density={uiPrefs.density}
        selectedIds={selectedIds}
        onToggleSelect={(recordId, checked) => {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(recordId);
            else next.delete(recordId);
            return next;
          });
        }}
        onToggleSelectAll={(checked) => {
          if (checked) setSelectedIds(new Set(viewRecords.map((r) => r.id)));
          else setSelectedIds(new Set());
        }}
        summaryModes={uiPrefs.summaries}
        onChangeSummaryMode={updateSummaryMode}
        groupCollapseSignal={groupCollapseSignal}
        onCommit={setValue}
        onOpenRecord={setOpenRecordId}
        onAddRecord={(grp) => addRecord(grp, false)}
        onDuplicateRecord={duplicateRecord}
        onRequestDeleteRecord={(id) => setConfirm({ kind: "record", id })}
        onCopyCellText={(text) => void copyCellText(text)}
        onMoveRecord={moveRecord}
        onEditField={(field) => setFieldDialog({ field, index: 0 })}
        onAddField={(index) => {
          const anchor = visibleFields[index];
          setFieldDialog({ field: null, index: anchor ? meta.fields.findIndex((field) => field.id === anchor.id) : meta.fields.length });
        }}
        onSortField={(field, dir) => setView({ ...view, sort: [{ fieldId: field.id, dir }] }, `Sort by ${field.name}`)}
        onHideField={(field) => setView({ ...view, hidden: [...view.hidden, field.id] }, `Hide ${field.name}`)}
        onMoveField={moveField}
        onDeleteField={(field) => setConfirm({ kind: "field", field })}
        onResizeField={(field, width) =>
          save({ meta: { ...docRef.current.meta, fields: docRef.current.meta.fields.map((entry) => (entry.id === field.id ? { ...entry, width } : entry)) } }, `Resize ${field.name}`)
        }
      />
    );
  };

  const showPanel = Boolean(openRecord);
  const selectedRecords = useMemo(() => viewRecords.filter((r) => selectedIds.has(r.id)), [viewRecords, selectedIds]);

  return (
    <div className="tb-smart-editor" onKeyDown={onSmartKeyDown}>
      {/* Tier 1: ReUI Menubar + View Switcher + Inline Search */}
      <nav className="tb-menubar tb-smart-menubar" aria-label="Smart Table menu bar">
        {!mobile && (
          <Menubar className="tb-reui-menubar">
            <MenubarMenu>
              <MenubarTrigger>Data</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarLabel>Records</MenubarLabel>
                  <MenubarItem disabled={readOnly} onClick={() => addRecord()}>
                    <Plus size={14} /> New record…
                  </MenubarItem>
                  <MenubarItem disabled={readOnly} onClick={() => addMultipleBlankRows(5)}>
                    <Rows3 size={14} /> Add 5 blank rows
                  </MenubarItem>
                  <MenubarItem disabled={readOnly || selectedIds.size === 0} onClick={duplicateSelectedRecords}>
                    <Copy size={14} /> Duplicate selected ({selectedIds.size})
                  </MenubarItem>
                  <MenubarItem
                    disabled={readOnly || emptyRecordIds.length === 0}
                    onClick={() => setConfirm({ kind: "empty-rows", ids: emptyRecordIds })}
                  >
                    <Trash2 size={14} /> Clear empty rows ({emptyRecordIds.length})
                  </MenubarItem>
                </MenubarGroup>
                <MenubarSeparator />
                <MenubarGroup>
                  <MenubarLabel>Share &amp; Export</MenubarLabel>
                  <MenubarItem onClick={() => void copyViewAsTsv()}>
                    <ClipboardCopy size={14} /> Copy view as TSV
                  </MenubarItem>
                  <MenubarItem onClick={() => void exportFile("csv")}>
                    <Download size={14} /> Export CSV (.csv)
                  </MenubarItem>
                  <MenubarItem onClick={() => void exportFile("xlsx")}>
                    <Download size={14} /> Export Excel (.xlsx)
                  </MenubarItem>
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger>Fields</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarItem disabled={readOnly} onClick={() => setFieldDialog({ field: null, index: meta.fields.length })}>
                    <Plus size={14} /> Custom field…
                  </MenubarItem>
                  <MenubarSub>
                    <MenubarSubTrigger disabled={readOnly}>
                      <Database size={14} /> Quick add field
                    </MenubarSubTrigger>
                    <MenubarSubContent>
                      {(["text", "number", "currency", "status", "select", "date", "checkbox", "person", "attachment"] as FieldType[]).map((type) => {
                        const Icon = FIELD_ICONS[type];
                        const label = FIELD_TYPES.find((f) => f.id === type)?.label || type;
                        return (
                          <MenubarItem key={type} disabled={readOnly} onClick={() => quickAddTypedField(type)}>
                            <Icon size={14} /> {label}
                          </MenubarItem>
                        );
                      })}
                    </MenubarSubContent>
                  </MenubarSub>
                </MenubarGroup>
                <MenubarSeparator />
                <MenubarGroup>
                  <MenubarLabel>Visible in “{view.name}”</MenubarLabel>
                  {meta.fields.map((field) => {
                    const isPrimary = field.id === meta.primaryField;
                    const visible = !view.hidden.includes(field.id) || isPrimary;
                    return (
                      <MenubarCheckboxItem
                        key={field.id}
                        checked={visible}
                        disabled={isPrimary}
                        onClick={() => toggleFieldHidden(field)}
                      >
                        {field.name} {isPrimary ? "(Primary)" : ""}
                      </MenubarCheckboxItem>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <>
                      <MenubarSeparator />
                      <MenubarItem onClick={showAllFields}>
                        <Eye size={14} /> Show all fields ({hiddenCount} hidden)
                      </MenubarItem>
                    </>
                  )}
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger>View</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarLabel>Configuration</MenubarLabel>
                  <MenubarItem onClick={() => setViewSettings(true)}>
                    <SlidersHorizontal size={14} /> Filter, sort &amp; group…
                  </MenubarItem>
                  <MenubarCheckboxItem checked={showSummary} onClick={() => setShowSummary((open) => !open)}>
                    Summary &amp; charts panel
                  </MenubarCheckboxItem>
                </MenubarGroup>
                <MenubarSeparator />
                <MenubarRadioGroup value={uiPrefs.density}>
                  <MenubarLabel>Row Density</MenubarLabel>
                  <MenubarRadioItem value="compact" onClick={() => updateDensity("compact")}>
                    Compact
                  </MenubarRadioItem>
                  <MenubarRadioItem value="standard" onClick={() => updateDensity("standard")}>
                    Standard
                  </MenubarRadioItem>
                  <MenubarRadioItem value="tall" onClick={() => updateDensity("tall")}>
                    Comfortable
                  </MenubarRadioItem>
                </MenubarRadioGroup>
                <MenubarSeparator />
                <MenubarSub>
                  <MenubarSubTrigger disabled={readOnly || meta.views.length >= TABLE_LIMITS.views}>
                    <Plus size={14} /> Add new view
                  </MenubarSubTrigger>
                  <MenubarSubContent>
                    {VIEW_TYPES.map((entry) => {
                      const Icon = VIEW_ICONS[entry.id];
                      return (
                        <MenubarItem key={entry.id} onClick={() => addView(entry.id)}>
                          <Icon size={14} /> {entry.label} view
                        </MenubarItem>
                      );
                    })}
                  </MenubarSubContent>
                </MenubarSub>
                <MenubarItem
                  disabled={readOnly || meta.views.length >= TABLE_LIMITS.views}
                  onClick={() => {
                    const copy = { ...structuredClone(view), id: newView().id, name: `${view.name} copy`.slice(0, 40) };
                    save({ meta: { ...docRef.current.meta, views: [...docRef.current.meta.views, copy] } }, "Duplicate view");
                    setActiveViewId(copy.id);
                  }}
                >
                  <Copy size={14} /> Duplicate view
                </MenubarItem>
                <MenubarItem
                  variant="destructive"
                  disabled={readOnly || meta.views.length <= 1}
                  onClick={() => setConfirm({ kind: "view", view })}
                >
                  <Trash2 size={14} /> Delete view…
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger>Tools</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarItem
                    disabled={readOnly || viewRecords.length === 0}
                    onClick={() => setSelectedIds(new Set(viewRecords.map((r) => r.id)))}
                  >
                    <Check size={14} /> Select all in view ({viewRecords.length})
                  </MenubarItem>
                  <MenubarItem disabled={selectedIds.size === 0} onClick={() => setSelectedIds(new Set())}>
                    Clear selection
                  </MenubarItem>
                </MenubarGroup>
                {groupField && (
                  <>
                    <MenubarSeparator />
                    <MenubarGroup>
                      <MenubarLabel>Groups</MenubarLabel>
                      <MenubarItem onClick={() => setGroupCollapseSignal({ mode: "expand", nonce: Date.now() })}>
                        Expand all groups
                      </MenubarItem>
                      <MenubarItem onClick={() => setGroupCollapseSignal({ mode: "collapse", nonce: Date.now() })}>
                        Collapse all groups
                      </MenubarItem>
                    </MenubarGroup>
                  </>
                )}
                {(view.filters.length > 0 || view.sort.length > 0 || Boolean(view.groupBy)) && (
                  <>
                    <MenubarSeparator />
                    <MenubarItem
                      onClick={() =>
                        setView(
                          { ...view, filters: [], sort: [], groupBy: view.type === "board" ? view.groupBy : null },
                          "Reset filters and sort",
                        )
                      }
                    >
                      Reset active filters &amp; sort
                    </MenubarItem>
                  </>
                )}
                {exampleCount > 0 && (
                  <>
                    <MenubarSeparator />
                    <MenubarItem variant="destructive" disabled={readOnly} onClick={() => setConfirm({ kind: "examples" })}>
                      <Trash2 size={14} /> Remove example rows ({exampleCount})
                    </MenubarItem>
                  </>
                )}
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        )}

        <div className="tb-smart-views-strip">
          {mobile ? (
            <label className="tb-mini-select tb-view-select">
              <span className="tb-visually-hidden">View</span>
              <select value={view.id} onChange={(event) => setActiveViewId(event.target.value)}>
                {meta.views.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="tb-view-tabs" role="tablist" aria-label="Views">
              {meta.views.map((entry) => {
                const Icon = VIEW_ICONS[entry.type];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={entry.id === view.id}
                    className={`tb-view-tab ${entry.id === view.id ? "is-active" : ""}`}
                    onClick={() => setActiveViewId(entry.id)}
                  >
                    <Icon size={13} aria-hidden="true" />
                    <span>{entry.name}</span>
                    {entry.filters.length > 0 && <span className="tb-view-dot" title={`${plural(entry.filters.length, "filter")}`} />}
                  </button>
                );
              })}
            </div>
          )}
          {viewMenu}
        </div>

        <span className="tb-head-spacer" />

        <div className={`tb-sheet-search ${search.trim() ? "has-query" : ""}`} role="search">
          <Search size={13} className="tb-sheet-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            className="tb-sheet-search-input"
            placeholder={`Search ${view.name.toLowerCase()}…`}
            aria-label="Search records"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
                searchInputRef.current?.blur();
              }
            }}
          />
          {search.trim() ? (
            <div className="tb-sheet-search-controls">
              <span className="tb-sheet-search-count" aria-live="polite">
                {viewRecords.length}/{records.length}
              </span>
              <button type="button" className="tb-sheet-search-nav" aria-label="Clear search" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            </div>
          ) : (
            <kbd className="tb-sheet-search-kbd" aria-hidden="true">Ctrl+F</kbd>
          )}
        </div>
      </nav>

      {/* Tier 2: Organized Smart Table Action & View Tools Bar */}
      <div className="tb-viewbar tb-smart-toolbar" role="toolbar" aria-label="Smart Table tools">
        {!readOnly && (
          <div className="tb-smart-primary-group">
            <button type="button" className="tb-smart-add-record-btn" onClick={() => addRecord()}>
              <Plus size={14} />
              <span>New record</span>
            </button>
            <button
              type="button"
              className="tb-smart-tool-pill"
              onClick={() => setFieldDialog({ field: null, index: meta.fields.length })}
            >
              <Database size={13} />
              <span>Add field</span>
            </button>
          </div>
        )}

        {!readOnly && <span className="tb-sep" aria-hidden="true" />}

        <div className="tb-smart-tools-group">
          <button
            type="button"
            className={`tb-smart-tool-pill ${view.filters.length > 0 ? "is-active" : ""}`}
            onClick={() => setViewSettings(true)}
            title="Configure view filters"
          >
            <Filter size={13} />
            <span>Filter</span>
            {view.filters.length > 0 && <span className="tb-smart-pill-count">{view.filters.length}</span>}
          </button>

          <Menu
            label="Sort records"
            buttonClassName={`tb-smart-tool-pill ${view.sort.length > 0 ? "is-active" : ""}`}
            icon={<ArrowUpDown size={13} />}
            items={[
              ...meta.fields
                .filter((f) => f.type !== "attachment")
                .slice(0, 8)
                .flatMap((field) => [
                  {
                    id: `asc-${field.id}`,
                    label: `${field.name} (A → Z)`,
                    icon: <ArrowDownAZ size={14} />,
                    onSelect: () => setView({ ...view, sort: [{ fieldId: field.id, dir: "asc" }] }, `Sort by ${field.name}`),
                  },
                  {
                    id: `desc-${field.id}`,
                    label: `${field.name} (Z → A)`,
                    icon: <ArrowDownZA size={14} />,
                    onSelect: () => setView({ ...view, sort: [{ fieldId: field.id, dir: "desc" }] }, `Sort by ${field.name}`),
                  },
                ]),
              "divider",
              { id: "multi-sort", label: "Multi-field sort settings…", icon: <SlidersHorizontal size={14} />, onSelect: () => setViewSettings(true) },
              ...(view.sort.length > 0
                ? [{ id: "clear-sort", label: "Clear sort", icon: <X size={14} />, onSelect: () => setView({ ...view, sort: [] }, "Clear sort") }]
                : []),
            ]}
          >
            <span>{activeSortField ? `Sorted: ${activeSortField.name}` : "Sort"}</span>
            {view.sort.length > 1 && <span className="tb-smart-pill-count">+{view.sort.length - 1}</span>}
          </Menu>

          {(view.type === "table" || view.type === "board") && (
            <Menu
              label="Group records"
              buttonClassName={`tb-smart-tool-pill ${view.groupBy ? "is-active" : ""}`}
              icon={<FolderTree size={13} />}
              items={[
                ...(view.type === "table"
                  ? [
                      {
                        id: "none",
                        label: "No grouping",
                        icon: !view.groupBy ? <Check size={14} /> : undefined,
                        onSelect: () => setView({ ...view, groupBy: null }, "Ungroup records"),
                      },
                    ]
                  : []),
                ...groupableFields.map((field) => ({
                  id: `grp-${field.id}`,
                  label: `Group by ${field.name}`,
                  icon: view.groupBy === field.id ? <Check size={14} /> : undefined,
                  onSelect: () => setView({ ...view, groupBy: field.id }, `Group by ${field.name}`),
                })),
                ...(groupableFields.length === 0
                  ? [
                      {
                        id: "add-status",
                        label: "Add Status field to group…",
                        icon: <Plus size={14} />,
                        disabled: readOnly,
                        onSelect: () => quickAddTypedField("status"),
                      },
                    ]
                  : []),
              ]}
            >
              <span>{groupField ? `Group: ${groupField.name}` : "Group"}</span>
            </Menu>
          )}

          <Menu
            label="Field visibility"
            buttonClassName={`tb-smart-tool-pill ${hiddenCount > 0 ? "is-active" : ""}`}
            icon={<Columns3 size={13} />}
            items={[
              ...meta.fields.map((field) => {
                const isPrimary = field.id === meta.primaryField;
                const isHidden = view.hidden.includes(field.id) && !isPrimary;
                return {
                  id: `vis-${field.id}`,
                  label: `${isHidden ? "Show" : "Hide"} ${field.name}${isPrimary ? " (Primary)" : ""}`,
                  icon: isHidden ? <EyeOff size={14} /> : <Eye size={14} />,
                  disabled: isPrimary,
                  onSelect: () => toggleFieldHidden(field),
                };
              }),
              ...(hiddenCount > 0
                ? [
                    "divider" as const,
                    { id: "show-all", label: "Show all fields", icon: <Eye size={14} />, onSelect: showAllFields },
                  ]
                : []),
            ]}
          >
            <span>Fields</span>
            {hiddenCount > 0 && <span className="tb-smart-pill-count">{visibleFields.length}/{meta.fields.length}</span>}
          </Menu>

          {view.type === "table" && !mobile && (
            <Menu
              label="Row density"
              buttonClassName="tb-smart-tool-pill"
              icon={<Rows3 size={13} />}
              items={[
                { id: "compact", label: "Compact rows", icon: uiPrefs.density === "compact" ? <Check size={14} /> : undefined, onSelect: () => updateDensity("compact") },
                { id: "standard", label: "Standard rows", icon: uiPrefs.density === "standard" ? <Check size={14} /> : undefined, onSelect: () => updateDensity("standard") },
                { id: "tall", label: "Comfortable rows", icon: uiPrefs.density === "tall" ? <Check size={14} /> : undefined, onSelect: () => updateDensity("tall") },
              ]}
            >
              <span>{uiPrefs.density === "compact" ? "Compact" : uiPrefs.density === "tall" ? "Comfortable" : "Standard"}</span>
            </Menu>
          )}

          <button
            type="button"
            className={`tb-smart-tool-pill ${showSummary ? "is-active" : ""}`}
            aria-pressed={showSummary}
            onClick={() => setShowSummary((open) => !open)}
          >
            <ChartColumn size={13} />
            <span>Summary</span>
          </button>
        </div>

        <span className="tb-head-spacer" />

        <div className="tb-smart-right-tools">
          <span className="tb-smart-record-stat" title="Visible records">
            {viewRecords.length === records.length
              ? plural(records.length, "record")
              : `${viewRecords.length} of ${records.length.toLocaleString()} records`}
          </span>
          <button type="button" className="tb-smart-tool-pill" title="Export view" onClick={() => setExportOpen(true)}>
            <Download size={13} />
            <span>Export</span>
          </button>
          <Menu
            label="More view options"
            icon={<MoreHorizontal size={15} />}
            align="end"
            items={[
              { id: "settings", label: "View settings…", icon: <SlidersHorizontal size={14} />, onSelect: () => setViewSettings(true) },
              { id: "copy-tsv", label: "Copy view as TSV", icon: <ClipboardCopy size={14} />, onSelect: () => void copyViewAsTsv() },
              ...(exampleCount
                ? [
                    {
                      id: "examples",
                      label: `Remove example rows (${exampleCount})`,
                      icon: <Trash2 size={14} />,
                      disabled: readOnly,
                      onSelect: () => setConfirm({ kind: "examples" }),
                    },
                  ]
                : []),
              "divider" as const,
              {
                id: "dup-view",
                label: "Duplicate this view",
                icon: <Copy size={14} />,
                disabled: readOnly || meta.views.length >= TABLE_LIMITS.views,
                onSelect: () => {
                  const copy = { ...structuredClone(view), id: newView().id, name: `${view.name} copy`.slice(0, 40) };
                  save({ meta: { ...docRef.current.meta, views: [...docRef.current.meta.views, copy] } }, "Duplicate view");
                  setActiveViewId(copy.id);
                },
              },
              {
                id: "del-view",
                label: "Delete this view",
                icon: <Trash2 size={14} />,
                danger: true,
                disabled: readOnly || meta.views.length <= 1,
                onSelect: () => setConfirm({ kind: "view", view }),
              },
            ]}
          />
        </div>
      </div>

      {/* Contextual Bulk Action Strip */}
      {!readOnly && selectedRecords.length > 0 && (
        <div className="tb-smart-bulkbar" role="region" aria-label="Selected records actions">
          <Badge variant="primary-light" size="sm">
            {plural(selectedRecords.length, "record")} selected
          </Badge>
          <button type="button" className="tb-smart-tool-pill" onClick={duplicateSelectedRecords}>
            <Copy size={13} />
            <span>Duplicate</span>
          </button>
          <button type="button" className="tb-smart-tool-pill" onClick={() => void exportFile("csv", selectedRecords)}>
            <Download size={13} />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            className="tb-smart-tool-pill is-danger"
            onClick={() => setConfirm({ kind: "bulk", ids: selectedRecords.map((r) => r.id) })}
          >
            <Trash2 size={13} />
            <span>Delete selected</span>
          </button>
          <span className="tb-head-spacer" />
          <button type="button" className="tb-link-button" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {showSummary && <SummaryPanel fields={meta.fields} records={viewRecords} totalRecords={records.length} charts={meta.charts} readOnly={readOnly} onChangeCharts={setCharts} />}

      <div className={`tb-smart-body ${showPanel ? "has-panel" : ""} ${mobile && showPanel ? "is-panel-only" : ""}`}>
        {!(mobile && showPanel) && <div className="tb-smart-main">{content()}</div>}
        {openRecord && (
          <RecordPanel
            record={openRecord}
            fields={meta.fields}
            primaryField={meta.primaryField}
            people={people}
            tableId={tableId}
            readOnly={readOnly}
            uploading={uploading}
            uploadProgress={uploadProgress && uploadProgress.fieldId === uploading ? uploadProgress.progress : null}
            mobile={mobile}
            onChange={(fieldId, value, newChoices) => setValue(openRecord.id, fieldId, value, newChoices)}
            onDuplicate={() => duplicateRecord(openRecord.id)}
            onDelete={() => setConfirm({ kind: "record", id: openRecord.id })}
            onUpload={(fieldId, files) => void upload(openRecord.id, fieldId, files)}
            onClose={() => setOpenRecordId(null)}
          />
        )}
      </div>

      {fieldDialog && <FieldDialog field={fieldDialog.field} fields={meta.fields} records={records} onSave={saveField} onClose={() => setFieldDialog(null)} />}
      {viewSettings && (
        <ViewSettingsDialog
          view={view}
          fields={meta.fields}
          primaryField={meta.primaryField}
          onClose={() => setViewSettings(false)}
          onSave={(next) => {
            setView(next, "Change view settings");
            setViewSettings(false);
          }}
        />
      )}
      {exportOpen && (
        <ExportDialog
          kind="smart"
          attachments={meta.fields.some((field) => field.type === "attachment") && attachments.length > 0}
          scopeNote={`Exports the ${plural(viewRecords.length, "record")} and ${plural(visibleFields.length, "field")} in the “${view.name}” view, in its current order.`}
          onClose={() => setExportOpen(false)}
          onExport={(fmt) => exportFile(fmt)}
        />
      )}
      {confirm?.kind === "field" && (
        <ModalPortal>
          <ConfirmDialog
            title={`Delete field “${confirm.field.name}”?`}
            confirmLabel="Delete field"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              deleteField(confirm.field);
              setConfirm(null);
            }}
          >
            <p>
              Its values in all {plural(records.length, "record")} are removed, and views or charts using it are adjusted.
              {confirm.field.type === "attachment" ? " Attached files are deleted from storage about a day later unless you undo." : ""} You can undo this.
            </p>
          </ConfirmDialog>
        </ModalPortal>
      )}
      {confirm?.kind === "record" && (
        <ModalPortal>
          <ConfirmDialog
            title="Delete this record?"
            confirmLabel="Delete record"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              deleteRecords(new Set([confirm.id]), "Delete record");
              setConfirm(null);
            }}
          >
            <p>You can undo this right after with Ctrl+Z or the Undo button.</p>
          </ConfirmDialog>
        </ModalPortal>
      )}
      {confirm?.kind === "bulk" && (
        <ModalPortal>
          <ConfirmDialog
            title={`Delete ${plural(confirm.ids.length, "selected record")}?`}
            confirmLabel={`Delete ${plural(confirm.ids.length, "record")}`}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              deleteRecords(new Set(confirm.ids), `Delete ${confirm.ids.length} records`);
              setConfirm(null);
            }}
          >
            <p>You can undo this right after with Ctrl+Z or the Undo button.</p>
          </ConfirmDialog>
        </ModalPortal>
      )}
      {confirm?.kind === "empty-rows" && (
        <ModalPortal>
          <ConfirmDialog
            title={`Clear ${plural(confirm.ids.length, "empty row")}?`}
            confirmLabel="Clear empty rows"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              deleteRecords(new Set(confirm.ids), "Clear empty rows");
              setConfirm(null);
            }}
          >
            <p>Only completely blank records with no field values will be removed. You can undo this.</p>
          </ConfirmDialog>
        </ModalPortal>
      )}
      {confirm?.kind === "examples" && (
        <ModalPortal>
          <ConfirmDialog
            title={`Remove ${plural(exampleCount, "example row")}?`}
            confirmLabel="Remove examples"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              deleteRecords(new Set(records.filter((record) => record.example).map((record) => record.id)), "Remove example rows");
              setConfirm(null);
            }}
          >
            <p>Only rows labelled “Example” are removed. Your own records stay. You can undo this.</p>
          </ConfirmDialog>
        </ModalPortal>
      )}
      {confirm?.kind === "view" && (
        <ModalPortal>
          <ConfirmDialog
            title={`Delete view “${confirm.view.name}”?`}
            confirmLabel="Delete view"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              save({ meta: { ...docRef.current.meta, views: docRef.current.meta.views.filter((entry) => entry.id !== confirm.view.id) } }, "Delete view");
              setConfirm(null);
            }}
          >
            <p>Only the view&apos;s settings are removed. Records aren&apos;t affected.</p>
          </ConfirmDialog>
        </ModalPortal>
      )}
    </div>
  );
}
