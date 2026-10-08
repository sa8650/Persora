-- Store scan facts that do not map to a typed medical-record field.
alter table public.medical_records
  add column if not exists additional_data text not null default '';
