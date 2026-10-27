-- Date-filter overload for label_shipment_groups plus dashboard counts.
-- The 5-argument overload is dropped in 20261027180000 so PostgREST can resolve the RPC.

create or replace function public.label_shipment_groups(
  p_organization_id uuid,
  p_kind text default 'ALL',
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
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
      and (p_from is null or grouped.latest_at >= p_from)
      and (p_to is null or grouped.latest_at < p_to)
      and (
        p_search is null
        or length(trim(p_search)) = 0
        or exists (
          select 1
          from public.shipments s
          left join public.orders o on o.id = s.order_id
          where s.id = grouped.shipment_id
            and s.organization_id = p_organization_id
            and (
              coalesce(o.order_number, '') ilike '%' || trim(p_search) || '%'
              or coalesce(s.tracking_number, '') ilike '%' || trim(p_search) || '%'
              or coalesce(s.barcode, '') ilike '%' || trim(p_search) || '%'
            )
        )
      )
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

revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) from public;
revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) from anon;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) to service_role;

create or replace function public.label_dashboard_counts(
  p_organization_id uuid,
  p_timezone text default 'Asia/Kolkata'
)
returns table (total bigint, today bigint, yesterday bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tz text;
  today_start timestamptz;
  tomorrow_start timestamptz;
  yesterday_start timestamptz;
begin
  tz := coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata');
  begin
    perform timezone(tz, now());
  exception
    when others then
      tz := 'Asia/Kolkata';
  end;

  today_start := (date_trunc('day', timezone(tz, now())) at time zone tz);
  tomorrow_start := ((date_trunc('day', timezone(tz, now())) + interval '1 day') at time zone tz);
  yesterday_start := ((date_trunc('day', timezone(tz, now())) - interval '1 day') at time zone tz);

  return query
  with grouped as (
    select l.shipment_id, max(l.created_at) as latest_at
    from public.labels l
    where l.organization_id = p_organization_id
      and l.kind in ('INDIA_POST', 'MERCHANT')
    group by l.shipment_id
  )
  select
    count(*)::bigint,
    count(*) filter (where grouped.latest_at >= today_start and grouped.latest_at < tomorrow_start)::bigint,
    count(*) filter (where grouped.latest_at >= yesterday_start and grouped.latest_at < today_start)::bigint
  from grouped;
end;
$$;

revoke all on function public.label_dashboard_counts(uuid, text) from public;
revoke all on function public.label_dashboard_counts(uuid, text) from anon;
grant execute on function public.label_dashboard_counts(uuid, text) to authenticated;
grant execute on function public.label_dashboard_counts(uuid, text) to service_role;
