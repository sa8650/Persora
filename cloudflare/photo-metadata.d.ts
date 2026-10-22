// Type declarations for the shared, dependency-free photo metadata helpers.
export type PhotoUnit = "px" | "mm" | "cm" | "in";
export type PhotoSaveType = "image/jpeg" | "image/png" | "image/webp";
export type PhotoCategoryHint = "passport" | "stamp" | "visa" | "id-card" | "job-application" | "other";

export interface PhotoSizePreset {
  id: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  unit: PhotoUnit;
  dpi: number;
  category: PhotoCategoryHint;
}

export interface ImageInfo {
  mime: string;
  format: string;
  /** Displayed width (EXIF orientation applied). */
  width: number;
  /** Displayed height (EXIF orientation applied). */
  height: number;
  storedWidth: number;
  storedHeight: number;
  orientation: number;
  dpi: number | null;
  dpiSource: "JFIF" | "EXIF" | "pHYs" | null;
}

export const MM_PER_INCH: number;
export const DEFAULT_PRINT_DPI: number;
export const MAX_PHOTO_DIMENSION: number;
export const PHOTO_UNITS: PhotoUnit[];
export const PHOTO_SAVE_TYPES: Readonly<Record<PhotoSaveType, { extension: string; label: string }>>;
export const PHOTO_SIZE_PRESETS: readonly PhotoSizePreset[];

export function toPixels(value: number, unit: PhotoUnit, dpi?: number): number;
export function fromPixels(px: number, unit: PhotoUnit, dpi?: number): number;
export function presetPixels(preset: PhotoSizePreset): { width: number; height: number };
export function aspectRatio(width: number, height: number): { label: string; value: number };
export function matchPreset(width: number, height: number, dpi?: number | null): { preset: PhotoSizePreset; exact: boolean } | null;
export function detectImageFormat(input: Uint8Array | ArrayBuffer): { mime: string; label: string } | null;
export function readImageInfo(input: Uint8Array | ArrayBuffer): ImageInfo | null;
export function crc32(bytes: Uint8Array, start?: number, end?: number): number;
export function withImageDpi(input: Uint8Array | ArrayBuffer, dpi: number): Uint8Array;
