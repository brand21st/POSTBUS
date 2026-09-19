do $$
begin
  if not exists (select 1 from pg_type where typname = 'tracking_page_status') then
    create type public.tracking_page_status as enum ('DRAFT', 'PUBLISHED', 'DISABLED');
  end if;
end $$;

create table if not exists public.tracking_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  subdomain text not null unique,
  status public.tracking_page_status not null default 'DRAFT',
  store_name text not null,
  tagline text,
  about text,
  logo_path text,
  primary_color text not null default '#E11D48',
  background_color text not null default '#FFFFFF',
  location_name text,
  line1 text,
  line2 text,
  city text,
  state text,
  pincode text,
  phone text,
  email text,
  whatsapp text,
  map_url text,
  social jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_pages_subdomain_format check (
    subdomain ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'
  ),
  constraint tracking_pages_subdomain_reserved check (
    subdomain not in (
      'www','app','api','mail','admin','dashboard','auth','cdn','static','postbus','status'
    )
  )
);

create table if not exists public.tracking_page_banners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracking_page_id uuid not null references public.tracking_pages(id) on delete cascade,
  sort_order integer not null default 0,
  image_path text not null,
  href text,
  alt text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracking_pages_status_idx on public.tracking_pages (status, subdomain);
create index if not exists tracking_page_banners_page_idx on public.tracking_page_banners (tracking_page_id, sort_order);

delete from public.tracking_events a
using public.tracking_events b
where a.id > b.id
  and a.organization_id = b.organization_id
  and a.shipment_id = b.shipment_id
  and a.event_code = b.event_code
  and a.occurred_at = b.occurred_at;

create unique index if not exists tracking_events_dedupe_uidx
  on public.tracking_events (organization_id, shipment_id, event_code, occurred_at);

drop trigger if exists set_tracking_pages_updated_at on public.tracking_pages;
create trigger set_tracking_pages_updated_at
  before update on public.tracking_pages
  for each row execute function public.set_updated_at();

drop trigger if exists set_tracking_page_banners_updated_at on public.tracking_page_banners;
create trigger set_tracking_page_banners_updated_at
  before update on public.tracking_page_banners
  for each row execute function public.set_updated_at();

alter table public.tracking_pages enable row level security;
alter table public.tracking_page_banners enable row level security;

drop policy if exists tracking_pages_tenant_all on public.tracking_pages;
create policy tracking_pages_tenant_all on public.tracking_pages
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists tracking_pages_public_read on public.tracking_pages;
create policy tracking_pages_public_read on public.tracking_pages
  for select using (status = 'PUBLISHED');

drop policy if exists tracking_page_banners_tenant_all on public.tracking_page_banners;
create policy tracking_page_banners_tenant_all on public.tracking_page_banners
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists tracking_page_banners_public_read on public.tracking_page_banners;
create policy tracking_page_banners_public_read on public.tracking_page_banners
  for select using (
    enabled = true
    and exists (
      select 1 from public.tracking_pages p
      where p.id = tracking_page_id
        and p.status = 'PUBLISHED'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tracking-pages',
  'tracking-pages',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

drop policy if exists tracking_pages_storage_select on storage.objects;
create policy tracking_pages_storage_select on storage.objects
  for select using (bucket_id = 'tracking-pages');

drop policy if exists tracking_pages_storage_write on storage.objects;
create policy tracking_pages_storage_write on storage.objects
  for insert with check (
    bucket_id = 'tracking-pages'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists tracking_pages_storage_update on storage.objects;
create policy tracking_pages_storage_update on storage.objects
  for update using (
    bucket_id = 'tracking-pages'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

create or replace function public.public_find_shipment(p_organization_id uuid, p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_events jsonb;
  v_city text;
  v_state text;
  v_order text;
begin
  if p_query is null or length(trim(p_query)) < 6 then
    return null;
  end if;

  select s.*, o.order_number
    into v_shipment
  from public.shipments s
  left join public.orders o on o.id = s.order_id
  where s.organization_id = p_organization_id
    and (
      s.barcode = trim(p_query)
      or s.tracking_number = trim(p_query)
    )
  limit 1;

  if not found then
    return null;
  end if;

  select a.city, a.state into v_city, v_state
  from public.addresses a
  where a.id = v_shipment.shipping_address_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'eventCode', e.event_code,
    'eventDescription', e.event_description,
    'officeName', e.office_name,
    'occurredAt', e.occurred_at
  ) order by e.occurred_at desc), '[]'::jsonb)
    into v_events
  from public.tracking_events e
  where e.shipment_id = v_shipment.id;

  return jsonb_build_object(
    'id', v_shipment.id,
    'barcode', v_shipment.barcode,
    'trackingNumber', v_shipment.tracking_number,
    'status', v_shipment.status,
    'orderNumber', v_shipment.order_number,
    'destinationCity', v_city,
    'destinationState', v_state,
    'events', v_events
  );
end;
$$;

create or replace function public.public_insert_tracking_event(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_event_code text,
  p_event_description text,
  p_office_name text,
  p_occurred_at timestamptz,
  p_raw jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.shipments
    where id = p_shipment_id and organization_id = p_organization_id
  ) then
    return;
  end if;

  insert into public.tracking_events (
    organization_id, shipment_id, event_code, event_description, office_name, occurred_at, raw
  ) values (
    p_organization_id, p_shipment_id, p_event_code, p_event_description, p_office_name, p_occurred_at, coalesce(p_raw, '{}'::jsonb)
  )
  on conflict (organization_id, shipment_id, event_code, occurred_at) do nothing;
end;
$$;

revoke all on function public.public_find_shipment(uuid, text) from public;
grant execute on function public.public_find_shipment(uuid, text) to anon, authenticated;

revoke all on function public.public_insert_tracking_event(uuid, uuid, text, text, text, timestamptz, jsonb) from public;
grant execute on function public.public_insert_tracking_event(uuid, uuid, text, text, text, timestamptz, jsonb) to anon, authenticated;
