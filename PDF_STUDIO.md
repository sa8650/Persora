# PDF Studio

PDF Studio is the workspace page for **creating and editing PDFs in the browser**. It's under **Knowledge & identity → PDF Studio**, next to Projects. All PDF processing happens on the member's device. Nothing is uploaded and no record is created until the member presses **Save to Persora**. Saved PDFs go in a dedicated, private PDF Studio library with its own folders and Trash support. It uses the same R2 bucket, sessions, storage quota, upload plan, folder shelf and modal shell as the rest of Persora.

## What members can do

| Area | What it does | When anything is stored |
| --- | --- | --- |
| **Create PDF** | Add images (JPEG, PNG, WebP, GIF, BMP), text files (TXT, MD, CSV), typed text blocks and existing PDFs. You can reorder them with drag-and-drop or the arrow buttons. Choose a page size (A4, Letter, Legal or *Fit to image*), orientation, margins and text size. Then use **Download PDF** or **Create & edit**. | Never. The PDF is built in the browser. |
| **Edit PDF** | Open one or more PDFs (several files are merged in order), a created PDF, or a saved PDF from the library. Works on page thumbnails and a zoomable, continuous page view. | Only on **Save to Persora**. |
| **Library** | Search, sort, browse by folder, open in the editor, download, edit details, move between folders and delete (moves to Trash and can be restored for 7 days). | Detail edits, moves and deletes are saved straight away. They're metadata only. |

### Editor tools

The toolbar is split into three groups. Every button has a tooltip and an accessible label.

- **Annotate:**
  - **Select & move** (V): move, resize, nudge with the arrow keys (Shift = 10 pt), delete, duplicate, double-click text to edit it.
  - **Add text** (T).
  - **Highlight** (H).
  - **Rectangle** (R) and **Ellipse** (O), with optional fill.
  - **Line** (L) and **Arrow** (A); Shift snaps to 45°.
  - **Pen** (P), for freehand drawing.
  - **Signature**: draw, type or upload one; a scanned paper background can be made transparent.
  - **Image**.
  - A contextual properties bar sets colour, line width, text size and bold.
- **Pages:**
  - Rotate left or right.
  - Move earlier or later, or drag thumbnails. Dragging a selected group moves the whole group.
  - Duplicate.
  - Insert a blank page, insert files after the current page, or merge files at the end. Files can also be dropped onto the page view.
  - **Extract or split**: selected pages, page ranges such as `1-3, 5, 8-` (optionally one PDF per range), or every *N* pages. More than one result downloads as a ZIP.
  - **Export images**: PNG or JPG at 72, 150 or 300 DPI, with or without annotations. More than one page downloads as a ZIP.
  - **Delete**, with a confirmation.
  - Page operations apply to the ticked pages, or to the current page when none are ticked. Shift-click selects a range.
- **View:**
  - Zoom: Automatic, Fit width, Fit page or 25–400%.
  - Previous and next page, and a page-number box (commits on Enter).
- **Header:**
  - **Undo / Redo**: Ctrl/⌘+Z and Ctrl/⌘+Shift+Z or Ctrl+Y, up to 100 steps.
  - **Download PDF**.
  - **Save to Persora**: Ctrl/⌘+S opens the save dialog.
  - An unsaved-changes indicator.

**Overlays vs. existing content.** Text, highlights, shapes, ink, images and signatures are **added on top of** the page. When the PDF is exported they're drawn into the page content. PDF Studio doesn't edit a PDF's *existing* text or images, and the UI says so. Signatures are image overlays, not certificate-based digital signatures.

**Not losing work.**
- Closing the editor with unsaved changes asks for confirmation.
- Leaving or reloading the browser tab triggers the browser's *leave page?* prompt.
- A download counts as "saved" for a new document. For a document opened from the library, only **Save to Persora** clears the indicator, because the library copy would otherwise be out of date.

## How it works

| Concern | Implementation |
| --- | --- |
| Viewing | [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`, Apache-2.0) renders pages on a canvas. Pages render only when near the viewport, render scale is capped at about 16 MP per page, and thumbnails go through a small render queue (two at a time). |
| Editing & export | [pdf-lib](https://pdf-lib.js.org/) (MIT). Export copies the source pages, applies the rotation, and draws the overlays in each page's own user space. This handles existing `/Rotate` and crop-box offsets, so annotations land exactly where they were placed. |
| Text | Standard PDF fonts only cover Latin (WinAnsi) characters. Text that needs other scripts (for example Bengali) is drawn with the device's fonts and embedded as an image. It looks right but can't be selected or searched, and Create PDF warns about this. |
| Document model | The working document is a list of pages. Each page references a source file and page index, plus a rotation and a list of overlays. Edits are cheap, undoable snapshots; the PDF bytes are rebuilt only on Download, Save or Export. |
| Lazy loading | The library page is a lazy route chunk. pdf-lib, PDF.js and the editor load only when Create or Edit is opened. The PDF.js worker, CMaps, standard fonts and WASM decoders are served from `/pdfjs/<version>/`, which the build copies there. `public/_headers` marks them `immutable` so browsers cache them. |
| Limits | Open or insert files up to 100 MB each and 1,500 pages per editing session. Images up to 40 MB; text files up to 5 MB. Encrypted or password-protected PDFs and damaged files get a clear error. DOCX and other office files aren't supported, so export them to PDF first. |

No external PDF API is used. PDF Studio doesn't call any third-party service and needs no installs or AI models.

## Saving to Persora

**Save to Persora** opens the save dialog: title, folder (or a new folder) and notes. For a PDF opened from the library it offers **Update the saved PDF** or **Save as a new PDF**. On submit:

1. The PDF is built in the browser.
2. A small page-1 JPEG thumbnail (≤ 60,000 characters) is rendered for the library card.
3. The file is checked against the upload size limit.
4. The file is uploaded with a progress bar.

Each step is shown in the dialog. Failures keep the dialog open with the error, and the work stays in the editor.

| Route | Purpose |
| --- | --- |
| `GET /api/pdf-studio/documents` | List the member's saved PDFs (metadata only). |
| `POST /api/pdf-studio/documents` | **Save**: multipart `file` + JSON `meta`. Requires an active upload plan, the storage quota and `maxUploadMb` (capped at 150 MB). The bytes must be a real PDF (`%PDF-` header and `%%EOF`). |
| `PATCH /api/pdf-studio/documents/:id` | Update title, notes or folder. |
| `DELETE /api/pdf-studio/documents/:id` | Move to the global Trash (`kind = 'pdf_studio_document'`). |
| `GET /api/pdf-studio/documents/:id/file` | Stream the private file to its owner (`?download=1` for an attachment). Never cached. |
| `PUT /api/pdf-studio/documents/:id/file` | **Update the saved PDF**: replace the file. Same checks as POST. The storage quota accounts for the bytes being released. |

Files are stored in R2 under `<userId>/pdf-studio/<uuid>.pdf`. When a file is replaced, the old object is deleted only after the database row points at the new one. In demo mode, or without the Pages API, members can still create, edit and download PDFs; the library and Save explain that a signed-in account is needed. Members without an upload plan see an upgrade prompt in the save dialog.

## Deployment

1. **Database.** Apply `supabase/migrations/202610230008_pdf_studio.sql` after the earlier migrations; it needs `trash_items` from the global-trash migration. It does the following:
   - Adds the `pdf-studio` folder scope.
   - Creates `pdf_studio_documents` with RLS enabled, size/page/thumbnail/metadata checks and a folder-scope guard trigger.
   - Allows the `pdf_studio_document` Trash kind.
   - Adds the save, replace and trash RPCs (`persora_pdf_studio_save`, `_replace_file`, `_trash_move`, `_trash_restore`).
   - `supabase/schema.sql` includes the new folder scope for fresh installs.
2. **Pages.** No new bindings or variables. The existing `VAULT_FILES` R2 binding and the Supabase variables are used. The build copies the PDF.js assets into `dist/pdfjs/<version>/` (about 3.4 MB, no file near the 25 MiB Pages limit).
3. **Tests.**
   - `tests/pdf-studio-routes.test.mjs` covers auth, plan, quota, validation, the save/replace/delete flows and ownership.
   - `tests/pdf-studio-engine.test.mjs` builds real PDFs with the engine and checks them through PDF.js. It covers rotation and crop placement, page order and duplicates, metadata, non-Latin text, image layout, encrypted files and ZIP output.
