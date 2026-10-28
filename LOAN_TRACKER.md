# Persora Loan Tracker

A personal loan and installment tracker (**App Launcher → Loan Tracker**, or `/?view=loans`) for money you **borrowed** (payable) and money you **lent** (receivable). It is for personal record-keeping — not accounting, banking, or payment processing.

The Loan Tracker UI (`src/components/loans/`) uses Persora's in-repo ReUI primitives (`Badge` for loan/installment statuses, `Progress` for payoff progress bars, `Checkbox` for reminder email toggles, `IconTile` for empty states, and `Spinner` for loading/saving feedback).

## What members can do

- **Borrowed & Lent tabs** plus a **Summary** strip (Active, Overdue, Remaining to pay, Remaining to collect, Paid so far, Collected so far, and Upcoming installments in the next 30 days, grouped by currency so currencies are never mixed).
- **Live schedule preview (`src/components/loans/LoanFormModal.tsx`):** Before saving, preview exact installment counts, regular installment amounts, final rounding installment, total interest, and total payable/receivable.
- **Interest modes (`cloudflare/loan-rules.js`):**
  - **No interest** — principal divided evenly across installments; final installment absorbs remaining cents.
  - **Flat interest** — `round(principal × annualRate × periods / periodsPerYear)` added upfront across the term (`periodsPerYear`: daily `365`, weekly `52`, monthly `12`, yearly `1`).
  - **Reducing balance** — standard amortizing periodic rate `annualRate / periodsPerYear`, with principal + interest reconciled to whole minor units on the final installment.
- **Installment schedules:** Daily, weekly, monthly (clamped to month-end, e.g. Jan 31 → Feb 28/29 → Mar 31), or yearly, from `1` to `360` installments (`1–365` daily), or custom installment count/amount.
- **Payments, corrections & reversals:** Record full, partial, or multi-installment payments (allocated oldest-unpaid first with explicit overpayment guard). Past payments are **never silently edited or deleted** — reversing a payment creates an append-only audit reversal row and recomputes affected installment balances (`pending`, `partial`, `paid`, `overdue`).
- **Confirmed recalculation & closure:** Editing term/rate/amount parameters previews future unpaid installments and requires explicit confirmation while keeping paid/partially paid installments untouched. Active loans can also be closed early via **Mark settled** (with settlement note) or archived/restored.
- **Reminders:** Optional due-date reminders (`Same day`, `1 day before`, `3 days before`, `7 days before` at local reminder time) delivered to the in-app bell, desktop notifications while open, and Brevo email when enabled.

## Database, API, and backup integration

- **Schema:** Included in `supabase/schema.sql` (`loans`, `loan_installments`, `loan_payments`, `loan_reminders`) with integer minor-unit (`*_cents`) invariants, `revision` optimistic concurrency (`409 Conflict` on stale writes), RLS enabled, and zero browser-role grants.
- **Endpoints (`/api/loans*`):** `GET /api/loans`, `POST /api/loans`, `POST /api/loans/preview`, `GET|PATCH|DELETE /api/loans/:id`, `POST /api/loans/:id/payments`, `POST /api/loans/:id/payments/:paymentId/reverse`, `POST /api/loans/:id/settle`, and `POST /api/loans/import`.
- **Account backup & restore:** Exported in `persora-export.json` (**Settings → Download a backup**) under `loanTracker` and restored idempotently via `POST /api/loans/import`.
- **Tests:** `tests/loans-rules.test.mjs`, `tests/loans-db.test.mjs`, `tests/loans-routes.test.mjs`, and `npm run test:e2e:loans`.
