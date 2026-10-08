-- Per-user pack sizes (weight + box + India Post service) for Add order.

create table if not exists public.user_shipment_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  weight_grams integer not null,
  length_cm numeric not null,
  width_cm numeric not null,
  height_cm numeric not null,
  service_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint user_shipment_presets_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint user_shipment_presets_weight_chk check (weight_grams between 1 and 35000),
  constraint user_shipment_presets_length_chk check (length_cm >= 14 and length_cm <= 150),
  constraint user_shipment_presets_width_chk check (width_cm >= 9 and width_cm <= 150),
  constraint user_shipment_presets_height_chk check (height_cm >= 1 and height_cm <= 150),
  constraint user_shipment_presets_service_chk check (service_code in ('SP_INLAND_PARCEL', 'BUSINESS_PARCEL')),
  constraint user_shipment_presets_name_unique unique (user_id, organization_id, name)
);

comment on table public.user_shipment_presets is
  'Saved pack sizes per signed-in member and workspace for one-tap booking fields.';

drop trigger if exists set_user_shipment_presets_updated_at on public.user_shipment_presets;
create trigger set_user_shipment_presets_updated_at
  before update on public.user_shipment_presets
  for each row execute function public.set_updated_at();

create index if not exists user_shipment_presets_user_org_used_idx
  on public.user_shipment_presets (user_id, organization_id, last_used_at desc nulls last, created_at desc);

alter table public.user_shipment_presets enable row level security;

drop policy if exists user_shipment_presets_self on public.user_shipment_presets;
create policy user_shipment_presets_self on public.user_shipment_presets
  for all
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

revoke all on public.user_shipment_presets from public, anon;
grant select, insert, update, delete on table public.user_shipment_presets to authenticated;
