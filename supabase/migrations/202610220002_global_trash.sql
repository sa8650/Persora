-- Persora Global Trash (2026-10-22)
-- Shadow-table soft delete: content lands in trash_items with its related rows
-- snapshotted into the payload, lives there for 7 days (expires_at), is restorable
-- until expiry, and is then hard-purged (rows by pg_cron, R2 files by the API sweep).
-- No existing tables change shape; live queries never see trashed content.

create table if not exists public.trash_items (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('vault_item', 'contact', 'business_card', 'medical_record', 'timeline_event')),
  title text not null default 'Deleted item',
  context jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  file_keys jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'restoring', 'purging')),
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  purge_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trash_items_retention_check check (expires_at > deleted_at)
);
create index if not exists trash_items_owner_status_expiry_idx on public.trash_items(owner_id, status, expires_at);
create index if not exists trash_items_expiry_idx on public.trash_items(expires_at) where status = 'active';
alter table public.trash_items enable row level security;
revoke all on public.trash_items from anon, authenticated;
grant all on public.trash_items to service_role;

-- File keys released by the database-side cron purge. The API sweep drains this
-- queue and deletes objects from R2 only once nothing references them any more.
create table if not exists public.trash_file_releases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  file_key text not null,
  released_at timestamptz not null default now()
);
create index if not exists trash_file_releases_released_idx on public.trash_file_releases(released_at);
alter table public.trash_file_releases enable row level security;
revoke all on public.trash_file_releases from anon, authenticated;
grant all on public.trash_file_releases to service_role;

-- Move a supported record into the Trash and delete it from its live table.
-- Snapshots ownership, folder, and every dependent relationship into the payload
-- before the delete so restore can rebuild them. Runs as one transaction: any
-- failure leaves the record fully intact.
create or replace function public.persora_trash_move(
  p_owner uuid,
  p_kind text,
  p_id uuid,
  p_file_keys jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row jsonb := null;
  v_relations jsonb := '{}'::jsonb;
  v_title text := 'Deleted item';
  v_context jsonb := '{}'::jsonb;
  v_file_keys jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;

  if p_kind = 'vault_item' then
    select to_jsonb(item) into v_row from public.vault_items item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That record is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'shares', coalesce((select jsonb_agg(to_jsonb(share)) from public.vault_shares share where share.item_id = p_id), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(to_jsonb(comment))
        from public.vault_share_comments comment
        join public.vault_shares share on share.id = comment.share_id
        where share.item_id = p_id
      ), '[]'::jsonb),
      'timeline_events', coalesce((
        select jsonb_agg(to_jsonb(event))
        from public.timeline_events event
        where event.record_id = p_id and event.user_id = p_owner
      ), '[]'::jsonb),
      'timeline_links', coalesce((
        select jsonb_agg(to_jsonb(link))
        from public.timeline_event_links link
        where link.record_id = p_id and link.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'file_key') is not null then v_file_keys := jsonb_build_array(v_row ->> 'file_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'title', ''), 'Untitled record');
    v_context := jsonb_build_object('space', v_row ->> 'section', 'folderId', v_row -> 'folder_id');
    delete from public.vault_items where id = p_id and user_id = p_owner;

  elsif p_kind = 'contact' then
    select to_jsonb(item) into v_row from public.contacts item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That contact is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'record_shares', coalesce((
        select jsonb_agg(to_jsonb(share))
        from public.record_shares share
        where share.resource_type = 'contact' and share.resource_id = p_id and share.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'photo_key') is not null then v_file_keys := jsonb_build_array(v_row ->> 'photo_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'full_name', ''), 'Untitled contact');
    v_context := jsonb_build_object('space', 'contacts', 'folderId', v_row -> 'folder_id');
    delete from public.record_shares where resource_type = 'contact' and resource_id = p_id and owner_id = p_owner;
    delete from public.contacts where id = p_id and user_id = p_owner;

  elsif p_kind = 'business_card' then
    select to_jsonb(item) into v_row from public.business_cards item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That business card is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'record_shares', coalesce((
        select jsonb_agg(to_jsonb(share))
        from public.record_shares share
        where share.resource_type = 'business_card' and share.resource_id = p_id and share.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'profile_photo_key') is not null then v_file_keys := v_file_keys || jsonb_build_array(v_row ->> 'profile_photo_key'); end if;
    if (v_row ->> 'business_logo_key') is not null then v_file_keys := v_file_keys || jsonb_build_array(v_row ->> 'business_logo_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'full_name', ''), nullif(v_row ->> 'company_name', ''), 'Untitled business card');
    v_context := jsonb_build_object('space', 'business_cards', 'folderId', v_row -> 'folder_id');
    delete from public.record_shares where resource_type = 'business_card' and resource_id = p_id and owner_id = p_owner;
    delete from public.business_cards where id = p_id and user_id = p_owner;

  elsif p_kind = 'medical_record' then
    select to_jsonb(item) into v_row from public.medical_records item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That medical record is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'medical_links', coalesce((
        select jsonb_agg(to_jsonb(link))
        from public.medical_record_links link
        where link.medical_record_id = p_id and link.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'file_key') is not null then v_file_keys := jsonb_build_array(v_row ->> 'file_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'title', ''), 'Untitled medical record');
    v_context := jsonb_build_object('space', 'medical_records', 'recordType', v_row ->> 'record_type', 'folderId', v_row -> 'folder_id');
    delete from public.medical_records where id = p_id and user_id = p_owner;

  elsif p_kind = 'timeline_event' then
    select to_jsonb(event) into v_row
    from public.timeline_events event
    where event.id = p_id and event.user_id = p_owner and event.event_type = 'manual';
    if v_row is null then raise exception 'Only your own manual timeline posts can be deleted.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'timeline_links', coalesce((
        select jsonb_agg(to_jsonb(link))
        from public.timeline_event_links link
        where link.event_id = p_id and link.owner_id = p_owner
      ), '[]'::jsonb)
    );
    -- Timeline content stays encrypted; only non-secret metadata (supplied by the
    -- caller after local decryption) names this entry in the Trash.
    v_title := coalesce(nullif(trim(p_file_keys ->> 'title'), ''), 'Timeline entry');
    v_file_keys := coalesce(p_file_keys -> 'keys', '[]'::jsonb);
    v_context := jsonb_build_object('space', 'timeline', 'eventDate', v_row ->> 'event_date');
    delete from public.timeline_events where id = p_id and user_id = p_owner and event_type = 'manual';
  else
    raise exception 'This content type cannot go to the Trash.' using errcode = 'P0400';
  end if;

  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, p_kind, v_title, v_context,
    jsonb_build_object('row', v_row, 'relations', v_relations),
    v_file_keys, 'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;

  return to_jsonb(v_trash);
end;
$function$;

-- Restore a Trash entry: atomically claims the row (expired or in-flight entries
-- cannot be restored), rebuilds the record and its relationships, and clears the
-- Trash row. Missing folders fall back to "no folder" with a note; missing link
-- targets are skipped with a note — the item itself is never silently discarded.
create or replace function public.persora_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_relations jsonb;
  v_note text := '';
  v_folder_missing boolean := false;
  v_link jsonb;
  v_event jsonb;
  v_share jsonb;
  v_comment jsonb;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id
    and owner_id = p_owner
    and status = 'active'
    and expires_at > clock_timestamp()
  returning * into v_trash;

  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  v_relations := coalesce(v_trash.payload -> 'relations', '{}'::jsonb);

  if (v_row ->> 'folder_id') is not null then
    if not exists (select 1 from public.vault_folders where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner) then
      v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
      v_folder_missing := true;
    end if;
  end if;

  if v_trash.kind = 'vault_item' then
    insert into public.vault_items select * from jsonb_populate_record(null::public.vault_items, v_row);

    -- Automatic timeline events re-generate on demand; both insert paths use
    -- conflict guards so duplicate restoration can never corrupt either side.
    for v_event in select value from jsonb_array_elements(coalesce(v_relations -> 'timeline_events', '[]'::jsonb)) loop
      begin
        insert into public.timeline_events select * from jsonb_populate_record(null::public.timeline_events, v_event);
      exception when unique_violation then null;
      end;
    end loop;

    for v_link in select value from jsonb_array_elements(coalesce(v_relations -> 'timeline_links', '[]'::jsonb)) loop
      if ((v_link ->> 'record_id')::uuid) <> v_trash.id
         and not exists (select 1 from public.vault_items where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A timeline link pointed at a record that no longer exists and was skipped. ';
        continue;
      end if;
      if not exists (
        select 1 from public.timeline_events
        where id = (v_link ->> 'event_id')::uuid and user_id = p_owner
      ) then
        v_note := v_note || 'A linked timeline entry no longer exists and its link was skipped. ';
        continue;
      end if;
      begin
        insert into public.timeline_event_links select * from jsonb_populate_record(null::public.timeline_event_links, v_link);
      exception when unique_violation then null;
      end;
    end loop;

    for v_share in select value from jsonb_array_elements(coalesce(v_relations -> 'shares', '[]'::jsonb)) loop
      begin
        insert into public.vault_shares select * from jsonb_populate_record(null::public.vault_shares, v_share);
      exception when unique_violation then null;
      end;
    end loop;

    for v_comment in select value from jsonb_array_elements(coalesce(v_relations -> 'comments', '[]'::jsonb)) loop
      if not exists (select 1 from public.vault_shares where id = (v_comment ->> 'share_id')::uuid) then
        continue;
      end if;
      begin
        insert into public.vault_share_comments select * from jsonb_populate_record(null::public.vault_share_comments, v_comment);
      exception when unique_violation then null;
      end;
    end loop;

  elsif v_trash.kind = 'contact' then
    insert into public.contacts select * from jsonb_populate_record(null::public.contacts, v_row);
  elsif v_trash.kind = 'business_card' then
    insert into public.business_cards select * from jsonb_populate_record(null::public.business_cards, v_row);
  elsif v_trash.kind = 'medical_record' then
    insert into public.medical_records select * from jsonb_populate_record(null::public.medical_records, v_row);
    for v_link in select value from jsonb_array_elements(coalesce(v_relations -> 'medical_links', '[]'::jsonb)) loop
      if (v_link ->> 'record_type') = 'vault_item'
         and not exists (select 1 from public.vault_items where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A linked record no longer exists and its link was skipped. ';
        continue;
      end if;
      if (v_link ->> 'record_type') = 'contact'
         and not exists (select 1 from public.contacts where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A linked contact no longer exists and its link was skipped. ';
        continue;
      end if;
      begin
        insert into public.medical_record_links select * from jsonb_populate_record(null::public.medical_record_links, v_link);
      exception when unique_violation then null;
      end;
    end loop;
  elsif v_trash.kind = 'timeline_event' then
    insert into public.timeline_events select * from jsonb_populate_record(null::public.timeline_events, v_row);
    for v_link in select value from jsonb_array_elements(coalesce(v_relations -> 'timeline_links', '[]'::jsonb)) loop
      if not exists (select 1 from public.vault_items where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A record linked to this timeline entry no longer exists and its link was skipped. ';
        continue;
      end if;
      begin
        insert into public.timeline_event_links select * from jsonb_populate_record(null::public.timeline_event_links, v_link);
      exception when unique_violation then null;
      end;
    end loop;
  else
    raise exception 'This Trash entry cannot be restored.' using errcode = 'P0400';
  end if;

  if v_trash.kind in ('contact', 'business_card') then
    for v_share in select value from jsonb_array_elements(coalesce(v_relations -> 'record_shares', '[]'::jsonb)) loop
      begin
        insert into public.record_shares select * from jsonb_populate_record(null::public.record_shares, v_share);
      exception when unique_violation then null;
      end;
    end loop;
  end if;

  if v_folder_missing then
    v_note := 'Restored without its folder because that folder no longer exists. ' || v_note;
  end if;

  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', nullif(btrim(v_note), ''));
end;
$function$;

-- Claim expired (or stale in-flight) entries for permanent deletion. Atomic and
-- safe under concurrency: rows move to 'purging' and only the claimant sees them.
create or replace function public.persora_trash_claim_purge(p_limit integer default 50)
returns setof public.trash_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  return query
  update public.trash_items
  set status = 'purging', purge_claimed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id in (
    select id from public.trash_items
    where ((status = 'active' and expires_at <= clock_timestamp())
       or (status = 'purging' and purge_claimed_at < clock_timestamp() - interval '10 minutes'))
    order by expires_at asc
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  )
  returning *;
end;
$function$;

-- Claim a specific set of an owner's entries for a user-requested permanent delete.
create or replace function public.persora_trash_claim_for_owner(p_owner uuid, p_ids uuid[])
returns setof public.trash_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  return query
  update public.trash_items
  set status = 'purging', purge_claimed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id in (
    select id from public.trash_items
    where owner_id = p_owner and status = 'active' and id = any(coalesce(p_ids, array[]::uuid[]))
    for update skip locked
  )
  returning *;
end;
$function$;

-- Finalize entries whose files were handled.
create or replace function public.persora_trash_finalize_purge(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  delete from public.trash_items where id = any(coalesce(p_ids, array[]::uuid[])) and status = 'purging';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Release entries whose file cleanup failed so the user sees them again and the
-- sweep retries later. Nothing is deleted here; data is always preserved.
create or replace function public.persora_trash_release_purge(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  update public.trash_items
  set status = 'active', purge_claimed_at = null, updated_at = clock_timestamp()
  where id = any(coalesce(p_ids, array[]::uuid[])) and status = 'purging';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Database-side hard purge for expired rows. Runs unconditionally via pg_cron so
-- expiry never depends on anyone visiting the app. File keys are queued into
-- trash_file_releases first; the API sweep deletes the R2 objects after checking
-- that nothing else references them.
create or replace function public.persora_trash_purge_expired_rows(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  with expired as (
    select id, owner_id, file_keys
    from public.trash_items
    where status in ('active', 'purging') and expires_at <= clock_timestamp()
    order by expires_at asc
    limit greatest(coalesce(p_limit, 500), 1)
    for update skip locked
  ),
  released as (
    insert into public.trash_file_releases (owner_id, file_key)
    select expired.owner_id, released_key.key
    from expired
    cross join lateral jsonb_array_elements_text(coalesce(expired.file_keys, '[]'::jsonb)) as released_key(key)
    on conflict do nothing
    returning id
  ),
  removed as (
    delete from public.trash_items where id in (select id from expired) returning id
  )
  select count(*) from removed into v_count;
  return v_count;
end;
$function$;

revoke all on function public.persora_trash_move(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_trash_restore(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_trash_claim_purge(integer) from public, anon, authenticated;
revoke all on function public.persora_trash_claim_for_owner(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.persora_trash_finalize_purge(uuid[]) from public, anon, authenticated;
revoke all on function public.persora_trash_release_purge(uuid[]) from public, anon, authenticated;
revoke all on function public.persora_trash_purge_expired_rows(integer) from public, anon, authenticated;
grant execute on function public.persora_trash_move(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.persora_trash_restore(uuid, uuid) to service_role;
grant execute on function public.persora_trash_claim_purge(integer) to service_role;
grant execute on function public.persora_trash_claim_for_owner(uuid, uuid[]) to service_role;
grant execute on function public.persora_trash_finalize_purge(uuid[]) to service_role;
grant execute on function public.persora_trash_release_purge(uuid[]) to service_role;
grant execute on function public.persora_trash_purge_expired_rows(integer) to service_role;

-- Hourly expiry purge, independent of app traffic. Guarded so the migration also
-- applies cleanly on Supabase plans/environments where pg_cron is unavailable
-- (in that case the API sweep fully covers expiry purges instead).
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception
    when insufficient_privilege or undefined_file or feature_not_supported or invalid_parameter_value then
      raise warning 'pg_cron extension is unavailable here; the API trash sweep covers expiry purges.';
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'persora-trash-expiry-purge') then
      perform cron.schedule('persora-trash-expiry-purge', '17 * * * *', $cron$select public.persora_trash_purge_expired_rows(500);$cron$);
    end if;
  end if;
end $$;
