# Persora

Persora is a personal portal for the records and everyday details you want to keep together: identity and study documents, family information, medical history, contacts, business cards, subscriptions, purchases, accounts, memberships, finance, tasks, reminders, notes and useful links. The web workspace is designed to work on a phone as well as a desktop; the companion Android app is native Kotlin/Jetpack Compose.

## Product at a glance

- **Type-aware vault forms.** Choose a space and record type (for example NID, Student ID or passport); the fields adapt to that record. Family-linked records store a stable Family-member ID, so a rename does not break the association.
- **Smart Scan.** Signed-in members can scan supported documents from vault and medical-record forms. Azure Document Intelligence supplies OCR and Cloudflare Workers AI suggests structured values. Matched values go into their fields; other readable facts are kept in editable **Additional Data**. Review suggestions before saving. Additional Data is being retained as useful record context for future knowledge-base/AI-chat workflows; it is not a claim that an AI chat feature is currently available. See [`SMART_SCAN_SETUP.md`](./SMART_SCAN_SETUP.md) for providers, formats, limits and setup.
- **Contacts and business cards.** Web and Android clients share the account API. Android can import selected phone contacts in the background and show notification progress; both clients support contact and digital-card workflows.
- **Photo Studio.** Keep official photos (passport, stamp, visa, ID card, job application) in folders. Upload one and its size, DPI and format are detected locally. Or create one from any portrait: crop to official sizes, remove the background with AI (with an automatic on-device fallback), and change the background colour and adjustments. Nothing is uploaded until you press Save. See [`PHOTO_STUDIO.md`](./PHOTO_STUDIO.md).
- **PDF Studio.** Create PDFs from images, text and other PDFs; merge, split, reorder, rotate and delete pages; export pages as images; add text, highlights, underline, strike-through, shapes, drawings, images, signatures and text or image watermarks, with undo/redo; and lock or unlock PDFs with a password (real AES-256 encryption via qpdf compiled to WebAssembly). Everything runs in the browser (PDF.js + pdf-lib, loaded only when needed). Use **Download PDF** or **Save to Persora**; saving is the only step that uploads, and it goes to a private PDF library with folders. Existing PDF text isn't edited. See [`PDF_STUDIO.md`](./PDF_STUDIO.md).
- **Calendar.** A private calendar with Week, Month, Day and Agenda views (Agenda first on phones), quick create from a time slot or date, a detailed event form, title search and keyboard shortcuts. Events can repeat daily, weekly or monthly; edit or delete one occurrence or the whole series. Reminders (5 minutes to 1 day before) are scheduled on the server and delivered to Persora's notifications, by email when enabled, and as desktop notifications while Persora is open. Times follow your profile time zone, and all-day events stay dates. Smart scheduling adds:
  - natural-language quick add ("Dentist Friday at 4pm"), parsed deterministically in the browser with an editable preview and clarifying questions;
  - lightweight tasks (complete/reopen) and personal appointments;
  - drag to move or resize in Week, Day and Month (touch long-press too), with a keyboard Reschedule alternative;
  - overlap warnings with free-slot suggestions (never blocking);
  - display filters by type and colour that sync across devices.

  See [`CALENDAR.md`](./CALENDAR.md).
- **Habit Tracker.** Daily routines with one-click check-ins. Habits can run every day, on selected weekdays, or N times a week, and can be tracked with a checkbox or a numeric target with a unit (for example 8 glasses). Today's list shows progress ("3 of 5 completed"); Week and Month views show history and let you correct past days. Compact stats show today's rate, current and best streaks, and the weekly rate; the month grid separates completed, partly done, incomplete and unscheduled days. Days a habit isn't scheduled never break a streak. Dates follow your profile time zone (weeks start on Sunday). Habits can be categorised, filtered, reordered, archived (history kept) and restored. Optional per-habit reminders use the Calendar's reminder pipeline (bell, desktop notification while Persora is open, and email when enabled). They never mark a habit done.
- **Loan Tracker.** Loans you borrowed or lent, repaid in daily, weekly, monthly or yearly installments, with no interest, flat interest or reducing-balance interest. The form previews the installment amount, interest, total repayment and first/final due dates before saving. The schedule keeps the same calendar day where possible (the 31st falls back to the month's last day), and the final installment absorbs rounding. Figures are tracking estimates, not lender statements. Each payment is a separate record (amount, date, method, reference, notes); partial and multiple payments add up, overpayment is refused, and corrections or reversals keep the original in the history. Installments show Upcoming, Due, Partially paid, Paid or Overdue in your profile time zone. Schedule-affecting edits show the recalculated future installments and need confirmation; past installments and payments are never rewritten, and the original terms stay on record. A loan completes only when nothing is outstanding, or when you close it with a settlement note. Optional before-due and overdue reminders use the Calendar's reminder pipeline and never record a payment. See [LOAN_TRACKER.md](LOAN_TRACKER.md).
- **App launcher.** A 3 × 3 grid button beside your avatar opens every workspace module with original Persora icons. Favorites (up to 12, reorderable) appear first and sync to your account; the other modules scroll in a separate area. Modules open in the same tab, through the same navigation as the sidebar.
- **Password Manager.** Logins sync through Persora's Supabase database to every signed-in device. Opening the vault on any device needs a separate master password, checked on the server against a salted bcrypt hash; the API returns no records without it. Records are stored as JSON and protected by Supabase's encryption at rest, TLS, row-level security and the master-password gate. They are not separately encrypted by Persora, and the master password is not an encryption key. A forgotten master password can be reset with a one-time code sent to the registered email; saved passwords are kept. See [PASSWORD_VAULT.md](PASSWORD_VAULT.md).
- **More than files.** Folders, private record sharing, business-card public links, medical-record links, a life timeline, wallet cards, personal finance, tasks, reminders and alarms, storage plans and complete account export.
- **Smart Scan administration.** Admins can control scan availability and inspect aggregate usage counts without seeing document contents. Admin tools also manage accounts, document types, plans, manual payment reviews and public site content.
- **Account security.** Persora uses its own seven-digit member ID, password and server-side session flow. Email OTP verification can be enabled by an administrator and managed from member Settings.

## Architecture and project layout

The website is a React + Vite app hosted on Cloudflare Pages. Pages Functions provide its same-origin `/api/*` backend. Supabase provides Postgres only; Cloudflare R2 stores private attachments. The Android client uses the same Pages API, account database, private files and session service. Neither browser code nor the APK contains Supabase or provider secret keys.

- `src/` — web app, responsive portal, forms, workspace and admin UI.
- `functions/api/[[path]].js` — Pages API route adapter.
- `src/components/launcher/`, `src/lib/app-launcher.ts`, `cloudflare/workspace-modules.js`, `cloudflare/workspace-preferences.js` — app launcher UI and icons, the module list and favorites rules shared with the API, and `GET/PUT /api/workspace/preferences`.
- `cloudflare/api.js`, `cloudflare/smart-scan.js`, `cloudflare/timeline.js` — server-side API, scanning and timeline logic.
- `cloudflare/calendar.js`, `cloudflare/calendar-rules.js` — Calendar API and reminder dispatcher; recurrence, time-zone, validation, conflict, filter and move rules shared with the browser. `src/lib/calendar-nlp.js` is the quick-add parser.
- `cloudflare/habits.js`, `cloudflare/habit-rules.js` — Habit Tracker API (`/api/habits`), reminder planning and account backup/restore. The schedule, streak, completion-rate and reminder rules are shared with the browser. The UI is in `src/components/habits/`.
- `cloudflare/loans.js`, `cloudflare/loan-rules.js` — Loan Tracker API (`/api/loans`), reminder dispatch and account backup/restore. The interest, schedule, status, payment-validation and recalculation rules are shared with the browser. The UI is in `src/components/loans/`.
- `supabase/schema.sql` — complete, rerunnable current schema for a fresh database.
- `supabase/migrations/` — ordered upgrade history for existing databases; keep these files even when using the fresh schema.
- `../android/` — native companion app source in this workspace.

## Run and build the web app

From the website project directory:

```bash
npm install
npm run dev
```

Local Vite mode opens a browser-local demo workspace. Demo records use local storage; demo file attachments stay in memory and are not written to local storage. Use **Explore the demo** to try the workspace. A connected account requires the deployed Pages Functions API.

```bash
npm run build
```

To work on Android, open the companion `android/` project in Android Studio with JDK 17 and Android SDK 35 or newer. The Android app is a native client, not a WebView. Account credentials and Supabase/R2 secrets are not shipped in the APK.

## Accounts, sign-in and email verification

- Persora does **not** use Supabase Auth. Each account has a random seven-digit Persora ID; members can sign in with that ID or their email address and password.
- Password hashes are made with PostgreSQL `pgcrypto` bcrypt through server-side Pages Functions. Sessions use random, server-stored token hashes and an `HttpOnly`, `SameSite=Lax` cookie scoped to `/api`; sessions expire after seven days. Failed sign-ins are rate-limited.
- Members can change their password while signed in. Password-reset email is not implemented, so there is no self-service forgotten-password flow.
- Optional email verification sends a six-digit, ten-minute code to the registered email. The member can request and verify the code from Settings. Admins enable or disable verification and configure the sender; resend and attempt limits apply.

## Fresh database vs. deployed database

For a **new Supabase database**, run all of [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. It creates the current profile/authentication, vault/folder, contacts, card, sharing, medical, timeline, scan, verification, billing, admin, RLS, index, trigger and function definitions, plus baseline settings and plan data. The Password Manager tables are not in `schema.sql`: afterwards, also run `supabase/migrations/202610210001_password_vault_recovery.sql`, `202610230009_password_vault_sync.sql`, `202610240001_password_vault_master_password.sql` and `202610240002_password_vault_drop_legacy_encryption.sql`, in that order.

For a **database already in use**, keep its migration history and apply each still-unapplied file in [`supabase/migrations/`](./supabase/migrations/) in filename order before deploying the corresponding feature. Do not treat the fresh-install schema as a replacement for deployed-database migration records. The schema includes custom accounts; legacy Supabase Auth password hashes cannot be converted into Persora password hashes. Back up production data before database changes.

## Cloudflare configuration

Set production values in **Cloudflare Pages → Settings → Variables and Secrets**. Keep every server credential out of source code, browser code and `VITE_*` variables.

| Name / binding | Where it belongs | Purpose |
| --- | --- | --- |
| `VITE_USE_PAGES_FUNCTIONS=true` | Pages build variable | Makes the web client call the same-origin Pages API. |
| `SUPABASE_URL` | Pages server-side variable | Postgres API endpoint. |
| `SUPABASE_SECRET_KEY` | Encrypted Pages secret | Server-only database/auth operations. |
| `VAULT_FILES` | Private Pages R2 binding | Private document and image storage. |
| `TIMELINE_ENCRYPTION_KEY` | Encrypted Pages secret | Stable AES-256-GCM key for timeline text and attachment encryption. Back it up and do not rotate without re-encrypting existing timeline data. |
| `ADMIN_BOOTSTRAP_SECRET` | Temporary encrypted Pages secret | One-time first-admin claim; remove after setup. |
| `BREVO_API_KEY` | Encrypted Cloudflare Pages secret | Server-only Brevo transactional email for OTPs and admin test messages. It is never stored in ordinary admin settings or browser code. |
| `CALENDAR_REMINDER_TOKEN` | Optional encrypted Pages secret | Enables `POST /api/internal/calendar-reminders` for pg_cron/pg_net or an external scheduler, so Calendar and Habit Tracker reminders go out on time even when nobody has Persora open. Without it the endpoint is a 404. See [`CALENDAR.md`](./CALENDAR.md). |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Encrypted Cloudflare Pages secret | Server-side Smart Scan OCR endpoint. |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Encrypted Cloudflare Pages secret | Server-side Azure OCR credential; never expose it to the frontend. |
| `CONNECTIONS_ENCRYPTION_KEY` | Encrypted Pages secret (≥32 chars) | Encrypts Connections grants and the stored integration secret. Falls back to `TIMELINE_ENCRYPTION_KEY`; keep it stable. See [`CONNECTIONS.md`](./CONNECTIONS.md). |
| `EMS_INTEGRATION_SECRET`, `EMS_API_BASE_URL` | Optional encrypted secret / plain variable | Override the EMS shared secret and address set in **Admin → Integrations**. Never use a `VITE_` prefix. |
| `AI` | Cloudflare Workers AI binding | Server-side Smart Scan extraction; this is a binding, not a frontend API key. |
| `PHOTO_STUDIO_AI_GATEWAY` | Optional Pages variable | AI Gateway id for Photo Studio's primary background removal (Workers AI `bria/remove-background` through the `AI` binding; default gateway `default`, needs Unified Billing credits). Without it working, the browser uses its on-device model. |
| `VITE_PHOTO_STUDIO_MODEL_BASE`, `VITE_PHOTO_STUDIO_ORT_WASM_BASE` | Optional Pages build variables | Self-host the on-device background-removal model and runtime (defaults: Hugging Face and jsDelivr). See [`PHOTO_STUDIO.md`](./PHOTO_STUDIO.md). |

Use [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full setup, secret placement, email configuration, Smart Scan OCR setup, R2 binding, first-admin bootstrap and deployment verification. Use [`SMART_SCAN_SETUP.md`](./SMART_SCAN_SETUP.md) for Smart Scan-specific setup. In particular, configure `BREVO_API_KEY` and both Azure values as encrypted Cloudflare Pages secrets; never paste them into the website or an ordinary admin setting.

## Admin and billing

The administrator console is available at `/admin` to signed-in administrators. First-admin setup uses the temporary Pages secret and a one-time database latch. Admins can manage accounts, storage plans, manual payment review, document types, Smart Scan availability/usage, email settings and editable Privacy/Terms/Contact content. Admin tools expose account and aggregate storage metadata, not private record contents.

Storage pricing is calculated from the administrator-set rate per GB. Payment collection is manual in phase one: members submit an external transaction reference and an administrator reviews it. No payment gateway is integrated.

## Privacy and data model

- Browser clients do not connect directly to Postgres. RLS and revoked browser-role privileges keep database access behind authenticated Pages Functions.
- R2 is private. The API checks ownership before serving a private attachment.
- Smart Scan OCR and extraction run server-side. The cache is account-scoped, short-lived and stores redacted OCR text; scan suggestions remain editable. Refer to the setup guide for precise formats, limits and retention behavior.
- Life Timeline text, external URLs, attachment descriptors and file bytes are encrypted at rest with AES-256-GCM before database/R2 storage. This is server-side encryption, not end-to-end encryption: the authenticated service decrypts content for its owner. Event dates, type and linked record IDs remain queryable metadata.
- Private contact/card sharing is distinct from public business-card links. Public cards reveal only the fields explicitly saved to that card; switching public sharing off makes the public routes unavailable.
- **Connections** (EMS today) never store the other service's password. Persora keeps only a revocable access grant, encrypted with AES-GCM, in a service-role-only table. EMS files are read-only: members can preview and download them, or save an independent copy to Persora. See [`CONNECTIONS.md`](./CONNECTIONS.md).
- Complete account backups are available from **Settings → Download a backup**. Password hashes, session tokens and other users' private records are not included.

See [`CONTACTS.md`](./CONTACTS.md), [`ACCOUNT_DATA.md`](./ACCOUNT_DATA.md) and [`BUSINESS_CARDS.md`](./BUSINESS_CARDS.md) for their current workflows and data behavior. Legal copy in the admin console is editable starter text and requires review for the service's jurisdiction before being treated as final legal advice.
