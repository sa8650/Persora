// Persora Table — Smart Table editor: views (Table, Board, Calendar, Gallery),
// search, fields, records, record panel, summary and export. Every change is
// a new document passed to commit(); views only store their settings.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, ChartColumn, Copy, Database, Download, GalleryHorizontalEnd, KanbanSquare, MoreHorizontal, Plus, Search, SlidersHorizontal, Table2, Trash2,
} from "lucide-react";
import {
  TABLE_LIMITS, VIEW_TYPES, applyView, newView, viewSetupProblem,
  type AttachmentRef, type ChartConfig, type Choice, type Field, type FieldValue, type SmartMeta, type TableRecord, type TableView, type ViewType,
} from "../../../cloudflare/table-rules.js";
import { smartCsvRows, smartXlsxSheet } from "../../../cloudflare/table-io.js";
import { listTablePeople, tableErrorMessage, uploadTableAttachment, type TableAttachmentInfo, type TablePerson } from "../../lib/table/table-api";
import { exportCsv, exportXlsx, safeDownloadName } from "../../lib/table/table-files";
import type { TableDoc } from "../../lib/table/table-sync";
import { ConfirmDialog } from "../VaultDialogs";
import ModalPortal from "../ModalPortal";
import type { Commit } from "./TableEditor";
import SmartGrid from "./SmartGrid";
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

const VIEW_ICONS: Record<ViewType, typeof Table2> = { table: Table2, board: KanbanSquare, calendar: CalendarDays, gallery: GalleryHorizontalEnd };
const POSITION_STEP = 1024;

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
    charts: meta.charts.filter((chart) => chart.groupField !== fieldId).map((chart) => (chart.valueField === fieldId ? { ...chart, valueField: null, aggregate: "count" as const } : chart)),
  };
}

export default function SmartTableEditor({ doc, tableId, tableName, commit, readOnly, notify, attachments, onAttachmentAdded, canUpload, maxUploadMb, onUpgrade }: {
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
  const docRef = useRef(doc); docRef.current = doc;
  const mobile = useIsMobile();
  const [activeViewId, setActiveViewId] = useState(meta.views[0].id);
  const view = meta.views.find((entry) => entry.id === activeViewId) || meta.views[0];
  const [search, setSearch] = useState("");
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [fieldDialog, setFieldDialog] = useState<{ field: Field | null; index: number } | null>(null);
  const [viewSettings, setViewSettings] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "field"; field: Field } | { kind: "record"; id: string } | { kind: "view"; view: TableView } | { kind: "examples" }>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [people, setPeople] = useState<TablePerson[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => () => releaseAttachmentUrls(tableId), [tableId]);
  useEffect(() => { if (!meta.views.some((entry) => entry.id === activeViewId)) setActiveViewId(meta.views[0].id); }, [meta.views, activeViewId]);
  const hasPersonField = meta.fields.some((field) => field.type === "person");
  useEffect(() => {
    if (!hasPersonField || people) return;
    listTablePeople().then(setPeople).catch(() => setPeople([]));
  }, [hasPersonField, people]);
  useEffect(() => { if (openRecordId && !records.some((record) => record.id === openRecordId)) setOpenRecordId(null); }, [records, openRecordId]);

  const visibleFields = useMemo(() => meta.fields.filter((field) => !view.hidden.includes(field.id) || field.id === meta.primaryField), [meta.fields, view.hidden, meta.primaryField]);
  const viewRecords = useMemo(() => applyView(meta.fields, records, view, search), [meta.fields, records, view, search]);
  const problem = viewSetupProblem(view, meta.fields);
  const exampleCount = useMemo(() => records.filter((record) => record.example).length, [records]);

  // ---- document updates (always from the latest document) ----------------------------------------
  const save = useCallback((next: Partial<Pick<SmartDoc, "meta" | "records">>, label: string) => {
    const current = docRef.current;
    commit({ kind: "smart", meta: next.meta ?? current.meta, records: next.records ?? current.records }, label);
  }, [commit]);
  const setValue = useCallback((recordId: string, fieldId: string, value: FieldValue, newChoices?: Choice[]) => {
    if (readOnly) return;
    const current = docRef.current;
    const field = current.meta.fields.find((entry) => entry.id === fieldId);
    if (!field) return;
    let nextMeta = current.meta;
    if (newChoices?.length) {
      if ((field.choices?.length || 0) + newChoices.length > TABLE_LIMITS.choices) { notify(`A field can have at most ${TABLE_LIMITS.choices} options.`, "error"); return; }
      nextMeta = { ...current.meta, fields: current.meta.fields.map((entry) => (entry.id === fieldId ? { ...entry, choices: [...(entry.choices || []), ...newChoices] } : entry)) };
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
  }, [readOnly, notify, save]);

  const addRecord = (groupValue?: { fieldId: string; value: string | null }) => {
    if (readOnly) return;
    const current = docRef.current;
    if (current.records.length >= TABLE_LIMITS.records) { notify(`A Smart Table can have up to ${TABLE_LIMITS.records.toLocaleString()} records.`, "error"); return; }
    const position = current.records.reduce((max, record) => Math.max(max, record.position), 0) + POSITION_STEP;
    const values: Record<string, FieldValue> = {};
    if (groupValue?.value) values[groupValue.fieldId] = groupValue.value;
    const record: TableRecord = { id: newId(), position, values };
    save({ records: [...current.records, record] }, "Add record");
    setOpenRecordId(record.id);
    if (applyView(current.meta.fields, [record], view, search).length === 0) notify("Record added. It's hidden by this view's filters or search until you fill it in.");
  };
  const duplicateRecord = (id: string) => {
    const current = docRef.current;
    const index = current.records.findIndex((record) => record.id === id);
    if (index < 0) return;
    if (current.records.length >= TABLE_LIMITS.records) { notify(`A Smart Table can have up to ${TABLE_LIMITS.records.toLocaleString()} records.`, "error"); return; }
    const source = current.records[index];
    const nextPosition = current.records[index + 1]?.position;
    const position = nextPosition !== undefined && nextPosition - source.position > 1 ? (source.position + nextPosition) / 2 : current.records.reduce((max, record) => Math.max(max, record.position), 0) + POSITION_STEP;
    const copy: TableRecord = { id: newId(), position, values: structuredClone(source.values) };
    const list = [...current.records];
    list.splice(index + 1, 0, copy);
    save({ records: list }, "Duplicate record");
    setOpenRecordId(copy.id);
    notify("Record duplicated.");
  };
  const deleteRecords = (ids: Set<string>, label: string) => {
    const current = docRef.current;
    save({ records: current.records.filter((record) => !ids.has(record.id)) }, label);
    if (openRecordId && ids.has(openRecordId)) setOpenRecordId(null);
    notify(`${ids.size === 1 ? "Record" : plural(ids.size, "record")} deleted. Press Ctrl+Z or Undo to bring ${ids.size === 1 ? "it" : "them"} back.`);
  };
  const moveRecord = (id: string, delta: -1 | 1) => {
    const current = docRef.current;
    const ordered = [...current.records].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((record) => record.id === id);
    const other = ordered[index + delta];
    if (index < 0 || !other) return;
    const a = ordered[index];
    save({ records: current.records.map((record) => (record.id === a.id ? { ...record, position: other.position } : record.id === other.id ? { ...record, position: a.position } : record)) }, "Move record");
  };

  // ---- fields ----------------------------------------------------------------------------------------------
  const saveField = ({ field, values }: FieldSaveResult) => {
    const current = docRef.current;
    const exists = current.meta.fields.some((entry) => entry.id === field.id);
    if (!exists && current.meta.fields.length >= TABLE_LIMITS.fields) { notify(`A Smart Table can have up to ${TABLE_LIMITS.fields} fields.`, "error"); return; }
    let fields: Field[];
    if (exists) fields = current.meta.fields.map((entry) => (entry.id === field.id ? field : entry));
    else { fields = [...current.meta.fields]; fields.splice(Math.min(fieldDialog?.index ?? fields.length, fields.length), 0, field); }
    const nextRecords = values?.size ? current.records.map((record) => (values.has(record.id) ? { ...record, values: { ...record.values, [field.id]: values.get(record.id)! } } : record)) : current.records;
    save({ meta: { ...current.meta, fields }, records: nextRecords }, exists ? `Edit field ${field.name}` : `Add field ${field.name}`);
    setFieldDialog(null);
  };
  const deleteField = (field: Field) => {
    const current = docRef.current;
    save({
      meta: withoutField(current.meta, field.id),
      records: current.records.map((record) => { if (!(field.id in record.values)) return record; const values = { ...record.values }; delete values[field.id]; return { ...record, values }; }),
    }, `Delete field ${field.name}`);
    notify(`Field “${field.name}” deleted. Press Ctrl+Z or Undo to restore it with its values.`);
  };
  const moveField = (field: Field, delta: -1 | 1) => {
    const current = docRef.current;
    // Moves among the fields visible in this view, keeping hidden ones in place.
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
  const addView = (type: ViewType) => {
    const current = docRef.current;
    if (current.meta.views.length >= TABLE_LIMITS.views) { notify(`A Smart Table can have up to ${TABLE_LIMITS.views} views.`, "error"); return; }
    const fresh = newView(type);
    const names = new Set(current.meta.views.map((entry) => entry.name.toLowerCase()));
    let name = fresh.name; let n = 2;
    while (names.has(name.toLowerCase())) name = `${fresh.name} ${n++}`;
    const groupField = current.meta.fields.find((field) => field.type === "status") || current.meta.fields.find((field) => field.type === "select");
    const next: TableView = {
      ...fresh, name,
      groupBy: type === "board" ? groupField?.id || null : null,
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
    if (!canUpload) { notify("Attaching files needs a Persora plan with file uploads.", "error"); onUpgrade?.(); return; }
    setUploading(fieldId);
    try {
      for (const file of [...files]) {
        const record = docRef.current.records.find((entry) => entry.id === recordId);
        const existing = record && Array.isArray(record.values[fieldId]) ? (record.values[fieldId] as AttachmentRef[]) : [];
        if (existing.length >= TABLE_LIMITS.attachmentsPerCell) { notify(`Up to ${TABLE_LIMITS.attachmentsPerCell} files per field.`, "error"); break; }
        if (file.size > maxUploadMb * 1024 * 1024) { notify(`“${file.name}” is larger than your plan's ${maxUploadMb} MB upload limit.`, "error"); continue; }
        if (!file.size) { notify(`“${file.name}” is empty.`, "error"); continue; }
        const { info, ref } = await uploadTableAttachment(tableId, file, newId());
        onAttachmentAdded(info);
        const latest = docRef.current.records.find((entry) => entry.id === recordId);
        if (!latest) { notify("The record was removed while the file uploaded. The file wasn't attached.", "error"); break; }
        const current = Array.isArray(latest.values[fieldId]) ? (latest.values[fieldId] as AttachmentRef[]) : [];
        setValue(recordId, fieldId, [...current, ref]);
      }
    } catch (error) {
      notify(tableErrorMessage(error, "The file couldn't be uploaded. Check your connection and try again."), "error");
    } finally { setUploading(null); }
  };

  const exportFile = async (format: "csv" | "xlsx") => {
    const name = view === meta.views[0] ? tableName : `${tableName} - ${view.name}`;
    if (format === "csv") await exportCsv(smartCsvRows(visibleFields, viewRecords), safeDownloadName(name, "csv"));
    else await exportXlsx([smartXlsxSheet(view.name, visibleFields, viewRecords)], safeDownloadName(name, "xlsx"));
  };

  const openRecord = records.find((record) => record.id === openRecordId) || null;
  const canReorder = view.sort.length === 0 && !search.trim() && view.filters.length === 0 && !view.groupBy;
  const groupField = view.type === "table" && view.groupBy ? meta.fields.find((field) => field.id === view.groupBy && (field.type === "select" || field.type === "status")) || null : null;

  const viewMenu = <Menu label="Add view" icon={<Plus size={14}/>} buttonClassName="tb-view-add" items={VIEW_TYPES.map((entry) => {
    const Icon = VIEW_ICONS[entry.id];
    return { id: entry.id, label: `${entry.label} view`, icon: <Icon size={14}/>, disabled: readOnly || meta.views.length >= TABLE_LIMITS.views, onSelect: () => addView(entry.id) };
  })}/>;

  const content = () => {
    if (problem) {
      return <div className="tb-setup" role="status">
        <p>{problem}</p>
        <div className="tb-empty-actions">
          {!readOnly && <button type="button" className="tb-secondary-button" onClick={() => setViewSettings(true)}><SlidersHorizontal size={14}/> View settings</button>}
          {!readOnly && <button type="button" className="tb-secondary-button" onClick={() => setFieldDialog({ field: null, index: meta.fields.length })}><Plus size={14}/> Add field</button>}
        </div>
      </div>;
    }
    if (view.type === "board") return <BoardView view={view} fields={visibleFields} records={viewRecords} primaryField={meta.primaryField} readOnly={readOnly} onOpenRecord={setOpenRecordId} onSetValue={(id, fieldId, value) => setValue(id, fieldId, value)} onAddRecord={addRecord}/>;
    if (view.type === "calendar") return <CalendarView view={view} fields={visibleFields} records={viewRecords} primaryField={meta.primaryField} readOnly={readOnly} onOpenRecord={setOpenRecordId} onAddRecord={addRecord}/>;
    if (view.type === "gallery") return <GalleryView view={view} fields={visibleFields} records={viewRecords} primaryField={meta.primaryField} tableId={tableId} onOpenRecord={setOpenRecordId}/>;
    if (mobile) {
      const primary = meta.fields.find((field) => field.id === meta.primaryField);
      const others = visibleFields.filter((field) => field.id !== meta.primaryField).slice(0, 3);
      return <div className="tb-mobile-list">
        {viewRecords.length ? <ul>{viewRecords.map((record) => <li key={record.id}>
          <button type="button" className={`tb-mobile-record ${record.example ? "is-example" : ""}`} onClick={() => setOpenRecordId(record.id)}>
            <b>{primary ? editTextOf(primary, record.values[primary.id]) || "Untitled" : "Untitled"}</b>
            {record.example && <span className="tb-example-badge">Example</span>}
            <span className="tb-mobile-fields">{others.map((field) => <span key={field.id}><small>{field.name}</small><ValueView field={field} value={record.values[field.id]} compact/></span>)}</span>
          </button>
        </li>)}</ul> : <p className="tb-muted tb-view-empty">No records match this view.</p>}
        <button type="button" className="tb-secondary-button tb-mobile-add" disabled={readOnly} onClick={() => addRecord()}><Plus size={15}/> Add record</button>
      </div>;
    }
    return <SmartGrid fields={visibleFields} records={viewRecords} groupField={groupField} primaryField={meta.primaryField} people={people} readOnly={readOnly}
      openRecordId={openRecordId} canReorder={canReorder}
      onCommit={setValue} onOpenRecord={setOpenRecordId} onAddRecord={addRecord} onMoveRecord={moveRecord}
      onEditField={(field) => setFieldDialog({ field, index: 0 })}
      onAddField={(index) => {
        // Insert position is relative to the visible fields; map it to the full list.
        const anchor = visibleFields[index];
        setFieldDialog({ field: null, index: anchor ? meta.fields.findIndex((field) => field.id === anchor.id) : meta.fields.length });
      }}
      onSortField={(field, dir) => setView({ ...view, sort: [{ fieldId: field.id, dir }] }, `Sort by ${field.name}`)}
      onHideField={(field) => setView({ ...view, hidden: [...view.hidden, field.id] }, `Hide ${field.name}`)}
      onMoveField={moveField}
      onDeleteField={(field) => setConfirm({ kind: "field", field })}
      onResizeField={(field, width) => save({ meta: { ...docRef.current.meta, fields: docRef.current.meta.fields.map((entry) => (entry.id === field.id ? { ...entry, width } : entry)) } }, `Resize ${field.name}`)}/>;
  };

  const showPanel = Boolean(openRecord);
  return <div className="tb-smart-editor">
    <div className="tb-viewbar">
      {mobile
        ? <label className="tb-mini-select tb-view-select"><span className="tb-visually-hidden">View</span>
          <select value={view.id} onChange={(event) => setActiveViewId(event.target.value)}>{meta.views.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        </label>
        : <div className="tb-view-tabs" role="tablist" aria-label="Views">
          {meta.views.map((entry) => {
            const Icon = VIEW_ICONS[entry.type];
            return <button key={entry.id} type="button" role="tab" aria-selected={entry.id === view.id} className={`tb-view-tab ${entry.id === view.id ? "is-active" : ""}`} onClick={() => setActiveViewId(entry.id)}>
              <Icon size={14} aria-hidden="true"/>{entry.name}
              {(entry.filters.length > 0) && <span className="tb-view-dot" title={`${plural(entry.filters.length, "filter")}`}/>}
            </button>;
          })}
        </div>}
      {viewMenu}
      <span className="tb-head-spacer"/>
      <label className="tb-search tb-search-compact"><Search size={14} aria-hidden="true"/><span className="tb-visually-hidden">Search records</span>
        <input type="search" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)}/>
      </label>
      <button type="button" className={`tb-icon-button ${view.filters.length || view.sort.length ? "is-on" : ""}`} title="Filter, sort and fields" aria-label="View settings: filter, sort and fields" onClick={() => setViewSettings(true)}><SlidersHorizontal size={15}/></button>
      <button type="button" className={`tb-icon-button ${showSummary ? "is-on" : ""}`} aria-pressed={showSummary} title="Summary and charts" aria-label="Summary and charts" onClick={() => setShowSummary((open) => !open)}><ChartColumn size={15}/></button>
      <Menu label="More" icon={<MoreHorizontal size={15}/>} align="end" items={[
        { id: "record", label: "Add record", icon: <Plus size={14}/>, disabled: readOnly, onSelect: () => addRecord() },
        { id: "field", label: "Add field", icon: <Database size={14}/>, disabled: readOnly, onSelect: () => setFieldDialog({ field: null, index: meta.fields.length }) },
        { id: "export", label: "Export…", icon: <Download size={14}/>, onSelect: () => setExportOpen(true) },
        ...(exampleCount ? [{ id: "examples", label: `Remove example rows (${exampleCount})`, icon: <Trash2 size={14}/>, disabled: readOnly, onSelect: () => setConfirm({ kind: "examples" }) }] : []),
        "divider" as const,
        { id: "dup-view", label: "Duplicate this view", icon: <Copy size={14}/>, disabled: readOnly || meta.views.length >= TABLE_LIMITS.views, onSelect: () => {
          const copy = { ...structuredClone(view), id: newView().id, name: `${view.name} copy`.slice(0, 40) };
          save({ meta: { ...docRef.current.meta, views: [...docRef.current.meta.views, copy] } }, "Duplicate view");
          setActiveViewId(copy.id);
        } },
        { id: "del-view", label: "Delete this view", icon: <Trash2 size={14}/>, danger: true, disabled: readOnly || meta.views.length <= 1, onSelect: () => setConfirm({ kind: "view", view }) },
      ]}/>
    </div>
    {(view.filters.length > 0 || search.trim()) && <p className="tb-view-note tb-muted">{plural(viewRecords.length, "record")} of {records.length.toLocaleString()} shown{view.filters.length ? ` · ${plural(view.filters.length, "filter")} in this view` : ""}{search.trim() ? " · search" : ""}.</p>}

    {showSummary && <SummaryPanel fields={meta.fields} records={viewRecords} totalRecords={records.length} charts={meta.charts} readOnly={readOnly} onChangeCharts={setCharts}/>}

    <div className={`tb-smart-body ${showPanel ? "has-panel" : ""} ${mobile && showPanel ? "is-panel-only" : ""}`}>
      {!(mobile && showPanel) && <div className="tb-smart-main">{content()}</div>}
      {openRecord && <RecordPanel record={openRecord} fields={meta.fields} primaryField={meta.primaryField} people={people} tableId={tableId} readOnly={readOnly} uploading={uploading} mobile={mobile}
        onChange={(fieldId, value, newChoices) => setValue(openRecord.id, fieldId, value, newChoices)}
        onDuplicate={() => duplicateRecord(openRecord.id)}
        onDelete={() => setConfirm({ kind: "record", id: openRecord.id })}
        onUpload={(fieldId, files) => void upload(openRecord.id, fieldId, files)}
        onClose={() => setOpenRecordId(null)}/>}
    </div>

    {fieldDialog && <FieldDialog field={fieldDialog.field} fields={meta.fields} records={records} onSave={saveField} onClose={() => setFieldDialog(null)}/>}
    {viewSettings && <ViewSettingsDialog view={view} fields={meta.fields} primaryField={meta.primaryField} onClose={() => setViewSettings(false)}
      onSave={(next) => { setView(next, "Change view settings"); setViewSettings(false); }}/>}
    {exportOpen && <ExportDialog kind="smart" attachments={meta.fields.some((field) => field.type === "attachment") && attachments.length > 0}
      scopeNote={`Exports the ${plural(viewRecords.length, "record")} and ${plural(visibleFields.length, "field")} in the “${view.name}” view, in its current order.`}
      onClose={() => setExportOpen(false)} onExport={exportFile}/>}
    {confirm?.kind === "field" && <ModalPortal><ConfirmDialog title={`Delete field “${confirm.field.name}”?`} confirmLabel="Delete field" onCancel={() => setConfirm(null)} onConfirm={() => { deleteField(confirm.field); setConfirm(null); }}>
      <p>Its values in all {plural(records.length, "record")} are removed, and views or charts using it are adjusted.{confirm.field.type === "attachment" ? " Attached files are deleted from storage about a day later unless you undo." : ""} You can undo this.</p>
    </ConfirmDialog></ModalPortal>}
    {confirm?.kind === "record" && <ModalPortal><ConfirmDialog title="Delete this record?" confirmLabel="Delete record" onCancel={() => setConfirm(null)} onConfirm={() => { deleteRecords(new Set([confirm.id]), "Delete record"); setConfirm(null); }}>
      <p>You can undo this right after with Ctrl+Z or the Undo button.</p>
    </ConfirmDialog></ModalPortal>}
    {confirm?.kind === "examples" && <ModalPortal><ConfirmDialog title={`Remove ${plural(exampleCount, "example row")}?`} confirmLabel="Remove examples" onCancel={() => setConfirm(null)}
      onConfirm={() => { deleteRecords(new Set(records.filter((record) => record.example).map((record) => record.id)), "Remove example rows"); setConfirm(null); }}>
      <p>Only rows labelled “Example” are removed. Your own records stay. You can undo this.</p>
    </ConfirmDialog></ModalPortal>}
    {confirm?.kind === "view" && <ModalPortal><ConfirmDialog title={`Delete view “${confirm.view.name}”?`} confirmLabel="Delete view" onCancel={() => setConfirm(null)}
      onConfirm={() => { save({ meta: { ...docRef.current.meta, views: docRef.current.meta.views.filter((entry) => entry.id !== confirm.view.id) } }, "Delete view"); setConfirm(null); }}>
      <p>Only the view's settings are removed. Records aren't affected.</p>
    </ConfirmDialog></ModalPortal>}
  </div>;
}
