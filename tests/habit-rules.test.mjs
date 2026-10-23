// Habit Tracker — pure rules shared by the Pages API and the browser.
import assert from "node:assert/strict";
import test from "node:test";
import {
  HabitValidationError, aggregateDay, applyScheduleEdit, completedSet, dayCompletion, dayStatus, habitReminderDedupeKey,
  habitStreaks, isDueOn, isScheduledOn, maskToWeekdays, monthCompletion, normalizeCheckinInput, normalizeHabitInput,
  normalizeScheduleHistory, reminderCandidates, reminderDecision, scheduleOn, trackedUntil, weekCompletion, weekDoneCount,
  weeklyTargetFor, weekdaysToMask,
} from "../cloudflare/habit-rules.js";
import { addDays } from "../cloudflare/calendar-rules.js";

// 2026-10-18 is a Sunday (weeks start on Sunday); 2026-10-24 is a Saturday.
const habit = (overrides = {}) => ({
  id: "h1", name: "Read", startDate: "2026-10-01", frequency: "daily", weekdays: [], weeklyTarget: null, archivedAt: null, ...overrides,
});
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const set = (...dates) => new Set(dates.flat());
const input = (value, today = "2026-10-24") => normalizeHabitInput(value, { today });
const throwsField = (fn, field) => assert.throws(fn, (error) => error instanceof HabitValidationError && error.field === field);

test("habit input: name required, defaults applied, fields validated", () => {
  throwsField(() => input({ frequency: "daily" }), "name");
  throwsField(() => input({ name: "x".repeat(81), frequency: "daily" }), "name");
  const value = input({ name: "  Drink water ", frequency: "daily" });
  assert.equal(value.name, "Drink water");
  assert.equal(value.startDate, "2026-10-24", "start date defaults to the member's today");
  assert.equal(value.icon, "check");
  assert.equal(value.color, "blue");
  assert.equal(value.tracking, "check");
  assert.equal(value.targetValue, null);
  assert.equal(value.reminderTime, null);
  assert.equal(value.reminderEmail, false);
  throwsField(() => input({ name: "A", frequency: "hourly" }), "frequency");
  throwsField(() => input({ name: "A", frequency: "daily", icon: "https://evil" }), "icon");
  throwsField(() => input({ name: "A", frequency: "daily", color: "#123456" }), "color");
  throwsField(() => input({ name: "A", frequency: "daily", category: "folders" }), "category");
  throwsField(() => input({ name: "A", frequency: "daily", startDate: "2026-02-30" }), "startDate");
  throwsField(() => input({ name: "A", frequency: "daily", reminderTime: "25:00" }), "reminderTime");
  throwsField(() => input({ name: "A", frequency: "daily", startDate: "2028-01-01" }), "startDate");
  // Email reminders need a reminder time.
  assert.equal(input({ name: "A", frequency: "daily", reminderEmail: true }).reminderEmail, false);
  assert.equal(input({ name: "A", frequency: "daily", reminderTime: "07:30", reminderEmail: true }).reminderEmail, true);
});

test("three schedule types validate and govern which days count", () => {
  const weekdays = input({ name: "Gym", frequency: "weekdays", weekdays: [5, 1, 3, 3] });
  assert.deepEqual(weekdays.weekdays, [1, 3, 5]);
  throwsField(() => input({ name: "Gym", frequency: "weekdays", weekdays: [] }), "weekdays");
  throwsField(() => input({ name: "Gym", frequency: "weekdays", weekdays: [7] }), "weekdays");
  const weekly = input({ name: "Run", frequency: "weekly", weeklyTarget: 3, weekdays: [1] });
  assert.equal(weekly.weeklyTarget, 3);
  assert.deepEqual(weekly.weekdays, []);
  throwsField(() => input({ name: "Run", frequency: "weekly", weeklyTarget: 8 }), "weeklyTarget");
  throwsField(() => input({ name: "Run", frequency: "weekly", weeklyTarget: 0 }), "weeklyTarget");
  assert.deepEqual(maskToWeekdays(weekdaysToMask([1, 3, 5])), [1, 3, 5]);

  const daily = habit();
  assert.equal(isScheduledOn(daily, "2026-09-30"), false, "nothing counts before the start date");
  assert.equal(isScheduledOn(daily, "2026-10-01"), true);
  const mwf = habit({ frequency: "weekdays", weekdays: [1, 3, 5] });
  assert.equal(isScheduledOn(mwf, "2026-10-19"), true); // Monday
  assert.equal(isScheduledOn(mwf, "2026-10-20"), false); // Tuesday
  const thrice = habit({ frequency: "weekly", weeklyTarget: 3 });
  assert.equal(isScheduledOn(thrice, "2026-10-20"), true, "weekly-target habits may be done on any day");
});

test("numeric targets: check-in values compare with the target; zero clears", () => {
  throwsField(() => input({ name: "Water", frequency: "daily", tracking: "numeric", targetValue: 0 }), "targetValue");
  const water = input({ name: "Water", frequency: "daily", tracking: "numeric", targetValue: "8", unit: " glasses " });
  assert.equal(water.targetValue, 8);
  assert.equal(water.unit, "glasses");
  assert.deepEqual(normalizeCheckinInput(water, { value: 5 }), { value: 5, target: 8, completed: false });
  assert.deepEqual(normalizeCheckinInput(water, { value: 8 }), { value: 8, target: 8, completed: true });
  assert.deepEqual(normalizeCheckinInput(water, { value: 9.456 }), { value: 9.46, target: 8, completed: true });
  assert.equal(normalizeCheckinInput(water, { value: 0 }), null);
  throwsField(() => normalizeCheckinInput(water, { value: -1 }), "value");
  throwsField(() => normalizeCheckinInput(water, { value: "" }), "value");
  assert.deepEqual(normalizeCheckinInput({ tracking: "check" }, { completed: true }), { value: 1, target: null, completed: true });
  assert.equal(normalizeCheckinInput({ tracking: "check" }, { completed: false }), null, "undo removes the check-in");
  throwsField(() => normalizeCheckinInput({ tracking: "check" }, { completed: "yes" }), "completed");
});

test("schedule edits apply from the current week and keep earlier weeks intact", () => {
  const before = habit({ scheduleHistory: [{ from: "2026-10-01", frequency: "daily", weekdays: [], weeklyTarget: null }] });
  const history = applyScheduleEdit(before, { startDate: "2026-10-01", frequency: "weekdays", weekdays: [1, 3, 5], weeklyTarget: null }, "2026-10-22");
  assert.deepEqual(history.map((entry) => [entry.from, entry.frequency]), [["2026-10-01", "daily"], ["2026-10-18", "weekdays"]]);
  const edited = { ...before, frequency: "weekdays", weekdays: [1, 3, 5], scheduleHistory: history };
  assert.equal(scheduleOn(edited, "2026-10-14").frequency, "daily");
  assert.equal(isScheduledOn(edited, "2026-10-13"), true, "an old Tuesday was a daily day");
  assert.equal(isScheduledOn(edited, "2026-10-20"), false, "this week's Tuesday no longer counts");
  // Re-saving an identical schedule changes nothing.
  assert.deepEqual(applyScheduleEdit(edited, { startDate: "2026-10-01", frequency: "weekdays", weekdays: [5, 3, 1] }, "2026-10-23"), history);
  // A brand-new habit has one entry beginning on its start date.
  assert.deepEqual(applyScheduleEdit(null, { startDate: "2026-10-24", frequency: "daily" }, "2026-10-24"),
    [{ from: "2026-10-24", frequency: "daily", weekdays: [], weeklyTarget: null }]);
  // Histories are canonical: later entries snap to week starts, the first to the start date.
  const canon = normalizeScheduleHistory([
    { from: "2026-09-01", frequency: "daily" },
    { from: "2026-10-21", frequency: "weekly", weeklyTarget: 2 },
  ], "2026-10-05");
  assert.deepEqual(canon.map((entry) => entry.from), ["2026-10-05", "2026-10-18"]);
});

test("streaks: daily runs, misses reset, an open today never breaks the run", () => {
  const read = habit();
  const done = set(days("2026-10-01", "2026-10-05"), days("2026-10-08", "2026-10-23"));
  assert.deepEqual(habitStreaks(read, done, "2026-10-24"), { current: 16, best: 16, unit: "day", bestUnit: "day" });
  done.add("2026-10-24");
  assert.equal(habitStreaks(read, done, "2026-10-24").current, 17);
  done.delete("2026-10-23"); // correcting history recomputes
  const corrected = habitStreaks(read, done, "2026-10-24");
  assert.equal(corrected.current, 1);
  assert.equal(corrected.best, 15);
  assert.deepEqual(habitStreaks(read, new Set(), "2026-10-24"), { current: 0, best: 0, unit: "day", bestUnit: "day" });
});

test("streaks: unscheduled days are skipped for selected weekdays", () => {
  const gym = habit({ frequency: "weekdays", weekdays: [1, 3, 5] }); // Mon/Wed/Fri
  const done = set("2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-23");
  assert.equal(habitStreaks(gym, done, "2026-10-24").current, 6);
  assert.equal(dayStatus(gym, done, "2026-10-24", "2026-10-24"), "unscheduled");
  assert.equal(dayStatus(gym, done, "2026-10-22", "2026-10-24"), "unscheduled");
  assert.equal(dayStatus(gym, set(), "2026-10-23", "2026-10-24"), "missed");
});

test("streaks: weekly targets count qualifying weeks; the current week stays open", () => {
  const run = habit({ frequency: "weekly", weeklyTarget: 2, startDate: "2026-10-04" }); // starts on a Sunday
  const done = set("2026-10-05", "2026-10-07", "2026-10-12", "2026-10-15", "2026-10-20");
  const streak = habitStreaks(run, done, "2026-10-24");
  assert.equal(streak.unit, "week");
  assert.equal(streak.current, 2, "two full weeks met; this week (1 of 2) is still open");
  done.add("2026-10-24");
  assert.equal(habitStreaks(run, done, "2026-10-24").current, 3);
  // A missed past week breaks the run once it closes.
  assert.equal(habitStreaks(run, set("2026-10-05", "2026-10-07", "2026-10-20", "2026-10-21"), "2026-10-24").current, 1);
  // Partial first week asks for no more days than remain.
  assert.equal(weeklyTargetFor(habit({ frequency: "weekly", weeklyTarget: 3, startDate: "2026-10-23" }), "2026-10-18"), 2);
});

test("streaks and rates cross month and year boundaries", () => {
  const h = habit({ startDate: "2026-12-28" });
  const done = set(days("2026-12-28", "2027-01-03"));
  assert.equal(habitStreaks(h, done, "2027-01-03").current, 7);
  const byId = new Map([["h1", done]]);
  assert.deepEqual(weekCompletion([h], byId, "2026-12-27", "2027-01-03"), { completed: 6, total: 6, rate: 100 });
  assert.deepEqual(monthCompletion([h], byId, "2027-01-01", "2027-01-03"), { completed: 3, total: 3, rate: 100 });
  assert.deepEqual(monthCompletion([h], byId, "2026-12-01", "2027-01-03"), { completed: 4, total: 4, rate: 100 });
});

test("archived habits are evaluated up to their archive date in the profile time zone", () => {
  // 20:30 UTC on Oct 20 is already Oct 21 in Dhaka (UTC+6).
  const archived = habit({ archivedAt: "2026-10-20T20:30:00Z" });
  assert.equal(trackedUntil(archived, "2026-10-24", "Asia/Dhaka"), "2026-10-21");
  assert.equal(trackedUntil(archived, "2026-10-24", "America/New_York"), "2026-10-20");
  assert.equal(trackedUntil(habit(), "2026-10-24", "Asia/Dhaka"), "2026-10-24");
  const done = set(days("2026-10-01", "2026-10-21"));
  assert.equal(habitStreaks(archived, done, "2026-10-24", "2026-10-21").current, 21, "archiving doesn't add misses");
  const untilById = new Map([["h1", "2026-10-21"]]);
  assert.deepEqual(weekCompletion([archived], new Map([["h1", done]]), "2026-10-18", "2026-10-24", untilById), { completed: 4, total: 4, rate: 100 });
});

test("weekly rate: completed ÷ scheduled opportunities; weekly goals cap extra completions", () => {
  const today = "2026-10-24"; const week = "2026-10-18";
  const daily = habit({ id: "a" });
  const mwf = habit({ id: "b", frequency: "weekdays", weekdays: [1, 3, 5] });
  const twice = habit({ id: "c", frequency: "weekly", weeklyTarget: 2 });
  const doneById = new Map([
    ["a", set("2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22")], // 5 of 7
    ["b", set("2026-10-19", "2026-10-23")], // 2 of 3
    ["c", set("2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21")], // 4 done, counts 2 of 2
  ]);
  assert.deepEqual(weekCompletion([daily, mwf, twice], doneById, week, today), { completed: 9, total: 12, rate: 75 });
  assert.equal(weekDoneCount(twice, doneById.get("c"), week), 4);
  assert.deepEqual(weekCompletion([daily], doneById, "2026-10-25", today), { completed: 0, total: 0, rate: null }, "future weeks have no rate");
});

test("monthly rate counts scheduled month days and goals of weeks beginning in the month", () => {
  const today = "2026-10-24";
  const daily = habit({ id: "a" });
  const doneById = new Map([["a", set(days("2026-10-01", "2026-10-12"))]]);
  assert.deepEqual(monthCompletion([daily], doneById, "2026-10-01", today), { completed: 12, total: 24, rate: 50 });
  const weekly = habit({ id: "w", frequency: "weekly", weeklyTarget: 1, startDate: "2026-10-01" });
  // Weeks whose tracked part begins in October: Oct 1 (partial), 4, 11, 18 → 4 goals. Week of Sep 27 begins Oct 1 for this habit.
  const result = monthCompletion([weekly], new Map([["w", set("2026-10-02", "2026-10-05")]]), "2026-10-01", today);
  assert.deepEqual(result, { completed: 2, total: 4, rate: 50 });
});

test("day status, due lists and the monthly heatmap aggregate", () => {
  const today = "2026-10-24";
  const daily = habit({ id: "a" });
  const twice = habit({ id: "c", frequency: "weekly", weeklyTarget: 2 });
  const doneA = set("2026-10-22");
  const doneC = set("2026-10-19", "2026-10-21");
  assert.equal(dayStatus(daily, doneA, "2026-10-22", today), "complete");
  assert.equal(dayStatus(daily, doneA, "2026-10-23", today), "missed");
  assert.equal(dayStatus(daily, doneA, today, today), "open");
  assert.equal(dayStatus(daily, doneA, "2026-10-25", today), "future");
  assert.equal(dayStatus(daily, doneA, "2026-09-30", today), "before-start");
  assert.equal(dayStatus(daily, doneA, "2026-10-23", today, { value: 3 }), "partial");
  assert.equal(dayStatus(twice, doneC, "2026-10-20", today), "goal-met");
  assert.equal(dayStatus(twice, set("2026-10-19"), "2026-10-20", today), "optional", "a weekly habit skipped on one day isn't a miss");
  assert.equal(isDueOn(twice, doneC, today, today), false, "weekly goal met → not due");
  assert.equal(isDueOn(twice, set("2026-10-19"), today, today), true);
  const doneById = new Map([["a", doneA], ["c", doneC]]);
  assert.deepEqual(dayCompletion([daily, twice], doneById, "2026-10-21", today), { completed: 1, total: 2, rate: 50 });
  assert.equal(aggregateDay([daily, twice], doneById, "2026-10-21", today).status, "partial");
  assert.equal(aggregateDay([daily], doneById, "2026-10-22", today).status, "complete");
  assert.equal(aggregateDay([daily], doneById, "2026-10-23", today).status, "missed");
  assert.equal(aggregateDay([daily], doneById, today, today).status, "open");
  assert.equal(aggregateDay([daily], doneById, "2026-10-30", today).status, "future");
  assert.equal(aggregateDay([habit({ frequency: "weekdays", weekdays: [1] })], new Map(), "2026-10-20", today).status, "unscheduled");
  assert.deepEqual([...completedSet({ id: "a", completedDates: ["2026-10-01"] }, [
    { habitId: "a", date: "2026-10-02", completed: true }, { habitId: "a", date: "2026-10-01", completed: false }, { habitId: "z", date: "2026-10-03", completed: true },
  ])], ["2026-10-02"]);
});

test("reminders: scheduled local days only, DST-safe, stable dedupe keys", () => {
  const ny = habit({ id: "r1", name: "Stretch", reminderTime: "08:00", frequency: "weekdays", weekdays: [0, 6] });
  const after = Date.parse("2026-10-30T00:00:00Z");
  const slots = reminderCandidates(ny, after, "America/New_York", 3);
  assert.deepEqual(slots.map((slot) => slot.local_date), ["2026-10-31", "2026-11-01", "2026-11-07"]);
  assert.deepEqual(slots.map((slot) => slot.remind_at), ["2026-10-31T12:00:00.000Z", "2026-11-01T13:00:00.000Z", "2026-11-07T13:00:00.000Z"]);
  assert.equal(slots[0].dedupe_key, habitReminderDedupeKey("r1", "2026-10-31"));
  assert.equal(slots[0].dedupe_key, "habit:r1:2026-10-31");
  // Spring-forward gap: 02:30 on 2026-03-08 doesn't exist in New York; the slot still resolves once.
  const gap = reminderCandidates(habit({ id: "r2", reminderTime: "02:30", startDate: "2026-03-08" }), Date.parse("2026-03-08T00:00:00Z"), "America/New_York", 2);
  assert.equal(gap.length, 2);
  assert.equal(new Set(gap.map((slot) => slot.dedupe_key)).size, 2);
  assert.equal(gap[0].local_date, "2026-03-08");
  // Dhaka (no DST) and "strictly after now".
  const dhaka = reminderCandidates(habit({ id: "r3", reminderTime: "21:00" }), Date.parse("2026-10-24T15:00:00Z"), "Asia/Dhaka", 1);
  assert.deepEqual(dhaka.map((slot) => [slot.local_date, slot.remind_at]), [["2026-10-25", "2026-10-25T15:00:00.000Z"]]);
  assert.deepEqual(reminderCandidates(habit({ reminderTime: null }), after, "Asia/Dhaka"), [], "disabled reminders schedule nothing");
  assert.deepEqual(reminderCandidates(habit({ reminderTime: "08:00", archivedAt: "2026-10-01T00:00:00Z" }), after, "Asia/Dhaka"), []);
  assert.deepEqual(reminderCandidates(habit({ reminderTime: "08:00", startDate: "2026-12-01" }), after, "Asia/Dhaka", 1).map((s) => s.local_date), ["2026-12-01"]);
});

test("reminder delivery is skipped when done, goal met, unscheduled, disabled or stale", () => {
  const zone = "Asia/Dhaka";
  const nowMs = Date.parse("2026-10-24T03:00:00Z"); // 09:00 in Dhaka
  const daily = habit({ reminderTime: "08:30" });
  const slot = { local_date: "2026-10-24" };
  assert.deepEqual(reminderDecision(daily, slot, { dayDone: false, weekDone: 0, nowMs, timeZone: zone }), { deliver: true, note: null });
  assert.equal(reminderDecision(daily, slot, { dayDone: true, weekDone: 0, nowMs, timeZone: zone }).deliver, false);
  assert.equal(reminderDecision({ ...daily, reminderTime: null }, slot, { dayDone: false, weekDone: 0, nowMs, timeZone: zone }).deliver, false);
  assert.equal(reminderDecision({ ...daily, archivedAt: "2026-10-23T00:00:00Z" }, slot, { dayDone: false, weekDone: 0, nowMs, timeZone: zone }).deliver, false);
  assert.equal(reminderDecision(null, slot, { dayDone: false, weekDone: 0, nowMs, timeZone: zone }).deliver, false);
  assert.equal(reminderDecision(daily, { local_date: "2026-10-23" }, { dayDone: false, weekDone: 0, nowMs, timeZone: zone }).deliver, false, "yesterday's reminder is stale");
  const mon = habit({ reminderTime: "08:30", frequency: "weekdays", weekdays: [1] });
  assert.equal(reminderDecision(mon, slot, { dayDone: false, weekDone: 0, nowMs, timeZone: zone }).deliver, false);
  const twice = habit({ reminderTime: "08:30", frequency: "weekly", weeklyTarget: 2 });
  assert.equal(reminderDecision(twice, slot, { dayDone: false, weekDone: 2, nowMs, timeZone: zone }).deliver, false);
  assert.equal(reminderDecision(twice, slot, { dayDone: false, weekDone: 1, nowMs, timeZone: zone }).deliver, true);
});
