-- India Post issues a separate contract per product (Speed Post, Business Parcel,
-- Registered Mail, ...), so a single india_post_connections.contract_id cannot book
-- more than one service. Barcode series are allotted per product too.

create table if not exists public.india_post_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_code text not null,
  contract_id text not null,
  label text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, service_code)
);

-- At most one default service per workspace.
create unique index if not exists india_post_contracts_default_uidx
  on public.india_post_contracts (organization_id)
  where is_default;

create index if not exists india_post_contracts_org_idx
  on public.india_post_contracts (organization_id, is_active);

alter table public.india_post_contracts enable row level security;

drop policy if exists india_post_contracts_tenant_all on public.india_post_contracts;
create policy india_post_contracts_tenant_all on public.india_post_contracts
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop trigger if exists set_india_post_contracts_updated_at on public.india_post_contracts;
create trigger set_india_post_contracts_updated_at
  before update on public.india_post_contracts
  for each row execute function public.set_updated_at();

-- Carry the existing single contract over as the default Speed Post contract.
insert into public.india_post_contracts (organization_id, service_code, contract_id, is_default)
select organization_id, 'SP_INLAND_PARCEL', contract_id, true
from public.india_post_connections
where contract_id is not null
  and btrim(contract_id) <> ''
on conflict (organization_id, service_code) do nothing;

-- Barcode ranges become service scoped. A null service_code means "any service",
-- which keeps existing rows working.
alter table public.barcode_ranges
  add column if not exists service_code text;

-- Saving the barcode range used to insert instead of update, so a workspace could
-- end up with several active ranges and the booking worker's maybeSingle() lookup
-- would error. Keep the newest per service and deactivate the rest.
update public.barcode_ranges as b
set is_active = false
where b.is_active
  and exists (
    select 1
    from public.barcode_ranges newer
    where newer.organization_id = b.organization_id
      and newer.service_code is not distinct from b.service_code
      and newer.is_active
      and (newer.created_at, newer.id) > (b.created_at, b.id)
  );

create unique index if not exists barcode_ranges_active_service_uidx
  on public.barcode_ranges (organization_id, coalesce(service_code, ''))
  where is_active;
