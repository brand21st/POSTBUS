alter table public.india_post_connections
  add column if not exists pickup_office_id text,
  add column if not exists pickup_office_name text,
  add column if not exists pickup_office_pincode text,
  add column if not exists pickup_office_type_code text,
  add column if not exists pickup_office_city text,
  add column if not exists pickup_office_state text;

comment on column public.india_post_connections.pickup_office_id is
  'India Post office_id used when pickup_or_dropoff is PICKUP. Distinct from pickup_dropoff_office_id (drop-off).';
comment on column public.india_post_connections.pickup_office_name is
  'Display name of the configured pickup India Post office.';
comment on column public.india_post_connections.pickup_office_pincode is
  'Six-digit pincode of the configured pickup India Post office.';
