-- Customer/date Event Download checkpoints. One row per org + Cust_Id + LE date.

create table if not exists public.tracking_sync_checkpoints (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cust_id text not null,
  event_code text not null default 'LE',
  event_date text not null,
  status text not null default 'PENDING',
  http_status integer,
  events_received integer not null default 0,
  events_matched integer not null default 0,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, cust_id, event_code, event_date),
  constraint tracking_sync_checkpoints_event_date_chk check (event_date ~ '^[0-9]{8}$'),
  constraint tracking_sync_checkpoints_event_code_chk check (event_code in ('LE', 'IB'))
);

create index if not exists tracking_sync_checkpoints_org_success_idx
  on public.tracking_sync_checkpoints (organization_id, last_success_at desc);

alter table public.tracking_sync_checkpoints enable row level security;

drop policy if exists tracking_sync_checkpoints_tenant_all on public.tracking_sync_checkpoints;
create policy tracking_sync_checkpoints_tenant_all on public.tracking_sync_checkpoints
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

comment on table public.tracking_sync_checkpoints is
  'Last Event Download (LE) attempt per India Post customer id and India-local date.';
