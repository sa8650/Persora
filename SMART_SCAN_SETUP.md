# Smart Scan setup (Cloudflare Pages)

Smart Scan uses Google Cloud Vision for server-side OCR and the Cloudflare Workers AI binding for field extraction. It is available only to signed-in accounts. The original attachment is not changed; extracted suggestions remain editable and must be reviewed before saving.

## 1. Apply the database migration

Run `supabase/migrations/202610030004_smart_scan_cache.sql` against the Supabase project. The equivalent `smart_scan_cache` definition is also included in `supabase/schema.sql` for fresh installations.

The cache is keyed by account and the attachment's SHA-256 digest, stores OCR text only after payment-card numbers/security codes have been redacted, and expires after 24 hours. The table has RLS enabled and is accessible only through the server's service-role connection. The Pages Function also removes expired rows opportunistically.

## 2. Configure Google Cloud Vision

1. In Google Cloud Console, select the project that will pay for OCR, enable the **Cloud Vision API**, and ensure billing is enabled.
2. Create a service account for the application and grant only the permissions needed by your organization's Vision/API configuration. Do not grant project Owner.
3. Create a JSON key for that account and store the **entire JSON document** in Cloudflare Pages under **Settings → Variables and Secrets** as a **Secret** named:

   `GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_JSON`

4. Configure the secret for both Production and Preview environments if Smart Scan should work in both.

The key is used by the Pages Function to mint a short-lived Google OAuth token. It is never sent to the browser. Do not put the key in `VITE_*` variables, frontend source, a checked-in `.env` file, or GitHub. Rotate/revoke the key in Google Cloud if it is exposed.

## 3. Add the Workers AI binding

In the Cloudflare Dashboard, open the Pages project and go to **Settings → Functions → Workers AI bindings**. Add a binding named exactly:

`AI`

The function calls `@cf/meta/llama-3.2-3b-instruct` through this binding. `AI` is a runtime binding, not a frontend API key or secret. Enable it for the same deployment environments in which scanning is enabled.

## 4. Build and deploy

Set the Pages build environment variable:

`VITE_USE_PAGES_FUNCTIONS=true`

Keep the existing server-only Supabase settings (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`) configured as Cloudflare Pages secrets/variables. Do not expose the service-role key to Vite. The API route is `functions/api/[[path]].js`, which forwards to `cloudflare/api.js`.

Deploy the application, sign in with a connected account, attach a PDF or supported image in a vault form or Medical Records, then select **Scan**. You can apply or edit each suggested value before saving. Wallet-card records are intentionally excluded.

## Supported files and limits

- JPEG, PNG, WebP, GIF, TIFF, BMP, and PDF; maximum raw upload size is 7 MB.
- Images use Vision `images:annotate` with `DOCUMENT_TEXT_DETECTION`.
- PDFs use inline Vision `files:annotate`; Google processes at most the first five pages synchronously. The UI warns about this limit. Full-document OCR beyond five pages needs an asynchronous Google Vision workflow with Cloud Storage input/output and is not enabled by this implementation.
- Vision/OCR and Workers AI calls run on the server. OCR text is bounded before extraction, and suggestions without a verbatim OCR evidence quote are left blank and flagged for review.
- If a scan fails, the panel offers a retry. A completed scan is cached per account for 24 hours; the browser never receives the cached OCR text.
- Google Cloud Vision and Workers AI usage is subject to provider quotas and billing; review those limits for the target Cloudflare/Google projects.

## Troubleshooting

- **“Google Cloud Vision isn't configured yet”** — add the `GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_JSON` Pages Secret and redeploy.
- **Vision authentication/processing errors** — verify the secret is valid service-account JSON, Vision API is enabled, and project billing/API permissions are correct.
- **“Cloudflare Workers AI isn't connected”** — add the `AI` Workers AI binding to the Pages project and redeploy.
- **“Scan caching is unavailable”** — apply the Smart Scan Supabase migration and confirm the server's Supabase service-role configuration.
- **File too large/unsupported** — use a supported image or a PDF no larger than 7 MB. Long PDFs currently scan only the first five pages.
