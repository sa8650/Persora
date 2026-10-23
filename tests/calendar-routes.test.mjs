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
  const due = (overrides = {}) => ({
    id: crypto.randomUUID(), event_id: SERIES, root_id: SERIES, occurrence_key: new Date(now + 15 * 60000).toISOString(), occurrence_start: new Date(now + 15 * 60000).toISOString(), occurrence_date: null,
    all_day: false, remind_at: new Date(now - 1000).toISOString(), minutes_before: 15, title: 'Standup <b>', location: 'Room 1', email_status: 'sending',
    claimed_at: '2026-11-16T02:45:00.123456+00:00', ...overrides,
  });
  const verified = { email: 'me@example.test', full_name: 'Me', timezone: 'Asia/Dhaka', email_verified: true, active: true };
  const rows = [
    { reminder: due(), event: seriesRow({ start_at: new Date(now + 15 * 60000).toISOString(), end_at: new Date(now + 30 * 60000).toISOString() }), owner: verified },
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
    return new Response('{}', { status: 500 });
  };
  const data = await exportCalendarData('u1', env);
  assert.deepEqual(data.events.map((row) => row.id), ['e1', 'e2'], 'exceptions and cancelled occurrences are kept');
  assert.deepEqual(data.reminders.map((row) => row.id), ['r1']);
  assert.ok(seen.every((call) => call.owner === 'eq.u1'), 'every query is scoped to the member');
  assert.ok(seen.every((call) => call.range === '0-999'), 'paged');
  assert.ok(seen.every((call) => call.auth), 'server-side key only');
  assert.ok(!seen.find((call) => call.path.endsWith('/calendar_reminders')).select.includes('claim_token'), 'internal claim tokens are not exported');

  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: 404 });
  assert.deepEqual(await exportCalendarData('u1', env), { events: [], reminders: [] });

  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'XX000', message: 'boom' }), { status: 500 });
  const quiet = console.error; console.error = () => {};
  try { await assert.rejects(exportCalendarData('u1', env)); } finally { console.error = quiet; }
});
