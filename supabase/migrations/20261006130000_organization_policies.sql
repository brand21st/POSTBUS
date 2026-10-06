-- Merchant WhatsApp policy documents (shipping, contact, returns, T&C) for VaChat keyword RAG.

create table if not exists public.organization_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  shipping_policy_body text not null default '',
  contact_body text not null default '',
  returns_body text not null default '',
  terms_body text not null default '',
  shipping_policy_keywords text[] not null default '{}',
  contact_keywords text[] not null default '{}',
  returns_keywords text[] not null default '{}',
  terms_keywords text[] not null default '{}',
  shipping_policy_enabled boolean not null default true,
  contact_enabled boolean not null default true,
  returns_enabled boolean not null default true,
  terms_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_policies_shipping_body_chk check (char_length(shipping_policy_body) <= 8000),
  constraint organization_policies_contact_body_chk check (char_length(contact_body) <= 8000),
  constraint organization_policies_returns_body_chk check (char_length(returns_body) <= 8000),
  constraint organization_policies_terms_body_chk check (char_length(terms_body) <= 8000)
);

comment on table public.organization_policies is
  'Per-merchant customer policies answered on the PostBus WhatsApp assistant via keyword matching.';

drop trigger if exists set_organization_policies_updated_at on public.organization_policies;
create trigger set_organization_policies_updated_at
  before update on public.organization_policies
  for each row execute function public.set_updated_at();

alter table public.organization_policies enable row level security;

drop policy if exists organization_policies_select on public.organization_policies;
create policy organization_policies_select on public.organization_policies
  for select using (public.is_org_member(organization_id));

drop policy if exists organization_policies_write on public.organization_policies;
create policy organization_policies_write on public.organization_policies
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );
