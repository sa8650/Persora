// Tiny, dependency-free image fixtures for the Photo Studio tests.
import { deflateSync } from 'node:zlib';
import { crc32 } from '../cloudflare/photo-metadata.js';

function u32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function chunk(type, data) {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const body = new Uint8Array([...typeBytes, ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** A valid RGBA PNG; optional pHYs DPI. `alpha(x,y)` controls transparency. */
export function makePng(width, height, { dpi = null, alpha = () => 255 } = {}) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) rows.push(40, 90, 160, alpha(x, y));
  }
  const ihdr = [...u32(width), ...u32(height), 8, 6, 0, 0, 0];
  const parts = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr)];
  if (dpi) { const ppm = Math.round(dpi / 0.0254); parts.push(...chunk('pHYs', [...u32(ppm), ...u32(ppm), 1])); }
  parts.push(...chunk('IDAT', [...deflateSync(Buffer.from(rows))]), ...chunk('IEND', []));
  return new Uint8Array(parts);
}

/** A structurally valid baseline JPEG header (JFIF density + SOF0) — enough for header parsing. */
export function makeJpeg(width, height, { dpi = 300 } = {}) {
  const jfif = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, dpi ? 1 : 0, (dpi >> 8) & 255, dpi & 255, (dpi >> 8) & 255, dpi & 255, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return new Uint8Array([0xff, 0xd8, ...jfif, ...sof, 0xff, 0xd9]);
}
