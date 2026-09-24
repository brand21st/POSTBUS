with top_plan as (
  select id, monthly_order_limit
  from public.plans
  where is_active
  order by monthly_order_limit desc, display_order desc
  limit 1
)
update public.subscriptions s
set
  plan_id = top_plan.id,
  order_limit = top_plan.monthly_order_limit,
  amount_paise = 0
from top_plan
where s.status = 'TRIAL';

update public.billing_usage u
set order_limit = s.order_limit
from public.subscriptions s
where u.subscription_id = s.id
  and s.status = 'TRIAL'
  and u.period_end >= current_date;

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
    order_limit = excluded.order_limit
  returning * into v_usage;

  return v_usage;
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
  select * into v_new_plan
  from public.plans
  where is_active
  order by monthly_order_limit desc, display_order desc
  limit 1;
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
    v_period_end := now() + make_interval(days => coalesce(v_settings.trial_days, 3));
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
    on conflict (organization_id, period_start) do update set
      subscription_id = excluded.subscription_id,
      period_end = excluded.period_end,
      order_limit = excluded.order_limit;

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
