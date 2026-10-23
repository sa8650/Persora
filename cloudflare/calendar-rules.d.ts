// Types for cloudflare/calendar-rules.js (shared by the Calendar page and the Pages API).

export type CalendarCategory = "personal" | "work" | "family" | "health" | "travel" | "social" | "other";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";
export type ReminderMinutes = 5 | 15 | 30 | 60 | 1440;
export type CalendarItemType = "event" | "task" | "appointment";

export interface Recurrence {
  freq: RecurrenceFrequency;
  interval: number;
  /** Last possible occurrence date (local, inclusive). */
  until: string | null;
  count: number | null;
}

/** The fields the rules need; the API's CalendarEvent satisfies it. */
export interface CalendarEventLike {
  id: string;
  seriesId?: string | null;
  originalStartAt?: string | null;
  originalStartDate?: string | null;
  status?: "confirmed" | "cancelled";
  title: string;
  allDay: boolean;
  timeZone: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  /** Exclusive. */
  endDate: string | null;
  recurrence: Recurrence | null;
  reminderMinutes?: number | null;
  itemType?: CalendarItemType;
  completedAt?: string | null;
}

export interface OccurrenceTiming {
  key: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  startMs: number | null;
  endMs: number | null;
}

export interface CalendarOccurrence<E extends CalendarEventLike = CalendarEventLike> extends OccurrenceTiming {
  id: string;
  event: E;
  seriesId: string | null;
  occurrenceKey: string | null;
  recurring: boolean;
  exception: boolean;
}

export interface EventInput {
  /** Defaults to "event". Ignored on updates (an item's type is fixed). */
  itemType?: CalendarItemType;
  title: string;
  description?: string;
  location?: string;
  category?: CalendarCategory | null;
  allDay: boolean;
  timeZone?: string;
  start: { date: string; time?: string };
  /** For all-day events: the last day (inclusive). */
  end: { date: string; time?: string };
  recurrence?: { freq: RecurrenceFrequency | "none"; interval?: number; until?: string | null; count?: number | null } | null;
  reminderMinutes?: number | null;
  reminderEmail?: boolean;
}

export interface NormalizedEvent {
  itemType: CalendarItemType;
  title: string;
  description: string;
  location: string;
  category: CalendarCategory | null;
  allDay: boolean;
  timeZone: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  recurrence: Recurrence | null;
  reminderMinutes: number | null;
  reminderEmail: boolean;
}

export interface NextReminder {
  remindAt: string;
  occurrenceKey: string;
  occurrenceStart: string | null;
  occurrenceDate: string | null;
  allDay: boolean;
}

export const CALENDAR_CATEGORIES: readonly CalendarCategory[];
export const REMINDER_PRESETS: readonly ReminderMinutes[];
export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[];
export const ITEM_TYPES: readonly CalendarItemType[];
export const CALENDAR_LIMITS: Readonly<{
  titleMax: number; descriptionMax: number; locationMax: number; intervalMax: number; countMax: number;
  timedMaxDays: number; allDayMaxDays: number; searchMax: number; rangeMaxDays: number;
}>;
export const ALL_DAY_REMINDER_TIME: string;

export class CalendarValidationError extends Error {
  field: string;
  status: number;
  constructor(message: string, field?: string);
}

export function daysInMonth(year: number, month: number): number;
export function isDateString(value: unknown): value is string;
export function isTimeString(value: unknown): value is string;
export function parseDate(value: string): { year: number; month: number; day: number };
export function formatDate(year: number, month: number, day: number): string;
export function addDays(date: string, days: number): string;
export function daysBetween(from: string, to: string): number;
export function weekdayOf(date: string): number;
export function startOfWeek(date: string, weekStartsOn?: number): string;
export function startOfMonth(date: string): string;
export function addMonths(date: string, months: number): string;
export function minDate(a: string, b: string): string;
export function maxDate(a: string, b: string): string;

export function isValidTimeZone(timeZone: unknown): timeZone is string;
export function safeTimeZone(timeZone: unknown, fallback?: string): string;
export function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number };
export function timeZoneOffset(ms: number, timeZone: string): number;
export function localDateOf(ms: number, timeZone: string): string;
export function localTimeOf(ms: number, timeZone: string): string;
export function zonedTimeToInstant(date: string, time: string, timeZone: string): number;
export function startOfDayInstant(date: string, timeZone: string): number;
export function isoInstant(value: string | number): string;

export function normalizeRecurrence(input: unknown, startDate: string): Recurrence | null;
export function normalizeEventInput(input: unknown, options?: { defaultTimeZone?: string; allowRecurrence?: boolean; itemType?: CalendarItemType | null }): NormalizedEvent;

export function eventAnchor(event: CalendarEventLike): { date: string; time: string | null; durationDays: number; durationMs: number };
export function recurrenceDates(anchorDate: string, recurrence: Recurrence | null, fromDate?: string): Generator<string, void, unknown>;
export function occurrenceKeyFor(event: CalendarEventLike, localDate: string): string;
export function occurrenceOn(event: CalendarEventLike, localDate: string): OccurrenceTiming;
export function isOccurrenceOf(event: CalendarEventLike, key: string): boolean;
export function exceptionKey(exception: Pick<CalendarEventLike, "originalStartAt" | "originalStartDate">): string;
export function expandOccurrences<E extends CalendarEventLike>(events: E[], fromDate: string, toDate: string, displayZone: string, options?: { limit?: number }): CalendarOccurrence<E>[];
export function compareOccurrences(a: CalendarOccurrence, b: CalendarOccurrence): number;
export function nextOccurrence(event: CalendarEventLike, afterMs: number, overriddenKeys?: Set<string>): OccurrenceTiming | null;

export function reminderInstant(event: CalendarEventLike, occurrence: OccurrenceTiming, minutes: number): number;
export function nextReminder(event: CalendarEventLike, afterMs: number, overriddenKeys?: Set<string>): NextReminder | null;
export function reminderDedupeKey(rootId: string, occurrenceKey: string, remindAt: string): string;

export function toRRule(event: CalendarEventLike): string | null;
export function describeRecurrence(event: CalendarEventLike, locale?: string): string;

export interface TimeInterval { startMs: number; endMs: number }
export function blocksTime(occurrence: CalendarOccurrence | null | undefined): boolean;
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean;
export function findConflicts<O extends CalendarOccurrence>(candidates: TimeInterval[], busy: O[], options?: { limit?: number }): { occurrence: O; candidateIndex: number; candidate: TimeInterval }[];
export function suggestFreeSlots(options: {
  startMs: number; endMs: number; busy: CalendarOccurrence[]; zone: string; nowMs?: number;
  dayStart?: string; dayEnd?: string; stepMinutes?: number; limit?: number; maxDays?: number;
}): TimeInterval[];

export type FilterCategory = "default" | CalendarCategory;
export interface CalendarFilters {
  types: Record<CalendarItemType, boolean>;
  categories: Record<FilterCategory, boolean>;
  /** Show completed tasks. */
  completed: boolean;
}
export const FILTER_CATEGORIES: readonly FilterCategory[];
export function defaultCalendarFilters(): CalendarFilters;
export function normalizeCalendarFilters(input: unknown): CalendarFilters;
export function hiddenFilterCount(filters: unknown): number;
export function matchesCalendarFilters(event: Pick<CalendarEventLike, "itemType" | "completedAt"> & { category?: CalendarCategory | null }, filters: CalendarFilters | unknown): boolean;

export type MoveTarget =
  | { allDay: false; startMs: number; endMs: number }
  | { allDay: true; startDate: string; /** Exclusive. */ endDate: string };
export interface MovedTiming {
  allDay: boolean;
  start: { date: string; time?: string };
  /** All-day: the last day (inclusive). */
  end: { date: string; time?: string };
}
export function shiftLocalDays(ms: number, days: number, zone: string): number;
export function movedTiming(
  event: CalendarEventLike,
  occurrence: { allDay: boolean; startMs?: number | null; endMs?: number | null; startDate?: string | null; endDate?: string | null },
  target: MoveTarget,
  mode?: "replace" | "shift",
): MovedTiming;
