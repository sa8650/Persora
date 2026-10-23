# PDF Studio

PDF Studio is the workspace page for **creating, editing, annotating and password-protecting PDFs in the browser**. It's under **Knowledge & identity → PDF Studio**, next to Projects. All PDF processing happens on the member's device. Nothing is uploaded and no record is created until the member presses **Save to Persora**. Saved PDFs go in a dedicated, private PDF Studio library with its own folders and Trash support. It uses the same R2 bucket, sessions, storage quota, upload plan, folder shelf and modal shell as the rest of Persora.

## What members can do

The page has a small heading, then a segmented control — **Create PDF | Edit PDF | PDF Security** — that shows one workspace at a time (arrow keys move between the tabs). Below it is the saved-PDF library. On phones the control spans the full width and the panels stack.

| Area | What it does | When anything is stored |
| --- | --- | --- |
| **Create PDF** | Add images (JPEG, PNG, WebP, GIF, BMP), text files (TXT, MD, CSV), typed text blocks and existing PDFs. You can reorder them with drag-and-drop or the arrow buttons. Choose a page size (A4, Letter, Legal or *Fit to image*), orientation, margins and text size. Then use **Download PDF** or **Create & edit**. | Never. The PDF is built in the browser. |
| **Edit PDF** | Open one or more PDFs (several files are merged in order), a created PDF, or a saved PDF from the library. Works on page thumbnails and a zoomable, continuous page view. | Only on **Save to Persora**. |
| **PDF Security** | **Lock PDF** adds a password with real AES-256 encryption. **Unlock PDF** removes a password you know. Both are done locally with qpdf (see below) and the result is checked before it's offered for download. | Never. The locked or unlocked copy is only downloaded. |
| **Library** | Search, sort, browse by folder, open in the editor, download, edit details, move between folders and delete (moves to Trash and can be restored for 7 days). | Detail edits, moves and deletes are saved straight away. They're metadata only. |

### Editor tools

An **Annotate | Pages** switch at the left of the toolbar picks the editing mode (Annotate is the default). View controls are always visible. Every button has a tooltip and an accessible label.

- **Annotate mode:**
  - **Select & move** (V): move, resize, nudge with the arrow keys (Shift = 10 pt), delete, duplicate, double-click text to edit it.
  - **Add text** (T).
  - **Highlight** (H): a free-form translucent box.
  - **Underline** (U) and **Strike-through** (X): drag across a line of text. Where the page has a real text layer the stroke snaps to each line's baseline (or middle, for strike-through) and to the words' width. On scanned pages without text it follows the drag.
  - **Rectangle** (R) and **Ellipse** (O), with optional fill.
  - **Line** (L) and **Arrow** (A); Shift snaps to 45°.
  - **Pen** (P), for freehand drawing.
  - **Signature**: draw, type or upload one; a scanned paper background can be made transparent.
  - **Image**.
  - **Watermark** (W): opens the watermark panel. See [Watermark](#watermark).
  - A contextual properties bar sets colour, line width, text size and bold.
- **Pages mode:**
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

### Watermark

**Edit PDF → Annotate → Watermark** opens a side panel (a bottom sheet on phones). The watermark previews live on the real pages and thumbnails while you change it. One watermark per document; applying a new one replaces the old.

- **Text:** text (up to 120 characters), font (Helvetica, Times or Courier, each regular or bold), size (fixed 6–400 pt, or *scale to page* as 5–150% of the page width), colour, opacity (5–100%) and rotation.
- **Image:** upload a JPEG, PNG, WebP, GIF or BMP. Size is a percentage of the page width and the aspect ratio is always kept. PNG transparency is preserved. Opacity and rotation work as for text.
- **Position:** Center, Diagonal (follows each page's corner-to-corner angle), the four corners (with a margin), Custom (click or drag on a page to place it) or **Tiled** (repeated across the page with adjustable spacing, at most 400 copies per page).
- **Pages:** all pages, the current page, or a page range such as `1-3, 7`. Pages added later follow the same rule: *all pages* includes them.
- **Apply / Update / Remove.** **Apply watermark** adds it to the document; **Remove** takes it off. Both can be undone. Until you apply, the preview is only a draft: closing the panel or choosing another tool discards it. The status bar shows which pages carry a watermark.

**Output.** The watermark is written into each page's content when you **Download PDF**, **Save to Persora** or **Extract or split**. **Export images** always includes it too, even when annotations are left out. It is not a viewer overlay. Latin (WinAnsi) text is drawn as real PDF text in a standard font, so it stays sharp and selectable. Text in other scripts is drawn with the device's fonts and embedded as an image, so it looks right but can't be selected. Watermarks sit beneath your annotations and on top of the original page, and use a transparency state, so the page underneath stays visible. Page sizes, rotation and existing content aren't changed.

### PDF Security

**PDF Security** is its own tab, separate from the editor. Choose **Lock PDF** or **Unlock PDF**, then pick or drop a file.

- **Lock PDF.** Enter a password twice (show/hide toggle, at least 6 characters, a strength hint). PDF Studio encrypts the file with **AES-256** (PDF 2.0 / ISO 32000-2 security handler revision 6), then reopens the result with the password to confirm it worked before offering **Download** as `name (locked).pdf`.
  - The same password is used as the user (open) password and the owner password, and no printing or copying restrictions are set. Anyone with the password can open and edit the file.
  - Files that are already encrypted are refused; unlock them first.
  - AES-256 opens in current versions of Adobe Acrobat/Reader, browsers' built-in viewers (PDF.js, Chrome, Edge, Safari), macOS Preview and poppler-based readers. Very old readers (before Acrobat 9 / PDF 1.7 extension level 3) can't open it.
  - **Persora doesn't keep the password.** It can't be recovered if forgotten.
- **Unlock PDF.** Enter the password; PDF Studio decrypts the file, confirms the result opens without a password and offers `name (unlocked).pdf`.
  - Supported encryption: RC4 40- and 128-bit, AES-128 and AES-256 (revisions 2–6). Files that only have permission restrictions (no open password) are recognised: enter the owner password to remove the restrictions.
  - Clear messages for a wrong password, a file that isn't protected, a damaged or non-PDF file, and unsupported encryption (for example certificate/public-key security or custom handlers).
- **Progress and errors.** Each stage (checking, encrypting or decrypting, verifying) is shown. Failures say what went wrong and produce no file. A wrong password is cleared from the form so you can retype it, and both fields are cleared after a successful lock or unlock and when you start again.
- **What's kept.** Pages, text, images, links, bookmarks, form fields, annotations and document metadata are copied unchanged; only the encryption changes. If the input had minor structural damage that qpdf repaired, the result says so.

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
| Encryption | [qpdf](https://qpdf.sourceforge.io/) 12.4.2 compiled to WebAssembly (`@mssio/qpdf-wasm` 1.1.0, Apache-2.0; qpdf itself is Apache-2.0, and the package's `THIRD_PARTY_NOTICES.md` lists bundled zlib, libjpeg-turbo and Emscripten licences). It runs in a module Web Worker, so the page stays responsive. Passwords are passed to qpdf as a job-JSON file in the worker's in-memory filesystem, never as command-line arguments, and never leave the browser. The engine (≈2.2 MB WASM, ≈700 KB gzipped) loads only when you first lock or unlock. |
| Lazy loading | The library page is a lazy route chunk. pdf-lib, PDF.js and the editor load only when Create or Edit is opened. The PDF.js worker, CMaps, standard fonts and WASM decoders are served from `/pdfjs/<version>/`, which the build copies there. `public/_headers` marks them `immutable` so browsers cache them. |
| Limits | Open or insert files up to 100 MB each and 1,500 pages per editing session. Images up to 40 MB; text files up to 5 MB. Encrypted or password-protected PDFs can't be edited directly; the error points to **PDF Security → Unlock PDF**. Damaged files get a clear error. Lock and Unlock accept files up to 100 MB (the whole file is held in browser memory, two or three times over, while it's processed). DOCX and other office files aren't supported, so export them to PDF first. |

No external PDF API is used. PDF Studio doesn't call any third-party service and needs no installs or AI models. Lock and Unlock never upload the file or the password.

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
2. **Pages.** No new bindings or variables. The existing `VAULT_FILES` R2 binding and the Supabase variables are used. The build copies the PDF.js assets into `dist/pdfjs/<version>/` (about 3.4 MB, no file near the 25 MiB Pages limit). Vite emits the qpdf worker (`assets/worker-*.js`) and WASM (`assets/qpdf-*.wasm`, about 2.2 MB) as hashed static assets; Pages serves `.wasm` as `application/wasm`, which streaming compilation needs. No server code is involved.
   - **Content Security Policy.** Persora doesn't currently send a CSP. If one is added, it must allow `worker-src 'self'` for the PDF.js and qpdf workers and `script-src 'wasm-unsafe-eval'` for WebAssembly, or Lock/Unlock will fail with an error saying the worker couldn't start.
3. **Tests.**
   - `tests/pdf-studio-routes.test.mjs` covers auth, plan, quota, validation, the save/replace/delete flows and ownership.
   - `tests/pdf-studio-engine.test.mjs` builds real PDFs with the engine and checks them through PDF.js. It covers rotation and crop placement, page order and duplicates, metadata, non-Latin text, image layout, encrypted files and ZIP output.
   - `tests/pdf-studio-annotate.test.mjs` covers underline/strike-through snapping and export, watermark layout (positions, tiling, rotation, page ranges), and that text and image watermarks are embedded in the exported page content under the annotations, on rotated and cropped pages.
   - `tests/pdf-security.test.mjs` runs the real qpdf WASM engine: locks with AES-256 and confirms that PDF.js, poppler (`pdfinfo`/`pdftotext`) and the qpdf CLI all demand the password; checks that the correct password unlocks with content and metadata intact; that wrong and empty passwords fail with no output; RC4-40, RC4-128, AES-128 and owner-only inputs; damaged and non-PDF files; Unicode passwords; and a larger file. The poppler/qpdf CLI cross-checks are skipped if those tools aren't installed.
   - `tests/e2e/pdf-studio.e2e.mjs` (`npm run test:e2e:pdf`, needs the local Postgres/PostgREST stack like the vault e2e) drives the production build in Chromium: library tabs, Create PDF, Lock → independent check → Unlock (wrong then correct password), a damaged file, Annotate tools, underline/strike geometry, text and image watermarks embedded in the download, Remove + undo, Pages mode, the 390 px phone layout and console errors.

## Known limitations

- PDF Studio adds content on top of pages; it doesn't edit existing text or images.
- Highlights are free-form boxes; underline and strike-through snap to text only where the page has a text layer (not on scans).
- Watermark text outside the Latin (WinAnsi) range is embedded as an image and can't be selected. Watermarks are flattened into the page content, so other apps can't remove them as a separate layer.
- Lock uses one password for opening and full access, with no permission restrictions. Certificate-based (public-key) encryption and digital signatures aren't supported; signatures are images.
- Locking or unlocking rewrites the file, so an existing digital signature in the input becomes invalid.
- Lock and Unlock are limited to 100 MB per file by browser memory. Very large or complex files can take a while on low-end phones.
