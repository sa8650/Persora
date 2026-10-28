// Photo Studio — original local color-grading filter presets.
// Pure RGBA maths with zero external assets, zero proprietary LUTs, and zero network I/O.

export type PhotoFilterId =
  | "none"
  | "natural"
  | "warm-portrait"
  | "cool-tone"
  | "cinematic"
  | "film-matte"
  | "vivid"
  | "golden-hour"
  | "soft-pastel"
  | "classic-monochrome"
  | "high-contrast-bw";

export interface PhotoFilterSelection {
  id: PhotoFilterId;
  /** Blend strength from 0 (original) to 100 (full preset). */
  intensity: number;
}

export const NEUTRAL_FILTER: PhotoFilterSelection = Object.freeze({
  id: "none",
  intensity: 100,
});

export interface PhotoFilterPreset {
  id: Exclude<PhotoFilterId, "none">;
  label: string;
  tagline: string;
  exposureEv: number;
  contrast: number;
  blackLift: number;
  whiteClip: number;
  saturation: number;
  channelGain: readonly [number, number, number];
  shadowTint: readonly [number, number, number];
  highlightTint: readonly [number, number, number];
  monochromeWeights?: readonly [number, number, number];
}

export const PHOTO_FILTER_PRESETS: readonly PhotoFilterPreset[] = Object.freeze([
  {
    id: "natural",
    label: "Natural",
    tagline: "Balanced daylight clarity",
    exposureEv: 0.06,
    contrast: 8,
    blackLift: 0,
    whiteClip: 255,
    saturation: 1.06,
    channelGain: [1.01, 1.0, 0.99],
    shadowTint: [0, 0, 0],
    highlightTint: [2, 1, 0],
  },
  {
    id: "warm-portrait",
    label: "Warm Portrait",
    tagline: "Flattering warm skin tones",
    exposureEv: 0.08,
    contrast: 6,
    blackLift: 4,
    whiteClip: 252,
    saturation: 1.05,
    channelGain: [1.06, 1.01, 0.93],
    shadowTint: [6, 2, -4],
    highlightTint: [10, 5, -6],
  },
  {
    id: "cool-tone",
    label: "Cool Tone",
    tagline: "Crisp modern slate & cyan",
    exposureEv: 0.03,
    contrast: 10,
    blackLift: 0,
    whiteClip: 255,
    saturation: 0.96,
    channelGain: [0.94, 1.0, 1.08],
    shadowTint: [-6, 2, 10],
    highlightTint: [-4, 2, 8],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    tagline: "Teal shadows & amber highlights",
    exposureEv: -0.02,
    contrast: 22,
    blackLift: 6,
    whiteClip: 248,
    saturation: 0.94,
    channelGain: [1.0, 1.0, 1.0],
    shadowTint: [-14, 4, 16],
    highlightTint: [16, 7, -12],
  },
  {
    id: "film-matte",
    label: "Film Matte",
    tagline: "Soft lifted blacks & analog fade",
    exposureEv: 0.04,
    contrast: -6,
    blackLift: 22,
    whiteClip: 240,
    saturation: 0.88,
    channelGain: [1.02, 1.0, 0.96],
    shadowTint: [4, 5, 8],
    highlightTint: [8, 6, -4],
  },
  {
    id: "vivid",
    label: "Vivid",
    tagline: "Rich color & punchy contrast",
    exposureEv: 0.05,
    contrast: 20,
    blackLift: 0,
    whiteClip: 255,
    saturation: 1.32,
    channelGain: [1.02, 1.01, 1.02],
    shadowTint: [-2, -2, 2],
    highlightTint: [3, 2, 0],
  },
  {
    id: "golden-hour",
    label: "Golden Hour",
    tagline: "Sunlit amber & warm glow",
    exposureEv: 0.1,
    contrast: 10,
    blackLift: 5,
    whiteClip: 251,
    saturation: 1.14,
    channelGain: [1.09, 1.02, 0.88],
    shadowTint: [8, -2, 6],
    highlightTint: [20, 10, -14],
  },
  {
    id: "soft-pastel",
    label: "Soft Pastel",
    tagline: "Airy highlights & gentle tones",
    exposureEv: 0.14,
    contrast: -14,
    blackLift: 14,
    whiteClip: 249,
    saturation: 0.78,
    channelGain: [1.02, 1.01, 1.03],
    shadowTint: [6, 4, 10],
    highlightTint: [6, 4, 6],
  },
  {
    id: "classic-monochrome",
    label: "Classic Monochrome",
    tagline: "Smooth timeless black & white",
    exposureEv: 0.04,
    contrast: 14,
    blackLift: 3,
    whiteClip: 252,
    saturation: 0,
    channelGain: [1, 1, 1],
    shadowTint: [0, 0, 0],
    highlightTint: [0, 0, 0],
    monochromeWeights: [0.299, 0.587, 0.114],
  },
  {
    id: "high-contrast-bw",
    label: "High-Contrast B&W",
    tagline: "Deep blacks & luminous whites",
    exposureEv: 0.02,
    contrast: 46,
    blackLift: 0,
    whiteClip: 255,
    saturation: 0,
    channelGain: [1, 1, 1],
    shadowTint: [0, 0, 0],
    highlightTint: [0, 0, 0],
    monochromeWeights: [0.36, 0.54, 0.1],
  },
]);

const PRESET_MAP = new Map<string, PhotoFilterPreset>(
  PHOTO_FILTER_PRESETS.map((preset) => [preset.id, preset]),
);

export function getPhotoFilterPreset(id: string | null | undefined): PhotoFilterPreset | null {
  if (!id || id === "none") return null;
  return PRESET_MAP.get(id) || null;
}

export function isFilterNeutral(filter: PhotoFilterSelection | null | undefined): boolean {
  if (!filter || filter.id === "none") return true;
  if (!Number.isFinite(filter.intensity) || filter.intensity <= 0) return true;
  return !PRESET_MAP.has(filter.id);
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/**
 * Applies a color-grading preset at `selection.intensity` (0–100%) to RGBA pixels in place.
 * Preserves the alpha channel so cut-outs and transparent backgrounds stay clean.
 */
export function applyPhotoFilter(data: Uint8ClampedArray, selection: PhotoFilterSelection): void {
  if (isFilterNeutral(selection)) return;
  const preset = PRESET_MAP.get(selection.id);
  if (!preset) return;

  const mix = Math.max(0, Math.min(100, selection.intensity)) / 100;
  if (mix <= 0) return;

  const evScale = Math.pow(2, preset.exposureEv);
  const c = preset.contrast * 2.55;
  const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));
  const outSpan = Math.max(1, preset.whiteClip - preset.blackLift);

  // Precompute tone curve LUT (exposure + contrast + matte black lift / white clip)
  const toneLut = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const exposed = i * evScale;
    const contrasted = contrastFactor * (exposed - 128) + 128;
    const clamped = Math.max(0, Math.min(255, contrasted));
    toneLut[i] = preset.blackLift + (clamped / 255) * outSpan;
  }

  const [gR, gG, gB] = preset.channelGain;
  const [shR, shG, shB] = preset.shadowTint;
  const [hiR, hiG, hiB] = preset.highlightTint;
  const mono = preset.monochromeWeights;
  const sat = preset.saturation;

  for (let idx = 0; idx < data.length; idx += 4) {
    const alpha = data[idx + 3];
    if (alpha === 0) continue;

    const r0 = data[idx];
    const g0 = data[idx + 1];
    const b0 = data[idx + 2];

    let r: number;
    let g: number;
    let b: number;

    if (mono) {
      const gray = r0 * mono[0] + g0 * mono[1] + b0 * mono[2];
      const toned = toneLut[clampByte(gray)];
      r = toned;
      g = toned;
      b = toned;
    } else {
      // 1. Channel balance + tone curve
      r = toneLut[clampByte(r0 * gR)];
      g = toneLut[clampByte(g0 * gG)];
      b = toneLut[clampByte(b0 * gB)];

      // 2. Split toning weighted by normalized luminance
      const lumaNorm = Math.max(0, Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
      const shadowW = (1 - lumaNorm) * (1 - lumaNorm);
      const highlightW = lumaNorm * lumaNorm;
      r += shR * shadowW + hiR * highlightW;
      g += shG * shadowW + hiG * highlightW;
      b += shB * shadowW + hiB * highlightW;

      // 3. Luma-preserving saturation adjustment
      if (sat !== 1) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        r = luma + (r - luma) * sat;
        g = luma + (g - luma) * sat;
        b = luma + (b - luma) * sat;
      }
    }

    if (mix >= 0.999) {
      data[idx] = clampByte(r);
      data[idx + 1] = clampByte(g);
      data[idx + 2] = clampByte(b);
    } else {
      data[idx] = clampByte(r0 + (r - r0) * mix);
      data[idx + 1] = clampByte(g0 + (g - g0) * mix);
      data[idx + 2] = clampByte(b0 + (b - b0) * mix);
    }
  }
}
