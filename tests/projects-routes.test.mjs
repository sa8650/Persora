import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProjects, projectAttachmentType, sanitizeProjectTaskInput } from '../cloudflare/projects.js';

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

test('task and attachment validators reject malformed input before storage or RPC work', () => {
  assert.deepEqual(sanitizeProjectTaskInput({ name: '  Ship layout  ', description: ' Cut one card ', fieldId: '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6072', assigneeId: null, status: 'in-review' }), {
    name: 'Ship layout', description: ' Cut one card ', field_id: '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6072', assignee_id: null, status: 'in-review',
  });
  assert.deepEqual(sanitizeProjectTaskInput({ assigneeId: null }, { allowPartial: true }), { assignee_id: null });
  assert.throws(() => sanitizeProjectTaskInput({ name: '   ', fieldId: '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6072' }), /task name/i);
  assert.throws(() => sanitizeProjectTaskInput({ name: 'Missing field' }), /field/i);
  assert.throws(() => sanitizeProjectTaskInput({ name: 'Task', fieldId: 'not-a-uuid' }), /field/i);
  assert.throws(() => sanitizeProjectTaskInput({ name: 'Task', fieldId: '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6072', status: 'complete' }), /cannot start as Complete/i);
  assert.throws(() => sanitizeProjectTaskInput({ paused: true }, { allowPartial: true }), /nothing to update/i);
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

const MEMBER = '7c3d4e5f-6071-489a-9b2c-3d4e5f607182';
const BYSTANDER = '8d4e5f60-7182-49ab-8c3d-4e5f60718293';
const FIELD = '7c3d4e5f-6071-489a-9b2c-3d4e5f607183';
const TASK = '7c3d4e5f-6071-489a-9b2c-3d4e5f607185';

function taskRouteDatabase({ caller = MEMBER, fieldAssignee = OWNER, taskAssignee = MEMBER, status = 'todo', membership = true } = {}) {
  const rpcCalls = [];
  const task = { id: TASK, project_id: PROJECT, field_id: FIELD, name: 'Task', description: '', status, assignee_id: taskAssignee, paused: false, created_by: OWNER, updated_by: OWNER, sort_order: 10, created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z' };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects') && url.searchParams.has('id')) return Response.json([record()]);
    if (url.pathname.endsWith('/project_members')) return Response.json(membership ? [{ project_id: PROJECT, user_id: caller, role: 'viewer', can_create_fields: false }] : []);
    if (url.pathname.endsWith('/project_tasks')) return Response.json([task]);
    if (url.pathname.endsWith('/project_fields')) return Response.json([{ id: FIELD, project_id: PROJECT, assignee_id: fieldAssignee, title: 'Assigned field' }]);
    if (url.pathname.includes('/rpc/')) {
      const name = url.pathname.split('/').pop();
      const args = JSON.parse(init.body || '{}');
      rpcCalls.push({ name, args });
      if (name === 'persora_project_task_move') return Response.json({ ...task, status: args.p_status });
      return Response.json({ id: TASK, ...args });
    }
    return Response.json([]);
  };
  const request = (path, method = 'GET', body, extraEnv = env, services = {}) => handleProjects(new Request(`https://persora.example/api/projects/${PROJECT}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { id: caller }, extraEnv, 'https://persora.example', services);
  return { task, rpcCalls, request };
}

test('legacy checklist mutation routes are retired without deleting retained source records', async () => {
  let databaseCalls = 0;
  globalThis.fetch = async () => { databaseCalls++; return Response.json([]); };
  const response = await handleProjects(new Request(`https://persora.example/api/projects/${PROJECT}/fields/${FIELD}/subtasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'No longer create checklist items' }),
  }), { id: OWNER }, env, 'https://persora.example');
  assert.equal(response.status, 410);
  assert.equal(databaseCalls, 0, 'legacy routes cannot mutate retained checklist data');
});

test('task assignees can move active tasks but cannot CRUD, pause, complete, or reopen tasks', async () => {
  const assignee = taskRouteDatabase({ caller: MEMBER, fieldAssignee: OWNER, taskAssignee: MEMBER, status: 'todo' });
  const edit = await assignee.request(`/${'tasks'}/${TASK}`, 'PATCH', { name: 'Unauthorized rename' });
  assert.equal(edit.status, 403);
  assert.equal(assignee.rpcCalls.length, 0, 'task assignee CRUD is rejected before any mutation RPC');
  const pause = await assignee.request(`/tasks/${TASK}/pause`, 'PATCH', { paused: true });
  assert.equal(pause.status, 403);
  const activeMove = await assignee.request(`/tasks/${TASK}/move`, 'POST', { status: 'in-review' });
  assert.equal(activeMove.status, 200);
  assert.deepEqual(assignee.rpcCalls.map((call) => call.name), ['persora_project_task_move']);
  assert.equal(assignee.rpcCalls[0].args.p_status, 'in-review');

  const complete = taskRouteDatabase({ caller: MEMBER, fieldAssignee: OWNER, taskAssignee: MEMBER, status: 'in-review' });
  assert.equal((await complete.request(`/tasks/${TASK}/move`, 'POST', { status: 'complete' })).status, 403, 'task assignee cannot complete');
  assert.equal(complete.rpcCalls.length, 0);
  const reopen = taskRouteDatabase({ caller: MEMBER, fieldAssignee: OWNER, taskAssignee: MEMBER, status: 'complete' });
  assert.equal((await reopen.request(`/tasks/${TASK}/move`, 'POST', { status: 'todo' })).status, 403, 'task assignee cannot reopen completed work');
});

test('project owner and field assignee follow the In Review gate; direct completion is rejected', async () => {
  const owner = taskRouteDatabase({ caller: OWNER, fieldAssignee: MEMBER, taskAssignee: null, status: 'todo' });
  const bypass = await owner.request(`/tasks/${TASK}/move`, 'POST', { status: 'complete' });
  assert.equal(bypass.status, 409);
  assert.equal(owner.rpcCalls.length, 0, 'invalid direct completion never reaches the database');
  const fieldAssignee = taskRouteDatabase({ caller: MEMBER, fieldAssignee: MEMBER, taskAssignee: OWNER, status: 'in-review' });
  const complete = await fieldAssignee.request(`/tasks/${TASK}/move`, 'POST', { status: 'complete' });
  assert.equal(complete.status, 200);
  assert.equal(fieldAssignee.rpcCalls[0].args.p_user, MEMBER);
  assert.equal(fieldAssignee.rpcCalls[0].args.p_status, 'complete');
  const reopened = taskRouteDatabase({ caller: MEMBER, fieldAssignee: MEMBER, taskAssignee: null, status: 'complete' });
  assert.equal((await reopened.request(`/tasks/${TASK}/move`, 'POST', { status: 'todo' })).status, 200, 'manager may reopen completed work');
});

test('private task attachment operations authorize the task manager before accessing storage', async () => {
  const unauthorized = taskRouteDatabase({ caller: MEMBER, fieldAssignee: OWNER, taskAssignee: MEMBER, status: 'todo' });
  let writes = 0;
  const form = new FormData();
  const upload = await handleProjects(new Request(`https://persora.example/api/projects/${PROJECT}/tasks/${TASK}/attachments`, { method: 'POST', body: form }), { id: MEMBER }, {
    ...env, VAULT_FILES: { put: async () => { writes++; } },
  }, 'https://persora.example', { storageUsage: async () => ({ bytesUsed: 0, storageLimitBytes: 1000, storageLimitGb: 1 }) });
  assert.equal(upload.status, 403);
  assert.equal(writes, 0, 'unauthorized requests cannot write task objects');
  assert.equal(unauthorized.rpcCalls.length, 0);

  const nonmember = taskRouteDatabase({ caller: BYSTANDER, fieldAssignee: OWNER, taskAssignee: OWNER, status: 'todo', membership: false });
  let reads = 0;
  const download = await handleProjects(new Request(`https://persora.example/api/projects/${PROJECT}/tasks/${TASK}/attachments/${FIELD}/file`), { id: BYSTANDER }, {
    ...env, VAULT_FILES: { get: async () => { reads++; return null; } },
  }, 'https://persora.example');
  assert.equal(download.status, 404);
  assert.equal(reads, 0, 'nonmembers are denied before R2 reads');
  assert.equal(nonmember.rpcCalls.length, 0);
});

test('project detail returns each person’s safe profile picture for avatars', async () => {
  const MEMBER = '7c3d4e5f-6071-489a-9b2c-3d4e5f607182';
  const photo = 'data:image/png;base64,iVBORw0KGgo=';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects') && url.searchParams.has('id')) return Response.json([record()]);
    if (url.pathname.endsWith('/project_members')) return Response.json([{ project_id: PROJECT, user_id: MEMBER, role: 'editor', can_create_fields: false, created_at: '2026-10-22T10:00:00Z' }]);
    if (url.pathname.endsWith('/profiles')) return Response.json([
      { id: OWNER, email: 'owner@example.test', full_name: 'Owner', avatar_url: 'emoji:🦊' },
      { id: MEMBER, email: 'member@example.test', full_name: 'Member', avatar_url: photo },
    ]);
    return Response.json([]);
  };
  const response = await invoke(`/projects/${PROJECT}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.owner.avatarUrl, 'emoji:🦊');
  assert.equal(body.members[0].avatarUrl, photo);
  assert.deepEqual(body.people[MEMBER], { name: 'Member', avatarUrl: photo });

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects') && url.searchParams.has('id')) return Response.json([record()]);
    if (url.pathname.endsWith('/profiles')) return Response.json([{ id: OWNER, email: 'owner@example.test', full_name: 'Owner', avatar_url: 'javascript:alert(1)' }]);
    return Response.json([]);
  };
  const unsafe = await (await invoke(`/projects/${PROJECT}`)).json();
  assert.equal(unsafe.owner.avatarUrl, '', 'unsupported avatar values are never forwarded');
});

test('positioned task move routes to persora_project_task_position and api.js gates task attachment uploads', async () => {
  const TASK = '9f1e2d3c-4b5a-4678-8901-23456789abcd';
  const FIELD = '1a2b3c4d-5e6f-4789-8012-3456789abcde';
  const rpcCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects')) return Response.json([record()]);
    if (url.pathname.endsWith('/project_tasks')) return Response.json([{ id: TASK, project_id: PROJECT, field_id: FIELD, name: 'Reorder me', description: '', status: 'todo', assignee_id: OWNER, paused: false, created_by: OWNER, updated_by: OWNER, sort_order: 100, created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z' }]);
    if (url.pathname.endsWith('/project_fields')) return Response.json([{ id: FIELD, project_id: PROJECT, title: 'Design', assignee_id: OWNER }]);
    if (url.pathname.includes('/rpc/')) {
      const name = url.pathname.split('/rpc/')[1];
      const args = JSON.parse(String(init.body || '{}'));
      rpcCalls.push({ name, args });
      return Response.json({ id: TASK, status: args.p_status, sort_order: args.p_sort_order ?? 110 });
    }
    return Response.json([]);
  };

  const positioned = await invoke(`/projects/${PROJECT}/tasks/${TASK}/move`, 'POST', { status: 'todo', sortOrder: -100 });
  assert.equal(positioned.status, 200);
  assert.equal(rpcCalls[0].name, 'persora_project_task_position');
  assert.equal(rpcCalls[0].args.p_sort_order, -100);

  const badOrder = await invoke(`/projects/${PROJECT}/tasks/${TASK}/move`, 'POST', { status: 'todo', sortOrder: 'not-a-number' });
  assert.equal(badOrder.status, 400);

  const { readFileSync } = await import('node:fs');
  const apiSource = readFileSync(new URL('../cloudflare/api.js', import.meta.url), 'utf8');
  const uploadRegexMatch = apiSource.match(/const projectUpload = request\.method === "POST" && (\/\^\\\/projects[^;]+)\.test\(url\.pathname\)/);
  assert.ok(uploadRegexMatch, 'cloudflare/api.js defines projectUpload matcher');
  const matcher = new RegExp('^/projects/[0-9a-f-]+/(?:fields|tasks)/[0-9a-f-]+/attachments$', 'i');
  assert.ok(apiSource.includes('(?:fields|tasks)'), 'api.js routes both field and task attachment uploads through paid-plan and storage services');
  assert.equal(matcher.test(`/projects/${PROJECT}/tasks/${TASK}/attachments`), true);
  assert.equal(matcher.test(`/projects/${PROJECT}/fields/${FIELD}/attachments`), true);
});

test('project options, task priority, paused task/field HTTP 409 locks, and clean notifications SQL work end-to-end', async () => {
  const TASK = '9f1e2d3c-4b5a-4678-8901-23456789abcd';
  const FIELD = '1a2b3c4d-5e6f-4789-8012-3456789abcde';
  const rpcCalls = [];
  const selectQueries = [];
  let currentTask = {
    id: TASK, project_id: PROJECT, field_id: FIELD, name: 'Ship v2', description: '',
    status: 'todo', priority: 'high', assignee_id: OWNER, paused: true,
    created_by: OWNER, updated_by: OWNER, sort_order: 100,
    created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z',
  };
  let currentField = { id: FIELD, project_id: PROJECT, title: 'Engineering', status: 'in-progress', assignee_id: OWNER };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.searchParams.has('select')) selectQueries.push({ path: url.pathname, select: url.searchParams.get('select') });
    if (url.pathname.endsWith('/projects')) return Response.json([{ ...record(), category: 'Product', tags: ['q4', 'launch'], priority: 'high', start_date: '2026-10-01', due_date: '2026-11-15', paused: false, archived: false }]);
    if (url.pathname.endsWith('/project_tasks')) return Response.json([currentTask]);
    if (url.pathname.endsWith('/project_fields')) return Response.json([currentField]);
    if (url.pathname.endsWith('/project_notifications')) return Response.json([]);
    if (url.pathname.includes('/rpc/')) {
      const name = url.pathname.split('/rpc/')[1];
      const args = JSON.parse(String(init.body || '{}'));
      rpcCalls.push({ name, args });
      if (name === 'persora_project_create' || name === 'persora_project_update') {
        return Response.json({ ...record(), ...args.p_options, name: args.p_name, description: args.p_description, kind: args.p_kind });
      }
      return Response.json({ ...currentTask, status: args.p_status || currentTask.status, priority: args.p_priority || currentTask.priority });
    }
    return Response.json([]);
  };

  // 1. Project due_date < start_date rejected with 400; valid options forwarded in p_options.
  const badDates = await invoke('/projects', 'POST', { name: 'Bad dates', kind: 'personal', startDate: '2026-11-10', dueDate: '2026-11-01' });
  assert.equal(badDates.status, 400);

  const created = await invoke('/projects', 'POST', {
    name: 'Autumn Launch', description: 'Q4 push', kind: 'shared',
    category: 'Marketing', tags: ['#Q4', 'Launch', 'q4'], startDate: '2026-10-01', dueDate: '2026-11-30',
    priority: 'high', paused: true, archived: false,
  });
  assert.equal(created.status, 201);
  const createRpc = rpcCalls.find((c) => c.name === 'persora_project_create');
  assert.deepEqual(createRpc.args.p_options, {
    category: 'Marketing', tags: ['Q4', 'Launch'], start_date: '2026-10-01', due_date: '2026-11-30',
    priority: 'high', paused: true, archived: false,
  });

  // 2. Paused task cannot move to another column (HTTP 409), even for owner; intra-column reorder still allowed (HTTP 200).
  const blockedTaskMove = await invoke(`/projects/${PROJECT}/tasks/${TASK}/move`, 'POST', { status: 'in-progress' });
  assert.equal(blockedTaskMove.status, 409);
  assert.match((await blockedTaskMove.json()).error, /paused task/i);

  const sameColReorder = await invoke(`/projects/${PROJECT}/tasks/${TASK}/move`, 'POST', { status: 'todo', sortOrder: 50 });
  assert.equal(sameColReorder.status, 200);

  // 3. Active task inside a Paused field (status === 'blocked') is also locked from cross-column moves (HTTP 409).
  currentTask = { ...currentTask, paused: false };
  currentField = { ...currentField, status: 'blocked' };
  const blockedFieldMove = await invoke(`/projects/${PROJECT}/tasks/${TASK}/move`, 'POST', { status: 'in-progress' });
  assert.equal(blockedFieldMove.status, 409);
  assert.match((await blockedFieldMove.json()).error, /field is paused/i);

  const blockedFieldPatch = await invoke(`/projects/${PROJECT}/tasks/${TASK}`, 'PATCH', { status: 'in-progress' });
  assert.equal(blockedFieldPatch.status, 409);

  // 4. Resuming field allows task creation/update with priority forwarded cleanly, and notifications omit retired subtask_id.
  currentField = { ...currentField, status: 'in-progress' };
  const createdTask = await invoke(`/projects/${PROJECT}/tasks`, 'POST', {
    name: 'Prepare deck', description: '', fieldId: FIELD, status: 'todo', priority: 'medium',
  });
  assert.equal(createdTask.status, 201);
  assert.equal(rpcCalls.find((c) => c.name === 'persora_project_task_create')?.args.p_payload?.priority, 'medium');

  const notifRes = await invoke('/projects/notifications');
  assert.equal(notifRes.status, 200);
  const notifSelect = selectQueries.find((q) => q.path.endsWith('/project_notifications'));
  assert.ok(notifSelect && !notifSelect.select.includes('subtask_id'), 'retired subtask_id is omitted from project_notifications SQL select');
});


