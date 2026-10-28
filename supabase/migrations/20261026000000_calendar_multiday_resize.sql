-- Persora Calendar — multi-day timed/all-day range accuracy, span indexes,
-- and recurring occurrence item_type preservation for two-way resizing.
-- Idempotent so it applies cleanly to existing databases and fresh schema.sql setups.

create index if not exists calendar_events_owner_span_at_idx ON public.calendar_events USING btree (user_id, start_at, end_at) WHERE ((start_at IS NOT NULL) AND (recurrence_freq IS NULL));
create index if not exists calendar_events_owner_span_date_idx ON public.calendar_events USING btree (user_id, start_date, end_date) WHERE ((start_date IS NOT NULL) AND (recurrence_freq IS NULL));

CREATE OR REPLACE FUNCTION public.persora_calendar_events_in_range(p_owner uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_from_date date, p_to_date date)
 RETURNS SETOF public.calendar_events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with masters as (
    select * from public.calendar_events
    where user_id = p_owner and recurrence_freq is not null
      and ((all_day and start_date < p_to_date) or (not all_day and start_at < p_to))
      and (recurrence_until is null or recurrence_until >= (case when all_day then p_from_date - 367 else p_from_date - 33 end))
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
revoke all on function public.persora_calendar_events_in_range(p_owner uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_from_date date, p_to_date date) from public, anon, authenticated;
grant execute on function public.persora_calendar_events_in_range(p_owner uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_from_date date, p_to_date date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_save_occurrence(p_owner uuid, p_series_id uuid, p_exception_id uuid, p_original_start_at timestamp with time zone, p_original_start_date date, p_status text, p_event jsonb, p_expected_revision integer, p_reminder jsonb, p_series_reminder jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      status = p_status, item_type = v_master.item_type, title = v.title, description = v.description, location = v.location, category = v.category,
      all_day = v.all_day, time_zone = v.time_zone, start_at = v.start_at, end_at = v.end_at, start_date = v.start_date,
      end_date = v.end_date, reminder_minutes = v.reminder_minutes, reminder_email = v.reminder_email
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.calendar_events (
      id, user_id, series_id, item_type, original_start_at, original_start_date, status, title, description, location, category,
      all_day, time_zone, start_at, end_at, start_date, end_date, reminder_minutes, reminder_email
    ) values (
      coalesce(p_exception_id, gen_random_uuid()), p_owner, p_series_id, v_master.item_type, p_original_start_at, p_original_start_date, p_status,
      v.title, v.description, v.location, v.category, v.all_day, v.time_zone, v.start_at, v.end_at, v.start_date, v.end_date,
      v.reminder_minutes, v.reminder_email
    ) returning * into v_row;
  end if;

  perform public.persora_calendar_set_reminder(p_owner, v_row.id, p_series_id, case when p_status = 'cancelled' then null else p_reminder end);
  perform public.persora_calendar_set_reminder(p_owner, p_series_id, p_series_id, p_series_reminder);
  return jsonb_build_object('event', to_jsonb(v_row), 'series', to_jsonb(v_master));
end;
$function$;
revoke all on function public.persora_calendar_save_occurrence(p_owner uuid, p_series_id uuid, p_exception_id uuid, p_original_start_at timestamp with time zone, p_original_start_date date, p_status text, p_event jsonb, p_expected_revision integer, p_reminder jsonb, p_series_reminder jsonb) from public, anon, authenticated;
grant execute on function public.persora_calendar_save_occurrence(p_owner uuid, p_series_id uuid, p_exception_id uuid, p_original_start_at timestamp with time zone, p_original_start_date date, p_status text, p_event jsonb, p_expected_revision integer, p_reminder jsonb, p_series_reminder jsonb) to service_role;
