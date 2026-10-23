// End-to-end Password Manager tests: the real browser modules (crypto, client
// session, server backend over fetch) talk to the real Pages Functions handler
// (cloudflare/password-vault.js), which runs the real SQL migrations in PGlite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handlePasswordVault } from '../cloudflare/password-vault.js';
import api from '../cloudflare/api.js';

const bundle = await build({
  stdin: {
    contents: `export * from './src/lib/password-vault-client.ts'; export * from './src/lib/password-vault-sync.ts'; export * as vaultCrypto from './src/lib/password-vault-crypto.ts';`,
    resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' },
});
const bundlePath = join(await mkdtemp(join(tmpdir(), 'persora-vault-')), 'client.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const client = await import(pathToFileURL(bundlePath).href);
const { PasswordVaultSession, serverVaultBackend, deviceVaultBackend, VaultConflictError, VaultKeyChangedError, vaultCrypto } = client;

const escrowPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const ESCROW_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', escrowPair.privateKey));
const baseEnv = { SUPABASE_SECRET_KEY: 'sb_secret_test_only', PASSWORD_VAULT_ESCROW_PRIVATE_KEY: ESCROW_JWK };

class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

const { db, rpc, addProfile } = await createVaultDatabase();
const mail = [];
let actingAs = null;
let env = baseEnv;
let clockOffsetMs = 0;
const services = {
  rpc,
  now: () => new Date(Date.now() + clockOffsetMs),
  prepareRecoveryEmail: async () => async (message) => { mail.push(message); },
};
const loggedErrors = [];
const originalError = console.error;
console.error = (...args) => { loggedErrors.push(args.map(String).join(' ')); };
test.after(() => { console.error = originalError; });

globalThis.fetch = async (input, init = {}) => {
  const request = new Request(new URL(String(input), 'https://persora.test'), init);
  if (!actingAs) return new Response(JSON.stringify({ error: 'Sign in to open your password vault.' }), { status: 401 });
  return handlePasswordVault(request, actingAs, env, 'https://persora.test', services);
};

async function member(label) {
  const identity = { id: crypto.randomUUID(), email: `${label}-${crypto.randomUUID()}@example.test`, account_status: 'active' };
  await addProfile(identity.id, identity.email);
  return identity;
}
function device(identity, storage = new MemoryStorage()) {
  const session = new PasswordVaultSession(identity.id, serverVaultBackend(), storage);
  return { session, storage, as: async (fn) => { actingAs = identity; return fn(session); } };
}
const entry = (title, password, extra = {}) => ({ id: crypto.randomUUID(), title, login: `${title.toLowerCase()}@example.test`, password, url: `https://${title.toLowerCase()}.example`, notes: `note for ${title}`, questions: [{ question: 'First pet?', answer: `answer-${title}` }], folder: '', favorite: false, pinned: false, updated: Date.now(), ...extra });
const MASTER = 'correct horse battery staple';

async function dbDump(userId) {
  const vaults = await db.query('select * from public.password_vaults where user_id = $1', [userId]);
  const items = await db.query('select * from public.password_vault_items where user_id = $1', [userId]);
  return JSON.stringify({ vaults: vaults.rows, items: items.rows });
}
async function lastCode(to) {
  const message = [...mail].reverse().find((item) => item.to === to);
  return /(\d{6})/.exec(message.textContent)[1];
}
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

test('initial setup creates an Argon2id/AES-256-GCM vault; the database never holds plaintext', async () => {
  const alice = await member('setup');
  const laptop = device(alice);
  const status = await laptop.as((s) => s.status());
  assert.equal(status.hasVault, false); assert.equal(status.canCreate, true); assert.equal(status.recoveryAvailable, true);
  const opened = await laptop.as((s) => s.open(MASTER));
  assert.equal(opened.created, true);
  const github = entry('GitHub', 'gh-Secret-Pa55word!');
  await laptop.as((s) => s.save([github]));
  const row = (await db.query('select kdf, key_generation, wrapped_dek, escrow from public.password_vaults where user_id = $1', [alice.id])).rows[0];
  assert.deepEqual(row.kdf, { algorithm: 'argon2id', version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1 });
  assert.equal(row.key_generation, 1);
  assert.equal(Buffer.from(row.wrapped_dek.ciphertext, 'base64').length, 48, 'AES-256-GCM wrap of a 32-byte key');
  const dump = await dbDump(alice.id);
  for (const secret of [MASTER, 'gh-Secret-Pa55word!', 'GitHub', 'github@example.test', 'note for GitHub', 'answer-GitHub', 'https://github.example']) {
    assert.ok(!dump.includes(secret), `database must not contain ${secret}`);
  }
  assert.equal((await db.query('select count(*)::int as n from public.password_vault_items where user_id = $1', [alice.id])).rows[0].n, 1);
});

test('unlock on another device, wrong master password, and attempt throttling', async () => {
  const bob = await member('unlock');
  const phone = device(bob); const tablet = device(bob);
  await phone.as((s) => s.open(MASTER));
  const mail1 = entry('Mail', 'mail-pass-1');
  await phone.as((s) => s.save([mail1]));
  const status = await tablet.as((s) => s.status());
  assert.equal(status.hasServerVault, true);
  await assert.rejects(tablet.as((s) => s.open('definitely the wrong one')), (error) => error.name === 'WrongMasterPasswordError');
  assert.equal(tablet.session.isUnlocked, false);
  const opened = await tablet.as((s) => s.open(MASTER));
  assert.deepEqual(opened.entries, [mail1]);
  // Five wrong attempts in a row trigger an escalating cool-down, even for the right password.
  const fresh = device(bob);
  for (let i = 0; i < 5; i++) await assert.rejects(fresh.as((s) => s.open(`wrong password ${i}!!`)));
  await assert.rejects(fresh.as((s) => s.open(MASTER)), /Too many incorrect attempts/);
  await assert.rejects(fresh.as((s) => s.open('short')), /Too many|at least 10/);
});

test('cross-device sync: add, edit, delete and conflict protection', async () => {
  const carol = await member('sync');
  const a = device(carol); const b = device(carol);
  await a.as((s) => s.open(MASTER));
  await b.as((s) => s.open(MASTER));
  const bank = entry('Bank', 'bank-pass-1');
  await a.as((s) => s.save([bank]));
  assert.deepEqual(await b.as((s) => s.sync()), [bank]);
  assert.equal(await b.as((s) => s.sync()), null, 'no changes → null');
  const edited = { ...bank, password: 'bank-pass-2', updated: bank.updated + 1 };
  await b.as((s) => s.save([edited]));
  assert.deepEqual(await a.as((s) => s.sync()), [edited]);
  // Concurrent edits from the same revision: the second writer is refused and refreshed.
  await a.as((s) => s.save([{ ...edited, password: 'from-device-a' }]));
  await assert.rejects(b.as((s) => s.save([{ ...edited, password: 'from-device-b' }])), (error) => error instanceof VaultConflictError);
  assert.equal(b.session.entries()[0].password, 'from-device-a', 'conflicting device shows the newer server version');
  // Deletion syncs as a tombstone.
  await a.as((s) => s.save([]));
  assert.deepEqual(await b.as((s) => s.sync()), []);
  const third = device(carol);
  assert.deepEqual((await third.as((s) => s.open(MASTER))).entries, []);
});

test('email OTP: rate limits, wrong code, single use, and master-password reset with re-encryption', async () => {
  const dana = await member('recover');
  const laptop = device(dana); const phone = device(dana);
  await laptop.as((s) => s.open(MASTER));
  const entries = [entry('Work', 'work-pass'), entry('Home', 'home-pass', { pinned: true })];
  await laptop.as((s) => s.save(entries));
  await phone.as((s) => s.open(MASTER));
  const before = (await db.query('select id, ciphertext from public.password_vault_items where user_id = $1 order by id', [dana.id])).rows;

  const forgot = device(dana);
  await forgot.as((s) => s.sendRecoveryCode());
  await assert.rejects(forgot.as((s) => s.sendRecoveryCode()), /wait \d+ seconds/, 'resend cooldown');
  const code = await lastCode(dana.email);
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(await db.query('select * from public.password_vault_recovery_codes').then((r) => r.rows)).includes(code), 'OTP stored only as an HMAC');
  const wrong = code === '000000' ? '111111' : '000000';
  await assert.rejects(forgot.as((s) => s.verifyRecoveryCode(wrong)), /doesn't match/);
  assert.equal(await forgot.as((s) => s.verifyRecoveryCode(code)), 'escrow');
  await assert.rejects(device(dana).as((s) => s.verifyRecoveryCode(code)), /Request a new recovery code/, 'OTP is single-use');

  const result = await forgot.as((s) => s.resetMasterPassword('brand new master password'));
  assert.deepEqual(result.entries.sort((x, y) => x.id.localeCompare(y.id)), [...entries].sort((x, y) => x.id.localeCompare(y.id)), 'no password lost');
  const vault = (await db.query('select key_generation from public.password_vaults where user_id = $1', [dana.id])).rows[0];
  assert.equal(vault.key_generation, 2, 'vault key rotated');
  const after = (await db.query('select id, ciphertext, key_generation from public.password_vault_items where user_id = $1 order by id', [dana.id])).rows;
  assert.equal(after.length, before.length);
  after.forEach((row, i) => { assert.equal(row.key_generation, 2); assert.notEqual(row.ciphertext, before[i].ciphertext, 're-encrypted'); });
  assert.equal((await db.query('select count(*)::int n from public.password_vault_recovery_grants where user_id = $1', [dana.id])).rows[0].n, 0, 'grant consumed');

  // Old password no longer works anywhere; new one works on a fresh device.
  await assert.rejects(device(dana).as((s) => s.open(MASTER)), (error) => error.name === 'WrongMasterPasswordError');
  assert.equal((await device(dana).as((s) => s.open('brand new master password'))).entries.length, 2);
  // Devices still holding the old key are locked out of reads and writes.
  await assert.rejects(phone.as((s) => s.sync()), (error) => error instanceof VaultKeyChangedError);
  assert.equal(phone.session.isUnlocked, false);
  await assert.rejects(laptop.as((s) => s.save([...entries, entry('Stale', 'stale')])), (error) => error instanceof VaultKeyChangedError);
});

test('recovery grants are single-use, expire, and need a verified OTP', async () => {
  const erin = await member('grant');
  const d = device(erin);
  await d.as((s) => s.open(MASTER));
  await d.as((s) => s.save([entry('One', 'one')]));
  const backend = serverVaultBackend();
  actingAs = erin;
  const transport = await vaultCrypto.createTransportKeyPair();
  await assert.rejects(backend.recovery.releaseKey('A'.repeat(43), transport.publicKey), /no longer valid/, 'no OTP → no key');
  await backend.recovery.send();
  const { grant } = await backend.recovery.verify(await lastCode(erin.email));
  const released = await backend.recovery.releaseKey(grant, transport.publicKey);
  assert.equal(released.keyGeneration, 1);
  await assert.rejects(backend.recovery.releaseKey(grant, transport.publicKey), /already used/);
  // A second OTP flow, then let the grant expire.
  clockOffsetMs = 61_000;
  await backend.recovery.send();
  const second = await backend.recovery.verify(await lastCode(erin.email));
  clockOffsetMs = 61_000 + 16 * 60_000;
  await assert.rejects(backend.recovery.releaseKey(second.grant, transport.publicKey), /no longer valid/);
  clockOffsetMs = 0;
  // Too many wrong codes burns the challenge.
  clockOffsetMs = 30 * 60_000;
  await backend.recovery.send();
  for (let i = 0; i < 4; i++) await assert.rejects(backend.recovery.verify('999999' === (await lastCode(erin.email)) ? '999998' : '999999'));
  await assert.rejects(backend.recovery.verify('999999' === (await lastCode(erin.email)) ? '999998' : '999999'), /Too many incorrect attempts/);
  await assert.rejects(backend.recovery.verify(await lastCode(erin.email)), /Too many incorrect attempts/);
  clockOffsetMs = 0;
});

test('migration: on-device v1/v2 vaults move to the synced vault without losing entries', async () => {
  const fay = await member('migrate');
  const oldEntries = [entry('Legacy1', 'l1-pass'), { ...entry('Legacy2', 'l2-pass'), id: 'a1' }];
  const laptop = device(fay);
  laptop.storage.setItem(`persora-password-vault-v1:${fay.id}`, await legacyV1(oldEntries, 'old legacy password'));
  const status = await laptop.as((s) => s.status());
  assert.equal(status.hasVault, true); assert.equal(status.hasServerVault, false); assert.equal(status.hasLegacy, true);
  await assert.rejects(laptop.as((s) => s.open('not the legacy password')));
  assert.ok(laptop.storage.getItem(`persora-password-vault-v1:${fay.id}`), 'legacy kept after a failed attempt');
  const opened = await laptop.as((s) => s.open('old legacy password'));
  assert.equal(opened.migratedCount, 2);
  assert.deepEqual(opened.entries.map((e) => e.password).sort(), ['l1-pass', 'l2-pass']);
  assert.ok(opened.entries.every((e) => /^[0-9a-f-]{36}$/.test(e.id)), 'non-UUID ids normalised');
  assert.equal(laptop.storage.getItem(`persora-password-vault-v1:${fay.id}`), null, 'local copy removed after verified upload');
  // The same account on another device sees the migrated entries.
  assert.equal((await device(fay).as((s) => s.open('old legacy password'))).entries.length, 2);

  // A second device with its own older vault (different password) can merge it in.
  const desk = device(fay);
  const v2 = await legacyV2([entry('DeskOnly', 'desk-pass')], 'desk legacy password');
  desk.storage.setItem(`persora-password-vault-v1:${fay.id}`, v2.raw);
  const deskOpen = await desk.as((s) => s.open('old legacy password'));
  assert.equal(deskOpen.legacyPending, true);
  await assert.rejects(desk.as((s) => s.mergeLegacy('wrong desk password')));
  const merged = await desk.as((s) => s.mergeLegacy('desk legacy password'));
  assert.equal(merged.merged, 1);
  assert.equal(merged.entries.length, 3);
  assert.equal(desk.storage.getItem(`persora-password-vault-v1:${fay.id}`), null);
});

test('migration: forgotten password on a v2 on-device vault recovers with OTP + saved recovery key', async () => {
  const gus = await member('legacy-recovery');
  const d = device(gus);
  const v2 = await legacyV2([entry('Old', 'old-pass')], 'forgotten legacy password');
  d.storage.setItem(`persora-password-vault-v1:${gus.id}`, v2.raw);
  await d.as((s) => s.sendRecoveryCode());
  { const code = await lastCode(gus.email); assert.equal(await d.as((s) => s.verifyRecoveryCode(code)), "legacy"); }
  await assert.rejects(d.as((s) => s.checkLegacyRecoveryKey('A'.repeat(43))), /doesn't match/);
  await d.as((s) => s.checkLegacyRecoveryKey(v2.recoveryKey));
  const result = await d.as((s) => s.resetMasterPassword('new synced master password'));
  assert.equal(result.migratedCount, 1);
  assert.equal(d.storage.getItem(`persora-password-vault-v1:${gus.id}`), null);
  assert.equal((await device(gus).as((s) => s.open('new synced master password'))).entries[0].password, 'old-pass');
});

test('unauthorized access: no session → 401; members are isolated; DB roles have no direct access', async () => {
  const response = await api.fetch(new Request('https://persora.test/api/password-vault'), { SUPABASE_URL: 'https://db.invalid', SUPABASE_SECRET_KEY: 'x' });
  assert.equal(response.status, 401);
  for (const path of ['/api/password-vault/recovery/send', '/api/password-vault/recovery/key', '/api/password-vault/items']) {
    const res = await api.fetch(new Request(`https://persora.test${path}`, { method: 'POST', body: '{}' }), { SUPABASE_URL: 'https://db.invalid', SUPABASE_SECRET_KEY: 'x' });
    assert.equal(res.status, 401, path);
  }

  const owner = await member('owner'); const intruder = await member('intruder');
  const ownerDevice = device(owner);
  await ownerDevice.as((s) => s.open(MASTER));
  const secret = entry('Private', 'owner-only-secret');
  await ownerDevice.as((s) => s.save([secret]));
  // The intruder's own session never sees the owner's vault…
  const status = await device(intruder).as((s) => s.status());
  assert.equal(status.hasServerVault, false);
  // …can't write into it (ids are scoped to the caller's own vault)…
  actingAs = intruder;
  await assert.rejects(serverVaultBackend().apply({ keyGeneration: 1, changes: [{ id: secret.id, baseRevision: 1, deleted: true }] }), /Create your password vault first/);
  // …and the owner's copy is untouched.
  assert.deepEqual((await device(owner).as((s) => s.open(MASTER))).entries, [secret]);
  // Owner ciphertext moved into another vault fails authentication (AAD binds user + id).
  const intruderDevice = device(intruder);
  await intruderDevice.as((s) => s.open('intruder master password'));
  const stolen = (await db.query('select id, iv, ciphertext from public.password_vault_items where user_id = $1', [owner.id])).rows[0];
  await db.query('insert into public.password_vault_items(user_id, id, key_generation, iv, ciphertext, revision, change_seq) values ($1, $2, 1, $3, $4, 1, nextval(\'public.password_vault_change_seq\'))', [intruder.id, stolen.id, stolen.iv, stolen.ciphertext]);
  const reopened = await device(intruder).as((s) => s.open('intruder master password'));
  assert.equal(reopened.entries.length, 0); assert.equal(reopened.unreadableCount, 1);

  for (const role of ['anon', 'authenticated']) {
    for (const table of ['password_vaults', 'password_vault_items', 'password_vault_recovery_grants']) {
      const r = await db.query(`select has_table_privilege('${role}', 'public.${table}', 'select') as ok`);
      assert.equal(r.rows[0].ok, false, `${role} must not read ${table}`);
    }
    for (const fn of ['persora_password_vault_state(uuid,bigint)', 'persora_password_vault_apply(uuid,integer,jsonb)', 'persora_vault_recovery_release(uuid,text,timestamptz)']) {
      const r = await db.query(`select has_function_privilege('${role}', 'public.${fn}', 'execute') as ok`);
      assert.equal(r.rows[0].ok, false, `${role} must not execute ${fn}`);
    }
  }
});

test('server validation: escrow must match the vault key, KDF must be Argon2id, recovery needs the escrow secret', async () => {
  const hal = await member('validate');
  actingAs = hal;
  const backend = serverVaultBackend();
  const snapshot = await backend.load();
  const dekRaw = vaultCrypto.generateDek();
  const material = await vaultCrypto.createKeyMaterial({ userId: hal.id, generation: 1, password: MASTER, dekRaw, escrowKey: snapshot.escrow });
  const otherKey = await vaultCrypto.sealEscrow(snapshot.escrow, hal.id, 1, vaultCrypto.generateDek());
  await assert.rejects(backend.setup({ vault: { ...material, escrow: otherKey }, items: [] }), /doesn't match the vault key/);
  await assert.rejects(backend.setup({ vault: { ...material, kdf: { ...material.kdf, algorithm: 'pbkdf2' } }, items: [] }), /Argon2id/);
  await assert.rejects(backend.setup({ vault: { ...material, kdf: { ...material.kdf, memoryKiB: 1024 } }, items: [] }), /Argon2id/);
  await assert.rejects(backend.setup({ vault: material, items: [{ id: 'not-a-uuid', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(32) }] }), /invalid id/);
  env = { SUPABASE_SECRET_KEY: 'sb_secret_test_only' };
  try {
    const s = await backend.load();
    assert.equal(s.recoveryAvailable, false); assert.equal(s.escrow, null);
    await assert.rejects(backend.setup({ vault: material, items: [] }), /isn't configured/);
    const fresh = device(hal);
    assert.equal((await fresh.as((x) => x.status())).canCreate, false);
    await assert.rejects(fresh.as((x) => x.open(MASTER)), /isn't configured/);
  } finally { env = baseEnv; }
  const created = await backend.setup({ vault: material, items: [] });
  assert.equal(created.vault.keyGeneration, 1);
  await assert.rejects(backend.setup({ vault: material, items: [] }), (error) => error instanceof VaultConflictError);
});

test('escrow key rotation: unlocking re-seals the escrow copy to the new key', async () => {
  const ivy = await member('rotate');
  const d = device(ivy);
  await d.as((s) => s.open(MASTER));
  await d.as((s) => s.save([entry('Kept', 'kept-pass')]));
  const oldKeyId = (await db.query('select escrow_key_id from public.password_vaults where user_id = $1', [ivy.id])).rows[0].escrow_key_id;
  const next = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  env = { ...baseEnv, PASSWORD_VAULT_ESCROW_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', next.privateKey)), PASSWORD_VAULT_ESCROW_RETIRED_KEYS: `[${ESCROW_JWK}]` };
  try {
    await device(ivy).as((s) => s.open(MASTER));
    const newKeyId = (await db.query('select escrow_key_id from public.password_vaults where user_id = $1', [ivy.id])).rows[0].escrow_key_id;
    assert.notEqual(newKeyId, oldKeyId);
    const forgot = device(ivy);
    await forgot.as((s) => s.sendRecoveryCode());
    await forgot.as(async (s) => s.verifyRecoveryCode(await lastCode(ivy.email)));
    assert.equal((await forgot.as((s) => s.resetMasterPassword('rotated new password!'))).entries[0].password, 'kept-pass');
  } finally { env = baseEnv; }
});

test('demo/device backend keeps the same behaviour without a server', async () => {
  const storage = new MemoryStorage();
  const id = crypto.randomUUID();
  const s = new PasswordVaultSession(id, deviceVaultBackend(id, storage), storage);
  assert.equal((await s.status()).canCreate, true);
  await s.open(MASTER);
  const e = entry('Demo', 'demo-pass');
  await s.save([e]);
  assert.ok(!storage.getItem(`persora-password-vault-v3:${id}`).includes('demo-pass'));
  const again = new PasswordVaultSession(id, deviceVaultBackend(id, storage), storage);
  await assert.rejects(again.open('wrong demo password'));
  assert.deepEqual((await again.open(MASTER)).entries, [e]);
  await assert.rejects(again.sendRecoveryCode(), /signed-in Persora account/);
});

test('no secrets in server logs', () => {
  const logs = loggedErrors.join('\n');
  for (const secret of [MASTER, 'brand new master password', 'gh-Secret-Pa55word!', 'owner-only-secret']) assert.ok(!logs.includes(secret));
  assert.ok(!/"d":"/.test(logs), 'escrow private key never logged');
});
