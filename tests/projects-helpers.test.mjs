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
const mkField = (overrides) => ({
  id: overrides.id, title: overrides.title || 'Field', description: '', status: 'planning', progress: 0,
  creator_id: 'creator', creator_name: 'Kris Ray', assignee_id: null, folder_id: null, due_date: null,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', ...overrides,
});

test('progressForStatus normalises and forces completed to 100', () => {
  assert.equal(helpers.progressForStatus('completed', 20), 100);
  assert.equal(helpers.progressForStatus('blocked', 140), 100);
  assert.equal(helpers.progressForStatus('planning', -5), 0);
});

test('permission predicates mirror the server-side matrix', () => {
  const owner = { owner: true, role: 'owner', canCreateFields: true };
  const granted = { owner: false, role: 'editor', canCreateFields: true };
  const editor = { owner: false, role: 'editor', canCreateFields: false };
  const commenter = { owner: false, role: 'commenter', canCreateFields: false };
  const viewer = { owner: false, role: 'viewer', canCreateFields: false };
  const field = mkField({ id: '1', creator_id: 'member-2' });

  assert.equal(helpers.canCreateField(owner), true);
  assert.equal(helpers.canCreateField(granted), true);
  assert.equal(helpers.canCreateField(editor), false);
  assert.equal(helpers.canCreateField(commenter), false);
  assert.equal(helpers.canRequestField(commenter), true);
  assert.equal(helpers.canRequestField(granted), false);
  assert.equal(helpers.canManageMembers(viewer), false);
  assert.equal(helpers.canManageFolder(granted), false);

  assert.equal(helpers.canEditField(owner, field, 'anyone'), true);
  assert.equal(helpers.canEditField(granted, field, 'member-2'), true);
  assert.equal(helpers.canEditField(granted, field, 'member-3'), false);
  assert.equal(helpers.canEditField(viewer, field, 'member-2'), true); // creators keep editing their own field
  assert.equal(helpers.canEditComment({ author_id: 'a' }, 'a'), true);
  assert.equal(helpers.canEditComment({ author_id: 'a' }, 'b'), false);
  assert.equal(helpers.canDeleteComment(viewer, { author_id: 'a' }, 'b'), false);
  assert.equal(helpers.canDeleteComment(owner, { author_id: 'a' }, 'b'), true);
});

const checklist = (done, total) => Array.from({ length: total }, (_, index) => ({ id: `t-${index}`, title: `Task ${index}`, completed: index < done, assignee_id: null }));

test('checklistProgress derives (completed ÷ total) × 100 and is 0% when empty', () => {
  assert.deepEqual(helpers.checklistProgress([]), { total: 0, completed: 0, percent: 0 });
  assert.deepEqual(helpers.checklistProgress(undefined), { total: 0, completed: 0, percent: 0 });
  assert.equal(helpers.checklistProgress(checklist(1, 3)).percent, 33);
  assert.equal(helpers.checklistProgress(checklist(2, 3)).percent, 67);
  assert.equal(helpers.checklistProgress(checklist(4, 4)).percent, 100);
  // The stored/manual progress value and status never override the checklist.
  assert.equal(helpers.fieldProgress(mkField({ id: 'x', status: 'completed', progress: 100 })), 0);
  assert.equal(helpers.fieldProgress(mkField({ id: 'y', progress: 90, subtasks: checklist(1, 4) })), 25);
});

test('planChecklistSync diffs edited checklist rows against the saved checklist', () => {
  const saved = [
    { id: 's1', title: 'Keep', completed: false, assignee_id: null },
    { id: 's2', title: 'Rename me', completed: false, assignee_id: 'u1' },
    { id: 's3', title: 'Remove me', completed: true, assignee_id: null },
  ];
  const draft = [
    { key: 's1', id: 's1', title: 'Keep', completed: true, assigneeId: null },
    { key: 's2', id: 's2', title: '  Renamed  ', completed: false, assigneeId: null },
    { key: 'new', title: ' Brand new ', completed: true, assigneeId: 'u2' },
  ];
  const plan = helpers.planChecklistSync(saved, draft);
  assert.deepEqual(plan.remove, ['s3']);
  assert.deepEqual(plan.update, [
    { id: 's1', patch: { completed: true } },
    { id: 's2', patch: { title: 'Renamed', assigneeId: null } },
  ]);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].title, 'Brand new');
  assert.equal(plan.create[0].completed, true);
  assert.deepEqual(helpers.planChecklistSync(saved, helpers.checklistDraftFrom(saved)), { create: [], update: [], remove: [] }, 'an untouched checklist needs no writes');
});

test('filterSortFields pins first, then applies sort + filters', () => {
  const fields = [
    mkField({ id: 'a', title: 'Alpha task', status: 'in-progress', progress: 20, subtasks: checklist(1, 5), updated_at: '2026-10-10T09:00:00Z', mine: { pinned: false, favourite: false } }),
    mkField({ id: 'b', title: 'Beta task', status: 'completed', progress: 100, subtasks: checklist(5, 5), updated_at: '2026-10-11T09:00:00Z', folder_id: 'f-a', mine: { pinned: true, favourite: true } }),
    mkField({ id: 'c', title: 'Gamma copy', status: 'in-progress', progress: 80, subtasks: checklist(4, 5), updated_at: '2026-10-12T09:00:00Z', folder_id: 'f-b', due_date: '2026-11-20' }),
  ];
  const byUpdated = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'all', sort: 'updated' });
  assert.deepEqual(byUpdated.map((f) => f.id), ['b', 'c', 'a'], 'pinned field must lead');
  const byProgress = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'all', sort: 'progress' });
  assert.deepEqual(byProgress.map((f) => f.id), ['b', 'c', 'a']);
  const inProgress = helpers.filterSortFields(fields, { query: '', status: 'in-progress', folderId: 'all', sort: 'updated' });
  assert.deepEqual(inProgress.map((f) => f.id), ['c', 'a']);
  const inFolder = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'f-a', sort: 'updated' });
  assert.deepEqual(inFolder.map((f) => f.id), ['b']);
  const search = helpers.filterSortFields(fields, { query: 'gamma', status: 'all', folderId: 'all', sort: 'updated' });
  assert.deepEqual(search.map((f) => f.id), ['c']);
  const noFolder = helpers.filterSortFields(fields, { query: '', status: 'all', folderId: 'none', sort: 'updated' });
  assert.deepEqual(noFolder.map((f) => f.id), ['a'], 'only the folder-less field remains');
});

test('projectStats summarises statuses and completion', () => {
  const stats = helpers.projectStats([
    mkField({ id: '1', status: 'planning' }),
    mkField({ id: '2', status: 'in-progress' }),
    mkField({ id: '3', status: 'in-review' }),
    mkField({ id: '4', status: 'completed' }),
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

test('activityLabel maps known actions and cleans unknown ones', () => {
  assert.equal(helpers.activityLabel('field_status_changed'), 'moved field');
  assert.equal(helpers.activityLabel('member_removed'), 'removed a member');
  assert.equal(helpers.activityLabel('totally_new_action'), 'totally new action');
});
