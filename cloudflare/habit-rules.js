// Persora Habit Tracker — shared, dependency-free rules.
//
// Used by the Pages API (cloudflare/habits.js, authoritative validation and
// reminder scheduling) and by the browser (instant feedback and statistics), so
// both sides agree on schedules, streaks and completion rates.
//
// Dates are member-local calendar dates ("YYYY-MM-DD") in the profile's time
// zone; instants only appear for reminders, where DST is handled by
// zonedTimeToInstant from the calendar rules.
//
// Schedules are versioned. A habit keeps `scheduleHistory`: a list of
// { from, frequency, weekdays, weeklyTarget } entries. The first entry starts on
// the habit's start date and later entries start on a week boundary (Sunday), so
// every week is governed by exactly one schedule. Editing a schedule changes the
// current week onwards and leaves earlier weeks (and their statistics) intact.

import {
  addDays, daysBetween, isDateString, isTimeString, localDateOf, maxDate, minDate, startOfWeek, weekdayOf, zonedTimeToInstant,
} from "./calendar-rules.js";

export const WEEK_STARTS_ON = 0;
export const HABIT_FREQUENCIES = Object.freeze(["daily", "weekdays", "weekly"]);
export const HABIT_TRACKING = Object.freeze(["check", "numeric"]);
export const HABIT_CATEGORIES = Object.freeze(["health", "study", "fitness", "personal", "work"]);
export const HABIT_ICONS = Object.freeze([
  "check", "droplet", "book", "dumbbell", "footprints", "bike", "bed", "apple", "salad", "leaf", "brain", "pen",
  "code", "music", "heart", "sun", "moon", "pill", "wallet", "sparkles", "languages", "flower", "timer", "smile",
]);
export const HABIT_COLORS = Object.freeze(["blue", "teal", "green", "lime", "amber", "orange", "red", "pink", "violet", "indigo", "slate"]);
export const HABIT_LIMITS = Object.freeze({
  name: 80, description: 500, unit: 24, targetMax: 100000, valueMax: 1000000, habits: 100, rangeDays: 400, historyEntries: 60,
});

export class HabitValidationError extends Error {
  /** @param {string} message @param {string} [field] */
  constructor(message, field = "") {
    super(message);
    this.name = "HabitValidationError";
    this.field = field;
    this.status = 400;
  }
}

const fail = (message, field) => { throw new HabitValidationError(message, field); };
function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}
const round2 = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Weekday masks (bit 0 = Sunday … bit 6 = Saturday)
// ---------------------------------------------------------------------------

export function weekdaysToMask(weekdays) {
  return (Array.isArray(weekdays) ? weekdays : []).reduce((mask, day) => mask | (1 << day), 0);
}
export function maskToWeekdays(mask) {
  const days = [];
  for (let day = 0; day < 7; day += 1) if (Number(mask) & (1 << day)) days.push(day);
  return days;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function normalizeWeekdays(value) {
  if (!Array.isArray(value)) return [];
  const days = new Set();
  for (const entry of value) {
    const day = Number(entry);
    if (!Number.isInteger(day) || day < 0 || day > 6) fail("Choose valid weekdays.", "weekdays");
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

/** Validates one schedule ({ frequency, weekdays, weeklyTarget }). */
export function normalizeSchedule(input) {
  const frequency = HABIT_FREQUENCIES.includes(input?.frequency) ? input.frequency : fail("Choose how often this habit repeats.", "frequency");
  if (frequency === "daily") return { frequency, weekdays: [], weeklyTarget: null };
  if (frequency === "weekdays") {
    const weekdays = normalizeWeekdays(input.weekdays);
    if (!weekdays.length) fail("Pick at least one day of the week.", "weekdays");
    return { frequency, weekdays, weeklyTarget: null };
  }
  const target = Number(input.weeklyTarget);
  if (!Number.isInteger(target) || target < 1 || target > 7) fail("Choose between 1 and 7 times per week.", "weeklyTarget");
  return { frequency, weekdays: [], weeklyTarget: target };
}

export function sameSchedule(a, b) {
  return a.frequency === b.frequency && (a.weeklyTarget ?? null) === (b.weeklyTarget ?? null)
    && weekdaysToMask(a.weekdays) === weekdaysToMask(b.weekdays);
}

/**
 * Validates habit details from the editor (or a restore). `today` is the
 * member's local date and is the default start date.
 */
export function normalizeHabitInput(input, { today } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Send the habit details.");
  const name = cleanText(input.name, HABIT_LIMITS.name + 1);
  if (!name) fail("Give the habit a name.", "name");
  if (name.length > HABIT_LIMITS.name) fail(`Keep the name under ${HABIT_LIMITS.name} characters.`, "name");
  const description = cleanText(input.description, HABIT_LIMITS.description + 1);
  if (description.length > HABIT_LIMITS.description) fail(`Keep the description under ${HABIT_LIMITS.description} characters.`, "description");
  const icon = input.icon === undefined || input.icon === null || input.icon === "" ? "check" : String(input.icon);
  if (!HABIT_ICONS.includes(icon)) fail("Choose one of the habit icons.", "icon");
  const color = input.color === undefined || input.color === null || input.color === "" ? "blue" : String(input.color);
  if (!HABIT_COLORS.includes(color)) fail("Choose one of the habit colours.", "color");
  const category = input.category === undefined || input.category === null || input.category === "" ? null : String(input.category);
  if (category !== null && !HABIT_CATEGORIES.includes(category)) fail("Choose a valid category.", "category");
  const schedule = normalizeSchedule(input);
  const tracking = input.tracking === undefined ? "check" : input.tracking;
  if (!HABIT_TRACKING.includes(tracking)) fail("Choose how this habit is tracked.", "tracking");
  let targetValue = null;
  let unit = "";
  if (tracking === "numeric") {
    const target = Number(input.targetValue);
    if (!Number.isFinite(target) || target <= 0) fail("Enter a daily target greater than zero.", "targetValue");
    if (target > HABIT_LIMITS.targetMax) fail(`Keep the target at or below ${HABIT_LIMITS.targetMax.toLocaleString("en")}.`, "targetValue");
    targetValue = round2(target);
    if (targetValue <= 0) fail("Enter a daily target greater than zero.", "targetValue");
    unit = cleanText(input.unit, HABIT_LIMITS.unit + 1);
    if (unit.length > HABIT_LIMITS.unit) fail(`Keep the unit under ${HABIT_LIMITS.unit} characters.`, "unit");
  }
  const startDate = input.startDate === undefined || input.startDate === null || input.startDate === "" ? today : input.startDate;
  if (!isDateString(startDate)) fail("Enter a valid start date.", "startDate");
  if (today && isDateString(today) && daysBetween(today, startDate) > 366) fail("Start dates can be at most a year ahead.", "startDate");
  const reminderTime = input.reminderTime === undefined || input.reminderTime === null || input.reminderTime === "" ? null : input.reminderTime;
  if (reminderTime !== null && !isTimeString(reminderTime)) fail("Enter a reminder time like 08:30.", "reminderTime");
  return {
    name, description, icon, color, category, ...schedule, tracking, targetValue, unit, startDate,
    reminderTime, reminderEmail: reminderTime !== null && input.reminderEmail === true,
  };
}

/** A check-in request → the value to store (null = remove the check-in). */
export function normalizeCheckinInput(habit, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Send the check-in as JSON.");
  if (habit.tracking === "numeric") {
    const value = Number(body.value);
    if (body.value === null || body.value === "" || !Number.isFinite(value) || value < 0) fail("Enter an amount of zero or more.", "value");
    if (value > HABIT_LIMITS.valueMax) fail("That amount is too large.", "value");
    const rounded = round2(value);
    if (rounded === 0) return null;
    const target = Number(habit.targetValue);
    return { value: rounded, target, completed: rounded >= target };
  }
  if (typeof body.completed !== "boolean") fail("Mark the habit as done or not done.", "completed");
  return body.completed ? { value: 1, target: null, completed: true } : null;
}

// ---------------------------------------------------------------------------
// Schedule versions
// ---------------------------------------------------------------------------

/**
 * Canonical history for a start date: sorted, the first entry starts on the
 * start date, later entries on week boundaries strictly after it, consecutive
 * duplicates merged.
 */
export function normalizeScheduleHistory(history, startDate, fallback = null) {
  const entries = (Array.isArray(history) ? history : [])
    .filter((entry) => entry && isDateString(entry.from) && HABIT_FREQUENCIES.includes(entry.frequency))
    .map((entry) => {
      try { return { from: entry.from, ...normalizeSchedule(entry) }; } catch { return null; }
    })
    .filter(Boolean)
    .map((entry) => ({ ...entry, from: entry.from <= startDate ? startDate : maxDate(startDate, startOfWeek(entry.from, WEEK_STARTS_ON)) }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const byStart = [];
  for (const entry of entries) {
    if (byStart.length && byStart[byStart.length - 1].from === entry.from) byStart[byStart.length - 1] = entry; // latest wins
    else byStart.push(entry);
  }
  const merged = byStart.filter((entry, index) => index === 0 || !sameSchedule(entry, byStart[index - 1]));
  if (!merged.length && fallback) merged.push({ from: startDate, ...normalizeSchedule(fallback) });
  const trimmed = merged.slice(-HABIT_LIMITS.historyEntries);
  if (trimmed.length) trimmed[0] = { ...trimmed[0], from: startDate };
  return trimmed;
}

/**
 * The history after an edit made on `today`. A changed schedule applies from
 * the start of the current week (never before the start date); earlier weeks
 * keep the schedule they had.
 */
export function applyScheduleEdit(previous, next, today) {
  const nextSchedule = normalizeSchedule(next);
  const startDate = next.startDate;
  const history = normalizeScheduleHistory(previous?.scheduleHistory, startDate, previous && previous.frequency ? previous : nextSchedule);
  if (!previous) return normalizeScheduleHistory([], startDate, nextSchedule);
  const latest = history[history.length - 1];
  if (latest && sameSchedule(latest, nextSchedule)) return history;
  const effectiveFrom = maxDate(startDate, startOfWeek(today, WEEK_STARTS_ON));
  const kept = history.filter((entry) => entry.from < effectiveFrom);
  return normalizeScheduleHistory([...kept, { from: effectiveFrom, ...nextSchedule }], startDate, null);
}

/** Schedule entries for a habit (falls back to its current schedule). */
export function scheduleVersions(habit) {
  const history = Array.isArray(habit.scheduleHistory) && habit.scheduleHistory.length ? habit.scheduleHistory : null;
  if (history) return history;
  return [{ from: habit.startDate, frequency: habit.frequency, weekdays: habit.weekdays || [], weeklyTarget: habit.weeklyTarget ?? null }];
}

/** The schedule governing `date`, or null before the habit starts. */
export function scheduleOn(habit, date) {
  if (!habit.startDate || date < habit.startDate) return null;
  const versions = scheduleVersions(habit);
  let found = versions[0];
  for (const entry of versions) { if (entry.from <= date) found = entry; else break; }
  return found;
}

/** Whether the habit can be done on `date` (weekly-target habits: every day). */
export function isScheduledOn(habit, date) {
  const schedule = scheduleOn(habit, date);
  if (!schedule) return false;
  if (schedule.frequency === "weekdays") return schedule.weekdays.includes(weekdayOf(date));
  return true;
}

/** Last local date the habit is tracked: today, or the day it was archived. */
export function trackedUntil(habit, today, timeZone) {
  if (!habit.archivedAt) return today;
  const archived = timeZone ? localDateOf(Date.parse(habit.archivedAt), timeZone) : String(habit.archivedAt).slice(0, 10);
  return minDate(today, archived);
}

/**
 * A weekly-target habit's goal for the week starting `weekStart`. A first
 * partial week (habit started mid-week) asks for no more days than remain.
 */
export function weeklyTargetFor(habit, weekStart) {
  const schedule = scheduleOn(habit, maxDate(weekStart, habit.startDate));
  if (!schedule || schedule.frequency !== "weekly") return 0;
  const weekEnd = addDays(weekStart, 6);
  if (weekEnd < habit.startDate) return 0;
  const available = daysBetween(maxDate(weekStart, habit.startDate), weekEnd) + 1;
  return Math.min(schedule.weeklyTarget, available);
}

export const isWeeklyWeek = (habit, weekStart) => scheduleOn(habit, maxDate(weekStart, habit.startDate))?.frequency === "weekly";

// ---------------------------------------------------------------------------
// Completion lookups
// ---------------------------------------------------------------------------

/** Set of completed dates for one habit (from `completedDates` or check-ins). */
export function completedSet(habit, checkins = []) {
  const dates = new Set(Array.isArray(habit.completedDates) ? habit.completedDates : []);
  for (const entry of checkins) {
    if (entry.habitId !== habit.id) continue;
    if (entry.completed) dates.add(entry.date); else dates.delete(entry.date);
  }
  return dates;
}

/** Completed days of the week starting `weekStart`, within [start, until]. */
export function weekDoneCount(habit, done, weekStart, until = addDays(weekStart, 6)) {
  let count = 0;
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(weekStart, index);
    if (date >= habit.startDate && date <= until && done.has(date)) count += 1;
  }
  return count;
}

/**
 * Whether the habit is expected on `date`:
 * - day-based schedules: every scheduled day;
 * - weekly targets: days it was done, and (on `today`) while the week's goal
 *   isn't met yet. Missing a weekly habit on a given past day isn't a miss.
 */
export function isDueOn(habit, done, date, today) {
  if (!isScheduledOn(habit, date) || date > today) return false;
  const weekStart = startOfWeek(date, WEEK_STARTS_ON);
  if (!isWeeklyWeek(habit, weekStart)) return true;
  if (done.has(date)) return true;
  return date === today && weekDoneCount(habit, done, weekStart, today) < weeklyTargetFor(habit, weekStart);
}

/** Per-habit status of one day, for lists and the monthly grid. */
export function dayStatus(habit, done, date, today, { value = null, until = today } = {}) {
  if (date < habit.startDate) return "before-start";
  if (date > today) return isScheduledOn(habit, date) ? "future" : "unscheduled";
  if (date > until) return "unscheduled";
  if (!isScheduledOn(habit, date)) return "unscheduled";
  if (done.has(date)) return "complete";
  const weekStart = startOfWeek(date, WEEK_STARTS_ON);
  if (isWeeklyWeek(habit, weekStart)) {
    const goal = weeklyTargetFor(habit, weekStart);
    const weekDone = weekDoneCount(habit, done, weekStart, addDays(weekStart, 6));
    if (weekDone >= goal) return "goal-met";
    if (value !== null && value > 0) return "partial";
    return date === today ? "open" : "optional";
  }
  if (value !== null && value > 0) return "partial";
  return date === today ? "open" : "missed";
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/**
 * Periods a habit is measured on, oldest first, up to `until`:
 * scheduled days for day-based weeks, one entry per week for weekly targets.
 */
export function habitPeriods(habit, done, today, until = today) {
  const periods = [];
  if (!habit.startDate || until < habit.startDate) return periods;
  for (let weekStart = startOfWeek(habit.startDate, WEEK_STARTS_ON); weekStart <= until; weekStart = addDays(weekStart, 7)) {
    if (isWeeklyWeek(habit, weekStart)) {
      const goal = weeklyTargetFor(habit, weekStart);
      const weekEnd = addDays(weekStart, 6);
      const count = weekDoneCount(habit, done, weekStart, until);
      const met = goal > 0 && count >= goal;
      periods.push({ unit: "week", key: weekStart, met, open: !met && weekEnd >= until });
      continue;
    }
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(weekStart, index);
      if (date < habit.startDate || date > until || !isScheduledOn(habit, date)) continue;
      const met = done.has(date);
      periods.push({ unit: "day", key: date, met, open: !met && date === today });
    }
  }
  return periods;
}

/**
 * Current and best streaks. Unscheduled days never break a streak; today (or
 * the current week) counts once it's done but doesn't break the streak while
 * it's still open. A switch between day-based and weekly schedules starts a
 * new run, so units never mix.
 */
export function habitStreaks(habit, done, today, until = today) {
  const periods = habitPeriods(habit, done, today, until);
  let best = 0; let bestUnit = periods.length ? periods[periods.length - 1].unit : unitOf(habit);
  let run = 0; let runUnit = null;
  for (const period of periods) {
    if (period.unit !== runUnit) { run = 0; runUnit = period.unit; }
    if (period.met) {
      run += 1;
      if (run > best) { best = run; bestUnit = period.unit; }
    } else if (!period.open) run = 0;
  }
  let current = 0;
  const lastUnit = periods.length ? periods[periods.length - 1].unit : unitOf(habit);
  for (let index = periods.length - 1; index >= 0; index -= 1) {
    const period = periods[index];
    if (period.unit !== lastUnit) break;
    if (period.met) current += 1;
    else if (period.open && index === periods.length - 1) continue;
    else break;
  }
  return { current, best, unit: lastUnit, bestUnit };
}
function unitOf(habit) { return habit.frequency === "weekly" ? "week" : "day"; }

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const ratio = (completed, total) => ({ completed, total, rate: total ? Math.round((completed / total) * 100) : null });

/** Completion of the habits expected on `date` ("X of Y completed"). */
export function dayCompletion(habits, doneById, date, today) {
  let completed = 0; let total = 0;
  for (const habit of habits) {
    const done = doneById.get(habit.id) || new Set();
    if (!isDueOn(habit, done, date, today)) continue;
    total += 1;
    if (done.has(date)) completed += 1;
  }
  return ratio(completed, total);
}

/**
 * Weekly completion: completed ÷ scheduled opportunities up to today. Day-based
 * habits count each scheduled day; weekly-target habits count their goal
 * (completions above the goal don't inflate the rate).
 */
export function weekCompletion(habits, doneById, weekStart, today, untilById = new Map()) {
  let completed = 0; let total = 0;
  if (weekStart > today) return ratio(0, 0);
  for (const habit of habits) {
    const done = doneById.get(habit.id) || new Set();
    const until = minDate(today, untilById.get(habit.id) || today);
    if (addDays(weekStart, 6) < habit.startDate || weekStart > until) continue;
    if (isWeeklyWeek(habit, weekStart)) {
      const goal = weeklyTargetFor(habit, weekStart);
      total += goal;
      completed += Math.min(goal, weekDoneCount(habit, done, weekStart, until));
      continue;
    }
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(weekStart, index);
      if (date < habit.startDate || date > until || !isScheduledOn(habit, date)) continue;
      total += 1;
      if (done.has(date)) completed += 1;
    }
  }
  return ratio(completed, total);
}

/**
 * Monthly completion: scheduled days of the month up to today for day-based
 * weeks; weekly goals for the weeks whose tracked part begins in the month.
 */
export function monthCompletion(habits, doneById, monthStart, today, untilById = new Map()) {
  let completed = 0; let total = 0;
  const [year, month] = monthStart.split("-").map(Number);
  const monthEnd = addDays(monthStart, new Date(Date.UTC(year, month, 0)).getUTCDate() - 1);
  for (const habit of habits) {
    const done = doneById.get(habit.id) || new Set();
    const until = minDate(today, untilById.get(habit.id) || today);
    if (!habit.startDate || until < habit.startDate) continue;
    for (let weekStart = startOfWeek(maxDate(monthStart, habit.startDate), WEEK_STARTS_ON); weekStart <= minDate(monthEnd, until); weekStart = addDays(weekStart, 7)) {
      if (isWeeklyWeek(habit, weekStart)) {
        const begins = maxDate(weekStart, habit.startDate);
        if (begins < monthStart || begins > monthEnd) continue;
        const goal = weeklyTargetFor(habit, weekStart);
        total += goal;
        completed += Math.min(goal, weekDoneCount(habit, done, weekStart, until));
        continue;
      }
      for (let index = 0; index < 7; index += 1) {
        const date = addDays(weekStart, index);
        if (date < monthStart || date > monthEnd || date < habit.startDate || date > until || !isScheduledOn(habit, date)) continue;
        total += 1;
        if (done.has(date)) completed += 1;
      }
    }
  }
  return ratio(completed, total);
}

/**
 * Aggregate status of one day across habits for the monthly grid:
 * complete (everything expected was done), partial, missed, open (today, not
 * done yet), unscheduled (nothing expected) or future.
 */
export function aggregateDay(habits, doneById, date, today, untilById = new Map()) {
  if (date > today) {
    const any = habits.some((habit) => !habit.archivedAt && isScheduledOn(habit, date));
    return { status: any ? "future" : "unscheduled", completed: 0, total: 0 };
  }
  let completed = 0; let total = 0;
  for (const habit of habits) {
    const until = untilById.get(habit.id) || today;
    if (date > until) continue;
    const done = doneById.get(habit.id) || new Set();
    if (!isDueOn(habit, done, date, today)) continue;
    total += 1;
    if (done.has(date)) completed += 1;
  }
  const status = total === 0 ? "unscheduled" : completed === total ? "complete" : completed > 0 ? "partial" : date === today ? "open" : "missed";
  return { status, completed, total };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export function habitReminderDedupeKey(habitId, date) {
  return `habit:${habitId}:${date}`;
}

/**
 * The next reminder slots strictly after `afterMs`, in the member's zone: one
 * per scheduled local day at the habit's reminder time (DST-safe). Weekly-target
 * habits are eligible every day; delivery is skipped once the goal is met.
 */
export function reminderCandidates(habit, afterMs, timeZone, count = 3) {
  if (!habit || habit.archivedAt || !habit.reminderTime || !isTimeString(habit.reminderTime)) return [];
  const candidates = [];
  let date = maxDate(localDateOf(afterMs, timeZone), habit.startDate);
  for (let scanned = 0; scanned < 400 && candidates.length < count; scanned += 1, date = addDays(date, 1)) {
    if (!isScheduledOn(habit, date)) continue;
    const at = zonedTimeToInstant(date, habit.reminderTime, timeZone);
    if (at <= afterMs) continue;
    candidates.push({
      local_date: date, week_start: startOfWeek(date, WEEK_STARTS_ON), remind_at: new Date(at).toISOString(), time_zone: timeZone,
      habit_name: habit.name, email: Boolean(habit.reminderEmail), dedupe_key: habitReminderDedupeKey(habit.id, date),
    });
  }
  return candidates;
}

/**
 * Whether a due reminder should still be delivered. Never changes check-ins —
 * reminders only notify.
 */
export function reminderDecision(habit, reminder, { dayDone, weekDone, nowMs, timeZone }) {
  if (!habit || habit.archivedAt) return { deliver: false, note: "The habit is archived." };
  if (!habit.reminderTime) return { deliver: false, note: "Reminders are turned off for this habit." };
  if (!isScheduledOn(habit, reminder.local_date)) return { deliver: false, note: "The habit isn't scheduled that day." };
  if (dayDone) return { deliver: false, note: "Already completed that day." };
  const weekStart = startOfWeek(reminder.local_date, WEEK_STARTS_ON);
  if (isWeeklyWeek(habit, weekStart) && weekDone >= weeklyTargetFor(habit, weekStart)) return { deliver: false, note: "The weekly goal is already met." };
  if (localDateOf(nowMs, timeZone) > reminder.local_date) return { deliver: false, note: "The day ended before the reminder could be delivered." };
  return { deliver: true, note: null };
}
