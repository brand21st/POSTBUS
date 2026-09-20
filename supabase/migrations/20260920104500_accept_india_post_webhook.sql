create or replace function public.accept_india_post_webhook(
  p_connection_id uuid,
  p_channel text,
  p_raw_payload jsonb,
  p_payload_hash text,
  p_tracking_number text default null,
  p_event_code text default null,
  p_event_timestamp timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_existing uuid;
  v_id uuid;
begin
  if p_channel not in ('booking', 'events') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;

  select organization_id into v_org
  from public.india_post_connections
  where id = p_connection_id;

  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select id into v_existing
  from public.provider_webhook_inbox
  where organization_id = v_org
    and payload_hash = p_payload_hash
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'inbox_event_id', v_existing,
      'organization_id', v_org
    );
  end if;

  insert into public.provider_webhook_inbox (
    organization_id,
    connection_id,
    provider,
    channel,
    tracking_number,
    event_code,
    event_timestamp,
    payload_hash,
    raw_payload,
    process_status
  ) values (
    v_org,
    p_connection_id,
    'INDIA_POST',
    p_channel,
    p_tracking_number,
    p_event_code,
    p_event_timestamp,
    p_payload_hash,
    coalesce(p_raw_payload, '{}'::jsonb),
    'PENDING'
  )
  returning id into v_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'inbox_event_id', v_id,
    'organization_id', v_org
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'inbox_event_id', null,
      'organization_id', v_org
    );
end;
$$;

revoke all on function public.accept_india_post_webhook(uuid, text, jsonb, text, text, text, timestamptz) from public;
grant execute on function public.accept_india_post_webhook(uuid, text, jsonb, text, text, text, timestamptz) to anon, authenticated, service_role;
