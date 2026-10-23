// Persora Calendar — Pages API routes and the reminder dispatcher.
//
// Every route runs for the signed-in member only (api.js authorizes first) and
// every database call passes that member's id, which the SQL functions in
// supabase/migrations/202610250001_calendar.sql use to scope each statement.
// Input is validated here with the shared rules (cloudflare/calendar-rules.js)
// and again by table constraints.
//
// Reminders: the API computes each event's next reminder when it is saved and
// stores it in calendar_reminders. dispatchCalendarReminders() claims due rows
// (SKIP LOCKED), delivers them — in-app (the row itself, polled by the app) and
// by email when requested — then schedules the series' next occurrence. It is
// triggered by pg_cron/pg_net, by POST /internal/calendar-reminders, after
// signed-in requests (throttled) and whenever the app polls reminders.

import {
  CALENDAR_LIMITS, CalendarValidationError, REMINDER_PRESETS, addDays, daysBetween, eventAnchor, exceptionKey, isDateString,
  isOccurrenceOf, isoInstant, localDateOf, nextReminder, normalizeEventInput, occurrenceOn, reminderDedupeKey, safeTimeZone,
} from "./calendar-rules.js";

export const CALENDAR_ROUTE_PREFIX = "/calendar";
const DISPATCH_INTERVAL_MS = 60_000;
const REMINDER_LIST_WINDOW_MS = 7 * 86_400_000;
const REMINDER_LOOKAHEAD_MS = 10 * 60_000;
const LATE_EMAIL_MS = 15 * 60_000;
const EVENT_COLUMNS = "id,user_id,series_id,original_start_at,original_start_date,status,title,description,location,category,all_day,time_zone,start_at,end_at,start_date,end_date,recurrence_freq,recurrence_interval,recurrence_until,recurrence_count,reminder_minutes,reminder_email,source,revision,created_at,updated_at";
const REMINDER_COLUMNS = "id,event_id,root_id,occurrence_key,occurrence_start,occurrence_date,all_day,remind_at,minutes_before,title,location,status,email_requested,email_status,email_note,read_at";

export class CalendarError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------------------
// HTTP + database plumbing (same conventions as the other feature modules)
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
async function dbFetch(path, env, init = {}) {
  return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) });
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new CalendarError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "23514" || code === "22007" || code === "22008") return new CalendarError("Those event details aren't valid. Check the dates and try again.", 400);
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") {
    return new CalendarError("Calendar needs its database migration (202610250001_calendar.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora Calendar database request failed", response.status, code, message);
  return new CalendarError("The calendar database could not complete the request. Please try again shortly.", 502);
}
async function rpc(name, args, env) {
  const response = await dbFetch(`rpc/${name}`, env, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}
async function listRows(path, env) {
  const response = await dbFetch(path, env);
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new CalendarError("The calendar service received an invalid response.", 502);
  return rows;
}
async function readBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new CalendarError("Send the event as JSON.", 415);
  const text = await request.text();
  if (text.length > 64 * 1024) throw new CalendarError("That request is too large.", 413);
  try { return JSON.parse(text || "{}"); } catch { throw new CalendarError("The request body isn't valid JSON.", 400); }
}
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Row <-> API shapes
// ---------------------------------------------------------------------------

const dateOnly = (value) => (value ? String(value).slice(0, 10) : null);
const instant = (value) => (value ? isoInstant(value) : null);

/** Database row → API event (camelCase, canonical ISO instants). */
export function eventFromRow(row) {
  return {
    id: row.id,
    seriesId: row.series_id || null,
    originalStartAt: instant(row.original_start_at),
    originalStartDate: dateOnly(row.original_start_date),
    status: row.status === "cancelled" ? "cancelled" : "confirmed",
    title: row.title,
    description: row.description || "",
    location: row.location || "",
    category: row.category || null,
    allDay: Boolean(row.all_day),
    timeZone: row.time_zone,
    startAt: instant(row.start_at),
    endAt: instant(row.end_at),
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    recurrence: row.recurrence_freq ? {
      freq: row.recurrence_freq,
      interval: Number(row.recurrence_interval) || 1,
      until: dateOnly(row.recurrence_until),
      count: row.recurrence_count === null || row.recurrence_count === undefined ? null : Number(row.recurrence_count),
    } : null,
    reminderMinutes: row.reminder_minutes === null || row.reminder_minutes === undefined ? null : Number(row.reminder_minutes),
    reminderEmail: Boolean(row.reminder_email),
    source: row.source || "persora",
    revision: Number(row.revision) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Normalized input → the JSON the SQL functions read. */
function eventValues(normalized) {
  return {
    title: normalized.title, description: normalized.description, location: normalized.location, category: normalized.category,
    all_day: normalized.allDay, time_zone: normalized.timeZone, start_at: normalized.startAt, end_at: normalized.endAt,
    start_date: normalized.startDate, end_date: normalized.endDate,
    recurrence_freq: normalized.recurrence?.freq || null, recurrence_interval: normalized.recurrence?.interval || 1,
    recurrence_until: normalized.recurrence?.until || null, recurrence_count: normalized.recurrence?.count || null,
    reminder_minutes: normalized.reminderMinutes, reminder_email: normalized.reminderEmail,
  };
}

/** API-shaped event built from normalized input (for reminder computations before saving). */
function draftEvent(id, normalized, extra = {}) {
  return { id, seriesId: null, originalStartAt: null, originalStartDate: null, status: "confirmed", ...normalized, ...extra };
}

/** The payload persora_calendar_set_reminder expects, or null. */
export function reminderPayload(event, rootId, next) {
  if (!next) return null;
  return {
    occurrence_key: next.occurrenceKey,
    occurrence_start: next.occurrenceStart,
    occurrence_date: next.occurrenceDate,
    all_day: next.allDay,
    remind_at: next.remindAt,
    minutes_before: event.reminderMinutes,
    title: event.title,
    location: event.location || "",
    email: Boolean(event.reminderEmail),
    dedupe_key: reminderDedupeKey(rootId, next.occurrenceKey, next.remindAt),
  };
}

function reminderFromRow(row, now) {
  return {
    id: row.id,
    eventId: row.event_id,
    seriesId: row.root_id === row.event_id ? null : row.root_id,
    occurrenceKey: row.occurrence_key,
    occurrenceStart: instant(row.occurrence_start),
    occurrenceDate: dateOnly(row.occurrence_date),
    allDay: Boolean(row.all_day),
    remindAt: isoInstant(row.remind_at),
    minutesBefore: Number(row.minutes_before),
    title: row.title,
    location: row.location || "",
    status: row.status,
    due: Date.parse(row.remind_at) <= now,
    emailRequested: Boolean(row.email_requested),
    emailStatus: row.email_status,
    emailNote: row.email_note || null,
    readAt: row.read_at || null,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function loadEvent(identity, id, env) {
  if (!isUuid(id)) throw new CalendarError("That event is no longer in your calendar.", 404);
  const rows = await listRows(`calendar_events?id=eq.${enc(id)}&user_id=eq.${enc(identity.id)}&select=${EVENT_COLUMNS}&limit=1`, env);
  if (!rows.length) throw new CalendarError("That event is no longer in your calendar.", 404);
  return eventFromRow(rows[0]);
}
async function loadExceptions(ownerId, seriesId, env) {
  const rows = await listRows(`calendar_events?series_id=eq.${enc(seriesId)}&user_id=eq.${enc(ownerId)}&select=${EVENT_COLUMNS}&limit=2000`, env);
  return rows.map(eventFromRow);
}
const overriddenKeys = (exceptions) => new Set(exceptions.map(exceptionKey).filter(Boolean));

function parseRange(url) {
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!isDateString(from) || !isDateString(to)) throw new CalendarError("Choose a valid date range.", 400);
  const span = daysBetween(from, to);
  if (span < 1 || span > CALENDAR_LIMITS.rangeMaxDays) throw new CalendarError(`Load between 1 and ${CALENDAR_LIMITS.rangeMaxDays} days at a time.`, 400);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const PROPAGATED_FIELDS = [
  ["title", "title"], ["description", "description"], ["location", "location"], ["category", "category"],
  ["reminderMinutes", "reminder_minutes"], ["reminderEmail", "reminder_email"],
];

/** Did the start, zone or repetition of a series change (which re-numbers its occurrences)? */
export function seriesTimingChanged(previous, next) {
  if (!previous.recurrence) return Boolean(next.recurrence);
  if (!next.recurrence) return true;
  if (previous.allDay !== next.allDay || previous.timeZone !== next.timeZone) return true;
  const a = eventAnchor(previous); const b = eventAnchor(next);
  if (a.date !== b.date || a.time !== b.time) return true;
  const p = previous.recurrence; const n = next.recurrence;
  return p.freq !== n.freq || p.interval !== n.interval || (p.until || null) !== (n.until || null) || (p.count || null) !== (n.count || null);
}

/**
 * Field changes on the series flow into exceptions that still had the old
 * series value (e.g. renaming the series renames moved occurrences too, but a
 * title changed on one occurrence is kept). Each patched exception gets its
 * reminder recomputed.
 */
export function exceptionPatches(previous, next, exceptions, now) {
  const patches = [];
  for (const exception of exceptions) {
    const patch = { id: exception.id };
    const patched = { ...exception };
    let reminderChanged = false;
    for (const [field, column] of PROPAGATED_FIELDS) {
      const before = previous[field] ?? null; const after = next[field] ?? null;
      if (before === after || (exception[field] ?? null) !== before) continue;
      patch[column] = after;
      patched[field] = after;
      if (field === "reminderMinutes" || field === "reminderEmail" || field === "title" || field === "location") reminderChanged = true;
    }
    if (Object.keys(patch).length === 1) continue;
    if (patched.reminderMinutes === null) patched.reminderEmail = false;
    if (reminderChanged && exception.status !== "cancelled") {
      patch.reminder = reminderPayload(patched, next.id, nextReminder(patched, now));
    }
    patches.push(patch);
  }
  return patches;
}

async function createEvent(identity, body, env) {
  const zone = safeTimeZone(identity.timezone, "UTC");
  const normalized = normalizeEventInput(body?.event, { defaultTimeZone: zone });
  const id = crypto.randomUUID();
  const draft = draftEvent(id, normalized);
  const result = await rpc("persora_calendar_save_event", {
    p_owner: identity.id, p_id: id, p_event: eventValues(normalized), p_expected_revision: null, p_reset_exceptions: false,
    p_reminder: reminderPayload(draft, id, nextReminder(draft, Date.now())), p_exception_patches: [],
  }, env);
  return { event: eventFromRow(result.event), exceptions: [] };
}

async function updateEvent(identity, id, body, env) {
  const existing = await loadEvent(identity, id, env);
  const scope = body?.scope === "occurrence" ? "occurrence" : "series";
  const expectedRevision = body?.expectedRevision === undefined || body?.expectedRevision === null ? null : Number(body.expectedRevision);
  const zone = safeTimeZone(identity.timezone, "UTC");
  const now = Date.now();

  if (existing.seriesId || (existing.recurrence && scope === "occurrence")) {
    // One occurrence of a series: create or update its exception row.
    const series = existing.seriesId ? await loadEvent(identity, existing.seriesId, env) : existing;
    let originalKey;
    if (existing.seriesId) {
      if (scope !== "occurrence") throw new CalendarError("To change every occurrence, edit the recurring event itself.", 400);
      originalKey = exceptionKey(existing);
    } else {
      originalKey = String(body?.occurrenceKey || "");
      if (!isOccurrenceOf(series, originalKey)) throw new CalendarError("That occurrence isn't part of this recurring event any more. Reload the calendar.", 409);
      if (!series.allDay) originalKey = isoInstant(originalKey);
    }
    const normalized = normalizeEventInput(body?.event, { defaultTimeZone: series.timeZone || zone, allowRecurrence: false });
    const exceptions = await loadExceptions(identity.id, series.id, env);
    const current = exceptions.find((entry) => exceptionKey(entry) === originalKey);
    const exceptionId = current?.id || crypto.randomUUID();
    const draft = draftEvent(exceptionId, normalized, {
      seriesId: series.id,
      originalStartAt: series.allDay ? null : originalKey,
      originalStartDate: series.allDay ? originalKey : null,
    });
    const keys = overriddenKeys(exceptions); keys.add(originalKey);
    const result = await rpc("persora_calendar_save_occurrence", {
      p_owner: identity.id, p_series_id: series.id, p_exception_id: exceptionId,
      p_original_start_at: series.allDay ? null : originalKey, p_original_start_date: series.allDay ? originalKey : null,
      p_status: "confirmed", p_event: eventValues(normalized),
      p_expected_revision: current ? (existing.seriesId ? expectedRevision : current.revision) : null,
      p_reminder: reminderPayload(draft, series.id, nextReminder(draft, now)),
      p_series_reminder: reminderPayload(series, series.id, nextReminder(series, now, keys)),
    }, env);
    return { event: eventFromRow(result.event), series: eventFromRow(result.series) };
  }

  // A single event or a whole series.
  const normalized = normalizeEventInput(body?.event, { defaultTimeZone: existing.timeZone || zone });
  const next = draftEvent(existing.id, normalized);
  const exceptions = existing.recurrence ? await loadExceptions(identity.id, existing.id, env) : [];
  const reset = existing.recurrence ? seriesTimingChanged(existing, next) : false;
  const remaining = reset || !next.recurrence ? [] : exceptions;
  const result = await rpc("persora_calendar_save_event", {
    p_owner: identity.id, p_id: existing.id, p_event: eventValues(normalized), p_expected_revision: expectedRevision,
    p_reset_exceptions: reset || (Boolean(existing.recurrence) && !next.recurrence),
    p_reminder: reminderPayload(next, existing.id, nextReminder(next, now, overriddenKeys(remaining))),
    p_exception_patches: remaining.length ? exceptionPatches(existing, next, remaining, now) : [],
  }, env);
  return { event: eventFromRow(result.event), exceptions: (result.exceptions || []).map(eventFromRow), exceptionsReset: reset && exceptions.length > 0 };
}

async function deleteEvent(identity, id, url, env) {
  const existing = await loadEvent(identity, id, env);
  const scope = url.searchParams.get("scope") === "occurrence" ? "occurrence" : "series";
  const revisionParam = url.searchParams.get("revision");
  const expectedRevision = revisionParam && /^\d+$/.test(revisionParam) ? Number(revisionParam) : null;
  const now = Date.now();

  if (scope === "occurrence" && (existing.recurrence || existing.seriesId)) {
    const series = existing.seriesId ? await loadEvent(identity, existing.seriesId, env) : existing;
    let originalKey;
    let timing;
    if (existing.seriesId) {
      originalKey = exceptionKey(existing);
      timing = existing;
    } else {
      originalKey = String(url.searchParams.get("occurrenceKey") || "");
      if (!isOccurrenceOf(series, originalKey)) throw new CalendarError("That occurrence isn't part of this recurring event any more. Reload the calendar.", 409);
      if (!series.allDay) originalKey = isoInstant(originalKey);
      const localDate = series.allDay ? originalKey : localDateOf(Date.parse(originalKey), safeTimeZone(series.timeZone));
      const occurrence = occurrenceOn(series, localDate);
      timing = occurrence.allDay
        ? { ...series, startAt: null, endAt: null, startDate: occurrence.startDate, endDate: occurrence.endDate }
        : { ...series, startAt: new Date(occurrence.startMs).toISOString(), endAt: new Date(occurrence.endMs).toISOString(), startDate: null, endDate: null };
    }
    const exceptions = await loadExceptions(identity.id, series.id, env);
    const keys = overriddenKeys(exceptions); keys.add(originalKey);
    await rpc("persora_calendar_save_occurrence", {
      p_owner: identity.id, p_series_id: series.id, p_exception_id: existing.seriesId ? existing.id : crypto.randomUUID(),
      p_original_start_at: series.allDay ? null : originalKey, p_original_start_date: series.allDay ? originalKey : null,
      p_status: "cancelled",
      p_event: eventValues({ ...timing, recurrence: null }),
      p_expected_revision: existing.seriesId ? expectedRevision : null,
      p_reminder: null,
      p_series_reminder: reminderPayload(series, series.id, nextReminder(series, now, keys)),
    }, env);
    return { ok: true, scope: "occurrence", seriesId: series.id, occurrenceKey: originalKey };
  }

  const target = existing.seriesId ? existing.seriesId : existing.id;
  await rpc("persora_calendar_delete_event", { p_owner: identity.id, p_id: target, p_expected_revision: existing.seriesId ? null : expectedRevision }, env);
  return { ok: true, scope: "series", id: target };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

function emailAvailability(identity, services) {
  if (!services?.emailConfigured?.()) return { available: false, reason: "Email reminders aren't set up on this Persora server yet." };
  if (!identity.email_verified_at) return { available: false, reason: "Verify your email address in Settings to get reminders by email." };
  return { available: true, reason: null };
}

async function listReminders(identity, env) {
  const now = Date.now();
  const since = new Date(now - REMINDER_LIST_WINDOW_MS).toISOString();
  const until = new Date(now + REMINDER_LOOKAHEAD_MS).toISOString();
  const rows = await listRows(
    `calendar_reminders?user_id=eq.${enc(identity.id)}&status=in.(scheduled,processing,sent)&remind_at=gte.${enc(since)}&remind_at=lte.${enc(until)}&select=${REMINDER_COLUMNS}&order=remind_at.desc&limit=60`,
    env,
  );
  return { reminders: rows.map((row) => reminderFromRow(row, now)), serverTime: new Date(now).toISOString() };
}

async function markRemindersRead(identity, id, env) {
  const filter = id
    ? `id=eq.${enc(id)}&user_id=eq.${enc(identity.id)}`
    : `user_id=eq.${enc(identity.id)}&read_at=is.null&remind_at=lte.${enc(new Date().toISOString())}`;
  const response = await dbFetch(`calendar_reminders?${filter}`, env, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ read_at: new Date().toISOString() }),
  });
  if (!response.ok) throw await databaseError(response);
  return { ok: true };
}

const MINUTE_LABELS = { 5: "5 minutes", 15: "15 minutes", 30: "30 minutes", 60: "1 hour", 1440: "1 day" };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
/** Reminder email (plain text + simple HTML) in the member's time zone. */
export function reminderEmail(reminder, owner, appUrl) {
  const zone = safeTimeZone(owner.timezone, "UTC");
  const when = reminder.all_day
    ? `${new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(reminder.occurrence_date).slice(0, 10)}T00:00:00Z`))} · all day`
    : `${new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(reminder.occurrence_start))} (${zone.replace(/_/g, " ")})`;
  const lead = MINUTE_LABELS[reminder.minutes_before] || `${reminder.minutes_before} minutes`;
  const lines = [reminder.title, when];
  if (reminder.location) lines.push(reminder.location);
  lines.push("", `You asked Persora to remind you ${lead} before${reminder.all_day ? " (reminders for all-day events are timed from 9:00 AM)" : ""}.`);
  if (appUrl) lines.push(`Open your calendar: ${appUrl}`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.5">
<p style="margin:0 0 4px;font-size:13px;color:#5f6368">Persora Calendar reminder</p>
<h2 style="margin:0 0 6px;font-size:18px">${escapeHtml(reminder.title)}</h2>
<p style="margin:0">${escapeHtml(when)}</p>${reminder.location ? `<p style="margin:0;color:#5f6368">${escapeHtml(reminder.location)}</p>` : ""}
<p style="margin:14px 0 0;font-size:13px;color:#5f6368">You asked to be reminded ${escapeHtml(lead)} before.</p>${appUrl ? `<p style="margin:14px 0 0"><a href="${escapeHtml(appUrl)}" style="color:#1a73e8">Open your calendar</a></p>` : ""}
</div>`;
  return {
    to: owner.email, toName: owner.full_name,
    subject: `Reminder: ${reminder.title} — ${when}`.slice(0, 200),
    textContent: lines.join("\n"), htmlContent: html,
  };
}

/**
 * Delivers due reminders. Safe to run concurrently and repeatedly: claims are
 * exclusive, completion requires the same claim, emails are sent at most once.
 */
export async function dispatchCalendarReminders(env, services = {}, { owner = null, limit = 50, appUrl = "" } = {}) {
  const claimed = await rpc("persora_calendar_claim_reminders", { p_limit: limit, p_owner: owner }, env);
  const summary = { claimed: 0, emailed: 0, emailFailed: 0, emailSkipped: 0 };
  for (const entry of Array.isArray(claimed) ? claimed : []) {
    const reminder = entry.reminder; const row = entry.event; const person = entry.owner || {};
    summary.claimed += 1;
    let emailStatus = reminder.email_status === "failed" ? "failed" : "not_requested";
    let emailNote = null;
    if (reminder.email_status === "sending") {
      const now = Date.now();
      const startsAt = reminder.occurrence_start ? Date.parse(reminder.occurrence_start) : Date.parse(`${String(reminder.occurrence_date).slice(0, 10)}T23:59:59Z`);
      if (!person.active) { emailStatus = "skipped"; emailNote = "The account isn't active."; }
      else if (!person.email_verified) { emailStatus = "skipped"; emailNote = "The email address isn't verified."; }
      else if (now - Date.parse(reminder.remind_at) > LATE_EMAIL_MS && now >= startsAt) { emailStatus = "skipped"; emailNote = "The reminder was processed after the event started."; }
      else if (typeof services.sendEmail !== "function" || !services.emailConfigured?.()) { emailStatus = "skipped"; emailNote = "Email delivery isn't configured."; }
      else {
        try {
          await services.sendEmail(reminderEmail(reminder, person, appUrl));
          emailStatus = "sent";
        } catch (error) {
          emailStatus = "failed";
          emailNote = String(error?.message || "Email delivery failed.").slice(0, 200);
        }
      }
      if (emailStatus === "sent") summary.emailed += 1;
      else if (emailStatus === "failed") summary.emailFailed += 1;
      else summary.emailSkipped += 1;
    }
    let next = null;
    try {
      const event = eventFromRow(row);
      if (event.recurrence && !event.seriesId) {
        const keys = overriddenKeys(await loadExceptions(row.user_id, event.id, env));
        next = reminderPayload(event, event.id, nextReminder(event, Date.parse(reminder.remind_at), keys));
      }
    } catch (error) {
      console.error("Persora Calendar could not schedule the next reminder", error?.message || error);
    }
    await rpc("persora_calendar_complete_reminder", {
      p_id: reminder.id, p_claimed_at: reminder.claimed_at, p_email_status: emailStatus, p_email_note: emailNote,
      p_event_revision: row.revision, p_next: next,
    }, env);
  }
  return summary;
}

/**
 * Calendar data for the complete account export: every event row the member owns
 * (single events, series and their exceptions, including cancelled occurrences)
 * and their reminder rows. Returns empty lists, not an error, when the calendar
 * migration hasn't been applied yet, so the rest of the backup still works.
 */
export async function exportCalendarData(userId, env, pageSize = 1000) {
  const owner = encodeURIComponent(userId);
  const paged = async (path) => {
    const rows = [];
    for (let start = 0; ; start += pageSize) {
      const response = await dbFetch(path, env, { headers: { Range: `${start}-${start + pageSize - 1}` } });
      if (!response.ok) throw await databaseError(response);
      const page = await response.json();
      if (!Array.isArray(page)) throw new CalendarError("The calendar service received an invalid response.", 502);
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  };
  try {
    const [events, reminders] = await Promise.all([
      paged(`calendar_events?user_id=eq.${owner}&select=${EVENT_COLUMNS}&order=created_at.asc,id.asc`),
      paged(`calendar_reminders?user_id=eq.${owner}&select=${REMINDER_COLUMNS},created_at&order=remind_at.asc,id.asc`),
    ]);
    return { events, reminders };
  } catch (error) {
    if (error instanceof CalendarError && error.status === 503) return { events: [], reminders: [] };
    throw error;
  }
}

let lastBackgroundDispatch = 0;
/** Opportunistic dispatch after signed-in requests (at most once a minute per isolate). */
export function scheduleCalendarDispatch(env, ctx, services, appUrl = "") {
  if (Date.now() - lastBackgroundDispatch < DISPATCH_INTERVAL_MS) return;
  lastBackgroundDispatch = Date.now();
  const work = dispatchCalendarReminders(env, services, { limit: 50, appUrl }).catch((error) => {
    console.error("Persora Calendar reminder dispatch failed", error?.message || error);
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleCalendar(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;
  const appUrl = `${url.origin}/?view=calendar`;
  try {
    if (path === "/calendar/meta" && method === "GET") {
      return json({
        timeZone: safeTimeZone(identity.timezone, "UTC"),
        email: emailAvailability(identity, services),
        reminderPresets: REMINDER_PRESETS,
        limits: CALENDAR_LIMITS,
      }, 200, origin);
    }
    if (path === "/calendar/events" && method === "GET") {
      const { from, to } = parseRange(url);
      const fromMs = Date.parse(`${from}T00:00:00Z`) - 2 * 86_400_000;
      const toMs = Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000;
      const rows = await rpc("persora_calendar_events_in_range", {
        p_owner: identity.id, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString(),
        p_from_date: addDays(from, -1), p_to_date: addDays(to, 1),
      }, env);
      return json({ events: (Array.isArray(rows) ? rows : []).map(eventFromRow), from, to }, 200, origin);
    }
    if (path === "/calendar/events/search" && method === "GET") {
      const query = String(url.searchParams.get("q") || "").trim();
      if (!query) return json({ events: [] }, 200, origin);
      if (query.length > CALENDAR_LIMITS.searchMax) throw new CalendarError(`Search for up to ${CALENDAR_LIMITS.searchMax} characters.`, 400);
      const rows = await rpc("persora_calendar_search", { p_owner: identity.id, p_query: query, p_limit: 30 }, env);
      return json({ events: (Array.isArray(rows) ? rows : []).map(eventFromRow) }, 200, origin);
    }
    if (path === "/calendar/events" && method === "POST") {
      return json(await createEvent(identity, await readBody(request), env), 201, origin);
    }
    const eventMatch = path.match(/^\/calendar\/events\/([^/]+)$/);
    if (eventMatch && method === "GET") {
      const event = await loadEvent(identity, eventMatch[1], env);
      const exceptions = event.recurrence ? await loadExceptions(identity.id, event.id, env) : [];
      return json({ event, exceptions }, 200, origin);
    }
    if (eventMatch && method === "PATCH") {
      return json(await updateEvent(identity, eventMatch[1], await readBody(request), env), 200, origin);
    }
    if (eventMatch && method === "DELETE") {
      return json(await deleteEvent(identity, eventMatch[1], url, env), 200, origin);
    }
    if (path === "/calendar/reminders" && method === "GET") {
      // Deliver this member's due reminders first (email + next occurrence), so
      // the app never depends on a background scheduler having run.
      try { await dispatchCalendarReminders(env, services, { owner: identity.id, limit: 20, appUrl }); }
      catch (error) { console.error("Persora Calendar member dispatch failed", error?.message || error); }
      return json(await listReminders(identity, env), 200, origin);
    }
    if (path === "/calendar/reminders" && method === "PATCH") {
      return json(await markRemindersRead(identity, null, env), 200, origin);
    }
    const reminderMatch = path.match(/^\/calendar\/reminders\/([^/]+)$/);
    if (reminderMatch && method === "PATCH") {
      if (!isUuid(reminderMatch[1])) throw new CalendarError("That reminder is no longer available.", 404);
      return json(await markRemindersRead(identity, reminderMatch[1], env), 200, origin);
    }
    return json({ error: "Calendar route not found." }, 404, origin);
  } catch (error) {
    if (error instanceof CalendarValidationError) return json({ error: error.message, field: error.field || undefined }, 400, origin);
    if (error instanceof CalendarError) return json({ error: error.message, ...error.extra }, error.status, origin);
    throw error;
  }
}
