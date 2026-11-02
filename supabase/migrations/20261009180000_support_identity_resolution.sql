-- Tenant-safe Support identity resolution. Additive. Does not change shipping Vachat.

alter table public.orders
  drop constraint if exists orders_id_organization_id_key;
alter table public.orders
  add constraint orders_id_organization_id_key unique (id, organization_id);

alter table public.shipments
  drop constraint if exists shipments_id_organization_id_key;
alter table public.shipments
  add constraint shipments_id_organization_id_key unique (id, organization_id);

alter table public.support_tickets
  drop constraint if exists support_tickets_order_org_fk;
alter table public.support_tickets
  add constraint support_tickets_order_org_fk
  foreign key (order_id, organization_id) references public.orders (id, organization_id);

alter table public.support_tickets
  drop constraint if exists support_tickets_shipment_org_fk;
alter table public.support_tickets
  add constraint support_tickets_shipment_org_fk
  foreign key (shipment_id, organization_id) references public.shipments (id, organization_id);

alter table public.support_global_binds
  add column if not exists last_revalidated_at timestamptz;

alter table public.support_unassigned_threads
  add column if not exists resolution_state text not null default 'VERIFICATION_REQUIRED';
alter table public.support_unassigned_threads
  add column if not exists evidence jsonb not null default '{}'::jsonb;
alter table public.support_unassigned_threads
  add column if not exists assigned_organization_id uuid references public.organizations(id) on delete set null;

alter table public.support_unassigned_threads
  drop constraint if exists support_unassigned_resolution_state_chk;
alter table public.support_unassigned_threads
  add constraint support_unassigned_resolution_state_chk
  check (resolution_state in (
    'RECEIVED',
    'CHANNEL_VERIFIED',
    'MERCHANT_RESOLUTION',
    'AMBIGUOUS',
    'NOT_FOUND',
    'ORDER_RESOLUTION',
    'MULTIPLE_MATCHES',
    'ORDER_NOT_FOUND',
    'CUSTOMER_VERIFICATION',
    'VERIFICATION_REQUIRED',
    'VERIFIED',
    'TICKET_CREATED'
  ));

create table if not exists public.support_identity_resolutions (
  id uuid primary key default gen_random_uuid(),
  unassigned_thread_id uuid references public.support_unassigned_threads(id) on delete cascade,
  conversation_id uuid,
  organization_id uuid references public.organizations(id) on delete set null,
  order_id uuid,
  phone_digits text,
  state text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

alter table public.support_identity_resolutions
  drop constraint if exists support_identity_resolutions_state_chk;
alter table public.support_identity_resolutions
  add constraint support_identity_resolutions_state_chk
  check (state in (
    'RECEIVED',
    'CHANNEL_VERIFIED',
    'MERCHANT_RESOLUTION',
    'AMBIGUOUS',
    'NOT_FOUND',
    'ORDER_RESOLUTION',
    'MULTIPLE_MATCHES',
    'ORDER_NOT_FOUND',
    'CUSTOMER_VERIFICATION',
    'VERIFICATION_REQUIRED',
    'VERIFIED',
    'TICKET_CREATED'
  ));

create index if not exists support_identity_resolutions_thread_idx
  on public.support_identity_resolutions (unassigned_thread_id, created_at desc);
create index if not exists support_identity_resolutions_org_idx
  on public.support_identity_resolutions (organization_id, created_at desc);

alter table public.support_identity_resolutions enable row level security;
revoke all on table public.support_identity_resolutions from anon, authenticated;
grant select, insert, update, delete on table public.support_identity_resolutions to service_role;
