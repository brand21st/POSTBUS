-- Booking reliability, Phase 0: dispatch_booking_run must not erase booking evidence.
--
-- The previous version set any DRAFT/VALIDATING/FAILED shipment to QUEUED and cleared its
-- last_error_code, including rows with ceptSubmitIntentAt (a CEPT POST may have happened) and rows
-- whose barcode has no "never submitted" proof. Those rows are now skipped (SHIPMENT_NOT_READY)
-- and keep their status and error. The never-submitted codes mirror NEVER_SUBMITTED_CODES in
-- modules/india-post/booking-retry-eligibility.ts.
--
-- Same signature, so existing grants (service_role only) are kept by create or replace.

create or replace function public.dispatch_booking_run(
  p_organization_id uuid,
  p_item_ids uuid[],
  p_idempotency_key text,
  p_trigger text default 'MANUAL',
  p_group_key text default 'MANUAL',
  p_created_by uuid default null,
  p_settings_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_item record;
  v_job uuid;
  v_dispatched jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  v_count integer := 0;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'dispatch needs an idempotency key';
  end if;
  if p_trigger not in ('MANUAL', 'AUTO_THRESHOLD', 'AUTO_TIMEOUT') then
    raise exception 'unknown dispatch trigger %', p_trigger;
  end if;
  if coalesce(cardinality(p_item_ids), 0) = 0 then
    return jsonb_build_object('runId', null, 'replayed', false, 'dispatched', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  -- Automatic runs respect mode, pause and the circuit breaker. A person can still book manually.
  if p_trigger <> 'MANUAL' and not exists (
    select 1 from public.booking_automation_settings s
     where s.organization_id = p_organization_id
       and s.mode = 'AUTOMATIC'
       and s.paused_at is null
       and (s.auto_hold_until is null or s.auto_hold_until <= now())
  ) then
    return jsonb_build_object('runId', null, 'paused', true, 'dispatched', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  -- Same key, same run: a double click or a retried request never dispatches twice.
  insert into public.booking_runs (organization_id, trigger, idempotency_key, group_key, settings_version, status, created_by)
  values (p_organization_id, p_trigger, btrim(p_idempotency_key), coalesce(nullif(btrim(p_group_key), ''), 'MANUAL'),
          p_settings_version, 'DISPATCHING', p_created_by)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_run;
  if v_run is null then
    select id into v_run from public.booking_runs
     where organization_id = p_organization_id and idempotency_key = btrim(p_idempotency_key);
    return jsonb_build_object(
      'runId', v_run,
      'replayed', true,
      'dispatched', coalesce((
        select jsonb_agg(jsonb_build_object('itemId', i.id, 'shipmentId', i.shipment_id))
          from public.booking_queue_items i
         where i.organization_id = p_organization_id and i.run_id = v_run
      ), '[]'::jsonb),
      'skipped', '[]'::jsonb
    );
  end if;

  for v_item in
    select i.id, i.shipment_id, s.status as ship_status, s.booked_at
      from public.booking_queue_items i
      join public.shipments s on s.id = i.shipment_id
     where i.organization_id = p_organization_id
       and s.organization_id = p_organization_id
       and i.id = any(p_item_ids)
       and i.state = 'READY_FOR_BOOKING'
     order by i.ready_at nulls last, i.id
     for update of i skip locked
  loop
    v_seen := v_seen || v_item.id;
    if v_item.booked_at is not null or v_item.ship_status not in ('DRAFT', 'VALIDATING', 'FAILED') then
      v_skipped := v_skipped || jsonb_build_object('itemId', v_item.id, 'reason', 'SHIPMENT_NOT_READY');
      continue;
    end if;

    -- Requeue only a shipment that cannot already be at India Post. Submit intent, a tracking
    -- number or a booking reference means a POST may have happened: leave the row (and its
    -- error) as evidence. A barcode is reused only with a creation-time proof or a "never
    -- submitted" error code; the code stays because the booking run reads it before reuse.
    update public.shipments
       set status = 'QUEUED',
           last_error = null,
           last_error_code = case when barcode is null then null else last_error_code end
     where id = v_item.shipment_id
       and organization_id = p_organization_id
       and booked_at is null
       and status in ('DRAFT', 'VALIDATING', 'FAILED')
       and coalesce(metadata->>'ceptSubmitIntentAt', '') = ''
       and tracking_number is null
       and coalesce(btrim(provider_ref), '') = ''
       and (
         barcode is null
         -- Barcode written when the shipment was created; the booking run verifies its signature.
         or metadata ? 'bookingBarcodeProof'
         or last_error_code in (
           'PRE_POST_TRANSIENT', 'BULK_NOT_SUBMITTED', 'QUEUE_UNAVAILABLE', 'ECONNRESET', 'ENOTFOUND',
           'ECONNREFUSED', 'INVALID_PINCODE', 'INVALID_ADDRESS', 'INVALID_WEIGHT', 'INVALID_DIMENSIONS',
           'MISSING_MANDATORY_FIELD', 'INVALID_BARCODE', 'INVALID_CONTRACT', 'PERMANENT_AUTH_ERROR',
           'VALIDATION_ERROR', 'SHOPIFY_FULFILLMENT_BLOCKED', 'BILLING_LIMIT'
         )
       );
    if not found then
      v_skipped := v_skipped || jsonb_build_object('itemId', v_item.id, 'reason', 'SHIPMENT_NOT_READY');
      continue;
    end if;

    v_job := null;
    insert into public.background_jobs (organization_id, job_type, entity_type, entity_id, status, created_by, progress)
    values (p_organization_id, 'shipment-booking', 'shipment', v_item.shipment_id, 'QUEUED', p_created_by,
            jsonb_build_object('bookingRunId', v_run, 'bookingQueueItemId', v_item.id))
    on conflict (organization_id, entity_id)
      where job_type = 'shipment-booking'
        and entity_type = 'shipment'
        and entity_id is not null
        and status in ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING')
    do nothing
    returning id into v_job;
    if v_job is null then
      -- An active job already owns this shipment; it books it once.
      select id into v_job from public.background_jobs
       where organization_id = p_organization_id
         and job_type = 'shipment-booking'
         and entity_type = 'shipment'
         and entity_id = v_item.shipment_id
         and status in ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING')
       order by created_at
       limit 1;
    end if;

    update public.booking_queue_items
       set state = 'BATCHED', run_id = v_run, attempt_count = attempt_count + 1, last_error = null, last_error_code = null
     where id = v_item.id;

    v_dispatched := v_dispatched || jsonb_build_object('itemId', v_item.id, 'shipmentId', v_item.shipment_id, 'jobId', v_job);
    v_count := v_count + 1;
  end loop;

  -- Requested items that were not READY (or are being dispatched by someone else right now).
  v_skipped := v_skipped || coalesce((
    select jsonb_agg(jsonb_build_object('itemId', requested, 'reason', 'NOT_READY'))
      from unnest(p_item_ids) as requested
     where requested <> all(v_seen)
  ), '[]'::jsonb);

  if v_count = 0 then
    delete from public.booking_runs where id = v_run;
    return jsonb_build_object('runId', null, 'replayed', false, 'dispatched', '[]'::jsonb, 'skipped', v_skipped);
  end if;

  update public.booking_runs set status = 'ACTIVE', item_count = v_count where id = v_run;
  return jsonb_build_object('runId', v_run, 'replayed', false, 'dispatched', v_dispatched, 'skipped', v_skipped);
end;
$$;
