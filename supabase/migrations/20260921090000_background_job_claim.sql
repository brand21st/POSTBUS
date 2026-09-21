-- Durable job claiming for the database-backed job runner.
--
-- Redis/BullMQ enqueue is best effort: when Redis is unreachable the job row is
-- still written to background_jobs. This function is the path that guarantees
-- such a row is eventually executed, and it also recovers jobs whose runner
-- died mid-flight (status RUNNING with a stale lock).

create or replace function public.claim_background_jobs(
  p_limit integer default 5,
  p_stale_after interval default interval '15 minutes'
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

revoke all on function public.claim_background_jobs(integer, interval) from public;
revoke all on function public.claim_background_jobs(integer, interval) from anon;
revoke all on function public.claim_background_jobs(integer, interval) from authenticated;
grant execute on function public.claim_background_jobs(integer, interval) to service_role;

-- Jobs that stay claimable for a long time mean no runner is reaching the queue.
create or replace function public.count_overdue_background_jobs(
  p_older_than interval default interval '10 minutes'
)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)
  from public.background_jobs c
  where c.attempt_count < c.max_attempts
    and c.status in ('PENDING', 'QUEUED', 'RETRYING')
    and coalesce(c.next_attempt_at, c.created_at) < now() - p_older_than;
$$;

revoke all on function public.count_overdue_background_jobs(interval) from public;
revoke all on function public.count_overdue_background_jobs(interval) from anon;
revoke all on function public.count_overdue_background_jobs(interval) from authenticated;
grant execute on function public.count_overdue_background_jobs(interval) to service_role;

create index if not exists jobs_claimable_idx
  on public.background_jobs (status, created_at)
  where status in ('PENDING', 'QUEUED', 'RETRYING');
