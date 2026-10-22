// Persora PDF Studio — pure helpers shared by the library page, the Create PDF
// flow and the editor. Nothing in this module touches the DOM, PDF.js or
// pdf-lib, so it is cheap to import and fully unit-tested in Node.

import type { PdfStudioDocument } from "../types";

/** A user-facing failure whose message is shown as-is in the UI. */
export class PdfProcessingError extends Error {
  constructor(message: string) { super(message); this.name = "PdfProcessingError"; }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ---------------------------------------------------------------------------
// Limits & accepted inputs
// ---------------------------------------------------------------------------
/** Largest single file PDF Studio opens in the browser. */
export const PDF_OPEN_MAX_BYTES = 100 * 1024 * 1024;
/** Largest working document (pages across all merged files). */
export const PDF_MAX_TOTAL_PAGES = 1500;
/** Largest image accepted for Create PDF / image overlays. */
export const IMAGE_MAX_BYTES = 40 * 1024 * 1024;
/** Largest text file accepted for Create PDF. */
export const TEXT_MAX_BYTES = 5 * 1024 * 1024;
export const HISTORY_LIMIT = 100;

export const PDF_ACCEPT = "application/pdf,.pdf";
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp";
export const TEXT_ACCEPT = "text/plain,text/markdown,text/csv,.txt,.md,.markdown,.csv";
export const CREATE_ACCEPT = `${PDF_ACCEPT},${IMAGE_ACCEPT},${TEXT_ACCEPT}`;
export const SUPPORTED_INPUTS_LABEL = "PDF, JPG, PNG, WebP, GIF, BMP, TXT, MD or CSV";

export type InputKind = "pdf" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "text" | "unsupported";

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);

/**
 * Identifies an input by its leading bytes first (a renamed file is still
 * recognised), falling back to the extension/MIME type only for plain text.
 */
export function sniffFileKind(head: Uint8Array, name = "", mime = ""): InputKind {
  if (head.length >= 5) {
    const ascii = String.fromCharCode(...head.subarray(0, Math.min(head.length, 1024)));
    if (ascii.includes("%PDF-")) return "pdf";
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(head, [0x42, 0x4d]) && head.length > 14) return "bmp";
  const lower = name.toLowerCase();
  const textual = /^text\/(plain|markdown|csv|x-markdown)$/.test(mime) || /\.(txt|md|markdown|csv)$/.test(lower);
  if (textual && !looksBinary(head)) return "text";
  return "unsupported";
}

/** True when the sample contains NUL bytes or many control characters. */
export function looksBinary(sample: Uint8Array): boolean {
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.1;
}

export function unsupportedReason(name: string): string {
  if (/\.(docx?|odt|rtf|pages)$/i.test(name)) return `“${name}” is a word-processor document. Export it to PDF from its app first, then add the PDF here.`;
  if (/\.(xlsx?|ods|numbers|pptx?|odp|key)$/i.test(name)) return `“${name}” is an office file. Export it to PDF from its app first, then add the PDF here.`;
  if (/\.(heic|heif|tiff?|svg|avif)$/i.test(name)) return `“${name}” uses an image format browsers can't convert reliably. Save it as JPG or PNG first.`;
  return `“${name}” isn't supported. Use ${SUPPORTED_INPUTS_LABEL} files.`;
}

/** Decodes a text file as UTF-8 (BOM-aware), falling back to Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  let start = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) start = 3;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start)); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

// ---------------------------------------------------------------------------
// Formatting & library helpers
// ---------------------------------------------------------------------------
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function pageCountLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "page" : "pages"}`;
}

/** "Lease_final-v2.pdf" → "Lease final v2". */
export function titleFromFileName(name: string): string {
  const base = String(name || "").replace(/\.[a-z0-9]{1,8}$/i, "").replace(/[_]+/g, " ").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled PDF").slice(0, 150);
}

/** A safe download name ending in .pdf (keeps non-Latin letters). */
export function pdfDownloadName(title: string, suffix = ""): string {
  const base = String(title || "document").normalize("NFKC").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
  return `${base}${suffix}.pdf`;
}

export type PdfSort = "updated" | "newest" | "title" | "size";
export interface PdfFilter { query: string; folderId: string; sort: PdfSort }

export function filterDocuments(documents: PdfStudioDocument[], filter: PdfFilter): PdfStudioDocument[] {
  const terms = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = documents.filter((doc) => {
    if (filter.folderId && doc.folderId !== filter.folderId) return false;
    if (!terms.length) return true;
    const haystack = [doc.title, doc.notes, doc.fileName, pageCountLabel(doc.pageCount)].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return rows.sort((a, b) => {
    if (filter.sort === "title") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (filter.sort === "size") return b.fileSize - a.fileSize;
    if (filter.sort === "newest") return b.createdAt.localeCompare(a.createdAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function folderCounts(documents: PdfStudioDocument[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const doc of documents) if (doc.folderId) counts[doc.folderId] = (counts[doc.folderId] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Page ranges
// ---------------------------------------------------------------------------
export interface RangeResult { groups: number[][]; error: string }

/**
 * Parses "1-3, 5, 8-" style input (1-based, inclusive) into groups of 0-based
 * page indexes — one group per comma-separated part. "8-" means 8 to the end,
 * "-3" means 1 to 3, and "5-3" counts backwards.
 */
export function parsePageRanges(input: string, pageCount: number): RangeResult {
  const parts = String(input || "").split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { groups: [], error: "Enter pages such as 1-3, 5, 8-10." };
  const groups: number[][] = [];
  for (const part of parts) {
    const match = /^(\d*)\s*(?:[-–—]|to)\s*(\d*)$/i.exec(part) || /^(\d+)$/.exec(part);
    if (!match) return { groups: [], error: `“${part}” isn't a page or range. Use numbers like 2 or 4-7.` };
    const single = match.length === 2 || match[2] === undefined;
    const from = match[1] ? Number(match[1]) : 1;
    const to = single ? from : match[2] ? Number(match[2]) : pageCount;
    if (!match[1] && !single && !match[2]) return { groups: [], error: `“${part}” needs at least one page number.` };
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      return { groups: [], error: `“${part}” is outside this document — it has ${pageCountLabel(pageCount)}.` };
    }
    const group: number[] = [];
    const step = from <= to ? 1 : -1;
    for (let page = from; step > 0 ? page <= to : page >= to; page += step) group.push(page - 1);
    groups.push(group);
  }
  return { groups, error: "" };
}

/** The distinct pages of several groups, in first-seen order. */
export function flattenGroups(groups: number[][]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const group of groups) for (const index of group) if (!seen.has(index)) { seen.add(index); result.push(index); }
  return result;
}

/** Splits [0, pageCount) into consecutive chunks of `size` pages. */
export function chunkPages(pageCount: number, size: number): number[][] {
  const step = Math.max(1, Math.floor(size));
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += step) {
    groups.push(Array.from({ length: Math.min(step, pageCount - start) }, (_, offset) => start + offset));
  }
  return groups;
}

/** "1, 2, 3, 5, 7, 8" → "1-3, 5, 7-8" (input 0-based, output 1-based). */
export function describePages(indexes: number[]): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(i === j ? String(sorted[i] + 1) : `${sorted[i] + 1}-${sorted[j] + 1}`);
    i = j;
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Working document model
// ---------------------------------------------------------------------------
export type Rotation = 0 | 90 | 180 | 270;
export const normalizeRotation = (degrees: number): Rotation => ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as Rotation;

export interface TextOverlay { id: string; type: "text"; x: number; y: number; text: string; fontSize: number; color: string; bold: boolean }
export interface BoxOverlay { id: string; type: "highlight" | "rect" | "ellipse"; x: number; y: number; w: number; h: number; color: string; strokeWidth: number; fill: string | null }
export interface LineOverlay { id: string; type: "line" | "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth: number }
export interface InkOverlay { id: string; type: "ink"; points: number[]; color: string; strokeWidth: number }
export interface ImageOverlay { id: string; type: "image"; imageId: string; x: number; y: number; w: number; h: number; signature: boolean }
/**
 * Something drawn ON TOP of a page. Coordinates are PDF points in the page's
 * displayed (rotated) space: origin top-left, y pointing down. Overlays never
 * modify the page's original content.
 */
export type Overlay = TextOverlay | BoxOverlay | LineOverlay | InkOverlay | ImageOverlay;

export interface WorkingPage {
  id: string;
  sourceId: string;
  sourceIndex: number;
  /** Unrotated crop-box size (points) and the rotation stored in the source file. */
  width: number;
  height: number;
  baseRotation: Rotation;
  /** Rotation added in PDF Studio (applied on top of baseRotation). */
  rotation: Rotation;
  overlays: Overlay[];
}

export interface DocState { pages: WorkingPage[]; rev: number }

export function totalRotation(page: Pick<WorkingPage, "baseRotation" | "rotation">): Rotation {
  return normalizeRotation(page.baseRotation + page.rotation);
}

/** Size of the page as displayed (after rotation). */
export function viewSize(page: Pick<WorkingPage, "width" | "height" | "baseRotation" | "rotation">): { width: number; height: number } {
  return totalRotation(page) % 180 === 0 ? { width: page.width, height: page.height } : { width: page.height, height: page.width };
}

/** Axis-aligned bounds of an overlay, in view space. */
export function overlayBounds(overlay: Overlay, measureText?: (overlay: TextOverlay) => { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  switch (overlay.type) {
    case "text": {
      const size = measureText ? measureText(overlay) : estimateTextBox(overlay);
      return { x: overlay.x, y: overlay.y, w: size.width, h: size.height };
    }
    case "line": case "arrow": {
      const x = Math.min(overlay.x1, overlay.x2); const y = Math.min(overlay.y1, overlay.y2);
      return { x, y, w: Math.abs(overlay.x2 - overlay.x1), h: Math.abs(overlay.y2 - overlay.y1) };
    }
    case "ink": {
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (let i = 0; i < overlay.points.length; i += 2) {
        minX = Math.min(minX, overlay.points[i]); maxX = Math.max(maxX, overlay.points[i]);
        minY = Math.min(minY, overlay.points[i + 1]); maxY = Math.max(maxY, overlay.points[i + 1]);
      }
      return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
    }
    default: return { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h };
  }
}

export const TEXT_LINE_HEIGHT = 1.25;
/** Baseline offset of the first line, as a fraction of the font size (Helvetica ascent). */
export const TEXT_ASCENT = 0.8;

/** Rough text box when no canvas is available (Helvetica averages ~0.52em per glyph). */
export function estimateTextBox(overlay: Pick<TextOverlay, "text" | "fontSize" | "bold">): { width: number; height: number } {
  const lines = overlay.text.split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return { width: longest * overlay.fontSize * (overlay.bold ? 0.56 : 0.52), height: lines.length * overlay.fontSize * TEXT_LINE_HEIGHT };
}

function rotatePoint(x: number, y: number, clockwise: boolean, oldWidth: number, oldHeight: number): [number, number] {
  return clockwise ? [oldHeight - y, x] : [y, oldWidth - x];
}

/**
 * Moves an overlay so it stays on the same spot of the page content when the
 * page turns 90° (clockwise or not). `oldWidth/oldHeight` is the view size
 * before turning. Text and images keep their upright orientation and size,
 * pivoting around their centre; shapes, lines and ink are transformed exactly.
 */
export function rotateOverlay(overlay: Overlay, clockwise: boolean, oldWidth: number, oldHeight: number, textSize?: { width: number; height: number }): Overlay {
  const turn = (x: number, y: number) => rotatePoint(x, y, clockwise, oldWidth, oldHeight);
  switch (overlay.type) {
    case "line": case "arrow": {
      const [x1, y1] = turn(overlay.x1, overlay.y1); const [x2, y2] = turn(overlay.x2, overlay.y2);
      return { ...overlay, x1, y1, x2, y2 };
    }
    case "ink": {
      const points: number[] = [];
      for (let i = 0; i < overlay.points.length; i += 2) points.push(...turn(overlay.points[i], overlay.points[i + 1]));
      return { ...overlay, points };
    }
    case "highlight": case "rect": case "ellipse": {
      const [ax, ay] = turn(overlay.x, overlay.y); const [bx, by] = turn(overlay.x + overlay.w, overlay.y + overlay.h);
      return { ...overlay, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    }
    case "text": {
      const size = textSize || estimateTextBox(overlay);
      const [cx, cy] = turn(overlay.x + size.width / 2, overlay.y + size.height / 2);
      return { ...overlay, x: cx - size.width / 2, y: cy - size.height / 2 };
    }
    case "image": {
      const [cx, cy] = turn(overlay.x + overlay.w / 2, overlay.y + overlay.h / 2);
      return { ...overlay, x: cx - overlay.w / 2, y: cy - overlay.h / 2 };
    }
  }
}

/** Rotates a page by ±90/180 and carries its overlays along. */
export function rotatePage(page: WorkingPage, delta: number, textSize?: (overlay: TextOverlay) => { width: number; height: number }): WorkingPage {
  const steps = (((Math.round(delta / 90)) % 4) + 4) % 4;
  let current = page;
  for (let i = 0; i < steps; i += 1) {
    const { width, height } = viewSize(current);
    current = {
      ...current,
      rotation: normalizeRotation(current.rotation + 90),
      overlays: current.overlays.map((overlay) => rotateOverlay(overlay, true, width, height, overlay.type === "text" && textSize ? textSize(overlay) : undefined)),
    };
  }
  return current;
}

/**
 * Matrix [a b c d e f] that maps view space (displayed page, origin bottom-left,
 * y up, size W×H after rotation) into the page's PDF user space, so overlays
 * drawn in view space land where they were placed regardless of /Rotate.
 * `box` is the page's crop box in user space.
 */
export function viewToUserMatrix(rotation: Rotation, box: { x: number; y: number; width: number; height: number }): [number, number, number, number, number, number] {
  const { x, y, width, height } = box;
  switch (rotation) {
    case 90: return [0, 1, -1, 0, x + width, y];
    case 180: return [-1, 0, 0, -1, x + width, y + height];
    case 270: return [0, -1, 1, 0, x, y + height];
    default: return [1, 0, 0, 1, x, y];
  }
}

export function applyMatrix(matrix: readonly number[], u: number, v: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * u + c * v + e, b * u + d * v + f];
}

/** Arrow head triangle (view space, y down) and the point where the shaft should stop. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, strokeWidth: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.max(9, strokeWidth * 4.5);
  const spread = Math.PI / 7;
  const left: [number, number] = [x2 - length * Math.cos(angle - spread), y2 - length * Math.sin(angle - spread)];
  const right: [number, number] = [x2 - length * Math.cos(angle + spread), y2 - length * Math.sin(angle + spread)];
  const base: [number, number] = [x2 - length * Math.cos(spread) * Math.cos(angle), y2 - length * Math.cos(spread) * Math.sin(angle)];
  return { left, right, base };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** True when every character can be drawn with PDF standard fonts (WinAnsi encoding). */
export function isWinAnsi(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    if (code === 10 || code === 13 || code === 9) continue;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) continue;
    if (WIN_ANSI_EXTRAS.has(char)) continue;
    return false;
  }
  return true;
}

/** Normalises typography that WinAnsi lacks (e.g. non-breaking spaces, tabs). */
export function cleanTextForPdf(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\u2000-\u200b\u202f\u205f]/g, " ").replace(/[\u2010\u2011]/g, "-");
}

/**
 * Greedy word wrap. Words longer than the line are broken by character.
 * `measure` returns the width of a string in the same unit as `maxWidth`.
 */
export function wrapText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of cleanTextForPdf(text).split("\n")) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const token of paragraph.split(/(\s+)/).filter(Boolean)) {
      if (/^\s+$/.test(token)) { if (line) line += token; continue; }
      if (measure(line + token) <= maxWidth) { line += token; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
      if (measure(token) <= maxWidth) { line = token; continue; }
      // A single word wider than the line: break it by character.
      for (const char of token) {
        if (line && measure(line + char) > maxWidth) { lines.push(line); line = char; }
        else line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
/** EXIF orientation (1-8) of a JPEG, or 1 when absent/unreadable. */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (!startsWith(bytes, [0xff, 0xd8])) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    if (marker === 0xda || marker === 0xd9) return 1;
    if (marker === 0xe1 && offset + 10 <= bytes.length && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      if (tiff + 8 > bytes.length) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > bytes.length) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

/** Pixel size of a PNG or (baseline/progressive) JPEG, or null. */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (!startsWith(bytes, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create PDF page layout
// ---------------------------------------------------------------------------
export type PageSizeId = "fit" | "a4" | "letter" | "legal";
export type Orientation = "auto" | "portrait" | "landscape";
export type MarginId = "none" | "small" | "normal";
export const PAGE_SIZES: Record<Exclude<PageSizeId, "fit">, { label: string; width: number; height: number }> = {
  a4: { label: "A4", width: 595.28, height: 841.89 },
  letter: { label: "US Letter", width: 612, height: 792 },
  legal: { label: "US Legal", width: 612, height: 1008 },
};
export const MARGINS: Record<MarginId, number> = { none: 0, small: 18, normal: 36 };

/**
 * Page size and image placement for an image page. "fit" makes the page the
 * image's own size (96 px = 72 pt); paper sizes scale the image to fit inside
 * the margins and centre it.
 */
export function layoutImagePage(imageWidth: number, imageHeight: number, size: PageSizeId, orientation: Orientation, margin: MarginId) {
  const natural = { width: imageWidth * 0.75, height: imageHeight * 0.75 };
  const pad = MARGINS[margin];
  if (size === "fit") {
    const scale = Math.min(1, 14400 / Math.max(natural.width + pad * 2, natural.height + pad * 2));
    const width = natural.width * scale; const height = natural.height * scale;
    return { pageWidth: width + pad * 2, pageHeight: height + pad * 2, x: pad, y: pad, width, height };
  }
  const paper = PAGE_SIZES[size];
  const landscape = orientation === "landscape" || (orientation === "auto" && imageWidth > imageHeight);
  const pageWidth = landscape ? paper.height : paper.width;
  const pageHeight = landscape ? paper.width : paper.height;
  const boxW = pageWidth - pad * 2; const boxH = pageHeight - pad * 2;
  const scale = Math.min(boxW / natural.width, boxH / natural.height);
  const width = natural.width * scale; const height = natural.height * scale;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export function textPageSize(size: PageSizeId, orientation: Orientation): { width: number; height: number } {
  const paper = PAGE_SIZES[size === "fit" ? "a4" : size];
  return orientation === "landscape" ? { width: paper.height, height: paper.width } : { width: paper.width, height: paper.height };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export interface History<T> { past: T[]; present: T; future: T[] }

export function pushHistory<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  const past = [...history.past, history.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}
export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}
export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

// ---------------------------------------------------------------------------
// Minimal ZIP (stored, no compression) for multi-page image export
// ---------------------------------------------------------------------------
let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a ZIP archive (STORE method — images are already compressed). */
export function buildZip(files: { name: string; bytes: Uint8Array }[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = []; const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, file.bytes.length, true); lv.setUint32(22, file.bytes.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length); const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, file.bytes.length, true); cv.setUint32(24, file.bytes.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); central.set(name, 46);
    locals.push(local, file.bytes); centrals.push(central);
    offset += local.length + file.bytes.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) { output.set(part, cursor); cursor += part.length; }
  return output;
}

let idCounter = 0;
export function makeId(prefix = "id"): string {
  idCounter += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}-${idCounter.toString(36)}`;
}

export const OVERLAY_COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff"];
export const HIGHLIGHT_COLORS = ["#fde047", "#86efac", "#7dd3fc", "#f9a8d4", "#fdba74"];

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match ? parseInt(match[1], 16) : 0;
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}
