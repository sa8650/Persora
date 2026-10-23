// Types for habit-rules.js (shared by the Pages API and the browser).

export type HabitFrequency = "daily" | "weekdays" | "weekly";
export type HabitTracking = "check" | "numeric";
export type HabitCategory = "health" | "study" | "fitness" | "personal" | "work";
export type HabitIcon =
  | "check" | "droplet" | "book" | "dumbbell" | "footprints" | "bike" | "bed" | "apple" | "salad" | "leaf" | "brain" | "pen"
  | "code" | "music" | "heart" | "sun" | "moon" | "pill" | "wallet" | "sparkles" | "languages" | "flower" | "timer" | "smile";
export type HabitColor = "blue" | "teal" | "green" | "lime" | "amber" | "orange" | "red" | "pink" | "violet" | "indigo" | "slate";

export const WEEK_STARTS_ON: 0;
export const HABIT_FREQUENCIES: readonly HabitFrequency[];
export const HABIT_TRACKING: readonly HabitTracking[];
export const HABIT_CATEGORIES: readonly HabitCategory[];
export const HABIT_ICONS: readonly HabitIcon[];
export const HABIT_COLORS: readonly HabitColor[];
export const HABIT_LIMITS: Readonly<{
  name: number; description: number; unit: number; targetMax: number; valueMax: number; habits: number; rangeDays: number; historyEntries: number;
}>;

export class HabitValidationError extends Error {
  field: string;
  status: number;
  constructor(message: string, field?: string);
}

export interface HabitSchedule {
  frequency: HabitFrequency;
  /** 0 = Sunday … 6 = Saturday (selected weekdays only). */
  weekdays: number[];
  /** Weekly-target habits only (1–7). */
  weeklyTarget: number | null;
}
export interface ScheduleVersion extends HabitSchedule {
  from: string;
}

export interface HabitInput extends HabitSchedule {
  name: string;
  description: string;
  icon: HabitIcon;
  color: HabitColor;
  category: HabitCategory | null;
  tracking: HabitTracking;
  targetValue: number | null;
  unit: string;
  startDate: string;
  reminderTime: string | null;
  reminderEmail: boolean;
}

/** The fields the rules need; the API habit satisfies it. */
export interface HabitLike extends HabitSchedule {
  id: string;
  name?: string;
  startDate: string;
  scheduleHistory?: ScheduleVersion[];
  archivedAt?: string | null;
  completedDates?: string[];
  tracking?: HabitTracking;
  targetValue?: number | null;
  reminderTime?: string | null;
  reminderEmail?: boolean;
}

export interface CheckinLike {
  habitId: string;
  date: string;
  completed: boolean;
}

export type HabitDayStatus = "before-start" | "future" | "unscheduled" | "complete" | "partial" | "missed" | "open" | "goal-met" | "optional";
export type AggregateStatus = "complete" | "partial" | "missed" | "open" | "unscheduled" | "future";

export interface Ratio { completed: number; total: number; rate: number | null }
export interface Streaks { current: number; best: number; unit: "day" | "week"; bestUnit: "day" | "week" }
export interface Period { unit: "day" | "week"; key: string; met: boolean; open: boolean }

export function weekdaysToMask(weekdays: number[]): number;
export function maskToWeekdays(mask: number): number[];
export function normalizeSchedule(input: Partial<HabitSchedule>): HabitSchedule;
export function sameSchedule(a: HabitSchedule, b: HabitSchedule): boolean;
export function normalizeHabitInput(input: unknown, options?: { today?: string }): HabitInput;
export function normalizeCheckinInput(habit: { tracking?: HabitTracking; targetValue?: number | null }, body: unknown): { value: number; target: number | null; completed: boolean } | null;
export function normalizeScheduleHistory(history: unknown, startDate: string, fallback?: Partial<HabitSchedule> | null): ScheduleVersion[];
export function applyScheduleEdit(previous: HabitLike | null, next: HabitSchedule & { startDate: string }, today: string): ScheduleVersion[];
export function scheduleVersions(habit: HabitLike): ScheduleVersion[];
export function scheduleOn(habit: HabitLike, date: string): ScheduleVersion | null;
export function isScheduledOn(habit: HabitLike, date: string): boolean;
export function trackedUntil(habit: HabitLike, today: string, timeZone?: string): string;
export function weeklyTargetFor(habit: HabitLike, weekStart: string): number;
export function isWeeklyWeek(habit: HabitLike, weekStart: string): boolean;
export function completedSet(habit: HabitLike, checkins?: CheckinLike[]): Set<string>;
export function weekDoneCount(habit: HabitLike, done: Set<string>, weekStart: string, until?: string): number;
export function isDueOn(habit: HabitLike, done: Set<string>, date: string, today: string): boolean;
export function dayStatus(habit: HabitLike, done: Set<string>, date: string, today: string, options?: { value?: number | null; until?: string }): HabitDayStatus;
export function habitPeriods(habit: HabitLike, done: Set<string>, today: string, until?: string): Period[];
export function habitStreaks(habit: HabitLike, done: Set<string>, today: string, until?: string): Streaks;
export function dayCompletion(habits: HabitLike[], doneById: Map<string, Set<string>>, date: string, today: string): Ratio;
export function weekCompletion(habits: HabitLike[], doneById: Map<string, Set<string>>, weekStart: string, today: string, untilById?: Map<string, string>): Ratio;
export function monthCompletion(habits: HabitLike[], doneById: Map<string, Set<string>>, monthStart: string, today: string, untilById?: Map<string, string>): Ratio;
export function aggregateDay(habits: HabitLike[], doneById: Map<string, Set<string>>, date: string, today: string, untilById?: Map<string, string>): { status: AggregateStatus; completed: number; total: number };
export function habitReminderDedupeKey(habitId: string, date: string): string;
export interface ReminderCandidate {
  local_date: string; week_start: string; remind_at: string; time_zone: string; habit_name: string; email: boolean; dedupe_key: string;
}
export function reminderCandidates(habit: HabitLike, afterMs: number, timeZone: string, count?: number): ReminderCandidate[];
export function reminderDecision(
  habit: HabitLike | null,
  reminder: { local_date: string },
  context: { dayDone: boolean; weekDone: number; nowMs: number; timeZone: string },
): { deliver: boolean; note: string | null };
