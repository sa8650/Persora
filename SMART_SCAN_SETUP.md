# Smart Scan setup (Cloudflare Pages)

Smart Scan uses Azure AI Document Intelligence `prebuilt-read` for server-side OCR and the Cloudflare Workers AI binding for field extraction. It is available only to signed-in accounts. The original attachment is not changed; extracted suggestions remain editable and must be reviewed before saving.

## 1. Apply the database migration

Run `supabase/migrations/202610030004_smart_scan_cache.sql` against the Supabase project. The equivalent `smart_scan_cache` definition is also included in `supabase/schema.sql` for fresh installations.

The cache is keyed by account and the attachment's SHA-256 digest, stores OCR text only after payment-card numbers/security codes have been redacted, and expires after 24 hours. The table has RLS enabled and is accessible only through the server-side Supabase connection. The Pages Function also removes expired rows opportunistically.

## 2. Configure Azure AI Document Intelligence

1. Create an **Azure AI Document Intelligence** resource and deploy/enable the `prebuilt-read` model. Use the resource's HTTPS endpoint and one of its keys.
2. To retain Smart Scan's current **7 MB** file limit, use the **Standard (S0)** tier. Azure's free (F0) tier has a 4 MB input limit and processes only the first two PDF/TIFF pages; S0 supports files up to 500 MB and processes up to 2,000 PDF/TIFF pages. Smart Scan's own 7 MB limit remains in effect regardless of Azure's higher S0 limit.
3. In Cloudflare Pages → **Settings → Variables and Secrets**, add these as **encrypted secrets** under **Production**:

   - `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` — the resource endpoint, for example `https://<resource-name>.cognitiveservices.azure.com` (do not include an API path or query string).
   - `AZURE_DOCUMENT_INTELLIGENCE_KEY` — the Azure resource key.

4. Add the same secrets to **Preview** only if Smart Scan should run in preview deployments. Redeploy Pages after setting or rotating either secret.

The server-side Pages Function sends `base64Source` to the `prebuilt-read` analyze endpoint using REST API version `2024-11-30`, reads the returned `Operation-Location`, and polls Azure until analysis finishes. See Microsoft's [Analyze Document](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0+%282024-11-30%29) and [Get Analyze Result](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/get-analyze-result?view=rest-aiservices-v4.0+%282024-11-30%29) REST references. The Azure key is used only by the Pages Function; never add it to a `VITE_*` variable, browser code, an admin form, a checked-in `.env` file, or GitHub.

## 3. Add the Workers AI binding

In the Cloudflare Dashboard, open the Pages project and go to **Settings → Functions → Workers AI bindings**. Add a binding named exactly:

`AI`

The function calls `@cf/meta/llama-3.3-70b-instruct-fp8-fast` through this binding; Cloudflare lists this model as supporting JSON Mode. `AI` is a runtime binding, not a frontend API key or secret. Enable it for the same deployment environments in which scanning is enabled.

## 4. Build and deploy

Set the Pages build environment variable:

`VITE_USE_PAGES_FUNCTIONS=true`

Keep the existing server-only Supabase settings (`SUPABASE_URL` and `SUPABASE_SECRET_KEY`) configured for the Pages Function. Do not expose the database secret to Vite. The API route is `functions/api/[[path]].js`, which forwards to `cloudflare/api.js`.

Deploy the application, sign in with a connected account, attach a PDF or supported image in a vault form or Medical Records, then select **Scan**. You can apply or edit each suggested value before saving. Wallet-card records are intentionally excluded.

## Supported files and limits

- The existing Smart Scan UI/API accepts JPEG, PNG, WebP, GIF, TIFF, BMP, and PDF; the maximum upload remains **7 MB**.
- Azure `prebuilt-read` natively supports PDF, JPEG, PNG, BMP, and TIFF. For compatibility, the browser converts WebP and GIF scan copies to PNG (or JPEG if needed to stay within 7 MB); the stored/original attachment is not changed. For animated GIFs, the browser image conversion scans the first frame.
- Azure's S0 limit is up to 2,000 pages for PDF/TIFF; F0 processes only the first two pages. See Microsoft's [Read model input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read?view=doc-intel-4.0.0) for current file, page, and image-dimension limits.
- OCR text is bounded before extraction, payment-card numbers/security codes are redacted before caching and extraction, and suggestions without a verbatim OCR evidence quote are left blank and flagged for review.
- OCR text remains server-side. A completed scan is cached per account for 24 hours; retrying a scan can reuse the cached OCR while rerunning field extraction.
- OCR and Workers AI calls run server-side. Provider quotas and billing apply; review the Azure and Cloudflare limits for the target resources.

## Troubleshooting

- **“Azure Document Intelligence isn't configured”** — add both `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and `AZURE_DOCUMENT_INTELLIGENCE_KEY` as Cloudflare Pages encrypted secrets, then redeploy.
- **Azure authentication or endpoint errors** — confirm the endpoint is the resource's base HTTPS URL, the key belongs to that resource, and the secrets are set for the correct Pages environment.
- **File too large** — Smart Scan remains limited to 7 MB. Azure F0 accepts only 4 MB; use an S0 resource to retain the 7 MB app limit.
- **Unsupported WebP/GIF conversion** — update/reload the latest Persora app or save the image as PNG/JPEG and retry.
- **PDF/TIFF page count** — Azure F0 processes only the first two pages; use S0 for the full Smart Scan allowance of up to 2,000 pages.
- **“Cloudflare Workers AI isn't connected”** — add the `AI` Workers AI binding to the Pages project and redeploy.
- **“Scan caching is unavailable”** — apply the Smart Scan Supabase migration and confirm the server-side Supabase configuration.
- **Azure is still processing** — retry the scan if the provider does not finish within the request's polling window; the original attachment remains unchanged.
