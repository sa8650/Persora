# Persora Connections

**Connections** (sidebar → Account → Connections, or `/?view=connections`) links a Persora account to external services. This release ships **EMS** (Dexter Studio's business management platform), while Google Drive, Google Photos, Google Docs, Google Calendar, Notion, Microsoft OneDrive, and Microsoft Outlook appear in the provider catalog as **Coming soon**. Every service uses a bundled local SVG mark in `src/assets/connections/` (see `src/assets/connections/README.md`).

The Connections UI (`src/components/connections/ConnectionsView.tsx`, `ConnectionParts.tsx`, `EmsConnectionView.tsx`) uses Persora's in-repo ReUI component layer: `Badge` for tab counts and connection/shop status pills, `IconTile` for admin and shop scope tiles, `Attachment` + `FileType` for Vaultium file rows, and `Spinner` for verification and preview loading states.

---

## 1. What members can do with EMS

1. Open **Connections → EMS → Connect** and enter their **EMS administrator** email and password inside Persora.
2. Persora's Pages Function sends the credentials server-to-server over HTTPS once. EMS verifies them and issues a revocable `pg1_…` **grant**. Persora encrypts and stores only the grant (`AES-256-GCM`); the EMS password is never stored.
3. Inside the EMS view, members can:
   - inspect the connected administrator profile, connection status, and last health check;
   - switch between **Admin · all shops** and individual **shop** scopes with file counts;
   - search, page, preview (images, PDFs via `PdfPreview`, and text), download, or click **Save copy** to store an independent copy in **Documents → "EMS Vaultium"** (using their paid Persora upload plan and storage quota).
4. EMS access is strictly **read-only** (`GET` / `POST` read routes only; write verbs return `405 read_only`).

### Eligibility & lifecycle

- Only EMS administrators with at least one approved Vaultium license or add-on (`active` or `expired`) or current Vaultium entitlement can connect; otherwise EMS returns `403 vaultium_not_eligible`.
- Temporary EMS outages show a **Connected · limited** degraded badge without deleting the connection.
- Expired/revoked grants or changed EMS passwords transition the connection to `reauth_required` (**Reconnect EMS**).
- **Disconnect** revokes the grant on EMS (best effort) and removes the `user_connections` row.

---

## 2. Server-to-server HMAC architecture

```
Browser ──(Persora session cookie)──▶ Persora Pages Function  /api/connections/*
                                         │  HMAC-SHA256 signed HTTPS request
                                         ▼
                                  EMS Pages Function  /api/persora/*
                                         │
                                         ▼
                                  EMS database + Vaultium R2
```

Every Persora → EMS call carries `x-persora-timestamp` (±300 s window), `x-persora-nonce` (16–128 chars), and `x-persora-signature`:

```text
signature = hex(HMAC-SHA256(sharedSecret,
  "ems-persora-v1\n" + unixSeconds + "\n" + nonce + "\n" + METHOD + "\n" +
  pathname+search + "\n" + sha256hex(body) + "\n" + sha256hex(grant or "")))
```

---

## 3. API reference

Member routes (require signed-in Persora session):

| Method & path | Purpose |
| --- | --- |
| `GET /api/connections` | Provider registry and current member status per provider. |
| `POST /api/connections/ems/connect` | Connect or reconnect `{ email, password }` (rate-limited). |
| `GET /api/connections/ems` | Connection overview, `integrationReady`, `degraded`, admin profile, and shops. |
| `GET /api/connections/ems/files?storeId=&q=&limit=&offset=` | Paged Vaultium file metadata (`limit` ≤ 100). |
| `GET /api/connections/ems/files/:id[?disposition=inline]` | Stream file bytes (`nosniff`; inline restricted to safe preview types). |
| `POST /api/connections/ems/files/:id/save` | Save an independent copy to Persora Documents (`201`). |
| `DELETE /api/connections/ems` | Revoke grant and disconnect. |

Admin routes (`Admin → Integrations` in `src/components/admin/AdminIntegrationsPanel.tsx`):

| Method & path | Purpose |
| --- | --- |
| `GET /api/admin/integrations` | Status of all platform integrations. |
| `GET /api/admin/integrations/ems` | Masked EMS integration status (`secret_last4`, base URL source, connection counts). |
| `POST /api/admin/integrations/ems` | Save `{ enabled, baseUrl, secret }` (blank secret preserves existing ciphertext). |
| `POST /api/admin/integrations/ems/test` | Send a signed `ping` to EMS and return `{ ok, message, status }`. |

---

## 4. Database & secrets

- **Tables (`supabase/schema.sql`):** `public.integration_settings` and `public.user_connections`, both with RLS enabled, no browser-role grants, and per-member derived AES-GCM encryption for stored grants.
- **Secrets:** Set `CONNECTIONS_ENCRYPTION_KEY` (≥32 random chars; falls back to `TIMELINE_ENCRYPTION_KEY`) in Cloudflare Pages encrypted secrets. Configure a matching ≥32-character shared secret in both **EMS Owner Console → Services → Persora Connections** and **Persora Admin → Integrations** (or `EMS_INTEGRATION_SECRET` + `EMS_API_BASE_URL`).

---

## 5. Adding a future provider

1. Add the provider metadata to `CONNECTION_PROVIDERS` in `cloudflare/connections.js`.
2. Add its bundled SVG logo under `src/assets/connections/` and register it in `PROVIDER_LOGOS` in `src/components/connections/ConnectionParts.tsx`.
3. Implement its server routes in `cloudflare/connections.js` using `user_connections` and `sealSecret`/`openSecret`, and add a detail view if needed.
