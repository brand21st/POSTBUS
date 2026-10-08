-- WhatsApp OTP challenges, rate buckets, phone identities, and audit events.
-- Service-role only. No anon/authenticated policies. profiles.whatsapp_number
-- is intentionally NOT unique here — live data already has duplicate numbers.

create table if not exists public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  purpose text not null,
  otp_hmac text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  last_sent_at timestamptz not null,
  verified_at timestamptz,
  status text not null default 'pending',
  signup_payload jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint otp_challenges_phone_format check (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  constraint otp_challenges_purpose check (
    purpose in ('LOGIN', 'SIGNUP', 'PHONE_VERIFICATION', 'SENSITIVE_ACTION')
  ),
  constraint otp_challenges_status check (
    status in ('pending', 'verified', 'expired', 'consumed', 'invalidated')
  ),
  constraint otp_challenges_attempts check (attempt_count >= 0 and max_attempts > 0)
);

create index if not exists otp_challenges_phone_purpose_idx
  on public.otp_challenges (phone_e164, purpose, status, created_at desc);

create index if not exists otp_challenges_expires_idx
  on public.otp_challenges (expires_at);

comment on table public.otp_challenges is
  'Hashed WhatsApp OTP challenges. Plaintext codes are never stored.';

create table if not exists public.otp_rate_buckets (
  bucket_key text not null,
  window_starts_at timestamptz not null,
  count integer not null default 0,
  primary key (bucket_key, window_starts_at)
);

comment on table public.otp_rate_buckets is
  'Cross-instance OTP send counters. Keyed by hashed phone or IP, never a raw address.';

create table if not exists public.phone_identities (
  phone_e164 text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint phone_identities_phone_format check (phone_e164 ~ '^\+91[6-9][0-9]{9}$')
);

comment on table public.phone_identities is
  'Canonical WhatsApp to auth.users map. One phone, one user.';

create table if not exists public.auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  phone_last4 text,
  purpose text,
  ip_hash text,
  outcome text,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists auth_audit_events_created_idx
  on public.auth_audit_events (created_at desc);

comment on table public.auth_audit_events is
  'Auth audit trail. Never store OTP, tokens, or full phone numbers.';

alter table public.otp_challenges enable row level security;
alter table public.otp_rate_buckets enable row level security;
alter table public.phone_identities enable row level security;
alter table public.auth_audit_events enable row level security;

revoke all on table public.otp_challenges from public, anon, authenticated;
revoke all on table public.otp_rate_buckets from public, anon, authenticated;
revoke all on table public.phone_identities from public, anon, authenticated;
revoke all on table public.auth_audit_events from public, anon, authenticated;

grant all on table public.otp_challenges to service_role;
grant all on table public.otp_rate_buckets to service_role;
grant all on table public.phone_identities to service_role;
grant all on table public.auth_audit_events to service_role;

-- Outcomes stay aligned with applyOtpAttempt in lib/auth/otp/attempt.ts.
create or replace function public.verify_otp_challenge(
  p_id uuid,
  p_phone text,
  p_purpose text,
  p_hmac text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.otp_challenges%rowtype;
  next_attempts integer;
begin
  select * into r
  from public.otp_challenges
  where id = p_id and phone_e164 = p_phone and purpose = p_purpose
  for update;

  if not found then
    return 'missing';
  end if;

  if r.status = 'invalidated' and r.attempt_count >= r.max_attempts then
    return 'locked';
  end if;

  if r.status <> 'pending' then
    return 'expired';
  end if;

  if r.expires_at <= now() then
    update public.otp_challenges set status = 'expired' where id = r.id;
    return 'expired';
  end if;

  if r.attempt_count >= r.max_attempts then
    update public.otp_challenges set status = 'invalidated' where id = r.id;
    return 'locked';
  end if;

  next_attempts := r.attempt_count + 1;

  if r.otp_hmac = p_hmac then
    update public.otp_challenges
      set status = 'verified',
          verified_at = now(),
          attempt_count = next_attempts
      where id = r.id;
    return 'matched';
  end if;

  if next_attempts >= r.max_attempts then
    update public.otp_challenges
      set status = 'invalidated',
          attempt_count = next_attempts
      where id = r.id;
    return 'mismatch';
  end if;

  update public.otp_challenges
    set attempt_count = next_attempts
    where id = r.id;
  return 'mismatch';
end;
$$;

revoke all on function public.verify_otp_challenge(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.verify_otp_challenge(uuid, text, text, text) to service_role;

create or replace function public.consume_otp_rate_bucket(
  p_bucket_key text,
  p_window_starts_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.otp_rate_buckets (bucket_key, window_starts_at, count)
  values (p_bucket_key, p_window_starts_at, 1)
  on conflict (bucket_key, window_starts_at)
  do update set count = public.otp_rate_buckets.count + 1
  returning count into next_count;
  return next_count;
end;
$$;

revoke all on function public.consume_otp_rate_bucket(text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_otp_rate_bucket(text, timestamptz) to service_role;
