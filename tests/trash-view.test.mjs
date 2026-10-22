// DOM smoke coverage for the compact Magic Card Trash rows and the item-view,
// restore, and irreversible-delete confirmation flows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.trash-view-'));
const outfile = path.join(outDir, 'TrashView.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/components/TrashView.tsx', import.meta.url).pathname],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'empty' },
  alias: { '@': path.join(process.cwd(), 'src') },
  external: ['react', 'react-dom', 'lucide-react', 'motion/react', 'next-themes'],
  jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' },
  logLevel: 'silent',
});
const { default: TrashView } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const entry = {
  id: 'trash-item-1', kind: 'vault_item', title: 'Passport scan', space: 'documents', folder: 'Travel',
  eventDate: '2026-09-01', recordType: 'Passport', hasFiles: true,
  deletedAt: '2026-10-20T10:00:00.000Z', expiresAt: '2026-10-27T10:00:00.000Z',
};
const sleep = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(callbacks) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(TrashView, {
      entries: [entry], busy: false, notify: () => {}, onRefresh: async () => {},
      onRestore: callbacks.restore, onDeleteForever: callbacks.deleteForever,
      onEmptyTrash: async () => {},
    }));
    await sleep();
  });
  return {
    host,
    async click(element) { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); }); },
    async unmount() { await act(async () => root.unmount()); host.remove(); document.querySelectorAll('body > .modal-backdrop').forEach((node) => node.remove()); },
  };
}

test('Trash uses compact Magic Cards and the view modal exposes metadata plus Restore', async () => {
  let restored = 0;
  let deleted = 0;
  const view = await mount({ restore: async () => { restored += 1; }, deleteForever: async () => { deleted += 1; } });
  assert.ok(view.host.querySelector('.trash-card-shell'), 'item card uses the shared Magic Card wrapper');
  assert.ok(view.host.querySelector('.trash-row'), 'compact row is present');
  await view.click(view.host.querySelector('.trash-view-button'));
  const dialog = document.querySelector('[role="dialog"][aria-labelledby="trash-item-view-title"]');
  assert.ok(dialog, 'dedicated item view modal opens');
  assert.match(dialog.textContent, /Passport scan/);
  assert.match(dialog.textContent, /Original location/);
  assert.match(dialog.textContent, /Travel/);
  assert.match(dialog.textContent, /Deleted/);
  assert.match(dialog.textContent, /Expires/);
  assert.match(dialog.textContent, /Passport/);
  await view.click(dialog.querySelector('.trash-restore-button'));
  assert.equal(restored, 1);
  assert.equal(document.querySelector('[role="dialog"][aria-labelledby="trash-item-view-title"]'), null, 'modal closes after successful restore');
  assert.equal(deleted, 0);
  await view.unmount();
});

test('permanent deletion from Trash requires confirmation before invoking backend action', async () => {
  let deleted = 0;
  const view = await mount({ restore: async () => {}, deleteForever: async () => { deleted += 1; } });
  await view.click(view.host.querySelector('.trash-delete-button'));
  const confirm = document.querySelector('[role="alertdialog"]');
  assert.ok(confirm, 'irreversible delete confirmation opens');
  assert.match(confirm.textContent, /can't be undone/i);
  assert.equal(deleted, 0, 'backend is not called before confirmation');
  const confirmButton = [...confirm.querySelectorAll('button')].find((button) => button.textContent.includes('Delete forever'));
  assert.ok(confirmButton);
  await view.click(confirmButton);
  assert.equal(deleted, 1, 'confirmed action calls backend');
  await view.unmount();
});
