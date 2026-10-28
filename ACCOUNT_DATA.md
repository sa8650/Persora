# Persora Account Data, Sharing, Trash, and Backups

## Combined storage quota

Persora displays and enforces each member's storage quota against combined account usage:

```text
combined usage = UTF-8 serialized bytes of owned database rows + bytes of private R2 objects under the member's prefix
```

- **Database payload:** Owned rows across vault items, contacts, business cards, life timeline events/links, medical records/links, projects, Persora tables, Photo Studio, and PDF Studio metadata.
- **Private R2 files:** Uploaded vault attachments, contact photos, business-card photos/logos, medical files, encrypted timeline attachments, project field/task attachments, Persora Table cell attachments, Photo Studio images, and PDF Studio documents.
- **Billing & progress UI:** **Billing** (`src/components/BillingView.tsx`) renders quota usage with ReUI `Progress`, `Badge`, `IconTile`, and `Spinner`, while all file/contact uploads display live byte-level progress via `TransferProgressIndicator` / `ImportProgressIndicator` (`src/components/ProgressIndicator.tsx`).

## Type-aware fields, Family links, and Smart Scan

- Vault forms adapt fields to the chosen record type (such as National ID/NID, Passport, or Student ID). **Belongs to** stores either `Me` or a stable Family-member record UUID so renaming a family member keeps every linked record intact.
- Smart Scan (`src/components/SmartScan.tsx`, `cloudflare/smart-scan.js`) runs OCR via Azure AI Document Intelligence (`prebuilt-read`) and field extraction via Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). Payment-card numbers and security codes are redacted before 24-hour per-account caching (`smart_scan_cache`). Matched fields populate the form and extra readable facts land in editable **Additional Data**.

## Account security, password recovery, and email verification

- **Sign-in & recovery:** Accounts authenticate via 7-digit Persora ID or email plus bcrypt password (`pgcrypto`). Self-service password recovery sends a 6-digit Brevo OTP (`password_recovery_codes`) so members can set a new password and revoke stale sessions.
- **Email verification:** Optional 6-digit, 10-minute Brevo OTP verification (`email_verification_codes`) managed in **Settings** and toggled in **Admin → Email settings**.

## Private record sharing vs. public business cards

- **Private sharing (`record_shares`):** Share a contact, business card, or Photo Studio photo with a specific Persora member by 7-digit Persora ID or email (`src/components/ShareRecordDialog.tsx`). Recipients view shared items under **Shared documents → Shared with me**, and owners can revoke access anytime under **Shared by me**.
- **Public business cards:** Separate from private shares; controlled per card via `is_public` and served at `/BusinessCard/<CARD_ID>` in four visual themes (`garden`, `minimal`, `midnight`, `terracotta`).

## Life Timeline & Medical Records privacy

- **Life Timeline (`timeline_events`, `timeline_event_links`):** Titles, descriptions, external URLs, attachment descriptors, and R2 attachment bytes are encrypted at rest on the server with AES-256-GCM derived from `TIMELINE_ENCRYPTION_KEY`. Automatic date events are generated from document, subscription, purchase, membership, academic, birthday, task, and reminder dates without duplicating source files.
- **Medical Records (`medical_records`, `medical_record_links`):** Strictly private, owner-scoped health records with private R2 attachments (`ReuiFileAttachmentField` + ReUI `Progress`) and ID-based links to contacts, reminders, and vault items.

## Global 7-day Trash

Supported deletes across Vault records, Contacts (single and bulk delete), Business Cards, Medical Records, manual Life Timeline posts, Photo Studio photos, PDF Studio documents, and Persora Tables soft-delete into `public.trash_items` (`src/components/TrashView.tsx`) for **7 days** before automatic purge (`pg_cron` job `persora-trash-expiry-purge`, throttled worker sweeps, or `POST /api/internal/trash-purge`). Restoring an item transactionally restores its folder (falling back to root if the folder was deleted) and applicable shares/links. Underlying R2 objects are deleted only on permanent delete or expiry purge when no live record or other Trash entry references the key.

## Complete account export & restore

From **Settings → Download a backup**, signed-in members download a streaming TAR archive containing `persora-export.json` and `files/`:

- Includes profile metadata, vault items and folders, contacts, business cards, medical records and links, shares, comments, notifications, billing history, decrypted Life Timeline entries and files, Calendar events/tasks/appointments/reminders/preferences, app launcher favorites (`workspacePreferences`), Habit Tracker habits/check-ins, and Loan Tracker loans/installments/payments/reminders.
- Omits password hashes, session tokens, server secrets, and Password Manager items (which remain gated behind the separate master password).
- **Idempotent restore:** Importing `persora-export.json` in **Settings** restores Habit Tracker (`POST /api/habits/import`) and Loan Tracker (`POST /api/loans/import`) records with owner validation and deterministic account-scoped IDs so re-importing the same backup never creates duplicates.
