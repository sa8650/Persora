-- pgbench workload: seed a one-use row in password_vault_recovery_codes with
-- the supplied user UUID/email and matching HMAC code_hash first. Run 8 clients;
-- exactly one call may return outcome=success; remaining calls return missing.
select * from public.complete_vault_recovery_code(
 :'uid'::uuid,
 :'email'::text,
 :'candidate_hash'::text,
 clock_timestamp(),
 5
);
