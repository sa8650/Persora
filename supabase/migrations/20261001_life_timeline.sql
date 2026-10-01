-- Private Life Timeline posts. Post content is server-encrypted with AES-256-GCM in the Pages API.
-- Dates, event kind, generated key, and linked record references remain queryable metadata.
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
  constraint timeline_event_links_owner_event_fk foreign key (event_id, owner_id)
    references public.timeline_events(id, user_id) on delete cascade
);
create index if not exists timeline_event_links_record_idx on public.timeline_event_links(record_id);

alter table public.timeline_events enable row level security;
alter table public.timeline_event_links enable row level security;
revoke all on public.timeline_events, public.timeline_event_links from anon, authenticated;
grant all on public.timeline_events, public.timeline_event_links to service_role;

drop trigger if exists timeline_events_touch_updated_at on public.timeline_events;
create trigger timeline_events_touch_updated_at before update on public.timeline_events
  for each row execute function public.touch_updated_at();
