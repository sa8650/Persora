-- Persora workspace preferences: per-member settings for the workspace shell.
--
-- Today this stores the app launcher favorites, so the drawer shows the same
-- favorites on every device. Additive only: one new table, nothing existing
-- changes. Needs only public.profiles. Safe to re-run.
--
-- launcher_favorites: null = the member hasn't customized favorites (the app
-- shows its defaults); otherwise an ordered JSON array of launcher module ids.
-- The Pages API (cloudflare/workspace-preferences.js) validates the ids against
-- cloudflare/workspace-modules.js; the checks below are the backstop.

create table if not exists public.workspace_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  launcher_favorites jsonb,
  updated_at timestamptz not null default now(),
  constraint workspace_preferences_launcher_favorites_shape check (
    launcher_favorites is null
    or (jsonb_typeof(launcher_favorites) = 'array'
        and jsonb_array_length(launcher_favorites) <= 24
        and pg_column_size(launcher_favorites) <= 2048)
  )
);

-- Only the Pages API (service role) reads or writes preferences, always scoped
-- to the signed-in member.
alter table public.workspace_preferences enable row level security;
revoke all on public.workspace_preferences from public, anon, authenticated;
grant all on public.workspace_preferences to service_role;
