// Persora Calendar — browser client for /api/calendar/*.
import type { CalendarCategory, CalendarEventLike, CalendarFilters, CalendarItemType, EventInput, Recurrence } from "../../cloudflare/calendar-rules.js";
import { pagesApiJson } from "./cloud";

export interface CalendarEvent extends CalendarEventLike {
  itemType: CalendarItemType;
  /** Tasks only: when it was marked complete. */
  completedAt: string | null;
  seriesId: string | null;
  originalStartAt: string | null;
  originalStartDate: string | null;
  status: "confirmed" | "cancelled";
  description: string;
  location: string;
  category: CalendarCategory | null;
  recurrence: Recurrence | null;
  reminderMinutes: number | null;
  reminderEmail: boolean;
  source: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarMeta {
  timeZone: string;
  email: { available: boolean; reason: string | null };
  reminderPresets: number[];
}

export interface CalendarReminder {
  id: string;
  eventId: string;
  seriesId: string | null;
  occurrenceKey: string;
  occurrenceStart: string | null;
  occurrenceDate: string | null;
  allDay: boolean;
  remindAt: string;
  minutesBefore: number;
  title: string;
  location: string;
  status: "scheduled" | "processing" | "sent";
  due: boolean;
  emailRequested: boolean;
  emailStatus: string;
  emailNote: string | null;
  readAt: string | null;
}

export type EditScope = "occurrence" | "series";

/** Dispatched on window after any calendar change, so reminders refresh immediately. */
export const CALENDAR_CHANGED_EVENT = "persora-calendar-changed";

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export function loadCalendarMeta(): Promise<CalendarMeta> {
  return pagesApiJson<CalendarMeta>("/calendar/meta");
}

/** Events (series masters, exceptions and single events) that may appear between two local dates (to exclusive). */
export async function loadCalendarEvents(from: string, to: string, signal?: AbortSignal): Promise<CalendarEvent[]> {
  const body = await pagesApiJson<{ events: CalendarEvent[] }>(`/calendar/events?from=${from}&to=${to}`, { signal });
  return Array.isArray(body.events) ? body.events : [];
}

export async function searchCalendarEvents(query: string, signal?: AbortSignal): Promise<CalendarEvent[]> {
  const body = await pagesApiJson<{ events: CalendarEvent[] }>(`/calendar/events/search?q=${encodeURIComponent(query)}`, { signal });
  return Array.isArray(body.events) ? body.events : [];
}

export function createCalendarEvent(event: EventInput): Promise<{ event: CalendarEvent }> {
  return pagesApiJson("/calendar/events", jsonInit("POST", { event }));
}

export function updateCalendarEvent(id: string, input: { event: EventInput; scope: EditScope; occurrenceKey?: string | null; expectedRevision?: number | null; seriesRevision?: number | null }): Promise<{ event: CalendarEvent; exceptionsReset?: boolean }> {
  return pagesApiJson(`/calendar/events/${encodeURIComponent(id)}`, jsonInit("PATCH", input));
}

export function deleteCalendarEvent(id: string, input: { scope: EditScope; occurrenceKey?: string | null; revision?: number | null }): Promise<{ ok: true }> {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.occurrenceKey) params.set("occurrenceKey", input.occurrenceKey);
  if (input.revision) params.set("revision", String(input.revision));
  return pagesApiJson(`/calendar/events/${encodeURIComponent(id)}?${params}`, { method: "DELETE" });
}

export async function loadCalendarReminders(): Promise<CalendarReminder[]> {
  const body = await pagesApiJson<{ reminders: CalendarReminder[] }>("/calendar/reminders");
  return Array.isArray(body.reminders) ? body.reminders : [];
}

export async function markCalendarReminderRead(id?: string): Promise<void> {
  await pagesApiJson(id ? `/calendar/reminders/${encodeURIComponent(id)}` : "/calendar/reminders", { method: "PATCH" });
}

export function loadCalendarEvent(id: string): Promise<{ event: CalendarEvent; exceptions: CalendarEvent[] }> {
  return pagesApiJson(`/calendar/events/${encodeURIComponent(id)}`);
}

/** Mark a task complete or reopen it (stale revisions are refused with 409). */
export function setCalendarTaskCompletion(id: string, completed: boolean, expectedRevision?: number | null): Promise<{ event: CalendarEvent }> {
  return pagesApiJson(`/calendar/events/${encodeURIComponent(id)}/completion`, jsonInit("POST", { completed, expectedRevision: expectedRevision ?? null }));
}

export interface CalendarInterval {
  startAt: string;
  endAt: string;
  start: { date: string; time: string };
  end: { date: string; time: string };
}
export interface CalendarConflict extends CalendarInterval {
  eventId: string;
  seriesId: string | null;
  occurrenceKey: string | null;
  itemType: CalendarItemType;
  title: string;
  category: CalendarCategory | null;
  /** The proposed time this one overlaps (one of a series' occurrences). */
  candidate: { startAt: string; endAt: string };
}
export interface ConflictIgnore {
  eventId?: string | null;
  seriesId?: string | null;
  occurrenceKey?: string | null;
  scope?: EditScope;
}
export interface ConflictReport {
  conflicts: CalendarConflict[];
  suggestions: CalendarInterval[];
  skipped?: "all-day" | "completed";
}

/** Saved items the proposed timing overlaps, plus nearby free slots. Never blocks a save. */
export async function checkCalendarConflicts(event: EventInput, options: { ignore?: ConflictIgnore | null; completed?: boolean; signal?: AbortSignal } = {}): Promise<ConflictReport> {
  const body = await pagesApiJson<ConflictReport>("/calendar/conflicts", { ...jsonInit("POST", { event, ignore: options.ignore || null, completed: Boolean(options.completed) }), signal: options.signal });
  return { conflicts: Array.isArray(body.conflicts) ? body.conflicts : [], suggestions: Array.isArray(body.suggestions) ? body.suggestions : [], skipped: body.skipped };
}

export interface CalendarPreferences { filters: CalendarFilters; updatedAt: string | null; saved: boolean }

export function loadCalendarPreferences(): Promise<CalendarPreferences> {
  return pagesApiJson("/calendar/preferences");
}

export function saveCalendarPreferences(filters: CalendarFilters): Promise<CalendarPreferences> {
  return pagesApiJson("/calendar/preferences", jsonInit("PUT", { filters }));
}
