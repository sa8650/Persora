-- Store the subscription term selected in the checkout drawer so payment
-- submission, admin history, and subscription activation agree on the term.
alter table public.payment_records
  add column if not exists billing_period text,
  add column if not exists duration_count integer,
  add column if not exists term_months integer;

-- Older payment rows predate selectable terms; preserve them as one month.
update public.payment_records
set billing_period = coalesce(billing_period, 'monthly'),
    duration_count = coalesce(duration_count, 1),
    term_months = coalesce(term_months, 1);

alter table public.payment_records
  alter column billing_period set default 'monthly',
  alter column billing_period set not null,
  alter column duration_count set default 1,
  alter column duration_count set not null,
  alter column term_months set default 1,
  alter column term_months set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_records'::regclass
      and conname = 'payment_records_billing_period_check'
  ) then
    alter table public.payment_records
      add constraint payment_records_billing_period_check
      check (billing_period in ('monthly', 'yearly'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_records'::regclass
      and conname = 'payment_records_duration_count_check'
  ) then
    alter table public.payment_records
      add constraint payment_records_duration_count_check
      check (duration_count between 1 and 120);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_records'::regclass
      and conname = 'payment_records_term_months_check'
  ) then
    alter table public.payment_records
      add constraint payment_records_term_months_check
      check (term_months between 1 and 120);
  end if;
end;
$$;

-- When an admin approves a request, activate the exact number of months that
-- was charged, extending an existing active subscription when appropriate.
create or replace function public.persora_review_payment(payment_id uuid, reviewer_id uuid, decision text, review_note text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_payment public.payment_records%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_term_months integer;
begin
  select * into v_payment from public.payment_records where id = payment_id for update;
  if not found or v_payment.status <> 'pending' then return false; end if;
  if decision not in ('approved', 'rejected') then return false; end if;
  if decision = 'approved' then
    select * into v_plan from public.subscription_plans where id = v_payment.plan_id and active = true;
    if not found then return false; end if;
    v_term_months := greatest(coalesce(v_payment.term_months, 1), 1);
    insert into public.user_subscriptions as existing_subscription (user_id, plan_id, status, storage_limit_gb, current_period_end)
    values (v_payment.user_id, v_plan.id, 'active', v_plan.storage_gb, now() + make_interval(months => v_term_months))
    on conflict (user_id) do update set
      plan_id = excluded.plan_id,
      status = 'active',
      storage_limit_gb = excluded.storage_limit_gb,
      current_period_end = case when existing_subscription.current_period_end > now()
        then existing_subscription.current_period_end + make_interval(months => v_term_months)
        else now() + make_interval(months => v_term_months) end;
  end if;
  update public.payment_records
  set status = decision, reviewed_at = now(), reviewed_by = reviewer_id, admin_note = coalesce(review_note, '')
  where id = payment_id;
  return true;
end;
$$;

notify pgrst, 'reload schema';
