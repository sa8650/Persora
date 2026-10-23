// Persora Habit Tracker — Pages API routes, reminder dispatcher, backup/restore.
//
// Every route runs for the signed-in member only (api.js authorizes first) and
// every database call passes that member's id, which the SQL functions in
// supabase/migrations/202610280001_habits.sql use to scope each statement.
// Input is validated here with the shared rules (cloudflare/habit-rules.js) and
// again by table constraints.
//
// Reminders reuse the calendar's pipeline: the same cron ping and internal
// endpoint (api.js), the same email service and the same in-app bell. When a
// reminder is due, dispatchHabitReminders() claims it, skips it if the habit is
// already done for that day (or the weekly goal is met), otherwise records it
// for the bell and emails it when requested, then plans the next slot.
// Reminders never create or change check-ins.

import { emailAvailability } from "./calendar.js";
import { isDateString, localDateOf, safeTimeZone, startOfMonth, zonedTimeToInstant, addDays, daysBetween } from "./calendar-rules.js";
import {
  HABIT_CATEGORIES, HABIT_COLORS, HABIT_ICONS, HABIT_LIMITS, HabitValidationError, applyScheduleEdit, isScheduledOn, maskToWeekdays,
  normalizeCheckinInput, normalizeHabitInput, normalizeScheduleHistory, reminderCandidates, reminderDecision, weekdaysToMask,
} from "./habit-rules.js";

export const HABITS_ROUTE_PREFIX = "/habits";
const DISPATCH_INTERVAL_MS = 60_000;
const BELL_WINDOW_MS = 36 * 3_600_000;
const LATE_EMAIL_MS = 2 * 3_600_000;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_CHECKINS = 100_000;

export class HabitError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// HTTP + database plumbing (same conventions as the calendar module)
// ---------------------------------------------------------------------------

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
    },
  });
}
function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}
function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new HabitError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "23514" || code === "22007" || code === "22008" || code === "22P02") return new HabitError("Those habit details aren't valid. Check them and try again.", 400);
  if (code === "23505") return new HabitError("That change conflicts with another one. Reload and try again.", 409);
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") {
    return new HabitError("Habit Tracker needs its database migration (202610280001_habits.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora Habit Tracker database request failed", response.status, code, message);
  return new HabitError("The habit database could not complete the request. Please try again shortly.", 502);
}
async function rpc(name, args, env) {
  const response = await fetch(dbUrl(env, `rpc/${name}`), {
    method: "POST", headers: dbHeaders(env, { "Content-Type": "application/json" }), body: JSON.stringify(args),
  });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}
async function readBody(request, limit = 64 * 1024) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new HabitError("Send the request as JSON.", 415);
  const text = await request.text();
  if (text.length > limit) throw new HabitError("That request is too large.", 413);
  try { return JSON.parse(text || "{}"); } catch { throw new HabitError("The request body isn't valid JSON.", 400); }
}
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

// ---------------------------------------------------------------------------
// Row <-> API shapes
// ---------------------------------------------------------------------------

const dateOnly = (value) => (value ? String(value).slice(0, 10) : null);
const timeOnly = (value) => (value ? String(value).slice(0, 5) : null);
const instant = (value) => {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

/** Database row → API habit (camelCase). */
export function habitFromRow(row) {
  const startDate = dateOnly(row.start_date);
  const current = {
    frequency: row.frequency, weekdays: maskToWeekdays(row.weekday_mask), weeklyTarget: numberOrNull(row.weekly_target),
  };
  const habit = {
    id: row.id,
    name: row.name,
    description: row.description || "",
    icon: HABIT_ICONS.includes(row.icon) ? row.icon : "check",
    color: HABIT_COLORS.includes(row.color) ? row.color : "blue",
    category: HABIT_CATEGORIES.includes(row.category) ? row.category : null,
    ...current,
    tracking: row.tracking === "numeric" ? "numeric" : "check",
    targetValue: numberOrNull(row.target_value),
    unit: row.unit || "",
    startDate,
    scheduleHistory: normalizeScheduleHistory(row.schedule_history, startDate, current),
    reminderTime: timeOnly(row.reminder_time),
    reminderEmail: Boolean(row.reminder_email),
    position: Number(row.position) || 0,
    archivedAt: row.archived_at ? instant(row.archived_at) : null,
    revision: Number(row.revision) || 1,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
  if (Array.isArray(row.completed_dates)) habit.completedDates = row.completed_dates.map(dateOnly);
  if (row.pending_reminder !== undefined) habit.nextReminderAt = row.pending_reminder ? instant(row.pending_reminder.remind_at) : null;
  return habit;
}
export function checkinFromRow(row) {
  return {
    habitId: row.habit_id, date: dateOnly(row.check_date), value: Number(row.value),
    target: numberOrNull(row.target_value), completed: Boolean(row.completed), updatedAt: instant(row.updated_at),
  };
}
/** Validated habit → the JSON written by persora_habit_apply. */
function habitValues(normalized, history) {
  return {
    name: normalized.name, description: normalized.description, icon: normalized.icon, color: normalized.color, category: normalized.category,
    frequency: normalized.frequency, weekday_mask: normalized.frequency === "weekdays" ? weekdaysToMask(normalized.weekdays) : 0,
    weekly_target: normalized.frequency === "weekly" ? normalized.weeklyTarget : null,
    tracking: normalized.tracking, target_value: normalized.tracking === "numeric" ? normalized.targetValue : null, unit: normalized.unit,
    start_date: normalized.startDate, schedule_history: history,
    reminder_time: normalized.reminderTime, reminder_email: normalized.reminderEmail,
  };
}

const zoneOf = (identity) => safeTimeZone(identity.timezone, "UTC");
const todayOf = (identity, now = Date.now()) => localDateOf(now, zoneOf(identity));

async function loadHabit(identity, id, env) {
  if (!isUuid(id)) throw new HabitError("This habit no longer exists.", 404);
  const row = await rpc("persora_habit_get", { p_owner: identity.id, p_id: id }, env);
  if (!row) throw new HabitError("This habit no longer exists.", 404);
  return habitFromRow(row);
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

async function listHabits(identity, url, env, services) {
  const zone = zoneOf(identity);
  const now = Date.now();
  const today = localDateOf(now, zone);
  const from = url.searchParams.get("from") || addDays(startOfMonth(today), -7);
  const to = url.searchParams.get("to") || today;
  if (!isDateString(from) || !isDateString(to) || to < from) throw new HabitError("Choose a valid date range.", 400);
  if (daysBetween(from, to) > HABIT_LIMITS.rangeDays) throw new HabitError("Choose a shorter date range.", 400);
  const data = await rpc("persora_habits_list", { p_owner: identity.id, p_from: from, p_to: to }, env);
  const rows = Array.isArray(data?.habits) ? data.habits : [];
  const habits = rows.map(habitFromRow);
  // Keep pending reminders in step with the profile's time zone and the habit's
  // reminder time (e.g. after a time-zone change or a restore).
  for (let index = 0; index < habits.length; index += 1) {
    const habit = habits[index]; const pending = rows[index].pending_reminder;
    if (habit.archivedAt || !habit.reminderTime) continue;
    const stale = !pending || pending.time_zone !== zone
      || Date.parse(pending.remind_at) !== zonedTimeToInstant(dateOnly(pending.local_date), habit.reminderTime, zone);
    if (!stale) continue;
    const candidates = reminderCandidates(habit, now, zone);
    if (!candidates.length) continue;
    try {
      await rpc("persora_habit_reschedule", { p_owner: identity.id, p_id: habit.id, p_reminders: candidates }, env);
      habit.nextReminderAt = candidates[0].remind_at;
    } catch (error) {
      console.error("Persora Habit Tracker could not re-plan a reminder", error?.message || error);
    }
  }
  return {
    timeZone: zone, today, from, to,
    email: emailAvailability(identity, services),
    limits: { habits: HABIT_LIMITS.habits, name: HABIT_LIMITS.name, description: HABIT_LIMITS.description, unit: HABIT_LIMITS.unit },
    habits,
    checkins: (Array.isArray(data?.checkins) ? data.checkins : []).map(checkinFromRow),
  };
}

async function saveHabit(identity, existing, body, env) {
  const zone = zoneOf(identity);
  const now = Date.now();
  const today = localDateOf(now, zone);
  const normalized = normalizeHabitInput(body, { today });
  const id = existing ? existing.id : isUuid(body.id) ? String(body.id).toLowerCase() : crypto.randomUUID();
  if (!existing && isUuid(body.id)) {
    // A retried create (same client id) returns the saved habit unchanged; it
    // never overwrites it or resets its schedule history.
    const saved = await rpc("persora_habit_get", { p_owner: identity.id, p_id: id }, env);
    if (saved) return { habit: habitFromRow(saved), replayed: true };
  }
  const history = applyScheduleEdit(existing, normalized, today);
  const planned = { ...normalized, id, archivedAt: existing?.archivedAt || null, scheduleHistory: history };
  const expected = existing ? (Number.isInteger(body.revision) ? body.revision : null) : null;
  const row = await rpc("persora_habit_save", {
    p_owner: identity.id, p_id: id, p_habit: habitValues(normalized, history), p_expected_revision: expected,
    p_reminders: reminderCandidates(planned, now, zone),
  }, env);
  return { habit: habitFromRow(row) };
}

async function setArchived(identity, id, archived, env) {
  const habit = await loadHabit(identity, id, env);
  const zone = zoneOf(identity);
  const candidates = archived ? null : reminderCandidates({ ...habit, archivedAt: null }, Date.now(), zone);
  const row = await rpc("persora_habit_set_archived", { p_owner: identity.id, p_id: habit.id, p_archived: archived, p_reminders: candidates }, env);
  return { habit: habitFromRow(row) };
}

async function reorderHabits(identity, body, env) {
  const ids = Array.isArray(body?.ids) ? body.ids : null;
  if (!ids || ids.length > 200 || !ids.every(isUuid) || new Set(ids).size !== ids.length) throw new HabitError("Send the habits in their new order.", 400);
  const updated = await rpc("persora_habit_reorder", { p_owner: identity.id, p_ids: ids }, env);
  return { ok: true, updated: Number(updated) || 0 };
}

async function saveCheckin(identity, id, date, body, env) {
  if (!isDateString(date)) throw new HabitError("Choose a valid day.", 400);
  const habit = await loadHabit(identity, id, env);
  const today = todayOf(identity);
  if (date > today) throw new HabitError("You can't check in a day that hasn't happened yet.", 400);
  if (habit.archivedAt) throw new HabitError("Restore this habit to update its history.", 409);
  if (date < habit.startDate) throw new HabitError("That day is before the habit started.", 400);
  const entry = normalizeCheckinInput(habit, body);
  // Recording needs a scheduled day; clearing is always allowed (e.g. a check-in
  // left on a day a later schedule edit no longer includes).
  if (entry && !isScheduledOn(habit, date)) throw new HabitError("This habit isn't scheduled on that day.", 400);
  const result = await rpc("persora_habit_checkin", { p_owner: identity.id, p_habit: habit.id, p_date: date, p_value: entry ? entry.value : null }, env);
  return {
    date, habitId: habit.id,
    checkin: result?.checkin ? checkinFromRow(result.checkin) : null,
    completedDates: (Array.isArray(result?.completed_dates) ? result.completed_dates : []).map(dateOnly),
  };
}

// ---------------------------------------------------------------------------
// Reminders (delivery reuses the calendar's scheduler, email and bell)
// ---------------------------------------------------------------------------

function reminderFromRow(row) {
  return {
    id: row.id, habitId: row.habit_id, habitName: row.habit_name, localDate: dateOnly(row.local_date),
    remindAt: instant(row.remind_at), readAt: row.read_at ? instant(row.read_at) : null,
    emailStatus: row.email_status, emailNote: row.email_note || null,
  };
}

async function listReminders(identity, env) {
  const rows = await rpc("persora_habit_reminders_recent", { p_owner: identity.id, p_since: new Date(Date.now() - BELL_WINDOW_MS).toISOString() }, env);
  return { reminders: (Array.isArray(rows) ? rows : []).map(reminderFromRow), serverTime: new Date().toISOString() };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function targetLine(habit) {
  if (habit.tracking === "numeric" && habit.targetValue) return `Today's target: ${habit.targetValue}${habit.unit ? ` ${habit.unit}` : ""}`;
  if (habit.frequency === "weekly" && habit.weeklyTarget) return `Goal: ${habit.weeklyTarget} time${habit.weeklyTarget === 1 ? "" : "s"} this week`;
  return "";
}
/** Habit reminder email (plain text + simple HTML). */
export function habitReminderEmail(reminder, habit, owner, appUrl) {
  const day = new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${dateOnly(reminder.local_date)}T12:00:00Z`));
  const target = targetLine(habit);
  const lines = [`Time for: ${habit.name}`, day];
  if (target) lines.push(target);
  lines.push("", "You turned on email reminders for this habit in Persora. Reminders never mark a habit as done.");
  if (appUrl) lines.push(`Open Habit Tracker: ${appUrl}`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.5">
<p style="margin:0 0 4px;font-size:13px;color:#5f6368">Persora habit reminder</p>
<h2 style="margin:0 0 6px;font-size:18px">${escapeHtml(habit.name)}</h2>
<p style="margin:0">${escapeHtml(day)}</p>${target ? `<p style="margin:0;color:#5f6368">${escapeHtml(target)}</p>` : ""}
<p style="margin:14px 0 0;font-size:13px;color:#5f6368">You turned on email reminders for this habit. Reminders never mark a habit as done.</p>${appUrl ? `<p style="margin:14px 0 0"><a href="${escapeHtml(appUrl)}" style="color:#1a73e8">Open Habit Tracker</a></p>` : ""}
</div>`;
  return { to: owner.email, toName: owner.full_name, subject: `Habit reminder: ${habit.name}`.slice(0, 200), textContent: lines.join("\n"), htmlContent: html };
}

/**
 * Delivers due habit reminders. Safe to run concurrently and repeatedly: claims
 * are exclusive, completion requires the same claim, emails are sent at most
 * once, and each habit has at most one reminder per local day.
 */
export async function dispatchHabitReminders(env, services = {}, { owner = null, limit = 50, appUrl = "" } = {}) {
  const claimed = await rpc("persora_habit_claim_reminders", { p_limit: limit, p_owner: owner }, env);
  const summary = { claimed: 0, delivered: 0, skipped: 0, emailed: 0, emailFailed: 0, emailSkipped: 0 };
  for (const entry of Array.isArray(claimed) ? claimed : []) {
    const reminder = { ...entry.reminder, local_date: dateOnly(entry.reminder.local_date) };
    const person = entry.owner || {};
    summary.claimed += 1;
    const now = Date.now();
    let habit = null;
    let next = null;
    try { habit = habitFromRow(entry.habit); } catch (error) { console.error("Persora Habit Tracker received an invalid habit", error?.message || error); }
    const zone = safeTimeZone(person.timezone, safeTimeZone(reminder.time_zone, "UTC"));
    const decision = habit
      ? reminderDecision(habit, reminder, { dayDone: Boolean(entry.day_done), weekDone: Number(entry.week_done) || 0, nowMs: now, timeZone: zone })
      : { deliver: false, note: "The habit is unavailable." };
    let emailStatus = reminder.email_status === "failed" ? "failed" : "not_requested";
    let note = decision.note;
    if (reminder.email_status === "sending") {
      if (!decision.deliver) emailStatus = "skipped";
      else if (!person.active) { emailStatus = "skipped"; note = "The account isn't active."; }
      else if (!person.email_verified) { emailStatus = "skipped"; note = "The email address isn't verified."; }
      else if (now - Date.parse(reminder.remind_at) > LATE_EMAIL_MS) { emailStatus = "skipped"; note = "The reminder was processed too late to email."; }
      else if (typeof services.sendEmail !== "function" || !services.emailConfigured?.()) { emailStatus = "skipped"; note = "Email delivery isn't configured."; }
      else {
        try {
          await services.sendEmail(habitReminderEmail(reminder, habit, person, appUrl));
          emailStatus = "sent";
        } catch (error) {
          emailStatus = "failed";
          note = String(error?.message || "Email delivery failed.").slice(0, 200);
        }
      }
      if (emailStatus === "sent") summary.emailed += 1;
      else if (emailStatus === "failed") summary.emailFailed += 1;
      else summary.emailSkipped += 1;
    }
    if (decision.deliver) summary.delivered += 1; else summary.skipped += 1;
    if (habit) {
      try { next = reminderCandidates(habit, Math.max(Date.parse(reminder.remind_at), now), zone); }
      catch (error) { console.error("Persora Habit Tracker could not plan the next reminder", error?.message || error); }
    }
    await rpc("persora_habit_complete_reminder", {
      p_id: reminder.id, p_claimed_at: reminder.claimed_at, p_delivered: decision.deliver, p_email_status: emailStatus,
      p_note: note, p_habit_revision: Number(entry.habit?.revision) || 0, p_next: next && next.length ? next : null,
    }, env);
  }
  return summary;
}

let lastBackgroundDispatch = 0;
/** Opportunistic dispatch after signed-in requests (at most once a minute per isolate). */
export function scheduleHabitDispatch(env, ctx, services, appUrl = "") {
  if (Date.now() - lastBackgroundDispatch < DISPATCH_INTERVAL_MS) return;
  lastBackgroundDispatch = Date.now();
  const work = dispatchHabitReminders(env, services, { limit: 50, appUrl }).catch((error) => {
    if (!(error instanceof HabitError && error.status === 503)) console.error("Persora habit reminder dispatch failed", error?.message || error);
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
}

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

/**
 * Habit data for the complete account export. Returns empty lists, not an
 * error, when the habits migration hasn't been applied yet.
 */
export async function exportHabitData(userId, env) {
  try {
    const data = await rpc("persora_habits_export", { p_owner: userId }, env);
    return {
      habits: Array.isArray(data?.habits) ? data.habits : [],
      checkins: Array.isArray(data?.checkins) ? data.checkins : [],
      reminders: Array.isArray(data?.reminders) ? data.reminders : [],
    };
  } catch (error) {
    if (error instanceof HabitError && error.status === 503) return { habits: [], checkins: [], reminders: [] };
    throw error;
  }
}

/**
 * Restores habits and check-ins from a Persora backup (`data.habits` and
 * `data.habitCheckins` of persora-export.json). Rows are re-validated with the
 * same rules as the editor; completion is recomputed from the values.
 */
export async function importHabitData(identity, body, env) {
  const habitsIn = Array.isArray(body?.habits) ? body.habits : null;
  const checkinsIn = Array.isArray(body?.checkins) ? body.checkins : [];
  if (!habitsIn) throw new HabitError("This backup doesn't contain Habit Tracker data.", 400);
  if (habitsIn.length > HABIT_LIMITS.habits) throw new HabitError(`A backup can restore up to ${HABIT_LIMITS.habits} habits.`, 400);
  if (checkinsIn.length > MAX_IMPORT_CHECKINS) throw new HabitError("This backup has too many check-ins to restore at once.", 413);
  const today = todayOf(identity);
  const byId = new Map();
  const habits = habitsIn.map((row, index) => {
    if (!row || typeof row !== "object" || !isUuid(row.id)) throw new HabitError(`Habit ${index + 1} in this backup is invalid.`, 400);
    let normalized;
    try {
      normalized = normalizeHabitInput({
        name: row.name, description: row.description, icon: row.icon, color: row.color, category: row.category,
        frequency: row.frequency, weekdays: maskToWeekdays(row.weekday_mask), weeklyTarget: numberOrNull(row.weekly_target),
        tracking: row.tracking, targetValue: numberOrNull(row.target_value), unit: row.unit, startDate: dateOnly(row.start_date),
        reminderTime: timeOnly(row.reminder_time), reminderEmail: Boolean(row.reminder_email),
      }, { today });
    } catch (error) {
      if (error instanceof HabitValidationError) throw new HabitError(`Habit ${index + 1} in this backup is invalid: ${error.message}`, 400);
      throw error;
    }
    const archivedAt = row.archived_at ? instant(row.archived_at) : null;
    const history = normalizeScheduleHistory(row.schedule_history, normalized.startDate, normalized);
    byId.set(String(row.id).toLowerCase(), normalized);
    return { source_id: String(row.id).toLowerCase(), values: habitValues(normalized, history), archived_at: archivedAt, created_at: instant(row.created_at) };
  });
  const seen = new Set();
  const checkins = [];
  for (const row of checkinsIn) {
    const habitId = String(row?.habit_id || "").toLowerCase();
    const habit = byId.get(habitId);
    const date = dateOnly(row?.check_date);
    const value = Number(row?.value);
    if (!habit || !isDateString(date) || !Number.isFinite(value) || value <= 0 || value > HABIT_LIMITS.valueMax) continue;
    if (date < habit.startDate || seen.has(`${habitId}:${date}`)) continue;
    seen.add(`${habitId}:${date}`);
    if (habit.tracking === "numeric") {
      const snapshot = Number(row.target_value);
      const target = Number.isFinite(snapshot) && snapshot > 0 ? snapshot : habit.targetValue;
      const rounded = Math.round(value * 100) / 100;
      checkins.push({ habit_source_id: habitId, date, value: rounded, target_value: target, completed: rounded >= target });
    } else {
      checkins.push({ habit_source_id: habitId, date, value: 1, target_value: null, completed: true });
    }
  }
  const result = await rpc("persora_habits_import", { p_owner: identity.id, p_habits: habits, p_checkins: checkins }, env);
  return {
    ok: true,
    habitsCreated: Number(result?.habits_created) || 0,
    habitsMatched: Number(result?.habits_matched) || 0,
    checkinsAdded: Number(result?.checkins_added) || 0,
    checkinsSkipped: (Number(result?.checkins_skipped) || 0) + (checkinsIn.length - checkins.length),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleHabits(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;
  const appUrl = `${url.origin}/?view=habits`;
  try {
    if (path === "/habits" && method === "GET") return json(await listHabits(identity, url, env, services), 200, origin);
    if (path === "/habits" && method === "POST") {
      const { replayed, ...result } = await saveHabit(identity, null, await readBody(request), env);
      return json(result, replayed ? 200 : 201, origin);
    }
    if (path === "/habits/reorder" && method === "POST") return json(await reorderHabits(identity, await readBody(request), env), 200, origin);
    if (path === "/habits/import" && method === "POST") return json(await importHabitData(identity, await readBody(request, MAX_IMPORT_BYTES), env), 200, origin);
    if (path === "/habits/reminders" && method === "GET") {
      // Deliver this member's due reminders first, so the bell never depends on
      // a background scheduler having run.
      try { await dispatchHabitReminders(env, services, { owner: identity.id, limit: 20, appUrl }); }
      catch (error) { if (!(error instanceof HabitError && error.status === 503)) console.error("Persora habit member dispatch failed", error?.message || error); }
      return json(await listReminders(identity, env), 200, origin);
    }
    if (path === "/habits/reminders" && method === "PATCH") {
      await rpc("persora_habit_reminders_mark_read", { p_owner: identity.id, p_id: null }, env);
      return json({ ok: true }, 200, origin);
    }
    const reminderMatch = path.match(/^\/habits\/reminders\/([^/]+)$/);
    if (reminderMatch && method === "PATCH") {
      if (!isUuid(reminderMatch[1])) throw new HabitError("That reminder is no longer available.", 404);
      await rpc("persora_habit_reminders_mark_read", { p_owner: identity.id, p_id: reminderMatch[1] }, env);
      return json({ ok: true }, 200, origin);
    }
    const checkinMatch = path.match(/^\/habits\/([^/]+)\/checkins\/([^/]+)$/);
    if (checkinMatch && method === "PUT") return json(await saveCheckin(identity, checkinMatch[1], checkinMatch[2], await readBody(request), env), 200, origin);
    if (checkinMatch && method === "DELETE") return json(await saveCheckin(identity, checkinMatch[1], checkinMatch[2], { completed: false, value: 0 }, env), 200, origin);
    const actionMatch = path.match(/^\/habits\/([^/]+)\/(archive|restore)$/);
    if (actionMatch && method === "POST") return json(await setArchived(identity, actionMatch[1], actionMatch[2] === "archive", env), 200, origin);
    const habitMatch = path.match(/^\/habits\/([^/]+)$/);
    if (habitMatch && method === "PATCH") {
      const body = await readBody(request);
      const existing = await loadHabit(identity, habitMatch[1], env);
      return json(await saveHabit(identity, existing, body, env), 200, origin);
    }
    if (habitMatch && method === "DELETE") {
      await loadHabit(identity, habitMatch[1], env);
      await rpc("persora_habit_delete", { p_owner: identity.id, p_id: habitMatch[1] }, env);
      return json({ ok: true }, 200, origin);
    }
    return json({ error: "Habit Tracker route not found." }, 404, origin);
  } catch (error) {
    if (error instanceof HabitValidationError) return json({ error: error.message, field: error.field || undefined }, 400, origin);
    if (error instanceof HabitError) return json({ error: error.message }, error.status, origin);
    throw error;
  }
}
