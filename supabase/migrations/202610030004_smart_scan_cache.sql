begin;

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

commit;
