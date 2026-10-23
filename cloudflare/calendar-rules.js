// Persora Calendar — shared rules for the browser and the Pages API.
//
// One implementation of dates, time zones, validation, recurrence and reminder
// timing, imported by cloudflare/calendar.js (authoritative, server side) and
// by the Calendar page (src/), so both always agree.
//
// Time model
//   * Timed events are stored as UTC instants (start_at/end_at) together with
//     the IANA time zone they were created in (time_zone). Recurring series
//     repeat the *local wall-clock time* in that zone, so a 09:00 weekly event
//     stays at 09:00 across daylight-saving changes.
//   * All-day events are calendar dates (start_date, end_date exclusive). They
//     have no time zone and never shift.
//   * The browser sends wall-clock date + time + zone; the server converts to
//     instants with the same code used here. Nothing relies on the device clock
//     zone, so editing on a device set to another zone never shifts an event.
//   * Non-existent local times (spring-forward gap) move forward by the gap;
//     ambiguous times (fall-back) use the first occurrence (RFC 5545).
//
// Recurrence: daily, weekly (same weekday as the first event) or monthly (same
// day of the month; months without that day are skipped, as in RFC 5545),
// every N periods, ending never / on a date / after N occurrences. Single
// occurrences are overridden or cancelled by *exception* rows that point to
// the series (series_id + original start), like Google Calendar's
// recurringEventId/originalStartTime, which keeps future sync straightforward.

export const CALENDAR_CATEGORIES = Object.freeze(["personal", "work", "family", "health", "travel", "social", "other"]);
export const REMINDER_PRESETS = Object.freeze([5, 15, 30, 60, 1440]);
export const RECURRENCE_FREQUENCIES = Object.freeze(["daily", "weekly", "monthly"]);
/** Calendar item types. Tasks and appointments never repeat; appointments are always timed. */
export const ITEM_TYPES = Object.freeze(["event", "task", "appointment"]);
export const CALENDAR_LIMITS = Object.freeze({
  titleMax: 200,
  descriptionMax: 2000,
  locationMax: 300,
  intervalMax: 99,
  countMax: 999,
  timedMaxDays: 31,
  allDayMaxDays: 366,
  searchMax: 100,
  rangeMaxDays: 100,
});
/** All-day reminders are anchored to this local time on the event's first day. */
export const ALL_DAY_REMINDER_TIME = "09:00";
const DAY_MS = 86_400_000;
const MAX_ITERATIONS = 20_000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export class CalendarValidationError extends Error {
  /** @param {string} message @param {string} [field] */
  constructor(message, field = "") {
    super(message);
    this.name = "CalendarValidationError";
    this.field = field;
    this.status = 400;
  }
}

// ---------------------------------------------------------------------------
// Calendar dates ("YYYY-MM-DD", no time zone)
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (value, size = 2) => String(value).padStart(size, "0");

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function isDateString(value) {
  const match = typeof value === "string" ? DATE_RE.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}
export function isTimeString(value) {
  return typeof value === "string" && TIME_RE.test(value);
}
export function parseDate(value) {
  const match = DATE_RE.exec(String(value));
  if (!match) throw new CalendarValidationError("Enter a valid date.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
export function formatDate(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
function dayNumber(date) {
  const { year, month, day } = parseDate(date);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}
function fromDayNumber(value) {
  const date = new Date(value * DAY_MS);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
export function addDays(date, days) {
  return fromDayNumber(dayNumber(date) + days);
}
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}
/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date) {
  return (((dayNumber(date) + 4) % 7) + 7) % 7;
}
export function startOfWeek(date, weekStartsOn = 0) {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}
export function startOfMonth(date) {
  const { year, month } = parseDate(date);
  return formatDate(year, month, 1);
}
/** Adds months, clamping the day to the target month's length (for navigation). */
export function addMonths(date, months) {
  const { year, month, day } = parseDate(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return formatDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}
export function minDate(a, b) { return a <= b ? a : b; }
export function maxDate(a, b) { return a >= b ? a : b; }

// ---------------------------------------------------------------------------
// Time zones (Intl only — works in browsers, Node and Cloudflare Workers)
// ---------------------------------------------------------------------------

const formatters = new Map();
function partsFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(timeZone)) return false;
  try { partsFormatter(timeZone); return true; } catch { return false; }
}
export function safeTimeZone(timeZone, fallback = "UTC") {
  return isValidTimeZone(timeZone) ? timeZone : fallback;
}
/** Wall-clock parts of an instant in a zone. */
export function zonedParts(ms, timeZone) {
  const values = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(ms))) values[part.type] = part.value;
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour) % 24, minute: Number(values.minute), second: Number(values.second),
  };
}
/** The zone's UTC offset at an instant, in ms (e.g. +6h for Asia/Dhaka). */
export function timeZoneOffset(ms, timeZone) {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = zonedParts(whole, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}
export function localDateOf(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return formatDate(p.year, p.month, p.day);
}
export function localTimeOf(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
/**
 * The instant at which the wall clock in `timeZone` shows `date` `time`.
 * Gap (non-existent) times use the offset before the transition, which moves
 * them forward by the gap; ambiguous times resolve to the earlier instant.
 */
export function zonedTimeToInstant(date, time, timeZone) {
  const { year, month, day } = parseDate(date);
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  const before = timeZoneOffset(wall - DAY_MS, timeZone);
  const after = timeZoneOffset(wall + DAY_MS, timeZone);
  const candidates = [...new Set([before, after])].map((offset) => wall - offset)
    .filter((instant) => instant + timeZoneOffset(instant, timeZone) === wall);
  if (candidates.length) return Math.min(...candidates);
  return wall - before;
}
/** Start-of-day instant of a calendar date in a zone. */
export function startOfDayInstant(date, timeZone) {
  return zonedTimeToInstant(date, "00:00", timeZone);
}
/** Normalizes any ISO/PostgREST timestamp to a canonical `…Z` ISO string. */
export function isoInstant(value) {
  const ms = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) throw new CalendarValidationError("Enter a valid date and time.");
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Validation (authoritative on the server; the browser runs it for instant feedback)
// ---------------------------------------------------------------------------

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * Validates recurrence input. `startDate` is the first occurrence's local date.
 * @returns {{freq: string, interval: number, until: string|null, count: number|null} | null}
 */
export function normalizeRecurrence(input, startDate) {
  const value = plainObject(input);
  if (!value || !value.freq || value.freq === "none") return null;
  if (!RECURRENCE_FREQUENCIES.includes(value.freq)) throw new CalendarValidationError("Choose daily, weekly or monthly repetition.", "recurrence");
  const interval = value.interval === undefined || value.interval === null || value.interval === "" ? 1 : Number(value.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > CALENDAR_LIMITS.intervalMax) throw new CalendarValidationError(`Repeat every 1–${CALENDAR_LIMITS.intervalMax} periods.`, "recurrence");
  const until = value.until ? String(value.until) : null;
  const count = value.count === undefined || value.count === null || value.count === "" ? null : Number(value.count);
  if (until && count !== null) throw new CalendarValidationError("Choose either an end date or a number of times, not both.", "recurrence");
  if (until) {
    if (!isDateString(until)) throw new CalendarValidationError("Enter a valid date for when the repetition ends.", "recurrence");
    if (until < startDate) throw new CalendarValidationError("The repetition can't end before the first event.", "recurrence");
  }
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > CALENDAR_LIMITS.countMax)) {
    throw new CalendarValidationError(`Repeat between 1 and ${CALENDAR_LIMITS.countMax} times.`, "recurrence");
  }
  return { freq: value.freq, interval, until, count };
}

/**
 * Validates and normalizes event input.
 *
 * Input: { title, description?, location?, category?, allDay, timeZone?,
 *          start: { date, time? }, end: { date, time? }, recurrence?,
 *          reminderMinutes?, reminderEmail? }
 * For all-day events `end.date` is the *last* day (inclusive); the stored
 * `endDate` is exclusive. For timed events the dates/times are wall-clock
 * values in `timeZone`.
 */
export function normalizeEventInput(input, { defaultTimeZone = "UTC", allowRecurrence = true, itemType: forcedType = null } = {}) {
  const value = plainObject(input);
  if (!value) throw new CalendarValidationError("Send the event details.");
  const requestedType = value.itemType === undefined || value.itemType === null || value.itemType === "" ? "event" : String(value.itemType);
  if (!ITEM_TYPES.includes(requestedType)) throw new CalendarValidationError("Choose event, task or appointment.", "itemType");
  // An item's type is fixed when it's created; updates pass the stored type.
  const itemType = forcedType || requestedType;
  const title = cleanText(value.title, CALENDAR_LIMITS.titleMax + 1);
  if (!title) throw new CalendarValidationError("Add a title.", "title");
  if (title.length > CALENDAR_LIMITS.titleMax) throw new CalendarValidationError(`Keep the title under ${CALENDAR_LIMITS.titleMax} characters.`, "title");
  const description = cleanText(value.description, CALENDAR_LIMITS.descriptionMax + 1);
  if (description.length > CALENDAR_LIMITS.descriptionMax) throw new CalendarValidationError(`Keep the description under ${CALENDAR_LIMITS.descriptionMax} characters.`, "description");
  const location = cleanText(value.location, CALENDAR_LIMITS.locationMax + 1);
  if (location.length > CALENDAR_LIMITS.locationMax) throw new CalendarValidationError(`Keep the location under ${CALENDAR_LIMITS.locationMax} characters.`, "location");
  const category = value.category === null || value.category === undefined || value.category === "" ? null : String(value.category);
  if (category !== null && !CALENDAR_CATEGORIES.includes(category)) throw new CalendarValidationError("Choose one of the listed categories.", "category");

  const timeZone = value.timeZone === undefined || value.timeZone === null || value.timeZone === "" ? defaultTimeZone : String(value.timeZone);
  if (!isValidTimeZone(timeZone)) throw new CalendarValidationError("Choose a valid time zone.", "timeZone");

  const allDay = value.allDay === true;
  if (itemType === "appointment" && allDay) throw new CalendarValidationError("Appointments need a start time.", "start");
  const start = plainObject(value.start) || {};
  const end = plainObject(value.end) || {};
  if (!isDateString(start.date)) throw new CalendarValidationError("Enter a valid start date.", "start");
  if (!isDateString(end.date)) throw new CalendarValidationError("Enter a valid end date.", "end");

  let startAt = null; let endAt = null; let startDate = null; let endDate = null; let anchorDate;
  if (allDay) {
    if (end.date < start.date) throw new CalendarValidationError("The end date can't be before the start date.", "end");
    if (daysBetween(start.date, end.date) + 1 > CALENDAR_LIMITS.allDayMaxDays) throw new CalendarValidationError(`All-day events can span up to ${CALENDAR_LIMITS.allDayMaxDays} days.`, "end");
    startDate = start.date;
    endDate = addDays(end.date, 1);
    anchorDate = startDate;
  } else {
    if (!isTimeString(start.time)) throw new CalendarValidationError("Enter a valid start time.", "start");
    if (!isTimeString(end.time)) throw new CalendarValidationError("Enter a valid end time.", "end");
    const startMs = zonedTimeToInstant(start.date, start.time, timeZone);
    const endMs = zonedTimeToInstant(end.date, end.time, timeZone);
    if (endMs <= startMs) throw new CalendarValidationError(endMs < startMs ? "The end time can't be before the start time." : "The event must end after it starts.", "end");
    if (endMs - startMs > CALENDAR_LIMITS.timedMaxDays * DAY_MS) throw new CalendarValidationError(`Timed events can last up to ${CALENDAR_LIMITS.timedMaxDays} days. Use an all-day event for longer spans.`, "end");
    startAt = new Date(startMs).toISOString();
    endAt = new Date(endMs).toISOString();
    anchorDate = localDateOf(startMs, timeZone);
  }

  const recurrence = allowRecurrence ? normalizeRecurrence(value.recurrence, anchorDate) : null;
  if (recurrence && itemType !== "event") throw new CalendarValidationError(itemType === "task" ? "Tasks can't repeat. Create an event to repeat it." : "Appointments can't repeat. Create an event to repeat it.", "recurrence");
  const reminderMinutes = value.reminderMinutes === undefined || value.reminderMinutes === null || value.reminderMinutes === "" ? null : Number(value.reminderMinutes);
  if (reminderMinutes !== null && !REMINDER_PRESETS.includes(reminderMinutes)) throw new CalendarValidationError("Choose one of the reminder options.", "reminder");
  const reminderEmail = reminderMinutes !== null && value.reminderEmail === true;
  return { itemType, title, description, location, category, allDay, timeZone, startAt, endAt, startDate, endDate, recurrence, reminderMinutes, reminderEmail };
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

/**
 * Anchor of an event: first local date, local start time and duration.
 * @param {CalendarEventLike} event
 */
export function eventAnchor(event) {
  if (event.allDay) {
    return { date: event.startDate, time: null, durationDays: Math.max(1, daysBetween(event.startDate, event.endDate)), durationMs: 0 };
  }
  const zone = safeTimeZone(event.timeZone);
  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  return { date: localDateOf(startMs, zone), time: localTimeOf(startMs, zone), durationDays: 0, durationMs: Math.max(0, endMs - startMs) };
}

/**
 * Yields occurrence start dates (local, in the event's zone) on or after
 * `fromDate`, in order, honouring interval, until and count.
 */
export function* recurrenceDates(anchorDate, recurrence, fromDate = anchorDate) {
  if (!recurrence) {
    if (anchorDate >= fromDate) yield anchorDate;
    return;
  }
  const { freq, interval, until, count } = recurrence;
  const stop = until || formatDate(MAX_YEAR, 12, 31);
  if (freq === "daily" || freq === "weekly") {
    const step = interval * (freq === "weekly" ? 7 : 1);
    let index = Math.max(0, Math.ceil(daysBetween(anchorDate, fromDate) / step));
    for (let guard = 0; guard < MAX_ITERATIONS; guard += 1, index += 1) {
      if (count !== null && count !== undefined && index >= count) return;
      const date = addDays(anchorDate, index * step);
      if (date > stop) return;
      yield date;
    }
    return;
  }
  // Monthly on the anchor's day of month; months without that day are skipped.
  const { year, month, day } = parseDate(anchorDate);
  const base = year * 12 + (month - 1);
  const from = parseDate(fromDate < anchorDate ? anchorDate : fromDate);
  // With a count we must count from the first occurrence; otherwise jump close to `fromDate`.
  let step = count ? 0 : Math.max(0, Math.floor((from.year * 12 + (from.month - 1) - base) / interval) - 1);
  let produced = 0;
  for (let guard = 0; guard < MAX_ITERATIONS; guard += 1, step += 1) {
    const index = base + step * interval;
    const targetYear = Math.floor(index / 12);
    const targetMonth = (index % 12) + 1;
    if (targetYear > MAX_YEAR) return;
    if (day > daysInMonth(targetYear, targetMonth)) continue;
    const date = formatDate(targetYear, targetMonth, day);
    if (date > stop) return;
    produced += 1;
    if (count && produced > count) return;
    if (date >= fromDate) yield date;
  }
}

/** Stable identity of an occurrence: the original start (ISO instant, or date for all-day). */
export function occurrenceKeyFor(event, localDate) {
  if (event.allDay) return localDate;
  const anchor = eventAnchor(event);
  return new Date(zonedTimeToInstant(localDate, anchor.time, safeTimeZone(event.timeZone))).toISOString();
}

/** Builds the occurrence (start/end) of `event` on local date `localDate`. */
export function occurrenceOn(event, localDate) {
  const anchor = eventAnchor(event);
  if (event.allDay) {
    return { key: localDate, allDay: true, startDate: localDate, endDate: addDays(localDate, anchor.durationDays), startMs: null, endMs: null };
  }
  const startMs = zonedTimeToInstant(localDate, anchor.time, safeTimeZone(event.timeZone));
  return { key: new Date(startMs).toISOString(), allDay: false, startDate: null, endDate: null, startMs, endMs: startMs + anchor.durationMs };
}

/** True when `key` (ISO instant or date) is a real occurrence of the series. */
export function isOccurrenceOf(event, key) {
  if (!event.recurrence) return false;
  const anchor = eventAnchor(event);
  let localDate;
  if (event.allDay) {
    if (!isDateString(key)) return false;
    localDate = key;
  } else {
    const ms = Date.parse(String(key));
    if (!Number.isFinite(ms)) return false;
    localDate = localDateOf(ms, safeTimeZone(event.timeZone));
  }
  if (localDate < anchor.date) return false;
  const first = recurrenceDates(anchor.date, event.recurrence, localDate).next();
  if (first.done || first.value !== localDate) return false;
  return occurrenceKeyFor(event, localDate) === (event.allDay ? key : new Date(Date.parse(String(key))).toISOString());
}

/** Exception rows' original-start key, normalized like `occurrenceKeyFor`. */
export function exceptionKey(exception) {
  if (exception.originalStartDate) return exception.originalStartDate;
  return exception.originalStartAt ? new Date(Date.parse(exception.originalStartAt)).toISOString() : "";
}

/**
 * Expands events into occurrences that overlap [fromDate, toDate) (local dates
 * in `displayZone`). Series occurrences overridden by exceptions are replaced
 * by the exception (or dropped when cancelled).
 * @returns {CalendarOccurrence[]} sorted by start
 */
export function expandOccurrences(events, fromDate, toDate, displayZone, { limit = 5000 } = {}) {
  const zone = safeTimeZone(displayZone);
  const rangeStart = startOfDayInstant(fromDate, zone);
  const rangeEnd = startOfDayInstant(toDate, zone);
  const overridden = new Map();
  for (const event of events) {
    if (!event.seriesId) continue;
    const set = overridden.get(event.seriesId) || new Set();
    set.add(exceptionKey(event));
    overridden.set(event.seriesId, set);
  }
  const output = [];
  const overlaps = (occurrence) => occurrence.allDay
    ? occurrence.startDate < toDate && occurrence.endDate > fromDate
    : occurrence.startMs < rangeEnd && occurrence.endMs > rangeStart;
  const push = (event, occurrence, extra) => {
    if (output.length < limit && overlaps(occurrence)) output.push({ ...occurrence, id: `${event.id}:${occurrence.key}`, event, ...extra });
  };
  for (const event of events) {
    if (event.status === "cancelled") continue;
    if (event.seriesId) {
      push(event, singleOccurrence(event), { seriesId: event.seriesId, occurrenceKey: exceptionKey(event), recurring: true, exception: true });
      continue;
    }
    if (!event.recurrence) {
      push(event, singleOccurrence(event), { seriesId: null, occurrenceKey: null, recurring: false, exception: false });
      continue;
    }
    const anchor = eventAnchor(event);
    const skip = overridden.get(event.id) || new Set();
    // Look back far enough for occurrences that start earlier but still overlap.
    const lookBack = event.allDay ? anchor.durationDays : Math.ceil(anchor.durationMs / DAY_MS) + 2;
    const from = addDays(fromDate, -lookBack - 1);
    const to = addDays(toDate, 2);
    for (const date of recurrenceDates(anchor.date, event.recurrence, maxDate(from, anchor.date))) {
      if (date > to || output.length >= limit) break;
      const occurrence = occurrenceOn(event, date);
      if (skip.has(occurrence.key)) continue;
      push(event, occurrence, { seriesId: event.id, occurrenceKey: occurrence.key, recurring: true, exception: false });
    }
  }
  return output.sort(compareOccurrences);
}

function singleOccurrence(event) {
  if (event.allDay) return { key: event.startDate, allDay: true, startDate: event.startDate, endDate: event.endDate, startMs: null, endMs: null };
  const startMs = Date.parse(event.startAt);
  return { key: new Date(startMs).toISOString(), allDay: false, startDate: null, endDate: null, startMs, endMs: Date.parse(event.endAt) };
}

/** All-day first, then by start, then longer first, then title. */
export function compareOccurrences(a, b) {
  if (a.allDay !== b.allDay) {
    return a.allDay ? -1 : 1;
  }
  if (a.allDay) return a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate) || a.event.title.localeCompare(b.event.title);
  return a.startMs - b.startMs || (b.endMs - b.startMs) - (a.endMs - a.startMs) || a.event.title.localeCompare(b.event.title);
}

/** First occurrence that ends after `afterMs` (for search results and "next"). */
export function nextOccurrence(event, afterMs, overriddenKeys = new Set()) {
  if (!event.recurrence) {
    const single = singleOccurrence(event);
    return single;
  }
  const zone = safeTimeZone(event.timeZone);
  const anchor = eventAnchor(event);
  const fromDate = maxDate(addDays(localDateOf(afterMs, zone), -(anchor.durationDays || 2)), anchor.date);
  let last = null;
  for (const date of recurrenceDates(anchor.date, event.recurrence, fromDate)) {
    const occurrence = occurrenceOn(event, date);
    if (overriddenKeys.has(occurrence.key)) continue;
    last = occurrence;
    const endMs = occurrence.allDay ? startOfDayInstant(occurrence.endDate, zone) : occurrence.endMs;
    if (endMs > afterMs) return occurrence;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/** When a reminder for an occurrence fires. All-day uses 09:00 local on the first day. */
export function reminderInstant(event, occurrence, minutes) {
  const base = occurrence.allDay
    ? zonedTimeToInstant(occurrence.startDate, ALL_DAY_REMINDER_TIME, safeTimeZone(event.timeZone))
    : occurrence.startMs;
  return base - minutes * 60_000;
}

/**
 * The next reminder strictly after `afterMs` for an event (single, exception
 * or series master), skipping series occurrences in `overriddenKeys` (they
 * carry their own reminders as exception rows).
 * @returns {null | {remindAt: string, occurrenceKey: string, occurrenceStart: string|null, occurrenceDate: string|null, allDay: boolean}}
 */
export function nextReminder(event, afterMs, overriddenKeys = new Set()) {
  if (event.reminderMinutes === null || event.reminderMinutes === undefined || event.status === "cancelled") return null;
  const minutes = Number(event.reminderMinutes);
  const describe = (occurrence, key) => ({
    remindAt: new Date(reminderInstant(event, occurrence, minutes)).toISOString(),
    occurrenceKey: key,
    occurrenceStart: occurrence.allDay ? null : new Date(occurrence.startMs).toISOString(),
    occurrenceDate: occurrence.allDay ? occurrence.startDate : null,
    allDay: occurrence.allDay,
  });
  if (event.seriesId || !event.recurrence) {
    const occurrence = singleOccurrence(event);
    if (reminderInstant(event, occurrence, minutes) <= afterMs) return null;
    return describe(occurrence, event.seriesId ? exceptionKey(event) : occurrence.key);
  }
  const zone = safeTimeZone(event.timeZone);
  const anchor = eventAnchor(event);
  // A reminder fires at most a day (plus the all-day anchor) before its occurrence.
  const fromDate = maxDate(addDays(localDateOf(afterMs, zone), -2), anchor.date);
  let guard = 0;
  for (const date of recurrenceDates(anchor.date, event.recurrence, fromDate)) {
    if ((guard += 1) > MAX_ITERATIONS) break;
    const occurrence = occurrenceOn(event, date);
    if (overriddenKeys.has(occurrence.key)) continue;
    if (reminderInstant(event, occurrence, minutes) > afterMs) return describe(occurrence, occurrence.key);
  }
  return null;
}

/** De-duplication key: one delivery per series/event, occurrence and fire time. */
export function reminderDedupeKey(rootId, occurrenceKey, remindAt) {
  return `${rootId}:${occurrenceKey}:${new Date(Date.parse(remindAt)).toISOString()}`;
}

// ---------------------------------------------------------------------------
// Display filters (saved per member; they never change or exclude stored data)
// ---------------------------------------------------------------------------

/** Category keys used by filters: the listed categories plus "default" (no category). */
export const FILTER_CATEGORIES = Object.freeze(["default", ...CALENDAR_CATEGORIES]);

export function defaultCalendarFilters() {
  return {
    types: Object.fromEntries(ITEM_TYPES.map((type) => [type, true])),
    categories: Object.fromEntries(FILTER_CATEGORIES.map((category) => [category, true])),
    completed: true,
  };
}

/** Keeps known keys with boolean values; anything missing shows (true). */
export function normalizeCalendarFilters(input) {
  const value = plainObject(input) || {};
  const types = plainObject(value.types) || {};
  const categories = plainObject(value.categories) || {};
  return {
    types: Object.fromEntries(ITEM_TYPES.map((type) => [type, types[type] !== false])),
    categories: Object.fromEntries(FILTER_CATEGORIES.map((category) => [category, categories[category] !== false])),
    completed: value.completed !== false,
  };
}

/** Number of hidden facets (0 means nothing is filtered). */
export function hiddenFilterCount(filters) {
  const value = normalizeCalendarFilters(filters);
  return Object.values(value.types).filter((shown) => !shown).length
    + Object.values(value.categories).filter((shown) => !shown).length
    + (value.completed ? 0 : 1);
}

/** Is this event (or occurrence's event) shown with these filters? */
export function matchesCalendarFilters(event, filters) {
  const value = filters && filters.types && filters.categories ? filters : normalizeCalendarFilters(filters);
  const type = ITEM_TYPES.includes(event?.itemType) ? event.itemType : "event";
  if (value.types[type] === false) return false;
  const category = event?.category && CALENDAR_CATEGORIES.includes(event.category) ? event.category : "default";
  if (value.categories[category] === false) return false;
  if (type === "task" && event.completedAt && value.completed === false) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Conflicts (timed overlaps) and free-slot suggestions
// ---------------------------------------------------------------------------

/**
 * Can this occurrence block time? All-day items, cancelled occurrences and
 * completed tasks never conflict.
 */
export function blocksTime(occurrence) {
  if (!occurrence || occurrence.allDay) return false;
  const event = occurrence.event || {};
  if (event.status === "cancelled") return false;
  if (event.itemType === "task" && event.completedAt) return false;
  return Number.isFinite(occurrence.startMs) && Number.isFinite(occurrence.endMs) && occurrence.endMs > occurrence.startMs;
}

/** Half-open overlap: touching edges (10:00–11:00 and 11:00–12:00) don't conflict. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Every busy occurrence that overlaps any candidate interval. Returns one entry
 * per busy occurrence (the first candidate it overlaps), sorted by start.
 * @param {{startMs:number,endMs:number}[]} candidates
 * @param {CalendarOccurrence[]} busy already filtered (see blocksTime) and without the item being changed
 */
export function findConflicts(candidates, busy, { limit = 20 } = {}) {
  const found = [];
  const seen = new Set();
  const sorted = [...busy].sort((a, b) => a.startMs - b.startMs);
  for (const occurrence of sorted) {
    if (seen.has(occurrence.id) || !blocksTime(occurrence)) continue;
    const index = candidates.findIndex((candidate) => overlaps(candidate.startMs, candidate.endMs, occurrence.startMs, occurrence.endMs));
    if (index < 0) continue;
    seen.add(occurrence.id);
    found.push({ occurrence, candidateIndex: index, candidate: candidates[index] });
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Nearby free slots with the same duration, on the requested local day first
 * and then the next days, within working hours and never in the past. Sorted by
 * distance from the requested start.
 */
export function suggestFreeSlots({ startMs, endMs, busy, zone, nowMs = Date.now(), dayStart = "07:00", dayEnd = "22:00", stepMinutes = 15, limit = 3, maxDays = 2 }) {
  const duration = endMs - startMs;
  if (!(duration > 0) || duration > DAY_MS) return [];
  const tz = safeTimeZone(zone);
  const blocks = busy.filter(blocksTime).map((occurrence) => [occurrence.startMs, occurrence.endMs]);
  const isFree = (from, to) => !blocks.some(([a, b]) => overlaps(from, to, a, b));
  const firstDay = localDateOf(startMs, tz);
  const results = [];
  for (let offset = 0; offset < maxDays && results.length < limit; offset += 1) {
    const date = addDays(firstDay, offset);
    const open = zonedTimeToInstant(date, dayStart, tz);
    const close = zonedTimeToInstant(date, dayEnd, tz);
    const options = [];
    for (let from = open; from + duration <= close; from += stepMinutes * 60_000) {
      const to = from + duration;
      if (from === startMs || from < nowMs) continue;
      if (isFree(from, to)) options.push({ startMs: from, endMs: to });
    }
    options.sort((a, b) => Math.abs(a.startMs - startMs) - Math.abs(b.startMs - startMs) || a.startMs - b.startMs);
    // Prefer distinct choices rather than three adjacent quarter-hours.
    for (const option of options) {
      if (results.length >= limit) break;
      if (results.some((chosen) => Math.abs(chosen.startMs - option.startMs) < Math.min(duration, 60 * 60_000))) continue;
      results.push(option);
    }
  }
  return results.sort((a, b) => a.startMs - b.startMs);
}

// ---------------------------------------------------------------------------
// Interoperability (for future Google / Microsoft sync)
// ---------------------------------------------------------------------------

/** RFC 5545 RRULE for a recurrence, e.g. "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=10". */
export function toRRule(event) {
  const rule = event.recurrence;
  if (!rule) return null;
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) {
    if (event.allDay) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}`);
    else {
      const anchor = eventAnchor(event);
      const last = zonedTimeToInstant(rule.until, anchor.time, safeTimeZone(event.timeZone));
      parts.push(`UNTIL=${new Date(last).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    }
  }
  return `RRULE:${parts.join(";")}`;
}

/** Human summary of a recurrence, e.g. "Every 2 weeks on Tuesday, 10 times". */
export function describeRecurrence(event, locale = "en") {
  const rule = event.recurrence;
  if (!rule) return "";
  const anchor = eventAnchor(event);
  const unit = { daily: ["day", "days"], weekly: ["week", "weeks"], monthly: ["month", "months"] }[rule.freq];
  let text = rule.interval === 1 ? { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[rule.freq] : `Every ${rule.interval} ${unit[1]}`;
  if (rule.freq === "weekly") {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(dayNumber(anchor.date) * DAY_MS));
    text += ` on ${weekday}`;
  }
  if (rule.freq === "monthly") text += ` on day ${parseDate(anchor.date).day}`;
  if (rule.count) text += rule.count === 1 ? ", once" : `, ${rule.count} times`;
  if (rule.until) {
    const until = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(dayNumber(rule.until) * DAY_MS));
    text += `, until ${until}`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Moving and resizing (drag and drop, Reschedule)
// ---------------------------------------------------------------------------

const wallClock = (ms, zone) => ({ date: localDateOf(ms, zone), time: localTimeOf(ms, zone) });
const minutesOfTime = (time) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
function addWallMinutes(date, time, minutes) {
  const total = minutesOfTime(time) + minutes;
  const within = ((total % 1440) + 1440) % 1440;
  return { date: addDays(date, Math.floor(total / 1440)), time: `${pad(Math.floor(within / 60))}:${pad(within % 60)}` };
}

/** The same wall-clock time `days` later in `zone` (DST-safe: 9 AM stays 9 AM). */
export function shiftLocalDays(ms, days, zone) {
  const safe = safeTimeZone(zone);
  return zonedTimeToInstant(addDays(localDateOf(ms, safe), days), localTimeOf(ms, safe), safe);
}

/**
 * Timing for an item after one of its occurrences is moved or resized, as
 * EventInput start/end in the event's own time zone (all-day ends inclusive).
 *
 * - "replace": the item (or the single occurrence) takes the target timing.
 * - "shift": a whole series moves by the same wall-clock change as the
 *   dragged occurrence and takes its new duration, so a weekly 9 AM series
 *   dragged to Thursday 10 AM becomes Thursdays at 10 AM — across DST too.
 *
 * @param {CalendarEventLike} event   the item, or the series master for "shift"
 * @param {{ allDay: boolean, startMs?: number|null, endMs?: number|null, startDate?: string|null, endDate?: string|null }} occurrence
 * @param {{ allDay: boolean, startMs?: number, endMs?: number, startDate?: string, endDate?: string }} target  endDate exclusive
 * @param {"replace"|"shift"} [mode]
 */
export function movedTiming(event, occurrence, target, mode = "replace") {
  const zone = safeTimeZone(event.timeZone);
  if (Boolean(target.allDay) !== Boolean(occurrence.allDay)) throw new CalendarValidationError("All-day items stay all-day and timed items stay timed when moved.");
  if (target.allDay) {
    if (!isDateString(target.startDate) || !isDateString(target.endDate)) throw new CalendarValidationError("Enter a valid date.", "start");
    const span = Math.max(1, daysBetween(target.startDate, target.endDate));
    const start = mode === "shift" ? addDays(eventAnchor(event).date, daysBetween(occurrence.startDate, target.startDate)) : target.startDate;
    return { allDay: true, start: { date: start }, end: { date: addDays(start, span - 1) } };
  }
  if (!Number.isFinite(target.startMs) || !Number.isFinite(target.endMs)) throw new CalendarValidationError("Enter a valid time.", "start");
  if (!(target.endMs > target.startMs)) throw new CalendarValidationError("The end must be after the start.", "end");
  if (mode !== "shift") return { allDay: false, start: wallClock(target.startMs, zone), end: wallClock(target.endMs, zone) };
  const anchor = eventAnchor(event);
  const before = wallClock(occurrence.startMs, zone);
  const after = wallClock(target.startMs, zone);
  const delta = daysBetween(before.date, after.date) * 1440 + minutesOfTime(after.time) - minutesOfTime(before.time);
  const start = addWallMinutes(anchor.date, anchor.time, delta);
  const startMs = zonedTimeToInstant(start.date, start.time, zone);
  return { allDay: false, start, end: wallClock(startMs + (target.endMs - target.startMs), zone) };
}
