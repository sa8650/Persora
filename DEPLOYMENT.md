# Persora Deployment Guide (Cloudflare Pages + Supabase + R2 + Brevo)

Persora runs as a single Cloudflare Pages deployment:

- **Static SPA:** Built with `npm run build` (`tsc -b && vite build`) into `dist/`.
- **API (`/api/*`):** Served same-origin by Cloudflare Pages Functions (`functions/api/[[path]].js` → `cloudflare/*.js`).
- **Database:** Supabase PostgreSQL accessed server-side only via `SUPABASE_URL` + `SUPABASE_SECRET_KEY`.
- **Object storage:** Private Cloudflare R2 bucket bound as `VAULT_FILES`.

---

## 1. Provision Supabase PostgreSQL

1. Create a Supabase project (PostgreSQL 15+). Persora uses its own session/bcrypt authentication (`profiles`, `user_sessions`, `password_recovery_codes`) rather than Supabase Auth.
2. **Fresh database:** Open **SQL Editor** and run [`supabase/schema.sql`](./supabase/schema.sql). It is idempotent and provisions **every** Persora table, index, constraint, RLS policy, trigger, and `SECURITY DEFINER` RPC (including Password Manager, Calendar, Habits, Loans, Projects, Persora Table, Photo Studio, PDF Studio, Global Trash, Connections, Billing, and Admin Audit).
3. **Upgrading an existing database:** Apply any unapplied migration in [`supabase/migrations/`](./supabase/migrations/) (such as `supabase/migrations/20261026000000_calendar_multiday_resize.sql`) before deploying.
4. Copy the **Project URL** (`SUPABASE_URL`) and **Secret / service_role key** (`SUPABASE_SECRET_KEY`) from **Project Settings → API**. Keep `SUPABASE_SECRET_KEY` server-only.

---

## 2. Provision Cloudflare R2

1. Create a private R2 bucket (for example `persora-vault-files`). Do **not** enable public bucket access; all files stream through authenticated `/api/*` handlers (or `/api/public-cards/<CARD_ID>/photo` while a business card is explicitly public).
2. Bind the bucket to your Cloudflare Pages project under **Settings → Bindings → R2 bucket** with variable name `VAULT_FILES` (both Production and Preview).

---

## 3. Configure Cloudflare Pages build, variables, secrets, and bindings

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node.js version:** `20` or `22`

### Required settings

| Name | Kind | Notes |
| --- | --- | --- |
| `VITE_USE_PAGES_FUNCTIONS` | Plain-text build variable (`true`) | Routes frontend API calls to `/api/*` instead of local demo mode. |
| `SUPABASE_URL` | Plain-text variable | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Encrypted secret | Server-only Supabase secret key. |
| `VAULT_FILES` | R2 binding | Private R2 bucket for member attachments and studio files. |
| `TIMELINE_ENCRYPTION_KEY` | Encrypted secret | ≥32 random bytes (base64/hex/passphrase) for Life Timeline AES-256-GCM encryption. Back this up securely; rotating without re-encrypting makes existing timeline ciphertext unreadable. |

### Recommended / feature settings

| Name | Kind | Notes |
| --- | --- | --- |
| `ADMIN_BOOTSTRAP_SECRET` | Temporary encrypted secret | Used once at `/admin` to promote the first administrator; delete immediately afterwards. |
| `BREVO_API_KEY` | Encrypted secret | Enables Brevo transactional emails (account password recovery OTPs, email verification OTPs, Password Manager recovery OTPs, and Calendar/Habit/Loan reminders). Sender defaults can be managed in **Admin → Email settings** or via `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`. |
| `AI` | Workers AI binding | Enables Smart Scan field extraction, AI password word suggestions, and Photo Studio cloud background removal (`bria/remove-background`). |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Encrypted secrets | Enables Smart Scan OCR (`prebuilt-read`). See [`SMART_SCAN_SETUP.md`](./SMART_SCAN_SETUP.md). |
| `CONNECTIONS_ENCRYPTION_KEY` | Encrypted secret | ≥32 random chars for encrypting `integration_settings` and `user_connections` grants (falls back to `TIMELINE_ENCRYPTION_KEY`). |
| `EMS_INTEGRATION_SECRET`, `EMS_API_BASE_URL` | Optional secret / variable | Environment overrides for **Admin → Integrations → EMS**. |
| `CALENDAR_REMINDER_TOKEN` | Optional encrypted secret | Shared token (`x-persora-cron-token`) for `POST /api/internal/calendar-reminders` (processes Calendar, Habit, and Loan reminders). |
| `TRASH_PURGE_TOKEN` | Optional encrypted secret | Shared token (`x-persora-cron-token`) for `POST /api/internal/trash-purge` (purges expired >7-day Trash items and unreferenced R2 objects). |
| `PHOTO_STUDIO_AI_GATEWAY` | Optional variable | Cloudflare AI Gateway ID for Bria RMBG 2.0 (`default` if unset). |
| `VITE_PHOTO_STUDIO_MODEL_BASE`, `VITE_PHOTO_STUDIO_ORT_WASM_BASE` | Optional build variables | Self-hosted CDN overrides for Photo Studio on-device ORMBG ONNX model and ORT WASM runtime. |

---

## 4. Scheduled background jobs (optional but recommended)

Persora runs opportunistic sweeps during authenticated API traffic, and supports deterministic background scheduling via Supabase `pg_cron` + `pg_net` or an external scheduler (Cloudflare Worker Cron Trigger, GitHub Actions, or uptime cron):

- **Reminders (every minute):** `POST https://<your-domain>/api/internal/calendar-reminders` with header `x-persora-cron-token: <CALENDAR_REMINDER_TOKEN>`.
- **Trash expiry purge (hourly):** `POST https://<your-domain>/api/internal/trash-purge` with header `x-persora-cron-token: <TRASH_PURGE_TOKEN>` (also scheduled inside Postgres when `pg_cron` is enabled via `persora-trash-expiry-purge`).

---

## 5. First-deploy verification checklist

1. Sign up a member account, verify `/api/auth/me` establishes an `HttpOnly` `persora_session` cookie, and claim administrator access at `/admin` using `ADMIN_BOOTSTRAP_SECRET` (then remove `ADMIN_BOOTSTRAP_SECRET`).
2. Upload a vault file and a contact photo to confirm `VAULT_FILES` R2 read/write and ReUI `Progress` upload reporting.
3. Configure Brevo in **Admin → Email settings** and verify email OTP delivery (Settings verification + Forgot Password flow).
4. Run `npm test` and `npm run build` in CI before promoting production releases.
