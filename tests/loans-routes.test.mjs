// Loan Tracker Pages API routes end to end: handleLoans → PostgREST (mocked
// fetch) → the real migration on PGlite. Covers create/preview figures, list
// and detail shapes, validation, payments and statuses, corrections, confirmed
// recalculation, settlement, two-device sync, failure handling, auth,
// reminders through the shared dispatcher/cron endpoint, backup and restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handleLoans, dispatchLoanReminders, exportLoanData, loanReminderEmail } from '../cloudflare/loans.js';
import worker from '../cloudflare/api.js';
import { addDays, localDateOf } from '../cloudflare/calendar-rules.js';

const ORIGIN = 'https://persora.example';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const ctx = await createVaultDatabase();
const { db } = ctx;

const rpcLog = [];
let failNext = null;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
  const name = url.pathname.split('/').pop();
  const args = init.body ? JSON.parse(init.body) : {};
  rpcLog.push({ name, args });
  if (failNext) { const response = failNext; failNext = null; return response(); }
  if (Array.isArray(args.p_ids)) args.p_ids = `{${args.p_ids.join(',')}}`;
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

async function member(label, zone = 'Asia/Dhaka') {
  const who = await ctx.addMember(label);
  await db.query('update public.profiles set timezone = $2, email_verified_at = now() where id = $1', [who.id, zone]);
  return { id: who.id, email: who.email, full_name: label, timezone: zone, email_verified_at: '2026-01-01T00:00:00Z', account_status: 'active' };
}
const alice = await member('loan-route-alice');
const bob = await member('loan-route-bob');
const today = localDateOf(Date.now(), 'Asia/Dhaka');

const call = async (method, path, body, who = alice, services = {}) => {
  const init = { method };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  const response = await handleLoans(new Request(`${ORIGIN}/api${path}`, init), who, env, ORIGIN, services);
  return { status: response.status, body: await response.json() };
};
// Weekly, 600 over 6 → 100 each, due today-21, -14, -7, today, +7, +14.
const loanBody = (overrides = {}) => ({
  name: 'Phone', direction: 'borrowed', partyName: 'Karim Electronics', borrowerName: 'Alice', currency: 'BDT', principal: '600',
  interestMethod: 'none', interestRate: '', installmentCount: 6, frequency: 'weekly', startDate: addDays(today, -30), firstDueDate: addDays(today, -21),
  ...overrides,
});
const payment = (amount, extra = {}) => ({ id: crypto.randomUUID(), amount, paidOn: today, ...extra });
const create = async (overrides = {}, who = alice) => {
  const result = await call('POST', '/loans', loanBody(overrides), who);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
};

test('create returns the schedule and figures; owner comes from the session; replay and isolation', async () => {
  const id = crypto.randomUUID();
  let result = await call('POST', '/loans', loanBody({ id, interestMethod: 'reducing', interestRate: '12', principal: '100000', installmentCount: 12, frequency: 'monthly', startDate: '2026-01-15', firstDueDate: '2026-01-31', user_id: bob.id, reference: 'AGR-1' }));
  assert.equal(result.status, 201);
  const detail = result.body;
  assert.equal(detail.timeZone, 'Asia/Dhaka');
  assert.equal(detail.today, today);
  assert.equal(detail.loan.id, id);
  assert.equal(detail.loan.reference, 'AGR-1');
  assert.equal(detail.installments.length, 12);
  assert.equal(detail.installments[0].amount, 8884.88);
  assert.equal(detail.installments[11].amount, 8884.85);
  assert.deepEqual(detail.installments.slice(0, 3).map((row) => row.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(detail.loan.summary.scheduled, 106618.53);
  assert.equal(detail.loan.originalTerms.totalInterest, 6618.53);
  assert.equal(detail.loan.originalTerms.principal, 100000);
  assert.equal((await db.query('select user_id from public.loans where id = $1', [id])).rows[0].user_id, alice.id, 'owner comes from the session, never the body');
  result = await call('POST', '/loans', loanBody({ id, interestMethod: 'reducing', interestRate: '12', principal: '100000', installmentCount: 12, frequency: 'monthly', startDate: '2026-01-15', firstDueDate: '2026-01-31' }));
  assert.equal(result.status, 200, 'a retried create replays');
  assert.equal((await db.query('select count(*) from public.loan_installments where loan_id = $1', [id])).rows[0].count, 12);
  assert.equal((await call('POST', '/loans', loanBody({ id }), bob)).status, 409);

  const listed = (await call('GET', '/loans')).body;
  assert.equal(listed.timeZone, 'Asia/Dhaka');
  assert.equal(listed.limits.loans, 200);
  assert.ok(listed.currencies.includes('BDT'));
  const row = listed.loans.find((entry) => entry.id === id);
  assert.equal(row.summary.installmentsTotal, 12);
  assert.equal(row.summary.next.number, 1);
  assert.equal((await call('GET', '/loans', undefined, bob)).body.loans.length, 0);
  assert.equal((await call('GET', `/loans/${id}`, undefined, bob)).status, 404);
  assert.equal((await call('DELETE', `/loans/${id}`, undefined, bob)).status, 404);
  assert.equal((await call('GET', '/loans/not-a-uuid')).status, 404);
  assert.equal((await call('DELETE', `/loans/${id}`)).status, 200);
  assert.equal((await call('GET', `/loans/${id}`)).status, 404);
});

test('validation errors return 400 with the field before touching the database', async () => {
  rpcLog.length = 0;
  for (const [overrides, field] of [[{ name: '' }, 'name'], [{ principal: '-1' }, 'principal'], [{ principal: '12.345' }, 'principal'], [{ interestMethod: 'flat', interestRate: '' }, 'interestRate'],
    [{ installmentCount: 0 }, 'installmentCount'], [{ frequency: 'fortnightly' }, 'frequency'], [{ firstDueDate: addDays(today, -31) }, 'firstDueDate'], [{ currency: 'ABC' }, 'currency']]) {
    const result = await call('POST', '/loans', loanBody(overrides));
    assert.equal(result.status, 400, JSON.stringify(overrides));
    assert.equal(result.body.field, field);
  }
  assert.equal((await call('POST', '/loans', loanBody())).status, 201);
  assert.ok(rpcLog.filter((entry) => entry.name === 'persora_loan_create').length === 1, 'only the valid request reached the database');
  const response = await handleLoans(new Request(`${ORIGIN}/api/loans`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } }), alice, env, ORIGIN, {});
  assert.equal(response.status, 415);
});

test('payments: statuses, partials, overpayment, duplicates, overdue figures and completion', async () => {
  const who = await member('loan-route-pay');
  const detail = await create({}, who);
  const id = detail.loan.id;
  assert.deepEqual(detail.installments.map((row) => row.status), ['overdue', 'overdue', 'overdue', 'due', 'upcoming', 'upcoming']);
  assert.equal(detail.loan.summary.overdueCount, 3);
  assert.equal(detail.loan.summary.overdueAmount, 300);
  assert.equal(detail.loan.summary.state, 'overdue');
  const [one, two, three, four] = detail.installments;
  const path = (inst) => `/loans/${id}/installments/${inst.id}/payments`;

  let result = await call('POST', path(one), payment(100, { method: 'Cash', reference: 'R-1', notes: 'On time', paidOn: one.dueDate }), who);
  assert.equal(result.status, 201);
  assert.equal(result.body.installments[0].status, 'paid');
  assert.equal(result.body.payments[0].method, 'Cash');
  // Partial on a past-due installment: still overdue, never "paid".
  result = await call('POST', path(two), payment(40), who);
  assert.equal(result.body.installments[1].status, 'overdue');
  assert.equal(result.body.installments[1].remaining, 60);
  // Partial on the installment due today.
  const dup = payment('25.50');
  result = await call('POST', path(four), dup, who);
  assert.equal(result.body.installments[3].status, 'partial');
  assert.equal((await call('POST', path(four), dup, who)).status, 200, 'a retried payment replays');
  result = await call('POST', path(four), payment('25.50'), who);
  assert.equal(result.body.installments[3].paid, 51, 'multiple partials add up');
  assert.equal(result.body.installments[3].paymentCount, 2);
  result = await call('POST', path(four), payment(49.01), who);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /49\.00 remaining/);
  for (const [body, field] of [[payment(0), 'amount'], [payment(-3), 'amount'], [payment(1, { paidOn: addDays(today, 1) }), 'paidOn'], [payment('1.001'), 'amount']]) {
    result = await call('POST', path(four), body, who);
    assert.equal(result.status, 400);
    assert.equal(result.body.field, field);
  }
  assert.equal((await call('POST', path(four), { amount: 1, paidOn: today }, who)).status, 400, 'a payment id is required');
  assert.equal((await call('POST', path(four), payment(1), bob)).status, 404);
  result = await call('GET', `/loans/${id}`, undefined, who);
  assert.equal(result.body.loan.summary.paid, 191);
  assert.equal(result.body.loan.summary.outstanding, 409);
  assert.equal(result.body.loan.summary.overdueCount, 2);
  assert.equal(result.body.loan.summary.overdueAmount, 160);
  assert.equal(result.body.loan.summary.next.number, 2);
  assert.equal(result.body.loan.summary.paidCount, 1);
  assert.equal(result.body.payments.length, 4);
  // Completion: refused while money is due, automatic when the last cent is paid.
  result = await call('POST', `/loans/${id}/complete`, {}, who);
  assert.equal(result.status, 409);
  assert.match(result.body.error, /409\.00 outstanding/);
  for (const inst of result.body.installments ?? (await call('GET', `/loans/${id}`, undefined, who)).body.installments) {
    if (inst.remaining > 0) await call('POST', path(inst), payment(inst.remaining), who);
  }
  result = await call('GET', `/loans/${id}`, undefined, who);
  assert.equal(result.body.loan.status, 'completed');
  assert.equal(result.body.loan.summary.state, 'completed');
  assert.equal(result.body.loan.summary.next, null);
  assert.equal(result.body.loan.summary.progress, 1);
  const listed = (await call('GET', '/loans', undefined, who)).body.loans[0];
  assert.equal(listed.summary.state, 'completed');
  assert.equal(listed.summary.outstanding, 0);
  assert.equal((await call('POST', path(three), payment(1), who)).status, 409);
});

test('corrections and reversals keep history; the loan reopens when money is due again', async () => {
  const detail = await create({ principal: '200', installmentCount: 2, firstDueDate: addDays(today, -7), startDate: addDays(today, -10) });
  const id = detail.loan.id;
  const [one, two] = detail.installments;
  const first = payment(100);
  await call('POST', `/loans/${id}/installments/${one.id}/payments`, first);
  await call('POST', `/loans/${id}/installments/${two.id}/payments`, payment(100));
  let result = await call('POST', `/loans/${id}/payments/${first.id}/reverse`, {});
  assert.equal(result.status, 400);
  assert.equal(result.body.field, 'reason');
  result = await call('POST', `/loans/${id}/payments/${first.id}/correct`, { reason: 'Was 80', id: crypto.randomUUID(), amount: 80, paidOn: today, method: 'bKash' });
  assert.equal(result.status, 200);
  assert.equal(result.body.loan.status, 'active');
  assert.equal(result.body.installments[0].paid, 80);
  assert.equal(result.body.installments[0].status, 'overdue');
  assert.equal(result.body.payments.length, 3);
  const reversed = result.body.payments.find((p) => p.id === first.id);
  assert.equal(reversed.status, 'reversed');
  assert.equal(reversed.reversalReason, 'Was 80');
  assert.equal(result.body.payments.find((p) => p.correctsPaymentId === first.id).amount, 80);
  result = await call('POST', `/loans/${id}/payments/${first.id}/reverse`, { reason: 'Again' });
  assert.equal(result.status, 200, 'reversing twice is a no-op, not a second deduction');
  assert.equal(result.body.installments[0].paid, 80);
  assert.equal((await call('POST', `/loans/${id}/payments/${crypto.randomUUID()}/reverse`, { reason: 'x' })).status, 404);
});

test('schedule edits need confirmation (428) and keep locked installments; plain edits save directly', async () => {
  const detail = await create({ name: 'Laptop' });
  const id = detail.loan.id;
  await call('POST', `/loans/${id}/installments/${detail.installments[0].id}/payments`, payment(100));
  await call('POST', `/loans/${id}/installments/${detail.installments[4].id}/payments`, payment(10));
  let result = await call('PATCH', `/loans/${id}`, loanBody({ name: 'Laptop (work)', notes: 'Shop receipt in Documents', revision: 3 }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.loan.name, 'Laptop (work)');
  assert.equal(result.body.loan.revision, 4);
  assert.equal((await call('PATCH', `/loans/${id}`, loanBody({ name: 'Stale', revision: 3 }))).status, 409, 'stale revisions are rejected');
  result = await call('PATCH', `/loans/${id}`, loanBody({ name: 'Laptop (work)', principal: '700', installmentCount: 7, revision: 4 }));
  assert.equal(result.status, 428);
  assert.equal(result.body.requiresConfirmation, true);
  assert.equal((await call('GET', `/loans/${id}`)).body.installments.length, 6, 'nothing changed without confirmation');
  const before = (await call('GET', `/loans/${id}`)).body.installments.slice(0, 5);
  result = await call('PATCH', `/loans/${id}`, loanBody({ name: 'Laptop (work)', principal: '700', installmentCount: 7, revision: 4, recalculate: true, nextDueDate: addDays(today, 10) }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = result.body.installments;
  assert.equal(after.length, 7);
  // Installments 1-4 are due/past, 5 has a payment → 1-5 kept exactly; 6-7 rebuilt from the new next date.
  assert.deepEqual(after.slice(0, 5).map(({ status, ...row }) => row), before.map(({ status, ...row }) => row));
  assert.deepEqual(after.slice(5).map((row) => row.dueDate), [addDays(today, 10), addDays(today, 17)]);
  assert.equal(after.slice(5).reduce((sum, row) => sum + row.principal, 0), 700 - 500);
  assert.equal(result.body.loan.scheduleChanges.length, 1);
  assert.equal(result.body.loan.scheduleChanges[0].lockedCount, 5);
  assert.equal(result.body.loan.originalTerms.principal, 600, 'original terms stay distinct');
  assert.equal(result.body.loan.principal, 700);
  result = await call('PATCH', `/loans/${id}`, loanBody({ name: 'Laptop (work)', principal: '700', installmentCount: 4, revision: 5, recalculate: true }));
  assert.equal(result.status, 400);
  assert.equal(result.body.field, 'installmentCount');
});

test('closing needs a settlement note; closed loans show the written-off balance and can be reopened', async () => {
  const detail = await create({ name: 'Loan to Sami', direction: 'lent', borrowerName: 'Sami', partyName: 'Sami' });
  const id = detail.loan.id;
  await call('POST', `/loans/${id}/installments/${detail.installments[0].id}/payments`, payment(100));
  let result = await call('POST', `/loans/${id}/close`, { note: ' ' });
  assert.equal(result.status, 400);
  assert.equal(result.body.field, 'note');
  result = await call('POST', `/loans/${id}/close`, { note: 'Settled for 100; rest forgiven' });
  assert.equal(result.status, 200);
  assert.equal(result.body.loan.status, 'closed');
  assert.equal(result.body.loan.summary.writtenOff, 500);
  assert.equal(result.body.loan.summary.overdueCount, 0);
  assert.ok(result.body.installments.slice(1).every((row) => row.paid === 0), 'closing never marks installments paid');
  const listed = (await call('GET', '/loans')).body.loans.find((row) => row.id === id);
  assert.equal(listed.summary.state, 'closed');
  assert.equal(listed.summary.writtenOff, 500);
  assert.equal((await call('POST', `/loans/${id}/installments/${detail.installments[1].id}/payments`, payment(1))).status, 409);
  result = await call('POST', `/loans/${id}/reopen`, {});
  assert.equal(result.body.loan.status, 'active');
  assert.equal(result.body.loan.closeNote, null);
});

test('two devices stay consistent: shared state, stale edits refused, retried payments recorded once', async () => {
  const who = await member('loan-route-sync');
  const phone = { ...who };
  const laptop = { ...who };
  const detail = await create({ name: 'Shared' }, laptop);
  const id = detail.loan.id;
  assert.ok((await call('GET', '/loans', undefined, phone)).body.loans.some((row) => row.id === id), 'the other device sees the new loan');
  const p = payment(100);
  await call('POST', `/loans/${id}/installments/${detail.installments[0].id}/payments`, p, phone);
  // The laptop's queued retry of the same payment (same id) doesn't double-count.
  assert.equal((await call('POST', `/loans/${id}/installments/${detail.installments[0].id}/payments`, p, laptop)).status, 200);
  const seen = (await call('GET', `/loans/${id}`, undefined, laptop)).body;
  assert.equal(seen.payments.length, 1);
  assert.equal(seen.loan.summary.paid, 100);
  // The laptop still holds revision 1: its edit is refused, not silently merged.
  assert.equal((await call('PATCH', `/loans/${id}`, loanBody({ name: 'Shared (laptop)', revision: 1 }), laptop)).status, 409);
  assert.equal((await call('PATCH', `/loans/${id}`, loanBody({ name: 'Shared (laptop)', revision: seen.loan.revision }), laptop)).status, 200);
  assert.equal((await call('GET', `/loans/${id}`, undefined, phone)).body.loan.name, 'Shared (laptop)');
});

test('database failures never report success; a missing migration is explained', async () => {
  const detail = await create({ name: 'Flaky' });
  failNext = () => new Response('upstream down', { status: 503 });
  const result = await call('POST', `/loans/${detail.loan.id}/installments/${detail.installments[0].id}/payments`, payment(100));
  assert.equal(result.status, 502);
  assert.ok(result.body.error);
  assert.equal((await call('GET', `/loans/${detail.loan.id}`)).body.payments.length, 0);
  failNext = () => Response.json({ code: 'PGRST202', message: 'missing' }, { status: 404 });
  assert.equal((await call('GET', '/loans')).status, 503);
  failNext = () => Response.json({ code: 'PGRST202', message: 'missing' }, { status: 404 });
  assert.deepEqual(await exportLoanData(alice.id, env), { loans: [], installments: [], payments: [], reminders: [] }, 'account export still works before the migration');
});

test('anonymous requests are rejected by the worker before any loan query', async () => {
  rpcLog.length = 0;
  for (const [method, path] of [['GET', '/api/loans'], ['POST', '/api/loans'], ['GET', `/api/loans/${crypto.randomUUID()}`], ['POST', `/api/loans/${crypto.randomUUID()}/installments/${crypto.randomUUID()}/payments`], ['POST', '/api/loans/import'], ['GET', '/api/loans/reminders']]) {
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env, { waitUntil() {} });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  assert.ok(!rpcLog.some((entry) => entry.name.startsWith('persora_loan')));
});

test('reminders go through the shared dispatcher once, skip paid installments and never mark anything paid', async () => {
  const who = await member('loan-route-remind');
  const sent = [];
  const services = { emailConfigured: () => true, sendEmail: async (message) => { sent.push(message); } };
  const detail = (await call('POST', '/loans', loanBody({ name: 'Rent advance', startDate: today, firstDueDate: addDays(today, 2), reminderDaysBefore: 1, overdueAlerts: true, reminderEmail: true }), who, services)).body;
  assert.equal(detail.email.available, true);
  const id = detail.loan.id;
  await db.query("update public.loan_reminders set remind_at = now() - interval '1 minute' where loan_id = $1 and status = 'scheduled'", [id]);
  let bell = (await call('GET', '/loans/reminders', undefined, who, services)).body;
  assert.equal(bell.reminders.length, 1);
  assert.equal(bell.reminders[0].kind, 'upcoming');
  assert.equal(bell.reminders[0].loanName, 'Rent advance');
  assert.equal(bell.reminders[0].installmentNumber, 1);
  assert.equal(bell.reminders[0].amount, 100);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, who.email);
  assert.match(sent[0].subject, /Due soon: Rent advance installment 1/);
  assert.match(sent[0].textContent, /never mark an installment as paid/);
  assert.match(sent[0].textContent, /\?view=loans&loan=/);
  bell = (await call('GET', '/loans/reminders', undefined, who, services)).body;
  assert.equal(bell.reminders.length, 1);
  assert.equal((await dispatchLoanReminders(env, services, { limit: 50 })).claimed, 0);
  assert.equal(sent.length, 1, 'no duplicate notification');
  const after = (await call('GET', `/loans/${id}`, undefined, who)).body;
  assert.equal(after.loan.summary.paid, 0, 'reminders never record payments');
  assert.equal(after.installments[0].status, 'due', 'due in 2 days (weekly due window), not paid');
  // The next alert (overdue for #1) is planned; if #1 gets paid between planning and delivery it is skipped.
  const next = (await db.query("select * from public.loan_reminders where loan_id = $1 and status = 'scheduled'", [id])).rows[0];
  assert.equal(next.kind, 'overdue');
  await db.query("update public.loan_reminders set remind_at = now() - interval '1 minute' where id = $1", [next.id]);
  await db.query('update public.loan_installments set paid_amount = amount where id = $1', [next.installment_id]);
  const summary = await dispatchLoanReminders(env, services, { owner: who.id });
  assert.deepEqual({ claimed: summary.claimed, delivered: summary.delivered, skipped: summary.skipped }, { claimed: 1, delivered: 0, skipped: 1 });
  assert.equal(sent.length, 1);
  // Mark read is owner-scoped.
  assert.equal((await call('PATCH', `/loans/reminders/${bell.reminders[0].id}`, {}, bob)).status, 200);
  assert.equal((await db.query('select read_at from public.loan_reminders where id = $1', [bell.reminders[0].id])).rows[0].read_at, null);
  await call('PATCH', '/loans/reminders', {}, who);
  assert.ok((await db.query('select read_at from public.loan_reminders where id = $1', [bell.reminders[0].id])).rows[0].read_at);
  // The existing cron endpoint delivers loan reminders too.
  await db.query("update public.loan_reminders set remind_at = now() - interval '1 minute' where loan_id = $1 and status = 'scheduled'", [id]);
  const cron = await worker.fetch(new Request(`${ORIGIN}/api/internal/calendar-reminders`, { method: 'POST', headers: { 'x-persora-cron-token': 'cron-secret' } }), { ...env, CALENDAR_REMINDER_TOKEN: 'cron-secret' }, { waitUntil() {} });
  assert.equal(cron.status, 200);
  const cronBody = await cron.json();
  assert.equal(cronBody.loans.claimed, 1);
  assert.equal(cronBody.loans.delivered, 1);
  const email = loanReminderEmail({ kind: 'overdue' }, { id, name: '<b>Car</b>', direction: 'lent', borrowerName: 'Sami', partyName: 'Sami', currency: 'BDT' }, { number: 2, dueDate: '2026-10-20', amountCents: 50000, paidCents: 10000 }, { email: 'a@b.c' }, 'https://x/?view=loans');
  assert.match(email.htmlContent, /&lt;b&gt;Car&lt;\/b&gt;/);
  assert.match(email.textContent, /Repayment from Sami/);
  assert.match(email.subject, /^Overdue: /);
});

test('backup: export → restore into another account through /loans/import; re-import never duplicates', async () => {
  const source = await member('loan-route-backup');
  const detail = await create({ name: 'Wedding loan', interestMethod: 'flat', interestRate: '5' }, source);
  const id = detail.loan.id;
  const wrong = payment(50);
  await call('POST', `/loans/${id}/installments/${detail.installments[0].id}/payments`, wrong, source);
  await call('POST', `/loans/${id}/payments/${wrong.id}/correct`, { reason: 'Typo', id: crypto.randomUUID(), amount: 40, paidOn: today }, source);
  const exported = await exportLoanData(source.id, env);
  assert.equal(exported.loans.length, 1);
  assert.equal(exported.installments.length, 6);
  assert.equal(exported.payments.length, 2);
  const backup = JSON.parse(JSON.stringify({ loans: exported.loans, installments: exported.installments, payments: exported.payments }));
  const target = await member('loan-route-restore', 'America/New_York');
  let result = await call('POST', '/loans/import', backup, target);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, loansCreated: 1, loansMatched: 0, loansSkipped: 0, installmentsAdded: 6, paymentsAdded: 2 });
  const restored = (await call('GET', '/loans', undefined, target)).body.loans;
  assert.equal(restored.length, 1);
  assert.notEqual(restored[0].id, id);
  assert.equal(restored[0].summary.paid, 40);
  const restoredDetail = (await call('GET', `/loans/${restored[0].id}`, undefined, target)).body;
  assert.equal(restoredDetail.payments.length, 2);
  assert.equal(restoredDetail.timeZone, 'America/New_York');
  // The restored loan is fully usable (remapped md5 ids pass the route guards).
  // The date is "today" in the restored loan's own time zone — the suite's shared
  // `today` (Asia/Dhaka) can already be tomorrow in America/New_York near midnight.
  assert.equal((await call('POST', `/loans/${restored[0].id}/installments/${restoredDetail.installments[0].id}/payments`, payment(1, { paidOn: localDateOf(Date.now(), 'America/New_York') }), target)).status, 201);
  result = await call('POST', '/loans/import', backup, target);
  assert.deepEqual(result.body, { ok: true, loansCreated: 0, loansMatched: 1, loansSkipped: 0, installmentsAdded: 0, paymentsAdded: 0 });
  // A tampered loan is skipped whole; non-backup bodies are refused.
  const tampered = JSON.parse(JSON.stringify(backup));
  tampered.loans[0].id = crypto.randomUUID();
  tampered.installments.forEach((row) => { row.loan_id = tampered.loans[0].id; });
  tampered.installments[0].amount = 1;
  result = await call('POST', '/loans/import', tampered, target);
  assert.equal(result.body.loansSkipped, 1);
  assert.equal(result.body.loansCreated, 0);
  assert.equal((await call('POST', '/loans/import', { habits: [] }, target)).status, 400);
});
