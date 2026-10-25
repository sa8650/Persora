# Persora Connections

**Connections** (sidebar → Account → Connections, or `/?view=connections`) links a Persora account to services outside Persora. This release ships one provider, **EMS** (Dexter Studio's business management platform). The registry is built so more can be added later, such as Google Drive, Photos and Docs, Notion, Calendar, or other Dexter Studio apps.

---

## 1. What members can do with EMS

1. Open **Connections → EMS → Connect**, then enter their **EMS administrator** email and password in the Persora dialog. Persora never redirects to EMS or opens an EMS page.
2. Persora's backend sends the credentials to EMS server-to-server, one time only. EMS checks them and returns a revocable **grant**. Persora stores only that grant, encrypted. The password is never stored.
3. The EMS page then shows:
   - the connected administrator (name, email, admin ID) with status and the time it was last checked;
   - an **Admin · all shops** card and one card per **shop** the administrator owns, each with its file count;
   - a **Vaultium file browser** with search, paging, preview (images, PDF and text), download, and **Save to Persora**.
4. **Save to Persora** stores an independent copy in **Documents → "EMS Vaultium"**. The folder is created on first use. The copy counts against the member's Persora storage quota and needs the same paid upload plan as any other Persora upload. Editing or deleting the copy never touches EMS.
5. Members can't upload, rename, edit, overwrite or delete EMS files. The EMS API enforces this: `/api/persora/*` only exposes read routes, and every other verb returns `405 read_only`. The UI simply has no controls for it.

### Eligibility

An EMS administrator can connect only if they have **purchased Vaultium at least once**. EMS checks its own records on every connect and on every data request:

- approved licenses with `vaultium_gb > 0` (`active` *or* `expired`), or
- approved `vaultium` add-on purchases (`active` or `expired`), or
- a current entitlement with Vaultium storage.

Pending or rejected purchases never count. An administrator who never bought Vaultium gets `403 vaultium_not_eligible` and a clear message in Persora.

### Connection lifecycle

| Situation | What Persora does |
| --- | --- |
| Refresh, new tab, new session | The connection is kept. It is stored in `user_connections`, not in the browser. |
| EMS is temporarily down, times out or returns 5xx | Persora shows a **degraded** banner and keeps the connection. Nothing is deleted. |
| Integration disabled on either side, or the secrets don't match | Persora shows an "integration unavailable" banner. The connection is kept and access resumes once the integration is fixed. |
| Grant expired or revoked, admin password changed, or account deactivated | The status becomes `reauth_required` and Persora shows **Reconnect EMS**. The member signs in again inside Persora. |
| Member clicks **Disconnect** | Persora asks EMS to revoke the grant (best effort), then deletes its own `user_connections` row. The EMS account and its files are not affected. |
| Persora account deleted | The row is removed by cascade. The EMS-side grant is **not** actively revoked. It becomes useless because only Persora holds the secret and the token, and it expires after 180 days of inactivity. The EMS owner can also use **Revoke all grants**. |

---

## 2. Architecture

```
Browser ──(Persora session cookie)──▶ Persora Pages Function  /api/connections/*
                                         │  HMAC-signed, server-to-server (HTTPS)
                                         ▼
                                  EMS Pages Function  /api/persora/*
                                         │  db()/R2 — EMS's own data layer
                                         ▼
                                  EMS database + Vaultium R2
```

- The browser only ever talks to Persora. It never sees the EMS URL path, the shared secret, or the grant.
- Persora never touches the EMS database. All data comes from authenticated EMS API routes.

### Request signing (both directions agree on this exactly)

Each request from Persora to EMS carries `x-persora-timestamp`, `x-persora-nonce` and `x-persora-signature`. Data routes also carry `authorization: Bearer <grant>`. The signature is computed as:

```
signature = hex(HMAC-SHA256(sharedSecret,
  "ems-persora-v1\n" + unixSeconds + "\n" + nonce + "\n" + METHOD + "\n" +
  pathname+search + "\n" + sha256hex(body) + "\n" + sha256hex(grant or "")))
```

EMS rejects a request in these cases:

- the timestamp is more than **±300 s** off (`request_expired`), so both servers' clocks must be reasonably accurate;
- the nonce is malformed (it must be 16–128 characters from `[A-Za-z0-9_-]`);
- the signature is invalid (`signature_invalid`).

The signature binds the grant, so a grant can't be replayed with a different secret, and a secret alone can't read anything.

**The shared secret never replaces admin authentication.** It proves only that the caller is Persora. Reading data still needs a grant, and a grant can only be obtained with the administrator's own EMS email and password.

### Per-request checks on the EMS side

1. The integration is enabled in the Owner Console.
2. The signature and the time window are valid.
3. The grant exists, has not expired, has not been revoked, and is bound to the administrator's *current* password hash.
4. The administrator is still active and is still Vaultium-eligible.
5. `store_id` and file ids are validated as UUIDs, and **every query is filtered by the grant's `admin_id`**. Another administrator's shop or file id returns 404, never data (IDOR protection).
6. Internal storage keys (`r2_key`) are never returned.

---

## 3. API reference (Persora)

All member routes need a signed-in Persora session. Errors return `{ "error": "...", "code": "..." }`.

| Method & path | Purpose |
| --- | --- |
| `GET /api/connections` | Provider registry plus this member's status for each provider. |
| `POST /api/connections/ems/connect` `{email,password}` | Connect or reconnect. Rate limited to 8 failures per account fingerprint and 30 per IP every 15 minutes. |
| `GET /api/connections/ems` | Overview: status, `integrationReady`, `degraded`, the connection, and `account {admin, stores, eligibility, totalFiles}`. |
| `GET /api/connections/ems/files?storeId=&q=&limit=&offset=` | Vaultium file metadata. Leave out `storeId` to get every shop of the administrator, or pass a shop UUID to filter. `limit` is at most 100. |
| `GET /api/connections/ems/files/:id[?disposition=inline]` | Streams the file. Inline is allowed only for safe types; everything else is served as an attachment with `nosniff`. |
| `POST /api/connections/ems/files/:id/save` | Copies the file into the member's Persora storage. Returns 201 with `{ok,item}`. |
| `DELETE /api/connections/ems` | Disconnects. Returns `{ok, remoteRevoked}`. |

Error codes: `reauth_required` (409), `integration_unavailable` (503), `vaultium_not_eligible` (403), `ems_unreachable`/`ems_unavailable` (502), `not_connected`/`not_found` (404), `rate_limited` (429), `too_large`/`quota_exceeded` (413), `encryption_unavailable` (503), `migration_required` (503).

Admin-only routes (Persora administrators):

| Method & path | Purpose |
| --- | --- |
| `GET /api/admin/integrations` | Status of every integration. |
| `GET /api/admin/integrations/ems` | Masked status: enabled, base URL and its source, `secretConfigured`, the last four characters of the secret, the last check, and connection counts. |
| `POST /api/admin/integrations/ems` `{enabled?, baseUrl?, secret?, clearSecret?}` | Saves settings. A blank secret keeps the stored one. |
| `POST /api/admin/integrations/ems/test` | Sends a signed `ping` to EMS. Returns `{ok,message,status}`. |

### EMS endpoints called by Persora

| EMS route | Purpose |
| --- | --- |
| `POST /api/persora/ping` | Signature-only health check. |
| `POST /api/persora/authorize` | Checks admin credentials and eligibility, then issues a `pg1_…` grant. |
| `POST /api/persora/revoke` | Revokes the presented grant. |
| `GET /api/persora/account` | Admin profile, eligibility, shops with file counts, and total files. |
| `GET /api/persora/files` | Paged Vaultium metadata for the grant's administrator. |
| `GET /api/persora/files/:id/content` | File bytes. |

---

## 4. Database

Migration: `supabase/migrations/202610310001_connections.sql`. It is additive and can be re-run safely.

- **`integration_settings`**: one row per provider. Holds `enabled`, `base_url`, `secret_ciphertext` (AES-GCM), `secret_last4` (used for the masked display), and the last health check.
- **`user_connections`**: one row per member and provider (`unique(user_id, provider)`, `on delete cascade`). Holds `status`, the account label and email, `credential_ciphertext` (the grant, AES-GCM with a key derived for the specific member), metadata, and the last error.
- Both tables have RLS enabled with no policies, and `anon`/`authenticated` have no privileges. Only the Pages Function (service role) can read them.

Until the migration is applied, `/api/connections` returns `503 migration_required`, and every other feature keeps working.

---

## 5. Setting up the shared secret

Do this once per deployment pair.

1. **Generate** a secret of at least 32 characters, for example `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='`. You can also use **Generate** in the Persora admin panel.
2. **EMS:** Owner Console → **Services → Persora Connections**. Paste the secret, turn **Enable** on, and save.
   - Alternative: set the encrypted Pages secret `PERSORA_INTEGRATION_SECRET`. It overrides the console value and locks the field.
3. **Persora:** Admin → **Integrations**. Set **EMS address** (HTTPS, for example `https://ems.example.com`), paste the **same** secret, turn **Enable EMS connections** on, and save.
   - Alternatives: set the encrypted Pages secret `EMS_INTEGRATION_SECRET` (it overrides and locks the field) and/or the Pages variable `EMS_API_BASE_URL` (used when the console leaves the address blank).
4. Click **Test connection to EMS**. "EMS accepted Persora's signed request" means both sides are enabled and the secrets match. Otherwise the result names the cause: integration disabled in EMS, secrets don't match, clock skew, wrong address, or EMS unreachable.

Persora requires `CONNECTIONS_ENCRYPTION_KEY` to be set: an encrypted Pages secret of at least 32 characters, for example `openssl rand -hex 32`. If it isn't set, Persora falls back to `TIMELINE_ENCRYPTION_KEY`. Keep the key stable. Rotating it makes stored grants and the stored secret unreadable. If that happens, members are asked to reconnect and the admin must paste the secret again.

**Rotating the secret:**

1. Paste the new value on both sides. Requests fail with "integration unavailable" until both sides match.
2. Members' connections are kept and resume automatically.

**Disabling:** turning the toggle off on *either* side blocks all access immediately. Existing connections are kept and resume when the integration is re-enabled. On EMS, **Revoke all grants** forces every Persora member to reconnect.

Secrets are never returned by any API, never written to logs or audit details (audit entries only record `secretReplaced: true`), and never shipped in frontend bundles or `VITE_*`/`PUBLIC_*` variables.

---

## 6. Adding a future provider

1. Add an entry to `CONNECTION_PROVIDERS` in `cloudflare/connections.js` with `id`, `name`, `category`, `available:false` and a description. It shows up as a "Coming soon" card straight away.
2. Implement its routes in `handleConnections` (keep using `user_connections`, `sealSecret`/`openSecret`, and the `reauth_required` and degraded semantics).
3. Add its look (icon and colour) to `PROVIDER_LOOK` in `src/components/connections/ConnectionParts.tsx`, plus a detail view if it needs one.
4. If it needs platform settings, add it to `ADMIN_PROVIDERS` and extend the admin Integrations tab.
