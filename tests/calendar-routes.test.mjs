// Calendar Pages API routes + reminder dispatcher, against a mocked PostgREST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCalendarReminders, exceptionPatches, exportCalendarData, handleCalendar, reminderEmail, seriesTimingChanged, eventFromRow } from '../cloudflare/calendar.js';
import worker from '../cloudflare/api.js';

const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const OTHER = '9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b';
const SERIES = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const EXC = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ORIGIN = 'https://persora.example';
const identity = { id: OWNER, email: 'me@example.test', timezone: 'Asia/Dhaka', email_verified_at: '2026-01-01T00:00:00Z' };
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };

const seriesRow = (overrides = {}) => ({
  id: SERIES, user_id: OWNER, series_id: null, original_start_at: null, original_start_date: null, status: 'confirmed',
  title: 'Standup', description: '', location: '', category: 'work', all_day: false, time_zone: 'Asia/Dhaka',
  start_at: '2026-11-16T03:00:00+00:00', end_at: '2026-11-16T03:15:00+00:00', start_date: null, end_date: null,
  recurrence_freq: 'daily', recurrence_interval: 1, recurrence_until: null, recurrence_count: 10,
  reminder_minutes: 15, reminder_email: false, source: 'persora', revision: 3, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});
const exceptionRow = (overrides = {}) => seriesRow({
  id: EXC, series_id: SERIES, original_start_at: '2026-11-17T03:00:00+00:00', recurrence_freq: null, recurrence_count: null,
  start_at: '2026-11-17T05:00:00+00:00', end_at: '2026-11-17T05:15:00+00:00', revision: 1, ...overrides,
});

function mockDatabase({ rows = [], rpc = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      if (rpc[name]) return rpc[name](body);
      return Response.json(null);
    }
    if (url.pathname === '/rest/v1/calendar_events') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      const seriesId = url.searchParams.get('series_id')?.replace('eq.', '');
      const owner = url.searchParams.get('user_id')?.replace('eq.', '');
      return Response.json(rows.filter((row) => row.user_id === owner && (!id || row.id === id) && (!seriesId || row.series_id === seriesId)));
    }
    return Response.json([]);
  };
  return calls;
}
const request = (method, path, body) => new Request(`${ORIGIN}/api${path}`, {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const call = async (method, path, body, who = identity, services = {}) => {
  const response = await handleCalendar(request(method, path, body), who, env, ORIGIN, services);
  return { status: response.status, body: await response.json() };
};
const rpcCalls = (calls, name) => calls.filter((entry) => entry.url.pathname.endsWith(`/rpc/${name}`));
const timed = (title, date, from, to, extra = {}) => ({ title, allDay: false, start: { date, time: from }, end: { date, time: to }, ...extra });

test('validation errors return 400 before touching the database', async () => {
  const calls = mockDatabase();
  let result = await call('POST', '/calendar/events', { event: timed('', '2026-11-01', '10:00', '11:00') });
  assert.equal(result.status, 400); assert.equal(result.body.field, 'title');
  result = await call('POST', '/calendar/events', { event: timed('X', '2026-11-01', '10:00', '09:00') });
  assert.equal(result.status, 400); assert.match(result.body.error, /before the start/);
  result = await call('GET', '/calendar/events?from=2026-01-01&to=2026-06-01');
  assert.equal(result.status, 400);
  result = await call('GET', '/calendar/events?from=nope&to=2026-06-01');
  assert.equal(result.status, 400);
  const raw = await handleCalendar(new Request(`${ORIGIN}/api/calendar/events`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } }), identity, env, ORIGIN);
  assert.equal(raw.status, 415);
  assert.equal(calls.length, 0);
});

test('create uses the signed-in owner, a server id and a computed reminder', async () => {
  const calls = mockDatabase({ rpc: { persora_calendar_save_event: (body) => Response.json({ event: { ...seriesRow(), id: body.p_id, recurrence_freq: null, title: body.p_event.title }, exceptions: [] }) } });
  const result = await call('POST', '/calendar/events', { event: { ...timed('Dentist', '2027-02-10', '16:00', '16:45'), reminderMinutes: 60, user_id: OTHER, id: SERIES } });
  assert.equal(result.status, 201);
  const [save] = rpcCalls(calls, 'persora_calendar_save_event');
  assert.equal(save.body.p_owner, OWNER);
  assert.notEqual(save.body.p_id, SERIES);
  assert.equal(save.body.p_event.start_at, '2027-02-10T10:00:00.000Z');
  assert.equal(save.body.p_event.time_zone, 'Asia/Dhaka', 'defaults to the profile time zone');
  assert.equal(save.body.p_reminder.remind_at, '2027-02-10T09:00:00.000Z');
  assert.equal(save.body.p_reminder.dedupe_key.length > 10, true);
});

test('events in range pads the window and scopes to the owner', async () => {
  const calls = mockDatabase({ rpc: { persora_calendar_events_in_range: () => Response.json([seriesRow()]) } });
  const result = await call('GET', '/calendar/events?from=2026-11-15&to=2026-11-22');
  assert.equal(result.status, 200);
  assert.equal(result.body.events[0].recurrence.freq, 'daily');
  assert.equal(result.body.events[0].startAt, '2026-11-16T03:00:00.000Z');
  const [range] = rpcCalls(calls, 'persora_calendar_events_in_range');
  assert.equal(range.body.p_owner, OWNER);
  assert.equal(range.body.p_from_date, '2026-11-14');
  assert.equal(range.body.p_to_date, '2026-11-23');
});

test('another member\'s event is a 404 (lookups are filtered by owner)', async () => {
  mockDatabase({ rows: [seriesRow({ user_id: OTHER })] });
  assert.equal((await call('GET', `/calendar/events/${SERIES}`)).status, 404);
  assert.equal((await call('PATCH', `/calendar/events/${SERIES}`, { event: timed('X', '2026-11-16', '09:00', '09:15'), scope: 'series' })).status, 404);
  assert.equal((await call('DELETE', `/calendar/events/${SERIES}`)).status, 404);
  assert.equal((await call('GET', '/calendar/events/not-a-uuid')).status, 404);
});

test('editing one occurrence validates the key and saves an exception', async () => {
  const calls = mockDatabase({
    rows: [seriesRow()],
    rpc: { persora_calendar_save_occurrence: (body) => Response.json({ event: exceptionRow({ id: body.p_exception_id }), series: seriesRow() }) },
  });
  const bad = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'occurrence', occurrenceKey: '2026-11-17T04:00:00.000Z', event: timed('Moved', '2026-11-17', '11:00', '11:15') });
  assert.equal(bad.status, 409);
  const ok = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'occurrence', occurrenceKey: '2026-11-17T03:00:00.000Z', event: { ...timed('Moved', '2026-11-17', '11:00', '11:15'), recurrence: { freq: 'daily' } } });
  assert.equal(ok.status, 200);
  const [save] = rpcCalls(calls, 'persora_calendar_save_occurrence');
  assert.equal(save.body.p_series_id, SERIES);
  assert.equal(save.body.p_original_start_at, '2026-11-17T03:00:00.000Z');
  assert.equal(save.body.p_event.recurrence_freq, null);
  assert.equal(save.body.p_status, 'confirmed');
  // The series reminder skips the overridden occurrence.
  assert.notEqual(save.body.p_series_reminder?.occurrence_key, '2026-11-17T03:00:00.000Z');
});

test('series edits: timing changes reset exceptions, field changes propagate to matching exceptions', async () => {
  const calls = mockDatabase({
    rows: [seriesRow(), exceptionRow(), exceptionRow({ id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60', original_start_at: '2026-11-18T03:00:00+00:00', start_at: '2026-11-18T05:00:00+00:00', end_at: '2026-11-18T05:15:00+00:00', title: 'Custom title' })],
    rpc: { persora_calendar_save_event: () => Response.json({ event: seriesRow({ revision: 4 }), exceptions: [] }) },
  });
  const retitle = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'series', expectedRevision: 3, event: { ...timed('Daily standup', '2026-11-16', '09:00', '09:15'), recurrence: { freq: 'daily', count: 10 }, reminderMinutes: 15, category: 'work' } });
  assert.equal(retitle.status, 200);
  let [save] = rpcCalls(calls, 'persora_calendar_save_event');
  assert.equal(save.body.p_reset_exceptions, false);
  assert.equal(save.body.p_expected_revision, 3);
  assert.equal(save.body.p_exception_patches.length, 1, 'only the exception that still had the series title');
  assert.equal(save.body.p_exception_patches[0].id, EXC);
  assert.equal(save.body.p_exception_patches[0].title, 'Daily standup');
  assert.ok('reminder' in save.body.p_exception_patches[0]);

  calls.length = 0;
  const moved = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'series', expectedRevision: 3, event: { ...timed('Standup', '2026-11-16', '09:30', '09:45'), recurrence: { freq: 'daily', count: 10 }, reminderMinutes: 15, category: 'work' } });
  assert.equal(moved.status, 200);
  [save] = rpcCalls(calls, 'persora_calendar_save_event');
  assert.equal(save.body.p_reset_exceptions, true);
  assert.equal(save.body.p_exception_patches.length, 0);
  assert.equal(moved.body.exceptionsReset, true);
});

test('deleting one occurrence stores a cancelled exception; deleting an exception\'s series deletes the master', async () => {
  const calls = mockDatabase({
    rows: [seriesRow(), exceptionRow()],
    rpc: { persora_calendar_save_occurrence: () => Response.json({ event: exceptionRow({ status: 'cancelled' }), series: seriesRow() }), persora_calendar_delete_event: () => Response.json({ ok: true }) },
  });
  const one = await call('DELETE', `/calendar/events/${SERIES}?scope=occurrence&occurrenceKey=${encodeURIComponent('2026-11-19T03:00:00.000Z')}`);
  assert.equal(one.status, 200);
  const [cancel] = rpcCalls(calls, 'persora_calendar_save_occurrence');
  assert.equal(cancel.body.p_status, 'cancelled');
  assert.equal(cancel.body.p_event.start_at, '2026-11-19T03:00:00.000Z');
  assert.equal(cancel.body.p_reminder, null);
  const all = await call('DELETE', `/calendar/events/${EXC}?scope=series`);
  assert.equal(all.status, 200);
  const [remove] = rpcCalls(calls, 'persora_calendar_delete_event');
  assert.equal(remove.body.p_id, SERIES);
  assert.equal(remove.body.p_owner, OWNER);
});

test('database errors map to clear statuses (stale revision, missing migration)', async () => {
  mockDatabase({ rows: [seriesRow({ recurrence_freq: null, recurrence_count: null })], rpc: { persora_calendar_save_event: () => Response.json({ code: 'P0409', message: 'This event was changed elsewhere. Reload and try again.' }, { status: 400 }) } });
  const stale = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'series', expectedRevision: 1, event: timed('X', '2026-11-16', '09:00', '09:15') });
  assert.equal(stale.status, 409);
  mockDatabase({ rpc: { persora_calendar_events_in_range: () => Response.json({ code: 'PGRST202', message: 'missing' }, { status: 404 }) } });
  const missing = await call('GET', '/calendar/events?from=2026-11-01&to=2026-11-08');
  assert.equal(missing.status, 503);
  assert.match(missing.body.error, /migration/);
});

test('meta explains email availability', async () => {
  mockDatabase();
  assert.deepEqual((await call('GET', '/calendar/meta', null, identity, { emailConfigured: () => false })).body.email.available, false);
  assert.match((await call('GET', '/calendar/meta', null, { ...identity, email_verified_at: null }, { emailConfigured: () => true })).body.email.reason, /Verify/);
  assert.equal((await call('GET', '/calendar/meta', null, identity, { emailConfigured: () => true })).body.email.available, true);
});

test('dispatcher: email once when allowed, skip when unverified/late, record failures, roll series forward', async () => {
  const now = Date.now();
  const alignedStart = Math.ceil(now / 60000) * 60000 + 15 * 60000;
  const due = (overrides = {}) => ({
    id: crypto.randomUUID(), event_id: SERIES, root_id: SERIES, occurrence_key: new Date(alignedStart).toISOString(), occurrence_start: new Date(alignedStart).toISOString(), occurrence_date: null,
    all_day: false, remind_at: new Date(now - 1000).toISOString(), minutes_before: 15, title: 'Standup <b>', location: 'Room 1', email_status: 'sending',
    claimed_at: '2026-11-16T02:45:00.123456+00:00', ...overrides,
  });
  const verified = { email: 'me@example.test', full_name: 'Me', timezone: 'Asia/Dhaka', email_verified: true, active: true };
  const rows = [
    { reminder: due(), event: seriesRow({ start_at: new Date(alignedStart).toISOString(), end_at: new Date(alignedStart + 15 * 60000).toISOString() }), owner: verified },
    { reminder: due(), event: seriesRow({ recurrence_freq: null, recurrence_count: null }), owner: { ...verified, email_verified: false } },
    { reminder: due({ remind_at: new Date(now - 60 * 60000).toISOString(), occurrence_start: new Date(now - 45 * 60000).toISOString() }), event: seriesRow({ recurrence_freq: null, recurrence_count: null }), owner: verified },
    { reminder: due({ email_status: 'not_requested' }), event: seriesRow({ recurrence_freq: null, recurrence_count: null }), owner: verified },
    { reminder: due(), event: seriesRow({ recurrence_freq: null, recurrence_count: null }), owner: { ...verified, email: 'broken@example.test' } },
  ];
  const calls = mockDatabase({ rows: [], rpc: { persora_calendar_claim_reminders: () => Response.json(rows), persora_calendar_complete_reminder: () => Response.json(true) } });
  const sent = [];
  const services = { emailConfigured: () => true, sendEmail: async (message) => { if (message.to === 'broken@example.test') throw new Error('Brevo rejected the message'); sent.push(message); } };
  const summary = await dispatchCalendarReminders(env, services, { limit: 10, appUrl: `${ORIGIN}/?view=calendar` });
  assert.deepEqual(summary, { claimed: 5, emailed: 1, emailFailed: 1, emailSkipped: 2 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Reminder: Standup <b>/);
  assert.ok(!sent[0].htmlContent.includes('<b>'), 'HTML-escaped');
  assert.match(sent[0].textContent, /view=calendar/);
  const completes = rpcCalls(calls, 'persora_calendar_complete_reminder').map((entry) => entry.body);
  assert.deepEqual(completes.map((body) => body.p_email_status), ['sent', 'skipped', 'skipped', 'not_requested', 'failed']);
  assert.equal(completes[0].p_claimed_at, '2026-11-16T02:45:00.123456+00:00', 'claim token passed back verbatim');
  assert.ok(completes[0].p_next, 'series schedules its next reminder');
  assert.ok(Date.parse(completes[0].p_next.remind_at) > now);
  assert.equal(completes[1].p_next, null, 'single events stop');
  assert.match(completes[4].p_email_note, /Brevo rejected/);
});

test('internal reminder endpoint is hidden without the configured token', async () => {
  mockDatabase({ rpc: { persora_calendar_claim_reminders: () => Response.json([]) } });
  const post = (token, extraEnv = {}) => worker.fetch(new Request(`${ORIGIN}/api/internal/calendar-reminders`, { method: 'POST', headers: token ? { 'x-persora-cron-token': token } : {} }), { ...env, ...extraEnv }, { waitUntil() {} });
  assert.equal((await post('anything')).status, 404, 'disabled when no token is configured');
  assert.equal((await post('wrong', { CALENDAR_REMINDER_TOKEN: 'secret-token' })).status, 404);
  const ok = await post('secret-token', { CALENDAR_REMINDER_TOKEN: 'secret-token' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).claimed, 0);
  const anonymous = await worker.fetch(new Request(`${ORIGIN}/api/calendar/events?from=2026-11-01&to=2026-11-08`), env, { waitUntil() {} });
  assert.equal(anonymous.status, 401);
});

test('helpers: timing change detection, patches and email formatting', () => {
  const series = eventFromRow(seriesRow());
  assert.equal(seriesTimingChanged(series, { ...series, title: 'New' }), false);
  assert.equal(seriesTimingChanged(series, { ...series, startAt: '2026-11-16T04:00:00.000Z', endAt: '2026-11-16T04:15:00.000Z' }), true);
  assert.equal(seriesTimingChanged(series, { ...series, recurrence: { ...series.recurrence, count: 20 } }), true);
  assert.equal(seriesTimingChanged(series, { ...series, endAt: '2026-11-16T03:30:00.000Z' }), false, 'duration-only change keeps exceptions');
  const patches = exceptionPatches(series, { ...series, reminderMinutes: null }, [eventFromRow(exceptionRow())], Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(patches[0].reminder_minutes, null);
  assert.equal(patches[0].reminder, null);
  const email = reminderEmail({ title: 'Trip', all_day: true, occurrence_date: '2026-12-24', minutes_before: 1440, location: '' }, { email: 'a@b.c', full_name: 'A', timezone: 'Asia/Dhaka' }, '');
  assert.match(email.subject, /Dec 24, 2026 · all day/);
  assert.match(email.textContent, /9:00 AM/);
});

test('account export: owner-scoped event and reminder rows; empty when the migration is missing', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    seen.push({ path: url.pathname, owner: url.searchParams.get('user_id'), select: url.searchParams.get('select'), range: new Headers(init.headers).get('Range'), auth: new Headers(init.headers).get('apikey') || new Headers(init.headers).get('Authorization') });
    if (url.pathname.endsWith('/calendar_events')) return new Response(JSON.stringify([{ id: 'e1', user_id: 'u1', title: 'Dentist' }, { id: 'e2', user_id: 'u1', series_id: 'e1', status: 'cancelled' }]), { status: 200 });
    if (url.pathname.endsWith('/calendar_reminders')) return new Response(JSON.stringify([{ id: 'r1', event_id: 'e1', status: 'sent' }]), { status: 200 });
    if (url.pathname.endsWith('/calendar_preferences')) return new Response(JSON.stringify([{ filters: { types: { task: false } }, updated_at: '2026-10-20T00:00:00Z' }]), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  const data = await exportCalendarData('u1', env);
  assert.deepEqual(data.events.map((row) => row.id), ['e1', 'e2'], 'exceptions and cancelled occurrences are kept');
  assert.deepEqual(data.reminders.map((row) => row.id), ['r1']);
  assert.deepEqual(data.preferences.filters, { types: { task: false } }, 'filter preferences are exported as saved');
  assert.ok(seen.find((call) => call.path.endsWith('/calendar_events')).select.includes('item_type,completed_at'), 'item type and completion are exported');
  assert.ok(seen.every((call) => call.owner === 'eq.u1'), 'every query is scoped to the member');
  assert.ok(seen.every((call) => call.range === '0-999'), 'paged');
  assert.ok(seen.every((call) => call.auth), 'server-side key only');
  assert.ok(!seen.find((call) => call.path.endsWith('/calendar_reminders')).select.includes('claim_token'), 'internal claim tokens are not exported');

  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: 404 });
  assert.deepEqual(await exportCalendarData('u1', env), { events: [], reminders: [], preferences: null });

  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'XX000', message: 'boom' }), { status: 500 });
  const quiet = console.error; console.error = () => {};
  try { await assert.rejects(exportCalendarData('u1', env)); } finally { console.error = quiet; }
});

// ---------------------------------------------------------------------------
// Smart scheduling routes: tasks, appointments, moves, conflicts, preferences
// ---------------------------------------------------------------------------
const TASK = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';
const APPT = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const taskRow = (overrides = {}) => seriesRow({
  id: TASK, item_type: 'task', title: 'Submit assignment', category: null, recurrence_freq: null, recurrence_count: null,
  start_at: '2026-11-16T05:00:00+00:00', end_at: '2026-11-16T05:30:00+00:00', completed_at: null, revision: 2, ...overrides,
});
const apptRow = (overrides = {}) => seriesRow({
  id: APPT, item_type: 'appointment', title: 'Doctor', category: 'health', location: 'City Clinic', description: 'Bring reports',
  recurrence_freq: null, recurrence_count: null, start_at: '2026-11-16T04:00:00+00:00', end_at: '2026-11-16T04:30:00+00:00', reminder_minutes: 30, revision: 5, ...overrides,
});

test('rows from before the upgrade read as events; tasks and appointments keep their fields', () => {
  const legacy = { ...seriesRow() }; delete legacy.item_type; delete legacy.completed_at;
  assert.equal(eventFromRow(legacy).itemType, 'event');
  assert.equal(eventFromRow(legacy).completedAt, null);
  assert.equal(eventFromRow(taskRow({ completed_at: '2026-11-15T10:00:00+00:00' })).completedAt, '2026-11-15T10:00:00.000Z');
  const appointment = eventFromRow(apptRow());
  assert.deepEqual([appointment.itemType, appointment.location, appointment.description, appointment.reminderMinutes], ['appointment', 'City Clinic', 'Bring reports', 30]);
});

test('creating tasks and appointments: type is saved; invalid combinations are 400s', async () => {
  const calls = mockDatabase({ rpc: { persora_calendar_save_event: (body) => Response.json({ event: { ...taskRow(), id: body.p_id, item_type: body.p_event.item_type }, exceptions: [] }) } });
  const task = await call('POST', '/calendar/events', { event: { itemType: 'task', title: 'Pay rent', allDay: true, start: { date: '2026-11-30' }, end: { date: '2026-11-30' }, reminderMinutes: 1440 } });
  assert.equal(task.status, 201);
  assert.equal(rpcCalls(calls, 'persora_calendar_save_event')[0].body.p_event.item_type, 'task');
  const appointment = await call('POST', '/calendar/events', { event: { ...timed('Dentist', '2026-11-20', '10:00', '10:30'), itemType: 'appointment', location: 'Clinic', reminderMinutes: 30 } });
  assert.equal(appointment.status, 201);
  assert.equal(rpcCalls(calls, 'persora_calendar_save_event')[1].body.p_event.item_type, 'appointment');
  assert.equal(rpcCalls(calls, 'persora_calendar_save_event')[1].body.p_reminder.minutes_before, 30);
  const repeatingTask = await call('POST', '/calendar/events', { event: { ...timed('Study', '2026-11-20', '19:00', '21:00'), itemType: 'task', recurrence: { freq: 'weekly' } } });
  assert.deepEqual([repeatingTask.status, repeatingTask.body.field], [400, 'recurrence']);
  const allDayAppointment = await call('POST', '/calendar/events', { event: { itemType: 'appointment', title: 'Dentist', allDay: true, start: { date: '2026-11-20' }, end: { date: '2026-11-20' } } });
  assert.equal(allDayAppointment.status, 400);
  assert.equal(rpcCalls(calls, 'persora_calendar_save_event').length, 2, 'invalid input never reaches the database');
});

test('task completion: owner-scoped, tasks only, revision passed, reminder cancelled or rescheduled', async () => {
  const calls = mockDatabase({
    rows: [taskRow({ reminder_minutes: 15 }), apptRow()],
    rpc: { persora_calendar_set_task_completion: (body) => Response.json({ event: taskRow({ completed_at: body.p_completed ? '2026-11-15T10:00:00+00:00' : null, revision: 3 }) }) },
  });
  const done = await call('POST', `/calendar/events/${TASK}/completion`, { completed: true, expectedRevision: 2 });
  assert.equal(done.status, 200);
  assert.equal(done.body.event.completedAt, '2026-11-15T10:00:00.000Z');
  let [rpc] = rpcCalls(calls, 'persora_calendar_set_task_completion');
  assert.deepEqual([rpc.body.p_owner, rpc.body.p_id, rpc.body.p_completed, rpc.body.p_expected_revision, rpc.body.p_reminder], [OWNER, TASK, true, 2, null]);
  const reopened = await call('POST', `/calendar/events/${TASK}/completion`, { completed: false, expectedRevision: 3 });
  assert.equal(reopened.status, 200);
  rpc = rpcCalls(calls, 'persora_calendar_set_task_completion')[1];
  assert.equal(rpc.body.p_reminder.remind_at, '2026-11-16T04:45:00.000Z', 'reopening reschedules the reminder');
  assert.equal((await call('POST', `/calendar/events/${APPT}/completion`, { completed: true })).status, 400, 'only tasks');
  assert.equal((await call('POST', `/calendar/events/${TASK}/completion`, { completed: 'yes' })).status, 400);
  assert.equal((await call('POST', `/calendar/events/${TASK}/completion`, { completed: true }, { ...identity, id: OTHER })).status, 404, 'another member gets 404');
  assert.equal(rpcCalls(calls, 'persora_calendar_set_task_completion').length, 2);
});

test('moving a completed task keeps it complete with no reminder; moving an appointment keeps its fields', async () => {
  const calls = mockDatabase({
    rows: [taskRow({ completed_at: '2026-11-15T10:00:00+00:00', reminder_minutes: 15 }), apptRow()],
    rpc: { persora_calendar_save_event: (body) => Response.json({ event: body.p_id === TASK ? taskRow({ completed_at: '2026-11-15T10:00:00+00:00', revision: 3 }) : apptRow({ revision: 6 }), exceptions: [] }) },
  });
  // The client sends the same fields with new timing; type can't be changed by a move.
  const task = await call('PATCH', `/calendar/events/${TASK}`, { scope: 'series', expectedRevision: 2, event: { ...timed('Submit assignment', '2026-11-18', '15:00', '15:30'), itemType: 'event', reminderMinutes: 15 } });
  assert.equal(task.status, 200);
  let [save] = rpcCalls(calls, 'persora_calendar_save_event');
  assert.equal(save.body.p_event.item_type, 'task', 'the stored type wins');
  assert.equal(save.body.p_reminder, null, 'no reminder for a completed task');
  assert.equal(save.body.p_expected_revision, 2);
  assert.equal(task.body.event.completedAt, '2026-11-15T10:00:00.000Z', 'still complete after the move');
  const appointment = await call('PATCH', `/calendar/events/${APPT}`, { scope: 'series', expectedRevision: 5, event: { ...timed('Doctor', '2026-11-17', '11:00', '11:45'), itemType: 'appointment', category: 'health', location: 'City Clinic', description: 'Bring reports', reminderMinutes: 30 } });
  assert.equal(appointment.status, 200);
  save = rpcCalls(calls, 'persora_calendar_save_event')[1];
  assert.deepEqual([save.body.p_event.location, save.body.p_event.description, save.body.p_event.reminder_minutes, save.body.p_event.start_at], ['City Clinic', 'Bring reports', 30, '2026-11-17T05:00:00.000Z']);
  assert.equal(save.body.p_reminder.remind_at, '2026-11-17T04:30:00.000Z', 'the reminder follows the move');
});

test('moving one occurrence is refused (409) when the series changed since it was loaded', async () => {
  const calls = mockDatabase({ rows: [seriesRow({ revision: 4 }), exceptionRow()], rpc: { persora_calendar_save_occurrence: () => Response.json({ event: exceptionRow(), series: seriesRow() }) } });
  const moved = { ...timed('Standup', '2026-11-18', '10:00', '10:15'), reminderMinutes: 15 };
  const stale = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'occurrence', occurrenceKey: '2026-11-18T03:00:00.000Z', expectedRevision: null, seriesRevision: 3, event: moved });
  assert.equal(stale.status, 409);
  const staleException = await call('PATCH', `/calendar/events/${EXC}`, { scope: 'occurrence', occurrenceKey: null, expectedRevision: 1, seriesRevision: 3, event: moved });
  assert.equal(staleException.status, 409);
  assert.equal(rpcCalls(calls, 'persora_calendar_save_occurrence').length, 0, 'nothing written');
  const fresh = await call('PATCH', `/calendar/events/${SERIES}`, { scope: 'occurrence', occurrenceKey: '2026-11-18T03:00:00.000Z', expectedRevision: null, seriesRevision: 4, event: moved });
  assert.equal(fresh.status, 200);
  assert.equal(rpcCalls(calls, 'persora_calendar_save_occurrence')[0].body.p_original_start_at, '2026-11-18T03:00:00.000Z');
});

test('conflicts: all overlaps with titles and times, nearby free slots; completed tasks and all-day items ignored', async () => {
  const busyRows = [
    seriesRow({ id: SERIES, title: 'Standup', recurrence_freq: 'daily', recurrence_count: 30, start_at: '2026-11-16T03:00:00+00:00', end_at: '2026-11-16T03:15:00+00:00' }), // 09:00–09:15 daily
    apptRow(), // 10:00–10:30 on the 16th
    taskRow({ id: TASK, completed_at: '2026-11-15T10:00:00+00:00', start_at: '2026-11-16T03:30:00+00:00', end_at: '2026-11-16T05:00:00+00:00' }), // done → ignored
    seriesRow({ id: EXC, title: 'Holiday', all_day: true, start_at: null, end_at: null, start_date: '2026-11-16', end_date: '2026-11-17', recurrence_freq: null, recurrence_count: null }),
  ];
  const calls = mockDatabase({ rpc: { persora_calendar_events_in_range: () => Response.json(busyRows) } });
  const result = await call('POST', '/calendar/conflicts', { event: { ...timed('Review', '2026-11-16', '09:00', '10:15'), itemType: 'event' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.conflicts.map((entry) => [entry.title, entry.itemType, entry.start.time, entry.end.time]), [['Standup', 'event', '09:00', '09:15'], ['Doctor', 'appointment', '10:00', '10:30']]);
  assert.ok(result.body.suggestions.length > 0 && result.body.suggestions.length <= 3);
  for (const slot of result.body.suggestions) {
    assert.equal(Date.parse(slot.endAt) - Date.parse(slot.startAt), 75 * 60_000);
    for (const row of [busyRows[0], busyRows[1]]) assert.ok(!(Date.parse(slot.startAt) < Date.parse(row.end_at) && Date.parse(row.start_at) < Date.parse(slot.endAt)));
  }
  const [range] = rpcCalls(calls, 'persora_calendar_events_in_range');
  assert.equal(range.body.p_owner, OWNER, 'only the member\'s own items');

  // The item being moved doesn't conflict with itself; one occurrence of a series ignores only that occurrence.
  const self = await call('POST', '/calendar/conflicts', { event: { ...timed('Doctor', '2026-11-16', '10:15', '10:45'), itemType: 'appointment' }, ignore: { eventId: APPT } });
  assert.deepEqual(self.body.conflicts, []);
  const occurrence = await call('POST', '/calendar/conflicts', { event: timed('Standup', '2026-11-16', '09:05', '09:20'), ignore: { seriesId: SERIES, occurrenceKey: '2026-11-16T03:00:00.000Z', scope: 'occurrence' } });
  assert.deepEqual(occurrence.body.conflicts, []);
  // A recurring candidate is checked across its upcoming occurrences, without suggestions.
  const weekly = await call('POST', '/calendar/conflicts', { event: { ...timed('Gym', '2026-11-16', '09:10', '09:40'), recurrence: { freq: 'daily', count: 3 } } });
  assert.deepEqual(weekly.body.conflicts.map((entry) => entry.start.date), ['2026-11-16', '2026-11-17', '2026-11-18'], 'every overlapping occurrence is listed');
  assert.ok(weekly.body.conflicts.every((entry) => entry.seriesId === SERIES || entry.eventId === SERIES));
  assert.deepEqual(weekly.body.suggestions, []);
  // Skips.
  assert.equal((await call('POST', '/calendar/conflicts', { event: { title: 'Trip', allDay: true, start: { date: '2026-11-16' }, end: { date: '2026-11-16' } } })).body.skipped, 'all-day');
  assert.equal((await call('POST', '/calendar/conflicts', { event: { ...timed('Done task', '2026-11-16', '09:00', '09:30'), itemType: 'task' }, completed: true })).body.skipped, 'completed');
  assert.equal((await call('POST', '/calendar/conflicts', { event: timed('', '2026-11-16', '09:00', '09:30') })).status, 400);
});

test('preferences: defaults when unsaved, normalized upsert for the signed-in member only', async () => {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method || 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : null, prefer: new Headers(init.headers).get('Prefer') });
    if (url.pathname.endsWith('/calendar_preferences') && (init.method || 'GET') === 'GET') return Response.json([]);
    return Response.json([{ user_id: OWNER, filters: {}, updated_at: '2026-10-24T10:00:00+00:00' }]);
  };
  const empty = await call('GET', '/calendar/preferences');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.saved, false);
  assert.equal(empty.body.filters.types.task, true);
  assert.equal(calls[0].url.searchParams.get('user_id'), `eq.${OWNER}`);
  const saved = await call('PUT', '/calendar/preferences', { filters: { types: { task: false, bogus: false }, categories: { work: false }, completed: false }, user_id: OTHER });
  assert.equal(saved.status, 200);
  const upsert = calls.find((entry) => entry.method === 'POST');
  assert.equal(upsert.body.user_id, OWNER, 'never another member');
  assert.equal(upsert.body.filters.types.task, false);
  assert.equal('bogus' in upsert.body.filters.types, false, 'unknown keys dropped');
  assert.equal(upsert.body.filters.categories.work, false);
  assert.match(upsert.prefer, /merge-duplicates/);
  assert.equal(saved.body.updatedAt, '2026-10-24T10:00:00+00:00');
  assert.equal((await call('PUT', '/calendar/preferences', { filters: 'all' })).status, 400);
});
