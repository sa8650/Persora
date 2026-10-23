# Password Manager: encryption, sync and master-password recovery

This document describes how Persora's Password Manager protects saved logins,
how it syncs them between devices, and how "Forgot master password?" works.
It is meant to be read by members, operators and reviewers.

> **Important: this is not a zero-knowledge design.** Your saved passwords are
> encrypted in your browser and Persora's database stores only ciphertext. To
> make email recovery possible, a copy of your vault key is also escrowed to a
> recovery key that the Persora server holds. Whoever controls that server key
> **and** the database (Persora operators, or an attacker who compromises both)
> can decrypt vaults. Email recovery is therefore a **trusted recovery
> mechanism**: you are trusting Persora to only use the escrow after you prove
> control of your account email. If you need a vault that nobody but you can
> ever open, use a password manager without email recovery.

## What is stored where

| Data | Where | Form |
| --- | --- | --- |
| Titles, usernames, passwords, URLs, notes, security questions/answers, favourite/pin/trash state | `password_vault_items` | One AES-256-GCM ciphertext per login |
| Vault key (DEK, 256-bit random) | `password_vaults.wrapped_dek` | AES-256-GCM-wrapped with a key derived from your master password |
| Argon2id parameters and salt | `password_vaults.kdf`, `.salt` | Plain (not secret) |
| Key check | `password_vaults.key_check` | AES-GCM ciphertext of a constant, used to confirm a key is correct |
| Escrow copy of the vault key | `password_vaults.escrow` | ECIES (ECDH P-256 + HKDF-SHA-256 + AES-256-GCM) sealed to the server recovery public key |
| Server recovery private key | Cloudflare Pages secret `PASSWORD_VAULT_ESCROW_PRIVATE_KEY` | Never stored in the database |
| Email OTP | `password_vault_recovery_codes` | HMAC-SHA-256 hash only |
| Recovery grant | `password_vault_recovery_grants` | SHA-256 hash only |
| Master password, plaintext entries, unwrapped vault key | Nowhere | Never sent to Persora and never logged |

Folders used to organise passwords are ordinary Persora folders (folder scope
`password-manager`). Folder *names* are not encrypted; which folder each login
is in is stored only inside the encrypted entry.

## Cryptography

All of this runs in the browser (`src/lib/password-vault-crypto.ts`) with
WebCrypto and the MIT-licensed `hash-wasm` Argon2id implementation, which is
loaded only when the Password Manager opens.

- **Key derivation:** Argon2id (v1.3) with a random 16-byte salt, 64 MiB of
  memory, 3 iterations and parallelism 1, producing a 32-byte key. The
  parameters are stored with each vault so they can be raised later. Browser
  and server both refuse anything weaker than 19 MiB / 2 iterations.
- **Vault key:** a random 256-bit DEK, wrapped with AES-256-GCM under the
  Argon2id key. A wrong master password fails AES-GCM authentication, so it is
  detected without the server ever checking passwords.
- **Entries:** each login is encrypted separately with AES-256-GCM under the
  DEK, using a fresh 96-bit IV every time it is saved.
- **Binding:** every ciphertext uses AES-GCM additional data containing your
  member id, the key generation and (for entries) the entry id. A ciphertext
  copied to another account, another entry or an older key generation fails
  authentication.
- **Escrow:** when a vault is created (or its key is replaced), the browser
  seals the DEK to the server recovery public key with ECIES. The server opens
  the escrow copy once to check it holds the right key, so recovery cannot fail
  silently later, and then discards the plaintext key.

## Setup, unlock and sync

1. **First visit:** you create a master password (at least 10 characters,
   entered twice). It is separate from your Persora login password. The browser
   generates the DEK, wraps it, creates the escrow copy and uploads the empty
   vault. You never have to save or manage a key yourself.
2. **Unlock (any device):** the browser downloads the wrapped key and the
   ciphertexts, derives the Argon2id key from your master password, unwraps the
   DEK and decrypts your entries locally. After five wrong attempts in a row the
   page waits 30 seconds before allowing another try, doubling up to 5 minutes
   (reloading the page resets this). The real protection against guessing is
   Argon2id itself, which makes every guess slow.
3. **Saving:** only changed entries are re-encrypted and sent. Each change
   carries the revision it was based on. If another device changed the same
   entry first, the server rejects the write (`409`), the browser reloads the
   newer version and asks you to repeat the change. Nothing is silently
   overwritten.
4. **Sync:** while the vault is unlocked it pulls changes every 30 seconds and
   whenever the window regains focus. Deletions sync as tombstones. "Lock
   vault" drops the key from memory.

## Forgot master password (trusted email recovery)

1. **Send code:** `POST /api/password-vault/recovery/send` emails a six-digit
   code to the registered address of the signed-in account. Codes expire after
   10 minutes. You can request a new one at most once a minute and five times
   an hour. Only an HMAC of the code is stored.
2. **Verify code:** `POST /api/password-vault/recovery/verify`. Each code
   allows five attempts and then must be replaced. A correct code is deleted
   immediately (single use). In the same transaction the server issues a
   random **recovery grant**: only its hash is stored, it is valid for
   15 minutes and it belongs to your account only.
3. **Release key:** `POST /api/password-vault/recovery/key`. The browser sends
   the grant and the public half of a fresh ephemeral ECDH key. The server opens
   the escrowed DEK with its private key and re-seals it to that ephemeral key,
   so it is never returned in the clear. A grant can release the key **once**.
4. **Re-encrypt:** the browser checks the released key against the key check
   and decrypts every entry. If any entry fails, it stops and nothing is
   changed. It then generates a **new** DEK, re-encrypts every entry under it,
   wraps the new DEK with your new master password (new Argon2id salt) and
   seals a new escrow copy.
5. **Commit:** `POST /api/password-vault/recovery/complete` stores all of this
   in one database transaction. The server first checks:
   - the grant has been used to release the key and has not expired;
   - the key generation is unchanged;
   - the submitted entries are **exactly** the stored live entries, so no
     password can be dropped.

   The grant and any outstanding OTP are then consumed.
6. **Other devices:** they notice the new key generation on their next sync or
   save, lock themselves and ask for the new master password. Writes made with
   the old key are refused.

The old master password stops working immediately, and the old vault key is no
longer used for anything.

## Access control

- Every `/api/password-vault/*` route requires a valid Persora session.
- Routes act only on the signed-in member's id; no route accepts a vault or
  user id from the client.
- The tables have row-level security enabled with no policies. The `anon` and
  `authenticated` roles have no table, sequence or function privileges, so only
  the Pages Functions (service role) can reach the data.
- Request bodies are size-limited and strictly validated (base64 lengths,
  UUIDs, KDF bounds, at most 5,000 logins and 64 KiB per encrypted login).
  Server logs record only the failing database function, an HTTP status or an
  error type, never request bodies, codes, grants or keys.

## Migration from the earlier on-device vault

Before encrypted sync, vaults were stored only in the browser's localStorage
(`persora-password-vault-v1:<member id>`), protected by PBKDF2, and v2 vaults
had an offline recovery key. Those formats are now only *read*:

- **No synced vault yet:** when you unlock with your existing master password,
  the browser decrypts the old vault and creates the Argon2id vault with the
  same master password. It uploads every entry, downloads and decrypts them
  again to verify, and only then deletes the local copy. If any step fails, the
  local copy is kept.
- **A synced vault already exists:** a local vault with the same master
  password is merged automatically (entries missing from the synced vault, or
  newer local copies, are added). If it uses a different master password, a
  prompt on the vault page asks for that password and merges it.
- **Forgot the password of an old local vault:** a v2 vault can still be
  recovered with email verification plus the recovery key that was saved for
  it; the result becomes your synced vault. A v1 vault predates recovery keys
  and can only be opened with its master password.

## Operator setup and key rotation

1. Generate the recovery key pair: `npm run vault:escrow-key`.
2. Store the printed JSON as the **encrypted** Cloudflare Pages secret
   `PASSWORD_VAULT_ESCROW_PRIVATE_KEY`. Never commit it or put it in the
   database. Keep an offline backup: if this key is lost, email recovery
   becomes impossible for existing vaults (master-password unlock still works).
3. Apply `supabase/migrations/202610230009_password_vault_sync.sql` after
   `202610210001_password_vault_recovery.sql`, and redeploy.

Without the secret, existing vaults still unlock and sync, but new vaults
cannot be created and email recovery is unavailable; the UI says so.

**To rotate:**

1. Generate a new key.
2. Move the old JSON into `PASSWORD_VAULT_ESCROW_RETIRED_KEYS` (a JSON array of
   JWKs) and set the new one as `PASSWORD_VAULT_ESCROW_PRIVATE_KEY`.
3. Each vault's escrow copy is re-sealed to the new key the next time its owner
   unlocks it. Retired keys remain usable for recovery until every vault has
   been re-sealed.

Email delivery uses the existing Brevo configuration (`BREVO_API_KEY` and the
sender settings in the Admin console).

## Tests

- `tests/password-vault-crypto.test.mjs`: Argon2id defaults, wrong password,
  tampering and context binding, escrow and transport sealing, KDF bounds,
  legacy readers.
- `tests/password-vault-sync.test.mjs`: runs the real browser modules against
  the real route handler and the real SQL migrations (PGlite). It covers:
  - initial setup, with no plaintext in the database;
  - unlock on a second device and wrong-password throttling;
  - cross-device add, edit and delete, and conflict protection;
  - OTP cooldown, wrong code and single use;
  - reset with key rotation and full re-encryption, with stale devices locked
    out;
  - grant single use and expiry;
  - migration from v1/v2 vaults, merging and legacy recovery-key recovery;
  - unauthorized access (no session, cross-account isolation, no database role
    access);
  - server validation, escrow key rotation, demo mode, and no secrets in logs.
