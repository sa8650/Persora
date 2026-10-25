// Connections page in a DOM: official logo per service, Notion-style tabs/toolbar, filters,
// no actions for services that aren't built yet, and the Manage tab for a real connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GlobalWindow } from 'happy-dom';

const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) if (!(key in globalThis)) globalThis[key] = happyWindow[key];
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.navigator = happyWindow.navigator;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.MutationObserver = happyWindow.MutationObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { CONNECTION_PROVIDERS } = await import('../cloudflare/connections.js');
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

let emsState = 'not_connected';
const providers = () => CONNECTION_PROVIDERS.map((p) => ({
  ...p, enabled: p.available, status: p.available ? emsState : 'coming_soon',
  connection: p.available && emsState !== 'not_connected' ? { provider: p.id, status: emsState, account: { id: 'a1', name: 'Rahim Traders', email: 'admin@rahim.example', code: 'ADM-1' }, connectedAt: '2026-10-01T10:00:00Z', lastSyncedAt: '2026-10-24T10:00:00Z', lastError: emsState === 'reauth_required' ? 'The EMS password was changed.' : null } : null,
}));
globalThis.fetch = async (url) => {
  const { pathname } = new URL(String(url), 'http://localhost');
  if (pathname === '/api/connections') return new Response(JSON.stringify({ providers: providers() }), { headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
};

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.connections-view-'));
const outfile = path.join(outDir, 'ConnectionsView.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/components/connections/ConnectionsView.tsx', import.meta.url).pathname],
  outfile, bundle: true, format: 'esm', platform: 'browser', loader: { '.css': 'empty', '.svg': 'file' }, assetNames: '[name]',
  external: ['react', 'react-dom', 'lucide-react'], jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' }, logLevel: 'silent',
});
const { default: ConnectionsView } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');
const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(ConnectionsView, { user: { id: 'u1', demo: false }, notify: () => {}, canUpload: true })); await sleep(30); });
  const rows = () => [...container.querySelectorAll('.cn-rows > .cn-row')];
  const rowFor = (name) => rows().find((row) => row.querySelector('.cn-row-title b')?.textContent === name);
  return {
    container, rows, rowFor,
    async click(element) { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); }); },
    async change(element, value) {
      await act(async () => {
        const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
        element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        await sleep();
      });
    },
    tab: (label) => [...container.querySelectorAll('[role=tab]')].find((tab) => tab.textContent.startsWith(label)),
    async unmount() { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

test('every provider has its own official logo file (local SVG, no remote references)', () => {
  const parts = read('src/components/connections/ConnectionParts.tsx');
  const files = new Set();
  for (const provider of CONNECTION_PROVIDERS) {
    const entry = parts.match(new RegExp(`"?${provider.id}"?: (\\w+),`));
    assert.ok(entry, `${provider.id} is registered in PROVIDER_LOGOS`);
    const file = parts.match(new RegExp(`import ${entry[1]} from "\\.\\./\\.\\./assets/connections/([a-z-]+\\.svg)"`))?.[1];
    assert.ok(file, `${provider.id} logo is a local SVG import`);
    files.add(file);
    const svg = read(`src/assets/connections/${file}`);
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${file} is a standalone SVG`);
    assert.doesNotMatch(svg, /(?:href|src)="https?:/, `${file} loads nothing remote`);
    assert.doesNotMatch(svg, /<script/i, `${file} has no script`);
  }
  assert.equal(files.size, CONNECTION_PROVIDERS.length, 'no two services share a logo');
  assert.ok(existsSync(new URL('../src/assets/connections/README.md', import.meta.url)), 'logo sources documented');
  assert.doesNotMatch(parts, /PROVIDER_LOOK|LayoutGrid|<Cloud /, 'no generic icons standing in for brands');
});

test('the demo/offline list mirrors the provider registry', () => {
  const view = read('src/components/connections/ConnectionsView.tsx');
  const offline = view.slice(view.indexOf('const OFFLINE_PROVIDERS'));
  const ids = [...offline.matchAll(/(?:id: |\[)"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), CONNECTION_PROVIDERS.map((p) => p.id).sort());
});

test('browse: header, tabs, toolbar, one row per service; only EMS has an action', async () => {
  emsState = 'not_connected';
  const view = await mount();
  assert.equal(view.container.querySelector('.cn-page-head h2').textContent, 'Connections');
  assert.deepEqual([...view.container.querySelectorAll('[role=tab]')].map((t) => t.textContent.replace(/\d+$/, '')), ['Browse connections', 'Connected', 'Manage']);
  assert.equal(view.tab('Connected').querySelector('.cn-count').textContent, '0');
  assert.ok(view.container.querySelector('.cn-search input[type=search]'));
  assert.equal(view.container.querySelectorAll('.cn-toolbar select').length, 2, 'category + type filters');
  assert.equal(view.rows().length, CONNECTION_PROVIDERS.length);
  for (const provider of CONNECTION_PROVIDERS) {
    const row = view.rowFor(provider.name);
    assert.ok(row, `${provider.name} row`);
    const img = row.querySelector('.cn-logo img');
    assert.ok(img && img.getAttribute('alt') === `${provider.name} logo`, `${provider.name} shows its logo`);
    if (provider.available) assert.equal(row.querySelector('.cn-row-action button').textContent, 'Connect');
    else {
      assert.equal(row.querySelector('button'), null, `${provider.name} has no fake action`);
      assert.equal(row.querySelector('.cn-row-note').textContent, 'Coming soon');
      assert.equal(row.querySelector('.cn-pill-good'), null, `${provider.name} is never shown as connected`);
    }
  }
  assert.equal(view.rows()[0].querySelector('.cn-row-title b').textContent, 'EMS', 'working integration listed first');
  await view.unmount();
});

test('search, category and type filters narrow the list; Add connection only offers working services', async () => {
  emsState = 'not_connected';
  const view = await mount();
  await view.change(view.container.querySelector('.cn-search input'), 'google');
  assert.deepEqual(view.rows().map((r) => r.querySelector('.cn-row-title b').textContent), ['Google Calendar', 'Google Docs', 'Google Drive', 'Google Photos']);
  await view.change(view.container.querySelector('.cn-search input'), 'zzz');
  assert.ok(view.container.querySelector('.cn-empty'), 'empty state');
  await view.click(view.container.querySelector('.cn-empty .cn-link-button'));
  assert.equal(view.rows().length, CONNECTION_PROVIDERS.length, 'clear filters');
  const [category, type] = view.container.querySelectorAll('.cn-toolbar select');
  await view.change(category, 'Storage');
  assert.deepEqual(view.rows().map((r) => r.querySelector('.cn-row-title b').textContent), ['Google Drive', 'Microsoft OneDrive']);
  await view.change(category, 'all');
  await view.change(type, 'dexter');
  assert.deepEqual(view.rows().map((r) => r.querySelector('.cn-row-title b').textContent), ['EMS']);
  await view.change(type, 'third-party');
  assert.equal(view.rows().length, CONNECTION_PROVIDERS.length - 1);

  await view.click(view.container.querySelector('.cn-add-trigger'));
  const items = [...view.container.querySelectorAll('.cn-menu [role=menuitem]')];
  assert.deepEqual(items.map((i) => i.querySelector('b').textContent), ['EMS'], 'only functional providers');
  assert.match(view.container.querySelector('.cn-menu-foot').textContent, /coming soon/i);
  await view.click(items[0]);
  assert.ok(document.body.querySelector('#cn-connect-title'), 'opens the in-app EMS sign-in (no redirect)');
  await view.unmount();
  document.body.innerHTML = '';
});

test('connected and manage tabs show the real EMS connection with Manage / Disconnect; reauth shows Reconnect', async () => {
  emsState = 'connected';
  let view = await mount();
  assert.equal(view.tab('Connected').querySelector('.cn-count').textContent, '1');
  assert.equal(view.rowFor('EMS').querySelector('.cn-row-action button').textContent, 'Manage');
  assert.match(view.rowFor('EMS').querySelector('p').textContent, /admin@rahim\.example/);
  await view.click(view.tab('Connected'));
  assert.deepEqual(view.rows().map((r) => r.querySelector('.cn-row-title b').textContent), ['EMS']);
  await view.click(view.tab('Manage'));
  const row = view.container.querySelector('.cn-table-row');
  assert.ok(row);
  assert.match(row.textContent, /Rahim Traders/);
  assert.deepEqual([...row.querySelectorAll('button')].map((b) => b.textContent), ['Manage', 'Disconnect']);
  await view.click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect'));
  assert.ok(document.body.querySelector('#cn-disconnect-title'), 'disconnect asks for confirmation');
  await view.unmount();
  document.body.innerHTML = '';

  emsState = 'reauth_required';
  view = await mount();
  assert.match(view.rowFor('EMS').querySelector('.cn-row-action button').textContent, /Reconnect/);
  assert.match(view.rowFor('EMS').textContent, /password was changed/);
  await view.unmount();
});

test('stripes stay behind content: each host isolates and the pattern sits at z-index -1', () => {
  const css = read('src/persora-theme.css');
  assert.match(css, /\.workspace-main, \.admin-portal, \.admin-access-page \{ isolation: isolate; \}/);
  assert.match(css, /\.workspace-striped-pattern \{ z-index: -1!important;/);
  assert.match(css, /\.striped-pattern \{[^}]*pointer-events: none/);
});
