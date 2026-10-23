// Persora Calendar — pure view helpers (ranges, headings, layout, form drafts).
import {
  addDays, addMonths, daysBetween, localDateOf, localTimeOf, parseDate, shiftLocalDays, startOfDayInstant, startOfMonth, startOfWeek,
  weekdayOf, zonedTimeToInstant,
} from "../../cloudflare/calendar-rules.js";
import type { CalendarCategory, CalendarItemType, CalendarOccurrence, EventInput, MoveTarget, MovedTiming, RecurrenceFrequency } from "../../cloudflare/calendar-rules.js";
import type { CalendarEvent } from "./calendar-api";

export type CalendarViewMode = "week" | "day" | "month" | "agenda";
export type Occurrence = CalendarOccurrence<CalendarEvent>;

export const VIEW_MODES: { id: CalendarViewMode; label: string; key: string }[] = [
  { id: "day", label: "Day", key: "d" },
  { id: "week", label: "Week", key: "w" },
  { id: "month", label: "Month", key: "m" },
  { id: "agenda", label: "Agenda", key: "a" },
];
export const AGENDA_DAYS = 30;
export const WEEK_STARTS_ON = 0;

export const CATEGORY_OPTIONS: { id: CalendarCategory; label: string }[] = [
  { id: "personal", label: "Personal" }, { id: "work", label: "Work" }, { id: "family", label: "Family" },
  { id: "health", label: "Health" }, { id: "travel", label: "Travel" }, { id: "social", label: "Social" }, { id: "other", label: "Other" },
];
export const REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "5 minutes before" }, { minutes: 15, label: "15 minutes before" }, { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" }, { minutes: 1440, label: "1 day before" },
];
export const ITEM_TYPE_OPTIONS: { id: CalendarItemType; label: string; create: string }[] = [
  { id: "event", label: "Event", create: "Create event" },
  { id: "task", label: "Task", create: "Create task" },
  { id: "appointment", label: "Appointment", create: "Schedule appointment" },
];
/** Lower-case noun for messages ("event", "task", "appointment"). */
export const itemNoun = (type: CalendarItemType | undefined | null) => (type === "task" ? "task" : type === "appointment" ? "appointment" : "event");
export const DEFAULT_DURATION: Record<CalendarItemType, number> = { event: 60, task: 30, appointment: 30 };
export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} hour${hours === 1 ? "" : "s"}`;
}
export const reminderLabel = (minutes: number | null | undefined) => REMINDER_OPTIONS.find((option) => option.minutes === minutes)?.label || null;

export function todayIn(zone: string, now = Date.now()): string {
  return localDateOf(now, zone);
}

/** Visible local-date range [from, to) for a view anchored on `anchor`. */
export function visibleRange(mode: CalendarViewMode, anchor: string): { from: string; to: string } {
  if (mode === "day") return { from: anchor, to: addDays(anchor, 1) };
  if (mode === "week") { const from = startOfWeek(anchor, WEEK_STARTS_ON); return { from, to: addDays(from, 7) }; }
  if (mode === "month") {
    const first = startOfMonth(anchor);
    const from = startOfWeek(first, WEEK_STARTS_ON);
    const nextMonth = addMonths(first, 1);
    const weeks = Math.ceil(daysBetween(from, nextMonth) / 7);
    return { from, to: addDays(from, weeks * 7) };
  }
  return { from: anchor, to: addDays(anchor, AGENDA_DAYS) };
}

export function shiftAnchor(mode: CalendarViewMode, anchor: string, direction: 1 | -1): string {
  if (mode === "day") return addDays(anchor, direction);
  if (mode === "week") return addDays(anchor, 7 * direction);
  if (mode === "month") return addMonths(startOfMonth(anchor), direction);
  return addDays(anchor, AGENDA_DAYS * direction);
}

const utcDate = (date: string) => { const { year, month, day } = parseDate(date); return new Date(Date.UTC(year, month - 1, day, 12)); };
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" });

/** Formats a local calendar date (YYYY-MM-DD) without any zone conversion. */
export function formatDay(date: string, options: Intl.DateTimeFormatOptions): string {
  return fmt(options).format(utcDate(date));
}

export function rangeHeading(mode: CalendarViewMode, anchor: string): string {
  if (mode === "day") return formatDay(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (mode === "month") return formatDay(anchor, { month: "long", year: "numeric" });
  const { from, to } = visibleRange(mode, anchor);
  const last = addDays(to, -1);
  const a = parseDate(from); const b = parseDate(last);
  if (a.year !== b.year) return `${formatDay(from, { month: "short", day: "numeric", year: "numeric" })} – ${formatDay(last, { month: "short", day: "numeric", year: "numeric" })}`;
  if (a.month !== b.month) return `${formatDay(from, { month: "short", day: "numeric" })} – ${formatDay(last, { month: "short", day: "numeric" })}, ${b.year}`;
  return `${formatDay(from, { month: "long" })} ${a.day} – ${b.day}, ${a.year}`;
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let date = from; date < to; date = addDays(date, 1)) out.push(date);
  return out;
}

export function formatTime(ms: number, zone: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(ms));
}
export function formatHour(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, hour)));
}

/** First and last local dates an occurrence touches. */
export function occurrenceDays(occurrence: Occurrence, zone: string): { first: string; last: string } {
  if (occurrence.allDay) return { first: occurrence.startDate as string, last: addDays(occurrence.endDate as string, -1) };
  const first = localDateOf(occurrence.startMs as number, zone);
  const last = localDateOf(Math.max(occurrence.startMs as number, (occurrence.endMs as number) - 1), zone);
  return { first, last };
}

/** All-day events and timed events lasting 24h or more go in the all-day row. */
export function isBanner(occurrence: Occurrence): boolean {
  return occurrence.allDay || ((occurrence.endMs as number) - (occurrence.startMs as number)) >= 86_400_000;
}

export function occurrenceTimeLabel(occurrence: Occurrence, zone: string): string {
  if (occurrence.allDay) {
    const days = daysBetween(occurrence.startDate as string, occurrence.endDate as string);
    return days > 1 ? `${formatDay(occurrence.startDate as string, { month: "short", day: "numeric" })} – ${formatDay(addDays(occurrence.endDate as string, -1), { month: "short", day: "numeric" })} · All day` : "All day";
  }
  const { first, last } = occurrenceDays(occurrence, zone);
  const start = formatTime(occurrence.startMs as number, zone); const end = formatTime(occurrence.endMs as number, zone);
  if (first === last) return `${start} – ${end}`;
  return `${formatDay(first, { month: "short", day: "numeric" })}, ${start} – ${formatDay(last, { month: "short", day: "numeric" })}, ${end}`;
}

export function occurrenceDateLabel(occurrence: Occurrence, zone: string): string {
  const { first } = occurrenceDays(occurrence, zone);
  return formatDay(first, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Wall-clock minutes since local midnight (DST days still render on a 24-hour grid). */
const minutesOfDay = (ms: number, zone: string) => { const [h, m] = localTimeOf(ms, zone).split(":").map(Number); return h * 60 + m; };

export interface TimedBlock { occurrence: Occurrence; top: number; bottom: number; column: number; columns: number; continuesBefore: boolean; continuesAfter: boolean }

/** Positions timed occurrences inside one day column (minutes 0–1440), side by side when they overlap. */
export function layoutDay(occurrences: Occurrence[], date: string, zone: string): TimedBlock[] {
  const dayStart = startOfDayInstant(date, zone);
  const dayEnd = startOfDayInstant(addDays(date, 1), zone);
  const blocks: TimedBlock[] = [];
  for (const occurrence of occurrences) {
    if (isBanner(occurrence)) continue;
    const start = occurrence.startMs as number; const end = occurrence.endMs as number;
    if (!(start < dayEnd && end > dayStart)) continue;
    const continuesBefore = start < dayStart; const continuesAfter = end > dayEnd;
    const top = continuesBefore ? 0 : minutesOfDay(start, zone);
    let bottom = continuesAfter ? 1440 : minutesOfDay(end, zone);
    if (bottom <= top) bottom = Math.min(1440, top + Math.max(15, Math.round((end - start) / 60000)));
    blocks.push({ occurrence, top, bottom: Math.max(bottom, top + 15), column: 0, columns: 1, continuesBefore, continuesAfter });
  }
  blocks.sort((a, b) => a.top - b.top || (b.bottom - b.top) - (a.bottom - a.top));
  let cluster: TimedBlock[] = []; let clusterEnd = -1; let columnEnds: number[] = [];
  const flush = () => { for (const block of cluster) block.columns = columnEnds.length; cluster = []; columnEnds = []; };
  for (const block of blocks) {
    if (cluster.length && block.top >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= block.top);
    if (column < 0) { column = columnEnds.length; columnEnds.push(block.bottom); } else columnEnds[column] = block.bottom;
    block.column = column;
    cluster.push(block);
    clusterEnd = Math.max(cluster.length === 1 ? 0 : clusterEnd, block.bottom);
  }
  flush();
  return blocks;
}

export interface SpanSegment { occurrence: Occurrence; start: number; end: number; lane: number; continuesBefore: boolean; continuesAfter: boolean }

/** Packs occurrences into lanes across a row of `days` (week all-day row, or one month week). */
export function packSpans(occurrences: Occurrence[], days: string[], zone: string, include: (occurrence: Occurrence) => boolean): SpanSegment[] {
  const first = days[0]; const last = days[days.length - 1];
  const segments: SpanSegment[] = [];
  for (const occurrence of occurrences) {
    if (!include(occurrence)) continue;
    const span = occurrenceDays(occurrence, zone);
    if (span.last < first || span.first > last) continue;
    const start = Math.max(0, daysBetween(first, span.first));
    const end = Math.min(days.length - 1, daysBetween(first, span.last));
    segments.push({ occurrence, start, end, lane: 0, continuesBefore: span.first < first, continuesAfter: span.last > last });
  }
  segments.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || Number(b.occurrence.allDay) - Number(a.occurrence.allDay) || ((a.occurrence.startMs || 0) - (b.occurrence.startMs || 0)));
  const laneEnds: number[] = [];
  for (const segment of segments) {
    let lane = laneEnds.findIndex((end) => end < segment.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(segment.end); } else laneEnds[lane] = segment.end;
    segment.lane = lane;
  }
  return segments;
}

/** Occurrences touching each local date, in display order. */
export function groupByDay(occurrences: Occurrence[], from: string, to: string, zone: string): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const span = occurrenceDays(occurrence, zone);
    const begin = span.first < from ? from : span.first;
    for (let date = begin; date <= span.last && date < to; date = addDays(date, 1)) {
      const list = map.get(date) || []; list.push(occurrence); map.set(date, list);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Form drafts
// ---------------------------------------------------------------------------

export interface EventDraft {
  itemType: CalendarItemType;
  title: string;
  description: string;
  location: string;
  category: CalendarCategory | "";
  allDay: boolean;
  timeZone: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: RecurrenceFrequency | "none";
  interval: number;
  ends: "never" | "until" | "count";
  until: string;
  count: number;
  reminderMinutes: number | "";
  reminderEmail: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");
export function addMinutesToTime(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const within = ((total % 1440) + 1440) % 1440;
  return { date: addDays(date, dayShift), time: `${pad(Math.floor(within / 60))}:${pad(within % 60)}` };
}

/** Blank draft for a new item at a date (and optionally a time) in the member's zone. */
export function newDraft(zone: string, date: string, time: string | null, allDay = false, itemType: CalendarItemType = "event"): EventDraft {
  const startTime = time || "09:00";
  const end = addMinutesToTime(date, startTime, DEFAULT_DURATION[itemType]);
  if (itemType === "appointment") allDay = false;
  return {
    itemType, title: "", description: "", location: "", category: "", allDay, timeZone: zone,
    startDate: date, startTime, endDate: allDay ? date : end.date, endTime: end.time,
    repeat: "none", interval: 1, ends: "never", until: "", count: 10, reminderMinutes: "", reminderEmail: false,
  };
}

function draftBase(event: CalendarEvent): Omit<EventDraft, "startDate" | "startTime" | "endDate" | "endTime"> {
  const recurrence = event.seriesId ? null : event.recurrence;
  return {
    itemType: event.itemType || "event",
    title: event.title, description: event.description || "", location: event.location || "", category: event.category || "",
    allDay: event.allDay, timeZone: event.timeZone,
    repeat: recurrence?.freq || "none", interval: recurrence?.interval || 1,
    ends: recurrence?.until ? "until" : recurrence?.count ? "count" : "never",
    until: recurrence?.until || "", count: recurrence?.count || 10,
    reminderMinutes: event.reminderMinutes ?? "", reminderEmail: Boolean(event.reminderEmail),
  };
}

function timingFields(allDay: boolean, zone: string, startDate: string | null, endDate: string | null, startMs: number | null, endMs: number | null) {
  if (allDay) return { startDate: startDate as string, endDate: addDays(endDate as string, -1), startTime: "09:00", endTime: "10:00" };
  return {
    startDate: localDateOf(startMs as number, zone), startTime: localTimeOf(startMs as number, zone),
    endDate: localDateOf(endMs as number, zone), endTime: localTimeOf(endMs as number, zone),
  };
}

/**
 * Draft for editing a single event or a whole series (its first occurrence's
 * timing). Wall-clock fields use the event's own time zone, so saving without
 * changes never shifts the event.
 */
export function draftFromEvent(event: CalendarEvent): EventDraft {
  return {
    ...draftBase(event),
    ...timingFields(event.allDay, event.timeZone, event.startDate, event.endDate,
      event.startAt ? Date.parse(event.startAt) : null, event.endAt ? Date.parse(event.endAt) : null),
  };
}

/** Draft for editing one occurrence of a series (no repeat options). */
export function draftFromOccurrence(occurrence: Occurrence): EventDraft {
  const base = draftBase(occurrence.event);
  return {
    ...base, repeat: "none", ends: "never",
    ...timingFields(occurrence.allDay, occurrence.event.timeZone, occurrence.startDate, occurrence.endDate, occurrence.startMs, occurrence.endMs),
  };
}

export function draftToInput(draft: EventDraft, allowRecurrence: boolean): EventInput {
  allowRecurrence = allowRecurrence && draft.itemType === "event";
  return {
    itemType: draft.itemType,
    title: draft.title, description: draft.description, location: draft.location,
    category: draft.category || null, allDay: draft.allDay, timeZone: draft.timeZone,
    start: draft.allDay ? { date: draft.startDate } : { date: draft.startDate, time: draft.startTime },
    end: draft.allDay ? { date: draft.endDate } : { date: draft.endDate, time: draft.endTime },
    recurrence: allowRecurrence && draft.repeat !== "none" ? {
      freq: draft.repeat, interval: draft.interval,
      until: draft.ends === "until" ? draft.until || null : null,
      count: draft.ends === "count" ? draft.count : null,
    } : null,
    reminderMinutes: draft.reminderMinutes === "" ? null : draft.reminderMinutes,
    reminderEmail: draft.reminderMinutes === "" ? false : draft.reminderEmail,
  };
}

/** Client-side check mirroring the server rules, for instant feedback. */
export function draftError(draft: EventDraft): { field: string; message: string } | null {
  const noun = itemNoun(draft.itemType);
  if (!draft.title.trim()) return { field: "title", message: "Add a title." };
  if (draft.itemType === "appointment" && draft.allDay) return { field: "start", message: "Appointments need a start time." };
  if (!draft.startDate) return { field: "start", message: "Choose a start date." };
  if (!draft.endDate) return { field: "end", message: "Choose an end date." };
  if (draft.allDay) {
    if (draft.endDate < draft.startDate) return { field: "end", message: `The ${noun} must end on or after the day it starts.` };
  } else {
    if (!draft.startTime || !draft.endTime) return { field: "start", message: "Choose start and end times." };
    const start = zonedTimeToInstant(draft.startDate, draft.startTime, draft.timeZone);
    const end = zonedTimeToInstant(draft.endDate, draft.endTime, draft.timeZone);
    if (!(end > start)) return { field: "end", message: `The ${noun} must end after it starts.` };
  }
  if (draft.repeat !== "none" && draft.ends === "until" && draft.until && draft.until < draft.startDate) return { field: "recurrence", message: "The repeat end date must be on or after the start date." };
  return null;
}

export const weekdayName = (date: string, style: "short" | "long" = "short") => formatDay(date, { weekday: style });
export const isWeekend = (date: string) => { const day = weekdayOf(date); return day === 0 || day === 6; };

/** A creation time rounded to the next half hour, for "New event" on today. */
export function nextHalfHour(zone: string, now = Date.now()): { date: string; time: string } {
  const date = localDateOf(now, zone);
  const [h, m] = localTimeOf(now, zone).split(":").map(Number);
  const total = Math.ceil((h * 60 + m + 1) / 30) * 30;
  return total >= 1440 ? { date: addDays(date, 1), time: "00:00" } : { date, time: `${pad(Math.floor(total / 60))}:${pad(total % 60)}` };
}

/** Minutes between a timed draft's start and end (wall clock in the draft's zone). */
export function draftDuration(draft: EventDraft): number {
  if (draft.allDay || !draft.startTime || !draft.endTime || !draft.startDate || !draft.endDate) return 0;
  return Math.round((zonedTimeToInstant(draft.endDate, draft.endTime, draft.timeZone) - zonedTimeToInstant(draft.startDate, draft.startTime, draft.timeZone)) / 60000);
}

/** Applies a new timing (from a drag, resize or Reschedule) to a draft. */
export function applyTiming(draft: EventDraft, timing: MovedTiming): EventDraft {
  if (timing.allDay) return { ...draft, allDay: true, startDate: timing.start.date, endDate: timing.end.date };
  return { ...draft, allDay: false, startDate: timing.start.date, startTime: timing.start.time as string, endDate: timing.end.date, endTime: timing.end.time as string };
}

/** Editable draft for a quick-add preview (input from quickAddToInput). */
export function draftFromInput(input: EventInput, zone: string): EventDraft {
  const itemType = input.itemType || "event";
  const base = newDraft(input.timeZone || zone, input.start.date, input.start.time || null, input.allDay, itemType);
  return {
    ...base, title: input.title, description: input.description || "", location: input.location || "", category: input.category || "",
    allDay: input.allDay, endDate: input.end.date, endTime: input.end.time || base.endTime,
    repeat: input.recurrence && input.recurrence.freq !== "none" ? input.recurrence.freq : "none",
    interval: input.recurrence?.interval || 1,
    ends: input.recurrence?.until ? "until" : input.recurrence?.count ? "count" : "never",
    until: input.recurrence?.until || "", count: input.recurrence?.count || 10,
    reminderMinutes: typeof input.reminderMinutes === "number" ? input.reminderMinutes : "",
  };
}

/** What a conflict check should skip so an item doesn't overlap itself. */
export function conflictIgnore(occurrence: Occurrence | null, scope: "occurrence" | "series" | null) {
  if (!occurrence) return null;
  const seriesId = occurrence.seriesId || (occurrence.recurring ? occurrence.event.id : null);
  if (!occurrence.recurring || !seriesId) return { eventId: occurrence.event.id };
  if (scope === "series") return { seriesId, scope: "series" as const };
  return { seriesId, occurrenceKey: occurrence.occurrenceKey, scope: "occurrence" as const, eventId: occurrence.exception ? occurrence.event.id : null };
}

/** Target for dragging an occurrence by whole days (Month view, all-day row). Timed items keep their wall-clock time. */
export function dayDragTarget(occurrence: Occurrence, days: number, zone: string): MoveTarget {
  if (occurrence.allDay) return { allDay: true, startDate: addDays(occurrence.startDate as string, days), endDate: addDays(occurrence.endDate as string, days) };
  const startMs = shiftLocalDays(occurrence.startMs as number, days, zone);
  return { allDay: false, startMs, endMs: startMs + ((occurrence.endMs as number) - (occurrence.startMs as number)) };
}

/** The occurrence shown at a new timing (optimistic display while a move saves). */
export function withTiming(occurrence: Occurrence, target: MoveTarget): Occurrence {
  return target.allDay
    ? { ...occurrence, allDay: true, startDate: target.startDate, endDate: target.endDate, startMs: null, endMs: null }
    : { ...occurrence, allDay: false, startMs: target.startMs, endMs: target.endMs, startDate: null, endDate: null };
}

/** "Tue, Oct 27, 3:00 – 4:00 PM" (or "All day") for an interval in the display zone. */
export function intervalLabel(startMs: number, endMs: number, zone: string): string {
  const first = localDateOf(startMs, zone); const last = localDateOf(Math.max(startMs, endMs - 1), zone);
  const day = (date: string) => formatDay(date, { weekday: "short", month: "short", day: "numeric" });
  if (first === last) return `${day(first)}, ${formatTime(startMs, zone)} – ${formatTime(endMs, zone)}`;
  return `${day(first)}, ${formatTime(startMs, zone)} – ${day(last)}, ${formatTime(endMs, zone)}`;
}

export function targetLabel(target: MoveTarget, zone: string): string {
  if (!target.allDay) return intervalLabel(target.startMs, target.endMs, zone);
  const last = addDays(target.endDate, -1);
  const day = (date: string) => formatDay(date, { weekday: "short", month: "short", day: "numeric" });
  return last === target.startDate ? `${day(target.startDate)} · All day` : `${day(target.startDate)} – ${day(last)} · All day`;
}

/** Moving the start keeps the duration (all-day: the number of days), like the editor. */
export function moveDraftStart(current: EventDraft, patch: { startDate?: string; startTime?: string }): EventDraft {
  const next = { ...current, ...patch };
  if (!next.startDate || !current.startDate) return next;
  if (current.allDay) {
    const days = current.endDate && current.endDate >= current.startDate ? daysBetween(current.startDate, current.endDate) : 0;
    return { ...next, endDate: addDays(next.startDate, days) };
  }
  const duration = draftDuration(current);
  if (!(duration > 0) || !next.startTime) return next;
  const end = addMinutesToTime(next.startDate, next.startTime, duration);
  return { ...next, endDate: end.date, endTime: end.time };
}

/** Sets a timed draft's length in minutes. */
export function setDraftDuration(current: EventDraft, minutes: number): EventDraft {
  if (!current.startDate || !current.startTime) return current;
  const end = addMinutesToTime(current.startDate, current.startTime, minutes);
  return { ...current, endDate: end.date, endTime: end.time };
}
