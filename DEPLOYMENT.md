# Persora — Cloudflare Pages deployment.

Persora runs as one Cloudflare Pages project: the React/Vite site is static output, and Pages Functions serve the private API at same-origin `/api/*`. Supabase is the Postgres database only—**Persora custom authentication does not use Supabase Auth**. Cloudflare R2 stores private file attachments.

Database values, encrypted secrets, and the R2 bucket binding are entered in **Cloudflare Pages project settings**. No source-code URL edits, separate Worker deployment, or R2 access keys are needed.

## Before you start

You will need:

- This project pushed to a GitHub repository.
- A Supabase project (Postgres only; no Auth redirect configuration is required).
- A Cloudflare account with Pages and R2 enabled.

The route adapter is `functions/api/[[path]].js`; the API implementation is `cloudflare/api.js`.

## 1. Push the project to GitHub

If the project is not already in a repository, create an empty GitHub repository and run these commands from the project root:

```bash
git init
git add .
git commit -m "Deploy Persora"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

If Git is already set up, keep its existing history and remote. Do not commit `.env`, `.dev.vars`, Supabase keys, or Cloudflare secrets.

## 2. Create Supabase and apply the schema

1. Create a Supabase project and wait for it to finish provisioning.
2. Open that project’s **SQL Editor**.
3. Open `supabase/schema.sql`, copy the entire file into the SQL Editor, and run it. It creates Persora profiles, seven-digit login IDs, password hashes, server-side sessions, rate-limit state, vault/billing/admin tables, private medical-record tables, RLS policies, and restricted Postgres functions.
4. For an already-running Persora database, apply the outstanding files under `supabase/migrations/` in date order. At minimum, existing deployments need the Life Timeline, medical records, vault folders/wallet cards, billing-term, personal-finance, Smart Scan cache, `20261006_email_verification_upload_entitlements.sql`, `202610060001_ensure_default_free_plan.sql`, `202610210001_password_vault_recovery.sql`, `202610220001_password_manager_folder_scope.sql`, `202610230009_password_vault_sync.sql` and `202610240001_password_vault_master_password.sql` migrations before deploying the matching features. Calendar needs `202610250001_calendar.sql`, then `202610260001_calendar_items.sql` for smart scheduling (see [Calendar reminders](#calendar-reminders)). The app launcher needs `202610270001_workspace_preferences.sql`, Habit Tracker needs `202610280001_habits.sql` (see [Habit Tracker](#habit-tracker)), and Loan Tracker needs `202610290001_loans.sql` after it (see [Loan Tracker](#loan-tracker)). `202610240002_password_vault_drop_legacy_encryption.sql` is applied last, only after the Password Manager upgrade steps in [`PASSWORD_VAULT.md`](./PASSWORD_VAULT.md#runbook-production) report nothing pending. On a brand-new database it simply succeeds. The folder-scope migration adds Password Manager as an allowed folder scope for existing databases.
5. In **Project Settings → API Keys** (sometimes shown as **Settings → API**), copy and keep ready:
   - The **Project URL**, e.g. `https://abcdefghijkl.supabase.co`.
   - A server-only **Secret key**, usually beginning `sb_secret_...`. If your project still uses the legacy service-role JWT, use that value in the same Pages secret described below.

Persora never needs the Supabase publishable/anon key in the browser. Do not configure Supabase Auth email templates, site URLs, or redirect URLs for this app; account creation, passwords, and sessions use Persora’s custom Pages Function flow.

> **Existing accounts:** Supabase Auth password hashes cannot be migrated into Persora’s custom bcrypt hashes. The SQL assigns a seven-digit ID to legacy `profiles` rows, but it cannot make their old passwords work; old rows with no `password_hash` cannot sign in. For a clean cutover, use a fresh database/project or arrange a verified account-recovery/migration plan before reusing old accounts. Do not delete user data until you have a backup.

## 3. Create a private R2 bucket

1. In Cloudflare, open **R2 Object Storage** and create a bucket named `persora-private-vault` (or choose another name and select it in the binding step).
2. Keep the bucket private. Do not enable public access or attach a public custom domain.
3. Do not create R2 access keys for Persora. Pages connects to the bucket using a binding.

## 4. Create the Cloudflare Pages project

1. Open **Workers & Pages → Create application → Pages → Connect to Git** and select the repository.
2. Set:
   - **Production branch:** `main`
   - **Root directory:** `/` (repository root)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Save and deploy. Cloudflare Pages automatically deploys the repository’s `/functions` directory with the static site.
4. Note the assigned website URL, e.g. `https://persora.pages.dev`.

The Pages Function imports `cloudflare/api.js` directly. Do not deploy that file as a separate Worker.

## 5. Add variables and secrets in Pages settings

In the Pages project, open **Settings → Variables and Secrets** (may appear as **Environment variables**). Under **Production**, add each item below. Use the exact spelling and type shown.

| Name | Value | Type in Pages settings | Purpose |
| --- | --- | --- | --- |
| `VITE_USE_PAGES_FUNCTIONS` | `true` | Plain text variable | Build-time switch: frontend calls the same-origin `/api/*` route. |
| `SUPABASE_URL` | Your Supabase Project URL | Plain text variable | Database endpoint read by the server-side Pages Function. |
| `SUPABASE_SECRET_KEY` | Your Supabase Secret key (or legacy service-role JWT) | **Encrypted secret** | Server-only database operations and custom auth. Never prefix this with `VITE_`. |
| `TIMELINE_ENCRYPTION_KEY` | A dedicated stable random value, e.g. output from `openssl rand -hex 32` | **Encrypted secret** | Required before posting any timeline event. AES-256-GCM key material for timeline text and files. Back it up securely; changing or removing it without re-encrypting existing data makes timeline content unreadable. |
| `ADMIN_BOOTSTRAP_SECRET` | A newly generated random value | **Encrypted secret; temporary** | Allows the first trusted owner to claim administrator access once. Remove after step 8. |
| `PASSWORD_VAULT_ESCROW_PRIVATE_KEY` | Only if it already exists from the earlier encrypted Password Manager | **Encrypted secret; temporary** | Used once to convert records saved by the retired encrypted release, then deleted (see `PASSWORD_VAULT.md`). New deployments do not set it. The Password Manager needs no key or extra secret of its own. |
| `BREVO_API_KEY` | Brevo API v3 key with transactional-email access | **Encrypted secret** | Sends email-verification OTPs and admin test emails. Server-only; never use a `VITE_` prefix. |
| `CALENDAR_REMINDER_TOKEN` | Optional; a long random value, e.g. `openssl rand -hex 32` | **Encrypted secret** | Lets pg_cron/pg_net or an external scheduler trigger Calendar and Habit Tracker reminder delivery (see [Calendar reminders](#calendar-reminders)). Without it, `/api/internal/calendar-reminders` is a 404. |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Azure Document Intelligence resource's base HTTPS endpoint | **Encrypted secret** | Server-side Smart Scan OCR endpoint; never use a `VITE_` prefix. |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Azure Document Intelligence resource key | **Encrypted secret** | Authenticates server-side Smart Scan OCR requests; never use a `VITE_` prefix. |

Generate the bootstrap value locally, for example:

```bash
openssl rand -hex 32
```

Copy its output directly into the encrypted `ADMIN_BOOTSTRAP_SECRET` field. Do not put it in a source file, `.env`, GitHub, Pages build logs, or a `VITE_` variable. Keep it only until the first admin claim is complete.

**No `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, or Supabase anon key is needed.** `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are read by Pages Functions; only the Pages API switch is exposed to the Vite build. Never use a `VITE_` prefix for a secret—Vite would publish it in the browser bundle.

### Email delivery and verification (Brevo)

1. In Brevo, authenticate your sending domain and verify the sender address you plan to use. Create an API v3 key with transactional-email sending access.
2. In Cloudflare Pages → **Settings → Variables and Secrets**, add `BREVO_API_KEY` under **Production** and mark it **Encrypted/Secret**. Do not add it as a Vite variable, enter it into the admin form, or store it in Supabase. The key is read only by the server-side Pages Function. Alternatively, run `npx wrangler pages secret put BREVO_API_KEY --project-name YOUR_PAGES_PROJECT_NAME` from the project root and enter the key at the prompt.
3. Redeploy Pages after adding or rotating the secret. The Admin console’s **Email settings** tab reports whether `BREVO_API_KEY` is present.
4. In **Admin → Email settings**, enter the verified sender email and display name, optionally set the reply-to email/name, choose whether email OTP verification is enabled, and save. Use **Send a test email** to verify the provider accepts the configuration.
5. The OTP endpoint sends only to the email already registered on the signed-in Persora account. Codes expire after 10 minutes, and sends/attempts remain rate-limited. The test message uses the saved sender and reply-to fields but does not depend on the OTP toggle.

If the Brevo secret or sender address is missing, the Admin console identifies the missing setup and the OTP endpoint explains that `BREVO_API_KEY` must be configured in Cloudflare Pages. Settings in the admin panel never expose or persist the API key.

### Smart Scan OCR (Azure AI Document Intelligence)

Create an Azure AI Document Intelligence resource with the `prebuilt-read` model, then copy its base HTTPS endpoint and resource key into the two encrypted Pages secrets listed above. Use **Standard (S0)** to preserve Smart Scan's 7 MB upload limit: the Azure free (F0) tier is limited to 4 MB and processes only the first two PDF/TIFF pages. Deploy Pages again after adding or rotating either secret. The server-side function calls REST API version `2024-11-30`; the key is never sent to the browser. For the Workers AI extraction binding and full OCR setup, see [`SMART_SCAN_SETUP.md`](SMART_SCAN_SETUP.md).

### Global Trash and AI password suggestions

**Trash migration.** Apply `supabase/migrations/202610220002_global_trash.sql` in the Supabase SQL editor (after the earlier migrations). It creates the `trash_items` and `trash_file_releases` tables plus the transactional move/restore/claim/finalize/purge functions; nothing existing is altered. From then on every supported delete (vault records, contacts, business cards, medical records, manual timeline posts) is a soft-delete into the Trash with a server-set 7-day expiry.

**Scheduled purge.** The migration tries to schedule the hourly `persora-trash-expiry-purge` pg_cron job itself. On Supabase projects where `pg_cron` is unavailable the migration still succeeds with a warning — expiry is then fully covered by the API sweep: a throttled worker task runs after `/api/auth/me` calls (at most every 15 minutes) and claims expired rows, deletes unreferenced R2 files, and finalizes the rows. Nothing depends on anyone opening the Trash page. You can additionally point an external scheduler at `POST /api/internal/trash-purge` with header `x-persora-cron-token`; it only activates when the encrypted `TRASH_PURGE_TOKEN` secret is set to the same token (any long random string) in Pages settings — with the secret unset the endpoint behaves as 404.

**Trash lifecycle guarantees.** Restores are transactional and rebuild folders, shares, comments, and timeline/medical links (a missing folder falls back to "no folder" with a notice; missing link targets are skipped with a notice — the item itself is never silently discarded). Files in R2 are only removed on permanent deletion or purge, and only when no live record and no other Trash entry still references their key. Expired items disappear from the Trash immediately and can no longer be restored, while the purge pipeline finalizes them asynchronously and retries safely after failures. Password Manager entries live in the client-side encrypted vault, so their Trash lives inside the vault too (same 7-day window, purged on unlock/save) and never reaches this server-side pipeline by design.

**AI password suggestions.** The generator's AI tab calls `POST /api/ai/password-suggestions`, which reuses the `AI` Workers AI binding and the `@cf/meta/llama-3.3-70b-instruct-fp8-fast` model from Smart Scan — no extra secret is needed once Smart Scan's binding (`SMART_SCAN_SETUP.md`) exists. Add the `AI` binding to every Pages environment where suggestions should work (Production and, separately, Preview), then redeploy. The request carries only the public style (rhythmic / pronounceable / poetic / sonnet / passphrase), count, and target length — never account or vault data. AI inference may take longer than a short browser request; the UI now waits up to 45 seconds and accepts Workers AI's documented `{ response, usage }` result shape. Only an actual unavailable/disabled/unusable/timed-out result falls back to local generation, and the UI shows the specific fallback reason. Pages runtime logs record model, elapsed time, candidate count, neuron count when available, and sanitized provider failures; prompts and generated candidates are never logged. Check Cloudflare Pages → Functions → Real-time logs for `Persora Workers AI password request ...` events when debugging production failures.

**Projects routing.** Browser requests arrive at `/api/projects...`; the project handler normalizes that Pages API prefix before parsing list/detail route segments. Newly-created projects are returned only after the backend reads back the persisted row by its generated UUID and owner. Project details also use `?project=<database-uuid>` so authorized deep links and refreshes reopen through the same server-side access check.

### Projects and AI controls (2026-10-22)

**Projects migration.** Apply `supabase/migrations/202610220003_projects.sql` in the Supabase SQL editor (after the earlier migrations). If you already applied an earlier revision of this file, **re-run it** — the current revision fixes field/request creation failing with a not-null violation when the field payload omits a description. Because the file uses `CREATE OR REPLACE`/`IF NOT EXISTS` throughout, re-running it over the previous revision simply replaces the functions. It creates the `projects`, `project_members`, `project_folders`, `project_fields`, `project_field_reactions`, `project_field_comments`, `project_field_requests`, and `project_activity` tables plus the security-definer functions that enforce the project permission matrix (owner full control; editors create with the owner grant; everyone else requests fields for owner approval; strict per-field ownership edits; comment authorship/moderation). Every write flows through `/api/projects*` into those functions, so direct REST access is revoked and non-members always receive 404s (project existence is never leaked). Until the migration is applied, the Projects page returns a friendly error instead of data.

**PDF Studio migration.** Apply `supabase/migrations/202610230008_pdf_studio.sql` after the earlier migrations; it needs `trash_items`. It adds the `pdf-studio` folder scope, the private `pdf_studio_documents` table (RLS on, metadata only — files live in R2 under `<userId>/pdf-studio/`), the `pdf_studio_document` Trash kind and the save/replace/trash functions. No new bindings are needed. The build copies the PDF.js worker, CMaps, fonts and WASM decoders into `dist/pdfjs/<version>/`, and `public/_headers` serves them as immutable. Lock/Unlock PDF ships a qpdf WebAssembly engine (a hashed `assets/qpdf-*.wasm` of about 2.2 MB plus a module worker); if you add a Content Security Policy, allow `worker-src 'self'` and `script-src 'wasm-unsafe-eval'`. All PDF processing runs in the browser; only **Save to Persora** uploads. See [`PDF_STUDIO.md`](./PDF_STUDIO.md).

**Password Manager (master password, 2026-10-24).** The vault keeps records as JSON in `password_vault_items`. They are protected by Supabase encryption at rest, TLS, RLS with service-role-only functions, and a server-side master-password gate (bcrypt via pgcrypto). Persora does not separately encrypt them. Master-password resets use the email OTP from `202610210001` through Brevo (`BREVO_API_KEY`). No key or extra secret is needed. On a database that ran the earlier encrypted release:

1. Apply `202610240001_password_vault_master_password.sql`.
2. Deploy.
3. Convert the old records with the admin route or `npm run vault:migrate-legacy`, until it reports `pending: 0`.
4. Apply `202610240002_password_vault_drop_legacy_encryption.sql`.
5. Delete `PASSWORD_VAULT_ESCROW_PRIVATE_KEY` / `PASSWORD_VAULT_ESCROW_RETIRED_KEYS`.

The full runbook, rollback and the migrated-member trade-off are in [`PASSWORD_VAULT.md`](./PASSWORD_VAULT.md). New databases run the migrations in order with no extra steps.

**AI controls.** The Admin console now has an “AI controls” tab storing platform switches under the `ai_controls` platform setting (`passwordSuggestions`, `smartScanOcr`, `smartScanExtraction`; all default to on). Turning **AI password suggestions** off makes `/api/ai/password-suggestions` return an offline marker so members keep full local generation with a visible note; turning **Smart Scan OCR** or **Smart Scan AI extraction** off blocks the corresponding worker-side provider call (cached scans keep working). The tab also reports provider readiness (Workers AI `AI` binding, Azure Document Intelligence secrets) without exposing the secrets.

### Calendar reminders

**Migration.** Apply `supabase/migrations/202610250001_calendar.sql` after the earlier migrations; it only needs `profiles` and `pgcrypto`.
- It creates `calendar_events` (events, repeating series and single-occurrence exceptions) and `calendar_reminders` (the delivery queue). It also adds their indexes and the owner-scoped SECURITY DEFINER functions.
- RLS is on and the browser roles have no privileges.
- It enables `pg_trgm` for title search when it can; otherwise it falls back to a btree index with a warning.
- It is rerunnable.

**Smart scheduling migration.** Then apply `supabase/migrations/202610260001_calendar_items.sql`, after `202610250001_calendar.sql`.
- It adds `calendar_events.item_type` and `completed_at`; existing rows become `event`, otherwise unchanged.
- It adds constraints that existing rows already satisfy, the private `calendar_preferences` table (RLS on, no browser privileges), an updated `persora_calendar_save_event` and the new `persora_calendar_set_task_completion`.
- It drops no data and is rerunnable.
- Deploy the code and the migration together. The new Calendar build needs the new columns, and the previous build keeps working on the upgraded schema (new rows default to `event`).
- There are no new secrets, bindings or environment variables.

No new binding or npm dependency is needed. Email reminders reuse `BREVO_API_KEY` and the sender configured in Admin → Email settings. They go only to verified addresses.

**Scheduling.** Reminders are queued in Postgres when an event is saved. Anything that triggers the dispatcher delivers them, so they don't depend on a browser timer:
1. **pg_cron + pg_net (recommended on Supabase).**
   - The migration schedules `persora-calendar-reminders` every minute when `pg_cron` exists. It skips it with a warning if not. Enable **pg_cron** and **pg_net** under Database → Extensions first, or re-run the migration after enabling them.
   - The job only calls out when a reminder is due. It needs the dispatcher URL and token in Supabase Vault: set the encrypted Pages secret `CALENDAR_REMINDER_TOKEN`, redeploy, then run in the SQL editor:

   ```sql
   select vault.create_secret('https://YOUR-DOMAIN/api/internal/calendar-reminders', 'persora_calendar_dispatch_url');
   select vault.create_secret('THE-SAME-TOKEN-AS-CALENDAR_REMINDER_TOKEN', 'persora_calendar_dispatch_token');
   ```

   - To rotate the token, update both places: `vault.update_secret(...)` and the Pages secret.
   - `select public.persora_calendar_dispatch_ping();` returns one of `idle`, `pg_net unavailable`, `vault unavailable`, `not configured`, or `requested`.
2. **External scheduler (alternative).** Any cron service can call `POST https://YOUR-DOMAIN/api/internal/calendar-reminders` every minute, with header `x-persora-cron-token: <CALENDAR_REMINDER_TOKEN>`.
3. **Built-in fallback.**
   - With neither configured, the API still dispatches due reminders after signed-in session checks (at most once a minute per worker), and whenever an open Persora tab polls reminders.
   - Reminders are then delivered late when nobody is using Persora. A late email that would arrive after the event started is skipped and recorded.

**Verify.** Create an event about 20 minutes ahead with a 15-minute reminder and **Also email me**, then close the browser. Within about a minute of the reminder time, the email arrives. The bell shows the reminder at the next sign-in, and it is never repeated. `calendar_reminders.status` becomes `sent`, with `email_status = 'sent'`. Desktop notifications appear only while a Persora tab is open, if the member allowed them.

### App launcher favorites

**Migration.** Apply `supabase/migrations/202610270001_workspace_preferences.sql` after the earlier migrations. It needs only `profiles`.
- It creates the private `workspace_preferences` table, keyed by member, with RLS on and no browser privileges. It stores each member's launcher favorites so every device shows the same set.
- It alters no existing table, drops no data and can be rerun.
- The launcher works before the migration is applied. Favorites are then kept on each device, the drawer reports that it isn't synced, and `/api/workspace/preferences` answers 503 with the migration name.
- There are no new secrets, bindings or environment variables.

### Habit Tracker

**Migration.** Apply `supabase/migrations/202610280001_habits.sql` after the earlier migrations, including `202610250001_calendar.sql`, whose reminder tick it extends.
- It creates `habits` (with a versioned schedule history, so edits never rewrite past days), `habit_checkins` (one row per habit and date, enforced by a unique constraint, and deleted with its habit), and `habit_reminders` (a delivery queue with a unique dedupe key per habit and day). It also adds their indexes and owner-scoped SECURITY DEFINER functions.
- RLS is on with no policies, and `anon`/`authenticated` have no table or function privileges. The Pages API calls the functions with the service role and passes the signed-in member's id; every statement is scoped to that member.
- It replaces `persora_calendar_dispatch_ping()` so the existing every-minute pg_cron job also wakes the dispatcher for due habit reminders. Calendar behaviour is unchanged.
- It is additive and rerunnable: it alters no existing table and drops no data.
- Until it is applied, the Habit Tracker page reports that the migration is missing (`/api/habits` answers 503 with the migration name). Nothing else is affected.

**Reminders.** There are no new secrets, bindings, environment variables or npm dependencies. Habit reminders use the same scheduling options as [Calendar reminders](#calendar-reminders): the pg_cron/pg_net tick with the same Vault secrets, an external scheduler calling `POST /api/internal/calendar-reminders` with the same `CALENDAR_REMINDER_TOKEN` (its response now includes `habits.delivered`), or the built-in fallback.
- Each reminder goes to the bell at most once per habit and day. It is skipped when the habit is not scheduled that day, is already done, or its weekly goal is met.
- Email uses `BREVO_API_KEY` and the Admin → Email sender, goes only to verified addresses, and is skipped when it would arrive more than two hours late.
- Desktop notifications need the member's browser permission and appear only while a Persora tab is open.
- Reminders never complete a habit.

**Verify.** Create a daily habit with a reminder a few minutes ahead. Check it in and undo it, then switch to Week and Month and correct yesterday. Archive and restore it (its history remains), then delete it after the confirmation. Confirm a second account sees none of it, and that a backup from **Settings** imported into another account restores the habits and check-ins (importing the same file twice adds nothing).

### Loan Tracker

**Migration.** Apply `supabase/migrations/202610290001_loans.sql` after the earlier migrations, including `202610280001_habits.sql`. It extends the same reminder tick.
- It creates four tables: `loans` (current terms, an `original_terms` snapshot, the `schedule_changes` history, status and settlement note) and `loan_installments` (one row per installment, unique per loan and number, with `paid_amount` kept equal to the recorded payments). It also creates `loan_payments` (one row per payment; the client-generated id makes a retried submission replay instead of duplicating; reversals keep the row with a reason; corrections link to the payment they replace) and `loan_reminders` (a delivery queue with one scheduled row per loan and a unique dedupe key per installment and kind). It adds their indexes and owner-scoped SECURITY DEFINER functions.
- Foreign keys tie every installment, payment and reminder to a loan of the same owner, and they are deleted with it. Check constraints stop a payment from being zero or negative and stop an installment's paid amount from exceeding its amount.
- RLS is on with no policies, and `anon`/`authenticated` have no table or function privileges. Internal helper functions are revoked from `service_role` too. The Pages API calls the public functions with the service role and passes the signed-in member's id; every statement is scoped to that member.
- It replaces `persora_calendar_dispatch_ping()` so the existing every-minute pg_cron job also wakes the dispatcher for due loan reminders. Calendar and Habit Tracker behaviour is unchanged.
- It is additive and rerunnable: it alters no existing table and drops no data.
- Until it is applied, the Loan Tracker page reports that the migration is missing (`/api/loans` answers 503). Nothing else is affected, and account export still works.

**Reminders.** There are no new secrets, bindings, environment variables or npm dependencies. Loan reminders use the same scheduling options as [Calendar reminders](#calendar-reminders): the pg_cron/pg_net tick, an external scheduler calling `POST /api/internal/calendar-reminders` with `CALENDAR_REMINDER_TOKEN` (its response now includes `loans.delivered`), or the built-in fallback after signed-in requests.
- Per loan, a member can choose a before-due reminder (on the due date, or 1, 3 or 7 days before, at 09:00 in their profile time zone) and an overdue alert (09:00 the day after the due date). Each goes to the bell at most once per installment.
- A reminder is skipped when the installment is already paid or the loan is completed or closed.
- Email uses `BREVO_API_KEY` and the Admin → Email sender, goes only to verified addresses, and is skipped when it would arrive more than 12 hours late. The email links to `/?view=loans&loan=<id>`.
- Desktop notifications need the member's browser permission and appear only while a Persora tab is open.
- Reminders never record a payment or change a status.

**Verify.** Create a borrowed monthly loan with reducing interest whose first installment is in the past, and check that the preview matches the saved schedule. Record a partial payment, then the rest (an amount above the remaining balance is refused). Correct one payment and reverse another, and confirm both originals stay in the history. Edit the rate and confirm the recalculated future installments, then check that past installments and payments are unchanged. Close the loan with a settlement note and reopen it. Confirm a second account sees none of it, and that a backup from **Settings** imported into another account restores the loans with their payments (importing the same file twice adds nothing).

### Preview deployments

For the simplest launch, configure Production first and leave Preview variables/bindings unset. If you later need working branch previews, use a separate Supabase staging project and test R2 bucket. Add staging versions of `SUPABASE_URL` and encrypted `SUPABASE_SECRET_KEY`, set `VITE_USE_PAGES_FUNCTIONS=true`, bind `VAULT_FILES` to the test bucket, and leave the bootstrap secret unset unless you intentionally need a separate one-time staging admin. Never expose production data or secrets to untrusted preview builds.

## 6. Bind the R2 bucket in Pages settings

1. In the Pages project, open **Settings → Bindings**.
2. Choose **Add → R2 bucket**.
3. Set the exact **Variable name** to:

   ```text
   VAULT_FILES
   ```

4. Select the private R2 bucket created in step 3.
5. Add it to **Production** and save. Use a separate test bucket for Preview if applicable.

`VAULT_FILES` must exactly match the API binding name. No R2 credential or code edit is needed.

## 7. Redeploy so Pages settings take effect

After saving variables/secrets or bindings, trigger a new Pages deployment: open **Deployments** and retry the latest Production build, or push a small commit to the production branch. Pages Functions receive the settings at runtime; the Vite switch is also used during the frontend build.

The browser calls `/api/*` on the same site. There is no separate API URL, Worker deployment, manual CORS allowlist, or R2 access-key setup in this deployment path.

## 8. Create the owner account and claim first-admin access

1. Visit the production Pages site and create the trusted owner account.
2. Persora signs the owner in and displays the new seven-digit Persora ID in a notice. The ID is also available in **Settings → Personal profile**; save it. Future sign-ins accept either that ID or the account email, plus the password.
3. Open `https://YOUR_PAGES_DOMAIN/admin` while signed in with that owner account.
4. Enter the temporary `ADMIN_BOOTSTRAP_SECRET` value from step 5. The server and database latch allow only one successful claim.
5. Return to **Cloudflare Pages → Settings → Variables and Secrets**, delete `ADMIN_BOOTSTRAP_SECRET`, save, and redeploy. The database latch keeps bootstrap closed even if the variable is accidentally retained.

All future administrator access requires a real Persora account with the admin role. There is no public admin preview or mock-admin bypass.

## 9. Verify the deployment

- Create an account; confirm it receives a seven-digit Persora ID and the ID appears in Settings.
- Sign out and sign back in using that ID and password.
- Add a vault record, reload the page, and verify the record persists.
- Password Manager: create a master password and add a login. On a second browser, sign in and unlock with the same master password, then check edits sync both ways. Check that **Lock vault** and a reload ask for the master password again, and that **Forgot master password?** (email code → new master password) keeps every record. The full checklist is in `PASSWORD_VAULT.md`.
- With a Free account, add/edit/delete ordinary records and confirm new file, image, PDF, document, Smart Scan, profile-photo, contact-photo and business-card image uploads are rejected. Verify contact vCard import still saves the records and skips embedded photos.
- On an active paid plan, attach a small PDF/image, open it, then let the plan expire or set its status to past due. Confirm new uploads are rejected while the existing file can still be previewed/downloaded and record CRUD still works.
- Configure Brevo, send and verify a six-digit email code in Settings, and check the badge is gray without an active paid plan and blue while the paid plan is active.
- Apply the Life Timeline migration; add a dated record; check that its due-date event appears once, links to the source record, and catches up after an offline interval.
- Post a manual timeline event with an attachment, edit it, download the file, and delete the event. Confirm timeline title/description/URL are ciphertext in `timeline_events.encrypted_payload` and the R2 object bytes are encrypted; date/type/link metadata remains queryable.
- Keep `TIMELINE_ENCRYPTION_KEY` stable and test authenticated account export includes readable timeline data and attachments.
- Calendar: apply `202610250001_calendar.sql`, then create a weekly event. Edit one occurrence (**This event**) and check the others are unchanged; delete one occurrence; switch Week/Month/Day/Agenda. Confirm a second account sees none of it. For reminders, run the check in [Calendar reminders](#calendar-reminders).
- Habit Tracker: apply `202610280001_habits.sql`, then run the check in [Habit Tracker](#habit-tracker).
- Loan Tracker: apply `202610290001_loans.sql`, then run the check in [Loan Tracker](#loan-tracker).
- Change the account password in Settings and verify the new password works.
- Confirm the R2 bucket remains private.
- Visit `/admin` as the claimed owner. Check account management, plans, payment methods/review, document types, editable Privacy/Terms/Contact pages, storage settings, service status, and audit history.
- Create or edit a storage plan. Its monthly total is **storage GB × per-GB monthly rate**; choose the display currency in admin billing settings.
- Add and verify payment method/account details, then enable manual payment requests. Members see active methods only; verify transactions outside Persora before approving. Phase one does not integrate a payment gateway.
- Review and customize the starter Privacy Policy and Terms copy for your service and jurisdiction before treating it as approved legal text.

## Which files and settings do I need to edit?

| File or setting | Action |
| --- | --- |
| `supabase/schema.sql` | Run it in Supabase SQL Editor. No credentials belong in this file. |
| `functions/api/[[path]].js` | No normal edits; it routes `/api/*` to the backend module. |
| `cloudflare/api.js` | No normal edits; Pages injects database values and the R2 binding at runtime. |
| `src/lib/auth.ts`, `src/lib/cloud.ts` | No deployment edits; they call the same-origin custom-auth API. |
| `public/favicon.svg` | Persora project favicon; included automatically in the Pages build. |
| `.env.example` | Local demo placeholder only. Do not put production values here. |
| Pages → **Settings → Variables and Secrets** | Add `VITE_USE_PAGES_FUNCTIONS`, `SUPABASE_URL`, encrypted `SUPABASE_SECRET_KEY`, and temporarily the encrypted bootstrap secret. |
| Pages → **Settings → Bindings** | Add the R2 bucket binding named `VAULT_FILES`. |

## Local demo vs. production

- `npm run dev` opens a browser-only demo; it does not provide custom sign-up or sign-in.
- Production custom accounts require the Supabase Postgres schema and Pages Function variables/secrets.
- Production values belong in Cloudflare Pages settings, not `.env`, source files, or Git.
- The local demo does not create remote accounts or upload files to R2.

## Custom-auth notes and recovery

- The seven-digit ID is a login identifier, not a password. Members must keep their password strong and save the ID.
- Password hashes use PostgreSQL `pgcrypto` bcrypt (cost 12). Sessions are random, stored server-side as hashes, and held in an `HttpOnly`, `SameSite=Lax` cookie for seven days. Sign-out, password change, suspension, and account deletion revoke sessions.
- Login accepts either the account email or seven-digit Persora ID and is rate-limited after repeated failures. Optional email verification uses a six-digit, 10-minute OTP sent through the configured Brevo account; the verification badge is gray on free/expired accounts and blue during an active paid term.
- There is no self-service password-reset email yet. Do not promise account recovery until a verified recovery flow is configured.

## Troubleshooting

- **The site stays in demo mode or sign-in is disabled:** set `VITE_USE_PAGES_FUNCTIONS=true` under the Pages **Production** environment and redeploy.
- **Requests to `/api` fail:** confirm `functions/api/[[path]].js` is committed at the repository root, the deployment succeeded, and the Pages API switch is enabled.
- **Database/auth calls return a configuration error:** check `SUPABASE_URL` and the encrypted `SUPABASE_SECRET_KEY` in Pages settings, and confirm `supabase/schema.sql` completed without errors. Never put the secret in a `VITE_` variable.
- **Signup says the Free plan is not configured:** apply `supabase/migrations/202610060001_ensure_default_free_plan.sql` or rerun `supabase/schema.sql`; verify `subscription_plans` contains an active row with slug `free`. The Pages API also creates or reactivates the default Free row during signup when the table exists.
- **Account creation fails on password hashing:** confirm the schema created `persora_hash_password` and `persora_verify_password`, and that `pgcrypto` is enabled.
- **Uploads fail or R2 reports unavailable:** confirm the binding is named exactly `VAULT_FILES`, points to the intended bucket, and the site was redeployed after adding it. New member uploads require an active paid plan; existing-file reads and record CRUD do not.
- **Email verification cannot send:** in Admin → Email settings, confirm OTP verification is enabled and a verified Brevo sender is saved; confirm `BREVO_API_KEY` exists as an encrypted Cloudflare Pages secret and that Pages was redeployed. Also confirm the email-verification migration was applied.
- **First-admin setup is unavailable:** confirm the encrypted `ADMIN_BOOTSTRAP_SECRET` is temporarily configured in Production, the schema ran, and the owner is signed in to the production site.
- **An old Supabase Auth account cannot sign in:** the old Auth password cannot be converted into the custom bcrypt hash. No automated recovery is included yet; arrange a verified migration or recovery process before changing or deleting any old data.

For Cloudflare Pages Functions routing and bindings, see the [Pages Functions routing docs](https://developers.cloudflare.com/pages/functions/routing/) and [Pages bindings docs](https://developers.cloudflare.com/pages/functions/bindings/).
