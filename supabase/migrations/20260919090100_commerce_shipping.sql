create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  kind text not null default 'shipping',
  name text,
  phone text,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  pincode text not null,
  country text not null default 'IN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pickup_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  pincode text not null,
  office_id text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source public.order_source not null default 'MANUAL',
  source_order_id text,
  order_number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  billing_address_id uuid references public.addresses(id) on delete set null,
  shipping_address_id uuid references public.addresses(id) on delete set null,
  currency text not null default 'INR',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_status public.payment_status not null default 'PENDING',
  fulfillment_status public.fulfillment_status not null default 'UNFULFILLED',
  status public.order_status not null default 'IMPORTED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.external_order_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  source public.order_source not null,
  source_order_id text not null,
  shop_domain text,
  created_at timestamptz not null default now(),
  unique (organization_id, source, source_order_id)
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  pickup_location_id uuid references public.pickup_locations(id) on delete set null,
  shipping_address_id uuid references public.addresses(id) on delete set null,
  service_code text not null default 'SP_INLAND_PARCEL',
  payment_mode text not null default 'PREPAID',
  cod_amount numeric(12,2) not null default 0,
  weight_grams integer not null,
  length_cm numeric(10,3),
  width_cm numeric(10,3),
  height_cm numeric(10,3),
  barcode text,
  tracking_number text,
  status public.shipment_status not null default 'DRAFT',
  provider text not null default 'INDIA_POST',
  provider_ref text,
  tariff_amount numeric(12,2),
  last_error text,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  booked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipment_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  weight_grams integer not null,
  length_cm numeric(10,3),
  width_cm numeric(10,3),
  height_cm numeric(10,3),
  created_at timestamptz not null default now()
);

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  file_path text,
  file_url text,
  mime_type text not null default 'application/pdf',
  checksum text,
  status public.label_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pickup_location_id uuid references public.pickup_locations(id) on delete set null,
  name text not null,
  status text not null default 'PENDING',
  file_path text,
  file_url text,
  shipment_count integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manifest_shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manifest_id uuid not null references public.manifests(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  unique (manifest_id, shipment_id)
);

create table if not exists public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  event_code text not null,
  event_description text,
  office_name text,
  office_id text,
  occurred_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customers_org_idx on public.customers (organization_id);
create index if not exists addresses_org_idx on public.addresses (organization_id);
create index if not exists pickup_locations_org_idx on public.pickup_locations (organization_id);
create unique index if not exists orders_org_number_idx on public.orders (organization_id, order_number);
create index if not exists orders_org_status_idx on public.orders (organization_id, status);
create index if not exists orders_org_created_idx on public.orders (organization_id, created_at desc);
create index if not exists order_items_org_idx on public.order_line_items (organization_id, order_id);
create index if not exists shipments_org_status_idx on public.shipments (organization_id, status);
create index if not exists shipments_org_created_idx on public.shipments (organization_id, created_at desc);
create unique index if not exists shipments_org_barcode_uidx on public.shipments (organization_id, barcode) where barcode is not null;
create unique index if not exists shipments_org_tracking_uidx on public.shipments (organization_id, tracking_number) where tracking_number is not null;
create index if not exists labels_org_idx on public.labels (organization_id, created_at desc);
create index if not exists manifests_org_idx on public.manifests (organization_id, created_at desc);
create index if not exists tracking_org_idx on public.tracking_events (organization_id, shipment_id, occurred_at);
