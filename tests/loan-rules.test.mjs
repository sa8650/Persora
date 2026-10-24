// Loan Tracker shared rules: money parsing, due dates (month ends, leap years),
// no-interest / flat / reducing-balance schedules, validation, installment
// status, loan summaries, payment validation, recalculation planning, reminder
// decisions and time-zone-based "today".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPeriods, buildSchedule, dueDateFor, fromCents, installmentStatus, isScheduleChange, lockedCount, LoanValidationError, normalizeLoanInput,
  normalizePaymentInput, planRecalculation, previewLoan, reminderDecision, splitEvenly, summarizeLoan, toCents,
} from '../cloudflare/loan-rules.js';
import { localDateOf } from '../cloudflare/calendar-rules.js';
import { decimal } from '../cloudflare/loans.js';

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const invalid = (fn, field) => assert.throws(fn, (error) => {
  assert.ok(error instanceof LoanValidationError, `expected a LoanValidationError, got ${error}`);
  assert.equal(error.field, field, error.message);
  return true;
});
const form = (overrides = {}) => ({
  name: 'Car Loan', direction: 'borrowed', partyName: 'City Bank', borrowerName: 'Alice', currency: 'BDT', principal: '100000',
  interestMethod: 'none', interestRate: '', installmentCount: 12, frequency: 'monthly', startDate: '2026-01-15', firstDueDate: '2026-02-15',
  ...overrides,
});

test('money is parsed to exact integer cents and written back exactly', () => {
  assert.equal(toCents('1250'), 125000);
  assert.equal(toCents('1,250.5'), 125050);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(19.99), 1999);
  assert.ok(Number.isNaN(toCents('1.234')), 'more than 2 decimals is rejected');
  assert.ok(Number.isNaN(toCents('abc')));
  assert.ok(Number.isNaN(toCents(Number.NaN)));
  assert.equal(toCents('-5'), -500);
  assert.equal(fromCents(888488), 8884.88);
  assert.equal(decimal(888488), '8884.88');
  assert.equal(decimal(5), '0.05');
  assert.equal(decimal(100000000000), '1000000000.00');
  assert.deepEqual(splitEvenly(100000, 3), { regular: 33333, final: 33334 });
  assert.deepEqual(splitEvenly(100, 60, { minFinal: 1 }), { regular: 1, final: 41 }, 'falls back to floor when rounding up would leave nothing');
});

test('due dates stay on the intended day: month ends, leap years, weeks and days', () => {
  // Monthly from Jan 31 (2028 is a leap year): clamps but returns to the 31st.
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => dueDateFor('2028-01-31', 1, 'monthly', n)), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']);
  assert.deepEqual([1, 2, 3].map((n) => dueDateFor('2027-01-30', 1, 'monthly', n)), ['2027-01-30', '2027-02-28', '2027-03-30']);
  // Year boundary.
  assert.equal(dueDateFor('2026-11-30', 1, 'monthly', 3), '2027-01-30');
  // Yearly from Feb 29.
  assert.deepEqual([1, 2, 5].map((n) => dueDateFor('2028-02-29', 1, 'yearly', n)), ['2028-02-29', '2029-02-28', '2032-02-29']);
  assert.equal(addPeriods('2026-12-28', 'weekly', 1), '2027-01-04');
  assert.equal(addPeriods('2026-02-27', 'daily', 2), '2026-03-01');
  // A re-anchored schedule counts from its own anchor.
  assert.equal(dueDateFor('2026-06-10', 4, 'monthly', 6), '2026-08-10');
});

test('no-interest schedules split the amount evenly; the final installment absorbs rounding', () => {
  const s = buildSchedule({ principalCents: 100000, method: 'none', count: 3, frequency: 'weekly', anchorDate: '2026-10-30' });
  assert.deepEqual(s.installments.map((row) => row.amountCents), [33333, 33333, 33334]);
  assert.deepEqual(s.installments.map((row) => row.dueDate), ['2026-10-30', '2026-11-06', '2026-11-13']);
  assert.equal(s.interestCents, 0);
  assert.equal(s.totalCents, 100000);
  assert.equal(sum(s.installments, 'amountCents'), 100000);
  const daily = buildSchedule({ principalCents: 3000000, method: 'none', count: 30, frequency: 'daily', anchorDate: '2026-10-25' });
  assert.equal(daily.finalDueDate, '2026-11-23');
  assert.equal(daily.regularCents, 100000);
});

test('flat interest is charged on the original principal for the whole term', () => {
  const monthly = buildSchedule({ principalCents: 10000000, ratePct: 10, method: 'flat', count: 24, frequency: 'monthly', anchorDate: '2026-11-05' });
  assert.equal(monthly.interestCents, 2000000, '100,000 × 10% × 2 years');
  assert.equal(monthly.regularCents, 500000);
  assert.equal(monthly.totalCents, 12000000);
  // One year of weekly / daily installments charges one year of interest.
  assert.equal(buildSchedule({ principalCents: 5200000, ratePct: 10, method: 'flat', count: 52, frequency: 'weekly', anchorDate: '2026-11-02' }).interestCents, 520000);
  assert.equal(buildSchedule({ principalCents: 3650000, ratePct: 20, method: 'flat', count: 365, frequency: 'daily', anchorDate: '2026-11-02' }).interestCents, 730000);
  assert.equal(buildSchedule({ principalCents: 1000000, ratePct: 8, method: 'flat', count: 3, frequency: 'yearly', anchorDate: '2027-01-01' }).interestCents, 240000);
  // Uneven split: every installment's principal + interest is consistent and sums exactly.
  const odd = buildSchedule({ principalCents: 1000000, ratePct: 7.25, method: 'flat', count: 7, frequency: 'monthly', anchorDate: '2026-11-01' });
  assert.equal(sum(odd.installments, 'principalCents'), 1000000);
  assert.equal(sum(odd.installments, 'interestCents'), odd.interestCents);
  assert.equal(sum(odd.installments, 'amountCents'), odd.totalCents);
  assert.ok(odd.installments.every((row) => row.interestCents >= 0 && row.principalCents > 0 && row.amountCents === row.principalCents + row.interestCents));
});

test('reducing balance uses equal installments with interest on the remaining principal', () => {
  const s = buildSchedule({ principalCents: 10000000, ratePct: 12, method: 'reducing', count: 12, frequency: 'monthly', anchorDate: '2026-01-31' });
  assert.equal(s.regularCents, 888488, 'standard EMI for 100,000 at 12% over 12 months');
  assert.equal(s.finalCents, 888485, 'the final installment absorbs rounding');
  assert.equal(s.installments[0].interestCents, 100000, 'first month: 1% of 100,000');
  assert.equal(s.installments[1].interestCents, Math.round((10000000 - s.installments[0].principalCents) * 0.01));
  assert.equal(sum(s.installments, 'principalCents'), 10000000);
  assert.equal(s.totalCents, 10000000 + s.interestCents);
  assert.equal(s.interestCents, 661853);
  assert.equal(s.periodicRate, 0.01);
  assert.equal(s.installments[1].dueDate, '2026-02-28');
  const yearly = buildSchedule({ principalCents: 100000000, ratePct: 10, method: 'reducing', count: 5, frequency: 'yearly', anchorDate: '2027-01-01' });
  assert.equal(yearly.regularCents, 26379748, '1,000,000 at 10% over 5 years');
  const weekly = buildSchedule({ principalCents: 5200000, ratePct: 13, method: 'reducing', count: 52, frequency: 'weekly', anchorDate: '2026-11-02' });
  assert.equal(weekly.periodicRate, 0.0025);
  assert.equal(weekly.regularCents, 106766, '52,000 × 0.0025 / (1 − 1.0025^−52)');
  assert.equal(weekly.interestCents, 351810);
  assert.ok(weekly.interestCents < 676000, 'reducing interest is below the flat equivalent (52,000 × 13%)');
  const daily = buildSchedule({ principalCents: 5000000, ratePct: 20, method: 'reducing', count: 100, frequency: 'daily', anchorDate: '2026-10-25' });
  assert.equal(sum(daily.installments, 'principalCents'), 5000000);
  assert.equal(sum(daily.installments, 'amountCents'), daily.totalCents);
});

test('loan input validation reports the offending field', () => {
  const ok = normalizeLoanInput(form({ interestMethod: 'flat', interestRate: '9.5', documentIds: ['3F2504E0-4F89-41D3-9A0C-0305E82C3301'] }));
  assert.equal(ok.principalCents, 10000000);
  assert.equal(ok.interestRate, 9.5);
  assert.deepEqual(ok.documentIds, ['3f2504e0-4f89-41d3-9a0c-0305e82c3301']);
  invalid(() => normalizeLoanInput(form({ name: '  ' })), 'name');
  invalid(() => normalizeLoanInput(form({ direction: 'gift' })), 'direction');
  invalid(() => normalizeLoanInput(form({ partyName: '' })), 'partyName');
  invalid(() => normalizeLoanInput(form({ borrowerName: '' })), 'borrowerName');
  invalid(() => normalizeLoanInput(form({ currency: 'XYZ' })), 'currency');
  invalid(() => normalizeLoanInput(form({ principal: '-5' })), 'principal');
  invalid(() => normalizeLoanInput(form({ principal: '0' })), 'principal');
  invalid(() => normalizeLoanInput(form({ principal: '10.555' })), 'principal');
  invalid(() => normalizeLoanInput(form({ principal: '2000000000' })), 'principal');
  invalid(() => normalizeLoanInput(form({ principal: '0.05', installmentCount: 10 })), 'principal');
  invalid(() => normalizeLoanInput(form({ interestRate: '5' })), 'interestRate');
  invalid(() => normalizeLoanInput(form({ interestMethod: 'flat', interestRate: '' })), 'interestRate');
  invalid(() => normalizeLoanInput(form({ interestMethod: 'reducing', interestRate: '0' })), 'interestRate');
  invalid(() => normalizeLoanInput(form({ interestMethod: 'flat', interestRate: '101' })), 'interestRate');
  invalid(() => normalizeLoanInput(form({ interestMethod: 'bank' })), 'interestMethod');
  invalid(() => normalizeLoanInput(form({ installmentCount: 0 })), 'installmentCount');
  invalid(() => normalizeLoanInput(form({ installmentCount: 2.5 })), 'installmentCount');
  invalid(() => normalizeLoanInput(form({ installmentCount: 2001 })), 'installmentCount');
  invalid(() => normalizeLoanInput(form({ frequency: 'hourly' })), 'frequency');
  invalid(() => normalizeLoanInput(form({ startDate: '2026-02-30' })), 'startDate');
  invalid(() => normalizeLoanInput(form({ firstDueDate: '2026-01-01' })), 'firstDueDate');
  invalid(() => normalizeLoanInput(form({ documentIds: ['not-a-uuid'] })), 'documentIds');
  invalid(() => normalizeLoanInput(form({ reminderDaysBefore: 2 })), 'reminderDaysBefore');
  invalid(() => normalizeLoanInput(form({ frequency: 'yearly', installmentCount: 200 })), 'installmentCount');
  assert.equal(normalizeLoanInput(form({ reminderEmail: true })).reminderEmail, false, 'email needs a reminder to be on');
  const preview = previewLoan(normalizeLoanInput(form()));
  assert.equal(preview.firstDueDate, '2026-02-15');
  assert.equal(preview.finalDueDate, '2027-01-15');
});

const inst = (number, dueDate, amountCents, paidCents = 0, extra = {}) => ({ number, dueDate, principalCents: amountCents, interestCents: 0, amountCents, paidCents, ...extra });

test('installment status: paid, partial, overdue (including partly paid), due window and upcoming', () => {
  const today = '2026-10-24';
  assert.equal(installmentStatus(inst(1, '2026-10-01', 1000, 1000), today, 'monthly'), 'paid');
  assert.equal(installmentStatus(inst(1, '2026-10-23', 1000), today, 'monthly'), 'overdue');
  assert.equal(installmentStatus(inst(1, '2026-10-23', 1000, 400), today, 'monthly'), 'overdue', 'a partly paid installment past its date is overdue, not paid');
  assert.equal(installmentStatus(inst(1, '2026-10-30', 1000, 400), today, 'monthly'), 'partial');
  assert.equal(installmentStatus(inst(1, '2026-10-24', 1000), today, 'daily'), 'due');
  assert.equal(installmentStatus(inst(1, '2026-10-25', 1000), today, 'daily'), 'upcoming');
  assert.equal(installmentStatus(inst(1, '2026-10-30', 1000), today, 'weekly'), 'due');
  assert.equal(installmentStatus(inst(1, '2026-10-31', 1000), today, 'monthly'), 'due');
  assert.equal(installmentStatus(inst(1, '2026-11-01', 1000), today, 'monthly'), 'upcoming');
});

test('loan summary: outstanding, next installment, overdue totals, completion and written-off balance', () => {
  const rows = [inst(1, '2026-09-15', 1000, 1000), inst(2, '2026-10-15', 1000, 300), inst(3, '2026-11-15', 1000), inst(4, '2026-12-15', 1000)];
  const active = summarizeLoan({ status: 'active', frequency: 'monthly' }, rows, '2026-10-24');
  assert.equal(active.scheduledCents, 4000);
  assert.equal(active.paidCents, 1300);
  assert.equal(active.outstandingCents, 2700);
  assert.equal(active.paidCount, 1);
  assert.equal(active.overdueCount, 1);
  assert.equal(active.overdueCents, 700);
  assert.equal(active.next.number, 2, 'the earliest unpaid installment is next');
  assert.equal(active.nextStatus, 'overdue');
  assert.equal(active.state, 'overdue');
  assert.ok(Math.abs(active.progress - 0.325) < 1e-9);
  const closed = summarizeLoan({ status: 'closed', frequency: 'monthly' }, rows, '2026-10-24');
  assert.equal(closed.writtenOffCents, 2700);
  assert.equal(closed.overdueCount, 0);
  assert.equal(closed.next, null);
  assert.equal(closed.state, 'closed');
  const done = summarizeLoan({ status: 'completed', frequency: 'monthly' }, rows.map((row) => ({ ...row, paidCents: row.amountCents })), '2026-10-24');
  assert.equal(done.outstandingCents, 0);
  assert.equal(done.state, 'completed');
});

test('payment validation: no zero, negative, over-remaining, future or pre-start payments', () => {
  const context = { today: '2026-10-24', startDate: '2026-01-15', remainingCents: 50000 };
  assert.deepEqual(normalizePaymentInput({ amount: '200.50', paidOn: '2026-10-24', method: 'bKash', reference: 'TX1' }, context),
    { amountCents: 20050, paidOn: '2026-10-24', method: 'bKash', reference: 'TX1', notes: '' });
  assert.equal(normalizePaymentInput({ amount: 500, paidOn: '2026-10-01' }, context).amountCents, 50000, 'paying exactly the remainder is allowed');
  invalid(() => normalizePaymentInput({ amount: '0', paidOn: '2026-10-24' }, context), 'amount');
  invalid(() => normalizePaymentInput({ amount: '-10', paidOn: '2026-10-24' }, context), 'amount');
  invalid(() => normalizePaymentInput({ amount: '10.001', paidOn: '2026-10-24' }, context), 'amount');
  assert.throws(() => normalizePaymentInput({ amount: '500.01', paidOn: '2026-10-24' }, context), /500\.00 remaining/);
  invalid(() => normalizePaymentInput({ amount: '10', paidOn: '2026-10-25' }, context), 'paidOn');
  invalid(() => normalizePaymentInput({ amount: '10', paidOn: '2026-01-14' }, context), 'paidOn');
  invalid(() => normalizePaymentInput({ amount: '10', paidOn: 'yesterday' }, context), 'paidOn');
});

function loanWith(normalized) {
  const schedule = previewLoan(normalized);
  return {
    terms: { ...normalized, anchorDate: normalized.firstDueDate, anchorNumber: 1 },
    rows: schedule.installments.map((row) => ({ ...row, paidCents: 0, paymentCount: 0 })),
  };
}

test('recalculation keeps paid and past-due installments; only future ones are rebuilt', () => {
  const base = normalizeLoanInput(form({ interestMethod: 'reducing', interestRate: '12', startDate: '2026-01-15', firstDueDate: '2026-01-31' }));
  const { terms, rows } = loanWith(base);
  // Nothing locked yet: a full rebuild from the new first date.
  const fresh = planRecalculation(terms, rows, { ...base, installmentCount: 6 }, { today: '2026-01-20' });
  assert.equal(fresh.lockedCount, 0);
  assert.equal(fresh.future.length, 6);
  assert.equal(fresh.future[0].number, 1);

  // Installments 1-3 are past due on Apr 20; installment 5 already has a payment → 1-5 are locked.
  rows[0].paidCents = rows[0].amountCents; rows[0].paymentCount = 1;
  rows[4].paidCents = 1000; rows[4].paymentCount = 1;
  assert.equal(lockedCount(rows, '2026-04-20'), 5);
  const edited = { ...base, principalCents: 12000000, installmentCount: 15 };
  assert.equal(isScheduleChange(terms, edited), true);
  assert.equal(isScheduleChange(terms, { ...base, name: 'Renamed' }), false);
  const plan = planRecalculation(terms, rows, edited, { today: '2026-04-20' });
  assert.equal(plan.lockedCount, 5);
  assert.equal(plan.future.length, 10);
  assert.equal(plan.future[0].number, 6);
  const lockedPrincipal = sum(rows.slice(0, 5), 'principalCents');
  assert.equal(plan.remainingPrincipalCents, 12000000 - lockedPrincipal);
  assert.equal(sum(plan.future, 'principalCents'), 12000000 - lockedPrincipal);
  assert.equal(plan.future[0].dueDate, rows[5].dueDate, 'same rhythm: future dates stay on the original anchor');
  assert.equal(plan.anchorDate, '2026-01-31');
  assert.equal(plan.future[1].dueDate, '2026-07-31');
  assert.equal(plan.newScheduledTotalCents, sum(rows.slice(0, 5), 'amountCents') + plan.futureTotalCents);

  // A new next date re-anchors the remaining installments.
  const moved = planRecalculation(terms, rows, edited, { today: '2026-04-20', nextDueDate: '2026-06-10' });
  assert.equal(moved.anchorDate, '2026-06-10');
  assert.equal(moved.anchorNumber, 6);
  assert.equal(moved.future[1].dueDate, '2026-07-10');

  // Frequency change: weekly from after the last locked installment.
  const weekly = planRecalculation(terms, rows, { ...edited, frequency: 'weekly', installmentCount: 30 }, { today: '2026-04-20', nextDueDate: '2026-06-05' });
  assert.equal(weekly.future[1].dueDate, '2026-06-12');

  invalid(() => planRecalculation(terms, rows, { ...edited, installmentCount: 5 }, { today: '2026-04-20' }), 'installmentCount');
  invalid(() => planRecalculation(terms, rows, { ...edited, principalCents: lockedPrincipal }, { today: '2026-04-20' }), 'principal');
  invalid(() => planRecalculation(terms, rows, edited, { today: '2026-04-20', nextDueDate: rows[4].dueDate }), 'nextDueDate');
  invalid(() => planRecalculation(terms, rows, { ...edited, firstDueDate: '2026-02-01' }, { today: '2026-04-20' }), 'firstDueDate');
  invalid(() => planRecalculation(terms, rows, { ...edited, frequency: 'weekly' }, { today: '2026-07-01', nextDueDate: '2026-06-30' }), 'nextDueDate');
});

test('reminder decisions never deliver for paid installments or inactive loans', () => {
  const loan = { status: 'active', reminderDaysBefore: 3, overdueAlerts: true };
  const due = inst(4, '2026-10-27', 5000);
  assert.deepEqual(reminderDecision({ kind: 'upcoming', dueDate: '2026-10-27' }, loan, due, '2026-10-24'), { deliver: true, note: null });
  assert.equal(reminderDecision({ kind: 'upcoming', dueDate: '2026-10-27' }, loan, { ...due, paidCents: 5000 }, '2026-10-24').deliver, false);
  assert.equal(reminderDecision({ kind: 'upcoming', dueDate: '2026-10-27' }, { ...loan, status: 'closed' }, due, '2026-10-24').deliver, false);
  assert.equal(reminderDecision({ kind: 'upcoming', dueDate: '2026-10-27' }, { ...loan, reminderDaysBefore: null }, due, '2026-10-24').deliver, false);
  assert.equal(reminderDecision({ kind: 'upcoming', dueDate: '2026-10-20' }, loan, due, '2026-10-24').deliver, false, 'due date changed');
  assert.equal(reminderDecision({ kind: 'overdue', dueDate: '2026-10-27' }, loan, due, '2026-10-28').deliver, true);
  assert.equal(reminderDecision({ kind: 'overdue', dueDate: '2026-10-27' }, loan, { ...due, paidCents: 2000 }, '2026-10-28').deliver, true, 'still money due');
  assert.equal(reminderDecision({ kind: 'overdue', dueDate: '2026-10-27' }, { ...loan, overdueAlerts: false }, due, '2026-10-28').deliver, false);
  assert.equal(reminderDecision({ kind: 'overdue', dueDate: '2026-10-27' }, loan, null, '2026-10-28').deliver, false);
});

test('overdue detection follows the member\'s time zone, across DST changes', () => {
  const row = inst(1, '2026-10-24', 1000);
  const instantMs = Date.parse('2026-10-24T20:00:00Z');
  assert.equal(installmentStatus(row, localDateOf(instantMs, 'Asia/Dhaka'), 'monthly'), 'overdue', 'already Oct 25 in Dhaka');
  assert.equal(installmentStatus(row, localDateOf(instantMs, 'America/New_York'), 'monthly'), 'due', 'still Oct 24 in New York');
  // New York leaves DST at 06:00Z on Nov 1, 2026: before that local midnight is 04:00Z (EDT), after it 05:00Z (EST).
  assert.equal(localDateOf(Date.parse('2026-11-01T03:59:00Z'), 'America/New_York'), '2026-10-31');
  assert.equal(localDateOf(Date.parse('2026-11-01T04:30:00Z'), 'America/New_York'), '2026-11-01');
  assert.equal(localDateOf(Date.parse('2026-11-02T04:30:00Z'), 'America/New_York'), '2026-11-01', 'after the change midnight is 05:00Z');
  assert.equal(localDateOf(Date.parse('2027-03-14T04:59:00Z'), 'America/New_York'), '2027-03-13');
});
