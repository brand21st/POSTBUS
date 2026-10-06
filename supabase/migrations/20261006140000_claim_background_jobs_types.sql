-- Typed SKIP LOCKED claim lanes for booking / label / other drains.
-- Keeps the existing 2-argument RPC by replacing it with a 3-argument function
-- whose third parameter defaults to null (unfiltered, same as today).

drop function if exists public.claim_background_jobs(integer, interval);

create or replace function public.claim_background_jobs(
  p_limit integer default 5,
  p_stale_after interval default interval '15 minutes',
  p_job_types text[] default null
)
returns setof public.background_jobs
language sql
security definer
set search_path = public
as $$
  update public.background_jobs as j
  set status = 'RUNNING',
      locked_at = now(),
      started_at = coalesce(j.started_at, now())
  where j.id in (
    select c.id
    from public.background_jobs c
    where c.attempt_count < c.max_attempts
      and (
        p_job_types is null
        or cardinality(p_job_types) = 0
        or c.job_type = any (p_job_types)
      )
      and (
        (c.status in ('PENDING', 'QUEUED') and (c.next_attempt_at is null or c.next_attempt_at <= now()))
        or (c.status = 'RETRYING' and coalesce(c.next_attempt_at, now()) <= now())
        or (c.status = 'RUNNING' and c.locked_at is not null and c.locked_at < now() - p_stale_after)
      )
    order by c.created_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

revoke all on function public.claim_background_jobs(integer, interval, text[]) from public;
revoke all on function public.claim_background_jobs(integer, interval, text[]) from anon;
revoke all on function public.claim_background_jobs(integer, interval, text[]) from authenticated;
grant execute on function public.claim_background_jobs(integer, interval, text[]) to service_role;

create index if not exists jobs_claimable_type_idx
  on public.background_jobs (job_type, status, created_at)
  where status in ('PENDING', 'QUEUED', 'RETRYING');
