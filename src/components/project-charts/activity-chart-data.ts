// Pure helpers that turn the server's activity stats into AnalyticsLineChart
// data. Kept free of React so they can be unit-tested directly.

import type { ProjectActivityMetric, ProjectActivityRange, ProjectActivityStats } from "../../types";
import type { AnalyticsDataPoint } from "./analytics-chart";

export interface ActivityMetricDefinition {
  id: ProjectActivityMetric;
  /** Tab title. */
  title: string;
  /** Tooltip chip text. */
  chip: string;
  /** Singular / plural unit for counts. */
  unit: [string, string];
  description: string;
}

export const ACTIVITY_METRICS: readonly ActivityMetricDefinition[] = [
  { id: "all", title: "All activity", chip: "All", unit: ["event", "events"], description: "Every recorded project event" },
  { id: "fields", title: "Fields", chip: "Fields", unit: ["field change", "field changes"], description: "Fields created, edited, moved or deleted" },
  { id: "comments", title: "Comments", chip: "Comments", unit: ["comment", "comments"], description: "Comments added to fields" },
  { id: "requests", title: "Requests", chip: "Requests", unit: ["request event", "request events"], description: "Field requests sent, withdrawn, approved or rejected" },
  { id: "team", title: "Team", chip: "Team", unit: ["member change", "member changes"], description: "Members added, updated, removed or leaving" },
];

export const ACTIVITY_RANGES: readonly { id: ProjectActivityRange; label: string; long: string }[] = [
  { id: 7, label: "7D", long: "last 7 days" },
  { id: 30, label: "30D", long: "last 30 days" },
  { id: 90, label: "90D", long: "last 13 weeks" },
];

export function metricDefinition(metric: ProjectActivityMetric): ActivityMetricDefinition {
  return ACTIVITY_METRICS.find((item) => item.id === metric) ?? ACTIVITY_METRICS[0];
}

export function countText(value: number, metric: ProjectActivityMetric): string {
  const [one, many] = metricDefinition(metric).unit;
  return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
}

/** One chart point per bucket (day or week); quiet buckets stay as real zeroes. */
export function activityChartData(stats: ProjectActivityStats, metric: ProjectActivityMetric): AnalyticsDataPoint[] {
  const chip = metricDefinition(metric).chip;
  return stats.buckets.map((bucket) => ({ date: bucket.start, label: chip, value: bucket.counts[metric] ?? 0 }));
}

/**
 * Upper bound of the y axis so every grid line lands on a whole number
 * (counts are integers): the smallest multiple of (gridLines − 1) ≥ max.
 */
export function niceCountMax(max: number, gridLines = 5): number {
  const intervals = Math.max(1, gridLines - 1);
  if (!Number.isFinite(max) || max <= 0) return intervals;
  return Math.ceil(max / intervals) * intervals;
}

/** The highest bucket (latest one on ties), or null when everything is zero. */
export function peakIndex(points: readonly AnalyticsDataPoint[]): number | null {
  let best: number | null = null;
  points.forEach((point, index) => {
    if (point.value > 0 && (best === null || point.value >= points[best].value)) best = index;
  });
  return best;
}

export type ActivityDelta = { kind: "none" } | { kind: "new" } | { kind: "change"; percent: number };
/** Change against the equally long previous period. */
export function activityDelta(current: number, previous: number): ActivityDelta {
  if (!previous) return current ? { kind: "new" } : { kind: "none" };
  return { kind: "change", percent: Math.round(((current - previous) / previous) * 100) };
}
export function deltaText(delta: ActivityDelta): string {
  if (delta.kind === "none") return "No change";
  if (delta.kind === "new") return "New";
  if (delta.percent === 0) return "0%";
  return `${delta.percent > 0 ? "+" : "−"}${Math.abs(delta.percent)}%`;
}

const parse = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
};
const fmt = (date: string, options: Intl.DateTimeFormatOptions) => parse(date).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

/** Short axis label, e.g. "Oct 19". */
export function axisDate(date: string): string {
  return fmt(date, { month: "short", day: "numeric" });
}
/** Tooltip date: "Sat, Oct 25" for days, "Jul 27 – Aug 2" for weeks (year added when it differs from `today`). */
export function bucketDateText(start: string, end: string, today: string): string {
  const year = (value: string) => value.slice(0, 4);
  const withYear = year(start) !== year(today) || year(end) !== year(today);
  if (start === end) return fmt(start, { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const left = fmt(start, { month: "short", day: "numeric" });
  const right = sameMonth ? fmt(end, { day: "numeric" }) : fmt(end, { month: "short", day: "numeric" });
  return `${left} – ${right}${withYear ? `, ${year(end)}` : ""}`;
}
