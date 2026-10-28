# Persora PDF Studio

**PDF Studio** (`src/components/PdfStudioView.tsx`) is Persora's workspace for creating, organizing, annotating, watermarking, encrypting, and storing PDFs inside a private library with folders and 7-day Global Trash support.

## Capabilities

1. **Create PDF (`src/components/PdfCreateModal.tsx`, `src/lib/pdf-create.ts`)**
   - Build a new PDF from **Images** (`PNG`, `JPG`, `WebP`), **Plain Text** (automatic line/page wrapping, A4/Letter, portrait/landscape, margins, font sizes), or **Mixed sources** (images, text blocks, and existing PDFs in custom order).
   - Source pickers use Persora's ReUI `Attachment` + `FileType` (`ReuiFileAttachmentField`), and saving streams upload progress via ReUI `Progress` (`TransferProgressIndicator`).
2. **Organize, merge, split & export (`src/components/PdfEditorModal.tsx`, `PdfEditorPages.tsx`, `PdfEditorDialogs.tsx`, `src/lib/pdf-ops.ts`)**
   - Thumbnail grid rendered via `pdfjs-dist` with page reorder, 90° clockwise/counter-clockwise rotation, page deletion, multi-PDF merge, range/single-page split (`1-3, 5`), and **PDF → PNG/JPG** page export (`1×`, `2×`, `3×` DPI scale).
3. **Annotate, sign & watermark (`src/lib/pdf-Overlay.ts`, `src/components/PdfWatermarkPanel.tsx`)**
   - Vector highlight, freehand ink, text boxes, shapes, and drawn/typed/image signatures on an interactive SVG overlay (`svg.pdfs-overlay-layer`) with undo/redo, flattened cleanly into PDF coordinates on export/save.
   - Text or image watermarks (`src/components/PdfWatermarkPanel.tsx`) with live preview (`.pdfs-watermark`), opacity, rotation, scale, position (diagonal, center, corners, tiled), and page-range targeting.
4. **Password lock & unlock (`src/components/PdfSecurityPanel.tsx`, `src/lib/pdf-crypto.ts`)**
   - Runs **100% locally in WebAssembly** via `@mssio/qpdf-wasm` (`AES-256` user/owner passwords + print/copy/modify permission flags, or unlocking with the current password). Passwords never leave the browser.
5. **Save & download (`src/components/PdfSaveModal.tsx`)**
   - Download locally at any time, or save to the private PDF Studio library (`POST /api/pdf-studio` / `PATCH /api/pdf-studio/:id` — either **Save as new PDF** or **Replace original**), counting toward combined storage quota.

## Database, API, and tests

- **Schema:** `public.pdf_studio_documents`, `public.vault_folders` (`pdf-studio` scope), and `public.trash_items` (`pdf_studio_document` kind) are defined in [`supabase/schema.sql`](./supabase/schema.sql) with RLS enabled and no browser-role access.
- **Routes:** `GET /api/pdf-studio`, `POST /api/pdf-studio`, `GET /api/pdf-studio/:id/file`, `PATCH /api/pdf-studio/:id`, `DELETE /api/pdf-studio/:id` (moves to 7-day Trash), plus `/api/folders?scope=pdf-studio`.
- **Tests:** `tests/pdf-studio.test.mjs`, `tests/pdf-studio-routes.test.mjs`, and `npm run test:e2e:pdf`.
