// Persora Connections (EMS) worker routes: admin integration settings, the
// no-redirect EMS connect flow, persistent/reauth connection states, the
// read-only file proxy, "save a copy" into Persora storage and disconnect.
// Supabase REST and the EMS server are both faked in-process; the fake EMS
// verifies every request's HMAC signature independently with node:crypto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { handleConnections, handleIntegrationAdmin, canonicalRequest, normalizeBaseUrl, CONNECTION_PROVIDERS } from '../cloudflare/connections.js';

const USER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const OTHER_USER = '5b2c3d4e-5f60-4789-8a1b-2c3d4e5f6a7b';
const ADMIN = '9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const STORE = '11111111-2222-4333-8444-555555555555';
const FILE_PDF = '21111111-2222-4333-8444-555555555555';
const FILE_SVG = '31111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://persora.example';
const SECRET = 'shared-integration-secret-0123456789-abcdef';
const EMS_BASE = 'https://ems.example.test';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const identity = { id: USER, email: 'member@persora.test', login_id: '1234567' };
const adminIdentity = { id: OTHER_USER, email: 'admin@persora.test' };

/* ---------------- in-memory PostgREST ---------------- */
function createDb() {
  const tables = { integration_settings: [], user_connections: [], vault_folders: [] };
  const match = (row, params) => {
    for (const [key, value] of params) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(key)) continue;
      const [op, ...rest] = value.split('.');
      const operand = rest.join('.');
      if (op === 'eq' && String(row[key]) !== operand) return false;
      if (op === 'ilike' && String(row[key] ?? '').toLowerCase() !== operand.toLowerCase()) return false;
    }
    return true;
  };
  async function handle(url, init) {
    const table = url.pathname.split('/').pop();
    const rows = tables[table];
    if (!rows) return Response.json({ code: '42P01', message: 'missing' }, { status: 404 });
    const method = init.method || 'GET';
    const params = [...url.searchParams.entries()];
    const body = init.body ? JSON.parse(init.body) : null;
    const minimal = String(init.headers?.Prefer || '').includes('return=minimal');
    const out = (value, status = 200) => (minimal ? new Response(null, { status: 204 }) : Response.json(value, { status }));
    if (method === 'GET') return Response.json(rows.filter((r) => match(r, params)));
    if (method === 'POST') {
      const conflict = url.searchParams.get('on_conflict');
      if (conflict) {
        const cols = conflict.split(',');
        const existing = rows.find((r) => cols.every((c) => String(r[c]) === String(body[c])));
        if (existing) { Object.assign(existing, body); return out([existing]); }
      }
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), metadata: {}, ...body };
      rows.push(row);
      return out([row], 201);
    }
    if (method === 'PATCH') { const hit = rows.filter((r) => match(r, params)); hit.forEach((r) => Object.assign(r, body)); return out(hit); }
    if (method === 'DELETE') { const keep = rows.filter((r) => !match(r, params)); const gone = rows.length - keep.length; tables[table] = keep; return out(Array(gone).fill({})); }
    return new Response('bad', { status: 400 });
  }
  return { tables, handle };
}

/* ---------------- fake EMS ---------------- */
function createEms({ secret = SECRET } = {}) {
  const state = { calls: [], down: false, grantValid: true, enabled: true, revoked: [], eligible: true, issued: [] };
  async function handle(url, init) {
    if (state.down) throw new TypeError('fetch failed');
    const headers = new Headers(init.headers);
    const method = init.method || 'GET';
    const raw = init.body || '';
    const grant = headers.get('x-ems-grant') || '';
    const expected = createHmac('sha256', secret).update(canonicalRequest({
      timestamp: headers.get('x-persora-timestamp'), nonce: headers.get('x-persora-nonce'), method, pathWithQuery: url.pathname + url.search, bodyHash: sha(raw), grantHash: sha(grant),
    })).digest('hex');
    const path = url.pathname.replace(/^\/api\/persora\//, '');
    state.calls.push({ path, method, search: url.search, grant, body: raw ? JSON.parse(raw) : null });
    const err = (code, status) => Response.json({ error: code, code }, { status });
    if (!state.enabled) return err('integration_disabled', 403);
    if (headers.get('x-persora-signature') !== expected) return err('signature_invalid', 401);
    if (path === 'ping') return Response.json({ ok: true });
    if (path === 'authorize') {
      const b = JSON.parse(raw);
      if (b.password !== 'ems-password') return err('invalid_credentials', 401);
      if (!state.eligible) return err('vaultium_not_eligible', 403);
      const g = `pg1_${'g'.repeat(40)}${state.issued.length}`;
      state.issued.push(g);
      return Response.json({ grant: g, grant_id: 'grant-1', admin: { id: ADMIN, name: 'Alpha Admin', email: b.email, admin_code: 'ADM-1' }, eligibility: { eligible: true, sources: ['license'] }, expires_at: '2027-04-01T00:00:00Z' }, { status: 201 });
    }
    if (!state.grantValid || !state.issued.includes(grant) || state.revoked.includes(grant)) return err('grant_invalid', 401);
    if (path === 'revoke') { state.revoked.push(grant); return Response.json({ ok: true }); }
    if (method !== 'GET') return err('read_only', 405);
    if (path === 'account') return Response.json({ admin: { id: ADMIN, name: 'Alpha Admin', email: 'alpha@ems.test', admin_code: 'ADM-1' }, eligibility: { eligible: true }, stores: [{ id: STORE, name: 'Alpha Main', shop_code: 'A1', status: 'active', shop_type: 'electronics', file_count: 2 }, { id: 'not-a-uuid', name: 'Bad' }], total_files: 2 });
    if (path === 'files') return Response.json({ files: [
      { id: FILE_PDF, store_id: STORE, filename: 'receipt.pdf', content_type: 'application/pdf', size_bytes: 11, created_at: '2026-10-01T00:00:00Z', invoice_number: 'SAL-1', category: 'invoice', r2_key: 'should-not-leak' },
      { id: FILE_SVG, store_id: STORE, filename: 'logo.svg', content_type: 'image/svg+xml', size_bytes: 20, created_at: '2026-10-01T00:00:00Z', category: 'file' },
    ], total: 2, has_more: false });
    const m = path.match(/^files\/([^/]+)\/content$/);
    if (m) {
      const isPdf = m[1] === FILE_PDF;
      const bytes = isPdf ? '%PDF-1.4 ok' : '<svg onload="alert(1)"/>';
      return new Response(bytes, { headers: { 'content-type': isPdf ? 'application/pdf' : 'image/svg+xml', 'x-ems-file-name': encodeURIComponent(isPdf ? 'receipt.pdf' : 'logo.svg'), 'x-ems-file-size': String(bytes.length), 'x-ems-store-id': STORE, 'x-ems-reference': 'SAL-1' } });
    }
    return err('not_found', 404);
  }
  return { state, handle };
}

function bucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) { objects.set(key, { bytes: new Uint8Array(value), ...options }); },
    async delete(key) { objects.delete(key); },
    async get(key) { const e = objects.get(key); return e ? { body: new Blob([e.bytes]).stream(), size: e.bytes.byteLength, customMetadata: e.customMetadata } : null; },
  };
}

function setup({ emsSecret = SECRET } = {}) {
  const db = createDb();
  const ems = createEms({ secret: emsSecret });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === 'https://db.example.test') return db.handle(url, init);
    if (url.origin === EMS_BASE) return ems.handle(url, init);
    throw new Error(`unexpected fetch ${url}`);
  };
  const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'service-key', CONNECTIONS_ENCRYPTION_KEY: 'k'.repeat(48), VAULT_FILES: bucket() };
  const attempts = [];
  const saved = [];
  const services = {
    rateLimit: { blocked: async () => null, record: async (fp, ok, limit) => { attempts.push({ fp, ok, limit }); return null; } },
    hasUploadPlan: async () => true,
    uploadPlanError: () => Object.assign(new Error('File uploads require an active paid plan.'), { status: 403 }),
    maxUploadMb: async () => 25,
    storageUsage: async () => ({ bytesUsed: 0, storageLimitBytes: 5 * 1024 ** 3, storageLimitGb: 5, planName: 'Plus' }),
    saveVaultItem: async (who, body) => { saved.push({ who, body }); return { id: body.id, title: body.title }; },
    saveVaultFolder: async (who, body) => { const row = { id: crypto.randomUUID(), user_id: who.id, ...body }; db.tables.vault_folders.push(row); return row; },
  };
  const req = (path, { method = 'GET', body } = {}) => new Request(`${ORIGIN}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const call = (path, opts) => handleConnections(req(path, opts), identity, env, ORIGIN, services);
  const admin = (path, opts) => handleIntegrationAdmin(req(path, opts), adminIdentity, env, ORIGIN, { logAdminEvent: async () => {} });
  const configure = async (extra = {}) => { const r = await admin('/admin/integrations/ems', { method: 'POST', body: { enabled: true, baseUrl: EMS_BASE, secret: SECRET, ...extra } }); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
  const connect = () => call('/connections/ems/connect', { method: 'POST', body: { email: 'alpha@ems.test', password: 'ems-password' } });
  return { db, ems, env, services, attempts, saved, call, admin, configure, connect };
}

test('registry lists EMS plus extensible coming-soon providers; EMS is unavailable until configured', async () => {
  const t = setup();
  const data = await (await t.call('/connections')).json();
  assert.equal(data.providers.length, CONNECTION_PROVIDERS.length);
  const ems = data.providers.find((p) => p.id === 'ems');
  assert.equal(ems.status, 'unavailable');
  assert.ok(data.providers.filter((p) => p.id !== 'ems').every((p) => p.status === 'coming_soon' && !p.enabled));
  await t.configure();
  const after = await (await t.call('/connections')).json();
  assert.equal(after.providers.find((p) => p.id === 'ems').status, 'not_connected');
});

test('admin settings: validation, masked secret, encrypted at rest, connection test', async () => {
  const t = setup();
  assert.equal((await t.admin('/admin/integrations/ems', { method: 'POST', body: { enabled: true } })).status, 400, 'cannot enable without URL + secret');
  assert.equal((await t.admin('/admin/integrations/ems', { method: 'POST', body: { secret: 'short' } })).status, 400);
  assert.equal((await t.admin('/admin/integrations/ems', { method: 'POST', body: { baseUrl: 'http://ems.example.test' } })).status, 400, 'https required');
  assert.equal(normalizeBaseUrl('http://localhost:8788/'), 'http://localhost:8788');
  assert.throws(() => normalizeBaseUrl('https://user:pw@ems.test'));
  const status = await t.configure();
  assert.equal(status.ready, true);
  assert.equal(status.secretHint, '••••' + SECRET.slice(-4));
  assert.ok(!JSON.stringify(status).includes(SECRET), 'secret is never returned');
  const row = t.db.tables.integration_settings[0];
  assert.match(row.secret_ciphertext, /^v1\./);
  assert.ok(!JSON.stringify(row).includes(SECRET), 'secret is encrypted at rest');
  // Saving other fields keeps the stored secret.
  await t.admin('/admin/integrations/ems', { method: 'POST', body: { enabled: true } });
  assert.equal(t.db.tables.integration_settings[0].secret_ciphertext, row.secret_ciphertext);
  let test1 = await (await t.admin('/admin/integrations/ems/test', { method: 'POST', body: {} })).json();
  assert.equal(test1.ok, true);
  // Mismatched secret is reported clearly.
  const m = setup({ emsSecret: 'a-different-secret-on-the-ems-side-000000' });
  await m.configure();
  test1 = await (await m.admin('/admin/integrations/ems/test', { method: 'POST', body: {} })).json();
  assert.equal(test1.ok, false);
  assert.match(test1.message, /do not match/);
});

test('connect: credentials go server-to-server once, only an encrypted grant is stored', async () => {
  const t = setup();
  await t.configure();
  let r = await t.call('/connections/ems/connect', { method: 'POST', body: { email: 'alpha@ems.test', password: 'wrong' } });
  assert.equal(r.status, 400, 'wrong EMS password is not a Persora 401');
  assert.equal((await r.json()).code, 'invalid_credentials');
  assert.equal(t.attempts.filter((a) => !a.ok).length, 2, 'per-user and per-IP failures recorded');
  r = await t.connect();
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.equal(data.connection.status, 'connected');
  assert.equal(data.connection.account.email, 'alpha@ems.test');
  const text = JSON.stringify(data);
  assert.ok(!text.includes('pg1_') && !text.includes('ems-password'), 'grant/password never reach the browser');
  const row = t.db.tables.user_connections[0];
  assert.match(row.credential_ciphertext, /^v1\./);
  assert.ok(!JSON.stringify(row).includes('pg1_') && !JSON.stringify(row).includes('ems-password'));
  assert.equal(t.ems.state.calls.find((c) => c.path === 'authorize').body.persora_user_ref, USER);
  // Rate limiting.
  t.services.rateLimit.blocked = async () => new Date(Date.now() + 60_000).toISOString();
  assert.equal((await t.connect()).status, 429);
});

test('Vaultium-ineligible EMS accounts are refused', async () => {
  const t = setup();
  await t.configure();
  t.ems.state.eligible = false;
  const r = await t.connect();
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'vaultium_not_eligible');
  assert.equal(t.db.tables.user_connections.length, 0);
});

test('connection persists through EMS outages and flips to reauth_required when EMS revokes it', async () => {
  const t = setup();
  await t.configure();
  await t.connect();
  let data = await (await t.call('/connections/ems')).json();
  assert.equal(data.status, 'connected');
  assert.deepEqual(data.account.stores.map((s) => s.id), [STORE], 'invalid ids from upstream are dropped');
  t.ems.state.down = true;
  data = await (await t.call('/connections/ems')).json();
  assert.equal(data.status, 'connected');
  assert.equal(data.degraded, true);
  assert.equal(data.account.stores[0].name, 'Alpha Main', 'cached shops shown while EMS is down');
  assert.equal(t.db.tables.user_connections.length, 1, 'temporary failure keeps the connection');
  assert.equal((await t.call('/connections/ems/files')).status, 502);
  t.ems.state.down = false;
  // Persora admin disables the integration: blocked, but nothing is deleted.
  await t.admin('/admin/integrations/ems', { method: 'POST', body: { enabled: false } });
  assert.equal((await t.call('/connections/ems/files')).status, 503);
  data = await (await t.call('/connections/ems')).json();
  assert.equal(data.integrationReady, false);
  assert.equal(t.db.tables.user_connections[0].status, 'connected');
  await t.admin('/admin/integrations/ems', { method: 'POST', body: { enabled: true } });
  // EMS side disabled → unavailable, not reauth.
  t.ems.state.enabled = false;
  const r = await t.call('/connections/ems/files');
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'integration_unavailable');
  t.ems.state.enabled = true;
  // EMS revokes the grant (password change, owner revoke-all, expiry …).
  t.ems.state.grantValid = false;
  data = await (await t.call('/connections/ems')).json();
  assert.equal(data.status, 'reauth_required');
  assert.equal(t.db.tables.user_connections[0].status, 'reauth_required');
  const files = await t.call('/connections/ems/files');
  assert.equal(files.status, 409);
  assert.equal((await files.json()).code, 'reauth_required');
  // Reconnect from inside Persora restores access on the same row.
  t.ems.state.grantValid = true;
  assert.equal((await t.connect()).status, 201);
  assert.equal(t.db.tables.user_connections.length, 1);
  assert.equal((await (await t.call('/connections/ems')).json()).status, 'connected');
});

test('file browser and proxy: validated ids, safe inline types only, read-only', async () => {
  const t = setup();
  await t.configure();
  await t.connect();
  assert.equal((await t.call('/connections/ems/files?storeId=1;drop')).status, 400);
  let r = await t.call(`/connections/ems/files?storeId=${STORE}&q=sal&limit=500`);
  const list = await r.json();
  assert.equal(list.files.length, 2);
  assert.ok(list.files.every((f) => !('r2_key' in f)));
  const forwarded = t.ems.state.calls.filter((c) => c.path === 'files').pop();
  assert.equal(new URLSearchParams(forwarded.search).get('store_id'), STORE);
  assert.equal(new URLSearchParams(forwarded.search).get('limit'), '100', 'limit is clamped');
  r = await t.call(`/connections/ems/files/${FILE_PDF}?disposition=inline`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^inline/);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(await r.text(), '%PDF-1.4 ok');
  r = await t.call(`/connections/ems/files/${FILE_SVG}?disposition=inline`);
  assert.match(r.headers.get('content-disposition'), /^attachment/, 'SVG is never rendered inline');
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.equal((await t.call('/connections/ems/files/..%2Faccount')).status, 404);
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) assert.equal((await t.call(`/connections/ems/files/${FILE_PDF}`, { method, body: {} })).status, 405, method);
  assert.ok(t.ems.state.calls.every((c) => c.method === 'GET' || ['authorize', 'revoke', 'ping'].includes(c.path)), 'only GETs reach EMS file routes');
});

test('save a copy: plan + quota enforced, independent R2 copy + vault item, cleanup on failure', async () => {
  const t = setup();
  await t.configure();
  await t.connect();
  await t.call('/connections/ems'); // caches shop names
  t.services.hasUploadPlan = async () => false;
  assert.equal((await t.call(`/connections/ems/files/${FILE_PDF}/save`, { method: 'POST', body: {} })).status, 403);
  t.services.hasUploadPlan = async () => true;
  t.services.storageUsage = async () => ({ bytesUsed: 5 * 1024 ** 3, storageLimitBytes: 5 * 1024 ** 3, storageLimitGb: 5, planName: 'Plus' });
  assert.equal((await t.call(`/connections/ems/files/${FILE_PDF}/save`, { method: 'POST', body: {} })).status, 413);
  assert.equal(t.env.VAULT_FILES.objects.size, 0);
  t.services.storageUsage = async () => ({ bytesUsed: 0, storageLimitBytes: 5 * 1024 ** 3, storageLimitGb: 5, planName: 'Plus' });
  const r = await t.call(`/connections/ems/files/${FILE_PDF}/save`, { method: 'POST', body: {} });
  assert.equal(r.status, 201, await r.clone().text());
  const data = await r.json();
  assert.equal(data.item.folderName, 'EMS Vaultium');
  const [key, object] = [...t.env.VAULT_FILES.objects.entries()][0];
  assert.match(key, new RegExp(`^${USER}/[0-9a-f-]{36}-receipt\\.pdf$`));
  assert.equal(object.customMetadata.ownerId, USER);
  assert.equal(new TextDecoder().decode(object.bytes), '%PDF-1.4 ok');
  const { body } = t.saved[0];
  assert.equal(body.section, 'documents');
  assert.equal(body.file.key, key);
  assert.equal(body.metadata.source, 'EMS Vaultium');
  assert.equal(body.metadata.documentNumber, 'SAL-1');
  assert.match(body.subtitle, /Alpha Main/);
  assert.equal(body.folderId, t.db.tables.vault_folders[0].id);
  // Second save reuses the folder.
  await t.call(`/connections/ems/files/${FILE_PDF}/save`, { method: 'POST', body: {} });
  assert.equal(t.db.tables.vault_folders.length, 1);
  // A failing vault write leaves no orphaned object.
  t.services.saveVaultItem = async () => { throw Object.assign(new Error('nope'), { status: 500 }); };
  const before = t.env.VAULT_FILES.objects.size;
  assert.equal((await t.call(`/connections/ems/files/${FILE_PDF}/save`, { method: 'POST', body: {} })).status, 500);
  assert.equal(t.env.VAULT_FILES.objects.size, before);
});

test('disconnect revokes the EMS grant best-effort and removes only Persora\'s row', async () => {
  const t = setup();
  await t.configure();
  await t.connect();
  let r = await t.call('/connections/ems', { method: 'DELETE' });
  assert.deepEqual(await r.json(), { ok: true, remoteRevoked: true });
  assert.equal(t.ems.state.revoked.length, 1);
  assert.equal(t.db.tables.user_connections.length, 0);
  // Works even when EMS is unreachable.
  await t.connect();
  t.ems.state.down = true;
  r = await t.call('/connections/ems', { method: 'DELETE' });
  assert.deepEqual(await r.json(), { ok: true, remoteRevoked: false });
  assert.equal(t.db.tables.user_connections.length, 0);
  assert.equal((await (await t.call('/connections/ems')).json()).status, 'not_connected');
});

test('stored grants are bound to their member and fail closed without an encryption key', async () => {
  const t = setup();
  await t.configure();
  await t.connect();
  // A row copied to another member cannot be decrypted with that member's key.
  t.db.tables.user_connections[0].user_id = OTHER_USER;
  const other = await handleConnections(new Request(`${ORIGIN}/api/connections/ems/files`), { id: OTHER_USER }, t.env, ORIGIN, t.services);
  assert.equal(other.status, 409);
  const noKey = setup();
  delete noKey.env.CONNECTIONS_ENCRYPTION_KEY;
  const r = await noKey.admin('/admin/integrations/ems', { method: 'POST', body: { enabled: true, baseUrl: EMS_BASE, secret: SECRET } });
  assert.equal(r.status, 503);
});
