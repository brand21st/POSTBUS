-- Per India Post connection session lease. Serializes AUTH02 refresh / AUTH01
-- login across processes without taking the booking lock.

alter table public.india_post_connections
  add column if not exists session_lock_token uuid,
  add column if not exists session_lock_expires_at timestamptz;

comment on column public.india_post_connections.session_lock_token is
  'Lease token for in-flight CEPT AUTH01/AUTH02. Null when unlocked.';
comment on column public.india_post_connections.session_lock_expires_at is
  'When the session lease may be stolen after a worker crash.';

create or replace function public.acquire_india_post_session_lock(
  p_connection_id uuid,
  p_ttl_seconds integer default 25
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_ttl interval := make_interval(secs => greatest(5, least(coalesce(p_ttl_seconds, 25), 120)));
  v_updated integer;
begin
  update public.india_post_connections
  set session_lock_token = v_token,
      session_lock_expires_at = now() + v_ttl
  where id = p_connection_id
    and (session_lock_expires_at is null or session_lock_expires_at < now());
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return v_token;
  end if;
  return null;
end;
$$;

create or replace function public.release_india_post_session_lock(
  p_connection_id uuid,
  p_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.india_post_connections
  set session_lock_token = null,
      session_lock_expires_at = null
  where id = p_connection_id
    and session_lock_token = p_token;
end;
$$;

revoke all on function public.acquire_india_post_session_lock(uuid, integer) from public;
revoke all on function public.acquire_india_post_session_lock(uuid, integer) from anon;
revoke all on function public.acquire_india_post_session_lock(uuid, integer) from authenticated;
grant execute on function public.acquire_india_post_session_lock(uuid, integer) to service_role;

revoke all on function public.release_india_post_session_lock(uuid, uuid) from public;
revoke all on function public.release_india_post_session_lock(uuid, uuid) from anon;
revoke all on function public.release_india_post_session_lock(uuid, uuid) from authenticated;
grant execute on function public.release_india_post_session_lock(uuid, uuid) to service_role;
