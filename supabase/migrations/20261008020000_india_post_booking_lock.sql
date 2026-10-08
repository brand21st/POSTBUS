-- Per India Post connection booking lease. Serializes CEPT book POSTs across
-- processes without a global mutex. Expired leases are stealable so a crashed
-- worker cannot deadlock the merchant.

alter table public.india_post_connections
  add column if not exists booking_lock_token uuid,
  add column if not exists booking_lock_expires_at timestamptz;

comment on column public.india_post_connections.booking_lock_token is
  'Lease token for the in-flight CEPT booking POST. Null when unlocked.';
comment on column public.india_post_connections.booking_lock_expires_at is
  'When the booking lease may be stolen after a worker crash.';

create or replace function public.acquire_india_post_booking_lock(
  p_organization_id uuid,
  p_ttl_seconds integer default 45
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_ttl interval := make_interval(secs => greatest(5, least(coalesce(p_ttl_seconds, 45), 120)));
  v_updated integer;
begin
  update public.india_post_connections
  set booking_lock_token = v_token,
      booking_lock_expires_at = now() + v_ttl
  where organization_id = p_organization_id
    and (booking_lock_expires_at is null or booking_lock_expires_at < now());
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return v_token;
  end if;
  return null;
end;
$$;

create or replace function public.release_india_post_booking_lock(
  p_organization_id uuid,
  p_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.india_post_connections
  set booking_lock_token = null,
      booking_lock_expires_at = null
  where organization_id = p_organization_id
    and booking_lock_token = p_token;
end;
$$;

revoke all on function public.acquire_india_post_booking_lock(uuid, integer) from public;
revoke all on function public.acquire_india_post_booking_lock(uuid, integer) from anon;
revoke all on function public.acquire_india_post_booking_lock(uuid, integer) from authenticated;
grant execute on function public.acquire_india_post_booking_lock(uuid, integer) to service_role;

revoke all on function public.release_india_post_booking_lock(uuid, uuid) from public;
revoke all on function public.release_india_post_booking_lock(uuid, uuid) from anon;
revoke all on function public.release_india_post_booking_lock(uuid, uuid) from authenticated;
grant execute on function public.release_india_post_booking_lock(uuid, uuid) to service_role;
