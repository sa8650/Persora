// Photo Studio — background removal orchestration.
//   1. Primary: Persora's cloud AI (Cloudflare Images segment=foreground via the
//      authenticated Pages API; stateless, nothing stored).
//   2. Automatic fallback when the primary is unavailable, fails, times out or
//      returns an unusable mask: the on-device MODNet model (no image leaves
//      the browser).
//   3. If both fail: a clear error. Each attempt runs exactly once — no hidden
//      retries; the UI offers an explicit Retry.
import { requestCloudBackgroundRemoval } from "./cloud";
import { assessAlphaMask } from "./photo-studio";
import { applyMask, decodeImage, encodeForCloud, releaseCanvas, sampleRgba, toWorkingCanvas } from "./photo-studio-render";
import { runLocalMatting, type LocalProgress, type LocalRuntime } from "./local-matting";

const CLOUD_TIMEOUT_MS = 35_000;

export type BackgroundStatus =
  | { stage: "cloud"; message: string }
  | { stage: "switching"; message: string; reason: string }
  | { stage: "local"; message: string; progress?: number; runtime?: LocalRuntime };

export interface BackgroundResult {
  cutout: HTMLCanvasElement;
  source: "cloud" | "local";
  runtime?: LocalRuntime;
  /** Why the cloud path wasn't used (for the status line), when falling back. */
  fallbackReason?: string;
}

export class BackgroundRemovalError extends Error {
  readonly cloudReason: string;
  readonly localReason: string;
  constructor(cloudReason: string, localReason: string) {
    super("Background removal didn't work on this photo.");
    this.name = "BackgroundRemovalError";
    this.cloudReason = cloudReason;
    this.localReason = localReason;
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Cancelled.";
  return error instanceof Error && error.message ? error.message : fallback;
}

async function tryCloud(source: HTMLCanvasElement, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);
  try {
    const upload = await encodeForCloud(source);
    let response: Response;
    try { response = await requestCloudBackgroundRemoval(upload, controller.signal); }
    catch (error) {
      if (signal.aborted) throw error;
      if (controller.signal.aborted) throw new Error("The cloud AI service timed out.");
      throw new Error("The cloud AI service couldn't be reached.");
    }
    if (!response.ok || !(response.headers.get("content-type") || "").includes("image/png")) {
      let message = `The cloud AI service is unavailable (${response.status}).`;
      try { const body = await response.json() as { error?: string }; if (body.error) message = body.error; } catch { /* keep generic */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const image = await decodeImage(blob);
    const maskCanvas = toWorkingCanvas(image);
    const cutout = applyMask(source, maskCanvas);
    releaseCanvas(maskCanvas);
    const verdict = assessAlphaMask(sampleRgba(cutout));
    if (!verdict.usable) { releaseCanvas(cutout); throw new Error(`The cloud AI result wasn't usable: ${verdict.reason}`); }
    return cutout;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (controller.signal.aborted) throw new Error("The cloud AI service timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function tryLocal(source: HTMLCanvasElement, onStatus: (status: BackgroundStatus) => void, signal: AbortSignal): Promise<{ cutout: HTMLCanvasElement; runtime: LocalRuntime }> {
  const report = (progress: LocalProgress) => {
    if (signal.aborted) return;
    if (progress.phase === "download") {
      const percent = progress.total ? Math.round(((progress.loaded || 0) / progress.total) * 100) : undefined;
      onStatus({ stage: "local", message: "Downloading the on-device model (first use only)…", progress: percent });
    } else if (progress.phase === "initialize") {
      onStatus({ stage: "local", message: progress.runtime === "webgpu" ? "Starting the on-device model with WebGPU…" : "Starting the on-device model (CPU)…", runtime: progress.runtime });
    } else {
      onStatus({ stage: "local", message: "Removing the background on this device…", runtime: progress.runtime });
    }
  };
  const { mask, runtime } = await runLocalMatting(source, report);
  if (signal.aborted) { releaseCanvas(mask); throw new DOMException("Cancelled", "AbortError"); }
  const cutout = applyMask(source, mask);
  releaseCanvas(mask);
  const verdict = assessAlphaMask(sampleRgba(cutout));
  if (!verdict.usable) { releaseCanvas(cutout); throw new Error(verdict.reason || "The on-device result wasn't usable."); }
  return { cutout, runtime };
}

/**
 * Removes the background from `source` (an in-memory working canvas). Tries
 * the cloud AI first and falls back to the on-device model automatically.
 */
export async function removePhotoBackground(source: HTMLCanvasElement, onStatus: (status: BackgroundStatus) => void, signal: AbortSignal, options: { cloudAvailable: boolean }): Promise<BackgroundResult> {
  let cloudReason = "Cloud AI isn't available in this workspace.";
  if (options.cloudAvailable) {
    onStatus({ stage: "cloud", message: "Removing the background with Persora AI…" });
    try {
      const cutout = await tryCloud(source, signal);
      return { cutout, source: "cloud" };
    } catch (error) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      cloudReason = errorText(error, "The cloud AI service failed.");
    }
  }
  onStatus({ stage: "switching", message: "Switching to the on-device model — your photo stays on this device.", reason: cloudReason });
  try {
    const { cutout, runtime } = await tryLocal(source, onStatus, signal);
    return { cutout, source: "local", runtime, fallbackReason: cloudReason };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new BackgroundRemovalError(cloudReason, errorText(error, "The on-device model failed."));
  }
}
