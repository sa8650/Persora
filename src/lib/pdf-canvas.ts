// Persora PDF Studio — browser-only canvas helpers: preparing images for
// pdf-lib, measuring/rasterising text with the device's fonts, and drawing
// overlays onto rendered pages (image export and previews).

import {
  IMAGE_MAX_BYTES, PdfProcessingError, TEXT_ASCENT, arrowHead, TEXT_LINE_HEIGHT, WATERMARK_FONTS, cleanTextForPdf, readImageSize, readJpegOrientation, sniffFileKind, watermarkIsEmpty,
  watermarkItemSize, watermarkPlacements, wrapText,
  type InputKind, type Overlay, type TextOverlay, type TextWatermark, type Watermark,
} from "./pdf-studio";
import { WATERMARK_RASTER_SIZE, watermarkTextWidthAt1pt, type PreparedImage, type TextPageImage, type WatermarkRaster } from "./pdf-engine";

/** Same family the SVG overlay layer uses, close to PDF Helvetica. */
export const OVERLAY_FONT_FAMILY = "Helvetica, Arial, \"Noto Sans\", \"Nirmala UI\", \"Noto Sans Bengali\", sans-serif";
const MAX_IMAGE_PIXELS = 36_000_000;

let measureContext: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  return measureContext;
}

const fontString = (size: number, bold: boolean) => `${bold ? "700" : "400"} ${size}px ${OVERLAY_FONT_FAMILY}`;

/** Text box of a text overlay in points (canvas px at the same size = points). */
export function measureTextOverlay(overlay: Pick<TextOverlay, "text" | "fontSize" | "bold">): { width: number; height: number } {
  const context = measurer();
  const lines = overlay.text.split("\n");
  if (!context) return { width: Math.max(...lines.map((line) => line.length)) * overlay.fontSize * 0.55, height: lines.length * overlay.fontSize * TEXT_LINE_HEIGHT };
  context.font = fontString(overlay.fontSize, overlay.bold);
  const width = Math.max(overlay.fontSize * 0.6, ...lines.map((line) => context.measureText(line).width));
  return { width: Math.ceil(width + 1), height: lines.length * overlay.fontSize * TEXT_LINE_HEIGHT };
}

export function canvasToBytes(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality = 0.92): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new PdfProcessingError("Your browser couldn't encode the image. Try a smaller page or resolution.")); return; }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, type, quality);
  });
}

export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  canvas.width = 0; canvas.height = 0;
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turns an image file into something pdf-lib embeds directly. JPEG and PNG are
 * kept byte-for-byte (no quality loss) unless the JPEG carries an EXIF rotation;
 * WebP, GIF (first frame) and BMP are converted on this device.
 */
export async function prepareImage(bytes: Uint8Array, name: string, kind?: InputKind): Promise<PreparedImage> {
  if (bytes.byteLength > IMAGE_MAX_BYTES) throw new PdfProcessingError(`“${name}” is larger than ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)} MB.`);
  const type = kind || sniffFileKind(bytes.subarray(0, 64), name);
  if (type === "jpeg" && readJpegOrientation(bytes) === 1) {
    const size = readImageSize(bytes);
    if (size && size.width > 0 && size.height > 0) return { bytes, mime: "image/jpeg", width: size.width, height: size.height };
  }
  if (type === "png") {
    const size = readImageSize(bytes);
    if (size && size.width > 0 && size.height > 0 && size.width * size.height <= MAX_IMAGE_PIXELS) return { bytes, mime: "image/png", width: size.width, height: size.height };
  }
  if (!["jpeg", "png", "webp", "gif", "bmp"].includes(type)) throw new PdfProcessingError(`“${name}” isn't an image PDF Studio can use.`);
  let source: ImageBitmap | HTMLImageElement;
  try { source = await decodeBitmap(new Blob([bytes as BlobPart])); }
  catch { throw new PdfProcessingError(`“${name}” couldn't be decoded. It may be damaged or in an unsupported variant.`); }
  const naturalWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
  const naturalHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / Math.max(1, naturalWidth * naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new PdfProcessingError("Your browser couldn't prepare the image.");
  const opaque = type === "jpeg" || type === "bmp";
  if (opaque) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  try {
    const mime = opaque ? "image/jpeg" : "image/png";
    return { bytes: await canvasToBytes(canvas, mime, 0.92), mime, width: canvas.width, height: canvas.height };
  } finally { releaseCanvas(canvas); }
}

/** Draws text lines on a canvas with the device's fonts (any script). */
function drawLines(context: CanvasRenderingContext2D, lines: string[], x: number, y: number, size: number, lineHeight: number, colorValue: string, bold: boolean) {
  context.font = fontString(size, bold);
  context.fillStyle = colorValue;
  context.textBaseline = "alphabetic";
  lines.forEach((line, index) => { if (line) context.fillText(line, x, y + index * lineHeight + size * TEXT_ASCENT); });
}

/** Rasterises a text overlay (for scripts PDF standard fonts can't encode). */
export async function rasterizeTextOverlay(overlay: TextOverlay): Promise<TextPageImage> {
  const box = measureTextOverlay(overlay);
  const scale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(box.width * scale));
  canvas.height = Math.max(1, Math.ceil(box.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new PdfProcessingError("Your browser couldn't draw the text.");
  context.scale(scale, scale);
  drawLines(context, overlay.text.split("\n"), 0, 0, overlay.fontSize, overlay.fontSize * TEXT_LINE_HEIGHT, overlay.color, overlay.bold);
  try { return { png: await canvasToBytes(canvas, "image/png"), width: box.width, height: box.height }; }
  finally { releaseCanvas(canvas); }
}

/** Lays out a text document on pages with the device's fonts, one PNG per page (~200 dpi). */
export async function rasterizeTextPages(text: string, title: string, page: { width: number; height: number; margin: number; fontSize: number }): Promise<TextPageImage[]> {
  const context = measurer();
  if (!context) throw new PdfProcessingError("Your browser couldn't draw the text.");
  const size = Math.max(6, Math.min(48, page.fontSize));
  const maxWidth = page.width - page.margin * 2;
  type Line = { text: string; size: number; bold: boolean; gap: number };
  const lines: Line[] = [];
  if (title.trim()) {
    context.font = fontString(size * 1.6, true);
    for (const line of wrapText(title.trim(), maxWidth, (value) => context.measureText(value).width)) lines.push({ text: line, size: size * 1.6, bold: true, gap: size * 1.6 * 1.3 });
    lines.push({ text: "", size, bold: false, gap: size * 0.8 });
  }
  context.font = fontString(size, false);
  for (const line of wrapText(text, maxWidth, (value) => context.measureText(value).width)) lines.push({ text: line, size, bold: false, gap: size * 1.45 });

  const pages: Line[][] = [[]];
  let cursor = page.margin;
  for (const line of lines) {
    if (cursor + line.gap > page.height - page.margin && pages[pages.length - 1].length) { pages.push([]); cursor = page.margin; }
    pages[pages.length - 1].push(line);
    cursor += line.gap;
  }
  const scale = 200 / 72;
  const output: TextPageImage[] = [];
  for (const pageLines of pages) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(page.width * scale); canvas.height = Math.round(page.height * scale);
    const draw = canvas.getContext("2d");
    if (!draw) throw new PdfProcessingError("Your browser couldn't draw the text.");
    draw.fillStyle = "#ffffff"; draw.fillRect(0, 0, canvas.width, canvas.height);
    draw.scale(scale, scale);
    let y = page.margin;
    for (const line of pageLines) { drawLines(draw, [line.text], page.margin, y, line.size, line.gap, "#111827", line.bold); y += line.gap; }
    output.push({ png: await canvasToBytes(canvas, "image/png"), width: page.width, height: page.height });
    releaseCanvas(canvas);
  }
  return output;
}

export type ImageSourceLookup = (imageId: string) => Promise<CanvasImageSource | null>;

// ---------------------------------------------------------------------------
// Watermark (preview, image export and thumbnails — the PDF export lives in pdf-engine)
// ---------------------------------------------------------------------------
/** Padding (fraction of the font size) around device-font watermark text, matching the raster box. */
const WATERMARK_RASTER_PAD_X = 0.1;
const WATERMARK_RASTER_HEIGHT = 1.3;

const watermarkFontString = (spec: TextWatermark, size: number) => `${WATERMARK_FONTS[spec.font].weight} ${size}px ${WATERMARK_FONTS[spec.font].css}, ${OVERLAY_FONT_FAMILY}`;

export interface WatermarkLayout {
  /** "pdf" = PDF standard font (box = text width × cap height, baseline at +height/2); "device" = device fonts, vertically centred; "image". */
  mode: "pdf" | "device" | "image";
  width: number;
  height: number;
  fontSize: number;
  text: string;
  placements: { cx: number; cy: number; angle: number }[];
}

/**
 * Size and placements of a watermark on a page in view space. Uses the same
 * metrics as exportDocument (PDF font widths, or the device-font raster box),
 * so the preview matches the downloaded file.
 */
export function layoutWatermark(spec: Watermark, page: { width: number; height: number }): WatermarkLayout | null {
  if (watermarkIsEmpty(spec)) return null;
  if (spec.kind === "image") {
    const item = watermarkItemSize(spec, page, 0);
    return { mode: "image", ...item, text: "", placements: watermarkPlacements(spec, page, item) };
  }
  const text = cleanTextForPdf(spec.text).trim();
  const pdfWidth = watermarkTextWidthAt1pt(text, spec.font);
  if (pdfWidth !== null) {
    const item = watermarkItemSize(spec, page, pdfWidth);
    return { mode: "pdf", ...item, text, placements: watermarkPlacements(spec, page, item) };
  }
  const advance = measureWatermarkAdvance(spec, text);
  const { fontSize } = watermarkItemSize(spec, page, advance / WATERMARK_RASTER_SIZE);
  const factor = fontSize / WATERMARK_RASTER_SIZE;
  const item = { width: (advance + WATERMARK_RASTER_SIZE * WATERMARK_RASTER_PAD_X * 2) * factor, height: WATERMARK_RASTER_SIZE * WATERMARK_RASTER_HEIGHT * factor };
  return { mode: "device", ...item, fontSize, text, placements: watermarkPlacements(spec, page, item) };
}

/** Text advance at WATERMARK_RASTER_SIZE px with the device's fonts. */
function measureWatermarkAdvance(spec: TextWatermark, text: string): number {
  const context = measurer();
  if (!context) return text.length * WATERMARK_RASTER_SIZE * 0.6;
  context.font = watermarkFontString(spec, WATERMARK_RASTER_SIZE);
  return Math.max(1, context.measureText(text).width);
}

/** Device-font watermark text as a PNG (export hook for text PDF standard fonts can't encode). */
export async function rasterizeWatermarkText(spec: TextWatermark): Promise<WatermarkRaster> {
  const text = cleanTextForPdf(spec.text).trim();
  const advance = measureWatermarkAdvance(spec, text);
  const width = advance + WATERMARK_RASTER_SIZE * WATERMARK_RASTER_PAD_X * 2;
  const height = WATERMARK_RASTER_SIZE * WATERMARK_RASTER_HEIGHT;
  // ~4 px per point at the reference size, capped so long text stays within canvas limits.
  const scale = Math.max(1, Math.min(4, 8192 / width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new PdfProcessingError("Your browser couldn't draw the watermark text.");
  context.scale(scale, scale);
  context.font = watermarkFontString(spec, WATERMARK_RASTER_SIZE);
  context.fillStyle = spec.color;
  context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2);
  try { return { png: await canvasToBytes(canvas, "image/png"), width, height, advance }; }
  finally { releaseCanvas(canvas); }
}

/** Draws a watermark onto a 2D context whose units are page points (view space, y down). */
export async function drawWatermarkOnCanvas(context: CanvasRenderingContext2D, spec: Watermark, page: { width: number; height: number }, lookupImage: ImageSourceLookup) {
  const layout = layoutWatermark(spec, page);
  if (!layout || !layout.placements.length) return;
  const image = spec.kind === "image" ? await lookupImage(spec.imageId) : null;
  if (spec.kind === "image" && !image) return;
  context.save();
  context.globalAlpha = spec.opacity;
  let squeeze = 1;
  if (spec.kind === "text") {
    context.font = watermarkFontString(spec, layout.fontSize);
    context.fillStyle = spec.color;
    if (layout.mode === "pdf") {
      // Fit device-font glyphs to the PDF font's width so the copy matches the PDF.
      const measured = context.measureText(layout.text).width;
      if (measured > 0) squeeze = layout.width / measured;
      context.textAlign = "left"; context.textBaseline = "alphabetic";
    } else { context.textAlign = "center"; context.textBaseline = "middle"; }
  }
  for (const placement of layout.placements) {
    context.save();
    context.translate(placement.cx, placement.cy);
    context.rotate(-placement.angle * Math.PI / 180);
    if (image) context.drawImage(image, -layout.width / 2, -layout.height / 2, layout.width, layout.height);
    else if (layout.mode === "pdf") { context.scale(squeeze, 1); context.fillText(layout.text, -layout.width / 2 / squeeze, layout.height / 2); }
    else context.fillText(layout.text, 0, 0);
    context.restore();
  }
  context.restore();
}

/** Draws overlays onto a 2D context whose units are page points (view space, y down). */
export async function drawOverlaysOnCanvas(context: CanvasRenderingContext2D, overlays: Overlay[], lookupImage: ImageSourceLookup) {
  for (const overlay of overlays) {
    context.save();
    switch (overlay.type) {
      case "text":
        drawLines(context, overlay.text.split("\n"), overlay.x, overlay.y, overlay.fontSize, overlay.fontSize * TEXT_LINE_HEIGHT, overlay.color, overlay.bold);
        break;
      case "highlight":
        context.globalAlpha = 0.4;
        context.globalCompositeOperation = "multiply";
        context.fillStyle = overlay.color;
        context.fillRect(overlay.x, overlay.y, overlay.w, overlay.h);
        break;
      case "rect": case "ellipse":
        context.beginPath();
        if (overlay.type === "rect") context.rect(overlay.x, overlay.y, overlay.w, overlay.h);
        else context.ellipse(overlay.x + overlay.w / 2, overlay.y + overlay.h / 2, Math.max(0.5, overlay.w / 2), Math.max(0.5, overlay.h / 2), 0, 0, Math.PI * 2);
        if (overlay.fill) { context.globalAlpha = 0.35; context.fillStyle = overlay.fill; context.fill(); context.globalAlpha = 1; }
        context.strokeStyle = overlay.color; context.lineWidth = overlay.strokeWidth; context.stroke();
        break;
      case "underline": case "strike":
        context.strokeStyle = overlay.color; context.lineWidth = overlay.strokeWidth; context.lineCap = "butt";
        context.beginPath(); context.moveTo(overlay.x1, overlay.y1); context.lineTo(overlay.x2, overlay.y2); context.stroke();
        break;
      case "line": case "arrow": {
        let end: [number, number] = [overlay.x2, overlay.y2];
        context.strokeStyle = overlay.color; context.fillStyle = overlay.color; context.lineWidth = overlay.strokeWidth; context.lineCap = "round";
        if (overlay.type === "arrow") {
          const head = arrowHead(overlay.x1, overlay.y1, overlay.x2, overlay.y2, overlay.strokeWidth);
          end = head.base;
          context.beginPath(); context.moveTo(overlay.x2, overlay.y2); context.lineTo(...head.left); context.lineTo(...head.right); context.closePath(); context.fill();
        }
        context.beginPath(); context.moveTo(overlay.x1, overlay.y1); context.lineTo(...end); context.stroke();
        break;
      }
      case "ink":
        if (overlay.points.length >= 4) {
          context.strokeStyle = overlay.color; context.lineWidth = overlay.strokeWidth; context.lineCap = "round"; context.lineJoin = "round";
          context.beginPath(); context.moveTo(overlay.points[0], overlay.points[1]);
          for (let i = 2; i < overlay.points.length; i += 2) context.lineTo(overlay.points[i], overlay.points[i + 1]);
          context.stroke();
        }
        break;
      case "image": {
        const image = await lookupImage(overlay.imageId);
        if (image) context.drawImage(image, overlay.x, overlay.y, overlay.w, overlay.h);
        break;
      }
    }
    context.restore();
  }
}

/** Trims fully transparent edges (signature pads, typed signatures). */
export function trimTransparent(canvas: HTMLCanvasElement, padding = 6): HTMLCanvasElement | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return null;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1 + padding * 2; out.height = maxY - minY + 1 + padding * 2;
  out.getContext("2d")?.drawImage(canvas, minX, minY, maxX - minX + 1, maxY - minY + 1, padding, padding, maxX - minX + 1, maxY - minY + 1);
  return out;
}

export function downloadBytes(bytes: Uint8Array | Blob, fileName: string, type = "application/pdf") {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
