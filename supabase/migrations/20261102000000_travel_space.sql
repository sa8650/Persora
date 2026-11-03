-- ============================================================================
-- Persora TravelSpace (Personal & Group Travel & Trip Management Module)
-- Covers Trips, Destinations, Travellers & Roles, Budgets & Contributions,
-- Unified Tasks/Itinerary Items, Bookings, Multi-Currency Expenses & Splits,
-- Settlements, Travel Documents, Memories & Travel Journal, and Explore Wishlist.
-- All RLS policies strictly use public.persora_jwt_uid() and never raw auth.uid().
-- ============================================================================

-- 1. Extend global Trash kind constraint to support 'travel_trip'
alter table public.trash_items
  drop constraint if exists trash_items_kind_check;

alter table public.trash_items
  add constraint trash_items_kind_check
  check (
    kind = any (
      array[
        'vault_item'::text,
        'contact'::text,
        'business_card'::text,
        'medical_record'::text,
        'timeline_event'::text,
        'photo_studio_photo'::text,
        'pdf_studio_document'::text,
        'persora_table'::text,
        'persora_doc'::text,
        'audio_space_item'::text,
        'travel_trip'::text
      ]
    )
  );

-- 2. Core Trips table
create table if not exists public.travel_trips (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  description text not null default ''::text,
  start_date date not null,
  end_date date not null,
  companion_type text not null default 'solo'::text,
  traveler_count integer not null default 1,
  trip_type text,
  status text not null default 'planning'::text,
  primary_currency text not null default 'BDT'::text,
  budget_scope text not null default 'personal'::text,
  personal_budget numeric(14, 2) not null default 0,
  cover_file_key text,
  cover_file_name text,
  cover_file_size bigint,
  cover_file_type text,
  actual_return_date date,
  rating smallint,
  completion_notes text not null default ''::text,
  summary_snapshot jsonb,
  timeline_event_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trips_pkey primary key (id),
  constraint travel_trips_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade,
  constraint travel_trips_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 140),
  constraint travel_trips_description_check check (char_length(description) <= 2000),
  constraint travel_trips_dates_check check (end_date >= start_date),
  constraint travel_trips_companion_check check (companion_type = any (array['solo'::text, 'couple'::text, 'family'::text, 'friends'::text, 'group'::text])),
  constraint travel_trips_traveler_count_check check (traveler_count >= 1 and traveler_count <= 200),
  constraint travel_trips_type_check check (trip_type is null or trip_type = any (array['vacation'::text, 'business'::text, 'family-tour'::text, 'educational'::text, 'adventure'::text, 'religious'::text, 'other'::text])),
  constraint travel_trips_status_check check (status = any (array['planning'::text, 'upcoming'::text, 'ongoing'::text, 'completed'::text, 'cancelled'::text])),
  constraint travel_trips_currency_check check (char_length(primary_currency) = 3),
  constraint travel_trips_budget_scope_check check (budget_scope = any (array['none'::text, 'personal'::text, 'group'::text])),
  constraint travel_trips_personal_budget_check check (personal_budget >= 0),
  constraint travel_trips_rating_check check (rating is null or (rating >= 1 and rating <= 5))
);

create index if not exists travel_trips_owner_start_idx
  on public.travel_trips using btree (owner_id, start_date asc, created_at desc);

create index if not exists travel_trips_owner_status_idx
  on public.travel_trips using btree (owner_id, status);

-- 3. Trip Travellers (Owner, Persora Members, Linked Contacts, or Temporary Travellers)
create table if not exists public.travel_trip_travellers (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  user_id uuid,
  contact_id uuid,
  family_item_id uuid,
  full_name text not null,
  email text not null default ''::text,
  phone text not null default ''::text,
  role text not null default 'viewer'::text,
  is_owner boolean not null default false,
  responsibility text not null default ''::text,
  emergency_contact_name text not null default ''::text,
  emergency_contact_phone text not null default ''::text,
  invite_status text not null default 'active'::text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_travellers_pkey primary key (id),
  constraint travel_trip_travellers_trip_id_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_travellers_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null,
  constraint travel_trip_travellers_contact_id_fkey foreign key (contact_id) references public.contacts(id) on delete set null,
  constraint travel_trip_travellers_family_item_fkey foreign key (family_item_id) references public.vault_items(id) on delete set null,
  constraint travel_trip_travellers_name_check check (char_length(btrim(full_name)) >= 1 and char_length(btrim(full_name)) <= 120),
  constraint travel_trip_travellers_role_check check (role = any (array['owner'::text, 'editor'::text, 'expense_contributor'::text, 'viewer'::text])),
  constraint travel_trip_travellers_invite_check check (invite_status = any (array['active'::text, 'invited'::text]))
);

create index if not exists travel_trip_travellers_trip_idx
  on public.travel_trip_travellers using btree (trip_id, sort_order asc, created_at asc);

create index if not exists travel_trip_travellers_user_idx
  on public.travel_trip_travellers using btree (user_id)
  where user_id is not null;

-- Helper function for RLS role checks using public.persora_jwt_uid()
create or replace function public.persora_travel_trip_role(p_trip_id uuid, p_uid uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_uid is null then null
    when exists (select 1 from public.travel_trips t where t.id = p_trip_id and t.owner_id = p_uid) then 'owner'::text
    else (
      select tr.role
      from public.travel_trip_travellers tr
      where tr.trip_id = p_trip_id and tr.user_id = p_uid
      order by case tr.role
        when 'owner' then 1
        when 'editor' then 2
        when 'expense_contributor' then 3
        else 4
      end
      limit 1
    )
  end;
$$;
revoke all on function public.persora_travel_trip_role(uuid, uuid) from public, anon;
grant execute on function public.persora_travel_trip_role(uuid, uuid) to authenticated, service_role;

-- 4. Trip Destinations (Multiple ordered destinations per trip)
create table if not exists public.travel_trip_destinations (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  name text not null,
  country text not null default ''::text,
  city text not null default ''::text,
  place_type text not null default 'place'::text,
  latitude double precision,
  longitude double precision,
  notes text not null default ''::text,
  is_favorite boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint travel_trip_destinations_pkey primary key (id),
  constraint travel_trip_destinations_trip_id_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_destinations_name_check check (char_length(btrim(name)) >= 1 and char_length(btrim(name)) <= 120),
  constraint travel_trip_destinations_place_type_check check (place_type = any (array['country'::text, 'city'::text, 'place'::text]))
);

create index if not exists travel_trip_destinations_trip_idx
  on public.travel_trip_destinations using btree (trip_id, sort_order asc);

-- 5. Trip Budget Categories
create table if not exists public.travel_trip_budget_categories (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  name text not null,
  allocated_amount numeric(14, 2) not null default 0,
  color text not null default 'blue'::text,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_budget_categories_pkey primary key (id),
  constraint travel_trip_budget_categories_trip_id_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_budget_categories_name_check check (char_length(btrim(name)) >= 1 and char_length(btrim(name)) <= 60),
  constraint travel_trip_budget_categories_alloc_check check (allocated_amount >= 0)
);

create index if not exists travel_trip_budget_categories_trip_idx
  on public.travel_trip_budget_categories using btree (trip_id, sort_order asc);

-- 6. Trip Group Contributions (Distinct from expense splitting)
create table if not exists public.travel_trip_contributions (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  traveller_id uuid not null,
  planned_amount numeric(14, 2) not null default 0,
  contributed_amount numeric(14, 2) not null default 0,
  status text not null default 'pending'::text,
  contributed_on date,
  note text not null default ''::text,
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_contributions_pkey primary key (id),
  constraint travel_trip_contributions_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_contributions_traveller_fkey foreign key (traveller_id) references public.travel_trip_travellers(id) on delete cascade,
  constraint travel_trip_contributions_unique unique (trip_id, traveller_id),
  constraint travel_trip_contributions_amounts_check check (planned_amount >= 0 and contributed_amount >= 0),
  constraint travel_trip_contributions_status_check check (status = any (array['pending'::text, 'partial'::text, 'paid'::text]))
);

create index if not exists travel_trip_contributions_trip_idx
  on public.travel_trip_contributions using btree (trip_id);

-- 7. Trip Bookings (Flights, Hotels, Trains, Buses, Car Rentals, Activities, Others)
create table if not exists public.travel_trip_bookings (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  category text not null default 'other'::text,
  title text not null,
  provider text not null default ''::text,
  booking_reference text not null default ''::text,
  booking_date date,
  start_date date,
  end_date date,
  start_at_text text not null default ''::text,
  end_at_text text not null default ''::text,
  location text not null default ''::text,
  price numeric(14, 2),
  currency text not null default 'BDT'::text,
  payment_status text not null default 'unpaid'::text,
  booking_status text not null default 'confirmed'::text,
  traveller_ids uuid[] not null default '{}'::uuid[],
  membership_item_id uuid,
  contact_details text not null default ''::text,
  notes text not null default ''::text,
  refund_amount numeric(14, 2),
  cancellation_note text not null default ''::text,
  attachment_file_key text,
  attachment_file_name text,
  attachment_file_size bigint,
  attachment_file_type text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_bookings_pkey primary key (id),
  constraint travel_trip_bookings_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_bookings_membership_fkey foreign key (membership_item_id) references public.vault_items(id) on delete set null,
  constraint travel_trip_bookings_category_check check (category = any (array['flight'::text, 'bus'::text, 'train'::text, 'hotel'::text, 'car_rental'::text, 'activity'::text, 'other'::text])),
  constraint travel_trip_bookings_payment_check check (payment_status = any (array['unpaid'::text, 'partial'::text, 'paid'::text, 'refunded'::text])),
  constraint travel_trip_bookings_status_check check (booking_status = any (array['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text])),
  constraint travel_trip_bookings_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160)
);

create index if not exists travel_trip_bookings_trip_idx
  on public.travel_trip_bookings using btree (trip_id, start_date asc nulls last, created_at asc);

-- 8. Unified Trip Tasks & Itinerary Activities (SINGLE central record; NO duplication)
-- scheduled_date IS NULL     -> Unscheduled Task (Tasks Kanban)
-- scheduled_date IS NOT NULL -> Scheduled Itinerary Activity (Itinerary + Tasks Kanban)
create table if not exists public.travel_trip_items (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  title text not null,
  description text not null default ''::text,
  status text not null default 'todo'::text,
  priority text not null default 'normal'::text,
  due_date date,
  scheduled_date date,
  start_time text,
  end_time text,
  location text not null default ''::text,
  latitude double precision,
  longitude double precision,
  day_sort_order integer not null default 0,
  kanban_sort_order integer not null default 0,
  assignee_traveller_id uuid,
  booking_id uuid,
  estimated_cost numeric(14, 2),
  notes text not null default ''::text,
  attachment_file_key text,
  attachment_file_name text,
  attachment_file_size bigint,
  attachment_file_type text,
  linked_vault_note_id uuid,
  synced_calendar_event_id uuid,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_items_pkey primary key (id),
  constraint travel_trip_items_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_items_assignee_fkey foreign key (assignee_traveller_id) references public.travel_trip_travellers(id) on delete set null,
  constraint travel_trip_items_booking_fkey foreign key (booking_id) references public.travel_trip_bookings(id) on delete set null,
  constraint travel_trip_items_vault_note_fkey foreign key (linked_vault_note_id) references public.vault_items(id) on delete set null,
  constraint travel_trip_items_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 180),
  constraint travel_trip_items_status_check check (status = any (array['todo'::text, 'in_progress'::text, 'done'::text, 'skipped'::text])),
  constraint travel_trip_items_priority_check check (priority = any (array['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
  constraint travel_trip_items_cost_check check (estimated_cost is null or estimated_cost >= 0)
);

create index if not exists travel_trip_items_trip_schedule_idx
  on public.travel_trip_items using btree (trip_id, scheduled_date asc nulls last, day_sort_order asc);

create index if not exists travel_trip_items_trip_kanban_idx
  on public.travel_trip_items using btree (trip_id, status, kanban_sort_order asc);

-- 9. Trip Expenses (Personal & Shared, Multi-Currency with Preserved Original Values)
create table if not exists public.travel_trip_expenses (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  title text not null,
  amount numeric(14, 2) not null,
  currency text not null,
  trip_amount numeric(14, 2) not null,
  exchange_rate numeric(18, 6) not null default 1,
  converted_on date not null,
  expense_date date not null,
  category_id uuid,
  category_name text not null default 'Others'::text,
  expense_type text not null default 'personal'::text,
  paid_by_traveller_id uuid not null,
  paid_from_group_fund boolean not null default false,
  split_method text not null default 'none'::text,
  payment_method text not null default ''::text,
  linked_finance_item_id uuid,
  receipt_file_key text,
  receipt_file_name text,
  receipt_file_size bigint,
  receipt_file_type text,
  notes text not null default ''::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_expenses_pkey primary key (id),
  constraint travel_trip_expenses_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_expenses_category_fkey foreign key (category_id) references public.travel_trip_budget_categories(id) on delete set null,
  constraint travel_trip_expenses_paid_by_fkey foreign key (paid_by_traveller_id) references public.travel_trip_travellers(id) on delete restrict,
  constraint travel_trip_expenses_finance_fkey foreign key (linked_finance_item_id) references public.vault_items(id) on delete set null,
  constraint travel_trip_expenses_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160),
  constraint travel_trip_expenses_amount_check check (amount > 0 and trip_amount > 0 and exchange_rate > 0),
  constraint travel_trip_expenses_type_check check (expense_type = any (array['personal'::text, 'shared'::text])),
  constraint travel_trip_expenses_split_check check (split_method = any (array['none'::text, 'equal'::text, 'custom'::text]))
);

create index if not exists travel_trip_expenses_trip_date_idx
  on public.travel_trip_expenses using btree (trip_id, expense_date desc, created_at desc);

-- 10. Trip Expense Splits
create table if not exists public.travel_trip_expense_splits (
  id uuid not null default gen_random_uuid(),
  expense_id uuid not null,
  trip_id uuid not null,
  traveller_id uuid not null,
  share_amount numeric(14, 2) not null,
  trip_share_amount numeric(14, 2) not null,
  constraint travel_trip_expense_splits_pkey primary key (id),
  constraint travel_trip_expense_splits_expense_fkey foreign key (expense_id) references public.travel_trip_expenses(id) on delete cascade,
  constraint travel_trip_expense_splits_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_expense_splits_traveller_fkey foreign key (traveller_id) references public.travel_trip_travellers(id) on delete cascade,
  constraint travel_trip_expense_splits_unique unique (expense_id, traveller_id),
  constraint travel_trip_expense_splits_amount_check check (share_amount >= 0 and trip_share_amount >= 0)
);

create index if not exists travel_trip_expense_splits_trip_idx
  on public.travel_trip_expense_splits using btree (trip_id, expense_id);

-- 11. Trip Settlements
create table if not exists public.travel_trip_settlements (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  from_traveller_id uuid not null,
  to_traveller_id uuid not null,
  amount numeric(14, 2) not null,
  currency text not null default 'BDT'::text,
  status text not null default 'completed'::text,
  settled_on date not null,
  method text not null default ''::text,
  note text not null default ''::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_settlements_pkey primary key (id),
  constraint travel_trip_settlements_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_settlements_from_fkey foreign key (from_traveller_id) references public.travel_trip_travellers(id) on delete restrict,
  constraint travel_trip_settlements_to_fkey foreign key (to_traveller_id) references public.travel_trip_travellers(id) on delete restrict,
  constraint travel_trip_settlements_no_self check (from_traveller_id <> to_traveller_id),
  constraint travel_trip_settlements_amount_check check (amount > 0),
  constraint travel_trip_settlements_status_check check (status = any (array['pending'::text, 'completed'::text]))
);

create index if not exists travel_trip_settlements_trip_idx
  on public.travel_trip_settlements using btree (trip_id, settled_on desc);

-- 12. Trip Documents (Uploads OR Non-Duplicating Links to Persora Vault Documents)
create table if not exists public.travel_trip_documents (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  title text not null,
  doc_category text not null default 'other'::text,
  source_type text not null default 'upload'::text,
  linked_vault_item_id uuid,
  file_key text,
  file_name text,
  file_size bigint,
  file_type text,
  traveller_id uuid,
  booking_id uuid,
  activity_id uuid,
  document_number text not null default ''::text,
  expiry_date date,
  reminder_days_before integer,
  is_private boolean not null default false,
  notes text not null default ''::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_documents_pkey primary key (id),
  constraint travel_trip_documents_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_documents_vault_fkey foreign key (linked_vault_item_id) references public.vault_items(id) on delete set null,
  constraint travel_trip_documents_traveller_fkey foreign key (traveller_id) references public.travel_trip_travellers(id) on delete set null,
  constraint travel_trip_documents_booking_fkey foreign key (booking_id) references public.travel_trip_bookings(id) on delete set null,
  constraint travel_trip_documents_activity_fkey foreign key (activity_id) references public.travel_trip_items(id) on delete set null,
  constraint travel_trip_documents_category_check check (doc_category = any (array['passport'::text, 'visa'::text, 'national_id'::text, 'driving_licence'::text, 'insurance'::text, 'ticket'::text, 'hotel_confirmation'::text, 'permit'::text, 'other'::text])),
  constraint travel_trip_documents_source_check check (source_type = any (array['upload'::text, 'vault_item'::text])),
  constraint travel_trip_documents_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160)
);

create index if not exists travel_trip_documents_trip_idx
  on public.travel_trip_documents using btree (trip_id, created_at desc);

-- 13. Trip Memories & Travel Journal (Photos, AudioSpace Links, Journal Entries)
create table if not exists public.travel_trip_memories (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  memory_type text not null default 'journal'::text,
  title text not null,
  caption text not null default ''::text,
  journal_body text not null default ''::text,
  memory_date date,
  day_number integer,
  location text not null default ''::text,
  favorite boolean not null default false,
  source_type text not null default 'journal'::text,
  linked_photo_id uuid,
  linked_audio_id uuid,
  linked_vault_item_id uuid,
  file_key text,
  file_name text,
  file_size bigint,
  file_type text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_trip_memories_pkey primary key (id),
  constraint travel_trip_memories_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete cascade,
  constraint travel_trip_memories_photo_fkey foreign key (linked_photo_id) references public.photo_studio_photos(id) on delete set null,
  constraint travel_trip_memories_audio_fkey foreign key (linked_audio_id) references public.audio_space_items(id) on delete set null,
  constraint travel_trip_memories_vault_fkey foreign key (linked_vault_item_id) references public.vault_items(id) on delete set null,
  constraint travel_trip_memories_type_check check (memory_type = any (array['photo'::text, 'audio'::text, 'journal'::text])),
  constraint travel_trip_memories_source_check check (source_type = any (array['upload'::text, 'photo_studio'::text, 'audio_space'::text, 'vault_item'::text, 'journal'::text])),
  constraint travel_trip_memories_title_check check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 160)
);

create index if not exists travel_trip_memories_trip_idx
  on public.travel_trip_memories using btree (trip_id, memory_date asc nulls last, created_at asc);

-- 14. Explore & Saved Destinations Wishlist
create table if not exists public.travel_explore_places (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  kind text not null default 'destination'::text,
  country text not null default ''::text,
  city text not null default ''::text,
  status text not null default 'want_to_visit'::text,
  trip_id uuid,
  estimated_cost numeric(14, 2),
  currency text not null default 'BDT'::text,
  reference_url text not null default ''::text,
  linked_url_item_id uuid,
  latitude double precision,
  longitude double precision,
  notes text not null default ''::text,
  favorite boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint travel_explore_places_pkey primary key (id),
  constraint travel_explore_places_user_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint travel_explore_places_trip_fkey foreign key (trip_id) references public.travel_trips(id) on delete set null,
  constraint travel_explore_places_url_fkey foreign key (linked_url_item_id) references public.vault_items(id) on delete set null,
  constraint travel_explore_places_name_check check (char_length(btrim(name)) >= 1 and char_length(btrim(name)) <= 140),
  constraint travel_explore_places_kind_check check (kind = any (array['destination'::text, 'attraction'::text, 'restaurant'::text, 'stay'::text, 'place'::text])),
  constraint travel_explore_places_status_check check (status = any (array['want_to_visit'::text, 'planned'::text, 'visited'::text]))
);

create index if not exists travel_explore_places_user_idx
  on public.travel_explore_places using btree (user_id, created_at desc);

-- ============================================================================
-- 15. Row Level Security (Strictly public.persora_jwt_uid()) & Role Grants
-- ============================================================================

alter table public.travel_trips enable row level security;
drop policy if exists travel_trips_select_policy on public.travel_trips;
create policy travel_trips_select_policy on public.travel_trips
  for select to authenticated
  using (public.persora_travel_trip_role(id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trips_write_policy on public.travel_trips;
create policy travel_trips_write_policy on public.travel_trips
  for all to authenticated
  using (owner_id = public.persora_jwt_uid())
  with check (owner_id = public.persora_jwt_uid());
revoke all on public.travel_trips from public, anon, authenticated;
grant all on public.travel_trips to service_role;

alter table public.travel_trip_travellers enable row level security;
drop policy if exists travel_trip_travellers_select_policy on public.travel_trip_travellers;
create policy travel_trip_travellers_select_policy on public.travel_trip_travellers
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_travellers_write_policy on public.travel_trip_travellers;
create policy travel_trip_travellers_write_policy on public.travel_trip_travellers
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_travellers from public, anon, authenticated;
grant all on public.travel_trip_travellers to service_role;

alter table public.travel_trip_destinations enable row level security;
drop policy if exists travel_trip_destinations_policy on public.travel_trip_destinations;
create policy travel_trip_destinations_policy on public.travel_trip_destinations
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_destinations_write_policy on public.travel_trip_destinations;
create policy travel_trip_destinations_write_policy on public.travel_trip_destinations
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_destinations from public, anon, authenticated;
grant all on public.travel_trip_destinations to service_role;

alter table public.travel_trip_budget_categories enable row level security;
drop policy if exists travel_trip_budget_categories_select_policy on public.travel_trip_budget_categories;
create policy travel_trip_budget_categories_select_policy on public.travel_trip_budget_categories
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_budget_categories_write_policy on public.travel_trip_budget_categories;
create policy travel_trip_budget_categories_write_policy on public.travel_trip_budget_categories
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_budget_categories from public, anon, authenticated;
grant all on public.travel_trip_budget_categories to service_role;

alter table public.travel_trip_contributions enable row level security;
drop policy if exists travel_trip_contributions_select_policy on public.travel_trip_contributions;
create policy travel_trip_contributions_select_policy on public.travel_trip_contributions
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_contributions_write_policy on public.travel_trip_contributions;
create policy travel_trip_contributions_write_policy on public.travel_trip_contributions
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_contributions from public, anon, authenticated;
grant all on public.travel_trip_contributions to service_role;

alter table public.travel_trip_bookings enable row level security;
drop policy if exists travel_trip_bookings_select_policy on public.travel_trip_bookings;
create policy travel_trip_bookings_select_policy on public.travel_trip_bookings
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_bookings_write_policy on public.travel_trip_bookings;
create policy travel_trip_bookings_write_policy on public.travel_trip_bookings
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_bookings from public, anon, authenticated;
grant all on public.travel_trip_bookings to service_role;

alter table public.travel_trip_items enable row level security;
drop policy if exists travel_trip_items_select_policy on public.travel_trip_items;
create policy travel_trip_items_select_policy on public.travel_trip_items
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_items_write_policy on public.travel_trip_items;
create policy travel_trip_items_write_policy on public.travel_trip_items
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_items from public, anon, authenticated;
grant all on public.travel_trip_items to service_role;

alter table public.travel_trip_expenses enable row level security;
drop policy if exists travel_trip_expenses_select_policy on public.travel_trip_expenses;
create policy travel_trip_expenses_select_policy on public.travel_trip_expenses
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_expenses_write_policy on public.travel_trip_expenses;
create policy travel_trip_expenses_write_policy on public.travel_trip_expenses
  for all to authenticated
  using (
    public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text])
    or (
      public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = 'expense_contributor'::text
      and created_by = public.persora_jwt_uid()
    )
  )
  with check (
    public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text, 'expense_contributor'::text])
  );
revoke all on public.travel_trip_expenses from public, anon, authenticated;
grant all on public.travel_trip_expenses to service_role;

alter table public.travel_trip_expense_splits enable row level security;
drop policy if exists travel_trip_expense_splits_select_policy on public.travel_trip_expense_splits;
create policy travel_trip_expense_splits_select_policy on public.travel_trip_expense_splits
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_expense_splits_write_policy on public.travel_trip_expense_splits;
create policy travel_trip_expense_splits_write_policy on public.travel_trip_expense_splits
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text, 'expense_contributor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text, 'expense_contributor'::text]));
revoke all on public.travel_trip_expense_splits from public, anon, authenticated;
grant all on public.travel_trip_expense_splits to service_role;

alter table public.travel_trip_settlements enable row level security;
drop policy if exists travel_trip_settlements_select_policy on public.travel_trip_settlements;
create policy travel_trip_settlements_select_policy on public.travel_trip_settlements
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_settlements_write_policy on public.travel_trip_settlements;
create policy travel_trip_settlements_write_policy on public.travel_trip_settlements
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_settlements from public, anon, authenticated;
grant all on public.travel_trip_settlements to service_role;

alter table public.travel_trip_documents enable row level security;
drop policy if exists travel_trip_documents_select_policy on public.travel_trip_documents;
create policy travel_trip_documents_select_policy on public.travel_trip_documents
  for select to authenticated
  using (
    public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null
    and (
      not is_private
      or created_by = public.persora_jwt_uid()
      or public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = 'owner'::text
    )
  );
drop policy if exists travel_trip_documents_write_policy on public.travel_trip_documents;
create policy travel_trip_documents_write_policy on public.travel_trip_documents
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_documents from public, anon, authenticated;
grant all on public.travel_trip_documents to service_role;

alter table public.travel_trip_memories enable row level security;
drop policy if exists travel_trip_memories_select_policy on public.travel_trip_memories;
create policy travel_trip_memories_select_policy on public.travel_trip_memories
  for select to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) is not null);
drop policy if exists travel_trip_memories_write_policy on public.travel_trip_memories;
create policy travel_trip_memories_write_policy on public.travel_trip_memories
  for all to authenticated
  using (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]))
  with check (public.persora_travel_trip_role(trip_id, public.persora_jwt_uid()) = any (array['owner'::text, 'editor'::text]));
revoke all on public.travel_trip_memories from public, anon, authenticated;
grant all on public.travel_trip_memories to service_role;

alter table public.travel_explore_places enable row level security;
drop policy if exists travel_explore_places_owner_policy on public.travel_explore_places;
create policy travel_explore_places_owner_policy on public.travel_explore_places
  for all to authenticated
  using (user_id = public.persora_jwt_uid())
  with check (user_id = public.persora_jwt_uid());
revoke all on public.travel_explore_places from public, anon, authenticated;
grant all on public.travel_explore_places to service_role;

-- ============================================================================
-- 16. Global 7-Day Trash Move / Restore & Account Backup Export RPCs
-- ============================================================================

create or replace function public.persora_travel_trip_trash_move(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trip jsonb;
  v_destinations jsonb;
  v_travellers jsonb;
  v_categories jsonb;
  v_contributions jsonb;
  v_bookings jsonb;
  v_items jsonb;
  v_expenses jsonb;
  v_splits jsonb;
  v_settlements jsonb;
  v_documents jsonb;
  v_memories jsonb;
  v_keys jsonb;
  v_now timestamptz := clock_timestamp();
  v_trash public.trash_items%rowtype;
begin
  select to_jsonb(t) into v_trip
  from public.travel_trips t
  where t.id = p_id and t.owner_id = p_owner
  for update;

  if v_trip is null then
    raise exception 'Only the trip owner can move this trip to Trash.' using errcode = 'P0404';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order asc), '[]'::jsonb) into v_destinations from public.travel_trip_destinations r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order asc), '[]'::jsonb) into v_travellers from public.travel_trip_travellers r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order asc), '[]'::jsonb) into v_categories from public.travel_trip_budget_categories r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_contributions from public.travel_trip_contributions r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_bookings from public.travel_trip_bookings r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_items from public.travel_trip_items r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_expenses from public.travel_trip_expenses r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_splits from public.travel_trip_expense_splits r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_settlements from public.travel_trip_settlements r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_documents from public.travel_trip_documents r where r.trip_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc), '[]'::jsonb) into v_memories from public.travel_trip_memories r where r.trip_id = p_id;

  select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
  into v_keys
  from (
    select v_trip ->> 'cover_file_key' as k
    union all
    select attachment_file_key from public.travel_trip_bookings where trip_id = p_id
    union all
    select attachment_file_key from public.travel_trip_items where trip_id = p_id
    union all
    select receipt_file_key from public.travel_trip_expenses where trip_id = p_id
    union all
    select file_key from public.travel_trip_documents where trip_id = p_id and source_type = 'upload'
    union all
    select file_key from public.travel_trip_memories where trip_id = p_id and source_type = 'upload'
  ) raw_keys
  where k is not null and left(k, char_length(p_owner::text) + 1) = p_owner::text || '/';

  delete from public.travel_trips where id = p_id and owner_id = p_owner;

  insert into public.trash_items (id, owner_id, kind, title, context, payload, file_keys, status, deleted_at, expires_at)
  values (
    p_id,
    p_owner,
    'travel_trip',
    coalesce(nullif(v_trip ->> 'title', ''), 'Untitled trip'),
    jsonb_build_object('space', 'travel_space', 'recordType', 'trip', 'status', v_trip ->> 'status'),
    jsonb_build_object(
      'row', v_trip,
      'relations', jsonb_build_object(
        'destinations', v_destinations,
        'travellers', v_travellers,
        'categories', v_categories,
        'contributions', v_contributions,
        'bookings', v_bookings,
        'items', v_items,
        'expenses', v_expenses,
        'splits', v_splits,
        'settlements', v_settlements,
        'documents', v_documents,
        'memories', v_memories
      )
    ),
    v_keys,
    'active',
    v_now,
    v_now + interval '7 days'
  )
  returning * into v_trash;

  return to_jsonb(v_trash);
end;
$function$;
revoke all on function public.persora_travel_trip_trash_move(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_travel_trip_trash_move(uuid, uuid) to service_role;

create or replace function public.persora_travel_trip_trash_restore(p_owner uuid, p_trash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trash public.trash_items%rowtype;
  v_row jsonb;
  v_rel jsonb;
begin
  update public.trash_items
  set status = 'restoring', updated_at = clock_timestamp()
  where id = p_trash_id
    and owner_id = p_owner
    and kind = 'travel_trip'
    and status = 'active'
    and expires_at > clock_timestamp()
  returning * into v_trash;

  if not found then
    raise exception 'That trip is no longer restorable — it expired or is already being processed.' using errcode = 'P0409';
  end if;

  v_row := coalesce(v_trash.payload -> 'row', '{}'::jsonb);
  v_rel := coalesce(v_trash.payload -> 'relations', '{}'::jsonb);

  insert into public.travel_trips select * from jsonb_populate_record(null::public.travel_trips, v_row);
  insert into public.travel_trip_destinations select * from jsonb_populate_recordset(null::public.travel_trip_destinations, coalesce(v_rel -> 'destinations', '[]'::jsonb));
  insert into public.travel_trip_travellers select * from jsonb_populate_recordset(null::public.travel_trip_travellers, coalesce(v_rel -> 'travellers', '[]'::jsonb));
  insert into public.travel_trip_budget_categories select * from jsonb_populate_recordset(null::public.travel_trip_budget_categories, coalesce(v_rel -> 'categories', '[]'::jsonb));
  insert into public.travel_trip_contributions select * from jsonb_populate_recordset(null::public.travel_trip_contributions, coalesce(v_rel -> 'contributions', '[]'::jsonb));
  insert into public.travel_trip_bookings select * from jsonb_populate_recordset(null::public.travel_trip_bookings, coalesce(v_rel -> 'bookings', '[]'::jsonb));
  insert into public.travel_trip_items select * from jsonb_populate_recordset(null::public.travel_trip_items, coalesce(v_rel -> 'items', '[]'::jsonb));
  insert into public.travel_trip_expenses select * from jsonb_populate_recordset(null::public.travel_trip_expenses, coalesce(v_rel -> 'expenses', '[]'::jsonb));
  insert into public.travel_trip_expense_splits select * from jsonb_populate_recordset(null::public.travel_trip_expense_splits, coalesce(v_rel -> 'splits', '[]'::jsonb));
  insert into public.travel_trip_settlements select * from jsonb_populate_recordset(null::public.travel_trip_settlements, coalesce(v_rel -> 'settlements', '[]'::jsonb));
  insert into public.travel_trip_documents select * from jsonb_populate_recordset(null::public.travel_trip_documents, coalesce(v_rel -> 'documents', '[]'::jsonb));
  insert into public.travel_trip_memories select * from jsonb_populate_recordset(null::public.travel_trip_memories, coalesce(v_rel -> 'memories', '[]'::jsonb));

  delete from public.trash_items where id = v_trash.id;
  return jsonb_build_object('ok', true, 'kind', v_trash.kind, 'id', v_trash.id);
end;
$function$;
revoke all on function public.persora_travel_trip_trash_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persora_travel_trip_trash_restore(uuid, uuid) to service_role;

create or replace function public.persora_travel_space_export(p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_trips jsonb;
  v_explore jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by t.start_date asc, t.created_at asc), '[]'::jsonb)
  into v_trips
  from public.travel_trips t
  where t.owner_id = p_owner;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at asc), '[]'::jsonb)
  into v_explore
  from public.travel_explore_places e
  where e.user_id = p_owner;

  return jsonb_build_object(
    'trips', v_trips,
    'explorePlaces', v_explore
  );
end;
$function$;
revoke all on function public.persora_travel_space_export(uuid) from public, anon, authenticated;
grant execute on function public.persora_travel_space_export(uuid) to service_role;
