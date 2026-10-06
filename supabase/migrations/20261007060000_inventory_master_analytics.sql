-- Inventory master analytics and category content.
-- Qualifying sales exclude FAILED and CANCELLED orders. This rule is shared by
-- overview totals, product order counts, units sold, revenue, and best sellers.

alter table public.product_categories
  add column if not exists description text;

alter table public.storefront_settings
  add column if not exists seo_title text,
  add column if not exists seo_description text;

alter table public.products
  add column if not exists public_slug text;

update public.products
set public_slug =
  coalesce(
    nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
    'product'
  ) || '-' || right(replace(id::text, '-', ''), 6)
where public_slug is null or public_slug = '';

create unique index if not exists products_org_public_slug_uidx
  on public.products (organization_id, public_slug);

create table if not exists public.storefront_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  product_id uuid references public.products(id) on delete set null,
  quantity integer,
  value numeric(14,2),
  session_id text,
  created_at timestamptz not null default now(),
  constraint storefront_events_type_chk check (
    event_type in ('PRODUCT_VIEW', 'PRODUCT_CLICK', 'ADD_TO_CART', 'CART_OPENED', 'CHECKOUT_STARTED', 'PURCHASE')
  ),
  constraint storefront_events_quantity_chk check (quantity is null or quantity > 0)
);

create index if not exists storefront_events_org_created_idx
  on public.storefront_events (organization_id, created_at desc);

alter table public.storefront_events enable row level security;
drop policy if exists storefront_events_select on public.storefront_events;
create policy storefront_events_select on public.storefront_events
  for select using (public.is_org_member(organization_id));

create index if not exists order_line_items_org_product_order_idx
  on public.order_line_items (organization_id, product_id, order_id)
  where product_id is not null;

create index if not exists orders_org_status_created_idx
  on public.orders (organization_id, status, created_at);

drop function if exists public.inventory_analytics_window(uuid, timestamptz, timestamptz);
create function public.inventory_analytics_window(
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
  total_units_sold bigint,
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
  with qualifying_orders as (
    select o.id, o.total_amount, o.amount_paid, o.cod_amount, o.payment_status
    from public.orders o
    where o.organization_id = p_organization_id
      and o.created_at >= p_from
      and o.created_at <= p_to
      and o.status not in ('FAILED', 'CANCELLED')
  )
  select
    (select count(*)::bigint from public.products p where p.organization_id = p_organization_id),
    (select count(*)::bigint from public.products p where p.organization_id = p_organization_id and p.active),
    (select coalesce(sum(b.on_hand), 0)::bigint from public.inventory_balances b where b.organization_id = p_organization_id),
    (
      select count(*)::bigint
      from public.inventory_balances b
      join public.products p on p.id = b.product_id
      where b.organization_id = p_organization_id
        and b.on_hand > 0
        and b.on_hand <= p.low_stock_threshold
    ),
    (select count(*)::bigint from public.inventory_balances b where b.organization_id = p_organization_id and b.on_hand <= 0),
    (
      select coalesce(sum(b.on_hand * p.price), 0)
      from public.inventory_balances b
      join public.products p on p.id = b.product_id
      where b.organization_id = p_organization_id
    ),
    (select count(*)::bigint from qualifying_orders),
    (
      select coalesce(sum(li.quantity), 0)::bigint
      from public.order_line_items li
      join qualifying_orders o on o.id = li.order_id
      where li.organization_id = p_organization_id and li.product_id is not null
    ),
    (select coalesce(sum(o.total_amount), 0) from qualifying_orders o),
    (select coalesce(sum(o.amount_paid), 0) from qualifying_orders o),
    (
      select coalesce(sum(greatest(o.total_amount - coalesce(o.amount_paid, 0), 0)), 0)
      from qualifying_orders o
      where o.payment_status in ('PENDING', 'PARTIAL', 'COD')
    ),
    (
      select coalesce(sum(coalesce(o.cod_amount, 0)), 0)
      from qualifying_orders o
      where o.payment_status in ('COD', 'PARTIAL')
    );
$$;

drop function if exists public.inventory_top_products(uuid, timestamptz, timestamptz, integer);
create function public.inventory_top_products(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 8
)
returns table (
  product_id uuid,
  name text,
  sku text,
  order_count bigint,
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
    oli.product_id as product_id,
    coalesce(max(p.name), max(oli.title)) as name,
    coalesce(max(p.sku), max(oli.sku)) as sku,
    count(distinct o.id)::bigint as order_count,
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
    and o.status not in ('FAILED', 'CANCELLED')
    and oli.product_id is not null
  group by oli.product_id
  order by units_sold desc, revenue desc, product_id
  limit greatest(1, least(coalesce(p_limit, 8), 24));
$$;

create or replace function public.inventory_product_page(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_query text default null,
  p_active boolean default null,
  p_store_visible boolean default null,
  p_category_id uuid default null,
  p_stock_state text default null,
  p_prepaid_enabled boolean default null,
  p_cod_enabled boolean default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_stock_min integer default null,
  p_stock_max integer default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_updated_from timestamptz default null,
  p_updated_to timestamptz default null,
  p_best_seller boolean default null,
  p_sort text default 'newest',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  product_id uuid,
  order_count bigint,
  units_sold bigint,
  revenue numeric,
  sales_rank bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with sales as (
    select
      li.product_id,
      count(distinct o.id)::bigint as order_count,
      coalesce(sum(li.quantity), 0)::bigint as units_sold,
      coalesce(sum(li.quantity * li.unit_price), 0) as revenue
    from public.order_line_items li
    join public.orders o on o.id = li.order_id
    where li.organization_id = p_organization_id
      and o.organization_id = p_organization_id
      and o.created_at >= p_from
      and o.created_at <= p_to
      and o.status not in ('FAILED', 'CANCELLED')
      and li.product_id is not null
    group by li.product_id
  ),
  ranked as (
    select
      p.id,
      p.name,
      p.price,
      p.created_at,
      p.updated_at,
      coalesce(b.on_hand, 0) as on_hand,
      coalesce(s.order_count, 0)::bigint as order_count,
      coalesce(s.units_sold, 0)::bigint as units_sold,
      coalesce(s.revenue, 0) as revenue,
      case
        when coalesce(s.units_sold, 0) > 0
        then dense_rank() over (order by coalesce(s.units_sold, 0) desc, coalesce(s.revenue, 0) desc, p.id)
        else null
      end as sales_rank
    from public.products p
    left join public.inventory_balances b
      on b.product_id = p.id and b.organization_id = p_organization_id
    left join sales s on s.product_id = p.id
    where p.organization_id = p_organization_id
      and (p_query is null or p_query = '' or p.name ilike '%' || p_query || '%' or p.sku ilike '%' || p_query || '%')
      and (p_active is null or p.active = p_active)
      and (p_store_visible is null or p.store_visible = p_store_visible)
      and (p_prepaid_enabled is null or p.prepaid_enabled = p_prepaid_enabled)
      and (p_cod_enabled is null or p.cod_enabled = p_cod_enabled)
      and (p_price_min is null or p.price >= p_price_min)
      and (p_price_max is null or p.price <= p_price_max)
      and (p_stock_min is null or coalesce(b.on_hand, 0) >= p_stock_min)
      and (p_stock_max is null or coalesce(b.on_hand, 0) <= p_stock_max)
      and (p_created_from is null or p.created_at >= p_created_from)
      and (p_created_to is null or p.created_at <= p_created_to)
      and (p_updated_from is null or p.updated_at >= p_updated_from)
      and (p_updated_to is null or p.updated_at <= p_updated_to)
      and (
        p_category_id is null
        or exists (
          select 1 from public.product_category_members pcm
          where pcm.organization_id = p_organization_id
            and pcm.product_id = p.id
            and pcm.category_id = p_category_id
        )
      )
      and (
        p_stock_state is null or p_stock_state = 'all'
        or (p_stock_state = 'outOfStock' and coalesce(b.on_hand, 0) <= 0)
        or (p_stock_state = 'lowStock' and coalesce(b.on_hand, 0) > 0 and coalesce(b.on_hand, 0) <= p.low_stock_threshold)
        or (p_stock_state = 'inStock' and coalesce(b.on_hand, 0) > p.low_stock_threshold)
      )
  ),
  filtered as (
    select * from ranked
    where p_best_seller is null
      or (p_best_seller and sales_rank between 1 and 3)
      or (not p_best_seller and sales_rank is distinct from 1 and sales_rank is distinct from 2 and sales_rank is distinct from 3)
  )
  select
    f.id,
    f.order_count,
    f.units_sold,
    f.revenue,
    f.sales_rank,
    count(*) over()::bigint
  from filtered f
  order by
    case when p_sort = 'oldest' then f.created_at end asc,
    case when p_sort = 'nameAsc' then f.name end asc,
    case when p_sort = 'nameDesc' then f.name end desc,
    case when p_sort = 'priceAsc' then f.price end asc,
    case when p_sort = 'priceDesc' then f.price end desc,
    case when p_sort = 'stockAsc' then f.on_hand end asc,
    case when p_sort = 'stockDesc' then f.on_hand end desc,
    case when p_sort = 'orders' then f.order_count end desc,
    case when p_sort in ('units', 'bestSeller') then f.units_sold end desc,
    case when p_sort in ('orders', 'units', 'bestSeller') then f.revenue end desc,
    case when p_sort = 'updated' then f.updated_at end desc,
    case when p_sort = 'newest' or p_sort is null then f.created_at end desc,
    f.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.inventory_analytics_window(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.inventory_analytics_window(uuid, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public.inventory_top_products(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.inventory_top_products(uuid, timestamptz, timestamptz, integer) to authenticated, service_role;

revoke all on function public.inventory_product_page(
  uuid, timestamptz, timestamptz, text, boolean, boolean, uuid, text, boolean,
  boolean, numeric, numeric, integer, integer, timestamptz, timestamptz,
  timestamptz, timestamptz, boolean, text, integer, integer
) from public, anon;
grant execute on function public.inventory_product_page(
  uuid, timestamptz, timestamptz, text, boolean, boolean, uuid, text, boolean,
  boolean, numeric, numeric, integer, integer, timestamptz, timestamptz,
  timestamptz, timestamptz, boolean, text, integer, integer
) to authenticated, service_role;
