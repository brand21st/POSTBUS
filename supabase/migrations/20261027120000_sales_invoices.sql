-- Merchant sales invoices. Separate from shipping_invoices and subscription_tax_invoices.
-- Shipping invoice numbers keep INV-{calendar year}-{seq}. This file only restricts who can allocate them.

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
  if auth.role() is distinct from 'service_role'
     and not (auth.role() = 'authenticated' and public.is_org_member(p_organization_id)) then
    raise exception 'not authorized';
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

alter table public.gst_registrations
  add column if not exists trade_name text,
  add column if not exists pan text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists pincode text,
  add column if not exists phone text,
  add column if not exists email text;

alter table public.gst_registrations alter column gstin drop not null;

alter table public.gst_registrations drop constraint if exists gst_registrations_scheme_chk;
alter table public.gst_registrations
  add constraint gst_registrations_scheme_chk
  check (scheme in ('UNREGISTERED', 'REGULAR', 'COMPOSITION'));

alter table public.addresses
  add column if not exists company_name text,
  add column if not exists email text,
  add column if not exists gstin text,
  add column if not exists state_code text;

alter table public.order_line_items
  add column if not exists variant text;

create table if not exists public.sales_invoice_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  template text not null default 'CLASSIC' check (template in ('CLASSIC', 'GST')),
  prefix text not null default 'INV',
  financial_year_start_month integer not null default 4 check (financial_year_start_month between 1 and 12),
  terms text,
  thank_you text,
  signature_path text,
  show_sku boolean not null default true,
  show_variant boolean not null default true,
  show_hsn boolean not null default true,
  show_line_discount boolean not null default true,
  show_payment_method boolean not null default true,
  show_order_number boolean not null default true,
  show_shipping_address boolean not null default true,
  show_signature boolean not null default true,
  auto_issue boolean not null default false,
  auto_issue_event text check (auto_issue_event is null or auto_issue_event in ('ORDER_CREATED', 'PAYMENT_CONFIRMED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_invoice_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_year text not null,
  series text not null check (series in ('INV', 'CN')),
  next_number integer not null default 1 check (next_number >= 1),
  primary key (organization_id, financial_year, series)
);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  original_invoice_id uuid references public.sales_invoices(id) on delete restrict,
  document_kind text not null default 'SALES' check (document_kind in ('SALES', 'CREDIT_NOTE')),
  source text not null default 'MANUAL',
  document_type text not null default 'COMMERCIAL_INVOICE'
    check (document_type in ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'COMMERCIAL_INVOICE')),
  tax_source text not null default 'MANUAL' check (tax_source in ('IMPORTED', 'MANUAL', 'CALCULATED')),
  pricing text not null default 'EXCLUSIVE' check (pricing in ('INCLUSIVE', 'EXCLUSIVE')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEW', 'ISSUED', 'CANCELLED')),
  payment_status text not null default 'UNPAID' check (payment_status in ('UNPAID', 'PARTIAL', 'PAID')),
  payment_method text,
  invoice_number text,
  financial_year text,
  invoice_date date,
  currency text not null default 'INR',
  seller_snapshot jsonb not null default '{}'::jsonb,
  billing_snapshot jsonb not null default '{}'::jsonb,
  shipping_snapshot jsonb not null default '{}'::jsonb,
  pos_basis text check (pos_basis is null or pos_basis in ('SHIP_TO', 'BILL_TO')),
  pos_state_code text,
  pos_state_name text,
  subtotal_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  shipping_paise bigint not null default 0,
  shipping_taxable boolean not null default false,
  shipping_rate_bps integer,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  utgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  cess_paise bigint not null default 0,
  round_off_paise bigint not null default 0,
  grand_total_paise bigint not null default 0,
  amount_paid_paise bigint not null default 0,
  cod_collect_paise bigint not null default 0,
  review_reasons jsonb not null default '[]'::jsonb,
  pdf_path text,
  pdf_sha256 text,
  template_id text,
  issued_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_invoices_org_number_uidx
  on public.sales_invoices (organization_id, invoice_number)
  where invoice_number is not null;

create unique index if not exists sales_invoices_one_live_order_uidx
  on public.sales_invoices (organization_id, order_id)
  where status <> 'CANCELLED' and document_kind = 'SALES';

create index if not exists sales_invoices_org_created_idx
  on public.sales_invoices (organization_id, created_at desc);

create index if not exists sales_invoices_org_status_idx
  on public.sales_invoices (organization_id, status, invoice_date desc);

create table if not exists public.sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  source_line_id uuid,
  position integer not null default 0,
  name text not null,
  variant text,
  sku text,
  hsn text,
  quantity integer not null check (quantity <> 0),
  unit text,
  unit_price_paise bigint not null,
  discount_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  rate_bps integer,
  treatment text not null default 'TAXABLE' check (treatment in ('TAXABLE', 'EXEMPT', 'ZERO_RATED')),
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  utgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  cess_paise bigint not null default 0,
  line_total_paise bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sales_invoice_lines_invoice_idx
  on public.sales_invoice_lines (invoice_id, position);

create table if not exists public.sales_invoice_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  action text not null,
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sales_invoice_events_invoice_idx
  on public.sales_invoice_events (invoice_id, created_at);

create or replace function public.allocate_sales_invoice_number(
  p_organization_id uuid,
  p_series text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month integer;
  v_year integer;
  v_start integer;
  v_fy text;
  v_prefix text;
  v_next integer;
  v_number text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;
  if p_series not in ('INV', 'CN') then
    raise exception 'invalid invoice series';
  end if;
  if auth.role() is distinct from 'service_role'
     and not (auth.role() = 'authenticated' and public.is_org_member(p_organization_id)) then
    raise exception 'not authorized';
  end if;

  v_prefix := upper(regexp_replace(coalesce(p_prefix, 'INV'), '[^A-Za-z0-9]', '', 'g'));
  if p_series = 'CN' then
    v_prefix := 'CN';
  end if;
  if length(v_prefix) < 1 or length(v_prefix) > 4 then
    raise exception 'invoice prefix must be 1 to 4 letters or digits';
  end if;

  v_month := extract(month from timezone('Asia/Kolkata', now()))::integer;
  v_year := extract(year from timezone('Asia/Kolkata', now()))::integer;
  if v_month < 4 then
    v_start := v_year - 1;
  else
    v_start := v_year;
  end if;
  v_fy := lpad((v_start % 100)::text, 2, '0') || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');

  insert into public.sales_invoice_counters (organization_id, financial_year, series, next_number)
  values (p_organization_id, v_fy, p_series, 1)
  on conflict (organization_id, financial_year, series)
  do update set next_number = public.sales_invoice_counters.next_number + 1
  returning next_number into v_next;

  v_number := v_prefix || '/' || v_fy || '/' || lpad(v_next::text, 5, '0');
  if length(v_number) > 16 then
    raise exception 'invoice number exceeds 16 characters';
  end if;
  return v_number;
end;
$$;

revoke all on function public.allocate_sales_invoice_number(uuid, text, text) from public;
grant execute on function public.allocate_sales_invoice_number(uuid, text, text) to authenticated, service_role;

create or replace function public.protect_sales_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('ISSUED', 'CANCELLED') then
      raise exception 'issued sales invoices cannot be deleted';
    end if;
    return old;
  end if;

  if new.status = 'ISSUED' and new.invoice_number is null then
    raise exception 'issued sales invoice requires a number';
  end if;

  if tg_op = 'UPDATE' and old.status in ('ISSUED', 'CANCELLED') then
    if old.status = 'CANCELLED' and new.status is distinct from old.status then
      raise exception 'cancelled sales invoice is immutable';
    end if;
    if old.status = 'ISSUED' and new.status not in ('ISSUED', 'CANCELLED') then
      raise exception 'invalid sales invoice status transition';
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.order_id is distinct from old.order_id
       or new.invoice_number is distinct from old.invoice_number
       or new.document_kind is distinct from old.document_kind
       or new.document_type is distinct from old.document_type
       or new.tax_source is distinct from old.tax_source
       or new.pricing is distinct from old.pricing
       or new.seller_snapshot is distinct from old.seller_snapshot
       or new.billing_snapshot is distinct from old.billing_snapshot
       or new.shipping_snapshot is distinct from old.shipping_snapshot
       or new.pos_basis is distinct from old.pos_basis
       or new.pos_state_code is distinct from old.pos_state_code
       or new.subtotal_paise is distinct from old.subtotal_paise
       or new.discount_paise is distinct from old.discount_paise
       or new.shipping_paise is distinct from old.shipping_paise
       or new.taxable_paise is distinct from old.taxable_paise
       or new.cgst_paise is distinct from old.cgst_paise
       or new.sgst_paise is distinct from old.sgst_paise
       or new.utgst_paise is distinct from old.utgst_paise
       or new.igst_paise is distinct from old.igst_paise
       or new.cess_paise is distinct from old.cess_paise
       or new.round_off_paise is distinct from old.round_off_paise
       or new.grand_total_paise is distinct from old.grand_total_paise
       or new.financial_year is distinct from old.financial_year
       or new.invoice_date is distinct from old.invoice_date
    then
      raise exception 'issued sales invoice financial snapshot is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_sales_invoice on public.sales_invoices;
create trigger protect_sales_invoice
  before update or delete on public.sales_invoices
  for each row execute function public.protect_sales_invoice();

create or replace function public.protect_sales_invoice_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_org uuid;
  v_invoice uuid;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);
  select status, organization_id into v_status, v_org
  from public.sales_invoices
  where id = v_invoice;
  if v_org is null then
    raise exception 'sales invoice not found';
  end if;
  if tg_op <> 'DELETE' and new.organization_id is distinct from v_org then
    raise exception 'invoice line organization mismatch';
  end if;
  if v_status in ('ISSUED', 'CANCELLED') then
    raise exception 'issued sales invoice lines are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_sales_invoice_line on public.sales_invoice_lines;
create trigger protect_sales_invoice_line
  before insert or update or delete on public.sales_invoice_lines
  for each row execute function public.protect_sales_invoice_line();

drop trigger if exists set_sales_invoice_settings_updated_at on public.sales_invoice_settings;
create trigger set_sales_invoice_settings_updated_at
  before update on public.sales_invoice_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_sales_invoices_updated_at on public.sales_invoices;
create trigger set_sales_invoices_updated_at
  before update on public.sales_invoices
  for each row execute function public.set_updated_at();

alter table public.sales_invoice_settings enable row level security;
alter table public.sales_invoice_counters enable row level security;
alter table public.sales_invoices enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.sales_invoice_events enable row level security;

drop policy if exists sales_invoice_settings_select on public.sales_invoice_settings;
create policy sales_invoice_settings_select on public.sales_invoice_settings
  for select using (public.is_org_member(organization_id));
drop policy if exists sales_invoice_settings_write on public.sales_invoice_settings;
create policy sales_invoice_settings_write on public.sales_invoice_settings
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists sales_invoice_counters_select on public.sales_invoice_counters;
create policy sales_invoice_counters_select on public.sales_invoice_counters
  for select using (public.is_org_member(organization_id));

drop policy if exists sales_invoices_select on public.sales_invoices;
create policy sales_invoices_select on public.sales_invoices
  for select using (public.is_org_member(organization_id));
drop policy if exists sales_invoices_write on public.sales_invoices;
create policy sales_invoices_write on public.sales_invoices
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists sales_invoice_lines_select on public.sales_invoice_lines;
create policy sales_invoice_lines_select on public.sales_invoice_lines
  for select using (public.is_org_member(organization_id));
drop policy if exists sales_invoice_lines_write on public.sales_invoice_lines;
create policy sales_invoice_lines_write on public.sales_invoice_lines
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists sales_invoice_events_select on public.sales_invoice_events;
create policy sales_invoice_events_select on public.sales_invoice_events
  for select using (public.is_org_member(organization_id));
drop policy if exists sales_invoice_events_insert on public.sales_invoice_events;
create policy sales_invoice_events_insert on public.sales_invoice_events
  for insert with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

revoke update, delete on public.sales_invoice_events from authenticated, anon;

insert into public.sales_invoice_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;
