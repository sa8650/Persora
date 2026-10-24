// Persora Loan Tracker — browser client for /api/loans/*.
import type { InstallmentStatus, InterestMethod, LoanDirection, LoanFrequency, LoanInput, LoanState, LoanStatus } from "../../cloudflare/loan-rules.js";
import { pagesApiJson } from "./cloud";

export interface LoanInstallment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  amount: number;
  paid: number;
  remaining: number;
  status: InstallmentStatus;
  paymentCount: number;
  scheduleVersion: number;
}

export interface LoanSummaryView {
  scheduled: number;
  paid: number;
  outstanding: number;
  installmentsTotal: number;
  paidCount: number;
  overdueCount: number;
  overdueAmount: number;
  writtenOff: number;
  progress: number;
  state: LoanState;
  next: LoanInstallment | null;
}

export interface LoanTermsSnapshot {
  principal?: number;
  interestMethod?: InterestMethod;
  interestRate?: number | null;
  installmentCount?: number;
  frequency?: LoanFrequency;
  startDate?: string;
  firstDueDate?: string;
  finalDueDate?: string;
  nextDueDate?: string;
  totalInterest?: number;
  totalRepayment?: number;
  regularInstallment?: number;
  finalInstallment?: number;
  scheduledTotal?: number;
  recordedAt?: string;
}

export interface LoanScheduleChange {
  at: string;
  lockedCount: number;
  previous: LoanTermsSnapshot;
  next: LoanTermsSnapshot;
}

export interface Loan {
  id: string;
  name: string;
  direction: LoanDirection;
  partyName: string;
  borrowerName: string;
  currency: string;
  principal: number;
  interestMethod: InterestMethod;
  interestRate: number | null;
  installmentCount: number;
  frequency: LoanFrequency;
  startDate: string;
  firstDueDate: string;
  anchorDate: string;
  anchorNumber: number;
  reference: string;
  notes: string;
  documentIds: string[];
  reminderDaysBefore: number | null;
  overdueAlerts: boolean;
  reminderEmail: boolean;
  status: LoanStatus;
  completedAt: string | null;
  closedAt: string | null;
  closeNote: string | null;
  originalTerms: LoanTermsSnapshot;
  scheduleChanges: LoanScheduleChange[];
  scheduleVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  summary: LoanSummaryView;
}

export interface LoanPayment {
  id: string;
  installmentId: string;
  amount: number;
  paidOn: string;
  method: string;
  reference: string;
  notes: string;
  status: "recorded" | "reversed";
  reversedAt: string | null;
  reversalReason: string | null;
  correctsPaymentId: string | null;
  createdAt: string;
}

export interface EmailAvailability { available: boolean; reason: string | null }

export interface LoansPayload {
  timeZone: string;
  today: string;
  email: EmailAvailability;
  limits: { loans: number; installments: number };
  currencies: string[];
  loans: Loan[];
}

export interface LoanDetail {
  timeZone: string;
  today: string;
  email: EmailAvailability;
  loan: Loan;
  installments: LoanInstallment[];
  payments: LoanPayment[];
}

export interface LoanReminder {
  id: string;
  loanId: string;
  installmentId: string;
  kind: "upcoming" | "overdue";
  loanName: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  currency: string;
  remindAt: string;
  readAt: string | null;
}

export interface LoanImportResult {
  loansCreated: number;
  loansMatched: number;
  loansSkipped: number;
  installmentsAdded: number;
  paymentsAdded: number;
}

export interface PaymentInput {
  id: string;
  amount: string | number;
  paidOn: string;
  method?: string;
  reference?: string;
  notes?: string;
}

/** Dispatched on window after loan changes, so reminders refresh immediately. */
export const LOANS_CHANGED_EVENT = "persora-loans-changed";
/** Dispatched on window after a backup restore, so an open Loan Tracker reloads. */
export const LOANS_RESTORED_EVENT = "persora-loans-restored";

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
});
const loanPath = (id: string) => `/loans/${encodeURIComponent(id)}`;

export async function loadLoans(signal?: AbortSignal): Promise<LoansPayload> {
  const body = await pagesApiJson<LoansPayload>("/loans", { signal });
  return { ...body, loans: Array.isArray(body.loans) ? body.loans : [], currencies: Array.isArray(body.currencies) ? body.currencies : [] };
}

export function loadLoan(id: string, signal?: AbortSignal): Promise<LoanDetail> {
  return pagesApiJson<LoanDetail>(loanPath(id), { signal });
}

export function createLoan(input: LoanInput & { id: string }): Promise<LoanDetail> {
  return pagesApiJson("/loans", jsonInit("POST", input));
}

/**
 * Saves edits. A change to the schedule terms is refused with 428
 * (requiresConfirmation) unless `recalculate` is true — the editor first shows
 * the recalculated future installments and asks for confirmation.
 */
export function updateLoan(id: string, input: LoanInput, revision: number, options: { recalculate?: boolean; nextDueDate?: string | null } = {}): Promise<LoanDetail> {
  return pagesApiJson(loanPath(id), jsonInit("PATCH", { ...input, revision, ...options }));
}

export async function deleteLoan(id: string): Promise<void> {
  await pagesApiJson(loanPath(id), { method: "DELETE" });
}

export function setLoanStatus(id: string, action: "complete" | "close" | "reopen", note?: string): Promise<LoanDetail> {
  return pagesApiJson(`${loanPath(id)}/${action}`, jsonInit("POST", note === undefined ? {} : { note }));
}

export function recordLoanPayment(loanId: string, installmentId: string, payment: PaymentInput): Promise<LoanDetail> {
  return pagesApiJson(`${loanPath(loanId)}/installments/${encodeURIComponent(installmentId)}/payments`, jsonInit("POST", payment));
}

export function reverseLoanPayment(loanId: string, paymentId: string, reason: string): Promise<LoanDetail> {
  return pagesApiJson(`${loanPath(loanId)}/payments/${encodeURIComponent(paymentId)}/reverse`, jsonInit("POST", { reason }));
}

/** Reverses a payment (kept in history) and records the corrected one, atomically. */
export function correctLoanPayment(loanId: string, paymentId: string, reason: string, payment: PaymentInput): Promise<LoanDetail> {
  return pagesApiJson(`${loanPath(loanId)}/payments/${encodeURIComponent(paymentId)}/correct`, jsonInit("POST", { ...payment, reason }));
}

export async function loadLoanReminders(): Promise<LoanReminder[]> {
  const body = await pagesApiJson<{ reminders: LoanReminder[] }>("/loans/reminders");
  return Array.isArray(body.reminders) ? body.reminders : [];
}

export async function markLoanReminderRead(id?: string): Promise<void> {
  await pagesApiJson(id ? `/loans/reminders/${encodeURIComponent(id)}` : "/loans/reminders", { method: "PATCH" });
}

/** Restores loans, installments and payments from a complete Persora backup's rows. */
export function importLoanBackup(loans: unknown[], installments: unknown[], payments: unknown[]): Promise<LoanImportResult> {
  return pagesApiJson("/loans/import", jsonInit("POST", { loans, installments, payments }));
}
