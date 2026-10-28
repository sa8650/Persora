# Persora Password Manager

The **Password Manager** (`src/components/PasswordManagerView.tsx`, `src/components/PasswordGeneratorPanel.tsx`, `cloudflare/password-vault.js`) is a dedicated workspace inside Persora for storing website and app logins across devices, gated by a separate **master password** distinct from the Persora account sign-in password.

The UI uses Persora's in-repo ReUI component layer (`Badge` for strength, AI, and category pills; `Progress` for password strength meters; `Checkbox` for character-set and word options; `IconTile` for empty/header states; and `Spinner` for unlock, save, and AI suggestion states).

## Security model

- **Separate master password:** Verified server-side against `password_vaults.master_password_hash` (salted `pgcrypto` bcrypt) with per-account lockouts after repeated failed attempts (`failed_unlock_count`, `locked_until`).
- **Short-lived unlock token:** Unlocking (`POST /api/password-vault/unlock`) issues a random token stored only in browser memory (`X-Persora-Vault-Token`) and hashed (`SHA-256`) in `password_vault_sessions`. Idle inactivity in the UI (`5` minutes default) or server session expiry (`15` minutes sliding TTL) locks the vault automatically; `POST /api/password-vault/lock` revokes the session immediately.
- **Encrypted at rest on the server:** Saved entry titles, usernames, passwords, URLs, notes, categories, and favorite flags are encrypted server-side with per-account `AES-256-GCM` keys derived via HKDF from `PASSWORD_VAULT_ENCRYPTION_KEY` (falling back to `TIMELINE_ENCRYPTION_KEY`) in `password_vault_items`. Browser roles have zero direct table access (`RLS` enabled, grants revoked).
- **Non-destructive master-password recovery:** Forgot-master-password sends a 6-digit Brevo OTP (`password_vault_recovery_codes` → `password_vault_recovery_grants`) to the member's email, allowing them to set a new master password and revoke existing vault sessions **without** wiping saved entries. (Account exports intentionally omit Password Manager entries so downloading an account backup never bypasses the master password.)

## Password Generator (`src/components/PasswordGeneratorPanel.tsx`)

Available standalone inside Password Manager and inline inside the New/Edit Login modal:

1. **Random** — CSPRNG character generator (`8–64` chars) with Uppercase, Lowercase, Numbers, Symbols, and Exclude ambiguous (`O0Il1`) ReUI `Checkbox` controls, guaranteeing at least one character from every enabled set.
2. **Memorable** — Diceware-style multi-word passphrases (`3–8` words) with configurable separator, capitalization, and appended number.
3. **Rhythm** — Pronounceable syllable groups (`2–5` groups) paired with digits and separators.
4. **AI Assisted** — Optional Workers AI (`cloudflare/ai-password.js`) theme-word suggestions combined locally in the browser with cryptographic randomness (never sending vault secrets or final passwords to AI). Respects **Admin → AI Controls**.

## Database, API, and tests

- **Schema:** All tables (`password_vaults`, `password_vault_items`, `password_vault_sessions`, `password_vault_recovery_codes`, `password_vault_recovery_grants`) are included directly in [`supabase/schema.sql`](./supabase/schema.sql).
- **Routes (`/api/password-vault/*`):** `GET /status`, `POST /setup`, `POST /unlock`, `POST /lock`, `POST /change-master-password`, `POST /recovery/send-code`, `POST /recovery/verify-code`, `POST /recovery/reset`, `GET|POST /items`, `PATCH|DELETE /items/:id`, and `POST /api/ai/password-words`.
- **Tests:** `tests/password-generator.test.mjs`, `tests/password-vault-routes.test.mjs`, `tests/ai-controls-and-password.test.mjs`, and `npm run test:e2e:vault`.
