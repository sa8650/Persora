-- Persora document sharing, comments, and recipient notifications.
-- Safe to run once on an existing database. All app access remains behind the Pages API.
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

create index if not exists vault_shares_owner_created_idx on public.vault_shares(owner_id, created_at desc);
create index if not exists vault_shares_recipient_created_idx on public.vault_shares(recipient_id, created_at desc);
create index if not exists vault_share_comments_share_created_idx on public.vault_share_comments(share_id, created_at asc);
create index if not exists share_notifications_recipient_created_idx on public.share_notifications(recipient_id, created_at desc);

alter table public.vault_shares enable row level security;
alter table public.vault_share_comments enable row level security;
alter table public.share_notifications enable row level security;
revoke all on public.vault_shares, public.vault_share_comments, public.share_notifications from anon, authenticated;
grant all on public.vault_shares, public.vault_share_comments, public.share_notifications to service_role;
