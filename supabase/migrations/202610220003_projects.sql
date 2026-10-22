-- Persora Projects (2026-10-22)
-- Personal + shared projects with folders, fields (status/progress/assignee/due),
-- per-user pin & favourite reactions, comments, member invites, owner-granted
-- field creation with a request/approval workflow, and a project activity feed.
-- Every mutating operation runs through a security-definer function that checks
-- project access and the permission matrix server-side; direct table access from
-- anon/authenticated is revoked entirely. Non-members always get P0404 so project
-- existence is never leaked.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  kind text not null default 'personal' check (kind in ('personal', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects(owner_id);
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant all on public.projects to service_role;

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('editor', 'commenter', 'viewer')),
  can_create_fields boolean not null default false,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id);
alter table public.project_members enable row level security;
revoke all on public.project_members from anon, authenticated;
grant all on public.project_members to service_role;

create table if not exists public.project_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'cyan' check (color in ('cyan', 'purple', 'pink', 'blue', 'orange', 'green')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_folders_project_idx on public.project_folders(project_id);
alter table public.project_folders enable row level security;
revoke all on public.project_folders from anon, authenticated;
grant all on public.project_folders to service_role;

create table if not exists public.project_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid references public.project_folders(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'planning' check (status in ('planning', 'in-progress', 'in-review', 'blocked', 'completed')),
  progress integer not null default 0 check (progress between 0 and 100),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  creator_name text not null default '',
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_fields_project_status_idx on public.project_fields(project_id, status);
create index if not exists project_fields_project_folder_idx on public.project_fields(project_id, folder_id);
create index if not exists project_fields_creator_idx on public.project_fields(creator_id);
create index if not exists project_fields_project_updated_idx on public.project_fields(project_id, updated_at desc);
alter table public.project_fields enable row level security;
revoke all on public.project_fields from anon, authenticated;
grant all on public.project_fields to service_role;

create table if not exists public.project_field_reactions (
  field_id uuid not null references public.project_fields(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pinned boolean not null default false,
  favourite boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (field_id, user_id)
);
alter table public.project_field_reactions enable row level security;
revoke all on public.project_field_reactions from anon, authenticated;
grant all on public.project_field_reactions to service_role;

create table if not exists public.project_field_comments (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.project_fields(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_field_comments_field_idx on public.project_field_comments(field_id, created_at);
create index if not exists project_field_comments_project_idx on public.project_field_comments(project_id, created_at desc);
alter table public.project_field_comments enable row level security;
revoke all on public.project_field_comments from anon, authenticated;
grant all on public.project_field_comments to service_role;

create table if not exists public.project_field_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_name text not null default '',
  note text not null default '' check (char_length(note) <= 1000),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text not null default '' check (char_length(resolution_note) <= 1000),
  field_id uuid references public.project_fields(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists project_field_requests_project_status_idx on public.project_field_requests(project_id, status);
create index if not exists project_field_requests_requester_idx on public.project_field_requests(requester_id, created_at desc);
alter table public.project_field_requests enable row level security;
revoke all on public.project_field_requests from anon, authenticated;
grant all on public.project_field_requests to service_role;

create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  action text not null check (char_length(action) between 1 and 60),
  target text not null default '' check (char_length(target) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists project_activity_project_idx on public.project_activity(project_id, created_at desc);
alter table public.project_activity enable row level security;
revoke all on public.project_activity from anon, authenticated;
grant all on public.project_activity to service_role;

-- Private access helper: resolves the caller's relationship to a project.
-- Raises P0404 for missing projects AND for non-members so existence stays private.
create or replace function public.persora__project_access(
  p_user uuid,
  p_project uuid,
  out is_owner boolean,
  out member_role text,
  out can_create boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
begin
  select (p.owner_id = p_user) into is_owner from public.projects p where p.id = p_project;
  if not found then
    raise exception 'That project is not available.' using errcode = 'P0404';
  end if;
  member_role := null;
  can_create := false;
  if not is_owner then
    select m.role, m.can_create_fields into member_role, can_create
    from public.project_members m
    where m.project_id = p_project and m.user_id = p_user;
    if member_role is null then
      raise exception 'That project is not available.' using errcode = 'P0404';
    end if;
  end if;
end;
$function$;

create or replace function public.persora__project_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(nullif(trim(p.full_name), ''), p.email, 'A member') from public.profiles p where p.id = p_user
$function$;

create or replace function public.persora__project_log(p_project uuid, p_actor uuid, p_action text, p_target text default '')
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.project_activity (project_id, actor_id, actor_name, action, target)
  values (p_project, p_actor, public.persora__project_name(p_actor), p_action, coalesce(p_target, ''));
  -- Keep the feed bounded: retain at most ~120 days of activity per project.
  delete from public.project_activity where project_id = p_project and created_at < now() - interval '120 days';
end;
$function$;

create or replace function public.persora_project_create(p_user uuid, p_name text, p_description text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_project public.projects;
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  insert into public.projects (owner_id, name, description, kind)
  values (p_user, trim(coalesce(p_name, '')), coalesce(p_description, ''), coalesce(nullif(p_kind, ''), 'personal'))
  returning * into v_project;
  perform public.persora__project_log(v_project.id, p_user, 'project_created', v_project.name);
  return to_jsonb(v_project);
end;
$function$;

create or replace function public.persora_project_update(p_user uuid, p_project uuid, p_name text, p_description text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_project public.projects;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can edit these settings.' using errcode = 'P0403';
  end if;
  if p_kind = 'personal' and exists (select 1 from public.project_members m where m.project_id = p_project) then
    raise exception 'Remove every member before converting this project to Personal.' using errcode = 'P0409';
  end if;
  update public.projects
  set name = trim(coalesce(p_name, name)),
      description = coalesce(p_description, description),
      kind = coalesce(nullif(p_kind, ''), kind),
      updated_at = now()
  where id = p_project
  returning * into v_project;
  perform public.persora__project_log(p_project, p_user, 'project_updated', v_project.name);
  return to_jsonb(v_project);
end;
$function$;

create or replace function public.persora_project_delete(p_user uuid, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_name text;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can delete this project.' using errcode = 'P0403';
  end if;
  select p.name into v_name from public.projects p where p.id = p_project;
  delete from public.projects where id = p_project;
  return jsonb_build_object('ok', true, 'deleted', v_name);
end;
$function$;

create or replace function public.persora_project_member_add(p_user uuid, p_project uuid, p_recipient uuid, p_role text, p_can_create boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_member public.project_members;
  v_name text;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can manage members.' using errcode = 'P0403';
  end if;
  if exists (select 1 from public.projects p where p.id = p_project and p.kind <> 'shared') then
    raise exception 'Set this project to Shared before inviting members.' using errcode = 'P0409';
  end if;
  if p_recipient is null or p_recipient = p_user then
    raise exception 'Choose another Persora member to invite.' using errcode = 'P0400';
  end if;
  select public.persora__project_name(p_recipient) into v_name;
  insert into public.project_members (project_id, user_id, role, can_create_fields, invited_by)
  values (p_project, p_recipient, coalesce(nullif(p_role, ''), 'viewer'), coalesce(p_can_create, false), p_user)
  on conflict (project_id, user_id) do update
    set role = excluded.role, can_create_fields = excluded.can_create_fields, invited_by = excluded.invited_by, updated_at = now()
  returning * into v_member;
  perform public.persora__project_log(p_project, p_user, 'member_added', v_name);
  return to_jsonb(v_member);
end;
$function$;

create or replace function public.persora_project_member_update(p_user uuid, p_project uuid, p_member uuid, p_role text, p_can_create boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_member public.project_members;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can manage members.' using errcode = 'P0403';
  end if;
  update public.project_members
  set role = coalesce(nullif(p_role, ''), role),
      can_create_fields = coalesce(p_can_create, can_create_fields),
      updated_at = now()
  where project_id = p_project and user_id = p_member
  returning * into v_member;
  if not found then
    raise exception 'That member is not part of this project.' using errcode = 'P0404';
  end if;
  perform public.persora__project_log(p_project, p_user, 'member_updated', public.persora__project_name(p_member));
  return to_jsonb(v_member);
end;
$function$;

create or replace function public.persora_project_member_remove(p_user uuid, p_project uuid, p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_action text;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner and v_access.member_role is null and p_member <> p_user then
    raise exception 'That project is not available.' using errcode = 'P0404';
  end if;
  if not v_access.is_owner and p_member <> p_user then
    raise exception 'Only the project owner can remove members.' using errcode = 'P0403';
  end if;
  delete from public.project_members where project_id = p_project and user_id = p_member;
  if not found then
    raise exception 'That member is not part of this project.' using errcode = 'P0404';
  end if;
  v_action := case when p_member = p_user and not v_access.is_owner then 'member_left' else 'member_removed' end;
  perform public.persora__project_log(p_project, p_user, v_action, public.persora__project_name(p_member));
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_folder_create(p_user uuid, p_project uuid, p_name text, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_folder public.project_folders;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not (v_access.is_owner or (v_access.member_role = 'editor' and v_access.can_create)) then
    raise exception 'You do not have permission to create folders in this project.' using errcode = 'P0403';
  end if;
  insert into public.project_folders (project_id, name, color, created_by)
  values (p_project, trim(coalesce(p_name, '')), coalesce(nullif(p_color, ''), 'cyan'), p_user)
  returning * into v_folder;
  perform public.persora__project_log(p_project, p_user, 'folder_created', v_folder.name);
  return to_jsonb(v_folder);
end;
$function$;

create or replace function public.persora_project_folder_update(p_user uuid, p_folder uuid, p_name text, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_project uuid;
  v_access record;
  v_folder public.project_folders;
begin
  select f.project_id into v_project from public.project_folders f where f.id = p_folder;
  if v_project is null then
    raise exception 'That folder is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can rename or recolour folders.' using errcode = 'P0403';
  end if;
  update public.project_folders
  set name = trim(coalesce(p_name, name)), color = coalesce(nullif(p_color, ''), color), updated_at = now()
  where id = p_folder
  returning * into v_folder;
  perform public.persora__project_log(v_project, p_user, 'folder_updated', v_folder.name);
  return to_jsonb(v_folder);
end;
$function$;

create or replace function public.persora_project_folder_delete(p_user uuid, p_folder uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_project uuid;
  v_access record;
begin
  select f.project_id into v_project from public.project_folders f where f.id = p_folder;
  if v_project is null then
    raise exception 'That folder is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can delete folders.' using errcode = 'P0403';
  end if;
  delete from public.project_folders where id = p_folder;
  return jsonb_build_object('ok', true);
end;
$function$;

-- Shared field-payload applier used by create + update + request approval.
-- Validates folder/assignee belong to the project and normalises status/progress.
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
  v_progress integer;
  v_due date;
begin
  -- Key-presence semantics: an absent key keeps the current value, while an
  -- explicit empty value clears the column on nullable targets.
  v_folder := case when p_payload ? 'folder_id' then nullif(p_payload->>'folder_id', '')::uuid else p_field.folder_id end;
  v_assignee := case when p_payload ? 'assignee_id' then nullif(p_payload->>'assignee_id', '')::uuid else p_field.assignee_id end;
  v_due := case when p_payload ? 'due_date' then nullif(p_payload->>'due_date', '')::date else p_field.due_date end;
  if v_folder is not null and not exists (select 1 from public.project_folders fo where fo.id = v_folder and fo.project_id = p_project) then
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
  v_progress := coalesce(nullif(p_payload->>'progress', '')::integer, p_field.progress, case when v_status = 'completed' then 100 else 0 end);
  v_progress := greatest(0, least(100, v_progress));
  if v_status = 'completed' then v_progress := 100; end if;
  p_field.title := coalesce(nullif(trim(p_payload->>'title'), ''), p_field.title);
  -- New records start with NULL description/title; never let a NOT NULL column
  -- receive NULL when the payload omits the key.
  p_field.description := coalesce(p_payload->>'description', p_field.description, '');
  p_field.folder_id := v_folder;
  p_field.status := v_status;
  p_field.progress := v_progress;
  p_field.assignee_id := v_assignee;
  p_field.due_date := v_due;
  return p_field;
end;
$function$;

create or replace function public.persora_project_field_create(p_user uuid, p_project uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_field public.project_fields;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not (v_access.is_owner or (v_access.member_role = 'editor' and v_access.can_create)) then
    raise exception 'Adding fields needs the project owner or the team field-creation grant. Send a request instead.' using errcode = 'P0403';
  end if;
  if coalesce(trim(p_payload->>'title'), '') = '' then
    raise exception 'Give this field a title.' using errcode = 'P0400';
  end if;
  v_field.id := gen_random_uuid();
  v_field.title := trim(p_payload->>'title');
  v_field := public.persora__project_field_apply(v_field, p_project, p_payload - 'title');
  insert into public.project_fields (id, project_id, folder_id, title, description, status, progress, creator_id, creator_name, assignee_id, due_date)
  values (v_field.id, p_project, v_field.folder_id, v_field.title, v_field.description, v_field.status, v_field.progress, p_user, public.persora__project_name(p_user), v_field.assignee_id, v_field.due_date)
  returning * into v_field;
  perform public.persora__project_log(p_project, p_user, 'field_created', v_field.title);
  return to_jsonb(v_field);
end;
$function$;

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
  if not found then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  -- Strict ownership: exactly the project owner or the field's creator may edit.
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can edit it.' using errcode = 'P0403';
  end if;
  v_old_status := v_field.status;
  v_field := public.persora__project_field_apply(v_field, v_field.project_id, p_payload);
  update public.project_fields
  set folder_id = v_field.folder_id, title = v_field.title, description = v_field.description,
      status = v_field.status, progress = v_field.progress, assignee_id = v_field.assignee_id,
      due_date = v_field.due_date, updated_at = now()
  where id = p_field
  returning * into v_field;
  if v_field.status is distinct from v_old_status then
    perform public.persora__project_log(v_field.project_id, p_user, 'field_status_changed', v_field.title || ' → ' || v_field.status);
  else
    perform public.persora__project_log(v_field.project_id, p_user, 'field_updated', v_field.title);
  end if;
  return to_jsonb(v_field);
end;
$function$;

create or replace function public.persora_project_field_delete(p_user uuid, p_field uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_field public.project_fields;
  v_access record;
begin
  select * into v_field from public.project_fields f where f.id = p_field;
  if not found then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can delete it.' using errcode = 'P0403';
  end if;
  delete from public.project_fields where id = p_field;
  perform public.persora__project_log(v_field.project_id, p_user, 'field_deleted', v_field.title);
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_field_react(p_user uuid, p_field uuid, p_pinned boolean, p_favourite boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_project uuid;
  v_access record;
  v_reaction public.project_field_reactions;
begin
  select f.project_id into v_project from public.project_fields f where f.id = p_field;
  if v_project is null then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_project);
  insert into public.project_field_reactions (field_id, user_id, pinned, favourite)
  values (p_field, p_user, coalesce(p_pinned, false), coalesce(p_favourite, false))
  on conflict (field_id, user_id) do update
    set pinned = excluded.pinned, favourite = excluded.favourite, updated_at = now()
  returning * into v_reaction;
  return to_jsonb(v_reaction);
end;
$function$;

create or replace function public.persora_project_comment_add(p_user uuid, p_field uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_project uuid;
  v_comment public.project_field_comments;
  v_title text;
begin
  select f.project_id, f.title into v_project, v_title from public.project_fields f where f.id = p_field;
  if v_project is null then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_project);
  insert into public.project_field_comments (field_id, project_id, author_id, author_name, body)
  values (p_field, v_project, p_user, public.persora__project_name(p_user), trim(coalesce(p_body, '')))
  returning * into v_comment;
  perform public.persora__project_log(v_project, p_user, 'comment_added', v_title);
  return to_jsonb(v_comment);
end;
$function$;

create or replace function public.persora_project_comment_update(p_user uuid, p_comment uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_comment public.project_field_comments;
begin
  select * into v_comment from public.project_field_comments c where c.id = p_comment;
  if not found then
    raise exception 'That comment is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_comment.project_id);
  if v_comment.author_id <> p_user then
    raise exception 'Only the comment author can edit it.' using errcode = 'P0403';
  end if;
  update public.project_field_comments set body = trim(coalesce(p_body, '')), updated_at = now()
  where id = p_comment
  returning * into v_comment;
  return to_jsonb(v_comment);
end;
$function$;

create or replace function public.persora_project_comment_delete(p_user uuid, p_comment uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_comment public.project_field_comments;
  v_access record;
begin
  select * into v_comment from public.project_field_comments c where c.id = p_comment;
  if not found then
    raise exception 'That comment is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_comment.project_id);
  -- Authors can delete their own comments; the project owner moderates everything.
  if not (v_access.is_owner or v_comment.author_id = p_user) then
    raise exception 'Only the comment author or the project owner can delete it.' using errcode = 'P0403';
  end if;
  delete from public.project_field_comments where id = p_comment;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_field_request(p_user uuid, p_project uuid, p_payload jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_request public.project_field_requests;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if v_access.is_owner or (v_access.member_role = 'editor' and v_access.can_create) then
    raise exception 'You already have permission to create fields directly.' using errcode = 'P0409';
  end if;
  if coalesce(trim(p_payload->>'title'), '') = '' then
    raise exception 'Give the requested field a title.' using errcode = 'P0400';
  end if;
  insert into public.project_field_requests (project_id, requester_id, requester_name, note, payload)
  values (p_project, p_user, public.persora__project_name(p_user), trim(coalesce(p_note, '')), p_payload)
  returning * into v_request;
  perform public.persora__project_log(p_project, p_user, 'field_requested', trim(p_payload->>'title'));
  return to_jsonb(v_request);
end;
$function$;

create or replace function public.persora_project_field_request_cancel(p_user uuid, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.project_field_requests;
begin
  select * into v_request from public.project_field_requests r where r.id = p_request;
  if not found then
    raise exception 'That request is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_request.project_id);
  if v_request.requester_id <> p_user then
    raise exception 'Only the requester can withdraw this request.' using errcode = 'P0403';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0409';
  end if;
  delete from public.project_field_requests where id = p_request;
  perform public.persora__project_log(v_request.project_id, p_user, 'field_request_withdrawn', coalesce(v_request.payload->>'title', 'Field request'));
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.persora_project_field_request_resolve(p_user uuid, p_request uuid, p_decision text, p_resolution_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request public.project_field_requests;
  v_access record;
  v_field public.project_fields;
  v_title text;
begin
  select * into v_request from public.project_field_requests r where r.id = p_request;
  if not found then
    raise exception 'That request is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_request.project_id);
  if not v_access.is_owner then
    raise exception 'Only the project owner can review field requests.' using errcode = 'P0403';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0409';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject for this request.' using errcode = 'P0400';
  end if;
  v_title := trim(coalesce(v_request.payload->>'title', ''));
  if p_decision = 'approved' then
    v_field.id := gen_random_uuid();
    v_field.title := v_title;
    v_field := public.persora__project_field_apply(v_field, v_request.project_id, v_request.payload - 'title');
    insert into public.project_fields (id, project_id, folder_id, title, description, status, progress, creator_id, creator_name, assignee_id, due_date)
    values (v_field.id, v_request.project_id, v_field.folder_id, v_field.title, v_field.description, v_field.status, v_field.progress, v_request.requester_id, coalesce(v_request.requester_name, ''), v_field.assignee_id, v_field.due_date)
    returning * into v_field;
  end if;
  update public.project_field_requests
  set status = p_decision, resolved_by = p_user, resolution_note = trim(coalesce(p_resolution_note, '')),
      resolved_at = now(), field_id = case when p_decision = 'approved' then v_field.id else null end
  where id = p_request
  returning * into v_request;
  perform public.persora__project_log(v_request.project_id, p_user, 'field_request_' || p_decision, v_title);
  return jsonb_build_object('request', to_jsonb(v_request), 'field', case when p_decision = 'approved' then to_jsonb(v_field) else null end);
end;
$function$;

revoke all on function public.persora__project_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora__project_name(uuid) from public, anon, authenticated;
revoke all on function public.persora__project_log(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.persora__project_field_apply(public.project_fields, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_project_create(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.persora_project_update(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.persora_project_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_member_add(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.persora_project_member_update(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.persora_project_member_remove(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_folder_create(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.persora_project_folder_update(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.persora_project_folder_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_field_create(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_project_field_update(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_project_field_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_field_react(uuid, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.persora_project_comment_add(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.persora_project_comment_update(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.persora_project_comment_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_field_request(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.persora_project_field_request_cancel(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_project_field_request_resolve(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.persora__project_access(uuid, uuid) to service_role;
grant execute on function public.persora__project_name(uuid) to service_role;
grant execute on function public.persora__project_log(uuid, uuid, text, text) to service_role;
grant execute on function public.persora__project_field_apply(public.project_fields, uuid, jsonb) to service_role;
grant execute on function public.persora_project_create(uuid, text, text, text) to service_role;
grant execute on function public.persora_project_update(uuid, uuid, text, text, text) to service_role;
grant execute on function public.persora_project_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_member_add(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.persora_project_member_update(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.persora_project_member_remove(uuid, uuid, uuid) to service_role;
grant execute on function public.persora_project_folder_create(uuid, uuid, text, text) to service_role;
grant execute on function public.persora_project_folder_update(uuid, uuid, text, text) to service_role;
grant execute on function public.persora_project_folder_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_field_create(uuid, uuid, jsonb) to service_role;
grant execute on function public.persora_project_field_update(uuid, uuid, jsonb) to service_role;
grant execute on function public.persora_project_field_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_field_react(uuid, uuid, boolean, boolean) to service_role;
grant execute on function public.persora_project_comment_add(uuid, uuid, text) to service_role;
grant execute on function public.persora_project_comment_update(uuid, uuid, text) to service_role;
grant execute on function public.persora_project_comment_delete(uuid, uuid) to service_role;
grant execute on function public.persora_project_field_request(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.persora_project_field_request_cancel(uuid, uuid) to service_role;
grant execute on function public.persora_project_field_request_resolve(uuid, uuid, text, text) to service_role;
