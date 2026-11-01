-- Independent historical lookback clock (overlap last_success_at must not reset this).
-- Distributed Event Download lease: one CEPT fetch per org + Cust_Id + LE + date.

create table if not exists public.tracking_lookback_state (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cust_id text not null,
  event_code text not null default 'LE',
  last_lookback_attempt_at timestamptz,
  last_lookback_success_at timestamptz,
  last_lookback_http_status integer,
  updated_at timestamptz not null default now(),
  primary key (organization_id, cust_id, event_code),
  constraint tracking_lookback_state_event_code_chk check (event_code in ('LE', 'IB'))
);

alter table public.tracking_lookback_state enable row level security;

drop policy if exists tracking_lookback_state_tenant_all on public.tracking_lookback_state;
create policy tracking_lookback_state_tenant_all on public.tracking_lookback_state
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

comment on table public.tracking_lookback_state is
  'Org-level Event Download historical reconciliation clock. Independent of overlap last_success_at.';

create table if not exists public.tracking_event_download_leases (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cust_id text not null,
  event_code text not null default 'LE',
  event_date text not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, cust_id, event_code, event_date),
  constraint tracking_event_download_leases_event_date_chk check (event_date ~ '^[0-9]{8}$'),
  constraint tracking_event_download_leases_event_code_chk check (event_code in ('LE', 'IB'))
);

alter table public.tracking_event_download_leases enable row level security;

drop policy if exists tracking_event_download_leases_tenant_all on public.tracking_event_download_leases;
create policy tracking_event_download_leases_tenant_all on public.tracking_event_download_leases
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

comment on table public.tracking_event_download_leases is
  'Steal-on-expiry lease for POST /v1/event/download. Released after HTTP; never held inside a long transaction.';

create or replace function public.acquire_tracking_event_download_lock(
  p_organization_id uuid,
  p_cust_id text,
  p_event_code text,
  p_event_date text,
  p_ttl_seconds integer default 90
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_ttl interval := make_interval(secs => greatest(5, least(coalesce(p_ttl_seconds, 90), 180)));
  v_updated integer;
begin
  insert into public.tracking_event_download_leases (
    organization_id, cust_id, event_code, event_date, lease_token, lease_expires_at, updated_at
  )
  values (
    p_organization_id, p_cust_id, coalesce(p_event_code, 'LE'), p_event_date, v_token, now() + v_ttl, now()
  )
  on conflict (organization_id, cust_id, event_code, event_date)
  do update
    set lease_token = excluded.lease_token,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = now()
    where public.tracking_event_download_leases.lease_expires_at is null
       or public.tracking_event_download_leases.lease_expires_at < now();

  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return v_token;
  end if;
  return null;
end;
$$;

create or replace function public.release_tracking_event_download_lock(
  p_organization_id uuid,
  p_cust_id text,
  p_event_code text,
  p_event_date text,
  p_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tracking_event_download_leases
  set lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where organization_id = p_organization_id
    and cust_id = p_cust_id
    and event_code = coalesce(p_event_code, 'LE')
    and event_date = p_event_date
    and lease_token = p_token;
end;
$$;

revoke all on function public.acquire_tracking_event_download_lock(uuid, text, text, text, integer) from public;
revoke all on function public.acquire_tracking_event_download_lock(uuid, text, text, text, integer) from anon;
revoke all on function public.acquire_tracking_event_download_lock(uuid, text, text, text, integer) from authenticated;
grant execute on function public.acquire_tracking_event_download_lock(uuid, text, text, text, integer) to service_role;

revoke all on function public.release_tracking_event_download_lock(uuid, text, text, text, uuid) from public;
revoke all on function public.release_tracking_event_download_lock(uuid, text, text, text, uuid) from anon;
revoke all on function public.release_tracking_event_download_lock(uuid, text, text, text, uuid) from authenticated;
grant execute on function public.release_tracking_event_download_lock(uuid, text, text, text, uuid) to service_role;
