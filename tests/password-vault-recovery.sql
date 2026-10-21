-- Run against a disposable Supabase database after schema.sql and
-- 202610210001_password_vault_recovery.sql. All fixture changes roll back.
begin;
do $$
declare uid uuid:=gen_random_uuid(); email text:='vault-recovery-test-'||gen_random_uuid()||'@example.test'; now_at timestamptz:=clock_timestamp(); r record; i integer;
begin
 insert into public.profiles(id,email,full_name,account_status) values(uid,email,'Recovery test','active');
 -- Reserve an OTP and assert send cooldown / hourly quota under serialized RPC updates.
 select * into r from public.reserve_vault_recovery_send(uid,email,'hash-1',now_at,now_at+interval '10 minutes',60,3600,2);
 if not r.allowed then raise exception 'first send should succeed'; end if;
 select * into r from public.reserve_vault_recovery_send(uid,email,'hash-2',now_at+interval '5 seconds',now_at+interval '10 minutes',60,3600,2);
 if r.allowed or r.reason<>'resend' then raise exception 'resend cooldown not enforced'; end if;
 select * into r from public.complete_vault_recovery_code(uid,email,'wrong',now_at+interval '6 seconds',5);
 if r.outcome<>'mismatch' or r.attempt_count<>1 then raise exception 'wrong OTP should count as a failed attempt'; end if;
 select * into r from public.complete_vault_recovery_code(uid,email,'hash-1',now_at+interval '7 seconds',5);
 if r.outcome<>'success' then raise exception 'correct OTP should succeed'; end if;
 select * into r from public.complete_vault_recovery_code(uid,email,'hash-1',now_at+interval '8 seconds',5);
 if r.outcome<>'missing' then raise exception 'verified OTP must be single-use'; end if;
 select * into r from public.reserve_vault_recovery_send(uid,email,'hash-expired',now_at+interval '61 seconds',now_at+interval '62 seconds',60,3600,2);
 if not r.allowed then raise exception 'second send should be allowed after cooldown'; end if;
 select * into r from public.complete_vault_recovery_code(uid,email,'hash-expired',now_at+interval '63 seconds',5);
 if r.outcome<>'expired' then raise exception 'expired OTP must be rejected'; end if;
 -- Exhaust failure budget; a correct code must not work after the cap.
 select * into r from public.reserve_vault_recovery_send(uid,email,'hash-attempts',now_at+interval '122 seconds',now_at+interval '10 minutes',60,3600,5);
 for i in 1..5 loop select * into r from public.complete_vault_recovery_code(uid,email,'bad',now_at+interval '123 seconds',5); end loop;
 if r.outcome<>'too_many_attempts' then raise exception 'attempt cap not enforced'; end if;
 -- Hourly send limit is separately verified with cooldown-spaced requests.
 for i in 1..5 loop
   select * into r from public.reserve_vault_recovery_send(uid,email,'rate-'||i,now_at+make_interval(secs=>200+i*61),now_at+interval '1 hour',60,3600,5);
   if i<=3 and not r.allowed then raise exception 'send % unexpectedly denied: %',i,r.reason; end if;
   if i=4 and (r.allowed or r.reason<>'hourly_limit') then raise exception 'hourly limit not enforced'; end if;
 end loop;
 delete from public.password_vault_recovery_codes where user_id=uid;
 delete from public.profiles where id=uid;
end $$;
rollback;

-- Concurrency/single-use stress (run after the SQL assertions with a dedicated
-- disposable challenge; exactly one success is expected):
-- pgbench -n -c 8 -j 8 -t 1 -f tests/password-vault-recovery-concurrent.sql "$DATABASE_URL"
