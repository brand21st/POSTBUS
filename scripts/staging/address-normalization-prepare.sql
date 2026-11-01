-- Isolated staging only. Minimal tables so 20261030143000 can run.
-- No production. No merchant PII.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid,
  kind text not null default 'shipping',
  name text,
  phone text,
  line1 text not null default '',
  line2 text,
  city text not null default '',
  state text not null default '',
  pincode text not null default '',
  country text not null default 'IN'
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipping_address_id uuid,
  order_number text
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action text not null,
  entity_type text,
  entity_id uuid
);

alter table public.shipments add column if not exists order_id uuid;
alter table public.shipments add column if not exists tracking_number text;
