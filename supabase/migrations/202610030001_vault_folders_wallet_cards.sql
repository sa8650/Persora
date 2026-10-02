-- Page-scoped folders for personal records, plus masked Wallet Cards storage.
create table if not exists public.vault_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (scope in (
    'documents', 'academics', 'subscriptions', 'family', 'purchases', 'accounts',
    'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes',
    'contacts', 'business-cards', 'medical-records'
  )),
  name text not null check (char_length(name) between 1 and 64),
  color text not null default 'blue' check (color in ('blue','sky','teal','violet','amber','rose','slate','mint')),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vault_folders_owner_scope_name_idx on public.vault_folders(user_id, scope, lower(name));
create index if not exists vault_folders_owner_scope_pinned_idx on public.vault_folders(user_id, scope, pinned desc, name);

alter table public.vault_items add column if not exists folder_id uuid references public.vault_folders(id) on delete set null;
create index if not exists vault_items_owner_folder_idx on public.vault_items(user_id, section, folder_id);

alter table public.contacts add column if not exists folder_id uuid references public.vault_folders(id) on delete set null;
create index if not exists contacts_owner_folder_idx on public.contacts(user_id, folder_id);

alter table public.business_cards add column if not exists folder_id uuid references public.vault_folders(id) on delete set null;
create index if not exists business_cards_owner_folder_idx on public.business_cards(user_id, folder_id);

alter table public.medical_records add column if not exists folder_id uuid references public.vault_folders(id) on delete set null;
create index if not exists medical_records_owner_folder_idx on public.medical_records(user_id, folder_id);

-- Include the dedicated masked-card page in the vault-items section constraint.
alter table public.vault_items drop constraint if exists vault_items_section_check;
alter table public.vault_items add constraint vault_items_section_check check (section in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases', 'accounts',
  'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes'
));

alter table public.vault_folders enable row level security;
revoke all on public.vault_folders from anon, authenticated;
grant all on public.vault_folders to service_role;
