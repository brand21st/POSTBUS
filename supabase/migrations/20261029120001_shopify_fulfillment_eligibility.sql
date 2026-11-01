-- Additive Shopify remaining-qty + exact FO line allocations.
-- Does not rewrite existing order_line_items.quantity or shipment history.

alter table public.order_line_items
  add column if not exists unfulfilled_quantity integer,
  add column if not exists source_line_item_id text,
  add column if not exists requires_shipping boolean;

alter table public.order_line_items
  drop constraint if exists order_line_items_unfulfilled_quantity_chk;

alter table public.order_line_items
  add constraint order_line_items_unfulfilled_quantity_chk
  check (unfulfilled_quantity is null or unfulfilled_quantity >= 0);

comment on column public.order_line_items.unfulfilled_quantity is
  'Shopify remaining shippable units. Null means unknown (legacy). Never treat as original quantity.';

create table if not exists public.shopify_shipment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  shopify_order_id text not null,
  shopify_fulfillment_order_id text not null,
  shopify_fulfillment_order_line_item_id text not null,
  shopify_order_line_item_id text,
  quantity integer not null check (quantity > 0),
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'BOOKED', 'RELEASED')),
  article_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipment_id, shopify_fulfillment_order_line_item_id)
);

create index if not exists shopify_shipment_allocations_org_order_idx
  on public.shopify_shipment_allocations (organization_id, order_id);

create index if not exists shopify_shipment_allocations_fo_line_idx
  on public.shopify_shipment_allocations (organization_id, shopify_fulfillment_order_line_item_id, status);

drop trigger if exists shopify_shipment_allocations_updated_at on public.shopify_shipment_allocations;
create trigger shopify_shipment_allocations_updated_at
  before update on public.shopify_shipment_allocations
  for each row execute function public.set_updated_at();

alter table public.shopify_shipment_allocations enable row level security;

drop policy if exists shopify_shipment_allocations_tenant_all on public.shopify_shipment_allocations;
create policy shopify_shipment_allocations_tenant_all
  on public.shopify_shipment_allocations
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
