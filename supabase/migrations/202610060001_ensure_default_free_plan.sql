-- Ensure new and existing deployments always have an active Free subscription plan.
-- Preserve administrator-edited name, quota, price, and description when the row already exists.
insert into public.subscription_plans (slug, name, description, storage_gb, price_per_gb_monthly, active, sort_order)
values ('free', 'Free', 'A private place to get started.', 5, 0, true, 0)
on conflict (slug) do update set active = true;
