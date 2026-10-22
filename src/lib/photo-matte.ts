// Photo Studio — cut-out refinement (pure functions, no DOM).
//
// Applied to every background-removal result (cloud or on-device) before it
// is shown, so a new background colour looks clean:
//   1. stretchAlpha       — removes the faint haze a model leaves over the old
//                           background and firms up near-opaque edges.
//   2. decontaminateEdges — semi-transparent edge pixels (hair, ears, glasses)
//                           still carry the OLD background colour mixed in.
//                           We estimate the local background B and foreground
//                           F on a coarse grid (normalised convolution) and
//                           solve I = αF + (1−α)B for F, so the edge keeps the
//                           person's colour instead of a light/dark halo.

export interface RefineOptions {
  /** Alpha at or below this (0–255) becomes fully transparent. */
  low?: number;
  /** Alpha at or above this (0–255) becomes fully opaque. */
  high?: number;
  /** Longest side of the coarse estimation grid. */
  grid?: number;
}

/** Linear alpha stretch: `low` → 0, `high` → 255. */
export function stretchAlpha(alpha: ArrayLike<number>, low = 10, high = 245): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length);
  const range = Math.max(1, high - low);
  for (let index = 0; index < alpha.length; index += 1) out[index] = ((alpha[index] - low) * 255) / range;
  return out;
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  // Separable box blur over 4 interleaved channels with clamped edges.
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) sum += source[(row + Math.min(width - 1, Math.max(0, x))) * 4 + channel];
      for (let x = 0; x < width; x += 1) {
        temp[(row + x) * 4 + channel] = sum / size;
        sum += source[(row + Math.min(width - 1, x + radius + 1)) * 4 + channel] - source[(row + Math.max(0, x - radius)) * 4 + channel];
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) sum += temp[(Math.min(height - 1, Math.max(0, y)) * width + x) * 4 + channel];
      for (let y = 0; y < height; y += 1) {
        out[(y * width + x) * 4 + channel] = sum / size;
        sum += temp[(Math.min(height - 1, y + radius + 1) * width + x) * 4 + channel] - temp[(Math.max(0, y - radius) * width + x) * 4 + channel];
      }
    }
  }
  return out;
}

/** Normalised convolution: weighted colour average around each grid cell, at two scales. */
function estimateColour(weighted: Float32Array, width: number, height: number, cellPixels: number): Float32Array {
  const near = Math.max(1, Math.round(Math.max(width, height) / 120));
  const fine = boxBlur(boxBlur(weighted, width, height, near), width, height, near);
  const coarse = boxBlur(boxBlur(weighted, width, height, near * 4), width, height, near * 4);
  const out = new Float32Array(width * height * 3);
  for (let cell = 0; cell < width * height; cell += 1) {
    const useFine = fine[cell * 4 + 3] / cellPixels > 0.02;
    const source = useFine ? fine : coarse;
    const weight = source[cell * 4 + 3];
    for (let channel = 0; channel < 3; channel += 1) {
      out[cell * 3 + channel] = weight > 1e-6 ? source[cell * 4 + channel] / weight : 0;
    }
  }
  return out;
}

function sample(grid: Float32Array, width: number, height: number, x: number, y: number, channel: number): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const top = grid[(y0 * width + x0) * 3 + channel] * (1 - fx) + grid[(y0 * width + x1) * 3 + channel] * fx;
  const bottom = grid[(y1 * width + x0) * 3 + channel] * (1 - fx) + grid[(y1 * width + x1) * 3 + channel] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Builds the refined RGBA cut-out from the original pixels (`rgba`, alpha
 * ignored) and a per-pixel matte (`alpha`, 0–255, already stretched).
 * Opaque pixels are copied untouched; only edge pixels get new colours.
 */
export function decontaminateEdges(rgba: ArrayLike<number>, alpha: ArrayLike<number>, width: number, height: number, options: RefineOptions = {}): Uint8ClampedArray {
  const pixels = width * height;
  const out = new Uint8ClampedArray(pixels * 4);
  const scale = Math.min(1, (options.grid ?? 384) / Math.max(width, height));
  const gridW = Math.max(1, Math.round(width * scale));
  const gridH = Math.max(1, Math.round(height * scale));
  const cellPixels = pixels / (gridW * gridH);
  const background = new Float32Array(gridW * gridH * 4);
  const foreground = new Float32Array(gridW * gridH * 4);
  let edges = 0;
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(gridH - 1, Math.floor((y * gridH) / height));
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const a = alpha[index] / 255;
      if (a > 0.004 && a < 0.996) edges += 1;
      const cell = (gy * gridW + Math.min(gridW - 1, Math.floor((x * gridW) / width))) * 4;
      const wb = (1 - a) * (1 - a);
      const wf = a * a * a * a;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = rgba[index * 4 + channel];
        background[cell + channel] += value * wb;
        foreground[cell + channel] += value * wf;
      }
      background[cell + 3] += wb;
      foreground[cell + 3] += wf;
    }
  }
  const bgGrid = edges ? estimateColour(background, gridW, gridH, cellPixels) : null;
  const fgGrid = edges ? estimateColour(foreground, gridW, gridH, cellPixels) : null;
  const sx = gridW / width;
  const sy = gridH / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const o = index * 4;
      const alphaByte = alpha[index];
      const a = alphaByte / 255;
      out[o + 3] = alphaByte;
      if (a >= 0.996 || a <= 0.004 || !bgGrid || !fgGrid) {
        out[o] = rgba[o]; out[o + 1] = rgba[o + 1]; out[o + 2] = rgba[o + 2];
        continue;
      }
      const gx = (x + 0.5) * sx - 0.5;
      const gy = (y + 0.5) * sy - 0.5;
      const blend = Math.min(1, a / 0.35);
      for (let channel = 0; channel < 3; channel += 1) {
        const observed = rgba[o + channel];
        const b = sample(bgGrid, gridW, gridH, gx, gy, channel);
        const f = sample(fgGrid, gridW, gridH, gx, gy, channel);
        const solved = (observed - (1 - a) * b) / Math.max(a, 0.05);
        out[o + channel] = f * (1 - blend) + solved * blend;
      }
    }
  }
  return out;
}

