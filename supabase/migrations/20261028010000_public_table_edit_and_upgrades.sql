-- ============================================================================
-- Persora Table Public Link Edit Permission & Public Content Save RPC
-- ============================================================================

alter table public.table_share_links
  drop constraint if exists table_share_links_permission_check;

alter table public.table_share_links
  add constraint table_share_links_permission_check
  check (permission = any (array['view'::text, 'comment'::text, 'edit'::text]));

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
  if v_perm not in ('view', 'comment', 'edit') then
    raise exception 'Public link permission must be view, comment, or edit.' using errcode = 'P0422';
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

create or replace function public.persora_table_public_save(
  p_token text,
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
  v_link public.table_share_links%rowtype;
  v_table public.persora_tables%rowtype;
  v_true_owner uuid;
  v_now timestamptz := clock_timestamp();
  v_sheet_ids uuid[];
  v_record_ids uuid[];
  v_summary jsonb;
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
  if v_link.permission <> 'edit' then
    raise exception 'Editing is disabled for this shared link.' using errcode = 'P0403';
  end if;

  select * into v_table from public.persora_tables where id = v_link.table_id for update;
  if v_table.id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  v_true_owner := v_table.user_id;

  if v_table.last_batch_id = p_batch then
    v_summary := jsonb_build_object(
      'id', v_table.id,
      'kind', v_table.kind,
      'name', v_table.name,
      'revision', v_table.revision,
      'sheet_count', v_table.sheet_count,
      'record_count', v_table.record_count,
      'updated_at', v_table.updated_at
    );
    return jsonb_build_object('ok', true, 'replayed', true, 'table', v_summary);
  end if;
  if v_table.revision <> p_base then
    v_summary := jsonb_build_object(
      'id', v_table.id,
      'kind', v_table.kind,
      'name', v_table.name,
      'revision', v_table.revision,
      'sheet_count', v_table.sheet_count,
      'record_count', v_table.record_count,
      'updated_at', v_table.updated_at
    );
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
  if exists (select 1 from public.persora_table_sheets where id = any(v_sheet_ids) and table_id <> v_table.id)
     or exists (select 1 from public.persora_table_records where id = any(v_record_ids) and table_id <> v_table.id) then
    raise exception 'That change refers to data from another table.' using errcode = 'P0403';
  end if;

  delete from public.persora_table_sheets where table_id = v_table.id and id = any(public.persora_table_uuid_array(p_sheet_deletes));
  insert into public.persora_table_sheets as current (id, table_id, user_id, position, name, data, updated_at)
  select (s ->> 'id')::uuid, v_table.id, v_true_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data', v_now
  from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s
  on conflict (id) do update set position = excluded.position, name = excluded.name, data = excluded.data, updated_at = v_now
  where current.table_id = v_table.id;

  delete from public.persora_table_records where table_id = v_table.id and id = any(public.persora_table_uuid_array(p_record_deletes));
  insert into public.persora_table_records as current (id, table_id, user_id, position, "values", is_example, updated_at)
  select (r ->> 'id')::uuid, v_table.id, v_true_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false), v_now
  from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r
  on conflict (id) do update set position = excluded.position, "values" = excluded."values", is_example = excluded.is_example, updated_at = v_now
  where current.table_id = v_table.id;

  update public.persora_tables
  set meta = coalesce(p_meta, meta), revision = revision + 1, last_batch_id = p_batch, updated_at = v_now
  where id = v_table.id;
  v_table := public.persora_table_refresh_stats(v_table.id);
  v_summary := jsonb_build_object(
    'id', v_table.id,
    'kind', v_table.kind,
    'name', v_table.name,
    'revision', v_table.revision,
    'sheet_count', v_table.sheet_count,
    'record_count', v_table.record_count,
    'updated_at', v_table.updated_at
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'table', v_summary);
end;
$function$;
revoke all on function public.persora_table_public_save(text, bigint, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_public_save(text, bigint, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

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
    if v_link.permission not in ('comment', 'edit') then
      raise exception 'Commenting is disabled for this shared link.' using errcode = 'P0403';
    end if;
    if p_comment is null and v_link.permission <> 'edit' then
      raise exception 'Public commenters can add comments but cannot delete existing comments.' using errcode = 'P0403';
    end if;
    v_target_table_id := v_link.table_id;
    v_role := v_link.permission;
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
    if v_link.permission not in ('comment', 'edit') then
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
