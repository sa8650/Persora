# Persora Photo Studio

**Photo Studio** (`src/components/PhotoStudioView.tsx`, `PhotoOrganizeModal.tsx`, `PhotoEditorModal.tsx`) is a private workspace for official photos (passport, stamp, visa, national ID, job application) with folder organization, member sharing, 7-day Trash retention, print-metadata inspection, preset cropping, and hybrid AI background removal.

The UI uses Persora's in-repo ReUI primitives (`ReuiFileAttachmentField` / `Attachment` + `FileType` for photo intake, `Progress` via `TransferProgressIndicator` / `StageProgressIndicator` for upload and background-removal progress, `Badge` for metadata/preset tags, `IconTile` for empty states, and `Spinner` for processing states).

## Features

1. **Upload & metadata detection (`cloudflare/photo-metadata.js`, `src/lib/photo-studio-tools.ts`)**
   - Supports `JPEG`, `PNG`, and `WebP` (up to 15 MB per photo). Reads pixel dimensions and embedded EXIF/JFIF (`APP1`/`APP0`), PNG `pHYs`, and WebP container DPI metadata locally and server-side, displaying exact print dimensions in inches/mm (`300 DPI` reference when a file omits explicit DPI).
2. **Official size presets & custom framing (`PhotoEditorModal.tsx`)**
   - Built-in presets for **Passport (`40 × 50 mm`)**, **US Passport / Visa (`2 × 2 in`)**, **UK / Schengen Visa (`35 × 45 mm`)**, **Stamp (`20 × 25 mm`)**, **ID Card (`30 × 38 mm`)**, **Job Application (`45 × 55 mm`)**, plus custom `mm` / `in` / `px` + DPI (`72–1200`), zoom, pan, 90° rotation, straighten (`-15°` to `+15°`), solid background fill colors, JPEG/PNG output with embedded DPI headers, and **Save as copy** vs. **Replace original**.
3. **Hybrid background removal (`cloudflare/photo-studio.js`, `src/lib/bg-remove-local.ts`)**
   - **Primary (Cloudflare Workers AI):** `POST /api/photo-studio/remove-bg` invokes `@cf/bria/remove-background` (RMBG 2.0) when `env.AI` is bound and AI background removal is enabled in **Admin → AI Controls**.
   - **Automatic on-device fallback:** If cloud AI is unavailable, rate-limited, or running in offline/demo mode, Persora runs quantized **ORMBG** in a Web Worker via `onnxruntime-web` (WebGPU when available, WASM fallback) and caches weights in IndexedDB.

## Database, configuration, and tests

- **Schema:** `public.photo_studio_photos`, `public.vault_folders` (`photo-studio` scope), `public.record_shares` (`photo_studio_photo`), and `public.trash_items` (`photo_studio_photo`) are provisioned by [`supabase/schema.sql`](./supabase/schema.sql).
- **Cloudflare settings:** `VAULT_FILES` (R2), `AI` (Workers AI binding, accept Bria RMBG terms once in Cloudflare dashboard), optional `PHOTO_STUDIO_AI_GATEWAY`, and optional build overrides `VITE_PHOTO_STUDIO_MODEL_BASE` / `VITE_PHOTO_STUDIO_ORT_WASM_BASE`.
- **Tests:** `tests/photo-studio.test.mjs`.
