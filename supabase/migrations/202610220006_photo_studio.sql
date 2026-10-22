-- Persora Photo Studio (2026-10-22)
-- Saved official photographs (passport, stamp, visa, ID card, job application,
-- other formal photos) with dimension/print metadata and edit provenance.
--
-- Persistence model:
--   * The browser keeps a selected or edited photo in memory until the member
--     presses the final Save. Only then does the API upload ONE object to R2 and
--     call persora_photo_studio_save(), which creates the optional new folder and
--     the photo row in a single transaction. If that call fails the API deletes
--     the just-uploaded object, so a failed save never leaves an orphan file or a
--     partial row.
--   * Editing a saved photo always creates a NEW row (source_photo_id points at
--     the original); the original row and its R2 object are never modified.
--   * Deleting moves the row into the global Trash (7-day restore window). The
--     R2 object is released by the existing Trash purge pipeline.
-- Requires 202610220002_global_trash.sql.

-- 1. Photo Studio page folders reuse the shared vault_folders table.
alter table public.vault_folders drop constraint if exists vault_folders_scope_check;
alter table public.vault_folders add constraint vault_folders_scope_check check (scope in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases', 'accounts',
  'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes',
  'contacts', 'business-cards', 'medical-records', 'password-manager', 'photo-studio'
));

-- 2. Saved photographs.
create table if not exists public.photo_studio_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  folder_id uuid references public.vault_folders(id) on delete set null,
  -- The saved photo this one was edited from. Deliberately not a foreign key:
  -- the link survives the original moving to (and back from) the Trash, and the
  -- UI treats a missing original as "original deleted".
  source_photo_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  category text not null default 'passport' check (category in ('passport', 'stamp', 'visa', 'id-card', 'job-application', 'other')),
  notes text not null default '' check (char_length(notes) <= 1000),
  file_key text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_size bigint not null check (file_size > 0),
  file_type text not null check (file_type in ('image/jpeg', 'image/png', 'image/webp')),
  width_px integer not null check (width_px between 1 and 20000),
  height_px integer not null check (height_px between 1 and 20000),
  dpi numeric(8,2) check (dpi is null or (dpi >= 1 and dpi <= 10000)),
  -- Local, non-AI analysis results (aspect ratio, matched preset, print size…).
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  -- Editor settings for edited versions (crop, size preset, background, adjustments…).
  edit_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(edit_settings) = 'object' and pg_column_size(edit_settings) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_studio_photos_owner_updated_idx on public.photo_studio_photos(user_id, updated_at desc);
create index if not exists photo_studio_photos_owner_folder_idx on public.photo_studio_photos(user_id, folder_id);
create index if not exists photo_studio_photos_owner_source_idx on public.photo_studio_photos(user_id, source_photo_id) where source_photo_id is not null;

alter table public.photo_studio_photos enable row level security;
-- All access goes through the authenticated Pages API (service role), which
-- scopes every query to the signed-in owner. Browsers never query it directly.
revoke all on public.photo_studio_photos from anon, authenticated;
grant all on public.photo_studio_photos to service_role;

-- A photo's folder must belong to the same owner and to the Photo Studio page.
create or replace function public.persora_photo_studio_folder_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.vault_folders folder
    where folder.id = new.folder_id and folder.user_id = new.user_id and folder.scope = 'photo-studio'
  ) then
    raise exception 'Choose a Photo Studio folder from your account.' using errcode = 'P0403';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
drop trigger if exists photo_studio_photos_folder_guard on public.photo_studio_photos;
create trigger photo_studio_photos_folder_guard
  before insert or update of folder_id, title, category, notes on public.photo_studio_photos
  for each row execute function public.persora_photo_studio_folder_guard();

-- 3. Global Trash learns the new kind.
alter table public.trash_items drop constraint if exists trash_items_kind_check;
alter table public.trash_items add constraint trash_items_kind_check check (kind in (
  'vault_item', 'contact', 'business_card', 'medical_record', 'timeline_event', 'photo_studio_photo'
));

-- 4. Atomic save: optional new folder + photo row in one transaction.
create or replace function public.persora_photo_studio_save(
  p_owner uuid,
  p_folder_id uuid,
  p_new_folder_name text,
  p_new_folder_color text,
  p_source_photo_id uuid,
  p_title text,
  p_category text,
  p_notes text,
  p_file_key text,
  p_file_name text,
  p_file_size bigint,
  p_file_type text,
  p_width integer,
  p_height integer,
  p_dpi numeric,
  p_metadata jsonb,
  p_edit_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_folder public.vault_folders%rowtype;
  v_folder_id uuid := null;
  v_created_folder boolean := false;
  v_name text := btrim(coalesce(p_new_folder_name, ''));
  v_photo public.photo_studio_photos%rowtype;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 14) <> p_owner::text || '/photo-studio/' then
    raise exception 'The uploaded photo is not stored in your account.' using errcode = 'P0403';
  end if;

  if v_name <> '' then
    if char_length(v_name) > 64 then
      raise exception 'Enter a folder name between 1 and 64 characters.' using errcode = 'P0400';
    end if;
    -- Reuse an existing Photo Studio folder with the same name instead of failing.
    select * into v_folder from public.vault_folders
    where user_id = p_owner and scope = 'photo-studio' and lower(name) = lower(v_name)
    limit 1;
    if not found then
      insert into public.vault_folders (user_id, scope, name, color)
      values (p_owner, 'photo-studio', v_name,
        case when p_new_folder_color in ('blue','sky','teal','violet','amber','rose','slate','mint') then p_new_folder_color else 'blue' end)
      returning * into v_folder;
      v_created_folder := true;
    end if;
    v_folder_id := v_folder.id;
  elsif p_folder_id is not null then
    select * into v_folder from public.vault_folders
    where id = p_folder_id and user_id = p_owner and scope = 'photo-studio';
    if not found then
      raise exception 'That folder is no longer available. Choose another folder.' using errcode = 'P0404';
    end if;
    v_folder_id := v_folder.id;
  end if;

  if p_source_photo_id is not null and not exists (
    select 1 from public.photo_studio_photos where id = p_source_photo_id and user_id = p_owner
  ) then
    raise exception 'The original photo is no longer available.' using errcode = 'P0404';
  end if;

  insert into public.photo_studio_photos (
    user_id, folder_id, source_photo_id, title, category, notes, file_key, file_name, file_size, file_type,
    width_px, height_px, dpi, metadata, edit_settings
  ) values (
    p_owner, v_folder_id, p_source_photo_id, btrim(p_title), p_category, coalesce(p_notes, ''), p_file_key, p_file_name, p_file_size, p_file_type,
    p_width, p_height, p_dpi, coalesce(p_metadata, '{}'::jsonb), coalesce(p_edit_settings, '{}'::jsonb)
  )
  returning * into v_photo;

  return jsonb_build_object(
    'photo', to_jsonb(v_photo),
    'folder', case when v_folder_id is null then null else jsonb_build_object(
      'id', v_folder.id, 'scope', v_folder.scope, 'name', v_folder.name, 'color', v_folder.color,
      'pinned', v_folder.pinned, 'created_at', v_folder.created_at, 'updated_at', v_folder.updated_at
    ) end,
    'createdFolder', v_created_folder
  );
end;
$function$;

-- 5. Move a photo to the global Trash (snapshot + delete, one transaction).
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
begin
  select to_jsonb(photo) into v_row from public.photo_studio_photos photo where photo.id = p_id and photo.user_id = p_owner;
  if v_row is null then
    raise exception 'That photo is not available in your account.' using errcode = 'P0404';
  end if;
  delete from public.photo_studio_photos where id = p_id and user_id = p_owner;
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'photo_studio_photo',
    coalesce(nullif(v_row ->> 'title', ''), 'Untitled photo'),
    jsonb_build_object('space', 'photo_studio', 'folderId', v_row -> 'folder_id', 'recordType', v_row ->> 'category'),
    jsonb_build_object('row', v_row, 'relations', '{}'::jsonb),
    jsonb_build_array(v_row ->> 'file_key'),
    'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash);
end;
$function$;

-- 6. Restore a Photo Studio Trash entry. A missing folder falls back to
-- "no folder" with a note; the photo itself is never silently discarded.
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
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note);
end;
$function$;

revoke all on function public.persora_photo_studio_save(uuid, uuid, text, text, uuid, text, text, text, text, text, bigint, text, integer, integer, numeric, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_photo_studio_trash_move(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_photo_studio_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_photo_studio_save(uuid, uuid, text, text, uuid, text, text, text, text, text, bigint, text, integer, integer, numeric, jsonb, jsonb) to service_role;
grant execute on function public.persora_photo_studio_trash_move(uuid, uuid) to service_role;
grant execute on function public.persora_photo_studio_trash_restore(uuid, uuid) to service_role;
