-- Unique workspace slugs when two merchants pick the same name.

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
begin
  if v_user is null then
    raise exception 'Not authenticated';
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

  update public.profiles
    set active_organization_id = v_org.id
    where id = v_user;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_org.id, v_user, 'organization.created', 'organization', v_org.id, jsonb_build_object('name', p_name));

  return v_org;
end;
$$;
