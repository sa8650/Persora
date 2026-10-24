// Types for cloudflare/loan-rules.js (shared Loan Tracker rules).

export type LoanDirection = "borrowed" | "lent";
export type InterestMethod = "none" | "flat" | "reducing";
export type LoanFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type LoanStatus = "active" | "completed" | "closed";
export type InstallmentStatus = "paid" | "overdue" | "partial" | "due" | "upcoming";
export type LoanState = "closed" | "completed" | "overdue" | "active";

export const LOAN_DIRECTIONS: readonly LoanDirection[];
export const INTEREST_METHODS: readonly InterestMethod[];
export const LOAN_FREQUENCIES: readonly LoanFrequency[];
export const PERIODS_PER_YEAR: Readonly<Record<LoanFrequency, number>>;
export const DUE_WINDOW_DAYS: Readonly<Record<LoanFrequency, number>>;
export const REMINDER_DAY_OPTIONS: readonly number[];
export const LOAN_REMINDER_TIME: string;
export const LOAN_STATUSES: readonly LoanStatus[];
export const LOAN_CURRENCIES: readonly string[];
export const LOAN_LIMITS: Readonly<{
  loans: number; name: number; party: number; borrower: number; reference: number; notes: number; documents: number;
  installmentsMax: number; principalMaxCents: number; rateMax: number; paymentMethod: number; paymentReference: number;
  paymentNote: number; closeNote: number; reversalReason: number; scheduleChanges: number;
}>;

export class LoanValidationError extends Error {
  field: string | null;
  constructor(message: string, field?: string | null);
}

export function toCents(value: unknown): number;
export function fromCents(cents: number): number;
export function splitEvenly(total: number, count: number, options?: { minFinal?: number }): { regular: number; final: number };
export function addPeriods(date: string, frequency: LoanFrequency, count: number): string;
export function dueDateFor(anchorDate: string, anchorNumber: number, frequency: LoanFrequency, number: number): string;
export function periodicRate(ratePct: number, frequency: LoanFrequency): number;

export interface ScheduledInstallment {
  number: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
  amountCents: number;
}
export interface Schedule {
  installments: ScheduledInstallment[];
  principalCents: number;
  interestCents: number;
  totalCents: number;
  regularCents: number;
  finalCents: number;
  periodicRate: number;
  firstDueDate: string;
  finalDueDate: string;
}
export function buildSchedule(input: {
  principalCents: number; ratePct?: number; method?: InterestMethod; count: number; frequency: LoanFrequency;
  anchorDate: string; anchorNumber?: number; startNumber?: number;
}): Schedule;
export function calculationNote(method: InterestMethod, frequency: LoanFrequency): string;

export interface LoanInput {
  name?: unknown; direction?: unknown; partyName?: unknown; borrowerName?: unknown; currency?: unknown;
  principal?: unknown; interestMethod?: unknown; interestRate?: unknown; installmentCount?: unknown; frequency?: unknown;
  startDate?: unknown; firstDueDate?: unknown; reference?: unknown; notes?: unknown; documentIds?: unknown;
  reminderDaysBefore?: unknown; overdueAlerts?: unknown; reminderEmail?: unknown;
}
export interface NormalizedLoan {
  name: string; direction: LoanDirection; partyName: string; borrowerName: string; currency: string;
  principalCents: number; interestMethod: InterestMethod; interestRate: number | null; installmentCount: number;
  frequency: LoanFrequency; startDate: string; firstDueDate: string; reference: string; notes: string; documentIds: string[];
  reminderDaysBefore: number | null; overdueAlerts: boolean; reminderEmail: boolean;
}
export function normalizeLoanInput(input?: LoanInput): NormalizedLoan;
export function previewLoan(normalized: NormalizedLoan): Schedule;

export interface NormalizedPayment { amountCents: number; paidOn: string; method: string; reference: string; notes: string }
export function normalizePaymentInput(
  input: { amount?: unknown; paidOn?: unknown; method?: unknown; reference?: unknown; notes?: unknown },
  context: { today?: string; startDate?: string; remainingCents: number },
): NormalizedPayment;

export interface InstallmentLike {
  number: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
  amountCents: number;
  paidCents: number;
  paymentCount?: number;
}
export function remainingOf(installment: Pick<InstallmentLike, "amountCents" | "paidCents">): number;
export function installmentStatus(installment: Pick<InstallmentLike, "dueDate" | "amountCents" | "paidCents">, today: string, frequency: LoanFrequency): InstallmentStatus;

export interface LoanSummary<T extends InstallmentLike = InstallmentLike> {
  scheduledCents: number; paidCents: number; outstandingCents: number; paidCount: number; total: number;
  overdueCount: number; overdueCents: number; next: T | null; nextStatus: InstallmentStatus | null; progress: number;
  writtenOffCents: number; state: LoanState;
}
export function summarizeLoan<T extends InstallmentLike>(loan: { status: LoanStatus; frequency: LoanFrequency }, installments: T[], today: string): LoanSummary<T>;

export interface LoanTerms {
  principalCents: number; interestMethod: InterestMethod; interestRate: number | null; installmentCount: number;
  frequency: LoanFrequency; firstDueDate: string; anchorDate: string; anchorNumber: number;
}
export const SCHEDULE_FIELDS: readonly string[];
export function isScheduleChange(loan: LoanTerms, normalized: NormalizedLoan, options?: { nextDueDate?: string | null; currentNextDueDate?: string | null }): boolean;
export function lockedCount(installments: InstallmentLike[], today: string): number;
export interface RecalculationPlan {
  lockedCount: number; lockedPrincipalCents: number; lockedTotalCents: number; remainingPrincipalCents: number;
  future: ScheduledInstallment[]; anchorDate: string; anchorNumber: number; previousFutureCount: number;
  previousFutureTotalCents: number; futureTotalCents: number; newScheduledTotalCents: number; newInterestCents: number;
  regularCents: number; finalCents: number; nextDueDate: string; finalDueDate: string;
}
export function planRecalculation(loan: LoanTerms, installments: InstallmentLike[], normalized: NormalizedLoan, options: { today: string; nextDueDate?: string | null }): RecalculationPlan;

export function loanReminderDedupeKey(installmentId: string, kind: "upcoming" | "overdue"): string;
export function reminderDecision(
  reminder: { kind: string; dueDate: string },
  loan: { status: LoanStatus; reminderDaysBefore: number | null; overdueAlerts: boolean } | null,
  installment: Pick<InstallmentLike, "dueDate" | "amountCents" | "paidCents"> | null,
  today: string,
): { deliver: boolean; note: string | null };
