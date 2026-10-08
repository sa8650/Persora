# Persora Digital Business Cards

The **Digital business card** workspace page and native Android app manage one or more structured cards per Persora account. Cards are private by default. Public sharing is controlled by a server-generated opaque ID and an `is_public` flag checked on every public data/photo request. Members can edit their card, preview its style, view/share its public link and QR code, or turn public sharing off; public visibility is separate from private sharing with another Persora member.

## Database and deployment

For a fresh database, run the complete `supabase/schema.sql`. For an existing database, apply `supabase/migrations/20260930_business_cards.sql` and `20260930_account_sharing_and_card_styles.sql` (plus any later unapplied migrations in filename order). This creates `business_cards`, `business_card_reports`, sharing tables and card-style support; the tables use RLS and have no browser-role privileges. The Pages API uses the server-only database secret and scopes owner operations by the authenticated profile UUID. Keep the incremental migrations as the upgrade history for deployed databases.

The website and Android app use the existing Cloudflare Pages API, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and private `VAULT_FILES` R2 binding. Do not expose those server secrets in browser code or the APK. Demo cards are browser-local and cannot be public.

## Authenticated card API

The web app uses Persora's existing `/api` session cookie. Business-card owner routes require a valid signed-in session.

| Method and route | Purpose |
| --- | --- |
| `GET /api/business-cards` | List the current user's private and public cards. |
| `POST /api/business-cards` | Create or update a card. `id` is optional for create. |
| `DELETE /api/business-cards?id=<uuid>` | Delete an owned card and clean up unreferenced profile/logo images. Public access stops as the row is deleted. |
| `POST /api/upload` | Upload JPG/JPEG, PNG, WEBP, or GIF card photos/logos as multipart field `file`; save the returned `key` in `profilePhotoKey` or `businessLogoKey`. |

Create/update JSON uses camelCase: `fullName`, `jobTitle`, `company`, `phoneNumbers` (array of `{label,number}`), `email`, `websites` (array), `socialLinks` (array of `{platform,url}`), `address`, `bio`, `customLinks` (array of `{label,url}`), `isPublic`, `style` (`garden`, `minimal`, `midnight`, or `terracotta`), `profilePhotoKey`, `businessLogoKey`, and optional `folderId` for a folder in the Business Cards space. The response/list uses database names such as `full_name`, `phone_numbers`, `is_public`, `card_id`, `profile_photo_key`, `business_logo_key`, `card_style`, and `folder_id`.

The server validates URLs as HTTP(S), email format, phone numbers, image ownership/content type, category/platform names, and list/field limits. Profile photos and logos are private R2 objects for private cards; a separate public image route checks card visibility before streaming them.

## Public URLs and privacy

When a card is saved with `isPublic: true`, the server assigns a cryptographically random, 128-bit uppercase hexadecimal `card_id` (32 characters) if it does not already have one. Its canonical URL is:

```text
https://<Persora-domain>/BusinessCard/<CARD_ID>
```

The same ID is retained while the card is edited, and also when public sharing is switched off and later re-enabled. Turning sharing off updates `is_public=false`; the URL and image routes immediately return a non-disclosing `404` until it is public again. Public JSON omits the internal UUID, owner UUID, account email, timestamps, photo storage keys, and all unrelated Persora records. It includes only the profile fields explicitly saved on that card.

Unauthenticated public API routes:

- `GET /api/public-cards/<CARD_ID>` — allow-listed public profile fields only; private/missing cards return `404`.
- `GET /api/public-cards/<CARD_ID>/photo?kind=profile|logo` — streams an image only while that card is public; responses are `no-store`.
- `POST /api/public-cards/<CARD_ID>/report` — accepts `reason` (`Spam or misleading`, `Inappropriate content`, `Impersonation`, or `Other`) and optional `details` (up to 500 chars). The server stores the report and a one-way reporter/IP fingerprint; duplicate reports from the same network for the same card are suppressed.

The browser route `/BusinessCard/<CARD_ID>` is a public SPA page; it does not require a Persora login. It offers Call, Email, Website, Save Contact/vCard, website and social links, custom links, a QR code, and the optional report form. Social networks display as logo marks with accessible labels.

## Upload and import progress

In the web client, file uploads use XMLHttpRequest events to show a determinate percentage, transferred bytes and estimated time remaining. This covers private and shared attachments, contact photos, and business-card profile/logo images. Web vCard import reports how many contacts are being saved, which one is current, percent complete and estimated time remaining; embedded photo transfers also contribute to progress. The Android app has the same card manager and QR/public-card workflows; its phone-contact background import and notification progress are documented in [`CONTACTS.md`](./CONTACTS.md).
