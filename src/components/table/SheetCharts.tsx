// Persora Table — embedded spreadsheet charts (bar, line, pie, doughnut)
// backed by live cell/formula ranges and styled exclusively with Persora --ds-* tokens.
import { useMemo, useRef, useState } from "react";
import { BarChart3, GripHorizontal, LineChart, Pencil, PieChart, Trash2, X } from "lucide-react";
import type { CellResult } from "../../../cloudflare/table-formula.js";
import {
  SHEET_CHART_TYPES, TABLE_LIMITS, formatGeneralNumber,
  type SheetChart, type SheetChartType, type SheetData,
} from "../../../cloudflare/table-rules.js";
import {
  detectRangeHeaders, extractSheetChartSeries, formatRangeName, parseRangeText, type Rect,
} from "../../../cloudflare/table-sheet-ops.js";
import ModalPortal from "../ModalPortal";
import { Checkbox } from "@/design-system";

const SERIES_COLORS = [
  "#2563EB", // Persora Blue
  "#0D9488", // Teal
  "#7C3AED", // Violet
  "#D97706", // Amber
  "#E11D48", // Rose
  "#059669", // Emerald
  "#4F46E5", // Indigo
  "#0284C7", // Cyan
];

export const CHART_TYPE_META: ReadonlyArray<{ id: SheetChartType; label: string }> = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "pie", label: "Pie" },
  { id: "doughnut", label: "Doughnut" },
];

function polarToCartesian(cx: number, cy: number, radius: number, angleRad: number) {
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

function describePieSlice(cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 1e-4) {
    // Full 360° circle / ring
    if (innerR <= 0) {
      return [
        `M ${cx - outerR} ${cy}`,
        `A ${outerR} ${outerR} 0 1 0 ${cx + outerR} ${cy}`,
        `A ${outerR} ${outerR} 0 1 0 ${cx - outerR} ${cy}`,
        "Z",
      ].join(" ");
    }
    return [
      `M ${cx - outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 0 ${cx + outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 0 ${cx - outerR} ${cy}`,
      `M ${cx - innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 1 ${cx + innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 1 ${cx - innerR} ${cy}`,
      "Z",
    ].join(" ");
  }

  const largeArc = sweep > Math.PI ? 1 : 0;
  const startOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, endAngle);

  if (innerR <= 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${startOuter.x.toFixed(2)} ${startOuter.y.toFixed(2)}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x.toFixed(2)} ${endOuter.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  }

  const startInner = polarToCartesian(cx, cy, innerR, endAngle);
  const endInner = polarToCartesian(cx, cy, innerR, startAngle);
  return [
    `M ${startOuter.x.toFixed(2)} ${startOuter.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x.toFixed(2)} ${endOuter.y.toFixed(2)}`,
    `L ${startInner.x.toFixed(2)} ${startInner.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x.toFixed(2)} ${endInner.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function truncateLabel(text: string, max = 12): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function SheetChartSvg({
  type,
  categories,
  series,
  rangeLabel,
}: {
  type: SheetChartType;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  rangeLabel: string;
}) {
  const hasAnyPoints =
    categories.length > 0 &&
    series.length > 0 &&
    series.some((s) => s.values.some((v) => Number.isFinite(v) && v !== 0));

  if (!hasAnyPoints) {
    return (
      <div className="tb-chart-empty">
        <p>No numeric values to plot in <b>{rangeLabel}</b>.</p>
        <small>Enter numbers or formulas in the range to update this chart live.</small>
      </div>
    );
  }

  if (type === "pie" || type === "doughnut") {
    const primary = series[0];
    const slices = categories
      .map((label, idx) => ({
        label,
        value: Math.max(0, primary.values[idx] ?? 0),
        color: SERIES_COLORS[idx % SERIES_COLORS.length],
      }))
      .filter((s) => s.value > 0);
    const total = slices.reduce((acc, s) => acc + s.value, 0);

    if (total <= 0) {
      return (
        <div className="tb-chart-empty">
          <p>Pie and doughnut charts require positive values in <b>{rangeLabel}</b>.</p>
        </div>
      );
    }

    const cx = 104;
    const cy = 96;
    const outerR = 74;
    const innerR = type === "doughnut" ? 44 : 0;
    let cursor = -Math.PI / 2;

    return (
      <div className="tb-chart-pie-layout">
        <svg className="tb-chart-svg" viewBox="0 0 208 192" role="img" aria-label={`${type} chart for ${rangeLabel}`}>
          {slices.map((slice, idx) => {
            const angle = (slice.value / total) * Math.PI * 2;
            const d = describePieSlice(cx, cy, outerR, innerR, cursor, cursor + angle);
            cursor += angle;
            const pct = Math.round((slice.value / total) * 100);
            return (
              <path key={`${slice.label}-${idx}`} d={d} fill={slice.color} stroke="var(--ds-card-bg)" strokeWidth={slices.length > 1 ? 1.5 : 0}>
                <title>{`${slice.label}: ${formatGeneralNumber(slice.value)} (${pct}%)`}</title>
              </path>
            );
          })}
          {type === "doughnut" && (
            <g className="tb-chart-donut-center">
              <text x={cx} y={cy - 4} textAnchor="middle" className="tb-chart-donut-total">
                {formatGeneralNumber(total)}
              </text>
              <text x={cx} y={cy + 13} textAnchor="middle" className="tb-chart-donut-sub">
                Total
              </text>
            </g>
          )}
        </svg>
        <ul className="tb-chart-legend is-vertical" aria-label="Chart legend">
          {slices.slice(0, 8).map((slice, idx) => {
            const pct = ((slice.value / total) * 100).toFixed(slice.value / total < 0.1 ? 1 : 0);
            return (
              <li key={`${slice.label}-${idx}`}>
                <span className="tb-chart-swatch" style={{ backgroundColor: slice.color }} />
                <span className="tb-chart-legend-name" title={slice.label}>{truncateLabel(slice.label, 16)}</span>
                <b className="tb-chart-legend-val">{pct}%</b>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Cartesian Bar or Line chart
  const W = 380;
  const H = 196;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allVals = series.flatMap((s) => s.values);
  const rawMin = Math.min(0, ...allVals);
  const rawMax = Math.max(0, ...allVals);
  const minVal = rawMin < 0 ? rawMin * 1.08 : 0;
  const maxVal = rawMax > 0 ? rawMax * 1.08 : rawMin === 0 ? 1 : 0;
  const valRange = maxVal - minVal || 1;

  const yOf = (val: number) => padT + plotH - ((val - minVal) / valRange) * plotH;
  const zeroY = yOf(0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => minVal + valRange * t);
  const catCount = Math.max(1, categories.length);
  const stepX = plotW / catCount;

  return (
    <div className="tb-chart-cartesian-wrap">
      <svg className="tb-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${type} chart for ${rangeLabel}`}>
        {/* Gridlines & Y-axis labels */}
        {ticks.map((tick, idx) => {
          const y = yOf(tick);
          return (
            <g key={idx}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} className="tb-chart-gridline" />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" className="tb-chart-axis-text">
                {formatGeneralNumber(Number(tick.toPrecision(3)))}
              </text>
            </g>
          );
        })}
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} className="tb-chart-baseline" />

        {type === "bar" &&
          categories.map((cat, cIdx) => {
            const groupW = stepX * 0.72;
            const groupStart = padL + cIdx * stepX + (stepX - groupW) / 2;
            const barW = Math.max(3, groupW / Math.max(1, series.length) - (series.length > 1 ? 2 : 0));
            return (
              <g key={`cat-${cIdx}`}>
                {series.map((s, sIdx) => {
                  const v = s.values[cIdx] ?? 0;
                  const yVal = yOf(v);
                  const top = Math.min(yVal, zeroY);
                  const h = Math.max(1.5, Math.abs(zeroY - yVal));
                  const x = groupStart + sIdx * (barW + (series.length > 1 ? 2 : 0));
                  return (
                    <rect
                      key={`bar-${sIdx}`}
                      x={x}
                      y={top}
                      width={barW}
                      height={h}
                      rx={2.5}
                      fill={SERIES_COLORS[sIdx % SERIES_COLORS.length]}
                    >
                      <title>{`${s.name} · ${cat}: ${formatGeneralNumber(v)}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}

        {type === "line" &&
          series.map((s, sIdx) => {
            const color = SERIES_COLORS[sIdx % SERIES_COLORS.length];
            const pts = categories.map((cat, cIdx) => {
              const x = catCount === 1 ? padL + plotW / 2 : padL + (cIdx + 0.5) * stepX;
              const v = s.values[cIdx] ?? 0;
              return { x, y: yOf(v), v, cat };
            });
            const polyPoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            return (
              <g key={`line-${sIdx}`}>
                {pts.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polyPoints}
                  />
                )}
                {pts.map((p, pIdx) => (
                  <circle key={pIdx} cx={p.x} cy={p.y} r={3.5} fill={color} stroke="var(--ds-card-bg)" strokeWidth={1.5}>
                    <title>{`${s.name} · ${p.cat}: ${formatGeneralNumber(p.v)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

        {/* X-axis category labels */}
        {categories.map((cat, cIdx) => {
          const maxLabels = 8;
          const stride = Math.max(1, Math.ceil(categories.length / maxLabels));
          if (cIdx % stride !== 0 && cIdx !== categories.length - 1) return null;
          const x = padL + (cIdx + 0.5) * stepX;
          return (
            <text key={`xl-${cIdx}`} x={x} y={H - 11} textAnchor="middle" className="tb-chart-axis-text">
              {truncateLabel(cat, 10)}
            </text>
          );
        })}
      </svg>

      {series.length > 1 && (
        <ul className="tb-chart-legend is-horizontal" aria-label="Series legend">
          {series.map((s, sIdx) => (
            <li key={`${s.name}-${sIdx}`}>
              <span className="tb-chart-swatch" style={{ backgroundColor: SERIES_COLORS[sIdx % SERIES_COLORS.length] }} />
              <span className="tb-chart-legend-name">{truncateLabel(s.name, 18)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SheetChartLayer({
  data,
  valueAt,
  readOnly,
  onMoveChart,
  onEditChart,
  onDeleteChart,
}: {
  data: SheetData;
  valueAt: (row: number, col: number) => CellResult;
  readOnly: boolean;
  onMoveChart: (chartId: string, x: number, y: number) => void;
  onEditChart: (chart: SheetChart) => void;
  onDeleteChart: (chartId: string) => void;
}) {
  const charts = data.charts || [];
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  if (!charts.length) return null;

  const startDrag = (chart: SheetChart, ev: React.MouseEvent) => {
    if (readOnly || ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest("button")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    const startY = ev.clientY;
    let nextX = chart.x;
    let nextY = chart.y;
    setDragPos({ id: chart.id, x: nextX, y: nextY });
    document.body.style.userSelect = "none";

    const onMove = (moveEv: MouseEvent) => {
      nextX = Math.max(8, Math.round(chart.x + (moveEv.clientX - startX)));
      nextY = Math.max(8, Math.round(chart.y + (moveEv.clientY - startY)));
      setDragPos({ id: chart.id, x: nextX, y: nextY });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setDragPos(null);
      if (nextX !== chart.x || nextY !== chart.y) {
        onMoveChart(chart.id, nextX, nextY);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="tb-chart-layer" aria-label="Spreadsheet charts">
      {charts.map((chart) => {
        const pos = dragPos?.id === chart.id ? dragPos : chart;
        const extracted = extractSheetChartSeries(data, chart, valueAt);
        const rangeLabel = formatRangeName(chart.range);
        return (
          <section
            key={chart.id}
            className="tb-chart-card"
            data-chart-id={chart.id}
            data-chart-type={chart.type}
            aria-label={chart.title}
            style={{
              left: pos.x,
              top: pos.y,
              width: chart.width,
              height: chart.height,
            }}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <header className="tb-chart-card-head" onMouseDown={(ev) => startDrag(chart, ev)}>
              <GripHorizontal size={14} className="tb-chart-grip" aria-hidden="true" />
              <div className="tb-chart-card-titles">
                <h4>{chart.title}</h4>
                <span className="tb-chart-range-pill">{rangeLabel}</span>
              </div>
              {!readOnly && (
                <div className="tb-chart-card-actions">
                  <button
                    type="button"
                    className="tb-icon-button"
                    aria-label={`Edit ${chart.title}`}
                    title="Edit chart"
                    onClick={() => onEditChart(chart)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="tb-icon-button tb-danger-icon"
                    aria-label={`Delete ${chart.title}`}
                    title="Delete chart"
                    onClick={() => onDeleteChart(chart.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </header>
            <div className="tb-chart-card-body">
              <SheetChartSvg
                type={chart.type}
                categories={extracted.categories}
                series={extracted.series}
                rangeLabel={rangeLabel}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function SheetChartModal({
  data,
  valueAt,
  selectionRect,
  initialChart,
  presetType,
  onClose,
  onSave,
}: {
  data: SheetData;
  valueAt: (row: number, col: number) => CellResult;
  selectionRect: Rect;
  initialChart: SheetChart | null;
  presetType?: SheetChartType;
  onClose: () => void;
  onSave: (payload: { type: SheetChartType; title: string; range: Rect; hasHeaders: boolean }) => void;
}) {
  const defaultRect = initialChart ? initialChart.range : selectionRect;
  const [type, setType] = useState<SheetChartType>(
    initialChart?.type || (presetType && SHEET_CHART_TYPES.includes(presetType) ? presetType : "bar"),
  );
  const [rangeInput, setRangeInput] = useState<string>(() => formatRangeName(defaultRect));
  const [hasHeaders, setHasHeaders] = useState<boolean>(() =>
    initialChart ? initialChart.hasHeaders : detectRangeHeaders(data, defaultRect, valueAt),
  );
  const [title, setTitle] = useState<string>(() => initialChart?.title || "");
  const [error, setError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const parsedRange = useMemo(
    () => parseRangeText(rangeInput, data.rowCount, data.colCount),
    [rangeInput, data.rowCount, data.colCount],
  );

  const previewChart = useMemo<SheetChart>(
    () => ({
      id: initialChart?.id || "ch_preview",
      type,
      title: title.trim() || `${type[0].toUpperCase()}${type.slice(1)} chart`,
      range: parsedRange || defaultRect,
      hasHeaders,
      x: 0,
      y: 0,
      width: 420,
      height: 290,
    }),
    [initialChart?.id, type, title, parsedRange, defaultRect, hasHeaders],
  );

  const previewSeries = useMemo(
    () => extractSheetChartSeries(data, previewChart, valueAt),
    [data, previewChart, valueAt],
  );

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!parsedRange) {
      setError(`Enter a valid cell range inside this sheet (for example A1:C6).`);
      return;
    }
    const finalTitle =
      title.trim() ||
      `${CHART_TYPE_META.find((m) => m.id === type)?.label || "Bar"} chart (${formatRangeName(parsedRange)})`;
    onSave({ type, title: finalTitle, range: parsedRange, hasHeaders });
  };

  return (
    <ModalPortal>
      <div
        className="tb-dialog-scrim"
        role="presentation"
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) onClose();
        }}
      >
        <section className="tb-dialog tb-chart-modal" role="dialog" aria-modal="true" aria-labelledby="tb-chart-modal-title">
          <header className="tb-dialog-head">
            <h3 id="tb-chart-modal-title">{initialChart ? "Edit chart" : "Insert chart"}</h3>
            <button type="button" className="tb-icon-button" aria-label="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </header>

          <form onSubmit={submit} className="tb-chart-modal-form">
            <div className="tb-chart-type-grid" role="radiogroup" aria-label="Chart type">
              {CHART_TYPE_META.map((entry) => {
                const active = type === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`tb-chart-type-option ${active ? "is-active" : ""}`}
                    onClick={() => setType(entry.id)}
                  >
                    {entry.id === "bar" && <BarChart3 size={16} />}
                    {entry.id === "line" && <LineChart size={16} />}
                    {(entry.id === "pie" || entry.id === "doughnut") && <PieChart size={16} />}
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="tb-chart-form-row">
              <label className="tb-field">
                <span>Data range</span>
                <div className="tb-chart-range-input-wrap">
                  <input
                    type="text"
                    value={rangeInput}
                    onChange={(ev) => {
                      setRangeInput(ev.target.value.toUpperCase());
                      setError(null);
                    }}
                    placeholder="A1:C6"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="tb-secondary-button"
                    onClick={() => {
                      setRangeInput(formatRangeName(selectionRect));
                      setHasHeaders(detectRangeHeaders(data, selectionRect, valueAt));
                      setError(null);
                    }}
                  >
                    Use selection ({formatRangeName(selectionRect)})
                  </button>
                </div>
              </label>

              <label className="tb-field">
                <span>Chart title</span>
                <input
                  ref={titleInputRef}
                  type="text"
                  maxLength={TABLE_LIMITS.nameLength}
                  value={title}
                  onChange={(ev) => setTitle(ev.target.value)}
                  placeholder={`${CHART_TYPE_META.find((m) => m.id === type)?.label || "Bar"} chart (${rangeInput || "A1:B5"})`}
                />
              </label>
            </div>

            <label className="tb-checkbox-row">
              <Checkbox
                checked={hasHeaders}
                onCheckedChange={(checked) => setHasHeaders(checked === true)}
                aria-label="Use first row as headers"
              />
              <span>Use first row as headers</span>
            </label>

            {error && <p className="tb-field-error" role="alert">{error}</p>}

            <div className="tb-chart-preview-box" aria-label="Chart preview">
              <div className="tb-chart-preview-head">
                <b>{previewChart.title}</b>
                <span>{parsedRange ? formatRangeName(parsedRange) : "Invalid range"}</span>
              </div>
              <SheetChartSvg
                type={type}
                categories={previewSeries.categories}
                series={previewSeries.series}
                rangeLabel={parsedRange ? formatRangeName(parsedRange) : rangeInput}
              />
            </div>

            <footer className="tb-dialog-foot">
              <button type="button" className="tb-secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="tb-primary-button">
                {initialChart ? "Save chart" : "Insert chart"}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </ModalPortal>
  );
}
