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
  const resolved = typeof body === 'function' ? await body({ method, target, init }) : body;
  return new Response(JSON.stringify(resolved), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
      stats: { fields: 2, completed: 1, inReview: 0, members: 2, pendingRequests: 1, tasksTotal: 2, tasksCompleted: 1 },
    }],
  };
  fixtures['GET /api/projects/proj-1'] = {
    project: { id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: 'Ship the new marketing site.', kind: 'shared', created_at: NOW, updated_at: NOW },
    access: { owner: true, role: 'owner', canCreateFields: true, canRequest: false },
    owner: { id: OWNER_ID, name: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001' },
    members: [{ userId: MEMBER_ID, role: 'editor', canCreateFields: false, invitedBy: OWNER_ID, createdAt: NOW, name: 'Kris Ray', email: 'kris@example.com', loginId: '1000002' }],
    folders: [{ id: 'fold-1', project_id: 'proj-1', name: 'Design', color: 'purple', created_by: OWNER_ID, created_at: NOW, updated_at: NOW, fieldCount: 1 }],
    fields: [
      { id: 'fld-1', project_id: 'proj-1', folder_id: 'fold-1', title: 'Hero illustration', description: 'Main landing art.', status: 'in-progress', progress: 50, creator_id: MEMBER_ID, creator_name: 'Kris Ray', assignee_id: OWNER_ID, due_date: '2026-11-05', created_at: NOW, updated_at: NOW, assigneeName: 'Amina Rahman', mine: { pinned: false, favourite: false }, commentCount: 1, taskCount: 2, completedTaskCount: 1, comments: [{ id: 'cmt-1', field_id: 'fld-1', author_id: MEMBER_ID, author_name: 'Kris Ray', body: 'First pass is up.', created_at: NOW, updated_at: NOW }] },
      { id: 'fld-2', project_id: 'proj-1', folder_id: null, title: 'Copy deck', description: '', status: 'completed', progress: 0, creator_id: OWNER_ID, creator_name: 'Amina Rahman', assignee_id: null, due_date: null, created_at: NOW, updated_at: NOW, assigneeName: null, mine: { pinned: false, favourite: false }, commentCount: 0, taskCount: 0, completedTaskCount: 0, comments: [] },
    ],
    tasks: [
      { id: 'task-1', project_id: 'proj-1', field_id: 'fld-1', name: 'Draft campaign brief', description: 'Check the product launch copy.', status: 'complete', assignee_id: OWNER_ID, paused: false, created_by: MEMBER_ID, updated_by: OWNER_ID, sort_order: 10, created_at: NOW, updated_at: NOW, assigneeName: 'Amina Rahman', creatorName: 'Kris Ray', fieldTitle: 'Hero illustration' },
      { id: 'task-2', project_id: 'proj-1', field_id: 'fld-1', name: 'Create mockups', description: '', status: 'in-progress', assignee_id: MEMBER_ID, paused: false, created_by: OWNER_ID, updated_by: OWNER_ID, sort_order: 20, created_at: NOW, updated_at: NOW, assigneeName: 'Kris Ray', creatorName: 'Amina Rahman', fieldTitle: 'Hero illustration' },
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
      stats: { fields: 1, completed: 0, inReview: 0, members: 2, pendingRequests: 0, tasksTotal: 1, tasksCompleted: 0 },
    }],
  };
  fixtures['GET /api/projects/proj-1'] = {
    project: { id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: '', kind: 'shared', created_at: NOW, updated_at: NOW },
    access: { owner: false, role: 'commenter', canCreateFields: false, canRequest: true },
    owner: { id: OWNER_ID, name: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001' },
    members: [{ userId: MEMBER_ID, role: 'commenter', canCreateFields: false, invitedBy: OWNER_ID, createdAt: NOW, name: 'Kris Ray', email: 'kris@example.com', loginId: '1000002' }],
    folders: [],
    fields: [{ id: 'fld-1', project_id: 'proj-1', folder_id: null, title: 'Hero illustration', description: '', status: 'in-progress', progress: 0, creator_id: OWNER_ID, creator_name: 'Amina Rahman', assignee_id: null, due_date: null, created_at: NOW, updated_at: NOW, assigneeName: null, mine: { pinned: false, favourite: false }, commentCount: 0, taskCount: 1, completedTaskCount: 0, comments: [] }],
    tasks: [{ id: 'task-mine', project_id: 'proj-1', field_id: 'fld-1', name: 'Write product summary', description: '', status: 'todo', assignee_id: MEMBER_ID, paused: false, created_by: OWNER_ID, updated_by: OWNER_ID, sort_order: 10, created_at: NOW, updated_at: NOW, assigneeName: 'Kris Ray', creatorName: 'Amina Rahman', fieldTitle: 'Hero illustration' }],
    requests: [],
    activity: [],
  };
}

const text = () => document.body.textContent || '';
async function mount(user, props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(ProjectsView, { user, maxUploadMb: props.maxUploadMb, notify: props.notify || (() => undefined) })); });
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
  assert.ok(container.querySelector('.pj-project-card.magic-card'), 'project cards reuse the Documents MagicCard');
  await click('.pj-project-card .magic-card-content', container);
  assert.ok(fixtures['GET /api/projects/proj-1'], 'detail fetched');
  assert.ok(text().includes('New field'), 'owner sees the create button');
  assert.ok(text().includes('Requests'), 'owner sees review queue');
  assert.ok(text().includes('Active fields'), 'stats grid renders');
  assert.equal(container.querySelectorAll('.pj-stat-icon').length, 4, 'Overview KPIs use a consistent icon treatment');
  assert.ok(text().includes('50%'), 'Overview progress is derived from field statuses');
  assert.ok(text().includes('Amina Rahman') && text().includes('Kris Ray'), 'team roster renders');
  assert.ok(text().includes('Latest activity'));
  await unmount();
});

async function openFieldsTab(container) {
  await click('.pj-project-card .magic-card-content', container);
  const fieldsTab = [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Fields');
  assert.ok(fieldsTab, 'fields nav tab present');
  await act(async () => { fieldsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function openTaskTab(container) {
  await click('.pj-project-card .magic-card-content', container);
  const taskTab = [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Task List');
  assert.ok(taskTab, 'Task List nav tab present');
  await act(async () => { taskTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function setValue(el, value, eventName = 'input') {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event(eventName, { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function press(el) {
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 30)); });
}

test('folders render in a Documents-style shelf row with field cards underneath', async () => {
  ownerFixture();
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card .magic-card-content', container);
  assert.ok(![...container.querySelectorAll('.pj-section-nav button')].some((button) => button.textContent === 'Folders'), 'there is no dedicated Folders tab');
  await act(async () => {
    [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Fields').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(container.querySelector('.pj-folder-shelf'), null, 'the old overlapping folder-card shelves are gone');
  const shelf = container.querySelector('.vault-folder-shelf .vault-folder-grid');
  assert.ok(shelf, 'folders render in the shared Documents shelf row');
  const tiles = [...shelf.querySelectorAll(':scope > .vault-folder-tile')];
  assert.deepEqual(tiles.map((tile) => tile.textContent.replace(/\s+/g, ' ').trim()), ['All fields2 fields', 'Design1 field', 'New folderCreate folder']);
  assert.ok(tiles[0].classList.contains('is-selected'), 'All fields is selected by default');
  assert.ok(tiles[1].querySelector('.vault-folder-icon.folder-color-violet'), 'purple project folders use the Documents violet folder tone');
  assert.ok(tiles[2].classList.contains('vault-folder-create-tile'), 'folder creation is the dashed shelf tile');
  assert.ok(tiles[1].querySelector('[aria-label="Design folder options"]'), 'owner manages the folder from its options menu');
  const cards = container.querySelector('.pj-field-cards');
  assert.ok(cards && !shelf.contains(cards), 'field cards render separately underneath the shelf');
  assert.equal(cards.querySelectorAll('.pj-field-card').length, 2);
  await press(tiles[1].querySelector('.vault-folder-open'));
  assert.ok(container.querySelector('.vault-folder-folder').classList.contains('is-selected'));
  assert.ok(text().includes('Hero illustration'));
  assert.ok(!text().includes('Copy deck'), 'the selected folder scopes the field cards');
  await press(container.querySelector('.vault-folder-all'));
  assert.ok(text().includes('Copy deck'), 'All fields restores every card');
  await press(container.querySelector('.vault-folder-create-tile'));
  assert.ok(document.querySelector('.pj-modal[aria-label="New folder"]'), 'the create tile opens the folder form');
  await press(document.querySelector('.pj-modal [aria-label="Close dialog"]'));
  await unmount();
});

test('fields tab renders cards, and pin toggles fire the react endpoint', async () => {
  ownerFixture();
  fixtures['POST /api/projects/proj-1/fields/fld-1/react'] = { reaction: { pinned: true, favourite: false } };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card .magic-card-content', container);
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

test('saving a field refreshes detail, the project summary, and derived Overview progress', async () => {
  ownerFixture();
  const original = fixtures['GET /api/projects/proj-1'];
  const updatedFields = original.fields.map((field) => field.id === 'fld-1' ? { ...field, status: 'completed', progress: 50, updated_at: '2026-10-22T09:00:00.000Z' } : field);
  fixtures['PATCH /api/projects/proj-1/fields/fld-1'] = ({ init }) => { assert.equal(Object.hasOwn(JSON.parse(init.body), 'progress'), false, 'field workflow edits never send a progress value'); return { field: updatedFields[0] }; };
  fixtures['GET /api/projects/proj-1'] = { ...original, fields: updatedFields };
  fixtures['GET /api/projects'] = { projects: [{ ...fixtures['GET /api/projects'].projects[0], stats: { ...fixtures['GET /api/projects'].projects[0].stats, completed: 2 } }] };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card .magic-card-content', container);
  const fieldsTab = [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Fields');
  await act(async () => { fieldsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  await click('.pj-field-card-magic .magic-card-content', container);
  await click('.pj-detail-actions .pj-primary-button', document.body);
  const status = document.querySelectorAll('.pj-form select')[1];
  status.value = 'completed';
  await act(async () => { status.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 5)); });
  await click('.pj-form .pj-primary-button', document.body);
  assert.ok(apiCalls.some((call) => call.method === 'PATCH' && call.target === '/api/projects/proj-1/fields/fld-1'), 'the field save reaches the authorized API route');
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === '/api/projects/proj-1'), 'detail is refetched after the mutation');
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === '/api/projects'), 'project summaries are refreshed after the mutation');
  const patch = apiCalls.find((call) => call.method === 'PATCH' && call.target === '/api/projects/proj-1/fields/fld-1');
  assert.ok(patch);
  assert.ok(text().includes('Complete'), 'refetched field status is shown');
  assert.equal(document.querySelector('.pj-field-card [aria-label="Field task progress"]')?.getAttribute('aria-valuenow'), '50', 'field progress remains task-derived even when workflow status is Complete');
  const overview = [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Overview');
  await act(async () => { overview.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 5)); });
  assert.ok(text().includes('100% of all fields'), 'Overview KPI progress follows the saved field data');
  await unmount();
});

test('field detail modal shows comments with author actions', async () => {
  ownerFixture();
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card .magic-card-content', container);
  const fieldsTab = [...container.querySelectorAll('.pj-section-nav button')].find((btn) => btn.textContent === 'Fields');
  assert.ok(fieldsTab, 'fields nav tab present');
  await act(async () => { fieldsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
  await act(async () => {
    document.querySelector('.pj-field-card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(text().includes('First pass is up.'), 'comment body visible');
  const sectionTitles = [...document.querySelectorAll('.pj-modal .pj-detail-section > header h3')].map((heading) => heading.textContent);
  assert.deepEqual(sectionTitles, ['Information', 'Description', 'Status & task progress', 'Private attachments'], 'field details retain information, description, task-derived progress, and private attachments without checklist UI');
  const info = [...document.querySelectorAll('.pj-modal .pj-detail-info-grid > div')].map((cell) => cell.textContent.replace(/\s+/g, ' ').trim());
  for (const label of ['Project', 'Project access', 'Comments', 'Created by', 'Assigned to', 'Due', 'Created', 'Last updated']) assert.ok(info.some((cell) => cell.startsWith(label)), `${label} lives in the Information grid`);
  assert.ok(info.some((cell) => cell.startsWith('Created by') && cell.includes('Kris Ray')), 'field creator shown in Information');
  assert.ok(info.some((cell) => cell.startsWith('Assigned to') && cell.includes('Amina Rahman')), 'assignee shown in Information');
  assert.ok(!text().includes('Members & permissions') && !text().includes('Owner & assignee'), 'removed sections do not render');
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
  await click('.pj-project-card .magic-card-content', container);
  assert.ok(text().includes('Request field'), 'member sees the request button');
  assert.ok(!text().includes('New folder'), 'commenter cannot create folders');
  assert.ok(text().includes('You are a'), 'access note explains member context');
  assert.ok(text().includes('My requests'), 'member request history available');
  await unmount();
});

test('creating a project opens its returned database UUID immediately and refresh reopens it', async () => {
  const id = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
  const project = { id, owner_id: OWNER_ID, name: 'Created from UI', description: 'Open directly', kind: 'personal', created_at: NOW, updated_at: NOW };
  fixtures['GET /api/projects'] = { projects: [] };
  fixtures['POST /api/projects'] = { project };
  fixtures[`GET /api/projects/${id}`] = {
    project,
    access: { owner: true, role: 'owner', canCreateFields: true, canRequest: false },
    owner: { id: OWNER_ID, name: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001' },
    members: [], folders: [], fields: [], requests: [], activity: [],
  };
  window.history.replaceState({}, '', '/');
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  const newProjectButton = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('New project'));
  assert.ok(newProjectButton);
  await act(async () => { newProjectButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  const nameInput = document.querySelector('.pj-modal input');
  assert.ok(nameInput);
  await act(async () => {
    nameInput.value = 'Created from UI';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  const submit = [...document.querySelectorAll('.pj-modal button[type="submit"]')].find((button) => button.textContent.includes('Create project'));
  assert.ok(submit);
  await act(async () => { submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 40)); });
  assert.ok(apiCalls.some((call) => call.method === 'POST' && call.target === '/api/projects'), 'create API called');
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === `/api/projects/${id}`), 'detail opened by returned database UUID');
  assert.ok(text().includes('Created from UI'), 'new project detail appears immediately');
  assert.equal(new URL(window.location.href).searchParams.get('project'), id, 'URL stores the actual database UUID');
  await unmount();

  apiCalls.length = 0;
  const reopened = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === `/api/projects/${id}`), 'refresh reloads authorized detail from its URL');
  assert.ok(text().includes('Created from UI'));
  await reopened.unmount();
  window.history.replaceState({}, '', '/');
});

test('project sections are ordered and the Task List uses minimal equal-column cards with combined filters', async () => {
  ownerFixture();
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card .magic-card-content', container);
  assert.deepEqual([...container.querySelectorAll('.pj-section-nav button')].map((button) => button.textContent), ['Overview', 'Fields', 'Task List', 'Activity']);
  const taskTab = [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Task List');
  await press(taskTab);
  assert.deepEqual([...container.querySelectorAll('.pj-task-column-head h3')].map((heading) => heading.textContent), ['To Do', 'In Progress', 'In Review', 'Complete']);
  const cards = [...container.querySelectorAll('.pj-task-card')];
  assert.equal(cards.length, 2, 'All Tasks shows tasks across all four statuses');
  for (const card of cards) {
    assert.equal(card.children.length, 2, 'a task card contains only its name and the three-dot menu');
    assert.ok(card.querySelector('.pj-task-title'));
    assert.ok(card.querySelector('.pj-task-actions .tiny-action'));
    assert.ok(!card.textContent.includes('Check the product launch copy'), 'descriptions are not shown on cards');
  }
  await press([...container.querySelectorAll('.pj-task-mode button')].find((button) => button.textContent === 'My Tasks'));
  assert.deepEqual([...container.querySelectorAll('.pj-task-card .pj-task-title')].map((title) => title.textContent), ['Draft campaign brief'], 'My Tasks matches only the signed-in user ID in task.assignee_id');
  await press([...container.querySelectorAll('.pj-task-mode button')].find((button) => button.textContent === 'All Tasks'));
  await setValue(container.querySelector('.pj-task-search input'), 'product launch');
  assert.deepEqual([...container.querySelectorAll('.pj-task-card .pj-task-title')].map((title) => title.textContent), ['Draft campaign brief'], 'search also inspects descriptions without displaying them');
  await setValue(container.querySelector('.pj-task-search input'), '');
  await press(container.querySelector('.pj-task-filter-button'));
  const selects = [...container.querySelectorAll('.pj-task-filter-popover select')];
  assert.equal(selects.length, 4, 'field, assignee, status, and paused filters are available together');
  await setValue(selects[2], 'in-progress', 'change');
  assert.deepEqual([...container.querySelectorAll('.pj-task-card .pj-task-title')].map((title) => title.textContent), ['Create mockups']);
  assert.ok(readFileSync(new URL('../src/components/projects.css', import.meta.url), 'utf8').includes('grid-template-columns: repeat(4,minmax(0,1fr))'), 'board columns share equal width and remain horizontally scrollable on narrow workspaces');
  await unmount();
});

test('task menu does not open Task View, while card activation opens read-focused details', async () => {
  ownerFixture();
  const task = fixtures['GET /api/projects/proj-1'].tasks[0];
  fixtures['GET /api/projects/proj-1/tasks/task-1'] = { task: { ...task, comments: [], attachments: [] } };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await openTaskTab(container);
  const card = container.querySelector('.pj-task-card[aria-label="Open task Draft campaign brief"]');
  assert.ok(card);
  await press(card.querySelector('.pj-task-actions .tiny-action'));
  assert.ok(document.querySelector('.card-action-menu-portal[role="menu"]'), 'three-dot menu opens independently');
  assert.equal(document.querySelector('.pj-task-modal[aria-label="Task details"]'), null, 'menu activation does not bubble into the Task View');
  await press(document.querySelector('.card-action-menu-portal [role="menuitem"]'));
  assert.ok(document.querySelector('.pj-task-modal[aria-label="Edit task"]'), 'menu action opens the editor directly');
  await press(document.querySelector('.pj-task-modal[aria-label="Edit task"] .pj-icon-button'));
  const refreshedCard = container.querySelector('.pj-task-card[aria-label="Open task Draft campaign brief"]');
  await press(refreshedCard);
  assert.ok(document.querySelector('.pj-task-modal[aria-label="Task details"]'), 'card activation opens Task View');
  assert.ok(document.querySelector('.pj-task-view-title')?.textContent.includes('Draft campaign brief'));
  assert.ok(document.querySelector('.pj-task-view-description')?.textContent.includes('product launch copy'));
  assert.ok(document.querySelector('.pj-task-view-info')?.textContent.includes('Amina Rahman'));
  assert.ok(!document.querySelector('.pj-task-form'), 'Task View is read-focused until Edit is selected');
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === '/api/projects/proj-1/tasks/task-1'), 'detail is fetched from the authenticated task endpoint');
  await unmount();
});

test('creating a task persists its field, assignee, description, and status through the Task List', async () => {
  ownerFixture();
  const created = { ...fixtures['GET /api/projects/proj-1'].tasks[1], id: 'task-created', name: 'Publish release notes', description: 'Share the launch summary.', status: 'todo', field_id: 'fld-1', assignee_id: null };
  let savedBody = null;
  fixtures['POST /api/projects/proj-1/tasks'] = ({ init }) => { savedBody = JSON.parse(init.body); return { task: created }; };
  fixtures['GET /api/projects/proj-1/tasks/task-created'] = { task: { ...created, comments: [], attachments: [] } };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await openTaskTab(container);
  await press(container.querySelector('.pj-task-add'));
  assert.ok(document.querySelector('.pj-task-modal[aria-label="Add task"]'));
  await setValue(document.querySelector('.pj-task-form input[placeholder^="e.g."]'), 'Publish release notes');
  await setValue(document.querySelector('.pj-task-form textarea'), 'Share the launch summary.');
  const selects = [...document.querySelectorAll('.pj-task-form select')];
  await setValue(selects[1], 'fld-1', 'change');
  await setValue(selects[2], 'in-review', 'change');
  await press(document.querySelector('.pj-task-form button[type="submit"]'));
  assert.deepEqual(savedBody, { name: 'Publish release notes', description: 'Share the launch summary.', fieldId: 'fld-1', assigneeId: null, status: 'in-review' });
  assert.ok(apiCalls.some((call) => call.method === 'POST' && call.target === '/api/projects/proj-1/tasks'), 'task create reaches the project-scoped worker route');
  assert.ok(!Object.hasOwn(savedBody, 'progress'), 'field progress is derived server-side from task status');
  assert.ok(!document.querySelector('.pj-task-form'), 'the form closes after a successful save');
  await unmount();
});

test('My Tasks excludes creator/field-owner matches and task assignees may move only active tasks', async () => {
  memberFixture();
  const detail = fixtures['GET /api/projects/proj-1'];
  const task = detail.tasks[0];
  detail.tasks.push({ ...task, id: 'created-not-assigned', name: 'Created but not assigned', assignee_id: OWNER_ID, created_by: MEMBER_ID, sort_order: 20 });
  let savedStatus = 'todo';
  fixtures['GET /api/projects/proj-1'] = () => ({ ...detail, tasks: detail.tasks.map((entry) => entry.id === 'task-mine' ? { ...entry, status: savedStatus } : entry) });
  fixtures['GET /api/projects/proj-1/tasks/task-mine'] = () => ({ task: { ...task, status: savedStatus, comments: [], attachments: [] } });
  fixtures['POST /api/projects/proj-1/tasks/task-mine/move'] = ({ init }) => {
    const body = JSON.parse(init.body); assert.deepEqual(body, { status: 'in-progress' }); savedStatus = body.status;
    return { task: { ...task, status: savedStatus } };
  };
  const { container, unmount } = await mount(userRecord(MEMBER_ID, 'Kris Ray'));
  await openTaskTab(container);
  await press([...container.querySelectorAll('.pj-task-mode button')].find((button) => button.textContent === 'My Tasks'));
  assert.deepEqual([...container.querySelectorAll('.pj-task-card .pj-task-title')].map((title) => title.textContent), ['Write product summary'], 'being the creator or field assignee does not qualify for My Tasks');
  await press(container.querySelector('.pj-task-card'));
  assert.ok(document.querySelector('.pj-task-view-move select'), 'task assignee can move a non-complete task among active statuses');
  assert.ok(![...document.querySelectorAll('.pj-task-view-actions button')].some((button) => /Edit|Pause|Delete/.test(button.textContent)), 'task assignee has no CRUD, pause, or delete privileges');
  const statusSelect = document.querySelector('.pj-task-view-move select');
  await setValue(statusSelect, 'in-progress', 'change');
  await press(document.querySelector('.pj-task-view-move button'));
  assert.equal(savedStatus, 'in-progress');
  assert.ok(apiCalls.some((call) => call.method === 'POST' && call.target === '/api/projects/proj-1/tasks/task-mine/move'), 'move is persisted through the scoped status endpoint');
  await unmount();
});

test('request mode contains no checklist UI', async () => {
  memberFixture();
  const { container, unmount } = await mount(userRecord(MEMBER_ID, 'Kris Ray'));
  await click('.pj-project-card .magic-card-content', container);
  await press([...container.querySelectorAll('.pj-topbar-actions button')].find((button) => button.textContent.includes('Request field')));
  assert.ok(document.querySelector('.pj-modal[aria-label="Request a new field"]'));
  assert.equal(document.querySelector('.pj-checklist-editor'), null);
  assert.ok(!text().includes('Checklist'));
  assert.ok(!document.querySelector('.pj-form input[type="range"]'));
  await unmount();
});

test('project task notifications open the authorized Task List and the persisted target task', async () => {
  ownerFixture();
  const projectId = 'b72190d2-bcff-4d6c-8f10-1290ad3a23d1';
  const fieldId = 'd392e001-8646-4f04-91bc-602b9d54ea02';
  const taskId = 'ad5711b3-513d-4d43-bc54-b99f64372d17';
  const baseDetail = fixtures['GET /api/projects/proj-1'];
  const routedTask = { ...baseDetail.tasks[0], id: taskId, project_id: projectId, field_id: fieldId, name: 'Review final mock', status: 'in-review', fieldTitle: 'Hero illustration' };
  const routedDetail = {
    ...baseDetail,
    project: { ...baseDetail.project, id: projectId },
    fields: baseDetail.fields.map((field, index) => index === 0
      ? { ...field, id: fieldId, project_id: projectId, taskCount: 1, completedTaskCount: 0, progress: 0 }
      : { ...field, id: '03eb4074-d9d8-4080-b2f8-b0c0d6658a8e', project_id: projectId, taskCount: 0, completedTaskCount: 0, progress: 0 }),
    tasks: [routedTask],
  };
  fixtures['GET /api/projects'] = { projects: [{ ...fixtures['GET /api/projects'].projects[0], id: projectId }] };
  fixtures[`GET /api/projects/${projectId}`] = routedDetail;
  fixtures[`GET /api/projects/${projectId}/tasks/${taskId}`] = { task: { ...routedTask, comments: [], attachments: [] } };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await act(async () => {
    window.dispatchEvent(new window.CustomEvent('persora-project-notification-navigation', { detail: { projectId, fieldId, taskId } }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === `/api/projects/${projectId}`), 'destination fetches project through normal API authorization');
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === `/api/projects/${projectId}/tasks/${taskId}`), 'notification resolves full task detail through the scoped API');
  assert.ok(container.querySelector('.pj-section-nav button.active')?.textContent === 'Task List');
  assert.ok(document.querySelector('.pj-task-modal[aria-label="Task details"]'));
  assert.ok(document.querySelector('.pj-task-view-title')?.textContent.includes('Review final mock'));
  await unmount();
});

test('project attachment client gate blocks unsupported and oversized files before upload', async () => {
  ownerFixture();
  const errors = [];
  const user = { ...userRecord(OWNER_ID, 'Amina Rahman'), uploadsEnabled: true };
  const { container, unmount } = await mount(user, { maxUploadMb: 1, notify: (message, kind) => { if (kind === 'error') errors.push(message); } });
  await click('.pj-project-card .magic-card-content', container);
  const fieldsTab = [...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Fields');
  await act(async () => { fieldsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  await click('.pj-field-card', container);
  const input = document.querySelector('.pj-attachment-upload input[type="file"]');
  assert.ok(input, 'upload control is shown only for upload-enabled accounts');
  const unsupported = new window.File(['x'], 'script.exe', { type: 'application/octet-stream' });
  Object.defineProperty(input, 'files', { configurable: true, value: [unsupported] });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  const oversized = new window.File([new Uint8Array(1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { configurable: true, value: [oversized] });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.ok(errors.some((message) => message.includes('PDF, image')), 'unsupported extension gets a clear client-side rejection');
  assert.ok(errors.some((message) => message.includes('1 MB')), 'upload limit follows the configured maximum');
  assert.equal(apiCalls.some((call) => call.method === 'POST' && call.target.endsWith('/attachments')), false, 'invalid files never reach the Worker');
  await unmount();
});

test('Notification preferences opens straight from the project list without opening a project', async () => {
  ownerFixture();
  fixtures['GET /api/projects/notification-preferences'] = { membership: true, assignments: true, requests: true, subtasks: true, comments: true, attachments: true, deadlines: true, updates: true };
  window.history.replaceState({}, '', '/');
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  apiCalls.length = 0;
  const button = [...container.querySelectorAll('.pj-list-head-actions button')].find((entry) => entry.textContent.includes('Notification preferences'));
  assert.ok(button, 'list view shows the preferences button');
  await press(button);
  assert.ok(document.querySelector('.pj-modal'), 'the preferences modal opens immediately on the list view');
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === '/api/projects/notification-preferences'), 'preferences load right away');
  assert.ok(!apiCalls.some((call) => call.target === '/api/projects/proj-1'), 'no project needs to be opened first');
  assert.ok(container.querySelector('.pj-project-grid'), 'the project list stays underneath');
  await press(document.querySelector('.pj-modal [aria-label="Close dialog"]'));
  assert.ok(!document.querySelector('.pj-modal'), 'the modal closes');
  await click('.pj-project-card .magic-card-content', container);
  assert.ok(!document.querySelector('.pj-modal'), 'opening a project afterwards does not resurrect a stale modal');
  await unmount();
  window.history.replaceState({}, '', '/');
});

test('avatars show each person’s chosen photo, emoji, or avatar and fall back to initials', async () => {
  ownerFixture();
  const photo = 'data:image/png;base64,iVBORw0KGgo=';
  const detail = fixtures['GET /api/projects/proj-1'];
  detail.owner = { ...detail.owner, avatarUrl: 'emoji:🦊' };
  detail.members = [{ ...detail.members[0], avatarUrl: photo }];
  detail.people = { [OWNER_ID]: { name: 'Amina Rahman', avatarUrl: 'emoji:🦊' }, [MEMBER_ID]: { name: 'Kris Ray', avatarUrl: photo }, 'user-left': { name: 'Old Member', avatarUrl: 'javascript:alert(1)' } };
  detail.fields[0].comments = [...detail.fields[0].comments, { id: 'cmt-2', field_id: 'fld-1', author_id: 'user-left', author_name: 'Old Member', body: 'Legacy note', created_at: NOW, updated_at: NOW }];
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await click('.pj-project-card .magic-card-content', container);
  const team = [...container.querySelectorAll('.pj-people-list li')];
  assert.equal(team[0].querySelector('.pj-avatar .pj-avatar-emoji')?.textContent, '🦊', 'owner shows their emoji');
  assert.equal(team[1].querySelector('.pj-avatar img')?.getAttribute('src'), photo, 'member shows their uploaded photo');
  await press([...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Fields'));
  const card = [...container.querySelectorAll('.pj-field-card')].find((entry) => entry.textContent.includes('Hero illustration'));
  assert.equal(card.querySelector('.pj-people-inline [title^="Created by"] img')?.getAttribute('src'), photo, 'field cards use the creator photo');
  assert.ok(card.querySelector('.pj-people-inline [title^="Assigned to"] .pj-avatar-emoji'), 'field cards use the assignee emoji');
  await press(card);
  const comments = [...document.querySelectorAll('.pj-comments li')];
  assert.ok(comments[0].querySelector('.pj-avatar img'), 'comment author photo');
  assert.equal(comments[1].querySelector('.pj-avatar').getAttribute('data-avatar'), 'initials', 'unsafe or missing pictures fall back to initials');
  assert.equal(comments[1].querySelector('.pj-avatar').textContent, 'OM');
  await unmount();
});

test('the signed-in user’s current profile picture is used even before the project reloads', async () => {
  ownerFixture();
  const { container, unmount } = await mount({ ...userRecord(OWNER_ID, 'Amina Rahman'), avatarUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix' });
  await click('.pj-project-card .magic-card-content', container);
  const ownerAvatar = container.querySelector('.pj-people-list li .pj-avatar');
  assert.equal(ownerAvatar.querySelector('img')?.getAttribute('src'), 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix');
  assert.equal(container.querySelectorAll('.pj-people-list li')[1].querySelector('.pj-avatar').textContent, 'KR', 'people without a picture keep initials');
  await unmount();
});

test('a folder filter from one project never hides another project’s fields', async () => {
  ownerFixture();
  const second = { ...fixtures['GET /api/projects'].projects[0], id: 'proj-2', name: 'Second project' };
  fixtures['GET /api/projects'] = { projects: [fixtures['GET /api/projects'].projects[0], second] };
  fixtures['GET /api/projects/proj-2'] = { ...fixtures['GET /api/projects/proj-1'], project: { ...fixtures['GET /api/projects/proj-1'].project, id: 'proj-2', name: 'Second project' }, folders: [], fields: [{ ...fixtures['GET /api/projects/proj-1'].fields[1], id: 'fld-9', project_id: 'proj-2', title: 'Second field' }] };
  window.history.replaceState({}, '', '/');
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await openFieldsTab(container);
  await press(container.querySelector('.vault-folder-folder .vault-folder-open'));
  assert.ok(!text().includes('Copy deck'), 'folder filter active in project one');
  await press(container.querySelector('.pj-crumb-back'));
  const cards = [...container.querySelectorAll('.pj-project-card .magic-card-content')];
  await press(cards[1]);
  await press([...container.querySelectorAll('.pj-section-nav button')].find((button) => button.textContent === 'Fields'));
  assert.ok(text().includes('Second field'), 'the other project shows its fields');
  assert.ok(container.querySelector('.vault-folder-all.is-selected'), 'All fields is selected again');
  await unmount();
  window.history.replaceState({}, '', '/');
});
