// End-to-end Password Manager tests: the real browser client
// (src/lib/password-vault-client.ts) talks over fetch to the real Pages
// Functions handler (cloudflare/password-vault.js), which calls the real SQL
// functions from supabase/migrations in PGlite (with real pgcrypto bcrypt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handlePasswordVault, VAULT_IDLE_SECONDS } from '../cloudflare/password-vault.js';
import api from '../cloudflare/api.js';

const bundle = await build({
  stdin: { contents: `export * from './src/lib/password-vault-client.ts';`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
});
const bundlePath = join(await mkdtemp(join(tmpdir(), 'persora-vault-')), 'client.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { PasswordVaultSession, serverVaultBackend, deviceVaultBackend, VaultConflictError, VaultLockedError, WrongMasterPasswordError } = await import(pathToFileURL(bundlePath).href);

class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

const { db, rpc, addMember, addSession } = await createVaultDatabase();
const env = { SUPABASE_SECRET_KEY: 'sb_secret_test_only' };
const mail = [];
let clockOffsetMs = 0;
const services = { rpc, now: () => new Date(Date.now() + clockOffsetMs), prepareRecoveryEmail: async () => async (message) => { mail.push(message); } };
const loggedErrors = [];
const originalError = console.error;
console.error = (...args) => { loggedErrors.push(args.map(String).join(' ')); };
test.after(() => { console.error = originalError; });

// Each simulated device carries its own Persora identity (= its own Persora session).
let actingAs = null;
globalThis.fetch = async (input, init = {}) => {
  const request = new Request(new URL(String(input), 'https://persora.test'), init);
  if (!actingAs) return new Response(JSON.stringify({ error: 'Sign in to open your password vault.' }), { status: 401 });
  return handlePasswordVault(request, actingAs, env, 'https://persora.test', services);
};
function device(identity, { newSession = true, storage = new MemoryStorage() } = {}) {
  const ready = newSession ? addSession(identity.id).then((session_id) => ({ ...identity, session_id })) : Promise.resolve(identity);
  const session = new PasswordVaultSession(identity.id, serverVaultBackend(), storage);
  const as = async (fn) => { actingAs = await ready; return fn(session); };
  return { session, storage, as, identity: ready };
}
/** Raw API call as a given device identity (bypasses the client). */
async function raw(identity, path, { method = 'GET', body, token } = {}) {
  actingAs = identity;
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Persora-Vault-Token': token } : {}) };
  const response = await fetch(`/api/password-vault${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
const entry = (title, password, extra = {}) => ({ id: crypto.randomUUID(), title, login: `${title.toLowerCase()}@example.test`, password, url: `https://${title.toLowerCase()}.example`, notes: `note for ${title}`, questions: [{ question: 'First pet?', answer: `answer-${title}` }], folder: '', favorite: false, pinned: false, updated: Date.now(), ...extra });
const MASTER = 'correct horse battery staple';
const lastCode = (to) => /(\d{6})/.exec([...mail].reverse().find((m) => m.to === to).textContent)[1];
const items = async (userId) => (await db.query('select id, data, deleted, revision from public.password_vault_items where user_id = $1 order by id', [userId])).rows;
const dbText = async () => JSON.stringify((await db.query(`select (select coalesce(json_agg(v), '[]') from public.password_vaults v) as v, (select coalesce(json_agg(s), '[]') from public.password_vault_sessions s) as s, (select coalesce(json_agg(c), '[]') from public.password_vault_recovery_codes c) as c`)).rows);

test('first visit creates the master password: bcrypt verifier only, separate from the sign-in password', async () => {
  const alice = await addMember('setup');
  const laptop = device(alice);
  assert.deepEqual(await laptop.as((s) => s.status()), { hasVault: false, records: 0, hasLegacy: false, recoveryAvailable: true, backend: 'server', pending: 0 });
  await assert.rejects(laptop.as((s) => s.open('short')), /at least 10 characters/);
  await assert.rejects(laptop.as((s) => s.open(alice.login_password)), /different from your Persora sign-in password/);
  await assert.rejects(laptop.as((s) => s.open('é'.repeat(37))), /at most 72 bytes/);
  const opened = await laptop.as((s) => s.open(MASTER));
  assert.equal(opened.created, true); assert.deepEqual(opened.entries, []);
  const row = (await db.query('select master_password_hash from public.password_vaults where user_id = $1', [alice.id])).rows[0];
  assert.match(row.master_password_hash, /^\$2[abxy]\$12\$/, 'salted bcrypt (pgcrypto, cost 12)');
  assert.ok(!(await dbText()).includes(MASTER), 'the master password is never stored in plaintext');
  const profile = (await db.query('select password_hash from public.profiles where id = $1', [alice.id])).rows[0];
  assert.notEqual(profile.password_hash, row.master_password_hash, 'sign-in password hash is untouched and separate');
  // A second "create" (another device racing) cannot overwrite the existing master password.
  const other = await raw(await laptop.identity, '/setup', { method: 'POST', body: { masterPassword: 'another master password' } });
  assert.equal(other.status, 409);
  const tablet = device(alice);
  assert.equal((await tablet.as((s) => s.status())).hasVault, true);
});

test('unlock on multiple devices; every open needs the master password; wrong passwords are rate-limited server-side', async () => {
  const bob = await addMember('unlock');
  const phone = device(bob); const tablet = device(bob); const desktop = device(bob);
  await phone.as((s) => s.status()); await phone.as((s) => s.open(MASTER));
  const mail1 = entry('Mail', 'mail-pass-1');
  await phone.as((s) => s.save([mail1]));
  await tablet.as((s) => s.status());
  await assert.rejects(tablet.as((s) => s.open('definitely the wrong one')), (error) => error instanceof WrongMasterPasswordError);
  assert.equal(tablet.session.isUnlocked, false);
  const opened = await tablet.as((s) => s.open(MASTER));
  assert.deepEqual(opened.entries, [mail1]);
  // The vault token is memory-only: a fresh session object (page reload / next visit) must unlock again.
  const reopened = new PasswordVaultSession(bob.id, serverVaultBackend(), new MemoryStorage());
  actingAs = await tablet.identity;
  assert.equal(reopened.isUnlocked, false);
  await assert.rejects(reopened.sync().then(() => reopened.save([mail1])), (error) => error instanceof VaultLockedError);
  // Five wrong master passwords → blocked for 15 minutes for every device, even with the right password.
  await desktop.as((s) => s.status());
  for (let i = 0; i < 4; i++) await assert.rejects(desktop.as((s) => s.open(`wrong password ${i}!!`)), (error) => error instanceof WrongMasterPasswordError);
  await assert.rejects(desktop.as((s) => s.open('wrong password 4!!')), /Too many incorrect master passwords/);
  await assert.rejects(desktop.as((s) => s.open(MASTER)), /Too many incorrect master passwords/);
  const blocked = await raw(await phone.identity, '/unlock', { method: 'POST', body: { masterPassword: MASTER } });
  assert.equal(blocked.status, 429); assert.equal(blocked.body.reason, 'blocked');
  // Devices that were already unlocked keep working.
  assert.deepEqual(await phone.as((s) => s.sync()), null);
});

test('add, view, edit and delete from any device; changes sync; concurrent edits never overwrite silently', async () => {
  const carol = await addMember('crud');
  const laptop = device(carol); const phone = device(carol);
  await laptop.as((s) => s.status()); await laptop.as((s) => s.open(MASTER));
  await phone.as((s) => s.status()); await phone.as((s) => s.open(MASTER));
  // Add (laptop) → view (phone)
  const github = entry('GitHub', 'gh-Secret-Pa55word!'); const bank = entry('Bank', 'bank-pass', { favorite: true });
  await laptop.as((s) => s.save([github, bank]));
  const seen = await phone.as((s) => s.sync());
  assert.deepEqual(seen.sort((a, b) => a.title.localeCompare(b.title)), [bank, github]);
  // Stored as JSON records in Postgres (Supabase encryption at rest), owned by carol.
  const stored = await items(carol.id);
  assert.equal(stored.length, 2);
  assert.equal(stored.find((row) => row.id === github.id).data.password, 'gh-Secret-Pa55word!');
  assert.equal('id' in stored[0].data, false);
  // Edit (phone) → laptop
  const githubEdited = { ...github, password: 'rotated-Pa55!', notes: 'rotated', updated: Date.now() + 1 };
  await phone.as((s) => s.save([githubEdited, bank]));
  assert.deepEqual((await laptop.as((s) => s.sync())).find((e) => e.id === github.id), githubEdited);
  // Delete (laptop) → phone; tombstone keeps the revision history
  await laptop.as((s) => s.save([githubEdited]));
  assert.deepEqual(await phone.as((s) => s.sync()), [githubEdited]);
  const tomb = (await items(carol.id)).find((row) => row.id === bank.id);
  assert.equal(tomb.deleted, true); assert.equal(tomb.data, null);
  // Trash state and flags round-trip
  const trashed = { ...githubEdited, pinned: true, trash: { deletedAt: 1, expiresAt: Date.now() + 864e5 } };
  await phone.as((s) => s.save([trashed]));
  assert.deepEqual(await laptop.as((s) => s.sync()), [trashed]);
  // Conflict: both edit the same record from the same base revision.
  await laptop.as((s) => s.save([{ ...trashed, title: 'Laptop edit' }]));
  await assert.rejects(phone.as((s) => s.save([{ ...trashed, title: 'Phone edit' }])), (error) => error instanceof VaultConflictError && /changed on another device/.test(error.message));
  assert.equal(phone.session.entries()[0].title, 'Laptop edit', 'the conflicting device reloads the newer version');
  await phone.as((s) => s.save([{ ...phone.session.entries()[0], title: 'Phone edit' }]));
  assert.equal((await laptop.as((s) => s.sync()))[0].title, 'Phone edit');
});

test('the backend enforces the master password: no token, foreign token, other session, locked or idle tokens are refused', async () => {
  const dave = await addMember('enforce'); const eve = await addMember('attacker');
  const daveDevice = device(dave);
  await daveDevice.as((s) => s.status()); await daveDevice.as((s) => s.open(MASTER));
  await daveDevice.as((s) => s.save([entry('Secret', 'top-secret-pass')]));
  const daveId = await daveDevice.identity;
  // Signed in to Persora but no vault token → nothing.
  for (const call of [raw(daveId, '/items'), raw(daveId, '/items', { method: 'POST', body: { changes: [{ id: crypto.randomUUID(), baseRevision: 0, entry: entry('x', 'y') }] } })]) {
    const result = await call; assert.equal(result.status, 403); assert.equal(result.body.reason, 'vault_locked'); assert.ok(!JSON.stringify(result.body).includes('top-secret-pass'));
  }
  // Obtain dave's real token from a direct unlock.
  const unlocked = await raw(daveId, '/unlock', { method: 'POST', body: { masterPassword: MASTER } });
  assert.equal(unlocked.status, 200); const token = unlocked.body.token;
  assert.equal((await raw(daveId, '/items', { token })).status, 200);
  // Another member presenting dave's token reads their own (empty) scope → locked.
  const eveId = { ...eve };
  assert.equal((await raw(eveId, '/items', { token })).body.reason, 'vault_locked');
  // Same member, different Persora session (stolen token replayed elsewhere) → locked.
  const otherSession = { ...dave, session_id: await addSession(dave.id) };
  assert.equal((await raw(otherSession, '/items', { token })).body.reason, 'vault_locked');
  // Signing out of Persora (session row deleted) revokes the vault session too.
  const tmp = { ...dave, session_id: await addSession(dave.id) };
  const tmpToken = (await raw(tmp, '/unlock', { method: 'POST', body: { masterPassword: MASTER } })).body.token;
  await db.query('delete from public.user_sessions where id = $1', [tmp.session_id]);
  assert.equal((await db.query('select count(*)::int n from public.password_vault_sessions where session_id = $1', [tmp.session_id])).rows[0].n, 0);
  assert.equal((await raw(tmp, '/items', { token: tmpToken })).body.reason, 'vault_locked');
  // Lock revokes the token.
  assert.equal((await raw(daveId, '/lock', { method: 'POST', body: {}, token })).status, 200);
  assert.equal((await raw(daveId, '/items', { token })).body.reason, 'vault_locked');
  // Idle timeout: 30 minutes without use.
  const idleToken = (await raw(daveId, '/unlock', { method: 'POST', body: { masterPassword: MASTER } })).body.token;
  clockOffsetMs = (VAULT_IDLE_SECONDS + 5) * 1000;
  try { assert.equal((await raw(daveId, '/items', { token: idleToken })).body.reason, 'vault_locked'); } finally { clockOffsetMs = 0; }
  // The client turns this into VaultLockedError and forgets its records.
  await db.query('delete from public.password_vault_sessions where user_id = $1', [dave.id]);
  await assert.rejects(daveDevice.as((s) => s.sync()), (error) => error instanceof VaultLockedError);
  assert.equal(daveDevice.session.isUnlocked, false); assert.deepEqual(daveDevice.session.entries(), []);
  // Garbage tokens, bad cursors and malformed records are rejected without touching data.
  assert.equal((await raw(daveId, '/items', { token: "' or 1=1 --" })).status, 403);
  const fresh = (await raw(daveId, '/unlock', { method: 'POST', body: { masterPassword: MASTER } })).body.token;
  assert.equal((await raw(daveId, '/items?since=-1', { token: fresh })).status, 400);
  assert.equal((await raw(daveId, '/items', { method: 'POST', token: fresh, body: { changes: [{ id: 'not-a-uuid', baseRevision: 0, entry: {} }] } })).status, 400);
  assert.equal((await raw(daveId, '/items', { method: 'POST', token: fresh, body: { changes: [{ id: crypto.randomUUID(), baseRevision: 0, entry: { title: 42 } }] } })).status, 400);
  assert.equal((await raw(daveId, '/items', { method: 'POST', token: fresh, body: { changes: [{ id: crypto.randomUUID(), baseRevision: 0, entry: entry('Big', 'x'.repeat(5000)) }] } })).status, 400);
  // Unauthenticated requests through the real API router never reach the vault.
  const response = await api.fetch(new Request('https://persora.test/api/password-vault/items'), env, { waitUntil() {} });
  assert.equal(response.status, 401);
  // The admin-only migration route is invisible to members.
  assert.equal((await raw(daveId, '/admin/migrate-legacy', { method: 'POST', body: {} })).status, 404);
});

test('Forgot master password: email OTP → new master password works everywhere; every record is kept unchanged', async () => {
  const frank = await addMember('recover');
  const laptop = device(frank); const phone = device(frank);
  await laptop.as((s) => s.status()); await laptop.as((s) => s.open(MASTER));
  const saved = [entry('Mail', 'mail-1'), entry('Bank', 'bank-1', { pinned: true }), entry('Shop', 'shop-1', { trash: { deletedAt: 5, expiresAt: Date.now() + 864e5 } })];
  await laptop.as((s) => s.save(saved));
  await laptop.as((s) => s.save(saved.slice(0, 2).concat([{ ...saved[2], notes: 'edited' }])));
  await phone.as((s) => s.status()); await phone.as((s) => s.open(MASTER));
  const before = await items(frank.id);
  const phoneToken = phone.session;
  // The member forgot it on a third device.
  const tablet = device(frank);
  await tablet.as((s) => s.status());
  await tablet.as((s) => s.sendRecoveryCode());
  assert.equal(mail.at(-1).to, frank.email);
  const code = lastCode(frank.email);
  assert.ok(!(await dbText()).includes(code), 'only an HMAC of the OTP is stored');
  await assert.rejects(tablet.as((s) => s.sendRecoveryCode()), /wait \d+ seconds/);
  await assert.rejects(tablet.as((s) => s.verifyRecoveryCode(code === '123456' ? '654321' : '123456')), /doesn't match/);
  await tablet.as((s) => s.verifyRecoveryCode(code));
  await assert.rejects(tablet.as((s) => s.resetMasterPassword(frank.login_password)), /different from your Persora sign-in password/);
  const NEW = 'a brand new master password';
  const result = await tablet.as((s) => s.resetMasterPassword(NEW));
  assert.equal(result.entries.length, 3);
  // Records are byte-for-byte identical: not deleted, re-encrypted or rewritten.
  assert.deepEqual(await items(frank.id), before);
  // The OTP was single-use.
  const reuse = await raw(await tablet.identity, '/recovery/verify', { method: 'POST', body: { code } });
  assert.equal(reuse.status, 400);
  // Every previously unlocked device is locked and must use the new master password.
  await assert.rejects(phone.as((s) => s.sync()), (error) => error instanceof VaultLockedError);
  assert.equal(phoneToken.isUnlocked, false);
  await phone.as((s) => s.status());
  await assert.rejects(phone.as((s) => s.open(MASTER)), (error) => error instanceof WrongMasterPasswordError);
  const reopened = await phone.as((s) => s.open(NEW));
  assert.deepEqual(reopened.entries.sort((a, b) => a.title.localeCompare(b.title)).map((e) => e.title), ['Bank', 'Mail', 'Shop']);
  assert.equal(reopened.entries.find((e) => e.title === 'Shop').notes, 'edited');
  const desktop = device(frank); await desktop.as((s) => s.status());
  assert.equal((await desktop.as((s) => s.open(NEW))).entries.length, 3);
});

test('OTP and reset grant limits: expiry, attempt limit, hourly send limit, single-use grant, lockout cleared by reset', async () => {
  const gina = await addMember('limits');
  const dev = device(gina);
  await dev.as((s) => s.status()); await dev.as((s) => s.open(MASTER));
  const id = await dev.identity;
  // Expiry (10 minutes)
  assert.equal((await raw(id, '/recovery/send', { method: 'POST', body: {} })).status, 200);
  clockOffsetMs = 11 * 60 * 1000;
  try { assert.match((await raw(id, '/recovery/verify', { method: 'POST', body: { code: lastCode(gina.email) } })).body.error, /expired/); }
  finally { clockOffsetMs = 0; }
  // Attempt limit (5 wrong → code dead, even the right one)
  clockOffsetMs = 2 * 60 * 1000;
  try {
    assert.equal((await raw(id, '/recovery/send', { method: 'POST', body: {} })).status, 200);
    const good = lastCode(gina.email); const bad = good === '111111' ? '222222' : '111111';
    for (let i = 0; i < 4; i++) assert.equal((await raw(id, '/recovery/verify', { method: 'POST', body: { code: bad } })).status, 400);
    assert.equal((await raw(id, '/recovery/verify', { method: 'POST', body: { code: bad } })).status, 429);
    assert.equal((await raw(id, '/recovery/verify', { method: 'POST', body: { code: good } })).status, 429);
  } finally { clockOffsetMs = 0; }
  // Hourly limit (5 sends per hour, one per minute)
  for (let minute = 3; minute <= 5; minute++) {
    clockOffsetMs = minute * 61 * 1000;
    try { assert.equal((await raw(id, '/recovery/send', { method: 'POST', body: {} })).status, 200); } finally { clockOffsetMs = 0; }
  }
  clockOffsetMs = 7 * 61 * 1000;
  try { const limited = await raw(id, '/recovery/send', { method: 'POST', body: {} }); assert.equal(limited.status, 429); assert.match(limited.body.error, /an hour/); }
  finally { clockOffsetMs = 0; }
  // Grant: single use, expires after 15 minutes, bound to the member.
  await db.query('delete from public.password_vault_recovery_codes where user_id = $1', [gina.id]);
  await raw(id, '/recovery/send', { method: 'POST', body: {} });
  const grant = (await raw(id, '/recovery/verify', { method: 'POST', body: { code: lastCode(gina.email) } })).body.grant;
  const stranger = await addMember('stranger');
  assert.equal((await raw(stranger, '/recovery/complete', { method: 'POST', body: { grant, masterPassword: 'stranger master pass' } })).status, 403);
  clockOffsetMs = 16 * 60 * 1000;
  try { assert.equal((await raw(id, '/recovery/complete', { method: 'POST', body: { grant, masterPassword: 'new master pass 1' } })).status, 403); }
  finally { clockOffsetMs = 0; }
  await db.query('delete from public.password_vault_recovery_codes where user_id = $1', [gina.id]);
  await raw(id, '/recovery/send', { method: 'POST', body: {} });
  const grant2 = (await raw(id, '/recovery/verify', { method: 'POST', body: { code: lastCode(gina.email) } })).body.grant;
  // Lock the member out with wrong passwords first; a successful reset clears the lockout.
  for (let i = 0; i < 5; i++) await raw(id, '/unlock', { method: 'POST', body: { masterPassword: `nope nope ${i}!!` } });
  assert.equal((await raw(id, '/unlock', { method: 'POST', body: { masterPassword: MASTER } })).status, 429);
  assert.equal((await raw(id, '/recovery/complete', { method: 'POST', body: { grant: grant2, masterPassword: 'new master pass 2' } })).status, 200);
  assert.equal((await raw(id, '/recovery/complete', { method: 'POST', body: { grant: grant2, masterPassword: 'new master pass 3' } })).status, 403, 'grant is single use');
  assert.equal((await raw(id, '/unlock', { method: 'POST', body: { masterPassword: 'new master pass 2' } })).status, 200);
  assert.equal((await raw(id, '/unlock', { method: 'POST', body: { masterPassword: 'new master pass 3' } })).status, 401);
});

test('database: RLS locked tables, no browser-role privileges, internal helpers not callable by the API role', async () => {
  const hank = await addMember('rls');
  const dev = device(hank); await dev.as((s) => s.status()); await dev.as((s) => s.open(MASTER));
  await dev.as((s) => s.save([entry('Private', 'p')]));
  const tables = ['password_vaults', 'password_vault_items', 'password_vault_sessions', 'password_vault_recovery_codes', 'password_vault_recovery_grants'];
  const rls = (await db.query(`select relname, relrowsecurity from pg_class where relname = any($1)`, [tables])).rows;
  assert.equal(rls.length, tables.length); assert.ok(rls.every((row) => row.relrowsecurity), 'RLS enabled on every vault table');
  assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename = any($1)`, [tables])).rows[0].n, 0, 'no policies → deny all for non-bypass roles');
  for (const role of ['anon', 'authenticated']) {
    for (const table of tables) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.query(`select * from public.${table}`), /permission denied/); } finally { await db.exec('reset role'); }
    }
    for (const call of [`public.persora_vault_status('${hank.id}')`, `public.persora_vault_snapshot('${hank.id}', 0)`, `public.persora_vault_unlock('${hank.id}', '${hank.session_id}', 'x', repeat('a', 64), now(), 60, 60, 5)`]) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.query(`select ${call}`), /permission denied/); } finally { await db.exec('reset role'); }
    }
  }
  // Even if a table privilege were granted by mistake, RLS still returns nothing.
  await db.exec('grant select on public.password_vault_items to authenticated; set role authenticated');
  try { assert.equal((await db.query('select count(*)::int n from public.password_vault_items')).rows[0].n, 0); }
  finally { await db.exec('reset role; revoke select on public.password_vault_items from authenticated'); }
  // The service role may only use the public vault functions, not the helpers that skip checks.
  await db.exec('set role service_role');
  try {
    await assert.rejects(db.query(`select public.persora_vault_snapshot('${hank.id}', 0)`), /permission denied/);
    await assert.rejects(db.query(`select public.persora_vault_open_session('${hank.id}', '${hank.session_id}', repeat('a', 64), now(), 60, 60)`), /permission denied/);
  } finally { await db.exec('reset role'); }
  assert.ok(!loggedErrors.some((line) => /correct horse|password-pass|top-secret/.test(line)), 'nothing sensitive is logged');
});

test('demo (device) backend behaves like the server: master password gate, CRUD, lock', async () => {
  const storage = new MemoryStorage();
  const session = new PasswordVaultSession('demo-user', deviceVaultBackend('demo-user', storage), storage);
  assert.equal((await session.status()).hasVault, false);
  await session.open(MASTER);
  const a = entry('Demo', 'demo-pass');
  await session.save([a]);
  session.lock();
  const again = new PasswordVaultSession('demo-user', deviceVaultBackend('demo-user', storage), storage);
  await again.status();
  await assert.rejects(again.open('wrong master password'), (error) => error instanceof WrongMasterPasswordError);
  assert.deepEqual((await again.open(MASTER)).entries, [a]);
  assert.ok(!storage.getItem('persora-password-vault-demo:demo-user').includes(MASTER));
  await again.save([]);
  assert.deepEqual(again.entries(), []);
});
