create table if not exists public.wati_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  encrypted_api_token text,
  api_base_url text not null default 'https://live-mt-server.wati.io',
  channel_id text,
  channel_name text,
  channel_phone text,
  booked_template_name text,
  in_transit_template_name text,
  delivered_template_name text,
  status public.integration_status not null default 'NOT_CONNECTED',
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wati_connections_org_idx on public.wati_connections (organization_id);

alter table public.wati_connections enable row level security;

drop policy if exists wati_connections_select on public.wati_connections;
create policy wati_connections_select on public.wati_connections
  for select using (public.is_org_member(organization_id));

drop policy if exists wati_connections_write on public.wati_connections;
create policy wati_connections_write on public.wati_connections
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop trigger if exists set_wati_connections_updated_at on public.wati_connections;
create trigger set_wati_connections_updated_at
  before update on public.wati_connections
  for each row execute function public.set_updated_at();
