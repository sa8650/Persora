# Photo Studio

Photo Studio is the workspace page for **official photos**: passport, stamp-size, visa, ID-card, job-application and other formal photos. It isn't a general gallery. It uses the same folder shelf, modal shell, R2 bucket, database, sessions, storage quota and upload plan as the other pages.

## What members can do

| Workflow | Steps | When anything is stored |
| --- | --- | --- |
| **Upload & Organize** | Choose one JPEG, PNG or WebP. A preview opens straight away, and the browser reads width, height, aspect ratio, DPI (from JFIF, EXIF or PNG `pHYs`), format, file size and print size from the file itself. It then suggests a matching size preset. Enter a title, pick or create a folder, choose a category and add notes. Then press **Save**. | Only on **Save**. |
| **Create & Edit** | Upload a new portrait, or pick a saved photo. The editor offers crop, zoom and drag to reposition; size presets or a custom size in px, mm, cm or in at any DPI; 90° rotation, a ±45° straighten slider and horizontal/vertical flips; background removal followed by a white, off-white, light-blue, blue, red, custom or transparent background; and brightness, exposure, contrast and sharpness. A live preview shows the final pixel size. **Save & Organize** opens the same organize modal with the final preview and detected metadata. | Only on the organize modal's **Save**. |
| **Manage** | Search, filter by category, browse by folder and sort. Cards show a clean, contained preview with the title, category, print size and file size; the full technical details (format, dimensions, aspect ratio, resolution) are in the photo viewer. Each card can be viewed, edited as a copy, downloaded, **shared with a Persora member**, have its details edited, be moved to another folder or be deleted (it goes to Trash, restorable for 7 days). | Detail edits, moves, shares and deletes are saved straight away. |

Before **Save**, the image exists only as an in-memory `Blob` or canvas in the browser. **Cancel** or closing a modal revokes object URLs and releases canvases. No R2 object or database row is created.

Editing a saved photo always creates a **new** row with `source_photo_id` pointing at the original. The original file and row are never modified. The viewer links originals and their edited versions.

## Background removal

The editor has a **Remove Background** button at the top of its tools panel.

1. **Primary: Persora AI.** This is `POST /api/photo-studio/background-removal`. The browser sends a ≤2048 px JPEG of the working image. The Pages Function calls Workers AI **`bria/remove-background`** (Bria RMBG 2.0) through the existing `AI` binding and an **AI Gateway** (`env.AI.run(model, { image }, { gateway: { id } })`). Bria answers with a temporary URL to a transparent PNG; the Function downloads it at once and returns it, so the browser only talks to Persora. The request is stateless: the image is never written to R2 or the database.
   - *Why the old setup failed:* the first version used a Cloudflare **Images** binding (`segment: "foreground"`), but Cloudflare **Pages Functions don't support Images bindings**, so the server always answered "The AI background service isn't configured". An `IMAGES` binding is still used as a secondary provider if the API ever runs as a standalone Worker.
2. **Automatic fallback: on-device ORMBG.** The fallback runs if the primary is disabled, not set up or not in the member's plan, or if it fails, times out (60 s in the client, 25 s per provider step on the server) or returns an unusable cut-out. The editor shows *"Switching to the on-device model"* and runs [ORMBG](https://huggingface.co/onnx-community/ormbg-ONNX) (Apache-2.0, ISNet-based, trained for people) through ONNX Runtime Web at 1024 × 1024:
   - **WebGPU** (needs `shader-f16`): `model_fp16.onnx`, about 88 MB.
   - **WebAssembly** otherwise, or if WebGPU fails at runtime: `model_quantized.onnx`, about 44 MB.
   The only network traffic is downloading the weights and runtime; the photo never leaves the browser. Weights are cached in the Cache API (`persora-photo-studio-models-v2`; the old MODNet cache is deleted), so later runs start straight away. ORMBG replaced MODNet, which left visible halos around hair.
3. **Refinement.** Both engines go through the same clean-up: the mask is applied to the *original* pixels, near-solid alpha is snapped, and the background colour that bleeds into hair and edge pixels is estimated and removed (edge decontamination).
4. **Honest results.** Every result passes a quality check (enough subject, enough removed background, not a washed-out matte). A failed or unusable result is never shown as a success; the editor lists each engine's reason and notes the original photo is untouched.
5. **Retry, compare and undo.** After a result the member can **Compare** (hold the original view), **Undo** (back to the previous result or the original photo), or **Remove again** with *Persora AI* or *On this device*. On failure: **Retry**, **Try on this device** or **Try Persora AI**. Each attempt runs once — there are no hidden retries. The original photo is never modified.

Admins can turn the primary AI off with **Admin → AI controls → Photo Studio background removal**. The on-device fallback stays available.

## Sharing

The card menu's **Share** opens Persora's existing *Share with Persora member* dialog (`ShareRecordDialog`) and uses the same `record_shares` flow as contacts and business cards (`resource_type = 'photo_studio_photo'`). Recipients see shared photos under **Shared → Photos** and can view or download them. The file is streamed by `GET /api/record-shares/:shareId/file`, which only answers the share's recipient or owner, and only while the owner still has the photo. Storage keys are never exposed.

## Deployment

1. **Database.** Apply `supabase/migrations/202610220006_photo_studio.sql` after the earlier migrations (it needs `trash_items` from `202610220002_global_trash.sql`). It does the following:
   - Adds the `photo-studio` folder scope.
   - Creates `photo_studio_photos` (service-role-only RLS, plus a trigger that keeps the folder owner and scope consistent).
   - Adds the `photo_studio_photo` Trash kind.
   - Adds the RPCs `persora_photo_studio_save`, `persora_photo_studio_trash_move` and `persora_photo_studio_trash_restore`.
   - `persora_photo_studio_save` creates an optional new folder and the photo row in **one transaction**.
2. **Storage.** Photo Studio uses the existing `VAULT_FILES` R2 binding. Objects live under `<userId>/photo-studio/<uuid>.<ext>` with `ownerId` and `photoStudio` custom metadata. If the database save fails, the Worker deletes the object it just wrote (unless a committed row already references it), so failures never leave orphans.
3. **Sharing.** Apply `supabase/migrations/202610220007_photo_studio_sharing.sql`. It allows `photo_studio_photo` in `record_shares.resource_type` When a photo is moved to Trash its shares are removed and kept in the Trash entry; restoring the photo restores its shares.
4. **Primary AI.** Persora already has the Workers AI binding `AI`. Bria is a partner model, so it runs through **AI Gateway** with **Unified Billing**:
   - In the Cloudflare dashboard, open **AI → AI Gateway** and create (or keep) a gateway named `default`, or set the Pages variable `PHOTO_STUDIO_AI_GATEWAY` to your gateway id.
   - Add Unified Billing credits to the account. Bria costs about **$0.018 per image**; see Bria's terms at bria.ai.
   - Without credits, the server answers with a clear "needs AI Gateway credits" reason and members automatically get the on-device model.
5. **Self-hosting the local model (optional).** By default the weights come from Hugging Face and the ORT WebAssembly runtime from jsDelivr. To serve them from your own origin or R2 public bucket, set these build variables:
   - `VITE_PHOTO_STUDIO_MODEL_BASE`: a folder URL that contains `model_fp16.onnx` and `model_quantized.onnx` from `onnx-community/ormbg-ONNX/onnx/` (replaces the old `VITE_PHOTO_STUDIO_MODEL_URL`).
   - `VITE_PHOTO_STUDIO_ORT_WASM_BASE`: a folder URL ending in `/` that contains the `ort-wasm-simd-threaded.jsep.{mjs,wasm}` files from `onnxruntime-web@1.30.0/dist/`.

   The Vite build aliases `onnxruntime-web/webgpu` to ORT's prebuilt ESM file, so the roughly 26 MB `.wasm` is **not** copied into `dist/` (Cloudflare Pages limits each asset to 25 MiB). The runtime is fetched lazily, only when the fallback runs.

## Limits and validation

- **Saving:** JPEG, PNG or WebP only. The server re-reads the header and rejects files whose type doesn't match their contents. Files must be no larger than the admin upload limit (capped at 30 MB) and no more than 20,000 px per side. Saving needs an active paid upload plan and enough storage quota (Photo Studio bytes count toward usage).
- **Editor input:** JPEG, PNG, WebP, GIF or BMP up to 40 MB. The working copy is limited to 3000 px on the long edge. Output is 16 to 6000 px per side. JPEG and PNG output carry the chosen DPI.
- **Ownership:** every route requires a session. Rows are always filtered by `user_id`. Downloads check both the row owner and the R2 key prefix and metadata. Folder moves accept only the member's own `photo-studio` folders.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/photo-studio/photos` | List the member's photos. |
| `POST /api/photo-studio/photos` | Final save (multipart: `file`, `meta`). Returns `{ photo, folder, createdFolder }`. |
| `PATCH /api/photo-studio/photos/:id` | Update title, category, notes or folder. |
| `DELETE /api/photo-studio/photos/:id` | Move to Trash (7-day restore). |
| `GET /api/photo-studio/photos/:id/file[?download=1]` | Private, `no-store` file stream. |
| `POST /api/photo-studio/background-removal` | Stateless AI cut-out (header `X-Persora-Background-Source: workers-ai-bria`). Errors include `fallback: true`. |
| `GET /api/record-shares/:shareId/file[?download=1]` | A shared photo, for the share's recipient or owner only. |

## Code map

- `src/components/PhotoStudioView.tsx`: the page, grid, chooser and viewer.
- `src/components/PhotoOrganizeModal.tsx`: the organize modal shared by both workflows.
- `src/components/PhotoEditorModal.tsx`: the editor.
- `src/lib/photo-studio.ts`: analysis, presets, filters and editor maths.
- `src/lib/photo-studio-render.ts`: the canvas pipeline.
- `src/lib/photo-background.ts`: cloud-to-local orchestration.
- `src/lib/local-matting.ts`: the ORMBG runner (WebGPU → WebAssembly).
- `src/lib/photo-matte.ts`: matte clean-up and edge colour decontamination.
- `cloudflare/photo-metadata.js`: dependency-free header parsing and DPI embedding, shared by browser and Worker.
- `cloudflare/photo-studio.js`: the routes.
- Tests: `tests/photo-*.test.mjs`.
