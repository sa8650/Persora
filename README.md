# Persora

Persora is a personal portal for the records, workspaces, and everyday details you want to keep together: identity and study documents, family information, medical history, contacts, digital business cards, projects, smart tables and spreadsheets, official photos, PDFs, habits, loans, calendar schedules, subscriptions, purchases, accounts, memberships, personal finance, tasks, reminders, notes, and useful links. The web workspace is responsive across desktop, tablet, and phone; the companion Android app is native Kotlin/Jetpack Compose.

## Product at a glance

- **Type-aware vault forms.** Choose a space and record type (for example NID, Student ID, or Passport); the fields adapt to that record. Family-linked records store a stable Family-member ID so renaming a family member never breaks associations.
- **Persora UI/UX Design System + ReUI component layer.** Canonical design tokens (`src/design-system/tokens.css`), surface/drawer/input stylesheet (`src/design-system/system.css`), Light/Dark/System theme engine (`src/design-system/theme.tsx` — `PersoraThemeProvider`, topbar `ThemeToggleButton`, Settings `AppearanceSettingsCard`), shared layout primitives (`src/design-system/primitives.tsx` — `PersoraEmptyState`, `PersoraAsideStat`, `PersoraSearchField`), and in-repo ReUI & shadcn primitives (`src/components/reui/{badge,file-type,frame,icon-stack,icon-tile,c-attachment-6}.tsx`, `src/components/ui/{attachment,button,checkbox,magic-card,progress,spinner}.tsx`, `src/hooks/use-file-upload.ts`, `src/components/ProgressIndicator.tsx`). Sidebar navigation and page canvas surfaces are separated by distinct surface tokens and crisp structural dividers; all file and contact uploads report live determinate byte/percentage progress with ReUI `Progress`; modal/drawer backdrops use crisp outside-fade scrims (`backdrop-filter: none`) for zero-lag scrolling and typing; and background striped patterns are removed website-wide. See [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).
- **Smart Scan.** Signed-in members can scan supported documents from vault and medical-record forms. Azure AI Document Intelligence supplies server-side OCR and Cloudflare Workers AI suggests structured values. Matched values populate type-specific fields; extra readable facts are kept in editable **Additional Data** for review before saving. See [`SMART_SCAN_SETUP.md`](./SMART_SCAN_SETUP.md).
- **Contacts and Digital Business Cards.** Web and Android clients share the account API. On web, Contacts includes categorized forms, international calling codes (`+880` default), private profile photos with ReUI `Progress` upload indicators, vCard import/export with a compact post-import summary dialog, duplicate detection/merge, and custom multi-select (`Select` mode with per-contact ReUI `Checkbox`, indeterminate Select All bar, count `Badge`, and confirmed bulk delete). See [`CONTACTS.md`](./CONTACTS.md) and [`BUSINESS_CARDS.md`](./BUSINESS_CARDS.md).
- **Projects.** Personal and shared project workspaces with fields, Kanban/list task views, drag-and-drop task cards, task/field pause locks, member roles and join/field requests, comments, reactions, activity feeds, and private R2 attachments rendered with ReUI `Attachment`, `FileType`, `Progress`, `Badge`, `Checkbox`, and `Spinner`.
- **Persora Table.** Dual-mode structured data workspace supporting **Smart Tables** (typed columns including text, number, currency, percent, date, checkbox, select/multi-select, URL, email, phone, rating, formula, and private R2 file attachments, plus Grid/Kanban/Gallery/Summary views) and **Spreadsheets** (multi-sheet grid powered by RevoGrid with formulas, cell formatting, CSV/XLSX import & export).
- **Photo Studio.** Manage official photos (passport, stamp, visa, ID card, job application) in folders. Detect dimensions, DPI, and print size locally; crop to official presets; remove backgrounds via Workers AI (`bria/remove-background`) with automatic on-device ORMBG fallback (ONNX Runtime WebGPU/WASM); and save to private R2 with ReUI `Progress`. See [`PHOTO_STUDIO.md`](./PHOTO_STUDIO.md).
- **PDF Studio.** Create PDFs from images, text, and existing PDFs; merge, split, reorder, rotate, and delete pages; export pages as images; add annotations, signatures, and text/image watermarks with undo/redo; and lock/unlock PDFs locally with AES-256 encryption via qpdf WebAssembly. Saving uploads to a private PDF Studio library with folders and Trash support. See [`PDF_STUDIO.md`](./PDF_STUDIO.md).
- **Calendar.** Private Week, Month, Day, and Agenda views (Agenda default on phones) with compact day headers, quick create, natural-language quick add (`src/lib/calendar-nlp.js`), repeating series + single-occurrence exceptions, tasks and appointments, conflict warnings with free-slot suggestions, synced display filters, two-way edge resizing (drag either the top start handle or bottom end handle), and multi-day timed event segmentation across day columns. Server-scheduled reminders deliver to the in-app bell, desktop notifications while open, and Brevo email when enabled. See [`CALENDAR.md`](./CALENDAR.md).
- **Habit Tracker.** Daily, weekday, and weekly-target routines tracked by check-in, repetition boxes (`1–100`), or numeric measurement with units, undoable check-ins, Today/Week/Month history, streak analytics, ReUI `Progress` completion bars, archiving, backup/restore, and optional server-scheduled reminders.
- **Loan Tracker.** Borrowed and lent installment schedules (daily, weekly, monthly, yearly) with none, flat, or reducing-balance interest, whole-cent schedule previews, per-installment payment recording, partial payments, auditable reversals/corrections, confirmed future-schedule recalculation, settlement closures, and reminders. See [`LOAN_TRACKER.md`](./LOAN_TRACKER.md).
- **Connections.** Connect external services (starting with Dexter Studio **EMS**) via server-to-server HMAC-signed requests and encrypted grants to browse, preview, download, and save copies of Vaultium files into Persora Documents. See [`CONNECTIONS.md`](./CONNECTIONS.md).
- **Password Manager.** Cross-device login vault gated by a dedicated server-verified bcrypt master password and short-lived in-memory `X-Persora-Vault-Token` session, with 4-mode password generation (Random, Memorable, Rhythm, and Workers AI suggestions) and Brevo email OTP master-password recovery that preserves saved entries. See [`PASSWORD_VAULT.md`](./PASSWORD_VAULT.md).
- **Global Trash & Account Backup.** Soft-deleted items across vault spaces, contacts, business cards, medical records, timeline posts, Photo Studio, PDF Studio, and Persora Table are retained for 7 days before purge (`src/components/TrashView.tsx`). Complete streaming TAR backups (`persora-export.json` + decrypted/private files) are available in **Settings → Download a backup**. See [`ACCOUNT_DATA.md`](./ACCOUNT_DATA.md).
- **App Launcher & Admin Console.** A 3 × 3 launcher beside the member avatar provides synced favorites (`GET/PUT /api/workspace/preferences`). Administrators manage accounts, storage plans, manual payment verification, alarm ringtones, document types, AI feature switches, Smart Scan usage, email settings, EMS integration, and public legal copy at `/admin` without access to private member files.

## Architecture and project layout

The website is a React 18 + TypeScript + Vite 6 + Tailwind CSS v4 application hosted on Cloudflare Pages, with same-origin backend routes served by Cloudflare Pages Functions at `/api/*`. Supabase provides PostgreSQL only (Persora does not use Supabase Auth), and Cloudflare R2 stores private attachments.

- `src/design-system/` — canonical Persora UI/UX Design System (`tokens.css`, `system.css`, `theme.tsx`, `primitives.tsx`, `index.ts`). See [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).
- `src/components/reui/` & `src/components/ui/` — saved ReUI & shadcn UI primitives (`Badge`, `FileType`, `Frame`, `IconStack`, `IconTile`, `ReuiFileAttachmentField`, `Attachment`, `Button`, `Checkbox`, `MagicCard`, `Progress`, `Spinner`), paired with `src/hooks/use-file-upload.ts` and `src/components/ProgressIndicator.tsx`.
- `src/components/` — workspace modules (`Workspace.tsx`, `ContactsView.tsx`, `BusinessCardsView.tsx`, `MedicalRecordsView.tsx`, `TimelineView.tsx`, `ProjectsView.tsx`, `ProjectTaskList.tsx`, `PhotoStudioView.tsx`, `PdfStudioView.tsx`, `PasswordManagerView.tsx`, `BillingView.tsx`, `TrashView.tsx`, `AdminConsole.tsx`, `calendar/`, `habits/`, `loans/`, `table/`, `connections/`, `launcher/`).
- `functions/api/[[path]].js` — Cloudflare Pages Functions `/api/*` adapter.
- `cloudflare/` — server-side handlers and shared rules (`api.js`, `smart-scan.js`, `timeline.js`, `projects.js`, `project-activity-rules.js`, `tables.js`, `table-*.js`, `photo-studio.js`, `photo-metadata.js`, `pdf-studio.js`, `password-vault.js`, `ai-controls.js`, `ai-password.js`, `calendar.js`, `calendar-rules.js`, `habits.js`, `habit-rules.js`, `loans.js`, `loan-rules.js`, `connections.js`, `workspace-modules.js`, `workspace-preferences.js`).
- `supabase/schema.sql` — complete, rerunnable schema for fresh Supabase PostgreSQL installations (consolidating all tables, constraints, indexes, RLS policies, and `SECURITY DEFINER` RPCs).
- `supabase/migrations/` — incremental SQL migrations since schema consolidation (for example `20261026000000_calendar_multiday_resize.sql`).
- `tests/` — Node test runner unit, route, and PGlite database suites (`npm test`) plus Playwright Chromium E2E suites (`tests/e2e/*.e2e.mjs`).

## Run, test, and build

```bash
npm install
npm run dev
```

Local Vite mode opens a browser-local demo workspace (**Explore the demo**). Demo records use `localStorage`, and demo file attachments remain in memory for the current tab session. Full authentication, Postgres persistence, and R2 uploads run when `VITE_USE_PAGES_FUNCTIONS=true` against Cloudflare Pages Functions.

```bash
npm run build
npm test
```

## Accounts, sign-in, password recovery, and email verification

- Every Persora account receives a unique 7-digit **Persora ID**. Members sign in with either their 7-digit ID or email address plus password.
- Passwords are salted and hashed via PostgreSQL `pgcrypto` bcrypt. Sessions are stored server-side as SHA-256 token hashes and set in an `HttpOnly`, `SameSite=Lax` cookie (`persora_session`, 7-day expiry) scoped to `/api`.
- **Self-service password recovery** is available from the sign-in dialog (**Forgot password?**): Persora sends a 6-digit, short-lived recovery code via Brevo to the registered email (`password_recovery_codes`) so members can set a new password and revoke stale sessions.
- **Email verification** in **Settings** sends a 6-digit, 10-minute OTP via Brevo (`email_verification_codes`) and awards the verified account badge when enabled by an administrator.

## Database setup

- **Fresh Supabase project:** Run the complete [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. It creates all current Persora tables (including Password Manager, Calendar, Habits, Loans, Projects, Persora Table, Photo Studio, PDF Studio, Global Trash, and Connections), RLS policies, triggers, and `SECURITY DEFINER` functions in one pass.
- **Existing database:** Apply any unapplied migration in [`supabase/migrations/`](./supabase/migrations/) (such as `20261026000000_calendar_multiday_resize.sql`) in filename order before deploying the corresponding release.

## Cloudflare Pages configuration

Configure production variables, secrets, and bindings in **Cloudflare Pages → Settings → Variables and Secrets / Bindings**. Never expose server secrets in `VITE_*` variables or client bundles.

| Name / binding | Type | Purpose |
| --- | --- | --- |
| `VITE_USE_PAGES_FUNCTIONS=true` | Build variable | Enables same-origin `/api/*` calls in the web build. |
| `SUPABASE_URL` | Plain text variable | Supabase PostgreSQL REST URL read by Pages Functions. |
| `SUPABASE_SECRET_KEY` | Encrypted secret | Server-only Supabase secret/service-role key. |
| `VAULT_FILES` | R2 bucket binding | Private object storage for documents, photos, PDFs, table/project files, and timeline ciphertext. |
| `TIMELINE_ENCRYPTION_KEY` | Encrypted secret | Stable AES-256-GCM key material for Life Timeline payloads and attachments. |
| `ADMIN_BOOTSTRAP_SECRET` | Temporary encrypted secret | One-time first-administrator claim at `/admin`; delete after claiming. |
| `BREVO_API_KEY` | Encrypted secret | Transactional email delivery for account recovery, verification OTPs, vault resets, and reminders. |
| `CALENDAR_REMINDER_TOKEN` | Optional encrypted secret | Authenticates `POST /api/internal/calendar-reminders` for `pg_cron`/`pg_net` or external schedulers (Calendar, Habits, Loans). |
| `TRASH_PURGE_TOKEN` | Optional encrypted secret | Authenticates `POST /api/internal/trash-purge` for external schedulers. |
| `CONNECTIONS_ENCRYPTION_KEY` | Encrypted secret (≥32 chars) | Encrypts Connections grants and integration secrets (falls back to `TIMELINE_ENCRYPTION_KEY`). |
| `EMS_INTEGRATION_SECRET`, `EMS_API_BASE_URL` | Optional secret / variable | Environment overrides for **Admin → Integrations → EMS**. |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Encrypted secrets | Server-side Smart Scan OCR credentials (`prebuilt-read`). |
| `AI` | Workers AI binding | Powers Smart Scan extraction, AI password word suggestions, and Photo Studio cloud background removal. |
| `PHOTO_STUDIO_AI_GATEWAY` | Optional variable | AI Gateway ID for Bria RMBG 2.0 background removal (`default` if unset). |
| `VITE_PHOTO_STUDIO_MODEL_BASE`, `VITE_PHOTO_STUDIO_ORT_WASM_BASE` | Optional build variables | Custom self-hosted URLs for on-device ORMBG ONNX weights and ORT WASM runtime. |

See [`DEPLOYMENT.md`](./DEPLOYMENT.md), [`SMART_SCAN_SETUP.md`](./SMART_SCAN_SETUP.md), [`CONTACTS.md`](./CONTACTS.md), [`BUSINESS_CARDS.md`](./BUSINESS_CARDS.md), [`CALENDAR.md`](./CALENDAR.md), [`LOAN_TRACKER.md`](./LOAN_TRACKER.md), [`PASSWORD_VAULT.md`](./PASSWORD_VAULT.md), [`PDF_STUDIO.md`](./PDF_STUDIO.md), [`PHOTO_STUDIO.md`](./PHOTO_STUDIO.md), [`CONNECTIONS.md`](./CONNECTIONS.md), and [`ACCOUNT_DATA.md`](./ACCOUNT_DATA.md) for detailed module guides.
