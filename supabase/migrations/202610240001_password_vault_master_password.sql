-- Persora Password Manager: server-verified master password + plain JSON records.
--
-- Replaces the browser-side Argon2id/AES-256-GCM vault and its escrow-based
-- recovery (202610230009) with a simpler model:
--
--   * password_vaults.master_password_hash: a salted bcrypt verifier (pgcrypto
--     crypt()/gen_salt('bf', 12), the same implementation as Persora sign-in
--     passwords). The master password itself is never stored. It is separate
--     from the Persora sign-in password and may not be the same value.
--   * password_vault_items.data: each saved login as a JSON object. Records are
--     NOT encrypted by the application; they rely on Supabase's provider-managed
--     encryption at rest and on TLS in transit. The master password controls
--     access; it is not an encryption key.
--   * password_vault_sessions: short-lived vault unlock tokens (SHA-256 hash
--     only), bound to the member's Persora session. Every record read or write
--     requires one, so the master password is enforced by the database layer,
--     not just by the UI.
--   * Forgot master password reuses the hashed, expiring, single-use,
--     rate-limited OTP table from 202610210001 and the grant table from
--     202610230009 (hash only, 15 minutes, single use). A reset only replaces
--     the verifier; records are never touched.
--
-- This migration is ADDITIVE so it can be applied while the previous release is
-- still serving traffic: the legacy encrypted columns stay (nullable) until the
-- one-time data migration has converted every record, after which
-- 202610240002_password_vault_drop_legacy_encryption.sql removes them.
--
-- Every table keeps RLS enabled with no policies and no anon/authenticated
-- privileges. Persora does not use Supabase Auth: browsers never receive a
-- database credential and reach this data only through the authenticated Pages
-- Functions (cloudflare/password-vault.js, service role), which pass the
-- member id taken from the server-side session.

create extension if not exists pgcrypto;

-- ── Vaults: master password verifier ────────────────────────────────────────
alter table public.password_vaults add column if not exists master_password_hash text;
alter table public.password_vaults drop constraint if exists password_vaults_master_password_hash_check;
alter table public.password_vaults add constraint password_vaults_master_password_hash_check
  check (master_password_hash is null or master_password_hash ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$');
-- Legacy key material becomes optional (new vaults have none); dropped in 202610240002.
alter table public.password_vaults
  alter column kdf drop not null, alter column salt drop not null, alter column wrapped_dek drop not null,
  alter column key_check drop not null, alter column escrow drop not null, alter column escrow_key_id drop not null;

-- ── Items: plain JSON record per saved login ────────────────────────────────
alter table public.password_vault_items add column if not exists data jsonb;
alter table public.password_vault_items alter column key_generation drop not null;
alter table public.password_vault_items drop constraint if exists password_vault_items_payload;
alter table public.password_vault_items add constraint password_vault_items_payload check (
  (deleted and data is null and iv is null and ciphertext is null)
  or (not deleted and data is not null and iv is null and ciphertext is null)
  -- legacy ciphertext waiting for the one-time migration (removed in 202610240002)
  or (not deleted and data is null and char_length(iv) = 16 and char_length(ciphertext) between 24 and 87384)
);
alter table public.password_vault_items drop constraint if exists password_vault_items_data_shape;
alter table public.password_vault_items add constraint password_vault_items_data_shape
  check (data is null or (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536));

-- While the previous release may still write ciphertext, a legacy write makes
-- the row "pending migration" again instead of leaving a stale JSON copy.
create or replace function public.persora_password_vault_items_legacy_write()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.deleted or new.ciphertext is not null then new.data := null; end if;
  return new;
end $$;
drop trigger if exists password_vault_items_legacy_write on public.password_vault_items;
create trigger password_vault_items_legacy_write before insert or update on public.password_vault_items
  for each row execute function public.persora_password_vault_items_legacy_write();

-- ── Vault unlock sessions ───────────────────────────────────────────────────
create table if not exists public.password_vault_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.user_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null
);
create index if not exists password_vault_sessions_user_idx on public.password_vault_sessions(user_id);
create index if not exists password_vault_sessions_session_idx on public.password_vault_sessions(session_id);

alter table public.password_vaults enable row level security;
alter table public.password_vault_items enable row level security;
alter table public.password_vault_sessions enable row level security;
alter table public.password_vault_recovery_grants enable row level security;
alter table public.password_vault_recovery_codes enable row level security;
revoke all on public.password_vaults, public.password_vault_items, public.password_vault_sessions,
  public.password_vault_recovery_grants, public.password_vault_recovery_codes from public, anon, authenticated;
grant all on public.password_vaults, public.password_vault_items, public.password_vault_sessions,
  public.password_vault_recovery_grants, public.password_vault_recovery_codes to service_role;

-- ── Internal helpers (not callable by any API role) ─────────────────────────
create or replace function public.persora_vault_unlock_fingerprint(p_user_id uuid)
returns text language sql immutable set search_path = pg_catalog, public, extensions as $$
  select encode(digest('persora-password-vault-unlock|' || p_user_id::text, 'sha256'), 'hex');
$$;

-- NULL when acceptable; otherwise a reason code. bcrypt only uses 72 bytes.
create or replace function public.persora_vault_password_problem(p_password text)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select case
    when p_password is null or char_length(p_password) < 10 then 'too_short'
    when octet_length(p_password) > 72 then 'too_long'
    else null end;
$$;

create or replace function public.persora_vault_same_as_login(p_user_id uuid, p_password text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare login_hash text;
begin
  select password_hash into login_hash from public.profiles where id = p_user_id;
  return coalesce(login_hash like '$2%' and crypt(p_password, login_hash) = login_hash, false);
end $$;

-- Live records (p_since = 0) or every change after a cursor, incl. tombstones.
-- Legacy rows still waiting for migration are never returned (they are counted).
create or replace function public.persora_vault_snapshot(p_user_id uuid, p_since bigint)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with changed as (
    select * from public.password_vault_items
    where user_id = p_user_id and change_seq > greatest(coalesce(p_since, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'revision', c.revision, 'seq', c.change_seq, 'deleted', c.deleted, 'data', c.data) order by c.change_seq)
      from changed c
      where case when coalesce(p_since, 0) > 0 then (c.deleted or c.data is not null) else (not c.deleted and c.data is not null) end), '[]'::jsonb),
    'cursor', greatest(coalesce((select max(change_seq) from changed), 0), greatest(coalesce(p_since, 0), 0)),
    'pending', (select count(*) from public.password_vault_items i where i.user_id = p_user_id and not i.deleted and i.data is null));
$$;

-- Issues a vault session for a live Persora session of this member.
create or replace function public.persora_vault_open_session(
  p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamptz, p_idle_seconds integer, p_max_seconds integer
) returns timestamptz language plpgsql security definer set search_path = pg_catalog, public as $$
declare expires timestamptz;
begin
  if not exists (select 1 from public.user_sessions where id = p_session_id and user_id = p_user_id and expires_at > p_now) then
    return null;
  end if;
  delete from public.password_vault_sessions where user_id = p_user_id and expires_at <= p_now;
  expires := least(p_now + make_interval(secs => greatest(p_idle_seconds, 60)), p_now + make_interval(secs => greatest(p_max_seconds, 60)));
  insert into public.password_vault_sessions(token_hash, user_id, session_id, created_at, last_used_at, expires_at, absolute_expires_at)
  values (p_token_hash, p_user_id, p_session_id, p_now, p_now, expires, p_now + make_interval(secs => greatest(p_max_seconds, 60)));
  -- At most 20 concurrent unlocked devices/tabs per member.
  delete from public.password_vault_sessions where token_hash in (
    select token_hash from public.password_vault_sessions where user_id = p_user_id order by created_at desc offset 20);
  return expires;
end $$;

-- Validates and slides a vault session. False = locked (missing, expired,
-- another member's token, another Persora session, or no master password).
create or replace function public.persora_vault_touch_session(
  p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamptz, p_idle_seconds integer
) returns timestamptz language plpgsql security definer set search_path = pg_catalog, public as $$
declare expires timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  update public.password_vault_sessions s
     set last_used_at = p_now,
         expires_at = least(s.absolute_expires_at, p_now + make_interval(secs => greatest(p_idle_seconds, 60)))
   where s.token_hash = p_token_hash and s.user_id = p_user_id and s.session_id = p_session_id and s.expires_at > p_now
     and exists (select 1 from public.password_vaults v where v.user_id = p_user_id and v.master_password_hash is not null)
     and exists (select 1 from public.user_sessions u where u.id = p_session_id and u.user_id = p_user_id and u.expires_at > p_now)
  returning s.expires_at into expires;
  if expires is null then delete from public.password_vault_sessions where token_hash = p_token_hash and expires_at <= p_now; end if;
  return expires;
end $$;

-- ── API functions (service role only) ───────────────────────────────────────
create or replace function public.persora_vault_status(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'hasVault', exists (select 1 from public.password_vaults where user_id = p_user_id and master_password_hash is not null),
    'records', (select count(*) from public.password_vault_items where user_id = p_user_id and not deleted),
    'pending', (select count(*) from public.password_vault_items where user_id = p_user_id and not deleted and data is null));
$$;

-- First visit: store the verifier and unlock this device. Also used by vaults
-- carried over from the encrypted release (row exists, verifier still NULL).
create or replace function public.persora_vault_create_master(
  p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamptz, p_idle_seconds integer, p_max_seconds integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare problem text; expires timestamptz;
begin
  problem := public.persora_vault_password_problem(p_password);
  if problem is not null then return jsonb_build_object('outcome', problem); end if;
  if not exists (select 1 from public.profiles where id = p_user_id and account_status = 'active') then
    return jsonb_build_object('outcome', 'locked');
  end if;
  if public.persora_vault_same_as_login(p_user_id, p_password) then return jsonb_build_object('outcome', 'same_as_login'); end if;
  insert into public.password_vaults(user_id, master_password_hash, master_password_changed_at, created_at, updated_at)
  values (p_user_id, crypt(p_password, gen_salt('bf', 12)), p_now, p_now, p_now)
  on conflict (user_id) do update
    set master_password_hash = excluded.master_password_hash, master_password_changed_at = p_now, updated_at = p_now
    where public.password_vaults.master_password_hash is null;
  if not found then return jsonb_build_object('outcome', 'exists'); end if;
  expires := public.persora_vault_open_session(p_user_id, p_session_id, p_token_hash, p_now, p_idle_seconds, p_max_seconds);
  if expires is null then raise exception 'password_vault_session_invalid'; end if; -- rolls back the new verifier
  return jsonb_build_object('outcome', 'ok', 'expiresAt', expires, 'state', public.persora_vault_snapshot(p_user_id, 0));
end $$;

-- Every unlock on every device: bcrypt check in the database, with the shared
-- sign-in limiter (auth_login_attempts) blocking for 15 minutes after
-- p_max_failures wrong master passwords.
create or replace function public.persora_vault_unlock(
  p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamptz,
  p_idle_seconds integer, p_max_seconds integer, p_max_failures integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare fp text := public.persora_vault_unlock_fingerprint(p_user_id); blocked timestamptz; stored text; expires timestamptz;
begin
  blocked := public.persora_login_blocked(fp);
  if blocked is not null then
    return jsonb_build_object('outcome', 'blocked', 'retryAfterSeconds', greatest(1, ceil(extract(epoch from blocked - now()))::integer));
  end if;
  select master_password_hash into stored from public.password_vaults where user_id = p_user_id;
  if stored is null then return jsonb_build_object('outcome', 'not_set'); end if;
  if p_password is null or octet_length(p_password) > 72 or crypt(p_password, stored) <> stored then
    blocked := public.persora_record_login_attempt(fp, false, p_max_failures);
    if blocked is not null then
      return jsonb_build_object('outcome', 'blocked', 'retryAfterSeconds', greatest(1, ceil(extract(epoch from blocked - now()))::integer));
    end if;
    return jsonb_build_object('outcome', 'wrong_password');
  end if;
  perform public.persora_record_login_attempt(fp, true, p_max_failures);
  expires := public.persora_vault_open_session(p_user_id, p_session_id, p_token_hash, p_now, p_idle_seconds, p_max_seconds);
  if expires is null then return jsonb_build_object('outcome', 'locked'); end if;
  return jsonb_build_object('outcome', 'ok', 'expiresAt', expires, 'state', public.persora_vault_snapshot(p_user_id, 0));
end $$;

create or replace function public.persora_vault_lock(p_user_id uuid, p_token_hash text)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  with gone as (delete from public.password_vault_sessions where user_id = p_user_id and token_hash = p_token_hash returning 1)
  select jsonb_build_object('outcome', 'ok', 'locked', (select count(*) from gone));
$$;

create or replace function public.persora_vault_items(
  p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamptz, p_idle_seconds integer, p_since bigint
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare expires timestamptz;
begin
  expires := public.persora_vault_touch_session(p_user_id, p_session_id, p_token_hash, p_now, p_idle_seconds);
  if expires is null then return jsonb_build_object('outcome', 'locked'); end if;
  return jsonb_build_object('outcome', 'ok', 'expiresAt', expires) || public.persora_vault_snapshot(p_user_id, p_since);
end $$;

-- Batch of upserts/deletions with optimistic concurrency: each change carries
-- the revision it was based on (0 = new). Any conflict rejects the whole batch
-- so a device never silently overwrites another device's newer edit.
create or replace function public.persora_vault_apply(
  p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamptz, p_idle_seconds integer, p_changes jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v public.password_vaults%rowtype; c jsonb; cur public.password_vault_items%rowtype; base integer;
  conflicts jsonb := '[]'::jsonb; ids uuid[] := '{}'; s bigint; expires timestamptz; has_vault boolean;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'password_vault_invalid_items'; end if;
  if jsonb_array_length(p_changes) > 1000 then raise exception 'password_vault_invalid_items'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_changes) x) <> jsonb_array_length(p_changes) then
    raise exception 'password_vault_invalid_items';
  end if;
  -- Lock the member's vault row first: per member, change_seq order = commit order.
  select * into v from public.password_vaults where user_id = p_user_id for update;
  has_vault := found;
  expires := public.persora_vault_touch_session(p_user_id, p_session_id, p_token_hash, p_now, p_idle_seconds);
  if not has_vault or expires is null then return jsonb_build_object('outcome', 'locked'); end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    base := coalesce((c->>'baseRevision')::integer, 0);
    select * into cur from public.password_vault_items where user_id = p_user_id and id = (c->>'id')::uuid for update;
    if found then
      if (not cur.deleted and cur.data is null) or (cur.revision <> base and not (cur.deleted and base = 0)) then
        conflicts := conflicts || to_jsonb(c->>'id');
      end if;
    elsif base <> 0 then
      conflicts := conflicts || to_jsonb(c->>'id');
    end if;
    if not coalesce((c->>'deleted')::boolean, false) and jsonb_typeof(c->'data') is distinct from 'object' then
      raise exception 'password_vault_invalid_items';
    end if;
  end loop;
  if jsonb_array_length(conflicts) > 0 then return jsonb_build_object('outcome', 'conflict', 'conflicts', conflicts); end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    s := nextval('public.password_vault_change_seq');
    if coalesce((c->>'deleted')::boolean, false) then
      update public.password_vault_items
         set deleted = true, data = null, revision = revision + 1, change_seq = s, updated_at = p_now
       where user_id = p_user_id and id = (c->>'id')::uuid and not deleted;
    else
      insert into public.password_vault_items(user_id, id, data, deleted, revision, change_seq, created_at, updated_at)
      values (p_user_id, (c->>'id')::uuid, c->'data', false, 1, s, p_now, p_now)
      on conflict (user_id, id) do update set data = excluded.data, deleted = false,
        revision = public.password_vault_items.revision + 1, change_seq = excluded.change_seq, updated_at = p_now;
    end if;
    ids := ids || (c->>'id')::uuid;
  end loop;
  if (select count(*) from public.password_vault_items where user_id = p_user_id and not deleted) > 5000 then
    raise exception 'password_vault_item_limit';
  end if;
  update public.password_vaults set updated_at = p_now where user_id = p_user_id;
  return jsonb_build_object('outcome', 'ok', 'expiresAt', expires, 'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'revision', i.revision, 'seq', i.change_seq, 'deleted', i.deleted))
    from public.password_vault_items i where i.user_id = p_user_id and i.id = any(ids)), '[]'::jsonb));
end $$;

-- Forgot master password, step 1: verify the emailed OTP (hashed, expiring,
-- attempt-limited, deleted on success = single use) and issue a 15-minute
-- reset grant in the same transaction. Only the grant's SHA-256 is stored.
create or replace function public.persora_vault_reset_verify(
  p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamptz, p_max_attempts integer,
  p_grant_hash text, p_grant_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  select * into r from public.complete_vault_recovery_code(p_user_id, p_email, p_candidate_hash, p_now, p_max_attempts);
  if r.outcome is distinct from 'success' then
    return jsonb_build_object('outcome', coalesce(r.outcome, 'missing'), 'attempts', coalesce(r.attempt_count, 0));
  end if;
  insert into public.password_vault_recovery_grants(user_id, grant_hash, expires_at, created_at)
  values (p_user_id, p_grant_hash, p_grant_expires_at, p_now)
  on conflict (user_id) do update set grant_hash = excluded.grant_hash, expires_at = excluded.expires_at, created_at = excluded.created_at;
  return jsonb_build_object('outcome', 'success');
end $$;

-- Step 2: consume the grant and replace ONLY the verifier. Saved records are
-- not read, rewritten or deleted. Every existing vault session (all devices)
-- is revoked, the unlock limiter is cleared, and this device is unlocked.
create or replace function public.persora_vault_reset_complete(
  p_user_id uuid, p_session_id uuid, p_grant_hash text, p_password text, p_token_hash text, p_now timestamptz,
  p_idle_seconds integer, p_max_seconds integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare g public.password_vault_recovery_grants%rowtype; problem text; expires timestamptz;
begin
  select * into g from public.password_vault_recovery_grants where user_id = p_user_id for update;
  if not found or g.grant_hash is distinct from p_grant_hash then return jsonb_build_object('outcome', 'invalid'); end if;
  if g.expires_at <= p_now then
    delete from public.password_vault_recovery_grants where user_id = p_user_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  problem := public.persora_vault_password_problem(p_password);
  if problem is not null then return jsonb_build_object('outcome', problem); end if; -- grant kept: fix and retry
  if public.persora_vault_same_as_login(p_user_id, p_password) then return jsonb_build_object('outcome', 'same_as_login'); end if;
  delete from public.password_vault_recovery_grants where user_id = p_user_id;
  insert into public.password_vaults(user_id, master_password_hash, master_password_changed_at, created_at, updated_at)
  values (p_user_id, crypt(p_password, gen_salt('bf', 12)), p_now, p_now, p_now)
  on conflict (user_id) do update set master_password_hash = excluded.master_password_hash, master_password_changed_at = p_now, updated_at = p_now;
  delete from public.password_vault_sessions where user_id = p_user_id;
  delete from public.auth_login_attempts where fingerprint = public.persora_vault_unlock_fingerprint(p_user_id);
  delete from public.password_vault_recovery_codes where user_id = p_user_id;
  expires := public.persora_vault_open_session(p_user_id, p_session_id, p_token_hash, p_now, p_idle_seconds, p_max_seconds);
  if expires is null then raise exception 'password_vault_session_invalid'; end if;
  return jsonb_build_object('outcome', 'ok', 'expiresAt', expires, 'state', public.persora_vault_snapshot(p_user_id, 0));
end $$;

-- ── One-time migration support (dropped in 202610240002) ────────────────────
-- Lists legacy encrypted records still to convert, with what the server needs
-- to open them: the escrowed vault key and the key-check value.
create or replace function public.persora_vault_legacy_pending(p_user_id uuid, p_limit integer default 25, p_after uuid default null)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with targets as (
    select v.* from public.password_vaults v
    where (p_user_id is null or v.user_id = p_user_id) and (p_after is null or v.user_id > p_after)
      and exists (select 1 from public.password_vault_items i where i.user_id = v.user_id and not i.deleted and i.data is null)
    order by v.user_id limit greatest(1, least(coalesce(p_limit, 25), 500))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', t.user_id, 'keyGeneration', t.key_generation, 'escrow', t.escrow, 'escrowKeyId', t.escrow_key_id, 'keyCheck', t.key_check,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'revision', i.revision, 'keyGeneration', i.key_generation, 'iv', i.iv, 'ciphertext', i.ciphertext)), '[]'::jsonb)
              from public.password_vault_items i where i.user_id = t.user_id and not i.deleted and i.data is null))), '[]'::jsonb)
  from targets t;
$$;

-- Stores decrypted records. Only rows that are still the same legacy revision
-- are converted; anything changed meanwhile stays pending for the next run.
create or replace function public.persora_vault_legacy_store(p_user_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare x jsonb; n integer := 0; k integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'password_vault_invalid_items'; end if;
  perform 1 from public.password_vaults where user_id = p_user_id for update;
  if not found then return jsonb_build_object('stored', 0); end if;
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x->'data') is distinct from 'object' then raise exception 'password_vault_invalid_items'; end if;
    update public.password_vault_items
       set data = x->'data', iv = null, ciphertext = null, key_generation = null,
           change_seq = nextval('public.password_vault_change_seq'), updated_at = now()
     where user_id = p_user_id and id = (x->>'id')::uuid and revision = (x->>'revision')::integer
       and not deleted and data is null and ciphertext is not null;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return jsonb_build_object('stored', n);
end $$;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke all on function public.persora_password_vault_items_legacy_write() from public, anon, authenticated, service_role;
revoke all on function public.persora_vault_unlock_fingerprint(uuid) from public, anon, authenticated, service_role;
revoke all on function public.persora_vault_password_problem(text) from public, anon, authenticated, service_role;
revoke all on function public.persora_vault_same_as_login(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.persora_vault_snapshot(uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.persora_vault_open_session(uuid, uuid, text, timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.persora_vault_touch_session(uuid, uuid, text, timestamptz, integer) from public, anon, authenticated, service_role;

revoke all on function public.persora_vault_status(uuid) from public, anon, authenticated;
revoke all on function public.persora_vault_create_master(uuid, uuid, text, text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.persora_vault_unlock(uuid, uuid, text, text, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.persora_vault_lock(uuid, text) from public, anon, authenticated;
revoke all on function public.persora_vault_items(uuid, uuid, text, timestamptz, integer, bigint) from public, anon, authenticated;
revoke all on function public.persora_vault_apply(uuid, uuid, text, timestamptz, integer, jsonb) from public, anon, authenticated;
revoke all on function public.persora_vault_reset_verify(uuid, text, text, timestamptz, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.persora_vault_reset_complete(uuid, uuid, text, text, text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.persora_vault_legacy_pending(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.persora_vault_legacy_store(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persora_vault_status(uuid) to service_role;
grant execute on function public.persora_vault_create_master(uuid, uuid, text, text, timestamptz, integer, integer) to service_role;
grant execute on function public.persora_vault_unlock(uuid, uuid, text, text, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.persora_vault_lock(uuid, text) to service_role;
grant execute on function public.persora_vault_items(uuid, uuid, text, timestamptz, integer, bigint) to service_role;
grant execute on function public.persora_vault_apply(uuid, uuid, text, timestamptz, integer, jsonb) to service_role;
grant execute on function public.persora_vault_reset_verify(uuid, text, text, timestamptz, integer, text, timestamptz) to service_role;
grant execute on function public.persora_vault_reset_complete(uuid, uuid, text, text, text, timestamptz, integer, integer) to service_role;
grant execute on function public.persora_vault_legacy_pending(uuid, integer, uuid) to service_role;
grant execute on function public.persora_vault_legacy_store(uuid, jsonb) to service_role;
