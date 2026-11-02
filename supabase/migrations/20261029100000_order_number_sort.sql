alter table public.orders
  add column if not exists order_number_sort bigint
  generated always as (
    nullif(regexp_replace(order_number, '\D', '', 'g'), '')::bigint
  ) stored;

create index if not exists orders_org_number_sort_idx
  on public.orders (organization_id, order_number_sort desc);
