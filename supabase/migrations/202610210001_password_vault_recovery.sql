-- OTP challenges for Password Manager key recovery. No vault keys, recovery keys,
-- ciphertext, master passwords, or decrypted data are stored here.
create table if not exists public.password_vault_recovery_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  code_hash text not null default '',
  expires_at timestamptz not null,
  sent_at timestamptz not null,
  window_started_at timestamptz not null,
  send_count integer not null default 0 check (send_count >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.password_vault_recovery_codes enable row level security;
revoke all on public.password_vault_recovery_codes from public, anon, authenticated;
grant all on public.password_vault_recovery_codes to service_role;

create or replace function public.reserve_vault_recovery_send(
 p_user_id uuid,p_email text,p_code_hash text,p_now timestamptz,p_expires_at timestamptz,
 p_resend_seconds integer,p_window_seconds integer,p_max_sends integer
) returns table(allowed boolean,reason text,retry_after_seconds integer)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.password_vault_recovery_codes%rowtype; nstart timestamptz; ncount integer; retry integer; registered text;
begin
 insert into public.password_vault_recovery_codes(user_id,email,code_hash,expires_at,sent_at,window_started_at,send_count,attempt_count)
 values(p_user_id,p_email,'',p_now,p_now-make_interval(secs=>greatest(p_resend_seconds,0)+1),p_now,0,0) on conflict(user_id) do nothing;
 select * into c from public.password_vault_recovery_codes where user_id=p_user_id for update;
 select lower(email) into registered from public.profiles where id=p_user_id and account_status='active';
 if registered is null then return query select false,'missing_profile'::text,null::integer; return; end if;
 if registered<>lower(p_email) then return query select false,'email_changed'::text,null::integer; return; end if;
 if c.sent_at+make_interval(secs=>greatest(p_resend_seconds,0))>p_now then
   retry:=ceil(extract(epoch from(c.sent_at+make_interval(secs=>greatest(p_resend_seconds,0))-p_now)))::integer;
   return query select false,'resend'::text,greatest(retry,1); return;
 end if;
 if c.window_started_at is null or p_now<c.window_started_at or p_now>=c.window_started_at+make_interval(secs=>greatest(p_window_seconds,1)) then nstart:=p_now;ncount:=0;
 else nstart:=c.window_started_at;ncount:=c.send_count; end if;
 if ncount>=p_max_sends then return query select false,'hourly_limit'::text,null::integer; return; end if;
 update public.password_vault_recovery_codes set email=lower(p_email),code_hash=p_code_hash,expires_at=p_expires_at,sent_at=p_now,window_started_at=nstart,send_count=ncount+1,attempt_count=0,updated_at=p_now where user_id=p_user_id;
 return query select true,'ok'::text,null::integer;
end $$;

create or replace function public.invalidate_vault_recovery_code(p_user_id uuid,p_code_hash text,p_now timestamptz)
returns void language sql security definer set search_path=pg_catalog,public as $$
 update public.password_vault_recovery_codes set code_hash='',expires_at=p_now,attempt_count=0,updated_at=p_now where user_id=p_user_id and code_hash=p_code_hash;
$$;

create or replace function public.complete_vault_recovery_code(p_user_id uuid,p_email text,p_candidate_hash text,p_now timestamptz,p_max_attempts integer)
returns table(outcome text,attempt_count integer)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.password_vault_recovery_codes%rowtype; n integer;
begin
 select * into c from public.password_vault_recovery_codes where user_id=p_user_id for update;
 if not found then return query select 'missing'::text,0;return;end if;
 if lower(c.email)<>lower(p_email) then return query select 'email_changed'::text,c.attempt_count;return;end if;
 if c.expires_at<=p_now then update public.password_vault_recovery_codes set code_hash='',updated_at=p_now where user_id=p_user_id;return query select 'expired'::text,c.attempt_count;return;end if;
 if c.attempt_count>=p_max_attempts then return query select 'too_many_attempts'::text,c.attempt_count;return;end if;
 if c.code_hash is distinct from p_candidate_hash then
   n:=c.attempt_count+1;update public.password_vault_recovery_codes set attempt_count=n,updated_at=p_now where user_id=p_user_id;
   if n>=p_max_attempts then return query select 'too_many_attempts'::text,n;else return query select 'mismatch'::text,n;end if;return;
 end if;
 delete from public.password_vault_recovery_codes where user_id=p_user_id;
 return query select 'success'::text,c.attempt_count;
end $$;

revoke all on function public.reserve_vault_recovery_send(uuid,text,text,timestamptz,timestamptz,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.invalidate_vault_recovery_code(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_vault_recovery_code(uuid,text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.reserve_vault_recovery_send(uuid,text,text,timestamptz,timestamptz,integer,integer,integer) to service_role;
grant execute on function public.invalidate_vault_recovery_code(uuid,text,timestamptz) to service_role;
grant execute on function public.complete_vault_recovery_code(uuid,text,text,timestamptz,integer) to service_role;
