// Photo Studio — browser canvas pipeline. Every basic edit (crop, zoom, pan,
// rotate, straighten, flip, resize, adjustments, background colour) runs here,
// locally, on in-memory canvases. Nothing is uploaded by this module.
import { withImageDpi } from "../../cloudflare/photo-metadata.js";
import { applyAdjustments, coverScale, isNeutral, type Adjustments, type PhotoUnit } from "./photo-studio";
import { decontaminateEdges, stretchAlpha } from "./photo-matte";

/** Longest edge kept for the in-memory working copy (ample for official photos). */
export const WORKING_MAX_EDGE = 3000;

export type BackgroundMode = "original" | "color" | "transparent";
export type OutputFormat = "image/jpeg" | "image/png";

export interface EditState {
  presetId: string;
  width: number;
  height: number;
  unit: PhotoUnit;
  dpi: number;
  zoom: number;
  /** Pan offsets as a fraction of the output frame (resolution independent). */
  offsetX: number;
  offsetY: number;
  /** Fine straighten angle in degrees (−45…45). */
  rotation: number;
  quarterTurns: number;
  flipH: boolean;
  flipV: boolean;
  adjustments: Adjustments;
  background: BackgroundMode;
  backgroundColor: string;
  format: OutputFormat;
  quality: number;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement, willRead = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", willRead ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("This browser can't edit images (canvas unavailable).");
  return ctx;
}

/** Decodes an image blob (EXIF orientation applied by the browser). */
export async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error("This image couldn't be opened. Choose a JPEG, PNG or WebP photo."); }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("This image has no readable pixels.");
    return image;
  } finally {
    // The decoded pixels stay on the element; the blob URL isn't needed afterwards.
    URL.revokeObjectURL(url);
  }
}

/** Draws a decoded image into a working canvas, downscaled to WORKING_MAX_EDGE. */
export function toWorkingCanvas(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }): HTMLCanvasElement {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, WORKING_MAX_EDGE / Math.max(width, height));
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Releases canvas backing memory promptly (browsers otherwise wait for GC). */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

/**
 * Renders the composed photo at `outW × outH` into `target`: the subject layer
 * (cut-out when available) is transformed and adjusted on its own, then laid
 * over the chosen background so a solid colour stays exactly that colour.
 */
export function renderComposite(target: HTMLCanvasElement, source: HTMLCanvasElement, cutout: HTMLCanvasElement | null, state: EditState, outW: number, outH: number): void {
  if (target.width !== outW) target.width = outW;
  if (target.height !== outH) target.height = outH;
  const subject = state.background !== "original" && cutout ? cutout : source;
  const layer = createCanvas(outW, outH);
  const lctx = context2d(layer, !isNeutral(state.adjustments));
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = "high";
  const totalRotation = ((state.quarterTurns % 4) * 90) + state.rotation;
  const scale = coverScale(subject.width, subject.height, outW, outH, totalRotation) * state.zoom;
  lctx.translate(outW / 2 + state.offsetX * outW, outH / 2 + state.offsetY * outH);
  lctx.rotate((totalRotation * Math.PI) / 180);
  lctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  const drawW = subject.width * scale;
  const drawH = subject.height * scale;
  lctx.drawImage(subject, -drawW / 2, -drawH / 2, drawW, drawH);
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!isNeutral(state.adjustments)) {
    const pixels = lctx.getImageData(0, 0, outW, outH);
    applyAdjustments(pixels.data, outW, outH, state.adjustments);
    lctx.putImageData(pixels, 0, 0);
  }

  const ctx = context2d(target);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, outW, outH);
  const transparent = state.background === "transparent" && state.format === "image/png";
  if (!transparent) {
    ctx.fillStyle = state.background === "original" ? "#ffffff" : state.backgroundColor;
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.drawImage(layer, 0, 0);
  releaseCanvas(layer);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The edited photo couldn't be encoded.")), type, quality);
  });
}

/** Renders the final output and encodes it with the chosen DPI embedded. */
export async function exportPhoto(source: HTMLCanvasElement, cutout: HTMLCanvasElement | null, state: EditState, outW: number, outH: number): Promise<{ blob: Blob; width: number; height: number; mime: OutputFormat }> {
  const canvas = createCanvas(outW, outH);
  try {
    renderComposite(canvas, source, cutout, state, outW, outH);
    const encoded = await canvasBlob(canvas, state.format, state.quality);
    const bytes = withImageDpi(new Uint8Array(await encoded.arrayBuffer()), state.dpi);
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: state.format }), width: outW, height: outH, mime: state.format };
  } finally {
    releaseCanvas(canvas);
  }
}

/** Applies an alpha mask (any size; alpha channel is used) to the source. */
export function applyMask(source: HTMLCanvasElement, mask: CanvasImageSource): HTMLCanvasElement {
  const cutout = createCanvas(source.width, source.height);
  const ctx = context2d(cutout);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mask, 0, 0, cutout.width, cutout.height);
  ctx.globalCompositeOperation = "source-over";
  return cutout;
}

/**
 * Builds the final cut-out from the untouched source and a mask (any size;
 * its alpha channel is stretched over the source). The matte is cleaned up
 * and edge colours are decontaminated so a new background shows no halo.
 */
export function buildCutout(source: HTMLCanvasElement, mask: CanvasImageSource): HTMLCanvasElement {
  const { width, height } = source;
  const maskLayer = createCanvas(width, height);
  const mctx = context2d(maskLayer, true);
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(mask, 0, 0, width, height);
  const maskPixels = mctx.getImageData(0, 0, width, height).data;
  releaseCanvas(maskLayer);
  const raw = new Uint8ClampedArray(width * height);
  for (let index = 0; index < raw.length; index += 1) raw[index] = maskPixels[index * 4 + 3];
  const alpha = stretchAlpha(raw);
  const sctx = context2d(source, true);
  const original = sctx.getImageData(0, 0, width, height).data;
  const refined = decontaminateEdges(original, alpha, width, height);
  const cutout = createCanvas(width, height);
  const cctx = context2d(cutout);
  const image = cctx.createImageData(width, height);
  image.data.set(refined);
  cctx.putImageData(image, 0, 0);
  return cutout;
}

/** Reads RGBA pixels of a (downscaled) canvas copy for quick analysis. */
export function sampleRgba(canvas: HTMLCanvasElement, maxEdge = 256): Uint8ClampedArray {
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  const sample = createCanvas(canvas.width * scale, canvas.height * scale);
  const ctx = context2d(sample, true);
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  releaseCanvas(sample);
  return data;
}

/** Encodes a working canvas for the cloud background service (JPEG, ≤2048px). */
export async function encodeForCloud(source: HTMLCanvasElement): Promise<Blob> {
  const scale = Math.min(1, 2048 / Math.max(source.width, source.height));
  const canvas = scale < 1 ? createCanvas(source.width * scale, source.height * scale) : source;
  if (canvas !== source) {
    const ctx = context2d(canvas);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  try { return await canvasBlob(canvas, "image/jpeg", 0.92); }
  finally { if (canvas !== source) releaseCanvas(canvas); }
}
