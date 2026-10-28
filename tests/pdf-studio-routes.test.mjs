import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { handlePdfStudio, sanitizePdfInput, sanitizeThumbnail, verifyPdfBytes, pdfFileName } from '../cloudflare/pdf-studio.js';

const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const DOC = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const FOLDER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ORIGIN = 'https://persora.example';
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

async function makePdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 400]);
  return doc.save();
}

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
  id: DOC, user_id: OWNER, folder_id: null, title: 'Lease', notes: '', file_key: `${OWNER}/pdf-studio/x.pdf`, file_name: 'Lease.pdf',
  file_size: 100, page_count: 2, thumbnail: THUMB, metadata: {}, created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z', ...overrides,
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
const meta = (extra = {}) => ({ title: 'Lease agreement', notes: '', folderId: null, newFolder: null, pageCount: 2, thumbnail: THUMB, fileName: 'lease.pdf', metadata: { source: 'edit' }, ...extra });

function uploadRequest(bytes, metaValue, { method = 'POST', path = '/api/pdf-studio/documents', type = 'application/pdf' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), 'document.pdf');
  form.append('meta', JSON.stringify(metaValue));
  return new Request(`${ORIGIN}${path}`, { method, body: form });
}

test('Save to Persora stores one verified PDF under the owner prefix and records it through the RPC', async () => {
  const e = env();
  let rpcBody = null;
  mockDatabase({ persora_pdf_studio_save: ({ body }) => { rpcBody = body; return Response.json({ document: row({ file_key: body.p_file_key, page_count: body.p_page_count }), folder: null, createdFolder: false }); } });
  const response = await handlePdfStudio(uploadRequest(await makePdf(2), meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(), maxUploadMb: 25 });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.document.id, DOC);
  assert.equal(data.document.page_count, 2);
  assert.equal('file_key' in data.document, false, 'storage keys are never sent to the browser');
  assert.match(rpcBody.p_file_key, new RegExp(`^${OWNER}/pdf-studio/[0-9a-f-]{36}\\.pdf$`));
  assert.equal(rpcBody.p_file_name, 'lease.pdf');
  assert.equal(rpcBody.p_thumbnail, THUMB);
  assert.equal(rpcBody.p_metadata.source, 'edit');
  assert.equal(rpcBody.p_metadata.pdfVersion, '1.7');
  const stored = e.VAULT_FILES.objects.get(rpcBody.p_file_key);
  assert.equal(stored.customMetadata.ownerId, OWNER);
  assert.equal(stored.customMetadata.pdfStudio, 'true');
  assert.equal(stored.httpMetadata.contentType, 'application/pdf');
});

test('a failed database save removes the uploaded PDF so no orphan remains', async () => {
  const e = env();
  mockDatabase({ persora_pdf_studio_save: () => Response.json({ code: 'P0404', message: 'That folder is no longer available. Choose another folder.' }, { status: 400 }) });
  const response = await handlePdfStudio(uploadRequest(await makePdf(), meta({ folderId: FOLDER })), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /no longer available/);
  assert.equal(e.VAULT_FILES.objects.size, 0);
  assert.deepEqual(e.VAULT_FILES.log.map(([op]) => op), ['put', 'delete']);
});

test('quota, size, type and content checks run before anything is written', async () => {
  const e = env();
  mockDatabase();
  const pdf = await makePdf();
  const overQuota = await handlePdfStudio(uploadRequest(pdf, meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(5 * 1024 ** 3) });
  assert.equal(overQuota.status, 413);
  assert.match((await overQuota.json()).error, /5 GB Plus storage limit/);
  const tooBig = await handlePdfStudio(uploadRequest(new Uint8Array(2 * 1024 * 1024), meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage(), maxUploadMb: 1 });
  assert.equal(tooBig.status, 413);
  assert.match((await tooBig.json()).error, /1 MB or smaller/);
  const notPdf = await handlePdfStudio(uploadRequest(new TextEncoder().encode('hello'.repeat(40)), meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(notPdf.status, 415);
  const wrongType = await handlePdfStudio(uploadRequest(pdf, meta(), { type: 'image/png' }), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(wrongType.status, 415);
  const truncated = await handlePdfStudio(uploadRequest(pdf.slice(0, pdf.length - 400), meta()), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(truncated.status, 422);
  const badPages = await handlePdfStudio(uploadRequest(pdf, meta({ pageCount: 0 })), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(badPages.status, 400);
  const noStorage = await handlePdfStudio(uploadRequest(pdf, meta()), { id: OWNER }, env({ VAULT_FILES: null }), ORIGIN, { storageUsage: usage() });
  assert.equal(noStorage.status, 503);
  assert.equal(e.VAULT_FILES.objects.size, 0);
  assert.equal(e.VAULT_FILES.log.length, 0);
});

test('updating a saved PDF commits the new file first, then deletes the previous object', async () => {
  const e = env();
  const oldKey = `${OWNER}/pdf-studio/old.pdf`;
  e.VAULT_FILES.objects.set(oldKey, { bytes: new Uint8Array([1]), customMetadata: { ownerId: OWNER, pdfStudio: 'true' } });
  let rpcBody = null;
  let quotaReleased = null;
  mockDatabase({
    pdf_studio_documents: () => Response.json([{ id: DOC, file_size: 5000, file_name: 'Lease.pdf', title: 'Lease' }]),
    persora_pdf_studio_replace_file: ({ body }) => { rpcBody = body; return Response.json({ document: row({ page_count: body.p_page_count }), previousKey: oldKey }); },
  });
  const storageUsage = async () => { quotaReleased = true; return { bytesUsed: 5 * 1024 ** 3 - 1000, storageLimitBytes: 5 * 1024 ** 3, storageLimitGb: 5, planName: 'Plus' }; };
  const pdf = await makePdf(3);
  const response = await handlePdfStudio(uploadRequest(pdf, { pageCount: 3, thumbnail: THUMB, metadata: {} }, { method: 'PUT', path: `/api/pdf-studio/documents/${DOC}/file` }), { id: OWNER }, e, ORIGIN, { storageUsage, maxUploadMb: 25 });
  assert.equal(response.status, 200, 'the old file size is released before the quota check');
  assert.ok(quotaReleased);
  assert.equal((await response.json()).document.page_count, 3);
  assert.equal(rpcBody.p_id, DOC);
  assert.equal(rpcBody.p_file_name, 'Lease.pdf');
  assert.equal(e.VAULT_FILES.objects.has(oldKey), false);
  assert.equal(e.VAULT_FILES.objects.has(rpcBody.p_file_key), true);
  assert.deepEqual(e.VAULT_FILES.log.map(([op]) => op), ['put', 'delete']);
  assert.equal(e.VAULT_FILES.log[1][1], oldKey);
});

test('a failed update keeps the previous file and removes the new upload', async () => {
  const e = env();
  mockDatabase({
    pdf_studio_documents: ({ url }) => Response.json(url.search.includes('file_key=') ? [] : [{ id: DOC, file_size: 10, file_name: 'Lease.pdf', title: 'Lease' }]),
    persora_pdf_studio_replace_file: () => Response.json({ code: 'P0404', message: 'That PDF is no longer in your PDF Studio. Save it as a new PDF instead.' }, { status: 400 }),
  });
  const response = await handlePdfStudio(uploadRequest(await makePdf(), { pageCount: 2 }, { method: 'PUT', path: `/api/pdf-studio/documents/${DOC}/file` }), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(response.status, 404);
  assert.equal(e.VAULT_FILES.objects.size, 0);
  assert.deepEqual(e.VAULT_FILES.log.map(([op]) => op), ['put', 'delete']);
});

test('updating a PDF that is gone answers 404 without uploading', async () => {
  const e = env();
  mockDatabase();
  const response = await handlePdfStudio(uploadRequest(await makePdf(), { pageCount: 2 }, { method: 'PUT', path: `/api/pdf-studio/documents/${DOC}/file` }), { id: OWNER }, e, ORIGIN, { storageUsage: usage() });
  assert.equal(response.status, 404);
  assert.equal(e.VAULT_FILES.log.length, 0);
});

test('list, details update, trash and file download are scoped to the owner', async () => {
  const e = env();
  const key = `${OWNER}/pdf-studio/x.pdf`;
  const pdf = await makePdf();
  e.VAULT_FILES.objects.set(key, { bytes: pdf, customMetadata: { ownerId: OWNER, pdfStudio: 'true' } });
  const calls = mockDatabase({
    pdf_studio_documents: ({ method, body }) => method === 'PATCH' ? Response.json([row({ ...body })]) : Response.json([row()]),
    vault_folders: () => Response.json([{ id: FOLDER }]),
    persora_pdf_studio_trash_move: () => Response.json({ id: DOC }),
  });
  const list = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents`), { id: OWNER }, e, ORIGIN);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).documents.length, 1);
  assert.match(calls.at(-1).url.search, new RegExp(`user_id=eq.${OWNER}`));

  const patch = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents/${DOC}`, { method: 'PATCH', body: JSON.stringify({ title: '  Renamed  ', folderId: FOLDER }) }), { id: OWNER }, e, ORIGIN);
  assert.equal(patch.status, 200);
  const patched = calls.at(-1);
  assert.deepEqual(patched.body, { title: 'Renamed', folder_id: FOLDER });
  assert.match(calls.at(-2).url.search, /scope=eq.pdf-studio/);

  const file = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents/${DOC}/file?download=1`), { id: OWNER }, e, ORIGIN);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('Content-Type'), 'application/pdf');
  assert.match(file.headers.get('Content-Disposition'), /^attachment; filename="Lease.pdf"/);
  assert.equal((await file.arrayBuffer()).byteLength, pdf.byteLength);

  const trashed = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents/${DOC}`, { method: 'DELETE' }), { id: OWNER }, e, ORIGIN);
  assert.equal(trashed.status, 200);
  assert.deepEqual(calls.at(-1).body, { p_owner: OWNER, p_id: DOC });
  assert.equal(e.VAULT_FILES.objects.has(key), true, 'Trash keeps the file until it is purged');
});

test('a file whose stored owner does not match is never served', async () => {
  const e = env();
  e.VAULT_FILES.objects.set(`${OWNER}/pdf-studio/x.pdf`, { bytes: await makePdf(), customMetadata: { ownerId: 'someone-else', pdfStudio: 'true' } });
  mockDatabase({ pdf_studio_documents: () => Response.json([row()]) });
  const response = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents/${DOC}/file`), { id: OWNER }, e, ORIGIN);
  assert.equal(response.status, 404);
  const foreignKey = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents/${DOC}/file`), { id: OWNER }, (() => { mockDatabase({ pdf_studio_documents: () => Response.json([row({ file_key: 'other/pdf-studio/x.pdf' })]) }); return e; })(), ORIGIN);
  assert.equal(foreignKey.status, 404);
  const badId = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents/not-a-uuid`, { method: 'DELETE' }), { id: OWNER }, e, ORIGIN);
  assert.equal(badId.status, 404);
});

test('a missing migration is reported clearly', async () => {
  mockDatabase({ pdf_studio_documents: () => Response.json({ code: '42P01', message: 'relation does not exist' }, { status: 404 }) });
  const response = await handlePdfStudio(new Request(`${ORIGIN}/api/pdf-studio/documents`), { id: OWNER }, env(), ORIGIN);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /supabase\/schema\.sql/);
});

test('input validation helpers', async () => {
  assert.throws(() => sanitizePdfInput({ ...meta(), title: '' }), /title/);
  assert.throws(() => sanitizePdfInput({ ...meta(), folderId: 'x' }), /valid PDF Studio folder/);
  assert.throws(() => sanitizePdfInput({ ...meta(), pageCount: 1.5 }), /between 1 and/);
  assert.throws(() => sanitizePdfInput({ ...meta(), newFolder: { name: '' } }), /folder name/);
  const withFolder = sanitizePdfInput({ ...meta(), folderId: FOLDER, newFolder: { name: ' Taxes ', color: 'nope' } });
  assert.deepEqual(withFolder.newFolder, { name: 'Taxes', color: 'blue' });
  assert.equal(withFolder.folderId, null);
  assert.deepEqual(sanitizePdfInput({ notes: 'x' }, { partial: true }), { notes: 'x' });
  const fileOnly = sanitizePdfInput({ title: '', pageCount: 4 }, { fileOnly: true });
  assert.equal(fileOnly.title, undefined);
  assert.equal(fileOnly.pageCount, 4);
  const compact = sanitizePdfInput({ ...meta(), metadata: { ok: 'y', 'bad key': 1, nested: { deep: { deeper: 1 } }, n: Infinity } }).metadata;
  assert.deepEqual(compact, { ok: 'y', nested: { deep: null }, n: null });

  assert.equal(sanitizeThumbnail(null), null);
  assert.equal(sanitizeThumbnail(THUMB), THUMB);
  assert.throws(() => sanitizeThumbnail('data:image/png;base64,iVBORw0KGgo='), /invalid/);
  assert.throws(() => sanitizeThumbnail('data:image/jpeg;base64,iVBORw0KGgo='), /invalid/);
  assert.throws(() => sanitizeThumbnail(`data:image/jpeg;base64,/9j/${'A'.repeat(70000)}`), /too large/);

  assert.equal(verifyPdfBytes(await makePdf()).version, '1.7');
  assert.throws(() => verifyPdfBytes(new Uint8Array(10)), /only saves PDF/);
  assert.equal(pdfFileName('Lease: final/v2'), 'Lease_ final_v2.pdf');
  assert.equal(pdfFileName('report.PDF'), 'report.pdf');
  assert.equal(pdfFileName(''), 'document.pdf');
  assert.equal(pdfFileName('বাংলা নথি'), 'বাংলা নথি.pdf');
});
