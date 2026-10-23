// Persora PDF Studio — document assembly with pdf-lib (MIT), entirely in the
// browser. This module is only reached through dynamic import() from the
// editor / Create PDF flow, so pdf-lib never weighs on the initial app load.

import {
  BlendMode, LineCapStyle, PDFDocument, StandardFontEmbedder, StandardFonts, beginText, concatTransformationMatrix, degrees, drawImage as drawImageOperators, endText,
  popGraphicsState, pushGraphicsState, rgb, rotateAndSkewTextRadiansAndTranslate, setFillingColor, setFontAndSize, setGraphicsState, showText,
  type PDFFont, type PDFImage, type PDFPage, type PDFRef,
} from "pdf-lib";
import {
  PdfProcessingError, MARGINS, TEXT_ASCENT, arrowHead, TEXT_LINE_HEIGHT, cleanTextForPdf, hexToRgb01, isWinAnsi, layoutImagePage, normalizeRotation, normalizeWatermark, textPageSize, viewToUserMatrix,
  watermarkIsEmpty, watermarkItemSize, watermarkOnPage, watermarkPlacements, wrapText,
  type MarginId, type Orientation, type Overlay, type PageSizeId, type TextOverlay, type TextWatermark, type Watermark, type WatermarkFont, type WorkingPage,
} from "./pdf-studio";

export const PDF_PRODUCER = "Persora PDF Studio";

export { PdfProcessingError };

const color = (hex: string) => { const { r, g, b } = hexToRgb01(hex); return rgb(r, g, b); };

/** Loads a PDF for copying pages, translating pdf-lib failures into clear messages. */
export async function loadPdfForEditing(bytes: Uint8Array, name = "This PDF"): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // pdf-lib parses leniently; touching the page tree surfaces broken files now, not mid-export.
    if (doc.getPageCount() < 1) throw new PdfProcessingError(`${name} has no pages.`);
    return doc;
  } catch (error) {
    if (error instanceof PdfProcessingError) throw error;
    const kind = error instanceof Error ? error.name || error.constructor.name : "";
    const message = error instanceof Error ? error.message : "";
    if (kind === "EncryptedPDFError" || /encrypted/i.test(message)) {
      throw new PdfProcessingError(`${name} is encrypted or has editing restrictions, so it can't be edited yet. If you know the password, remove it in PDF Studio → PDF Security → Unlock PDF, then open the unlocked copy.`);
    }
    throw new PdfProcessingError(`${name} couldn't be read. It may be damaged or not a real PDF.`);
  }
}

// ---------------------------------------------------------------------------
// Create PDF
// ---------------------------------------------------------------------------
/** An image that pdf-lib can embed directly (other formats are converted to these first). */
export interface PreparedImage { bytes: Uint8Array; mime: "image/jpeg" | "image/png"; width: number; height: number }

export type BuildItem =
  | { kind: "image"; name: string; image: PreparedImage }
  | { kind: "text"; name: string; text: string; title: string }
  | { kind: "pdf"; name: string; bytes: Uint8Array };

export interface BuildOptions {
  pageSize: PageSizeId;
  orientation: Orientation;
  margin: MarginId;
  fontSize: number;
  title?: string;
}

export interface TextPageImage { png: Uint8Array; width: number; height: number }

/** Reference font size used to lay out device-font (non-Latin) watermark text. */
export const WATERMARK_RASTER_SIZE = 100;
/**
 * Device-font watermark text: `width`/`height` are the image box in points and
 * `advance` the text width, all at WATERMARK_RASTER_SIZE; the box is centred on the text.
 */
export interface WatermarkRaster extends TextPageImage { advance: number }

export interface BuildHooks {
  /**
   * Draws text that PDF standard fonts can't encode (e.g. Bengali, Arabic, CJK,
   * emoji) as page images with the system fonts. Such text looks right but is
   * not selectable — the UI says so before building.
   */
  rasterizeTextPages?: (text: string, title: string, page: { width: number; height: number; margin: number; fontSize: number }) => Promise<TextPageImage[]>;
  onProgress?: (done: number, total: number) => void;
}

const TEXT_MARGINS: Record<MarginId, number> = { none: 28, small: 42, normal: 64 };

async function embedImage(doc: PDFDocument, image: PreparedImage): Promise<PDFImage> {
  try {
    return image.mime === "image/png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  } catch {
    throw new PdfProcessingError("An image couldn't be added — it may be damaged. Try re-saving it as JPG or PNG.");
  }
}

function addTextPages(doc: PDFDocument, text: string, title: string, options: BuildOptions, fonts: { regular: PDFFont; bold: PDFFont }) {
  const page = textPageSize(options.pageSize, options.orientation);
  const margin = TEXT_MARGINS[options.margin];
  const size = Math.max(6, Math.min(48, options.fontSize));
  const lineHeight = size * 1.45;
  const maxWidth = page.width - margin * 2;
  const blocks: { text: string; font: PDFFont; size: number; gap: number }[] = [];
  if (title.trim()) {
    for (const line of wrapText(title.trim(), maxWidth, (value) => fonts.bold.widthOfTextAtSize(value, size * 1.6))) blocks.push({ text: line, font: fonts.bold, size: size * 1.6, gap: size * 1.6 * 1.3 });
    blocks.push({ text: "", font: fonts.regular, size, gap: size * 0.8 });
  }
  for (const line of wrapText(text, maxWidth, (value) => fonts.regular.widthOfTextAtSize(value, size))) blocks.push({ text: line, font: fonts.regular, size, gap: lineHeight });
  let current = doc.addPage([page.width, page.height]);
  let cursor = page.height - margin;
  for (const block of blocks) {
    if (cursor - block.gap < margin) { current = doc.addPage([page.width, page.height]); cursor = page.height - margin; }
    if (block.text) current.drawText(block.text, { x: margin, y: cursor - block.size * TEXT_ASCENT, size: block.size, font: block.font, color: rgb(0.07, 0.09, 0.15) });
    cursor -= block.gap;
  }
}

/** Builds one PDF from images, text and other PDFs, in the given order. */
export async function buildPdf(items: BuildItem[], options: BuildOptions, hooks: BuildHooks = {}): Promise<Uint8Array> {
  if (!items.length) throw new PdfProcessingError("Add at least one image, text block or PDF.");
  const doc = await PDFDocument.create();
  let fonts: { regular: PDFFont; bold: PDFFont } | null = null;
  for (const [index, item] of items.entries()) {
    if (item.kind === "image") {
      const layout = layoutImagePage(item.image.width, item.image.height, options.pageSize, options.orientation, options.margin);
      const embedded = await embedImage(doc, item.image);
      const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
      page.drawImage(embedded, { x: layout.x, y: layout.pageHeight - layout.y - layout.height, width: layout.width, height: layout.height });
    } else if (item.kind === "text") {
      const text = cleanTextForPdf(item.text);
      if (!text.trim() && !item.title.trim()) continue;
      if (isWinAnsi(text) && isWinAnsi(item.title)) {
        fonts ||= { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
        addTextPages(doc, text, item.title, options, fonts);
      } else {
        if (!hooks.rasterizeTextPages) throw new PdfProcessingError("This text uses characters that need your device's fonts. Try again in a supported browser.");
        const size = textPageSize(options.pageSize, options.orientation);
        const images = await hooks.rasterizeTextPages(text, item.title, { ...size, margin: TEXT_MARGINS[options.margin], fontSize: options.fontSize });
        for (const image of images) {
          const embedded = await embedImage(doc, { bytes: image.png, mime: "image/png", width: image.width, height: image.height });
          const page = doc.addPage([size.width, size.height]);
          page.drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height });
        }
      }
    } else {
      const source = await loadPdfForEditing(item.bytes, `“${item.name}”`);
      const copied = await doc.copyPages(source, source.getPageIndices());
      for (const page of copied) doc.addPage(page);
    }
    hooks.onProgress?.(index + 1, items.length);
  }
  if (!doc.getPageCount()) throw new PdfProcessingError("There was nothing to put in the PDF — the text blocks are empty.");
  doc.setTitle(options.title || "PDF");
  doc.setProducer(PDF_PRODUCER);
  doc.setCreator(PDF_PRODUCER);
  return doc.save({ useObjectStreams: true });
}

/** A one-page blank PDF of the given size (used by "Insert blank page"). */
export async function createBlankPdf(width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  doc.setProducer(PDF_PRODUCER);
  return doc.save();
}

// ---------------------------------------------------------------------------
// Export the working document
// ---------------------------------------------------------------------------
export interface ExportSource { id: string; name: string; bytes: Uint8Array }
export interface ExportImage { bytes: Uint8Array; mime: "image/jpeg" | "image/png" }

export interface ExportHooks {
  /** Rasterises a text overlay that PDF standard fonts can't encode. Size is in points. */
  rasterizeText?: (overlay: TextOverlay) => Promise<TextPageImage>;
  /**
   * Rasterises watermark text that PDF standard fonts can't encode, laid out
   * at WATERMARK_RASTER_SIZE pt (see WatermarkRaster).
   */
  rasterizeWatermarkText?: (spec: TextWatermark) => Promise<WatermarkRaster>;
  onProgress?: (done: number, total: number) => void;
}

export interface ExportInput {
  sources: Map<string, ExportSource>;
  pages: WorkingPage[];
  images: Map<string, ExportImage>;
  title?: string;
  /** Drawn over the original content (under annotations) on the pages it applies to. */
  watermark?: Watermark | null;
  /** Re-used across exports so large sources are parsed once per session. */
  cache?: Map<string, Promise<PDFDocument>>;
}

interface DrawContext {
  doc: PDFDocument;
  fonts: Partial<Record<"regular" | "bold" | WatermarkFont, PDFFont>>;
  images: Map<string, ExportImage>;
  embedded: Map<string, PDFImage>;
  hooks: ExportHooks;
}

async function fontFor(context: DrawContext, bold: boolean): Promise<PDFFont> {
  const key = bold ? "bold" : "regular";
  context.fonts[key] ||= await context.doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  return context.fonts[key] as PDFFont;
}

async function imageFor(context: DrawContext, imageId: string): Promise<PDFImage | null> {
  const cached = context.embedded.get(imageId);
  if (cached) return cached;
  const image = context.images.get(imageId);
  if (!image) return null;
  const embedded = image.mime === "image/png" ? await context.doc.embedPng(image.bytes) : await context.doc.embedJpg(image.bytes);
  context.embedded.set(imageId, embedded);
  return embedded;
}

async function drawOverlay(page: PDFPage, overlay: Overlay, viewHeight: number, context: DrawContext) {
  const flip = (y: number) => viewHeight - y;
  switch (overlay.type) {
    case "text": {
      const text = cleanTextForPdf(overlay.text);
      if (!text.trim()) return;
      if (isWinAnsi(text)) {
        const font = await fontFor(context, overlay.bold);
        text.split("\n").forEach((line, index) => {
          if (!line) return;
          const baseline = overlay.y + index * overlay.fontSize * TEXT_LINE_HEIGHT + overlay.fontSize * TEXT_ASCENT;
          page.drawText(line, { x: overlay.x, y: flip(baseline), size: overlay.fontSize, font, color: color(overlay.color) });
        });
        return;
      }
      if (!context.hooks.rasterizeText) return;
      const raster = await context.hooks.rasterizeText(overlay);
      const embedded = await context.doc.embedPng(raster.png);
      page.drawImage(embedded, { x: overlay.x, y: flip(overlay.y + raster.height), width: raster.width, height: raster.height });
      return;
    }
    case "highlight":
      page.drawRectangle({ x: overlay.x, y: flip(overlay.y + overlay.h), width: overlay.w, height: overlay.h, color: color(overlay.color), opacity: 0.4, blendMode: BlendMode.Multiply });
      return;
    case "rect":
      page.drawRectangle({
        x: overlay.x, y: flip(overlay.y + overlay.h), width: overlay.w, height: overlay.h,
        borderColor: color(overlay.color), borderWidth: overlay.strokeWidth,
        ...(overlay.fill ? { color: color(overlay.fill), opacity: 0.35 } : {}),
      });
      return;
    case "ellipse":
      page.drawEllipse({
        x: overlay.x + overlay.w / 2, y: flip(overlay.y + overlay.h / 2), xScale: Math.max(0.5, overlay.w / 2), yScale: Math.max(0.5, overlay.h / 2),
        borderColor: color(overlay.color), borderWidth: overlay.strokeWidth,
        ...(overlay.fill ? { color: color(overlay.fill), opacity: 0.35 } : {}),
      });
      return;
    case "line":
    case "arrow": {
      let end: [number, number] = [overlay.x2, overlay.y2];
      if (overlay.type === "arrow") {
        const head = arrowHead(overlay.x1, overlay.y1, overlay.x2, overlay.y2, overlay.strokeWidth);
        end = head.base;
        page.drawSvgPath(`M ${overlay.x2} ${overlay.y2} L ${head.left[0]} ${head.left[1]} L ${head.right[0]} ${head.right[1]} Z`, { x: 0, y: viewHeight, color: color(overlay.color), borderWidth: 0 });
      }
      page.drawLine({ start: { x: overlay.x1, y: flip(overlay.y1) }, end: { x: end[0], y: flip(end[1]) }, thickness: overlay.strokeWidth, color: color(overlay.color), lineCap: LineCapStyle.Round });
      return;
    }
    case "underline":
    case "strike":
      page.drawLine({ start: { x: overlay.x1, y: flip(overlay.y1) }, end: { x: overlay.x2, y: flip(overlay.y2) }, thickness: overlay.strokeWidth, color: color(overlay.color), lineCap: LineCapStyle.Butt });
      return;
    case "ink": {
      if (overlay.points.length < 4) return;
      let path = `M ${overlay.points[0]} ${overlay.points[1]}`;
      for (let i = 2; i < overlay.points.length; i += 2) path += ` L ${overlay.points[i]} ${overlay.points[i + 1]}`;
      page.drawSvgPath(path, { x: 0, y: viewHeight, borderColor: color(overlay.color), borderWidth: overlay.strokeWidth, borderLineCap: LineCapStyle.Round });
      return;
    }
    case "image": {
      const embedded = await imageFor(context, overlay.imageId);
      if (embedded) page.drawImage(embedded, { x: overlay.x, y: flip(overlay.y + overlay.h), width: overlay.w, height: overlay.h });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------
const WATERMARK_PDF_FONTS: Record<WatermarkFont, StandardFonts> = {
  helvetica: StandardFonts.Helvetica, "helvetica-bold": StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman, "times-bold": StandardFonts.TimesRomanBold,
  courier: StandardFonts.Courier, "courier-bold": StandardFonts.CourierBold,
};

/**
 * Width of watermark text at 1 pt in its PDF standard font, or null when the
 * text needs device fonts (non-Latin) — the preview then measures with canvas.
 * Uses the same font metrics as the export, so preview and PDF line up.
 */
export function watermarkTextWidthAt1pt(text: string, font: WatermarkFont): number | null {
  const clean = cleanTextForPdf(text).trim();
  if (!clean || !isWinAnsi(clean)) return null;
  return StandardFontEmbedder.for(WATERMARK_PDF_FONTS[font] as never).widthOfTextAtSize(clean, 1);
}

/** Bottom-left origin (PDF space, y up) that puts a w×h box rotated by `angle` around its centre at (cx, cy). */
function rotatedOrigin(cx: number, cy: number, width: number, height: number, angle: number): [number, number] {
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians); const sin = Math.sin(radians);
  const dx = -width / 2; const dy = -height / 2;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

interface WatermarkResources { opacity?: PDFRef; font?: PDFFont; image?: PDFImage; raster?: { image: PDFImage; data: WatermarkRaster }; text?: string }

/** Embeds what the watermark needs once per document (font or image and one transparency state). */
async function prepareWatermark(spec: Watermark, context: DrawContext, cache: Map<string, WatermarkResources>): Promise<WatermarkResources | null> {
  const cached = cache.get("wm");
  if (cached) return cached;
  const opacity = context.doc.context.register(context.doc.context.obj({ Type: "ExtGState", ca: spec.opacity, CA: spec.opacity }));
  let resources: WatermarkResources | null = null;
  if (spec.kind === "image") {
    const image = await imageFor(context, spec.imageId);
    if (!image) throw new PdfProcessingError("The watermark image is missing. Choose it again.");
    resources = { opacity, image };
  } else {
    const text = cleanTextForPdf(spec.text).trim();
    if (isWinAnsi(text)) {
      context.fonts[spec.font] ||= await context.doc.embedFont(WATERMARK_PDF_FONTS[spec.font]);
      resources = { opacity, font: context.fonts[spec.font], text };
    } else {
      // Non-Latin text: drawn with the device's fonts as an image (looks right, not selectable).
      if (!context.hooks.rasterizeWatermarkText) throw new PdfProcessingError("This watermark text needs your device's fonts. Try again in a supported browser.");
      const data = await context.hooks.rasterizeWatermarkText(spec);
      resources = { opacity, raster: { image: await context.doc.embedPng(data.png), data } };
    }
  }
  cache.set("wm", resources);
  return resources;
}

/** Draws every copy of the watermark on a page (inside the view-space transform set up by exportDocument). */
async function drawWatermark(page: PDFPage, spec: Watermark, view: { width: number; height: number }, context: DrawContext, cache: Map<string, WatermarkResources>) {
  const resources = await prepareWatermark(spec, context, cache);
  if (!resources?.opacity) return;
  const gs = page.node.newExtGState("PersoraWm", resources.opacity);
  const flipY = (y: number) => view.height - y;
  if (resources.font && resources.text) {
    const font = resources.font;
    const item = watermarkItemSize(spec, view, font.widthOfTextAtSize(resources.text, 1));
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const encoded = font.encodeText(resources.text);
    // One text object for every copy on the page keeps tiled watermarks compact.
    const operators = [pushGraphicsState(), setGraphicsState(gs), beginText(), setFillingColor(color((spec as TextWatermark).color)), setFontAndSize(fontKey, item.fontSize)];
    for (const placement of watermarkPlacements(spec, view, item)) {
      const [x, y] = rotatedOrigin(placement.cx, flipY(placement.cy), item.width, item.height, placement.angle);
      const radians = placement.angle * Math.PI / 180;
      operators.push(rotateAndSkewTextRadiansAndTranslate(radians, 0, 0, x, y), showText(encoded));
    }
    page.pushOperators(...operators, endText(), popGraphicsState());
    return;
  }
  let item: { width: number; height: number };
  let image: PDFImage;
  if (resources.raster) {
    const { data } = resources.raster;
    const { fontSize } = watermarkItemSize(spec, view, data.advance / WATERMARK_RASTER_SIZE);
    const factor = fontSize / WATERMARK_RASTER_SIZE;
    item = { width: data.width * factor, height: data.height * factor };
    image = resources.raster.image;
  } else if (resources.image) {
    item = watermarkItemSize(spec, view, 0);
    image = resources.image;
  } else return;
  const name = page.node.newXObject("PersoraWmImage", image.ref);
  const operators = [pushGraphicsState(), setGraphicsState(gs)];
  for (const placement of watermarkPlacements(spec, view, item)) {
    const [x, y] = rotatedOrigin(placement.cx, flipY(placement.cy), item.width, item.height, placement.angle);
    operators.push(...drawImageOperators(name, { x, y, width: item.width, height: item.height, rotate: degrees(placement.angle), xSkew: degrees(0), ySkew: degrees(0) }));
  }
  page.pushOperators(...operators, popGraphicsState());
}

/**
 * Writes the working document (page order, rotations, removed/duplicated pages
 * and overlays) into a brand-new PDF. Original page content is copied
 * untouched; overlays are drawn on top inside their own graphics state.
 */
export async function exportDocument(input: ExportInput, hooks: ExportHooks = {}): Promise<Uint8Array> {
  if (!input.pages.length) throw new PdfProcessingError("The document has no pages.");
  const cache = input.cache || new Map<string, Promise<PDFDocument>>();
  const loadSource = (id: string) => {
    let pending = cache.get(id);
    if (!pending) {
      const source = input.sources.get(id);
      if (!source) throw new PdfProcessingError("A page's original file is no longer available. Reopen the document and try again.");
      pending = loadPdfForEditing(source.bytes, `“${source.name}”`);
      pending.catch(() => cache.delete(id));
      cache.set(id, pending);
    }
    return pending;
  };

  const out = await PDFDocument.create();
  // Copy every needed page once per occurrence (duplicates get their own copy), grouped by source.
  const bySource = new Map<string, number[]>();
  input.pages.forEach((page, position) => { const list = bySource.get(page.sourceId) || []; list.push(position); bySource.set(page.sourceId, list); });
  const copies: PDFPage[] = new Array(input.pages.length);
  for (const [sourceId, positions] of bySource) {
    const source = await loadSource(sourceId);
    const count = source.getPageCount();
    const indexes = positions.map((position) => input.pages[position].sourceIndex);
    if (indexes.some((index) => index < 0 || index >= count)) throw new PdfProcessingError("A page couldn't be found in its original file.");
    const copied = await out.copyPages(source, indexes);
    positions.forEach((position, i) => { copies[position] = copied[i]; });
  }

  const context: DrawContext = { doc: out, fonts: {}, images: input.images, embedded: new Map(), hooks };
  const watermark = input.watermark && !watermarkIsEmpty(input.watermark) ? normalizeWatermark(input.watermark) : null;
  const watermarkCache = new Map<string, WatermarkResources>();
  for (const [position, working] of input.pages.entries()) {
    const page = out.addPage(copies[position]);
    const rotation = normalizeRotation(page.getRotation().angle + working.rotation);
    page.setRotation(degrees(rotation));
    const marked = watermark && watermarkOnPage(watermark, working.id) ? watermark : null;
    if (working.overlays.length || marked) {
      // Isolate the original content so its graphics state can't leak into the overlays.
      const start = out.context.register(out.context.contentStream([pushGraphicsState()]));
      const end = out.context.register(out.context.contentStream([popGraphicsState()]));
      page.node.wrapContentStreams(start, end);
      const box = page.getCropBox();
      const viewHeight = rotation % 180 === 0 ? box.height : box.width;
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...viewToUserMatrix(rotation, box)));
      // Watermark first, so annotations stay on top of it.
      if (marked) await drawWatermark(page, marked, { width: rotation % 180 === 0 ? box.width : box.height, height: viewHeight }, context, watermarkCache);
      for (const overlay of working.overlays) await drawOverlay(page, overlay, viewHeight, context);
      page.pushOperators(popGraphicsState());
    }
    hooks.onProgress?.(position + 1, input.pages.length);
  }
  out.setTitle(input.title || "PDF");
  out.setProducer(PDF_PRODUCER);
  out.setCreator(PDF_PRODUCER);
  out.setModificationDate(new Date());
  return out.save({ useObjectStreams: true });
}

/** Page margins used by Create PDF, re-exported for the UI. */
export { MARGINS };
