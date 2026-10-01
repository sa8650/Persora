-- Private, owner-scoped medical records and references to existing Persora records.
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  record_type text not null check (record_type in ('Prescription','Medical Report','Lab Test','Imaging / Scan','Doctor Visit','Hospital Record','Vaccination','Medical Certificate','Discharge Summary','Other')),
  record_date date not null,
  provider text not null default '',
  hospital text not null default '',
  specialty text not null default '',
  notes text not null default '',
  diagnosis text not null default '',
  test_name text not null default '',
  test_result text not null default '',
  medication_notes text not null default '',
  follow_up_date date,
  related_reminder_id uuid references public.vault_items(id) on delete set null,
  file_key text,
  file_name text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medical_records_file_reference_complete check (
    (file_key is null and file_name is null and file_size is null and file_type is null) or
    (file_key is not null and file_name is not null and file_size is not null and file_type is not null)
  ),
  constraint medical_records_id_owner_unique unique (id, user_id)
);
create index if not exists medical_records_owner_date_idx on public.medical_records(user_id, record_date desc, updated_at desc);
create index if not exists medical_records_owner_type_idx on public.medical_records(user_id, record_type, record_date desc);

create table if not exists public.medical_record_links (
  medical_record_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  record_type text not null check (record_type in ('contact','vault_item')),
  record_id uuid not null,
  link_kind text not null default 'related' check (link_kind in ('related','reminder')),
  created_at timestamptz not null default now(),
  primary key (medical_record_id, record_type, record_id, link_kind),
  constraint medical_record_links_owner_record_fk foreign key (medical_record_id, owner_id) references public.medical_records(id, user_id) on delete cascade
);
create index if not exists medical_record_links_target_idx on public.medical_record_links(owner_id, record_type, record_id);
alter table public.medical_records enable row level security;
alter table public.medical_record_links enable row level security;
revoke all on public.medical_records, public.medical_record_links from anon, authenticated;
grant all on public.medical_records, public.medical_record_links to service_role;
