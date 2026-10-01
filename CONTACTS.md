# Persora Contacts — API and Android sync

This feature stores contacts in Persora's authenticated Pages API and a dedicated `public.contacts` table. The web UI is wired to the API. **There is no Android app source in this repository**, so the Android screen/client still needs to be connected to the contract below in the Android project.

## Deploy the database change

Apply `supabase/migrations/20260930_contacts.sql` to the Persora Supabase project before enabling cloud contacts. `supabase/schema.sql` also includes the complete contacts schema for new installations. RLS is enabled and browser roles have no direct table privileges; the Pages API uses its server-side service key and scopes every query to the authenticated owner. Browser/mobile clients must use the Pages API and must never receive a Supabase service-role key.

## API base and authentication

Use the same HTTPS origin as the deployed Persora web app, with `/api` as the API prefix. For example: `https://persora.example.com/api` (replace with the configured production domain).

All contact endpoints require a Persora session. Sign in with `POST /api/auth/login` using the existing `{ "identifier": "…", "password": "…" }` request. The API responds with the public user and sets the `HttpOnly`, `Secure` (on HTTPS), `SameSite=Lax` cookie named `persora_session`, scoped to `/api`. A native Android HTTP client should keep a cookie jar for the same API host and send that cookie on subsequent requests. The session lasts up to seven days; handle `401` by asking the user to sign in again. `POST /api/auth/logout` clears the session.

The API currently authenticates with the session cookie, **not** a bearer token. Do not put account passwords or session cookies in logs, analytics, crash reports, URLs, or unencrypted preferences. Persist a native session only in appropriately protected storage (Android Keystore-backed encryption). Do not add Supabase credentials to the APK.

## Contact endpoints

All routes below are relative to the `/api` prefix and return JSON unless noted. Send `Content-Type: application/json` for JSON requests.

| Method and route | Purpose |
| --- | --- |
| `GET /contacts` | Return the signed-in user's contacts, ordered by name. The response is an array of database-shaped rows (fields below). |
| `POST /contacts` | Create a contact (omit `id`) or update an owned contact (include `id`). Returns the saved row. |
| `DELETE /contacts?id=<uuid>` | Delete one owned contact and clean up its photo if no contact references it. |
| `POST /contacts/merge` | Merge selected duplicate contacts into the retained contact. |
| `GET /contacts/photo?id=<contact-uuid>` | Fetch the private profile photo for an owned contact. Returns image bytes with private/no-store caching. |
| `POST /upload` | Upload a photo as `multipart/form-data` with field name `file`; returns `{ key, name, size, type }`. Pass the returned `key` as `photoKey` when saving the contact. |

### Create/update body

`id` is optional for creates. A contact may contain up to 20 phone numbers. Empty optional strings are accepted. Names are required; birthdays use `YYYY-MM-DD`.

```json
{
  "id": "optional-existing-contact-uuid",
  "name": "Samira Rahman",
  "phoneNumbers": [
    { "label": "Mobile", "number": "+8801712345678" },
    { "label": "Work", "number": "+880255512345" }
  ],
  "email": "samira@example.com",
  "company": "Example Ltd",
  "jobTitle": "Operations Manager",
  "address": "Dhaka, Bangladesh",
  "birthday": "1992-04-18",
  "notes": "Prefers email in the morning.",
  "category": "Work",
  "favorite": true,
  "photoKey": "owner-uuid/opaque-upload-key",
  "expectedUpdatedAt": "2026-09-30T08:30:00+00:00"
}
```

`expectedUpdatedAt` is optional. Native clients should send the exact `updated_at` received in the last `GET /contacts` when updating an existing record. If the server version changed or the contact was deleted on another device, the API returns `409 Conflict` instead of silently overwriting/recreating it. Refresh and let the user resolve the conflict. Omit `expectedUpdatedAt` for a new contact. The current web form uses the most recently loaded server copy and does not send this precondition.

The API validates categories against: `Family`, `Friends`, `Work`, `Clients`, `Suppliers`, `Students`, `Other`. Phone numbers are stored with international calling prefixes where available; the server accepts a leading `+` and common display punctuation.

### Merge body

```json
{
  "primaryId": "uuid-to-keep",
  "duplicateIds": ["uuid-to-merge-1", "uuid-to-merge-2"]
}
```

The retained contact keeps its name/category, combines unique phone numbers and available details, joins notes, preserves a photo, and becomes favorite if any merged record was favorite. The server rejects IDs that are not owned by the signed-in user.

### Row shape

List and save responses use database field names, for example:

```json
{
  "id": "uuid",
  "user_id": "owner-uuid",
  "full_name": "Samira Rahman",
  "phone_numbers": [{ "label": "Mobile", "number": "+8801712345678" }],
  "email": "samira@example.com",
  "company": "Example Ltd",
  "job_title": "Operations Manager",
  "address": "Dhaka, Bangladesh",
  "birthday": "1992-04-18",
  "notes": "Prefers email in the morning.",
  "category": "Work",
  "photo_key": "owner-uuid/opaque-upload-key",
  "favorite": true,
  "created_at": "2026-09-30T08:00:00+00:00",
  "updated_at": "2026-09-30T08:30:00+00:00"
}
```

Treat `photo_key` as an opaque private-storage reference. Do not construct a public R2 URL. Fetch images through `GET /api/contacts/photo?id=…` so ownership checks remain enforced.

## Recommended Android sync behavior

1. Keep a local contact cache keyed by Persora contact `id`; retain each row's `updated_at` as its version.
2. On login, app foreground/resume, network reconnect, and after a user mutation, call `GET /api/contacts` and reconcile the full list. The web client refreshes on the Contacts page, on window focus, and every 30 seconds while signed in.
3. Create with `POST /contacts` and no `id`; update with the contact's `id` and `expectedUpdatedAt` from the cached server row. After a successful write, use the returned row's `updated_at` and refresh/reconcile.
4. On `409`, do not retry the stale payload automatically. Refresh the server copy and offer a conflict choice (or preserve the local edit separately).
5. Delete through `DELETE /contacts?id=…`; after success, remove the row from the local cache. Do not later upload an old cached copy as a create.
6. For an image (JPG/JPEG, PNG, WEBP, or GIF; maximum 5 MB), upload the binary first, save the returned `key` in `photoKey`, and display/fetch through the private photo endpoint. Replacing/clearing a photo is done by saving the contact with the new `photoKey` or `null`/empty value.

The current API returns a full contact list rather than a delta feed and has no push/WebSocket channel. Online changes become visible on the next refresh; the web client polls on a 30-second interval. The `updated_at` precondition prevents stale native updates, but clients should still refresh frequently and keep any offline edits in a pending queue until acknowledged.

## UI behavior included on web

The Contacts workspace page includes categorized add/edit forms, multiple phone numbers and country calling codes (Bangladesh `+880` by default), favorite controls, quick Call/SMS/WhatsApp/Email links, search/filter/sort, card/list layout, vCard import preview with duplicate checking, vCard export for selected/all contacts, duplicate review/merge, private profile photos, and browser-local demo contacts. During vCard import, phone numbers already saved in Persora or repeated within the selected file are removed from imported records. Malformed/out-of-range numbers are skipped while the remaining contact data imports; a post-import report identifies the contact and skipped value and offers a direct edit action so the user can enter a corrected number. Demo-mode contacts are deliberately local to that browser and do not sync to Android; cross-device sync requires the deployed API and an authenticated account.
