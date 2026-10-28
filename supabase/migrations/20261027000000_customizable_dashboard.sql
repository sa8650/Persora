-- Persora Customizable Dashboard & Widget System
-- Normalized per-member dashboard layout & widget storage with strict constraints,
-- Supabase Row Level Security (RLS), and conflict-safe atomic save/reset RPCs.
-- Idempotent so it applies cleanly to both fresh schema.sql setups and existing databases.

create or replace function public.persora_jwt_uid()
returns uuid
language plpgsql
stable
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_sub text;
begin
  v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  if v_sub is null then
    v_sub := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  end if;
  if v_sub is null or v_sub = '' then
    return null;
  end if;
  return v_sub::uuid;
exception when others then
  return null;
end;
$function$;
revoke all on function public.persora_jwt_uid() from public, anon;
grant execute on function public.persora_jwt_uid() to authenticated, service_role;

create table if not exists public.dashboard_layouts (
  user_id uuid not null,
  active_preset text not null default 'custom'::text,
  revision integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint dashboard_layouts_pkey primary key (user_id),
  constraint dashboard_layouts_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint dashboard_layouts_preset_check check (
    active_preset = any (array[
      'custom'::text,
      'balanced'::text,
      'productivity'::text,
      'personal-records'::text,
      'payments-and-renewals'::text,
      'minimal'::text
    ])
  ),
  constraint dashboard_layouts_revision_check check (revision >= 1)
);

alter table public.dashboard_layouts enable row level security;
drop policy if exists dashboard_layouts_owner_policy on public.dashboard_layouts;
create policy dashboard_layouts_owner_policy on public.dashboard_layouts
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.dashboard_layouts from public, anon, authenticated;
grant all on public.dashboard_layouts to service_role;

create table if not exists public.dashboard_widgets (
  user_id uuid not null,
  widget_id text not null,
  widget_type text not null,
  title text not null,
  config jsonb not null default '{}'::jsonb,
  "position" integer not null default 0,
  width text not null default 'half'::text,
  height text not null default 'standard'::text,
  visible boolean not null default true,
  collapsed boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint dashboard_widgets_pkey primary key (user_id, widget_id),
  constraint dashboard_widgets_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint dashboard_widgets_id_format check (widget_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$'::text),
  constraint dashboard_widgets_type_check check (
    widget_type = any (array[
      'quick-actions'::text,
      'calendar-agenda'::text,
      'tasks-due'::text,
      'upcoming-reminders'::text,
      'habit-tracker'::text,
      'quick-note'::text,
      'recently-opened'::text,
      'project-progress'::text,
      'recent-project-activity'::text,
      'expiring-documents'::text,
      'recent-documents'::text,
      'pinned-folders'::text,
      'family-document-overview'::text,
      'academic-records'::text,
      'warranty-expiry'::text,
      'recent-uploads'::text,
      'upcoming-loan-installments'::text,
      'subscription-renewals'::text,
      'combined-upcoming-payments'::text,
      'payment-status-summary'::text,
      'favorite-urls'::text,
      'digital-memberships'::text,
      'contact-shortcuts'::text,
      'pdf-studio-shortcut'::text,
      'photo-studio-shortcut'::text,
      'medical-records-shortcut'::text,
      'password-vault-status'::text,
      'google-drive-status'::text,
      'external-storage-status'::text,
      'connected-service-shortcuts'::text
    ])
  ),
  constraint dashboard_widgets_title_check check (char_length(title) >= 1 and char_length(title) <= 120),
  constraint dashboard_widgets_config_shape check (jsonb_typeof(config) = 'object'::text and pg_column_size(config) <= 8192),
  constraint dashboard_widgets_position_check check ("position" >= 0 and "position" < 64),
  constraint dashboard_widgets_width_check check (width = any (array['compact'::text, 'half'::text, 'two-thirds'::text, 'full'::text])),
  constraint dashboard_widgets_height_check check (height = any (array['compact'::text, 'standard'::text, 'expanded'::text]))
);

create index if not exists dashboard_widgets_owner_pos_idx
  on public.dashboard_widgets using btree (user_id, "position" asc);

alter table public.dashboard_widgets enable row level security;
drop policy if exists dashboard_widgets_owner_policy on public.dashboard_widgets;
create policy dashboard_widgets_owner_policy on public.dashboard_widgets
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.dashboard_widgets from public, anon, authenticated;
grant all on public.dashboard_widgets to service_role;

comment on table public.dashboard_layouts is 'Customizable Dashboard per-member layout metadata, active preset, and optimistic concurrency revision.';
comment on table public.dashboard_widgets is 'Customizable Dashboard per-member widget instances, positions, sizes, visibility, collapse state, and validated JSON configuration.';

create or replace function public.persora_dashboard_load(p_owner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_layout public.dashboard_layouts%rowtype;
  v_widgets jsonb;
begin
  if p_owner is null then
    raise exception 'Dashboard owner is required.' using errcode = 'P0400';
  end if;

  select * into v_layout
  from public.dashboard_layouts
  where user_id = p_owner;

  if not found then
    return jsonb_build_object(
      'customized', false,
      'activePreset', 'balanced',
      'revision', 0,
      'updatedAt', null,
      'widgets', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', w.widget_id,
        'type', w.widget_type,
        'title', w.title,
        'config', w.config,
        'position', w."position",
        'width', w.width,
        'height', w.height,
        'visible', w.visible,
        'collapsed', w.collapsed,
        'createdAt', w.created_at,
        'updatedAt', w.updated_at
      )
      order by w."position" asc, w.widget_id asc
    ),
    '[]'::jsonb
  )
  into v_widgets
  from public.dashboard_widgets w
  where w.user_id = p_owner;

  return jsonb_build_object(
    'customized', true,
    'activePreset', v_layout.active_preset,
    'revision', v_layout.revision,
    'updatedAt', v_layout.updated_at,
    'widgets', v_widgets
  );
end;
$function$;
revoke all on function public.persora_dashboard_load(uuid) from public, anon, authenticated;
grant execute on function public.persora_dashboard_load(uuid) to service_role;

create or replace function public.persora_dashboard_save(
  p_owner uuid,
  p_active_preset text,
  p_expected_revision integer,
  p_widgets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_layout public.dashboard_layouts%rowtype;
  v_next_revision integer;
  v_preset text := coalesce(nullif(btrim(p_active_preset), ''), 'custom');
  v_now timestamp with time zone := now();
  v_item jsonb;
  v_idx integer := 0;
  v_keep_ids text[] := array[]::text[];
  v_widget_id text;
begin
  if p_owner is null then
    raise exception 'Dashboard owner is required.' using errcode = 'P0400';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'Member account was not found.' using errcode = 'P0404';
  end if;
  if p_widgets is null or jsonb_typeof(p_widgets) <> 'array' then
    raise exception 'Dashboard widgets must be a JSON array.' using errcode = 'P0400';
  end if;
  if jsonb_array_length(p_widgets) > 40 then
    raise exception 'Dashboards can hold at most 40 widgets.' using errcode = 'P0400';
  end if;

  select * into v_layout
  from public.dashboard_layouts
  where user_id = p_owner
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> v_layout.revision then
      raise exception 'Your dashboard was updated on another device or tab.' using errcode = 'P0409';
    end if;
    v_next_revision := v_layout.revision + 1;
    update public.dashboard_layouts
    set active_preset = v_preset,
        revision = v_next_revision,
        updated_at = v_now
    where user_id = p_owner;
  else
    if p_expected_revision is not null and p_expected_revision > 0 then
      raise exception 'Your dashboard was updated on another device or tab.' using errcode = 'P0409';
    end if;
    v_next_revision := 1;
    insert into public.dashboard_layouts (user_id, active_preset, revision, created_at, updated_at)
    values (p_owner, v_preset, v_next_revision, v_now, v_now);
  end if;

  for v_item in select value from jsonb_array_elements(p_widgets)
  loop
    v_widget_id := coalesce(v_item ->> 'id', '');
    if v_widget_id = '' then
      raise exception 'Every dashboard widget requires an id.' using errcode = 'P0400';
    end if;
    if v_widget_id = any (v_keep_ids) then
      raise exception 'Duplicate widget id in dashboard payload.' using errcode = 'P0400';
    end if;
    v_keep_ids := array_append(v_keep_ids, v_widget_id);

    insert into public.dashboard_widgets (
      user_id,
      widget_id,
      widget_type,
      title,
      config,
      "position",
      width,
      height,
      visible,
      collapsed,
      created_at,
      updated_at
    )
    values (
      p_owner,
      v_widget_id,
      coalesce(v_item ->> 'type', ''),
      coalesce(v_item ->> 'title', ''),
      coalesce(v_item -> 'config', '{}'::jsonb),
      v_idx,
      coalesce(v_item ->> 'width', 'half'),
      coalesce(v_item ->> 'height', 'standard'),
      coalesce((v_item ->> 'visible')::boolean, true),
      coalesce((v_item ->> 'collapsed')::boolean, false),
      v_now,
      v_now
    )
    on conflict (user_id, widget_id) do update
    set widget_type = excluded.widget_type,
        title = excluded.title,
        config = excluded.config,
        "position" = excluded."position",
        width = excluded.width,
        height = excluded.height,
        visible = excluded.visible,
        collapsed = excluded.collapsed,
        updated_at = v_now;

    v_idx := v_idx + 1;
  end loop;

  delete from public.dashboard_widgets
  where user_id = p_owner
    and not (widget_id = any (v_keep_ids));

  return public.persora_dashboard_load(p_owner);
end;
$function$;
revoke all on function public.persora_dashboard_save(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.persora_dashboard_save(uuid, text, integer, jsonb) to service_role;

create or replace function public.persora_dashboard_reset(
  p_owner uuid,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_layout public.dashboard_layouts%rowtype;
begin
  if p_owner is null then
    raise exception 'Dashboard owner is required.' using errcode = 'P0400';
  end if;

  select * into v_layout
  from public.dashboard_layouts
  where user_id = p_owner
  for update;

  if found and p_expected_revision is not null and p_expected_revision <> v_layout.revision then
    raise exception 'Your dashboard was updated on another device or tab.' using errcode = 'P0409';
  end if;

  delete from public.dashboard_widgets where user_id = p_owner;
  delete from public.dashboard_layouts where user_id = p_owner;

  return public.persora_dashboard_load(p_owner);
end;
$function$;
revoke all on function public.persora_dashboard_reset(uuid, integer) from public, anon, authenticated;
grant execute on function public.persora_dashboard_reset(uuid, integer) to service_role;
