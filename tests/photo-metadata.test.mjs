import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_SIZE_PRESETS, aspectRatio, detectImageFormat, fromPixels, matchPreset, presetPixels, readImageInfo, toPixels, withImageDpi,
} from '../cloudflare/photo-metadata.js';
import { makeJpeg, makePng } from './photo-fixtures.mjs';

test('reads JPEG dimensions and JFIF DPI locally from the file header', () => {
  const info = readImageInfo(makeJpeg(413, 531, { dpi: 300 }));
  assert.equal(info.mime, 'image/jpeg');
  assert.equal(info.width, 413);
  assert.equal(info.height, 531);
  assert.equal(info.dpi, 300);
  assert.equal(info.dpiSource, 'JFIF');
});

test('reads PNG dimensions and pHYs DPI, and reports missing DPI as null', () => {
  const withDpi = readImageInfo(makePng(600, 600, { dpi: 300 }));
  assert.equal(withDpi.mime, 'image/png');
  assert.deepEqual([withDpi.width, withDpi.height], [600, 600]);
  assert.equal(Math.round(withDpi.dpi), 300);
  assert.equal(withDpi.dpiSource, 'pHYs');
  assert.equal(readImageInfo(makePng(10, 20)).dpi, null);
});

test('rejects non-images and unknown formats', () => {
  assert.equal(readImageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(detectImageFormat(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(detectImageFormat(makePng(1, 1)).mime, 'image/png');
});

test('withImageDpi embeds a DPI that reads back for JPEG and PNG', () => {
  const jpeg = withImageDpi(makeJpeg(100, 100, { dpi: 72 }), 300);
  assert.equal(readImageInfo(jpeg).dpi, 300);
  const png = withImageDpi(makePng(8, 8), 600);
  assert.equal(Math.round(readImageInfo(png).dpi), 600);
  assert.deepEqual([readImageInfo(png).width, readImageInfo(png).height], [8, 8]);
});

test('unit conversion and presets agree at 300 DPI', () => {
  assert.equal(toPixels(35, 'mm', 300), 413);
  assert.equal(toPixels(45, 'mm', 300), 531);
  assert.equal(toPixels(2, 'in', 300), 600);
  assert.equal(toPixels(250, 'px', 300), 250);
  assert.ok(Math.abs(fromPixels(413, 'mm', 300) - 35) < 0.1);
  const passport = PHOTO_SIZE_PRESETS.find((preset) => preset.id === 'passport-35x45');
  assert.deepEqual(presetPixels(passport), { width: 413, height: 531 });
});

test('matches official presets exactly or by shape, and reduces aspect ratios', () => {
  const exact = matchPreset(413, 531, 300);
  assert.equal(exact.preset.id, 'passport-35x45');
  assert.equal(exact.exact, true);
  const shape = matchPreset(826, 1062, 72);
  assert.equal(shape.preset.id, 'passport-35x45');
  assert.equal(shape.exact, false);
  assert.equal(matchPreset(1920, 1080, 72), null);
  assert.equal(aspectRatio(413, 531).label, '7:9');
  assert.equal(aspectRatio(600, 600).label, '1:1');
});
