begin;

-- Allow private finance records to use the existing owner-scoped vault_items table.
alter table public.vault_items drop constraint if exists vault_items_section_check;
alter table public.vault_items add constraint vault_items_section_check check (section in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases',
  'accounts', 'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes', 'personal-finance'
));

commit;
