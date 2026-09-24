alter table public.organizations
  drop constraint if exists organizations_account_status_check;

alter table public.organizations
  add constraint organizations_account_status_check
  check (account_status in ('ACTIVE', 'SUSPENDED', 'DISABLED', 'BLOCKED', 'HOLD'));
