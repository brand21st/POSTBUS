-- One Supabase auth user ("principal") per Shopify app installation. The embedded app has no
-- Supabase cookie session, so it signs in as this principal and the existing v1 handlers run
-- under the same RLS as dashboard users. Shopify staff identities are tracked separately.

alter table public.shopify_app_installations
  add column if not exists principal_user_id uuid references auth.users(id) on delete set null,
  add column if not exists encrypted_principal_secret text,
  add column if not exists encrypted_principal_session text,
  add column if not exists principal_session_expires_at timestamptz,
  add column if not exists principal_session_version integer not null default 0,
  add column if not exists principal_session_lease_until timestamptz;

create unique index if not exists shopify_app_installations_principal_uidx
  on public.shopify_app_installations (principal_user_id)
  where principal_user_id is not null;

create table if not exists public.shopify_app_staff (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.shopify_app_installations(id) on delete cascade,
  shopify_user_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (installation_id, shopify_user_id)
);

alter table public.shopify_app_staff enable row level security;
revoke all on public.shopify_app_staff from anon, authenticated;
grant all on public.shopify_app_staff to service_role;

-- Attaches a freshly created principal unless another process won the race, and (re)grants its
-- membership in the installation's organization. Returns the principal that is now in effect.
create or replace function public.attach_shopify_app_principal(
  p_installation_id uuid,
  p_user_id uuid,
  p_encrypted_secret text,
  p_role public.member_role
)
returns table (principal_user_id uuid, attached boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_org uuid;
begin
  select i.principal_user_id, i.organization_id
    into v_existing, v_org
  from public.shopify_app_installations i
  where i.id = p_installation_id
  for update;

  if v_org is null then
    raise exception 'installation not found';
  end if;

  if v_existing is null then
    update public.shopify_app_installations
       set principal_user_id = p_user_id,
           encrypted_principal_secret = p_encrypted_secret,
           encrypted_principal_session = null,
           principal_session_expires_at = null,
           principal_session_version = principal_session_version + 1,
           principal_session_lease_until = null
     where id = p_installation_id;
    v_existing := p_user_id;
    attached := true;
  else
    attached := false;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_existing, p_role)
  on conflict (organization_id, user_id) do nothing;

  principal_user_id := v_existing;
  return next;
end;
$$;

create or replace function public.claim_shopify_principal_session(
  p_installation_id uuid,
  p_expected_version integer,
  p_lease_seconds integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  update public.shopify_app_installations
     set principal_session_lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
   where id = p_installation_id
     and principal_session_version = p_expected_version
     and (principal_session_lease_until is null or principal_session_lease_until < now())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.attach_shopify_app_principal(uuid, uuid, text, public.member_role) from public, anon, authenticated;
grant execute on function public.attach_shopify_app_principal(uuid, uuid, text, public.member_role) to service_role;
revoke all on function public.claim_shopify_principal_session(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_shopify_principal_session(uuid, integer, integer) to service_role;
