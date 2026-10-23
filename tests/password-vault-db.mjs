// In-memory Postgres (PGlite) loaded with the real Password Manager migrations,
// so the vault/recovery SQL functions are exercised exactly as deployed.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

export async function createVaultDatabase() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    create table public.profiles (id uuid primary key, email text not null, account_status text not null default 'active');
  `);
  await db.exec(await migration('202610210001_password_vault_recovery.sql'));
  await db.exec(await migration('202610230009_password_vault_sync.sql'));

  /** PostgREST-compatible RPC: named arguments in, JSON result out. */
  async function rpc(fn, args = {}) {
    if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function name');
    const names = Object.keys(args);
    const params = names.map((name, index) => `${name} => $${index + 1}`).join(', ');
    const values = names.map((name) => {
      const value = args[name];
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
    });
    const result = await db.query(`select * from public.${fn}(${params})`, values);
    const fields = result.fields.map((field) => field.name);
    if (fields.length === 1 && fields[0] === fn) return result.rows[0]?.[fn] ?? null; // scalar (jsonb) function
    return result.rows;
  }

  async function addProfile(id, email) {
    await db.query('insert into public.profiles(id, email, account_status) values ($1, $2, $3)', [id, email, 'active']);
  }

  return { db, rpc, addProfile };
}
