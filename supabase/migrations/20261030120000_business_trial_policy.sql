-- Business Plan trial policy: legacy orgs (IST join on or before 2026-10-26)
-- expire at 2026-11-01 00:00 Asia/Kolkata. Newer orgs get a 7-day trial from
-- organization.created_at. Idempotent: skip trial_cohort or trial_manual_override.
-- Do not insert a second live subscription.

update public.platform_settings
set trial_days = 7, updated_at = now()
where id = 1;

alter table public.platform_settings
  alter column trial_days set default 7;

alter table public.subscriptions
  add column if not exists trial_cohort text,
  add column if not exists trial_manual_override boolean not null default false;

alter table public.subscriptions drop constraint if exists subscriptions_trial_cohort_check;
alter table public.subscriptions
  add constraint subscriptions_trial_cohort_check
  check (trial_cohort is null or trial_cohort in ('legacy_nov1', 'rolling_7d'));

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
    v_period_end := now() + make_interval(days => coalesce(v_settings.trial_days, 7));
    insert into public.subscriptions (
      organization_id, plan_id, billing_cycle, status, amount_paise, order_limit,
      started_at, current_period_start, current_period_end, renews_at, expires_at,
      trial_start, trial_end, trial_cohort, trial_manual_override
    ) values (
      v_org.id, v_new_plan.id, 'monthly', 'TRIAL', 0, v_new_plan.monthly_order_limit,
      now(), now(), v_period_end, v_period_end, v_period_end,
      now(), v_period_end, 'rolling_7d', false
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

revoke all on function public.create_organization_for_user(text) from public;
grant execute on function public.create_organization_for_user(text) to authenticated;

with business_plan as (
  select id, monthly_order_limit
  from public.plans
  where is_active
  order by monthly_order_limit desc, display_order desc
  limit 1
), unpaid as (
  select s.id
  from public.subscriptions s
  where s.status in ('TRIAL', 'ACTIVE')
    and s.razorpay_subscription_id is null
    and coalesce(s.trial_manual_override, false) = false
    and s.trial_cohort is null
    and not exists (
      select 1
      from public.payments p
      where p.organization_id = s.organization_id
        and p.status = 'CAPTURED'
    )
)
update public.subscriptions s
set
  status = 'TRIAL',
  plan_id = business_plan.id,
  order_limit = business_plan.monthly_order_limit,
  amount_paise = 0,
  trial_start = coalesce(s.trial_start, o.created_at),
  trial_end = case
    when (timezone('Asia/Kolkata', o.created_at))::date <= date '2026-10-26'
      then timestamptz '2026-11-01 00:00:00+05:30'
    else o.created_at + interval '7 days'
  end,
  current_period_end = case
    when (timezone('Asia/Kolkata', o.created_at))::date <= date '2026-10-26'
      then timestamptz '2026-11-01 00:00:00+05:30'
    else o.created_at + interval '7 days'
  end,
  expires_at = case
    when (timezone('Asia/Kolkata', o.created_at))::date <= date '2026-10-26'
      then timestamptz '2026-11-01 00:00:00+05:30'
    else o.created_at + interval '7 days'
  end,
  renews_at = case
    when (timezone('Asia/Kolkata', o.created_at))::date <= date '2026-10-26'
      then timestamptz '2026-11-01 00:00:00+05:30'
    else o.created_at + interval '7 days'
  end,
  trial_cohort = case
    when (timezone('Asia/Kolkata', o.created_at))::date <= date '2026-10-26'
      then 'legacy_nov1'
    else 'rolling_7d'
  end,
  updated_at = now()
from unpaid, public.organizations o, business_plan
where s.id = unpaid.id
  and o.id = s.organization_id;

update public.billing_usage u
set
  period_end = s.current_period_end::date,
  order_limit = s.order_limit,
  updated_at = now()
from public.subscriptions s
where u.subscription_id = s.id
  and s.trial_cohort in ('legacy_nov1', 'rolling_7d')
  and u.period_end >= current_date;
