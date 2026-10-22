import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePhotoStudio, handleSharedPhotoFile, sanitizePhotoInput, verifyPhotoBytes, photoFileName, readBriaResult, pngHasAlpha, backgroundProviders, BACKGROUND_AI_MODEL } from '../cloudflare/photo-studio.js';
import { makeJpeg, makePng } from './photo-fixtures.mjs';

const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const PHOTO = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const FOLDER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ORIGIN = 'https://persora.example';

function bucket() {
  const objects = new Map();
  const log = [];
  return {
    objects, log,
    async put(key, value, options) { log.push(['put', key]); objects.set(key, { bytes: new Uint8Array(value), ...options }); },
    async delete(key) { log.push(['delete', key]); objects.delete(key); },
    async get(key) {
      const entry = objects.get(key);
      return entry ? { body: new Blob([entry.bytes]).stream(), size: entry.bytes.byteLength, customMetadata: entry.customMetadata } : null;
    },
  };
}

const row = (overrides = {}) => ({
  id: PHOTO, user_id: OWNER, folder_id: null, source_photo_id: null, title: 'Passport', category: 'passport', notes: '',
  file_key: `${OWNER}/photo-studio/x.jpg`, file_name: 'passport.jpg', file_size: 100, file_type: 'image/jpeg', width_px: 413, height_px: 531, dpi: 300,
  metadata: {}, edit_settings: {}, created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z', ...overrides,
});

function mockDatabase(handlers = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    const name = url.pathname.split('/').pop();
    if (handlers[name]) return handlers[name]({ url, method, body });
    return Response.json([]);
  };
  return calls;
}

const env = (extra = {}) => ({ SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key', VAULT_FILES: bucket(), ...extra });
const usage = (bytesUsed = 0, limit = 5 * 1024 ** 3) => async () => ({ bytesUsed, storageLimitBytes: limit, storageLimitGb: 5, planName: 'Plus' });

function saveRequest(bytes, type, meta) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), type === 'image/png' ? 'p.png' : 'p.jpg');
  form.append('meta', JSON.stringify(meta));
  return new Request(`${ORIGIN}/api/photo-studio/photos`, { method: 'POST', body: form });
}
const meta = (extra = {}) => ({ title: 'Passport photo', category: 'passport', notes: '', folderId: null, newFolder: null, sourcePhotoId: null, dpi: null, fileName: 'passport.jpg', metadata: { aspectRatio: '7:9' }, editSettings: {}, ...extra });

test('final Save stores the verified file under the owner prefix and records metadata through the RPC', async () => {
  const e = env();
  let rpcBody = null;
  mockDatabase({ persora_photo_studio_save: ({ body }) => { rpcBody = body; return Response.json({ photo: row({ file_key: body.p_file_key }), folder: null, createdFolder: false }); } });
  const response = await handlePhotoStudio(saveRequest(makeJpeg(413, 531), 'image/jpeg', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(), maxUploadMb: 25 });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.photo.id, PHOTO);
  assert.match(rpcBody.p_file_key, new RegExp(`^${OWNER}/photo-studio/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(rpcBody.p_width, 413);
  assert.equal(rpcBody.p_height, 531);
  assert.equal(rpcBody.p_dpi, 300);
  assert.equal(rpcBody.p_metadata.presetId, 'passport-35x45');
  assert.equal(rpcBody.p_metadata.presetExact, true);
  assert.equal(e.VAULT_FILES.objects.size, 1);
  const stored = e.VAULT_FILES.objects.get(rpcBody.p_file_key);
  assert.equal(stored.customMetadata.ownerId, OWNER);
  assert.equal(stored.customMetadata.photoStudio, 'true');
});

test('a failed database save removes the uploaded object so no orphan remains', async () => {
  const e = env();
  mockDatabase({ persora_photo_studio_save: () => Response.json({ code: 'P0403', message: 'That folder does not belong to Photo Studio.' }, { status: 400 }) });
  const response = await handlePhotoStudio(saveRequest(makeJpeg(413, 531), 'image/jpeg', meta({ folderId: FOLDER })), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(response.status, 403);
  assert.equal(e.VAULT_FILES.objects.size, 0);
  assert.deepEqual(e.VAULT_FILES.log.map(([op]) => op), ['put', 'delete']);
});

test('quota, type and content checks run before anything is written', async () => {
  const e = env();
  mockDatabase();
  const overQuota = await handlePhotoStudio(saveRequest(makeJpeg(413, 531), 'image/jpeg', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(5 * 1024 ** 3) });
  assert.equal(overQuota.status, 413);
  const mismatched = await handlePhotoStudio(saveRequest(makePng(10, 10), 'image/jpeg', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(mismatched.status, 400);
  const notImage = await handlePhotoStudio(saveRequest(new TextEncoder().encode('GIF89a-nope'), 'image/gif', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(notImage.status, 415);
  const badMeta = await handlePhotoStudio(saveRequest(makeJpeg(10, 10), 'image/jpeg', meta({ category: 'selfie' })), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(badMeta.status, 400);
  assert.equal(e.VAULT_FILES.log.length, 0);
});

test('downloads only serve the owner\'s own Photo Studio objects', async () => {
  const e = env();
  const key = `${OWNER}/photo-studio/a.jpg`;
  await e.VAULT_FILES.put(key, makeJpeg(4, 4), { customMetadata: { ownerId: OWNER, photoStudio: 'true' } });
  e.VAULT_FILES.log.length = 0;
  mockDatabase({ photo_studio_photos: ({ url }) => Response.json(url.searchParams.get('user_id') === `eq.${OWNER}` ? [row({ file_key: key })] : []) });
  const own = await handlePhotoStudio(new Request(`${ORIGIN}/api/photo-studio/photos/${PHOTO}/file`), { id: OWNER }, e, ORIGIN);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(own.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const foreign = await handlePhotoStudio(new Request(`${ORIGIN}/api/photo-studio/photos/${PHOTO}/file`), { id: OTHER }, e, ORIGIN);
  assert.equal(foreign.status, 404);
});

test('a row pointing outside the owner prefix is never served', async () => {
  const e = env();
  mockDatabase({ photo_studio_photos: () => Response.json([row({ file_key: `${OTHER}/photo-studio/b.jpg` })]) });
  const response = await handlePhotoStudio(new Request(`${ORIGIN}/api/photo-studio/photos/${PHOTO}/file`), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 404);
});

test('delete moves the photo to the Trash through the owner-checked RPC', async () => {
  let args = null;
  mockDatabase({ persora_photo_studio_trash_move: ({ body }) => { args = body; return Response.json({ ok: true }); } });
  const response = await handlePhotoStudio(new Request(`${ORIGIN}/api/photo-studio/photos/${PHOTO}`, { method: 'DELETE' }), { id: OWNER }, env(), ORIGIN);
  assert.equal(response.status, 200);
  assert.deepEqual(args, { p_owner: OWNER, p_id: PHOTO });
});

test('moving a photo into another page\'s folder is refused', async () => {
  const calls = mockDatabase({ vault_folders: () => Response.json([]) });
  const response = await handlePhotoStudio(new Request(`${ORIGIN}/api/photo-studio/photos/${PHOTO}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: FOLDER }) }), { id: OWNER }, env(), ORIGIN);
  assert.equal(response.status, 403);
  assert.ok(calls.every((call) => call.method !== 'PATCH'));
});

function bgRequest(bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'portrait.jpg');
  return new Request(`${ORIGIN}/api/photo-studio/background-removal`, { method: 'POST', body: form });
}
function imagesBinding(output, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    input(stream) {
      calls.push('input');
      const chain = {
        transform(options) { calls.push(['transform', options]); return chain; },
        async output(options) { calls.push(['output', options]); if (fail) throw new Error('segment failed'); return { response: () => new Response(output) }; },
      };
      return chain;
    },
  };
}

test('cloud background removal asks for a fallback whenever it cannot run', async () => {
  const notConfigured = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, env(), ORIGIN, { aiEnabled: true, planAllowed: true });
  assert.equal(notConfigured.status, 503);
  assert.equal((await notConfigured.json()).fallback, true);
  const disabled = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, env({ IMAGES: imagesBinding(makePng(4, 4)) }), ORIGIN, { aiEnabled: false });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).fallback, true);
  const plan = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, env({ IMAGES: imagesBinding(makePng(4, 4)) }), ORIGIN, { aiEnabled: true, planAllowed: false });
  assert.equal(plan.status, 403);
  assert.equal((await plan.json()).fallback, true);
  const failing = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, env({ IMAGES: imagesBinding(null, { fail: true }) }), ORIGIN, { aiEnabled: true, planAllowed: true });
  assert.equal(failing.status, 502);
  assert.equal((await failing.json()).fallback, true);
  const unusable = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, env({ IMAGES: imagesBinding(new Uint8Array([1, 2, 3])) }), ORIGIN, { aiEnabled: true, planAllowed: true });
  assert.equal(unusable.status, 502);
  assert.equal((await unusable.json()).reason, 'unusable');
});

test('cloud background removal returns a PNG cut-out without storing anything', async () => {
  const e = env({ IMAGES: imagesBinding(makePng(8, 8, { alpha: (x) => (x < 4 ? 0 : 255) })) });
  const calls = mockDatabase();
  const response = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, e, ORIGIN, { aiEnabled: true, planAllowed: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('X-Persora-Background-Source'), 'cloudflare-images');
  assert.deepEqual(e.IMAGES.calls[1], ['transform', { segment: 'foreground' }]);
  assert.equal(e.VAULT_FILES.log.length, 0);
  assert.equal(calls.length, 0);
});

function aiBinding(respond) {
  const calls = [];
  return { calls, async run(model, input, options) { calls.push({ model, input, options }); return respond(model, input, options); } };
}
const BRIA_URL = 'https://files.bria.example/result/cutout.png';
/** A PNG header that declares RGB without transparency (as a failed cut-out would). */
const opaquePng = (w, h) => { const bytes = makePng(w, h); bytes[25] = 2; return bytes; };

test('Pages: Workers AI (Bria RMBG 2.0) is the primary cloud path, through the AI Gateway', async () => {
  const cutout = makePng(64, 64, { alpha: (x) => (x < 32 ? 0 : 255) });
  const calls = mockDatabase();
  const realFetch = globalThis.fetch;
  const downloads = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === BRIA_URL) { downloads.push(String(input)); return new Response(cutout, { headers: { 'Content-Type': 'image/png' } }); }
    return realFetch(input, init);
  };
  const e = env({ AI: aiBinding(() => ({ image: BRIA_URL })), PHOTO_STUDIO_AI_GATEWAY: 'persora' });
  const response = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, e, ORIGIN, { aiEnabled: true, planAllowed: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Persora-Background-Source'), 'workers-ai-bria');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), cutout);
  assert.equal(e.AI.calls.length, 1);
  assert.equal(e.AI.calls[0].model, BACKGROUND_AI_MODEL);
  assert.match(e.AI.calls[0].input.image, /^data:image\/jpeg;base64,/);
  assert.deepEqual(e.AI.calls[0].options, { gateway: { id: 'persora' } });
  assert.deepEqual(downloads, [BRIA_URL]);
  assert.equal(e.VAULT_FILES.log.length, 0, 'nothing stored in R2');
  assert.equal(calls.length, 0, 'nothing recorded in the database');
  // Default gateway id when none is configured.
  const e2 = env({ AI: aiBinding(() => ({ result: { image: `data:image/png;base64,${Buffer.from(cutout).toString('base64')}` } })) });
  const inline = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, e2, ORIGIN, { aiEnabled: true, planAllowed: true });
  assert.equal(inline.status, 200);
  assert.deepEqual(e2.AI.calls[0].options, { gateway: { id: 'default' } });
});

test('Workers AI failures never count as success and always ask the browser to fall back', async () => {
  mockDatabase();
  const cases = [
    [() => { throw new Error('AiError: 7003: Unified Billing credits required for this gateway'); }, 503, /AI Gateway credits/],
    [() => { throw new Error('5007: No such model bria/remove-background'); }, 503, /isn't available/],
    [() => ({ image: 'http://insecure.example/x.png' }), 502, /returned no image/],
    [() => ({}), 502, /returned no image/],
    [() => ({ image: `data:image/png;base64,${Buffer.from(opaquePng(64, 64)).toString('base64')}` }), 502, /unusable/], // no alpha → background not removed
    [() => ({ image: `data:image/png;base64,${Buffer.from(makePng(64, 20, { alpha: () => 0 })).toString('base64')}` }), 502, /different proportions/],
  ];
  for (const [respond, status, message] of cases) {
    const response = await handlePhotoStudio(bgRequest(makeJpeg(64, 64)), { id: OWNER }, env({ AI: aiBinding(respond) }), ORIGIN, { aiEnabled: true, planAllowed: true });
    const body = await response.json();
    assert.equal(response.status, status, body.error);
    assert.equal(body.fallback, true);
    assert.match(body.error, message);
  }
});

test('Bria result parsing and PNG transparency detection', () => {
  assert.deepEqual(readBriaResult({ image: BRIA_URL }), { url: BRIA_URL });
  assert.deepEqual(readBriaResult({ result: { image: BRIA_URL } }), { url: BRIA_URL });
  assert.equal(readBriaResult({ image: 'javascript:alert(1)' }), null);
  assert.equal(readBriaResult(null), null);
  assert.equal(readBriaResult({ image: 'data:image/png;base64,iVBORw0K' }).bytes[0], 0x89);
  assert.equal(pngHasAlpha(makePng(4, 4, { alpha: () => 0 })), true);
  assert.equal(pngHasAlpha(opaquePng(4, 4)), false);
  assert.deepEqual(backgroundProviders({ AI: { run() {} } }), ['workers-ai']);
  assert.deepEqual(backgroundProviders({}), []);
});

test('shared photos are served only to the share recipient or owner', async () => {
  const SHARE = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
  const RECIPIENT = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';
  const e = env();
  const key = `${OWNER}/photo-studio/x.jpg`;
  await e.VAULT_FILES.put(key, makeJpeg(4, 4), { customMetadata: { ownerId: OWNER, photoStudio: 'true' } });
  const calls = mockDatabase({
    record_shares: () => Response.json([{ owner_id: OWNER, recipient_id: RECIPIENT, resource_id: PHOTO }]),
    photo_studio_photos: () => Response.json([{ file_key: key, file_name: 'passport.jpg', file_type: 'image/jpeg', title: 'Passport' }]),
  });
  const ok = await handleSharedPhotoFile({ id: RECIPIENT }, SHARE, e, ORIGIN);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'image/jpeg');
  assert.match(calls[0].url.search, /resource_type=eq\.photo_studio_photo/);
  assert.match(calls[1].url.search, new RegExp(`user_id=eq\\.${OWNER}`));
  const stranger = await handleSharedPhotoFile({ id: OTHER }, SHARE, e, ORIGIN);
  assert.equal(stranger.status, 404);
  const bad = await handleSharedPhotoFile({ id: RECIPIENT }, 'not-a-uuid', e, ORIGIN);
  assert.equal(bad.status, 404);
});

test('input sanitising and file naming helpers', () => {
  assert.throws(() => sanitizePhotoInput({ title: '', category: 'passport' }), /title/);
  const clean = sanitizePhotoInput(meta({ title: '  Visa\u0007 photo ', newFolder: { name: 'Japan', color: 'neon' }, folderId: FOLDER }));
  assert.equal(clean.title, 'Visa photo');
  assert.deepEqual(clean.newFolder, { name: 'Japan', color: 'blue' });
  assert.equal(clean.folderId, null);
  const unsafe = photoFileName('../../evil.exe', 'image/png');
  assert.ok(!unsafe.includes('/') && !unsafe.startsWith('.') && unsafe.endsWith('evil.png'));
  assert.equal(photoFileName('My photo.jpeg', 'image/jpeg'), 'My photo.jpg');
  assert.equal(verifyPhotoBytes(makePng(3, 2), 'image/png').width, 3);
});
