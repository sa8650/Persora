-- Persora Connections: external-service links (EMS first) and per-provider
-- platform integration settings. Safe to re-run.
--
-- Security model
--   * Both tables are reachable ONLY through the Cloudflare worker with the
--     service-role key: RLS is enabled with no policies and anon/authenticated
--     privileges are revoked, so browsers can never read them directly.
--   * integration_settings.secret_ciphertext holds the shared integration
--     secret encrypted with AES-GCM (CONNECTIONS_ENCRYPTION_KEY). Only the last
--     four characters are kept in clear text for the masked admin display.
--   * user_connections.credential_ciphertext holds the provider grant/token
--     encrypted with a key bound to the member's user id. Passwords entered to
--     connect a service are never stored.
--   * A temporary provider failure never deletes a row; only an explicit
--     Disconnect (or account deletion, via cascade) removes it.

create table if not exists public.integration_settings (
  provider            text primary key check (provider ~ '^[a-z][a-z0-9-]{1,40}$'),
  enabled             boolean not null default false,
  base_url            text check (base_url is null or char_length(base_url) <= 300),
  config              jsonb not null default '{}'::jsonb,
  secret_ciphertext   text,
  secret_last4        text check (secret_last4 is null or char_length(secret_last4) <= 4),
  last_check_at       timestamptz,
  last_check_ok       boolean,
  last_check_message  text,
  updated_by          uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null default now()
);

create table if not exists public.user_connections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  provider              text not null check (provider ~ '^[a-z][a-z0-9-]{1,40}$'),
  status                text not null default 'connected' check (status in ('connected', 'reauth_required', 'revoked')),
  account_ref           text check (account_ref is null or char_length(account_ref) <= 120),
  account_label         text check (account_label is null or char_length(account_label) <= 160),
  account_email         text check (account_email is null or char_length(account_email) <= 254),
  credential_ciphertext text,
  metadata              jsonb not null default '{}'::jsonb,
  last_synced_at        timestamptz,
  last_error            text,
  last_error_at         timestamptz,
  connected_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint user_connections_user_provider_key unique (user_id, provider)
);
create index if not exists user_connections_provider_status_idx on public.user_connections(provider, status);

alter table public.integration_settings enable row level security;
alter table public.user_connections enable row level security;
revoke all on public.integration_settings from public, anon, authenticated;
revoke all on public.user_connections from public, anon, authenticated;
grant all on public.integration_settings to service_role;
grant all on public.user_connections to service_role;

notify pgrst, 'reload schema';
