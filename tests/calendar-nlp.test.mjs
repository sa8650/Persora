import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeEventInput } from '../cloudflare/calendar-rules.js';
import { parseQuickAdd, quickAddToInput, resolveQuickAdd } from '../src/lib/calendar-nlp.js';

// Saturday 24 October 2026, 10:00 in Dhaka (UTC+6, no DST).
const NOW = Date.parse('2026-10-24T04:00:00Z');
const ZONE = 'Asia/Dhaka';
const parse = (text, options = {}) => parseQuickAdd(text, { now: NOW, zone: ZONE, ...options });
const ids = (result) => result.questions.map((question) => question.id).sort();
const answer = (result, id, index) => ({ [id]: result.questions.find((question) => question.id === id).options[index].patch });
const toInput = (result, options = {}, zone = ZONE) => quickAddToInput(resolveQuickAdd(result, options).fields, { zone });

test('the four examples from the brief parse without questions', () => {
  const meeting = parse('Meeting tomorrow at 3 PM');
  assert.equal(meeting.title, 'Meeting');
  assert.equal(meeting.date, '2026-10-25');
  assert.equal(meeting.startTime, '15:00');
  assert.equal(meeting.endTime, '16:00', 'events default to one hour');
  assert.equal(meeting.allDay, false);
  assert.deepEqual(meeting.questions, []);

  const study = parse('Study every Friday from 7 to 9 PM');
  assert.equal(study.title, 'Study');
  assert.equal(study.date, '2026-10-30', 'first Friday on or after today');
  assert.deepEqual([study.startTime, study.endTime], ['19:00', '21:00'], '"7 to 9 PM" puts both in the evening');
  assert.deepEqual(study.recurrence, { freq: 'weekly', interval: 1, until: null, count: null });
  assert.deepEqual(study.questions, []);

  const assignment = parse('Submit assignment next Monday, due at 11 AM');
  assert.equal(assignment.title, 'Submit assignment');
  assert.equal(assignment.itemType, 'task', '"due" and "submit" suggest a task');
  assert.equal(assignment.date, '2026-10-26', 'on a Saturday, the coming Monday is also next week\'s Monday (weeks start Sunday)');
  assert.equal(assignment.startTime, '11:00');
  assert.deepEqual(assignment.questions, []);

  const doctor = parse('Doctor appointment on November 5 at 10 AM, remind me 30 minutes before');
  assert.equal(doctor.title, 'Doctor appointment');
  assert.equal(doctor.itemType, 'appointment');
  assert.equal(doctor.date, '2026-11-05');
  assert.deepEqual([doctor.startTime, doctor.endTime], ['10:00', '10:30'], 'appointments default to 30 minutes');
  assert.equal(doctor.reminderMinutes, 30);
  assert.deepEqual(doctor.questions, []);
  const input = toInput(doctor);
  const saved = normalizeEventInput(input, { defaultTimeZone: ZONE });
  assert.equal(saved.itemType, 'appointment');
  assert.equal(saved.startAt, '2026-11-05T04:00:00.000Z');
  assert.equal(saved.reminderMinutes, 30);
});

test('an hour without AM/PM is asked about, never guessed', () => {
  const result = parse('Lunch tomorrow at 3');
  assert.equal(result.startTime, null);
  assert.deepEqual(ids(result), ['time']);
  assert.deepEqual(result.questions[0].options.map((option) => option.label), ['3 AM', '3 PM']);
  assert.equal(toInput(result), null, 'nothing to save until it is answered');
  const { fields, open } = resolveQuickAdd(result, { answers: answer(result, 'time', 1) });
  assert.deepEqual(open, []);
  assert.deepEqual([fields.startTime, fields.endTime, fields.allDay], ['15:00', '16:00', false]);
  assert.equal(parse('Lunch tomorrow at 12').questions[0].options[1].patch.startTime, '12:00', '12 PM is noon');
  assert.equal(parse('Lunch tomorrow at 12').questions[0].options[0].patch.startTime, '00:00', '12 AM is midnight');
  // Words that settle it.
  assert.equal(parse('Call tomorrow at 3 in the afternoon').startTime, '15:00');
  assert.equal(parse('Run tomorrow morning at 6').startTime, '06:00');
  assert.equal(parse('Dinner tonight at 8').startTime, '20:00');
  assert.equal(parse('Dinner tonight at 8').date, '2026-10-24');
  // 24-hour and explicit forms need no question.
  for (const [text, time] of [['Sync tomorrow 15:30', '15:30'], ['Sync tomorrow 09:30', '09:30'], ['Sync tomorrow at noon', '12:00'], ['Sync tomorrow 7:45pm', '19:45'], ['Sync tomorrow 7 p.m.', '19:00']]) {
    const parsed = parse(text);
    assert.equal(parsed.startTime, time, text);
    assert.deepEqual(parsed.questions, [], text);
  }
  // A bare number is part of the title, not a time.
  assert.equal(parse('Chapter 4 review tomorrow').title, 'Chapter 4 review');
  assert.equal(parse('Chapter 4 review tomorrow').allDay, true);
});

test('ambiguous and invalid dates ask; clear ones resolve', () => {
  const numeric = parse('Call 5/11 at 2pm');
  assert.equal(numeric.date, null);
  assert.deepEqual(numeric.questions.map((question) => question.options.map((option) => option.patch.date)), [['2026-11-05', '2027-05-11']]);
  assert.equal(parse('Party 25/12 at 7pm').date, '2026-12-25', 'only one reading is valid');
  assert.equal(parse('Party 12/25 at 7pm').date, '2026-12-25');
  assert.equal(parse('Trip 2027-01-15').date, '2027-01-15');
  assert.equal(parse('Trip 15 January').date, '2027-01-15', 'a passed month/day rolls to next year');
  assert.equal(parse('Trip January 15, 2028').date, '2028-01-15');
  assert.equal(parse('Rent on the 1st').date, '2026-11-01');
  assert.equal(parse('Report on the 24th').date, '2026-10-24', 'today still counts');
  const invalid = parse('Board meeting 31/11');
  assert.deepEqual(ids(invalid), ['date']);
  assert.match(invalid.questions[0].message, /isn't a valid date/);
  assert.match(parse('Dinner November 31 at 7pm').questions[0].message, /isn't a valid date/);
  // Weekday and date that disagree.
  const mismatch = parse('Workshop Monday, November 6 at 10am');
  assert.deepEqual(ids(mismatch), ['date']);
  assert.deepEqual(mismatch.questions[0].options.map((option) => option.patch.date), ['2026-11-06', '2026-10-26']);
  assert.deepEqual(parse('Workshop Friday, November 6 at 10am').questions, []);
});

test('"next <weekday>" asks when it could mean two dates', () => {
  const monday = Date.parse('2026-10-26T04:00:00Z'); // Monday
  const result = parseQuickAdd('Party next Wednesday at 8pm', { now: monday, zone: ZONE });
  assert.equal(result.date, null);
  assert.deepEqual(result.questions[0].options.map((option) => option.patch.date), ['2026-10-28', '2026-11-04']);
  const resolved = resolveQuickAdd(result, { answers: answer(result, 'date', 1) });
  assert.equal(resolved.fields.date, '2026-11-04');
  assert.deepEqual(resolved.open, []);
  assert.equal(parseQuickAdd('Party this Wednesday at 8pm', { now: monday, zone: ZONE }).date, '2026-10-28');
  assert.equal(parseQuickAdd('Party Wednesday at 8pm', { now: monday, zone: ZONE }).date, '2026-10-28');
  assert.equal(parseQuickAdd('Party next Monday at 8pm', { now: monday, zone: ZONE }).date, '2026-11-02', 'next Monday on a Monday is a week later');
  assert.equal(parseQuickAdd('Party on fri at 8pm', { now: monday, zone: ZONE }).date, '2026-10-30');
  const week = parse('Catch up next week');
  assert.deepEqual(ids(week), ['date']);
  assert.ok(week.questions[0].options.every((option) => option.patch.date > '2026-10-24'));
});

test('missing dates are asked about unless the slot provides one', () => {
  const noDay = parse('Standup at 9:30am');
  assert.deepEqual(ids(noDay), ['date']);
  assert.deepEqual(noDay.questions[0].options.map((option) => option.label), ['Tomorrow'], '9:30 has passed today, so only tomorrow is offered');
  assert.deepEqual(parse('Standup at 4pm').questions[0].options.map((option) => option.label), ['Today', 'Tomorrow']);
  const fromSlot = parse('Standup at 9:30am', { context: { date: '2026-10-28', time: '14:00' } });
  assert.equal(fromSlot.date, '2026-10-28');
  assert.equal(fromSlot.startTime, '09:30', 'typed time beats the slot time');
  const slotOnly = parse('Planning', { context: { date: '2026-10-28', time: '14:00' } });
  assert.equal(slotOnly.hasSchedule, false);
  assert.deepEqual(slotOnly.questions, [], 'the clicked slot supplies the time');
  const header = parse('Planning');
  assert.deepEqual(ids(header), ['date'], 'from the header, a title alone gets asked "when?"');
  const dateOnly = parse('Planning Friday', { context: { date: '2026-10-28', time: '14:00' } });
  assert.deepEqual([dateOnly.date, dateOnly.startTime, dateOnly.allDay], ['2026-10-30', '14:00', false]);
  const repeating = parse('Read every 3 days');
  assert.deepEqual(repeating.recurrence, { freq: 'daily', interval: 3, until: null, count: null });
  assert.deepEqual(ids(repeating), ['date'], 'a repeat with no start day asks where it starts');
  const appointment = parse('Haircut Friday');
  assert.equal(appointment.itemType, 'appointment');
  assert.deepEqual(ids(appointment), ['time'], 'appointments need a time');
  assert.equal(toInput(appointment), null);
  assert.ok(resolveQuickAdd(appointment, { touched: ['time'] }).open.length === 0, 'setting the time by hand settles it');
});

test('unsupported repeats ask instead of approximating', () => {
  for (const text of ['Gym every Monday and Wednesday at 6pm', 'Gym every mon, wed at 6pm', 'Standup every weekday at 9am', 'Birthday every year on May 4', 'Review every last Friday at 4pm']) {
    const result = parse(text);
    assert.equal(result.recurrence, null, text);
    assert.ok(result.questions.some((question) => question.id === 'repeat'), text);
  }
  const biweekly = parse('Sync biweekly on Tuesday at 3pm');
  assert.deepEqual(biweekly.questions.find((question) => question.id === 'repeat').options.map((option) => option.label), ['Every 2 weeks', 'Weekly', "Don't repeat"]);
  const fixed = resolveQuickAdd(biweekly, { answers: answer(biweekly, 'repeat', 0) });
  assert.deepEqual(fixed.fields.recurrence, { until: null, count: null, freq: 'weekly', interval: 2 });
  // Supported forms.
  assert.deepEqual(parse('Yoga every other Tuesday 6:30am').recurrence, { freq: 'weekly', interval: 2, until: null, count: null });
  assert.deepEqual(parse('Yoga on Tuesdays at 6:30am').recurrence, { freq: 'weekly', interval: 1, until: null, count: null });
  assert.deepEqual(parse('Rent monthly on the 1st').recurrence, { freq: 'monthly', interval: 1, until: null, count: null });
  assert.deepEqual(parse('Sync fortnightly on Tuesday at 3pm').recurrence, { freq: 'weekly', interval: 2, until: null, count: null });
  assert.deepEqual(parse('Run daily at 6am 10 times', { context: { date: '2026-10-25', time: null } }).recurrence, { freq: 'daily', interval: 1, until: null, count: 10 });
  assert.equal(parse('Yoga every other Tuesday 6:30am for 8 weeks').recurrence.until, '2026-12-21');
  assert.equal(parse('Gym every Monday 6pm until Dec 31').recurrence.until, '2026-12-31');
  assert.equal(parse('Gym every Monday 6pm until Dec 31').date, '2026-10-26', '"until" ends the repeat, it is not the start date');
  // Tasks and appointments can't repeat.
  const task = parse('Water plants every Sunday', { itemType: 'task' });
  assert.ok(task.questions.some((question) => question.id === 'repeat'));
  assert.equal(toInput(task, { itemType: 'task' }).recurrence, null, 'a task never sends a repeat');
  const asEvent = resolveQuickAdd(task, { answers: answer(task, 'repeat', 0), itemType: 'task' });
  assert.equal(asEvent.fields.itemType, 'event');
  assert.deepEqual(asEvent.open, []);
});

test('reminders: presets parse, anything else asks for the nearest preset', () => {
  assert.equal(parse('Call tomorrow at 5pm, remind me 15 minutes before').reminderMinutes, 15);
  assert.equal(parse('Call tomorrow at 5pm remind me an hour before').reminderMinutes, 60);
  assert.equal(parse('Call tomorrow at 5pm remind me 1 day before').reminderMinutes, 1440);
  assert.equal(parse('Call tomorrow at 5pm remind me the day before').reminderMinutes, 1440);
  assert.equal(parse('Call tomorrow at 5pm with a 30 minute reminder').reminderMinutes, 30);
  assert.equal(parse('Call tomorrow at 5pm').reminderMinutes, undefined);
  const odd = parse('Call mom tomorrow at 5pm, remind me 20 minutes before');
  assert.equal(odd.title, 'Call mom');
  assert.equal(odd.reminderMinutes, null);
  assert.deepEqual(odd.questions[0].options.map((option) => option.patch.reminderMinutes), [15, 30]);
  assert.equal(resolveQuickAdd(odd, { answers: answer(odd, 'reminder', 1) }).fields.reminderMinutes, 30);
  const vague = parse('Call tomorrow at 5pm remind me');
  assert.equal(vague.questions[0].id, 'reminder');
  assert.equal(vague.questions[0].options.length, 5);
});

test('time ranges, crossing midnight and durations', () => {
  assert.deepEqual(pick(parse('Exam tomorrow 11 to 1 PM')), ['11:00', '13:00']);
  assert.deepEqual(pick(parse('Exam tomorrow 9am-5')), ['09:00', '17:00']);
  assert.deepEqual(pick(parse('Exam tomorrow 9 to 12 in the morning')), ['09:00', '12:00']);
  assert.deepEqual(pick(parse('Exam tomorrow between 2 and 4pm')), ['14:00', '16:00']);
  assert.deepEqual(pick(parse('Exam tomorrow 14:00-15:30')), ['14:00', '15:30']);
  assert.deepEqual(pick(parse('Exam tomorrow at 2pm until 4')), ['14:00', '16:00']);
  const vague = parse('Movie tomorrow from 9 to 11');
  assert.deepEqual(vague.questions[0].options.map((option) => [option.patch.startTime, option.patch.endTime]), [['09:00', '11:00'], ['21:00', '23:00']]);
  assert.equal(parse('Movie tomorrow 5-11').startTime, null, '"5-11" alone is not read as a time');
  const overnight = parse('Night shift tomorrow 10pm-6am');
  assert.deepEqual(pick(overnight), ['22:00', '06:00']);
  const input = toInput(overnight);
  assert.deepEqual(input.end, { date: '2026-10-26', time: '06:00' }, 'ends the next morning');
  assert.doesNotThrow(() => normalizeEventInput(input, { defaultTimeZone: ZONE }));
  assert.deepEqual(pick(parse('Deep work tomorrow at 9am for 90 minutes')), ['09:00', '10:30']);
  assert.deepEqual(pick(parse('Deep work tomorrow at 9am for an hour and a half')), ['09:00', '10:30']);
  assert.deepEqual(pick(parse('Deep work tomorrow at 9am for 1.5 hours')), ['09:00', '10:30']);
  assert.deepEqual(pick(parse('Flight 2026-12-01 22:00 for 3 hours')), ['22:00', '01:00']);
  assert.equal(parse('Flight 2026-12-01 22:00 for 3 hours').endDate, '2026-12-02');
  const soon = parse('Meet Sam in 2 hours');
  assert.deepEqual([soon.date, soon.startTime], ['2026-10-24', '12:00']);
  assert.deepEqual([parse('Ping in 3 days').date, parse('Ping in 2 weeks').date], ['2026-10-27', '2026-11-07']);
});
const pick = (result) => [result.startTime, result.endTime];

test('time zones: relative dates use the profile zone; instants handle DST', () => {
  const evening = Date.parse('2026-10-24T20:00:00Z'); // 02:00 Sun in Dhaka, 16:00 Sat in New York
  assert.equal(parseQuickAdd('Call tomorrow at 9am', { now: evening, zone: 'Asia/Dhaka' }).date, '2026-10-26');
  assert.equal(parseQuickAdd('Call tomorrow at 9am', { now: evening, zone: 'America/New_York' }).date, '2026-10-25');
  assert.equal(parseQuickAdd('Call today', { now: evening, zone: 'Pacific/Kiritimati' }).date, '2026-10-25');
  // New York leaves DST on 1 November 2026: 9 AM is 13:00Z before and 14:00Z after.
  const ny = (text) => normalizeEventInput(toInput(parseQuickAdd(text, { now: evening, zone: 'America/New_York' }), {}, 'America/New_York'), { defaultTimeZone: 'UTC' });
  assert.equal(ny('Standup October 30 at 9am').startAt, '2026-10-30T13:00:00.000Z');
  assert.equal(ny('Standup November 2 at 9am').startAt, '2026-11-02T14:00:00.000Z');
  const series = ny('Standup every Friday at 9am');
  assert.equal(series.timeZone, 'America/New_York', 'the series keeps its wall-clock zone so later weeks stay at 9 AM');
  assert.equal(series.startAt, '2026-10-30T13:00:00.000Z');
  // The repeated 1 AM hour on the changeover day still saves (the server picks one instant).
  assert.doesNotThrow(() => ny('Night bus November 1 at 1:30am'));
});

test('titles keep their words; type prefixes and hints', () => {
  assert.equal(parse('Lunch with Sam and Ana at 1pm on Friday').title, 'Lunch with Sam and Ana');
  assert.equal(parse('Brunch at the Lake Café tomorrow at 11am').title, 'Brunch at the Lake Café');
  const prefixed = parse('task: renew passport by Nov 20');
  assert.deepEqual([prefixed.itemType, prefixed.title, prefixed.date, prefixed.allDay], ['task', 'renew passport', '2026-11-20', true]);
  assert.equal(parse('Appt - dentist tomorrow at 4pm').itemType, 'appointment');
  assert.equal(parse('Team meeting tomorrow at 4pm').itemType, null, 'no hint means the selected type is used');
  const forced = toInput(parse('Dentist tomorrow at 4pm'), { itemType: 'event' });
  assert.equal(forced.itemType, 'event', 'the type picked in the UI wins over keyword hints');
  assert.equal(parse('').title, '');
  assert.equal(parse('   ').hasSchedule, false);
});

test('deterministic and offline', async () => {
  const texts = ['Study every Friday from 7 to 9 PM', 'Call 5/11 at 2pm', 'Doctor appointment on November 5 at 10 AM, remind me 30 minutes before'];
  for (const text of texts) assert.deepEqual(parse(text), parse(text));
  const source = await readFile(new URL('../src/lib/calendar-nlp.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(/, 'the parser makes no network calls');
  const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ['../../cloudflare/calendar-rules.js'], 'only the shared calendar rules are imported');
});
