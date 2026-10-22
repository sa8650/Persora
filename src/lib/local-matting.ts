// Photo Studio — on-device background removal (fallback path, or chosen by the
// member with "Remove again → On this device").
//
// Model:   ORMBG — "Open Remove Background Model", an ISNet-based portrait /
//          person segmentation model by schirrmacher, Apache-2.0. ONNX exports
//          from "onnx-community/ormbg-ONNX" (Apache-2.0):
//            * WebGPU:       onnx/model_fp16.onnx      (~88 MB, needs shader-f16)
//            * WebAssembly:  onnx/model_quantized.onnx (~44 MB, int8, CPU)
//          Input 1×3×1024×1024 RGB scaled to 0…1 ("pixel_values"); output
//          1×1×1024×1024 alpha ("alphas").
// Runtime: ONNX Runtime Web. WebGPU is used when the browser exposes an adapter
//          with fp16 shaders; if WebGPU can't start, throws, or returns an
//          invalid mask, the WebAssembly build takes over automatically.
// Privacy: the photo never leaves the browser. The only network requests are
//          downloads of the model weights and runtime files (no image data);
//          weights are kept in the Cache API so they're fetched once.
// Hosts are configurable for self-hosting via VITE_PHOTO_STUDIO_MODEL_BASE
// (a folder containing both .onnx files) and VITE_PHOTO_STUDIO_ORT_WASM_BASE.
import type * as Ort from "onnxruntime-web";
import { createCanvas, releaseCanvas } from "./photo-studio-render";

const ORT_VERSION = "1.30.0";
export const LOCAL_MODEL_NAME = "ORMBG portrait segmentation (Apache-2.0)";
const MODEL_BASE = ((import.meta.env.VITE_PHOTO_STUDIO_MODEL_BASE as string | undefined) || "https://huggingface.co/onnx-community/ormbg-ONNX/resolve/main/onnx/").replace(/\/?$/, "/");
const MODEL_FILES: Record<LocalRuntime, { file: string; label: string }> = {
  webgpu: { file: "model_fp16.onnx", label: "88 MB" },
  wasm: { file: "model_quantized.onnx", label: "44 MB" },
};
const ORT_WASM_BASE = (import.meta.env.VITE_PHOTO_STUDIO_ORT_WASM_BASE as string | undefined) || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_CACHE = "persora-photo-studio-models-v2";
const OBSOLETE_CACHES = ["persora-photo-studio-models-v1"];
const INPUT_SIZE = 1024;
const DOWNLOAD_TIMEOUT_MS = 240_000;
const INFERENCE_TIMEOUT_MS: Record<LocalRuntime, number> = { webgpu: 60_000, wasm: 180_000 };

export type LocalRuntime = "webgpu" | "wasm";
export interface LocalProgress { phase: "download" | "initialize" | "inference"; loaded?: number; total?: number; runtime?: LocalRuntime; sizeLabel?: string }

interface LoadedModel { ort: typeof Ort; session: Ort.InferenceSession; runtime: LocalRuntime }
const sessions: Partial<Record<LocalRuntime, Promise<LoadedModel>>> = {};
/** Set once WebGPU failed in this tab, so later runs go straight to WebAssembly. */
let webGpuBroken = false;

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

async function downloadModel(runtime: LocalRuntime, onProgress: (progress: LocalProgress) => void): Promise<Uint8Array> {
  const url = MODEL_BASE + MODEL_FILES[runtime].file;
  const cache = typeof caches !== "undefined" ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  if (typeof caches !== "undefined") for (const name of OBSOLETE_CACHES) void caches.delete(name).catch(() => undefined);
  const cached = cache ? await cache.match(url).catch(() => undefined) : undefined;
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
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
      onProgress({ phase: "download", loaded, total, runtime, sizeLabel: MODEL_FILES[runtime].label });
    }
    if (total && loaded < total) throw new Error("The on-device model download was interrupted. Retry to continue.");
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (cache) await cache.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => { /* cache is best-effort */ });
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Downloading the on-device model timed out. Check your connection and retry.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadOrt(): Promise<typeof Ort> {
  const ort = await import("onnxruntime-web/webgpu");
  ort.env.wasm.wasmPaths = ORT_WASM_BASE;
  ort.env.wasm.numThreads = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.logLevel = "error";
  return ort;
}

/** WebGPU is used only with an adapter that supports fp16 shaders (the fp16 model needs it). */
export async function webGpuSupported(): Promise<boolean> {
  if (webGpuBroken) return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features?: Set<string> } | null> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter && adapter.features && adapter.features.has("shader-f16"));
  } catch { return false; }
}

async function createSession(runtime: LocalRuntime, onProgress: (progress: LocalProgress) => void): Promise<LoadedModel> {
  const [ort, bytes] = await Promise.all([loadOrt(), downloadModel(runtime, onProgress)]);
  onProgress({ phase: "initialize", runtime });
  const session = await timeout(
    ort.InferenceSession.create(bytes, { executionProviders: [runtime], graphOptimizationLevel: "all" }),
    90_000,
    runtime === "webgpu" ? "WebGPU initialisation timed out." : "The on-device model took too long to start.",
  );
  return { ort, session, runtime };
}

/** Loads (once per runtime) and returns the cached session; a failed load can be retried. */
function getSession(runtime: LocalRuntime, onProgress: (progress: LocalProgress) => void): Promise<LoadedModel> {
  if (!sessions[runtime]) {
    sessions[runtime] = createSession(runtime, onProgress).catch((error) => { delete sessions[runtime]; throw error; });
  }
  return sessions[runtime] as Promise<LoadedModel>;
}

/** Normalises a raw model output into 0…1 alpha. Throws when no subject was found. */
export function normalizeAlpha(values: ArrayLike<number>, length: number): Float32Array {
  let min = Infinity; let max = -Infinity;
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) throw new Error("The on-device model returned an invalid mask.");
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!(max - min > 0.2)) throw new Error("No person was detected in the photo.");
  const range = max - min;
  const alpha = new Float32Array(length);
  for (let index = 0; index < length; index += 1) alpha[index] = (values[index] - min) / range;
  return alpha;
}

async function infer(model: LoadedModel, input: Float32Array): Promise<Float32Array> {
  const { ort, session, runtime } = model;
  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await timeout(session.run({ [session.inputNames[0]]: tensor }), INFERENCE_TIMEOUT_MS[runtime], "On-device background removal took too long.");
  try {
    const output = results[session.outputNames[0]];
    const values = output?.data as Float32Array | undefined;
    const plane = INPUT_SIZE * INPUT_SIZE;
    if (!values || values.length < plane) throw new Error("The on-device model returned no mask.");
    return normalizeAlpha(values, plane);
  } finally {
    for (const value of Object.values(results)) (value as { dispose?: () => void }).dispose?.();
    (tensor as { dispose?: () => void }).dispose?.();
  }
}

/**
 * Runs the on-device segmentation model and returns an alpha-mask canvas
 * (mask in the alpha channel) at the model resolution — stretch it over the
 * source to apply it — plus the runtime that produced it.
 */
export async function runLocalMatting(source: HTMLCanvasElement, onProgress: (progress: LocalProgress) => void): Promise<{ mask: HTMLCanvasElement; runtime: LocalRuntime }> {
  const input = createCanvas(INPUT_SIZE, INPUT_SIZE);
  const ictx = input.getContext("2d", { willReadFrequently: true });
  if (!ictx) throw new Error("Canvas is unavailable in this browser.");
  ictx.imageSmoothingEnabled = true;
  ictx.imageSmoothingQuality = "high";
  ictx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const rgba = ictx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  releaseCanvas(input);
  const plane = INPUT_SIZE * INPUT_SIZE;
  const tensorData = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    tensorData[i] = rgba[i * 4] / 255;
    tensorData[plane + i] = rgba[i * 4 + 1] / 255;
    tensorData[plane * 2 + i] = rgba[i * 4 + 2] / 255;
  }

  let alpha: Float32Array | null = null;
  let runtime: LocalRuntime = "wasm";
  if (await webGpuSupported()) {
    try {
      const model = await getSession("webgpu", onProgress);
      onProgress({ phase: "inference", runtime: "webgpu" });
      alpha = await infer(model, tensorData.slice());
      runtime = "webgpu";
    } catch (error) {
      // "No person" is a real answer, not a GPU fault — don't retry on CPU.
      if (error instanceof Error && /No person was detected/.test(error.message)) throw error;
      console.warn("Photo Studio: WebGPU background removal failed, using WebAssembly.", errorMessage(error));
      webGpuBroken = true;
      delete sessions.webgpu;
    }
  }
  if (!alpha) {
    const model = await getSession("wasm", onProgress);
    onProgress({ phase: "inference", runtime: "wasm" });
    alpha = await infer(model, tensorData);
    runtime = "wasm";
  }

  const mask = createCanvas(INPUT_SIZE, INPUT_SIZE);
  const mctx = mask.getContext("2d");
  if (!mctx) throw new Error("Canvas is unavailable in this browser.");
  const maskPixels = mctx.createImageData(INPUT_SIZE, INPUT_SIZE);
  for (let i = 0; i < plane; i += 1) maskPixels.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, alpha[i])) * 255);
  mctx.putImageData(maskPixels, 0, 0);
  return { mask, runtime };
}
