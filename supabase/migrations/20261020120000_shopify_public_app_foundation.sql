-- Additive Shopify public-app foundation. Do not apply to production without approval.

alter table public.organizations
  add column if not exists origin text not null default 'WEB';

do $$ begin
  alter table public.organizations
    add constraint organizations_origin_check
    check (origin in ('WEB', 'SHOPIFY_PUBLIC_APP'));
exception when duplicate_object then null;
end $$;

create table if not exists public.shopify_app_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  shop_domain text not null,
  shopify_shop_id text,
  app_client_id text not null,
  status text not null default 'PENDING',
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  granted_scopes text,
  last_shopify_user_id text,
  last_error text,
  installed_at timestamptz not null default now(),
  uninstalled_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopify_app_installations_status_check
    check (status in ('PENDING', 'CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR')),
  constraint shopify_app_installations_shop_domain_format
    check (shop_domain = lower(shop_domain))
);

create unique index if not exists shopify_app_installations_shop_app_uidx
  on public.shopify_app_installations (app_client_id, shop_domain);

create unique index if not exists shopify_app_installations_shop_uidx
  on public.shopify_app_installations (shop_domain);

create index if not exists shopify_app_installations_org_idx
  on public.shopify_app_installations (organization_id);

drop trigger if exists shopify_app_installations_updated_at on public.shopify_app_installations;
create trigger shopify_app_installations_updated_at
  before update on public.shopify_app_installations
  for each row execute function public.set_updated_at();

create table if not exists public.shopify_compliance_requests (
  id uuid primary key default gen_random_uuid(),
  webhook_id text not null unique,
  topic text not null,
  shop_domain text,
  payload_hash text not null,
  status text not null default 'RECEIVED',
  notes text,
  created_at timestamptz not null default now(),
  constraint shopify_compliance_requests_status_check
    check (status in ('RECEIVED', 'PENDING_REVIEW', 'COMPLETED'))
);

create table if not exists public.shopify_app_webhook_deliveries (
  id text primary key,
  topic text not null,
  shop_domain text,
  status text not null default 'SUCCEEDED',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.shopify_app_installations enable row level security;
alter table public.shopify_compliance_requests enable row level security;
alter table public.shopify_app_webhook_deliveries enable row level security;

revoke all on public.shopify_app_installations from anon, authenticated;
revoke all on public.shopify_compliance_requests from anon, authenticated;
revoke all on public.shopify_app_webhook_deliveries from anon, authenticated;
grant all on public.shopify_app_installations to service_role;
grant all on public.shopify_compliance_requests to service_role;
grant all on public.shopify_app_webhook_deliveries to service_role;

create or replace function public.provision_shopify_app_organization(
  p_shop_domain text,
  p_app_client_id text,
  p_name text
)
returns table (org_id uuid, install_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop text := lower(trim(p_shop_domain));
  v_client text := trim(p_app_client_id);
  v_name text := nullif(trim(p_name), '');
  v_slug text;
  v_org uuid;
  v_install uuid;
  v_created boolean := false;
begin
  if v_shop is null or v_shop = '' or v_client is null or v_client = '' then
    raise exception 'shop and app client id are required';
  end if;
  if v_shop not like '%.myshopify.com' then
    raise exception 'invalid shop domain';
  end if;
  v_name := coalesce(v_name, replace(v_shop, '.myshopify.com', ''));
  perform pg_advisory_xact_lock(('x' || substr(md5(v_shop), 1, 16))::bit(64)::bigint);

  select i.id, i.organization_id
    into v_install, v_org
  from public.shopify_app_installations i
  where i.shop_domain = v_shop
    and i.app_client_id = v_client
  limit 1;

  if v_install is not null then
    if (select i.status from public.shopify_app_installations i where i.id = v_install) = 'DISCONNECTED' then
      update public.shopify_app_installations
        set status = 'PENDING',
            uninstalled_at = null,
            installed_at = now()
      where id = v_install;
    end if;
    return query select v_org as org_id, v_install as install_id, false as is_new;
    return;
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(v_slug, 40);
  if v_slug is null or v_slug = '' then
    v_slug := 'shop';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := left(v_slug, 32) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  insert into public.organizations (name, slug, created_by, origin)
  values (v_name, v_slug, null, 'SHOPIFY_PUBLIC_APP')
  returning id into v_org;

  insert into public.automation_settings (organization_id)
  values (v_org)
  on conflict (organization_id) do nothing;

  insert into public.shopify_app_installations (
    organization_id, shop_domain, app_client_id, status
  ) values (v_org, v_shop, v_client, 'PENDING')
  returning id into v_install;

  v_created := true;
  return query select v_org as org_id, v_install as install_id, v_created as is_new;
end;
$$;

revoke all on function public.provision_shopify_app_organization(text, text, text) from public, anon, authenticated;
grant execute on function public.provision_shopify_app_organization(text, text, text) to service_role;
