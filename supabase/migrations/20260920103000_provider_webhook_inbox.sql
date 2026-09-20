create table if not exists public.provider_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.india_post_connections(id) on delete cascade,
  provider text not null default 'INDIA_POST',
  channel text not null check (channel in ('booking', 'events')),
  provider_event_id text,
  tracking_number text,
  event_code text,
  event_timestamp timestamptz,
  payload_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  process_status text not null default 'PENDING'
    check (process_status in ('PENDING', 'PROCESSED', 'FAILED')),
  process_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_webhook_inbox_org_idx
  on public.provider_webhook_inbox (organization_id, received_at desc);

create index if not exists provider_webhook_inbox_status_idx
  on public.provider_webhook_inbox (process_status, received_at);

create unique index if not exists provider_webhook_inbox_hash_uidx
  on public.provider_webhook_inbox (organization_id, payload_hash);

create unique index if not exists provider_webhook_inbox_event_uidx
  on public.provider_webhook_inbox (
    organization_id,
    tracking_number,
    event_code,
    event_timestamp
  )
  where tracking_number is not null
    and event_code is not null
    and event_timestamp is not null;

drop trigger if exists set_provider_webhook_inbox_updated_at on public.provider_webhook_inbox;
create trigger set_provider_webhook_inbox_updated_at
  before update on public.provider_webhook_inbox
  for each row execute function public.set_updated_at();

alter table public.provider_webhook_inbox enable row level security;

drop policy if exists provider_webhook_inbox_tenant_all on public.provider_webhook_inbox;
create policy provider_webhook_inbox_tenant_all on public.provider_webhook_inbox
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
