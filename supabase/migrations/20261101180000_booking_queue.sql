-- Unified Bulk Booking Queue, Phase 1: durable queue state in front of the existing booking engine.
--
-- A queue item always points at an existing shipment (DRAFT while it waits). The queue has its
-- own state machine; shipments.status stays the truth for labels, manifests and tracking.
-- BOOKED here only mirrors shipments.booked_at, which only a CEPT-confirmed persist sets.
--
-- Signed-in members may move items only between review states. Batching, submission and
-- outcomes are system states, written by service-role code (auth.uid() is null there).
-- Nothing in this migration books, allocates barcodes or enables automation.

-- ---------------------------------------------------------------------------
-- Settings (Phase 4 adds the UI; defaults keep everything manual and off).
-- ---------------------------------------------------------------------------
create table if not exists public.booking_automation_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  mode text not null default 'MANUAL' check (mode in ('MANUAL', 'AUTOMATIC')),
  enrollment_sources text[] not null default '{}',
  batch_threshold integer not null default 50 check (batch_threshold between 1 and 5000),
  max_wait_minutes integer check (max_wait_minutes is null or max_wait_minutes between 5 and 1440),
  paused_at timestamptz,
  paused_by uuid references auth.users(id) on delete set null,
  auto_hold_until timestamptz,
  auto_hold_reason text,
  version integer not null default 1,
  last_scan_at timestamptz,
  last_dispatch_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  consecutive_errors integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_automation_sources_check check (
    enrollment_sources <@ array['SHOPIFY', 'WOOCOMMERCE', 'MANUAL', 'API', 'WHATSAPP', 'EXCEL']::text[]
  )
);

comment on table public.booking_automation_settings is
  'Per-workspace Bulk Booking queue settings. MANUAL by default; automation is opt-in.';

-- ---------------------------------------------------------------------------
-- Logical booking runs (one manual click or one automatic trigger). Phase 3 creates them.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger text not null check (trigger in ('MANUAL', 'AUTO_THRESHOLD', 'AUTO_TIMEOUT')),
  idempotency_key text not null,
  group_key text not null,
  settings_version integer,
  status text not null default 'DISPATCHING' check (status in (
    'DISPATCHING', 'ACTIVE', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'RECOVERY_REQUIRED', 'CANCELLED'
  )),
  item_count integer not null default 0 check (item_count >= 0),
  booked_count integer not null default 0,
  failed_count integer not null default 0,
  recovery_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists booking_runs_org_created_idx on public.booking_runs (organization_id, created_at desc);
create index if not exists booking_runs_org_status_idx on public.booking_runs (organization_id, status);

-- ---------------------------------------------------------------------------
-- Queue items.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_queue_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  source text not null check (source in ('SHOPIFY', 'WOOCOMMERCE', 'MANUAL', 'API', 'WHATSAPP', 'EXCEL')),
  import_row_id uuid references public.bulk_import_rows(id) on delete set null,
  state text not null default 'PENDING_VALIDATION' check (state in (
    'PENDING_VALIDATION', 'INVALID', 'WAITING_APPROVAL', 'READY_FOR_BOOKING', 'BATCHED',
    'SUBMITTING', 'BOOKED', 'FAILED', 'RECOVERY_REQUIRED', 'EXCLUDED', 'CANCELLED'
  )),
  group_key text,
  ready_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  run_id uuid references public.booking_runs(id) on delete set null,
  bulk_batch_id uuid,
  attempt_count integer not null default 0,
  last_error text,
  last_error_code text,
  issues jsonb not null default '[]'::jsonb,
  enrolled_by uuid references auth.users(id) on delete set null,
  enrolled_via text not null default 'ORDERS_PAGE' check (enrolled_via in ('AUTO', 'ORDERS_PAGE', 'EXCEL', 'API', 'QUEUE_PAGE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.booking_queue_items is
  'One row per shipment waiting in, or processed through, the Bulk Booking queue.';

-- A shipment can have at most one live queue item (prevents duplicate enrollment).
create unique index if not exists booking_queue_items_one_active_uidx
  on public.booking_queue_items (shipment_id)
  where state not in ('BOOKED', 'CANCELLED', 'EXCLUDED');

create unique index if not exists booking_queue_items_import_row_uidx
  on public.booking_queue_items (import_row_id)
  where import_row_id is not null;

create index if not exists booking_queue_items_org_state_idx
  on public.booking_queue_items (organization_id, state, updated_at desc);
create index if not exists booking_queue_items_org_created_idx
  on public.booking_queue_items (organization_id, created_at desc);
create index if not exists booking_queue_items_ready_idx
  on public.booking_queue_items (organization_id, group_key, ready_at)
  where state = 'READY_FOR_BOOKING';
create index if not exists booking_queue_items_run_idx
  on public.booking_queue_items (organization_id, run_id)
  where run_id is not null;
create index if not exists booking_queue_items_order_idx
  on public.booking_queue_items (organization_id, order_id);

-- ---------------------------------------------------------------------------
-- Timeline (append-only; written by the trigger below).
-- ---------------------------------------------------------------------------
create table if not exists public.booking_queue_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.booking_queue_items(id) on delete cascade,
  run_id uuid,
  from_state text,
  to_state text not null,
  actor_id uuid,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists booking_queue_events_item_idx on public.booking_queue_events (item_id, created_at);
create index if not exists booking_queue_events_org_created_idx on public.booking_queue_events (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- State machine. Keep in sync with modules/booking-queue/state.ts (tests compare both).
-- ---------------------------------------------------------------------------
create or replace function public.booking_queue_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'PENDING_VALIDATION' then p_to in ('INVALID', 'WAITING_APPROVAL', 'READY_FOR_BOOKING', 'BOOKED', 'EXCLUDED', 'CANCELLED')
    when 'INVALID' then p_to in ('PENDING_VALIDATION', 'EXCLUDED', 'CANCELLED')
    when 'WAITING_APPROVAL' then p_to in ('PENDING_VALIDATION', 'INVALID', 'READY_FOR_BOOKING', 'BOOKED', 'EXCLUDED', 'CANCELLED')
    when 'READY_FOR_BOOKING' then p_to in ('PENDING_VALIDATION', 'INVALID', 'WAITING_APPROVAL', 'BATCHED', 'BOOKED', 'EXCLUDED', 'CANCELLED')
    when 'BATCHED' then p_to in ('READY_FOR_BOOKING', 'SUBMITTING', 'BOOKED', 'FAILED', 'RECOVERY_REQUIRED')
    when 'SUBMITTING' then p_to in ('BOOKED', 'FAILED', 'RECOVERY_REQUIRED')
    when 'FAILED' then p_to in ('PENDING_VALIDATION', 'INVALID', 'BOOKED', 'EXCLUDED', 'CANCELLED')
    when 'RECOVERY_REQUIRED' then p_to in ('BOOKED', 'FAILED')
    when 'EXCLUDED' then p_to in ('PENDING_VALIDATION', 'CANCELLED')
    else false
  end;
$$;

-- States a signed-in member may set directly. Everything else is system-only.
create or replace function public.booking_queue_member_state(p_state text)
returns boolean
language sql
immutable
as $$
  select p_state in ('PENDING_VALIDATION', 'INVALID', 'WAITING_APPROVAL', 'READY_FOR_BOOKING', 'EXCLUDED', 'CANCELLED');
$$;

create or replace function public.booking_queue_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship_org uuid;
  v_ship_order uuid;
  v_ship_booked timestamptz;
  v_order_org uuid;
  v_member boolean := auth.uid() is not null;
begin
  if tg_op = 'INSERT' then
    select organization_id, order_id, booked_at into v_ship_org, v_ship_order, v_ship_booked
      from public.shipments where id = new.shipment_id;
    select organization_id into v_order_org from public.orders where id = new.order_id;
    if v_ship_org is distinct from new.organization_id
       or v_order_org is distinct from new.organization_id
       or v_ship_order is distinct from new.order_id then
      raise exception 'booking queue item must match its shipment and order organization';
    end if;
    if v_ship_booked is not null and new.state <> 'BOOKED' then
      raise exception 'shipment is already booked with India Post';
    end if;
    if new.state = 'BOOKED' and v_ship_booked is null then
      raise exception 'BOOKED requires a shipment confirmed by India Post';
    end if;
    if v_member and new.state <> 'PENDING_VALIDATION' then
      raise exception 'new queue items start in PENDING_VALIDATION';
    end if;
    if v_member and (new.run_id is not null or new.bulk_batch_id is not null) then
      raise exception 'only the system assigns queue items to a run';
    end if;
    new.ready_at := case when new.state = 'READY_FOR_BOOKING' then now() else null end;
    return new;
  end if;

  -- UPDATE: identity never changes.
  if new.organization_id is distinct from old.organization_id
     or new.shipment_id is distinct from old.shipment_id
     or new.order_id is distinct from old.order_id
     or new.source is distinct from old.source
     or new.import_row_id is distinct from old.import_row_id then
    raise exception 'booking queue item identity is immutable';
  end if;
  if v_member and (new.run_id is distinct from old.run_id or new.bulk_batch_id is distinct from old.bulk_batch_id) then
    raise exception 'only the system assigns queue items to a run';
  end if;

  if new.state is distinct from old.state then
    if not public.booking_queue_transition_allowed(old.state, new.state) then
      raise exception 'illegal booking queue transition % -> %', old.state, new.state;
    end if;
    if v_member and not (public.booking_queue_member_state(old.state) and public.booking_queue_member_state(new.state)) then
      raise exception 'booking queue state % -> % is system-only', old.state, new.state;
    end if;
    if new.state = 'BOOKED' then
      select booked_at into v_ship_booked from public.shipments where id = new.shipment_id;
      if v_ship_booked is null then
        raise exception 'BOOKED requires a shipment confirmed by India Post';
      end if;
    end if;
    -- The waiting clock starts when an item becomes ready. A batch released before any POST
    -- keeps its place; otherwise re-entering READY starts a new clock.
    if new.state = 'READY_FOR_BOOKING' then
      new.ready_at := case when old.state = 'BATCHED' then coalesce(old.ready_at, now()) else now() end;
    else
      new.ready_at := old.ready_at;
    end if;
  else
    new.ready_at := old.ready_at;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_queue_items_guard on public.booking_queue_items;
create trigger booking_queue_items_guard
  before insert or update on public.booking_queue_items
  for each row execute function public.booking_queue_items_guard();

-- Timeline row per state change. AFTER, so the item row exists for the foreign key.
create or replace function public.booking_queue_items_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.booking_queue_events (organization_id, item_id, run_id, from_state, to_state, actor_id, reason)
      values (
        new.organization_id,
        new.id,
        new.run_id,
        case when tg_op = 'INSERT' then null else old.state end,
        new.state,
        auth.uid(),
        case when tg_op = 'INSERT' then null else new.last_error end
      );
  end if;
  return null;
end;
$$;

drop trigger if exists booking_queue_items_log on public.booking_queue_items;
create trigger booking_queue_items_log
  after insert or update on public.booking_queue_items
  for each row execute function public.booking_queue_items_log();

-- updated_at
drop trigger if exists set_booking_queue_items_updated_at on public.booking_queue_items;
create trigger set_booking_queue_items_updated_at
  before update on public.booking_queue_items
  for each row execute function public.set_updated_at();
drop trigger if exists set_booking_runs_updated_at on public.booking_runs;
create trigger set_booking_runs_updated_at
  before update on public.booking_runs
  for each row execute function public.set_updated_at();
drop trigger if exists set_booking_automation_settings_updated_at on public.booking_automation_settings;
create trigger set_booking_automation_settings_updated_at
  before update on public.booking_automation_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.booking_automation_settings enable row level security;
alter table public.booking_runs enable row level security;
alter table public.booking_queue_items enable row level security;
alter table public.booking_queue_events enable row level security;

drop policy if exists booking_automation_settings_select on public.booking_automation_settings;
create policy booking_automation_settings_select on public.booking_automation_settings
  for select using (public.is_org_member(organization_id));
drop policy if exists booking_automation_settings_write on public.booking_automation_settings;
create policy booking_automation_settings_write on public.booking_automation_settings
  for all
  using (public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[]));

drop policy if exists booking_runs_select on public.booking_runs;
create policy booking_runs_select on public.booking_runs
  for select using (public.is_org_member(organization_id));

drop policy if exists booking_queue_items_select on public.booking_queue_items;
create policy booking_queue_items_select on public.booking_queue_items
  for select using (public.is_org_member(organization_id));
drop policy if exists booking_queue_items_insert on public.booking_queue_items;
create policy booking_queue_items_insert on public.booking_queue_items
  for insert with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );
drop policy if exists booking_queue_items_update on public.booking_queue_items;
create policy booking_queue_items_update on public.booking_queue_items
  for update
  using (public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[]));

drop policy if exists booking_queue_events_select on public.booking_queue_events;
create policy booking_queue_events_select on public.booking_queue_events
  for select using (public.is_org_member(organization_id));

revoke all on public.booking_automation_settings from public, anon;
revoke all on public.booking_runs from public, anon;
revoke all on public.booking_queue_items from public, anon;
revoke all on public.booking_queue_events from public, anon;
grant select, insert, update on public.booking_automation_settings to authenticated;
grant select on public.booking_runs to authenticated;
grant select, insert, update on public.booking_queue_items to authenticated;
grant select on public.booking_queue_events to authenticated;
grant all on public.booking_automation_settings, public.booking_runs, public.booking_queue_items, public.booking_queue_events to service_role;
