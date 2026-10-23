# Password Manager: master password, storage, sync and reset

This describes how Persora's Password Manager works since the
`202610240001_password_vault_master_password.sql` release. It replaces the
earlier browser-encryption design (Argon2id-derived keys, AES-256-GCM
ciphertext, server-held escrow key), which has been removed. See
[Upgrading from the encrypted release](#upgrading-from-the-encrypted-release).

## What the master password is, and isn't

- Each member creates **one master password** the first time they open the
  Password Manager. The same master password opens the vault on every device
  signed in to their Persora account. It is separate from the Persora sign-in
  password, and the server refuses a master password equal to the sign-in password.
- The master password is an **access gate, not an encryption key**. It controls
  who may read or change the records. It is not used to encrypt them, and no
  key is derived from it.
- Records are **not encrypted by Persora's code**, neither per record nor in the browser.
  They are stored as JSON in the existing Supabase Postgres database and are
  protected by:
  - Supabase's provider-managed encryption at rest and TLS in transit;
  - row-level security and revoked privileges, so browser database roles have no access;
  - a server-side master-password check before any record is returned or changed.
- No keys exist for members or operators to manage. The Password Manager uses no
  Persora application encryption key, Cloudflare encryption secret, or
  escrow key.
- Anyone with service-role database access (Persora operators, the Supabase
  project, and a database backup) can read the records. This is a
  server-trusted design, not zero-knowledge.

## How the master password is stored and verified

- `password_vaults.master_password_hash` holds a salted **bcrypt** hash (cost 12).
  It is made by pgcrypto's `crypt()`/`gen_salt('bf', 12)`, the same native
  implementation Persora's sign-in passwords use. The master password itself is
  never stored or logged.
- Length: 10 characters minimum and 72 bytes maximum (bcrypt's input limit).
- Verification happens inside the SECURITY DEFINER function
  `persora_vault_unlock`. The Worker sends the candidate over TLS; the function
  compares it with `crypt()` and only then opens a vault session.
- **Rate limit:** 5 wrong master passwords block unlocking for 15 minutes on
  every device. This reuses the existing `auth_login_attempts` limiter, with its
  own per-member key. A successful email reset clears the block.

## Vault sessions: how the backend enforces the gate

`POST /api/password-vault/unlock` returns a random 256-bit **vault token**. The
browser keeps it in memory only, never in storage, and sends it as
`X-Persora-Vault-Token`. Every record route requires both the Persora sign-in
cookie and a valid vault token. Without both, the API answers `403 vault_locked`
and returns no records.

`password_vault_sessions` stores only the token's SHA-256 hash. Each token is
bound to the member *and* to the Persora sign-in session it was issued under:

| Rule | Value |
| --- | --- |
| Idle timeout (sliding) | 30 minutes |
| Absolute lifetime | 12 hours |
| Open vault sessions per member | 20 (oldest dropped) |
| Signing out of Persora | deletes that sign-in session's vault sessions (FK cascade) |
| **Lock vault**, or leaving the Password Manager | token revoked on the server |
| Reloading or closing the page | token forgotten by the browser (never persisted); the server copy expires after 30 idle minutes |
| Master password reset | revokes every vault session of the member |

A token copied to another member, or to another sign-in session of the same
member, is rejected.

## Storage and sync

`password_vault_items` has one row per record: `id`, `user_id`, `revision`,
`change_seq`, `deleted`, `data` (jsonb, ≤64 KiB), and timestamps.

- `data` holds the entry fields: title, login, password, URL, notes, security
  questions, folder, favourite/pinned flags, updated time and the 7-day Trash
  state.
- Deletes keep a tombstone row (`deleted = true`, `data = null`), so other
  devices learn about the delete.
- Every change gets a new value from the global sequence. Devices fetch
  `GET /items?since=<cursor>` every 30 seconds while unlocked, and also when
  the window regains focus.
- Writes carry each record's base `revision`. If another device changed the
  record first, the API returns `409 conflict`; the device reloads the newer
  version and tells the member, so nothing is overwritten silently.
- Limits: 5,000 live records per member and 1,000 changes per request. Field
  sizes are capped, e.g. passwords at 4,096 characters and notes at 20,000.
- **Database access:**
  - RLS is enabled on every vault table, with no policies.
  - `anon` and `authenticated` have no table or function privileges.
  - `service_role` (the Worker) may only execute the public `persora_vault_*`
    functions. Internal helpers that skip checks are revoked even from `service_role`.

## Forgot master password? (email OTP reset)

The unlock screen offers **Forgot master password?**:

1. **Send email OTP** sends a 6-digit code to the email address registered on the
   signed-in Persora account. Brevo delivers it, the same as other Persora OTPs.
   - The code expires after 10 minutes and works once.
   - Only an HMAC of it is stored, in `password_vault_recovery_codes`.
   - One send per 60 seconds, 5 per hour.
2. **Verify code**: 5 wrong attempts invalidate the code. A correct code is
   deleted (single use) and exchanged for a **15-minute, single-use reset
   grant**, bound to that member and sign-in session. Only the grant's hash is stored.
3. **Set new master password**:
   - The bcrypt verifier is replaced.
   - All vault sessions, failed-unlock counters and outstanding codes are cleared.
   - The device is unlocked.

   Every other device must use the new master password next time.

**Records are untouched by a reset**: no deletion, no re-encryption, no
rewrite. The automated tests compare the item rows byte-for-byte before and
after.

This is account-based recovery: someone who controls both the signed-in Persora
session and the registered mailbox can set a new master password and read the
records.

## Upgrading from the encrypted release

The previous release kept each record as AES-256-GCM ciphertext under a data
key wrapped by an Argon2id-derived key, plus a copy sealed to the
`PASSWORD_VAULT_ESCROW_PRIVATE_KEY` escrow key. The rollout converts every
record to plain JSON, **keeping ids, revisions, tombstones, Trash state and
ownership**. It does not need Argon2id: it opens the escrowed data key with the
escrow private key, decrypts and authenticates each record, and stores the JSON.

**Old master passwords can't be carried over.** They were never stored, and
verifying them would need Argon2id. After the upgrade, members whose vault
held records go straight to **"Set your new master password"**, without an OTP,
and find all their saved passwords there.

> ⚠️ Accepted trade-off (owner decision): until a migrated member sets their new
> master password, anyone using that member's signed-in Persora session can set
> it and see the records. That is the same exposure as signing in to Persora
> itself. Encourage members to open the Password Manager soon after the upgrade.
> To audit, list who hasn't set one yet:
> `select user_id from password_vaults where master_password_hash is null;`

On-device vaults from before sync (localStorage `v1`/`v2`, PBKDF2) are imported
into the synced vault the first time the member unlocks on that device, then
removed from the device. If the local vault used a different password, the
member can enter that password, or the v2 offline recovery key, in the banner.
Demo-mode local vaults from the encrypted release (format v3, browser-only
demo data) are not carried over. Demo vaults always stay on the device.

### Runbook (production)

Order matters: the cleanup migration refuses to run while anything is unconverted.

1. **Back up.** Take a Supabase backup or a PITR marker. Keep
   `PASSWORD_VAULT_ESCROW_PRIVATE_KEY` (and `PASSWORD_VAULT_ESCROW_RETIRED_KEYS`
   if you rotated) in Cloudflare Pages for now.
2. **SQL:** run `supabase/migrations/202610240001_password_vault_master_password.sql`
   in the Supabase SQL editor. It is additive: the currently deployed release keeps
   working, and anything it writes later is still converted.
3. **Deploy** this release to Cloudflare Pages. From now on, a member's records
   are converted automatically the first time they open the Password Manager.
4. **Convert everyone else** with either option:
   - Signed in as an administrator, call
     `POST /api/password-vault/admin/migrate-legacy` with body `{}`, or
     `{"dryRun": true}` first. Repeat until the response shows `"pending": 0`.
     Example from the browser console on the production site:
     `await (await fetch('/api/password-vault/admin/migrate-legacy', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).json()`
   - Or, if you have an offline copy of the escrow key:
     `SUPABASE_URL=… SUPABASE_SECRET_KEY=… PASSWORD_VAULT_ESCROW_PRIVATE_KEY='<jwk>' npm run vault:migrate-legacy -- --dry-run`,
     then without `--dry-run`. It exits non-zero while anything is pending.

   `failed` lists `{userId, records, reason}` and never record contents:
   - `escrow_key_unavailable`: add the older key to
     `PASSWORD_VAULT_ESCROW_RETIRED_KEYS` (a JSON array of JWKs) and re-run.
   - `record_unreadable` / `escrow_unreadable`: the stored ciphertext fails
     authentication. Investigate before continuing; the cleanup will not run.
5. **Verify** in SQL: `select count(*) from password_vault_items where data is null and not deleted;` must be `0`.
6. **SQL:** run `supabase/migrations/202610240002_password_vault_drop_legacy_encryption.sql`.
   It re-checks step 5, raises without changing anything if records remain, and
   then drops the legacy columns, trigger and functions.
7. **Remove the old key material:**
   - Delete the Pages secrets `PASSWORD_VAULT_ESCROW_PRIVATE_KEY` and
     `PASSWORD_VAULT_ESCROW_RETIRED_KEYS`, and destroy offline copies after your
     backup retention period.
   - In a follow-up commit, delete `cloudflare/password-vault-legacy-migration.js`,
     the `/admin/migrate-legacy` route and lazy-migration call in
     `cloudflare/password-vault.js`, `scripts/migrate-password-vault-legacy.mjs`,
     the `vault:migrate-legacy` npm script, `tests/password-vault-migration.test.mjs`
     and `tests/fixtures/legacy-password-vault-crypto.ts`.
8. **Smoke test** (see below).

Rollback: before step 6, redeploying the previous release still works, because
the conversion leaves its ciphertext columns in place. After step 6, restore
from the step 1 backup.

## Verifying

Automated (`npm test`):

- `tests/password-vault.test.mjs` drives the real browser client against the
  real Worker handler and the real SQL, in PGlite with pgcrypto and the full
  schema plus all migrations. It covers:
  - setup;
  - multi-device unlock;
  - wrong-password lockout;
  - CRUD and sync;
  - conflicts;
  - token, session, idle and logout enforcement;
  - OTP reset with byte-for-byte record checks, plus the expiry, attempt, send
    and grant limits;
  - RLS and privileges;
  - the demo backend.
- `tests/password-vault-migration.test.mjs`:
  - writes vaults with the frozen retired crypto module through the retired SQL
    functions, then converts them;
  - re-converts writes from a still-running old release;
  - covers retired escrow keys and a missing key;
  - proves the cleanup guard;
  - imports local v1/v2 vaults.

Browser end-to-end (`npm run build && npm run test:e2e:vault`). This needs
PostgreSQL server binaries (`PG_BIN`), a PostgREST binary (`POSTGREST_BIN`)
and Playwright (`PLAYWRIGHT_MODULE`). It runs:

- real PostgreSQL;
- PostgREST, standing in for Supabase's `/rest/v1`;
- the real Worker;
- the production UI, in two or more browser contexts.

It walks the whole rollout above (seeded legacy vaults → 0001 → lazy and CLI
conversion → 0002) and every member flow.

Manual production smoke test after deploying:

1. Open Password Manager and create a master password.
2. Add a login.
3. On a second device, or in a private window, sign in, enter the master
   password and see the login. Edit it and check the change appears on the
   first device.
4. Check **Lock vault**, then reload: the master password is asked again.
5. Use **Forgot master password?**: receive the code, set a new master
   password, and check that the records are all still there. The other device
   locks and accepts only the new master password.
6. While signed in but locked, `fetch('/api/password-vault/items')` from the
   console returns `403`.
