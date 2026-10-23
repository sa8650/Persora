-- Persora Calendar (2026-10-25)
-- Personal events with simple recurrence and server-side reminders.
--
-- Model
--   * calendar_events holds single events, recurring series ("masters") and
--     exceptions. An exception overrides (status 'confirmed') or cancels
--     (status 'cancelled') ONE occurrence of a series: series_id points to the
--     master and original_start_at / original_start_date identifies the
--     occurrence, as in Google Calendar (recurringEventId + originalStartTime).
--     Editing one occurrence therefore never touches the series row.
--   * Timed events: UTC instants (start_at/end_at) plus the IANA zone they were
--     created in (time_zone); recurrences repeat the local wall-clock time in
--     that zone. All-day events: dates (start_date, end_date exclusive).
--   * calendar_reminders is the delivery queue. Each event row has at most ONE
--     'scheduled' reminder (its next one). The Pages API computes reminder
--     times with cloudflare/calendar-rules.js and passes them in; it claims due
--     reminders with SKIP LOCKED, delivers them (in-app always, email when
--     requested) and schedules the following occurrence. dedupe_key is unique,
--     so the same occurrence/time is never delivered twice, even after edits.
--   * source/external_id are reserved for future Google/Microsoft sync.
--
-- Security
--   RLS is enabled and every privilege is revoked from anon/authenticated, so
--   the browser can never read or write these tables directly (Supabase's
--   default grants are undone below). All access goes through the
--   authenticated Pages API (service role), and every function takes the
--   signed-in owner and scopes each statement to it.
--
-- Scheduling
--   pg_cron (when available) runs persora_calendar_dispatch_ping() every
--   minute. If something is due and pg_net plus two Vault secrets are
--   configured (see DEPLOYMENT.md) it calls the API's dispatcher endpoint.
--   The API also dispatches on its own: after signed-in requests (throttled)
--   and for the member whenever the app polls reminders. External schedulers
--   can call POST /api/internal/calendar-reminders.

-- 1. Events --------------------------------------------------------------------
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  series_id uuid references public.calendar_events(id) on delete cascade,
  original_start_at timestamptz,
  original_start_date date,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 300),
  category text check (category is null or category in ('personal', 'work', 'family', 'health', 'travel', 'social', 'other')),
  all_day boolean not null default false,
  time_zone text not null check (char_length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z0-9_+/-]+$'),
  start_at timestamptz,
  end_at timestamptz,
  start_date date,
  end_date date,
  recurrence_freq text check (recurrence_freq is null or recurrence_freq in ('daily', 'weekly', 'monthly')),
  recurrence_interval smallint not null default 1 check (recurrence_interval between 1 and 99),
  recurrence_until date,
  recurrence_count integer check (recurrence_count is null or recurrence_count between 1 and 999),
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes in (5, 15, 30, 60, 1440)),
  reminder_email boolean not null default false,
  source text not null default 'persora' check (source in ('persora')),
  external_id text check (external_id is null or char_length(external_id) <= 1024),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Timed events have instants; all-day events have dates. Never both.
  constraint calendar_events_timing check (
    (all_day and start_date is not null and end_date is not null and start_at is null and end_at is null
      and end_date > start_date and end_date - start_date <= 366)
    or
    (not all_day and start_at is not null and end_at is not null and start_date is null and end_date is null
      and end_at > start_at and end_at - start_at <= interval '31 days')
  ),
  -- Exceptions belong to a series, identify their occurrence and never recur.
  constraint calendar_events_exception check (
    (series_id is null and original_start_at is null and original_start_date is null and status = 'confirmed')
    or
    (series_id is not null and recurrence_freq is null and num_nonnulls(original_start_at, original_start_date) = 1)
  ),
  constraint calendar_events_recurrence_end check (
    (recurrence_until is null or recurrence_count is null)
    and (recurrence_freq is not null or (recurrence_until is null and recurrence_count is null and recurrence_interval = 1))
    and (recurrence_until is null or recurrence_until >= coalesce(start_date, (start_at at time zone 'UTC')::date - 1))
  ),
  constraint calendar_events_reminder_email check (reminder_email = false or reminder_minutes is not null)
);

-- Range queries per owner: single timed events, all-day events, series.
create index if not exists calendar_events_owner_start_idx on public.calendar_events(user_id, start_at) where start_at is not null and recurrence_freq is null;
create index if not exists calendar_events_owner_date_idx on public.calendar_events(user_id, start_date) where start_date is not null and recurrence_freq is null;
create index if not exists calendar_events_owner_series_idx on public.calendar_events(user_id) where recurrence_freq is not null;
create index if not exists calendar_events_series_idx on public.calendar_events(series_id) where series_id is not null;
create unique index if not exists calendar_events_exception_at_key on public.calendar_events(series_id, original_start_at) where original_start_at is not null;
create unique index if not exists calendar_events_exception_date_key on public.calendar_events(series_id, original_start_date) where original_start_date is not null;
create unique index if not exists calendar_events_external_key on public.calendar_events(user_id, source, external_id) where external_id is not null;
create index if not exists calendar_events_owner_title_idx on public.calendar_events(user_id, lower(title) text_pattern_ops);

-- Title search: a trigram index when pg_trgm is available (Supabase has it).
do $$
begin
  begin
    create extension if not exists pg_trgm with schema extensions;
  exception
    when insufficient_privilege or undefined_file or feature_not_supported or invalid_parameter_value then
      raise warning 'pg_trgm is unavailable; calendar search uses the btree title index.';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute format('create index if not exists calendar_events_title_trgm_idx on public.calendar_events using gin (lower(title) %I.gin_trgm_ops)',
      (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'));
  end if;
end $$;

-- An exception must belong to the same owner's recurring series.
create or replace function public.persora_calendar_event_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.series_id is not null and not exists (
    select 1 from public.calendar_events master
    where master.id = new.series_id and master.user_id = new.user_id and master.recurrence_freq is not null
  ) then
    raise exception 'That recurring event is not available in your calendar.' using errcode = 'P0404';
  end if;
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
drop trigger if exists calendar_events_guard on public.calendar_events;
create trigger calendar_events_guard before insert or update on public.calendar_events
  for each row execute function public.persora_calendar_event_guard();

-- 2. Reminder queue ------------------------------------------------------------
create table if not exists public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  -- The series (for occurrences and exceptions) or the event itself.
  root_id uuid not null,
  occurrence_key text not null check (char_length(occurrence_key) between 10 and 40),
  occurrence_start timestamptz,
  occurrence_date date,
  all_day boolean not null default false,
  remind_at timestamptz not null,
  minutes_before integer not null check (minutes_before in (5, 15, 30, 60, 1440)),
  title text not null check (char_length(title) between 1 and 200),
  location text not null default '' check (char_length(location) <= 300),
  email_requested boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'sent', 'cancelled')),
  email_status text not null default 'not_requested' check (email_status in ('not_requested', 'sending', 'sent', 'failed', 'skipped')),
  email_note text check (email_note is null or char_length(email_note) <= 200),
  attempts integer not null default 0,
  claimed_at timestamptz,
  processed_at timestamptz,
  read_at timestamptz,
  dedupe_key text not null unique check (char_length(dedupe_key) <= 160),
  created_at timestamptz not null default now(),
  constraint calendar_reminders_occurrence check (num_nonnulls(occurrence_start, occurrence_date) = 1)
);
-- Invariant: one pending reminder per event row.
create unique index if not exists calendar_reminders_one_scheduled on public.calendar_reminders(event_id) where status = 'scheduled';
create index if not exists calendar_reminders_due_idx on public.calendar_reminders(remind_at) where status in ('scheduled', 'processing');
create index if not exists calendar_reminders_owner_idx on public.calendar_reminders(user_id, remind_at desc);

alter table public.calendar_events enable row level security;
alter table public.calendar_reminders enable row level security;
revoke all on public.calendar_events from public, anon, authenticated;
revoke all on public.calendar_reminders from public, anon, authenticated;
grant all on public.calendar_events to service_role;
grant all on public.calendar_reminders to service_role;

-- 3. Helpers ---------------------------------------------------------------------

-- Replaces an event's pending reminder. A previously cancelled reminder with
-- the same dedupe key is revived; a sent or in-flight one is left alone, so an
-- edit never causes a second delivery of the same occurrence and time.
create or replace function public.persora_calendar_set_reminder(p_owner uuid, p_event_id uuid, p_root_id uuid, p_reminder jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  update public.calendar_reminders set status = 'cancelled'
  where event_id = p_event_id and user_id = p_owner and status = 'scheduled';
  if p_reminder is null or jsonb_typeof(p_reminder) <> 'object' then
    return;
  end if;
  insert into public.calendar_reminders (
    user_id, event_id, root_id, occurrence_key, occurrence_start, occurrence_date, all_day, remind_at,
    minutes_before, title, location, email_requested, email_status, dedupe_key
  ) values (
    p_owner, p_event_id, p_root_id, p_reminder ->> 'occurrence_key',
    nullif(p_reminder ->> 'occurrence_start', '')::timestamptz, nullif(p_reminder ->> 'occurrence_date', '')::date,
    coalesce((p_reminder ->> 'all_day')::boolean, false), (p_reminder ->> 'remind_at')::timestamptz,
    (p_reminder ->> 'minutes_before')::integer, p_reminder ->> 'title', coalesce(p_reminder ->> 'location', ''),
    coalesce((p_reminder ->> 'email')::boolean, false), 'not_requested', p_reminder ->> 'dedupe_key'
  )
  on conflict (dedupe_key) do update
    set status = 'scheduled', event_id = excluded.event_id, title = excluded.title, location = excluded.location,
        email_requested = excluded.email_requested, minutes_before = excluded.minutes_before, claimed_at = null
    where calendar_reminders.status = 'cancelled' and calendar_reminders.user_id = p_owner;
exception
  when unique_violation then
    -- Another pending reminder for this event appeared concurrently; keep it.
    null;
end;
$function$;

-- Writes event columns from a normalized JSON object (validated by the API).
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
  return v;
end;
$function$;

-- 4. Reads -----------------------------------------------------------------------

-- Everything needed to draw [p_from, p_to): single events and exceptions that
-- overlap, series that may produce occurrences, and those series' exceptions
-- whose original start falls in the window (to hide replaced occurrences).
-- The API pads the window by a day on each side so any display zone works.
create or replace function public.persora_calendar_events_in_range(
  p_owner uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date
)
returns setof public.calendar_events
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with masters as (
    select * from public.calendar_events
    where user_id = p_owner and recurrence_freq is not null
      and coalesce(start_date, (start_at at time zone 'UTC')::date) < p_to_date
      and (recurrence_until is null or recurrence_until >= p_from_date - 32)
  )
  select * from masters
  union all
  select * from public.calendar_events e
  where e.user_id = p_owner and e.recurrence_freq is null and e.status = 'confirmed'
    and (
      (not e.all_day and e.start_at < p_to and e.end_at > p_from and e.start_at > p_from - interval '32 days')
      or (e.all_day and e.start_date < p_to_date and e.end_date > p_from_date and e.start_date > p_from_date - 367)
    )
  union all
  select * from public.calendar_events x
  where x.user_id = p_owner and x.series_id in (select id from masters)
    and (x.original_start_at between p_from - interval '32 days' and p_to or x.original_start_date between p_from_date - 367 and p_to_date)
    and not (x.status = 'confirmed' and (
      (not x.all_day and x.start_at < p_to and x.end_at > p_from and x.start_at > p_from - interval '32 days')
      or (x.all_day and x.start_date < p_to_date and x.end_date > p_from_date and x.start_date > p_from_date - 367)))
  limit 5000;
$function$;

-- Title search (case-insensitive substring; prefix matches first).
create or replace function public.persora_calendar_search(p_owner uuid, p_query text, p_limit integer default 30)
returns setof public.calendar_events
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with q as (
    select lower(btrim(coalesce(p_query, ''))) as term
  ), escaped as (
    select term, replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') as esc from q
  )
  select e.* from public.calendar_events e, escaped
  where e.user_id = p_owner and e.status = 'confirmed' and char_length(escaped.term) between 1 and 100
    and lower(e.title) like '%' || escaped.esc || '%'
  order by (lower(e.title) like escaped.esc || '%') desc,
    coalesce(e.start_at, e.start_date::timestamptz) desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$function$;

-- 5. Writes ----------------------------------------------------------------------

-- Creates (p_event.id not present in the table) or updates a single event or a
-- series. p_expected_revision guards against overwriting a newer edit.
-- p_reset_exceptions removes all exceptions (used when the series timing or
-- repetition changes). p_exception_patches updates exceptions whose fields
-- followed the series (title, notes, reminder…), each with its new reminder.
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
      id, user_id, title, description, location, category, all_day, time_zone, start_at, end_at, start_date, end_date,
      recurrence_freq, recurrence_interval, recurrence_until, recurrence_count, reminder_minutes, reminder_email
    ) values (
      p_id, p_owner, v.title, v.description, v.location, v.category, v.all_day, v.time_zone, v.start_at, v.end_at, v.start_date, v.end_date,
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

  perform public.persora_calendar_set_reminder(p_owner, v_row.id, v_row.id, p_reminder);
  return jsonb_build_object(
    'event', to_jsonb(v_row),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(x)) from public.calendar_events x where x.series_id = v_row.id and x.user_id = p_owner), '[]'::jsonb)
  );
end;
$function$;

-- Creates or updates the exception for one occurrence of a series (edit or
-- cancel "this event only"). The series row is not modified; its next
-- reminder is replaced so it skips the overridden occurrence.
create or replace function public.persora_calendar_save_occurrence(
  p_owner uuid,
  p_series_id uuid,
  p_exception_id uuid,
  p_original_start_at timestamptz,
  p_original_start_date date,
  p_status text,
  p_event jsonb,
  p_expected_revision integer,
  p_reminder jsonb,
  p_series_reminder jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v public.calendar_events%rowtype := public.persora_calendar_event_values(p_event);
  v_master public.calendar_events%rowtype;
  v_existing public.calendar_events%rowtype;
  v_row public.calendar_events%rowtype;
begin
  if p_status not in ('confirmed', 'cancelled') then
    raise exception 'Unknown occurrence status.' using errcode = 'P0400';
  end if;
  select * into v_master from public.calendar_events
  where id = p_series_id and user_id = p_owner and recurrence_freq is not null for update;
  if not found then
    raise exception 'That recurring event is not available in your calendar.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.calendar_events
  where series_id = p_series_id and user_id = p_owner
    and ((p_original_start_at is not null and original_start_at = p_original_start_at)
      or (p_original_start_date is not null and original_start_date = p_original_start_date))
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> v_existing.revision then
      raise exception 'This event was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
    end if;
    update public.calendar_events set
      status = p_status, title = v.title, description = v.description, location = v.location, category = v.category,
      all_day = v.all_day, time_zone = v.time_zone, start_at = v.start_at, end_at = v.end_at, start_date = v.start_date,
      end_date = v.end_date, reminder_minutes = v.reminder_minutes, reminder_email = v.reminder_email
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.calendar_events (
      id, user_id, series_id, original_start_at, original_start_date, status, title, description, location, category,
      all_day, time_zone, start_at, end_at, start_date, end_date, reminder_minutes, reminder_email
    ) values (
      coalesce(p_exception_id, gen_random_uuid()), p_owner, p_series_id, p_original_start_at, p_original_start_date, p_status,
      v.title, v.description, v.location, v.category, v.all_day, v.time_zone, v.start_at, v.end_at, v.start_date, v.end_date,
      v.reminder_minutes, v.reminder_email
    ) returning * into v_row;
  end if;

  perform public.persora_calendar_set_reminder(p_owner, v_row.id, p_series_id, case when p_status = 'cancelled' then null else p_reminder end);
  perform public.persora_calendar_set_reminder(p_owner, p_series_id, p_series_id, p_series_reminder);
  return jsonb_build_object('event', to_jsonb(v_row), 'series', to_jsonb(v_master));
end;
$function$;

-- Deletes a single event, a whole series (with its exceptions) or one
-- exception row. Reminders go with them (foreign keys cascade).
create or replace function public.persora_calendar_delete_event(p_owner uuid, p_id uuid, p_expected_revision integer)
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
    raise exception 'That event is no longer in your calendar.' using errcode = 'P0404';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_row.revision then
    raise exception 'This event was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
  end if;
  delete from public.calendar_events where id = p_id and user_id = p_owner;
  return jsonb_build_object('ok', true, 'id', p_id, 'seriesId', v_row.series_id);
end;
$function$;

-- 6. Reminder delivery -----------------------------------------------------------

-- Claims due reminders (optionally for one member). Rows are locked with SKIP
-- LOCKED so concurrent dispatchers never take the same reminder. A claim that
-- was abandoned for 5 minutes is retried, but if it had started sending an
-- email that email is NOT sent again (at-most-once; recorded as failed).
create or replace function public.persora_calendar_claim_reminders(p_limit integer default 50, p_owner uuid default null)
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
    select r.id from public.calendar_reminders r
    where (p_owner is null or r.user_id = p_owner)
      and ((r.status = 'scheduled' and r.remind_at <= v_now)
        or (r.status = 'processing' and r.claimed_at < v_now - interval '5 minutes'))
    order by r.remind_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of r skip locked
  ), claimed as (
    update public.calendar_reminders r set
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
    'event', to_jsonb(e),
    'owner', jsonb_build_object('email', p.email, 'full_name', p.full_name, 'timezone', p.timezone,
      'email_verified', p.email_verified_at is not null, 'active', p.account_status = 'active')
  )), '[]'::jsonb) into v_rows
  from claimed c
  join public.calendar_events e on e.id = c.event_id
  join public.profiles p on p.id = c.user_id;
  return v_rows;
end;
$function$;

-- Finishes a claimed reminder: records the email outcome and schedules the
-- series' next reminder (only if the event wasn't edited meanwhile — an edit
-- already scheduled its own). Returns false when the claim was lost.
create or replace function public.persora_calendar_complete_reminder(
  p_id uuid, p_claimed_at timestamptz, p_email_status text, p_email_note text, p_event_revision integer, p_next jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reminder public.calendar_reminders%rowtype;
begin
  if p_email_status not in ('not_requested', 'sent', 'failed', 'skipped') then
    raise exception 'Unknown email status.' using errcode = 'P0400';
  end if;
  update public.calendar_reminders set
    status = 'sent', processed_at = clock_timestamp(),
    email_status = case when email_status = 'failed' then 'failed' else p_email_status end,
    email_note = coalesce(left(p_email_note, 200), email_note)
  where id = p_id and status = 'processing' and claimed_at = p_claimed_at
  returning * into v_reminder;
  if not found then
    return false;
  end if;
  if p_next is not null and jsonb_typeof(p_next) = 'object' and exists (
    select 1 from public.calendar_events where id = v_reminder.event_id and revision = p_event_revision
  ) and not exists (
    select 1 from public.calendar_reminders where event_id = v_reminder.event_id and status = 'scheduled'
  ) then
    perform public.persora_calendar_set_reminder(v_reminder.user_id, v_reminder.event_id, v_reminder.root_id, p_next);
  end if;
  return true;
end;
$function$;

-- pg_cron tick: wakes the API dispatcher only when something is due.
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

revoke all on function public.persora_calendar_set_reminder(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.persora_calendar_event_values(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.persora_calendar_events_in_range(uuid, timestamptz, timestamptz, date, date) from public, anon, authenticated;
revoke all on function public.persora_calendar_search(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.persora_calendar_save_event(uuid, uuid, jsonb, integer, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_save_occurrence(uuid, uuid, uuid, timestamptz, date, text, jsonb, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_delete_event(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.persora_calendar_claim_reminders(integer, uuid) from public, anon, authenticated;
revoke all on function public.persora_calendar_complete_reminder(uuid, timestamptz, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_dispatch_ping() from public, anon, authenticated;
revoke all on function public.persora_calendar_event_guard() from public, anon, authenticated, service_role;
grant execute on function public.persora_calendar_events_in_range(uuid, timestamptz, timestamptz, date, date) to service_role;
grant execute on function public.persora_calendar_search(uuid, text, integer) to service_role;
grant execute on function public.persora_calendar_save_event(uuid, uuid, jsonb, integer, boolean, jsonb, jsonb) to service_role;
grant execute on function public.persora_calendar_save_occurrence(uuid, uuid, uuid, timestamptz, date, text, jsonb, integer, jsonb, jsonb) to service_role;
grant execute on function public.persora_calendar_delete_event(uuid, uuid, integer) to service_role;
grant execute on function public.persora_calendar_claim_reminders(integer, uuid) to service_role;
grant execute on function public.persora_calendar_complete_reminder(uuid, timestamptz, text, text, integer, jsonb) to service_role;
grant execute on function public.persora_calendar_dispatch_ping() to service_role;

-- 7. Every-minute tick (guarded: the migration also applies without pg_cron/pg_net).
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception
    when insufficient_privilege or undefined_file or feature_not_supported or invalid_parameter_value then
      raise warning 'pg_cron is unavailable; calendar reminders are dispatched by the API and external schedulers.';
  end;
  begin
    create extension if not exists pg_net;
  exception
    when insufficient_privilege or undefined_file or feature_not_supported or invalid_parameter_value then
      raise warning 'pg_net is unavailable; pg_cron cannot wake the calendar reminder dispatcher.';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'persora-calendar-reminders') then
      perform cron.schedule('persora-calendar-reminders', '* * * * *', $cron$select public.persora_calendar_dispatch_ping();$cron$);
    end if;
  end if;
end $$;
