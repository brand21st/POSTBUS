-- Merchant shipping invoices (separate from SaaS billing public.invoices).

create table if not exists public.invoice_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  appearance jsonb not null default '{}'::jsonb,
  gstin text,
  business_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year integer not null,
  next_number integer not null default 1,
  primary key (organization_id, year),
  constraint invoice_counters_year_chk check (year >= 2000 and year <= 2100),
  constraint invoice_counters_next_chk check (next_number >= 1)
);

create table if not exists public.shipping_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  invoice_number text not null,
  tracking_number text,
  file_path text,
  status text not null default 'PENDING',
  error_message text,
  invoice_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  currency text not null default 'INR',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  appearance_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_invoices_status_chk check (status in ('PENDING', 'GENERATED', 'FAILED')),
  unique (organization_id, shipment_id),
  unique (organization_id, invoice_number)
);

create index if not exists shipping_invoices_org_created_idx
  on public.shipping_invoices (organization_id, created_at desc);

create index if not exists shipping_invoices_org_order_idx
  on public.shipping_invoices (organization_id, order_id);

alter table public.invoice_settings enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.shipping_invoices enable row level security;

drop policy if exists invoice_settings_select on public.invoice_settings;
create policy invoice_settings_select on public.invoice_settings
  for select using (public.is_org_member(organization_id));

drop policy if exists invoice_settings_write on public.invoice_settings;
create policy invoice_settings_write on public.invoice_settings
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists invoice_counters_select on public.invoice_counters;
create policy invoice_counters_select on public.invoice_counters
  for select using (public.is_org_member(organization_id));

drop policy if exists shipping_invoices_select on public.shipping_invoices;
create policy shipping_invoices_select on public.shipping_invoices
  for select using (public.is_org_member(organization_id));

drop policy if exists shipping_invoices_write on public.shipping_invoices;
create policy shipping_invoices_write on public.shipping_invoices
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop trigger if exists set_invoice_settings_updated_at on public.invoice_settings;
create trigger set_invoice_settings_updated_at
  before update on public.invoice_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_shipping_invoices_updated_at on public.shipping_invoices;
create trigger set_shipping_invoices_updated_at
  before update on public.shipping_invoices
  for each row execute function public.set_updated_at();

create or replace function public.allocate_shipping_invoice_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_next integer;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  v_year := extract(year from (timezone('Asia/Kolkata', now())))::integer;

  insert into public.invoice_counters (organization_id, year, next_number)
  values (p_organization_id, v_year, 1)
  on conflict (organization_id, year)
  do update set next_number = public.invoice_counters.next_number + 1
  returning next_number into v_next;

  return 'INV-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
end;
$$;

revoke all on function public.allocate_shipping_invoice_number(uuid) from public;
grant execute on function public.allocate_shipping_invoice_number(uuid) to authenticated, service_role;

insert into public.invoice_settings (organization_id, appearance)
select id, '{}'::jsonb
from public.organizations
on conflict (organization_id) do nothing;
