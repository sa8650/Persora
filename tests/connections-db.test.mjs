// Connections migration on PGlite (schema.sql + every migration, in order):
// tables closed to browser roles, one row per member+provider, status checks,
// cascade on account deletion and safe re-application.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVaultDatabase } from './password-vault-db.mjs';

const { db, addMember } = await createVaultDatabase();
const alice = await addMember('conn-alice');
const rejects = async (promise, code) => { await assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; }); };
const insert = (userId, extra = {}) => db.query(
  `insert into public.user_connections(user_id, provider, status, account_email, credential_ciphertext) values ($1, $2, $3, 'a@ems.test', 'v1.x.y') returning id`,
  [userId, extra.provider || 'ems', extra.status || 'connected']);

test('connection tables are closed to anon/authenticated', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await rejects(db.query('select * from public.user_connections'), '42501');
      await rejects(db.query('select * from public.integration_settings'), '42501');
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { await db.query('select * from public.user_connections'); await db.query('select * from public.integration_settings'); }
  finally { await db.exec('reset role'); }
});

test('one connection per member and provider; statuses and providers are constrained', async () => {
  await insert(alice.id);
  await rejects(insert(alice.id), '23505');
  await rejects(insert(alice.id, { provider: 'google-drive', status: 'broken' }), '23514');
  await rejects(insert(alice.id, { provider: 'Bad Provider' }), '23514');
  await db.query(`insert into public.integration_settings(provider, enabled, base_url, secret_last4) values ('ems', true, 'https://ems.example', 'abcd')`);
  await rejects(db.query(`insert into public.integration_settings(provider, secret_last4) values ('other', 'abcdef')`), '23514');
});

test('deleting a Persora account removes its connections', async () => {
  const bob = await addMember('conn-bob');
  await insert(bob.id);
  await db.query('delete from public.profiles where id = $1', [bob.id]);
  assert.equal(Number((await db.query('select count(*) from public.user_connections where user_id = $1', [bob.id])).rows[0].count), 0);
});

test('the migration is safe to apply again and keeps existing data', async () => {
  const before = Number((await db.query('select count(*) from public.user_connections')).rows[0].count);
  await db.exec(await readFile(new URL('../supabase/migrations/202610310001_connections.sql', import.meta.url), 'utf8'));
  assert.equal(Number((await db.query('select count(*) from public.user_connections')).rows[0].count), before);
});
