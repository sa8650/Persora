// Browser end-to-end check of Persora Calendar on the production build, against
// real Postgres 17 + PostgREST + the Pages API worker. Not part of `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run test:e2e:calendar
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';
import { addDays, localDateOf, startOfWeek, zonedTimeToInstant } from '../../cloudflare/calendar-rules.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-calendar-shots');
mkdirSync(shots, { recursive: true });
const base = `http://127.0.0.1:${APP_PORT}`;
const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);
async function snap(page, name) { await page.waitForTimeout(300); await page.screenshot({ path: join(shots, `${name}.png`) }); }
const sql = (query) => psql(query).trim();
const fmt = (date, options) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const longDay = (date) => fmt(date, { weekday: 'long', month: 'long', day: 'numeric' });
const fullDay = (date) => fmt(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

await startDatabase();
await startApp({ CALENDAR_REMINDER_TOKEN: 'e2e-cron-token' });
const browser = await chromium.launch();
const consoleErrors = [];
const expectedFailures = []; // { status, path } for failures a step provokes on purpose
function watch(page, label) {
  // Resource failures are checked by URL below; only the signed-out session probe may 401.
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
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}@persora.test`;
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
const eventButton = (page, title) => page.getByRole('button', { name: new RegExp(`^${title.replace(/[()]/g, '\\$&')},`) });
async function settle(page) { await page.waitForTimeout(150); await page.locator('.cal-spinner').waitFor({ state: 'detached' }); }
async function toast(page, text) { await page.getByText(text, { exact: false }).first().waitFor(); }

try {
  const alice = await register('Calendar Alice');
  const bob = await register('Calendar Bob');
  sql(`update profiles set email_verified_at = now() where id = '${alice.id}'`);
  const zone = 'Asia/Dhaka';
  const today = localDateOf(Date.now(), zone);
  const nextSunday = addDays(startOfWeek(today), 7);
  const monday = addDays(nextSunday, 1);
  const tuesday = addDays(nextSunday, 2);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.grantPermissions(['notifications'], { origin: base });
  await desktop.addInitScript(() => {
    window.__notifications = [];
    const Real = window.Notification;
    class Recorder { constructor(title, options) { window.__notifications.push({ title, body: options?.body }); } static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } close() {} }
    window.Notification = Recorder; void Real;
  });
  const page = await signIn(desktop, alice.email, 'alice');

  step('Navigation: nav entry, default Week view, Today / previous / next, keyboard shortcuts');
  assert.equal(await page.getByRole('button', { name: 'Week', exact: true }).getAttribute('aria-pressed'), 'true');
  const heading = page.locator('.cal-range-heading h2');
  const thisWeek = await heading.textContent();
  await page.getByRole('button', { name: 'Next week' }).click();
  assert.notEqual(await heading.textContent(), thisWeek);
  await page.getByRole('button', { name: /^Today/ }).click();
  assert.equal(await heading.textContent(), thisWeek);
  await page.keyboard.press('m');
  assert.equal(await page.getByRole('button', { name: 'Month', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('t'); await page.keyboard.press('w');
  assert.equal(await heading.textContent(), thisWeek);
  assert.ok(await page.locator('.cal-tg-dayhead.is-today').count() === 1, 'today highlighted');
  assert.ok(await page.locator('.cal-now').count() === 1, 'now line');
  ok(`week heading "${thisWeek}", month ↔ week, ←/→/T`);

  step('Validation: end before start is rejected in the form');
  await page.getByRole('button', { name: 'New event' }).click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.getByText('Add a title.').waitFor();
  await dialog.getByRole('textbox', { name: /Title/ }).fill('Backwards');
  await dialog.locator('input[type="date"]').first().fill(tuesday);
  await dialog.getByLabel('Start time').fill('10:00');
  await dialog.locator('input[type="date"]').nth(1).fill(tuesday);
  await dialog.getByLabel('End time').fill('09:00');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.getByText(/must end after it starts|on or after/).waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(sql(`select count(*) from calendar_events where user_id = '${alice.id}'`), '0');
  ok('title required, end-before-start blocked, nothing saved');

  step('Quick create from a Week time slot');
  await page.getByRole('button', { name: 'Next week' }).click(); await settle(page);
  await page.getByRole('button', { name: `Create event ${longDay(tuesday)} at 10 AM` }).click();
  await page.getByRole('textbox', { name: 'Event title' }).fill('Quick coffee');
  await page.keyboard.press('Enter');
  await toast(page, 'Event created.');
  await eventButton(page, 'Quick coffee').waitFor();
  const coffeeStart = sql(`select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') from calendar_events where title = 'Quick coffee'`);
  assert.equal(coffeeStart, new Date(zonedTimeToInstant(tuesday, '10:00', zone)).toISOString().slice(0, 16));
  await snap(page, '01-week-quick-created');
  ok(`created at ${tuesday} 10:00 ${zone} (stored ${coffeeStart}Z)`);

  step('Detailed form: weekly recurring event with a reminder');
  await page.getByRole('button', { name: 'New event' }).click();
  await dialog.getByRole('textbox', { name: /Title/ }).fill('Piano lesson');
  await dialog.locator('input[type="date"]').first().fill(monday);
  await dialog.getByLabel('Start time').fill('17:00');
  await dialog.getByLabel('End time').fill('18:00');
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('weekly');
  await dialog.getByRole('combobox', { name: 'Ends' }).selectOption('count');
  await dialog.getByRole('spinbutton', { name: 'Occurrences' }).fill('4');
  await dialog.getByRole('combobox', { name: 'Reminder' }).selectOption('15');
  await dialog.getByRole('textbox', { name: /Location/ }).fill('Music school');
  await dialog.getByRole('radio', { name: 'Personal' }).click();
  await snap(page, '02-editor-recurring');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'Event created.');
  await eventButton(page, 'Piano lesson').waitFor();
  assert.equal(sql(`select recurrence_freq || ':' || recurrence_count from calendar_events where title = 'Piano lesson'`), 'weekly:4');
  assert.equal(sql(`select count(*) from calendar_reminders r join calendar_events e on e.id = r.event_id where e.title = 'Piano lesson' and r.status = 'scheduled'`), '1');
  await page.getByRole('button', { name: fullDay(monday) }).first().click(); // mini calendar
  await page.keyboard.press('a'); await settle(page);
  assert.equal(await eventButton(page, 'Piano lesson').count(), 4);
  await snap(page, '03-agenda-series');
  ok('4 weekly occurrences in Agenda, one scheduled reminder');

  step('Edit only one occurrence ("This event")');
  await eventButton(page, 'Piano lesson').nth(1).click();
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByRole('radio', { name: 'This event' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const editOne = page.getByRole('dialog', { name: 'Edit this event' });
  assert.equal(await editOne.getByRole('combobox', { name: 'Repeat' }).count(), 0, 'no repeat options for one occurrence');
  await editOne.getByRole('textbox', { name: /Title/ }).fill('Piano recital');
  await editOne.getByLabel('Start time').fill('18:00');
  await editOne.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'This occurrence was updated.');
  await settle(page);
  assert.equal(await eventButton(page, 'Piano lesson').count(), 3);
  assert.equal(await eventButton(page, 'Piano recital').count(), 1);
  assert.match(await eventButton(page, 'Piano recital').getAttribute('aria-label'), /6:00 PM – 7:00 PM/, 'duration kept when moving start');
  assert.equal(sql(`select title from calendar_events where recurrence_freq is not null and user_id = '${alice.id}'`), 'Piano lesson');
  ok('series untouched; one exception row');

  step('Delete only one occurrence');
  await eventButton(page, 'Piano lesson').nth(1).click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('radio', { name: 'This event' }).check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await toast(page, 'This occurrence was deleted.');
  await settle(page);
  assert.equal(await eventButton(page, 'Piano lesson').count(), 2);
  assert.equal(await eventButton(page, 'Piano recital').count(), 1);
  ok('one occurrence hidden, the rest remain');

  step('Edit all events: title flows to matching occurrences, custom ones keep theirs');
  await eventButton(page, 'Piano lesson').first().click();
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByRole('radio', { name: 'All events' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const editAll = page.getByRole('dialog', { name: 'Edit all events' });
  assert.equal(await editAll.getByRole('combobox', { name: 'Repeat' }).inputValue(), 'weekly');
  await editAll.getByRole('textbox', { name: /Title/ }).fill('Piano class');
  await editAll.getByRole('button', { name: 'Save' }).click();
  await toast(page, 'All events updated.');
  await settle(page);
  assert.equal(await eventButton(page, 'Piano class').count(), 2);
  assert.equal(await eventButton(page, 'Piano recital').count(), 1);
  ok('2 × "Piano class", recital preserved');

  step('All-day event from a Month date');
  await page.keyboard.press('m'); await settle(page);
  const holiday = addDays(monday, 3);
  if (!(await page.getByRole('button', { name: `Create all-day event on ${longDay(holiday)}` }).count())) await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: `Create all-day event on ${longDay(holiday)}` }).click();
  await page.getByRole('textbox', { name: 'Event title' }).fill('Holiday');
  await page.keyboard.press('Enter');
  await toast(page, 'Event created.');
  await eventButton(page, 'Holiday').waitFor();
  assert.equal(sql(`select all_day || ' ' || start_date || ' ' || end_date from calendar_events where title = 'Holiday'`), `true ${holiday} ${addDays(holiday, 1)}`);
  await snap(page, '04-month');
  ok(`all-day on ${holiday} stored as a date (end exclusive)`);

  step('Search by title');
  await page.getByRole('searchbox', { name: 'Search events by title' }).fill('recital');
  await page.getByText('1 result for “recital”').waitFor();
  await snap(page, '05-search');
  await page.getByRole('button', { name: /Piano recital/ }).click();
  await page.locator('.is-highlight').first().waitFor();
  await page.getByRole('searchbox', { name: 'Search events by title' }).fill('zzzz');
  await page.getByText(/No events have a title matching/).waitFor();
  await page.getByRole('button', { name: 'Clear search' }).click();
  ok('result opens its date; empty state shown');

  step('Time zone: display follows the profile; editing never shifts times; all-day stays put');
  assert.equal((await alice.api('/profile', { method: 'PATCH', body: JSON.stringify({ fullName: 'Calendar Alice', timezone: 'America/New_York' }) })).status, 200);
  await page.reload();
  await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Calendar', exact: true }).first().click();
  await page.locator('.cal-view').waitFor();
  await page.keyboard.press('w');
  await page.getByRole('button', { name: fullDay(tuesday) }).first().click(); await settle(page);
  const expectedNy = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(zonedTimeToInstant(tuesday, '10:00', zone)));
  assert.match(await eventButton(page, 'Quick coffee').first().getAttribute('aria-label'), new RegExp(expectedNy.replace(/\s/g, '\\s')));
  await eventButton(page, 'Quick coffee').first().click();
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByText(/Times are in Asia\/Dhaka|Times are in Asia Dhaka/).waitFor();
  await page.getByRole('dialog', { name: 'Edit event' }).getByRole('button', { name: 'Save' }).click();
  await toast(page, 'Event updated.');
  assert.equal(sql(`select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') from calendar_events where title = 'Quick coffee'`), coffeeStart);
  await page.keyboard.press('m'); await settle(page);
  assert.match(await eventButton(page, 'Holiday').getAttribute('aria-label'), new RegExp(fmt(holiday, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })));
  assert.equal((await alice.api('/profile', { method: 'PATCH', body: JSON.stringify({ fullName: 'Calendar Alice', timezone: zone }) })).status, 200);
  ok(`shown at ${expectedNy} New York; unchanged after save; holiday still ${holiday}`);

  step('Reminders: server delivery (in-app + email), desktop notification once, no duplicates');
  const soon = Date.now() + 20 * 60_000;
  const parts = (ms) => ({ date: localDateOf(ms, zone), time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(new Date(ms)) });
  const created = await alice.api('/calendar/events', { method: 'POST', body: JSON.stringify({ event: { title: 'Call mom', allDay: false, start: parts(soon), end: parts(soon + 30 * 60_000), reminderMinutes: 15, reminderEmail: true } }) });
  assert.equal(created.status, 201);
  sql(`update calendar_reminders set remind_at = now() - interval '5 seconds' where title = 'Call mom' and status = 'scheduled'`);
  const outboxBefore = (await (await fetch(`${base}/__test/outbox`)).json()).length;
  await page.reload();
  await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
  await page.waitForFunction(() => window.__notifications?.some((entry) => entry.title === 'Call mom'), null, { timeout: 15000 });
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.locator('.notification-row', { hasText: 'Call mom' }).waitFor();
  await snap(page, '06-bell-reminder');
  for (let i = 0; i < 2; i += 1) {
    const cron = await fetch(`${base}/api/internal/calendar-reminders`, { method: 'POST', headers: { 'x-persora-cron-token': 'e2e-cron-token' } });
    assert.equal(cron.status, 200);
  }
  await page.reload();
  await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  const outbox = (await (await fetch(`${base}/__test/outbox`)).json()).slice(outboxBefore);
  assert.equal(outbox.filter((mail) => /Reminder: Call mom/.test(mail.subject)).length, 1, 'exactly one email');
  assert.equal(await page.evaluate(() => window.__notifications.filter((entry) => entry.title === 'Call mom').length), 0, 'no repeat desktop notification after reload');
  assert.equal(sql(`select status || ':' || email_status from calendar_reminders where title = 'Call mom'`), 'sent:sent');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.locator('.notification-row', { hasText: 'Call mom' }).click();
  await page.locator('.cal-view').waitFor();
  assert.ok(sql(`select read_at is not null from calendar_reminders where title = 'Call mom'`) === 't');
  ok('one email, one desktop notification, bell entry opens the calendar and is marked read');

  const edited = await alice.api('/calendar/events', { method: 'POST', body: JSON.stringify({ event: { title: 'Edited reminder', allDay: false, start: { date: monday, time: '12:00' }, end: { date: monday, time: '13:00' }, reminderMinutes: 60 } }) });
  await alice.api(`/calendar/events/${edited.body.event.id}`, { method: 'PATCH', body: JSON.stringify({ scope: 'series', expectedRevision: 1, event: { title: 'Edited reminder', allDay: false, start: { date: monday, time: '14:00' }, end: { date: monday, time: '15:00' }, reminderMinutes: 60 } }) });
  assert.equal(sql(`select string_agg(status, ',' order by status) from calendar_reminders where event_id = '${edited.body.event.id}'`), 'cancelled,scheduled');
  await alice.api(`/calendar/events/${edited.body.event.id}?scope=series`, { method: 'DELETE' });
  assert.equal(sql(`select count(*) from calendar_reminders where event_id = '${edited.body.event.id}'`), '0');
  ok('editing re-schedules once; deleting removes pending reminders');

  step('Isolation: another member sees nothing and gets 404');
  const bobContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const bobPage = await signIn(bobContext, bob.email, 'bob');
  await bobPage.getByRole('button', { name: 'Next week' }).click(); await settle(bobPage);
  assert.equal(await bobPage.locator('.cal-block, .cal-chip').count(), 0);
  const aliceEvent = sql(`select id from calendar_events where title = 'Quick coffee'`);
  assert.equal((await bob.api(`/calendar/events/${aliceEvent}`)).status, 404);
  assert.equal((await bob.api(`/calendar/events/${aliceEvent}?scope=series`, { method: 'DELETE' })).status, 404);
  assert.equal((await bob.api('/calendar/events/search?q=Piano')).body.events.length, 0);
  assert.equal(sql(`select count(*) from calendar_events where id = '${aliceEvent}'`), '1');
  await bobContext.close();
  const aliceBackup = await alice.backup(); const bobBackup = await bob.backup();
  assert.ok(aliceBackup.data.calendarEvents.some((row) => row.title === 'Piano class'), 'series in the account backup');
  assert.ok(aliceBackup.data.calendarEvents.some((row) => row.series_id && row.status === 'cancelled'), 'cancelled occurrence in the account backup');
  assert.ok(aliceBackup.data.calendarReminders.length > 0 && aliceBackup.data.calendarReminders.every((row) => !('claim_token' in row)));
  assert.deepEqual([bobBackup.data.calendarEvents, bobBackup.data.calendarReminders], [[], []], "Bob's backup has none of Alice's calendar");
  ok('empty calendar, 404s, Alice\'s data intact; account backups are per member');

  step('Delete the whole series');
  await page.getByRole('button', { name: fullDay(monday) }).first().click();
  await page.keyboard.press('a'); await settle(page);
  await eventButton(page, 'Piano recital').click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('radio', { name: 'All events' }).check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await toast(page, 'All events in the series were deleted.');
  await settle(page);
  assert.equal(await page.locator('.cal-agenda-row', { hasText: 'Piano' }).count(), 0);
  assert.equal(sql(`select count(*) from calendar_events where title like 'Piano%'`), '0');
  ok('series and its exceptions removed');

  step('Responsive layouts and themes');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phonePage = await signIn(phone, alice.email, 'phone');
  assert.equal(await phonePage.getByRole('button', { name: 'Agenda', exact: true }).getAttribute('aria-pressed'), 'true', 'Agenda first on phones');
  assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page overflow');
  await snap(phonePage, '07-phone-agenda');
  await phonePage.locator('.cal-agenda-row').first().click();
  await phonePage.locator('.cal-popover.is-sheet').waitFor();
  await snap(phonePage, '08-phone-sheet');
  await phonePage.keyboard.press('Escape');
  await phonePage.getByRole('button', { name: 'Month', exact: true }).click(); await settle(phonePage);
  assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await snap(phonePage, '09-phone-month');
  await phone.close();

  // Three overlapping events on one day: narrow columns must cascade, not squeeze into unreadable slivers.
  const overlapDay = addDays(monday, 2);
  for (const [title, from, to] of [['Overlap A', '13:00', '15:00'], ['Overlap B', '13:30', '14:30'], ['Overlap C', '14:00', '16:00']]) {
    const created = await alice.api('/calendar/events', { method: 'POST', body: JSON.stringify({ event: { title, allDay: false, timeZone: zone, start: { date: overlapDay, time: from }, end: { date: overlapDay, time: to } } }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  const tablet = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const tabletPage = await signIn(tablet, alice.email, 'tablet');
  await tabletPage.getByRole('button', { name: 'Week', exact: true }).click();
  await tabletPage.getByRole('button', { name: 'Next week' }).click(); await settle(tabletPage);
  assert.ok(await tabletPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const overlapBoxes = await Promise.all(['Overlap A', 'Overlap B', 'Overlap C'].map((title) => eventButton(tabletPage, title).boundingBox()));
  const dayColumn = await tabletPage.locator('.cal-tg-col').first().boundingBox();
  for (const box of overlapBoxes) assert.ok(box && box.width >= dayColumn.width / 2, `overlapping block keeps half the day column (${box?.width}px of ${dayColumn.width}px)`);
  assert.ok(overlapBoxes[0].x < overlapBoxes[1].x && overlapBoxes[1].x < overlapBoxes[2].x, 'overlapping blocks cascade left to right');
  await eventButton(tabletPage, 'Overlap C').scrollIntoViewIfNeeded();
  await snap(tabletPage, '10-tablet-week-overlap');
  await tabletPage.locator('.cal-range-heading').click();
  await tabletPage.locator('.cal-datepicker').waitFor();
  await snap(tabletPage, '10-tablet-week-datepicker');
  await tablet.close();

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.keyboard.press('w'); await settle(page);
    await snap(page, `11-system-${scheme}`);
  }
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const darkSurface = await page.locator('.cal-main').evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.equal(darkSurface, 'rgb(31, 33, 36)', '.dark theme variables apply');
  await snap(page, '12-dark-class');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  ok('phone (Agenda + sheet), tablet (date popover), system light/dark, .dark variables');

  assert.deepEqual(consoleErrors, [], 'no console errors');
  ok('no console errors');
  console.log(`\nCalendar e2e passed. Screenshots: ${shots}`);
} finally {
  await browser.close().catch(() => {});
  stopAll();
}
process.exit(0);
