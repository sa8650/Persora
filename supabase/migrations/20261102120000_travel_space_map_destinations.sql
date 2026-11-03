-- ============================================================================
-- Persora TravelSpace — Coordinate-Only Map Destinations (Section 20)
-- Strictly stores ONLY id, trip_id, latitude, longitude, order_index,
-- created_at, updated_at. Never stores destination names or addresses.
-- ============================================================================

create table if not exists public.trip_destinations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.travel_trips(id) on delete cascade,
  latitude double precision not null check (latitude >= -90 and latitude <= 90),
  longitude double precision not null check (longitude >= -180 and longitude <= 180),
  order_index integer not null default 0 check (order_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_destinations_trip_order_idx
  on public.trip_destinations using btree (trip_id, order_index asc);

-- Optional coordinate columns on Explore wishlist so saved places can be added
-- directly to a Trip's coordinate destinations ("Add to Trip") or to a Trip's
-- scheduled activities ("Add to Itinerary").
alter table public.travel_explore_places
  add column if not exists latitude double precision check (latitude is null or (latitude >= -90 and latitude <= 90));
alter table public.travel_explore_places
  add column if not exists longitude double precision check (longitude is null or (longitude >= -180 and longitude <= 180));

-- Non-destructive backfill of any existing coordinate rows from legacy travel_trip_destinations
insert into public.trip_destinations (trip_id, latitude, longitude, order_index)
select d.trip_id, d.latitude, d.longitude, coalesce(d.sort_order, 0)
from public.travel_trip_destinations d
where d.latitude is not null
  and d.longitude is not null
  and d.latitude between -90 and 90
  and d.longitude between -180 and 180
  and not exists (
    select 1 from public.trip_destinations td where td.trip_id = d.trip_id
  );

-- Row Level Security strictly using public.persora_jwt_uid()
alter table public.trip_destinations enable row level security;

drop policy if exists trip_destinations_select_policy on public.trip_destinations;
create policy trip_destinations_select_policy on public.trip_destinations
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);

drop policy if exists trip_destinations_write_policy on public.trip_destinations;
create policy trip_destinations_write_policy on public.trip_destinations
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));

revoke all on public.trip_destinations from public, anon, authenticated;
grant all on public.trip_destinations to service_role;

-- Update 7-day Global Trash Move / Restore & Account Export to include trip_destinations
create or replace function public.persora_travel_trip_trash_move(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trip jsonb;
  v_trip_destinations jsonb;
  v_destinations jsonb;
  v_travellers jsonb;
  v_categories jsonb;
  v_contributions jsonb;
  v_bookings jsonb;
  v_items jsonb;
  v_expenses jsonb;
  v_splits jsonb;
  v_settlements jsonb;
  v_documents jsonb;
  v_memories jsonb;
  v_keys jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
begin
  select to_jsonb(t) into v_trip
  from public.travel_trips t
  where t.id = p_id and t.owner_id = p_owner
  for update;

  if v_trip is null then
    raise exception 'Only the trip owner can move this trip to Trash.' using errcode = 'P0404';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.order_index asc), '[]'::jsonb) into v_trip_destinations from public.trip_destinations r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order asc), '[]'::jsonb) into v_destinations from public.travel_trip_destinations r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order asc), '[]'::jsonb) into v_travellers from public.travel_trip_travellers r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order asc), '[]'::jsonb) into v_categories from public.travel_trip_budget_categories r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_contributions from public.travel_trip_contributions r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_bookings from public.travel_trip_bookings r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_items from public.travel_trip_items r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_expenses from public.travel_trip_expenses r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_splits from public.travel_trip_expense_splits r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_settlements from public.travel_trip_settlements r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_documents from public.travel_trip_documents r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_memories from public.travel_trip_memories r where r.trip_id = p_id;

  select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
  into v_keys
  from (
    select v_trip ->> 'cover_file_key' as k
    union all
    select attachment_file_key from public.travel_trip_bookings where trip_id = p_id
    union all
    select attachment_file_key from public.travel_trip_items where trip_id = p_id
    union all
    select receipt_file_key from public.travel_trip_expenses where trip_id = p_id
    union all
    select file_key from public.travel_trip_documents where trip_id = p_id and source_type = 'upload'
    union all
    select file_key from public.travel_trip_memories where trip_id = p_id and source_type = 'upload'
  ) raw_keys
  where k is not null and left(k, char_length(p_owner::text) + 1) = p_owner::text || '/';

  delete from public.travel_trips where id = p_id and owner_id = p_owner;

  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id,
    p_owner,
    'travel_trip',
    coalesce(nullif(v_trip ->> 'title', ''), 'Untitled trip'),
    jsonb_build_object('space', 'travel_space', 'recordType', 'trip', 'status', v_trip ->> 'status'),
    jsonb_build_object(
      'row', v_trip,
      'relations', jsonb_build_object(
        'tripDestinations', v_trip_destinations,
        'destinations', v_destinations,
        'travellers', v_travellers,
        'categories', v_categories,
        'contributions', v_contributions,
        'bookings', v_bookings,
        'items', v_items,
        'expenses', v_expenses,
        'splits', v_splits,
        'settlements', v_settlements,
        'documents', v_documents,
        'memories', v_memories
      )
    ),
    v_keys,
    'active',
    v_now,
    v_now + interval '7 days'
  )
  returning * into v_trash;

  return to_jsonb(v_trash);
end;
$function$;
revoke all on function public.persora_travel_trip_trash_move(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_travel_trip_trash_move(uuid, uuid) to service_role;

create or replace function public.persora_travel_trip_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_rel jsonb;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id
    and owner_id = p_owner
    and kind = 'travel_trip'
    and status = 'active'
    and expires_at > clock_timestamp()
  returning * into v_trash;

  if not found then
    raise exception 'That trip is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  v_rel := coalesce(v_trash.payload -> 'relations', '{}'::jsonb);

  insert into public.travel_trips select * from jsonb_populate_record(null::public.travel_trips, v_row);
  insert into public.trip_destinations select * from jsonb_populate_recordset(null::public.trip_destinations, coalesce(v_rel -> 'tripDestinations', '[]'::jsonb));
  insert into public.travel_trip_destinations select * from jsonb_populate_recordset(null::public.travel_trip_destinations, coalesce(v_rel -> 'destinations', '[]'::jsonb));
  insert into public.travel_trip_travellers select * from jsonb_populate_recordset(null::public.travel_trip_travellers, coalesce(v_rel -> 'travellers', '[]'::jsonb));
  insert into public.travel_trip_budget_categories select * from jsonb_populate_recordset(null::public.travel_trip_budget_categories, coalesce(v_rel -> 'categories', '[]'::jsonb));
  insert into public.travel_trip_contributions select * from jsonb_populate_recordset(null::public.travel_trip_contributions, coalesce(v_rel -> 'contributions', '[]'::jsonb));
  insert into public.travel_trip_bookings select * from jsonb_populate_recordset(null::public.travel_trip_bookings, coalesce(v_rel -> 'bookings', '[]'::jsonb));
  insert into public.travel_trip_items select * from jsonb_populate_recordset(null::public.travel_trip_items, coalesce(v_rel -> 'items', '[]'::jsonb));
  insert into public.travel_trip_expenses select * from jsonb_populate_recordset(null::public.travel_trip_expenses, coalesce(v_rel -> 'expenses', '[]'::jsonb));
  insert into public.travel_trip_expense_splits select * from jsonb_populate_recordset(null::public.travel_trip_expense_splits, coalesce(v_rel -> 'splits', '[]'::jsonb));
  insert into public.travel_trip_settlements select * from jsonb_populate_recordset(null::public.travel_trip_settlements, coalesce(v_rel -> 'settlements', '[]'::jsonb));
  insert into public.travel_trip_documents select * from jsonb_populate_recordset(null::public.travel_trip_documents, coalesce(v_rel -> 'documents', '[]'::jsonb));
  insert into public.travel_trip_memories select * from jsonb_populate_recordset(null::public.travel_trip_memories, coalesce(v_rel -> 'memories', '[]'::jsonb));

  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id);
end;
$function$;
revoke all on function public.persora_travel_trip_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_travel_trip_trash_restore(uuid, uuid) to service_role;

create or replace function public.persora_travel_space_export(p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trips jsonb;
  v_trip_destinations jsonb;
  v_explore jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by t.start_date asc, t.created_at asc), '[]'::jsonb)
  into v_trips
  from public.travel_trips t
  where t.owner_id = p_owner;

  select coalesce(jsonb_agg(to_jsonb(td) order by td.trip_id, td.order_index asc), '[]'::jsonb)
  into v_trip_destinations
  from public.trip_destinations td
  join public.travel_trips t on t.id = td.trip_id
  where t.owner_id = p_owner;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at asc), '[]'::jsonb)
  into v_explore
  from public.travel_explore_places e
  where e.user_id = p_owner;

  return jsonb_build_object(
    'trips', v_trips,
    'tripDestinations', v_trip_destinations,
    'explorePlaces', v_explore
  );
end;
$function$;
revoke all on function public.persora_travel_space_export(uuid) from public, anon, authenticated;
grant execute on function public.persora_travel_space_export(uuid) to service_role;
