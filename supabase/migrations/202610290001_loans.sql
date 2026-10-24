-- Persora Loan Tracker: loans, installment schedules, payment transactions and
-- installment reminders.
--
-- Same model as the calendar and Habit Tracker migrations: the tables are closed
-- to anon/authenticated (RLS on, no policies, privileges revoked) and every
-- read/write goes through the Pages API with the service role, which passes the
-- signed-in member's id as p_owner to these security-definer functions. Each
-- function scopes every statement to that owner.
--
-- Money is numeric(14,2). Schedules are calculated by cloudflare/loan-rules.js
-- (shared with the browser preview); the database enforces the invariants:
-- one row per installment number, paid_amount = the sum of recorded (not
-- reversed) payments and never more than the scheduled amount, payments are
-- never deleted (corrections reverse them), and installments that have payments
-- or are past due are never rewritten by a recalculation.
--
-- Reminders reuse the calendar's delivery pipeline: the same pg_cron tick
-- (persora_calendar_dispatch_ping, extended below to also wake for loans), the
-- same POST /internal/calendar-reminders endpoint and token, the same Brevo
-- email service and the same in-app notification bell.
--
-- Additive only: nothing existing is dropped or rewritten.

-- 1. Loans -------------------------------------------------------------------------

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  direction text not null check (direction in ('borrowed', 'lent')),
  party_name text not null check (char_length(btrim(party_name)) between 1 and 120),
  borrower_name text not null check (char_length(btrim(borrower_name)) between 1 and 120),
  currency text not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  -- Current terms (the original ones are kept in original_terms).
  principal numeric(14, 2) not null check (principal > 0 and principal <= 1000000000),
  interest_method text not null default 'none' check (interest_method in ('none', 'flat', 'reducing')),
  interest_rate numeric(7, 4) check (interest_rate is null or (interest_rate > 0 and interest_rate <= 100)),
  installment_count integer not null check (installment_count between 1 and 2000),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  start_date date not null,
  first_due_date date not null,
  -- due(n) = anchor_date + (n - anchor_number) periods (month ends clamp).
  anchor_date date not null,
  anchor_number integer not null default 1 check (anchor_number between 1 and 2000),
  reference text not null default '' check (char_length(reference) <= 80),
  notes text not null default '' check (char_length(notes) <= 2000),
  document_ids uuid[] not null default '{}' check (cardinality(document_ids) <= 20),
  reminder_days_before smallint check (reminder_days_before is null or reminder_days_before in (0, 1, 3, 7)),
  overdue_alerts boolean not null default false,
  reminder_email boolean not null default false,
  status text not null default 'active' check (status in ('active', 'completed', 'closed')),
  completed_at timestamptz,
  closed_at timestamptz,
  close_note text check (close_note is null or char_length(close_note) between 1 and 500),
  original_terms jsonb not null check (jsonb_typeof(original_terms) = 'object'),
  schedule_changes jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule_changes) = 'array'),
  schedule_version integer not null default 1 check (schedule_version >= 1),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loans_rate_matches_method check ((interest_method = 'none') = (interest_rate is null)),
  constraint loans_first_due_after_start check (first_due_date >= start_date),
  constraint loans_status_times check (
    (status = 'completed') = (completed_at is not null) and (status = 'closed') = (closed_at is not null) and (status = 'closed') = (close_note is not null)
  ),
  constraint loans_id_owner unique (id, user_id)
);
create index if not exists loans_owner_idx on public.loans(user_id, status, created_at);

-- 2. Installments ---------------------------------------------------------------------

create table if not exists public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null,
  user_id uuid not null,
  number integer not null check (number between 1 and 2000),
  due_date date not null,
  principal_amount numeric(14, 2) not null check (principal_amount >= 0),
  interest_amount numeric(14, 2) not null check (interest_amount >= 0),
  amount numeric(14, 2) not null check (amount > 0 and amount = principal_amount + interest_amount),
  -- Sum of this installment's recorded (not reversed) payments.
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  schedule_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_installments_number_unique unique (loan_id, number),
  constraint loan_installments_id_loan unique (id, loan_id),
  constraint loan_installments_loan_owner foreign key (loan_id, user_id) references public.loans(id, user_id) on delete cascade
);
create index if not exists loan_installments_due_idx on public.loan_installments(user_id, due_date) where paid_amount < amount;
create index if not exists loan_installments_loan_due_idx on public.loan_installments(loan_id, due_date);

-- 3. Payment transactions (never deleted; corrections reverse) -----------------------

create table if not exists public.loan_payments (
  -- Generated by the client: a retried submission replays instead of duplicating.
  id uuid primary key,
  loan_id uuid not null,
  installment_id uuid not null,
  user_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  method text not null default '' check (char_length(method) <= 40),
  reference text not null default '' check (char_length(reference) <= 80),
  notes text not null default '' check (char_length(notes) <= 500),
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_at timestamptz,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  corrects_payment_id uuid references public.loan_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint loan_payments_reversal check ((status = 'reversed') = (reversed_at is not null)),
  constraint loan_payments_installment foreign key (installment_id, loan_id) references public.loan_installments(id, loan_id) on delete cascade,
  constraint loan_payments_loan_owner foreign key (loan_id, user_id) references public.loans(id, user_id) on delete cascade
);
create index if not exists loan_payments_installment_idx on public.loan_payments(installment_id, created_at);
create index if not exists loan_payments_loan_idx on public.loan_payments(loan_id, paid_on);
create index if not exists loan_payments_owner_idx on public.loan_payments(user_id, paid_on);

-- 4. Reminder queue ---------------------------------------------------------------------

create table if not exists public.loan_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  loan_id uuid not null,
  installment_id uuid not null references public.loan_installments(id) on delete cascade,
  kind text not null check (kind in ('upcoming', 'overdue')),
  installment_number integer not null,
  due_date date not null,
  amount numeric(14, 2) not null,
  currency text not null,
  loan_name text not null check (char_length(loan_name) between 1 and 80),
  remind_at timestamptz not null,
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  email_requested boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'sent', 'skipped')),
  email_status text not null default 'not_requested' check (email_status in ('not_requested', 'sending', 'sent', 'failed', 'skipped')),
  email_note text check (email_note is null or char_length(email_note) <= 200),
  attempts integer not null default 0,
  claimed_at timestamptz,
  processed_at timestamptz,
  read_at timestamptz,
  -- loan:<installment id>:<upcoming|overdue> — each alert at most once.
  dedupe_key text not null unique check (char_length(dedupe_key) <= 100),
  created_at timestamptz not null default now(),
  constraint loan_reminders_loan_owner foreign key (loan_id, user_id) references public.loans(id, user_id) on delete cascade
);
create unique index if not exists loan_reminders_one_scheduled on public.loan_reminders(loan_id) where status = 'scheduled';
create index if not exists loan_reminders_due_idx on public.loan_reminders(remind_at) where status in ('scheduled', 'processing');
create index if not exists loan_reminders_owner_idx on public.loan_reminders(user_id, remind_at desc);

alter table public.loans enable row level security;
alter table public.loan_installments enable row level security;
alter table public.loan_payments enable row level security;
alter table public.loan_reminders enable row level security;
revoke all on public.loans from public, anon, authenticated;
revoke all on public.loan_installments from public, anon, authenticated;
revoke all on public.loan_payments from public, anon, authenticated;
revoke all on public.loan_reminders from public, anon, authenticated;
grant all on public.loans to service_role;
grant all on public.loan_installments to service_role;
grant all on public.loan_payments to service_role;
grant all on public.loan_reminders to service_role;

-- 5. Internal helpers (not callable through the API) ------------------------------

-- Plans the loan's next reminder: the earliest upcoming/overdue alert at 09:00
-- local time, at or after p_from, for an installment that still has money
-- due, that hasn't been used before. Replaces any planned (unsent) reminder.
create or replace function public.persora_loan_plan_reminder(p_loan uuid, p_from timestamptz)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_loan public.loans%rowtype;
  v_zone text;
begin
  delete from public.loan_reminders where loan_id = p_loan and status = 'scheduled';
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.status <> 'active' or (v_loan.reminder_days_before is null and not v_loan.overdue_alerts) then
    return;
  end if;
  select coalesce(nullif(p.timezone, ''), 'UTC') into v_zone from public.profiles p where p.id = v_loan.user_id;
  begin
    perform now() at time zone coalesce(v_zone, 'UTC');
  exception when others then
    v_zone := 'UTC';
  end;
  v_zone := coalesce(v_zone, 'UTC');
  insert into public.loan_reminders (
    user_id, loan_id, installment_id, kind, installment_number, due_date, amount, currency, loan_name, remind_at, time_zone, email_requested, dedupe_key
  )
  select v_loan.user_id, v_loan.id, c.id, c.kind, c.number, c.due_date, c.remaining, v_loan.currency, v_loan.name, c.remind_at, v_zone,
    v_loan.reminder_email, 'loan:' || c.id::text || ':' || c.kind
  from (
    select i.id, i.number, i.due_date, i.amount - i.paid_amount as remaining, 'upcoming'::text as kind,
      ((i.due_date - v_loan.reminder_days_before::integer) + time '09:00') at time zone v_zone as remind_at
    from public.loan_installments i
    where i.loan_id = v_loan.id and v_loan.reminder_days_before is not null and i.paid_amount < i.amount
    union all
    select i.id, i.number, i.due_date, i.amount - i.paid_amount, 'overdue'::text,
      ((i.due_date + 1) + time '09:00') at time zone v_zone
    from public.loan_installments i
    where i.loan_id = v_loan.id and v_loan.overdue_alerts and i.paid_amount < i.amount
  ) c
  where c.remind_at >= p_from
    and not exists (select 1 from public.loan_reminders r where r.dedupe_key = 'loan:' || c.id::text || ':' || c.kind)
  order by c.remind_at, c.number
  limit 1
  on conflict do nothing;
end;
$function$;

-- Keeps status in step with the balance: an active loan with nothing left is
-- completed; a completed loan with money due again (a reversal or a larger
-- recalculated schedule) is active. Closed loans are left alone.
create or replace function public.persora_loan_sync_status(p_loan uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_outstanding numeric;
begin
  select status into v_status from public.loans where id = p_loan;
  select coalesce(sum(amount - paid_amount), 0) into v_outstanding from public.loan_installments where loan_id = p_loan;
  if v_status = 'active' and v_outstanding = 0 then
    update public.loans set status = 'completed', completed_at = clock_timestamp() where id = p_loan;
    return 'completed';
  elsif v_status = 'completed' and v_outstanding > 0 then
    update public.loans set status = 'active', completed_at = null where id = p_loan;
    return 'active';
  end if;
  return v_status;
end;
$function$;

-- Linked documents must be the owner's own vault records. Ids already linked
-- to the loan stay accepted (a linked record may since be in Trash).
create or replace function public.persora_loan_check_documents(p_owner uuid, p_documents uuid[], p_existing uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    select 1 from unnest(coalesce(p_documents, '{}'::uuid[])) d(id)
    where not (d.id = any(coalesce(p_existing, '{}'::uuid[])))
      and not exists (select 1 from public.vault_items v where v.id = d.id and v.user_id = p_owner)
  ) then
    raise exception 'One of the linked documents isn''t in your Persora vault.' using errcode = 'P0400';
  end if;
end;
$function$;

create or replace function public.persora_loan_uuid_array(p_value jsonb)
returns uuid[]
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end)::uuid), '{}'::uuid[]);
$function$;

-- 6. API functions ---------------------------------------------------------------------

-- Every loan with its repayment aggregates for `p_today` (the member's local date).
create or replace function public.persora_loans_list(p_owner uuid, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
    'scheduled_total', agg.scheduled_total,
    'paid_total', agg.paid_total,
    'installments_total', agg.installments_total,
    'paid_count', agg.paid_count,
    'overdue_count', agg.overdue_count,
    'overdue_amount', agg.overdue_amount,
    'next_installment', nxt.row
  ) order by l.created_at, l.id), '[]'::jsonb)
  from public.loans l
  cross join lateral (
    select coalesce(sum(i.amount), 0) as scheduled_total,
      coalesce(sum(i.paid_amount), 0) as paid_total,
      count(*) as installments_total,
      count(*) filter (where i.paid_amount >= i.amount) as paid_count,
      count(*) filter (where i.paid_amount < i.amount and i.due_date < p_today) as overdue_count,
      coalesce(sum(i.amount - i.paid_amount) filter (where i.paid_amount < i.amount and i.due_date < p_today), 0) as overdue_amount
    from public.loan_installments i where i.loan_id = l.id
  ) agg
  left join lateral (
    select to_jsonb(i) as row from public.loan_installments i
    where i.loan_id = l.id and i.paid_amount < i.amount
    order by i.number limit 1
  ) nxt on true
  where l.user_id = p_owner;
$function$;

-- One loan with its installments (and their payment counts) and payments.
create or replace function public.persora_loan_get(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_loan jsonb;
begin
  select to_jsonb(l) into v_loan from public.loans l where l.id = p_id and l.user_id = p_owner;
  if v_loan is null then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  return jsonb_build_object(
    'loan', v_loan,
    'installments', (
      select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'payment_count', (select count(*) from public.loan_payments p where p.installment_id = i.id)
      ) order by i.number), '[]'::jsonb)
      from public.loan_installments i where i.loan_id = p_id and i.user_id = p_owner
    ),
    'payments', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.paid_on, p.created_at, p.id), '[]'::jsonb)
      from public.loan_payments p where p.loan_id = p_id and p.user_id = p_owner
    )
  );
end;
$function$;

-- Creates a loan with its full schedule. p_id comes from the client, so a
-- retried submission returns {replayed: true} instead of creating a duplicate.
create or replace function public.persora_loan_create(p_owner uuid, p_id uuid, p_loan jsonb, p_installments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_owner uuid;
  v_count integer;
  v_docs uuid[] := public.persora_loan_uuid_array(p_loan->'document_ids');
  v_rows integer;
begin
  select user_id into v_owner from public.loans where id = p_id;
  if found then
    if v_owner = p_owner then
      return jsonb_build_object('replayed', true);
    end if;
    raise exception 'That loan id is already in use. Reload and try again.' using errcode = 'P0409';
  end if;
  perform 1 from public.profiles where id = p_owner for update;
  select count(*) into v_count from public.loans where user_id = p_owner;
  if v_count >= 200 then
    raise exception 'You can keep up to 200 loans. Delete old ones to add more.' using errcode = 'P0400';
  end if;
  perform public.persora_loan_check_documents(p_owner, v_docs, '{}'::uuid[]);
  insert into public.loans (
    id, user_id, name, direction, party_name, borrower_name, currency, principal, interest_method, interest_rate, installment_count,
    frequency, start_date, first_due_date, anchor_date, anchor_number, reference, notes, document_ids, reminder_days_before,
    overdue_alerts, reminder_email, original_terms
  ) values (
    p_id, p_owner, p_loan->>'name', p_loan->>'direction', p_loan->>'party_name', p_loan->>'borrower_name', p_loan->>'currency',
    (p_loan->>'principal')::numeric, p_loan->>'interest_method', nullif(p_loan->>'interest_rate', '')::numeric,
    (p_loan->>'installment_count')::integer, p_loan->>'frequency', (p_loan->>'start_date')::date, (p_loan->>'first_due_date')::date,
    (p_loan->>'first_due_date')::date, 1, coalesce(p_loan->>'reference', ''), coalesce(p_loan->>'notes', ''), v_docs,
    nullif(p_loan->>'reminder_days_before', '')::smallint, coalesce((p_loan->>'overdue_alerts')::boolean, false),
    coalesce((p_loan->>'reminder_email')::boolean, false), coalesce(p_loan->'original_terms', '{}'::jsonb)
  );
  insert into public.loan_installments (loan_id, user_id, number, due_date, principal_amount, interest_amount, amount, schedule_version)
  select p_id, p_owner, (x->>'number')::integer, (x->>'due_date')::date, (x->>'principal')::numeric, (x->>'interest')::numeric, (x->>'amount')::numeric, 1
  from jsonb_array_elements(p_installments) x;
  get diagnostics v_rows = row_count;
  if v_rows <> (p_loan->>'installment_count')::integer
    or (select min(number) from public.loan_installments where loan_id = p_id) <> 1
    or (select max(number) from public.loan_installments where loan_id = p_id) <> v_rows then
    raise exception 'The installment schedule is incomplete.' using errcode = 'P0400';
  end if;
  perform public.persora_loan_plan_reminder(p_id, clock_timestamp());
  return jsonb_build_object('replayed', false);
end;
$function$;

-- Updates a loan. Without p_recalc the schedule terms must be unchanged; with
-- it, installments numbered above p_recalc.locked_count are replaced — after
-- re-checking that none of them has a payment record or a past due date, so a
-- payment recorded meanwhile on another device is never overwritten.
create or replace function public.persora_loan_update(
  p_owner uuid, p_id uuid, p_expected_revision integer, p_loan jsonb, p_recalc jsonb, p_today date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_loan public.loans%rowtype;
  v_locked integer;
  v_docs uuid[] := public.persora_loan_uuid_array(p_loan->'document_ids');
  v_rows integer;
  v_status text;
begin
  select * into v_loan from public.loans where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  if p_expected_revision is distinct from v_loan.revision then
    raise exception 'This loan changed on another device. Reload to see the latest version.' using errcode = 'P0409';
  end if;
  perform public.persora_loan_check_documents(p_owner, v_docs, v_loan.document_ids);
  if exists (select 1 from public.loan_payments where loan_id = p_id and paid_on < (p_loan->>'start_date')::date) then
    raise exception 'A recorded payment is dated before that start date.' using errcode = 'P0400';
  end if;

  if p_recalc is null then
    if (p_loan->>'principal')::numeric <> v_loan.principal
      or p_loan->>'interest_method' <> v_loan.interest_method
      or nullif(p_loan->>'interest_rate', '')::numeric is distinct from v_loan.interest_rate
      or (p_loan->>'installment_count')::integer <> v_loan.installment_count
      or p_loan->>'frequency' <> v_loan.frequency
      or (p_loan->>'first_due_date')::date <> v_loan.first_due_date then
      raise exception 'Review and confirm the new installment schedule first.' using errcode = 'P0428';
    end if;
  else
    if v_loan.status = 'closed' then
      raise exception 'Reopen this loan before changing its schedule.' using errcode = 'P0409';
    end if;
    v_locked := (p_recalc->>'locked_count')::integer;
    if v_locked is null or v_locked < 0
      or exists (
        select 1 from public.loan_installments i
        where i.loan_id = p_id and i.number > v_locked
          and (i.due_date < p_today or i.paid_amount > 0 or exists (select 1 from public.loan_payments p where p.installment_id = i.id))
      )
      or (select count(*) from public.loan_installments where loan_id = p_id and number <= v_locked) <> v_locked then
      raise exception 'Payments or due dates changed since the preview. Review the new schedule again.' using errcode = 'P0409';
    end if;
    delete from public.loan_installments where loan_id = p_id and number > v_locked;
    insert into public.loan_installments (loan_id, user_id, number, due_date, principal_amount, interest_amount, amount, schedule_version)
    select p_id, p_owner, (x->>'number')::integer, (x->>'due_date')::date, (x->>'principal')::numeric, (x->>'interest')::numeric,
      (x->>'amount')::numeric, v_loan.schedule_version + 1
    from jsonb_array_elements(p_recalc->'installments') x;
    get diagnostics v_rows = row_count;
    if v_rows < 1 or v_locked + v_rows <> (p_loan->>'installment_count')::integer
      or (select min(number) from public.loan_installments where loan_id = p_id and number > v_locked) <> v_locked + 1
      or (select max(number) from public.loan_installments where loan_id = p_id) <> v_locked + v_rows
      or (v_locked > 0 and (select min(due_date) from public.loan_installments where loan_id = p_id and number > v_locked)
        <= (select due_date from public.loan_installments where loan_id = p_id and number = v_locked)) then
      raise exception 'The recalculated schedule is inconsistent.' using errcode = 'P0400';
    end if;
  end if;

  update public.loans set
    name = p_loan->>'name', direction = p_loan->>'direction', party_name = p_loan->>'party_name', borrower_name = p_loan->>'borrower_name',
    currency = p_loan->>'currency', principal = (p_loan->>'principal')::numeric, interest_method = p_loan->>'interest_method',
    interest_rate = nullif(p_loan->>'interest_rate', '')::numeric, installment_count = (p_loan->>'installment_count')::integer,
    frequency = p_loan->>'frequency', start_date = (p_loan->>'start_date')::date, first_due_date = (p_loan->>'first_due_date')::date,
    anchor_date = case when p_recalc is null then anchor_date else (p_recalc->>'anchor_date')::date end,
    anchor_number = case when p_recalc is null then anchor_number else (p_recalc->>'anchor_number')::integer end,
    reference = coalesce(p_loan->>'reference', ''), notes = coalesce(p_loan->>'notes', ''), document_ids = v_docs,
    reminder_days_before = nullif(p_loan->>'reminder_days_before', '')::smallint,
    overdue_alerts = coalesce((p_loan->>'overdue_alerts')::boolean, false), reminder_email = coalesce((p_loan->>'reminder_email')::boolean, false),
    schedule_version = case when p_recalc is null then schedule_version else schedule_version + 1 end,
    schedule_changes = case when p_recalc is null or p_recalc->'change' is null then schedule_changes else (
      select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(schedule_changes || jsonb_build_array(p_recalc->'change')) with ordinality as t(e, n)
        order by n desc limit 50
      ) recent
    ) end,
    revision = revision + 1, updated_at = clock_timestamp()
  where id = p_id;
  v_status := public.persora_loan_sync_status(p_id);
  perform public.persora_loan_plan_reminder(p_id, clock_timestamp());
  return jsonb_build_object('status', v_status);
end;
$function$;

-- complete (only with nothing outstanding), close (explicit settlement with a
-- note; the remaining balance is shown as written off) or reopen a closed loan.
create or replace function public.persora_loan_set_status(p_owner uuid, p_id uuid, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_loan public.loans%rowtype;
  v_outstanding numeric;
begin
  select * into v_loan from public.loans where id = p_id and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  select coalesce(sum(amount - paid_amount), 0) into v_outstanding from public.loan_installments where loan_id = p_id;
  if p_action = 'complete' then
    if v_loan.status = 'completed' then return jsonb_build_object('status', 'completed'); end if;
    if v_loan.status = 'closed' then
      raise exception 'This loan is closed. Reopen it first.' using errcode = 'P0409';
    end if;
    if v_outstanding > 0 then
      raise exception 'This loan still has % outstanding. Record the remaining payments, or close it with a settlement note.', to_char(v_outstanding, 'FM999,999,999,990.00') using errcode = 'P0409';
    end if;
    update public.loans set status = 'completed', completed_at = clock_timestamp(), revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  elsif p_action = 'close' then
    if v_loan.status = 'closed' then return jsonb_build_object('status', 'closed'); end if;
    if v_loan.status = 'completed' or v_outstanding = 0 then
      raise exception 'This loan is fully repaid, so it can simply be marked completed.' using errcode = 'P0409';
    end if;
    if char_length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'Add a settlement note explaining why the loan is closed.' using errcode = 'P0400';
    end if;
    update public.loans set status = 'closed', closed_at = clock_timestamp(), close_note = left(btrim(p_note), 500),
      revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  elsif p_action = 'reopen' then
    if v_loan.status <> 'closed' then
      raise exception 'Only a closed loan can be reopened.' using errcode = 'P0409';
    end if;
    update public.loans set status = 'active', closed_at = null, close_note = null, revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
    perform public.persora_loan_sync_status(p_id);
  else
    raise exception 'Unknown loan action.' using errcode = 'P0400';
  end if;
  perform public.persora_loan_plan_reminder(p_id, clock_timestamp());
  return jsonb_build_object('status', (select status from public.loans where id = p_id));
end;
$function$;

create or replace function public.persora_loan_delete(p_owner uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  delete from public.loans where id = p_id and user_id = p_owner;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  return true;
end;
$function$;

-- Inserts one payment row for an installment under row locks (internal).
create or replace function public.persora_loan_insert_payment(p_owner uuid, p_loan public.loans, p_installment uuid, p_payment jsonb, p_today date, p_corrects uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_installment public.loan_installments%rowtype;
  v_amount numeric := (p_payment->>'amount')::numeric;
  v_paid_on date := (p_payment->>'paid_on')::date;
begin
  select * into v_installment from public.loan_installments where id = p_installment and loan_id = p_loan.id and user_id = p_owner for update;
  if not found then
    raise exception 'That installment is no longer part of this loan.' using errcode = 'P0404';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'The payment must be more than zero.' using errcode = 'P0400';
  end if;
  if v_amount > v_installment.amount - v_installment.paid_amount then
    raise exception 'Installment % has % remaining. Record any extra against the next installment.', v_installment.number,
      to_char(v_installment.amount - v_installment.paid_amount, 'FM999,999,999,990.00') using errcode = 'P0400';
  end if;
  if v_paid_on is null or v_paid_on > p_today then
    raise exception 'The payment date can''t be in the future.' using errcode = 'P0400';
  end if;
  if v_paid_on < p_loan.start_date then
    raise exception 'The payment date can''t be before the loan started.' using errcode = 'P0400';
  end if;
  insert into public.loan_payments (id, loan_id, installment_id, user_id, amount, paid_on, method, reference, notes, corrects_payment_id)
  values ((p_payment->>'id')::uuid, p_loan.id, p_installment, p_owner, v_amount, v_paid_on, coalesce(p_payment->>'method', ''),
    coalesce(p_payment->>'reference', ''), coalesce(p_payment->>'notes', ''), p_corrects);
  update public.loan_installments set paid_amount = paid_amount + v_amount, updated_at = clock_timestamp() where id = p_installment;
end;
$function$;

-- Records a payment against one installment. The client's payment id makes a
-- retried submission a no-op ({replayed: true}).
create or replace function public.persora_loan_pay(p_owner uuid, p_loan uuid, p_installment uuid, p_payment jsonb, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_loan public.loans%rowtype;
  v_existing public.loan_payments%rowtype;
  v_status text;
begin
  select * into v_loan from public.loans where id = p_loan and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  select * into v_existing from public.loan_payments where id = (p_payment->>'id')::uuid;
  if found then
    if v_existing.user_id = p_owner and v_existing.installment_id = p_installment and v_existing.amount = (p_payment->>'amount')::numeric then
      return jsonb_build_object('replayed', true, 'status', v_loan.status);
    end if;
    raise exception 'That payment was already recorded with different details. Reload and try again.' using errcode = 'P0409';
  end if;
  if v_loan.status = 'closed' then
    raise exception 'This loan is closed. Reopen it to record payments.' using errcode = 'P0409';
  end if;
  if v_loan.status = 'completed' then
    raise exception 'This loan is already fully repaid.' using errcode = 'P0409';
  end if;
  perform public.persora_loan_insert_payment(p_owner, v_loan, p_installment, p_payment, p_today, null);
  update public.loans set revision = revision + 1, updated_at = clock_timestamp() where id = p_loan;
  v_status := public.persora_loan_sync_status(p_loan);
  perform public.persora_loan_plan_reminder(p_loan, clock_timestamp());
  return jsonb_build_object('replayed', false, 'status', v_status);
end;
$function$;

-- Reverses a payment (kept, marked reversed with a reason). With p_correction,
-- atomically records the corrected payment on the same installment.
create or replace function public.persora_loan_reverse_payment(
  p_owner uuid, p_loan uuid, p_payment uuid, p_reason text, p_correction jsonb, p_today date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_loan public.loans%rowtype;
  v_payment public.loan_payments%rowtype;
  v_status text;
begin
  select * into v_loan from public.loans where id = p_loan and user_id = p_owner for update;
  if not found then
    raise exception 'That loan is no longer available.' using errcode = 'P0404';
  end if;
  select * into v_payment from public.loan_payments where id = p_payment and loan_id = p_loan and user_id = p_owner for update;
  if not found then
    raise exception 'That payment is no longer available.' using errcode = 'P0404';
  end if;
  if v_payment.status = 'reversed' then
    -- Retried request: already done.
    if p_correction is null or exists (select 1 from public.loan_payments where id = (p_correction->>'id')::uuid and corrects_payment_id = p_payment) then
      return jsonb_build_object('replayed', true, 'status', v_loan.status);
    end if;
    raise exception 'That payment was already reversed. Record a new payment instead.' using errcode = 'P0409';
  end if;
  if v_loan.status = 'closed' then
    raise exception 'This loan is closed. Reopen it to change its payments.' using errcode = 'P0409';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why this payment is being reversed.' using errcode = 'P0400';
  end if;
  update public.loan_payments set status = 'reversed', reversed_at = clock_timestamp(), reversal_reason = left(btrim(p_reason), 300) where id = p_payment;
  update public.loan_installments set paid_amount = paid_amount - v_payment.amount, updated_at = clock_timestamp() where id = v_payment.installment_id;
  if p_correction is not null then
    perform public.persora_loan_insert_payment(p_owner, v_loan, v_payment.installment_id, p_correction, p_today, p_payment);
  end if;
  update public.loans set revision = revision + 1, updated_at = clock_timestamp() where id = p_loan;
  v_status := public.persora_loan_sync_status(p_loan);
  perform public.persora_loan_plan_reminder(p_loan, clock_timestamp());
  return jsonb_build_object('replayed', false, 'status', v_status);
end;
$function$;

create or replace function public.persora_loan_reminders_recent(p_owner uuid, p_since timestamptz)
returns setof public.loan_reminders
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select * from public.loan_reminders
  where user_id = p_owner and status = 'sent' and remind_at >= p_since
  order by remind_at desc
  limit 50;
$function$;

create or replace function public.persora_loan_reminders_mark_read(p_owner uuid, p_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
begin
  update public.loan_reminders set read_at = clock_timestamp()
  where user_id = p_owner and status = 'sent' and read_at is null and (p_id is null or id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.persora_loans_export(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'loans', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at, l.id), '[]'::jsonb) from public.loans l where l.user_id = p_owner),
    'installments', (select coalesce(jsonb_agg(to_jsonb(i) order by i.loan_id, i.number), '[]'::jsonb) from public.loan_installments i where i.user_id = p_owner),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.loan_id, p.paid_on, p.created_at, p.id), '[]'::jsonb) from public.loan_payments p where p.user_id = p_owner),
    'reminders', (select coalesce(jsonb_agg(to_jsonb(r) order by r.remind_at, r.id), '[]'::jsonb) from public.loan_reminders r where r.user_id = p_owner and r.status <> 'scheduled')
  );
$function$;

-- Restores loans from a backup (validated by the Pages API). Idempotent: a loan
-- already in this account (same id, or the same deterministic id derived for
-- this account) is matched and left untouched. Ids that belong to another
-- account are replaced by a deterministic id derived from this owner and the
-- original id, so importing the same file twice never duplicates.
create or replace function public.persora_loans_import(p_owner uuid, p_loans jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_entry jsonb;
  v_values jsonb;
  v_source uuid;
  v_id uuid;
  v_owner uuid;
  v_count integer;
  v_created integer := 0;
  v_matched integer := 0;
  v_skipped integer := 0;
  v_installments integer := 0;
  v_payments integer := 0;
  v_rows integer;
  v_docs uuid[];
  v_map jsonb;
  v_item jsonb;
  v_child uuid;
begin
  perform 1 from public.profiles where id = p_owner for update;
  select count(*) into v_count from public.loans where user_id = p_owner;
  for v_entry in select value from jsonb_array_elements(coalesce(p_loans, '[]'::jsonb)) loop
    v_values := v_entry->'values';
    v_source := (v_entry->>'source_id')::uuid;
    select user_id into v_owner from public.loans where id = v_source;
    if found and v_owner = p_owner then
      v_matched := v_matched + 1;
      continue;
    end if;
    v_id := case when found then md5(p_owner::text || ':loan:' || v_source::text)::uuid else v_source end;
    if exists (select 1 from public.loans where id = v_id) then
      v_matched := v_matched + 1;
      continue;
    end if;
    if v_count >= 200 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Only links to this owner's own vault records survive a restore.
    select coalesce(array_agg(d.id), '{}'::uuid[]) into v_docs
    from unnest(public.persora_loan_uuid_array(v_values->'document_ids')) d(id)
    where exists (select 1 from public.vault_items v where v.id = d.id and v.user_id = p_owner);
    insert into public.loans (
      id, user_id, name, direction, party_name, borrower_name, currency, principal, interest_method, interest_rate, installment_count,
      frequency, start_date, first_due_date, anchor_date, anchor_number, reference, notes, document_ids, reminder_days_before,
      overdue_alerts, reminder_email, status, completed_at, closed_at, close_note, original_terms, schedule_changes, schedule_version,
      created_at
    ) values (
      v_id, p_owner, v_values->>'name', v_values->>'direction', v_values->>'party_name', v_values->>'borrower_name', v_values->>'currency',
      (v_values->>'principal')::numeric, v_values->>'interest_method', nullif(v_values->>'interest_rate', '')::numeric,
      (v_values->>'installment_count')::integer, v_values->>'frequency', (v_values->>'start_date')::date, (v_values->>'first_due_date')::date,
      (v_values->>'anchor_date')::date, (v_values->>'anchor_number')::integer, coalesce(v_values->>'reference', ''),
      coalesce(v_values->>'notes', ''), v_docs, nullif(v_values->>'reminder_days_before', '')::smallint,
      coalesce((v_values->>'overdue_alerts')::boolean, false), coalesce((v_values->>'reminder_email')::boolean, false),
      'active', null, null, null, coalesce(v_values->'original_terms', '{}'::jsonb), coalesce(v_values->'schedule_changes', '[]'::jsonb),
      greatest(coalesce((v_values->>'schedule_version')::integer, 1), 1), coalesce((v_values->>'created_at')::timestamptz, clock_timestamp())
    );
    v_count := v_count + 1;
    -- Installments: keep the original ids when free, else derive one.
    v_map := '{}'::jsonb;
    for v_item in select value from jsonb_array_elements(coalesce(v_entry->'installments', '[]'::jsonb)) loop
      v_child := (v_item->>'source_id')::uuid;
      if exists (select 1 from public.loan_installments where id = v_child) then
        v_child := md5(p_owner::text || ':installment:' || v_child::text)::uuid;
      end if;
      insert into public.loan_installments (id, loan_id, user_id, number, due_date, principal_amount, interest_amount, amount, paid_amount, schedule_version)
      values (v_child, v_id, p_owner, (v_item->>'number')::integer, (v_item->>'due_date')::date, (v_item->>'principal')::numeric,
        (v_item->>'interest')::numeric, (v_item->>'amount')::numeric, (v_item->>'paid')::numeric, greatest(coalesce((v_item->>'schedule_version')::integer, 1), 1));
      v_map := v_map || jsonb_build_object(v_item->>'source_id', v_child::text);
      v_installments := v_installments + 1;
    end loop;
    -- Payments: original ids when free; corrections keep pointing at the payment they corrected.
    for v_item in select value from jsonb_array_elements(coalesce(v_entry->'payments', '[]'::jsonb)) loop
      v_child := (v_item->>'source_id')::uuid;
      if exists (select 1 from public.loan_payments where id = v_child) then
        v_child := md5(p_owner::text || ':payment:' || v_child::text)::uuid;
      end if;
      insert into public.loan_payments (id, loan_id, installment_id, user_id, amount, paid_on, method, reference, notes, status, reversed_at, reversal_reason, created_at)
      values (v_child, v_id, (v_map->>(v_item->>'installment_source_id'))::uuid, p_owner, (v_item->>'amount')::numeric, (v_item->>'paid_on')::date,
        coalesce(v_item->>'method', ''), coalesce(v_item->>'reference', ''), coalesce(v_item->>'notes', ''), v_item->>'status',
        (v_item->>'reversed_at')::timestamptz, nullif(v_item->>'reversal_reason', ''), coalesce((v_item->>'created_at')::timestamptz, clock_timestamp()));
      v_map := v_map || jsonb_build_object('p:' || (v_item->>'source_id'), v_child::text);
      v_payments := v_payments + 1;
    end loop;
    update public.loan_payments p set corrects_payment_id = (v_map->>('p:' || (src.value->>'corrects_source_id')))::uuid
    from jsonb_array_elements(coalesce(v_entry->'payments', '[]'::jsonb)) src
    where p.id = (v_map->>('p:' || (src.value->>'source_id')))::uuid and src.value->>'corrects_source_id' is not null
      and v_map ? ('p:' || (src.value->>'corrects_source_id'));
    get diagnostics v_rows = row_count;
    -- Status: closed loans stay closed (with their note); otherwise it follows the balance.
    if v_values->>'status' = 'closed' and nullif(btrim(coalesce(v_values->>'close_note', '')), '') is not null then
      update public.loans set status = 'closed', closed_at = coalesce((v_values->>'closed_at')::timestamptz, clock_timestamp()),
        close_note = left(btrim(v_values->>'close_note'), 500) where id = v_id;
    else
      perform public.persora_loan_sync_status(v_id);
    end if;
    perform public.persora_loan_plan_reminder(v_id, clock_timestamp());
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('loans_created', v_created, 'loans_matched', v_matched, 'loans_skipped', v_skipped,
    'installments_added', v_installments, 'payments_added', v_payments);
end;
$function$;

-- 7. Reminder delivery ---------------------------------------------------------------------

-- Claims due loan reminders (SKIP LOCKED; a claim older than 5 minutes is
-- reclaimed, but an interrupted email is never re-sent). Returns each reminder
-- with its loan, installment and owner so the dispatcher can skip paid ones.
create or replace function public.persora_loan_claim_reminders(p_limit integer default 50, p_owner uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  with due as (
    select r.id from public.loan_reminders r
    where (p_owner is null or r.user_id = p_owner)
      and ((r.status = 'scheduled' and r.remind_at <= v_now)
        or (r.status = 'processing' and r.claimed_at < v_now - interval '5 minutes'))
    order by r.remind_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of r skip locked
  ), claimed as (
    update public.loan_reminders r set
      email_status = case
        when r.status = 'processing' and r.email_status = 'sending' then 'failed'
        when r.email_requested and r.email_status = 'not_requested' then 'sending'
        else r.email_status end,
      email_note = case when r.status = 'processing' and r.email_status = 'sending' then 'Delivery was interrupted; not retried to avoid a duplicate email.' else r.email_note end,
      status = 'processing', claimed_at = v_now, attempts = r.attempts + 1
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder', to_jsonb(c),
    'loan', to_jsonb(l),
    'installment', to_jsonb(i),
    'owner', jsonb_build_object('email', p.email, 'full_name', p.full_name, 'timezone', p.timezone,
      'email_verified', p.email_verified_at is not null, 'active', p.account_status = 'active')
  )), '[]'::jsonb) into v_rows
  from claimed c
  join public.loans l on l.id = c.loan_id
  join public.loan_installments i on i.id = c.installment_id
  join public.profiles p on p.id = c.user_id;
  return v_rows;
end;
$function$;

-- Finishes a claimed reminder (delivered or skipped) and plans the loan's next one.
create or replace function public.persora_loan_complete_reminder(p_id uuid, p_claimed_at timestamptz, p_delivered boolean, p_email_status text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reminder public.loan_reminders%rowtype;
begin
  if p_email_status not in ('not_requested', 'sent', 'failed', 'skipped') then
    raise exception 'Unknown email status.' using errcode = 'P0400';
  end if;
  update public.loan_reminders set
    status = case when p_delivered then 'sent' else 'skipped' end,
    processed_at = clock_timestamp(),
    email_status = case when email_status = 'failed' then 'failed' else p_email_status end,
    email_note = coalesce(left(p_note, 200), email_note)
  where id = p_id and status = 'processing' and claimed_at = p_claimed_at
  returning * into v_reminder;
  if not found then
    return false;
  end if;
  if not exists (select 1 from public.loan_reminders where loan_id = v_reminder.loan_id and status = 'scheduled') then
    perform public.persora_loan_plan_reminder(v_reminder.loan_id, greatest(v_reminder.remind_at, clock_timestamp() - interval '1 minute'));
  end if;
  return true;
end;
$function$;

-- The existing every-minute tick now also wakes the dispatcher for due loan
-- reminders. Same Vault secrets, same endpoint, same token.
create or replace function public.persora_calendar_dispatch_ping()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_url text;
  v_token text;
begin
  if not exists (
    select 1 from public.calendar_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) and not exists (
    select 1 from public.habit_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) and not exists (
    select 1 from public.loan_reminders
    where (status = 'scheduled' and remind_at <= now()) or (status = 'processing' and claimed_at < now() - interval '5 minutes')
  ) then
    return 'idle';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'pg_net unavailable';
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_url using 'persora_calendar_dispatch_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_token using 'persora_calendar_dispatch_token';
  exception when others then
    return 'vault unavailable';
  end;
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then
    return 'not configured';
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 15000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-persora-cron-token', v_token);
  return 'requested';
end;
$function$;

-- 8. Privileges --------------------------------------------------------------------------------

revoke all on function public.persora_loan_plan_reminder(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.persora_loan_sync_status(uuid) from public, anon, authenticated, service_role;
revoke all on function public.persora_loan_check_documents(uuid, uuid[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.persora_loan_uuid_array(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.persora_loan_insert_payment(uuid, public.loans, uuid, jsonb, date, uuid) from public, anon, authenticated, service_role;
revoke all on function public.persora_loans_list(uuid, date) from public, anon, authenticated;
revoke all on function public.persora_loan_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_loan_create(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persora_loan_update(uuid, uuid, integer, jsonb, jsonb, date) from public, anon, authenticated;
revoke all on function public.persora_loan_set_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.persora_loan_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_loan_pay(uuid, uuid, uuid, jsonb, date) from public, anon, authenticated;
revoke all on function public.persora_loan_reverse_payment(uuid, uuid, uuid, text, jsonb, date) from public, anon, authenticated;
revoke all on function public.persora_loan_reminders_recent(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.persora_loan_reminders_mark_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persora_loans_export(uuid) from public, anon, authenticated;
revoke all on function public.persora_loans_import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.persora_loan_claim_reminders(integer, uuid) from public, anon, authenticated;
revoke all on function public.persora_loan_complete_reminder(uuid, timestamptz, boolean, text, text) from public, anon, authenticated;
revoke all on function public.persora_calendar_dispatch_ping() from public, anon, authenticated;
grant execute on function public.persora_loans_list(uuid, date) to service_role;
grant execute on function public.persora_loan_get(uuid, uuid) to service_role;
grant execute on function public.persora_loan_create(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.persora_loan_update(uuid, uuid, integer, jsonb, jsonb, date) to service_role;
grant execute on function public.persora_loan_set_status(uuid, uuid, text, text) to service_role;
grant execute on function public.persora_loan_delete(uuid, uuid) to service_role;
grant execute on function public.persora_loan_pay(uuid, uuid, uuid, jsonb, date) to service_role;
grant execute on function public.persora_loan_reverse_payment(uuid, uuid, uuid, text, jsonb, date) to service_role;
grant execute on function public.persora_loan_reminders_recent(uuid, timestamptz) to service_role;
grant execute on function public.persora_loan_reminders_mark_read(uuid, uuid) to service_role;
grant execute on function public.persora_loans_export(uuid) to service_role;
grant execute on function public.persora_loans_import(uuid, jsonb) to service_role;
grant execute on function public.persora_loan_claim_reminders(integer, uuid) to service_role;
grant execute on function public.persora_loan_complete_reminder(uuid, timestamptz, boolean, text, text) to service_role;
grant execute on function public.persora_calendar_dispatch_ping() to service_role;
