// Photo Studio — on-device background removal (fallback path).
//
// Model:   MODNet portrait matting, ONNX export "Xenova/modnet" (Apache-2.0).
// Runtime: ONNX Runtime Web — WebGPU when the browser exposes a GPU adapter,
//          otherwise WebAssembly (CPU). Loaded lazily, only when needed.
// Privacy: the photo never leaves the browser. The only network requests are
//          downloads of the model weights and runtime files (no image data);
//          weights are kept in the Cache API so they're fetched once.
// Hosts are configurable for self-hosting via VITE_PHOTO_STUDIO_MODEL_URL and
// VITE_PHOTO_STUDIO_ORT_WASM_BASE.
import type * as Ort from "onnxruntime-web";
import { createCanvas, releaseCanvas } from "./photo-studio-render";

const ORT_VERSION = "1.30.0";
export const LOCAL_MODEL_NAME = "MODNet portrait matting (Apache-2.0)";
const MODEL_URL = (import.meta.env.VITE_PHOTO_STUDIO_MODEL_URL as string | undefined) || "https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx";
const ORT_WASM_BASE = (import.meta.env.VITE_PHOTO_STUDIO_ORT_WASM_BASE as string | undefined) || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_CACHE = "persora-photo-studio-models-v1";
const DOWNLOAD_TIMEOUT_MS = 180_000;
const INFERENCE_TIMEOUT_MS = 90_000;

export type LocalRuntime = "webgpu" | "wasm";
export interface LocalProgress { phase: "download" | "initialize" | "inference"; loaded?: number; total?: number; runtime?: LocalRuntime }

interface LoadedModel { ort: typeof Ort; session: Ort.InferenceSession; runtime: LocalRuntime }
let modelPromise: Promise<LoadedModel> | null = null;

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

async function downloadModel(onProgress: (progress: LocalProgress) => void): Promise<Uint8Array> {
  const cache = typeof caches !== "undefined" ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  const cached = cache ? await cache.match(MODEL_URL).catch(() => undefined) : undefined;
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(MODEL_URL, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok || !response.body) throw new Error(`The on-device model couldn't be downloaded (${response.status}).`);
    const total = Number(response.headers.get("content-length") || 0) || undefined;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress({ phase: "download", loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (cache) await cache.put(MODEL_URL, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => { /* cache is best-effort */ });
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Downloading the on-device model timed out. Check your connection and retry.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadModel(onProgress: (progress: LocalProgress) => void): Promise<LoadedModel> {
  const [ort, bytes] = await Promise.all([import("onnxruntime-web/webgpu"), downloadModel(onProgress)]);
  ort.env.wasm.wasmPaths = ORT_WASM_BASE;
  ort.env.wasm.numThreads = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.logLevel = "error";
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        onProgress({ phase: "initialize", runtime: "webgpu" });
        const session = await timeout(ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }), 60_000, "WebGPU initialisation timed out.");
        return { ort, session, runtime: "webgpu" };
      }
    } catch (error) {
      console.warn("Photo Studio: WebGPU unavailable, using WebAssembly.", error instanceof Error ? error.message : error);
    }
  }
  onProgress({ phase: "initialize", runtime: "wasm" });
  const session = await timeout(ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), 60_000, "The on-device model took too long to start.");
  return { ort, session, runtime: "wasm" };
}

/** Loads (once) and returns the cached model; a failed load can be retried. */
function getModel(onProgress: (progress: LocalProgress) => void): Promise<LoadedModel> {
  if (!modelPromise) {
    modelPromise = loadModel(onProgress).catch((error) => { modelPromise = null; throw error; });
  }
  return modelPromise;
}

/** MODNet input size: shortest edge 512, both sides multiples of 32, long edge ≤ 1024. */
export function modnetInputSize(width: number, height: number): { width: number; height: number } {
  let scale = 512 / Math.min(width, height);
  if (Math.max(width, height) * scale > 1024) scale = 1024 / Math.max(width, height);
  return { width: Math.max(32, Math.round((width * scale) / 32) * 32), height: Math.max(32, Math.round((height * scale) / 32) * 32) };
}

/**
 * Runs the on-device matting model and returns an alpha-mask canvas (mask in
 * the alpha channel) at the model resolution, plus the runtime used.
 */
export async function runLocalMatting(source: HTMLCanvasElement, onProgress: (progress: LocalProgress) => void): Promise<{ mask: HTMLCanvasElement; runtime: LocalRuntime }> {
  const { ort, session, runtime } = await getModel(onProgress);
  onProgress({ phase: "inference", runtime });
  const size = modnetInputSize(source.width, source.height);
  const input = createCanvas(size.width, size.height);
  const ictx = input.getContext("2d", { willReadFrequently: true });
  if (!ictx) throw new Error("Canvas is unavailable in this browser.");
  ictx.imageSmoothingQuality = "high";
  ictx.drawImage(source, 0, 0, size.width, size.height);
  const rgba = ictx.getImageData(0, 0, size.width, size.height).data;
  releaseCanvas(input);
  const plane = size.width * size.height;
  const tensorData = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    tensorData[i] = (rgba[i * 4] / 255 - 0.5) / 0.5;
    tensorData[plane + i] = (rgba[i * 4 + 1] / 255 - 0.5) / 0.5;
    tensorData[plane * 2 + i] = (rgba[i * 4 + 2] / 255 - 0.5) / 0.5;
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", tensorData, [1, 3, size.height, size.width]) };
  const results = await timeout(session.run(feeds), INFERENCE_TIMEOUT_MS, "On-device background removal took too long.");
  const output = results[session.outputNames[0]];
  const values = output.data as Float32Array;
  if (!values || values.length < plane) throw new Error("The on-device model returned no mask.");
  const mask = createCanvas(size.width, size.height);
  const mctx = mask.getContext("2d");
  if (!mctx) throw new Error("Canvas is unavailable in this browser.");
  const maskPixels = mctx.createImageData(size.width, size.height);
  for (let i = 0; i < plane; i += 1) maskPixels.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, values[i])) * 255);
  mctx.putImageData(maskPixels, 0, 0);
  for (const value of Object.values(results)) (value as { dispose?: () => void }).dispose?.();
  return { mask, runtime };
}
