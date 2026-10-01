create or replace function public.public_find_shipment_global(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_events jsonb;
  v_city text;
  v_state text;
begin
  if p_query is null or length(trim(p_query)) < 6 then
    return null;
  end if;

  select s.*, o.order_number
    into v_shipment
  from public.shipments s
  left join public.orders o on o.id = s.order_id
  where s.barcode = trim(p_query)
     or s.tracking_number = trim(p_query)
  order by s.updated_at desc nulls last
  limit 1;

  if not found then
    return null;
  end if;

  select a.city, a.state into v_city, v_state
  from public.addresses a
  where a.id = v_shipment.shipping_address_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'eventCode', e.event_code,
    'eventDescription', e.event_description,
    'officeName', e.office_name,
    'occurredAt', e.occurred_at
  ) order by e.occurred_at desc), '[]'::jsonb)
    into v_events
  from public.tracking_events e
  where e.shipment_id = v_shipment.id;

  return jsonb_build_object(
    'organizationId', v_shipment.organization_id,
    'id', v_shipment.id,
    'barcode', v_shipment.barcode,
    'trackingNumber', v_shipment.tracking_number,
    'status', v_shipment.status,
    'orderNumber', v_shipment.order_number,
    'destinationCity', v_city,
    'destinationState', v_state,
    'events', v_events
  );
end;
$$;

revoke all on function public.public_find_shipment_global(text) from public;
grant execute on function public.public_find_shipment_global(text) to anon, authenticated;
