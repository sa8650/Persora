-- Persora Habit Tracker: habits, daily check-ins and habit reminders.
--
-- Same model as the calendar (202610250001_calendar.sql): the tables are closed
-- to anon/authenticated (RLS on, no policies, privileges revoked) and every
-- read/write goes through the Pages API with the service role, which passes the
-- signed-in member's id as p_owner to these security-definer functions. Each
-- function scopes every statement to that owner.
--
-- Reminders reuse the calendar's delivery pipeline: the same pg_cron tick
-- (persora_calendar_dispatch_ping, extended below to also wake for habits), the
-- same POST /internal/calendar-reminders endpoint and token, the same Brevo
-- email service and the same in-app notification bell. habit_reminders is a
-- separate queue only because calendar_reminders references calendar events.
--
-- Additive only: nothing existing is dropped or rewritten.

-- 1. Habits -----------------------------------------------------------------------

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  icon text not null default 'check' check (icon ~ '^[a-z][a-z-]{0,23}$'),
  color text not null default 'blue' check (color ~ '^[a-z]{1,16}$'),
  category text check (category is null or category in ('health', 'study', 'fitness', 'personal', 'work')),
  -- Current schedule (mirrors the last schedule_history entry).
  frequency text not null check (frequency in ('daily', 'weekdays', 'weekly')),
  weekday_mask smallint not null default 0 check (weekday_mask between 0 and 127), -- bit 0 = Sunday
  weekly_target smallint check (weekly_target is null or weekly_target between 1 and 7),
  tracking text not null default 'check' check (tracking in ('check', 'numeric')),
  target_value numeric(12, 2) check (target_value is null or (target_value > 0 and target_value <= 100000)),
  unit text not null default '' check (char_length(unit) <= 24),
  start_date date not null,
  -- [{from, frequency, weekdays, weeklyTarget}] so schedule edits never rewrite past weeks.
  schedule_history jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule_history) = 'array'),
  reminder_time time,
  reminder_email boolean not null default false,
  position integer not null default 0,
  archived_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint habits_id_owner unique (id, user_id),
  constraint habits_schedule check (
    (frequency = 'daily' and weekday_mask = 0 and weekly_target is null)
    or (frequency = 'weekdays' and weekday_mask between 1 and 127 and weekly_target is null)
    or (frequency = 'weekly' and weekday_mask = 0 and weekly_target is not null)
  ),
  constraint habits_tracking check ((tracking = 'check' and target_value is null) or (tracking = 'numeric' and target_value is not null)),
  constraint habits_reminder_email check (reminder_email = false or reminder_time is not null)
);
create index if not exists habits_owner_idx on public.habits(user_id, archived_at, position);

-- 2. Check-ins (one per habit per local date) ---------------------------------------

create table if not exists public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  habit_id uuid not null,
  check_date date not null,
  value numeric(14, 2) not null check (value > 0 and value <= 1000000),
  -- Numeric habits: the target when the value was recorded, so later target
  -- edits don't change whether a past day was completed.
  target_value numeric(12, 2) check (target_value is null or target_value > 0),
  completed boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint habit_checkins_habit_owner foreign key (habit_id, user_id) references public.habits(id, user_id) on delete cascade,
  constraint habit_checkins_one_per_day unique (habit_id, check_date)
);
create index if not exists habit_checkins_owner_date_idx on public.habit_checkins(user_id, check_date);
create index if not exists habit_checkins_completed_idx on public.habit_checkins(habit_id, check_date) where completed;

-- 3. Reminder queue ---------------------------------------------------------------------

create table if not exists public.habit_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  habit_id uuid not null,
  local_date date not null,
  week_start date not null,
  remind_at timestamptz not null,
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  habit_name text not null check (char_length(habit_name) between 1 and 80),
  email_requested boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'sent', 'skipped', 'cancelled')),
  email_status text not null default 'not_requested' check (email_status in ('not_requested', 'sending', 'sent', 'failed', 'skipped')),
  email_note text check (email_note is null or char_length(email_note) <= 200),
  attempts integer not null default 0,
  claimed_at timestamptz,
  processed_at timestamptz,
  read_at timestamptz,
  -- habit:<habit id>:<local date> — at most one reminder per habit per day.
  dedupe_key text not null unique check (char_length(dedupe_key) <= 100),
  created_at timestamptz not null default now(),
  constraint habit_reminders_habit_owner foreign key (habit_id, user_id) references public.habits(id, user_id) on delete cascade
);
create unique index if not exists habit_reminders_one_scheduled on public.habit_reminders(habit_id) where status = 'scheduled';
create index if not exists habit_reminders_due_idx on public.habit_reminders(remind_at) where status in ('scheduled', 'processing');
create index if not exists habit_reminders_owner_idx on public.habit_reminders(user_id, remind_at desc);

alter table public.habits enable row level security;
alter table public.habit_checkins enable row level security;
alter table public.habit_reminders enable row level security;
revoke all on public.habits from public, anon, authenticated;
revoke all on public.habit_checkins from public, anon, authenticated;
revoke all on public.habit_reminders from public, anon, authenticated;
grant all on public.habits to service_role;
grant all on public.habit_checkins to service_role;
grant all on public.habit_reminders to service_role;

-- 4. Internal helpers (not callable through the API) -------------------------------

-- Replaces a habit's pending reminder with the first candidate slot that hasn't
-- been used yet. Slots already delivered, skipped or being processed are never
-- reused, so a habit reminds at most once per local day.
create or replace function public.persora_habit_set_reminder(p_owner uuid, p_habit uuid, p_candidates jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_candidate jsonb;
  v_key text;
  v_id uuid;
begin
  update public.habit_reminders set status = 'cancelled'
  where habit_id = p_habit and user_id = p_owner and status = 'scheduled';
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    return;
  end if;
  for v_candidate in select value from jsonb_array_elements(p_candidates) limit 5 loop
    v_key := 'habit:' || p_habit::text || ':' || ((v_candidate ->> 'local_date')::date)::text;
    if exists (select 1 from public.habit_reminders where dedupe_key = v_key and status <> 'cancelled') then
      continue;
    end if;
    v_id := null;
    insert into public.habit_reminders (
      user_id, habit_id, local_date, week_start, remind_at, time_zone, habit_name, email_requested, dedupe_key
    ) values (
      p_owner, p_habit, (v_candidate ->> 'local_date')::date, (v_candidate ->> 'week_start')::date,
      (v_candidate ->> 'remind_at')::timestamptz, v_candidate ->> 'time_zone', left(v_candidate ->> 'habit_name', 80),
      coalesce((v_candidate ->> 'email')::boolean, false), v_key
    )
    on conflict (dedupe_key) do update
      set status = 'scheduled', remind_at = excluded.remind_at, week_start = excluded.week_start, time_zone = excluded.time_zone,
          habit_name = excluded.habit_name, email_requested = excluded.email_requested, email_status = 'not_requested',
          email_note = null, claimed_at = null, read_at = null
      where habit_reminders.status = 'cancelled' and habit_reminders.user_id = p_owner
    returning id into v_id;
    if v_id is not null then
      return;
    end if;
  end loop;
exception
  when unique_violation then
    -- Another pending reminder for this habit appeared concurrently; keep it.
    null;
end;
$function$;

-- Writes habit columns from a JSON object validated by the API (habit-rules.js).
create or replace function public.persora_habit_apply(p_target public.habits, p_values jsonb)
returns public.habits
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  v public.habits := p_target;
begin
  v.name := btrim(p_values ->> 'name');
  v.description := coalesce(p_values ->> 'description', '');
  v.icon := coalesce(nullif(p_values ->> 'icon', ''), 'check');
  v.color := coalesce(nullif(p_values ->> 'color', ''), 'blue');
  v.category := nullif(p_values ->> 'category', '');
  v.frequency := p_values ->> 'frequency';
  v.weekday_mask := coalesce((p_values ->> 'weekday_mask')::smallint, 0);
  v.weekly_target := (p_values ->> 'weekly_target')::smallint;
  v.tracking := coalesce(p_values ->> 'tracking', 'check');
  v.target_value := (p_values ->> 'target_value')::numeric;
  v.unit := coalesce(p_values ->> 'unit', '');
  v.start_date := (p_values ->> 'start_date')::date;
  v.schedule_history := coalesce(p_values -> 'schedule_history', '[]'::jsonb);
  v.reminder_time := nullif(p_values ->> 'reminder_time', '')::time;
  v.reminder_email := coalesce((p_values ->> 'reminder_email')::boolean, false);
  return v;
end;
$function$;

-- 5. API functions -------------------------------------------------------------------------

-- Every habit (active and archived) with its completed dates, the pending
-- reminder, and the check-ins between two dates.
create or replace function public.persora_habits_list(p_owner uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'habits', coalesce((
      select jsonb_agg(to_jsonb(h) || jsonb_build_object(
        'completed_dates', coalesce((
          select jsonb_agg(c.check_date order by c.check_date) from public.habit_checkins c
          where c.habit_id = h.id and c.user_id = p_owner and c.completed
        ), '[]'::jsonb),
        'pending_reminder', (
          select jsonb_build_object('remind_at', r.remind_at, 'local_date', r.local_date, 'time_zone', r.time_zone, 'email_requested', r.email_requested)
          from public.habit_reminders r where r.habit_id = h.id and r.user_id = p_owner and r.status = 'scheduled' limit 1
        )
      ) order by h.archived_at is not null, h.position, h.created_at)
      from public.habits h where h.user_id = p_owner
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.check_date, c.habit_id)
      from public.habit_checkins c where c.user_id = p_owner and c.check_date between p_from and p_to
    ), '[]'::jsonb)
  );
$function$;

create or replace function public.persora_habit_get(p_owner uuid, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select to_jsonb(h) from public.habits h where h.id = p_id and h.user_id = p_owner;
$function$;

-- Creates (p_expected_revision null and no such habit) or updates a habit, and
-- replaces its pending reminder in the same transaction.
create or replace function public.persora_habit_save(p_owner uuid, p_id uuid, p_habit jsonb, p_expected_revision integer, p_reminders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v public.habits%rowtype;
begin
  if p_owner is null or p_id is null or p_habit is null or jsonb_typeof(p_habit) <> 'object' then
    raise exception 'Send the habit details.' using errcode = 'P0400';
  end if;
  select * into v from public.habits where id = p_id and user_id = p_owner for update;
  if not found then
    if p_expected_revision is not null or exists (select 1 from public.habits where id = p_id) then
      raise exception 'This habit no longer exists.' using errcode = 'P0404';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('persora_habits:' || p_owner::text, 0));
    if (select count(*) from public.habits where user_id = p_owner) >= 100 then
      raise exception 'You can keep up to 100 habits. Delete an archived habit to add another.' using errcode = 'P0409';
    end if;
    v := public.persora_habit_apply(null::public.habits, p_habit);
    v.id := p_id;
    v.user_id := p_owner;
    v.position := coalesce((select max(position) + 1 from public.habits where user_id = p_owner), 0);
    v.revision := 1;
    v.created_at := now();
    v.updated_at := now();
    insert into public.habits select v.*;
  else
    if p_expected_revision is not null and v.revision <> p_expected_revision then
      raise exception 'This habit was changed somewhere else. Reload to see the latest version.' using errcode = 'P0409';
    end if;
    v := public.persora_habit_apply(v, p_habit);
    v.revision := v.revision + 1;
    v.updated_at := now();
    update public.habits set
      name = v.name, description = v.description, icon = v.icon, color = v.color, category = v.category,
      frequency = v.frequency, weekday_mask = v.weekday_mask, weekly_target = v.weekly_target, tracking = v.tracking,
      target_value = v.target_value, unit = v.unit, start_date = v.start_date, schedule_history = v.schedule_history,
      reminder_time = v.reminder_time, reminder_email = v.reminder_email, revision = v.revision, updated_at = v.updated_at
    where id = p_id and user_id = p_owner;
  end if;
  perform public.persora_habit_set_reminder(p_owner, p_id, case when v.archived_at is null and v.reminder_time is not null then p_reminders else null end);
  return to_jsonb(v);
end;
$function$;

-- Archives (keeps all history, stops reminders) or restores a habit.
create or replace function public.persora_habit_set_archived(p_owner uuid, p_id uuid, p_archived boolean, p_reminders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v public.habits%rowtype;
begin
  update public.habits set
    archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
    position = case when not p_archived and archived_at is not null
      then coalesce((select max(h.position) + 1 from public.habits h where h.user_id = p_owner and h.archived_at is null), 0)
      else position end,
    revision = revision + 1, updated_at = now()
  where id = p_id and user_id = p_owner
  returning * into v;
  if not found then
    raise exception 'This habit no longer exists.' using errcode = 'P0404';
  end if;
  perform public.persora_habit_set_reminder(p_owner, p_id, case when p_archived or v.reminder_time is null then null else p_reminders end);
  return to_jsonb(v);
end;
$function$;

-- Permanently deletes a habit with its check-ins and reminders.
create or replace function public.persora_habit_delete(p_owner uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  delete from public.habits where id = p_id and user_id = p_owner;
  if not found then
    raise exception 'This habit no longer exists.' using errcode = 'P0404';
  end if;
  return true;
end;
$function$;

-- Sets the display order of the member's habits (ids not owned are ignored).
create or replace function public.persora_habit_reorder(p_owner uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'Send up to 200 habits to reorder.' using errcode = 'P0400';
  end if;
  update public.habits h set position = o.ord::integer - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where h.id = o.id and h.user_id = p_owner;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Records (p_value > 0) or clears (p_value null) the check-in for one local
-- date. Completion is decided here from the locked habit row: checkbox habits
-- are complete when checked; numeric habits when the value reaches the current
-- target, which is stored with the check-in. Returns the check-in and the
-- habit's completed dates.
create or replace function public.persora_habit_checkin(p_owner uuid, p_habit uuid, p_date date, p_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_habit public.habits%rowtype;
  v_checkin public.habit_checkins%rowtype;
  v_value numeric;
  v_target numeric;
begin
  select * into v_habit from public.habits where id = p_habit and user_id = p_owner for share;
  if not found then
    raise exception 'This habit no longer exists.' using errcode = 'P0404';
  end if;
  if v_habit.archived_at is not null then
    raise exception 'Restore this habit to update its history.' using errcode = 'P0409';
  end if;
  if p_date is null or p_date < v_habit.start_date then
    raise exception 'That day is before the habit started.' using errcode = 'P0400';
  end if;
  if p_value is null or p_value <= 0 then
    delete from public.habit_checkins where habit_id = p_habit and user_id = p_owner and check_date = p_date;
  else
    if v_habit.tracking = 'check' then
      v_value := 1; v_target := null;
    else
      v_value := round(p_value, 2); v_target := v_habit.target_value;
    end if;
    insert into public.habit_checkins (user_id, habit_id, check_date, value, target_value, completed)
    values (p_owner, p_habit, p_date, v_value, v_target, v_target is null or v_value >= v_target)
    on conflict (habit_id, check_date) do update
      set value = excluded.value, target_value = excluded.target_value, completed = excluded.completed, updated_at = now()
    returning * into v_checkin;
  end if;
  return jsonb_build_object(
    'checkin', case when v_checkin.id is null then null else to_jsonb(v_checkin) end,
    'completed_dates', coalesce((
      select jsonb_agg(c.check_date order by c.check_date) from public.habit_checkins c
      where c.habit_id = p_habit and c.user_id = p_owner and c.completed
    ), '[]'::jsonb)
  );
end;
$function$;

-- Re-plans a habit's pending reminder (time-zone change, restore).
create or replace function public.persora_habit_reschedule(p_owner uuid, p_id uuid, p_reminders jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v public.habits%rowtype;
begin
  select * into v from public.habits where id = p_id and user_id = p_owner for update;
  if not found then
    return false;
  end if;
  perform public.persora_habit_set_reminder(p_owner, p_id, case when v.archived_at is null and v.reminder_time is not null then p_reminders else null end);
  return true;
end;
$function$;

-- Delivered habit reminders for the bell.
create or replace function public.persora_habit_reminders_recent(p_owner uuid, p_since timestamptz)
returns setof public.habit_reminders
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select * from public.habit_reminders
  where user_id = p_owner and status = 'sent' and remind_at >= p_since
  order by remind_at desc limit 40;
$function$;

create or replace function public.persora_habit_reminders_mark_read(p_owner uuid, p_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  update public.habit_reminders set read_at = clock_timestamp()
  where user_id = p_owner and read_at is null and status = 'sent' and (p_id is null or id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Everything the member owns, for the complete account export.
create or replace function public.persora_habits_export(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.position, h.created_at) from public.habits h where h.user_id = p_owner), '[]'::jsonb),
    'checkins', coalesce((select jsonb_agg(to_jsonb(c) order by c.habit_id, c.check_date) from public.habit_checkins c where c.user_id = p_owner), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(to_jsonb(r) order by r.remind_at) from public.habit_reminders r where r.user_id = p_owner), '[]'::jsonb)
  );
$function$;

-- Restores habits and check-ins from a backup (validated by the API). Merges:
-- habits already in this account (same id) are kept as they are; others are
-- created (with an id derived from the original when that id belongs to someone
-- else, so a repeated restore still matches). Check-ins
-- never overwrite an existing day. Safe to run repeatedly.
create or replace function public.persora_habits_import(p_owner uuid, p_habits jsonb, p_checkins jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_entry jsonb;
  v_source uuid;
  v_target uuid;
  v_map jsonb := '{}'::jsonb;
  v_row public.habits%rowtype;
  v_created integer := 0;
  v_matched integer := 0;
  v_added integer := 0;
  v_skipped integer := 0;
  v_position integer;
  v_inserted integer;
  v_hash text;
  v_alt uuid;
begin
  if jsonb_typeof(coalesce(p_habits, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_checkins, '[]'::jsonb)) <> 'array' then
    raise exception 'This backup''s habit data is invalid.' using errcode = 'P0400';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('persora_habits:' || p_owner::text, 0));
  v_position := coalesce((select max(position) + 1 from public.habits where user_id = p_owner), 0);
  for v_entry in select value from jsonb_array_elements(coalesce(p_habits, '[]'::jsonb)) loop
    v_source := (v_entry ->> 'source_id')::uuid;
    -- When the backup's id is taken by another account, the copy gets an id
    -- derived from (owner, original id), so restoring the same backup again
    -- recognises it instead of creating a duplicate.
    v_hash := md5(p_owner::text || ':' || v_source::text);
    v_alt := (substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-5' || substr(v_hash, 14, 3) || '-a'
      || substr(v_hash, 18, 3) || '-' || substr(v_hash, 21, 12))::uuid;
    v_target := case
      when exists (select 1 from public.habits where id = v_source and user_id = p_owner) then v_source
      when exists (select 1 from public.habits where id = v_alt and user_id = p_owner) then v_alt
    end;
    if v_target is not null then
      v_map := v_map || jsonb_build_object(v_source::text, v_target);
      v_matched := v_matched + 1;
      continue;
    end if;
    if (select count(*) from public.habits where user_id = p_owner) >= 100 then
      raise exception 'This backup would exceed 100 habits. Delete some habits and try again.' using errcode = 'P0409';
    end if;
    v_target := case when exists (select 1 from public.habits where id = v_source) then v_alt else v_source end;
    v_row := public.persora_habit_apply(null::public.habits, v_entry -> 'values');
    v_row.id := v_target;
    v_row.user_id := p_owner;
    v_row.position := v_position;
    v_row.archived_at := nullif(v_entry ->> 'archived_at', '')::timestamptz;
    v_row.revision := 1;
    v_row.created_at := coalesce(nullif(v_entry ->> 'created_at', '')::timestamptz, now());
    v_row.updated_at := now();
    insert into public.habits select v_row.*;
    v_position := v_position + 1;
    v_map := v_map || jsonb_build_object(v_source::text, v_target);
    v_created := v_created + 1;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_checkins, '[]'::jsonb)) loop
    v_target := (v_map ->> (v_entry ->> 'habit_source_id'))::uuid;
    if v_target is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.habit_checkins (user_id, habit_id, check_date, value, target_value, completed)
    select p_owner, h.id, (v_entry ->> 'date')::date, (v_entry ->> 'value')::numeric,
           nullif(v_entry ->> 'target_value', '')::numeric, (v_entry ->> 'completed')::boolean
    from public.habits h
    where h.id = v_target and h.user_id = p_owner and (v_entry ->> 'date')::date >= h.start_date
    on conflict (habit_id, check_date) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('habits_created', v_created, 'habits_matched', v_matched, 'checkins_added', v_added, 'checkins_skipped', v_skipped);
end;
$function$;

-- 6. Reminder delivery ---------------------------------------------------------------------

-- Claims due habit reminders (SKIP LOCKED; a claim older than 5 minutes is
-- reclaimed, but an interrupted email is never re-sent). Returns each reminder
-- with its habit, the owner and whether that day / week is already done.
create or replace function public.persora_habit_claim_reminders(p_limit integer default 50, p_owner uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  with due as (
    select r.id from public.habit_reminders r
    where (p_owner is null or r.user_id = p_owner)
      and ((r.status = 'scheduled' and r.remind_at <= v_now)
        or (r.status = 'processing' and r.claimed_at < v_now - interval '5 minutes'))
    order by r.remind_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of r skip locked
  ), claimed as (
    update public.habit_reminders r set
      email_status = case
        when r.status = 'processing' and r.email_status = 'sending' then 'failed'
        when r.email_requested and r.email_status = 'not_requested' then 'sending'
        else r.email_status end,
      email_note = case when r.status = 'processing' and r.email_status = 'sending' then 'Delivery was interrupted; not retried to avoid a duplicate email.' else r.email_note end,
      status = 'processing', claimed_at = v_now, attempts = r.attempts + 1
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder', to_jsonb(c),
    'habit', to_jsonb(h),
    'owner', jsonb_build_object('email', p.email, 'full_name', p.full_name, 'timezone', p.timezone,
      'email_verified', p.email_verified_at is not null, 'active', p.account_status = 'active'),
    'day_done', exists (select 1 from public.habit_checkins k where k.habit_id = c.habit_id and k.check_date = c.local_date and k.completed),
    'week_done', (select count(*) from public.habit_checkins k
      where k.habit_id = c.habit_id and k.completed and k.check_date between greatest(c.week_start, h.start_date) and c.week_start + 6)
  )), '[]'::jsonb) into v_rows
  from claimed c
  join public.habits h on h.id = c.habit_id
  join public.profiles p on p.id = c.user_id;
  return v_rows;
end;
$function$;

-- Finishes a claimed reminder (delivered or skipped) and schedules the next
-- slot unless the habit was edited meanwhile (an edit schedules its own).
create or replace function public.persora_habit_complete_reminder(
  p_id uuid, p_claimed_at timestamptz, p_delivered boolean, p_email_status text, p_note text, p_habit_revision integer, p_next jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reminder public.habit_reminders%rowtype;
begin
  if p_email_status not in ('not_requested', 'sent', 'failed', 'skipped') then
    raise exception 'Unknown email status.' using errcode = 'P0400';
  end if;
  update public.habit_reminders set
    status = case when p_delivered then 'sent' else 'skipped' end,
    processed_at = clock_timestamp(),
    email_status = case when email_status = 'failed' then 'failed' else p_email_status end,
    email_note = coalesce(left(p_note, 200), email_note)
  where id = p_id and status = 'processing' and claimed_at = p_claimed_at
  returning * into v_reminder;
  if not found then
    return false;
  end if;
  if p_next is not null and jsonb_typeof(p_next) = 'array' and exists (
    select 1 from public.habits where id = v_reminder.habit_id and revision = p_habit_revision and archived_at is null and reminder_time is not null
  ) and not exists (
    select 1 from public.habit_reminders where habit_id = v_reminder.habit_id and status = 'scheduled'
  ) then
    perform public.persora_habit_set_reminder(v_reminder.user_id, v_reminder.habit_id, p_next);
  end if;
  return true;
end;
$function$;

-- The existing every-minute tick now also wakes the dispatcher for due habit
-- reminders. Same Vault secrets, same endpoint, same token.
create or replace function public.persora_calendar_dispatch_ping()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_url text;
  v_token text;
begin
  if not exists (
    select 1 from public.calendar_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) and not exists (
    select 1 from public.habit_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) then
    return 'idle';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'pg_net unavailable';
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_url using 'persora_calendar_dispatch_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_token using 'persora_calendar_dispatch_token';
  exception when others then
    return 'vault unavailable';
  end;
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then
    return 'not configured';
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 15000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-persora-cron-token', v_token);
  return 'requested';
end;
$function$;

-- 7. Privileges --------------------------------------------------------------------------------

revoke all on function public.persora_habit_set_reminder(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.persora_habit_apply(public.habits, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.persora_habits_list(uuid, date, date) from public, anon, authenticated;
revoke all on function public.persora_habit_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_habit_save(uuid, uuid, jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.persora_habit_set_archived(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.persora_habit_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_habit_reorder(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.persora_habit_checkin(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function public.persora_habit_reschedule(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_habit_reminders_recent(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.persora_habit_reminders_mark_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_habits_export(uuid) from public, anon, authenticated;
revoke all on function public.persora_habits_import(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_habit_claim_reminders(integer, uuid) from public, anon, authenticated;
revoke all on function public.persora_habit_complete_reminder(uuid, timestamptz, boolean, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_dispatch_ping() from public, anon, authenticated;
grant execute on function public.persora_habits_list(uuid, date, date) to service_role;
grant execute on function public.persora_habit_get(uuid, uuid) to service_role;
grant execute on function public.persora_habit_save(uuid, uuid, jsonb, integer, jsonb) to service_role;
grant execute on function public.persora_habit_set_archived(uuid, uuid, boolean, jsonb) to service_role;
grant execute on function public.persora_habit_delete(uuid, uuid) to service_role;
grant execute on function public.persora_habit_reorder(uuid, uuid[]) to service_role;
grant execute on function public.persora_habit_checkin(uuid, uuid, date, numeric) to service_role;
grant execute on function public.persora_habit_reschedule(uuid, uuid, jsonb) to service_role;
grant execute on function public.persora_habit_reminders_recent(uuid, timestamptz) to service_role;
grant execute on function public.persora_habit_reminders_mark_read(uuid, uuid) to service_role;
grant execute on function public.persora_habits_export(uuid) to service_role;
grant execute on function public.persora_habits_import(uuid, jsonb, jsonb) to service_role;
grant execute on function public.persora_habit_claim_reminders(integer, uuid) to service_role;
grant execute on function public.persora_habit_complete_reminder(uuid, timestamptz, boolean, text, text, integer, jsonb) to service_role;
grant execute on function public.persora_calendar_dispatch_ping() to service_role;
