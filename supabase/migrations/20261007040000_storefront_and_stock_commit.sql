-- Storefront catalog fields, categories, merchant store settings, and idempotent
-- stock commit after a successful India Post booking.

alter table public.products
  add column if not exists compare_at_price numeric(12,2),
  add column if not exists description text,
  add column if not exists store_visible boolean not null default true;

do $$ begin
  alter table public.products
    add constraint products_compare_at_chk check (compare_at_price is null or compare_at_price >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.products
    add constraint products_description_chk check (description is null or char_length(description) <= 4000);
exception when duplicate_object then null;
end $$;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_chk check (char_length(btrim(name)) >= 1),
  constraint product_categories_slug_chk check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists product_categories_org_slug_uidx
  on public.product_categories (organization_id, slug);
create index if not exists product_categories_org_sort_idx
  on public.product_categories (organization_id, sort_order, name);

create table if not exists public.product_category_members (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.product_categories(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create index if not exists product_category_members_cat_idx
  on public.product_category_members (organization_id, category_id);

create table if not exists public.storefront_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  store_name text,
  logo_path text,
  accent_color text,
  published boolean not null default true,
  featured_product_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storefront_accent_chk check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.storefront_slides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  image_path text not null,
  title text,
  subtitle text,
  cta_label text,
  cta_href text,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storefront_slides_org_sort_idx
  on public.storefront_slides (organization_id, sort_order);

create unique index if not exists inventory_movements_order_commit_uidx
  on public.inventory_movements (order_line_item_id)
  where reason = 'ORDER_COMMIT' and order_line_item_id is not null;

drop trigger if exists set_product_categories_updated_at on public.product_categories;
create trigger set_product_categories_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

drop trigger if exists set_storefront_settings_updated_at on public.storefront_settings;
create trigger set_storefront_settings_updated_at
  before update on public.storefront_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_storefront_slides_updated_at on public.storefront_slides;
create trigger set_storefront_slides_updated_at
  before update on public.storefront_slides
  for each row execute function public.set_updated_at();

alter table public.product_categories enable row level security;
alter table public.product_category_members enable row level security;
alter table public.storefront_settings enable row level security;
alter table public.storefront_slides enable row level security;

drop policy if exists product_categories_select on public.product_categories;
create policy product_categories_select on public.product_categories
  for select using (public.is_org_member(organization_id));
drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write on public.product_categories
  for all using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

drop policy if exists product_category_members_select on public.product_category_members;
create policy product_category_members_select on public.product_category_members
  for select using (public.is_org_member(organization_id));
drop policy if exists product_category_members_write on public.product_category_members;
create policy product_category_members_write on public.product_category_members
  for all using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

drop policy if exists storefront_settings_select on public.storefront_settings;
create policy storefront_settings_select on public.storefront_settings
  for select using (public.is_org_member(organization_id));
drop policy if exists storefront_settings_write on public.storefront_settings;
create policy storefront_settings_write on public.storefront_settings
  for all using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

drop policy if exists storefront_slides_select on public.storefront_slides;
create policy storefront_slides_select on public.storefront_slides
  for select using (public.is_org_member(organization_id));
drop policy if exists storefront_slides_write on public.storefront_slides;
create policy storefront_slides_write on public.storefront_slides
  for all using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

create or replace function public.commit_order_inventory(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_line record;
  v_committed integer := 0;
  v_skipped integer := 0;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  for v_line in
    select li.id, li.product_id, li.quantity, li.organization_id
    from public.order_line_items li
    where li.order_id = p_order_id
      and li.product_id is not null
      and li.quantity > 0
  loop
    if exists (
      select 1
      from public.inventory_movements m
      where m.order_line_item_id = v_line.id
        and m.reason = 'ORDER_COMMIT'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      perform public.adjust_inventory(
        v_line.organization_id,
        v_line.product_id,
        -v_line.quantity,
        'ORDER_COMMIT',
        'India Post booking',
        null,
        p_order_id,
        v_line.id
      );
      v_committed := v_committed + 1;
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
      when others then
        -- Booking already succeeded; do not fail the shipment if stock is short.
        v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'orderId', p_order_id,
    'committed', v_committed,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.commit_order_inventory(uuid) from public;
revoke all on function public.commit_order_inventory(uuid) from anon;
grant execute on function public.commit_order_inventory(uuid) to authenticated, service_role;
