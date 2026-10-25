// Project activity analytics — pure, dependency-light rules shared by the
// Worker (authoritative aggregation) and the tests.
//
// Every `project_activity` row in the requested window is counted (no sampling
// and no "latest N" cap), bucketed by the viewer's local calendar day, so the
// chart in the Activity tab reflects exactly what happened in the project.

import { addDays, daysBetween, localDateOf, safeTimeZone, startOfDayInstant } from "./calendar-rules.js";

/** Metric → the activity actions it counts. `all` counts every action, including future ones. */
export const PROJECT_ACTIVITY_METRICS = Object.freeze({
  all: null,
  fields: Object.freeze(["field_created", "field_updated", "field_status_changed", "field_deleted"]),
  comments: Object.freeze(["comment_added"]),
  requests: Object.freeze(["field_requested", "field_request_withdrawn", "field_request_approved", "field_request_rejected"]),
  team: Object.freeze(["member_added", "member_updated", "member_removed", "member_left"]),
});
export const PROJECT_ACTIVITY_METRIC_IDS = Object.freeze(Object.keys(PROJECT_ACTIVITY_METRICS));

/**
 * Supported ranges. Short ranges are plotted per day; the quarter view uses
 * seven-day buckets (13 × 7 = 91 days) so the line stays readable.
 */
export const PROJECT_ACTIVITY_RANGES = Object.freeze({
  7: Object.freeze({ days: 7, bucketDays: 1 }),
  30: Object.freeze({ days: 30, bucketDays: 1 }),
  90: Object.freeze({ days: 91, bucketDays: 7 }),
});
export const DEFAULT_PROJECT_ACTIVITY_RANGE = 30;

export function normalizeActivityRange(value) {
  const range = Number(value);
  return Object.prototype.hasOwnProperty.call(PROJECT_ACTIVITY_RANGES, range) ? range : DEFAULT_PROJECT_ACTIVITY_RANGE;
}

const metricsByAction = new Map();
for (const [metric, actions] of Object.entries(PROJECT_ACTIVITY_METRICS)) {
  if (!actions) continue;
  for (const action of actions) metricsByAction.set(action, metric);
}
/** The non-`all` metric an action belongs to, or null (still counted in `all`). */
export function activityMetricOf(action) {
  return metricsByAction.get(String(action || "")) || null;
}

const emptyCounts = () => Object.fromEntries(PROJECT_ACTIVITY_METRIC_IDS.map((id) => [id, 0]));

/**
 * The calendar window for a range in a time zone.
 * `previousFrom` … `previousTo` is the equally long period right before it,
 * used for the "vs previous period" comparison. `since` is the first instant
 * that has to be read from the database.
 */
export function projectActivityWindow(rangeValue, timeZoneValue, now = Date.now()) {
  const range = normalizeActivityRange(rangeValue);
  const { days, bucketDays } = PROJECT_ACTIVITY_RANGES[range];
  const timeZone = safeTimeZone(timeZoneValue, "UTC");
  const to = localDateOf(now, timeZone);
  const from = addDays(to, -(days - 1));
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(from, -days);
  return {
    range, days, bucketDays, timeZone, from, to, previousFrom, previousTo,
    since: new Date(startOfDayInstant(previousFrom, timeZone)).toISOString(),
  };
}

/**
 * Aggregates raw activity rows (`{ action, actor_id, created_at }`) into the
 * chart payload. Rows outside the window are ignored; empty buckets are kept
 * as real zeroes so quiet days are shown honestly.
 */
export function summarizeProjectActivity(rows, { range, timeZone, now = Date.now() } = {}) {
  const period = projectActivityWindow(range, timeZone, now);
  const { days, bucketDays, from, to, previousFrom } = period;
  const bucketCount = Math.ceil(days / bucketDays);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = addDays(from, index * bucketDays);
    const end = addDays(start, bucketDays - 1);
    return { start, end: end > to ? to : end, counts: emptyCounts() };
  });
  const totals = emptyCounts();
  const previousTotals = emptyCounts();
  const actors = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const ms = Date.parse(String(row?.created_at || ""));
    if (!Number.isFinite(ms)) continue;
    const date = localDateOf(ms, period.timeZone);
    const metric = activityMetricOf(row.action);
    if (date >= previousFrom && date < from) {
      previousTotals.all += 1;
      if (metric) previousTotals[metric] += 1;
      continue;
    }
    if (date < from || date > to) continue;
    const bucket = buckets[Math.floor(daysBetween(from, date) / bucketDays)];
    if (!bucket) continue;
    bucket.counts.all += 1;
    totals.all += 1;
    if (metric) { bucket.counts[metric] += 1; totals[metric] += 1; }
    if (row.actor_id) actors.add(String(row.actor_id));
  }

  return {
    range: period.range,
    bucket: bucketDays === 1 ? "day" : "week",
    timeZone: period.timeZone,
    from, to,
    previousFrom: period.previousFrom,
    previousTo: period.previousTo,
    generatedAt: new Date(now).toISOString(),
    totals,
    previousTotals,
    activeMembers: actors.size,
    buckets,
  };
}
