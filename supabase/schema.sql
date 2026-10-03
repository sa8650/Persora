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
    'accounts', 'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes'
  )),
  title text not null check (char_length(title) between 1 and 240),
  subtitle text,
  metadata jsonb not null default '{}'::jsonb,
  file_key text,
  file_name text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_type text,
  favorite boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_reference_is_complete check (
    (file_key is null and file_name is null) or
    (file_key is not null and file_name is not null)
  )
);
alter table public.vault_items add column if not exists pinned boolean not null default false;
alter table public.vault_items drop constraint if exists vault_items_user_id_fkey;
alter table public.vault_items add constraint vault_items_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

-- Encrypted private Life Timeline. See the incremental migration for the matching upgrade path.
create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('automatic', 'manual')),
  event_date date not null,
  event_key text,
  record_id uuid references public.vault_items(id) on delete cascade,
  encrypted_payload text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timeline_events_owner_key_unique unique (user_id, event_key),
  constraint timeline_events_manual_has_no_key check (event_type <> 'manual' or event_key is null),
  constraint timeline_events_auto_requires_key check (event_type <> 'automatic' or (event_key is not null and record_id is not null)),
  constraint timeline_events_id_owner_unique unique (id, user_id)
);
create index if not exists timeline_events_owner_date_idx on public.timeline_events(user_id, event_date desc, created_at desc);
create index if not exists timeline_events_record_idx on public.timeline_events(record_id) where record_id is not null;
create table if not exists public.timeline_event_links (
  event_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  record_id uuid not null references public.vault_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, record_id),
  constraint timeline_event_links_owner_event_fk foreign key (event_id, owner_id) references public.timeline_events(id, user_id) on delete cascade
);
create index if not exists timeline_event_links_record_idx on public.timeline_event_links(record_id);
alter table public.timeline_events enable row level security;
alter table public.timeline_event_links enable row level security;
revoke all on public.timeline_events, public.timeline_event_links from anon, authenticated;
grant all on public.timeline_events, public.timeline_event_links to service_role;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  phone_numbers jsonb not null default '[]'::jsonb,
  email text,
  company text,
  job_title text,
  address text,
  birthday date,
  notes text,
  category text not null default 'Other' check (category in ('Family','Friends','Work','Clients','Suppliers','Students','Other')),
  photo_key text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_owner_name_idx on public.contacts(user_id, lower(full_name));
create index if not exists contacts_owner_updated_idx on public.contacts(user_id, updated_at desc);

create table if not exists public.business_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id text unique check (card_id is null or card_id ~ '^[A-F0-9]{32}$'),
  is_public boolean not null default false,
  full_name text not null check (char_length(full_name) between 1 and 160),
  job_title text,
  company text,
  phone_numbers jsonb not null default '[]'::jsonb,
  email text,
  websites jsonb not null default '[]'::jsonb,
  social_links jsonb not null default '[]'::jsonb,
  address text,
  bio text,
  custom_links jsonb not null default '[]'::jsonb,
  profile_photo_key text,
  business_logo_key text,
  card_style text not null default 'garden' check (card_style in ('garden', 'minimal', 'midnight', 'terracotta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_cards_public_has_id check (not is_public or card_id is not null)
);
create index if not exists business_cards_owner_updated_idx on public.business_cards(user_id, updated_at desc);
create index if not exists business_cards_public_idx on public.business_cards(card_id) where is_public = true;

create table if not exists public.business_card_reports (
  id uuid primary key default gen_random_uuid(),
  business_card_id uuid not null references public.business_cards(id) on delete cascade,
  reporter_hash text not null,
  reason text not null check (reason in ('Spam or misleading','Inappropriate content','Impersonation','Other')),
  details text,
  created_at timestamptz not null default now(),
  constraint business_card_reports_once_per_reporter unique (business_card_id, reporter_hash)
);
create index if not exists business_card_reports_created_idx on public.business_card_reports(created_at desc);

create table if not exists public.vault_shares (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.vault_items(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null default 'view' check (permission in ('view', 'comment', 'edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vault_shares_not_self check (owner_id <> recipient_id),
  constraint vault_shares_item_recipient_unique unique (item_id, recipient_id)
);

create table if not exists public.record_shares (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('contact', 'business_card')),
  resource_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint record_shares_not_self check (owner_id <> recipient_id),
  constraint record_shares_unique unique (resource_type, resource_id, recipient_id)
);
create index if not exists record_shares_owner_created_idx on public.record_shares(owner_id, created_at desc);
create index if not exists record_shares_recipient_created_idx on public.record_shares(recipient_id, created_at desc);

create table if not exists public.vault_share_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.vault_shares(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default 'Persora member',
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.share_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default 'Persora user',
  kind text not null check (kind in ('shared', 'permission_changed', 'unshared')),
  item_title text not null default 'Shared document',
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

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
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly')),
  duration_count integer not null default 1 check (duration_count between 1 and 120),
  term_months integer not null default 1 check (term_months between 1 and 120),
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
-- Keep the section check current for databases created by an earlier schema version.
alter table public.vault_items drop constraint if exists vault_items_section_check;
alter table public.vault_items add constraint vault_items_section_check check (section in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases',
  'accounts', 'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes', 'personal-finance'
));

create index if not exists vault_shares_owner_created_idx on public.vault_shares(owner_id, created_at desc);
create index if not exists vault_shares_recipient_created_idx on public.vault_shares(recipient_id, created_at desc);
create index if not exists vault_share_comments_share_created_idx on public.vault_share_comments(share_id, created_at asc);
create index if not exists share_notifications_recipient_created_idx on public.share_notifications(recipient_id, created_at desc);
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
drop trigger if exists timeline_events_touch_updated_at on public.timeline_events;
create trigger timeline_events_touch_updated_at before update on public.timeline_events for each row execute function public.touch_updated_at();
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
    values (v_payment.user_id, v_plan.id, 'active', v_plan.storage_gb, now() + make_interval(months => greatest(coalesce(v_payment.term_months, 1), 1)))
    on conflict (user_id) do update set
      plan_id = excluded.plan_id,
      status = 'active',
      storage_limit_gb = excluded.storage_limit_gb,
      current_period_end = case when existing_subscription.current_period_end > now()
        then existing_subscription.current_period_end + make_interval(months => greatest(coalesce(v_payment.term_months, 1), 1))
        else now() + make_interval(months => greatest(coalesce(v_payment.term_months, 1), 1)) end;
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

-- Private, owner-scoped medical records and references to existing Persora records.
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  record_type text not null check (record_type in ('Prescription','Medical Report','Lab Test','Imaging / Scan','Doctor Visit','Hospital Record','Vaccination','Medical Certificate','Discharge Summary','Other')),
  record_date date not null,
  provider text not null default '', hospital text not null default '', specialty text not null default '', notes text not null default '',
  diagnosis text not null default '', test_name text not null default '', test_result text not null default '', medication_notes text not null default '',
  follow_up_date date, related_reminder_id uuid references public.vault_items(id) on delete set null,
  file_key text, file_name text, file_size bigint check (file_size is null or file_size >= 0), file_type text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint medical_records_file_reference_complete check (
    (file_key is null and file_name is null and file_size is null and file_type is null) or
    (file_key is not null and file_name is not null and file_size is not null and file_type is not null)
  ),
  constraint medical_records_id_owner_unique unique (id, user_id)
);
create index if not exists medical_records_owner_date_idx on public.medical_records(user_id, record_date desc, updated_at desc);
create index if not exists medical_records_owner_type_idx on public.medical_records(user_id, record_type, record_date desc);

-- Short-lived, account-scoped OCR/extraction cache. The original upload is never copied here.
create table if not exists public.smart_scan_cache (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (owner_id, content_sha256)
);
create index if not exists smart_scan_cache_expiry_idx on public.smart_scan_cache(expires_at);
alter table public.smart_scan_cache enable row level security;
revoke all on public.smart_scan_cache from anon, authenticated;
grant all on public.smart_scan_cache to service_role;

create table if not exists public.medical_record_links (
  medical_record_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  record_type text not null check (record_type in ('contact','vault_item')),
  record_id uuid not null,
  link_kind text not null default 'related' check (link_kind in ('related','reminder')),
  created_at timestamptz not null default now(),
  primary key (medical_record_id, record_type, record_id, link_kind),
  constraint medical_record_links_owner_record_fk foreign key (medical_record_id, owner_id) references public.medical_records(id, user_id) on delete cascade
);
create index if not exists medical_record_links_target_idx on public.medical_record_links(owner_id, record_type, record_id);
alter table public.medical_records enable row level security;
alter table public.medical_record_links enable row level security;
revoke all on public.medical_records, public.medical_record_links from anon, authenticated;
grant all on public.medical_records, public.medical_record_links to service_role;

alter table public.profiles enable row level security;
alter table public.vault_items enable row level security;
alter table public.contacts enable row level security;
alter table public.business_cards enable row level security;
alter table public.business_card_reports enable row level security;
alter table public.vault_shares enable row level security;
alter table public.record_shares enable row level security;
alter table public.vault_share_comments enable row level security;
alter table public.share_notifications enable row level security;
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
revoke all on public.profiles, public.vault_items, public.contacts, public.business_cards, public.business_card_reports, public.user_sessions, public.auth_login_attempts,
  public.vault_shares, public.record_shares, public.vault_share_comments, public.share_notifications,
  public.admin_audit_events, public.platform_settings, public.subscription_plans, public.user_subscriptions,
  public.payment_records, public.document_types, public.admin_bootstrap_state, public.timeline_events, public.timeline_event_links from anon, authenticated;
grant all on public.profiles, public.vault_items, public.contacts, public.business_cards, public.business_card_reports, public.user_sessions, public.auth_login_attempts,
  public.vault_shares, public.record_shares, public.vault_share_comments, public.share_notifications,
  public.admin_audit_events, public.platform_settings, public.subscription_plans, public.user_subscriptions,
  public.payment_records, public.document_types, public.admin_bootstrap_state, public.timeline_events, public.timeline_event_links to service_role;
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
