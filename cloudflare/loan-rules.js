// Persora Loan Tracker — calculation and validation rules shared by the Pages API
// (cloudflare/loans.js) and the browser (src/components/loans/*). Dependency-free.
//
// Money is handled in integer minor units ("cents") everywhere; every supported
// currency has two decimals. Dates are local calendar dates (YYYY-MM-DD) in the
// member's profile time zone.
//
// Calculation assumptions (also shown in the UI and LOAN_TRACKER.md):
// - The interest rate is a nominal ANNUAL percentage.
// - Installments are equal periods: 365 per year (daily), 52 (weekly), 12
//   (monthly) or 1 (yearly). The loan term in years is installments ÷ periods.
// - No interest: the amount is split evenly.
// - Flat: interest = principal × rate × term, charged on the ORIGINAL principal
//   for the whole term and spread evenly over the installments.
// - Reducing balance: equal installments (amortisation). Each period's interest
//   is the remaining principal × (rate ÷ periods per year); the rest of the
//   installment repays principal.
// - Amounts are rounded to the cent; the final installment absorbs rounding
//   differences. Fees, insurance, taxes and bank day-count conventions are not
//   modelled, so results are estimates, not a lender's guaranteed figures.

import { addDays, addMonths, daysBetween, isDateString } from "./calendar-rules.js";

export const LOAN_DIRECTIONS = Object.freeze(["borrowed", "lent"]);
export const INTEREST_METHODS = Object.freeze(["none", "flat", "reducing"]);
export const LOAN_FREQUENCIES = Object.freeze(["daily", "weekly", "monthly", "yearly"]);
export const PERIODS_PER_YEAR = Object.freeze({ daily: 365, weekly: 52, monthly: 12, yearly: 1 });
/** A not-yet-paid installment is "Due" (rather than "Upcoming") this many days ahead. */
export const DUE_WINDOW_DAYS = Object.freeze({ daily: 0, weekly: 6, monthly: 7, yearly: 7 });
export const REMINDER_DAY_OPTIONS = Object.freeze([0, 1, 3, 7]);
/** Local time reminders are sent at (profile time zone). */
export const LOAN_REMINDER_TIME = "09:00";
export const LOAN_STATUSES = Object.freeze(["active", "completed", "closed"]);
export const LOAN_CURRENCIES = Object.freeze([
  "BDT", "USD", "EUR", "GBP", "INR", "PKR", "NPR", "LKR", "AED", "SAR", "QAR", "KWD", "MYR", "SGD", "CAD", "AUD", "NZD", "CHF", "CNY", "HKD", "THB", "PHP", "IDR", "TRY", "ZAR",
]);
export const LOAN_LIMITS = Object.freeze({
  loans: 200,
  name: 80,
  party: 120,
  borrower: 120,
  reference: 80,
  notes: 2000,
  documents: 20,
  installmentsMax: 2000,
  principalMaxCents: 100_000_000_000, // 1,000,000,000.00
  rateMax: 100,
  paymentMethod: 40,
  paymentReference: 80,
  paymentNote: 500,
  closeNote: 500,
  reversalReason: 300,
  scheduleChanges: 50,
});
const LAST_DATE = "2199-12-31";

export class LoanValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "LoanValidationError";
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Parses an amount ("1250", "1250.5", 1250.5) to integer cents; NaN when invalid or over 2 decimals. */
export function toCents(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    return Math.abs(scaled - rounded) < 1e-6 ? rounded : Number.NaN;
  }
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(text)) return Number.NaN;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || 0);
  return negative ? -cents : cents;
}
export const fromCents = (cents) => Math.round(Number(cents) || 0) / 100;

/** Splits `total` cents into `count` parts: equal regular parts, the final part absorbs rounding. */
export function splitEvenly(total, count, { minFinal = 0 } = {}) {
  if (count <= 1) return { regular: total, final: total };
  let regular = Math.round(total / count);
  let final = total - regular * (count - 1);
  if (final < minFinal) {
    regular = Math.floor(total / count);
    final = total - regular * (count - 1);
  }
  return { regular, final };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `date` moved by `count` installment periods. Months/years clamp to the month's last day. */
export function addPeriods(date, frequency, count) {
  if (frequency === "daily") return addDays(date, count);
  if (frequency === "weekly") return addDays(date, count * 7);
  if (frequency === "monthly") return addMonths(date, count);
  if (frequency === "yearly") return addMonths(date, count * 12);
  throw new LoanValidationError("Choose how often installments are due.", "frequency");
}

/**
 * Due date of installment `number`, counted from the schedule anchor (the
 * anchor installment's intended date). Counting from the anchor keeps monthly
 * installments on the intended day: Jan 31 → Feb 28 (29) → Mar 31.
 */
export function dueDateFor(anchorDate, anchorNumber, frequency, number) {
  return addPeriods(anchorDate, frequency, number - anchorNumber);
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/** Periodic rate (fraction) for an annual percentage. */
export function periodicRate(ratePct, frequency) {
  return (Number(ratePct) || 0) / 100 / PERIODS_PER_YEAR[frequency];
}

/**
 * Builds an installment schedule.
 * @returns {{ installments: {number:number,dueDate:string,principalCents:number,interestCents:number,amountCents:number}[],
 *   principalCents:number, interestCents:number, totalCents:number, regularCents:number, finalCents:number, periodicRate:number,
 *   firstDueDate:string, finalDueDate:string }}
 */
export function buildSchedule({ principalCents, ratePct = 0, method = "none", count, frequency, anchorDate, anchorNumber = 1, startNumber = 1 }) {
  if (!Number.isInteger(count) || count < 1) throw new LoanValidationError("Enter how many installments there are.", "installmentCount");
  if (!Number.isInteger(principalCents) || principalCents <= 0) throw new LoanValidationError("Enter the loan amount.", "principal");
  if (principalCents < count) throw new LoanValidationError(`This amount is too small to split into ${count} installments.`, "principal");
  const rate = method === "none" ? 0 : Number(ratePct) || 0;
  const i = periodicRate(rate, frequency);
  const rows = [];
  const dateOf = (offset) => dueDateFor(anchorDate, anchorNumber, frequency, startNumber + offset);

  if (method === "reducing" && i > 0) {
    const emi = Math.round((principalCents * i) / (1 - (1 + i) ** -count));
    let balance = principalCents;
    for (let k = 0; k < count; k += 1) {
      const interest = Math.round(balance * i);
      const last = k === count - 1;
      let principal = last ? balance : emi - interest;
      if (!last && (principal <= 0 || principal >= balance)) {
        throw new LoanValidationError(`This amount is too small to split into ${count} installments at this rate.`, "principal");
      }
      principal = Math.min(principal, balance);
      balance -= principal;
      rows.push({ number: startNumber + k, dueDate: dateOf(k), principalCents: principal, interestCents: interest, amountCents: principal + interest });
    }
  } else {
    const years = count / PERIODS_PER_YEAR[frequency];
    const interestTotal = method === "flat" ? Math.round((principalCents * rate * years) / 100) : 0;
    const principalSplit = splitEvenly(principalCents, count, { minFinal: 1 });
    const interestSplit = splitEvenly(interestTotal, count, { minFinal: 0 });
    for (let k = 0; k < count; k += 1) {
      const last = k === count - 1;
      const principal = last ? principalSplit.final : principalSplit.regular;
      const interest = last ? interestSplit.final : interestSplit.regular;
      rows.push({ number: startNumber + k, dueDate: dateOf(k), principalCents: principal, interestCents: interest, amountCents: principal + interest });
    }
  }
  for (const row of rows) {
    if (row.amountCents <= 0) throw new LoanValidationError(`This amount is too small to split into ${count} installments.`, "principal");
    if (row.dueDate > LAST_DATE) throw new LoanValidationError("The schedule would run past the year 2199. Use fewer installments.", "installmentCount");
  }
  const interestCents = rows.reduce((sum, row) => sum + row.interestCents, 0);
  return {
    installments: rows,
    principalCents,
    interestCents,
    totalCents: principalCents + interestCents,
    regularCents: rows[0].amountCents,
    finalCents: rows[rows.length - 1].amountCents,
    periodicRate: i,
    firstDueDate: rows[0].dueDate,
    finalDueDate: rows[rows.length - 1].dueDate,
  };
}

/** Human explanation of how the selected method is calculated (UI + docs). */
export function calculationNote(method, frequency) {
  const periods = { daily: "365 daily", weekly: "52 weekly", monthly: "12 monthly", yearly: "1 yearly" }[frequency] || "12 monthly";
  if (method === "flat") return `Flat rate: interest = amount × annual rate × term in years, charged on the original amount for the whole term (${periods} installments = 1 year) and spread evenly.`;
  if (method === "reducing") return `Reducing balance: equal installments. Each period's interest is the remaining principal × annual rate ÷ ${PERIODS_PER_YEAR[frequency] ?? 12}; the rest repays principal.`;
  return "No interest: the amount is split evenly across the installments.";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const text = (value) => (typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates and normalises the loan form / API input. Throws LoanValidationError
 * (with the offending field) on the first problem.
 */
export function normalizeLoanInput(input = {}) {
  const name = text(input.name);
  if (!name) throw new LoanValidationError("Enter the loan name or purpose.", "name");
  if (name.length > LOAN_LIMITS.name) throw new LoanValidationError(`Keep the name under ${LOAN_LIMITS.name} characters.`, "name");
  const direction = text(input.direction);
  if (!LOAN_DIRECTIONS.includes(direction)) throw new LoanValidationError("Choose whether you borrowed or lent this money.", "direction");
  const partyName = text(input.partyName);
  if (!partyName) throw new LoanValidationError(direction === "borrowed" ? "Enter the lender, bank or person you repay." : "Enter who receives the repayments.", "partyName");
  if (partyName.length > LOAN_LIMITS.party) throw new LoanValidationError(`Keep this under ${LOAN_LIMITS.party} characters.`, "partyName");
  const borrowerName = text(input.borrowerName);
  if (!borrowerName) throw new LoanValidationError("Enter who is responsible for repaying.", "borrowerName");
  if (borrowerName.length > LOAN_LIMITS.borrower) throw new LoanValidationError(`Keep this under ${LOAN_LIMITS.borrower} characters.`, "borrowerName");
  const currency = text(input.currency || "BDT").toUpperCase();
  if (!LOAN_CURRENCIES.includes(currency)) throw new LoanValidationError("Choose a supported currency.", "currency");

  const principalCents = toCents(input.principal);
  if (!Number.isFinite(principalCents)) throw new LoanValidationError("Enter the loan amount as a number with up to 2 decimals.", "principal");
  if (principalCents <= 0) throw new LoanValidationError("The loan amount must be more than zero.", "principal");
  if (principalCents > LOAN_LIMITS.principalMaxCents) throw new LoanValidationError("That amount is larger than Persora supports.", "principal");

  const interestMethod = text(input.interestMethod || "none");
  if (!INTEREST_METHODS.includes(interestMethod)) throw new LoanValidationError("Choose an interest method.", "interestMethod");
  let interestRate = null;
  const rawRate = input.interestRate;
  const hasRate = rawRate !== null && rawRate !== undefined && text(rawRate) !== "";
  if (interestMethod === "none") {
    if (hasRate && Number(rawRate) !== 0) throw new LoanValidationError("Choose Flat or Reducing balance to charge interest, or clear the rate.", "interestRate");
  } else {
    if (!hasRate) throw new LoanValidationError("Enter the annual interest rate.", "interestRate");
    const rate = Number(text(rawRate));
    if (!Number.isFinite(rate) || !/^\d+(\.\d{1,4})?$/.test(text(rawRate))) throw new LoanValidationError("Enter the rate as a number, e.g. 9.5.", "interestRate");
    if (rate <= 0) throw new LoanValidationError("The rate must be more than 0%. Choose No interest for interest-free loans.", "interestRate");
    if (rate > LOAN_LIMITS.rateMax) throw new LoanValidationError(`The annual rate can be at most ${LOAN_LIMITS.rateMax}%.`, "interestRate");
    interestRate = rate;
  }

  const installmentCount = Number(input.installmentCount);
  if (!Number.isInteger(installmentCount) || installmentCount < 1) throw new LoanValidationError("Enter the number of installments (a whole number).", "installmentCount");
  if (installmentCount > LOAN_LIMITS.installmentsMax) throw new LoanValidationError(`Use at most ${LOAN_LIMITS.installmentsMax} installments.`, "installmentCount");
  const frequency = text(input.frequency);
  if (!LOAN_FREQUENCIES.includes(frequency)) throw new LoanValidationError("Choose how often installments are due.", "frequency");
  const startDate = text(input.startDate);
  if (!isDateString(startDate)) throw new LoanValidationError("Enter the loan start date.", "startDate");
  const firstDueDate = text(input.firstDueDate);
  if (!isDateString(firstDueDate)) throw new LoanValidationError("Enter the first installment date.", "firstDueDate");
  if (firstDueDate < startDate) throw new LoanValidationError("The first installment can't be before the loan starts.", "firstDueDate");
  if (startDate < "1970-01-01" || firstDueDate > LAST_DATE) throw new LoanValidationError("Enter a realistic date.", "firstDueDate");

  const reference = text(input.reference);
  if (reference.length > LOAN_LIMITS.reference) throw new LoanValidationError(`Keep the reference under ${LOAN_LIMITS.reference} characters.`, "reference");
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > LOAN_LIMITS.notes) throw new LoanValidationError(`Keep notes under ${LOAN_LIMITS.notes} characters.`, "notes");
  const rawDocuments = Array.isArray(input.documentIds) ? input.documentIds : [];
  const documentIds = [...new Set(rawDocuments.map((id) => String(id || "").toLowerCase()))];
  if (documentIds.some((id) => !UUID.test(id))) throw new LoanValidationError("One of the linked documents isn't valid.", "documentIds");
  if (documentIds.length > LOAN_LIMITS.documents) throw new LoanValidationError(`Link at most ${LOAN_LIMITS.documents} documents.`, "documentIds");

  let reminderDaysBefore = null;
  if (input.reminderDaysBefore !== null && input.reminderDaysBefore !== undefined && text(input.reminderDaysBefore) !== "") {
    reminderDaysBefore = Number(input.reminderDaysBefore);
    if (!REMINDER_DAY_OPTIONS.includes(reminderDaysBefore)) throw new LoanValidationError("Choose when to be reminded.", "reminderDaysBefore");
  }
  const overdueAlerts = Boolean(input.overdueAlerts);
  const reminderEmail = Boolean(input.reminderEmail) && (reminderDaysBefore !== null || overdueAlerts);

  const normalized = {
    name, direction, partyName, borrowerName, currency, principalCents, interestMethod, interestRate, installmentCount, frequency,
    startDate, firstDueDate, reference, notes, documentIds, reminderDaysBefore, overdueAlerts, reminderEmail,
  };
  // Validates the amounts split into real installments (and the final date).
  buildSchedule({ principalCents, ratePct: interestRate || 0, method: interestMethod, count: installmentCount, frequency, anchorDate: firstDueDate });
  return normalized;
}

/** Live preview for the create form: the full schedule plus headline figures. */
export function previewLoan(normalized) {
  return buildSchedule({
    principalCents: normalized.principalCents, ratePct: normalized.interestRate || 0, method: normalized.interestMethod,
    count: normalized.installmentCount, frequency: normalized.frequency, anchorDate: normalized.firstDueDate,
  });
}

/** Validates a payment against the installment's remaining amount. */
export function normalizePaymentInput(input = {}, { today, startDate, remainingCents }) {
  const amountCents = toCents(input.amount);
  if (!Number.isFinite(amountCents)) throw new LoanValidationError("Enter the payment amount as a number with up to 2 decimals.", "amount");
  if (amountCents <= 0) throw new LoanValidationError("The payment must be more than zero.", "amount");
  if (amountCents > remainingCents) {
    throw new LoanValidationError(`This installment has ${fromCents(remainingCents).toFixed(2)} remaining. Record any extra against the next installment.`, "amount");
  }
  const paidOn = text(input.paidOn);
  if (!isDateString(paidOn)) throw new LoanValidationError("Enter the payment date.", "paidOn");
  if (today && paidOn > today) throw new LoanValidationError("The payment date can't be in the future.", "paidOn");
  if (startDate && paidOn < startDate) throw new LoanValidationError("The payment date can't be before the loan started.", "paidOn");
  const method = text(input.method);
  if (method.length > LOAN_LIMITS.paymentMethod) throw new LoanValidationError(`Keep the payment method under ${LOAN_LIMITS.paymentMethod} characters.`, "method");
  const reference = text(input.reference);
  if (reference.length > LOAN_LIMITS.paymentReference) throw new LoanValidationError(`Keep the reference under ${LOAN_LIMITS.paymentReference} characters.`, "reference");
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > LOAN_LIMITS.paymentNote) throw new LoanValidationError(`Keep notes under ${LOAN_LIMITS.paymentNote} characters.`, "notes");
  return { amountCents, paidOn, method, reference, notes };
}

// ---------------------------------------------------------------------------
// Status and summaries
// ---------------------------------------------------------------------------

export const remainingOf = (installment) => Math.max(0, installment.amountCents - installment.paidCents);

/** "paid" | "overdue" | "partial" | "due" | "upcoming" for one installment on `today`. */
export function installmentStatus(installment, today, frequency) {
  const remaining = remainingOf(installment);
  if (remaining === 0) return "paid";
  if (installment.dueDate < today) return "overdue";
  if (installment.paidCents > 0) return "partial";
  const window = DUE_WINDOW_DAYS[frequency] ?? 7;
  return daysBetween(today, installment.dueDate) <= window ? "due" : "upcoming";
}

/**
 * Repayment summary of one loan.
 * state: "closed" | "completed" | "overdue" | "active" (overdue = active with an overdue installment).
 */
export function summarizeLoan(loan, installments, today) {
  let scheduledCents = 0;
  let paidCents = 0;
  let paidCount = 0;
  let overdueCount = 0;
  let overdueCents = 0;
  let next = null;
  for (const installment of installments) {
    scheduledCents += installment.amountCents;
    paidCents += installment.paidCents;
    const remaining = remainingOf(installment);
    if (remaining === 0) { paidCount += 1; continue; }
    if (installment.dueDate < today) { overdueCount += 1; overdueCents += remaining; }
    if (!next || installment.number < next.number) next = installment;
  }
  const outstandingCents = Math.max(0, scheduledCents - paidCents);
  const closed = loan.status === "closed";
  const completed = loan.status === "completed";
  const state = closed ? "closed" : completed ? "completed" : overdueCount ? "overdue" : "active";
  return {
    scheduledCents, paidCents, outstandingCents, paidCount, total: installments.length,
    overdueCount: closed ? 0 : overdueCount, overdueCents: closed ? 0 : overdueCents,
    next: closed || completed ? null : next,
    nextStatus: !closed && !completed && next ? installmentStatus(next, today, loan.frequency) : null,
    progress: scheduledCents ? Math.min(1, paidCents / scheduledCents) : 0,
    writtenOffCents: closed ? outstandingCents : 0,
    state,
  };
}

// ---------------------------------------------------------------------------
// Editing and recalculation
// ---------------------------------------------------------------------------

export const SCHEDULE_FIELDS = Object.freeze(["principalCents", "interestMethod", "interestRate", "installmentCount", "frequency", "firstDueDate"]);

/** Whether the edit changes the repayment schedule (needs preview + confirmation). */
export function isScheduleChange(loan, normalized, { nextDueDate = null, currentNextDueDate = null } = {}) {
  if (normalized.principalCents !== loan.principalCents) return true;
  if (normalized.interestMethod !== loan.interestMethod) return true;
  if ((normalized.interestRate || 0) !== (loan.interestRate || 0)) return true;
  if (normalized.installmentCount !== loan.installmentCount) return true;
  if (normalized.frequency !== loan.frequency) return true;
  if (normalized.firstDueDate !== loan.firstDueDate) return true;
  return Boolean(nextDueDate && nextDueDate !== currentNextDueDate);
}

/**
 * How many leading installments are locked: everything up to the highest
 * numbered installment that already has a payment record (even a reversed one)
 * or whose due date has passed. Locked installments are never rewritten.
 */
export function lockedCount(installments, today) {
  let locked = 0;
  for (const installment of installments) {
    if ((installment.paymentCount || 0) > 0 || installment.paidCents > 0 || installment.dueDate < today) locked = Math.max(locked, installment.number);
  }
  return locked;
}

/**
 * Plans a schedule recalculation for an edit. Locked installments stay exactly
 * as they are; the remaining principal (new principal − principal covered by
 * the locked installments) is re-scheduled over the remaining installments with
 * the new method, rate and frequency, starting at `nextDueDate`.
 */
export function planRecalculation(loan, installments, normalized, { today, nextDueDate = null }) {
  const sorted = [...installments].sort((a, b) => a.number - b.number);
  const locked = lockedCount(sorted, today);
  const lockedRows = sorted.filter((row) => row.number <= locked);
  const lockedPrincipalCents = lockedRows.reduce((sum, row) => sum + row.principalCents, 0);
  const lockedTotalCents = lockedRows.reduce((sum, row) => sum + row.amountCents, 0);
  const previousFuture = sorted.filter((row) => row.number > locked);
  let anchorDate;
  let anchorNumber;
  let schedule;
  if (locked === 0) {
    anchorDate = normalized.firstDueDate;
    anchorNumber = 1;
    schedule = buildSchedule({
      principalCents: normalized.principalCents, ratePct: normalized.interestRate || 0, method: normalized.interestMethod,
      count: normalized.installmentCount, frequency: normalized.frequency, anchorDate, anchorNumber,
    });
  } else {
    if (normalized.firstDueDate !== loan.firstDueDate) throw new LoanValidationError("Installments have already been paid or passed, so the first installment date can't change. Set the next installment date instead.", "firstDueDate");
    const remainingCount = normalized.installmentCount - locked;
    if (remainingCount < 1) throw new LoanValidationError(`Use more than ${locked} installments: installments 1–${locked} are already paid or past due.`, "installmentCount");
    const remainingPrincipalCents = normalized.principalCents - lockedPrincipalCents;
    if (remainingPrincipalCents <= 0) {
      throw new LoanValidationError(`The amount must be more than the ${fromCents(lockedPrincipalCents).toFixed(2)} principal already scheduled in installments 1–${locked}.`, "principal");
    }
    const lastLocked = lockedRows[lockedRows.length - 1];
    const sameRhythm = normalized.frequency === loan.frequency;
    const currentNext = previousFuture[0]?.dueDate || null;
    const defaultNext = sameRhythm ? dueDateFor(loan.anchorDate, loan.anchorNumber, loan.frequency, locked + 1) : addPeriods(lastLocked.dueDate, normalized.frequency, 1);
    const next = nextDueDate || (sameRhythm && currentNext ? currentNext : defaultNext);
    if (!isDateString(next)) throw new LoanValidationError("Enter the next installment date.", "nextDueDate");
    if (next <= lastLocked.dueDate) throw new LoanValidationError(`The next installment must be after installment ${locked} (${lastLocked.dueDate}).`, "nextDueDate");
    if (next < today) throw new LoanValidationError("The next installment date can't be in the past.", "nextDueDate");
    if (sameRhythm && next === dueDateFor(loan.anchorDate, loan.anchorNumber, loan.frequency, locked + 1)) {
      anchorDate = loan.anchorDate;
      anchorNumber = loan.anchorNumber;
    } else {
      anchorDate = next;
      anchorNumber = locked + 1;
    }
    schedule = buildSchedule({
      principalCents: remainingPrincipalCents, ratePct: normalized.interestRate || 0, method: normalized.interestMethod,
      count: remainingCount, frequency: normalized.frequency, anchorDate, anchorNumber, startNumber: locked + 1,
    });
  }
  const futureTotalCents = schedule.totalCents;
  return {
    lockedCount: locked,
    lockedPrincipalCents,
    lockedTotalCents,
    remainingPrincipalCents: schedule.principalCents,
    future: schedule.installments,
    anchorDate,
    anchorNumber,
    previousFutureCount: previousFuture.length,
    previousFutureTotalCents: previousFuture.reduce((sum, row) => sum + row.amountCents, 0),
    futureTotalCents,
    newScheduledTotalCents: lockedTotalCents + futureTotalCents,
    newInterestCents: lockedRows.reduce((sum, row) => sum + row.interestCents, 0) + schedule.interestCents,
    regularCents: schedule.regularCents,
    finalCents: schedule.finalCents,
    nextDueDate: schedule.firstDueDate,
    finalDueDate: schedule.finalDueDate,
  };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/** Dedupe key: each installment gets at most one upcoming and one overdue alert. */
export const loanReminderDedupeKey = (installmentId, kind) => `loan:${installmentId}:${kind}`;

/**
 * Whether a claimed reminder should still be delivered. Never changes
 * payments: a reminder for an installment that was paid (or a loan that was
 * completed, closed or had reminders turned off) is skipped, not "completed".
 */
export function reminderDecision(reminder, loan, installment, today) {
  if (!loan || !installment) return { deliver: false, note: "The installment is no longer part of the loan." };
  if (loan.status !== "active") return { deliver: false, note: `The loan is ${loan.status}.` };
  if (remainingOf(installment) === 0) return { deliver: false, note: "The installment is already paid." };
  if (reminder.kind === "upcoming") {
    if (loan.reminderDaysBefore === null || loan.reminderDaysBefore === undefined) return { deliver: false, note: "Upcoming reminders were turned off." };
    if (installment.dueDate !== reminder.dueDate) return { deliver: false, note: "The installment's due date changed." };
    if (installment.dueDate < today) return { deliver: false, note: "The installment is already overdue." };
    return { deliver: true, note: null };
  }
  if (reminder.kind === "overdue") {
    if (!loan.overdueAlerts) return { deliver: false, note: "Overdue alerts were turned off." };
    if (installment.dueDate >= today) return { deliver: false, note: "The installment isn't overdue." };
    return { deliver: true, note: null };
  }
  return { deliver: false, note: "Unknown reminder." };
}
