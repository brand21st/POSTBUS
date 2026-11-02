-- Billing P0 hardening (audit F-04 / F-06 / F-07).
--
-- 1. payment_attempts: one row per Razorpay payment attempt. A failed attempt no
--    longer adds a second `payments` row for the same order, so the purchase
--    intent (payments, payment_purpose = 'subscription') stays unambiguous when a
--    customer retries inside the same Checkout.
-- 2. Purchase intents are only PENDING / CAPTURED / REFUNDED rows. Legacy FAILED
--    rows that share an order are attempt history: copied into payment_attempts,
--    never deleted, and ignored by fulfillment.
-- 3. Webhook leases: a failed webhook can be claimed again by Razorpay's retry
--    instead of being acknowledged as a duplicate without processing.
-- 4. Reconciliation bookkeeping on payments.
-- 5. fulfill_captured_subscription_purchase: intent-only ambiguity check, keeps
--    unused paid days on renewal, records the captured attempt, and creates the
--    organization's subscription row when none exists.
--
-- Service-role only. Do not apply from a developer workstation to a hosted
-- project without written approval. Idempotent: safe to re-run.

-- 1. Payment attempts -------------------------------------------------------

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  purchase_id uuid references public.payments(id) on delete set null,
  razorpay_order_id text not null,
  razorpay_payment_id text not null,
  status text not null check (status in ('FAILED', 'AUTHORIZED', 'CAPTURED', 'REFUNDED')),
  amount_paise bigint,
  currency text,
  method text,
  error_code text,
  error_reason text,
  source text not null default 'webhook'
    check (source in ('webhook', 'verify', 'reconcile', 'legacy_backfill')),
  event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_attempts_razorpay_payment_id_uidx
  on public.payment_attempts (razorpay_payment_id);
create index if not exists payment_attempts_order_idx
  on public.payment_attempts (razorpay_order_id, created_at desc);
create index if not exists payment_attempts_org_idx
  on public.payment_attempts (organization_id, created_at desc);

alter table public.payment_attempts enable row level security;
drop policy if exists payment_attempts_tenant_select on public.payment_attempts;
create policy payment_attempts_tenant_select on public.payment_attempts
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

-- Copy legacy FAILED payment rows into attempt history. Source rows stay as they are.
insert into public.payment_attempts (
  organization_id, purchase_id, razorpay_order_id, razorpay_payment_id, status,
  amount_paise, currency, method, error_reason, source, created_at
)
select
  f.organization_id,
  (
    select i.id from public.payments i
    where i.razorpay_order_id = f.razorpay_order_id
      and coalesce(i.payment_purpose, 'subscription') = 'subscription'
      and i.status in ('PENDING', 'CAPTURED', 'REFUNDED')
    order by i.created_at asc
    limit 1
  ),
  f.razorpay_order_id,
  f.razorpay_payment_id,
  'FAILED',
  f.amount_paise,
  f.currency,
  f.method,
  f.failure_reason,
  'legacy_backfill',
  f.created_at
from public.payments f
where f.status = 'FAILED'
  and coalesce(f.payment_purpose, 'subscription') = 'subscription'
  and f.razorpay_order_id is not null
  and f.razorpay_payment_id is not null
on conflict (razorpay_payment_id) do nothing;

-- 2. One purchase intent per order (only when existing data allows it) --------

do $$
begin
  if exists (
    select 1 from public.payments
    where razorpay_order_id is not null
      and coalesce(payment_purpose, 'subscription') = 'subscription'
      and status in ('PENDING', 'CAPTURED', 'REFUNDED')
    group by razorpay_order_id
    having count(*) > 1
  ) then
    raise notice 'payments_subscription_intent_order_uidx not created: duplicate subscription intents exist. Run supabase/remediation/billing_p0_review.sql.';
  else
    create unique index if not exists payments_subscription_intent_order_uidx
      on public.payments (razorpay_order_id)
      where razorpay_order_id is not null
        and payment_purpose = 'subscription'
        and status in ('PENDING', 'CAPTURED', 'REFUNDED');
  end if;
end $$;

-- 3. Webhook leases --------------------------------------------------------

alter table public.razorpay_webhook_events
  add column if not exists processing_lease uuid,
  add column if not exists processing_until timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

create index if not exists webhook_events_retry_idx
  on public.razorpay_webhook_events (status, created_at)
  where status in ('received', 'failed');

-- Claim an event for processing. Returns {state: claimed|complete|busy|missing}.
-- A failed or abandoned (lease expired) attempt can be claimed again; a live
-- lease cannot be stolen; processed/ignored events are never reprocessed.
create or replace function public.claim_razorpay_webhook_event(
  p_event_id text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_row public.razorpay_webhook_events%rowtype;
  v_lease uuid := gen_random_uuid();
begin
  select * into v_row
  from public.razorpay_webhook_events
  where event_id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  if v_row.status in ('processed', 'ignored') then
    return jsonb_build_object('state', 'complete', 'id', v_row.id);
  end if;
  if v_row.processing_until is not null and v_row.processing_until > now() then
    return jsonb_build_object('state', 'busy', 'id', v_row.id);
  end if;

  update public.razorpay_webhook_events
  set status = 'received',
      processing_lease = v_lease,
      processing_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)),
      attempts = attempts + 1,
      last_attempt_at = now()
  where id = v_row.id;

  return jsonb_build_object('state', 'claimed', 'id', v_row.id, 'lease', v_lease, 'attempts', v_row.attempts + 1);
end;
$$;

revoke all on function public.claim_razorpay_webhook_event(text, integer) from public;
revoke all on function public.claim_razorpay_webhook_event(text, integer) from anon;
revoke all on function public.claim_razorpay_webhook_event(text, integer) from authenticated;
grant execute on function public.claim_razorpay_webhook_event(text, integer) to service_role;

-- 4. Reconciliation bookkeeping --------------------------------------------

alter table public.payments
  add column if not exists reconcile_checked_at timestamptz,
  add column if not exists reconcile_attempts integer not null default 0;

create index if not exists payments_pending_subscription_idx
  on public.payments (created_at)
  where status = 'PENDING' and payment_purpose = 'subscription';

-- 5. Authoritative fulfillment ---------------------------------------------

create or replace function public.fulfill_captured_subscription_purchase(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_amount_paise bigint,
  p_currency text default 'INR',
  p_method text default null,
  p_expected_organization_id uuid default null,
  p_actor text default null,
  p_reason text default 'checkout_verified'
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_count integer;
  v_payment public.payments%rowtype;
  v_claimed uuid;
  v_plan public.plans%rowtype;
  v_sub public.subscriptions%rowtype;
  v_cycle text;
  v_start timestamptz;
  v_end timestamptz;
  v_carry interval := interval '0';
  v_sub_id uuid;
  v_sub_org uuid;
  v_created boolean := false;
begin
  if p_razorpay_order_id is null or length(btrim(p_razorpay_order_id)) = 0
     or p_razorpay_payment_id is null or length(btrim(p_razorpay_payment_id)) = 0 then
    return jsonb_build_object('handled', false, 'notFound', true);
  end if;

  perform 1
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
  for update;

  -- Purchase intents only. FAILED rows are attempt history (legacy payment.failed
  -- inserted them for the same order) and must not make a retry ambiguous.
  select count(*)::int into v_count
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
    and coalesce(payment_purpose, 'subscription') = 'subscription'
    and status in ('PENDING', 'CAPTURED', 'REFUNDED');

  if v_count > 1 then
    return jsonb_build_object('handled', true, 'ambiguous', true, 'count', v_count);
  end if;

  select * into v_payment
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
    and coalesce(payment_purpose, 'subscription') = 'subscription'
    and status in ('PENDING', 'CAPTURED', 'REFUNDED')
  limit 1;

  if not found then
    return jsonb_build_object('handled', false, 'notFound', true);
  end if;

  if p_expected_organization_id is not null
     and v_payment.organization_id is distinct from p_expected_organization_id then
    return jsonb_build_object('handled', true, 'forbidden', true);
  end if;

  if upper(coalesce(v_payment.currency, 'INR')) is distinct from upper(coalesce(p_currency, 'INR')) then
    return jsonb_build_object('handled', true, 'currencyMismatch', true);
  end if;

  if v_payment.amount_paise is distinct from p_amount_paise then
    return jsonb_build_object('handled', true, 'amountMismatch', true);
  end if;

  -- Already fulfilled (or refunded): same payment is a duplicate, another payment
  -- on a fulfilled order is never allowed to grant anything.
  if v_payment.status in ('CAPTURED', 'REFUNDED') then
    if v_payment.razorpay_payment_id is null
       or v_payment.razorpay_payment_id = p_razorpay_payment_id then
      return jsonb_build_object('handled', true, 'duplicate', true, 'subscriptionId', v_payment.subscription_id);
    end if;
    return jsonb_build_object('handled', true, 'forbidden', true);
  end if;

  select * into v_plan from public.plans where id = v_payment.plan_id;
  if not found then
    return jsonb_build_object('handled', true, 'notFound', true);
  end if;

  v_cycle := coalesce(v_payment.billing_cycle, 'monthly');
  if v_cycle not in ('monthly', 'yearly') then
    v_cycle := 'monthly';
  end if;

  -- Named subscription: same org only, never fall back. Null: org-scoped lookup.
  if v_payment.subscription_id is not null then
    select organization_id into v_sub_org
    from public.subscriptions
    where id = v_payment.subscription_id;
    if not found then
      return jsonb_build_object('handled', true, 'integrityError', true, 'notFound', true);
    end if;
    if v_sub_org is distinct from v_payment.organization_id then
      return jsonb_build_object('handled', true, 'forbidden', true);
    end if;
    v_sub_id := v_payment.subscription_id;
  else
    select id into v_sub_id
    from public.subscriptions
    where organization_id = v_payment.organization_id
      and status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED')
    order by
      case status
        when 'ACTIVE' then 0
        when 'PAST_DUE' then 1
        when 'TRIAL' then 2
        when 'PAYMENT_FAILED' then 3
        when 'PAUSED' then 4
        when 'EXPIRED' then 5
        when 'CANCELLED' then 6
        else 7
      end,
      created_at desc,
      id desc
    limit 1;
  end if;

  if v_sub_id is null then
    -- Workspace never had a subscription row: create it inside this transaction.
    insert into public.subscriptions (
      organization_id, plan_id, billing_cycle, status, amount_paise, order_limit,
      current_period_start, current_period_end
    ) values (
      v_payment.organization_id, v_plan.id, v_cycle, 'EXPIRED', v_payment.amount_paise,
      v_plan.monthly_order_limit, now(), now()
    )
    returning id into v_sub_id;
    v_created := true;
  end if;

  select * into v_sub
  from public.subscriptions
  where id = v_sub_id
    and organization_id = v_payment.organization_id
  for update;

  if not found then
    return jsonb_build_object('handled', true, 'notFound', true);
  end if;

  update public.payments
  set status = 'CAPTURED',
      razorpay_payment_id = p_razorpay_payment_id,
      method = coalesce(p_method, method),
      paid_at = coalesce(paid_at, now()),
      failure_reason = null,
      subscription_id = v_sub.id,
      plan_id = v_plan.id
  where id = v_payment.id
    and status = 'PENDING'
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('handled', true, 'duplicate', true, 'subscriptionId', v_sub.id);
  end if;

  -- Keep unused paid time: a renewal or upgrade bought before the current paid
  -- period ends extends from now by the remaining paid days. Trial or unpaid
  -- (admin) time is not carried over.
  if v_sub.status = 'ACTIVE'
     and v_sub.razorpay_subscription_id is null
     and v_sub.current_period_end is not null
     and v_sub.current_period_end > now()
     and exists (
       select 1 from public.payments p
       where p.subscription_id = v_sub.id
         and p.id <> v_payment.id
         and p.status = 'CAPTURED'
         and coalesce(p.payment_purpose, 'subscription') = 'subscription'
     ) then
    v_carry := v_sub.current_period_end - now();
  end if;

  v_start := now();
  if v_cycle = 'yearly' then
    v_end := v_start + interval '1 year' + v_carry;
  else
    v_end := v_start + interval '1 month' + v_carry;
  end if;

  update public.subscriptions
  set status = 'ACTIVE',
      plan_id = v_plan.id,
      billing_cycle = v_cycle,
      amount_paise = v_payment.amount_paise,
      order_limit = v_plan.monthly_order_limit,
      started_at = coalesce(started_at, v_start),
      current_period_start = v_start,
      current_period_end = v_end,
      renews_at = v_end,
      expires_at = v_end,
      cancel_at_period_end = false,
      cancelled_at = null,
      pending_plan_id = null,
      pending_billing_cycle = null,
      updated_at = now()
  where id = v_sub.id;

  insert into public.billing_usage (
    organization_id, subscription_id, period_start, period_end, orders_used, order_limit
  ) values (
    v_sub.organization_id, v_sub.id, v_start::date, v_end::date, 0, v_plan.monthly_order_limit
  )
  on conflict (organization_id, period_start) do update set
    subscription_id = excluded.subscription_id,
    period_end = excluded.period_end,
    order_limit = excluded.order_limit,
    updated_at = now();

  insert into public.payment_attempts (
    organization_id, purchase_id, razorpay_order_id, razorpay_payment_id, status,
    amount_paise, currency, method, source
  ) values (
    v_payment.organization_id, v_payment.id, p_razorpay_order_id, p_razorpay_payment_id, 'CAPTURED',
    v_payment.amount_paise, coalesce(v_payment.currency, 'INR'), p_method,
    case when coalesce(p_reason, '') like 'reconcile%' then 'reconcile'
         when coalesce(p_reason, '') like 'payment.%' then 'webhook'
         else 'verify' end
  )
  on conflict (razorpay_payment_id) do update set
    status = 'CAPTURED',
    purchase_id = excluded.purchase_id,
    organization_id = excluded.organization_id,
    method = coalesce(excluded.method, payment_attempts.method),
    updated_at = now();

  insert into public.subscription_history (
    organization_id, subscription_id, from_status, to_status, from_plan_id, to_plan_id, reason, actor, metadata
  ) values (
    v_sub.organization_id, v_sub.id, case when v_created then null else v_sub.status end, 'ACTIVE',
    case when v_created then null else v_sub.plan_id end, v_plan.id,
    coalesce(p_reason, 'checkout_verified'), coalesce(p_actor, 'SYSTEM'),
    jsonb_build_object(
      'purchaseId', v_payment.id,
      'razorpayOrderId', p_razorpay_order_id,
      'previousPeriodEnd', v_sub.current_period_end,
      'carriedSeconds', extract(epoch from v_carry)::bigint
    )
  );

  return jsonb_build_object(
    'handled', true,
    'granted', true,
    'subscriptionId', v_sub.id,
    'planId', v_plan.id,
    'periodEnd', v_end
  );
end;
$$;

revoke all on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) from public;
revoke all on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) from anon;
revoke all on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) from authenticated;
grant execute on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) to service_role;
