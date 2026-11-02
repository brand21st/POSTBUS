-- Merchant outbound webhook outbox and delivery retries.
-- Additive. Do not apply to production from local development.

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  resource_type text not null,
  resource_id uuid,
  dedupe_key text not null,
  payload jsonb not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  constraint webhook_events_status_check check (status in ('PENDING', 'DISPATCHED', 'SKIPPED')),
  constraint webhook_events_dedupe_key unique (dedupe_key)
);

comment on table public.webhook_events is
  'Transactional-style outbox. Writers insert after the business row commits. Delivery is asynchronous.';

create index if not exists webhook_events_pending_idx
  on public.webhook_events (organization_id, created_at)
  where status = 'PENDING';

alter table public.webhook_endpoints
  add column if not exists description text,
  add column if not exists disabled_at timestamptz;

alter table public.webhook_deliveries
  add column if not exists event_id text,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists response_excerpt text;

create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries (organization_id, next_attempt_at)
  where status in ('PENDING', 'RETRYING');

alter table public.webhook_events enable row level security;

drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events
  for select using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );
