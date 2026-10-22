// Persora Photo Studio — pure, dependency-free image metadata helpers shared by
// the browser (local detection before anything is saved) and the Pages API
// (authoritative validation of the uploaded bytes). Nothing here calls an AI
// model or any external service: dimensions, DPI, orientation and format are
// read straight from the file headers (JPEG JFIF/EXIF/SOF, PNG IHDR/pHYs,
// WebP VP8/VP8L/VP8X).

export const MM_PER_INCH = 25.4;
export const DEFAULT_PRINT_DPI = 300;
export const MAX_PHOTO_DIMENSION = 20000;
export const PHOTO_UNITS = ["px", "mm", "cm", "in"];

/** Saveable formats. Other decodable formats are converted by the editor. */
export const PHOTO_SAVE_TYPES = Object.freeze({
  "image/jpeg": { extension: "jpg", label: "JPEG" },
  "image/png": { extension: "png", label: "PNG" },
  "image/webp": { extension: "webp", label: "WebP" },
});

/** Official photo sizes. `width`/`height` are in `unit`; px values at `dpi`. */
export const PHOTO_SIZE_PRESETS = Object.freeze([
  { id: "passport-35x45", label: "Passport & visa", detail: "35 × 45 mm", width: 35, height: 45, unit: "mm", dpi: 300, category: "passport" },
  { id: "bd-passport-45x55", label: "Bangladesh e-passport", detail: "45 × 55 mm", width: 45, height: 55, unit: "mm", dpi: 300, category: "passport" },
  { id: "us-2x2", label: "US passport & visa", detail: "2 × 2 in", width: 2, height: 2, unit: "in", dpi: 300, category: "visa" },
  { id: "china-visa-33x48", label: "China visa", detail: "33 × 48 mm", width: 33, height: 48, unit: "mm", dpi: 300, category: "visa" },
  { id: "canada-50x70", label: "Canada passport", detail: "50 × 70 mm", width: 50, height: 70, unit: "mm", dpi: 300, category: "passport" },
  { id: "stamp-20x25", label: "Stamp size", detail: "20 × 25 mm", width: 20, height: 25, unit: "mm", dpi: 300, category: "stamp" },
  { id: "id-card-30x40", label: "ID card", detail: "30 × 40 mm", width: 30, height: 40, unit: "mm", dpi: 300, category: "id-card" },
  { id: "job-40x50", label: "Job application", detail: "40 × 50 mm", width: 40, height: 50, unit: "mm", dpi: 300, category: "job-application" },
  { id: "digital-600", label: "Digital upload", detail: "600 × 600 px", width: 600, height: 600, unit: "px", dpi: 300, category: "other" },
]);

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Converts a length in `unit` to whole pixels at `dpi`. */
export function toPixels(value, unit, dpi = DEFAULT_PRINT_DPI) {
  const amount = finite(value);
  const density = Math.max(1, finite(dpi, DEFAULT_PRINT_DPI));
  switch (unit) {
    case "mm": return Math.round((amount / MM_PER_INCH) * density);
    case "cm": return Math.round(((amount * 10) / MM_PER_INCH) * density);
    case "in": return Math.round(amount * density);
    default: return Math.round(amount);
  }
}

/** Converts pixels to a length in `unit` at `dpi` (not rounded). */
export function fromPixels(px, unit, dpi = DEFAULT_PRINT_DPI) {
  const amount = finite(px);
  const density = Math.max(1, finite(dpi, DEFAULT_PRINT_DPI));
  switch (unit) {
    case "mm": return (amount / density) * MM_PER_INCH;
    case "cm": return (amount / density) * MM_PER_INCH / 10;
    case "in": return amount / density;
    default: return amount;
  }
}

export function presetPixels(preset) {
  return { width: toPixels(preset.width, preset.unit, preset.dpi), height: toPixels(preset.height, preset.unit, preset.dpi) };
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

/** "4:5"-style reduced ratio plus a decimal ratio; tolerant to near-common ratios. */
export function aspectRatio(width, height) {
  const w = Math.round(finite(width));
  const h = Math.round(finite(height));
  if (w <= 0 || h <= 0) return { label: "—", value: 0 };
  const divisor = gcd(w, h);
  let rw = w / divisor;
  let rh = h / divisor;
  if (rw > 50 || rh > 50) {
    // Snap to the closest small ratio (e.g. 413×531 → 7:9) when it's within 1%.
    let best = null;
    for (let y = 1; y <= 20; y += 1) {
      for (let x = 1; x <= 20; x += 1) {
        const error = Math.abs(x / y - w / h) / (w / h);
        if (error < 0.01 && (!best || error < best.error - 1e-9)) best = { x, y, error };
      }
    }
    if (best) { rw = best.x; rh = best.y; }
    else return { label: `${(w / h).toFixed(3)}:1`, value: w / h };
  }
  return { label: `${rw}:${rh}`, value: w / h };
}

/** Finds the official preset whose ratio (and physical size, if DPI is known) matches. */
export function matchPreset(width, height, dpi) {
  const w = finite(width); const h = finite(height);
  if (w <= 0 || h <= 0) return null;
  const ratio = w / h;
  let best = null;
  for (const preset of PHOTO_SIZE_PRESETS) {
    const presetRatio = preset.width / preset.height;
    const error = Math.abs(presetRatio - ratio) / presetRatio;
    if (error > 0.012) continue;
    let exact = false;
    if (preset.unit === "px") exact = Math.abs(w - preset.width) <= 2 && Math.abs(h - preset.height) <= 2;
    else if (finite(dpi) > 0) {
      const wmm = fromPixels(w, "mm", dpi); const hmm = fromPixels(h, "mm", dpi);
      const pwmm = preset.unit === "in" ? preset.width * MM_PER_INCH : preset.unit === "cm" ? preset.width * 10 : preset.width;
      const phmm = preset.unit === "in" ? preset.height * MM_PER_INCH : preset.unit === "cm" ? preset.height * 10 : preset.height;
      exact = Math.abs(wmm - pwmm) / pwmm < 0.03 && Math.abs(hmm - phmm) / phmm < 0.03;
    }
    const score = error - (exact ? 1 : 0);
    if (!best || score < best.score) best = { preset, exact, score };
  }
  return best ? { preset: best.preset, exact: best.exact } : null;
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------
function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(0);
}
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

/** Identifies the image format from magic bytes. */
export function detectImageFormat(input) {
  const b = asBytes(input);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", label: "JPEG" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", label: "PNG" };
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { mime: "image/webp", label: "WebP" };
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return { mime: "image/gif", label: "GIF" };
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return { mime: "image/bmp", label: "BMP" };
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { mime: "image/heic", label: "HEIC" };
    if (/^avi[fs]$/.test(brand)) return { mime: "image/avif", label: "AVIF" };
  }
  return null;
}

// EXIF (TIFF) IFD0: Orientation 0x0112, XResolution 0x011A, ResolutionUnit 0x0128.
function readExif(b, start, length) {
  const end = Math.min(b.length, start + length);
  if (end - start < 14 || ascii(b, start, 4) !== "Exif") return {};
  const tiff = start + 6;
  const little = ascii(b, tiff, 2) === "II";
  if (!little && ascii(b, tiff, 2) !== "MM") return {};
  const r16 = (i) => (little ? u16le(b, i) : u16be(b, i));
  const r32 = (i) => (little ? (u16le(b, i) + u16le(b, i + 2) * 65536) : u32be(b, i));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return {};
  const count = r16(ifd);
  const out = {};
  let unit = 2;
  let xres = 0;
  for (let n = 0; n < count; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) break;
    const tag = r16(entry);
    if (tag === 0x0112) out.orientation = r16(entry + 8);
    else if (tag === 0x0128) unit = r16(entry + 8);
    else if (tag === 0x011a) {
      const offset = tiff + r32(entry + 8);
      if (offset + 8 <= end) {
        const denominator = r32(offset + 4);
        if (denominator) xres = r32(offset) / denominator;
      }
    }
  }
  if (xres > 0) {
    if (unit === 3) out.dpi = xres * 2.54;
    else if (unit === 2) out.dpi = xres;
  }
  return out;
}

function readJpeg(b) {
  const info = { width: 0, height: 0, dpi: null, dpiSource: null, orientation: 1 };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = u16be(b, i + 2);
    if (length < 2) break;
    const body = i + 4;
    if (marker === 0xe0 && length >= 16 && ascii(b, body, 5) === "JFIF\0") {
      const units = b[body + 7];
      const x = u16be(b, body + 8);
      if (x > 1 && units === 1 && !info.dpi) { info.dpi = x; info.dpiSource = "JFIF"; }
      if (x > 1 && units === 2 && !info.dpi) { info.dpi = x * 2.54; info.dpiSource = "JFIF"; }
    } else if (marker === 0xe1) {
      const exif = readExif(b, body, length - 2);
      if (exif.orientation) info.orientation = exif.orientation;
      // EXIF resolution is authoritative over a 72-dpi JFIF default.
      if (exif.dpi && (!info.dpi || info.dpiSource !== "EXIF")) { info.dpi = exif.dpi; info.dpiSource = "EXIF"; }
    } else if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      info.height = u16be(b, body + 1);
      info.width = u16be(b, body + 3);
    }
    i += 2 + length;
  }
  return info;
}

function readPng(b) {
  const info = { width: 0, height: 0, dpi: null, dpiSource: null, orientation: 1 };
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return info;
  info.width = u32be(b, 16);
  info.height = u32be(b, 20);
  let i = 8;
  while (i + 12 <= b.length) {
    const length = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (type === "pHYs" && length >= 9 && i + 17 <= b.length) {
      const ppu = u32be(b, i + 8);
      if (b[i + 16] === 1 && ppu > 0) { info.dpi = ppu * 0.0254; info.dpiSource = "pHYs"; }
    }
    if (type === "IDAT" || type === "IEND") break;
    i += 12 + length;
  }
  return info;
}

function readWebp(b) {
  const info = { width: 0, height: 0, dpi: null, dpiSource: null, orientation: 1 };
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const size = u16le(b, i + 4) + u16le(b, i + 6) * 65536;
    const body = i + 8;
    if (type === "VP8X" && body + 10 <= b.length) {
      info.width = u24le(b, body + 4) + 1;
      info.height = u24le(b, body + 7) + 1;
    } else if (type === "VP8 " && body + 10 <= b.length && !info.width) {
      info.width = u16le(b, body + 6) & 0x3fff;
      info.height = u16le(b, body + 8) & 0x3fff;
    } else if (type === "VP8L" && body + 5 <= b.length && !info.width) {
      const bits = b[body + 1] | (b[body + 2] << 8) | (b[body + 3] << 16) | (b[body + 4] << 24);
      info.width = (bits & 0x3fff) + 1;
      info.height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === "EXIF") {
      const exif = readExif(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...b.subarray(body, Math.min(b.length, body + size))]), 0, size + 6);
      if (exif.orientation) info.orientation = exif.orientation;
      if (exif.dpi) { info.dpi = exif.dpi; info.dpiSource = "EXIF"; }
    }
    i = body + size + (size % 2);
  }
  return info;
}

/**
 * Reads format, pixel dimensions (as displayed, i.e. EXIF orientation applied),
 * DPI and orientation from image bytes. Returns null when the format is unknown.
 */
export function readImageInfo(input) {
  const b = asBytes(input);
  const format = detectImageFormat(b);
  if (!format) return null;
  let raw = { width: 0, height: 0, dpi: null, dpiSource: null, orientation: 1 };
  if (format.mime === "image/jpeg") raw = readJpeg(b);
  else if (format.mime === "image/png") raw = readPng(b);
  else if (format.mime === "image/webp") raw = readWebp(b);
  else if (format.mime === "image/gif" && b.length >= 10) raw = { ...raw, width: u16le(b, 6), height: u16le(b, 8) };
  else if (format.mime === "image/bmp" && b.length >= 26) raw = { ...raw, width: Math.abs(u16le(b, 18) + u16le(b, 20) * 65536), height: Math.abs((u16le(b, 22) + u16le(b, 24) * 65536) | 0) };
  const orientation = raw.orientation >= 1 && raw.orientation <= 8 ? raw.orientation : 1;
  const swap = orientation >= 5;
  const dpi = raw.dpi && raw.dpi >= 1 && raw.dpi <= 10000 ? Math.round(raw.dpi * 100) / 100 : null;
  return {
    mime: format.mime,
    format: format.label,
    width: swap ? raw.height : raw.width,
    height: swap ? raw.width : raw.height,
    storedWidth: raw.width,
    storedHeight: raw.height,
    orientation,
    dpi,
    dpiSource: dpi ? raw.dpiSource : null,
  };
}

// ---------------------------------------------------------------------------
// Writing DPI into exported files (so print size survives download/re-upload)
// ---------------------------------------------------------------------------
let crcTable = null;
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32be(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff; target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff; target[offset + 3] = value & 0xff;
}

/** Returns a copy of JPEG/PNG bytes that declares `dpi`; other formats are returned unchanged. */
export function withImageDpi(input, dpi) {
  const b = asBytes(input);
  const density = Math.round(finite(dpi));
  if (density < 1 || density > 65535) return b;
  const format = detectImageFormat(b);
  if (format?.mime === "image/jpeg") {
    if (b.length > 20 && b[2] === 0xff && b[3] === 0xe0 && ascii(b, 6, 5) === "JFIF\0") {
      const copy = b.slice();
      copy[13] = 1; copy[14] = density >> 8; copy[15] = density & 0xff; copy[16] = density >> 8; copy[17] = density & 0xff;
      return copy;
    }
    const app0 = new Uint8Array([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, density >> 8, density & 0xff, density >> 8, density & 0xff, 0x00, 0x00]);
    const out = new Uint8Array(b.length + app0.length);
    out.set(b.subarray(0, 2), 0); out.set(app0, 2); out.set(b.subarray(2), 2 + app0.length);
    return out;
  }
  if (format?.mime === "image/png") {
    if (b.length < 33 || ascii(b, 12, 4) !== "IHDR") return b;
    const ppm = Math.round(density / 0.0254);
    const chunk = new Uint8Array(21);
    writeU32be(chunk, 0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);
    writeU32be(chunk, 8, ppm); writeU32be(chunk, 12, ppm); chunk[16] = 1;
    writeU32be(chunk, 17, crc32(chunk, 4, 17));
    const parts = [b.subarray(0, 33), chunk];
    let i = 33;
    while (i + 12 <= b.length) {
      const length = u32be(b, i);
      const type = ascii(b, i + 4, 4);
      const next = i + 12 + length;
      if (type !== "pHYs") parts.push(b.subarray(i, Math.min(next, b.length)));
      i = next;
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
  return b;
}
