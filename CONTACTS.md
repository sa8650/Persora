# Persora Contacts — API, Web UI, and Android Sync

Contacts are stored in Persora's authenticated Pages API and the dedicated `public.contacts` table. Both the web workspace (`src/components/ContactsView.tsx`) and native Android app share this API and account data.

## Database setup

For a fresh Supabase project, run `supabase/schema.sql`, which includes `public.contacts`, `public.vault_folders` (`contacts` scope), `public.trash_items` (`contact` kind), RLS policies, and restricted `SECURITY DEFINER` helpers. Browser roles (`anon`, `authenticated`) have no direct table privileges; all reads and mutations pass through authenticated Pages Functions using `SUPABASE_SECRET_KEY`.

## API base and authentication

Use the deployed Persora HTTPS origin with `/api` as the prefix (for example `https://persora.example.com/api`).

All contact endpoints require a valid signed-in Persora session (`POST /api/auth/login` with `{ "identifier": "…", "password": "…" }`), carried in the `HttpOnly`, `Secure` (on HTTPS), `SameSite=Lax` cookie `persora_session` scoped to `/api` (up to 7 days). Native Android clients should persist cookies only in Android Keystore-backed encrypted storage and handle `401` by prompting sign-in. Never ship Supabase keys in client bundles or APKs.

## Contact endpoints

All routes below are relative to `/api` and return JSON unless noted.

| Method and route | Purpose |
| --- | --- |
| `GET /contacts` | Return the signed-in member's contacts ordered by name. |
| `POST /contacts` | Create a contact (omit `id`) or update an owned contact (include `id`). Returns the saved row. |
| `DELETE /contacts?id=<uuid>` | Soft-delete an owned contact to Global Trash (7-day retention) or release unreferenced photo objects on purge. |
| `POST /contacts/merge` | Merge selected duplicate contacts into a primary contact. |
| `GET /contacts/photo?id=<contact-uuid>` | Stream the private profile photo for an owned contact (`Cache-Control: private, no-store`). |
| `POST /upload` | Upload a contact photo (`JPG/JPEG`, `PNG`, `WEBP`, `GIF`, up to 5 MB) as `multipart/form-data` field `file`; returns `{ key, name, size, type }`. Pass `key` as `photoKey` when saving the contact. |

### Create / update payload

A contact may contain up to 20 phone numbers. Names are required; birthdays use `YYYY-MM-DD`. Categories are validated against `Family`, `Friends`, `Work`, `Clients`, `Suppliers`, `Students`, and `Other`.

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
  "folderId": "optional-owned-contacts-folder-uuid",
  "expectedUpdatedAt": "2026-10-27T08:30:00+00:00"
}
```

`expectedUpdatedAt` is an optional optimistic-concurrency guard: if the contact changed or was deleted on another device since `expectedUpdatedAt`, the API returns `409 Conflict` instead of overwriting newer edits.

### Merge payload

```json
{
  "primaryId": "uuid-to-keep",
  "duplicateIds": ["uuid-to-merge-1", "uuid-to-merge-2"]
}
```

The retained primary contact keeps its name and category, combines unique phone numbers and non-empty fields, joins notes, preserves an existing photo, and marks `favorite = true` if any merged record was favorited.

### Row shape

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
  "folder_id": "contacts-folder-uuid-or-null",
  "favorite": true,
  "created_at": "2026-10-27T08:00:00+00:00",
  "updated_at": "2026-10-27T08:30:00+00:00"
}
```

Always treat `photo_key` as opaque and load contact photos via `GET /api/contacts/photo?id=<uuid>`.

## Web Contacts features (`src/components/ContactsView.tsx`)

- **ReUI upload & import progress:** Contact photo uploads stream byte-level XHR progress through `TransferProgressIndicator` (built on ReUI `Progress` + `Spinner`), and `.vcf` vCard imports report live contact counts, percentages, and estimated remaining time through `ImportProgressIndicator`.
- **Compact post-upload number feedback modal:** After saving or importing contacts where duplicate or malformed phone numbers were skipped/flagged, Persora opens a compact, properly scaled `.contacts-number-feedback` dialog summarizing saved counts, skipped duplicate numbers, and any malformed entries with direct **Review contact** actions.
- **Custom multi-select & bulk delete:** Clicking **Select** in the Contacts toolbar activates selection mode with a `.contacts-selection-bar` featuring an indeterminate ReUI `Checkbox` (**Select all** / **Deselect all**), a ReUI `Badge` showing the selected count, per-contact ReUI selection checkboxes on both card and list rows, and a **Delete selected** action guarded by an accessible `alertdialog` confirmation (`#contacts-bulk-delete-title`) that deletes all chosen contacts (moving cloud contacts to 7-day Trash) with live status feedback.
- **Directory & quick actions:** Folder shelf filtering, category chips, favorites filter, search, sort (`A–Z`, `Recent`, `Company`), card/list view toggle, international country calling codes (`+880` default), one-tap Call/SMS/WhatsApp/Email actions, private Persora member sharing, vCard export, and duplicate detection/merge.

## Recommended Android sync & import behavior

1. Cache contacts locally keyed by `id` with `updated_at` as version metadata.
2. Reconcile via `GET /api/contacts` on login, app resume, reconnect, and after mutations (the web app refreshes on open, window focus, and every 30 seconds).
3. Send `expectedUpdatedAt` on updates and surface a conflict prompt on `409`.
4. Phone address-book imports on Android run in the background via WorkManager with encrypted staging and ongoing notification progress; `.vcf`/CSV imports show an interactive preview before saving.
