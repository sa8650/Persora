# Persora

Persora is a personal digital management platform for documents, academic records, subscriptions, family details, purchases and warranties, online accounts, memberships, study materials, digital identity, and saved links.

The app is built with React + Vite. Cloudflare Pages hosts the static site and its same-origin Pages Functions API; Supabase provides Postgres only; Cloudflare R2 stores private attachments. **The database URL/key, server secrets, and R2 binding are configured in Cloudflare Pages project settings.** The API runs inside Pages Functions—there is no separate Worker deployment.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the step-by-step setup and exactly where each value belongs. For the Contacts feature's authenticated API, schema migration, and Android integration notes, see [`CONTACTS.md`](./CONTACTS.md). For Digital business cards, public URL behavior, privacy, and API details, see [`BUSINESS_CARDS.md`](./BUSINESS_CARDS.md). Combined storage quotas, private contact/card sharing, and complete account exports are documented in [`ACCOUNT_DATA.md`](./ACCOUNT_DATA.md). This repository does not contain the Android app source; the shared Contacts API contract is ready for that client to consume.

## Run the local demo

```bash
npm install
npm run dev
```

Local Vite mode opens the demo workspace. Demo records are stored in this browser's local storage; uploaded demo files stay in memory and are not written to local storage. Use **Explore the demo** to try the workspace. Online sign-in requires the deployed Pages Functions API. There is no mock-admin mode or admin preview bypass.

To create a production build:

```bash
npm run build
```

## Custom accounts and sign-in

- Persora does **not** use Supabase Auth. Each account receives a random seven-digit Persora ID at registration; the ID appears in **Settings → Personal profile**.
- Members can sign in with either their email address or seven-digit Persora ID plus password. Email is profile/contact information; it is not verified by an email provider.
- Password hashes are produced with PostgreSQL `pgcrypto` bcrypt (cost 12) through server-only Pages Function calls. Sessions use random, server-stored token hashes and an `HttpOnly`, `SameSite=Lax` cookie scoped to `/api`; sessions expire after seven days. Failed sign-ins are rate-limited.
- Members can change their password in Settings. Password-reset emails and email verification are not implemented, so there is no self-service recovery flow yet.

## Where configuration belongs

| Item | Where it goes | Notes |
| --- | --- | --- |
| Database schema | Run `supabase/schema.sql` in Supabase SQL Editor | Includes custom account/session tables and restricted database functions. Never put credentials in this file. |
| Supabase project URL | Cloudflare Pages → Settings → Variables and Secrets → `SUPABASE_URL` | Plain server-side variable; it is not a `VITE_` variable. |
| Supabase secret key | Cloudflare Pages → Settings → Variables and Secrets → `SUPABASE_SECRET_KEY` | Encrypted secret used only by Pages Functions. Never expose it with a `VITE_` name. |
| Timeline encryption key | Cloudflare Pages → Settings → Variables and Secrets → `TIMELINE_ENCRYPTION_KEY` | Required before the first timeline post; use `openssl rand -hex 32`. Keep it backed up and unchanged; rotating/removing it without re-encrypting makes existing timeline content unreadable. |
| Pages API switch | Cloudflare Pages → Settings → Variables and Secrets → `VITE_USE_PAGES_FUNCTIONS=true` | Build-time value that makes the frontend call same-origin `/api/*`. |
| First-admin setup secret | Same Pages settings → `ADMIN_BOOTSTRAP_SECRET` | Temporary encrypted secret. Remove after the first administrator claims setup. |
| Private file bucket | Cloudflare Pages → Settings → Bindings → Add → R2 bucket; name it `VAULT_FILES` | Select a private bucket; no R2 access keys are needed. |
| Pages Functions API | Already in `functions/api/[[path]].js` | Serves the API from the same Pages origin. No separate API URL or CORS allowlist is required. |

Keep `VITE_USE_PAGES_FUNCTIONS=false` for local demo mode. Production values belong in Cloudflare Pages settings, not in `.env`, source code, or Git.

## Important files

- `functions/api/[[path]].js` — Cloudflare Pages routing adapter for `/api/*`.
- `cloudflare/api.js` — custom authentication, session, vault, admin, billing, owner-scoped medical-record, and private-file API logic.
- `cloudflare/timeline.js` — owner-scoped timeline routes, AES-256-GCM payload/file encryption, and date-based catch-up.
- `supabase/schema.sql` — Postgres tables, RLS, bcrypt functions, login rate limiter, plans, payments, and first-admin latch. Existing databases should apply [`supabase/migrations/20260930_add_notes_section.sql`](./supabase/migrations/20260930_add_notes_section.sql), [`supabase/migrations/20260930_document_sharing.sql`](./supabase/migrations/20260930_document_sharing.sql), [`supabase/migrations/20260930_business_cards.sql`](./supabase/migrations/20260930_business_cards.sql), [`supabase/migrations/20260930_account_sharing_and_card_styles.sql`](./supabase/migrations/20260930_account_sharing_and_card_styles.sql), then [`supabase/migrations/20261001_life_timeline.sql`](./supabase/migrations/20261001_life_timeline.sql), and [`supabase/migrations/202610010001_medical_records.sql`](./supabase/migrations/202610010001_medical_records.sql) in the Supabase SQL Editor before deploying these features.
- `src/lib/auth.ts` — frontend calls for custom sign-in, sign-up, session restore, and sign-out.
- `src/lib/cloud.ts` — same-origin Pages API client; browser requests never hold the database secret or session token.
- `src/components/ContactsView.tsx` and `cloudflare/api.js` — Contacts UI and owner-scoped Contacts API routes; see `CONTACTS.md` for mobile-client details.
- `src/components/BusinessCardsView.tsx`, `src/components/PublicBusinessCardPage.tsx`, and `cloudflare/api.js` — private card manager, unauthenticated public-card page, and owner-scoped/public API routes; see `BUSINESS_CARDS.md`.
- `public/favicon.svg` — Persora favicon.
- `.env.example` — local demo placeholder only. Do not place production secrets there.

## Admin and billing

The administrator console lives at `/admin` and requires a real signed-in administrator. First-admin setup uses a one-time secret available only to the Pages Function; a database latch allows a successful claim only once. The console manages accounts, storage plans and per-GB pricing, currency, configurable payment methods, document types, manual payment review, editable Privacy/Terms/Contact pages, storage controls, service status, and audit history. Admins can see account metadata and aggregate storage usage—not private document contents or attachment names. Starter Privacy Policy and Terms copy is editable draft text and needs jurisdiction-specific legal review before being treated as approved.

Subscription totals are calculated as **storage GB × the administrator-set monthly per-GB rate**. Payment collection is manual in phase one: members submit an external transaction reference and an admin verifies or rejects it. **No payment gateway is integrated.**

## Privacy and data model

- Persora handles passwords and sessions itself; Supabase Auth is not used. Password hashes stay in the database, and session tokens are stored as hashes.
- Browser clients do not connect directly to the database. RLS and revoked browser-role privileges keep access behind the authenticated Pages Function.
- Pages Functions check the session and account/admin status before protected operations. Vault queries are scoped to the current internal account UUID; the public seven-digit login ID is separate.
- R2 remains private. Object keys are owner-scoped, and the API serves an attachment only to its owner.
- Life Timeline post text, external URLs, attachment metadata, and attachment bytes are encrypted with AES-256-GCM by the authenticated Pages API before database/R2 storage. This is server-side encryption at rest, not end-to-end encryption: the service can decrypt content to render it for the signed-in owner. Event dates, event type, and linked record IDs remain separate queryable metadata; the encryption key must remain stable.
- Automatic timeline dates are calculated locally while the app is open and rescanned by the server on authenticated sync. A closed browser is not a background scheduler.
- Membership, saved-link, and contact QR codes are generated locally in the browser.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for Cloudflare Pages variables/secrets, the `VAULT_FILES` R2 binding, database setup, first-admin bootstrap, and verification steps.
