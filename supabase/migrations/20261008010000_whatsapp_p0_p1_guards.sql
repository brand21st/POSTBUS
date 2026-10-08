-- Atomic WhatsApp payment claim resolution, customer-YES CAS, and
-- inbound webhook envelope idempotency (no organization required).

create table if not exists public.vachat_webhook_envelopes (
  envelope_id text primary key,
  request_hash text,
  created_at timestamptz not null default now()
);

alter table public.vachat_webhook_envelopes enable row level security;

revoke all on table public.vachat_webhook_envelopes from public, anon, authenticated;
grant all on table public.vachat_webhook_envelopes to service_role;

comment on table public.vachat_webhook_envelopes is
  'Inbound VaChat/WhatsApp webhook envelope ids. Dedupes retries before command execution, including when organization_id is unknown.';

create or replace function public.cas_whatsapp_customer_confirm(
  p_order_id uuid,
  p_organization_id uuid,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.orders;
begin
  update public.orders
  set metadata = p_metadata
  where id = p_order_id
    and organization_id = p_organization_id
    and source = 'WHATSAPP'
    and status = 'IMPORTED'
    and payment_status = 'PENDING'
    and coalesce(metadata->'whatsappLifecycle'->>'customer_confirmed_at', '') = ''
    and coalesce(metadata->'storefront'->>'customer_confirmed_at', '') = ''
  returning * into updated;

  if updated.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', updated.id,
    'order_number', updated.order_number,
    'status', updated.status,
    'payment_status', updated.payment_status,
    'metadata', updated.metadata
  );
end;
$$;

revoke all on function public.cas_whatsapp_customer_confirm(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cas_whatsapp_customer_confirm(uuid, uuid, jsonb) to service_role;

create or replace function public.resolve_whatsapp_payment_claim(
  p_action text,
  p_order_id uuid,
  p_organization_id uuid,
  p_payment_status text default null,
  p_amount_paid numeric default null,
  p_cod_amount numeric default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.orders;
  claim_row public.order_payment_claims;
  now_ts timestamptz := now();
begin
  if p_action not in ('CONFIRM', 'REJECT') then
    raise exception 'invalid_action';
  end if;

  select * into order_row
  from public.orders
  where id = p_order_id
    and organization_id = p_organization_id
  for update;

  if order_row.id is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  if order_row.source is distinct from 'WHATSAPP' then
    return jsonb_build_object('result', 'not_found');
  end if;

  if order_row.status = 'CANCELLED' then
    return jsonb_build_object('result', 'cancelled');
  end if;

  if p_action = 'CONFIRM' then
    if order_row.status = 'READY' then
      return jsonb_build_object('result', 'already_confirmed');
    end if;
    if order_row.status is distinct from 'IMPORTED' or order_row.payment_status is distinct from 'PENDING' then
      return jsonb_build_object('result', 'invalid_state');
    end if;

    select * into claim_row
    from public.order_payment_claims
    where organization_id = p_organization_id
      and order_id = p_order_id
      and status = 'OPEN'
    for update;

    if claim_row.id is null then
      return jsonb_build_object('result', 'no_open_claim');
    end if;

    update public.orders
    set status = 'READY',
        payment_status = p_payment_status,
        amount_paid = p_amount_paid,
        cod_amount = p_cod_amount,
        metadata = coalesce(p_metadata, order_row.metadata)
    where id = p_order_id
      and organization_id = p_organization_id
      and source = 'WHATSAPP'
      and status = 'IMPORTED'
      and payment_status = 'PENDING';

    if not found then
      return jsonb_build_object('result', 'invalid_state');
    end if;

    update public.order_payment_claims
    set status = 'CONFIRMED',
        resolved_at = now_ts
    where id = claim_row.id
      and organization_id = p_organization_id
      and status = 'OPEN';

    if not found then
      raise exception 'claim_confirm_failed';
    end if;

    return jsonb_build_object('result', 'confirmed', 'claim_id', claim_row.id);
  end if;

  if order_row.status = 'READY' then
    return jsonb_build_object('result', 'already_confirmed');
  end if;
  if order_row.status is distinct from 'IMPORTED' or order_row.payment_status is distinct from 'PENDING' then
    return jsonb_build_object('result', 'invalid_state');
  end if;

  select * into claim_row
  from public.order_payment_claims
  where organization_id = p_organization_id
    and order_id = p_order_id
    and status = 'OPEN'
  for update;

  if claim_row.id is null then
    return jsonb_build_object('result', 'no_open_claim');
  end if;

  update public.order_payment_claims
  set status = 'REJECTED',
      resolved_at = now_ts
  where id = claim_row.id
    and organization_id = p_organization_id
    and status = 'OPEN';

  if not found then
    return jsonb_build_object('result', 'no_open_claim');
  end if;

  return jsonb_build_object('result', 'rejected', 'claim_id', claim_row.id);
end;
$$;

revoke all on function public.resolve_whatsapp_payment_claim(text, uuid, uuid, text, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_payment_claim(text, uuid, uuid, text, numeric, numeric, jsonb) to service_role;
