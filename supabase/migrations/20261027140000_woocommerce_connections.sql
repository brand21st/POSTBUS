-- WooCommerce REST connections. One store per organization.
-- Imported orders stay on orders.source = 'WOOCOMMERCE' and external_order_references.
-- Rollback: drop the two tables and the two automation columns. Do not delete imported orders.

create table if not exists public.woocommerce_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  store_url text not null,
  store_host text not null,
  encrypted_consumer_key text,
  encrypted_consumer_secret text,
  encrypted_webhook_secret text,
  status public.integration_status not null default 'NOT_CONNECTED',
  sync_enabled boolean not null default true,
  weight_unit text,
  dimension_unit text,
  auth_state text,
  auth_state_expires_at timestamptz,
  auth_state_used_at timestamptz,
  settings jsonb not null default jsonb_build_object(
    'eligibleStatuses', jsonb_build_array('processing', 'on-hold'),
    'importDays', 30,
    'addTrackingNote', false,
    'updateOrderStatus', false,
    'statusMap', '{}'::jsonb,
    'webhookIds', '[]'::jsonb
  ),
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_webhook_at timestamptz,
  last_error text,
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists woocommerce_connections_auth_state_uidx
  on public.woocommerce_connections (auth_state)
  where auth_state is not null;

create index if not exists woocommerce_connections_org_status_idx
  on public.woocommerce_connections (organization_id, status);

drop trigger if exists woocommerce_connections_updated_at on public.woocommerce_connections;
create trigger woocommerce_connections_updated_at
  before update on public.woocommerce_connections
  for each row execute function public.set_updated_at();

alter table public.woocommerce_connections enable row level security;

drop policy if exists woocommerce_connections_select on public.woocommerce_connections;
create policy woocommerce_connections_select on public.woocommerce_connections
  for select using (public.is_org_member(organization_id));

drop policy if exists woocommerce_connections_write on public.woocommerce_connections;
create policy woocommerce_connections_write on public.woocommerce_connections
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

revoke all on public.woocommerce_connections from anon, authenticated;
grant select, insert, update, delete on public.woocommerce_connections to authenticated;
grant all on public.woocommerce_connections to service_role;

create table if not exists public.woocommerce_webhook_deliveries (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.woocommerce_connections(id) on delete cascade,
  topic text not null,
  status text not null default 'QUEUED',
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists woocommerce_webhook_deliveries_connection_idx
  on public.woocommerce_webhook_deliveries (connection_id, created_at desc);

alter table public.woocommerce_webhook_deliveries enable row level security;

drop policy if exists woocommerce_webhook_deliveries_select on public.woocommerce_webhook_deliveries;
create policy woocommerce_webhook_deliveries_select on public.woocommerce_webhook_deliveries
  for select using (public.is_org_member(organization_id));

revoke all on public.woocommerce_webhook_deliveries from anon, authenticated;
grant select on public.woocommerce_webhook_deliveries to authenticated;
grant all on public.woocommerce_webhook_deliveries to service_role;

alter table public.automation_settings
  add column if not exists auto_woocommerce_sync boolean not null default true;

alter table public.automation_settings
  add column if not exists auto_woocommerce_tracking boolean not null default false;

comment on column public.automation_settings.auto_woocommerce_sync is
  'When true, WooCommerce webhooks and the scheduled sync import orders. Booking still follows auto_shipment_creation and auto_booking.';

comment on column public.automation_settings.auto_woocommerce_tracking is
  'When true, PostBus writes the AWB and tracking link back to the WooCommerce order.';

-- Plans that already list Shopify order sync gain WooCommerce on the same tier.
update public.plans
set features = features || '["WooCommerce order sync"]'::jsonb
where features ? 'Shopify order sync'
  and not features ? 'WooCommerce order sync';
