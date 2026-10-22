-- Persora PDF Studio (2026-10-23)
-- Saved PDF documents created or edited in the browser-side PDF Studio.
--
-- Persistence model:
--   * PDFs are created and edited entirely in the browser. Nothing is stored
--     until the member presses "Save to Persora". Only then does the API upload
--     ONE object to R2 and call persora_pdf_studio_save() (new PDF, optional
--     new folder in the same transaction) or persora_pdf_studio_replace_file()
--     (update a saved PDF). If the call fails the API deletes the just-uploaded
--     object, so a failed save never leaves an orphan file or a partial row.
--     A replaced file is deleted only after the new file is committed.
--   * Deleting moves the row into the global Trash (7-day restore window). The
--     R2 object is released by the existing Trash purge pipeline.
-- Requires 202610220002_global_trash.sql and 202610220006_photo_studio.sql.

-- 1. PDF Studio page folders reuse the shared vault_folders table.
alter table public.vault_folders drop constraint if exists vault_folders_scope_check;
alter table public.vault_folders add constraint vault_folders_scope_check check (scope in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases', 'accounts',
  'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes',
  'contacts', 'business-cards', 'medical-records', 'password-manager', 'photo-studio',
  'pdf-studio'
));

-- 2. Saved PDF documents.
create table if not exists public.pdf_studio_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  folder_id uuid references public.vault_folders(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  notes text not null default '' check (char_length(notes) <= 1000),
  file_key text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_size bigint not null check (file_size > 0),
  page_count integer not null check (page_count between 1 and 5000),
  -- Small first-page preview (JPEG data URL) rendered in the browser at save time,
  -- so the library never has to download or parse PDFs just to show cards.
  thumbnail text check (thumbnail is null or (char_length(thumbnail) <= 60000 and thumbnail like 'data:image/jpeg;base64,%')),
  -- Non-sensitive document facts (PDF version, page size, how it was made…).
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pdf_studio_documents_owner_updated_idx on public.pdf_studio_documents(user_id, updated_at desc);
create index if not exists pdf_studio_documents_owner_folder_idx on public.pdf_studio_documents(user_id, folder_id);

alter table public.pdf_studio_documents enable row level security;
-- All access goes through the authenticated Pages API (service role), which
-- scopes every query to the signed-in owner. Browsers never query it directly.
revoke all on public.pdf_studio_documents from anon, authenticated;
grant all on public.pdf_studio_documents to service_role;

-- A document's folder must belong to the same owner and to the PDF Studio page.
create or replace function public.persora_pdf_studio_folder_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.vault_folders folder
    where folder.id = new.folder_id and folder.user_id = new.user_id and folder.scope = 'pdf-studio'
  ) then
    raise exception 'Choose a PDF Studio folder from your account.' using errcode = 'P0403';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
drop trigger if exists pdf_studio_documents_folder_guard on public.pdf_studio_documents;
create trigger pdf_studio_documents_folder_guard
  before insert or update of folder_id, title, notes, file_key on public.pdf_studio_documents
  for each row execute function public.persora_pdf_studio_folder_guard();

-- 3. Global Trash learns the new kind.
alter table public.trash_items drop constraint if exists trash_items_kind_check;
alter table public.trash_items add constraint trash_items_kind_check check (kind in (
  'vault_item', 'contact', 'business_card', 'medical_record', 'timeline_event', 'photo_studio_photo', 'pdf_studio_document'
));

-- 4. Atomic save: optional new folder + document row in one transaction.
create or replace function public.persora_pdf_studio_save(
  p_owner uuid,
  p_folder_id uuid,
  p_new_folder_name text,
  p_new_folder_color text,
  p_title text,
  p_notes text,
  p_file_key text,
  p_file_name text,
  p_file_size bigint,
  p_page_count integer,
  p_thumbnail text,
  p_metadata jsonb
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
  v_document public.pdf_studio_documents%rowtype;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 12) <> p_owner::text || '/pdf-studio/' then
    raise exception 'The uploaded PDF is not stored in your account.' using errcode = 'P0403';
  end if;

  if v_name <> '' then
    if char_length(v_name) > 64 then
      raise exception 'Enter a folder name between 1 and 64 characters.' using errcode = 'P0400';
    end if;
    -- Reuse an existing PDF Studio folder with the same name instead of failing.
    select * into v_folder from public.vault_folders
    where user_id = p_owner and scope = 'pdf-studio' and lower(name) = lower(v_name)
    limit 1;
    if not found then
      insert into public.vault_folders (user_id, scope, name, color)
      values (p_owner, 'pdf-studio', v_name,
        case when p_new_folder_color in ('blue','sky','teal','violet','amber','rose','slate','mint') then p_new_folder_color else 'blue' end)
      returning * into v_folder;
      v_created_folder := true;
    end if;
    v_folder_id := v_folder.id;
  elsif p_folder_id is not null then
    select * into v_folder from public.vault_folders
    where id = p_folder_id and user_id = p_owner and scope = 'pdf-studio';
    if not found then
      raise exception 'That folder is no longer available. Choose another folder.' using errcode = 'P0404';
    end if;
    v_folder_id := v_folder.id;
  end if;

  insert into public.pdf_studio_documents (
    user_id, folder_id, title, notes, file_key, file_name, file_size, page_count, thumbnail, metadata
  ) values (
    p_owner, v_folder_id, btrim(p_title), coalesce(p_notes, ''), p_file_key, p_file_name, p_file_size, p_page_count, p_thumbnail, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_document;

  return jsonb_build_object(
    'document', to_jsonb(v_document),
    'folder', case when v_folder_id is null then null else jsonb_build_object(
      'id', v_folder.id, 'scope', v_folder.scope, 'name', v_folder.name, 'color', v_folder.color,
      'pinned', v_folder.pinned, 'created_at', v_folder.created_at, 'updated_at', v_folder.updated_at
    ) end,
    'createdFolder', v_created_folder
  );
end;
$function$;

-- 5. Update a saved PDF with a new file (Save to Persora → update). Returns the
-- previous object key so the API can delete it after this commit.
create or replace function public.persora_pdf_studio_replace_file(
  p_owner uuid,
  p_id uuid,
  p_file_key text,
  p_file_name text,
  p_file_size bigint,
  p_page_count integer,
  p_thumbnail text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_previous text;
  v_document public.pdf_studio_documents%rowtype;
begin
  if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 12) <> p_owner::text || '/pdf-studio/' then
    raise exception 'The uploaded PDF is not stored in your account.' using errcode = 'P0403';
  end if;
  select file_key into v_previous from public.pdf_studio_documents where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That PDF is no longer in your PDF Studio. Save it as a new PDF instead.' using errcode = 'P0404';
  end if;
  update public.pdf_studio_documents
  set file_key = p_file_key, file_name = p_file_name, file_size = p_file_size, page_count = p_page_count,
      thumbnail = p_thumbnail, metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_id and user_id = p_owner
  returning * into v_document;
  return jsonb_build_object('document', to_jsonb(v_document), 'previousKey', v_previous);
end;
$function$;

-- 6. Move a document to the global Trash (snapshot + delete, one transaction).
create or replace function public.persora_pdf_studio_trash_move(p_owner uuid, p_id uuid)
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
  select to_jsonb(document) into v_row from public.pdf_studio_documents document where document.id = p_id and document.user_id = p_owner;
  if v_row is null then
    raise exception 'That PDF is not available in your account.' using errcode = 'P0404';
  end if;
  delete from public.pdf_studio_documents where id = p_id and user_id = p_owner;
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'pdf_studio_document',
    coalesce(nullif(v_row ->> 'title', ''), 'Untitled PDF'),
    jsonb_build_object('space', 'pdf_studio', 'folderId', v_row -> 'folder_id', 'recordType', 'pdf'),
    jsonb_build_object('row', v_row, 'relations', '{}'::jsonb),
    jsonb_build_array(v_row ->> 'file_key'),
    'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash);
end;
$function$;

-- 7. Restore a PDF Studio Trash entry. A missing folder falls back to
-- "no folder" with a note; the document itself is never silently discarded.
create or replace function public.persora_pdf_studio_trash_restore(p_owner uuid, p_trash_id uuid)
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
  where id = p_trash_id and owner_id = p_owner and kind = 'pdf_studio_document'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  if (v_row ->> 'folder_id') is not null and not exists (
    select 1 from public.vault_folders
    where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner and scope = 'pdf-studio'
  ) then
    v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
    v_note := 'Restored without its folder because that folder no longer exists.';
  end if;

  insert into public.pdf_studio_documents select * from jsonb_populate_record(null::public.pdf_studio_documents, v_row);
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note);
end;
$function$;

revoke all on function public.persora_pdf_studio_save(uuid, uuid, text, text, text, text, text, text, bigint, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.persora_pdf_studio_replace_file(uuid, uuid, text, text, bigint, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.persora_pdf_studio_trash_move(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_pdf_studio_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_pdf_studio_save(uuid, uuid, text, text, text, text, text, text, bigint, integer, text, jsonb) to service_role;
grant execute on function public.persora_pdf_studio_replace_file(uuid, uuid, text, text, bigint, integer, text, jsonb) to service_role;
grant execute on function public.persora_pdf_studio_trash_move(uuid, uuid) to service_role;
grant execute on function public.persora_pdf_studio_trash_restore(uuid, uuid) to service_role;
