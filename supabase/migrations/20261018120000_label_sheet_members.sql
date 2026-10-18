create table if not exists public.label_sheet_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (label_id, shipment_id)
);

create index if not exists label_sheet_members_org_shipment_idx
  on public.label_sheet_members (organization_id, shipment_id);

create index if not exists label_sheet_members_org_label_idx
  on public.label_sheet_members (organization_id, label_id);

alter table public.label_sheet_members enable row level security;

drop policy if exists label_sheet_members_tenant_all on public.label_sheet_members;
create policy label_sheet_members_tenant_all on public.label_sheet_members
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop function if exists public.label_shipment_groups(uuid, text, integer, integer);

create or replace function public.label_shipment_groups(
  p_organization_id uuid,
  p_kind text default 'ALL',
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null
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

revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text) from public;
revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text) from anon;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text) to service_role;
