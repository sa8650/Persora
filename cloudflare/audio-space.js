// Persora AudioSpace — worker routes for the private audio library.
//
// Purpose: store, record, organize, play and manage important audio files in
// one private personal library. This is an audio archive and management tool —
// not a music streaming or song discovery service.
//
// Persistence guarantees (see supabase/schema.sql):
//   * Uploaded and recorded audio is written to the private VAULT_FILES R2
//     bucket under "<owner>/audio-space/"; POST /audio-space/audios is the ONLY
//     route that writes bytes, and it uploads one R2 object and then creates
//     the row (plus an optional new folder) in one database transaction.
//   * If the transaction fails, the just-uploaded object is removed again, so a
//     failed save leaves no orphan file and no partial row.
//   * External audio links store only the URL and probe metadata — never bytes.
//     Links are validated server-side before saving and must point at an
//     accessible audio resource (a webpage URL is rejected with a clear error).
//   * Deleting moves the row into the global Trash (7-day restore window).
//   * Playback streams from R2 through this worker with HTTP Range support so
//     seeking works; permanent public R2 URLs are never exposed.
import { AUDIO_FORMATS, AUDIO_SAVE_TYPES, detectAudioFormat, sniffAudioFormat, isSafeExternalAudioUrl, normalizeExternalUrl } from "./audio-format.js";

export const AUDIO_SPACE_ROUTE_PREFIX = "/audio-space";
const AUDIO_COLUMNS = "id,user_id,folder_id,title,description,source,file_key,file_name,file_size,file_type,duration_seconds,external_url,tags,favorite,metadata,last_played_at,created_at,updated_at";
const AUDIO_MAX_BYTES_CAP = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 604800; // 7 days
const LINK_PROBE_TIMEOUT_MS = 8000;
const LINK_PROBE_MAX_BYTES_CHECKED = 1024;
const MAX_LINK_REDIRECTS = 3;

export class AudioSpaceError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function headersFor(origin, extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    ...extra,
  };
}
function json(value, status, origin) {
  return new Response(JSON.stringify(value), { status, headers: headersFor(origin) });
}
function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}
function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}
async function dbFetch(path, env, init = {}) {
  return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) });
}
async function listRows(path, env) {
  const response = await dbFetch(path, env);
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new AudioSpaceError("The AudioSpace service received an invalid record list.", 502);
  return rows;
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new AudioSpaceError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") {
    return new AudioSpaceError("AudioSpace needs the Persora database schema (supabase/schema.sql). Ask an administrator to apply it.", 503);
  }
  console.error("Persora AudioSpace database request failed", response.status, code, message);
  return new AudioSpaceError("The AudioSpace database could not complete the request. Please try again shortly.", 502);
}
async function rpc(name, args, env) {
  const response = await dbFetch(`rpc/${name}`, env, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Input sanitising (pure — covered by tests)
// ---------------------------------------------------------------------------

/** Normalizes a tag list: trimmed, de-duplicated, 1–40 chars each, ≤24 tags. */
export function normalizeTags(raw) {
  const source = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const output = [];
  const seen = new Set();
  for (const entry of source.slice(0, 48)) {
    const tag = cleanText(entry, 200).replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) throw new AudioSpaceError("Each tag must be between 1 and 40 characters.", 400);
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
  }
  if (output.length > 24) throw new AudioSpaceError("Keep tags to 24 or fewer per audio.", 400);
  return output;
}

/**
 * Validates the details for a new audio item (or, with `partial`, a metadata
 * update). Throws AudioSpaceError with a member-facing message.
 */
export function sanitizeAudioInput(raw, { partial = false, allowSource = "file" } = {}) {
  const body = plainObject(raw);
  if (!body) throw new AudioSpaceError("The audio details could not be read.", 400);
  const output = {};
  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title, 121);
    if (!title || title.length > 120) throw new AudioSpaceError("Give the audio a title between 1 and 120 characters.", 400);
    output.title = title;
  }
  if (!partial || body.description !== undefined) {
    const description = cleanText(body.description, 1001);
    if (description.length > 1000) throw new AudioSpaceError("The description can be up to 1,000 characters.", 400);
    output.description = description;
  }
  if (!partial || body.folderId !== undefined) {
    const folderId = body.folderId === null || body.folderId === undefined || body.folderId === "" ? null : String(body.folderId);
    if (folderId && !isUuid(folderId)) throw new AudioSpaceError("Choose a valid AudioSpace folder.", 400);
    output.folderId = folderId;
  }
  if (!partial || body.tags !== undefined) {
    output.tags = normalizeTags(body.tags);
  }
  if (!partial || body.favorite !== undefined) {
    output.favorite = body.favorite === true;
  }
  if (!partial) {
    const newFolder = plainObject(body.newFolder);
    if (newFolder) {
      const name = cleanText(newFolder.name, 65);
      if (!name || name.length > 64) throw new AudioSpaceError("Enter a folder name between 1 and 64 characters.", 400);
      output.newFolder = { name, color: ["blue", "sky", "teal", "violet", "amber", "rose", "slate", "mint"].includes(newFolder.color) ? newFolder.color : "blue" };
      output.folderId = null;
    } else output.newFolder = null;
    const source = String(body.source || "upload");
    if (allowSource === "file" && source !== "upload" && source !== "recording") {
      throw new AudioSpaceError("Choose a valid audio source.", 400);
    }
    if (allowSource === "link" && source !== "link") {
      throw new AudioSpaceError("Choose a valid audio source.", 400);
    }
    output.source = source;
    const duration = body.duration === null || body.duration === undefined || body.duration === "" ? null : Number(body.duration);
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS)) {
      throw new AudioSpaceError("The recording duration could not be read.", 400);
    }
    output.duration = duration === null ? null : Math.round(duration * 1000) / 1000;
    output.fileName = cleanText(body.fileName, 200);
  }
  return output;
}

/** Normalises a saved file name so its extension matches the verified format. */
export function audioFileName(name, format) {
  const extension = AUDIO_FORMATS[format]?.extension || "mp3";
  const base = String(name || "audio").normalize("NFKC").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[^\w.() -]+/g, "_").replace(/^[.\s]+/, "").trim().slice(0, 150) || "audio";
  return `${base}.${extension}`;
}

/**
 * Verifies uploaded bytes are a supported audio file and returns the detected
 * format key. The declared MIME type must agree with the file contents
 * (application/octet-stream is accepted — some devices declare nothing useful).
 */
export function verifyAudioBytes(bytes, declaredType = "") {
  const format = sniffAudioFormat(bytes);
  if (!format) throw new AudioSpaceError("AudioSpace saves MP3, WAV, M4A, AAC, OGG, FLAC and WebM audio.", 415);
  const declared = detectAudioFormat(String(declaredType || "").toLowerCase().trim());
  if (declared && declared !== format) {
    throw new AudioSpaceError("The audio's file type does not match its contents.", 400);
  }
  return format;
}

/** Best-effort duration from container headers (WAV and FLAC exactly, MP3 by
 * first-frame bitrate); returns null when unknown. The browser-measured
 * duration passed by the client is used as a fallback at save time. */
export function readDurationSeconds(bytes, format) {
  try {
    if (format === "wav" && bytes.byteLength >= 44) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // Find the "fmt " chunk for the byte rate and "data" for the payload size.
      let byteRate = 0;
      let dataSize = 0;
      let offset = 12;
      while (offset + 8 <= bytes.byteLength) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        const size = view.getUint32(offset + 4, true);
        if (id === "fmt " && offset + 16 <= bytes.byteLength) byteRate = view.getUint32(offset + 16, true);
        if (id === "data") { dataSize = size || Math.max(0, bytes.byteLength - offset - 8); break; }
        offset += 8 + size + (size % 2);
      }
      if (byteRate > 0 && dataSize > 0) return Math.round((dataSize / byteRate) * 1000) / 1000;
      return null;
    }
    if (format === "flac" && bytes.byteLength >= 42) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // STREAMINFO block: sample rate 20 bits at byte 18, total samples 36 bits at byte 27.
      const sampleRate = (view.getUint32(18, false) >> 8) & 0xfffff;
      const high = view.getUint32(27, false) & 0xf;
      const low = view.getUint32(31, false);
      const totalSamples = high * 2 ** 32 + low;
      if (sampleRate > 0 && totalSamples > 0) return Math.round((totalSamples / sampleRate) * 1000) / 1000;
      return null;
    }
    if (format === "mp3" && bytes.byteLength >= 4) {
      // Estimate from the first MPEG frame's bitrate: duration ≈ size / (bitrate/8).
      let offset = 0;
      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.byteLength > 10) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
        offset = 10 + tagSize;
      }
      if (offset + 4 <= bytes.byteLength && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0 && (bytes[offset + 1] & 0x06) !== 0x00) {
        const versionBits = (bytes[offset + 1] >> 3) & 0x03;
        const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
        const v1 = versionBits === 3;
        const bitrates = v1
          ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
          : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
        const kbps = bitrates[bitrateIndex];
        if (kbps > 0) {
          const payload = Math.max(0, bytes.byteLength - offset);
          return Math.round((payload / (kbps * 125)) * 1000) / 1000;
        }
      }
      return null;
    }
  } catch { /* best-effort only */ }
  return null;
}

// ---------------------------------------------------------------------------
// External audio links
// ---------------------------------------------------------------------------

/**
 * Probes an external audio URL from the server and returns its metadata.
 * Only direct, reachable audio resources are accepted — a normal webpage URL
 * is rejected with a clear message. Redirects are followed manually so every
 * hop is re-validated against private-network targets (SSRF protection).
 */
export async function probeAudioLink(rawUrl) {
  let url;
  try {
    url = normalizeExternalUrl(rawUrl);
  } catch (error) {
    throw new AudioSpaceError(error instanceof Error ? error.message : "That audio link is not valid.", 400, { reason: "invalid" });
  }
  let finalUrl = url;
  let response = null;
  let method = "HEAD";
  let headRetried = false;
  let hops = 0;
  for (;;) {
    if (!isSafeExternalAudioUrl(finalUrl)) {
      throw new AudioSpaceError("That audio link points at a private network address, which Persora will not fetch.", 400, { reason: "invalid" });
    }
    const headers = { "User-Agent": "Persora-AudioSpace/1.0", Accept: "audio/*,*/*;q=0.8" };
    if (method === "GET") headers.Range = `bytes=0-${LINK_PROBE_MAX_BYTES_CHECKED - 1}`;
    try {
      response = await fetch(finalUrl, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(LINK_PROBE_TIMEOUT_MS),
        headers,
      });
    } catch {
      throw new AudioSpaceError("The audio source couldn't be reached from Persora. Check the link and try again.", 400, { reason: "unreachable" });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location) break;
      if (++hops > MAX_LINK_REDIRECTS) {
        throw new AudioSpaceError("That audio link takes too many redirects to follow.", 400, { reason: "invalid" });
      }
      try { finalUrl = new URL(location, finalUrl).toString(); } catch { break; }
      continue;
    }
    if ((response.status === 405 || response.status === 501 || response.status === 416) && method === "HEAD" && !headRetried) {
      // HEAD refused — fall back to one ranged GET probe.
      headRetried = true;
      method = "GET";
      continue;
    }
    break;
  }
  if (!response) throw new AudioSpaceError("The audio source couldn't be reached from Persora. Check the link and try again.", 400, { reason: "unreachable" });
  if (response.status === 401 || response.status === 403) {
    throw new AudioSpaceError("The audio source refused access to this file, so it can't be saved as a playable link.", 400, { reason: "denied" });
  }
  if (response.status === 404 || response.status === 410) {
    throw new AudioSpaceError("This audio link is no longer available at its source.", 400, { reason: "missing" });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AudioSpaceError("This audio link could not be accessed right now. Check the source and try again.", 400, { reason: "unreachable" });
  }
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const formatFromType = detectAudioFormat(contentType);
  const formatFromUrl = detectAudioFormat(finalUrl);
  const mimeLooksAudio = /^audio\//.test(contentType) || contentType === "application/ogg" || contentType === "video/webm";
  const opaqueWithExtension = (!contentType || contentType === "application/octet-stream" || contentType === "binary/octet-stream") && Boolean(formatFromUrl);
  if (!formatFromType && !mimeLooksAudio && !opaqueWithExtension) {
    throw new AudioSpaceError("This link doesn't point to a playable audio file. Paste a direct audio URL (for example an .mp3, .wav, .m4a or .ogg file), not a webpage address.", 400, { reason: "not-audio" });
  }
  const format = formatFromType || formatFromUrl || null;
  const lengthHeader = Number(response.headers.get("content-length") || 0);
  let host = "";
  try { host = new URL(finalUrl).host; } catch { /* keep empty */ }
  try { await response.body?.cancel?.(); } catch { /* probe only */ }
  return {
    url,
    finalUrl,
    host,
    contentType: contentType || (AUDIO_FORMATS[format]?.mime ?? ""),
    contentLength: Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null,
    format,
    validatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function audioView(row) {
  return {
    id: row.id,
    folder_id: row.folder_id || null,
    title: row.title,
    description: row.description || "",
    source: row.source,
    file_name: row.file_name || null,
    file_size: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    file_type: row.file_type || null,
    duration_seconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
    external_url: row.external_url || null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === "string") : [],
    favorite: Boolean(row.favorite),
    metadata: plainObject(row.metadata) || {},
    last_played_at: row.last_played_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function uploadLimit(services) {
  const maxMb = Math.max(1, Math.min(AUDIO_MAX_BYTES_CAP / 1024 / 1024, Number(services?.maxUploadMb) || 25));
  return { maxMb, maxBytes: Math.min(AUDIO_MAX_BYTES_CAP, maxMb * 1024 * 1024) };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function createAudio(request, identity, env, services) {
  if (!env.VAULT_FILES) throw new AudioSpaceError("Private audio storage is not configured.", 503);
  const { maxMb, maxBytes } = uploadLimit(services);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes + 1024 * 1024) throw new AudioSpaceError(`Audio files must be ${maxMb} MB or smaller.`, 413);
  let form;
  try { form = await request.formData(); } catch { throw new AudioSpaceError("The audio upload could not be read. Please try saving again.", 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new AudioSpaceError("Choose an audio file to save.", 400);
  if (file.size > maxBytes) throw new AudioSpaceError(`Audio files must be ${maxMb} MB or smaller.`, 413);
  let rawMeta;
  try { rawMeta = JSON.parse(String(form.get("meta") || "{}")); } catch { throw new AudioSpaceError("The audio details could not be read.", 400); }
  const input = sanitizeAudioInput(rawMeta, { allowSource: "file" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = verifyAudioBytes(bytes, file.type);

  if (typeof services?.storageUsage !== "function") throw new AudioSpaceError("Private audio storage is unavailable.", 503);
  const usage = await services.storageUsage(identity.id, env.VAULT_FILES, env);
  if (usage.bytesUsed + bytes.byteLength > usage.storageLimitBytes) {
    throw new AudioSpaceError(`This audio exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit.`, 413);
  }

  const probed = readDurationSeconds(bytes, format);
  const duration = probed !== null ? probed : input.duration;
  const fileName = audioFileName(input.fileName || file.name, format);
  const mime = AUDIO_FORMATS[format].mime;
  const key = `${identity.id}/audio-space/${crypto.randomUUID()}.${AUDIO_FORMATS[format].extension}`;
  await env.VAULT_FILES.put(key, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { ownerId: identity.id, audioSpace: "true", originalName: fileName, createdAt: new Date().toISOString() },
  });
  try {
    const result = await rpc("persora_audio_space_save", {
      p_owner: identity.id,
      p_folder_id: input.folderId,
      p_new_folder_name: input.newFolder?.name || null,
      p_new_folder_color: input.newFolder?.color || null,
      p_title: input.title,
      p_description: input.description,
      p_source: input.source,
      p_file_key: key,
      p_file_name: fileName,
      p_file_size: bytes.byteLength,
      p_file_type: mime,
      p_duration: duration,
      p_external_url: null,
      p_tags: input.tags,
      p_favorite: input.favorite,
      p_metadata: { format, channel: "unknown", source: input.source, probedDuration: probed !== null },
    }, env);
    const saved = Array.isArray(result) ? result[0] : result;
    if (!isUuid(saved?.item?.id)) throw new AudioSpaceError("The audio save could not be confirmed. Refresh AudioSpace before retrying.", 502);
    return { item: audioView(saved.item), folder: saved.folder || null, createdFolder: Boolean(saved.createdFolder) };
  } catch (error) {
    // Never leave an orphan object behind — but never delete one a committed
    // row references either (a transport error can follow a commit).
    try {
      const refs = await listRows(`audio_space_items?file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
      if (!refs.length) await env.VAULT_FILES.delete(key);
    } catch (cleanupError) {
      try { await env.VAULT_FILES.delete(key); } catch { /* logged below */ }
      console.error("AudioSpace upload cleanup", cleanupError instanceof Error ? cleanupError.message : "unknown error");
    }
    throw error;
  }
}

async function createAudioLink(request, identity, env) {
  let body;
  try { body = await request.json(); } catch { throw new AudioSpaceError("The audio link details could not be read.", 400); }
  const input = sanitizeAudioInput(body, { allowSource: "link" });
  const rawUrl = String(plainObject(body)?.url || "");
  const probe = await probeAudioLink(rawUrl);
  const result = await rpc("persora_audio_space_save", {
    p_owner: identity.id,
    p_folder_id: input.folderId,
    p_new_folder_name: input.newFolder?.name || null,
    p_new_folder_color: input.newFolder?.color || null,
    p_title: input.title,
    p_description: input.description,
    p_source: "link",
    p_file_key: null,
    p_file_name: null,
    p_file_size: probe.contentLength,
    p_file_type: probe.contentType || null,
    p_duration: null,
    p_external_url: probe.url,
    p_tags: input.tags,
    p_favorite: input.favorite,
    p_metadata: {
      host: probe.host,
      finalUrl: probe.finalUrl,
      contentType: probe.contentType,
      contentLength: probe.contentLength,
      format: probe.format,
      linkStatus: "ok",
      validatedAt: probe.validatedAt,
    },
  }, env);
  const saved = Array.isArray(result) ? result[0] : result;
  if (!isUuid(saved?.item?.id)) throw new AudioSpaceError("The audio link save could not be confirmed. Refresh AudioSpace before retrying.", 502);
  return { item: audioView(saved.item), folder: saved.folder || null, createdFolder: Boolean(saved.createdFolder) };
}

async function updateAudio(request, identity, audioId, env) {
  let body;
  try { body = await request.json(); } catch { throw new AudioSpaceError("The audio details could not be read.", 400); }
  const input = sanitizeAudioInput(body, { partial: true });
  const patch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.favorite !== undefined) patch.favorite = input.favorite;
  if (input.folderId !== undefined) {
    if (input.folderId) {
      const folders = await listRows(`vault_folders?id=eq.${encodeURIComponent(input.folderId)}&user_id=eq.${encodeURIComponent(identity.id)}&scope=eq.audio-space&select=id&limit=1`, env);
      if (!folders.length) throw new AudioSpaceError("That folder does not belong to AudioSpace.", 403);
    }
    patch.folder_id = input.folderId;
  }
  if (!Object.keys(patch).length) throw new AudioSpaceError("Nothing to update.", 400);
  const response = await dbFetch(`audio_space_items?id=eq.${encodeURIComponent(audioId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=${AUDIO_COLUMNS}`, env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new AudioSpaceError("That audio is not available.", 404);
  return { item: audioView(rows[0]) };
}

async function touchPlayed(identity, audioId, env) {
  const response = await dbFetch(`audio_space_items?id=eq.${encodeURIComponent(audioId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=${AUDIO_COLUMNS}`, env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ last_played_at: new Date().toISOString() }),
  });
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new AudioSpaceError("That audio is not available.", 404);
  return { item: audioView(rows[0]) };
}

function parseRangeHeader(header, totalSize) {
  if (!Number.isFinite(totalSize) || totalSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? totalSize - 1 : Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) return "invalid";
    end = Math.min(end, totalSize - 1);
  }
  return { start, end };
}

async function serveAudioFile(ownerId, audioId, env, origin, request, download) {
  if (!env.VAULT_FILES) throw new AudioSpaceError("Private audio storage is not configured.", 503);
  const rows = await listRows(`audio_space_items?id=eq.${encodeURIComponent(audioId)}&user_id=eq.${encodeURIComponent(ownerId)}&select=file_key,file_name,file_type,title&limit=1`, env);
  const row = rows[0];
  const key = row?.file_key || "";
  if (!row || !key.startsWith(`${ownerId}/audio-space/`) || key.includes("..") || key.includes("\\")) throw new AudioSpaceError("That audio is not available.", 404);
  const type = AUDIO_SAVE_TYPES[row.file_type] ? row.file_type : "audio/mpeg";
  const fileName = audioFileName(row.title || row.file_name || "audio", detectAudioFormat(type));
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

  const baseHeaders = headersFor(origin, {
    "Content-Type": type,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "X-File-Name": encodeURIComponent(fileName),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store, max-age=0",
    "Accept-Ranges": "bytes",
  });

  const probe = await env.VAULT_FILES.head(key);
  const metadata = probe?.customMetadata || {};
  if (!probe || metadata.ownerId !== ownerId || metadata.audioSpace !== "true") throw new AudioSpaceError("That private audio is unavailable.", 404);
  const totalSize = Number(probe.size) || 0;

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader && !download) {
    const range = parseRangeHeader(rangeHeader, totalSize);
    if (range === "invalid" || range === null) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${totalSize}` } });
    }
    const object = await env.VAULT_FILES.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } });
    if (!object) throw new AudioSpaceError("That private audio is unavailable.", 404);
    return new Response(object.body, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
      },
    });
  }

  const object = await env.VAULT_FILES.get(key);
  if (!object) throw new AudioSpaceError("That private audio is unavailable.", 404);
  return new Response(object.body, { status: 200, headers: { ...baseHeaders, "Content-Length": String(object.size) } });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function handleAudioSpace(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(AUDIO_SPACE_ROUTE_PREFIX.length).split("/").filter(Boolean);
  try {
    if (segments[0] === "links" && segments.length === 1 && request.method === "POST") {
      return json(await createAudioLink(request, identity, env), 201, origin);
    }
    if (segments[0] === "links" && segments[1] === "validate" && segments.length === 2 && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { throw new AudioSpaceError("The audio link could not be read.", 400); }
      const probe = await probeAudioLink(String(body?.url || ""));
      return json({ ok: true, host: probe.host, contentType: probe.contentType, contentLength: probe.contentLength, format: probe.format }, 200, origin);
    }
    if (segments[0] !== "audios") return json({ error: "That AudioSpace route is not available." }, 404, origin);
    if (segments.length === 1) {
      if (request.method === "GET") {
        const rows = await listRows(`audio_space_items?user_id=eq.${encodeURIComponent(identity.id)}&select=${AUDIO_COLUMNS}&order=created_at.desc&limit=1000`, env);
        return json({ items: rows.map(audioView) }, 200, origin);
      }
      if (request.method === "POST") return json(await createAudio(request, identity, env, services), 201, origin);
      return json({ error: "Method not allowed." }, 405, origin);
    }
    const audioId = segments[1];
    if (!isUuid(audioId)) return json({ error: "That audio is not available." }, 404, origin);
    if (segments.length === 2) {
      if (request.method === "PATCH") return json(await updateAudio(request, identity, audioId, env), 200, origin);
      if (request.method === "DELETE") {
        await rpc("persora_audio_space_trash_move", { p_owner: identity.id, p_id: audioId }, env);
        return json({ ok: true, trashed: true }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }
    if (segments.length === 3 && segments[2] === "play" && request.method === "POST") {
      return json(await touchPlayed(identity, audioId, env), 200, origin);
    }
    if (segments.length === 3 && segments[2] === "file" && request.method === "GET") {
      return await serveAudioFile(identity.id, audioId, env, origin, request, url.searchParams.get("download") === "1");
    }
    return json({ error: "That AudioSpace route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof AudioSpaceError) return json({ error: error.message, ...error.extra }, error.status, origin);
    console.error("Persora AudioSpace request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "AudioSpace couldn't complete that request. Please try again." }, 500, origin);
  }
}

/** Account-backup export: every audio row (files travel with the R2 manifest). */
export async function exportAudioSpaceData(userId, env) {
  try {
    const data = await rpc("persora_audio_space_export", { p_owner: userId }, env);
    return { audioItems: Array.isArray(data?.audioItems) ? data.audioItems : [] };
  } catch (error) {
    if (error instanceof AudioSpaceError && error.status === 503) return { audioItems: [] };
    throw error;
  }
}
