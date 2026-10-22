alter table public.profiles
  add column if not exists india_post_onboarding_dismissed_at timestamptz;

-- First-time backfill only: existing customers should not see the modal.
-- Skip if any row is already stamped so later applies do not dismiss new signups.
do $$
begin
  if not exists (
    select 1
    from public.profiles
    where india_post_onboarding_dismissed_at is not null
  ) then
    update public.profiles
    set india_post_onboarding_dismissed_at = now();
  end if;
end $$;
