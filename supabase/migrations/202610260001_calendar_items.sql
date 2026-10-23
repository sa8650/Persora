-- Persora Calendar — item types, task completion and filter preferences (2026-10-26)
--
-- Backward compatible: it only adds columns, constraints that every existing
-- row already satisfies, one table and functions. Existing events keep all
-- their data and become item_type = 'event'. Rerunnable.
--
--   * calendar_events.item_type: 'event' (default), 'task' or 'appointment'.
--     Tasks and appointments never repeat; appointments are always timed.
--     The type is fixed when an item is created.
--   * calendar_events.completed_at: set when a task is marked complete. Moving
--     or editing a task never changes it; only persora_calendar_set_task_completion
--     does. A completed task has no pending reminder.
--   * calendar_preferences: one row per member with Calendar display filters,
--     so they follow the member across devices. Filters only affect display.

-- 1. Item types and completion -------------------------------------------------
alter table public.calendar_events add column if not exists item_type text not null default 'event';
alter table public.calendar_events add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calendar_events_item_type' and conrelid = 'public.calendar_events'::regclass) then
    alter table public.calendar_events add constraint calendar_events_item_type check (
      item_type in ('event', 'task', 'appointment')
      and (item_type = 'event' or recurrence_freq is null)
      and (item_type <> 'appointment' or not all_day)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'calendar_events_completion' and conrelid = 'public.calendar_events'::regclass) then
    alter table public.calendar_events add constraint calendar_events_completion check (completed_at is null or item_type = 'task');
  end if;
end $$;

create index if not exists calendar_events_owner_type_idx on public.calendar_events(user_id, item_type) where item_type <> 'event';

-- 2. Filter preferences --------------------------------------------------------
create table if not exists public.calendar_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4096),
  updated_at timestamptz not null default now()
);
alter table public.calendar_preferences enable row level security;
revoke all on public.calendar_preferences from public, anon, authenticated;
grant all on public.calendar_preferences to service_role;

-- 3. Writes understand item_type -----------------------------------------------
create or replace function public.persora_calendar_event_values(p_event jsonb)
returns public.calendar_events
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  v public.calendar_events%rowtype;
begin
  v.title := btrim(p_event ->> 'title');
  v.description := coalesce(p_event ->> 'description', '');
  v.location := coalesce(p_event ->> 'location', '');
  v.category := nullif(p_event ->> 'category', '');
  v.all_day := coalesce((p_event ->> 'all_day')::boolean, false);
  v.time_zone := p_event ->> 'time_zone';
  v.start_at := nullif(p_event ->> 'start_at', '')::timestamptz;
  v.end_at := nullif(p_event ->> 'end_at', '')::timestamptz;
  v.start_date := nullif(p_event ->> 'start_date', '')::date;
  v.end_date := nullif(p_event ->> 'end_date', '')::date;
  v.recurrence_freq := nullif(p_event ->> 'recurrence_freq', '');
  v.recurrence_interval := coalesce(nullif(p_event ->> 'recurrence_interval', '')::smallint, 1);
  v.recurrence_until := nullif(p_event ->> 'recurrence_until', '')::date;
  v.recurrence_count := nullif(p_event ->> 'recurrence_count', '')::integer;
  v.reminder_minutes := nullif(p_event ->> 'reminder_minutes', '')::integer;
  v.reminder_email := coalesce((p_event ->> 'reminder_email')::boolean, false);
  v.item_type := coalesce(nullif(p_event ->> 'item_type', ''), 'event');
  return v;
end;
$function$;

-- Same contract as in 202610250001, plus: new rows take item_type from the
-- input; updates keep the stored item_type and completed_at; a completed task
-- never gets a pending reminder.
create or replace function public.persora_calendar_save_event(
  p_owner uuid,
  p_id uuid,
  p_event jsonb,
  p_expected_revision integer,
  p_reset_exceptions boolean,
  p_reminder jsonb,
  p_exception_patches jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v public.calendar_events%rowtype := public.persora_calendar_event_values(p_event);
  v_existing public.calendar_events%rowtype;
  v_row public.calendar_events%rowtype;
  v_patch jsonb;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.calendar_events where id = p_id for update;
  if found and v_existing.user_id <> p_owner then
    raise exception 'That event is not available in your calendar.' using errcode = 'P0404';
  end if;

  if not found then
    if p_expected_revision is not null then
      raise exception 'That event was deleted. Create it again if you still need it.' using errcode = 'P0404';
    end if;
    insert into public.calendar_events (
      id, user_id, item_type, title, description, location, category, all_day, time_zone, start_at, end_at, start_date, end_date,
      recurrence_freq, recurrence_interval, recurrence_until, recurrence_count, reminder_minutes, reminder_email
    ) values (
      p_id, p_owner, v.item_type, v.title, v.description, v.location, v.category, v.all_day, v.time_zone, v.start_at, v.end_at, v.start_date, v.end_date,
      v.recurrence_freq, v.recurrence_interval, v.recurrence_until, v.recurrence_count, v.reminder_minutes, v.reminder_email
    ) returning * into v_row;
  else
    if v_existing.series_id is not null then
      raise exception 'Edit this occurrence as part of its recurring event.' using errcode = 'P0400';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      raise exception 'This event was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
    end if;
    if p_reset_exceptions then
      delete from public.calendar_events where series_id = p_id and user_id = p_owner;
    end if;
    update public.calendar_events set
      title = v.title, description = v.description, location = v.location, category = v.category, all_day = v.all_day,
      time_zone = v.time_zone, start_at = v.start_at, end_at = v.end_at, start_date = v.start_date, end_date = v.end_date,
      recurrence_freq = v.recurrence_freq, recurrence_interval = v.recurrence_interval, recurrence_until = v.recurrence_until,
      recurrence_count = v.recurrence_count, reminder_minutes = v.reminder_minutes, reminder_email = v.reminder_email
    where id = p_id and user_id = p_owner
    returning * into v_row;

    if not p_reset_exceptions and v_row.recurrence_freq is not null then
      for v_patch in select * from jsonb_array_elements(coalesce(p_exception_patches, '[]'::jsonb)) loop
        update public.calendar_events set
          title = coalesce(nullif(btrim(v_patch ->> 'title'), ''), title),
          description = coalesce(v_patch ->> 'description', description),
          location = coalesce(v_patch ->> 'location', location),
          category = case when v_patch ? 'category' then nullif(v_patch ->> 'category', '') else category end,
          reminder_minutes = case when v_patch ? 'reminder_minutes' then nullif(v_patch ->> 'reminder_minutes', '')::integer else reminder_minutes end,
          reminder_email = coalesce((v_patch ->> 'reminder_email')::boolean, reminder_email)
        where id = (v_patch ->> 'id')::uuid and series_id = p_id and user_id = p_owner;
        if found and v_patch ? 'reminder' then
          perform public.persora_calendar_set_reminder(p_owner, (v_patch ->> 'id')::uuid, p_id, v_patch -> 'reminder');
        end if;
      end loop;
    end if;
  end if;

  perform public.persora_calendar_set_reminder(p_owner, v_row.id, v_row.id, case when v_row.completed_at is not null then null else p_reminder end);
  return jsonb_build_object(
    'event', to_jsonb(v_row),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(x)) from public.calendar_events x where x.series_id = v_row.id and x.user_id = p_owner), '[]'::jsonb)
  );
end;
$function$;

-- Marks a task complete or reopens it. Completing cancels its pending reminder;
-- reopening schedules p_reminder (computed by the API). Revision-checked.
create or replace function public.persora_calendar_set_task_completion(
  p_owner uuid, p_id uuid, p_completed boolean, p_expected_revision integer, p_reminder jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.calendar_events%rowtype;
begin
  select * into v_row from public.calendar_events where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That task is no longer in your calendar.' using errcode = 'P0404';
  end if;
  if v_row.item_type <> 'task' then
    raise exception 'Only tasks can be marked complete.' using errcode = 'P0400';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_row.revision then
    raise exception 'This task was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
  end if;
  update public.calendar_events
    set completed_at = case when p_completed then coalesce(completed_at, clock_timestamp()) else null end
  where id = p_id and user_id = p_owner
  returning * into v_row;
  perform public.persora_calendar_set_reminder(p_owner, v_row.id, v_row.id, case when p_completed then null else p_reminder end);
  return jsonb_build_object('event', to_jsonb(v_row));
end;
$function$;

revoke all on function public.persora_calendar_event_values(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.persora_calendar_save_event(uuid, uuid, jsonb, integer, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_set_task_completion(uuid, uuid, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function public.persora_calendar_save_event(uuid, uuid, jsonb, integer, boolean, jsonb, jsonb) to service_role;
grant execute on function public.persora_calendar_set_task_completion(uuid, uuid, boolean, integer, jsonb) to service_role;
