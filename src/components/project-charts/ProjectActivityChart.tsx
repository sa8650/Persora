import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, Loader2, RefreshCw } from "lucide-react";
import { loadProjectActivityStats } from "../../lib/cloud";
import type { ProjectActivityMetric, ProjectActivityRange, ProjectActivityStats } from "../../types";
import { AnalyticsLineChart } from "./analytics-chart";
import {
  ACTIVITY_METRICS,
  ACTIVITY_RANGES,
  activityChartData,
  activityDelta,
  axisDate,
  bucketDateText,
  countText,
  deltaText,
  metricDefinition,
  niceCountMax,
  peakIndex,
} from "./activity-chart-data";
import "./project-charts.css";

const GRID_LINES = 5;

export interface ProjectActivityChartProps {
  projectId: string;
  /** Changes whenever the project's activity feed changes, so the chart refetches. */
  refreshKey?: string;
  /** Override for tests / previews. */
  loadStats?: (projectId: string, range: ProjectActivityRange) => Promise<ProjectActivityStats>;
}

/**
 * Activity analytics for one project: every event in the selected window,
 * counted on the server and bucketed by the viewer's local day (weeks for the
 * 90-day view), drawn with the cult-ui Analytics Chart.
 */
export function ProjectActivityChart({ projectId, refreshKey = "", loadStats = loadProjectActivityStats }: ProjectActivityChartProps) {
  const [range, setRange] = useState<ProjectActivityRange>(30);
  const [metric, setMetric] = useState<ProjectActivityMetric>("all");
  const [stats, setStats] = useState<ProjectActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    loadStats(projectId, range)
      .then((next) => { if (request.current === id) setStats(next); })
      .catch((reason: unknown) => {
        if (request.current !== id) return;
        setError(reason instanceof Error && reason.message ? reason.message : "Activity analytics could not be loaded.");
      })
      .finally(() => { if (request.current === id) setLoading(false); });
  }, [projectId, range, refreshKey, attempt, loadStats]);

  // A different project must never show the previous project's numbers.
  useEffect(() => { setStats(null); }, [projectId]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = stats && stats.range === range ? stats : null;
  const definition = metricDefinition(metric);
  const rangeInfo = ACTIVITY_RANGES.find((item) => item.id === range) ?? ACTIVITY_RANGES[1];

  const data = useMemo(() => (current ? activityChartData(current, metric) : []), [current, metric]);
  const peak = useMemo(() => peakIndex(data), [data]);
  const yMax = useMemo(() => niceCountMax(Math.max(0, ...data.map((point) => point.value)), GRID_LINES), [data]);
  const endOf = useMemo(() => new Map((current?.buckets ?? []).map((bucket) => [bucket.start, bucket.end])), [current]);
  const unitLabel = current?.bucket === "week" ? "week" : "day";
  const total = current?.totals[metric] ?? 0;

  return (
    <div className="pj-card pc-activity-card" data-testid="project-activity-chart">
      <div className="pj-card-head pc-head">
        <h3><BarChart3 size={16} aria-hidden="true" /> Activity analytics</h3>
        <div className="pj-segmented pc-range" role="group" aria-label="Chart period">
          {ACTIVITY_RANGES.map((item) => (
            <button key={item.id} type="button" className={item.id === range ? "active" : ""} aria-pressed={item.id === range} title={`Show the ${item.long}`} onClick={() => setRange(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pc-metrics" role="group" aria-label="Activity type">
        {ACTIVITY_METRICS.map((item) => {
          const value = current?.totals[item.id] ?? 0;
          const delta = current ? activityDelta(value, current.previousTotals[item.id] ?? 0) : null;
          const tone = !delta || delta.kind === "none" ? "flat" : delta.kind === "new" || delta.percent > 0 ? "up" : delta.percent < 0 ? "down" : "flat";
          return (
            <button
              key={item.id}
              type="button"
              className={`pc-metric${item.id === metric ? " is-active" : ""}`}
              aria-pressed={item.id === metric}
              title={item.description}
              onClick={() => setMetric(item.id)}
            >
              <span className="pc-metric-title">{item.title}</span>
              <span className="pc-metric-value">{current ? value.toLocaleString("en-US") : "—"}</span>
              {delta && (
                <span className={`pc-metric-delta is-${tone}`} title={current ? `${countText(current.previousTotals[item.id] ?? 0, item.id)} in the previous period (${axisDate(current.previousFrom)} – ${axisDate(current.previousTo)})` : undefined}>
                  {deltaText(delta)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="pc-chart-area" aria-busy={loading}>
        {error && !current ? (
          <div className="pc-state pc-state-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <p>{error}</p>
            <button type="button" className="pj-ghost-button" onClick={retry}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
          </div>
        ) : !current ? (
          <div className="pc-state" aria-label="Loading activity analytics">
            <Loader2 size={18} className="pj-spin" aria-hidden="true" />
            <p>Counting project activity…</p>
          </div>
        ) : (
          <>
            {total === 0 && <p className="pc-empty-note">No {definition.unit[1]} in the {rangeInfo.long}. Quiet {unitLabel}s are shown as zero.</p>}
            <AnalyticsLineChart
              key={`${range}-${metric}-${current.from}`}
              className="pc-chart"
              data={data}
              fluid
              showAxes
              height={260}
              gridLines={GRID_LINES}
              minValue={0}
              maxValue={yMax}
              pinnedIndices={peak === null ? [] : [peak]}
              valueLabel={definition.unit[1]}
              formatValue={(value) => countText(value, metric)}
              formatTick={(value) => Math.round(value).toLocaleString("en-US")}
              formatDate={(point) => bucketDateText(point.date, endOf.get(point.date) ?? point.date, current.to)}
              formatAxisDate={(point) => axisDate(point.date)}
              ariaLabel={`${definition.title} per ${unitLabel}, ${rangeInfo.long}: ${countText(total, metric)} in total${peak !== null ? `, peak ${countText(data[peak].value, metric)} on ${bucketDateText(data[peak].date, endOf.get(data[peak].date) ?? data[peak].date, current.to)}` : ""}. Use the arrow keys to read each ${unitLabel}.`}
            />
          </>
        )}
        {loading && current && <span className="pc-refreshing" role="status"><Loader2 size={12} className="pj-spin" aria-hidden="true" /> Updating</span>}
      </div>

      {current && (
        <p className="pc-foot">
          <span>{countText(total, metric)} · {axisDate(current.from)} – {axisDate(current.to)}</span>
          {peak !== null && <span>Peak {unitLabel}: <b>{bucketDateText(data[peak].date, endOf.get(data[peak].date) ?? data[peak].date, current.to)}</b> ({countText(data[peak].value, metric)})</span>}
          <span>{current.activeMembers.toLocaleString("en-US")} {current.activeMembers === 1 ? "person" : "people"} active</span>
          <span className="pc-foot-zone" title="Days follow the time zone in your profile">Every event counted · {current.timeZone}</span>
        </p>
      )}
      {error && current && <p className="pc-inline-error" role="alert">{error} <button type="button" className="pj-link-button" onClick={retry}>Retry</button></p>}
    </div>
  );
}
