# Persora

Persora is a personal portal for the records and everyday details you want to keep together: identity and study documents, family information, medical history, contacts, business cards, subscriptions, purchases, accounts, memberships, finance, tasks, reminders, notes and useful links. The web workspace is designed to work on a phone as well as a desktop; the companion Android app is native Kotlin/Jetpack Compose.

## Product at a glance

- **Type-aware vault forms.** Choose a space and record type (for example NID, Student ID or passport); the fields adapt to that record. Family-linked records store a stable Family-member ID, so a rename does not break the association.
- **Smart Scan.** Signed-in members can scan supported documents from vault and medical-record forms. Azure Document Intelligence supplies OCR and Cloudflare Workers AI suggests structured values. Matched values go into their fields; other readable facts are kept in editable **Additional Data**. Review suggestions before saving. Additional Data is being retained as useful record context for future knowledge-base/AI-chat workflows; it is not a claim that an AI chat feature is currently available. See [`SMART_SCAN_SETUP.md`](./SMART_SCAN_SETUP.md) for providers, formats, limits and setup.
- **Contacts and business cards.** Web and Android clients share the account API. Android can import selected phone contacts in the background and show notification progress; both clients support contact and digital-card workflows.
- **More than files.** Folders, private record sharing, business-card public links, medical-record links, a life timeline, wallet cards, personal finance, tasks, reminders and alarms, storage plans and complete account export.
- **Smart Scan administration.** Admins can control scan availability and inspect aggregate usage counts without seeing document contents. Admin tools also manage accounts, document types, plans, manual payment reviews and public site content.
- **Account security.** Persora uses its own seven-digit member ID, password and server-side session flow. Email OTP verification can be enabled by an administrator and managed from member Settings.

## Architecture and project layout

The website is a React + Vite app hosted on Cloudflare Pages. Pages Functions provide its same-origin `/api/*` backend. Supabase provides Postgres only; Cloudflare R2 stores private attachments. The Android client uses the same Pages API, account database, private files and session service. Neither browser code nor the APK contains Supabase or provider secret keys.

- `src/` — web app, responsive portal, forms, workspace and admin UI.
- `functions/api/[[path]].js` — Pages API route adapter.
- `cloudflare/api.js`, `cloudflare/smart-scan.js`, `cloudflare/timeline.js` — server-side API, scanning and timeline logic.
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

For a **new Supabase database**, run all of [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. It creates the current profile/authentication, vault/folder, contacts, card, sharing, medical, timeline, scan, verification, billing, admin, RLS, index, trigger and function definitions, plus baseline settings and plan data.

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
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Encrypted Cloudflare Pages secret | Server-side Smart Scan OCR endpoint. |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Encrypted Cloudflare Pages secret | Server-side Azure OCR credential; never expose it to the frontend. |
| `AI` | Cloudflare Workers AI binding | Server-side Smart Scan extraction; this is a binding, not a frontend API key. |

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
- Complete account backups are available from **Settings → Download a backup**. Password hashes, session tokens and other users' private records are not included.

See [`CONTACTS.md`](./CONTACTS.md), [`ACCOUNT_DATA.md`](./ACCOUNT_DATA.md) and [`BUSINESS_CARDS.md`](./BUSINESS_CARDS.md) for their current workflows and data behavior. Legal copy in the admin console is editable starter text and requires review for the service's jurisdiction before being treated as final legal advice.
