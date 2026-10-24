// Loan Tracker — shared labels, formatters and small presentational pieces.
import type { InstallmentStatus, InterestMethod, LoanDirection, LoanFrequency, LoanState } from "../../../cloudflare/loan-rules.js";

export const FREQUENCY_LABELS: Record<LoanFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
export const FREQUENCY_UNITS: Record<LoanFrequency, [string, string]> = { daily: ["day", "days"], weekly: ["week", "weeks"], monthly: ["month", "months"], yearly: ["year", "years"] };
export const METHOD_LABELS: Record<InterestMethod, string> = { none: "No interest", flat: "Flat rate", reducing: "Reducing balance" };
export const DIRECTION_LABELS: Record<LoanDirection, string> = { borrowed: "Borrowed", lent: "Lent" };
export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = { paid: "Paid", overdue: "Overdue", partial: "Partially paid", due: "Due", upcoming: "Upcoming" };
export const LOAN_STATE_LABELS: Record<LoanState, string> = { active: "Active", overdue: "Overdue", completed: "Completed", closed: "Closed" };
export const PAYMENT_METHODS = ["Cash", "Bank transfer", "bKash", "Nagad", "Rocket", "Card", "Cheque", "Mobile banking"];

const moneyFormats = new Map<string, Intl.NumberFormat>();
/** "৳1,250.00" / "$80.50" (falls back to "XYZ 1,250.00" for unknown codes). */
export function formatMoney(amount: number, currency: string): string {
  const key = currency || "BDT";
  let format = moneyFormats.get(key);
  if (!format) {
    try { format = new Intl.NumberFormat(undefined, { style: "currency", currency: key, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch { format = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    moneyFormats.set(key, format);
  }
  const text = format.format(Number.isFinite(amount) ? amount : 0);
  return format.resolvedOptions().style === "currency" ? text : `${key} ${text}`;
}

/** Calendar date (YYYY-MM-DD) formatted without time-zone drift. */
export function formatDay(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function countLabel(count: number, frequency: LoanFrequency): string {
  return `${count} ${frequency === "daily" ? "daily" : frequency === "weekly" ? "weekly" : frequency === "monthly" ? "monthly" : "yearly"} installment${count === 1 ? "" : "s"}`;
}

export function rateLabel(method: InterestMethod, rate: number | null): string {
  return method === "none" || rate === null ? "No interest" : `${METHOD_LABELS[method]} · ${Number(rate.toFixed(4))}% a year`;
}

/** Days from `today` to `date` as a short phrase ("today", "in 3 days", "5 days ago"). */
export function relativeDay(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function StatusBadge({ status, className = "" }: { status: InstallmentStatus | LoanState; className?: string }) {
  const label = status in INSTALLMENT_STATUS_LABELS ? INSTALLMENT_STATUS_LABELS[status as InstallmentStatus] : LOAN_STATE_LABELS[status as LoanState];
  return <span className={`ln-badge ln-badge-${status} ${className}`}>{label}</span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 1000) / 10));
  return <span className="ln-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
    <span style={{ width: `${percent}%` }}/>
  </span>;
}

/** Colourful direction mark (borrowed = money in, lent = money out). Inline SVG, no external assets. */
export function DirectionGlyph({ direction, size = 36 }: { direction: LoanDirection; size?: number }) {
  return <span className={`ln-glyph ln-glyph-${direction}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {direction === "borrowed" ? <><path d="M17 7 7 17"/><path d="M15 17H7V9"/></> : <><path d="M7 17 17 7"/><path d="M9 7h8v8"/></>}
    </svg>
  </span>;
}
