// Route tests for the Persora AudioSpace worker routes (cloudflare/audio-space.js):
// upload validation, link probing, trash moves and owner-scoped streaming.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAudioSpace, sanitizeAudioInput, normalizeTags, verifyAudioBytes, audioFileName, readDurationSeconds, probeAudioLink, AudioSpaceError } from '../cloudflare/audio-space.js';
import { sniffAudioFormat, detectAudioFormat, isSafeExternalAudioUrl, normalizeExternalUrl } from '../cloudflare/audio-format.js';

const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const ITEM = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const FOLDER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ORIGIN = 'https://persora.example';

// --- Test fixtures -----------------------------------------------------------
function wavBytes(seconds = 2, sampleRate = 8000) {
  const byteRate = sampleRate * 2; // mono 16-bit
  const dataSize = Math.round(seconds * byteRate);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (text, offset) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii('RIFF', 0); view.setUint32(4, 36 + dataSize, true); ascii('WAVE', 8);
  ascii('fmt ', 12); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii('data', 36); view.setUint32(40, dataSize, true);
  return bytes;
}

function mp3Bytes() {
  // ID3v2 tag (10-byte header declaring zero extra bytes) + one 128kbps frame header.
  const bytes = new Uint8Array(64);
  bytes.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 10);
  return bytes;
}

function bucket() {
  const objects = new Map();
  const log = [];
  return {
    objects, log,
    async put(key, value, options) { log.push(['put', key]); objects.set(key, { bytes: new Uint8Array(value), ...options }); },
    async delete(key) { log.push(['delete', key]); objects.delete(key); },
    async head(key) {
      const entry = objects.get(key);
      return entry ? { size: entry.bytes.byteLength, customMetadata: entry.customMetadata } : null;
    },
    async get(key, options) {
      const entry = objects.get(key);
      if (!entry) return null;
      let bytes = entry.bytes;
      if (options?.range) {
        const start = Math.max(0, options.range.offset ?? 0);
        const length = options.range.length ?? Math.max(0, bytes.byteLength - start);
        bytes = bytes.slice(start, start + length);
      }
      return { body: new Blob([bytes]).stream(), size: bytes.byteLength, customMetadata: entry.customMetadata };
    },
  };
}

const row = (overrides = {}) => ({
  id: ITEM, user_id: OWNER, folder_id: null, title: 'Interview', description: '', source: 'upload',
  file_key: `${OWNER}/audio-space/x.wav`, file_name: 'interview.wav', file_size: 100, file_type: 'audio/wav',
  duration_seconds: 12.5, external_url: null, tags: ['meeting'], favorite: false, metadata: {}, last_played_at: null,
  created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z', ...overrides,
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

function saveRequest(bytes, type, meta, fileName = 'a.wav') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), fileName);
  form.append('meta', JSON.stringify(meta));
  return new Request(`${ORIGIN}/api/audio-space/audios`, { method: 'POST', body: form });
}
const meta = (extra = {}) => ({ title: 'Interview', description: '', folderId: null, newFolder: null, tags: ['meeting'], favorite: false, source: 'upload', duration: 2, fileName: 'interview.wav', ...extra });

// --- Pure helpers -----------------------------------------------------------
test('sniffAudioFormat recognises every supported container', () => {
  assert.equal(sniffAudioFormat(wavBytes()), 'wav');
  assert.equal(sniffAudioFormat(mp3Bytes()), 'mp3');
  assert.equal(sniffAudioFormat(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 34, 0, 0, 0, 0])), 'flac');
  assert.equal(sniffAudioFormat(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0])), 'ogg');
  assert.equal(sniffAudioFormat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'webm');
  const m4a = new Uint8Array(16); m4a.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
  assert.equal(sniffAudioFormat(m4a), 'm4a');
  assert.equal(sniffAudioFormat(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0])), 'aac');
  assert.equal(sniffAudioFormat(new TextEncoder().encode('GIF89a-not-audio')), null);
});

test('detectAudioFormat resolves MIME types and URL extensions', () => {
  assert.equal(detectAudioFormat('audio/mpeg'), 'mp3');
  assert.equal(detectAudioFormat('audio/mp4; codecs=mp4a.40.2'), 'm4a');
  assert.equal(detectAudioFormat('https://cdn.example.com/x/y/briefing.mp3?token=1'), 'mp3');
  assert.equal(detectAudioFormat('https://cdn.example.com/page'), null);
});

test('normalizeTags trims, de-duplicates and bounds tags', () => {
  assert.deepEqual(normalizeTags([' Meeting ', 'meeting', '', 'notes']), ['Meeting', 'notes']);
  assert.deepEqual(normalizeTags('a, b ,, a'), ['a', 'b']);
  assert.throws(() => normalizeTags(['A'.repeat(50)]), /1 and 40/);
  assert.throws(() => normalizeTags(Array.from({ length: 25 }, (_, i) => `t${i}`)), /24 or fewer/);
});

test('sanitizeAudioInput enforces title, source, folder and duration rules', () => {
  const full = sanitizeAudioInput({ title: '  Talk  ', description: 'd', folderId: FOLDER, tags: ['x'], favorite: true, source: 'recording', duration: 3.5, fileName: 'talk.webm' });
  assert.equal(full.title, 'Talk');
  assert.equal(full.source, 'recording');
  assert.equal(full.duration, 3.5);
  assert.throws(() => sanitizeAudioInput(meta({ title: '' })), /title/);
  assert.throws(() => sanitizeAudioInput(meta({ source: 'link' })), /source/);
  assert.throws(() => sanitizeAudioInput(meta({ duration: -2 })), /duration/);
  assert.throws(() => sanitizeAudioInput(meta({ folderId: 'nope' })), /folder/);
  const partial = sanitizeAudioInput({ favorite: true }, { partial: true });
  assert.deepEqual(partial, { favorite: true });
});

test('verifyAudioBytes rejects mismatched and unknown bytes; audioFileName matches format', () => {
  assert.equal(verifyAudioBytes(wavBytes(), 'audio/wav'), 'wav');
  assert.equal(verifyAudioBytes(wavBytes(), 'application/octet-stream'), 'wav');
  assert.throws(() => verifyAudioBytes(wavBytes(), 'audio/mpeg'), /does not match/);
  assert.throws(() => verifyAudioBytes(new TextEncoder().encode('not audio at all!')), /MP3/);
  assert.equal(audioFileName('My Talk (final).ogg', 'wav'), 'My Talk (final).wav');
});

test('readDurationSeconds reads WAV duration exactly', () => {
  assert.equal(readDurationSeconds(wavBytes(3, 8000), 'wav'), 3);
});

test('external link safety blocks private targets and non-http URLs', () => {
  assert.equal(isSafeExternalAudioUrl('https://cdn.example.com/a.mp3'), true);
  assert.equal(isSafeExternalAudioUrl('http://127.0.0.1/a.mp3'), false);
  assert.equal(isSafeExternalAudioUrl('http://10.0.0.5/a.mp3'), false);
  assert.equal(isSafeExternalAudioUrl('http://192.168.1.10/a.mp3'), false);
  assert.equal(isSafeExternalAudioUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeExternalAudioUrl('https://localhost/a.mp3'), false);
  assert.equal(isSafeExternalAudioUrl('ftp://cdn.example.com/a.mp3'), false);
  assert.equal(isSafeExternalAudioUrl('https://user:pass@cdn.example.com/a.mp3'), false);
  assert.throws(() => normalizeExternalUrl('cdn.example.com/a.mp3'), /http/);
  assert.throws(() => normalizeExternalUrl('http://127.0.0.1/secret.mp3'), /private/);
});

// --- Upload route -----------------------------------------------------------
test('upload stores verified bytes under the owner prefix and records metadata through the RPC', async () => {
  const e = env();
  let rpcBody = null;
  mockDatabase({ persora_audio_space_save: ({ body }) => { rpcBody = body; return Response.json({ item: row({ file_key: body.p_file_key }), folder: null, createdFolder: false }); } });
  const response = await handleAudioSpace(saveRequest(wavBytes(), 'audio/wav', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(), maxUploadMb: 25 });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.item.id, ITEM);
  assert.match(rpcBody.p_file_key, new RegExp(`^${OWNER}/audio-space/[0-9a-f-]{36}\\.wav$`));
  assert.equal(rpcBody.p_file_type, 'audio/wav');
  assert.equal(rpcBody.p_duration, 2);
  assert.deepEqual(rpcBody.p_tags, ['meeting']);
  assert.equal(e.VAULT_FILES.objects.size, 1);
  const stored = e.VAULT_FILES.objects.get(rpcBody.p_file_key);
  assert.equal(stored.customMetadata.ownerId, OWNER);
  assert.equal(stored.customMetadata.audioSpace, 'true');
});

test('a failed database save removes the uploaded object so no orphan remains', async () => {
  const e = env();
  mockDatabase({ persora_audio_space_save: () => Response.json({ code: 'P0403', message: 'That folder does not belong to AudioSpace.' }, { status: 400 }) });
  const response = await handleAudioSpace(saveRequest(wavBytes(), 'audio/wav', meta({ folderId: FOLDER })), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(response.status, 403);
  assert.equal(e.VAULT_FILES.objects.size, 0);
  assert.deepEqual(e.VAULT_FILES.log.map(([op]) => op), ['put', 'delete']);
});

test('quota, type and content checks run before anything is written', async () => {
  const e = env();
  mockDatabase();
  const overQuota = await handleAudioSpace(saveRequest(wavBytes(), 'audio/wav', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(5 * 1024 ** 3) });
  assert.equal(overQuota.status, 413);
  const mismatched = await handleAudioSpace(saveRequest(wavBytes(), 'audio/mpeg', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(mismatched.status, 400);
  const notAudio = await handleAudioSpace(saveRequest(new TextEncoder().encode('hello audio world'), 'audio/wav', meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(notAudio.status, 415);
  const badMeta = await handleAudioSpace(saveRequest(wavBytes(), 'audio/wav', meta({ title: '' })), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(badMeta.status, 400);
  assert.equal(e.VAULT_FILES.log.length, 0);
});

// --- Streaming --------------------------------------------------------------
test('downloads only serve the owner\'s own AudioSpace objects and support Range seeking', async () => {
  const e = env();
  const key = `${OWNER}/audio-space/a.wav`;
  await e.VAULT_FILES.put(key, wavBytes(), { customMetadata: { ownerId: OWNER, audioSpace: 'true' } });
  e.VAULT_FILES.log.length = 0;
  mockDatabase({ audio_space_items: ({ url }) => Response.json(url.searchParams.get('user_id') === `eq.${OWNER}` ? [row({ file_key: key })] : []) });
  const own = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}/file`), { id: OWNER }, e, ORIGIN);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('Content-Type'), 'audio/wav');
  assert.equal(own.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(own.headers.get('Cache-Control'), 'private, no-store, max-age=0');

  const ranged = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}/file`, { headers: { Range: 'bytes=0-99' } }), { id: OWNER }, e, ORIGIN);
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 0-99/32044');
  assert.equal(ranged.headers.get('Content-Length'), '100');

  const foreign = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}/file`), { id: OTHER }, e, ORIGIN);
  assert.equal(foreign.status, 404);
});

test('a row pointing outside the owner prefix is never served', async () => {
  const e = env();
  mockDatabase({ audio_space_items: () => Response.json([row({ file_key: `${OTHER}/audio-space/b.wav` })]) });
  const response = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}/file`), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 404);
});

// --- Metadata, play touch and trash -----------------------------------------
test('PATCH updates title/tags/favorite and validates the folder scope', async () => {
  const e = env();
  mockDatabase({
    vault_folders: () => Response.json([{ id: FOLDER }]),
    audio_space_items: ({ method }) => method === 'PATCH' ? Response.json([row({ title: 'Renamed', favorite: true })]) : Response.json([]),
  });
  const response = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Renamed', tags: ['a', 'b'], favorite: true, folderId: FOLDER }),
  }), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.item.title, 'Renamed');

  mockDatabase({ vault_folders: () => Response.json([]) });
  const foreignFolder = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: FOLDER }),
  }), { id: OWNER }, e, ORIGIN);
  assert.equal(foreignFolder.status, 403);
});

test('DELETE moves the item into the global Trash through the RPC', async () => {
  const e = env();
  let rpcName = null;
  mockDatabase({ persora_audio_space_trash_move: ({ body }) => { rpcName = body; return Response.json({ id: ITEM }); } });
  const response = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}`, { method: 'DELETE' }), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 200);
  assert.deepEqual(rpcName, { p_owner: OWNER, p_id: ITEM });
});

test('POST play touches last_played_at', async () => {
  const e = env();
  mockDatabase({ audio_space_items: ({ method }) => method === 'PATCH' ? Response.json([row({ last_played_at: '2026-10-30T11:00:00Z' })]) : Response.json([]) });
  const response = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/audios/${ITEM}/play`, { method: 'POST' }), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.item.last_played_at, '2026-10-30T11:00:00Z');
});

// --- External links ---------------------------------------------------------
test('probeAudioLink accepts direct audio URLs and rejects webpages with clear errors', async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('song.mp3')) return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '1024' } });
    if (url.endsWith('page.html')) return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (url.endsWith('private.mp3')) return new Response(null, { status: 403 });
    if (url.endsWith('gone.mp3')) return new Response(null, { status: 404 });
    if (url.endsWith('redirect.mp3')) return new Response(null, { status: 302, headers: { Location: 'https://cdn.example.com/song.mp3' } });
    throw new Error('network down');
  };
  const ok = await probeAudioLink('https://cdn.example.com/audio/song.mp3');
  assert.equal(ok.contentType, 'audio/mpeg');
  assert.equal(ok.host, 'cdn.example.com');

  await assert.rejects(() => probeAudioLink('https://cdn.example.com/page.html'), (error) => {
    assert.ok(error instanceof AudioSpaceError);
    assert.match(error.message, /doesn't point to a playable audio file/);
    return true;
  });
  await assert.rejects(() => probeAudioLink('https://cdn.example.com/private.mp3'), /refused access/);
  await assert.rejects(() => probeAudioLink('https://cdn.example.com/gone.mp3'), /no longer available/);
  await assert.rejects(() => probeAudioLink('https://down.example.com/x.mp3'), /couldn't be reached/);
  const redirected = await probeAudioLink('https://cdn.example.com/redirect.mp3');
  assert.equal(redirected.finalUrl, 'https://cdn.example.com/song.mp3');
});

test('POST links saves the original URL with probe metadata, without bytes', async () => {
  const e = env();
  globalThis.fetch = async (input) => {
    if (String(input).includes('db.example.test')) return Response.json({ item: row({ id: ITEM, source: 'link', file_key: null, external_url: 'https://cdn.example.com/audio/song.mp3', file_type: 'audio/mpeg', duration_seconds: null }), folder: null, createdFolder: false });
    return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  };
  const response = await handleAudioSpace(new Request(`${ORIGIN}/api/audio-space/links`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Talk', description: '', folderId: null, newFolder: null, tags: [], favorite: false, source: 'link', url: 'https://cdn.example.com/audio/song.mp3' }),
  }), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.item.source, 'link');
  assert.equal(data.item.external_url, 'https://cdn.example.com/audio/song.mp3');
  assert.equal(e.VAULT_FILES.objects.size, 0);
});
