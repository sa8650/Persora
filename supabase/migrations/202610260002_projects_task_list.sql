-- Persora Projects Task List refactor (2026-10-26).
-- Tasks replace field checklist subtasks as the source of work and progress.
-- Legacy checklist rows are copied idempotently and retained for verification;
-- no old checklist data is deleted by this migration.

-- A composite FK makes it impossible to attach a task to a field in another project.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_fields_id_project_id_key'
      and conrelid = 'public.project_fields'::regclass
  ) then
    alter table public.project_fields
      add constraint project_fields_id_project_id_key unique (id, project_id);
  end if;
end;
$$;

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  field_id uuid not null,
  name text not null check (char_length(name) between 1 and 240),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'todo' check (status in ('todo', 'in-progress', 'in-review', 'complete')),
  assignee_id uuid references public.profiles(id) on delete set null,
  paused boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_tasks_field_project_fk foreign key (field_id, project_id)
    references public.project_fields(id, project_id) on delete cascade
);
create index if not exists project_tasks_project_status_order_idx on public.project_tasks(project_id, status, sort_order, created_at);
create index if not exists project_tasks_field_idx on public.project_tasks(field_id, status);
create index if not exists project_tasks_assignee_idx on public.project_tasks(project_id, assignee_id, status);
alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from anon, authenticated;
grant all on public.project_tasks to service_role;

create table if not exists public.project_task_migration_map (
  legacy_subtask_id uuid primary key,
  -- Keep the historical task ID even if a user later deletes that task. This
  -- tombstone prevents a future rerun from resurrecting the old checklist row.
  task_id uuid not null unique,
  migrated_at timestamptz not null default now()
);
alter table public.project_task_migration_map enable row level security;
revoke all on public.project_task_migration_map from anon, authenticated;
grant all on public.project_task_migration_map to service_role;

create table if not exists public.project_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_task_comments_task_idx on public.project_task_comments(task_id, created_at);
create index if not exists project_task_comments_project_idx on public.project_task_comments(project_id, created_at desc);
alter table public.project_task_comments enable row level security;
revoke all on public.project_task_comments from anon, authenticated;
grant all on public.project_task_comments to service_role;

create table if not exists public.project_task_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  field_id uuid not null,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  file_key text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 240),
  file_size bigint not null check (file_size between 1 and 157286400),
  file_type text not null check (file_type in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )),
  created_at timestamptz not null default now(),
  constraint project_task_attachments_field_project_fk foreign key (field_id, project_id)
    references public.project_fields(id, project_id) on delete cascade
);
create index if not exists project_task_attachments_task_idx on public.project_task_attachments(task_id, created_at);
create index if not exists project_task_attachments_project_idx on public.project_task_attachments(project_id, created_at desc);
alter table public.project_task_attachments enable row level security;
revoke all on public.project_task_attachments from anon, authenticated;
grant all on public.project_task_attachments to service_role;

-- Explicitly retain the source checklist ID -> task ID relationship. The source
-- rows remain untouched until an operator verifies the migrated counts/content.
insert into public.project_tasks (
  id, project_id, field_id, name, description, status, assignee_id, paused,
  created_by, updated_by, sort_order, created_at, updated_at
)
select
  s.id, f.project_id, f.id, s.title, '',
  case when s.completed then 'complete' else 'todo' end,
  s.assignee_id, false, s.created_by, s.updated_by, s.sort_order, s.created_at, s.updated_at
from public.project_subtasks s
join public.project_fields f on f.id = s.field_id
where not exists (
  select 1 from public.project_task_migration_map m where m.legacy_subtask_id = s.id
)
on conflict (id) do nothing;

insert into public.project_task_migration_map (legacy_subtask_id, task_id)
select s.id, s.id
from public.project_subtasks s
join public.project_fields f on f.id = s.field_id
on conflict (legacy_subtask_id) do nothing;

do $$
declare
  v_source_count bigint;
  v_mapped_count bigint;
begin
  select count(*) into v_source_count from public.project_subtasks;
  select count(*) into v_mapped_count from public.project_task_migration_map m
    join public.project_subtasks s on s.id = m.legacy_subtask_id;
  if v_source_count <> v_mapped_count then
    raise exception 'Checklist migration verification failed: % source rows, % mapped rows.', v_source_count, v_mapped_count;
  end if;
  raise notice 'Checklist migration verified: % legacy rows mapped to tasks. Legacy rows are retained for operator verification.', v_source_count;
end;
$$;

-- Notifications retain the existing preferences and add a task target alongside
-- legacy subtask IDs. The old records are not rewritten or discarded.
alter table public.project_notifications add column if not exists task_id uuid references public.project_tasks(id) on delete set null;
alter table public.project_notifications drop constraint if exists project_notifications_kind_check;
alter table public.project_notifications add constraint project_notifications_kind_check
  check (kind in ('membership', 'access_removed', 'assignment', 'request', 'subtask', 'task', 'comment', 'attachment', 'deadline', 'update'));
create index if not exists project_notifications_task_idx on public.project_notifications(task_id, recipient_id, created_at desc);

create or replace function public.persora__project_notify_task(
  p_recipient uuid, p_actor uuid, p_project uuid, p_field uuid, p_task uuid,
  p_kind text, p_title text, p_message text, p_event_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_enabled boolean := true;
begin
  if p_recipient is null or p_project is null or p_recipient = p_actor then return; end if;
  if not exists (
    select 1 from public.projects p where p.id = p_project and
      (p.owner_id = p_recipient or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_recipient))
  ) then return; end if;
  select case p_kind
    when 'task' then coalesce(n.subtasks, true)
    when 'comment' then coalesce(n.comments, true)
    when 'attachment' then coalesce(n.attachments, true)
    else coalesce(n.updates, true)
  end into v_enabled
  from (select 1) seed left join public.project_notification_preferences n on n.user_id = p_recipient;
  if not coalesce(v_enabled, true) then return; end if;
  insert into public.project_notifications (
    recipient_id, actor_id, project_id, field_id, task_id, kind, actor_name, title, message, event_key
  ) values (
    p_recipient, p_actor, p_project, p_field, p_task, p_kind,
    coalesce(nullif(public.persora__project_name(p_actor), ''), 'A project member'),
    left(coalesce(nullif(trim(p_title), ''), 'Project update'), 120),
    left(coalesce(nullif(trim(p_message), ''), 'There is a new project update.'), 500),
    left(p_event_key || ':' || p_recipient::text, 240)
  ) on conflict (event_key) do nothing;
  delete from public.project_notifications where recipient_id = p_recipient and created_at < now() - interval '180 days';
end;
$function$;

create or replace function public.persora__project_task_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_project_owner uuid; v_actor uuid; v_event text;
begin
  select * into v_field from public.project_fields f where f.id = new.field_id and f.project_id = new.project_id;
  select p.owner_id into v_project_owner from public.projects p where p.id = new.project_id;
  v_actor := case when tg_op = 'INSERT' then new.created_by else coalesce(new.updated_by, new.created_by) end;
  v_event := new.id::text || ':' || new.updated_at::text;
  if tg_op = 'INSERT' then
    perform public.persora__project_notify_task(new.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task assigned to you', 'You have been assigned a project task.', 'task-assigned:' || v_event);
  else
    if new.assignee_id is distinct from old.assignee_id then
      perform public.persora__project_notify_task(new.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task assigned to you', 'You have been assigned a project task.', 'task-assigned:' || v_event);
      if old.assignee_id is not null then
        perform public.persora__project_notify_task(old.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task assignment changed', 'A project task assignment has changed.', 'task-unassigned:' || v_event);
      end if;
    end if;
    if old.status is distinct from new.status and new.status = 'complete' then
      perform public.persora__project_notify_task(new.created_by, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task completed', 'A project task was completed.', 'task-completed:' || v_event);
      perform public.persora__project_notify_task(v_field.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task completed', 'A project task was completed.', 'task-completed:' || v_event);
      perform public.persora__project_notify_task(v_project_owner, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task completed', 'A project task was completed.', 'task-completed:' || v_event);
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists project_task_notify on public.project_tasks;
create trigger project_task_notify after insert or update of assignee_id, status on public.project_tasks
for each row execute function public.persora__project_task_notify();

create or replace function public.persora__project_task_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_member record; v_field uuid;
begin
  select t.field_id into v_field from public.project_tasks t where t.id = new.task_id;
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify_task(v_member.user_id, new.author_id, new.project_id, v_field, new.task_id, 'comment', 'New task comment', 'A member commented on a project task.', 'task-comment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
drop trigger if exists project_task_comment_notify on public.project_task_comments;
create trigger project_task_comment_notify after insert on public.project_task_comments
for each row execute function public.persora__project_task_comment_notify();

create or replace function public.persora__project_task_attachment_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_member record;
begin
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify_task(v_member.user_id, new.uploader_id, new.project_id, new.field_id, new.task_id, 'attachment', 'Task attachment added', 'A private attachment was added to a project task.', 'task-attachment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
drop trigger if exists project_task_attachment_notify on public.project_task_attachments;
create trigger project_task_attachment_notify after insert on public.project_task_attachments
for each row execute function public.persora__project_task_attachment_notify();

-- The legacy progress column remains as a read-compatible projection, not an
-- editable source of truth. Every task insert/update/delete recalculates it.
create or replace function public.persora__project_field_task_progress(p_field uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(
    round(100.0 * count(*) filter (where t.status = 'complete') / nullif(count(*), 0))::integer,
    0
  )
  from public.project_tasks t
  where t.field_id = p_field
$function$;

create or replace function public.persora__project_task_progress_sync()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.project_fields f
    set progress = public.persora__project_field_task_progress(old.field_id)
    where f.id = old.field_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.project_fields f
    set progress = public.persora__project_field_task_progress(new.field_id)
    where f.id = new.field_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists project_tasks_sync_field_progress on public.project_tasks;
create trigger project_tasks_sync_field_progress
after insert or update or delete on public.project_tasks
for each row execute function public.persora__project_task_progress_sync();

update public.project_fields f
set progress = public.persora__project_field_task_progress(f.id);

-- Keep the established field create/edit/request flows while ignoring any
-- client-supplied progress value and deriving progress exclusively from tasks.
create or replace function public.persora__project_field_apply(
  p_field public.project_fields,
  p_project uuid,
  p_payload jsonb
)
returns public.project_fields
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_folder uuid;
  v_assignee uuid;
  v_status text;
  v_due date;
begin
  v_folder := case when p_payload ? 'folder_id' then nullif(p_payload->>'folder_id', '')::uuid else p_field.folder_id end;
  v_assignee := case when p_payload ? 'assignee_id' then nullif(p_payload->>'assignee_id', '')::uuid else p_field.assignee_id end;
  v_due := case when p_payload ? 'due_date' then nullif(p_payload->>'due_date', '')::date else p_field.due_date end;
  if v_folder is not null and not exists (
    select 1 from public.project_folders fo where fo.id = v_folder and fo.project_id = p_project
  ) then
    raise exception 'Choose a folder from this project.' using errcode = 'P0400';
  end if;
  if v_assignee is not null and not exists (
    select 1 from public.projects p
    left join public.project_members m on m.project_id = p.id and m.user_id = v_assignee
    where p.id = p_project and (p.owner_id = v_assignee or m.user_id is not null)
  ) then
    raise exception 'Assign team work to a member of this project.' using errcode = 'P0400';
  end if;
  v_status := coalesce(nullif(p_payload->>'status', ''), p_field.status, 'planning');
  if v_status not in ('planning', 'in-progress', 'in-review', 'blocked', 'completed') then
    raise exception 'Choose a valid field status.' using errcode = 'P0400';
  end if;
  p_field.title := coalesce(nullif(trim(p_payload->>'title'), ''), p_field.title);
  p_field.description := coalesce(p_payload->>'description', p_field.description, '');
  p_field.folder_id := v_folder;
  p_field.status := v_status;
  p_field.progress := public.persora__project_field_task_progress(p_field.id);
  p_field.assignee_id := v_assignee;
  p_field.due_date := v_due;
  return p_field;
end;
$function$;

create or replace function public.persora__project_can_manage_task(p_user uuid, p_task uuid)
returns public.project_tasks
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_access record;
begin
  select * into v_task from public.project_tasks t where t.id = p_task for update;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_field from public.project_fields f
  where f.id = v_task.field_id and f.project_id = v_task.project_id;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  if not (v_access.is_owner or v_field.assignee_id = p_user) then
    raise exception 'Only the project owner or the assignee of this field can manage its tasks.' using errcode = 'P0403';
  end if;
  return v_task;
end;
$function$;

create or replace function public.persora__project_validate_task_assignee(p_project uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_assignee is not null and not exists (
    select 1 from public.projects p
    left join public.project_members m on m.project_id = p.id and m.user_id = p_assignee
    where p.id = p_project and (p.owner_id = p_assignee or m.user_id is not null)
  ) then
    raise exception 'Assign the task to a member of this project.' using errcode = 'P0400';
  end if;
end;
$function$;

create or replace function public.persora_project_task_create(p_user uuid, p_project uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_field public.project_fields;
  v_task public.project_tasks;
  v_name text;
  v_description text;
  v_status text;
  v_assignee uuid;
  v_order integer;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  if nullif(p_payload->>'field_id', '') is null then raise exception 'Choose a field for this task.' using errcode = 'P0400'; end if;
  select * into v_field from public.project_fields f
  where f.id = (p_payload->>'field_id')::uuid and f.project_id = p_project for update;
  if not found then raise exception 'Choose a field from this project.' using errcode = 'P0400'; end if;
  if not (v_access.is_owner or v_field.assignee_id = p_user) then
    raise exception 'Only the project owner or the assignee of this field can create tasks.' using errcode = 'P0403';
  end if;
  v_name := trim(coalesce(p_payload->>'name', ''));
  if char_length(v_name) not between 1 and 240 then raise exception 'Enter a task name between 1 and 240 characters.' using errcode = 'P0400'; end if;
  v_description := coalesce(p_payload->>'description', '');
  if char_length(v_description) > 4000 then raise exception 'Keep the task description under 4,000 characters.' using errcode = 'P0400'; end if;
  v_status := coalesce(nullif(p_payload->>'status', ''), 'todo');
  if v_status not in ('todo', 'in-progress', 'in-review') then
    raise exception 'New tasks cannot start as Complete; choose To Do, In Progress, or In Review.' using errcode = 'P0400';
  end if;
  v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
  perform public.persora__project_validate_task_assignee(p_project, v_assignee);
  select coalesce(max(t.sort_order), 0) + 10 into v_order
  from public.project_tasks t where t.project_id = p_project and t.status = v_status;
  insert into public.project_tasks(project_id, field_id, name, description, status, assignee_id, created_by, updated_by, sort_order)
  values (p_project, v_field.id, v_name, v_description, v_status, v_assignee, p_user, p_user, v_order)
  returning * into v_task;
  perform public.persora__project_log(p_project, p_user, 'task_created', left(v_task.name, 200));
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.persora_project_task_update(p_user uuid, p_task uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_destination public.project_fields;
  v_access record;
  v_old_status text;
  v_new_status text;
  v_assignee uuid;
  v_destination_id uuid;
  v_order integer;
begin
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  v_old_status := v_task.status;
  v_new_status := v_task.status;

  if p_payload ? 'name' then
    if char_length(trim(coalesce(p_payload->>'name', ''))) not between 1 and 240 then
      raise exception 'Enter a task name between 1 and 240 characters.' using errcode = 'P0400';
    end if;
    v_task.name := trim(p_payload->>'name');
  end if;
  if p_payload ? 'description' then
    if char_length(coalesce(p_payload->>'description', '')) > 4000 then
      raise exception 'Keep the task description under 4,000 characters.' using errcode = 'P0400';
    end if;
    v_task.description := p_payload->>'description';
  end if;
  if p_payload ? 'assignee_id' then
    v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
    perform public.persora__project_validate_task_assignee(v_task.project_id, v_assignee);
    v_task.assignee_id := v_assignee;
  end if;
  if p_payload ? 'field_id' then
    v_destination_id := nullif(p_payload->>'field_id', '')::uuid;
    if v_destination_id is null then raise exception 'Choose a field for this task.' using errcode = 'P0400'; end if;
    select * into v_destination from public.project_fields f
    where f.id = v_destination_id and f.project_id = v_task.project_id for update;
    if not found then raise exception 'Choose a field from this project.' using errcode = 'P0400'; end if;
    if not (v_access.is_owner or v_destination.assignee_id = p_user) then
      raise exception 'The task must stay within a field you can manage.' using errcode = 'P0403';
    end if;
    v_task.field_id := v_destination.id;
  end if;
  if p_payload ? 'status' then
    v_new_status := p_payload->>'status';
    if v_new_status not in ('todo', 'in-progress', 'in-review', 'complete') then
      raise exception 'Choose a valid task status.' using errcode = 'P0400';
    end if;
    if v_new_status = 'complete' and v_task.status <> 'in-review' and v_task.status <> 'complete' then
      raise exception 'Move the task to In Review before completing it.' using errcode = 'P0409';
    end if;
    v_task.status := v_new_status;
  end if;

  if v_task.status is distinct from v_old_status then
    select coalesce(max(t.sort_order), 0) + 10 into v_order
    from public.project_tasks t
    where t.project_id = v_task.project_id and t.status = v_task.status and t.id <> v_task.id;
    v_task.sort_order := v_order;
  end if;
  update public.project_tasks
  set field_id = v_task.field_id, name = v_task.name, description = v_task.description,
      status = v_task.status, assignee_id = v_task.assignee_id, sort_order = v_task.sort_order,
      updated_at = now(), updated_by = p_user
  where id = p_task returning * into v_task;
  if v_task.field_id is distinct from v_field.id then
    update public.project_task_attachments set field_id = v_task.field_id where task_id = v_task.id;
  end if;

  if v_task.status is distinct from v_old_status then
    perform public.persora__project_log(v_task.project_id, p_user, 'task_status_changed', left(v_task.name || ' → ' || v_task.status, 200));
  elsif p_payload ? 'field_id' and v_task.field_id is distinct from v_field.id then
    perform public.persora__project_log(v_task.project_id, p_user, 'task_field_changed', left(v_task.name, 200));
  else
    perform public.persora__project_log(v_task.project_id, p_user, 'task_updated', left(v_task.name, 200));
  end if;
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.persora_project_task_move(p_user uuid, p_task uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_access record;
  v_order integer;
  v_can_manage boolean;
begin
  select * into v_task from public.project_tasks t where t.id = p_task for update;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  if p_status not in ('todo', 'in-progress', 'in-review', 'complete') then
    raise exception 'Choose a valid task status.' using errcode = 'P0400';
  end if;
  v_can_manage := v_access.is_owner or v_field.assignee_id = p_user;
  if v_can_manage then
    if p_status = 'complete' and v_task.status <> 'in-review' and v_task.status <> 'complete' then
      raise exception 'Move the task to In Review before completing it.' using errcode = 'P0409';
    end if;
  elsif v_task.assignee_id = p_user and v_task.status <> 'complete' and p_status in ('todo', 'in-progress', 'in-review') then
    null;
  else
    raise exception 'Only the project owner or field assignee can complete or reopen tasks; task assignees can move active tasks only.' using errcode = 'P0403';
  end if;
  if v_task.status = p_status then return to_jsonb(v_task); end if;
  select coalesce(max(t.sort_order), 0) + 10 into v_order
  from public.project_tasks t where t.project_id = v_task.project_id and t.status = p_status and t.id <> v_task.id;
  update public.project_tasks
  set status = p_status, sort_order = v_order, updated_at = now(), updated_by = p_user
  where id = p_task returning * into v_task;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_status_changed', left(v_task.name || ' → ' || v_task.status, 200));
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.persora_project_task_pause(p_user uuid, p_task uuid, p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_task public.project_tasks; v_old_paused boolean;
begin
  if p_paused is null then raise exception 'Choose Pause or Resume.' using errcode = 'P0400'; end if;
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  v_old_paused := v_task.paused;
  if v_old_paused is distinct from p_paused then
    update public.project_tasks set paused = p_paused, updated_at = now(), updated_by = p_user
    where id = p_task returning * into v_task;
    perform public.persora__project_log(v_task.project_id, p_user, case when p_paused then 'task_paused' else 'task_resumed' end, left(v_task.name, 200));
  end if;
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.persora_project_task_delete(p_user uuid, p_task uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_task public.project_tasks;
begin
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  perform public.persora__project_log(v_task.project_id, p_user, 'task_deleted', left(v_task.name, 200));
  delete from public.project_tasks where id = p_task;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_task_comment_add(p_user uuid, p_task uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_task public.project_tasks; v_comment public.project_task_comments;
begin
  select * into v_task from public.project_tasks t where t.id = p_task;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  perform public.persora__project_access(p_user, v_task.project_id);
  insert into public.project_task_comments(task_id, project_id, author_id, author_name, body)
  values (p_task, v_task.project_id, p_user, public.persora__project_name(p_user), trim(coalesce(p_body, '')))
  returning * into v_comment;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_comment_added', left(v_task.name, 200));
  return to_jsonb(v_comment);
end;
$function$;

create or replace function public.persora_project_task_comment_update(p_user uuid, p_comment uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_comment public.project_task_comments;
begin
  select * into v_comment from public.project_task_comments c where c.id = p_comment;
  if not found then raise exception 'That comment is not available.' using errcode = 'P0404'; end if;
  perform public.persora__project_access(p_user, v_comment.project_id);
  if v_comment.author_id <> p_user then raise exception 'Only the comment author can edit it.' using errcode = 'P0403'; end if;
  update public.project_task_comments set body = trim(coalesce(p_body, '')), updated_at = now()
  where id = p_comment returning * into v_comment;
  return to_jsonb(v_comment);
end;
$function$;

create or replace function public.persora_project_task_comment_delete(p_user uuid, p_comment uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_comment public.project_task_comments; v_access record;
begin
  select * into v_comment from public.project_task_comments c where c.id = p_comment;
  if not found then raise exception 'That comment is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_comment.project_id);
  if not (v_access.is_owner or v_comment.author_id = p_user) then
    raise exception 'Only the comment author or project owner can delete it.' using errcode = 'P0403';
  end if;
  delete from public.project_task_comments where id = p_comment;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_task_attachment_add(
  p_user uuid, p_task uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_task public.project_tasks; v_field public.project_fields; v_project_owner uuid; v_file public.project_task_attachments;
begin
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  select p.owner_id into v_project_owner from public.projects p where p.id = v_task.project_id;
  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 240 or p_file_size not between 1 and 157286400 then
    raise exception 'Choose a valid attachment up to 150 MB.' using errcode = 'P0400';
  end if;
  insert into public.project_task_attachments(project_id, field_id, task_id, owner_id, uploader_id, file_key, file_name, file_size, file_type)
  values (v_task.project_id, v_field.id, v_task.id, v_project_owner, p_user, p_file_key, trim(p_file_name), p_file_size, p_file_type)
  returning * into v_file;
  update public.project_tasks set updated_at = now(), updated_by = p_user where id = v_task.id;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_attachment_added', left(v_task.name, 200));
  return to_jsonb(v_file);
end;
$function$;

create or replace function public.persora_project_task_attachment_delete(p_user uuid, p_attachment uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_file public.project_task_attachments; v_task public.project_tasks;
begin
  select * into v_file from public.project_task_attachments a where a.id = p_attachment;
  if not found then raise exception 'That attachment is not available.' using errcode = 'P0404'; end if;
  v_task := public.persora__project_can_manage_task(p_user, v_file.task_id);
  delete from public.project_task_attachments where id = p_attachment;
  update public.project_tasks set updated_at = now(), updated_by = p_user where id = v_task.id;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_attachment_removed', left(v_task.name, 200));
  return jsonb_build_object('ok', true, 'file_key', v_file.file_key, 'owner_id', v_file.owner_id);
end;
$function$;

-- Reuse the existing durable private-object cleanup queue for task attachments.
drop trigger if exists project_task_attachment_cleanup_enqueue on public.project_task_attachments;
create trigger project_task_attachment_cleanup_enqueue
after delete on public.project_task_attachments
for each row execute function public.persora__project_queue_attachment_cleanup();

revoke all on function public.persora__project_field_task_progress(uuid) from public, anon, authenticated;
revoke all on function public.persora__project_task_progress_sync() from public, anon, authenticated;
revoke all on function public.persora__project_notify_task(uuid, uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.persora__project_task_notify() from public, anon, authenticated;
revoke all on function public.persora__project_task_comment_notify() from public, anon, authenticated;
revoke all on function public.persora__project_task_attachment_notify() from public, anon, authenticated;
revoke all on function public.persora__project_can_manage_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora__project_validate_task_assignee(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_task_create(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_project_task_update(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_project_task_move(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.persora_project_task_pause(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.persora_project_task_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_task_comment_add(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.persora_project_task_comment_update(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.persora_project_task_comment_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_task_attachment_add(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.persora_project_task_attachment_delete(uuid, uuid) from public, anon, authenticated;

-- The Worker holds the service-role credential; every RPC still enforces the
-- caller's real user ID inside Postgres before changing records.
grant execute on function public.persora__project_field_task_progress(uuid) to service_role;
grant execute on function public.persora__project_notify_task(uuid, uuid, uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.persora__project_task_notify() to service_role;
grant execute on function public.persora__project_task_comment_notify() to service_role;
grant execute on function public.persora__project_task_attachment_notify() to service_role;
grant execute on function public.persora__project_can_manage_task(uuid, uuid) to service_role;
grant execute on function public.persora__project_validate_task_assignee(uuid, uuid) to service_role;
grant execute on function public.persora_project_task_create(uuid, uuid, jsonb) to service_role;
grant execute on function public.persora_project_task_update(uuid, uuid, jsonb) to service_role;
grant execute on function public.persora_project_task_move(uuid, uuid, text) to service_role;
grant execute on function public.persora_project_task_pause(uuid, uuid, boolean) to service_role;
grant execute on function public.persora_project_task_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_task_comment_add(uuid, uuid, text) to service_role;
grant execute on function public.persora_project_task_comment_update(uuid, uuid, text) to service_role;
grant execute on function public.persora_project_task_comment_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_task_attachment_add(uuid, uuid, text, text, bigint, text) to service_role;
grant execute on function public.persora_project_task_attachment_delete(uuid, uuid) to service_role;
