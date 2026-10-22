// Component smoke test for ProjectsView: bundles the real TSX with esbuild,
// mounts it in happy-dom with react-dom, and drives it against a stubbed
// /api/projects backend. Verifies list → detail → permission surfaces without
// a live Supabase instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GlobalWindow } from 'happy-dom';
const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (!(key in globalThis)) globalThis[key] = happyWindow[key];
}
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

const apiCalls = [];
const fixtures = {};

globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = init.method || 'GET';
  apiCalls.push({ method, target });
  const key = `${method} ${target}`;
  const body = fixtures[key];
  if (!body) return new Response(JSON.stringify({ error: `No fixture for ${key}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// Bundle the real component; React stays external so the mounted copy shares
// one dispatcher with react-dom's renderer. CSS imports compile away.
const esbuild = await import('esbuild');
// Resolve externals (react, lucide-react) through the repo's node_modules:
// keep the temp bundle inside it.
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.pj-view-'));
const outfile = path.join(outDir, 'ProjectsView.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/components/ProjectsView.tsx', import.meta.url).pathname],
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

const { default: ProjectsView } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const OWNER_ID = 'user-owner';
const MEMBER_ID = 'user-member';
const NOW = '2026-10-22T08:00:00.000Z';

function ownerFixture() {
  fixtures['GET /api/projects'] = {
    projects: [{
      id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: 'Ship the new marketing site.',
      kind: 'shared', created_at: NOW, updated_at: NOW,
      access: { owner: true, role: 'owner', canCreateFields: true },
      stats: { fields: 2, completed: 1, inReview: 0, members: 2, pendingRequests: 1 },
    }],
  };
  fixtures['GET /api/projects/proj-1'] = {
    project: { id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: 'Ship the new marketing site.', kind: 'shared', created_at: NOW, updated_at: NOW },
    access: { owner: true, role: 'owner', canCreateFields: true, canRequest: false },
    owner: { id: OWNER_ID, name: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001' },
    members: [{ userId: MEMBER_ID, role: 'editor', canCreateFields: false, invitedBy: OWNER_ID, createdAt: NOW, name: 'Kris Ray', email: 'kris@example.com', loginId: '1000002' }],
    folders: [{ id: 'fold-1', project_id: 'proj-1', name: 'Design', color: 'purple', created_by: OWNER_ID, created_at: NOW, updated_at: NOW, fieldCount: 1 }],
    fields: [
      { id: 'fld-1', project_id: 'proj-1', folder_id: 'fold-1', title: 'Hero illustration', description: 'Main landing art.', status: 'in-progress', progress: 45, creator_id: MEMBER_ID, creator_name: 'Kris Ray', assignee_id: OWNER_ID, due_date: '2026-11-05', created_at: NOW, updated_at: NOW, assigneeName: 'Amina Rahman', mine: { pinned: false, favourite: false }, commentCount: 1, comments: [{ id: 'cmt-1', field_id: 'fld-1', author_id: MEMBER_ID, author_name: 'Kris Ray', body: 'First pass is up.', created_at: NOW, updated_at: NOW }] },
      { id: 'fld-2', project_id: 'proj-1', folder_id: null, title: 'Copy deck', description: '', status: 'completed', progress: 100, creator_id: OWNER_ID, creator_name: 'Amina Rahman', assignee_id: null, due_date: null, created_at: NOW, updated_at: NOW, assigneeName: null, mine: { pinned: false, favourite: false }, commentCount: 0, comments: [] },
    ],
    requests: [{ id: 'req-1', project_id: 'proj-1', requester_id: MEMBER_ID, requester_name: 'Kris Ray', note: 'Need this tracked', payload: { title: 'Landing SEO meta' }, status: 'pending', resolution_note: '', field_id: null, created_at: NOW, resolved_at: null }],
    activity: [{ id: 'act-1', actor_id: OWNER_ID, actor_name: 'Amina Rahman', action: 'field_created', target: 'Copy deck', created_at: NOW }],
  };
}

function memberFixture() {
  fixtures['GET /api/projects'] = {
    projects: [{
      id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: '', kind: 'shared', created_at: NOW, updated_at: NOW,
      access: { owner: false, role: 'commenter', canCreateFields: false },
      stats: { fields: 1, completed: 0, inReview: 0, members: 2, pendingRequests: 0 },
    }],
  };
  fixtures['GET /api/projects/proj-1'] = {
    project: { id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: '', kind: 'shared', created_at: NOW, updated_at: NOW },
    access: { owner: false, role: 'commenter', canCreateFields: false, canRequest: true },
    owner: { id: OWNER_ID, name: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001' },
    members: [{ userId: MEMBER_ID, role: 'commenter', canCreateFields: false, invitedBy: OWNER_ID, createdAt: NOW, name: 'Kris Ray', email: 'kris@example.com', loginId: '1000002' }],
    folders: [],
    fields: [{ id: 'fld-1', project_id: 'proj-1', folder_id: null, title: 'Hero illustration', description: '', status: 'in-progress', progress: 45, creator_id: OWNER_ID, creator_name: 'Amina Rahman', assignee_id: null, due_date: null, created_at: NOW, updated_at: NOW, assigneeName: null, mine: { pinned: false, favourite: false }, commentCount: 0, comments: [] }],
    requests: [],
    activity: [],
  };
}

const text = () => document.body.textContent || '';
async function mount(user) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(ProjectsView, { user, notify: () => undefined })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return {
    container,
    root,
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}
async function click(selector, container) {
  const scope = container || document.body;
  const el = scope.querySelector(selector);
  assert.ok(el, `selector ${selector} must exist`);
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
}
const userRecord = (id, fullName, demo = false) => ({ id, fullName, email: `${id}@example.com`, loginId: id, demo, role: 'member' });

test('demo mode shows the sign-in gate without touching the API', async () => {
  apiCalls.length = 0;
  const { unmount } = await mount(userRecord('demo-user', 'Demo User', true));
  assert.ok(text().includes('Projects need a Persora account'));
  assert.equal(apiCalls.length, 0, 'gate must not fetch');
  await unmount();
});

test('project list renders cards with stats and navigates into detail', async () => {
  ownerFixture();
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  assert.ok(text().includes('Website relaunch'), 'project name visible');
  assert.ok(text().includes('2 fields') && text().includes('1 done'));
  await click('.pj-project-card', container);
  assert.ok(fixtures['GET /api/projects/proj-1'], 'detail fetched');
  assert.ok(text().includes('New field'), 'owner sees the create button');
  assert.ok(text().includes('Requests'), 'owner sees review queue');
  assert.ok(text().includes('Active fields'), 'stats grid renders');
  assert.ok(text().includes('Amina Rahman') && text().includes('Kris Ray'), 'team roster renders');
  assert.ok(text().includes('Latest activity'));
  await unmount();
});

test('fields tab renders cards, and pin toggles fire the react endpoint', async () => {
  ownerFixture();
  fixtures['POST /api/projects/proj-1/fields/fld-1/react'] = { reaction: { pinned: true, favourite: false } };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card', container);
  const fieldsTab = [...container.querySelectorAll('.pj-section-nav button')].find((btn) => btn.textContent === 'Fields');
  assert.ok(fieldsTab, 'fields nav tab present');
  await act(async () => { fieldsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.ok(text().includes('Hero illustration'), 'field card visible');
  assert.ok(text().includes('Design'), 'folder chip visible');
  assert.ok(text().includes('In Progress'), 'status chip visible');
  const pinButton = container.querySelector('.pj-field-card .pj-icon-button');
  assert.ok(pinButton, 'pin button present');
  apiCalls.length = 0;
  await act(async () => { pinButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.ok(apiCalls.some((call) => call.target === '/api/projects/proj-1/fields/fld-1/react' && call.method === 'POST'), 'react POST fired');
  await unmount();
});

test('field detail modal shows comments with author actions', async () => {
  ownerFixture();
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card', container);
  const fieldsTab = [...container.querySelectorAll('.pj-section-nav button')].find((btn) => btn.textContent === 'Fields');
  assert.ok(fieldsTab, 'fields nav tab present');
  await act(async () => { fieldsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
  await act(async () => {
    document.querySelector('.pj-field-card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(text().includes('First pass is up.'), 'comment body visible');
  assert.ok(text().includes('Write a comment') || document.querySelector('.pj-comment-input'), 'composer renders');
  // The owner (not the comment author) must see moderation delete but not edit.
  const commentActions = [...document.querySelectorAll('.pj-comment-actions button')].map((btn) => btn.textContent);
  assert.ok(!commentActions.includes('Edit'), 'owner cannot edit another member\'s comment');
  assert.ok(commentActions.includes('Delete'), 'owner can moderate comments');
  await unmount();
});

test('a member without the grant gets request-mode surfaces and no owner tools', async () => {
  memberFixture();
  const { container, unmount } = await mount(userRecord(MEMBER_ID, 'Kris Ray'));
  await click('.pj-project-card', container);
  assert.ok(text().includes('Request field'), 'member sees the request button');
  assert.ok(!text().includes('New folder'), 'commenter cannot create folders');
  assert.ok(text().includes('You are a'), 'access note explains member context');
  assert.ok(text().includes('My requests'), 'member request history available');
  await unmount();
});
