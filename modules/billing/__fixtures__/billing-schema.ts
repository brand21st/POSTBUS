/** Minimal billing schema (columns used by the billing migrations and remediation scripts) for PGlite tests. */
export const BASE_SCHEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create function public.is_org_member(org_id uuid) returns boolean language sql as $$ select true $$;
create function public.is_platform_admin() returns boolean language sql as $$ select false $$;
create table public.organizations (id uuid primary key, created_at timestamptz not null default now());
create table public.plans (
  id uuid primary key, slug text not null, monthly_price_paise bigint not null,
  yearly_price_paise bigint not null, monthly_order_limit integer not null
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  plan_id uuid not null references public.plans(id),
  billing_cycle text not null default 'monthly',
  status text not null default 'TRIAL',
  amount_paise bigint not null default 0,
  order_limit integer,
  started_at timestamptz, current_period_start timestamptz, current_period_end timestamptz,
  renews_at timestamptz, expires_at timestamptz,
  cancel_at_period_end boolean not null default false, cancelled_at timestamptz,
  trial_start timestamptz, trial_end timestamptz,
  trial_cohort text, trial_manual_override boolean not null default false,
  pending_plan_id uuid, pending_billing_cycle text,
  razorpay_subscription_id text unique, razorpay_customer_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index subscriptions_one_live_per_org on public.subscriptions (organization_id)
  where status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED');
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  subscription_id uuid references public.subscriptions(id),
  plan_id uuid references public.plans(id),
  amount_paise bigint not null default 0,
  currency text not null default 'INR',
  status text not null default 'PENDING' check (status in ('PENDING', 'CAPTURED', 'FAILED', 'REFUNDED')),
  razorpay_payment_id text unique, razorpay_order_id text, razorpay_invoice_id text, razorpay_subscription_id text,
  billing_cycle text, method text, failure_reason text, paid_at timestamptz, refunded_at timestamptz,
  payment_purpose text not null default 'subscription',
  created_at timestamptz not null default now()
);
create table public.billing_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, subscription_id uuid,
  period_start date not null, period_end date not null,
  orders_used integer not null default 0, order_limit integer,
  updated_at timestamptz not null default now(),
  unique (organization_id, period_start)
);
create table public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, subscription_id uuid,
  from_status text, to_status text, from_plan_id uuid, to_plan_id uuid,
  reason text, actor text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.razorpay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique, event text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  processed_at timestamptz, error text, created_at timestamptz not null default now()
);
`;
