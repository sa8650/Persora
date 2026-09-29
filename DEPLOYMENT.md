# Persora — Cloudflare Pages deployment

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
3. Open `supabase/schema.sql`, copy the entire file into the SQL Editor, and run it. It creates Persora profiles, seven-digit login IDs, password hashes, server-side sessions, rate-limit state, vault/billing/admin tables, RLS policies, and restricted Postgres functions.
4. In **Project Settings → API Keys** (sometimes shown as **Settings → API**), copy and keep ready:
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
| `ADMIN_BOOTSTRAP_SECRET` | A newly generated random value | **Encrypted secret; temporary** | Allows the first trusted owner to claim administrator access once. Remove after step 8. |

Generate the bootstrap value locally, for example:

```bash
openssl rand -hex 32
```

Copy its output directly into the encrypted `ADMIN_BOOTSTRAP_SECRET` field. Do not put it in a source file, `.env`, GitHub, Pages build logs, or a `VITE_` variable. Keep it only until the first admin claim is complete.

**No `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, or Supabase anon key is needed.** `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are read by Pages Functions; only the Pages API switch is exposed to the Vite build. Never use a `VITE_` prefix for the secret key—Vite would publish it in the browser bundle.

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
- Attach a small PDF or image, open the record, and confirm the file is served only after signing in.
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
- Login accepts either the account email or seven-digit Persora ID and is rate-limited after repeated failures. Email is not verified by an email provider.
- There is no self-service password-reset email yet. Do not promise account recovery until a verified recovery flow is configured.

## Troubleshooting

- **The site stays in demo mode or sign-in is disabled:** set `VITE_USE_PAGES_FUNCTIONS=true` under the Pages **Production** environment and redeploy.
- **Requests to `/api` fail:** confirm `functions/api/[[path]].js` is committed at the repository root, the deployment succeeded, and the Pages API switch is enabled.
- **Database/auth calls return a configuration error:** check `SUPABASE_URL` and the encrypted `SUPABASE_SECRET_KEY` in Pages settings, and confirm `supabase/schema.sql` completed without errors. Never put the secret in a `VITE_` variable.
- **Account creation fails on password hashing:** confirm the schema created `persora_hash_password` and `persora_verify_password`, and that `pgcrypto` is enabled.
- **Uploads fail or R2 reports unavailable:** confirm the binding is named exactly `VAULT_FILES`, points to the intended bucket, and the site was redeployed after adding it.
- **First-admin setup is unavailable:** confirm the encrypted `ADMIN_BOOTSTRAP_SECRET` is temporarily configured in Production, the schema ran, and the owner is signed in to the production site.
- **An old Supabase Auth account cannot sign in:** the old Auth password cannot be converted into the custom bcrypt hash. No automated recovery is included yet; arrange a verified migration or recovery process before changing or deleting any old data.

For Cloudflare Pages Functions routing and bindings, see the [Pages Functions routing docs](https://developers.cloudflare.com/pages/functions/routing/) and [Pages bindings docs](https://developers.cloudflare.com/pages/functions/bindings/).