-- Inventory 2.0: low-stock thresholds, category images, recommendations, analytics RPCs.

alter table public.products
  add column if not exists low_stock_threshold integer not null default 5;

do $$ begin
  alter table public.products
    add constraint products_low_stock_threshold_chk check (low_stock_threshold >= 0 and low_stock_threshold <= 100000);
exception when duplicate_object then null;
end $$;

alter table public.product_categories
  add column if not exists image_path text;

create table if not exists public.product_recommendations (
  product_id uuid not null references public.products(id) on delete cascade,
  related_product_id uuid not null references public.products(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, related_product_id, kind),
  constraint product_recommendations_kind_chk check (kind in ('UPSELL', 'CROSS_SELL')),
  constraint product_recommendations_self_chk check (product_id <> related_product_id)
);

create index if not exists product_recommendations_org_idx
  on public.product_recommendations (organization_id, product_id, kind, sort_order);

alter table public.product_recommendations enable row level security;

drop policy if exists product_recommendations_select on public.product_recommendations;
create policy product_recommendations_select on public.product_recommendations
  for select using (public.is_org_member(organization_id));
drop policy if exists product_recommendations_write on public.product_recommendations;
create policy product_recommendations_write on public.product_recommendations
  for all using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

create or replace function public.inventory_analytics_window(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  total_products bigint,
  active_products bigint,
  total_stock bigint,
  low_stock bigint,
  out_of_stock bigint,
  total_product_value numeric,
  order_count bigint,
  total_sales numeric,
  amount_received numeric,
  pending_amount numeric,
  cod_outstanding numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*)::bigint from public.products p where p.organization_id = p_organization_id) as total_products,
    (
      select count(*)::bigint
      from public.products p
      where p.organization_id = p_organization_id and p.active
    ) as active_products,
    (
      select coalesce(sum(b.on_hand), 0)::bigint
      from public.inventory_balances b
      where b.organization_id = p_organization_id
    ) as total_stock,
    (
      select count(*)::bigint
      from public.inventory_balances b
      join public.products p on p.id = b.product_id
      where b.organization_id = p_organization_id
        and b.on_hand > 0
        and b.on_hand <= coalesce(p.low_stock_threshold, 5)
    ) as low_stock,
    (
      select count(*)::bigint
      from public.inventory_balances b
      where b.organization_id = p_organization_id and b.on_hand = 0
    ) as out_of_stock,
    (
      select coalesce(sum(b.on_hand * p.price), 0)
      from public.inventory_balances b
      join public.products p on p.id = b.product_id
      where b.organization_id = p_organization_id
    ) as total_product_value,
    (
      select count(*)::bigint
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
    ) as order_count,
    (
      select coalesce(sum(o.total_amount), 0)
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
    ) as total_sales,
    (
      select coalesce(sum(o.amount_paid), 0)
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
    ) as amount_received,
    (
      select coalesce(sum(greatest(o.total_amount - coalesce(o.amount_paid, 0), 0)), 0)
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
        and o.payment_status in ('PENDING', 'PARTIAL', 'COD')
    ) as pending_amount,
    (
      select coalesce(sum(coalesce(o.cod_amount, 0)), 0)
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
        and o.payment_status in ('COD', 'PARTIAL')
    ) as cod_outstanding;
$$;

create or replace function public.inventory_top_products(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 8
)
returns table (
  product_id uuid,
  name text,
  sku text,
  units_sold bigint,
  revenue numeric,
  on_hand integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    oli.product_id,
    coalesce(max(p.name), max(oli.title)) as name,
    coalesce(max(p.sku), max(oli.sku)) as sku,
    coalesce(sum(oli.quantity), 0)::bigint as units_sold,
    coalesce(sum(oli.quantity * oli.unit_price), 0) as revenue,
    coalesce(max(b.on_hand), 0)::integer as on_hand
  from public.order_line_items oli
  join public.orders o on o.id = oli.order_id
  left join public.products p on p.id = oli.product_id
  left join public.inventory_balances b on b.product_id = oli.product_id
  where oli.organization_id = p_organization_id
    and o.organization_id = p_organization_id
    and o.created_at >= p_from
    and o.created_at <= p_to
    and oli.product_id is not null
  group by oli.product_id
  order by revenue desc, units_sold desc
  limit greatest(1, least(coalesce(p_limit, 8), 24));
$$;

create or replace function public.inventory_low_stock_products(
  p_organization_id uuid,
  p_limit integer default 8
)
returns table (
  product_id uuid,
  name text,
  sku text,
  on_hand integer,
  low_stock_threshold integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id as product_id,
    p.name,
    p.sku,
    b.on_hand,
    p.low_stock_threshold
  from public.products p
  join public.inventory_balances b on b.product_id = p.id
  where p.organization_id = p_organization_id
    and b.organization_id = p_organization_id
    and (
      b.on_hand = 0
      or (b.on_hand > 0 and b.on_hand <= coalesce(p.low_stock_threshold, 5))
    )
  order by b.on_hand asc, p.name asc
  limit greatest(1, least(coalesce(p_limit, 8), 24));
$$;

revoke all on function public.inventory_analytics_window(uuid, timestamptz, timestamptz) from public;
revoke all on function public.inventory_analytics_window(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.inventory_analytics_window(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.inventory_analytics_window(uuid, timestamptz, timestamptz) to service_role;

revoke all on function public.inventory_top_products(uuid, timestamptz, timestamptz, integer) from public;
revoke all on function public.inventory_top_products(uuid, timestamptz, timestamptz, integer) from anon;
grant execute on function public.inventory_top_products(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.inventory_top_products(uuid, timestamptz, timestamptz, integer) to service_role;

revoke all on function public.inventory_low_stock_products(uuid, integer) from public;
revoke all on function public.inventory_low_stock_products(uuid, integer) from anon;
grant execute on function public.inventory_low_stock_products(uuid, integer) to authenticated;
grant execute on function public.inventory_low_stock_products(uuid, integer) to service_role;
