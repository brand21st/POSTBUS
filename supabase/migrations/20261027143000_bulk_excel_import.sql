-- Merchant Excel drafts. Booking still goes through shipments and shipment-booking jobs.

create table if not exists public.bulk_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text not null,
  profile_key text not null,
  status text not null check (status in (
    'uploaded',
    'mapped',
    'validated',
    'draft',
    'booking',
    'completed',
    'failed'
  )),
  sheet_name text,
  header_row integer,
  column_map jsonb not null default '{}'::jsonb,
  unmapped_headers jsonb not null default '[]'::jsonb,
  headers jsonb not null default '[]'::jsonb,
  other_sheets jsonb not null default '[]'::jsonb,
  service_code text,
  overrides jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  materialize_job_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bulk_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bulk_import_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  excel_row_number integer not null,
  raw_cells jsonb not null default '{}'::jsonb,
  mapped_fields jsonb not null default '{}'::jsonb,
  unmapped jsonb not null default '{}'::jsonb,
  normalized jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  barcode text,
  status text not null default 'pending' check (status in (
    'pending',
    'valid',
    'invalid',
    'queued',
    'failed',
    'skipped'
  )),
  order_id uuid references public.orders(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, excel_row_number)
);

create table if not exists public.bulk_import_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  format_key text not null,
  column_map jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists bulk_import_batches_org_idx
  on public.bulk_import_batches (organization_id, created_at desc);

create index if not exists bulk_import_rows_batch_idx
  on public.bulk_import_rows (batch_id, excel_row_number);

drop trigger if exists set_bulk_import_batches_updated_at on public.bulk_import_batches;
create trigger set_bulk_import_batches_updated_at
  before update on public.bulk_import_batches
  for each row execute function public.set_updated_at();

drop trigger if exists set_bulk_import_mapping_profiles_updated_at on public.bulk_import_mapping_profiles;
create trigger set_bulk_import_mapping_profiles_updated_at
  before update on public.bulk_import_mapping_profiles
  for each row execute function public.set_updated_at();

create or replace function public.bulk_import_row_org_guard()
returns trigger
language plpgsql
as $$
declare
  v_batch_org uuid;
begin
  select organization_id into v_batch_org from public.bulk_import_batches where id = new.batch_id;
  if v_batch_org is null or v_batch_org <> new.organization_id then
    raise exception 'bulk_import_rows organization must match its batch';
  end if;
  return new;
end;
$$;

drop trigger if exists bulk_import_row_org_guard on public.bulk_import_rows;
create trigger bulk_import_row_org_guard
  before insert or update on public.bulk_import_rows
  for each row execute function public.bulk_import_row_org_guard();

alter table public.bulk_import_batches enable row level security;
alter table public.bulk_import_rows enable row level security;
alter table public.bulk_import_mapping_profiles enable row level security;

drop policy if exists bulk_import_batches_member on public.bulk_import_batches;
create policy bulk_import_batches_member on public.bulk_import_batches
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists bulk_import_rows_member on public.bulk_import_rows;
create policy bulk_import_rows_member on public.bulk_import_rows
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists bulk_import_mapping_profiles_member on public.bulk_import_mapping_profiles;
create policy bulk_import_mapping_profiles_member on public.bulk_import_mapping_profiles
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

revoke all on public.bulk_import_batches from public, anon;
revoke all on public.bulk_import_rows from public, anon;
revoke all on public.bulk_import_mapping_profiles from public, anon;
grant select, insert, update, delete on table public.bulk_import_batches to authenticated, service_role;
grant select, insert, update, delete on table public.bulk_import_rows to authenticated, service_role;
grant select, insert, update, delete on table public.bulk_import_mapping_profiles to authenticated, service_role;
