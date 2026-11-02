-- Atomic captured-subscription activation. Service-role only.
-- Apply before deploying fulfillCapturedSubscriptionPurchase RPC callers.
-- Do not apply from a developer workstation until authorized.
-- Does not create the payments.razorpay_order_id unique index (blocked by a known duplicate).

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
set search_path = public
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
  v_period_start date;
  v_period_end date;
begin
  if p_razorpay_order_id is null or length(btrim(p_razorpay_order_id)) = 0 then
    return jsonb_build_object('handled', false, 'notFound', true);
  end if;

  perform 1
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
  for update;

  select count(*)::int into v_count
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
    and coalesce(payment_purpose, 'subscription') = 'subscription';

  if v_count > 1 then
    return jsonb_build_object('handled', true, 'ambiguous', true, 'count', v_count);
  end if;

  select * into v_payment
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
    and coalesce(payment_purpose, 'subscription') = 'subscription'
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

  select * into v_plan from public.plans where id = v_payment.plan_id;
  if not found then
    return jsonb_build_object('handled', true, 'notFound', true);
  end if;

  v_cycle := coalesce(v_payment.billing_cycle, 'monthly');
  if v_cycle not in ('monthly', 'yearly') then
    v_cycle := 'monthly';
  end if;

  if v_payment.subscription_id is not null then
    select * into v_sub
    from public.subscriptions
    where id = v_payment.subscription_id
      and organization_id = v_payment.organization_id
    for update;
  end if;

  if v_sub.id is null then
    select * into v_sub
    from public.subscriptions
    where organization_id = v_payment.organization_id
      and status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED')
    order by created_at desc
    limit 1
    for update;
  end if;

  if v_sub.id is null then
    return jsonb_build_object('handled', true, 'notFound', true);
  end if;

  if v_payment.status = 'CAPTURED' then
    if v_payment.razorpay_payment_id is null
       or v_payment.razorpay_payment_id = p_razorpay_payment_id then
      return jsonb_build_object(
        'handled', true,
        'duplicate', true,
        'subscriptionId', v_sub.id
      );
    end if;
    return jsonb_build_object('handled', true, 'forbidden', true);
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
    return jsonb_build_object(
      'handled', true,
      'duplicate', true,
      'subscriptionId', v_sub.id
    );
  end if;

  v_start := now();
  if v_cycle = 'yearly' then
    v_end := v_start + interval '1 year';
  else
    v_end := v_start + interval '1 month';
  end if;
  v_period_start := v_start::date;
  v_period_end := v_end::date;

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
    v_sub.organization_id, v_sub.id, v_period_start, v_period_end, 0, v_plan.monthly_order_limit
  )
  on conflict (organization_id, period_start) do update set
    subscription_id = excluded.subscription_id,
    period_end = excluded.period_end,
    order_limit = excluded.order_limit,
    updated_at = now();

  insert into public.subscription_history (
    organization_id, subscription_id, from_status, to_status, from_plan_id, to_plan_id, reason, actor
  ) values (
    v_sub.organization_id, v_sub.id, v_sub.status, 'ACTIVE', v_sub.plan_id, v_plan.id,
    coalesce(p_reason, 'checkout_verified'), coalesce(p_actor, 'SYSTEM')
  );

  return jsonb_build_object(
    'handled', true,
    'granted', true,
    'subscriptionId', v_sub.id,
    'planId', v_plan.id
  );
end;
$$;

revoke all on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) from public;
revoke all on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) from anon;
revoke all on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) from authenticated;
grant execute on function public.fulfill_captured_subscription_purchase(text, text, bigint, text, text, uuid, text, text) to service_role;
