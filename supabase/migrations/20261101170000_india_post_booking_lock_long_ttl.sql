-- Let a booking lease outlive a large booking POST. The lease must last longer than
-- the request timeout, or a second worker could take the lock while CEPT is still
-- processing the first request. JSON bulk times out at 120 s and file bulk at 280 s
-- (modules/india-post/http.ts), so the ceiling rises from 120 s to 330 s.
-- The default stays 45 s, which is what single-article bookings request.

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
  v_ttl interval := make_interval(secs => greatest(5, least(coalesce(p_ttl_seconds, 45), 330)));
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

revoke all on function public.acquire_india_post_booking_lock(uuid, integer) from public;
revoke all on function public.acquire_india_post_booking_lock(uuid, integer) from anon;
revoke all on function public.acquire_india_post_booking_lock(uuid, integer) from authenticated;
grant execute on function public.acquire_india_post_booking_lock(uuid, integer) to service_role;
