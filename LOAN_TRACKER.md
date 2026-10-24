# Loan Tracker

Persora's Loan Tracker records money you **borrowed** or **lent** that is repaid in installments. It builds the installment schedule, records each payment as its own transaction, and shows what's next, what's overdue and what's left. It is a tracking tool: amounts are estimates computed from the terms you enter, not figures confirmed by a lender.

Open it from **Workspace → Loan Tracker** in the sidebar or from the app launcher. Reminder emails link straight to a loan (`/?view=loans&loan=<id>`).

## Creating a loan

| Field | Notes |
|---|---|
| Name or purpose | Required, up to 80 characters. |
| Type | *I borrowed* or *I lent*. The lender and borrower fields stay explicit either way; your name is pre-filled on your side. |
| Lender / Borrower | Required. The list shows the other party. |
| Principal | Required, greater than 0, up to 2 decimals. |
| Currency | 25 two-decimal ISO currencies, BDT first. Summaries never add different currencies together. |
| Interest | None, Flat or Reducing balance, with an annual rate (greater than 0% and at most 100%). |
| Installments, frequency | 1–2000 installments: daily, weekly, monthly or yearly. |
| Start date, first installment date | The first installment can't be before the start. |
| Reference, notes, documents | Optional. Documents are links to existing Persora vault records (up to 20). |
| Reminders | Optional before-due reminder (on the day, or 1, 3 or 7 days before), overdue alerts and email. |

The form shows a live preview of the installment amount (and the final amount when it differs), number of installments, interest, total repayment and first/final due dates. The same rules (`cloudflare/loan-rules.js`) run in the browser and again on the server.

### How amounts are calculated

All arithmetic is done in whole cents.

- **No interest:** the principal is split evenly.
- **Flat:** interest = principal × annual rate × term in years (installments ÷ periods per year: 365 daily, 52 weekly, 12 monthly, 1 yearly). Principal and interest are each split evenly.
- **Reducing balance:** the periodic rate is the annual rate ÷ periods per year. The installment is the standard amortizing payment (EMI). Each period's interest is charged on the outstanding balance, so later installments carry less interest.
- Amounts are rounded to the cent and the **final installment absorbs the rounding** (for example 1000 over 3 gives 333.33, 333.33, 333.34).
- Example: 100,000 at 12% reducing over 12 months gives 8,884.88 a month, a final installment of 8,884.85, and 6,618.53 interest.

Lenders may use fees, day-count conventions or rounding of their own, so the UI labels these figures as estimates.

### Due dates

Installment *n* falls *n − 1* periods after the first due date. Monthly and yearly schedules keep the same calendar day where possible: a loan due on the 31st falls on Feb 28/29, Mar 31, Apr 30, and so on, and a yearly loan from Feb 29 falls on Feb 28 in other years.

## Installment status

Statuses are computed from the payments and your **profile time zone's** current date:

| Status | Meaning |
|---|---|
| Paid | Nothing remaining. |
| Overdue | Money remains and the due date has passed. This includes partly paid installments; the row shows how much was paid. |
| Partially paid | Some money paid and the due date hasn't passed. |
| Due | Unpaid and due soon: today for daily, within 6 days for weekly, within 7 days for monthly and yearly. |
| Upcoming | Unpaid and not yet due. |

Remaining = scheduled amount − recorded (not reversed) payments. An installment is never shown as paid unless its payments cover it.

## Payments

- Each payment is a separate record: amount, date, optional method, reference and notes. It is recorded against one installment.
- Partial and multiple payments add up. A payment can't be zero, negative, in the future, before the loan started, or **more than the installment's remaining amount**: Persora asks you to record any extra against the next installment. There is no overpayment workflow.
- The dialog creates one payment id each time it opens. If a connection drops after the server saved the payment, retrying replays the same payment instead of adding a second one.
- **Reverse** marks a payment reversed, with a required reason and time. It is never deleted.
- **Correct** reverses the original and records the replacement in one transaction, linked to the original. Both stay in the history.
- When a payment brings the outstanding balance to zero, the loan becomes **Completed**. Reversing a payment on a completed loan makes it Active again.

## Editing and recalculation

Name, parties, currency, reference, notes, documents and reminders save directly.

Changing the principal, interest method or rate, number of installments, frequency or due dates is a **schedule change**:

1. Persora locks every installment up to the last one that has a payment (including reversed ones) or whose due date has passed. Locked installments and all payments are never rewritten.
2. The remaining principal (new principal − principal covered by locked installments) is scheduled again over the remaining installments with the new terms, starting at the next due date (optionally a new one).
3. The editor shows the old and new totals, the remaining count, and the next and final installment. You review the new rows and choose **Confirm & recalculate**. The server refuses an unconfirmed schedule change (HTTP 428) and checks the lock again itself.
4. The original terms stay on the loan, and each change is added to its schedule history (shown on the details page).

Edits carry a revision number. An edit made from a stale copy, for example another device, is refused with a conflict instead of overwriting newer data.

## Completing and closing

- **Completed** happens only when the outstanding balance is zero. The server refuses *complete* while money is outstanding.
- **Close with settlement** is the explicit way to end a loan that still has a balance (for example a waived remainder). It requires a note; the remaining balance is shown as settled or written off. Closed loans accept no payments and get no reminders. A closed loan can be **reopened**.
- **Delete** removes the loan with its installments, payments and reminders after a confirmation.

## Reminders

Loan reminders use the same pipeline as Calendar and Habit Tracker reminders: the pg_cron tick or external scheduler on `POST /api/internal/calendar-reminders`, the opportunistic dispatch after signed-in requests, the notification bell, desktop notifications while Persora is open, and Brevo email to verified addresses.

- **Before due:** 09:00 in your time zone, on the chosen day before the due date.
- **Overdue:** 09:00 the day after the due date.
- Each installment gets at most one reminder of each kind (unique dedupe key `loan:<installment>:<kind>`). Paid installments and completed or closed loans are skipped.
- Reminders never record a payment or change any status.

See [DEPLOYMENT.md → Loan Tracker](DEPLOYMENT.md#loan-tracker) for setup.

## Overview

- Filters: **All, Borrowed, Lent, Active, Completed** (completed or closed) and **Overdue**.
- The summary strip (active amount, remaining balance, next installment, overdue count and amount, total paid) is computed from the loans in the current filter, one currency at a time; a currency picker appears when loans use several currencies.
- Loans needing attention (overdue) sort first.
- The details page shows the next installment prominently, then outstanding/paid/scheduled/overdue figures, a progress bar, the installment list with each installment's payment history, the terms and original terms, and the schedule history.

## Data, API and security

- Tables: `loans`, `loan_installments`, `loan_payments`, `loan_reminders` (migration `supabase/migrations/202610290001_loans.sql`). RLS is enabled; client roles have no access; all access goes through owner-scoped SECURITY DEFINER functions called by the Pages API with the service role.
- Every `/api/loans` request is authorized first and scoped to the signed-in member, so other members' loans answer 404.
- Data lives in the account database behind the same Pages API that the web app and the Android companion use, so every signed-in device sees the same loans. The page refreshes when a tab becomes visible again. This change adds no native Android screen; on Android, use the web app.
- Backups: `persora-export.json` contains `loans`, `loanInstallments`, `loanPayments` and `loanReminders`. **Settings → Import** restores loans idempotently; see [ACCOUNT_DATA.md](ACCOUNT_DATA.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/loans` | Loans with summaries, profile time zone, today, limits and currencies |
| POST | `/api/loans` | Create (client id; a retry replays) |
| GET / PATCH / DELETE | `/api/loans/:id` | Detail, edit (`revision`, `recalculate`, optional `nextDueDate`), delete |
| POST | `/api/loans/:id/complete`, `/close`, `/reopen` | Status changes (`close` needs `note`) |
| POST | `/api/loans/:id/installments/:iid/payments` | Record a payment |
| POST | `/api/loans/:id/payments/:pid/reverse`, `/correct` | Reverse or correct (reason required) |
| GET / PATCH | `/api/loans/reminders`, `/api/loans/reminders/:id` | Bell entries, mark read |
| POST | `/api/loans/import` | Restore from a backup |

## Tests

- `tests/loan-rules.test.mjs`: all frequencies, none/flat/reducing interest, rounding, month-end and leap-day dates, statuses, payment validation, recalculation plans, reminder decisions.
- `tests/loans-db.test.mjs` (PGlite): privileges/RLS, owner isolation, payments, idempotency, reversals and corrections, completion and settlement, recalculation locks, reminders, cascades, export/import.
- `tests/loans-routes.test.mjs`: the API through the Pages worker, including authorization, 428 confirmation, conflicts, reminders through the shared dispatcher, and backup/restore.
- `tests/e2e/loans.e2e.mjs` (`npm run test:e2e:loans`): the production build in Chromium against Postgres 17 + PostgREST.

## Known limitations

- Amounts are estimates; there are no fees, custom per-installment amounts, variable rates or lender day-count conventions.
- No overpayment or prepayment workflow: extra money is recorded against the next installment.
- A recalculation replaces the future installments, so their pending reminders are planned again from the new schedule.
- Server-side field errors are shown at the form level.
- Desktop notifications need browser permission and an open tab; without pg_cron or an external scheduler, reminders can arrive late.
