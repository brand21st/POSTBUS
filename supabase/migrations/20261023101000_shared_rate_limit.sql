-- Fixed-window rate limit counters shared by every web instance (the in-memory limiter is per process).

create table if not exists public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;
grant all on public.rate_limit_buckets to service_role;

create or replace function public.hit_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case
          when b.window_start <= now() - make_interval(secs => p_window_seconds) then 1
          else b.hits + 1
        end,
        window_start = case
          when b.window_start <= now() - make_interval(secs => p_window_seconds) then now()
          else b.window_start
        end
  returning b.hits into v_hits;

  allowed := v_hits <= p_limit;
  remaining := greatest(p_limit - v_hits, 0);
  return next;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
