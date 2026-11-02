alter table public.storefront_settings add column if not exists theme jsonb not null default '{}';
alter table public.storefront_settings add column if not exists tracking jsonb not null default '{}';

create or replace function public.guard_storefront_tracking() returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.tracking <> '{}'::jsonb) or
     (tg_op = 'UPDATE' and new.tracking is distinct from old.tracking) then
    if auth.role() <> 'service_role' and not exists (
      select 1 from public.organization_members where organization_id = new.organization_id
      and user_id = auth.uid() and role in ('OWNER','ADMIN')
    ) then raise exception 'Only owners and admins can change tracking'; end if;
  end if;
  return new;
end $$;
create trigger guard_storefront_tracking before insert or update on public.storefront_settings
for each row execute function public.guard_storefront_tracking();

create unique index if not exists products_org_id_unique on public.products(organization_id, id);
create table public.storefront_bundles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  pricing_mode text not null check (pricing_mode in ('FIXED', 'PERCENT')),
  price_value numeric(12,2) not null check (price_value > 0),
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  check (pricing_mode <> 'PERCENT' or price_value < 100)
);
create table public.storefront_bundle_items (
  organization_id uuid not null,
  bundle_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity between 1 and 99),
  primary key(bundle_id,product_id),
  foreign key(organization_id,bundle_id) references public.storefront_bundles(organization_id,id) on delete cascade,
  foreign key(organization_id,product_id) references public.products(organization_id,id) on delete restrict
);
create index storefront_bundles_org_sort on public.storefront_bundles(organization_id,published,sort_order);
alter table public.storefront_bundles enable row level security;
alter table public.storefront_bundle_items enable row level security;
create policy bundles_read on public.storefront_bundles for select to authenticated using(public.is_org_member(organization_id));
create policy bundles_write on public.storefront_bundles for all to authenticated using(public.inventory_writer(organization_id)) with check(public.inventory_writer(organization_id));
create policy bundle_items_read on public.storefront_bundle_items for select to authenticated using(public.is_org_member(organization_id));
create policy bundle_items_write on public.storefront_bundle_items for all to authenticated using(public.inventory_writer(organization_id)) with check(public.inventory_writer(organization_id));
create trigger set_storefront_bundles_updated_at before update on public.storefront_bundles for each row execute function public.set_updated_at();

create or replace function public.save_storefront_bundle(p_organization_id uuid, p_id uuid, p_bundle jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_count integer;
begin
  v_count := jsonb_array_length(p_bundle->'items');
  if v_count not between 2 and 8 then raise exception 'Choose two to eight products'; end if;
  if p_id is null then
    insert into public.storefront_bundles(organization_id,name,pricing_mode,price_value,published,sort_order)
    values(p_organization_id,p_bundle->>'name',p_bundle->>'pricingMode',(p_bundle->>'priceValue')::numeric,
      (p_bundle->>'published')::boolean,(p_bundle->>'sortOrder')::integer) returning id into v_id;
  else
    update public.storefront_bundles set name=p_bundle->>'name',pricing_mode=p_bundle->>'pricingMode',
      price_value=(p_bundle->>'priceValue')::numeric,published=(p_bundle->>'published')::boolean,
      sort_order=(p_bundle->>'sortOrder')::integer where organization_id=p_organization_id and id=p_id returning id into v_id;
    if v_id is null then raise exception 'Bundle not found'; end if;
  end if;
  delete from public.storefront_bundle_items where organization_id=p_organization_id and bundle_id=v_id;
  insert into public.storefront_bundle_items(organization_id,bundle_id,product_id,quantity)
    select p_organization_id,v_id,(i->>'productId')::uuid,(i->>'quantity')::integer from jsonb_array_elements(p_bundle->'items') i;
  return v_id;
end $$;
revoke all on function public.save_storefront_bundle(uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_storefront_bundle(uuid,uuid,jsonb) to authenticated, service_role;
grant select,insert,update,delete on public.storefront_bundles,public.storefront_bundle_items to authenticated,service_role;
