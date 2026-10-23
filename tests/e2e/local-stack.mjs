// Production-like local stack for browser end-to-end checks of the Password
// Manager (not part of `npm test`; needs PostgreSQL ≥15 server binaries and a
// PostgREST binary):
//
//   PostgreSQL  real server, Supabase roles (anon / authenticated / service_role
//               / authenticator) and Supabase's default privileges, then
//               supabase/schema.sql + migrations exactly as deployed.
//   PostgREST   what Supabase exposes at /rest/v1 (service-role JWT).
//   Worker      cloudflare/api.js — the same module Pages Functions runs.
//   Static UI   the production build in dist/ (run `npm run build` first).
//   Email       Brevo calls are captured; read them at GET /__test/outbox.
//
// PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const repo = new URL('../../', import.meta.url).pathname;
const PG_BIN = process.env.PG_BIN || '/usr/lib/postgresql/17/bin';
const POSTGREST_BIN = process.env.POSTGREST_BIN || '/tmp/pgrst/postgrest';
const PG_PORT = Number(process.env.E2E_PG_PORT || 54322);
const REST_PORT = Number(process.env.E2E_REST_PORT || 54321);
export const APP_PORT = Number(process.env.E2E_APP_PORT || 8788);
const DATA = process.env.E2E_PGDATA || '/tmp/persora-e2e-pgdata';
const JWT_SECRET = 'persora-local-e2e-jwt-secret-0123456789abcdef';
const b64url = (value) => Buffer.from(value).toString('base64url');
const jwt = (payload) => { const body = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`; return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`; };
export const SERVICE_KEY = jwt({ role: 'service_role', iss: 'persora-e2e', iat: 1700000000, exp: 4102444800 });

const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asPostgres = (args) => (process.getuid?.() === 0 ? ['runuser', ['-u', 'postgres', '--', ...args]] : [args[0], args.slice(1)]);
function run(args, opts = {}) { const [cmd, rest] = asPostgres(args); return execFileSync(cmd, rest, { stdio: ['pipe', 'pipe', 'pipe'], ...opts }).toString(); }

export function psql(sql) {
  return run([join(PG_BIN, 'psql'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', 'postgres', '-At'], { input: sql });
}
export const migrations = () => readdirSync(join(repo, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
export function applyMigration(name) { psql(readFileSync(join(repo, 'supabase/migrations', name), 'utf8')); psql("notify pgrst, 'reload schema';"); }

const PRELUDE = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter role postgres set search_path = public, extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

/** Starts Postgres + PostgREST and loads the schema with migrations before `stopBefore`. */
export async function startDatabase({ stopBefore } = {}) {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true });
  if (process.getuid?.() === 0) execFileSync('chown', ['-R', 'postgres:postgres', DATA]);
  run([join(PG_BIN, 'initdb'), '-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  const [cmd, rest] = asPostgres([join(PG_BIN, 'postgres'), '-D', DATA, '-p', String(PG_PORT), '-k', '/tmp', '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off']);
  const pg = spawn(cmd, rest, { stdio: ['ignore', 'ignore', 'pipe'] }); children.push(pg);
  for (let i = 0; i < 100; i++) { try { psql('select 1'); break; } catch { await sleep(100); } }
  psql(PRELUDE);
  psql(readFileSync(join(repo, 'supabase/schema.sql'), 'utf8'));
  const pending = [];
  for (const name of migrations()) { if (stopBefore && name >= stopBefore) pending.push(name); else psql(readFileSync(join(repo, 'supabase/migrations', name), 'utf8')); }
  const conf = join(DATA, '..', 'persora-e2e-postgrest.conf');
  writeFileSync(conf, [
    `db-uri = "postgres://authenticator:authenticator@127.0.0.1:${PG_PORT}/postgres"`,
    'db-schemas = "public"', 'db-anon-role = "anon"', 'db-extra-search-path = "public, extensions"',
    `jwt-secret = "${JWT_SECRET}"`, `server-port = ${REST_PORT}`, 'server-host = "127.0.0.1"', 'db-channel-enabled = true',
  ].join('\n'));
  const postgrest = spawn(POSTGREST_BIN, [conf], { stdio: ['ignore', 'pipe', 'pipe'] }); children.push(postgrest);
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${REST_PORT}/`); if (r.ok) break; } catch { /* starting */ } await sleep(100); }
  return { pending };
}

/** In-memory stand-in for the VAULT_FILES R2 binding (other Persora features touch it). */
function memoryBucket() {
  const objects = new Map();
  return {
    async put(key, value, options = {}) { const body = value instanceof ArrayBuffer ? new Uint8Array(value) : typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer()); objects.set(key, { body, httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} }); return { key, size: body.byteLength }; },
    async get(key) { const o = objects.get(key); if (!o) return null; return { key, size: o.body.byteLength, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, body: new Response(o.body).body, arrayBuffer: async () => o.body.buffer.slice(0), text: async () => new TextDecoder().decode(o.body), writeHttpMetadata(h) { if (o.httpMetadata.contentType) h.set('Content-Type', o.httpMetadata.contentType); } }; },
    async head(key) { const o = objects.get(key); return o ? { key, size: o.body.byteLength, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null; },
    async delete(keys) { for (const key of [].concat(keys)) objects.delete(key); },
    async list({ prefix = '' } = {}) { return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: objects.get(key).body.byteLength })), truncated: false }; },
  };
}

export const outbox = [];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

/** Serves dist/ + /api (the real Worker) + /rest/v1 (proxied to PostgREST). */
export async function startApp(extraEnv = {}) {
  const { default: worker } = await import('../../cloudflare/api.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (url.hostname === 'api.brevo.com') { outbox.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: `<e2e-${outbox.length}@local>` }), { status: 201, headers: { 'Content-Type': 'application/json' } }); }
    return realFetch(input, init);
  };
  const env = { SUPABASE_URL: `http://127.0.0.1:${APP_PORT}`, SUPABASE_SECRET_KEY: SERVICE_KEY, BREVO_API_KEY: 'e2e-test-key', BREVO_SENDER_EMAIL: 'noreply@persora.test', VAULT_FILES: memoryBucket(), ...extraEnv };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
      let body; if (!['GET', 'HEAD'].includes(req.method)) { const chunks = []; for await (const chunk of req) chunks.push(chunk); body = Buffer.concat(chunks); }
      if (url.pathname === '/__test/outbox') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(outbox)); return; }
      if (url.pathname.startsWith('/rest/v1/')) {
        const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
        if (headers.apikey && !headers.authorization) headers.authorization = `Bearer ${headers.apikey}`;
        const upstream = await realFetch(`http://127.0.0.1:${REST_PORT}${url.pathname.slice(8)}${url.search}`, { method: req.method, headers, body });
        res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([k]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(k))));
        res.end(Buffer.from(await upstream.arrayBuffer())); return;
      }
      if (url.pathname.startsWith('/api/')) {
        const request = new Request(url, { method: req.method, headers: Object.entries(req.headers).filter(([k]) => k !== 'host').map(([k, v]) => [k, String(v)]), body, duplex: 'half' });
        const pending = [];
        const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
        const headers = new Headers(response.headers);
        res.writeHead(response.status, Object.fromEntries([...headers].filter(([k]) => k !== 'set-cookie').concat(headers.getSetCookie().length ? [['set-cookie', headers.getSetCookie()]] : [])));
        res.end(Buffer.from(await response.arrayBuffer()));
        await Promise.allSettled(pending); return;
      }
      let file = join(repo, 'dist', decodeURIComponent(url.pathname));
      if (!file.startsWith(join(repo, 'dist')) || !existsSync(file) || !extname(file)) file = join(repo, 'dist', 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (error) { console.error('[e2e stack]', error); res.writeHead(500); res.end('stack error'); }
  });
  await new Promise((resolve) => server.listen(APP_PORT, '0.0.0.0', resolve));
  return { server, env, baseUrl: `http://127.0.0.1:${APP_PORT}` };
}

/** Service-role RPC through PostgREST (as the Worker does). */
export async function rpc(fn, args) {
  const response = await fetch(`http://127.0.0.1:${REST_PORT}/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error(`${fn}: ${response.status} ${await response.text()}`);
  return response.json();
}

export function stopAll() { for (const child of children.reverse()) { try { child.kill('SIGINT'); } catch { /* gone */ } } }
process.on('exit', stopAll);
