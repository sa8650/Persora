// Persora AudioSpace — shared, dependency-free audio format helpers.
//
// Used by the Pages Functions (cloudflare/audio-space.js) and the browser
// (src/lib/audio-space.ts) so both sides agree on supported formats, file
// extensions, magic-number sniffing, and safe external link rules.
//
// AudioSpace is an audio archive and management tool, not a music streaming
// platform: these helpers only describe audio *files* and direct audio URLs.

/** Supported saveable formats. "webm" is included because MediaRecorder in
 * Chromium/Firefox produces WebM/Opus (or Ogg/Opus) recordings. */
export const AUDIO_FORMATS = Object.freeze({
  mp3: { mime: "audio/mpeg", extension: "mp3", label: "MP3" },
  wav: { mime: "audio/wav", extension: "wav", label: "WAV" },
  m4a: { mime: "audio/mp4", extension: "m4a", label: "M4A" },
  aac: { mime: "audio/aac", extension: "aac", label: "AAC" },
  ogg: { mime: "audio/ogg", extension: "ogg", label: "OGG" },
  flac: { mime: "audio/flac", extension: "flac", label: "FLAC" },
  webm: { mime: "audio/webm", extension: "webm", label: "WebM" },
});

/** Declared MIME types accepted for each format (server + browser picker). */
export const AUDIO_SAVE_TYPES = Object.freeze({
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/x-mp3": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/mp4a-latm": "m4a",
  "audio/aac": "aac", "audio/x-aac": "aac", "audio/aacp": "aac",
  "audio/ogg": "ogg", "audio/x-ogg": "ogg", "audio/opus": "ogg", "audio/vorbis": "ogg", "application/ogg": "ogg",
  "audio/flac": "flac", "audio/x-flac": "flac",
  "audio/webm": "webm",
});

const EXTENSION_FORMATS = Object.freeze({
  mp3: "mp3", wav: "wav", wave: "wav", m4a: "m4a", m4b: "m4a", aac: "aac",
  ogg: "ogg", oga: "ogg", opus: "ogg", flac: "flac", webm: "webm",
});

/** Resolves a format key ("mp3"…) from a MIME type or a URL/path extension. */
export function detectAudioFormat(typeOrUrl) {
  const value = String(typeOrUrl || "").toLowerCase().trim();
  if (!value) return null;
  const mimeMatch = value.match(/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;|$)/);
  if (mimeMatch) {
    const mime = value.split(";")[0].trim();
    return AUDIO_SAVE_TYPES[mime] || (mime.startsWith("audio/") && mime.includes("mpeg") ? "mp3" : null);
  }
  const match = value.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/);
  if (match) return EXTENSION_FORMATS[match[1]] || null;
  return EXTENSION_FORMATS[value] || null;
}

/**
 * Magic-number sniffing for supported audio containers.
 * Returns a format key, or null when the bytes are not recognised audio.
 */
export function sniffAudioFormat(bytes) {
  if (!bytes || bytes.byteLength < 12) return null;
  // WAV: "RIFF"...."WAVE"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return "wav";
  // FLAC: "fLaC"
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return "flac";
  // Ogg: "OggS"
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "ogg";
  // EBML (WebM/Matroska)
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  // MP4/M4A container: "ftyp" at offset 4 with an audio-compatible brand
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (["M4A ", "M4B ", "M4P ", "mp42", "mp41", "isom", "iso2", "MSNV"].includes(brand)) return "m4a";
    return null;
  }
  // ID3-tagged MP3
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "mp3";
  // Raw AAC (ADTS): 12-bit sync 0xFFF, layer bits 00
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "aac";
  // MPEG audio frame sync
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

// ---------------------------------------------------------------------------
// External link safety (SSRF-aware)
// ---------------------------------------------------------------------------

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPrivateHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) if (host.endsWith(suffix)) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (host.includes(":")) {
    if (/^f[cd]/.test(host)) return true;      // unique-local
    if (/^fe[89ab]/.test(host)) return true;   // link-local
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHostname(mapped[1]);
    return false;
  }
  return false;
}

/**
 * True when a URL is safe for Persora's server to fetch: http/https, default
 * ports only, and never a private or loopback address.
 */
export function isSafeExternalAudioUrl(urlString) {
  let url;
  try { url = new URL(String(urlString || "")); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  if (url.username || url.password) return false;
  return !isPrivateHostname(url.hostname);
}

/**
 * Normalizes and validates a member-pasted audio URL.
 * Throws an Error with a member-facing message when the URL is not acceptable.
 */
export function normalizeExternalUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error("Paste an audio URL to continue.");
  if (value.length > 2000) throw new Error("That audio link is too long.");
  if (!/^https?:\/\//i.test(value)) throw new Error("Enter a full audio URL starting with http:// or https://.");
  let url;
  try { url = new URL(value); } catch { throw new Error("That audio link is not a valid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Enter a full audio URL starting with http:// or https://.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("That audio link uses a port Persora will not fetch.");
  if (url.username || url.password) throw new Error("Remove the username and password from that audio link.");
  if (isPrivateHostname(url.hostname)) throw new Error("That audio link points at a private network address, which Persora will not fetch.");
  return url.href;
}
