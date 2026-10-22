import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProjects, projectAttachmentType, sanitizeProjectSubtaskInput } from '../cloudflare/projects.js';

const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const PROJECT = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const record = (id = PROJECT) => ({
  id, owner_id: OWNER, name: 'Verified project', description: 'Database record', kind: 'personal',
  created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z',
});

function mockDatabase({ projects = [], created = null } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    calls.push({ url, method });
    if (url.pathname.endsWith('/rpc/persora_project_create')) {
      return Response.json(created || record(), { status: 200 });
    }
    if (url.pathname.endsWith('/projects') && url.searchParams.has('id')) {
      const idFilter = url.searchParams.get('id');
      const expectedId = idFilter.startsWith('eq.') ? idFilter.slice(3) : '';
      const ownerFilter = url.searchParams.get('owner_id');
      const match = projects.concat(created ? [created] : [record()]).find((project) => project.id === expectedId && (!ownerFilter || ownerFilter === `eq.${OWNER}`));
      return Response.json(match ? [match] : []);
    }
    if (url.pathname.endsWith('/projects') && url.searchParams.has('owner_id')) {
      return Response.json(projects.filter((project) => url.searchParams.get('owner_id') === `eq.${OWNER}`));
    }
    if (url.pathname.endsWith('/projects') && !url.searchParams.size) return Response.json(projects);
    if (url.pathname.endsWith('/profiles')) return Response.json([{ id: OWNER, email: 'owner@example.test', full_name: 'Owner' }]);
    return Response.json([]);
  };
  return calls;
}

const invoke = (path, method = 'GET', body) => handleProjects(new Request(`https://persora.example/api${path}`, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
}), { id: OWNER }, env, 'https://persora.example');

test('Pages /api prefix is stripped before parsing project list and detail routes', async () => {
  mockDatabase({ projects: [record()] });
  const list = await invoke('/projects');
  assert.equal(list.status, 200);
  assert.equal((await list.json()).projects[0].id, PROJECT);

  const detail = await invoke(`/projects/${PROJECT}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).project.id, PROJECT);
});

test('project creation returns the persisted database UUID and verifies owner access', async () => {
  const created = record();
  const calls = mockDatabase({ created });
  const response = await invoke('/projects', 'POST', { name: 'Verified project', description: 'Database record', kind: 'personal' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.project.id, PROJECT);
  assert.ok(calls.some(({ url }) => url.pathname.endsWith('/projects') && url.searchParams.get('id') === `eq.${PROJECT}` && url.searchParams.get('owner_id') === `eq.${OWNER}`), 'the API reads back the saved row by its real ID and owner');
});

test('subtask and attachment validators reject malformed input before storage or RPC work', () => {
  assert.deepEqual(sanitizeProjectSubtaskInput({ title: '  Ship layout  ', assigneeId: null }), { title: 'Ship layout', assignee_id: null });
  assert.deepEqual(sanitizeProjectSubtaskInput({ completed: true }, { allowPartial: true }), { completed: true });
  assert.throws(() => sanitizeProjectSubtaskInput({ title: '   ' }), /subtask/i);
  assert.throws(() => sanitizeProjectSubtaskInput({ assigneeId: 'not-a-uuid' }), /project member/i);
  assert.throws(() => sanitizeProjectSubtaskInput({}), /subtask/i);
  assert.equal(projectAttachmentType('plan.pdf', 'application/pdf').preview, true);
  assert.equal(projectAttachmentType('table.csv', 'application/vnd.ms-excel').type, 'text/csv');
  assert.throws(() => projectAttachmentType('report.pdf', 'image/png'), /content type/i);
  assert.throws(() => projectAttachmentType('script.html', 'text/html'), /PDF, image/i);
});

test('project notifications are durable API data and mark-one/all call scoped RPCs', async () => {
  const rpcCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/persora__project_overdue_notifications')) return Response.json({ ok: true });
    if (url.pathname.endsWith('/rpc/persora__project_notifications_mark_read')) {
      rpcCalls.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith('/project_notifications')) return Response.json([{
      id: 'e2a1b2c3-d4e5-4678-9a01-23456789abcd', recipient_id: OWNER, actor_name: 'Teammate',
      project_id: PROJECT, field_id: 'e2a1b2c3-d4e5-4678-9a01-23456789abce', subtask_id: null,
      kind: 'subtask', title: 'Subtask assigned to you', message: 'A project subtask was assigned.',
      created_at: '2026-10-22T10:00:00Z', read_at: null,
    }]);
    if (url.pathname.endsWith('/projects') && url.searchParams.has('owner_id')) return Response.json([{ id: PROJECT, name: 'Verified project' }]);
    if (url.pathname.endsWith('/project_members')) return Response.json([]);
    return Response.json([]);
  };
  const list = await invoke('/projects/notifications');
  assert.equal(list.status, 200);
  const [notification] = await list.json();
  assert.equal(notification.projectName, 'Verified project');
  assert.equal(notification.fieldId, 'e2a1b2c3-d4e5-4678-9a01-23456789abce');
  assert.equal(notification.readAt, undefined);
  assert.equal(Object.hasOwn(notification, 'file_key'), false, 'notification payload has no storage key');

  assert.equal((await invoke(`/projects/notifications/${notification.id}`, 'PATCH')).status, 200);
  assert.equal((await invoke('/projects/notifications', 'PATCH')).status, 200);
  assert.deepEqual(rpcCalls, [
    { p_user: OWNER, p_notification: notification.id },
    { p_user: OWNER, p_notification: null },
  ]);
});

test('notification preferences default safely and persist only the caller\'s validated choices', async () => {
  const rpcCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/project_notification_preferences')) return Response.json([]);
    if (url.pathname.endsWith('/rpc/persora__project_notification_preferences_save')) {
      const args = JSON.parse(init.body); rpcCalls.push(args);
      return Response.json({ user_id: OWNER, ...args.p_preferences });
    }
    return Response.json([]);
  };
  const loaded = await invoke('/projects/notification-preferences');
  const defaults = await loaded.json();
  assert.equal(defaults.membership, true);
  assert.equal(defaults.subtasks, true);
  assert.equal(defaults.updates, true);

  const saved = await invoke('/projects/notification-preferences', 'PATCH', { subtasks: false, comments: true });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).subtasks, false);
  assert.equal(rpcCalls[0].p_user, OWNER);
  assert.equal(rpcCalls[0].p_preferences.comments, true);
  assert.equal(rpcCalls[0].p_preferences.membership, true, 'partial update preserves other settings');
  const invalid = await invoke('/projects/notification-preferences', 'PATCH', { subtasks: 'off' });
  assert.equal(invalid.status, 400);
});

test('private attachment download refuses nonmembers before reaching object storage', async () => {
  const MEMBER = '7c3d4e5f-6071-489a-9b2c-3d4e5f607182';
  let objectReads = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects') && url.searchParams.has('id')) return Response.json([record()]);
    if (url.pathname.endsWith('/project_members')) return Response.json([]);
    return Response.json([]);
  };
  const response = await handleProjects(new Request(`https://persora.example/api/projects/${PROJECT}/fields/7c3d4e5f-6071-489a-9b2c-3d4e5f607183/attachments/7c3d4e5f-6071-489a-9b2c-3d4e5f607184/file`), { id: MEMBER }, { ...env, VAULT_FILES: { get: async () => { objectReads++; return null; } } }, 'https://persora.example');
  assert.equal(response.status, 404);
  assert.equal(objectReads, 0, 'R2 is not consulted until project membership is confirmed');
});

test('Worker rejects subtask writes for a member who is neither project owner nor field creator', async () => {
  const MEMBER = '7c3d4e5f-6071-489a-9b2c-3d4e5f607182';
  const FIELD = '7c3d4e5f-6071-489a-9b2c-3d4e5f607183';
  let mutationRpcCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects') && url.searchParams.has('id')) return Response.json([record()]);
    if (url.pathname.endsWith('/project_members')) return Response.json([{ role: 'editor', can_create_fields: true }]);
    if (url.pathname.endsWith('/project_fields')) return Response.json([{ id: FIELD, project_id: PROJECT, creator_id: OWNER, title: 'Owner-only field' }]);
    if (url.pathname.includes('/rpc/')) mutationRpcCalls++;
    return Response.json([]);
  };
  const response = await handleProjects(new Request(`https://persora.example/api/projects/${PROJECT}/fields/${FIELD}/subtasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Unauthorized task' }),
  }), { id: MEMBER }, env, 'https://persora.example');
  assert.equal(response.status, 403);
  assert.equal(mutationRpcCalls, 0, 'the unauthorized request is rejected before any mutation RPC');
});
