// Photo Studio — background removal orchestration.
//   engine "auto" (default, the Remove Background button):
//     1. Persora's cloud AI — Workers AI `bria/remove-background` (RMBG 2.0)
//        through the authenticated Pages API. Nothing is stored by Persora.
//     2. Automatic fallback when the cloud is unavailable, fails, times out or
//        returns an unusable mask: the on-device ORMBG model (WebGPU, else
//        WebAssembly). No image leaves the browser on this path.
//   engine "cloud" / "local" (Remove again → a specific engine): only that
//   engine runs, so a member can compare results after a poor cut-out.
// Every result goes through the same refinement (matte clean-up + edge colour
// decontamination) and the same quality check. A result is only returned when
// it passed; otherwise BackgroundRemovalError explains each engine's failure.
// Each attempt runs exactly once — no hidden retries; the UI offers Retry.
import { requestCloudBackgroundRemoval } from "./cloud";
import { assessAlphaMask } from "./photo-studio";
import { buildCutout, decodeImage, encodeForCloud, releaseCanvas, sampleRgba } from "./photo-studio-render";
import { runLocalMatting, type LocalProgress, type LocalRuntime } from "./local-matting";

const CLOUD_TIMEOUT_MS = 60_000;

export type BackgroundEngine = "auto" | "cloud" | "local";

export type BackgroundStatus =
  | { stage: "cloud"; message: string }
  | { stage: "switching"; message: string; reason: string }
  | { stage: "local"; message: string; progress?: number; runtime?: LocalRuntime }
  | { stage: "refining"; message: string };

export interface BackgroundResult {
  cutout: HTMLCanvasElement;
  source: "cloud" | "local";
  runtime?: LocalRuntime;
  /** Why the cloud path wasn't used (for the status line), when falling back. */
  fallbackReason?: string;
}

export class BackgroundRemovalError extends Error {
  /** null when the cloud engine wasn't attempted. */
  readonly cloudReason: string | null;
  /** null when the on-device engine wasn't attempted. */
  readonly localReason: string | null;
  constructor(cloudReason: string | null, localReason: string | null) {
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

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

/** Builds the refined cut-out and verifies it; never returns an unusable result. */
function finish(source: HTMLCanvasElement, mask: CanvasImageSource, label: string): HTMLCanvasElement {
  const cutout = buildCutout(source, mask);
  const verdict = assessAlphaMask(sampleRgba(cutout));
  if (!verdict.usable) {
    releaseCanvas(cutout);
    throw new Error(`${label}: ${verdict.reason}`);
  }
  return cutout;
}

async function tryCloud(source: HTMLCanvasElement, onStatus: (status: BackgroundStatus) => void, signal: AbortSignal): Promise<HTMLCanvasElement> {
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
    checkAborted(signal);
    const image = await decodeImage(blob);
    checkAborted(signal);
    onStatus({ stage: "refining", message: "Cleaning up the edges…" });
    return finish(source, image, "The cloud AI result wasn't usable");
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
      onStatus({ stage: "local", message: `Downloading the on-device model${progress.sizeLabel ? ` (${progress.sizeLabel}, first use only)` : " (first use only)"}…`, progress: percent, runtime: progress.runtime });
    } else if (progress.phase === "initialize") {
      onStatus({ stage: "local", message: progress.runtime === "webgpu" ? "Starting the on-device model with WebGPU…" : "Starting the on-device model (CPU)…", runtime: progress.runtime });
    } else {
      onStatus({ stage: "local", message: progress.runtime === "webgpu" ? "Removing the background on this device (WebGPU)…" : "Removing the background on this device — this can take up to a minute…", runtime: progress.runtime });
    }
  };
  const { mask, runtime } = await runLocalMatting(source, report);
  try {
    checkAborted(signal);
    onStatus({ stage: "refining", message: "Cleaning up the edges…" });
    const cutout = finish(source, mask, "The on-device result wasn't usable");
    return { cutout, runtime };
  } finally {
    releaseCanvas(mask);
  }
}

/**
 * Removes the background from `source` (an in-memory working canvas, never
 * modified). `engine` "auto" tries the cloud AI first and falls back to the
 * on-device model automatically; "cloud" / "local" run only that engine.
 */
export async function removePhotoBackground(
  source: HTMLCanvasElement,
  onStatus: (status: BackgroundStatus) => void,
  signal: AbortSignal,
  options: { cloudAvailable: boolean; engine?: BackgroundEngine },
): Promise<BackgroundResult> {
  const engine = options.engine || "auto";
  let cloudReason: string | null = null;
  if (engine !== "local") {
    if (!options.cloudAvailable) {
      cloudReason = "Cloud AI isn't available in this workspace.";
      if (engine === "cloud") throw new BackgroundRemovalError(cloudReason, null);
    } else {
      onStatus({ stage: "cloud", message: "Removing the background with Persora AI…" });
      try {
        const cutout = await tryCloud(source, onStatus, signal);
        return { cutout, source: "cloud" };
      } catch (error) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        cloudReason = errorText(error, "The cloud AI service failed.");
        if (engine === "cloud") throw new BackgroundRemovalError(cloudReason, null);
      }
    }
    onStatus({ stage: "switching", message: "Switching to the on-device model — your photo stays on this device.", reason: cloudReason || "" });
  }
  try {
    const { cutout, runtime } = await tryLocal(source, onStatus, signal);
    return { cutout, source: "local", runtime, ...(cloudReason ? { fallbackReason: cloudReason } : {}) };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new BackgroundRemovalError(cloudReason, errorText(error, "The on-device model failed."));
  }
}
