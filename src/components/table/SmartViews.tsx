// Persora Table — Board, Calendar and Gallery views. They read the view's
// filtered/sorted records and never change them except through explicit
// edits (moving a card to another column sets that field, like editing it).
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MoveRight, Plus } from "lucide-react";
import { groupForBoard, isEmptyValue, type AttachmentRef, type Field, type FieldValue, type TableRecord, type TableView } from "../../../cloudflare/table-rules.js";
import { AttachmentThumb, isImage } from "./attachments";
import { ChoiceChip, ValueView, editTextOf } from "./smart-cells";
import { Menu, plural } from "./table-ui";
import { Badge } from "@/components/reui/badge";

const CARD_FIELDS = 4;

function cardTitle(record: TableRecord, primary: Field | undefined) {
  return primary ? editTextOf(primary, record.values[primary.id]) || "Untitled" : "Untitled";
}

function CardFields({ record, fields, skip }: { record: TableRecord; fields: Field[]; skip: Set<string> }) {
  const shown = fields.filter((field) => !skip.has(field.id) && !isEmptyValue(record.values[field.id])).slice(0, CARD_FIELDS);
  if (!shown.length) return null;
  return <dl className="tb-card-fields">{shown.map((field) => <div key={field.id}><dt>{field.name}</dt><dd><ValueView field={field} value={record.values[field.id]} compact/></dd></div>)}</dl>;
}

export function BoardView({ view, fields, records, primaryField, readOnly, onOpenRecord, onSetValue, onAddRecord }: {
  view: TableView;
  fields: Field[];
  records: TableRecord[];
  primaryField: string;
  readOnly: boolean;
  onOpenRecord: (id: string) => void;
  onSetValue: (recordId: string, fieldId: string, value: FieldValue) => void;
  onAddRecord: (groupValue: { fieldId: string; value: string | null }) => void;
}) {
  const field = fields.find((entry) => entry.id === view.groupBy)!;
  const primary = fields.find((entry) => entry.id === primaryField);
  const groups = useMemo(() => groupForBoard(field, records), [field, records]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const skip = new Set([field.id, primaryField]);
  return <div className="tb-board" role="list" aria-label={`Board grouped by ${field.name}`}>
    {groups.filter((group) => group.id || group.records.length).map((group) => <section key={group.id || "none"} role="listitem" className={`tb-board-col ${dragOver === group.id ? "is-drop" : ""}`} aria-label={`${group.label}, ${plural(group.records.length, "record")}`}
      onDragOver={(event) => { if (readOnly) return; event.preventDefault(); setDragOver(group.id); }}
      onDragLeave={() => setDragOver((current) => (current === group.id ? null : current))}
      onDrop={(event) => { event.preventDefault(); setDragOver(null); const id = event.dataTransfer.getData("text/x-persora-record"); if (id && !readOnly) onSetValue(id, field.id, group.id || null); }}>
      <header className="tb-board-head">
        {group.id ? <ChoiceChip choice={group}/> : <span className="tb-muted">{group.label}</span>}
        <small>{group.records.length}</small>
        {!readOnly && <button type="button" className="tb-icon-button" aria-label={`Add record to ${group.label}`} onClick={() => onAddRecord({ fieldId: field.id, value: group.id || null })}><Plus size={14}/></button>}
      </header>
      <div className="tb-board-cards">
        {group.records.map((record) => <article key={record.id} className={`tb-card ${record.example ? "is-example" : ""}`} draggable={!readOnly}
          onDragStart={(event) => { event.dataTransfer.setData("text/x-persora-record", record.id); event.dataTransfer.effectAllowed = "move"; }}>
          <button type="button" className="tb-card-open" onClick={() => onOpenRecord(record.id)}><b>{cardTitle(record, primary)}</b>{record.example && <Badge variant="warning-light" size="xs" className="tb-example-badge">Example</Badge>}</button>
          <CardFields record={record} fields={fields} skip={skip}/>
          {!readOnly && <Menu label={`Move “${cardTitle(record, primary)}” to another column`} icon={<MoveRight size={13}/>} buttonClassName="tb-card-move" align="end"
            items={[...(field.choices || []).map((choice) => ({ id: choice.id, label: choice.label, checked: record.values[field.id] === choice.id, onSelect: () => onSetValue(record.id, field.id, choice.id) })),
              { id: "none", label: `No ${field.name}`, checked: !record.values[field.id], onSelect: () => onSetValue(record.id, field.id, null) }]}/>}
        </article>)}
        {!group.records.length && <p className="tb-muted tb-board-empty">No records</p>}
      </div>
    </section>)}
  </div>;
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoOf = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

export function CalendarView({ view, fields, records, primaryField, readOnly, onOpenRecord, onAddRecord }: {
  view: TableView;
  fields: Field[];
  records: TableRecord[];
  primaryField: string;
  readOnly: boolean;
  onOpenRecord: (id: string) => void;
  onAddRecord: (groupValue: { fieldId: string; value: string | null }) => void;
}) {
  const field = fields.find((entry) => entry.id === view.dateField)!;
  const primary = fields.find((entry) => entry.id === primaryField);
  const today = new Date();
  const todayIso = isoOf(today.getFullYear(), today.getMonth(), today.getDate());
  const firstDated = records.map((record) => record.values[field.id]).find((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) as string | undefined;
  const [cursor, setCursor] = useState(() => { const base = firstDated && !records.some((record) => String(record.values[field.id] || "").slice(0, 7) === todayIso.slice(0, 7)) ? new Date(`${firstDated}T00:00:00`) : today; return { year: base.getFullYear(), month: base.getMonth() }; });
  const byDay = useMemo(() => {
    const map = new Map<string, TableRecord[]>();
    for (const record of records) {
      const value = record.values[field.id];
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) continue;
      if (!map.has(value)) map.set(value, []);
      map.get(value)!.push(record);
    }
    return map;
  }, [records, field.id]);
  const undated = records.length - [...byDay.values()].reduce((sum, list) => sum + list.length, 0);
  const startDay = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: Array<number | null> = [...Array.from({ length: startDay }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (delta: number) => setCursor(({ year, month }) => { const next = new Date(year, month + delta, 1); return { year: next.getFullYear(), month: next.getMonth() }; });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: "short" }));

  return <div className="tb-calendar">
    <header className="tb-calendar-head">
      <button type="button" className="tb-icon-button" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16}/></button>
      <h3 aria-live="polite">{monthLabel}</h3>
      <button type="button" className="tb-icon-button" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={16}/></button>
      <button type="button" className="tb-secondary-button" onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>Today</button>
      <span className="tb-muted">by {field.name}{undated ? ` · ${plural(undated, "record")} without a date` : ""}</span>
    </header>
    <div className="tb-calendar-grid" role="grid" aria-label={monthLabel}>
      <div role="row" className="tb-calendar-weekdays">{weekdays.map((day) => <span key={day} role="columnheader">{day}</span>)}</div>
      {Array.from({ length: cells.length / 7 }, (_, week) => <div role="row" key={week} className="tb-calendar-week">
        {cells.slice(week * 7, week * 7 + 7).map((day, index) => {
          if (!day) return <div key={index} role="gridcell" className="tb-calendar-day is-blank"/>;
          const iso = isoOf(cursor.year, cursor.month, day);
          const list = byDay.get(iso) || [];
          return <div key={index} role="gridcell" className={`tb-calendar-day ${iso === todayIso ? "is-today" : ""}`} aria-label={`${iso}, ${plural(list.length, "record")}`}>
            <span className="tb-calendar-num">{day}</span>
            {!readOnly && <button type="button" className="tb-calendar-add" aria-label={`Add record on ${iso}`} onClick={() => onAddRecord({ fieldId: field.id, value: iso })}><Plus size={12}/></button>}
            {list.slice(0, 3).map((record) => <button key={record.id} type="button" className={`tb-calendar-item ${record.example ? "is-example" : ""}`} onClick={() => onOpenRecord(record.id)}>{cardTitle(record, primary)}</button>)}
            {list.length > 3 && <span className="tb-calendar-more">+{list.length - 3} more</span>}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}

export function GalleryView({ view, fields, records, primaryField, tableId, onOpenRecord }: {
  view: TableView;
  fields: Field[];
  records: TableRecord[];
  primaryField: string;
  tableId: string;
  onOpenRecord: (id: string) => void;
}) {
  const primary = fields.find((entry) => entry.id === primaryField);
  const cover = view.coverField ? fields.find((entry) => entry.id === view.coverField) : null;
  const skip = new Set([primaryField, cover?.id || ""]);
  if (!records.length) return <p className="tb-muted tb-view-empty">No records match this view.</p>;
  return <ul className="tb-gallery">
    {records.map((record) => {
      const files = cover && Array.isArray(record.values[cover.id]) ? (record.values[cover.id] as AttachmentRef[]) : [];
      const image = files.find(isImage);
      return <li key={record.id} className={`tb-gallery-card ${record.example ? "is-example" : ""}`}>
        <button type="button" className="tb-gallery-open" onClick={() => onOpenRecord(record.id)}>
          {cover && <span className="tb-gallery-cover">{image ? <AttachmentThumb tableId={tableId} file={image} className="tb-gallery-img"/> : <span className="tb-muted">{files.length ? plural(files.length, "file") : "No image"}</span>}</span>}
          <b>{cardTitle(record, primary)}</b>
          {record.example && <Badge variant="warning-light" size="xs" className="tb-example-badge">Example</Badge>}
        </button>
        <CardFields record={record} fields={fields} skip={skip}/>
      </li>;
    })}
  </ul>;
}
