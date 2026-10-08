-- Admin-controlled Smart Scan availability and aggregate, content-free usage counters.
create table if not exists public.smart_scan_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  scan_count bigint not null default 0 check (scan_count >= 0),
  ocr_run_count bigint not null default 0 check (ocr_run_count >= 0),
  ai_extraction_count bigint not null default 0 check (ai_extraction_count >= 0),
  last_scanned_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.smart_scan_usage enable row level security;
revoke all on public.smart_scan_usage from anon, authenticated;
grant all on public.smart_scan_usage to service_role;

create or replace function public.persora_record_smart_scan_usage(
  p_user_id uuid,
  p_scans bigint default 0,
  p_ocr_runs bigint default 0,
  p_ai_extractions bigint default 0
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or p_scans < 0 or p_ocr_runs < 0 or p_ai_extractions < 0 then
    raise exception 'Invalid Smart Scan usage increment';
  end if;

  insert into public.smart_scan_usage (user_id, enabled, scan_count, ocr_run_count, ai_extraction_count, last_scanned_at, updated_at)
  values (p_user_id, true, p_scans, p_ocr_runs, p_ai_extractions, case when p_scans > 0 then now() else null end, now())
  on conflict (user_id) do update set
    scan_count = public.smart_scan_usage.scan_count + excluded.scan_count,
    ocr_run_count = public.smart_scan_usage.ocr_run_count + excluded.ocr_run_count,
    ai_extraction_count = public.smart_scan_usage.ai_extraction_count + excluded.ai_extraction_count,
    last_scanned_at = case when p_scans > 0 then now() else public.smart_scan_usage.last_scanned_at end,
    updated_at = now();
end;
$$;

revoke all on function public.persora_record_smart_scan_usage(uuid, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.persora_record_smart_scan_usage(uuid, bigint, bigint, bigint) to service_role;
