-- Persora Projects: secure subtasks, private field attachments and persistent notifications.
-- All tables remain service-role-only. Mutations are security-definer RPCs with the
-- same owner / field-creator checks as the existing Projects permission model.

create table if not exists public.project_subtasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  field_id uuid not null references public.project_fields(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  completed boolean not null default false,
  sort_order integer not null default 0,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_subtasks_field_order_idx on public.project_subtasks(field_id, sort_order, created_at);
create index if not exists project_subtasks_project_idx on public.project_subtasks(project_id, field_id);
alter table public.project_subtasks enable row level security;
revoke all on public.project_subtasks from anon, authenticated;
grant all on public.project_subtasks to service_role;

create table if not exists public.project_field_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  field_id uuid not null references public.project_fields(id) on delete cascade,
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
  created_at timestamptz not null default now()
);
create index if not exists project_field_attachments_field_idx on public.project_field_attachments(field_id, created_at);
create index if not exists project_field_attachments_project_idx on public.project_field_attachments(project_id, created_at desc);
alter table public.project_field_attachments enable row level security;
revoke all on public.project_field_attachments from anon, authenticated;
grant all on public.project_field_attachments to service_role;

-- Durable cleanup queue handles R2 objects removed by attachment, field or project
-- cascades. Workers delete only after confirming the key is no longer referenced.
create table if not exists public.project_attachment_cleanup (
  file_key text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  queued_at timestamptz not null default now()
);
create index if not exists project_attachment_cleanup_queued_idx on public.project_attachment_cleanup(queued_at);
alter table public.project_attachment_cleanup enable row level security;
revoke all on public.project_attachment_cleanup from anon, authenticated;
grant all on public.project_attachment_cleanup to service_role;

create table if not exists public.project_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  membership boolean not null default true,
  assignments boolean not null default true,
  requests boolean not null default true,
  subtasks boolean not null default true,
  comments boolean not null default true,
  attachments boolean not null default true,
  deadlines boolean not null default true,
  updates boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.project_notification_preferences enable row level security;
revoke all on public.project_notification_preferences from anon, authenticated;
grant all on public.project_notification_preferences to service_role;

create table if not exists public.project_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  project_id uuid not null references public.projects(id) on delete cascade,
  field_id uuid references public.project_fields(id) on delete set null,
  subtask_id uuid references public.project_subtasks(id) on delete set null,
  kind text not null check (kind in ('membership', 'access_removed', 'assignment', 'request', 'subtask', 'comment', 'attachment', 'deadline', 'update')),
  actor_name text not null default 'A project member' check (char_length(actor_name) <= 120),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  event_key text not null unique check (char_length(event_key) between 1 and 240),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists project_notifications_recipient_created_idx on public.project_notifications(recipient_id, created_at desc);
create index if not exists project_notifications_project_idx on public.project_notifications(project_id, recipient_id, created_at desc);
alter table public.project_notifications enable row level security;
revoke all on public.project_notifications from anon, authenticated;
grant all on public.project_notifications to service_role;

create or replace function public.persora__project_queue_attachment_cleanup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.project_attachment_cleanup(file_key, owner_id)
  values (old.file_key, old.owner_id)
  on conflict (file_key) do update set queued_at = now();
  return old;
end;
$function$;
drop trigger if exists project_attachment_cleanup_enqueue on public.project_field_attachments;
create trigger project_attachment_cleanup_enqueue
after delete on public.project_field_attachments
for each row execute function public.persora__project_queue_attachment_cleanup();

create or replace function public.persora__project_notify(
  p_recipient uuid,
  p_actor uuid,
  p_project uuid,
  p_field uuid,
  p_subtask uuid,
  p_kind text,
  p_title text,
  p_message text,
  p_event_key text,
  p_allow_removed boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean := true;
begin
  if p_recipient is null or p_project is null or p_recipient = p_actor then return; end if;
  if not p_allow_removed and not exists (
    select 1 from public.projects p
    where p.id = p_project and (p.owner_id = p_recipient or exists (
      select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_recipient
    ))
  ) then return; end if;
  select case p_kind
    when 'membership' then coalesce(n.membership, true)
    when 'access_removed' then coalesce(n.membership, true)
    when 'assignment' then coalesce(n.assignments, true)
    when 'request' then coalesce(n.requests, true)
    when 'subtask' then coalesce(n.subtasks, true)
    when 'comment' then coalesce(n.comments, true)
    when 'attachment' then coalesce(n.attachments, true)
    when 'deadline' then coalesce(n.deadlines, true)
    else coalesce(n.updates, true)
  end into v_enabled
  from (select 1) seed
  left join public.project_notification_preferences n on n.user_id = p_recipient;
  if not coalesce(v_enabled, true) then return; end if;
  insert into public.project_notifications (
    recipient_id, actor_id, project_id, field_id, subtask_id, kind, actor_name, title, message, event_key
  ) values (
    p_recipient, p_actor, p_project, p_field, p_subtask, p_kind,
    coalesce(nullif(public.persora__project_name(p_actor), ''), 'A project member'),
    left(coalesce(nullif(trim(p_title), ''), 'Project update'), 120),
    left(coalesce(nullif(trim(p_message), ''), 'There is a new project update.'), 500),
    left(p_event_key || ':' || p_recipient::text, 240)
  ) on conflict (event_key) do nothing;
  delete from public.project_notifications where recipient_id = p_recipient and created_at < now() - interval '180 days';
end;
$function$;

create or replace function public.persora__project_activity_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_kind text;
  v_title text;
  v_field uuid;
  v_member record;
begin
  if new.action in ('member_added', 'member_updated', 'member_removed', 'member_left') then
    v_kind := 'membership'; v_title := 'Project membership changed';
  elsif new.action in ('project_updated', 'field_status_changed', 'field_created', 'field_updated', 'field_deleted') then
    v_kind := 'update'; v_title := 'Project work updated';
  else
    return new;
  end if;
  if new.action like 'field_%' then
    select f.id into v_field
    from public.project_fields f
    where f.project_id = new.project_id
      and f.title = case when position(' → ' in new.target) > 0 then left(new.target, position(' → ' in new.target) - 1) else new.target end
    order by f.updated_at desc limit 1;
  end if;
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union
    select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(
      v_member.user_id, new.actor_id, new.project_id, v_field, null, v_kind, v_title,
      case when new.action like 'member_%' then 'A project membership or role changed.'
           else 'A project field or setting was updated.' end,
      'activity:' || new.id::text
    );
  end loop;
  return new;
end;
$function$;
drop trigger if exists project_activity_notify on public.project_activity;
create trigger project_activity_notify after insert on public.project_activity
for each row execute function public.persora__project_activity_notify();

-- The older schema did not retain the update actor. Adding nullable columns keeps
-- existing records intact and lets notification triggers suppress self-alerts.
alter table public.project_fields add column if not exists updated_by uuid references public.profiles(id) on delete set null;
create or replace function public.persora__project_field_assignment_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.persora__project_notify(new.assignee_id, coalesce(new.updated_by, new.creator_id), new.project_id, new.id, null, 'assignment', 'Field assigned to you', 'You have been assigned a project field.', 'field-assignment:' || new.id::text || ':' || new.updated_at::text);
  elsif new.assignee_id is distinct from old.assignee_id then
    perform public.persora__project_notify(new.assignee_id, coalesce(new.updated_by, new.creator_id), new.project_id, new.id, null, 'assignment', 'Field assigned to you', 'You have been assigned a project field.', 'field-assignment:' || new.id::text || ':' || new.updated_at::text);
    if old.assignee_id is not null then
      perform public.persora__project_notify(old.assignee_id, coalesce(new.updated_by, new.creator_id), new.project_id, new.id, null, 'assignment', 'Field assignment changed', 'A project field assignment has changed.', 'field-unassignment:' || new.id::text || ':' || new.updated_at::text);
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists project_field_assignment_notify on public.project_fields;
drop trigger if exists project_field_initial_assignment_notify on public.project_fields;
create trigger project_field_assignment_notify after update of assignee_id on public.project_fields
for each row execute function public.persora__project_field_assignment_notify();
create trigger project_field_initial_assignment_notify after insert on public.project_fields
for each row execute function public.persora__project_field_assignment_notify();

-- Replace the existing field-update RPC only to record the authenticated actor;
-- its original validation, strict ownership check, and activity behavior remain.
create or replace function public.persora_project_field_update(p_user uuid, p_field uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_field public.project_fields;
  v_access record;
  v_old_status text;
begin
  select * into v_field from public.project_fields f where f.id = p_field;
  if not found then raise exception 'That field is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can edit it.' using errcode = 'P0403';
  end if;
  v_old_status := v_field.status;
  v_field := public.persora__project_field_apply(v_field, v_field.project_id, p_payload);
  update public.project_fields
  set folder_id = v_field.folder_id, title = v_field.title, description = v_field.description,
      status = v_field.status, progress = v_field.progress, assignee_id = v_field.assignee_id,
      due_date = v_field.due_date, updated_at = now(), updated_by = p_user
  where id = p_field returning * into v_field;
  if v_field.status is distinct from v_old_status then
    perform public.persora__project_log(v_field.project_id, p_user, 'field_status_changed', v_field.title || ' → ' || v_field.status);
  else
    perform public.persora__project_log(v_field.project_id, p_user, 'field_updated', v_field.title);
  end if;
  return to_jsonb(v_field);
end;
$function$;

create or replace function public.persora__project_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_member record; v_title text;
begin
  select f.title into v_title from public.project_fields f where f.id = new.field_id;
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(v_member.user_id, new.author_id, new.project_id, new.field_id, null, 'comment', 'New field comment', 'A member commented on a project field.', 'comment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
drop trigger if exists project_comment_notify on public.project_field_comments;
create trigger project_comment_notify after insert on public.project_field_comments
for each row execute function public.persora__project_comment_notify();

create or replace function public.persora__project_request_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      select p.owner_id into v_owner from public.projects p where p.id = new.project_id;
      perform public.persora__project_notify(v_owner, new.requester_id, new.project_id, null, null, 'request', 'Field request received', 'A project member requested permission to add a field.', 'request-created:' || new.id::text);
    end if;
  elsif old.status is distinct from new.status and new.status in ('approved', 'rejected') then
    perform public.persora__project_notify(new.requester_id, new.resolved_by, new.project_id, new.field_id, null, 'request', case when new.status = 'approved' then 'Field request approved' else 'Field request declined' end, case when new.status = 'approved' then 'Your request to add a project field was approved.' else 'Your request to add a project field was declined.' end, 'request-resolved:' || new.id::text || ':' || new.status);
  end if;
  return new;
end;
$function$;
drop trigger if exists project_request_notify on public.project_field_requests;
drop trigger if exists project_request_resolve_notify on public.project_field_requests;
create trigger project_request_notify after insert on public.project_field_requests
for each row execute function public.persora__project_request_notify();
create trigger project_request_resolve_notify after update of status on public.project_field_requests
for each row execute function public.persora__project_request_notify();

create or replace function public.persora__project_attachment_notify()
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
    perform public.persora__project_notify(v_member.user_id, new.uploader_id, new.project_id, new.field_id, null, 'attachment', 'Field attachment added', 'A private attachment was added to a project field.', 'attachment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
drop trigger if exists project_attachment_notify on public.project_field_attachments;
create trigger project_attachment_notify after insert on public.project_field_attachments
for each row execute function public.persora__project_attachment_notify();

create or replace function public.persora__project_subtask_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_actor uuid; v_event text; v_project_owner uuid;
begin
  select * into v_field from public.project_fields f where f.id = new.field_id;
  select p.owner_id into v_project_owner from public.projects p where p.id = new.project_id;
  v_actor := case when tg_op = 'INSERT' then new.created_by else coalesce(new.updated_by, new.created_by) end;
  v_event := new.id::text || ':' || new.updated_at::text;
  if tg_op = 'INSERT' then
    perform public.persora__project_notify(new.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'subtask', 'Subtask assigned to you', 'You have been assigned a project subtask.', 'subtask-assigned:' || v_event);
  else
    if new.assignee_id is distinct from old.assignee_id then
      perform public.persora__project_notify(new.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'subtask', 'Subtask assigned to you', 'You have been assigned a project subtask.', 'subtask-assigned:' || v_event);
      if old.assignee_id is not null then
        perform public.persora__project_notify(old.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'subtask', 'Subtask assignment changed', 'A project subtask assignment has changed.', 'subtask-unassigned:' || v_event);
      end if;
    end if;
    if old.completed is distinct from new.completed and new.completed then
      perform public.persora__project_notify(v_field.creator_id, v_actor, new.project_id, new.field_id, new.id, 'subtask', 'Subtask completed', 'A project subtask was completed.', 'subtask-completed:' || v_event);
      perform public.persora__project_notify(v_field.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'subtask', 'Subtask completed', 'A project subtask was completed.', 'subtask-completed:' || v_event);
      perform public.persora__project_notify(v_project_owner, v_actor, new.project_id, new.field_id, new.id, 'subtask', 'Subtask completed', 'A project subtask was completed.', 'subtask-completed:' || v_event);
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists project_subtask_notify on public.project_subtasks;
drop trigger if exists project_subtask_update_notify on public.project_subtasks;
create trigger project_subtask_notify after insert on public.project_subtasks
for each row execute function public.persora__project_subtask_notify();
create trigger project_subtask_update_notify after update of assignee_id, completed on public.project_subtasks
for each row execute function public.persora__project_subtask_notify();

create or replace function public.persora__project_can_edit_field(p_user uuid, p_field uuid)
returns public.project_fields
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_access record;
begin
  select * into v_field from public.project_fields f where f.id = p_field;
  if not found then raise exception 'That field is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can change its subtasks or attachments.' using errcode = 'P0403';
  end if;
  return v_field;
end;
$function$;

create or replace function public.persora__project_validate_assignee(p_project uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_assignee is not null and not exists (
    select 1 from public.projects p left join public.project_members m on m.project_id = p.id and m.user_id = p_assignee
    where p.id = p_project and (p.owner_id = p_assignee or m.user_id is not null)
  ) then raise exception 'Assign work to a member of this project.' using errcode = 'P0400'; end if;
end;
$function$;

create or replace function public.persora_project_subtask_create(p_user uuid, p_field uuid, p_title text, p_assignee uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_task public.project_subtasks; v_order integer;
begin
  v_field := public.persora__project_can_edit_field(p_user, p_field);
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'Enter a subtask between 1 and 240 characters.' using errcode = 'P0400'; end if;
  perform public.persora__project_validate_assignee(v_field.project_id, p_assignee);
  perform 1 from public.project_fields where id = p_field for update;
  if (select count(*) from public.project_subtasks t where t.field_id = p_field) >= 500 then raise exception 'A field can contain up to 500 subtasks.' using errcode = 'P0409'; end if;
  select coalesce(max(t.sort_order), 0) + 10 into v_order from public.project_subtasks t where t.field_id = p_field;
  insert into public.project_subtasks(project_id, field_id, title, sort_order, assignee_id, created_by, updated_by)
  values (v_field.project_id, p_field, trim(p_title), v_order, p_assignee, p_user, p_user) returning * into v_task;
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.persora_project_subtask_update(p_user uuid, p_subtask uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_task public.project_subtasks; v_field public.project_fields; v_assignee uuid;
begin
  select * into v_task from public.project_subtasks t where t.id = p_subtask for update;
  if not found then raise exception 'That subtask is not available.' using errcode = 'P0404'; end if;
  v_field := public.persora__project_can_edit_field(p_user, v_task.field_id);
  if p_payload ? 'title' then
    if char_length(trim(coalesce(p_payload->>'title', ''))) not between 1 and 240 then raise exception 'Enter a subtask between 1 and 240 characters.' using errcode = 'P0400'; end if;
    v_task.title := trim(p_payload->>'title');
  end if;
  if p_payload ? 'assignee_id' then
    v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
    perform public.persora__project_validate_assignee(v_task.project_id, v_assignee);
    v_task.assignee_id := v_assignee;
  end if;
  if p_payload ? 'completed' then
    if p_payload->>'completed' not in ('true', 'false') then raise exception 'Choose a valid subtask status.' using errcode = 'P0400'; end if;
    v_task.completed := (p_payload->>'completed')::boolean;
  end if;
  update public.project_subtasks set title = v_task.title, assignee_id = v_task.assignee_id, completed = v_task.completed, updated_at = now(), updated_by = p_user
  where id = p_subtask returning * into v_task;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = v_task.field_id;
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.persora_project_subtask_reorder(p_user uuid, p_field uuid, p_order uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_count integer; v_unique integer;
begin
  v_field := public.persora__project_can_edit_field(p_user, p_field);
  select count(*), count(distinct item.task_id) into v_count, v_unique
  from unnest(coalesce(p_order, '{}'::uuid[])) as item(task_id);
  if v_count <> v_unique or v_count <> (select count(*) from public.project_subtasks t where t.field_id = p_field)
     or exists (select 1 from unnest(coalesce(p_order, '{}'::uuid[])) as item(task_id) where not exists (select 1 from public.project_subtasks t where t.id = item.task_id and t.field_id = p_field)) then
    raise exception 'Refresh this field before reordering its subtasks.' using errcode = 'P0409';
  end if;
  perform 1 from public.project_fields where id = p_field for update;
  update public.project_subtasks t set sort_order = ordered.ordinality * 10, updated_at = now()
  from unnest(coalesce(p_order, '{}'::uuid[])) with ordinality as ordered(task_id, ordinality)
  where t.id = ordered.task_id and t.field_id = p_field;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = p_field;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_subtask_delete(p_user uuid, p_subtask uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_task public.project_subtasks; v_field public.project_fields;
begin
  select * into v_task from public.project_subtasks t where t.id = p_subtask;
  if not found then raise exception 'That subtask is not available.' using errcode = 'P0404'; end if;
  v_field := public.persora__project_can_edit_field(p_user, v_task.field_id);
  delete from public.project_subtasks where id = p_subtask;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = v_task.field_id;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_attachment_add(p_user uuid, p_field uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_owner uuid; v_attachment public.project_field_attachments;
begin
  v_field := public.persora__project_can_edit_field(p_user, p_field);
  select p.owner_id into v_owner from public.projects p where p.id = v_field.project_id;
  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 240 or p_file_size not between 1 and 157286400 then raise exception 'Choose a valid attachment up to 150 MB.' using errcode = 'P0400'; end if;
  insert into public.project_field_attachments(project_id, field_id, owner_id, uploader_id, file_key, file_name, file_size, file_type)
  values (v_field.project_id, p_field, v_owner, p_user, p_file_key, trim(p_file_name), p_file_size, p_file_type)
  returning * into v_attachment;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = p_field;
  return to_jsonb(v_attachment);
end;
$function$;

create or replace function public.persora_project_attachment_delete(p_user uuid, p_attachment uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_file public.project_field_attachments; v_field public.project_fields; v_access record;
begin
  select * into v_file from public.project_field_attachments a where a.id = p_attachment;
  if not found then raise exception 'That attachment is not available.' using errcode = 'P0404'; end if;
  v_field := public.persora__project_can_edit_field(p_user, v_file.field_id);
  select * into v_access from public.persora__project_access(p_user, v_file.project_id);
  if not (v_access.is_owner or v_file.uploader_id = p_user) then
    raise exception 'Only the attachment uploader or project owner can remove this file.' using errcode = 'P0403';
  end if;
  delete from public.project_field_attachments where id = p_attachment;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = v_file.field_id;
  return jsonb_build_object('ok', true, 'file_key', v_file.file_key);
end;
$function$;

create or replace function public.persora__project_overdue_notifications(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field record; v_recipient uuid;
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  for v_field in
    select f.id, f.project_id, f.creator_id, f.assignee_id, f.due_date, f.title, p.owner_id
    from public.project_fields f join public.projects p on p.id = f.project_id
    where f.status <> 'completed' and f.due_date < current_date
      and (p.owner_id = p_user or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_user))
  loop
    for v_recipient in
      select distinct recipients.user_id from unnest(array[v_field.owner_id, v_field.creator_id, v_field.assignee_id]) as recipients(user_id)
      where recipients.user_id is not null
    loop
      perform public.persora__project_notify(v_recipient, null, v_field.project_id, v_field.id, null, 'deadline', 'Project field overdue', 'A project field has passed its due date.', 'overdue:' || v_field.id::text || ':' || v_field.due_date::text);
    end loop;
  end loop;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora__project_notifications_mark_read(p_user uuid, p_notification uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  if p_notification is null then
    update public.project_notifications set read_at = coalesce(read_at, now()) where recipient_id = p_user and read_at is null;
  else
    update public.project_notifications set read_at = coalesce(read_at, now()) where id = p_notification and recipient_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora__project_notification_preferences_save(p_user uuid, p_preferences jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_saved public.project_notification_preferences;
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  insert into public.project_notification_preferences(user_id, membership, assignments, requests, subtasks, comments, attachments, deadlines, updates, updated_at)
  values (
    p_user,
    coalesce((p_preferences->>'membership')::boolean, true),
    coalesce((p_preferences->>'assignments')::boolean, true),
    coalesce((p_preferences->>'requests')::boolean, true),
    coalesce((p_preferences->>'subtasks')::boolean, true),
    coalesce((p_preferences->>'comments')::boolean, true),
    coalesce((p_preferences->>'attachments')::boolean, true),
    coalesce((p_preferences->>'deadlines')::boolean, true),
    coalesce((p_preferences->>'updates')::boolean, true), now()
  ) on conflict (user_id) do update set
    membership = excluded.membership, assignments = excluded.assignments, requests = excluded.requests,
    subtasks = excluded.subtasks, comments = excluded.comments, attachments = excluded.attachments,
    deadlines = excluded.deadlines, updates = excluded.updates, updated_at = now()
  returning * into v_saved;
  return to_jsonb(v_saved);
end;
$function$;

create or replace function public.persora_project_member_remove(p_user uuid, p_project uuid, p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_access record; v_action text; v_owner uuid;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner and v_access.member_role is null and p_member <> p_user then raise exception 'That project is not available.' using errcode = 'P0404'; end if;
  if not v_access.is_owner and p_member <> p_user then raise exception 'Only the project owner can remove members.' using errcode = 'P0403'; end if;
  select p.owner_id into v_owner from public.projects p where p.id = p_project;
  delete from public.project_members where project_id = p_project and user_id = p_member;
  if not found then raise exception 'That member is not part of this project.' using errcode = 'P0404'; end if;
  v_action := case when p_member = p_user and not v_access.is_owner then 'member_left' else 'member_removed' end;
  perform public.persora__project_log(p_project, p_user, v_action, public.persora__project_name(p_member));
  if p_member <> p_user then
    perform public.persora__project_notify(p_member, p_user, p_project, null, null, 'access_removed', 'Project access changed', 'Your access to a shared project was removed.', 'access-removed:' || p_project::text || ':' || p_member::text || ':' || gen_random_uuid()::text, true);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- Membership changes are owner-only except voluntary departure. When owner
-- removes a member, send a redacted notice that survives membership removal.
revoke all on function public.persora_project_subtask_create(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_subtask_update(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_project_subtask_reorder(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.persora_project_subtask_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_attachment_add(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.persora_project_attachment_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora__project_can_edit_field(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora__project_validate_assignee(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora__project_overdue_notifications(uuid) from public, anon, authenticated;
revoke all on function public.persora__project_notifications_mark_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora__project_notification_preferences_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora__project_notify(uuid, uuid, uuid, uuid, uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.persora__project_queue_attachment_cleanup() from public, anon, authenticated;
revoke all on function public.persora__project_activity_notify() from public, anon, authenticated;
revoke all on function public.persora__project_field_assignment_notify() from public, anon, authenticated;
revoke all on function public.persora__project_comment_notify() from public, anon, authenticated;
revoke all on function public.persora__project_request_notify() from public, anon, authenticated;
revoke all on function public.persora__project_attachment_notify() from public, anon, authenticated;
revoke all on function public.persora__project_subtask_notify() from public, anon, authenticated;
revoke all on function public.persora_project_member_remove(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.persora_project_subtask_create(uuid, uuid, text, uuid) to service_role;
grant execute on function public.persora_project_subtask_update(uuid, uuid, jsonb) to service_role;
grant execute on function public.persora_project_subtask_reorder(uuid, uuid, uuid[]) to service_role;
grant execute on function public.persora_project_subtask_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_attachment_add(uuid, uuid, text, text, bigint, text) to service_role;
grant execute on function public.persora_project_attachment_delete(uuid, uuid) to service_role;
grant execute on function public.persora__project_overdue_notifications(uuid) to service_role;
grant execute on function public.persora__project_notifications_mark_read(uuid, uuid) to service_role;
grant execute on function public.persora__project_notification_preferences_save(uuid, jsonb) to service_role;
grant execute on function public.persora_project_member_remove(uuid, uuid, uuid) to service_role;

-- Existing service-role permissions for replaced RPCs are retained explicitly.
revoke all on function public.persora_project_field_update(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_field_update(uuid, uuid, jsonb) to service_role;
