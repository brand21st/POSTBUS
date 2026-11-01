-- AI AutoPack: merchant custom size intelligence.
-- Additive only. No backfill. No existing shipment is changed.
--   1. Saved pack sizes become workspace-wide (user_id stays as the creator).
--   2. Shopify variant / product ids are stored on order lines for exact matching.
--   3. packaging_history records merchant-chosen boxes per shipment composition.
--   4. automation_settings.auto_package_selection (default off) gates auto-apply.

-- 1. Workspace-wide saved pack sizes ------------------------------------------

comment on table public.user_shipment_presets is
  'Saved pack sizes shared by every member of a workspace. user_id is the member who created it.';

drop policy if exists user_shipment_presets_self on public.user_shipment_presets;
drop policy if exists user_shipment_presets_org_select on public.user_shipment_presets;
drop policy if exists user_shipment_presets_org_insert on public.user_shipment_presets;
drop policy if exists user_shipment_presets_org_update on public.user_shipment_presets;
drop policy if exists user_shipment_presets_org_delete on public.user_shipment_presets;

create policy user_shipment_presets_org_select on public.user_shipment_presets
  for select
  using (public.is_org_member(organization_id));

create policy user_shipment_presets_org_insert on public.user_shipment_presets
  for insert
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy user_shipment_presets_org_update on public.user_shipment_presets
  for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy user_shipment_presets_org_delete on public.user_shipment_presets
  for delete
  using (public.is_org_member(organization_id));

-- The per-user name unique stays: members of one workspace may already share a name.
-- Workspace-level name uniqueness is enforced for new rows in the app layer.

create index if not exists user_shipment_presets_org_used_idx
  on public.user_shipment_presets (organization_id, last_used_at desc nulls last, created_at desc);

-- 2. Shopify variant identity on order lines ----------------------------------

alter table public.order_line_items
  add column if not exists shopify_variant_id text,
  add column if not exists shopify_product_id text;

comment on column public.order_line_items.shopify_variant_id is
  'Numeric Shopify ProductVariant id. Used by AutoPack for exact composition matching.';

-- 3. Packaging history ----------------------------------------------------------

create table if not exists public.packaging_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shop_domain text,
  order_id uuid references public.orders(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  composition_key text not null,
  composition jsonb not null,
  unit_count integer not null,
  length_cm numeric(10,3) not null,
  width_cm numeric(10,3) not null,
  height_cm numeric(10,3) not null,
  weight_grams integer,
  service_code text not null,
  package_source text not null,
  preset_id uuid references public.user_shipment_presets(id) on delete set null,
  evidence_level text not null default 'entered',
  entered_by uuid references auth.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  confirmed_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  superseded_at timestamptz,
  rejected_order_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_history_key_chk check (composition_key ~ '^[0-9a-f]{64}$'),
  constraint packaging_history_composition_chk check (jsonb_typeof(composition) = 'array'),
  constraint packaging_history_units_chk check (unit_count >= 1),
  constraint packaging_history_dims_chk check (
    length_cm > 0 and length_cm <= 150
    and width_cm > 0 and width_cm <= 150
    and height_cm > 0 and height_cm <= 150
  ),
  constraint packaging_history_weight_chk check (weight_grams is null or weight_grams between 1 and 35000),
  constraint packaging_history_source_chk check (package_source in ('preset', 'custom')),
  constraint packaging_history_level_chk check (evidence_level in ('entered', 'confirmed', 'verified')),
  constraint packaging_history_verified_chk check (
    (evidence_level = 'verified') = (verified_at is not null)
  )
);

comment on table public.packaging_history is
  'Merchant-chosen boxes per exact Shopify variant + quantity composition. entered = typed, confirmed = booked with these dims, verified = merchant marked it measured. Only verified rows may be auto-applied.';

drop trigger if exists set_packaging_history_updated_at on public.packaging_history;
create trigger set_packaging_history_updated_at
  before update on public.packaging_history
  for each row execute function public.set_updated_at();

create index if not exists packaging_history_lookup_idx
  on public.packaging_history (organization_id, composition_key, created_at desc)
  where superseded_at is null;

create index if not exists packaging_history_shipment_idx
  on public.packaging_history (organization_id, shipment_id)
  where shipment_id is not null;

create index if not exists packaging_history_org_created_idx
  on public.packaging_history (organization_id, created_at desc);

alter table public.packaging_history enable row level security;

drop policy if exists packaging_history_select on public.packaging_history;
create policy packaging_history_select on public.packaging_history
  for select using (public.is_org_member(organization_id));

drop policy if exists packaging_history_insert on public.packaging_history;
create policy packaging_history_insert on public.packaging_history
  for insert with check (public.is_org_member(organization_id));

drop policy if exists packaging_history_update on public.packaging_history;
create policy packaging_history_update on public.packaging_history
  for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

revoke all on public.packaging_history from public, anon;
grant select, insert, update on table public.packaging_history to authenticated;
grant all on table public.packaging_history to service_role;

-- 4. Merchant opt-in --------------------------------------------------------------

alter table public.automation_settings
  add column if not exists auto_package_selection boolean not null default false;

comment on column public.automation_settings.auto_package_selection is
  'When true, AutoPack applies a verified past box for an exact variant + quantity match on unbooked draft shipments.';
