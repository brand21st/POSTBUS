-- Sort label shipment groups by numeric order id. Drop the 7-arg overload so PostgREST
-- can resolve the RPC after adding p_sort.

drop function if exists public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz);

create or replace function public.label_shipment_groups(
  p_organization_id uuid,
  p_kind text default 'ALL',
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sort text default null
)
returns table (shipment_id uuid, latest_at timestamptz, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with grouped as (
    select
      l.shipment_id,
      max(l.created_at) as latest_at,
      bool_or(l.kind = 'INDIA_POST') as has_india,
      bool_or(l.kind = 'MERCHANT') as has_merchant
    from public.labels l
    where l.organization_id = p_organization_id
      and l.kind in ('INDIA_POST', 'MERCHANT')
    group by l.shipment_id
  ),
  filtered as (
    select
      grouped.shipment_id,
      grouped.latest_at,
      o.order_number,
      o.order_number_sort
    from grouped
    left join public.shipments s
      on s.id = grouped.shipment_id
     and s.organization_id = p_organization_id
    left join public.orders o
      on o.id = s.order_id
    where
      case upper(coalesce(p_kind, 'ALL'))
        when 'INDIA_POST' then grouped.has_india
        when 'MERCHANT' then grouped.has_merchant
        when 'COMPLETE' then grouped.has_india and grouped.has_merchant
        when 'INCOMPLETE' then not (grouped.has_india and grouped.has_merchant)
        else true
      end
      and (p_from is null or grouped.latest_at >= p_from)
      and (p_to is null or grouped.latest_at < p_to)
      and (
        p_search is null
        or length(trim(p_search)) = 0
        or exists (
          select 1
          from public.shipments search_s
          left join public.orders search_o on search_o.id = search_s.order_id
          where search_s.id = grouped.shipment_id
            and search_s.organization_id = p_organization_id
            and (
              coalesce(search_o.order_number, '') ilike '%' || trim(p_search) || '%'
              or coalesce(search_s.tracking_number, '') ilike '%' || trim(p_search) || '%'
              or coalesce(search_s.barcode, '') ilike '%' || trim(p_search) || '%'
            )
        )
      )
  )
  select
    filtered.shipment_id,
    filtered.latest_at,
    count(*) over () as total_count
  from filtered
  order by
    case when p_sort = 'order_number' then filtered.order_number_sort end asc nulls last,
    case when p_sort = '-order_number' then filtered.order_number_sort end desc nulls last,
    case when p_sort = 'order_number' then filtered.order_number end asc nulls last,
    case when p_sort = '-order_number' then filtered.order_number end desc nulls last,
    case when p_sort = 'created_at' then filtered.latest_at end asc nulls last,
    case when p_sort is distinct from 'created_at' then filtered.latest_at end desc,
    filtered.shipment_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz, text) from public;
revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz, text) from anon;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz, text) to service_role;
