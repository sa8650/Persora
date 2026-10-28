// Loan Tracker — shared labels, formatters and small presentational pieces.
import type { InstallmentStatus, InterestMethod, LoanDirection, LoanFrequency, LoanState } from "../../../cloudflare/loan-rules.js";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Progress } from "@/components/ui/progress";

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
  const variant = status === "paid" || status === "completed" ? "success-light"
    : status === "overdue" ? "destructive-light"
    : status === "partial" ? "warning-light"
    : status === "due" || status === "active" ? "info-light"
    : "secondary";
  return <Badge variant={variant} size="xs" radius="full" className={`ln-badge ln-badge-${status} ${className}`}>{label}</Badge>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 1000) / 10));
  return <Progress value={percent} aria-label={label} className="ln-progress h-1.5"/>;
}

/** Colourful direction mark (borrowed = money in, lent = money out) using ReUI IconTile + Lucide icons. */
export function DirectionGlyph({ direction, size = 36 }: { direction: LoanDirection; size?: number }) {
  const Icon = direction === "borrowed" ? ArrowDownLeft : ArrowUpRight;
  return <IconTile variant="soft" size={size >= 40 ? "default" : "sm"} className={`ln-glyph ln-glyph-${direction}`} aria-hidden="true">
    <Icon size={size * 0.5} strokeWidth={2.2} />
  </IconTile>;
}
