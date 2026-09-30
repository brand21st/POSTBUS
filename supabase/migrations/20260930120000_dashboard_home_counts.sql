-- Dashboard home KPIs + pipeline: one round-trip per window / group-by instead of many PostgREST COUNT heads.
-- SECURITY INVOKER so RLS still applies. Callers must pass their tenant organization_id.

create or replace function public.dashboard_kpi_window(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  orders bigint,
  ready bigint,
  booked bigint,
  in_transit bigint,
  delivered bigint,
  failed bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (
      select count(*)::bigint
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
    ) as orders,
    (
      select count(*)::bigint
      from public.orders o
      where o.organization_id = p_organization_id
        and o.created_at >= p_from
        and o.created_at <= p_to
        and o.status = 'READY'
    ) as ready,
    (
      select count(*)::bigint
      from public.shipments s
      where s.organization_id = p_organization_id
        and s.created_at >= p_from
        and s.created_at <= p_to
        and s.status in ('BOOKED', 'LABEL_READY', 'MANIFEST_READY')
    ) as booked,
    (
      select count(*)::bigint
      from public.shipments s
      where s.organization_id = p_organization_id
        and s.created_at >= p_from
        and s.created_at <= p_to
        and s.status in ('IN_TRANSIT', 'OUT_FOR_DELIVERY')
    ) as in_transit,
    (
      select count(*)::bigint
      from public.shipments s
      where s.organization_id = p_organization_id
        and s.created_at >= p_from
        and s.created_at <= p_to
        and s.status = 'DELIVERED'
    ) as delivered,
    (
      select count(*)::bigint
      from public.shipments s
      where s.organization_id = p_organization_id
        and s.created_at >= p_from
        and s.created_at <= p_to
        and s.status = 'FAILED'
    ) as failed;
$$;

create or replace function public.dashboard_pipeline_counts(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (status text, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select o.status, count(*)::bigint as total
  from public.orders o
  where o.organization_id = p_organization_id
    and o.created_at >= p_from
    and o.created_at <= p_to
    and o.status in (
      'IMPORTED',
      'READY',
      'PROCESSING',
      'BOOKED',
      'SHIPPED',
      'IN_TRANSIT',
      'DELIVERED'
    )
  group by o.status;
$$;

revoke all on function public.dashboard_kpi_window(uuid, timestamptz, timestamptz) from public;
revoke all on function public.dashboard_kpi_window(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.dashboard_kpi_window(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.dashboard_kpi_window(uuid, timestamptz, timestamptz) to service_role;

revoke all on function public.dashboard_pipeline_counts(uuid, timestamptz, timestamptz) from public;
revoke all on function public.dashboard_pipeline_counts(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.dashboard_pipeline_counts(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.dashboard_pipeline_counts(uuid, timestamptz, timestamptz) to service_role;
