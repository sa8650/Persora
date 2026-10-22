import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { makeJpeg } from './photo-fixtures.mjs';

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.photo-studio-'));

// Browser-only modules are replaced with controllable stubs so the pure logic
// and the cloud → local fallback orchestration can be tested in Node.
const STUBS = {
  './cloud': `export const requestCloudBackgroundRemoval = (...args) => globalThis.__ps.cloud(...args);`,
  './local-matting': `export const runLocalMatting = (...args) => globalThis.__ps.local(...args);`,
  './photo-studio-render': `
    export const encodeForCloud = async () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    export const decodeImage = async (blob) => ({ blob });
    export const toWorkingCanvas = () => ({ kind: 'mask', rgba: globalThis.__ps.cloudMask });
    export const applyMask = (source, mask) => ({ kind: 'cutout', rgba: mask.rgba });
    export const releaseCanvas = (canvas) => { globalThis.__ps.released.push(canvas?.kind); };
    export const sampleRgba = (canvas) => canvas.rgba;`,
};
const stubPlugin = {
  name: 'photo-stubs',
  setup(build) {
    build.onResolve({ filter: /^\.\/(cloud|local-matting|photo-studio-render)$/ }, (args) => (args.importer.endsWith('photo-background.ts') ? { path: args.path, namespace: 'ps-stub' } : undefined));
    build.onLoad({ filter: /.*/, namespace: 'ps-stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};
async function bundle(entry, name) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await esbuild.build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile, bundle: true, format: 'esm', platform: 'browser', plugins: [stubPlugin], logLevel: 'silent', define: { 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' } });
  return import(outfile);
}
const studio = await bundle('../src/lib/photo-studio.ts', 'photo-studio');
const background = await bundle('../src/lib/photo-background.ts', 'photo-background');

/** RGBA data where `share` of pixels are opaque subject and the rest transparent. */
function mask(share, pixels = 1000) {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i += 1) data[i * 4 + 3] = i < pixels * share ? 255 : 0;
  return data;
}
function reset(overrides = {}) {
  globalThis.__ps = { released: [], cloudCalls: 0, localCalls: 0, cloudMask: mask(0.4), ...overrides };
  const state = globalThis.__ps;
  const cloud = overrides.cloud;
  state.cloud = async (...args) => { state.cloudCalls += 1; return cloud ? cloud(...args) : new Response(new Uint8Array([137, 80]), { headers: { 'Content-Type': 'image/png' } }); };
  const local = overrides.local;
  state.local = async (source, report) => { state.localCalls += 1; return local ? local(source, report) : { mask: { kind: 'mask', rgba: mask(0.35) }, runtime: 'wasm' }; };
  return state;
}
const source = { kind: 'source' };

test('analyzePhoto detects size, DPI, print size and preset without any AI', () => {
  const bytes = makeJpeg(413, 531, { dpi: 300 });
  const analysis = studio.analyzePhoto(bytes, { width: 413, height: 531 }, bytes.byteLength);
  assert.equal(analysis.format, 'JPEG');
  assert.equal(analysis.width, 413);
  assert.equal(analysis.dpi, 300);
  assert.equal(analysis.printSize, '35 × 45 mm');
  assert.equal(analysis.preset.id, 'passport-35x45');
  assert.equal(analysis.presetExact, true);
  assert.equal(studio.analysisMetadata(analysis).detectedLocally, true);
  assert.equal(studio.analyzePhoto(new Uint8Array([1, 2, 3]), null, 3), null);
});

test('output sizing converts units and clamps to safe bounds', () => {
  assert.deepEqual(studio.outputPixels({ width: 35, height: 45, unit: 'mm', dpi: 300 }), { width: 413, height: 531, clamped: false });
  assert.deepEqual(studio.outputPixels({ width: 2, height: 2, unit: 'in', dpi: 300 }), { width: 600, height: 600, clamped: false });
  assert.equal(studio.outputPixels({ width: 100, height: 100, unit: 'in', dpi: 300 }).clamped, true);
  const cm = studio.convertSize({ width: 35, height: 45, unit: 'mm', dpi: 300 }, 'cm');
  assert.deepEqual([cm.width, cm.height, cm.unit], [3.5, 4.5, 'cm']);
  assert.ok(studio.coverScale(1000, 1000, 413, 531, 10) > studio.coverScale(1000, 1000, 413, 531, 0));
});

test('library filtering, folder counts and small helpers', () => {
  const photos = [
    { id: 'a', title: 'Japan visa', notes: '', category: 'visa', folderId: 'f1', fileName: 'a.jpg', width: 413, height: 531, metadata: {}, createdAt: '2026-10-01' },
    { id: 'b', title: 'Office ID', notes: 'badge', category: 'id-card', folderId: null, fileName: 'b.jpg', width: 354, height: 472, metadata: {}, createdAt: '2026-10-05' },
  ];
  assert.deepEqual(studio.filterPhotos(photos, { query: '', category: 'all', folderId: '', sort: 'newest' }).map((p) => p.id), ['b', 'a']);
  assert.deepEqual(studio.filterPhotos(photos, { query: 'badge', category: 'all', folderId: '', sort: 'newest' }).map((p) => p.id), ['b']);
  assert.deepEqual(studio.filterPhotos(photos, { query: '', category: 'visa', folderId: 'f1', sort: 'oldest' }).map((p) => p.id), ['a']);
  assert.deepEqual(studio.folderCounts(photos), { f1: 1 });
  assert.equal(studio.normalizeHexColor('#ABC'), '#aabbcc');
  assert.equal(studio.normalizeHexColor('red'), '#ffffff');
  assert.equal(studio.editedFileName('Japan visa (edited)', 'image/png'), 'Japan-visa-(edited).png');
});

test('alpha-mask assessment rejects empty and unremoved results', () => {
  assert.equal(studio.assessAlphaMask(mask(0.4)).usable, true);
  assert.equal(studio.assessAlphaMask(mask(0)).usable, false);
  assert.equal(studio.assessAlphaMask(mask(1)).usable, false);
});

test('adjustments are local, preserve alpha and are a no-op when neutral', () => {
  const pixels = new Uint8ClampedArray([100, 120, 140, 0, 100, 120, 140, 255]);
  const copy = new Uint8ClampedArray(pixels);
  studio.applyAdjustments(pixels, 2, 1, studio.NEUTRAL_ADJUSTMENTS);
  assert.deepEqual(pixels, copy);
  studio.applyAdjustments(pixels, 2, 1, { ...studio.NEUTRAL_ADJUSTMENTS, brightness: 50 });
  assert.ok(pixels[4] > 100);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
});

test('background removal tries the primary cloud AI first and uses it when usable', async () => {
  const state = reset();
  const statuses = [];
  const result = await background.removePhotoBackground(source, (s) => statuses.push(s.stage), new AbortController().signal, { cloudAvailable: true });
  assert.equal(result.source, 'cloud');
  assert.equal(state.cloudCalls, 1);
  assert.equal(state.localCalls, 0);
  assert.deepEqual(statuses, ['cloud']);
});

test('cloud failure switches automatically to the on-device model exactly once', async () => {
  const state = reset({ cloud: async () => Response.json({ error: 'Cloudflare Images is not configured.', fallback: true }, { status: 503 }) });
  const statuses = [];
  const result = await background.removePhotoBackground(source, (s) => statuses.push(s), new AbortController().signal, { cloudAvailable: true });
  assert.equal(result.source, 'local');
  assert.equal(result.runtime, 'wasm');
  assert.match(result.fallbackReason, /not configured/);
  assert.equal(state.cloudCalls, 1);
  assert.equal(state.localCalls, 1);
  assert.equal(statuses[1].stage, 'switching');
});

test('an unusable cloud mask also falls back, and no cloud call is made when cloud is off', async () => {
  let state = reset({ cloudMask: mask(1) });
  let result = await background.removePhotoBackground(source, () => {}, new AbortController().signal, { cloudAvailable: true });
  assert.equal(result.source, 'local');
  assert.match(result.fallbackReason, /wasn't usable/);
  assert.equal(state.localCalls, 1);

  state = reset();
  result = await background.removePhotoBackground(source, () => {}, new AbortController().signal, { cloudAvailable: false });
  assert.equal(result.source, 'local');
  assert.equal(state.cloudCalls, 0);
});

test('when both paths fail the error reports both reasons and nothing is retried', async () => {
  const state = reset({
    cloud: async () => { throw new TypeError('network down'); },
    local: async () => ({ mask: { kind: 'mask', rgba: mask(0) }, runtime: 'wasm' }),
  });
  await assert.rejects(
    background.removePhotoBackground(source, () => {}, new AbortController().signal, { cloudAvailable: true }),
    (error) => error instanceof background.BackgroundRemovalError && /couldn't be reached/.test(error.cloudReason) && /No person/.test(error.localReason),
  );
  assert.equal(state.cloudCalls, 1);
  assert.equal(state.localCalls, 1);
  assert.ok(state.released.includes('cutout'));
});

test('cancelling stops the flow without starting the fallback', async () => {
  const controller = new AbortController();
  const state = reset({ cloud: async (_blob, signal) => new Promise((_, reject) => {
    // Behaves like fetch(): rejects at once for an already-aborted signal.
    if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
    else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }) });
  const pending = background.removePhotoBackground(source, () => {}, controller.signal, { cloudAvailable: true });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(state.localCalls, 0);
});
