-- ============================================================================
-- Persora Docs Module (Standalone Rich Documents, Member/Link Sharing & Trash)
-- All RLS policies strictly use public.persora_jwt_uid() and never raw auth.uid().
-- ============================================================================

-- 1. Extend global Trash kind constraint to support 'persora_doc'
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
        'persora_doc'::text
      ]
    )
  );

-- 2. Core Persora Docs table
create table if not exists public.persora_docs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled document'::text,
  starred boolean not null default false,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  preview_blocks jsonb not null default '[]'::jsonb,
  snippet text not null default ''::text,
  word_count integer not null default 0,
  revision bigint not null default 1,
  last_batch_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  opened_at timestamp with time zone not null default now(),
  constraint persora_docs_pkey primary key (id),
  constraint persora_docs_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint persora_docs_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160),
  constraint persora_docs_content_check check (jsonb_typeof(content) = 'object'),
  constraint persora_docs_preview_blocks_check check (jsonb_typeof(preview_blocks) = 'array'),
  constraint persora_docs_snippet_check check (char_length(snippet) <= 500),
  constraint persora_docs_word_count_check check (word_count >= 0),
  constraint persora_docs_revision_check check (revision >= 1)
);

create index if not exists persora_docs_user_opened_idx
  on public.persora_docs using btree (user_id, opened_at desc, updated_at desc);

create index if not exists persora_docs_user_updated_idx
  on public.persora_docs using btree (user_id, updated_at desc);

alter table public.persora_docs enable row level security;
drop policy if exists persora_docs_owner_policy on public.persora_docs;
create policy persora_docs_owner_policy on public.persora_docs
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.persora_docs from public, anon, authenticated;
grant all on public.persora_docs to service_role;

-- 3. Member-to-member document shares
create table if not exists public.persora_doc_shares (
  id uuid not null default gen_random_uuid(),
  doc_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null,
  permission text not null default 'view'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_doc_shares_pkey primary key (id),
  constraint persora_doc_shares_doc_id_fkey foreign key (doc_id) references public.persora_docs(id) on delete cascade,
  constraint persora_doc_shares_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_doc_shares_recipient_id_fkey foreign key (recipient_id) references public.profiles(id) on delete cascade,
  constraint persora_doc_shares_unique unique (doc_id, recipient_id),
  constraint persora_doc_shares_no_self check (owner_id <> recipient_id),
  constraint persora_doc_shares_permission_check check (permission = any (array['view'::text, 'edit'::text]))
);

create index if not exists persora_doc_shares_recipient_idx
  on public.persora_doc_shares using btree (recipient_id, updated_at desc);

create index if not exists persora_doc_shares_owner_doc_idx
  on public.persora_doc_shares using btree (owner_id, doc_id);

alter table public.persora_doc_shares enable row level security;
drop policy if exists persora_doc_shares_select_policy on public.persora_doc_shares;
create policy persora_doc_shares_select_policy on public.persora_doc_shares
  for select
  to authenticated
  using (owner_id = public.persora_jwt_uid() or recipient_id = public.persora_jwt_uid());
drop policy if exists persora_doc_shares_owner_write_policy on public.persora_doc_shares;
create policy persora_doc_shares_owner_write_policy on public.persora_doc_shares
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_doc_shares from public, anon, authenticated;
grant all on public.persora_doc_shares to service_role;

-- 4. Public link sharing for Persora Docs
create table if not exists public.persora_doc_share_links (
  doc_id uuid not null,
  owner_id uuid not null,
  share_token text not null,
  enabled boolean not null default false,
  permission text not null default 'view'::text,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_doc_share_links_pkey primary key (doc_id),
  constraint persora_doc_share_links_doc_id_fkey foreign key (doc_id) references public.persora_docs(id) on delete cascade,
  constraint persora_doc_share_links_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_doc_share_links_token_unique unique (share_token),
  constraint persora_doc_share_links_token_format check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'::text),
  constraint persora_doc_share_links_permission_check check (permission = any (array['view'::text, 'edit'::text]))
);

create index if not exists persora_doc_share_links_owner_idx
  on public.persora_doc_share_links using btree (owner_id);

alter table public.persora_doc_share_links enable row level security;
drop policy if exists persora_doc_share_links_owner_policy on public.persora_doc_share_links;
create policy persora_doc_share_links_owner_policy on public.persora_doc_share_links
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_doc_share_links from public, anon, authenticated;
grant all on public.persora_doc_share_links to service_role;

-- ============================================================================
-- 5. Security-definer helper & RPCs (locked exclusively to service_role)
-- ============================================================================

create or replace function public.persora_doc_summary(d public.persora_docs)
returns jsonb
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'starred', d.starred,
    'preview_blocks', d.preview_blocks,
    'snippet', d.snippet,
    'word_count', d.word_count,
    'revision', d.revision,
    'created_at', d.created_at,
    'updated_at', d.updated_at,
    'opened_at', d.opened_at
  );
$function$;
revoke all on function public.persora_doc_summary(public.persora_docs) from public, anon, authenticated;
revoke all on function public.persora_doc_summary(public.persora_docs) from service_role;

create or replace function public.persora_doc_access(p_actor uuid, p_doc_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_owner public.profiles%rowtype;
  v_share public.persora_doc_shares%rowtype;
  v_owner_name text;
begin
  if p_actor is null or p_doc_id is null then
    return null;
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id;
  if v_doc.id is null then
    return null;
  end if;
  if v_doc.user_id = p_actor then
    return jsonb_build_object(
      'role', 'owner',
      'shared', false,
      'owner_id', v_doc.user_id,
      'share_id', null,
      'owner_name', null,
      'owner_login_id', null
    );
  end if;
  select * into v_share
  from public.persora_doc_shares
  where doc_id = p_doc_id and recipient_id = p_actor;
  if v_share.id is null then
    return null;
  end if;
  select * into v_owner from public.profiles where id = v_doc.user_id and account_status = 'active';
  if v_owner.id is null then
    return null;
  end if;
  v_owner_name := coalesce(nullif(btrim(v_owner.full_name), ''), split_part(v_owner.email, '@', 1), 'Persora Member');
  return jsonb_build_object(
    'role', v_share.permission,
    'shared', true,
    'owner_id', v_doc.user_id,
    'share_id', v_share.id,
    'owner_name', v_owner_name,
    'owner_login_id', v_owner.login_id
  );
end;
$function$;
revoke all on function public.persora_doc_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_doc_access(uuid, uuid) from service_role;

create or replace function public.persora_docs_list(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with visible as (
    select
      public.persora_doc_summary(d) || jsonb_build_object(
        'shared', false,
        'has_shares', (
          exists (select 1 from public.persora_doc_shares ds where ds.doc_id = d.id)
          or exists (select 1 from public.persora_doc_share_links dsl where dsl.doc_id = d.id and dsl.enabled = true and dsl.revoked_at is null)
        ),
        'permission', 'owner'
      ) as item,
      greatest(d.opened_at, d.updated_at) as sort_at
    from public.persora_docs d
    where d.user_id = p_owner
    union all
    select
      (public.persora_doc_summary(d) || jsonb_build_object(
        'starred', false,
        'shared', true,
        'has_shares', true,
        'permission', s.permission,
        'share_id', s.id,
        'owner_id', d.user_id,
        'owner_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
        'owner_login_id', p.login_id
      )) as item,
      greatest(d.updated_at, s.updated_at) as sort_at
    from public.persora_doc_shares s
    join public.persora_docs d on d.id = s.doc_id
    join public.profiles p on p.id = d.user_id and p.account_status = 'active'
    where s.recipient_id = p_owner
  )
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb) from visible;
$function$;
revoke all on function public.persora_docs_list(uuid) from public, anon, authenticated;
grant execute on function public.persora_docs_list(uuid) to service_role;

create or replace function public.persora_doc_create(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_starred boolean,
  p_content jsonb,
  p_preview_blocks jsonb,
  p_snippet text,
  p_word_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_existing public.persora_docs%rowtype;
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_existing from public.persora_docs where id = p_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That document id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'doc',
      public.persora_doc_summary(v_existing) || jsonb_build_object(
        'content', v_existing.content,
        'shared', false,
        'has_shares', false,
        'permission', 'owner'
      )
    );
  end if;

  if (select count(*) from public.persora_docs where user_id = p_owner) >= 300 then
    raise exception 'You have reached the 300-document limit. Move unused documents to Trash to create more.' using errcode = 'P0409';
  end if;

  insert into public.persora_docs (
    id, user_id, title, starred, content, preview_blocks, snippet, word_count, revision, created_at, updated_at, opened_at
  )
  values (
    p_id,
    p_owner,
    coalesce(nullif(btrim(p_title), ''), 'Untitled document'),
    coalesce(p_starred, false),
    coalesce(p_content, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
    coalesce(p_preview_blocks, '[]'::jsonb),
    coalesce(p_snippet, ''),
    greatest(coalesce(p_word_count, 0), 0),
    1,
    v_now,
    v_now,
    v_now
  )
  returning * into v_doc;

  return jsonb_build_object(
    'doc',
    public.persora_doc_summary(v_doc) || jsonb_build_object(
      'content', v_doc.content,
      'shared', false,
      'has_shares', false,
      'permission', 'owner'
    )
  );
end;
$function$;
revoke all on function public.persora_doc_create(uuid, uuid, text, boolean, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.persora_doc_create(uuid, uuid, text, boolean, jsonb, jsonb, text, integer) to service_role;

create or replace function public.persora_doc_get(
  p_owner uuid,
  p_id uuid,
  p_touch boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_doc public.persora_docs%rowtype;
  v_has_shares boolean;
  v_summary jsonb;
begin
  v_access := public.persora_doc_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';

  if p_touch and v_role = 'owner' then
    update public.persora_docs
    set opened_at = clock_timestamp()
    where id = p_id and user_id = p_owner
    returning * into v_doc;
  else
    select * into v_doc from public.persora_docs where id = p_id;
  end if;

  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  v_has_shares := (
    exists (select 1 from public.persora_doc_shares ds where ds.doc_id = v_doc.id)
    or exists (select 1 from public.persora_doc_share_links dsl where dsl.doc_id = v_doc.id and dsl.enabled = true and dsl.revoked_at is null)
  );

  v_summary := public.persora_doc_summary(v_doc) || jsonb_build_object(
    'content', v_doc.content,
    'shared', coalesce((v_access ->> 'shared')::boolean, false),
    'has_shares', case when coalesce((v_access ->> 'shared')::boolean, false) then true else v_has_shares end,
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

  return jsonb_build_object('doc', v_summary);
end;
$function$;
revoke all on function public.persora_doc_get(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.persora_doc_get(uuid, uuid, boolean) to service_role;

create or replace function public.persora_doc_save(
  p_owner uuid,
  p_id uuid,
  p_base bigint,
  p_batch uuid,
  p_title text,
  p_content jsonb,
  p_preview_blocks jsonb,
  p_snippet text,
  p_word_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  v_access := public.persora_doc_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if v_role not in ('owner', 'edit') then
    raise exception 'You do not have edit permission for this shared document.' using errcode = 'P0403';
  end if;

  select * into v_doc from public.persora_docs where id = p_id for update;
  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  if v_doc.last_batch_id is not null and v_doc.last_batch_id = p_batch then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'doc', public.persora_doc_summary(v_doc)
    );
  end if;

  if v_doc.revision <> p_base then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'doc', public.persora_doc_summary(v_doc)
    );
  end if;

  update public.persora_docs
  set title = coalesce(nullif(btrim(p_title), ''), title),
      content = coalesce(p_content, content),
      preview_blocks = coalesce(p_preview_blocks, preview_blocks),
      snippet = coalesce(p_snippet, snippet),
      word_count = greatest(coalesce(p_word_count, word_count), 0),
      revision = revision + 1,
      last_batch_id = p_batch,
      updated_at = v_now,
      opened_at = case when v_role = 'owner' then v_now else opened_at end
  where id = p_id
  returning * into v_doc;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'doc', public.persora_doc_summary(v_doc)
  );
end;
$function$;
revoke all on function public.persora_doc_save(uuid, uuid, bigint, uuid, text, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.persora_doc_save(uuid, uuid, bigint, uuid, text, jsonb, jsonb, text, integer) to service_role;

create or replace function public.persora_doc_update_info(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_starred boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_doc public.persora_docs%rowtype;
  v_has_shares boolean;
begin
  v_access := public.persora_doc_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';

  if v_role = 'owner' then
    update public.persora_docs
    set title = coalesce(nullif(btrim(p_title), ''), title),
        starred = coalesce(p_starred, starred),
        updated_at = case when p_title is not null and nullif(btrim(p_title), '') is distinct from title then clock_timestamp() else updated_at end
    where id = p_id and user_id = p_owner
    returning * into v_doc;
  elsif v_role = 'edit' and p_starred is null and p_title is not null then
    update public.persora_docs
    set title = coalesce(nullif(btrim(p_title), ''), title),
        updated_at = clock_timestamp()
    where id = p_id
    returning * into v_doc;
  else
    raise exception 'Only the document owner can change these settings.' using errcode = 'P0403';
  end if;

  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  v_has_shares := (
    exists (select 1 from public.persora_doc_shares ds where ds.doc_id = v_doc.id)
    or exists (select 1 from public.persora_doc_share_links dsl where dsl.doc_id = v_doc.id and dsl.enabled = true and dsl.revoked_at is null)
  );

  return public.persora_doc_summary(v_doc) || jsonb_build_object(
    'shared', v_role <> 'owner',
    'has_shares', case when v_role <> 'owner' then true else v_has_shares end,
    'permission', v_role
  );
end;
$function$;
revoke all on function public.persora_doc_update_info(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.persora_doc_update_info(uuid, uuid, text, boolean) to service_role;

create or replace function public.persora_doc_duplicate(
  p_owner uuid,
  p_source uuid,
  p_new_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_source public.persora_docs%rowtype;
  v_existing public.persora_docs%rowtype;
  v_copy public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_existing from public.persora_docs where id = p_new_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That document id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'doc',
      public.persora_doc_summary(v_existing) || jsonb_build_object(
        'shared', false,
        'has_shares', false,
        'permission', 'owner'
      )
    );
  end if;

  v_access := public.persora_doc_access(p_owner, p_source);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  if (select count(*) from public.persora_docs where user_id = p_owner) >= 300 then
    raise exception 'You have reached the 300-document limit. Move unused documents to Trash to create more.' using errcode = 'P0409';
  end if;

  select * into v_source from public.persora_docs where id = p_source;
  if v_source.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  insert into public.persora_docs (
    id, user_id, title, starred, content, preview_blocks, snippet, word_count, revision, created_at, updated_at, opened_at
  )
  values (
    p_new_id,
    p_owner,
    coalesce(nullif(btrim(p_title), ''), left(v_source.title || ' copy', 160)),
    false,
    v_source.content,
    v_source.preview_blocks,
    v_source.snippet,
    v_source.word_count,
    1,
    v_now,
    v_now,
    v_now
  )
  returning * into v_copy;

  return jsonb_build_object(
    'doc',
    public.persora_doc_summary(v_copy) || jsonb_build_object(
      'shared', false,
      'has_shares', false,
      'permission', 'owner'
    )
  );
end;
$function$;
revoke all on function public.persora_doc_duplicate(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_doc_duplicate(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_doc_trash_move(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_payload jsonb;
begin
  select * into v_doc from public.persora_docs where id = p_id and user_id = p_owner for update;
  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  v_payload := jsonb_build_object('row', to_jsonb(v_doc));
  delete from public.persora_docs where id = p_id and user_id = p_owner;
  delete from public.trash_items where id = p_id and owner_id = p_owner and status = 'active';

  insert into public.trash_items (
    id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at
  )
  values (
    p_id,
    p_owner,
    'persora_doc',
    v_doc.title,
    jsonb_build_object('space', 'persora-docs', 'recordType', 'Document', 'wordCount', v_doc.word_count),
    v_payload,
    '[]'::jsonb,
    'active',
    v_now,
    v_now + interval '7 days'
  )
  returning * into v_trash;

  return to_jsonb(v_trash) - 'payload';
end;
$function$;
revoke all on function public.persora_doc_trash_move(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_trash_move(uuid, uuid) to service_role;

create or replace function public.persora_doc_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_title text;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id
    and owner_id = p_owner
    and kind = 'persora_doc'
    and status = 'active'
    and expires_at > clock_timestamp()
  returning * into v_trash;

  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  if exists (select 1 from public.persora_docs where id = v_trash.id) then
    raise exception 'This document already exists in your account.' using errcode = 'P0409';
  end if;

  if (select count(*) from public.persora_docs where user_id = p_owner) >= 300 then
    raise exception 'You have 300 documents, the maximum. Delete one to restore this document.' using errcode = 'P0409';
  end if;

  v_row := v_trash.payload -> 'row';
  v_title := v_row ->> 'title';

  insert into public.persora_docs
  select *
  from jsonb_populate_record(
    null::public.persora_docs,
    v_row || jsonb_build_object('last_batch_id', null, 'updated_at', clock_timestamp())
  );

  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', null, 'name', v_title);
end;
$function$;
revoke all on function public.persora_doc_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_trash_restore(uuid, uuid) to service_role;

-- 6. Sharing RPCs (reusing ShareTableDialog contract)
create or replace function public.persora_doc_sharing_get(p_owner uuid, p_doc_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_link public.persora_doc_share_links%rowtype;
begin
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can manage sharing.' using errcode = 'P0404';
  end if;
  select * into v_link from public.persora_doc_share_links where doc_id = p_doc_id and owner_id = p_owner;
  return jsonb_build_object(
    'doc_id', v_doc.id,
    'doc_title', v_doc.title,
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
      from public.persora_doc_shares s
      join public.profiles p on p.id = s.recipient_id
      where s.doc_id = p_doc_id and s.owner_id = p_owner
    ), '[]'::jsonb),
    'link', case
      when v_link.doc_id is null then jsonb_build_object('enabled', false, 'permission', 'view', 'share_token', null, 'updated_at', null)
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
revoke all on function public.persora_doc_sharing_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_sharing_get(uuid, uuid) to service_role;

create or replace function public.persora_doc_share_upsert(
  p_owner uuid,
  p_doc_id uuid,
  p_recipient uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_recipient public.profiles%rowtype;
  v_existing public.persora_doc_shares%rowtype;
  v_share public.persora_doc_shares%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'Choose a valid permission (view or edit).' using errcode = 'P0422';
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can share this document.' using errcode = 'P0404';
  end if;
  if p_recipient = p_owner then
    raise exception 'You already own this document.' using errcode = 'P0422';
  end if;
  select * into v_recipient from public.profiles where id = p_recipient and account_status = 'active';
  if v_recipient.id is null then
    raise exception 'Choose an active Persora member.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_doc_shares where doc_id = p_doc_id) >= 100 then
    raise exception 'A document can be shared directly with up to 100 members.' using errcode = 'P0409';
  end if;
  select * into v_existing from public.persora_doc_shares where doc_id = p_doc_id and recipient_id = p_recipient;

  insert into public.persora_doc_shares (doc_id, owner_id, recipient_id, permission, created_at, updated_at)
  values (p_doc_id, p_owner, p_recipient, p_permission, v_now, v_now)
  on conflict (doc_id, recipient_id) do update
  set permission = excluded.permission, updated_at = v_now
  returning * into v_share;

  return jsonb_build_object(
    'created', v_existing.id is null,
    'previous_permission', v_existing.permission,
    'doc_title', v_doc.title,
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
revoke all on function public.persora_doc_share_upsert(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_doc_share_upsert(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_doc_share_update(
  p_owner uuid,
  p_doc_id uuid,
  p_share_id uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_share public.persora_doc_shares%rowtype;
  v_recipient public.profiles%rowtype;
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'Choose a valid permission (view or edit).' using errcode = 'P0422';
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can update sharing permissions.' using errcode = 'P0404';
  end if;
  update public.persora_doc_shares
  set permission = p_permission, updated_at = clock_timestamp()
  where id = p_share_id and doc_id = p_doc_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  select * into v_recipient from public.profiles where id = v_share.recipient_id;
  return jsonb_build_object(
    'doc_title', v_doc.title,
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
revoke all on function public.persora_doc_share_update(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_doc_share_update(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_doc_share_revoke(
  p_owner uuid,
  p_doc_id uuid,
  p_share_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_share public.persora_doc_shares%rowtype;
begin
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can revoke sharing.' using errcode = 'P0404';
  end if;
  delete from public.persora_doc_shares
  where id = p_share_id and doc_id = p_doc_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'ok', true,
    'recipient_id', v_share.recipient_id,
    'doc_title', v_doc.title
  );
end;
$function$;
revoke all on function public.persora_doc_share_revoke(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_share_revoke(uuid, uuid, uuid) to service_role;

create or replace function public.persora_doc_link_configure(
  p_owner uuid,
  p_doc_id uuid,
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
  v_doc public.persora_docs%rowtype;
  v_existing public.persora_doc_share_links%rowtype;
  v_link public.persora_doc_share_links%rowtype;
  v_perm text := coalesce(p_permission, 'view');
  v_token text;
  v_now timestamptz := clock_timestamp();
begin
  if v_perm not in ('view', 'edit') then
    raise exception 'Public link permission must be view or edit.' using errcode = 'P0422';
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can configure link sharing.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.persora_doc_share_links where doc_id = p_doc_id and owner_id = p_owner;
  v_token := coalesce(nullif(btrim(p_token), ''), v_existing.share_token);
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'A valid share token is required.' using errcode = 'P0422';
  end if;

  insert into public.persora_doc_share_links (doc_id, owner_id, share_token, enabled, permission, revoked_at, created_at, updated_at)
  values (p_doc_id, p_owner, v_token, coalesce(p_enabled, false), v_perm, case when coalesce(p_enabled, false) then null else v_now end, v_now, v_now)
  on conflict (doc_id) do update
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
revoke all on function public.persora_doc_link_configure(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.persora_doc_link_configure(uuid, uuid, boolean, text, text) to service_role;

create or replace function public.persora_doc_public_get(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.persora_doc_share_links%rowtype;
  v_doc public.persora_docs%rowtype;
  v_owner public.profiles%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.persora_doc_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.doc_id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select * into v_doc from public.persora_docs where id = v_link.doc_id;
  if v_doc.id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select * into v_owner from public.profiles where id = v_doc.user_id;

  return jsonb_build_object(
    'permission', v_link.permission,
    'owner_name', coalesce(nullif(btrim(v_owner.full_name), ''), split_part(v_owner.email, '@', 1), 'Persora Member'),
    'doc', jsonb_build_object(
      'id', v_doc.id,
      'title', v_doc.title,
      'content', v_doc.content,
      'word_count', v_doc.word_count,
      'revision', v_doc.revision,
      'updated_at', v_doc.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_doc_public_get(text) from public, anon, authenticated;
grant execute on function public.persora_doc_public_get(text) to service_role;

create or replace function public.persora_doc_public_save(
  p_token text,
  p_base bigint,
  p_batch uuid,
  p_title text,
  p_content jsonb,
  p_preview_blocks jsonb,
  p_snippet text,
  p_word_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.persora_doc_share_links%rowtype;
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.persora_doc_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.doc_id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  if v_link.permission <> 'edit' then
    raise exception 'Editing is disabled for this shared link.' using errcode = 'P0403';
  end if;

  select * into v_doc from public.persora_docs where id = v_link.doc_id for update;
  if v_doc.id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;

  if v_doc.last_batch_id is not null and v_doc.last_batch_id = p_batch then
    return jsonb_build_object('ok', true, 'replayed', true, 'doc', public.persora_doc_summary(v_doc));
  end if;

  if v_doc.revision <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'doc', public.persora_doc_summary(v_doc));
  end if;

  update public.persora_docs
  set title = coalesce(nullif(btrim(p_title), ''), title),
      content = coalesce(p_content, content),
      preview_blocks = coalesce(p_preview_blocks, preview_blocks),
      snippet = coalesce(p_snippet, snippet),
      word_count = greatest(coalesce(p_word_count, word_count), 0),
      revision = revision + 1,
      last_batch_id = p_batch,
      updated_at = v_now
  where id = v_doc.id
  returning * into v_doc;

  return jsonb_build_object('ok', true, 'replayed', false, 'doc', public.persora_doc_summary(v_doc));
end;
$function$;
revoke all on function public.persora_doc_public_save(text, bigint, uuid, text, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.persora_doc_public_save(text, bigint, uuid, text, jsonb, jsonb, text, integer) to service_role;

create or replace function public.persora_docs_export(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'docs', coalesce((
      select jsonb_agg(
        public.persora_doc_summary(d) || jsonb_build_object('content', d.content)
        order by d.created_at
      )
      from public.persora_docs d
      where d.user_id = p_owner
    ), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_docs_export(uuid) from public, anon, authenticated;
grant execute on function public.persora_docs_export(uuid) to service_role;
