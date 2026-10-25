import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const folders = [
  { id: 'f-a', name: 'Design', color: 'cyan' },
  { id: 'f-b', name: 'Build', color: 'orange' },
];
const mkField = (overrides = {}) => ({
  id: overrides.id || 'field', project_id: 'project', title: overrides.title || 'Field', description: '', status: 'planning', progress: 0,
  creator_id: 'creator', creator_name: 'Kris Ray', assignee_id: null, folder_id: null, due_date: null,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', ...overrides,
});
const mkTask = (overrides = {}) => ({
  id: overrides.id || 'task', project_id: 'project', field_id: 'field', name: 'Task', description: '', status: 'todo',
  assignee_id: null, paused: false, created_by: 'creator', updated_by: null, sort_order: 10,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', ...overrides,
});

test('field workflow labels remain separate from task-derived progress', () => {
  assert.equal(helpers.statusMeta('blocked').label, 'Paused');
  assert.equal(helpers.statusMeta('in-review').label, 'In Review');
  assert.equal(helpers.statusMeta('completed').label, 'Complete');
  assert.equal(helpers.progressForStatus('completed', 20), 20, 'workflow status does not force field task progress');
  assert.equal(helpers.progressForStatus('blocked', 140), 100);
  assert.equal(helpers.progressForStatus('planning', -5), 0);
  assert.equal(helpers.fieldProgress(mkField({ status: 'completed', progress: 0 })), 0);
});

test('task progress is completed linked tasks divided by all linked tasks, with zero tasks at zero percent', () => {
  assert.deepEqual(helpers.taskProgress([]), { total: 0, completed: 0, percent: 0 });
  assert.deepEqual(helpers.taskProgress(undefined), { total: 0, completed: 0, percent: 0 });
  assert.deepEqual(helpers.taskProgress([{ status: 'complete' }, { status: 'in-review' }, { status: 'todo' }]), { total: 3, completed: 1, percent: 33 });
  assert.equal(helpers.taskProgress([{ status: 'complete' }, { status: 'complete' }, { status: 'todo' }]).percent, 67);
  const tasks = [mkTask({ id: 'a', status: 'complete' }), mkTask({ id: 'b', status: 'in-progress' }), mkTask({ id: 'c', field_id: 'other', status: 'complete' })];
  assert.deepEqual(helpers.taskProgressForField(tasks, 'field'), { total: 2, completed: 1, percent: 50 });
  const fields = helpers.fieldsWithTaskProgress([mkField({ id: 'field', progress: 99 }), mkField({ id: 'empty', progress: 80 })], tasks);
  assert.deepEqual([fields[0].taskCount, fields[0].completedTaskCount, fields[0].progress], [2, 1, 50]);
  assert.deepEqual([fields[1].taskCount, fields[1].completedTaskCount, fields[1].progress], [0, 0, 0]);
});

test('task CRUD belongs only to project owner or current field assignee', () => {
  const owner = { owner: true, role: 'owner', canCreateFields: true };
  const member = { owner: false, role: 'editor', canCreateFields: true };
  const field = { assignee_id: 'field-assignee', creator_id: 'field-creator' };
  assert.equal(helpers.canManageTask(owner, field, 'owner'), true);
  assert.equal(helpers.canManageTask(member, field, 'field-assignee'), true);
  assert.equal(helpers.canManageTask(member, field, 'field-creator'), false, 'field creator alone is not task manager');
  assert.equal(helpers.canManageTask(member, field, 'task-assignee'), false, 'task assignee alone has no task CRUD rights');
  assert.equal(helpers.canManageTask(null, field, 'field-assignee'), false);
  assert.equal(helpers.canCreateTaskInField(member, field, 'field-assignee'), true);
});

test('task status permissions enforce the review gate and exact assignee move rules', () => {
  const owner = { owner: true, role: 'owner', canCreateFields: true };
  const member = { owner: false, role: 'viewer', canCreateFields: false };
  const field = { assignee_id: 'field-assignee' };
  const activeTask = { status: 'todo', assignee_id: 'task-assignee' };
  assert.equal(helpers.canMoveTask(owner, field, activeTask, 'owner', 'complete'), false, 'owner cannot bypass In Review');
  assert.equal(helpers.canMoveTask(owner, field, { ...activeTask, status: 'in-review' }, 'owner', 'complete'), true);
  assert.equal(helpers.canMoveTask(owner, field, { status: 'complete', assignee_id: null }, 'owner', 'todo'), true, 'owner can reopen completed tasks');
  assert.equal(helpers.canMoveTask(member, field, activeTask, 'field-assignee', 'complete'), false, 'field assignee also follows review gate');
  for (const next of ['todo', 'in-progress', 'in-review']) assert.equal(helpers.canMoveTask(member, field, activeTask, 'task-assignee', next), true);
  assert.equal(helpers.canMoveTask(member, field, activeTask, 'task-assignee', 'complete'), false);
  assert.equal(helpers.canMoveTask(member, field, { ...activeTask, status: 'complete' }, 'task-assignee', 'in-progress'), false, 'task assignee cannot reopen a completed task');
  assert.equal(helpers.canMoveTask(member, field, activeTask, 'creator', 'in-progress'), false, 'creator/owner/name is not a substitute for the assigned user ID');
});

test('My Tasks requires task.assignee_id to exactly match the authenticated user ID', () => {
  const tasks = [
    mkTask({ id: 'assigned', name: 'Assigned to me', assignee_id: 'me', created_by: 'other' }),
    mkTask({ id: 'creator-only', name: 'I created it', assignee_id: 'other', created_by: 'me' }),
    mkTask({ id: 'field-only', name: 'I own the field', assignee_id: 'other', field_id: 'my-field' }),
    mkTask({ id: 'unassigned', name: 'Unassigned', assignee_id: null }),
  ];
  const fields = [mkField({ id: 'field' }), mkField({ id: 'my-field', assignee_id: 'me' })];
  const all = { query: '', fieldId: 'all', assigneeId: 'all', status: 'all', paused: 'all' };
  assert.deepEqual(helpers.filterProjectTasks(tasks, fields, all, 'mine', 'me').map((task) => task.id), ['assigned']);
  assert.deepEqual(helpers.filterProjectTasks(tasks, fields, all, 'mine', '').map((task) => task.id), []);
  assert.deepEqual(helpers.filterProjectTasks(tasks, fields, { ...all, assigneeId: 'unassigned' }, 'all', 'me').map((task) => task.id), ['unassigned']);
});

test('task search and filters combine field, assignee, status, paused state, and descriptions', () => {
  const tasks = [
    mkTask({ id: 'one', name: 'Launch note', description: 'Final copy review', field_id: 'f1', assignee_id: 'u1', status: 'in-review', paused: true, sort_order: 10 }),
    mkTask({ id: 'two', name: 'Design handoff', description: 'Assets ready', field_id: 'f2', assignee_id: 'u1', status: 'todo', paused: false, sort_order: 20 }),
    mkTask({ id: 'three', name: 'Launch follow-up', field_id: 'f1', assignee_id: 'u2', status: 'complete', sort_order: 30 }),
  ];
  const fields = [mkField({ id: 'f1', title: 'Marketing' }), mkField({ id: 'f2', title: 'Design' })];
  const filter = { query: 'final copy', fieldId: 'f1', assigneeId: 'u1', status: 'in-review', paused: 'paused' };
  assert.deepEqual(helpers.filterProjectTasks(tasks, fields, filter, 'all', 'u1').map((task) => task.id), ['one']);
  assert.deepEqual(helpers.filterProjectTasks(tasks, fields, { ...filter, query: 'marketing' }, 'all', 'u1').map((task) => task.id), ['one']);
  assert.deepEqual(helpers.filterProjectTasks(tasks, fields, { ...filter, status: 'todo' }, 'all', 'u1'), []);
});

test('filterSortFields pins first, then applies sort + filters', () => {
  const fields = [
    mkField({ id: 'a', title: 'Alpha task', status: 'in-progress', progress: 20, updated_at: '2026-10-10T09:00:00Z', mine: { pinned: false, favourite: false } }),
    mkField({ id: 'b', title: 'Beta task', status: 'completed', progress: 100, updated_at: '2026-10-11T09:00:00Z', folder_id: 'f-a', mine: { pinned: true, favourite: true } }),
    mkField({ id: 'c', title: 'Gamma copy', status: 'in-progress', progress: 80, updated_at: '2026-10-12T09:00:00Z', folder_id: 'f-b', due_date: '2026-11-20' }),
  ];
  const byUpdated = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'all', sort: 'updated' });
  assert.deepEqual(byUpdated.map((field) => field.id), ['b', 'c', 'a'], 'pinned field must lead');
  const byProgress = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'all', sort: 'progress' });
  assert.deepEqual(byProgress.map((field) => field.id), ['b', 'c', 'a']);
  const inProgress = helpers.filterSortFields(fields, { query: '', status: 'in-progress', folderId: 'all', sort: 'updated' });
  assert.deepEqual(inProgress.map((field) => field.id), ['c', 'a']);
  const inFolder = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'f-a', sort: 'updated' });
  assert.deepEqual(inFolder.map((field) => field.id), ['b']);
  const search = helpers.filterSortFields(fields, { query: 'gamma', status: 'all', folderId: 'all', sort: 'updated' });
  assert.deepEqual(search.map((field) => field.id), ['c']);
  const noFolder = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'none', sort: 'updated' });
  assert.deepEqual(noFolder.map((field) => field.id), ['a']);
});

test('projectStats summarises field workflow statuses and overall field completion', () => {
  const stats = helpers.projectStats([
    mkField({ id: '1', status: 'planning' }), mkField({ id: '2', status: 'in-progress' }),
    mkField({ id: '3', status: 'in-review' }), mkField({ id: '4', status: 'completed' }),
  ], 3);
  assert.deepEqual(stats, { active: 2, inReview: 1, completed: 1, members: 3, completion: 25 });
  assert.deepEqual(helpers.projectStats([], 1), { active: 0, inReview: 0, completed: 0, members: 1, completion: 0 });
});

test('initialsFor and avatarTone stay deterministic and safe', () => {
  assert.equal(helpers.initialsFor('Kris Ray'), 'KR');
  assert.equal(helpers.initialsFor('madonna'), 'MA');
  assert.equal(helpers.initialsFor('  '), '?');
  const tones = ['cyan', 'purple', 'pink', 'blue', 'orange', 'green'];
  assert.ok(tones.includes(helpers.avatarTone('Kris Ray')));
  assert.equal(helpers.avatarTone('Ada Lovelace'), helpers.avatarTone('Ada Lovelace'));
});

test('relativeTime and formatDate degrade gracefully', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(helpers.relativeTime('2026-10-22T11:58:00Z', now), '2m ago');
  assert.equal(helpers.relativeTime('2026-10-22T10:00:00Z', now), '2h ago');
  assert.equal(helpers.relativeTime('2026-10-20T12:00:00Z', now), '2d ago');
  assert.equal(helpers.relativeTime('bad-date', now), '—');
  assert.ok(helpers.formatDate('2026-10-22').length > 3);
  assert.equal(helpers.formatDate(null), '—');
});

test('activityLabel maps task actions and cleans unknown ones', () => {
  assert.equal(helpers.activityLabel('field_status_changed'), 'moved field');
  assert.equal(helpers.activityLabel('task_status_changed'), 'moved task');
  assert.equal(helpers.activityLabel('task_comment_added'), 'commented on task');
  assert.equal(helpers.activityLabel('totally_new_action'), 'totally new action');
});

test('profileAvatar recognises photos, emojis, and DiceBear avatars and rejects anything else', () => {
  assert.deepEqual(helpers.profileAvatar('data:image/webp;base64,UklGRg=='), { kind: 'photo', src: 'data:image/webp;base64,UklGRg==' });
  assert.deepEqual(helpers.profileAvatar('emoji:🦊'), { kind: 'emoji', emoji: '🦊' });
  assert.deepEqual(helpers.profileAvatar('https://api.dicebear.com/7.x/adventurer/svg?seed=Felix'), { kind: 'image', src: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix' });
  for (const unsafe of ['', null, undefined, 'javascript:alert(1)', 'https://evil.example/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'emoji:', 'emoji:<b>']) {
    assert.deepEqual(helpers.profileAvatar(unsafe), { kind: 'initials' }, `${String(unsafe)} falls back to initials`);
  }
});
