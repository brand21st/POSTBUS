-- Merchant Public API v1: scoped HMAC keys, idempotency fields, logs, rate buckets.
-- Additive and backward compatible. Do not apply to production from local development.

alter table public.api_keys
  add column if not exists scopes text[] not null default '{}'::text[],
  add column if not exists lookup_id text,
  add column if not exists hash_version text,
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

comment on column public.api_keys.scopes is 'Merchant API scopes. Empty/null-equivalent arrays cannot authenticate /api/merchant/v1.';
comment on column public.api_keys.lookup_id is 'Non-secret key identifier embedded in pb_live_<lookup>_<secret>.';
comment on column public.api_keys.hash_version is 'hmac-v1 for Merchant API keys. Legacy SHA-256 rows remain null.';

create unique index if not exists api_keys_lookup_id_uidx
  on public.api_keys (lookup_id)
  where lookup_id is not null;

alter table public.idempotency_keys
  add column if not exists operation text,
  add column if not exists processing_state text not null default 'completed',
  add column if not exists expires_at timestamptz;

alter table public.idempotency_keys
  drop constraint if exists idempotency_keys_processing_state_check;

alter table public.idempotency_keys
  add constraint idempotency_keys_processing_state_check
  check (processing_state in ('processing', 'completed', 'failed'));

create index if not exists orders_org_updated_id_idx
  on public.orders (organization_id, updated_at, id);

create table if not exists public.merchant_api_request_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  endpoint text not null,
  method text not null,
  response_status integer not null,
  duration_ms integer,
  request_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists merchant_api_request_logs_org_created_idx
  on public.merchant_api_request_logs (organization_id, created_at desc);

create table if not exists public.merchant_api_rate_buckets (
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket_key, window_start)
);

create or replace function public.merchant_api_consume_rate(
  p_bucket_key text,
  p_window_start timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.merchant_api_rate_buckets (bucket_key, window_start, count)
  values (p_bucket_key, p_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = public.merchant_api_rate_buckets.count + 1
  returning count into v_count;

  if v_count > p_limit then
    return v_count;
  end if;
  return v_count;
end;
$$;

revoke all on function public.merchant_api_consume_rate(text, timestamptz, integer) from public;
revoke all on function public.merchant_api_consume_rate(text, timestamptz, integer) from anon;
revoke all on function public.merchant_api_consume_rate(text, timestamptz, integer) from authenticated;
grant execute on function public.merchant_api_consume_rate(text, timestamptz, integer) to service_role;

alter table public.merchant_api_request_logs enable row level security;
alter table public.merchant_api_rate_buckets enable row level security;

drop policy if exists merchant_api_request_logs_select on public.merchant_api_request_logs;
create policy merchant_api_request_logs_select on public.merchant_api_request_logs
  for select using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

-- Rate buckets are service-role only; no authenticated policies.
