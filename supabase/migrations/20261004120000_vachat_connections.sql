-- vachat_connections: PostBus → Vachat WhatsApp client (parallel to WATI)

create table if not exists public.vachat_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  encrypted_api_key text,
  api_base_url text not null default 'https://cloud.vachat.in',
  webhook_secret_encrypted text,
  status public.integration_status not null default 'NOT_CONNECTED',
  last_verified_at timestamptz,
  last_error text,
  last_webhook_at timestamptz,
  last_webhook_event text,
  last_webhook_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vachat_connections_org_idx on public.vachat_connections (organization_id);

alter table public.vachat_connections enable row level security;

drop policy if exists vachat_connections_select on public.vachat_connections;
create policy vachat_connections_select on public.vachat_connections
  for select using (public.is_org_member(organization_id));

drop policy if exists vachat_connections_write on public.vachat_connections;
create policy vachat_connections_write on public.vachat_connections
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop trigger if exists set_vachat_connections_updated_at on public.vachat_connections;
create trigger set_vachat_connections_updated_at
  before update on public.vachat_connections
  for each row execute function public.set_updated_at();

comment on table public.vachat_connections is
  'Per-org Vachat API credentials. Plaintext keys are never returned.';
