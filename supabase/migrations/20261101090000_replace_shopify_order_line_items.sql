-- Atomic Shopify line-item replace for one order.
-- Additive: does not unique-index source_line_item_id (historical duplicates exist).
-- SECURITY INVOKER + fixed search_path. Per-order lock only.

alter table public.order_line_items
  add column if not exists unfulfilled_quantity integer,
  add column if not exists source_line_item_id text,
  add column if not exists requires_shipping boolean,
  add column if not exists variant text,
  add column if not exists weight_edited boolean not null default false,
  add column if not exists image_url text;

alter table public.order_line_items
  drop constraint if exists order_line_items_unfulfilled_quantity_chk;

alter table public.order_line_items
  add constraint order_line_items_unfulfilled_quantity_chk
  check (unfulfilled_quantity is null or unfulfilled_quantity >= 0);

create or replace function public.replace_shopify_order_line_items(
  p_organization_id uuid,
  p_order_id uuid,
  p_source_updated_at timestamptz,
  p_lines jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_stored_at timestamptz;
  v_locked boolean := false;
  v_count integer := 0;
  v_line jsonb;
  v_title text;
  v_qty integer;
begin
  if p_organization_id is null or p_order_id is null then
    raise exception 'replace_shopify_order_line_items: organization and order are required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'replace_shopify_order_line_items: p_lines must be a JSON array';
  end if;
  if jsonb_array_length(p_lines) < 1 then
    raise exception 'replace_shopify_order_line_items: p_lines must not be empty';
  end if;

  perform pg_advisory_xact_lock(
    87251411,
    hashtext(p_organization_id::text || ':' || p_order_id::text)
  );

  select *
    into v_order
    from public.orders
   where id = p_order_id
     and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'replace_shopify_order_line_items: order not found for organization';
  end if;

  begin
    v_stored_at := nullif(v_order.metadata #>> '{shopifyPayment,updatedAt}', '')::timestamptz;
  exception when others then
    v_stored_at := null;
  end;
  if p_source_updated_at is not null and v_stored_at is not null and p_source_updated_at < v_stored_at then
    return jsonb_build_object('ok', true, 'action', 'skipped_stale');
  end if;

  if upper(coalesce(v_order.status::text, '')) = any (
    array['BOOKED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']
  ) then
    v_locked := true;
  end if;

  if not v_locked then
    select exists (
      select 1
        from public.shipments s
       where s.organization_id = p_organization_id
         and s.order_id = p_order_id
         and upper(coalesce(s.status::text, '')) = any (
           array[
             'VALIDATING', 'QUEUED', 'BOOKING', 'BOOKED', 'LABEL_PENDING', 'LABEL_READY',
             'MANIFEST_PENDING', 'MANIFEST_READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
             'DELIVERED', 'NDR'
           ]
         )
    ) into v_locked;
  end if;

  if v_locked then
    return jsonb_build_object('ok', true, 'action', 'skipped_locked');
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_title := nullif(btrim(coalesce(v_line ->> 'title', '')), '');
    v_qty := coalesce((v_line ->> 'quantity')::integer, 0);
    if v_title is null then
      raise exception 'replace_shopify_order_line_items: title is required';
    end if;
    if v_qty < 1 then
      raise exception 'replace_shopify_order_line_items: quantity must be > 0';
    end if;
    v_count := v_count + 1;
  end loop;

  delete from public.order_line_items
   where organization_id = p_organization_id
     and order_id = p_order_id;

  insert into public.order_line_items (
    organization_id,
    order_id,
    title,
    sku,
    variant,
    quantity,
    unfulfilled_quantity,
    source_line_item_id,
    requires_shipping,
    unit_price,
    weight_grams,
    weight_edited,
    image_url
  )
  select
    p_organization_id,
    p_order_id,
    nullif(btrim(coalesce(line ->> 'title', '')), ''),
    nullif(line ->> 'sku', ''),
    nullif(line ->> 'variant', ''),
    (line ->> 'quantity')::integer,
    case
      when line ->> 'unfulfilled_quantity' is null or line ->> 'unfulfilled_quantity' = '' then null
      else greatest(0, (line ->> 'unfulfilled_quantity')::integer)
    end,
    nullif(line ->> 'source_line_item_id', ''),
    coalesce((line ->> 'requires_shipping')::boolean, true),
    coalesce((line ->> 'unit_price')::numeric, 0),
    case
      when line ->> 'weight_grams' is null or line ->> 'weight_grams' = '' then null
      else (line ->> 'weight_grams')::integer
    end,
    coalesce((line ->> 'weight_edited')::boolean, false),
    nullif(line ->> 'image_url', '')
  from jsonb_array_elements(p_lines) as line;

  return jsonb_build_object('ok', true, 'action', 'replaced', 'count', v_count);
end;
$$;

do $$
begin
  revoke all on function public.replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb) from public;
  begin
    revoke all on function public.replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb) from anon;
  exception when undefined_object then null;
  end;
  begin
    grant execute on function public.replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb) to authenticated;
  exception when undefined_object then null;
  end;
  begin
    grant execute on function public.replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb) to service_role;
  exception when undefined_object then null;
  end;
end
$$;

comment on function public.replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb) is
  'Atomically replace Shopify order_line_items for one organization-owned order. Skips stale Shopify snapshots and locked shipments.';
