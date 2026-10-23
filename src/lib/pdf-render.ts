// Persora PDF Studio — viewing with PDF.js (Apache-2.0). Loaded lazily (library
// and worker) the first time a PDF is opened; support files (CMaps, standard
// fonts, image decoders) come from the app's own origin and only when needed.

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { PdfProcessingError, normalizeRotation, type Rotation, type TextRun } from "./pdf-studio";

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
const ASSET_BASE = import.meta.env.VITE_PDFJS_ASSET_BASE || "/pdfjs/";

export function loadPdfJs(): Promise<PdfJs> {
  pdfjs ||= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  }).catch((error) => {
    pdfjs = null;
    throw error instanceof Error && /fetch|import|load/i.test(error.message)
      ? new PdfProcessingError("The PDF viewer couldn't load. Check your connection and try again.")
      : error;
  });
  return pdfjs;
}

export interface PageInfo { width: number; height: number; rotation: Rotation }

/**
 * Opens a PDF for viewing. A copy of the bytes is handed to the worker (PDF.js
 * transfers and detaches the buffer it receives), so the caller keeps its own.
 */
export async function openPdf(bytes: Uint8Array, name = "This PDF"): Promise<PDFDocumentProxy> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({
    data: bytes.slice(),
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    enableXfa: false,
    stopAtErrors: false,
  });
  try {
    return await task.promise;
  } catch (error) {
    void task.destroy();
    const kind = error instanceof Error ? error.name : "";
    if (kind === "PasswordException") throw new PdfProcessingError(`${name} is password-protected. Remove the password in the app that created it, then open it again.`);
    if (kind === "InvalidPDFException") throw new PdfProcessingError(`${name} isn't a valid PDF or is damaged.`);
    throw new PdfProcessingError(`${name} couldn't be opened${error instanceof Error && error.message ? ` (${error.message})` : ""}.`);
  }
}

/** Reads every page's size and stored rotation (in small parallel batches). */
export async function readPageInfo(doc: PDFDocumentProxy, onProgress?: (done: number, total: number) => void): Promise<PageInfo[]> {
  const total = doc.numPages;
  const result: PageInfo[] = new Array(total);
  const batch = 16;
  for (let start = 0; start < total; start += batch) {
    await Promise.all(Array.from({ length: Math.min(batch, total - start) }, async (_, offset) => {
      const index = start + offset;
      const page = await doc.getPage(index + 1);
      const [x1, y1, x2, y2] = page.view;
      result[index] = { width: Math.abs(x2 - x1) || 612, height: Math.abs(y2 - y1) || 792, rotation: normalizeRotation(page.rotate) };
    }));
    onProgress?.(Math.min(total, start + batch), total);
  }
  return result;
}

/**
 * Renders a page into `canvas` at `scale` (CSS px per point × device pixels)
 * with `extraRotation` on top of the page's own rotation. White background.
 */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, extraRotation: number): RenderTask {
  const viewport = page.getViewport({ scale, rotation: normalizeRotation(page.rotate + extraRotation) });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (context) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
  return page.render({ canvas, canvasContext: context || undefined, viewport, background: "#ffffff" });
}

export function isRenderCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === "RenderingCancelledException" || /cancel/i.test(error.message));
}

/** Renders a page off-screen and returns the canvas (caller releases it). */
export async function renderPageToCanvas(page: PDFPageProxy, scale: number, extraRotation: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  await renderPage(page, canvas, scale, extraRotation).promise;
  return canvas;
}

/** Concurrency-limited queue so thumbnails never swamp the PDF.js worker. */
export function createRenderQueue(concurrency = 2) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => { if (active < concurrency && waiting.length) { active += 1; waiting.shift()?.(); } };
  return function enqueue<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        if (signal?.aborted) { active -= 1; next(); reject(new DOMException("Cancelled", "AbortError")); return; }
        job().then(resolve, reject).finally(() => { active -= 1; next(); });
      };
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      waiting.push(run);
      next();
    });
  };
}

/**
 * Renders page 1 of a finished PDF as a small JPEG data URL for the library
 * card (≤ ~60k characters), so the library never parses PDFs to show cards.
 */
export async function renderThumbnailDataUrl(bytes: Uint8Array): Promise<string | null> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await openPdf(bytes);
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    for (const [width, quality] of [[240, 0.74], [200, 0.62], [160, 0.5]] as const) {
      const canvas = await renderPageToCanvas(page, width / Math.max(base.width, base.height * 0.75), 0);
      const url = canvas.toDataURL("image/jpeg", quality);
      canvas.width = 0; canvas.height = 0;
      if (url.startsWith("data:image/jpeg;base64,") && url.length <= 58_000) return url;
    }
    return null;
  } catch {
    return null;
  } finally {
    void doc?.destroy();
  }
}

/**
 * Horizontal text runs on a page in view space (points, y down, after the
 * page's own rotation plus `extraRotation`), used to snap underline and
 * strike-through to real text lines. Pages without a text layer (scans)
 * return an empty list and the markup falls back to the dragged box.
 */
export async function readTextRuns(page: PDFPageProxy, extraRotation: number): Promise<TextRun[]> {
  const lib = await loadPdfJs();
  const viewport = page.getViewport({ scale: 1, rotation: normalizeRotation(page.rotate + extraRotation) });
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim() || !(item.width > 0)) continue;
    const tx = lib.Util.transform(viewport.transform, item.transform);
    // Only (nearly) horizontal, left-to-right text in the current view.
    if (tx[0] <= 0 || Math.abs(Math.atan2(tx[1], tx[0])) > 2 * Math.PI / 180) continue;
    const size = Math.hypot(tx[2], tx[3]);
    if (!(size > 0.5)) continue;
    // item.width is already in points along the text direction; scale 1 keeps it unchanged.
    runs.push({ x: tx[4], baseline: tx[5], width: item.width, size });
  }
  return runs;
}
