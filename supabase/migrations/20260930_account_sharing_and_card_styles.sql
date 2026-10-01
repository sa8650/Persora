-- Structured card styles and user-to-user sharing for contacts/business cards.
alter table public.business_cards
  add column if not exists card_style text not null default 'garden'
  check (card_style in ('garden', 'minimal', 'midnight', 'terracotta'));

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
alter table public.record_shares enable row level security;
revoke all on public.record_shares from public, anon, authenticated;
grant all on public.record_shares to service_role;
