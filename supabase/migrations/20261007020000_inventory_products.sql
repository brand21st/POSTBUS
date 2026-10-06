-- Organization-scoped product catalog, stock balance, and movement ledger.
-- Additive: existing orders keep working with nullable order_line_items.product_id.

do $$ begin
  create type public.inventory_movement_reason as enum (
    'OPENING',
    'ADJUSTMENT',
    'ORDER_RESERVE',
    'ORDER_COMMIT',
    'ORDER_RELEASE',
    'RTO_RETURN'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sku text not null,
  price numeric(12,2) not null default 0,
  weight_grams integer not null default 0,
  active boolean not null default true,
  prepaid_enabled boolean not null default true,
  cod_enabled boolean not null default true,
  cod_advance_percent numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_chk check (char_length(btrim(name)) >= 1),
  constraint products_sku_chk check (char_length(btrim(sku)) >= 1),
  constraint products_price_chk check (price >= 0),
  constraint products_weight_chk check (weight_grams >= 0),
  constraint products_cod_advance_chk check (cod_advance_percent >= 0 and cod_advance_percent <= 100),
  constraint products_payment_mode_chk check (prepaid_enabled or cod_enabled)
);

create unique index if not exists products_org_sku_uidx
  on public.products (organization_id, lower(btrim(sku)));
create index if not exists products_org_active_idx
  on public.products (organization_id, active);
create index if not exists products_org_created_idx
  on public.products (organization_id, created_at desc);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  on_hand integer not null default 0,
  reserved integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_balances_on_hand_chk check (on_hand >= 0),
  constraint inventory_balances_reserved_chk check (reserved >= 0),
  constraint inventory_balances_reserved_lte_on_hand_chk check (reserved <= on_hand),
  unique (organization_id, product_id)
);

create unique index if not exists inventory_balances_product_uidx
  on public.inventory_balances (product_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_delta integer not null,
  reason public.inventory_movement_reason not null,
  order_id uuid references public.orders(id) on delete set null,
  order_line_item_id uuid references public.order_line_items(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  balance_after integer not null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_delta_chk check (quantity_delta <> 0),
  constraint inventory_movements_note_chk check (note is null or char_length(note) <= 500)
);

create index if not exists inventory_movements_product_idx
  on public.inventory_movements (organization_id, product_id, created_at desc);

alter table public.order_line_items
  add column if not exists product_id uuid references public.products(id) on delete set null;

create index if not exists order_line_items_product_idx
  on public.order_line_items (organization_id, product_id)
  where product_id is not null;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_balances_updated_at on public.inventory_balances;
create trigger set_inventory_balances_updated_at
  before update on public.inventory_balances
  for each row execute function public.set_updated_at();

create or replace function public.ensure_inventory_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_balances (organization_id, product_id)
  values (new.organization_id, new.id)
  on conflict (organization_id, product_id) do nothing;
  return new;
end;
$$;

drop trigger if exists products_ensure_balance on public.products;
create trigger products_ensure_balance
  after insert on public.products
  for each row execute function public.ensure_inventory_balance();

create or replace function public.inventory_writer(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_org_role(
    org_id,
    array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[]
  );
$$;

create or replace function public.adjust_inventory(
  p_organization_id uuid,
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason public.inventory_movement_reason,
  p_note text default null,
  p_created_by uuid default null,
  p_order_id uuid default null,
  p_order_line_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.inventory_balances;
  v_next integer;
  v_movement_id uuid;
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Enter a stock adjustment other than zero.' using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.inventory_writer(p_organization_id) then
    raise exception 'You do not have permission to change stock.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.organization_id = p_organization_id
  ) then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  select *
    into v_balance
  from public.inventory_balances
  where organization_id = p_organization_id
    and product_id = p_product_id
  for update;

  if v_balance.id is null then
    insert into public.inventory_balances (organization_id, product_id)
    values (p_organization_id, p_product_id)
    on conflict (organization_id, product_id) do nothing;

    select *
      into v_balance
    from public.inventory_balances
    where organization_id = p_organization_id
      and product_id = p_product_id
    for update;
  end if;

  v_next := v_balance.on_hand + p_quantity_delta;
  if v_next < 0 then
    raise exception 'Stock cannot go below zero.' using errcode = 'P0001';
  end if;
  if v_balance.reserved > v_next then
    raise exception 'Reserved stock cannot exceed on-hand quantity.' using errcode = 'P0001';
  end if;

  update public.inventory_balances
  set on_hand = v_next
  where id = v_balance.id;

  insert into public.inventory_movements (
    organization_id,
    product_id,
    quantity_delta,
    reason,
    order_id,
    order_line_item_id,
    note,
    created_by,
    balance_after
  )
  values (
    p_organization_id,
    p_product_id,
    p_quantity_delta,
    p_reason,
    p_order_id,
    p_order_line_item_id,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_created_by, auth.uid()),
    v_next
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'productId', p_product_id,
    'onHand', v_next,
    'reserved', v_balance.reserved,
    'movementId', v_movement_id
  );
end;
$$;

create or replace function public.create_inventory_product(
  p_organization_id uuid,
  p_name text,
  p_sku text,
  p_price numeric,
  p_weight_grams integer,
  p_prepaid_enabled boolean,
  p_cod_enabled boolean,
  p_cod_advance_percent numeric,
  p_opening_stock integer default 0,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_opening integer := greatest(0, coalesce(p_opening_stock, 0));
  v_percent numeric := coalesce(p_cod_advance_percent, 0);
begin
  if auth.uid() is not null and not public.inventory_writer(p_organization_id) then
    raise exception 'You do not have permission to create products.' using errcode = '42501';
  end if;

  if not coalesce(p_prepaid_enabled, false) and not coalesce(p_cod_enabled, false) then
    raise exception 'Enable prepaid, COD, or both.' using errcode = 'P0001';
  end if;

  if not coalesce(p_cod_enabled, false) then
    v_percent := 0;
  end if;

  insert into public.products (
    organization_id,
    name,
    sku,
    price,
    weight_grams,
    prepaid_enabled,
    cod_enabled,
    cod_advance_percent
  )
  values (
    p_organization_id,
    btrim(p_name),
    btrim(p_sku),
    coalesce(p_price, 0),
    coalesce(p_weight_grams, 0),
    coalesce(p_prepaid_enabled, true),
    coalesce(p_cod_enabled, true),
    v_percent
  )
  returning id into v_id;

  if v_opening > 0 then
    perform public.adjust_inventory(
      p_organization_id,
      v_id,
      v_opening,
      'OPENING',
      'Opening stock',
      coalesce(p_created_by, auth.uid()),
      null,
      null
    );
  end if;

  return v_id;
end;
$$;

alter table public.products enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select using (public.is_org_member(organization_id));

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert with check (public.inventory_writer(organization_id));

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

drop policy if exists inventory_balances_select on public.inventory_balances;
create policy inventory_balances_select on public.inventory_balances
  for select using (public.is_org_member(organization_id));

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements
  for select using (public.is_org_member(organization_id));

revoke all on function public.inventory_writer(uuid) from public;
grant execute on function public.inventory_writer(uuid) to authenticated;

revoke all on function public.ensure_inventory_balance() from public, anon, authenticated;

revoke all on function public.adjust_inventory(uuid, uuid, integer, public.inventory_movement_reason, text, uuid, uuid, uuid) from public;
revoke all on function public.adjust_inventory(uuid, uuid, integer, public.inventory_movement_reason, text, uuid, uuid, uuid) from anon;
grant execute on function public.adjust_inventory(uuid, uuid, integer, public.inventory_movement_reason, text, uuid, uuid, uuid) to authenticated, service_role;

revoke all on function public.create_inventory_product(uuid, text, text, numeric, integer, boolean, boolean, numeric, integer, uuid) from public;
revoke all on function public.create_inventory_product(uuid, text, text, numeric, integer, boolean, boolean, numeric, integer, uuid) from anon;
grant execute on function public.create_inventory_product(uuid, text, text, numeric, integer, boolean, boolean, numeric, integer, uuid) to authenticated, service_role;
