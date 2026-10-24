// Browser end-to-end check of Persora Table on the production build, against
// real Postgres 17 + PostgREST + the Pages API worker. Not part of `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run test:e2e:table
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-table-shots');
mkdirSync(shots, { recursive: true });
const work = join(tmpdir(), `persora-table-e2e-${Date.now()}`);
mkdirSync(work, { recursive: true });
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

await startDatabase();
const app = await startApp();
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

async function register(name, { paid = false } = {}) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}@persora.test`;
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: name, email, password: 'Correct-Horse-9' }) });
  assert.equal(response.status, 201, await response.clone().text());
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const id = sql(`select id from profiles where email = '${email}'`);
  sql(`update profiles set timezone = '${ZONE}' where id = '${id}'`);
  if (paid) {
    sql(`insert into subscription_plans (slug, name, storage_gb) values ('e2e-pro', 'E2E Pro', 5) on conflict (slug) do nothing`);
    sql(`insert into user_subscriptions (user_id, plan_id, status, storage_limit_gb, current_period_end)
         values ('${id}', (select id from subscription_plans where slug = 'e2e-pro'), 'active', 5, now() + interval '30 days')
         on conflict (user_id) do update set plan_id = excluded.plan_id, status = 'active', storage_limit_gb = 5, current_period_end = excluded.current_period_end`);
  }
  const api = async (path, init = {}) => {
    const res = await fetch(`${base}/api${path}`, { ...init, headers: { cookie, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, headers: res.headers };
  };
  const send = (method, path, body) => api(path, { method, body: JSON.stringify(body) });
  const backup = async () => {
    const res = await fetch(`${base}/api/account/export`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const tar = new Uint8Array(await res.arrayBuffer());
    const size = parseInt(new TextDecoder().decode(tar.subarray(124, 135)), 8);
    return JSON.parse(new TextDecoder().decode(tar.subarray(512, 512 + size)));
  };
  return { email, id, cookie, api, send, backup };
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
async function openSpace(page) {
  await page.goto(`${base}/?view=tables`);
  await workspaceReady(page);
  await page.locator('.tb-home').waitFor();
  await page.locator('.tb-loading').waitFor({ state: 'detached' });
}
const tableIdFromUrl = (page) => new URL(page.url()).searchParams.get('table');
const saveIndicator = (page) => page.locator('.tb-save');
async function saved(page, timeout = 10000) {
  await page.locator('.tb-save.is-saved').waitFor({ timeout });
}
const toast = (page, text) => page.getByText(text, { exact: false }).first().waitFor();
/** A main-area spreadsheet cell (row = sheet row index, counting frozen rows). */
function cell(page, row, col, frozen = 0) {
  const pinned = row < frozen;
  return page.locator(`revogr-data[type="${pinned ? 'rowPinStart' : 'rgRow'}"][col-type="rgCol"] .rgCell[data-rgrow="${pinned ? row : row - frozen}"][data-rgcol="${col}"]`);
}
const cellText = (page, row, col, frozen = 0) => cell(page, row, col, frozen).innerText().then((text) => text.trim());
/** Waits until a cell shows `expected` (rendering follows the edit by a frame or two). */
const expectCell = (page, row, col, expected, message, frozen = 0) => eventually(() => cellText(page, row, col, frozen), expected, message || `cell ${row}:${col}`);
async function gridReady(page) {
  await page.locator('revo-grid').waitFor();
  await page.locator('revogr-data[type="rgRow"][col-type="rgCol"] .rgCell').first().waitFor();
  await page.waitForTimeout(150);
}
async function typeInto(page, row, col, text, frozen = 0) {
  await cell(page, row, col, frozen).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}
const sheetCells = (tableId, position = 0) => JSON.parse(sql(`select data->'cells' from persora_table_sheets where table_id = '${tableId}' and position = ${position}`) || 'null');
const revision = (tableId) => Number(sql(`select revision from persora_tables where id = '${tableId}'`));
async function chooseMenu(page, menuLabel, itemName) {
  await page.getByRole('button', { name: menuLabel, exact: true }).first().click();
  await page.getByRole('menu').waitFor();
  await page.getByRole('menu').getByRole(/^menuitem/.test(itemName) ? 'menuitem' : 'menuitem', { name: itemName }).click();
}
async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `${label}: page does not scroll sideways (${overflow}px)`);
}

try {
  const alice = await register('Table Alice', { paid: true });
  const bob = await register('Table Bob');
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: ZONE, acceptDownloads: true });
  await desktop.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await signIn(desktop, alice.email, 'alice');

  // ---------------------------------------------------------------------------------------------
  step('Space: sidebar entry, empty state, blank spreadsheet');
  {
    await page.locator('nav[aria-label="Workspace navigation"]').getByRole('button', { name: 'Persora Table', exact: true }).first().click();
    await page.locator('.tb-home').waitFor();
    await page.getByRole('heading', { name: 'No tables yet' }).waitFor();
    await snap(page, '01-desktop-empty');
    await page.locator('.tb-empty').getByRole('button', { name: 'Blank spreadsheet' }).click();
    await page.locator('.tb-editor.is-spreadsheet').waitFor();
    await gridReady(page);
    await toast(page, 'Spreadsheet created.');
    const id = tableIdFromUrl(page);
    assert.match(id || '', /^[0-9a-f-]{36}$/, 'the open table is in the address bar');
    assert.equal(new URL(page.url()).searchParams.get('view'), 'tables', 'the deep link names the space');
    assert.equal(sql(`select kind || '|' || name || '|' || sheet_count from persora_tables where id = '${id}' and user_id = '${alice.id}'`), 'spreadsheet|Untitled spreadsheet|1');
    await page.getByRole('heading', { level: 2, name: 'Untitled spreadsheet' }).waitFor();
    ok('sidebar opens the space; the empty state creates a spreadsheet saved on the server');
  }

  step('Spreadsheet: typing, formulas, errors, Saved only after the server confirms');
  let sheetId;
  {
    sheetId = tableIdFromUrl(page);
    const before = revision(sheetId);
    await typeInto(page, 0, 0, 'Item');
    await typeInto(page, 0, 1, 'Amount');
    await typeInto(page, 1, 0, 'Rent');
    await typeInto(page, 1, 1, '1200');
    await typeInto(page, 2, 0, 'Food');
    await typeInto(page, 2, 1, '350.5');
    await typeInto(page, 3, 0, 'Total');
    await typeInto(page, 3, 1, '=SUM(B2:B3)');
    await expectCell(page, 3, 1, '1550.5', 'SUM result shown in the cell');
    // The formula, not the result, is what you edit.
    await cell(page, 3, 1).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'B4', 'the address follows the selection');
    await eventually(() => page.getByRole('textbox', { name: 'Contents of B4' }).inputValue(), '=SUM(B2:B3)', 'formula bar shows the formula');
    // Dependents recalculate.
    await typeInto(page, 1, 1, '1000');
    await expectCell(page, 3, 1, '1350.5', 'the total follows its inputs');
    // Errors stay visible and keep the formula.
    await typeInto(page, 4, 1, '=B2/0');
    await expectCell(page, 4, 1, '#DIV/0!');
    await typeInto(page, 5, 1, '=C6+1');
    await typeInto(page, 5, 2, '=B6');
    await expectCell(page, 5, 1, '#CYCLE!', 'circular reference reported');
    await typeInto(page, 6, 1, '=VLOOKUP(1,A1:B2,2)');
    await expectCell(page, 6, 1, '#NAME?', 'unsupported function reported');
    await cell(page, 6, 1).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'B7', 'B7 selected');
    await page.locator('.tb-formula-error').waitFor();
    assert.match(await page.locator('.tb-formula-error').innerText(), /VLOOKUP/i, 'the message names the unsupported function');
    await typeInto(page, 7, 1, '=SUM(B2:');
    await expectCell(page, 7, 1, '#ERROR!', 'invalid formula is an error, not 0');
    await typeInto(page, 8, 1, "'=not a formula");
    await expectCell(page, 8, 1, '=not a formula', 'apostrophe keeps text starting with =');
    await saved(page);
    const cells = sheetCells(sheetId);
    assert.deepEqual(cells['3:1'], { f: '=SUM(B2:B3)' }, 'the formula is stored, not its result');
    assert.deepEqual(cells['7:1'], { f: '=SUM(B2:' }, 'an invalid formula is kept as typed');
    assert.deepEqual(cells['8:1'], { v: '=not a formula' }, 'apostrophe text is stored as text');
    assert.equal(cells['1:1'].v, 1000, 'numbers are stored as numbers');
    assert.ok(revision(sheetId) > before, 'the revision advanced');
    await snap(page, '02-desktop-formulas');
    ok('formulas compute, recalculate, report #DIV/0!, #CYCLE!, #NAME?, #ERROR! and keep what was typed');
  }

  assert.deepEqual(consoleErrors, [], 'no console errors or failed requests');
  ok('no console errors or failed requests');
  console.log(`\nALL PERSORA TABLE E2E CHECKS PASSED — screenshots in ${shots}`);
  await desktop.close();
} catch (error) {
  let index = 0;
  for (const context of browser.contexts()) for (const open of context.pages()) {
    index += 1;
    await open.screenshot({ path: join(shots, `FAILURE-${index}.png`) }).catch(() => {});
    const texts = await open.locator('revogr-data[col-type="rgCol"] .rgCell').evaluateAll((nodes) => nodes.slice(0, 40).map((node) => `${node.closest('revogr-data')?.getAttribute('type')}:${node.dataset.rgrow}:${node.dataset.rgcol}=${node.textContent}`).filter((text) => !text.endsWith('='))).catch(() => []);
    if (texts.length) console.log(`  page ${index} cells: ${texts.join(' | ')}`);
  }
  if (consoleErrors.length) console.log('  console errors so far:', consoleErrors);
  throw error;
} finally {
  await browser.close();
  await stopAll();
}
process.exit(0);
