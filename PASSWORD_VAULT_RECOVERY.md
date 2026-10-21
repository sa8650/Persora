# Password Vault Recovery Design

## Existing architecture (before recovery)
The initial Password Manager stored one JSON payload in browser `localStorage`. PBKDF2-SHA-256 (310,000 iterations) derived an AES-GCM-256 key directly from the master password; that key encrypted the entire entry array. This made a forgotten master password unrecoverable. It was not a server-synced vault. The repository also has a separate account-password reset flow that updates the Persora login password; that flow must not be used to recover vault contents.

## New envelope (v2)
On vault creation, the browser generates an independent random 256-bit data-encryption key (DEK). Entries are encrypted client-side with AES-GCM-256 using a fresh 96-bit nonce for every write. The DEK is separately wrapped twice: once with a PBKDF2-SHA-256-derived key from the user's master password (310,000 iterations, unique 128-bit salt) and once with a key derived directly from a random 256-bit recovery key (HKDF-SHA-256, per-vault salt and fixed domain-separation info). The browser stores only ciphertext, salts/nonces, and the two wrapped-DEK values in localStorage. Plaintext master passwords, recovery keys, DEK and entry data never leave the browser.

The recovery key is displayed only at initial setup/migration. User must confirm possession before vault access. It is not saved on Persora servers or in localStorage. This is an offline secret, and must be kept outside the device.

## Recovery protocol
1. The signed-in client requests an OTP to the account's registered email. Cloudflare Pages API uses the existing Brevo delivery configuration.
2. A Supabase service-role RPC stores an HMAC of the six-digit code, exact user/email binding, expiry, send-window counters and failed-attempt count. RLS denies direct client access. Send is cooldown/rate limited, verification is single-use and bounded to five attempts. Concurrent requests serialize on the challenge row.
3. After server verification, the client asks the user for the recovery key. The browser unwraps the DEK locally and authenticates/decrypts the current envelope. Wrong keys or damaged envelopes fail without modifying stored data.
4. User chooses a new master password. The browser creates a new PBKDF2 salt, wraps the same DEK with the new master password and atomically replaces only the master-key wrap. Existing encrypted entry ciphertext is preserved byte-for-byte. Recovery wrap remains unchanged.

OTP proves access to the registered email; it does not replace the recovery key and cannot decrypt vault data. If an existing v1 vault is unlocked with its current master password, it can be migrated locally to v2 and a recovery key generated. Existing locked v1 accounts cannot be recovered and are never represented as recoverable until migration is completed.

## Boundaries
Vault data remains device-local, matching the current implementation; recovery only works where that local envelope is present (or after the ciphertext envelope has been safely transferred by the user). The server stores no vault ciphertext or key wraps, only OTP challenge hashes/counters. Configure and apply the included Supabase migration before deploying the API endpoints. Use HTTPS and keep `SUPABASE_SECRET_KEY` and Brevo credentials server-side.
