// Real Postgres coverage for standalone supabase/schema.sql on Projects & Task List:
// verifies retired checklist/subtask objects are absent, schema.sql is idempotent,
// project options (category/tags/dates/priority/pause/archive), task priority,
// paused-task & paused-field movement locks, task-derived field progress,
// notifications, comments/files, and service-role-only database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVaultDatabase } from './password-vault-db.mjs';

const { db, rpc, addMember } = await createVaultDatabase();
const owner = await addMember('projects-task-owner');
const fieldAssignee = await addMember('projects-task-field-assignee');
const taskAssignee = await addMember('projects-task-task-assignee');
const creator = await addMember('projects-task-field-creator');

const createdProject = await rpc('persora_project_create', {
  p_user: owner.id,
  p_name: 'Standalone workspace launch',
  p_description: 'Clean fresh-DB project',
  p_kind: 'shared',
  p_options: {
    category: 'Product Engineering',
    tags: ['Q4', 'Kanban', 'Q4'],
    start_date: '2026-10-01',
    due_date: '2026-12-15',
    priority: 'high',
    paused: false,
    archived: false,
  },
});
const projectId = createdProject.id;
const fieldId = crypto.randomUUID();
const destinationFieldId = crypto.randomUUID();
const seedCompleteId = crypto.randomUUID();
const seedTodoId = crypto.randomUUID();

for (const member of [fieldAssignee, taskAssignee, creator]) {
  await db.query(`insert into public.project_members(project_id,user_id,role,can_create_fields) values ($1,$2,'editor',false)`, [projectId, member.id]);
}
await db.query(`insert into public.project_fields(id,project_id,title,description,status,progress,creator_id,creator_name,assignee_id)
  values ($1,$2,'Core field','Preserve this description','planning',0,$3,'Field Creator',$4),
         ($5,$2,'Destination field','', 'planning',0,$6,'Owner',$7)`, [fieldId, projectId, creator.id, fieldAssignee.id, destinationFieldId, owner.id, owner.id]);
await db.query(`insert into public.project_tasks(id,project_id,field_id,name,description,status,priority,sort_order,assignee_id,created_by,updated_by)
  values ($1,$2,$3,'Seed completed item','', 'complete','high',20,$4,$5,$6),
         ($7,$2,$3,'Seed todo item','', 'todo','normal',40,$4,$5,$6)`, [seedCompleteId, projectId, fieldId, taskAssignee.id, creator.id, owner.id, seedTodoId]);

const rejects = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code, error.message);
  return true;
});
const getField = async (id) => (await db.query('select * from public.project_fields where id = $1', [id])).rows[0];
const getTask = async (id) => (await db.query('select * from public.project_tasks where id = $1', [id])).rows[0];
const notificationRows = async (taskId) => (await db.query('select * from public.project_notifications where task_id = $1', [taskId])).rows;

test('standalone schema omits retired subtask artifacts, persists project options, derives progress, and reruns cleanly', async () => {
  const retiredTables = (await db.query(`
    select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and relname in ('project_subtasks', 'project_task_migration_map')
  `)).rows;
  assert.equal(retiredTables.length, 0, 'retired checklist tables are absent from fresh schema');
  const retiredFns = (await db.query(`
    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like '%subtask%'
  `)).rows;
  assert.equal(retiredFns.length, 0, 'retired subtask RPCs and triggers are absent');
  const notifCols = (await db.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'project_notifications'
  `)).rows.map((r) => r.column_name);
  assert.ok(!notifCols.includes('subtask_id'), 'project_notifications has no legacy subtask_id column');

  assert.equal(createdProject.category, 'Product Engineering');
  assert.deepEqual(createdProject.tags, ['Q4', 'Kanban']);
  assert.equal(createdProject.start_date, '2026-10-01');
  assert.equal(createdProject.due_date, '2026-12-15');
  assert.equal(createdProject.priority, 'high');
  assert.equal(createdProject.paused, false);
  assert.equal(createdProject.archived, false);

  await rejects(rpc('persora_project_update', {
    p_user: owner.id, p_project: projectId, p_name: createdProject.name, p_description: createdProject.description, p_kind: 'shared',
    p_options: { start_date: '2026-12-20', due_date: '2026-12-01' },
  }), 'P0400');

  const updatedProject = await rpc('persora_project_update', {
    p_user: owner.id, p_project: projectId, p_name: createdProject.name, p_description: createdProject.description, p_kind: 'shared',
    p_options: { priority: 'medium', paused: true, archived: true, tags: ['Release', 'Design'] },
  });
  assert.equal(updatedProject.priority, 'medium');
  assert.equal(updatedProject.paused, true);
  assert.equal(updatedProject.archived, true);
  assert.deepEqual(updatedProject.tags, ['Release', 'Design']);
  await rpc('persora_project_update', {
    p_user: owner.id, p_project: projectId, p_name: createdProject.name, p_description: createdProject.description, p_kind: 'shared',
    p_options: { paused: false, archived: false },
  });

  assert.equal((await getField(fieldId)).progress, 50);
  assert.equal((await getField(destinationFieldId)).progress, 0);

  await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query('select count(*)::int as n from public.project_tasks where project_id = $1', [projectId])).rows[0].n, 2);
  assert.equal((await getField(fieldId)).progress, 50);
});

test('RPC permissions, task priority, paused-task locks, and paused-field locks enforce status rules', async () => {
  const payload = { name: 'Write launch note', description: 'A full task description.', field_id: fieldId, status: 'todo', priority: 'high', assignee_id: taskAssignee.id };
  const task = await rpc('persora_project_task_create', { p_user: owner.id, p_project: projectId, p_payload: payload });
  assert.equal(task.name, payload.name);
  assert.equal(task.priority, 'high');
  assert.equal(task.field_id, fieldId);
  assert.equal((await getField(fieldId)).progress, 33, 'create recalculates 1 completed task out of 3');
  const assignmentNotifications = await notificationRows(task.id);
  assert.ok(assignmentNotifications.some((row) => row.recipient_id === taskAssignee.id && row.kind === 'task'), 'task assignee receives a task-targeted assignment notification');

  const updatedPriority = await rpc('persora_project_task_update', { p_user: fieldAssignee.id, p_task: task.id, p_payload: { priority: 'low' } });
  assert.equal(updatedPriority.priority, 'low');
  await rejects(rpc('persora_project_task_update', { p_user: fieldAssignee.id, p_task: task.id, p_payload: { priority: 'urgent' } }), 'P0400');

  await rejects(rpc('persora_project_task_update', { p_user: taskAssignee.id, p_task: task.id, p_payload: { name: 'Rename denied' } }), 'P0403');
  await rejects(rpc('persora_project_task_pause', { p_user: taskAssignee.id, p_task: task.id, p_paused: true }), 'P0403');
  await rejects(rpc('persora_project_task_delete', { p_user: taskAssignee.id, p_task: task.id }), 'P0403');
  await rejects(rpc('persora_project_task_move', { p_user: owner.id, p_task: task.id, p_status: 'complete' }), 'P0409');

  const inReview = await rpc('persora_project_task_move', { p_user: taskAssignee.id, p_task: task.id, p_status: 'in-review' });
  assert.equal(inReview.status, 'in-review', 'task assignee can move active tasks among the first three statuses');
  await rejects(rpc('persora_project_task_move', { p_user: taskAssignee.id, p_task: task.id, p_status: 'complete' }), 'P0403');
  const complete = await rpc('persora_project_task_move', { p_user: fieldAssignee.id, p_task: task.id, p_status: 'complete' });
  assert.equal(complete.status, 'complete', 'field assignee can complete a task after review');
  assert.equal((await getField(fieldId)).progress, 67, '2 of 3 linked tasks are complete');
  const reopened = await rpc('persora_project_task_move', { p_user: owner.id, p_task: task.id, p_status: 'todo' });
  assert.equal(reopened.status, 'todo', 'manager can reopen completed tasks');
  assert.equal((await getField(fieldId)).progress, 33, 'progress is recalculated after reopening');
  await rejects(rpc('persora_project_task_move', { p_user: taskAssignee.id, p_task: seedCompleteId, p_status: 'in-progress' }), 'P0403');

  // Paused task cannot move to another column via move, position, or update
  const paused = await rpc('persora_project_task_pause', { p_user: fieldAssignee.id, p_task: task.id, p_paused: true });
  assert.equal(paused.paused, true);
  assert.equal(paused.status, 'todo');
  await rejects(rpc('persora_project_task_move', { p_user: owner.id, p_task: task.id, p_status: 'in-progress' }), 'P0409');
  await rejects(rpc('persora_project_task_position', { p_user: owner.id, p_task: task.id, p_status: 'in-progress', p_sort_order: 15 }), 'P0409');
  await rejects(rpc('persora_project_task_update', { p_user: owner.id, p_task: task.id, p_payload: { status: 'in-progress' } }), 'P0409');
  const reorderedWhilePaused = await rpc('persora_project_task_position', { p_user: owner.id, p_task: task.id, p_status: 'todo', p_sort_order: 5 });
  assert.equal(reorderedWhilePaused.sort_order, 5, 'same-column sort order remains adjustable');

  const resumed = await rpc('persora_project_task_pause', { p_user: fieldAssignee.id, p_task: task.id, p_paused: false });
  assert.equal(resumed.paused, false);

  // Paused field ('blocked') locks linked tasks from moving to another column until resumed
  await rpc('persora_project_field_update', { p_user: owner.id, p_field: fieldId, p_payload: { status: 'blocked' } });
  await rejects(rpc('persora_project_task_move', { p_user: owner.id, p_task: task.id, p_status: 'in-progress' }), 'P0409');
  await rejects(rpc('persora_project_task_position', { p_user: taskAssignee.id, p_task: task.id, p_status: 'in-progress', p_sort_order: 20 }), 'P0409');
  await rejects(rpc('persora_project_task_update', { p_user: owner.id, p_task: task.id, p_payload: { status: 'in-progress' } }), 'P0409');
  await rpc('persora_project_field_update', { p_user: owner.id, p_field: fieldId, p_payload: { status: 'in-progress' } });
  const movedAfterFieldResumed = await rpc('persora_project_task_move', { p_user: taskAssignee.id, p_task: task.id, p_status: 'in-progress' });
  assert.equal(movedAfterFieldResumed.status, 'in-progress');
  await rpc('persora_project_task_move', { p_user: taskAssignee.id, p_task: task.id, p_status: 'todo' });
});

test('comments and private task attachments stay scoped to project members and task managers', async () => {
  const task = (await db.query('select * from public.project_tasks where project_id = $1 and name = $2', [projectId, 'Write launch note'])).rows[0];
  const comment = await rpc('persora_project_task_comment_add', { p_user: taskAssignee.id, p_task: task.id, p_body: 'A task assignee may comment.' });
  assert.equal(comment.task_id, task.id);
  assert.equal(comment.project_id, projectId);
  assert.equal(comment.author_id, taskAssignee.id);
  await rejects(rpc('persora_project_task_comment_update', { p_user: fieldAssignee.id, p_comment: comment.id, p_body: 'Not the author' }), 'P0403');
  const edited = await rpc('persora_project_task_comment_update', { p_user: taskAssignee.id, p_comment: comment.id, p_body: 'Edited by the author.' });
  assert.equal(edited.body, 'Edited by the author.');

  await rejects(rpc('persora_project_task_attachment_add', { p_user: taskAssignee.id, p_task: task.id, p_file_key: `${owner.id}/projects/${projectId}/tasks/${task.id}/x.pdf`, p_file_name: 'x.pdf', p_file_size: 100, p_file_type: 'application/pdf' }), 'P0403');
  const attachment = await rpc('persora_project_task_attachment_add', { p_user: fieldAssignee.id, p_task: task.id, p_file_key: `${owner.id}/projects/${projectId}/tasks/${task.id}/x.pdf`, p_file_name: 'x.pdf', p_file_size: 100, p_file_type: 'application/pdf' });
  assert.equal(attachment.task_id, task.id);
  assert.equal(attachment.owner_id, owner.id, 'storage belongs to the project owner');
  assert.ok((await notificationRows(task.id)).some((row) => row.kind === 'attachment'), 'private task attachment notification carries its task target');
  await rejects(rpc('persora_project_task_attachment_delete', { p_user: taskAssignee.id, p_attachment: attachment.id }), 'P0403');
  await rpc('persora_project_task_attachment_delete', { p_user: fieldAssignee.id, p_attachment: attachment.id });
  assert.equal((await db.query('select count(*)::int as n from public.project_attachment_cleanup where file_key = $1', [attachment.file_key])).rows[0].n, 1, 'deletion queues private object cleanup');
  assert.ok((await notificationRows(task.id)).some((row) => row.kind === 'comment'), 'task comment notification carries the same task target');
});

test('field movement and deletion recompute progress on both fields cleanly', async () => {
  const createdTask = (await db.query('select * from public.project_tasks where project_id = $1 and name = $2', [projectId, 'Write launch note'])).rows[0];
  await rpc('persora_project_task_delete', { p_user: owner.id, p_task: createdTask.id });
  assert.equal((await getField(fieldId)).progress, 50, 'task deletion removes it from the denominator');

  await rpc('persora_project_task_update', { p_user: owner.id, p_task: seedTodoId, p_payload: { field_id: destinationFieldId } });
  assert.equal((await getField(fieldId)).progress, 100, 'source field is recalculated after the move');
  assert.equal((await getField(destinationFieldId)).progress, 0, 'destination field recalculates with its new task');
  await rpc('persora_project_task_delete', { p_user: owner.id, p_task: seedTodoId });
  assert.equal((await getField(destinationFieldId)).progress, 0, 'zero-task field returns to 0% after deletion');
  assert.equal(await getTask(seedTodoId), undefined);
});

test('task tables and RPCs are private to the service role', async () => {
  const table = (await db.query(`select relrowsecurity from pg_class where oid = 'public.project_tasks'::regclass`)).rows[0];
  assert.equal(table.relrowsecurity, true);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_table_privilege($1,'public.project_tasks','select') as ok`, [role])).rows[0].ok, false);
    assert.equal((await db.query(`select has_table_privilege($1,'public.project_task_comments','select') as ok`, [role])).rows[0].ok, false);
    assert.equal((await db.query(`select has_table_privilege($1,'public.project_task_attachments','select') as ok`, [role])).rows[0].ok, false);
    assert.equal((await db.query(`select has_function_privilege($1,'public.persora_project_create(uuid,text,text,text,jsonb)','execute') as ok`, [role])).rows[0].ok, false);
    assert.equal((await db.query(`select has_function_privilege($1,'public.persora_project_update(uuid,uuid,text,text,text,jsonb)','execute') as ok`, [role])).rows[0].ok, false);
  }
  assert.equal((await db.query(`select has_table_privilege('service_role','public.project_tasks','select') as ok`)).rows[0].ok, true);
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.persora_project_task_move(uuid,uuid,text)','execute') as ok`)).rows[0].ok, false);
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.persora_project_task_position(uuid,uuid,text,integer)','execute') as ok`)).rows[0].ok, false);
  assert.equal((await db.query(`select has_function_privilege('service_role','public.persora_project_task_position(uuid,uuid,text,integer)','execute') as ok`)).rows[0].ok, true);
});

test('persora_project_task_position persists intra-column and cross-column ordering while enforcing status gates', async () => {
  const first = await rpc('persora_project_task_create', {
    p_user: owner.id, p_project: projectId,
    p_payload: { name: 'Card A', description: '', field_id: fieldId, assignee_id: taskAssignee.id, status: 'todo', priority: 'medium' },
  });
  const second = await rpc('persora_project_task_create', {
    p_user: owner.id, p_project: projectId,
    p_payload: { name: 'Card B', description: '', field_id: fieldId, assignee_id: taskAssignee.id, status: 'todo' },
  });
  assert.equal(first.priority, 'medium');
  assert.equal(second.priority, 'normal');
  const movedBeforeZero = await rpc('persora_project_task_position', {
    p_user: taskAssignee.id, p_task: second.id, p_status: 'todo', p_sort_order: -50,
  });
  assert.equal(movedBeforeZero.sort_order, -50, 'task assignee can reorder their active task before sort_order 0');
  await rejects(
    rpc('persora_project_task_position', { p_user: owner.id, p_task: first.id, p_status: 'complete', p_sort_order: 10 }),
    'P0409',
  );
  await rpc('persora_project_task_position', { p_user: taskAssignee.id, p_task: first.id, p_status: 'in-review', p_sort_order: 25 });
  await rejects(
    rpc('persora_project_task_position', { p_user: taskAssignee.id, p_task: first.id, p_status: 'complete', p_sort_order: 10 }),
    'P0403',
  );
  const completed = await rpc('persora_project_task_position', { p_user: fieldAssignee.id, p_task: first.id, p_status: 'complete', p_sort_order: 5 });
  assert.equal(completed.status, 'complete');
  assert.equal(completed.sort_order, 5);
});
