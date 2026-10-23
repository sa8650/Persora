-- Persora Password Manager: encrypted multi-device vault + trusted email recovery.
--
-- What is stored here (see PASSWORD_VAULT_RECOVERY.md):
--   * password_vaults: one row per member. Argon2id parameters + salt, the
--     vault data key (DEK) wrapped with the master-password key (AES-256-GCM),
--     an AES-GCM key-check value, and an *escrow* copy of the DEK sealed to the
--     server's recovery public key (ECDH P-256 + HKDF + AES-256-GCM). The
--     matching private key lives only in the Worker secret
--     PASSWORD_VAULT_ESCROW_PRIVATE_KEY, never in this database.
--   * password_vault_items: one AES-256-GCM ciphertext per saved login.
--     Titles, usernames, passwords, URLs, notes and security answers are only
--     inside the ciphertext. Deletions leave a tombstone so other devices sync.
--   * password_vault_recovery_grants: a short-lived, single-use grant created
--     only after the emailed OTP is verified (hash only, never the token).
-- Master passwords, plaintext entries and unwrapped keys are never stored.
--
-- Every table has RLS enabled with no policies and no anon/authenticated
-- grants: browsers can only reach the data through the authenticated Pages
-- Functions routes in cloudflare/password-vault.js (service role), which scope
-- every call to the signed-in member's id.

create sequence if not exists public.password_vault_change_seq;

create table if not exists public.password_vaults (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  format_version smallint not null default 3 check (format_version = 3),
  key_generation integer not null default 1 check (key_generation >= 1),
  kdf jsonb not null check (jsonb_typeof(kdf) = 'object' and kdf->>'algorithm' = 'argon2id'),
  salt text not null check (char_length(salt) between 20 and 100),
  wrapped_dek jsonb not null check (jsonb_typeof(wrapped_dek) = 'object'),
  key_check jsonb not null check (jsonb_typeof(key_check) = 'object'),
  escrow jsonb not null check (jsonb_typeof(escrow) = 'object'),
  escrow_key_id text not null check (char_length(escrow_key_id) between 8 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  master_password_changed_at timestamptz not null default now()
);

create table if not exists public.password_vault_items (
  user_id uuid not null references public.password_vaults(user_id) on delete cascade,
  id uuid not null,
  key_generation integer not null check (key_generation >= 1),
  iv text,
  ciphertext text,
  deleted boolean not null default false,
  revision integer not null default 1 check (revision >= 1),
  change_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint password_vault_items_payload check (
    (deleted and iv is null and ciphertext is null)
    or (not deleted and char_length(iv) = 16 and char_length(ciphertext) between 24 and 87384)
  )
);
create index if not exists password_vault_items_changes_idx on public.password_vault_items(user_id, change_seq);

create table if not exists public.password_vault_recovery_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  grant_hash text not null check (char_length(grant_hash) = 64),
  expires_at timestamptz not null,
  key_released_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.password_vaults enable row level security;
alter table public.password_vault_items enable row level security;
alter table public.password_vault_recovery_grants enable row level security;
revoke all on public.password_vaults, public.password_vault_items, public.password_vault_recovery_grants from public, anon, authenticated;
grant all on public.password_vaults, public.password_vault_items, public.password_vault_recovery_grants to service_role;
revoke all on sequence public.password_vault_change_seq from public, anon, authenticated;
grant usage, select on sequence public.password_vault_change_seq to service_role;

-- Full load (p_since = 0: live items only) or incremental sync (p_since > 0:
-- changes incl. tombstones). One statement = one snapshot, so the vault
-- metadata, the items and the cursor are always consistent with each other.
-- Writers lock the member's vault row before taking a sequence number, so for
-- one member change_seq order equals commit order and a cursor never skips.
create or replace function public.persora_password_vault_state(p_user_id uuid, p_since bigint default 0)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with v as (select * from public.password_vaults where user_id = p_user_id),
  changed as (
    select * from public.password_vault_items
    where user_id = p_user_id and change_seq > greatest(coalesce(p_since, 0), 0)
  )
  select case when not exists (select 1 from v)
    then jsonb_build_object('vault', null, 'items', '[]'::jsonb, 'cursor', 0)
    else jsonb_build_object(
      'vault', (select jsonb_build_object(
        'keyGeneration', v.key_generation, 'kdf', v.kdf, 'salt', v.salt,
        'wrappedDek', v.wrapped_dek, 'keyCheck', v.key_check, 'escrowKeyId', v.escrow_key_id,
        'updatedAt', v.updated_at, 'masterPasswordChangedAt', v.master_password_changed_at) from v),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'revision', c.revision, 'seq', c.change_seq, 'deleted', c.deleted,
          'keyGeneration', c.key_generation, 'iv', c.iv, 'ciphertext', c.ciphertext) order by c.change_seq)
        from changed c where coalesce(p_since, 0) > 0 or not c.deleted), '[]'::jsonb),
      'cursor', greatest(coalesce((select max(change_seq) from changed), 0), greatest(coalesce(p_since, 0), 0)))
  end;
$$;

-- First-time setup (or migration of an on-device vault): creates the vault row
-- and all initial items atomically. Never overwrites an existing vault.
create or replace function public.persora_password_vault_setup(p_user_id uuid, p_vault jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare item jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'password_vault_invalid_items'; end if;
  if jsonb_array_length(p_items) > 5000 then raise exception 'password_vault_item_limit'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'password_vault_invalid_items';
  end if;
  insert into public.password_vaults(user_id, key_generation, kdf, salt, wrapped_dek, key_check, escrow, escrow_key_id)
  values (p_user_id, 1, p_vault->'kdf', p_vault->>'salt', p_vault->'wrappedDek', p_vault->'keyCheck', p_vault->'escrow', p_vault->>'escrowKeyId')
  on conflict (user_id) do nothing;
  if not found then return jsonb_build_object('outcome', 'exists'); end if;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.password_vault_items(user_id, id, key_generation, iv, ciphertext, deleted, revision, change_seq)
    values (p_user_id, (item->>'id')::uuid, 1, item->>'iv', item->>'ciphertext', false, 1, nextval('public.password_vault_change_seq'));
  end loop;
  return jsonb_build_object('outcome', 'created', 'state', public.persora_password_vault_state(p_user_id, 0));
end $$;

-- Applies a batch of item upserts/deletions with optimistic concurrency: every
-- change carries the revision it was based on (0 = new). Any conflict rejects
-- the whole batch, so a device can never silently overwrite another device's
-- newer edit. Writes from a device holding an outdated vault key (after a
-- master-password reset) are rejected with key_changed.
create or replace function public.persora_password_vault_apply(p_user_id uuid, p_key_generation integer, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v public.password_vaults%rowtype; c jsonb; cur public.password_vault_items%rowtype; base integer;
  conflicts jsonb := '[]'::jsonb; ids uuid[] := '{}'; s bigint;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'password_vault_invalid_items'; end if;
  select * into v from public.password_vaults where user_id = p_user_id for update;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  if v.key_generation <> p_key_generation then
    return jsonb_build_object('outcome', 'key_changed', 'keyGeneration', v.key_generation);
  end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    base := coalesce((c->>'baseRevision')::integer, 0);
    select * into cur from public.password_vault_items where user_id = p_user_id and id = (c->>'id')::uuid for update;
    if found then
      if cur.revision <> base and not (cur.deleted and base = 0) then conflicts := conflicts || to_jsonb(c->>'id'); end if;
    elsif base <> 0 then
      conflicts := conflicts || to_jsonb(c->>'id');
    end if;
  end loop;
  if jsonb_array_length(conflicts) > 0 then return jsonb_build_object('outcome', 'conflict', 'conflicts', conflicts); end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    s := nextval('public.password_vault_change_seq');
    if coalesce((c->>'deleted')::boolean, false) then
      update public.password_vault_items
        set deleted = true, iv = null, ciphertext = null, revision = revision + 1, change_seq = s, updated_at = now()
        where user_id = p_user_id and id = (c->>'id')::uuid and not deleted;
    else
      insert into public.password_vault_items(user_id, id, key_generation, iv, ciphertext, deleted, revision, change_seq)
      values (p_user_id, (c->>'id')::uuid, v.key_generation, c->>'iv', c->>'ciphertext', false, 1, s)
      on conflict (user_id, id) do update set iv = excluded.iv, ciphertext = excluded.ciphertext, deleted = false,
        key_generation = excluded.key_generation, revision = public.password_vault_items.revision + 1,
        change_seq = excluded.change_seq, updated_at = now();
    end if;
    ids := ids || (c->>'id')::uuid;
  end loop;
  if (select count(*) from public.password_vault_items where user_id = p_user_id and not deleted) > 5000 then
    raise exception 'password_vault_item_limit';
  end if;
  update public.password_vaults set updated_at = now() where user_id = p_user_id;
  return jsonb_build_object('outcome', 'ok', 'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'revision', i.revision, 'seq', i.change_seq, 'deleted', i.deleted, 'keyGeneration', i.key_generation))
    from public.password_vault_items i where i.user_id = p_user_id and i.id = any(ids)), '[]'::jsonb));
end $$;

-- Re-seals the escrow copy after the operator rotates the escrow key pair.
create or replace function public.persora_password_vault_update_escrow(p_user_id uuid, p_key_generation integer, p_escrow jsonb, p_escrow_key_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.password_vaults set escrow = p_escrow, escrow_key_id = p_escrow_key_id, updated_at = now()
    where user_id = p_user_id and key_generation = p_key_generation;
  if not found then return jsonb_build_object('outcome', 'key_changed'); end if;
  return jsonb_build_object('outcome', 'ok');
end $$;

-- Verifies the emailed OTP (reusing the hashed, expiring, 5-attempt,
-- single-use challenge from 202610210001) and, on success, issues a recovery
-- grant in the same transaction. Only the grant's SHA-256 hash is stored.
create or replace function public.persora_vault_recovery_verify(
  p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamptz, p_max_attempts integer,
  p_grant_hash text, p_grant_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; has_vault boolean;
begin
  select * into r from public.complete_vault_recovery_code(p_user_id, p_email, p_candidate_hash, p_now, p_max_attempts);
  if r.outcome is distinct from 'success' then
    return jsonb_build_object('outcome', coalesce(r.outcome, 'missing'), 'attempts', coalesce(r.attempt_count, 0));
  end if;
  has_vault := exists (select 1 from public.password_vaults where user_id = p_user_id);
  if has_vault then
    insert into public.password_vault_recovery_grants(user_id, grant_hash, expires_at, key_released_at, created_at)
    values (p_user_id, p_grant_hash, p_grant_expires_at, null, p_now)
    on conflict (user_id) do update set grant_hash = excluded.grant_hash, expires_at = excluded.expires_at,
      key_released_at = null, created_at = excluded.created_at;
  end if;
  return jsonb_build_object('outcome', 'success', 'hasVault', has_vault);
end $$;

-- Releases the escrowed vault key exactly once per verified grant.
create or replace function public.persora_vault_recovery_release(p_user_id uuid, p_grant_hash text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare g public.password_vault_recovery_grants%rowtype; v public.password_vaults%rowtype;
begin
  select * into g from public.password_vault_recovery_grants where user_id = p_user_id for update;
  if not found or g.grant_hash <> p_grant_hash then return jsonb_build_object('outcome', 'invalid'); end if;
  if g.expires_at <= p_now then
    delete from public.password_vault_recovery_grants where user_id = p_user_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  if g.key_released_at is not null then return jsonb_build_object('outcome', 'already_released'); end if;
  select * into v from public.password_vaults where user_id = p_user_id;
  if not found then
    delete from public.password_vault_recovery_grants where user_id = p_user_id;
    return jsonb_build_object('outcome', 'missing');
  end if;
  update public.password_vault_recovery_grants set key_released_at = p_now where user_id = p_user_id;
  return jsonb_build_object('outcome', 'ok', 'escrow', v.escrow, 'escrowKeyId', v.escrow_key_id, 'keyGeneration', v.key_generation);
end $$;

-- Completes recovery atomically: new master-password wrap of a NEW vault key,
-- a new escrow copy, and every live item re-encrypted under the new key. The
-- submitted item set must match the stored live items exactly, so no saved
-- password can be dropped. The grant and any OTP challenge are consumed.
create or replace function public.persora_vault_recovery_complete(
  p_user_id uuid, p_grant_hash text, p_now timestamptz, p_expected_generation integer, p_vault jsonb, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v public.password_vaults%rowtype; g public.password_vault_recovery_grants%rowtype; item jsonb; newgen integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'password_vault_invalid_items'; end if;
  select * into v from public.password_vaults where user_id = p_user_id for update;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  select * into g from public.password_vault_recovery_grants where user_id = p_user_id for update;
  if not found or g.grant_hash <> p_grant_hash then return jsonb_build_object('outcome', 'invalid'); end if;
  if g.expires_at <= p_now then
    delete from public.password_vault_recovery_grants where user_id = p_user_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  if g.key_released_at is null then return jsonb_build_object('outcome', 'invalid'); end if;
  if v.key_generation <> p_expected_generation then return jsonb_build_object('outcome', 'key_changed'); end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items)
     or jsonb_array_length(p_items) <> (select count(*) from public.password_vault_items i where i.user_id = p_user_id and not i.deleted)
     or exists (select 1 from jsonb_array_elements(p_items) x where not exists (
       select 1 from public.password_vault_items i where i.user_id = p_user_id and not i.deleted and i.id = (x->>'id')::uuid)) then
    return jsonb_build_object('outcome', 'items_mismatch');
  end if;
  newgen := v.key_generation + 1;
  update public.password_vaults set key_generation = newgen, kdf = p_vault->'kdf', salt = p_vault->>'salt',
    wrapped_dek = p_vault->'wrappedDek', key_check = p_vault->'keyCheck', escrow = p_vault->'escrow',
    escrow_key_id = p_vault->>'escrowKeyId', updated_at = p_now, master_password_changed_at = p_now
    where user_id = p_user_id;
  for item in select value from jsonb_array_elements(p_items) loop
    update public.password_vault_items set iv = item->>'iv', ciphertext = item->>'ciphertext', key_generation = newgen,
      revision = revision + 1, change_seq = nextval('public.password_vault_change_seq'), updated_at = p_now
      where user_id = p_user_id and id = (item->>'id')::uuid;
  end loop;
  delete from public.password_vault_recovery_grants where user_id = p_user_id;
  delete from public.password_vault_recovery_codes where user_id = p_user_id;
  return jsonb_build_object('outcome', 'ok', 'state', public.persora_password_vault_state(p_user_id, 0));
end $$;

revoke all on function public.persora_password_vault_state(uuid, bigint) from public, anon, authenticated;
revoke all on function public.persora_password_vault_setup(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_password_vault_apply(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.persora_password_vault_update_escrow(uuid, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.persora_vault_recovery_verify(uuid, text, text, timestamptz, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.persora_vault_recovery_release(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.persora_vault_recovery_complete(uuid, text, timestamptz, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persora_password_vault_state(uuid, bigint) to service_role;
grant execute on function public.persora_password_vault_setup(uuid, jsonb, jsonb) to service_role;
grant execute on function public.persora_password_vault_apply(uuid, integer, jsonb) to service_role;
grant execute on function public.persora_password_vault_update_escrow(uuid, integer, jsonb, text) to service_role;
grant execute on function public.persora_vault_recovery_verify(uuid, text, text, timestamptz, integer, text, timestamptz) to service_role;
grant execute on function public.persora_vault_recovery_release(uuid, text, timestamptz) to service_role;
grant execute on function public.persora_vault_recovery_complete(uuid, text, timestamptz, integer, jsonb, jsonb) to service_role;
