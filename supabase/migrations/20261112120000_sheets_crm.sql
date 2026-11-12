-- Super Admin Google Sheets CRM.
-- Config lives on the platform_settings singleton. The outbox is not background_jobs:
-- a signup can exist before any organization row, and background_jobs.organization_id is required.
-- Service role only. Payloads must never include credentials.

alter table public.platform_settings
  add column if not exists sheets_crm_enabled boolean not null default false,
  add column if not exists sheets_crm_webapp_url text,
  add column if not exists encrypted_sheets_crm_secret text,
  add column if not exists sheets_crm_last_success_at timestamptz,
  add column if not exists sheets_crm_last_error text,
  add column if not exists sheets_crm_synced_count integer not null default 0,
  add column if not exists sheets_crm_failed_count integer not null default 0,
  add column if not exists sheets_crm_last_full_sync_at timestamptz,
  add column if not exists sheets_crm_abandon_cursor timestamptz,
  add column if not exists sheets_crm_no_workspace_hours integer not null default 24,
  add column if not exists sheets_crm_india_post_hours integer not null default 24,
  add column if not exists sheets_crm_onboarding_hours integer not null default 48,
  add column if not exists sheets_crm_inactive_days integer not null default 7;

create table if not exists public.sheets_crm_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event_type text not null,
  customer_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  dedupe_key text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  last_error text,
  force boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sheets_crm_outbox_claim_idx
  on public.sheets_crm_outbox (status, next_attempt_at, created_at);

create table if not exists public.sheets_crm_projections (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  lifecycle text not null default 'signup'
    check (lifecycle in ('signup', 'onboarding', 'active', 'abandoned', 'recovered')),
  abandon_reason text,
  last_completed_step text,
  lead_status text,
  projection_hash text,
  workspace_count integer not null default 0,
  onboarding_completed_at timestamptz,
  last_synced_at timestamptz,
  last_activity_enqueued_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.sheets_crm_sync_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text,
  event_type text,
  customer_id uuid,
  status text not null,
  retry_count integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists sheets_crm_sync_logs_created_idx
  on public.sheets_crm_sync_logs (created_at desc);

alter table public.sheets_crm_outbox enable row level security;
alter table public.sheets_crm_projections enable row level security;
alter table public.sheets_crm_sync_logs enable row level security;

revoke all on table public.sheets_crm_outbox from public, anon, authenticated;
revoke all on table public.sheets_crm_projections from public, anon, authenticated;
revoke all on table public.sheets_crm_sync_logs from public, anon, authenticated;

grant select, insert, update, delete on table public.sheets_crm_outbox to service_role;
grant select, insert, update, delete on table public.sheets_crm_projections to service_role;
grant select, insert, update, delete on table public.sheets_crm_sync_logs to service_role;

create or replace function public.claim_sheets_crm_outbox(p_limit integer default 50)
returns setof public.sheets_crm_outbox
language sql
security definer
set search_path = public
as $$
  update public.sheets_crm_outbox as j
  set status = 'PROCESSING',
      locked_at = now(),
      attempt_count = j.attempt_count + 1,
      updated_at = now()
  where j.id in (
    select c.id
    from public.sheets_crm_outbox c
    where c.attempt_count < c.max_attempts
      and (
        (
          c.status in ('PENDING', 'FAILED')
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
        )
        or (
          c.status = 'PROCESSING'
          and c.locked_at is not null
          and c.locked_at < now() - interval '15 minutes'
        )
      )
    order by c.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 50))
    for update skip locked
  )
  returning j.*;
$$;

revoke all on function public.claim_sheets_crm_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_sheets_crm_outbox(integer) to service_role;

comment on table public.sheets_crm_outbox is
  'Durable CRM sync outbox. One open row per customer (dedupe_key open:<customer id>). Service role only.';
