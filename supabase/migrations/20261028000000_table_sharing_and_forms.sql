-- Persora Table Sharing & Standalone Persora Forms Module
-- 1. Member-to-member table sharing (view / comment / edit), public link sharing
--    (viewer / commenter with token rotation & revocation), and cell/thread comments.
-- 2. Standalone Persora Forms module (forms, image-only R2 assets, responses,
--    quiz scoring, and atomic event registration capacity enforcement).
-- All RLS policies strictly use public.persora_jwt_uid() and never raw auth.uid().

-- ============================================================================
-- PART 1: PERSORA TABLE SHARING
-- ============================================================================

create table if not exists public.table_shares (
  id uuid not null default gen_random_uuid(),
  table_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null,
  permission text not null default 'view'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint table_shares_pkey primary key (id),
  constraint table_shares_table_id_fkey foreign key (table_id) references public.persora_tables(id) on delete cascade,
  constraint table_shares_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint table_shares_recipient_id_fkey foreign key (recipient_id) references public.profiles(id) on delete cascade,
  constraint table_shares_unique unique (table_id, recipient_id),
  constraint table_shares_no_self check (owner_id <> recipient_id),
  constraint table_shares_permission_check check (permission = any (array['view'::text, 'comment'::text, 'edit'::text]))
);

create index if not exists table_shares_recipient_idx on public.table_shares using btree (recipient_id, updated_at desc);
create index if not exists table_shares_owner_table_idx on public.table_shares using btree (owner_id, table_id);

alter table public.table_shares enable row level security;
drop policy if exists table_shares_select_policy on public.table_shares;
create policy table_shares_select_policy on public.table_shares
  for select
  to authenticated
  using (owner_id = public.persora_jwt_uid() or recipient_id = public.persora_jwt_uid());
drop policy if exists table_shares_owner_write_policy on public.table_shares;
create policy table_shares_owner_write_policy on public.table_shares
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.table_shares from public, anon, authenticated;
grant all on public.table_shares to service_role;

create table if not exists public.table_share_links (
  table_id uuid not null,
  owner_id uuid not null,
  share_token text not null,
  enabled boolean not null default false,
  permission text not null default 'view'::text,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint table_share_links_pkey primary key (table_id),
  constraint table_share_links_table_id_fkey foreign key (table_id) references public.persora_tables(id) on delete cascade,
  constraint table_share_links_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint table_share_links_token_unique unique (share_token),
  constraint table_share_links_token_format check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'::text),
  constraint table_share_links_permission_check check (permission = any (array['view'::text, 'comment'::text]))
);

create index if not exists table_share_links_owner_idx on public.table_share_links using btree (owner_id);

alter table public.table_share_links enable row level security;
drop policy if exists table_share_links_owner_policy on public.table_share_links;
create policy table_share_links_owner_policy on public.table_share_links
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.table_share_links from public, anon, authenticated;
grant all on public.table_share_links to service_role;

create table if not exists public.table_comments (
  id uuid not null default gen_random_uuid(),
  table_id uuid not null,
  owner_id uuid not null,
  author_id uuid,
  author_name text not null,
  target_kind text not null default 'table'::text,
  sheet_id uuid,
  cell_ref text,
  record_id uuid,
  body text not null,
  created_at timestamp with time zone not null default now(),
  constraint table_comments_pkey primary key (id),
  constraint table_comments_table_id_fkey foreign key (table_id) references public.persora_tables(id) on delete cascade,
  constraint table_comments_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint table_comments_author_id_fkey foreign key (author_id) references public.profiles(id) on delete set null,
  constraint table_comments_author_name_check check (char_length(btrim(author_name)) >= 1 and char_length(btrim(author_name)) <= 80),
  constraint table_comments_target_kind_check check (target_kind = any (array['table'::text, 'cell'::text, 'record'::text])),
  constraint table_comments_cell_ref_check check (cell_ref is null or char_length(cell_ref) <= 24),
  constraint table_comments_body_check check (char_length(btrim(body)) >= 1 and char_length(btrim(body)) <= 2000)
);

create index if not exists table_comments_table_idx on public.table_comments using btree (table_id, created_at asc);

alter table public.table_comments enable row level security;
drop policy if exists table_comments_member_select_policy on public.table_comments;
create policy table_comments_member_select_policy on public.table_comments
  for select
  to authenticated
  using (
    owner_id = public.persora_jwt_uid()
    or exists (
      select 1 from public.table_shares s
      where s.table_id = table_comments.table_id
        and s.recipient_id = public.persora_jwt_uid()
    )
  );
drop policy if exists table_comments_owner_write_policy on public.table_comments;
create policy table_comments_owner_write_policy on public.table_comments
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid() or author_id = public.persora_jwt_uid())
  with check (
    owner_id = public.persora_jwt_uid()
    or exists (
      select 1 from public.table_shares s
      where s.table_id = table_comments.table_id
        and s.recipient_id = public.persora_jwt_uid()
        and s.permission = any (array['comment'::text, 'edit'::text])
    )
  );
revoke all on public.table_comments from public, anon, authenticated;
grant all on public.table_comments to service_role;

-- Internal access resolver for Persora Tables (closed to all API roles; called by security-definer RPCs).
create or replace function public.persora_table_access(p_actor uuid, p_table_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_owner public.profiles%rowtype;
  v_share public.table_shares%rowtype;
  v_owner_name text;
begin
  if p_actor is null or p_table_id is null then
    return null;
  end if;
  select * into v_table from public.persora_tables where id = p_table_id;
  if v_table.id is null then
    return null;
  end if;
  if v_table.user_id = p_actor then
    return jsonb_build_object(
      'role', 'owner',
      'shared', false,
      'owner_id', v_table.user_id,
      'share_id', null,
      'owner_name', null,
      'owner_login_id', null
    );
  end if;
  select * into v_share
  from public.table_shares
  where table_id = p_table_id and recipient_id = p_actor;
  if v_share.id is null then
    return null;
  end if;
  select * into v_owner from public.profiles where id = v_table.user_id and account_status = 'active';
  if v_owner.id is null then
    return null;
  end if;
  v_owner_name := coalesce(nullif(btrim(v_owner.full_name), ''), split_part(v_owner.email, '@', 1), 'Persora Member');
  return jsonb_build_object(
    'role', v_share.permission,
    'shared', true,
    'owner_id', v_table.user_id,
    'share_id', v_share.id,
    'owner_name', v_owner_name,
    'owner_login_id', v_owner.login_id
  );
end;
$function$;
revoke all on function public.persora_table_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_table_access(uuid, uuid) from service_role;

create or replace function public.persora_tables_list(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with visible as (
    select
      public.persora_table_summary(t) || jsonb_build_object(
        'shared', false,
        'has_shares', (
          exists (select 1 from public.table_shares ts where ts.table_id = t.id)
          or exists (select 1 from public.table_share_links tsl where tsl.table_id = t.id and tsl.enabled = true)
        ),
        'permission', 'owner'
      ) as item,
      t.updated_at as sort_at
    from public.persora_tables t
    where t.user_id = p_owner
    union all
    select
      (public.persora_table_summary(t) || jsonb_build_object(
        'starred', false,
        'shared', true,
        'has_shares', true,
        'permission', s.permission,
        'share_id', s.id,
        'owner_id', t.user_id,
        'owner_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
        'owner_login_id', p.login_id
      )) as item,
      greatest(t.updated_at, s.updated_at) as sort_at
    from public.table_shares s
    join public.persora_tables t on t.id = s.table_id
    join public.profiles p on p.id = t.user_id and p.account_status = 'active'
    where s.recipient_id = p_owner
  )
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb) from visible;
$function$;
revoke all on function public.persora_tables_list(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_tables_list(p_owner uuid) to service_role;

create or replace function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_table public.persora_tables%rowtype;
  v_summary jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if p_touch and v_role = 'owner' then
    update public.persora_tables set opened_at = clock_timestamp() where id = p_id and user_id = p_owner returning * into v_table;
  else
    select * into v_table from public.persora_tables where id = p_id;
  end if;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  v_summary := public.persora_table_summary(v_table) || jsonb_build_object(
    'meta', v_table.meta,
    'shared', coalesce((v_access ->> 'shared')::boolean, false),
    'permission', v_role
  );
  if coalesce((v_access ->> 'shared')::boolean, false) then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;
  return jsonb_build_object(
    'table', v_summary,
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.position, s.id) from public.persora_table_sheets s where s.table_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.position, r.created_at, r.id) from public.persora_table_records r where r.table_id = p_id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at) from public.persora_table_attachments a where a.table_id = p_id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'author_name', c.author_name, 'target_kind', c.target_kind, 'sheet_id', c.sheet_id, 'cell_ref', c.cell_ref, 'record_id', c.record_id, 'body', c.body, 'created_at', c.created_at) order by c.created_at, c.id) from public.table_comments c where c.table_id = p_id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean) from public, anon, authenticated;
grant execute on function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean) to service_role;

create or replace function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_table public.persora_tables%rowtype;
  v_summary jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  select * into v_table from public.persora_tables where id = p_id;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  v_summary := public.persora_table_summary(v_table)
    || jsonb_build_object('shared', coalesce((v_access ->> 'shared')::boolean, false), 'permission', v_access ->> 'role')
    || case when p_meta then jsonb_build_object('meta', v_table.meta) else '{}'::jsonb end;
  if coalesce((v_access ->> 'shared')::boolean, false) then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;
  return v_summary;
end;
$function$;
revoke all on function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean) from public, anon, authenticated;
grant execute on function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean) to service_role;

create or replace function public.persora_table_save(
  p_owner uuid,
  p_id uuid,
  p_base bigint,
  p_batch uuid,
  p_meta jsonb,
  p_sheet_upserts jsonb,
  p_sheet_deletes jsonb,
  p_record_upserts jsonb,
  p_record_deletes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_true_owner uuid;
  v_table public.persora_tables%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sheet_ids uuid[];
  v_record_ids uuid[];
  v_summary jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if v_role not in ('owner', 'edit') then
    raise exception 'You do not have edit permission for this shared table.' using errcode = 'P0403';
  end if;

  select * into v_table from public.persora_tables where id = p_id for update;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  v_true_owner := v_table.user_id;

  if v_table.last_batch_id = p_batch then
    v_summary := public.persora_table_summary(v_table) || jsonb_build_object('shared', v_role <> 'owner', 'permission', v_role);
    return jsonb_build_object('ok', true, 'replayed', true, 'table', v_summary);
  end if;
  if v_table.revision <> p_base then
    v_summary := public.persora_table_summary(v_table) || jsonb_build_object('shared', v_role <> 'owner', 'permission', v_role);
    return jsonb_build_object('ok', false, 'conflict', true, 'table', v_summary);
  end if;
  if v_table.kind = 'spreadsheet' and (p_meta is not null or jsonb_array_length(coalesce(p_record_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_record_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Spreadsheets don''t have fields or records.' using errcode = 'P0422';
  end if;
  if v_table.kind = 'smart' and (jsonb_array_length(coalesce(p_sheet_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheet_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Smart Tables don''t have sheets.' using errcode = 'P0422';
  end if;

  select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_sheet_ids from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s;
  select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_record_ids from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r;
  if exists (select 1 from public.persora_table_sheets where id = any(v_sheet_ids) and table_id <> p_id)
     or exists (select 1 from public.persora_table_records where id = any(v_record_ids) and table_id <> p_id) then
    raise exception 'That change refers to data from another table.' using errcode = 'P0403';
  end if;

  delete from public.persora_table_sheets where table_id = p_id and id = any(public.persora_table_uuid_array(p_sheet_deletes));
  insert into public.persora_table_sheets as current (id, table_id, user_id, position, name, data, updated_at)
  select (s ->> 'id')::uuid, p_id, v_true_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data', v_now
  from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s
  on conflict (id) do update set position = excluded.position, name = excluded.name, data = excluded.data, updated_at = v_now
  where current.table_id = p_id;

  delete from public.persora_table_records where table_id = p_id and id = any(public.persora_table_uuid_array(p_record_deletes));
  insert into public.persora_table_records as current (id, table_id, user_id, position, "values", is_example, updated_at)
  select (r ->> 'id')::uuid, p_id, v_true_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false), v_now
  from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r
  on conflict (id) do update set position = excluded.position, "values" = excluded."values", is_example = excluded.is_example, updated_at = v_now
  where current.table_id = p_id;

  update public.persora_tables
  set meta = coalesce(p_meta, meta), revision = revision + 1, last_batch_id = p_batch, updated_at = v_now
  where id = p_id;
  v_table := public.persora_table_refresh_stats(p_id);
  v_summary := public.persora_table_summary(v_table) || jsonb_build_object('shared', v_role <> 'owner', 'permission', v_role);
  if v_role <> 'owner' then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'table', v_summary);
end;
$function$;
revoke all on function public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb) to service_role;

create or replace function public.persora_table_attachment_add(
  p_owner uuid,
  p_table uuid,
  p_id uuid,
  p_key text,
  p_name text,
  p_type text,
  p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_true_owner uuid;
  v_row public.persora_table_attachments%rowtype;
begin
  v_access := public.persora_table_access(p_owner, p_table);
  if v_access is null then
    raise exception 'That Smart Table is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if v_role not in ('owner', 'edit') then
    raise exception 'You do not have edit permission for this shared table.' using errcode = 'P0403';
  end if;
  v_true_owner := (v_access ->> 'owner_id')::uuid;
  if not exists (select 1 from public.persora_tables where id = p_table and user_id = v_true_owner and kind = 'smart') then
    raise exception 'That Smart Table is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_table_attachments where table_id = p_table) >= 500 then
    raise exception 'This table already has 500 attached files.' using errcode = 'P0409';
  end if;
  insert into public.persora_table_attachments (table_id, id, user_id, file_key, file_name, file_type, file_size)
  values (p_table, p_id, v_true_owner, p_key, p_name, p_type, p_size)
  on conflict (table_id, id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.persora_table_attachments where table_id = p_table and id = p_id and user_id = v_true_owner and file_key = p_key;
    if v_row.id is null then
      raise exception 'That file id is already in use.' using errcode = 'P0409';
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'created_at', v_row.created_at);
end;
$function$;
revoke all on function public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint) from public, anon, authenticated;
grant execute on function public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint) to service_role;

create or replace function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_row public.persora_table_attachments%rowtype;
begin
  v_access := public.persora_table_access(p_owner, p_table);
  if v_access is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  select a.* into v_row
  from public.persora_table_attachments a
  join public.persora_tables t on t.id = a.table_id
  where a.table_id = p_table and a.id = p_id and a.user_id = t.user_id;
  if v_row.id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object('id', v_row.id, 'file_key', v_row.file_key, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'owner_id', v_row.user_id);
end;
$function$;
revoke all on function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid) to service_role;

create or replace function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_keys jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_table);
  if v_access is null or (v_access ->> 'role') not in ('owner', 'edit') then
    return '[]'::jsonb;
  end if;
  with removed as (
    delete from public.persora_table_attachments
    where table_id = p_table and created_at < p_before
      and not (id = any(public.persora_table_uuid_array(p_keep)))
    returning file_key
  )
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys from removed;
  return v_keys;
end;
$function$;
revoke all on function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone) from public, anon, authenticated;
grant execute on function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone) to service_role;

create or replace function public.persora_table_people(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with my_projects as (
    select id from public.projects where owner_id = p_owner
    union select project_id from public.project_members where user_id = p_owner
  ), linked as (
    select p_owner as id
    union select pm.user_id from public.project_members pm where pm.project_id in (select id from my_projects)
    union select pr.owner_id from public.projects pr where pr.id in (select id from my_projects)
    union select recipient_id from public.record_shares where owner_id = p_owner
    union select owner_id from public.record_shares where recipient_id = p_owner
    union select recipient_id from public.vault_shares where owner_id = p_owner
    union select owner_id from public.vault_shares where recipient_id = p_owner
    union select recipient_id from public.table_shares where owner_id = p_owner
    union select owner_id from public.table_shares where recipient_id = p_owner
  ), people as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Member') as name
    from public.profiles p
    where p.id in (select id from linked) and (p.id = p_owner or p.account_status = 'active')
    limit 500
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'me', id = p_owner) order by (id <> p_owner), lower(name)), '[]'::jsonb) from people;
$function$;
revoke all on function public.persora_table_people(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_table_people(p_owner uuid) to service_role;

create or replace function public.persora_table_sharing_get(p_owner uuid, p_table_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_link public.table_share_links%rowtype;
begin
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can manage sharing.' using errcode = 'P0404';
  end if;
  select * into v_link from public.table_share_links where table_id = p_table_id and owner_id = p_owner;
  return jsonb_build_object(
    'table_id', v_table.id,
    'table_name', v_table.name,
    'shares', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'recipient_id', s.recipient_id,
          'recipient_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
          'recipient_login_id', p.login_id,
          'recipient_email', p.email,
          'permission', s.permission,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        order by s.created_at asc
      )
      from public.table_shares s
      join public.profiles p on p.id = s.recipient_id
      where s.table_id = p_table_id and s.owner_id = p_owner
    ), '[]'::jsonb),
    'link', case
      when v_link.table_id is null then jsonb_build_object('enabled', false, 'permission', 'view', 'share_token', null, 'updated_at', null)
      else jsonb_build_object(
        'enabled', v_link.enabled and v_link.revoked_at is null,
        'permission', v_link.permission,
        'share_token', case when v_link.enabled and v_link.revoked_at is null then v_link.share_token else null end,
        'updated_at', v_link.updated_at
      )
    end
  );
end;
$function$;
revoke all on function public.persora_table_sharing_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_table_sharing_get(uuid, uuid) to service_role;

create or replace function public.persora_table_share_upsert(
  p_owner uuid,
  p_table_id uuid,
  p_recipient uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_recipient public.profiles%rowtype;
  v_existing public.table_shares%rowtype;
  v_share public.table_shares%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_permission not in ('view', 'comment', 'edit') then
    raise exception 'Choose a valid permission (view, comment, or edit).' using errcode = 'P0422';
  end if;
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can share this table.' using errcode = 'P0404';
  end if;
  if p_recipient = p_owner then
    raise exception 'You already own this table.' using errcode = 'P0422';
  end if;
  select * into v_recipient from public.profiles where id = p_recipient and account_status = 'active';
  if v_recipient.id is null then
    raise exception 'Choose an active Persora member.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.table_shares where table_id = p_table_id) >= 100 then
    raise exception 'A table can be shared directly with up to 100 members.' using errcode = 'P0409';
  end if;
  select * into v_existing from public.table_shares where table_id = p_table_id and recipient_id = p_recipient;
  insert into public.table_shares (table_id, owner_id, recipient_id, permission, created_at, updated_at)
  values (p_table_id, p_owner, p_recipient, p_permission, v_now, v_now)
  on conflict (table_id, recipient_id) do update
  set permission = excluded.permission, updated_at = v_now
  returning * into v_share;

  return jsonb_build_object(
    'created', v_existing.id is null,
    'previous_permission', v_existing.permission,
    'table_name', v_table.name,
    'share', jsonb_build_object(
      'id', v_share.id,
      'recipient_id', v_share.recipient_id,
      'recipient_name', coalesce(nullif(btrim(v_recipient.full_name), ''), split_part(v_recipient.email, '@', 1), 'Persora Member'),
      'recipient_login_id', v_recipient.login_id,
      'recipient_email', v_recipient.email,
      'permission', v_share.permission,
      'created_at', v_share.created_at,
      'updated_at', v_share.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_table_share_upsert(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_table_share_upsert(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_table_share_update(
  p_owner uuid,
  p_table_id uuid,
  p_share_id uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_share public.table_shares%rowtype;
  v_recipient public.profiles%rowtype;
begin
  if p_permission not in ('view', 'comment', 'edit') then
    raise exception 'Choose a valid permission (view, comment, or edit).' using errcode = 'P0422';
  end if;
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can update sharing permissions.' using errcode = 'P0404';
  end if;
  update public.table_shares
  set permission = p_permission, updated_at = clock_timestamp()
  where id = p_share_id and table_id = p_table_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  select * into v_recipient from public.profiles where id = v_share.recipient_id;
  return jsonb_build_object(
    'table_name', v_table.name,
    'share', jsonb_build_object(
      'id', v_share.id,
      'recipient_id', v_share.recipient_id,
      'recipient_name', coalesce(nullif(btrim(v_recipient.full_name), ''), split_part(v_recipient.email, '@', 1), 'Persora Member'),
      'recipient_login_id', v_recipient.login_id,
      'recipient_email', v_recipient.email,
      'permission', v_share.permission,
      'created_at', v_share.created_at,
      'updated_at', v_share.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_table_share_update(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_table_share_update(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_table_share_revoke(
  p_owner uuid,
  p_table_id uuid,
  p_share_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_share public.table_shares%rowtype;
begin
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can revoke sharing.' using errcode = 'P0404';
  end if;
  delete from public.table_shares
  where id = p_share_id and table_id = p_table_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'ok', true,
    'recipient_id', v_share.recipient_id,
    'table_name', v_table.name
  );
end;
$function$;
revoke all on function public.persora_table_share_revoke(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_table_share_revoke(uuid, uuid, uuid) to service_role;

create or replace function public.persora_table_link_configure(
  p_owner uuid,
  p_table_id uuid,
  p_enabled boolean,
  p_permission text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_existing public.table_share_links%rowtype;
  v_link public.table_share_links%rowtype;
  v_perm text := coalesce(p_permission, 'view');
  v_token text;
  v_now timestamptz := clock_timestamp();
begin
  if v_perm not in ('view', 'comment') then
    raise exception 'Public link permission must be view or comment.' using errcode = 'P0422';
  end if;
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can configure link sharing.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.table_share_links where table_id = p_table_id and owner_id = p_owner;
  v_token := coalesce(nullif(btrim(p_token), ''), v_existing.share_token);
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'A valid share token is required.' using errcode = 'P0422';
  end if;

  insert into public.table_share_links (table_id, owner_id, share_token, enabled, permission, revoked_at, created_at, updated_at)
  values (p_table_id, p_owner, v_token, coalesce(p_enabled, false), v_perm, case when coalesce(p_enabled, false) then null else v_now end, v_now, v_now)
  on conflict (table_id) do update
  set share_token = excluded.share_token,
      enabled = excluded.enabled,
      permission = excluded.permission,
      revoked_at = case when excluded.enabled then null else v_now end,
      updated_at = v_now
  returning * into v_link;

  return jsonb_build_object(
    'enabled', v_link.enabled and v_link.revoked_at is null,
    'permission', v_link.permission,
    'share_token', case when v_link.enabled and v_link.revoked_at is null then v_link.share_token else null end,
    'updated_at', v_link.updated_at
  );
end;
$function$;
revoke all on function public.persora_table_link_configure(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.persora_table_link_configure(uuid, uuid, boolean, text, text) to service_role;

create or replace function public.persora_table_public_get(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.table_share_links%rowtype;
  v_table public.persora_tables%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.table_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.table_id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select * into v_table from public.persora_tables where id = v_link.table_id;
  if v_table.id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'permission', v_link.permission,
    'table', jsonb_build_object(
      'id', v_table.id,
      'kind', v_table.kind,
      'name', v_table.name,
      'revision', v_table.revision,
      'sheet_count', v_table.sheet_count,
      'record_count', v_table.record_count,
      'updated_at', v_table.updated_at,
      'meta', v_table.meta
    ),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.position, s.id) from public.persora_table_sheets s where s.table_id = v_table.id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.position, r.created_at, r.id) from public.persora_table_records r where r.table_id = v_table.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at) from public.persora_table_attachments a where a.table_id = v_table.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author_name', c.author_name, 'target_kind', c.target_kind, 'sheet_id', c.sheet_id, 'cell_ref', c.cell_ref, 'record_id', c.record_id, 'body', c.body, 'created_at', c.created_at) order by c.created_at, c.id) from public.table_comments c where c.table_id = v_table.id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_table_public_get(text) from public, anon, authenticated;
grant execute on function public.persora_table_public_get(text) to service_role;

create or replace function public.persora_table_public_attachment_get(p_token text, p_att_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.table_share_links%rowtype;
  v_row public.persora_table_attachments%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.table_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.table_id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  select * into v_row from public.persora_table_attachments where table_id = v_link.table_id and id = p_att_id;
  if v_row.id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object('id', v_row.id, 'file_key', v_row.file_key, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'owner_id', v_row.user_id);
end;
$function$;
revoke all on function public.persora_table_public_attachment_get(text, uuid) from public, anon, authenticated;
grant execute on function public.persora_table_public_attachment_get(text, uuid) to service_role;

-- Comment-only sheet mutation: updates ONLY the `comments` map of a spreadsheet sheet,
-- never altering cells, formulas, formatting, merges, charts, or sheet dimensions.
create or replace function public.persora_table_cell_comment_write(
  p_actor uuid,
  p_token text,
  p_table_id uuid,
  p_sheet_id uuid,
  p_cell_key text,
  p_comment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_link public.table_share_links%rowtype;
  v_target_table_id uuid;
  v_role text;
  v_table public.persora_tables%rowtype;
  v_sheet public.persora_table_sheets%rowtype;
  v_comments jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_token is not null and btrim(p_token) <> '' then
    select l.* into v_link
    from public.table_share_links l
    join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
    where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
    if v_link.table_id is null then
      raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
    end if;
    if v_link.permission <> 'comment' then
      raise exception 'Commenting is disabled for this shared link.' using errcode = 'P0403';
    end if;
    if p_comment is null then
      raise exception 'Public commenters can add comments but cannot delete existing comments.' using errcode = 'P0403';
    end if;
    v_target_table_id := v_link.table_id;
    v_role := 'comment';
  else
    v_access := public.persora_table_access(p_actor, p_table_id);
    if v_access is null then
      raise exception 'That table is not available in your account.' using errcode = 'P0404';
    end if;
    v_role := v_access ->> 'role';
    if v_role not in ('owner', 'edit', 'comment') then
      raise exception 'You only have view access to this shared table.' using errcode = 'P0403';
    end if;
    if p_comment is null and v_role not in ('owner', 'edit') then
      raise exception 'Only the table owner or editors can delete cell comments.' using errcode = 'P0403';
    end if;
    v_target_table_id := p_table_id;
  end if;

  if p_cell_key is null or p_cell_key !~ '^[0-9]{1,4}:[0-9]{1,3}$' then
    raise exception 'Choose a valid cell address.' using errcode = 'P0422';
  end if;

  select * into v_table from public.persora_tables where id = v_target_table_id for update;
  if v_table.id is null or v_table.kind <> 'spreadsheet' then
    raise exception 'Cell comments are only supported on spreadsheets.' using errcode = 'P0422';
  end if;
  select * into v_sheet from public.persora_table_sheets where id = p_sheet_id and table_id = v_target_table_id for update;
  if v_sheet.id is null then
    raise exception 'Choose a valid sheet in this spreadsheet.' using errcode = 'P0404';
  end if;

  v_comments := coalesce(v_sheet.data -> 'comments', '{}'::jsonb);
  if p_comment is null then
    v_comments := v_comments - p_cell_key;
  else
    if not (v_comments ? p_cell_key) and (select count(*) from jsonb_object_keys(v_comments)) >= 500 then
      raise exception 'A sheet can hold at most 500 comments.' using errcode = 'P0409';
    end if;
    v_comments := jsonb_set(v_comments, array[p_cell_key], p_comment, true);
  end if;

  update public.persora_table_sheets
  set data = case
        when v_comments = '{}'::jsonb then (data - 'comments')
        else jsonb_set(data, '{comments}', v_comments, true)
      end,
      updated_at = v_now
  where id = v_sheet.id and table_id = v_target_table_id
  returning * into v_sheet;

  update public.persora_tables
  set revision = revision + 1, updated_at = v_now
  where id = v_target_table_id
  returning * into v_table;

  perform public.persora_table_refresh_stats(v_target_table_id);
  return jsonb_build_object(
    'ok', true,
    'revision', v_table.revision,
    'sheet_id', v_sheet.id,
    'cell_key', p_cell_key,
    'comment', v_sheet.data -> 'comments' -> p_cell_key
  );
end;
$function$;
revoke all on function public.persora_table_cell_comment_write(uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_cell_comment_write(uuid, text, uuid, uuid, text, jsonb) to service_role;

create or replace function public.persora_table_thread_comment_add(
  p_actor uuid,
  p_token text,
  p_table_id uuid,
  p_author_name text,
  p_target_kind text,
  p_sheet_id uuid,
  p_cell_ref text,
  p_record_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_link public.table_share_links%rowtype;
  v_target_table_id uuid;
  v_owner_id uuid;
  v_row public.table_comments%rowtype;
begin
  if p_token is not null and btrim(p_token) <> '' then
    select l.* into v_link
    from public.table_share_links l
    join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
    where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
    if v_link.table_id is null then
      raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
    end if;
    if v_link.permission <> 'comment' then
      raise exception 'Commenting is disabled for this shared link.' using errcode = 'P0403';
    end if;
    v_target_table_id := v_link.table_id;
    v_owner_id := v_link.owner_id;
  else
    v_access := public.persora_table_access(p_actor, p_table_id);
    if v_access is null then
      raise exception 'That table is not available in your account.' using errcode = 'P0404';
    end if;
    if (v_access ->> 'role') not in ('owner', 'edit', 'comment') then
      raise exception 'You only have view access to this shared table.' using errcode = 'P0403';
    end if;
    v_target_table_id := p_table_id;
    v_owner_id := (v_access ->> 'owner_id')::uuid;
  end if;

  if (select count(*) from public.table_comments where table_id = v_target_table_id) >= 500 then
    raise exception 'This table already has 500 comments.' using errcode = 'P0409';
  end if;

  insert into public.table_comments (
    table_id, owner_id, author_id, author_name, target_kind, sheet_id, cell_ref, record_id, body
  )
  values (
    v_target_table_id,
    v_owner_id,
    p_actor,
    coalesce(nullif(btrim(p_author_name), ''), 'Guest commenter'),
    coalesce(nullif(btrim(p_target_kind), ''), 'table'),
    p_sheet_id,
    nullif(btrim(p_cell_ref), ''),
    p_record_id,
    btrim(p_body)
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'author_id', v_row.author_id,
    'author_name', v_row.author_name,
    'target_kind', v_row.target_kind,
    'sheet_id', v_row.sheet_id,
    'cell_ref', v_row.cell_ref,
    'record_id', v_row.record_id,
    'body', v_row.body,
    'created_at', v_row.created_at
  );
end;
$function$;
revoke all on function public.persora_table_thread_comment_add(uuid, text, uuid, text, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_table_thread_comment_add(uuid, text, uuid, text, text, uuid, text, uuid, text) to service_role;


-- ============================================================================
-- PART 2: STANDALONE PERSORA FORMS MODULE
-- ============================================================================

create table if not exists public.persora_forms (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text not null default ''::text,
  status text not null default 'draft'::text,
  accepting_responses boolean not null default true,
  public_slug text not null,
  header_image jsonb,
  questions jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  response_count integer not null default 0,
  revision bigint not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_forms_pkey primary key (id),
  constraint persora_forms_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint persora_forms_slug_unique unique (public_slug),
  constraint persora_forms_slug_format check (public_slug ~ '^[A-Za-z0-9_-]{24,64}$'::text),
  constraint persora_forms_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160),
  constraint persora_forms_description_check check (char_length(description) <= 4000),
  constraint persora_forms_status_check check (status = any (array['draft'::text, 'published'::text])),
  constraint persora_forms_questions_check check (jsonb_typeof(questions) = 'array'::text),
  constraint persora_forms_settings_check check (jsonb_typeof(settings) = 'object'::text),
  constraint persora_forms_header_image_check check (header_image is null or jsonb_typeof(header_image) = 'object'::text),
  constraint persora_forms_response_count_check check (response_count >= 0),
  constraint persora_forms_revision_check check (revision >= 1)
);

create index if not exists persora_forms_owner_idx on public.persora_forms using btree (user_id, updated_at desc);

alter table public.persora_forms enable row level security;
drop policy if exists persora_forms_owner_policy on public.persora_forms;
create policy persora_forms_owner_policy on public.persora_forms
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.persora_forms from public, anon, authenticated;
grant all on public.persora_forms to service_role;

create table if not exists public.persora_form_responses (
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  owner_id uuid not null,
  respondent_user_id uuid,
  respondent_name text not null default ''::text,
  respondent_email text not null default ''::text,
  answers jsonb not null default '{}'::jsonb,
  quiz_result jsonb,
  registration_code text,
  submitted_at timestamp with time zone not null default now(),
  constraint persora_form_responses_pkey primary key (id),
  constraint persora_form_responses_form_id_fkey foreign key (form_id) references public.persora_forms(id) on delete cascade,
  constraint persora_form_responses_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_form_responses_respondent_fkey foreign key (respondent_user_id) references public.profiles(id) on delete set null,
  constraint persora_form_responses_name_check check (char_length(respondent_name) <= 160),
  constraint persora_form_responses_email_check check (char_length(respondent_email) <= 254),
  constraint persora_form_responses_answers_check check (jsonb_typeof(answers) = 'object'::text),
  constraint persora_form_responses_quiz_check check (quiz_result is null or jsonb_typeof(quiz_result) = 'object'::text),
  constraint persora_form_responses_reg_code_check check (registration_code is null or char_length(registration_code) <= 32)
);

create index if not exists persora_form_responses_form_idx on public.persora_form_responses using btree (form_id, submitted_at desc);
create index if not exists persora_form_responses_owner_idx on public.persora_form_responses using btree (owner_id, submitted_at desc);

alter table public.persora_form_responses enable row level security;
drop policy if exists persora_form_responses_owner_policy on public.persora_form_responses;
create policy persora_form_responses_owner_policy on public.persora_form_responses
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_form_responses from public, anon, authenticated;
grant all on public.persora_form_responses to service_role;

create table if not exists public.persora_form_assets (
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  owner_id uuid not null,
  role text not null,
  response_id uuid,
  file_key text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null,
  created_at timestamp with time zone not null default now(),
  constraint persora_form_assets_pkey primary key (id),
  constraint persora_form_assets_form_id_fkey foreign key (form_id) references public.persora_forms(id) on delete cascade,
  constraint persora_form_assets_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_form_assets_response_id_fkey foreign key (response_id) references public.persora_form_responses(id) on delete cascade,
  constraint persora_form_assets_role_check check (role = any (array['builder_image'::text, 'response_image'::text])),
  constraint persora_form_assets_key_check check (file_key ~~ (owner_id::text || '/persora-forms/%'::text) and char_length(file_key) <= 400),
  constraint persora_form_assets_name_check check (char_length(file_name) >= 1 and char_length(file_name) <= 255),
  constraint persora_form_assets_image_only_check check (file_type = any (array['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/gif'::text])),
  constraint persora_form_assets_size_check check (file_size > 0 and file_size <= 10485760)
);

create index if not exists persora_form_assets_form_idx on public.persora_form_assets using btree (form_id, role);
create index if not exists persora_form_assets_owner_key_idx on public.persora_form_assets using btree (owner_id, file_key);

alter table public.persora_form_assets enable row level security;
drop policy if exists persora_form_assets_owner_policy on public.persora_form_assets;
create policy persora_form_assets_owner_policy on public.persora_form_assets
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_form_assets from public, anon, authenticated;
grant all on public.persora_form_assets to service_role;

create or replace function public.persora_form_summary(p_form public.persora_forms)
returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'id', p_form.id,
    'title', p_form.title,
    'description', p_form.description,
    'status', p_form.status,
    'accepting_responses', p_form.accepting_responses,
    'public_slug', p_form.public_slug,
    'question_count', jsonb_array_length(p_form.questions),
    'response_count', p_form.response_count,
    'quiz_enabled', coalesce((p_form.settings -> 'quiz' ->> 'enabled')::boolean, false),
    'event_enabled', coalesce((p_form.settings -> 'eventRegistration' ->> 'enabled')::boolean, false),
    'max_registrations', (p_form.settings -> 'eventRegistration' ->> 'maxRegistrations')::integer,
    'revision', p_form.revision,
    'created_at', p_form.created_at,
    'updated_at', p_form.updated_at
  );
$function$;
revoke all on function public.persora_form_summary(public.persora_forms) from public, anon, authenticated;
revoke all on function public.persora_form_summary(public.persora_forms) from service_role;

create or replace function public.persora_forms_list(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(jsonb_agg(public.persora_form_summary(f) order by f.updated_at desc), '[]'::jsonb)
  from public.persora_forms f
  where f.user_id = p_owner;
$function$;
revoke all on function public.persora_forms_list(uuid) from public, anon, authenticated;
grant execute on function public.persora_forms_list(uuid) to service_role;

create or replace function public.persora_form_get(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
begin
  select * into v_form from public.persora_forms where id = p_id and user_id = p_owner;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'form', public.persora_form_summary(v_form) || jsonb_build_object(
      'header_image', v_form.header_image,
      'questions', v_form.questions,
      'settings', v_form.settings
    ),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'role', a.role, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at)
      from public.persora_form_assets a
      where a.form_id = p_id and a.owner_id = p_owner and a.role = 'builder_image'
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_form_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_get(uuid, uuid) to service_role;

create or replace function public.persora_form_create(
  p_owner uuid,
  p_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_questions jsonb,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_existing public.persora_forms%rowtype;
  v_form public.persora_forms%rowtype;
begin
  select * into v_existing from public.persora_forms where id = p_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That form id is already in use.' using errcode = 'P0409';
    end if;
    return public.persora_form_get(p_owner, p_id);
  end if;
  if (select count(*) from public.persora_forms where user_id = p_owner) >= 200 then
    raise exception 'You can have up to 200 forms. Delete forms you no longer need first.' using errcode = 'P0409';
  end if;
  insert into public.persora_forms (id, user_id, title, description, status, accepting_responses, public_slug, questions, settings)
  values (
    p_id,
    p_owner,
    btrim(p_title),
    coalesce(p_description, ''),
    'draft',
    true,
    p_slug,
    coalesce(p_questions, '[]'::jsonb),
    coalesce(p_settings, '{}'::jsonb)
  )
  returning * into v_form;
  return public.persora_form_get(p_owner, v_form.id);
end;
$function$;
revoke all on function public.persora_form_create(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persora_form_create(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;

create or replace function public.persora_form_save(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_description text,
  p_status text,
  p_accepting boolean,
  p_header_image jsonb,
  p_questions jsonb,
  p_settings jsonb,
  p_rotate_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_form from public.persora_forms where id = p_id and user_id = p_owner for update;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  update public.persora_forms
  set title = coalesce(nullif(btrim(p_title), ''), title),
      description = coalesce(p_description, description),
      status = coalesce(p_status, status),
      accepting_responses = coalesce(p_accepting, accepting_responses),
      header_image = p_header_image,
      questions = coalesce(p_questions, questions),
      settings = coalesce(p_settings, settings),
      public_slug = coalesce(nullif(btrim(p_rotate_slug), ''), public_slug),
      revision = revision + 1,
      updated_at = v_now
  where id = p_id and user_id = p_owner
  returning * into v_form;
  return public.persora_form_get(p_owner, v_form.id);
end;
$function$;
revoke all on function public.persora_form_save(uuid, uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.persora_form_save(uuid, uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text) to service_role;

create or replace function public.persora_form_duplicate(
  p_owner uuid,
  p_source_id uuid,
  p_new_id uuid,
  p_new_slug text,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_source public.persora_forms%rowtype;
  v_form public.persora_forms%rowtype;
begin
  select * into v_source from public.persora_forms where id = p_source_id and user_id = p_owner;
  if v_source.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_forms where user_id = p_owner) >= 200 then
    raise exception 'You can have up to 200 forms.' using errcode = 'P0409';
  end if;
  insert into public.persora_forms (
    id, user_id, title, description, status, accepting_responses, public_slug, header_image, questions, settings
  )
  values (
    p_new_id,
    p_owner,
    btrim(p_title),
    v_source.description,
    'draft',
    true,
    p_new_slug,
    null,
    (
      select coalesce(
        jsonb_agg(
          (q - 'imageAssetId') || jsonb_build_object(
            'options',
            case
              when jsonb_typeof(q -> 'options') = 'array' then (
                select coalesce(jsonb_agg(opt - 'imageAssetId'), '[]'::jsonb)
                from jsonb_array_elements(q -> 'options') opt
              )
              else coalesce(q -> 'options', '[]'::jsonb)
            end
          )
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(v_source.questions) q
    ),
    v_source.settings
  )
  returning * into v_form;
  return public.persora_form_get(p_owner, v_form.id);
end;
$function$;
revoke all on function public.persora_form_duplicate(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.persora_form_duplicate(uuid, uuid, uuid, text, text) to service_role;

create or replace function public.persora_form_delete(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_keys jsonb;
begin
  select * into v_form from public.persora_forms where id = p_id and user_id = p_owner for update;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys
  from public.persora_form_assets
  where form_id = p_id and owner_id = p_owner;

  delete from public.persora_forms where id = p_id and user_id = p_owner;
  return jsonb_build_object('ok', true, 'file_keys', v_keys);
end;
$function$;
revoke all on function public.persora_form_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_delete(uuid, uuid) to service_role;

create or replace function public.persora_form_responses_list(p_owner uuid, p_form_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
begin
  select * into v_form from public.persora_forms where id = p_form_id and user_id = p_owner;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'response_count', v_form.response_count,
    'accepting_responses', v_form.accepting_responses,
    'responses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'respondent_name', r.respondent_name,
          'respondent_email', r.respondent_email,
          'answers', r.answers,
          'quiz_result', r.quiz_result,
          'registration_code', r.registration_code,
          'submitted_at', r.submitted_at,
          'assets', coalesce((
            select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size))
            from public.persora_form_assets a
            where a.response_id = r.id and a.form_id = p_form_id
          ), '[]'::jsonb)
        )
        order by r.submitted_at desc, r.id
      )
      from public.persora_form_responses r
      where r.form_id = p_form_id and r.owner_id = p_owner
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_form_responses_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_responses_list(uuid, uuid) to service_role;

create or replace function public.persora_form_response_delete(p_owner uuid, p_form_id uuid, p_response_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_resp public.persora_form_responses%rowtype;
  v_keys jsonb;
begin
  select * into v_form from public.persora_forms where id = p_form_id and user_id = p_owner for update;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys
  from public.persora_form_assets
  where form_id = p_form_id and response_id = p_response_id and owner_id = p_owner;

  delete from public.persora_form_responses
  where id = p_response_id and form_id = p_form_id and owner_id = p_owner
  returning * into v_resp;
  if v_resp.id is null then
    raise exception 'That response could not be found.' using errcode = 'P0404';
  end if;

  update public.persora_forms
  set response_count = greatest(0, (select count(*)::integer from public.persora_form_responses where form_id = p_form_id)),
      updated_at = clock_timestamp()
  where id = p_form_id;

  return jsonb_build_object('ok', true, 'file_keys', v_keys);
end;
$function$;
revoke all on function public.persora_form_response_delete(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_response_delete(uuid, uuid, uuid) to service_role;

create or replace function public.persora_form_asset_add(
  p_owner uuid,
  p_form_id uuid,
  p_id uuid,
  p_role text,
  p_key text,
  p_name text,
  p_type text,
  p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_row public.persora_form_assets%rowtype;
begin
  select * into v_form from public.persora_forms where id = p_form_id and user_id = p_owner;
  if v_form.id is null then
    raise exception 'That form is not available.' using errcode = 'P0404';
  end if;
  if p_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') then
    raise exception 'Only JPEG, PNG, WebP, and GIF images are supported.' using errcode = 'P0415';
  end if;
  if (select count(*) from public.persora_form_assets where form_id = p_form_id) >= 1000 then
    raise exception 'This form has reached the maximum number of image attachments.' using errcode = 'P0409';
  end if;
  insert into public.persora_form_assets (id, form_id, owner_id, role, file_key, file_name, file_type, file_size)
  values (p_id, p_form_id, p_owner, p_role, p_key, p_name, p_type, p_size)
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id,
    'role', v_row.role,
    'name', v_row.file_name,
    'type', v_row.file_type,
    'size', v_row.file_size,
    'created_at', v_row.created_at
  );
end;
$function$;
revoke all on function public.persora_form_asset_add(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.persora_form_asset_add(uuid, uuid, uuid, text, text, text, text, bigint) to service_role;

create or replace function public.persora_form_asset_get(
  p_actor uuid,
  p_slug text,
  p_form_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_row public.persora_form_assets%rowtype;
begin
  if p_slug is not null and btrim(p_slug) <> '' then
    select f.* into v_form
    from public.persora_forms f
    join public.profiles p on p.id = f.user_id and p.account_status = 'active'
    where f.public_slug = p_slug and f.status = 'published';
    if v_form.id is null then
      raise exception 'That image is not available.' using errcode = 'P0404';
    end if;
    -- Public form respondents can ONLY read builder_image assets, NEVER response_image uploads!
    select * into v_row
    from public.persora_form_assets
    where id = p_asset_id and form_id = v_form.id and role = 'builder_image';
  else
    select * into v_form from public.persora_forms where id = p_form_id and user_id = p_actor;
    if v_form.id is null then
      raise exception 'That image is not available.' using errcode = 'P0404';
    end if;
    select * into v_row
    from public.persora_form_assets
    where id = p_asset_id and form_id = v_form.id and owner_id = p_actor;
  end if;

  if v_row.id is null then
    raise exception 'That image is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'file_key', v_row.file_key,
    'name', v_row.file_name,
    'type', v_row.file_type,
    'size', v_row.file_size,
    'owner_id', v_row.owner_id
  );
end;
$function$;
revoke all on function public.persora_form_asset_get(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_asset_get(uuid, text, uuid, uuid) to service_role;

create or replace function public.persora_form_public_meta(p_slug text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then
    raise exception 'This form link is invalid or no longer available.' using errcode = 'P0404';
  end if;
  select f.* into v_form
  from public.persora_forms f
  join public.profiles p on p.id = f.user_id and p.account_status = 'active'
  where f.public_slug = p_slug;
  if v_form.id is null or v_form.status <> 'published' then
    raise exception 'This form is not published or is no longer available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'id', v_form.id,
    'owner_id', v_form.user_id,
    'title', v_form.title,
    'description', v_form.description,
    'status', v_form.status,
    'accepting_responses', v_form.accepting_responses,
    'public_slug', v_form.public_slug,
    'header_image', v_form.header_image,
    'questions', v_form.questions,
    'settings', v_form.settings,
    'response_count', v_form.response_count,
    'updated_at', v_form.updated_at
  );
end;
$function$;
revoke all on function public.persora_form_public_meta(text) from public, anon, authenticated;
grant execute on function public.persora_form_public_meta(text) to service_role;

create or replace function public.persora_form_submit_response(
  p_slug text,
  p_response_id uuid,
  p_respondent_user_id uuid,
  p_respondent_name text,
  p_respondent_email text,
  p_answers jsonb,
  p_quiz_result jsonb,
  p_registration_code text,
  p_asset_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_max_reg integer;
  v_require_signin boolean;
  v_asset_uuid_list uuid[];
  v_bound_count integer;
  v_resp public.persora_form_responses%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then
    raise exception 'This form link is invalid or no longer available.' using errcode = 'P0404';
  end if;
  select f.* into v_form
  from public.persora_forms f
  join public.profiles p on p.id = f.user_id and p.account_status = 'active'
  where f.public_slug = p_slug
  for update of f;

  if v_form.id is null or v_form.status <> 'published' then
    raise exception 'This form is not currently published.' using errcode = 'P0404';
  end if;
  if not v_form.accepting_responses then
    raise exception 'This form is no longer accepting responses.' using errcode = 'P0403';
  end if;

  v_require_signin := coalesce((v_form.settings ->> 'requireSignIn')::boolean, false);
  if v_require_signin and p_respondent_user_id is null then
    raise exception 'Sign in with a Persora account to submit this form.' using errcode = 'P0401';
  end if;

  if coalesce((v_form.settings -> 'eventRegistration' ->> 'enabled')::boolean, false) then
    v_max_reg := (v_form.settings -> 'eventRegistration' ->> 'maxRegistrations')::integer;
    if v_max_reg is not null and v_max_reg > 0 and v_form.response_count >= v_max_reg then
      raise exception 'Registration is full — all available spots have been claimed.' using errcode = 'P0409';
    end if;
  end if;

  if v_form.response_count >= 25000 then
    raise exception 'This form has reached its maximum response limit.' using errcode = 'P0409';
  end if;

  v_asset_uuid_list := public.persora_table_uuid_array(coalesce(p_asset_ids, '[]'::jsonb));

  insert into public.persora_form_responses (
    id, form_id, owner_id, respondent_user_id, respondent_name, respondent_email, answers, quiz_result, registration_code, submitted_at
  )
  values (
    p_response_id,
    v_form.id,
    v_form.user_id,
    p_respondent_user_id,
    coalesce(btrim(p_respondent_name), ''),
    coalesce(btrim(p_respondent_email), ''),
    coalesce(p_answers, '{}'::jsonb),
    p_quiz_result,
    nullif(btrim(p_registration_code), ''),
    v_now
  )
  returning * into v_resp;

  if cardinality(v_asset_uuid_list) > 0 then
    update public.persora_form_assets
    set response_id = v_resp.id
    where id = any(v_asset_uuid_list)
      and form_id = v_form.id
      and role = 'response_image'
      and response_id is null;
    get diagnostics v_bound_count = row_count;
    if v_bound_count <> cardinality(v_asset_uuid_list) then
      raise exception 'One or more uploaded images are invalid or already used.' using errcode = 'P0422';
    end if;
  end if;

  update public.persora_forms
  set response_count = response_count + 1
  where id = v_form.id;

  return jsonb_build_object(
    'id', v_resp.id,
    'submitted_at', v_resp.submitted_at,
    'registration_code', v_resp.registration_code,
    'response_count', v_form.response_count + 1
  );
end;
$function$;
revoke all on function public.persora_form_submit_response(text, uuid, uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.persora_form_submit_response(text, uuid, uuid, text, text, jsonb, jsonb, text, jsonb) to service_role;

create or replace function public.persora_forms_export(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'forms', coalesce((select jsonb_agg(public.persora_form_summary(f) || jsonb_build_object('questions', f.questions, 'settings', f.settings) order by f.created_at) from public.persora_forms f where f.user_id = p_owner), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'form_id', r.form_id, 'respondent_name', r.respondent_name, 'respondent_email', r.respondent_email, 'answers', r.answers, 'quiz_result', r.quiz_result, 'registration_code', r.registration_code, 'submitted_at', r.submitted_at) order by r.submitted_at) from public.persora_form_responses r where r.owner_id = p_owner), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_forms_export(uuid) from public, anon, authenticated;
grant execute on function public.persora_forms_export(uuid) to service_role;
