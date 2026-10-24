// Persora Table — summary for the current view: totals, averages, counts,
// status distribution and small SVG charts (bar, line, donut) on fields the
// member picks. Everything is computed from the view's records, so the
// view's filters apply.
import { useMemo } from "react";
import { ChartColumn, ChartLine, ChartPie, Plus, Trash2 } from "lucide-react";
import {
  CHART_TYPES, CHOICE_TYPES, NUMERIC_TYPES, chartData, displayValue, fieldSummary, newLocalId,
  type ChartConfig, type ChartType, type Field, type TableRecord,
} from "../../../cloudflare/table-rules.js";
import { plural } from "./table-ui";

export const CHOICE_HEX: Record<string, string> = {
  gray: "#98A2B3", blue: "#2E90FA", green: "#12B76A", yellow: "#EAAA08", orange: "#F79009", red: "#F04438", violet: "#7A5AF8", teal: "#15B79E",
};
const SERIES = ["#3E6AE1", "#12B76A", "#F79009", "#7A5AF8", "#15B79E", "#F04438", "#EAAA08", "#98A2B3"];
const MAX_CHARTS = 4;
const colorOf = (color: string | undefined, index: number) => (color && CHOICE_HEX[color]) || SERIES[index % SERIES.length];

type Point = { key: string; label: string; value: number; color?: string };

function formatValue(value: number, field: Field | null, aggregate: ChartConfig["aggregate"]) {
  if (!field || aggregate === "count") return value.toLocaleString();
  return displayValue(field, Math.round(value * 100) / 100);
}

function BarChart({ points, format }: { points: Point[]; format: (value: number) => string }) {
  const max = Math.max(...points.map((point) => point.value), 0) || 1;
  const rowH = 24;
  return <svg className="tb-chart-svg" viewBox={`0 0 320 ${points.length * rowH + 4}`} role="img" aria-label="Bar chart">
    {points.map((point, index) => {
      const width = Math.max(point.value > 0 ? 2 : 0, (point.value / max) * 150);
      return <g key={point.key} transform={`translate(0 ${index * rowH + 2})`}>
        <text x="0" y="15" className="tb-chart-label">{point.label.length > 16 ? `${point.label.slice(0, 15)}…` : point.label}</text>
        <rect x="110" y="4" width={width} height="14" rx="3" fill={colorOf(point.color, index)}><title>{`${point.label}: ${format(point.value)}`}</title></rect>
        <text x={116 + width} y="15" className="tb-chart-value">{format(point.value)}</text>
      </g>;
    })}
  </svg>;
}

function LineChart({ points, format }: { points: Point[]; format: (value: number) => string }) {
  const max = Math.max(...points.map((point) => point.value), 0) || 1;
  const min = Math.min(0, ...points.map((point) => point.value));
  const w = 320; const h = 150; const left = 8; const right = 8; const top = 14; const bottom = 26;
  const x = (index: number) => left + (points.length === 1 ? (w - left - right) / 2 : (index / (points.length - 1)) * (w - left - right));
  const y = (value: number) => top + (1 - (value - min) / (max - min || 1)) * (h - top - bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const step = Math.max(1, Math.ceil(points.length / 6));
  return <svg className="tb-chart-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Line chart">
    <line x1={left} x2={w - right} y1={y(min)} y2={y(min)} className="tb-chart-axis"/>
    <path d={path} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeLinejoin="round"/>
    {points.map((point, index) => <g key={point.key}>
      <circle cx={x(index)} cy={y(point.value)} r="3" fill={SERIES[0]}><title>{`${point.label}: ${format(point.value)}`}</title></circle>
      {index % step === 0 && <text x={x(index)} y={h - 8} textAnchor="middle" className="tb-chart-label">{point.label.length > 9 ? `${point.label.slice(0, 8)}…` : point.label}</text>}
    </g>)}
  </svg>;
}

function DonutChart({ points, format }: { points: Point[]; format: (value: number) => string }) {
  const positive = points.filter((point) => point.value > 0);
  const total = positive.reduce((sum, point) => sum + point.value, 0);
  const r = 46; const c = 2 * Math.PI * r;
  let offset = 0;
  return <div className="tb-donut">
    <svg viewBox="0 0 120 120" className="tb-donut-svg" role="img" aria-label="Donut chart">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--tb-line)" strokeWidth="16"/>
      {total > 0 && positive.map((point, index) => {
        const length = (point.value / total) * c;
        const segment = <circle key={point.key} cx="60" cy="60" r={r} fill="none" stroke={colorOf(point.color, index)} strokeWidth="16"
          strokeDasharray={`${length} ${c - length}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)"><title>{`${point.label}: ${format(point.value)}`}</title></circle>;
        offset += length;
        return segment;
      })}
    </svg>
    <ul className="tb-legend">{positive.map((point, index) => <li key={point.key}><i style={{ background: colorOf(point.color, index) }}/>{point.label}<b>{format(point.value)}</b><small>{total ? `${Math.round((point.value / total) * 100)}%` : ""}</small></li>)}</ul>
  </div>;
}

function Chart({ config, fields, records, readOnly, onChange, onRemove }: {
  config: ChartConfig; fields: Field[]; records: TableRecord[]; readOnly: boolean;
  onChange: (config: ChartConfig) => void; onRemove: () => void;
}) {
  const groupable = fields.filter((field) => field.type !== "attachment" && field.type !== "url" && field.type !== "email");
  const numeric = fields.filter((field) => NUMERIC_TYPES.includes(field.type));
  const group = fields.find((field) => field.id === config.groupField) || null;
  const valueField = config.valueField ? fields.find((field) => field.id === config.valueField) || null : null;
  const data = useMemo(() => (group ? chartData(fields, records, { groupField: group.id, valueField: valueField?.id || null, aggregate: valueField ? config.aggregate : "count" }) : { points: [], skipped: 0 }), [fields, records, group, valueField, config.aggregate]);
  const format = (value: number) => formatValue(value, valueField, valueField ? config.aggregate : "count");
  const TypeIcon = config.type === "line" ? ChartLine : config.type === "donut" ? ChartPie : ChartColumn;
  return <section className="tb-chart" aria-label="Chart">
    <div className="tb-chart-controls">
      <TypeIcon size={14} aria-hidden="true"/>
      <select aria-label="Chart type" value={config.type} disabled={readOnly} onChange={(event) => onChange({ ...config, type: event.target.value as ChartType })}>
        {CHART_TYPES.map((type) => <option key={type} value={type}>{type === "bar" ? "Bar" : type === "line" ? "Line" : "Donut"}</option>)}
      </select>
      <select aria-label="Group by" value={config.groupField} disabled={readOnly} onChange={(event) => onChange({ ...config, groupField: event.target.value })}>
        {!group && <option value="">Choose a field…</option>}
        {groupable.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
      </select>
      <select aria-label="Value" value={valueField ? `${config.aggregate}:${valueField.id}` : "count"} disabled={readOnly}
        onChange={(event) => { const [aggregate, id] = event.target.value.split(":"); onChange(id ? { ...config, aggregate: aggregate as ChartConfig["aggregate"], valueField: id } : { ...config, aggregate: "count", valueField: null }); }}>
        <option value="count">Count of records</option>
        {numeric.flatMap((field) => [<option key={`s${field.id}`} value={`sum:${field.id}`}>Sum of {field.name}</option>, <option key={`a${field.id}`} value={`average:${field.id}`}>Average of {field.name}</option>])}
      </select>
      {!readOnly && <button type="button" className="tb-icon-button" aria-label="Remove chart" onClick={onRemove}><Trash2 size={14}/></button>}
    </div>
    {!group ? <p className="tb-muted">Choose a field to group by.</p>
      : !data.points.length ? <p className="tb-muted">Nothing to chart yet — {records.length ? `none of the ${plural(records.length, "record")} in this view have a ${group.name}` : "this view has no records"}.</p>
        : <>
          {config.type === "bar" && <BarChart points={data.points} format={format}/>}
          {config.type === "line" && <LineChart points={data.points} format={format}/>}
          {config.type === "donut" && <DonutChart points={data.points} format={format}/>}
          {data.skipped > 0 && <p className="tb-muted tb-chart-note">{plural(data.skipped, "record")} without a {group.name} {data.skipped === 1 ? "isn't" : "aren't"} shown.</p>}
        </>}
  </section>;
}

export default function SummaryPanel({ fields, records, totalRecords, charts, readOnly, onChangeCharts }: {
  fields: Field[];
  records: TableRecord[];
  totalRecords: number;
  charts: ChartConfig[];
  readOnly: boolean;
  onChangeCharts: (charts: ChartConfig[], label: string) => void;
}) {
  const numeric = fields.filter((field) => NUMERIC_TYPES.includes(field.type)).slice(0, 3);
  const status = fields.find((field) => field.type === "status") || fields.find((field) => CHOICE_TYPES.includes(field.type) && field.type !== "multiselect");
  const distribution = status ? fieldSummary(status, records).distribution || [] : [];
  const distTotal = distribution.reduce((sum, entry) => sum + entry.count, 0);
  const addChart = () => {
    const group = status || fields.find((field) => field.type === "date") || fields[0];
    if (!group) return;
    onChangeCharts([...charts, { id: newLocalId("ch"), type: status ? "donut" : "bar", groupField: group.id, valueField: null, aggregate: "count" }], "Add chart");
  };
  return <section className="tb-summary" aria-label="Summary">
    <div className="tb-stats">
      <div className="tb-stat"><small>Records</small><b>{records.length.toLocaleString()}</b>{records.length !== totalRecords && <span className="tb-muted">of {totalRecords.toLocaleString()} (view filters apply)</span>}</div>
      {numeric.map((field) => {
        const summary = fieldSummary(field, records);
        return <div className="tb-stat" key={field.id}><small>{field.name}</small>
          <b>{summary.numbers ? displayValue(field, summary.sum) : "—"}</b>
          <span className="tb-muted">{summary.numbers ? `Average ${displayValue(field, summary.average)} · ${plural(summary.numbers || 0, "value")}` : "No values yet"}</span>
        </div>;
      })}
      {status && <div className="tb-stat tb-stat-wide"><small>{status.name}</small>
        {distTotal ? <>
          <div className="tb-dist" role="img" aria-label={distribution.filter((entry) => entry.count).map((entry) => `${entry.label} ${entry.count}`).join(", ")}>
            {distribution.filter((entry) => entry.count).map((entry, index) => <span key={entry.id} style={{ flexGrow: entry.count, background: colorOf(String(entry.color), index) }} title={`${entry.label}: ${entry.count}`}/>)}
          </div>
          <span className="tb-muted">{distribution.filter((entry) => entry.count).map((entry) => `${entry.label} ${entry.count}`).join(" · ")}</span>
        </> : <span className="tb-muted">No {status.name.toLowerCase()} set yet</span>}
      </div>}
    </div>
    <div className="tb-charts">
      {charts.map((config) => <Chart key={config.id} config={config} fields={fields} records={records} readOnly={readOnly}
        onChange={(next) => onChangeCharts(charts.map((entry) => (entry.id === config.id ? next : entry)), "Change chart")}
        onRemove={() => onChangeCharts(charts.filter((entry) => entry.id !== config.id), "Remove chart")}/>)}
      {!readOnly && charts.length < MAX_CHARTS && fields.length > 0 && <button type="button" className="tb-secondary-button tb-add-chart" onClick={addChart}><Plus size={14}/> Add chart</button>}
    </div>
  </section>;
}
