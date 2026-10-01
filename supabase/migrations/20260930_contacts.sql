-- Persora personal contacts, shared through the authenticated Pages API for web and mobile clients.
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
alter table public.contacts enable row level security;
revoke all on public.contacts from anon, authenticated;
grant all on public.contacts to service_role;
