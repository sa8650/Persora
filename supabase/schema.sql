-- =============================================================================
-- Persora — Standalone Fresh-Database Schema (Supabase / PostgreSQL)
-- =============================================================================
-- Complete, idempotent schema for a fresh Persora deployment.
-- Every application table enables Row Level Security and revokes direct client
-- access from public/anon/authenticated; all mutations and scoped reads execute
-- through the Persora Worker using service_role and security-definer RPCs.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Sequences
-- -----------------------------------------------------------------------------
create sequence if not exists public.password_vault_change_seq;
revoke all on sequence public.password_vault_change_seq from public, anon, authenticated;
grant usage, select on sequence public.password_vault_change_seq to service_role;

-- -----------------------------------------------------------------------------
-- Tables, Constraints & Row-Level Security
-- -----------------------------------------------------------------------------
create table if not exists public.admin_audit_events (
  id uuid not null default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text not null default ''::text,
  event_type text not null,
  target_user_id uuid,
  target_email text not null default ''::text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint admin_audit_events_pkey PRIMARY KEY (id)
);
alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from public, anon, authenticated;
grant all on public.admin_audit_events to service_role;

create table if not exists public.profiles (
  id uuid not null default gen_random_uuid(),
  login_id text not null,
  email text not null,
  full_name text not null default 'Persora member'::text,
  password_hash text,
  role text not null default 'user'::text,
  account_status text not null default 'active'::text,
  timezone text not null default 'Asia/Dhaka'::text,
  avatar_url text,
  email_verified_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint profiles_pkey PRIMARY KEY (id),
  constraint profiles_email_key UNIQUE (email),
  constraint profiles_login_id_key UNIQUE (login_id),
  constraint profiles_account_status_check CHECK (account_status = ANY (ARRAY['active'::text, 'suspended'::text])),
  constraint profiles_login_id_format CHECK (login_id IS NULL OR login_id ~ '^[0-9]{7}$'::text),
  constraint profiles_role_check CHECK (role = ANY (ARRAY['user'::text, 'admin'::text]))
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant all on public.profiles to service_role;

create table if not exists public.admin_bootstrap_state (
  id boolean not null default true,
  initialized_at timestamp with time zone,
  initialized_by uuid,
  constraint admin_bootstrap_state_pkey PRIMARY KEY (id),
  constraint admin_bootstrap_state_initialized_by_fkey FOREIGN KEY (initialized_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint admin_bootstrap_state_id_check CHECK (id = true)
);
alter table public.admin_bootstrap_state enable row level security;
revoke all on public.admin_bootstrap_state from public, anon, authenticated;
grant all on public.admin_bootstrap_state to service_role;

create table if not exists public.auth_login_attempts (
  fingerprint text not null,
  attempt_count integer not null default 0,
  window_started_at timestamp with time zone not null default now(),
  blocked_until timestamp with time zone,
  constraint auth_login_attempts_pkey PRIMARY KEY (fingerprint),
  constraint auth_login_attempts_fingerprint_check CHECK (fingerprint ~ '^[0-9a-f]{64}$'::text)
);
alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from public, anon, authenticated;
grant all on public.auth_login_attempts to service_role;

create table if not exists public.vault_folders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  scope text not null,
  name text not null,
  color text not null default 'blue'::text,
  pinned boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint vault_folders_pkey PRIMARY KEY (id),
  constraint vault_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint vault_folders_color_check CHECK (color = ANY (ARRAY['blue'::text, 'sky'::text, 'teal'::text, 'violet'::text, 'amber'::text, 'rose'::text, 'slate'::text, 'mint'::text])),
  constraint vault_folders_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 64),
  constraint vault_folders_scope_check CHECK (scope = ANY (ARRAY['documents'::text, 'academics'::text, 'subscriptions'::text, 'family'::text, 'purchases'::text, 'accounts'::text, 'memberships'::text, 'wallet-cards'::text, 'study'::text, 'business-card'::text, 'urls'::text, 'notes'::text, 'contacts'::text, 'business-cards'::text, 'medical-records'::text, 'password-manager'::text, 'photo-studio'::text, 'pdf-studio'::text]))
);
alter table public.vault_folders enable row level security;
revoke all on public.vault_folders from public, anon, authenticated;
grant all on public.vault_folders to service_role;

create table if not exists public.business_cards (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  card_id text,
  is_public boolean not null default false,
  full_name text not null,
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
  card_style text not null default 'garden'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint business_cards_pkey PRIMARY KEY (id),
  constraint business_cards_card_id_key UNIQUE (card_id),
  constraint business_cards_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.vault_folders(id) ON DELETE SET NULL,
  constraint business_cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint business_cards_card_id_check CHECK (card_id IS NULL OR card_id ~ '^[A-F0-9]{32}$'::text),
  constraint business_cards_card_style_check CHECK (card_style = ANY (ARRAY['garden'::text, 'minimal'::text, 'midnight'::text, 'terracotta'::text])),
  constraint business_cards_full_name_check CHECK (char_length(full_name) >= 1 AND char_length(full_name) <= 160),
  constraint business_cards_public_has_id CHECK (NOT is_public OR card_id IS NOT NULL)
);
alter table public.business_cards enable row level security;
revoke all on public.business_cards from public, anon, authenticated;
grant all on public.business_cards to service_role;

create table if not exists public.business_card_reports (
  id uuid not null default gen_random_uuid(),
  business_card_id uuid not null,
  reporter_hash text not null,
  reason text not null,
  details text,
  created_at timestamp with time zone not null default now(),
  constraint business_card_reports_pkey PRIMARY KEY (id),
  constraint business_card_reports_once_per_reporter UNIQUE (business_card_id, reporter_hash),
  constraint business_card_reports_business_card_id_fkey FOREIGN KEY (business_card_id) REFERENCES public.business_cards(id) ON DELETE CASCADE,
  constraint business_card_reports_reason_check CHECK (reason = ANY (ARRAY['Spam or misleading'::text, 'Inappropriate content'::text, 'Impersonation'::text, 'Other'::text]))
);
alter table public.business_card_reports enable row level security;
revoke all on public.business_card_reports from public, anon, authenticated;
grant all on public.business_card_reports to service_role;

create table if not exists public.calendar_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  series_id uuid,
  original_start_at timestamp with time zone,
  original_start_date date,
  status text not null default 'confirmed'::text,
  title text not null,
  description text not null default ''::text,
  location text not null default ''::text,
  category text,
  all_day boolean not null default false,
  time_zone text not null,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  start_date date,
  end_date date,
  recurrence_freq text,
  recurrence_interval smallint not null default 1,
  recurrence_until date,
  recurrence_count integer,
  reminder_minutes integer,
  reminder_email boolean not null default false,
  source text not null default 'persora'::text,
  external_id text,
  revision integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  item_type text not null default 'event'::text,
  completed_at timestamp with time zone,
  constraint calendar_events_pkey PRIMARY KEY (id),
  constraint calendar_events_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  constraint calendar_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint calendar_events_category_check CHECK (category IS NULL OR (category = ANY (ARRAY['personal'::text, 'work'::text, 'family'::text, 'health'::text, 'travel'::text, 'social'::text, 'other'::text]))),
  constraint calendar_events_completion CHECK (completed_at IS NULL OR item_type = 'task'::text),
  constraint calendar_events_description_check CHECK (char_length(description) <= 2000),
  constraint calendar_events_exception CHECK (series_id IS NULL AND original_start_at IS NULL AND original_start_date IS NULL AND status = 'confirmed'::text OR series_id IS NOT NULL AND recurrence_freq IS NULL AND num_nonnulls(original_start_at, original_start_date) = 1),
  constraint calendar_events_external_id_check CHECK (external_id IS NULL OR char_length(external_id) <= 1024),
  constraint calendar_events_item_type CHECK ((item_type = ANY (ARRAY['event'::text, 'task'::text, 'appointment'::text])) AND (item_type = 'event'::text OR recurrence_freq IS NULL) AND (item_type <> 'appointment'::text OR NOT all_day)),
  constraint calendar_events_location_check CHECK (char_length(location) <= 300),
  constraint calendar_events_recurrence_count_check CHECK (recurrence_count IS NULL OR recurrence_count >= 1 AND recurrence_count <= 999),
  constraint calendar_events_recurrence_end CHECK ((recurrence_until IS NULL OR recurrence_count IS NULL) AND (recurrence_freq IS NOT NULL OR recurrence_until IS NULL AND recurrence_count IS NULL AND recurrence_interval = 1) AND (recurrence_until IS NULL OR recurrence_until >= COALESCE(start_date, (start_at AT TIME ZONE 'UTC'::text)::date - 1))),
  constraint calendar_events_recurrence_freq_check CHECK (recurrence_freq IS NULL OR (recurrence_freq = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
  constraint calendar_events_recurrence_interval_check CHECK (recurrence_interval >= 1 AND recurrence_interval <= 99),
  constraint calendar_events_reminder_email CHECK (reminder_email = false OR reminder_minutes IS NOT NULL),
  constraint calendar_events_reminder_minutes_check CHECK (reminder_minutes IS NULL OR (reminder_minutes = ANY (ARRAY[5, 15, 30, 60, 1440]))),
  constraint calendar_events_revision_check CHECK (revision >= 1),
  constraint calendar_events_source_check CHECK (source = 'persora'::text),
  constraint calendar_events_status_check CHECK (status = ANY (ARRAY['confirmed'::text, 'cancelled'::text])),
  constraint calendar_events_time_zone_check CHECK (char_length(time_zone) >= 1 AND char_length(time_zone) <= 64 AND time_zone ~ '^[A-Za-z0-9_+/-]+$'::text),
  constraint calendar_events_timing CHECK (all_day AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND end_date > start_date AND (end_date - start_date) <= 366 OR NOT all_day AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL AND end_at > start_at AND (end_at - start_at) <= '31 days'::interval),
  constraint calendar_events_title_check CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 200)
);
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public, anon, authenticated;
grant all on public.calendar_events to service_role;

create table if not exists public.calendar_preferences (
  user_id uuid not null,
  filters jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint calendar_preferences_pkey PRIMARY KEY (user_id),
  constraint calendar_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint calendar_preferences_filters_check CHECK (jsonb_typeof(filters) = 'object'::text AND pg_column_size(filters) <= 4096)
);
alter table public.calendar_preferences enable row level security;
revoke all on public.calendar_preferences from public, anon, authenticated;
grant all on public.calendar_preferences to service_role;

create table if not exists public.calendar_reminders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null,
  root_id uuid not null,
  occurrence_key text not null,
  occurrence_start timestamp with time zone,
  occurrence_date date,
  all_day boolean not null default false,
  remind_at timestamp with time zone not null,
  minutes_before integer not null,
  title text not null,
  location text not null default ''::text,
  email_requested boolean not null default false,
  status text not null default 'scheduled'::text,
  email_status text not null default 'not_requested'::text,
  email_note text,
  attempts integer not null default 0,
  claimed_at timestamp with time zone,
  processed_at timestamp with time zone,
  read_at timestamp with time zone,
  dedupe_key text not null,
  created_at timestamp with time zone not null default now(),
  constraint calendar_reminders_pkey PRIMARY KEY (id),
  constraint calendar_reminders_dedupe_key_key UNIQUE (dedupe_key),
  constraint calendar_reminders_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  constraint calendar_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint calendar_reminders_dedupe_key_check CHECK (char_length(dedupe_key) <= 160),
  constraint calendar_reminders_email_note_check CHECK (email_note IS NULL OR char_length(email_note) <= 200),
  constraint calendar_reminders_email_status_check CHECK (email_status = ANY (ARRAY['not_requested'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
  constraint calendar_reminders_location_check CHECK (char_length(location) <= 300),
  constraint calendar_reminders_minutes_before_check CHECK (minutes_before = ANY (ARRAY[5, 15, 30, 60, 1440])),
  constraint calendar_reminders_occurrence CHECK (num_nonnulls(occurrence_start, occurrence_date) = 1),
  constraint calendar_reminders_occurrence_key_check CHECK (char_length(occurrence_key) >= 10 AND char_length(occurrence_key) <= 40),
  constraint calendar_reminders_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'processing'::text, 'sent'::text, 'cancelled'::text])),
  constraint calendar_reminders_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 200)
);
alter table public.calendar_reminders enable row level security;
revoke all on public.calendar_reminders from public, anon, authenticated;
grant all on public.calendar_reminders to service_role;

create table if not exists public.contacts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  full_name text not null,
  phone_numbers jsonb not null default '[]'::jsonb,
  email text,
  company text,
  job_title text,
  address text,
  birthday date,
  notes text,
  category text not null default 'Other'::text,
  photo_key text,
  favorite boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint contacts_pkey PRIMARY KEY (id),
  constraint contacts_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.vault_folders(id) ON DELETE SET NULL,
  constraint contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint contacts_category_check CHECK (category = ANY (ARRAY['Family'::text, 'Friends'::text, 'Work'::text, 'Clients'::text, 'Suppliers'::text, 'Students'::text, 'Other'::text])),
  constraint contacts_full_name_check CHECK (char_length(full_name) >= 1 AND char_length(full_name) <= 160)
);
alter table public.contacts enable row level security;
revoke all on public.contacts from public, anon, authenticated;
grant all on public.contacts to service_role;

create table if not exists public.document_types (
  id text not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint document_types_pkey PRIMARY KEY (id),
  constraint document_types_name_key UNIQUE (name),
  constraint document_types_id_check CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,59}$'::text),
  constraint document_types_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 80)
);
alter table public.document_types enable row level security;
revoke all on public.document_types from public, anon, authenticated;
grant all on public.document_types to service_role;

create table if not exists public.email_verification_codes (
  user_id uuid not null,
  email text not null,
  code_hash text not null,
  expires_at timestamp with time zone not null,
  sent_at timestamp with time zone not null,
  window_started_at timestamp with time zone not null,
  send_count integer not null default 0,
  attempt_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint email_verification_codes_pkey PRIMARY KEY (user_id),
  constraint email_verification_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint email_verification_codes_attempt_count_check CHECK (attempt_count >= 0),
  constraint email_verification_codes_send_count_check CHECK (send_count >= 0)
);
alter table public.email_verification_codes enable row level security;
revoke all on public.email_verification_codes from public, anon, authenticated;
grant all on public.email_verification_codes to service_role;

create table if not exists public.habits (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text not null default ''::text,
  icon text not null default 'check'::text,
  color text not null default 'blue'::text,
  category text,
  frequency text not null,
  weekday_mask smallint not null default 0,
  weekly_target smallint,
  tracking text not null default 'check'::text,
  target_value numeric(12,2),
  unit text not null default ''::text,
  start_date date not null,
  schedule_history jsonb not null default '[]'::jsonb,
  reminder_time time without time zone,
  reminder_email boolean not null default false,
  position integer not null default 0,
  archived_at timestamp with time zone,
  revision integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint habits_pkey PRIMARY KEY (id),
  constraint habits_id_owner UNIQUE (id, user_id),
  constraint habits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint habits_category_check CHECK (category IS NULL OR (category = ANY (ARRAY['health'::text, 'study'::text, 'fitness'::text, 'personal'::text, 'work'::text]))),
  constraint habits_color_check CHECK (color ~ '^[a-z]{1,16}$'::text),
  constraint habits_description_check CHECK (char_length(description) <= 500),
  constraint habits_frequency_check CHECK (frequency = ANY (ARRAY['daily'::text, 'weekdays'::text, 'weekly'::text])),
  constraint habits_icon_check CHECK (icon ~ '^[a-z][a-z-]{0,23}$'::text),
  constraint habits_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 80),
  constraint habits_reminder_email CHECK (reminder_email = false OR reminder_time IS NOT NULL),
  constraint habits_schedule CHECK (frequency = 'daily'::text AND weekday_mask = 0 AND weekly_target IS NULL OR frequency = 'weekdays'::text AND weekday_mask >= 1 AND weekday_mask <= 127 AND weekly_target IS NULL OR frequency = 'weekly'::text AND weekday_mask = 0 AND weekly_target IS NOT NULL),
  constraint habits_schedule_history_check CHECK (jsonb_typeof(schedule_history) = 'array'::text),
  constraint habits_target_value_check CHECK (target_value IS NULL OR target_value > 0::numeric AND target_value <= 100000::numeric),
  constraint habits_tracking CHECK (tracking = 'check'::text AND target_value IS NULL OR tracking = 'numeric'::text AND target_value IS NOT NULL),
  constraint habits_tracking_check CHECK (tracking = ANY (ARRAY['check'::text, 'numeric'::text])),
  constraint habits_unit_check CHECK (char_length(unit) <= 24),
  constraint habits_weekday_mask_check CHECK (weekday_mask >= 0 AND weekday_mask <= 127),
  constraint habits_weekly_target_check CHECK (weekly_target IS NULL OR weekly_target >= 1 AND weekly_target <= 7)
);
alter table public.habits enable row level security;
revoke all on public.habits from public, anon, authenticated;
grant all on public.habits to service_role;

create table if not exists public.habit_checkins (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  habit_id uuid not null,
  check_date date not null,
  value numeric(14,2) not null,
  target_value numeric(12,2),
  completed boolean not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint habit_checkins_pkey PRIMARY KEY (id),
  constraint habit_checkins_one_per_day UNIQUE (habit_id, check_date),
  constraint habit_checkins_habit_owner FOREIGN KEY (habit_id, user_id) REFERENCES public.habits(id, user_id) ON DELETE CASCADE,
  constraint habit_checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint habit_checkins_target_value_check CHECK (target_value IS NULL OR target_value > 0::numeric),
  constraint habit_checkins_value_check CHECK (value > 0::numeric AND value <= 1000000::numeric)
);
alter table public.habit_checkins enable row level security;
revoke all on public.habit_checkins from public, anon, authenticated;
grant all on public.habit_checkins to service_role;

create table if not exists public.habit_reminders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  habit_id uuid not null,
  local_date date not null,
  week_start date not null,
  remind_at timestamp with time zone not null,
  time_zone text not null,
  habit_name text not null,
  email_requested boolean not null default false,
  status text not null default 'scheduled'::text,
  email_status text not null default 'not_requested'::text,
  email_note text,
  attempts integer not null default 0,
  claimed_at timestamp with time zone,
  processed_at timestamp with time zone,
  read_at timestamp with time zone,
  dedupe_key text not null,
  created_at timestamp with time zone not null default now(),
  constraint habit_reminders_pkey PRIMARY KEY (id),
  constraint habit_reminders_dedupe_key_key UNIQUE (dedupe_key),
  constraint habit_reminders_habit_owner FOREIGN KEY (habit_id, user_id) REFERENCES public.habits(id, user_id) ON DELETE CASCADE,
  constraint habit_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint habit_reminders_dedupe_key_check CHECK (char_length(dedupe_key) <= 100),
  constraint habit_reminders_email_note_check CHECK (email_note IS NULL OR char_length(email_note) <= 200),
  constraint habit_reminders_email_status_check CHECK (email_status = ANY (ARRAY['not_requested'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
  constraint habit_reminders_habit_name_check CHECK (char_length(habit_name) >= 1 AND char_length(habit_name) <= 80),
  constraint habit_reminders_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'processing'::text, 'sent'::text, 'skipped'::text, 'cancelled'::text])),
  constraint habit_reminders_time_zone_check CHECK (char_length(time_zone) >= 1 AND char_length(time_zone) <= 64)
);
alter table public.habit_reminders enable row level security;
revoke all on public.habit_reminders from public, anon, authenticated;
grant all on public.habit_reminders to service_role;

create table if not exists public.integration_settings (
  provider text not null,
  enabled boolean not null default false,
  base_url text,
  config jsonb not null default '{}'::jsonb,
  secret_ciphertext text,
  secret_last4 text,
  last_check_at timestamp with time zone,
  last_check_ok boolean,
  last_check_message text,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint integration_settings_pkey PRIMARY KEY (provider),
  constraint integration_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint integration_settings_base_url_check CHECK (base_url IS NULL OR char_length(base_url) <= 300),
  constraint integration_settings_provider_check CHECK (provider ~ '^[a-z][a-z0-9-]{1,40}$'::text),
  constraint integration_settings_secret_last4_check CHECK (secret_last4 IS NULL OR char_length(secret_last4) <= 4)
);
alter table public.integration_settings enable row level security;
revoke all on public.integration_settings from public, anon, authenticated;
grant all on public.integration_settings to service_role;

create table if not exists public.loans (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  direction text not null,
  party_name text not null,
  borrower_name text not null,
  currency text not null default 'BDT'::text,
  principal numeric(14,2) not null,
  interest_method text not null default 'none'::text,
  interest_rate numeric(7,4),
  installment_count integer not null,
  frequency text not null,
  start_date date not null,
  first_due_date date not null,
  anchor_date date not null,
  anchor_number integer not null default 1,
  reference text not null default ''::text,
  notes text not null default ''::text,
  document_ids uuid[] not null default '{}'::uuid[],
  reminder_days_before smallint,
  overdue_alerts boolean not null default false,
  reminder_email boolean not null default false,
  status text not null default 'active'::text,
  completed_at timestamp with time zone,
  closed_at timestamp with time zone,
  close_note text,
  original_terms jsonb not null,
  schedule_changes jsonb not null default '[]'::jsonb,
  schedule_version integer not null default 1,
  revision integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loans_pkey PRIMARY KEY (id),
  constraint loans_id_owner UNIQUE (id, user_id),
  constraint loans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint loans_anchor_number_check CHECK (anchor_number >= 1 AND anchor_number <= 2000),
  constraint loans_borrower_name_check CHECK (char_length(btrim(borrower_name)) >= 1 AND char_length(btrim(borrower_name)) <= 120),
  constraint loans_close_note_check CHECK (close_note IS NULL OR char_length(close_note) >= 1 AND char_length(close_note) <= 500),
  constraint loans_currency_check CHECK (currency ~ '^[A-Z]{3}$'::text),
  constraint loans_direction_check CHECK (direction = ANY (ARRAY['borrowed'::text, 'lent'::text])),
  constraint loans_document_ids_check CHECK (cardinality(document_ids) <= 20),
  constraint loans_first_due_after_start CHECK (first_due_date >= start_date),
  constraint loans_frequency_check CHECK (frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text])),
  constraint loans_installment_count_check CHECK (installment_count >= 1 AND installment_count <= 2000),
  constraint loans_interest_method_check CHECK (interest_method = ANY (ARRAY['none'::text, 'flat'::text, 'reducing'::text])),
  constraint loans_interest_rate_check CHECK (interest_rate IS NULL OR interest_rate > 0::numeric AND interest_rate <= 100::numeric),
  constraint loans_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 80),
  constraint loans_notes_check CHECK (char_length(notes) <= 2000),
  constraint loans_original_terms_check CHECK (jsonb_typeof(original_terms) = 'object'::text),
  constraint loans_party_name_check CHECK (char_length(btrim(party_name)) >= 1 AND char_length(btrim(party_name)) <= 120),
  constraint loans_principal_check CHECK (principal > 0::numeric AND principal <= 1000000000::numeric),
  constraint loans_rate_matches_method CHECK ((interest_method = 'none'::text) = (interest_rate IS NULL)),
  constraint loans_reference_check CHECK (char_length(reference) <= 80),
  constraint loans_reminder_days_before_check CHECK (reminder_days_before IS NULL OR (reminder_days_before = ANY (ARRAY[0, 1, 3, 7]))),
  constraint loans_revision_check CHECK (revision >= 1),
  constraint loans_schedule_changes_check CHECK (jsonb_typeof(schedule_changes) = 'array'::text),
  constraint loans_schedule_version_check CHECK (schedule_version >= 1),
  constraint loans_status_check CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'closed'::text])),
  constraint loans_status_times CHECK ((status = 'completed'::text) = (completed_at IS NOT NULL) AND (status = 'closed'::text) = (closed_at IS NOT NULL) AND (status = 'closed'::text) = (close_note IS NOT NULL))
);
alter table public.loans enable row level security;
revoke all on public.loans from public, anon, authenticated;
grant all on public.loans to service_role;

create table if not exists public.loan_installments (
  id uuid not null default gen_random_uuid(),
  loan_id uuid not null,
  user_id uuid not null,
  number integer not null,
  due_date date not null,
  principal_amount numeric(14,2) not null,
  interest_amount numeric(14,2) not null,
  amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null default 0,
  schedule_version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loan_installments_pkey PRIMARY KEY (id),
  constraint loan_installments_id_loan UNIQUE (id, loan_id),
  constraint loan_installments_number_unique UNIQUE (loan_id, number),
  constraint loan_installments_loan_owner FOREIGN KEY (loan_id, user_id) REFERENCES public.loans(id, user_id) ON DELETE CASCADE,
  constraint loan_installments_check CHECK (amount > 0::numeric AND amount = (principal_amount + interest_amount)),
  constraint loan_installments_check1 CHECK (paid_amount >= 0::numeric AND paid_amount <= amount),
  constraint loan_installments_interest_amount_check CHECK (interest_amount >= 0::numeric),
  constraint loan_installments_number_check CHECK (number >= 1 AND number <= 2000),
  constraint loan_installments_principal_amount_check CHECK (principal_amount >= 0::numeric)
);
alter table public.loan_installments enable row level security;
revoke all on public.loan_installments from public, anon, authenticated;
grant all on public.loan_installments to service_role;

create table if not exists public.loan_payments (
  id uuid not null,
  loan_id uuid not null,
  installment_id uuid not null,
  user_id uuid not null,
  amount numeric(14,2) not null,
  paid_on date not null,
  method text not null default ''::text,
  reference text not null default ''::text,
  notes text not null default ''::text,
  status text not null default 'recorded'::text,
  reversed_at timestamp with time zone,
  reversal_reason text,
  corrects_payment_id uuid,
  created_at timestamp with time zone not null default now(),
  constraint loan_payments_pkey PRIMARY KEY (id),
  constraint loan_payments_corrects_payment_id_fkey FOREIGN KEY (corrects_payment_id) REFERENCES public.loan_payments(id) ON DELETE SET NULL,
  constraint loan_payments_installment FOREIGN KEY (installment_id, loan_id) REFERENCES public.loan_installments(id, loan_id) ON DELETE CASCADE,
  constraint loan_payments_loan_owner FOREIGN KEY (loan_id, user_id) REFERENCES public.loans(id, user_id) ON DELETE CASCADE,
  constraint loan_payments_amount_check CHECK (amount > 0::numeric),
  constraint loan_payments_method_check CHECK (char_length(method) <= 40),
  constraint loan_payments_notes_check CHECK (char_length(notes) <= 500),
  constraint loan_payments_reference_check CHECK (char_length(reference) <= 80),
  constraint loan_payments_reversal CHECK ((status = 'reversed'::text) = (reversed_at IS NOT NULL)),
  constraint loan_payments_reversal_reason_check CHECK (reversal_reason IS NULL OR char_length(reversal_reason) <= 300),
  constraint loan_payments_status_check CHECK (status = ANY (ARRAY['recorded'::text, 'reversed'::text]))
);
alter table public.loan_payments enable row level security;
revoke all on public.loan_payments from public, anon, authenticated;
grant all on public.loan_payments to service_role;

create table if not exists public.loan_reminders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  loan_id uuid not null,
  installment_id uuid not null,
  kind text not null,
  installment_number integer not null,
  due_date date not null,
  amount numeric(14,2) not null,
  currency text not null,
  loan_name text not null,
  remind_at timestamp with time zone not null,
  time_zone text not null,
  email_requested boolean not null default false,
  status text not null default 'scheduled'::text,
  email_status text not null default 'not_requested'::text,
  email_note text,
  attempts integer not null default 0,
  claimed_at timestamp with time zone,
  processed_at timestamp with time zone,
  read_at timestamp with time zone,
  dedupe_key text not null,
  created_at timestamp with time zone not null default now(),
  constraint loan_reminders_pkey PRIMARY KEY (id),
  constraint loan_reminders_dedupe_key_key UNIQUE (dedupe_key),
  constraint loan_reminders_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.loan_installments(id) ON DELETE CASCADE,
  constraint loan_reminders_loan_owner FOREIGN KEY (loan_id, user_id) REFERENCES public.loans(id, user_id) ON DELETE CASCADE,
  constraint loan_reminders_dedupe_key_check CHECK (char_length(dedupe_key) <= 100),
  constraint loan_reminders_email_note_check CHECK (email_note IS NULL OR char_length(email_note) <= 200),
  constraint loan_reminders_email_status_check CHECK (email_status = ANY (ARRAY['not_requested'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
  constraint loan_reminders_kind_check CHECK (kind = ANY (ARRAY['upcoming'::text, 'overdue'::text])),
  constraint loan_reminders_loan_name_check CHECK (char_length(loan_name) >= 1 AND char_length(loan_name) <= 80),
  constraint loan_reminders_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'processing'::text, 'sent'::text, 'skipped'::text])),
  constraint loan_reminders_time_zone_check CHECK (char_length(time_zone) >= 1 AND char_length(time_zone) <= 64)
);
alter table public.loan_reminders enable row level security;
revoke all on public.loan_reminders from public, anon, authenticated;
grant all on public.loan_reminders to service_role;

create table if not exists public.vault_items (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  section text not null,
  title text not null,
  subtitle text,
  metadata jsonb not null default '{}'::jsonb,
  file_key text,
  file_name text,
  file_size bigint,
  file_type text,
  favorite boolean not null default false,
  pinned boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint vault_items_pkey PRIMARY KEY (id),
  constraint vault_items_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.vault_folders(id) ON DELETE SET NULL,
  constraint vault_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint file_reference_is_complete CHECK (file_key IS NULL AND file_name IS NULL OR file_key IS NOT NULL AND file_name IS NOT NULL),
  constraint vault_items_file_size_check CHECK (file_size IS NULL OR file_size >= 0),
  constraint vault_items_section_check CHECK (section = ANY (ARRAY['documents'::text, 'academics'::text, 'subscriptions'::text, 'family'::text, 'purchases'::text, 'accounts'::text, 'memberships'::text, 'wallet-cards'::text, 'study'::text, 'business-card'::text, 'urls'::text, 'notes'::text, 'personal-finance'::text])),
  constraint vault_items_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 240)
);
alter table public.vault_items enable row level security;
revoke all on public.vault_items from public, anon, authenticated;
grant all on public.vault_items to service_role;

create table if not exists public.medical_records (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  record_type text not null,
  record_date date not null,
  folder_id uuid,
  provider text not null default ''::text,
  hospital text not null default ''::text,
  specialty text not null default ''::text,
  notes text not null default ''::text,
  additional_data text not null default ''::text,
  diagnosis text not null default ''::text,
  test_name text not null default ''::text,
  test_result text not null default ''::text,
  medication_notes text not null default ''::text,
  follow_up_date date,
  related_reminder_id uuid,
  file_key text,
  file_name text,
  file_size bigint,
  file_type text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint medical_records_pkey PRIMARY KEY (id),
  constraint medical_records_id_owner_unique UNIQUE (id, user_id),
  constraint medical_records_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.vault_folders(id) ON DELETE SET NULL,
  constraint medical_records_related_reminder_id_fkey FOREIGN KEY (related_reminder_id) REFERENCES public.vault_items(id) ON DELETE SET NULL,
  constraint medical_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint medical_records_file_reference_complete CHECK (file_key IS NULL AND file_name IS NULL AND file_size IS NULL AND file_type IS NULL OR file_key IS NOT NULL AND file_name IS NOT NULL AND file_size IS NOT NULL AND file_type IS NOT NULL),
  constraint medical_records_file_size_check CHECK (file_size IS NULL OR file_size >= 0),
  constraint medical_records_record_type_check CHECK (record_type = ANY (ARRAY['Prescription'::text, 'Medical Report'::text, 'Lab Test'::text, 'Imaging / Scan'::text, 'Doctor Visit'::text, 'Hospital Record'::text, 'Vaccination'::text, 'Medical Certificate'::text, 'Discharge Summary'::text, 'Other'::text])),
  constraint medical_records_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 200)
);
alter table public.medical_records enable row level security;
revoke all on public.medical_records from public, anon, authenticated;
grant all on public.medical_records to service_role;

create table if not exists public.medical_record_links (
  medical_record_id uuid not null,
  owner_id uuid not null,
  record_type text not null,
  record_id uuid not null,
  link_kind text not null default 'related'::text,
  created_at timestamp with time zone not null default now(),
  constraint medical_record_links_pkey PRIMARY KEY (medical_record_id, record_type, record_id, link_kind),
  constraint medical_record_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint medical_record_links_owner_record_fk FOREIGN KEY (medical_record_id, owner_id) REFERENCES public.medical_records(id, user_id) ON DELETE CASCADE,
  constraint medical_record_links_link_kind_check CHECK (link_kind = ANY (ARRAY['related'::text, 'reminder'::text])),
  constraint medical_record_links_record_type_check CHECK (record_type = ANY (ARRAY['contact'::text, 'vault_item'::text]))
);
alter table public.medical_record_links enable row level security;
revoke all on public.medical_record_links from public, anon, authenticated;
grant all on public.medical_record_links to service_role;

create table if not exists public.password_recovery_codes (
  user_id uuid not null,
  email text not null,
  code_hash text not null,
  expires_at timestamp with time zone not null,
  sent_at timestamp with time zone not null,
  window_started_at timestamp with time zone not null,
  send_count integer not null default 0,
  attempt_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint password_recovery_codes_pkey PRIMARY KEY (user_id),
  constraint password_recovery_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint password_recovery_codes_attempt_count_check CHECK (attempt_count >= 0),
  constraint password_recovery_codes_send_count_check CHECK (send_count >= 0)
);
alter table public.password_recovery_codes enable row level security;
revoke all on public.password_recovery_codes from public, anon, authenticated;
grant all on public.password_recovery_codes to service_role;

create table if not exists public.password_vaults (
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  master_password_changed_at timestamp with time zone not null default now(),
  master_password_hash text,
  constraint password_vaults_pkey PRIMARY KEY (user_id),
  constraint password_vaults_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint password_vaults_master_password_hash_check CHECK (master_password_hash IS NULL OR master_password_hash ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'::text)
);
alter table public.password_vaults enable row level security;
revoke all on public.password_vaults from public, anon, authenticated;
grant all on public.password_vaults to service_role;

create table if not exists public.password_vault_items (
  user_id uuid not null,
  id uuid not null,
  deleted boolean not null default false,
  revision integer not null default 1,
  change_seq bigint not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  data jsonb,
  constraint password_vault_items_pkey PRIMARY KEY (user_id, id),
  constraint password_vault_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.password_vaults(user_id) ON DELETE CASCADE,
  constraint password_vault_items_data_shape CHECK (data IS NULL OR jsonb_typeof(data) = 'object'::text AND octet_length(data::text) <= 65536),
  constraint password_vault_items_payload CHECK (deleted AND data IS NULL OR NOT deleted AND data IS NOT NULL),
  constraint password_vault_items_revision_check CHECK (revision >= 1)
);
alter table public.password_vault_items enable row level security;
revoke all on public.password_vault_items from public, anon, authenticated;
grant all on public.password_vault_items to service_role;

create table if not exists public.password_vault_recovery_codes (
  user_id uuid not null,
  email text not null,
  code_hash text not null default ''::text,
  expires_at timestamp with time zone not null,
  sent_at timestamp with time zone not null,
  window_started_at timestamp with time zone not null,
  send_count integer not null default 0,
  attempt_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint password_vault_recovery_codes_pkey PRIMARY KEY (user_id),
  constraint password_vault_recovery_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint password_vault_recovery_codes_attempt_count_check CHECK (attempt_count >= 0),
  constraint password_vault_recovery_codes_send_count_check CHECK (send_count >= 0)
);
alter table public.password_vault_recovery_codes enable row level security;
revoke all on public.password_vault_recovery_codes from public, anon, authenticated;
grant all on public.password_vault_recovery_codes to service_role;

create table if not exists public.password_vault_recovery_grants (
  user_id uuid not null,
  grant_hash text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  constraint password_vault_recovery_grants_pkey PRIMARY KEY (user_id),
  constraint password_vault_recovery_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint password_vault_recovery_grants_grant_hash_check CHECK (char_length(grant_hash) = 64)
);
alter table public.password_vault_recovery_grants enable row level security;
revoke all on public.password_vault_recovery_grants from public, anon, authenticated;
grant all on public.password_vault_recovery_grants to service_role;

create table if not exists public.user_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  token_hash text not null,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  constraint user_sessions_pkey PRIMARY KEY (id),
  constraint user_sessions_token_hash_key UNIQUE (token_hash),
  constraint user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint user_sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'::text)
);
alter table public.user_sessions enable row level security;
revoke all on public.user_sessions from public, anon, authenticated;
grant all on public.user_sessions to service_role;

create table if not exists public.password_vault_sessions (
  token_hash text not null,
  user_id uuid not null,
  session_id uuid not null,
  created_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  absolute_expires_at timestamp with time zone not null,
  constraint password_vault_sessions_pkey PRIMARY KEY (token_hash),
  constraint password_vault_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.user_sessions(id) ON DELETE CASCADE,
  constraint password_vault_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint password_vault_sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'::text)
);
alter table public.password_vault_sessions enable row level security;
revoke all on public.password_vault_sessions from public, anon, authenticated;
grant all on public.password_vault_sessions to service_role;

create table if not exists public.subscription_plans (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text not null default ''::text,
  storage_gb numeric(12,3) not null,
  price_per_gb_monthly numeric(12,4) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint subscription_plans_pkey PRIMARY KEY (id),
  constraint subscription_plans_slug_key UNIQUE (slug),
  constraint subscription_plans_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 80),
  constraint subscription_plans_price_per_gb_monthly_check CHECK (price_per_gb_monthly >= 0::numeric),
  constraint subscription_plans_storage_gb_check CHECK (storage_gb > 0::numeric)
);
alter table public.subscription_plans enable row level security;
revoke all on public.subscription_plans from public, anon, authenticated;
grant all on public.subscription_plans to service_role;

create table if not exists public.payment_records (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  amount numeric(12,2) not null,
  currency text not null default 'BDT'::text,
  method text not null,
  reference text not null,
  billing_period text not null default 'monthly'::text,
  duration_count integer not null default 1,
  term_months integer not null default 1,
  status text not null default 'pending'::text,
  submitted_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  admin_note text not null default ''::text,
  constraint payment_records_pkey PRIMARY KEY (id),
  constraint payment_records_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  constraint payment_records_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint payment_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint payment_records_amount_check CHECK (amount >= 0::numeric),
  constraint payment_records_billing_period_check CHECK (billing_period = ANY (ARRAY['monthly'::text, 'yearly'::text])),
  constraint payment_records_currency_check CHECK (char_length(currency) = 3),
  constraint payment_records_duration_count_check CHECK (duration_count >= 1 AND duration_count <= 120),
  constraint payment_records_method_check CHECK (char_length(method) >= 2 AND char_length(method) <= 40),
  constraint payment_records_reference_check CHECK (char_length(reference) >= 1 AND char_length(reference) <= 180),
  constraint payment_records_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  constraint payment_records_term_months_check CHECK (term_months >= 1 AND term_months <= 120)
);
alter table public.payment_records enable row level security;
revoke all on public.payment_records from public, anon, authenticated;
grant all on public.payment_records to service_role;

create table if not exists public.pdf_studio_documents (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  title text not null,
  notes text not null default ''::text,
  file_key text not null,
  file_name text not null,
  file_size bigint not null,
  page_count integer not null,
  thumbnail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint pdf_studio_documents_pkey PRIMARY KEY (id),
  constraint pdf_studio_documents_file_key_key UNIQUE (file_key),
  constraint pdf_studio_documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.vault_folders(id) ON DELETE SET NULL,
  constraint pdf_studio_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint pdf_studio_documents_file_name_check CHECK (char_length(file_name) >= 1 AND char_length(file_name) <= 200),
  constraint pdf_studio_documents_file_size_check CHECK (file_size > 0),
  constraint pdf_studio_documents_metadata_check CHECK (jsonb_typeof(metadata) = 'object'::text AND pg_column_size(metadata) <= 8192),
  constraint pdf_studio_documents_notes_check CHECK (char_length(notes) <= 1000),
  constraint pdf_studio_documents_page_count_check CHECK (page_count >= 1 AND page_count <= 5000),
  constraint pdf_studio_documents_thumbnail_check CHECK (thumbnail IS NULL OR char_length(thumbnail) <= 60000 AND thumbnail ~~ 'data:image/jpeg;base64,%'::text),
  constraint pdf_studio_documents_title_check CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 150)
);
alter table public.pdf_studio_documents enable row level security;
revoke all on public.pdf_studio_documents from public, anon, authenticated;
grant all on public.pdf_studio_documents to service_role;

create table if not exists public.persora_tables (
  id uuid not null,
  user_id uuid not null,
  kind text not null,
  name text not null,
  label text not null default ''::text,
  starred boolean not null default false,
  template text,
  meta jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  last_batch_id uuid,
  sheet_count integer not null default 0,
  record_count integer not null default 0,
  size_bytes bigint not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  opened_at timestamp with time zone,
  constraint persora_tables_pkey PRIMARY KEY (id),
  constraint persora_tables_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint persora_tables_kind_check CHECK (kind = ANY (ARRAY['spreadsheet'::text, 'smart'::text])),
  constraint persora_tables_label_check CHECK (char_length(label) <= 40),
  constraint persora_tables_meta_check CHECK (jsonb_typeof(meta) = 'object'::text),
  constraint persora_tables_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120),
  constraint persora_tables_record_count_check CHECK (record_count >= 0 AND record_count <= 5000),
  constraint persora_tables_revision_check CHECK (revision >= 1),
  constraint persora_tables_sheet_count_check CHECK (sheet_count >= 0 AND sheet_count <= 20),
  constraint persora_tables_size_bytes_check CHECK (size_bytes >= 0),
  constraint persora_tables_template_check CHECK (template IS NULL OR template ~ '^[a-z0-9-]{1,40}$'::text)
);
alter table public.persora_tables enable row level security;
revoke all on public.persora_tables from public, anon, authenticated;
grant all on public.persora_tables to service_role;

create table if not exists public.persora_table_attachments (
  table_id uuid not null,
  id uuid not null,
  user_id uuid not null,
  file_key text not null,
  file_name text not null,
  file_type text not null default 'application/octet-stream'::text,
  file_size bigint not null,
  created_at timestamp with time zone not null default now(),
  constraint persora_table_attachments_pkey PRIMARY KEY (table_id, id),
  constraint persora_table_attachments_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.persora_tables(id) ON DELETE CASCADE,
  constraint persora_table_attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint persora_table_attachments_check CHECK (file_key ~~ (user_id::text || '/persora-table/%'::text) AND char_length(file_key) <= 400),
  constraint persora_table_attachments_file_name_check CHECK (char_length(file_name) >= 1 AND char_length(file_name) <= 255),
  constraint persora_table_attachments_file_size_check CHECK (file_size >= 0),
  constraint persora_table_attachments_file_type_check CHECK (char_length(file_type) <= 120)
);
alter table public.persora_table_attachments enable row level security;
revoke all on public.persora_table_attachments from public, anon, authenticated;
grant all on public.persora_table_attachments to service_role;

create table if not exists public.persora_table_records (
  id uuid not null,
  table_id uuid not null,
  user_id uuid not null,
  position bigint not null,
  values jsonb not null default '{}'::jsonb,
  is_example boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_table_records_pkey PRIMARY KEY (id),
  constraint persora_table_records_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.persora_tables(id) ON DELETE CASCADE,
  constraint persora_table_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint persora_table_records_values_check CHECK (jsonb_typeof("values") = 'object'::text)
);
alter table public.persora_table_records enable row level security;
revoke all on public.persora_table_records from public, anon, authenticated;
grant all on public.persora_table_records to service_role;

create table if not exists public.persora_table_sheets (
  id uuid not null,
  table_id uuid not null,
  user_id uuid not null,
  position integer not null,
  name text not null,
  data jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint persora_table_sheets_pkey PRIMARY KEY (id),
  constraint persora_table_sheets_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.persora_tables(id) ON DELETE CASCADE,
  constraint persora_table_sheets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint persora_table_sheets_data_check CHECK (jsonb_typeof(data) = 'object'::text),
  constraint persora_table_sheets_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 31),
  constraint persora_table_sheets_position_check CHECK ("position" >= 0 AND "position" <= 1000)
);
alter table public.persora_table_sheets enable row level security;
revoke all on public.persora_table_sheets from public, anon, authenticated;
grant all on public.persora_table_sheets to service_role;

create table if not exists public.photo_studio_photos (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  source_photo_id uuid,
  title text not null,
  category text not null default 'passport'::text,
  notes text not null default ''::text,
  file_key text not null,
  file_name text not null,
  file_size bigint not null,
  file_type text not null,
  width_px integer not null,
  height_px integer not null,
  dpi numeric(8,2),
  metadata jsonb not null default '{}'::jsonb,
  edit_settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint photo_studio_photos_pkey PRIMARY KEY (id),
  constraint photo_studio_photos_file_key_key UNIQUE (file_key),
  constraint photo_studio_photos_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.vault_folders(id) ON DELETE SET NULL,
  constraint photo_studio_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint photo_studio_photos_category_check CHECK (category = ANY (ARRAY['passport'::text, 'stamp'::text, 'visa'::text, 'id-card'::text, 'job-application'::text, 'other'::text])),
  constraint photo_studio_photos_dpi_check CHECK (dpi IS NULL OR dpi >= 1::numeric AND dpi <= 10000::numeric),
  constraint photo_studio_photos_edit_settings_check CHECK (jsonb_typeof(edit_settings) = 'object'::text AND pg_column_size(edit_settings) <= 16384),
  constraint photo_studio_photos_file_name_check CHECK (char_length(file_name) >= 1 AND char_length(file_name) <= 200),
  constraint photo_studio_photos_file_size_check CHECK (file_size > 0),
  constraint photo_studio_photos_file_type_check CHECK (file_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])),
  constraint photo_studio_photos_height_px_check CHECK (height_px >= 1 AND height_px <= 20000),
  constraint photo_studio_photos_metadata_check CHECK (jsonb_typeof(metadata) = 'object'::text AND pg_column_size(metadata) <= 8192),
  constraint photo_studio_photos_notes_check CHECK (char_length(notes) <= 1000),
  constraint photo_studio_photos_title_check CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 120),
  constraint photo_studio_photos_width_px_check CHECK (width_px >= 1 AND width_px <= 20000)
);
alter table public.photo_studio_photos enable row level security;
revoke all on public.photo_studio_photos from public, anon, authenticated;
grant all on public.photo_studio_photos to service_role;

create table if not exists public.platform_settings (
  setting_key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint platform_settings_pkey PRIMARY KEY (setting_key),
  constraint platform_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;
grant all on public.platform_settings to service_role;

create table if not exists public.projects (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  description text not null default ''::text,
  kind text not null default 'personal'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  category text not null default ''::text,
  tags text[] not null default '{}'::text[],
  start_date date,
  due_date date,
  priority text not null default 'normal'::text,
  paused boolean not null default false,
  archived boolean not null default false,
  constraint projects_pkey PRIMARY KEY (id),
  constraint projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint projects_description_check CHECK (char_length(description) <= 2000),
  constraint projects_kind_check CHECK (kind = ANY (ARRAY['personal'::text, 'shared'::text])),
  constraint projects_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 120),
  constraint projects_category_check CHECK (char_length(category) <= 80),
  constraint projects_tags_check CHECK (coalesce(array_length(tags, 1), 0) <= 12),
  constraint projects_priority_check CHECK (priority in ('high', 'medium', 'normal', 'low')),
  constraint projects_date_order_check CHECK (start_date is null or due_date is null or due_date >= start_date)
);
alter table public.projects enable row level security;
revoke all on public.projects from public, anon, authenticated;
grant all on public.projects to service_role;

create table if not exists public.project_activity (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  actor_id uuid,
  actor_name text not null default ''::text,
  action text not null,
  target text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  constraint project_activity_pkey PRIMARY KEY (id),
  constraint project_activity_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_activity_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_activity_action_check CHECK (char_length(action) >= 1 AND char_length(action) <= 60),
  constraint project_activity_target_check CHECK (char_length(target) <= 200)
);
alter table public.project_activity enable row level security;
revoke all on public.project_activity from public, anon, authenticated;
grant all on public.project_activity to service_role;

create table if not exists public.project_attachment_cleanup (
  file_key text not null,
  owner_id uuid not null,
  queued_at timestamp with time zone not null default now(),
  constraint project_attachment_cleanup_pkey PRIMARY KEY (file_key),
  constraint project_attachment_cleanup_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
alter table public.project_attachment_cleanup enable row level security;
revoke all on public.project_attachment_cleanup from public, anon, authenticated;
grant all on public.project_attachment_cleanup to service_role;

create table if not exists public.project_folders (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  name text not null,
  color text not null default 'cyan'::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint project_folders_pkey PRIMARY KEY (id),
  constraint project_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_folders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_folders_color_check CHECK (color = ANY (ARRAY['cyan'::text, 'purple'::text, 'pink'::text, 'blue'::text, 'orange'::text, 'green'::text])),
  constraint project_folders_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 80)
);
alter table public.project_folders enable row level security;
revoke all on public.project_folders from public, anon, authenticated;
grant all on public.project_folders to service_role;

create table if not exists public.project_fields (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  folder_id uuid,
  title text not null,
  description text not null default ''::text,
  status text not null default 'planning'::text,
  progress integer not null default 0,
  creator_id uuid not null,
  creator_name text not null default ''::text,
  assignee_id uuid,
  due_date date,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint project_fields_pkey PRIMARY KEY (id),
  constraint project_fields_id_project_id_key UNIQUE (id, project_id),
  constraint project_fields_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_fields_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_fields_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.project_folders(id) ON DELETE SET NULL,
  constraint project_fields_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_fields_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_fields_description_check CHECK (char_length(description) <= 4000),
  constraint project_fields_progress_check CHECK (progress >= 0 AND progress <= 100),
  constraint project_fields_status_check CHECK (status = ANY (ARRAY['planning'::text, 'in-progress'::text, 'in-review'::text, 'blocked'::text, 'completed'::text])),
  constraint project_fields_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 160)
);
alter table public.project_fields enable row level security;
revoke all on public.project_fields from public, anon, authenticated;
grant all on public.project_fields to service_role;

create table if not exists public.project_field_attachments (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  field_id uuid not null,
  owner_id uuid not null,
  uploader_id uuid not null,
  file_key text not null,
  file_name text not null,
  file_size bigint not null,
  file_type text not null,
  created_at timestamp with time zone not null default now(),
  constraint project_field_attachments_pkey PRIMARY KEY (id),
  constraint project_field_attachments_file_key_key UNIQUE (file_key),
  constraint project_field_attachments_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.project_fields(id) ON DELETE CASCADE,
  constraint project_field_attachments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_field_attachments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_field_attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_field_attachments_file_name_check CHECK (char_length(file_name) >= 1 AND char_length(file_name) <= 240),
  constraint project_field_attachments_file_size_check CHECK (file_size >= 1 AND file_size <= 157286400),
  constraint project_field_attachments_file_type_check CHECK (file_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/gif'::text, 'image/webp'::text, 'text/plain'::text, 'text/csv'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'::text]))
);
alter table public.project_field_attachments enable row level security;
revoke all on public.project_field_attachments from public, anon, authenticated;
grant all on public.project_field_attachments to service_role;

create table if not exists public.project_field_comments (
  id uuid not null default gen_random_uuid(),
  field_id uuid not null,
  project_id uuid not null,
  author_id uuid not null,
  author_name text not null default ''::text,
  body text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint project_field_comments_pkey PRIMARY KEY (id),
  constraint project_field_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_field_comments_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.project_fields(id) ON DELETE CASCADE,
  constraint project_field_comments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_field_comments_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 2000)
);
alter table public.project_field_comments enable row level security;
revoke all on public.project_field_comments from public, anon, authenticated;
grant all on public.project_field_comments to service_role;

create table if not exists public.project_field_reactions (
  field_id uuid not null,
  user_id uuid not null,
  pinned boolean not null default false,
  favourite boolean not null default false,
  updated_at timestamp with time zone not null default now(),
  constraint project_field_reactions_pkey PRIMARY KEY (field_id, user_id),
  constraint project_field_reactions_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.project_fields(id) ON DELETE CASCADE,
  constraint project_field_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
alter table public.project_field_reactions enable row level security;
revoke all on public.project_field_reactions from public, anon, authenticated;
grant all on public.project_field_reactions to service_role;

create table if not exists public.project_field_requests (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  requester_id uuid not null,
  requester_name text not null default ''::text,
  note text not null default ''::text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'::text,
  resolved_by uuid,
  resolution_note text not null default ''::text,
  field_id uuid,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  constraint project_field_requests_pkey PRIMARY KEY (id),
  constraint project_field_requests_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.project_fields(id) ON DELETE SET NULL,
  constraint project_field_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_field_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_field_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_field_requests_note_check CHECK (char_length(note) <= 1000),
  constraint project_field_requests_resolution_note_check CHECK (char_length(resolution_note) <= 1000),
  constraint project_field_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
);
alter table public.project_field_requests enable row level security;
revoke all on public.project_field_requests from public, anon, authenticated;
grant all on public.project_field_requests to service_role;

create table if not exists public.project_members (
  project_id uuid not null,
  user_id uuid not null,
  role text not null default 'viewer'::text,
  can_create_fields boolean not null default false,
  invited_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint project_members_pkey PRIMARY KEY (project_id, user_id),
  constraint project_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_members_role_check CHECK (role = ANY (ARRAY['editor'::text, 'commenter'::text, 'viewer'::text]))
);
alter table public.project_members enable row level security;
revoke all on public.project_members from public, anon, authenticated;
grant all on public.project_members to service_role;

create table if not exists public.project_notification_preferences (
  user_id uuid not null,
  membership boolean not null default true,
  assignments boolean not null default true,
  requests boolean not null default true,
  subtasks boolean not null default true,
  comments boolean not null default true,
  attachments boolean not null default true,
  deadlines boolean not null default true,
  updates boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  constraint project_notification_preferences_pkey PRIMARY KEY (user_id),
  constraint project_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
alter table public.project_notification_preferences enable row level security;
revoke all on public.project_notification_preferences from public, anon, authenticated;
grant all on public.project_notification_preferences to service_role;

create table if not exists public.project_tasks (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  field_id uuid not null,
  name text not null,
  description text not null default ''::text,
  status text not null default 'todo'::text,
  priority text not null default 'normal'::text,
  assignee_id uuid,
  paused boolean not null default false,
  created_by uuid not null,
  updated_by uuid,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint project_tasks_pkey PRIMARY KEY (id),
  constraint project_tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_tasks_field_project_fk FOREIGN KEY (field_id, project_id) REFERENCES public.project_fields(id, project_id) ON DELETE CASCADE,
  constraint project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_tasks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_tasks_description_check CHECK (char_length(description) <= 4000),
  constraint project_tasks_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 240),
  constraint project_tasks_status_check CHECK (status = ANY (ARRAY['todo'::text, 'in-progress'::text, 'in-review'::text, 'complete'::text])),
  constraint project_tasks_priority_check CHECK (priority in ('high', 'medium', 'normal', 'low'))
);
alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from public, anon, authenticated;
grant all on public.project_tasks to service_role;

create table if not exists public.project_notifications (
  id uuid not null default gen_random_uuid(),
  recipient_id uuid not null,
  actor_id uuid,
  project_id uuid not null,
  field_id uuid,
  kind text not null,
  actor_name text not null default 'A project member'::text,
  title text not null,
  message text not null,
  event_key text not null,
  created_at timestamp with time zone not null default now(),
  read_at timestamp with time zone,
  task_id uuid,
  constraint project_notifications_pkey PRIMARY KEY (id),
  constraint project_notifications_event_key_key UNIQUE (event_key),
  constraint project_notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint project_notifications_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.project_fields(id) ON DELETE SET NULL,
  constraint project_notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE SET NULL,
  constraint project_notifications_actor_name_check CHECK (char_length(actor_name) <= 120),
  constraint project_notifications_event_key_check CHECK (char_length(event_key) >= 1 AND char_length(event_key) <= 240),
  constraint project_notifications_kind_check CHECK (kind in ('membership', 'access_removed', 'assignment', 'request', 'task', 'comment', 'attachment', 'deadline', 'update')),
  constraint project_notifications_message_check CHECK (char_length(message) >= 1 AND char_length(message) <= 500),
  constraint project_notifications_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 120)
);
alter table public.project_notifications enable row level security;
revoke all on public.project_notifications from public, anon, authenticated;
grant all on public.project_notifications to service_role;

create table if not exists public.project_task_attachments (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  field_id uuid not null,
  task_id uuid not null,
  owner_id uuid not null,
  uploader_id uuid not null,
  file_key text not null,
  file_name text not null,
  file_size bigint not null,
  file_type text not null,
  created_at timestamp with time zone not null default now(),
  constraint project_task_attachments_pkey PRIMARY KEY (id),
  constraint project_task_attachments_file_key_key UNIQUE (file_key),
  constraint project_task_attachments_field_project_fk FOREIGN KEY (field_id, project_id) REFERENCES public.project_fields(id, project_id) ON DELETE CASCADE,
  constraint project_task_attachments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_task_attachments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  constraint project_task_attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_task_attachments_file_name_check CHECK (char_length(file_name) >= 1 AND char_length(file_name) <= 240),
  constraint project_task_attachments_file_size_check CHECK (file_size >= 1 AND file_size <= 157286400),
  constraint project_task_attachments_file_type_check CHECK (file_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/gif'::text, 'image/webp'::text, 'text/plain'::text, 'text/csv'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'::text]))
);
alter table public.project_task_attachments enable row level security;
revoke all on public.project_task_attachments from public, anon, authenticated;
grant all on public.project_task_attachments to service_role;

create table if not exists public.project_task_comments (
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  project_id uuid not null,
  author_id uuid not null,
  author_name text not null default ''::text,
  body text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint project_task_comments_pkey PRIMARY KEY (id),
  constraint project_task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint project_task_comments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  constraint project_task_comments_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 2000)
);
alter table public.project_task_comments enable row level security;
revoke all on public.project_task_comments from public, anon, authenticated;
grant all on public.project_task_comments to service_role;

create table if not exists public.record_shares (
  id uuid not null default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint record_shares_pkey PRIMARY KEY (id),
  constraint record_shares_unique UNIQUE (resource_type, resource_id, recipient_id),
  constraint record_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint record_shares_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint record_shares_not_self CHECK (owner_id <> recipient_id),
  constraint record_shares_resource_type_check CHECK (resource_type = ANY (ARRAY['contact'::text, 'business_card'::text, 'photo_studio_photo'::text]))
);
alter table public.record_shares enable row level security;
revoke all on public.record_shares from public, anon, authenticated;
grant all on public.record_shares to service_role;

create table if not exists public.share_notifications (
  id uuid not null default gen_random_uuid(),
  recipient_id uuid not null,
  actor_id uuid,
  actor_name text not null default 'Persora user'::text,
  kind text not null,
  item_title text not null default 'Shared document'::text,
  message text not null,
  created_at timestamp with time zone not null default now(),
  read_at timestamp with time zone,
  constraint share_notifications_pkey PRIMARY KEY (id),
  constraint share_notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint share_notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint share_notifications_kind_check CHECK (kind = ANY (ARRAY['shared'::text, 'permission_changed'::text, 'unshared'::text])),
  constraint share_notifications_message_check CHECK (char_length(message) >= 1 AND char_length(message) <= 500)
);
alter table public.share_notifications enable row level security;
revoke all on public.share_notifications from public, anon, authenticated;
grant all on public.share_notifications to service_role;

create table if not exists public.smart_scan_cache (
  owner_id uuid not null,
  content_sha256 text not null,
  payload jsonb not null,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  constraint smart_scan_cache_pkey PRIMARY KEY (owner_id, content_sha256),
  constraint smart_scan_cache_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint smart_scan_cache_content_sha256_check CHECK (content_sha256 ~ '^[0-9a-f]{64}$'::text)
);
alter table public.smart_scan_cache enable row level security;
revoke all on public.smart_scan_cache from public, anon, authenticated;
grant all on public.smart_scan_cache to service_role;

create table if not exists public.smart_scan_usage (
  user_id uuid not null,
  enabled boolean not null default true,
  scan_count bigint not null default 0,
  ocr_run_count bigint not null default 0,
  ai_extraction_count bigint not null default 0,
  last_scanned_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint smart_scan_usage_pkey PRIMARY KEY (user_id),
  constraint smart_scan_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint smart_scan_usage_ai_extraction_count_check CHECK (ai_extraction_count >= 0),
  constraint smart_scan_usage_ocr_run_count_check CHECK (ocr_run_count >= 0),
  constraint smart_scan_usage_scan_count_check CHECK (scan_count >= 0)
);
alter table public.smart_scan_usage enable row level security;
revoke all on public.smart_scan_usage from public, anon, authenticated;
grant all on public.smart_scan_usage to service_role;

create table if not exists public.timeline_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_type text not null,
  event_date date not null,
  event_key text,
  record_id uuid,
  encrypted_payload text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint timeline_events_pkey PRIMARY KEY (id),
  constraint timeline_events_id_owner_unique UNIQUE (id, user_id),
  constraint timeline_events_owner_key_unique UNIQUE (user_id, event_key),
  constraint timeline_events_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.vault_items(id) ON DELETE CASCADE,
  constraint timeline_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint timeline_events_auto_requires_key CHECK (event_type <> 'automatic'::text OR event_key IS NOT NULL AND record_id IS NOT NULL),
  constraint timeline_events_event_type_check CHECK (event_type = ANY (ARRAY['automatic'::text, 'manual'::text])),
  constraint timeline_events_manual_has_no_key CHECK (event_type <> 'manual'::text OR event_key IS NULL)
);
alter table public.timeline_events enable row level security;
revoke all on public.timeline_events from public, anon, authenticated;
grant all on public.timeline_events to service_role;

create table if not exists public.timeline_event_links (
  event_id uuid not null,
  owner_id uuid not null,
  record_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint timeline_event_links_pkey PRIMARY KEY (event_id, record_id),
  constraint timeline_event_links_owner_event_fk FOREIGN KEY (event_id, owner_id) REFERENCES public.timeline_events(id, user_id) ON DELETE CASCADE,
  constraint timeline_event_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint timeline_event_links_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.vault_items(id) ON DELETE CASCADE
);
alter table public.timeline_event_links enable row level security;
revoke all on public.timeline_event_links from public, anon, authenticated;
grant all on public.timeline_event_links to service_role;

create table if not exists public.trash_file_releases (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  file_key text not null,
  released_at timestamp with time zone not null default now(),
  constraint trash_file_releases_pkey PRIMARY KEY (id),
  constraint trash_file_releases_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
alter table public.trash_file_releases enable row level security;
revoke all on public.trash_file_releases from public, anon, authenticated;
grant all on public.trash_file_releases to service_role;

create table if not exists public.trash_items (
  id uuid not null,
  owner_id uuid not null,
  kind text not null,
  title text not null default 'Deleted item'::text,
  context jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  file_keys jsonb not null default '[]'::jsonb,
  status text not null default 'active'::text,
  deleted_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  purge_claimed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint trash_items_pkey PRIMARY KEY (id),
  constraint trash_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint trash_items_kind_check CHECK (kind = ANY (ARRAY['vault_item'::text, 'contact'::text, 'business_card'::text, 'medical_record'::text, 'timeline_event'::text, 'photo_studio_photo'::text, 'pdf_studio_document'::text, 'persora_table'::text, 'persora_doc'::text])),
  constraint trash_items_retention_check CHECK (expires_at > deleted_at),
  constraint trash_items_status_check CHECK (status = ANY (ARRAY['active'::text, 'restoring'::text, 'purging'::text]))
);
alter table public.trash_items enable row level security;
revoke all on public.trash_items from public, anon, authenticated;
grant all on public.trash_items to service_role;

create table if not exists public.user_connections (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  status text not null default 'connected'::text,
  account_ref text,
  account_label text,
  account_email text,
  credential_ciphertext text,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamp with time zone,
  last_error text,
  last_error_at timestamp with time zone,
  connected_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_connections_pkey PRIMARY KEY (id),
  constraint user_connections_user_provider_key UNIQUE (user_id, provider),
  constraint user_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint user_connections_account_email_check CHECK (account_email IS NULL OR char_length(account_email) <= 254),
  constraint user_connections_account_label_check CHECK (account_label IS NULL OR char_length(account_label) <= 160),
  constraint user_connections_account_ref_check CHECK (account_ref IS NULL OR char_length(account_ref) <= 120),
  constraint user_connections_provider_check CHECK (provider ~ '^[a-z][a-z0-9-]{1,40}$'::text),
  constraint user_connections_status_check CHECK (status = ANY (ARRAY['connected'::text, 'reauth_required'::text, 'revoked'::text]))
);
alter table public.user_connections enable row level security;
revoke all on public.user_connections from public, anon, authenticated;
grant all on public.user_connections to service_role;

create table if not exists public.user_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  status text not null default 'active'::text,
  storage_limit_gb numeric(12,3) not null,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_subscriptions_pkey PRIMARY KEY (id),
  constraint user_subscriptions_user_id_key UNIQUE (user_id),
  constraint user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  constraint user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint user_subscriptions_status_check CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'past_due'::text, 'canceled'::text])),
  constraint user_subscriptions_storage_limit_gb_check CHECK (storage_limit_gb > 0::numeric)
);
alter table public.user_subscriptions enable row level security;
revoke all on public.user_subscriptions from public, anon, authenticated;
grant all on public.user_subscriptions to service_role;

create table if not exists public.vault_shares (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null,
  permission text not null default 'view'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint vault_shares_pkey PRIMARY KEY (id),
  constraint vault_shares_item_recipient_unique UNIQUE (item_id, recipient_id),
  constraint vault_shares_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.vault_items(id) ON DELETE CASCADE,
  constraint vault_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint vault_shares_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint vault_shares_not_self CHECK (owner_id <> recipient_id),
  constraint vault_shares_permission_check CHECK (permission = ANY (ARRAY['view'::text, 'comment'::text, 'edit'::text]))
);
alter table public.vault_shares enable row level security;
revoke all on public.vault_shares from public, anon, authenticated;
grant all on public.vault_shares to service_role;

create table if not exists public.vault_share_comments (
  id uuid not null default gen_random_uuid(),
  share_id uuid not null,
  author_id uuid not null,
  author_name text not null default 'Persora member'::text,
  body text not null,
  created_at timestamp with time zone not null default now(),
  constraint vault_share_comments_pkey PRIMARY KEY (id),
  constraint vault_share_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint vault_share_comments_share_id_fkey FOREIGN KEY (share_id) REFERENCES public.vault_shares(id) ON DELETE CASCADE,
  constraint vault_share_comments_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 5000)
);
alter table public.vault_share_comments enable row level security;
revoke all on public.vault_share_comments from public, anon, authenticated;
grant all on public.vault_share_comments to service_role;

create table if not exists public.workspace_preferences (
  user_id uuid not null,
  launcher_favorites jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint workspace_preferences_pkey PRIMARY KEY (user_id),
  constraint workspace_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint workspace_preferences_launcher_favorites_shape CHECK (launcher_favorites IS NULL OR jsonb_typeof(launcher_favorites) = 'array'::text AND jsonb_array_length(launcher_favorites) <= 24 AND pg_column_size(launcher_favorites) <= 2048)
);
alter table public.workspace_preferences enable row level security;
revoke all on public.workspace_preferences from public, anon, authenticated;
grant all on public.workspace_preferences to service_role;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists admin_audit_events_created_at_idx ON public.admin_audit_events USING btree (created_at DESC);
create index if not exists profiles_created_at_idx ON public.profiles USING btree (created_at DESC);
create unique index if not exists profiles_email_ci_unique_idx ON public.profiles USING btree (lower(email)) WHERE (email IS NOT NULL);
create unique index if not exists profiles_login_id_unique_idx ON public.profiles USING btree (login_id);
create index if not exists auth_login_attempts_window_idx ON public.auth_login_attempts USING btree (window_started_at);
create unique index if not exists vault_folders_owner_scope_name_idx ON public.vault_folders USING btree (user_id, scope, lower(name));
create index if not exists vault_folders_owner_scope_pinned_idx ON public.vault_folders USING btree (user_id, scope, pinned DESC, name);
create index if not exists business_cards_owner_folder_idx ON public.business_cards USING btree (user_id, folder_id);
create index if not exists business_cards_owner_updated_idx ON public.business_cards USING btree (user_id, updated_at DESC);
create index if not exists business_cards_public_idx ON public.business_cards USING btree (card_id) WHERE (is_public = true);
create index if not exists business_card_reports_created_idx ON public.business_card_reports USING btree (created_at DESC);
create unique index if not exists calendar_events_exception_at_key ON public.calendar_events USING btree (series_id, original_start_at) WHERE (original_start_at IS NOT NULL);
create unique index if not exists calendar_events_exception_date_key ON public.calendar_events USING btree (series_id, original_start_date) WHERE (original_start_date IS NOT NULL);
create unique index if not exists calendar_events_external_key ON public.calendar_events USING btree (user_id, source, external_id) WHERE (external_id IS NOT NULL);
create index if not exists calendar_events_owner_date_idx ON public.calendar_events USING btree (user_id, start_date) WHERE ((start_date IS NOT NULL) AND (recurrence_freq IS NULL));
create index if not exists calendar_events_owner_series_idx ON public.calendar_events USING btree (user_id) WHERE (recurrence_freq IS NOT NULL);
create index if not exists calendar_events_owner_span_at_idx ON public.calendar_events USING btree (user_id, start_at, end_at) WHERE ((start_at IS NOT NULL) AND (recurrence_freq IS NULL));
create index if not exists calendar_events_owner_span_date_idx ON public.calendar_events USING btree (user_id, start_date, end_date) WHERE ((start_date IS NOT NULL) AND (recurrence_freq IS NULL));
create index if not exists calendar_events_owner_start_idx ON public.calendar_events USING btree (user_id, start_at) WHERE ((start_at IS NOT NULL) AND (recurrence_freq IS NULL));
create index if not exists calendar_events_owner_title_idx ON public.calendar_events USING btree (user_id, lower(title) text_pattern_ops);
create index if not exists calendar_events_owner_type_idx ON public.calendar_events USING btree (user_id, item_type) WHERE (item_type <> 'event'::text);
create index if not exists calendar_events_series_idx ON public.calendar_events USING btree (series_id) WHERE (series_id IS NOT NULL);
create index if not exists calendar_reminders_due_idx ON public.calendar_reminders USING btree (remind_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'processing'::text]));
create unique index if not exists calendar_reminders_one_scheduled ON public.calendar_reminders USING btree (event_id) WHERE (status = 'scheduled'::text);
create index if not exists calendar_reminders_owner_idx ON public.calendar_reminders USING btree (user_id, remind_at DESC);
create index if not exists contacts_owner_folder_idx ON public.contacts USING btree (user_id, folder_id);
create index if not exists contacts_owner_name_idx ON public.contacts USING btree (user_id, lower(full_name));
create index if not exists contacts_owner_updated_idx ON public.contacts USING btree (user_id, updated_at DESC);
create index if not exists habits_owner_idx ON public.habits USING btree (user_id, archived_at, "position");
create index if not exists habit_checkins_completed_idx ON public.habit_checkins USING btree (habit_id, check_date) WHERE completed;
create index if not exists habit_checkins_owner_date_idx ON public.habit_checkins USING btree (user_id, check_date);
create index if not exists habit_reminders_due_idx ON public.habit_reminders USING btree (remind_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'processing'::text]));
create unique index if not exists habit_reminders_one_scheduled ON public.habit_reminders USING btree (habit_id) WHERE (status = 'scheduled'::text);
create index if not exists habit_reminders_owner_idx ON public.habit_reminders USING btree (user_id, remind_at DESC);
create index if not exists loans_owner_idx ON public.loans USING btree (user_id, status, created_at);
create index if not exists loan_installments_due_idx ON public.loan_installments USING btree (user_id, due_date) WHERE (paid_amount < amount);
create index if not exists loan_installments_loan_due_idx ON public.loan_installments USING btree (loan_id, due_date);
create index if not exists loan_payments_installment_idx ON public.loan_payments USING btree (installment_id, created_at);
create index if not exists loan_payments_loan_idx ON public.loan_payments USING btree (loan_id, paid_on);
create index if not exists loan_payments_owner_idx ON public.loan_payments USING btree (user_id, paid_on);
create index if not exists loan_reminders_due_idx ON public.loan_reminders USING btree (remind_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'processing'::text]));
create unique index if not exists loan_reminders_one_scheduled ON public.loan_reminders USING btree (loan_id) WHERE (status = 'scheduled'::text);
create index if not exists loan_reminders_owner_idx ON public.loan_reminders USING btree (user_id, remind_at DESC);
create index if not exists vault_items_metadata_gin_idx ON public.vault_items USING gin (metadata);
create index if not exists vault_items_owner_folder_idx ON public.vault_items USING btree (user_id, section, folder_id);
create index if not exists vault_items_owner_section_idx ON public.vault_items USING btree (user_id, section);
create index if not exists vault_items_owner_updated_idx ON public.vault_items USING btree (user_id, updated_at DESC);
create index if not exists medical_records_owner_date_idx ON public.medical_records USING btree (user_id, record_date DESC, updated_at DESC);
create index if not exists medical_records_owner_folder_idx ON public.medical_records USING btree (user_id, folder_id);
create index if not exists medical_records_owner_type_idx ON public.medical_records USING btree (user_id, record_type, record_date DESC);
create index if not exists medical_record_links_target_idx ON public.medical_record_links USING btree (owner_id, record_type, record_id);
create index if not exists password_vault_items_changes_idx ON public.password_vault_items USING btree (user_id, change_seq);
create index if not exists user_sessions_user_expires_idx ON public.user_sessions USING btree (user_id, expires_at DESC);
create index if not exists password_vault_sessions_session_idx ON public.password_vault_sessions USING btree (session_id);
create index if not exists password_vault_sessions_user_idx ON public.password_vault_sessions USING btree (user_id);
create index if not exists payment_records_status_submitted_idx ON public.payment_records USING btree (status, submitted_at DESC);
create index if not exists payment_records_user_submitted_idx ON public.payment_records USING btree (user_id, submitted_at DESC);
create index if not exists pdf_studio_documents_owner_folder_idx ON public.pdf_studio_documents USING btree (user_id, folder_id);
create index if not exists pdf_studio_documents_owner_updated_idx ON public.pdf_studio_documents USING btree (user_id, updated_at DESC);
create index if not exists persora_tables_owner_idx ON public.persora_tables USING btree (user_id, updated_at DESC);
create index if not exists persora_table_attachments_key_idx ON public.persora_table_attachments USING btree (user_id, file_key);
create index if not exists persora_table_records_table_idx ON public.persora_table_records USING btree (table_id, "position");
create index if not exists persora_table_sheets_table_idx ON public.persora_table_sheets USING btree (table_id, "position");
create index if not exists photo_studio_photos_owner_folder_idx ON public.photo_studio_photos USING btree (user_id, folder_id);
create index if not exists photo_studio_photos_owner_source_idx ON public.photo_studio_photos USING btree (user_id, source_photo_id) WHERE (source_photo_id IS NOT NULL);
create index if not exists photo_studio_photos_owner_updated_idx ON public.photo_studio_photos USING btree (user_id, updated_at DESC);
create index if not exists projects_owner_idx ON public.projects USING btree (owner_id);
create index if not exists project_activity_project_idx ON public.project_activity USING btree (project_id, created_at DESC);
create index if not exists project_attachment_cleanup_queued_idx ON public.project_attachment_cleanup USING btree (queued_at);
create index if not exists project_folders_project_idx ON public.project_folders USING btree (project_id);
create index if not exists project_fields_creator_idx ON public.project_fields USING btree (creator_id);
create index if not exists project_fields_project_folder_idx ON public.project_fields USING btree (project_id, folder_id);
create index if not exists project_fields_project_status_idx ON public.project_fields USING btree (project_id, status);
create index if not exists project_fields_project_updated_idx ON public.project_fields USING btree (project_id, updated_at DESC);
create index if not exists project_field_attachments_field_idx ON public.project_field_attachments USING btree (field_id, created_at);
create index if not exists project_field_attachments_project_idx ON public.project_field_attachments USING btree (project_id, created_at DESC);
create index if not exists project_field_comments_field_idx ON public.project_field_comments USING btree (field_id, created_at);
create index if not exists project_field_comments_project_idx ON public.project_field_comments USING btree (project_id, created_at DESC);
create index if not exists project_field_requests_project_status_idx ON public.project_field_requests USING btree (project_id, status);
create index if not exists project_field_requests_requester_idx ON public.project_field_requests USING btree (requester_id, created_at DESC);
create index if not exists project_members_user_idx ON public.project_members USING btree (user_id);
create index if not exists project_tasks_assignee_idx ON public.project_tasks USING btree (project_id, assignee_id, status);
create index if not exists project_tasks_field_idx ON public.project_tasks USING btree (field_id, status);
create index if not exists project_tasks_project_status_order_idx ON public.project_tasks USING btree (project_id, status, sort_order, created_at);
create index if not exists project_notifications_project_idx ON public.project_notifications USING btree (project_id, recipient_id, created_at DESC);
create index if not exists project_notifications_recipient_created_idx ON public.project_notifications USING btree (recipient_id, created_at DESC);
create index if not exists project_notifications_task_idx ON public.project_notifications USING btree (task_id, recipient_id, created_at DESC);
create index if not exists project_task_attachments_project_idx ON public.project_task_attachments USING btree (project_id, created_at DESC);
create index if not exists project_task_attachments_task_idx ON public.project_task_attachments USING btree (task_id, created_at);
create index if not exists project_task_comments_project_idx ON public.project_task_comments USING btree (project_id, created_at DESC);
create index if not exists project_task_comments_task_idx ON public.project_task_comments USING btree (task_id, created_at);
create index if not exists record_shares_owner_created_idx ON public.record_shares USING btree (owner_id, created_at DESC);
create index if not exists record_shares_recipient_created_idx ON public.record_shares USING btree (recipient_id, created_at DESC);
create index if not exists share_notifications_recipient_created_idx ON public.share_notifications USING btree (recipient_id, created_at DESC);
create index if not exists smart_scan_cache_expiry_idx ON public.smart_scan_cache USING btree (expires_at);
create index if not exists timeline_events_owner_date_idx ON public.timeline_events USING btree (user_id, event_date DESC, created_at DESC);
create index if not exists timeline_events_record_idx ON public.timeline_events USING btree (record_id) WHERE (record_id IS NOT NULL);
create index if not exists timeline_event_links_record_idx ON public.timeline_event_links USING btree (record_id);
create index if not exists trash_file_releases_released_idx ON public.trash_file_releases USING btree (released_at);
create index if not exists trash_items_expiry_idx ON public.trash_items USING btree (expires_at) WHERE (status = 'active'::text);
create index if not exists trash_items_owner_status_expiry_idx ON public.trash_items USING btree (owner_id, status, expires_at);
create index if not exists user_connections_provider_status_idx ON public.user_connections USING btree (provider, status);
create index if not exists vault_shares_owner_created_idx ON public.vault_shares USING btree (owner_id, created_at DESC);
create index if not exists vault_shares_recipient_created_idx ON public.vault_shares USING btree (recipient_id, created_at DESC);
create index if not exists vault_share_comments_share_created_idx ON public.vault_share_comments USING btree (share_id, created_at);

-- -----------------------------------------------------------------------------
-- Functions & RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_email_verification(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer)
 RETURNS TABLE(outcome text, attempt_count integer, verified_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
revoke all on function public.complete_email_verification(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer) from public, anon, authenticated;
grant execute on function public.complete_email_verification(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer) to service_role;

CREATE OR REPLACE FUNCTION public.complete_password_recovery(p_user_id uuid, p_email text, p_candidate_hash text, p_new_password_hash text, p_now timestamp with time zone, p_max_attempts integer)
 RETURNS TABLE(outcome text, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
revoke all on function public.complete_password_recovery(p_user_id uuid, p_email text, p_candidate_hash text, p_new_password_hash text, p_now timestamp with time zone, p_max_attempts integer) from public, anon, authenticated;
grant execute on function public.complete_password_recovery(p_user_id uuid, p_email text, p_candidate_hash text, p_new_password_hash text, p_now timestamp with time zone, p_max_attempts integer) to service_role;

CREATE OR REPLACE FUNCTION public.complete_vault_recovery_code(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer)
 RETURNS TABLE(outcome text, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
revoke all on function public.complete_vault_recovery_code(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer) from public, anon, authenticated;
grant execute on function public.complete_vault_recovery_code(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer) to service_role;

CREATE OR REPLACE FUNCTION public.invalidate_email_verification_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update public.email_verification_codes
  set code_hash = '', expires_at = p_now, updated_at = p_now
  where user_id = p_user_id and code_hash = p_code_hash;
end;
$function$;
revoke all on function public.invalidate_email_verification_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone) from public, anon, authenticated;
grant execute on function public.invalidate_email_verification_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.invalidate_password_recovery_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update public.password_recovery_codes
  set code_hash = '',
      expires_at = p_now,
      attempt_count = 0,
      updated_at = p_now
  where user_id = p_user_id and code_hash = p_code_hash;
end;
$function$;
revoke all on function public.invalidate_password_recovery_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone) from public, anon, authenticated;
grant execute on function public.invalidate_password_recovery_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.invalidate_vault_recovery_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 update public.password_vault_recovery_codes set code_hash='',expires_at=p_now,attempt_count=0,updated_at=p_now where user_id=p_user_id and code_hash=p_code_hash;
$function$;
revoke all on function public.invalidate_vault_recovery_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone) from public, anon, authenticated;
grant execute on function public.invalidate_vault_recovery_code(p_user_id uuid, p_code_hash text, p_now timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_access(p_user uuid, p_project uuid, OUT is_owner boolean, OUT member_role text, OUT can_create boolean)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  select (p.owner_id = p_user) into is_owner from public.projects p where p.id = p_project;
  if not found then
    raise exception 'That project is not available.' using errcode = 'P0404';
  end if;
  member_role := null;
  can_create := false;
  if not is_owner then
    select m.role, m.can_create_fields into member_role, can_create
    from public.project_members m
    where m.project_id = p_project and m.user_id = p_user;
    if member_role is null then
      raise exception 'That project is not available.' using errcode = 'P0404';
    end if;
  end if;
end;
$function$;
revoke all on function public.persora__project_access(p_user uuid, p_project uuid, OUT is_owner boolean, OUT member_role text, OUT can_create boolean) from public, anon, authenticated;
grant execute on function public.persora__project_access(p_user uuid, p_project uuid, OUT is_owner boolean, OUT member_role text, OUT can_create boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_name(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(nullif(trim(p.full_name), ''), p.email, 'A member') from public.profiles p where p.id = p_user
$function$;
revoke all on function public.persora__project_name(p_user uuid) from public, anon, authenticated;
grant execute on function public.persora__project_name(p_user uuid) to service_role;

create or replace function public.persora__project_notify(
  p_recipient uuid,
  p_actor uuid,
  p_project uuid,
  p_field uuid,
  p_task uuid,
  p_kind text,
  p_title text,
  p_message text,
  p_event_key text,
  p_allow_removed boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean := true;
begin
  if p_recipient is null or p_project is null or p_recipient = p_actor then return; end if;
  if not p_allow_removed and not exists (
    select 1 from public.projects p
    where p.id = p_project and (p.owner_id = p_recipient or exists (
      select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_recipient
    ))
  ) then return; end if;
  select case p_kind
    when 'membership' then coalesce(n.membership, true)
    when 'access_removed' then coalesce(n.membership, true)
    when 'assignment' then coalesce(n.assignments, true)
    when 'request' then coalesce(n.requests, true)
    when 'task' then coalesce(n.subtasks, true)
    when 'comment' then coalesce(n.comments, true)
    when 'attachment' then coalesce(n.attachments, true)
    when 'deadline' then coalesce(n.deadlines, true)
    else coalesce(n.updates, true)
  end into v_enabled
  from (select 1) seed
  left join public.project_notification_preferences n on n.user_id = p_recipient;
  if not coalesce(v_enabled, true) then return; end if;
  insert into public.project_notifications (
    recipient_id, actor_id, project_id, field_id, task_id, kind, actor_name, title, message, event_key
  ) values (
    p_recipient, p_actor, p_project, p_field, p_task, p_kind,
    coalesce(nullif(public.persora__project_name(p_actor), ''), 'A project member'),
    left(coalesce(nullif(trim(p_title), ''), 'Project update'), 120),
    left(coalesce(nullif(trim(p_message), ''), 'There is a new project update.'), 500),
    left(p_event_key || ':' || p_recipient::text, 240)
  ) on conflict (event_key) do nothing;
  delete from public.project_notifications where recipient_id = p_recipient and created_at < now() - interval '180 days';
end;
$function$;
revoke all on function public.persora__project_notify(p_recipient uuid, p_actor uuid, p_project uuid, p_field uuid, p_task uuid, p_kind text, p_title text, p_message text, p_event_key text, p_allow_removed boolean) from public, anon, authenticated;
grant execute on function public.persora__project_notify(p_recipient uuid, p_actor uuid, p_project uuid, p_field uuid, p_task uuid, p_kind text, p_title text, p_message text, p_event_key text, p_allow_removed boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_activity_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_kind text;
  v_title text;
  v_field uuid;
  v_member record;
begin
  if new.action in ('member_added', 'member_updated', 'member_removed', 'member_left') then
    v_kind := 'membership'; v_title := 'Project membership changed';
  elsif new.action in ('project_updated', 'field_status_changed', 'field_created', 'field_updated', 'field_deleted') then
    v_kind := 'update'; v_title := 'Project work updated';
  else
    return new;
  end if;
  if new.action like 'field_%' then
    select f.id into v_field
    from public.project_fields f
    where f.project_id = new.project_id
      and f.title = case when position(' → ' in new.target) > 0 then left(new.target, position(' → ' in new.target) - 1) else new.target end
    order by f.updated_at desc limit 1;
  end if;
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union
    select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(
      v_member.user_id, new.actor_id, new.project_id, v_field, null, v_kind, v_title,
      case when new.action like 'member_%' then 'A project membership or role changed.'
           else 'A project field or setting was updated.' end,
      'activity:' || new.id::text
    );
  end loop;
  return new;
end;
$function$;
revoke all on function public.persora__project_activity_notify() from public, anon, authenticated;
grant execute on function public.persora__project_activity_notify() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_attachment_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_member record;
begin
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(v_member.user_id, new.uploader_id, new.project_id, new.field_id, null, 'attachment', 'Field attachment added', 'A private attachment was added to a project field.', 'attachment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
revoke all on function public.persora__project_attachment_notify() from public, anon, authenticated;
grant execute on function public.persora__project_attachment_notify() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_can_edit_field(p_user uuid, p_field uuid)
 RETURNS project_fields
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_field public.project_fields; v_access record;
begin
  select * into v_field from public.project_fields f where f.id = p_field;
  if not found then raise exception 'That field is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can change its subtasks or attachments.' using errcode = 'P0403';
  end if;
  return v_field;
end;
$function$;
revoke all on function public.persora__project_can_edit_field(p_user uuid, p_field uuid) from public, anon, authenticated;
grant execute on function public.persora__project_can_edit_field(p_user uuid, p_field uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_can_manage_task(p_user uuid, p_task uuid)
 RETURNS project_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_access record;
begin
  select * into v_task from public.project_tasks t where t.id = p_task for update;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_field from public.project_fields f
  where f.id = v_task.field_id and f.project_id = v_task.project_id;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  if not (v_access.is_owner or v_field.assignee_id = p_user) then
    raise exception 'Only the project owner or the assignee of this field can manage its tasks.' using errcode = 'P0403';
  end if;
  return v_task;
end;
$function$;
revoke all on function public.persora__project_can_manage_task(p_user uuid, p_task uuid) from public, anon, authenticated;
grant execute on function public.persora__project_can_manage_task(p_user uuid, p_task uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_comment_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_member record; v_title text;
begin
  select f.title into v_title from public.project_fields f where f.id = new.field_id;
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(v_member.user_id, new.author_id, new.project_id, new.field_id, null, 'comment', 'New field comment', 'A member commented on a project field.', 'comment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
revoke all on function public.persora__project_comment_notify() from public, anon, authenticated;
grant execute on function public.persora__project_comment_notify() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_field_task_progress(p_field uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(
    round(100.0 * count(*) filter (where t.status = 'complete') / nullif(count(*), 0))::integer,
    0
  )
  from public.project_tasks t
  where t.field_id = p_field
$function$;
revoke all on function public.persora__project_field_task_progress(p_field uuid) from public, anon, authenticated;
grant execute on function public.persora__project_field_task_progress(p_field uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_field_apply(p_field project_fields, p_project uuid, p_payload jsonb)
 RETURNS project_fields
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_folder uuid;
  v_assignee uuid;
  v_status text;
  v_due date;
begin
  v_folder := case when p_payload ? 'folder_id' then nullif(p_payload->>'folder_id', '')::uuid else p_field.folder_id end;
  v_assignee := case when p_payload ? 'assignee_id' then nullif(p_payload->>'assignee_id', '')::uuid else p_field.assignee_id end;
  v_due := case when p_payload ? 'due_date' then nullif(p_payload->>'due_date', '')::date else p_field.due_date end;
  if v_folder is not null and not exists (
    select 1 from public.project_folders fo where fo.id = v_folder and fo.project_id = p_project
  ) then
    raise exception 'Choose a folder from this project.' using errcode = 'P0400';
  end if;
  if v_assignee is not null and not exists (
    select 1 from public.projects p
    left join public.project_members m on m.project_id = p.id and m.user_id = v_assignee
    where p.id = p_project and (p.owner_id = v_assignee or m.user_id is not null)
  ) then
    raise exception 'Assign team work to a member of this project.' using errcode = 'P0400';
  end if;
  v_status := coalesce(nullif(p_payload->>'status', ''), p_field.status, 'planning');
  if v_status not in ('planning', 'in-progress', 'in-review', 'blocked', 'completed') then
    raise exception 'Choose a valid field status.' using errcode = 'P0400';
  end if;
  p_field.title := coalesce(nullif(trim(p_payload->>'title'), ''), p_field.title);
  p_field.description := coalesce(p_payload->>'description', p_field.description, '');
  p_field.folder_id := v_folder;
  p_field.status := v_status;
  p_field.progress := public.persora__project_field_task_progress(p_field.id);
  p_field.assignee_id := v_assignee;
  p_field.due_date := v_due;
  return p_field;
end;
$function$;
revoke all on function public.persora__project_field_apply(p_field project_fields, p_project uuid, p_payload jsonb) from public, anon, authenticated;
grant execute on function public.persora__project_field_apply(p_field project_fields, p_project uuid, p_payload jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_field_assignment_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    perform public.persora__project_notify(new.assignee_id, coalesce(new.updated_by, new.creator_id), new.project_id, new.id, null, 'assignment', 'Field assigned to you', 'You have been assigned a project field.', 'field-assignment:' || new.id::text || ':' || new.updated_at::text);
  elsif new.assignee_id is distinct from old.assignee_id then
    perform public.persora__project_notify(new.assignee_id, coalesce(new.updated_by, new.creator_id), new.project_id, new.id, null, 'assignment', 'Field assigned to you', 'You have been assigned a project field.', 'field-assignment:' || new.id::text || ':' || new.updated_at::text);
    if old.assignee_id is not null then
      perform public.persora__project_notify(old.assignee_id, coalesce(new.updated_by, new.creator_id), new.project_id, new.id, null, 'assignment', 'Field assignment changed', 'A project field assignment has changed.', 'field-unassignment:' || new.id::text || ':' || new.updated_at::text);
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.persora__project_field_assignment_notify() from public, anon, authenticated;
grant execute on function public.persora__project_field_assignment_notify() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_log(p_project uuid, p_actor uuid, p_action text, p_target text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  insert into public.project_activity (project_id, actor_id, actor_name, action, target)
  values (p_project, p_actor, public.persora__project_name(p_actor), p_action, coalesce(p_target, ''));
  -- Keep the feed bounded: retain at most ~120 days of activity per project.
  delete from public.project_activity where project_id = p_project and created_at < now() - interval '120 days';
end;
$function$;
revoke all on function public.persora__project_log(p_project uuid, p_actor uuid, p_action text, p_target text) from public, anon, authenticated;
grant execute on function public.persora__project_log(p_project uuid, p_actor uuid, p_action text, p_target text) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_notification_preferences_save(p_user uuid, p_preferences jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_saved public.project_notification_preferences;
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  insert into public.project_notification_preferences(user_id, membership, assignments, requests, subtasks, comments, attachments, deadlines, updates, updated_at)
  values (
    p_user,
    coalesce((p_preferences->>'membership')::boolean, true),
    coalesce((p_preferences->>'assignments')::boolean, true),
    coalesce((p_preferences->>'requests')::boolean, true),
    coalesce((p_preferences->>'subtasks')::boolean, true),
    coalesce((p_preferences->>'comments')::boolean, true),
    coalesce((p_preferences->>'attachments')::boolean, true),
    coalesce((p_preferences->>'deadlines')::boolean, true),
    coalesce((p_preferences->>'updates')::boolean, true), now()
  ) on conflict (user_id) do update set
    membership = excluded.membership, assignments = excluded.assignments, requests = excluded.requests,
    subtasks = excluded.subtasks, comments = excluded.comments, attachments = excluded.attachments,
    deadlines = excluded.deadlines, updates = excluded.updates, updated_at = now()
  returning * into v_saved;
  return to_jsonb(v_saved);
end;
$function$;
revoke all on function public.persora__project_notification_preferences_save(p_user uuid, p_preferences jsonb) from public, anon, authenticated;
grant execute on function public.persora__project_notification_preferences_save(p_user uuid, p_preferences jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_notifications_mark_read(p_user uuid, p_notification uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  if p_notification is null then
    update public.project_notifications set read_at = coalesce(read_at, now()) where recipient_id = p_user and read_at is null;
  else
    update public.project_notifications set read_at = coalesce(read_at, now()) where id = p_notification and recipient_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora__project_notifications_mark_read(p_user uuid, p_notification uuid) from public, anon, authenticated;
grant execute on function public.persora__project_notifications_mark_read(p_user uuid, p_notification uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_overdue_notifications(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_field record; v_recipient uuid;
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  for v_field in
    select f.id, f.project_id, f.creator_id, f.assignee_id, f.due_date, f.title, p.owner_id
    from public.project_fields f join public.projects p on p.id = f.project_id
    where f.status <> 'completed' and f.due_date < current_date
      and (p.owner_id = p_user or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_user))
  loop
    for v_recipient in
      select distinct recipients.user_id from unnest(array[v_field.owner_id, v_field.creator_id, v_field.assignee_id]) as recipients(user_id)
      where recipients.user_id is not null
    loop
      perform public.persora__project_notify(v_recipient, null, v_field.project_id, v_field.id, null, 'deadline', 'Project field overdue', 'A project field has passed its due date.', 'overdue:' || v_field.id::text || ':' || v_field.due_date::text);
    end loop;
  end loop;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora__project_overdue_notifications(p_user uuid) from public, anon, authenticated;
grant execute on function public.persora__project_overdue_notifications(p_user uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_queue_attachment_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  insert into public.project_attachment_cleanup(file_key, owner_id)
  values (old.file_key, old.owner_id)
  on conflict (file_key) do update set queued_at = now();
  return old;
end;
$function$;
revoke all on function public.persora__project_queue_attachment_cleanup() from public, anon, authenticated;
grant execute on function public.persora__project_queue_attachment_cleanup() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_request_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      select p.owner_id into v_owner from public.projects p where p.id = new.project_id;
      perform public.persora__project_notify(v_owner, new.requester_id, new.project_id, null, null, 'request', 'Field request received', 'A project member requested permission to add a field.', 'request-created:' || new.id::text);
    end if;
  elsif old.status is distinct from new.status and new.status in ('approved', 'rejected') then
    perform public.persora__project_notify(new.requester_id, new.resolved_by, new.project_id, new.field_id, null, 'request', case when new.status = 'approved' then 'Field request approved' else 'Field request declined' end, case when new.status = 'approved' then 'Your request to add a project field was approved.' else 'Your request to add a project field was declined.' end, 'request-resolved:' || new.id::text || ':' || new.status);
  end if;
  return new;
end;
$function$;
revoke all on function public.persora__project_request_notify() from public, anon, authenticated;
grant execute on function public.persora__project_request_notify() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_task_progress_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.project_fields f
    set progress = public.persora__project_field_task_progress(old.field_id)
    where f.id = old.field_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.project_fields f
    set progress = public.persora__project_field_task_progress(new.field_id)
    where f.id = new.field_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.persora__project_task_progress_sync() from public, anon, authenticated;
grant execute on function public.persora__project_task_progress_sync() to service_role;

CREATE OR REPLACE FUNCTION public.persora__project_validate_task_assignee(p_project uuid, p_assignee uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if p_assignee is not null and not exists (
    select 1 from public.projects p
    left join public.project_members m on m.project_id = p.id and m.user_id = p_assignee
    where p.id = p_project and (p.owner_id = p_assignee or m.user_id is not null)
  ) then
    raise exception 'Assign the task to a member of this project.' using errcode = 'P0400';
  end if;
end;
$function$;
revoke all on function public.persora__project_validate_task_assignee(p_project uuid, p_assignee uuid) from public, anon, authenticated;
grant execute on function public.persora__project_validate_task_assignee(p_project uuid, p_assignee uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_claim_reminders(p_limit integer DEFAULT 50, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  with due as (
    select r.id from public.calendar_reminders r
    where (p_owner is null or r.user_id = p_owner)
      and ((r.status = 'scheduled' and r.remind_at <= v_now)
        or (r.status = 'processing' and r.claimed_at < v_now - interval '5 minutes'))
    order by r.remind_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of r skip locked
  ), claimed as (
    update public.calendar_reminders r set
      email_status = case
        when r.status = 'processing' and r.email_status = 'sending' then 'failed'
        when r.email_requested and r.email_status = 'not_requested' then 'sending'
        else r.email_status end,
      email_note = case when r.status = 'processing' and r.email_status = 'sending' then 'Delivery was interrupted; not retried to avoid a duplicate email.' else r.email_note end,
      status = 'processing', claimed_at = v_now, attempts = r.attempts + 1
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder', to_jsonb(c),
    'event', to_jsonb(e),
    'owner', jsonb_build_object('email', p.email, 'full_name', p.full_name, 'timezone', p.timezone,
      'email_verified', p.email_verified_at is not null, 'active', p.account_status = 'active')
  )), '[]'::jsonb) into v_rows
  from claimed c
  join public.calendar_events e on e.id = c.event_id
  join public.profiles p on p.id = c.user_id;
  return v_rows;
end;
$function$;
revoke all on function public.persora_calendar_claim_reminders(p_limit integer, p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_calendar_claim_reminders(p_limit integer, p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_set_reminder(p_owner uuid, p_event_id uuid, p_root_id uuid, p_reminder jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update public.calendar_reminders set status = 'cancelled'
  where event_id = p_event_id and user_id = p_owner and status = 'scheduled';
  if p_reminder is null or jsonb_typeof(p_reminder) <> 'object' then
    return;
  end if;
  insert into public.calendar_reminders (
    user_id, event_id, root_id, occurrence_key, occurrence_start, occurrence_date, all_day, remind_at,
    minutes_before, title, location, email_requested, email_status, dedupe_key
  ) values (
    p_owner, p_event_id, p_root_id, p_reminder ->> 'occurrence_key',
    nullif(p_reminder ->> 'occurrence_start', '')::timestamptz, nullif(p_reminder ->> 'occurrence_date', '')::date,
    coalesce((p_reminder ->> 'all_day')::boolean, false), (p_reminder ->> 'remind_at')::timestamptz,
    (p_reminder ->> 'minutes_before')::integer, p_reminder ->> 'title', coalesce(p_reminder ->> 'location', ''),
    coalesce((p_reminder ->> 'email')::boolean, false), 'not_requested', p_reminder ->> 'dedupe_key'
  )
  on conflict (dedupe_key) do update
    set status = 'scheduled', event_id = excluded.event_id, title = excluded.title, location = excluded.location,
        email_requested = excluded.email_requested, minutes_before = excluded.minutes_before, claimed_at = null
    where calendar_reminders.status = 'cancelled' and calendar_reminders.user_id = p_owner;
exception
  when unique_violation then
    -- Another pending reminder for this event appeared concurrently; keep it.
    null;
end;
$function$;
revoke all on function public.persora_calendar_set_reminder(p_owner uuid, p_event_id uuid, p_root_id uuid, p_reminder jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_set_reminder(p_owner uuid, p_event_id uuid, p_root_id uuid, p_reminder jsonb) from service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_email_status text, p_email_note text, p_event_revision integer, p_next jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_reminder public.calendar_reminders%rowtype;
begin
  if p_email_status not in ('not_requested', 'sent', 'failed', 'skipped') then
    raise exception 'Unknown email status.' using errcode = 'P0400';
  end if;
  update public.calendar_reminders set
    status = 'sent', processed_at = clock_timestamp(),
    email_status = case when email_status = 'failed' then 'failed' else p_email_status end,
    email_note = coalesce(left(p_email_note, 200), email_note)
  where id = p_id and status = 'processing' and claimed_at = p_claimed_at
  returning * into v_reminder;
  if not found then
    return false;
  end if;
  if p_next is not null and jsonb_typeof(p_next) = 'object' and exists (
    select 1 from public.calendar_events where id = v_reminder.event_id and revision = p_event_revision
  ) and not exists (
    select 1 from public.calendar_reminders where event_id = v_reminder.event_id and status = 'scheduled'
  ) then
    perform public.persora_calendar_set_reminder(v_reminder.user_id, v_reminder.event_id, v_reminder.root_id, p_next);
  end if;
  return true;
end;
$function$;
revoke all on function public.persora_calendar_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_email_status text, p_email_note text, p_event_revision integer, p_next jsonb) from public, anon, authenticated;
grant execute on function public.persora_calendar_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_email_status text, p_email_note text, p_event_revision integer, p_next jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_delete_event(p_owner uuid, p_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.calendar_events%rowtype;
begin
  select * into v_row from public.calendar_events where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That event is no longer in your calendar.' using errcode = 'P0404';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_row.revision then
    raise exception 'This event was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
  end if;
  delete from public.calendar_events where id = p_id and user_id = p_owner;
  return jsonb_build_object('ok', true, 'id', p_id, 'seriesId', v_row.series_id);
end;
$function$;
revoke all on function public.persora_calendar_delete_event(p_owner uuid, p_id uuid, p_expected_revision integer) from public, anon, authenticated;
grant execute on function public.persora_calendar_delete_event(p_owner uuid, p_id uuid, p_expected_revision integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_dispatch_ping()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_url text;
  v_token text;
begin
  if not exists (
    select 1 from public.calendar_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) and not exists (
    select 1 from public.habit_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) and not exists (
    select 1 from public.loan_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) then
    return 'idle';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'pg_net unavailable';
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_url using 'persora_calendar_dispatch_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_token using 'persora_calendar_dispatch_token';
  exception when others then
    return 'vault unavailable';
  end;
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then
    return 'not configured';
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 15000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-persora-cron-token', v_token);
  return 'requested';
end;
$function$;
revoke all on function public.persora_calendar_dispatch_ping() from public, anon, authenticated;
grant execute on function public.persora_calendar_dispatch_ping() to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_event_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.series_id is not null and not exists (
    select 1 from public.calendar_events master
    where master.id = new.series_id and master.user_id = new.user_id and master.recurrence_freq is not null
  ) then
    raise exception 'That recurring event is not available in your calendar.' using errcode = 'P0404';
  end if;
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function public.persora_calendar_event_guard() from public, anon, authenticated;
revoke all on function public.persora_calendar_event_guard() from service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_event_values(p_event jsonb)
 RETURNS calendar_events
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.calendar_events%rowtype;
begin
  v.title := btrim(p_event ->> 'title');
  v.description := coalesce(p_event ->> 'description', '');
  v.location := coalesce(p_event ->> 'location', '');
  v.category := nullif(p_event ->> 'category', '');
  v.all_day := coalesce((p_event ->> 'all_day')::boolean, false);
  v.time_zone := p_event ->> 'time_zone';
  v.start_at := nullif(p_event ->> 'start_at', '')::timestamptz;
  v.end_at := nullif(p_event ->> 'end_at', '')::timestamptz;
  v.start_date := nullif(p_event ->> 'start_date', '')::date;
  v.end_date := nullif(p_event ->> 'end_date', '')::date;
  v.recurrence_freq := nullif(p_event ->> 'recurrence_freq', '');
  v.recurrence_interval := coalesce(nullif(p_event ->> 'recurrence_interval', '')::smallint, 1);
  v.recurrence_until := nullif(p_event ->> 'recurrence_until', '')::date;
  v.recurrence_count := nullif(p_event ->> 'recurrence_count', '')::integer;
  v.reminder_minutes := nullif(p_event ->> 'reminder_minutes', '')::integer;
  v.reminder_email := coalesce((p_event ->> 'reminder_email')::boolean, false);
  v.item_type := coalesce(nullif(p_event ->> 'item_type', ''), 'event');
  return v;
end;
$function$;
revoke all on function public.persora_calendar_event_values(p_event jsonb) from public, anon, authenticated;
revoke all on function public.persora_calendar_event_values(p_event jsonb) from service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_events_in_range(p_owner uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_from_date date, p_to_date date)
 RETURNS SETOF calendar_events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with masters as (
    select * from public.calendar_events
    where user_id = p_owner and recurrence_freq is not null
      and ((all_day and start_date < p_to_date) or (not all_day and start_at < p_to))
      and (recurrence_until is null or recurrence_until >= (case when all_day then p_from_date - 367 else p_from_date - 33 end))
  )
  select * from masters
  union all
  select * from public.calendar_events e
  where e.user_id = p_owner and e.recurrence_freq is null and e.status = 'confirmed'
    and (
      (not e.all_day and e.start_at < p_to and e.end_at > p_from and e.start_at > p_from - interval '32 days')
      or (e.all_day and e.start_date < p_to_date and e.end_date > p_from_date and e.start_date > p_from_date - 367)
    )
  union all
  select * from public.calendar_events x
  where x.user_id = p_owner and x.series_id in (select id from masters)
    and (x.original_start_at between p_from - interval '32 days' and p_to or x.original_start_date between p_from_date - 367 and p_to_date)
    and not (x.status = 'confirmed' and (
      (not x.all_day and x.start_at < p_to and x.end_at > p_from and x.start_at > p_from - interval '32 days')
      or (x.all_day and x.start_date < p_to_date and x.end_date > p_from_date and x.start_date > p_from_date - 367)))
  limit 5000;
$function$;
revoke all on function public.persora_calendar_events_in_range(p_owner uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_from_date date, p_to_date date) from public, anon, authenticated;
grant execute on function public.persora_calendar_events_in_range(p_owner uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_from_date date, p_to_date date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_save_event(p_owner uuid, p_id uuid, p_event jsonb, p_expected_revision integer, p_reset_exceptions boolean, p_reminder jsonb, p_exception_patches jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.calendar_events%rowtype := public.persora_calendar_event_values(p_event);
  v_existing public.calendar_events%rowtype;
  v_row public.calendar_events%rowtype;
  v_patch jsonb;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.calendar_events where id = p_id for update;
  if found and v_existing.user_id <> p_owner then
    raise exception 'That event is not available in your calendar.' using errcode = 'P0404';
  end if;

  if not found then
    if p_expected_revision is not null then
      raise exception 'That event was deleted. Create it again if you still need it.' using errcode = 'P0404';
    end if;
    insert into public.calendar_events (
      id, user_id, item_type, title, description, location, category, all_day, time_zone, start_at, end_at, start_date, end_date,
      recurrence_freq, recurrence_interval, recurrence_until, recurrence_count, reminder_minutes, reminder_email
    ) values (
      p_id, p_owner, v.item_type, v.title, v.description, v.location, v.category, v.all_day, v.time_zone, v.start_at, v.end_at, v.start_date, v.end_date,
      v.recurrence_freq, v.recurrence_interval, v.recurrence_until, v.recurrence_count, v.reminder_minutes, v.reminder_email
    ) returning * into v_row;
  else
    if v_existing.series_id is not null then
      raise exception 'Edit this occurrence as part of its recurring event.' using errcode = 'P0400';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      raise exception 'This event was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
    end if;
    if p_reset_exceptions then
      delete from public.calendar_events where series_id = p_id and user_id = p_owner;
    end if;
    update public.calendar_events set
      title = v.title, description = v.description, location = v.location, category = v.category, all_day = v.all_day,
      time_zone = v.time_zone, start_at = v.start_at, end_at = v.end_at, start_date = v.start_date, end_date = v.end_date,
      recurrence_freq = v.recurrence_freq, recurrence_interval = v.recurrence_interval, recurrence_until = v.recurrence_until,
      recurrence_count = v.recurrence_count, reminder_minutes = v.reminder_minutes, reminder_email = v.reminder_email
    where id = p_id and user_id = p_owner
    returning * into v_row;

    if not p_reset_exceptions and v_row.recurrence_freq is not null then
      for v_patch in select * from jsonb_array_elements(coalesce(p_exception_patches, '[]'::jsonb)) loop
        update public.calendar_events set
          title = coalesce(nullif(btrim(v_patch ->> 'title'), ''), title),
          description = coalesce(v_patch ->> 'description', description),
          location = coalesce(v_patch ->> 'location', location),
          category = case when v_patch ? 'category' then nullif(v_patch ->> 'category', '') else category end,
          reminder_minutes = case when v_patch ? 'reminder_minutes' then nullif(v_patch ->> 'reminder_minutes', '')::integer else reminder_minutes end,
          reminder_email = coalesce((v_patch ->> 'reminder_email')::boolean, reminder_email)
        where id = (v_patch ->> 'id')::uuid and series_id = p_id and user_id = p_owner;
        if found and v_patch ? 'reminder' then
          perform public.persora_calendar_set_reminder(p_owner, (v_patch ->> 'id')::uuid, p_id, v_patch -> 'reminder');
        end if;
      end loop;
    end if;
  end if;

  perform public.persora_calendar_set_reminder(p_owner, v_row.id, v_row.id, case when v_row.completed_at is not null then null else p_reminder end);
  return jsonb_build_object(
    'event', to_jsonb(v_row),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(x)) from public.calendar_events x where x.series_id = v_row.id and x.user_id = p_owner), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_calendar_save_event(p_owner uuid, p_id uuid, p_event jsonb, p_expected_revision integer, p_reset_exceptions boolean, p_reminder jsonb, p_exception_patches jsonb) from public, anon, authenticated;
grant execute on function public.persora_calendar_save_event(p_owner uuid, p_id uuid, p_event jsonb, p_expected_revision integer, p_reset_exceptions boolean, p_reminder jsonb, p_exception_patches jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_save_occurrence(p_owner uuid, p_series_id uuid, p_exception_id uuid, p_original_start_at timestamp with time zone, p_original_start_date date, p_status text, p_event jsonb, p_expected_revision integer, p_reminder jsonb, p_series_reminder jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.calendar_events%rowtype := public.persora_calendar_event_values(p_event);
  v_master public.calendar_events%rowtype;
  v_existing public.calendar_events%rowtype;
  v_row public.calendar_events%rowtype;
begin
  if p_status not in ('confirmed', 'cancelled') then
    raise exception 'Unknown occurrence status.' using errcode = 'P0400';
  end if;
  select * into v_master from public.calendar_events
  where id = p_series_id and user_id = p_owner and recurrence_freq is not null for update;
  if not found then
    raise exception 'That recurring event is not available in your calendar.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.calendar_events
  where series_id = p_series_id and user_id = p_owner
    and ((p_original_start_at is not null and original_start_at = p_original_start_at)
      or (p_original_start_date is not null and original_start_date = p_original_start_date))
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> v_existing.revision then
      raise exception 'This event was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
    end if;
    update public.calendar_events set
      status = p_status, item_type = v_master.item_type, title = v.title, description = v.description, location = v.location, category = v.category,
      all_day = v.all_day, time_zone = v.time_zone, start_at = v.start_at, end_at = v.end_at, start_date = v.start_date,
      end_date = v.end_date, reminder_minutes = v.reminder_minutes, reminder_email = v.reminder_email
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.calendar_events (
      id, user_id, series_id, item_type, original_start_at, original_start_date, status, title, description, location, category,
      all_day, time_zone, start_at, end_at, start_date, end_date, reminder_minutes, reminder_email
    ) values (
      coalesce(p_exception_id, gen_random_uuid()), p_owner, p_series_id, v_master.item_type, p_original_start_at, p_original_start_date, p_status,
      v.title, v.description, v.location, v.category, v.all_day, v.time_zone, v.start_at, v.end_at, v.start_date, v.end_date,
      v.reminder_minutes, v.reminder_email
    ) returning * into v_row;
  end if;

  perform public.persora_calendar_set_reminder(p_owner, v_row.id, p_series_id, case when p_status = 'cancelled' then null else p_reminder end);
  perform public.persora_calendar_set_reminder(p_owner, p_series_id, p_series_id, p_series_reminder);
  return jsonb_build_object('event', to_jsonb(v_row), 'series', to_jsonb(v_master));
end;
$function$;
revoke all on function public.persora_calendar_save_occurrence(p_owner uuid, p_series_id uuid, p_exception_id uuid, p_original_start_at timestamp with time zone, p_original_start_date date, p_status text, p_event jsonb, p_expected_revision integer, p_reminder jsonb, p_series_reminder jsonb) from public, anon, authenticated;
grant execute on function public.persora_calendar_save_occurrence(p_owner uuid, p_series_id uuid, p_exception_id uuid, p_original_start_at timestamp with time zone, p_original_start_date date, p_status text, p_event jsonb, p_expected_revision integer, p_reminder jsonb, p_series_reminder jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_search(p_owner uuid, p_query text, p_limit integer DEFAULT 30)
 RETURNS SETOF calendar_events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with q as (
    select lower(btrim(coalesce(p_query, ''))) as term
  ), escaped as (
    select term, replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') as esc from q
  )
  select e.* from public.calendar_events e, escaped
  where e.user_id = p_owner and e.status = 'confirmed' and char_length(escaped.term) between 1 and 100
    and lower(e.title) like '%' || escaped.esc || '%'
  order by (lower(e.title) like escaped.esc || '%') desc,
    coalesce(e.start_at, e.start_date::timestamptz) desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$function$;
revoke all on function public.persora_calendar_search(p_owner uuid, p_query text, p_limit integer) from public, anon, authenticated;
grant execute on function public.persora_calendar_search(p_owner uuid, p_query text, p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_calendar_set_task_completion(p_owner uuid, p_id uuid, p_completed boolean, p_expected_revision integer, p_reminder jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.calendar_events%rowtype;
begin
  select * into v_row from public.calendar_events where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That task is no longer in your calendar.' using errcode = 'P0404';
  end if;
  if v_row.item_type <> 'task' then
    raise exception 'Only tasks can be marked complete.' using errcode = 'P0400';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_row.revision then
    raise exception 'This task was changed somewhere else. Reload the calendar and try again.' using errcode = 'P0409';
  end if;
  update public.calendar_events
    set completed_at = case when p_completed then coalesce(completed_at, clock_timestamp()) else null end
  where id = p_id and user_id = p_owner
  returning * into v_row;
  perform public.persora_calendar_set_reminder(p_owner, v_row.id, v_row.id, case when p_completed then null else p_reminder end);
  return jsonb_build_object('event', to_jsonb(v_row));
end;
$function$;
revoke all on function public.persora_calendar_set_task_completion(p_owner uuid, p_id uuid, p_completed boolean, p_expected_revision integer, p_reminder jsonb) from public, anon, authenticated;
grant execute on function public.persora_calendar_set_task_completion(p_owner uuid, p_id uuid, p_completed boolean, p_expected_revision integer, p_reminder jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_claim_first_admin(target_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_initialized_at timestamptz;
begin
  select initialized_at into v_initialized_at from public.admin_bootstrap_state where id = true for update;
  if not found or v_initialized_at is not null then return false; end if;
  update public.profiles set role = 'admin' where id = target_user_id and account_status = 'active';
  if not found then return false; end if;
  update public.admin_bootstrap_state set initialized_at = now(), initialized_by = target_user_id where id = true;
  return true;
end;
$function$;
revoke all on function public.persora_claim_first_admin(target_user_id uuid) from public, anon, authenticated;
grant execute on function public.persora_claim_first_admin(target_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_apply(p_target habits, p_values jsonb)
 RETURNS habits
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.habits := p_target;
begin
  v.name := btrim(p_values ->> 'name');
  v.description := coalesce(p_values ->> 'description', '');
  v.icon := coalesce(nullif(p_values ->> 'icon', ''), 'check');
  v.color := coalesce(nullif(p_values ->> 'color', ''), 'blue');
  v.category := nullif(p_values ->> 'category', '');
  v.frequency := p_values ->> 'frequency';
  v.weekday_mask := coalesce((p_values ->> 'weekday_mask')::smallint, 0);
  v.weekly_target := (p_values ->> 'weekly_target')::smallint;
  v.tracking := coalesce(p_values ->> 'tracking', 'check');
  v.target_value := (p_values ->> 'target_value')::numeric;
  v.unit := coalesce(p_values ->> 'unit', '');
  v.start_date := (p_values ->> 'start_date')::date;
  v.schedule_history := coalesce(p_values -> 'schedule_history', '[]'::jsonb);
  v.reminder_time := nullif(p_values ->> 'reminder_time', '')::time;
  v.reminder_email := coalesce((p_values ->> 'reminder_email')::boolean, false);
  return v;
end;
$function$;
revoke all on function public.persora_habit_apply(p_target habits, p_values jsonb) from public, anon, authenticated;
revoke all on function public.persora_habit_apply(p_target habits, p_values jsonb) from service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_checkin(p_owner uuid, p_habit uuid, p_date date, p_value numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_habit public.habits%rowtype;
  v_checkin public.habit_checkins%rowtype;
  v_value numeric;
  v_target numeric;
begin
  select * into v_habit from public.habits where id = p_habit and user_id = p_owner for share;
  if not found then
    raise exception 'This habit no longer exists.' using errcode = 'P0404';
  end if;
  if v_habit.archived_at is not null then
    raise exception 'Restore this habit to update its history.' using errcode = 'P0409';
  end if;
  if p_date is null or p_date < v_habit.start_date then
    raise exception 'That day is before the habit started.' using errcode = 'P0400';
  end if;
  if p_value is null or p_value <= 0 then
    delete from public.habit_checkins where habit_id = p_habit and user_id = p_owner and check_date = p_date;
  else
    if v_habit.tracking = 'check' then
      v_value := 1; v_target := null;
    else
      v_value := round(p_value, 2); v_target := v_habit.target_value;
    end if;
    insert into public.habit_checkins (user_id, habit_id, check_date, value, target_value, completed)
    values (p_owner, p_habit, p_date, v_value, v_target, v_target is null or v_value >= v_target)
    on conflict (habit_id, check_date) do update
      set value = excluded.value, target_value = excluded.target_value, completed = excluded.completed, updated_at = now()
    returning * into v_checkin;
  end if;
  return jsonb_build_object(
    'checkin', case when v_checkin.id is null then null else to_jsonb(v_checkin) end,
    'completed_dates', coalesce((
      select jsonb_agg(c.check_date order by c.check_date) from public.habit_checkins c
      where c.habit_id = p_habit and c.user_id = p_owner and c.completed
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_habit_checkin(p_owner uuid, p_habit uuid, p_date date, p_value numeric) from public, anon, authenticated;
grant execute on function public.persora_habit_checkin(p_owner uuid, p_habit uuid, p_date date, p_value numeric) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_claim_reminders(p_limit integer DEFAULT 50, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  with due as (
    select r.id from public.habit_reminders r
    where (p_owner is null or r.user_id = p_owner)
      and ((r.status = 'scheduled' and r.remind_at <= v_now)
        or (r.status = 'processing' and r.claimed_at < v_now - interval '5 minutes'))
    order by r.remind_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of r skip locked
  ), claimed as (
    update public.habit_reminders r set
      email_status = case
        when r.status = 'processing' and r.email_status = 'sending' then 'failed'
        when r.email_requested and r.email_status = 'not_requested' then 'sending'
        else r.email_status end,
      email_note = case when r.status = 'processing' and r.email_status = 'sending' then 'Delivery was interrupted; not retried to avoid a duplicate email.' else r.email_note end,
      status = 'processing', claimed_at = v_now, attempts = r.attempts + 1
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder', to_jsonb(c),
    'habit', to_jsonb(h),
    'owner', jsonb_build_object('email', p.email, 'full_name', p.full_name, 'timezone', p.timezone,
      'email_verified', p.email_verified_at is not null, 'active', p.account_status = 'active'),
    'day_done', exists (select 1 from public.habit_checkins k where k.habit_id = c.habit_id and k.check_date = c.local_date and k.completed),
    'week_done', (select count(*) from public.habit_checkins k
      where k.habit_id = c.habit_id and k.completed and k.check_date between greatest(c.week_start, h.start_date) and c.week_start + 6)
  )), '[]'::jsonb) into v_rows
  from claimed c
  join public.habits h on h.id = c.habit_id
  join public.profiles p on p.id = c.user_id;
  return v_rows;
end;
$function$;
revoke all on function public.persora_habit_claim_reminders(p_limit integer, p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_habit_claim_reminders(p_limit integer, p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_set_reminder(p_owner uuid, p_habit uuid, p_candidates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_candidate jsonb;
  v_key text;
  v_id uuid;
begin
  update public.habit_reminders set status = 'cancelled'
  where habit_id = p_habit and user_id = p_owner and status = 'scheduled';
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    return;
  end if;
  for v_candidate in select value from jsonb_array_elements(p_candidates) limit 5 loop
    v_key := 'habit:' || p_habit::text || ':' || ((v_candidate ->> 'local_date')::date)::text;
    if exists (select 1 from public.habit_reminders where dedupe_key = v_key and status <> 'cancelled') then
      continue;
    end if;
    v_id := null;
    insert into public.habit_reminders (
      user_id, habit_id, local_date, week_start, remind_at, time_zone, habit_name, email_requested, dedupe_key
    ) values (
      p_owner, p_habit, (v_candidate ->> 'local_date')::date, (v_candidate ->> 'week_start')::date,
      (v_candidate ->> 'remind_at')::timestamptz, v_candidate ->> 'time_zone', left(v_candidate ->> 'habit_name', 80),
      coalesce((v_candidate ->> 'email')::boolean, false), v_key
    )
    on conflict (dedupe_key) do update
      set status = 'scheduled', remind_at = excluded.remind_at, week_start = excluded.week_start, time_zone = excluded.time_zone,
          habit_name = excluded.habit_name, email_requested = excluded.email_requested, email_status = 'not_requested',
          email_note = null, claimed_at = null, read_at = null
      where habit_reminders.status = 'cancelled' and habit_reminders.user_id = p_owner
    returning id into v_id;
    if v_id is not null then
      return;
    end if;
  end loop;
exception
  when unique_violation then
    -- Another pending reminder for this habit appeared concurrently; keep it.
    null;
end;
$function$;
revoke all on function public.persora_habit_set_reminder(p_owner uuid, p_habit uuid, p_candidates jsonb) from public, anon, authenticated;
revoke all on function public.persora_habit_set_reminder(p_owner uuid, p_habit uuid, p_candidates jsonb) from service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_delivered boolean, p_email_status text, p_note text, p_habit_revision integer, p_next jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_reminder public.habit_reminders%rowtype;
begin
  if p_email_status not in ('not_requested', 'sent', 'failed', 'skipped') then
    raise exception 'Unknown email status.' using errcode = 'P0400';
  end if;
  update public.habit_reminders set
    status = case when p_delivered then 'sent' else 'skipped' end,
    processed_at = clock_timestamp(),
    email_status = case when email_status = 'failed' then 'failed' else p_email_status end,
    email_note = coalesce(left(p_note, 200), email_note)
  where id = p_id and status = 'processing' and claimed_at = p_claimed_at
  returning * into v_reminder;
  if not found then
    return false;
  end if;
  if p_next is not null and jsonb_typeof(p_next) = 'array' and exists (
    select 1 from public.habits where id = v_reminder.habit_id and revision = p_habit_revision and archived_at is null and reminder_time is not null
  ) and not exists (
    select 1 from public.habit_reminders where habit_id = v_reminder.habit_id and status = 'scheduled'
  ) then
    perform public.persora_habit_set_reminder(v_reminder.user_id, v_reminder.habit_id, p_next);
  end if;
  return true;
end;
$function$;
revoke all on function public.persora_habit_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_delivered boolean, p_email_status text, p_note text, p_habit_revision integer, p_next jsonb) from public, anon, authenticated;
grant execute on function public.persora_habit_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_delivered boolean, p_email_status text, p_note text, p_habit_revision integer, p_next jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_delete(p_owner uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  delete from public.habits where id = p_id and user_id = p_owner;
  if not found then
    raise exception 'This habit no longer exists.' using errcode = 'P0404';
  end if;
  return true;
end;
$function$;
revoke all on function public.persora_habit_delete(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_habit_delete(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_get(p_owner uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select to_jsonb(h) from public.habits h where h.id = p_id and h.user_id = p_owner;
$function$;
revoke all on function public.persora_habit_get(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_habit_get(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_reminders_mark_read(p_owner uuid, p_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  update public.habit_reminders set read_at = clock_timestamp()
  where user_id = p_owner and read_at is null and status = 'sent' and (p_id is null or id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.persora_habit_reminders_mark_read(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_habit_reminders_mark_read(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_reminders_recent(p_owner uuid, p_since timestamp with time zone)
 RETURNS SETOF habit_reminders
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select * from public.habit_reminders
  where user_id = p_owner and status = 'sent' and remind_at >= p_since
  order by remind_at desc limit 40;
$function$;
revoke all on function public.persora_habit_reminders_recent(p_owner uuid, p_since timestamp with time zone) from public, anon, authenticated;
grant execute on function public.persora_habit_reminders_recent(p_owner uuid, p_since timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_reorder(p_owner uuid, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'Send up to 200 habits to reorder.' using errcode = 'P0400';
  end if;
  update public.habits h set position = o.ord::integer - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where h.id = o.id and h.user_id = p_owner;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.persora_habit_reorder(p_owner uuid, p_ids uuid[]) from public, anon, authenticated;
grant execute on function public.persora_habit_reorder(p_owner uuid, p_ids uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_reschedule(p_owner uuid, p_id uuid, p_reminders jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.habits%rowtype;
begin
  select * into v from public.habits where id = p_id and user_id = p_owner for update;
  if not found then
    return false;
  end if;
  perform public.persora_habit_set_reminder(p_owner, p_id, case when v.archived_at is null and v.reminder_time is not null then p_reminders else null end);
  return true;
end;
$function$;
revoke all on function public.persora_habit_reschedule(p_owner uuid, p_id uuid, p_reminders jsonb) from public, anon, authenticated;
grant execute on function public.persora_habit_reschedule(p_owner uuid, p_id uuid, p_reminders jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_save(p_owner uuid, p_id uuid, p_habit jsonb, p_expected_revision integer, p_reminders jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.habits%rowtype;
begin
  if p_owner is null or p_id is null or p_habit is null or jsonb_typeof(p_habit) <> 'object' then
    raise exception 'Send the habit details.' using errcode = 'P0400';
  end if;
  select * into v from public.habits where id = p_id and user_id = p_owner for update;
  if not found then
    if p_expected_revision is not null or exists (select 1 from public.habits where id = p_id) then
      raise exception 'This habit no longer exists.' using errcode = 'P0404';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('persora_habits:' || p_owner::text, 0));
    if (select count(*) from public.habits where user_id = p_owner) >= 100 then
      raise exception 'You can keep up to 100 habits. Delete an archived habit to add another.' using errcode = 'P0409';
    end if;
    v := public.persora_habit_apply(null::public.habits, p_habit);
    v.id := p_id;
    v.user_id := p_owner;
    v.position := coalesce((select max(position) + 1 from public.habits where user_id = p_owner), 0);
    v.revision := 1;
    v.created_at := now();
    v.updated_at := now();
    insert into public.habits select v.*;
  else
    if p_expected_revision is not null and v.revision <> p_expected_revision then
      raise exception 'This habit was changed somewhere else. Reload to see the latest version.' using errcode = 'P0409';
    end if;
    v := public.persora_habit_apply(v, p_habit);
    v.revision := v.revision + 1;
    v.updated_at := now();
    update public.habits set
      name = v.name, description = v.description, icon = v.icon, color = v.color, category = v.category,
      frequency = v.frequency, weekday_mask = v.weekday_mask, weekly_target = v.weekly_target, tracking = v.tracking,
      target_value = v.target_value, unit = v.unit, start_date = v.start_date, schedule_history = v.schedule_history,
      reminder_time = v.reminder_time, reminder_email = v.reminder_email, revision = v.revision, updated_at = v.updated_at
    where id = p_id and user_id = p_owner;
  end if;
  perform public.persora_habit_set_reminder(p_owner, p_id, case when v.archived_at is null and v.reminder_time is not null then p_reminders else null end);
  return to_jsonb(v);
end;
$function$;
revoke all on function public.persora_habit_save(p_owner uuid, p_id uuid, p_habit jsonb, p_expected_revision integer, p_reminders jsonb) from public, anon, authenticated;
grant execute on function public.persora_habit_save(p_owner uuid, p_id uuid, p_habit jsonb, p_expected_revision integer, p_reminders jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habit_set_archived(p_owner uuid, p_id uuid, p_archived boolean, p_reminders jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.habits%rowtype;
begin
  update public.habits set
    archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
    position = case when not p_archived and archived_at is not null
      then coalesce((select max(h.position) + 1 from public.habits h where h.user_id = p_owner and h.archived_at is null), 0)
      else position end,
    revision = revision + 1, updated_at = now()
  where id = p_id and user_id = p_owner
  returning * into v;
  if not found then
    raise exception 'This habit no longer exists.' using errcode = 'P0404';
  end if;
  perform public.persora_habit_set_reminder(p_owner, p_id, case when p_archived or v.reminder_time is null then null else p_reminders end);
  return to_jsonb(v);
end;
$function$;
revoke all on function public.persora_habit_set_archived(p_owner uuid, p_id uuid, p_archived boolean, p_reminders jsonb) from public, anon, authenticated;
grant execute on function public.persora_habit_set_archived(p_owner uuid, p_id uuid, p_archived boolean, p_reminders jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habits_export(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.position, h.created_at) from public.habits h where h.user_id = p_owner), '[]'::jsonb),
    'checkins', coalesce((select jsonb_agg(to_jsonb(c) order by c.habit_id, c.check_date) from public.habit_checkins c where c.user_id = p_owner), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(to_jsonb(r) order by r.remind_at) from public.habit_reminders r where r.user_id = p_owner), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_habits_export(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_habits_export(p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habits_import(p_owner uuid, p_habits jsonb, p_checkins jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_entry jsonb;
  v_source uuid;
  v_target uuid;
  v_map jsonb := '{}'::jsonb;
  v_row public.habits%rowtype;
  v_created integer := 0;
  v_matched integer := 0;
  v_added integer := 0;
  v_skipped integer := 0;
  v_position integer;
  v_inserted integer;
  v_hash text;
  v_alt uuid;
begin
  if jsonb_typeof(coalesce(p_habits, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_checkins, '[]'::jsonb)) <> 'array' then
    raise exception 'This backup''s habit data is invalid.' using errcode = 'P0400';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('persora_habits:' || p_owner::text, 0));
  v_position := coalesce((select max(position) + 1 from public.habits where user_id = p_owner), 0);
  for v_entry in select value from jsonb_array_elements(coalesce(p_habits, '[]'::jsonb)) loop
    v_source := (v_entry ->> 'source_id')::uuid;
    -- When the backup's id is taken by another account, the copy gets an id
    -- derived from (owner, original id), so restoring the same backup again
    -- recognises it instead of creating a duplicate.
    v_hash := md5(p_owner::text || ':' || v_source::text);
    v_alt := (substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-5' || substr(v_hash, 14, 3) || '-a'
      || substr(v_hash, 18, 3) || '-' || substr(v_hash, 21, 12))::uuid;
    v_target := case
      when exists (select 1 from public.habits where id = v_source and user_id = p_owner) then v_source
      when exists (select 1 from public.habits where id = v_alt and user_id = p_owner) then v_alt
    end;
    if v_target is not null then
      v_map := v_map || jsonb_build_object(v_source::text, v_target);
      v_matched := v_matched + 1;
      continue;
    end if;
    if (select count(*) from public.habits where user_id = p_owner) >= 100 then
      raise exception 'This backup would exceed 100 habits. Delete some habits and try again.' using errcode = 'P0409';
    end if;
    v_target := case when exists (select 1 from public.habits where id = v_source) then v_alt else v_source end;
    v_row := public.persora_habit_apply(null::public.habits, v_entry -> 'values');
    v_row.id := v_target;
    v_row.user_id := p_owner;
    v_row.position := v_position;
    v_row.archived_at := nullif(v_entry ->> 'archived_at', '')::timestamptz;
    v_row.revision := 1;
    v_row.created_at := coalesce(nullif(v_entry ->> 'created_at', '')::timestamptz, now());
    v_row.updated_at := now();
    insert into public.habits select v_row.*;
    v_position := v_position + 1;
    v_map := v_map || jsonb_build_object(v_source::text, v_target);
    v_created := v_created + 1;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_checkins, '[]'::jsonb)) loop
    v_target := (v_map ->> (v_entry ->> 'habit_source_id'))::uuid;
    if v_target is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.habit_checkins (user_id, habit_id, check_date, value, target_value, completed)
    select p_owner, h.id, (v_entry ->> 'date')::date, (v_entry ->> 'value')::numeric,
           nullif(v_entry ->> 'target_value', '')::numeric, (v_entry ->> 'completed')::boolean
    from public.habits h
    where h.id = v_target and h.user_id = p_owner and (v_entry ->> 'date')::date >= h.start_date
    on conflict (habit_id, check_date) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('habits_created', v_created, 'habits_matched', v_matched, 'checkins_added', v_added, 'checkins_skipped', v_skipped);
end;
$function$;
revoke all on function public.persora_habits_import(p_owner uuid, p_habits jsonb, p_checkins jsonb) from public, anon, authenticated;
grant execute on function public.persora_habits_import(p_owner uuid, p_habits jsonb, p_checkins jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_habits_list(p_owner uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'habits', coalesce((
      select jsonb_agg(to_jsonb(h) || jsonb_build_object(
        'completed_dates', coalesce((
          select jsonb_agg(c.check_date order by c.check_date) from public.habit_checkins c
          where c.habit_id = h.id and c.user_id = p_owner and c.completed
        ), '[]'::jsonb),
        'pending_reminder', (
          select jsonb_build_object('remind_at', r.remind_at, 'local_date', r.local_date, 'time_zone', r.time_zone, 'email_requested', r.email_requested)
          from public.habit_reminders r where r.habit_id = h.id and r.user_id = p_owner and r.status = 'scheduled' limit 1
        )
      ) order by h.archived_at is not null, h.position, h.created_at)
      from public.habits h where h.user_id = p_owner
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.check_date, c.habit_id)
      from public.habit_checkins c where c.user_id = p_owner and c.check_date between p_from and p_to
    ), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_habits_list(p_owner uuid, p_from date, p_to date) from public, anon, authenticated;
grant execute on function public.persora_habits_list(p_owner uuid, p_from date, p_to date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_hash_password(p_password text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_password is null or char_length(p_password) < 12 or octet_length(p_password) > 72 then
    raise exception 'Password must be between 12 characters and 72 bytes.';
  end if;
  return crypt(p_password, gen_salt('bf', 12));
end;
$function$;
revoke all on function public.persora_hash_password(p_password text) from public, anon, authenticated;
grant execute on function public.persora_hash_password(p_password text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_check_documents(p_owner uuid, p_documents uuid[], p_existing uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if exists (
    select 1 from unnest(coalesce(p_documents, '{}'::uuid[])) d(id)
    where not (d.id = any(coalesce(p_existing, '{}'::uuid[])))
      and not exists (select 1 from public.vault_items v where v.id = d.id and v.user_id = p_owner)
  ) then
    raise exception 'One of the linked documents isn''t in your Persora vault.' using errcode = 'P0400';
  end if;
end;
$function$;
revoke all on function public.persora_loan_check_documents(p_owner uuid, p_documents uuid[], p_existing uuid[]) from public, anon, authenticated;
revoke all on function public.persora_loan_check_documents(p_owner uuid, p_documents uuid[], p_existing uuid[]) from service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_claim_reminders(p_limit integer DEFAULT 50, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  with due as (
    select r.id from public.loan_reminders r
    where (p_owner is null or r.user_id = p_owner)
      and ((r.status = 'scheduled' and r.remind_at <= v_now)
        or (r.status = 'processing' and r.claimed_at < v_now - interval '5 minutes'))
    order by r.remind_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of r skip locked
  ), claimed as (
    update public.loan_reminders r set
      email_status = case
        when r.status = 'processing' and r.email_status = 'sending' then 'failed'
        when r.email_requested and r.email_status = 'not_requested' then 'sending'
        else r.email_status end,
      email_note = case when r.status = 'processing' and r.email_status = 'sending' then 'Delivery was interrupted; not retried to avoid a duplicate email.' else r.email_note end,
      status = 'processing', claimed_at = v_now, attempts = r.attempts + 1
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder', to_jsonb(c),
    'loan', to_jsonb(l),
    'installment', to_jsonb(i),
    'owner', jsonb_build_object('email', p.email, 'full_name', p.full_name, 'timezone', p.timezone,
      'email_verified', p.email_verified_at is not null, 'active', p.account_status = 'active')
  )), '[]'::jsonb) into v_rows
  from claimed c
  join public.loans l on l.id = c.loan_id
  join public.loan_installments i on i.id = c.installment_id
  join public.profiles p on p.id = c.user_id;
  return v_rows;
end;
$function$;
revoke all on function public.persora_loan_claim_reminders(p_limit integer, p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_loan_claim_reminders(p_limit integer, p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_plan_reminder(p_loan uuid, p_from timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_loan public.loans%rowtype;
  v_zone text;
begin
  delete from public.loan_reminders where loan_id = p_loan and status = 'scheduled';
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.status <> 'active' or (v_loan.reminder_days_before is null and not v_loan.overdue_alerts) then
    return;
  end if;
  select coalesce(nullif(p.timezone, ''), 'UTC') into v_zone from public.profiles p where p.id = v_loan.user_id;
  begin
    perform now() at time zone coalesce(v_zone, 'UTC');
  exception when others then
    v_zone := 'UTC';
  end;
  v_zone := coalesce(v_zone, 'UTC');
  insert into public.loan_reminders (
    user_id, loan_id, installment_id, kind, installment_number, due_date, amount, currency, loan_name, remind_at, time_zone, email_requested, dedupe_key
  )
  select v_loan.user_id, v_loan.id, c.id, c.kind, c.number, c.due_date, c.remaining, v_loan.currency, v_loan.name, c.remind_at, v_zone,
    v_loan.reminder_email, 'loan:' || c.id::text || ':' || c.kind
  from (
    select i.id, i.number, i.due_date, i.amount - i.paid_amount as remaining, 'upcoming'::text as kind,
      ((i.due_date - v_loan.reminder_days_before::integer) + time '09:00') at time zone v_zone as remind_at
    from public.loan_installments i
    where i.loan_id = v_loan.id and v_loan.reminder_days_before is not null and i.paid_amount < i.amount
    union all
    select i.id, i.number, i.due_date, i.amount - i.paid_amount, 'overdue'::text,
      ((i.due_date + 1) + time '09:00') at time zone v_zone
    from public.loan_installments i
    where i.loan_id = v_loan.id and v_loan.overdue_alerts and i.paid_amount < i.amount
  ) c
  where c.remind_at >= p_from
    and not exists (select 1 from public.loan_reminders r where r.dedupe_key = 'loan:' || c.id::text || ':' || c.kind)
  order by c.remind_at, c.number
  limit 1
  on conflict do nothing;
end;
$function$;
revoke all on function public.persora_loan_plan_reminder(p_loan uuid, p_from timestamp with time zone) from public, anon, authenticated;
revoke all on function public.persora_loan_plan_reminder(p_loan uuid, p_from timestamp with time zone) from service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_delivered boolean, p_email_status text, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_reminder public.loan_reminders%rowtype;
begin
  if p_email_status not in ('not_requested', 'sent', 'failed', 'skipped') then
    raise exception 'Unknown email status.' using errcode = 'P0400';
  end if;
  update public.loan_reminders set
    status = case when p_delivered then 'sent' else 'skipped' end,
    processed_at = clock_timestamp(),
    email_status = case when email_status = 'failed' then 'failed' else p_email_status end,
    email_note = coalesce(left(p_note, 200), email_note)
  where id = p_id and status = 'processing' and claimed_at = p_claimed_at
  returning * into v_reminder;
  if not found then
    return false;
  end if;
  if not exists (select 1 from public.loan_reminders where loan_id = v_reminder.loan_id and status = 'scheduled') then
    perform public.persora_loan_plan_reminder(v_reminder.loan_id, greatest(v_reminder.remind_at, clock_timestamp() - interval '1 minute'));
  end if;
  return true;
end;
$function$;
revoke all on function public.persora_loan_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_delivered boolean, p_email_status text, p_note text) from public, anon, authenticated;
grant execute on function public.persora_loan_complete_reminder(p_id uuid, p_claimed_at timestamp with time zone, p_delivered boolean, p_email_status text, p_note text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_uuid_array(p_value jsonb)
 RETURNS uuid[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end)::uuid), '{}'::uuid[]);
$function$;
revoke all on function public.persora_loan_uuid_array(p_value jsonb) from public, anon, authenticated;
revoke all on function public.persora_loan_uuid_array(p_value jsonb) from service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_create(p_owner uuid, p_id uuid, p_loan jsonb, p_installments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid;
  v_count integer;
  v_docs uuid[] := public.persora_loan_uuid_array(p_loan->'document_ids');
  v_rows integer;
begin
  select user_id into v_owner from public.loans where id = p_id;
  if found then
    if v_owner = p_owner then
      return jsonb_build_object('replayed', true);
    end if;
    raise exception 'That loan id is already in use. Reload and try again.' using errcode = 'P0409';
  end if;
  perform 1 from public.profiles where id = p_owner for update;
  select count(*) into v_count from public.loans where user_id = p_owner;
  if v_count >= 200 then
    raise exception 'You can keep up to 200 loans. Delete old ones to add more.' using errcode = 'P0400';
  end if;
  perform public.persora_loan_check_documents(p_owner, v_docs, '{}'::uuid[]);
  insert into public.loans (
    id, user_id, name, direction, party_name, borrower_name, currency, principal, interest_method, interest_rate, installment_count,
    frequency, start_date, first_due_date, anchor_date, anchor_number, reference, notes, document_ids, reminder_days_before,
    overdue_alerts, reminder_email, original_terms
  ) values (
    p_id, p_owner, p_loan->>'name', p_loan->>'direction', p_loan->>'party_name', p_loan->>'borrower_name', p_loan->>'currency',
    (p_loan->>'principal')::numeric, p_loan->>'interest_method', nullif(p_loan->>'interest_rate', '')::numeric,
    (p_loan->>'installment_count')::integer, p_loan->>'frequency', (p_loan->>'start_date')::date, (p_loan->>'first_due_date')::date,
    (p_loan->>'first_due_date')::date, 1, coalesce(p_loan->>'reference', ''), coalesce(p_loan->>'notes', ''), v_docs,
    nullif(p_loan->>'reminder_days_before', '')::smallint, coalesce((p_loan->>'overdue_alerts')::boolean, false),
    coalesce((p_loan->>'reminder_email')::boolean, false), coalesce(p_loan->'original_terms', '{}'::jsonb)
  );
  insert into public.loan_installments (loan_id, user_id, number, due_date, principal_amount, interest_amount, amount, schedule_version)
  select p_id, p_owner, (x->>'number')::integer, (x->>'due_date')::date, (x->>'principal')::numeric, (x->>'interest')::numeric, (x->>'amount')::numeric, 1
  from jsonb_array_elements(p_installments) x;
  get diagnostics v_rows = row_count;
  if v_rows <> (p_loan->>'installment_count')::integer
    or (select min(number) from public.loan_installments where loan_id = p_id) <> 1
    or (select max(number) from public.loan_installments where loan_id = p_id) <> v_rows then
    raise exception 'The installment schedule is incomplete.' using errcode = 'P0400';
  end if;
  perform public.persora_loan_plan_reminder(p_id, clock_timestamp());
  return jsonb_build_object('replayed', false);
end;
$function$;
revoke all on function public.persora_loan_create(p_owner uuid, p_id uuid, p_loan jsonb, p_installments jsonb) from public, anon, authenticated;
grant execute on function public.persora_loan_create(p_owner uuid, p_id uuid, p_loan jsonb, p_installments jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_delete(p_owner uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  delete from public.loans where id = p_id and user_id = p_owner;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  return true;
end;
$function$;
revoke all on function public.persora_loan_delete(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_loan_delete(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_get(p_owner uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_loan jsonb;
begin
  select to_jsonb(l) into v_loan from public.loans l where l.id = p_id and l.user_id = p_owner;
  if v_loan is null then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'loan', v_loan,
    'installments', (
      select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'payment_count', (select count(*) from public.loan_payments p where p.installment_id = i.id)
      ) order by i.number), '[]'::jsonb)
      from public.loan_installments i where i.loan_id = p_id and i.user_id = p_owner
    ),
    'payments', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.paid_on, p.created_at, p.id), '[]'::jsonb)
      from public.loan_payments p where p.loan_id = p_id and p.user_id = p_owner
    )
  );
end;
$function$;
revoke all on function public.persora_loan_get(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_loan_get(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_insert_payment(p_owner uuid, p_loan loans, p_installment uuid, p_payment jsonb, p_today date, p_corrects uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_installment public.loan_installments%rowtype;
  v_amount numeric := (p_payment->>'amount')::numeric;
  v_paid_on date := (p_payment->>'paid_on')::date;
begin
  select * into v_installment from public.loan_installments where id = p_installment and loan_id = p_loan.id and user_id = p_owner for update;
  if not found then
    raise exception 'That installment is no longer part of this loan.' using errcode = 'P0404';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'The payment must be more than zero.' using errcode = 'P0400';
  end if;
  if v_amount > v_installment.amount - v_installment.paid_amount then
    raise exception 'Installment % has % remaining. Record any extra against the next installment.', v_installment.number,
      to_char(v_installment.amount - v_installment.paid_amount, 'FM999,999,999,990.00') using errcode = 'P0400';
  end if;
  if v_paid_on is null or v_paid_on > p_today then
    raise exception 'The payment date can''t be in the future.' using errcode = 'P0400';
  end if;
  if v_paid_on < p_loan.start_date then
    raise exception 'The payment date can''t be before the loan started.' using errcode = 'P0400';
  end if;
  insert into public.loan_payments (id, loan_id, installment_id, user_id, amount, paid_on, method, reference, notes, corrects_payment_id)
  values ((p_payment->>'id')::uuid, p_loan.id, p_installment, p_owner, v_amount, v_paid_on, coalesce(p_payment->>'method', ''),
    coalesce(p_payment->>'reference', ''), coalesce(p_payment->>'notes', ''), p_corrects);
  update public.loan_installments set paid_amount = paid_amount + v_amount, updated_at = clock_timestamp() where id = p_installment;
end;
$function$;
revoke all on function public.persora_loan_insert_payment(p_owner uuid, p_loan loans, p_installment uuid, p_payment jsonb, p_today date, p_corrects uuid) from public, anon, authenticated;
revoke all on function public.persora_loan_insert_payment(p_owner uuid, p_loan loans, p_installment uuid, p_payment jsonb, p_today date, p_corrects uuid) from service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_sync_status(p_loan uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_status text;
  v_outstanding numeric;
begin
  select status into v_status from public.loans where id = p_loan;
  select coalesce(sum(amount - paid_amount), 0) into v_outstanding from public.loan_installments where loan_id = p_loan;
  if v_status = 'active' and v_outstanding = 0 then
    update public.loans set status = 'completed', completed_at = clock_timestamp() where id = p_loan;
    return 'completed';
  elsif v_status = 'completed' and v_outstanding > 0 then
    update public.loans set status = 'active', completed_at = null where id = p_loan;
    return 'active';
  end if;
  return v_status;
end;
$function$;
revoke all on function public.persora_loan_sync_status(p_loan uuid) from public, anon, authenticated;
revoke all on function public.persora_loan_sync_status(p_loan uuid) from service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_pay(p_owner uuid, p_loan uuid, p_installment uuid, p_payment jsonb, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_loan public.loans%rowtype;
  v_existing public.loan_payments%rowtype;
  v_status text;
begin
  select * into v_loan from public.loans where id = p_loan and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.loan_payments where id = (p_payment->>'id')::uuid;
  if found then
    if v_existing.user_id = p_owner and v_existing.installment_id = p_installment and v_existing.amount = (p_payment->>'amount')::numeric then
      return jsonb_build_object('replayed', true, 'status', v_loan.status);
    end if;
    raise exception 'That payment was already recorded with different details. Reload and try again.' using errcode = 'P0409';
  end if;
  if v_loan.status = 'closed' then
    raise exception 'This loan is closed. Reopen it to record payments.' using errcode = 'P0409';
  end if;
  if v_loan.status = 'completed' then
    raise exception 'This loan is already fully repaid.' using errcode = 'P0409';
  end if;
  perform public.persora_loan_insert_payment(p_owner, v_loan, p_installment, p_payment, p_today, null);
  update public.loans set revision = revision + 1, updated_at = clock_timestamp() where id = p_loan;
  v_status := public.persora_loan_sync_status(p_loan);
  perform public.persora_loan_plan_reminder(p_loan, clock_timestamp());
  return jsonb_build_object('replayed', false, 'status', v_status);
end;
$function$;
revoke all on function public.persora_loan_pay(p_owner uuid, p_loan uuid, p_installment uuid, p_payment jsonb, p_today date) from public, anon, authenticated;
grant execute on function public.persora_loan_pay(p_owner uuid, p_loan uuid, p_installment uuid, p_payment jsonb, p_today date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_reminders_mark_read(p_owner uuid, p_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  update public.loan_reminders set read_at = clock_timestamp()
  where user_id = p_owner and status = 'sent' and read_at is null and (p_id is null or id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.persora_loan_reminders_mark_read(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_loan_reminders_mark_read(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_reminders_recent(p_owner uuid, p_since timestamp with time zone)
 RETURNS SETOF loan_reminders
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select * from public.loan_reminders
  where user_id = p_owner and status = 'sent' and remind_at >= p_since
  order by remind_at desc
  limit 50;
$function$;
revoke all on function public.persora_loan_reminders_recent(p_owner uuid, p_since timestamp with time zone) from public, anon, authenticated;
grant execute on function public.persora_loan_reminders_recent(p_owner uuid, p_since timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_reverse_payment(p_owner uuid, p_loan uuid, p_payment uuid, p_reason text, p_correction jsonb, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_loan public.loans%rowtype;
  v_payment public.loan_payments%rowtype;
  v_status text;
begin
  select * into v_loan from public.loans where id = p_loan and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  select * into v_payment from public.loan_payments where id = p_payment and loan_id = p_loan and user_id = p_owner for update;
  if not found then
    raise exception 'That payment is no longer available.' using errcode = 'P0404';
  end if;
  if v_payment.status = 'reversed' then
    -- Retried request: already done.
    if p_correction is null or exists (select 1 from public.loan_payments where id = (p_correction->>'id')::uuid and corrects_payment_id = p_payment) then
      return jsonb_build_object('replayed', true, 'status', v_loan.status);
    end if;
    raise exception 'That payment was already reversed. Record a new payment instead.' using errcode = 'P0409';
  end if;
  if v_loan.status = 'closed' then
    raise exception 'This loan is closed. Reopen it to change its payments.' using errcode = 'P0409';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why this payment is being reversed.' using errcode = 'P0400';
  end if;
  update public.loan_payments set status = 'reversed', reversed_at = clock_timestamp(), reversal_reason = left(btrim(p_reason), 300) where id = p_payment;
  update public.loan_installments set paid_amount = paid_amount - v_payment.amount, updated_at = clock_timestamp() where id = v_payment.installment_id;
  if p_correction is not null then
    perform public.persora_loan_insert_payment(p_owner, v_loan, v_payment.installment_id, p_correction, p_today, p_payment);
  end if;
  update public.loans set revision = revision + 1, updated_at = clock_timestamp() where id = p_loan;
  v_status := public.persora_loan_sync_status(p_loan);
  perform public.persora_loan_plan_reminder(p_loan, clock_timestamp());
  return jsonb_build_object('replayed', false, 'status', v_status);
end;
$function$;
revoke all on function public.persora_loan_reverse_payment(p_owner uuid, p_loan uuid, p_payment uuid, p_reason text, p_correction jsonb, p_today date) from public, anon, authenticated;
grant execute on function public.persora_loan_reverse_payment(p_owner uuid, p_loan uuid, p_payment uuid, p_reason text, p_correction jsonb, p_today date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_set_status(p_owner uuid, p_id uuid, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_loan public.loans%rowtype;
  v_outstanding numeric;
begin
  select * into v_loan from public.loans where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  select coalesce(sum(amount - paid_amount), 0) into v_outstanding from public.loan_installments where loan_id = p_id;
  if p_action = 'complete' then
    if v_loan.status = 'completed' then return jsonb_build_object('status', 'completed'); end if;
    if v_loan.status = 'closed' then
      raise exception 'This loan is closed. Reopen it first.' using errcode = 'P0409';
    end if;
    if v_outstanding > 0 then
      raise exception 'This loan still has % outstanding. Record the remaining payments, or close it with a settlement note.', to_char(v_outstanding, 'FM999,999,999,990.00') using errcode = 'P0409';
    end if;
    update public.loans set status = 'completed', completed_at = clock_timestamp(), revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  elsif p_action = 'close' then
    if v_loan.status = 'closed' then return jsonb_build_object('status', 'closed'); end if;
    if v_loan.status = 'completed' or v_outstanding = 0 then
      raise exception 'This loan is fully repaid, so it can simply be marked completed.' using errcode = 'P0409';
    end if;
    if char_length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'Add a settlement note explaining why the loan is closed.' using errcode = 'P0400';
    end if;
    update public.loans set status = 'closed', closed_at = clock_timestamp(), close_note = left(btrim(p_note), 500),
      revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  elsif p_action = 'reopen' then
    if v_loan.status <> 'closed' then
      raise exception 'Only a closed loan can be reopened.' using errcode = 'P0409';
    end if;
    update public.loans set status = 'active', closed_at = null, close_note = null, revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
    perform public.persora_loan_sync_status(p_id);
  else
    raise exception 'Unknown loan action.' using errcode = 'P0400';
  end if;
  perform public.persora_loan_plan_reminder(p_id, clock_timestamp());
  return jsonb_build_object('status', (select status from public.loans where id = p_id));
end;
$function$;
revoke all on function public.persora_loan_set_status(p_owner uuid, p_id uuid, p_action text, p_note text) from public, anon, authenticated;
grant execute on function public.persora_loan_set_status(p_owner uuid, p_id uuid, p_action text, p_note text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loan_update(p_owner uuid, p_id uuid, p_expected_revision integer, p_loan jsonb, p_recalc jsonb, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_loan public.loans%rowtype;
  v_locked integer;
  v_docs uuid[] := public.persora_loan_uuid_array(p_loan->'document_ids');
  v_rows integer;
  v_status text;
begin
  select * into v_loan from public.loans where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  if p_expected_revision is distinct from v_loan.revision then
    raise exception 'This loan changed on another device. Reload to see the latest version.' using errcode = 'P0409';
  end if;
  perform public.persora_loan_check_documents(p_owner, v_docs, v_loan.document_ids);
  if exists (select 1 from public.loan_payments where loan_id = p_id and paid_on < (p_loan->>'start_date')::date) then
    raise exception 'A recorded payment is dated before that start date.' using errcode = 'P0400';
  end if;

  if p_recalc is null then
    if (p_loan->>'principal')::numeric <> v_loan.principal
      or p_loan->>'interest_method' <> v_loan.interest_method
      or nullif(p_loan->>'interest_rate', '')::numeric is distinct from v_loan.interest_rate
      or (p_loan->>'installment_count')::integer <> v_loan.installment_count
      or p_loan->>'frequency' <> v_loan.frequency
      or (p_loan->>'first_due_date')::date <> v_loan.first_due_date then
      raise exception 'Review and confirm the new installment schedule first.' using errcode = 'P0428';
    end if;
  else
    if v_loan.status = 'closed' then
      raise exception 'Reopen this loan before changing its schedule.' using errcode = 'P0409';
    end if;
    v_locked := (p_recalc->>'locked_count')::integer;
    if v_locked is null or v_locked < 0
      or exists (
        select 1 from public.loan_installments i
        where i.loan_id = p_id and i.number > v_locked
          and (i.due_date < p_today or i.paid_amount > 0 or exists (select 1 from public.loan_payments p where p.installment_id = i.id))
      )
      or (select count(*) from public.loan_installments where loan_id = p_id and number <= v_locked) <> v_locked then
      raise exception 'Payments or due dates changed since the preview. Review the new schedule again.' using errcode = 'P0409';
    end if;
    delete from public.loan_installments where loan_id = p_id and number > v_locked;
    insert into public.loan_installments (loan_id, user_id, number, due_date, principal_amount, interest_amount, amount, schedule_version)
    select p_id, p_owner, (x->>'number')::integer, (x->>'due_date')::date, (x->>'principal')::numeric, (x->>'interest')::numeric,
      (x->>'amount')::numeric, v_loan.schedule_version + 1
    from jsonb_array_elements(p_recalc->'installments') x;
    get diagnostics v_rows = row_count;
    if v_rows < 1 or v_locked + v_rows <> (p_loan->>'installment_count')::integer
      or (select min(number) from public.loan_installments where loan_id = p_id and number > v_locked) <> v_locked + 1
      or (select max(number) from public.loan_installments where loan_id = p_id) <> v_locked + v_rows
      or (v_locked > 0 and (select min(due_date) from public.loan_installments where loan_id = p_id and number > v_locked)
        <= (select due_date from public.loan_installments where loan_id = p_id and number = v_locked)) then
      raise exception 'The recalculated schedule is inconsistent.' using errcode = 'P0400';
    end if;
  end if;

  update public.loans set
    name = p_loan->>'name', direction = p_loan->>'direction', party_name = p_loan->>'party_name', borrower_name = p_loan->>'borrower_name',
    currency = p_loan->>'currency', principal = (p_loan->>'principal')::numeric, interest_method = p_loan->>'interest_method',
    interest_rate = nullif(p_loan->>'interest_rate', '')::numeric, installment_count = (p_loan->>'installment_count')::integer,
    frequency = p_loan->>'frequency', start_date = (p_loan->>'start_date')::date, first_due_date = (p_loan->>'first_due_date')::date,
    anchor_date = case when p_recalc is null then anchor_date else (p_recalc->>'anchor_date')::date end,
    anchor_number = case when p_recalc is null then anchor_number else (p_recalc->>'anchor_number')::integer end,
    reference = coalesce(p_loan->>'reference', ''), notes = coalesce(p_loan->>'notes', ''), document_ids = v_docs,
    reminder_days_before = nullif(p_loan->>'reminder_days_before', '')::smallint,
    overdue_alerts = coalesce((p_loan->>'overdue_alerts')::boolean, false), reminder_email = coalesce((p_loan->>'reminder_email')::boolean, false),
    schedule_version = case when p_recalc is null then schedule_version else schedule_version + 1 end,
    schedule_changes = case when p_recalc is null or p_recalc->'change' is null then schedule_changes else (
      select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(schedule_changes || jsonb_build_array(p_recalc->'change')) with ordinality as t(e, n)
        order by n desc limit 50
      ) recent
    ) end,
    revision = revision + 1, updated_at = clock_timestamp()
  where id = p_id;
  v_status := public.persora_loan_sync_status(p_id);
  perform public.persora_loan_plan_reminder(p_id, clock_timestamp());
  return jsonb_build_object('status', v_status);
end;
$function$;
revoke all on function public.persora_loan_update(p_owner uuid, p_id uuid, p_expected_revision integer, p_loan jsonb, p_recalc jsonb, p_today date) from public, anon, authenticated;
grant execute on function public.persora_loan_update(p_owner uuid, p_id uuid, p_expected_revision integer, p_loan jsonb, p_recalc jsonb, p_today date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loans_export(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'loans', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at, l.id), '[]'::jsonb) from public.loans l where l.user_id = p_owner),
    'installments', (select coalesce(jsonb_agg(to_jsonb(i) order by i.loan_id, i.number), '[]'::jsonb) from public.loan_installments i where i.user_id = p_owner),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.loan_id, p.paid_on, p.created_at, p.id), '[]'::jsonb) from public.loan_payments p where p.user_id = p_owner),
    'reminders', (select coalesce(jsonb_agg(to_jsonb(r) order by r.remind_at, r.id), '[]'::jsonb) from public.loan_reminders r where r.user_id = p_owner and r.status <> 'scheduled')
  );
$function$;
revoke all on function public.persora_loans_export(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_loans_export(p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loans_import(p_owner uuid, p_loans jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_entry jsonb;
  v_values jsonb;
  v_source uuid;
  v_id uuid;
  v_owner uuid;
  v_count integer;
  v_created integer := 0;
  v_matched integer := 0;
  v_skipped integer := 0;
  v_installments integer := 0;
  v_payments integer := 0;
  v_rows integer;
  v_docs uuid[];
  v_map jsonb;
  v_item jsonb;
  v_child uuid;
begin
  perform 1 from public.profiles where id = p_owner for update;
  select count(*) into v_count from public.loans where user_id = p_owner;
  for v_entry in select value from jsonb_array_elements(coalesce(p_loans, '[]'::jsonb)) loop
    v_values := v_entry->'values';
    v_source := (v_entry->>'source_id')::uuid;
    select user_id into v_owner from public.loans where id = v_source;
    if found and v_owner = p_owner then
      v_matched := v_matched + 1;
      continue;
    end if;
    v_id := case when found then md5(p_owner::text || ':loan:' || v_source::text)::uuid else v_source end;
    if exists (select 1 from public.loans where id = v_id) then
      v_matched := v_matched + 1;
      continue;
    end if;
    if v_count >= 200 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Only links to this owner's own vault records survive a restore.
    select coalesce(array_agg(d.id), '{}'::uuid[]) into v_docs
    from unnest(public.persora_loan_uuid_array(v_values->'document_ids')) d(id)
    where exists (select 1 from public.vault_items v where v.id = d.id and v.user_id = p_owner);
    insert into public.loans (
      id, user_id, name, direction, party_name, borrower_name, currency, principal, interest_method, interest_rate, installment_count,
      frequency, start_date, first_due_date, anchor_date, anchor_number, reference, notes, document_ids, reminder_days_before,
      overdue_alerts, reminder_email, status, completed_at, closed_at, close_note, original_terms, schedule_changes, schedule_version,
      created_at
    ) values (
      v_id, p_owner, v_values->>'name', v_values->>'direction', v_values->>'party_name', v_values->>'borrower_name', v_values->>'currency',
      (v_values->>'principal')::numeric, v_values->>'interest_method', nullif(v_values->>'interest_rate', '')::numeric,
      (v_values->>'installment_count')::integer, v_values->>'frequency', (v_values->>'start_date')::date, (v_values->>'first_due_date')::date,
      (v_values->>'anchor_date')::date, (v_values->>'anchor_number')::integer, coalesce(v_values->>'reference', ''),
      coalesce(v_values->>'notes', ''), v_docs, nullif(v_values->>'reminder_days_before', '')::smallint,
      coalesce((v_values->>'overdue_alerts')::boolean, false), coalesce((v_values->>'reminder_email')::boolean, false),
      'active', null, null, null, coalesce(v_values->'original_terms', '{}'::jsonb), coalesce(v_values->'schedule_changes', '[]'::jsonb),
      greatest(coalesce((v_values->>'schedule_version')::integer, 1), 1), coalesce((v_values->>'created_at')::timestamptz, clock_timestamp())
    );
    v_count := v_count + 1;
    -- Installments: keep the original ids when free, else derive one.
    v_map := '{}'::jsonb;
    for v_item in select value from jsonb_array_elements(coalesce(v_entry->'installments', '[]'::jsonb)) loop
      v_child := (v_item->>'source_id')::uuid;
      if exists (select 1 from public.loan_installments where id = v_child) then
        v_child := md5(p_owner::text || ':installment:' || v_child::text)::uuid;
      end if;
      insert into public.loan_installments (id, loan_id, user_id, number, due_date, principal_amount, interest_amount, amount, paid_amount, schedule_version)
      values (v_child, v_id, p_owner, (v_item->>'number')::integer, (v_item->>'due_date')::date, (v_item->>'principal')::numeric,
        (v_item->>'interest')::numeric, (v_item->>'amount')::numeric, (v_item->>'paid')::numeric, greatest(coalesce((v_item->>'schedule_version')::integer, 1), 1));
      v_map := v_map || jsonb_build_object(v_item->>'source_id', v_child::text);
      v_installments := v_installments + 1;
    end loop;
    -- Payments: original ids when free; corrections keep pointing at the payment they corrected.
    for v_item in select value from jsonb_array_elements(coalesce(v_entry->'payments', '[]'::jsonb)) loop
      v_child := (v_item->>'source_id')::uuid;
      if exists (select 1 from public.loan_payments where id = v_child) then
        v_child := md5(p_owner::text || ':payment:' || v_child::text)::uuid;
      end if;
      insert into public.loan_payments (id, loan_id, installment_id, user_id, amount, paid_on, method, reference, notes, status, reversed_at, reversal_reason, created_at)
      values (v_child, v_id, (v_map->>(v_item->>'installment_source_id'))::uuid, p_owner, (v_item->>'amount')::numeric, (v_item->>'paid_on')::date,
        coalesce(v_item->>'method', ''), coalesce(v_item->>'reference', ''), coalesce(v_item->>'notes', ''), v_item->>'status',
        (v_item->>'reversed_at')::timestamptz, nullif(v_item->>'reversal_reason', ''), coalesce((v_item->>'created_at')::timestamptz, clock_timestamp()));
      v_map := v_map || jsonb_build_object('p:' || (v_item->>'source_id'), v_child::text);
      v_payments := v_payments + 1;
    end loop;
    update public.loan_payments p set corrects_payment_id = (v_map->>('p:' || (src.value->>'corrects_source_id')))::uuid
    from jsonb_array_elements(coalesce(v_entry->'payments', '[]'::jsonb)) src
    where p.id = (v_map->>('p:' || (src.value->>'source_id')))::uuid and src.value->>'corrects_source_id' is not null
      and v_map ? ('p:' || (src.value->>'corrects_source_id'));
    get diagnostics v_rows = row_count;
    -- Status: closed loans stay closed (with their note); otherwise it follows the balance.
    if v_values->>'status' = 'closed' and nullif(btrim(coalesce(v_values->>'close_note', '')), '') is not null then
      update public.loans set status = 'closed', closed_at = coalesce((v_values->>'closed_at')::timestamptz, clock_timestamp()),
        close_note = left(btrim(v_values->>'close_note'), 500) where id = v_id;
    else
      perform public.persora_loan_sync_status(v_id);
    end if;
    perform public.persora_loan_plan_reminder(v_id, clock_timestamp());
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('loans_created', v_created, 'loans_matched', v_matched, 'loans_skipped', v_skipped,
    'installments_added', v_installments, 'payments_added', v_payments);
end;
$function$;
revoke all on function public.persora_loans_import(p_owner uuid, p_loans jsonb) from public, anon, authenticated;
grant execute on function public.persora_loans_import(p_owner uuid, p_loans jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_loans_list(p_owner uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
    'scheduled_total', agg.scheduled_total,
    'paid_total', agg.paid_total,
    'installments_total', agg.installments_total,
    'paid_count', agg.paid_count,
    'overdue_count', agg.overdue_count,
    'overdue_amount', agg.overdue_amount,
    'next_installment', nxt.row
  ) order by l.created_at, l.id), '[]'::jsonb)
  from public.loans l
  cross join lateral (
    select coalesce(sum(i.amount), 0) as scheduled_total,
      coalesce(sum(i.paid_amount), 0) as paid_total,
      count(*) as installments_total,
      count(*) filter (where i.paid_amount >= i.amount) as paid_count,
      count(*) filter (where i.paid_amount < i.amount and i.due_date < p_today) as overdue_count,
      coalesce(sum(i.amount - i.paid_amount) filter (where i.paid_amount < i.amount and i.due_date < p_today), 0) as overdue_amount
    from public.loan_installments i where i.loan_id = l.id
  ) agg
  left join lateral (
    select to_jsonb(i) as row from public.loan_installments i
    where i.loan_id = l.id and i.paid_amount < i.amount
    order by i.number limit 1
  ) nxt on true
  where l.user_id = p_owner;
$function$;
revoke all on function public.persora_loans_list(p_owner uuid, p_today date) from public, anon, authenticated;
grant execute on function public.persora_loans_list(p_owner uuid, p_today date) to service_role;

CREATE OR REPLACE FUNCTION public.persora_login_blocked(p_fingerprint text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select blocked_until from public.auth_login_attempts where fingerprint = p_fingerprint and blocked_until > now();
$function$;
revoke all on function public.persora_login_blocked(p_fingerprint text) from public, anon, authenticated;
grant execute on function public.persora_login_blocked(p_fingerprint text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_pdf_studio_folder_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.vault_folders folder
    where folder.id = new.folder_id and folder.user_id = new.user_id and folder.scope = 'pdf-studio'
  ) then
    raise exception 'Choose a PDF Studio folder from your account.' using errcode = 'P0403';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.persora_pdf_studio_replace_file(p_owner uuid, p_id uuid, p_file_key text, p_file_name text, p_file_size bigint, p_page_count integer, p_thumbnail text, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_previous text;
  v_document public.pdf_studio_documents%rowtype;
begin
  if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 12) <> p_owner::text || '/pdf-studio/' then
    raise exception 'The uploaded PDF is not stored in your account.' using errcode = 'P0403';
  end if;
  select file_key into v_previous from public.pdf_studio_documents where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That PDF is no longer in your PDF Studio. Save it as a new PDF instead.' using errcode = 'P0404';
  end if;
  update public.pdf_studio_documents
  set file_key = p_file_key, file_name = p_file_name, file_size = p_file_size, page_count = p_page_count,
      thumbnail = p_thumbnail, metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_id and user_id = p_owner
  returning * into v_document;
  return jsonb_build_object('document', to_jsonb(v_document), 'previousKey', v_previous);
end;
$function$;
revoke all on function public.persora_pdf_studio_replace_file(p_owner uuid, p_id uuid, p_file_key text, p_file_name text, p_file_size bigint, p_page_count integer, p_thumbnail text, p_metadata jsonb) from public, anon, authenticated;
grant execute on function public.persora_pdf_studio_replace_file(p_owner uuid, p_id uuid, p_file_key text, p_file_name text, p_file_size bigint, p_page_count integer, p_thumbnail text, p_metadata jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_pdf_studio_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_title text, p_notes text, p_file_key text, p_file_name text, p_file_size bigint, p_page_count integer, p_thumbnail text, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_folder public.vault_folders%rowtype;
  v_folder_id uuid := null;
  v_created_folder boolean := false;
  v_name text := btrim(coalesce(p_new_folder_name, ''));
  v_document public.pdf_studio_documents%rowtype;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 12) <> p_owner::text || '/pdf-studio/' then
    raise exception 'The uploaded PDF is not stored in your account.' using errcode = 'P0403';
  end if;

  if v_name <> '' then
    if char_length(v_name) > 64 then
      raise exception 'Enter a folder name between 1 and 64 characters.' using errcode = 'P0400';
    end if;
    -- Reuse an existing PDF Studio folder with the same name instead of failing.
    select * into v_folder from public.vault_folders
    where user_id = p_owner and scope = 'pdf-studio' and lower(name) = lower(v_name)
    limit 1;
    if not found then
      insert into public.vault_folders (user_id, scope, name, color)
      values (p_owner, 'pdf-studio', v_name,
        case when p_new_folder_color in ('blue','sky','teal','violet','amber','rose','slate','mint') then p_new_folder_color else 'blue' end)
      returning * into v_folder;
      v_created_folder := true;
    end if;
    v_folder_id := v_folder.id;
  elsif p_folder_id is not null then
    select * into v_folder from public.vault_folders
    where id = p_folder_id and user_id = p_owner and scope = 'pdf-studio';
    if not found then
      raise exception 'That folder is no longer available. Choose another folder.' using errcode = 'P0404';
    end if;
    v_folder_id := v_folder.id;
  end if;

  insert into public.pdf_studio_documents (
    user_id, folder_id, title, notes, file_key, file_name, file_size, page_count, thumbnail, metadata
  ) values (
    p_owner, v_folder_id, btrim(p_title), coalesce(p_notes, ''), p_file_key, p_file_name, p_file_size, p_page_count, p_thumbnail, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_document;

  return jsonb_build_object(
    'document', to_jsonb(v_document),
    'folder', case when v_folder_id is null then null else jsonb_build_object(
      'id', v_folder.id, 'scope', v_folder.scope, 'name', v_folder.name, 'color', v_folder.color,
      'pinned', v_folder.pinned, 'created_at', v_folder.created_at, 'updated_at', v_folder.updated_at
    ) end,
    'createdFolder', v_created_folder
  );
end;
$function$;
revoke all on function public.persora_pdf_studio_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_title text, p_notes text, p_file_key text, p_file_name text, p_file_size bigint, p_page_count integer, p_thumbnail text, p_metadata jsonb) from public, anon, authenticated;
grant execute on function public.persora_pdf_studio_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_title text, p_notes text, p_file_key text, p_file_name text, p_file_size bigint, p_page_count integer, p_thumbnail text, p_metadata jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_pdf_studio_trash_move(p_owner uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
begin
  select to_jsonb(document) into v_row from public.pdf_studio_documents document where document.id = p_id and document.user_id = p_owner;
  if v_row is null then
    raise exception 'That PDF is not available in your account.' using errcode = 'P0404';
  end if;
  delete from public.pdf_studio_documents where id = p_id and user_id = p_owner;
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'pdf_studio_document',
    coalesce(nullif(v_row ->> 'title', ''), 'Untitled PDF'),
    jsonb_build_object('space', 'pdf_studio', 'folderId', v_row -> 'folder_id', 'recordType', 'pdf'),
    jsonb_build_object('row', v_row, 'relations', '{}'::jsonb),
    jsonb_build_array(v_row ->> 'file_key'),
    'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash);
end;
$function$;
revoke all on function public.persora_pdf_studio_trash_move(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_pdf_studio_trash_move(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_pdf_studio_trash_restore(p_owner uuid, p_trash_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_note text := null;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id and owner_id = p_owner and kind = 'pdf_studio_document'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  if (v_row ->> 'folder_id') is not null and not exists (
    select 1 from public.vault_folders
    where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner and scope = 'pdf-studio'
  ) then
    v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
    v_note := 'Restored without its folder because that folder no longer exists.';
  end if;

  insert into public.pdf_studio_documents select * from jsonb_populate_record(null::public.pdf_studio_documents, v_row);
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note);
end;
$function$;
revoke all on function public.persora_pdf_studio_trash_restore(p_owner uuid, p_trash_id uuid) from public, anon, authenticated;
grant execute on function public.persora_pdf_studio_trash_restore(p_owner uuid, p_trash_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_photo_studio_folder_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.vault_folders folder
    where folder.id = new.folder_id and folder.user_id = new.user_id and folder.scope = 'photo-studio'
  ) then
    raise exception 'Choose a Photo Studio folder from your account.' using errcode = 'P0403';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.persora_photo_studio_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_source_photo_id uuid, p_title text, p_category text, p_notes text, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text, p_width integer, p_height integer, p_dpi numeric, p_metadata jsonb, p_edit_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_folder public.vault_folders%rowtype;
  v_folder_id uuid := null;
  v_created_folder boolean := false;
  v_name text := btrim(coalesce(p_new_folder_name, ''));
  v_photo public.photo_studio_photos%rowtype;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;
  if p_file_key is null or left(p_file_key, char_length(p_owner::text) + 14) <> p_owner::text || '/photo-studio/' then
    raise exception 'The uploaded photo is not stored in your account.' using errcode = 'P0403';
  end if;

  if v_name <> '' then
    if char_length(v_name) > 64 then
      raise exception 'Enter a folder name between 1 and 64 characters.' using errcode = 'P0400';
    end if;
    -- Reuse an existing Photo Studio folder with the same name instead of failing.
    select * into v_folder from public.vault_folders
    where user_id = p_owner and scope = 'photo-studio' and lower(name) = lower(v_name)
    limit 1;
    if not found then
      insert into public.vault_folders (user_id, scope, name, color)
      values (p_owner, 'photo-studio', v_name,
        case when p_new_folder_color in ('blue','sky','teal','violet','amber','rose','slate','mint') then p_new_folder_color else 'blue' end)
      returning * into v_folder;
      v_created_folder := true;
    end if;
    v_folder_id := v_folder.id;
  elsif p_folder_id is not null then
    select * into v_folder from public.vault_folders
    where id = p_folder_id and user_id = p_owner and scope = 'photo-studio';
    if not found then
      raise exception 'That folder is no longer available. Choose another folder.' using errcode = 'P0404';
    end if;
    v_folder_id := v_folder.id;
  end if;

  if p_source_photo_id is not null and not exists (
    select 1 from public.photo_studio_photos where id = p_source_photo_id and user_id = p_owner
  ) then
    raise exception 'The original photo is no longer available.' using errcode = 'P0404';
  end if;

  insert into public.photo_studio_photos (
    user_id, folder_id, source_photo_id, title, category, notes, file_key, file_name, file_size, file_type,
    width_px, height_px, dpi, metadata, edit_settings
  ) values (
    p_owner, v_folder_id, p_source_photo_id, btrim(p_title), p_category, coalesce(p_notes, ''), p_file_key, p_file_name, p_file_size, p_file_type,
    p_width, p_height, p_dpi, coalesce(p_metadata, '{}'::jsonb), coalesce(p_edit_settings, '{}'::jsonb)
  )
  returning * into v_photo;

  return jsonb_build_object(
    'photo', to_jsonb(v_photo),
    'folder', case when v_folder_id is null then null else jsonb_build_object(
      'id', v_folder.id, 'scope', v_folder.scope, 'name', v_folder.name, 'color', v_folder.color,
      'pinned', v_folder.pinned, 'created_at', v_folder.created_at, 'updated_at', v_folder.updated_at
    ) end,
    'createdFolder', v_created_folder
  );
end;
$function$;
revoke all on function public.persora_photo_studio_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_source_photo_id uuid, p_title text, p_category text, p_notes text, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text, p_width integer, p_height integer, p_dpi numeric, p_metadata jsonb, p_edit_settings jsonb) from public, anon, authenticated;
grant execute on function public.persora_photo_studio_save(p_owner uuid, p_folder_id uuid, p_new_folder_name text, p_new_folder_color text, p_source_photo_id uuid, p_title text, p_category text, p_notes text, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text, p_width integer, p_height integer, p_dpi numeric, p_metadata jsonb, p_edit_settings jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_photo_studio_trash_move(p_owner uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_relations jsonb;
begin
  select to_jsonb(photo) into v_row from public.photo_studio_photos photo where photo.id = p_id and photo.user_id = p_owner;
  if v_row is null then
    raise exception 'That photo is not available in your account.' using errcode = 'P0404';
  end if;
  v_relations := jsonb_build_object(
    'record_shares', coalesce((
      select jsonb_agg(to_jsonb(share))
      from public.record_shares share
      where share.resource_type = 'photo_studio_photo' and share.resource_id = p_id and share.owner_id = p_owner
    ), '[]'::jsonb)
  );
  delete from public.record_shares where resource_type = 'photo_studio_photo' and resource_id = p_id and owner_id = p_owner;
  delete from public.photo_studio_photos where id = p_id and user_id = p_owner;
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'photo_studio_photo',
    coalesce(nullif(v_row ->> 'title', ''), 'Untitled photo'),
    jsonb_build_object('space', 'photo_studio', 'folderId', v_row -> 'folder_id', 'recordType', v_row ->> 'category'),
    jsonb_build_object('row', v_row, 'relations', v_relations),
    jsonb_build_array(v_row ->> 'file_key'),
    'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash);
end;
$function$;
revoke all on function public.persora_photo_studio_trash_move(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_photo_studio_trash_move(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_photo_studio_trash_restore(p_owner uuid, p_trash_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_note text := null;
  v_share jsonb;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id and owner_id = p_owner and kind = 'photo_studio_photo'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  if (v_row ->> 'folder_id') is not null and not exists (
    select 1 from public.vault_folders
    where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner and scope = 'photo-studio'
  ) then
    v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
    v_note := 'Restored without its folder because that folder no longer exists.';
  end if;

  insert into public.photo_studio_photos select * from jsonb_populate_record(null::public.photo_studio_photos, v_row);
  -- Re-create the member shares that existed when the photo was trashed.
  for v_share in select value from jsonb_array_elements(coalesce(v_trash.payload -> 'relations' -> 'record_shares', '[]'::jsonb)) loop
    begin
      insert into public.record_shares select * from jsonb_populate_record(null::public.record_shares, v_share);
    exception when unique_violation or foreign_key_violation then null;
    end;
  end loop;
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note);
end;
$function$;
revoke all on function public.persora_photo_studio_trash_restore(p_owner uuid, p_trash_id uuid) from public, anon, authenticated;
grant execute on function public.persora_photo_studio_trash_restore(p_owner uuid, p_trash_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_attachment_add(p_user uuid, p_field uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_field public.project_fields; v_owner uuid; v_attachment public.project_field_attachments;
begin
  v_field := public.persora__project_can_edit_field(p_user, p_field);
  select p.owner_id into v_owner from public.projects p where p.id = v_field.project_id;
  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 240 or p_file_size not between 1 and 157286400 then raise exception 'Choose a valid attachment up to 150 MB.' using errcode = 'P0400'; end if;
  insert into public.project_field_attachments(project_id, field_id, owner_id, uploader_id, file_key, file_name, file_size, file_type)
  values (v_field.project_id, p_field, v_owner, p_user, p_file_key, trim(p_file_name), p_file_size, p_file_type)
  returning * into v_attachment;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = p_field;
  return to_jsonb(v_attachment);
end;
$function$;
revoke all on function public.persora_project_attachment_add(p_user uuid, p_field uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text) from public, anon, authenticated;
grant execute on function public.persora_project_attachment_add(p_user uuid, p_field uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_attachment_delete(p_user uuid, p_attachment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_file public.project_field_attachments; v_field public.project_fields; v_access record;
begin
  select * into v_file from public.project_field_attachments a where a.id = p_attachment;
  if not found then raise exception 'That attachment is not available.' using errcode = 'P0404'; end if;
  v_field := public.persora__project_can_edit_field(p_user, v_file.field_id);
  select * into v_access from public.persora__project_access(p_user, v_file.project_id);
  if not (v_access.is_owner or v_file.uploader_id = p_user) then
    raise exception 'Only the attachment uploader or project owner can remove this file.' using errcode = 'P0403';
  end if;
  delete from public.project_field_attachments where id = p_attachment;
  update public.project_fields set updated_at = now(), updated_by = p_user where id = v_file.field_id;
  return jsonb_build_object('ok', true, 'file_key', v_file.file_key);
end;
$function$;
revoke all on function public.persora_project_attachment_delete(p_user uuid, p_attachment uuid) from public, anon, authenticated;
grant execute on function public.persora_project_attachment_delete(p_user uuid, p_attachment uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_comment_add(p_user uuid, p_field uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_project uuid;
  v_comment public.project_field_comments;
  v_title text;
begin
  select f.project_id, f.title into v_project, v_title from public.project_fields f where f.id = p_field;
  if v_project is null then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_project);
  insert into public.project_field_comments (field_id, project_id, author_id, author_name, body)
  values (p_field, v_project, p_user, public.persora__project_name(p_user), trim(coalesce(p_body, '')))
  returning * into v_comment;
  perform public.persora__project_log(v_project, p_user, 'comment_added', v_title);
  return to_jsonb(v_comment);
end;
$function$;
revoke all on function public.persora_project_comment_add(p_user uuid, p_field uuid, p_body text) from public, anon, authenticated;
grant execute on function public.persora_project_comment_add(p_user uuid, p_field uuid, p_body text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_comment_delete(p_user uuid, p_comment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_comment public.project_field_comments;
  v_access record;
begin
  select * into v_comment from public.project_field_comments c where c.id = p_comment;
  if not found then
    raise exception 'That comment is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_comment.project_id);
  -- Authors can delete their own comments; the project owner moderates everything.
  if not (v_access.is_owner or v_comment.author_id = p_user) then
    raise exception 'Only the comment author or the project owner can delete it.' using errcode = 'P0403';
  end if;
  delete from public.project_field_comments where id = p_comment;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_comment_delete(p_user uuid, p_comment uuid) from public, anon, authenticated;
grant execute on function public.persora_project_comment_delete(p_user uuid, p_comment uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_comment_update(p_user uuid, p_comment uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_comment public.project_field_comments;
begin
  select * into v_comment from public.project_field_comments c where c.id = p_comment;
  if not found then
    raise exception 'That comment is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_comment.project_id);
  if v_comment.author_id <> p_user then
    raise exception 'Only the comment author can edit it.' using errcode = 'P0403';
  end if;
  update public.project_field_comments set body = trim(coalesce(p_body, '')), updated_at = now()
  where id = p_comment
  returning * into v_comment;
  return to_jsonb(v_comment);
end;
$function$;
revoke all on function public.persora_project_comment_update(p_user uuid, p_comment uuid, p_body text) from public, anon, authenticated;
grant execute on function public.persora_project_comment_update(p_user uuid, p_comment uuid, p_body text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_delete(p_user uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_access record;
  v_name text;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can delete this project.' using errcode = 'P0403';
  end if;
  select p.name into v_name from public.projects p where p.id = p_project;
  delete from public.projects where id = p_project;
  return jsonb_build_object('ok', true, 'deleted', v_name);
end;
$function$;
revoke all on function public.persora_project_delete(p_user uuid, p_project uuid) from public, anon, authenticated;
grant execute on function public.persora_project_delete(p_user uuid, p_project uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_create(p_user uuid, p_project uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_access record;
  v_field public.project_fields;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not (v_access.is_owner or (v_access.member_role = 'editor' and v_access.can_create)) then
    raise exception 'Adding fields needs the project owner or the team field-creation grant. Send a request instead.' using errcode = 'P0403';
  end if;
  if coalesce(trim(p_payload->>'title'), '') = '' then
    raise exception 'Give this field a title.' using errcode = 'P0400';
  end if;
  v_field.id := gen_random_uuid();
  v_field.title := trim(p_payload->>'title');
  v_field := public.persora__project_field_apply(v_field, p_project, p_payload - 'title');
  insert into public.project_fields (id, project_id, folder_id, title, description, status, progress, creator_id, creator_name, assignee_id, due_date)
  values (v_field.id, p_project, v_field.folder_id, v_field.title, v_field.description, v_field.status, v_field.progress, p_user, public.persora__project_name(p_user), v_field.assignee_id, v_field.due_date)
  returning * into v_field;
  perform public.persora__project_log(p_project, p_user, 'field_created', v_field.title);
  return to_jsonb(v_field);
end;
$function$;
revoke all on function public.persora_project_field_create(p_user uuid, p_project uuid, p_payload jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_field_create(p_user uuid, p_project uuid, p_payload jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_delete(p_user uuid, p_field uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_field public.project_fields;
  v_access record;
begin
  select * into v_field from public.project_fields f where f.id = p_field;
  if not found then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can delete it.' using errcode = 'P0403';
  end if;
  delete from public.project_fields where id = p_field;
  perform public.persora__project_log(v_field.project_id, p_user, 'field_deleted', v_field.title);
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_field_delete(p_user uuid, p_field uuid) from public, anon, authenticated;
grant execute on function public.persora_project_field_delete(p_user uuid, p_field uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_react(p_user uuid, p_field uuid, p_pinned boolean, p_favourite boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_project uuid;
  v_access record;
  v_reaction public.project_field_reactions;
begin
  select f.project_id into v_project from public.project_fields f where f.id = p_field;
  if v_project is null then
    raise exception 'That field is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_project);
  insert into public.project_field_reactions (field_id, user_id, pinned, favourite)
  values (p_field, p_user, coalesce(p_pinned, false), coalesce(p_favourite, false))
  on conflict (field_id, user_id) do update
    set pinned = excluded.pinned, favourite = excluded.favourite, updated_at = now()
  returning * into v_reaction;
  return to_jsonb(v_reaction);
end;
$function$;
revoke all on function public.persora_project_field_react(p_user uuid, p_field uuid, p_pinned boolean, p_favourite boolean) from public, anon, authenticated;
grant execute on function public.persora_project_field_react(p_user uuid, p_field uuid, p_pinned boolean, p_favourite boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_request(p_user uuid, p_project uuid, p_payload jsonb, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_access record;
  v_request public.project_field_requests;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if v_access.is_owner or (v_access.member_role = 'editor' and v_access.can_create) then
    raise exception 'You already have permission to create fields directly.' using errcode = 'P0409';
  end if;
  if coalesce(trim(p_payload->>'title'), '') = '' then
    raise exception 'Give the requested field a title.' using errcode = 'P0400';
  end if;
  insert into public.project_field_requests (project_id, requester_id, requester_name, note, payload)
  values (p_project, p_user, public.persora__project_name(p_user), trim(coalesce(p_note, '')), p_payload)
  returning * into v_request;
  perform public.persora__project_log(p_project, p_user, 'field_requested', trim(p_payload->>'title'));
  return to_jsonb(v_request);
end;
$function$;
revoke all on function public.persora_project_field_request(p_user uuid, p_project uuid, p_payload jsonb, p_note text) from public, anon, authenticated;
grant execute on function public.persora_project_field_request(p_user uuid, p_project uuid, p_payload jsonb, p_note text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_request_cancel(p_user uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_request public.project_field_requests;
begin
  select * into v_request from public.project_field_requests r where r.id = p_request;
  if not found then
    raise exception 'That request is not available.' using errcode = 'P0404';
  end if;
  perform public.persora__project_access(p_user, v_request.project_id);
  if v_request.requester_id <> p_user then
    raise exception 'Only the requester can withdraw this request.' using errcode = 'P0403';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0409';
  end if;
  delete from public.project_field_requests where id = p_request;
  perform public.persora__project_log(v_request.project_id, p_user, 'field_request_withdrawn', coalesce(v_request.payload->>'title', 'Field request'));
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_field_request_cancel(p_user uuid, p_request uuid) from public, anon, authenticated;
grant execute on function public.persora_project_field_request_cancel(p_user uuid, p_request uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_request_resolve(p_user uuid, p_request uuid, p_decision text, p_resolution_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_request public.project_field_requests;
  v_access record;
  v_field public.project_fields;
  v_title text;
begin
  select * into v_request from public.project_field_requests r where r.id = p_request;
  if not found then
    raise exception 'That request is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_request.project_id);
  if not v_access.is_owner then
    raise exception 'Only the project owner can review field requests.' using errcode = 'P0403';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0409';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject for this request.' using errcode = 'P0400';
  end if;
  v_title := trim(coalesce(v_request.payload->>'title', ''));
  if p_decision = 'approved' then
    v_field.id := gen_random_uuid();
    v_field.title := v_title;
    v_field := public.persora__project_field_apply(v_field, v_request.project_id, v_request.payload - 'title');
    insert into public.project_fields (id, project_id, folder_id, title, description, status, progress, creator_id, creator_name, assignee_id, due_date)
    values (v_field.id, v_request.project_id, v_field.folder_id, v_field.title, v_field.description, v_field.status, v_field.progress, v_request.requester_id, coalesce(v_request.requester_name, ''), v_field.assignee_id, v_field.due_date)
    returning * into v_field;
  end if;
  update public.project_field_requests
  set status = p_decision, resolved_by = p_user, resolution_note = trim(coalesce(p_resolution_note, '')),
      resolved_at = now(), field_id = case when p_decision = 'approved' then v_field.id else null end
  where id = p_request
  returning * into v_request;
  perform public.persora__project_log(v_request.project_id, p_user, 'field_request_' || p_decision, v_title);
  return jsonb_build_object('request', to_jsonb(v_request), 'field', case when p_decision = 'approved' then to_jsonb(v_field) else null end);
end;
$function$;
revoke all on function public.persora_project_field_request_resolve(p_user uuid, p_request uuid, p_decision text, p_resolution_note text) from public, anon, authenticated;
grant execute on function public.persora_project_field_request_resolve(p_user uuid, p_request uuid, p_decision text, p_resolution_note text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_field_update(p_user uuid, p_field uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_field public.project_fields;
  v_access record;
  v_old_status text;
begin
  select * into v_field from public.project_fields f where f.id = p_field;
  if not found then raise exception 'That field is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);
  if not (v_access.is_owner or v_field.creator_id = p_user) then
    raise exception 'Only the project owner or the member who created this field can edit it.' using errcode = 'P0403';
  end if;
  v_old_status := v_field.status;
  v_field := public.persora__project_field_apply(v_field, v_field.project_id, p_payload);
  update public.project_fields
  set folder_id = v_field.folder_id, title = v_field.title, description = v_field.description,
      status = v_field.status, progress = v_field.progress, assignee_id = v_field.assignee_id,
      due_date = v_field.due_date, updated_at = now(), updated_by = p_user
  where id = p_field returning * into v_field;
  if v_field.status is distinct from v_old_status then
    perform public.persora__project_log(v_field.project_id, p_user, 'field_status_changed', v_field.title || ' → ' || v_field.status);
  else
    perform public.persora__project_log(v_field.project_id, p_user, 'field_updated', v_field.title);
  end if;
  return to_jsonb(v_field);
end;
$function$;
revoke all on function public.persora_project_field_update(p_user uuid, p_field uuid, p_payload jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_field_update(p_user uuid, p_field uuid, p_payload jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_folder_create(p_user uuid, p_project uuid, p_name text, p_color text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_access record;
  v_folder public.project_folders;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not (v_access.is_owner or (v_access.member_role = 'editor' and v_access.can_create)) then
    raise exception 'You do not have permission to create folders in this project.' using errcode = 'P0403';
  end if;
  insert into public.project_folders (project_id, name, color, created_by)
  values (p_project, trim(coalesce(p_name, '')), coalesce(nullif(p_color, ''), 'cyan'), p_user)
  returning * into v_folder;
  perform public.persora__project_log(p_project, p_user, 'folder_created', v_folder.name);
  return to_jsonb(v_folder);
end;
$function$;
revoke all on function public.persora_project_folder_create(p_user uuid, p_project uuid, p_name text, p_color text) from public, anon, authenticated;
grant execute on function public.persora_project_folder_create(p_user uuid, p_project uuid, p_name text, p_color text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_folder_delete(p_user uuid, p_folder uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_project uuid;
  v_access record;
begin
  select f.project_id into v_project from public.project_folders f where f.id = p_folder;
  if v_project is null then
    raise exception 'That folder is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can delete folders.' using errcode = 'P0403';
  end if;
  delete from public.project_folders where id = p_folder;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_folder_delete(p_user uuid, p_folder uuid) from public, anon, authenticated;
grant execute on function public.persora_project_folder_delete(p_user uuid, p_folder uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_folder_update(p_user uuid, p_folder uuid, p_name text, p_color text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_project uuid;
  v_access record;
  v_folder public.project_folders;
begin
  select f.project_id into v_project from public.project_folders f where f.id = p_folder;
  if v_project is null then
    raise exception 'That folder is not available.' using errcode = 'P0404';
  end if;
  select * into v_access from public.persora__project_access(p_user, v_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can rename or recolour folders.' using errcode = 'P0403';
  end if;
  update public.project_folders
  set name = trim(coalesce(p_name, name)), color = coalesce(nullif(p_color, ''), color), updated_at = now()
  where id = p_folder
  returning * into v_folder;
  perform public.persora__project_log(v_project, p_user, 'folder_updated', v_folder.name);
  return to_jsonb(v_folder);
end;
$function$;
revoke all on function public.persora_project_folder_update(p_user uuid, p_folder uuid, p_name text, p_color text) from public, anon, authenticated;
grant execute on function public.persora_project_folder_update(p_user uuid, p_folder uuid, p_name text, p_color text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_member_add(p_user uuid, p_project uuid, p_recipient uuid, p_role text, p_can_create boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_access record;
  v_member public.project_members;
  v_name text;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can manage members.' using errcode = 'P0403';
  end if;
  if exists (select 1 from public.projects p where p.id = p_project and p.kind <> 'shared') then
    raise exception 'Set this project to Shared before inviting members.' using errcode = 'P0409';
  end if;
  if p_recipient is null or p_recipient = p_user then
    raise exception 'Choose another Persora member to invite.' using errcode = 'P0400';
  end if;
  select public.persora__project_name(p_recipient) into v_name;
  insert into public.project_members (project_id, user_id, role, can_create_fields, invited_by)
  values (p_project, p_recipient, coalesce(nullif(p_role, ''), 'viewer'), coalesce(p_can_create, false), p_user)
  on conflict (project_id, user_id) do update
    set role = excluded.role, can_create_fields = excluded.can_create_fields, invited_by = excluded.invited_by, updated_at = now()
  returning * into v_member;
  perform public.persora__project_log(p_project, p_user, 'member_added', v_name);
  return to_jsonb(v_member);
end;
$function$;
revoke all on function public.persora_project_member_add(p_user uuid, p_project uuid, p_recipient uuid, p_role text, p_can_create boolean) from public, anon, authenticated;
grant execute on function public.persora_project_member_add(p_user uuid, p_project uuid, p_recipient uuid, p_role text, p_can_create boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_member_remove(p_user uuid, p_project uuid, p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_access record; v_action text; v_owner uuid;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner and v_access.member_role is null and p_member <> p_user then raise exception 'That project is not available.' using errcode = 'P0404'; end if;
  if not v_access.is_owner and p_member <> p_user then raise exception 'Only the project owner can remove members.' using errcode = 'P0403'; end if;
  select p.owner_id into v_owner from public.projects p where p.id = p_project;
  delete from public.project_members where project_id = p_project and user_id = p_member;
  if not found then raise exception 'That member is not part of this project.' using errcode = 'P0404'; end if;
  v_action := case when p_member = p_user and not v_access.is_owner then 'member_left' else 'member_removed' end;
  perform public.persora__project_log(p_project, p_user, v_action, public.persora__project_name(p_member));
  if p_member <> p_user then
    perform public.persora__project_notify(p_member, p_user, p_project, null, null, 'access_removed', 'Project access changed', 'Your access to a shared project was removed.', 'access-removed:' || p_project::text || ':' || p_member::text || ':' || gen_random_uuid()::text, true);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_member_remove(p_user uuid, p_project uuid, p_member uuid) from public, anon, authenticated;
grant execute on function public.persora_project_member_remove(p_user uuid, p_project uuid, p_member uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_member_update(p_user uuid, p_project uuid, p_member uuid, p_role text, p_can_create boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_access record;
  v_member public.project_members;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can manage members.' using errcode = 'P0403';
  end if;
  update public.project_members
  set role = coalesce(nullif(p_role, ''), role),
      can_create_fields = coalesce(p_can_create, can_create_fields),
      updated_at = now()
  where project_id = p_project and user_id = p_member
  returning * into v_member;
  if not found then
    raise exception 'That member is not part of this project.' using errcode = 'P0404';
  end if;
  perform public.persora__project_log(p_project, p_user, 'member_updated', public.persora__project_name(p_member));
  return to_jsonb(v_member);
end;
$function$;
revoke all on function public.persora_project_member_update(p_user uuid, p_project uuid, p_member uuid, p_role text, p_can_create boolean) from public, anon, authenticated;
grant execute on function public.persora_project_member_update(p_user uuid, p_project uuid, p_member uuid, p_role text, p_can_create boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_attachment_add(p_user uuid, p_task uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_task public.project_tasks; v_field public.project_fields; v_project_owner uuid; v_file public.project_task_attachments;
begin
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  select p.owner_id into v_project_owner from public.projects p where p.id = v_task.project_id;
  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 240 or p_file_size not between 1 and 157286400 then
    raise exception 'Choose a valid attachment up to 150 MB.' using errcode = 'P0400';
  end if;
  insert into public.project_task_attachments(project_id, field_id, task_id, owner_id, uploader_id, file_key, file_name, file_size, file_type)
  values (v_task.project_id, v_field.id, v_task.id, v_project_owner, p_user, p_file_key, trim(p_file_name), p_file_size, p_file_type)
  returning * into v_file;
  update public.project_tasks set updated_at = now(), updated_by = p_user where id = v_task.id;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_attachment_added', left(v_task.name, 200));
  return to_jsonb(v_file);
end;
$function$;
revoke all on function public.persora_project_task_attachment_add(p_user uuid, p_task uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text) from public, anon, authenticated;
grant execute on function public.persora_project_task_attachment_add(p_user uuid, p_task uuid, p_file_key text, p_file_name text, p_file_size bigint, p_file_type text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_attachment_delete(p_user uuid, p_attachment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_file public.project_task_attachments; v_task public.project_tasks;
begin
  select * into v_file from public.project_task_attachments a where a.id = p_attachment;
  if not found then raise exception 'That attachment is not available.' using errcode = 'P0404'; end if;
  v_task := public.persora__project_can_manage_task(p_user, v_file.task_id);
  delete from public.project_task_attachments where id = p_attachment;
  update public.project_tasks set updated_at = now(), updated_by = p_user where id = v_task.id;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_attachment_removed', left(v_task.name, 200));
  return jsonb_build_object('ok', true, 'file_key', v_file.file_key, 'owner_id', v_file.owner_id);
end;
$function$;
revoke all on function public.persora_project_task_attachment_delete(p_user uuid, p_attachment uuid) from public, anon, authenticated;
grant execute on function public.persora_project_task_attachment_delete(p_user uuid, p_attachment uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_comment_add(p_user uuid, p_task uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_task public.project_tasks; v_comment public.project_task_comments;
begin
  select * into v_task from public.project_tasks t where t.id = p_task;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  perform public.persora__project_access(p_user, v_task.project_id);
  insert into public.project_task_comments(task_id, project_id, author_id, author_name, body)
  values (p_task, v_task.project_id, p_user, public.persora__project_name(p_user), trim(coalesce(p_body, '')))
  returning * into v_comment;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_comment_added', left(v_task.name, 200));
  return to_jsonb(v_comment);
end;
$function$;
revoke all on function public.persora_project_task_comment_add(p_user uuid, p_task uuid, p_body text) from public, anon, authenticated;
grant execute on function public.persora_project_task_comment_add(p_user uuid, p_task uuid, p_body text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_comment_delete(p_user uuid, p_comment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_comment public.project_task_comments; v_access record;
begin
  select * into v_comment from public.project_task_comments c where c.id = p_comment;
  if not found then raise exception 'That comment is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_comment.project_id);
  if not (v_access.is_owner or v_comment.author_id = p_user) then
    raise exception 'Only the comment author or project owner can delete it.' using errcode = 'P0403';
  end if;
  delete from public.project_task_comments where id = p_comment;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_task_comment_delete(p_user uuid, p_comment uuid) from public, anon, authenticated;
grant execute on function public.persora_project_task_comment_delete(p_user uuid, p_comment uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_comment_update(p_user uuid, p_comment uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_comment public.project_task_comments;
begin
  select * into v_comment from public.project_task_comments c where c.id = p_comment;
  if not found then raise exception 'That comment is not available.' using errcode = 'P0404'; end if;
  perform public.persora__project_access(p_user, v_comment.project_id);
  if v_comment.author_id <> p_user then raise exception 'Only the comment author can edit it.' using errcode = 'P0403'; end if;
  update public.project_task_comments set body = trim(coalesce(p_body, '')), updated_at = now()
  where id = p_comment returning * into v_comment;
  return to_jsonb(v_comment);
end;
$function$;
revoke all on function public.persora_project_task_comment_update(p_user uuid, p_comment uuid, p_body text) from public, anon, authenticated;
grant execute on function public.persora_project_task_comment_update(p_user uuid, p_comment uuid, p_body text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_delete(p_user uuid, p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_task public.project_tasks;
begin
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  perform public.persora__project_log(v_task.project_id, p_user, 'task_deleted', left(v_task.name, 200));
  delete from public.project_tasks where id = p_task;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.persora_project_task_delete(p_user uuid, p_task uuid) from public, anon, authenticated;
grant execute on function public.persora_project_task_delete(p_user uuid, p_task uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_project_task_pause(p_user uuid, p_task uuid, p_paused boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_task public.project_tasks; v_old_paused boolean;
begin
  if p_paused is null then raise exception 'Choose Pause or Resume.' using errcode = 'P0400'; end if;
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  v_old_paused := v_task.paused;
  if v_old_paused is distinct from p_paused then
    update public.project_tasks set paused = p_paused, updated_at = now(), updated_by = p_user
    where id = p_task returning * into v_task;
    perform public.persora__project_log(v_task.project_id, p_user, case when p_paused then 'task_paused' else 'task_resumed' end, left(v_task.name, 200));
  end if;
  return to_jsonb(v_task);
end;
$function$;
revoke all on function public.persora_project_task_pause(p_user uuid, p_task uuid, p_paused boolean) from public, anon, authenticated;
grant execute on function public.persora_project_task_pause(p_user uuid, p_task uuid, p_paused boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_record_login_attempt(p_fingerprint text, p_success boolean, p_limit integer DEFAULT 8)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.persora_record_login_attempt(p_fingerprint text, p_success boolean, p_limit integer) from public, anon, authenticated;
grant execute on function public.persora_record_login_attempt(p_fingerprint text, p_success boolean, p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_record_smart_scan_usage(p_user_id uuid, p_scans bigint DEFAULT 0, p_ocr_runs bigint DEFAULT 0, p_ai_extractions bigint DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_user_id is null or p_scans < 0 or p_ocr_runs < 0 or p_ai_extractions < 0 then
    raise exception 'Invalid Smart Scan usage increment';
  end if;

  insert into public.smart_scan_usage (user_id, enabled, scan_count, ocr_run_count, ai_extraction_count, last_scanned_at, updated_at)
  values (p_user_id, true, p_scans, p_ocr_runs, p_ai_extractions, case when p_scans > 0 then now() else null end, now())
  on conflict (user_id) do update set
    scan_count = public.smart_scan_usage.scan_count + excluded.scan_count,
    ocr_run_count = public.smart_scan_usage.ocr_run_count + excluded.ocr_run_count,
    ai_extraction_count = public.smart_scan_usage.ai_extraction_count + excluded.ai_extraction_count,
    last_scanned_at = case when p_scans > 0 then now() else public.smart_scan_usage.last_scanned_at end,
    updated_at = now();
end;
$function$;
revoke all on function public.persora_record_smart_scan_usage(p_user_id uuid, p_scans bigint, p_ocr_runs bigint, p_ai_extractions bigint) from public, anon, authenticated;
grant execute on function public.persora_record_smart_scan_usage(p_user_id uuid, p_scans bigint, p_ocr_runs bigint, p_ai_extractions bigint) to service_role;

CREATE OR REPLACE FUNCTION public.persora_review_payment(payment_id uuid, reviewer_id uuid, decision text, review_note text DEFAULT ''::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment public.payment_records%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_term_months integer;
begin
  select * into v_payment from public.payment_records where id = payment_id for update;
  if not found or v_payment.status <> 'pending' then return false; end if;
  if decision not in ('approved', 'rejected') then return false; end if;
  if decision = 'approved' then
    select * into v_plan from public.subscription_plans where id = v_payment.plan_id and active = true;
    if not found then return false; end if;
    v_term_months := greatest(coalesce(v_payment.term_months, 1), 1);
    insert into public.user_subscriptions as existing_subscription (user_id, plan_id, status, storage_limit_gb, current_period_end)
    values (v_payment.user_id, v_plan.id, 'active', v_plan.storage_gb, now() + make_interval(months => v_term_months))
    on conflict (user_id) do update set
      plan_id = excluded.plan_id,
      status = 'active',
      storage_limit_gb = excluded.storage_limit_gb,
      current_period_end = case when existing_subscription.current_period_end > now()
        then existing_subscription.current_period_end + make_interval(months => v_term_months)
        else now() + make_interval(months => v_term_months) end;
  end if;
  update public.payment_records
  set status = decision, reviewed_at = now(), reviewed_by = reviewer_id, admin_note = coalesce(review_note, '')
  where id = payment_id;
  return true;
end;
$function$;
revoke all on function public.persora_review_payment(payment_id uuid, reviewer_id uuid, decision text, review_note text) from public, anon, authenticated;
grant execute on function public.persora_review_payment(payment_id uuid, reviewer_id uuid, decision text, review_note text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.persora_table_attachments%rowtype;
begin
  if not exists (select 1 from public.persora_tables where id = p_table and user_id = p_owner and kind = 'smart') then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_table_attachments where table_id = p_table) >= 500 then
    raise exception 'A table can hold up to 500 files.' using errcode = 'P0409';
  end if;
  insert into public.persora_table_attachments (table_id, id, user_id, file_key, file_name, file_type, file_size)
  values (p_table, p_id, p_owner, p_key, p_name, p_type, p_size)
  on conflict (table_id, id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.persora_table_attachments where table_id = p_table and id = p_id and user_id = p_owner and file_key = p_key;
    if v_row.id is null then
      raise exception 'That file id is already in use.' using errcode = 'P0409';
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'created_at', v_row.created_at);
end;
$function$;
revoke all on function public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint) from public, anon, authenticated;
grant execute on function public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.persora_table_attachments%rowtype;
begin
  select a.* into v_row
  from public.persora_table_attachments a
  join public.persora_tables t on t.id = a.table_id
  where a.table_id = p_table and a.id = p_id and a.user_id = p_owner and t.user_id = p_owner;
  if v_row.id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object('id', v_row.id, 'file_key', v_row.file_key, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size);
end;
$function$;
revoke all on function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_uuid_array(p_value jsonb)
 RETURNS uuid[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) from jsonb_array_elements_text(coalesce(p_value, '[]'::jsonb)) as value;
$function$;
revoke all on function public.persora_table_uuid_array(p_value jsonb) from public, anon, authenticated;
revoke all on function public.persora_table_uuid_array(p_value jsonb) from service_role;

CREATE OR REPLACE FUNCTION public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_keys jsonb;
begin
  with removed as (
    delete from public.persora_table_attachments
    where table_id = p_table and user_id = p_owner and created_at < p_before
      and not (id = any(public.persora_table_uuid_array(p_keep)))
    returning file_key
  )
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys from removed;
  return v_keys;
end;
$function$;
revoke all on function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone) from public, anon, authenticated;
grant execute on function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_refresh_stats(p_id uuid)
 RETURNS persora_tables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_table public.persora_tables%rowtype;
  v_sheets integer;
  v_records integer;
  v_bytes bigint;
begin
  select count(*), coalesce(sum(octet_length(data::text)), 0) into v_sheets, v_bytes from public.persora_table_sheets where table_id = p_id;
  select v_bytes + coalesce(sum(octet_length("values"::text)), 0), count(*) into v_bytes, v_records from public.persora_table_records where table_id = p_id;
  select * into v_table from public.persora_tables where id = p_id;
  v_bytes := v_bytes + octet_length(v_table.meta::text);
  if v_table.kind = 'spreadsheet' and v_sheets < 1 then
    raise exception 'A spreadsheet needs at least one sheet.' using errcode = 'P0422';
  end if;
  if v_sheets > 20 then
    raise exception 'A spreadsheet can have at most 20 sheets.' using errcode = 'P0422';
  end if;
  if v_records > 5000 then
    raise exception 'A Smart Table can have at most 5,000 records.' using errcode = 'P0422';
  end if;
  if v_bytes > 12 * 1024 * 1024 then
    raise exception 'This table is too large to save (the limit is 12 MB of data). Split it into smaller tables.' using errcode = 'P0413';
  end if;
  if exists (select 1 from public.persora_table_sheets where table_id = p_id group by lower(btrim(name)) having count(*) > 1) then
    raise exception 'Two sheets have the same name.' using errcode = 'P0422';
  end if;
  update public.persora_tables set sheet_count = v_sheets, record_count = v_records, size_bytes = v_bytes where id = p_id returning * into v_table;
  return v_table;
end;
$function$;
revoke all on function public.persora_table_refresh_stats(p_id uuid) from public, anon, authenticated;
revoke all on function public.persora_table_refresh_stats(p_id uuid) from service_role;

CREATE OR REPLACE FUNCTION public.persora_table_summary(p_table persora_tables)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'id', p_table.id, 'kind', p_table.kind, 'name', p_table.name, 'label', p_table.label, 'starred', p_table.starred,
    'template', p_table.template, 'revision', p_table.revision, 'sheet_count', p_table.sheet_count, 'record_count', p_table.record_count,
    'size_bytes', p_table.size_bytes, 'created_at', p_table.created_at, 'updated_at', p_table.updated_at, 'opened_at', p_table.opened_at
  );
$function$;
revoke all on function public.persora_table_summary(p_table persora_tables) from public, anon, authenticated;
revoke all on function public.persora_table_summary(p_table persora_tables) from service_role;

CREATE OR REPLACE FUNCTION public.persora_table_create(p_owner uuid, p_id uuid, p_table jsonb, p_sheets jsonb, p_records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_existing public.persora_tables%rowtype;
  v_table public.persora_tables%rowtype;
  v_kind text := p_table ->> 'kind';
begin
  select * into v_existing from public.persora_tables where id = p_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That table id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('replayed', true, 'table', public.persora_table_summary(v_existing));
  end if;
  if (select count(*) from public.persora_tables where user_id = p_owner) >= 300 then
    raise exception 'You can have up to 300 tables. Delete some you no longer need to create more.' using errcode = 'P0409';
  end if;
  if v_kind = 'spreadsheet' and (jsonb_array_length(coalesce(p_records, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheets, '[]'::jsonb)) < 1) then
    raise exception 'A spreadsheet needs sheets and has no records.' using errcode = 'P0422';
  end if;
  if v_kind = 'smart' and jsonb_array_length(coalesce(p_sheets, '[]'::jsonb)) > 0 then
    raise exception 'A Smart Table has no sheets.' using errcode = 'P0422';
  end if;
  insert into public.persora_tables (id, user_id, kind, name, label, template, meta)
  values (p_id, p_owner, v_kind, btrim(p_table ->> 'name'), coalesce(p_table ->> 'label', ''), nullif(p_table ->> 'template', ''), coalesce(p_table -> 'meta', '{}'::jsonb));
  insert into public.persora_table_sheets (id, table_id, user_id, position, name, data)
  select (s ->> 'id')::uuid, p_id, p_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data'
  from jsonb_array_elements(coalesce(p_sheets, '[]'::jsonb)) s;
  insert into public.persora_table_records (id, table_id, user_id, position, "values", is_example)
  select (r ->> 'id')::uuid, p_id, p_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false)
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r;
  v_table := public.persora_table_refresh_stats(p_id);
  return jsonb_build_object('replayed', false, 'table', public.persora_table_summary(v_table));
end;
$function$;
revoke all on function public.persora_table_create(p_owner uuid, p_id uuid, p_table jsonb, p_sheets jsonb, p_records jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_create(p_owner uuid, p_id uuid, p_table jsonb, p_sheets jsonb, p_records jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_duplicate(p_owner uuid, p_source uuid, p_new_id uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_source public.persora_tables%rowtype;
  v_existing public.persora_tables%rowtype;
  v_table public.persora_tables%rowtype;
begin
  select * into v_existing from public.persora_tables where id = p_new_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That table id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object('replayed', true, 'table', public.persora_table_summary(v_existing));
  end if;
  select * into v_source from public.persora_tables where id = p_source and user_id = p_owner;
  if v_source.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_tables where user_id = p_owner) >= 300 then
    raise exception 'You can have up to 300 tables. Delete some you no longer need to create more.' using errcode = 'P0409';
  end if;
  insert into public.persora_tables (id, user_id, kind, name, label, template, meta)
  values (p_new_id, p_owner, v_source.kind, btrim(p_name), v_source.label, v_source.template, v_source.meta);
  insert into public.persora_table_sheets (id, table_id, user_id, position, name, data)
  select gen_random_uuid(), p_new_id, p_owner, position, name, data from public.persora_table_sheets where table_id = p_source;
  insert into public.persora_table_records (id, table_id, user_id, position, "values", is_example)
  select gen_random_uuid(), p_new_id, p_owner, position, "values", is_example from public.persora_table_records where table_id = p_source;
  insert into public.persora_table_attachments (table_id, id, user_id, file_key, file_name, file_type, file_size, created_at)
  select p_new_id, id, p_owner, file_key, file_name, file_type, file_size, created_at from public.persora_table_attachments where table_id = p_source;
  v_table := public.persora_table_refresh_stats(p_new_id);
  return jsonb_build_object('replayed', false, 'table', public.persora_table_summary(v_table));
end;
$function$;
revoke all on function public.persora_table_duplicate(p_owner uuid, p_source uuid, p_new_id uuid, p_name text) from public, anon, authenticated;
grant execute on function public.persora_table_duplicate(p_owner uuid, p_source uuid, p_new_id uuid, p_name text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_table public.persora_tables%rowtype;
begin
  if p_touch then
    update public.persora_tables set opened_at = clock_timestamp() where id = p_id and user_id = p_owner returning * into v_table;
  else
    select * into v_table from public.persora_tables where id = p_id and user_id = p_owner;
  end if;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'table', public.persora_table_summary(v_table) || jsonb_build_object('meta', v_table.meta),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.position, s.id) from public.persora_table_sheets s where s.table_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.position, r.created_at, r.id) from public.persora_table_records r where r.table_id = p_id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at) from public.persora_table_attachments a where a.table_id = p_id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean) from public, anon, authenticated;
grant execute on function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_table public.persora_tables%rowtype;
begin
  select * into v_table from public.persora_tables where id = p_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  return public.persora_table_summary(v_table) || case when p_meta then jsonb_build_object('meta', v_table.meta) else '{}'::jsonb end;
end;
$function$;
revoke all on function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean) from public, anon, authenticated;
grant execute on function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_people(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with my_projects as (
    select id from public.projects where owner_id = p_owner
    union select project_id from public.project_members where user_id = p_owner
  ), linked as (
    select p_owner as id
    union select pm.user_id from public.project_members pm where pm.project_id in (select id from my_projects)
    union select pr.owner_id from public.projects pr where pr.id in (select id from my_projects)
    union select recipient_id from public.record_shares where owner_id = p_owner
    union select owner_id from public.record_shares where recipient_id = p_owner
    union select recipient_id from public.vault_shares where owner_id = p_owner
    union select owner_id from public.vault_shares where recipient_id = p_owner
  ), people as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Member') as name
    from public.profiles p
    where p.id in (select id from linked) and (p.id = p_owner or p.account_status = 'active')
    limit 500
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'me', id = p_owner) order by (id <> p_owner), lower(name)), '[]'::jsonb) from people;
$function$;
revoke all on function public.persora_table_people(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_table_people(p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_table public.persora_tables%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sheet_ids uuid[];
  v_record_ids uuid[];
begin
  select * into v_table from public.persora_tables where id = p_id and user_id = p_owner for update;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  if v_table.last_batch_id = p_batch then
    return jsonb_build_object('ok', true, 'replayed', true, 'table', public.persora_table_summary(v_table));
  end if;
  if v_table.revision <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'table', public.persora_table_summary(v_table));
  end if;
  if v_table.kind = 'spreadsheet' and (p_meta is not null or jsonb_array_length(coalesce(p_record_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_record_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Spreadsheets don''t have fields or records.' using errcode = 'P0422';
  end if;
  if v_table.kind = 'smart' and (jsonb_array_length(coalesce(p_sheet_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheet_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Smart Tables don''t have sheets.' using errcode = 'P0422';
  end if;

  -- Ids from the browser must belong to this table (or be new).
  select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_sheet_ids from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s;
  select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_record_ids from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r;
  if exists (select 1 from public.persora_table_sheets where id = any(v_sheet_ids) and table_id <> p_id)
     or exists (select 1 from public.persora_table_records where id = any(v_record_ids) and table_id <> p_id) then
    raise exception 'That change refers to data from another table.' using errcode = 'P0403';
  end if;

  delete from public.persora_table_sheets where table_id = p_id and id = any(public.persora_table_uuid_array(p_sheet_deletes));
  insert into public.persora_table_sheets as current (id, table_id, user_id, position, name, data, updated_at)
  select (s ->> 'id')::uuid, p_id, p_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data', v_now
  from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s
  on conflict (id) do update set position = excluded.position, name = excluded.name, data = excluded.data, updated_at = v_now
  where current.table_id = p_id;

  delete from public.persora_table_records where table_id = p_id and id = any(public.persora_table_uuid_array(p_record_deletes));
  insert into public.persora_table_records as current (id, table_id, user_id, position, "values", is_example, updated_at)
  select (r ->> 'id')::uuid, p_id, p_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false), v_now
  from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r
  on conflict (id) do update set position = excluded.position, "values" = excluded."values", is_example = excluded.is_example, updated_at = v_now
  where current.table_id = p_id;

  update public.persora_tables
  set meta = coalesce(p_meta, meta), revision = revision + 1, last_batch_id = p_batch, updated_at = v_now
  where id = p_id;
  v_table := public.persora_table_refresh_stats(p_id);
  return jsonb_build_object('ok', true, 'replayed', false, 'table', public.persora_table_summary(v_table));
end;
$function$;
revoke all on function public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_trash_move(p_owner uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_table public.persora_tables%rowtype;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_payload jsonb;
  v_keys jsonb;
begin
  select * into v_table from public.persora_tables where id = p_id and user_id = p_owner for update;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  v_payload := jsonb_build_object(
    'row', to_jsonb(v_table),
    'sheets', coalesce((select jsonb_agg(to_jsonb(s)) from public.persora_table_sheets s where s.table_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(to_jsonb(r)) from public.persora_table_records r where r.table_id = p_id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a)) from public.persora_table_attachments a where a.table_id = p_id), '[]'::jsonb)
  );
  select coalesce(jsonb_agg(distinct a.file_key), '[]'::jsonb) into v_keys from public.persora_table_attachments a where a.table_id = p_id;
  delete from public.persora_tables where id = p_id and user_id = p_owner;
  delete from public.trash_items where id = p_id and owner_id = p_owner and status = 'active';
  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, 'persora_table', v_table.name,
    jsonb_build_object('space', 'persora-table', 'recordType', case when v_table.kind = 'smart' then 'Smart Table' else 'Spreadsheet' end),
    v_payload, v_keys, 'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;
  return to_jsonb(v_trash) - 'payload';
end;
$function$;
revoke all on function public.persora_table_trash_move(p_owner uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_table_trash_move(p_owner uuid, p_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_trash_restore(p_owner uuid, p_trash_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_note text := null;
  v_name text;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id and owner_id = p_owner and kind = 'persora_table'
    and status = 'active' and expires_at > clock_timestamp()
  returning * into v_trash;
  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;
  if exists (select 1 from public.persora_tables where id = v_trash.id) then
    raise exception 'This table already exists in your account.' using errcode = 'P0409';
  end if;
  if (select count(*) from public.persora_tables where user_id = p_owner) >= 300 then
    raise exception 'You have 300 tables, the maximum. Delete one to restore this table.' using errcode = 'P0409';
  end if;
  v_row := v_trash.payload -> 'row';
  v_name := v_row ->> 'name';
  insert into public.persora_tables select * from jsonb_populate_record(null::public.persora_tables, v_row || jsonb_build_object('last_batch_id', null, 'updated_at', clock_timestamp()));
  insert into public.persora_table_sheets select * from jsonb_populate_recordset(null::public.persora_table_sheets, coalesce(v_trash.payload -> 'sheets', '[]'::jsonb));
  insert into public.persora_table_records select * from jsonb_populate_recordset(null::public.persora_table_records, coalesce(v_trash.payload -> 'records', '[]'::jsonb));
  insert into public.persora_table_attachments select * from jsonb_populate_recordset(null::public.persora_table_attachments, coalesce(v_trash.payload -> 'attachments', '[]'::jsonb));
  perform public.persora_table_refresh_stats(v_trash.id);
  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', v_note, 'name', v_name);
end;
$function$;
revoke all on function public.persora_table_trash_restore(p_owner uuid, p_trash_id uuid) from public, anon, authenticated;
grant execute on function public.persora_table_trash_restore(p_owner uuid, p_trash_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_table_update_info(p_owner uuid, p_id uuid, p_name text, p_label text, p_starred boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_table public.persora_tables%rowtype;
begin
  update public.persora_tables
  set name = coalesce(nullif(btrim(p_name), ''), name), label = coalesce(p_label, label), starred = coalesce(p_starred, starred)
  where id = p_id and user_id = p_owner
  returning * into v_table;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  return public.persora_table_summary(v_table);
end;
$function$;
revoke all on function public.persora_table_update_info(p_owner uuid, p_id uuid, p_name text, p_label text, p_starred boolean) from public, anon, authenticated;
grant execute on function public.persora_table_update_info(p_owner uuid, p_id uuid, p_name text, p_label text, p_starred boolean) to service_role;

CREATE OR REPLACE FUNCTION public.persora_tables_export(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'tables', coalesce((select jsonb_agg(public.persora_table_summary(t) || jsonb_build_object('meta', t.meta) order by t.created_at) from public.persora_tables t where t.user_id = p_owner), '[]'::jsonb),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'table_id', s.table_id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.table_id, s.position) from public.persora_table_sheets s where s.user_id = p_owner), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'table_id', r.table_id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.table_id, r.position) from public.persora_table_records r where r.user_id = p_owner), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'table_id', a.table_id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'file_key', a.file_key)) from public.persora_table_attachments a where a.user_id = p_owner), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_tables_export(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_tables_export(p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_tables_list(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(public.persora_table_summary(t) order by t.updated_at desc), '[]'::jsonb)
  from public.persora_tables t where t.user_id = p_owner;
$function$;
revoke all on function public.persora_tables_list(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_tables_list(p_owner uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_claim_for_owner(p_owner uuid, p_ids uuid[])
 RETURNS SETOF trash_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  return query
  update public.trash_items
  set status = 'purging', purge_claimed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id in (
    select id from public.trash_items
    where owner_id = p_owner and status = 'active' and id = any(coalesce(p_ids, array[]::uuid[]))
    for update skip locked
  )
  returning *;
end;
$function$;
revoke all on function public.persora_trash_claim_for_owner(p_owner uuid, p_ids uuid[]) from public, anon, authenticated;
grant execute on function public.persora_trash_claim_for_owner(p_owner uuid, p_ids uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_claim_purge(p_limit integer DEFAULT 50)
 RETURNS SETOF trash_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  return query
  update public.trash_items
  set status = 'purging', purge_claimed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id in (
    select id from public.trash_items
    where ((status = 'active' and expires_at <= clock_timestamp())
       or (status = 'purging' and purge_claimed_at < clock_timestamp() - interval '10 minutes'))
    order by expires_at asc
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  )
  returning *;
end;
$function$;
revoke all on function public.persora_trash_claim_purge(p_limit integer) from public, anon, authenticated;
grant execute on function public.persora_trash_claim_purge(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_finalize_purge(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  delete from public.trash_items where id = any(coalesce(p_ids, array[]::uuid[])) and status = 'purging';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.persora_trash_finalize_purge(p_ids uuid[]) from public, anon, authenticated;
grant execute on function public.persora_trash_finalize_purge(p_ids uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_move(p_owner uuid, p_kind text, p_id uuid, p_file_keys jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row jsonb := null;
  v_relations jsonb := '{}'::jsonb;
  v_title text := 'Deleted item';
  v_context jsonb := '{}'::jsonb;
  v_file_keys jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
begin
  if p_owner is null or not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That account is unavailable.' using errcode = 'P0404';
  end if;

  if p_kind = 'vault_item' then
    select to_jsonb(item) into v_row from public.vault_items item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That record is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'shares', coalesce((select jsonb_agg(to_jsonb(share)) from public.vault_shares share where share.item_id = p_id), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(to_jsonb(comment))
        from public.vault_share_comments comment
        join public.vault_shares share on share.id = comment.share_id
        where share.item_id = p_id
      ), '[]'::jsonb),
      'timeline_events', coalesce((
        select jsonb_agg(to_jsonb(event))
        from public.timeline_events event
        where event.record_id = p_id and event.user_id = p_owner
      ), '[]'::jsonb),
      'timeline_links', coalesce((
        select jsonb_agg(to_jsonb(link))
        from public.timeline_event_links link
        where link.record_id = p_id and link.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'file_key') is not null then v_file_keys := jsonb_build_array(v_row ->> 'file_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'title', ''), 'Untitled record');
    v_context := jsonb_build_object('space', v_row ->> 'section', 'folderId', v_row -> 'folder_id');
    delete from public.vault_items where id = p_id and user_id = p_owner;

  elsif p_kind = 'contact' then
    select to_jsonb(item) into v_row from public.contacts item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That contact is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'record_shares', coalesce((
        select jsonb_agg(to_jsonb(share))
        from public.record_shares share
        where share.resource_type = 'contact' and share.resource_id = p_id and share.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'photo_key') is not null then v_file_keys := jsonb_build_array(v_row ->> 'photo_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'full_name', ''), 'Untitled contact');
    v_context := jsonb_build_object('space', 'contacts', 'folderId', v_row -> 'folder_id');
    delete from public.record_shares where resource_type = 'contact' and resource_id = p_id and owner_id = p_owner;
    delete from public.contacts where id = p_id and user_id = p_owner;

  elsif p_kind = 'business_card' then
    select to_jsonb(item) into v_row from public.business_cards item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That business card is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'record_shares', coalesce((
        select jsonb_agg(to_jsonb(share))
        from public.record_shares share
        where share.resource_type = 'business_card' and share.resource_id = p_id and share.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'profile_photo_key') is not null then v_file_keys := v_file_keys || jsonb_build_array(v_row ->> 'profile_photo_key'); end if;
    if (v_row ->> 'business_logo_key') is not null then v_file_keys := v_file_keys || jsonb_build_array(v_row ->> 'business_logo_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'full_name', ''), nullif(v_row ->> 'company_name', ''), 'Untitled business card');
    v_context := jsonb_build_object('space', 'business_cards', 'folderId', v_row -> 'folder_id');
    delete from public.record_shares where resource_type = 'business_card' and resource_id = p_id and owner_id = p_owner;
    delete from public.business_cards where id = p_id and user_id = p_owner;

  elsif p_kind = 'medical_record' then
    select to_jsonb(item) into v_row from public.medical_records item where item.id = p_id and item.user_id = p_owner;
    if v_row is null then raise exception 'That medical record is not available in your account.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'medical_links', coalesce((
        select jsonb_agg(to_jsonb(link))
        from public.medical_record_links link
        where link.medical_record_id = p_id and link.owner_id = p_owner
      ), '[]'::jsonb)
    );
    if (v_row ->> 'file_key') is not null then v_file_keys := jsonb_build_array(v_row ->> 'file_key'); end if;
    v_title := coalesce(nullif(v_row ->> 'title', ''), 'Untitled medical record');
    v_context := jsonb_build_object('space', 'medical_records', 'recordType', v_row ->> 'record_type', 'folderId', v_row -> 'folder_id');
    delete from public.medical_records where id = p_id and user_id = p_owner;

  elsif p_kind = 'timeline_event' then
    select to_jsonb(event) into v_row
    from public.timeline_events event
    where event.id = p_id and event.user_id = p_owner and event.event_type = 'manual';
    if v_row is null then raise exception 'Only your own manual timeline posts can be deleted.' using errcode = 'P0404'; end if;
    v_relations := jsonb_build_object(
      'timeline_links', coalesce((
        select jsonb_agg(to_jsonb(link))
        from public.timeline_event_links link
        where link.event_id = p_id and link.owner_id = p_owner
      ), '[]'::jsonb)
    );
    -- Timeline content stays encrypted; only non-secret metadata (supplied by the
    -- caller after local decryption) names this entry in the Trash.
    v_title := coalesce(nullif(trim(p_file_keys ->> 'title'), ''), 'Timeline entry');
    v_file_keys := coalesce(p_file_keys -> 'keys', '[]'::jsonb);
    v_context := jsonb_build_object('space', 'timeline', 'eventDate', v_row ->> 'event_date');
    delete from public.timeline_events where id = p_id and user_id = p_owner and event_type = 'manual';
  else
    raise exception 'This content type cannot go to the Trash.' using errcode = 'P0400';
  end if;

  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id, p_owner, p_kind, v_title, v_context,
    jsonb_build_object('row', v_row, 'relations', v_relations),
    v_file_keys, 'active', v_now, v_now + interval '7 days'
  )
  returning * into v_trash;

  return to_jsonb(v_trash);
end;
$function$;
revoke all on function public.persora_trash_move(p_owner uuid, p_kind text, p_id uuid, p_file_keys jsonb) from public, anon, authenticated;
grant execute on function public.persora_trash_move(p_owner uuid, p_kind text, p_id uuid, p_file_keys jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_purge_expired_rows(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  with expired as (
    select id, owner_id, file_keys
    from public.trash_items
    where status in ('active', 'purging') and expires_at <= clock_timestamp()
    order by expires_at asc
    limit greatest(coalesce(p_limit, 500), 1)
    for update skip locked
  ),
  released as (
    insert into public.trash_file_releases (owner_id, file_key)
    select expired.owner_id, released_key.key
    from expired
    cross join lateral jsonb_array_elements_text(coalesce(expired.file_keys, '[]'::jsonb)) as released_key(key)
    on conflict do nothing
    returning id
  ),
  removed as (
    delete from public.trash_items where id in (select id from expired) returning id
  )
  select count(*) from removed into v_count;
  return v_count;
end;
$function$;
revoke all on function public.persora_trash_purge_expired_rows(p_limit integer) from public, anon, authenticated;
grant execute on function public.persora_trash_purge_expired_rows(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_release_purge(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  update public.trash_items
  set status = 'active', purge_claimed_at = null, updated_at = clock_timestamp()
  where id = any(coalesce(p_ids, array[]::uuid[])) and status = 'purging';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.persora_trash_release_purge(p_ids uuid[]) from public, anon, authenticated;
grant execute on function public.persora_trash_release_purge(p_ids uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.persora_trash_restore(p_owner uuid, p_trash_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_relations jsonb;
  v_note text := '';
  v_folder_missing boolean := false;
  v_link jsonb;
  v_event jsonb;
  v_share jsonb;
  v_comment jsonb;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id
    and owner_id = p_owner
    and status = 'active'
    and expires_at > clock_timestamp()
  returning * into v_trash;

  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  v_relations := coalesce(v_trash.payload -> 'relations', '{}'::jsonb);

  if (v_row ->> 'folder_id') is not null then
    if not exists (select 1 from public.vault_folders where id = (v_row ->> 'folder_id')::uuid and user_id = p_owner) then
      v_row := jsonb_set(v_row, '{folder_id}', 'null'::jsonb);
      v_folder_missing := true;
    end if;
  end if;

  if v_trash.kind = 'vault_item' then
    insert into public.vault_items select * from jsonb_populate_record(null::public.vault_items, v_row);

    -- Automatic timeline events re-generate on demand; both insert paths use
    -- conflict guards so duplicate restoration can never corrupt either side.
    for v_event in select value from jsonb_array_elements(coalesce(v_relations -> 'timeline_events', '[]'::jsonb)) loop
      begin
        insert into public.timeline_events select * from jsonb_populate_record(null::public.timeline_events, v_event);
      exception when unique_violation then null;
      end;
    end loop;

    for v_link in select value from jsonb_array_elements(coalesce(v_relations -> 'timeline_links', '[]'::jsonb)) loop
      if ((v_link ->> 'record_id')::uuid) <> v_trash.id
         and not exists (select 1 from public.vault_items where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A timeline link pointed at a record that no longer exists and was skipped. ';
        continue;
      end if;
      if not exists (
        select 1 from public.timeline_events
        where id = (v_link ->> 'event_id')::uuid and user_id = p_owner
      ) then
        v_note := v_note || 'A linked timeline entry no longer exists and its link was skipped. ';
        continue;
      end if;
      begin
        insert into public.timeline_event_links select * from jsonb_populate_record(null::public.timeline_event_links, v_link);
      exception when unique_violation then null;
      end;
    end loop;

    for v_share in select value from jsonb_array_elements(coalesce(v_relations -> 'shares', '[]'::jsonb)) loop
      begin
        insert into public.vault_shares select * from jsonb_populate_record(null::public.vault_shares, v_share);
      exception when unique_violation then null;
      end;
    end loop;

    for v_comment in select value from jsonb_array_elements(coalesce(v_relations -> 'comments', '[]'::jsonb)) loop
      if not exists (select 1 from public.vault_shares where id = (v_comment ->> 'share_id')::uuid) then
        continue;
      end if;
      begin
        insert into public.vault_share_comments select * from jsonb_populate_record(null::public.vault_share_comments, v_comment);
      exception when unique_violation then null;
      end;
    end loop;

  elsif v_trash.kind = 'contact' then
    insert into public.contacts select * from jsonb_populate_record(null::public.contacts, v_row);
  elsif v_trash.kind = 'business_card' then
    insert into public.business_cards select * from jsonb_populate_record(null::public.business_cards, v_row);
  elsif v_trash.kind = 'medical_record' then
    insert into public.medical_records select * from jsonb_populate_record(null::public.medical_records, v_row);
    for v_link in select value from jsonb_array_elements(coalesce(v_relations -> 'medical_links', '[]'::jsonb)) loop
      if (v_link ->> 'record_type') = 'vault_item'
         and not exists (select 1 from public.vault_items where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A linked record no longer exists and its link was skipped. ';
        continue;
      end if;
      if (v_link ->> 'record_type') = 'contact'
         and not exists (select 1 from public.contacts where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A linked contact no longer exists and its link was skipped. ';
        continue;
      end if;
      begin
        insert into public.medical_record_links select * from jsonb_populate_record(null::public.medical_record_links, v_link);
      exception when unique_violation then null;
      end;
    end loop;
  elsif v_trash.kind = 'timeline_event' then
    insert into public.timeline_events select * from jsonb_populate_record(null::public.timeline_events, v_row);
    for v_link in select value from jsonb_array_elements(coalesce(v_relations -> 'timeline_links', '[]'::jsonb)) loop
      if not exists (select 1 from public.vault_items where id = (v_link ->> 'record_id')::uuid) then
        v_note := v_note || 'A record linked to this timeline entry no longer exists and its link was skipped. ';
        continue;
      end if;
      begin
        insert into public.timeline_event_links select * from jsonb_populate_record(null::public.timeline_event_links, v_link);
      exception when unique_violation then null;
      end;
    end loop;
  else
    raise exception 'This Trash entry cannot be restored.' using errcode = 'P0400';
  end if;

  if v_trash.kind in ('contact', 'business_card') then
    for v_share in select value from jsonb_array_elements(coalesce(v_relations -> 'record_shares', '[]'::jsonb)) loop
      begin
        insert into public.record_shares select * from jsonb_populate_record(null::public.record_shares, v_share);
      exception when unique_violation then null;
      end;
    end loop;
  end if;

  if v_folder_missing then
    v_note := 'Restored without its folder because that folder no longer exists. ' || v_note;
  end if;

  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', nullif(btrim(v_note), ''));
end;
$function$;
revoke all on function public.persora_trash_restore(p_owner uuid, p_trash_id uuid) from public, anon, authenticated;
grant execute on function public.persora_trash_restore(p_owner uuid, p_trash_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_touch_session(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_touch_session(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer) from public, anon, authenticated;
revoke all on function public.persora_vault_touch_session(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer) from service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_apply(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_apply(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_changes jsonb) from public, anon, authenticated;
grant execute on function public.persora_vault_apply(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_changes jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_open_session(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_open_session(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer) from public, anon, authenticated;
revoke all on function public.persora_vault_open_session(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer) from service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_password_problem(p_password text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case
    when p_password is null or char_length(p_password) < 10 then 'too_short'
    when octet_length(p_password) > 72 then 'too_long'
    else null end;
$function$;
revoke all on function public.persora_vault_password_problem(p_password text) from public, anon, authenticated;
revoke all on function public.persora_vault_password_problem(p_password text) from service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_same_as_login(p_user_id uuid, p_password text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare login_hash text;
begin
  select password_hash into login_hash from public.profiles where id = p_user_id;
  return coalesce(login_hash like '$2%' and crypt(p_password, login_hash) = login_hash, false);
end $function$;
revoke all on function public.persora_vault_same_as_login(p_user_id uuid, p_password text) from public, anon, authenticated;
revoke all on function public.persora_vault_same_as_login(p_user_id uuid, p_password text) from service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_snapshot(p_user_id uuid, p_since bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;
revoke all on function public.persora_vault_snapshot(p_user_id uuid, p_since bigint) from public, anon, authenticated;
revoke all on function public.persora_vault_snapshot(p_user_id uuid, p_since bigint) from service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_create_master(p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_create_master(p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer) from public, anon, authenticated;
grant execute on function public.persora_vault_create_master(p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_items(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_since bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare expires timestamptz;
begin
  expires := public.persora_vault_touch_session(p_user_id, p_session_id, p_token_hash, p_now, p_idle_seconds);
  if expires is null then return jsonb_build_object('outcome', 'locked'); end if;
  return jsonb_build_object('outcome', 'ok', 'expiresAt', expires) || public.persora_vault_snapshot(p_user_id, p_since);
end $function$;
revoke all on function public.persora_vault_items(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_since bigint) from public, anon, authenticated;
grant execute on function public.persora_vault_items(p_user_id uuid, p_session_id uuid, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_since bigint) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_lock(p_user_id uuid, p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with gone as (delete from public.password_vault_sessions where user_id = p_user_id and token_hash = p_token_hash returning 1)
  select jsonb_build_object('outcome', 'ok', 'locked', (select count(*) from gone));
$function$;
revoke all on function public.persora_vault_lock(p_user_id uuid, p_token_hash text) from public, anon, authenticated;
grant execute on function public.persora_vault_lock(p_user_id uuid, p_token_hash text) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_unlock_fingerprint(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select encode(digest('persora-password-vault-unlock|' || p_user_id::text, 'sha256'), 'hex');
$function$;
revoke all on function public.persora_vault_unlock_fingerprint(p_user_id uuid) from public, anon, authenticated;
revoke all on function public.persora_vault_unlock_fingerprint(p_user_id uuid) from service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_unlock(p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer, p_max_failures integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_unlock(p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer, p_max_failures integer) from public, anon, authenticated;
grant execute on function public.persora_vault_unlock(p_user_id uuid, p_session_id uuid, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer, p_max_failures integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_reset_complete(p_user_id uuid, p_session_id uuid, p_grant_hash text, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_reset_complete(p_user_id uuid, p_session_id uuid, p_grant_hash text, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer) from public, anon, authenticated;
grant execute on function public.persora_vault_reset_complete(p_user_id uuid, p_session_id uuid, p_grant_hash text, p_password text, p_token_hash text, p_now timestamp with time zone, p_idle_seconds integer, p_max_seconds integer) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_reset_verify(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer, p_grant_hash text, p_grant_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
revoke all on function public.persora_vault_reset_verify(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer, p_grant_hash text, p_grant_expires_at timestamp with time zone) from public, anon, authenticated;
grant execute on function public.persora_vault_reset_verify(p_user_id uuid, p_email text, p_candidate_hash text, p_now timestamp with time zone, p_max_attempts integer, p_grant_hash text, p_grant_expires_at timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.persora_vault_status(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'hasVault', exists (select 1 from public.password_vaults where user_id = p_user_id and master_password_hash is not null),
    'records', (select count(*) from public.password_vault_items where user_id = p_user_id and not deleted),
    'pending', (select count(*) from public.password_vault_items where user_id = p_user_id and not deleted and data is null));
$function$;
revoke all on function public.persora_vault_status(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.persora_vault_status(p_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.persora_verify_password(p_password text, p_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_password is null or p_hash is null or octet_length(p_password) > 72 or p_hash not like '$2%' then
    return false;
  end if;
  return crypt(p_password, p_hash) = p_hash;
end;
$function$;
revoke all on function public.persora_verify_password(p_password text, p_hash text) from public, anon, authenticated;
grant execute on function public.persora_verify_password(p_password text, p_hash text) to service_role;

CREATE OR REPLACE FUNCTION public.reserve_email_verification_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer)
 RETURNS TABLE(allowed boolean, reason text, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
revoke all on function public.reserve_email_verification_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer) from public, anon, authenticated;
grant execute on function public.reserve_email_verification_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer) to service_role;

CREATE OR REPLACE FUNCTION public.reserve_password_recovery_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer)
 RETURNS TABLE(allowed boolean, reason text, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
revoke all on function public.reserve_password_recovery_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer) from public, anon, authenticated;
grant execute on function public.reserve_password_recovery_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer) to service_role;

CREATE OR REPLACE FUNCTION public.reserve_vault_recovery_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer)
 RETURNS TABLE(allowed boolean, reason text, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
revoke all on function public.reserve_vault_recovery_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer) from public, anon, authenticated;
grant execute on function public.reserve_vault_recovery_send(p_user_id uuid, p_email text, p_code_hash text, p_now timestamp with time zone, p_expires_at timestamp with time zone, p_resend_seconds integer, p_window_seconds integer, p_max_sends integer) to service_role;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end;
$function$;

create or replace function public.persora__project_task_attachment_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_member record;
begin
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(v_member.user_id, new.uploader_id, new.project_id, new.field_id, new.task_id, 'attachment', 'Task attachment added', 'A private attachment was added to a project task.', 'task-attachment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
revoke all on function public.persora__project_task_attachment_notify() from public, anon, authenticated;
grant execute on function public.persora__project_task_attachment_notify() to service_role;

create or replace function public.persora__project_task_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_member record; v_field uuid;
begin
  select t.field_id into v_field from public.project_tasks t where t.id = new.task_id;
  for v_member in
    select p.owner_id as user_id from public.projects p where p.id = new.project_id
    union select m.user_id from public.project_members m where m.project_id = new.project_id
  loop
    perform public.persora__project_notify(v_member.user_id, new.author_id, new.project_id, v_field, new.task_id, 'comment', 'New task comment', 'A member commented on a project task.', 'task-comment:' || new.id::text);
  end loop;
  return new;
end;
$function$;
revoke all on function public.persora__project_task_comment_notify() from public, anon, authenticated;
grant execute on function public.persora__project_task_comment_notify() to service_role;

create or replace function public.persora__project_task_notify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_field public.project_fields; v_project_owner uuid; v_actor uuid; v_event text;
begin
  select * into v_field from public.project_fields f where f.id = new.field_id and f.project_id = new.project_id;
  select p.owner_id into v_project_owner from public.projects p where p.id = new.project_id;
  v_actor := case when tg_op = 'INSERT' then new.created_by else coalesce(new.updated_by, new.created_by) end;
  v_event := new.id::text || ':' || new.updated_at::text;
  if tg_op = 'INSERT' then
    perform public.persora__project_notify(new.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task assigned to you', 'You have been assigned a project task.', 'task-assigned:' || v_event);
  else
    if new.assignee_id is distinct from old.assignee_id then
      perform public.persora__project_notify(new.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task assigned to you', 'You have been assigned a project task.', 'task-assigned:' || v_event);
      if old.assignee_id is not null then
        perform public.persora__project_notify(old.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task assignment changed', 'A project task assignment has changed.', 'task-unassigned:' || v_event);
      end if;
    end if;
    if old.status is distinct from new.status and new.status = 'complete' then
      perform public.persora__project_notify(new.created_by, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task completed', 'A project task was completed.', 'task-completed:' || v_event);
      perform public.persora__project_notify(v_field.assignee_id, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task completed', 'A project task was completed.', 'task-completed:' || v_event);
      perform public.persora__project_notify(v_project_owner, v_actor, new.project_id, new.field_id, new.id, 'task', 'Task completed', 'A project task was completed.', 'task-completed:' || v_event);
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.persora__project_task_notify() from public, anon, authenticated;
grant execute on function public.persora__project_task_notify() to service_role;

create or replace function public.persora_project_create(
  p_user uuid,
  p_name text,
  p_description text default ''::text,
  p_kind text default 'personal'::text,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_project public.projects;
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_category text := trim(coalesce(v_opts->>'category', ''));
  v_tags text[] := '{}'::text[];
  v_start date := nullif(trim(coalesce(v_opts->>'start_date', '')), '')::date;
  v_due date := nullif(trim(coalesce(v_opts->>'due_date', '')), '')::date;
  v_priority text := lower(trim(coalesce(nullif(v_opts->>'priority', ''), 'normal')));
  v_paused boolean := coalesce((v_opts->>'paused')::boolean, false);
  v_archived boolean := coalesce((v_opts->>'archived')::boolean, false);
begin
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  if char_length(v_category) > 80 then raise exception 'Keep the project category under 80 characters.' using errcode = 'P0400'; end if;
  if v_opts ? 'tags' and v_opts->'tags' is not null and jsonb_typeof(v_opts->'tags') <> 'null' then
    if jsonb_typeof(v_opts->'tags') <> 'array' then raise exception 'Provide project tags as a list.' using errcode = 'P0400'; end if;
    select coalesce(array_agg(cleaned order by first_ord), '{}'::text[]) into v_tags
    from (
      select trim(val) as cleaned, min(ord) as first_ord
      from jsonb_array_elements_text(v_opts->'tags') with ordinality as elem(val, ord)
      where trim(val) <> ''
      group by trim(val)
    ) dedup;
    if coalesce(array_length(v_tags, 1), 0) > 12 then raise exception 'Add up to 12 project tags.' using errcode = 'P0400'; end if;
    if exists (select 1 from unnest(v_tags) as tag where char_length(tag) > 40) then
      raise exception 'Keep each project tag under 40 characters.' using errcode = 'P0400';
    end if;
  end if;
  if v_priority not in ('high', 'medium', 'normal', 'low') then
    raise exception 'Choose a valid project priority.' using errcode = 'P0400';
  end if;
  if v_start is not null and v_due is not null and v_due < v_start then
    raise exception 'Target due date cannot be earlier than the start date.' using errcode = 'P0400';
  end if;
  insert into public.projects (owner_id, name, description, kind, category, tags, start_date, due_date, priority, paused, archived)
  values (
    p_user,
    trim(coalesce(p_name, '')),
    coalesce(p_description, ''),
    coalesce(nullif(p_kind, ''), 'personal'),
    v_category,
    v_tags,
    v_start,
    v_due,
    v_priority,
    v_paused,
    v_archived
  )
  returning * into v_project;
  perform public.persora__project_log(v_project.id, p_user, 'project_created', v_project.name);
  return to_jsonb(v_project);
end;
$function$;
revoke all on function public.persora_project_create(p_user uuid, p_name text, p_description text, p_kind text, p_options jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_create(p_user uuid, p_name text, p_description text, p_kind text, p_options jsonb) to service_role;

create or replace function public.persora_project_update(
  p_user uuid,
  p_project uuid,
  p_name text,
  p_description text,
  p_kind text,
  p_options jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_project public.projects;
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_tags text[];
  v_priority text;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if not v_access.is_owner then
    raise exception 'Only the project owner can edit these settings.' using errcode = 'P0403';
  end if;
  select * into v_project from public.projects p where p.id = p_project for update;
  if not found then raise exception 'That project is not available.' using errcode = 'P0404'; end if;
  if p_kind = 'personal' and exists (select 1 from public.project_members m where m.project_id = p_project) then
    raise exception 'Remove every member before converting this project to Personal.' using errcode = 'P0409';
  end if;
  if v_opts ? 'category' then
    v_project.category := trim(coalesce(v_opts->>'category', ''));
    if char_length(v_project.category) > 80 then raise exception 'Keep the project category under 80 characters.' using errcode = 'P0400'; end if;
  end if;
  if v_opts ? 'tags' then
    if v_opts->'tags' is null or jsonb_typeof(v_opts->'tags') = 'null' then
      v_project.tags := '{}'::text[];
    else
      if jsonb_typeof(v_opts->'tags') <> 'array' then raise exception 'Provide project tags as a list.' using errcode = 'P0400'; end if;
      select coalesce(array_agg(cleaned order by first_ord), '{}'::text[]) into v_tags
      from (
        select trim(val) as cleaned, min(ord) as first_ord
        from jsonb_array_elements_text(v_opts->'tags') with ordinality as elem(val, ord)
        where trim(val) <> ''
        group by trim(val)
      ) dedup;
      if coalesce(array_length(v_tags, 1), 0) > 12 then raise exception 'Add up to 12 project tags.' using errcode = 'P0400'; end if;
      if exists (select 1 from unnest(v_tags) as tag where char_length(tag) > 40) then
        raise exception 'Keep each project tag under 40 characters.' using errcode = 'P0400';
      end if;
      v_project.tags := v_tags;
    end if;
  end if;
  if v_opts ? 'start_date' then
    v_project.start_date := nullif(trim(coalesce(v_opts->>'start_date', '')), '')::date;
  end if;
  if v_opts ? 'due_date' then
    v_project.due_date := nullif(trim(coalesce(v_opts->>'due_date', '')), '')::date;
  end if;
  if v_project.start_date is not null and v_project.due_date is not null and v_project.due_date < v_project.start_date then
    raise exception 'Target due date cannot be earlier than the start date.' using errcode = 'P0400';
  end if;
  if v_opts ? 'priority' then
    v_priority := lower(trim(coalesce(nullif(v_opts->>'priority', ''), 'normal')));
    if v_priority not in ('high', 'medium', 'normal', 'low') then
      raise exception 'Choose a valid project priority.' using errcode = 'P0400';
    end if;
    v_project.priority := v_priority;
  end if;
  if v_opts ? 'paused' and v_opts->'paused' is not null and jsonb_typeof(v_opts->'paused') <> 'null' then
    v_project.paused := (v_opts->>'paused')::boolean;
  end if;
  if v_opts ? 'archived' and v_opts->'archived' is not null and jsonb_typeof(v_opts->'archived') <> 'null' then
    v_project.archived := (v_opts->>'archived')::boolean;
  end if;
  update public.projects
  set name = trim(coalesce(p_name, v_project.name)),
      description = coalesce(p_description, v_project.description),
      kind = coalesce(nullif(p_kind, ''), v_project.kind),
      category = v_project.category,
      tags = v_project.tags,
      start_date = v_project.start_date,
      due_date = v_project.due_date,
      priority = v_project.priority,
      paused = v_project.paused,
      archived = v_project.archived,
      updated_at = now()
  where id = p_project
  returning * into v_project;
  perform public.persora__project_log(p_project, p_user, 'project_updated', v_project.name);
  return to_jsonb(v_project);
end;
$function$;
revoke all on function public.persora_project_update(p_user uuid, p_project uuid, p_name text, p_description text, p_kind text, p_options jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_update(p_user uuid, p_project uuid, p_name text, p_description text, p_kind text, p_options jsonb) to service_role;

create or replace function public.persora_project_task_create(p_user uuid, p_project uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_access record;
  v_field public.project_fields;
  v_task public.project_tasks;
  v_name text;
  v_description text;
  v_status text;
  v_priority text;
  v_assignee uuid;
  v_order integer;
begin
  select * into v_access from public.persora__project_access(p_user, p_project);
  if p_user is null then raise exception 'Sign in is required.' using errcode = 'P0401'; end if;
  if nullif(p_payload->>'field_id', '') is null then raise exception 'Choose a field for this task.' using errcode = 'P0400'; end if;
  select * into v_field from public.project_fields f
  where f.id = (p_payload->>'field_id')::uuid and f.project_id = p_project for update;
  if not found then raise exception 'Choose a field from this project.' using errcode = 'P0400'; end if;
  if not (v_access.is_owner or v_field.assignee_id = p_user) then
    raise exception 'Only the project owner or the assignee of this field can create tasks.' using errcode = 'P0403';
  end if;
  v_name := trim(coalesce(p_payload->>'name', ''));
  if char_length(v_name) not between 1 and 240 then raise exception 'Enter a task name between 1 and 240 characters.' using errcode = 'P0400'; end if;
  v_description := coalesce(p_payload->>'description', '');
  if char_length(v_description) > 4000 then raise exception 'Keep the task description under 4,000 characters.' using errcode = 'P0400'; end if;
  v_status := coalesce(nullif(p_payload->>'status', ''), 'todo');
  if v_status not in ('todo', 'in-progress', 'in-review') then
    raise exception 'New tasks cannot start as Complete; choose To Do, In Progress, or In Review.' using errcode = 'P0400';
  end if;
  v_priority := lower(trim(coalesce(nullif(p_payload->>'priority', ''), 'normal')));
  if v_priority not in ('high', 'medium', 'normal', 'low') then
    raise exception 'Choose a valid task priority.' using errcode = 'P0400';
  end if;
  v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
  perform public.persora__project_validate_task_assignee(p_project, v_assignee);
  select coalesce(max(t.sort_order), 0) + 10 into v_order
  from public.project_tasks t where t.project_id = p_project and t.status = v_status;
  insert into public.project_tasks(project_id, field_id, name, description, status, priority, assignee_id, created_by, updated_by, sort_order)
  values (p_project, v_field.id, v_name, v_description, v_status, v_priority, v_assignee, p_user, p_user, v_order)
  returning * into v_task;
  perform public.persora__project_log(p_project, p_user, 'task_created', left(v_task.name, 200));
  return to_jsonb(v_task);
end;
$function$;
revoke all on function public.persora_project_task_create(p_user uuid, p_project uuid, p_payload jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_task_create(p_user uuid, p_project uuid, p_payload jsonb) to service_role;

create or replace function public.persora_project_task_update(p_user uuid, p_task uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_destination public.project_fields;
  v_access record;
  v_old_status text;
  v_new_status text;
  v_priority text;
  v_assignee uuid;
  v_destination_id uuid;
  v_order integer;
begin
  v_task := public.persora__project_can_manage_task(p_user, p_task);
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  v_old_status := v_task.status;
  v_new_status := v_task.status;

  if p_payload ? 'name' then
    if char_length(trim(coalesce(p_payload->>'name', ''))) not between 1 and 240 then
      raise exception 'Enter a task name between 1 and 240 characters.' using errcode = 'P0400';
    end if;
    v_task.name := trim(p_payload->>'name');
  end if;
  if p_payload ? 'description' then
    if char_length(coalesce(p_payload->>'description', '')) > 4000 then
      raise exception 'Keep the task description under 4,000 characters.' using errcode = 'P0400';
    end if;
    v_task.description := p_payload->>'description';
  end if;
  if p_payload ? 'priority' then
    v_priority := lower(trim(coalesce(nullif(p_payload->>'priority', ''), 'normal')));
    if v_priority not in ('high', 'medium', 'normal', 'low') then
      raise exception 'Choose a valid task priority.' using errcode = 'P0400';
    end if;
    v_task.priority := v_priority;
  end if;
  if p_payload ? 'assignee_id' then
    v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
    perform public.persora__project_validate_task_assignee(v_task.project_id, v_assignee);
    v_task.assignee_id := v_assignee;
  end if;
  if p_payload ? 'field_id' then
    v_destination_id := nullif(p_payload->>'field_id', '')::uuid;
    if v_destination_id is null then raise exception 'Choose a field for this task.' using errcode = 'P0400'; end if;
    select * into v_destination from public.project_fields f
    where f.id = v_destination_id and f.project_id = v_task.project_id for update;
    if not found then raise exception 'Choose a field from this project.' using errcode = 'P0400'; end if;
    if not (v_access.is_owner or v_destination.assignee_id = p_user) then
      raise exception 'The task must stay within a field you can manage.' using errcode = 'P0403';
    end if;
    v_task.field_id := v_destination.id;
  end if;
  if p_payload ? 'status' then
    v_new_status := p_payload->>'status';
    if v_new_status not in ('todo', 'in-progress', 'in-review', 'complete') then
      raise exception 'Choose a valid task status.' using errcode = 'P0400';
    end if;
    if v_new_status is distinct from v_old_status then
      if v_task.paused then
        raise exception 'Resume this paused task before moving it to another column.' using errcode = 'P0409';
      end if;
      if v_field.status = 'blocked' or (v_destination.id is not null and v_destination.status = 'blocked') then
        raise exception 'This task''s field is paused. Resume the field before moving its tasks to another column.' using errcode = 'P0409';
      end if;
    end if;
    if v_new_status = 'complete' and v_task.status <> 'in-review' and v_task.status <> 'complete' then
      raise exception 'Move the task to In Review before completing it.' using errcode = 'P0409';
    end if;
    v_task.status := v_new_status;
  end if;

  if v_task.status is distinct from v_old_status then
    select coalesce(max(t.sort_order), 0) + 10 into v_order
    from public.project_tasks t
    where t.project_id = v_task.project_id and t.status = v_task.status and t.id <> v_task.id;
    v_task.sort_order := v_order;
  end if;
  update public.project_tasks
  set field_id = v_task.field_id, name = v_task.name, description = v_task.description,
      status = v_task.status, priority = v_task.priority, assignee_id = v_task.assignee_id,
      sort_order = v_task.sort_order, updated_at = now(), updated_by = p_user
  where id = p_task returning * into v_task;
  if v_task.field_id is distinct from v_field.id then
    update public.project_task_attachments set field_id = v_task.field_id where task_id = v_task.id;
  end if;

  if v_task.status is distinct from v_old_status then
    perform public.persora__project_log(v_task.project_id, p_user, 'task_status_changed', left(v_task.name || ' → ' || v_task.status, 200));
  elsif p_payload ? 'field_id' and v_task.field_id is distinct from v_field.id then
    perform public.persora__project_log(v_task.project_id, p_user, 'task_field_changed', left(v_task.name, 200));
  else
    perform public.persora__project_log(v_task.project_id, p_user, 'task_updated', left(v_task.name, 200));
  end if;
  return to_jsonb(v_task);
end;
$function$;
revoke all on function public.persora_project_task_update(p_user uuid, p_task uuid, p_payload jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_task_update(p_user uuid, p_task uuid, p_payload jsonb) to service_role;

create or replace function public.persora_project_task_move(p_user uuid, p_task uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_access record;
  v_order integer;
  v_can_manage boolean;
begin
  select * into v_task from public.project_tasks t where t.id = p_task for update;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  if p_status not in ('todo', 'in-progress', 'in-review', 'complete') then
    raise exception 'Choose a valid task status.' using errcode = 'P0400';
  end if;
  v_can_manage := v_access.is_owner or v_field.assignee_id = p_user;
  if v_can_manage then
    if p_status = 'complete' and v_task.status <> 'in-review' and v_task.status <> 'complete' then
      raise exception 'Move the task to In Review before completing it.' using errcode = 'P0409';
    end if;
  elsif v_task.assignee_id = p_user and v_task.status <> 'complete' and p_status in ('todo', 'in-progress', 'in-review') then
    null;
  else
    raise exception 'Only the project owner or field assignee can complete or reopen tasks; task assignees can move active tasks only.' using errcode = 'P0403';
  end if;
  if v_task.status = p_status then return to_jsonb(v_task); end if;
  if v_task.paused then
    raise exception 'Resume this paused task before moving it to another column.' using errcode = 'P0409';
  end if;
  if v_field.status = 'blocked' then
    raise exception 'This task''s field is paused. Resume the field before moving its tasks to another column.' using errcode = 'P0409';
  end if;
  select coalesce(max(t.sort_order), 0) + 10 into v_order
  from public.project_tasks t where t.project_id = v_task.project_id and t.status = p_status and t.id <> v_task.id;
  update public.project_tasks
  set status = p_status, sort_order = v_order, updated_at = now(), updated_by = p_user
  where id = p_task returning * into v_task;
  perform public.persora__project_log(v_task.project_id, p_user, 'task_status_changed', left(v_task.name || ' → ' || v_task.status, 200));
  return to_jsonb(v_task);
end;
$function$;
revoke all on function public.persora_project_task_move(p_user uuid, p_task uuid, p_status text) from public, anon, authenticated;
grant execute on function public.persora_project_task_move(p_user uuid, p_task uuid, p_status text) to service_role;

create or replace function public.persora_project_task_position(p_user uuid, p_task uuid, p_status text, p_sort_order integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_tasks;
  v_field public.project_fields;
  v_access record;
  v_old_status text;
  v_order integer;
  v_can_manage boolean;
begin
  select * into v_task from public.project_tasks t where t.id = p_task for update;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_field from public.project_fields f where f.id = v_task.field_id and f.project_id = v_task.project_id;
  if not found then raise exception 'That task is not available.' using errcode = 'P0404'; end if;
  select * into v_access from public.persora__project_access(p_user, v_task.project_id);
  if p_status not in ('todo', 'in-progress', 'in-review', 'complete') then
    raise exception 'Choose a valid task status.' using errcode = 'P0400';
  end if;
  v_can_manage := v_access.is_owner or v_field.assignee_id = p_user;
  if v_can_manage then
    if p_status = 'complete' and v_task.status <> 'in-review' and v_task.status <> 'complete' then
      raise exception 'Move the task to In Review before completing it.' using errcode = 'P0409';
    end if;
  elsif v_task.assignee_id = p_user and v_task.status <> 'complete' and p_status in ('todo', 'in-progress', 'in-review') then
    null;
  else
    raise exception 'Only the project owner or field assignee can complete or reopen tasks; task assignees can move active tasks only.' using errcode = 'P0403';
  end if;
  v_old_status := v_task.status;
  if v_old_status is distinct from p_status then
    if v_task.paused then
      raise exception 'Resume this paused task before moving it to another column.' using errcode = 'P0409';
    end if;
    if v_field.status = 'blocked' then
      raise exception 'This task''s field is paused. Resume the field before moving its tasks to another column.' using errcode = 'P0409';
    end if;
  end if;
  v_order := greatest(-100000000, least(100000000, coalesce(p_sort_order, v_task.sort_order, 0)));
  if v_old_status = p_status and v_task.sort_order = v_order then return to_jsonb(v_task); end if;
  update public.project_tasks
  set status = p_status, sort_order = v_order, updated_at = now(), updated_by = p_user
  where id = p_task returning * into v_task;
  if v_old_status is distinct from p_status then
    perform public.persora__project_log(v_task.project_id, p_user, 'task_status_changed', left(v_task.name || ' → ' || v_task.status, 200));
  end if;
  return to_jsonb(v_task);
end;
$function$;
revoke all on function public.persora_project_task_position(p_user uuid, p_task uuid, p_status text, p_sort_order integer) from public, anon, authenticated;
grant execute on function public.persora_project_task_position(p_user uuid, p_task uuid, p_status text, p_sort_order integer) to service_role;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
drop trigger if exists profiles_touch_updated_at on public.profiles;
CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists vault_folders_touch_updated_at on public.vault_folders;
CREATE TRIGGER vault_folders_touch_updated_at BEFORE UPDATE ON public.vault_folders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists calendar_events_guard on public.calendar_events;
CREATE TRIGGER calendar_events_guard BEFORE INSERT OR UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION persora_calendar_event_guard();
drop trigger if exists document_types_touch_updated_at on public.document_types;
CREATE TRIGGER document_types_touch_updated_at BEFORE UPDATE ON public.document_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists vault_items_touch_updated_at on public.vault_items;
CREATE TRIGGER vault_items_touch_updated_at BEFORE UPDATE ON public.vault_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists subscription_plans_touch_updated_at on public.subscription_plans;
CREATE TRIGGER subscription_plans_touch_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists pdf_studio_documents_folder_guard on public.pdf_studio_documents;
CREATE TRIGGER pdf_studio_documents_folder_guard BEFORE INSERT OR UPDATE OF folder_id, title, notes, file_key ON public.pdf_studio_documents FOR EACH ROW EXECUTE FUNCTION persora_pdf_studio_folder_guard();
drop trigger if exists photo_studio_photos_folder_guard on public.photo_studio_photos;
CREATE TRIGGER photo_studio_photos_folder_guard BEFORE INSERT OR UPDATE OF folder_id, title, category, notes ON public.photo_studio_photos FOR EACH ROW EXECUTE FUNCTION persora_photo_studio_folder_guard();
drop trigger if exists project_activity_notify on public.project_activity;
CREATE TRIGGER project_activity_notify AFTER INSERT ON public.project_activity FOR EACH ROW EXECUTE FUNCTION persora__project_activity_notify();
drop trigger if exists project_field_assignment_notify on public.project_fields;
CREATE TRIGGER project_field_assignment_notify AFTER UPDATE OF assignee_id ON public.project_fields FOR EACH ROW EXECUTE FUNCTION persora__project_field_assignment_notify();
drop trigger if exists project_field_initial_assignment_notify on public.project_fields;
CREATE TRIGGER project_field_initial_assignment_notify AFTER INSERT ON public.project_fields FOR EACH ROW EXECUTE FUNCTION persora__project_field_assignment_notify();
drop trigger if exists project_attachment_cleanup_enqueue on public.project_field_attachments;
CREATE TRIGGER project_attachment_cleanup_enqueue AFTER DELETE ON public.project_field_attachments FOR EACH ROW EXECUTE FUNCTION persora__project_queue_attachment_cleanup();
drop trigger if exists project_attachment_notify on public.project_field_attachments;
CREATE TRIGGER project_attachment_notify AFTER INSERT ON public.project_field_attachments FOR EACH ROW EXECUTE FUNCTION persora__project_attachment_notify();
drop trigger if exists project_comment_notify on public.project_field_comments;
CREATE TRIGGER project_comment_notify AFTER INSERT ON public.project_field_comments FOR EACH ROW EXECUTE FUNCTION persora__project_comment_notify();
drop trigger if exists project_request_notify on public.project_field_requests;
CREATE TRIGGER project_request_notify AFTER INSERT ON public.project_field_requests FOR EACH ROW EXECUTE FUNCTION persora__project_request_notify();
drop trigger if exists project_request_resolve_notify on public.project_field_requests;
CREATE TRIGGER project_request_resolve_notify AFTER UPDATE OF status ON public.project_field_requests FOR EACH ROW EXECUTE FUNCTION persora__project_request_notify();
drop trigger if exists project_task_notify on public.project_tasks;
CREATE TRIGGER project_task_notify AFTER INSERT OR UPDATE OF assignee_id, status ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION persora__project_task_notify();
drop trigger if exists project_tasks_sync_field_progress on public.project_tasks;
CREATE TRIGGER project_tasks_sync_field_progress AFTER INSERT OR DELETE OR UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION persora__project_task_progress_sync();
drop trigger if exists project_task_attachment_cleanup_enqueue on public.project_task_attachments;
CREATE TRIGGER project_task_attachment_cleanup_enqueue AFTER DELETE ON public.project_task_attachments FOR EACH ROW EXECUTE FUNCTION persora__project_queue_attachment_cleanup();
drop trigger if exists project_task_attachment_notify on public.project_task_attachments;
CREATE TRIGGER project_task_attachment_notify AFTER INSERT ON public.project_task_attachments FOR EACH ROW EXECUTE FUNCTION persora__project_task_attachment_notify();
drop trigger if exists project_task_comment_notify on public.project_task_comments;
CREATE TRIGGER project_task_comment_notify AFTER INSERT ON public.project_task_comments FOR EACH ROW EXECUTE FUNCTION persora__project_task_comment_notify();
drop trigger if exists timeline_events_touch_updated_at on public.timeline_events;
CREATE TRIGGER timeline_events_touch_updated_at BEFORE UPDATE ON public.timeline_events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists user_subscriptions_touch_updated_at on public.user_subscriptions;
CREATE TRIGGER user_subscriptions_touch_updated_at BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -----------------------------------------------------------------------------
-- Table Comments
-- -----------------------------------------------------------------------------
comment on table public.password_vaults is 'Password Manager: one row per member. master_password_hash is a bcrypt verifier (pgcrypto); the master password is never stored.';
comment on table public.password_vault_items is 'Password Manager records as JSON (data). Not application-encrypted: protected by Supabase encryption at rest, TLS, RLS-locked tables and server-side master-password sessions.';
comment on table public.password_vault_sessions is 'Password Manager unlock sessions (SHA-256 of the token only), bound to a Persora session.';

-- -----------------------------------------------------------------------------
-- Default Seed Records
-- -----------------------------------------------------------------------------
insert into public.admin_bootstrap_state (id) values (true) on conflict (id) do nothing;

insert into public.platform_settings (setting_key, value) values
  ('billing', '{"currency":"BDT","billingEnabled":false,"manualInstructions":"Contact Persora support for payment instructions."}'::jsonb),
  ('storage', '{"maxUploadMb":25,"defaultFreeGb":5}'::jsonb)
on conflict (setting_key) do nothing;

insert into public.subscription_plans (id, slug, name, description, storage_gb, price_per_gb_monthly, active, sort_order) values
  ('00000000-0000-4000-8000-000000000001', 'free', 'Free', 'A private place to get started.', 5.000, 0.0000, true, 0)
on conflict (slug) do nothing;

insert into public.document_types (id, name, active, sort_order) values
  ('national-id-nid', 'National ID / NID', true, 10),
  ('passport', 'Passport', true, 20),
  ('birth-certificate', 'Birth certificate', true, 30),
  ('student-id', 'Student ID', true, 40),
  ('job-id-employee-id', 'Job ID / Employee ID', true, 50),
  ('driving-licence', 'Driving licence', true, 60),
  ('tax-id-tin', 'Tax ID / TIN', true, 70),
  ('visa', 'Visa', true, 80),
  ('residence-permit', 'Residence permit', true, 90),
  ('work-permit', 'Work permit', true, 100),
  ('health-card', 'Health card', true, 110),
  ('insurance', 'Insurance', true, 120),
  ('certificate', 'Certificate', true, 130),
  ('contract', 'Contract', true, 140),
  ('other', 'Other', true, 999)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Optional Scheduled Reminder Wake (pg_cron when installed in Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'persora-calendar-reminders') then
      perform cron.schedule('persora-calendar-reminders', '* * * * *', $cron$select public.persora_calendar_dispatch_ping();$cron$);
    end if;
  end if;
exception when others then
  null;
end $$;

-- -----------------------------------------------------------------------------
-- Customizable Dashboard & Widget System (Layouts, Widgets, RLS & RPCs)
-- -----------------------------------------------------------------------------
create or replace function public.persora_jwt_uid()
returns uuid
language plpgsql
stable
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_sub text;
begin
  v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  if v_sub is null then
    v_sub := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  end if;
  if v_sub is null or v_sub = '' then
    return null;
  end if;
  return v_sub::uuid;
exception when others then
  return null;
end;
$function$;
revoke all on function public.persora_jwt_uid() from public, anon;
grant execute on function public.persora_jwt_uid() to authenticated, service_role;

create table if not exists public.dashboard_layouts (
  user_id uuid not null,
  active_preset text not null default 'custom'::text,
  revision integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint dashboard_layouts_pkey primary key (user_id),
  constraint dashboard_layouts_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint dashboard_layouts_preset_check check (
    active_preset = any (array[
      'custom'::text,
      'balanced'::text,
      'productivity'::text,
      'personal-records'::text,
      'payments-and-renewals'::text,
      'minimal'::text
    ])
  ),
  constraint dashboard_layouts_revision_check check (revision >= 1)
);

alter table public.dashboard_layouts enable row level security;
drop policy if exists dashboard_layouts_owner_policy on public.dashboard_layouts;
create policy dashboard_layouts_owner_policy on public.dashboard_layouts
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.dashboard_layouts from public, anon, authenticated;
grant all on public.dashboard_layouts to service_role;

create table if not exists public.dashboard_widgets (
  user_id uuid not null,
  widget_id text not null,
  widget_type text not null,
  title text not null,
  config jsonb not null default '{}'::jsonb,
  "position" integer not null default 0,
  width text not null default 'half'::text,
  height text not null default 'standard'::text,
  visible boolean not null default true,
  collapsed boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint dashboard_widgets_pkey primary key (user_id, widget_id),
  constraint dashboard_widgets_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint dashboard_widgets_id_format check (widget_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$'::text),
  constraint dashboard_widgets_type_check check (
    widget_type = any (array[
      'quick-actions'::text,
      'calendar-agenda'::text,
      'tasks-due'::text,
      'upcoming-reminders'::text,
      'habit-tracker'::text,
      'quick-note'::text,
      'recently-opened'::text,
      'project-progress'::text,
      'recent-project-activity'::text,
      'expiring-documents'::text,
      'recent-documents'::text,
      'pinned-folders'::text,
      'family-document-overview'::text,
      'academic-records'::text,
      'warranty-expiry'::text,
      'recent-uploads'::text,
      'upcoming-loan-installments'::text,
      'subscription-renewals'::text,
      'combined-upcoming-payments'::text,
      'payment-status-summary'::text,
      'favorite-urls'::text,
      'digital-memberships'::text,
      'contact-shortcuts'::text,
      'pdf-studio-shortcut'::text,
      'photo-studio-shortcut'::text,
      'medical-records-shortcut'::text,
      'password-vault-status'::text,
      'google-drive-status'::text,
      'external-storage-status'::text,
      'connected-service-shortcuts'::text
    ])
  ),
  constraint dashboard_widgets_title_check check (char_length(title) >= 1 and char_length(title) <= 120),
  constraint dashboard_widgets_config_shape check (jsonb_typeof(config) = 'object'::text and pg_column_size(config) <= 8192),
  constraint dashboard_widgets_position_check check ("position" >= 0 and "position" < 64),
  constraint dashboard_widgets_width_check check (width = any (array['compact'::text, 'half'::text, 'two-thirds'::text, 'full'::text])),
  constraint dashboard_widgets_height_check check (height = any (array['compact'::text, 'standard'::text, 'expanded'::text]))
);

create index if not exists dashboard_widgets_owner_pos_idx
  on public.dashboard_widgets using btree (user_id, "position" asc);

alter table public.dashboard_widgets enable row level security;
drop policy if exists dashboard_widgets_owner_policy on public.dashboard_widgets;
create policy dashboard_widgets_owner_policy on public.dashboard_widgets
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.dashboard_widgets from public, anon, authenticated;
grant all on public.dashboard_widgets to service_role;

comment on table public.dashboard_layouts is 'Customizable Dashboard per-member layout metadata, active preset, and optimistic concurrency revision.';
comment on table public.dashboard_widgets is 'Customizable Dashboard per-member widget instances, positions, sizes, visibility, collapse state, and validated JSON configuration.';

create or replace function public.persora_dashboard_load(p_owner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_layout public.dashboard_layouts%rowtype;
  v_widgets jsonb;
begin
  if p_owner is null then
    raise exception 'Dashboard owner is required.' using errcode = 'P0400';
  end if;

  select * into v_layout
  from public.dashboard_layouts
  where user_id = p_owner;

  if not found then
    return jsonb_build_object(
      'customized', false,
      'activePreset', 'balanced',
      'revision', 0,
      'updatedAt', null,
      'widgets', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', w.widget_id,
        'type', w.widget_type,
        'title', w.title,
        'config', w.config,
        'position', w."position",
        'width', w.width,
        'height', w.height,
        'visible', w.visible,
        'collapsed', w.collapsed,
        'createdAt', w.created_at,
        'updatedAt', w.updated_at
      )
      order by w."position" asc, w.widget_id asc
    ),
    '[]'::jsonb
  )
  into v_widgets
  from public.dashboard_widgets w
  where w.user_id = p_owner;

  return jsonb_build_object(
    'customized', true,
    'activePreset', v_layout.active_preset,
    'revision', v_layout.revision,
    'updatedAt', v_layout.updated_at,
    'widgets', v_widgets
  );
end;
$function$;
revoke all on function public.persora_dashboard_load(uuid) from public, anon, authenticated;
grant execute on function public.persora_dashboard_load(uuid) to service_role;

create or replace function public.persora_dashboard_save(
  p_owner uuid,
  p_active_preset text,
  p_expected_revision integer,
  p_widgets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_layout public.dashboard_layouts%rowtype;
  v_next_revision integer;
  v_preset text := coalesce(nullif(btrim(p_active_preset), ''), 'custom');
  v_now timestamp with time zone := now();
  v_item jsonb;
  v_idx integer := 0;
  v_keep_ids text[] := array[]::text[];
  v_widget_id text;
begin
  if p_owner is null then
    raise exception 'Dashboard owner is required.' using errcode = 'P0400';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'Member account was not found.' using errcode = 'P0404';
  end if;
  if p_widgets is null or jsonb_typeof(p_widgets) <> 'array' then
    raise exception 'Dashboard widgets must be a JSON array.' using errcode = 'P0400';
  end if;
  if jsonb_array_length(p_widgets) > 40 then
    raise exception 'Dashboards can hold at most 40 widgets.' using errcode = 'P0400';
  end if;

  select * into v_layout
  from public.dashboard_layouts
  where user_id = p_owner
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> v_layout.revision then
      raise exception 'Your dashboard was updated on another device or tab.' using errcode = 'P0409';
    end if;
    v_next_revision := v_layout.revision + 1;
    update public.dashboard_layouts
    set active_preset = v_preset,
        revision = v_next_revision,
        updated_at = v_now
    where user_id = p_owner;
  else
    if p_expected_revision is not null and p_expected_revision > 0 then
      raise exception 'Your dashboard was updated on another device or tab.' using errcode = 'P0409';
    end if;
    v_next_revision := 1;
    insert into public.dashboard_layouts (user_id, active_preset, revision, created_at, updated_at)
    values (p_owner, v_preset, v_next_revision, v_now, v_now);
  end if;

  for v_item in select value from jsonb_array_elements(p_widgets)
  loop
    v_widget_id := coalesce(v_item ->> 'id', '');
    if v_widget_id = '' then
      raise exception 'Every dashboard widget requires an id.' using errcode = 'P0400';
    end if;
    if v_widget_id = any (v_keep_ids) then
      raise exception 'Duplicate widget id in dashboard payload.' using errcode = 'P0400';
    end if;
    v_keep_ids := array_append(v_keep_ids, v_widget_id);

    insert into public.dashboard_widgets (
      user_id,
      widget_id,
      widget_type,
      title,
      config,
      "position",
      width,
      height,
      visible,
      collapsed,
      created_at,
      updated_at
    )
    values (
      p_owner,
      v_widget_id,
      coalesce(v_item ->> 'type', ''),
      coalesce(v_item ->> 'title', ''),
      coalesce(v_item -> 'config', '{}'::jsonb),
      v_idx,
      coalesce(v_item ->> 'width', 'half'),
      coalesce(v_item ->> 'height', 'standard'),
      coalesce((v_item ->> 'visible')::boolean, true),
      coalesce((v_item ->> 'collapsed')::boolean, false),
      v_now,
      v_now
    )
    on conflict (user_id, widget_id) do update
    set widget_type = excluded.widget_type,
        title = excluded.title,
        config = excluded.config,
        "position" = excluded."position",
        width = excluded.width,
        height = excluded.height,
        visible = excluded.visible,
        collapsed = excluded.collapsed,
        updated_at = v_now;

    v_idx := v_idx + 1;
  end loop;

  delete from public.dashboard_widgets
  where user_id = p_owner
    and not (widget_id = any (v_keep_ids));

  return public.persora_dashboard_load(p_owner);
end;
$function$;
revoke all on function public.persora_dashboard_save(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.persora_dashboard_save(uuid, text, integer, jsonb) to service_role;

create or replace function public.persora_dashboard_reset(
  p_owner uuid,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_layout public.dashboard_layouts%rowtype;
begin
  if p_owner is null then
    raise exception 'Dashboard owner is required.' using errcode = 'P0400';
  end if;

  select * into v_layout
  from public.dashboard_layouts
  where user_id = p_owner
  for update;

  if found and p_expected_revision is not null and p_expected_revision <> v_layout.revision then
    raise exception 'Your dashboard was updated on another device or tab.' using errcode = 'P0409';
  end if;

  delete from public.dashboard_widgets where user_id = p_owner;
  delete from public.dashboard_layouts where user_id = p_owner;

  return public.persora_dashboard_load(p_owner);
end;
$function$;
revoke all on function public.persora_dashboard_reset(uuid, integer) from public, anon, authenticated;
grant execute on function public.persora_dashboard_reset(uuid, integer) to service_role;

-- Persora Table Sharing & Standalone Persora Forms Module
-- 1. Member-to-member table sharing (view / comment / edit), public link sharing
--    (viewer / commenter with token rotation & revocation), and cell/thread comments.
-- 2. Standalone Persora Forms module (forms, image-only R2 assets, responses,
--    quiz scoring, and atomic event registration capacity enforcement).
-- All RLS policies strictly use public.persora_jwt_uid() and never raw auth.uid().

-- ============================================================================
-- PART 1: PERSORA TABLE SHARING
-- ============================================================================

create table if not exists public.table_shares (
  id uuid not null default gen_random_uuid(),
  table_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null,
  permission text not null default 'view'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint table_shares_pkey primary key (id),
  constraint table_shares_table_id_fkey foreign key (table_id) references public.persora_tables(id) on delete cascade,
  constraint table_shares_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint table_shares_recipient_id_fkey foreign key (recipient_id) references public.profiles(id) on delete cascade,
  constraint table_shares_unique unique (table_id, recipient_id),
  constraint table_shares_no_self check (owner_id <> recipient_id),
  constraint table_shares_permission_check check (permission = any (array['view'::text, 'comment'::text, 'edit'::text]))
);

create index if not exists table_shares_recipient_idx on public.table_shares using btree (recipient_id, updated_at desc);
create index if not exists table_shares_owner_table_idx on public.table_shares using btree (owner_id, table_id);

alter table public.table_shares enable row level security;
drop policy if exists table_shares_select_policy on public.table_shares;
create policy table_shares_select_policy on public.table_shares
  for select
  to authenticated
  using (owner_id = public.persora_jwt_uid() or recipient_id = public.persora_jwt_uid());
drop policy if exists table_shares_owner_write_policy on public.table_shares;
create policy table_shares_owner_write_policy on public.table_shares
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.table_shares from public, anon, authenticated;
grant all on public.table_shares to service_role;

create table if not exists public.table_share_links (
  table_id uuid not null,
  owner_id uuid not null,
  share_token text not null,
  enabled boolean not null default false,
  permission text not null default 'view'::text,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint table_share_links_pkey primary key (table_id),
  constraint table_share_links_table_id_fkey foreign key (table_id) references public.persora_tables(id) on delete cascade,
  constraint table_share_links_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint table_share_links_token_unique unique (share_token),
  constraint table_share_links_token_format check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'::text),
  constraint table_share_links_permission_check check (permission = any (array['view'::text, 'comment'::text, 'edit'::text]))
);

create index if not exists table_share_links_owner_idx on public.table_share_links using btree (owner_id);

alter table public.table_share_links enable row level security;
drop policy if exists table_share_links_owner_policy on public.table_share_links;
create policy table_share_links_owner_policy on public.table_share_links
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.table_share_links from public, anon, authenticated;
grant all on public.table_share_links to service_role;

create table if not exists public.table_comments (
  id uuid not null default gen_random_uuid(),
  table_id uuid not null,
  owner_id uuid not null,
  author_id uuid,
  author_name text not null,
  target_kind text not null default 'table'::text,
  sheet_id uuid,
  cell_ref text,
  record_id uuid,
  body text not null,
  created_at timestamp with time zone not null default now(),
  constraint table_comments_pkey primary key (id),
  constraint table_comments_table_id_fkey foreign key (table_id) references public.persora_tables(id) on delete cascade,
  constraint table_comments_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint table_comments_author_id_fkey foreign key (author_id) references public.profiles(id) on delete set null,
  constraint table_comments_author_name_check check (char_length(btrim(author_name)) >= 1 and char_length(btrim(author_name)) <= 80),
  constraint table_comments_target_kind_check check (target_kind = any (array['table'::text, 'cell'::text, 'record'::text])),
  constraint table_comments_cell_ref_check check (cell_ref is null or char_length(cell_ref) <= 24),
  constraint table_comments_body_check check (char_length(btrim(body)) >= 1 and char_length(btrim(body)) <= 2000)
);

create index if not exists table_comments_table_idx on public.table_comments using btree (table_id, created_at asc);

alter table public.table_comments enable row level security;
drop policy if exists table_comments_member_select_policy on public.table_comments;
create policy table_comments_member_select_policy on public.table_comments
  for select
  to authenticated
  using (
    owner_id = public.persora_jwt_uid()
    or exists (
      select 1 from public.table_shares s
      where s.table_id = table_comments.table_id
        and s.recipient_id = public.persora_jwt_uid()
    )
  );
drop policy if exists table_comments_owner_write_policy on public.table_comments;
create policy table_comments_owner_write_policy on public.table_comments
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid() or author_id = public.persora_jwt_uid())
  with check (
    owner_id = public.persora_jwt_uid()
    or exists (
      select 1 from public.table_shares s
      where s.table_id = table_comments.table_id
        and s.recipient_id = public.persora_jwt_uid()
        and s.permission = any (array['comment'::text, 'edit'::text])
    )
  );
revoke all on public.table_comments from public, anon, authenticated;
grant all on public.table_comments to service_role;

-- Internal access resolver for Persora Tables (closed to all API roles; called by security-definer RPCs).
create or replace function public.persora_table_access(p_actor uuid, p_table_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_owner public.profiles%rowtype;
  v_share public.table_shares%rowtype;
  v_owner_name text;
begin
  if p_actor is null or p_table_id is null then
    return null;
  end if;
  select * into v_table from public.persora_tables where id = p_table_id;
  if v_table.id is null then
    return null;
  end if;
  if v_table.user_id = p_actor then
    return jsonb_build_object(
      'role', 'owner',
      'shared', false,
      'owner_id', v_table.user_id,
      'share_id', null,
      'owner_name', null,
      'owner_login_id', null
    );
  end if;
  select * into v_share
  from public.table_shares
  where table_id = p_table_id and recipient_id = p_actor;
  if v_share.id is null then
    return null;
  end if;
  select * into v_owner from public.profiles where id = v_table.user_id and account_status = 'active';
  if v_owner.id is null then
    return null;
  end if;
  v_owner_name := coalesce(nullif(btrim(v_owner.full_name), ''), split_part(v_owner.email, '@', 1), 'Persora Member');
  return jsonb_build_object(
    'role', v_share.permission,
    'shared', true,
    'owner_id', v_table.user_id,
    'share_id', v_share.id,
    'owner_name', v_owner_name,
    'owner_login_id', v_owner.login_id
  );
end;
$function$;
revoke all on function public.persora_table_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_table_access(uuid, uuid) from service_role;

create or replace function public.persora_tables_list(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with visible as (
    select
      public.persora_table_summary(t) || jsonb_build_object(
        'shared', false,
        'has_shares', (
          exists (select 1 from public.table_shares ts where ts.table_id = t.id)
          or exists (select 1 from public.table_share_links tsl where tsl.table_id = t.id and tsl.enabled = true)
        ),
        'permission', 'owner'
      ) as item,
      t.updated_at as sort_at
    from public.persora_tables t
    where t.user_id = p_owner
    union all
    select
      (public.persora_table_summary(t) || jsonb_build_object(
        'starred', false,
        'shared', true,
        'has_shares', true,
        'permission', s.permission,
        'share_id', s.id,
        'owner_id', t.user_id,
        'owner_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
        'owner_login_id', p.login_id
      )) as item,
      greatest(t.updated_at, s.updated_at) as sort_at
    from public.table_shares s
    join public.persora_tables t on t.id = s.table_id
    join public.profiles p on p.id = t.user_id and p.account_status = 'active'
    where s.recipient_id = p_owner
  )
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb) from visible;
$function$;
revoke all on function public.persora_tables_list(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_tables_list(p_owner uuid) to service_role;

create or replace function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_table public.persora_tables%rowtype;
  v_summary jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if p_touch and v_role = 'owner' then
    update public.persora_tables set opened_at = clock_timestamp() where id = p_id and user_id = p_owner returning * into v_table;
  else
    select * into v_table from public.persora_tables where id = p_id;
  end if;
  if v_table.id is null then
    raise exception 'That table is not available in your account.' using errcode = 'P0404';
  end if;
  v_summary := public.persora_table_summary(v_table) || jsonb_build_object(
    'meta', v_table.meta,
    'shared', coalesce((v_access ->> 'shared')::boolean, false),
    'permission', v_role
  );
  if coalesce((v_access ->> 'shared')::boolean, false) then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;
  return jsonb_build_object(
    'table', v_summary,
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.position, s.id) from public.persora_table_sheets s where s.table_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.position, r.created_at, r.id) from public.persora_table_records r where r.table_id = p_id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at) from public.persora_table_attachments a where a.table_id = p_id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'author_name', c.author_name, 'target_kind', c.target_kind, 'sheet_id', c.sheet_id, 'cell_ref', c.cell_ref, 'record_id', c.record_id, 'body', c.body, 'created_at', c.created_at) order by c.created_at, c.id) from public.table_comments c where c.table_id = p_id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean) from public, anon, authenticated;
grant execute on function public.persora_table_get(p_owner uuid, p_id uuid, p_touch boolean) to service_role;

create or replace function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_table public.persora_tables%rowtype;
  v_summary jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  select * into v_table from public.persora_tables where id = p_id;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  v_summary := public.persora_table_summary(v_table)
    || jsonb_build_object('shared', coalesce((v_access ->> 'shared')::boolean, false), 'permission', v_access ->> 'role')
    || case when p_meta then jsonb_build_object('meta', v_table.meta) else '{}'::jsonb end;
  if coalesce((v_access ->> 'shared')::boolean, false) then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;
  return v_summary;
end;
$function$;
revoke all on function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean) from public, anon, authenticated;
grant execute on function public.persora_table_head(p_owner uuid, p_id uuid, p_meta boolean) to service_role;

create or replace function public.persora_table_save(
  p_owner uuid,
  p_id uuid,
  p_base bigint,
  p_batch uuid,
  p_meta jsonb,
  p_sheet_upserts jsonb,
  p_sheet_deletes jsonb,
  p_record_upserts jsonb,
  p_record_deletes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_true_owner uuid;
  v_table public.persora_tables%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sheet_ids uuid[];
  v_record_ids uuid[];
  v_summary jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if v_role not in ('owner', 'edit') then
    raise exception 'You do not have edit permission for this shared table.' using errcode = 'P0403';
  end if;

  select * into v_table from public.persora_tables where id = p_id for update;
  if v_table.id is null then
    raise exception 'That table is not available in your account. It may have been deleted.' using errcode = 'P0404';
  end if;
  v_true_owner := v_table.user_id;

  if v_table.last_batch_id = p_batch then
    v_summary := public.persora_table_summary(v_table) || jsonb_build_object('shared', v_role <> 'owner', 'permission', v_role);
    return jsonb_build_object('ok', true, 'replayed', true, 'table', v_summary);
  end if;
  if v_table.revision <> p_base then
    v_summary := public.persora_table_summary(v_table) || jsonb_build_object('shared', v_role <> 'owner', 'permission', v_role);
    return jsonb_build_object('ok', false, 'conflict', true, 'table', v_summary);
  end if;
  if v_table.kind = 'spreadsheet' and (p_meta is not null or jsonb_array_length(coalesce(p_record_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_record_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Spreadsheets don''t have fields or records.' using errcode = 'P0422';
  end if;
  if v_table.kind = 'smart' and (jsonb_array_length(coalesce(p_sheet_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheet_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Smart Tables don''t have sheets.' using errcode = 'P0422';
  end if;

  select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_sheet_ids from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s;
  select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_record_ids from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r;
  if exists (select 1 from public.persora_table_sheets where id = any(v_sheet_ids) and table_id <> p_id)
     or exists (select 1 from public.persora_table_records where id = any(v_record_ids) and table_id <> p_id) then
    raise exception 'That change refers to data from another table.' using errcode = 'P0403';
  end if;

  delete from public.persora_table_sheets where table_id = p_id and id = any(public.persora_table_uuid_array(p_sheet_deletes));
  insert into public.persora_table_sheets as current (id, table_id, user_id, position, name, data, updated_at)
  select (s ->> 'id')::uuid, p_id, v_true_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data', v_now
  from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s
  on conflict (id) do update set position = excluded.position, name = excluded.name, data = excluded.data, updated_at = v_now
  where current.table_id = p_id;

  delete from public.persora_table_records where table_id = p_id and id = any(public.persora_table_uuid_array(p_record_deletes));
  insert into public.persora_table_records as current (id, table_id, user_id, position, "values", is_example, updated_at)
  select (r ->> 'id')::uuid, p_id, v_true_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false), v_now
  from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r
  on conflict (id) do update set position = excluded.position, "values" = excluded."values", is_example = excluded.is_example, updated_at = v_now
  where current.table_id = p_id;

  update public.persora_tables
  set meta = coalesce(p_meta, meta), revision = revision + 1, last_batch_id = p_batch, updated_at = v_now
  where id = p_id;
  v_table := public.persora_table_refresh_stats(p_id);
  v_summary := public.persora_table_summary(v_table) || jsonb_build_object('shared', v_role <> 'owner', 'permission', v_role);
  if v_role <> 'owner' then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'table', v_summary);
end;
$function$;
revoke all on function public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_save(p_owner uuid, p_id uuid, p_base bigint, p_batch uuid, p_meta jsonb, p_sheet_upserts jsonb, p_sheet_deletes jsonb, p_record_upserts jsonb, p_record_deletes jsonb) to service_role;

create or replace function public.persora_table_attachment_add(
  p_owner uuid,
  p_table uuid,
  p_id uuid,
  p_key text,
  p_name text,
  p_type text,
  p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_true_owner uuid;
  v_row public.persora_table_attachments%rowtype;
begin
  v_access := public.persora_table_access(p_owner, p_table);
  if v_access is null then
    raise exception 'That Smart Table is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if v_role not in ('owner', 'edit') then
    raise exception 'You do not have edit permission for this shared table.' using errcode = 'P0403';
  end if;
  v_true_owner := (v_access ->> 'owner_id')::uuid;
  if not exists (select 1 from public.persora_tables where id = p_table and user_id = v_true_owner and kind = 'smart') then
    raise exception 'That Smart Table is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_table_attachments where table_id = p_table) >= 500 then
    raise exception 'This table already has 500 attached files.' using errcode = 'P0409';
  end if;
  insert into public.persora_table_attachments (table_id, id, user_id, file_key, file_name, file_type, file_size)
  values (p_table, p_id, v_true_owner, p_key, p_name, p_type, p_size)
  on conflict (table_id, id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.persora_table_attachments where table_id = p_table and id = p_id and user_id = v_true_owner and file_key = p_key;
    if v_row.id is null then
      raise exception 'That file id is already in use.' using errcode = 'P0409';
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'created_at', v_row.created_at);
end;
$function$;
revoke all on function public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint) from public, anon, authenticated;
grant execute on function public.persora_table_attachment_add(p_owner uuid, p_table uuid, p_id uuid, p_key text, p_name text, p_type text, p_size bigint) to service_role;

create or replace function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_row public.persora_table_attachments%rowtype;
begin
  v_access := public.persora_table_access(p_owner, p_table);
  if v_access is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  select a.* into v_row
  from public.persora_table_attachments a
  join public.persora_tables t on t.id = a.table_id
  where a.table_id = p_table and a.id = p_id and a.user_id = t.user_id;
  if v_row.id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object('id', v_row.id, 'file_key', v_row.file_key, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'owner_id', v_row.user_id);
end;
$function$;
revoke all on function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid) from public, anon, authenticated;
grant execute on function public.persora_table_attachment_get(p_owner uuid, p_table uuid, p_id uuid) to service_role;

create or replace function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_keys jsonb;
begin
  v_access := public.persora_table_access(p_owner, p_table);
  if v_access is null or (v_access ->> 'role') not in ('owner', 'edit') then
    return '[]'::jsonb;
  end if;
  with removed as (
    delete from public.persora_table_attachments
    where table_id = p_table and created_at < p_before
      and not (id = any(public.persora_table_uuid_array(p_keep)))
    returning file_key
  )
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys from removed;
  return v_keys;
end;
$function$;
revoke all on function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone) from public, anon, authenticated;
grant execute on function public.persora_table_attachments_prune(p_owner uuid, p_table uuid, p_keep jsonb, p_before timestamp with time zone) to service_role;

create or replace function public.persora_table_people(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with my_projects as (
    select id from public.projects where owner_id = p_owner
    union select project_id from public.project_members where user_id = p_owner
  ), linked as (
    select p_owner as id
    union select pm.user_id from public.project_members pm where pm.project_id in (select id from my_projects)
    union select pr.owner_id from public.projects pr where pr.id in (select id from my_projects)
    union select recipient_id from public.record_shares where owner_id = p_owner
    union select owner_id from public.record_shares where recipient_id = p_owner
    union select recipient_id from public.vault_shares where owner_id = p_owner
    union select owner_id from public.vault_shares where recipient_id = p_owner
    union select recipient_id from public.table_shares where owner_id = p_owner
    union select owner_id from public.table_shares where recipient_id = p_owner
  ), people as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Member') as name
    from public.profiles p
    where p.id in (select id from linked) and (p.id = p_owner or p.account_status = 'active')
    limit 500
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'me', id = p_owner) order by (id <> p_owner), lower(name)), '[]'::jsonb) from people;
$function$;
revoke all on function public.persora_table_people(p_owner uuid) from public, anon, authenticated;
grant execute on function public.persora_table_people(p_owner uuid) to service_role;

create or replace function public.persora_table_sharing_get(p_owner uuid, p_table_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_link public.table_share_links%rowtype;
begin
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can manage sharing.' using errcode = 'P0404';
  end if;
  select * into v_link from public.table_share_links where table_id = p_table_id and owner_id = p_owner;
  return jsonb_build_object(
    'table_id', v_table.id,
    'table_name', v_table.name,
    'shares', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'recipient_id', s.recipient_id,
          'recipient_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
          'recipient_login_id', p.login_id,
          'recipient_email', p.email,
          'permission', s.permission,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        order by s.created_at asc
      )
      from public.table_shares s
      join public.profiles p on p.id = s.recipient_id
      where s.table_id = p_table_id and s.owner_id = p_owner
    ), '[]'::jsonb),
    'link', case
      when v_link.table_id is null then jsonb_build_object('enabled', false, 'permission', 'view', 'share_token', null, 'updated_at', null)
      else jsonb_build_object(
        'enabled', v_link.enabled and v_link.revoked_at is null,
        'permission', v_link.permission,
        'share_token', case when v_link.enabled and v_link.revoked_at is null then v_link.share_token else null end,
        'updated_at', v_link.updated_at
      )
    end
  );
end;
$function$;
revoke all on function public.persora_table_sharing_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_table_sharing_get(uuid, uuid) to service_role;

create or replace function public.persora_table_share_upsert(
  p_owner uuid,
  p_table_id uuid,
  p_recipient uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_recipient public.profiles%rowtype;
  v_existing public.table_shares%rowtype;
  v_share public.table_shares%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_permission not in ('view', 'comment', 'edit') then
    raise exception 'Choose a valid permission (view, comment, or edit).' using errcode = 'P0422';
  end if;
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can share this table.' using errcode = 'P0404';
  end if;
  if p_recipient = p_owner then
    raise exception 'You already own this table.' using errcode = 'P0422';
  end if;
  select * into v_recipient from public.profiles where id = p_recipient and account_status = 'active';
  if v_recipient.id is null then
    raise exception 'Choose an active Persora member.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.table_shares where table_id = p_table_id) >= 100 then
    raise exception 'A table can be shared directly with up to 100 members.' using errcode = 'P0409';
  end if;
  select * into v_existing from public.table_shares where table_id = p_table_id and recipient_id = p_recipient;
  insert into public.table_shares (table_id, owner_id, recipient_id, permission, created_at, updated_at)
  values (p_table_id, p_owner, p_recipient, p_permission, v_now, v_now)
  on conflict (table_id, recipient_id) do update
  set permission = excluded.permission, updated_at = v_now
  returning * into v_share;

  return jsonb_build_object(
    'created', v_existing.id is null,
    'previous_permission', v_existing.permission,
    'table_name', v_table.name,
    'share', jsonb_build_object(
      'id', v_share.id,
      'recipient_id', v_share.recipient_id,
      'recipient_name', coalesce(nullif(btrim(v_recipient.full_name), ''), split_part(v_recipient.email, '@', 1), 'Persora Member'),
      'recipient_login_id', v_recipient.login_id,
      'recipient_email', v_recipient.email,
      'permission', v_share.permission,
      'created_at', v_share.created_at,
      'updated_at', v_share.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_table_share_upsert(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_table_share_upsert(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_table_share_update(
  p_owner uuid,
  p_table_id uuid,
  p_share_id uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_share public.table_shares%rowtype;
  v_recipient public.profiles%rowtype;
begin
  if p_permission not in ('view', 'comment', 'edit') then
    raise exception 'Choose a valid permission (view, comment, or edit).' using errcode = 'P0422';
  end if;
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can update sharing permissions.' using errcode = 'P0404';
  end if;
  update public.table_shares
  set permission = p_permission, updated_at = clock_timestamp()
  where id = p_share_id and table_id = p_table_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  select * into v_recipient from public.profiles where id = v_share.recipient_id;
  return jsonb_build_object(
    'table_name', v_table.name,
    'share', jsonb_build_object(
      'id', v_share.id,
      'recipient_id', v_share.recipient_id,
      'recipient_name', coalesce(nullif(btrim(v_recipient.full_name), ''), split_part(v_recipient.email, '@', 1), 'Persora Member'),
      'recipient_login_id', v_recipient.login_id,
      'recipient_email', v_recipient.email,
      'permission', v_share.permission,
      'created_at', v_share.created_at,
      'updated_at', v_share.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_table_share_update(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_table_share_update(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_table_share_revoke(
  p_owner uuid,
  p_table_id uuid,
  p_share_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_share public.table_shares%rowtype;
begin
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can revoke sharing.' using errcode = 'P0404';
  end if;
  delete from public.table_shares
  where id = p_share_id and table_id = p_table_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'ok', true,
    'recipient_id', v_share.recipient_id,
    'table_name', v_table.name
  );
end;
$function$;
revoke all on function public.persora_table_share_revoke(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_table_share_revoke(uuid, uuid, uuid) to service_role;

create or replace function public.persora_table_link_configure(
  p_owner uuid,
  p_table_id uuid,
  p_enabled boolean,
  p_permission text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_table public.persora_tables%rowtype;
  v_existing public.table_share_links%rowtype;
  v_link public.table_share_links%rowtype;
  v_perm text := coalesce(p_permission, 'view');
  v_token text;
  v_now timestamptz := clock_timestamp();
begin
  if v_perm not in ('view', 'comment', 'edit') then
    raise exception 'Public link permission must be view, comment, or edit.' using errcode = 'P0422';
  end if;
  select * into v_table from public.persora_tables where id = p_table_id and user_id = p_owner;
  if v_table.id is null then
    raise exception 'Only the table owner can configure link sharing.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.table_share_links where table_id = p_table_id and owner_id = p_owner;
  v_token := coalesce(nullif(btrim(p_token), ''), v_existing.share_token);
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'A valid share token is required.' using errcode = 'P0422';
  end if;

  insert into public.table_share_links (table_id, owner_id, share_token, enabled, permission, revoked_at, created_at, updated_at)
  values (p_table_id, p_owner, v_token, coalesce(p_enabled, false), v_perm, case when coalesce(p_enabled, false) then null else v_now end, v_now, v_now)
  on conflict (table_id) do update
  set share_token = excluded.share_token,
      enabled = excluded.enabled,
      permission = excluded.permission,
      revoked_at = case when excluded.enabled then null else v_now end,
      updated_at = v_now
  returning * into v_link;

  return jsonb_build_object(
    'enabled', v_link.enabled and v_link.revoked_at is null,
    'permission', v_link.permission,
    'share_token', case when v_link.enabled and v_link.revoked_at is null then v_link.share_token else null end,
    'updated_at', v_link.updated_at
  );
end;
$function$;
revoke all on function public.persora_table_link_configure(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.persora_table_link_configure(uuid, uuid, boolean, text, text) to service_role;

create or replace function public.persora_table_public_save(
  p_token text,
  p_base bigint,
  p_batch uuid,
  p_meta jsonb,
  p_sheet_upserts jsonb,
  p_sheet_deletes jsonb,
  p_record_upserts jsonb,
  p_record_deletes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.table_share_links%rowtype;
  v_table public.persora_tables%rowtype;
  v_true_owner uuid;
  v_now timestamptz := clock_timestamp();
  v_sheet_ids uuid[];
  v_record_ids uuid[];
  v_summary jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.table_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.table_id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  if v_link.permission <> 'edit' then
    raise exception 'Editing is disabled for this shared link.' using errcode = 'P0403';
  end if;

  select * into v_table from public.persora_tables where id = v_link.table_id for update;
  if v_table.id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  v_true_owner := v_table.user_id;

  if v_table.last_batch_id = p_batch then
    v_summary := jsonb_build_object(
      'id', v_table.id,
      'kind', v_table.kind,
      'name', v_table.name,
      'revision', v_table.revision,
      'sheet_count', v_table.sheet_count,
      'record_count', v_table.record_count,
      'updated_at', v_table.updated_at
    );
    return jsonb_build_object('ok', true, 'replayed', true, 'table', v_summary);
  end if;
  if v_table.revision <> p_base then
    v_summary := jsonb_build_object(
      'id', v_table.id,
      'kind', v_table.kind,
      'name', v_table.name,
      'revision', v_table.revision,
      'sheet_count', v_table.sheet_count,
      'record_count', v_table.record_count,
      'updated_at', v_table.updated_at
    );
    return jsonb_build_object('ok', false, 'conflict', true, 'table', v_summary);
  end if;
  if v_table.kind = 'spreadsheet' and (p_meta is not null or jsonb_array_length(coalesce(p_record_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_record_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Spreadsheets don''t have fields or records.' using errcode = 'P0422';
  end if;
  if v_table.kind = 'smart' and (jsonb_array_length(coalesce(p_sheet_upserts, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_sheet_deletes, '[]'::jsonb)) > 0) then
    raise exception 'Smart Tables don''t have sheets.' using errcode = 'P0422';
  end if;

  select coalesce(array_agg((s ->> 'id')::uuid), '{}') into v_sheet_ids from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s;
  select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_record_ids from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r;
  if exists (select 1 from public.persora_table_sheets where id = any(v_sheet_ids) and table_id <> v_table.id)
     or exists (select 1 from public.persora_table_records where id = any(v_record_ids) and table_id <> v_table.id) then
    raise exception 'That change refers to data from another table.' using errcode = 'P0403';
  end if;

  delete from public.persora_table_sheets where table_id = v_table.id and id = any(public.persora_table_uuid_array(p_sheet_deletes));
  insert into public.persora_table_sheets as current (id, table_id, user_id, position, name, data, updated_at)
  select (s ->> 'id')::uuid, v_table.id, v_true_owner, (s ->> 'position')::integer, btrim(s ->> 'name'), s -> 'data', v_now
  from jsonb_array_elements(coalesce(p_sheet_upserts, '[]'::jsonb)) s
  on conflict (id) do update set position = excluded.position, name = excluded.name, data = excluded.data, updated_at = v_now
  where current.table_id = v_table.id;

  delete from public.persora_table_records where table_id = v_table.id and id = any(public.persora_table_uuid_array(p_record_deletes));
  insert into public.persora_table_records as current (id, table_id, user_id, position, "values", is_example, updated_at)
  select (r ->> 'id')::uuid, v_table.id, v_true_owner, (r ->> 'position')::bigint, coalesce(r -> 'values', '{}'::jsonb), coalesce((r ->> 'example')::boolean, false), v_now
  from jsonb_array_elements(coalesce(p_record_upserts, '[]'::jsonb)) r
  on conflict (id) do update set position = excluded.position, "values" = excluded."values", is_example = excluded.is_example, updated_at = v_now
  where current.table_id = v_table.id;

  update public.persora_tables
  set meta = coalesce(p_meta, meta), revision = revision + 1, last_batch_id = p_batch, updated_at = v_now
  where id = v_table.id;
  v_table := public.persora_table_refresh_stats(v_table.id);
  v_summary := jsonb_build_object(
    'id', v_table.id,
    'kind', v_table.kind,
    'name', v_table.name,
    'revision', v_table.revision,
    'sheet_count', v_table.sheet_count,
    'record_count', v_table.record_count,
    'updated_at', v_table.updated_at
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'table', v_summary);
end;
$function$;
revoke all on function public.persora_table_public_save(text, bigint, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_public_save(text, bigint, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.persora_table_public_get(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.table_share_links%rowtype;
  v_table public.persora_tables%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.table_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.table_id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select * into v_table from public.persora_tables where id = v_link.table_id;
  if v_table.id is null then
    raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'permission', v_link.permission,
    'table', jsonb_build_object(
      'id', v_table.id,
      'kind', v_table.kind,
      'name', v_table.name,
      'revision', v_table.revision,
      'sheet_count', v_table.sheet_count,
      'record_count', v_table.record_count,
      'updated_at', v_table.updated_at,
      'meta', v_table.meta
    ),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'data', s.data) order by s.position, s.id) from public.persora_table_sheets s where s.table_id = v_table.id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'values', r."values", 'example', r.is_example) order by r.position, r.created_at, r.id) from public.persora_table_records r where r.table_id = v_table.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at) from public.persora_table_attachments a where a.table_id = v_table.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author_name', c.author_name, 'target_kind', c.target_kind, 'sheet_id', c.sheet_id, 'cell_ref', c.cell_ref, 'record_id', c.record_id, 'body', c.body, 'created_at', c.created_at) order by c.created_at, c.id) from public.table_comments c where c.table_id = v_table.id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_table_public_get(text) from public, anon, authenticated;
grant execute on function public.persora_table_public_get(text) to service_role;

create or replace function public.persora_table_public_attachment_get(p_token text, p_att_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.table_share_links%rowtype;
  v_row public.persora_table_attachments%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.table_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.table_id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  select * into v_row from public.persora_table_attachments where table_id = v_link.table_id and id = p_att_id;
  if v_row.id is null then
    raise exception 'That file is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object('id', v_row.id, 'file_key', v_row.file_key, 'name', v_row.file_name, 'type', v_row.file_type, 'size', v_row.file_size, 'owner_id', v_row.user_id);
end;
$function$;
revoke all on function public.persora_table_public_attachment_get(text, uuid) from public, anon, authenticated;
grant execute on function public.persora_table_public_attachment_get(text, uuid) to service_role;

-- Comment-only sheet mutation: updates ONLY the `comments` map of a spreadsheet sheet,
-- never altering cells, formulas, formatting, merges, charts, or sheet dimensions.
create or replace function public.persora_table_cell_comment_write(
  p_actor uuid,
  p_token text,
  p_table_id uuid,
  p_sheet_id uuid,
  p_cell_key text,
  p_comment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_link public.table_share_links%rowtype;
  v_target_table_id uuid;
  v_role text;
  v_table public.persora_tables%rowtype;
  v_sheet public.persora_table_sheets%rowtype;
  v_comments jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_token is not null and btrim(p_token) <> '' then
    select l.* into v_link
    from public.table_share_links l
    join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
    where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
    if v_link.table_id is null then
      raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
    end if;
    if v_link.permission not in ('comment', 'edit') then
      raise exception 'Commenting is disabled for this shared link.' using errcode = 'P0403';
    end if;
    if p_comment is null and v_link.permission <> 'edit' then
      raise exception 'Public commenters can add comments but cannot delete existing comments.' using errcode = 'P0403';
    end if;
    v_target_table_id := v_link.table_id;
    v_role := v_link.permission;
  else
    v_access := public.persora_table_access(p_actor, p_table_id);
    if v_access is null then
      raise exception 'That table is not available in your account.' using errcode = 'P0404';
    end if;
    v_role := v_access ->> 'role';
    if v_role not in ('owner', 'edit', 'comment') then
      raise exception 'You only have view access to this shared table.' using errcode = 'P0403';
    end if;
    if p_comment is null and v_role not in ('owner', 'edit') then
      raise exception 'Only the table owner or editors can delete cell comments.' using errcode = 'P0403';
    end if;
    v_target_table_id := p_table_id;
  end if;

  if p_cell_key is null or p_cell_key !~ '^[0-9]{1,4}:[0-9]{1,3}$' then
    raise exception 'Choose a valid cell address.' using errcode = 'P0422';
  end if;

  select * into v_table from public.persora_tables where id = v_target_table_id for update;
  if v_table.id is null or v_table.kind <> 'spreadsheet' then
    raise exception 'Cell comments are only supported on spreadsheets.' using errcode = 'P0422';
  end if;
  select * into v_sheet from public.persora_table_sheets where id = p_sheet_id and table_id = v_target_table_id for update;
  if v_sheet.id is null then
    raise exception 'Choose a valid sheet in this spreadsheet.' using errcode = 'P0404';
  end if;

  v_comments := coalesce(v_sheet.data -> 'comments', '{}'::jsonb);
  if p_comment is null then
    v_comments := v_comments - p_cell_key;
  else
    if not (v_comments ? p_cell_key) and (select count(*) from jsonb_object_keys(v_comments)) >= 500 then
      raise exception 'A sheet can hold at most 500 comments.' using errcode = 'P0409';
    end if;
    v_comments := jsonb_set(v_comments, array[p_cell_key], p_comment, true);
  end if;

  update public.persora_table_sheets
  set data = case
        when v_comments = '{}'::jsonb then (data - 'comments')
        else jsonb_set(data, '{comments}', v_comments, true)
      end,
      updated_at = v_now
  where id = v_sheet.id and table_id = v_target_table_id
  returning * into v_sheet;

  update public.persora_tables
  set revision = revision + 1, updated_at = v_now
  where id = v_target_table_id
  returning * into v_table;

  perform public.persora_table_refresh_stats(v_target_table_id);
  return jsonb_build_object(
    'ok', true,
    'revision', v_table.revision,
    'sheet_id', v_sheet.id,
    'cell_key', p_cell_key,
    'comment', v_sheet.data -> 'comments' -> p_cell_key
  );
end;
$function$;
revoke all on function public.persora_table_cell_comment_write(uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.persora_table_cell_comment_write(uuid, text, uuid, uuid, text, jsonb) to service_role;

create or replace function public.persora_table_thread_comment_add(
  p_actor uuid,
  p_token text,
  p_table_id uuid,
  p_author_name text,
  p_target_kind text,
  p_sheet_id uuid,
  p_cell_ref text,
  p_record_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_link public.table_share_links%rowtype;
  v_target_table_id uuid;
  v_owner_id uuid;
  v_row public.table_comments%rowtype;
begin
  if p_token is not null and btrim(p_token) <> '' then
    select l.* into v_link
    from public.table_share_links l
    join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
    where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
    if v_link.table_id is null then
      raise exception 'This shared table link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
    end if;
    if v_link.permission not in ('comment', 'edit') then
      raise exception 'Commenting is disabled for this shared link.' using errcode = 'P0403';
    end if;
    v_target_table_id := v_link.table_id;
    v_owner_id := v_link.owner_id;
  else
    v_access := public.persora_table_access(p_actor, p_table_id);
    if v_access is null then
      raise exception 'That table is not available in your account.' using errcode = 'P0404';
    end if;
    if (v_access ->> 'role') not in ('owner', 'edit', 'comment') then
      raise exception 'You only have view access to this shared table.' using errcode = 'P0403';
    end if;
    v_target_table_id := p_table_id;
    v_owner_id := (v_access ->> 'owner_id')::uuid;
  end if;

  if (select count(*) from public.table_comments where table_id = v_target_table_id) >= 500 then
    raise exception 'This table already has 500 comments.' using errcode = 'P0409';
  end if;

  insert into public.table_comments (
    table_id, owner_id, author_id, author_name, target_kind, sheet_id, cell_ref, record_id, body
  )
  values (
    v_target_table_id,
    v_owner_id,
    p_actor,
    coalesce(nullif(btrim(p_author_name), ''), 'Guest commenter'),
    coalesce(nullif(btrim(p_target_kind), ''), 'table'),
    p_sheet_id,
    nullif(btrim(p_cell_ref), ''),
    p_record_id,
    btrim(p_body)
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'author_id', v_row.author_id,
    'author_name', v_row.author_name,
    'target_kind', v_row.target_kind,
    'sheet_id', v_row.sheet_id,
    'cell_ref', v_row.cell_ref,
    'record_id', v_row.record_id,
    'body', v_row.body,
    'created_at', v_row.created_at
  );
end;
$function$;
revoke all on function public.persora_table_thread_comment_add(uuid, text, uuid, text, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_table_thread_comment_add(uuid, text, uuid, text, text, uuid, text, uuid, text) to service_role;


-- ============================================================================
-- PART 2: STANDALONE PERSORA FORMS MODULE
-- ============================================================================

create table if not exists public.persora_forms (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text not null default ''::text,
  status text not null default 'draft'::text,
  accepting_responses boolean not null default true,
  public_slug text not null,
  header_image jsonb,
  questions jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  response_count integer not null default 0,
  revision bigint not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_forms_pkey primary key (id),
  constraint persora_forms_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint persora_forms_slug_unique unique (public_slug),
  constraint persora_forms_slug_format check (public_slug ~ '^[A-Za-z0-9_-]{24,64}$'::text),
  constraint persora_forms_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160),
  constraint persora_forms_description_check check (char_length(description) <= 4000),
  constraint persora_forms_status_check check (status = any (array['draft'::text, 'published'::text])),
  constraint persora_forms_questions_check check (jsonb_typeof(questions) = 'array'::text),
  constraint persora_forms_settings_check check (jsonb_typeof(settings) = 'object'::text),
  constraint persora_forms_header_image_check check (header_image is null or jsonb_typeof(header_image) = 'object'::text),
  constraint persora_forms_response_count_check check (response_count >= 0),
  constraint persora_forms_revision_check check (revision >= 1)
);

create index if not exists persora_forms_owner_idx on public.persora_forms using btree (user_id, updated_at desc);

alter table public.persora_forms enable row level security;
drop policy if exists persora_forms_owner_policy on public.persora_forms;
create policy persora_forms_owner_policy on public.persora_forms
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.persora_forms from public, anon, authenticated;
grant all on public.persora_forms to service_role;

create table if not exists public.persora_form_responses (
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  owner_id uuid not null,
  respondent_user_id uuid,
  respondent_name text not null default ''::text,
  respondent_email text not null default ''::text,
  answers jsonb not null default '{}'::jsonb,
  quiz_result jsonb,
  registration_code text,
  submitted_at timestamp with time zone not null default now(),
  constraint persora_form_responses_pkey primary key (id),
  constraint persora_form_responses_form_id_fkey foreign key (form_id) references public.persora_forms(id) on delete cascade,
  constraint persora_form_responses_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_form_responses_respondent_fkey foreign key (respondent_user_id) references public.profiles(id) on delete set null,
  constraint persora_form_responses_name_check check (char_length(respondent_name) <= 160),
  constraint persora_form_responses_email_check check (char_length(respondent_email) <= 254),
  constraint persora_form_responses_answers_check check (jsonb_typeof(answers) = 'object'::text),
  constraint persora_form_responses_quiz_check check (quiz_result is null or jsonb_typeof(quiz_result) = 'object'::text),
  constraint persora_form_responses_reg_code_check check (registration_code is null or char_length(registration_code) <= 32)
);

create index if not exists persora_form_responses_form_idx on public.persora_form_responses using btree (form_id, submitted_at desc);
create index if not exists persora_form_responses_owner_idx on public.persora_form_responses using btree (owner_id, submitted_at desc);

alter table public.persora_form_responses enable row level security;
drop policy if exists persora_form_responses_owner_policy on public.persora_form_responses;
create policy persora_form_responses_owner_policy on public.persora_form_responses
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_form_responses from public, anon, authenticated;
grant all on public.persora_form_responses to service_role;

create table if not exists public.persora_form_assets (
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  owner_id uuid not null,
  role text not null,
  response_id uuid,
  file_key text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null,
  created_at timestamp with time zone not null default now(),
  constraint persora_form_assets_pkey primary key (id),
  constraint persora_form_assets_form_id_fkey foreign key (form_id) references public.persora_forms(id) on delete cascade,
  constraint persora_form_assets_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_form_assets_response_id_fkey foreign key (response_id) references public.persora_form_responses(id) on delete cascade,
  constraint persora_form_assets_role_check check (role = any (array['builder_image'::text, 'response_image'::text])),
  constraint persora_form_assets_key_check check (file_key ~~ (owner_id::text || '/persora-forms/%'::text) and char_length(file_key) <= 400),
  constraint persora_form_assets_name_check check (char_length(file_name) >= 1 and char_length(file_name) <= 255),
  constraint persora_form_assets_image_only_check check (file_type = any (array['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/gif'::text])),
  constraint persora_form_assets_size_check check (file_size > 0 and file_size <= 10485760)
);

create index if not exists persora_form_assets_form_idx on public.persora_form_assets using btree (form_id, role);
create index if not exists persora_form_assets_owner_key_idx on public.persora_form_assets using btree (owner_id, file_key);

alter table public.persora_form_assets enable row level security;
drop policy if exists persora_form_assets_owner_policy on public.persora_form_assets;
create policy persora_form_assets_owner_policy on public.persora_form_assets
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_form_assets from public, anon, authenticated;
grant all on public.persora_form_assets to service_role;

create or replace function public.persora_form_summary(p_form public.persora_forms)
returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'id', p_form.id,
    'title', p_form.title,
    'description', p_form.description,
    'status', p_form.status,
    'accepting_responses', p_form.accepting_responses,
    'public_slug', p_form.public_slug,
    'question_count', jsonb_array_length(p_form.questions),
    'response_count', p_form.response_count,
    'quiz_enabled', coalesce((p_form.settings -> 'quiz' ->> 'enabled')::boolean, false),
    'event_enabled', coalesce((p_form.settings -> 'eventRegistration' ->> 'enabled')::boolean, false),
    'max_registrations', (p_form.settings -> 'eventRegistration' ->> 'maxRegistrations')::integer,
    'revision', p_form.revision,
    'created_at', p_form.created_at,
    'updated_at', p_form.updated_at
  );
$function$;
revoke all on function public.persora_form_summary(public.persora_forms) from public, anon, authenticated;
revoke all on function public.persora_form_summary(public.persora_forms) from service_role;

create or replace function public.persora_forms_list(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(jsonb_agg(public.persora_form_summary(f) order by f.updated_at desc), '[]'::jsonb)
  from public.persora_forms f
  where f.user_id = p_owner;
$function$;
revoke all on function public.persora_forms_list(uuid) from public, anon, authenticated;
grant execute on function public.persora_forms_list(uuid) to service_role;

create or replace function public.persora_form_get(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
begin
  select * into v_form from public.persora_forms where id = p_id and user_id = p_owner;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'form', public.persora_form_summary(v_form) || jsonb_build_object(
      'header_image', v_form.header_image,
      'questions', v_form.questions,
      'settings', v_form.settings
    ),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'role', a.role, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size, 'created_at', a.created_at) order by a.created_at)
      from public.persora_form_assets a
      where a.form_id = p_id and a.owner_id = p_owner and a.role = 'builder_image'
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_form_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_get(uuid, uuid) to service_role;

create or replace function public.persora_form_create(
  p_owner uuid,
  p_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_questions jsonb,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_existing public.persora_forms%rowtype;
  v_form public.persora_forms%rowtype;
begin
  select * into v_existing from public.persora_forms where id = p_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That form id is already in use.' using errcode = 'P0409';
    end if;
    return public.persora_form_get(p_owner, p_id);
  end if;
  if (select count(*) from public.persora_forms where user_id = p_owner) >= 200 then
    raise exception 'You can have up to 200 forms. Delete forms you no longer need first.' using errcode = 'P0409';
  end if;
  insert into public.persora_forms (id, user_id, title, description, status, accepting_responses, public_slug, questions, settings)
  values (
    p_id,
    p_owner,
    btrim(p_title),
    coalesce(p_description, ''),
    'draft',
    true,
    p_slug,
    coalesce(p_questions, '[]'::jsonb),
    coalesce(p_settings, '{}'::jsonb)
  )
  returning * into v_form;
  return public.persora_form_get(p_owner, v_form.id);
end;
$function$;
revoke all on function public.persora_form_create(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persora_form_create(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;

create or replace function public.persora_form_save(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_description text,
  p_status text,
  p_accepting boolean,
  p_header_image jsonb,
  p_questions jsonb,
  p_settings jsonb,
  p_rotate_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_form from public.persora_forms where id = p_id and user_id = p_owner for update;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  update public.persora_forms
  set title = coalesce(nullif(btrim(p_title), ''), title),
      description = coalesce(p_description, description),
      status = coalesce(p_status, status),
      accepting_responses = coalesce(p_accepting, accepting_responses),
      header_image = p_header_image,
      questions = coalesce(p_questions, questions),
      settings = coalesce(p_settings, settings),
      public_slug = coalesce(nullif(btrim(p_rotate_slug), ''), public_slug),
      revision = revision + 1,
      updated_at = v_now
  where id = p_id and user_id = p_owner
  returning * into v_form;
  return public.persora_form_get(p_owner, v_form.id);
end;
$function$;
revoke all on function public.persora_form_save(uuid, uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.persora_form_save(uuid, uuid, text, text, text, boolean, jsonb, jsonb, jsonb, text) to service_role;

create or replace function public.persora_form_duplicate(
  p_owner uuid,
  p_source_id uuid,
  p_new_id uuid,
  p_new_slug text,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_source public.persora_forms%rowtype;
  v_form public.persora_forms%rowtype;
begin
  select * into v_source from public.persora_forms where id = p_source_id and user_id = p_owner;
  if v_source.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_forms where user_id = p_owner) >= 200 then
    raise exception 'You can have up to 200 forms.' using errcode = 'P0409';
  end if;
  insert into public.persora_forms (
    id, user_id, title, description, status, accepting_responses, public_slug, header_image, questions, settings
  )
  values (
    p_new_id,
    p_owner,
    btrim(p_title),
    v_source.description,
    'draft',
    true,
    p_new_slug,
    null,
    (
      select coalesce(
        jsonb_agg(
          (q - 'imageAssetId') || jsonb_build_object(
            'options',
            case
              when jsonb_typeof(q -> 'options') = 'array' then (
                select coalesce(jsonb_agg(opt - 'imageAssetId'), '[]'::jsonb)
                from jsonb_array_elements(q -> 'options') opt
              )
              else coalesce(q -> 'options', '[]'::jsonb)
            end
          )
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(v_source.questions) q
    ),
    v_source.settings
  )
  returning * into v_form;
  return public.persora_form_get(p_owner, v_form.id);
end;
$function$;
revoke all on function public.persora_form_duplicate(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.persora_form_duplicate(uuid, uuid, uuid, text, text) to service_role;

create or replace function public.persora_form_delete(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_keys jsonb;
begin
  select * into v_form from public.persora_forms where id = p_id and user_id = p_owner for update;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys
  from public.persora_form_assets
  where form_id = p_id and owner_id = p_owner;

  delete from public.persora_forms where id = p_id and user_id = p_owner;
  return jsonb_build_object('ok', true, 'file_keys', v_keys);
end;
$function$;
revoke all on function public.persora_form_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_delete(uuid, uuid) to service_role;

create or replace function public.persora_form_responses_list(p_owner uuid, p_form_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
begin
  select * into v_form from public.persora_forms where id = p_form_id and user_id = p_owner;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'response_count', v_form.response_count,
    'accepting_responses', v_form.accepting_responses,
    'responses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'respondent_name', r.respondent_name,
          'respondent_email', r.respondent_email,
          'answers', r.answers,
          'quiz_result', r.quiz_result,
          'registration_code', r.registration_code,
          'submitted_at', r.submitted_at,
          'assets', coalesce((
            select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'type', a.file_type, 'size', a.file_size))
            from public.persora_form_assets a
            where a.response_id = r.id and a.form_id = p_form_id
          ), '[]'::jsonb)
        )
        order by r.submitted_at desc, r.id
      )
      from public.persora_form_responses r
      where r.form_id = p_form_id and r.owner_id = p_owner
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.persora_form_responses_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_responses_list(uuid, uuid) to service_role;

create or replace function public.persora_form_response_delete(p_owner uuid, p_form_id uuid, p_response_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_resp public.persora_form_responses%rowtype;
  v_keys jsonb;
begin
  select * into v_form from public.persora_forms where id = p_form_id and user_id = p_owner for update;
  if v_form.id is null then
    raise exception 'That form is not available in your account.' using errcode = 'P0404';
  end if;
  select coalesce(jsonb_agg(distinct file_key), '[]'::jsonb) into v_keys
  from public.persora_form_assets
  where form_id = p_form_id and response_id = p_response_id and owner_id = p_owner;

  delete from public.persora_form_responses
  where id = p_response_id and form_id = p_form_id and owner_id = p_owner
  returning * into v_resp;
  if v_resp.id is null then
    raise exception 'That response could not be found.' using errcode = 'P0404';
  end if;

  update public.persora_forms
  set response_count = greatest(0, (select count(*)::integer from public.persora_form_responses where form_id = p_form_id)),
      updated_at = clock_timestamp()
  where id = p_form_id;

  return jsonb_build_object('ok', true, 'file_keys', v_keys);
end;
$function$;
revoke all on function public.persora_form_response_delete(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_response_delete(uuid, uuid, uuid) to service_role;

create or replace function public.persora_form_asset_add(
  p_owner uuid,
  p_form_id uuid,
  p_id uuid,
  p_role text,
  p_key text,
  p_name text,
  p_type text,
  p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_row public.persora_form_assets%rowtype;
begin
  select * into v_form from public.persora_forms where id = p_form_id and user_id = p_owner;
  if v_form.id is null then
    raise exception 'That form is not available.' using errcode = 'P0404';
  end if;
  if p_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') then
    raise exception 'Only JPEG, PNG, WebP, and GIF images are supported.' using errcode = 'P0415';
  end if;
  if (select count(*) from public.persora_form_assets where form_id = p_form_id) >= 1000 then
    raise exception 'This form has reached the maximum number of image attachments.' using errcode = 'P0409';
  end if;
  insert into public.persora_form_assets (id, form_id, owner_id, role, file_key, file_name, file_type, file_size)
  values (p_id, p_form_id, p_owner, p_role, p_key, p_name, p_type, p_size)
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id,
    'role', v_row.role,
    'name', v_row.file_name,
    'type', v_row.file_type,
    'size', v_row.file_size,
    'created_at', v_row.created_at
  );
end;
$function$;
revoke all on function public.persora_form_asset_add(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.persora_form_asset_add(uuid, uuid, uuid, text, text, text, text, bigint) to service_role;

create or replace function public.persora_form_asset_get(
  p_actor uuid,
  p_slug text,
  p_form_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_row public.persora_form_assets%rowtype;
begin
  if p_slug is not null and btrim(p_slug) <> '' then
    select f.* into v_form
    from public.persora_forms f
    join public.profiles p on p.id = f.user_id and p.account_status = 'active'
    where f.public_slug = p_slug and f.status = 'published';
    if v_form.id is null then
      raise exception 'That image is not available.' using errcode = 'P0404';
    end if;
    -- Public form respondents can ONLY read builder_image assets, NEVER response_image uploads!
    select * into v_row
    from public.persora_form_assets
    where id = p_asset_id and form_id = v_form.id and role = 'builder_image';
  else
    select * into v_form from public.persora_forms where id = p_form_id and user_id = p_actor;
    if v_form.id is null then
      raise exception 'That image is not available.' using errcode = 'P0404';
    end if;
    select * into v_row
    from public.persora_form_assets
    where id = p_asset_id and form_id = v_form.id and owner_id = p_actor;
  end if;

  if v_row.id is null then
    raise exception 'That image is not available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'file_key', v_row.file_key,
    'name', v_row.file_name,
    'type', v_row.file_type,
    'size', v_row.file_size,
    'owner_id', v_row.owner_id
  );
end;
$function$;
revoke all on function public.persora_form_asset_get(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_form_asset_get(uuid, text, uuid, uuid) to service_role;

create or replace function public.persora_form_public_meta(p_slug text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then
    raise exception 'This form link is invalid or no longer available.' using errcode = 'P0404';
  end if;
  select f.* into v_form
  from public.persora_forms f
  join public.profiles p on p.id = f.user_id and p.account_status = 'active'
  where f.public_slug = p_slug;
  if v_form.id is null or v_form.status <> 'published' then
    raise exception 'This form is not published or is no longer available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'id', v_form.id,
    'owner_id', v_form.user_id,
    'title', v_form.title,
    'description', v_form.description,
    'status', v_form.status,
    'accepting_responses', v_form.accepting_responses,
    'public_slug', v_form.public_slug,
    'header_image', v_form.header_image,
    'questions', v_form.questions,
    'settings', v_form.settings,
    'response_count', v_form.response_count,
    'updated_at', v_form.updated_at
  );
end;
$function$;
revoke all on function public.persora_form_public_meta(text) from public, anon, authenticated;
grant execute on function public.persora_form_public_meta(text) to service_role;

create or replace function public.persora_form_submit_response(
  p_slug text,
  p_response_id uuid,
  p_respondent_user_id uuid,
  p_respondent_name text,
  p_respondent_email text,
  p_answers jsonb,
  p_quiz_result jsonb,
  p_registration_code text,
  p_asset_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_form public.persora_forms%rowtype;
  v_max_reg integer;
  v_require_signin boolean;
  v_asset_uuid_list uuid[];
  v_bound_count integer;
  v_resp public.persora_form_responses%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then
    raise exception 'This form link is invalid or no longer available.' using errcode = 'P0404';
  end if;
  select f.* into v_form
  from public.persora_forms f
  join public.profiles p on p.id = f.user_id and p.account_status = 'active'
  where f.public_slug = p_slug
  for update of f;

  if v_form.id is null or v_form.status <> 'published' then
    raise exception 'This form is not currently published.' using errcode = 'P0404';
  end if;
  if not v_form.accepting_responses then
    raise exception 'This form is no longer accepting responses.' using errcode = 'P0403';
  end if;

  v_require_signin := coalesce((v_form.settings ->> 'requireSignIn')::boolean, false);
  if v_require_signin and p_respondent_user_id is null then
    raise exception 'Sign in with a Persora account to submit this form.' using errcode = 'P0401';
  end if;

  if coalesce((v_form.settings -> 'eventRegistration' ->> 'enabled')::boolean, false) then
    v_max_reg := (v_form.settings -> 'eventRegistration' ->> 'maxRegistrations')::integer;
    if v_max_reg is not null and v_max_reg > 0 and v_form.response_count >= v_max_reg then
      raise exception 'Registration is full — all available spots have been claimed.' using errcode = 'P0409';
    end if;
  end if;

  if v_form.response_count >= 25000 then
    raise exception 'This form has reached its maximum response limit.' using errcode = 'P0409';
  end if;

  v_asset_uuid_list := public.persora_table_uuid_array(coalesce(p_asset_ids, '[]'::jsonb));

  insert into public.persora_form_responses (
    id, form_id, owner_id, respondent_user_id, respondent_name, respondent_email, answers, quiz_result, registration_code, submitted_at
  )
  values (
    p_response_id,
    v_form.id,
    v_form.user_id,
    p_respondent_user_id,
    coalesce(btrim(p_respondent_name), ''),
    coalesce(btrim(p_respondent_email), ''),
    coalesce(p_answers, '{}'::jsonb),
    p_quiz_result,
    nullif(btrim(p_registration_code), ''),
    v_now
  )
  returning * into v_resp;

  if cardinality(v_asset_uuid_list) > 0 then
    update public.persora_form_assets
    set response_id = v_resp.id
    where id = any(v_asset_uuid_list)
      and form_id = v_form.id
      and role = 'response_image'
      and response_id is null;
    get diagnostics v_bound_count = row_count;
    if v_bound_count <> cardinality(v_asset_uuid_list) then
      raise exception 'One or more uploaded images are invalid or already used.' using errcode = 'P0422';
    end if;
  end if;

  update public.persora_forms
  set response_count = response_count + 1
  where id = v_form.id;

  return jsonb_build_object(
    'id', v_resp.id,
    'submitted_at', v_resp.submitted_at,
    'registration_code', v_resp.registration_code,
    'response_count', v_form.response_count + 1
  );
end;
$function$;
revoke all on function public.persora_form_submit_response(text, uuid, uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.persora_form_submit_response(text, uuid, uuid, text, text, jsonb, jsonb, text, jsonb) to service_role;

create or replace function public.persora_forms_export(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'forms', coalesce((select jsonb_agg(public.persora_form_summary(f) || jsonb_build_object('questions', f.questions, 'settings', f.settings) order by f.created_at) from public.persora_forms f where f.user_id = p_owner), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'form_id', r.form_id, 'respondent_name', r.respondent_name, 'respondent_email', r.respondent_email, 'answers', r.answers, 'quiz_result', r.quiz_result, 'registration_code', r.registration_code, 'submitted_at', r.submitted_at) order by r.submitted_at) from public.persora_form_responses r where r.owner_id = p_owner), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_forms_export(uuid) from public, anon, authenticated;
grant execute on function public.persora_forms_export(uuid) to service_role;

-- ============================================================================
-- Persora Docs Module (Standalone Rich Documents, Member/Link Sharing & Trash)
-- All RLS policies strictly use public.persora_jwt_uid() and never raw auth.uid().
-- ============================================================================

-- 1. Extend global Trash kind constraint to support 'persora_doc'
alter table public.trash_items
  drop constraint if exists trash_items_kind_check;

alter table public.trash_items
  add constraint trash_items_kind_check
  check (
    kind = any (
      array[
        'vault_item'::text,
        'contact'::text,
        'business_card'::text,
        'medical_record'::text,
        'timeline_event'::text,
        'photo_studio_photo'::text,
        'pdf_studio_document'::text,
        'persora_table'::text,
        'persora_doc'::text
      ]
    )
  );

-- 2. Core Persora Docs table
create table if not exists public.persora_docs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled document'::text,
  starred boolean not null default false,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  preview_blocks jsonb not null default '[]'::jsonb,
  snippet text not null default ''::text,
  word_count integer not null default 0,
  revision bigint not null default 1,
  last_batch_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  opened_at timestamp with time zone not null default now(),
  constraint persora_docs_pkey primary key (id),
  constraint persora_docs_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint persora_docs_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160),
  constraint persora_docs_content_check check (jsonb_typeof(content) = 'object'),
  constraint persora_docs_preview_blocks_check check (jsonb_typeof(preview_blocks) = 'array'),
  constraint persora_docs_snippet_check check (char_length(snippet) <= 500),
  constraint persora_docs_word_count_check check (word_count >= 0),
  constraint persora_docs_revision_check check (revision >= 1)
);

create index if not exists persora_docs_user_opened_idx
  on public.persora_docs using btree (user_id, opened_at desc, updated_at desc);

create index if not exists persora_docs_user_updated_idx
  on public.persora_docs using btree (user_id, updated_at desc);

alter table public.persora_docs enable row level security;
drop policy if exists persora_docs_owner_policy on public.persora_docs;
create policy persora_docs_owner_policy on public.persora_docs
  for all
  to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.persora_docs from public, anon, authenticated;
grant all on public.persora_docs to service_role;

-- 3. Member-to-member document shares
create table if not exists public.persora_doc_shares (
  id uuid not null default gen_random_uuid(),
  doc_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null,
  permission text not null default 'view'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_doc_shares_pkey primary key (id),
  constraint persora_doc_shares_doc_id_fkey foreign key (doc_id) references public.persora_docs(id) on delete cascade,
  constraint persora_doc_shares_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_doc_shares_recipient_id_fkey foreign key (recipient_id) references public.profiles(id) on delete cascade,
  constraint persora_doc_shares_unique unique (doc_id, recipient_id),
  constraint persora_doc_shares_no_self check (owner_id <> recipient_id),
  constraint persora_doc_shares_permission_check check (permission = any (array['view'::text, 'edit'::text]))
);

create index if not exists persora_doc_shares_recipient_idx
  on public.persora_doc_shares using btree (recipient_id, updated_at desc);

create index if not exists persora_doc_shares_owner_doc_idx
  on public.persora_doc_shares using btree (owner_id, doc_id);

alter table public.persora_doc_shares enable row level security;
drop policy if exists persora_doc_shares_select_policy on public.persora_doc_shares;
create policy persora_doc_shares_select_policy on public.persora_doc_shares
  for select
  to authenticated
  using (owner_id = public.persora_jwt_uid() or recipient_id = public.persora_jwt_uid());
drop policy if exists persora_doc_shares_owner_write_policy on public.persora_doc_shares;
create policy persora_doc_shares_owner_write_policy on public.persora_doc_shares
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_doc_shares from public, anon, authenticated;
grant all on public.persora_doc_shares to service_role;

-- 4. Public link sharing for Persora Docs
create table if not exists public.persora_doc_share_links (
  doc_id uuid not null,
  owner_id uuid not null,
  share_token text not null,
  enabled boolean not null default false,
  permission text not null default 'view'::text,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint persora_doc_share_links_pkey primary key (doc_id),
  constraint persora_doc_share_links_doc_id_fkey foreign key (doc_id) references public.persora_docs(id) on delete cascade,
  constraint persora_doc_share_links_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint persora_doc_share_links_token_unique unique (share_token),
  constraint persora_doc_share_links_token_format check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'::text),
  constraint persora_doc_share_links_permission_check check (permission = any (array['view'::text, 'edit'::text]))
);

create index if not exists persora_doc_share_links_owner_idx
  on public.persora_doc_share_links using btree (owner_id);

alter table public.persora_doc_share_links enable row level security;
drop policy if exists persora_doc_share_links_owner_policy on public.persora_doc_share_links;
create policy persora_doc_share_links_owner_policy on public.persora_doc_share_links
  for all
  to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.persora_doc_share_links from public, anon, authenticated;
grant all on public.persora_doc_share_links to service_role;

-- ============================================================================
-- 5. Security-definer helper & RPCs (locked exclusively to service_role)
-- ============================================================================

create or replace function public.persora_doc_summary(d public.persora_docs)
returns jsonb
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'starred', d.starred,
    'preview_blocks', d.preview_blocks,
    'snippet', d.snippet,
    'word_count', d.word_count,
    'revision', d.revision,
    'created_at', d.created_at,
    'updated_at', d.updated_at,
    'opened_at', d.opened_at
  );
$function$;
revoke all on function public.persora_doc_summary(public.persora_docs) from public, anon, authenticated;
revoke all on function public.persora_doc_summary(public.persora_docs) from service_role;

create or replace function public.persora_doc_access(p_actor uuid, p_doc_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_owner public.profiles%rowtype;
  v_share public.persora_doc_shares%rowtype;
  v_owner_name text;
begin
  if p_actor is null or p_doc_id is null then
    return null;
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id;
  if v_doc.id is null then
    return null;
  end if;
  if v_doc.user_id = p_actor then
    return jsonb_build_object(
      'role', 'owner',
      'shared', false,
      'owner_id', v_doc.user_id,
      'share_id', null,
      'owner_name', null,
      'owner_login_id', null
    );
  end if;
  select * into v_share
  from public.persora_doc_shares
  where doc_id = p_doc_id and recipient_id = p_actor;
  if v_share.id is null then
    return null;
  end if;
  select * into v_owner from public.profiles where id = v_doc.user_id and account_status = 'active';
  if v_owner.id is null then
    return null;
  end if;
  v_owner_name := coalesce(nullif(btrim(v_owner.full_name), ''), split_part(v_owner.email, '@', 1), 'Persora Member');
  return jsonb_build_object(
    'role', v_share.permission,
    'shared', true,
    'owner_id', v_doc.user_id,
    'share_id', v_share.id,
    'owner_name', v_owner_name,
    'owner_login_id', v_owner.login_id
  );
end;
$function$;
revoke all on function public.persora_doc_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_doc_access(uuid, uuid) from service_role;

create or replace function public.persora_docs_list(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with visible as (
    select
      public.persora_doc_summary(d) || jsonb_build_object(
        'shared', false,
        'has_shares', (
          exists (select 1 from public.persora_doc_shares ds where ds.doc_id = d.id)
          or exists (select 1 from public.persora_doc_share_links dsl where dsl.doc_id = d.id and dsl.enabled = true and dsl.revoked_at is null)
        ),
        'permission', 'owner'
      ) as item,
      greatest(d.opened_at, d.updated_at) as sort_at
    from public.persora_docs d
    where d.user_id = p_owner
    union all
    select
      (public.persora_doc_summary(d) || jsonb_build_object(
        'starred', false,
        'shared', true,
        'has_shares', true,
        'permission', s.permission,
        'share_id', s.id,
        'owner_id', d.user_id,
        'owner_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
        'owner_login_id', p.login_id
      )) as item,
      greatest(d.updated_at, s.updated_at) as sort_at
    from public.persora_doc_shares s
    join public.persora_docs d on d.id = s.doc_id
    join public.profiles p on p.id = d.user_id and p.account_status = 'active'
    where s.recipient_id = p_owner
  )
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb) from visible;
$function$;
revoke all on function public.persora_docs_list(uuid) from public, anon, authenticated;
grant execute on function public.persora_docs_list(uuid) to service_role;

create or replace function public.persora_doc_create(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_starred boolean,
  p_content jsonb,
  p_preview_blocks jsonb,
  p_snippet text,
  p_word_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_existing public.persora_docs%rowtype;
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_existing from public.persora_docs where id = p_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That document id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'doc',
      public.persora_doc_summary(v_existing) || jsonb_build_object(
        'content', v_existing.content,
        'shared', false,
        'has_shares', false,
        'permission', 'owner'
      )
    );
  end if;

  if (select count(*) from public.persora_docs where user_id = p_owner) >= 300 then
    raise exception 'You have reached the 300-document limit. Move unused documents to Trash to create more.' using errcode = 'P0409';
  end if;

  insert into public.persora_docs (
    id, user_id, title, starred, content, preview_blocks, snippet, word_count, revision, created_at, updated_at, opened_at
  )
  values (
    p_id,
    p_owner,
    coalesce(nullif(btrim(p_title), ''), 'Untitled document'),
    coalesce(p_starred, false),
    coalesce(p_content, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
    coalesce(p_preview_blocks, '[]'::jsonb),
    coalesce(p_snippet, ''),
    greatest(coalesce(p_word_count, 0), 0),
    1,
    v_now,
    v_now,
    v_now
  )
  returning * into v_doc;

  return jsonb_build_object(
    'doc',
    public.persora_doc_summary(v_doc) || jsonb_build_object(
      'content', v_doc.content,
      'shared', false,
      'has_shares', false,
      'permission', 'owner'
    )
  );
end;
$function$;
revoke all on function public.persora_doc_create(uuid, uuid, text, boolean, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.persora_doc_create(uuid, uuid, text, boolean, jsonb, jsonb, text, integer) to service_role;

create or replace function public.persora_doc_get(
  p_owner uuid,
  p_id uuid,
  p_touch boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_doc public.persora_docs%rowtype;
  v_has_shares boolean;
  v_summary jsonb;
begin
  v_access := public.persora_doc_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';

  if p_touch and v_role = 'owner' then
    update public.persora_docs
    set opened_at = clock_timestamp()
    where id = p_id and user_id = p_owner
    returning * into v_doc;
  else
    select * into v_doc from public.persora_docs where id = p_id;
  end if;

  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  v_has_shares := (
    exists (select 1 from public.persora_doc_shares ds where ds.doc_id = v_doc.id)
    or exists (select 1 from public.persora_doc_share_links dsl where dsl.doc_id = v_doc.id and dsl.enabled = true and dsl.revoked_at is null)
  );

  v_summary := public.persora_doc_summary(v_doc) || jsonb_build_object(
    'content', v_doc.content,
    'shared', coalesce((v_access ->> 'shared')::boolean, false),
    'has_shares', case when coalesce((v_access ->> 'shared')::boolean, false) then true else v_has_shares end,
    'permission', v_role
  );

  if coalesce((v_access ->> 'shared')::boolean, false) then
    v_summary := v_summary || jsonb_build_object(
      'starred', false,
      'share_id', v_access -> 'share_id',
      'owner_id', v_access -> 'owner_id',
      'owner_name', v_access -> 'owner_name',
      'owner_login_id', v_access -> 'owner_login_id'
    );
  end if;

  return jsonb_build_object('doc', v_summary);
end;
$function$;
revoke all on function public.persora_doc_get(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.persora_doc_get(uuid, uuid, boolean) to service_role;

create or replace function public.persora_doc_save(
  p_owner uuid,
  p_id uuid,
  p_base bigint,
  p_batch uuid,
  p_title text,
  p_content jsonb,
  p_preview_blocks jsonb,
  p_snippet text,
  p_word_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  v_access := public.persora_doc_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';
  if v_role not in ('owner', 'edit') then
    raise exception 'You do not have edit permission for this shared document.' using errcode = 'P0403';
  end if;

  select * into v_doc from public.persora_docs where id = p_id for update;
  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  if v_doc.last_batch_id is not null and v_doc.last_batch_id = p_batch then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'doc', public.persora_doc_summary(v_doc)
    );
  end if;

  if v_doc.revision <> p_base then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'doc', public.persora_doc_summary(v_doc)
    );
  end if;

  update public.persora_docs
  set title = coalesce(nullif(btrim(p_title), ''), title),
      content = coalesce(p_content, content),
      preview_blocks = coalesce(p_preview_blocks, preview_blocks),
      snippet = coalesce(p_snippet, snippet),
      word_count = greatest(coalesce(p_word_count, word_count), 0),
      revision = revision + 1,
      last_batch_id = p_batch,
      updated_at = v_now,
      opened_at = case when v_role = 'owner' then v_now else opened_at end
  where id = p_id
  returning * into v_doc;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'doc', public.persora_doc_summary(v_doc)
  );
end;
$function$;
revoke all on function public.persora_doc_save(uuid, uuid, bigint, uuid, text, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.persora_doc_save(uuid, uuid, bigint, uuid, text, jsonb, jsonb, text, integer) to service_role;

create or replace function public.persora_doc_update_info(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_starred boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_role text;
  v_doc public.persora_docs%rowtype;
  v_has_shares boolean;
begin
  v_access := public.persora_doc_access(p_owner, p_id);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;
  v_role := v_access ->> 'role';

  if v_role = 'owner' then
    update public.persora_docs
    set title = coalesce(nullif(btrim(p_title), ''), title),
        starred = coalesce(p_starred, starred),
        updated_at = case when p_title is not null and nullif(btrim(p_title), '') is distinct from title then clock_timestamp() else updated_at end
    where id = p_id and user_id = p_owner
    returning * into v_doc;
  elsif v_role = 'edit' and p_starred is null and p_title is not null then
    update public.persora_docs
    set title = coalesce(nullif(btrim(p_title), ''), title),
        updated_at = clock_timestamp()
    where id = p_id
    returning * into v_doc;
  else
    raise exception 'Only the document owner can change these settings.' using errcode = 'P0403';
  end if;

  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  v_has_shares := (
    exists (select 1 from public.persora_doc_shares ds where ds.doc_id = v_doc.id)
    or exists (select 1 from public.persora_doc_share_links dsl where dsl.doc_id = v_doc.id and dsl.enabled = true and dsl.revoked_at is null)
  );

  return public.persora_doc_summary(v_doc) || jsonb_build_object(
    'shared', v_role <> 'owner',
    'has_shares', case when v_role <> 'owner' then true else v_has_shares end,
    'permission', v_role
  );
end;
$function$;
revoke all on function public.persora_doc_update_info(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.persora_doc_update_info(uuid, uuid, text, boolean) to service_role;

create or replace function public.persora_doc_duplicate(
  p_owner uuid,
  p_source uuid,
  p_new_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_access jsonb;
  v_source public.persora_docs%rowtype;
  v_existing public.persora_docs%rowtype;
  v_copy public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_existing from public.persora_docs where id = p_new_id;
  if v_existing.id is not null then
    if v_existing.user_id <> p_owner then
      raise exception 'That document id is already in use.' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'doc',
      public.persora_doc_summary(v_existing) || jsonb_build_object(
        'shared', false,
        'has_shares', false,
        'permission', 'owner'
      )
    );
  end if;

  v_access := public.persora_doc_access(p_owner, p_source);
  if v_access is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  if (select count(*) from public.persora_docs where user_id = p_owner) >= 300 then
    raise exception 'You have reached the 300-document limit. Move unused documents to Trash to create more.' using errcode = 'P0409';
  end if;

  select * into v_source from public.persora_docs where id = p_source;
  if v_source.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  insert into public.persora_docs (
    id, user_id, title, starred, content, preview_blocks, snippet, word_count, revision, created_at, updated_at, opened_at
  )
  values (
    p_new_id,
    p_owner,
    coalesce(nullif(btrim(p_title), ''), left(v_source.title || ' copy', 160)),
    false,
    v_source.content,
    v_source.preview_blocks,
    v_source.snippet,
    v_source.word_count,
    1,
    v_now,
    v_now,
    v_now
  )
  returning * into v_copy;

  return jsonb_build_object(
    'doc',
    public.persora_doc_summary(v_copy) || jsonb_build_object(
      'shared', false,
      'has_shares', false,
      'permission', 'owner'
    )
  );
end;
$function$;
revoke all on function public.persora_doc_duplicate(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_doc_duplicate(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_doc_trash_move(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
  v_payload jsonb;
begin
  select * into v_doc from public.persora_docs where id = p_id and user_id = p_owner for update;
  if v_doc.id is null then
    raise exception 'That document is not available in your account.' using errcode = 'P0404';
  end if;

  v_payload := jsonb_build_object('row', to_jsonb(v_doc));
  delete from public.persora_docs where id = p_id and user_id = p_owner;
  delete from public.trash_items where id = p_id and owner_id = p_owner and status = 'active';

  insert into public.trash_items (
    id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at
  )
  values (
    p_id,
    p_owner,
    'persora_doc',
    v_doc.title,
    jsonb_build_object('space', 'persora-docs', 'recordType', 'Document', 'wordCount', v_doc.word_count),
    v_payload,
    '[]'::jsonb,
    'active',
    v_now,
    v_now + interval '7 days'
  )
  returning * into v_trash;

  return to_jsonb(v_trash) - 'payload';
end;
$function$;
revoke all on function public.persora_doc_trash_move(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_trash_move(uuid, uuid) to service_role;

create or replace function public.persora_doc_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_title text;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id
    and owner_id = p_owner
    and kind = 'persora_doc'
    and status = 'active'
    and expires_at > clock_timestamp()
  returning * into v_trash;

  if not found then
    raise exception 'That item is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  if exists (select 1 from public.persora_docs where id = v_trash.id) then
    raise exception 'This document already exists in your account.' using errcode = 'P0409';
  end if;

  if (select count(*) from public.persora_docs where user_id = p_owner) >= 300 then
    raise exception 'You have 300 documents, the maximum. Delete one to restore this document.' using errcode = 'P0409';
  end if;

  v_row := v_trash.payload -> 'row';
  v_title := v_row ->> 'title';

  insert into public.persora_docs
  select *
  from jsonb_populate_record(
    null::public.persora_docs,
    v_row || jsonb_build_object('last_batch_id', null, 'updated_at', clock_timestamp())
  );

  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id, 'note', null, 'name', v_title);
end;
$function$;
revoke all on function public.persora_doc_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_trash_restore(uuid, uuid) to service_role;

-- 6. Sharing RPCs (reusing ShareTableDialog contract)
create or replace function public.persora_doc_sharing_get(p_owner uuid, p_doc_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_link public.persora_doc_share_links%rowtype;
begin
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can manage sharing.' using errcode = 'P0404';
  end if;
  select * into v_link from public.persora_doc_share_links where doc_id = p_doc_id and owner_id = p_owner;
  return jsonb_build_object(
    'doc_id', v_doc.id,
    'doc_title', v_doc.title,
    'shares', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'recipient_id', s.recipient_id,
          'recipient_name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'Persora Member'),
          'recipient_login_id', p.login_id,
          'recipient_email', p.email,
          'permission', s.permission,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        order by s.created_at asc
      )
      from public.persora_doc_shares s
      join public.profiles p on p.id = s.recipient_id
      where s.doc_id = p_doc_id and s.owner_id = p_owner
    ), '[]'::jsonb),
    'link', case
      when v_link.doc_id is null then jsonb_build_object('enabled', false, 'permission', 'view', 'share_token', null, 'updated_at', null)
      else jsonb_build_object(
        'enabled', v_link.enabled and v_link.revoked_at is null,
        'permission', v_link.permission,
        'share_token', case when v_link.enabled and v_link.revoked_at is null then v_link.share_token else null end,
        'updated_at', v_link.updated_at
      )
    end
  );
end;
$function$;
revoke all on function public.persora_doc_sharing_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_sharing_get(uuid, uuid) to service_role;

create or replace function public.persora_doc_share_upsert(
  p_owner uuid,
  p_doc_id uuid,
  p_recipient uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_recipient public.profiles%rowtype;
  v_existing public.persora_doc_shares%rowtype;
  v_share public.persora_doc_shares%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'Choose a valid permission (view or edit).' using errcode = 'P0422';
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can share this document.' using errcode = 'P0404';
  end if;
  if p_recipient = p_owner then
    raise exception 'You already own this document.' using errcode = 'P0422';
  end if;
  select * into v_recipient from public.profiles where id = p_recipient and account_status = 'active';
  if v_recipient.id is null then
    raise exception 'Choose an active Persora member.' using errcode = 'P0404';
  end if;
  if (select count(*) from public.persora_doc_shares where doc_id = p_doc_id) >= 100 then
    raise exception 'A document can be shared directly with up to 100 members.' using errcode = 'P0409';
  end if;
  select * into v_existing from public.persora_doc_shares where doc_id = p_doc_id and recipient_id = p_recipient;

  insert into public.persora_doc_shares (doc_id, owner_id, recipient_id, permission, created_at, updated_at)
  values (p_doc_id, p_owner, p_recipient, p_permission, v_now, v_now)
  on conflict (doc_id, recipient_id) do update
  set permission = excluded.permission, updated_at = v_now
  returning * into v_share;

  return jsonb_build_object(
    'created', v_existing.id is null,
    'previous_permission', v_existing.permission,
    'doc_title', v_doc.title,
    'share', jsonb_build_object(
      'id', v_share.id,
      'recipient_id', v_share.recipient_id,
      'recipient_name', coalesce(nullif(btrim(v_recipient.full_name), ''), split_part(v_recipient.email, '@', 1), 'Persora Member'),
      'recipient_login_id', v_recipient.login_id,
      'recipient_email', v_recipient.email,
      'permission', v_share.permission,
      'created_at', v_share.created_at,
      'updated_at', v_share.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_doc_share_upsert(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_doc_share_upsert(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_doc_share_update(
  p_owner uuid,
  p_doc_id uuid,
  p_share_id uuid,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_share public.persora_doc_shares%rowtype;
  v_recipient public.profiles%rowtype;
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'Choose a valid permission (view or edit).' using errcode = 'P0422';
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can update sharing permissions.' using errcode = 'P0404';
  end if;
  update public.persora_doc_shares
  set permission = p_permission, updated_at = clock_timestamp()
  where id = p_share_id and doc_id = p_doc_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  select * into v_recipient from public.profiles where id = v_share.recipient_id;
  return jsonb_build_object(
    'doc_title', v_doc.title,
    'share', jsonb_build_object(
      'id', v_share.id,
      'recipient_id', v_share.recipient_id,
      'recipient_name', coalesce(nullif(btrim(v_recipient.full_name), ''), split_part(v_recipient.email, '@', 1), 'Persora Member'),
      'recipient_login_id', v_recipient.login_id,
      'recipient_email', v_recipient.email,
      'permission', v_share.permission,
      'created_at', v_share.created_at,
      'updated_at', v_share.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_doc_share_update(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.persora_doc_share_update(uuid, uuid, uuid, text) to service_role;

create or replace function public.persora_doc_share_revoke(
  p_owner uuid,
  p_doc_id uuid,
  p_share_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_share public.persora_doc_shares%rowtype;
begin
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can revoke sharing.' using errcode = 'P0404';
  end if;
  delete from public.persora_doc_shares
  where id = p_share_id and doc_id = p_doc_id and owner_id = p_owner
  returning * into v_share;
  if v_share.id is null then
    raise exception 'That share entry could not be found.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'ok', true,
    'recipient_id', v_share.recipient_id,
    'doc_title', v_doc.title
  );
end;
$function$;
revoke all on function public.persora_doc_share_revoke(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_doc_share_revoke(uuid, uuid, uuid) to service_role;

create or replace function public.persora_doc_link_configure(
  p_owner uuid,
  p_doc_id uuid,
  p_enabled boolean,
  p_permission text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_doc public.persora_docs%rowtype;
  v_existing public.persora_doc_share_links%rowtype;
  v_link public.persora_doc_share_links%rowtype;
  v_perm text := coalesce(p_permission, 'view');
  v_token text;
  v_now timestamptz := clock_timestamp();
begin
  if v_perm not in ('view', 'edit') then
    raise exception 'Public link permission must be view or edit.' using errcode = 'P0422';
  end if;
  select * into v_doc from public.persora_docs where id = p_doc_id and user_id = p_owner;
  if v_doc.id is null then
    raise exception 'Only the document owner can configure link sharing.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.persora_doc_share_links where doc_id = p_doc_id and owner_id = p_owner;
  v_token := coalesce(nullif(btrim(p_token), ''), v_existing.share_token);
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'A valid share token is required.' using errcode = 'P0422';
  end if;

  insert into public.persora_doc_share_links (doc_id, owner_id, share_token, enabled, permission, revoked_at, created_at, updated_at)
  values (p_doc_id, p_owner, v_token, coalesce(p_enabled, false), v_perm, case when coalesce(p_enabled, false) then null else v_now end, v_now, v_now)
  on conflict (doc_id) do update
  set share_token = excluded.share_token,
      enabled = excluded.enabled,
      permission = excluded.permission,
      revoked_at = case when excluded.enabled then null else v_now end,
      updated_at = v_now
  returning * into v_link;

  return jsonb_build_object(
    'enabled', v_link.enabled and v_link.revoked_at is null,
    'permission', v_link.permission,
    'share_token', case when v_link.enabled and v_link.revoked_at is null then v_link.share_token else null end,
    'updated_at', v_link.updated_at
  );
end;
$function$;
revoke all on function public.persora_doc_link_configure(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.persora_doc_link_configure(uuid, uuid, boolean, text, text) to service_role;

create or replace function public.persora_doc_public_get(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.persora_doc_share_links%rowtype;
  v_doc public.persora_docs%rowtype;
  v_owner public.profiles%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.persora_doc_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.doc_id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select * into v_doc from public.persora_docs where id = v_link.doc_id;
  if v_doc.id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select * into v_owner from public.profiles where id = v_doc.user_id;

  return jsonb_build_object(
    'permission', v_link.permission,
    'owner_name', coalesce(nullif(btrim(v_owner.full_name), ''), split_part(v_owner.email, '@', 1), 'Persora Member'),
    'doc', jsonb_build_object(
      'id', v_doc.id,
      'title', v_doc.title,
      'content', v_doc.content,
      'word_count', v_doc.word_count,
      'revision', v_doc.revision,
      'updated_at', v_doc.updated_at
    )
  );
end;
$function$;
revoke all on function public.persora_doc_public_get(text) from public, anon, authenticated;
grant execute on function public.persora_doc_public_get(text) to service_role;

create or replace function public.persora_doc_public_save(
  p_token text,
  p_base bigint,
  p_batch uuid,
  p_title text,
  p_content jsonb,
  p_preview_blocks jsonb,
  p_snippet text,
  p_word_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_link public.persora_doc_share_links%rowtype;
  v_doc public.persora_docs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  select l.* into v_link
  from public.persora_doc_share_links l
  join public.profiles p on p.id = l.owner_id and p.account_status = 'active'
  where l.share_token = p_token and l.enabled = true and l.revoked_at is null;
  if v_link.doc_id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;
  if v_link.permission <> 'edit' then
    raise exception 'Editing is disabled for this shared link.' using errcode = 'P0403';
  end if;

  select * into v_doc from public.persora_docs where id = v_link.doc_id for update;
  if v_doc.id is null then
    raise exception 'This shared document link is unavailable, disabled, or has been revoked.' using errcode = 'P0404';
  end if;

  if v_doc.last_batch_id is not null and v_doc.last_batch_id = p_batch then
    return jsonb_build_object('ok', true, 'replayed', true, 'doc', public.persora_doc_summary(v_doc));
  end if;

  if v_doc.revision <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'doc', public.persora_doc_summary(v_doc));
  end if;

  update public.persora_docs
  set title = coalesce(nullif(btrim(p_title), ''), title),
      content = coalesce(p_content, content),
      preview_blocks = coalesce(p_preview_blocks, preview_blocks),
      snippet = coalesce(p_snippet, snippet),
      word_count = greatest(coalesce(p_word_count, word_count), 0),
      revision = revision + 1,
      last_batch_id = p_batch,
      updated_at = v_now
  where id = v_doc.id
  returning * into v_doc;

  return jsonb_build_object('ok', true, 'replayed', false, 'doc', public.persora_doc_summary(v_doc));
end;
$function$;
revoke all on function public.persora_doc_public_save(text, bigint, uuid, text, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.persora_doc_public_save(text, bigint, uuid, text, jsonb, jsonb, text, integer) to service_role;

create or replace function public.persora_docs_export(p_owner uuid)
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'docs', coalesce((
      select jsonb_agg(
        public.persora_doc_summary(d) || jsonb_build_object('content', d.content)
        order by d.created_at
      )
      from public.persora_docs d
      where d.user_id = p_owner
    ), '[]'::jsonb)
  );
$function$;
revoke all on function public.persora_docs_export(uuid) from public, anon, authenticated;
grant execute on function public.persora_docs_export(uuid) to service_role;
