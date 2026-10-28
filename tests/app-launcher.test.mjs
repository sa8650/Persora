// App launcher: module registry, favorites rules, icons and the preferences API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LAUNCHER_FAVORITES, LAUNCHER_FAVORITES_MAX, LAUNCHER_MODULE_IDS, effectiveLauncherFavorites, isLauncherModuleId,
  moveFavorite, normalizeLauncherFavorites, splitLauncherModules,
} from '../cloudflare/workspace-modules.js';
import { handleWorkspacePreferences, exportWorkspacePreferences } from '../cloudflare/workspace-preferences.js';
import worker from '../cloudflare/api.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('src/components/Workspace.tsx');
const types = read('src/types.ts');
const data = read('src/data.ts');
const catalogue = read('src/lib/app-launcher.ts');
const icons = read('src/components/launcher/LauncherIcons.tsx');
const fullSchema = read('supabase/schema.sql');
const migration = fullSchema.slice(
  fullSchema.indexOf('create table if not exists public.workspace_preferences'),
  fullSchema.indexOf('grant all on public.workspace_preferences to service_role;') + 'grant all on public.workspace_preferences to service_role;'.length,
);

const ACCOUNT_VIEWS = new Set(['trash', 'billing', 'settings']);
const viewIds = () => {
  const union = types.match(/export type ViewId\s*=([^;]+);/)[1];
  const literals = [...union.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  const sections = [...data.matchAll(/\n    id: "([a-z-]+)",\n    label:/g)].map((match) => match[1]);
  return new Set([...literals, ...(union.includes('SectionId') ? sections : [])]);
};

test('registry: every launcher module is a real workspace view, listed once', () => {
  assert.equal(new Set(LAUNCHER_MODULE_IDS).size, LAUNCHER_MODULE_IDS.length, 'no duplicate modules');
  const views = viewIds();
  for (const id of LAUNCHER_MODULE_IDS) assert.ok(views.has(id), `${id} is a ViewId`);
  for (const id of ACCOUNT_VIEWS) assert.ok(!LAUNCHER_MODULE_IDS.includes(id), `${id} is an account page, not a module`);
});

test('registry: matches the workspace sidebar exactly (no missing or invented modules)', () => {
  const sidebarViews = [...workspace.matchAll(/sidebarLink\("([a-z-]+)", "([^"]+)"/g)].map(([, id, label]) => ({ id, label }));
  const sidebarSections = [...data.matchAll(/\n    id: "([a-z-]+)",\n    label:/g)].map((match) => match[1]);
  const expected = new Set([...sidebarViews.map((entry) => entry.id).filter((id) => !ACCOUNT_VIEWS.has(id)), ...sidebarSections]);
  assert.deepEqual([...expected].sort(), [...LAUNCHER_MODULE_IDS].sort());
  // Non-section modules use the sidebar's own names.
  for (const { id, label } of sidebarViews) {
    if (ACCOUNT_VIEWS.has(id)) continue;
    const entry = catalogue.match(new RegExp(`"?${id}"?: \\{ label: "([^"]+)"`));
    assert.ok(entry, `${id} has a launcher label`);
    assert.equal(entry[1], label, `${id} label matches the sidebar`);
  }
});

test('registry: every section in the sidebar groups is a launcher module', () => {
  const groups = data.slice(data.indexOf('export const NAV_GROUPS'));
  const ids = [...groups.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]).filter((id) => viewIds().has(id));
  for (const id of ids) assert.ok(LAUNCHER_MODULE_IDS.includes(id), `${id} from NAV_GROUPS is in the launcher`);
});

test('icons: one custom inline SVG per module, nothing remote, raster or emoji', () => {
  for (const id of LAUNCHER_MODULE_IDS) {
    assert.ok(new RegExp(`\\n  (?:"${id}"|${id}): \\(id\\) => <>`).test(icons), `icon drawn for ${id}`);
  }
  const drawn = [...icons.matchAll(/\n  (?:"([a-z-]+)"|([a-z-]+)): \(id\) => <>/g)].map((match) => match[1] || match[2]);
  assert.deepEqual([...drawn].sort(), [...LAUNCHER_MODULE_IDS].sort(), 'no extra or missing icons');
  assert.ok(!/<image|<img|https?:\/\/|xlink:href|data:image/i.test(icons), 'no rasters or remote URLs');
  assert.ok(!/\p{Extended_Pictographic}/u.test(icons), 'no emoji');
  assert.ok(!/from "lucide-react"/.test(icons), 'module icons are not from an icon library');
  // Every icon body is distinct artwork.
  const bodies = icons.split(/\n  (?:"[a-z-]+"|[a-z-]+): \(id\) => <>/).slice(1).map((body) => body.split('</>,')[0].replace(/\s+/g, ' '));
  assert.equal(new Set(bodies).size, bodies.length);
});

test('favorites: normalization keeps known ids once, in order, capped', () => {
  assert.equal(normalizeLauncherFavorites(undefined), null);
  assert.equal(normalizeLauncherFavorites(null), null);
  assert.equal(normalizeLauncherFavorites('calendar'), null);
  assert.equal(normalizeLauncherFavorites({ 0: 'calendar' }), null);
  assert.deepEqual(normalizeLauncherFavorites([]), [], 'an empty choice is kept');
  assert.deepEqual(normalizeLauncherFavorites(['notes', 'settings', 'nope', 'notes', 42, null, 'calendar']), ['notes', 'calendar']);
  const many = normalizeLauncherFavorites([...LAUNCHER_MODULE_IDS, ...LAUNCHER_MODULE_IDS]);
  assert.equal(many.length, LAUNCHER_FAVORITES_MAX);
  assert.deepEqual(many, LAUNCHER_MODULE_IDS.slice(0, LAUNCHER_FAVORITES_MAX));
  assert.equal(isLauncherModuleId('pdf-studio'), true);
  assert.equal(isLauncherModuleId('admin'), false);
});

test('favorites: defaults are valid, and favorites + others never overlap', () => {
  assert.equal(DEFAULT_LAUNCHER_FAVORITES.length, 9);
  assert.deepEqual(normalizeLauncherFavorites([...DEFAULT_LAUNCHER_FAVORITES]), [...DEFAULT_LAUNCHER_FAVORITES]);
  assert.deepEqual(effectiveLauncherFavorites(null), [...DEFAULT_LAUNCHER_FAVORITES]);
  assert.deepEqual(effectiveLauncherFavorites([]), []);
  for (const choice of [null, [], ['urls', 'dashboard'], [...LAUNCHER_MODULE_IDS], ['bogus', 'notes', 'notes']]) {
    const { favorites, others } = splitLauncherModules(choice);
    const all = [...favorites, ...others];
    assert.equal(new Set(all).size, all.length, 'no module shown twice');
    assert.deepEqual([...all].sort(), [...LAUNCHER_MODULE_IDS].sort(), 'every module shown once');
    assert.deepEqual(others, LAUNCHER_MODULE_IDS.filter((id) => !favorites.includes(id)), 'others keep the canonical order');
  }
});

test('favorites: moveFavorite reorders and clamps', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveFavorite(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveFavorite(list, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveFavorite(list, 1, 99), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveFavorite(list, 2, -5), ['c', 'a', 'b', 'd']);
  assert.deepEqual(moveFavorite(list, 9, 0), list);
  assert.deepEqual(list, ['a', 'b', 'c', 'd'], 'input untouched');
});

test('schema: workspace_preferences is owner-scoped and locked to the service role', () => {
  assert.match(migration, /create table if not exists public\.workspace_preferences/);
  assert.match(migration, /REFERENCES public\.profiles\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.workspace_preferences from public, anon, authenticated/);
  assert.doesNotMatch(migration, /\bdrop\b|\btruncate\b|\bdelete from\b|alter table public\.(?!workspace_preferences)/i);
});

// ---------------------------------------------------------------------------
// Pages API: /workspace/preferences against a mocked PostgREST
// ---------------------------------------------------------------------------

const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const ORIGIN = 'https://persora.example';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const identity = { id: OWNER };

function mockDatabase({ row = null, failWith = null } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', body, headers: init.headers || {} });
    if (failWith) return Response.json(failWith.body, { status: failWith.status });
    if (url.pathname === '/rest/v1/workspace_preferences') {
      if ((init.method || 'GET') === 'POST') return Response.json([{ ...body, updated_at: '2026-10-24T10:00:00+00:00' }], { status: 201 });
      return Response.json(row ? [row] : []);
    }
    return Response.json([]);
  };
  return calls;
}
const call = async (method, body, { raw, contentType = 'application/json' } = {}) => {
  const init = { method };
  if (body !== undefined || raw !== undefined) { init.body = raw ?? JSON.stringify(body); init.headers = { 'Content-Type': contentType }; }
  const response = await handleWorkspacePreferences(new Request(`${ORIGIN}/api/workspace/preferences`, init), identity, env, ORIGIN);
  return { status: response.status, body: await response.json() };
};

test('API: GET returns null favorites until customized, scoped to the member', async () => {
  const calls = mockDatabase();
  const empty = await call('GET');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { launcherFavorites: null, updatedAt: null, saved: false });
  assert.equal(calls[0].url.searchParams.get('user_id'), `eq.${OWNER}`);

  mockDatabase({ row: { launcher_favorites: ['pdf-studio', 'ghost', 'notes', 'notes'], updated_at: '2026-10-24T09:00:00+00:00' } });
  const saved = await call('GET');
  assert.deepEqual(saved.body, { launcherFavorites: ['pdf-studio', 'notes'], updatedAt: '2026-10-24T09:00:00+00:00', saved: true });
});

test('API: PUT normalizes and upserts the member\'s own row', async () => {
  const calls = mockDatabase();
  const result = await call('PUT', { launcherFavorites: ['calendar', 'calendar', 'settings', 'urls'] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.launcherFavorites, ['calendar', 'urls']);
  assert.equal(result.body.saved, true);
  assert.equal(result.body.updatedAt, '2026-10-24T10:00:00+00:00');
  const upsert = calls.find((entry) => entry.method === 'POST');
  assert.equal(upsert.url.searchParams.get('on_conflict'), 'user_id');
  assert.equal(upsert.body.user_id, OWNER);
  assert.deepEqual(upsert.body.launcher_favorites, ['calendar', 'urls']);
  assert.match(upsert.headers.Prefer, /merge-duplicates/);

  const reset = await call('PUT', { launcherFavorites: null });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.launcherFavorites, null, 'null restores the defaults');
  const cleared = await call('PUT', { launcherFavorites: [] });
  assert.deepEqual(cleared.body.launcherFavorites, []);
});

test('API: rejects malformed input before touching the database', async () => {
  const calls = mockDatabase();
  assert.equal((await call('PUT', {})).status, 400);
  assert.equal((await call('PUT', { launcherFavorites: 'calendar' })).status, 400);
  assert.equal((await call('PUT', { launcherFavorites: Array(60).fill('notes') })).status, 400);
  assert.equal((await call('PUT', undefined, { raw: '{oops' })).status, 400);
  assert.equal((await call('PUT', undefined, { raw: '{}', contentType: 'text/plain' })).status, 415);
  assert.equal((await call('PUT', undefined, { raw: JSON.stringify({ launcherFavorites: [], pad: 'x'.repeat(9000) }) })).status, 413);
  assert.equal((await call('DELETE')).status, 405);
  assert.equal(calls.length, 0);
});

test('API: an unmigrated database reports 503; export degrades to null', async () => {
  mockDatabase({ failWith: { status: 404, body: { code: 'PGRST205', message: 'missing table' } } });
  const result = await call('GET');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /supabase\/schema\.sql/);
  assert.equal(await exportWorkspacePreferences(OWNER, env), null);
  mockDatabase({ row: { launcher_favorites: ['notes'], updated_at: '2026-10-24T09:00:00+00:00' } });
  assert.deepEqual(await exportWorkspacePreferences(OWNER, env), { launcher_favorites: ['notes'], updated_at: '2026-10-24T09:00:00+00:00' });
});

test('API: the route requires a signed-in member', async () => {
  mockDatabase();
  const anonymous = await worker.fetch(new Request(`${ORIGIN}/api/workspace/preferences`), env, { waitUntil() {} });
  assert.equal(anonymous.status, 401);
});
