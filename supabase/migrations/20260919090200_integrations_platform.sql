create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shop_domain text not null,
  encrypted_access_token text,
  scopes text,
  status public.integration_status not null default 'NOT_CONNECTED',
  last_sync_at timestamptz,
  last_webhook_at timestamptz,
  last_error text,
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, shop_domain)
);

create table if not exists public.shopify_stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.shopify_connections(id) on delete cascade,
  shop_domain text not null,
  shop_name text,
  currency text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.india_post_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  environment public.provider_env not null default 'UAT',
  encrypted_username text,
  encrypted_password text,
  bulk_customer_id text,
  contract_id text,
  pickup_dropoff_office_id text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  encrypted_id_token text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_verified_at timestamptz,
  status public.integration_status not null default 'NOT_CONNECTED',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barcode_ranges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prefix text not null,
  suffix text not null default 'IN',
  start_number bigint not null,
  end_number bigint not null,
  next_number bigint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  auto_shopify_sync boolean not null default false,
  auto_shipment_creation boolean not null default false,
  auto_booking boolean not null default false,
  auto_label_generation boolean not null default true,
  auto_manifest boolean not null default false,
  auto_tracking_sync boolean not null default true,
  auto_shopify_fulfillment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type text not null,
  entity_type text,
  entity_id uuid,
  status public.job_status not null default 'PENDING',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  last_error_code text,
  progress jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipment_job_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.background_jobs(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete set null,
  attempt_number integer not null,
  status public.job_status not null,
  error text,
  error_code text,
  retryable boolean,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  request_hash text,
  response jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  secret_hash text not null,
  status public.api_key_status not null default 'ACTIVE',
  last_used_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  events text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  last_error text,
  response_code integer,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code public.billing_plan_code not null unique,
  name text not null,
  shipment_limit integer,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid references public.billing_plans(id),
  status public.subscription_status not null default 'CONFIGURATION_REQUIRED',
  billing_cycle_start date,
  billing_cycle_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric text not null,
  quantity integer not null default 1,
  occurred_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  status text not null default 'UNPAID',
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.billing_plans (code, name, shipment_limit)
values
  ('STARTER', 'Starter', 200),
  ('GROWTH', 'Growth', 1000),
  ('PRO', 'Pro', 5000),
  ('BUSINESS', 'Business', 20000),
  ('ENTERPRISE', 'Enterprise', null)
on conflict (code) do nothing;

create index if not exists shopify_connections_org_idx on public.shopify_connections (organization_id);
create index if not exists india_post_connections_org_idx on public.india_post_connections (organization_id);
create index if not exists jobs_org_status_idx on public.background_jobs (organization_id, status);
create index if not exists jobs_next_attempt_idx on public.background_jobs (status, next_attempt_at);
create index if not exists notifications_org_idx on public.notifications (organization_id, created_at desc);
create index if not exists audit_org_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists usage_org_idx on public.usage_events (organization_id, occurred_at desc);
create index if not exists invoices_org_idx on public.invoices (organization_id, created_at desc);
create unique index if not exists webhook_event_id_uidx on public.idempotency_keys (organization_id, key);
