// Shared calendar rules: dates, time zones (DST), validation, recurrence, reminders.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CalendarValidationError, addDays, addMonths, describeRecurrence, exceptionKey, expandOccurrences, isOccurrenceOf, localDateOf, localTimeOf,
  nextOccurrence, nextReminder, normalizeEventInput, occurrenceOn, recurrenceDates, reminderDedupeKey, reminderInstant, safeTimeZone,
  startOfDayInstant, startOfWeek, toRRule, zonedTimeToInstant,
} from '../cloudflare/calendar-rules.js';

const series = (input, zone = 'America/New_York') => ({ id: 's1', seriesId: null, status: 'confirmed', ...normalizeEventInput(input, { defaultTimeZone: zone }) });
const take = (iterator, n) => { const out = []; for (const value of iterator) { out.push(value); if (out.length >= n) break; } return out; };

test('date helpers handle month ends, leap years and week starts', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(startOfWeek('2026-10-23'), '2026-10-18'); // Sunday
});

test('wall-clock conversion across DST: gaps move forward, ambiguous times take the first instant', () => {
  const zone = 'America/New_York';
  assert.equal(new Date(zonedTimeToInstant('2026-03-08', '02:30', zone)).toISOString(), '2026-03-08T07:30:00.000Z'); // gap → 03:30 EDT
  assert.equal(new Date(zonedTimeToInstant('2026-11-01', '01:30', zone)).toISOString(), '2026-11-01T05:30:00.000Z'); // first 01:30 (EDT)
  assert.equal(localTimeOf(zonedTimeToInstant('2026-07-01', '09:00', zone), zone), '09:00');
  // Lord Howe has a 30-minute DST shift.
  const lh = zonedTimeToInstant('2026-10-04', '02:15', 'Australia/Lord_Howe');
  assert.equal(localTimeOf(lh, 'Australia/Lord_Howe'), '02:45');
  // Start of day is local midnight.
  assert.equal(localTimeOf(startOfDayInstant('2026-10-23', 'Asia/Dhaka'), 'Asia/Dhaka'), '00:00');
  assert.equal(safeTimeZone('Not/AZone', 'UTC'), 'UTC');
});

test('validation: titles, ordering, all-day dates, recurrence limits', () => {
  const base = { title: 'X', allDay: false, start: { date: '2026-10-23', time: '10:00' }, end: { date: '2026-10-23', time: '11:00' } };
  assert.throws(() => normalizeEventInput({ ...base, title: '  ' }), (error) => error instanceof CalendarValidationError && error.field === 'title' && error.status === 400);
  assert.throws(() => normalizeEventInput({ ...base, end: { date: '2026-10-23', time: '09:00' } }), /can't be before the start/);
  assert.throws(() => normalizeEventInput({ ...base, end: { date: '2026-10-23', time: '10:00' } }), /end after it starts/);
  assert.throws(() => normalizeEventInput({ ...base, start: { date: '2026-02-30', time: '10:00' } }));
  assert.throws(() => normalizeEventInput({ ...base, reminderMinutes: 7 }));
  assert.throws(() => normalizeEventInput({ ...base, recurrence: { freq: 'yearly' } }));
  assert.throws(() => normalizeEventInput({ ...base, recurrence: { freq: 'daily', until: '2026-10-01' } }));
  const allDay = normalizeEventInput({ title: 'Trip', allDay: true, start: { date: '2026-10-21' }, end: { date: '2026-10-23' } });
  assert.equal(allDay.startDate, '2026-10-21');
  assert.equal(allDay.endDate, '2026-10-24', 'all-day end is stored exclusive');
  assert.equal(allDay.startAt, null);
  assert.throws(() => normalizeEventInput({ title: 'Bad', allDay: true, start: { date: '2026-10-21' }, end: { date: '2026-10-20' } }));
  const timed = normalizeEventInput(base, { defaultTimeZone: 'Asia/Dhaka' });
  assert.equal(timed.startAt, '2026-10-23T04:00:00.000Z');
  assert.equal(timed.timeZone, 'Asia/Dhaka');
  assert.equal(normalizeEventInput({ ...base, reminderMinutes: null, reminderEmail: true }).reminderEmail, false, 'email needs a reminder');
  assert.equal(normalizeEventInput({ ...base, recurrence: { freq: 'daily' } }, { allowRecurrence: false }).recurrence, null, 'single-occurrence edits never carry a rule');
});

test('weekly series keeps 09:00 local across the DST change', () => {
  const event = series({ title: 'Sync', allDay: false, start: { date: '2026-10-26', time: '09:00' }, end: { date: '2026-10-26', time: '09:30' }, recurrence: { freq: 'weekly' } });
  const list = expandOccurrences([event], '2026-10-25', '2026-11-15', 'America/New_York');
  assert.equal(list.length, 3);
  for (const occurrence of list) assert.equal(localTimeOf(occurrence.startMs, 'America/New_York'), '09:00');
  assert.notEqual(list[0].startMs % 86400000, list[1].startMs % 86400000, 'UTC time shifts with DST');
});

test('monthly on the 31st skips short months; count and until end series', () => {
  assert.deepEqual(take(recurrenceDates('2026-01-31', { freq: 'monthly', interval: 1, until: null, count: null }), 4), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  assert.deepEqual([...recurrenceDates('2026-10-20', { freq: 'daily', interval: 2, until: null, count: 3 })], ['2026-10-20', '2026-10-22', '2026-10-24']);
  assert.deepEqual([...recurrenceDates('2026-10-20', { freq: 'weekly', interval: 1, until: '2026-11-03', count: null })], ['2026-10-20', '2026-10-27', '2026-11-03']);
});

test('exceptions override or cancel exactly one occurrence', () => {
  const master = series({ title: 'Standup', allDay: false, start: { date: '2026-10-19', time: '09:00' }, end: { date: '2026-10-19', time: '09:15' }, recurrence: { freq: 'daily', count: 5 } });
  const key = occurrenceOn(master, '2026-10-20').key;
  const moved = { ...master, id: 'e1', seriesId: 's1', recurrence: null, originalStartAt: key, title: 'Moved', startAt: '2026-10-20T15:00:00.000Z', endAt: '2026-10-20T15:30:00.000Z' };
  const cancelledKey = occurrenceOn(master, '2026-10-21').key;
  const cancelled = { ...master, id: 'e2', seriesId: 's1', recurrence: null, originalStartAt: cancelledKey, status: 'cancelled', startAt: cancelledKey, endAt: cancelledKey };
  const list = expandOccurrences([master, moved, cancelled], '2026-10-18', '2026-10-25', 'America/New_York');
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((o) => o.event.title), ['Standup', 'Moved', 'Standup', 'Standup']);
  assert.equal(list[1].exception, true);
  assert.equal(list[1].occurrenceKey, key);
  assert.equal(exceptionKey(moved), key);
  assert.ok(isOccurrenceOf(master, key));
  assert.ok(!isOccurrenceOf(master, '2026-10-20T14:00:00.000Z'));
  assert.ok(!isOccurrenceOf(master, occurrenceOn(master, '2026-10-30').key), 'beyond count');
});

test('all-day events are dates, never shifted by the display zone', () => {
  const event = series({ title: 'Holiday', allDay: true, start: { date: '2026-12-25' }, end: { date: '2026-12-25' } }, 'Pacific/Kiritimati');
  for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
    const list = expandOccurrences([event], '2026-12-20', '2026-12-27', zone);
    assert.equal(list.length, 1);
    assert.equal(list[0].startDate, '2026-12-25');
    assert.equal(list[0].endDate, '2026-12-26');
  }
  assert.equal(expandOccurrences([event], '2026-12-26', '2026-12-27', 'UTC').length, 0);
});

test('reminders: next reminder skips past and overridden occurrences; all-day anchors at 09:00', () => {
  const event = { ...series({ title: 'Sync', allDay: false, start: { date: '2026-10-26', time: '09:00' }, end: { date: '2026-10-26', time: '10:00' }, recurrence: { freq: 'weekly' }, reminderMinutes: 15 }) };
  const first = nextReminder(event, Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(first.remindAt, new Date(zonedTimeToInstant('2026-10-26', '08:45', 'America/New_York')).toISOString());
  const after = nextReminder(event, Date.parse(first.remindAt));
  assert.equal(localDateOf(Date.parse(after.occurrenceStart), 'America/New_York'), '2026-11-02');
  const skipped = nextReminder(event, Date.parse('2026-10-01T00:00:00Z'), new Set([first.occurrenceKey]));
  assert.equal(skipped.occurrenceKey, after.occurrenceKey);
  assert.equal(nextReminder({ ...event, reminderMinutes: null }, 0), null);
  const allDay = series({ title: 'Bills', allDay: true, start: { date: '2026-11-01' }, end: { date: '2026-11-01' }, reminderMinutes: 1440 }, 'Asia/Dhaka');
  const occurrence = occurrenceOn(allDay, '2026-11-01');
  assert.equal(new Date(reminderInstant(allDay, occurrence, 1440)).toISOString(), new Date(zonedTimeToInstant('2026-10-31', '09:00', 'Asia/Dhaka')).toISOString());
  assert.equal(nextReminder(allDay, Date.parse('2026-11-02T00:00:00Z')), null, 'single past event has no reminder');
  const r1 = '2026-10-26T12:45:00.000Z'; const r2 = '2026-10-26T12:30:00.000Z';
  assert.notEqual(reminderDedupeKey('a', first.occurrenceKey, r1), reminderDedupeKey('a', first.occurrenceKey, r2), 'a changed reminder time is a new reminder');
  assert.equal(reminderDedupeKey('a', first.occurrenceKey, r1), reminderDedupeKey('a', first.occurrenceKey, r1), 'same reminder → same key');
});

test('nextOccurrence, RRULE and descriptions (sync-ready)', () => {
  const event = series({ title: 'Rent', allDay: true, start: { date: '2026-11-01' }, end: { date: '2026-11-01' }, recurrence: { freq: 'monthly', count: 12 } });
  assert.equal(toRRule(event), 'RRULE:FREQ=MONTHLY;COUNT=12');
  assert.match(describeRecurrence(event), /month/i);
  assert.equal(nextOccurrence(event, Date.parse('2026-12-15T00:00:00Z')).startDate, '2027-01-01');
  const weekly = series({ title: 'X', allDay: false, start: { date: '2026-10-26', time: '09:00' }, end: { date: '2026-10-26', time: '10:00' }, recurrence: { freq: 'weekly', interval: 2, until: '2026-12-31' } });
  assert.match(toRRule(weekly), /^RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=2026123\dT\d{6}Z$/);
});
