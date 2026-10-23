-- Persora Password Manager: remove the retired browser-encryption vault format.
--
-- Apply ONLY after:
--   1. 202610240001_password_vault_master_password.sql is applied,
--   2. the release with the master-password vault is deployed, and
--   3. the one-time legacy migration reports `pending: 0`
--      (POST /api/password-vault/admin/migrate-legacy as an administrator, or
--      `npm run vault:migrate-legacy`; see PASSWORD_VAULT.md).
--
-- The guard below aborts the whole migration — nothing is dropped — while any
-- live record still exists only as legacy ciphertext. Saved records, their ids,
-- revisions and ownership (user_id) are kept as they are.

do $$
declare n bigint;
begin
  select count(*) into n from public.password_vault_items where not deleted and data is null;
  if n > 0 then
    raise exception 'Password Manager: % saved password(s) are still in the legacy encrypted format. Run the one-time legacy migration until it reports pending = 0, then apply this migration again.', n;
  end if;
end $$;

-- Legacy write trigger and transitional migration helpers.
drop trigger if exists password_vault_items_legacy_write on public.password_vault_items;
drop function if exists public.persora_password_vault_items_legacy_write();
drop function if exists public.persora_vault_legacy_pending(uuid, integer, uuid);
drop function if exists public.persora_vault_legacy_store(uuid, jsonb);

-- Functions of the retired Argon2id/AES-GCM vault and escrow recovery (202610230009).
drop function if exists public.persora_password_vault_state(uuid, bigint);
drop function if exists public.persora_password_vault_setup(uuid, jsonb, jsonb);
drop function if exists public.persora_password_vault_apply(uuid, integer, jsonb);
drop function if exists public.persora_password_vault_update_escrow(uuid, integer, jsonb, text);
drop function if exists public.persora_vault_recovery_verify(uuid, text, text, timestamptz, integer, text, timestamptz);
drop function if exists public.persora_vault_recovery_release(uuid, text, timestamptz);
drop function if exists public.persora_vault_recovery_complete(uuid, text, timestamptz, integer, jsonb, jsonb);

-- Legacy columns: wrapped vault keys, Argon2id parameters, key checks, escrow
-- copies and per-record ciphertext.
alter table public.password_vault_items drop constraint if exists password_vault_items_payload;
alter table public.password_vault_items
  drop column if exists key_generation, drop column if exists iv, drop column if exists ciphertext;
alter table public.password_vault_items add constraint password_vault_items_payload
  check ((deleted and data is null) or (not deleted and data is not null));

alter table public.password_vaults
  drop column if exists format_version, drop column if exists key_generation, drop column if exists kdf,
  drop column if exists salt, drop column if exists wrapped_dek, drop column if exists key_check,
  drop column if exists escrow, drop column if exists escrow_key_id;

alter table public.password_vault_recovery_grants drop column if exists key_released_at;

comment on table public.password_vaults is 'Password Manager: one row per member. master_password_hash is a bcrypt verifier (pgcrypto); the master password is never stored.';
comment on table public.password_vault_items is 'Password Manager records as JSON (data). Not application-encrypted: protected by Supabase encryption at rest, TLS, RLS-locked tables and server-side master-password sessions.';
comment on table public.password_vault_sessions is 'Password Manager unlock sessions (SHA-256 of the token only), bound to a Persora session.';
