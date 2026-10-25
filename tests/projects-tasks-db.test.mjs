// Real Postgres migration + RPC coverage for the Project Task List. Starts from
// the legacy checklist schema, verifies source-preserving/idempotent migration,
// task permissions, task-derived field progress, notifications, comments/files,
// and service-role-only database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVaultDatabase } from './password-vault-db.mjs';

const MIGRATION = '202610260002_projects_task_list.sql';
const { db, rpc, addMember, applyThrough } = await createVaultDatabase({ stopBefore: MIGRATION });
const owner = await addMember('projects-task-owner');
const fieldAssignee = await addMember('projects-task-field-assignee');
const taskAssignee = await addMember('projects-task-task-assignee');
const creator = await addMember('projects-task-field-creator');
const projectId = crypto.randomUUID();
const fieldId = crypto.randomUUID();
const destinationFieldId = crypto.randomUUID();
const legacyCompleteId = crypto.randomUUID();
const legacyTodoId = crypto.randomUUID();
const createdAt = '2026-09-10T10:20:30.000Z';
const updatedAt = '2026-09-12T11:22:33.000Z';

await db.query(`insert into public.projects(id, owner_id, name, description, kind) values ($1,$2,'Task migration test','', 'shared')`, [projectId, owner.id]);
for (const member of [fieldAssignee, taskAssignee, creator]) {
  await db.query(`insert into public.project_members(project_id,user_id,role,can_create_fields) values ($1,$2,'editor',false)`, [projectId, member.id]);
}
await db.query(`insert into public.project_fields(id,project_id,title,description,status,progress,creator_id,creator_name,assignee_id)
  values ($1,$2,'Legacy field','Preserve this description','planning',0,$3,'Field Creator',$4),
         ($5,$2,'Destination field','', 'planning',99,$6,'Owner',$7)`, [fieldId, projectId, creator.id, fieldAssignee.id, destinationFieldId, owner.id, owner.id]);
await db.query(`insert into public.project_subtasks(id,project_id,field_id,title,completed,sort_order,assignee_id,created_by,updated_by,created_at,updated_at)
  values ($1,$2,$3,'Legacy completed item',true,20,$4,$5,$6,$7,$8),
         ($9,$2,$3,'Legacy todo item',false,40,$4,$5,$6,$7,$8)`, [legacyCompleteId, projectId, fieldId, taskAssignee.id, creator.id, owner.id, createdAt, updatedAt, legacyTodoId]);

const rejects = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code, error.message);
  return true;
});
const getField = async (id) => (await db.query('select * from public.project_fields where id = $1', [id])).rows[0];
const getTask = async (id) => (await db.query('select * from public.project_tasks where id = $1', [id])).rows[0];
const notificationRows = async (taskId) => (await db.query('select * from public.project_notifications where task_id = $1', [taskId])).rows;

test('migration preserves checklist identity and content, derives progress, and is idempotent', async () => {
  await applyThrough(MIGRATION);
  const rows = (await db.query('select * from public.project_tasks where project_id = $1 order by sort_order', [projectId])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, legacyCompleteId, 'legacy source UUID is preserved as the task ID');
  assert.equal(rows[0].field_id, fieldId);
  assert.equal(rows[0].name, 'Legacy completed item');
  assert.equal(rows[0].description, '', 'legacy checklist schema had no description column');
  assert.equal(rows[0].status, 'complete');
  assert.equal(rows[0].assignee_id, taskAssignee.id);
  assert.equal(rows[0].created_by, creator.id);
  assert.equal(rows[0].updated_by, owner.id);
  assert.equal(rows[0].sort_order, 20);
  assert.equal(new Date(rows[0].created_at).toISOString(), createdAt);
  assert.equal(new Date(rows[0].updated_at).toISOString(), updatedAt);
  assert.equal(rows[1].id, legacyTodoId);
  assert.equal(rows[1].status, 'todo');
  assert.equal(rows[1].sort_order, 40);
  assert.equal((await db.query('select count(*)::int as n from public.project_task_migration_map')).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from public.project_subtasks')).rows[0].n, 2, 'legacy rows are retained for verification');
  assert.equal((await getField(fieldId)).progress, 50);
  assert.equal((await getField(destinationFieldId)).progress, 0, 'a field with zero tasks is 0%, regardless of its old progress');

  // Reapplying the complete migration neither duplicates tasks nor deletes source data.
  await db.exec(await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8'));
  assert.equal((await db.query('select count(*)::int as n from public.project_tasks where project_id = $1', [projectId])).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from public.project_subtasks')).rows[0].n, 2);
  assert.equal((await getField(fieldId)).progress, 50);
});

test('RPC permissions separate task CRUD from task-assignee movement and require the In Review gate', async () => {
  const payload = { name: 'Write launch note', description: 'A full task description.', field_id: fieldId, status: 'todo', assignee_id: taskAssignee.id };
  const task = await rpc('persora_project_task_create', { p_user: owner.id, p_project: projectId, p_payload: payload });
  assert.equal(task.name, payload.name);
  assert.equal(task.field_id, fieldId);
  assert.equal((await getField(fieldId)).progress, 33, 'create recalculates 1 completed task out of 3');
  const assignmentNotifications = await notificationRows(task.id);
  assert.ok(assignmentNotifications.some((row) => row.recipient_id === taskAssignee.id && row.kind === 'task'), 'task assignee receives a task-targeted assignment notification');

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
  await rejects(rpc('persora_project_task_move', { p_user: taskAssignee.id, p_task: legacyCompleteId, p_status: 'in-progress' }), 'P0403');

  const paused = await rpc('persora_project_task_pause', { p_user: fieldAssignee.id, p_task: task.id, p_paused: true });
  assert.equal(paused.paused, true);
  assert.equal(paused.status, 'todo', 'pause is independent of the four Kanban statuses');
  const resumed = await rpc('persora_project_task_pause', { p_user: fieldAssignee.id, p_task: task.id, p_paused: false });
  assert.equal(resumed.status, 'todo');
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

test('field movement and deletion recompute both sides; deleted migrated rows are not resurrected', async () => {
  const createdTask = (await db.query('select * from public.project_tasks where project_id = $1 and name = $2', [projectId, 'Write launch note'])).rows[0];
  await rpc('persora_project_task_delete', { p_user: owner.id, p_task: createdTask.id });
  assert.equal((await getField(fieldId)).progress, 50, 'task deletion removes it from the denominator');

  await rpc('persora_project_task_update', { p_user: owner.id, p_task: legacyTodoId, p_payload: { field_id: destinationFieldId } });
  assert.equal((await getField(fieldId)).progress, 100, 'source field is recalculated after the move');
  assert.equal((await getField(destinationFieldId)).progress, 0, 'destination field recalculates with its new task');
  await rpc('persora_project_task_delete', { p_user: owner.id, p_task: legacyTodoId });
  assert.equal((await getField(destinationFieldId)).progress, 0, 'zero-task field returns to 0% after deletion');
  assert.equal((await db.query('select count(*)::int as n from public.project_subtasks')).rows[0].n, 2, 'source checklist rows remain intact');
  assert.equal((await db.query('select count(*)::int as n from public.project_task_migration_map')).rows[0].n, 2, 'migration tombstones remain intact');

  await db.exec(await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8'));
  assert.equal(await getTask(legacyTodoId), undefined, 'rerun does not recreate a task deleted after migration verification');
  assert.equal((await db.query('select count(*)::int as n from public.project_task_migration_map')).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from public.project_subtasks')).rows[0].n, 2);
});

test('task tables and RPCs are private to the service role', async () => {
  const table = (await db.query(`select relrowsecurity from pg_class where oid = 'public.project_tasks'::regclass`)).rows[0];
  assert.equal(table.relrowsecurity, true);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_table_privilege($1,'public.project_tasks','select') as ok`, [role])).rows[0].ok, false);
    assert.equal((await db.query(`select has_table_privilege($1,'public.project_task_comments','select') as ok`, [role])).rows[0].ok, false);
    assert.equal((await db.query(`select has_table_privilege($1,'public.project_task_attachments','select') as ok`, [role])).rows[0].ok, false);
  }
  assert.equal((await db.query(`select has_table_privilege('service_role','public.project_tasks','select') as ok`)).rows[0].ok, true);
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.persora_project_task_move(uuid,uuid,text)','execute') as ok`)).rows[0].ok, false);
});
