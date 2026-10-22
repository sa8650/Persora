// Exercise the real generator UI in a DOM: opening, switching modes, and
// changing controls must remain side-effect free until Generate is clicked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

let aiResponse = { candidates: ['amber horizon', 'quiet thunder'], source: 'ai' };
const apiCalls = [];
globalThis.fetch = async (url, init = {}) => {
  apiCalls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  return Response.json(aiResponse);
};

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.password-panel-'));
const outfile = path.join(outDir, 'PasswordGeneratorPanel.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/components/PasswordGeneratorPanel.tsx', import.meta.url).pathname],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'lucide-react'],
  jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' },
  logLevel: 'silent',
});
const { default: PasswordGeneratorPanel } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(PasswordGeneratorPanel, {
    entries: [], notify: () => {}, onClose: () => {}, onSaveAsNew: () => {}, onSaveToExisting: () => {},
  })); await sleep(); });
  return {
    container,
    async click(selector) {
      const element = document.body.querySelector(selector);
      assert.ok(element, `missing element ${selector}`);
      await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
    },
    async unmount() { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

function findTab(container, label) {
  return [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.includes(label));
}

test('generator only makes an AI request after explicit Generate; tab and settings changes do not generate', async () => {
  apiCalls.length = 0;
  aiResponse = { candidates: ['amber horizon', 'quiet thunder'], source: 'ai' };
  const view = await mount();
  assert.equal(apiCalls.length, 0, 'opening the generator is idle');

  const aiTab = findTab(document.body, 'AI');
  assert.ok(aiTab);
  await act(async () => { aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  assert.equal(apiCalls.length, 0, 'selecting AI does not generate');

  const randomTab = findTab(document.body, 'Random');
  await act(async () => { randomTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  assert.equal(apiCalls.length, 0, 'switching generator modes does not generate');
  await view.click('.editor-form-footer .editor-actions .quiet-button');
  assert.equal(apiCalls.length, 0, 'manual random generation stays local');
  assert.notEqual(document.body.querySelector('.pm-gen-value')?.textContent, 'Generating…');

  await act(async () => { findTab(document.body, 'AI').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  const style = document.body.querySelector('#pm-gen-ai-style');
  style.value = 'poetic';
  await act(async () => { style.dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(); });
  assert.equal(apiCalls.length, 0, 'editing AI settings does not generate');
  await act(async () => { findTab(document.body, 'Random').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  await act(async () => { findTab(document.body, 'AI').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  assert.equal(document.body.querySelector('#pm-gen-ai-style').value, 'poetic', 'AI settings survive mode switches');
  assert.equal(apiCalls.length, 0, 'switching back to AI remains idle');

  await view.click('.editor-form-footer .editor-actions .quiet-button');
  assert.equal(apiCalls.length, 1, 'explicit Generate sends one request');
  assert.equal(apiCalls[0].url, '/api/ai/password-suggestions');
  assert.equal(apiCalls[0].body.style, 'poetic');
  assert.match(document.body.textContent, /Suggested by Persora AI/);
  await view.unmount();
});

test('AI failure uses local generation and presents the actual failure reason', async () => {
  apiCalls.length = 0;
  aiResponse = { candidates: [], source: 'offline', reason: 'unavailable', error: 'Cloudflare Workers AI completed but returned no usable suggestions.' };
  const view = await mount();
  const aiTab = findTab(document.body, 'AI');
  await act(async () => { aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  assert.equal(apiCalls.length, 0, 'opening AI remains idle even before failure testing');
  await view.click('.editor-form-footer .editor-actions .quiet-button');
  assert.equal(apiCalls.length, 1);
  assert.match(document.body.textContent, /AI suggestions were unavailable/);
  assert.match(document.body.textContent, /Cloudflare Workers AI completed but returned no usable suggestions/);
  assert.match(document.body.textContent, /generated locally with the same settings/i);
  assert.ok(document.body.querySelector('.pm-gen-value')?.textContent.length > 0, 'local fallback is available');
  await view.unmount();
});
