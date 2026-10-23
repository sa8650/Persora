// In-memory Postgres (PGlite + real pgcrypto) loaded with Persora's real
// supabase/schema.sql and every migration in filename order, so the Password
// Manager SQL (bcrypt verifier, vault sessions, OTP reset, RLS/privileges) is
// exercised exactly as it is deployed. Supabase's API roles and its default
// privileges (new tables/functions granted to anon/authenticated) are recreated
// so the migrations' REVOKE statements are actually tested.
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = new URL('../supabase/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
export const migrationNames = async () => (await readdir(new URL('migrations/', root))).filter((name) => name.endsWith('.sql')).sort();

/**
 * @param {{ stopBefore?: string }} options apply migrations up to (not including) `stopBefore`
 */
export async function createVaultDatabase({ stopBefore } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public, extensions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    alter database template1 set search_path = public, extensions;
    set search_path = public, extensions;
  `);
  await db.exec(await read('schema.sql'));
  const pending = [];
  for (const name of await migrationNames()) {
    if (stopBefore && name >= stopBefore) { pending.push(name); continue; }
    await db.exec(await read(`migrations/${name}`));
  }

  /** Applies the next not-yet-applied migration(s) up to and including `name`. */
  async function applyThrough(name) {
    while (pending.length && pending[0] <= name) await db.exec(await read(`migrations/${pending.shift()}`));
  }

  /** PostgREST-compatible RPC as the service role: named arguments in, JSON out. */
  async function rpc(fn, args = {}) {
    if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function name');
    const names = Object.keys(args);
    const params = names.map((name, index) => `${name} => $${index + 1}`).join(', ');
    const values = names.map((name) => { const value = args[name]; return value !== null && typeof value === 'object' ? JSON.stringify(value) : value; });
    await db.exec('set role service_role');
    try {
      const result = await db.query(`select * from public.${fn}(${params})`, values);
      const fields = result.fields.map((field) => field.name);
      if (fields.length === 1 && fields[0] === fn) return result.rows[0]?.[fn] ?? null; // scalar (jsonb) function
      return result.rows;
    } finally { await db.exec('reset role'); }
  }

  /** A Persora member with a bcrypt sign-in password and one live Persora session. */
  async function addMember(label, { loginPassword = `login-password-${label}-123`, role = 'user' } = {}) {
    const loginId = String(1000000 + Math.floor(Math.random() * 8999999));
    const email = `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const { rows } = await db.query(
      `insert into public.profiles(login_id, email, full_name, password_hash, role, account_status)
       values ($1, $2, $3, crypt($4, gen_salt('bf', 4)), $5, 'active') returning id`,
      [loginId, email, label, loginPassword, role]);
    const identity = { id: rows[0].id, email, account_status: 'active', role, login_password: loginPassword };
    identity.session_id = await addSession(identity.id);
    return identity;
  }
  async function addSession(userId, expiresAt = new Date(Date.now() + 7 * 864e5)) {
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const { rows } = await db.query(`insert into public.user_sessions(user_id, token_hash, expires_at) values ($1, encode(digest($2, 'sha256'), 'hex'), $3) returning id`, [userId, token, expiresAt.toISOString()]);
    return rows[0].id;
  }

  return { db, rpc, addMember, addSession, applyThrough, pending };
}
