// Persora Habit Tracker — browser client for /api/habits/*.
import type { HabitCategory, HabitColor, HabitIcon, HabitInput, HabitLike, HabitTracking, ScheduleVersion } from "../../cloudflare/habit-rules.js";
import { pagesApiJson } from "./cloud";

export interface Habit extends HabitLike {
  name: string;
  description: string;
  icon: HabitIcon;
  color: HabitColor;
  category: HabitCategory | null;
  tracking: HabitTracking;
  targetValue: number | null;
  unit: string;
  scheduleHistory: ScheduleVersion[];
  reminderTime: string | null;
  reminderEmail: boolean;
  position: number;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Every completed local date (for streaks); present on list responses. */
  completedDates: string[];
  nextReminderAt?: string | null;
}

export interface HabitCheckin {
  habitId: string;
  date: string;
  value: number;
  /** Numeric habits: the target when the value was recorded. */
  target: number | null;
  completed: boolean;
  updatedAt: string;
}

export interface HabitsPayload {
  timeZone: string;
  today: string;
  from: string;
  to: string;
  email: { available: boolean; reason: string | null };
  limits: { habits: number; name: number; description: number; unit: number };
  habits: Habit[];
  checkins: HabitCheckin[];
}

export interface HabitReminder {
  id: string;
  habitId: string;
  habitName: string;
  localDate: string;
  remindAt: string;
  readAt: string | null;
}

export interface HabitImportResult {
  habitsCreated: number;
  habitsMatched: number;
  checkinsAdded: number;
  checkinsSkipped: number;
}

/** Dispatched on window after habit changes, so reminders refresh immediately. */
export const HABITS_CHANGED_EVENT = "persora-habits-changed";
/** Dispatched on window after a backup restore, so an open Habit Tracker reloads. */
export const HABITS_RESTORED_EVENT = "persora-habits-restored";

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const habitPath = (id: string) => `/habits/${encodeURIComponent(id)}`;

export async function loadHabits(from: string, to: string, signal?: AbortSignal): Promise<HabitsPayload> {
  const body = await pagesApiJson<HabitsPayload>(`/habits?from=${from}&to=${to}`, { signal });
  return { ...body, habits: Array.isArray(body.habits) ? body.habits : [], checkins: Array.isArray(body.checkins) ? body.checkins : [] };
}

export function createHabit(input: HabitInput & { id?: string }): Promise<{ habit: Habit }> {
  return pagesApiJson("/habits", jsonInit("POST", input));
}

export function updateHabit(id: string, input: HabitInput, revision: number | null): Promise<{ habit: Habit }> {
  return pagesApiJson(habitPath(id), jsonInit("PATCH", { ...input, revision }));
}

export function setHabitArchived(id: string, archived: boolean): Promise<{ habit: Habit }> {
  return pagesApiJson(`${habitPath(id)}/${archived ? "archive" : "restore"}`, { method: "POST" });
}

export async function deleteHabit(id: string): Promise<void> {
  await pagesApiJson(habitPath(id), { method: "DELETE" });
}

export async function reorderHabits(ids: string[]): Promise<void> {
  await pagesApiJson("/habits/reorder", jsonInit("POST", { ids }));
}

export interface CheckinResult {
  date: string;
  habitId: string;
  checkin: HabitCheckin | null;
  completedDates: string[];
}

/** Checkbox habits send { completed }, numeric habits { value } (0 clears the day). */
export function saveHabitCheckin(id: string, date: string, body: { completed: boolean } | { value: number }): Promise<CheckinResult> {
  return pagesApiJson(`${habitPath(id)}/checkins/${date}`, jsonInit("PUT", body));
}

export async function loadHabitReminders(): Promise<HabitReminder[]> {
  const body = await pagesApiJson<{ reminders: HabitReminder[] }>("/habits/reminders");
  return Array.isArray(body.reminders) ? body.reminders : [];
}

export async function markHabitReminderRead(id?: string): Promise<void> {
  await pagesApiJson(id ? `/habits/reminders/${encodeURIComponent(id)}` : "/habits/reminders", { method: "PATCH" });
}

/** Restores habits and check-ins from a complete Persora backup's rows. */
export function importHabitBackup(habits: unknown[], checkins: unknown[]): Promise<HabitImportResult> {
  return pagesApiJson("/habits/import", jsonInit("POST", { habits, checkins }));
}
