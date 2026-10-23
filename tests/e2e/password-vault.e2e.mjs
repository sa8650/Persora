// Browser end-to-end check of the Password Manager on a production-like stack
// (real PostgreSQL + PostgREST + the real Worker + the production UI build),
// including the rollout from the retired encrypted format. Not part of `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/e2e/password-vault.e2e.mjs
//
// Two browser contexts act as two devices with separate Persora sessions.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { startDatabase, startApp, applyMigration, psql, rpc, outbox, SERVICE_KEY, APP_PORT, stopAll } from './local-stack.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const repo = new URL('../../', import.meta.url).pathname;
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-e2e-shots');
mkdirSync(shots, { recursive: true });
const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);

// ── Legacy fixtures: the retired crypto module, frozen for tests ────────────
const out = await build({ stdin: { contents: `export * from './tests/fixtures/legacy-password-vault-crypto.ts';`, resolveDir: repo, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false, external: ['hash-wasm'] });
const legacyPath = join(await mkdtemp(join(tmpdir(), 'persora-e2e-')), 'legacy.mjs');
await writeFile(legacyPath, out.outputFiles[0].text);
const legacy = await import(pathToFileURL(legacyPath).href);
const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const escrowKey = { keyId: Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rawPub))).toString('base64url').slice(0, 22), publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
const ESCROW_PRIVATE = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
async function seedLegacyVault(userId, entries) {
  const dekRaw = legacy.generateDek(); const dek = await legacy.importDek(dekRaw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const check = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(legacy.aad.check(userId, 1)) }, dek, new TextEncoder().encode(legacy.KEY_CHECK_PLAINTEXT));
  const vault = { kdf: legacy.DEFAULT_KDF, salt: legacy.toBase64(crypto.getRandomValues(new Uint8Array(16))), wrappedDek: { iv: legacy.toBase64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: legacy.toBase64(crypto.getRandomValues(new Uint8Array(48))) }, keyCheck: { iv: legacy.toBase64(iv), ciphertext: legacy.toBase64(new Uint8Array(check)) }, escrow: await legacy.sealEscrow(escrowKey, userId, 1, dekRaw), escrowKeyId: escrowKey.keyId };
  const items = []; for (const e of entries) items.push({ id: e.id, ...(await legacy.encryptEntry(dek, userId, 1, e)) });
  assert.equal((await rpc('persora_password_vault_setup', { p_user_id: userId, p_vault: vault, p_items: items })).outcome, 'created');
}
const legacyEntry = (title, password) => ({ id: crypto.randomUUID(), title, login: `${title.toLowerCase()}@old.test`, password, url: `https://${title.toLowerCase()}.example`, notes: 'saved before the upgrade', questions: [], folder: '', favorite: false, pinned: false, updated: 1_700_000_000_000 });

// ── UI helpers ──────────────────────────────────────────────────────────────
const base = `http://127.0.0.1:${APP_PORT}`;
async function register(fullName, email, password) {
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName, email, password }) });
  assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).user;
}
async function signIn(page, email, password) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByRole('textbox', { name: 'Email or 7-digit Persora ID' }).fill(email);
  await page.getByPlaceholder('Your password').fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Password Manager' }).click();
}
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
const card = (page, title) => page.locator('div,article,li').filter({ has: page.getByRole('heading', { name: title, exact: true, level: 3 }) }).filter({ has: page.getByRole('button', { name: 'Copy password' }) }).last();
async function revealed(page, title) {
  const c = card(page, title);
  await c.getByRole('button', { name: 'Reveal password' }).click();
  await c.getByRole('button', { name: /Hide password/ }).waitFor();
  const text = await c.innerText();
  await c.getByRole('button', { name: /Hide password/ }).click();
  return text;
}
async function fillEntry(page, { title, login, password }) {
  if (title !== undefined) await page.getByRole('textbox', { name: 'Title *' }).fill(title);
  if (login !== undefined) await page.getByRole('textbox', { name: 'Username / email / number' }).fill(login);
  if (password !== undefined) await page.getByRole('dialog').getByRole('textbox', { name: /^Password/ }).fill(password);
  await page.getByRole('button', { name: 'Save login' }).click();
  await page.getByRole('button', { name: 'Save login' }).waitFor({ state: 'detached' });
}
const syncNow = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
async function until(fn, message, timeout = 10000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { if (await fn()) return; } catch (error) { last = error; } await new Promise((r) => setTimeout(r, 200)); } throw new Error(`${message}${last ? `: ${last.message}` : ''}`); }
const errorsSeen = [];

let browser;
try {
  step('Production database as it is today (before this release) + seeded encrypted vaults');
  await startDatabase({ stopBefore: '202610240001' });
  await startApp({ PASSWORD_VAULT_ESCROW_PRIVATE_KEY: ESCROW_PRIVATE });
  const lena = await register('Lena Legacy', 'lena@example.test', 'lena-sign-in-password');
  const omar = await register('Omar Legacy', 'omar@example.test', 'omar-sign-in-password');
  const nora = await register('Nora New', 'nora@example.test', 'nora-sign-in-password');
  const lenaEntries = [legacyEntry('Email', 'lena-email-secret'), legacyEntry('Bank', 'lena-bank-secret')];
  const omarEntries = [legacyEntry('Router', 'omar-router-secret')];
  await seedLegacyVault(lena.id, lenaEntries); await seedLegacyVault(omar.id, omarEntries);
  ok('two members with records in the retired encrypted format');

  step('Apply 202610240001 (additive) and deploy the new Worker/UI');
  applyMigration('202610240001_password_vault_master_password.sql');
  await new Promise((r) => setTimeout(r, 500));
  ok('migration applied on PostgreSQL ' + psql('show server_version').trim());

  browser = await chromium.launch();
  const newDevice = async () => { const context = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await context.newPage(); page.on('dialog', (d) => d.accept()); page.on('pageerror', (e) => errorsSeen.push(String(e))); return { context, page }; };

  step('Migrated member: straight to "Set your new master password", saved passwords kept');
  const L = await newDevice();
  await signIn(L.page, 'lena@example.test', 'lena-sign-in-password');
  await heading(L.page, 'Set your new master password').waitFor();
  await L.page.screenshot({ path: join(shots, '01-migrated-member-set-master.png') });
  await L.page.getByLabel('Master password', { exact: true }).fill('lena new master password');
  await L.page.getByLabel('Confirm master password', { exact: true }).fill('lena new master password');
  await L.page.getByRole('button', { name: 'Create vault' }).click();
  await heading(L.page, 'Email').waitFor(); await heading(L.page, 'Bank').waitFor();
  assert.match(await revealed(L.page, 'Bank'), /lena-bank-secret/);
  assert.equal(psql(`select count(*) from password_vault_items where user_id = '${lena.id}' and data is not null and ciphertext is null`).trim(), '2');
  ok('records converted on first visit and shown after setting a master password');

  step('New member, device A: create master password, add a password');
  const A = await newDevice();
  await signIn(A.page, 'nora@example.test', 'nora-sign-in-password');
  await heading(A.page, 'Create your password vault').waitFor();
  await A.page.screenshot({ path: join(shots, '02-create-vault.png') });
  await A.page.getByLabel('Master password', { exact: true }).fill('nora-sign-in-password');
  await A.page.getByLabel('Confirm master password', { exact: true }).fill('nora-sign-in-password');
  await A.page.getByRole('button', { name: 'Create vault' }).click();
  await A.page.getByText(/different from your Persora sign-in password/).waitFor();
  ok('sign-in password refused as master password');
  const NORA_MASTER = 'nora master password 1';
  await A.page.getByLabel('Master password', { exact: true }).fill(NORA_MASTER);
  await A.page.getByLabel('Confirm master password', { exact: true }).fill(NORA_MASTER);
  await A.page.getByRole('button', { name: 'Create vault' }).click();
  await A.page.getByRole('button', { name: 'Add password' }).click();
  await fillEntry(A.page, { title: 'GitHub', login: 'nora@github.test', password: 'gh-first-secret' });
  await heading(A.page, 'GitHub').waitFor();
  const hash = psql(`select master_password_hash from password_vaults where user_id = '${nora.id}'`).trim();
  assert.match(hash, /^\$2[aby]\$12\$/); assert.ok(!psql(`select row_to_json(v)::text from password_vaults v where user_id = '${nora.id}'`).includes(NORA_MASTER));
  ok('bcrypt verifier stored; record saved');

  step('Device B (separate Persora session): wrong password refused, right one shows the record');
  const B = await newDevice();
  await signIn(B.page, 'nora@example.test', 'nora-sign-in-password');
  await heading(B.page, 'Unlock your password vault').waitFor();
  await B.page.getByLabel('Master password', { exact: true }).fill('not my master password');
  await B.page.getByRole('button', { name: 'Unlock vault' }).click();
  await B.page.getByText(/master password isn't right/).waitFor();
  await B.page.screenshot({ path: join(shots, '03-wrong-master-password.png') });
  const noToken = await B.page.evaluate(async () => { const r = await fetch('/api/password-vault/items'); return { status: r.status, body: await r.text() }; });
  assert.equal(noToken.status, 403); assert.ok(!noToken.body.includes('gh-first-secret'));
  ok('signed-in API call without the master password → 403 vault_locked');
  await B.page.getByLabel('Master password', { exact: true }).fill(NORA_MASTER);
  await B.page.getByRole('button', { name: 'Unlock vault' }).click();
  await heading(B.page, 'GitHub').waitFor();
  assert.match(await revealed(B.page, 'GitHub'), /gh-first-secret/);
  ok('same master password unlocks on the second device');

  step('Edit on B → visible on A; add on A → visible on B; delete on B → gone on A');
  await B.page.getByRole('button', { name: 'GitHub options', exact: true }).click();
  await B.page.getByRole('menuitem', { name: 'Edit password' }).click();
  await fillEntry(B.page, { password: 'gh-rotated-secret' });
  await syncNow(A.page);
  await until(async () => /gh-rotated-secret/.test(await revealed(A.page, 'GitHub')), 'edit did not reach device A');
  await A.page.getByRole('button', { name: 'Add password' }).click();
  await fillEntry(A.page, { title: 'Bank', login: 'nora', password: 'bank-secret' });
  await syncNow(B.page);
  await heading(B.page, 'Bank').waitFor();
  await B.page.getByRole('button', { name: 'Bank options', exact: true }).click();
  await B.page.getByRole('menuitem', { name: 'Delete password' }).click();
  await until(async () => (await heading(B.page, 'Bank').count()) === 0, 'delete did not apply on B');
  await syncNow(A.page);
  await until(async () => (await heading(A.page, 'Bank').count()) === 0, 'delete did not reach device A');
  ok('cross-device add / edit / delete');
  await A.page.screenshot({ path: join(shots, '04-unlocked-vault.png') });

  step('Lock and reload both require the master password again');
  await B.page.getByRole('button', { name: 'Lock vault' }).click();
  await heading(B.page, 'Unlock your password vault').waitFor();
  const C = await newDevice(); // device C stays unlocked to observe the reset
  await signIn(C.page, 'nora@example.test', 'nora-sign-in-password');
  await C.page.getByLabel('Master password', { exact: true }).fill(NORA_MASTER);
  await C.page.getByRole('button', { name: 'Unlock vault' }).click();
  await heading(C.page, 'GitHub').waitFor();
  await A.page.reload(); await A.page.getByRole('button', { name: 'Password Manager' }).click();
  await heading(A.page, 'Unlock your password vault').waitFor();
  ok('locked after "Lock vault" and after reloading');

  step('Forgot master password on A: email OTP → new master password; records unchanged');
  const before = psql(`select json_agg(i order by id)::text from (select id, data, revision, deleted from password_vault_items where user_id = '${nora.id}') i`);
  await A.page.getByRole('button', { name: 'Forgot master password?' }).click();
  await A.page.screenshot({ path: join(shots, '05-forgot-start.png') });
  await A.page.getByRole('button', { name: 'Send email OTP' }).click();
  await heading(A.page, 'Enter the email code').waitFor();
  const message = outbox.findLast((m) => m.to?.[0]?.email === 'nora@example.test');
  const code = /(\d{6})/.exec(message.textContent)[1];
  await A.page.getByLabel('Six-digit code').fill(code === '000000' ? '111111' : '000000');
  await A.page.getByRole('button', { name: 'Verify code' }).click();
  await A.page.getByText(/doesn't match|didn't match|incorrect/i).waitFor();
  await A.page.getByLabel('Six-digit code').fill(code);
  await A.page.getByRole('button', { name: 'Verify code' }).click();
  await heading(A.page, 'Set a new master password').waitFor();
  const NEW_MASTER = 'nora master password 2';
  await A.page.getByLabel('New master password', { exact: true }).fill(NEW_MASTER);
  await A.page.getByLabel('Confirm new master password', { exact: true }).fill(NEW_MASTER);
  await A.page.screenshot({ path: join(shots, '06-set-new-master.png') });
  await A.page.getByRole('button', { name: 'Set new master password' }).click();
  await heading(A.page, 'GitHub').waitFor();
  assert.equal(psql(`select json_agg(i order by id)::text from (select id, data, revision, deleted from password_vault_items where user_id = '${nora.id}') i`), before);
  ok('reset done; every record byte-for-byte unchanged');
  await syncNow(C.page);
  await heading(C.page, 'Unlock your password vault').waitFor();
  ok('the other unlocked device was locked by the reset');
  await B.page.getByLabel('Master password', { exact: true }).fill(NORA_MASTER);
  await B.page.getByRole('button', { name: 'Unlock vault' }).click();
  await B.page.getByText(/master password isn't right/).waitFor();
  await B.page.getByLabel('Master password', { exact: true }).fill(NEW_MASTER);
  await B.page.getByRole('button', { name: 'Unlock vault' }).click();
  await heading(B.page, 'GitHub').waitFor();
  assert.match(await revealed(B.page, 'GitHub'), /gh-rotated-secret/);
  ok('old master password refused, new one works on another device');
  const reused = await A.page.evaluate(async (c) => (await fetch('/api/password-vault/recovery/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) })).status, code);
  assert.equal(reused, 400); ok('OTP cannot be reused');

  step('Another member cannot reach Nora\'s records');
  const lenaToken = await L.page.evaluate(async () => { const r = await fetch('/api/password-vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterPassword: 'lena new master password' }) }); return (await r.json()).token; });
  const lenaItems = await L.page.evaluate(async (t) => (await (await fetch('/api/password-vault/items', { headers: { 'X-Persora-Vault-Token': t } })).json()), lenaToken);
  assert.deepEqual(lenaItems.items.map((i) => i.entry.title).sort(), ['Bank', 'Email']);
  const anon = await fetch(`${base}/rest/v1/password_vault_items?select=*`, { headers: { apikey: 'anon' } });
  assert.notEqual(anon.status, 200);
  ok('token scoped to its own member; PostgREST without the service role is refused');

  step('Batch-convert the remaining legacy vault with the CLI, then apply the cleanup migration');
  // async: the CLI calls back into this process (the /rest/v1 proxy), so the event loop must stay free
  const cli = (await promisify(execFile)('node', ['scripts/migrate-password-vault-legacy.mjs'], { cwd: repo, env: { ...process.env, SUPABASE_URL: base, SUPABASE_SECRET_KEY: SERVICE_KEY, PASSWORD_VAULT_ESCROW_PRIVATE_KEY: ESCROW_PRIVATE } })).stdout;
  console.log(cli.trim().split('\n').map((line) => `    ${line}`).join('\n'));
  applyMigration('202610240002_password_vault_drop_legacy_encryption.sql');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(psql(`select count(*) from information_schema.columns where table_name = 'password_vault_items' and column_name = 'ciphertext'`).trim(), '0');
  ok('legacy columns and functions dropped');
  const O = await newDevice();
  await signIn(O.page, 'omar@example.test', 'omar-sign-in-password');
  await heading(O.page, 'Set your new master password').waitFor();
  await O.page.getByLabel('Master password', { exact: true }).fill('omar new master password');
  await O.page.getByLabel('Confirm master password', { exact: true }).fill('omar new master password');
  await O.page.getByRole('button', { name: 'Create vault' }).click();
  await heading(O.page, 'Router').waitFor();
  assert.match(await revealed(O.page, 'Router'), /omar-router-secret/);
  await A.page.reload(); await A.page.getByRole('button', { name: 'Password Manager' }).click();
  await A.page.getByLabel('Master password', { exact: true }).fill(NEW_MASTER);
  await A.page.getByRole('button', { name: 'Unlock vault' }).click();
  await heading(A.page, 'GitHub').waitFor();
  ok('after cleanup: migrated and existing members open their vaults');
  assert.deepEqual(errorsSeen, [], 'no uncaught page errors');
  console.log(`\nALL PASSWORD MANAGER E2E CHECKS PASSED (screenshots: ${shots})`);
} catch (error) {
  console.error('\nE2E FAILED:', error);
  for (const ctx of browser?.contexts() || []) for (const [i, page] of ctx.pages().entries()) await page.screenshot({ path: join(shots, `failure-${browser.contexts().indexOf(ctx)}-${i}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); stopAll(); process.exit(process.exitCode || 0);
}
