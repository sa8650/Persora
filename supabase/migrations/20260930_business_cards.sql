-- Persora public business cards. Public visibility is enforced in the Pages API query on every request.
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

alter table public.business_cards enable row level security;
alter table public.business_card_reports enable row level security;
revoke all on public.business_cards, public.business_card_reports from anon, authenticated;
grant all on public.business_cards, public.business_card_reports to service_role;
