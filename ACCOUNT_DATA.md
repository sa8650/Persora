# Persora account data, sharing, and storage

## Combined storage quota

Persora displays and enforces the member quota against combined usage:

```text
combined usage = serialized bytes of owned vault/contact/business-card/medical-record database rows + bytes of R2 objects under the member's private account prefix
```

The database component is the UTF-8 size of serialized owned rows in `vault_items`, `contacts`, `business_cards`, `timeline_events`, `timeline_event_links`, `medical_records`, and `medical_record_links`. It is a practical per-account data measure, not Postgres physical page/index overhead. The file component is the sum of private R2 object sizes, including attachment, contact-photo, card-image, and medical-record files. Upload checks compare the new file with this combined usage before accepting it. Billing and the workspace overview show the combined total and its database/file breakdown; the admin storage panel separately reports aggregate database payload and R2 size without showing names or record contents.

## Private record sharing

A member can share a selected contact or business card with an active Persora account by seven-digit Persora ID or registered email. This is separate from public sharing: a private card can be shared only with the chosen Persora user, and it does not create or reveal its public URL. Shared responses contain only the selected record's contact/card fields and omit owner UUIDs, storage keys, and account security information. Shared record access can be revoked from **Shared documents → Shared by me**. Incoming shared contacts and cards are shown under **Shared with me**. The new `record_shares` table is service-role-only and covered by RLS.

The **Shared in Public** tab lists the current member's business cards whose public-sharing toggle is enabled. It is a management overview, not a global directory; private cards never appear there.

## Card styles

A card editor can choose one of four looks—Garden, Minimal, Midnight, and Terracotta. Style is stored as `business_cards.card_style`, appears in the live editor preview, and is returned on the public card. It changes presentation only, not which data is made public.

## Life Timeline privacy and date catch-up

The private `timeline_events` and `timeline_event_links` tables are accessible only through authenticated, owner-scoped Pages API operations; direct browser database roles have no access. Event titles, descriptions, external URLs, and attachment descriptors are encrypted with AES-256-GCM before Postgres storage. Timeline file bytes are also encrypted before upload to private R2. The encryption key is derived only from the stable Cloudflare `TIMELINE_ENCRYPTION_KEY` secret. Configure it before posting any timeline events, keep it backed up and unchanged; replacing or removing it without first re-encrypting all timeline payloads and files prevents decryption. This protects data at rest but is not end-to-end encryption because the authenticated server decrypts events for the owner. Event date, automatic/manual type, generated deduplication key, and linked record IDs remain queryable metadata for ordering, catch-up, and navigation.

Automatic events are generated from applicable existing dates: document issue/expiry, academic payment, subscription start/renewal, purchase/warranty, membership start/expiry, account registration, family birthdays (annually), unfinished task due dates and reminders (alarms do not create timeline events). Records are linked by IDs; source documents and files are not copied. The browser calculates dates locally while Persora is open and displays unsynced automatic events as waiting to sync offline. On reconnect or next authenticated app open, the API scans current records and deduplicates/catches up. It does not guarantee background work after the browser/app is fully closed.

## Medical Records privacy and links

Medical records use authenticated, owner-scoped `/api/medical-records` routes and service-role-only Postgres tables protected by RLS. There is no medical-record sharing or public route. Uploaded files are private R2 objects tagged with the owning account and are only served after the API confirms that the requested file belongs to one of that owner's medical records. Links to contacts, reminders, and other vault records store their existing record IDs only; linking a document does not copy its file. The feature does not claim end-to-end or field-level encryption.

## Complete account export

From **Settings → Download a backup**, a signed-in cloud account downloads a streaming TAR archive. `persora-export.json` contains the member profile fields, owned vault records, contacts, business cards, private medical records and links, share relationships, authored comments, notifications, subscription, payment history, and decrypted Life Timeline posts/record links. Ordinary private R2 objects, including medical-record files, are included in `files/`; referenced encrypted timeline attachments are decrypted by the authenticated export service and included there too, with an attachment manifest in the JSON. Password hashes, session tokens, other users' private records, and unrelated system data are not exported. The local demo export is a JSON file containing its local records.
