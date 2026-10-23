// Habit Tracker Pages API routes end to end: handleHabits → PostgREST (mocked
// fetch) → the real migration on PGlite. Covers CRUD, archive/restore, the three
// schedule types, check-ins (complete, undo, correct, numeric), validation,
// isolation, auth, reminders through the shared dispatcher, backup and restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handleHabits, dispatchHabitReminders, exportHabitData, habitReminderEmail } from '../cloudflare/habits.js';
import worker from '../cloudflare/api.js';
import { addDays, localDateOf, startOfWeek } from '../cloudflare/calendar-rules.js';

const ORIGIN = 'https://persora.example';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const ctx = await createVaultDatabase();
const { db } = ctx;

// PostgREST stand-in: /rest/v1/rpc/<fn> → the real SQL function.
const rpcLog = [];
let failNext = null;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
  const name = url.pathname.split('/').pop();
  const args = init.body ? JSON.parse(init.body) : {};
  rpcLog.push({ name, args });
  if (failNext) { const response = failNext; failNext = null; return response(); }
  if (Array.isArray(args.p_ids)) args.p_ids = `{${args.p_ids.join(',')}}`;
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

async function member(label, zone = 'Asia/Dhaka') {
  const who = await ctx.addMember(label);
  await db.query('update public.profiles set timezone = $2, email_verified_at = now() where id = $1', [who.id, zone]);
  return { id: who.id, email: who.email, full_name: label, timezone: zone, email_verified_at: '2026-01-01T00:00:00Z', account_status: 'active' };
}
const alice = await member('route-alice');
const bob = await member('route-bob');
const today = localDateOf(Date.now(), 'Asia/Dhaka');
const start = addDays(today, -20);

const call = async (method, path, body, who = alice, services = {}) => {
  const init = { method };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  const response = await handleHabits(new Request(`${ORIGIN}/api${path}`, init), who, env, ORIGIN, services);
  return { status: response.status, body: await response.json() };
};
const habitBody = (overrides = {}) => ({ name: 'Read', icon: 'book', color: 'violet', frequency: 'daily', startDate: start, ...overrides });
const list = async (who = alice, query = `?from=${addDays(today, -40)}&to=${today}`) => (await call('GET', `/habits${query}`, undefined, who)).body;

test('create, list, edit with revision, archive, restore, delete', async () => {
  let result = await call('POST', '/habits', habitBody({ description: 'Before bed', category: 'study', user_id: bob.id }));
  assert.equal(result.status, 201);
  const habit = result.body.habit;
  assert.equal(habit.name, 'Read');
  assert.equal(habit.category, 'study');
  assert.equal(habit.revision, 1);
  assert.equal((await db.query('select user_id from public.habits where id = $1', [habit.id])).rows[0].user_id, alice.id, 'owner comes from the session, never the body');
  const listed = await list();
  assert.equal(listed.timeZone, 'Asia/Dhaka');
  assert.equal(listed.today, today);
  assert.ok(listed.habits.some((entry) => entry.id === habit.id));
  assert.equal(listed.email.available, false, 'email reminders depend on the configured email service');

  result = await call('PATCH', `/habits/${habit.id}`, habitBody({ name: 'Read 20 pages', revision: 1 }));
  assert.equal(result.status, 200);
  assert.equal(result.body.habit.revision, 2);
  result = await call('PATCH', `/habits/${habit.id}`, habitBody({ name: 'Stale', revision: 1 }));
  assert.equal(result.status, 409, 'stale revisions are rejected');

  await call('PUT', `/habits/${habit.id}/checkins/${addDays(today, -1)}`, { completed: true });
  result = await call('POST', `/habits/${habit.id}/archive`, {});
  assert.equal(result.status, 200);
  assert.ok(result.body.habit.archivedAt);
  result = await call('PUT', `/habits/${habit.id}/checkins/${today}`, { completed: true });
  assert.equal(result.status, 409, 'archived habits are read-only');
  const archived = (await list()).habits.find((entry) => entry.id === habit.id);
  assert.deepEqual(archived.completedDates, [addDays(today, -1)], 'archive keeps history');
  result = await call('POST', `/habits/${habit.id}/restore`, {});
  assert.equal(result.body.habit.archivedAt, null);
  assert.equal((await call('PUT', `/habits/${habit.id}/checkins/${today}`, { completed: true })).status, 200);

  assert.equal((await call('DELETE', `/habits/${habit.id}`, undefined, bob)).status, 404, 'another member cannot delete it');
  assert.equal((await call('DELETE', `/habits/${habit.id}`)).status, 200);
  assert.equal((await call('GET', `/habits/${habit.id}/checkins/${today}`)).status, 404);
  assert.equal((await db.query('select count(*) from public.habit_checkins where habit_id = $1', [habit.id])).rows[0].count, 0, 'history is deleted with the habit');
});

test('client ids make creation idempotent; foreign ids are refused', async () => {
  const id = crypto.randomUUID();
  assert.equal((await call('POST', '/habits', habitBody({ id, name: 'Floss' }))).status, 201);
  const retry = await call('POST', '/habits', habitBody({ id, name: 'Floss changed', frequency: 'weekly', weeklyTarget: 2 }));
  assert.equal(retry.status, 200, 'a retried create returns the saved habit');
  assert.equal(retry.body.habit.name, 'Floss', 'and never overwrites it');
  assert.equal(retry.body.habit.revision, 1);
  assert.equal((await call('POST', '/habits', habitBody({ id, name: 'Hijack' }), bob)).status, 404);
  assert.equal((await list()).habits.filter((entry) => entry.name === 'Floss').length, 1);
});

test('validation errors return 400 with the field before touching the database', async () => {
  rpcLog.length = 0;
  let result = await call('POST', '/habits', habitBody({ name: '' }));
  assert.equal(result.status, 400); assert.equal(result.body.field, 'name');
  result = await call('POST', '/habits', habitBody({ frequency: 'weekdays', weekdays: [] }));
  assert.equal(result.body.field, 'weekdays');
  result = await call('POST', '/habits', habitBody({ frequency: 'weekly', weeklyTarget: 9 }));
  assert.equal(result.body.field, 'weeklyTarget');
  result = await call('POST', '/habits', habitBody({ tracking: 'numeric', targetValue: -2 }));
  assert.equal(result.body.field, 'targetValue');
  result = await call('POST', '/habits', habitBody({ reminderTime: '7pm' }));
  assert.equal(result.body.field, 'reminderTime');
  const raw = await handleHabits(new Request(`${ORIGIN}/api/habits`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } }), alice, env, ORIGIN);
  assert.equal(raw.status, 415);
  const big = await handleHabits(new Request(`${ORIGIN}/api/habits`, { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(70000) }), headers: { 'Content-Type': 'application/json' } }), alice, env, ORIGIN);
  assert.equal(big.status, 413);
  assert.equal((await call('GET', '/habits?from=2026-01-01&to=2028-01-01')).status, 400);
  assert.equal((await call('POST', '/habits/reorder', { ids: ['nope'] })).status, 400);
  assert.equal(rpcLog.length, 0);
});

test('three schedule types: check-ins only on scheduled days, weekly targets any day', async () => {
  const weekday = (offset) => new Date(`${addDays(today, offset)}T12:00:00Z`).getUTCDay();
  const onDays = [weekday(-1)]; // only yesterday's weekday
  const selected = (await call('POST', '/habits', habitBody({ name: 'Gym', frequency: 'weekdays', weekdays: onDays }))).body.habit;
  assert.deepEqual(selected.weekdays, onDays);
  assert.equal((await call('PUT', `/habits/${selected.id}/checkins/${addDays(today, -1)}`, { completed: true })).status, 200);
  const offDay = await call('PUT', `/habits/${selected.id}/checkins/${today}`, { completed: true });
  assert.equal(offDay.status, 400);
  assert.match(offDay.body.error, /isn't scheduled/);
  const weekly = (await call('POST', '/habits', habitBody({ name: 'Run', frequency: 'weekly', weeklyTarget: 3 }))).body.habit;
  assert.equal(weekly.weeklyTarget, 3);
  for (const offset of [0, -1, -2]) assert.equal((await call('PUT', `/habits/${weekly.id}/checkins/${addDays(today, offset)}`, { completed: true })).status, 200);
  const daily = (await call('POST', '/habits', habitBody({ name: 'Water daily' }))).body.habit;
  assert.equal(daily.frequency, 'daily');
  assert.equal((await call('PUT', `/habits/${daily.id}/checkins/${addDays(start, -1)}`, { completed: true })).status, 400, 'nothing before the start date');
  assert.equal((await call('PUT', `/habits/${daily.id}/checkins/${addDays(today, 1)}`, { completed: true })).status, 400, 'no future check-ins');
  // Editing the schedule keeps earlier weeks: a check-in from before this week survives.
  const old = addDays(startOfWeek(today), -3);
  await call('PUT', `/habits/${daily.id}/checkins/${old}`, { completed: true });
  const edited = (await call('PATCH', `/habits/${daily.id}`, habitBody({ name: 'Water daily', frequency: 'weekdays', weekdays: [weekday(0)], revision: daily.revision }))).body.habit;
  assert.equal(edited.scheduleHistory[0].frequency, 'daily');
  assert.equal(edited.scheduleHistory.at(-1).frequency, 'weekdays');
  assert.ok(edited.scheduleHistory.at(-1).from >= startOfWeek(today));
  assert.ok((await list()).habits.find((entry) => entry.id === daily.id).completedDates.includes(old));
});

test('check-ins: complete, undo, correct past days, numeric amounts, no duplicates', async () => {
  const check = (await call('POST', '/habits', habitBody({ name: 'Stretch' }))).body.habit;
  const day = addDays(today, -3);
  let result = await call('PUT', `/habits/${check.id}/checkins/${day}`, { completed: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.completedDates, [day]);
  result = await call('PUT', `/habits/${check.id}/checkins/${day}`, { completed: true });
  assert.deepEqual(result.body.completedDates, [day], 'repeating a check-in is idempotent');
  result = await call('DELETE', `/habits/${check.id}/checkins/${day}`);
  assert.equal(result.body.checkin, null);
  assert.deepEqual(result.body.completedDates, []);
  assert.equal((await call('PUT', `/habits/${check.id}/checkins/${day}`, { completed: 'yes' })).status, 400);

  const water = (await call('POST', '/habits', habitBody({ name: 'Water', tracking: 'numeric', targetValue: 8, unit: 'glasses' }))).body.habit;
  result = await call('PUT', `/habits/${water.id}/checkins/${today}`, { value: 3 });
  assert.equal(result.body.checkin.completed, false);
  assert.equal(result.body.checkin.value, 3);
  assert.equal(result.body.checkin.target, 8);
  result = await call('PUT', `/habits/${water.id}/checkins/${today}`, { value: 8.5 });
  assert.equal(result.body.checkin.completed, true);
  assert.deepEqual(result.body.completedDates, [today]);
  result = await call('PUT', `/habits/${water.id}/checkins/${today}`, { value: 0 });
  assert.equal(result.body.checkin, null, 'zero clears the day');
  assert.equal((await call('PUT', `/habits/${water.id}/checkins/${today}`, { value: -1 })).status, 400);
  assert.equal((await db.query('select count(*) from public.habit_checkins where habit_id = $1', [water.id])).rows[0].count, 0);
  // Bob can't see or touch Alice's check-ins.
  assert.equal((await call('PUT', `/habits/${water.id}/checkins/${today}`, { value: 9 }, bob)).status, 404);
  assert.ok(!(await list(bob)).checkins.some((entry) => entry.habitId === water.id));
});

test('database failures never report success', async () => {
  const habit = (await call('POST', '/habits', habitBody({ name: 'Flaky' }))).body.habit;
  failNext = () => new Response('upstream down', { status: 503 });
  // The first RPC (persora_habit_get) fails → the route fails; nothing is saved.
  const result = await call('PUT', `/habits/${habit.id}/checkins/${today}`, { completed: true });
  assert.equal(result.status, 502);
  assert.ok(result.body.error);
  assert.deepEqual((await list()).habits.find((entry) => entry.id === habit.id).completedDates, []);
  failNext = () => Response.json({ code: 'PGRST202', message: 'missing' }, { status: 404 });
  assert.equal((await call('GET', '/habits')).status, 503, 'a missing migration is explained');
});

test('reorder persists order for the signed-in member', async () => {
  const who = await member('route-order');
  const ids = [];
  for (const name of ['One', 'Two', 'Three']) ids.push((await call('POST', '/habits', habitBody({ name }), who)).body.habit.id);
  const result = await call('POST', '/habits/reorder', { ids: [ids[2], ids[0], ids[1]] }, who);
  assert.deepEqual(result.body, { ok: true, updated: 3 });
  assert.deepEqual((await list(who)).habits.map((entry) => entry.name), ['Three', 'One', 'Two']);
  assert.equal((await call('POST', '/habits/reorder', { ids }, bob)).body.updated, 0);
});

test('anonymous requests are rejected by the worker before any habit query', async () => {
  rpcLog.length = 0;
  for (const [method, path] of [['GET', '/api/habits'], ['POST', '/api/habits'], ['PUT', `/api/habits/${crypto.randomUUID()}/checkins/${today}`], ['GET', '/api/habits/reminders']]) {
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env, { waitUntil() {} });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  assert.ok(!rpcLog.some((entry) => entry.name.startsWith('persora_habit')));
});

test('reminders: planned on save, delivered via the shared dispatcher once, skipped when done, never auto-complete', async () => {
  const who = await member('route-remind');
  const sent = [];
  const services = { emailConfigured: () => true, sendEmail: async (message) => { sent.push(message); } };
  const habit = (await call('POST', '/habits', habitBody({ name: 'Meditate', reminderTime: '07:00', reminderEmail: true }), who)).body.habit;
  let pending = (await db.query("select * from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [habit.id])).rows;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].email_requested, true);
  assert.equal(pending[0].dedupe_key, `habit:${habit.id}:${pending[0].local_date.toISOString().slice(0, 10)}`);
  const listed = (await call('GET', `/habits?from=${today}&to=${today}`, undefined, who, services)).body;
  assert.equal(listed.email.available, true);
  assert.ok(listed.habits[0].nextReminderAt);

  // Make today's reminder due a minute ago.
  const dueKey = `habit:${habit.id}:${today}`;
  await db.query(`update public.habit_reminders set local_date = $2, week_start = $3, remind_at = now() - interval '1 minute', dedupe_key = $4 where id = $1`,
    [pending[0].id, today, startOfWeek(today), dueKey]);
  let bell = (await call('GET', '/habits/reminders', undefined, who, services)).body;
  assert.equal(bell.reminders.length, 1);
  assert.equal(bell.reminders[0].habitName, 'Meditate');
  assert.equal(bell.reminders[0].emailStatus, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, who.email);
  assert.match(sent[0].subject, /Habit reminder: Meditate/);
  assert.match(sent[0].textContent, /never mark a habit as done/);
  // Delivering again (another poll, the cron endpoint) sends nothing new.
  bell = (await call('GET', '/habits/reminders', undefined, who, services)).body;
  assert.equal(bell.reminders.length, 1);
  assert.equal((await dispatchHabitReminders(env, services, { limit: 50 })).claimed, 0);
  assert.equal(sent.length, 1);
  assert.equal((await db.query('select count(*) from public.habit_checkins where habit_id = $1', [habit.id])).rows[0].count, 0, 'reminders never complete a habit');
  pending = (await db.query("select local_date::text as day from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [habit.id])).rows;
  assert.equal(pending.length, 1);
  assert.ok(pending[0].day > today, 'the next slot is planned for a later day');
  // Mark read (one and all) is owner-scoped.
  assert.equal((await call('PATCH', `/habits/reminders/${bell.reminders[0].id}`, {}, bob)).status, 200);
  assert.equal((await db.query('select read_at from public.habit_reminders where id = $1', [bell.reminders[0].id])).rows[0].read_at, null);
  await call('PATCH', '/habits/reminders', {}, who);
  assert.ok((await db.query('select read_at from public.habit_reminders where id = $1', [bell.reminders[0].id])).rows[0].read_at);

  // A habit already done today is skipped (no bell row, no email).
  const done = (await call('POST', '/habits', habitBody({ name: 'Floss', reminderTime: '22:00', reminderEmail: true }), who)).body.habit;
  await call('PUT', `/habits/${done.id}/checkins/${today}`, { completed: true }, who);
  await db.query(`update public.habit_reminders set local_date = $2, week_start = $3, remind_at = now() - interval '1 minute', dedupe_key = $4 where habit_id = $1 and status = 'scheduled'`,
    [done.id, today, startOfWeek(today), `habit:${done.id}:${today}`]);
  const summary = await dispatchHabitReminders(env, services, { owner: who.id });
  assert.deepEqual({ claimed: summary.claimed, delivered: summary.delivered, skipped: summary.skipped }, { claimed: 1, delivered: 0, skipped: 1 });
  assert.equal(sent.length, 1);
  assert.equal((await db.query("select status from public.habit_reminders where dedupe_key = $1", [`habit:${done.id}:${today}`])).rows[0].status, 'skipped');

  // Late reminders still reach the bell, but aren't emailed hours afterwards.
  const late = (await call('POST', '/habits', habitBody({ name: 'Vitamins', reminderTime: '06:00', reminderEmail: true }), who)).body.habit;
  await db.query(`update public.habit_reminders set local_date = $2, week_start = $3, remind_at = now() - interval '3 hours', dedupe_key = $4 where habit_id = $1 and status = 'scheduled'`,
    [late.id, today, startOfWeek(today), `habit:${late.id}:${today}`]);
  await dispatchHabitReminders(env, services, { owner: who.id });
  const lateRow = (await db.query('select status, email_status from public.habit_reminders where dedupe_key = $1', [`habit:${late.id}:${today}`])).rows[0];
  assert.deepEqual(lateRow, { status: 'sent', email_status: 'skipped' });
  assert.equal(sent.length, 1);

  // Turning the reminder off cancels it.
  const current = (await list(who)).habits.find((entry) => entry.id === habit.id);
  await call('PATCH', `/habits/${habit.id}`, habitBody({ name: 'Meditate', reminderTime: null, revision: current.revision }), who);
  assert.equal((await db.query("select count(*) from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [habit.id])).rows[0].count, 0);
  const email = habitReminderEmail({ local_date: '2026-10-24' }, { name: '<b>Water</b>', tracking: 'numeric', targetValue: 8, unit: 'glasses' }, { email: 'a@b.c', full_name: 'A' }, 'https://x/?view=habits');
  assert.match(email.htmlContent, /&lt;b&gt;Water&lt;\/b&gt;/);
  assert.match(email.textContent, /Today's target: 8 glasses/);
});

test('backup: export includes habits and check-ins; restore merges into another account', async () => {
  const source = await member('route-backup');
  const habit = (await call('POST', '/habits', habitBody({ name: 'Walk', category: 'fitness', tracking: 'numeric', targetValue: 5000, unit: 'steps' }), source)).body.habit;
  await call('PUT', `/habits/${habit.id}/checkins/${addDays(today, -2)}`, { value: 6000 }, source);
  await call('PUT', `/habits/${habit.id}/checkins/${addDays(today, -1)}`, { value: 1000 }, source);
  await call('POST', `/habits/${habit.id}/archive`, {}, source);
  const exported = await exportHabitData(source.id, env);
  assert.equal(exported.habits.length, 1);
  assert.equal(exported.checkins.length, 2);
  // Same shape as persora-export.json's data.habits / data.habitCheckins after a JSON round trip.
  const backup = JSON.parse(JSON.stringify({ habits: exported.habits, checkins: exported.checkins }));
  const target = await member('route-restore', 'America/New_York');
  let result = await call('POST', '/habits/import', backup, target);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, habitsCreated: 1, habitsMatched: 0, checkinsAdded: 2, checkinsSkipped: 0 });
  const restored = (await list(target, `?from=${addDays(today, -10)}&to=${addDays(today, 1)}`));
  assert.equal(restored.habits.length, 1);
  assert.equal(restored.habits[0].name, 'Walk');
  assert.ok(restored.habits[0].archivedAt, 'archive state is restored');
  assert.deepEqual(restored.habits[0].completedDates, [addDays(today, -2)], 'completion recomputed from values');
  result = await call('POST', '/habits/import', backup, target);
  assert.deepEqual(result.body, { ok: true, habitsCreated: 0, habitsMatched: 1, checkinsAdded: 0, checkinsSkipped: 2 }, 'restoring twice changes nothing');
  assert.equal((await call('POST', '/habits/import', { habits: [{ id: 'bad' }] }, target)).status, 400);
  assert.equal((await call('POST', '/habits/import', { habits: [{ ...backup.habits[0], id: crypto.randomUUID(), frequency: 'hourly' }] }, target)).status, 400);
  assert.equal((await call('POST', '/habits/import', {}, target)).status, 400);
});
