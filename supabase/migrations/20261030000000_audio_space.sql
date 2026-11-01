-- ============================================================================
-- Persora AudioSpace (Private Audio Library)
-- Stores, records, organizes and plays audio in one private personal archive.
-- Uploaded/recorded audio lives in the private VAULT_FILES R2 bucket under
-- "<owner>/audio-space/"; external audio links keep only the URL + metadata.
-- All RLS policies strictly use public.persora_jwt_uid() and never raw auth.uid().
-- ============================================================================

-- 1. Extend global Trash kind constraint to support 'audio_space_item'
alter table public.trash_items
  drop constraint if exists trash_items_kind_check;

alter table public.trash_items
  add constraint trash_items_kind_check
  check (
    kind = any (
      array[
        'vault_item'::text,
        'contact'::text,
        'business_card'::text,
        'medical_record'::text,
        'timeline_event'::text,
        'photo_studio_photo'::text,
        'pdf_studio_document'::text,
        'persora_table'::text,
        'persora_doc'::text,
        'audio_space_item'::text
      ]
    )
  );

-- 2. Extend the shared folder scopes so AudioSpace reuses vault_folders
alter table public.vault_folders
  drop constraint if exists vault_folders_scope_check;

alter table public.vault_folders
  add constraint vault_folders_scope_check
  check (
    scope = any (
      array[
        'documents'::text, 'academics'::text, 'subscriptions'::text, 'family'::text,
        'purchases'::text, 'accounts'::text, 'memberships'::text, 'wallet-cards'::text,
        'study'::text, 'business-card'::text, 'urls'::text, 'notes'::text,
        'contacts'::text, 'business-cards'::text, 'medical-records'::text,
        'password-manager'::text, 'photo-studio'::text, 'pdf-studio'::text,
        'audio-space'::text
      ]
    )
  );

-- 3. Core AudioSpace library table
--    source = 'upload' | 'recording' → private R2 file (file_key set, external_url null)
--    source = 'link'                → external audio URL (external_url set, file_key null)
create table if not exists public.audio_space_items (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  title text not null,
  description text not null default ''::text,
  source text not null default 'upload'::text,
  file_key text,
  file_name text,
  file_size bigint,
  file_type text,
  duration_seconds numeric(14,3),
  external_url text,
  tags text[] not null default '{}'::text[],
  favorite boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  last_played_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint audio_space_items_pkey primary key (id),
  constraint audio_space_items_file_key_key unique (file_key),
  constraint audio_space_items_folder_id_fkey foreign key (folder_id) references public.vault_folders(id) on delete set null,
  constraint audio_space_items_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint audio_space_items_source_check check (source = any (array['upload'::text, 'recording'::text, 'link'::text])),
  constraint audio_space_items_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 120),
  constraint audio_space_items_description_check check (char_length(description) <= 1000),
  constraint audio_space_items_duration_check check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 604800)),
  constraint audio_space_items_file_size_check check (file_size is null or file_size > 0),
  constraint audio_space_items_file_name_check check (file_name is null or (char_length(file_name) >= 1 and char_length(file_name) <= 200)),
  constraint audio_space_items_file_type_check check (file_type is null or file_type = any (array['audio/mpeg'::text, 'audio/wav'::text, 'audio/mp4'::text, 'audio/aac'::text, 'audio/ogg'::text, 'audio/flac'::text, 'audio/webm'::text])),
  constraint audio_space_items_source_shape_check check (
    (source = 'link'::text and external_url is not null and file_key is null)
    or (source <> 'link'::text and file_key is not null and external_url is null)
  ),
  constraint audio_space_items_external_url_check check (external_url is null or char_length(external_url) <= 2000),
  constraint audio_space_items_tags_check check (cardinality(tags) <= 24 and pg_column_size(tags) <= 4096),
  constraint audio_space_items_metadata_check check (jsonb_typeof(metadata) = 'object'::text and pg_column_size(metadata) <= 8192)
);

create index if not exists audio_space_items_user_created_idx
  on public.audio_space_items using btree (user_id, created_at desc);

create index if not exists audio_space_items_user_folder_idx
  on public.audio_space_items using btree (user_id, folder_id);

create index if not exists audio_space_items_user_favorite_idx
  on public.audio_space_items using btree (user_id, favorite);

alter table public.audio_space_items enable row level security;
revoke all on public.audio_space_items from public, anon, authenticated;
grant all on public.audio_space_items to service_role;

-- 4. Folder/ownership guard (folder must belong to the same account + scope)
CREATE OR REPLACE FUNCTION public.persora_audio_space_folder_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.vault_folders folder
    where folder.id = new.folder_id and folder.user_id = new.user_id and folder.scope = 'audio-space'
  ) then
    raise exception 'Choose an AudioSpace folder from your account.' using errcode = 'P0403';
  end if;
  if cardinality(new.tags) > 24 then
    raise exception 'Keep tags to 24 or fewer per audio.' using errcode = 'P0400';
  end if;
  if exists (select 1 from unnest(new.tags) tag where char_length(btrim(tag)) < 1 or char_length(btrim(tag)) > 40) then
    raise exception 'Each tag must be between 1 and 40 characters.' using errcode = 'P0400';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists audio_space_items_folder_guard on public.audio_space_items;
CREATE TRIGGER audio_space_items_folder_guard BEFORE INSERT OR UPDATE OF folder_id, title, description, tags ON public.audio_space_items FOR EACH ROW EXECUTE FUNCTION persora_audio_space_folder_guard();

-- 5. Transactional save: item + optional new folder in one step
CREATE OR REPLACE FUNCTION public.persora_audio_space_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_title text, p_description text, p_source text, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text, p_duration numeric, p_external_url text, p_tags text[], p_favorite boolean, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_folder public.vault_folders%rowtype;
  v_folder_id uuid := null;
  v_created_folder boolean := false;
  v_name text := btrim(coalesce(p_new_folder_name, ''));
  v_item public.audio_space_items%rowtype;
  v_source text := coalesce(p_source, 'upload');
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  if v_source not in ('upload', 'recording', 'link') then
    raise exception 'Choose a valid audio source.' using errcode = 'P0400';
  end if;

  if v_name <> '' then
    if char_length(v_name) > 64 then
      raise exception 'Enter a folder name between 1 and 64 characters.' using errcode = 'P0400';
    end if;
    -- Reuse an existing AudioSpace folder with the same name instead of failing.
    select * into v_folder from public.vault_folders
    where user_id = p_owner and scope = 'audio-space' and lower(name) = lower(v_name)
    limit 1;
    if not found then
      insert into public.vault_folders (user_id, scope, name, color)
      values (p_owner, 'audio-space', v_name,
        case when p_new_folder_color in ('blue','sky','teal','violet','amber','rose','slate','mint') then p_new_folder_color else 'blue' end)
      returning * into v_folder;
      v_created_folder := true;
    end if;
    v_folder_id := v_folder.id;
  elsif p_folder_id is not null then
    select * into v_folder from public.vault_folders
    where id = p_folder_id and user_id = p_owner and scope = 'audio-space';
    if not found then
      raise exception 'That folder is no longer available. Choose another folder.' using errcode = 'P0404';
    end if;
    v_folder_id := v_folder.id;
  end if;

  if v_source = 'link' then
    if p_external_url is null or char_length(p_external_url) < 10 or char_length(p_external_url) > 2000 then
      raise exception 'Provide a valid audio link to save.' using errcode = 'P0400';
    end if;
    if p_file_key is not null then
      raise exception 'An audio link cannot carry an uploaded file.' using errcode = 'P0400';
    end if;
  else
    if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 13) <> p_owner::text || '/audio-space/' then
      raise exception 'The uploaded audio is not stored in your account.' using errcode = 'P0403';
    end if;
  end if;

  insert into public.audio_space_items (
    user_id, folder_id, title, description, source, file_key, file_name, file_size, file_type,
    duration_seconds, external_url, tags, favorite, metadata
  ) values (
    p_owner, v_folder_id, btrim(p_title), coalesce(p_description, ''), v_source, p_file_key, p_file_name, p_file_size, p_file_type,
    p_duration, p_external_url, coalesce(p_tags, '{}'::text[]), coalesce(p_favorite, false), coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_item;

  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'folder', case when v_folder_id is null then null else jsonb_build_object(
      'id', v_folder.id, 'scope', v_folder.scope, 'name', v_folder.name, 'color', v_folder.color,
      'pinned', v_folder.pinned, 'created_at', v_folder.created_at, 'updated_at', v_folder.updated_at
    ) end,
    'createdFolder', v_created_folder
  );
end;
$function$;
revoke all on function public.persora_audio_space_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_title text, p_description text, p_source text, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text, p_duration numeric, p_external_url text, p_tags text[], p_favorite boolean, p_metadata jsonb) from public, anon, authenticated;
grant execute on function public.persora_audio_space_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_title text, p_description text, p_source text, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text, p_duration numeric, p_external_url text, p_tags text[], p_favorite boolean, p_metadata jsonb) to service_role;

-- 6. Soft delete into the global 7-day Trash
CREATE OR REPLACE FUNCTION public.persora_audio_space_trash_move(p_owner uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_keys jsonb;
begin
  select to_jsonb(item) into v_row from public.audio_space_items item where item.id = p_id and item.user_id = p_owner;
  if v_row is null then
    raise exception 'That audio is not available in your account.' using errcode = 'P0404';
  end if;
  if v_row ->> 'file_key' is null then
    v_keys := '[]'::jsonb;
  else
    v_keys := jsonb_build_array(v_row ->> 'file_key');
  end if;
  delete from public.audio_space_items where id = p_id and user_id = p_owner;
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'audio_space_item',
    coalesce(nullif(v_row ->> 'title', ''), 'Untitled audio'),
    jsonb_build_object('space', 'audio_space', 'folderId', v_row -> 'folder_id', 'recordType', v_row ->> 'source'),
    jsonb_build_object('row', v_row, 'relations', '{}'::jsonb),
    v_keys,
    'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash);
end;
$function$;
revoke all on function public.persora_audio_space_trash_move(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_audio_space_trash_move(p_owner uuid, p_id uuid) to service_role;

-- 7. Restore from Trash (folder loss falls back to "no folder")
CREATE OR REPLACE FUNCTION public.persora_audio_space_trash_restore(p_owner uuid, p_trash_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_note text := null;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id and owner_id = p_owner and kind = 'audio_space_item'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  if (v_row ->> 'folder_id') is not null and not exists (
    select 1 from public.vault_folders
    where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner and scope = 'audio-space'
  ) then
    v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
    v_note := 'Restored without its folder because that folder no longer exists.';
  end if;

  insert into public.audio_space_items select * from jsonb_populate_record(null::public.audio_space_items, v_row);
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note);
end;
$function$;
revoke all on function public.persora_audio_space_trash_restore(p_owner uuid, p_trash_id uuid) from public, anon, authenticated;
grant execute on function public.persora_audio_space_trash_restore(p_owner uuid, p_trash_id uuid) to service_role;

-- 8. Account backup export
CREATE OR REPLACE FUNCTION public.persora_audio_space_export(p_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_items jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at asc), '[]'::jsonb)
  into v_items
  from public.audio_space_items item
  where item.user_id = p_owner;
  return jsonb_build_object('audioItems', v_items);
end;
$function$;
revoke all on function public.persora_audio_space_export(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_audio_space_export(p_owner uuid) to service_role;
