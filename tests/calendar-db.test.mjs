// Calendar migration on PGlite (schema.sql + every migration): privileges/RLS,
// owner isolation, revisions, recurrence exceptions and the reminder queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { normalizeEventInput, nextReminder, reminderDedupeKey } from '../cloudflare/calendar-rules.js';

const ctx = await createVaultDatabase();
const { db, rpc, addMember } = ctx;
const alice = await addMember('cal-alice');
const bob = await addMember('cal-bob');

function values(input, zone = 'Asia/Dhaka') {
  const n = normalizeEventInput(input, { defaultTimeZone: zone });
  return {
    normalized: n,
    json: {
      title: n.title, description: n.description, location: n.location, category: n.category, all_day: n.allDay, time_zone: n.timeZone,
      start_at: n.startAt, end_at: n.endAt, start_date: n.startDate, end_date: n.endDate,
      recurrence_freq: n.recurrence?.freq || null, recurrence_interval: n.recurrence?.interval || 1,
      recurrence_until: n.recurrence?.until || null, recurrence_count: n.recurrence?.count || null,
      reminder_minutes: n.reminderMinutes, reminder_email: n.reminderEmail,
    },
  };
}
function reminderFor(id, n, after = Date.parse('2026-01-01T00:00:00Z')) {
  const next = nextReminder({ id, seriesId: null, status: 'confirmed', ...n }, after);
  if (!next) return null;
  return {
    occurrence_key: next.occurrenceKey, occurrence_start: next.occurrenceStart, occurrence_date: next.occurrenceDate, all_day: next.allDay,
    remind_at: next.remindAt, minutes_before: n.reminderMinutes, title: n.title, location: n.location, email: n.reminderEmail,
    dedupe_key: reminderDedupeKey(id, next.occurrenceKey, next.remindAt),
  };
}
async function save(owner, input, { id = crypto.randomUUID(), revision = null, reset = false, patches = [] } = {}) {
  const { normalized, json } = values(input);
  const result = await rpc('persora_calendar_save_event', {
    p_owner: owner.id, p_id: id, p_event: json, p_expected_revision: revision, p_reset_exceptions: reset,
    p_reminder: reminderFor(id, normalized), p_exception_patches: patches,
  });
  return { id, result, normalized };
}
const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; });
};
const reminders = async (where = 'true') => (await db.query(`select * from public.calendar_reminders where ${where} order by created_at`)).rows;
const timed = (title, date, from, to, extra = {}) => ({ title, allDay: false, start: { date, time: from }, end: { date, time: to }, ...extra });

test('tables are closed to anon/authenticated; RPCs only for service_role', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await rejects(db.query('select * from public.calendar_events'), '42501');
      await rejects(db.query('select * from public.calendar_reminders'), '42501');
      await rejects(db.query(`select public.persora_calendar_search('${alice.id}', 'x', 5)`), '42501');
      await rejects(db.query('select public.persora_calendar_claim_reminders(5, null)'), '42501');
    } finally { await db.exec('reset role'); }
  }
  const rls = await db.query("select relname, relrowsecurity from pg_class where relname in ('calendar_events', 'calendar_reminders')");
  assert.ok(rls.rows.every((row) => row.relrowsecurity));
  await db.exec('set role service_role');
  try { await rejects(db.query(`select public.persora_calendar_set_reminder('${alice.id}', gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)`), '42501'); }
  finally { await db.exec('reset role'); }
});

test('owner isolation: other members cannot read, search, update or delete', async () => {
  const { id } = await save(alice, timed('Alice private planning', '2026-11-02', '10:00', '11:00'));
  const mine = await rpc('persora_calendar_events_in_range', { p_owner: alice.id, p_from: '2026-11-01T00:00:00Z', p_to: '2026-11-04T00:00:00Z', p_from_date: '2026-11-01', p_to_date: '2026-11-04' });
  assert.ok(mine.some((row) => row.id === id));
  const theirs = await rpc('persora_calendar_events_in_range', { p_owner: bob.id, p_from: '2026-11-01T00:00:00Z', p_to: '2026-11-04T00:00:00Z', p_from_date: '2026-11-01', p_to_date: '2026-11-04' });
  assert.equal(theirs.length, 0);
  assert.equal((await rpc('persora_calendar_search', { p_owner: alice.id, p_query: 'planning', p_limit: 10 })).length, 1);
  assert.equal((await rpc('persora_calendar_search', { p_owner: bob.id, p_query: 'planning', p_limit: 10 })).length, 0);
  await rejects(save(bob, timed('Hijack', '2026-11-02', '10:00', '11:00'), { id, revision: 1 }), 'P0404');
  await rejects(rpc('persora_calendar_delete_event', { p_owner: bob.id, p_id: id, p_expected_revision: null }), 'P0404');
  const row = (await db.query('select title, user_id from public.calendar_events where id = $1', [id])).rows[0];
  assert.equal(row.title, 'Alice private planning');
  assert.equal(row.user_id, alice.id);
});

test('search escapes LIKE wildcards and ranks prefix matches first', async () => {
  await save(alice, timed('100% done party', '2026-11-05', '18:00', '19:00'));
  await save(alice, timed('Plan the party', '2026-11-06', '18:00', '19:00'));
  assert.deepEqual((await rpc('persora_calendar_search', { p_owner: alice.id, p_query: '100%', p_limit: 10 })).map((row) => row.title), ['100% done party']);
  assert.equal((await rpc('persora_calendar_search', { p_owner: alice.id, p_query: '_', p_limit: 10 })).length, 0);
  assert.equal((await rpc('persora_calendar_search', { p_owner: alice.id, p_query: 'plan', p_limit: 10 }))[0].title, 'Plan the party', 'prefix match ranks first');
  assert.equal((await rpc('persora_calendar_search', { p_owner: alice.id, p_query: 'PARTY', p_limit: 10 })).length, 2, 'case-insensitive');
});

test('revisions: stale updates are rejected with P0409; constraints reject bad rows', async () => {
  const { id } = await save(alice, timed('Revisioned', '2026-11-10', '10:00', '11:00'));
  const updated = await save(alice, timed('Revisioned v2', '2026-11-10', '10:00', '11:00'), { id, revision: 1 });
  assert.equal(updated.result.event.revision, 2);
  await rejects(save(alice, timed('Stale', '2026-11-10', '10:00', '11:00'), { id, revision: 1 }), 'P0409');
  await rejects(rpc('persora_calendar_delete_event', { p_owner: alice.id, p_id: id, p_expected_revision: 1 }), 'P0409');
  const { json } = values(timed('Bad', '2026-11-10', '10:00', '11:00'));
  await rejects(rpc('persora_calendar_save_event', { p_owner: alice.id, p_id: crypto.randomUUID(), p_event: { ...json, end_at: json.start_at }, p_expected_revision: null, p_reset_exceptions: false, p_reminder: null, p_exception_patches: [] }), '23514');
  await rejects(rpc('persora_calendar_save_event', { p_owner: alice.id, p_id: crypto.randomUUID(), p_event: { ...json, title: '' }, p_expected_revision: null, p_reset_exceptions: false, p_reminder: null, p_exception_patches: [] }), '23514');
});

test('single-occurrence edits create one exception row and leave the series untouched', async () => {
  const input = timed('Standup', '2026-11-16', '09:00', '09:15', { recurrence: { freq: 'daily', count: 5 }, reminderMinutes: 15 });
  const { id: seriesId, normalized } = await save(alice, input);
  const key = '2026-11-17T03:00:00.000Z'; // 09:00 Dhaka
  const exceptionId = crypto.randomUUID();
  const moved = values(timed('Standup (late)', '2026-11-17', '11:00', '11:15')).json;
  const call = (status, id = exceptionId, json = moved, revision = null) => rpc('persora_calendar_save_occurrence', {
    p_owner: alice.id, p_series_id: seriesId, p_exception_id: id, p_original_start_at: key, p_original_start_date: null,
    p_status: status, p_event: json, p_expected_revision: revision, p_reminder: null, p_series_reminder: reminderFor(seriesId, normalized),
  });
  const first = await call('confirmed');
  assert.equal(first.event.series_id, seriesId);
  assert.equal(first.series.title, 'Standup');
  // The same original occurrence maps to the same row even with a new id.
  const again = await call('confirmed', crypto.randomUUID(), { ...moved, title: 'Standup (later)' }, null);
  assert.equal(again.event.id, exceptionId);
  const rows = (await db.query('select * from public.calendar_events where series_id = $1', [seriesId])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Standup (later)');
  const master = (await db.query('select title, recurrence_freq, revision from public.calendar_events where id = $1', [seriesId])).rows[0];
  assert.deepEqual([master.title, master.recurrence_freq], ['Standup', 'daily']);
  // Cancelling keeps the row (so the occurrence stays hidden) with status cancelled.
  const cancelled = await call('cancelled', exceptionId, moved, again.event.revision);
  assert.equal(cancelled.event.status, 'cancelled');
  // Another member cannot attach exceptions to this series.
  await rejects(rpc('persora_calendar_save_occurrence', {
    p_owner: bob.id, p_series_id: seriesId, p_exception_id: crypto.randomUUID(), p_original_start_at: '2026-11-18T03:00:00.000Z', p_original_start_date: null,
    p_status: 'confirmed', p_event: moved, p_expected_revision: null, p_reminder: null, p_series_reminder: null,
  }), 'P0404');
  // Exceptions can't themselves repeat, and resetting a series removes them.
  const noRule = await call('confirmed', crypto.randomUUID(), { ...moved, recurrence_freq: 'daily', recurrence_count: 3 });
  assert.equal(noRule.event.recurrence_freq, null, 'an occurrence never stores its own repeat rule');
  const reset = await save(alice, timed('Standup', '2026-11-16', '08:30', '08:45', { recurrence: { freq: 'daily', count: 5 } }), { id: seriesId, revision: master.revision, reset: true });
  assert.equal(reset.result.exceptions.length, 0);
  assert.equal((await db.query('select count(*)::int as n from public.calendar_events where series_id = $1', [seriesId])).rows[0].n, 0);
});

test('series field edits propagate to exceptions through patches', async () => {
  const input = timed('Gym', '2026-11-16', '18:00', '19:00', { recurrence: { freq: 'weekly' } });
  const { id: seriesId } = await save(alice, input);
  const exceptionId = crypto.randomUUID();
  await rpc('persora_calendar_save_occurrence', {
    p_owner: alice.id, p_series_id: seriesId, p_exception_id: exceptionId, p_original_start_at: '2026-11-23T12:00:00.000Z', p_original_start_date: null,
    p_status: 'confirmed', p_event: values(timed('Gym', '2026-11-23', '19:00', '20:00')).json, p_expected_revision: null, p_reminder: null, p_series_reminder: null,
  });
  const result = await save(alice, timed('Gym class', '2026-11-16', '18:00', '19:00', { recurrence: { freq: 'weekly' }, location: 'Downtown' }), {
    id: seriesId, revision: 1, patches: [{ id: exceptionId, title: 'Gym class', location: 'Downtown' }],
  });
  assert.equal(result.result.exceptions.length, 1);
  const exception = (await db.query('select title, location, start_at from public.calendar_events where id = $1', [exceptionId])).rows[0];
  assert.equal(exception.title, 'Gym class');
  assert.equal(exception.location, 'Downtown');
  assert.equal(new Date(exception.start_at).toISOString(), '2026-11-23T13:00:00.000Z', 'moved time kept');
});

test('reminder queue: one scheduled row per event, exclusive claims, no duplicates', async () => {
  const { id, normalized } = await save(alice, timed('Dentist', '2026-11-20', '16:00', '16:45', { reminderMinutes: 30, reminderEmail: true }));
  let rows = await reminders(`event_id = '${id}'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'scheduled');
  assert.equal(new Date(rows[0].remind_at).toISOString(), '2026-11-20T09:30:00.000Z');
  // Editing the time cancels the old reminder and schedules a new one.
  await save(alice, timed('Dentist', '2026-11-20', '17:00', '17:45', { reminderMinutes: 30, reminderEmail: true }), { id, revision: 1 });
  rows = await reminders(`event_id = '${id}'`);
  assert.deepEqual(rows.map((row) => row.status).sort(), ['cancelled', 'scheduled']);
  // Saving the same reminder again is idempotent (same dedupe key).
  await save(alice, timed('Dentist', '2026-11-20', '17:00', '17:45', { reminderMinutes: 30, reminderEmail: true }), { id, revision: 2 });
  assert.equal((await reminders(`event_id = '${id}' and status = 'scheduled'`)).length, 1);
  // Not due yet → nothing to claim.
  assert.equal((await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: alice.id })).length, 0);
  await db.query(`update public.calendar_reminders set remind_at = now() - interval '1 minute' where event_id = $1 and status = 'scheduled'`, [id]);
  const claimed = await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: alice.id });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].reminder.email_status, 'sending');
  assert.equal(claimed[0].owner.email, alice.email);
  assert.equal((await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: alice.id })).length, 0, 'claimed rows are not claimed twice');
  assert.equal((await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: bob.id })).length, 0, 'owner filter');
  // Only the claim holder can complete it, and only once.
  assert.equal(await rpc('persora_calendar_complete_reminder', { p_id: claimed[0].reminder.id, p_claimed_at: '2000-01-01T00:00:00Z', p_email_status: 'sent', p_email_note: null, p_event_revision: 3, p_next: null }), false);
  assert.equal(await rpc('persora_calendar_complete_reminder', { p_id: claimed[0].reminder.id, p_claimed_at: claimed[0].reminder.claimed_at, p_email_status: 'sent', p_email_note: null, p_event_revision: 3, p_next: null }), true);
  assert.equal(await rpc('persora_calendar_complete_reminder', { p_id: claimed[0].reminder.id, p_claimed_at: claimed[0].reminder.claimed_at, p_email_status: 'sent', p_email_note: null, p_event_revision: 3, p_next: null }), false);
  const sent = (await reminders(`id = '${claimed[0].reminder.id}'`))[0];
  assert.deepEqual([sent.status, sent.email_status], ['sent', 'sent']);
  // Re-saving after delivery never revives a sent reminder.
  await save(alice, timed('Dentist', '2026-11-20', '17:00', '17:45', { reminderMinutes: 30, reminderEmail: true }), { id, revision: 3 });
  assert.equal((await reminders(`id = '${claimed[0].reminder.id}'`))[0].status, 'sent');
  void normalized;
});

test('recurring reminders roll forward once; edits during delivery win; deletes cascade', async () => {
  const input = timed('Weekly review', '2026-11-16', '10:00', '11:00', { recurrence: { freq: 'weekly', count: 3 }, reminderMinutes: 15 });
  const { id, normalized } = await save(alice, input);
  await db.query(`update public.calendar_reminders set remind_at = now() - interval '1 minute' where event_id = $1 and status = 'scheduled'`, [id]);
  const [entry] = await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: alice.id });
  assert.equal(entry.reminder.email_status, 'not_requested');
  // The dispatcher computes the next reminder after the one just delivered (its original time).
  const next = reminderFor(id, normalized, Date.parse(entry.reminder.occurrence_start) - 15 * 60_000);
  assert.equal(next.occurrence_start, '2026-11-23T04:00:00.000Z');
  assert.equal(await rpc('persora_calendar_complete_reminder', { p_id: entry.reminder.id, p_claimed_at: entry.reminder.claimed_at, p_email_status: 'not_requested', p_email_note: null, p_event_revision: entry.event.revision, p_next: next }), true);
  const scheduled = await reminders(`event_id = '${id}' and status = 'scheduled'`);
  assert.equal(scheduled.length, 1);
  assert.equal(new Date(scheduled[0].remind_at).toISOString(), next.remind_at);

  // A stale completion (event edited meanwhile) must not schedule an extra reminder.
  await db.query(`update public.calendar_reminders set remind_at = now() - interval '1 minute' where id = $1`, [scheduled[0].id]);
  const [second] = await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: alice.id });
  await save(alice, { ...input, title: 'Weekly review (moved)' }, { id, revision: entry.event.revision });
  const beforeCount = (await reminders(`event_id = '${id}' and status = 'scheduled'`)).length;
  await rpc('persora_calendar_complete_reminder', { p_id: second.reminder.id, p_claimed_at: second.reminder.claimed_at, p_email_status: 'not_requested', p_email_note: null, p_event_revision: second.event.revision, p_next: { ...next, dedupe_key: 'stale-next', remind_at: '2027-01-01T00:00:00Z' } });
  assert.equal((await reminders(`event_id = '${id}' and status = 'scheduled'`)).length, beforeCount);
  assert.equal((await reminders(`dedupe_key = 'stale-next'`)).length, 0);

  await rpc('persora_calendar_delete_event', { p_owner: alice.id, p_id: id, p_expected_revision: null });
  assert.equal((await reminders(`root_id = '${id}'`)).length, 0, 'reminders are removed with the event');
});

test('claims skip inactive accounts but report unverified email for skipping', async () => {
  const { id } = await save(bob, timed('Bob call', '2026-11-25', '10:00', '10:30', { reminderMinutes: 5, reminderEmail: true }));
  await db.query(`update public.calendar_reminders set remind_at = now() - interval '1 minute' where event_id = $1`, [id]);
  const [entry] = await rpc('persora_calendar_claim_reminders', { p_limit: 10, p_owner: bob.id });
  assert.equal(entry.owner.email_verified, false);
  assert.equal(entry.owner.active, true);
  assert.equal(await rpc('persora_calendar_complete_reminder', { p_id: entry.reminder.id, p_claimed_at: entry.reminder.claimed_at, p_email_status: 'skipped', p_email_note: 'The email address isn\'t verified.', p_event_revision: entry.event.revision, p_next: null }), true);
  await rejects(rpc('persora_calendar_complete_reminder', { p_id: entry.reminder.id, p_claimed_at: entry.reminder.claimed_at, p_email_status: 'bogus', p_email_note: null, p_event_revision: 1, p_next: null }), 'P0400');
});
