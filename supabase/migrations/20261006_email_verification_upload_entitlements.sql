-- Store only an HMAC of the short-lived email OTP. The API computes the HMAC with
-- the private Supabase server key; client roles cannot read or alter these challenges.
alter table public.profiles
  add column if not exists email_verified_at timestamptz;

create table if not exists public.email_verification_codes (
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

alter table public.email_verification_codes enable row level security;
revoke all on public.email_verification_codes from anon, authenticated;
grant all on public.email_verification_codes to service_role;


-- Serialize verification-code issuance so simultaneous requests cannot bypass resend or hourly caps.
create or replace function public.reserve_email_verification_send(
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
  challenge public.email_verification_codes%rowtype;
  v_profile_email text;
  v_verified_at timestamptz;
  v_window_started_at timestamptz;
  v_send_count integer;
  v_retry integer;
begin
  insert into public.email_verification_codes (
    user_id, email, code_hash, expires_at, sent_at, window_started_at, send_count, attempt_count
  ) values (
    p_user_id, p_email, p_code_hash, p_now, p_now - make_interval(secs => greatest(p_resend_seconds, 0) + 1), p_now, 0, 0
  ) on conflict (user_id) do nothing;

  select * into challenge
  from public.email_verification_codes
  where user_id = p_user_id
  for update;

  select p.email, p.email_verified_at into v_profile_email, v_verified_at
  from public.profiles p
  where p.id = p_user_id;
  if v_verified_at is not null then
    delete from public.email_verification_codes where user_id = p_user_id;
    return query select false, 'already_verified'::text, null::integer;
    return;
  end if;
  if v_profile_email is null then
    return query select false, 'missing_profile'::text, null::integer;
    return;
  end if;
  if lower(v_profile_email) <> lower(p_email) then
    update public.email_verification_codes
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

  update public.email_verification_codes
  set email = p_email,
      code_hash = p_code_hash,
      expires_at = p_expires_at,
      sent_at = p_now,
      window_started_at = v_window_started_at,
      send_count = v_send_count + 1,
      attempt_count = 0,
      updated_at = p_now
  where user_id = p_user_id;

  return query select true, 'ok'::text, 0;
end;
$function$;

-- Invalidate only the code whose delivery failed, without resetting the send counters or a newer code.
create or replace function public.invalidate_email_verification_code(
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
  update public.email_verification_codes
  set code_hash = '', expires_at = p_now, updated_at = p_now
  where user_id = p_user_id and code_hash = p_code_hash;
end;
$function$;

-- Verify and consume the challenge under one row lock. Wrong attempts increment atomically; success
-- marks the profile and deletes the code in the same transaction.
create or replace function public.complete_email_verification(
  p_user_id uuid,
  p_email text,
  p_candidate_hash text,
  p_now timestamptz,
  p_max_attempts integer
)
returns table(outcome text, attempt_count integer, verified_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  challenge public.email_verification_codes%rowtype;
  v_next_attempt integer;
  v_verified_at timestamptz;
begin
  select * into challenge
  from public.email_verification_codes
  where user_id = p_user_id
  for update;

  if not found then
    select p.email_verified_at into v_verified_at
    from public.profiles p
    where p.id = p_user_id and lower(p.email) = lower(p_email);
    if v_verified_at is not null then
      return query select 'already_verified'::text, 0, v_verified_at;
    else
      return query select 'missing'::text, 0, null::timestamptz;
    end if;
    return;
  end if;

  if lower(challenge.email) <> lower(p_email) then
    update public.email_verification_codes
    set code_hash = '', expires_at = p_now, attempt_count = 0, updated_at = p_now
    where user_id = p_user_id;
    return query select 'email_changed'::text, challenge.attempt_count, null::timestamptz;
    return;
  end if;

  if challenge.expires_at is null or challenge.expires_at <= p_now then
    update public.email_verification_codes
    set code_hash = '', expires_at = p_now, attempt_count = 0, updated_at = p_now
    where user_id = p_user_id;
    return query select 'expired'::text, challenge.attempt_count, null::timestamptz;
    return;
  end if;

  if challenge.attempt_count >= p_max_attempts then
    return query select 'too_many_attempts'::text, challenge.attempt_count, null::timestamptz;
    return;
  end if;

  if challenge.code_hash is distinct from p_candidate_hash then
    v_next_attempt := challenge.attempt_count + 1;
    update public.email_verification_codes
    set attempt_count = v_next_attempt, updated_at = p_now
    where user_id = p_user_id;
    if v_next_attempt >= p_max_attempts then
      return query select 'too_many_attempts'::text, v_next_attempt, null::timestamptz;
    else
      return query select 'mismatch'::text, v_next_attempt, null::timestamptz;
    end if;
    return;
  end if;

  update public.profiles p
  set email_verified_at = p_now, updated_at = p_now
  where p.id = p_user_id and lower(p.email) = lower(p_email) and p.email_verified_at is null
  returning p.email_verified_at into v_verified_at;

  if v_verified_at is null then
    select p.email_verified_at into v_verified_at
    from public.profiles p
    where p.id = p_user_id and lower(p.email) = lower(p_email);
    delete from public.email_verification_codes where user_id = p_user_id;
    if v_verified_at is not null then
      return query select 'already_verified'::text, challenge.attempt_count, v_verified_at;
    else
      return query select 'email_changed'::text, challenge.attempt_count, null::timestamptz;
    end if;
    return;
  end if;

  delete from public.email_verification_codes where user_id = p_user_id;
  return query select 'verified'::text, challenge.attempt_count, v_verified_at;
end;
$function$;

revoke all on function public.reserve_email_verification_send(uuid, text, text, timestamptz, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.invalidate_email_verification_code(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_email_verification(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reserve_email_verification_send(uuid, text, text, timestamptz, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.invalidate_email_verification_code(uuid, text, timestamptz) to service_role;
grant execute on function public.complete_email_verification(uuid, text, text, timestamptz, integer) to service_role;
