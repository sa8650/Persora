-- Add the new Password Manager page to server- and database-validated folder scopes.
alter table public.vault_folders drop constraint if exists vault_folders_scope_check;
alter table public.vault_folders add constraint vault_folders_scope_check check (scope in (
  'documents', 'academics', 'subscriptions', 'family', 'purchases', 'accounts',
  'memberships', 'wallet-cards', 'study', 'business-card', 'urls', 'notes',
  'contacts', 'business-cards', 'medical-records', 'password-manager'
));
