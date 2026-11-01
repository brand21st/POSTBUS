-- Cross-process lease for Shopify offline token refresh. Shopify rotates refresh tokens,
-- so two web instances refreshing at once would burn the token and force a reauth.

alter table public.shopify_app_installations
  add column if not exists token_version integer not null default 0,
  add column if not exists token_refresh_lease_until timestamptz;

create or replace function public.claim_shopify_token_refresh(
  p_installation_id uuid,
  p_expected_version integer,
  p_lease_seconds integer default 30
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
     set token_refresh_lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
   where id = p_installation_id
     and token_version = p_expected_version
     and (token_refresh_lease_until is null or token_refresh_lease_until < now())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_shopify_token_refresh(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_shopify_token_refresh(uuid, integer, integer) to service_role;
