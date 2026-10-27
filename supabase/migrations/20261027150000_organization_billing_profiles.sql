-- Billing details for future invoices. Independent of tax-invoice issuance tables.
create table if not exists public.organization_billing_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text not null default '',
  address text not null default '',
  gstin text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.organization_billing_profiles enable row level security;
revoke all on public.organization_billing_profiles from anon, authenticated;
grant all on public.organization_billing_profiles to service_role;
