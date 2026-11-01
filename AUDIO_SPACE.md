# Persora AudioSpace

**AudioSpace** (`src/components/audio-space/`) is Persora's dedicated space to store, record, organize, play, and manage important audio files in one private personal library. It is an **audio archive and management tool** — not a music streaming platform or song discovery service.

## Capabilities

1. **Dashboard & navigation** (`src/components/audio-space/AudioSpaceView.tsx`)
   - A dedicated space with its own app-drawer icon (`src/components/launcher/LauncherIcons.tsx`) following the Persora Design System.
   - Sections: **Overview** (total audio, folders, storage used, recently added), **All Audio**, **Recent** (recently uploaded, recorded or accessed), **Favorites**, **My Recordings**, **Audio Links**, **Folders** (shared `VaultFolderShelf`), and **Trash** (audio-only restore list feeding the global Trash policy).
   - Search, sorting (newest/oldest/title/longest/shortest), tag filtering, grid/list view controls, and multi-selection with bulk move / pin / delete.
2. **Add audio** (`src/components/audio-space/AudioDialogs.tsx`)
   - **Upload audio** (multi-file, per-file title/description, live `TransferProgressIndicator`, retry on failure), **Record audio**, **Add audio link**, and **Create folder** from one prominent *Add audio* menu.
   - Saves `MP3`, `WAV`, `M4A`, `AAC`, `OGG`, `FLAC` (plus `WebM` recordings) where browser playback support allows. File type and size are validated **server-side** against magic-number sniffing (`cloudflare/audio-format.js`).
   - External links: the pasted URL is probed server-side (`probeAudioLink`) and must point at a reachable audio resource — a normal webpage URL is rejected with a clear error, and private-network targets are refused (SSRF protection). The original URL and probe metadata are stored; no bytes are copied.
3. **Recording** (`src/components/audio-space/AudioRecorder.tsx`)
   - Start / pause / resume / stop with a live waveform (Web Audio `AnalyserNode`), duration counter, preview before saving, rename + description, save directly into AudioSpace, or discard without saving. Microphone permission errors and unsupported browsers get clear, actionable messages.
4. **Library management**
   - Every item carries title, optional description, format, size, duration, date added/recorded, folder, tags, favorite status, and source indicator (uploaded / recorded / external link).
   - Rename, edit details and tags, move between folders, pin/unpin favorites (preserved across folder moves), duplicate external link references, download uploaded/recorded audio, copy external links, and delete/restore through the Trash policy.
5. **Audio player** (`src/components/audio-space/AudioPlayerBar.tsx`)
   - Play/pause, seekable progress bar with real waveform peaks (computed from the decoded file where available), time display, volume, playback speed (0.5×–2×), skip ±10s, previous/next through the current list queue, and a **persistent compact mini-player** that stays docked while browsing other AudioSpace sections.
6. **Storage & data management**
   - Uploaded/recorded audio is private R2 (`VAULT_FILES`) under `<owner>/audio-space/`; metadata lives in Supabase (`audio_space_items`) with RLS enabled and service-role-only access.
   - Playback streams through authenticated, Range-capable API routes (`GET /api/audio-space/audios/:id/file`) — permanent public R2 URLs are never exposed. Server-side quota checks (`userStorageUsage`) and admin upload caps apply; failed saves never leave orphan objects.
7. **Future-ready (not in the initial release)**
   - The `metadata` JSONB and description fields leave room for audio-to-text transcription, in-audio search, AI summaries, language detection, bookmarks/playback-position memory, and optional sharing — without any schema redesign.

## Database, API, and tests

- **Schema:** `public.audio_space_items`, `public.vault_folders` (`audio-space` scope), and `public.trash_items` (`audio_space_item` kind) in [`supabase/schema.sql`](./supabase/schema.sql) plus the incremental migration [`supabase/migrations/20261030000000_audio_space.sql`](./supabase/migrations/20261030000000_audio_space.sql) (transactional save/trash/restore/export RPCs, folder guard trigger).
- **Routes** (`cloudflare/audio-space.js`, wired in `cloudflare/api.js`): `GET/POST /api/audio-space/audios`, `POST /api/audio-space/links`, `POST /api/audio-space/links/validate`, `PATCH/DELETE /api/audio-space/audios/:id`, `POST /api/audio-space/audios/:id/play`, `GET /api/audio-space/audios/:id/file` (HTTP Range seeking, `?download=1`), plus `/api/folders?scope=audio-space`, global Trash restore/purge integration, and account-backup export (`audioItems` in `persora-export.json` + files in the TAR).
- **Tests:** `tests/audio-space-routes.test.mjs` (upload validation, orphan cleanup, Range streaming, trash, link probing) and `tests/audio-space-helpers.test.mjs` (format sniffing, tags, durations, filtering, link-safety helpers).
