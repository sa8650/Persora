// Photo Studio — pure helpers (no DOM, no network). Imported by the view, the
// canvas renderer and unit tests. Image header parsing lives in the shared
// cloudflare/photo-metadata.js so the browser and the API agree exactly.
import {
  DEFAULT_PRINT_DPI, PHOTO_SIZE_PRESETS, aspectRatio, fromPixels, matchPreset, readImageInfo, toPixels,
  type ImageInfo, type PhotoSizePreset, type PhotoUnit,
} from "../../cloudflare/photo-metadata.js";
import type { PhotoCategory, PhotoStudioPhoto } from "../types";
import {
  NEUTRAL_FILTER, PHOTO_FILTER_PRESETS, applyPhotoFilter, getPhotoFilterPreset, isFilterNeutral,
  type PhotoFilterId, type PhotoFilterPreset, type PhotoFilterSelection,
} from "./photo-filters";

export {
  PHOTO_SIZE_PRESETS, DEFAULT_PRINT_DPI, aspectRatio, fromPixels, matchPreset, readImageInfo, toPixels,
  NEUTRAL_FILTER, PHOTO_FILTER_PRESETS, applyPhotoFilter, getPhotoFilterPreset, isFilterNeutral,
};
export type { ImageInfo, PhotoSizePreset, PhotoUnit, PhotoFilterId, PhotoFilterPreset, PhotoFilterSelection };

export const PHOTO_CATEGORIES: { id: PhotoCategory; label: string; hint: string }[] = [
  { id: "passport", label: "Passport", hint: "Passport & e-passport applications" },
  { id: "stamp", label: "Stamp size", hint: "Small stamp-size prints" },
  { id: "visa", label: "Visa", hint: "Visa & immigration forms" },
  { id: "id-card", label: "ID card", hint: "National, student or office ID" },
  { id: "job-application", label: "Job application", hint: "CVs & application forms" },
  { id: "other", label: "Other formal", hint: "Any other official photo" },
];
const CATEGORY_IDS = new Set(PHOTO_CATEGORIES.map((entry) => entry.id));

export function categoryLabel(category: string): string {
  return PHOTO_CATEGORIES.find((entry) => entry.id === category)?.label || "Other formal";
}
export function isPhotoCategory(value: string): value is PhotoCategory {
  return CATEGORY_IDS.has(value as PhotoCategory);
}

/** Photo Studio saves JPEG, PNG or WebP; anything else must go through the editor. */
export const PHOTO_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";
export const PHOTO_EDITOR_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/bmp";
export const SAVEABLE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDimensions(width: number, height: number): string {
  return width > 0 && height > 0 ? `${width} × ${height} px` : "—";
}

function trimNumber(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

/** "35 × 45 mm" at the given DPI (or null without a DPI). */
export function printSizeLabel(width: number, height: number, dpi: number | null | undefined, unit: Exclude<PhotoUnit, "px"> = "mm"): string | null {
  if (!dpi || dpi <= 0 || width <= 0 || height <= 0) return null;
  return `${trimNumber(fromPixels(width, unit, dpi))} × ${trimNumber(fromPixels(height, unit, dpi))} ${unit}`;
}

export function defaultTitleFromFileName(name: string): string {
  const base = String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Official photo").slice(0, 120);
}

export interface PhotoAnalysis {
  format: string;
  mime: string;
  width: number;
  height: number;
  dpi: number | null;
  dpiSource: string | null;
  aspect: string;
  megapixels: number;
  orientation: number;
  printSize: string | null;
  preset: PhotoSizePreset | null;
  presetExact: boolean;
  fileSize: number;
  warnings: string[];
}

/**
 * Local, non-AI analysis of an image. `decoded` comes from the browser decoder
 * (authoritative pixel size, EXIF orientation applied); header data supplies
 * format, DPI and orientation. No network or model is involved.
 */
export function analyzePhoto(bytes: Uint8Array, decoded: { width: number; height: number } | null, fileSize: number): PhotoAnalysis | null {
  const info = readImageInfo(bytes);
  if (!info) return null;
  const width = decoded?.width || info.width;
  const height = decoded?.height || info.height;
  if (!width || !height) return null;
  const match = matchPreset(width, height, info.dpi);
  const warnings: string[] = [];
  if (!info.dpi) warnings.push("No print resolution is stored in this file. Print size assumes the DPI you choose when editing.");
  else if (info.dpi < 200) warnings.push(`Stored at ${Math.round(info.dpi)} DPI — official prints usually need 300 DPI.`);
  if (Math.min(width, height) < 300) warnings.push("Low pixel resolution — this photo may look soft when printed.");
  return {
    format: info.format,
    mime: info.mime,
    width,
    height,
    dpi: info.dpi,
    dpiSource: info.dpiSource,
    aspect: aspectRatio(width, height).label,
    megapixels: Math.round((width * height) / 10_000) / 100,
    orientation: info.orientation,
    printSize: printSizeLabel(width, height, info.dpi),
    preset: match?.preset || null,
    presetExact: Boolean(match?.exact),
    fileSize,
    warnings,
  };
}

/** Compact JSON metadata stored with the photo (title/category live in columns). */
export function analysisMetadata(analysis: PhotoAnalysis): Record<string, unknown> {
  return {
    aspectRatio: analysis.aspect,
    megapixels: analysis.megapixels,
    printSize: analysis.printSize,
    presetLabel: analysis.preset ? `${analysis.preset.label} · ${analysis.preset.detail}` : null,
    detectedLocally: true,
  };
}

// ---------------------------------------------------------------------------
// Library filtering
// ---------------------------------------------------------------------------
export type PhotoSort = "newest" | "oldest" | "title";
export interface PhotoFilter { query: string; category: PhotoCategory | "all"; folderId: string; sort: PhotoSort }

export function filterPhotos(photos: PhotoStudioPhoto[], filter: PhotoFilter): PhotoStudioPhoto[] {
  const query = filter.query.trim().toLowerCase();
  const rows = photos.filter((photo) => {
    if (filter.folderId && photo.folderId !== filter.folderId) return false;
    if (filter.category !== "all" && photo.category !== filter.category) return false;
    if (!query) return true;
    const haystack = [photo.title, photo.notes, categoryLabel(photo.category), photo.fileName, formatDimensions(photo.width, photo.height), String(photo.metadata.presetLabel || "")].join(" ").toLowerCase();
    return query.split(/\s+/).every((term) => haystack.includes(term));
  });
  return rows.sort((a, b) => {
    if (filter.sort === "title") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    const diff = a.createdAt.localeCompare(b.createdAt);
    return filter.sort === "oldest" ? diff : -diff;
  });
}

export function folderCounts(photos: PhotoStudioPhoto[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const photo of photos) if (photo.folderId) counts[photo.folderId] = (counts[photo.folderId] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Editor maths
// ---------------------------------------------------------------------------
export const BACKGROUND_SWATCHES: { id: string; label: string; color: string }[] = [
  { id: "white", label: "White", color: "#ffffff" },
  { id: "off-white", label: "Off-white", color: "#f1f1ef" },
  { id: "light-blue", label: "Light blue", color: "#cfe2f6" },
  { id: "blue", label: "Blue", color: "#2f6fd6" },
  { id: "red", label: "Red", color: "#d0312d" },
];

export function normalizeHexColor(value: string, fallback = "#ffffff"): string {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  return fallback;
}

export const MAX_OUTPUT_DIMENSION = 6000;
export const MIN_OUTPUT_DIMENSION = 16;

export interface OutputSize { width: number; height: number; unit: PhotoUnit; dpi: number }

/** Output pixels for a size expressed in any unit; clamped to sane bounds. */
export function outputPixels(size: OutputSize): { width: number; height: number; clamped: boolean } {
  const rawW = toPixels(size.width, size.unit, size.dpi);
  const rawH = toPixels(size.height, size.unit, size.dpi);
  const width = Math.max(MIN_OUTPUT_DIMENSION, Math.min(MAX_OUTPUT_DIMENSION, rawW || 0));
  const height = Math.max(MIN_OUTPUT_DIMENSION, Math.min(MAX_OUTPUT_DIMENSION, rawH || 0));
  return { width, height, clamped: width !== rawW || height !== rawH };
}

/** Converts a size between units at a fixed DPI (rounded for display). */
export function convertSize(size: OutputSize, unit: PhotoUnit): OutputSize {
  const px = outputPixels(size);
  const digits = unit === "px" ? 0 : unit === "in" ? 2 : 1;
  const round = (value: number) => Number(value.toFixed(digits));
  return { ...size, unit, width: round(fromPixels(px.width, unit, size.dpi)), height: round(fromPixels(px.height, unit, size.dpi)) };
}

/**
 * Minimum scale at which a `srcW × srcH` image rotated by `degrees` fully
 * covers an `outW × outH` frame (so no empty corners appear at zoom 1).
 */
export function coverScale(srcW: number, srcH: number, outW: number, outH: number, degrees = 0): number {
  if (srcW <= 0 || srcH <= 0) return 1;
  const radians = (Math.abs(degrees) % 180) * (Math.PI / 180);
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return Math.max((outW * cos + outH * sin) / srcW, (outW * sin + outH * cos) / srcH);
}

export interface Adjustments { brightness: number; contrast: number; exposure: number; sharpness: number }
export const NEUTRAL_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, exposure: 0, sharpness: 0 };

export function isNeutral(adjustments: Adjustments): boolean {
  return adjustments.brightness === 0 && adjustments.contrast === 0 && adjustments.exposure === 0 && adjustments.sharpness === 0;
}

/**
 * Applies exposure (EV, −2…2), brightness (−100…100), contrast (−100…100) and
 * sharpness (0…100, unsharp 3×3) to RGBA pixels in place. Alpha is preserved,
 * so a cut-out subject can be adjusted without tinting the solid background.
 */
export function applyAdjustments(data: Uint8ClampedArray, width: number, height: number, adjustments: Adjustments): void {
  const exposure = Math.pow(2, Math.max(-2, Math.min(2, adjustments.exposure)));
  const brightness = Math.max(-100, Math.min(100, adjustments.brightness)) * 1.28;
  const c = Math.max(-100, Math.min(100, adjustments.contrast)) * 2.55;
  const contrast = (259 * (c + 255)) / (255 * (259 - c));
  if (exposure !== 1 || brightness !== 0 || contrast !== 1) {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v += 1) lut[v] = contrast * (v * exposure + brightness - 128) + 128;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
    }
  }
  const amount = Math.max(0, Math.min(100, adjustments.sharpness)) / 100;
  if (amount > 0 && width > 2 && height > 2) {
    const source = new Uint8ClampedArray(data);
    const k = amount * 1.2;
    const stride = width * 4;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * stride + x * 4;
        if (source[i + 3] === 0) continue;
        for (let ch = 0; ch < 3; ch += 1) {
          const center = source[i + ch];
          const blur = (source[i - 4 + ch] + source[i + 4 + ch] + source[i - stride + ch] + source[i + stride + ch]) / 4;
          data[i + ch] = center + k * (center - blur) * 1.5;
        }
      }
    }
  }
}

export interface MaskAssessment { foreground: number; usable: boolean; reason: string | null }

/**
 * Judges a background-removal result from its alpha channel (RGBA data):
 * a usable portrait cut-out keeps a meaningful subject AND removes a
 * meaningful amount of background. Used for both the cloud and local model.
 */
export function assessAlphaMask(rgba: Uint8ClampedArray | Uint8Array): MaskAssessment {
  const pixels = Math.floor(rgba.length / 4);
  if (!pixels) return { foreground: 0, usable: false, reason: "The result was empty." };
  let sum = 0; let opaque = 0; let clear = 0; let uncertain = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    const alpha = rgba[i];
    sum += alpha;
    if (alpha > 245) opaque += 1;
    else if (alpha < 10) clear += 1;
    else if (alpha > 38 && alpha < 217) uncertain += 1;
  }
  const foreground = sum / (pixels * 255);
  if (foreground < 0.03) return { foreground, usable: false, reason: "No person was detected in the photo." };
  if (clear / pixels < 0.02 || foreground > 0.985) return { foreground, usable: false, reason: "The background was not removed." };
  if (opaque / pixels < 0.01) return { foreground, usable: false, reason: "The subject came out too faint to use." };
  if (uncertain / pixels > 0.25) return { foreground, usable: false, reason: "The model couldn't separate the person from the background clearly." };
  return { foreground, usable: true, reason: null };
}

/** Output file name for an edited photo. */
export function editedFileName(title: string, mime: string): string {
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const base = String(title || "photo").replace(/[^\w() -]+/g, "_").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "photo";
  return `${base}.${extension}`;
}
