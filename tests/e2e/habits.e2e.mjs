// Browser end-to-end check of Persora Habit Tracker on the production build,
// against real Postgres 17 + PostgREST + the Pages API worker. Not part of
// `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run test:e2e:habits
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';
import { addDays, localDateOf, startOfWeek } from '../../cloudflare/calendar-rules.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-habit-shots');
mkdirSync(shots, { recursive: true });
const base = `http://127.0.0.1:${APP_PORT}`;
const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);
const sql = (query) => psql(query).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function snap(page, name) { await page.waitForTimeout(300); await page.screenshot({ path: join(shots, `${name}.png`) }); }
async function eventually(read, expected, message, timeout = 8000) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    last = await read();
    if (typeof expected === 'function' ? expected(last) : JSON.stringify(last) === JSON.stringify(expected)) return last;
    await sleep(120);
  }
  assert.fail(`${message}: got ${JSON.stringify(last)}${typeof expected === 'function' ? '' : `, expected ${JSON.stringify(expected)}`}`);
}
const ZONE = 'Asia/Dhaka';
const today = localDateOf(Date.now(), ZONE);
const dayLabel = (date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

await startDatabase();
await startApp({ CALENDAR_REMINDER_TOKEN: 'e2e-cron-token' });
const browser = await chromium.launch();
const consoleErrors = [];
const expectedFailures = []; // { status, path } provoked on purpose
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
  const id = sql(`select id from profiles where email = '${email}'`);
  sql(`update profiles set timezone = '${ZONE}' where id = '${id}'`);
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
  return { email, id, api, backup };
}

const workspaceReady = (page) => page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
async function signIn(context, email, label) {
  const page = await context.newPage();
  watch(page, label);
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByRole('textbox', { name: 'Email or 7-digit Persora ID' }).fill(email);
  await page.getByPlaceholder('Your password').fill('Correct-Horse-9');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await workspaceReady(page);
  return page;
}
const launcher = (page) => page.getByRole('button', { name: 'Persora apps', exact: true });
const drawer = (page) => page.getByRole('dialog', { name: /^(Your favorites|Edit favorites)$/ });
async function openDrawer(page) {
  if (!(await drawer(page).count())) await launcher(page).click();
  await drawer(page).waitFor();
  await page.waitForTimeout(200);
}
async function ready(page) {
  await page.locator('.hb-view').waitFor();
  await page.locator('.hb-skeleton').waitFor({ state: 'detached' });
  await page.waitForTimeout(150);
}
async function openHabitsFromDrawer(page) {
  await openDrawer(page);
  const tiles = page.locator('.app-launcher-panel .app-launcher-tile', { hasText: 'Habit Tracker' });
  assert.equal(await tiles.count(), 1, 'Habit Tracker appears exactly once in the drawer');
  await tiles.first().click();
  await drawer(page).waitFor({ state: 'detached' });
  await ready(page);
}
// A reload returns to the workspace's default view (existing behaviour), so
// navigate back through the sidebar, as the calendar suite does.
async function reopen(page) {
  await page.reload();
  await workspaceReady(page);
  await page.locator('nav[aria-label="Workspace navigation"]').getByRole('button', { name: 'Habit Tracker', exact: true }).first().click();
  await ready(page);
}
const row = (page, name) => page.locator('.hb-row', { has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) });
const checkButton = (page, name, date = today) => page.getByRole('button', { name: new RegExp(`^(Mark ${name} done for ${dayLabel(date)}|${name}: done on ${dayLabel(date)}\\. Mark as not done)$`) });
async function idle(page) { await page.waitForTimeout(120); await page.locator('.hb-row .hb-spinner').first().waitFor({ state: 'detached' }).catch(() => {}); }
const checkinCount = (habitId, date) => Number(sql(`select count(*) from habit_checkins where habit_id = '${habitId}'${date ? ` and check_date = '${date}'` : ''}`));
const habitId = (owner, name) => sql(`select id from habits where user_id = '${owner}' and name = '${name}'`);
const toast = (page, text) => page.getByText(text, { exact: false }).first().waitFor();
async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const view = document.querySelector('.hb-view');
    return { doc: document.documentElement.scrollWidth - window.innerWidth, view: view ? view.scrollWidth - view.clientWidth : 0 };
  });
  assert.ok(overflow.doc <= 1, `${label}: page does not scroll sideways (${overflow.doc}px)`);
  assert.ok(overflow.view <= 1, `${label}: habit view fits (${overflow.view}px)`);
}

try {
  const alice = await register('Habit Alice');
  const bob = await register('Habit Bob');
  sql(`update profiles set email_verified_at = now() where id = '${alice.id}'`);
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: ZONE });
  let page = await signIn(desktop, alice.email, 'desktop');

  step('App Drawer entry opens the real page');
  {
    await openDrawer(page);
    const tile = page.locator('.app-launcher-panel .app-launcher-tile', { hasText: 'Habit Tracker' });
    assert.equal(await tile.count(), 1);
    const icon = tile.locator('svg.launcher-module-icon');
    assert.equal(await icon.count(), 1, 'an inline SVG icon');
    assert.equal(await tile.locator('img, text').count(), 0, 'no raster image and no SVG text');
    assert.ok(await icon.locator('linearGradient').count() >= 2, 'layered gradients');
    assert.equal(await tile.locator('.app-launcher-label').innerText(), 'Habit Tracker', 'label beneath the icon');
    const [iconBox, labelBox] = [await icon.boundingBox(), await tile.locator('.app-launcher-label').boundingBox()];
    assert.ok(labelBox.y >= iconBox.y + iconBox.height - 1, 'label sits below the icon');
    await snap(page, '01-drawer');
    const pagesBefore = desktop.pages().length;
    await tile.click();
    await drawer(page).waitFor({ state: 'detached' });
    await ready(page);
    assert.equal(desktop.pages().length, pagesBefore, 'opens in the same tab');
    assert.equal(await page.locator('.breadcrumb-title h1').innerText(), 'Habit Tracker');
    assert.equal(await page.locator('nav[aria-label="Workspace navigation"] .sidebar-link[aria-current="page"] > span').first().innerText(), 'Habit Tracker');
    ok('one Habit Tracker tile with an SVG icon and label; opens the page in place');
  }

  step('Favorites: add Habit Tracker, synced, opens from favorites');
  {
    await openDrawer(page);
    await page.getByRole('button', { name: 'Edit favorites', exact: true }).click();
    await page.getByRole('button', { name: 'Add Habit Tracker to favorites', exact: true }).click();
    await page.locator('.app-launcher-sync.is-saved').waitFor();
    await page.locator('.app-launcher-done').click();
    await eventually(() => sql(`select launcher_favorites::text from workspace_preferences where user_id = '${alice.id}'`), (value) => value.includes('"habits"'), 'favorite saved');
    const favorites = await page.locator('.app-launcher-favorites .app-launcher-tile .app-launcher-label').allInnerTexts();
    assert.equal(favorites.filter((label) => label === 'Habit Tracker').length, 1);
    assert.equal(await page.locator('.app-launcher-more .app-launcher-tile', { hasText: 'Habit Tracker' }).count(), 0, 'not listed twice');
    await page.keyboard.press('Escape');
    await drawer(page).waitFor({ state: 'detached' });
    ok('favorite persisted and listed once');
  }

  step('Empty state and create with validation (numeric target)');
  {
    await page.getByText('Build a routine, one habit at a time').waitFor();
    await snap(page, '02-empty');
    await page.getByRole('button', { name: 'Create your first habit' }).click();
    const dialog = page.getByRole('dialog', { name: 'New habit' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Create Habit' }).click();
    await dialog.getByText('Give the habit a name.').waitFor();
    assert.equal(Number(sql(`select count(*) from habits where user_id = '${alice.id}'`)), 0, 'invalid form never reaches the server');
    await page.locator('#hb-field-name').fill('Drink water');
    await dialog.getByRole('radio', { name: 'Water', exact: true }).click();
    await dialog.getByRole('radio', { name: 'Teal', exact: true }).click();
    await page.locator('#hb-field-category').selectOption('health');
    await dialog.getByRole('radio', { name: 'Number with target' }).click();
    await page.locator('#hb-field-targetValue').fill('8');
    await page.locator('#hb-field-unit').fill('glasses');
    assert.equal(await page.locator('#hb-field-startDate').inputValue(), today, 'start date defaults to today');
    await snap(page, '03-editor');
    await dialog.getByRole('button', { name: 'Create Habit' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '“Drink water” created.');
    await row(page, 'Drink water').waitFor();
    const saved = sql(`select tracking || '|' || target_value || '|' || unit || '|' || category || '|' || icon || '|' || color from habits where user_id = '${alice.id}'`);
    assert.equal(saved, 'numeric|8.00|glasses|health|droplet|teal');
    ok('validation, create and DB row');
  }

  step('Create a daily checkbox habit with a reminder');
  {
    await page.getByRole('button', { name: 'New Habit' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New habit' });
    await page.locator('#hb-field-name').fill('Read');
    await dialog.getByRole('radio', { name: 'Book', exact: true }).click();
    await page.locator('#hb-field-category').selectOption('study');
    await dialog.getByText('Remind me on scheduled days').click();
    await page.locator('#hb-field-reminderTime').fill('21:00');
    await dialog.getByText(/Desktop alerts|desktop alerts/).first().waitFor();
    await dialog.getByText(/never mark a habit complete/).waitFor();
    await dialog.getByRole('button', { name: 'Create Habit' }).click();
    await dialog.waitFor({ state: 'detached' });
    await row(page, 'Read').waitFor();
    const id = habitId(alice.id, 'Read');
    assert.equal(sql(`select to_char(reminder_time, 'HH24:MI') from habits where id = '${id}'`), '21:00');
    assert.equal(Number(sql(`select count(*) from habit_reminders where habit_id = '${id}' and status = 'scheduled'`)), 1, 'one pending reminder');
    ok('reminder planned in the shared queue');
  }

  // History-rich habits through the API (selected weekdays and a weekly target).
  const meditate = (await alice.api('/habits', { method: 'POST', body: JSON.stringify({ name: 'Meditate', icon: 'brain', color: 'violet', frequency: 'daily', startDate: addDays(today, -10), category: 'health' }) })).body.habit;
  for (let offset = 5; offset >= 1; offset -= 1) assert.equal((await alice.api(`/habits/${meditate.id}/checkins/${addDays(today, -offset)}`, { method: 'PUT', body: JSON.stringify({ completed: true }) })).status, 200);
  const gymDays = [weekday(today), weekday(addDays(today, -2))];
  const gym = (await alice.api('/habits', { method: 'POST', body: JSON.stringify({ name: 'Gym', icon: 'dumbbell', color: 'orange', frequency: 'weekdays', weekdays: gymDays, startDate: addDays(today, -14), category: 'fitness' }) })).body.habit;
  const run = (await alice.api('/habits', { method: 'POST', body: JSON.stringify({ name: 'Run', icon: 'footprints', color: 'green', frequency: 'weekly', weeklyTarget: 3, startDate: addDays(today, -14), category: 'fitness' }) })).body.habit;
  const notGym = addDays(today, -1);

  step('Stats strip, streaks and the three schedule types');
  {
    await reopen(page);
    const stats = page.getByRole('region', { name: 'Habit statistics' });
    await stats.waitFor();
    assert.match(await stats.innerText(), /Current streak\s*5 days\s*Meditate/);
    assert.match(await stats.innerText(), /Best streak\s*5 days/);
    assert.match(await stats.innerText(), /Today\s*0%\s*0 of 5 done/);
    assert.match(await stats.innerText(), /This week\s*\d+%/);
    await row(page, 'Gym').waitFor();
    await row(page, 'Run').waitFor();
    assert.match(await row(page, 'Run').innerText(), /of 3 this week/);
    assert.match(await row(page, 'Meditate').innerText(), /5 days streak/);
    assert.equal(await page.locator('.hb-progress-text').first().innerText(), '0 of 5 completed');
    await snap(page, '04-today');
    ok('stats and rows render from the database');
  }

  step('Check in, undo, numeric amount — saved to the database');
  {
    const readId = habitId(alice.id, 'Read');
    await checkButton(page, 'Read').click();
    await idle(page);
    assert.equal(await checkButton(page, 'Read').getAttribute('aria-pressed'), 'true');
    await eventually(() => checkinCount(readId, today), 1, 'check-in saved');
    assert.equal(await page.locator('.hb-progress-text').first().innerText(), '1 of 5 completed');
    await checkButton(page, 'Read').click();
    await idle(page);
    await eventually(() => checkinCount(readId, today), 0, 'undo removes the check-in');
    assert.equal(await checkButton(page, 'Read').getAttribute('aria-pressed'), 'false');

    const waterId = habitId(alice.id, 'Drink water');
    const amount = page.getByRole('spinbutton', { name: `Drink water amount for ${dayLabel(today)} in glasses` });
    await amount.fill('3');
    await amount.press('Enter');
    await eventually(() => sql(`select value || '|' || completed from habit_checkins where habit_id = '${waterId}' and check_date = '${today}'`), '3.00|false', 'partial amount saved');
    await row(page, 'Drink water').getByText('In progress').waitFor();
    await checkButton(page, 'Drink water').click();
    await idle(page);
    await eventually(() => sql(`select value || '|' || completed from habit_checkins where habit_id = '${waterId}' and check_date = '${today}'`), '8.00|true', 'complete sets the target amount');
    assert.equal(await amount.inputValue(), '8');
    await checkButton(page, 'Gym').click();
    await idle(page);
    await eventually(() => checkinCount(gym.id, today), 1, 'gym saved');
    await checkButton(page, 'Run').click();
    await idle(page);
    await eventually(() => checkinCount(run.id, today), 1, 'weekly habit saved');
    assert.equal(await page.locator('.hb-progress-text').first().innerText(), '3 of 5 completed');
    await snap(page, '05-checked');
    ok('complete / undo / numeric / weekly');
  }

  step('Network failure: no false success');
  {
    const readId = habitId(alice.id, 'Read');
    await page.route(/\/api\/habits\/[^/]+\/checkins\//, (route) => route.abort('failed'));
    await checkButton(page, 'Read').click();
    await toast(page, "That check-in wasn't saved");
    await idle(page);
    assert.equal(await checkButton(page, 'Read').getAttribute('aria-pressed'), 'false', 'UI did not claim success');
    assert.equal(checkinCount(readId, today), 0);
    await page.unroute(/\/api\/habits\/[^/]+\/checkins\//);
    ok('error toast, control unchanged, nothing saved');
  }

  step('Correct a past day from history');
  {
    await page.getByRole('button', { name: 'Previous day' }).click();
    await page.getByRole('heading', { name: `Habits for ${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${notGym}T12:00:00Z`))}` }).waitFor();
    // Meditate was done yesterday: undo it, see the streak recompute, then redo it.
    await checkButton(page, 'Meditate', notGym).click();
    await idle(page);
    await eventually(() => checkinCount(meditate.id, notGym), 0, 'yesterday cleared');
    await page.locator('.hb-date-nav').getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('region', { name: 'Habit statistics' }).getByText('4 days').first().waitFor(); // best streak 4 (days -5…-2)
    await page.getByRole('button', { name: 'Previous day' }).click();
    await checkButton(page, 'Meditate', notGym).click();
    await idle(page);
    await eventually(() => checkinCount(meditate.id, notGym), 1, 'yesterday corrected back');
    const muted = await page.locator('.hb-muted-line').innerText();
    assert.match(muted, /Not scheduled on this day: .*Read/, 'nothing is offered before a habit’s start date');
    assert.match(muted, /Gym/, 'unscheduled weekdays are listed separately');
    await page.locator('.hb-date-nav').getByRole('button', { name: 'Today', exact: true }).click();
    await page.locator('.hb-today-pill').waitFor();
    ok('past day saved; unscheduled habit not offered');
  }

  step('Week view: table and toggling a day');
  {
    await page.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Week' }).click();
    await page.locator('table.hb-week').waitFor();
    const weekRange = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      .formatRange(new Date(`${startOfWeek(today)}T12:00:00Z`), new Date(`${addDays(startOfWeek(today), 6)}T12:00:00Z`));
    const spaces = (text) => text.replace(/\s+/gu, ' ').trim(); // ICU builds differ in thin vs regular spaces
    assert.equal(spaces(await page.locator('.hb-date-heading').innerText()), spaces(weekRange), 'week heading is a readable range (Sunday–Saturday)');
    assert.ok(await page.locator('.hb-week tbody tr').count() >= 5);
    const cell = page.getByRole('button', { name: `Meditate, ${dayLabel(today)}: not done` });
    await cell.click();
    await eventually(() => checkinCount(meditate.id, today), 1, 'week cell saves');
    await page.getByRole('button', { name: `Meditate, ${dayLabel(today)}: done` }).waitFor();
    if (notGym >= startOfWeek(today)) await page.getByRole('img', { name: `Gym, ${dayLabel(notGym)}: not scheduled` }).waitFor();
    await snap(page, '06-week');
    ok('week grid toggles and shows unscheduled days');
  }

  step('Month view: heatmap, legend, selected day');
  {
    await page.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Month' }).click();
    const grid = page.getByRole('grid', { name: /completion$/ });
    await grid.waitFor();
    const legend = await page.getByRole('list', { name: 'Legend' }).innerText();
    for (const label of ['Completed', 'Partly done', 'Incomplete', 'Not scheduled']) assert.ok(legend.includes(label), `legend: ${label}`);
    const twoAgo = addDays(today, -2);
    if (twoAgo.slice(0, 7) === today.slice(0, 7)) {
      const cell = page.locator(`.hb-day[data-date="${twoAgo}"]`);
      assert.match(await cell.getAttribute('aria-label'), /done|missed|nothing scheduled/);
      await cell.click();
      await page.locator('#hb-month-day-title').filter({ hasText: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${twoAgo}T12:00:00Z`)) }).waitFor();
    }
    await page.locator('.hb-month-layout select').selectOption({ label: 'Meditate' });
    await page.locator('.hb-month-rate').filter({ hasText: /completed this month|Nothing scheduled/ }).waitFor();
    await snap(page, '07-month');
    await page.locator('.hb-month-layout select').selectOption('all');
    await page.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Today' }).click();
    const jump = page.locator('.hb-date-nav').getByRole('button', { name: 'Today', exact: true });
    if (await jump.count()) await jump.click();
    await page.locator('.hb-today-pill').waitFor();
    ok('heatmap with legend, per-habit filter and day selection');
  }

  step('Filters, archive, restore, reorder');
  {
    const chips = page.getByRole('group', { name: 'Filter habits' });
    await chips.getByRole('button', { name: 'Completed Today' }).click();
    const doneNames = await page.locator('.hb-row .hb-row-name').allInnerTexts();
    assert.deepEqual(doneNames.sort(), ['Drink water', 'Gym', 'Meditate', 'Run']);
    await chips.getByRole('button', { name: 'Due Today' }).click();
    assert.deepEqual(await page.locator('.hb-row .hb-row-name').allInnerTexts(), ['Read']);
    await chips.getByRole('button', { name: 'All', exact: true }).click();
    // Category filter
    await page.locator('.hb-category-filter select').selectOption('fitness');
    assert.deepEqual((await page.locator('.hb-row .hb-row-name').allInnerTexts()).sort(), ['Gym', 'Run']);
    await page.locator('.hb-category-filter select').selectOption('');

    // Archive through the row menu: hidden from the day, kept in Archived.
    await page.getByRole('button', { name: 'More actions for Gym' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await toast(page, '“Gym” archived. Its history is kept.');
    await row(page, 'Gym').waitFor({ state: 'detached' });
    assert.ok(sql(`select archived_at is not null from habits where id = '${gym.id}'`) === 't');
    assert.equal(checkinCount(gym.id), 1, 'history kept');
    await chips.getByRole('button', { name: /^Archived/ }).click();
    await row(page, 'Gym').waitFor();
    await snap(page, '08-archived');
    await row(page, 'Gym').getByRole('button', { name: 'Restore' }).click();
    await toast(page, '“Gym” restored.');
    await chips.getByRole('button', { name: 'All', exact: true }).click();
    await row(page, 'Gym').waitFor();

    // Reorder: move Drink water down one place, persisted.
    const before = await page.locator('.hb-row .hb-row-name').allInnerTexts();
    await page.getByRole('button', { name: 'More actions for Drink water' }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await eventually(() => page.locator('.hb-row .hb-row-name').allInnerTexts(), (names) => names.indexOf('Drink water') === before.indexOf('Drink water') + 1, 'moved down');
    const expectedOrder = await page.locator('.hb-row .hb-row-name').allInnerTexts();
    await reopen(page);
    assert.deepEqual(await page.locator('.hb-row .hb-row-name').allInnerTexts(), expectedOrder, 'order persisted');
    ok('filters, category, archive/restore with history, reorder');
  }

  step('Edit keeps history; delete requires confirmation');
  {
    await page.getByRole('button', { name: 'Edit Meditate', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit habit' });
    await dialog.waitFor();
    await page.locator('#hb-field-name').fill('Meditate 10 min');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, 'Habit updated.');
    assert.equal(checkinCount(meditate.id), 6, 'renaming keeps check-ins');
    assert.match(await row(page, 'Meditate 10 min').innerText(), /6 days streak/);

    await page.getByRole('button', { name: 'Edit Drink water', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete “Drink water”?' });
    await confirm.waitFor();
    assert.match(await confirm.innerText(), /permanently deletes the habit and its entire check-in history \(1 completed day\)/);
    assert.match(await confirm.innerText(), /Archive it instead/);
    await snap(page, '09-delete-confirm');
    await confirm.getByRole('button', { name: 'Delete permanently' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '“Drink water” and its history were deleted.');
    assert.equal(sql(`select count(*) from habits where user_id = '${alice.id}' and name = 'Drink water'`), '0');
    assert.equal(sql(`select count(*) from habit_checkins c where not exists (select 1 from habits h where h.id = c.habit_id)`), '0');
    ok('rename keeps history; delete confirmed and cascaded');
  }

  step('Reminder: delivered once to the bell via the shared dispatcher; never completes');
  {
    const readId = habitId(alice.id, 'Read');
    sql(`update habit_reminders set local_date = '${today}', week_start = '${startOfWeek(today)}', remind_at = now() - interval '1 minute', dedupe_key = 'habit:${readId}:${today}' where habit_id = '${readId}' and status = 'scheduled'`);
    const cron = await fetch(`${base}/api/internal/calendar-reminders`, { method: 'POST', headers: { 'x-persora-cron-token': 'e2e-cron-token' } });
    assert.equal(cron.status, 200);
    const tick = await cron.json();
    assert.equal(tick.habits.delivered, 1, 'the calendar cron endpoint delivers habit reminders');
    await reopen(page);
    await toast(page, 'Habit reminder: Read');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const bellRow = page.locator('.notification-row', { hasText: 'Read' }).filter({ hasText: 'Habit reminder' });
    await bellRow.waitFor();
    assert.equal(await bellRow.count(), 1, 'one bell entry');
    await snap(page, '10-bell');
    await bellRow.click();
    await ready(page);
    await eventually(() => sql(`select count(*) from habit_reminders where habit_id = '${readId}' and status = 'sent' and read_at is not null`), '1', 'marked read');
    assert.equal(checkinCount(readId, today), 0, 'the reminder did not complete the habit');
    const again = await (await fetch(`${base}/api/internal/calendar-reminders`, { method: 'POST', headers: { 'x-persora-cron-token': 'e2e-cron-token' } })).json();
    assert.equal(again.habits.delivered, 0, 'no duplicate delivery');
    assert.equal(sql(`select count(*) from habit_reminders where habit_id = '${readId}' and status = 'scheduled' and local_date > '${today}'`), '1', 'next slot planned');
    ok('cron → bell + toast once; mark read; never auto-completes');
  }

  step('Isolation and authorization');
  {
    const theirs = await bob.api('/habits');
    assert.equal(theirs.status, 200);
    assert.equal(theirs.body.habits.length, 0, 'Bob sees none of Alice’s habits');
    assert.equal((await bob.api(`/habits/${meditate.id}/checkins/${today}`, { method: 'PUT', body: JSON.stringify({ completed: true }) })).status, 404);
    assert.equal((await bob.api(`/habits/${meditate.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/api/habits`)).status, 401);
    assert.equal(sql(`select has_table_privilege('anon', 'public.habits', 'select')::text || has_table_privilege('authenticated', 'public.habit_checkins', 'select')::text`), 'falsefalse');
    ok('owner-only API; tables closed to client roles');
  }

  step('Backup includes habits; restore via Settings merges into another account');
  {
    const manifest = await alice.backup();
    assert.equal(manifest.format, 'persora-complete-export-v1');
    assert.equal(manifest.data.habits.length, 4);
    assert.equal(manifest.data.habitCheckins.length, Number(sql(`select count(*) from habit_checkins where user_id = '${alice.id}'`)));
    assert.ok(manifest.data.habitCheckins.length >= 8);
    assert.ok(Array.isArray(manifest.data.habitReminders));
    const file = join(tmpdir(), `persora-export-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(manifest));
    const bobContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US', timezoneId: ZONE });
    const bobPage = await signIn(bobContext, bob.email, 'bob');
    await bobPage.locator('.topbar-avatar').click();
    await bobPage.locator('.import-row input[type="file"]').setInputFiles(file);
    await toast(bobPage, 'Habit Tracker restored: 4 habits added');
    assert.equal(sql(`select count(*) from habits where user_id = '${bob.id}'`), '4');
    assert.equal(sql(`select count(*) from habit_checkins where user_id = '${bob.id}'`), String(manifest.data.habitCheckins.length));
    await bobPage.locator('.import-row input[type="file"]').setInputFiles(file);
    await toast(bobPage, '4 habits already here');
    assert.equal(sql(`select count(*) from habits where user_id = '${bob.id}'`), '4', 'restoring twice adds nothing');
    await openHabitsFromDrawer(bobPage);
    await row(bobPage, 'Read').waitFor();
    await bobContext.close();
    ok('export → Settings import → habits and check-ins restored, idempotent');
  }

  step('Keyboard access');
  {
    const button = checkButton(page, 'Read');
    await page.getByRole('button', { name: 'Edit Read', exact: true }).focus();
    await page.keyboard.press('Tab');
    const focus = await button.evaluate((element) => ({ focused: element === document.activeElement, visible: element.matches(':focus-visible'), outline: getComputedStyle(element).outlineStyle }));
    assert.deepEqual(focus, { focused: true, visible: true, outline: 'solid' }, 'Tab reaches the check control with a visible focus ring');
    await page.keyboard.press('Space');
    await idle(page);
    await eventually(() => checkinCount(habitId(alice.id, 'Read'), today), 1, 'Space toggles the check-in');
    await page.getByRole('button', { name: 'More actions for Read' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu', { name: 'Read actions' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitem', 'focus moves into the menu');
    await page.keyboard.press('Escape');
    await page.getByRole('menu', { name: 'Read actions' }).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More actions for Read', 'focus returns to the trigger');
    ok('Space toggles; menu opens, focuses and closes with Escape');
  }

  step('Dark theme');
  {
    const light = await page.locator('.hb-panel').first().evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(250);
    const dark = await page.locator('.hb-panel').first().evaluate((element) => ({ bg: getComputedStyle(element).backgroundColor, fg: getComputedStyle(element.querySelector('.hb-panel-head h2')).color }));
    assert.notEqual(dark.bg, light, 'panels switch to a dark surface');
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    assert.ok(lum(dark.bg) < 80 && lum(dark.fg) > 150, `readable dark contrast (${dark.bg} / ${dark.fg})`);
    await snap(page, '11-dark-today');
    await page.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Month' }).click();
    await page.getByRole('grid', { name: /completion$/ }).waitFor();
    await snap(page, '12-dark-month');
    await page.getByRole('button', { name: 'Edit Read', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit habit' }).waitFor();
    await snap(page, '13-dark-editor');
    await page.getByRole('dialog', { name: 'Edit habit' }).getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await page.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Today' }).click();
    ok('dark surfaces with readable contrast');
  }

  step('Tablet and phone layouts');
  {
    for (const [label, size] of [['tablet', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }], ['small-phone', { width: 320, height: 640 }]]) {
      const context = await browser.newContext({ viewport: size, locale: 'en-US', timezoneId: ZONE, isMobile: label !== 'tablet', hasTouch: label !== 'tablet' });
      const mobile = await signIn(context, alice.email, label);
      await openHabitsFromDrawer(mobile);
      await row(mobile, 'Read').waitFor();
      await noHorizontalOverflow(mobile, `${label} today`);
      const box = await checkButton(mobile, 'Read').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= size.width, `${label}: check control visible`);
      assert.ok(box.width >= 30 && box.height >= 30, `${label}: touch-sized check control (${box.width}×${box.height})`);
      assert.ok(await mobile.getByRole('button', { name: 'New Habit' }).first().isVisible(), `${label}: New Habit visible`);
      await snap(mobile, `14-${label}-today`);
      await mobile.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Week' }).click();
      await mobile.locator('table.hb-week').waitFor();
      await noHorizontalOverflow(mobile, `${label} week`);
      await snap(mobile, `15-${label}-week`);
      await mobile.getByRole('group', { name: 'Habit view' }).getByRole('button', { name: 'Month' }).click();
      await mobile.getByRole('grid', { name: /completion$/ }).waitFor();
      await noHorizontalOverflow(mobile, `${label} month`);
      await snap(mobile, `16-${label}-month`);
      if (label === 'phone') {
        await mobile.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await snap(mobile, '17-phone-dark-month');
        await mobile.evaluate(() => document.documentElement.removeAttribute('data-theme'));
        await mobile.getByRole('button', { name: 'New Habit' }).first().click();
        const dialog = mobile.getByRole('dialog', { name: 'New habit' });
        await dialog.waitFor();
        const dialogBox = await dialog.boundingBox();
        assert.ok(dialogBox.width <= size.width + 1, 'editor fits the phone width');
        await snap(mobile, '18-phone-editor');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      }
      await context.close();
      ok(`${label}: no sideways scrolling; controls reachable`);
    }
  }

  step('Deep link ?view=habits');
  {
    await page.goto(`${base}/?view=habits`);
    await workspaceReady(page);
    await ready(page);
    ok('reminder email link opens Habit Tracker');
  }

  assert.deepEqual(consoleErrors, [], 'no console errors or failed requests');
  ok('no console errors or failed requests');
  console.log(`\nALL HABIT TRACKER E2E CHECKS PASSED — screenshots in ${shots}`);
  await desktop.close();
} finally {
  await browser.close();
  await stopAll();
}
process.exit(0);
