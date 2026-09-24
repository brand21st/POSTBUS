-- Multi-tenant Razorpay billing: plans, subscriptions, payments, usage, super admins.

alter table public.organizations
  add column if not exists account_status text not null default 'ACTIVE';

do $$ begin
  alter table public.organizations
    add constraint organizations_account_status_check
    check (account_status in ('ACTIVE', 'SUSPENDED', 'DISABLED'));
exception when duplicate_object then null;
end $$;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  monthly_price_paise bigint not null,
  yearly_price_paise bigint not null,
  monthly_order_limit integer not null,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  display_order integer not null default 0,
  razorpay_monthly_plan_id text,
  razorpay_yearly_plan_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  trial_enabled boolean not null default true,
  trial_days integer not null default 14,
  razorpay_mode text not null default 'test',
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id, trial_enabled, trial_days)
values (1, true, 14)
on conflict (id) do nothing;

create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Seed: after the first Super Admin signs up, insert their user_id/email:
-- insert into public.platform_admins (user_id, email)
-- values ('<auth user uuid>', 'admin@example.com');

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'yearly')),
  status text not null default 'TRIAL'
    check (status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAUSED', 'PAYMENT_FAILED')),
  amount_paise bigint not null default 0,
  order_limit integer,
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  renews_at timestamptz,
  expires_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  pending_plan_id uuid references public.plans(id),
  pending_billing_cycle text check (pending_billing_cycle is null or pending_billing_cycle in ('monthly', 'yearly')),
  razorpay_subscription_id text unique,
  razorpay_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  plan_id uuid references public.plans(id),
  plan_name text,
  billing_cycle text not null,
  quantity integer not null default 1,
  unit_amount_paise bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id uuid references public.plans(id),
  amount_paise bigint not null default 0,
  currency text not null default 'INR',
  status text not null default 'PENDING'
    check (status in ('PENDING', 'CAPTURED', 'FAILED', 'REFUNDED')),
  razorpay_payment_id text,
  razorpay_order_id text,
  razorpay_invoice_id text,
  razorpay_subscription_id text,
  billing_cycle text,
  method text,
  failure_reason text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  period_start date not null,
  period_end date not null,
  orders_used integer not null default 0,
  order_limit integer,
  alert_80_sent_at timestamptz,
  alert_90_sent_at timestamptz,
  alert_100_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_start)
);

create table if not exists public.razorpay_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  razorpay_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.razorpay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  from_status text,
  to_status text,
  from_plan_id uuid references public.plans(id),
  to_plan_id uuid references public.plans(id),
  reason text,
  actor text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_type text not null default 'SYSTEM'
    check (actor_type in ('SUPER_ADMIN', 'USER', 'SYSTEM', 'WEBHOOK')),
  action text not null,
  target_type text,
  target_id text,
  organization_id uuid references public.organizations(id) on delete set null,
  ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.trial_claims (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  whatsapp_number text,
  organization_id uuid references public.organizations(id) on delete set null,
  claimed_at timestamptz not null default now()
);

alter table public.invoices
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;

alter table public.invoices
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

alter table public.invoices
  add column if not exists razorpay_invoice_id text;

alter table public.invoices
  add column if not exists period_start date;

alter table public.invoices
  add column if not exists period_end date;

alter table public.invoices
  add column if not exists pdf_url text;

alter table public.invoices
  add column if not exists amount_paise bigint;

insert into public.plans (
  slug, name, description, monthly_price_paise, yearly_price_paise, monthly_order_limit, features, display_order
) values
  (
    'starter',
    'Starter',
    'For early-stage stores setting up automated shipping.',
    49900,
    479040,
    300,
    '["Up to 300 orders per billing period","Shopify order sync","Shipment workspace","Label and barcode workflows"]'::jsonb,
    1
  ),
  (
    'pro',
    'Pro',
    'For teams processing shipments in bulk every day.',
    149900,
    1439040,
    1000,
    '["Up to 1,000 orders per billing period","Everything in Starter","Bulk shipping tools","Automation rules","Manifest management"]'::jsonb,
    2
  ),
  (
    'business',
    'Business',
    'For high-volume shipping operations.',
    550000,
    5280000,
    10000,
    '["Up to 10,000 orders per billing period","Everything in Pro","Operational analytics","Priority support"]'::jsonb,
    3
  )
on conflict (slug) do nothing;

create unique index if not exists subscriptions_one_live_per_org
  on public.subscriptions (organization_id)
  where status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED');

create unique index if not exists payments_razorpay_payment_id_uidx
  on public.payments (razorpay_payment_id)
  where razorpay_payment_id is not null;

create index if not exists subscriptions_org_idx on public.subscriptions (organization_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_razorpay_customer_idx on public.subscriptions (razorpay_customer_id);
create index if not exists subscriptions_created_idx on public.subscriptions (created_at desc);
create index if not exists subscription_items_sub_idx on public.subscription_items (subscription_id);
create index if not exists payments_org_idx on public.payments (organization_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status);
create index if not exists payments_subscription_idx on public.payments (subscription_id);
create index if not exists payments_razorpay_sub_idx on public.payments (razorpay_subscription_id);
create index if not exists billing_usage_org_period_idx on public.billing_usage (organization_id, period_start);
create index if not exists billing_usage_sub_idx on public.billing_usage (subscription_id);
create index if not exists webhook_events_created_idx on public.razorpay_webhook_events (created_at desc);
create index if not exists webhook_events_event_idx on public.razorpay_webhook_events (event);
create index if not exists subscription_history_org_idx on public.subscription_history (organization_id, created_at desc);
create index if not exists billing_audit_org_idx on public.billing_audit_logs (organization_id, created_at desc);
create index if not exists billing_audit_created_idx on public.billing_audit_logs (created_at desc);
create index if not exists trial_claims_whatsapp_idx on public.trial_claims (whatsapp_number);

drop trigger if exists set_plans_updated_at on public.plans;
create trigger set_plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists set_billing_usage_updated_at on public.billing_usage;
create trigger set_billing_usage_updated_at before update on public.billing_usage
  for each row execute function public.set_updated_at();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins a
    where a.user_id = auth.uid()
  );
$$;

create or replace function public.ensure_billing_period(p_org uuid)
returns public.billing_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
  v_usage public.billing_usage;
  v_start date;
  v_end date;
  v_limit integer;
begin
  select * into v_sub
  from public.subscriptions
  where organization_id = p_org
    and status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED')
  order by created_at desc
  limit 1;

  if v_sub.id is null then
    raise exception 'NO_ACTIVE_SUBSCRIPTION';
  end if;

  v_start := coalesce(v_sub.current_period_start::date, current_date);
  v_end := coalesce(v_sub.current_period_end::date, (v_start + interval '1 month')::date);
  v_limit := v_sub.order_limit;
  if v_limit is null then
    select monthly_order_limit into v_limit from public.plans where id = v_sub.plan_id;
  end if;

  insert into public.billing_usage (
    organization_id, subscription_id, period_start, period_end, orders_used, order_limit
  ) values (
    p_org, v_sub.id, v_start, v_end, 0, v_limit
  )
  on conflict (organization_id, period_start)
  do update set
    subscription_id = excluded.subscription_id,
    period_end = excluded.period_end,
    order_limit = coalesce(public.billing_usage.order_limit, excluded.order_limit)
  returning * into v_usage;

  return v_usage;
end;
$$;

create or replace function public.consume_order_quota(p_org uuid)
returns table(orders_used integer, order_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.billing_usage;
  v_used integer;
  v_limit integer;
begin
  v_usage := public.ensure_billing_period(p_org);

  update public.billing_usage u
  set orders_used = u.orders_used + 1
  where u.id = v_usage.id
    and (u.order_limit is null or u.orders_used < u.order_limit)
  returning u.orders_used, u.order_limit into v_used, v_limit;

  if v_used is null then
    return;
  end if;

  return query select v_used, v_limit;
end;
$$;

create or replace function public.create_organization_for_user(p_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_org public.organizations;
  v_slug text;
  v_plan uuid;
  v_new_plan public.plans;
  v_settings public.platform_settings;
  v_email text;
  v_whatsapp text;
  v_trial_ok boolean := false;
  v_period_end timestamptz;
  v_sub_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select o.* into v_org
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_user
  order by o.created_at asc
  limit 1;

  if v_org.id is not null then
    update public.profiles
      set active_organization_id = v_org.id
      where id = v_user;
    return v_org;
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(v_slug, 48);
  if v_slug is null or v_slug = '' then
    v_slug := 'workspace';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  insert into public.organizations (name, slug, created_by)
  values (p_name, v_slug, v_user)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_user, 'OWNER');

  insert into public.automation_settings (organization_id)
  values (v_org.id)
  on conflict (organization_id) do nothing;

  select id into v_plan from public.billing_plans where code = 'STARTER' limit 1;

  insert into public.organization_subscriptions (organization_id, plan_id, status)
  values (v_org.id, v_plan, 'CONFIGURATION_REQUIRED')
  on conflict (organization_id) do nothing;

  select * into v_settings from public.platform_settings where id = 1;
  select * into v_new_plan from public.plans where slug = 'starter' and is_active limit 1;
  select lower(email), whatsapp_number into v_email, v_whatsapp from public.profiles where id = v_user;

  if coalesce(v_settings.trial_enabled, false) and v_new_plan.id is not null then
    v_trial_ok := true;
    if v_email is not null and exists (select 1 from public.trial_claims where email_normalized = v_email) then
      v_trial_ok := false;
    elsif v_whatsapp is not null and exists (
      select 1 from public.trial_claims where whatsapp_number = v_whatsapp
    ) then
      v_trial_ok := false;
    end if;
  end if;

  if v_trial_ok then
    v_period_end := now() + make_interval(days => coalesce(v_settings.trial_days, 14));
    insert into public.subscriptions (
      organization_id, plan_id, billing_cycle, status, amount_paise, order_limit,
      started_at, current_period_start, current_period_end, renews_at, expires_at,
      trial_start, trial_end
    ) values (
      v_org.id, v_new_plan.id, 'monthly', 'TRIAL', 0, v_new_plan.monthly_order_limit,
      now(), now(), v_period_end, v_period_end, v_period_end,
      now(), v_period_end
    )
    returning id into v_sub_id;

    insert into public.billing_usage (
      organization_id, subscription_id, period_start, period_end, orders_used, order_limit
    ) values (
      v_org.id, v_sub_id, now()::date, v_period_end::date, 0, v_new_plan.monthly_order_limit
    )
    on conflict (organization_id, period_start) do nothing;

    if v_email is not null then
      insert into public.trial_claims (email_normalized, whatsapp_number, organization_id)
      values (v_email, v_whatsapp, v_org.id)
      on conflict (email_normalized) do nothing;
    end if;

    insert into public.subscription_history (
      organization_id, subscription_id, to_status, to_plan_id, reason, actor
    ) values (
      v_org.id, v_sub_id, 'TRIAL', v_new_plan.id, 'trial_started', 'SYSTEM'
    );
  end if;

  update public.profiles
    set active_organization_id = v_org.id
    where id = v_user;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_org.id, v_user, 'organization.created', 'organization', v_org.id, jsonb_build_object('name', p_name));

  return v_org;
end;
$$;

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_items enable row level security;
alter table public.payments enable row level security;
alter table public.billing_usage enable row level security;
alter table public.razorpay_customers enable row level security;
alter table public.razorpay_webhook_events enable row level security;
alter table public.subscription_history enable row level security;
alter table public.billing_audit_logs enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;
alter table public.trial_claims enable row level security;

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans
  for select using (is_active = true or public.is_platform_admin());

drop policy if exists subscriptions_tenant_select on public.subscriptions;
create policy subscriptions_tenant_select on public.subscriptions
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists subscription_items_tenant_select on public.subscription_items;
create policy subscription_items_tenant_select on public.subscription_items
  for select using (
    exists (
      select 1 from public.subscriptions s
      where s.id = subscription_id
        and (public.is_org_member(s.organization_id) or public.is_platform_admin())
    )
  );

drop policy if exists payments_tenant_select on public.payments;
create policy payments_tenant_select on public.payments
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists billing_usage_tenant_select on public.billing_usage;
create policy billing_usage_tenant_select on public.billing_usage
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists razorpay_customers_tenant_select on public.razorpay_customers;
create policy razorpay_customers_tenant_select on public.razorpay_customers
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists subscription_history_tenant_select on public.subscription_history;
create policy subscription_history_tenant_select on public.subscription_history
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists billing_audit_admin_select on public.billing_audit_logs;
create policy billing_audit_admin_select on public.billing_audit_logs
  for select using (public.is_platform_admin());

drop policy if exists platform_admins_self_select on public.platform_admins;
create policy platform_admins_self_select on public.platform_admins
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists platform_settings_admin_select on public.platform_settings;
create policy platform_settings_admin_select on public.platform_settings
  for select using (true);

drop policy if exists webhook_events_admin_select on public.razorpay_webhook_events;
create policy webhook_events_admin_select on public.razorpay_webhook_events
  for select using (public.is_platform_admin());

revoke all on function public.consume_order_quota(uuid) from public;
revoke all on function public.ensure_billing_period(uuid) from public;
grant execute on function public.consume_order_quota(uuid) to service_role, authenticated;
grant execute on function public.ensure_billing_period(uuid) to service_role, authenticated;
grant execute on function public.is_platform_admin() to authenticated, anon;
grant select on public.plans to anon, authenticated;
grant select on public.platform_settings to anon, authenticated;
