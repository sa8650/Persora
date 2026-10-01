-- Allow Notes records in existing Persora vaults.
-- Safe to run once on an existing Supabase project.
alter table public.vault_items drop constraint if exists vault_items_section_check;
alter table public.vault_items add constraint vault_items_section_check check (section in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases',
  'accounts', 'memberships', 'study', 'business-card', 'urls', 'notes'
));
alter table public.vault_items add column if not exists pinned boolean not null default false;
