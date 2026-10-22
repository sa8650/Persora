# Photo Studio

Photo Studio is the workspace page for **official photos**: passport, stamp-size, visa, ID-card, job-application and other formal photos. It isn't a general gallery. It uses the same folder shelf, modal shell, R2 bucket, database, sessions, storage quota and upload plan as the other pages.

## What members can do

| Workflow | Steps | When anything is stored |
| --- | --- | --- |
| **Upload & Organize** | Choose one JPEG, PNG or WebP. A preview opens straight away, and the browser reads width, height, aspect ratio, DPI (from JFIF, EXIF or PNG `pHYs`), format, file size and print size from the file itself. It then suggests a matching size preset. Enter a title, pick or create a folder, choose a category and add notes. Then press **Save**. | Only on **Save**. |
| **Create & Edit** | Upload a new portrait, or pick a saved photo. The editor offers crop, zoom and drag to reposition; size presets or a custom size in px, mm, cm or in at any DPI; 90° rotation, a ±45° straighten slider and horizontal/vertical flips; background removal followed by a white, off-white, light-blue, blue, red, custom or transparent background; and brightness, exposure, contrast and sharpness. A live preview shows the final pixel size. **Save & Organize** opens the same organize modal with the final preview and detected metadata. | Only on the organize modal's **Save**. |
| **Manage** | Search, filter by category, browse by folder and sort. Each card can be viewed, edited as a copy, downloaded, have its details edited, be moved to another folder or be deleted (it goes to Trash, restorable for 7 days). | Detail edits, moves and deletes are saved straight away. |

Before **Save**, the image exists only as an in-memory `Blob` or canvas in the browser. **Cancel** or closing a modal revokes object URLs and releases canvases. No R2 object or database row is created.

Editing a saved photo always creates a **new** row with `source_photo_id` pointing at the original. The original file and row are never modified. The viewer links originals and their edited versions.

## Background removal

1. **Primary: Persora AI.** This is `POST /api/photo-studio/background-removal`. The browser sends a ≤2048 px JPEG of the working image. The Worker passes it to the Cloudflare Images binding with `segment: "foreground"`, the BiRefNet model on Workers AI, and returns a PNG mask. The request is stateless: the image is never written to R2 or the database.
2. **Automatic fallback: on-device MODNet.** The fallback runs if the primary is disabled, not configured or not in the member's plan, or if it fails, times out (35 s in the client, 30 s on the server) or returns an unusable mask. In that case the editor shows *"Switching to the on-device model"* and runs [MODNet](https://huggingface.co/Xenova/modnet) (Apache-2.0, fp32 ONNX, about 26 MB) through ONNX Runtime Web. It uses **WebGPU** when available and otherwise **WebAssembly**. The only network traffic is downloading the model weights and runtime files; the photo never leaves the browser. The weights are stored in the Cache API (`persora-photo-studio-models-v1`), so later runs start straight away.
3. **Each path runs once.** There are no hidden retries. If both paths fail, the editor shows both reasons and a **Retry** button, and keeps the editing session. A result is never reported as successful unless its alpha mask passes a sanity check (enough subject, enough removed background).

Admins can turn the primary AI off with **Admin → AI controls → Photo Studio background removal**. The on-device fallback stays available.

## Deployment

1. **Database.** Apply `supabase/migrations/202610220006_photo_studio.sql` after the earlier migrations (it needs `trash_items` from `202610220002_global_trash.sql`). It does the following:
   - Adds the `photo-studio` folder scope.
   - Creates `photo_studio_photos` (service-role-only RLS, plus a trigger that keeps the folder owner and scope consistent).
   - Adds the `photo_studio_photo` Trash kind.
   - Adds the RPCs `persora_photo_studio_save`, `persora_photo_studio_trash_move` and `persora_photo_studio_trash_restore`.
   - `persora_photo_studio_save` creates an optional new folder and the photo row in **one transaction**.
2. **Storage.** Photo Studio uses the existing `VAULT_FILES` R2 binding. Objects live under `<userId>/photo-studio/<uuid>.<ext>` with `ownerId` and `photoStudio` custom metadata. If the database save fails, the Worker deletes the object it just wrote (unless a committed row already references it), so failures never leave orphans.
3. **Primary AI (optional).** Add a Cloudflare **Images** binding named `IMAGES`. In Wrangler config: `"images": { "binding": "IMAGES" }`. Background segmentation is billed as an Images transformation and needs an Images Paid subscription. Without the binding, members automatically get the on-device model.
4. **Self-hosting the local model (optional).** By default the weights come from Hugging Face and the ORT WebAssembly runtime from jsDelivr. To serve them from your own origin or R2 public bucket, set these build variables:
   - `VITE_PHOTO_STUDIO_MODEL_URL`: full URL of `model.onnx`.
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
| `POST /api/photo-studio/background-removal` | Stateless AI cut-out. Errors include `fallback: true`. |

## Code map

- `src/components/PhotoStudioView.tsx`: the page, grid, chooser and viewer.
- `src/components/PhotoOrganizeModal.tsx`: the organize modal shared by both workflows.
- `src/components/PhotoEditorModal.tsx`: the editor.
- `src/lib/photo-studio.ts`: analysis, presets, filters and editor maths.
- `src/lib/photo-studio-render.ts`: the canvas pipeline.
- `src/lib/photo-background.ts`: cloud-to-local orchestration.
- `src/lib/local-matting.ts`: the MODNet runner.
- `cloudflare/photo-metadata.js`: dependency-free header parsing and DPI embedding, shared by browser and Worker.
- `cloudflare/photo-studio.js`: the routes.
- Tests: `tests/photo-*.test.mjs`.
