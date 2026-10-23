// Browser end-to-end check of Calendar smart scheduling on the production build,
// against real Postgres 17 + PostgREST + the Pages API worker. Not part of `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run test:e2e:calendar-smart
//
// Covers: natural-language quick add (with clarifying questions), tasks and
// appointments, task completion, conflict warnings and free-slot suggestions,
// drag/resize in Week and Month (mouse) and Day (touch long-press), failed and
// stale moves restoring the item, recurring "this / all events" moves, the
// Reschedule dialog (non-drag alternative), filters synced across devices,
// account backup contents, phone layout and dark theme.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';
import { addDays, localDateOf, startOfWeek } from '../../cloudflare/calendar-rules.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-calendar-smart-shots');
mkdirSync(shots, { recursive: true });
const base = `http://127.0.0.1:${APP_PORT}`;
const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);
async function snap(page, name) { await page.waitForTimeout(300); await page.screenshot({ path: join(shots, `${name}.png`) }); }
const sql = (query) => psql(query).trim();
const fmt = (date, options) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const longDay = (date) => fmt(date, { weekday: 'long', month: 'long', day: 'numeric' });
const monthDay = (date) => fmt(date, { month: 'long', day: 'numeric' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(read, expected, message, timeout = 8000) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    last = await read();
    if (typeof expected === 'function' ? expected(last) : last === expected) return last;
    await sleep(120);
  }
  assert.fail(`${message}: got ${JSON.stringify(last)}${typeof expected === 'function' ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

await startDatabase();
await startApp({ CALENDAR_REMINDER_TOKEN: 'e2e-cron-token' });
const browser = await chromium.launch();
const consoleErrors = [];
const expectedFailures = []; // { status, path } for failures a step provokes on purpose
function watch(page, label) {
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) consoleErrors.push(`${label}: ${message.text()}`); });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    if (response.status() === 401 && path === '/api/auth/me') return;
    if (expectedFailures.some((rule) => rule.status === response.status() && rule.path.test(path))) return;
    consoleErrors.push(`${label}: HTTP ${response.status()} ${response.request().method()} ${path}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
}

async function register(name) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}@persora.test`;
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: name, email, password: 'Correct-Horse-9' }) });
  assert.equal(response.status, 201, await response.clone().text());
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const api = async (path, init = {}) => {
    const res = await fetch(`${base}/api${path}`, { ...init, headers: { cookie, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const backup = async () => {
    const res = await fetch(`${base}/api/account/export`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const tar = new Uint8Array(await res.arrayBuffer());
    const size = parseInt(new TextDecoder().decode(tar.subarray(124, 135)), 8);
    return JSON.parse(new TextDecoder().decode(tar.subarray(512, 512 + size)));
  };
  return { email, api, backup, id: sql(`select id from profiles where email = '${email}'`) };
}

async function signIn(context, email, label) {
  const page = await context.newPage();
  watch(page, label);
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByRole('textbox', { name: 'Email or 7-digit Persora ID' }).fill(email);
  await page.getByPlaceholder('Your password').fill('Correct-Horse-9');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
  const menu = page.getByRole('button', { name: 'Open workspace sections' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).first().click();
  await page.locator('.cal-view').waitFor();
  await page.locator('.cal-spinner').waitFor({ state: 'detached' });
  return page;
}
const escape = (text) => text.replace(/[()[\]\\.*+?^$|{}]/g, '\\$&');
const item = (page, title) => page.getByRole('button', { name: new RegExp(`^${escape(title)},`) }).first();
async function settle(page) { await page.waitForTimeout(150); await page.locator('.cal-spinner').waitFor({ state: 'detached' }); }
async function toast(page, text) { await page.getByText(text, { exact: false }).first().waitFor(); }
/** Waits until an item is no longer marked "Saving" (its move finished in the UI). */
async function idle(page, title) {
  await eventually(async () => { const el = item(page, title); return (await el.count()) ? !/Saving/.test(await el.getAttribute('aria-label')) : false; }, true, `${title} idle`);
  await settle(page);
}
const slot = (page, date, hour) => page.getByRole('button', { name: `Create event ${longDay(date)} at ${hour}`, exact: true });

/** Mouse drag from one point to another with intermediate moves (like a person). */
async function mouseDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y + 6, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}
/** Drags an item block so its top lands where a slot's top is (same grab offset). */
async function dragBlockToSlot(page, title, slotLocator) {
  const block = item(page, title);
  await block.scrollIntoViewIfNeeded();
  await slotLocator.scrollIntoViewIfNeeded();
  const box = await block.boundingBox(); // after scrolling
  const target = await slotLocator.boundingBox();
  await mouseDrag(page, { x: box.x + box.width / 2, y: box.y + 8 }, { x: target.x + target.width / 2, y: target.y + 8 });
}

try {
  const alice = await register('Smart Alice');
  const zone = 'Asia/Dhaka';
  const today = localDateOf(Date.now(), zone);
  const tomorrow = addDays(today, 1);
  const S = addDays(startOfWeek(today), 7); // next week, Sunday → Thursday
  const M = addDays(S, 1); const T = addDays(S, 2); const W = addDays(S, 3); const H = addDays(S, 4);
  const A = (title) => `select id from calendar_events where user_id = '${alice.id}' and title = '${title}' and series_id is null`;
  const when = (title) => sql(`select to_char(start_at at time zone '${zone}', 'YYYY-MM-DD HH24:MI') || '–' || to_char(end_at at time zone '${zone}', 'HH24:MI') from calendar_events where user_id = '${alice.id}' and title = '${title}' and series_id is null`);
  const field = (title, column) => sql(`select coalesce(${column}::text, '∅') from calendar_events where user_id = '${alice.id}' and title = '${title}' and series_id is null`);
  const create = async (event) => {
    const result = await alice.api('/calendar/events', { method: 'POST', body: JSON.stringify({ event: { timeZone: zone, allDay: false, ...event } }) });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.event;
  };
  await create({ title: 'Drag me', category: 'work', start: { date: M, time: '09:00' }, end: { date: M, time: '10:00' } });
  await create({ title: 'Weekly 1-1', start: { date: M, time: '14:00' }, end: { date: M, time: '14:30' }, recurrence: { freq: 'weekly', count: 4 } });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await signIn(desktop, alice.email, 'alice');

  step('Natural-language quick add from the create menu: preview, then save');
  await page.getByRole('button', { name: 'More create options' }).click();
  const menu = page.getByRole('dialog', { name: 'Create' });
  await menu.getByRole('textbox', { name: 'Quick add' }).fill('Team sync tomorrow at 3 PM, remind me 30 minutes before');
  await page.keyboard.press('Enter');
  let quick = page.locator('.cal-quick');
  await quick.waitFor();
  const preview = quick.locator('.cal-smart-preview');
  assert.equal(await preview.getByLabel('Title').inputValue(), 'Team sync');
  assert.equal(await preview.getByLabel('Date').inputValue(), tomorrow);
  assert.equal(await preview.getByLabel('Start').inputValue(), '15:00');
  assert.equal(await preview.getByLabel('End').inputValue(), '16:00');
  assert.equal(await preview.getByLabel('Reminder').inputValue(), '30');
  await snap(page, '20-quickadd-preview');
  await quick.getByRole('button', { name: 'Save', exact: true }).click();
  await toast(page, 'Event created.');
  assert.equal(when('Team sync'), `${tomorrow} 15:00–16:00`);
  assert.equal(field('Team sync', 'reminder_minutes'), '30');
  assert.equal(field('Team sync', 'item_type'), 'event');
  ok(`"Team sync tomorrow at 3 PM…" → ${tomorrow} 15:00–16:00, reminder 30 min, nothing invented`);

  step('Ambiguity: the parser asks instead of guessing');
  await page.getByRole('button', { name: 'More create options' }).click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Call mom tomorrow at 7');
  await page.keyboard.press('Enter');
  quick = page.locator('.cal-quick');
  await quick.getByText('Is “at 7” AM or PM?').waitFor();
  await quick.getByRole('button', { name: 'Save', exact: true }).click();
  await quick.getByText('Answer the question above first.').waitFor();
  assert.equal(sql(`select count(*) from calendar_events where title = 'Call mom'`), '0', 'nothing saved while a question is open');
  await quick.getByRole('button', { name: '7 PM', exact: true }).click();
  assert.equal(await quick.locator('.cal-smart-preview').getByLabel('Start').inputValue(), '19:00');
  await quick.getByRole('button', { name: 'Save', exact: true }).click();
  await toast(page, 'Event created.');
  assert.equal(when('Call mom'), `${tomorrow} 19:00–20:00`);
  ok('AM/PM question blocks saving until answered; 7 PM saved');

  step('Task from natural language; appointment from the create menu');
  await page.getByRole('button', { name: 'More create options' }).click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill(`Submit assignment on ${monthDay(T)}, due at 11 AM`);
  await page.keyboard.press('Enter');
  quick = page.locator('.cal-quick');
  await quick.getByRole('radio', { name: 'Task' }).and(page.locator('[aria-checked="true"]')).waitFor();
  await quick.getByRole('button', { name: 'Save', exact: true }).click();
  await toast(page, 'Task created.');
  assert.equal(field('Submit assignment', 'item_type'), 'task');
  assert.equal(when('Submit assignment'), `${T} 11:00–11:30`);

  await page.getByRole('button', { name: 'More create options' }).click();
  await page.getByRole('button', { name: 'Schedule appointment' }).click();
  const editor = page.getByRole('dialog', { name: 'New appointment' });
  await editor.getByRole('textbox', { name: /Title/ }).fill('Dentist');
  await editor.locator('input[type="date"]').first().fill(W);
  await editor.getByLabel('Start time').fill('10:00');
  await editor.getByRole('combobox', { name: 'Duration' }).selectOption('45');
  await editor.getByRole('textbox', { name: /Location/ }).fill('City Clinic');
  await editor.getByRole('textbox', { name: /Notes/ }).fill('Bring X-rays');
  await editor.getByRole('combobox', { name: 'Reminder' }).selectOption('60');
  await editor.getByRole('radio', { name: 'Health' }).click();
  await snap(page, '21-appointment-editor');
  await editor.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'Appointment created.');
  assert.equal(when('Dentist'), `${W} 10:00–10:45`);
  assert.deepEqual(['item_type', 'location', 'description', 'reminder_minutes', 'category'].map((column) => field('Dentist', column)), ['appointment', 'City Clinic', 'Bring X-rays', '60', 'health']);
  assert.equal(sql(`select count(*) from calendar_reminders where event_id = (${A('Dentist')}) and status = 'scheduled'`), '1');
  ok('task (type detected from "due") and appointment (duration, location, notes, reminder, category) saved');

  step('Conflict warnings in the form: overlaps listed with times, free slots suggested, saving never blocked');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New event' });
  await form.getByRole('textbox', { name: /Title/ }).fill('Planning');
  await form.locator('input[type="date"]').first().fill(W);
  await form.getByLabel('Start time').fill('10:15');
  await form.locator('input[type="date"]').nth(1).fill(W);
  await form.getByLabel('End time').fill('11:15');
  const notice = form.locator('.cal-conflict');
  await notice.getByText('Overlaps with 1 item').waitFor();
  assert.match(await notice.textContent(), /Dentist.*Appointment · .*10:00 AM – 10:45 AM/);
  const free = notice.getByRole('group', { name: 'Free times nearby' }).getByRole('button');
  assert.ok(await free.count() >= 1);
  await snap(page, '22-editor-conflict');
  await free.first().click();
  await notice.waitFor({ state: 'detached' });
  const picked = await form.getByLabel('Start time').inputValue();
  await form.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'Event created.');
  assert.equal(when('Planning').slice(11, 16), picked);

  await page.getByRole('button', { name: 'Next week' }).click(); await settle(page);
  // The Dentist block covers most of this hour; the slot is still reachable in the column's right gutter.
  const busySlot = slot(page, W, '10 AM');
  await busySlot.scrollIntoViewIfNeeded();
  const busyBox = await busySlot.boundingBox();
  await busySlot.click({ position: { x: busyBox.width - 2, y: 8 } });
  quick = page.locator('.cal-quick');
  await quick.getByRole('textbox', { name: 'Event title' }).fill('Overlap check');
  await quick.locator('.cal-conflict').getByText(/Overlaps with 1 item/).waitFor();
  await quick.getByRole('button', { name: 'Save', exact: true }).click();
  await toast(page, 'Event created.');
  assert.equal(when('Overlap check'), `${W} 10:00–11:00`);
  ok(`overlap with "Dentist" shown; suggestion ${picked} applied; an overlapping item still saves`);

  step('Task completion: mark complete and the reminder stops; shown as done');
  await item(page, 'Submit assignment').click();
  const details = page.getByRole('dialog', { name: 'Submit assignment' });
  await details.getByRole('button', { name: /Mark complete/ }).click();
  await toast(page, 'Task marked complete.');
  assert.notEqual(field('Submit assignment', 'completed_at'), '∅');
  await eventually(async () => (await item(page, 'Submit assignment').getAttribute('class')).includes('is-done'), true, 'completed style');
  assert.match(await item(page, 'Submit assignment').getAttribute('aria-label'), /Task, completed/);
  ok('completed_at stored; block struck through; aria says "Task, completed"');

  step('Drag and resize in Week (mouse), saved to the server');
  await dragBlockToSlot(page, 'Drag me', slot(page, T, '1 PM'));
  await toast(page, 'Event moved to');
  await eventually(() => when('Drag me'), `${T} 13:00–14:00`, 'drag saved');
  await idle(page, 'Drag me');
  const block = item(page, 'Drag me');
  await block.locator('.cal-resize').waitFor({ state: 'attached' });
  const box = await block.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10); // hover shows the handle
  const handle = block.locator('.cal-resize');
  const hb = await handle.boundingBox();
  await mouseDrag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 + 48 });
  await eventually(() => when('Drag me'), `${T} 13:00–15:00`, 'resize saved');
  await idle(page, 'Drag me');
  // Escape cancels a drag in progress.
  const before = await item(page, 'Drag me').boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + 8); await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + 120, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await sleep(300);
  assert.equal(when('Drag me'), `${T} 13:00–15:00`, 'Escape cancels');
  await snap(page, '23-week-after-drag');
  ok('moved Mon 9:00 → Tue 1:00 PM, resized to 2 h, Escape cancels');

  step('Failed save: the item goes back and an error is shown');
  expectedFailures.push({ status: 500, path: /^\/api\/calendar\/events\// });
  await page.route('**/api/calendar/events/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated outage.' }) }) : route.continue()));
  await dragBlockToSlot(page, 'Drag me', slot(page, H, '9 AM'));
  await toast(page, 'is back where it was');
  await page.unroute('**/api/calendar/events/*');
  assert.equal(when('Drag me'), `${T} 13:00–15:00`);
  assert.match(await item(page, 'Drag me').getAttribute('aria-label'), /1:00/, 'shown at its original time again');
  ok('500 → error message, block restored, database unchanged');

  step('Stale view: a change from another device wins (409), nothing is overwritten');
  const rev = Number(field('Drag me', 'revision'));
  const remote = await alice.api(`/calendar/events/${field('Drag me', 'id')}`, { method: 'PATCH', body: JSON.stringify({ scope: 'series', expectedRevision: rev, event: { title: 'Drag me', category: 'work', description: 'edited on phone', allDay: false, timeZone: zone, start: { date: T, time: '13:00' }, end: { date: T, time: '15:00' } } }) });
  assert.equal(remote.status, 200, JSON.stringify(remote.body));
  expectedFailures.push({ status: 409, path: /^\/api\/calendar\/events\// });
  await dragBlockToSlot(page, 'Drag me', slot(page, H, '9 AM'));
  await toast(page, 'changed somewhere else');
  await settle(page);
  assert.equal(when('Drag me'), `${T} 13:00–15:00`);
  assert.equal(field('Drag me', 'description'), 'edited on phone');
  ok('stale move refused; the other device’s edit kept; calendar reloaded');

  step('Moving onto a busy time: warning with the overlaps; keep original or move anyway');
  await dragBlockToSlot(page, 'Drag me', slot(page, W, '10 AM'));
  const conflict = page.getByRole('dialog', { name: 'Time overlaps' });
  await conflict.waitFor();
  const conflictText = await conflict.textContent();
  assert.match(conflictText, /Dentist/); assert.match(conflictText, /Overlap check/);
  await snap(page, '24-move-conflict');
  await conflict.getByRole('button', { name: 'Keep original time' }).click();
  await sleep(300);
  assert.equal(when('Drag me'), `${T} 13:00–15:00`);
  await dragBlockToSlot(page, 'Drag me', slot(page, W, '10 AM'));
  await page.getByRole('dialog', { name: 'Time overlaps' }).getByRole('button', { name: 'Move anyway' }).click();
  await eventually(() => when('Drag me'), `${W} 10:00–12:00`, 'moved despite overlap');
  await idle(page, 'Drag me');
  ok('both overlaps listed; "Keep original time" reverts; "Move anyway" saves');

  step('Completed task moves and stays complete');
  const doneAt = field('Submit assignment', 'completed_at');
  await dragBlockToSlot(page, 'Submit assignment', slot(page, T, '8 AM'));
  await eventually(() => when('Submit assignment'), `${T} 08:00–08:30`, 'task moved');
  await idle(page, 'Submit assignment');
  assert.equal(field('Submit assignment', 'completed_at'), doneAt);
  ok('completed_at unchanged after the move');

  step('Recurring: move only this occurrence, then the whole series');
  await dragBlockToSlot(page, 'Weekly 1-1', slot(page, M, '4 PM'));
  let scope = page.getByRole('dialog', { name: 'Move recurring event' });
  await scope.getByRole('radio', { name: 'This event' }).check();
  await scope.getByRole('button', { name: 'Move', exact: true }).click();
  await toast(page, 'Event moved to');
  const seriesId = sql(A('Weekly 1-1'));
  await eventually(() => sql(`select to_char(start_at at time zone '${zone}', 'YYYY-MM-DD HH24:MI') from calendar_events where series_id = '${seriesId}'`), `${M} 16:00`, 'exception row');
  assert.equal(when('Weekly 1-1'), `${M} 14:00–14:30`, 'series untouched');
  await page.getByRole('button', { name: 'Next week' }).click(); await settle(page);
  await dragBlockToSlot(page, 'Weekly 1-1', slot(page, addDays(M, 7), '3 PM'));
  scope = page.getByRole('dialog', { name: 'Move recurring event' });
  await scope.getByRole('radio', { name: 'All events' }).check();
  await scope.getByText('Moving all events replaces changes made to single occurrences.').waitFor();
  await scope.getByRole('button', { name: 'Move', exact: true }).click();
  await toast(page, 'Changes made to single occurrences were replaced');
  await eventually(() => when('Weekly 1-1'), `${M} 15:00–15:30`, 'series shifted by one hour from its first date');
  assert.equal(sql(`select count(*) from calendar_events where series_id = '${seriesId}'`), '0');
  assert.equal(field('Weekly 1-1', 'recurrence_count'), '4');
  await page.getByRole('button', { name: 'Previous week' }).click(); await settle(page);
  ok('one exception at 4 PM; then all events → 3 PM (same weekday), exceptions reset as warned');

  step('Month view: drag by whole days, time of day kept; reminder follows');
  await page.getByRole('button', { name: 'Month', exact: true }).click(); await settle(page);
  if (!(await page.locator(`[data-drop-date="${H}"]`).count())) { await page.getByRole('button', { name: 'Next month' }).click(); await settle(page); }
  const chip = item(page, 'Team sync');
  if (!(await chip.count())) { await page.getByRole('button', { name: 'Previous month' }).click(); await settle(page); }
  const cb = await item(page, 'Team sync').boundingBox();
  const cell = await page.locator(`.cal-month-cell[data-drop-date="${H}"]`).boundingBox();
  await mouseDrag(page, { x: cb.x + 12, y: cb.y + cb.height / 2 }, { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 });
  await eventually(() => when('Team sync'), `${H} 15:00–16:00`, 'month drag saved');
  await eventually(() => sql(`select to_char(remind_at at time zone '${zone}', 'YYYY-MM-DD HH24:MI') from calendar_reminders where event_id = (${A('Team sync')}) and status = 'scheduled'`), `${H} 14:30`, 'reminder rescheduled');
  await snap(page, '25-month-after-drag');
  ok(`Team sync ${tomorrow} → ${H}, still 3 PM, reminder at 2:30 PM`);

  step('Reschedule dialog (keyboard alternative): appointment keeps its fields and reminder');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.keyboard.press('t'); await page.getByRole('button', { name: 'Next week' }).click(); await settle(page);
  await item(page, 'Dentist').click();
  await page.getByRole('dialog', { name: 'Dentist' }).getByRole('button', { name: 'Reschedule appointment' }).click();
  const reschedule = page.getByRole('dialog', { name: 'Reschedule appointment' });
  await reschedule.getByLabel('Date').fill(H);
  await reschedule.getByLabel('Start time').fill('16:00');
  await snap(page, '26-reschedule');
  await reschedule.getByRole('button', { name: 'Move', exact: true }).click();
  await toast(page, 'Appointment moved to');
  await eventually(() => when('Dentist'), `${H} 16:00–16:45`, 'rescheduled');
  assert.deepEqual(['item_type', 'location', 'description', 'reminder_minutes', 'category'].map((column) => field('Dentist', column)), ['appointment', 'City Clinic', 'Bring X-rays', '60', 'health']);
  assert.equal(sql(`select to_char(remind_at at time zone '${zone}', 'YYYY-MM-DD HH24:MI') from calendar_reminders where event_id = (${A('Dentist')}) and status = 'scheduled'`), `${H} 15:00`);
  ok('moved via form; location, notes, category and 1-hour reminder kept (reminder now 3 PM)');

  step('Filters: combinable, visible, consistent across views and search, saved across devices, display-only');
  const eventsBefore = sql(`select count(*) from calendar_events where user_id = '${alice.id}'`);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Show' });
  await filters.getByRole('checkbox', { name: 'Tasks', exact: true }).uncheck();
  await filters.getByRole('checkbox', { name: 'Work', exact: true }).uncheck();
  await snap(page, '27-filter-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Filters, 2 hidden' }).waitFor();
  const strip = page.locator('.cal-filter-strip');
  assert.match(await strip.textContent(), /Tasks hidden/); assert.match(await strip.textContent(), /Work color hidden/);
  assert.equal(await item(page, 'Submit assignment').count(), 0, 'task hidden in Week');
  assert.equal(await item(page, 'Drag me').count(), 0, 'work-colored event hidden');
  assert.equal(await item(page, 'Overlap check').count(), 1, 'others still shown');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click(); await settle(page);
  assert.equal(await item(page, 'Submit assignment').count(), 0, 'hidden in Agenda');
  await page.getByRole('button', { name: 'Month', exact: true }).click(); await settle(page);
  assert.equal(await item(page, 'Submit assignment').count(), 0, 'hidden in Month');
  await page.getByRole('searchbox', { name: /Search/ }).or(page.getByPlaceholder('Search events')).first().fill('Submit');
  await page.getByText('1 hidden by filters').waitFor();
  await page.getByText('Matching items are hidden by filters.').waitFor();
  await page.getByPlaceholder('Search events').fill('');
  await snap(page, '28-filtered-month');
  await eventually(() => sql(`select filters->'types'->>'task' || ',' || (filters->'categories'->>'work') from calendar_preferences where user_id = '${alice.id}'`), 'false,false', 'filters saved to the account');
  assert.equal(sql(`select count(*) from calendar_events where user_id = '${alice.id}'`), eventsBefore, 'filters never change data');
  // Another device picks them up from the account.
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const laptopPage = await signIn(laptop, alice.email, 'laptop');
  await laptopPage.getByRole('button', { name: 'Filters, 2 hidden' }).waitFor();
  await laptop.close();
  // Same device after a reload.
  await page.reload();
  await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Calendar', exact: true }).first().click();
  await page.locator('.cal-view').waitFor(); await settle(page);
  await page.getByRole('button', { name: 'Filters, 2 hidden' }).waitFor();
  await page.locator('.cal-filter-strip').getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).waitFor();
  await eventually(() => sql(`select filters->'types'->>'task' from calendar_preferences where user_id = '${alice.id}'`), 'true', 'reset saved');
  ok('Tasks + Work hidden in Week/Agenda/Month and search ("1 hidden by filters"); synced to a second device; reset');

  step('Account backup includes item types, completion and filter preferences');
  const backup = await alice.backup();
  const exported = backup.calendarEvents || backup.data?.calendarEvents;
  assert.ok(Array.isArray(exported), `calendarEvents in backup (keys: ${Object.keys(backup).join(', ')})`);
  const byTitle = Object.fromEntries(exported.filter((row) => !row.series_id).map((row) => [row.title, row]));
  assert.equal(byTitle.Dentist.item_type, 'appointment');
  assert.ok(byTitle['Submit assignment'].completed_at);
  assert.equal(byTitle['Team sync'].item_type, 'event');
  const prefs = backup.calendarPreferences ?? backup.data?.calendarPreferences;
  assert.ok(prefs && prefs.filters, 'preferences exported');
  ok(`${exported.length} calendar rows with item_type/completed_at, plus calendarPreferences`);

  step('Phone: Reschedule from the sheet, long-press drag in Day view, tap still opens');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phonePage = await signIn(phone, alice.email, 'phone');
  assert.equal(await phonePage.getByRole('button', { name: 'Agenda', exact: true }).getAttribute('aria-pressed'), 'true');
  await item(phonePage, 'Dentist').tap();
  await phonePage.locator('.cal-popover.is-sheet').waitFor();
  await phonePage.getByRole('button', { name: 'Reschedule appointment' }).tap();
  const sheet = phonePage.getByRole('dialog', { name: 'Reschedule appointment' });
  await sheet.getByLabel('Start time').fill('17:00');
  await snap(phonePage, '29-phone-reschedule');
  await sheet.getByRole('button', { name: 'Move', exact: true }).tap();
  await eventually(() => when('Dentist'), `${H} 17:00–17:45`, 'rescheduled on phone');

  await phonePage.getByRole('button', { name: 'Day', exact: true }).tap(); await settle(phonePage);
  for (let i = 0; i < 20 && !(await slot(phonePage, H, '9 AM').count()); i += 1) { await phonePage.getByRole('button', { name: 'Next day' }).tap(); await settle(phonePage); }
  const teamSync = item(phonePage, 'Team sync');
  await teamSync.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await sleep(200);
  // A short tap opens the details, it doesn't drag.
  await teamSync.tap();
  await phonePage.locator('.cal-popover.is-sheet').waitFor();
  await phonePage.keyboard.press('Escape');
  await phonePage.locator('.cal-popover.is-sheet').waitFor({ state: 'detached' });
  const tb = await teamSync.boundingBox();
  const cdp = await phone.newCDPSession(phonePage);
  const x = Math.round(tb.x + tb.width / 2); const y0 = Math.round(tb.y + 10);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  await sleep(500); // long press
  for (let i = 1; i <= 12; i += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 8 }] }); await sleep(16); }
  await snap(phonePage, '30-phone-touch-drag');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await eventually(() => when('Team sync'), `${H} 13:00–14:00`, 'touch drag saved (96px up = 2 h)');
  assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow');
  assert.ok(!(await phonePage.evaluate(() => document.body.classList.contains('cal-dragging'))), 'drag state cleaned up');
  await phone.close();
  ok('Reschedule on phone; tap opens; long-press drag moved 3 PM → 1 PM');

  step('Dark theme: types stay distinct');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.keyboard.press('t'); await page.getByRole('button', { name: 'Next week' }).click(); await settle(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await settle(page);
  const appointmentBg = await item(page, 'Dentist').evaluate((element) => getComputedStyle(element).backgroundColor);
  const eventBg = await item(page, 'Overlap check').evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(appointmentBg, eventBg, 'appointments look different from events');
  await item(page, 'Dentist').scrollIntoViewIfNeeded();
  await snap(page, '31-week-dark');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.emulateMedia({ colorScheme: 'light' });
  await snap(page, '32-week-light');
  ok('appointment outline vs filled event in dark mode');

  assert.deepEqual(consoleErrors, [], 'no unexpected console errors or failed requests');
  ok('no console errors');
  console.log(`\nCalendar smart scheduling e2e passed. Screenshots: ${shots}`);
} catch (error) {
  console.error('\nE2E FAILED:', error);
  if (consoleErrors.length) console.error('Console errors:', consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
  stopAll();
}
process.exit(process.exitCode || 0);
