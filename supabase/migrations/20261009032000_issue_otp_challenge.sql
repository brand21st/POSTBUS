-- One transaction per phone+purpose: lock, cooldown, rate buckets,
-- invalidate older challenges, insert exactly one pending row.
-- Lock keys are hashes. The phone number is not written to logs.

create or replace function public.issue_otp_challenge(
  p_id uuid,
  p_phone text,
  p_purpose text,
  p_hmac text,
  p_expires_at timestamptz,
  p_now timestamptz,
  p_max_attempts integer,
  p_signup jsonb,
  p_ip_hash text,
  p_user_agent text,
  p_phone_bucket text,
  p_ip_bucket text,
  p_window_starts_at timestamptz,
  p_phone_limit integer,
  p_ip_limit integer,
  p_cooldown_ms integer
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  recent timestamptz;
  phone_count integer;
  ip_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtext('postbus-otp-issue'),
    hashtext(p_phone || ':' || p_purpose)
  );

  select last_sent_at into recent
  from public.otp_challenges
  where phone_e164 = p_phone
    and purpose = p_purpose
    and status = 'pending'
  order by created_at desc
  limit 1;

  if recent is not null
     and recent > p_now - (p_cooldown_ms * interval '1 millisecond') then
    return 'cooldown';
  end if;

  phone_count := public.consume_otp_rate_bucket(p_phone_bucket, p_window_starts_at);
  ip_count := public.consume_otp_rate_bucket(p_ip_bucket, p_window_starts_at);
  if phone_count > p_phone_limit or ip_count > p_ip_limit then
    return 'rate_limited';
  end if;

  update public.otp_challenges
    set status = 'invalidated'
    where phone_e164 = p_phone
      and purpose = p_purpose
      and status in ('pending', 'verified');

  insert into public.otp_challenges (
    id,
    phone_e164,
    purpose,
    otp_hmac,
    expires_at,
    attempt_count,
    max_attempts,
    last_sent_at,
    verified_at,
    status,
    signup_payload,
    ip_hash,
    user_agent,
    created_at
  ) values (
    p_id,
    p_phone,
    p_purpose,
    p_hmac,
    p_expires_at,
    0,
    p_max_attempts,
    p_now,
    null,
    'pending',
    p_signup,
    p_ip_hash,
    left(coalesce(p_user_agent, ''), 160),
    p_now
  );

  return 'issued';
end;
$$;

revoke all on function public.issue_otp_challenge(
  uuid, text, text, text, timestamptz, timestamptz, integer, jsonb, text, text, text, text, timestamptz, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.issue_otp_challenge(
  uuid, text, text, text, timestamptz, timestamptz, integer, jsonb, text, text, text, text, timestamptz, integer, integer, integer
) to service_role;
