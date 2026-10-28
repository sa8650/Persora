# Persora Digital Business Cards

The **Digital business card** workspace (`src/components/BusinessCardsView.tsx`) and native Android app manage one or more structured cards per Persora account. Cards are private by default; public sharing is controlled by a server-generated opaque 32-character uppercase hex `card_id` and an `is_public` flag verified on every public data and image request.

## Database and deployment

For a fresh Supabase installation, run `supabase/schema.sql`, which creates `business_cards`, `business_card_reports`, `record_shares`, `vault_folders` (`business-cards` scope), `trash_items` (`business_card` kind), RLS policies, and `SECURITY DEFINER` RPCs. Browser roles have no direct table privileges; all authenticated and public card endpoints run through Cloudflare Pages Functions (`cloudflare/api.js`) backed by `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the private `VAULT_FILES` R2 bucket.

## Authenticated card API

| Method and route | Purpose |
| --- | --- |
| `GET /api/business-cards` | List the signed-in member's private and public cards. |
| `POST /api/business-cards` | Create (`id` omitted) or update (`id` included) an owned card. |
| `DELETE /api/business-cards?id=<uuid>` | Move an owned card to Global Trash (7-day retention) and immediately disable public access. |
| `POST /api/upload` | Upload `JPG/JPEG`, `PNG`, `WEBP`, or `GIF` profile photos and logos via `multipart/form-data` (`file`); pass the returned `key` in `profilePhotoKey` or `businessLogoKey`. |

Create/update payloads accept `fullName`, `jobTitle`, `company`, `phoneNumbers` (`{label, number}[]`), `email`, `websites` (`string[]`), `socialLinks` (`{platform, url}[]`), `address`, `bio`, `customLinks` (`{label, url}[]`), `isPublic`, `style` (`garden`, `minimal`, `midnight`, `terracotta`), `profilePhotoKey`, `businessLogoKey`, and optional `folderId`.

## Public URLs and privacy

Enabling `isPublic` assigns a persistent 128-bit hex `card_id` served at:

```text
https://<Persora-domain>/BusinessCard/<CARD_ID>
```

Switching public sharing off (`is_public = false`) keeps `card_id` reserved for later re-enabling while immediately returning `404` on all public routes:

- `GET /api/public-cards/<CARD_ID>` — allow-listed public card fields only (omits internal UUIDs, account email, storage keys, and unrelated vault data).
- `GET /api/public-cards/<CARD_ID>/photo?kind=profile|logo` — streams the card image (`Cache-Control: no-store`) only while `is_public` is `true`.
- `POST /api/public-cards/<CARD_ID>/report` — submits an abuse report (`Spam or misleading`, `Inappropriate content`, `Impersonation`, `Other`) with network/reporter deduplication.

## Web UI, attachments, and upload progress

Profile photo and company logo pickers in `BusinessCardsView.tsx` use the in-repo ReUI attachment pattern (`ReuiFileAttachmentField` from `src/components/reui/c-attachment-6.tsx`, built on `Attachment`, `FileType`, `Spinner`, and `useFileUpload`), status indicators use ReUI `Badge`, and empty/header icons use ReUI `IconTile`. File uploads stream live byte-level XHR progress through `TransferProgressIndicator` (`src/components/ProgressIndicator.tsx`, powered by ReUI `Progress`).
