# Persora Smart Scan Setup

Smart Scan (`src/components/SmartScan.tsx`, `cloudflare/smart-scan.js`) lets signed-in members scan supported documents (`PDF`, `JPG/JPEG`, `PNG`, `WEBP` up to 10 MB) inside vault and medical-record forms and review suggested field values before saving.

The Smart Scan picker and status cards use Persora's ReUI primitives (`Attachment`, `FileType`, `Progress` via `StageProgressIndicator`, `Badge`, and `Spinner`).

## Processing pipeline

1. **Upload & validation (`POST /api/smart-scan`):** Requires a signed-in member session, active global Smart Scan switch (**Admin → AI Controls / Smart Scan**), per-member quota check (`smart_scan_usage`), and magic-byte validation (`PDF`, `JPEG`, `PNG`, `WEBP`).
2. **OCR:** Server-side Azure AI Document Intelligence (`prebuilt-read` REST v4.0 `2024-11-30`) extracts readable text from photos, scans, and PDFs.
3. **Sensitive-number redaction & 24h cache:** Payment-card PANs and CVV/CVC security codes are redacted before caching per `(user_id, sha256(file), record_type)` for 24 hours in `smart_scan_cache` (cached hits do not consume monthly scan quota).
4. **Structured extraction:** Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) maps OCR text to the active record type's fields and places extra readable facts into editable **Additional Data** rows. Nothing is saved to the member's vault until they review and click **Save**.

## Required configuration

1. **Database:** Included in [`supabase/schema.sql`](./supabase/schema.sql) (`smart_scan_cache`, `smart_scan_usage`, and platform settings in `app_settings`).
2. **Azure AI Document Intelligence:** Create a Document Intelligence resource in Azure Portal and add two encrypted secrets in **Cloudflare Pages → Settings → Variables and Secrets**:
   - `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` (`https://<resource-name>.cognitiveservices.azure.com/`)
   - `AZURE_DOCUMENT_INTELLIGENCE_KEY`
3. **Cloudflare Workers AI:** Bind Workers AI under **Cloudflare Pages → Settings → Bindings → Workers AI** with variable name `AI`.
4. **Admin quotas & controls:** Adjust monthly scan limits per plan or pause Smart Scan globally in `/admin` without redeploying.
