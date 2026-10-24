// Browser end-to-end check of Persora Loan Tracker on the production build,
// against real Postgres 17 + PostgREST + the Pages API worker. Not part of
// `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run test:e2e:loans
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';
import { addDays, localDateOf } from '../../cloudflare/calendar-rules.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-loan-shots');
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
const CRON = { method: 'POST', headers: { 'x-persora-cron-token': 'e2e-cron-token' } };

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
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const backup = async () => {
    const res = await fetch(`${base}/api/account/export`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const tar = new Uint8Array(await res.arrayBuffer());
    const size = parseInt(new TextDecoder().decode(tar.subarray(124, 135)), 8);
    return JSON.parse(new TextDecoder().decode(tar.subarray(512, 512 + size)));
  };
  return { email, id, api, post, backup };
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
  await page.locator('.ln-view').waitFor();
  await page.locator('.ln-skeleton').waitFor({ state: 'detached' });
  await page.waitForTimeout(150);
}
async function openLoansFromDrawer(page) {
  await openDrawer(page);
  const tiles = page.locator('.app-launcher-panel .app-launcher-tile', { hasText: 'Loan Tracker' });
  assert.equal(await tiles.count(), 1, 'Loan Tracker appears exactly once in the drawer');
  await tiles.first().click();
  await drawer(page).waitFor({ state: 'detached' });
  await ready(page);
}
/** The overview, via the reminder-email deep link (a plain reload returns to the default view). */
async function overview(page) {
  await page.goto(`${base}/?view=loans`);
  await workspaceReady(page);
  await ready(page);
}
async function openLoan(page, name) {
  await page.getByRole('button', { name: new RegExp(`^${name}, `) }).click();
  await page.getByRole('heading', { level: 2, name, exact: true }).waitFor();
  await ready(page);
}
const inst = (page, number) => page.locator('.ln-inst', { has: page.locator(`[aria-label="Installment ${number}"]`) });
const badge = (page, number) => inst(page, number).locator('.ln-inst-date .ln-badge').innerText();
const toast = (page, text) => page.getByText(text, { exact: false }).first().waitFor();
const payDialog = (page, number) => page.getByRole('dialog', { name: `Record payment · installment ${number}` });
const installmentId = (loanId, number) => sql(`select id from loan_installments where loan_id = '${loanId}' and number = ${number}`);
const paid = (loanId, number) => sql(`select paid_amount from loan_installments where loan_id = '${loanId}' and number = ${number}`);
const paymentRows = (loanId) => Number(sql(`select count(*) from loan_payments where loan_id = '${loanId}'`));
async function openMenu(page) {
  await page.getByRole('button', { name: 'More loan actions' }).click();
  await page.getByRole('menu').waitFor();
}
async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const view = document.querySelector('.ln-view');
    return { doc: document.documentElement.scrollWidth - window.innerWidth, view: view ? view.scrollWidth - view.clientWidth : 0 };
  });
  assert.ok(overflow.doc <= 1, `${label}: page does not scroll sideways (${overflow.doc}px)`);
  assert.ok(overflow.view <= 1, `${label}: loan view fits (${overflow.view}px)`);
}

try {
  const alice = await register('Loan Alice');
  const bob = await register('Loan Bob');
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: ZONE });
  const page = await signIn(desktop, alice.email, 'desktop');

  step('App Drawer and sidebar entries open the real page');
  {
    await openDrawer(page);
    const tile = page.locator('.app-launcher-panel .app-launcher-tile', { hasText: 'Loan Tracker' });
    assert.equal(await tile.count(), 1);
    const icon = tile.locator('svg.launcher-module-icon');
    assert.equal(await icon.count(), 1, 'an inline SVG icon');
    assert.equal(await tile.locator('img, text').count(), 0, 'no raster image and no SVG text');
    assert.ok(await icon.locator('linearGradient').count() >= 2, 'layered gradients');
    assert.equal(await tile.locator('.app-launcher-label').innerText(), 'Loan Tracker', 'label beneath the icon');
    await snap(page, '01-drawer');
    const pagesBefore = desktop.pages().length;
    await tile.click();
    await drawer(page).waitFor({ state: 'detached' });
    await ready(page);
    assert.equal(desktop.pages().length, pagesBefore, 'opens in the same tab');
    assert.equal(await page.locator('.breadcrumb-title h1').innerText(), 'Loan Tracker');
    const nav = page.locator('nav[aria-label="Workspace navigation"]');
    assert.equal(await nav.getByRole('button', { name: 'Loan Tracker', exact: true }).count(), 1, 'one sidebar entry');
    assert.equal(await nav.locator('.sidebar-link[aria-current="page"] > span').first().innerText(), 'Loan Tracker');
    ok('one drawer tile with an SVG icon and label, one sidebar link; opens in place');
  }

  step('Empty state, validation, live preview (reducing interest) and create');
  let bikeId;
  {
    await page.getByText('Track a loan or installment plan').waitFor();
    await snap(page, '02-empty');
    await page.locator('.ln-empty').getByRole('button', { name: 'New Loan' }).click();
    const dialog = page.getByRole('dialog', { name: 'New loan' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Create Loan' }).click();
    await dialog.getByText('Enter the loan name or purpose.').waitFor();
    assert.equal(sql(`select count(*) from loans where user_id = '${alice.id}'`), '0', 'invalid form never reaches the server');
    assert.equal(await page.locator('#ln-field-borrowerName').inputValue(), 'Loan Alice', 'you are the borrower by default');
    await page.locator('#ln-field-name').fill('Bike loan');
    await page.locator('#ln-field-partyName').fill('City Bank');
    await page.locator('#ln-field-principal').fill('100000');
    await dialog.getByRole('radio', { name: 'Reducing', exact: true }).click();
    await page.locator('#ln-field-interestRate').fill('12');
    await page.locator('#ln-field-installmentCount').fill('12');
    await page.locator('#ln-field-frequency').selectOption('monthly');
    await page.locator('#ln-field-startDate').fill(addDays(today, -50));
    await page.locator('#ln-field-firstDueDate').fill(addDays(today, -60));
    await dialog.getByText("The first installment can't be before the loan starts.").waitFor();
    await page.locator('#ln-field-firstDueDate').fill(addDays(today, -40));
    const preview = page.getByRole('region', { name: 'Repayment preview' });
    await preview.getByText('8,884.88').first().waitFor();
    const text = (await preview.innerText()).replace(/\s+/gu, ' ');
    for (const expected of ['8,884.88', 'final', '8,884.85', '6,618.53', '106,618.53', 'Reducing balance', 'final installment absorbs the rounding', 'estimate']) {
      assert.ok(text.includes(expected), `preview shows “${expected}”: ${text}`);
    }
    assert.ok(!/guaranteed/i.test(text) || /not guaranteed|can differ/i.test(text), 'figures are never presented as guaranteed');
    await page.locator('#ln-field-reminderDaysBefore').selectOption('1');
    await dialog.getByLabel('Tell me when an installment is overdue').check();
    await dialog.locator('summary', { hasText: 'Reference, notes and documents' }).click();
    await page.locator('#ln-field-reference').fill('AGR-77');
    await snap(page, '03-editor');
    await dialog.getByRole('button', { name: 'Create Loan' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '“Bike loan” added.');
    await page.getByRole('heading', { level: 2, name: 'Bike loan', exact: true }).waitFor();
    bikeId = sql(`select id from loans where user_id = '${alice.id}' and name = 'Bike loan'`);
    assert.equal(sql(`select count(*) || '|' || sum(amount) || '|' || min(amount) from loan_installments where loan_id = '${bikeId}'`), '12|106618.53|8884.85');
    assert.equal(sql(`select direction || '|' || party_name || '|' || borrower_name || '|' || interest_method || '|' || interest_rate::float8 || '|' || reference || '|' || reminder_days_before || '|' || overdue_alerts from loans where id = '${bikeId}'`),
      'borrowed|City Bank|Loan Alice|reducing|12|AGR-77|1|true');
    const next = page.getByRole('region', { name: 'Next installment' });
    assert.match((await next.innerText()).replace(/\s+/gu, ' '), /#1 of 12.*8,884\.88.*Overdue/i);
    assert.equal(await badge(page, 1), 'Overdue');
    assert.equal(await badge(page, 2), 'Overdue');
    assert.equal(await badge(page, 3), 'Upcoming');
    assert.match(await page.locator('.ln-figures').innerText(), /17,769\.76/, 'overdue amount = two missed installments');
    assert.match(page.url(), new RegExp(`loan=${bikeId}`), 'the address bar links to this loan');
    await snap(page, '04-details');
    ok('validation blocks bad input; preview matches the engine; 12 installments saved; missed ones are Overdue (never Paid)');
  }

  step('Partial payment, overpayment blocked, then the remainder');
  {
    await page.getByRole('button', { name: 'Record payment for installment 1', exact: true }).click();
    const dialog = payDialog(page, 1);
    await dialog.waitFor();
    assert.equal(await page.locator('#ln-pay-amount').inputValue(), '8884.88', 'defaults to the remaining amount');
    await page.locator('#ln-pay-amount').fill('3000');
    await dialog.getByText('Partial payment').waitFor();
    await page.locator('#ln-pay-method').fill('bKash');
    await page.locator('#ln-pay-reference').fill('TX-1');
    await snap(page, '05-payment');
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '3,000.00 recorded.');
    assert.equal(paid(bikeId, 1), '3000.00');
    assert.equal(await badge(page, 1), 'Overdue', 'a partial payment after the due date is still overdue, not paid');
    assert.match(await inst(page, 1).innerText(), /3,000\.00 paid · .*5,884\.88 left/);

    await page.getByRole('button', { name: 'Record payment for installment 1', exact: true }).click();
    await dialog.waitFor();
    await page.locator('#ln-pay-amount').fill('6000');
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await dialog.getByText('This installment has 5884.88 remaining.').waitFor();
    assert.equal(paymentRows(bikeId), 1, 'an overpayment is never sent');
    expectedFailures.push({ status: 400, path: /^\/api\/loans\// });
    const iid = installmentId(bikeId, 1);
    assert.equal((await alice.post(`/loans/${bikeId}/installments/${iid}/payments`, { id: crypto.randomUUID(), amount: '6000', paidOn: today })).status, 400, 'the server also refuses overpayment');
    assert.equal((await alice.post(`/loans/${bikeId}/installments/${iid}/payments`, { id: crypto.randomUUID(), amount: '-5', paidOn: today })).status, 400, 'and negative amounts');
    assert.equal((await alice.post(`/loans/${bikeId}/installments/${iid}/payments`, { id: crypto.randomUUID(), amount: '5', paidOn: addDays(today, 1) })).status, 400, 'and future dates');
    await dialog.getByRole('button', { name: /^Full remaining/ }).click();
    assert.equal(await page.locator('#ln-pay-amount').inputValue(), '5884.88');
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '5,884.88 recorded.');
    assert.equal(paid(bikeId, 1), '8884.88');
    assert.equal(paymentRows(bikeId), 2, 'each payment is its own transaction');
    assert.equal(await badge(page, 1), 'Paid');
    ok('partial → still overdue with the right remainder; overpayment/negative/future refused; full → Paid');
  }

  step('A dropped connection never duplicates a payment');
  {
    const pattern = /\/api\/loans\/[^/]+\/installments\/[^/]+\/payments$/;
    // The request reaches the server, but the browser never sees the answer.
    await page.route(pattern, async (route) => { await route.fetch(); await route.abort('failed'); });
    await page.getByRole('button', { name: 'Record payment for installment 2', exact: true }).click();
    const dialog = payDialog(page, 2);
    await dialog.waitFor();
    await page.locator('#ln-pay-amount').fill('2000');
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await dialog.getByText("The payment couldn't be recorded").waitFor();
    assert.equal(sql(`select count(*) from loan_payments where installment_id = '${installmentId(bikeId, 2)}'`), '1', 'the server did record it');
    await page.unroute(pattern);
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '2,000.00 recorded.');
    assert.equal(sql(`select count(*) || '|' || sum(amount) from loan_payments where installment_id = '${installmentId(bikeId, 2)}'`), '1|2000.00', 'the retry replayed instead of duplicating');
    // A second partial on the same installment is a separate payment.
    await page.getByRole('button', { name: 'Record payment for installment 2', exact: true }).click();
    await dialog.waitFor();
    await page.locator('#ln-pay-amount').fill('1000');
    await page.locator('#ln-pay-method').fill('Cash');
    await dialog.getByRole('button', { name: 'Record Payment' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(paid(bikeId, 2), '3000.00');
    assert.equal(sql(`select count(*) from loan_payments where installment_id = '${installmentId(bikeId, 2)}'`), '2');
    ok('error shown, nothing claimed; retry with the same payment id replays; multiple partials add up');
  }

  step('Corrections and reversals keep the history');
  {
    await page.getByRole('button', { name: 'Show 2 payments for installment 1', exact: true }).click();
    const original = inst(page, 1).locator('.ln-payments li', { hasText: '3,000.00' });
    await original.getByRole('button', { name: 'Correct' }).click();
    const correct = page.getByRole('dialog', { name: 'Correct payment' });
    await correct.waitFor();
    await page.locator('#ln-pay-amount').fill('2500');
    await correct.getByRole('button', { name: 'Save Correction' }).click();
    await correct.getByText('Say why, so the history stays clear.').waitFor();
    await page.locator('#ln-pay-reason').fill('Typed the wrong amount');
    await correct.getByRole('button', { name: 'Save Correction' }).click();
    await correct.waitFor({ state: 'detached' });
    await toast(page, 'Payment corrected. The original stays in the history.');
    assert.equal(paid(bikeId, 1), '8384.88');
    assert.equal(sql(`select string_agg(amount || ':' || status || ':' || (corrects_payment_id is not null), ',' order by created_at) from loan_payments where installment_id = '${installmentId(bikeId, 1)}'`),
      '3000.00:reversed:false,5884.88:recorded:false,2500.00:recorded:true');
    assert.equal(await badge(page, 1), 'Overdue', 'no longer fully paid after the correction');
    await page.getByRole('button', { name: 'Show 2 payments for installment 2', exact: true }).click();
    await inst(page, 2).locator('.ln-payments li', { hasText: '1,000.00' }).getByRole('button', { name: 'Reverse' }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverse payment' });
    await reverse.waitFor();
    await page.locator('#ln-pay-reason').fill('Cash was returned');
    await reverse.getByRole('button', { name: 'Reverse Payment' }).click();
    await reverse.waitFor({ state: 'detached' });
    await toast(page, 'Payment reversed. It stays in the history.');
    assert.equal(paid(bikeId, 2), '2000.00');
    assert.equal(sql(`select status || '|' || reversal_reason from loan_payments where installment_id = '${installmentId(bikeId, 2)}' and amount = 1000`), 'reversed|Cash was returned');
    const history = await inst(page, 2).locator('.ln-payments').innerText();
    assert.match(history, /Reversed — Cash was returned/);
    await snap(page, '06-history');
    ok('correction = reversal + linked replacement; reversal keeps the row with its reason; balances follow');
  }

  step('Schedule-affecting edit: preview, confirmation, past rows untouched');
  {
    const before = sql(`select string_agg(amount::text, ',' order by number) from loan_installments where loan_id = '${bikeId}' and number <= 2`);
    const paymentsBefore = paymentRows(bikeId);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.locator('#ln-field-interestRate').fill('10');
    await dialog.getByText("You'll review the recalculated installments").waitFor();
    await dialog.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('dialog', { name: 'Confirm the new schedule' }).waitFor();
    assert.match(await dialog.innerText(), /1–2\s+Kept unchanged/);
    await snap(page, '07-recalculate');
    assert.equal(sql(`select interest_rate::float8 from loans where id = '${bikeId}'`), '12', 'nothing saved before confirming');
    await dialog.getByRole('button', { name: 'Confirm & recalculate' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, 'Loan updated. Future installments were recalculated.');
    assert.equal(sql(`select string_agg(amount::text, ',' order by number) from loan_installments where loan_id = '${bikeId}' and number <= 2`), before, 'past installments are never rewritten');
    assert.notEqual(sql(`select amount from loan_installments where loan_id = '${bikeId}' and number = 3`), '8884.88', 'future installments were recalculated');
    assert.equal(paymentRows(bikeId), paymentsBefore, 'payment history untouched');
    assert.equal(sql(`select jsonb_array_length(schedule_changes) || '|' || (original_terms->>'interestRate') || '|' || interest_rate::float8 from loans where id = '${bikeId}'`), '1|12|10');
    assert.match(await page.locator('.ln-side').innerText(), /Original terms/);
    // A non-schedule edit saves directly.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('details.ln-more').getAttribute('open'), '', 'a loan with a reference opens its extra details');
    await page.locator('#ln-field-notes').fill('Keep receipts in the blue folder');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, 'Loan updated.');
    assert.equal(sql(`select jsonb_array_length(schedule_changes) from loans where id = '${bikeId}'`), '1');
    ok('preview + explicit confirmation; installments 1–2 and payments preserved; change logged; original terms kept');
  }

  step('Dashboard cards and filters');
  let lentId;
  {
    lentId = crypto.randomUUID();
    const created = await alice.post('/loans', {
      id: lentId, name: 'Tuition for Rafi', direction: 'lent', partyName: 'Loan Alice', borrowerName: 'Rafi', currency: 'BDT', principal: '1200',
      interestMethod: 'none', interestRate: '', installmentCount: 3, frequency: 'weekly', startDate: today, firstDueDate: addDays(today, 3),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.installments.map((row) => row.amount), [400, 400, 400]);
    await page.getByRole('button', { name: 'All loans' }).click();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByRole('button', { name: /^Tuition for Rafi, / }).waitFor();
    const stats = page.getByRole('region', { name: 'Loan summary' });
    const statText = (await stats.innerText()).replace(/\s+/gu, ' ');
    assert.match(statText, /Active amount ৳101,200\.00 2 active loans/);
    assert.match(statText, /Overdue ৳\S+ 2 installments/);
    assert.match(statText, /Next installment ৳500\.00 \S+ \d+ · Bike loan/, 'the earliest unpaid installment across active loans');
    const chips = page.getByRole('group', { name: 'Filter loans' });
    const counts = Object.fromEntries(await Promise.all(['All', 'Borrowed', 'Lent', 'Active', 'Completed', 'Overdue'].map(async (label) => [label, (await chips.getByRole('button', { name: new RegExp(`^${label}`) }).innerText()).replace(/\D+/gu, '')])));
    assert.deepEqual(counts, { All: '2', Borrowed: '1', Lent: '1', Active: '2', Completed: '0', Overdue: '1' });
    await chips.getByRole('button', { name: /^Lent/ }).click();
    assert.deepEqual(await page.locator('.ln-row-name').allInnerTexts(), ['Tuition for Rafi']);
    await chips.getByRole('button', { name: /^Overdue/ }).click();
    assert.deepEqual(await page.locator('.ln-row-name').allInnerTexts(), ['Bike loan']);
    await chips.getByRole('button', { name: /^Completed/ }).click();
    await page.getByText('No completed loans.').waitFor();
    await chips.getByRole('button', { name: /^All/ }).click();
    assert.deepEqual(await page.locator('.ln-row-name').allInnerTexts(), ['Bike loan', 'Tuition for Rafi'], 'overdue loans first');
    await snap(page, '08-overview');
    ok('cards computed from the filtered loans; all six filters work');
  }

  step('Reminder: delivered once via the shared dispatcher; never records a payment');
  {
    assert.equal(sql(`select count(*) from loan_reminders where loan_id = '${bikeId}' and status = 'scheduled'`), '1', 'one scheduled reminder per loan');
    const paidBefore = sql(`select sum(paid_amount) from loan_installments where loan_id = '${bikeId}'`);
    sql(`update loan_reminders set remind_at = now() - interval '1 minute' where loan_id = '${bikeId}' and status = 'scheduled'`);
    const cron = await fetch(`${base}/api/internal/calendar-reminders`, CRON);
    assert.equal(cron.status, 200);
    const tick = await cron.json();
    assert.equal(tick.loans.delivered, 1, 'the calendar cron endpoint delivers loan reminders');
    await overview(page);
    await page.getByText(/(Installment reminder|Overdue installment): Bike loan/).first().waitFor();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const bellRow = page.locator('.notification-row', { hasText: 'Bike loan' });
    await bellRow.waitFor();
    assert.equal(await bellRow.count(), 1, 'one bell entry');
    assert.match(await bellRow.innerText(), /Installment \d+ (due|overdue since)/);
    await snap(page, '09-bell');
    await bellRow.click();
    await page.getByRole('heading', { level: 2, name: 'Bike loan', exact: true }).waitFor();
    await eventually(() => sql(`select count(*) from loan_reminders where loan_id = '${bikeId}' and status = 'sent' and read_at is not null`), '1', 'marked read');
    assert.equal(sql(`select sum(paid_amount) from loan_installments where loan_id = '${bikeId}'`), paidBefore, 'the reminder recorded nothing');
    const again = await (await fetch(`${base}/api/internal/calendar-reminders`, CRON)).json();
    assert.equal(again.loans.delivered, 0, 'no duplicate delivery');
    ok('cron → bell + toast once; bell opens the loan; marked read; nothing marked paid');
  }

  step('Cross-device sync');
  {
    const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, locale: 'en-US', timezoneId: ZONE });
    const other = await signIn(tablet, alice.email, 'second-device');
    await other.goto(`${base}/?view=loans&loan=${bikeId}`);
    await workspaceReady(other);
    await other.getByRole('heading', { level: 2, name: 'Bike loan', exact: true }).waitFor();
    await ready(other);
    assert.equal(await badge(other, 3), 'Upcoming');
    // Desktop records a partial payment on an upcoming installment.
    await page.getByRole('button', { name: 'Record payment for installment 3', exact: true }).click();
    await payDialog(page, 3).waitFor();
    await page.locator('#ln-pay-amount').fill('1000');
    await payDialog(page, 3).getByRole('button', { name: 'Record Payment' }).click();
    await payDialog(page, 3).waitFor({ state: 'detached' });
    assert.equal(await badge(page, 3), 'Partially paid');
    await other.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await eventually(() => badge(other, 3), 'Partially paid', 'the other device shows the new payment');
    // A stale edit from the other device is refused, not silently merged.
    expectedFailures.push({ status: 409, path: /^\/api\/loans\// });
    const stale = await alice.api(`/loans/${bikeId}`);
    const current = stale.body.loan;
    const input = { name: current.name, direction: current.direction, partyName: current.partyName, borrowerName: current.borrowerName, currency: current.currency,
      principal: String(current.principal), interestMethod: current.interestMethod, interestRate: String(current.interestRate), installmentCount: current.installmentCount,
      frequency: current.frequency, startDate: current.startDate, firstDueDate: current.firstDueDate, notes: 'Edited on an old tab', documentIds: [] };
    const conflict = await alice.api(`/loans/${bikeId}`, { method: 'PATCH', body: JSON.stringify({ ...input, revision: current.revision - 1 }) });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(sql(`select notes from loans where id = '${bikeId}'`), 'Keep receipts in the blue folder', 'the stale edit changed nothing');
    await tablet.close();
    ok('a payment made on one device appears on the other on focus; stale edits get 409');
  }

  step('Completion only at zero outstanding; a reversal reopens it');
  {
    for (const number of [1, 2]) {
      const result = await alice.post(`/loans/${lentId}/installments/${installmentId(lentId, number)}/payments`, { id: crypto.randomUUID(), amount: '400', paidOn: today });
      assert.equal(result.status, 201, JSON.stringify(result.body));
    }
    assert.equal(sql(`select status from loans where id = '${lentId}'`), 'active', 'not completed while money is outstanding');
    await page.getByRole('button', { name: 'All loans' }).click();
    await openLoan(page, 'Tuition for Rafi');
    await page.getByRole('button', { name: 'Record payment for installment 3', exact: true }).click();
    await payDialog(page, 3).waitFor();
    await payDialog(page, 3).getByRole('button', { name: 'Record Payment' }).click();
    await payDialog(page, 3).waitFor({ state: 'detached' });
    await page.getByRole('region', { name: 'Next installment' }).getByText('Fully repaid').waitFor();
    assert.equal(sql(`select status || '|' || (completed_at is not null) from loans where id = '${lentId}'`), 'completed|true');
    assert.equal(await page.locator('.ln-detail-head .ln-badge').innerText(), 'Completed');
    await snap(page, '10-completed');
    await page.getByRole('button', { name: 'Show 1 payment for installment 3', exact: true }).click();
    await inst(page, 3).locator('.ln-payments li').first().getByRole('button', { name: 'Reverse' }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverse payment' });
    await page.locator('#ln-pay-reason').fill('Recorded too early');
    await reverse.getByRole('button', { name: 'Reverse Payment' }).click();
    await reverse.waitFor({ state: 'detached' });
    await eventually(() => sql(`select status from loans where id = '${lentId}'`), 'active', 'reversal reopens the loan');
    await page.getByRole('region', { name: 'Next installment' }).getByText('#3 of 3').waitFor();
    assert.equal((await alice.post(`/loans/${lentId}/installments/${installmentId(lentId, 3)}/payments`, { id: crypto.randomUUID(), amount: '400', paidOn: today })).status, 201);
    assert.equal(sql(`select status from loans where id = '${lentId}'`), 'completed');
    expectedFailures.push({ status: 409, path: /\/complete$/ });
    const refused = await alice.post(`/loans/${bikeId}/complete`, {});
    assert.ok(refused.status === 409 || refused.status === 400, `completing with money outstanding is refused (${refused.status})`);
    assert.equal(sql(`select status from loans where id = '${bikeId}'`), 'active');
    ok('auto-completes only when the last payment clears the balance; reversal reopens; manual completion refused while outstanding');
  }

  step('Close with an explicit settlement, then reopen');
  {
    await page.getByRole('button', { name: 'All loans' }).click();
    await openLoan(page, 'Bike loan');
    await openMenu(page);
    assert.equal(await page.getByRole('menuitem', { name: 'Mark completed' }).count(), 0, 'no “Mark completed” while money is outstanding');
    await page.getByRole('menuitem', { name: 'Close with settlement…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close with a settlement' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Close Loan' }).click();
    await page.waitForTimeout(200);
    assert.ok(await dialog.isVisible(), 'a settlement note is required');
    assert.equal(sql(`select status from loans where id = '${bikeId}'`), 'active');
    await page.locator('#ln-settle-note').fill('Bank waived the rest after early settlement');
    await dialog.getByRole('button', { name: 'Close Loan' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, 'Loan closed with a settlement note.');
    assert.equal(sql(`select status || '|' || close_note from loans where id = '${bikeId}'`), 'closed|Bank waived the rest after early settlement');
    assert.match(await page.getByRole('region', { name: 'Next installment' }).innerText(), /settled \/ written off/);
    assert.equal(sql(`select count(*) from loan_reminders where loan_id = '${bikeId}' and status = 'scheduled'`), '0', 'no reminders for a closed loan');
    await snap(page, '11-closed');
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Reopen loan' }).click();
    await toast(page, 'Loan reopened.');
    assert.equal(sql(`select status from loans where id = '${bikeId}'`), 'active');
    assert.equal(sql(`select count(*) from loan_reminders where loan_id = '${bikeId}' and status = 'scheduled'`), '1', 'reminders resume');
    ok('closing needs a note and is recorded; reopening restores the loan and its reminders');
  }

  step('Isolation and authorization');
  {
    expectedFailures.push({ status: 404, path: /^\/api\/loans\// });
    const theirs = await bob.api('/loans');
    assert.equal(theirs.status, 200);
    assert.equal(theirs.body.loans.length, 0, 'Bob sees none of Alice’s loans');
    assert.equal((await bob.api(`/loans/${bikeId}`)).status, 404);
    assert.equal((await bob.post(`/loans/${bikeId}/installments/${installmentId(bikeId, 4)}/payments`, { id: crypto.randomUUID(), amount: '1', paidOn: today })).status, 404);
    assert.equal((await bob.api(`/loans/${bikeId}`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/api/loans`)).status, 401);
    assert.equal(sql(`select has_table_privilege('anon', 'public.loans', 'select')::text || has_table_privilege('authenticated', 'public.loan_payments', 'select')::text`), 'falsefalse');
    assert.equal(sql(`select count(*) from loans where id = '${bikeId}'`), '1');
    ok('owner-only API; tables closed to client roles');
  }

  step('Backup includes loans; restore via Settings merges into another account');
  {
    const manifest = await alice.backup();
    assert.equal(manifest.format, 'persora-complete-export-v1');
    assert.equal(manifest.data.loans.length, 2);
    assert.equal(manifest.data.loanInstallments.length, 15);
    assert.equal(manifest.data.loanPayments.length, Number(sql(`select count(*) from loan_payments where user_id = '${alice.id}'`)));
    assert.ok(Array.isArray(manifest.data.loanReminders));
    const file = join(tmpdir(), `persora-export-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(manifest));
    const bobContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US', timezoneId: ZONE });
    const bobPage = await signIn(bobContext, bob.email, 'bob');
    await bobPage.locator('.topbar-avatar').click();
    await bobPage.locator('.import-row input[type="file"]').setInputFiles(file);
    await toast(bobPage, 'Loan Tracker restored: 2 loans added');
    assert.equal(sql(`select count(*) from loans where user_id = '${bob.id}'`), '2');
    assert.equal(sql(`select count(*) from loan_installments where user_id = '${bob.id}'`), '15');
    assert.equal(sql(`select count(*) from loan_payments where user_id = '${bob.id}'`), String(manifest.data.loanPayments.length));
    const same = (owner) => sql(`select string_agg(l.name || ':' || l.status || ':' || (select sum(paid_amount) from loan_installments i where i.loan_id = l.id), ',' order by l.name) from loans l where l.user_id = '${owner}'`);
    assert.equal(same(bob.id), same(alice.id), 'statuses and balances survive the round trip');
    assert.equal(sql(`select count(*) from loan_payments where user_id = '${bob.id}' and status = 'reversed' and reversal_reason is not null`), sql(`select count(*) from loan_payments where user_id = '${alice.id}' and status = 'reversed'`), 'reversals keep their reasons');
    await bobPage.locator('.import-row input[type="file"]').setInputFiles(file);
    await toast(bobPage, '2 loans already here');
    assert.equal(sql(`select count(*) from loans where user_id = '${bob.id}'`), '2', 'restoring twice adds nothing');
    await openLoansFromDrawer(bobPage);
    await bobPage.getByRole('button', { name: /^Bike loan, / }).waitFor();
    await bobContext.close();
    ok('export → Settings import → loans, installments and payment history restored, idempotent');
  }

  step('Keyboard access');
  {
    await overview(page);
    await page.getByRole('button', { name: /^Bike loan, / }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { level: 2, name: 'Bike loan', exact: true }).waitFor();
    await ready(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).focus();
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), visible: document.activeElement?.matches(':focus-visible'), outline: getComputedStyle(document.activeElement).outlineStyle }));
    assert.deepEqual(focus, { label: 'More loan actions', visible: true, outline: 'solid' }, 'Tab reaches the actions menu with a visible focus ring');
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Record payment for installment 4', exact: true }).focus();
    await page.keyboard.press('Enter');
    await payDialog(page, 4).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ln-pay-amount', 'focus moves into the payment form');
    await page.keyboard.press('Escape');
    await payDialog(page, 4).waitFor({ state: 'detached' });
    ok('rows, menu and payment dialog work from the keyboard');
  }

  step('Dark theme');
  {
    const light = await page.locator('.ln-panel').first().evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(250);
    const dark = await page.locator('.ln-panel').first().evaluate((element) => ({ bg: getComputedStyle(element).backgroundColor, fg: getComputedStyle(element.querySelector('.ln-panel-head h3')).color }));
    assert.notEqual(dark.bg, light, 'panels switch to a dark surface');
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    assert.ok(lum(dark.bg) < 80 && lum(dark.fg) > 150, `readable dark contrast (${dark.bg} / ${dark.fg})`);
    await snap(page, '12-dark-details');
    await page.getByRole('button', { name: 'Record payment for installment 4', exact: true }).click();
    await payDialog(page, 4).waitFor();
    await snap(page, '13-dark-payment');
    await payDialog(page, 4).getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    ok('dark surfaces with readable contrast');
  }

  step('Tablet and phone layouts');
  {
    for (const [label, size] of [['tablet', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }], ['small-phone', { width: 320, height: 640 }]]) {
      const context = await browser.newContext({ viewport: size, locale: 'en-US', timezoneId: ZONE, isMobile: label !== 'tablet', hasTouch: label !== 'tablet' });
      const mobile = await signIn(context, alice.email, label);
      await openLoansFromDrawer(mobile);
      await mobile.getByRole('button', { name: /^Bike loan, / }).waitFor();
      await noHorizontalOverflow(mobile, `${label} overview`);
      assert.ok(await mobile.getByRole('button', { name: 'New Loan' }).first().isVisible(), `${label}: New Loan visible`);
      await snap(mobile, `14-${label}-overview`);
      await openLoan(mobile, 'Bike loan');
      await noHorizontalOverflow(mobile, `${label} details`);
      const pay = mobile.getByRole('region', { name: 'Next installment' }).getByRole('button', { name: 'Record payment' });
      const box = await pay.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= size.width && box.height >= 32, `${label}: Record payment reachable (${JSON.stringify(box)})`);
      await snap(mobile, `15-${label}-details`);
      if (label !== 'tablet') {
        await mobile.getByRole('button', { name: 'Edit', exact: true }).click();
        const dialog = mobile.getByRole('dialog', { name: 'Edit loan' });
        await dialog.waitFor();
        const dialogBox = await dialog.boundingBox();
        assert.ok(dialogBox.width <= size.width + 1, 'editor fits the phone width');
        await snap(mobile, `16-${label}-editor`);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      }
      await context.close();
      ok(`${label}: no sideways scrolling; controls reachable`);
    }
  }

  step('Deep link ?view=loans&loan= and delete with confirmation');
  {
    await page.goto(`${base}/?view=loans&loan=${lentId}`);
    await workspaceReady(page);
    await page.getByRole('heading', { level: 2, name: 'Tuition for Rafi', exact: true }).waitFor();
    await ready(page);
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Delete loan…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete “Tuition for Rafi”?' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(sql(`select count(*) from loans where id = '${lentId}'`), '1', 'cancel keeps it');
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Delete loan…' }).click();
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast(page, '“Tuition for Rafi” deleted.');
    assert.equal(sql(`select (select count(*) from loans where id = '${lentId}') + (select count(*) from loan_installments where loan_id = '${lentId}') + (select count(*) from loan_payments where loan_id = '${lentId}')`), '0');
    assert.deepEqual(await page.locator('.ln-row-name').allInnerTexts(), ['Bike loan']);
    assert.ok(!page.url().includes('loan='), 'address bar no longer points at the deleted loan');
    // Leaving the page drops the loan link from the address bar.
    await page.locator('nav[aria-label="Workspace navigation"]').getByRole('button', { name: 'Overview', exact: true }).first().click();
    assert.ok(!page.url().includes('view=loans'), 'navigating away clears the deep link');
    ok('email deep link opens the loan; delete needs confirmation and cascades');
  }

  assert.deepEqual(consoleErrors, [], 'no console errors or failed requests');
  ok('no console errors or failed requests');
  console.log(`\nALL LOAN TRACKER E2E CHECKS PASSED — screenshots in ${shots}`);
  await desktop.close();
} finally {
  await browser.close();
  await stopAll();
}
process.exit(0);
