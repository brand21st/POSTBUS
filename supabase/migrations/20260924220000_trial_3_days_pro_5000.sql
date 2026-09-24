update public.platform_settings
set trial_days = 3, updated_at = now()
where id = 1;

alter table public.platform_settings
  alter column trial_days set default 3;

update public.plans
set
  monthly_order_limit = 5000,
  features = '[
    "Up to 5,000 orders per billing period",
    "Everything in Starter",
    "Bulk shipping tools",
    "Automation rules",
    "Manifest management"
  ]'::jsonb
where slug = 'pro';

update public.subscriptions s
set order_limit = 5000
from public.plans p
where s.plan_id = p.id
  and p.slug = 'pro'
  and s.status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED');

update public.billing_usage u
set order_limit = 5000
from public.subscriptions s
join public.plans p on p.id = s.plan_id
where u.subscription_id = s.id
  and p.slug = 'pro'
  and u.period_end >= current_date;

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
