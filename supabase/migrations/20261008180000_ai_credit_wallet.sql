-- AI credit packages, wallet counters, append-only ledger, atomic grant/consume.

alter table public.organizations
  add column if not exists ai_credits_purchased integer not null default 0,
  add column if not exists ai_credits_used integer not null default 0;

alter table public.organizations
  drop constraint if exists organizations_ai_credits_purchased_nonnegative;
alter table public.organizations
  add constraint organizations_ai_credits_purchased_nonnegative
    check (ai_credits_purchased >= 0);

alter table public.organizations
  drop constraint if exists organizations_ai_credits_used_nonnegative;
alter table public.organizations
  add constraint organizations_ai_credits_used_nonnegative
    check (ai_credits_used >= 0);

alter table public.platform_settings
  add column if not exists ai_credit_custom_min integer not null default 500,
  add column if not exists ai_credit_custom_max integer not null default 10000;

alter table public.platform_settings
  drop constraint if exists platform_settings_ai_credit_custom_range;
alter table public.platform_settings
  add constraint platform_settings_ai_credit_custom_range
    check (ai_credit_custom_min >= 1 and ai_credit_custom_max >= ai_credit_custom_min);

create table if not exists public.ai_credit_packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  credits integer not null,
  price_paise bigint not null,
  is_active boolean not null default true,
  is_recommended boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_credit_packages_credits_chk check (credits >= 1),
  constraint ai_credit_packages_price_chk check (price_paise >= 100),
  constraint ai_credit_packages_name_chk check (char_length(btrim(name)) >= 1)
);

create unique index if not exists ai_credit_packages_active_credits_uidx
  on public.ai_credit_packages (credits)
  where is_active = true;

create unique index if not exists ai_credit_packages_one_recommended_uidx
  on public.ai_credit_packages (is_recommended)
  where is_recommended = true and is_active = true;

drop trigger if exists set_ai_credit_packages_updated_at on public.ai_credit_packages;
create trigger set_ai_credit_packages_updated_at before update on public.ai_credit_packages
  for each row execute function public.set_updated_at();

insert into public.ai_credit_packages (slug, name, credits, price_paise, is_active, is_recommended, display_order)
values
  ('starter', 'Starter', 500, 9900, true, false, 10),
  ('growth', 'Growth', 1000, 17900, true, false, 20),
  ('pro', 'Pro', 2500, 39900, true, true, 30),
  ('business', 'Business', 5000, 69900, true, false, 40),
  ('scale', 'Scale', 10000, 119900, true, false, 50)
on conflict (slug) do nothing;

create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  reason_code text not null,
  delta integer not null,
  balance_after integer not null,
  status text not null default 'POSTED',
  payment_id uuid references public.payments(id) on delete set null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_credit_ledger_delta_chk check (delta <> 0),
  constraint ai_credit_ledger_type_chk check (char_length(btrim(type)) >= 1),
  constraint ai_credit_ledger_reason_chk check (char_length(btrim(reason_code)) >= 1),
  constraint ai_credit_ledger_status_chk check (status in ('POSTED', 'REVERSED'))
);

create unique index if not exists ai_credit_ledger_purchase_payment_uidx
  on public.ai_credit_ledger (payment_id)
  where type = 'PURCHASE' and payment_id is not null;

create unique index if not exists ai_credit_ledger_org_idempotency_uidx
  on public.ai_credit_ledger (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists ai_credit_ledger_org_created_idx
  on public.ai_credit_ledger (organization_id, created_at desc);

create index if not exists ai_credit_ledger_reason_idx
  on public.ai_credit_ledger (reason_code);

alter table public.payments
  add column if not exists ai_credit_package_id uuid references public.ai_credit_packages(id) on delete set null;

-- Scoped to AI credit checkouts: some subscription payments reuse the same Razorpay order id.
create unique index if not exists payments_ai_credits_razorpay_order_id_uidx
  on public.payments (razorpay_order_id)
  where billing_cycle = 'ai_credits'
    and razorpay_order_id is not null
    and length(btrim(razorpay_order_id)) > 0;

drop function if exists public.consume_ai_credit(uuid);

create or replace function public.consume_ai_credit(
  p_org uuid,
  p_reason text default 'AI_ADDRESS_EXTRACTION',
  p_idempotency_key text default null,
  p_qty integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty integer := greatest(1, coalesce(p_qty, 1));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing public.ai_credit_ledger%rowtype;
  v_remaining integer;
begin
  if v_reason is null then
    v_reason := 'AI_ADDRESS_EXTRACTION';
  end if;

  perform 1 from public.organizations where id = p_org for update;

  if v_key is not null then
    select * into v_existing
    from public.ai_credit_ledger
    where organization_id = p_org
      and idempotency_key = v_key
    limit 1;
    if found then
      select coalesce(ai_credits_balance, 0) into v_remaining
      from public.organizations
      where id = p_org;
      return jsonb_build_object(
        'remaining', coalesce(v_remaining, v_existing.balance_after),
        'consumed', false,
        'duplicate', true
      );
    end if;
  end if;

  update public.organizations
  set ai_credits_balance = ai_credits_balance - v_qty,
      ai_credits_used = ai_credits_used + v_qty,
      updated_at = now()
  where id = p_org
    and ai_credits_balance >= v_qty
  returning ai_credits_balance into v_remaining;

  if v_remaining is null then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = p_org;
    return jsonb_build_object(
      'remaining', coalesce(v_remaining, 0),
      'consumed', false,
      'duplicate', false
    );
  end if;

  insert into public.ai_credit_ledger (
    organization_id, type, reason_code, delta, balance_after, status, idempotency_key, metadata
  ) values (
    p_org,
    v_reason,
    v_reason,
    -v_qty,
    v_remaining,
    'POSTED',
    v_key,
    jsonb_build_object('qty', v_qty)
  );

  return jsonb_build_object(
    'remaining', v_remaining,
    'consumed', true,
    'duplicate', false
  );
end;
$$;

create or replace function public.grant_ai_credits(p_org uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
  v_qty integer := greatest(0, coalesce(p_amount, 0));
begin
  if v_qty = 0 then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = p_org;
    return coalesce(v_remaining, 0);
  end if;

  update public.organizations
  set ai_credits_balance = ai_credits_balance + v_qty,
      updated_at = now()
  where id = p_org
  returning ai_credits_balance into v_remaining;

  return coalesce(v_remaining, 0);
end;
$$;

create or replace function public.fulfill_ai_credit_purchase(
  p_razorpay_order_id text,
  p_razorpay_payment_id text default null,
  p_method text default null,
  p_amount_paise bigint default null,
  p_expected_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_claimed uuid;
  v_remaining integer;
  v_qty integer;
begin
  select * into v_payment
  from public.payments
  where razorpay_order_id = p_razorpay_order_id
    and billing_cycle = 'ai_credits'
  for update;

  if not found then
    return jsonb_build_object('handled', false, 'granted', false, 'remaining', null, 'organizationId', null);
  end if;

  if p_expected_organization_id is not null and v_payment.organization_id is distinct from p_expected_organization_id then
    return jsonb_build_object(
      'handled', true,
      'granted', false,
      'forbidden', true,
      'remaining', null,
      'organizationId', v_payment.organization_id
    );
  end if;

  if p_amount_paise is not null and v_payment.amount_paise is distinct from p_amount_paise then
    return jsonb_build_object(
      'handled', true,
      'granted', false,
      'amountMismatch', true,
      'remaining', null,
      'organizationId', v_payment.organization_id
    );
  end if;

  v_qty := greatest(0, coalesce(v_payment.ai_credit_pack_size, 0));

  update public.payments
  set status = 'CAPTURED',
      razorpay_payment_id = coalesce(p_razorpay_payment_id, razorpay_payment_id),
      method = coalesce(p_method, method),
      paid_at = coalesce(paid_at, now()),
      failure_reason = null
  where id = v_payment.id
    and status <> 'CAPTURED'
  returning id into v_claimed;

  if v_claimed is null then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = v_payment.organization_id;
    return jsonb_build_object(
      'handled', true,
      'granted', false,
      'remaining', coalesce(v_remaining, 0),
      'organizationId', v_payment.organization_id
    );
  end if;

  if v_qty = 0 then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = v_payment.organization_id;
    return jsonb_build_object(
      'handled', true,
      'granted', false,
      'remaining', coalesce(v_remaining, 0),
      'organizationId', v_payment.organization_id
    );
  end if;

  update public.organizations
  set ai_credits_balance = ai_credits_balance + v_qty,
      ai_credits_purchased = ai_credits_purchased + v_qty,
      updated_at = now()
  where id = v_payment.organization_id
  returning ai_credits_balance into v_remaining;

  insert into public.ai_credit_ledger (
    organization_id, type, reason_code, delta, balance_after, status, payment_id, idempotency_key, metadata
  ) values (
    v_payment.organization_id,
    'PURCHASE',
    'PURCHASE',
    v_qty,
    coalesce(v_remaining, 0),
    'POSTED',
    v_payment.id,
    'payment:' || v_payment.id::text,
    jsonb_build_object(
      'razorpay_order_id', p_razorpay_order_id,
      'razorpay_payment_id', p_razorpay_payment_id,
      'amount_paise', v_payment.amount_paise
    )
  )
  on conflict (payment_id) where (type = 'PURCHASE' and payment_id is not null)
  do nothing;

  return jsonb_build_object(
    'handled', true,
    'granted', true,
    'remaining', coalesce(v_remaining, 0),
    'organizationId', v_payment.organization_id,
    'credits', v_qty
  );
end;
$$;

revoke all on function public.consume_ai_credit(uuid, text, text, integer) from public;
revoke all on function public.consume_ai_credit(uuid, text, text, integer) from anon;
grant execute on function public.consume_ai_credit(uuid, text, text, integer) to authenticated, service_role;

revoke all on function public.fulfill_ai_credit_purchase(text, text, text, bigint, uuid) from public;
revoke all on function public.fulfill_ai_credit_purchase(text, text, text, bigint, uuid) from anon;
revoke all on function public.fulfill_ai_credit_purchase(text, text, text, bigint, uuid) from authenticated;
grant execute on function public.fulfill_ai_credit_purchase(text, text, text, bigint, uuid) to service_role;

alter table public.ai_credit_packages enable row level security;
alter table public.ai_credit_ledger enable row level security;

drop policy if exists ai_credit_packages_public_read on public.ai_credit_packages;
create policy ai_credit_packages_public_read on public.ai_credit_packages
  for select using (is_active = true or public.is_platform_admin());

drop policy if exists ai_credit_ledger_tenant_select on public.ai_credit_ledger;
create policy ai_credit_ledger_tenant_select on public.ai_credit_ledger
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());

grant select on public.ai_credit_packages to anon, authenticated;
grant select on public.ai_credit_ledger to authenticated;
