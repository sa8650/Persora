-- Photo Studio sharing (2026-10-22).
-- Photos are shared with Persora members through the existing record-sharing
-- system (public.record_shares + /record-shares routes + the shared Share
-- dialog). This migration:
--   1. allows resource_type 'photo_studio_photo' in record_shares;
--   2. makes moving a photo to the Trash snapshot and remove its shares (as
--      contacts and business cards already do), and restoring re-create them.
-- Idempotent: safe to run more than once.

-- 1. Allow the new resource type (the original check was created inline, so
--    look it up by definition instead of relying on a generated name).
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.record_shares'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%resource_type%'
  loop
    execute format('alter table public.record_shares drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.record_shares
  add constraint record_shares_resource_type_check
  check (resource_type in ('contact', 'business_card', 'photo_studio_photo'));

-- 2. Trash move: snapshot shares into the Trash payload and remove them.
create or replace function public.persora_photo_studio_trash_move(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_relations jsonb;
begin
  select to_jsonb(photo) into v_row from public.photo_studio_photos photo where photo.id = p_id and photo.user_id = p_owner;
  if v_row is null then
    raise exception 'That photo is not available in your account.' using errcode = 'P0404';
  end if;
  v_relations := jsonb_build_object(
    'record_shares', coalesce((
      select jsonb_agg(to_jsonb(share))
      from public.record_shares share
      where share.resource_type = 'photo_studio_photo' and share.resource_id = p_id and share.owner_id = p_owner
    ), '[]'::jsonb)
  );
  delete from public.record_shares where resource_type = 'photo_studio_photo' and resource_id = p_id and owner_id = p_owner;
  delete from public.photo_studio_photos where id = p_id and user_id = p_owner;
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'photo_studio_photo',
    coalesce(nullif(v_row ->> 'title', ''), 'Untitled photo'),
    jsonb_build_object('space', 'photo_studio', 'folderId', v_row -> 'folder_id', 'recordType', v_row ->> 'category'),
    jsonb_build_object('row', v_row, 'relations', v_relations),
    jsonb_build_array(v_row ->> 'file_key'),
    'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash);
end;
$function$;

-- 3. Trash restore: bring the photo back and re-create its shares.
create or replace function public.persora_photo_studio_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_note text := null;
  v_share jsonb;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id and owner_id = p_owner and kind = 'photo_studio_photo'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  if (v_row ->> 'folder_id') is not null and not exists (
    select 1 from public.vault_folders
    where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner and scope = 'photo-studio'
  ) then
    v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
    v_note := 'Restored without its folder because that folder no longer exists.';
  end if;

  insert into public.photo_studio_photos select * from jsonb_populate_record(null::public.photo_studio_photos, v_row);
  -- Re-create the member shares that existed when the photo was trashed.
  for v_share in select value from jsonb_array_elements(coalesce(v_trash.payload -> 'relations' -> 'record_shares', '[]'::jsonb)) loop
    begin
      insert into public.record_shares select * from jsonb_populate_record(null::public.record_shares, v_share);
    exception when unique_violation or foreign_key_violation then null;
    end;
  end loop;
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note);
end;
$function$;

revoke all on function public.persora_photo_studio_trash_move(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_photo_studio_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_photo_studio_trash_move(uuid, uuid) to service_role;
grant execute on function public.persora_photo_studio_trash_restore(uuid, uuid) to service_role;
