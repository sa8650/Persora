-- Persora database for Pages-Function custom authentication.
-- This application does NOT use Supabase Auth. Password verification and sessions are
-- handled by cloudflare/api.js; the Supabase secret is used only server-side.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  login_id text unique,
  email text not null unique,
  full_name text not null default 'Persora member',
  password_hash text,
  role text not null default 'user' check (role in ('user', 'admin')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  timezone text not null default 'Asia/Dhaka',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_login_id_format check (login_id is null or login_id ~ '^[0-9]{7}$')
);

-- Safe re-run helpers for the earlier Persora schema. Existing Supabase Auth passwords
-- cannot be migrated into custom password hashes; see the deployment guide before reusing old accounts.
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add column if not exists login_id text;
alter table public.profiles add column if not exists password_hash text;
alter table public.profiles add column if not exists account_status text not null default 'active';
update public.profiles set email = lower(email) where email is not null and email is distinct from lower(email);
create unique index if not exists profiles_email_ci_unique_idx on public.profiles(lower(email)) where email is not null;

-- Assign seven-digit IDs to any legacy profile rows; their old Supabase passwords are not copied.
do $$
declare
  profile_row record;
  candidate text;
begin
  for profile_row in select id from public.profiles where login_id is null loop
    loop
      candidate := (1000000 + floor(random() * 9000000)::integer)::text;
      exit when not exists (select 1 from public.profiles where login_id = candidate);
    end loop;
    update public.profiles set login_id = candidate where id = profile_row.id;
  end loop;
end;
$$;
alter table public.profiles alter column login_id set not null;
create unique index if not exists profiles_login_id_unique_idx on public.profiles(login_id);

-- Detach owner data from auth.users. User IDs remain internal UUIDs; the separate
-- seven-digit login_id is the identifier members use to sign in.
create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  section text not null check (section in (
    'documents', 'academics', 'subscriptions', 'family', 'purchases',
    'accounts', 'memberships', 'study', 'business-card', 'urls'
  )),
  title text not null check (char_length(title) between 1 and 240),
  subtitle text,
  metadata jsonb not null default '{}'::jsonb,
  file_key text,
  file_name text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_type text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_reference_is_complete check (
    (file_key is null and file_name is null) or
    (file_key is not null and file_name is not null)
  )
);
alter table public.vault_items drop constraint if exists vault_items_user_id_fkey;
alter table public.vault_items add constraint vault_items_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.auth_login_attempts (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text not null default '',
  event_type text not null,
  target_user_id uuid,
  target_email text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  setting_key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  storage_gb numeric(12,3) not null check (storage_gb > 0),
  price_per_gb_monthly numeric(12,4) not null default 0 check (price_per_gb_monthly >= 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'pending', 'past_due', 'canceled')),
  storage_limit_gb numeric(12,3) not null check (storage_limit_gb > 0),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'BDT' check (char_length(currency) = 3),
  method text not null check (char_length(method) between 2 and 40),
  reference text not null check (char_length(reference) between 1 and 180),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  admin_note text not null default ''
);

create table if not exists public.document_types (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  name text not null unique check (char_length(name) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_bootstrap_state (
  id boolean primary key default true check (id = true),
  initialized_at timestamptz,
  initialized_by uuid references public.profiles(id) on delete set null
);
insert into public.admin_bootstrap_state (id) values (true) on conflict (id) do nothing;

insert into public.platform_settings (setting_key, value) values
  ('billing', '{"currency":"BDT","manualInstructions":"Contact Persora support for payment instructions.","billingEnabled":false}'::jsonb),
  ('storage', '{"defaultFreeGb":5,"maxUploadMb":25}'::jsonb)
on conflict (setting_key) do nothing;

insert into public.subscription_plans (id, slug, name, description, storage_gb, price_per_gb_monthly, active, sort_order)
values ('00000000-0000-4000-8000-000000000001', 'free', 'Free', 'A private place to get started.', 5, 0, true, 0)
on conflict (slug) do nothing;

insert into public.document_types (id, name, sort_order) values
  ('national-id-nid', 'National ID / NID', 10),
  ('passport', 'Passport', 20),
  ('birth-certificate', 'Birth certificate', 30),
  ('student-id', 'Student ID', 40),
  ('job-id-employee-id', 'Job ID / Employee ID', 50),
  ('driving-licence', 'Driving licence', 60),
  ('tax-id-tin', 'Tax ID / TIN', 70),
  ('visa', 'Visa', 80),
  ('residence-permit', 'Residence permit', 90),
  ('work-permit', 'Work permit', 100),
  ('health-card', 'Health card', 110),
  ('insurance', 'Insurance', 120),
  ('certificate', 'Certificate', 130),
  ('contract', 'Contract', 140),
  ('other', 'Other', 999)
on conflict (id) do nothing;

create index if not exists admin_audit_events_created_at_idx on public.admin_audit_events(created_at desc);
create index if not exists vault_items_owner_section_idx on public.vault_items(user_id, section);
create index if not exists vault_items_owner_updated_idx on public.vault_items(user_id, updated_at desc);
create index if not exists vault_items_metadata_gin_idx on public.vault_items using gin(metadata);
create index if not exists profiles_created_at_idx on public.profiles(created_at desc);
create index if not exists payment_records_status_submitted_idx on public.payment_records(status, submitted_at desc);
create index if not exists payment_records_user_submitted_idx on public.payment_records(user_id, submitted_at desc);
create index if not exists user_sessions_user_expires_idx on public.user_sessions(user_id, expires_at desc);
create index if not exists auth_login_attempts_window_idx on public.auth_login_attempts(window_started_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists vault_items_touch_updated_at on public.vault_items;
create trigger vault_items_touch_updated_at before update on public.vault_items for each row execute function public.touch_updated_at();
drop trigger if exists subscription_plans_touch_updated_at on public.subscription_plans;
create trigger subscription_plans_touch_updated_at before update on public.subscription_plans for each row execute function public.touch_updated_at();
drop trigger if exists user_subscriptions_touch_updated_at on public.user_subscriptions;
create trigger user_subscriptions_touch_updated_at before update on public.user_subscriptions for each row execute function public.touch_updated_at();
drop trigger if exists document_types_touch_updated_at on public.document_types;
create trigger document_types_touch_updated_at before update on public.document_types for each row execute function public.touch_updated_at();

-- Remove the old signup trigger if this schema is being applied over the earlier Persora version.
drop trigger if exists on_auth_user_created_persora on auth.users;
drop function if exists public.handle_new_persora_user();
drop function if exists public.persora_is_admin();
drop function if exists public.persora_is_active_user();

-- Hashing happens inside Postgres with pgcrypto bcrypt (cost 12), not in the Pages CPU budget.
create or replace function public.persora_hash_password(p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_password is null or char_length(p_password) < 12 or octet_length(p_password) > 72 then
    raise exception 'Password must be between 12 characters and 72 bytes.';
  end if;
  return crypt(p_password, gen_salt('bf', 12));
end;
$$;

create or replace function public.persora_verify_password(p_password text, p_hash text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_password is null or p_hash is null or octet_length(p_password) > 72 or p_hash not like '$2%' then
    return false;
  end if;
  return crypt(p_password, p_hash) = p_hash;
end;
$$;

create or replace function public.persora_claim_first_admin(target_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_initialized_at timestamptz;
begin
  select initialized_at into v_initialized_at from public.admin_bootstrap_state where id = true for update;
  if not found or v_initialized_at is not null then return false; end if;
  update public.profiles set role = 'admin' where id = target_user_id and account_status = 'active';
  if not found then return false; end if;
  update public.admin_bootstrap_state set initialized_at = now(), initialized_by = target_user_id where id = true;
  return true;
end;
$$;

create or replace function public.persora_review_payment(payment_id uuid, reviewer_id uuid, decision text, review_note text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_payment public.payment_records%rowtype; v_plan public.subscription_plans%rowtype;
begin
  select * into v_payment from public.payment_records where id = payment_id for update;
  if not found or v_payment.status <> 'pending' then return false; end if;
  if decision not in ('approved', 'rejected') then return false; end if;
  if decision = 'approved' then
    select * into v_plan from public.subscription_plans where id = v_payment.plan_id and active = true;
    if not found then return false; end if;
    insert into public.user_subscriptions as existing_subscription (user_id, plan_id, status, storage_limit_gb, current_period_end)
    values (v_payment.user_id, v_plan.id, 'active', v_plan.storage_gb, now() + interval '1 month')
    on conflict (user_id) do update set
      plan_id = excluded.plan_id,
      status = 'active',
      storage_limit_gb = excluded.storage_limit_gb,
      current_period_end = case when existing_subscription.current_period_end > now()
        then existing_subscription.current_period_end + interval '1 month' else now() + interval '1 month' end;
  end if;
  update public.payment_records set status = decision, reviewed_at = now(), reviewed_by = reviewer_id, admin_note = coalesce(review_note, '') where id = payment_id;
  return true;
end;
$$;

create or replace function public.persora_login_blocked(p_fingerprint text)
returns timestamptz language sql security definer set search_path = public as $$
  select blocked_until from public.auth_login_attempts where fingerprint = p_fingerprint and blocked_until > now();
$$;

drop function if exists public.persora_record_login_attempt(text, boolean);
create or replace function public.persora_record_login_attempt(p_fingerprint text, p_success boolean, p_limit integer default 8)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_row public.auth_login_attempts%rowtype; v_blocked timestamptz; v_now timestamptz := now();
begin
  if random() < 0.01 then delete from public.auth_login_attempts where window_started_at < v_now - interval '1 day'; end if;
  if p_success then
    delete from public.auth_login_attempts where fingerprint = p_fingerprint;
    return null;
  end if;
  insert into public.auth_login_attempts (fingerprint) values (p_fingerprint) on conflict (fingerprint) do nothing;
  select * into v_row from public.auth_login_attempts where fingerprint = p_fingerprint for update;
  if v_row.window_started_at < v_now - interval '15 minutes' then
    update public.auth_login_attempts set attempt_count = 1, window_started_at = v_now, blocked_until = null where fingerprint = p_fingerprint;
  else
    update public.auth_login_attempts
    set attempt_count = v_row.attempt_count + 1,
        blocked_until = case when v_row.attempt_count + 1 >= greatest(1, least(coalesce(p_limit, 8), 100)) then v_now + interval '15 minutes' else v_row.blocked_until end
    where fingerprint = p_fingerprint;
  end if;
  select blocked_until into v_blocked from public.auth_login_attempts where fingerprint = p_fingerprint;
  return v_blocked;
end;
$$;

alter table public.profiles enable row level security;
alter table public.vault_items enable row level security;
alter table public.user_sessions enable row level security;
alter table public.auth_login_attempts enable row level security;
alter table public.admin_audit_events enable row level security;
alter table public.platform_settings enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.payment_records enable row level security;
alter table public.document_types enable row level security;
alter table public.admin_bootstrap_state enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "vault_items_select_owner" on public.vault_items;
drop policy if exists "vault_items_insert_owner" on public.vault_items;
drop policy if exists "vault_items_update_owner" on public.vault_items;
drop policy if exists "vault_items_delete_owner" on public.vault_items;
drop policy if exists "subscription_plans_public_read" on public.subscription_plans;
drop policy if exists "document_types_public_read" on public.document_types;
drop policy if exists "admin_audit_select_admin" on public.admin_audit_events;

-- All application traffic goes through the authenticated Pages Function; direct browser DB access is closed.
revoke all on public.profiles, public.vault_items, public.user_sessions, public.auth_login_attempts,
  public.admin_audit_events, public.platform_settings, public.subscription_plans, public.user_subscriptions,
  public.payment_records, public.document_types, public.admin_bootstrap_state from anon, authenticated;
grant all on public.profiles, public.vault_items, public.user_sessions, public.auth_login_attempts,
  public.admin_audit_events, public.platform_settings, public.subscription_plans, public.user_subscriptions,
  public.payment_records, public.document_types, public.admin_bootstrap_state to service_role;
grant execute on function public.persora_hash_password(text) to service_role;
grant execute on function public.persora_verify_password(text, text) to service_role;
grant execute on function public.persora_claim_first_admin(uuid) to service_role;
grant execute on function public.persora_review_payment(uuid, uuid, text, text) to service_role;
grant execute on function public.persora_login_blocked(text) to service_role;
grant execute on function public.persora_record_login_attempt(text, boolean, integer) to service_role;
revoke all on function public.persora_hash_password(text) from public, anon, authenticated;
revoke all on function public.persora_verify_password(text, text) from public, anon, authenticated;
revoke all on function public.persora_claim_first_admin(uuid) from public, anon, authenticated;
revoke all on function public.persora_review_payment(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.persora_login_blocked(text) from public, anon, authenticated;
revoke all on function public.persora_record_login_attempt(text, boolean, integer) from public, anon, authenticated;
