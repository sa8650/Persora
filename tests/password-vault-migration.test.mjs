// One-time migration from the retired browser-encryption vault (Argon2id-wrapped
// key, AES-256-GCM records, escrowed key) to plain JSON records.
//
// Legacy data is produced with a frozen copy of the retired crypto module and
// written through the retired SQL functions, exactly as production stored it.
// Then 202610240001 is applied, records are converted with the escrow key
// (no Argon2id involved), legacy writes made by a still-running old release are
// re-converted, the cleanup migration refuses to run while anything is pending,
// and finally members open their kept passwords with a new master password.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handlePasswordVault } from '../cloudflare/password-vault.js';
import { migrateLegacyVaults } from '../cloudflare/password-vault-legacy-migration.js';

async function bundle(contents, name) {
  const out = await build({ stdin: { contents, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, external: ['hash-wasm'] });
  const path = join(await mkdtemp(join(tmpdir(), 'persora-vault-mig-')), name);
  await writeFile(path, out.outputFiles[0].text);
  return import(pathToFileURL(path).href);
}
const legacy = await bundle(`export * from './tests/fixtures/legacy-password-vault-crypto.ts';`, 'legacy.mjs');
const client = await bundle(`export * from './src/lib/password-vault-client.ts';`, 'client.mjs');
const { PasswordVaultSession, serverVaultBackend } = client;

class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function escrowKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keyId = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', raw))).slice(0, 22);
  return { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, escrow: { keyId, publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } } };
}
const current = await escrowKeyPair(); const retired = await escrowKeyPair(); const lost = await escrowKeyPair();

const { db, rpc, addMember, applyThrough } = await createVaultDatabase({ stopBefore: '202610240001' });
const entry = (title, password, extra = {}) => ({ id: crypto.randomUUID(), title, login: `${title.toLowerCase()}@example.test`, password, url: `https://${title.toLowerCase()}.example`, notes: `note for ${title}`, questions: [{ question: 'Q?', answer: `a-${title}` }], folder: '', favorite: false, pinned: false, updated: 1_700_000_000_000, ...extra });

/** Writes a vault exactly like the retired client + persora_password_vault_setup did (minus the Argon2id wrap, which the migration never uses). */
async function seedLegacyVault(userId, escrowKey, entries) {
  const dekRaw = legacy.generateDek();
  const dek = await legacy.importDek(dekRaw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const checkCipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(legacy.aad.check(userId, 1)) }, dek, new TextEncoder().encode(legacy.KEY_CHECK_PLAINTEXT));
  const keyCheck = { iv: legacy.toBase64(iv), ciphertext: legacy.toBase64(new Uint8Array(checkCipher)) };
  const vault = {
    kdf: legacy.DEFAULT_KDF, salt: legacy.toBase64(crypto.getRandomValues(new Uint8Array(16))),
    wrappedDek: { iv: legacy.toBase64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: legacy.toBase64(crypto.getRandomValues(new Uint8Array(48))) },
    keyCheck, escrow: await legacy.sealEscrow(escrowKey, userId, 1, dekRaw), escrowKeyId: escrowKey.keyId,
  };
  const items = [];
  for (const e of entries) items.push({ id: e.id, ...(await legacy.encryptEntry(dek, userId, 1, e)) });
  const result = await rpc('persora_password_vault_setup', { p_user_id: userId, p_vault: vault, p_items: items });
  assert.equal(result.outcome, 'created');
  return { dek };
}
async function legacyEdit(userId, dek, e, baseRevision) {
  const sealed = await legacy.encryptEntry(dek, userId, 1, e);
  const result = await rpc('persora_password_vault_apply', { p_user_id: userId, p_key_generation: 1, p_changes: [{ id: e.id, baseRevision, ...sealed }] });
  assert.equal(result.outcome, 'ok');
}
const rows = async (userId) => (await db.query('select * from public.password_vault_items where user_id = $1 order by id', [userId])).rows.map(({ id, user_id, data, deleted, revision, iv, ciphertext }) => ({ id, user_id, data, deleted, revision, iv, ciphertext }));
const strip = ({ id, ...rest }) => rest;
const env = { SUPABASE_SECRET_KEY: 'sb_secret_test_only', PASSWORD_VAULT_ESCROW_PRIVATE_KEY: JSON.stringify(current.jwk), PASSWORD_VAULT_ESCROW_RETIRED_KEYS: JSON.stringify([retired.jwk]) };

test('legacy encrypted vaults are converted with the escrow key, kept intact, and the old format is then removed', async () => {
  // ── Production state before this release ──
  const alice = await addMember('alice'); const bob = await addMember('bob'); const carol = await addMember('carol'); const dave = await addMember('dave');
  const admin = await addMember('admin', { role: 'admin' });
  const aMail = entry('Mail', 'mail-secret'); const aBank = entry('Bank', 'bank-secret', { pinned: true, folder: 'f1' }); const aOld = entry('Old', 'old-secret');
  const aShop = entry('Shop', 'shop-secret', { trash: { deletedAt: 1_700_000_000_000, expiresAt: 4_102_444_800_000 } });
  const { dek: aliceDek } = await seedLegacyVault(alice.id, current.escrow, [aMail, aBank, aOld, aShop]);
  const aBankV2 = { ...aBank, password: 'bank-secret-v2', updated: 1_700_000_000_500 };
  await legacyEdit(alice.id, aliceDek, aBankV2, 1);                                                    // revision 2
  assert.equal((await rpc('persora_password_vault_apply', { p_user_id: alice.id, p_key_generation: 1, p_changes: [{ id: aOld.id, baseRevision: 1, deleted: true }] })).outcome, 'ok'); // tombstone
  const bWork = entry('Work', 'work-secret');
  await seedLegacyVault(bob.id, retired.escrow, [bWork]);                                              // sealed to a rotated-out key
  const cLost = entry('Lost', 'lost-secret');
  await seedLegacyVault(carol.id, lost.escrow, [cLost]);                                               // key not available yet
  const dLazy = entry('Lazy', 'lazy-secret');
  await seedLegacyVault(dave.id, current.escrow, [dLazy]);
  const aliceBefore = await rows(alice.id);

  // ── Deploy step 1: additive migration; the old release keeps working ──
  await applyThrough('202610240001_password_vault_master_password.sql');
  assert.deepEqual((await rows(alice.id)).map((r) => ({ ...r, data: undefined })), aliceBefore.map((r) => ({ ...r, data: undefined })), 'nothing changes on apply');
  const legacyState = await rpc('persora_password_vault_state', { p_user_id: alice.id, p_since: 0 });
  assert.equal(legacyState.items.length, 3, 'the retired API still serves its ciphertext during the rollout');

  // ── New release: a member opening the vault converts their own records (lazy path) ──
  const services = { rpc, prepareRecoveryEmail: async () => async () => {} };
  const call = async (identity, path, init = {}) => {
    const response = await handlePasswordVault(new Request(`https://persora.test/api/password-vault${path}`, { method: init.method || 'GET', headers: { 'Content-Type': 'application/json', ...(init.token ? { 'X-Persora-Vault-Token': init.token } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined }), identity, env, 'https://persora.test', services);
    return { status: response.status, body: await response.json() };
  };
  const daveStatus = await call(dave, '');
  assert.deepEqual(daveStatus.body, { hasVault: false, records: 1, pending: 0, recoveryAvailable: true });
  assert.deepEqual((await rows(dave.id))[0].data, strip(dLazy));

  // ── Batch conversion: dry run changes nothing ──
  const dry = (await call(admin, '/admin/migrate-legacy', { method: 'POST', body: { dryRun: true } })).body;
  assert.equal(dry.dryRun, true);
  assert.equal(dry.converted, 4, 'alice 3 (tombstones hold no ciphertext) + bob 1; carol has no key'); assert.equal(dry.pending, 5);
  assert.equal((await rows(alice.id)).filter((r) => r.data).length, 0);
  // Members can't trigger the batch; administrators can.
  assert.equal((await call(alice, '/admin/migrate-legacy', { method: 'POST', body: {} })).status, 404);
  const report = (await call(admin, '/admin/migrate-legacy', { method: 'POST', body: {} })).body;
  assert.equal(report.converted, 4);
  assert.deepEqual(report.failed, [{ userId: carol.id, records: 1, reason: 'escrow_key_unavailable' }]);
  assert.equal(report.pending, 1);
  assert.ok(!JSON.stringify(report).includes('secret'), 'reports never include record contents');

  // Converted records equal the originals; ids, revisions, ownership and tombstones are preserved.
  const alice1 = await rows(alice.id);
  const byId = Object.fromEntries(alice1.map((r) => [r.id, r]));
  assert.deepEqual(byId[aMail.id].data, strip(aMail));
  assert.deepEqual(byId[aBank.id].data, strip(aBankV2)); assert.equal(byId[aBank.id].revision, 2);
  assert.deepEqual(byId[aShop.id].data, strip(aShop));
  assert.equal(byId[aOld.id].deleted, true); assert.equal(byId[aOld.id].data, null);
  assert.ok(alice1.every((r) => r.user_id === alice.id && r.iv === null && r.ciphertext === null));
  assert.deepEqual((await rows(bob.id))[0].data, strip(bWork), 'records sealed to a retired escrow key are converted too');

  // ── The old release is still serving for a moment and writes ciphertext again ──
  const aMailV2 = { ...aMail, password: 'mail-secret-v2', updated: 1_700_000_001_000 };
  await legacyEdit(alice.id, aliceDek, aMailV2, 1);
  const pendingRow = (await rows(alice.id)).find((r) => r.id === aMail.id);
  assert.equal(pendingRow.data, null, 'a legacy write turns the row back into pending (no stale JSON)');
  assert.equal((await migrateLegacyVaults({ rpc, env })).converted, 1);
  assert.deepEqual((await rows(alice.id)).find((r) => r.id === aMail.id).data, strip(aMailV2));

  // ── Cleanup refuses while anything is pending, and drops nothing ──
  await assert.rejects(applyThrough('202610240002_password_vault_drop_legacy_encryption.sql'), /still in the legacy encrypted format/);
  const columns = async (table) => (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name).sort();
  assert.ok((await columns('password_vault_items')).includes('ciphertext'));
  // The operator adds the missing older key and re-runs.
  const fixedEnv = { ...env, PASSWORD_VAULT_ESCROW_RETIRED_KEYS: JSON.stringify([retired.jwk, lost.jwk]) };
  const final = await migrateLegacyVaults({ rpc, env: fixedEnv });
  assert.equal(final.converted, 1); assert.equal(final.pending, 0); assert.deepEqual(final.failed, []);
  await db.exec(await (await import('node:fs/promises')).readFile(new URL('../supabase/migrations/202610240002_password_vault_drop_legacy_encryption.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await columns('password_vault_items'), ['change_seq', 'created_at', 'data', 'deleted', 'id', 'revision', 'updated_at', 'user_id']);
  assert.deepEqual(await columns('password_vaults'), ['created_at', 'master_password_changed_at', 'master_password_hash', 'updated_at', 'user_id']);
  const legacyFns = (await db.query(`select proname from pg_proc where proname in ('persora_password_vault_state','persora_password_vault_setup','persora_password_vault_apply','persora_password_vault_update_escrow','persora_vault_recovery_release','persora_vault_recovery_complete','persora_vault_legacy_pending','persora_vault_legacy_store')`)).rows;
  assert.deepEqual(legacyFns, [], 'retired functions are gone');

  // ── After cleanup: members create a master password and find everything ──
  globalThis.fetch = async (input, init = {}) => handlePasswordVault(new Request(new URL(String(input), 'https://persora.test'), init), actingAs, env, 'https://persora.test', services);
  let actingAs = alice;
  const laptop = new PasswordVaultSession(alice.id, serverVaultBackend(), new MemoryStorage());
  const status = await laptop.status();
  assert.equal(status.hasVault, false); assert.equal(status.records, 3);
  const opened = await laptop.open('alice new master password');
  assert.deepEqual(opened.entries.sort((a, b) => a.title.localeCompare(b.title)), [aBankV2, aMailV2, aShop].sort((a, b) => a.title.localeCompare(b.title)));
  // Full CRUD still works on the final schema.
  const added = entry('Added', 'added-secret');
  await laptop.save([...opened.entries.filter((e) => e.id !== aShop.id), added]);
  assert.equal((await rows(alice.id)).filter((r) => !r.deleted).length, 3);
  actingAs = carol;
  const carolDevice = new PasswordVaultSession(carol.id, serverVaultBackend(), new MemoryStorage());
  await carolDevice.status();
  assert.deepEqual((await carolDevice.open('carol new master password')).entries, [cLost]);
});

async function legacyV1(entries, password) {
  const enc = new TextEncoder(); const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(entries)));
  const b64 = (u) => Buffer.from(u).toString('base64');
  return JSON.stringify({ salt: b64(salt), iv: b64(iv), cipher: b64(new Uint8Array(cipher)) });
}
async function legacyV2(entries, password) {
  const enc = new TextEncoder(); const b64 = (u) => Buffer.from(u).toString('base64');
  const dek = crypto.getRandomValues(new Uint8Array(32)); const masterSalt = crypto.getRandomValues(new Uint8Array(16)); const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
  const recoveryRaw = crypto.getRandomValues(new Uint8Array(32)); const recoveryKey = Buffer.from(recoveryRaw).toString('base64url');
  const pb = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const m = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: masterSalt, iterations: 310000 }, pb, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const hk = await crypto.subtle.importKey('raw', recoveryRaw, 'HKDF', false, ['deriveKey']);
  const r = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: recoverySalt, info: enc.encode('persora-password-vault-recovery-v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const d = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const sealWith = async (key, data) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), c: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))) }; };
  const mw = await sealWith(m, dek); const rw = await sealWith(r, dek); const data = await sealWith(d, enc.encode(JSON.stringify(entries)));
  return { recoveryKey, raw: JSON.stringify({ version: 2, kdf: 'PBKDF2-SHA-256', iterations: 310000, masterSalt: b64(masterSalt), recoverySalt: b64(recoverySalt), dataIv: data.iv, dataCiphertext: data.c, masterIv: mw.iv, masterWrap: mw.c, recoveryIv: rw.iv, recoveryWrap: rw.c }) };
}

test('pre-sync on-device vaults (v1/v2 in localStorage) are imported into the synced vault and removed', async () => {
  const erin = await addMember('erin');
  const services = { rpc };
  globalThis.fetch = async (input, init = {}) => handlePasswordVault(new Request(new URL(String(input), 'https://persora.test'), init), erin, { SUPABASE_SECRET_KEY: 'x' }, 'https://persora.test', services);
  const key = `persora-password-vault-v1:${erin.id}`;
  const MASTER = 'erin master password';
  // Device 1 had a v1 vault with the same password the member now chooses → imported on open.
  const storage = new MemoryStorage();
  storage.setItem(key, await legacyV1([entry('Local', 'local-secret', { id: 'legacy-1' })], MASTER));
  const laptop = new PasswordVaultSession(erin.id, serverVaultBackend(), storage);
  assert.equal((await laptop.status()).hasLegacy, true);
  const opened = await laptop.open(MASTER);
  assert.equal(opened.created, true); assert.equal(opened.migratedCount, 1); assert.equal(opened.legacyPending, false);
  assert.equal(opened.entries[0].title, 'Local'); assert.match(opened.entries[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(storage.getItem(key), null, 'local copy removed after upload');
  assert.equal((await rows(erin.id))[0].data.password, 'local-secret');
  // Device 2 had a v2 vault under an older, different password → kept until the member supplies it.
  const storage2 = new MemoryStorage();
  const v2 = await legacyV2([entry('Phone', 'phone-secret'), entry('Wifi', 'wifi-secret')], 'old phone password');
  storage2.setItem(key, v2.raw);
  const phone = new PasswordVaultSession(erin.id, serverVaultBackend(), storage2);
  await phone.status();
  const phoneOpen = await phone.open(MASTER);
  assert.equal(phoneOpen.legacyPending, true); assert.equal(phoneOpen.migratedCount, 0); assert.equal(phoneOpen.entries.length, 1);
  assert.ok(storage2.getItem(key), 'not removed while it could not be read');
  await assert.rejects(phone.mergeLegacy('not the right one'), /isn't right|could not|doesn't|incorrect/i);
  const merged = await phone.mergeLegacy(v2.recoveryKey); // the v2 offline recovery key also works
  assert.equal(merged.merged, 2); assert.equal(merged.entries.length, 3);
  assert.equal(storage2.getItem(key), null);
  // Visible on the first device too.
  assert.equal((await laptop.sync()).length, 3);
});
