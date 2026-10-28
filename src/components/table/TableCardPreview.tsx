// Persora Table — lightweight, read-only miniature previews for dashboard & template cards.
//
// Never mounts SpreadsheetEditor, SheetGrid, SmartTableEditor or SmartGrid.
// Fetches non-touching preview payloads (?preview=1, preserving openedAt) lazily as cards
// approach the viewport, with bounded concurrency and revision-keyed in-memory caching.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { isFormulaError, WorkbookCalculator, type CellResult } from "../../../cloudflare/table-formula.js";
import {
  COLUMN_WIDTH, fontStackOf, formatCellValue, formatCurrency, formatDate,
  type AttachmentRef, type CellStyle, type Choice, type Field, type FieldValue,
  type MergeRect, type PersonRef, type Sheet, type SheetCell, type SmartMeta, type TableKind, type TableRecord,
} from "../../../cloudflare/table-rules.js";
import type { TableContent } from "../../../cloudflare/table-templates.js";
import { getTablePreview, type TableDetail, type TableSummary } from "../../lib/table/table-api";

const PREVIEW_SHEET_ROWS = 10;
const PREVIEW_COMPACT_SHEET_ROWS = 8;
const PREVIEW_SHEET_COLS = 5;
const PREVIEW_EMPTY_ROWS = 6;
const PREVIEW_EMPTY_COLS = 4;
const PREVIEW_SMART_ROWS = 7;
const PREVIEW_COMPACT_SMART_ROWS = 6;
const PREVIEW_SMART_COLS = 4;
const MAX_CONCURRENT_REQUESTS = 4;

type PreviewCellRecord = SheetCell & { fe?: 1 };

interface PreviewCacheEntry {
  content: TableContent;
  sheetCount: number;
}

const previewCache = new Map<string, PreviewCacheEntry>();
const inFlightByKey = new Map<string, Promise<PreviewCacheEntry>>();
let activeRequests = 0;
const pendingQueue: Array<() => void> = [];

function pumpQueue() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (next) next();
  }
}

function enqueuePreviewFetch(tableId: string, revision: number): Promise<PreviewCacheEntry> {
  const key = `${tableId}:${revision}`;
  const cached = previewCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inFlightByKey.get(key);
  if (existing) return existing;

  const promise = new Promise<PreviewCacheEntry>((resolve, reject) => {
    const run = () => {
      activeRequests += 1;
      getTablePreview(tableId)
        .then((detail: TableDetail) => {
          const entry = detailToPreviewEntry(detail);
          for (const existingKey of previewCache.keys()) {
            if (existingKey.startsWith(`${tableId}:`) && existingKey !== key) {
              previewCache.delete(existingKey);
            }
          }
          previewCache.set(key, entry);
          resolve(entry);
        })
        .catch(reject)
        .finally(() => {
          activeRequests = Math.max(0, activeRequests - 1);
          inFlightByKey.delete(key);
          pumpQueue();
        });
    };
    if (activeRequests < MAX_CONCURRENT_REQUESTS) run();
    else pendingQueue.push(run);
  });

  inFlightByKey.set(key, promise);
  return promise;
}

function detailToPreviewEntry(detail: TableDetail): PreviewCacheEntry {
  if (detail.table.kind === "smart") {
    const meta: SmartMeta = detail.table.meta ?? {
      fields: [{ id: "f_name", name: "Name", type: "text", width: 200 }],
      views: [],
      charts: [],
      primaryField: "f_name",
    };
    return {
      content: { kind: "smart", meta, records: detail.records || [] },
      sheetCount: 0,
    };
  }
  return {
    content: { kind: "spreadsheet", sheets: detail.sheets || [] },
    sheetCount: detail.table.sheetCount || detail.sheets?.length || 1,
  };
}

/** Pre-seed or refresh cache when a table detail is already known in memory. */
export function clearTablePreviewCache(tableId?: string) {
  if (!tableId) {
    previewCache.clear();
    return;
  }
  for (const key of previewCache.keys()) {
    if (key.startsWith(`${tableId}:`)) previewCache.delete(key);
  }
}

function previewBorderCss(style: CellStyle): CSSProperties {
  if (!style.bd) return {};
  const color = style.bc || "var(--tb-cell-border-ink)";
  const stroke = style.bs === "thick" || style.bs === "medium"
    ? `1.5px solid ${color}`
    : style.bs === "dashed"
      ? `1px dashed ${color}`
      : style.bs === "dotted"
        ? `1px dotted ${color}`
        : `1px solid ${color}`;
  const out: CSSProperties = {};
  if (style.bd.includes("t")) out.borderTop = stroke;
  if (style.bd.includes("r")) out.borderRight = stroke;
  if (style.bd.includes("b")) out.borderBottom = stroke;
  if (style.bd.includes("l")) out.borderLeft = stroke;
  return out;
}

function previewCellStyle(style: CellStyle | undefined, isNumeric: boolean, isError: boolean): CSSProperties {
  const s = style || {};
  const css: CSSProperties = previewBorderCss(s);
  if (s.ff) css.fontFamily = fontStackOf(s.ff);
  if (s.b) css.fontWeight = 600;
  if (s.i) css.fontStyle = "italic";
  if (s.u && s.st) css.textDecoration = "underline line-through";
  else if (s.u) css.textDecoration = "underline";
  else if (s.st) css.textDecoration = "line-through";
  if (s.bg) {
    css.backgroundColor = s.bg;
    if (!s.c && !isError) css.color = "#111827";
  }
  if (isError) css.color = "var(--ds-danger)";
  else if (s.c) css.color = s.c;
  const align = s.a === "c" ? "center" : s.a === "r" ? "right" : s.a === "l" ? "left" : isNumeric ? "right" : "left";
  css.textAlign = align;
  return css;
}

function hasCellVisualContent(cell: PreviewCellRecord | undefined): boolean {
  if (!cell) return false;
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return true;
  if (typeof cell.f === "string" && cell.f.trim().length > 0) return true;
  if (cell.fe) return true;
  if (cell.s?.bg || cell.s?.bd) return true;
  return false;
}

function SpreadsheetMiniature({ sheets, compact = false }: { sheets: Sheet[]; compact?: boolean }) {
  const ordered = useMemo(
    () => [...sheets].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [sheets],
  );
  const first = ordered[0];
  const maxRows = compact ? PREVIEW_COMPACT_SHEET_ROWS : PREVIEW_SHEET_ROWS;

  const calc = useMemo(() => {
    if (!first) return null;
    const cells = (first.data?.cells || {}) as Record<string, PreviewCellRecord>;
    let needsClientEval = false;
    for (let r = 0; r < maxRows && !needsClientEval; r += 1) {
      for (let c = 0; c < PREVIEW_SHEET_COLS; c += 1) {
        const raw = cells[`${r}:${c}`];
        if (raw && typeof raw.f === "string" && raw.v === undefined && !raw.fe) {
          needsClientEval = true;
          break;
        }
      }
    }
    if (!needsClientEval) return null;
    const byId = new Map(ordered.map((s) => [s.id, s]));
    return new WorkbookCalculator({
      sheets: () => ordered.map((s) => ({
        id: s.id,
        name: s.name,
        rows: Number(s.data?.rowCount) || 100,
        cols: Number(s.data?.colCount) || 26,
      })),
      cell: (sheetId: string, row: number, col: number) => byId.get(sheetId)?.data?.cells?.[`${row}:${col}`],
      *formulaCells(sheetId: string) {
        const map = byId.get(sheetId)?.data?.cells || {};
        for (const [k, cell] of Object.entries(map)) {
          if (cell && typeof cell.f === "string") {
            const [r, c] = k.split(":").map(Number);
            if (Number.isInteger(r) && Number.isInteger(c)) yield [r, c, cell.f] as [number, number, string];
          }
        }
      },
    });
  }, [first, maxRows, ordered]);

  const bounds = useMemo(() => {
    const cells = (first?.data?.cells || {}) as Record<string, PreviewCellRecord>;
    const merges: MergeRect[] = first?.data?.merges || [];
    let maxUsedRow = -1;
    let maxUsedCol = -1;

    for (let r = 0; r < maxRows; r += 1) {
      for (let c = 0; c < PREVIEW_SHEET_COLS; c += 1) {
        if (hasCellVisualContent(cells[`${r}:${c}`])) {
          if (r > maxUsedRow) maxUsedRow = r;
          if (c > maxUsedCol) maxUsedCol = c;
        }
      }
    }
    for (const m of merges) {
      if (!m || m.r1 >= maxRows || m.c1 >= PREVIEW_SHEET_COLS) continue;
      const r2 = Math.min(maxRows - 1, m.r2);
      const c2 = Math.min(PREVIEW_SHEET_COLS - 1, m.c2);
      if (r2 > maxUsedRow) maxUsedRow = r2;
      if (c2 > maxUsedCol) maxUsedCol = c2;
    }

    if (maxUsedRow < 0) {
      // Check if the worksheet has cells further down/right outside the top-left preview window
      const anyCellsInSheet = Object.values(cells).some((cell) => hasCellVisualContent(cell));
      if (!anyCellsInSheet) {
        return {
          isEmpty: true,
          renderRows: compact ? 5 : PREVIEW_EMPTY_ROWS,
          renderCols: PREVIEW_EMPTY_COLS,
        };
      }
      return {
        isEmpty: false,
        renderRows: compact ? 6 : 7,
        renderCols: PREVIEW_EMPTY_COLS,
      };
    }

    return {
      isEmpty: false,
      renderRows: Math.min(maxRows, Math.max(2, maxUsedRow + 1)),
      renderCols: Math.min(PREVIEW_SHEET_COLS, Math.max(3, maxUsedCol + 1)),
    };
  }, [compact, first, maxRows]);

  const colFractions = useMemo(() => {
    const widths: number[] = [];
    for (let c = 0; c < bounds.renderCols; c += 1) {
      const raw = first?.data?.colWidths?.[c] ?? COLUMN_WIDTH.default;
      widths.push(Math.max(54, Math.min(180, raw)));
    }
    const total = widths.reduce((sum, w) => sum + w, 0) || 1;
    return widths.map((w) => `${((w / total) * 100).toFixed(2)}%`);
  }, [bounds.renderCols, first]);

  const mergeLookup = useMemo(() => {
    const anchors = new Map<string, { rowSpan: number; colSpan: number }>();
    const covered = new Set<string>();
    const merges: MergeRect[] = first?.data?.merges || [];
    for (const m of merges) {
      if (!m || m.r1 >= bounds.renderRows || m.c1 >= bounds.renderCols) continue;
      const r2 = Math.min(bounds.renderRows - 1, m.r2);
      const c2 = Math.min(bounds.renderCols - 1, m.c2);
      const rowSpan = r2 - m.r1 + 1;
      const colSpan = c2 - m.c1 + 1;
      if (rowSpan <= 1 && colSpan <= 1) continue;
      anchors.set(`${m.r1}:${m.c1}`, { rowSpan, colSpan });
      for (let r = m.r1; r <= r2; r += 1) {
        for (let c = m.c1; c <= c2; c += 1) {
          if (r !== m.r1 || c !== m.c1) covered.add(`${r}:${c}`);
        }
      }
    }
    return { anchors, covered };
  }, [bounds.renderCols, bounds.renderRows, first]);

  if (bounds.isEmpty) {
    return (
      <div className={`tb-mini tb-mini--sheet is-empty ${compact ? "is-compact" : ""}`} aria-hidden="true">
        <div className="tb-mini-sheet-paper is-empty">
          <table className="tb-mini-grid">
            <tbody>
              {Array.from({ length: bounds.renderRows }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: bounds.renderCols }, (_, c) => (
                    <td
                      key={c}
                      className={`tb-mini-cell ${r === 0 && c === 0 ? "is-origin-cell" : ""}`}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const cells = (first?.data?.cells || {}) as Record<string, PreviewCellRecord>;
  const frozenRows = Math.min(2, Number(first?.data?.frozenRows) || 0);

  return (
    <div className={`tb-mini tb-mini--sheet ${compact ? "is-compact" : ""}`} aria-hidden="true">
      <div className="tb-mini-sheet-paper">
        <table className="tb-mini-grid">
          <colgroup>
            {colFractions.map((pct, c) => (
              <col key={c} style={{ width: pct }} />
            ))}
          </colgroup>
          <tbody>
            {Array.from({ length: bounds.renderRows }, (_, r) => (
              <tr key={r} className={r === frozenRows - 1 ? "is-frozen-edge" : undefined}>
                {Array.from({ length: bounds.renderCols }, (_, c) => {
                  const key = `${r}:${c}`;
                  if (mergeLookup.covered.has(key)) return null;
                  const span = mergeLookup.anchors.get(key);
                  const cell = cells[key];
                  let rawVal: CellResult | undefined = cell?.v;
                  let isErr = Boolean(cell?.fe);
                  if (cell && typeof cell.f === "string" && rawVal === undefined && calc && first) {
                    const evaluated = calc.value(first.id, r, c);
                    if (isFormulaError(evaluated)) {
                      rawVal = evaluated;
                      isErr = true;
                    } else if (evaluated !== null && evaluated !== undefined) {
                      rawVal = evaluated;
                    }
                  }
                  const isNumeric = typeof rawVal === "number" && Number.isFinite(rawVal);
                  const display = rawVal === undefined || rawVal === null || rawVal === ""
                    ? ""
                    : typeof rawVal === "string" && isErr
                      ? rawVal
                      : formatCellValue(rawVal, cell?.s);
                  const style = previewCellStyle(cell?.s, isNumeric, isErr || isFormulaError(rawVal));
                  return (
                    <td
                      key={c}
                      colSpan={span?.colSpan}
                      rowSpan={span?.rowSpan}
                      style={style}
                      className="tb-mini-cell"
                    >
                      {display ? <span className="tb-mini-cell-txt">{display}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fieldTypeBadge(type: Field["type"]): string {
  switch (type) {
    case "number": return "#";
    case "currency": return "$";
    case "percent": return "%";
    case "date": return "Cal";
    case "checkbox": return "✓";
    case "select":
    case "status":
    case "multiselect": return "▾";
    case "attachment": return "File";
    case "person": return "@";
    case "url": return "↗";
    case "email": return "✉";
    default: return "Aa";
  }
}

function findChoice(choices: Choice[] | undefined, value: string): Choice | undefined {
  if (!choices?.length) return undefined;
  return choices.find((ch) => ch.id === value || ch.label === value);
}

function renderSmartMiniCell(field: Field, raw: FieldValue) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (field.type === "checkbox") {
    const checked = Boolean(raw);
    return <span className={`tb-mini-check ${checked ? "is-checked" : ""}`}>{checked ? "✓" : ""}</span>;
  }
  if (field.type === "select" || field.type === "status") {
    const text = String(raw);
    const choice = findChoice(field.choices, text);
    const tone = choice?.color || "gray";
    return <span className={`tb-mini-pill tb-mini-pill--${tone}`}>{choice?.label || text}</span>;
  }
  if (field.type === "multiselect" && Array.isArray(raw)) {
    const items = raw.filter((v): v is string => typeof v === "string").slice(0, 2);
    if (!items.length) return null;
    return (
      <span className="tb-mini-pills">
        {items.map((item, idx) => {
          const choice = findChoice(field.choices, item);
          const tone = choice?.color || "gray";
          return <span key={idx} className={`tb-mini-pill tb-mini-pill--${tone}`}>{choice?.label || item}</span>;
        })}
      </span>
    );
  }
  if (field.type === "currency" && typeof raw === "number") {
    return <span className="tb-mini-cell-txt is-num">{formatCurrency(raw, field.currency, field.decimals)}</span>;
  }
  if (field.type === "percent" && typeof raw === "number") {
    const dp = typeof field.decimals === "number" ? field.decimals : 0;
    return <span className="tb-mini-cell-txt is-num">{`${(raw * 100).toFixed(dp)}%`}</span>;
  }
  if (field.type === "number" && typeof raw === "number") {
    const text = typeof field.decimals === "number" ? raw.toFixed(field.decimals) : String(raw);
    return <span className="tb-mini-cell-txt is-num">{text}</span>;
  }
  if (field.type === "date" && typeof raw === "string") {
    return <span className="tb-mini-cell-txt">{formatDate(raw)}</span>;
  }
  if (field.type === "attachment" && Array.isArray(raw)) {
    const files = raw as AttachmentRef[];
    if (!files.length) return null;
    return <span className="tb-mini-pill tb-mini-pill--gray">{files.length} file{files.length === 1 ? "" : "s"}</span>;
  }
  if (field.type === "person" && typeof raw === "object" && !Array.isArray(raw)) {
    const person = raw as PersonRef;
    return <span className="tb-mini-pill tb-mini-pill--blue">{person.name}</span>;
  }
  return <span className="tb-mini-cell-txt">{String(raw)}</span>;
}

function SmartTableMiniature({
  meta,
  records,
  compact = false,
}: {
  meta: SmartMeta;
  records: TableRecord[];
  compact?: boolean;
}) {
  const maxRows = compact ? PREVIEW_COMPACT_SMART_ROWS : PREVIEW_SMART_ROWS;
  const fields = useMemo(() => {
    const all = meta.fields || [];
    const firstView = meta.views?.[0];
    const hidden = new Set(firstView?.hidden || []);
    const visible = all.filter((f) => !hidden.has(f.id));
    return (visible.length ? visible : all).slice(0, PREVIEW_SMART_COLS);
  }, [meta]);

  const orderedRecords = useMemo(
    () => [...records].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, maxRows),
    [maxRows, records],
  );

  const colFractions = useMemo(() => {
    if (!fields.length) return ["100%"];
    const widths = fields.map((f) => Math.max(70, Math.min(200, f.width || 140)));
    const total = widths.reduce((sum, w) => sum + w, 0) || 1;
    return widths.map((w) => `${((w / total) * 100).toFixed(2)}%`);
  }, [fields]);

  const renderRows = Math.min(maxRows, Math.max(3, orderedRecords.length));

  return (
    <div className={`tb-mini tb-mini--smart ${compact ? "is-compact" : ""}`} aria-hidden="true">
      <div className="tb-mini-sheet-paper">
        <table className="tb-mini-grid">
          <colgroup>
            {colFractions.map((pct, idx) => (
              <col key={idx} style={{ width: pct }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.id} className="tb-mini-smarthead">
                  <span className="tb-mini-smarttype">{fieldTypeBadge(field.type)}</span>
                  <span className="tb-mini-smartname">{field.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: renderRows }, (_, r) => {
              const rec = orderedRecords[r];
              return (
                <tr key={rec?.id || `empty-${r}`}>
                  {fields.map((field) => (
                    <td key={field.id} className="tb-mini-cell tb-mini-smartcell">
                      {rec ? renderSmartMiniCell(field, rec.values?.[field.id] ?? null) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniatureSkeleton({ kind, failed = false }: { kind: TableKind; failed?: boolean }) {
  return (
    <div className={`tb-mini tb-mini--skeleton ${kind === "smart" ? "tb-mini--smart" : "tb-mini--sheet"}`} aria-hidden="true">
      <div className="tb-mini-sheet-paper is-empty">
        <table className="tb-mini-grid">
          {kind === "smart" && (
            <thead>
              <tr>
                {Array.from({ length: 4 }, (_, c) => (
                  <th key={c} className="tb-mini-smarthead">
                    <span className="tb-mini-skel-bar" />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {Array.from({ length: kind === "smart" ? 5 : 6 }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: 4 }, (_, c) => (
                  <td key={c} className="tb-mini-cell" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failed && <div className="tb-mini-status">Preview unavailable</div>}
    </div>
  );
}

/** Pure, synchronous miniature renderer for template cards or preloaded content. */
export function TableContentMiniature({
  content,
  compact = false,
}: {
  content: TableContent;
  sheetCount?: number;
  compact?: boolean;
}) {
  if (content.kind === "smart") {
    return <SmartTableMiniature meta={content.meta} records={content.records} compact={compact} />;
  }
  return <SpreadsheetMiniature sheets={content.sheets} compact={compact} />;
}

/** Artwork for Blank Spreadsheet / Blank Smart Table starter cards in the top creation strip. */
export function BlankTableArtwork({ kind }: { kind: TableKind }) {
  return (
    <div className={`tb-blank-art tb-blank-art--${kind}`} aria-hidden="true">
      {kind === "smart" ? (
        <div className="tb-blank-smart-frame">
          <div className="tb-blank-smart-head">
            <span />
            <span />
            <span />
          </div>
          <div className="tb-blank-plus-wrap">
            <PlusCross />
          </div>
        </div>
      ) : (
        <div className="tb-blank-plus-wrap">
          <PlusCross />
        </div>
      )}
    </div>
  );
}

function PlusCross() {
  return (
    <svg className="tb-blank-plus" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect x="19" y="6" width="6" height="14" rx="2" fill="var(--ds-primary)" />
      <rect x="24" y="19" width="14" height="6" rx="2" fill="var(--ds-emerald)" />
      <rect x="19" y="24" width="6" height="14" rx="2" fill="var(--ds-amber)" />
      <rect x="6" y="19" width="14" height="6" rx="2" fill="var(--ds-rose)" />
      <rect x="19" y="19" width="6" height="6" fill="var(--ds-primary)" />
    </svg>
  );
}

/** Lazy-loaded, revision-cached miniature preview for an existing user or shared table card. */
export function TableCardPreview({ table }: { table: TableSummary }) {
  const cacheKey = `${table.id}:${table.revision}`;
  const [entry, setEntry] = useState<PreviewCacheEntry | null>(() => previewCache.get(cacheKey) || null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState<boolean>(() => Boolean(previewCache.get(cacheKey)));
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = previewCache.get(cacheKey);
    if (cached) {
      setEntry(cached);
      setFailed(false);
      setVisible(true);
      return;
    }
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "260px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cacheKey]);

  useEffect(() => {
    const cached = previewCache.get(cacheKey);
    if (cached) {
      setEntry(cached);
      setFailed(false);
      return;
    }
    if (!visible) return;
    let cancelled = false;
    setFailed(false);
    enqueuePreviewFetch(table.id, table.revision)
      .then((loaded) => {
        if (!cancelled) setEntry(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, table.id, table.revision, visible]);

  return (
    <div ref={hostRef} className="tb-card-preview-host">
      {entry ? (
        <TableContentMiniature content={entry.content} sheetCount={table.sheetCount || entry.sheetCount} />
      ) : (
        <MiniatureSkeleton kind={table.kind} failed={failed} />
      )}
    </div>
  );
}
