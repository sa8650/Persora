// Loan Tracker migration on PGlite (schema.sql + every migration, in order):
// privileges/RLS/indexes, owner isolation, idempotent creates and payments,
// partial/multiple/full payments, overpayment and date guards, completion,
// reversal/correction history, recalculation that never rewrites locked
// installments, settlement, reminders (planning, DST, claims, dedupe, ping),
// document links, cascades and backup/restore across accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { fromCents, normalizeLoanInput, planRecalculation, previewLoan } from '../cloudflare/loan-rules.js';
import { localDateOf, addDays } from '../cloudflare/calendar-rules.js';
import { decimal, importEntryFor, loanFromRow } from '../cloudflare/loans.js';

const ctx = await createVaultDatabase();
const { db, rpc, addMember } = ctx;
const alice = await addMember('loan-alice');
const bob = await addMember('loan-bob');

const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; });
};
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].count);
const form = (overrides = {}) => ({
  name: 'Bike loan', direction: 'borrowed', partyName: 'Rahim', borrowerName: 'Alice', currency: 'BDT', principal: '1200',
  interestMethod: 'none', interestRate: '', installmentCount: 6, frequency: 'monthly', startDate: '2026-01-01', firstDueDate: '2026-02-01',
  ...overrides,
});
/** Same payload the Pages API sends (cloudflare/loans.js createLoan). */
function payload(overrides = {}) {
  const n = normalizeLoanInput(form(overrides));
  const s = previewLoan(n);
  return {
    values: {
      name: n.name, direction: n.direction, party_name: n.partyName, borrower_name: n.borrowerName, currency: n.currency, principal: decimal(n.principalCents),
      interest_method: n.interestMethod, interest_rate: n.interestRate === null ? null : String(n.interestRate), installment_count: n.installmentCount,
      frequency: n.frequency, start_date: n.startDate, first_due_date: n.firstDueDate, reference: n.reference, notes: n.notes, document_ids: n.documentIds,
      reminder_days_before: n.reminderDaysBefore, overdue_alerts: n.overdueAlerts, reminder_email: n.reminderEmail,
      original_terms: { principal: fromCents(n.principalCents), totalRepayment: fromCents(s.totalCents), installmentCount: n.installmentCount },
    },
    installments: s.installments.map((row) => ({ number: row.number, due_date: row.dueDate, principal: decimal(row.principalCents), interest: decimal(row.interestCents), amount: decimal(row.amountCents) })),
    normalized: n,
  };
}
async function create(owner, overrides = {}, id = crypto.randomUUID()) {
  const p = payload(overrides);
  const result = await rpc('persora_loan_create', { p_owner: owner.id, p_id: id, p_loan: p.values, p_installments: p.installments });
  return { id, result, ...p };
}
const detail = (owner, id) => rpc('persora_loan_get', { p_owner: owner.id, p_id: id });
const pay = (owner, loan, installment, amount, paidOn, today = '2026-10-24', id = crypto.randomUUID(), extra = {}) =>
  rpc('persora_loan_pay', { p_owner: owner.id, p_loan: loan, p_installment: installment, p_payment: { id, amount, paid_on: paidOn, method: '', reference: '', notes: '', ...extra }, p_today: today });

test('tables are closed to anon/authenticated; internal helpers are closed even to service_role', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of ['loans', 'loan_installments', 'loan_payments', 'loan_reminders']) await rejects(db.query(`select * from public.${table}`), '42501');
      await rejects(db.query(`select public.persora_loans_list('${alice.id}', '2026-10-24')`), '42501');
      await rejects(db.query(`select public.persora_loans_export('${alice.id}')`), '42501');
      await rejects(db.query('select public.persora_loan_claim_reminders(5, null)'), '42501');
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try {
    await rejects(db.query(`select public.persora_loan_plan_reminder('${alice.id}', now())`), '42501');
    await rejects(db.query(`select public.persora_loan_sync_status('${alice.id}')`), '42501');
    await rejects(db.query(`select public.persora_loan_check_documents('${alice.id}', '{}', '{}')`), '42501');
  } finally { await db.exec('reset role'); }
  const rls = await db.query("select relname, relrowsecurity from pg_class where relname in ('loans', 'loan_installments', 'loan_payments', 'loan_reminders')");
  assert.equal(rls.rows.length, 4);
  assert.ok(rls.rows.every((row) => row.relrowsecurity));
  const indexes = (await db.query("select indexname from pg_indexes where tablename like 'loan%'")).rows.map((row) => row.indexname);
  for (const name of ['loans_owner_idx', 'loan_installments_number_unique', 'loan_installments_due_idx', 'loan_payments_installment_idx', 'loan_payments_loan_idx', 'loan_reminders_one_scheduled', 'loan_reminders_due_idx']) {
    assert.ok(indexes.includes(name), `${name} exists`);
  }
});

test('create is idempotent, validates the schedule, and is isolated per owner', async () => {
  const { id, result, installments } = await create(alice);
  assert.deepEqual(result, { replayed: false });
  assert.deepEqual(await rpc('persora_loan_create', { p_owner: alice.id, p_id: id, p_loan: payload().values, p_installments: installments }), { replayed: true });
  assert.equal(await count('select count(*) from public.loans where id = $1', [id]), 1, 'a retried create never duplicates');
  await rejects(rpc('persora_loan_create', { p_owner: bob.id, p_id: id, p_loan: payload().values, p_installments: installments }), 'P0409');
  const d = await detail(alice, id);
  assert.equal(d.installments.length, 6);
  assert.deepEqual(d.installments.map((row) => row.amount), [200, 200, 200, 200, 200, 200]);
  assert.equal(d.loan.status, 'active');
  // Gaps or a short schedule are refused.
  await rejects(rpc('persora_loan_create', { p_owner: alice.id, p_id: crypto.randomUUID(), p_loan: payload().values, p_installments: installments.slice(1) }), 'P0400');
  // Table constraints back up the API.
  const bad = payload();
  await rejects(rpc('persora_loan_create', { p_owner: alice.id, p_id: crypto.randomUUID(), p_loan: { ...bad.values, interest_rate: '5' }, p_installments: bad.installments }), '23514');
  await rejects(rpc('persora_loan_create', { p_owner: alice.id, p_id: crypto.randomUUID(), p_loan: { ...bad.values, first_due_date: '2025-12-01' }, p_installments: bad.installments }), '23514');
  // Bob can't read, pay, change, close or delete Alice's loan.
  await rejects(detail(bob, id), 'P0404');
  await rejects(pay(bob, id, d.installments[0].id, '10.00', '2026-10-01'), 'P0404');
  await rejects(rpc('persora_loan_update', { p_owner: bob.id, p_id: id, p_expected_revision: 1, p_loan: payload().values, p_recalc: null, p_today: '2026-10-24' }), 'P0404');
  await rejects(rpc('persora_loan_set_status', { p_owner: bob.id, p_id: id, p_action: 'close', p_note: 'mine' }), 'P0404');
  await rejects(rpc('persora_loan_delete', { p_owner: bob.id, p_id: id }), 'P0404');
  assert.equal((await rpc('persora_loans_list', { p_owner: bob.id, p_today: '2026-10-24' })).length, 0);
  // Even with Bob's own loan id, Alice's installment can't be paid through it.
  const bobLoan = await create(bob);
  await rejects(pay(bob, bobLoan.id, d.installments[0].id, '10.00', '2026-10-01'), 'P0404');
  await rpc('persora_loan_delete', { p_owner: bob.id, p_id: bobLoan.id });
  await rpc('persora_loan_delete', { p_owner: alice.id, p_id: id });
});

test('payments: partial, multiple partials, full, overpayment, dates, duplicates and automatic completion', async () => {
  const { id } = await create(alice, { principal: '1000', installmentCount: 2 });
  let d = await detail(alice, id);
  const [first, second] = d.installments;
  const p1 = crypto.randomUUID();
  assert.deepEqual(await pay(alice, id, first.id, '200.00', '2026-02-01', '2026-10-24', p1), { replayed: false, status: 'active' });
  assert.deepEqual(await pay(alice, id, first.id, '200.00', '2026-02-01', '2026-10-24', p1), { replayed: true, status: 'active' }, 'a retried payment is not recorded twice');
  await rejects(pay(alice, id, first.id, '250.00', '2026-02-01', '2026-10-24', p1), 'P0409');
  await pay(alice, id, first.id, '100.50', '2026-02-03');
  d = await detail(alice, id);
  assert.equal(d.installments[0].paid_amount, 300.5, 'partials add up');
  assert.equal(d.payments.length, 2);
  await assert.rejects(pay(alice, id, first.id, '200.00', '2026-02-05'), /199\.50 remaining/, 'no overpayment');
  await rejects(pay(alice, id, first.id, '0', '2026-02-05'), 'P0400');
  await rejects(pay(alice, id, first.id, '-5', '2026-02-05'), 'P0400');
  await rejects(pay(alice, id, first.id, '10.00', '2026-10-25'), 'P0400');
  await rejects(pay(alice, id, first.id, '10.00', '2025-12-31'), 'P0400');
  await rejects(db.query('update public.loan_installments set paid_amount = amount + 1 where id = $1', [first.id]), '23514');
  await pay(alice, id, first.id, '199.50', '2026-02-05');
  assert.equal((await detail(alice, id)).loan.status, 'active', 'still active while an installment is unpaid');
  assert.deepEqual((await pay(alice, id, second.id, '500.00', '2026-03-01')).status, 'completed', 'completed once nothing is outstanding');
  d = await detail(alice, id);
  assert.ok(d.loan.completed_at);
  await rejects(pay(alice, id, second.id, '1.00', '2026-03-02'), 'P0409');
  const list = await rpc('persora_loans_list', { p_owner: alice.id, p_today: '2026-10-24' });
  const row = list.find((entry) => entry.id === id);
  assert.equal(row.paid_total, 1000);
  assert.equal(row.paid_count, 2);
  assert.equal(row.next_installment, null);
});

test('reversals and corrections keep the history and keep balances and status consistent', async () => {
  const { id } = await create(alice, { principal: '600', installmentCount: 2 });
  const [first, second] = (await detail(alice, id)).installments;
  const original = crypto.randomUUID();
  await pay(alice, id, first.id, '300.00', '2026-02-01', '2026-10-24', original);
  await pay(alice, id, second.id, '300.00', '2026-03-01');
  assert.equal((await detail(alice, id)).loan.status, 'completed');
  await rejects(rpc('persora_loan_reverse_payment', { p_owner: alice.id, p_loan: id, p_payment: original, p_reason: ' ', p_correction: null, p_today: '2026-10-24' }), 'P0400');
  await rejects(rpc('persora_loan_reverse_payment', { p_owner: bob.id, p_loan: id, p_payment: original, p_reason: 'x', p_correction: null, p_today: '2026-10-24' }), 'P0404');
  // Correct: the 300 was really 250 — reversed (kept) and a new linked payment recorded atomically.
  const corrected = crypto.randomUUID();
  const correction = { id: corrected, amount: '250.00', paid_on: '2026-02-01', method: 'Cash', reference: '', notes: '' };
  const result = await rpc('persora_loan_reverse_payment', { p_owner: alice.id, p_loan: id, p_payment: original, p_reason: 'Typed the wrong amount', p_correction: correction, p_today: '2026-10-24' });
  assert.deepEqual(result, { replayed: false, status: 'active' }, 'money is due again, so the loan is active again');
  assert.deepEqual(await rpc('persora_loan_reverse_payment', { p_owner: alice.id, p_loan: id, p_payment: original, p_reason: 'Typed the wrong amount', p_correction: correction, p_today: '2026-10-24' }), { replayed: true, status: 'active' });
  let d = await detail(alice, id);
  assert.equal(d.payments.length, 3, 'nothing is deleted');
  const old = d.payments.find((p) => p.id === original);
  assert.equal(old.status, 'reversed');
  assert.equal(old.reversal_reason, 'Typed the wrong amount');
  assert.ok(old.reversed_at);
  assert.equal(d.payments.find((p) => p.id === corrected).corrects_payment_id, original);
  assert.equal(d.installments[0].paid_amount, 250);
  // A correction can't overpay either: it would fail and roll back the reversal too.
  const p2 = d.payments.find((p) => p.installment_id === second.id).id;
  await assert.rejects(rpc('persora_loan_reverse_payment', { p_owner: alice.id, p_loan: id, p_payment: p2, p_reason: 'More', p_correction: { id: crypto.randomUUID(), amount: '300.01', paid_on: '2026-03-01' }, p_today: '2026-10-24' }), /300\.00 remaining/);
  d = await detail(alice, id);
  assert.equal(d.payments.find((p) => p.id === p2).status, 'recorded', 'the failed correction left the payment untouched');
  await rejects(rpc('persora_loan_reverse_payment', { p_owner: alice.id, p_loan: id, p_payment: original, p_reason: 'again', p_correction: { id: crypto.randomUUID(), amount: '1.00', paid_on: '2026-02-01' }, p_today: '2026-10-24' }), 'P0409');
  // Plain reversal.
  await rpc('persora_loan_reverse_payment', { p_owner: alice.id, p_loan: id, p_payment: corrected, p_reason: 'Bounced', p_correction: null, p_today: '2026-10-24' });
  d = await detail(alice, id);
  assert.equal(d.installments[0].paid_amount, 0);
  assert.equal(d.installments[0].payment_count, 2);
  assert.equal(d.payments.length, 3, 'reversed payments stay in the history');
});

test('schedule changes need confirmation and never rewrite locked installments', async () => {
  const { id, normalized } = await create(alice, { principal: '1200', installmentCount: 6, interestMethod: 'flat', interestRate: '10' });
  let d = await detail(alice, id);
  const today = '2026-04-15'; // installments 1-3 (Feb 1, Mar 1, Apr 1) are past due
  await pay(alice, id, d.installments[0].id, decimal(Math.round(d.installments[0].amount * 100)), '2026-02-01', today);
  await pay(alice, id, d.installments[1].id, '50.00', '2026-03-02', today);
  d = await detail(alice, id);
  const revision = d.loan.revision;
  const edited = normalizeLoanInput(form({ principal: '1500', installmentCount: 8, interestMethod: 'flat', interestRate: '10', name: 'Bike loan (topped up)' }));
  const values = { ...payload().values, name: edited.name, principal: '1500.00', installment_count: 8, interest_method: 'flat', interest_rate: '10' };
  delete values.original_terms;
  await rejects(rpc('persora_loan_update', { p_owner: alice.id, p_id: id, p_expected_revision: revision - 1, p_loan: values, p_recalc: null, p_today: today }), 'P0409');
  await rejects(rpc('persora_loan_update', { p_owner: alice.id, p_id: id, p_expected_revision: revision, p_loan: values, p_recalc: null, p_today: today }), 'P0428');
  const loan = loanFromRow(d.loan);
  const terms = { principalCents: Math.round(loan.principal * 100), interestMethod: loan.interestMethod, interestRate: loan.interestRate, installmentCount: loan.installmentCount, frequency: loan.frequency, firstDueDate: loan.firstDueDate, anchorDate: loan.anchorDate, anchorNumber: loan.anchorNumber };
  const rows = d.installments.map((row) => ({ number: row.number, dueDate: row.due_date, principalCents: Math.round(row.principal_amount * 100), interestCents: Math.round(row.interest_amount * 100), amountCents: Math.round(row.amount * 100), paidCents: Math.round(row.paid_amount * 100), paymentCount: row.payment_count }));
  const plan = planRecalculation(terms, rows, edited, { today });
  assert.equal(plan.lockedCount, 3);
  const recalc = (locked) => ({
    locked_count: locked, anchor_date: plan.anchorDate, anchor_number: plan.anchorNumber,
    installments: plan.future.map((row) => ({ number: row.number, due_date: row.dueDate, principal: decimal(row.principalCents), interest: decimal(row.interestCents), amount: decimal(row.amountCents) })),
    change: { at: '2026-04-15T00:00:00Z', lockedCount: locked },
  });
  // A stale preview (fewer locked rows than now) is refused.
  await rejects(rpc('persora_loan_update', { p_owner: alice.id, p_id: id, p_expected_revision: revision, p_loan: values, p_recalc: recalc(2), p_today: today }), 'P0409');
  const before = d.installments.slice(0, 3);
  await rpc('persora_loan_update', { p_owner: alice.id, p_id: id, p_expected_revision: revision, p_loan: values, p_recalc: recalc(3), p_today: today });
  d = await detail(alice, id);
  assert.equal(d.installments.length, 8);
  assert.deepEqual(d.installments.slice(0, 3).map(({ updated_at, payment_count, ...row }) => row), before.map(({ updated_at, payment_count, ...row }) => row), 'locked installments are untouched');
  assert.ok(d.installments.slice(3).every((row) => row.schedule_version === 2));
  assert.equal(d.loan.schedule_version, 2);
  assert.equal(d.loan.revision, revision + 1);
  assert.equal(d.loan.schedule_changes.length, 1);
  assert.equal(d.loan.original_terms.principal, normalized.principalCents / 100, 'original terms are kept');
  assert.equal(d.payments.length, 2, 'payment history is untouched');
  const total = d.installments.reduce((sum, row) => sum + Math.round(row.principal_amount * 100), 0);
  assert.equal(total, 150000, 'principal across kept + rebuilt installments equals the new principal');
  // A non-schedule edit needs no recalculation.
  await rpc('persora_loan_update', { p_owner: alice.id, p_id: id, p_expected_revision: revision + 1, p_loan: { ...values, notes: 'Agreed at the shop' }, p_recalc: null, p_today: today });
  assert.equal((await detail(alice, id)).loan.notes, 'Agreed at the shop');
});

test('completion needs zero outstanding; closing needs a settlement note; reopen restores the balance', async () => {
  const { id } = await create(alice, { principal: '100', installmentCount: 2 });
  const [first] = (await detail(alice, id)).installments;
  await pay(alice, id, first.id, '50.00', '2026-02-01');
  await assert.rejects(rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'complete', p_note: null }), /50\.00 outstanding/);
  await rejects(rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'close', p_note: '  ' }), 'P0400');
  await rejects(rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'reopen', p_note: null }), 'P0409');
  assert.deepEqual(await rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'close', p_note: 'Forgave the rest' }), { status: 'closed' });
  let d = await detail(alice, id);
  assert.equal(d.loan.close_note, 'Forgave the rest');
  assert.equal(d.installments[1].paid_amount, 0, 'closing never marks installments paid');
  await rejects(pay(alice, id, d.installments[1].id, '50.00', '2026-03-01'), 'P0409');
  const list = await rpc('persora_loans_list', { p_owner: alice.id, p_today: '2026-10-24' });
  assert.equal(list.find((row) => row.id === id).paid_total, 50);
  assert.deepEqual(await rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'reopen', p_note: null }), { status: 'active' });
  d = await detail(alice, id);
  assert.equal(d.loan.close_note, null);
  await pay(alice, id, d.installments[1].id, '50.00', '2026-03-01');
  assert.equal((await detail(alice, id)).loan.status, 'completed');
  await rejects(rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'close', p_note: 'x' }), 'P0409');
  assert.deepEqual(await rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'complete', p_note: null }), { status: 'completed' });
});

test('reminders: earliest alert at 09:00 local, one scheduled per loan, claims, dedupe and re-planning after payment', async () => {
  await db.query("update public.profiles set timezone = 'Asia/Dhaka' where id = $1", [alice.id]);
  const today = localDateOf(Date.now(), 'Asia/Dhaka');
  const firstDue = addDays(today, 3);
  const { id } = await create(alice, { startDate: today, firstDueDate: firstDue, frequency: 'weekly', installmentCount: 3, reminderDaysBefore: 1, overdueAlerts: true, reminderEmail: true });
  const scheduled = async () => (await db.query("select * from public.loan_reminders where loan_id = $1 and status = 'scheduled'", [id])).rows;
  let [reminder] = await scheduled();
  const [first, second] = (await detail(alice, id)).installments;
  assert.equal(reminder.kind, 'upcoming');
  assert.equal(reminder.installment_id, first.id);
  assert.equal(reminder.dedupe_key, `loan:${first.id}:upcoming`);
  assert.equal(new Date(reminder.remind_at).toISOString(), new Date(`${addDays(firstDue, -1)}T09:00:00+06:00`).toISOString());
  assert.equal(reminder.email_requested, true);
  // A partial payment re-plans with the remaining amount; still exactly one scheduled.
  await pay(alice, id, first.id, '50.00', today, today);
  [reminder] = await scheduled();
  assert.equal(Number(reminder.amount), 350, '400 scheduled − 50 paid');
  assert.equal((await scheduled()).length, 1);
  await rejects(db.query("insert into public.loan_reminders (user_id, loan_id, installment_id, kind, installment_number, due_date, amount, currency, loan_name, remind_at, time_zone, dedupe_key) select user_id, loan_id, installment_id, kind, installment_number, due_date, amount, currency, loan_name, remind_at, time_zone, dedupe_key || 'x' from public.loan_reminders where id = $1", [reminder.id]), '23505');
  // Due: claim → deliver → the next alert (installment 1's overdue alert) is planned.
  await db.query("update public.loan_reminders set remind_at = now() - interval '1 minute' where id = $1", [reminder.id]);
  assert.equal(await rpc('persora_calendar_dispatch_ping'), 'pg_net unavailable', 'the shared tick wakes for due loan reminders');
  assert.deepEqual(await rpc('persora_loan_claim_reminders', { p_limit: 10, p_owner: bob.id }), [], 'claims can be scoped to one member');
  const claimed = await rpc('persora_loan_claim_reminders', { p_limit: 10, p_owner: null });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].reminder.status, 'processing');
  assert.equal(claimed[0].reminder.email_status, 'sending');
  assert.equal(claimed[0].installment.id, first.id);
  assert.equal(claimed[0].owner.email, alice.email);
  assert.deepEqual(await rpc('persora_loan_claim_reminders', { p_limit: 10, p_owner: null }), [], 'a claimed reminder is not claimed twice');
  assert.equal(await rpc('persora_loan_complete_reminder', { p_id: reminder.id, p_claimed_at: claimed[0].reminder.claimed_at, p_delivered: true, p_email_status: 'sent', p_note: null }), true);
  assert.equal(await rpc('persora_loan_complete_reminder', { p_id: reminder.id, p_claimed_at: claimed[0].reminder.claimed_at, p_delivered: true, p_email_status: 'sent', p_note: null }), false);
  [reminder] = await scheduled();
  assert.equal(reminder.kind, 'overdue');
  assert.equal(reminder.installment_id, first.id);
  assert.equal(new Date(reminder.remind_at).toISOString(), new Date(`${addDays(firstDue, 1)}T09:00:00+06:00`).toISOString());
  // Paying installment 1 in full drops its overdue alert; the sent one is never re-planned.
  await pay(alice, id, first.id, '350.00', today, today);
  [reminder] = await scheduled();
  assert.equal(reminder.kind, 'upcoming');
  assert.equal(reminder.installment_id, second.id);
  assert.equal(await count("select count(*) from public.loan_reminders where dedupe_key = $1", [`loan:${first.id}:upcoming`]), 1);
  const recent = await rpc('persora_loan_reminders_recent', { p_owner: alice.id, p_since: new Date(Date.now() - 864e5).toISOString() });
  assert.equal(recent.length, 1);
  assert.equal(await rpc('persora_loan_reminders_mark_read', { p_owner: bob.id, p_id: null }), 0);
  assert.equal(await rpc('persora_loan_reminders_mark_read', { p_owner: alice.id, p_id: null }), 1);
  // Turning alerts off removes the planned one; closing does too.
  await rpc('persora_loan_set_status', { p_owner: alice.id, p_id: id, p_action: 'close', p_note: 'Settled in cash' });
  assert.equal((await scheduled()).length, 0);
  assert.equal(await rpc('persora_calendar_dispatch_ping'), 'idle');
  // Deleting the loan cascades to installments, payments and reminders.
  await rpc('persora_loan_delete', { p_owner: alice.id, p_id: id });
  for (const table of ['loan_installments', 'loan_payments', 'loan_reminders']) assert.equal(await count(`select count(*) from public.${table} where loan_id = $1`, [id]), 0);
});

test('reminder times follow the member\'s zone across daylight-saving changes', async () => {
  const carol = await addMember('loan-carol');
  await db.query("update public.profiles set timezone = 'America/New_York' where id = $1", [carol.id]);
  // DST ends 2027-11-07 (EST, UTC-5); starts 2028-03-12 (EDT, UTC-4).
  const autumn = await create(carol, { startDate: '2027-11-01', firstDueDate: '2027-11-08', frequency: 'weekly', installmentCount: 2, reminderDaysBefore: 1 });
  const spring = await create(carol, { startDate: '2028-03-01', firstDueDate: '2028-03-13', frequency: 'weekly', installmentCount: 2, reminderDaysBefore: 1 });
  const at = async (id) => new Date((await db.query("select remind_at from public.loan_reminders where loan_id = $1 and status = 'scheduled'", [id])).rows[0].remind_at).toISOString();
  assert.equal(await at(autumn.id), '2027-11-07T14:00:00.000Z');
  assert.equal(await at(spring.id), '2028-03-12T13:00:00.000Z');
});

test('linked documents must be the owner\'s own vault records', async () => {
  const insertDoc = async (owner) => (await db.query("insert into public.vault_items (user_id, section, title) values ($1, 'documents', 'Agreement') returning id", [owner.id])).rows[0].id;
  const mine = await insertDoc(alice);
  const theirs = await insertDoc(bob);
  const ok = await create(alice, { documentIds: [mine] });
  assert.deepEqual((await detail(alice, ok.id)).loan.document_ids, [mine]);
  await rejects(create(alice, { documentIds: [theirs] }), 'P0400');
  await rpc('persora_loan_delete', { p_owner: alice.id, p_id: ok.id });
});

test('backup/restore: export → import into another account remaps ids, keeps history and is idempotent', async () => {
  const dave = await addMember('loan-dave');
  const erin = await addMember('loan-erin');
  const { id } = await create(dave, { principal: '900', installmentCount: 3, interestMethod: 'reducing', interestRate: '12' });
  const [first, second] = (await detail(dave, id)).installments;
  const wrong = crypto.randomUUID();
  await pay(dave, id, first.id, '100.00', '2026-02-01', '2026-10-24', wrong, { method: 'bKash', reference: 'TX-1' });
  await rpc('persora_loan_reverse_payment', { p_owner: dave.id, p_loan: id, p_payment: wrong, p_reason: 'Wrong amount', p_correction: { id: crypto.randomUUID(), amount: '90.00', paid_on: '2026-02-01', method: 'bKash' }, p_today: '2026-10-24' });
  await pay(dave, id, second.id, '20.00', '2026-03-01');
  const closed = await create(dave, { name: 'Lent to Karim', direction: 'lent', principal: '50', installmentCount: 1 });
  await rpc('persora_loan_set_status', { p_owner: dave.id, p_id: closed.id, p_action: 'close', p_note: 'Gift' });

  const backup = JSON.parse(JSON.stringify(await rpc('persora_loans_export', { p_owner: dave.id })));
  assert.equal(backup.loans.length, 2);
  assert.equal(backup.installments.length, 4);
  assert.equal(backup.payments.length, 3);
  assert.deepEqual(await rpc('persora_loans_export', { p_owner: erin.id }), { loans: [], installments: [], payments: [], reminders: [] });
  const entries = backup.loans.map((loan) => importEntryFor(loan, backup.installments.filter((row) => row.loan_id === loan.id), backup.payments.filter((row) => row.loan_id === loan.id)));
  assert.ok(entries.every(Boolean), 'exported loans re-validate');
  // A tampered entry (installment paid more than scheduled) is rejected whole.
  assert.equal(importEntryFor(backup.loans[0], backup.installments.filter((row) => row.loan_id === id), [...backup.payments, { ...backup.payments.at(-1), id: crypto.randomUUID(), amount: 99999 }]), null);

  const summary = await rpc('persora_loans_import', { p_owner: erin.id, p_loans: entries });
  assert.deepEqual(summary, { loans_created: 2, loans_matched: 0, loans_skipped: 0, installments_added: 4, payments_added: 3 });
  const restored = await rpc('persora_loans_export', { p_owner: erin.id });
  assert.ok(restored.loans.every((loan) => loan.id !== id && loan.id !== closed.id), 'ids owned by another account are remapped');
  const loan = restored.loans.find((row) => row.name === 'Bike loan');
  assert.equal(loan.status, 'active');
  assert.equal(restored.loans.find((row) => row.name === 'Lent to Karim').status, 'closed');
  assert.equal(restored.loans.find((row) => row.name === 'Lent to Karim').close_note, 'Gift');
  const restoredInstallments = restored.installments.filter((row) => row.loan_id === loan.id);
  assert.deepEqual(restoredInstallments.map((row) => row.paid_amount), [90, 20, 0]);
  const restoredPayments = restored.payments.filter((row) => row.loan_id === loan.id);
  const reversed = restoredPayments.find((row) => row.status === 'reversed');
  assert.equal(reversed.reversal_reason, 'Wrong amount');
  assert.equal(restoredPayments.find((row) => row.corrects_payment_id).corrects_payment_id, reversed.id, 'the correction still points at the payment it corrected');
  assert.ok(restoredPayments.every((row) => restoredInstallments.some((inst) => inst.id === row.installment_id)));
  // Dave's data is untouched; importing again (into either account) never duplicates.
  assert.equal((await rpc('persora_loans_export', { p_owner: dave.id })).payments.length, 3);
  assert.deepEqual(await rpc('persora_loans_import', { p_owner: erin.id, p_loans: entries }), { loans_created: 0, loans_matched: 2, loans_skipped: 0, installments_added: 0, payments_added: 0 });
  assert.deepEqual(await rpc('persora_loans_import', { p_owner: dave.id, p_loans: entries }), { loans_created: 0, loans_matched: 2, loans_skipped: 0, installments_added: 0, payments_added: 0 });
  // Restoring into a fresh account after deleting the original keeps the original ids.
  await rpc('persora_loan_delete', { p_owner: dave.id, p_id: id });
  assert.equal((await rpc('persora_loans_import', { p_owner: dave.id, p_loans: entries })).loans_created, 1);
  assert.equal((await detail(dave, id)).payments.length, 3);
});
