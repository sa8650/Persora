// Persora Table Pages API routes end to end: handleTables → PostgREST (mocked
// fetch) → the real migration on PGlite. Covers create (blank, every
// template, import-sized), validation, list/detail, revision-checked saves,
// repeated/failed/slow saves, two-device conflicts, rename/star/duplicate,
// trash, attachments (upload checks, private serving, pruning), people,
// isolation between accounts, export and the anonymous 401.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handleTables, exportTableData, normalizeCreateInput } from '../cloudflare/tables.js';
import worker from '../cloudflare/api.js';
import { TABLE_TEMPLATES, buildTemplate, blankSmartTable, blankSpreadsheet } from '../cloudflare/table-templates.js';
import { emptySheetData } from '../cloudflare/table-rules.js';
import { buildSmartImport } from '../cloudflare/table-io.js';

const ORIGIN = 'https://persora.example';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const ctx = await createVaultDatabase();
const { db } = ctx;

const rpcLog = [];
let failNext = null;
let delayNext = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
  const name = url.pathname.split('/').pop();
  const args = init.body ? JSON.parse(init.body) : {};
  rpcLog.push({ name, args });
  if (delayNext) { const wait = delayNext; delayNext = 0; await new Promise((resolve) => setTimeout(resolve, wait)); }
  if (failNext && failNext.name === name) {
    const { response, afterCommit } = failNext; failNext = null;
    if (afterCommit) await ctx.rpc(name, args); // the write commits, then the response is lost
    return response();
  }
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

/** In-memory R2 bucket with the subset of the API the routes use. */
function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} });
    },
    async get(key) {
      const entry = objects.get(key);
      return entry ? { body: new Blob([entry.bytes]).stream(), size: entry.bytes.byteLength, httpMetadata: entry.httpMetadata, customMetadata: entry.customMetadata } : null;
    },
    async head(key) { const entry = objects.get(key); return entry ? { size: entry.bytes.byteLength, customMetadata: entry.customMetadata } : null; },
    async delete(key) { objects.delete(key); },
  };
}

const alice = { id: (await ctx.addMember('table-route-alice')).id };
const bob = { id: (await ctx.addMember('table-route-bob')).id };

const call = async (method, path, body, who = alice, services = {}, extraEnv = {}) => {
  const init = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  const response = await handleTables(new Request(`${ORIGIN}/api${path}`, init), who, { ...env, ...extraEnv }, ORIGIN, services);
  const type = response.headers.get('content-type') || '';
  return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
};
async function createSheetTable(who = alice, name = 'Budget') {
  const content = blankSpreadsheet();
  content.sheets[0].data.cells['0:0'] = { v: 'Item', s: { b: 1 } };
  content.sheets[0].data.cells['1:1'] = { f: '=SUM(B1:B1)' };
  const result = await call('POST', '/tables', { id: crypto.randomUUID(), kind: 'spreadsheet', name, sheets: content.sheets }, who);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { ...result.body.table, sheets: content.sheets };
}
async function createSmartTable(who = alice, name = 'Expenses', template = 'expense-tracker') {
  const content = buildTemplate(template, '2026-10-24');
  const result = await call('POST', '/tables', { id: crypto.randomUUID(), kind: 'smart', name, template, meta: content.meta, records: content.records }, who);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { ...result.body.table, meta: content.meta, records: content.records };
}
const batch = (base, extra = {}) => ({ baseRevision: base, batchId: crypto.randomUUID(), ...extra });

test('anonymous requests get 401 from the worker', async () => {
  for (const [method, path] of [['GET', '/api/tables'], ['POST', '/api/tables'], ['GET', `/api/tables/${crypto.randomUUID()}`], ['PUT', `/api/tables/${crypto.randomUUID()}/content`], ['GET', '/api/tables/people']]) {
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env, { waitUntil() {} });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('create: blank spreadsheet and smart table, replay, list and detail', async () => {
  const id = crypto.randomUUID();
  const content = blankSpreadsheet();
  const first = await call('POST', '/tables', { id, kind: 'spreadsheet', name: '  Q4 plan ', sheets: content.sheets });
  assert.equal(first.status, 201);
  assert.equal(first.body.table.name, 'Q4 plan');
  assert.equal(first.body.table.revision, 1);
  const replay = await call('POST', '/tables', { id, kind: 'spreadsheet', name: 'Q4 plan', sheets: content.sheets });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const smart = blankSmartTable();
  const smartRes = await call('POST', '/tables', { id: crypto.randomUUID(), kind: 'smart', name: 'Tasks', meta: smart.meta, records: smart.records });
  assert.equal(smartRes.status, 201);
  const list = await call('GET', '/tables');
  assert.equal(list.status, 200);
  assert.ok(list.body.tables.some((row) => row.id === id && row.kind === 'spreadsheet' && row.sheetCount === 1));
  assert.equal(list.body.tables[0].meta, undefined, 'the list never ships table content');
  const detail = await call('GET', `/tables/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.sheets.length, 1);
  assert.ok(detail.body.table.openedAt);
});

test('every template creates a valid table with labelled example rows', async () => {
  assert.equal(TABLE_TEMPLATES.length, 10);
  for (const template of TABLE_TEMPLATES) {
    const content = buildTemplate(template.id, '2026-10-24');
    const body = { id: crypto.randomUUID(), kind: content.kind, name: template.name, template: template.id, ...(content.kind === 'smart' ? { meta: content.meta, records: content.records } : { sheets: content.sheets }) };
    const result = await call('POST', '/tables', body);
    assert.equal(result.status, 201, `${template.id}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.table.template, template.id);
    const detail = await call('GET', `/tables/${body.id}`);
    if (content.kind === 'smart') {
      assert.equal(detail.body.records.length, content.records.length, template.id);
      assert.ok(detail.body.records.length && detail.body.records.every((row) => row.example === true), `${template.id} examples are labelled`);
    } else {
      assert.ok(JSON.stringify(detail.body.sheets).includes('Example'), `${template.id} spreadsheet examples are labelled`);
    }
  }
});

test('create validation: kinds, names, sheets, unknown fields and sizes', async () => {
  const bad = async (body, status = 400) => { const result = await call('POST', '/tables', body); assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  await bad({ id: 'nope', kind: 'smart', name: 'x' });
  await bad({ id: crypto.randomUUID(), kind: 'chart', name: 'x' });
  await bad({ id: crypto.randomUUID(), kind: 'spreadsheet', name: '   ', sheets: blankSpreadsheet().sheets });
  await bad({ id: crypto.randomUUID(), kind: 'spreadsheet', name: 'x', sheets: [] });
  const two = [{ id: crypto.randomUUID(), name: 'Data', data: emptySheetData() }, { id: crypto.randomUUID(), name: 'data', data: emptySheetData() }];
  await bad({ id: crypto.randomUUID(), kind: 'spreadsheet', name: 'x', sheets: two });
  await bad({ id: crypto.randomUUID(), kind: 'spreadsheet', name: 'x', sheets: [{ id: crypto.randomUUID(), name: 'A/B', data: emptySheetData() }] });
  await bad('{not json');
  // Values for unknown fields are dropped by the server; known values are kept.
  const smart = blankSmartTable();
  const fieldId = smart.meta.fields[0].id;
  const input = normalizeCreateInput({ id: crypto.randomUUID(), kind: 'smart', name: 'x', meta: smart.meta, records: [{ id: crypto.randomUUID(), values: { [fieldId]: 'Keep', evil: 'drop' } }] });
  assert.deepEqual(input.records[0].values, { [fieldId]: 'Keep' });
  // An import-sized table (5,000 rows) is accepted in one atomic request.
  const rows = [['Name', 'Amount', 'Paid'], ...Array.from({ length: 5000 }, (_, index) => [`Item ${index}`, String(index), index % 2 ? 'yes' : 'no'])];
  const imported = buildSmartImport(rows, { headerRow: true });
  const big = await call('POST', '/tables', { id: crypto.randomUUID(), kind: 'smart', name: 'Import', meta: imported.meta, records: imported.records });
  assert.equal(big.status, 201, JSON.stringify(big.body));
  assert.equal(big.body.table.recordCount, 5000);
  // 5,001 records: refused entirely, nothing created.
  const before = Number((await db.query('select count(*) from persora_tables where user_id = $1', [alice.id])).rows[0].count);
  const tooMany = [...imported.records, { id: crypto.randomUUID(), values: {} }].map((record) => ({ ...record, id: crypto.randomUUID() }));
  await bad({ id: crypto.randomUUID(), kind: 'smart', name: 'Too big', meta: imported.meta, records: tooMany });
  assert.equal(Number((await db.query('select count(*) from persora_tables where user_id = $1', [alice.id])).rows[0].count), before);
});

test('saves: confirmed revision, replayed batch, stale base conflict, record-only saves checked against stored fields', async () => {
  const table = await createSheetTable(alice, 'Saves');
  const sheet = table.sheets[0];
  const edit = { ...sheet, data: { ...sheet.data, cells: { ...sheet.data.cells, '2:0': { v: 'Rent' }, '2:1': { v: 1200 } } } };
  const body = batch(1, { sheets: { upsert: [edit] } });
  const saved = await call('PUT', `/tables/${table.id}/content`, body);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.table.revision, 2);
  const replay = await call('PUT', `/tables/${table.id}/content`, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.table.revision, 2);
  const stale = await call('PUT', `/tables/${table.id}/content`, batch(1, { sheets: { upsert: [{ ...sheet, name: 'Overwrite' }] } }));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.conflict, true);
  assert.equal(stale.body.table.revision, 2);
  const detail = await call('GET', `/tables/${table.id}`);
  assert.equal(detail.body.sheets[0].name, sheet.name);
  assert.equal(detail.body.sheets[0].data.cells['2:1'].v, 1200);
  // Formulas are stored as entered (text), never evaluated or executed on the server.
  assert.equal(detail.body.sheets[0].data.cells['1:1'].f, '=SUM(B1:B1)');
  // Malformed batches.
  assert.equal((await call('PUT', `/tables/${table.id}/content`, { batchId: crypto.randomUUID() })).status, 400);
  assert.equal((await call('PUT', `/tables/${table.id}/content`, batch(2, { records: { upsert: [] } }))).status, 400);
  const huge = 'x'.repeat(7 * 1024 * 1024);
  assert.equal((await call('PUT', `/tables/${table.id}/content`, batch(2, { sheets: { upsert: [{ ...sheet, data: { ...sheet.data, cells: { '0:0': { v: huge } } } }] } }))).status, 413);

  const smart = await createSmartTable(alice, 'Record saves');
  const textField = smart.meta.fields.find((field) => field.type === 'text');
  const record = { id: crypto.randomUUID(), position: 99999, values: { [textField.id]: 'New', ghost: 'dropped' } };
  const res = await call('PUT', `/tables/${smart.id}/content`, batch(1, { records: { upsert: [record], delete: [smart.records[0].id] } }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after = await call('GET', `/tables/${smart.id}`);
  const stored = after.body.records.find((row) => row.id === record.id);
  assert.deepEqual(stored.values, { [textField.id]: 'New' });
  assert.ok(!after.body.records.some((row) => row.id === smart.records[0].id));
  const rev = await call('GET', `/tables/${smart.id}/revision`);
  assert.equal(rev.body.table.revision, 2);
  assert.equal(rev.body.table.meta, undefined);
});

test('two devices: the second save conflicts, nothing is overwritten, and it can re-apply after reloading', async () => {
  const smart = await createSmartTable(alice, 'Shared tabs');
  const field = smart.meta.fields.find((entry) => entry.type === 'text');
  const target = smart.records[0];
  const deviceA = await call('PUT', `/tables/${smart.id}/content`, batch(1, { records: { upsert: [{ ...target, values: { ...target.values, [field.id]: 'From A' } }] } }));
  assert.equal(deviceA.status, 200);
  const deviceB = await call('PUT', `/tables/${smart.id}/content`, batch(1, { records: { upsert: [{ ...target, values: { ...target.values, [field.id]: 'From B' } }] } }));
  assert.equal(deviceB.status, 409);
  let detail = await call('GET', `/tables/${smart.id}`);
  assert.equal(detail.body.records.find((row) => row.id === target.id).values[field.id], 'From A');
  // Device B reloads (revision 2) and chooses to apply its edit on top.
  const retry = await call('PUT', `/tables/${smart.id}/content`, batch(detail.body.table.revision, { records: { upsert: [{ ...target, values: { ...target.values, [field.id]: 'From B' } }] } }));
  assert.equal(retry.status, 200);
  detail = await call('GET', `/tables/${smart.id}`);
  assert.equal(detail.body.records.find((row) => row.id === target.id).values[field.id], 'From B');
  assert.equal(detail.body.table.revision, 3);
});

test('failed, lost and slow saves: retrying the same batch never duplicates', async () => {
  const smart = await createSmartTable(alice, 'Flaky');
  const add = { id: crypto.randomUUID(), position: 50000, values: {} };
  const body = batch(1, { records: { upsert: [add] } });
  // Database down: 502, nothing written.
  failNext = { name: 'persora_table_save', response: () => Response.json({ message: 'boom' }, { status: 500 }) };
  const down = await call('PUT', `/tables/${smart.id}/content`, body);
  assert.equal(down.status, 502);
  assert.equal((await call('GET', `/tables/${smart.id}/revision`)).body.table.revision, 1);
  // Write commits but the response is lost: the client retries the same batch.
  failNext = { name: 'persora_table_save', afterCommit: true, response: () => new Response('gateway timeout', { status: 504 }) };
  assert.equal((await call('PUT', `/tables/${smart.id}/content`, body)).status, 502);
  const retry = await call('PUT', `/tables/${smart.id}/content`, body);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.table.revision, 2);
  assert.equal(Number((await db.query('select count(*) from persora_table_records where id = $1', [add.id])).rows[0].count), 1);
  // Two identical slow requests in flight (double click / retry storm): one applies, the other replays.
  const next = batch(2, { records: { upsert: [{ ...add, position: 60000 }] } });
  delayNext = 50;
  const [one, two] = await Promise.all([call('PUT', `/tables/${smart.id}/content`, next), call('PUT', `/tables/${smart.id}/content`, next)]);
  assert.deepEqual([one.status, two.status], [200, 200]);
  assert.equal((await call('GET', `/tables/${smart.id}/revision`)).body.table.revision, 3);
});

test('rename, star, label, duplicate and delete to Trash', async () => {
  const smart = await createSmartTable(alice, 'Organize');
  const patched = await call('PATCH', `/tables/${smart.id}`, { name: 'Household', starred: true, label: 'Home' });
  assert.equal(patched.status, 200);
  assert.deepEqual([patched.body.table.name, patched.body.table.starred, patched.body.table.label], ['Household', true, 'Home']);
  assert.equal((await call('PATCH', `/tables/${smart.id}`, {})).status, 400);
  assert.equal((await call('PATCH', `/tables/${smart.id}`, { starred: 'yes' })).status, 400);
  assert.equal((await call('PATCH', `/tables/${smart.id}`, { name: '' })).status, 400);
  const copyId = crypto.randomUUID();
  const copy = await call('POST', `/tables/${smart.id}/duplicate`, { id: copyId, name: 'Household copy' });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.table.recordCount, smart.records.length);
  assert.equal((await call('POST', `/tables/${smart.id}/duplicate`, { id: copyId, name: 'Household copy' })).status, 200);
  const removed = await call('DELETE', `/tables/${copyId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.trashed, true);
  assert.equal((await call('GET', `/tables/${copyId}`)).status, 404);
  const trash = await db.query('select kind, title, context from trash_items where id = $1', [copyId]);
  assert.equal(trash.rows[0].kind, 'persora_table');
  assert.equal(trash.rows[0].context.space, 'persora-table');
  assert.equal(trash.rows[0].context.recordType, 'Smart Table');
});

test('isolation: another account cannot reach a table by id through any route', async () => {
  const smart = await createSmartTable(alice, 'Alice only');
  const attId = crypto.randomUUID();
  await ctx.rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: smart.id, p_id: attId, p_key: `${alice.id}/persora-table/x`, p_name: 'x.png', p_type: 'image/png', p_size: 3 });
  const bucket = memoryBucket();
  const services = { storageUsage: async () => ({ bytesUsed: 0, storageLimitBytes: 1e9, storageLimitGb: 1, planName: 'Plus' }), maxUploadMb: 5 };
  const form = new FormData(); form.set('id', crypto.randomUUID()); form.set('file', new File(['hi'], 'a.txt', { type: 'text/plain' }));
  const attempts = [
    ['GET', `/tables/${smart.id}`], ['GET', `/tables/${smart.id}/revision`], ['PATCH', `/tables/${smart.id}`, { starred: true }],
    ['PUT', `/tables/${smart.id}/content`, batch(1, { records: { delete: [smart.records[0].id] } })], ['DELETE', `/tables/${smart.id}`],
    ['POST', `/tables/${smart.id}/duplicate`, { id: crypto.randomUUID(), name: 'Mine now' }], ['GET', `/tables/${smart.id}/attachments/${attId}`], ['POST', `/tables/${smart.id}/attachments`, form],
  ];
  for (const [method, path, body] of attempts) {
    const result = await call(method, path, body, bob, services, { VAULT_FILES: bucket });
    assert.equal(result.status, 404, `${method} ${path}: ${JSON.stringify(result.body)}`);
  }
  assert.equal(bucket.objects.size, 0, 'nothing was stored for the failed upload');
  assert.ok(!(await call('GET', '/tables', undefined, bob)).body.tables.some((row) => row.id === smart.id));
  const detail = await call('GET', `/tables/${smart.id}`);
  assert.equal(detail.body.table.revision, 1);
  assert.equal(detail.body.table.starred, false);
  assert.equal((await call('GET', `/tables/not-a-uuid`)).status, 404);
});

test('attachments: upload checks, private serving, and pruning of files no record uses', async () => {
  const smart = await createSmartTable(alice, 'Receipts');
  const bucket = memoryBucket();
  let usage = 0;
  const deleted = [];
  const services = {
    storageUsage: async () => ({ bytesUsed: usage, storageLimitBytes: 1000, storageLimitGb: 1, planName: 'Plus' }), maxUploadMb: 1,
    deleteFileIfUnreferenced: async (userId, key) => { deleted.push(key); bucket.objects.delete(key); },
  };
  const upload = (file, id = crypto.randomUUID()) => { const form = new FormData(); form.set('id', id); form.set('file', file); return call('POST', `/tables/${smart.id}/attachments`, form, alice, services, { VAULT_FILES: bucket }); };
  const png = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'receipt.png', { type: 'image/png' });
  const ok = await upload(png);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(Object.keys(ok.body.attachment.ref).sort(), ['id', 'name', 'size', 'type']);
  const [key] = [...bucket.objects.keys()];
  assert.ok(key.startsWith(`${alice.id}/persora-table/`));
  assert.equal(bucket.objects.get(key).customMetadata.ownerId, alice.id);
  // Refusals.
  assert.equal((await upload(new File(['<script>'], 'page.html', { type: 'text/html' }))).status, 415);
  assert.equal((await upload(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))).status, 415);
  assert.equal((await upload(new File([], 'empty.txt', { type: 'text/plain' }))).status, 400);
  assert.equal((await upload(new File([new Uint8Array(1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }))).status, 413);
  usage = 999;
  assert.equal((await upload(new File(['abc'], 'notes.txt', { type: 'text/plain' }))).status, 413);
  usage = 0;
  assert.equal(bucket.objects.size, 1);
  // Spreadsheets don't take files.
  const sheet = await createSheetTable(alice, 'No files');
  const form = new FormData(); form.set('id', crypto.randomUUID()); form.set('file', png);
  assert.equal((await call('POST', `/tables/${sheet.id}/attachments`, form, alice, services, { VAULT_FILES: bucket })).status, 400);
  // Serving: images inline with nosniff + sandbox CSP; ?download=1 forces a download.
  const served = await call('GET', `/tables/${smart.id}/attachments/${ok.body.attachment.id}`, undefined, alice, services, { VAULT_FILES: bucket });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.match(served.headers.get('content-disposition'), /^inline/);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /sandbox/);
  assert.equal(served.body.byteLength, 7);
  const download = await call('GET', `/tables/${smart.id}/attachments/${ok.body.attachment.id}?download=1`, undefined, alice, services, { VAULT_FILES: bucket });
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  // Non-images are always served as downloads.
  const txt = await upload(new File(['plain'], 'notes.txt', { type: 'text/plain' }));
  const txtServed = await call('GET', `/tables/${smart.id}/attachments/${txt.body.attachment.id}`, undefined, alice, services, { VAULT_FILES: bucket });
  assert.equal(txtServed.headers.get('content-type'), 'application/octet-stream');
  assert.match(txtServed.headers.get('content-disposition'), /^attachment/);
  // Reference the PNG from a record; the text file stays unreferenced. Opening
  // the table within the grace period keeps both; after it, only the PNG stays.
  const attachField = smart.meta.fields.find((field) => field.type === 'attachment');
  assert.ok(attachField, 'the expense template has an attachment field');
  const record = { ...smart.records[0], values: { ...smart.records[0].values, [attachField.id]: [ok.body.attachment.ref] } };
  assert.equal((await call('PUT', `/tables/${smart.id}/content`, batch(1, { records: { upsert: [record] } }))).status, 200);
  assert.equal((await call('GET', `/tables/${smart.id}`, undefined, alice, services, { VAULT_FILES: bucket })).body.attachments.length, 2);
  await db.query(`update persora_table_attachments set created_at = now() - interval '2 days' where table_id = $1`, [smart.id]);
  const pruned = await call('GET', `/tables/${smart.id}`, undefined, alice, services, { VAULT_FILES: bucket });
  assert.deepEqual(pruned.body.attachments.map((row) => row.name), ['receipt.png']);
  assert.equal(deleted.length, 1);
  assert.ok(bucket.objects.has(key));
});

test('people list and account export', async () => {
  const people = await call('GET', '/tables/people');
  assert.equal(people.status, 200);
  assert.equal(people.body.people[0].id, alice.id);
  assert.equal(people.body.people[0].me, true);
  const exported = await exportTableData(alice.id, env);
  assert.ok(exported.tables.length >= 5);
  assert.ok(exported.records.length > 0);
  assert.ok(exported.attachments.every((row) => row.file_key === undefined), 'storage keys are not exported in the manifest data');
  const bobExport = await exportTableData(bob.id, env);
  assert.ok(bobExport.tables.every((row) => !exported.tables.some((other) => other.id === row.id)));
});

test('missing migration maps to a clear 503', async () => {
  failNext = { name: 'persora_tables_list', response: () => Response.json({ code: 'PGRST202', message: 'Could not find the function' }, { status: 404 }) };
  const result = await call('GET', '/tables');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /202610300001_persora_table\.sql/);
  assert.ok(rpcLog.length > 0);
});
