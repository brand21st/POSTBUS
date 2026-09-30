create index if not exists labels_org_shipment_created_idx
  on public.labels (organization_id, shipment_id, created_at desc);

create or replace function public.label_shipment_groups(
  p_organization_id uuid,
  p_kind text default 'ALL',
  p_limit integer default 20,
  p_offset integer default 0
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
      grouped.latest_at
    from grouped
    where
      case upper(coalesce(p_kind, 'ALL'))
        when 'INDIA_POST' then grouped.has_india
        when 'MERCHANT' then grouped.has_merchant
        when 'COMPLETE' then grouped.has_india and grouped.has_merchant
        when 'INCOMPLETE' then not (grouped.has_india and grouped.has_merchant)
        else true
      end
  )
  select
    filtered.shipment_id,
    filtered.latest_at,
    count(*) over () as total_count
  from filtered
  order by filtered.latest_at desc, filtered.shipment_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.label_shipment_groups(uuid, text, integer, integer) from public;
revoke all on function public.label_shipment_groups(uuid, text, integer, integer) from anon;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer) to authenticated;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer) to service_role;
