// Central registry of Persora's AI-powered surfaces. The Admin console toggles
// each one globally; every AI call path in the worker MUST check these flags
// before invoking a model so disabling a feature takes effect everywhere.
// Values live in platform_settings under the key `ai_controls` and default to on.
export const AI_CONTROLS_SETTING_KEY = "ai_controls";

export const DEFAULT_AI_CONTROLS = Object.freeze({
  /** AI memorable-password suggestions in the Password Manager generator. */
  passwordSuggestions: true,
  /** Smart Scan OCR document reads (Azure AI Document Intelligence). */
  smartScanOcr: true,
  /** Smart Scan field extraction (Cloudflare Workers AI). */
  smartScanExtraction: true,
  /** Photo Studio cloud background removal (Cloudflare Images segment=foreground).
   *  When off, Photo Studio uses its on-device model only. */
  photoBackgroundRemoval: true,
});

/** Merge a stored platform_settings value over the defaults. Pure + testable. */
export function resolveAiControls(stored) {
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const output = { ...DEFAULT_AI_CONTROLS };
  for (const key of Object.keys(DEFAULT_AI_CONTROLS)) {
    if (typeof raw[key] === "boolean") output[key] = raw[key];
  }
  return output;
}

/** True when every AI feature is turned off (for UI badges/summaries). */
export function allAiDisabled(controls) {
  return Object.values(controls).every((value) => value === false);
}
