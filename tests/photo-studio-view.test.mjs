// Component test for PhotoStudioView: bundles the real TSX with esbuild, mounts
// it in happy-dom, and drives Upload & Organize against a stubbed API. Proves
// nothing is uploaded or recorded before the final Save, and that Cancel
// leaves nothing behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { makeJpeg } from './photo-fixtures.mjs';

import { GlobalWindow } from 'happy-dom';
const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (!(key in globalThis)) globalThis[key] = happyWindow[key];
}
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.navigator = happyWindow.navigator;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.MutationObserver = happyWindow.MutationObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-10-22T08:00:00.000Z';
const PHOTO_ID = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const FOLDER_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const savedRow = (overrides = {}) => ({ id: PHOTO_ID, folder_id: FOLDER_ID, source_photo_id: null, title: 'Passport 2026', category: 'passport', notes: '', file_name: 'passport.jpg', file_size: 51234, file_type: 'image/jpeg', width_px: 413, height_px: 531, dpi: 300, metadata: { aspectRatio: '7:9' }, edit_settings: {}, created_at: NOW, updated_at: NOW, ...overrides });

const apiCalls = [];
let photos = [savedRow()];
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = init.method || 'GET';
  apiCalls.push({ method, target, body: init.body });
  if (target.startsWith('/api/vault/folders')) return Response.json([{ id: FOLDER_ID, scope: 'photo-studio', name: 'Visa 2026', color: 'teal', pinned: false, created_at: NOW, updated_at: NOW }]);
  if (target === '/api/photo-studio/photos' && method === 'GET') return Response.json({ photos });
  if (target === '/api/photo-studio/photos' && method === 'POST') {
    const meta = JSON.parse(init.body.get('meta'));
    const row = savedRow({ id: '7c3d4e5f-6071-4891-9a2b-3c4d5e6f7081', title: meta.title, category: meta.category, folder_id: meta.folderId });
    photos = [row, ...photos];
    return Response.json({ photo: row, folder: null, createdFolder: false }, { status: 201 });
  }
  if (target.endsWith('/file')) return new Response(makeJpeg(4, 4), { headers: { 'Content-Type': 'image/jpeg' } });
  return Response.json({ error: `No fixture for ${method} ${target}` }, { status: 404 });
};

// Canvas/image decoding is browser-only; stub it (dimensions come from the header parser anyway).
const renderStub = `
  export const WORKING_MAX_EDGE = 3000;
  export const decodeImage = async () => ({ naturalWidth: 413, naturalHeight: 531, width: 413, height: 531 });
  export const createCanvas = () => ({}); export const toWorkingCanvas = () => ({}); export const releaseCanvas = () => {};
  export const renderComposite = () => {}; export const exportPhoto = async () => ({}); export const applyMask = () => ({}); export const buildCutout = () => ({});
  export const sampleRgba = () => new Uint8ClampedArray(); export const encodeForCloud = async () => new Blob();`;
const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.ps-view-'));
const outfile = path.join(outDir, 'PhotoStudioView.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/components/PhotoStudioView.tsx', import.meta.url).pathname],
  outfile, bundle: true, format: 'esm', platform: 'browser',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'lucide-react', 'onnxruntime-web', 'onnxruntime-web/webgpu'],
  jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"', 'import.meta.env.VITE_PHOTO_STUDIO_MODEL_BASE': 'undefined', 'import.meta.env.VITE_PHOTO_STUDIO_ORT_WASM_BASE': 'undefined' },
  plugins: [{ name: 'render-stub', setup(build) {
    build.onResolve({ filter: /photo-studio-render$/ }, () => ({ path: 'render-stub', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: renderStub, loader: 'js' }));
  } }],
  logLevel: 'silent',
});
const { default: PhotoStudioView } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const text = () => document.body.textContent || '';
const wait = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const posts = () => apiCalls.filter((call) => call.method !== 'GET');
const user = { id: 'user-1', email: 'a@example.com', fullName: 'Amina', role: 'user', uploadsEnabled: true };

async function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const notices = [];
  await act(async () => { root.render(React.createElement(PhotoStudioView, { user, canUpload: true, maxUploadMb: 25, notify: (m) => notices.push(m), ...props })); });
  await wait(60);
  return { container, root, notices };
}
async function chooseUpload(container, file) {
  const input = container.querySelector('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await wait(60);
}
async function click(el) {
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await wait(60);
}
const button = (label) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === label);

test('Photo Studio lists saved photos with folders, categories and both primary actions', async () => {
  const { root, container } = await mount();
  assert.match(text(), /Photo Studio/);
  assert.match(text(), /Passport 2026/);
  assert.match(text(), /Visa 2026/);
  // Cards keep the print size and file info, but technical details live in the viewer.
  const card = container.querySelector('.ps-card');
  assert.match(card.textContent, /35 × 45 mm/);
  assert.match(card.textContent, /50 KB|50\.0 KB/);
  assert.doesNotMatch(card.textContent, /413 × 531|JPEG|300 DPI|7:9/);
  assert.equal(card.querySelector('.ps-checker'), null, 'no checkerboard on cards');
  await click(card.querySelector('.ps-card-media'));
  const viewer = document.querySelector('.ps-viewer-modal') || document.querySelector('[role="dialog"]');
  assert.match(viewer.textContent, /413 × 531 px/);
  assert.match(viewer.textContent, /JPEG/);
  assert.match(viewer.textContent, /7:9/);
  assert.match(viewer.textContent, /300 DPI/);
  await click(button('Close') || viewer.querySelector('[aria-label="Close"]'));
  assert.ok(button('Upload & Organize'));
  assert.ok(button('Create & Edit'));
  assert.ok(apiCalls.some((call) => call.target === '/api/vault/folders?scope=photo-studio'));
  await act(async () => root.unmount()); container.remove();
});

test('Share in the card menu opens the shared Persora sharing modal and shares the photo', async () => {
  const shared = [];
  const { root, container } = await mount({ canShare: true, onShare: async (photo, recipient) => { shared.push([photo.id, recipient]); } });
  await click(container.querySelector('.ps-card button[aria-haspopup="menu"]'));
  const share = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === 'Share');
  assert.ok(share, 'Share item in the three-dot menu');
  await click(share);
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find((el) => /Share with Persora member/.test(el.textContent));
  assert.ok(dialog, 'existing ShareRecordDialog opens');
  assert.match(dialog.textContent, /Passport 2026/);
  const input = dialog.querySelector('form.record-share-form input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'friend@example.com');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => { dialog.querySelector('form.record-share-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await wait(60);
  assert.deepEqual(shared, [[PHOTO_ID, 'friend@example.com']]);
  await act(async () => root.unmount()); container.remove();
  document.querySelectorAll('.modal-backdrop, [role="dialog"]').forEach((el) => el.remove());
});

test('Upload & Organize previews locally, uploads nothing until Save, and Cancel leaves nothing', async () => {
  apiCalls.length = 0;
  const { root, container } = await mount();
  const file = new File([makeJpeg(413, 531, { dpi: 300 })], 'my passport.jpg', { type: 'image/jpeg' });
  await chooseUpload(container, file);
  const dialog = document.querySelector('.ps-organize-modal');
  assert.ok(dialog, 'organize modal opens');
  assert.match(dialog.textContent, /413 × 531 px/);
  assert.match(dialog.textContent, /300 DPI · from JFIF/);
  assert.match(dialog.textContent, /Matches.*Passport & visa/);
  assert.equal(posts().length, 0, 'nothing is sent before Save');

  await click(button('Cancel'));
  assert.equal(document.querySelector('.ps-organize-modal'), null);
  assert.equal(posts().length, 0, 'cancel leaves nothing behind');

  await chooseUpload(container, file);
  await click(button('Save photo'));
  const saves = posts();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].target, '/api/photo-studio/photos');
  const meta = JSON.parse(saves[0].body.get('meta'));
  assert.equal(meta.title, 'my passport');
  assert.equal(meta.category, 'passport');
  assert.equal(meta.dpi, 300);
  assert.equal(meta.metadata.detectedLocally, true);
  assert.equal(document.querySelector('.ps-organize-modal'), null);
  assert.match(text(), /my passport/);
  await act(async () => root.unmount()); container.remove();
});

test('Without an upload plan, Save stays disabled and explains why', async () => {
  apiCalls.length = 0;
  const { root, container } = await mount({ canUpload: false, onUpgrade: () => undefined });
  await chooseUpload(container, new File([makeJpeg(413, 531)], 'p.jpg', { type: 'image/jpeg' }));
  assert.equal(button('Save photo').disabled, true);
  assert.match(document.querySelector('.ps-plan-alert').textContent, /paid plan/);
  assert.equal(posts().length, 0);
  await click(button('Cancel'));
  await act(async () => root.unmount()); container.remove();
});

test('Demo accounts see a sign-in notice instead of the library', async () => {
  apiCalls.length = 0;
  const { root, container } = await mount({ user: { ...user, demo: true } });
  assert.match(text(), /needs a Persora account/);
  assert.equal(apiCalls.length, 0);
  await act(async () => root.unmount()); container.remove();
});
