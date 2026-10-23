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

// ---------------------------------------------------------------------------
// Smart scheduling: item types, conflicts, free slots, filters, moving
// ---------------------------------------------------------------------------
import {
  ITEM_TYPES, blocksTime, defaultCalendarFilters, findConflicts, hiddenFilterCount, matchesCalendarFilters, movedTiming, normalizeCalendarFilters,
  overlaps, shiftLocalDays, suggestFreeSlots,
} from '../cloudflare/calendar-rules.js';

const timed = (date, start, end, extra = {}) => ({ itemType: 'event', title: 'X', allDay: false, timeZone: 'Asia/Dhaka', start: { date, time: start }, end: { date, time: end }, ...extra });

test('item types: tasks and appointments are validated; type can be forced on update', () => {
  assert.deepEqual([...ITEM_TYPES], ['event', 'task', 'appointment']);
  assert.equal(normalizeEventInput(timed('2026-10-27', '09:00', '10:00')).itemType, 'event');
  assert.equal(normalizeEventInput({ ...timed('2026-10-27', '09:00', '10:00'), itemType: undefined }).itemType, 'event', 'old clients without itemType create events');
  assert.equal(normalizeEventInput(timed('2026-10-27', '09:00', '09:30', { itemType: 'task' })).itemType, 'task');
  assert.equal(normalizeEventInput({ itemType: 'task', title: 'Due', allDay: true, start: { date: '2026-10-27' }, end: { date: '2026-10-27' } }).allDay, true, 'a task can be a due date');
  assert.throws(() => normalizeEventInput(timed('2026-10-27', '09:00', '10:00', { itemType: 'meeting' })), (error) => error.field === 'itemType');
  assert.throws(() => normalizeEventInput({ itemType: 'appointment', title: 'Dentist', allDay: true, start: { date: '2026-10-27' }, end: { date: '2026-10-27' } }), /need a start time/);
  assert.throws(() => normalizeEventInput(timed('2026-10-27', '09:00', '10:00', { itemType: 'task', recurrence: { freq: 'weekly' } })), (error) => error.field === 'recurrence');
  assert.throws(() => normalizeEventInput(timed('2026-10-27', '09:00', '10:00', { itemType: 'appointment', recurrence: { freq: 'daily' } })), (error) => error.field === 'recurrence');
  assert.equal(normalizeEventInput(timed('2026-10-27', '09:00', '10:00', { itemType: 'event' }), { itemType: 'task' }).itemType, 'task', 'updates keep the stored type');
});

test('conflicts: timed, half-open overlaps; completed tasks, all-day and cancelled items never block', () => {
  const zone = 'Asia/Dhaka';
  const at = (time, date = '2026-10-27') => zonedTimeToInstant(date, time, zone);
  const occ = (id, start, end, event = {}) => ({ id, startMs: at(start), endMs: at(end), allDay: false, event: { id, title: id, itemType: 'event', ...event } });
  assert.equal(overlaps(at('10:00'), at('11:00'), at('11:00'), at('12:00')), false, 'touching edges are fine');
  assert.equal(overlaps(at('10:00'), at('11:00'), at('10:59'), at('12:00')), true);
  assert.equal(blocksTime({ allDay: true, startDate: '2026-10-27', endDate: '2026-10-28', event: {} }), false);
  assert.equal(blocksTime(occ('done', '10:00', '11:00', { itemType: 'task', completedAt: '2026-10-26T00:00:00Z' })), false);
  assert.equal(blocksTime(occ('open', '10:00', '11:00', { itemType: 'task', completedAt: null })), true, 'scheduled open tasks count');
  assert.equal(blocksTime(occ('gone', '10:00', '11:00', { status: 'cancelled' })), false);
  const busy = [occ('a', '09:00', '10:00'), occ('b', '10:30', '11:30', { itemType: 'appointment' }), occ('c', '10:45', '11:15', { itemType: 'task' }), occ('d', '12:00', '13:00')].filter(blocksTime);
  const found = findConflicts([{ startMs: at('10:00'), endMs: at('11:00') }], busy);
  assert.deepEqual(found.map((entry) => entry.occurrence.id), ['b', 'c'], 'lists every overlap, in start order');
  // A series candidate list: each busy item is reported once.
  const weekly = findConflicts([{ startMs: at('09:30'), endMs: at('10:15') }, { startMs: at('09:30', '2026-11-03'), endMs: at('10:15', '2026-11-03') }], busy);
  assert.deepEqual(weekly.map((entry) => entry.occurrence.id), ['a']);
});

test('free-slot suggestions: nearby, free, inside the day, not in the past, DST-aware', () => {
  const zone = 'Asia/Dhaka';
  const at = (time, date = '2026-10-27') => zonedTimeToInstant(date, time, zone);
  const busy = [
    { id: 'm', startMs: at('09:00'), endMs: at('11:00'), allDay: false, event: { itemType: 'event' } },
    { id: 'n', startMs: at('11:30'), endMs: at('12:00'), allDay: false, event: { itemType: 'event' } },
  ];
  const slots = suggestFreeSlots({ startMs: at('10:00'), endMs: at('11:00'), busy, zone, nowMs: at('08:00') });
  assert.ok(slots.length >= 1 && slots.length <= 3);
  for (const slot of slots) {
    assert.equal(slot.endMs - slot.startMs, 3_600_000, 'keeps the duration');
    assert.ok(!busy.some((item) => overlaps(slot.startMs, slot.endMs, item.startMs, item.endMs)), 'is free');
    assert.ok(slot.startMs >= at('08:00'), 'not in the past');
    assert.ok(localTimeOf(slot.startMs, zone) >= '07:00' && localTimeOf(slot.endMs, zone) <= '22:00', 'within the day');
  }
  assert.equal(localTimeOf(slots[0].startMs, zone), '08:00', 'the nearest free hour before the meeting');
  assert.deepEqual(suggestFreeSlots({ startMs: at('10:00'), endMs: at('10:00'), busy, zone }), [], 'no suggestions for empty intervals');
  // New York on the day DST ends: slots stay on the quarter-hour grid in local time.
  const ny = 'America/New_York';
  const nyBusy = [{ id: 'x', startMs: zonedTimeToInstant('2026-11-01', '09:00', ny), endMs: zonedTimeToInstant('2026-11-01', '10:00', ny), allDay: false, event: {} }];
  const nySlots = suggestFreeSlots({ startMs: nyBusy[0].startMs, endMs: nyBusy[0].endMs, busy: nyBusy, zone: ny, nowMs: 0 });
  assert.ok(nySlots.length > 0 && nySlots.every((slot) => /:(00|15|30|45)$/.test(localTimeOf(slot.startMs, ny))));
});

test('filters: combinable, normalized, display-only facets', () => {
  const all = defaultCalendarFilters();
  assert.equal(hiddenFilterCount(all), 0);
  const event = { itemType: 'event', category: 'work', completedAt: null };
  const task = { itemType: 'task', category: null, completedAt: null };
  const done = { itemType: 'task', category: 'personal', completedAt: '2026-10-20T10:00:00Z' };
  const appointment = { itemType: 'appointment', category: 'health', completedAt: null };
  const legacy = { title: 'Old row without type', category: null };
  for (const item of [event, task, done, appointment, legacy]) assert.equal(matchesCalendarFilters(item, all), true);
  const noTasks = normalizeCalendarFilters({ types: { task: false } });
  assert.deepEqual([event, task, done, appointment, legacy].map((item) => matchesCalendarFilters(item, noTasks)), [true, false, false, true, true]);
  const noDone = normalizeCalendarFilters({ completed: false });
  assert.deepEqual([task, done].map((item) => matchesCalendarFilters(item, noDone)), [true, false]);
  const combo = normalizeCalendarFilters({ types: { appointment: false }, categories: { work: false, default: false } });
  assert.deepEqual([event, task, done, appointment, legacy].map((item) => matchesCalendarFilters(item, combo)), [false, false, true, false, false]);
  assert.equal(hiddenFilterCount(combo), 3);
  // Junk from storage or the network can't break anything.
  assert.deepEqual(normalizeCalendarFilters({ types: { task: 'no', bogus: false }, categories: 'x', completed: 0 }), { ...all, completed: true });
  assert.deepEqual(normalizeCalendarFilters(null), all);
});

test('moving: single items take the target; series shift by the same wall-clock change (DST-safe)', () => {
  const ny = 'America/New_York';
  // A one-off 9–10 AM item dragged to Thursday 2:15 PM, resized to 90 minutes.
  const single = { id: 'e', timeZone: ny, allDay: false, startAt: new Date(zonedTimeToInstant('2026-10-27', '09:00', ny)).toISOString(), endAt: new Date(zonedTimeToInstant('2026-10-27', '10:00', ny)).toISOString(), startDate: null, endDate: null, recurrence: null };
  const occurrence = { allDay: false, startMs: Date.parse(single.startAt), endMs: Date.parse(single.endAt) };
  const target = { allDay: false, startMs: zonedTimeToInstant('2026-10-29', '14:15', ny), endMs: zonedTimeToInstant('2026-10-29', '15:45', ny) };
  assert.deepEqual(movedTiming(single, occurrence, target), { allDay: false, start: { date: '2026-10-29', time: '14:15' }, end: { date: '2026-10-29', time: '15:45' } });
  // The event keeps its own zone even when the grid shows another one.
  const shownInDhaka = { allDay: false, startMs: zonedTimeToInstant('2026-10-30', '01:00', 'Asia/Dhaka'), endMs: zonedTimeToInstant('2026-10-30', '02:00', 'Asia/Dhaka') };
  assert.deepEqual(movedTiming(single, occurrence, shownInDhaka).start, { date: '2026-10-29', time: '15:00' });

  // Weekly Tuesdays 9 AM (EDT) series; the 3 Nov occurrence (after DST ends) is dragged to Wednesday 10 AM.
  const weekly = series({ title: 'Standup', allDay: false, start: { date: '2026-10-20', time: '09:00' }, end: { date: '2026-10-20', time: '09:30' }, recurrence: { freq: 'weekly' } });
  const nov3 = occurrenceOn({ ...weekly, id: 's1' }, '2026-11-03');
  const moved = { allDay: false, startMs: zonedTimeToInstant('2026-11-04', '10:00', ny), endMs: zonedTimeToInstant('2026-11-04', '10:45', ny) };
  const shifted = movedTiming(weekly, nov3, moved, 'shift');
  assert.deepEqual(shifted, { allDay: false, start: { date: '2026-10-21', time: '10:00' }, end: { date: '2026-10-21', time: '10:45' } }, 'the anchor moves a day and an hour in wall-clock terms, and takes the new length');
  // That series still lands at 10:00 local on both sides of the DST change.
  const next = series({ title: 'Standup', allDay: false, ...shifted, recurrence: { freq: 'weekly' } });
  const dates = expandOccurrences([{ ...next, id: 's2' }], '2026-10-20', '2026-11-12', ny).map((entry) => `${localDateOf(entry.startMs, ny)} ${localTimeOf(entry.startMs, ny)}`);
  assert.deepEqual(dates, ['2026-10-21 10:00', '2026-10-28 10:00', '2026-11-04 10:00', '2026-11-11 10:00']);

  // All-day: by whole days, keeping the span; series shift by the same number of days.
  const trip = { allDay: true, startDate: '2026-10-27', endDate: '2026-10-30' };
  assert.deepEqual(movedTiming({ id: 't', timeZone: ny, allDay: true, ...trip }, trip, { allDay: true, startDate: '2026-11-02', endDate: '2026-11-05' }),
    { allDay: true, start: { date: '2026-11-02' }, end: { date: '2026-11-04' } });
  const monthly = series({ title: 'Rent', allDay: true, start: { date: '2026-10-01' }, end: { date: '2026-10-01' }, recurrence: { freq: 'monthly' } });
  assert.deepEqual(movedTiming(monthly, { allDay: true, startDate: '2026-11-01', endDate: '2026-11-02' }, { allDay: true, startDate: '2026-11-03', endDate: '2026-11-04' }, 'shift'),
    { allDay: true, start: { date: '2026-10-03' }, end: { date: '2026-10-03' } });
  // Guards.
  assert.throws(() => movedTiming(single, occurrence, { allDay: true, startDate: '2026-10-29', endDate: '2026-10-30' }), CalendarValidationError);
  assert.throws(() => movedTiming(single, occurrence, { allDay: false, startMs: target.endMs, endMs: target.startMs }), /end must be after/);
  // Day shifts keep the wall-clock time across DST.
  assert.equal(localTimeOf(shiftLocalDays(zonedTimeToInstant('2026-10-31', '09:00', ny), 2, ny), ny), '09:00');
});
