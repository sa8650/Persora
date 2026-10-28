// Habit Tracker migration on PGlite (schema.sql + every migration, in order):
// privileges/RLS, owner isolation, one check-in per habit per day, revisions,
// the habit cap, reminder dedupe/claims, cascades and backup/restore merging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVaultDatabase } from './password-vault-db.mjs';
import { habitReminderDedupeKey } from '../cloudflare/habit-rules.js';

const ctx = await createVaultDatabase();
const { db, rpc, addMember } = ctx;
const alice = await addMember('habit-alice');
const bob = await addMember('habit-bob');

const values = (overrides = {}) => ({
  name: 'Read', description: '', icon: 'book', color: 'violet', category: 'study', frequency: 'daily', weekday_mask: 0, weekly_target: null,
  tracking: 'check', target_value: null, unit: '', start_date: '2026-10-01',
  schedule_history: [{ from: '2026-10-01', frequency: 'daily', weekdays: [], weeklyTarget: null }],
  reminder_time: null, reminder_email: false, ...overrides,
});
const slot = (habitId, date, remindAt, extra = {}) => ({
  local_date: date, week_start: date, remind_at: remindAt, time_zone: 'Asia/Dhaka', habit_name: 'Read', email: false,
  dedupe_key: habitReminderDedupeKey(habitId, date), ...extra,
});
async function create(owner, overrides = {}, reminders = null, id = crypto.randomUUID()) {
  const row = await rpc('persora_habit_save', { p_owner: owner.id, p_id: id, p_habit: values(overrides), p_expected_revision: null, p_reminders: reminders });
  return { id, row };
}
const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; });
};
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].count);

test('tables are closed to anon/authenticated; only service_role may call the API functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of ['habits', 'habit_checkins', 'habit_reminders']) await rejects(db.query(`select * from public.${table}`), '42501');
      await rejects(db.query(`select public.persora_habits_list('${alice.id}', '2026-10-01', '2026-10-31')`), '42501');
      await rejects(db.query(`select public.persora_habits_export('${alice.id}')`), '42501');
      await rejects(db.query('select public.persora_habit_claim_reminders(5, null)'), '42501');
    } finally { await db.exec('reset role'); }
  }
  // Internal helpers aren't callable even by the service role.
  await db.exec('set role service_role');
  try {
    await rejects(db.query(`select public.persora_habit_set_reminder('${alice.id}', '${alice.id}', '[]'::jsonb)`), '42501');
  } finally { await db.exec('reset role'); }
  const rls = await db.query("select relname, relrowsecurity from pg_class where relname in ('habits', 'habit_checkins', 'habit_reminders')");
  assert.equal(rls.rows.length, 3);
  assert.ok(rls.rows.every((row) => row.relrowsecurity), 'row-level security is enabled on every habit table');
  const indexes = (await db.query("select indexname from pg_indexes where tablename in ('habits', 'habit_checkins', 'habit_reminders')")).rows.map((row) => row.indexname);
  for (const name of ['habits_owner_idx', 'habit_checkins_owner_date_idx', 'habit_checkins_one_per_day', 'habit_reminders_one_scheduled', 'habit_reminders_due_idx']) {
    assert.ok(indexes.includes(name), `${name} exists`);
  }
});

test('create, update with revisions, and owner isolation', async () => {
  const { id, row } = await create(alice);
  assert.equal(row.user_id, alice.id);
  assert.equal(row.revision, 1);
  const updated = await rpc('persora_habit_save', { p_owner: alice.id, p_id: id, p_habit: values({ name: 'Read 20 pages' }), p_expected_revision: 1, p_reminders: null });
  assert.equal(updated.revision, 2);
  assert.equal(updated.name, 'Read 20 pages');
  await rejects(rpc('persora_habit_save', { p_owner: alice.id, p_id: id, p_habit: values(), p_expected_revision: 1, p_reminders: null }), 'P0409');
  // Bob can't read, overwrite (even by reusing the id), check in, archive, delete or reorder Alice's habit.
  assert.equal(await rpc('persora_habit_get', { p_owner: bob.id, p_id: id }), null);
  await rejects(rpc('persora_habit_save', { p_owner: bob.id, p_id: id, p_habit: values({ name: 'Mine now' }), p_expected_revision: null, p_reminders: null }), 'P0404');
  await rejects(rpc('persora_habit_checkin', { p_owner: bob.id, p_habit: id, p_date: '2026-10-10', p_value: 1 }), 'P0404');
  await rejects(rpc('persora_habit_set_archived', { p_owner: bob.id, p_id: id, p_archived: true, p_reminders: null }), 'P0404');
  await rejects(rpc('persora_habit_delete', { p_owner: bob.id, p_id: id }), 'P0404');
  assert.equal(await rpc('persora_habit_reorder', { p_owner: bob.id, p_ids: `{${id}}` }), 0);
  assert.equal((await rpc('persora_habits_list', { p_owner: bob.id, p_from: '2026-10-01', p_to: '2026-10-31' })).habits.length, 0);
  assert.equal((await rpc('persora_habit_get', { p_owner: alice.id, p_id: id })).name, 'Read 20 pages');
  // Table constraints back up the API's validation.
  await rejects(create(alice, { name: '   ' }), '23514');
  await rejects(create(alice, { frequency: 'weekdays', weekday_mask: 0 }), '23514');
  await rejects(create(alice, { tracking: 'numeric', target_value: null }), '23514');
  await rejects(create(alice, { reminder_email: true, reminder_time: null }), '23514');
});

test('one check-in per habit per day: upserts, undo, numeric target snapshots', async () => {
  const { id } = await create(alice, { name: 'Water', tracking: 'numeric', target_value: 8, unit: 'glasses' });
  let result = await rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: id, p_date: '2026-10-05', p_value: 5 });
  assert.equal(result.checkin.completed, false);
  assert.deepEqual(result.completed_dates, []);
  result = await rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: id, p_date: '2026-10-05', p_value: 8 });
  assert.equal(result.checkin.completed, true);
  assert.deepEqual(result.completed_dates, ['2026-10-05']);
  assert.equal(await count('select count(*) from public.habit_checkins where habit_id = $1', [id]), 1, 'correction updates the same row');
  await rejects(db.query(`insert into public.habit_checkins(user_id, habit_id, check_date, value, completed) values ($1, $2, '2026-10-05', 1, true)`, [alice.id, id]), '23505');
  // Raising the target later doesn't rewrite a past day's completion.
  const habit = await rpc('persora_habit_get', { p_owner: alice.id, p_id: id });
  await rpc('persora_habit_save', { p_owner: alice.id, p_id: id, p_habit: values({ name: 'Water', tracking: 'numeric', target_value: 10, unit: 'glasses' }), p_expected_revision: habit.revision, p_reminders: null });
  const listed = await rpc('persora_habits_list', { p_owner: alice.id, p_from: '2026-10-01', p_to: '2026-10-31' });
  const checkin = listed.checkins.find((row) => row.habit_id === id);
  assert.equal(Number(checkin.target_value), 8);
  assert.equal(checkin.completed, true);
  // Undo removes the row; checkbox habits always store value 1.
  result = await rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: id, p_date: '2026-10-05', p_value: null });
  assert.equal(result.checkin, null);
  assert.equal(await count('select count(*) from public.habit_checkins where habit_id = $1', [id]), 0);
  const check = await create(alice, { name: 'Stretch' });
  result = await rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: check.id, p_date: '2026-10-06', p_value: 42 });
  assert.equal(Number(result.checkin.value), 1);
  assert.equal(result.checkin.completed, true);
  await rejects(rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: check.id, p_date: '2026-09-30', p_value: 1 }), 'P0400');
});

test('archive keeps history and blocks check-ins; restore re-enables; delete cascades', async () => {
  const { id } = await create(alice, { name: 'Journal', reminder_time: '21:00' }, [slot('x', '2030-01-01', '2030-01-01T15:00:00Z')]);
  await rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: id, p_date: '2026-10-07', p_value: 1 });
  assert.equal(await count("select count(*) from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [id]), 1);
  const archived = await rpc('persora_habit_set_archived', { p_owner: alice.id, p_id: id, p_archived: true, p_reminders: null });
  assert.ok(archived.archived_at);
  assert.equal(await count("select count(*) from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [id]), 0, 'archiving cancels reminders');
  await rejects(rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: id, p_date: '2026-10-08', p_value: 1 }), 'P0409');
  const listed = await rpc('persora_habits_list', { p_owner: alice.id, p_from: '2026-10-01', p_to: '2026-10-31' });
  assert.deepEqual(listed.habits.find((row) => row.id === id).completed_dates, ['2026-10-07'], 'history is kept');
  const restored = await rpc('persora_habit_set_archived', { p_owner: alice.id, p_id: id, p_archived: false, p_reminders: [slot(id, '2030-01-02', '2030-01-02T15:00:00Z')] });
  assert.equal(restored.archived_at, null);
  assert.equal(await count("select count(*) from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [id]), 1);
  await rpc('persora_habit_checkin', { p_owner: alice.id, p_habit: id, p_date: '2026-10-08', p_value: 1 });
  assert.equal(await rpc('persora_habit_delete', { p_owner: alice.id, p_id: id }), true);
  assert.equal(await count('select count(*) from public.habit_checkins where habit_id = $1', [id]), 0);
  assert.equal(await count('select count(*) from public.habit_reminders where habit_id = $1', [id]), 0);
  await rejects(rpc('persora_habit_delete', { p_owner: alice.id, p_id: id }), 'P0404');
});

test('reorder sets positions for owned habits only', async () => {
  const member = await addMember('habit-order');
  const a = await create(member, { name: 'A' });
  const b = await create(member, { name: 'B' });
  const c = await create(member, { name: 'C' });
  const foreign = await create(bob, { name: 'Bob only' });
  assert.equal(await rpc('persora_habit_reorder', { p_owner: member.id, p_ids: `{${c.id},${a.id},${foreign.id},${b.id}}` }), 3);
  const listed = await rpc('persora_habits_list', { p_owner: member.id, p_from: '2026-10-01', p_to: '2026-10-02' });
  assert.deepEqual(listed.habits.map((row) => row.name), ['C', 'A', 'B']);
  assert.equal((await rpc('persora_habit_get', { p_owner: bob.id, p_id: foreign.id })).position, 0);
});

test('each member can keep up to 100 habits', async () => {
  const member = await addMember('habit-cap');
  for (let index = 0; index < 100; index += 1) await create(member, { name: `Habit ${index}` });
  await rejects(create(member, { name: 'One too many' }), 'P0409');
});

test('reminders: one pending per habit, dedupe per local day, exclusive claims, next slot planned', async () => {
  const id = crypto.randomUUID();
  const past = new Date(Date.now() - 60_000).toISOString();
  await create(alice, { name: 'Meditate', reminder_time: '07:00' }, [slot(id, '2026-10-24', past), slot(id, '2026-10-25', '2030-01-01T00:00:00Z')], id);
  // Re-saving with the same slot replaces it rather than duplicating it.
  const habit = await rpc('persora_habit_get', { p_owner: alice.id, p_id: id });
  await rpc('persora_habit_save', { p_owner: alice.id, p_id: id, p_habit: values({ name: 'Meditate', reminder_time: '07:00' }), p_expected_revision: habit.revision, p_reminders: [slot(id, '2026-10-24', past)] });
  assert.equal(await count("select count(*) from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [id]), 1);
  assert.equal(await count('select count(*) from public.habit_reminders where habit_id = $1', [id]), 1, 'cancelled slot was reused (same dedupe key)');
  // A direct duplicate for the same habit and day is impossible.
  await rejects(db.query(`insert into public.habit_reminders(user_id, habit_id, local_date, week_start, remind_at, time_zone, habit_name, dedupe_key, status)
    values ($1, $2, '2026-10-24', '2026-10-18', now(), 'UTC', 'x', $3, 'sent')`, [alice.id, id, habitReminderDedupeKey(id, '2026-10-24')]), '23505');

  const claims = await rpc('persora_habit_claim_reminders', { p_limit: 10, p_owner: alice.id });
  const mine = claims.filter((entry) => entry.reminder.habit_id === id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].day_done, false);
  assert.equal(mine[0].owner.active, true);
  assert.deepEqual((await rpc('persora_habit_claim_reminders', { p_limit: 10, p_owner: alice.id })).filter((entry) => entry.reminder.habit_id === id), [], 'a claim is exclusive');
  const reminder = mine[0].reminder;
  const done = await rpc('persora_habit_complete_reminder', {
    p_id: reminder.id, p_claimed_at: reminder.claimed_at, p_delivered: true, p_email_status: 'not_requested', p_note: null,
    p_habit_revision: mine[0].habit.revision, p_next: [slot(id, '2026-10-24', past), slot(id, '2026-10-25', '2030-01-01T00:00:00Z')],
  });
  assert.equal(done, true);
  const rows = (await db.query('select local_date::text as day, status from public.habit_reminders where habit_id = $1 order by local_date', [id])).rows;
  assert.deepEqual(rows, [{ day: '2026-10-24', status: 'sent' }, { day: '2026-10-25', status: 'scheduled' }], 'the delivered day is never re-queued');
  assert.equal(await rpc('persora_habit_complete_reminder', {
    p_id: reminder.id, p_claimed_at: reminder.claimed_at, p_delivered: true, p_email_status: 'not_requested', p_note: null, p_habit_revision: 0, p_next: null,
  }), false, 'completing twice is a no-op');
  const recent = await rpc('persora_habit_reminders_recent', { p_owner: alice.id, p_since: new Date(Date.now() - 3_600_000).toISOString() });
  assert.ok(recent.some((row) => row.habit_id === id && row.status === 'sent'));
  assert.equal((await rpc('persora_habit_reminders_recent', { p_owner: bob.id, p_since: '2000-01-01T00:00:00Z' })).length, 0);
  assert.equal(await rpc('persora_habit_reminders_mark_read', { p_owner: bob.id, p_id: null }), 0);
  assert.ok(await rpc('persora_habit_reminders_mark_read', { p_owner: alice.id, p_id: null }) >= 1);
  // Turning reminders off cancels the pending one.
  const latest = await rpc('persora_habit_get', { p_owner: alice.id, p_id: id });
  await rpc('persora_habit_save', { p_owner: alice.id, p_id: id, p_habit: values({ name: 'Meditate' }), p_expected_revision: latest.revision, p_reminders: [slot(id, '2026-10-26', '2030-01-02T00:00:00Z')] });
  assert.equal(await count("select count(*) from public.habit_reminders where habit_id = $1 and status = 'scheduled'", [id]), 0);
  assert.equal(await rpc('persora_calendar_dispatch_ping', {}), 'idle');
});

test('backup export and merge-restore: idempotent, never overwrites, foreign ids remapped', async () => {
  const source = await addMember('habit-backup');
  const { id } = await create(source, { name: 'Walk', category: 'fitness' });
  await rpc('persora_habit_checkin', { p_owner: source.id, p_habit: id, p_date: '2026-10-02', p_value: 1 });
  await rpc('persora_habit_checkin', { p_owner: source.id, p_habit: id, p_date: '2026-10-03', p_value: 1 });
  const exported = await rpc('persora_habits_export', { p_owner: source.id });
  assert.equal(exported.habits.length, 1);
  assert.equal(exported.checkins.length, 2);
  const habits = [{ source_id: id, values: values({ name: 'Walk', category: 'fitness' }), archived_at: null, created_at: exported.habits[0].created_at }];
  const checkins = exported.checkins.map((row) => ({ habit_source_id: row.habit_id, date: row.check_date, value: 1, target_value: null, completed: true }));
  // Restoring into the same account matches the habit and skips existing days.
  assert.deepEqual(await rpc('persora_habits_import', { p_owner: source.id, p_habits: habits, p_checkins: checkins }),
    { habits_created: 0, habits_matched: 1, checkins_added: 0, checkins_skipped: 2 });
  // Restoring into another account creates a copy with a fresh id (the original id is taken).
  const target = await addMember('habit-restore');
  const first = await rpc('persora_habits_import', { p_owner: target.id, p_habits: habits, p_checkins: [...checkins, { habit_source_id: crypto.randomUUID(), date: '2026-10-04', value: 1, completed: true }] });
  assert.deepEqual(first, { habits_created: 1, habits_matched: 0, checkins_added: 2, checkins_skipped: 1 });
  const copy = (await rpc('persora_habits_list', { p_owner: target.id, p_from: '2026-10-01', p_to: '2026-10-31' })).habits;
  assert.equal(copy.length, 1);
  assert.notEqual(copy[0].id, id);
  assert.deepEqual(copy[0].completed_dates, ['2026-10-02', '2026-10-03']);
  assert.equal((await rpc('persora_habit_get', { p_owner: source.id, p_id: id })).user_id, source.id, 'the original is untouched');
  assert.deepEqual(await rpc('persora_habits_import', { p_owner: target.id, p_habits: habits, p_checkins: checkins }),
    { habits_created: 0, habits_matched: 1, checkins_added: 0, checkins_skipped: 2 }, 'a remapped copy is recognised on the next restore');
  await rejects(rpc('persora_habits_import', { p_owner: target.id, p_habits: { not: 'an array' }, p_checkins: [] }), 'P0400');
});

test('schema.sql is safe to apply again and keeps existing data', async () => {
  const before = await count('select count(*) from public.habits');
  await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  assert.equal(await count('select count(*) from public.habits'), before);
});
