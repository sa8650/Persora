// Persora Loan Tracker — Pages API routes, reminder dispatcher, backup/restore.
//
// Every route runs for the signed-in member only (api.js authorizes first) and
// every database call passes that member's id, which the SQL functions in
// supabase/schema.sql use to scope each statement.
// Input is validated here with the shared rules (cloudflare/loan-rules.js) and
// again by the database (row locks, constraints, remaining-balance checks).
//
// Reminders reuse the calendar's pipeline: the same cron ping and internal
// endpoint (api.js), the same email service and the same in-app bell. A due
// reminder is skipped when its installment was paid meanwhile; reminders never
// record or change payments.

import { emailAvailability } from "./calendar.js";
import { isDateString, localDateOf, safeTimeZone } from "./calendar-rules.js";
import {
  INTEREST_METHODS, LOAN_CURRENCIES, installmentStatus, LOAN_DIRECTIONS, LOAN_FREQUENCIES, LOAN_LIMITS, LoanValidationError, fromCents, isScheduleChange, lockedCount,
  normalizeLoanInput, normalizePaymentInput, planRecalculation, previewLoan, reminderDecision, summarizeLoan, toCents,
} from "./loan-rules.js";

export const LOANS_ROUTE_PREFIX = "/loans";
const DISPATCH_INTERVAL_MS = 60_000;
const BELL_WINDOW_MS = 72 * 3_600_000;
const LATE_EMAIL_MS = 12 * 3_600_000;
const MAX_IMPORT_BYTES = 24 * 1024 * 1024;
const IMPORT_BATCH = 10;

export class LoanError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------------------
// HTTP + database plumbing (same conventions as the calendar and habit modules)
// ---------------------------------------------------------------------------

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
    },
  });
}
function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}
function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new LoanError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "23514" || code === "22007" || code === "22008" || code === "22P02" || code === "22003") return new LoanError("Those loan details aren't valid. Check them and try again.", 400);
  if (code === "23505") return new LoanError("That change conflicts with another one. Reload and try again.", 409);
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") {
    return new LoanError("Loan Tracker needs the Persora database schema (supabase/schema.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora Loan Tracker database request failed", response.status, code, message);
  return new LoanError("The loan database could not complete the request. Please try again shortly.", 502);
}
async function rpc(name, args, env) {
  const response = await fetch(dbUrl(env, `rpc/${name}`), {
    method: "POST", headers: dbHeaders(env, { "Content-Type": "application/json" }), body: JSON.stringify(args),
  });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}
async function readBody(request, limit = 64 * 1024) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new LoanError("Send the request as JSON.", 415);
  const text = await request.text();
  if (text.length > limit) throw new LoanError("That request is too large.", 413);
  try { return JSON.parse(text || "{}"); } catch { throw new LoanError("The request body isn't valid JSON.", 400); }
}
export function isUuid(value) {
  // Any UUID shape: restored loans can carry md5-derived ids (no version bits).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}
const requireUuid = (value, message) => {
  if (!isUuid(value)) throw new LoanError(message, 404);
  return String(value).toLowerCase();
};

// ---------------------------------------------------------------------------
// Row <-> API shapes
// ---------------------------------------------------------------------------

const dateOnly = (value) => (value ? String(value).slice(0, 10) : null);
const instant = (value) => {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
/** numeric(14,2) from PostgREST (number or string) → integer cents. */
const centsOf = (value) => {
  const cents = toCents(typeof value === "string" ? value : Number(value || 0));
  return Number.isFinite(cents) ? cents : Math.round(Number(value || 0) * 100);
};
/** Integer cents → exact "1234.56" for the database. */
export function decimal(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
const zoneOf = (identity) => safeTimeZone(identity.timezone, "UTC");
const todayOf = (identity, nowMs = Date.now()) => localDateOf(nowMs, zoneOf(identity));

/** Database row → API loan (camelCase; amounts as numbers with 2 decimals). */
export function loanFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    direction: row.direction,
    partyName: row.party_name,
    borrowerName: row.borrower_name,
    currency: row.currency,
    principal: fromCents(centsOf(row.principal)),
    interestMethod: row.interest_method,
    interestRate: row.interest_rate === null || row.interest_rate === undefined ? null : Number(row.interest_rate),
    installmentCount: Number(row.installment_count),
    frequency: row.frequency,
    startDate: dateOnly(row.start_date),
    firstDueDate: dateOnly(row.first_due_date),
    anchorDate: dateOnly(row.anchor_date),
    anchorNumber: Number(row.anchor_number) || 1,
    reference: row.reference || "",
    notes: row.notes || "",
    documentIds: Array.isArray(row.document_ids) ? row.document_ids.map(String) : [],
    reminderDaysBefore: row.reminder_days_before === null || row.reminder_days_before === undefined ? null : Number(row.reminder_days_before),
    overdueAlerts: Boolean(row.overdue_alerts),
    reminderEmail: Boolean(row.reminder_email),
    status: row.status,
    completedAt: row.completed_at ? instant(row.completed_at) : null,
    closedAt: row.closed_at ? instant(row.closed_at) : null,
    closeNote: row.close_note || null,
    originalTerms: row.original_terms && typeof row.original_terms === "object" ? row.original_terms : {},
    scheduleChanges: Array.isArray(row.schedule_changes) ? row.schedule_changes : [],
    scheduleVersion: Number(row.schedule_version) || 1,
    revision: Number(row.revision) || 1,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}

function installmentCentsFromRow(row) {
  return {
    id: row.id,
    number: Number(row.number),
    dueDate: dateOnly(row.due_date),
    principalCents: centsOf(row.principal_amount),
    interestCents: centsOf(row.interest_amount),
    amountCents: centsOf(row.amount),
    paidCents: centsOf(row.paid_amount),
    paymentCount: Number(row.payment_count) || 0,
    scheduleVersion: Number(row.schedule_version) || 1,
  };
}
function installmentToApi(inst, today, frequency) {
  const remaining = Math.max(0, inst.amountCents - inst.paidCents);
  const status = installmentStatus(inst, today, frequency);
  return {
    id: inst.id, number: inst.number, dueDate: inst.dueDate,
    principal: fromCents(inst.principalCents), interest: fromCents(inst.interestCents), amount: fromCents(inst.amountCents),
    paid: fromCents(inst.paidCents), remaining: fromCents(remaining), status, paymentCount: inst.paymentCount, scheduleVersion: inst.scheduleVersion,
  };
}
export function paymentFromRow(row) {
  return {
    id: row.id, installmentId: row.installment_id, amount: fromCents(centsOf(row.amount)), paidOn: dateOnly(row.paid_on),
    method: row.method || "", reference: row.reference || "", notes: row.notes || "", status: row.status,
    reversedAt: row.reversed_at ? instant(row.reversed_at) : null, reversalReason: row.reversal_reason || null,
    correctsPaymentId: row.corrects_payment_id || null, createdAt: instant(row.created_at),
  };
}
function summaryToApi(summary, today, frequency) {
  return {
    scheduled: fromCents(summary.scheduledCents), paid: fromCents(summary.paidCents), outstanding: fromCents(summary.outstandingCents),
    installmentsTotal: summary.total, paidCount: summary.paidCount, overdueCount: summary.overdueCount, overdueAmount: fromCents(summary.overdueCents),
    writtenOff: fromCents(summary.writtenOffCents), progress: summary.progress, state: summary.state,
    next: summary.next ? installmentToApi(summary.next, today, frequency) : null,
  };
}

/** Loan terms in cents for the shared rules. */
function termsOf(loan) {
  return {
    principalCents: toCents(loan.principal), interestMethod: loan.interestMethod, interestRate: loan.interestRate,
    installmentCount: loan.installmentCount, frequency: loan.frequency, firstDueDate: loan.firstDueDate,
    anchorDate: loan.anchorDate, anchorNumber: loan.anchorNumber,
  };
}

/** API values for the SQL functions (snake_case, exact decimals). */
function loanValues(normalized) {
  return {
    name: normalized.name, direction: normalized.direction, party_name: normalized.partyName, borrower_name: normalized.borrowerName,
    currency: normalized.currency, principal: decimal(normalized.principalCents), interest_method: normalized.interestMethod,
    interest_rate: normalized.interestRate === null ? null : String(normalized.interestRate), installment_count: normalized.installmentCount,
    frequency: normalized.frequency, start_date: normalized.startDate, first_due_date: normalized.firstDueDate,
    reference: normalized.reference, notes: normalized.notes, document_ids: normalized.documentIds,
    reminder_days_before: normalized.reminderDaysBefore, overdue_alerts: normalized.overdueAlerts, reminder_email: normalized.reminderEmail,
  };
}
const scheduleRows = (installments) => installments.map((row) => ({
  number: row.number, due_date: row.dueDate, principal: decimal(row.principalCents), interest: decimal(row.interestCents), amount: decimal(row.amountCents),
}));
const termsSnapshot = (terms, extra = {}) => ({
  principal: fromCents(terms.principalCents), interestMethod: terms.interestMethod, interestRate: terms.interestRate,
  installmentCount: terms.installmentCount, frequency: terms.frequency, ...extra,
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadDetail(identity, id, env, services = {}) {
  const today = todayOf(identity);
  const data = await rpc("persora_loan_get", { p_owner: identity.id, p_id: id }, env);
  const loan = loanFromRow(data.loan);
  const installments = (Array.isArray(data.installments) ? data.installments : []).map(installmentCentsFromRow);
  const summary = summarizeLoan(loan, installments, today);
  return {
    timeZone: zoneOf(identity),
    today,
    email: emailAvailability(identity, services),
    loan: { ...loan, summary: summaryToApi(summary, today, loan.frequency) },
    installments: installments.map((row) => installmentToApi(row, today, loan.frequency)),
    payments: (Array.isArray(data.payments) ? data.payments : []).map(paymentFromRow),
    _cents: { loan, installments },
  };
}
const publicDetail = ({ _cents, ...detail }) => detail;

async function listLoans(identity, env, services) {
  const today = todayOf(identity);
  const rows = await rpc("persora_loans_list", { p_owner: identity.id, p_today: today }, env);
  const loans = (Array.isArray(rows) ? rows : []).map((row) => {
    const loan = loanFromRow(row);
    const scheduledCents = centsOf(row.scheduled_total);
    const paidCents = centsOf(row.paid_total);
    const next = row.next_installment ? installmentCentsFromRow(row.next_installment) : null;
    const closed = loan.status === "closed";
    const completed = loan.status === "completed";
    const overdueCount = closed ? 0 : Number(row.overdue_count) || 0;
    const summary = {
      scheduledCents, paidCents, outstandingCents: Math.max(0, scheduledCents - paidCents), total: Number(row.installments_total) || 0,
      paidCount: Number(row.paid_count) || 0, overdueCount, overdueCents: closed ? 0 : centsOf(row.overdue_amount),
      writtenOffCents: closed ? Math.max(0, scheduledCents - paidCents) : 0,
      progress: scheduledCents ? Math.min(1, paidCents / scheduledCents) : 0,
      state: closed ? "closed" : completed ? "completed" : overdueCount ? "overdue" : "active",
      next: closed || completed ? null : next,
    };
    return { ...loan, summary: summaryToApi(summary, today, loan.frequency) };
  });
  return {
    timeZone: zoneOf(identity), today, email: emailAvailability(identity, services),
    limits: { loans: LOAN_LIMITS.loans, installments: LOAN_LIMITS.installmentsMax },
    currencies: LOAN_CURRENCIES, loans,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function createLoan(identity, body, env, services) {
  const id = body?.id === undefined || body?.id === null ? crypto.randomUUID() : String(body.id).toLowerCase();
  if (!isUuid(id)) throw new LoanError("That loan id isn't valid.", 400);
  const normalized = normalizeLoanInput(body);
  const schedule = previewLoan(normalized);
  const values = {
    ...loanValues(normalized),
    original_terms: termsSnapshot(normalized, {
      startDate: normalized.startDate, firstDueDate: normalized.firstDueDate, finalDueDate: schedule.finalDueDate,
      totalInterest: fromCents(schedule.interestCents), totalRepayment: fromCents(schedule.totalCents),
      regularInstallment: fromCents(schedule.regularCents), finalInstallment: fromCents(schedule.finalCents), recordedAt: new Date().toISOString(),
    }),
  };
  const result = await rpc("persora_loan_create", { p_owner: identity.id, p_id: id, p_loan: values, p_installments: scheduleRows(schedule.installments) }, env);
  return { replayed: Boolean(result?.replayed), detail: publicDetail(await loadDetail(identity, id, env, services)) };
}

async function updateLoan(identity, id, body, env, services) {
  const expected = Number(body?.revision);
  if (!Number.isInteger(expected) || expected < 1) throw new LoanError("Reload the loan before saving changes.", 409);
  const current = await loadDetail(identity, id, env, services);
  const { loan, installments } = current._cents;
  const today = current.today;
  const normalized = normalizeLoanInput(body);
  const terms = termsOf(loan);
  const nextDueDate = body?.nextDueDate ? String(body.nextDueDate) : null;
  if (nextDueDate && !isDateString(nextDueDate)) throw new LoanValidationError("Enter the next installment date.", "nextDueDate");
  const locked = lockedCount(installments, today);
  const currentNextDueDate = installments.find((row) => row.number === locked + 1)?.dueDate || null;
  const changes = isScheduleChange(terms, normalized, { nextDueDate: locked > 0 ? nextDueDate : null, currentNextDueDate });
  let recalc = null;
  if (changes) {
    if (body?.recalculate !== true) throw new LoanError("Review and confirm the new installment schedule first.", 428, { requiresConfirmation: true });
    const plan = planRecalculation(terms, installments, normalized, { today, nextDueDate: locked > 0 ? nextDueDate : null });
    recalc = {
      locked_count: plan.lockedCount,
      anchor_date: plan.anchorDate,
      anchor_number: plan.anchorNumber,
      installments: scheduleRows(plan.future),
      change: {
        at: new Date().toISOString(),
        lockedCount: plan.lockedCount,
        previous: termsSnapshot(terms, { scheduledTotal: fromCents(installments.reduce((sum, row) => sum + row.amountCents, 0)) }),
        next: termsSnapshot(normalized, { scheduledTotal: fromCents(plan.newScheduledTotalCents), nextDueDate: plan.nextDueDate, finalDueDate: plan.finalDueDate }),
      },
    };
  }
  await rpc("persora_loan_update", {
    p_owner: identity.id, p_id: id, p_expected_revision: expected, p_loan: loanValues(normalized), p_recalc: recalc, p_today: today,
  }, env);
  return publicDetail(await loadDetail(identity, id, env, services));
}

async function setStatus(identity, id, action, body, env, services) {
  let note = null;
  if (action === "close") {
    note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) throw new LoanValidationError("Add a settlement note explaining why the loan is closed.", "note");
    if (note.length > LOAN_LIMITS.closeNote) throw new LoanValidationError(`Keep the note under ${LOAN_LIMITS.closeNote} characters.`, "note");
  }
  await rpc("persora_loan_set_status", { p_owner: identity.id, p_id: id, p_action: action, p_note: note }, env);
  return publicDetail(await loadDetail(identity, id, env, services));
}

function paymentArgs(body, identity) {
  const id = String(body?.id || "").toLowerCase();
  if (!isUuid(id)) throw new LoanError("Each payment needs a unique id. Reload and try again.", 400);
  // Remaining-balance and start-date checks run in the database under a row lock.
  const payment = normalizePaymentInput(body, { today: todayOf(identity), remainingCents: Number.MAX_SAFE_INTEGER });
  return {
    id, amount: decimal(payment.amountCents), paid_on: payment.paidOn, method: payment.method, reference: payment.reference, notes: payment.notes,
  };
}

async function recordPayment(identity, loanId, installmentId, body, env, services) {
  const payment = paymentArgs(body, identity);
  const result = await rpc("persora_loan_pay", {
    p_owner: identity.id, p_loan: loanId, p_installment: installmentId, p_payment: payment, p_today: todayOf(identity),
  }, env);
  return { replayed: Boolean(result?.replayed), detail: publicDetail(await loadDetail(identity, loanId, env, services)) };
}

async function reversePayment(identity, loanId, paymentId, body, env, services, { correct = false } = {}) {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw new LoanValidationError(correct ? "Say why this payment is being corrected." : "Say why this payment is being reversed.", "reason");
  if (reason.length > LOAN_LIMITS.reversalReason) throw new LoanValidationError(`Keep the reason under ${LOAN_LIMITS.reversalReason} characters.`, "reason");
  const correction = correct ? paymentArgs(body, identity) : null;
  const result = await rpc("persora_loan_reverse_payment", {
    p_owner: identity.id, p_loan: loanId, p_payment: paymentId, p_reason: reason, p_correction: correction, p_today: todayOf(identity),
  }, env);
  return { replayed: Boolean(result?.replayed), detail: publicDetail(await loadDetail(identity, loanId, env, services)) };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

function reminderFromRow(row) {
  return {
    id: row.id, loanId: row.loan_id, installmentId: row.installment_id, kind: row.kind, loanName: row.loan_name,
    installmentNumber: Number(row.installment_number), dueDate: dateOnly(row.due_date), amount: fromCents(centsOf(row.amount)),
    currency: row.currency, remindAt: instant(row.remind_at), readAt: row.read_at ? instant(row.read_at) : null,
  };
}
async function listReminders(identity, env) {
  const rows = await rpc("persora_loan_reminders_recent", { p_owner: identity.id, p_since: new Date(Date.now() - BELL_WINDOW_MS).toISOString() }, env);
  return { reminders: (Array.isArray(rows) ? rows : []).map(reminderFromRow), serverTime: new Date().toISOString() };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
export function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${Number(amount).toFixed(2)}`; }
}
/** Loan reminder email (plain text + simple HTML). */
export function loanReminderEmail(reminder, loan, installment, owner, appUrl) {
  const due = new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${installment.dueDate}T12:00:00Z`));
  const remaining = formatMoney(fromCents(Math.max(0, installment.amountCents - installment.paidCents)), loan.currency);
  const overdue = reminder.kind === "overdue";
  const heading = overdue ? `Installment ${installment.number} is overdue` : `Installment ${installment.number} is due ${reminder.daysBefore === 0 ? "today" : "soon"}`;
  const role = loan.direction === "lent" ? `Repayment from ${loan.borrowerName}` : `Payment to ${loan.partyName}`;
  const link = appUrl ? `${appUrl}&loan=${encodeURIComponent(loan.id)}` : "";
  const lines = [`${loan.name}: ${heading}`, `${role}`, `Due ${due} · ${remaining} remaining`, "",
    "You turned on reminders for this loan in Persora. Reminders never mark an installment as paid."];
  if (link) lines.push(`Open Loan Tracker: ${link}`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.5">
<p style="margin:0 0 4px;font-size:13px;color:#5f6368">Persora loan reminder</p>
<h2 style="margin:0 0 6px;font-size:18px">${escapeHtml(loan.name)}</h2>
<p style="margin:0;font-weight:bold;color:${overdue ? "#c5221f" : "#202124"}">${escapeHtml(heading)}</p>
<p style="margin:0">${escapeHtml(role)}</p>
<p style="margin:0">Due ${escapeHtml(due)} · ${escapeHtml(remaining)} remaining</p>
<p style="margin:14px 0 0;font-size:13px;color:#5f6368">You turned on reminders for this loan. Reminders never mark an installment as paid.</p>${link ? `<p style="margin:14px 0 0"><a href="${escapeHtml(link)}" style="color:#1a73e8">Open Loan Tracker</a></p>` : ""}
</div>`;
  return {
    to: owner.email, toName: owner.full_name,
    subject: `${overdue ? "Overdue" : "Due soon"}: ${loan.name} installment ${installment.number}`.slice(0, 200),
    textContent: lines.join("\n"), htmlContent: html,
  };
}

/**
 * Delivers due loan reminders. Safe to run concurrently and repeatedly: claims
 * are exclusive, completion requires the same claim, emails are sent at most
 * once, and each installment gets at most one upcoming and one overdue alert.
 */
export async function dispatchLoanReminders(env, services = {}, { owner = null, limit = 50, appUrl = "" } = {}) {
  const claimed = await rpc("persora_loan_claim_reminders", { p_limit: limit, p_owner: owner }, env);
  const summary = { claimed: 0, delivered: 0, skipped: 0, emailed: 0, emailFailed: 0, emailSkipped: 0 };
  for (const entry of Array.isArray(claimed) ? claimed : []) {
    const reminder = entry.reminder || {};
    const person = entry.owner || {};
    summary.claimed += 1;
    const now = Date.now();
    let loan = null;
    let installment = null;
    try {
      loan = loanFromRow(entry.loan);
      installment = installmentCentsFromRow(entry.installment);
    } catch (error) { console.error("Persora Loan Tracker received an invalid reminder row", error?.message || error); }
    const zone = safeTimeZone(person.timezone, safeTimeZone(reminder.time_zone, "UTC"));
    const today = localDateOf(now, zone);
    const decision = reminderDecision({ kind: reminder.kind, dueDate: dateOnly(reminder.due_date) }, loan, installment, today);
    let emailStatus = reminder.email_status === "failed" ? "failed" : "not_requested";
    let note = decision.note;
    if (reminder.email_status === "sending") {
      if (!decision.deliver) emailStatus = "skipped";
      else if (!person.active) { emailStatus = "skipped"; note = "The account isn't active."; }
      else if (!person.email_verified) { emailStatus = "skipped"; note = "The email address isn't verified."; }
      else if (now - Date.parse(reminder.remind_at) > LATE_EMAIL_MS) { emailStatus = "skipped"; note = "The reminder was processed too late to email."; }
      else if (typeof services.sendEmail !== "function" || !services.emailConfigured?.()) { emailStatus = "skipped"; note = "Email delivery isn't configured."; }
      else {
        try {
          await services.sendEmail(loanReminderEmail({ kind: reminder.kind, daysBefore: loan.reminderDaysBefore }, loan, installment, person, appUrl));
          emailStatus = "sent";
        } catch (error) {
          emailStatus = "failed";
          note = String(error?.message || "Email delivery failed.").slice(0, 200);
        }
      }
      if (emailStatus === "sent") summary.emailed += 1;
      else if (emailStatus === "failed") summary.emailFailed += 1;
      else summary.emailSkipped += 1;
    }
    if (decision.deliver) summary.delivered += 1; else summary.skipped += 1;
    await rpc("persora_loan_complete_reminder", {
      p_id: reminder.id, p_claimed_at: reminder.claimed_at, p_delivered: decision.deliver, p_email_status: emailStatus, p_note: note,
    }, env);
  }
  return summary;
}

let lastBackgroundDispatch = 0;
/** Opportunistic dispatch after signed-in requests (at most once a minute per isolate). */
export function scheduleLoanDispatch(env, ctx, services, appUrl = "") {
  if (Date.now() - lastBackgroundDispatch < DISPATCH_INTERVAL_MS) return;
  lastBackgroundDispatch = Date.now();
  const work = dispatchLoanReminders(env, services, { limit: 50, appUrl }).catch((error) => {
    if (!(error instanceof LoanError && error.status === 503)) console.error("Persora loan reminder dispatch failed", error?.message || error);
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
}

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

/** Loan data for the complete account export ([] lists before the migration is applied). */
export async function exportLoanData(userId, env) {
  try {
    const data = await rpc("persora_loans_export", { p_owner: userId }, env);
    return {
      loans: Array.isArray(data?.loans) ? data.loans : [],
      installments: Array.isArray(data?.installments) ? data.installments : [],
      payments: Array.isArray(data?.payments) ? data.payments : [],
      reminders: Array.isArray(data?.reminders) ? data.reminders : [],
    };
  } catch (error) {
    if (error instanceof LoanError && error.status === 503) return { loans: [], installments: [], payments: [], reminders: [] };
    throw error;
  }
}

/**
 * Validates one backed-up loan with its installments and payments. Returns the
 * import entry for persora_loans_import, or null when the loan is inconsistent
 * (it is then skipped and counted, never partially restored).
 */
export function importEntryFor(row, installmentRows, paymentRows) {
  if (!row || typeof row !== "object" || !isUuid(row.id)) return null;
  let normalized;
  try {
    normalized = normalizeLoanInput({
      name: row.name, direction: row.direction, partyName: row.party_name, borrowerName: row.borrower_name, currency: row.currency,
      principal: typeof row.principal === "number" ? row.principal : String(row.principal ?? ""), interestMethod: row.interest_method,
      interestRate: row.interest_rate === null || row.interest_rate === undefined ? null : String(Number(row.interest_rate)),
      installmentCount: Number(row.installment_count), frequency: row.frequency, startDate: dateOnly(row.start_date),
      firstDueDate: dateOnly(row.first_due_date), reference: row.reference, notes: row.notes, documentIds: Array.isArray(row.document_ids) ? row.document_ids : [],
      reminderDaysBefore: row.reminder_days_before, overdueAlerts: row.overdue_alerts, reminderEmail: row.reminder_email,
    });
  } catch (error) {
    if (error instanceof LoanValidationError) return null;
    throw error;
  }
  const anchorDate = dateOnly(row.anchor_date) || normalized.firstDueDate;
  const anchorNumber = Number(row.anchor_number) || 1;
  if (!isDateString(anchorDate) || !Number.isInteger(anchorNumber) || anchorNumber < 1 || anchorNumber > normalized.installmentCount) return null;
  if (!INTEREST_METHODS.includes(normalized.interestMethod) || !LOAN_FREQUENCIES.includes(normalized.frequency) || !LOAN_DIRECTIONS.includes(normalized.direction)) return null;

  const installments = [...installmentRows].sort((a, b) => Number(a.number) - Number(b.number));
  if (installments.length !== normalized.installmentCount) return null;
  const byId = new Map();
  for (const [index, inst] of installments.entries()) {
    const principal = centsOf(inst.principal_amount);
    const interest = centsOf(inst.interest_amount);
    const amount = centsOf(inst.amount);
    if (!isUuid(inst.id) || Number(inst.number) !== index + 1 || !isDateString(dateOnly(inst.due_date))) return null;
    if (!(amount > 0) || principal < 0 || interest < 0 || principal + interest !== amount) return null;
    if (index > 0 && dateOnly(inst.due_date) <= dateOnly(installments[index - 1].due_date)) return null;
    byId.set(String(inst.id).toLowerCase(), { inst, amount, paid: 0 });
  }
  const payments = [];
  for (const payment of [...paymentRows].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))) {
    const target = byId.get(String(payment.installment_id || "").toLowerCase());
    const amount = centsOf(payment.amount);
    const status = payment.status === "reversed" ? "reversed" : payment.status === "recorded" ? "recorded" : null;
    if (!target || !isUuid(payment.id) || !(amount > 0) || !status || !isDateString(dateOnly(payment.paid_on))) return null;
    if (status === "reversed" && !instant(payment.reversed_at)) return null;
    if (status === "recorded") target.paid += amount;
    payments.push({
      source_id: String(payment.id).toLowerCase(), installment_source_id: String(payment.installment_id).toLowerCase(), amount: decimal(amount),
      paid_on: dateOnly(payment.paid_on), method: String(payment.method || "").slice(0, LOAN_LIMITS.paymentMethod),
      reference: String(payment.reference || "").slice(0, LOAN_LIMITS.paymentReference), notes: String(payment.notes || "").slice(0, LOAN_LIMITS.paymentNote),
      status, reversed_at: status === "reversed" ? instant(payment.reversed_at) : null,
      reversal_reason: status === "reversed" ? String(payment.reversal_reason || "Reversed").slice(0, LOAN_LIMITS.reversalReason) : null,
      corrects_source_id: isUuid(payment.corrects_payment_id) ? String(payment.corrects_payment_id).toLowerCase() : null,
      created_at: instant(payment.created_at),
    });
  }
  for (const { amount, paid } of byId.values()) if (paid > amount) return null;
  return {
    source_id: String(row.id).toLowerCase(),
    values: {
      ...loanValues(normalized), anchor_date: anchorDate, anchor_number: anchorNumber,
      status: row.status === "closed" ? "closed" : row.status === "completed" ? "completed" : "active",
      closed_at: instant(row.closed_at), close_note: typeof row.close_note === "string" ? row.close_note.slice(0, LOAN_LIMITS.closeNote) : null,
      original_terms: row.original_terms && typeof row.original_terms === "object" && !Array.isArray(row.original_terms) ? row.original_terms : {},
      schedule_changes: Array.isArray(row.schedule_changes) ? row.schedule_changes.slice(-LOAN_LIMITS.scheduleChanges) : [],
      schedule_version: Number(row.schedule_version) || 1, created_at: instant(row.created_at),
    },
    installments: installments.map((inst) => {
      const entry = byId.get(String(inst.id).toLowerCase());
      return {
        source_id: String(inst.id).toLowerCase(), number: Number(inst.number), due_date: dateOnly(inst.due_date),
        principal: decimal(centsOf(inst.principal_amount)), interest: decimal(centsOf(inst.interest_amount)), amount: decimal(entry.amount),
        paid: decimal(entry.paid), schedule_version: Number(inst.schedule_version) || 1,
      };
    }),
    payments,
  };
}

/**
 * Restores loans from a Persora backup (`data.loans`, `data.loanInstallments`
 * and `data.loanPayments` of persora-export.json). Every loan is re-validated;
 * paid amounts are recomputed from the recorded payments.
 */
export async function importLoanData(identity, body, env) {
  const loansIn = Array.isArray(body?.loans) ? body.loans : null;
  if (!loansIn) throw new LoanError("This backup doesn't contain Loan Tracker data.", 400);
  if (loansIn.length > LOAN_LIMITS.loans) throw new LoanError(`A backup can restore up to ${LOAN_LIMITS.loans} loans.`, 400);
  const installmentsIn = Array.isArray(body?.installments) ? body.installments : [];
  const paymentsIn = Array.isArray(body?.payments) ? body.payments : [];
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = String(row?.loan_id || "").toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  };
  const installmentsBy = group(installmentsIn);
  const paymentsBy = group(paymentsIn);
  const entries = [];
  let invalid = 0;
  for (const row of loansIn) {
    const key = String(row?.id || "").toLowerCase();
    const entry = importEntryFor(row, installmentsBy.get(key) || [], paymentsBy.get(key) || []);
    if (entry) entries.push(entry); else invalid += 1;
  }
  const totals = { loansCreated: 0, loansMatched: 0, loansSkipped: invalid, installmentsAdded: 0, paymentsAdded: 0 };
  for (let index = 0; index < entries.length; index += IMPORT_BATCH) {
    const result = await rpc("persora_loans_import", { p_owner: identity.id, p_loans: entries.slice(index, index + IMPORT_BATCH) }, env);
    totals.loansCreated += Number(result?.loans_created) || 0;
    totals.loansMatched += Number(result?.loans_matched) || 0;
    totals.loansSkipped += Number(result?.loans_skipped) || 0;
    totals.installmentsAdded += Number(result?.installments_added) || 0;
    totals.paymentsAdded += Number(result?.payments_added) || 0;
  }
  return { ok: true, ...totals };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleLoans(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;
  const appUrl = `${url.origin}/?view=loans`;
  try {
    if (path === "/loans" && method === "GET") return json(await listLoans(identity, env, services), 200, origin);
    if (path === "/loans" && method === "POST") {
      const { replayed, detail } = await createLoan(identity, await readBody(request), env, services);
      return json(detail, replayed ? 200 : 201, origin);
    }
    if (path === "/loans/import" && method === "POST") return json(await importLoanData(identity, await readBody(request, MAX_IMPORT_BYTES), env), 200, origin);
    if (path === "/loans/reminders" && method === "GET") {
      // Deliver this member's due reminders first, so the bell never depends on
      // a background scheduler having run.
      try { await dispatchLoanReminders(env, services, { owner: identity.id, limit: 20, appUrl }); }
      catch (error) { if (!(error instanceof LoanError && error.status === 503)) console.error("Persora loan member dispatch failed", error?.message || error); }
      return json(await listReminders(identity, env), 200, origin);
    }
    if (path === "/loans/reminders" && method === "PATCH") {
      await rpc("persora_loan_reminders_mark_read", { p_owner: identity.id, p_id: null }, env);
      return json({ ok: true }, 200, origin);
    }
    const reminderMatch = path.match(/^\/loans\/reminders\/([^/]+)$/);
    if (reminderMatch && method === "PATCH") {
      const id = requireUuid(reminderMatch[1], "That reminder is no longer available.");
      await rpc("persora_loan_reminders_mark_read", { p_owner: identity.id, p_id: id }, env);
      return json({ ok: true }, 200, origin);
    }
    const payMatch = path.match(/^\/loans\/([^/]+)\/installments\/([^/]+)\/payments$/);
    if (payMatch && method === "POST") {
      const loanId = requireUuid(payMatch[1], "That loan is no longer available.");
      const installmentId = requireUuid(payMatch[2], "That installment is no longer part of this loan.");
      const { replayed, detail } = await recordPayment(identity, loanId, installmentId, await readBody(request), env, services);
      return json(detail, replayed ? 200 : 201, origin);
    }
    const paymentAction = path.match(/^\/loans\/([^/]+)\/payments\/([^/]+)\/(reverse|correct)$/);
    if (paymentAction && method === "POST") {
      const loanId = requireUuid(paymentAction[1], "That loan is no longer available.");
      const paymentId = requireUuid(paymentAction[2], "That payment is no longer available.");
      const { detail } = await reversePayment(identity, loanId, paymentId, await readBody(request), env, services, { correct: paymentAction[3] === "correct" });
      return json(detail, 200, origin);
    }
    const statusMatch = path.match(/^\/loans\/([^/]+)\/(complete|close|reopen)$/);
    if (statusMatch && method === "POST") {
      const loanId = requireUuid(statusMatch[1], "That loan is no longer available.");
      return json(await setStatus(identity, loanId, statusMatch[2], await readBody(request), env, services), 200, origin);
    }
    const loanMatch = path.match(/^\/loans\/([^/]+)$/);
    if (loanMatch) {
      const loanId = requireUuid(loanMatch[1], "That loan is no longer available.");
      if (method === "GET") return json(publicDetail(await loadDetail(identity, loanId, env, services)), 200, origin);
      if (method === "PATCH") return json(await updateLoan(identity, loanId, await readBody(request), env, services), 200, origin);
      if (method === "DELETE") {
        await rpc("persora_loan_delete", { p_owner: identity.id, p_id: loanId }, env);
        return json({ ok: true }, 200, origin);
      }
    }
    return json({ error: "Loan Tracker route not found." }, 404, origin);
  } catch (error) {
    if (error instanceof LoanValidationError) return json({ error: error.message, field: error.field || undefined }, 400, origin);
    if (error instanceof LoanError) return json({ error: error.message, ...error.extra }, error.status, origin);
    throw error;
  }
}
