-- Password recovery via Brevo email verification code
create table if not exists public.password_recovery_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  sent_at timestamptz not null,
  window_started_at timestamptz not null,
  send_count integer not null default 0 check (send_count >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.password_recovery_codes enable row level security;
revoke all on public.password_recovery_codes from anon, authenticated;
grant all on public.password_recovery_codes to service_role;

create or replace function public.reserve_password_recovery_send(
  p_user_id uuid,
  p_email text,
  p_code_hash text,
  p_now timestamptz,
  p_expires_at timestamptz,
  p_resend_seconds integer,
  p_window_seconds integer,
  p_max_sends integer
)
returns table(allowed boolean, reason text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  challenge public.password_recovery_codes%rowtype;
  v_profile_email text;
  v_window_started_at timestamptz;
  v_send_count integer;
  v_retry integer;
begin
  insert into public.password_recovery_codes (
    user_id, email, code_hash, expires_at, sent_at, window_started_at, send_count, attempt_count
  ) values (
    p_user_id, p_email, p_code_hash, p_now, p_now - make_interval(secs => greatest(p_resend_seconds, 0) + 1), p_now, 0, 0
  ) on conflict (user_id) do nothing;

  select * into challenge
  from public.password_recovery_codes
  where user_id = p_user_id
  for update;

  select p.email into v_profile_email
  from public.profiles p
  where p.id = p_user_id;

  if v_profile_email is null then
    return query select false, 'missing_profile'::text, null::integer;
    return;
  end if;

  if lower(v_profile_email) <> lower(p_email) then
    update public.password_recovery_codes
    set email = v_profile_email, code_hash = '', expires_at = p_now, attempt_count = 0, updated_at = p_now
    where user_id = p_user_id;
    return query select false, 'email_changed'::text, null::integer;
    return;
  end if;

  if challenge.sent_at + make_interval(secs => greatest(p_resend_seconds, 0)) > p_now then
    v_retry := ceil(extract(epoch from (challenge.sent_at + make_interval(secs => greatest(p_resend_seconds, 0)) - p_now)))::integer;
    return query select false, 'resend'::text, greatest(v_retry, 1);
    return;
  end if;

  if challenge.window_started_at is null
    or p_now < challenge.window_started_at
    or p_now >= challenge.window_started_at + make_interval(secs => greatest(p_window_seconds, 1)) then
    v_window_started_at := p_now;
    v_send_count := 0;
  else
    v_window_started_at := challenge.window_started_at;
    v_send_count := challenge.send_count;
  end if;

  if v_send_count >= p_max_sends then
    return query select false, 'hourly_limit'::text, null::integer;
    return;
  end if;

  update public.password_recovery_codes
  set email = p_email,
      code_hash = p_code_hash,
      expires_at = p_expires_at,
      sent_at = p_now,
      window_started_at = v_window_started_at,
      send_count = v_send_count + 1,
      attempt_count = 0,
      updated_at = p_now
  where user_id = p_user_id;

  return query select true, 'ok'::text, null::integer;
end;
$function$;

create or replace function public.invalidate_password_recovery_code(
  p_user_id uuid,
  p_code_hash text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  update public.password_recovery_codes
  set code_hash = '',
      expires_at = p_now,
      attempt_count = 0,
      updated_at = p_now
  where user_id = p_user_id and code_hash = p_code_hash;
end;
$function$;

create or replace function public.complete_password_recovery(
  p_user_id uuid,
  p_email text,
  p_candidate_hash text,
  p_new_password_hash text,
  p_now timestamptz,
  p_max_attempts integer
)
returns table(outcome text, attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  challenge public.password_recovery_codes%rowtype;
  v_next_attempt integer;
begin
  select * into challenge
  from public.password_recovery_codes
  where user_id = p_user_id
  for update;

  if not found then
    return query select 'missing'::text, 0;
    return;
  end if;

  if lower(challenge.email) <> lower(p_email) then
    update public.password_recovery_codes
    set code_hash = '', expires_at = p_now, attempt_count = 0, updated_at = p_now
    where user_id = p_user_id;
    return query select 'email_changed'::text, challenge.attempt_count;
    return;
  end if;

  if challenge.expires_at is null or challenge.expires_at <= p_now then
    update public.password_recovery_codes
    set code_hash = '', expires_at = p_now, attempt_count = 0, updated_at = p_now
    where user_id = p_user_id;
    return query select 'expired'::text, challenge.attempt_count;
    return;
  end if;

  if challenge.attempt_count >= p_max_attempts then
    return query select 'too_many_attempts'::text, challenge.attempt_count;
    return;
  end if;

  if challenge.code_hash is distinct from p_candidate_hash then
    v_next_attempt := challenge.attempt_count + 1;
    update public.password_recovery_codes
    set attempt_count = v_next_attempt, updated_at = p_now
    where user_id = p_user_id;
    if v_next_attempt >= p_max_attempts then
      return query select 'too_many_attempts'::text, v_next_attempt;
    else
      return query select 'mismatch'::text, v_next_attempt;
    end if;
    return;
  end if;

  -- Code verified: update profile password hash
  update public.profiles
  set password_hash = p_new_password_hash, updated_at = p_now
  where id = p_user_id;

  -- Terminate all existing sessions for this user for security
  delete from public.user_sessions where user_id = p_user_id;

  -- Remove used recovery challenge
  delete from public.password_recovery_codes where user_id = p_user_id;
  return query select 'success'::text, challenge.attempt_count;
end;
$function$;

revoke all on function public.reserve_password_recovery_send(uuid, text, text, timestamptz, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.invalidate_password_recovery_code(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_password_recovery(uuid, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reserve_password_recovery_send(uuid, text, text, timestamptz, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.invalidate_password_recovery_code(uuid, text, timestamptz) to service_role;
grant execute on function public.complete_password_recovery(uuid, text, text, text, timestamptz, integer) to service_role;
