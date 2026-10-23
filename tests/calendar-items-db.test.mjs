// Calendar item types migration (202610260001) on PGlite: a real upgrade from
// the first Calendar schema with existing data, idempotency, constraints, the
// task-completion RPC, reminders for completed tasks, and preference privacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVaultDatabase } from './password-vault-db.mjs';
import { nextReminder, normalizeEventInput, reminderDedupeKey } from '../cloudflare/calendar-rules.js';

const MIGRATION = '202610260001_calendar_items.sql';
const ctx = await createVaultDatabase({ stopBefore: MIGRATION });
const { db, rpc, addMember, applyThrough } = ctx;
const alice = await addMember('items-alice');
const bob = await addMember('items-bob');

function values(input, { withType = true } = {}) {
  const n = normalizeEventInput(input, { defaultTimeZone: 'Asia/Dhaka' });
  const json = {
    title: n.title, description: n.description, location: n.location, category: n.category, all_day: n.allDay, time_zone: n.timeZone,
    start_at: n.startAt, end_at: n.endAt, start_date: n.startDate, end_date: n.endDate,
    recurrence_freq: n.recurrence?.freq || null, recurrence_interval: n.recurrence?.interval || 1,
    recurrence_until: n.recurrence?.until || null, recurrence_count: n.recurrence?.count || null,
    reminder_minutes: n.reminderMinutes, reminder_email: n.reminderEmail,
  };
  if (withType) json.item_type = n.itemType;
  return { normalized: n, json };
}
function reminderFor(id, n) {
  const next = nextReminder({ id, seriesId: null, status: 'confirmed', ...n }, Date.parse('2026-01-01T00:00:00Z'));
  if (!next) return null;
  return {
    occurrence_key: next.occurrenceKey, occurrence_start: next.occurrenceStart, occurrence_date: next.occurrenceDate, all_day: next.allDay,
    remind_at: next.remindAt, minutes_before: n.reminderMinutes, title: n.title, location: n.location, email: n.reminderEmail,
    dedupe_key: reminderDedupeKey(id, next.occurrenceKey, next.remindAt),
  };
}
async function save(owner, input, { id = crypto.randomUUID(), revision = null, withType = true, patches = [] } = {}) {
  const { normalized, json } = values(input, { withType });
  const result = await rpc('persora_calendar_save_event', {
    p_owner: owner.id, p_id: id, p_event: json, p_expected_revision: revision, p_reset_exceptions: false,
    p_reminder: reminderFor(id, normalized), p_exception_patches: patches,
  });
  return { id, result, normalized };
}
const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; });
};
const row = async (id) => (await db.query('select * from public.calendar_events where id = $1', [id])).rows[0];
const scheduled = async (id) => (await db.query(`select * from public.calendar_reminders where event_id = $1 and status = 'scheduled'`, [id])).rows;
const timed = (title, date, from, to, extra = {}) => ({ title, allDay: false, start: { date, time: from }, end: { date, time: to }, ...extra });

// Data written by the first Calendar release, before the upgrade.
const legacy = {};

test('before the upgrade: the first Calendar schema stores events, a series with an exception, and reminders', async () => {
  const columns = (await db.query(`select column_name from information_schema.columns where table_name = 'calendar_events'`)).rows.map((r) => r.column_name);
  assert.ok(!columns.includes('item_type'), 'the new migration is not applied yet');
  legacy.single = await save(alice, timed('Dentist', '2026-11-20', '10:00', '10:30', { reminderMinutes: 30, location: 'Clinic' }), { withType: false });
  legacy.series = await save(alice, timed('Gym', '2026-11-02', '18:00', '19:00', { recurrence: { freq: 'weekly', count: 6 }, reminderMinutes: 15 }), { withType: false });
  legacy.allDay = await save(alice, { title: 'Holiday', allDay: true, start: { date: '2026-12-16' }, end: { date: '2026-12-16' } }, { withType: false });
  const exception = await rpc('persora_calendar_save_occurrence', {
    p_owner: alice.id, p_series_id: legacy.series.id, p_exception_id: crypto.randomUUID(), p_original_start_at: '2026-11-09T12:00:00.000Z', p_original_start_date: null,
    p_status: 'confirmed', p_event: values(timed('Gym (late)', '2026-11-09', '20:00', '21:00'), { withType: false }).json, p_expected_revision: null,
    p_reminder: null, p_series_reminder: reminderFor(legacy.series.id, legacy.series.normalized),
  });
  assert.equal(exception.event.series_id, legacy.series.id);
  legacy.counts = (await db.query('select count(*)::int as n from public.calendar_events')).rows[0].n;
  legacy.reminders = (await db.query(`select count(*)::int as n from public.calendar_reminders where status = 'scheduled'`)).rows[0].n;
  assert.equal(legacy.counts, 4);
  assert.ok(legacy.reminders >= 2);
});

test('upgrade keeps every row and reminder, marks them as events, and reruns cleanly', async () => {
  const before = (await db.query('select * from public.calendar_events order by id')).rows;
  await applyThrough(MIGRATION);
  const after = (await db.query('select * from public.calendar_events order by id')).rows;
  assert.equal(after.length, before.length, 'no rows lost');
  for (const [index, old] of before.entries()) {
    const now = after[index];
    for (const [key, value] of Object.entries(old)) assert.deepEqual(now[key], value, `${key} unchanged`);
    assert.equal(now.item_type, 'event');
    assert.equal(now.completed_at, null);
  }
  assert.equal((await db.query(`select count(*)::int as n from public.calendar_reminders where status = 'scheduled'`)).rows[0].n, legacy.reminders, 'reminders untouched');
  // Rerunnable (e.g. applied twice by a deployment script).
  await db.exec(await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8'));
  assert.equal((await db.query('select count(*)::int as n from public.calendar_events')).rows[0].n, legacy.counts);
  // Old clients that don't send item_type still create events.
  const old = await save(alice, timed('Old client', '2026-11-21', '09:00', '09:30'), { withType: false });
  assert.equal(old.result.event.item_type, 'event');
});

test('constraints: valid types only, completion only on tasks, appointments timed, no repeating tasks', async () => {
  await rejects(db.query(`update public.calendar_events set item_type = 'meeting' where id = $1`, [legacy.single.id]), '23514');
  await rejects(db.query(`update public.calendar_events set completed_at = now() where id = $1`, [legacy.single.id]), '23514');
  const { id } = await save(alice, timed('Lab results', '2026-11-22', '11:00', '11:30', { itemType: 'appointment' }));
  await rejects(db.query(`update public.calendar_events set all_day = true, start_at = null, end_at = null, start_date = '2026-11-22', end_date = '2026-11-23' where id = $1`, [id]), '23514');
  await rejects(db.query(`update public.calendar_events set recurrence_freq = 'weekly' where id = $1`, [id]), '23514');
});

test('updates keep the stored type and completion; a completed task gets no reminder', async () => {
  const task = await save(alice, timed('Submit report', '2026-11-24', '11:00', '11:30', { itemType: 'task', reminderMinutes: 15 }));
  assert.equal(task.result.event.item_type, 'task');
  assert.equal((await scheduled(task.id)).length, 1);
  // Trying to turn it into an appointment through a save keeps it a task.
  const changed = await save(alice, timed('Submit report', '2026-11-24', '11:00', '11:30', { itemType: 'appointment', reminderMinutes: 15 }), { id: task.id, revision: task.result.event.revision });
  assert.equal(changed.result.event.item_type, 'task');

  const done = await rpc('persora_calendar_set_task_completion', { p_owner: alice.id, p_id: task.id, p_completed: true, p_expected_revision: changed.result.event.revision, p_reminder: null });
  assert.ok(done.event.completed_at, 'completed');
  assert.equal(done.event.revision, changed.result.event.revision + 1, 'completion bumps the revision');
  assert.equal((await scheduled(task.id)).length, 0, 'completing cancels the pending reminder');

  // Moving the completed task (a save) keeps completed_at and still schedules no reminder.
  const moved = await save(alice, timed('Submit report', '2026-11-25', '15:00', '15:30', { itemType: 'task', reminderMinutes: 15 }), { id: task.id, revision: done.event.revision });
  assert.equal(moved.result.event.completed_at, done.event.completed_at);
  assert.equal((await scheduled(task.id)).length, 0);

  // Completing twice keeps the first time.
  const again = await rpc('persora_calendar_set_task_completion', { p_owner: alice.id, p_id: task.id, p_completed: true, p_expected_revision: moved.result.event.revision, p_reminder: null });
  assert.equal(again.event.completed_at, done.event.completed_at);

  // Reopening schedules the reminder the API computed.
  const reopened = await rpc('persora_calendar_set_task_completion', { p_owner: alice.id, p_id: task.id, p_completed: false, p_expected_revision: again.event.revision, p_reminder: reminderFor(task.id, moved.normalized) });
  assert.equal(reopened.event.completed_at, null);
  assert.equal((await scheduled(task.id)).length, 1);
});

test('completion RPC: revision-checked, tasks only, owner only, service role only', async () => {
  const task = await save(alice, timed('Call bank', '2026-11-26', '09:00', '09:15', { itemType: 'task' }));
  await rejects(rpc('persora_calendar_set_task_completion', { p_owner: alice.id, p_id: task.id, p_completed: true, p_expected_revision: task.result.event.revision + 5, p_reminder: null }), 'P0409');
  await rejects(rpc('persora_calendar_set_task_completion', { p_owner: alice.id, p_id: legacy.single.id, p_completed: true, p_expected_revision: null, p_reminder: null }), 'P0400');
  await rejects(rpc('persora_calendar_set_task_completion', { p_owner: bob.id, p_id: task.id, p_completed: true, p_expected_revision: null, p_reminder: null }), 'P0404');
  assert.equal((await row(task.id)).completed_at, null, 'nothing changed');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await rejects(db.query(`select public.persora_calendar_set_task_completion('${alice.id}', '${task.id}', true, null, null)`), '42501');
      await rejects(db.query('select * from public.calendar_preferences'), '42501');
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { await rejects(db.query(`select public.persora_calendar_event_values('{}'::jsonb)`), '42501'); }
  finally { await db.exec('reset role'); }
});

test('preferences: one private row per member, size-limited, removed with the account', async () => {
  await db.query(`insert into public.calendar_preferences (user_id, filters) values ($1, $2)`, [alice.id, { types: { task: false } }]);
  await rejects(db.query(`insert into public.calendar_preferences (user_id, filters) values ($1, $2)`, [alice.id, {}]), '23505');
  await rejects(db.query(`insert into public.calendar_preferences (user_id, filters) values ($1, '[]'::jsonb)`, [bob.id]), '23514');
  await rejects(db.query(`insert into public.calendar_preferences (user_id, filters) values ($1, $2)`, [bob.id, { junk: 'x'.repeat(6000) }]), '23514');
  const rls = await db.query(`select relrowsecurity from pg_class where relname = 'calendar_preferences'`);
  assert.equal(rls.rows[0].relrowsecurity, true);
  const temp = await addMember('items-temp');
  await db.query(`insert into public.calendar_preferences (user_id, filters) values ($1, '{}'::jsonb)`, [temp.id]);
  await db.query('delete from public.profiles where id = $1', [temp.id]);
  assert.equal((await db.query('select count(*)::int as n from public.calendar_preferences where user_id = $1', [temp.id])).rows[0].n, 0);
});
