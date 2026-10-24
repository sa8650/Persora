-- Persora Table: lightweight spreadsheets and Smart Tables.
--
-- Requires 202610220002_global_trash.sql (trash_items) and runs after
-- 202610290001_loans.sql. Additive only: new tables, functions and one more
-- Global Trash kind; nothing existing is altered or dropped except the trash
-- kind check, which is re-created with every previous kind plus 'persora_table'.
--
-- Access model: every table is private to its owner. Tables are closed to
-- anon/authenticated (RLS on, no policies); the Pages API calls the
-- security-definer functions below with the service role and passes the
-- signed-in member's id as p_owner, which scopes every statement.
--
-- Saving: each table has a revision. A save names the revision it was based on
-- and a batch id. A stale base revision returns {conflict: true} (nothing is
-- written); a repeated batch id (a retry after a lost response) returns the
-- current revision without applying anything twice. A batch is applied in one
-- transaction, so it is all-or-nothing.

-- 1. Tables -------------------------------------------------------------------

create table if not exists public.persora_tables (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('spreadsheet', 'smart')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  label text not null default '' check (char_length(label) <= 40),
  starred boolean not null default false,
  template text check (template is null or template ~ '^[a-z0-9-]{1,40}$'),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  revision bigint not null default 1 check (revision >= 1),
  last_batch_id uuid,
  sheet_count integer not null default 0 check (sheet_count between 0 and 20),
  record_count integer not null default 0 check (record_count between 0 and 5000),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opened_at timestamptz
);
create index if not exists persora_tables_owner_idx on public.persora_tables(user_id, updated_at desc);

create table if not exists public.persora_table_sheets (
  id uuid primary key,
  table_id uuid not null references public.persora_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null check (position between 0 and 1000),
  name text not null check (char_length(btrim(name)) between 1 and 31),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
create index if not exists persora_table_sheets_table_idx on public.persora_table_sheets(table_id, position);

create table if not exists public.persora_table_records (
  id uuid primary key,
  table_id uuid not null references public.persora_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position bigint not null,
  "values" jsonb not null default '{}'::jsonb check (jsonb_typeof("values") = 'object'),
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists persora_table_records_table_idx on public.persora_table_records(table_id, position);

-- Attachment ids are unique within a table; a duplicated table keeps the same
-- ids (so record values stay valid) and shares the stored file, which is only
-- deleted from storage when no table or Trash entry references it any more.
create table if not exists public.persora_table_attachments (
  table_id uuid not null references public.persora_tables(id) on delete cascade,
  id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_key text not null check (file_key like (user_id::text || '/persora-table/%') and char_length(file_key) <= 400),
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_type text not null default 'application/octet-stream' check (char_length(file_type) <= 120),
  file_size bigint not null check (file_size >= 0),
  created_at timestamptz not null default now(),
  primary key (table_id, id)
);
create index if not exists persora_table_attachments_key_idx on public.persora_table_attachments(user_id, file_key);

alter table public.persora_tables enable row level security;
alter table public.persora_table_sheets enable row level security;
alter table public.persora_table_records enable row level security;
alter table public.persora_table_attachments enable row level security;
revoke all on public.persora_tables from public, anon, authenticated;
revoke all on public.persora_table_sheets from public, anon, authenticated;
revoke all on public.persora_table_records from public, anon, authenticated;
revoke all on public.persora_table_attachments from public, anon, authenticated;
grant all on public.persora_tables to service_role;
grant all on public.persora_table_sheets to service_role;
grant all on public.persora_table_records to service_role;
grant all on public.persora_table_attachments to service_role;

-- 2. Global Trash learns the new kind ------------------------------------------

alter table public.trash_items drop constraint if exists trash_items_kind_check;
alter table public.trash_items add constraint trash_items_kind_check check (kind in (
  'vault_item', 'contact', 'business_card', 'medical_record', 'timeline_event', 'photo_studio_photo', 'pdf_studio_document', 'persora_table'
));

-- 3. Internal helpers (not callable through the API) ---------------------------

create or replace function public.persora_table_summary(p_table public.persora_tables)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'id', p_table.id, 'kind', p_table.kind, 'name', p_table.name, 'label', p_table.label, 'starred', p_table.starred,
    'template', p_table.template, 'revision', p_table.revision, 'sheet_count', p_table.sheet_count, 'record_count', p_table.record_count,
    'size_bytes', p_table.size_bytes, 'created_at', p_table.created_at, 'updated_at', p_table.updated_at, 'opened_at', p_table.opened_at
  );
$function$;

-- Recomputes counts and size, and enforces the per-table limits after a change.
create or replace function public.persora_table_refresh_stats(p_id uuid)
returns public.persora_tables
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_sheets integer;
  v_records integer;
  v_bytes bigint;
begin
  select count(*), coalesce(sum(octet_length(data::text)), 0) into v_sheets, v_bytes from public.persora_table_sheets where table_id = p_id;
  select v_bytes + coalesce(sum(octet_length("values"::text)), 0), count(*) into v_bytes, v_records from public.persora_table_records where table_id = p_id;
  select * into v_table from public.persora_tables where id = p_id;
  v_bytes := v_bytes + octet_length(v_table.meta::text);
  if v_table.kind = 'spreadsheet' and v_sheets < 1 then
    raise exception 'A spreadsheet needs at least one sheet.' using errcode = 'P0422';
  end if;
  if v_sheets > 20 then
    raise exception 'A spreadsheet can have at most 20 sheets.' using errcode = 'P0422';
  end if;
  if v_records > 5000 then
    raise exception 'A Smart Table can have at most 5,000 records.' using errcode = 'P0422';
  end if;
  if v_bytes > 12 * 1024 * 1024 then
    raise exception 'This table is too large to save (the limit is 12 MB of data). Split it into smaller tables.' using errcode = 'P0413';
  end if;
  if exists (select 1 from public.persora_table_sheets where table_id = p_id group by lower(btrim(name)) having count(*) > 1) then
    raise exception 'Two sheets have the same name.' using errcode = 'P0422';
  end if;
  update public.persora_tables set sheet_count = v_sheets, record_count = v_records, size_bytes = v_bytes where id = p_id returning * into v_table;
  return v_table;
end;
$function$;

create or replace function public.persora_table_uuid_array(p_value jsonb)
returns uuid[]
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) from jsonb_array_elements_text(coalesce(p_value, '[]'::jsonb)) as value;
$function$;

-- 4. API functions ---------------------------------------------------------------

create or replace function public.persora_tables_list(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(jsonb_agg(public.persora_table_summary(t) order by t.updated_at desc), '[]'::jsonb)
  from public.persora_tables t where t.user_id = p_owner;
$function$;

create or replace function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_table public.persora_tables%rowtype;
begin
  if p_touch then
    update public.persora_tables set opened_at = clock_timestamp() where id = p_id and user_id = p_owner returning * into v_table;
  else
    select * into v_table from public.persora_tables where id = p_id and user_id = p_owner;
  end if;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'table', public.persora_table_summary(v_table) || jsonb_build_object('meta', v_table.meta),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.position, s.id) from public.persora_table_sheets s where s.table_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.position, r.created_at, r.id) from public.persora_table_records r where r.table_id = p_id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at) from public.persora_table_attachments a where a.table_id = p_id), '[]'::jsonb)
  );
end;
$function$;

-- Creates a whole table (blank, template, import or restore-as-copy) in one
-- transaction. Retrying with the same id returns {replayed: true}.
create or replace function public.persora_table_create(p_owner uuid, p_id uuid, p_table jsonb, p_sheets jsonb, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_existing public.persora_tables%rowtype;
  v_table public.persora_tables%rowtype;
  v_kind text := p_table ->> 'kind';
begin
  select * into v_existing from public.persora_tables where id = p_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That table id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('replayed', true, 'table', public.persora_table_summary(v_existing));
  end if;
  if (select count(*) from public.persora_tables where user_id = p_owner) >= 300 then
    raise exception 'You can have up to 300 tables. Delete some you no longer need to create more.' using errcode = 'P0409';
  end if;
  if v_kind = 'spreadsheet' and (jsonb_array_length(coalesce(p_records, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheets, '[]'::jsonb)) < 1) then
    raise exception 'A spreadsheet needs sheets and has no records.' using errcode = 'P0422';
  end if;
  if v_kind = 'smart' and jsonb_array_length(coalesce(p_sheets, '[]'::jsonb)) > 0 then
    raise exception 'A Smart Table has no sheets.' using errcode = 'P0422';
  end if;
  insert into public.persora_tables (id, user_id, kind, name, label, template, meta)
  values (p_id, p_owner, v_kind, btrim(p_table ->> 'name'), coalesce(p_table ->> 'label', ''), nullif(p_table ->> 'template', ''), coalesce(p_table -> 'meta', '{}'::jsonb));
  insert into public.persora_table_sheets (id, table_id, user_id, position, name, data)
  select (s ->> 'id')::uuid, p_id, p_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data'
  from jsonb_array_elements(coalesce(p_sheets, '[]'::jsonb)) s;
  insert into public.persora_table_records (id, table_id, user_id, position, "values", is_example)
  select (r ->> 'id')::uuid, p_id, p_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false)
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r;
  v_table := public.persora_table_refresh_stats(p_id);
  return jsonb_build_object('replayed', false, 'table', public.persora_table_summary(v_table));
end;
$function$;

-- Applies one save batch. See the header for the revision/batch contract.
create or replace function public.persora_table_save(
  p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb,
  p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sheet_ids uuid[];
  v_record_ids uuid[];
begin
  select * into v_table from public.persora_tables where id = p_id and user_id = p_owner for update;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  if v_table.last_batch_id = p_batch then
    return jsonb_build_object('ok', true, 'replayed', true, 'table', public.persora_table_summary(v_table));
  end if;
  if v_table.revision <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'table', public.persora_table_summary(v_table));
  end if;
  if v_table.kind = 'spreadsheet' and (p_meta is not null or jsonb_array_length(coalesce(p_record_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_record_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Spreadsheets don''t have fields or records.' using errcode = 'P0422';
  end if;
  if v_table.kind = 'smart' and (jsonb_array_length(coalesce(p_sheet_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheet_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Smart Tables don''t have sheets.' using errcode = 'P0422';
  end if;

  -- Ids from the browser must belong to this table (or be new).
  select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_sheet_ids from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s;
  select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_record_ids from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r;
  if exists (select 1 from public.persora_table_sheets where id = any(v_sheet_ids) and table_id <> p_id)
     or exists (select 1 from public.persora_table_records where id = any(v_record_ids) and table_id <> p_id) then
    raise exception 'That change refers to data from another table.' using errcode = 'P0403';
  end if;

  delete from public.persora_table_sheets where table_id = p_id and id = any(public.persora_table_uuid_array(p_sheet_deletes));
  insert into public.persora_table_sheets as current (id, table_id, user_id, position, name, data, updated_at)
  select (s ->> 'id')::uuid, p_id, p_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data', v_now
  from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s
  on conflict (id) do update set position = excluded.position, name = excluded.name, data = excluded.data, updated_at = v_now
  where current.table_id = p_id;

  delete from public.persora_table_records where table_id = p_id and id = any(public.persora_table_uuid_array(p_record_deletes));
  insert into public.persora_table_records as current (id, table_id, user_id, position, "values", is_example, updated_at)
  select (r ->> 'id')::uuid, p_id, p_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false), v_now
  from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r
  on conflict (id) do update set position = excluded.position, "values" = excluded."values", is_example = excluded.is_example, updated_at = v_now
  where current.table_id = p_id;

  update public.persora_tables
  set meta = coalesce(p_meta, meta), revision = revision + 1, last_batch_id = p_batch, updated_at = v_now
  where id = p_id;
  v_table := public.persora_table_refresh_stats(p_id);
  return jsonb_build_object('ok', true, 'replayed', false, 'table', public.persora_table_summary(v_table));
end;
$function$;

-- Rename / label / star. Not part of the content revision (never conflicts).
create or replace function public.persora_table_update_info(p_owner uuid, p_id uuid, p_name text, p_label text, p_starred boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_table public.persora_tables%rowtype;
begin
  update public.persora_tables
  set name = coalesce(nullif(btrim(p_name), ''), name), label = coalesce(p_label, label), starred = coalesce(p_starred, starred)
  where id = p_id and user_id = p_owner
  returning * into v_table;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  return public.persora_table_summary(v_table);
end;
$function$;

-- Copies a table with new sheet/record ids. Attachment rows are copied with the
-- same ids and file keys (the file is shared, never duplicated in storage).
create or replace function public.persora_table_duplicate(p_owner uuid, p_source uuid, p_new_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_source public.persora_tables%rowtype;
  v_existing public.persora_tables%rowtype;
  v_table public.persora_tables%rowtype;
begin
  select * into v_existing from public.persora_tables where id = p_new_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That table id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('replayed', true, 'table', public.persora_table_summary(v_existing));
  end if;
  select * into v_source from public.persora_tables where id = p_source and user_id = p_owner;
  if v_source.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_tables where user_id = p_owner) >= 300 then
    raise exception 'You can have up to 300 tables. Delete some you no longer need to create more.' using errcode = 'P0409';
  end if;
  insert into public.persora_tables (id, user_id, kind, name, label, template, meta)
  values (p_new_id, p_owner, v_source.kind, btrim(p_name), v_source.label, v_source.template, v_source.meta);
  insert into public.persora_table_sheets (id, table_id, user_id, position, name, data)
  select gen_random_uuid(), p_new_id, p_owner, position, name, data from public.persora_table_sheets where table_id = p_source;
  insert into public.persora_table_records (id, table_id, user_id, position, "values", is_example)
  select gen_random_uuid(), p_new_id, p_owner, position, "values", is_example from public.persora_table_records where table_id = p_source;
  insert into public.persora_table_attachments (table_id, id, user_id, file_key, file_name, file_type, file_size, created_at)
  select p_new_id, id, p_owner, file_key, file_name, file_type, file_size, created_at from public.persora_table_attachments where table_id = p_source;
  v_table := public.persora_table_refresh_stats(p_new_id);
  return jsonb_build_object('replayed', false, 'table', public.persora_table_summary(v_table));
end;
$function$;

-- Moves a table to the Global Trash: a full snapshot is stored and the live rows
-- removed, in one transaction. Files stay in storage until the Trash entry is
-- permanently deleted (and then only if nothing else references them).
create or replace function public.persora_table_trash_move(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_payload jsonb;
  v_keys jsonb;
begin
  select * into v_table from public.persora_tables where id = p_id and user_id = p_owner for update;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  v_payload := jsonb_build_object(
    'row', to_jsonb(v_table),
    'sheets', coalesce((select jsonb_agg(to_jsonb(s)) from public.persora_table_sheets s where s.table_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(to_jsonb(r)) from public.persora_table_records r where r.table_id = p_id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a)) from public.persora_table_attachments a where a.table_id = p_id), '[]'::jsonb)
  );
  select coalesce(jsonb_agg(distinct a.file_key), '[]'::jsonb) into v_keys from public.persora_table_attachments a where a.table_id = p_id;
  delete from public.persora_tables where id = p_id and user_id = p_owner;
  delete from public.trash_items where id = p_id and owner_id = p_owner and status = 'active';
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'persora_table', v_table.name,
    jsonb_build_object('space', 'persora-table', 'recordType', case when v_table.kind = 'smart' then 'Smart Table' else 'Spreadsheet' end),
    v_payload, v_keys, 'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash) - 'payload';
end;
$function$;

create or replace function public.persora_table_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_note text := null;
  v_name text;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id and owner_id = p_owner and kind = 'persora_table'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;
  if exists (select 1 from public.persora_tables where id = v_trash.id) then
    raise exception 'This table already exists in your account.' using errcode = 'P0409';
  end if;
  if (select count(*) from public.persora_tables where user_id = p_owner) >= 300 then
    raise exception 'You have 300 tables, the maximum. Delete one to restore this table.' using errcode = 'P0409';
  end if;
  v_row := v_trash.payload -> 'row';
  v_name := v_row ->> 'name';
  insert into public.persora_tables select * from jsonb_populate_record(null::public.persora_tables, v_row || jsonb_build_object('last_batch_id', null, 'updated_at', clock_timestamp()));
  insert into public.persora_table_sheets select * from jsonb_populate_recordset(null::public.persora_table_sheets, coalesce(v_trash.payload -> 'sheets', '[]'::jsonb));
  insert into public.persora_table_records select * from jsonb_populate_recordset(null::public.persora_table_records, coalesce(v_trash.payload -> 'records', '[]'::jsonb));
  insert into public.persora_table_attachments select * from jsonb_populate_recordset(null::public.persora_table_attachments, coalesce(v_trash.payload -> 'attachments', '[]'::jsonb));
  perform public.persora_table_refresh_stats(v_trash.id);
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note, 'name', v_name);
end;
$function$;

create or replace function public.persora_table_attachment_add(
  p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.persora_table_attachments%rowtype;
begin
  if not exists (select 1 from public.persora_tables where id = p_table and user_id = p_owner and kind = 'smart') then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_table_attachments where table_id = p_table) >= 500 then
    raise exception 'A table can hold up to 500 files.' using errcode = 'P0409';
  end if;
  insert into public.persora_table_attachments (table_id, id, user_id, file_key, file_name, file_type, file_size)
  values (p_table, p_id, p_owner, p_key, p_name, p_type, p_size)
  on conflict (table_id, id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.persora_table_attachments where table_id = p_table and id = p_id and user_id = p_owner and file_key = p_key;
    if v_row.id is null then
      raise exception 'That file id is already in use.' using errcode = 'P0409';
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'created_at', v_row.created_at);
end;
$function$;

-- Removes attachment rows the table no longer references (older than the grace
-- cutoff so recent removals can still be undone) and returns their keys. The
-- caller deletes a stored file only when no other row or Trash entry uses it.
create or replace function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_keys jsonb;
begin
  with removed as (
    delete from public.persora_table_attachments
    where table_id = p_table and user_id = p_owner and created_at < p_before
      and not (id = any(public.persora_table_uuid_array(p_keep)))
    returning file_key
  )
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys from removed;
  return v_keys;
end;
$function$;

create or replace function public.persora_tables_export(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'tables', coalesce((select jsonb_agg(public.persora_table_summary(t) || jsonb_build_object('meta', t.meta) order by t.created_at) from public.persora_tables t where t.user_id = p_owner), '[]'::jsonb),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'table_id', s.table_id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.table_id, s.position) from public.persora_table_sheets s where s.user_id = p_owner), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'table_id', r.table_id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.table_id, r.position) from public.persora_table_records r where r.user_id = p_owner), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'table_id', a.table_id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'file_key', a.file_key)) from public.persora_table_attachments a where a.user_id = p_owner), '[]'::jsonb)
  );
$function$;

-- Revision (and optionally the field definitions) without the content: used
-- for cross-tab/device change polling and to validate record-only saves.
create or replace function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_table public.persora_tables%rowtype;
begin
  select * into v_table from public.persora_tables where id = p_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  return public.persora_table_summary(v_table) || case when p_meta then jsonb_build_object('meta', v_table.meta) else '{}'::jsonb end;
end;
$function$;

create or replace function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.persora_table_attachments%rowtype;
begin
  select a.* into v_row
  from public.persora_table_attachments a
  join public.persora_tables t on t.id = a.table_id
  where a.table_id = p_table and a.id = p_id and a.user_id = p_owner and t.user_id = p_owner;
  if v_row.id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object('id', v_row.id, 'file_key', v_row.file_key, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size);
end;
$function$;

-- People a Person field can name: the owner plus accounts already connected to
-- them through Projects or existing shares. Only ids and display names.
create or replace function public.persora_table_people(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
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
  ), people as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Member') as name
    from public.profiles p
    where p.id in (select id from linked) and (p.id = p_owner or p.account_status = 'active')
    limit 500
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'me', id = p_owner) order by (id <> p_owner), lower(name)), '[]'::jsonb) from people;
$function$;

-- 5. Privileges -------------------------------------------------------------------

revoke all on function public.persora_table_summary(public.persora_tables) from public, anon, authenticated, service_role;
revoke all on function public.persora_table_refresh_stats(uuid) from public, anon, authenticated, service_role;
revoke all on function public.persora_table_uuid_array(jsonb) from public, anon, authenticated, service_role;

revoke all on function public.persora_tables_list(uuid) from public, anon, authenticated;
revoke all on function public.persora_table_get(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.persora_table_create(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_table_save(uuid, uuid, bigint, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_table_update_info(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.persora_table_duplicate(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.persora_table_trash_move(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_table_trash_restore(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_table_attachment_add(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.persora_table_attachments_prune(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.persora_tables_export(uuid) from public, anon, authenticated;
revoke all on function public.persora_table_head(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.persora_table_attachment_get(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_table_people(uuid) from public, anon, authenticated;

grant execute on function public.persora_tables_list(uuid) to service_role;
grant execute on function public.persora_table_get(uuid, uuid, boolean) to service_role;
grant execute on function public.persora_table_create(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.persora_table_save(uuid, uuid, bigint, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.persora_table_update_info(uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.persora_table_duplicate(uuid, uuid, uuid, text) to service_role;
grant execute on function public.persora_table_trash_move(uuid, uuid) to service_role;
grant execute on function public.persora_table_trash_restore(uuid, uuid) to service_role;
grant execute on function public.persora_table_attachment_add(uuid, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.persora_table_attachments_prune(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.persora_tables_export(uuid) to service_role;
grant execute on function public.persora_table_head(uuid, uuid, boolean) to service_role;
grant execute on function public.persora_table_attachment_get(uuid, uuid, uuid) to service_role;
grant execute on function public.persora_table_people(uuid) to service_role;
