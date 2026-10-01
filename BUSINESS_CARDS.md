# Persora Digital Business Cards

The **Digital business card** workspace page manages one or more structured cards per Persora account. Cards are private by default. Public sharing is controlled by a server-generated opaque ID and an `is_public` flag checked on every public data/photo request.

## Database and deployment

Apply `supabase/migrations/20260930_business_cards.sql` and then `supabase/migrations/20260930_account_sharing_and_card_styles.sql` to existing databases, or use the matching definitions in `supabase/schema.sql` on a fresh setup. It creates `business_cards` and `business_card_reports`; both have RLS enabled and no browser-role table privileges. The Pages API uses the server-only Supabase key and scopes owner operations by the authenticated profile UUID.

The feature uses the existing Cloudflare Pages API, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and private `VAULT_FILES` R2 binding. Do not expose those server secrets in the browser or an APK. Demo cards are browser-local and cannot be public.

## Authenticated card API

The web app uses Persora's existing `/api` session cookie. Business-card owner routes require a valid signed-in session.

| Method and route | Purpose |
| --- | --- |
| `GET /api/business-cards` | List the current user's private and public cards. |
| `POST /api/business-cards` | Create or update a card. `id` is optional for create. |
| `DELETE /api/business-cards?id=<uuid>` | Delete an owned card and clean up unreferenced profile/logo images. Public access stops as the row is deleted. |
| `POST /api/upload` | Upload JPG/JPEG, PNG, WEBP, or GIF card photos/logos as multipart field `file`; save the returned `key` in `profilePhotoKey` or `businessLogoKey`. |

Create/update JSON uses camelCase: `fullName`, `jobTitle`, `company`, `phoneNumbers` (array of `{label,number}`), `email`, `websites` (array), `socialLinks` (array of `{platform,url}`), `address`, `bio`, `customLinks` (array of `{label,url}`), `isPublic`, `style` (`garden`, `minimal`, `midnight`, or `terracotta`), `profilePhotoKey`, and `businessLogoKey`. The response/list uses database names such as `full_name`, `phone_numbers`, `is_public`, `card_id`, `profile_photo_key`, `business_logo_key`, and `card_style`.

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

Vault file uploads use XMLHttpRequest upload events so the UI can show a determinate percentage, transferred bytes, and estimated time remaining. This covers normal private attachments, shared-document attachments, contact photos, and business-card profile/logo images. vCard import reports how many contacts are being saved, which one is current, percent complete, and estimated time remaining; photo transfers inside an import also contribute to progress.
