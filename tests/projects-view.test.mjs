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
  const updatedFields = original.fields.map((field) => field.id === 'fld-1' ? { ...field, status: 'completed', progress: 100, updated_at: '2026-10-22T09:00:00.000Z' } : field);
  fixtures['PATCH /api/projects/proj-1/fields/fld-1'] = ({ init }) => { assert.equal(JSON.parse(init.body).progress, 0, 'no checklist means 0% progress is saved'); return { field: updatedFields[0] }; };
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
  assert.ok(text().includes('Completed'), 'refetched field status is shown');
  assert.equal(document.querySelector('.pj-field-card [aria-label="Field progress"]')?.getAttribute('aria-valuenow'), '0', 'progress stays checklist-derived (empty checklist = 0%) regardless of status');
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
  for (const label of ['Information', 'Description', 'Status & progress', 'Owner & assignee', 'Dates', 'Folder', 'Members & permissions']) assert.ok(text().includes(label), `${label} section is visible`);
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

test('checklist items are completed in Edit field, saved through the API, and progress syncs to cards and the view modal', async () => {
  ownerFixture();
  let completed = false;
  const detail = fixtures['GET /api/projects/proj-1'];
  detail.fields[0].subtasks = [
    { id: 'task-1', project_id: 'proj-1', field_id: 'fld-1', title: 'Draft campaign brief', completed: false, sort_order: 10, assignee_id: OWNER_ID, created_by: OWNER_ID, created_at: NOW, updated_at: NOW, assigneeName: 'Amina Rahman', creatorName: 'Amina Rahman' },
    { id: 'task-2', project_id: 'proj-1', field_id: 'fld-1', title: 'Collect references', completed: true, sort_order: 20, assignee_id: null, created_by: OWNER_ID, created_at: NOW, updated_at: NOW, assigneeName: null, creatorName: 'Amina Rahman' },
  ];
  fixtures['GET /api/projects/proj-1'] = () => ({
    ...detail,
    fields: detail.fields.map((field) => field.id === 'fld-1' ? { ...field, subtasks: field.subtasks.map((task) => task.id === 'task-1' ? { ...task, completed } : task) } : field),
  });
  let fieldPatch = null;
  fixtures['PATCH /api/projects/proj-1/fields/fld-1'] = ({ init }) => { fieldPatch = JSON.parse(init.body); return { field: detail.fields[0] }; };
  fixtures['PATCH /api/projects/proj-1/fields/fld-1/subtasks/task-1'] = async ({ init }) => {
    assert.deepEqual(JSON.parse(init.body), { completed: true });
    completed = true;
    return { subtask: { ...detail.fields[0].subtasks[0], completed: true } };
  };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await openFieldsTab(container);
  const card = [...container.querySelectorAll('.pj-field-card')].find((entry) => entry.textContent.includes('Hero illustration'));
  assert.equal(card.querySelector('[aria-label="Field progress"]').getAttribute('aria-valuenow'), '50', 'card shows 1 of 2 = 50%');
  await press(card);
  assert.equal(document.querySelector('.pj-modal [aria-label="Field progress"]').getAttribute('aria-valuenow'), '50', 'view modal matches the card');
  assert.equal(document.querySelectorAll('.pj-modal input[type="checkbox"]').length, 0, 'view modal has no checklist editing controls');
  assert.ok(!document.querySelector('.pj-modal input[aria-label="New checklist item"]'), 'view modal cannot add checklist items');
  assert.ok(!document.querySelector('.pj-modal input[type="range"]'), 'there is no manual progress slider');
  await press(document.querySelector('.pj-detail-actions .pj-primary-button'));
  assert.ok(!document.querySelector('.pj-form input[type="range"]'), 'edit modal has no manual progress slider');
  const checkbox = document.querySelector('.pj-form input[aria-label="Complete: Draft campaign brief"]');
  assert.ok(checkbox, 'edit modal lists checklist items with completion toggles');
  await press(checkbox);
  assert.ok(document.querySelector('.pj-checklist-editor-head').textContent.includes('100%'), 'edit modal progress recalculates live');
  await press(document.querySelector('.pj-form button[type="submit"]'));
  assert.equal(fieldPatch?.progress, 100, 'field save stores the checklist-derived progress');
  assert.ok(apiCalls.some((call) => call.method === 'PATCH' && call.target === '/api/projects/proj-1/fields/fld-1/subtasks/task-1'), 'completion is saved to the authenticated project API');
  assert.ok(!document.querySelector('.pj-form'), 'the modal closes after a successful save');
  const refreshed = [...container.querySelectorAll('.pj-field-card')].find((entry) => entry.textContent.includes('Hero illustration'));
  assert.equal(refreshed.querySelector('[aria-label="Field progress"]').getAttribute('aria-valuenow'), '100', 'card progress follows the saved checklist');
  assert.ok(apiCalls.filter((call) => call.method === 'GET' && call.target === '/api/projects').length >= 2, 'project summaries are reloaded after saving');
  await unmount();
});

test('creating a field saves its checklist items, completion, and derived progress', async () => {
  ownerFixture();
  const created = { ...fixtures['GET /api/projects/proj-1'].fields[1], id: 'fld-new', title: 'Launch checklist', status: 'planning', progress: 50, subtasks: [] };
  let createdBody = null;
  const subtaskBodies = [];
  const completions = [];
  fixtures['POST /api/projects/proj-1/fields'] = ({ init }) => { createdBody = JSON.parse(init.body); return { field: created }; };
  fixtures['POST /api/projects/proj-1/fields/fld-new/subtasks'] = ({ init }) => {
    const body = JSON.parse(init.body);
    subtaskBodies.push(body);
    return { subtask: { id: `new-task-${subtaskBodies.length}`, project_id: 'proj-1', field_id: 'fld-new', title: body.title, completed: false, sort_order: subtaskBodies.length * 10, assignee_id: body.assigneeId, created_by: OWNER_ID, created_at: NOW, updated_at: NOW } };
  };
  fixtures['PATCH /api/projects/proj-1/fields/fld-new/subtasks/new-task-1'] = ({ init }) => { completions.push(JSON.parse(init.body)); return { subtask: {} }; };
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await openFieldsTab(container);
  await press([...container.querySelectorAll('.pj-topbar-actions button')].find((button) => button.textContent.includes('New field')));
  await setValue(document.querySelector('.pj-form input[placeholder="e.g. Draft homepage copy"]'), 'Launch checklist');
  const add = document.querySelector('.pj-form input[aria-label="New checklist item"]');
  await setValue(add, 'Write release notes');
  await act(async () => { add.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 5)); });
  await setValue(document.querySelector('.pj-form input[aria-label="New checklist item"]'), 'Notify team');
  await press([...document.querySelectorAll('.pj-checklist-editor-add button')].find((button) => button.textContent.includes('Add')));
  await setValue(document.querySelector('.pj-form input[aria-label="New checklist item"]'), 'Remove me');
  await press([...document.querySelectorAll('.pj-checklist-editor-add button')].find((button) => button.textContent.includes('Add')));
  assert.equal(document.querySelectorAll('.pj-checklist-editor-list > li').length, 3);
  await press(document.querySelector('.pj-form button[aria-label="Delete Remove me"]'));
  await press(document.querySelector('.pj-form input[aria-label="Complete: Write release notes"]'));
  assert.ok(document.querySelector('.pj-checklist-editor-head').textContent.includes('50%'));
  await press(document.querySelector('.pj-form button[type="submit"]'));
  assert.equal(createdBody?.progress, 50, 'create payload carries (1 ÷ 2) × 100');
  assert.deepEqual(subtaskBodies.map((body) => body.title), ['Write release notes', 'Notify team'], 'checklist items are created in order');
  assert.deepEqual(completions, [{ completed: true }], 'completed items are marked complete after creation');
  assert.ok(!apiCalls.some((call) => call.target.endsWith('/reorder')), 'no reorder call when order already matches');
  assert.ok(!document.querySelector('.pj-form'), 'the modal closes after the field and checklist save');
  await unmount();
});

test('request mode does not expose checklist management', async () => {
  memberFixture();
  const { container, unmount } = await mount(userRecord(MEMBER_ID, 'Kris Ray'));
  await click('.pj-project-card .magic-card-content', container);
  await press([...container.querySelectorAll('.pj-topbar-actions button')].find((button) => button.textContent.includes('Request field')));
  assert.ok(document.querySelector('.pj-modal[aria-label="Request a new field"]'));
  assert.ok(!document.querySelector('.pj-checklist-editor'), 'checklist is managed only when creating or editing a field');
  assert.ok(!document.querySelector('.pj-form input[type="range"]'));
  await unmount();
});

test('project notification destinations open the authorized field and target subtask', async () => {
  ownerFixture();
  const projectId = 'b72190d2-bcff-4d6c-8f10-1290ad3a23d1';
  const fieldId = 'd392e001-8646-4f04-91bc-602b9d54ea02';
  const taskId = 'ad5711b3-513d-4d43-bc54-b99f64372d17';
  const baseDetail = fixtures['GET /api/projects/proj-1'];
  const routedDetail = {
    ...baseDetail,
    project: { ...baseDetail.project, id: projectId },
    fields: baseDetail.fields.map((field, index) => index === 0 ? {
      ...field, id: fieldId, project_id: projectId,
      subtasks: [{ id: taskId, project_id: projectId, field_id: fieldId, title: 'Review final mock', completed: false, sort_order: 10, assignee_id: OWNER_ID, created_by: OWNER_ID, created_at: NOW, updated_at: NOW, assigneeName: 'Amina Rahman', creatorName: 'Amina Rahman' }],
    } : { ...field, id: '03eb4074-d9d8-4080-b2f8-b0c0d6658a8e', project_id: projectId }),
  };
  fixtures['GET /api/projects'] = { projects: [{ ...fixtures['GET /api/projects'].projects[0], id: projectId }] };
  fixtures[`GET /api/projects/${projectId}`] = routedDetail;
  const { container, unmount } = await mount(userRecord(OWNER_ID, 'Amina Rahman'));
  await act(async () => {
    window.dispatchEvent(new window.CustomEvent('persora-project-notification-navigation', { detail: { projectId, fieldId, subtaskId: taskId } }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  assert.ok(apiCalls.some((call) => call.method === 'GET' && call.target === `/api/projects/${projectId}`), 'destination fetches project through normal API authorization');
  assert.ok(document.body.textContent.includes('Hero illustration'), 'destination resolves the field title');
  assert.ok(document.body.textContent.includes('Review final mock'), 'destination opens field detail with the target subtask');
  assert.ok(document.querySelector(`#project-subtask-${taskId}`), 'the destination subtask has a stable scroll target');
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
