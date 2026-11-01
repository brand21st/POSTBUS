-- Isolated staging tables for Shopify line-item compatibility checks.
-- Not production. No merchant data. Asserted via scripts/staging/assert-not-production.mjs.

do $$ begin
  create type public.order_source as enum ('MANUAL','SHOPIFY','WOOCOMMERCE','WHATSAPP','API');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_status as enum ('PENDING','PAID','COD','PARTIAL','REFUNDED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.fulfillment_status as enum ('UNFULFILLED','PARTIAL','FULFILLED','CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_status as enum (
    'IMPORTED','READY','PROCESSING','BOOKED','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source public.order_source not null default 'SHOPIFY',
  source_order_id text,
  order_number text not null,
  currency text not null default 'INR',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_status public.payment_status not null default 'PENDING',
  fulfillment_status public.fulfillment_status not null default 'UNFULFILLED',
  status public.order_status not null default 'READY',
  amount_paid numeric(12,2) not null default 0,
  cod_amount numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists source public.order_source;
alter table public.orders add column if not exists source_order_id text;
alter table public.orders add column if not exists order_number text;
alter table public.orders add column if not exists currency text;
alter table public.orders add column if not exists subtotal numeric(12,2);
alter table public.orders add column if not exists total_amount numeric(12,2);
alter table public.orders add column if not exists payment_status public.payment_status;
alter table public.orders add column if not exists fulfillment_status public.fulfillment_status;
alter table public.orders add column if not exists status public.order_status;
alter table public.orders add column if not exists amount_paid numeric(12,2);
alter table public.orders add column if not exists cod_amount numeric(12,2);
alter table public.orders add column if not exists metadata jsonb;

alter table public.shipments add column if not exists order_id uuid;
alter table public.shipments add column if not exists payment_mode text;
alter table public.shipments add column if not exists weight_grams integer;
alter table public.shipments add column if not exists length_cm numeric;
alter table public.shipments add column if not exists width_cm numeric;
alter table public.shipments add column if not exists height_cm numeric;
alter table public.shipments add column if not exists barcode text;
alter table public.shipments add column if not exists booked_at timestamptz;

create table if not exists public.order_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  title text not null,
  sku text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  weight_grams integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  document_kind text not null default 'SALES',
  status text not null default 'DRAFT',
  lines jsonb not null default '[]'::jsonb,
  grand_total numeric(12,2) not null default 0
);
